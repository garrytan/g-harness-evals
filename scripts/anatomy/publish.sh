#!/usr/bin/env bash
# Publishes anatomy captures (scripts/anatomy/capture.ts output dirs) into
# docs/harness-anatomy: one record per capture from dissect.ts, the capture's
# metadata and token counts beside it, and the request log packed as
# content-addressed receipts by store.ts.
#
#   bash scripts/anatomy/publish.sh <capture dir>...
#
# ANATOMY_OUT overrides the output directory (the tests use it).
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="${ANATOMY_OUT:-$root/docs/harness-anatomy}"
for dir in "$@"; do
  id="$(basename "$dir")"
  harness="$(jq -r .harness "$dir/capture.json")"
  config="$(jq -r .config "$dir/capture.json")"
  scenario="$(jq -r '.scenario + (if .gbrain then "-gbrain" else "" end)' "$dir/capture.json")"
  rec="$out/records/$harness-$config"
  mkdir -p "$rec" "$out/receipts/$id"
  bun "$root/scripts/anatomy/dissect.ts" --log "$dir/fake.ndjson" --harness "$harness" --config "$config" --out "$rec/$scenario.json" > /dev/null
  cp "$dir/capture.json" "$out/receipts/$id/capture.json"
  for f in tokens.json egress.ndjson script.json; do
    if [ -f "$dir/$f" ]; then cp "$dir/$f" "$out/receipts/$id/$f"; fi
  done
  if [ -f "$dir/run/proxy-usage.ndjson" ]; then cp "$dir/run/proxy-usage.ndjson" "$out/receipts/$id/proxy-usage.ndjson"; fi
  bun "$root/scripts/anatomy/store.ts" pack --log "$dir/fake.ndjson" --dir "$out/receipts/$id"
  echo "PUBLISH: $id -> records/$harness-$config/$scenario.json"
done
