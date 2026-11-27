#!/usr/bin/env bash
# Keyless egress check for the MCP-at-scale cells (internal-task): one listing-map trial per harness at the 300 rung of the
# committed catalog snapshot, every trial in scripts/frontier-harbor/egress.py BlocklistDockerEnvironment, so the gost
# egress sidecar and the catalog host sidecar run in the same compose project. Needs a kernel with nftables fib inet,
# which the Capy machine lacks, so it runs on a Ubicloud VM after scripts/ubicloud/bootstrap.sh:
#
#   UBI_OWNER=<thread> UBI_TTL_HOURS=2 ubi-runner.sh run -s standard-8 --setup scripts/ubicloud/bootstrap.sh \
#       --pull egress-out:<local dir> -- bash scripts/mcp-at-scale/egress-check.sh
#
# Harbor comes from the hashed lock file, and the QM images from qm-images.sh, since QM is one of the harnesses listed. No
# key is read: the model side is listing-map.ts's fake upstream. The results
# (listing-map.json, every trial's outcomes.json, catalog-calls.jsonl, mcp-ready.json and job logs) are copied to
# ~/egress-out. It fails closed: exit 1 when the listing run failed, when listing-map.json or listing-run.json is missing,
# or when a job has no usable verifier and selected-model request evidence.
set -euo pipefail
[ -f scripts/mcp-at-scale/listing-map.ts ] || { echo "egress-check: run from the repository root" >&2; exit 2; }
export DEBIAN_FRONTEND=noninteractive
sudo apt-get install -y -q python3-venv >/dev/null
venv=$HOME/he-harbor-venv
[ -x "$venv/bin/harbor" ] || { python3 -m venv "$venv" && "$venv/bin/pip" install -q --require-hashes --only-binary :all: -r scripts/frontier-harbor/harbor-requirements.txt; }
"$HOME/.bun/bin/bun" install --frozen-lockfile >/dev/null
out=$HOME/egress-run
rm -rf "$out" "$HOME/egress-out"
sg docker -c "env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=$HOME bash scripts/mcp-at-scale/qm-images.sh"
listing=0
sg docker -c "env -i PATH=$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin HOME=$HOME TZ=UTC $HOME/.bun/bin/bun scripts/mcp-at-scale/listing-map.ts run --venv $venv --egress --catalog tasks/mcp-at-scale/catalog --rungs 300 --out $out --concurrency ${HE_EGRESS_CONCURRENCY:-3}" 2>&1 | tee "$out.log" || listing=$?
mkdir -p "$HOME/egress-out"
cp "$out.log" "$HOME/egress-out/run.log"
cp "$out"/listing-map.json "$out"/listing-run.json "$HOME/egress-out/" 2>/dev/null || true
for t in "$out"/jobs/*/*/; do
  [ -d "$t" ] || continue
  d="$HOME/egress-out/trials/$(basename "$(dirname "$t")")"
  mkdir -p "$d"
  cp "$t"verifier/outcomes.json "$t"verifier/catalog-calls.jsonl "$t"agent/mcp-ready.json "$t"trial.log "$d/" 2>/dev/null || true
  cp "$t"result.json "$d/" 2>/dev/null || true
done
cp -r "$out"/logs "$HOME/egress-out/job-logs" 2>/dev/null || true
problems=()
[ "$listing" -eq 0 ] || problems+=("the listing run exited $listing")
for f in listing-map.json listing-run.json; do [ -s "$HOME/egress-out/$f" ] || problems+=("no $f"); done
if [ -s "$HOME/egress-out/listing-run.json" ]; then
  listed=$(python3 -c 'import json, sys; print("\n".join(j["job"] for j in json.load(open(sys.argv[1]))["jobs"]))' "$HOME/egress-out/listing-run.json") || problems+=("listing-run.json is unreadable")
  [ -n "${listed:-}" ] || problems+=("listing-run.json names no job")
  for j in ${listed:-}; do
    [ -s "$HOME/egress-out/trials/$j/outcomes.json" ] && [ -s "$HOME/egress-out/trials/$j/catalog-calls.jsonl" ] || problems+=("job $j left no outcomes.json and catalog-calls.jsonl")
  done
fi
if [ "${#problems[@]}" -eq 0 ]; then
  python3 - "$HOME/egress-out" <<'PY' || problems+=("listing evidence could not be verified")
import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
jobs = [r["job"] for r in json.loads((out / "listing-run.json").read_text())["jobs"]]
rows = json.loads((out / "listing-map.json").read_text())["rows"]
if sorted(r["job"] for r in rows) != sorted(jobs) or len(set(jobs)) != len(jobs):
    sys.exit("egress-check: listing-map rows do not match the job roster")
for row in rows:
    evidence = json.loads((out / "trials" / row["job"] / "outcomes.json").read_text())
    if row["infra"] is not None or evidence["infra"] is not None or not row.get("first_request_chars") or not (evidence.get("ready") or {}).get("ok"):
        sys.exit(f"egress-check: job {row['job']} lacks a usable verifier outcome or selected-model request")
PY
fi
if [ ${#problems[@]} -gt 0 ]; then
  printf 'egress-check: FAILED: %s\n' "${problems[@]}" >&2
  exit 1
fi
echo "egress-check: done"
