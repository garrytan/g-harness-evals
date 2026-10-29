#!/usr/bin/env bash
# internal-task overlay wrapper for the OpenClaw adapter. The image is
# harness-eval/openclaw:gstack-<pin8>, FROM harness-eval/openclaw:dev with the
# pinned gstack checkout at /opt/gstack and Bun at /opt/bun. Before the first
# turn it marks the trial as a test run for gstack (wrap_mark_test_run in
# wrapper-lib.sh, the same marker in both arms), checks the Bun runtime,
# registers gstack's skills with OpenClaw the way the spec's install step does
# (`./setup --host openclaw --no-browser`), as the adapter's HOME and state
# user, then execs the counted adapter (kept as adapter.real.sh) with the
# remaining time budget. The counted adapter and image are untouched.
#
# Which skills root the exec turn reads was a question, because the run entry
# hands `openclaw agent exec --state-dir $OPENCLAW_STATE_DIR/exec` a nested
# state dir. The keyless probe (scripts/gsta-135/preflight.sh, 2026-10-28)
# settled it: the exec turn lists the skills under $OPENCLAW_STATE_DIR/skills
# (the adapter's root, /harness-state/openclaw/skills) and not those under
# exec/skills. So the default registers the spec's way, `./setup --host
# openclaw` with OPENCLAW_STATE_DIR as the adapter exports it. The probe keeps
# the knob: HE_GSTACK_OPENCLAW_ROOTS=parent (default) | exec | both, each root
# registered by one setup run with OPENCLAW_STATE_DIR pointed at it.
set -euo pipefail
. /opt/harness/gstack/wrapper-lib.sh

export HOME="$HE_SESSION_STATE_DIR"
state="$HE_SESSION_STATE_DIR/openclaw"
mkdir -p "$state/exec"
roots=${HE_GSTACK_OPENCLAW_ROOTS:-parent}
case "$roots" in parent) dirs="$state" ;; exec) dirs="$state/exec" ;; both) dirs="$state $state/exec" ;; *) wrap_fail "HE_GSTACK_OPENCLAW_ROOTS must be parent, exec or both, not '$roots'" ;; esac
wrap_mark_test_run
wrap_runtime_check
wrap_log "openclaw overlay: gstack $(cat "$GSTACK_DIR/VERSION") at $(git -C "$GSTACK_DIR" rev-parse HEAD) bun $(bun --version 2>/dev/null || echo none) roots=$roots"

for root in $dirs; do
  OPENCLAW_STATE_DIR="$root" "$GSTACK_DIR/setup" --host openclaw --no-browser > "$HE_LOG_DIR/gstack-setup.log" 2>&1 || wrap_fail "setup --host openclaw (OPENCLAW_STATE_DIR=$root) exited $? (gstack-setup.log)"
  cat "$HE_LOG_DIR/gstack-setup.log" >> "$GSTACK_WRAP_LOG"
  wrap_setup_ready "$HE_LOG_DIR/gstack-setup.log" openclaw
done
OPENCLAW_STATE_DIR="$state" bun --no-env-file --config=/dev/null "$GSTACK_DIR/bin/gstack-harness" status >> "$GSTACK_WRAP_LOG" 2>&1 || wrap_log "gstack-harness status exited $?"
wrap_handoff "$@"
