#!/usr/bin/env bash
# Claude Code adapter. Protocol: docs/adapters.md. Exit 0 completed, 2
# harness error, 3 model error, 124 wall clock.
#
#   run    one headless turn: `claude -p` with /workspace/instruction.md on stdin
#   serve  the multi-user entry: the world-MCP server (and gbrain, when set) go
#          into an --mcp-config file under /harness-state, then every
#          TurnRequest in HE_TURNS_DIR becomes one `claude -p` turn in the
#          session UUIDv5(<key>), all in the same CLAUDE_CONFIG_DIR, so Claude
#          Code's own session store and memory decide what carries across
#          conversations.
#
# Every turn runs `claude -p --output-format stream-json --verbose` in its own
# session (setsid) with the prompt on stdin. Exit mapping (pin.json
# serve.exit_mapping):
#   0    claude exited 0 with a result record that is not an error, every
#        configured MCP server connected, the CLI version is pin.json's
#   124  the turn outlived its budget: SIGTERM to the turn's session, SIGKILL
#        after the grace (60 s for run, 5 s for serve)
#   3    the result record has is_error with api_error_status set (a proxy
#        refusal such as 402 or 403, a cap refused with 400, a provider 4xx or
#        5xx after the CLI's retries) or with terminal_reason api_error and no
#        status (the proxy unreachable after CLAUDE_CODE_MAX_RETRIES retries)
#   2    anything else: no init or result record (a crash, output that does
#        not parse), a configured MCP server not connected in the init record,
#        a call to a configured MCP server's tool that failed at the transport
#        level after a good init (the CLI goes on and exits 0; observed at
#        2.1.312: an is_error tool_result "ECONNREFUSED: Unable to connect. ..."
#        for a refused connection, "Error POSTing to endpoint: <body>" for an
#        HTTP error status), a CLI version other than pin.json's, a session id
#        already in use, an error result without an API error, SIGTERM during
#        a turn (run or serve), HE_MODEL_BASE_URL not ending in /anthropic
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
if [ "${HE_SESSION_SCOPE:-conversation}" != conversation ]; then echo "claude-code adapter: HE_SESSION_SCOPE=${HE_SESSION_SCOPE} is not supported (only the openclaw adapter keys sessions per turn)" >&2; exit 2; fi

mkdir -p "$HE_LOG_DIR"
exec > >(tee -a "$HE_LOG_DIR/stdout.log") 2> >(tee -a "$HE_LOG_DIR/stderr.log" >&2)
log() { printf '%s claude-code[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }
now() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }
# internal-task: the sha256 of this adapter file goes into the ready file, so a trial record can prove which adapter ran (the runner's
# preflight compares the same hash in the image with the checkout, HE-ADAPTER-005).
adapter_sha256=$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)
harness_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

entry=${1:-run}
case "$entry" in
  run|serve) ;;
  *) log "unknown entry point: $entry; 'run' and 'serve' are implemented"; exit 2 ;;
esac

# The CLI speaks the Anthropic Messages API only, so the runner's proxy route must be the anthropic provider's
# (<proxy>/<slot>/anthropic, runner/trial/proxy.ts baseUrlFor). A cell on another provider stops here instead of sending
# Anthropic requests to that provider's route.
case "${HE_MODEL_BASE_URL%/}" in
  */anthropic) ;;
  *) log "HE_MODEL_BASE_URL $HE_MODEL_BASE_URL does not end in /anthropic: claude-code runs only on an anthropic cell (the proxy route <proxy>/<slot>/anthropic)"; exit 2 ;;
esac

# Set before anything long runs, run included: bash is PID 1 in the container and ignores a SIGTERM it has no trap for, so
# docker stop would otherwise wait for its SIGKILL while the turn's processes kept running. A turn checks the flag (run_turn).
stopping=0
trap 'stopping=1' TERM INT

# The install ladder (HE_GBRAIN_INSTALL, docs/gbrain-arm.md): gbrain documents one install for Claude Code, its installer
# (gbrain-installer, applied below once HOME is set). A cell that asks for another stops here instead of running as a bare-MCP cell.
if [ -n "${HE_GBRAIN_INSTALL:-}" ] && [ "$HE_GBRAIN_INSTALL" != gbrain-installer ]; then
  reason="HE_GBRAIN_INSTALL=$HE_GBRAIN_INSTALL is not implemented for claude-code (gbrain documents only gbrain-installer for this harness)"
  node -e 'const [out, install, split, dir, error] = process.argv.slice(1); require("fs").writeFileSync(out, JSON.stringify({ status: "error", code: "HE-ADAPTER-006", harness: "claude-code", split, install, dir, view_digest: null, files: 0, destinations: [], copied: [], error }));' \
    "$HE_LOG_DIR/gbrain-install.json" "$HE_GBRAIN_INSTALL" "${HE_GBRAIN_SPLIT:-}" "${HE_GBRAIN_INSTALL_DIR:-/he-gbrain-install}" "$reason"
  log "$HE_GBRAIN_INSTALL install: HE-ADAPTER-006 the install bundle could not be applied: $reason; fix: run this cell without gbrain.install or with gbrain-installer"
  exit 2
fi

# H10 (internal-task): HE_HARNESS_CONFIG names the instruction route, [<driver>+]<route>[@<slot_id>] (docs/adapters.md, "Route config",
# the grammar parseRouteConfig in runner/contracts.ts reads), applied below once CLAUDE_CONFIG_DIR exists. Unset, empty or default
# changes nothing; official-minimal (internal-task, below) is no route.
# This adapter runs the cli driver only: sdk-preset and sdk-default come with the Agent SDK driver (H10 PR 4), so
# a cell that names one stops here rather than running the CLI in its place. A route beside HE_GBRAIN_INSTALL is refused too: the
# installer writes its own rule into CLAUDE.md and settings.json, so the cell would carry two carriers. Every refusal is
# HE-ADAPTER-007, exit 2, before anything is written.
route_config=${HE_HARNESS_CONFIG:-} route_driver=cli route=${HE_HARNESS_CONFIG:-default} route_slot='' route_at=0
refuse_route() { log "HE-ADAPTER-007 HE_HARNESS_CONFIG=$route_config $1"; exit 2; }
if [[ $route == *+* ]]; then route_driver=${route%%+*}; route=${route#*+}; fi
if [[ $route == *@* ]]; then route_at=1; route_slot=${route#*@}; route=${route%%@*}; fi
case "$route_driver" in
  cli) ;;
  sdk-preset|sdk-default) refuse_route "names the $route_driver driver, which runs Claude Code through the Agent SDK (H10 PR 4); this adapter runs the cli driver only" ;;
  *) refuse_route "names no known driver (cli, sdk-preset, sdk-default)" ;;
esac
case "$route" in
  official-minimal)
    [ "$route_config" = official-minimal ] || refuse_route "is official-minimal with a driver prefix or a slot id; that config takes neither"
    route=default ;;
  default|route-tool|route-hook|route-once|route-system|route-startup|route-skill|route-told|route-placebo)
    [ "$route_at" -eq 0 ] || refuse_route "gives a slot id, which only route-slot-told and route-slot-skill take" ;;
  route-slot-told|route-slot-skill)
    [[ $route_slot =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || refuse_route "needs @<slot_id> matching ^[a-z0-9][a-z0-9-]{0,62}\$ for $route" ;;
  *) refuse_route "is not a claude-code config (default, official-minimal) and names no known route (route-tool, route-hook, route-once, route-system, route-startup, route-skill, route-told, route-placebo, route-slot-told, route-slot-skill)" ;;
esac
if [ "$route" != default ] && [ -n "${HE_GBRAIN_INSTALL:-}" ]; then refuse_route "is a route and HE_GBRAIN_INSTALL=$HE_GBRAIN_INSTALL writes gbrain's own rule into CLAUDE.md and settings.json; a route cell runs without gbrain.install"; fi

# internal-task: HE_HARNESS_CONFIG (the cell's config) official-minimal replaces Claude Code's own system prompt with one fixed text,
# ablation/official-minimal.txt beside this file (/opt/harness/ablation in the image; a byte copy of
# harnesses/ablation/official-minimal.txt, checked against pin.json official_minimal.sha256), passed as --system-prompt on every
# turn. Unset, empty or default adds nothing, so the adapter's files and command lines are as before; any other value is a route (parsed
# above, which refuses an unknown one), and a text file with another sha256 is HE-ADAPTER-007 and exit 2 before ready.
system_prompt_args=()
official_minimal_json=''
case "${HE_HARNESS_CONFIG:-default}" in
  official-minimal)
    om_file="$harness_dir/ablation/official-minimal.txt"
    om_expected=$(node -e 'process.stdout.write(String(require(process.argv[1]).official_minimal?.sha256 ?? ""))' "$harness_dir/pin.json")
    om_sha=$(sha256sum "$om_file" 2>/dev/null | cut -d' ' -f1) || true
    if [ -z "$om_expected" ] || [ "$om_sha" != "$om_expected" ]; then
      log "HE-ADAPTER-007 HE_HARNESS_CONFIG=official-minimal: $om_file has sha256 '${om_sha:-missing}', pin.json official_minimal.sha256 is '$om_expected'"
      exit 2
    fi
    system_prompt_args=(--system-prompt "$(cat "$om_file")")
    official_minimal_json=$(printf ',"official_minimal":{"path":"%s","sha256":"%s","bytes":%s}' "$om_file" "$om_sha" "$(wc -c < "$om_file" | tr -d ' ')")
    log "HE_HARNESS_CONFIG=official-minimal: --system-prompt from $om_file (sha256 $om_sha)"
    ;;
esac

# HOME and CLAUDE_CONFIG_DIR hold settings, sessions (projects/<cwd>/<session id>.jsonl), memory and skills: all state.
# No .credentials.json is ever written: the CLI authenticates with ANTHROPIC_API_KEY only.
export HOME="$HE_SESSION_STATE_DIR"
export CLAUDE_CONFIG_DIR="$HE_SESSION_STATE_DIR/claude"
# The CLI's scratch files (Bash tool task output, socket and fs-watch probes) go under /harness-state too, not the image's /tmp.
export TMPDIR="$HE_SESSION_STATE_DIR/tmp" CLAUDE_TMPDIR="$HE_SESSION_STATE_DIR/tmp"
mkdir -p "$CLAUDE_CONFIG_DIR" "$TMPDIR"
[ -e "$CLAUDE_CONFIG_DIR/settings.json" ] || cp "$harness_dir/config/settings.json" "$CLAUDE_CONFIG_DIR/settings.json"

# internal-task, the installer rung (docs/gbrain-arm.md, "The install ladder"): under HE_GBRAIN_INSTALL=gbrain-installer the runner mounts
# the exported view of what `gbrain setup claude-code --instructions-only` wrote at gbrain image build (gbrain#7989) read-only at
# HE_GBRAIN_INSTALL_DIR. Setup ran there with HOME=/harness-state and CLAUDE_CONFIG_DIR=/harness-state/claude, so every path in it is
# this container's: home/claude/CLAUDE.md (the brain-first block, Claude Code's user memory), home/claude/settings.json (this
# adapter's settings.json with setup's UserPromptSubmit turn-rule hook merged in) and its .bak, home/.gbrain/agent-instructions.json
# (gbrain's ledger, where the hook reads the rule), home/.local/bin/gbrain (gbrain compiled from the same checkout, the hook's
# command) and, from gbrain#8424 (v0.60.547.0), home/.gbrain/hook-launcher/gbrain-hook (the launcher the hook command, and from
# gbrain#8437 any stdio MCP command, starts gbrain through; it refuses to run when anything else is in its directory, so it must land
# alone there, executable, and every command must name this path). Each file is checked against the manifest and copied to HE_SESSION_STATE_DIR/<path>, which must be the view's
# state_root; settings.json replaces the one written above only when that one is the seed setup merged into, and no other
# destination may exist. The hook is then run the way Claude Code runs it, with a UserPromptSubmit payload on stdin, and must print
# the rule the bundle recorded (kept as $HE_LOG_DIR/gbrain-hook.claude-code.json); ready says turn_hook "ran". Every turn then
# records how many times Claude Code ran the hook (gbrain appends one heartbeat line per run). Any failure is HE-ADAPTER-006 and
# exit 2 before ready, recorded in $HE_LOG_DIR/gbrain-install.json. Unset, nothing here runs.
gbrain_install_json='' hook_heartbeat=''
if [ "${HE_GBRAIN_INSTALL:-}" = gbrain-installer ]; then
  set +e
  install_line=$(node - "${HE_GBRAIN_INSTALL_DIR:-/he-gbrain-install}" "$HE_SESSION_STATE_DIR" "${HE_GBRAIN_SPLIT:-}" "$HE_LOG_DIR" <<'JS'
const fs = require("fs"), path = require("path"), crypto = require("crypto"), cp = require("child_process");
const [view, state, split, logs] = process.argv.slice(2);
const out = path.join(logs, "gbrain-install.json");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const rec = { status: "error", code: "HE-ADAPTER-006", harness: "claude-code", split, install: "gbrain-installer", dir: view, view_digest: null, files: 0, destinations: [], copied: [], error: null };
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
if (m.harness !== "claude-code") refuse("the view is for harness " + JSON.stringify(m.harness) + ", this adapter is claude-code");
if (m.split !== split) refuse("the view is for split " + JSON.stringify(m.split) + ", the trial's split is " + split);
if ((m.install ?? "gbrain-docs") !== "gbrain-installer") refuse("the view is for install " + JSON.stringify(m.install ?? "gbrain-docs") + ", this cell's gbrain.install is gbrain-installer");
const files = m.files ?? [];
if (!files.length) refuse("the manifest lists no files");
const lines = [...files].sort((a, b) => (a.source_path < b.source_path ? -1 : a.source_path > b.source_path ? 1 : 0)).map((f) => f.source_path + " " + f.sha256 + "\n").join("");
if (sha(lines) !== m.view_digest) refuse("the manifest's view_digest does not match its file list");
const inst = m.installer ?? {};
if (inst.state_root !== state) refuse("the view was installed with HOME " + JSON.stringify(inst.state_root) + " (its hook command, gbrain's ledger and settings name it), this trial's state dir is " + state);
const known = [".local/bin/gbrain", ".gbrain/agent-instructions.json", ".gbrain/hook-launcher/gbrain-hook", "claude/CLAUDE.md", "claude/settings.json", "claude/settings.json.bak"];
const plan = [];
for (const f of files) {
  const rel = (f.path ?? "").replace(/^home\//, "");
  if (!f.path?.startsWith("home/") || !known.includes(rel)) refuse("no documented destination for " + JSON.stringify(f.path));
  const src = path.join(view, f.path), dest = path.join(state, rel);
  if (!fs.existsSync(src)) refuse("a listed file is missing from the view: " + f.path);
  if (sha(fs.readFileSync(src)) !== f.sha256) refuse("digest mismatch for " + f.path);
  if (rel === "claude/settings.json") {
    if (!inst.seed || !fs.existsSync(dest) || sha(fs.readFileSync(dest)) !== inst.seed.sha256) refuse("the settings.json at " + dest + " is not the seed gbrain setup merged its hook into (sha256 " + (inst.seed?.sha256 ?? "none recorded") + "); fix: rebuild the gbrain image from this checkout");
    const canonical = (v) => Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v);
    const withoutHook = (s) => {
      const ups = (s.hooks?.UserPromptSubmit ?? []).map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((e) => e._gbrain !== "turn-rule-v1") })).filter((g) => g.hooks.length);
      const hooks = { ...(s.hooks ?? {}) };
      if (ups.length) hooks.UserPromptSubmit = ups; else delete hooks.UserPromptSubmit;
      const rest = { ...s };
      if (Object.keys(hooks).length) rest.hooks = hooks; else delete rest.hooks;
      return canonical(rest);
    };
    let viewSettings;
    try { viewSettings = JSON.parse(fs.readFileSync(src, "utf8")); } catch (e) { refuse("the view's settings.json is not JSON: " + e.message); }
    if (withoutHook(viewSettings) !== withoutHook(JSON.parse(fs.readFileSync(dest, "utf8")))) refuse("the view's settings.json differs from the seed by more than the gbrain turn-rule hook");
  } else if (fs.existsSync(dest)) refuse("the destination exists and gbrain setup would not have created it: " + dest);
  plan.push({ src, dest, digest: f.sha256 });
}
for (const p of plan) {
  fs.mkdirSync(path.dirname(p.dest), { recursive: true });
  fs.copyFileSync(p.src, p.dest);
  fs.chmodSync(p.dest, fs.statSync(p.src).mode & 0o777);
  if (sha(fs.readFileSync(p.dest)) !== p.digest) refuse("the copy at " + p.dest + " does not match the view");
  rec.copied.push(p.dest);
  if (!rec.destinations.includes(path.dirname(p.dest))) rec.destinations.push(path.dirname(p.dest));
}
rec.destinations.sort();
// gbrain#8424 and later start gbrain through a launcher (the turn-rule hook; from gbrain#8437 any other hook lane or stdio MCP command
// too): every launcher a command names must be the one the view placed, alone in its directory and executable, or it refuses to run.
const launcher = path.join(state, ".gbrain/hook-launcher/gbrain-hook");
const launcherFiles = [path.join(state, "claude/settings.json")];
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
  const settings = JSON.parse(fs.readFileSync(path.join(state, "claude/settings.json"), "utf8"));
  const ours = (settings.hooks?.UserPromptSubmit ?? []).flatMap((g) => g.hooks ?? []).filter((e) => e._gbrain === "turn-rule-v1" && typeof e.command === "string");
  if (ours.length !== 1) refuse("settings.json holds " + ours.length + " gbrain turn-rule UserPromptSubmit entries, not one");
  const command = ours[0].command;
  const r = cp.spawnSync("sh", ["-c", command], { input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "", session_id: "he-install-check" }), cwd: state, encoding: "utf8", timeout: 60000,
    env: { PATH: process.env.PATH, HOME: state, CLAUDE_CONFIG_DIR: path.join(state, "claude") } });
  let context = null;
  try { context = JSON.parse(r.stdout.trim()).hookSpecificOutput?.additionalContext ?? null; } catch {}
  fs.writeFileSync(path.join(logs, "gbrain-hook.claude-code.json"), JSON.stringify({ command, exit: r.status, stdout: r.stdout, stderr: (r.stderr ?? "").slice(0, 2000), rule_matches: context === inst.turn_hook.rule }, null, 1) + "\n");
  if (r.status !== 0 || context !== inst.turn_hook.rule) refuse("the UserPromptSubmit hook " + command + " exited " + r.status + " and did not print the rule the bundle recorded (gbrain-hook.claude-code.json)");
  rec.turn_hook = { command, status: "ran", heartbeat: path.join(state, ".gbrain/integrations/hooks/heartbeat.jsonl") };
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

# H10 (internal-task), the instruction routes on the cli driver (harnesses/routes/README.md, "Routes on four harnesses"). One instruction,
# routes/instruction.md beside this file (/opt/harness/routes in the image, a byte copy of harnesses/routes/instruction.md checked
# against the sha256 the preregistration cites; routes/placebo.md likewise), reaches Claude Code through the route the config names:
#   route-tool                  nothing written: the gbrain MCP tool descriptions stay the only carrier
#   route-system                --append-system-prompt <instruction> on every turn, --resume included (run_turn)
#   route-startup               $CLAUDE_CONFIG_DIR/CLAUDE.md, the instruction bytes alone (Claude Code's user memory)
#   route-skill, route-told     $CLAUDE_CONFIG_DIR/skills/brain-first/SKILL.md: name, the fixed description, the instruction as the
#                               body (route-told's sentence is in the cell's preamble, which the runner writes, not this adapter)
#   route-hook, route-once,     a UserPromptSubmit hook in settings.json running routes/he-route-hook.sh, which prints the
#   route-placebo               instruction (the placebo for route-placebo) as additionalContext when the turn's emit flag is 1;
#                               route_turn writes the flag before each turn (always 1, or 1 only on a session's first turn for
#                               route-once). The hook is run once here with the flag set and must print the bytes; the flag is
#                               then removed
#   route-slot-told@<id>,       the slot bundle's skill/<name>/ from routes/slots/<id>/ copied to $CLAUDE_CONFIG_DIR/skills/<name>/,
#   route-slot-skill@<id>       after its bundle_sha256 is recomputed with sha256sum and equals slot.json's (the full shape check is
#                               scripts/routes/slot-check.ts, host side, in preflight)
# $HE_LOG_DIR/instruction-route.json records the route, the bytes' sha256, every file written and the hook check; ready carries
# instruction_route. A destination that already exists, a settings.json that is not this adapter's seed, a bytes file with another
# sha256 or a hook that does not print its bytes is HE-ADAPTER-007, exit 2 before ready. Default writes nothing and records nothing.
route_json='' route_system_text=''
route_emit="$HE_SESSION_STATE_DIR/he-route/emit" route_sessions="$HE_SESSION_STATE_DIR/he-route/sessions.json"
if [ "$route" != default ]; then
  set +e
  route_line=$(node - "$route" "$route_slot" "$harness_dir" "$CLAUDE_CONFIG_DIR" "$route_emit" "$HE_LOG_DIR/instruction-route.json" "$route_config" "$route_driver" <<'JS'
const fs = require("fs"), path = require("path"), crypto = require("crypto"), cp = require("child_process");
const [route, slot, harness, claude, emit, out, config, driver] = process.argv.slice(2);
const SHA = { "instruction.md": "4a81cb9b35d6ad6f205723618f15e6c3dc66586cbb41f0ebc72141b74669230f", "placebo.md": "b66810fe132a2a9988100dcd01a9c8a03665265ff01555f17cd9b1955047dd34" };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const routes = path.join(harness, "routes");
const bytesFile = route === "route-placebo" ? "placebo.md" : "instruction.md";
const rec = { status: "error", code: "HE-ADAPTER-007", harness: "claude-code", config, driver, route, slot: slot || null, bytes: { path: path.join(routes, bytesFile), sha256: null, bytes: null }, setting: null, files: [], hook: null, error: null };
const write = () => { fs.writeFileSync(out + ".tmp", JSON.stringify(rec, null, 1) + "\n"); fs.renameSync(out + ".tmp", out); };
const refuse = (msg) => { rec.error = msg; write(); console.log("HE-ADAPTER-007 the instruction route could not be applied: " + msg); process.exit(1); };
const fresh = (p) => { if (fs.existsSync(p)) refuse("the destination exists and the route does not overwrite it: " + p); };
const put = (p, body) => { fresh(p); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); rec.files.push({ path: p, sha256: sha(body), bytes: body.length }); };
let text;
try { text = fs.readFileSync(rec.bytes.path); } catch (e) { refuse("no readable " + bytesFile + ": " + e.message); }
Object.assign(rec.bytes, { sha256: sha(text), bytes: text.length });
if (rec.bytes.sha256 !== SHA[bytesFile]) refuse("routes/" + bytesFile + "'s sha256 is " + rec.bytes.sha256 + ", not the committed " + SHA[bytesFile] + "; rebuild the image from the checkout");
let hook = "none";
if (route === "route-tool") rec.setting = "none: the instruction is written nowhere; the gbrain MCP tool descriptions are the only carrier";
else if (route === "route-system") rec.setting = "--append-system-prompt <instruction> on every claude -p turn, --resume included";
else if (route === "route-startup") { rec.setting = "$CLAUDE_CONFIG_DIR/CLAUDE.md, the instruction bytes alone"; put(path.join(claude, "CLAUDE.md"), text); }
else if (route === "route-skill" || route === "route-told") {
  rec.setting = "a skill $CLAUDE_CONFIG_DIR/skills/brain-first/SKILL.md: frontmatter name and a fixed description, the instruction bytes as the body";
  put(path.join(claude, "skills", "brain-first", "SKILL.md"), Buffer.concat([Buffer.from("---\nname: brain-first\ndescription: Check GBrain first, before answering any turn.\n---\n\n"), text, Buffer.from("\n")]));
} else if (route === "route-slot-told" || route === "route-slot-skill") {
  const bundle = path.join(routes, "slots", slot);
  let meta;
  try { meta = JSON.parse(fs.readFileSync(path.join(bundle, "slot.json"), "utf8")); } catch (e) { refuse("no readable slot.json for slot " + slot + " under " + bundle + ": " + e.message); }
  if (meta.slot_id !== slot) refuse("slot.json names slot_id " + JSON.stringify(meta.slot_id) + ", not " + slot);
  if (typeof meta.skill_name !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(meta.skill_name)) refuse("slot.json skill_name " + JSON.stringify(meta.skill_name) + " is not a skill name");
  const r = cp.spawnSync("sh", ["-c", "find . -type f ! -path ./slot.json | sed 's|^\\./||' | LC_ALL=C sort | xargs -d '\\n' sha256sum | sha256sum"], { cwd: bundle, encoding: "utf8" });
  const digest = (r.stdout || "").split(" ")[0];
  if (r.status !== 0 || digest !== meta.bundle_sha256) refuse("slot " + slot + "'s bundle_sha256 is " + (digest || "unreadable") + ", slot.json says " + meta.bundle_sha256);
  rec.slot_bundle_sha256 = digest;
  rec.setting = "the slot bundle's skill/" + meta.skill_name + "/ copied to $CLAUDE_CONFIG_DIR/skills/" + meta.skill_name + "/ (bundle_sha256 rechecked)";
  const src = path.join(bundle, "skill", meta.skill_name), dest = path.join(claude, "skills", meta.skill_name);
  if (!fs.existsSync(path.join(src, "SKILL.md"))) refuse("the slot bundle has no skill/" + meta.skill_name + "/SKILL.md");
  fresh(dest);
  const walk = (rel) => { for (const name of fs.readdirSync(path.join(src, rel)).sort()) { const r2 = path.join(rel, name); if (fs.statSync(path.join(src, r2)).isDirectory()) walk(r2); else put(path.join(dest, r2), fs.readFileSync(path.join(src, r2))); } };
  walk("");
} else {
  rec.setting = "settings.json hooks.UserPromptSubmit: routes/he-route-hook.sh prints routes/" + bytesFile + " as additionalContext when the turn's emit flag is 1 (" + (route === "route-once" ? "a session's first turn only" : "every turn") + ")";
  const settings = path.join(claude, "settings.json");
  const seed = fs.readFileSync(path.join(harness, "config", "settings.json"));
  if (!fs.existsSync(settings) || !fs.readFileSync(settings).equals(seed)) refuse(settings + " is not this adapter's seed (config/settings.json), so the route would merge into settings it did not write");
  const script = path.join(routes, "he-route-hook.sh");
  if (/\s/.test(script + emit + rec.bytes.path)) refuse("a hook path holds whitespace: " + script + " " + emit + " " + rec.bytes.path);
  const command = "sh " + script + " " + emit + " " + rec.bytes.path;
  const s = JSON.parse(seed.toString("utf8"));
  s.hooks = { UserPromptSubmit: [{ hooks: [{ type: "command", command }] }] };
  const body = Buffer.from(JSON.stringify(s, null, 2) + "\n");
  fs.writeFileSync(settings, body);
  rec.files.push({ path: settings, sha256: sha(body), bytes: body.length });
  fs.mkdirSync(path.dirname(emit), { recursive: true });
  fs.writeFileSync(emit, "emit=1");
  const r = cp.spawnSync("sh", ["-c", command], { input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "", session_id: "he-route-check" }), encoding: "utf8", timeout: 30000 });
  fs.rmSync(emit, { force: true });
  let context = null;
  try { context = JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch {}
  if (r.status !== 0 || context !== text.toString("utf8")) refuse("the route hook " + command + " exited " + r.status + " and did not print routes/" + bytesFile + " as additionalContext with the flag set");
  rec.hook = { command, check: "printed the bytes with emit=1" };
  hook = "checked";
}
rec.status = "ok"; rec.code = null;
write();
console.log("ok " + rec.bytes.sha256 + " " + rec.files.length + " " + hook);
JS
)
  route_code=$?
  set -e
  log "instruction route $route_config: ${route_line:-HE-ADAPTER-007 the instruction route could not be applied: the route step failed before it could report; see stderr.log}"
  [ "$route_code" -eq 0 ] || exit 2
  read -r _ route_sha route_files route_hook <<< "$route_line"
  if [ "$route" = route-system ]; then route_system_text=$(cat "$harness_dir/routes/instruction.md"); fi
  route_json=$(printf ',"instruction_route":{"config":"%s","driver":"%s","route":"%s","bytes_sha256":"%s","files":%s,"hook":"%s"}' "$route_config" "$route_driver" "$route" "$route_sha" "$route_files" "$route_hook")
fi

# Before each turn of a route cell: count the turn against its session (the adapter's key, so the count follows the session id
# Claude Code resumes), write the emit flag for a hook route (temp file, then rename) and record the turn's RouteTurnStatus
# (runner/contracts.ts) at <prefix>.route.json, with session_key in TurnWindow's form (<channel id>[:<thread_ts>]). Arguments:
# file prefix, adapter key, window key. Default does nothing.
route_turn() {
  [ "$route" != default ] || return 0
  node - "$route_sessions" "$route_emit" "$1.route.json" "$2" "$3" "$route_config" "$route_driver" "$route" <<'JS'
const fs = require("fs"), path = require("path");
const [sessions, emit, out, key, windowKey, config, driver, route] = process.argv.slice(2);
const atomic = (p, body) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p + ".tmp", body); fs.renameSync(p + ".tmp", p); };
const counts = fs.existsSync(sessions) ? JSON.parse(fs.readFileSync(sessions, "utf8")) : {};
const n = (counts[key] ?? 0) + 1;
counts[key] = n;
atomic(sessions, JSON.stringify(counts));
const hook = ["route-hook", "route-once", "route-placebo"].includes(route);
const emitted = hook ? (route === "route-once" ? n === 1 : true) : null;
if (hook) atomic(emit, emitted ? "emit=1" : "emit=0");
atomic(out, JSON.stringify({ config, driver, route, session_key: windowKey, session_turn: n, emitted }) + "\n");
console.log("session_turn " + n + " emitted " + emitted);
JS
}

# The model goes through the proxy with the per-trial token. Every model setting the CLI reads at this pin names the cell
# model, so no background, subagent, classifier or alias call can ask for another; model substitution is switched off.
export ANTHROPIC_BASE_URL="$HE_MODEL_BASE_URL"
export ANTHROPIC_API_KEY="$HE_MODEL_API_KEY"
for v in ANTHROPIC_MODEL ANTHROPIC_DEFAULT_MODEL ANTHROPIC_SMALL_FAST_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL \
  ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_FABLE_MODEL CLAUDE_CODE_SUBAGENT_MODEL CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL \
  CLAUDE_CODE_AUTO_MODE_MODEL CLAUDE_CODE_BG_CLASSIFIER_MODEL; do
  export "$v=$HE_MODEL_NAME"
done
export CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 CLAUDE_CODE_NO_MODEL_FALLBACK=1 CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK=1 CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK=1
# No side traffic: no update check, telemetry, error reporting or other nonessential calls.
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1
# Two retries instead of the CLI's 10, so an unreachable proxy ends the turn as a model error within seconds.
export CLAUDE_CODE_MAX_RETRIES=2
# In -p the CLI connects MCP servers in the background by default and its first model request can go out before they are
# connected (the init record then says "pending"); false makes it wait, so the init record carries each server's real status.
export MCP_CONNECTION_NONBLOCKING=false

pinned_version=$(node -e 'process.stdout.write(String(require(process.argv[1]).version))' "$harness_dir/pin.json")
claude_version=$(claude --version 2>/dev/null || true)
claude_version=${claude_version%% *}
log "claude-code $claude_version model=anthropic/$HE_MODEL_NAME budget=${HE_TIME_BUDGET_S}s entry=$entry"
if [ "$claude_version" != "$pinned_version" ]; then
  log "claude --version is '$claude_version', pin.json says $pinned_version"
  exit 2
fi

cd "$HE_WORKSPACE_DIR"

# The MCP servers in Claude Code's own --mcp-config format (Streamable HTTP with the per-trial bot token the world minted; in
# the redaction set), written under /harness-state; --strict-mcp-config makes it the only MCP source.
mcp_config="$HE_SESSION_STATE_DIR/mcp.json"
mcp_servers=()
if [ -n "${HE_WORLD_MCP_URL:-}" ] && [ -n "${HE_WORLD_MCP_TOKEN:-}" ]; then mcp_servers+=(world); fi
# The gbrain arm (docs/gbrain-arm.md): with HE_GBRAIN_MCP_URL and HE_GBRAIN_MCP_TOKEN set, a server named gbrain goes in beside
# world with the same shape (the URL is the world's /gbrain tap, the token the bot token). Unset, the file has world alone.
if [ -n "${HE_GBRAIN_MCP_URL:-}" ] && [ -n "${HE_GBRAIN_MCP_TOKEN:-}" ]; then mcp_servers+=(gbrain); fi
if [ "$entry" = serve ] && [[ " ${mcp_servers[*]} " != *" world "* ]]; then log "serve needs HE_WORLD_MCP_URL and HE_WORLD_MCP_TOKEN"; exit 2; fi
( umask 077 && node -e '
const [out, ...names] = process.argv.slice(1);
const env = { world: ["HE_WORLD_MCP_URL", "HE_WORLD_MCP_TOKEN"], gbrain: ["HE_GBRAIN_MCP_URL", "HE_GBRAIN_MCP_TOKEN"] };
const mcpServers = {};
for (const n of names) mcpServers[n] = { type: "http", url: process.env[env[n][0]], headers: { Authorization: "Bearer " + process.env[env[n][1]] } };
require("fs").writeFileSync(out, JSON.stringify({ mcpServers }, null, 2) + "\n");
' "$mcp_config" "${mcp_servers[@]}" )

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
  log "MCP server $name: tools/list answered $tools tools; wired into $mcp_config"
done

turn_pid=''

# Stop a turn's session: SIGTERM to every process in it, SIGKILL to whatever is left after the grace.
stop_session() {
  local sid=$1 grace=$2 waited=0
  pkill -TERM -s "$sid" 2>/dev/null || true
  while pgrep -s "$sid" >/dev/null 2>&1 && [ "$waited" -lt $((grace * 5)) ]; do sleep 0.2; waited=$((waited + 1)); done
  pkill -KILL -s "$sid" 2>/dev/null || true
}

# One turn. Arguments: file prefix for this turn's logs, prompt file, session key, budget, kill grace, and the session key in
# TurnWindow's form for the route status. Sets turn_code and turn_detail; the reply is in <prefix>.reply.txt. The session id is
# UUIDv5 of the key: --session-id the first time, --resume once its transcript exists (the CLI refuses a --session-id it already
# holds). route-system adds --append-system-prompt with the instruction to every turn, --resume included.
run_turn() {
  local prefix=$1 prompt=$2 key=$3 budget=$4 grace=$5 window_key=$6 sid flag deadline timed_out=0 stopped=0 code line route_status
  local -a route_args=()
  sid=$(node -e '
const h = require("crypto").createHash("sha1").update(Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex")).update("harness-evals:claude-code:" + process.argv[1]).digest();
h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
const x = h.subarray(0, 16).toString("hex");
process.stdout.write([x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20)].join("-"));' "$key")
  if compgen -G "$CLAUDE_CONFIG_DIR/projects/*/$sid.jsonl" >/dev/null; then flag=--resume; else flag=--session-id; fi
  log "session $key: $flag $sid"
  if [ "$route" != default ]; then
    if ! route_status=$(route_turn "$prefix" "$key" "$window_key"); then turn_code=2; turn_detail="the route status for this turn could not be written"; return 0; fi
    log "session $key: route $route $route_status"
  fi
  [ "$route" != route-system ] || route_args=(--append-system-prompt "$route_system_text")
  [ -z "$hook_heartbeat" ] || hook_before=$(hook_runs)
  set +e
  setsid claude -p --output-format stream-json --verbose --model "$HE_MODEL_NAME" --permission-mode bypassPermissions \
    --disallowedTools WebSearch,WebFetch --mcp-config "$mcp_config" --strict-mcp-config "${system_prompt_args[@]}" "$flag" "$sid" "${route_args[@]}" \
    < "$prompt" > "$prefix.claude.jsonl" 2> >(tee -a "$prefix.stderr.log" >&2) &
  turn_pid=$!
  deadline=$((SECONDS + budget))
  while kill -0 "$turn_pid" 2>/dev/null; do
    if [ "$stopping" -eq 1 ]; then stopped=1; stop_session "$turn_pid" "$grace"; break; fi
    if [ "$SECONDS" -ge "$deadline" ]; then timed_out=1; stop_session "$turn_pid" "$grace"; break; fi
    sleep 0.2
  done
  wait "$turn_pid"; code=$?
  turn_pid=''
  line=$(node - "$prefix.claude.jsonl" "$prefix.reply.txt" "$prefix.status.json" "$code" "$pinned_version" "${mcp_servers[@]}" <<'JS'
const fs = require("fs");
const [events, replyPath, statusPath, exitCode, pinned, ...servers] = process.argv.slice(2);
let init = null, result = null, unparsed = 0;
// A configured MCP server's tool call that failed at the transport level: the CLI hands the error to the model as an is_error
// tool_result and the turn goes on (2.1.312: "ECONNREFUSED: Unable to connect. Is the computer able to access the url?" for a
// refused connection, "Error POSTing to endpoint: <body>" for an HTTP error status, 'MCP server "<s>" tool "<t>" timed out
// after <n>s' past MCP_TOOL_TIMEOUT). The match is anchored at the start of the CLI's own message, so a tool's own error
// result (the server's text, such as {"error":"user_not_found","message":"no member ENOTFOUND"}) is never one.
const mcpTool = new RegExp("^mcp__(" + servers.join("|") + ")__");
const transportError = /^(?:<tool_use_error>)?(?:Error: )?(?:(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN)\b|Unable to connect|Error POSTing to endpoint|Failed to open SSE stream|Streamable HTTP error|fetch failed|socket hang up|(?:The )?socket connection was closed|MCP error -32000: Connection closed|MCP server "[^"]+" tool "[^"]+" timed out after )/;
const mcpCalls = new Map(), transport = [];
for (const l of fs.readFileSync(events, "utf8").split("\n")) {
  if (!l.trim()) continue;
  let ev;
  try { ev = JSON.parse(l); } catch { unparsed++; continue; }
  if (ev.type === "system" && ev.subtype === "init" && !init) init = ev;
  if (ev.type === "result") result = ev;
  const blocks = Array.isArray(ev.message?.content) ? ev.message.content : [];
  if (ev.type === "assistant") for (const b of blocks) if (b?.type === "tool_use" && servers.length && mcpTool.test(b.name)) mcpCalls.set(b.id, b.name);
  if (ev.type === "user") for (const b of blocks) {
    if (b?.type !== "tool_result" || !b.is_error || !mcpCalls.has(b.tool_use_id)) continue;
    const text = typeof b.content === "string" ? b.content : (Array.isArray(b.content) ? b.content : []).map((c) => c?.text ?? "").join(" ");
    if (transportError.test(text.trim())) transport.push(mcpCalls.get(b.tool_use_id) + ": " + text.slice(0, 120));
  }
}
const version = init?.claude_code_version ?? null;
const mcp = Object.fromEntries((init?.mcp_servers ?? []).map((s) => [s.name, s.status]));
const down = servers.filter((n) => mcp[n] !== "connected");
let code = 0, detail = "";
if (!init) [code, detail] = [2, "no init record in the stream-json output (claude exit " + exitCode + ", " + unparsed + " unparsed lines)"];
else if (version !== pinned) [code, detail] = [2, "claude " + version + " is not the pinned " + pinned];
else if (down.length) [code, detail] = [2, "MCP server not connected: " + down.map((n) => n + " " + (mcp[n] ?? "absent")).join(", ")];
else if (transport.length) [code, detail] = [2, "MCP transport error: " + transport[0]];
else if (!result) [code, detail] = [2, "no result record (claude exit " + exitCode + ")"];
else if (result.is_error && (result.api_error_status != null || result.terminal_reason === "api_error")) [code, detail] = [3, "model error: API " + (result.api_error_status ?? "unreachable") + ": " + String(result.result ?? "").slice(0, 200)];
else if (result.is_error) [code, detail] = [2, "error result " + (result.subtype ?? "") + " " + (result.terminal_reason ?? "") + ": " + String(result.result ?? "").slice(0, 200)];
else if (exitCode !== "0") [code, detail] = [2, "claude exit " + exitCode];
fs.writeFileSync(replyPath, code === 0 ? String(result.result ?? "").trim() : "");
fs.writeFileSync(statusPath, JSON.stringify({ claude_exit: Number(exitCode), claude_code_version: version, mcp_servers: mcp, session_id: init?.session_id ?? null, model: init?.model ?? null,
  is_error: result?.is_error ?? null, api_error_status: result?.api_error_status ?? null, terminal_reason: result?.terminal_reason ?? null, num_turns: result?.num_turns ?? null, mcp_transport_errors: transport.length, unparsed }));
process.stdout.write(code + " " + (version ?? "unknown") + " " + detail.replace(/\s+/g, " "));
JS
)
  set -e
  turn_code=${line%% *}; line=${line#* }
  if [ -n "$hook_heartbeat" ]; then
    hook_ran=$(( $(hook_runs) - hook_before ))
    node -e 'const fs = require("fs"); const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); s.gbrain_turn_hook_runs = Number(process.argv[2]); fs.writeFileSync(process.argv[1], JSON.stringify(s));' "$prefix.status.json" "$hook_ran" \
      || log "session $key: could not add gbrain_turn_hook_runs to $prefix.status.json (the turn's output could not be read)"
    log "session $key: gbrain's UserPromptSubmit hook ran $hook_ran time(s) in this turn"
  fi
  log "session $key: the init record says claude-code ${line%% *}"
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
  run_turn "$HE_LOG_DIR/run" "$HE_WORKSPACE_DIR/instruction.md" "run:$HE_TRIAL_ID" "$HE_TIME_BUDGET_S" 60 "run:$HE_TRIAL_ID"
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

printf '{"harness":"claude-code","version":"%s","trial":"%s","ready_at":"%s","session_keys":"claude -p --session-id|--resume UUIDv5(dm:<member> | channel:<id>)","mcp_servers":"%s","adapter_sha256":"%s"%s}\n' \
  "$claude_version" "$HE_TRIAL_ID" "$(now)" "${mcp_servers[*]}" "$adapter_sha256" "$official_minimal_json$gbrain_install_json$route_json" > "$HE_LOG_DIR/ready.tmp"
mv "$HE_LOG_DIR/ready.tmp" "$HE_LOG_DIR/ready"
log "serve: ready; polling $HE_TURNS_DIR"
while [ "$stopping" -eq 0 ]; do
  for req in "$HE_TURNS_DIR"/turn-*.request.json; do
    [ -e "$req" ] || continue
    [ "$stopping" -eq 0 ] || break
    base=${req%.request.json}; name=$(basename "$base"); resp="$base.response.json"
    [ -e "$resp" ] && continue
    read -r turn budget key window_key < <(node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
let key = r.channel.type === "dm" ? "dm:" + r.actor.member : "channel:" + r.channel.id;
if (r.thread_ts) key += ":t" + r.thread_ts;
console.log([r.turn, r.time_budget_s || process.env.HE_TIME_BUDGET_S, key, r.channel.id + (r.thread_ts ? ":" + r.thread_ts : "")].join(" "));' "$req")
    node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).prompt)' "$req" > "$HE_LOG_DIR/turns/$name.prompt.md"
    log "turn $turn: session $key, budget ${budget}s"
    started=$(now)
    run_turn "$HE_LOG_DIR/turns/$name" "$HE_LOG_DIR/turns/$name.prompt.md" "$key" "$budget" 5 "$window_key"
    ended=$(now)
    write_response "$resp" "$turn" "$turn_code" "$HE_LOG_DIR/turns/$name.reply.txt" "$started" "$ended" "$turn_detail"
    log "turn $turn: exit $turn_code${turn_detail:+ ($turn_detail)}"
  done
  sleep 0.25
done
log "serve: stopped on signal"
exit 0
