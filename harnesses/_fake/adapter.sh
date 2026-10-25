#!/usr/bin/env bash
# Fake harness adapter. It honours the adapter protocol in docs/adapters.md
# without calling a model, so the conformance test can check the protocol
# itself: exit codes, where state and logs go, that a run completes with
# stdin closed and no TTY, and the serve file queue.
#
# Behaviour is driven by markers in the text (instruction.md for run, the
# TurnRequest prompt for serve):
#   [fake:harness_error]        exit 2 before doing anything
#   [fake:model_error]          exit 3 (as if the proxy refused the call)
#   [fake:sleep N]              pretend the turn takes N seconds (for the wall clock)
#   [fake:call <tool> <json>]   serve only: call that world-MCP tool with those
#                               arguments as the bot (one marker per line)
#   [fake:gbrain <tool> <json>] serve only: call that gbrain tool through the
#                               world's gbrain tap (HE_GBRAIN_MCP_URL), the way
#                               a real harness with gbrain registered would
#   "hello.txt"                 run only: write "hello" to hello.txt in the workspace
set -euo pipefail

: "${HE_WORKSPACE_DIR:=/workspace}"
: "${HE_SESSION_STATE_DIR:=/harness-state}"
: "${HE_LOG_DIR:?HE_LOG_DIR must be set}"
: "${HE_TIME_BUDGET_S:=60}"
: "${HE_TRIAL_ID:=unknown}"

mkdir -p "$HE_LOG_DIR" "$HE_SESSION_STATE_DIR/fake"
exec > >(tee -a "$HE_LOG_DIR/stdout.log") 2> >(tee -a "$HE_LOG_DIR/stderr.log" >&2)

log() { printf '%s fake[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }
now() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }
# internal-task: the sha256 of this adapter file goes into the ready file, so a trial record can prove which adapter ran (the runner's
# preflight compares the same hash in the image with the checkout, HE-ADAPTER-005).
adapter_sha256=$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)

export HOME="$HE_SESSION_STATE_DIR"

# ---- serve: answer TurnRequest files until SIGTERM ------------------------------------------------

# The body of one serve turn, run under `timeout` so the wall clock applies.
# Arguments: request path, session key. Prints the reply on stdout.
serve_turn() {
  local req=$1 key=$2 prompt name turn ctype cid line tool args rpc out
  prompt=$(jq -r '.prompt' "$req")
  name=$(jq -r '.actor.name' "$req")
  turn=$(jq -r '.turn' "$req")
  ctype=$(jq -r '.channel.type' "$req")
  cid=$(jq -r '.channel.id' "$req")
  if [[ "$prompt" =~ \[fake:sleep\ ([0-9]+)\] ]]; then
    sleep "${BASH_REMATCH[1]}"
  fi
  if [[ "$prompt" == *"[fake:harness_error]"* ]]; then
    echo "fake: prompt asks for a harness error" >&2
    return 2
  fi
  if [[ "$prompt" == *"[fake:model_error]"* ]]; then
    echo "metering proxy: refused" >&2
    return 3
  fi
  while IFS= read -r line; do
    if [[ "$line" =~ \[fake:gbrain\ ([a-z_/]+)\ (\{.*\})\] ]]; then
      tool=${BASH_REMATCH[1]} args=${BASH_REMATCH[2]}
      if [ -z "${HE_GBRAIN_MCP_URL:-}" ] || [ -z "${HE_GBRAIN_MCP_TOKEN:-}" ]; then
        echo "fake: [fake:gbrain] needs HE_GBRAIN_MCP_URL and HE_GBRAIN_MCP_TOKEN" >&2
        return 2
      fi
      if [ "$tool" = "tools/list" ]; then
        rpc='{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
      else
        rpc=$(jq -cn --arg tool "$tool" --argjson args "$args" '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:$tool,arguments:$args}}')
      fi
      # gbrain answers with SSE-framed JSON-RPC; keep the data line.
      out=$(curl -sS --max-time 30 -X POST "$HE_GBRAIN_MCP_URL" \
        -H "Authorization: Bearer $HE_GBRAIN_MCP_TOKEN" -H 'content-type: application/json' \
        -H 'accept: application/json, text/event-stream' --data "$rpc" | sed -n 's/^data: //p; /^[{[]/p' | head -1) || { echo "fake: gbrain call failed" >&2; return 2; }
      printf '%s\n' "$out" >> "$HE_LOG_DIR/gbrain-calls.jsonl"
      echo "fake: gbrain $tool -> isError=$(printf '%s' "$out" | jq -c '.result.isError // false' 2>/dev/null || echo unparsed)" >&2
      continue
    fi
    [[ "$line" =~ \[fake:call\ ([a-z_]+)\ (\{.*\})\] ]] || continue
    tool=${BASH_REMATCH[1]} args=${BASH_REMATCH[2]}
    if [ -z "${HE_WORLD_MCP_URL:-}" ] || [ -z "${HE_WORLD_MCP_TOKEN:-}" ]; then
      echo "fake: [fake:call] needs HE_WORLD_MCP_URL and HE_WORLD_MCP_TOKEN" >&2
      return 2
    fi
    rpc=$(jq -cn --arg tool "$tool" --argjson args "$args" '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:$tool,arguments:$args}}')
    out=$(curl -sS --max-time 30 -X POST "$HE_WORLD_MCP_URL" \
      -H "Authorization: Bearer $HE_WORLD_MCP_TOKEN" -H 'content-type: application/json' \
      -H 'accept: application/json, text/event-stream' --data "$rpc") || { echo "fake: world-MCP call failed" >&2; return 2; }
    printf '%s\n' "$out" >> "$HE_LOG_DIR/world-mcp-calls.jsonl"
    echo "fake: world-MCP $tool -> isError=$(printf '%s' "$out" | jq -c '.result.isError // false')" >&2
  done <<< "$prompt"
  # Per-session state, as a real harness keeps between turns of one conversation.
  local sfile="$HE_SESSION_STATE_DIR/fake/sessions/$(printf '%s' "$key" | tr -c 'a-zA-Z0-9_.-' '_').json"
  mkdir -p "$(dirname "$sfile")"
  local count=0
  [ -r "$sfile" ] && count=$(jq -r '.turns' "$sfile")
  count=$((count + 1))
  jq -cn --arg key "$key" --argjson turns "$count" '{session:$key,turns:$turns}' > "$sfile"
  printf 'Hi %s. Fake harness answering turn %s in %s:%s (session %s, turn %s of this session).' "$name" "$turn" "$ctype" "$cid" "$key" "$count"
}

serve() {
  : "${HE_TURNS_DIR:=/he-turns}"
  mkdir -p "$HE_TURNS_DIR"
  local stopping=0
  trap 'stopping=1' TERM INT
  printf '{"trial":"%s","mode":"serve","model":"%s"}\n' "$HE_TRIAL_ID" "${HE_MODEL_NAME:-none}" > "$HE_SESSION_STATE_DIR/fake/session.json"
  export -f serve_turn
  export HE_LOG_DIR HE_SESSION_STATE_DIR HE_WORLD_MCP_URL HE_WORLD_MCP_TOKEN HE_GBRAIN_MCP_URL HE_GBRAIN_MCP_TOKEN
  # internal-task: under HE_GBRAIN_INSTALL=gbrain-docs the runner mounts the install bundle view read-only at HE_GBRAIN_INSTALL_DIR;
  # the fake harness applies nothing and reports what it was given, so a trial record can prove the mount.
  local install=''
  if [ "${HE_GBRAIN_INSTALL:-}" = "gbrain-docs" ]; then
    install=$(printf ',"gbrain_install":{"dir":"%s","split":"%s","files":%s,"writable":%s}' "${HE_GBRAIN_INSTALL_DIR:-}" "${HE_GBRAIN_SPLIT:-}" "$(find "${HE_GBRAIN_INSTALL_DIR:-/nonexistent}" -type f 2>/dev/null | wc -l | tr -d ' ')" "$(touch "${HE_GBRAIN_INSTALL_DIR:-/nonexistent}/.he-write-probe" 2>/dev/null && echo true || echo false)")
  fi
  printf '{"harness":"_fake","trial":"%s","ready_at":"%s","adapter_sha256":"%s","world_mcp":%s%s%s}\n' "$HE_TRIAL_ID" "$(now)" "$adapter_sha256" "$([ -n "${HE_WORLD_MCP_URL:-}" ] && echo true || echo false)" "$([ -n "${HE_GBRAIN_MCP_URL:-}" ] && echo ',"gbrain_mcp":true')" "$install" > "$HE_LOG_DIR/ready.tmp"
  mv "$HE_LOG_DIR/ready.tmp" "$HE_LOG_DIR/ready"
  log "serve: ready; polling $HE_TURNS_DIR"
  while [ "$stopping" -eq 0 ]; do
    local req resp base turn key budget started ended code reply detail tpid
    for req in "$HE_TURNS_DIR"/turn-*.request.json; do
      [ -e "$req" ] || continue
      base=${req%.request.json}
      resp="$base.response.json"
      [ -e "$resp" ] && continue
      turn=$(jq -r '.turn' "$req")
      budget=$(jq -r '.time_budget_s // empty' "$req")
      budget=${budget:-$HE_TIME_BUDGET_S}
      if [ "$(jq -r '.channel.type' "$req")" = "dm" ]; then
        key="dm:$(jq -r '.actor.member' "$req")"
      else
        key="channel:$(jq -r '.channel.id' "$req")"
      fi
      # A thread turn (thread_ts set; thread = "new" in task.toml) is a new session in the same conversation.
      tts=$(jq -r '.thread_ts // empty' "$req"); [ -n "$tts" ] && key="$key:t$tts"
      log "turn $turn: session $key, budget ${budget}s"
      started=$(now)
      # The turn runs in the background so a SIGTERM during it reaches the trap at once; the trap's
      # flag then ends the turn and the loop. A SIGTERM that lands between the log line above and the
      # wait sets the flag before the wait starts, and the wait would then sit through the whole turn,
      # so the flag is checked once more after the turn is spawned and the turn is killed at once.
      set +e
      timeout -k 5 "$budget" bash -c 'serve_turn "$1" "$2"' _ "$req" "$key" > "$resp.reply" 2>>"$HE_LOG_DIR/stderr.log" &
      tpid=$!
      [ "$stopping" -eq 0 ] || kill -TERM "$tpid" 2>/dev/null
      wait "$tpid"; code=$?
      if [ "$stopping" -eq 1 ] && { [ "$code" -eq 143 ] || kill -0 "$tpid" 2>/dev/null; }; then
        log "turn $turn: SIGTERM during the turn; stopping the harness"
        kill -TERM "$tpid" 2>/dev/null; wait "$tpid" 2>/dev/null; code=143
      fi
      set -e
      # A turn killed right after it was spawned may not have opened its reply file yet.
      reply=$(cat "$resp.reply" 2>/dev/null || true); rm -f "$resp.reply"
      ended=$(now)
      detail=""
      case "$code" in
        0) ;;
        124|137) code=124; detail="wall clock exceeded (${budget}s)"; reply="" ;;
        3) detail="model error"; reply="" ;;
        143) detail="stopped by SIGTERM during the turn"; code=2; reply="" ;;
        *) detail="harness error (inner exit $code)"; code=2; reply="" ;;
      esac
      jq -n --argjson turn "$turn" --argjson exit "$code" --arg reply "$reply" --arg started "$started" --arg ended "$ended" --arg detail "$detail" \
        '{turn:$turn, exit:$exit, reply_text:(if $exit == 0 then $reply else null end), started_at:$started, ended_at:$ended} + (if $detail == "" then {} else {detail:$detail} end)' \
        > "$resp.tmp"
      mv "$resp.tmp" "$resp"
      log "turn $turn: exit $code${detail:+ ($detail)}"
    done
    sleep 0.25
  done
  log "serve: stopped on signal"
  exit 0
}

case "${1:-run}" in
  run) ;;
  serve) serve ;;
  *) log "unknown entry point: ${1:-}; only 'run' and 'serve' are implemented (see docs/adapters.md)"; exit 2 ;;
esac

# ---- run: one headless turn from instruction.md ---------------------------------------------------

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
