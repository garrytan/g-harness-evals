#!/usr/bin/env bash
# Pi adapter. Protocol: docs/adapters.md. Exit 0 completed, 2 harness error, 3 model error, 124 wall clock.
#
#   run    one headless turn: pi --mode json with /workspace/instruction.md as the message
#   serve  the multi-user entry: every TurnRequest in HE_TURNS_DIR becomes one pi --mode json turn in the
#          session UUIDv5(<key>), all in one session directory under /harness-state, so Pi's own session
#          store decides what carries across turns of a conversation and nothing else is shared.
#
# Pi gets the world's tools from extension/world-mcp.ts, loaded with -e on every turn: a pass-through that
# registers each world-MCP tool under its own name, description and schema and forwards each call over HTTP
# (pin.json world_mcp).
#
# The model goes through the proxy route the runner gives (the last segment of HE_MODEL_BASE_URL picks the
# provider and config/models.<provider>.json): anthropic (Messages), openai (Responses), particle (Chat
# Completions) or openrouter (Chat Completions). The message is always the last argument, after "--", so a
# message that starts with "- " is never read as an option (Harbor's stock Pi adapter put it first; report of
# frontier-harness-2026-11, "Pi crashes on one instruction").
#
# Exit mapping (pin.json serve.exit_mapping):
#   0    pi exited 0 and its last assistant message ended with stopReason stop or length
#   124  the turn outlived its budget: SIGTERM to the turn's session, SIGKILL after the grace (60 s run, 5 s serve)
#   3    the last assistant message ended with stopReason error on a provider error: an HTTP status from the
#        proxy or provider (Pi's "403 {...}", "OpenAI API error (403): ...") or the proxy unreachable after Pi's
#        retries ("Connection error.")
#   2    anything else: the world-MCP extension could not list the world's tools (it ends Pi with exit 2), a
#        world-MCP tool call that failed at the transport level, no assistant message, an aborted message, another
#        error, a non-zero pi exit, a Pi version other than pin.json's, SIGTERM during a turn, a provider route
#        or config this adapter does not implement
set -euo pipefail

# >>> stop supervisor: the same lines in every bash adapter (tests/adapter-stop.test.ts checks them)
# bash 5.2 drops a trap that fires while it parses a $(...), and under set -e the adapter then exits 2 instead of stopping
# (fixed in bash 5.3). As container PID 1, which is how every trial runs it, the adapter keeps the trap 'stopping=1' below
# and nothing here runs: no worker and no stop file, so a trial stops and survives in-container kills exactly as before.
# Anywhere else (the process harness, the keyless tests), the process that gets the signal runs this file again as a worker
# and only waits. Once the worker passes the line where the trap is set (HE_STOP_FILE.armed), the supervisor turns SIGTERM
# or SIGINT into the file HE_STOP_FILE, which he_stop_check copies into stopping; before it, the signal goes on to the
# worker. The worker keeps the arguments, stdin, directory and environment of a plain run, with SIGINT and SIGQUIT not
# ignored, dies with the supervisor where setpriv is installed, and its exit code is the supervisor's.
if [ "$$" -eq 1 ]; then
  unset HE_STOP_FILE HE_STOP_SUPERVISOR
elif [ -n "${HE_STOP_FILE:-}" ] && [ "${HE_STOP_SUPERVISOR:-}" = "$PPID" ]; then
  export -n HE_STOP_FILE HE_STOP_SUPERVISOR
else
  he_stop_dir=$(mktemp -d "${TMPDIR:-/tmp}/he-stop.XXXXXX"); HE_STOP_FILE=$he_stop_dir/stop; HE_STOP_SUPERVISOR=$$
  export HE_STOP_FILE HE_STOP_SUPERVISOR
  if setpriv --pdeathsig KILL true 2>/dev/null; then
    ( trap - INT QUIT; exec setpriv --pdeathsig KILL "$BASH" "${BASH_SOURCE[0]}" "$@" ) <&0 &
  else
    ( trap - INT QUIT; exec "$BASH" "${BASH_SOURCE[0]}" "$@" ) <&0 &
  fi
  he_worker=$!
  he_signal() { if [ -e "$HE_STOP_FILE.armed" ]; then : > "$HE_STOP_FILE"; else kill -"$1" "$he_worker" 2>/dev/null; fi; }
  trap 'he_signal TERM' TERM; trap 'he_signal INT' INT
  set +e
  while kill -0 "$he_worker" 2>/dev/null; do wait "$he_worker"; done
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
log() { printf '%s pi[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }
now() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }
adapter_sha256=$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)
harness_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

entry=${1:-run}
case "$entry" in
  run|serve) ;;
  *) log "unknown entry point: $entry; 'run' and 'serve' are implemented"; exit 2 ;;
esac

# Refusals before anything is written: each names a cell setting this adapter does not implement, so such a cell stops
# here instead of running as a plain cell.
if [ "${HE_SESSION_SCOPE:-conversation}" != conversation ]; then log "HE_SESSION_SCOPE=$HE_SESSION_SCOPE is not supported (only the openclaw adapter keys sessions per turn)"; exit 2; fi
sas_config=''
case "${HE_HARNESS_CONFIG:-default}" in
  default) ;;
  skills-catalog|skills-gbrain-setup|skills-gbrain-pins)
    [ "$entry" = serve ] || { log "HE-ADAPTER-007 HE_HARNESS_CONFIG=$HE_HARNESS_CONFIG is applied for the serve entry only (scripts/skills-at-scale/README.md)"; exit 2; }
    sas_config=$HE_HARNESS_CONFIG ;;
  *) log "HE-ADAPTER-007 HE_HARNESS_CONFIG=$HE_HARNESS_CONFIG: the pi adapter implements the default config and the skills-at-scale arms skills-catalog, skills-gbrain-setup and skills-gbrain-pins only"; exit 2 ;;
esac
if [ -n "${HE_GBRAIN_INSTALL:-}" ]; then log "HE-ADAPTER-006 HE_GBRAIN_INSTALL=$HE_GBRAIN_INSTALL is not implemented for pi; fix: run this cell without gbrain.install"; exit 2; fi
if [ -n "${HE_GBRAIN_MCP_URL:-}" ]; then log "HE_GBRAIN_MCP_URL is set: the pi adapter registers the world MCP server only; fix: run this cell without gbrain"; exit 2; fi

# The proxy route's last segment (<proxy>/<slot>/<provider>, runner/trial/proxy.ts baseUrlFor) picks Pi's provider and
# the models.json template for it (pin.json model_anthropic, model_openai, model_particle, model_openrouter).
base_url=${HE_MODEL_BASE_URL%/}
provider=${base_url##*/}
case "$provider" in
  anthropic|openai|particle|openrouter) ;;
  *) log "HE_MODEL_BASE_URL $HE_MODEL_BASE_URL does not end in /anthropic, /openai, /particle or /openrouter: no Pi provider for that route"; exit 2 ;;
esac

# Set before anything long runs: bash is PID 1 in the container and ignores a SIGTERM it has no trap for. A turn checks the flag.
stopping=0
if [ -n "${HE_STOP_FILE:-}" ]; then : > "$HE_STOP_FILE.armed"; else trap 'stopping=1' TERM INT; fi

# All of Pi's state lives under /harness-state: the agent directory (models.json, settings, auth), the sessions and the
# scratch files. No auth.json is written: the per-trial token reaches Pi only through models.json's "$HE_MODEL_API_KEY",
# which Pi reads from its environment when it sends a request.
export HOME="$HE_SESSION_STATE_DIR"
export PI_CODING_AGENT_DIR="$HE_SESSION_STATE_DIR/pi/agent"
# The skills-at-scale arms keep Pi's agent directory at /harness-state/pi, so its skills folder is /harness-state/pi/skills.
[ -z "$sas_config" ] || export PI_CODING_AGENT_DIR="$HE_SESSION_STATE_DIR/pi"
export TMPDIR="$HE_SESSION_STATE_DIR/tmp"
session_dir="$HE_SESSION_STATE_DIR/pi/sessions"
mkdir -p "$PI_CODING_AGENT_DIR" "$session_dir" "$TMPDIR"
# No side traffic: no startup network operations (model catalog refresh, package or tool downloads), version check or
# install telemetry.
export PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0

if ! models_sha=$(node - "$harness_dir/config/models.$provider.json" "$PI_CODING_AGENT_DIR/models.json" "$base_url" "$HE_MODEL_NAME" <<'MODELS_JS'
const fs = require("fs");
const [template, out, base, model] = process.argv.slice(2);
const text = fs.readFileSync(template, "utf8").replaceAll("${HE_MODEL_BASE_URL}", base).replaceAll("${HE_MODEL_NAME}", model);
JSON.parse(text);
fs.writeFileSync(out + ".tmp", text);
fs.renameSync(out + ".tmp", out);
process.stdout.write(require("crypto").createHash("sha256").update(text).digest("hex"));
MODELS_JS
); then log "could not write $PI_CODING_AGENT_DIR/models.json from config/models.$provider.json"; exit 2; fi
log "provider $provider: $PI_CODING_AGENT_DIR/models.json from config/models.$provider.json (sha256 $models_sha)"

pinned_version=$(node -e 'process.stdout.write(String(require(process.argv[1]).version))' "$harness_dir/pin.json")
pi_version=$(pi --version 2>/dev/null || true)
log "pi $pi_version provider=$provider model=$HE_MODEL_NAME thinking=medium budget=${HE_TIME_BUDGET_S}s entry=$entry"
if [ "$pi_version" != "$pinned_version" ]; then log "pi --version is '$pi_version', pin.json says $pinned_version"; exit 2; fi

# The skills-at-scale arms (scripts/skills-at-scale/README.md), on HE_HARNESS_CONFIG skills-catalog, skills-gbrain-setup
# or skills-gbrain-pins. The kit's bin/sas-arm (${HE_SAS_DIR:-/opt/skills-at-scale}, scripts/skills-at-scale/build-kit.ts)
# installs the catalog in $PI_CODING_AGENT_DIR/skills and, on the gbrain arms, runs gbrain's own installer as a user would; it writes
# $HE_LOG_DIR/sas-arm.json, and ready gains sas_arm. Any failure is HE-ADAPTER-007 and exit 2 before ready. Any other config:
# nothing here runs and nothing is written.
sas_arm_json=''
if [ -n "$sas_config" ]; then
  set +e
  sas_line=$("${HE_SAS_DIR:-/opt/skills-at-scale}/bin/sas-arm" pi "$sas_config" --dest "$PI_CODING_AGENT_DIR/skills" 2>> "$HE_LOG_DIR/sas-arm.stderr.log")
  sas_code=$?
  set -e
  log "skills-at-scale arm $sas_config: ${sas_line:-HE-ADAPTER-007 sas-arm printed nothing; see sas-arm.stderr.log}"
  [ "$sas_code" -eq 0 ] || exit 2
  sas_arm_json=",\"sas_arm\":${sas_line#ok }"
fi

cd "$HE_WORKSPACE_DIR"

# The world's tools: the extension reads HE_WORLD_MCP_URL and HE_WORLD_MCP_TOKEN (the bot's per-trial token, in the runner's
# redaction set) from its environment. Before ready the server must answer tools/list with the bearer, so a trial never
# starts with a world the harness cannot use; the extension lists the tools again at the start of every turn.
ext_args=() mcp_servers='' world_tools=0
if [ -n "${HE_WORLD_MCP_URL:-}" ] && [ -n "${HE_WORLD_MCP_TOKEN:-}" ]; then
  ext_args=(-e "$harness_dir/extension/world-mcp.ts") mcp_servers=world
  world_tools=''
  for attempt in 1 2 3 4 5; do
    world_tools=$(curl -sS --max-time 20 -X POST "$HE_WORLD_MCP_URL" -H "Authorization: Bearer $HE_WORLD_MCP_TOKEN" -H 'content-type: application/json' \
      -H 'accept: application/json, text/event-stream' --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' 2>/dev/null \
      | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const body = s.split("\n").map((l) => l.replace(/^data: /, "")).find((l) => l.startsWith("{")) ?? "";
  try { const r = JSON.parse(body); if (Array.isArray(r.result?.tools)) process.stdout.write(String(r.result.tools.length)); } catch {}
});') || true
    [ -n "$world_tools" ] && break
    sleep 1
  done
  if [ -z "$world_tools" ]; then log "MCP server world did not answer tools/list at $HE_WORLD_MCP_URL"; exit 2; fi
  log "MCP server world: tools/list answered $world_tools tools; registered on every turn by extension/world-mcp.ts"
elif [ "$entry" = serve ]; then
  log "serve needs HE_WORLD_MCP_URL and HE_WORLD_MCP_TOKEN"; exit 2
fi

turn_pid=''

# The sessions a turn's processes are in: the turn's own session and the session of every descendant of pi. Pi's bash tool
# starts each command detached, in a session of its own, so the turn's session alone would miss those commands. The
# adapter's own session is left out: the turn's stderr tee was started in it before setsid.
turn_sessions() {
  ps -e -o pid=,ppid=,sid= | awk -v root="$1" -v own="$(ps -o sid= -p $$ | tr -d ' ')" '
    { pid[NR] = $1; ppid[NR] = $2; sid[NR] = $3 }
    END {
      keep[root] = 1; more = 1
      while (more) { more = 0; for (i = 1; i <= NR; i++) if ((ppid[i] in keep) && !(pid[i] in keep)) { keep[pid[i]] = 1; more = 1 } }
      out[root] = 1
      for (i = 1; i <= NR; i++) if ((pid[i] in keep) && sid[i] != own) out[sid[i]] = 1
      for (s in out) print s
    }'
}

# Stop a turn: SIGTERM to every process in its sessions, SIGKILL to whatever is left after the grace.
stop_session() {
  local sid=$1 grace=$2 waited=0 sessions s left
  sessions=$(turn_sessions "$sid")
  for s in $sessions; do pkill -TERM -s "$s" 2>/dev/null || true; done
  while [ "$waited" -lt $((grace * 5)) ]; do
    left=0
    for s in $sessions; do pgrep -s "$s" >/dev/null 2>&1 && left=1; done
    [ "$left" -eq 0 ] && break
    sleep 0.2; waited=$((waited + 1))
  done
  for s in $sessions; do pkill -KILL -s "$s" 2>/dev/null || true; done
}

# One turn. Arguments: file prefix for this turn's logs, prompt file, session key, budget, kill grace. Sets turn_code and
# turn_detail; the reply is in <prefix>.reply.txt. The session id is UUIDv5 of the key; --session-id opens that session in
# the session directory or creates it. The prompt is one argument after "--" (Linux caps one argument at 131072 bytes).
run_turn() {
  local prefix=$1 prompt_file=$2 key=$3 budget=$4 grace=$5 sid deadline timed_out=0 stopped=0 code line prompt bytes
  sid=$(node -e '
const h = require("crypto").createHash("sha1").update(Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex")).update("harness-evals:pi:" + process.argv[1]).digest();
h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
const x = h.subarray(0, 16).toString("hex");
process.stdout.write([x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20)].join("-"));' "$key")
  bytes=$(wc -c < "$prompt_file" | tr -d ' ')
  if [ "$bytes" -ge 131072 ]; then turn_code=2; turn_detail="the prompt is $bytes bytes, over the 131072 bytes one argument may hold"; : > "$prefix.reply.txt"; return 0; fi
  prompt=$(cat "$prompt_file"; printf x); prompt=${prompt%x}
  log "session $key: --session-id $sid"
  set +e
  setsid pi --mode json --provider "$provider" --model "$HE_MODEL_NAME" --thinking medium --session-dir "$session_dir" --session-id "$sid" \
    "${ext_args[@]}" -- "$prompt" < /dev/null > "$prefix.pi.jsonl" 2> >(tee -a "$prefix.stderr.log" >&2) &
  turn_pid=$!
  deadline=$((SECONDS + budget))
  while kill -0 "$turn_pid" 2>/dev/null; do
    if { he_stop_check; [ "$stopping" -eq 1 ]; }; then stopped=1; stop_session "$turn_pid" "$grace"; break; fi
    if [ "$SECONDS" -ge "$deadline" ]; then timed_out=1; stop_session "$turn_pid" "$grace"; break; fi
    sleep 0.2
  done
  wait "$turn_pid"; code=$?
  turn_pid=''
  line=$(node - "$prefix.pi.jsonl" "$prefix.reply.txt" "$prefix.status.json" "$code" "$prefix.stderr.log" <<'TURN_JS'
const fs = require("fs");
const [events, replyPath, statusPath, exitCode, stderrPath] = process.argv.slice(2);
let header = null, last = null, unparsed = 0, toolCalls = 0;
const transport = [];
for (const l of fs.readFileSync(events, "utf8").split("\n")) {
  if (!l.trim()) continue;
  let ev;
  try { ev = JSON.parse(l); } catch { unparsed++; continue; }
  if (ev.type === "session" && !header) header = ev;
  if (ev.type === "message_end" && ev.message?.role === "assistant") last = ev.message;
  if (ev.type === "tool_execution_end") {
    toolCalls++;
    const text = (ev.result?.content ?? []).map((c) => c?.text ?? "").join(" ").trim();
    if (ev.isError && /^(?:Error: )?world MCP transport error: /.test(text)) transport.push(ev.toolName + ": " + text.slice(0, 160));
  }
}
const stderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf8") : "";
const extension = stderr.match(/world-mcp: HE-ADAPTER-004 [^\n]*/);
const error = String(last?.errorMessage ?? "");
const providerError = /^(?:\d{3}\b|[A-Za-z]+ API error \(\d{3}\))|^Connection error|fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|socket hang up/.test(error);
let code = 0, detail = "";
if (extension) [code, detail] = [2, extension[0]];
else if (transport.length) [code, detail] = [2, "MCP transport error: " + transport[0]];
else if (!last) [code, detail] = [2, "no assistant message in the JSON event stream (pi exit " + exitCode + ", " + unparsed + " unparsed lines)"];
else if (last.stopReason === "error" && providerError) [code, detail] = [3, "model error: " + error.slice(0, 200)];
else if (last.stopReason === "error" || last.stopReason === "aborted") [code, detail] = [2, "assistant message ended with " + last.stopReason + ": " + error.slice(0, 200)];
else if (exitCode !== "0") [code, detail] = [2, "pi exit " + exitCode];
const reply = (Array.isArray(last?.content) ? last.content : []).filter((c) => c?.type === "text").map((c) => c.text).join("\n").trim();
fs.writeFileSync(replyPath, code === 0 ? reply : "");
fs.writeFileSync(statusPath, JSON.stringify({ pi_exit: Number(exitCode), session_id: header?.id ?? null, provider: last?.provider ?? null, model: last?.model ?? null, api: last?.api ?? null,
  stop_reason: last?.stopReason ?? null, thinking_level: last?.thinkingLevel ?? null, tool_calls: toolCalls, mcp_transport_errors: transport.length, unparsed }));
process.stdout.write(code + " " + detail.replace(/\s+/g, " "));
TURN_JS
)
  set -e
  turn_code=${line%% *}; turn_detail=''
  [[ "$line" == *" "* ]] && turn_detail=${line#* }
  if [ "$timed_out" -eq 1 ]; then turn_code=124; turn_detail="wall clock exceeded (${budget}s)"; fi
  if [ "$stopped" -eq 1 ]; then turn_code=2; turn_detail="stopped by SIGTERM during the turn"; fi
  if ! [[ "$turn_code" =~ ^[0-9]+$ ]]; then turn_code=2; turn_detail="the turn's output could not be read"; fi
  return 0
}

if [ "$entry" = "run" ]; then
  [ -r "$HE_WORKSPACE_DIR/instruction.md" ] || { log "no readable $HE_WORKSPACE_DIR/instruction.md"; exit 2; }
  { he_stop_check; [ "$stopping" -eq 0 ]; } || { log "stopped by SIGTERM before the turn"; exit 2; }
  run_turn "$HE_LOG_DIR/run" "$HE_WORKSPACE_DIR/instruction.md" "run:$HE_TRIAL_ID" "$HE_TIME_BUDGET_S" 60
  case "$turn_code" in
    0) cat "$HE_LOG_DIR/run.reply.txt"; echo; log "completed" ;;
    124) log "wall clock exceeded (HE_TIME_BUDGET_S=$HE_TIME_BUDGET_S)" ;;
    *) log "exit $turn_code: $turn_detail" ;;
  esac
  exit "$turn_code"
fi

# ---- serve ----------------------------------------------------------------------------------------
: "${HE_TURNS_DIR:=/he-turns}"
mkdir -p "$HE_TURNS_DIR" "$HE_LOG_DIR/turns"

write_response() {
  node -e '
const fs = require("fs");
const [resp, turn, code, replyFile, started, ended, detail] = process.argv.slice(1);
const exit = Number(code);
const out = { turn: Number(turn), exit, reply_text: exit === 0 ? fs.readFileSync(replyFile, "utf8") : null, started_at: started, ended_at: ended };
if (detail) out.detail = detail;
fs.writeFileSync(resp + ".tmp", JSON.stringify(out));
fs.renameSync(resp + ".tmp", resp);' "$@"
}

printf '{"harness":"pi","version":"%s","trial":"%s","ready_at":"%s","provider":"%s","session_keys":"pi --session-id UUIDv5(dm:<member> | channel:<id>)","mcp_servers":"%s","world_tools":%s,"adapter_sha256":"%s"%s}\n' \
  "$pi_version" "$HE_TRIAL_ID" "$(now)" "$provider" "$mcp_servers" "$world_tools" "$adapter_sha256" "$sas_arm_json" > "$HE_LOG_DIR/ready.tmp"
mv "$HE_LOG_DIR/ready.tmp" "$HE_LOG_DIR/ready"
log "serve: ready; polling $HE_TURNS_DIR"
while { he_stop_check; [ "$stopping" -eq 0 ]; }; do
  for req in "$HE_TURNS_DIR"/turn-*.request.json; do
    [ -e "$req" ] || continue
    { he_stop_check; [ "$stopping" -eq 0 ]; } || break
    base=${req%.request.json}; name=$(basename "$base"); resp="$base.response.json"
    [ -e "$resp" ] && continue
    read -r turn budget key < <(node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
let key = r.channel.type === "dm" ? "dm:" + r.actor.member : "channel:" + r.channel.id;
if (r.thread_ts) key += ":t" + r.thread_ts;
console.log([r.turn, r.time_budget_s || process.env.HE_TIME_BUDGET_S, key].join(" "));' "$req")
    node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).prompt)' "$req" > "$HE_LOG_DIR/turns/$name.prompt.md"
    log "turn $turn: session $key, budget ${budget}s"
    started=$(now)
    run_turn "$HE_LOG_DIR/turns/$name" "$HE_LOG_DIR/turns/$name.prompt.md" "$key" "$budget" 5
    ended=$(now)
    write_response "$resp" "$turn" "$turn_code" "$HE_LOG_DIR/turns/$name.reply.txt" "$started" "$ended" "$turn_detail"
    log "turn $turn: exit $turn_code${turn_detail:+ ($turn_detail)}"
  done
  sleep 0.25
done
log "serve: stopped on signal"
exit 0
