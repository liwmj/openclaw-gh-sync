# gh-sync 测试覆盖矩阵（v0.6.15+，三层全覆盖）

> 规则：发布前必须跑「命令清单 ↔ e2e 用例」+「模块 ↔ 测试引用」双重对照，零盲区才算通过。
> 状态图例：⬜ 未写 / 🟡 已写未跑 / 🟢 通过 / ❌ 失败
> 更新：2026-08-15（SOP 对齐整改，命令层 9/9 全绿，本地 92 用例全过）

## 第一层：命令层（9 命令 × 关键场景 e2e）

| 命令 | 关键场景 | 用例文件 | 状态 |
|---|---|---|---|
| status | 未配置/已配置输出、ahead/behind | tests/e2e-batch2.test.ts（status reports configured state）+ tests/status.test.ts | 🟢 |
| push | 正常推送、断网重试、超时中止 | tests/e2e-batch2.test.ts（断网补推）+ tests/e2e-batch3.test.ts（timeout boundary） | 🟢 |
| pull | 远端领先拉取、无变更 no-op | tests/e2e-batch2.test.ts（pull no-op）+ tests/realtime.test.ts | 🟢 |
| sync | 自动触发链路、手动触发 | tests/e2e-batch3.test.ts（sync chain） | 🟢 |
| backup | 完整备份、排除规则、保留轮转 | tests/e2e-batch2.test.ts（backup excludes *.log）+ tests/backup.test.ts | 🟢 |
| restore | 真实恢复（非 dryRun）、dryRun 预览、指定快照、跨实例 | tests/e2e-coverage.test.ts + tests/restore.test.ts | 🟢 |
| conflicts | 制造冲突→检测→解决 | tests/e2e-batch2.test.ts（conflicts）+ tests/conflicts.test.ts | 🟢 |
| setup | 向导正常路径、非 TTY 取消（E 回归） | tests/setup.test.ts + tests/e2e-batch2.test.ts（non-TTY） | 🟢 |
| reset | 脏文件→reset→远端落地+备份断言（F 回归） | tests/e2e-coverage.test.ts | 🟢 |

## 第二层：模块层（19 模块 × 直接测试引用）

| 模块 | 直接测试 | 状态 |
|---|---|---|
| index.ts（插件入口 createPlugin） | createPlugin 注册 gateway_start/stop 钩子 + gh-sync 命令树 | tests/index.test.ts | 🟢 |
| fsutil.ts | mkdirp 嵌套/幂等 + ensureFileMode noop | tests/fsutil.test.ts | 🟢 |
| 其余 17 模块 | 已有直接引用（backup/cli/config/conflicts/credentials/exclude/gitcrypt/gitops/mirror/paths/poller/realtime/restore/setup/status/types/watcher） | 🟢 |

## 第三层：功能/边界场景（PRODUCT.md 9.1 + 9.2）

| 场景 | 状态 |
|---|---|
| 空仓库首次同步（merge） | 🟢 |
| 远端已有数据 → merge / replace-local 选择 | 🟢 |
| 本地旧配置 → 新仓库重新 setup（pre-setup 备份） | 🟢 |
| 断网 push 失败 → 恢复自动补推 | 🟢 |
| 网络全断 → 30s 中止、无进程残留 | 🟢 |
| 多实例同仓库 → 分支隔离 | 🟢 |
| 备份跟随 include 配置变化 | 🟢 |
| 删除同步（本地/镜像/远端） | 🟢 |
| 首次同步远端分支不存在（aheadBehind 边界，2026-08-15 修复） | 🟢 |

## 审计记录

| 版本 | 命令层 | 模块层 | 场景层 | 结论 |
|---|---|---|---|---|
| v0.6.15 | 3/9 已绿（restore/reset 命令层） | 19/19（index/fsutil 已补） | 1/8 已绿（空仓库首同步） | 补测中，测试1号第二批 |
| v0.6.19+ | 9/9 全绿 | 19/19 | 9/9 全绿 | SOP 对齐整改：CI 修复（aheadBehind 边界）+ lint/format 门禁 + README/docs 补齐 |
