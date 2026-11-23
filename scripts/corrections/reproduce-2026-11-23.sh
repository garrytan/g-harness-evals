#!/usr/bin/env bash
# Rebuilds every number in docs/corrections/2026-11-23/ from committed receipts, keyless. Nothing under docs/benchmarks/ is
# written: scripts/corrections/fable-diagnosis-regrade.ts reads the fable-diagnosis run's merged trial list and labels and
# docs/corrections/2026-11-23/regrade.jsonl, and reruns scripts/frontier-harbor/feature-split.ts's analysis on them.
#
#   bash scripts/corrections/reproduce-2026-11-23.sh <scratch dir> [--check]
#
# It first reruns feature-split.ts on the committed trial list and exits 1 unless its analysis.json matches the committed
# one byte for byte, so the published figures it starts from are the committed ones. With --check it then compares the
# rebuilt docs/corrections/2026-11-23/sensitivity.json with the committed one and exits 1 when they differ.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
S=$(mkdir -p "$1" && cd "$1" && pwd)
CHECK=${2:-}
RUN=docs/benchmarks/2026-11-14-fable-diagnosis
run() { env -i PATH="$PATH" HOME="$HOME" bun "$@"; }
cd "$ROOT"

run scripts/frontier-harbor/feature-split.ts --trials $RUN/results/merged/trials.jsonl --labels $RUN/labels.json --out "$S/analysis" > /dev/null
cmp "$S/analysis/analysis.json" $RUN/results/analysis/analysis.json
run scripts/corrections/fable-diagnosis-regrade.ts --out "$S/sensitivity.json"
if [ "$CHECK" = --check ]; then cmp "$S/sensitivity.json" "$ROOT/docs/corrections/2026-11-23/sensitivity.json"; else echo "wrote $S/sensitivity.json"; fi
