#!/usr/bin/env bash
# The keyless test suite (every file bun test tests/ runs) in three phases, for the CI checks job and
# scripts/ubicloud/checks.sh. Phase 1 runs BUILDERS with --parallel: they docker-build the images other test files look
# for when they load (harness-eval/claude-code:dev, codex:dev, fake:dev), and a file that loaded before an image existed
# skips its docker cases, so run beside the builders those files (claude-code-sdk-driver, instruction-route-cc-codex,
# installer-cc-codex, internal-network-harnesses, gbrain-check, gbrain-runner, internal-network) would pass or skip by
# worker timing. Phase 2 runs every other file with --parallel. Phase 3 runs SERIAL one file at a time, alone:
# gsta-135-adapters checks that chat_complete leaves no entry in /tmp by counting /tmp, which any other test running at
# the same time changes. tests/sealed-publication.test.ts reads every tracked file (about 257,000 files, 2.4 GB) for an
# age identity. That read is disk-bound: about 2 s on a warm Capy machine, 43 s alone in CI's serial phase, and past
# 60 s beside CI's loaded parallel phase.
# tests/.timings.json (per-file milliseconds) makes each parallel phase start its slowest files first; a file missing
# from it still runs. Workers default to the core count (HE_TEST_PARALLEL overrides). Every phase runs; the exit status
# is the last failing phase's.
# bunfig.toml's preload (tests/setup/default-timeout.ts) gives every file a 30 s default, serial or --parallel, and that
# default overrides bun's --timeout flag, so phase 3's --timeout=30000 changes nothing; a test needing longer sets its own.
# Usage: bash scripts/run-tests.sh [--junit-dir DIR]   (writes bun's JUnit reports DIR/builders.xml, main.xml, serial.xml)
set -uo pipefail
cd "$(dirname "$0")/.."
BUILDERS=(
  tests/adapter-conformance.test.ts
  tests/claude-code-adapter.test.ts
  tests/codex-adapter.test.ts
)
SERIAL=(
  tests/gsta-135-adapters.test.ts
  tests/sealed-publication.test.ts
)
junit_dir=""
while [ $# -gt 0 ]; do
  case $1 in
    --junit-dir)
      [ -z "$junit_dir" ] || { echo "run-tests: --junit-dir is given twice" >&2; exit 2; }
      case ${2:-} in ''|-*) echo "run-tests: --junit-dir needs a directory" >&2; exit 2 ;; esac
      junit_dir=$2
      shift 2 ;;
    *) echo "run-tests: unknown argument $1 (usage: bash scripts/run-tests.sh [--junit-dir DIR])" >&2; exit 2 ;;
  esac
done
for f in "${BUILDERS[@]}" "${SERIAL[@]}"; do [ -f "$f" ] || { echo "run-tests: $f is listed but does not exist" >&2; exit 2; }; done
[ -z "$junit_dir" ] || mkdir -p "$junit_dir"
report() { reporter=(); [ -z "$junit_dir" ] || reporter=(--reporter=junit "--reporter-outfile=$junit_dir/$1.xml"); }
parallel=(--parallel="${HE_TEST_PARALLEL:-$(nproc)}" --timings=tests/.timings.json)
ignore=("${BUILDERS[@]/#/--path-ignore-patterns=}" "${SERIAL[@]/#/--path-ignore-patterns=}")
rc=0
echo "run-tests: phase 1 (image builders): ${BUILDERS[*]}"
report builders
bun test "${BUILDERS[@]/#/./}" "${parallel[@]}" "${reporter[@]}" || rc=$?
echo "run-tests: phase 2: every other test file"
report main
bun test tests/ "${ignore[@]}" "${parallel[@]}" "${reporter[@]}" || rc=$?
echo "run-tests: phase 3 (serial): ${SERIAL[*]}"
report serial
bun test "${SERIAL[@]/#/./}" --timeout=30000 "${reporter[@]}" || rc=$?
exit "$rc"
