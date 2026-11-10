#!/usr/bin/env bash
# The ci.yml steps in the workflow's order, stopping at the first failure with that step's exit code.
#
#   bash scripts/ubicloud/checks.sh          (from the repository root, after bootstrap.sh)
#
# checks job: bun install --frozen-lockfile; bunx tsc --noEmit; scripts/run-tests.sh (bun test tests/ in
# parallel phases); python3 scripts/check-links.py;
# bun runner/prereg/prereg.ts. Then the crew's seal check from CREW.md, bun scripts/seal-heldout.ts --check (every sealed
# set), which the workflow covers through tests/heldout-manifest.test.ts. Then the docker-e2e job when docker-applies.sh
# says the workflow would run it: scripts/build-gbrain-image.sh --tag harness-eval/gbrain:pr-<sha12> --out
# /tmp/gbrain-build, HE_GBRAIN_IMAGE=<tag> bun test tests/gbrain-image.test.ts, and the build log's tail on failure.
# With HE_DOCS_ONLY=true (pr-check.sh sets it from the base commit's scripts/ci/docs-only.ts) only install, the docs
# checks (scripts/ci/docs-only.ts DOC_TESTS), links and prereg run, as in ci.yml.
# Every step prints "step <name>: ok (<n>s)" or "step <name>: failed (exit <code>, <n>s)", and the last line is
# "checks: pass after <n>s" or "checks: fail at <step> (exit <code>) after <n>s"; pr-check.sh reads those lines.
set -uo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.bun/bin:$PATH"
# Group membership from bootstrap.sh's usermod is not in this multiplexed SSH session yet; re-enter with the docker group.
if [ -z "${HE_CHECKS_IN_DOCKER_GROUP:-}" ] && getent group docker >/dev/null && ! id -nG | grep -qw docker && id -nG "$USER" | grep -qw docker; then
  export HE_CHECKS_IN_DOCKER_GROUP=1
  exec sg docker -c "bash $(printf %q "$0") $(printf '%q ' "$@")"
fi

sha=$(git rev-parse HEAD)
t_all=$(date +%s)
echo "checks: $sha, bun $(bun --version), docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo none)"

step() {
  local name=$1 t rc=0
  shift
  t=$(date +%s)
  echo "::step $name: $*"
  "$@" || rc=$?
  if [ "$rc" -eq 0 ]; then echo "step $name: ok ($(( $(date +%s) - t ))s)"; return 0; fi
  echo "step $name: failed (exit $rc, $(( $(date +%s) - t ))s)"
  echo "checks: fail at $name (exit $rc) after $(( $(date +%s) - t_all ))s"
  exit "$rc"
}

step install bun install --frozen-lockfile
if [ "${HE_DOCS_ONLY:-}" = true ]; then
  step docs-tests bun test tests/version.test.ts tests/scoreboard.test.ts
  step links python3 scripts/check-links.py
  step prereg bun runner/prereg/prereg.ts
  echo "checks: pass after $(( $(date +%s) - t_all ))s"
  exit 0
fi
step typecheck bunx tsc --noEmit
if [ -f scripts/run-tests.sh ]; then step tests bash scripts/run-tests.sh; else step tests bun test tests/; fi
step links python3 scripts/check-links.py
step prereg bun runner/prereg/prereg.ts
if [ -f scripts/seal-heldout.ts ]; then step seal bun scripts/seal-heldout.ts --check; fi

if bash scripts/ubicloud/docker-applies.sh; then
  tag="harness-eval/gbrain:pr-${sha:0:12}"
  build_image() {
    scripts/build-gbrain-image.sh --tag "$tag" --out /tmp/gbrain-build && return 0
    local rc=$?
    tail -60 /tmp/gbrain-build/build.log || true
    return "$rc"
  }
  step image-build build_image
  step image-tests env HE_GBRAIN_IMAGE="$tag" bun test tests/gbrain-image.test.ts
fi
echo "checks: pass after $(( $(date +%s) - t_all ))s"
