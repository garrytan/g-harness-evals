#!/usr/bin/env bash
# The three keyless R126 checks of 2026-11-25 (internal-task): each judge-backed number checked against labels with no model in
# them. Nothing is written under docs/benchmarks/; outputs go to the scratch dir.
#
#   bash scripts/corrections/check-r126-2026-11-25.sh <scratch dir>
#
# 1. particle-swap and frontier-harness: the blind lookup reader against audit.ts's own signals.
# 2. skill-resolver: Got the skill and false suggestions rescored with construction labels (each set P request's writer
#    target or no-skill kind) and with union labels (the published set plus the writer target), through the run's own
#    analyze-sensitivity.ts, with the 7 failed-read trials counted in as in the headline; plus the same without OpenClaw.
# 3. failure-mining: unscoped_brain_search against the event-log scope counter, and the paired difference three ways.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
S=$(mkdir -p "$1" && cd "$1" && pwd)
R=docs/benchmarks/2026-11-08-skill-resolver
run() { env -i PATH="$PATH" HOME="$HOME" bun "$@"; }
cd "$ROOT"

echo "== 1. lookup readers"
run scripts/corrections/check-lookup-readers.ts

echo "== 2. skill-resolver construction labels"
run scripts/corrections/skill-resolver-construction-labels.ts --out "$S/labels"
sens() {
  local out=$1 labels=$2 astra=$3; shift 3
  run $R/results/tools/analyze-sensitivity.ts --results $R/results/merged --labels "P=$labels" --cross-family "P=$astra" \
    --duplicate-groups $R/prereg.json --judge-check $R/results/judge-check/judge-check.json --reachable $R/reachable.json \
    --set-t tasks/skill-resolver/T/tasks --uncontaminate $R/results/tools/contaminated-7-trials.txt "$@" --out "$S/$out" > /dev/null
  echo "$out: $S/$out/analysis.md"
}
sens published $R/results/sets/labels.jsonl $R/results/sets/labels-astra.jsonl
cmp "$S/published/analysis.json" $R/results/analysis-7-counted-in/analysis.json
sens construction "$S/labels/construction-labels.jsonl" "$S/labels/construction-labels-astra.jsonl"
sens construction-without-openclaw "$S/labels/construction-labels.jsonl" "$S/labels/construction-labels-astra.jsonl" --drop-trials $R/results/tools/openclaw-phase-b-trials.txt
sens union "$S/labels/union-labels.jsonl" "$S/labels/union-labels-astra.jsonl"

echo "== 3. failure-mining scope counter"
run scripts/corrections/check-failure-mining-scope.ts
