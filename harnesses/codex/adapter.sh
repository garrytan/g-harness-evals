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

# The install ladder (docs/gbrain-arm.md): gbrain documents one install for Codex, its installer (gbrain-installer, applied below
# once config.toml is written). A cell that asks for another stops before ready instead of running without it.
if [ -n "${HE_GBRAIN_INSTALL:-}" ] && [ "$HE_GBRAIN_INSTALL" != gbrain-installer ]; then
  msg="HE-ADAPTER-006 the install bundle could not be applied: the codex adapter has no documented install for HE_GBRAIN_INSTALL=$HE_GBRAIN_INSTALL (gbrain documents only gbrain-installer for codex); fix: run this cell without gbrain.install or with gbrain-installer"
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

# internal-task: HE_HARNESS_CONFIG (the cell's config) official-minimal replaces Codex's own base instructions with one fixed text,
# ablation/official-minimal.txt beside this file (/opt/harness/ablation in the image; a byte copy of
# harnesses/ablation/official-minimal.txt, checked against pin.json official_minimal.sha256), named by model_instructions_file at
# the top of config.toml. Unset, empty or default adds nothing, so config.toml is byte-identical to before; any other value, or a
# text file with another sha256, is HE-ADAPTER-007 and exit 2 before ready.
model_instructions_file=''
official_minimal_json=''
case "${HE_HARNESS_CONFIG:-default}" in
  default) ;;
  official-minimal)
    om_file="$harness_dir/ablation/official-minimal.txt"
    om_expected=$(jq -r '.official_minimal.sha256 // empty' "$harness_dir/pin.json")
    om_sha=$(sha256sum "$om_file" 2>/dev/null | cut -d' ' -f1) || true
    if [ -z "$om_expected" ] || [ "$om_sha" != "$om_expected" ]; then
      log "HE-ADAPTER-007 HE_HARNESS_CONFIG=official-minimal: $om_file has sha256 '${om_sha:-missing}', pin.json official_minimal.sha256 is '$om_expected'"
      exit 2
    fi
    model_instructions_file=$om_file
    official_minimal_json=,\"official_minimal\":$(jq -cn --arg path "$om_file" --arg sha "$om_sha" --argjson bytes "$(wc -c < "$om_file")" '{path: $path, sha256: $sha, bytes: $bytes}')
    log "HE_HARNESS_CONFIG=official-minimal: model_instructions_file = $om_file (sha256 $om_sha)"
    ;;
  *) log "HE-ADAPTER-007 HE_HARNESS_CONFIG=$HE_HARNESS_CONFIG is not a codex config (default, official-minimal)"; exit 2 ;;
esac

# config.toml from the template and pin.json codex_config: the cell model in every model key Codex reads, the proxy as the
# only provider (base URL HE_MODEL_BASE_URL/v1, the per-trial token from HE_MODEL_API_KEY), low retry counts.
jq -Rjs --slurpfile pin "$harness_dir/pin.json" --arg model "$HE_MODEL_NAME" --arg base "${HE_MODEL_BASE_URL%/}/v1" --arg mi "$model_instructions_file" '
  $pin[0].codex_config as $c
  | gsub("@MODEL@"; $model | tojson) | gsub("@BASE_URL@"; $base | tojson) | gsub("@EFFORT@"; $c.model_reasoning_effort | tojson)
  | gsub("@REQUEST_RETRIES@"; $c.request_max_retries | tostring) | gsub("@STREAM_RETRIES@"; $c.stream_max_retries | tostring)
  | if $mi == "" then . else sub("\nmodel = "; "\nmodel_instructions_file = " + ($mi | tojson) + "\nmodel = ") end
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

# internal-task, the installer rung (docs/gbrain-arm.md, "The install ladder"): under HE_GBRAIN_INSTALL=gbrain-installer the runner mounts
# the exported view of what `gbrain setup codex --instructions-only` wrote at gbrain image build (gbrain#7989) read-only at
# HE_GBRAIN_INSTALL_DIR. Setup ran there with HOME=/harness-state and CODEX_HOME=/harness-state/codex, so every path in it is this
# container's: home/codex/AGENTS.md (the brain-first block, Codex's global instructions), home/codex/hooks.json (the
# UserPromptSubmit turn-rule group), home/codex/config.toml (the [hooks.state."<CODEX_HOME>/hooks.json:user_prompt_submit:<i>:0"]
# table that trusts it, so Codex runs it with no one at /hooks), home/.gbrain/agent-instructions.json (gbrain's ledger, where the
# hook reads the rule), home/.local/bin/gbrain (gbrain compiled from the same checkout, the hook's command) and, from gbrain#8424
# (v0.60.547.0), home/.gbrain/hook-launcher/gbrain-hook (the launcher the hook command, and from gbrain#8437 any stdio MCP command,
# starts gbrain through; it refuses to run when anything else is in its directory, so it must land alone there, executable, and every
# command must name this path). Each file is checked
# against the manifest and copied to HE_SESSION_STATE_DIR/<path>, which must be the view's state_root, except the trust table, which
# is appended to the config.toml written above the way setup appends it to an existing file (a newline, then the table); no other
# destination may exist. The trust hash is recomputed as Codex and gbrain compute it (sha256 over the canonical JSON of the event and
# its handler), and the hook is run with a UserPromptSubmit payload on stdin and must print the rule the bundle recorded (kept as
# $HE_LOG_DIR/gbrain-hook.codex.json); ready says turn_hook "ran". Every turn then records how many times Codex ran the hook (gbrain
# appends one heartbeat line per run). Any failure is HE-ADAPTER-006 and exit 2 before ready, recorded in
# $HE_LOG_DIR/gbrain-install.json. Unset, nothing here runs.
gbrain_install_json='' hook_heartbeat=''
if [ "${HE_GBRAIN_INSTALL:-}" = gbrain-installer ]; then
  set +e
  install_line=$(node - "${HE_GBRAIN_INSTALL_DIR:-/he-gbrain-install}" "$HE_SESSION_STATE_DIR" "${HE_GBRAIN_SPLIT:-}" "$HE_LOG_DIR" <<'JS'
const fs = require("fs"), path = require("path"), crypto = require("crypto"), cp = require("child_process");
const [view, state, split, logs] = process.argv.slice(2);
const out = path.join(logs, "gbrain-install.json"), codexHome = path.join(state, "codex");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const rec = { status: "error", code: "HE-ADAPTER-006", harness: "codex", split, install: "gbrain-installer", dir: view, view_digest: null, files: 0, destinations: [], copied: [], error: null };
const write = () => { fs.writeFileSync(out + ".tmp", JSON.stringify(rec)); fs.renameSync(out + ".tmp", out); };
const refuse = (msg) => {
  rec.error = msg; write();
  console.log("HE-ADAPTER-006 the install bundle could not be applied: " + msg + " (view " + view + ", split " + split + "); fix: re-export the view from the gbrain image (gbrain/export-install.sh) and run preflight again");
  process.exit(1);
};
if (!split) refuse("HE_GBRAIN_SPLIT is unset");
let m;
try { m = JSON.parse(fs.readFileSync(path.join(view, "manifest.json"), "utf8")); } catch (e) { refuse("no readable manifest.json in the view: " + e.message); }
rec.view_digest = m.view_digest ?? null;
if (m.harness !== "codex") refuse("the view is for harness " + JSON.stringify(m.harness) + ", this adapter is codex");
if (m.split !== split) refuse("the view is for split " + JSON.stringify(m.split) + ", the trial's split is " + split);
if ((m.install ?? "gbrain-docs") !== "gbrain-installer") refuse("the view is for install " + JSON.stringify(m.install ?? "gbrain-docs") + ", this cell's gbrain.install is gbrain-installer");
const files = m.files ?? [];
if (!files.length) refuse("the manifest lists no files");
const lines = [...files].sort((a, b) => (a.source_path < b.source_path ? -1 : a.source_path > b.source_path ? 1 : 0)).map((f) => f.source_path + " " + f.sha256 + "\n").join("");
if (sha(lines) !== m.view_digest) refuse("the manifest's view_digest does not match its file list");
const inst = m.installer ?? {};
if (inst.state_root !== state) refuse("the view was installed with HOME " + JSON.stringify(inst.state_root) + " (its hook command, gbrain's ledger and Codex's trust key name it), this trial's state dir is " + state);
const known = [".local/bin/gbrain", ".gbrain/agent-instructions.json", ".gbrain/hook-launcher/gbrain-hook", "codex/AGENTS.md", "codex/hooks.json", "codex/config.toml"];
const plan = [];
for (const f of files) {
  const rel = (f.path ?? "").replace(/^home\//, "");
  if (!f.path?.startsWith("home/") || !known.includes(rel)) refuse("no documented destination for " + JSON.stringify(f.path));
  const src = path.join(view, f.path), dest = path.join(state, rel);
  if (!fs.existsSync(src)) refuse("a listed file is missing from the view: " + f.path);
  if (sha(fs.readFileSync(src)) !== f.sha256) refuse("digest mismatch for " + f.path);
  if (rel === "codex/config.toml") {
    if (!fs.existsSync(dest)) refuse("no config.toml at " + dest + " to append the trust table to");
    const body = fs.readFileSync(src, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    if (body.length !== 2 || !/^\[hooks\.state\."[^"]+"\]$/.test(body[0]) || !/^trusted_hash = "sha256:[0-9a-f]{64}"$/.test(body[1])) refuse("the view's config.toml holds more than the one [hooks.state] trust table gbrain setup writes");
  }
  else if (fs.existsSync(dest)) refuse("the destination exists and gbrain setup would not have created it: " + dest);
  plan.push({ src, dest, rel, digest: f.sha256 });
}
for (const p of plan) {
  fs.mkdirSync(path.dirname(p.dest), { recursive: true });
  if (p.rel === "codex/config.toml") fs.appendFileSync(p.dest, "\n" + fs.readFileSync(p.src, "utf8"));
  else {
    fs.copyFileSync(p.src, p.dest);
    fs.chmodSync(p.dest, fs.statSync(p.src).mode & 0o777);
    if (sha(fs.readFileSync(p.dest)) !== p.digest) refuse("the copy at " + p.dest + " does not match the view");
  }
  rec.copied.push(p.dest);
  if (!rec.destinations.includes(path.dirname(p.dest))) rec.destinations.push(path.dirname(p.dest));
}
rec.destinations.sort();
// gbrain#8424 and later start gbrain through a launcher (the turn-rule hook; from gbrain#8437 any other hook lane or stdio MCP command
// too): every launcher a command names must be the one the view placed, alone in its directory and executable, or it refuses to run.
const launcher = path.join(state, ".gbrain/hook-launcher/gbrain-hook");
const launcherFiles = [path.join(codexHome, "hooks.json"), path.join(codexHome, "config.toml")];
const named = [...new Set(launcherFiles.filter((f) => fs.existsSync(f)).flatMap((f) => fs.readFileSync(f, "utf8").match(/\/[^\s"'\\]*\/hook-launcher\/gbrain-hook(?![^\s"'\\])/g) ?? []))];
if (named.some((l) => l !== launcher)) refuse("a command in " + launcherFiles.join(", ") + " starts gbrain through " + named.filter((l) => l !== launcher).join(", ") + ", not the hook launcher the view places at " + launcher);
if (named.length && !rec.copied.includes(launcher)) refuse("a command in " + launcherFiles.join(", ") + " starts gbrain through " + launcher + ", which the view does not place");
if (rec.copied.includes(launcher)) {
  const others = fs.readdirSync(path.dirname(launcher)).filter((n) => n !== "gbrain-hook");
  if (others.length) refuse(path.dirname(launcher) + " holds " + others.join(", ") + " beside the hook launcher, which then refuses to start gbrain");
  if (!(fs.statSync(launcher).mode & 0o100)) refuse("the hook launcher " + launcher + " is not executable");
}
let hook = "nohook";
if (inst.turn_hook) {
  const groups = JSON.parse(fs.readFileSync(path.join(codexHome, "hooks.json"), "utf8")).hooks?.UserPromptSubmit ?? [];
  const ours = groups.map((g, index) => ({ index, h: (g.hooks ?? [])[0] })).filter((g) => typeof g.h?.command === "string" && g.h.command.includes("GBRAIN_HOOK_LANE=turn-rule"));
  if (ours.length !== 1) refuse("hooks.json holds " + ours.length + " gbrain turn-rule UserPromptSubmit groups, not one");
  const { index, h } = ours[0];
  const canonical = (v) => Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v);
  const trusted = "sha256:" + sha(canonical({ event_name: "user_prompt_submit", hooks: [{ type: "command", command: h.command, timeout: h.timeout, async: false }] }));
  const key = path.join(codexHome, "hooks.json") + ":user_prompt_submit:" + index + ":0";
  const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  if (!config.includes("[hooks.state." + JSON.stringify(key) + "]\ntrusted_hash = " + JSON.stringify(trusted) + "\n")) refuse("config.toml has no [hooks.state." + JSON.stringify(key) + "] trusting the hook with " + trusted + ", so Codex would not run it");
  const r = cp.spawnSync("sh", ["-c", h.command], { input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "", session_id: "he-install-check" }), cwd: state, encoding: "utf8", timeout: 60000,
    env: { PATH: process.env.PATH, HOME: state, CODEX_HOME: codexHome } });
  let context = null;
  try { context = JSON.parse(r.stdout.trim()).hookSpecificOutput?.additionalContext ?? null; } catch {}
  fs.writeFileSync(path.join(logs, "gbrain-hook.codex.json"), JSON.stringify({ command: h.command, trust_key: key, trusted_hash: trusted, exit: r.status, stdout: r.stdout, stderr: (r.stderr ?? "").slice(0, 2000), rule_matches: context === inst.turn_hook.rule }, null, 1) + "\n");
  if (r.status !== 0 || context !== inst.turn_hook.rule) refuse("the UserPromptSubmit hook " + h.command + " exited " + r.status + " and did not print the rule the bundle recorded (gbrain-hook.codex.json)");
  rec.turn_hook = { command: h.command, trust_key: key, status: "ran", heartbeat: path.join(state, ".gbrain/integrations/hooks/heartbeat.jsonl") };
  hook = "ran";
}
rec.status = "ok"; rec.code = null; rec.files = plan.length;
write();
console.log("ok " + plan.length + " " + rec.view_digest + " " + rec.destinations.join(",") + " " + hook);
JS
)
  install_code=$?
  set -e
  log "gbrain-installer install: ${install_line:-HE-ADAPTER-006 the install bundle could not be applied: the install step failed before it could report; see stderr.log}"
  [ "$install_code" -eq 0 ] || exit 2
  read -r _ install_files install_digest install_dests install_hook <<< "$install_line"
  turn_hook_json=''
  if [ "$install_hook" = ran ]; then hook_heartbeat="$HE_SESSION_STATE_DIR/.gbrain/integrations/hooks/heartbeat.jsonl"; turn_hook_json=',"turn_hook":"ran"'; fi
  gbrain_install_json=$(printf ',"gbrain_install":{"status":"ok","install":"gbrain-installer","files":%s,"view_digest":"%s","destinations":"%s"%s}' "$install_files" "$install_digest" "$install_dests" "$turn_hook_json")
fi
# The number of times gbrain's turn hook has run in this state dir: one heartbeat line per UserPromptSubmit.
hook_runs() { cat "$hook_heartbeat" 2>/dev/null | grep -c '"event":"user-prompt"' || true; }

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
  [ -z "$hook_heartbeat" ] || hook_before=$(hook_runs)
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
  if [ -n "$hook_heartbeat" ]; then
    hook_ran=$(( $(hook_runs) - hook_before ))
    status=$(printf '%s' "$status" | jq -c --argjson n "$hook_ran" '. + {gbrain_turn_hook_runs: $n}')
    log "turn ${stem##*/}: gbrain's UserPromptSubmit hook ran $hook_ran time(s) in this turn"
  fi
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
printf '{"harness":"codex","version":"%s","trial":"%s","ready_at":"%s","session_keys":"codex exec (first turn of a key) | codex exec resume <thread id>; dm:<member> | channel:<id>","mcp_servers":%s,"adapter_sha256":"%s"%s}\n' \
  "$version" "$HE_TRIAL_ID" "$(now)" "$mcp_servers" "$adapter_sha256" "$official_minimal_json$gbrain_install_json" > "$HE_LOG_DIR/ready.tmp"
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
