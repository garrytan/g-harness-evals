#!/usr/bin/env bash
# Fake harness adapter. It honours the adapter protocol in docs/adapters.md
# without calling a model, so the conformance test can check the protocol
# itself: exit codes, where state and logs go, and that a run completes with
# stdin closed and no TTY.
#
# Behaviour is driven by markers in instruction.md:
#   [fake:harness_error]   exit 2 before doing anything
#   [fake:model_error]     exit 3 (as if the proxy refused the call)
#   [fake:sleep N]         pretend the turn takes N seconds (for the wall clock)
#   "hello.txt"            write "hello" to hello.txt in the workspace
set -euo pipefail

: "${HE_WORKSPACE_DIR:=/workspace}"
: "${HE_SESSION_STATE_DIR:=/harness-state}"
: "${HE_LOG_DIR:?HE_LOG_DIR must be set}"
: "${HE_TIME_BUDGET_S:=60}"
: "${HE_TRIAL_ID:=unknown}"

mkdir -p "$HE_LOG_DIR" "$HE_SESSION_STATE_DIR/fake"
exec > >(tee -a "$HE_LOG_DIR/stdout.log") 2> >(tee -a "$HE_LOG_DIR/stderr.log" >&2)

log() { printf '%s fake[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }

if [ "${1:-run}" != "run" ]; then
  log "unknown entry point: ${1:-}; only 'run' is implemented (see docs/adapters.md)"
  exit 2
fi

instruction="$HE_WORKSPACE_DIR/instruction.md"
if [ ! -r "$instruction" ]; then
  log "no readable $instruction"
  exit 2
fi
text=$(cat "$instruction")

if [[ "$text" == *"[fake:harness_error]"* ]]; then
  log "instruction asks for a harness error"
  exit 2
fi

# State lives in /harness-state, like a real harness's HOME.
printf '{"trial":"%s","turns":1,"model":"%s"}\n' "$HE_TRIAL_ID" "${HE_MODEL_NAME:-none}" > "$HE_SESSION_STATE_DIR/fake/session.json"
export HOME="$HE_SESSION_STATE_DIR"

turn() {
  if [[ "$text" =~ \[fake:sleep\ ([0-9]+)\] ]]; then
    sleep "${BASH_REMATCH[1]}"
  fi
  if [[ "$text" == *"[fake:model_error]"* ]]; then
    echo "metering proxy: refused" >&2
    return 3
  fi
  if [[ "$text" == *"hello.txt"* ]]; then
    printf 'hello' > "$HE_WORKSPACE_DIR/hello.txt"
  fi
  echo "fake turn complete"
}

export text HE_WORKSPACE_DIR
set +e
timeout -k 5 "$HE_TIME_BUDGET_S" bash -c "$(declare -f turn); turn"
code=$?
set -e

case "$code" in
  0) log "completed"; exit 0 ;;
  124|137) log "wall clock exceeded (HE_TIME_BUDGET_S=$HE_TIME_BUDGET_S)"; exit 124 ;;
  3) log "model error"; exit 3 ;;
  *) log "harness error (inner exit $code)"; exit 2 ;;
esac
