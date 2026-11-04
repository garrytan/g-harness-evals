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
  [ -d "$GSTACK_DIR" ] || { wrap_log "runtime: unknown (bun $bun_version; gstack: none, no $GSTACK_DIR and no minimum to check)"; return 0; }
  [ -r "$GSTACK_DIR/bin/gstack-bun-version.sh" ] || { wrap_log "runtime: unknown (bun $bun_version; no $GSTACK_DIR/bin/gstack-bun-version.sh at this pin, no minimum to check)"; return 0; }
  minimum=$(sed -n 's/^GSTACK_BUN_TESTED="\([0-9.]*\)"/\1/p' "$GSTACK_DIR/bin/gstack-bun-version.sh" | head -1)
  [ -n "$minimum" ] || { wrap_log "runtime: unknown (bun $bun_version; no GSTACK_BUN_TESTED line in $GSTACK_DIR/bin/gstack-bun-version.sh, no minimum to check)"; return 0; }
  if [ "$(printf '%s\n%s\n' "$minimum" "$bun_version" | sort -V | head -1)" != "$minimum" ]; then wrap_log "runtime: degraded (bun $bun_version is below gstack's supported minimum $minimum)"; return 0; fi
  wrap_log "runtime: ok bun $bun_version (minimum $minimum)"
}

# wrap_gstack_present: 0 when $GSTACK_DIR exists. The no-gstack arm (internal-task)
# runs the same overlay image built with GSTACK_COMMIT=none: Bun, the wrapper
# and the adapter swap are there, but there is no $GSTACK_DIR. Then this logs
# `gstack: none` and returns 1, and the adapter skips gstack's registration
# and setup; the marker, the runtime check (which logs runtime: unknown, never
# degraded, for a missing $GSTACK_DIR), the budget handoff and, in Hermes chat
# mode, the approval block run as in the gstack arms, so the arm differs from
# them only by gstack. An image built with a gstack commit carries it as
# GSTACK_IMAGE_COMMIT, and a missing $GSTACK_DIR there is a setup failure,
# never a silent no-gstack trial. Nothing above the marker's export line may move: its
# line number is recorded in every panel manifest.
wrap_gstack_present() {
  wrap_start_hook_mode
  if [ -d "$GSTACK_DIR" ]; then wrap_gstack_pinned; return 0; fi
  [ "${GSTACK_IMAGE_COMMIT:-none}" = none ] || wrap_fail "no $GSTACK_DIR, but this image was built with GSTACK_COMMIT=$GSTACK_IMAGE_COMMIT; a gstack arm never runs without gstack"
  [ "$GSTACK_HARNESS_START_HOOK" = 0 ] || wrap_fail "this image says GSTACK_IMAGE_START_HOOK=on but has no $GSTACK_DIR; the no-gstack arm has no start hook"
  wrap_log "gstack: none (no $GSTACK_DIR in this image, built with GSTACK_COMMIT=none; registration and setup skipped)"
  wrap_log "start_hook: off none (no gstack in this image)"
  return 1
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

# ---- internal-task: the start hook arm, the pinned-tree check and the config seed ----

# wrap_start_hook_mode: the image decides whether gstack's start hook (internal-task,
# lib/harness-start-hook.ts at b9fda18c) is on. The overlay Dockerfiles bake
# GSTACK_IMAGE_START_HOOK=on|off from their GSTACK_START_HOOK build arg; unset
# (an image built before internal-task, or the QM overlay) is off. The wrapper
# exports GSTACK_HARNESS_START_HOOK=1 or =0 to match, so nothing else
# (gstack-config harness_start_hook, a ledger, an inherited variable) can flip
# the choice: gstack reads the --start-hook flag first, which setup never
# passes, then this variable.
wrap_start_hook_mode() {
  case "${GSTACK_IMAGE_START_HOOK:-off}" in
    on) export GSTACK_HARNESS_START_HOOK=1 ;;
    off) export GSTACK_HARNESS_START_HOOK=0 ;;
    *) wrap_fail "GSTACK_IMAGE_START_HOOK must be on or off, not '$GSTACK_IMAGE_START_HOOK'" ;;
  esac
}

# wrap_gstack_pinned: the installed tree's HEAD must be the commit the image
# was built with (GSTACK_IMAGE_COMMIT), else the trial is refused before any
# model request. The build checks the same thing once; this checks it again
# in every trial, so a moved checkout or an image env naming another commit
# never reaches a scored turn.
wrap_gstack_pinned() {
  local head
  [ -n "${GSTACK_IMAGE_COMMIT:-}" ] && [ "$GSTACK_IMAGE_COMMIT" != none ] || wrap_fail "$GSTACK_DIR exists but this image names no gstack commit (GSTACK_IMAGE_COMMIT=${GSTACK_IMAGE_COMMIT:-<unset>}); a gstack arm runs only at its pinned SHA"
  head=$(git -C "$GSTACK_DIR" rev-parse HEAD 2>/dev/null) || wrap_fail "git -C $GSTACK_DIR rev-parse HEAD failed, so the installed tree cannot be checked against the pinned $GSTACK_IMAGE_COMMIT"
  [ "$head" = "$GSTACK_IMAGE_COMMIT" ] || wrap_fail "the installed gstack tree is at $head, not the pinned $GSTACK_IMAGE_COMMIT this image names; refusing to start"
  wrap_log "pin: $GSTACK_DIR HEAD $head equals GSTACK_IMAGE_COMMIT"
}

# wrap_seed_config <dest> <template> <openai template>: copies the config the
# counted adapter would copy (it copies only when the file is absent) before
# gstack's setup runs, in every arm. The start hook turns its plugin on through
# the harness's own CLI (openclaw config set, hermes plugins enable), which
# creates the config file when there is none; without the seed the counted
# adapter would then find a file and skip its template, and the trial would
# run without the harness settings. The template is picked the way both
# counted adapters pick it: an HE_MODEL_BASE_URL ending in /openai takes the
# OpenAI template, and one ending in /particle takes the Particle template,
# named like the OpenAI one with particle for openai (config.particle.yaml,
# openclaw.particle.json). GSTACK_WRAP_CONFIG_DIR (default /opt/harness/config)
# is for tests.
wrap_seed_config() {
  local dir=${GSTACK_WRAP_CONFIG_DIR:-/opt/harness/config} template=$2 url=${HE_MODEL_BASE_URL:-}
  case "${url%/}" in */openai) template=$3 ;; */particle) template=${3/openai/particle} ;; esac
  if [ -e "$1" ]; then wrap_log "config: $1 already exists, left as it is"; return 0; fi
  [ -r "$dir/$template" ] || wrap_fail "no config template $dir/$template to seed $1 with"
  cp "$dir/$template" "$1" || wrap_fail "could not copy $dir/$template to $1"
  wrap_log "config: seeded $1 from $dir/$template before registration (the copy the counted adapter makes when the file is absent)"
}

# wrap_setup_exit <host> <code>: setup's failure as a harness error. Exit 4 at
# the candidate means gstack registered the skills and the start hook is not
# active (HARNESS_HOOK_INACTIVE): an infrastructure failure, never a score.
wrap_setup_exit() {
  [ "$2" -ne 4 ] || wrap_fail "setup --host $1 exited 4: the skills are registered but the start hook is not active (HARNESS_HOOK_INACTIVE, gstack-setup.log)"
  wrap_fail "setup --host $1 exited $2 (gstack-setup.log)"
}

# wrap_start_hook_check: runs gstack-harness status into the register log and
# holds it to the image's choice. With the hook on, status must show
# `start hook: active` (gstack reads it back through the harness's own CLI),
# else exit 2 before any model request. With it off, status must show no
# active hook. Logs one line, `start_hook: on active` or
# `start_hook: off <state>` (absent when status prints no hook line, as at
# a pin without the hook or with the hook off).
wrap_start_hook_check() {
  local out state
  out=$(bun --no-env-file --config=/dev/null "$GSTACK_DIR/bin/gstack-harness" status 2>&1) || wrap_log "gstack-harness status exited $?"
  printf '%s\n' "$out" >> "$GSTACK_WRAP_LOG"
  state=$(sed -n '/^[[:space:]]*start hook: /{s/^[[:space:]]*start hook: \([a-z]*\).*/\1/p;q;}' <<< "$out")
  if [ "$GSTACK_HARNESS_START_HOOK" = 1 ]; then
    [ "$state" = active ] || wrap_fail "start hook: the image says on, but gstack-harness status shows it ${state:-absent}, not active"
  else
    [ "$state" != active ] || wrap_fail "start hook: the image says off, but gstack-harness status shows it active"
  fi
  wrap_log "start_hook: $([ "$GSTACK_HARNESS_START_HOOK" = 1 ] && echo on || echo off) ${state:-absent}"
}
