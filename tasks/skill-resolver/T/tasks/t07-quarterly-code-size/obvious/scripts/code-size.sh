#!/usr/bin/env bash
# Lines of code by language for this repository, for the quarterly finance report.
set -euo pipefail
cd "$(dirname "$0")/.."

EXCLUDE="node_modules,.git,dist,build,venv,.venv,__pycache__,coverage"

if command -v cloc >/dev/null 2>&1; then
  cloc --quiet --exclude-dir="$EXCLUDE" .
  exit 0
fi

# Fallback without cloc: non-blank lines per file extension.
printf "%-12s %6s %8s\n" "Language" "Files" "Lines"
for pair in "Python:py" "TypeScript:ts" "JavaScript:js" "Markdown:md"; do
  name=${pair%%:*}; ext=${pair##*:}
  files=$(find . -type f -name "*.$ext" -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./dist/*" -not -path "./build/*")
  [ -z "$files" ] && continue
  count=$(echo "$files" | wc -l | tr -d ' ')
  lines=$(echo "$files" | xargs grep -cv '^[[:space:]]*$' | awk -F: '{s+=$NF} END {print s}')
  printf "%-12s %6s %8s\n" "$name" "$count" "$lines"
done
