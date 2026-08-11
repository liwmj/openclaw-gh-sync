# OpenClaw GitHub Sync 产品文档

> 版本：0.6.14+（master: 4f60cc0）｜适用 OpenClaw ≥ 2026.3.24，Node ≥ 22.22.3

## 1. 产品概述

OpenClaw 实时 GitHub 同步插件（`@liwmj/openclaw-gh-sync`），将本地 OpenClaw 工作区双向同步到 GitHub 仓库，同时提供定时备份与恢复能力。

**核心能力：**
- **多实例同步**：不同电脑、不同智能体共享同一套 OpenClaw 配置和记忆文件，AI 跨设备保持一致行为
- **备份与恢复**：定期打包核心资产（workspace + 配置）上传到 GitHub，误删或重装后一键恢复
- **跨实例迁移**：新环境直接从已有实例分支拉取完整状态
- **版本历史**：所有变更通过 git 提交，任意时间点可回溯

**设计原则：**
- 每个实例使用独立分支（`instances/<实例名>`），互不干扰
- 同步什么就备份什么（备份内容跟随配置的 include 目录）
- 冲突不丢数据（本地修改自动保留副本）

---

## 2. 快速开始

### 2.1 安装

```bash
# 从 clawhub 安装
openclaw plugins install clawhub:@liwmj/openclaw-gh-sync

# 或从本地包安装
openclaw plugins install /path/to/liwmj-openclaw-gh-sync-0.6.14.tgz
```

### 2.2 初始化配置

```bash
openclaw gh-sync setup
```

向导依次询问：

| 步骤 | 说明 |
|---|---|
| GitHub 仓库 | `用户名/仓库名` 或完整 URL，可为空仓库 |
| Personal Access Token | Fine-grained（Contents: Read+Write，仅指定仓库）或 Classic（repo scope） |
| 实例名称 | 小写字母/数字/连字符，最长 40 字符，对应分支 `instances/<名称>` |
| git-crypt | 可选加密，需所有设备共享密钥；未安装时可降级为明文 |

### 2.3 验证安装

```bash
openclaw plugins list          # 看到 openclaw-gh-sync 且 enabled
openclaw gh-sync status        # 显示配置信息、同步状态
```

### 2.4 首次同步

安装后插件自动开始同步：本地 workspace 变更自动推送，远端变更自动拉取。也可手动执行 `openclaw gh-sync sync` 立即完整同步一次。

---

## 3. 配置参考（config.json）

配置文件位于 `~/.openclaw/gh-sync/config.json`，由 `setup` 生成，也可手动编辑。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `repo` | — | GitHub 仓库 URL（https） |
| `branch` | — | 同步分支，如 `instances/default` |
| `instanceName` | `default` | 实例标识，`[a-z0-9-]` 最长 40 |
| `include` | `["workspace"]` | 要同步/备份的目录列表（相对 stateDir） |
| `exclude` | 内置列表 | 排除的 glob 模式（logs、node_modules、gh-sync 自身等） |
| `pushDebounceMs` | `2000` | 本地变更推送的防抖窗口（毫秒） |
| `pollIntervalSec` | `60` | 远端变更轮询间隔（秒，≥5） |
| `backupIntervalH` | `6` | 定时备份间隔（小时，≥1） |
| `backupRetain` | `10` | 备份存档保留数量 |
| `gitCryptEnabled` | `false` | 是否启用 git-crypt 加密敏感路径 |
| `syncStrategy` | `merge` | 首次/变更同步策略：`merge` 或 `replace-local` |

**备份内容规则（v0.6.14+）**：备份 = `include` 配置的目录 + `openclaw.json`（配置文件本身始终包含）。同步什么就备份什么。

---

## 4. 命令参考

| 命令 | 说明 |
|---|---|
| `openclaw gh-sync setup` | 交互式初始化/重新配置向导 |
| `openclaw gh-sync status` | 查看状态：配置、lastPushAt/lastPullAt/lastError、ahead/behind、冲突、备份 |
| `openclaw gh-sync push` | 立即推送一次 |
| `openclaw gh-sync pull` | 立即拉取一次（冲突时提示保留的本地副本） |
| `openclaw gh-sync sync` | 完整同步（拉取 + 推送） |
| `openclaw gh-sync backup` | 立即创建并上传备份存档 |
| `openclaw gh-sync restore --dry-run` | 预览恢复会变更哪些文件 |
| `openclaw gh-sync restore --yes` | 从最新备份恢复本地状态 |
| `openclaw gh-sync conflicts` | 查看未解决的冲突文件 |
| `openclaw gh-sync reset` | 清理本地同步状态 |

---

## 5. 同步逻辑

### 5.1 同步机制

```
本地 workspace ──镜像──> gh-sync/openclaw/workspace ──git commit+push──> GitHub (instances/<名> 分支)
本地 workspace <──写回── gh-sync/openclaw/workspace <──git pull/fetch── GitHub
```

- **自动推送**：本地文件变更 → 防抖 2s → 复制到镜像 → commit + push
- **自动拉取**：每 60s 轮询远端 → fast-forward 合并 → 变更复制回本地 workspace
- **删除同步**：本地/镜像/远端三处同步删除

### 5.2 覆盖与合并规则

| 场景 | 行为 |
|---|---|
| 仅本地有变更 | 自动提交推送 |
| 仅远端有变更 | 自动拉取合并 |
| 双方同改同一文件 | 自动解决：主文件取远端版本，本地版本保存为 `<文件名>.local.<时间戳>` 副本，数据不丢失；pull 日志和 CLI 会提示副本位置 |
| 首次同步 | 按 `syncStrategy`：merge（合并）或 replace-local（覆盖本地） |

### 5.3 旧配置 → 新地址（重新 setup）

本地已有旧配置时重新运行 `setup`：
- **远端已有该实例数据** → 选择 `merge`（合并）或 `replace-local`（用远端覆盖本地）
- **仓库地址变更** → 选择 `Keep local`（保留本地推送到新仓库）或 `Start fresh`（旧数据备份为 `backups/pre-setup-<时间戳>` 后全新开始）
- 任何选择都不会直接丢失旧数据（有 pre-setup 备份）

### 5.4 网络故障与自愈（v0.6.14+）

- **push 失败自动重试**：已 commit 未推送的提交会在网络恢复后自动补推（不再假死）
- **超时保护**：simple-git 层 30s 无输出自动 kill 子进程（`timeout: { block: 30000 }`，实测 TCP 无响应场景 6s 级可靠中止、0 残留）+ git transfer 阶段 30s low-speed 兜底
- **备份 push 重试**：大文件推送失败自动重试 3 次（2s/5s/10s 递增）
- 网络故障期间插件持续运行，恢复后自动补齐

---

## 6. 备份与恢复

### 6.1 备份内容（v0.6.14+）

- 只打包**核心资产**：`include` 目录（默认 workspace）+ `openclaw.json`
- 体积约几 MB（对比旧版全量 ~68MB），push 稳定、仓库不膨胀
- 不包含 tools/extensions/npm 等可重装内容

### 6.2 备份流程

1. 定时（默认 6h）或手动执行 `backup`
2. 打包核心资产 → 存入 `gh-sync/backups/` → commit + push 到仓库 `backups/` 目录
3. 按 `backupRetain` 清理旧存档（保留最近 N 份）

### 6.3 恢复

```bash
# 从本地最新备份预览
openclaw gh-sync restore --dry-run

# 确认后实际恢复
openclaw gh-sync restore --yes

# 指定快照恢复
openclaw gh-sync restore --snapshot <文件名> --yes
```

### 6.4 跨实例迁移

```bash
# 在新环境拉取旧实例的最新备份
openclaw gh-sync restore --from-instance <旧实例名> --yes
```

---

## 7. 网络受限环境

详见仓库 README「网络受限环境使用指南」章节，要点：
- **判断网络 vs 插件问题**：`gh-sync status` 查看 `lastError` / `ahead` 字段
- **镜像加速**：`git config --global url."https://gh-proxy.com/https://github.com/".insteadOf "https://github.com/"`（仅对标准 URL 生效；插件 remote 内嵌 token 时需低权限 token + 改 remote 方案，测完还原）
- **限流说明**：插件走 git 协议（fetch/push），不消耗 GitHub API 限流配额；当前频率（60s 轮询 + 变更才推送）多实例共仓无压力

---

## 8. 故障排查

| 现象 | 处理方法 |
|---|---|
| `not configured` | 运行 `openclaw gh-sync setup` |
| `repo must be an https GitHub URL` | 仓库地址改为 https 格式 |
| 空仓库/远程分支不存在 | 正常运行即可，首次推送自动创建 |
| push 失败（网络） | 插件自动重试 + 恢复后补推；观察 `gh-sync status` 的 `lastError` |
| 出现合并冲突 | 主文件取远端，本地副本为 `<文件>.local.<时间戳>`；`gh-sync conflicts` 查看 |
| 备份失败 | 检查磁盘空间与网络；查看日志中 `backup archive failed` / `push failed` |
| 找不到 git-crypt | 安装 git-crypt 或配置 `gitCryptEnabled: false` |

**日志位置**：插件日志输出到 gateway 控制台，`status` 的 `lastError` 字段记录最近一次错误。

---

## 9. 测试指南（开发/测试对齐用）

### 9.1 功能清单

- [ ] setup 向导（四步 + 校验 + 旧配置迁移场景）
- [ ] 本地变更自动 push（防抖）
- [ ] 远端变更自动 pull
- [ ] 删除同步（本地/镜像/远端）
- [ ] 冲突处理（.local 副本 + 提示）
- [ ] backup（轻量打包 + push 重试 + 保留策略）
- [ ] restore（预览 / 实际 / 指定快照 / 跨实例）
- [ ] status 字段完整
- [ ] 断网自愈（补推 + 超时中止）

### 9.2 边界场景

1. 空仓库首次同步（merge）
2. 远端已有数据 → merge / replace-local 选择
3. 本地旧配置 → 新仓库地址重新 setup（pre-setup 备份）
4. 断网时 push 失败 → 恢复后自动补推
5. 网络全断 → 30s 内中止（simple-git timeout kill 子进程）、无进程残留
6. 多实例同仓库 → 分支隔离
7. 备份跟随 include 配置变化

---

## 10. 开源许可

本项目使用 **MIT License**（Copyright 2026 Mason Lee），详见仓库 `LICENSE` 文件。
