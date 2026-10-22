#!/usr/bin/env bash
# Hermes Agent adapter: one headless turn with `hermes chat --query-file`.
# Protocol: docs/adapters.md. Exit 0 completed, 2 harness error, 3 model
# error, 124 wall clock.
set -euo pipefail

: "${HE_WORKSPACE_DIR:=/workspace}"
: "${HE_SESSION_STATE_DIR:=/harness-state}"
: "${HE_LOG_DIR:?HE_LOG_DIR must be set}"
: "${HE_MODEL_BASE_URL:?HE_MODEL_BASE_URL must be set}"
: "${HE_MODEL_API_KEY:?HE_MODEL_API_KEY must be set}"
: "${HE_MODEL_NAME:=claude-sonnet-5-5}"
: "${HE_TIME_BUDGET_S:=300}"
: "${HE_TRIAL_ID:=unknown}"

mkdir -p "$HE_LOG_DIR"
exec > >(tee -a "$HE_LOG_DIR/stdout.log") 2> >(tee -a "$HE_LOG_DIR/stderr.log" >&2)
log() { printf '%s hermes[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }

if [ "${1:-run}" != "run" ]; then
  log "unknown entry point: ${1:-}; only 'run' is implemented"
  exit 2
fi
[ -r "$HE_WORKSPACE_DIR/instruction.md" ] || { log "no readable $HE_WORKSPACE_DIR/instruction.md"; exit 2; }

# HERMES_HOME holds config, memories, skills, sessions and logs: all state.
export HOME="$HE_SESSION_STATE_DIR"
export HERMES_HOME="$HE_SESSION_STATE_DIR/hermes"
mkdir -p "$HERMES_HOME"
[ -e "$HERMES_HOME/config.yaml" ] || cp /opt/harness/config/config.yaml "$HERMES_HOME/config.yaml"

# The anthropic provider reads these two variables; nothing is written to .env.
export ANTHROPIC_API_KEY="$HE_MODEL_API_KEY"
export ANTHROPIC_BASE_URL="$HE_MODEL_BASE_URL"

log "hermes $(hermes --version 2>/dev/null | head -1) model=anthropic/$HE_MODEL_NAME budget=${HE_TIME_BUDGET_S}s"

cd "$HE_WORKSPACE_DIR"
set +e
timeout -k 60 "$HE_TIME_BUDGET_S" hermes chat \
  --query-file "$HE_WORKSPACE_DIR/instruction.md" \
  --oneshot \
  --provider anthropic \
  --model "$HE_MODEL_NAME"
code=$?
set -e

case "$code" in
  0) log "completed"; exit 0 ;;
  124|137) log "wall clock exceeded (HE_TIME_BUDGET_S=$HE_TIME_BUDGET_S)"; exit 124 ;;
esac
if grep -Eqi 'metering proxy|AuthenticationError|PermissionDeniedError|RateLimitError|APIStatusError|APIConnectionError|InternalServerError|Error code: (401|402|403|404|429|5[0-9]{2})' "$HE_LOG_DIR/stdout.log" "$HE_LOG_DIR/stderr.log"; then
  log "model error (hermes exit $code)"; exit 3
fi
log "harness error (hermes exit $code)"; exit 2
