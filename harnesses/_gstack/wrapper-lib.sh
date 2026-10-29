#!/usr/bin/env bash
# Shared by the internal-task overlay wrappers (harnesses/<h>/gstack/adapter.sh).
# Sourced, not run. The wrapper records when it started, marks the trial as a
# test run for gstack, checks the Bun runtime, registers gstack with the
# harness, and hands the real adapter the time budget less what the
# registration took, so the registration never eats run-trial.sh's 60 s grace.
# Everything the wrapper prints goes to $HE_LOG_DIR/gstack-register.log; the
# adapter's own adapter.log, stdout.log and stderr.log stay as the real adapter
# writes them, so the evidence files hold only the harness's own output.
# discovery.sh reads three of this log's lines into the run manifest and the
# rows: `marker: harnesses/_gstack/wrapper-lib.sh:<n> ...` (the export line of
# the test-run marker), `runtime: ok|degraded|unknown (...)` (a degraded start
# is the infra:runtime termination) and, from the Hermes chat-mode adapter,
# `approval: <key>=<value> ...`.

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

# wrap_mark_test_run: every overlay trial is a test run, marked with the
# variables gstack reads at pin bd8907d6 and nothing else (tests/gsta-135-
# adapters.test.ts greps gstack's lib and bin for each name):
#   GSTACK_SESSION_KIND=spawned  lib/install-verdict.ts (install admission
#                                applies, soft without GSTACK_CAPY),
#                                lib/autoplan-run.ts, bin/gstack-skill-start
#   GSTACK_EPHEMERAL=1           lib/autoplan-timing.ts and lib/approval-
#                                record.ts: analytics and approval records
#                                are not kept
#   GSTACK_STATE_ROOT            lib/state-root.ts and bin/gstack-state-root.sh:
#                                a fresh root under the trial's /harness-state,
#                                so no shared ~/.gstack and no sync spool
#                                (artifacts_sync_mode stays the default, off)
# GSTACK_CAPY is never set (and dropped if the image carried it): with it,
# spawned would be a hard kind that refuses without a Capy install verdict.
# The export line's number is logged as the marker line for the manifest.
wrap_mark_test_run() {
  local line
  unset GSTACK_CAPY GSTACK_HOME GSTACK_STATE_DIR
  export GSTACK_SESSION_KIND=spawned GSTACK_EPHEMERAL=1 GSTACK_STATE_ROOT="$HE_SESSION_STATE_DIR/.gstack"; line=$LINENO
  mkdir -p "$GSTACK_STATE_ROOT"
  wrap_log "marker: harnesses/_gstack/wrapper-lib.sh:$line GSTACK_SESSION_KIND=spawned GSTACK_EPHEMERAL=1 GSTACK_STATE_ROOT=$GSTACK_STATE_ROOT GSTACK_CAPY=unset"
}

# wrap_runtime_check: Bun must be on PATH and at least gstack's supported
# minimum (GSTACK_BUN_TESTED in bin/gstack-bun-version.sh at the pin). Bun
# missing or below the minimum is logged as `runtime: degraded (<reason>)` and
# the wrapper goes on, so the registration's own failure is also on record;
# discovery.sh maps the degraded line to the infra:runtime termination. A pin
# that has no bin/gstack-bun-version.sh or no GSTACK_BUN_TESTED line in it
# says nothing about the runtime, so that is logged as `runtime: unknown
# (<reason>)`, never degraded: a candidate that moves the file must not have
# every one of its trials zeroed as a runtime failure.
wrap_runtime_check() {
  local bun_version minimum
  if ! bun_version=$(bun --version 2>/dev/null); then wrap_log "runtime: degraded (bun not on PATH: $PATH)"; return 0; fi
  [ -r "$GSTACK_DIR/bin/gstack-bun-version.sh" ] || { wrap_log "runtime: unknown (bun $bun_version; no $GSTACK_DIR/bin/gstack-bun-version.sh at this pin, no minimum to check)"; return 0; }
  minimum=$(sed -n 's/^GSTACK_BUN_TESTED="\([0-9.]*\)"/\1/p' "$GSTACK_DIR/bin/gstack-bun-version.sh" | head -1)
  [ -n "$minimum" ] || { wrap_log "runtime: unknown (bun $bun_version; no GSTACK_BUN_TESTED line in $GSTACK_DIR/bin/gstack-bun-version.sh, no minimum to check)"; return 0; }
  if [ "$(printf '%s\n%s\n' "$minimum" "$bun_version" | sort -V | head -1)" != "$minimum" ]; then wrap_log "runtime: degraded (bun $bun_version is below gstack's supported minimum $minimum)"; return 0; fi
  wrap_log "runtime: ok bun $bun_version (minimum $minimum)"
}

# wrap_setup_ready <log file> <host>: the last line setup printed must be
# `gstack ready (<host>)`.
wrap_setup_ready() {
  [ -s "$1" ] || wrap_fail "setup printed nothing ($1)"
  local last; last=$(grep -v '^[[:space:]]*$' "$1" | tail -n 1)
  case "$last" in "gstack ready ($2"*) wrap_log "setup: $last" ;; *) wrap_fail "setup's last line is not 'gstack ready ($2)': $last" ;; esac
}

# wrap_budget_left: HE_TIME_BUDGET_S becomes the time budget less the
# registration so far, logged; exit 2 when the registration used it all.
wrap_budget_left() {
  local elapsed left
  elapsed=$(( $(wrap_now) - GSTACK_WRAP_START ))
  left=$(( HE_TIME_BUDGET_S - elapsed ))
  wrap_log "budget: given ${HE_TIME_BUDGET_S}s, registration took ${elapsed}s, handing the adapter ${left}s"
  [ "$left" -gt 0 ] || wrap_fail "registration used the whole time budget (${elapsed}s of ${HE_TIME_BUDGET_S}s)"
  export HE_TIME_BUDGET_S=$left
}

# wrap_handoff: export the remaining budget and exec the real adapter.
wrap_handoff() {
  wrap_budget_left
  exec "$GSTACK_WRAP_REAL" "$@"
}
