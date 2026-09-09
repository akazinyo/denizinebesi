#!/usr/bin/env bash
set -e
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if command -v bun >/dev/null 2>&1; then
  if [ ! -d node_modules ]; then bun install; fi
  bun run dev
elif command -v npm >/dev/null 2>&1; then
  if [ ! -d node_modules ]; then npm install; fi
  npm run dev
else
  echo 'Bun veya Node.js + npm kurulu olmalı.'
  exit 1
fi
