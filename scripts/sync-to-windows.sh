#!/usr/bin/env bash
set -euo pipefail

# Sync only build/runtime files. Windows data.json is user state and is never
# overwritten by this script.
PROJECT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TARGET_DIR=${PALIMPSEST_WINDOWS_PLUGIN_DIR:-/mnt/d/8_backup/WaytotheOtherShore/.obsidian/plugins/palimpsest}

if [ ! -d "$TARGET_DIR" ] || [ -L "$TARGET_DIR" ]; then
  echo "Refusing to sync: target must be an existing normal directory: $TARGET_DIR" >&2
  exit 1
fi

for file in main.js manifest.json styles.css; do
  if [ ! -f "$PROJECT_DIR/$file" ]; then
    echo "Refusing to sync: missing WSL build file: $PROJECT_DIR/$file" >&2
    exit 1
  fi
done

if [ ! -f "$TARGET_DIR/data.json" ]; then
  echo "Refusing to sync: target data.json is missing; restore settings first." >&2
  exit 1
fi

node - "$PROJECT_DIR/manifest.json" <<'NODE'
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (manifest.id !== "palimpsest") {
  throw new Error(`Unexpected plugin id: ${manifest.id}`);
}
NODE

for file in main.js manifest.json styles.css; do
  cp -p "$PROJECT_DIR/$file" "$TARGET_DIR/$file"
done

for file in main.js manifest.json styles.css data.json; do
  test -f "$TARGET_DIR/$file"
done

printf 'Synced WSL build files to %s\n' "$TARGET_DIR"
printf 'Preserved Windows settings: %s\n' "$TARGET_DIR/data.json"
