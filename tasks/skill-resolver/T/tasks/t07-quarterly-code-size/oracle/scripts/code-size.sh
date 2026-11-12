#!/usr/bin/env bash
# Lines of code by language for this repository, for the quarterly finance report.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v pygount >/dev/null 2>&1; then
  pip install --break-system-packages pygount 2>/dev/null || pip install pygount
fi

pygount --format=summary \
  --folders-to-skip=".git,node_modules,venv,.venv,__pycache__,.cache,dist,build,.next,.turbo,coverage" \
  .
