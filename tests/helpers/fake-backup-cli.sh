#!/usr/bin/env bash
# fake `openclaw backup create --verify --output <dir> --json`
# usage: fake-backup-cli.sh <outputDir> <artifactName>
set -euo pipefail
out="$1"; name="$2"; mkdir -p "$out"; printf 'payload' > "$out/$name"
cat <<EOF
{"ok":true,"archive":"$out/$name"}
EOF
