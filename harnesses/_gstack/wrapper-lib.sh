#!/usr/bin/env bash
# Shared by the internal-task overlay wrappers (harnesses/<h>/gstack/adapter.sh).
# Sourced, not run. The wrapper records when it started, registers gstack with
# the harness, and hands the real adapter the time budget less what the
# registration took, so the registration never eats run-trial.sh's 60 s grace.
# Everything the wrapper prints goes to $HE_LOG_DIR/gstack-register.log; the
# adapter's own adapter.log, stdout.log and stderr.log stay as the real adapter
# writes them, so the evidence files hold only the harness's own output.

: "${HE_SESSION_STATE_DIR:=/harness-state}"
: "${HE_LOG_DIR:?HE_LOG_DIR must be set}"
: "${HE_TIME_BUDGET_S:=300}"
: "${HE_TRIAL_ID:=unknown}"
: "${GSTACK_DIR:=/opt/gstack}"
: "${GSTACK_WRAP_REAL:=/opt/harness/adapter.real.sh}"

# wrap_now: the wall clock, or GSTACK_WRAP_NOW when a test pins it.
wrap_now() { echo "${GSTACK_WRAP_NOW:-$(date +%s)}"; }
GSTACK_WRAP_START=$(wrap_now)
GSTACK_WRAP_LOG="$HE_LOG_DIR/gstack-register.log"
mkdir -p "$HE_LOG_DIR"

# Log lines carry a UTC stamp and the trial id, the adapters' own shape.
wrap_log() { printf '%s gstack-wrap[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" >> "$GSTACK_WRAP_LOG"; }

# wrap_fail <message>: a registration failure is a harness error (exit 2)
# before any model request, never a model error or a verdict.
wrap_fail() { wrap_log "FAIL: $*"; wrap_log "exit 2 (harness_error) before any model request"; exit 2; }

# wrap_setup_ready <log file> <host>: the last line setup printed must be
# `gstack ready (<host>)`.
wrap_setup_ready() {
  [ -s "$1" ] || wrap_fail "setup printed nothing ($1)"
  local last; last=$(grep -v '^[[:space:]]*$' "$1" | tail -n 1)
  case "$last" in "gstack ready ($2"*) wrap_log "setup: $last" ;; *) wrap_fail "setup's last line is not 'gstack ready ($2)': $last" ;; esac
}

# wrap_handoff: export the remaining budget and exec the real adapter.
wrap_handoff() {
  local elapsed left
  elapsed=$(( $(wrap_now) - GSTACK_WRAP_START ))
  left=$(( HE_TIME_BUDGET_S - elapsed ))
  wrap_log "budget: given ${HE_TIME_BUDGET_S}s, registration took ${elapsed}s, handing the adapter ${left}s"
  [ "$left" -gt 0 ] || wrap_fail "registration used the whole time budget (${elapsed}s of ${HE_TIME_BUDGET_S}s)"
  export HE_TIME_BUDGET_S=$left
  exec "$GSTACK_WRAP_REAL" "$@"
}
