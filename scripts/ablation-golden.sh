#!/usr/bin/env bash
# The prompt-archaeology golden check of the metering proxy's layer filter, keyless, on a machine with docker. It builds the harness
# images the layer maps cover, then runs the docker golden block of tests/ablation.test.ts: each map's harness plays a
# two-turn v0.3 task with a tool-call follow-up through the runner and the proxy against the fake Messages or Responses
# endpoint, once with the filter on and nothing removed (full) and once with every layer of the map removed (minimal), and
# every agent request must match its map (no did-not-take, partial or unknown-family request), keep its tool definitions,
# and leave nothing removable behind. scripts/ubicloud/run-shard.sh runs it after bootstrap and before the smoke when the
# fan-out manifest's options name it (--pre-smoke scripts/ablation-golden.sh); a failure there means no trial runs.
#
#   bash scripts/ablation-golden.sh [--out <dir>] [--maps <map file>,<map file>] [--skip-build]
#
# --maps narrows the check to some of harnesses/ablation/manifest.json's maps (default every one); --skip-build uses the
# harness-eval/<harness>:dev images already built. Output under --out (default ~/ablation-golden): golden.log (the test
# output), build-<harness>.log, bun-install.log, and one directory per map and cell with its preregistration, the fake's
# request log and the runner's results. The tests run under env -i with only PATH, HOME and the golden settings, so no
# provider key reaches them; the proxy in capture mode holds dummy keys. The last line is "ablation-golden: pass (<n> maps,
# <s>s)" or "ablation-golden: fail (<reason>, <s>s)". Exit 0 on a pass, 3 for a failed install or image build, 4 when a
# map failed its check or the block did not run, 2 for a usage error.
set -euo pipefail
self=$(realpath "$0")
cd "$(dirname "$self")/.."
export PATH="$HOME/.bun/bin:$PATH"
# A fresh VM user is not in the docker group in this SSH session yet (bootstrap.sh's usermod); re-enter with it, as checks.sh does.
me=${USER:-$(id -un)}
if [ -z "${HE_GOLDEN_IN_DOCKER_GROUP:-}" ] && getent group docker >/dev/null && ! id -nG | grep -qw docker && id -nG "$me" | grep -qw docker; then
  export HE_GOLDEN_IN_DOCKER_GROUP=1
  exec sg docker -c "bash $(printf %q "$self")${*:+ $(printf '%q ' "$@")}"
fi

out="$HOME/ablation-golden" maps="" build=1
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out=$2; shift 2 ;;
    --maps) maps=$2; shift 2 ;;
    --skip-build) build=0; shift ;;
    -h|--help) sed -n '2,/^set -euo pipefail/{/^set /!p}' "$0"; exit 0 ;;
    *) echo "ablation-golden: unknown argument $1 (see --help)" >&2; exit 2 ;;
  esac
done
[[ -z "$maps" || "$maps" =~ ^[A-Za-z0-9._,-]+$ ]] || { echo "ablation-golden: --maps is a comma-separated list of map files in harnesses/ablation/" >&2; exit 2; }
mkdir -p "$out"
out=$(cd "$out" && pwd)
t0=$(date +%s)
log() { printf '%(%Y-%m-%dT%H:%M:%SZ)T ablation-golden: %s\n' -1 "$*"; }
fail() { log "$2"; echo "ablation-golden: fail ($2, $(( $(date +%s) - t0 ))s)"; exit "$1"; }

harnesses=$(python3 - "$maps" <<'PY'
import json, sys
wanted = [m for m in sys.argv[1].split(',') if m]
maps = json.load(open('harnesses/ablation/manifest.json'))['maps']
unknown = [m for m in wanted if m not in [x['file'] for x in maps]]
if unknown: sys.exit('ablation-golden: not in harnesses/ablation/manifest.json: ' + ', '.join(unknown))
print(' '.join(sorted({x['harness'] for x in maps if not wanted or x['file'] in wanted})))
PY
) || exit 2
n=$(python3 -c "import json,sys; w=[m for m in sys.argv[1].split(',') if m]; print(len(w) or len(json.load(open('harnesses/ablation/manifest.json'))['maps']))" "$maps")
log "commit $(git rev-parse HEAD 2>/dev/null || echo unknown), $n map(s), harnesses $harnesses, out $out"

bun install --frozen-lockfile > "$out/bun-install.log" 2>&1 || fail 3 "bun install --frozen-lockfile failed; read $out/bun-install.log"
if [ "$build" -eq 1 ]; then
  for h in $harnesses; do
    log "building harness-eval/$h:dev from harnesses/$h"
    docker build -q -t "harness-eval/$h:dev" "harnesses/$h" > "$out/build-$h.log" 2>&1 || { tail -20 "$out/build-$h.log"; fail 3 "the image build failed for $h; read $out/build-$h.log"; }
  done
fi

log "running the docker golden block of tests/ablation.test.ts"
rc=0
env -i PATH="$PATH" HOME="$HOME" HE_DOCKER=always HE_ABLATION_GOLDEN_OUT="$out" HE_ABLATION_GOLDEN_MAPS="$maps" \
  bun test tests/ablation.test.ts -t 'docker golden' --timeout 3600000 > "$out/golden.log" 2>&1 || rc=$?
passed=$(grep -c '^(pass) docker golden' "$out/golden.log" || true)
grep -E '^\((pass|fail)\) docker golden' "$out/golden.log" || true
[ "$rc" -eq 0 ] || fail 4 "the golden block failed (bun test exit $rc); read $out/golden.log"
[ "$passed" -eq "$n" ] || fail 4 "$passed of $n map checks passed (the block skips without docker); read $out/golden.log"
echo "ablation-golden: pass ($n maps, $(( $(date +%s) - t0 ))s)"
