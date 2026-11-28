#!/usr/bin/env bash
# DeepSeek Harness (dsh) adapter. Protocol: docs/adapters.md. Exit 0 completed, 2 harness error, 3 model error,
# 124 wall clock.
#
#   run    one headless turn: "dsh --profile headless --json --permission-mode workspace-write --approval-policy never -"
#          with /workspace/instruction.md on stdin, cwd /workspace
#   serve  the multi-user entry: the world MCP server (and gbrain on a gbrain cell) is inserted into the profile as a
#          @deepseek-ai/dsh-mcp-client row and must answer tools/list before ready; then every TurnRequest in HE_TURNS_DIR
#          becomes one headless invocation, a fresh Session for a session key seen for the first time (its id is recorded
#          from the opening session event) or "--session-id <id>" for a key seen before, all under one DSH_HOME, so dsh's
#          own session store decides what carries across conversations.
#
# The profile: $DSH_HOME/profiles/headless/cordis.patch.yml, rendered here from config/route.<route>.patch.yml (the cell's
# route, the last segment of HE_MODEL_BASE_URL: anthropic, openai, particle or openrouter), config/base.patch.yml and, under
# serve, the MCP rows. The token is named by variable (apiKeyEnv HE_MODEL_API_KEY; the MCP bearer as a !!js read of
# HE_WORLD_MCP_TOKEN), so the file holds no credential.
#
# Exit mapping of one turn (pin.json exit_mapping):
#   0    dsh exited 0 and the final event says reason.kind completed
#   124  the budget ran out: SIGTERM to the turn's process group, SIGKILL after the grace (60 s for run, 5 s for serve)
#   3    the final event's error is a provider or proxy HTTP status ("NNN: <body>", pi-ai's message for any 4xx or 5xx,
#        after dsh's own retries) or code TRANSPORT (the model endpoint could not be reached)
#   2    anything else: another error code (MISSING_CREDENTIAL, UNKNOWN_MODEL, ...), an error event outside a turn, no final
#        event, a dsh version other than pin.json's, an unsupported route or config
set -euo pipefail

# >>> stop supervisor: the same lines in every bash adapter (tests/adapter-stop.test.ts checks them)
# bash 5.2 drops a trap that fires while it parses a $(...), and under set -e the adapter then exits 2 instead of stopping
# (fixed in bash 5.3). As container PID 1, which is how every trial runs it, the adapter keeps the trap 'stopping=1' below
# and nothing here runs: no worker and no stop file, so a trial stops and survives in-container kills exactly as before.
# Anywhere else (the process harness, the keyless tests), the process that gets the signal runs this file again as a worker
# and only waits. Once the worker passes the line where the trap is set (HE_STOP_FILE.armed), the supervisor turns SIGTERM
# or SIGINT into the file HE_STOP_FILE, which he_stop_check copies into stopping; before it, the signal goes on to the
# worker. The supervisor sets its traps before it starts the worker, and a signal that comes before the worker can take it
# stays pending: the supervisor sends it again every 0.05 s until the worker exits or passes that line. The worker keeps
# the arguments, stdin, directory and environment of a plain run, with SIGINT and SIGQUIT not ignored, dies with the
# supervisor where setpriv is installed, and its exit code is the supervisor's. Two limits off PID 1: a signal sent to the
# whole process group also reaches the worker, which then ends as a run with no trap would, and without setpriv a SIGKILL
# of the supervisor leaves the worker running.
if [ "$$" -eq 1 ]; then
  unset HE_STOP_FILE HE_STOP_SUPERVISOR
elif [ -n "${HE_STOP_FILE:-}" ] && [ "${HE_STOP_SUPERVISOR:-}" = "$PPID" ]; then
  export -n HE_STOP_FILE HE_STOP_SUPERVISOR
else
  he_stop_dir=$(mktemp -d "${TMPDIR:-/tmp}/he-stop.XXXXXX"); case $he_stop_dir in /*) ;; *) he_stop_dir=$PWD/$he_stop_dir ;; esac
  HE_STOP_FILE=$he_stop_dir/stop; HE_STOP_SUPERVISOR=$$
  export HE_STOP_FILE HE_STOP_SUPERVISOR
  he_worker='' he_pending=''
  he_signal() {
    if [ -e "$HE_STOP_FILE.armed" ]; then he_pending=''; : > "$HE_STOP_FILE"; else he_pending=$1; [ -z "$he_worker" ] || kill -"$1" "$he_worker" 2>/dev/null || :; fi
  }
  trap 'he_signal TERM' TERM; trap 'he_signal INT' INT
  if setpriv --pdeathsig KILL true 2>/dev/null; then
    ( trap - INT QUIT; exec setpriv --pdeathsig KILL "$BASH" "${BASH_SOURCE[0]}" "$@" ) <&0 &
  else
    ( trap - INT QUIT; exec "$BASH" "${BASH_SOURCE[0]}" "$@" ) <&0 &
  fi
  he_worker=$!
  set +e
  while kill -0 "$he_worker" 2>/dev/null; do
    if [ -n "$he_pending" ]; then he_signal "$he_pending"; sleep 0.05; else wait "$he_worker"; fi
  done
  wait "$he_worker"; he_code=$?
  rm -rf "$he_stop_dir"
  exit "$he_code"
fi
he_stop_check() { [ -z "${HE_STOP_FILE:-}" ] || [ ! -e "$HE_STOP_FILE" ] || stopping=1; }
he_turn_wait() {
  [ -n "${HE_STOP_FILE:-}" ] || return 1
  while kill -0 "$1" 2>/dev/null && [ ! -e "$HE_STOP_FILE" ]; do sleep 0.2; done
  he_stop_check; [ "$stopping" -eq 1 ] && kill -0 "$1" 2>/dev/null && code=143
}
# <<< stop supervisor

: "${HE_WORKSPACE_DIR:=/workspace}"
: "${HE_SESSION_STATE_DIR:=/harness-state}"
: "${HE_LOG_DIR:?HE_LOG_DIR must be set}"
: "${HE_MODEL_BASE_URL:?HE_MODEL_BASE_URL must be set}"
: "${HE_MODEL_API_KEY:?HE_MODEL_API_KEY must be set}"
: "${HE_MODEL_NAME:?HE_MODEL_NAME must be set}"
: "${HE_TIME_BUDGET_S:=300}"
: "${HE_TRIAL_ID:=unknown}"

mkdir -p "$HE_LOG_DIR"
exec > >(tee -a "$HE_LOG_DIR/stdout.log") 2> >(tee -a "$HE_LOG_DIR/stderr.log" >&2)
log() { printf '%s dsh[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }
now() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }
adapter_sha256=$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)
harness_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
pin_version=$(jq -r '.version' "$harness_dir/pin.json")

entry=${1:-run}
case "$entry" in
  run|serve) ;;
  *) log "unknown entry point: $entry; 'run' and 'serve' are implemented"; exit 2 ;;
esac

# Only per-conversation sessions (HE_SESSION_SCOPE=turn is the OpenClaw adapter's), no gbrain install rung and no instruction
# route or ablation config are implemented here; a cell that asks for one stops before anything runs.
if [ "${HE_SESSION_SCOPE:-conversation}" != conversation ]; then log "HE_SESSION_SCOPE=${HE_SESSION_SCOPE} is not supported (only the openclaw adapter keys sessions per turn)"; exit 2; fi
if [ -n "${HE_GBRAIN_INSTALL:-}" ]; then
  msg="HE-ADAPTER-006 the install bundle could not be applied: the dsh adapter has no documented install for HE_GBRAIN_INSTALL=$HE_GBRAIN_INSTALL; fix: run this cell without gbrain.install"
  jq -n --arg install "$HE_GBRAIN_INSTALL" --arg split "${HE_GBRAIN_SPLIT:-}" --arg dir "${HE_GBRAIN_INSTALL_DIR:-/he-gbrain-install}" --arg error "$msg" \
    '{status:"error", code:"HE-ADAPTER-006", harness:"dsh", split:$split, install:$install, dir:$dir, view_digest:null, files:0, destinations:[], copied:[], error:$error}' > "$HE_LOG_DIR/gbrain-install.json"
  log "$msg"
  exit 2
fi
case "${HE_HARNESS_CONFIG:-default}" in
  default) ;;
  *) log "HE-ADAPTER-007 HE_HARNESS_CONFIG=$HE_HARNESS_CONFIG is not a dsh config: the dsh adapter implements default only (no instruction route, no ablation)"; exit 2 ;;
esac

# The route is the provider segment of the runner's <proxy>/<slot>/<provider> (runner/trial/proxy.ts baseUrlFor).
base_url=${HE_MODEL_BASE_URL%/}
route=${base_url##*/}
case "$route" in
  anthropic|openai|particle|openrouter) ;;
  *) log "HE_MODEL_BASE_URL $HE_MODEL_BASE_URL ends in /$route: dsh runs on an anthropic, openai, particle or openrouter route (pin.json model_*)"; exit 2 ;;
esac

# All state under HE_SESSION_STATE_DIR: HOME, dsh's home (profiles, sessions, storages) and the shared agents root, which
# start empty, so no user-level skill, instruction file or saved credential exists.
export HOME="$HE_SESSION_STATE_DIR"
export DSH_HOME="$HE_SESSION_STATE_DIR/.dsh"
export DSH_AGENTS_HOME="$HE_SESSION_STATE_DIR/.agents"
export TMPDIR="$HE_SESSION_STATE_DIR/tmp"
export DSH_TELEMETRY_MODE=DISABLED
unset DSH_TELEMETRY_OTLP_URL DSH_PERMISSION_MODE
profile_dir="$DSH_HOME/profiles/headless"
mkdir -p "$profile_dir" "$TMPDIR"
sessions="$HE_SESSION_STATE_DIR/dsh-sessions.json"

version=$(dsh --version 2>/dev/null || true); version=${version%%$'\n'*}
log "dsh ${version:-unknown} (pin.json $pin_version) route=$route model=$HE_MODEL_NAME budget=${HE_TIME_BUDGET_S}s entry=$entry"
[ "$version" = "$pin_version" ] || { log "dsh ${version:-unknown} is not the pinned $pin_version"; exit 2; }

# One MCP client row: Streamable HTTP, the bearer read from the named variable when the plugin loads, a server that does not
# start fails plugin activation (and so the turn) instead of leaving the agent without its tools.
mcp_row() {
  jq -rn --arg id "mcp-$1" --arg name "$1" --arg url "$2" --arg var "$3" '
    "    - id: \($id)\n      name: \u0027@deepseek-ai/dsh-mcp-client\u0027\n      config:\n        serverName: \($name)\n        transport: streamable-http\n        url: \($url | tojson)\n        headers:\n          Authorization: !!js \u0027\u0060Bearer $\u007bprocess.env.\($var)}\u0060\u0027\n        failOnStartupError: true\n        toolCallTimeoutMs: 120000"'
}

# tools/list as the bot, before ready: a server that does not answer with tools is a harness error (exit 2). The tool names
# are kept as $HE_LOG_DIR/mcp-probe.<name>.json.
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

patch="$profile_dir/cordis.patch.yml"
{
  printf '# Written by harnesses/dsh/adapter.sh for trial %s (route %s). Do not edit: the adapter rewrites it on start.\n' "$HE_TRIAL_ID" "$route"
  sed -e "s#@MODEL@#$(jq -rn --arg v "$HE_MODEL_NAME" '$v | tojson')#g" -e "s#@BASE_URL_V1@#$(jq -rn --arg v "$base_url/v1" '$v | tojson')#g" \
    -e "s#@BASE_URL@#$(jq -rn --arg v "$base_url" '$v | tojson')#g" "$harness_dir/config/route.$route.patch.yml"
  cat "$harness_dir/config/base.patch.yml"
} > "$patch.tmp"
mcp_servers='[]'
if [ "$entry" = serve ]; then
  [ -n "${HE_WORLD_MCP_URL:-}" ] && [ -n "${HE_WORLD_MCP_TOKEN:-}" ] || { log "serve needs HE_WORLD_MCP_URL and HE_WORLD_MCP_TOKEN"; exit 2; }
  mcp_probe world "$HE_WORLD_MCP_URL" "$HE_WORLD_MCP_TOKEN" || exit 2
  printf '# The world MCP server, as the bot; its tools reach the model as mcp__world__<tool>.\n- insert:\n%s\n' "$(mcp_row world "$HE_WORLD_MCP_URL" HE_WORLD_MCP_TOKEN)" >> "$patch.tmp"
  mcp_servers='["world"]'
  # The gbrain arm (docs/gbrain-arm.md): a second row with the same shape, the world's /gbrain tap and the bot token.
  if [ -n "${HE_GBRAIN_MCP_URL:-}" ] && [ -n "${HE_GBRAIN_MCP_TOKEN:-}" ]; then
    mcp_probe gbrain "$HE_GBRAIN_MCP_URL" "$HE_GBRAIN_MCP_TOKEN" || exit 2
    printf -- '- insert:\n%s\n' "$(mcp_row gbrain "$HE_GBRAIN_MCP_URL" HE_GBRAIN_MCP_TOKEN)" >> "$patch.tmp"
    mcp_servers='["world","gbrain"]'
  fi
fi
mv "$patch.tmp" "$patch"
cp "$patch" "$HE_LOG_DIR/cordis.patch.yml"
# The composed tree, as dsh resolves it from the shipped bundles and this patch, without booting it: a patch dsh cannot compose
# stops here (exit 2 before ready), and the dump is kept for the trial record.
if ! (cd "$HE_WORKSPACE_DIR" && dsh --profile headless --dump-config > "$HE_LOG_DIR/dsh-config.yml" 2> "$HE_LOG_DIR/dsh-config.stderr.log"); then
  log "dsh --dump-config refused the profile: $(head -c 400 "$HE_LOG_DIR/dsh-config.stderr.log")"; exit 2
fi
log "profile written to $patch (route $route, mcp_servers $mcp_servers)"

cd "$HE_WORKSPACE_DIR"
stopping=0
cpid=''
if [ -n "${HE_STOP_FILE:-}" ]; then : > "$HE_STOP_FILE.armed"; else trap 'stopping=1' TERM INT; fi

# Every process a turn starts carries HE_DSH_TURN=<marker> in its environment, including any a tool started in its own session
# (outside the process group); after the turn they are all killed.
sweep() {
  local p
  for p in /proc/[0-9]*; do
    [ "${p#/proc/}" = "$$" ] && continue
    if tr '\0' '\n' 2>/dev/null < "$p/environ" | grep -qxF "HE_DSH_TURN=$1"; then kill -KILL "${p#/proc/}" 2>/dev/null || true; fi
  done
}

record_session() {
  local tmp="$sessions.tmp.$$"
  { if [ -s "$sessions" ]; then cat "$sessions"; else echo '{}'; fi; } | jq --arg k "$1" --arg v "$2" '.[$k] = $v' > "$tmp"
  mv "$tmp" "$sessions"
}

# One dsh turn. Arguments: prompt file, session key (empty for run), file stem, budget, kill grace. Sets turn_code and
# turn_detail; the reply is in <stem>.reply.txt, the events in <stem>.dsh.jsonl, a summary in <stem>.status.json.
dsh_turn() {
  local prompt=$1 key=$2 stem=$3 budget=$4 grace=$5
  local events="$stem.dsh.jsonl" err="$stem.stderr.log" sid='' marker deadline timed_out=0 stopped=0 code status kind ecode emsg
  local -a args=(--profile headless --json --permission-mode workspace-write --approval-policy never)
  turn_detail=''
  : > "$stem.reply.txt"
  if [ -n "$key" ] && [ -s "$sessions" ]; then sid=$(jq -r --arg k "$key" '.[$k] // empty' "$sessions"); fi
  [ -z "$sid" ] || args+=(--session-id "$sid")
  args+=(-)
  marker="$HE_TRIAL_ID.${stem##*/}.$$.$RANDOM"
  HE_DSH_TURN="$marker" setsid dsh "${args[@]}" < "$prompt" > "$events" 2> "$err" &
  cpid=$!
  deadline=$((SECONDS + budget))
  while kill -0 "$cpid" 2>/dev/null; do
    if { he_stop_check; [ "$stopping" -eq 1 ]; }; then stopped=1; break; fi
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
    | ($ev | map(select(.type == "final")) | last) as $final
    | {dsh_exit: ($code | tonumber),
       session_id: ($ev | map(select(.type == "session") | .sessionId) | first),
       reason: ($final.reason // null),
       error_event: ($ev | map(select(.type == "error")) | last),
       reply: ($final.text // null),
       tool_calls: ($ev | map(select(.type == "tool_call") | .tool)),
       tool_errors: ($ev | map(select(.type == "tool_result" and .status == "error") | .callId) | length),
       steps: ($ev | map(select(.type == "status" and .phase == "step_end")) | length),
       usage: ($ev | map(select(.type == "status" and .phase == "step_end") | .usage))}' "$events")
  printf '%s\n' "$status" > "$stem.status.json"
  printf '%s' "$status" | jq -j '.reply // ""' > "$stem.reply.txt"
  if [ -n "$key" ] && [ -z "$sid" ]; then
    sid=$(printf '%s' "$status" | jq -r '.session_id // empty')
    if [ -n "$sid" ]; then record_session "$key" "$sid"; log "session $key -> $sid"; fi
  fi
  kind=$(printf '%s' "$status" | jq -r '.reason.kind // empty')
  ecode=$(printf '%s' "$status" | jq -r '.reason.error.code // .error_event.code // empty')
  emsg=$(printf '%s' "$status" | jq -r '.reason.error.message // .error_event.message // empty')
  if [ "$timed_out" -eq 1 ]; then turn_code=124; turn_detail="wall clock exceeded (${budget}s)"
  elif [ "$stopped" -eq 1 ]; then turn_code=143; turn_detail="stopped by SIGTERM during the turn"
  elif [ "$code" -eq 0 ] && [ "$kind" = completed ]; then turn_code=0
  elif [[ $emsg =~ ^([1-5][0-9][0-9]): ]]; then turn_code=3; turn_detail="model error (HTTP ${BASH_REMATCH[1]}, ${ecode:-no code})"
  elif [ "$ecode" = TRANSPORT ]; then turn_code=3; turn_detail="model error (the model endpoint is unreachable: ${emsg:0:200})"
  else turn_code=2; turn_detail="harness error (dsh exit $code${kind:+, reason $kind}${ecode:+, $ecode}${emsg:+: ${emsg:0:200}})"
  fi
}

if [ "$entry" = run ]; then
  [ -r "$HE_WORKSPACE_DIR/instruction.md" ] || { log "no readable $HE_WORKSPACE_DIR/instruction.md"; exit 2; }
  dsh_turn "$HE_WORKSPACE_DIR/instruction.md" '' "$HE_LOG_DIR/run" "$HE_TIME_BUDGET_S" 60
  [ "$turn_code" -ne 143 ] || turn_code=2
  log "exit $turn_code${turn_detail:+ ($turn_detail)}"
  exit "$turn_code"
fi

# ---- serve ----------------------------------------------------------------------------------------
: "${HE_TURNS_DIR:=/he-turns}"
mkdir -p "$HE_TURNS_DIR" "$HE_LOG_DIR/turns"
jq -cn --arg version "$version" --arg trial "$HE_TRIAL_ID" --arg at "$(now)" --arg route "$route" --argjson mcp "$mcp_servers" --arg sha "$adapter_sha256" \
  '{harness:"dsh", version:$version, trial:$trial, ready_at:$at, route:$route, session_keys:"dsh --profile headless (first turn of a key) | --session-id <id>; dm:<member> | channel:<id>", mcp_servers:$mcp, adapter_sha256:$sha}' > "$HE_LOG_DIR/ready.tmp"
mv "$HE_LOG_DIR/ready.tmp" "$HE_LOG_DIR/ready"
log "serve: ready; polling $HE_TURNS_DIR"
while { he_stop_check; [ "$stopping" -eq 0 ]; }; do
  for req in "$HE_TURNS_DIR"/turn-*.request.json; do
    [ -e "$req" ] || continue
    { he_stop_check; [ "$stopping" -eq 0 ]; } || break
    base=${req%.request.json}; name=$(basename "$base"); resp="$base.response.json"
    [ -e "$resp" ] && continue
    turn=$(jq -r '.turn' "$req")
    budget=$(jq -r '.time_budget_s // empty' "$req"); budget=${budget:-$HE_TIME_BUDGET_S}
    # A thread turn (thread_ts set; thread = "new" in task.toml) is a new session in the same conversation.
    key=$(jq -r 'if .channel.type == "dm" then "dm:" + .actor.member else "channel:" + .channel.id end + (if .thread_ts then ":t" + (.thread_ts | tostring) else "" end)' "$req")
    jq -j '.prompt' "$req" > "$HE_LOG_DIR/turns/$name.prompt.md"
    log "turn $turn: session $key, budget ${budget}s"
    started=$(now)
    dsh_turn "$HE_LOG_DIR/turns/$name.prompt.md" "$key" "$HE_LOG_DIR/turns/$name" "$budget" 5
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
