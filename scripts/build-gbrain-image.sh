#!/usr/bin/env bash
# Build the gbrain sidecar image (gbrain/Dockerfile) for one gbrain commit, keyless by default (docs/gbrain-arm.md,
# "Checking a gbrain commit"):
#
#   scripts/build-gbrain-image.sh [--gbrain <full sha or branch>] [--tag <image tag>] [--out <dir>] [--embedded] [--dry-run] [--no-cache]
#                                 [--sealed-root <dir>]
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
#
# --sealed-root <dir> (docs/sealed-custody.md) builds the keyword target from a custodian's sealed root, the
# directory scripts/sealed/open.ts writes outside any checkout: <dir>/world/world.json replaces the public world and
# <dir>/corpus/heldout/ replaces the public heldout corpus pages. The script refuses a root inside this checkout and refuses
# --embedded (the embedded brains are built inside the checkout's gbrain/.build, not supported for sealed sets yet). It
# computes the world's sha256 and the corpus digest and compares them with the root's opening-receipt.json (world_sha256,
# heldout_corpus_sha256); a mismatch is exit 2 under HE-SEALED-005. The build then gets the two directories as BuildKit named
# contexts, both digests as build arguments (the Dockerfile checks them again) and the label harness-eval.sealed=true.
# A sealed image is tagged harness-eval/gbrain:sealed-<run_id of the receipt>: the public default tag is replaced by it and
# any other tag is refused, so a plaintext run on this machine never picks up the sealed brains.
# The docker build output then goes to <dir>/logs/build-gbrain-image.log, and a failure prints the stage and that path,
# never the log's last lines (docs/sealed-custody.md, "What may print").
# --dry-run prints the paths and digests, never file contents. The image is never pushed: an image built with --sealed-root
# holds the plaintext heldout corpus and stays on the machine that built it.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
gbrain=$(jq -r '.gbrain.commit' gbrain/pin.json)
tag=harness-eval/gbrain:dev
out=
embedded=0
dry=0
nocache=
sealed_root=
sealed_args=()
model=$(jq -r '.embeddings.model' gbrain/pin.json)
# The installer rung: the hermes installer's SOUL.md seed is Hermes's own file at the pinned Hermes commit, checked by sha256 in the build.
hermes_args=(--build-arg "HERMES_COMMIT=$(jq -r '.commit' harnesses/hermes/pin.json)" --build-arg "HERMES_SOUL_SHA256=$(jq -r '.soul_md.sha256' harnesses/hermes/pin.json)")
while [ $# -gt 0 ]; do
  case "$1" in
    --gbrain) gbrain="$2"; shift 2 ;;
    --tag) tag="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --embedded) embedded=1; shift ;;
    --dry-run) dry=1; shift ;;
    --no-cache) nocache=--no-cache; shift ;;
    --sealed-root) sealed_root="$2"; shift 2 ;;
    -h|--help) sed -n '2,/^set -euo pipefail/{/^set /!p}' "$0"; exit 0 ;;
    *) echo "unknown option $1 (see --help)" >&2; exit 2 ;;
  esac
done
if [ -n "$sealed_root" ]; then
  [ "$embedded" = 0 ] || { echo "build-gbrain-image: --sealed-root does not work with --embedded: the embedded brains are built inside the checkout's gbrain/.build and are not supported for sealed sets yet (docs/sealed-custody.md)" >&2; exit 2; }
  [ -d "$sealed_root" ] || { echo "build-gbrain-image: --sealed-root $sealed_root is not a directory" >&2; exit 2; }
  sealed_root=$(cd "$sealed_root" && pwd -P)
  case "$sealed_root/" in "$(pwd -P)/"*) echo "build-gbrain-image: the sealed root $sealed_root is inside the checkout $(pwd -P); sealed plaintext stays outside any git checkout (docs/sealed-custody.md)" >&2; exit 2 ;; esac
  for need in world/world.json opening-receipt.json; do [ -f "$sealed_root/$need" ] || { echo "build-gbrain-image: the sealed root $sealed_root has no $need" >&2; exit 2; }; done
  [ -d "$sealed_root/corpus" ] || { echo "build-gbrain-image: the sealed root $sealed_root has no corpus/ directory" >&2; exit 2; }
  sealed_world=$(sha256sum "$sealed_root/world/world.json" | cut -d' ' -f1)
  sealed_corpus=$(cd "$sealed_root/corpus" && find . -type f -printf '%P\n' | LC_ALL=C sort | xargs -r -d '\n' sha256sum | sha256sum | cut -d' ' -f1)
  receipt_world=$(jq -r '.world_sha256 // empty' "$sealed_root/opening-receipt.json")
  receipt_corpus=$(jq -r '.heldout_corpus_sha256 // empty' "$sealed_root/opening-receipt.json")
  [ "$sealed_world" = "$receipt_world" ] || { echo "HE-SEALED-005 $sealed_root/world/world.json has sha256 $sealed_world, the opening receipt records world_sha256 ${receipt_world:-none}" >&2; exit 2; }
  [ "$sealed_corpus" = "$receipt_corpus" ] || { echo "HE-SEALED-005 $sealed_root/corpus has digest $sealed_corpus, the opening receipt records heldout_corpus_sha256 ${receipt_corpus:-none}" >&2; exit 2; }
  # A sealed image never takes the public tag: a plaintext run on this machine would otherwise read the sealed brains.
  sealed_run_id=$(jq -r '.run_id // empty' "$sealed_root/opening-receipt.json")
  [[ "$sealed_run_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$ ]] || { echo "build-gbrain-image: the opening receipt in $sealed_root names no usable run_id" >&2; exit 2; }
  [ "$tag" != harness-eval/gbrain:dev ] || tag="harness-eval/gbrain:sealed-$sealed_run_id"
  [ "$tag" = "harness-eval/gbrain:sealed-$sealed_run_id" ] || { echo "build-gbrain-image: a --sealed-root build is tagged harness-eval/gbrain:sealed-$sealed_run_id, never $tag" >&2; exit 2; }
  sealed_args=(--build-context "world-input=$sealed_root/world" --build-context "heldout-corpus=$sealed_root/corpus"
    --build-arg "SEALED_WORLD_SHA256=$sealed_world" --build-arg "SEALED_CORPUS_SHA256=$sealed_corpus" --label harness-eval.sealed=true)
fi
[ -n "$out" ] || out="$root/gbrain/.build"
mkdir -p "$out"
# The Dockerfile's embedded target copies the brains from gbrain/.build/brains inside the build context, whatever --out is;
# --out gets a copy of each brain beside its logs once the image is built.
brains="$root/gbrain/.build/brains"
log="$out/build.log"
# A sealed build's docker output can name sealed corpus pages, so its log stays in the sealed root and is never printed.
if [ -n "$sealed_root" ]; then mkdir -p "$sealed_root/logs"; log="$sealed_root/logs/build-gbrain-image.log"; fi
proxy_pid=
cleanup() { if [ -n "$proxy_pid" ] && kill -0 "$proxy_pid" 2>/dev/null; then kill -TERM "$proxy_pid" 2>/dev/null || true; wait "$proxy_pid" 2>/dev/null || true; fi; }
trap cleanup EXIT

fail() {
  # $1: what failed. The failing stage is the last "FROM ... AS <stage>" docker printed before the error.
  local stage
  stage=$(grep -oE '^#[0-9]+ \[[a-z-]+ +[0-9]+/[0-9]+\]' "$log" 2>/dev/null | tail -1 | sed -E 's/^#[0-9]+ \[([a-z-]+) .*/\1/' || true)
  if [ -n "$sealed_root" ]; then
    echo "HE-GBRAIN-007 $1 (gbrain $gbrain, tag $tag)${stage:+; failing stage: $stage}; the build log is $log (custody only: a sealed build's log is never printed)" >&2
    exit 2
  fi
  echo "HE-GBRAIN-007 $1 (gbrain $gbrain, tag $tag)${stage:+; failing stage: $stage}; last lines of $log:" >&2
  tail -20 "$log" >&2 || true
  exit 2
}

plan() {
  echo "gbrain commit/ref: $gbrain"
  echo "tag:               $tag"
  echo "output:            $out (build.log${embedded:+, ledger.sqlite, proxy-usage.ndjson, brains/<split>-embedded})"
  [ -z "$sealed_root" ] || echo "sealed root:       $sealed_root (world_sha256 $sealed_world, heldout_corpus_sha256 $sealed_corpus, both match opening-receipt.json)"
  echo "keyword build:     docker build $nocache --build-arg GBRAIN_COMMIT=$gbrain ${hermes_args[*]}${sealed_root:+ ${sealed_args[*]}} --target keyword -t $tag -f gbrain/Dockerfile ."
  if [ "$embedded" = 1 ]; then
    echo "embedded build:    docker build --build-arg GBRAIN_COMMIT=$gbrain --target builder -t $tag-builder -f gbrain/Dockerfile ."
    echo "                   metering proxy on <docker bridge gateway>:<port> with the gbrain-image slot bound, ledger $out/ledger.sqlite, lease \$1, run id gbrain-image-embed-<ts>, allow-models $model"
    echo "                   docker run --rm --add-host host.docker.internal:host-gateway -e OPENAI_BASE_URL=http://host.docker.internal:<port>/gbrain-image/openai -v gbrain/.build/brains/<split>-embedded:/brain $tag-builder build-brain.ts --split <split> --embeddings $model --out /brain"
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

echo "[build-gbrain-image] keyword target: gbrain $gbrain -> $tag (log $log)${sealed_root:+, sealed root $sealed_root}"
docker build $nocache --build-arg "GBRAIN_COMMIT=$gbrain" "${hermes_args[@]}" ${sealed_args[@]+"${sealed_args[@]}"} --target keyword -t "$tag" -f gbrain/Dockerfile . >> "$log" 2>&1 || fail "docker build of the keyword target failed"
docker run --rm --entrypoint cat "$tag" /opt/sidecar/image.json > "$out/image.json"
echo "[build-gbrain-image] keyword image $(docker image inspect -f '{{.Id}}' "$tag") gbrain $(jq -r '.gbrain_commit' "$out/image.json" | cut -c1-12) ($(jq -r '.gbrain_version' "$out/image.json"))"
[ "$embedded" = 1 ] || exit 0

[ -n "${OPENAI_API_KEY:-}" ] || { echo "HE-PROXY-001 OPENAI_API_KEY is not set in this shell; the metering proxy needs it to forward embedding calls (the container never sees it)" >&2; exit 2; }
echo "[build-gbrain-image] builder target" 
docker build --build-arg "GBRAIN_COMMIT=$gbrain" --target builder -t "$tag-builder" -f gbrain/Dockerfile . >> "$log" 2>&1 || fail "docker build of the builder target failed"

run_id="gbrain-image-embed-$(date -u +%Y%m%dT%H%M%SZ)"
ledger="$out/ledger.sqlite"
usage="$out/proxy-usage.ndjson"
# The proxy listens on the docker bridge gateway (what host.docker.internal resolves to in the build container), never on
# every interface, with a control token; the build's slot is bound before the first call, since the proxy forwards
# nothing for an unbound slot (2026-10-28).
gateway=${HE_CONTAINER_HOST_IP:-$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')}
[[ "$gateway" =~ ^[0-9]+(\.[0-9]+){3}$ ]] && [ "$gateway" != 0.0.0.0 ] || fail "HE-PROXY-004 docker network inspect bridge gave no gateway address ('$gateway'); set HE_CONTAINER_HOST_IP"
port=$(bun -e 'const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() }); console.log(s.port); s.stop(true);')
control=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
bun runner/proxy/metering-proxy.ts --listen "$gateway:$port" --budget-ledger "$ledger" --lease-usd 1 --run-id "$run_id" \
  --usage-log "$usage" --allow-models "$model" --new-run --control-token "$control" >> "$out/proxy.log" 2>&1 &
proxy_pid=$!
for _ in $(seq 1 100); do curl -sf "http://$gateway:$port/__proxy/status" >/dev/null 2>&1 && break; sleep 0.1; done
curl -sf "http://$gateway:$port/__proxy/status" >/dev/null || { echo "HE-PROXY-003 the metering proxy did not start; see $out/proxy.log" >&2; exit 2; }
curl -sf -X POST "http://$gateway:$port/__proxy/bind" -H 'content-type: application/json' -H "x-proxy-control: $control" -d '{"slot":"gbrain-image","key":"gbrain-image"}' >/dev/null \
  || { echo "HE-PROXY-003 could not bind the gbrain-image slot; see $out/proxy.log" >&2; exit 2; }
echo "[build-gbrain-image] metering proxy on $gateway:$port, lease \$1 as $run_id in $ledger, slot gbrain-image bound"

for split in dev heldout; do
  dest="$brains/$split-embedded"
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
  dest="$brains/$split-embedded"
  # Per-split usage: the usage lines carry the slot (gbrain-image) and not the split, so each manifest records the run's
  # total and the split's share by request order is not separable; the total is what the lane cap counts.
  jq --argjson s "$summary" '.embeddings.usage = {requests: $s.requests, usd: $s.committed_usd, run_id: $s.run_id, note: "whole-run total for both embedded brains, from the proxy ledger"}
     | .embeddings.usage.input_tokens = ($s.input_tokens // null)' "$dest/manifest.json" > "$dest/manifest.json.tmp" && mv "$dest/manifest.json.tmp" "$dest/manifest.json"
done
usage_tokens=$(jq -s '[.[] | select(.outcome == "forwarded") | .input_tokens // 0] | add // 0' "$usage" 2>/dev/null || echo 0)
for split in dev heldout; do
  jq --argjson t "$usage_tokens" '.embeddings.usage.input_tokens = $t' "$brains/$split-embedded/manifest.json" > "$brains/$split-embedded/manifest.json.tmp" && mv "$brains/$split-embedded/manifest.json.tmp" "$brains/$split-embedded/manifest.json"
done
if [ "$brains" != "$out/brains" ]; then rm -rf "$out/brains" && mkdir -p "$out" && cp -r "$brains" "$out/brains"; fi

echo "[build-gbrain-image] embedded target -> $tag"
docker build --build-arg "GBRAIN_COMMIT=$gbrain" "${hermes_args[@]}" --target embedded -t "$tag" -f gbrain/Dockerfile . >> "$log" 2>&1 || fail "docker build of the embedded target failed"
echo "[build-gbrain-image] embedded image $(docker image inspect -f '{{.Id}}' "$tag"); brains: $(docker run --rm --entrypoint ls "$tag" /brains | tr '\n' ' ')"
