// Family C wiring (owner identity, internal-task): what the claude-code and codex adapters run under HE_OI_CAPTURE_B64, before ready.
// Byte-identical in harnesses/claude-code/capture/ and harnesses/codex/capture/ (tests/owner-identity-capture-launch.test.ts).
//
// 1. gbrain's SessionEnd capture lane, in the shape `gbrain bootstrap harness` writes it (gbrain dbc45825): for Claude Code one
//    SessionEnd group in settings.json, `env GBRAIN_HOOK_LANE=harness <launcher> <gbrain> hook session-end`, timeout 60, marker
//    _gbrain bootstrap-harness-v1 (src/core/bootstrap/hooks.ts buildClaudeHookCommand, host-specs.ts); for Codex one SessionEnd
//    group in hooks.json, gbrain's detaching `sh -c` command, timeout 3, and its trust table in config.toml inside gbrain's managed
//    block (src/core/bootstrap/codex-hooks.ts buildCodexSessionEndCommand, codexTrustHash, writeCodexHooks). The gbrain binary and
//    hook launcher are the ones the gbrain installer view placed (HE_GBRAIN_INSTALL=gbrain-installer), so the hook is the same build.
// 2. The plan the launcher reads (capture/launch-workers.sh): harness, log-dir, workspace, worker.env (0600; the named variables the
//    harness's own turns carry, the per-trial proxy token and MCP bearers among them, never a provider key) and workers/<n>/brief.md
//    and workers/<n>/agent.
// 3. $HE_LOG_DIR/oi-capture.json: the hook, the workers by launch and brief sha256, and the variable names written (never values).
//
//   node wire-capture.cjs <claude-code|codex> <state dir> <harness config dir> <log dir> <capture dir> <workspace> [<mcp config>]
// with the plan in HE_OI_CAPTURE_B64. Prints "ok <hook file> <workers>" or "HE-ADAPTER-008 <reason>" and exits 2.
const fs = require("fs"), path = require("path"), crypto = require("crypto");

const LABEL_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const shellQuote = (a) => (/^[A-Za-z0-9_.:/@=-]+$/.test(a) ? a : "'" + a.replace(/'/g, "'\\''") + "'");
const canonical = (v) => Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v);

const claudeSessionEndCommand = (bin, launcher) => ["env", "GBRAIN_HOOK_LANE=harness", launcher, bin, "hook", "session-end"].map(shellQuote).join(" ");
function codexSessionEndCommand(bin, launcher) {
  const script = 't="$(mktemp)"; cat >"$t"; GBRAIN_PAYLOAD="$t" GBRAIN_HOOK_LAUNCHER="$0" GBRAIN_BIN="$1" nohup sh -c ' +
    "'\"$GBRAIN_HOOK_LAUNCHER\" \"$GBRAIN_BIN\" hook session-end --harness codex <\"$GBRAIN_PAYLOAD\"; rm -f \"$GBRAIN_PAYLOAD\"' >/dev/null 2>&1 &";
  return "sh -c '" + script.replace(/'/g, "'\\''") + "' " + [launcher, bin].map(shellQuote).join(" ");
}
const codexTrustHash = (command, timeout) => "sha256:" + sha(canonical({ event_name: "session_end", hooks: [{ type: "command", command, timeout, async: false }] }));
const TRUST_BEGIN = "# --- gbrain:codex-hooks-trust (managed block — do not edit; gbrain bootstrap rewrites it) ---";
const TRUST_END = "# --- /gbrain:codex-hooks-trust ---";
const CODEX_DESCRIPTION = 'gbrain session-end capture — the SessionEnd entry whose command mentions "gbrain" is managed by `gbrain bootstrap` (re-runs rewrite it; `gbrain bootstrap uninstall` deletes it)';

/** The variables a worker gets from worker.env: what the adapter exports for its own turns. */
const ENV_NAMES = {
  "claude-code": ["HOME", "PATH", "CLAUDE_CONFIG_DIR", "TMPDIR", "CLAUDE_TMPDIR", "HE_MODEL_NAME", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "MCP_CONNECTION_NONBLOCKING", "DISABLE_AUTOUPDATER", "DISABLE_TELEMETRY", "DISABLE_ERROR_REPORTING"],
  codex: ["HOME", "PATH", "CODEX_HOME", "TMPDIR", "HE_MODEL_NAME", "HE_MODEL_API_KEY", "HE_WORLD_MCP_URL", "HE_WORLD_MCP_TOKEN", "HE_GBRAIN_MCP_URL", "HE_GBRAIN_MCP_TOKEN"],
};
const ENV_PREFIXES = { "claude-code": /^(ANTHROPIC_(MODEL|DEFAULT_[A-Z]+_MODEL|DEFAULT_MODEL|SMALL_FAST_MODEL)|CLAUDE_CODE_[A-Z_]+)$/, codex: null };

class Refusal extends Error {}
const refuse = (msg) => { throw new Refusal(msg); };

function parsePlan(b64) {
  if (!b64) refuse("HE_OI_CAPTURE_B64 is empty");
  let plan;
  try { plan = JSON.parse(Buffer.from(b64, "base64").toString("utf8")); } catch { refuse("HE_OI_CAPTURE_B64 is not base64 JSON"); }
  if (plan?.schema_version !== 1 || !Array.isArray(plan.workers) || plan.workers.length < 1) refuse("the capture plan has no workers");
  for (const w of plan.workers) {
    if (!Number.isInteger(w.n) || w.n < 1 || typeof w.brief !== "string" || !w.brief.trim()) refuse("worker " + JSON.stringify(w.n) + " has no number or brief");
    if (w.launch === "env" ? !(typeof w.agent === "string" && LABEL_RE.test(w.agent) && w.agent !== "off" && w.agent !== "owner") : !(w.launch === "detected" && w.agent === null)) refuse("worker " + w.n + " has launch " + w.launch + " with agent " + JSON.stringify(w.agent));
  }
  return plan;
}

function wireClaude(configDir, bin, launcher) {
  const file = path.join(configDir, "settings.json");
  const s = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const hooks = s.hooks ?? {};
  if ((hooks.SessionEnd ?? []).some((g) => (g.hooks ?? []).some((h) => String(h.command ?? "").includes("hook session-end")))) refuse(file + " already has a gbrain SessionEnd hook");
  const command = claudeSessionEndCommand(bin, launcher);
  s.hooks = { ...hooks, SessionEnd: [...(hooks.SessionEnd ?? []), { hooks: [{ type: "command", command, timeout: 60, _gbrain: "bootstrap-harness-v1" }] }] };
  fs.writeFileSync(file + ".tmp", JSON.stringify(s, null, 2) + "\n");
  fs.renameSync(file + ".tmp", file);
  return { file, event: "SessionEnd", command, timeout: 60 };
}

function wireCodex(codexHome, bin, launcher) {
  const file = path.join(codexHome, "hooks.json"), config = path.join(codexHome, "config.toml");
  const doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const hooks = doc.hooks ?? {};
  if ((hooks.SessionEnd ?? []).some((g) => (g.hooks ?? []).some((h) => String(h.command ?? "").includes("hook session-end")))) refuse(file + " already has a gbrain SessionEnd hook");
  const text = fs.existsSync(config) ? fs.readFileSync(config, "utf8") : "";
  if (text.includes(TRUST_BEGIN)) refuse(config + " already holds gbrain's codex-hooks-trust block");
  const command = codexSessionEndCommand(bin, launcher);
  const group = (hooks.SessionEnd ?? []).length;
  const next = { ...doc, ...(doc.description === undefined ? { description: CODEX_DESCRIPTION } : {}), hooks: { ...hooks, SessionEnd: [...(hooks.SessionEnd ?? []), { hooks: [{ type: "command", command, timeout: 3 }] }] } };
  const trustKey = file + ":session_end:" + group + ":0";
  const lines = text.split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const block = [TRUST_BEGIN, "[hooks.state." + JSON.stringify(trustKey) + "]", "trusted_hash = " + JSON.stringify(codexTrustHash(command, 3)), TRUST_END];
  fs.writeFileSync(file + ".tmp", JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(file + ".tmp", file);
  fs.writeFileSync(config + ".tmp", [...(lines.length ? [...lines, ""] : []), ...block, ""].join("\n"));
  fs.renameSync(config + ".tmp", config);
  return { file, event: "SessionEnd", command, timeout: 3, trust_key: trustKey, trusted_hash: codexTrustHash(command, 3) };
}

/** The worker.env text: `export NAME='value'` for each named variable that is set, in a fixed order. */
function workerEnv(harness, env) {
  const prefix = ENV_PREFIXES[harness];
  const names = [...ENV_NAMES[harness], ...(prefix ? Object.keys(env).filter((k) => prefix.test(k)).sort() : [])].filter((k, i, xs) => xs.indexOf(k) === i && env[k] !== undefined);
  return { names, text: names.map((k) => "export " + k + "=" + "'" + String(env[k]).replace(/'/g, "'\\''") + "'").join("\n") + "\n" };
}

function writePlan(o) {
  fs.rmSync(o.capDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(o.capDir, "workers"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(o.capDir, "harness"), o.harness + "\n");
  fs.writeFileSync(path.join(o.capDir, "log-dir"), o.logDir + "\n");
  fs.writeFileSync(path.join(o.capDir, "workspace"), o.workspace + "\n");
  const env = workerEnv(o.harness, { ...o.env, ...(o.mcpConfig ? { HE_OI_MCP_CONFIG: o.mcpConfig } : {}) });
  if (o.mcpConfig && !env.names.includes("HE_OI_MCP_CONFIG")) env.names.push("HE_OI_MCP_CONFIG");
  const envText = o.mcpConfig ? env.text + "export HE_OI_MCP_CONFIG=" + shellQuote(o.mcpConfig) + "\n" : env.text;
  fs.writeFileSync(path.join(o.capDir, "worker.env"), envText, { mode: 0o600 });
  for (const w of o.plan.workers) {
    const d = path.join(o.capDir, "workers", String(w.n));
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "brief.md"), w.brief + "\n");
    fs.writeFileSync(path.join(d, "agent"), w.agent ?? "");
  }
  return env.names;
}

function wire(argv, env) {
  const [harness, state, configDir, logDir, capDir, workspace, mcpConfig] = argv;
  const rec = { status: "error", code: "HE-ADAPTER-008", harness, task: null, hook: null, workers: [], launcher: null, capture_dir: capDir, corpus_dir: path.join(state ?? "", ".gbrain/transcripts/corpus"), worker_env_names: [], error: null };
  try {
    if (harness !== "claude-code" && harness !== "codex") refuse("harness " + harness + " has no family C capture route");
    const plan = parsePlan(env.HE_OI_CAPTURE_B64);
    rec.task = plan.task ?? null;
    const bin = path.join(state, ".local/bin/gbrain"), launcher = path.join(state, ".gbrain/hook-launcher/gbrain-hook");
    if (!fs.existsSync(bin) || !fs.existsSync(launcher)) refuse("no gbrain binary or hook launcher under " + state + "; a family C cell needs gbrain.install gbrain-installer, which places both");
    if (harness === "claude-code" && !mcpConfig) refuse("no --mcp-config file for the claude-code workers");
    const script = path.join(__dirname, "launch-workers.sh");
    if (!fs.existsSync(script)) refuse("no launcher at " + script);
    rec.launcher = { path: script, sha256: sha(fs.readFileSync(script)) };
    rec.hook = harness === "claude-code" ? wireClaude(configDir, bin, launcher) : wireCodex(configDir, bin, launcher);
    rec.worker_env_names = writePlan({ harness, plan, capDir, logDir, workspace, mcpConfig, env });
    rec.workers = plan.workers.map((w) => ({ n: w.n, launch: w.launch, agent: w.agent, brief_sha256: sha(w.brief + "\n") }));
    Object.assign(rec, { status: "ok", code: null });
  } catch (e) {
    rec.error = e instanceof Refusal ? e.message : "the capture wiring failed: " + e.message;
  }
  if (logDir) { fs.mkdirSync(logDir, { recursive: true }); fs.writeFileSync(path.join(logDir, "oi-capture.json"), JSON.stringify(rec, null, 1) + "\n"); }
  return rec;
}

module.exports = { claudeSessionEndCommand, codexSessionEndCommand, codexTrustHash, workerEnv, wire, TRUST_BEGIN, TRUST_END };
if (require.main === module) {
  const rec = wire(process.argv.slice(2), process.env);
  if (rec.status !== "ok") { console.log("HE-ADAPTER-008 " + rec.error); process.exit(2); }
  console.log("ok " + rec.hook.file + " " + rec.workers.length);
}
