#!/usr/bin/env bash
# Sends the leak question to a second model with only the files it needs.
# Default: preview only (what would be sent and its token count). Pass --send to actually run it.
set -euo pipefail
cd "$(dirname "$0")/.."

PROMPT="$(cat second-opinion/prompt.md)"
FILES=(--file "internal/queue/**" --file "cmd/relay/main.go" --file "go.mod" --file "!**/.env")

if [ "${1:-}" != "--send" ]; then
  oracle --dry-run summary --files-report --slug "relay goroutine leak" -p "$PROMPT" "${FILES[@]}"
  echo "Preview only. Re-run with --send to start the run."
  exit 0
fi

oracle --engine browser --model gpt-5.5-pro --slug "relay goroutine leak" -p "$PROMPT" "${FILES[@]}"
# If the run detaches or times out, do not re-run: oracle status --hours 72, then oracle session <id> --render
