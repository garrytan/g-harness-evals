#!/usr/bin/env bash
# Keyless egress check for the MCP-at-scale cells (internal-task): one listing-map trial per harness at the 300 rung of the
# committed catalog snapshot, every trial in scripts/frontier-harbor/egress.py BlocklistDockerEnvironment, so the gost
# egress sidecar and the catalog host sidecar run in the same compose project. Needs a kernel with nftables fib inet,
# which the Capy machine lacks, so it runs on a Ubicloud VM after scripts/ubicloud/bootstrap.sh:
#
#   UBI_OWNER=<thread> UBI_TTL_HOURS=2 ubi-runner.sh run -s standard-8 --setup scripts/ubicloud/bootstrap.sh \
#       --pull egress-out:<local dir> -- bash scripts/mcp-at-scale/egress-check.sh
#
# Harbor comes from the hashed lock file. No key is read: the model side is listing-map.ts's fake upstream. The results
# (listing-map.json, every trial's outcomes.json, mcp-ready.json and job logs) are copied to ~/egress-out.
set -euo pipefail
[ -f scripts/mcp-at-scale/listing-map.ts ] || { echo "egress-check: run from the repository root" >&2; exit 2; }
export DEBIAN_FRONTEND=noninteractive
sudo apt-get install -y -q python3-venv >/dev/null
venv=$HOME/he-harbor-venv
[ -x "$venv/bin/harbor" ] || { python3 -m venv "$venv" && "$venv/bin/pip" install -q --require-hashes --only-binary :all: -r scripts/frontier-harbor/harbor-requirements.txt; }
"$HOME/.bun/bin/bun" install --frozen-lockfile >/dev/null
out=$HOME/egress-run
rm -rf "$out" "$HOME/egress-out"
sg docker -c "env -i PATH=$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin HOME=$HOME TZ=UTC $HOME/.bun/bin/bun scripts/mcp-at-scale/listing-map.ts run --venv $venv --egress --catalog tasks/mcp-at-scale/catalog --rungs 300 --out $out --concurrency ${HE_EGRESS_CONCURRENCY:-3}" 2>&1 | tee "$out.log" || true
mkdir -p "$HOME/egress-out"
cp "$out.log" "$HOME/egress-out/run.log"
cp "$out"/listing-map.json "$out"/listing-run.json "$HOME/egress-out/" 2>/dev/null || true
for t in "$out"/jobs/*/*/; do
  [ -d "$t" ] || continue
  d="$HOME/egress-out/trials/$(basename "$(dirname "$t")")"
  mkdir -p "$d"
  cp "$t"verifier/outcomes.json "$t"agent/mcp-ready.json "$t"trial.log "$d/" 2>/dev/null || true
  cp "$t"result.json "$d/" 2>/dev/null || true
done
cp -r "$out"/logs "$HOME/egress-out/job-logs" 2>/dev/null || true
echo "egress-check: done"
