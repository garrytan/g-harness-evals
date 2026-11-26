#!/usr/bin/env bash
# Builds the gbrain-arm images of the gbrain first-wow eval: harness-eval/<harness>-gbrain:<commit 12> from harness-eval/<harness>:dev.
# usage: bash harnesses/_first-wow/build.sh <gbrain commit, 40 hex> <gbrain version> [claude-code codex]
set -euo pipefail
commit=${1:?gbrain commit} version=${2:?gbrain version}; shift 2
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "the gbrain commit must be 40 hex characters" >&2; exit 2; }
dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
for h in "${@:-claude-code codex}"; do
  for harness in $h; do
    docker build -f "$dir/Dockerfile.gbrain" --build-arg BASE="harness-eval/$harness:dev" --build-arg GBRAIN_COMMIT="$commit" \
      --build-arg GBRAIN_VERSION="$version" -t "harness-eval/$harness-gbrain:${commit:0:12}" "$dir"
    echo "FIRST_WOW_IMAGE: harness-eval/$harness-gbrain:${commit:0:12}"
  done
done
