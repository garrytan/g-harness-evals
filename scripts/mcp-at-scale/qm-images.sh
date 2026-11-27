#!/usr/bin/env bash
# Builds the QM images a shard's QM cells run, the way scripts/frontier-harbor/vm-run.sh builds them for its own shards:
# harnesses/qm/Dockerfile at scripts/frontier-harbor/pin.json's QM commit, the src stage as harness-eval/qm-src:<sha12>
# and core as harness-eval/qm:<sha12> (label harness-eval.commit=<sha>), and the pinned Postgres image. FrontierQm.install
# checks all three and the daemon's sha256 before a trial (HE-QM-001). With a spec, it builds nothing unless a cell is QM.
#
#   bash scripts/mcp-at-scale/qm-images.sh [<spec.json>]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
if [ -n "${1:-}" ] && ! python3 -c 'import json,sys; sys.exit(0 if any(c["variant"] == "qm" for c in json.load(open(sys.argv[1]))["cells"]) else 1)' "$1"; then
  exit 0
fi
read -r commit pg <<< "$(python3 -c 'import json,sys; h=json.load(open(sys.argv[1]))["harnesses"]["qm"]; print(h["commit"], h["postgres_image"])' "$repo/scripts/frontier-harbor/pin.json")"
cd "$repo/harnesses/qm"
docker build -q --build-arg "QM_COMMIT=$commit" --target src -t "harness-eval/qm-src:${commit:0:12}" -f Dockerfile .
docker build -q --build-arg "QM_COMMIT=$commit" -t "harness-eval/qm:${commit:0:12}" -f Dockerfile .
docker pull -q "$pg"
label=$(docker image inspect -f '{{index .Config.Labels "harness-eval.commit"}}' "harness-eval/qm:${commit:0:12}")
[ "$label" = "$commit" ] || { echo "qm-images.sh: harness-eval/qm:${commit:0:12} is labelled $label, not $commit" >&2; exit 1; }
echo "qm-images: harness-eval/qm:${commit:0:12} and harness-eval/qm-src:${commit:0:12} built at $commit; $pg pulled"
