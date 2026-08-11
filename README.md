# @liwmj/openclaw-gh-sync

OpenClaw 实时 GitHub 同步插件——将本地 OpenClaw 工作区双向同步到 GitHub 仓库，同时定时创建和上传官方备份存档。

## 它能做什么

- **多实例同步**：不同电脑、不同智能体之间共享同一套 OpenClaw 配置和记忆文件（MEMORY.md、IDENTITY.md 等），AI 跨设备保持一致行为
- **备份与恢复**：定时通过 `openclaw backup create --verify` 创建官方备份存档，上传到 GitHub 仓库。误删或重装系统后一键恢复
- **跨实例迁移**：新环境中直接从已有实例的 GitHub 分支拉取完整状态，无需手动拷贝
- **版本历史**：所有变更通过 Git 提交，随时回溯任意时间点的状态

## 快速安装

```bash
# 安装最新版
openclaw plugins install clawhub:@liwmj/openclaw-gh-sync

# 安装指定版本
openclaw plugins install clawhub:@liwmj/openclaw-gh-sync@0.1.1
```

> 要求 Node.js >= 22.22.3，OpenClaw >= 2026.3.24

## 首次配置

安装后运行初始化向导：

```bash
openclaw gh-sync setup
```

向导会依次询问四项信息：

| 步骤 | 说明 |
|---|---|
| **GitHub 仓库** | 输入 `用户名/仓库名` 即可（如 `liwmj/my-sync-repo`），插件自动补全为 `https://github.com/liwmj/my-sync-repo`。可以是空仓库 |
| **Personal Access Token** | GitHub 个人访问令牌。推荐 **Fine-grained token**：仓库权限选"Only select repositories"指定同步仓库，Contents 权限设为"Read and write"。也可用 **Classic token**：勾选 `repo` 范围即可。令牌存储在 `.git-credentials` 中（权限 0600，不会被提交到仓库） |
| **实例名称** | 当前智能体或场景的标识，如 `coding-assistant`、`writing-tutor`。只能包含小写字母、数字和连字符（最长 40 个字符）。每个实例对应仓库中独立的分支 `instances/<实例名>` |
| **git-crypt** | 可选加密方案，默认关闭。启用后敏感文件在远程仓库中加密存储。**注意**：需要所有同步设备上都安装 git-crypt 并共享同一把密钥，否则其他设备无法解密文件 |

配置完成后，每次 OpenClaw 网关启动时会自动启动同步引擎。使用 `openclaw gh-sync status` 查看运行状态。

## 自动化机制

插件在后台运行三个异步循环：

### 自动推送（Push）
本地文件变更时自动触发：
1. chokidar 文件监视器检测到变更
2. 等待 2 秒消抖（可配置），将变更文件复制到镜像目录
3. git add → commit → push 到远程仓库

### 定时拉取（Pull）
每 60 秒（可配置）检查远程变更：
1. 从远程拉取当前实例分支的最新提交
2. fast-forward 合并本地
3. 将远程变更的文件复制回本地工作区

### 定时备份（Backup）
每 6 小时（可配置）创建一次备份：
1. 调用 `openclaw backup create --verify --output <备份目录> --json` 生成存档
2. 提交并推送到仓库的 `backups/` 目录
3. 按保留数量自动清理旧存档（默认保留最近 7 个）

## 命令参考

| 命令 | 说明 |
|---|---|
| `openclaw gh-sync setup` | 交互式初始化配置向导 |
| `openclaw gh-sync status` | 查看同步状态：配置信息、连接时间戳、ahead/behind 计数、冲突文件列表、备份列表 |
| `openclaw gh-sync push` | 立即执行一次推送 |
| `openclaw gh-sync pull` | 立即执行一次拉取 |
| `openclaw gh-sync sync` | 立即执行一次完整同步（拉取 + 推送） |
| `openclaw gh-sync backup` | 立即创建并上传一份备份存档 |
| `openclaw gh-sync restore --dry-run` | 预览恢复操作会变更哪些文件 |
| `openclaw gh-sync restore --yes` | 从最新备份存档恢复本地状态 |
| `openclaw gh-sync conflicts` | 查看当前存在的合并冲突文件 |

## 恢复与迁移

### 从备份恢复

恢复本实例分支上最新的备份存档：

```bash
# 先预览
openclaw gh-sync restore --dry-run

# 确认无误后恢复
openclaw gh-sync restore --yes
```

### 从其他实例迁移

换新电脑或切换智能体时，从旧实例的分支恢复状态：

```bash
# 拉取旧智能体（如之前用的 coding-assistant）的最新备份
openclaw gh-sync restore --from-instance coding-assistant --dry-run

# 确认后执行
openclaw gh-sync restore --from-instance coding-assistant --yes
```

此操作会从远程拉取 `instances/coding-assistant` 分支，提取最新的备份存档，校验完整性后解压写入本地工作区。

### 指定快照文件恢复

```bash
openclaw gh-sync restore backup-2026-08-10.tar.gz --yes
```

## 配置参考

配置文件位置：`~/.openclaw/gh-sync/config.json`，由 `openclaw gh-sync setup` 自动生成，也可以手动编辑。

```jsonc
{
  "repo": "https://github.com/用户名/仓库名",   // 同步目标仓库（必填，仅支持 HTTPS）
  "branch": "instances/coding-assistant",        // 当前实例分支，由实例名自动生成
  "instanceName": "coding-assistant",            // 当前实例/智能体标识
  "include": ["."],                            // 要同步的目录，相对于 OpenClaw 数据目录
  "exclude": [                                 // 排除同步的 glob 模式
    "gh-sync/**",                              //   插件自身的缓存和数据不参与同步
    "logs/**",
    "**/*.log", "**/*.tmp", "**/*.pid", "**/*.sock",
    "delivery-queue/**",
    "session-delivery-queue/**",
    "cron/runs/**",
    "**/node_modules/**",
    "**/.git/**"
  ],
  "pushDebounceMs": 2000,                      // 文件变更后等待多久再提交推送（毫秒）
  "pollIntervalSec": 60,                       // 远程拉取间隔（秒），最小 5 秒
  "backupIntervalH": 6,                        // 定时备份间隔（小时），最小 1 小时
  "backupRetain": 7,                           // 保留最近多少个备份存档（超出自动删除）
  "gitCryptEnabled": false                     // 是否启用 git-crypt 加密（默认关闭）
}
```

## 为什么不同步会话记录

插件**默认不同步**原始对话历史（`*.jsonl` 文件），原因：

1. **数据膨胀**：会话文件只增不删，单个可达几十 MB，累积数百 MB 后 push 超时、仓库臃肿
2. **隐私安全**：对话记录含敏感内容，GitHub 明文存储风险高
3. **记忆已覆盖**：AI 的结构化记忆（`MEMORY.md`）会自动摘要沉淀，跨设备同步后行为一致

如需同步会话，在 `config.json` 的 `include` 中加入对应路径，并编辑 `.gitignore` 移除 `*.jsonl` 排除项。

## 仓库结构

插件在你的 GitHub 仓库中创建如下目录结构：

```
仓库根目录/
├── instances/
│   └── coding-assistant/            # 以你的实例名称命名
│       ├── config.json              # 本实例同步配置
│       ├── instance.json            # 实例元数据（名称、主机名、创建时间）
│       ├── .git-credentials         # PAT 凭证文件（不会被提交）
│       ├── openclaw/                # 镜像工作区
│       │   └── workspace/           # 你的 OpenClaw 工作区文件
│       └── backups/                 # 备份存档（.tar.gz）
└── instances/
    └── writing-tutor/               # 另一个智能体的实例分支
        └── ...

每个实例拥有独立分支，互不干扰。备份存档统一存放在各自分支的 `backups/` 目录中。

## 安全说明

- **PAT 凭证**：存储在 `.git-credentials` 文件中，权限 0600（仅所有者可读写），已加入 `.gitignore`，不会被提交到远程仓库
- **仓库 URL**：强制要求 `https://github.com/*` 格式，不允许 SSH 地址或明文密码
- **git-crypt 加密**：默认关闭。如需启用，所有同步设备必须安装 git-crypt 并共享同一把密钥，否则加密文件无法解密。导出并备份密钥：
  ```bash
  cd ~/.openclaw/gh-sync
  git-crypt export-key /安全位置/gh-sync.key
  ```
  其他设备导入：`git-crypt unlock /安全位置/gh-sync.key`

## 网络受限环境使用指南（可选）

部分地区（如中国大陆）访问 github.com 直连不稳定。本插件依赖 GitHub 仓库做同步，若遇到 push/pull 超时，可参考本节处理。

> 本节为**可选的网络加速方案**，默认安装与使用仍走 GitHub 直连，仅在直连不可用时启用。

### 判断是网络问题还是插件问题

网络抖动时插件会正常打日志并自动补推（v0.6.14 起）：

```bash
openclaw gh-sync status   # 查看 lastError / lastPushAt / ahead 字段
```

- `lastError` 有内容 → 上次操作出错（多为网络）
- `ahead > 0` 且持续不降 → 有未推送提交，网络恢复后插件会自动补推
- 若 `lastError` 持续出现连接超时，大概率是网络层问题，可考虑镜像

### 使用镜像加速（gh-proxy 等）

国内常用 GitHub 加速镜像：`gh-proxy.com`、`ghproxy.com`、`ghfast.top` 等。

```bash
# 全局配置：把所有 https://github.com/ 请求改走镜像
git config --global url."https://gh-proxy.com/https://github.com/".insteadOf "https://github.com/"

# 还原
git config --global --unset url."https://gh-proxy.com/https://github.com/".insteadOf
```

> ⚠️ **重要差异（实测）**：`insteadOf` 对**标准 URL**（`https://github.com/...`）生效，但对**内嵌 token 的 remote URL**（本插件 `setup` 生成的 `https://x-access-token:xxx@github.com/...` 格式）**不生效**。若本插件仍走直连，请改用下面的低权限 token 方案。

### 低权限 token + 镜像（推荐用于 push）

插件 remote 内嵌 token 走镜像会把 token 暴露给镜像服务商，安全风险高。如需 push 走镜像：

1. 创建一个 **fine-grained token**，仅授权要同步的仓库（Contents: Read and write）
2. 手动改 remote 为 `https://<token>@gh-proxy.com/https://github.com/<owner>/<repo>.git`（仅测试用途）
3. 测试完成后删除该 token，并把 remote 还原为插件 setup 生成的原始地址
4. 改完 remote 后记得同步确认：`openclaw gh-sync status` 应仍显示正常——插件读的是 `config.json` 的 `repo` 字段，与 git remote 不一致时以 config 为准，两者需保持一致

> 安全提醒：任何第三方镜像都可能记录流量，涉及凭据的操作请使用低权限、可随时吊销的临时 token。

### 验证镜像是否生效

```bash
# 查看当前 url 重写规则
git config --global --get-regexp "url\."

# 实测连接走哪个主机（gh-proxy.com=生效，github.com=未生效）
GIT_CURL_VERBOSE=1 git ls-remote <repo-url> 2>&1 | grep "Connected to"
```

### 测试范围提醒

配置镜像后请验证**全链路**，不能只测 clone：`clone / pull / push / backup 上传` 都要跑一遍。公共镜像常只对下载友好，push 可能失败或超时。

> 镜像稳定性依赖第三方服务，可能失效，启用后请自行验证并承担相应风险。

## 常见问题

| 现象 | 解决方法 |
|---|---|
| 提示 `not configured` | 运行 `openclaw gh-sync setup` 完成初始化配置 |
| 提示 `repo must be an https GitHub URL` | 配置中的仓库地址不是 HTTPS 格式，改为 `https://github.com/...` |
| 空仓库 / 远程分支不存在 | 正常运行即可，首次推送会自动创建分支和目录结构 |
| 出现合并冲突 | 运行 `openclaw gh-sync conflicts` 查看冲突文件。冲突文件会保留为 `.ours.<时间戳>` 和 `.theirs.<时间戳>` 副本，不会丢失数据 |
| 找不到 git-crypt | 安装 git-crypt（macOS: `brew install git-crypt`，Ubuntu: `sudo apt install git-crypt`），或在配置中将 `gitCryptEnabled` 设为 `false` |
