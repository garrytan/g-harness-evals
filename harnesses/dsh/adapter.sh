#!/usr/bin/env bash
# DeepSeek Harness (dsh) adapter. Protocol: docs/adapters.md. Exit 0 completed, 2 harness error,
# 3 model error, 124 wall clock.
#
#   run    one headless turn: `dsh --profile headless` with /workspace/instruction.md on stdin
#   serve  the multi-user entry: every TurnRequest in HE_TURNS_DIR becomes one headless turn in the
#          dsh Session kept for its key, all in one DSH_HOME, so dsh's own session store decides
#          what carries across conversations.
#
# Every turn runs `dsh --profile headless --patch config/patch.yml --json` in its own session (setsid)
# with the prompt on stdin. config/patch.yml points the anthropic route at the proxy, names the cell
# model, turns off web tools and adds the world-MCP server (and gbrain, when set), all from this
# process's environment. Exit mapping (pin.json serve.exit_mapping):
#   0    a final event with reason completed, and no MCP transport error in the turn
#   124  the turn outlived its budget: SIGTERM to the turn's session, SIGKILL after the grace
#        (60 s for run, 5 s for serve)
#   3    a final event with reason error whose message starts with an HTTP status (a proxy refusal
#        such as 402 or 403, a provider 4xx or 5xx after two retries) or whose code is TRANSPORT
#        (the proxy unreachable after two retries)
#   2    anything else: no session or final event (a crash, an MCP server that failed at startup,
#        output that does not parse), another error reason, a call to a configured MCP server's tool
#        that failed at the transport level, a dsh version other than pin.json's, SIGTERM during a
#        turn, HE_MODEL_BASE_URL not ending in /anthropic
set -euo pipefail

: "${HE_WORKSPACE_DIR:=/workspace}"
: "${HE_SESSION_STATE_DIR:=/harness-state}"
: "${HE_LOG_DIR:?HE_LOG_DIR must be set}"
: "${HE_MODEL_BASE_URL:?HE_MODEL_BASE_URL must be set}"
: "${HE_MODEL_API_KEY:?HE_MODEL_API_KEY must be set}"
: "${HE_MODEL_NAME:=claude-sonnet-5-5}"
: "${HE_TIME_BUDGET_S:=300}"
: "${HE_TRIAL_ID:=unknown}"
export HE_MODEL_NAME HE_MODEL_BASE_URL
# HE_SESSION_SCOPE=turn (the per-turn session cell, docs/adapters.md) is only implemented by the OpenClaw adapter;
# refusing it here keeps a cell that asks for it from silently running per-conversation sessions.
if [ "${HE_SESSION_SCOPE:-conversation}" != conversation ]; then echo "dsh adapter: HE_SESSION_SCOPE=${HE_SESSION_SCOPE} is not supported (only the openclaw adapter keys sessions per turn)" >&2; exit 2; fi

mkdir -p "$HE_LOG_DIR"
exec > >(tee -a "$HE_LOG_DIR/stdout.log") 2> >(tee -a "$HE_LOG_DIR/stderr.log" >&2)
log() { printf '%s dsh[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }
now() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }
# HARN-5: the sha256 of this adapter file goes into the ready file (HE-ADAPTER-005).
adapter_sha256=$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)
harness_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
patch_file="$harness_dir/config/patch.yml"

entry=${1:-run}
case "$entry" in
  run|serve) ;;
  *) log "unknown entry point: $entry; 'run' and 'serve' are implemented"; exit 2 ;;
esac

# config/patch.yml routes the model through dsh's anthropic provider only, so the runner's proxy route must be the anthropic
# provider's (<proxy>/<slot>/anthropic, runner/trial/proxy.ts baseUrlFor).
case "${HE_MODEL_BASE_URL%/}" in
  */anthropic) ;;
  *) log "HE_MODEL_BASE_URL $HE_MODEL_BASE_URL does not end in /anthropic: dsh runs only on an anthropic cell (the proxy route <proxy>/<slot>/anthropic)"; exit 2 ;;
esac

# Set before anything long runs: bash is PID 1 in the container and ignores a SIGTERM it has no trap for.
stopping=0
trap 'stopping=1' TERM INT

# gbrain documents no install for dsh, so any install rung is refused before ready (HE-ADAPTER-006); a bare gbrain MCP
# server (HE_GBRAIN_MCP_URL) is still wired in by config/patch.yml.
if [ -n "${HE_GBRAIN_INSTALL:-}" ]; then
  reason="HE_GBRAIN_INSTALL=$HE_GBRAIN_INSTALL is not implemented for dsh (gbrain documents no install for this harness)"
  node -e 'const [out, install, split, dir, error] = process.argv.slice(1); require("fs").writeFileSync(out, JSON.stringify({ status: "error", code: "HE-ADAPTER-006", harness: "dsh", split, install, dir, view_digest: null, files: 0, destinations: [], copied: [], error }));' \
    "$HE_LOG_DIR/gbrain-install.json" "$HE_GBRAIN_INSTALL" "${HE_GBRAIN_SPLIT:-}" "${HE_GBRAIN_INSTALL_DIR:-/he-gbrain-install}" "$reason"
  log "$HE_GBRAIN_INSTALL install: HE-ADAPTER-006 the install bundle could not be applied: $reason; fix: run this cell without gbrain.install"
  exit 2
fi

# No instruction routes or ablation configs yet: unset, empty or default only.
case "${HE_HARNESS_CONFIG:-default}" in
  ''|default) ;;
  *) log "HE-ADAPTER-007 HE_HARNESS_CONFIG=$HE_HARNESS_CONFIG is not a dsh config (default)"; exit 2 ;;
esac

# HOME and DSH_HOME hold sessions (DSH_HOME/sessions), profiles and dsh's own state. No .credentials.yaml is ever
# written: the anthropic route reads ANTHROPIC_API_KEY, the per-trial token, per request.
export HOME="$HE_SESSION_STATE_DIR"
export DSH_HOME="$HE_SESSION_STATE_DIR/dsh"
export TMPDIR="$HE_SESSION_STATE_DIR/tmp"
mkdir -p "$DSH_HOME" "$TMPDIR"
export ANTHROPIC_API_KEY="$HE_MODEL_API_KEY"
# No side traffic: dsh's session telemetry posts to an OpenTelemetry collector unless this is set (any non-empty value).
export DSH_TELEMETRY_DISABLED=1

pinned_version=$(node -e 'process.stdout.write(String(require(process.argv[1]).version))' "$harness_dir/pin.json")
dsh_version=$(dsh --version 2>/dev/null || true)
log "dsh $dsh_version model=anthropic/$HE_MODEL_NAME budget=${HE_TIME_BUDGET_S}s entry=$entry"
if [ "$dsh_version" != "$pinned_version" ]; then
  log "dsh --version is '$dsh_version', pin.json says $pinned_version"
  exit 2
fi

cd "$HE_WORKSPACE_DIR"

mcp_servers=()
if [ -n "${HE_WORLD_MCP_URL:-}" ] && [ -n "${HE_WORLD_MCP_TOKEN:-}" ]; then mcp_servers+=(world); fi
if [ -n "${HE_GBRAIN_MCP_URL:-}" ] && [ -n "${HE_GBRAIN_MCP_TOKEN:-}" ]; then mcp_servers+=(gbrain); fi
if [ "$entry" = serve ] && [[ " ${mcp_servers[*]} " != *" world "* ]]; then log "serve needs HE_WORLD_MCP_URL and HE_WORLD_MCP_TOKEN"; exit 2; fi

# Before ready, each server must answer tools/list with the bearer, so a trial never starts with a server the harness cannot use.
for name in "${mcp_servers[@]}"; do
  if [ "$name" = world ]; then url=$HE_WORLD_MCP_URL token=$HE_WORLD_MCP_TOKEN; else url=$HE_GBRAIN_MCP_URL token=$HE_GBRAIN_MCP_TOKEN; fi
  tools=''
  for attempt in 1 2 3 4 5; do
    tools=$(curl -sS --max-time 20 -X POST "$url" -H "Authorization: Bearer $token" -H 'content-type: application/json' \
      -H 'accept: application/json, text/event-stream' --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' 2>/dev/null \
      | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const body = s.split("\n").map((l) => l.replace(/^data: /, "")).find((l) => l.startsWith("{")) ?? "";
  try { const r = JSON.parse(body); if (Array.isArray(r.result?.tools)) process.stdout.write(String(r.result.tools.length)); } catch {}
});') || true
    [ -n "$tools" ] && break
    sleep 1
  done
  if [ -z "$tools" ]; then log "MCP server $name did not answer tools/list at $url"; exit 2; fi
  log "MCP server $name: tools/list answered $tools tools; config/patch.yml registers it"
done

# Session key -> dsh Session id. dsh makes the id when a Session is created; --session-id adopts it on later turns.
sessions_file="$HE_SESSION_STATE_DIR/dsh-sessions.json"
[ -e "$sessions_file" ] || echo '{}' > "$sessions_file"
turn_pid=''

stop_session() {
  local sid=$1 grace=$2 waited=0
  pkill -TERM -s "$sid" 2>/dev/null || true
  while pgrep -s "$sid" >/dev/null 2>&1 && [ "$waited" -lt $((grace * 5)) ]; do sleep 0.2; waited=$((waited + 1)); done
  pkill -KILL -s "$sid" 2>/dev/null || true
}

# One turn. Arguments: file prefix for this turn's logs, prompt file, session key, budget, kill grace. Sets turn_code and
# turn_detail; the reply is in <prefix>.reply.txt.
run_turn() {
  local prefix=$1 prompt=$2 key=$3 budget=$4 grace=$5 sid deadline timed_out=0 stopped=0 code line
  local session_args=()
  sid=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]] ?? "")' "$sessions_file" "$key")
  if [ -n "$sid" ]; then session_args=(--session-id "$sid"); log "session $key: --session-id $sid"; else log "session $key: new"; fi
  set +e
  setsid dsh --profile headless --patch "$patch_file" --json --permission-mode danger-full-access "${session_args[@]}" - \
    < "$prompt" > "$prefix.dsh.jsonl" 2> >(tee -a "$prefix.stderr.log" >&2) &
  turn_pid=$!
  deadline=$((SECONDS + budget))
  while kill -0 "$turn_pid" 2>/dev/null; do
    if [ "$stopping" -eq 1 ]; then stopped=1; stop_session "$turn_pid" "$grace"; break; fi
    if [ "$SECONDS" -ge "$deadline" ]; then timed_out=1; stop_session "$turn_pid" "$grace"; break; fi
    sleep 0.2
  done
  wait "$turn_pid"; code=$?
  turn_pid=''
  line=$(node - "$prefix.dsh.jsonl" "$prefix.reply.txt" "$prefix.status.json" "$code" "$sessions_file" "$key" "${mcp_servers[@]}" <<'JS'
const fs = require("fs");
const [events, replyPath, statusPath, exitCode, sessionsFile, key, ...servers] = process.argv.slice(2);
let session = null, final = null, unparsed = 0;
// A configured MCP server's tool call that failed at the transport level: dsh hands the model an error tool_result and the
// turn goes on (0.2.2-rc.1, observed: "Error: Error POSTing to endpoint: bad gateway" for an HTTP 502; from the MCP SDK it
// bundles: "MCP error -32001: Request timed out" past toolCallTimeoutMs, "MCP error -32000: Connection closed"; from
// dsh-mcp-client: "<label>: server is disconnected"). Anchored at the start of the message, so a tool's own error result
// (the server's text, which may hold a word like ENOTFOUND) is never one.
const mcpTool = new RegExp("^mcp__(" + servers.join("|") + ")__");
const transportError = /^(?:Error: )*(?:(?:TypeError: )?(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN)\b|(?:TypeError: )?fetch failed|socket hang up|Unable to connect|Error POSTing to endpoint|Failed to open SSE stream|Streamable HTTP error|MCP error -32000: Connection closed|MCP error -32001: Request timed out|[^\n:]{1,80}: server is disconnected$)/;
const mcpCalls = new Map(), transport = [];
for (const l of fs.readFileSync(events, "utf8").split("\n")) {
  if (!l.trim()) continue;
  let ev;
  try { ev = JSON.parse(l); } catch { unparsed++; continue; }
  if (ev.type === "session" && !session) session = ev.sessionId ?? null;
  if (ev.type === "final") final = ev;
  if (ev.type === "tool_call" && servers.length && mcpTool.test(ev.tool ?? "")) mcpCalls.set(ev.callId, ev.tool);
  if (ev.type === "tool_result" && ev.status === "error" && mcpCalls.has(ev.callId)) {
    const text = String(ev.result ?? ev.error?.message ?? "").trim();
    if (transportError.test(text)) transport.push(mcpCalls.get(ev.callId) + ": " + text.slice(0, 120));
  }
}
const reason = final?.reason ?? null;
const err = reason?.kind === "error" ? reason.error ?? {} : null;
let code = 0, detail = "";
if (!session) [code, detail] = [2, "no session event in the --json output (dsh exit " + exitCode + ", " + unparsed + " unparsed lines)"];
else if (!final) [code, detail] = [2, "no final event (dsh exit " + exitCode + ")"];
else if (transport.length) [code, detail] = [2, "MCP transport error: " + transport[0]];
else if (err && (/^\d{3}\b/.test(String(err.message ?? "")) || err.code === "TRANSPORT")) [code, detail] = [3, "model error: " + (err.code ?? "") + " " + String(err.message ?? "").slice(0, 200)];
else if (err || reason?.kind !== "completed") [code, detail] = [2, "final reason " + (reason?.kind ?? "none") + (err ? ": " + (err.code ?? "") + " " + String(err.message ?? "").slice(0, 200) : "")];
else if (exitCode !== "0") [code, detail] = [2, "dsh exit " + exitCode];
if (session) {
  const map = JSON.parse(fs.readFileSync(sessionsFile, "utf8"));
  if (!map[key]) { map[key] = session; fs.writeFileSync(sessionsFile + ".tmp", JSON.stringify(map)); fs.renameSync(sessionsFile + ".tmp", sessionsFile); }
}
fs.writeFileSync(replyPath, code === 0 ? String(final.text ?? "").trim() : "");
fs.writeFileSync(statusPath, JSON.stringify({ dsh_exit: Number(exitCode), session_id: session, reason: reason?.kind ?? null, error_code: err?.code ?? null,
  mcp_tool_calls: mcpCalls.size, mcp_transport_errors: transport.length, unparsed }));
process.stdout.write(code + " " + detail.replace(/\s+/g, " "));
JS
)
  set -e
  turn_code=${line%% *}
  turn_detail=''
  [[ "$line" == *" "* ]] && turn_detail=${line#* }
  if [ "$timed_out" -eq 1 ]; then turn_code=124; turn_detail="wall clock exceeded (${budget}s)"; fi
  if [ "$stopped" -eq 1 ]; then turn_code=2; turn_detail="stopped by SIGTERM during the turn"; fi
  if ! [[ "$turn_code" =~ ^[0-9]+$ ]]; then turn_code=2; turn_detail="the turn's output could not be read"; fi
  return 0
}

if [ "$entry" = "run" ]; then
  [ -r "$HE_WORKSPACE_DIR/instruction.md" ] || { log "no readable $HE_WORKSPACE_DIR/instruction.md"; exit 2; }
  [ "$stopping" -eq 0 ] || { log "stopped by SIGTERM before the turn"; exit 2; }
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

printf '{"harness":"dsh","version":"%s","trial":"%s","ready_at":"%s","session_keys":"dsh --profile headless --session-id <id kept per dm:<member> | channel:<id> in dsh-sessions.json>","mcp_servers":"%s","adapter_sha256":"%s"}\n' \
  "$dsh_version" "$HE_TRIAL_ID" "$(now)" "${mcp_servers[*]}" "$adapter_sha256" > "$HE_LOG_DIR/ready.tmp"
mv "$HE_LOG_DIR/ready.tmp" "$HE_LOG_DIR/ready"
log "serve: ready; polling $HE_TURNS_DIR"
while [ "$stopping" -eq 0 ]; do
  for req in "$HE_TURNS_DIR"/turn-*.request.json; do
    [ -e "$req" ] || continue
    [ "$stopping" -eq 0 ] || break
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
