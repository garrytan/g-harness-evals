#!/usr/bin/env bash
# Rebuilds every sensitivity row in docs/corrections/2026-11-09/ from committed receipts, keyless. Nothing under
# docs/benchmarks/ is written: each rule's regraded trials.jsonl goes to a scratch directory, and each run's own
# analysis script reads it there through a tree of symlinks.
#
#   bash scripts/corrections/reproduce-2026-11-09.sh <scratch dir> [--check]
#
# With --check it compares the rebuilt docs/corrections/2026-11-09/sensitivity.json with the committed one and exits 1
# when they differ. Needs the v0.3.1 task set (tasks/multiuser/v0.3.1/).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
S=$(mkdir -p "$1" && cd "$1" && pwd)
CHECK=${2:-}
B=$ROOT/docs/benchmarks
MU=$B/2026-11-04-matrix-mu
HZ=$B/2026-11-06-harness-zero-h2h
FR=$B/2026-11-07-frontier-harness
run() { env -i PATH="$PATH" HOME="$HOME" bun "$@"; }
links() { rm -rf "$2"; mkdir -p "$2"; for f in "$1"/*; do b=$(basename "$f"); case " $3 " in *" $b "*) ;; *) ln -s "$f" "$2/$b";; esac; done; }

matrix() { # name trials
  links "$MU/results" "$S/$1-res" "trials.jsonl"; cp "$2" "$S/$1-res/trials.jsonl"
  (cd "$ROOT" && run scripts/matrix-analysis.ts --results "$S/$1-res" --spec "$MU/matrix-spec.json" --out "$S/$1-an" > "$S/$1-an.log" 2>&1)
  local X=$S/$1-x/docs/benchmarks/2026-11-04-matrix-mu; rm -rf "$S/$1-x"; mkdir -p "$X/results"; cp "$MU/matrix-spec.json" "$X/"
  # report-extras.ts (committed with the run) prices a trial at usage.usd, so its interval sees usage.usd_reserved only
  # when that is taken out of usd first; matrix-analysis.ts reads usd_reserved itself.
  python3 -c 'import json,sys
for l in open(sys.argv[1]):
    t=json.loads(l); u=t.get("usage") or {}
    if u.get("usd_reserved"): u["usd"]=u["usd"]-u["usd_reserved"]
    print(json.dumps(t))' "$2" > "$X/results/trials.jsonl"
  (cd "$S/$1-x" && run "$MU/report-extras.ts" > /dev/null)
}
h2h() { # name trials
  local X=$S/$1-x; rm -rf "$X"; local T=$X/docs/benchmarks/2026-11-06-harness-zero-h2h; mkdir -p "$T"
  for d in runner scripts node_modules package.json tsconfig.json world tasks; do ln -s "$ROOT/$d" "$X/$d"; done
  cp "$HZ/report-extras.ts" "$T/"; links "$HZ/results" "$T/results" "trials.jsonl report-extras.json verdicts.md"; cp "$2" "$T/results/trials.jsonl"
  (cd "$X" && run "$T/report-extras.ts" > /dev/null)
}
cd "$ROOT"
for rule in withhold v031 both; do
  run scripts/corrections/regrade-sensitivity.ts --results "$MU/results" --rule $rule --out "$S/mu-$rule" > /dev/null
  run scripts/corrections/regrade-sensitivity.ts --results "$HZ/results" --rule $rule --out "$S/hz-$rule" > /dev/null
done
run scripts/corrections/relay-conflict.ts --results "$MU/results" --out "$S/mu-relay" > /dev/null
run scripts/corrections/relay-conflict.ts --results "$HZ/results" --out "$S/hz-relay" > /dev/null
run scripts/corrections/reservation-cost.ts --results "$MU/results" --out "$S/mu-reserved" --layout matrix > /dev/null
run scripts/corrections/reservation-cost.ts --results "$FR/results/merged" --out "$S/fr-reserved" > /dev/null
run scripts/corrections/reservation-cost.ts --results "$FR/results/extension/merged" --out "$S/frx-reserved" > /dev/null
run scripts/corrections/turn-time.ts --results "$MU/results" --out "$S/mu-time.json" > /dev/null
run scripts/corrections/turn-time.ts --results "$HZ/results" --out "$S/hz-time.json" > /dev/null
for n in withhold v031 both; do matrix mu-$n "$S/mu-$n/trials.jsonl"; h2h hz-$n "$S/hz-$n/trials.jsonl"; done
matrix mu-relay "$S/mu-relay/trials.jsonl"; h2h hz-relay "$S/hz-relay/trials.jsonl"
matrix mu-reserved "$S/mu-reserved/trials.jsonl"
links "$FR/results/merged" "$S/fr-reserved-res" "trials.jsonl"; cp "$S/fr-reserved/trials.jsonl" "$S/fr-reserved-res/"
links "$FR/results/extension/merged" "$S/frx-reserved-res" "trials.jsonl"; cp "$S/frx-reserved/trials.jsonl" "$S/frx-reserved-res/"
run scripts/frontier-harbor/analyze.ts --results "$S/fr-reserved-res" --spec "$FR/analysis-spec.json" --lookup-fails "$FR/results/lookup-fails.json" --out "$S/fr-reserved-an" > /dev/null
run scripts/frontier-harbor/analyze.ts --results "$S/frx-reserved-res" --spec "$FR/analysis-spec-extension.json" --out "$S/frx-reserved-an" > /dev/null
run scripts/corrections/tables-2026-11-09.ts --scratch "$S" --out "$S/sensitivity.json"
if [ "$CHECK" = --check ]; then cmp "$S/sensitivity.json" "$ROOT/docs/corrections/2026-11-09/sensitivity.json"; else echo "wrote $S/sensitivity.json"; fi
