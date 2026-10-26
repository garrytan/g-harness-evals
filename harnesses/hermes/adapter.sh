#!/usr/bin/env bash
# Hermes Agent adapter. Protocol: docs/adapters.md. Exit 0 completed, 2
# harness error, 3 model error, 124 wall clock.
#
#   run    one headless turn with `hermes chat --query-file` on /workspace/instruction.md
#   serve  the multi-user entry: the world-MCP server is appended to the
#          config copy under mcp_servers.world, then every TurnRequest in
#          HE_TURNS_DIR becomes one `hermes chat -c <key> --create-if-missing`
#          turn in the named session dm:<member> or channel:<id>, all in the
#          same HERMES_HOME, so Hermes's own session store and memory decide
#          what carries across conversations.
set -euo pipefail

: "${HE_WORKSPACE_DIR:=/workspace}"
: "${HE_SESSION_STATE_DIR:=/harness-state}"
: "${HE_LOG_DIR:?HE_LOG_DIR must be set}"
: "${HE_MODEL_BASE_URL:?HE_MODEL_BASE_URL must be set}"
: "${HE_MODEL_API_KEY:?HE_MODEL_API_KEY must be set}"
: "${HE_MODEL_NAME:=claude-sonnet-5-5}"
: "${HE_TIME_BUDGET_S:=300}"
: "${HE_TRIAL_ID:=unknown}"
# HE_SESSION_SCOPE=turn (the per-turn session cell, docs/adapters.md) is only implemented by the OpenClaw adapter;
# refusing it here keeps a cell that asks for it from silently running per-conversation sessions.
if [ "${HE_SESSION_SCOPE:-conversation}" != conversation ]; then echo "hermes adapter: HE_SESSION_SCOPE=${HE_SESSION_SCOPE} is not supported (only the openclaw adapter keys sessions per turn)" >&2; exit 2; fi

mkdir -p "$HE_LOG_DIR"
exec > >(tee -a "$HE_LOG_DIR/stdout.log") 2> >(tee -a "$HE_LOG_DIR/stderr.log" >&2)
log() { printf '%s hermes[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }
now() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }
# internal-task: the sha256 of this adapter file goes into the ready file, so a trial record can prove which adapter ran (the runner's
# preflight compares the same hash in the image with the checkout, HE-ADAPTER-005).
adapter_sha256=$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)

entry=${1:-run}
case "$entry" in
  run|serve) ;;
  *) log "unknown entry point: $entry; 'run' and 'serve' are implemented"; exit 2 ;;
esac

# HERMES_HOME holds config, memories, skills, sessions and logs: all state.
export HOME="$HE_SESSION_STATE_DIR"
export HERMES_HOME="$HE_SESSION_STATE_DIR/hermes"
mkdir -p "$HERMES_HOME"
[ -e "$HERMES_HOME/config.yaml" ] || cp /opt/harness/config/config.yaml "$HERMES_HOME/config.yaml"

# The anthropic provider reads these two variables; nothing is written to .env.
export ANTHROPIC_API_KEY="$HE_MODEL_API_KEY"
export ANTHROPIC_BASE_URL="$HE_MODEL_BASE_URL"

# Read all of --version (several lines): a `| head -1` could close the pipe before Hermes had seeded SOUL.md into HERMES_HOME, the
# "ran Hermes once" the installer rung needs (SIGPIPE; the seed was then missing from a trial now and then).
hermes_version=$(hermes --version 2>/dev/null || true)
log "hermes ${hermes_version%%$'\n'*} model=anthropic/$HE_MODEL_NAME budget=${HE_TIME_BUDGET_S}s entry=$entry"

# A model error is a proxy refusal, an Anthropic SDK error class or an HTTP status on stderr or in
# the result record; everything else that fails is Hermes's.
model_error_pattern='metering proxy|AuthenticationError|PermissionDeniedError|RateLimitError|APIStatusError|APIConnectionError|InternalServerError|Error code: (401|402|403|404|429|5[0-9]{2})|HTTP (401|402|403|404|429|5[0-9]{2})'

cd "$HE_WORKSPACE_DIR"

# internal-task, the install ladder (docs/gbrain-arm.md): under HE_GBRAIN_INSTALL=gbrain-docs or gbrain-installer the runner mounts the
# exported view of gbrain's install read-only at HE_GBRAIN_INSTALL_DIR (/he-gbrain-install) and names the split in HE_GBRAIN_SPLIT.
# Before the harness starts, every file the view's manifest lists is checked against its sha256 and copied to where the gbrain
# command would have written it. gbrain-docs: workspace/x to /workspace/x (`gbrain skillpack scaffold --all`, skills/ at this
# commit) and the split's compiled context to /workspace/.hermes.md (`gbrain compile-context --target hermes --include-core`,
# the file Hermes's prompt builder reads from the cwd). gbrain-installer (internal-task): home/SOUL.md to $HERMES_HOME/SOUL.md, Hermes's
# own SOUL.md at the pinned Hermes commit with the brain-first block `gbrain setup hermes --instructions-only` appended. Hermes seeds that
# default SOUL.md into HERMES_HOME when `hermes --version` runs above, the "ran Hermes once" the installer needs, so the copy replaces a
# SOUL.md whose sha256 equals the seed the bundle records and refuses any other content. At gbrain#7489's per-turn-hook head the
# bundle also carries home/config.yaml (the marked hooks.pre_llm_call block whose command echoes the rule as {"context": ...}) and
# home/shell-hooks-allowlist.json (Hermes's own approval of that exact command): the marked block is appended to the config.yaml
# this adapter wrote (refused when it already has a hooks: section, which is what gbrain itself does) and the allowlist is copied
# (refused when one exists), then `hermes hooks doctor` is kept as $HE_LOG_DIR/gbrain-hook.hermes.log and must report the hook
# healthy, else HE-ADAPTER-006 and exit 2. HERMES_ACCEPT_HOOKS is never set: the approval is the installer's own file. The
# manifest's install kind must equal HE_GBRAIN_INSTALL. $HE_LOG_DIR/gbrain-install.json records status, install kind, file count,
# view digest and destinations. Any failure (missing directory or manifest, digest mismatch, a view for another harness, split or
# install kind, a destination that already exists) is HE-ADAPTER-006 and exit 2 before ready. Unset, nothing here runs.
gbrain_install_json=''
if [ "${HE_GBRAIN_INSTALL:-}" = gbrain-docs ] || [ "${HE_GBRAIN_INSTALL:-}" = gbrain-installer ]; then
  set +e
  install_line=$(python3 - "${HE_GBRAIN_INSTALL_DIR:-/he-gbrain-install}" "$HE_WORKSPACE_DIR" hermes "${HE_GBRAIN_SPLIT:-}" "$HE_LOG_DIR/gbrain-install.json" "$HE_GBRAIN_INSTALL" <<'PY'
import hashlib, json, os, shutil, sys
view, workspace, harness, split, out, install = sys.argv[1:7]
def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
rec = {"status": "error", "code": "HE-ADAPTER-006", "harness": harness, "split": split, "install": install, "dir": view, "view_digest": None, "files": 0, "destinations": [], "copied": [], "replaced_seed": None, "error": None}
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
    replace = False
    if not path or path.startswith("/") or ".." in parts or "" in parts:
        refuse("unsafe path in the manifest: %r" % path)
    if parts[0] == "workspace" and len(parts) > 1:
        dest = os.path.join(workspace, *parts[1:])
        top = os.path.join(workspace, parts[1])
    elif path == ".hermes.md" and install == "gbrain-docs":
        dest = top = os.path.join(workspace, ".hermes.md")
    elif path == "home/SOUL.md" and install == "gbrain-installer":
        # Hermes seeded its default SOUL.md into HERMES_HOME when the adapter ran it above (the "ran Hermes once" the installer
        # needs); gbrain setup hermes appends its block to that file, and the bundle's home/SOUL.md is that result, so the seed
        # the bundle was built from must be what is here now. Anything else is not the installer's result and is refused.
        dest = top = os.path.join(os.environ["HERMES_HOME"], "SOUL.md")
        seed = ((m.get("installer") or {}).get("seed") or {}).get("sha256")
        if os.path.isfile(dest) and seed and sha(dest) == seed:
            replace = True
    elif path == "home/config.yaml" and install == "gbrain-installer":
        # gbrain#7489 at 10949a15: the bundle's config.yaml is what gbrain wrote into an empty home, the marked hooks block alone;
        # it is merged into the config.yaml this adapter wrote, the way gbrain would append it to an existing file without hooks.
        dest = top = os.path.join(os.environ["HERMES_HOME"], "config.yaml")
        replace = "merge"
    elif path == "home/shell-hooks-allowlist.json" and install == "gbrain-installer":
        dest = top = os.path.join(os.environ["HERMES_HOME"], "shell-hooks-allowlist.json")
    else:
        refuse("no documented destination for %r" % path)
    src = os.path.join(view, path)
    if not os.path.isfile(src):
        refuse("a listed file is missing from the view: %s" % path)
    if sha(src) != f.get("sha256"):
        refuse("digest mismatch for %s" % path)
    if os.path.lexists(dest) and not replace:
        refuse("the destination exists and the documented command refuses to overwrite it: %s" % dest)
    plan.append((src, dest, top, f["sha256"], replace))
for src, dest, top, digest, replace in plan:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if replace == "merge":
        text = open(src).read()
        begin, end = text.find("# gbrain:turn-rule:begin"), text.find("# gbrain:turn-rule:end")
        if begin < 0 or end < begin:
            refuse("the bundle's home/config.yaml carries no gbrain:turn-rule block")
        block = text[begin:end + len("# gbrain:turn-rule:end")] + "\n"
        if text.replace(block, "").strip():
            refuse("the bundle's home/config.yaml holds more than the gbrain:turn-rule block; nothing else of it is documented for this config")
        current = open(dest).read() if os.path.isfile(dest) else ""
        if "\nhooks:" in "\n" + current:
            refuse("%s already has a hooks: section, which gbrain's installer does not edit" % dest)
        with open(dest, "a") as f:
            f.write(("" if current.endswith("\n") or not current else "\n") + "\n" + block)
        rec["merged_hooks"] = {"path": dest, "block_sha256": hashlib.sha256(block.encode()).hexdigest(), "bytes": len(block)}
        rec["copied"].append(dest)
        if top not in rec["destinations"]:
            rec["destinations"].append(top)
        continue
    if replace:
        rec["replaced_seed"] = {"path": dest, "sha256": sha(dest)}
        os.unlink(dest)
    shutil.copyfile(src, dest)
    if sha(dest) != digest:
        refuse("the copy at %s does not match the view" % dest)
    rec["copied"].append(dest)
    if top not in rec["destinations"]:
        rec["destinations"].append(top)
hook = (m.get("installer") or {}).get("turn_hook") or None
if rec.get("merged_hooks") and not hook:
    refuse("the view carries a hooks block but the manifest's installer records no turn_hook; nothing documents what to do with it")
if hook and not rec.get("merged_hooks"):
    refuse("the manifest's turn_hook names %r but no hooks block was merged" % (hook.get("files"),))
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
  if [ "$install_hook" = hook ]; then
    # gbrain#7489 at 10949a15: Hermes's own account of the hook gbrain's installer wrote, before any turn.
    set +e
    hermes hooks doctor > "$HE_LOG_DIR/gbrain-hook.hermes.log" 2>&1
    doctor_code=$?
    set -e
    doctor_line=$(python3 - "$HE_LOG_DIR/gbrain-hook.hermes.log" "$HE_LOG_DIR/gbrain-install.json" "$doctor_code" <<'PY'
import json, os, sys
log_path, rec_path, code = sys.argv[1], sys.argv[2], int(sys.argv[3])
text = open(log_path).read()
ok = code == 0 and "[pre_llm_call]" in text and "All shell hooks look healthy" in text and "/bin/echo" in text
rec = json.load(open(rec_path))
rec["turn_hook"] = {"status": "ok" if ok else "error", "doctor_exit": code, "detail": "hermes hooks doctor: pre_llm_call hook healthy" if ok else "hermes hooks doctor exit %d: %s" % (code, " | ".join(l.strip() for l in text.splitlines() if l.strip())[:400])}
if not ok:
    rec.update(status="error", code="HE-ADAPTER-006", error="the per-turn hook is not healthy: " + rec["turn_hook"]["detail"])
json.dump(rec, open(rec_path + ".tmp", "w")); os.replace(rec_path + ".tmp", rec_path)
print(("ok " if ok else "HE-ADAPTER-006 the per-turn hook is not healthy: ") + rec["turn_hook"]["detail"])
sys.exit(0 if ok else 1)
PY
) || { log "gbrain-installer turn hook: $doctor_line"; exit 2; }
    log "gbrain-installer turn hook: $doctor_line"
    turn_hook_json=',"turn_hook":"healthy"'
  fi
  gbrain_install_json=$(printf ',"gbrain_install":{"status":"ok","install":"%s","files":%s,"view_digest":"%s","destinations":"%s"%s}' "$HE_GBRAIN_INSTALL" "$install_files" "$install_digest" "$install_dests" "$turn_hook_json")
fi

if [ "$entry" = "run" ]; then
  [ -r "$HE_WORKSPACE_DIR/instruction.md" ] || { log "no readable $HE_WORKSPACE_DIR/instruction.md"; exit 2; }
  set +e
  timeout -k 60 "$HE_TIME_BUDGET_S" hermes chat \
    --query-file "$HE_WORKSPACE_DIR/instruction.md" \
    --oneshot \
    --provider anthropic \
    --model "$HE_MODEL_NAME"
  code=$?
  set -e
  case "$code" in
    0) log "completed"; exit 0 ;;
    124|137) log "wall clock exceeded (HE_TIME_BUDGET_S=$HE_TIME_BUDGET_S)"; exit 124 ;;
  esac
  if grep -Eqi "$model_error_pattern" "$HE_LOG_DIR/stdout.log" "$HE_LOG_DIR/stderr.log"; then
    log "model error (hermes exit $code)"; exit 3
  fi
  log "harness error (hermes exit $code)"; exit 2
fi

# ---- serve ----------------------------------------------------------------------------------------
: "${HE_TURNS_DIR:=/he-turns}"
[ -n "${HE_WORLD_MCP_URL:-}" ] && [ -n "${HE_WORLD_MCP_TOKEN:-}" ] || { log "serve needs HE_WORLD_MCP_URL and HE_WORLD_MCP_TOKEN"; exit 2; }
mkdir -p "$HE_TURNS_DIR" "$HE_LOG_DIR/turns"

# The world-MCP server goes into mcp_servers.world of the config copy (Streamable HTTP with the
# per-trial bot token the world minted; in the redaction set). Hermes connects on the first turn
# and registers the server's tools as mcp__world__<tool>.
if ! grep -q '^mcp_servers:' "$HERMES_HOME/config.yaml"; then
  HE_WORLD_MCP_URL="$HE_WORLD_MCP_URL" HE_WORLD_MCP_TOKEN="$HE_WORLD_MCP_TOKEN" python3 - "$HERMES_HOME/config.yaml" <<'PY'
import json, os, sys
path = sys.argv[1]
block = "\nmcp_servers:\n  world:\n    url: %s\n    headers:\n      Authorization: %s\n    timeout: 120\n    connect_timeout: 60\n" % (
    json.dumps(os.environ["HE_WORLD_MCP_URL"]), json.dumps("Bearer " + os.environ["HE_WORLD_MCP_TOKEN"]))
with open(path, "a") as f:
    f.write(block)
PY
fi
log "world-MCP wired into $HERMES_HOME/config.yaml#mcp_servers.world"

# The gbrain arm (docs/gbrain-arm.md): with HE_GBRAIN_MCP_URL and HE_GBRAIN_MCP_TOKEN set, an mcp_servers.gbrain
# block goes in beside world (same http transport, same Authorization header shape; the URL is the world's
# /gbrain tap and the token the bot token). Unset, the config is byte-identical to a cell without gbrain.
if [ -n "${HE_GBRAIN_MCP_URL:-}" ] && [ -n "${HE_GBRAIN_MCP_TOKEN:-}" ] && ! grep -q '^  gbrain:' "$HERMES_HOME/config.yaml"; then
  HE_GBRAIN_MCP_URL="$HE_GBRAIN_MCP_URL" HE_GBRAIN_MCP_TOKEN="$HE_GBRAIN_MCP_TOKEN" python3 - "$HERMES_HOME/config.yaml" <<'PY'
import json, os, sys
path = sys.argv[1]
block = "  gbrain:\n    url: %s\n    headers:\n      Authorization: %s\n    timeout: 120\n    connect_timeout: 60\n" % (
    json.dumps(os.environ["HE_GBRAIN_MCP_URL"]), json.dumps("Bearer " + os.environ["HE_GBRAIN_MCP_TOKEN"]))
with open(path, "a") as f:
    f.write(block)
PY
  log "gbrain MCP wired into $HERMES_HOME/config.yaml#mcp_servers.gbrain through the world tap"
  hermes mcp list > "$HE_LOG_DIR/hermes-mcp-list.log" 2>&1 || true
fi

# One serve turn: write the prompt to a file under HE_LOG_DIR and run a quiet one-shot turn in the
# conversation's named session, with newline-delimited JSON events on stdout. Arguments: request
# path, session key, turn name, budget. Returns the mapped exit code; the reply text is in
# <turn>.reply.txt.
serve_turn() {
  local req=$1 key=$2 name=$3 budget=$4 code
  local prompt="$HE_LOG_DIR/turns/$name.prompt.md" events="$HE_LOG_DIR/turns/$name.hermes.jsonl" err="$HE_LOG_DIR/turns/$name.stderr.log"
  python3 -c 'import json,sys; sys.stdout.write(json.load(open(sys.argv[1]))["prompt"])' "$req" > "$prompt"
  set +e
  # --run-budget is Hermes's own soft budget; the outer timeout is the hard one and fires inside
  # the runner's 60 s grace.
  timeout -k 5 "$((budget + 10))" hermes chat \
    --query-file "$prompt" \
    --continue "$key" --create-if-missing \
    --oneshot --quiet --format stream-json \
    --provider anthropic \
    --model "$HE_MODEL_NAME" \
    --run-budget "$budget" > "$events" 2> >(tee -a "$err" >&2)
  code=$?
  set -e
  python3 - "$events" "$HE_LOG_DIR/turns/$name.reply.txt" "$HE_LOG_DIR/turns/$name.status.json" <<'PY'
import json, sys
events, reply_path, status_path = sys.argv[1:4]
result, texts = None, []
for line in open(events, encoding="utf-8"):
    line = line.strip()
    if not line:
        continue
    try:
        ev = json.loads(line)
    except ValueError:
        continue
    if ev.get("type") == "result":
        result = ev
    elif ev.get("type") == "text":
        texts.append(str(ev.get("text", "")))
text = (result or {}).get("text") or "".join(texts)
open(reply_path, "w", encoding="utf-8").write(text.strip())
json.dump({"exit_code": (result or {}).get("exit_code"), "error": (result or {}).get("error"), "tokens": (result or {}).get("tokens")}, open(status_path, "w"))
PY
  case "$code" in
    0) return 0 ;;
    124|137) return 124 ;;
  esac
  if grep -Eqi "$model_error_pattern" "$err" "$HE_LOG_DIR/turns/$name.status.json"; then return 3; fi
  return 2
}

write_response() {
  python3 - "$@" <<'PY'
import json, os, sys
resp, turn, code, reply_file, started, ended, detail = sys.argv[1:8]
exit_code = int(code)
out = {"turn": int(turn), "exit": exit_code, "reply_text": open(reply_file, encoding="utf-8").read() if exit_code == 0 else None,
       "started_at": started, "ended_at": ended}
if detail:
    out["detail"] = detail
with open(resp + ".tmp", "w", encoding="utf-8") as f:
    json.dump(out, f)
os.rename(resp + ".tmp", resp)
PY
}

stopping=0
trap 'stopping=1' TERM INT
printf '{"harness":"hermes","version":"%s","trial":"%s","ready_at":"%s","session_keys":"hermes chat -c dm:<member> | channel:<id>","adapter_sha256":"%s"%s}\n' "${HERMES_VERSION:-}" "$HE_TRIAL_ID" "$(now)" "$adapter_sha256" "$gbrain_install_json" > "$HE_LOG_DIR/ready.tmp"
mv "$HE_LOG_DIR/ready.tmp" "$HE_LOG_DIR/ready"
log "serve: ready; polling $HE_TURNS_DIR"
while [ "$stopping" -eq 0 ]; do
  for req in "$HE_TURNS_DIR"/turn-*.request.json; do
    [ -e "$req" ] || continue
    base=${req%.request.json}; name=$(basename "$base"); resp="$base.response.json"
    [ -e "$resp" ] && continue
    read -r turn budget key < <(python3 -c '
import json, os, sys
r = json.load(open(sys.argv[1]))
key = "dm:" + r["actor"]["member"] if r["channel"]["type"] == "dm" else "channel:" + r["channel"]["id"]
# A thread turn (thread_ts set; thread = "new" in task.toml) is a new session in the same conversation.
if r.get("thread_ts"): key = key + ":t" + str(r["thread_ts"])
print(r["turn"], r.get("time_budget_s") or os.environ["HE_TIME_BUDGET_S"], key)
' "$req")
    log "turn $turn: session $key, budget ${budget}s"
    started=$(now)
    set +e
    serve_turn "$req" "$key" "$name" "$budget" &
    tpid=$!
    wait "$tpid"; code=$?
    if [ "$stopping" -eq 1 ] && kill -0 "$tpid" 2>/dev/null; then
      log "turn $turn: SIGTERM during the turn; stopping hermes"
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
