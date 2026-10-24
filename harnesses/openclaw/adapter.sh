#!/usr/bin/env bash
# OpenClaw adapter. Protocol: docs/adapters.md. Exit 0 completed, 2 harness
# error, 3 model error, 124 wall clock.
#
#   run    one headless turn with `openclaw agent exec` on /workspace/instruction.md
#   serve  the multi-user entry: the world-MCP server is saved into the config
#          copy with `openclaw mcp set`, then every TurnRequest in HE_TURNS_DIR
#          becomes one `openclaw agent --local` turn in the session
#          agent:main:dm:<member> or agent:main:channel:<id>, all against the
#          same OPENCLAW_STATE_DIR, so OpenClaw's own session store and memory
#          decide what carries across conversations.
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
now() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }

entry=${1:-run}
case "$entry" in
  run|serve) ;;
  *) log "unknown entry point: $entry; 'run' and 'serve' are implemented"; exit 2 ;;
esac

# All OpenClaw state (config copy, sessions, agent dirs, credentials) lives
# under /harness-state. The config template is read-only in the image.
export HOME="$HE_SESSION_STATE_DIR"
export OPENCLAW_STATE_DIR="$HE_SESSION_STATE_DIR/openclaw"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_STATE_DIR/openclaw.json"
mkdir -p "$OPENCLAW_STATE_DIR/exec"
[ -e "$OPENCLAW_CONFIG_PATH" ] || cp /opt/harness/config/openclaw.json "$OPENCLAW_CONFIG_PATH"

log "openclaw $(openclaw --version 2>/dev/null | head -1) model=anthropic/$HE_MODEL_NAME budget=${HE_TIME_BUDGET_S}s entry=$entry"

# A model error is a provider status, a proxy refusal, a rate limit or an auth
# failure in the envelope or on stderr; everything else that fails is OpenClaw's.
model_error_pattern='"status":\s*(401|402|403|404|429|5[0-9]{2})|metering proxy|rate.?limit|overloaded|api error|authentication|invalid.*api.?key|HTTP (401|402|403|404|429|5[0-9]{2})'

if [ "$entry" = "run" ]; then
  [ -r "$HE_WORKSPACE_DIR/instruction.md" ] || { log "no readable $HE_WORKSPACE_DIR/instruction.md"; exit 2; }
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
  if grep -Eqi "$model_error_pattern" "$HE_LOG_DIR/openclaw-exec.json" "$HE_LOG_DIR/stderr.log"; then
    log "model error (openclaw exit $code)"; exit 3
  fi
  log "harness error (openclaw exit $code)"; exit 2
fi

# ---- serve ----------------------------------------------------------------------------------------
: "${HE_TURNS_DIR:=/he-turns}"
[ -n "${HE_WORLD_MCP_URL:-}" ] && [ -n "${HE_WORLD_MCP_TOKEN:-}" ] || { log "serve needs HE_WORLD_MCP_URL and HE_WORLD_MCP_TOKEN"; exit 2; }
mkdir -p "$HE_TURNS_DIR" "$HE_LOG_DIR/turns"

# The world-MCP server goes into mcp.servers.world of the config copy through
# OpenClaw's own registry command, which validates and saves it. The bearer
# token is the per-trial bot token the world minted (in the redaction set).
world_def=$(node -e 'process.stdout.write(JSON.stringify({ url: process.env.HE_WORLD_MCP_URL, transport: "streamable-http", headers: { Authorization: "Bearer " + process.env.HE_WORLD_MCP_TOKEN }, connectionTimeoutMs: 30000, requestTimeoutMs: 120000 }))')
openclaw mcp set world "$world_def" >> "$HE_LOG_DIR/adapter.log" 2>&1 || { log "openclaw mcp set world failed"; exit 2; }
# The gbrain arm (docs/gbrain-arm.md): with HE_GBRAIN_MCP_URL and HE_GBRAIN_MCP_TOKEN set, a second server named
# gbrain goes in beside world the same way. The URL is the world's /gbrain tap and the token the same bot token,
# so the registration is byte-for-byte the world's shape with another name. Unset, nothing here runs.
if [ -n "${HE_GBRAIN_MCP_URL:-}" ] && [ -n "${HE_GBRAIN_MCP_TOKEN:-}" ]; then
  gbrain_def=$(node -e 'process.stdout.write(JSON.stringify({ url: process.env.HE_GBRAIN_MCP_URL, transport: "streamable-http", headers: { Authorization: "Bearer " + process.env.HE_GBRAIN_MCP_TOKEN }, connectionTimeoutMs: 30000, requestTimeoutMs: 120000 }))')
  openclaw mcp set gbrain "$gbrain_def" >> "$HE_LOG_DIR/adapter.log" 2>&1 || { log "openclaw mcp set gbrain failed"; exit 2; }
  log "gbrain MCP wired as a second server (gbrain) through the world tap"
fi
if openclaw mcp probe > "$HE_LOG_DIR/openclaw-mcp-probe.log" 2>&1; then
  log "world-MCP wired: $(grep -m1 -- '- world' "$HE_LOG_DIR/openclaw-mcp-probe.log" | sed 's/^ *//')"
  [ -n "${HE_GBRAIN_MCP_URL:-}" ] && log "gbrain probe: $(grep -m1 -- '- gbrain' "$HE_LOG_DIR/openclaw-mcp-probe.log" | sed 's/^ *//')"
else
  log "world-MCP probe failed (see openclaw-mcp-probe.log); turns will show whether tools reach the world"
fi
[ -n "${HE_GBRAIN_MCP_URL:-}" ] && { openclaw mcp list > "$HE_LOG_DIR/openclaw-mcp-list.log" 2>&1 || true; }

# One serve turn: write the prompt to a file under HE_LOG_DIR, run the embedded agent in the
# conversation's session, and leave the JSON envelope beside it. Arguments: request path, session
# key, turn name, budget. Returns the mapped exit code; the reply text is in <turn>.reply.txt.
serve_turn() {
  local req=$1 key=$2 name=$3 budget=$4 code
  local prompt="$HE_LOG_DIR/turns/$name.prompt.md" envelope="$HE_LOG_DIR/turns/$name.openclaw.json" err="$HE_LOG_DIR/turns/$name.stderr.log"
  node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).prompt)' "$req" > "$prompt"
  set +e
  # OpenClaw's own deadline is the budget; the outer timeout is a backstop for its retry loop. Both
  # fire well inside the runner's 60 s grace.
  timeout -k 5 "$((budget + 15))" openclaw agent --local \
    --session-key "agent:main:$key" \
    --message-file "$prompt" \
    --model "anthropic/$HE_MODEL_NAME" \
    --timeout "$budget" \
    --json > "$envelope" 2> >(tee -a "$err" >&2)
  code=$?
  set -e
  node -e '
    const fs = require("fs");
    let env = {}; try { env = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
    const r = env.result ?? env;
    const texts = [];
    if (typeof r.final === "string") texts.push(r.final);
    else if (Array.isArray(r.payloads)) for (const p of r.payloads) if (p && typeof p.text === "string") texts.push(p.text);
    fs.writeFileSync(process.argv[2], texts.join("\n").trim());
    const status = r.status ?? env.status ?? (env.ok === false ? "error" : "ok");
    const errText = JSON.stringify(r.error ?? env.error ?? "");
    fs.writeFileSync(process.argv[3], JSON.stringify({ status, error: errText }));
  ' "$envelope" "$HE_LOG_DIR/turns/$name.reply.txt" "$HE_LOG_DIR/turns/$name.status.json"
  local status; status=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).status)' "$HE_LOG_DIR/turns/$name.status.json")
  case "$code:$status" in
    0:ok) return 0 ;;
    124:*|137:*|*:timeout) return 124 ;;
  esac
  if grep -Eqi "$model_error_pattern" "$envelope" "$err" "$HE_LOG_DIR/turns/$name.status.json"; then return 3; fi
  return 2
}

write_response() {
  local resp=$1 turn=$2 code=$3 reply_file=$4 started=$5 ended=$6 detail=$7
  node -e '
    const fs = require("fs");
    const [resp, turn, code, replyFile, started, ended, detail] = process.argv.slice(1);
    const exit = Number(code);
    const out = { turn: Number(turn), exit, reply_text: exit === 0 ? fs.readFileSync(replyFile, "utf8") : null, started_at: started, ended_at: ended };
    if (detail) out.detail = detail;
    fs.writeFileSync(resp + ".tmp", JSON.stringify(out));
    fs.renameSync(resp + ".tmp", resp);
  ' "$resp" "$turn" "$code" "$reply_file" "$started" "$ended" "$detail"
}

stopping=0
trap 'stopping=1' TERM INT
printf '{"harness":"openclaw","version":"%s","trial":"%s","ready_at":"%s","session_keys":"agent:main:dm:<member> | agent:main:channel:<id>"}\n' "${OPENCLAW_VERSION:-}" "$HE_TRIAL_ID" "$(now)" > "$HE_LOG_DIR/ready.tmp"
mv "$HE_LOG_DIR/ready.tmp" "$HE_LOG_DIR/ready"
log "serve: ready; polling $HE_TURNS_DIR"
while [ "$stopping" -eq 0 ]; do
  for req in "$HE_TURNS_DIR"/turn-*.request.json; do
    [ -e "$req" ] || continue
    base=${req%.request.json}; name=$(basename "$base"); resp="$base.response.json"
    [ -e "$resp" ] && continue
    read -r turn budget key < <(node -e '
      const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const key = r.channel.type === "dm" ? "dm:" + r.actor.member : "channel:" + r.channel.id;
      process.stdout.write([r.turn, r.time_budget_s || process.env.HE_TIME_BUDGET_S, key].join(" ") + "\n");
    ' "$req")
    log "turn $turn: session $key, budget ${budget}s"
    started=$(now)
    set +e
    serve_turn "$req" "$key" "$name" "$budget" &
    tpid=$!
    wait "$tpid"; code=$?
    if [ "$stopping" -eq 1 ] && kill -0 "$tpid" 2>/dev/null; then
      log "turn $turn: SIGTERM during the turn; stopping openclaw"
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
