#!/usr/bin/env bash
# Rebuilds every number in docs/corrections/2026-11-10/ from committed receipts, keyless. Nothing under docs/benchmarks/
# is written: each corrected trials.jsonl goes to a scratch directory, and the frontier run's own analyze.ts and
# subset.ts read it there through a tree of symlinks.
#
#   bash scripts/corrections/reproduce-2026-11-10.sh <scratch dir> [--check]
#
# With --check it compares the rebuilt docs/corrections/2026-11-10/sensitivity.json with the committed one and exits 1
# when they differ. Either way it first rebuilds the published Pi instruction-bug sensitivity and exits 1 if that
# differs from the committed analysis byte for byte.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
S=$(mkdir -p "$1" && cd "$1" && pwd)
CHECK=${2:-}
FR=$ROOT/docs/benchmarks/2026-11-07-frontier-harness
R=$FR/results
run() { env -i PATH="$PATH" HOME="$HOME" bun "$@"; }
links() { rm -rf "$2"; mkdir -p "$2"; for f in "$1"/*; do b=$(basename "$f"); case " $3 " in *" $b "*) ;; *) ln -s "$f" "$2/$b";; esac; done; }
an() { run scripts/frontier-harbor/analyze.ts --results "$1" --spec "$FR/analysis-spec.json" --lookup-fails "$R/lookup-fails.json" --out "$2" "${@:3}" > /dev/null; }
cd "$ROOT"

run scripts/corrections/harbor-cut.ts --results "$R" --merged "$R/merged" --out "$S/cut" > /dev/null
run scripts/corrections/harbor-cut.ts --results "$R/extension" --merged "$R/extension/merged" --out "$S/cut-ext" > /dev/null
links "$R/merged" "$S/cut-res" "trials.jsonl"; cp "$S/cut/trials.jsonl" "$S/cut-res/"
an "$S/cut-res" "$S/cut-an"
an "$S/cut-res" "$S/cut-an-allspend" --cost-with-replaced
run scripts/corrections/harbor-cut.ts --results "$R" --merged "$R/merged" --out "$S/resent" --resent-only > /dev/null
links "$R/merged" "$S/resent-res" "trials.jsonl"; cp "$S/resent/trials.jsonl" "$S/resent-res/"
an "$S/resent-res" "$S/resent-an"
run scripts/corrections/reservation-cost.ts --results "$S/cut-res" --out "$S/both" > /dev/null
links "$R/merged" "$S/both-res" "trials.jsonl"; cp "$S/both/trials.jsonl" "$S/both-res/"
an "$S/both-res" "$S/both-an"
for v in failed all; do
  run scripts/frontier-harbor/subset.ts --results "$S/cut-res" --out "$S/drop-$v" --drop-trials "$S/cut/cut-trials-$v.json" > /dev/null
  an "$S/drop-$v" "$S/drop-$v-an"
done
run scripts/frontier-harbor/subset.ts --results "$R/merged" --out "$S/pi-fail" --infra-as-fail pi:pytorch-model-recovery > /dev/null
an "$S/pi-fail" "$S/pi-fail-an"
cmp "$S/pi-fail-an/analysis.json" "$R/sensitivity-pi-instruction-bug-as-fail/analysis.json"
run scripts/corrections/tables-2026-11-10.ts --scratch "$S" --out "$S/sensitivity.json"
if [ "$CHECK" = --check ]; then cmp "$S/sensitivity.json" "$ROOT/docs/corrections/2026-11-10/sensitivity.json"; else echo "wrote $S/sensitivity.json"; fi
