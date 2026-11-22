#!/usr/bin/env bash
# The keyless test suite (every file bun test tests/ runs) in four phases, for the CI checks job and
# scripts/ubicloud/checks.sh. Phase 1 runs BUILDERS: they docker-build the images other test files look for when they
# load (harness-eval/claude-code:dev, codex:dev, fake:dev), and a file that loaded before an image existed skips its
# docker cases, so run beside the builders those files (claude-code-sdk-driver, instruction-route-cc-codex,
# installer-cc-codex, internal-network-harnesses, gbrain-check, gbrain-runner, internal-network) would pass or skip by
# worker timing. Phase 2 runs PROXY, the other files that start the trial proxy (runner/trial/proxy.ts) or the
# metering proxy (runner/proxy/metering-proxy.ts), one file at a time (the list came from running every test file with
# a probe at the metering proxy's start, plus gbrain-runner and pi-adapter, whose proxy cases need images CI does not
# build). Phase 1 runs its builders one at a time for the same reason: claude-code-adapter
# and codex-adapter start the metering proxy too. freePort() in runner/trial/proxy.ts asks the kernel for a free port,
# closes it, and the proxy binds that port later, so two of these files running at once could take the same port and
# fail with "Failed to start server. Is port N in use?" (HE-PROXY-003). Phase 2 goes away, and phase 1 goes back to
# --parallel, when runner/trial/proxy.ts binds port 0 and reads the port back, after internal-task's results merge
# (internal-task). Phase 3 runs every other file with --parallel. Phase 4 runs SERIAL one file at a time, alone:
# gsta-135-adapters checks that chat_complete leaves no entry in /tmp by counting /tmp, which any other test running at
# the same time changes. tests/sealed-publication.test.ts reads every tracked file (about 257,000 files, 2.4 GB) for an
# age identity. That read is disk-bound: about 2 s on a warm Capy machine, 43 s alone in CI's serial phase, and past
# 60 s beside CI's loaded parallel phase.
# tests/.timings.json (per-file milliseconds) makes phases 1 to 3 start their slowest files first; a file missing
# from it still runs. Phase 3's workers default to the core count (HE_TEST_PARALLEL overrides). Every phase runs; the
# exit status is the last failing phase's.
# bunfig.toml's preload (tests/setup/default-timeout.ts) gives every file a 30 s default, serial or --parallel, and that
# default overrides bun's --timeout flag, so phase 4's --timeout=30000 changes nothing; a test needing longer sets its own.
# Usage: bash scripts/run-tests.sh [--junit-dir DIR]
#   (bun's JUnit reports: DIR/builders.xml, proxy.xml, main.xml, serial.xml)
set -uo pipefail
cd "$(dirname "$0")/.."
BUILDERS=(
  tests/adapter-conformance.test.ts
  tests/claude-code-adapter.test.ts
  tests/codex-adapter.test.ts
)
PROXY=(
  tests/ablation.test.ts
  tests/corrections-2026-11-09.test.ts
  tests/dsh-adapter.test.ts
  tests/frontier-harbor-mirror.test.ts
  tests/gbrain-install-runner.test.ts
  tests/gbrain-runner.test.ts
  tests/gsta-135-panel.test.ts
  tests/harness-zero-config.test.ts
  tests/harness-zero-serve.test.ts
  tests/harness-zero-wire.test.ts
  tests/internal-network-harnesses.test.ts
  tests/internal-network.test.ts
  tests/ledger-reconciliation.test.ts
  tests/listen-host.test.ts
  tests/mcp-at-scale-run.test.ts
  tests/metering-proxy-streams.test.ts
  tests/metering-proxy.test.ts
  tests/pi-adapter.test.ts
  tests/proxy-install-slot.test.ts
  tests/qm-s1-edition-judges.test.ts
  tests/replicate.test.ts
  tests/review-bugs/wait-canary.test.ts
  tests/run-order.test.ts
  tests/runner-capture.test.ts
  tests/sections-wiring.test.ts
  tests/skill-resolver-phase-b.test.ts
  tests/skill-resolver-set-t-runner.test.ts
  tests/timer-turn-adapters.test.ts
  tests/trial-loop.test.ts
  tests/week-rig.test.ts
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
# The public copy leaves out two PROXY files (frontier-harbor-mirror, harness-zero-config), so phase 2 runs the ones
# present; tests/run-tests.test.ts checks that every PROXY file exists in this repository.
proxy=()
for f in "${PROXY[@]}"; do [ ! -f "$f" ] || proxy+=("$f"); done
[ ${#proxy[@]} -gt 0 ] || { echo "run-tests: no PROXY file exists" >&2; exit 2; }
[ -z "$junit_dir" ] || mkdir -p "$junit_dir"
report() { reporter=(); [ -z "$junit_dir" ] || reporter=(--reporter=junit "--reporter-outfile=$junit_dir/$1.xml"); }
parallel=(--parallel="${HE_TEST_PARALLEL:-$(nproc)}" --timings=tests/.timings.json)
one_at_a_time=(--parallel=1 --timings=tests/.timings.json)
ignore=("${BUILDERS[@]/#/--path-ignore-patterns=}" "${PROXY[@]/#/--path-ignore-patterns=}" "${SERIAL[@]/#/--path-ignore-patterns=}")
rc=0
echo "run-tests: phase 1 (image builders, one at a time): ${BUILDERS[*]}"
report builders
bun test "${BUILDERS[@]/#/./}" "${one_at_a_time[@]}" "${reporter[@]}" || rc=$?
echo "run-tests: phase 2 (proxy files, one at a time): ${proxy[*]}"
report proxy
bun test "${proxy[@]/#/./}" "${one_at_a_time[@]}" "${reporter[@]}" || rc=$?
echo "run-tests: phase 3: every other test file"
report main
bun test tests/ "${ignore[@]}" "${parallel[@]}" "${reporter[@]}" || rc=$?
echo "run-tests: phase 4 (serial): ${SERIAL[*]}"
report serial
bun test "${SERIAL[@]/#/./}" --timeout=30000 "${reporter[@]}" || rc=$?
exit "$rc"
