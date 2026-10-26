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
#          decide what carries across conversations. HE_SESSION_SCOPE=turn
#          (the memoryless contrast cell, docs/adapters.md) keys every turn as
#          agent:main:turn:<NNNN> instead, so nothing carries between turns
#          except what OpenClaw's own memory files hold.
set -euo pipefail

: "${HE_WORKSPACE_DIR:=/workspace}"
: "${HE_SESSION_STATE_DIR:=/harness-state}"
: "${HE_LOG_DIR:?HE_LOG_DIR must be set}"
: "${HE_MODEL_BASE_URL:?HE_MODEL_BASE_URL must be set}"
: "${HE_MODEL_API_KEY:?HE_MODEL_API_KEY must be set}"
: "${HE_MODEL_NAME:=claude-sonnet-5-5}"
: "${HE_TIME_BUDGET_S:=300}"
: "${HE_TRIAL_ID:=unknown}"
: "${HE_SESSION_SCOPE:=conversation}"
case "$HE_SESSION_SCOPE" in
  conversation|turn) ;;
  *) echo "openclaw adapter: HE_SESSION_SCOPE must be conversation or turn (got $HE_SESSION_SCOPE)" >&2; exit 2 ;;
esac

mkdir -p "$HE_LOG_DIR"
exec > >(tee -a "$HE_LOG_DIR/stdout.log") 2> >(tee -a "$HE_LOG_DIR/stderr.log" >&2)
log() { printf '%s openclaw[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }
now() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }
# internal-task: the sha256 of this adapter file goes into the ready file, so a trial record can prove which adapter ran (the runner's
# preflight compares the same hash in the image with the checkout, HE-ADAPTER-005).
adapter_sha256=$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)

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

# internal-task, the install ladder (docs/gbrain-arm.md): under HE_GBRAIN_INSTALL=gbrain-docs or gbrain-installer the runner mounts the
# exported view of gbrain's install read-only at HE_GBRAIN_INSTALL_DIR (/he-gbrain-install) and names the split in HE_GBRAIN_SPLIT.
# Before the harness starts, every file the view's manifest lists is checked against its sha256 and copied to where the gbrain
# command would have written it: `gbrain skillpack scaffold --harness openclaw --workspace /workspace` (gbrain-docs; workspace/x to
# /workspace/x, skills/ at this commit) or `gbrain setup openclaw --workspace /workspace --instructions-only` (gbrain-installer, internal-task;
# workspace/AGENTS.md to /workspace/AGENTS.md, the brain-first block OpenClaw loads as a workspace bootstrap file, and at gbrain#7489's
# per-turn-hook head state/gbrain/gbrain-turn-rule/* to $OPENCLAW_STATE_DIR/gbrain/gbrain-turn-rule/*, the hook-only plugin whose
# before_prompt_build handler puts the rule next to every user turn); the manifest's install kind must equal HE_GBRAIN_INSTALL.
# $HE_LOG_DIR/gbrain-install.json records status, install kind, file count, view digest and destinations. Any failure (missing directory
# or manifest, digest mismatch, a view for another harness or split, a destination that already exists) is HE-ADAPTER-006 and exit 2
# before ready. When the view carries the plugin, the adapter then runs the three commands gbrain's installer printed for a host without
# openclaw on PATH (plugins install --link, plugins enable, config set ...hooks.allowConversationAccess true), checks they are the
# documented ones, and keeps `openclaw plugins inspect gbrain-turn-rule --runtime --json` as $HE_LOG_DIR/gbrain-hook.openclaw.json: the
# plugin must be loaded with before_prompt_build among its typed hooks, else HE-ADAPTER-006 and exit 2. Unset, nothing here runs.
gbrain_install_json=''
if [ "${HE_GBRAIN_INSTALL:-}" = gbrain-docs ] || [ "${HE_GBRAIN_INSTALL:-}" = gbrain-installer ]; then
  set +e
  install_line=$(python3 - "${HE_GBRAIN_INSTALL_DIR:-/he-gbrain-install}" "$HE_WORKSPACE_DIR" openclaw "${HE_GBRAIN_SPLIT:-}" "$HE_LOG_DIR/gbrain-install.json" "$HE_GBRAIN_INSTALL" <<'PY'
import hashlib, json, os, shutil, sys
view, workspace, harness, split, out, install = sys.argv[1:7]
def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
rec = {"status": "error", "code": "HE-ADAPTER-006", "harness": harness, "split": split, "install": install, "dir": view, "view_digest": None, "files": 0, "destinations": [], "copied": [], "error": None}
def write():
    with open(out + ".tmp", "w") as f:
        json.dump(rec, f)
    os.replace(out + ".tmp", out)
def refuse(msg):
    rec["error"] = msg
    write()
    print("HE-ADAPTER-006 the install bundle could not be applied: %s (view %s, split %s); fix: re-export the view from the gbrain image (gbrain/export-install.sh) and run preflight again" % (msg, view, split))
    sys.exit(1)
if not split:
    refuse("HE_GBRAIN_SPLIT is unset")
if not os.path.isdir(view):
    refuse("no install view directory at %s" % view)
try:
    m = json.load(open(os.path.join(view, "manifest.json")))
except (OSError, ValueError) as e:
    refuse("no readable manifest.json in the view: %s" % e)
rec["view_digest"] = m.get("view_digest")
if m.get("harness") != harness:
    refuse("the view is for harness %r, this adapter is %s" % (m.get("harness"), harness))
if m.get("split") != split:
    refuse("the view is for split %r, the trial's split is %s" % (m.get("split"), split))
if m.get("install", "gbrain-docs") != install:
    refuse("the view is for install %r, this cell's gbrain.install is %s" % (m.get("install", "gbrain-docs"), install))
files = m.get("files") or []
if not files:
    refuse("the manifest lists no files")
lines = "".join("%s %s\n" % (f.get("source_path"), f.get("sha256")) for f in sorted(files, key=lambda f: f.get("source_path") or ""))
if hashlib.sha256(lines.encode()).hexdigest() != m.get("view_digest"):
    refuse("the manifest's view_digest does not match its file list")
plan = []
for f in files:
    path = f.get("path") or ""
    parts = path.split("/")
    if not path or path.startswith("/") or ".." in parts or "" in parts:
        refuse("unsafe path in the manifest: %r" % path)
    if parts[0] == "workspace" and len(parts) > 1:
        dest = os.path.join(workspace, *parts[1:])
        top = os.path.join(workspace, parts[1])
    elif path.startswith("state/gbrain/gbrain-turn-rule/") and len(parts) == 4 and install == "gbrain-installer":
        # gbrain#7489 at 10949a15: the per-turn plugin setup wrote under OPENCLAW_STATE_DIR; the same place here.
        dest = os.path.join(os.environ["OPENCLAW_STATE_DIR"], "gbrain", "gbrain-turn-rule", parts[3])
        top = os.path.join(os.environ["OPENCLAW_STATE_DIR"], "gbrain")
        rec["turn_hook_files"] = rec.get("turn_hook_files", 0) + 1
    else:
        refuse("no documented destination for %r" % path)
    src = os.path.join(view, path)
    if not os.path.isfile(src):
        refuse("a listed file is missing from the view: %s" % path)
    if sha(src) != f.get("sha256"):
        refuse("digest mismatch for %s" % path)
    if os.path.lexists(dest):
        refuse("the destination exists and the documented command refuses to overwrite it: %s" % dest)
    plan.append((src, dest, top, f["sha256"]))
for src, dest, top, digest in plan:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copyfile(src, dest)
    if sha(dest) != digest:
        refuse("the copy at %s does not match the view" % dest)
    rec["copied"].append(dest)
    if top not in rec["destinations"]:
        rec["destinations"].append(top)
hook = (m.get("installer") or {}).get("turn_hook") or None
if rec.get("turn_hook_files", 0) and not hook:
    refuse("the view carries %d per-turn plugin files but the manifest's installer records no turn_hook; nothing documents what to do with them" % rec["turn_hook_files"])
if hook and rec.get("turn_hook_files", 0) != len(hook.get("files") or []):
    refuse("the manifest's turn_hook lists %d files, the view copied %d" % (len(hook.get("files") or []), rec.get("turn_hook_files", 0)))
if hook:
    # The commands gbrain printed at build name the bundle's own plugin directory; the documented three, with the local directory, are run below.
    plugin_dir = os.path.join(os.environ["OPENCLAW_STATE_DIR"], "gbrain", "gbrain-turn-rule")
    expected = ["openclaw plugins install --link <dir> --force --accept-capabilities", "openclaw plugins enable gbrain-turn-rule", "openclaw config set plugins.entries.gbrain-turn-rule.hooks.allowConversationAccess true"]
    printed = [c.replace("<out>/openclaw/installer/state/gbrain/gbrain-turn-rule", "<dir>") for c in (hook.get("commands") or [])]
    if printed != expected:
        refuse("the installer's turn_hook.commands are not the documented three: %r" % printed)
    rec["turn_hook"] = {"plugin_dir": plugin_dir, "commands": [c.replace("<dir>", plugin_dir) for c in expected]}
rec.update(status="ok", code=None, files=len(plan), destinations=sorted(rec["destinations"]))
write()
print("ok %d %s %s %s" % (len(plan), rec["view_digest"], ",".join(rec["destinations"]), "hook" if hook else "nohook"))
PY
)
  install_code=$?
  set -e
  log "$HE_GBRAIN_INSTALL install: ${install_line:-HE-ADAPTER-006 the install bundle could not be applied: the install step failed before it could report; see stderr.log}"
  [ "$install_code" -eq 0 ] || exit 2
  read -r _ install_files install_digest install_dests install_hook <<< "$install_line"
  turn_hook_json=''
  if [ "$install_hook" = hook ] && [ "$entry" = run ]; then
    # The run entry execs with --state-dir $OPENCLAW_STATE_DIR/exec, which never sees a plugin installed under $OPENCLAW_STATE_DIR; the hook rung runs through serve only.
    log "HE-ADAPTER-006 the per-turn hook is applied for the serve entry only; the run entry's state dir would not see it"
    exit 2
  fi
  if [ "$install_hook" = hook ]; then
    # gbrain#7489 at 10949a15: install the per-turn plugin the way gbrain's installer told a host without openclaw on PATH to.
    set +e
    hook_err="$HE_LOG_DIR/gbrain-hook.openclaw.log"
    plugin_dir="$OPENCLAW_STATE_DIR/gbrain/gbrain-turn-rule"
    { openclaw plugins install --link "$plugin_dir" --force --accept-capabilities && openclaw plugins enable gbrain-turn-rule && openclaw config set plugins.entries.gbrain-turn-rule.hooks.allowConversationAccess true; } > "$hook_err" 2>&1
    hook_code=$?
    openclaw plugins inspect gbrain-turn-rule --runtime --json > "$HE_LOG_DIR/gbrain-hook.openclaw.json" 2>> "$hook_err"
    inspect_code=$?
    hook_line=$(python3 - "$HE_LOG_DIR/gbrain-hook.openclaw.json" "$HE_LOG_DIR/gbrain-install.json" "$hook_code" "$inspect_code" <<'PY'
import json, os, sys
inspect_path, rec_path, hook_code, inspect_code = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
rec = json.load(open(rec_path))
def done(status, detail):
    rec["turn_hook"].update(status=status, detail=detail)
    if status != "ok":
        rec.update(status="error", code="HE-ADAPTER-006", error="the per-turn plugin is not loaded: " + detail)
    json.dump(rec, open(rec_path + ".tmp", "w"))
    os.replace(rec_path + ".tmp", rec_path)
    print(("ok " if status == "ok" else "HE-ADAPTER-006 the per-turn plugin is not loaded: ") + detail)
    sys.exit(0 if status == "ok" else 1)
if hook_code != 0:
    done("error", "an openclaw plugins/config command exited %d (gbrain-hook.openclaw.log)" % hook_code)
if inspect_code != 0:
    done("error", "openclaw plugins inspect gbrain-turn-rule --runtime exited %d" % inspect_code)
try:
    doc = json.load(open(inspect_path))
except ValueError as e:
    done("error", "plugins inspect printed no JSON: %s" % e)
plugin = doc.get("plugin") or {}
hooks = [h.get("name") for h in (doc.get("typedHooks") or [])]
if plugin.get("status") != "loaded" or not plugin.get("enabled") or "before_prompt_build" not in hooks:
    done("error", "status %r enabled %r typed hooks %r" % (plugin.get("status"), plugin.get("enabled"), hooks))
done("ok", "gbrain-turn-rule loaded (status %s, shape %s, hooks %s, source %s)" % (plugin.get("status"), doc.get("shape"), ",".join(hooks), plugin.get("source")))
PY
)
    hook_ok=$?
    set -e
    log "gbrain-installer turn hook: $hook_line"
    [ "$hook_ok" -eq 0 ] || exit 2
    turn_hook_json=',"turn_hook":"loaded"'
  fi
  gbrain_install_json=$(printf ',"gbrain_install":{"status":"ok","install":"%s","files":%s,"view_digest":"%s","destinations":"%s"%s}' "$HE_GBRAIN_INSTALL" "$install_files" "$install_digest" "$install_dests" "$turn_hook_json")
fi

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
if [ "$HE_SESSION_SCOPE" = turn ]; then session_keys='agent:main:turn:<NNNN>'; else session_keys='agent:main:dm:<member> | agent:main:channel:<id>'; fi
printf '{"harness":"openclaw","version":"%s","trial":"%s","ready_at":"%s","session_scope":"%s","session_keys":"%s","adapter_sha256":"%s"%s}\n' "${OPENCLAW_VERSION:-}" "$HE_TRIAL_ID" "$(now)" "$HE_SESSION_SCOPE" "$session_keys" "$adapter_sha256" "$gbrain_install_json" > "$HE_LOG_DIR/ready.tmp"
mv "$HE_LOG_DIR/ready.tmp" "$HE_LOG_DIR/ready"
log "serve: ready; polling $HE_TURNS_DIR"
while [ "$stopping" -eq 0 ]; do
  for req in "$HE_TURNS_DIR"/turn-*.request.json; do
    [ -e "$req" ] || continue
    base=${req%.request.json}; name=$(basename "$base"); resp="$base.response.json"
    [ -e "$resp" ] && continue
    read -r turn budget key < <(node -e '
      const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const base = process.env.HE_SESSION_SCOPE === "turn" ? "turn:" + String(r.turn).padStart(4, "0") : r.channel.type === "dm" ? "dm:" + r.actor.member : "channel:" + r.channel.id;
      // A thread turn (thread_ts set; thread = "new" in task.toml) is a new session in the same conversation.
      const key = r.thread_ts && process.env.HE_SESSION_SCOPE !== "turn" ? base + ":t" + r.thread_ts : base;
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
