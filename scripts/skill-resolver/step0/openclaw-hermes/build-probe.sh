#!/bin/bash
# internal-task Step 0: build a catalog probe image FROM a counted harness image.
#   scripts/skill-resolver/step0/openclaw-hermes/build-probe.sh <openclaw|hermes> <native|names-only|no-bundled> <catalog dir>
# Tags harness-eval/<harness>:step0-<config>. The catalog dir is build-catalog.ts --out (or names-only.ts --out).
set -euo pipefail
harness=$1 config=$2 catalog=$3
here=$(cd "$(dirname "$0")" && pwd)
ctx=$(mktemp -d)
trap 'rm -rf "$ctx"' EXIT
cp -r "$catalog/skills" "$ctx/skills"
cp "$here/Dockerfile" "$here/entry.sh" "$ctx/"
docker build -q -t "harness-eval/$harness:step0-$config" --build-arg "BASE=harness-eval/$harness:dev" \
  --build-arg "HARNESS=$harness" --build-arg "STEP0_CONFIG=$config" "$ctx"
