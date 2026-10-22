#!/usr/bin/env bash
# Hermes Agent adapter. Protocol: docs/adapters.md. Exit 0 completed, 2
# harness error, 3 model error, 124 wall clock.
#
#   run    one headless turn with `hermes chat --query-file` on /workspace/instruction.md
#   serve  the multi-user entry: the world-MCP server is appended to the
#          config copy under mcp_servers.world, then every TurnRequest in
#          HE_TURNS_DIR becomes one `hermes chat -c <key> --create-if-missing`
#          turn in the named session dm:<member> or channel:<id>, all in the
#          same HERMES_HOME, so Hermes's own session store and memory decide
#          what carries across conversations.
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
now() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }

entry=${1:-run}
case "$entry" in
  run|serve) ;;
  *) log "unknown entry point: $entry; 'run' and 'serve' are implemented"; exit 2 ;;
esac

# HERMES_HOME holds config, memories, skills, sessions and logs: all state.
export HOME="$HE_SESSION_STATE_DIR"
export HERMES_HOME="$HE_SESSION_STATE_DIR/hermes"
mkdir -p "$HERMES_HOME"
[ -e "$HERMES_HOME/config.yaml" ] || cp /opt/harness/config/config.yaml "$HERMES_HOME/config.yaml"

# The anthropic provider reads these two variables; nothing is written to .env.
export ANTHROPIC_API_KEY="$HE_MODEL_API_KEY"
export ANTHROPIC_BASE_URL="$HE_MODEL_BASE_URL"

log "hermes $(hermes --version 2>/dev/null | head -1) model=anthropic/$HE_MODEL_NAME budget=${HE_TIME_BUDGET_S}s entry=$entry"

# A model error is a proxy refusal, an Anthropic SDK error class or an HTTP status on stderr or in
# the result record; everything else that fails is Hermes's.
model_error_pattern='metering proxy|AuthenticationError|PermissionDeniedError|RateLimitError|APIStatusError|APIConnectionError|InternalServerError|Error code: (401|402|403|404|429|5[0-9]{2})|HTTP (401|402|403|404|429|5[0-9]{2})'

cd "$HE_WORKSPACE_DIR"

if [ "$entry" = "run" ]; then
  [ -r "$HE_WORKSPACE_DIR/instruction.md" ] || { log "no readable $HE_WORKSPACE_DIR/instruction.md"; exit 2; }
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
  if grep -Eqi "$model_error_pattern" "$HE_LOG_DIR/stdout.log" "$HE_LOG_DIR/stderr.log"; then
    log "model error (hermes exit $code)"; exit 3
  fi
  log "harness error (hermes exit $code)"; exit 2
fi

# ---- serve ----------------------------------------------------------------------------------------
: "${HE_TURNS_DIR:=/he-turns}"
[ -n "${HE_WORLD_MCP_URL:-}" ] && [ -n "${HE_WORLD_MCP_TOKEN:-}" ] || { log "serve needs HE_WORLD_MCP_URL and HE_WORLD_MCP_TOKEN"; exit 2; }
mkdir -p "$HE_TURNS_DIR" "$HE_LOG_DIR/turns"

# The world-MCP server goes into mcp_servers.world of the config copy (Streamable HTTP with the
# per-trial bot token the world minted; in the redaction set). Hermes connects on the first turn
# and registers the server's tools as mcp__world__<tool>.
if ! grep -q '^mcp_servers:' "$HERMES_HOME/config.yaml"; then
  HE_WORLD_MCP_URL="$HE_WORLD_MCP_URL" HE_WORLD_MCP_TOKEN="$HE_WORLD_MCP_TOKEN" python3 - "$HERMES_HOME/config.yaml" <<'PY'
import json, os, sys
path = sys.argv[1]
block = "\nmcp_servers:\n  world:\n    url: %s\n    headers:\n      Authorization: %s\n    timeout: 120\n    connect_timeout: 60\n" % (
    json.dumps(os.environ["HE_WORLD_MCP_URL"]), json.dumps("Bearer " + os.environ["HE_WORLD_MCP_TOKEN"]))
with open(path, "a") as f:
    f.write(block)
PY
fi
log "world-MCP wired into $HERMES_HOME/config.yaml#mcp_servers.world"

# One serve turn: write the prompt to a file under HE_LOG_DIR and run a quiet one-shot turn in the
# conversation's named session, with newline-delimited JSON events on stdout. Arguments: request
# path, session key, turn name, budget. Returns the mapped exit code; the reply text is in
# <turn>.reply.txt.
serve_turn() {
  local req=$1 key=$2 name=$3 budget=$4 code
  local prompt="$HE_LOG_DIR/turns/$name.prompt.md" events="$HE_LOG_DIR/turns/$name.hermes.jsonl" err="$HE_LOG_DIR/turns/$name.stderr.log"
  python3 -c 'import json,sys; sys.stdout.write(json.load(open(sys.argv[1]))["prompt"])' "$req" > "$prompt"
  set +e
  # --run-budget is Hermes's own soft budget; the outer timeout is the hard one and fires inside
  # the runner's 60 s grace.
  timeout -k 5 "$((budget + 10))" hermes chat \
    --query-file "$prompt" \
    --continue "$key" --create-if-missing \
    --oneshot --quiet --format stream-json \
    --provider anthropic \
    --model "$HE_MODEL_NAME" \
    --run-budget "$budget" > "$events" 2> >(tee -a "$err" >&2)
  code=$?
  set -e
  python3 - "$events" "$HE_LOG_DIR/turns/$name.reply.txt" "$HE_LOG_DIR/turns/$name.status.json" <<'PY'
import json, sys
events, reply_path, status_path = sys.argv[1:4]
result, texts = None, []
for line in open(events, encoding="utf-8"):
    line = line.strip()
    if not line:
        continue
    try:
        ev = json.loads(line)
    except ValueError:
        continue
    if ev.get("type") == "result":
        result = ev
    elif ev.get("type") == "text":
        texts.append(str(ev.get("text", "")))
text = (result or {}).get("text") or "".join(texts)
open(reply_path, "w", encoding="utf-8").write(text.strip())
json.dump({"exit_code": (result or {}).get("exit_code"), "error": (result or {}).get("error"), "tokens": (result or {}).get("tokens")}, open(status_path, "w"))
PY
  case "$code" in
    0) return 0 ;;
    124|137) return 124 ;;
  esac
  if grep -Eqi "$model_error_pattern" "$err" "$HE_LOG_DIR/turns/$name.status.json"; then return 3; fi
  return 2
}

write_response() {
  python3 - "$@" <<'PY'
import json, os, sys
resp, turn, code, reply_file, started, ended, detail = sys.argv[1:8]
exit_code = int(code)
out = {"turn": int(turn), "exit": exit_code, "reply_text": open(reply_file, encoding="utf-8").read() if exit_code == 0 else None,
       "started_at": started, "ended_at": ended}
if detail:
    out["detail"] = detail
with open(resp + ".tmp", "w", encoding="utf-8") as f:
    json.dump(out, f)
os.rename(resp + ".tmp", resp)
PY
}

stopping=0
trap 'stopping=1' TERM INT
printf '{"harness":"hermes","version":"%s","trial":"%s","ready_at":"%s","session_keys":"hermes chat -c dm:<member> | channel:<id>"}\n' "${HERMES_VERSION:-}" "$HE_TRIAL_ID" "$(now)" > "$HE_LOG_DIR/ready.tmp"
mv "$HE_LOG_DIR/ready.tmp" "$HE_LOG_DIR/ready"
log "serve: ready; polling $HE_TURNS_DIR"
while [ "$stopping" -eq 0 ]; do
  for req in "$HE_TURNS_DIR"/turn-*.request.json; do
    [ -e "$req" ] || continue
    base=${req%.request.json}; name=$(basename "$base"); resp="$base.response.json"
    [ -e "$resp" ] && continue
    read -r turn budget key < <(python3 -c '
import json, os, sys
r = json.load(open(sys.argv[1]))
key = "dm:" + r["actor"]["member"] if r["channel"]["type"] == "dm" else "channel:" + r["channel"]["id"]
print(r["turn"], r.get("time_budget_s") or os.environ["HE_TIME_BUDGET_S"], key)
' "$req")
    log "turn $turn: session $key, budget ${budget}s"
    started=$(now)
    set +e
    serve_turn "$req" "$key" "$name" "$budget" &
    tpid=$!
    wait "$tpid"; code=$?
    if [ "$stopping" -eq 1 ] && kill -0 "$tpid" 2>/dev/null; then
      log "turn $turn: SIGTERM during the turn; stopping hermes"
      pkill -TERM -P "$tpid" 2>/dev/null; kill -TERM "$tpid" 2>/dev/null; wait "$tpid"; code=143
    fi
    set -e
    ended=$(now)
    detail=""
    case "$code" in
      0) ;;
      124) detail="wall clock exceeded (${budget}s)" ;;
      3) detail="model error" ;;
      143) code=2; detail="stopped by SIGTERM during the turn" ;;
      *) code=2; detail="harness error" ;;
    esac
    write_response "$resp" "$turn" "$code" "$HE_LOG_DIR/turns/$name.reply.txt" "$started" "$ended" "$detail"
    log "turn $turn: exit $code${detail:+ ($detail)}"
  done
  sleep 0.25
done
log "serve: stopped on signal"
exit 0
