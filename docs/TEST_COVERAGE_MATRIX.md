# gh-sync 测试覆盖矩阵（v0.6.15+，三层全覆盖）

> 规则：发布前必须跑「命令清单 ↔ e2e 用例」+「模块 ↔ 测试引用」双重对照，零盲区才算通过。
> 状态图例：⬜ 未写 / 🟡 已写未跑 / 🟢 通过 / ❌ 失败

## 第一层：命令层（9 命令 × 关键场景 e2e）

| 命令 | 关键场景 | 用例文件 | 状态 |
|---|---|---|---|
| status | 未配置/已配置输出、ahead/behind | | ⬜ |
| push | 正常推送、断网重试、超时中止 | | ⬜ |
| pull | 远端领先拉取、无变更 no-op | | ⬜ |
| sync | 自动触发链路、手动触发 | | ⬜ |
| backup | 完整备份、排除规则、保留轮转 | | ⬜ |
| restore | 真实恢复（非 dryRun）、dryRun 预览、指定快照、跨实例 | | ⬜ |
| conflicts | 制造冲突→检测→解决 | | ⬜ |
| setup | 向导正常路径、非 TTY 取消（E 回归） | | ⬜ |
| reset | 脏文件→reset→远端落地+备份断言（F 回归） | | ⬜ |

## 第二层：模块层（19 模块 × 直接测试引用）

| 模块 | 直接测试 | 状态 |
|---|---|---|
| index.ts（插件入口 createPlugin） | 需新建：onStartup 激活、插件注册、生命周期 | ⬜ |
| fsutil.ts | 需新建：mkdirp/ensureFileMode 直接单测 | ⬜ |
| 其余 17 模块 | 已有直接引用（backup/cli/config/conflicts/credentials/exclude/gitcrypt/gitops/mirror/paths/poller/realtime/restore/setup/status/types/watcher） | 🟢 |

## 第三层：功能/边界场景（PRODUCT.md 9.1 + 9.2）

| 场景 | 状态 |
|---|---|
| 空仓库首次同步（merge） | ⬜ |
| 远端已有数据 → merge / replace-local 选择 | ⬜ |
| 本地旧配置 → 新仓库重新 setup（pre-setup 备份） | ⬜ |
| 断网 push 失败 → 恢复自动补推 | ⬜ |
| 网络全断 → 30s 中止、无进程残留 | ⬜ |
| 多实例同仓库 → 分支隔离 | 🟢 |
| 备份跟随 include 配置变化 | ⬜ |
| 删除同步（本地/镜像/远端） | ⬜ |

## 审计记录

| 版本 | 命令层 | 模块层 | 场景层 | 结论 |
|---|---|---|---|---|
| v0.6.15 | 9/9 | 19/19 | 8/8 | 待补测 |
