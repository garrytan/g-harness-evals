#!/usr/bin/env bash
# Build the gbrain sidecar image (gbrain/Dockerfile) for one gbrain commit, keyless by default (internal-task; docs/gbrain-arm.md,
# "Checking a gbrain commit"):
#
#   scripts/build-gbrain-image.sh [--gbrain <full sha or branch>] [--tag <image tag>] [--out <dir>] [--embedded] [--dry-run] [--no-cache]
#
# Default: the keyword target (gbrain at the pin in gbrain/pin.json, four keyword brains, the install bundle) tagged
# harness-eval/gbrain:dev, no key anywhere. --embedded also builds the embedded target: it starts the metering proxy on every
# interface with a scratch ledger beside the output and a $1 lease, runs the Dockerfile's builder stage as a container with
# gbrain/.build/brains/<split>-embedded bind-mounted at /brain (the path the sidecar serves from, so the PGLite store's
# recorded path relocates nowhere) and OPENAI_BASE_URL=http://host.docker.internal:<port>/gbrain-image/openai (the route only;
# the proxy holds the key on the host and meters every /v1/embeddings call), builds each bot-visible brain with
# build-brain.ts --embeddings, writes the proxy's usage summary into each brain's manifest.json, stops the proxy and builds the
# embedded target under <tag>. The docker build output goes to <out>/build.log; on failure the failing stage, the last 20 lines
# and the log path are printed under HE-GBRAIN-007 and the exit code is 2. --dry-run prints what would run and the
# prerequisites (docker, bun, the key in the shell for --embedded) without building. Only this shell's proxy process reads
# OPENAI_API_KEY; the container never sees it.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
gbrain=$(jq -r '.gbrain.commit' gbrain/pin.json)
tag=harness-eval/gbrain:dev
out=
embedded=0
dry=0
nocache=
model=$(jq -r '.embeddings.model' gbrain/pin.json)
while [ $# -gt 0 ]; do
  case "$1" in
    --gbrain) gbrain="$2"; shift 2 ;;
    --tag) tag="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --embedded) embedded=1; shift ;;
    --dry-run) dry=1; shift ;;
    --no-cache) nocache=--no-cache; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option $1 (see --help)" >&2; exit 2 ;;
  esac
done
[ -n "$out" ] || out="$root/gbrain/.build"
mkdir -p "$out"
log="$out/build.log"
proxy_pid=
cleanup() { if [ -n "$proxy_pid" ] && kill -0 "$proxy_pid" 2>/dev/null; then kill -TERM "$proxy_pid" 2>/dev/null || true; wait "$proxy_pid" 2>/dev/null || true; fi; }
trap cleanup EXIT

fail() {
  # $1: what failed. The failing stage is the last "FROM ... AS <stage>" docker printed before the error.
  local stage
  stage=$(grep -oE '^#[0-9]+ \[[a-z-]+ +[0-9]+/[0-9]+\]' "$log" 2>/dev/null | tail -1 | sed -E 's/^#[0-9]+ \[([a-z-]+) .*/\1/' || true)
  echo "HE-GBRAIN-007 $1 (gbrain $gbrain, tag $tag)${stage:+; failing stage: $stage}; last lines of $log:" >&2
  tail -20 "$log" >&2 || true
  exit 2
}

plan() {
  echo "gbrain commit/ref: $gbrain"
  echo "tag:               $tag"
  echo "output:            $out (build.log${embedded:+, ledger.sqlite, proxy-usage.ndjson, brains/<split>-embedded})"
  echo "keyword build:     docker build $nocache --build-arg GBRAIN_COMMIT=$gbrain --target keyword -t $tag -f gbrain/Dockerfile ."
  if [ "$embedded" = 1 ]; then
    echo "embedded build:    docker build --build-arg GBRAIN_COMMIT=$gbrain --target builder -t $tag-builder -f gbrain/Dockerfile ."
    echo "                   metering proxy on 0.0.0.0:<port>, ledger $out/ledger.sqlite, lease \$1, run id gbrain-image-embed-<ts>, allow-models $model"
    echo "                   docker run --rm --add-host host.docker.internal:host-gateway -e OPENAI_BASE_URL=http://host.docker.internal:<port>/gbrain-image/openai -v $out/brains/<split>-embedded:/brain $tag-builder build-brain.ts --split <split> --embeddings $model --out /brain"
    echo "                   docker build --build-arg GBRAIN_COMMIT=$gbrain --target embedded -t $tag -f gbrain/Dockerfile ."
  fi
  echo "prerequisites:"
  command -v docker >/dev/null && echo "  docker: $(docker --version)" || echo "  docker: MISSING"
  command -v bun >/dev/null && echo "  bun: $(bun --version)" || echo "  bun: MISSING"
  if [ "$embedded" = 1 ]; then
    [ -n "${OPENAI_API_KEY:-}" ] && echo "  OPENAI_API_KEY: set in this shell (read by the proxy only)" || echo "  OPENAI_API_KEY: MISSING in this shell (the proxy needs it; the container never sees it)"
  fi
}

if [ "$dry" = 1 ]; then plan; exit 0; fi
command -v docker >/dev/null || { echo "HE-GBRAIN-007 docker is not installed" >&2; exit 2; }
command -v bun >/dev/null || { echo "HE-GBRAIN-007 bun is not installed" >&2; exit 2; }
: > "$log"

echo "[build-gbrain-image] keyword target: gbrain $gbrain -> $tag (log $log)"
docker build $nocache --build-arg "GBRAIN_COMMIT=$gbrain" --target keyword -t "$tag" -f gbrain/Dockerfile . >> "$log" 2>&1 || fail "docker build of the keyword target failed"
docker run --rm --entrypoint cat "$tag" /opt/sidecar/image.json > "$out/image.json"
echo "[build-gbrain-image] keyword image $(docker image inspect -f '{{.Id}}' "$tag") gbrain $(jq -r '.gbrain_commit' "$out/image.json" | cut -c1-12) ($(jq -r '.gbrain_version' "$out/image.json"))"
[ "$embedded" = 1 ] || exit 0

[ -n "${OPENAI_API_KEY:-}" ] || { echo "HE-PROXY-001 OPENAI_API_KEY is not set in this shell; the metering proxy needs it to forward embedding calls (the container never sees it)" >&2; exit 2; }
echo "[build-gbrain-image] builder target" 
docker build --build-arg "GBRAIN_COMMIT=$gbrain" --target builder -t "$tag-builder" -f gbrain/Dockerfile . >> "$log" 2>&1 || fail "docker build of the builder target failed"

run_id="gbrain-image-embed-$(date -u +%Y%m%dT%H%M%SZ)"
ledger="$out/ledger.sqlite"
usage="$out/proxy-usage.ndjson"
port=$(bun -e 'const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() }); console.log(s.port); s.stop(true);')
bun runner/proxy/metering-proxy.ts --listen "0.0.0.0:$port" --budget-ledger "$ledger" --lease-usd 1 --run-id "$run_id" \
  --usage-log "$usage" --allow-models "$model" --new-run >> "$out/proxy.log" 2>&1 &
proxy_pid=$!
for _ in $(seq 1 100); do curl -sf "http://127.0.0.1:$port/__proxy/status" >/dev/null 2>&1 && break; sleep 0.1; done
curl -sf "http://127.0.0.1:$port/__proxy/status" >/dev/null || { echo "HE-PROXY-003 the metering proxy did not start; see $out/proxy.log" >&2; exit 2; }
echo "[build-gbrain-image] metering proxy on port $port, lease \$1 as $run_id in $ledger"

for split in dev heldout; do
  dest="$out/brains/$split-embedded"
  rm -rf "$dest" && mkdir -p "$dest"
  echo "[build-gbrain-image] embedded brain $split -> $dest"
  # The brain is built at /brain inside the container, bind-mounted from the host: the path the sidecar serves from.
  docker run --rm --user "$(id -u):$(id -g)" --add-host host.docker.internal:host-gateway \
    -e "OPENAI_BASE_URL=http://host.docker.internal:$port/gbrain-image/openai" -e HOME=/tmp \
    -v "$dest:/brain" --entrypoint bun "$tag-builder" /opt/sidecar/gbrain/build-brain.ts --split "$split" --embeddings "$model" \
    --corpus /opt/corpus --world /opt/sidecar/world/seed/world.json --out /brain --staging /tmp/staging \
    --gbrain "bun /opt/gbrain/src/cli.ts" --commit "$(jq -r '.gbrain_commit' "$out/image.json")" --corpus-commit "$(jq -r '.corpus.commit' gbrain/pin.json)" \
    >> "$log" 2>&1 || fail "build-brain.ts --embeddings for $split failed (proxy log $out/proxy.log)"
  [ -s "$dest/manifest.json" ] || fail "no manifest.json for the $split embedded brain"
done

# Close the lease and read its summary, then record the spend in each manifest.
kill -TERM "$proxy_pid"; wait "$proxy_pid" || true; proxy_pid=
summary=$(bun runner/proxy/metering-proxy.ts summary --budget-ledger "$ledger" --run-id "$run_id")
echo "[build-gbrain-image] embedding spend: $summary"
for split in dev heldout; do
  dest="$out/brains/$split-embedded"
  # Per-split usage: the usage lines carry the slot (gbrain-image) and not the split, so each manifest records the run's
  # total and the split's share by request order is not separable; the total is what the lane cap counts.
  jq --argjson s "$summary" '.embeddings.usage = {requests: $s.requests, usd: $s.committed_usd, run_id: $s.run_id, note: "whole-run total for both embedded brains, from the proxy ledger"}
     | .embeddings.usage.input_tokens = ($s.input_tokens // null)' "$dest/manifest.json" > "$dest/manifest.json.tmp" && mv "$dest/manifest.json.tmp" "$dest/manifest.json"
done
usage_tokens=$(jq -s '[.[] | select(.outcome == "forwarded") | .input_tokens // 0] | add // 0' "$usage" 2>/dev/null || echo 0)
for split in dev heldout; do
  jq --argjson t "$usage_tokens" '.embeddings.usage.input_tokens = $t' "$out/brains/$split-embedded/manifest.json" > "$out/brains/$split-embedded/manifest.json.tmp" && mv "$out/brains/$split-embedded/manifest.json.tmp" "$out/brains/$split-embedded/manifest.json"
done

echo "[build-gbrain-image] embedded target -> $tag"
docker build --build-arg "GBRAIN_COMMIT=$gbrain" --target embedded -t "$tag" -f gbrain/Dockerfile . >> "$log" 2>&1 || fail "docker build of the embedded target failed"
echo "[build-gbrain-image] embedded image $(docker image inspect -f '{{.Id}}' "$tag"); brains: $(docker run --rm --entrypoint ls "$tag" /brains | tr '\n' ' ')"
