#!/usr/bin/env bash
# QM adapter (sidecar topology). This runs in the task container of
# compose.yaml, beside the `core` and `pg` services. It waits for core, posts
# one DM turn as actor U1 with instruction.md as the text, and exits per the
# protocol in docs/adapters.md. QM's agent works in a per-scope sandbox
# container, not in /workspace; capture.sh copies that sandbox's workspace
# into /workspace after this exits, so the grader reads what the agent wrote.
set -euo pipefail

: "${HE_WORKSPACE_DIR:=/workspace}"
: "${HE_SESSION_STATE_DIR:=/harness-state}"
: "${HE_LOG_DIR:?HE_LOG_DIR must be set}"
: "${HE_TIME_BUDGET_S:=300}"
: "${HE_TRIAL_ID:=unknown}"
: "${QM_CORE_URL:=http://core:8080}"
: "${QM_SIGNING_SECRET:?QM_SIGNING_SECRET must be set (per-trial random, shared with core)}"
: "${QM_ACTOR_ID:=U1}"

mkdir -p "$HE_LOG_DIR"
exec > >(tee -a "$HE_LOG_DIR/stdout.log") 2> >(tee -a "$HE_LOG_DIR/stderr.log" >&2)
log() { printf '%s qm[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }

if [ "${1:-run}" != "run" ]; then
  log "unknown entry point: ${1:-}; only 'run' is implemented"
  exit 2
fi
[ -r "$HE_WORKSPACE_DIR/instruction.md" ] || { log "no readable $HE_WORKSPACE_DIR/instruction.md"; exit 2; }

export HOME="$HE_SESSION_STATE_DIR"
log "qm ${QM_VERSION:-unknown} core=$QM_CORE_URL actor=$QM_ACTOR_ID budget=${HE_TIME_BUDGET_S}s"

# Core needs Postgres and its migrations before it answers /healthz.
deadline=$(( $(date +%s) + 120 ))
until curl -fsS "$QM_CORE_URL/healthz" >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "$deadline" ]; then log "core did not become healthy in 120 s"; exit 2; fi
  sleep 2
done
log "core healthy"

set +e
timeout -k 60 "$HE_TIME_BUDGET_S" node /opt/harness/post-turn.mjs "$QM_CORE_URL" "$QM_SIGNING_SECRET" "$QM_ACTOR_ID" "$HE_TRIAL_ID" "$HE_WORKSPACE_DIR/instruction.md" "$HE_TIME_BUDGET_S" > "$HE_LOG_DIR/qm-turn.json"
code=$?
set -e
cat "$HE_LOG_DIR/qm-turn.json"

case "$code" in
  0) log "completed"; exit 0 ;;
  124|137) log "wall clock exceeded (HE_TIME_BUDGET_S=$HE_TIME_BUDGET_S)"; exit 124 ;;
  3) log "model error"; exit 3 ;;
  *) log "harness error (post-turn exit $code)"; exit 2 ;;
esac
