#!/usr/bin/env bash
# QM adapter (sidecar topology). This runs in the task container of
# compose.yaml, beside the `core` and `pg` services. Protocol: docs/adapters.md.
# Exit 0 completed, 2 harness error, 3 model error, 124 wall clock.
#
#   run    waits for core, posts one DM turn as actor U1 with instruction.md as
#          the text, exits per the protocol. QM's agent works in a per-scope
#          sandbox container, not in /workspace; capture.sh copies that
#          sandbox's workspace into /workspace afterwards.
#   serve  the multi-user entry: registers the world-MCP server with core as
#          the trial's admin (PUT /v1/admin/mcp-servers/world, QM's own
#          connector path, so every scope's agent gets its tools), then answers
#          every TurnRequest in HE_TURNS_DIR with one POST /v1/turns whose actor
#          is the requester's Slack user id and whose conversation is
#          {kind: dm|channel, threadRef: dm:<member> | channel:<id>}: QM's native
#          scoping (personal:<actor> for a DM, channel:<id> for a channel).
set -euo pipefail

: "${HE_WORKSPACE_DIR:=/workspace}"
: "${HE_SESSION_STATE_DIR:=/harness-state}"
: "${HE_LOG_DIR:?HE_LOG_DIR must be set}"
: "${HE_TIME_BUDGET_S:=300}"
: "${HE_TRIAL_ID:=unknown}"
: "${QM_CORE_URL:=http://core:8080}"
: "${QM_SIGNING_SECRET:?QM_SIGNING_SECRET must be set (per-trial random, shared with core)}"
: "${QM_ACTOR_ID:=U1}"
: "${QM_ADMIN_ACTOR:=harness-admin@harness-eval}"

mkdir -p "$HE_LOG_DIR"
exec > >(tee -a "$HE_LOG_DIR/stdout.log") 2> >(tee -a "$HE_LOG_DIR/stderr.log" >&2)
log() { printf '%s qm[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }
# busybox date has no milliseconds; node is in the image.
now() { node -e 'process.stdout.write(new Date().toISOString())'; }

entry=${1:-run}
case "$entry" in
  run|serve) ;;
  *) log "unknown entry point: $entry; 'run' and 'serve' are implemented"; exit 2 ;;
esac

export HOME="$HE_SESSION_STATE_DIR"
log "qm ${QM_VERSION:-unknown} core=$QM_CORE_URL budget=${HE_TIME_BUDGET_S}s entry=$entry"

# Core needs Postgres and its migrations before it answers /healthz.
deadline=$(( $(date +%s) + 120 ))
until curl -fsS "$QM_CORE_URL/healthz" >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "$deadline" ]; then log "core did not become healthy in 120 s"; exit 2; fi
  sleep 2
done
log "core healthy"

if [ "$entry" = "run" ]; then
  [ -r "$HE_WORKSPACE_DIR/instruction.md" ] || { log "no readable $HE_WORKSPACE_DIR/instruction.md"; exit 2; }
  node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ actor: { externalId: process.argv[2] }, conversation: { kind: "dm", threadRef: process.argv[3] }, text_file: process.argv[4] }))' \
    "$HE_LOG_DIR/qm-run-job.json" "$QM_ACTOR_ID" "$HE_TRIAL_ID" "$HE_WORKSPACE_DIR/instruction.md"
  set +e
  timeout -k 60 "$HE_TIME_BUDGET_S" node /opt/harness/qm-api.mjs turn "$QM_CORE_URL" "$QM_SIGNING_SECRET" "$HE_LOG_DIR/qm-run-job.json" "$HE_TIME_BUDGET_S" > "$HE_LOG_DIR/qm-turn.json"
  code=$?
  set -e
  cat "$HE_LOG_DIR/qm-turn.json"
  case "$code" in
    0) log "completed"; exit 0 ;;
    124|137) log "wall clock exceeded (HE_TIME_BUDGET_S=$HE_TIME_BUDGET_S)"; exit 124 ;;
    3) log "model error"; exit 3 ;;
    *) log "harness error (qm-api exit $code)"; exit 2 ;;
  esac
fi

# ---- serve ----------------------------------------------------------------------------------------
: "${HE_TURNS_DIR:=/he-turns}"
[ -n "${HE_WORLD_MCP_URL:-}" ] && [ -n "${HE_WORLD_MCP_TOKEN:-}" ] || { log "serve needs HE_WORLD_MCP_URL and HE_WORLD_MCP_TOKEN"; exit 2; }
mkdir -p "$HE_TURNS_DIR" "$HE_LOG_DIR/turns"

# The world-MCP server is registered through QM's admin API with the bot's bearer token (the
# per-trial token the world minted; in the redaction set). readOnly false exposes the write tools;
# core probes tools/list before saving, so a 2xx here proves the wiring.
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ name: "world", url: process.env.HE_WORLD_MCP_URL, auth: "bearer", bearerToken: process.env.HE_WORLD_MCP_TOKEN, credentialScope: "shared", readOnly: false, enabled: true }))' "$HE_LOG_DIR/qm-mcp-server.json"
if node /opt/harness/qm-api.mjs mcp-register "$QM_CORE_URL" "$QM_SIGNING_SECRET" "$QM_ADMIN_ACTOR" world "$HE_LOG_DIR/qm-mcp-server.json" > "$HE_LOG_DIR/qm-mcp-register.json" 2>>"$HE_LOG_DIR/stderr.log"; then
  log "world-MCP registered with core: $(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(JSON.stringify(r.body).slice(0,300))' "$HE_LOG_DIR/qm-mcp-register.json")"
else
  log "world-MCP registration failed: $(head -c 400 "$HE_LOG_DIR/qm-mcp-register.json")"
  exit 2
fi
rm -f "$HE_LOG_DIR/qm-mcp-server.json"

# One serve turn: the prompt and the job go under HE_LOG_DIR, qm-api.mjs posts the turn and leaves
# {http, body} beside them. Arguments: request path, session key, turn name, budget. Returns the
# mapped exit code; the reply text is in <turn>.reply.txt.
serve_turn() {
  local req=$1 key=$2 name=$3 budget=$4 code
  local prompt="$HE_LOG_DIR/turns/$name.prompt.md" job="$HE_LOG_DIR/turns/$name.job.json" result="$HE_LOG_DIR/turns/$name.qm.json" err="$HE_LOG_DIR/turns/$name.stderr.log"
  node -e '
    const fs = require("fs");
    const [req, key, prompt, job] = process.argv.slice(1);
    const r = JSON.parse(fs.readFileSync(req, "utf8"));
    fs.writeFileSync(prompt, r.prompt);
    const conversation = r.channel.type === "dm"
      ? { kind: "dm", threadRef: key }
      : { kind: "channel", threadRef: key, channelRef: r.channel.id, channelName: r.channel.name };
    fs.writeFileSync(job, JSON.stringify({ actor: { externalId: r.actor.slack_user_id, displayName: r.actor.name }, conversation, text_file: prompt }));
  ' "$req" "$key" "$prompt" "$job"
  set +e
  timeout -k 5 "$((budget + 10))" node /opt/harness/qm-api.mjs turn "$QM_CORE_URL" "$QM_SIGNING_SECRET" "$job" "$budget" > "$result" 2> >(tee -a "$err" >&2)
  code=$?
  set -e
  node -e '
    const fs = require("fs");
    let out = {}; try { out = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
    const body = out.body && typeof out.body === "object" ? out.body : {};
    fs.writeFileSync(process.argv[2], typeof body.reply === "string" ? body.reply.trim() : "");
  ' "$result" "$HE_LOG_DIR/turns/$name.reply.txt"
  case "$code" in
    0|3|124) return "$code" ;;
    137) return 124 ;;
  esac
  return 2
}

write_response() {
  node -e '
    const fs = require("fs");
    const [resp, turn, code, replyFile, started, ended, detail] = process.argv.slice(1);
    const exit = Number(code);
    const out = { turn: Number(turn), exit, reply_text: exit === 0 ? fs.readFileSync(replyFile, "utf8") : null, started_at: started, ended_at: ended };
    if (detail) out.detail = detail;
    fs.writeFileSync(resp + ".tmp", JSON.stringify(out));
    fs.renameSync(resp + ".tmp", resp);
  ' "$@"
}

stopping=0
trap 'stopping=1' TERM INT
printf '{"harness":"qm","version":"%s","trial":"%s","ready_at":"%s","session_keys":"conversation.threadRef dm:<member> (scope personal:<slack user id>) | channel:<id> (scope channel:<id>)"}\n' "${QM_VERSION:-}" "$HE_TRIAL_ID" "$(now)" > "$HE_LOG_DIR/ready.tmp"
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
      log "turn $turn: SIGTERM during the turn; abandoning the request to core"
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
