#!/usr/bin/env bash
# gh-sync 发布前检查：防止低级错误（如 dist 与 src 脱节）
# 用法：发布三连前先跑 bash scripts/check-release.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== 1. 重新构建 dist（必须与最新 src 同步）==="
npm run build

echo "=== 2. 校验 dist 关键三要素（.gitignore managed 区块）==="
grep -q "gh-sync managed start" dist/gitops.js || { echo "❌ dist/gitops.js 缺 managed 区块"; exit 1; }
grep -q "gitignoreExtras" dist/gitops.js || { echo "❌ dist/gitops.js 缺 gitignoreExtras"; exit 1; }
grep -q "local-conflict" dist/gitops.js || { echo "❌ dist/gitops.js 缺冲突副件模式"; exit 1; }
echo "✅ dist 三要素齐备"

echo "=== 3. dist 与 src 时间同步校验 ==="
for f in gitops cli realtime restore backup config; do
  s="src/$f.ts"; d="dist/$f.js"
  if [ -f "$s" ] && [ -f "$d" ] && [ "$s" -nt "$d" ]; then
    echo "❌ $d 比 $s 旧（改源码后未重建）"; exit 1
  fi
done
echo "✅ dist 与 src 同步"

echo "=== 4. 版本号三方一致（package.json / git tag / 待发布版本）==="
echo "package.json: $(grep '"version"' package.json | head -1)"
echo "最近 tag: $(git tag --sort=-creatordate | head -1)"
echo "✅ 检查完成，可以发布"
