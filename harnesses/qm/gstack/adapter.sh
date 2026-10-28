#!/usr/bin/env bash
# internal-task overlay wrapper for the QM adapter (task container of compose.yaml).
# The image is harness-eval/qm:gstack-<pin8>, FROM harness-eval/qm:dev with the
# pinned gstack checkout at /opt/gstack and Bun at /opt/bun. After core is
# healthy and before the first turn it publishes gstack's skill pack to the
# trial's QM organization through core's admin API (`gstack-harness register
# qm --yes`, the same core URL, signing secret and admin actor the counted
# adapter uses for its own admin calls, so no new credential enters the stack),
# then execs the counted adapter (kept as adapter.real.sh) with the remaining
# time budget. compose.yaml, run-trial.sh and the counted adapter are untouched;
# run-trial.sh selects this image through --image (QM_IMAGE).
set -euo pipefail
. /opt/harness/gstack/wrapper-lib.sh
: "${QM_CORE_URL:=http://core:8080}"
: "${QM_SIGNING_SECRET:?QM_SIGNING_SECRET must be set (per-trial random, shared with core)}"
: "${QM_ADMIN_ACTOR:=harness-admin@harness-eval}"

export HOME="$HE_SESSION_STATE_DIR"
wrap_log "qm overlay: gstack $(cat "$GSTACK_DIR/VERSION") at $(git -C "$GSTACK_DIR" rev-parse HEAD) bun $(bun --version) core=$QM_CORE_URL"

# Core needs Postgres and its migrations before it answers /healthz (the
# counted adapter waits the same way, up to 120 s).
deadline=$(( $(date +%s) + 120 ))
until curl -fsS "$QM_CORE_URL/healthz" >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "$deadline" ]; then wrap_fail "core did not become healthy in 120 s"; fi
  sleep 2
done
wrap_log "core healthy"

# Alpine's busybox env has no -S, so bun is named rather than the shebang.
set +e
GSTACK_QM_URL="$QM_CORE_URL" GSTACK_QM_SIGNING_SECRET="$QM_SIGNING_SECRET" GSTACK_QM_ADMIN_ACTOR="$QM_ADMIN_ACTOR" \
  bun --no-env-file --config=/dev/null "$GSTACK_DIR/bin/gstack-harness" register qm --yes > "$HE_LOG_DIR/gstack-qm-register.log" 2>&1
code=$?
set -e
cat "$HE_LOG_DIR/gstack-qm-register.log" >> "$GSTACK_WRAP_LOG"
[ "$code" -eq 0 ] || wrap_fail "gstack-harness register qm exited $code"
grep -q 'QM: pack .* (installed\|unchanged)' "$HE_LOG_DIR/gstack-qm-register.log" || wrap_fail "no 'QM: pack <id> at <sha> (installed)' receipt line in the register output"
bun --no-env-file --config=/dev/null "$GSTACK_DIR/bin/gstack-harness" status --no-check >> "$GSTACK_WRAP_LOG" 2>&1 || wrap_log "gstack-harness status exited $?"
wrap_handoff "$@"
