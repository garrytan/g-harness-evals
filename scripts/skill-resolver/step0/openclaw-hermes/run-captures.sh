#!/bin/bash
# internal-task Step 0: keyless captures of the catalog probe images against the repository's fake endpoints, one per
# harness x provider x configuration, plus the harness's own skill list commands in the same image (no network).
#   scripts/skill-resolver/step0/openclaw-hermes/run-captures.sh [out dir, default ~/.capy/work/internal-task/step0] [cells as h:p:c ...]
set -uo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
out=${1:-$HOME/.capy/work/internal-task/step0}
shift || true
cells=("$@")
if [ ${#cells[@]} -eq 0 ]; then
  for h in openclaw hermes; do for p in anthropic openai; do for c in native names-only no-bundled; do cells+=("$h:$p:$c"); done; done; done
fi
for cell in "${cells[@]}"; do
  IFS=: read -r h p c <<< "$cell"
  model=claude-opus-5-5; [ "$p" = openai ] && model=gpt-6.1-sol
  dir="$out/$h-$p-$c"
  if [ ! -s "$dir/capture.json" ]; then
    (cd "$root" && bun scripts/anatomy/capture.ts --harness "$h" --scenario plain --image "harness-eval/$h:step0-$c" \
      --provider "$p" --model "$model" --egress off --out "$dir" 2>&1 | tail -1)
  fi
  mkdir -p "$dir/list" && chmod 777 "$dir/list"
  docker run --rm --network none -e HE_SESSION_STATE_DIR=/harness-state -e HE_LOG_DIR=/he-logs \
    -e "HE_MODEL_BASE_URL=http://127.0.0.1:9/step0/$p" -e HE_MODEL_API_KEY=step0-dummy -e "HE_MODEL_NAME=$model" \
    -v "$dir/list:/he-logs" "harness-eval/$h:step0-$c" list
  echo "LISTED $cell"
done
