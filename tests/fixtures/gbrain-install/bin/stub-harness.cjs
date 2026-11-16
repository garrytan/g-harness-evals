#!/usr/bin/env node
// A stand-in for the claude, codex, openclaw and hermes CLIs in install mode (HE_INSTALL_MODE=1), for
// tests/gbrain-install-adapters.test.ts. The wrappers beside it (claude, codex, openclaw, hermes) exec it with their own name. It
// never calls a model. --version prints each CLI's version line for STUB_VERSION. A turn reads its prompt (stdin for claude and
// codex, the message file for openclaw, the query file for hermes), runs every line "run: <command>" in an agent shell (sh -c in
// the working directory, with the environment the real harness gives its shell tool) and answers with their output, in the
// harness's own output format, keeping a session the next turn of the same key resumes. Each turn appends one JSON line to
// STUB_LOG: harness, args, cwd, session (id, new), seen (the gbrain wiring the harness would load at session start: MCP server
// names, and whether its instruction files mention gbrain), credential (where the proxy token reached the harness and whether it
// equals the token in STUB_TOKEN_FILE), harness_env and shell_env (which of HE_MODEL_API_KEY, HE_MODEL_API_KEY_FILE,
// ANTHROPIC_API_KEY and OPENAI_API_KEY are set, and token: whether any variable holds the token) and commands (each command and its
// exit code). The token is never printed or logged.
//   claude    the key comes from settings.json apiKeyHelper (run through /bin/sh); sessions are transcripts under
//             CLAUDE_CONFIG_DIR/projects/<cwd>/<id>.jsonl, and a --session-id already held or a --resume not held is refused
//   codex     the key is the environment variable config.toml's env_key names; the shell drops every variable matching
//             [shell_environment_policy] exclude (case-insensitive globs); threads are CODEX_HOME/sessions/<id>.jsonl
//   openclaw  the key is a quoted string in OPENCLAW_CONFIG_PATH (JSON5); the session store is OPENCLAW_STATE_DIR/agents/main/agent/
//             openclaw-agent.sqlite, table transcript_events (session_id, seq, created_at, event_json, event_zstd), tool results
//             stored zstd-compressed in event_zstd as OpenClaw does for large events
//   hermes    the key is HERMES_HOME/.env (ANTHROPIC_API_KEY, or OPENAI_API_KEY off the anthropic provider), loaded into the
//             process as Hermes does; the shell drops the provider variables Hermes strips; sessions are HERMES_HOME/sessions/<key>.json
//             (the key's session id) and rows in HERMES_HOME/state.db (sessions and messages at the pinned schema); a stream-json
//             tool_result is cut at 5,000 characters as Hermes cuts it, the messages row keeps the whole result, and a result over
//             STUB_HERMES_SPILL_CHARS (100,000) goes to HERMES_HOME/cache/spillover/<call id>.txt behind a <persisted-output> block
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto"), cp = require("child_process"), zlib = require("zlib");
const [harness, ...args] = process.argv.slice(2);
const env = process.env;
const v = env.STUB_VERSION || "0.0.0";
const versions = { claude: v + " (Claude Code)", codex: "codex-cli " + v, openclaw: "OpenClaw " + v, hermes: "Hermes Agent " + v };
if (args[0] === "--version") { console.log(versions[harness]); process.exit(0); }
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const fail = (msg) => { console.error(msg); process.exit(1); };
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const fileMode = (p) => { try { return (fs.statSync(p).mode & 0o777).toString(8); } catch { return null; } };
const mentions = (...files) => files.some((f) => /gbrain/i.test(read(f)));
const token = read(env.STUB_TOKEN_FILE).trim();
const NAMES = ["HE_MODEL_API_KEY", "HE_MODEL_API_KEY_FILE", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];
const presence = (e) => Object.assign(Object.fromEntries(NAMES.map((n) => [n, !!e[n]])), { token: !!token && Object.values(e).some((x) => String(x).includes(token)) });

function claude() {
  const cfg = env.CLAUDE_CONFIG_DIR;
  const flag = args.includes("--resume") ? "--resume" : "--session-id";
  const sid = opt(flag);
  const dir = path.join(cfg, "projects", process.cwd().replace(/[^a-zA-Z0-9]/g, "-"));
  const transcript = path.join(dir, sid + ".jsonl");
  if (flag === "--session-id" && fs.existsSync(transcript)) fail("Error: Session ID " + sid + " is already in use.");
  if (flag === "--resume" && !fs.existsSync(transcript)) fail("No conversation found with session ID: " + sid);
  const settings = JSON.parse(read(path.join(cfg, "settings.json")) || "{}");
  let helped = "";
  if (settings.apiKeyHelper) { try { helped = cp.execFileSync("/bin/sh", ["-c", settings.apiKeyHelper], { encoding: "utf8" }).trim(); } catch {} }
  const mcp = Object.keys(JSON.parse(read(path.join(cfg, ".claude.json")) || "{}").mcpServers || {});
  const prompt = fs.readFileSync(0, "utf8");
  return {
    prompt, shellEnv: { ...env },
    session: { id: sid, new: flag === "--session-id" },
    seen: { mcp_servers: mcp, instructions: mentions(path.join(cfg, "CLAUDE.md"), path.join(process.cwd(), "CLAUDE.md")) },
    credential: { channel: "apiKeyHelper", helper: settings.apiKeyHelper ?? null, match: !!token && helped === token },
    answer(reply, commands) {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(transcript, JSON.stringify({ type: "user", prompt }) + "\n");
      out({ type: "system", subtype: "init", cwd: process.cwd(), session_id: sid, tools: ["Bash"], mcp_servers: mcp.map((name) => ({ name, status: "connected" })),
        model: opt("--model"), permissionMode: "bypassPermissions", apiKeySource: settings.apiKeyHelper ? "apiKeyHelper" : "none", claude_code_version: v });
      commands.forEach((c, i) => {
        out({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_" + i, name: "Bash", input: { command: c.command } }] } });
        out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_" + i, content: c.output, is_error: c.exit !== 0 }] } });
      });
      out({ type: "result", subtype: "success", is_error: false, result: reply, num_turns: 1 + commands.length, session_id: sid });
    },
  };
}

function codex() {
  const home = env.CODEX_HOME;
  const config = read(path.join(home, "config.toml"));
  const resume = args[1] === "resume" ? args[2] : null;
  const sessions = path.join(home, "sessions");
  if (resume && !fs.existsSync(path.join(sessions, resume + ".jsonl"))) fail("Error: thread " + resume + " not found");
  const id = resume || crypto.randomUUID();
  let section = "", excludes = [];
  for (const line of config.split("\n")) {
    const s = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (s) { section = s[1].trim(); continue; }
    const e = line.match(/^\s*exclude\s*=\s*(\[.*\])\s*$/);
    if (section === "shell_environment_policy" && e) excludes = JSON.parse(e[1]);
  }
  const globs = excludes.map((g) => new RegExp("^" + g.replace(/[.+^$()|{}\[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i"));
  const envKey = (config.match(/^\s*env_key\s*=\s*"([^"]+)"/m) || [])[1] || null;
  const prompt = fs.readFileSync(0, "utf8");
  return {
    prompt, shellEnv: Object.fromEntries(Object.entries(env).filter(([k]) => !globs.some((g) => g.test(k)))),
    session: { id, new: !resume },
    seen: { mcp_servers: [...config.matchAll(/^\s*\[mcp_servers\.([^\]]+)\]/gm)].map((m) => m[1].replace(/"/g, "")),
      instructions: mentions(path.join(home, "AGENTS.md"), path.join(process.cwd(), "AGENTS.md")) },
    credential: { channel: "env_key " + envKey, excludes, match: !!token && !!envKey && env[envKey] === token },
    answer(reply, commands) {
      fs.mkdirSync(sessions, { recursive: true });
      fs.appendFileSync(path.join(sessions, id + ".jsonl"), JSON.stringify({ type: "user", prompt }) + "\n");
      out({ type: "thread.started", thread_id: id });
      out({ type: "turn.started" });
      commands.forEach((c, i) => out({ type: "item.completed", item: { id: "item_" + i, type: "command_execution", command: c.command, aggregated_output: c.output, exit_code: c.exit, status: "completed" } }));
      out({ type: "item.completed", item: { id: "item_reply", type: "agent_message", text: reply } });
      out({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } });
    },
  };
}

function openclaw() {
  const state = env.OPENCLAW_STATE_DIR, configPath = env.OPENCLAW_CONFIG_PATH;
  const key = opt("--session-key");
  const conf = read(configPath);
  const index = path.join(state, "agents", "main", "sessions", "sessions.json");
  const known = JSON.parse(read(index) || "{}");
  const id = known[key] || crypto.randomUUID();
  const prompt = read(opt("--message-file"));
  return {
    prompt, shellEnv: { ...env },
    session: { id, new: !known[key] },
    seen: { mcp_servers: /["']?gbrain["']?\s*:\s*\{/.test(conf) ? ["gbrain"] : [], instructions: mentions(path.join(env.HE_WORKSPACE_DIR || process.cwd(), "AGENTS.md")) },
    credential: { channel: "openclaw.json", mode: fileMode(configPath), match: !!token && conf.includes(JSON.stringify(token)) },
    answer(reply, commands) {
      fs.mkdirSync(path.dirname(index), { recursive: true });
      known[key] = id;
      fs.writeFileSync(index, JSON.stringify(known));
      const dbDir = path.join(state, "agents", "main", "agent");
      fs.mkdirSync(dbDir, { recursive: true });
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(path.join(dbDir, "openclaw-agent.sqlite"));
      db.exec("create table if not exists transcript_events (session_id text not null, seq integer not null, created_at integer, event_json text, event_zstd blob, primary key (session_id, seq))");
      let seq = Number(db.prepare("select coalesce(max(seq), -1) as m from transcript_events where session_id = ?").get(id).m);
      const put = (event, zstd) => {
        const json = JSON.stringify(event);
        db.prepare("insert into transcript_events (session_id, seq, created_at, event_json, event_zstd) values (?, ?, ?, ?, ?)")
          .run(id, ++seq, Date.now(), zstd ? null : json, zstd ? zlib.zstdCompressSync(Buffer.from(json)) : null);
      };
      put({ type: "message", message: { role: "user", content: prompt } });
      commands.forEach((c, i) => {
        put({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call_" + seq + "_" + i, name: "exec", arguments: { command: c.command } }], stopReason: "toolUse" } });
        put({ type: "message", message: { role: "toolResult", toolCallId: "call_" + (seq - 1) + "_" + i, toolName: "exec", content: [{ type: "text", text: c.output }], isError: false, details: { exitCode: c.exit } } }, true);
      });
      put({ type: "message", message: { role: "assistant", content: [{ type: "text", text: reply }], stopReason: "stop" } });
      db.close();
      process.stdout.write(JSON.stringify({ payloads: [{ text: reply, mediaUrl: null }], meta: { durationMs: 1, agentMeta: { sessionId: id }, stopReason: "stop" } }, null, 2) + "\n");
    },
  };
}

// The sessions and messages tables of HERMES_HOME/state.db as SCHEMA_SQL declares them at the Hermes pin
// (hermes_state_common.py at f97608f1).
const HERMES_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, session_key TEXT, chat_id TEXT, chat_type TEXT,",
  " thread_id TEXT, display_name TEXT, origin_json TEXT, expiry_finalized INTEGER DEFAULT 0, model TEXT, model_config TEXT, system_prompt TEXT,",
  " system_prompt_hash TEXT, parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, end_reason TEXT, message_count INTEGER DEFAULT 0,",
  " tool_call_count INTEGER DEFAULT 0, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0,",
  " cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0, cwd TEXT, git_branch TEXT, git_repo_root TEXT,",
  " git_metadata_generation INTEGER NOT NULL DEFAULT 0, billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT, estimated_cost_usd REAL,",
  " actual_cost_usd REAL, cost_status TEXT, cost_source TEXT, pricing_version TEXT, title TEXT, title_source TEXT, last_activity_at REAL,",
  " last_activity_description TEXT, last_activity_provenance TEXT, api_call_count INTEGER DEFAULT 0, handoff_state TEXT, handoff_platform TEXT,",
  " handoff_error TEXT, compression_failure_cooldown_until REAL, compression_failure_error TEXT, compression_fallback_streak INTEGER NOT NULL DEFAULT 0,",
  " compression_ineffective_count INTEGER NOT NULL DEFAULT 0, compression_recovery_deadline REAL, profile_name TEXT, transport_profile TEXT,",
  " rewind_count INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,",
  " last_read_at REAL, tool_names TEXT, FOREIGN KEY (parent_session_id) REFERENCES sessions(id));",
  "CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id), role TEXT NOT NULL,",
  " content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, effect_disposition TEXT, timestamp REAL NOT NULL, token_count INTEGER,",
  " finish_reason TEXT, reasoning TEXT, reasoning_content TEXT, reasoning_details TEXT, codex_reasoning_items TEXT, codex_message_items TEXT,",
  " platform_message_id TEXT, observed INTEGER DEFAULT 0, _compressed_summary INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,",
  " compacted INTEGER NOT NULL DEFAULT 0, api_content TEXT, display_kind TEXT, display_metadata TEXT, display_identity BLOB, display_order INTEGER);",
].join("");

function hermes() {
  const home = env.HERMES_HOME;
  const key = opt("--continue");
  const dotenv = Object.fromEntries(read(path.join(home, ".env")).split("\n").map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  const keyVar = opt("--provider") === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const harnessEnv = { ...env, ...dotenv };
  const blocked = new Set(["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENROUTER_API_KEY"]);
  const config = read(path.join(home, "config.yaml"));
  const mcpBlock = (config.match(/^mcp_servers:\n((?:[ \t]+.*\n?|\n)*)/m) || [])[1] || "";
  const sessionFile = path.join(home, "sessions", String(key).replace(/[^A-Za-z0-9_.-]/g, "_") + ".json");
  const prior = JSON.parse(read(sessionFile) || "null");
  if (key && !prior && !args.includes("--create-if-missing")) fail("no session " + key);
  const prompt = read(opt("--query-file"));
  return {
    prompt, harnessEnv, shellEnv: Object.fromEntries(Object.entries(harnessEnv).filter(([k]) => !blocked.has(k))),
    session: { id: key, new: !prior },
    seen: { mcp_servers: [...mcpBlock.matchAll(/^  ([A-Za-z0-9_-]+):/gm)].map((m) => m[1]), instructions: mentions(path.join(home, "SOUL.md")) },
    credential: { channel: ".env " + keyVar, mode: fileMode(path.join(home, ".env")), match: !!token && dotenv[keyVar] === token },
    answer(reply, commands) {
      fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
      const id = (prior && prior.id) || "20261115_000000_" + crypto.randomBytes(3).toString("hex");
      fs.writeFileSync(sessionFile, JSON.stringify({ key, id, turns: ((prior && prior.turns) || 0) + 1 }));
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(path.join(home, "state.db"));
      db.exec("PRAGMA journal_mode=WAL");
      db.exec(HERMES_SCHEMA);
      const now = Date.now() / 1000;
      if (!prior) db.prepare("insert into sessions (id, source, model, started_at, title) values (?, 'cli', ?, ?, ?)").run(id, opt("--model") || null, now, key);
      const row = db.prepare("insert into messages (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp, finish_reason) values (?, ?, ?, ?, ?, ?, ?, ?)");
      row.run(id, "user", prompt, null, null, null, now, null);
      const spillAt = Number(env.STUB_HERMES_SPILL_CHARS || 100000);
      commands.forEach((c, i) => {
        const callId = "call_" + crypto.randomBytes(4).toString("hex");
        const result = JSON.stringify({ output: c.output, exit_code: c.exit, error: null });
        let stored = result;
        if (result.length > spillAt) {
          const dir = path.join(home, "cache", "spillover");
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, callId + ".txt"), result);
          const preview = result.slice(0, 1500);
          stored = "<persisted-output>\nThis tool result was too large (" + result.length + " characters).\nFull output saved to: " + path.join(dir, callId + ".txt") +
            "\nUse the read_file tool with offset and limit to access specific sections of this output.\n\nPreview (first 1500 chars):\n" + preview + "\n...\n</persisted-output>";
        }
        row.run(id, "assistant", "", null, JSON.stringify([{ id: callId, type: "function", function: { name: "terminal", arguments: JSON.stringify({ command: c.command }) } }]), null, now, "tool_calls");
        row.run(id, "tool", stored, callId, null, "terminal", now, null);
        out({ type: "tool_use", name: "terminal", tool_call_id: callId, input: { command: c.command } });
        out({ type: "tool_result", name: "terminal", tool_call_id: callId, output: result.length <= 5000 ? result : result.slice(0, 5000) + "...", duration_ms: 1, is_error: false });
      });
      row.run(id, "assistant", reply, null, null, null, now, "stop");
      db.close();
      out({ type: "result", session_id: id, exit_code: 0, text: reply, tokens: { input: 1, output: 1, total: 2, cache_read: 0, cache_write: 0 }, duration_ms: 1 });
    },
  };
}

const t = { claude, codex, openclaw, hermes }[harness]();
const commands = [];
for (const m of t.prompt.matchAll(/^run: (.+)$/gm)) {
  const r = cp.spawnSync("/bin/sh", ["-c", m[1]], { cwd: process.cwd(), env: t.shellEnv, encoding: "utf8" });
  commands.push({ command: m[1], exit: r.status, output: ((r.stdout || "") + (r.stderr || "")).trim() });
}
const reply = commands.length ? commands.map((c) => c.output).join("\n") : "ok";
if (env.STUB_LOG) fs.appendFileSync(env.STUB_LOG, JSON.stringify({ harness, args, cwd: process.cwd(), session: t.session, seen: t.seen, credential: t.credential,
  harness_env: presence(t.harnessEnv || env), shell_env: presence(t.shellEnv), commands: commands.map((c) => ({ command: c.command, exit: c.exit })) }) + "\n");
t.answer(reply, commands);
