#!/usr/bin/env bash
# The C4 preregistration's results-PR gate, item 3 ("A keyless check at the report's commit"): one memory-provider
# trial from these results, run through each counter the report cites for gbrain use, must show 0 model gbrain calls
# (the cell registers no gbrain MCP server). The report also cites analysis/c4-analysis.ts, whose reconciliation
# table covers every trial of every cell. Keyless; run from the repository root with a scrubbed environment:
#   env -i HOME="$HOME" PATH="$PATH" TERM=xterm bash docs/benchmarks/2026-11-03-qm-c4-told-live/results/miscount-check/run.sh
set -euo pipefail
R=docs/benchmarks/2026-11-03-qm-c4-told-live/results
D=$R/miscount-check
T=qm-c4-told-live-2026-11/qm-pi-opus-gbrain-memory-provider-mu-v03-dev/cn-01-tamsin-cold-chain-site/r1
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/trials/qm-pi-opus-gbrain-memory-provider-mu-v03-dev/cn-01-tamsin-cold-chain-site"
cp "$R/manifest.json" "$W/"
grep -F "\"trial_id\":\"$T\"" "$R/trials.jsonl" > "$W/trials.jsonl" || grep -F "\"trial_id\": \"$T\"" "$R/trials.jsonl" > "$W/trials.jsonl"
cp -r "$R/trials/qm-pi-opus-gbrain-memory-provider-mu-v03-dev/cn-01-tamsin-cold-chain-site/r1" "$W/trials/qm-pi-opus-gbrain-memory-provider-mu-v03-dev/cn-01-tamsin-cold-chain-site/"
{
  echo "commit: $(git rev-parse HEAD)"
  echo "trial: $T"
  echo "rows: $(wc -l < "$W/trials.jsonl")"
} > "$D/check.txt"
bun scripts/summarize-run.ts --results "$W" > "$D/summarize.out"
bun scripts/v03/mechanism.ts --results "$W" --tasks tasks/multiuser/v0.3/dev --provider-aware > "$D/mechanism.out"
{
  echo "summarize-run, model gbrain table row:"
  grep -F '| qm-pi-opus-gbrain-memory-provider-mu-v03-dev | 0 | 0 | 0 / 0 |' "$D/summarize.out"
  echo "summarize-run, provider line:"
  grep -F 'provider call(s)' "$D/summarize.out"
  echo "mechanism.ts --provider-aware, consumer turn by caller (model gbrain calls column):"
  grep -F '| cn-01-tamsin-cold-chain-site | qm-pi-opus-gbrain-memory-provider-mu-v03-dev |' "$D/mechanism.out"
} >> "$D/check.txt"
echo ok >> "$D/check.txt"
