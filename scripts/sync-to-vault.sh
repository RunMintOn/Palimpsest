#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if [ "$#" -ne 1 ]; then
  echo "Usage: bash scripts/sync-to-vault.sh /absolute/path/to/vault" >&2
  exit 1
fi
cd "$PROJECT_DIR"
exec node scripts/install-native-to-vault.mjs "$@"
