#!/usr/bin/env bash
# internal-task overlay wrapper for the Hermes adapter. The image is
# harness-eval/hermes:gstack-<pin8>, FROM harness-eval/hermes:dev with the
# pinned gstack checkout at /opt/gstack and Bun at /opt/bun. Before the first
# turn it registers gstack's skills with Hermes the way the spec's install step
# does (`./setup --host hermes --no-browser` with HERMES_HOME exported as the
# adapter exports it), then execs the counted adapter (kept as adapter.real.sh)
# with the remaining time budget. The counted adapter and image are untouched.
set -euo pipefail
. /opt/harness/gstack/wrapper-lib.sh

export HOME="$HE_SESSION_STATE_DIR"
export HERMES_HOME="$HE_SESSION_STATE_DIR/hermes"
mkdir -p "$HERMES_HOME"
wrap_log "hermes overlay: gstack $(cat "$GSTACK_DIR/VERSION") at $(git -C "$GSTACK_DIR" rev-parse HEAD) bun $(bun --version)"
"$GSTACK_DIR/setup" --host hermes --no-browser > "$HE_LOG_DIR/gstack-setup.log" 2>&1 || wrap_fail "setup --host hermes exited $? (gstack-setup.log)"
cat "$HE_LOG_DIR/gstack-setup.log" >> "$GSTACK_WRAP_LOG"
wrap_setup_ready "$HE_LOG_DIR/gstack-setup.log" hermes
bun --no-env-file --config=/dev/null "$GSTACK_DIR/bin/gstack-harness" status >> "$GSTACK_WRAP_LOG" 2>&1 || wrap_log "gstack-harness status exited $?"
wrap_handoff "$@"
