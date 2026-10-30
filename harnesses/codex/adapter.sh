#!/usr/bin/env bash
# Codex CLI adapter. Protocol: docs/adapters.md. Exit 0 completed, 2 harness
# error, 3 model error, 124 wall clock.
#
#   run    one headless turn: "codex exec --json --skip-git-repo-check -C /workspace -" with
#          /workspace/instruction.md on stdin
#   serve  the multi-user entry: [mcp_servers.world] (and [mcp_servers.gbrain] on a
#          gbrain cell) is appended to the config and each server must answer
#          tools/list before ready; then every TurnRequest in HE_TURNS_DIR becomes one
#          "codex exec" turn for a session key seen for the first time (its thread id
#          is recorded from thread.started) or one "codex exec resume <thread id>" turn
#          for a key seen before, all in one CODEX_HOME, so Codex's own thread store
#          decides what carries across conversations.
#
# Exit mapping of one turn (pin.json exit_mapping):
#   0    codex exited 0 with turn.completed and no MCP transport error
#   124  the budget ran out: SIGTERM to the turn's process group, SIGKILL after the
#        grace (60 s for run, 5 s for serve), then every process the turn started is killed
#   3    turn.failed carries an HTTP status from the provider or the proxy: codex 0.165.0
#        prints "unexpected status NNN ..." or "last status: NNN" for most statuses, the raw
#        error body ({"error": ...}) for a 400 and "We're currently experiencing high demand"
#        for a 500; or the model endpoint could not be reached ("Connection failed: error
#        sending request", the proxy unreachable after the retries), as Claude Code and Hermes
#        map it; the interim "Reconnecting..." error events are ignored
#   2    anything else: an rmcp transport error (a failed mcp_tool_call item or rmcp on
#        stderr), a CLI version other than pin.json's, a crash, HE_MODEL_BASE_URL not ending
#        in /openai
set -euo pipefail

: "${HE_WORKSPACE_DIR:=/workspace}"
: "${HE_SESSION_STATE_DIR:=/harness-state}"
: "${HE_LOG_DIR:?HE_LOG_DIR must be set}"
: "${HE_MODEL_BASE_URL:?HE_MODEL_BASE_URL must be set}"
: "${HE_MODEL_API_KEY:?HE_MODEL_API_KEY must be set}"
: "${HE_MODEL_NAME:=gpt-6-luna}"
: "${HE_TIME_BUDGET_S:=300}"
: "${HE_TRIAL_ID:=unknown}"
# HE_SESSION_SCOPE=turn (the per-turn session cell, docs/adapters.md) is only implemented by the OpenClaw adapter;
# refusing it here keeps a cell that asks for it from silently running per-conversation sessions.
if [ "${HE_SESSION_SCOPE:-conversation}" != conversation ]; then echo "codex adapter: HE_SESSION_SCOPE=${HE_SESSION_SCOPE} is not supported (only the openclaw adapter keys sessions per turn)" >&2; exit 2; fi

mkdir -p "$HE_LOG_DIR"
exec > >(tee -a "$HE_LOG_DIR/stdout.log") 2> >(tee -a "$HE_LOG_DIR/stderr.log" >&2)
log() { printf '%s codex[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }
now() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }
# internal-task: the sha256 of this adapter file goes into the ready file, so a trial record can prove which adapter ran (the runner's
# preflight compares the same hash in the image with the checkout, HE-ADAPTER-005).
adapter_sha256=$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)
harness_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
pin_version=$(jq -r '.version' "$harness_dir/pin.json")

entry=${1:-run}
case "$entry" in
  run|serve) ;;
  *) log "unknown entry point: $entry; 'run' and 'serve' are implemented"; exit 2 ;;
esac

# The he-proxy provider speaks the OpenAI Responses API only, so the runner's proxy route must be the openai provider's
# (<proxy>/<slot>/openai, runner/trial/proxy.ts baseUrlFor). A cell on another provider stops here instead of sending
# Responses requests to that provider's route.
case "${HE_MODEL_BASE_URL%/}" in
  */openai) ;;
  *) log "HE_MODEL_BASE_URL $HE_MODEL_BASE_URL does not end in /openai: codex runs only on an openai cell (the proxy route <proxy>/<slot>/openai)"; exit 2 ;;
esac

# The install ladder (docs/gbrain-arm.md) has no documented install for Codex: the docs and installer rungs are not
# planned for this harness, so a cell that asks for one stops before ready instead of running without it.
if [ -n "${HE_GBRAIN_INSTALL:-}" ]; then
  msg="HE-ADAPTER-006 the install bundle could not be applied: the codex adapter has no documented install for HE_GBRAIN_INSTALL=$HE_GBRAIN_INSTALL (the install ladder is not planned for codex); fix: run this cell without gbrain.install"
  jq -n --arg install "$HE_GBRAIN_INSTALL" --arg split "${HE_GBRAIN_SPLIT:-}" --arg dir "${HE_GBRAIN_INSTALL_DIR:-/he-gbrain-install}" --arg error "$msg" \
    '{status:"error", code:"HE-ADAPTER-006", harness:"codex", split:$split, install:$install, dir:$dir, view_digest:null, files:0, destinations:[], copied:[], error:$error}' > "$HE_LOG_DIR/gbrain-install.json"
  log "$msg"
  exit 2
fi

# CODEX_HOME holds config.toml, the thread store (sessions/ and the state and thread history databases), skills and logs:
# all state. TMPDIR moves Codex's scratch files off the image.
export HOME="$HE_SESSION_STATE_DIR"
export CODEX_HOME="$HE_SESSION_STATE_DIR/codex"
export TMPDIR="$HE_SESSION_STATE_DIR/tmp"
mkdir -p "$CODEX_HOME" "$TMPDIR"
threads="$HE_SESSION_STATE_DIR/codex-threads.json"

cli_version() { local v; v=$(codex --version 2>/dev/null || true); v=${v%%$'\n'*}; printf '%s' "${v##* }"; }
version=$(cli_version)
log "codex-cli ${version:-unknown} (pin.json $pin_version) model=he-proxy/$HE_MODEL_NAME budget=${HE_TIME_BUDGET_S}s entry=$entry"
[ "$version" = "$pin_version" ] || { log "codex-cli ${version:-unknown} is not the pinned $pin_version"; exit 2; }

# config.toml from the template and pin.json codex_config: the cell model in every model key Codex reads, the proxy as the
# only provider (base URL HE_MODEL_BASE_URL/v1, the per-trial token from HE_MODEL_API_KEY), low retry counts.
jq -Rjs --slurpfile pin "$harness_dir/pin.json" --arg model "$HE_MODEL_NAME" --arg base "${HE_MODEL_BASE_URL%/}/v1" '
  $pin[0].codex_config as $c
  | gsub("@MODEL@"; $model | tojson) | gsub("@BASE_URL@"; $base | tojson) | gsub("@EFFORT@"; $c.model_reasoning_effort | tojson)
  | gsub("@REQUEST_RETRIES@"; $c.request_max_retries | tostring) | gsub("@STREAM_RETRIES@"; $c.stream_max_retries | tostring)
' "$harness_dir/config/config.toml" > "$CODEX_HOME/config.toml.tmp"

# One MCP server block: Streamable HTTP, the bearer read by Codex from the named variable, required so a server that does
# not start fails the turn instead of leaving the harness without its tools.
mcp_block() {
  jq -rn --arg name "$1" --arg url "$2" --arg var "$3" \
    '"\n[mcp_servers.\($name)]\nurl = \($url | tojson)\nbearer_token_env_var = \($var | tojson)\nstartup_timeout_sec = 60\ntool_timeout_sec = 120\nrequired = true"'
}

# tools/list as the bot, before ready: a server that does not answer with tools is a harness error (exit 2), the way QM's
# core probes before saving. The tool names are kept as $HE_LOG_DIR/mcp-probe.<name>.json.
mcp_probe() {
  local name=$1 url=$2 token=$3 out names
  out=$(curl -sS --max-time 30 -X POST "$url" -H "Authorization: Bearer $token" -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' 2>&1) \
    || { log "MCP $name: tools/list failed: ${out:0:200}"; return 1; }
  out=$(printf '%s\n' "$out" | sed -n 's/^data: //p; /^[{[]/p' | head -1)
  names=$(printf '%s' "$out" | jq -c '[.result.tools[]?.name]' 2>/dev/null || echo '[]')
  if [ "$names" = '[]' ]; then log "MCP $name: tools/list returned no tools: ${out:0:200}"; return 1; fi
  printf '%s\n' "$names" > "$HE_LOG_DIR/mcp-probe.$name.json"
  log "MCP $name: tools/list ok, $(printf '%s' "$names" | jq 'length') tools"
}

mcp_servers='[]'
if [ "$entry" = serve ]; then
  [ -n "${HE_WORLD_MCP_URL:-}" ] && [ -n "${HE_WORLD_MCP_TOKEN:-}" ] || { log "serve needs HE_WORLD_MCP_URL and HE_WORLD_MCP_TOKEN"; exit 2; }
  mcp_block world "$HE_WORLD_MCP_URL" HE_WORLD_MCP_TOKEN >> "$CODEX_HOME/config.toml.tmp"
  mcp_probe world "$HE_WORLD_MCP_URL" "$HE_WORLD_MCP_TOKEN" || exit 2
  mcp_servers='["world"]'
  # The gbrain arm (docs/gbrain-arm.md): with HE_GBRAIN_MCP_URL and HE_GBRAIN_MCP_TOKEN set, [mcp_servers.gbrain] goes in
  # beside world with the same shape (the URL is the world's /gbrain tap, the token the bot token). Unset, the config is
  # byte-identical to a cell without gbrain.
  if [ -n "${HE_GBRAIN_MCP_URL:-}" ] && [ -n "${HE_GBRAIN_MCP_TOKEN:-}" ]; then
    mcp_block gbrain "$HE_GBRAIN_MCP_URL" HE_GBRAIN_MCP_TOKEN >> "$CODEX_HOME/config.toml.tmp"
    mcp_probe gbrain "$HE_GBRAIN_MCP_URL" "$HE_GBRAIN_MCP_TOKEN" || exit 2
    mcp_servers='["world","gbrain"]'
  fi
fi
mv "$CODEX_HOME/config.toml.tmp" "$CODEX_HOME/config.toml"
log "config written to $CODEX_HOME/config.toml (mcp_servers $mcp_servers)"

cd "$HE_WORKSPACE_DIR"
stopping=0
cpid=''
trap 'stopping=1' TERM INT

# Every process a turn starts carries HE_CODEX_TURN=<marker> in its environment, including the PTY sessions Codex's
# exec_command opens in their own session (outside the process group); after the turn they are all killed.
sweep() {
  local p
  for p in /proc/[0-9]*; do
    [ "${p#/proc/}" = "$$" ] && continue
    if tr '\0' '\n' 2>/dev/null < "$p/environ" | grep -qxF "HE_CODEX_TURN=$1"; then kill -KILL "${p#/proc/}" 2>/dev/null || true; fi
  done
}

record_thread() {
  local tmp="$threads.tmp.$$"
  { if [ -s "$threads" ]; then cat "$threads"; else echo '{}'; fi; } | jq --arg k "$1" --arg v "$2" '.[$k] = $v' > "$tmp"
  mv "$tmp" "$threads"
}

http_status() {
  local m=$1
  if [[ $m =~ unexpected\ status\ ([0-9]{3}) ]] || [[ $m =~ last\ status:\ ([0-9]{3}) ]]; then printf '%s' "${BASH_REMATCH[1]}"
  elif [[ $m =~ ^[[:space:]]*\{[[:space:]]*\"error\"[[:space:]]*: ]]; then printf 400
  elif [[ $m == *"experiencing high demand"* ]]; then printf 500
  fi
}

# One Codex turn. Arguments: prompt file, session key (empty for run), file stem, budget, kill grace. Sets turn_code and
# turn_detail; the reply is in <stem>.reply.txt, the JSONL events in <stem>.codex.jsonl, a summary in <stem>.status.json.
codex_turn() {
  local prompt=$1 key=$2 stem=$3 budget=$4 grace=$5
  local events="$stem.codex.jsonl" err="$stem.stderr.log" thread='' marker deadline timed_out=0 stopped=0 code v status failed st
  local -a args
  turn_detail=''
  : > "$stem.reply.txt"
  v=$(cli_version)
  log "turn ${stem##*/}: codex-cli ${v:-unknown}"
  if [ "$v" != "$pin_version" ]; then turn_code=2; turn_detail="codex-cli ${v:-unknown} is not the pinned $pin_version"; return; fi
  if [ -n "$key" ] && [ -s "$threads" ]; then thread=$(jq -r --arg k "$key" '.[$k] // empty' "$threads"); fi
  if [ -n "$thread" ]; then
    args=(exec resume "$thread" --json --skip-git-repo-check --strict-config -)
  else
    args=(exec --json --skip-git-repo-check --strict-config -C "$HE_WORKSPACE_DIR" -)
  fi
  marker="$HE_TRIAL_ID.${stem##*/}.$$.$RANDOM"
  HE_CODEX_TURN="$marker" setsid codex "${args[@]}" < "$prompt" > "$events" 2> "$err" &
  cpid=$!
  deadline=$((SECONDS + budget))
  while kill -0 "$cpid" 2>/dev/null; do
    if [ "$stopping" -eq 1 ]; then stopped=1; break; fi
    if [ "$SECONDS" -ge "$deadline" ]; then timed_out=1; break; fi
    sleep 0.2
  done
  if [ "$stopped" -eq 1 ] || [ "$timed_out" -eq 1 ]; then
    kill -TERM -- "-$cpid" 2>/dev/null || true
    for _ in $(seq $((grace * 5))); do kill -0 "$cpid" 2>/dev/null || break; sleep 0.2; done
    kill -KILL -- "-$cpid" 2>/dev/null || true
  fi
  set +e; wait "$cpid"; code=$?; set -e
  cpid=''
  sweep "$marker"
  cat "$err" >&2 || true
  status=$(jq -Rsc --arg code "$code" '
    split("\n") | map(fromjson? // empty) as $ev
    | ($ev | map(select(.type == "item.completed") | .item)) as $items
    | {codex_exit: ($code | tonumber),
       thread_id: ($ev | map(select(.type == "thread.started") | .thread_id) | first),
       completed: ($ev | any(.type == "turn.completed")),
       failed: ($ev | map(select(.type == "turn.failed") | .error.message // "") | last),
       reply: ($items | map(select(.type == "agent_message") | .text) | last),
       mcp_transport_errors: ($items | map(select(.type == "mcp_tool_call" and ((.error.message // "") | test("Transport (send )?error|rmcp::transport")))) | length),
       usage: ($ev | map(select(.type == "turn.completed") | .usage) | last)}' "$events")
  printf '%s\n' "$status" > "$stem.status.json"
  printf '%s' "$status" | jq -j '.reply // ""' > "$stem.reply.txt"
  if [ -n "$key" ] && [ -z "$thread" ]; then
    thread=$(printf '%s' "$status" | jq -r '.thread_id // empty')
    if [ -n "$thread" ]; then record_thread "$key" "$thread"; log "session $key -> thread $thread"; fi
  fi
  failed=$(printf '%s' "$status" | jq -r '.failed // empty')
  if [ "$timed_out" -eq 1 ]; then turn_code=124; turn_detail="wall clock exceeded (${budget}s)"
  elif [ "$stopped" -eq 1 ]; then turn_code=143; turn_detail="stopped by SIGTERM during the turn"
  elif [ "$(printf '%s' "$status" | jq -r '.mcp_transport_errors')" -gt 0 ] || grep -Eq 'rmcp::transport|Transport \[codex_rmcp_client' "$err"; then
    turn_code=2; turn_detail="MCP transport error"
  elif [ -n "$failed" ]; then
    st=$(http_status "$failed")
    if [ -n "$st" ]; then turn_code=3; turn_detail="model error (HTTP $st)"
    elif [[ $failed == *"Connection failed: error sending request"* ]]; then turn_code=3; turn_detail="model error (the model endpoint is unreachable: ${failed:0:200})"
    else turn_code=2; turn_detail="harness error: ${failed:0:200}"; fi
  elif [ "$code" -eq 0 ] && [ "$(printf '%s' "$status" | jq -r '.completed')" = true ]; then turn_code=0
  else turn_code=2; turn_detail="harness error (codex exit $code)"
  fi
}

if [ "$entry" = run ]; then
  [ -r "$HE_WORKSPACE_DIR/instruction.md" ] || { log "no readable $HE_WORKSPACE_DIR/instruction.md"; exit 2; }
  codex_turn "$HE_WORKSPACE_DIR/instruction.md" '' "$HE_LOG_DIR/run" "$HE_TIME_BUDGET_S" 60
  [ "$turn_code" -ne 143 ] || turn_code=2
  log "exit $turn_code${turn_detail:+ ($turn_detail)}"
  exit "$turn_code"
fi

# ---- serve ----------------------------------------------------------------------------------------
: "${HE_TURNS_DIR:=/he-turns}"
mkdir -p "$HE_TURNS_DIR" "$HE_LOG_DIR/turns"
printf '{"harness":"codex","version":"%s","trial":"%s","ready_at":"%s","session_keys":"codex exec (first turn of a key) | codex exec resume <thread id>; dm:<member> | channel:<id>","mcp_servers":%s,"adapter_sha256":"%s"}\n' \
  "$version" "$HE_TRIAL_ID" "$(now)" "$mcp_servers" "$adapter_sha256" > "$HE_LOG_DIR/ready.tmp"
mv "$HE_LOG_DIR/ready.tmp" "$HE_LOG_DIR/ready"
log "serve: ready; polling $HE_TURNS_DIR"
while [ "$stopping" -eq 0 ]; do
  for req in "$HE_TURNS_DIR"/turn-*.request.json; do
    [ -e "$req" ] || continue
    [ "$stopping" -eq 0 ] || break
    base=${req%.request.json}; name=$(basename "$base"); resp="$base.response.json"
    [ -e "$resp" ] && continue
    turn=$(jq -r '.turn' "$req")
    budget=$(jq -r '.time_budget_s // empty' "$req"); budget=${budget:-$HE_TIME_BUDGET_S}
    # A thread turn (thread_ts set; thread = "new" in task.toml) is a new session in the same conversation.
    key=$(jq -r 'if .channel.type == "dm" then "dm:" + .actor.member else "channel:" + .channel.id end + (if .thread_ts then ":t" + (.thread_ts | tostring) else "" end)' "$req")
    jq -j '.prompt' "$req" > "$HE_LOG_DIR/turns/$name.prompt.md"
    log "turn $turn: session $key, budget ${budget}s"
    started=$(now)
    codex_turn "$HE_LOG_DIR/turns/$name.prompt.md" "$key" "$HE_LOG_DIR/turns/$name" "$budget" 5
    ended=$(now)
    code=$turn_code
    [ "$code" -ne 143 ] || code=2
    jq -n --argjson turn "$turn" --argjson exit "$code" --rawfile reply "$HE_LOG_DIR/turns/$name.reply.txt" --arg started "$started" --arg ended "$ended" --arg detail "$turn_detail" \
      '{turn:$turn, exit:$exit, reply_text:(if $exit == 0 then $reply else null end), started_at:$started, ended_at:$ended} + (if $detail == "" then {} else {detail:$detail} end)' > "$resp.tmp"
    mv "$resp.tmp" "$resp"
    log "turn $turn: exit $code${turn_detail:+ ($turn_detail)}"
  done
  sleep 0.25
done
log "serve: stopped on signal"
exit 0
