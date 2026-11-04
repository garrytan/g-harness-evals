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
#          scoping (personal:<actor> for a DM, channel:<id> for a channel). A
#          TurnRequest with thread_ts set (a task turn with thread = "new",
#          docs/tasks.md) appends :t<thread_ts> to the threadRef, so the turn
#          opens a new QM session in the same scope, as a new Slack thread does.
#          HE_HARNESS_CONFIG (via prepare.sh, QM_PROBE_CONFIG and the memory
#          capture quiet time) picks the probe settings; QM has one agent loop
#          (Pi) at the pin, so QM_HARNESS only labels it. The probe configs pi-strict and
#          pi-command-deny also PUT an org setting before the first turn
#          (harnesses/qm/README.md, internal-task). Before every turn the notebooks
#          of every scope that holds memory are read through the admin API and
#          saved under $HE_LOG_DIR/turns, so a report can say what QM had
#          stored when a turn began.
set -euo pipefail

: "${HE_WORKSPACE_DIR:=/workspace}"
: "${HE_SESSION_STATE_DIR:=/harness-state}"
: "${HE_LOG_DIR:?HE_LOG_DIR must be set}"
: "${HE_TIME_BUDGET_S:=300}"
: "${HE_TRIAL_ID:=unknown}"
# HE_SESSION_SCOPE=turn (the per-turn session cell, docs/adapters.md) is only implemented by the OpenClaw adapter;
# refusing it here keeps a cell that asks for it from silently running per-conversation sessions.
if [ "${HE_SESSION_SCOPE:-conversation}" != conversation ]; then echo "qm adapter: HE_SESSION_SCOPE=${HE_SESSION_SCOPE} is not supported (only the openclaw adapter keys sessions per turn)" >&2; exit 2; fi
: "${QM_CORE_URL:=http://core:8080}"
: "${QM_SIGNING_SECRET:?QM_SIGNING_SECRET must be set (per-trial random, shared with core)}"
: "${QM_ACTOR_ID:=U1}"
: "${QM_ADMIN_ACTOR:=harness-admin@harness-eval}"
: "${QM_HARNESS:=pi}"
: "${QM_PROBE_CONFIG:=}"
: "${HE_HARNESS_CONFIG:=pi}"
: "${QM_ORG_SCOPE:=org:harness-eval}"

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
log "qm ${QM_VERSION:-unknown} core=$QM_CORE_URL budget=${HE_TIME_BUDGET_S}s entry=$entry inner_harness=$QM_HARNESS config=$HE_HARNESS_CONFIG${QM_PROBE_CONFIG:+ probe=$QM_PROBE_CONFIG}"

# Core needs Postgres and its migrations before it answers /healthz.
deadline=$(( $(date +%s) + 120 ))
until curl -fsS "$QM_CORE_URL/healthz" >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "$deadline" ]; then log "core did not become healthy in 120 s"; exit 2; fi
  sleep 2
done
log "core healthy"

# internal-task: a Particle cell (HE_MODEL_BASE_URL ending in /particle) runs Pi on a custom provider, QM's own route for an
# OpenAI-compatible endpoint (src/model/custom-providers.ts at the pin): PUT /v1/admin/custom-providers/particle as the trial's
# admin, protocol openai (pi-ai's openai-completions, Chat Completions at <base>/v1), the cell model with reasoning on and an
# output cap of 128000, and the per-trial token as its key (validate false: no key check against the proxy). core's PI_MODEL is
# custom/particle/<model> (prepare.sh), which resolves once the provider exists, and core holds no Anthropic credential, so the
# auxiliary model is the cell model (auxiliaryModelFor finds no auxiliary model for provider particle). The request body holds
# the token, so it is written mode 0600 outside HE_LOG_DIR (the logs go into the results) and removed once the PUT returns.
case "${HE_MODEL_BASE_URL%/}" in
  */particle)
    provider_req=$(umask 077 && mktemp)
    node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ name: "Particle through the metering proxy", protocol: "openai", baseUrl: process.env.HE_MODEL_BASE_URL.replace(/\/+$/, "") + "/v1", models: [{ id: process.env.HE_MODEL_NAME, name: process.env.HE_MODEL_NAME, reasoning: true, contextWindow: 1048576, maxTokens: 128000 }], apiKey: process.env.HE_MODEL_API_KEY, validate: false }))' "$provider_req"
    if node /opt/harness/qm-api.mjs admin-put "$QM_CORE_URL" "$QM_SIGNING_SECRET" "$QM_ADMIN_ACTOR" /v1/admin/custom-providers/particle "$provider_req" > "$HE_LOG_DIR/qm-custom-provider-register.json" 2>>"$HE_LOG_DIR/stderr.log"; then
      rm -f "$provider_req"
      log "custom provider particle registered for custom/particle/${HE_MODEL_NAME:-}"
    else
      rm -f "$provider_req"
      log "custom provider registration failed: $(head -c 400 "$HE_LOG_DIR/qm-custom-provider-register.json")"
      exit 2
    fi
    ;;
esac

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

# The gbrain arm (docs/gbrain-arm.md): with HE_GBRAIN_MCP_URL and HE_GBRAIN_MCP_TOKEN set, a second server named
# gbrain is registered the same way (PUT /v1/admin/mcp-servers/gbrain; the URL is the world's /gbrain tap and the
# token the bot token). Core probes tools/list before saving, so a 2xx proves the harness discovered gbrain.
# internal-task: under pi-memory-provider gbrain reaches QM only through core's MEMORY_PROVIDER_CONFIG; a gbrain MCP server here would
# hand the model gbrain tools the cell is defined without, so the runner sets none and the adapter refuses one.
if [ "$HE_HARNESS_CONFIG" = pi-memory-provider ] && [ -n "${HE_GBRAIN_MCP_URL:-}" ]; then
  log "config pi-memory-provider registers no gbrain MCP server, but HE_GBRAIN_MCP_URL is set"; exit 2
fi
if [ -n "${HE_GBRAIN_MCP_URL:-}" ] && [ -n "${HE_GBRAIN_MCP_TOKEN:-}" ]; then
  node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ name: "gbrain", url: process.env.HE_GBRAIN_MCP_URL, auth: "bearer", bearerToken: process.env.HE_GBRAIN_MCP_TOKEN, credentialScope: "shared", readOnly: false, enabled: true }))' "$HE_LOG_DIR/qm-gbrain-server.json"
  if node /opt/harness/qm-api.mjs mcp-register "$QM_CORE_URL" "$QM_SIGNING_SECRET" "$QM_ADMIN_ACTOR" gbrain "$HE_LOG_DIR/qm-gbrain-server.json" > "$HE_LOG_DIR/qm-gbrain-register.json" 2>>"$HE_LOG_DIR/stderr.log"; then
    log "gbrain MCP registered with core: $(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(JSON.stringify(r.body).slice(0,300))' "$HE_LOG_DIR/qm-gbrain-register.json")"
  else
    log "gbrain MCP registration failed: $(head -c 400 "$HE_LOG_DIR/qm-gbrain-register.json")"
    exit 2
  fi
  rm -f "$HE_LOG_DIR/qm-gbrain-server.json"
fi

# The directory (docs/qm-findings.md F5): QM lets only a current channel member use or create that channel's
# sandbox, and reads channel membership from a directory store that only its Slack worker or POST /v1/directory
# fills. Core runs here without the worker, so the bot's channels and their rosters are read from the world's
# Slack API (the reads land in the trial's event log before turn 1) and pushed once before the first turn; the
# body and the 2xx are saved as qm-directory.body.json and qm-directory.json. A refusal is a harness error.
[ -n "${HE_SLACK_API_URL:-}" ] && [ -n "${HE_SLACK_BOT_TOKEN:-}" ] || { log "serve needs HE_SLACK_API_URL and HE_SLACK_BOT_TOKEN for the directory push"; exit 2; }
if node /opt/harness/qm-directory.mjs "$HE_SLACK_API_URL" "$HE_SLACK_BOT_TOKEN" > "$HE_LOG_DIR/qm-directory.body.json" 2>>"$HE_LOG_DIR/stderr.log" \
   && node /opt/harness/qm-api.mjs post "$QM_CORE_URL" "$QM_SIGNING_SECRET" "/v1/directory" "$HE_LOG_DIR/qm-directory.body.json" > "$HE_LOG_DIR/qm-directory.json" 2>>"$HE_LOG_DIR/stderr.log"; then
  log "directory pushed: $(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const r=JSON.parse(require("fs").readFileSync(process.argv[2],"utf8")); process.stdout.write(b.channels.length+" channels, "+b.channelMembers.length+" memberships; core "+JSON.stringify(r.body).slice(0,200))' "$HE_LOG_DIR/qm-directory.body.json" "$HE_LOG_DIR/qm-directory.json")"
else
  log "directory push failed: $(head -c 400 "$HE_LOG_DIR/qm-directory.json" 2>/dev/null)"
  exit 2
fi

# The probe configs (pin.json configs, docs/tasks.md "QM probes"): an org setting PUT through QM's admin
# scope-config route as harness-admin before the first turn. The 2xx response saved beside
# qm-mcp-register.json is the proof the setting took; a refusal is a harness error, never a silent default.
admin_put() {
  local resource=$1 body=$2 out
  out="$HE_LOG_DIR/qm-admin-$resource.json"
  printf '%s' "$body" > "$HE_LOG_DIR/qm-admin-$resource.body.json"
  if node /opt/harness/qm-api.mjs admin-put "$QM_CORE_URL" "$QM_SIGNING_SECRET" "$QM_ADMIN_ACTOR" "/v1/admin/scopes/$QM_ORG_SCOPE/$resource" "$HE_LOG_DIR/qm-admin-$resource.body.json" > "$out" 2>>"$HE_LOG_DIR/stderr.log"; then
    log "org $resource set ($QM_PROBE_CONFIG): $(head -c 300 "$out")"
  else
    log "org $resource refused ($QM_PROBE_CONFIG): $(head -c 400 "$out")"
    exit 2
  fi
}
case "$QM_PROBE_CONFIG" in
  "") ;;
  pi-strict)
    # strict routes every tool call through QM's approval gate (src/security/security-posture.ts at the pin).
    admin_put security-posture '{"posture":"strict"}' ;;
  pi-command-deny)
    # The deny rule first (first match wins), then the org floor QM ships, which a stored policy otherwise replaces
    # (src/policy/command-policy.ts ORG_FLOOR_RULES at the pin). uname is network-free, so the control cell's
    # outcome does not depend on sandbox egress.
    admin_put command-policy '{"mode":"denylist","rules":[{"pattern":"\\buname\\b","decision":"deny","reason":"probe: uname is denied by the org command policy"},{"pattern":"\\brm\\b[^\\n]*(?:-[a-zA-Z]*r|--recursive)","decision":"require_approval","reason":"recursive delete"},{"pattern":"\\bgit\\s+push\\b.*(?:--force\\b|(?:^|\\s)-[a-zA-Z]*f\\b)","decision":"require_approval","reason":"force push"},{"pattern":"\\b(drop|truncate)\\s+table\\b","decision":"require_approval","reason":"destructive SQL"},{"pattern":"\\bmkfs\\b|:\\(\\)\\s*\\{","decision":"deny","reason":"destructive / fork bomb"},{"pattern":"\\bcurl\\b.*\\|\\s*(sh|bash)\\b","decision":"require_approval","reason":"pipe-to-shell"}]}' ;;
  *) log "unknown QM_PROBE_CONFIG=$QM_PROBE_CONFIG"; exit 2 ;;
esac

# What QM's memory held when a turn began: every scope the admin API lists with memory, read before the turn
# request is posted (after the runner's inter-turn wait, so capture has had its quiet time). Saved as
# <turn>.memory.json under HE_LOG_DIR/turns; a failure is logged and never fails the turn.
snapshot_memory() {
  local out=$1 scopes
  if ! scopes=$(node /opt/harness/qm-api.mjs admin-get "$QM_CORE_URL" "$QM_SIGNING_SECRET" "$QM_ADMIN_ACTOR" "/v1/admin/memory/scopes" 2>>"$HE_LOG_DIR/stderr.log"); then
    printf '{"error":"memory scopes unavailable","at":"%s"}\n' "$(now)" > "$out"; return 0
  fi
  node -e '
    const { execFileSync } = require("child_process");
    const [coreUrl, secret, actor, out, scopesJson, at] = process.argv.slice(1);
    const listed = JSON.parse(scopesJson).body?.scopes ?? [];
    const notebooks = {};
    for (const s of listed) {
      if (!s.hasMemory) continue;
      try {
        const r = JSON.parse(execFileSync("node", ["/opt/harness/qm-api.mjs", "admin-get", coreUrl, secret, actor, "/v1/admin/memory?scope=" + encodeURIComponent(s.scopeId)], { encoding: "utf8" }));
        notebooks[s.scopeId] = r.body;
      } catch (e) { notebooks[s.scopeId] = { error: String(e?.message ?? e).slice(0, 300) }; }
    }
    require("fs").writeFileSync(out, JSON.stringify({ at, scopes: listed, notebooks }, null, 1));
  ' "$QM_CORE_URL" "$QM_SIGNING_SECRET" "$QM_ADMIN_ACTOR" "$out" "$scopes" "$(now)" 2>>"$HE_LOG_DIR/stderr.log" || printf '{"error":"memory read failed","at":"%s"}\n' "$(now)" > "$out"
}

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
printf '{"harness":"qm","version":"%s","trial":"%s","ready_at":"%s","inner_harness":"%s","config":"%s","session_keys":"conversation.threadRef dm:<member> (scope personal:<slack user id>) | channel:<id> (scope channel:<id>); :t<thread_ts> appended on a thread turn"}\n' "${QM_VERSION:-}" "$HE_TRIAL_ID" "$(now)" "$QM_HARNESS" "$HE_HARNESS_CONFIG" > "$HE_LOG_DIR/ready.tmp"
mv "$HE_LOG_DIR/ready.tmp" "$HE_LOG_DIR/ready"
log "serve: ready; polling $HE_TURNS_DIR"
while [ "$stopping" -eq 0 ]; do
  for req in "$HE_TURNS_DIR"/turn-*.request.json; do
    [ -e "$req" ] || continue
    base=${req%.request.json}; name=$(basename "$base"); resp="$base.response.json"
    [ -e "$resp" ] && continue
    read -r turn budget key < <(node -e '
      const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const base = r.channel.type === "dm" ? "dm:" + r.actor.member : "channel:" + r.channel.id;
      const key = r.thread_ts ? base + ":t" + r.thread_ts : base;
      process.stdout.write([r.turn, r.time_budget_s || process.env.HE_TIME_BUDGET_S, key].join(" ") + "\n");
    ' "$req")
    log "turn $turn: session $key, budget ${budget}s"
    snapshot_memory "$HE_LOG_DIR/turns/$name.memory.json"
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
