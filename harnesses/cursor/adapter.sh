#!/usr/bin/env bash
# Cursor CLI adapter. Protocol: docs/adapters.md. Exit 0 completed, 2 harness error, 3 model error, 124 wall clock.
#
#   run    one headless turn: agent -p with /workspace/instruction.md as the prompt
#   serve  the multi-user entry: the world-MCP server (and gbrain, when set) go into the CLI's user MCP config
#          ($HOME/.cursor/mcp.json), then every TurnRequest in HE_TURNS_DIR becomes one agent -p turn, resumed per
#          conversation (--resume <chat id>), all in the same HOME, so Cursor's own chat store decides what carries.
#
# Cursor has no bring-your-own-key: the CLI sends every model call to Cursor's backend with CURSOR_API_KEY, so there is
# no metering-proxy route here (harnesses/cursor/README.md, "Cost"). HE_MODEL_BASE_URL and HE_MODEL_API_KEY are ignored.
# The key is checked for presence only and never printed; the CLI's stdout and stderr pass through redact.cjs, which
# replaces the key's literal value, before they reach $HE_LOG_DIR.
#
# Exit mapping (pin.json serve.exit_mapping):
#   0    agent exited 0 with a success result record, and the init record's model is pin.json's init_model_name
#   124  the turn outlived its budget: SIGTERM to the turn's session, SIGKILL after the grace (60 s run, 5 s serve)
#   3    no result record and stderr says "Failed to reach the Cursor API" (the CLI's message when the egress
#        allowlist denied its connection, seen in the keyless install check)
#   2    anything else: no init or result record, an init record naming another model, any other backend error, a CLI
#        version other than pin.json's, a refused config (HE-ADAPTER-006, HE-ADAPTER-007, HE-CURSOR-001,
#        HE-CURSOR-002, HE-CURSOR-004), SIGTERM during a turn
#
# Every Cursor-specific name here (flags, config keys, files, stream-json fields) has a public source listed in
# harnesses/cursor/README.md, "Clean-room rebuild (2026-11-09)".
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
: "${HE_MODEL_NAME:=claude-opus-5-5}"
: "${HE_TIME_BUDGET_S:=300}"
: "${HE_TRIAL_ID:=unknown}"
if [ "${HE_SESSION_SCOPE:-conversation}" != conversation ]; then echo "cursor adapter: HE_SESSION_SCOPE=${HE_SESSION_SCOPE} is not supported (only the openclaw adapter keys sessions per turn)" >&2; exit 2; fi

mkdir -p "$HE_LOG_DIR"
exec > >(tee -a "$HE_LOG_DIR/stdout.log") 2> >(tee -a "$HE_LOG_DIR/stderr.log" >&2)
log() { printf '%s cursor[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }
now() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }
adapter_sha256=$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)
harness_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

entry=${1:-serve}
case "$entry" in
  run|serve) ;;
  *) log "unknown entry point: $entry; 'run' and 'serve' are implemented"; exit 2 ;;
esac

stopping=0
if [ -n "${HE_STOP_FILE:-}" ]; then : > "$HE_STOP_FILE.armed"; else trap 'stopping=1' TERM INT; fi

pin_field() { node -e 'const v = process.argv[2].split(".").reduce((o, k) => o?.[k], require(process.argv[1])); process.stdout.write(Array.isArray(v) ? v.join(",") : String(v ?? ""))' "$harness_dir/pin.json" "$1"; }
pinned_version=$(pin_field version)
model_id=$(pin_field model_cursor.model_id)
turn_model=$(pin_field model_cursor.turn_model)
init_model_name=$(pin_field model_cursor.init_model_name)

# Refusals, each before anything is written. gbrain's install ladder and the instruction routes have no Cursor
# implementation; a cell that asks for one stops here instead of running as a bare cell.
if [ -n "${HE_GBRAIN_INSTALL:-}" ]; then log "HE-ADAPTER-006 HE_GBRAIN_INSTALL=$HE_GBRAIN_INSTALL is not implemented for cursor; fix: run this cell without gbrain.install"; exit 2; fi
case "${HE_HARNESS_CONFIG:-default}" in
  ''|default) ;;
  *) log "HE-ADAPTER-007 HE_HARNESS_CONFIG=$HE_HARNESS_CONFIG: cursor has no instruction routes or other configs; fix: drop config from the cell"; exit 2 ;;
esac
if [ "$HE_MODEL_NAME" != "$model_id" ]; then
  log "HE-CURSOR-001 HE_MODEL_NAME=$HE_MODEL_NAME is not the pinned Cursor model $model_id (pin.json model_cursor.model_id); fix: run Cursor cells on anthropic:$model_id only"
  exit 2
fi
if [ -z "${CURSOR_API_KEY:+x}" ]; then log "HE-CURSOR-002 CURSOR_API_KEY is not set in the container; fix: the runner passes it by name to Cursor cells only, so set it in the runner's shell"; exit 2; fi

# HE-CURSOR-004: the names Cursor's docs say it loads on its own (AGENTS.md and CLAUDE.md rules, .cursor/, the skills,
# agents and hooks it reads from .agents/, .claude/ and .codex/, and .cursorignore; pin.json instruction_files), listed
# under the workspace and HOME before this adapter writes anything there. The runner writes only instruction.md (run)
# into the workspace, so any hit is a file the harness would read that the task did not put there.
if ! files_line=$(node - "$HE_WORKSPACE_DIR" "$HE_SESSION_STATE_DIR" "$HE_LOG_DIR/instruction-files.json" <<'JS'
const fs = require("fs"), path = require("path");
const [workspace, home, out] = process.argv.slice(2);
const NAMES = ["AGENTS.md", "CLAUDE.md", ".cursor", ".agents", ".claude", ".codex", ".cursorignore"];
const lower = new Set(NAMES.map((n) => n.toLowerCase()));
const found = [];
let entries = 0;
const walk = (dir, depth) => {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of list) {
    if (++entries > 200000) return;
    const p = path.join(dir, e.name);
    if (lower.has(e.name.toLowerCase())) found.push(p);
    if (e.isDirectory() && !e.isSymbolicLink() && e.name !== "node_modules" && e.name !== ".git" && depth < 32) walk(p, depth + 1);
  }
};
walk(workspace, 0);
for (const n of NAMES) if (fs.existsSync(path.join(home, n))) found.push(path.join(home, n));
const rec = { checked: [workspace + " (recursive, node_modules and .git skipped)", home + " (top level, before the adapter writes)"], names: NAMES, found: [...new Set(found)].sort(), entries };
fs.writeFileSync(out + ".tmp", JSON.stringify(rec, null, 1) + "\n");
fs.renameSync(out + ".tmp", out);
process.stdout.write(String(rec.found.length) + " " + rec.found.slice(0, 5).join(","));
JS
); then log "HE-CURSOR-004 the instruction-file check could not run; see stderr.log"; exit 2; fi
if [ "${files_line%% *}" != 0 ]; then
  log "HE-CURSOR-004 files the Cursor CLI loads on its own are present: ${files_line#* } (all in $HE_LOG_DIR/instruction-files.json); fix: remove them from the task's workspace seed"
  exit 2
fi
log "instruction files: none of the names the CLI loads on its own under $HE_WORKSPACE_DIR or $HE_SESSION_STATE_DIR"

export HOME="$HE_SESSION_STATE_DIR"
export TMPDIR="$HE_SESSION_STATE_DIR/tmp"
unset CURSOR_CONFIG_DIR XDG_CONFIG_HOME
mkdir -p "$HOME/.cursor" "$TMPDIR"
[ -e "$HOME/.cursor/cli-config.json" ] || cp "$harness_dir/config/cli-config.json" "$HOME/.cursor/cli-config.json"

# The tool audit: documented postToolUse and postToolUseFailure command hooks in the user hooks file, each appending the
# call's tool_name (and failure_type) to tool-hooks.ndjson. They answer {} and change no call (pin.json web_tools.audit).
tool_hooks_log="$HE_LOG_DIR/tool-hooks.ndjson"
touch "$tool_hooks_log"
node -e '
const [out, script, log] = process.argv.slice(1);
const sq = String.fromCharCode(39);
const q = (s) => sq + s.split(sq).join(sq + "\\" + sq + sq) + sq;
const hook = [{ command: "node " + q(script) + " " + q(log) }];
require("fs").writeFileSync(out, JSON.stringify({ version: 1, hooks: { postToolUse: hook, postToolUseFailure: hook } }, null, 2) + "\n");
' "$HOME/.cursor/hooks.json" "$harness_dir/tool-audit-hook.cjs" "$tool_hooks_log"

agent_version=$(agent --version 2>/dev/null || true)
log "cursor $agent_version model=$turn_model budget=${HE_TIME_BUDGET_S}s entry=$entry"
if [ "$agent_version" != "$pinned_version" ]; then log "agent --version is '$agent_version', pin.json says $pinned_version"; exit 2; fi

cd "$HE_WORKSPACE_DIR"

mcp_config="$HOME/.cursor/mcp.json"
mcp_servers=()
if [ -n "${HE_WORLD_MCP_URL:-}" ] && [ -n "${HE_WORLD_MCP_TOKEN:-}" ]; then mcp_servers+=(world); fi
if [ -n "${HE_GBRAIN_MCP_URL:-}" ] && [ -n "${HE_GBRAIN_MCP_TOKEN:-}" ]; then mcp_servers+=(gbrain); fi
if [ "$entry" = serve ] && [[ " ${mcp_servers[*]:-} " != *" world "* ]]; then log "HE-ADAPTER-004 serve needs HE_WORLD_MCP_URL and HE_WORLD_MCP_TOKEN"; exit 2; fi
( umask 077 && node -e '
const [out, ...names] = process.argv.slice(1);
const env = { world: ["HE_WORLD_MCP_URL", "HE_WORLD_MCP_TOKEN"], gbrain: ["HE_GBRAIN_MCP_URL", "HE_GBRAIN_MCP_TOKEN"] };
const mcpServers = {};
for (const n of names) mcpServers[n] = { url: process.env[env[n][0]], headers: { Authorization: "Bearer " + process.env[env[n][1]] } };
require("fs").writeFileSync(out, JSON.stringify({ mcpServers }, null, 2) + "\n");
' "$mcp_config" ${mcp_servers[@]+"${mcp_servers[@]}"} )

for name in ${mcp_servers[@]+"${mcp_servers[@]}"}; do
  if [ "$name" = world ]; then url=$HE_WORLD_MCP_URL token=$HE_WORLD_MCP_TOKEN; else url=$HE_GBRAIN_MCP_URL token=$HE_GBRAIN_MCP_TOKEN; fi
  tools=''
  for attempt in 1 2 3 4 5; do
    tools=$(curl -sS --noproxy '*' --max-time 20 -X POST "$url" -H "Authorization: Bearer $token" -H 'content-type: application/json' \
      -H 'accept: application/json, text/event-stream' --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' 2>/dev/null \
      | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const body = s.split("\n").map((l) => l.replace(/^data: /, "")).find((l) => l.startsWith("{")) ?? "";
  try { const r = JSON.parse(body); if (Array.isArray(r.result?.tools)) process.stdout.write(String(r.result.tools.length)); } catch {}
});') || true
    [ -n "$tools" ] && break
    sleep 1
  done
  if [ -z "$tools" ]; then log "HE-ADAPTER-004 MCP server $name did not answer tools/list at $url"; exit 2; fi
  log "MCP server $name: tools/list answered $tools tools; wired into $mcp_config"
done

chats="$HE_SESSION_STATE_DIR/cursor-chats.json"
turn_pid=''

stop_session() {
  local sid=$1 grace=$2 waited=0
  pkill -TERM -s "$sid" 2>/dev/null || true
  while pgrep -s "$sid" >/dev/null 2>&1 && [ "$waited" -lt $((grace * 5)) ]; do sleep 0.2; waited=$((waited + 1)); done
  pkill -KILL -s "$sid" 2>/dev/null || true
}

# One turn: the conversation's chat is resumed when cursor-chats.json has its id; the CLI's stdout and stderr reach the
# log directory only through redact.cjs, by way of two FIFOs in a private directory that holds no bytes at rest.
run_turn() {
  local prefix=$1 prompt=$2 key=$3 budget=$4 grace=$5 chat fifo_dir out_pid err_pid deadline timed_out=0 stopped=0 code line
  local -a resume_args=()
  chat=$(node -e 'const fs = require("fs"); const [f, k] = process.argv.slice(1); let m = {}; try { m = JSON.parse(fs.readFileSync(f, "utf8")); } catch {} process.stdout.write(m[k] ?? "")' "$chats" "$key")
  if [ -n "$chat" ]; then resume_args=(--resume "$chat"); log "session $key: --resume $chat"; else log "session $key: new chat"; fi
  fifo_dir=$(mktemp -d "$TMPDIR/turn.XXXXXX")
  mkfifo -m 600 "$fifo_dir/out" "$fifo_dir/err"
  node "$harness_dir/redact.cjs" CURSOR_API_KEY < "$fifo_dir/out" > "$prefix.cursor.jsonl" & out_pid=$!
  node "$harness_dir/redact.cjs" CURSOR_API_KEY < "$fifo_dir/err" > "$prefix.stderr.log" & err_pid=$!
  set +e
  setsid agent -p --output-format stream-json --force --trust --approve-mcps --workspace "$HE_WORKSPACE_DIR" --model "$turn_model" \
    --disable-auto-update ${resume_args[@]+"${resume_args[@]}"} -- "$(cat "$prompt")" < /dev/null > "$fifo_dir/out" 2> "$fifo_dir/err" &
  turn_pid=$!
  deadline=$((SECONDS + budget))
  while kill -0 "$turn_pid" 2>/dev/null; do
    if { he_stop_check; [ "$stopping" -eq 1 ]; }; then stopped=1; stop_session "$turn_pid" "$grace"; break; fi
    if [ "$SECONDS" -ge "$deadline" ]; then timed_out=1; stop_session "$turn_pid" "$grace"; break; fi
    sleep 0.2
  done
  wait "$turn_pid"; code=$?
  wait "$out_pid" "$err_pid"
  turn_pid=''
  rm -rf "$fifo_dir"
  line=$(node - "$prefix.cursor.jsonl" "$prefix.stderr.log" "$prefix.reply.txt" "$prefix.status.json" "$code" "$init_model_name" "$chats" "$key" <<'JS'
const fs = require("fs");
const [events, stderrPath, replyPath, statusPath, exitCode, initModel, chatsPath, key] = process.argv.slice(2);
let init = null, result = null, unparsed = 0, started = 0;
const tools = {};
// The documented stream-json records (https://cursor.com/docs/cli/reference/output-format): system/init, tool_call
// started (tool_call holds one key naming the tool, or function with a name) and the terminal result.
for (const l of fs.readFileSync(events, "utf8").split("\n")) {
  if (!l.trim()) continue;
  let ev;
  try { ev = JSON.parse(l); } catch { unparsed++; continue; }
  if (ev.type === "system" && ev.subtype === "init" && !init) init = ev;
  if (ev.type === "result") result = ev;
  if (ev.type === "tool_call" && ev.subtype === "started" && ev.tool_call && typeof ev.tool_call === "object") {
    started++;
    for (const k of Object.keys(ev.tool_call)) { const name = k === "function" ? "function:" + String(ev.tool_call.function?.name ?? "") : k; tools[name] = (tools[name] ?? 0) + 1; }
  }
}
const stderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf8") : "";
const unreachable = /Failed to reach the Cursor API/;
const model = init?.model ?? null;
const ok = result && result.type === "result" && result.subtype === "success" && result.is_error === false;
let code = 0, detail = "";
if (ok && exitCode === "0" && String(model ?? "").trim().toLowerCase() !== initModel.toLowerCase()) [code, detail] = [2, "the init record names model " + JSON.stringify(model) + ", not " + JSON.stringify(initModel) + " (pin.json model_cursor.init_model_name)"];
else if (ok && exitCode === "0") code = 0;
else if (!result && unreachable.test(stderr)) [code, detail] = [3, "model error: Failed to reach the Cursor API (agent exit " + exitCode + ")"];
else if (!init) [code, detail] = [2, "no init record in the stream-json output (agent exit " + exitCode + ", " + unparsed + " unparsed lines)"];
else if (!result) [code, detail] = [2, "no result record (agent exit " + exitCode + ")"];
else [code, detail] = [2, "result " + (result.subtype ?? "") + " is_error " + result.is_error + " (agent exit " + exitCode + ")"];
const chat = result?.session_id ?? init?.session_id ?? null;
if (chat && code === 0) {
  let m = {};
  try { m = JSON.parse(fs.readFileSync(chatsPath, "utf8")); } catch {}
  if (!m[key]) { m[key] = chat; fs.writeFileSync(chatsPath + ".tmp", JSON.stringify(m)); fs.renameSync(chatsPath + ".tmp", chatsPath); }
}
fs.writeFileSync(replyPath, code === 0 ? String(result.result ?? "").trim() : "");
fs.writeFileSync(statusPath, JSON.stringify({ agent_exit: Number(exitCode), model, session_id: chat, api_key_source: init?.apiKeySource ?? null, permission_mode: init?.permissionMode ?? null,
  result_subtype: result?.subtype ?? null, is_error: result?.is_error ?? null, request_id: result?.request_id ?? null, duration_ms: result?.duration_ms ?? null, usage: null,
  tool_calls_started: started, tool_calls: tools, unparsed }));
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

ready_json() {
  node -e '
const [version, trial, at, servers, sha, turnModel, files, hooksLog] = process.argv.slice(1);
process.stdout.write(JSON.stringify({ harness: "cursor", version, trial, ready_at: at, session_keys: "agent -p, a new chat per dm:<member> | channel:<id>, then --resume <chat id>", mcp_servers: servers,
  adapter_sha256: sha, model: turnModel, transport: "cursor-backend (no metering proxy)", instruction_files: JSON.parse(require("fs").readFileSync(files, "utf8")).found,
  tool_audit: hooksLog }) + "\n");' \
    "$agent_version" "$HE_TRIAL_ID" "$(now)" "${mcp_servers[*]:-}" "$adapter_sha256" "$turn_model" "$HE_LOG_DIR/instruction-files.json" "$tool_hooks_log"
}

if [ "$entry" = "run" ]; then
  [ -r "$HE_WORKSPACE_DIR/instruction.md" ] || { log "no readable $HE_WORKSPACE_DIR/instruction.md"; exit 2; }
  { he_stop_check; [ "$stopping" -eq 0 ]; } || { log "stopped by SIGTERM before the turn"; exit 2; }
  ready_json > "$HE_LOG_DIR/ready"
  run_turn "$HE_LOG_DIR/run" "$HE_WORKSPACE_DIR/instruction.md" "run:$HE_TRIAL_ID" "$HE_TIME_BUDGET_S" 60
  case "$turn_code" in
    0) cat "$HE_LOG_DIR/run.reply.txt"; echo; log "completed" ;;
    124) log "wall clock exceeded (HE_TIME_BUDGET_S=$HE_TIME_BUDGET_S)" ;;
    *) log "exit $turn_code: $turn_detail" ;;
  esac
  exit "$turn_code"
fi

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

ready_json > "$HE_LOG_DIR/ready.tmp"
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
