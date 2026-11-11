#!/usr/bin/env bash
# Rebuilds every number in docs/corrections/2026-11-11/ from committed receipts, keyless. Nothing under docs/benchmarks/ is
# written: scripts/corrections/failure-mining-scope.ts reads the failure-mining corpus, its labels and each paired trial's
# grade.json, and reruns scripts/failure-mining/analyze.ts's own tests on them.
#
#   bash scripts/corrections/reproduce-2026-11-11.sh <scratch dir> [--check]
#
# With --check it compares the rebuilt docs/corrections/2026-11-11/sensitivity.json with the committed one and exits 1
# when they differ. Either way it first rebuilds the failure-mining analysis and exits 1 if that differs from the
# committed results/analysis.md byte for byte, so the published figures it starts from are the committed ones.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
S=$(mkdir -p "$1" && cd "$1" && pwd)
CHECK=${2:-}
FM=docs/benchmarks/2026-11-09-failure-mining
L=$FM/results/labels
run() { env -i PATH="$PATH" HOME="$HOME" bun "$@"; }
cd "$ROOT"

run scripts/failure-mining/analyze.ts --codebook $FM/codebook.json --labels $L/particle.jsonl --out "$S/analysis" --corpus $FM/corpus \
  --sdk-labels $L/particle-sdk.jsonl --gold-a $L/gold-opus.jsonl --gold-b $L/gold-astra.jsonl --retest-a $L/particle.jsonl \
  --retest-b $L/retest-particle.jsonl --retest-opus-a $L/gold-opus.jsonl --retest-opus-b $L/retest-opus.jsonl > /dev/null
cmp "$S/analysis/analysis.md" $FM/results/analysis.md
run scripts/corrections/failure-mining-scope.ts --out "$S/sensitivity.json"
if [ "$CHECK" = --check ]; then cmp "$S/sensitivity.json" "$ROOT/docs/corrections/2026-11-11/sensitivity.json"; else echo "wrote $S/sensitivity.json"; fi
