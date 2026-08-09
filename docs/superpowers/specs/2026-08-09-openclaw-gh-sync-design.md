# OpenClaw GitHub Sync Plugin 设计文档

- 日期：2026-08-09
- 状态：已确认（待实现）
- 目标版本：v0.1.0

## 1. 背景与目标

OpenClaw 官方在 v2026.3.8 提供了 `openclaw backup create / verify` 本地备份能力（纯本地 tar.gz 归档 + SQLite 快照），官方文档明确表示上传、定时、同步不在其职责范围内。

本插件填补这一空缺：实现 **GitHub ↔ OpenClaw 的实时双向同步 + 官方备份归档同步**，并支持**多个 OpenClaw 实例共存于同一个 GitHub 仓库且互不干扰**。

### 成功标准

- 本地文件变化秒级推送至 GitHub。
- GitHub 远端变化 60s 内拉取回本地。
- 每 6h 自动执行官方 `openclaw backup create --verify` 并上传归档。
- 敏感数据（auth/credentials/channels 等）在 GitHub 上为密文。
- 多实例在同一仓库的不同分支中互不干扰。
- 一键从远端恢复/迁移。

## 2. 决策摘要（与用户确认）

| 决策点 | 结论 |
|---|---|
| 同步架构 | **混合模式**：实时文件同步 + 官方备份归档 |
| 实时层范围 | **全部同步（含密钥）**，敏感路径经 git-crypt 加密 |
| GitHub 认证 | **PAT**（Personal Access Token） |
| 敏感数据加密 | **git-crypt** 透明加密敏感路径 |
| 频率 | 秒级推送（防抖 2s）/ 60s 轮询拉取 / 6h 归档 |
| 镜像方式 | **镜像目录**：本地 `gh-sync/` 独立 git 仓库 |
| 归档位置 | 同仓库 `backups/` 目录，单文件超 95MB 转 GitHub Releases |
| 仓库布局 | **分支方案**：main 只放 README 索引，每实例一个 `instances/<name>` 分支 |
| 插件形态 | 新版原生插件：TS ESM + `definePluginEntry`，Node ≥22.22.3 |

## 3. 整体架构

```
openclaw-gh-sync（原生插件，TS ESM + definePluginEntry）
│
├── SyncEngine（实时层）
│   ├── Watcher        chokidar 监听本地源路径（排除易变/自引用）
│   ├── Mirror         变更同步到本地镜像仓库
│   ├── GitOps         commit / push / fetch / merge（含冲突处理）
│   └── Poller         每 60s fetch 远端
│
├── BackupEngine（归档层）
│   ├── Scheduler      每 6h spawn `openclaw backup create --verify`
│   └── Uploader       归档 → 本分支 backups/（>95MB 转 Releases）
│
├── RestoreEngine      读取远端分支 → verify → 暂存解包 → 预览 → 应用
├── ConfigService      读写插件配置（configSchema）
├── CLI Commands       setup / status / sync-now / backup-now / restore / conflicts / resolve / verify
└── Skill（后续可选）  agent 自然语言查询同步状态
```

生命周期：`register(api)` 注册；`gateway_stop` 清理（`deactivate` 已废弃）。

## 4. 仓库布局（分支方案）

```
GitHub repo（默认分支 main）
├── README.md                 # 实例索引：实例名/分支/主机名/最近同步（setup/remove/rename 时自动重写）
└── （每个实例一个分支）
    branches/instances/<name>/
    ├── openclaw/             # 该实例实时镜像（排除易变路径）
    └── backups/              # 该实例官方归档（默认保留 7 份）
```

- 分支命名 `instances/<name>`，GitHub UI 自动按 `instances/` 分组。
- 每个实例本地 clone 同一 repo，只操作自己的分支，结构上无法干扰他人。
- git-crypt key 为仓库级：所有实例共享（单用户多设备场景的优点）。若需每实例独立密钥 → 拆分独立仓库（不在本版本范围）。
- 加密范围：`.gitattributes` 声明敏感路径（auth/、credentials/、channels/ 等）+ `backups/*.tar.gz`——实时镜像与官方归档在仓库中均为密文。

## 5. 本地目录与数据流

### 5.1 本地布局

```
~/.openclaw/
├── gh-sync/                  # 本地 git 仓库（clone 于默认分支，checkout 到自己分支）
│   ├── .gitattributes        # git-crypt 敏感路径声明
│   ├── .gitignore            # 易变文件排除
│   ├── .git-credentials      # PAT，0600，credential helper 局部使用，绝不入库
│   └── openclaw/             # 镜像（== 远端 instances/<name>/openclaw）
└── ...（其余为被镜像的源）
```

### 5.2 推送（本地 → GitHub，秒级）

1. Watcher 捕获变更（排除 logs/**、*.tmp、*.pid、*.sock、delivery-queue/**、node_modules/**、gh-sync/ 自身等）。
2. 防抖 2s。
3. 变更文件复制进 `gh-sync/openclaw/`（增量，非全量）。
4. `git add` + `git commit` + `git push origin instances/<name>`。
5. 敏感路径（auth/、credentials/、channels/ 等）由 git-crypt filter 在 commit 时透明加密。

### 5.3 拉取（GitHub → 本地，60s 轮询）

1. `git fetch origin instances/<name>`。
2. 落后时检查本地是否有未提交变更：
   - 干净 → fast-forward → 镜像写回源路径（期间暂停 Watcher 防回环）。
   - 脏 → 不覆盖，生成 `<file>.conflict.<时间戳>` 侧车文件，交由 `conflicts` / `resolve` 命令处理。
3. 写回后恢复 Watcher。

### 5.4 归档（6h）

1. Scheduler 触发：spawn `openclaw backup create --verify`（含 SQLite 在线备份 + VACUUM，默认含 workspace）。
2. 产物 tar.gz + manifest 放入 `gh-sync/backups/`，commit + push。`.gitattributes` 中 `backups/*.tar.gz` 同样走 git-crypt filter，归档在仓库中亦为密文。
3. 保留最近 7 份，超出清理（历史归档条目从分支移除）。
4. 单文件 >95MB 自动改用 GitHub Releases API 上传。

### 5.5 恢复 / 迁移

- `restore --latest`：下载本分支最新归档 → `openclaw backup verify` 校验 → 解包到暂存目录（`~/.openclaw/gh-sync/.restore/`）→ 预览将覆盖的路径 → 确认后应用。
- `restore --from-instance <name>`：读远端 `instances/<name>` 分支的归档/镜像，用于新机器迁移。

### 5.6 运行时自动化模型

插件随 Gateway 进程运行，三个自动循环在 Gateway 存活期间持续工作：

| 循环 | 机制 | 触发时机 |
|---|---|---|
| 本地 → 远端（push） | chokidar 监听 + 2s 防抖 | 文件变化后秒级 |
| 远端 → 本地（pull） | 每 60s `git fetch` + merge + 写回 | 轮询 |
| 归档上传 | 每 6h `backup create --verify` + push | 定时 |

额外生命周期行为：

- **Gateway 启动**：先初始化对齐（fetch 远端 → merge → 写回 → 再 push 本地增量），确保启动即最新。
- **Gateway 关闭**：自动循环随之停止（进程内运行的本质）；重启时靠启动对齐补齐缺口。
- **手动兜底**：`sync-now` / `backup-now` 可随时强制执行；`status` 展示每个循环的最近运行时间与结果。

## 6. 配置（configSchema）

```
repo             GitHub 仓库 URL（https）
branch           instances/<name>（setup 自动生成）
auth             PAT（存 .git-credentials，0600，局部 credential helper）
instanceName     实例名，清洗为 [a-z0-9-]，默认取 hostname
include          实时同步顶层路径（默认整个 ~/.openclaw）
exclude          排除 glob（默认复用官方 backup 排除表 + gh-sync/ 自引用）
pushDebounceMs   2000
pollIntervalSec  60
backupIntervalH  6
backupRetain     7
gitCryptEnabled  true（未装 git-crypt 时降级：警告并跳过敏感路径实时同步）
```

## 7. CLI 命令

| 命令 | 作用 |
|---|---|
| `openclaw gh-sync setup` | 交互向导：repo + PAT + 实例名 + 参数；初始化分支并首次推送 |
| `openclaw gh-sync status` | 分支/实例名/最近同步/落后数/未推送变更/归档列表 |
| `openclaw gh-sync sync-now` | 立即推一次 + 拉一次 |
| `openclaw gh-sync backup-now` | 立即 `backup create --verify` + 上传 |
| `openclaw gh-sync restore [--latest\|--snapshot <id>\|--from-instance <name>]` | 校验 → 暂存 → 预览 → 应用 |
| `openclaw gh-sync conflicts` / `resolve` | 列出/解决 `.conflict.*` 侧车文件 |
| `openclaw gh-sync verify` | 本地镜像与源一致性校验 + 上次归档 `backup verify` |

## 8. 安全与错误处理

- PAT 权限提示：setup 向导给出最小 scope（repo）指引。
- PAT 仅存于 `gh-sync/.git-credentials`（0600），远端 URL 不含 token，`.gitignore` 排除。
- 拉取写回前暂停 Watcher（防回环）；恢复前必过 `openclaw backup verify`。
- 锁文件防并发同步；网络错误指数退避重试（3 次）；GitHub API 速率限制感知。
- 冲突一律不自动覆盖，生成侧车文件。

### 8.1 git-crypt 安装与降级流程

`openclaw plugins install` 只能安装 JS 包，无法安装 OS 二进制，因此 git-crypt 的检测与引导放在 **setup 向导**（及 `status` 展示）中：

1. setup 检测 `git-crypt` 是否可用（`git-crypt --version`）。
2. 缺失时三选一：
   - **引导安装**：打印 `brew install git-crypt` / `apt install git-crypt` 命令，暂停等待，装完继续。
   - **降级模式**：`gitCryptEnabled=false`，跳过敏感路径的实时同步（警告：auth/credentials/channels 及 backups 归档将以明文入库，仅建议私有仓库）。
   - **退出**：不配置，稍后重跑 setup。
3. `status` 命令持续显示 git-crypt 可用性与密钥状态（已 init / 未 init / 缺失）。
4. git-crypt 密钥导出指引：`git-crypt export-key` 备份密钥，密钥丢失则密文数据永久不可恢复（写入 setup 结果提示）。

## 9. 测试

- **单测**：同步条目映射、排除规则、冲突检测、`.git-credentials` 权限、实例名校验。
- **集成测试**：本地 bare 仓库模拟 GitHub——初始化、push、远端改动→pull 回写、冲突场景、git-crypt 加密后 clone 验证密文、多分支互不干扰。
- **归档测试**：mock `openclaw backup create --verify`，校验上传/保留/超限转 Releases。

## 10. 打包与发布

- npm 包 `openclaw-gh-sync`，TypeScript 编译产物。
- `npm pack` + `openclaw plugins install npm-pack:...` 本地验证；`clawhub package publish` 可选。
- 开发安装：`openclaw plugins install --link .`。

## 11. 非目标（YAGNI）

- 不做 P2P 同步（参考项目有，本插件仅 GitHub）。
- 不做 AI 自然语言技能（后续可加）。
- 不做每实例独立 git-crypt 密钥（需拆独立仓库）。
- 不做多仓库管理。
- 不做增量 WAL bundle 同步（官方 backup sqlite 明确排除在外）。

## 12. 风险与开放问题

- git-crypt 需本机安装，未装时安装引导与降级流程见 §8.1；密钥丢失则密文数据不可恢复。
- 全量实时同步（含 sessions 等高频变化目录）可能产生大量 commit——排除规则与防抖是缓解手段；若实测 commit 过频，可再缩小实时层。
- `openclaw backup create` 默认含 workspace，归档体积可能大；提供 `--only-config` 等选项映射。
- 官方 backup 的易变排除表需与实时层 exclude 保持一致，避免来回同步。

## 13. 参考

- 官方 backup 文档：`openclaw backup create/verify/sqlite`
- 插件开发：docs.openclaw.ai/plugins/building-plugins（TS ESM + definePluginEntry）
- 参考实现：dsda56180/openclaw-sync-assistant（GitHub 模式机制：镜像 + chokidar + simple-git + 冲突侧车）
