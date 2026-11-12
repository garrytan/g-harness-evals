#!/usr/bin/env bash
# Bundles the prompt and the relevant source files, shows the size, and only sends after confirmation.
set -euo pipefail
cd "$(dirname "$0")/.."

FILES=(internal/queue/consumer.go internal/queue/consumer_test.go cmd/relay/main.go go.mod)
BUNDLE="$(mktemp -t relay-second-opinion.XXXXXX.md)"

{
  cat second-opinion/prompt.md
  for f in "${FILES[@]}"; do
    printf '\n\n--- %s ---\n\n' "$f"
    cat "$f"
  done
} > "$BUNDLE"

echo "Bundle: $BUNDLE"
echo "Files: ${FILES[*]}"
words=$(wc -w < "$BUNDLE")
chars=$(wc -c < "$BUNDLE")
echo "Size: $words words, $chars chars, roughly $(( chars / 4 )) tokens"
${PAGER:-less} "$BUNDLE"

read -r -p "Send to the model? [y/N] " answer
[ "$answer" = "y" ] || { echo "Not sent."; exit 0; }

llm -m gpt-5.5 < "$BUNDLE"
