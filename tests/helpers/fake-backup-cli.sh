#!/usr/bin/env bash
# fake `openclaw` backup/verify CLI for tests.
# - verify subcommand: exits 0 with ok json (GH_SYNC_BACKUP_CLI override).
# - create subcommand: produces a real tar.gz so RestoreEngine's tar -xzf works.
# accepts either the full openclaw arg vector or positional <outputDir> [name].
set -euo pipefail
for a in "$@"; do
  if [[ "$a" == "verify" ]]; then
    echo '{"ok":true}'
    exit 0
  fi
done
out=""
name="backup-e2e.tar.gz"
positional=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) out="$2"; shift 2 ;;
    --json|--verify|backup|create) shift ;;
    *) positional+=("$1"); shift ;;
  esac
done
if [[ -z "$out" ]]; then
  out="${positional[0]}"
  name="${positional[1]:-$name}"
fi
mkdir -p "$out"
archive="$out/$name"
staging=$(mktemp -d)
mkdir -p "$staging/openclaw/workspace"
printf 'restored' > "$staging/openclaw/workspace/restored.txt"
tar -czf "$archive" -C "$staging" .
rm -rf "$staging"
echo "{\"ok\":true,\"archive\":\"$archive\"}"
