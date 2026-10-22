#!/usr/bin/env bash
# OpenClaw adapter: one headless turn with `openclaw agent exec`.
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
log() { printf '%s openclaw[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }

if [ "${1:-run}" != "run" ]; then
  log "unknown entry point: ${1:-}; only 'run' is implemented"
  exit 2
fi
[ -r "$HE_WORKSPACE_DIR/instruction.md" ] || { log "no readable $HE_WORKSPACE_DIR/instruction.md"; exit 2; }

# All OpenClaw state (config copy, sessions, agent dirs, credentials) lives
# under /harness-state. The config template is read-only in the image.
export HOME="$HE_SESSION_STATE_DIR"
export OPENCLAW_STATE_DIR="$HE_SESSION_STATE_DIR/openclaw"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_STATE_DIR/openclaw.json"
mkdir -p "$OPENCLAW_STATE_DIR/exec"
[ -e "$OPENCLAW_CONFIG_PATH" ] || cp /opt/harness/config/openclaw.json "$OPENCLAW_CONFIG_PATH"

log "openclaw $(openclaw --version 2>/dev/null | head -1) model=anthropic/$HE_MODEL_NAME budget=${HE_TIME_BUDGET_S}s"

set +e
timeout -k 60 "$HE_TIME_BUDGET_S" openclaw agent exec \
  --message-file "$HE_WORKSPACE_DIR/instruction.md" \
  --cwd "$HE_WORKSPACE_DIR" \
  --config "$OPENCLAW_CONFIG_PATH" \
  --state-dir "$OPENCLAW_STATE_DIR/exec" \
  --model "anthropic/$HE_MODEL_NAME" \
  --timeout "$HE_TIME_BUDGET_S" \
  --json > "$HE_LOG_DIR/openclaw-exec.json"
code=$?
set -e

# openclaw agent exec: 0 completed, 1 model or result error, 2 its own timeout.
case "$code" in
  0) log "completed"; exit 0 ;;
  124|137) log "wall clock exceeded (HE_TIME_BUDGET_S=$HE_TIME_BUDGET_S)"; exit 124 ;;
esac
if grep -Eqi '"status":\s*(401|402|403|404|429|5[0-9]{2})|metering proxy|rate.?limit|overloaded|api error|authentication|invalid.*api.?key' "$HE_LOG_DIR/openclaw-exec.json" "$HE_LOG_DIR/stderr.log"; then
  log "model error (openclaw exit $code)"; exit 3
fi
log "harness error (openclaw exit $code)"; exit 2
