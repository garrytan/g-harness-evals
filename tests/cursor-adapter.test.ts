// The Cursor CLI harness (harnesses/cursor), keyless, at the process level: adapter.sh runs in temp directories with a
// stand-in agent CLI on PATH (tests/fixtures/cursor/bin/agent) under a scrubbed environment, stdin closed. It covers the
// turn flags, the exit mapping, resume per conversation, the refusals (HE-CURSOR-001, -002, -004), the MCP config, the
// redaction of the key's value from every log and the tool audit (hooks log and web-tool-audit.ts). The key is a canary made here; no real key is read.
// The container path (image, egress allowlist, offline trial) is scripts/cursor/install-check.sh.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { auditTrial, main as webToolAudit } from '../scripts/cursor/web-tool-audit.ts';

const ROOT = resolve(import.meta.dir, '..');
const DIR = join(ROOT, 'harnesses/cursor');
const ADAPTER = join(DIR, 'adapter.sh');
const PIN = JSON.parse(readFileSync(join(DIR, 'pin.json'), 'utf8')) as { version: string; model_cursor: { model_id: string; turn_model: string; init_model_name: string } };
const NODE = Bun.which('node');
const PATH = [join(ROOT, 'tests/fixtures/cursor/bin'), ...(NODE ? [dirname(NODE)] : []), '/usr/local/bin', '/usr/bin', '/bin'].join(':');
const CANARY = 'he-test-canary-' + crypto.randomUUID();

interface Trial { dir: string; workspace: string; state: string; logs: string; turns: string; stubLog: string }
function trial(instruction = 'Say hello.'): Trial {
  const dir = mkdtempSync(join(tmpdir(), 'he-cursor-'));
  const t = { dir, workspace: join(dir, 'workspace'), state: join(dir, 'state'), logs: join(dir, 'logs'), turns: join(dir, 'turns'), stubLog: join(dir, 'stub.ndjson') };
  for (const d of [t.workspace, t.state, t.logs, t.turns]) mkdirSync(d);
  writeFileSync(join(t.workspace, 'instruction.md'), instruction);
  return t;
}
function env(t: Trial, extra: Record<string, string | undefined> = {}): Record<string, string> {
  const e: Record<string, string | undefined> = { PATH, HE_WORKSPACE_DIR: t.workspace, HE_SESSION_STATE_DIR: t.state, HE_LOG_DIR: t.logs, HE_TURNS_DIR: t.turns,
    HE_MODEL_NAME: PIN.model_cursor.model_id, HE_TIME_BUDGET_S: '20', HE_TRIAL_ID: 'cursor-test', STUB_LOG: t.stubLog, CURSOR_API_KEY: CANARY, ...extra };
  return Object.fromEntries(Object.entries(e).filter((x): x is [string, string] => x[1] !== undefined));
}
const run = (t: Trial, extra: Record<string, string | undefined> = {}) => spawnSync('bash', [ADAPTER, 'run'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: env(t, extra), timeout: 60_000 });
const calls = (t: Trial) => (existsSync(t.stubLog) ? readFileSync(t.stubLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { args: string[]; home: string; key_set: boolean }) : []);
const log = (t: Trial) => (existsSync(join(t.logs, 'adapter.log')) ? readFileSync(join(t.logs, 'adapter.log'), 'utf8') : '');
const files = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : [join(d, n)]));

describe.skipIf(!NODE)('cursor adapter, run', () => {
  test('one turn: exit 0, the pinned flags and model, HOME is the state directory, the key reaches the CLI, the reply is printed', () => {
    const t = trial();
    const r = run(t);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('stub reply');
    const [c] = calls(t);
    expect(c!.key_set).toBe(true);
    expect(c!.home).toBe(t.state);
    for (const f of ['-p', '--force', '--trust', '--approve-mcps', '--disable-auto-update']) expect(c!.args).toContain(f);
    expect(c!.args).not.toContain('--exclude-tools');
    expect(c!.args.slice(c!.args.indexOf('--output-format'), c!.args.indexOf('--output-format') + 2)).toEqual(['--output-format', 'stream-json']);
    expect(c!.args[c!.args.indexOf('--model') + 1]).toBe(PIN.model_cursor.turn_model);
    expect(c!.args.at(-1)).toBe('Say hello.');
    const status = JSON.parse(readFileSync(join(t.logs, 'run.status.json'), 'utf8'));
    expect(status.model).toBe(PIN.model_cursor.init_model_name);
    expect(status.usage).toBeNull();
    const cfg = JSON.parse(readFileSync(join(t.state, '.cursor', 'cli-config.json'), 'utf8'));
    expect(cfg.permissions.deny).toContain('WebFetch(*)');
    expect(cfg.autoAcceptWebSearch).toBe(false);
    const hooks = JSON.parse(readFileSync(join(t.state, '.cursor', 'hooks.json'), 'utf8'));
    expect(Object.keys(hooks.hooks).sort()).toEqual(['postToolUse', 'postToolUseFailure']);
    expect(hooks.hooks.postToolUse[0].command).toContain(join(t.logs, 'tool-hooks.ndjson'));
    expect(readFileSync(join(t.logs, 'tool-hooks.ndjson'), 'utf8')).toBe('');
  });

  test('exit mapping: unreachable backend 3, crash 2, another model 2, over the budget 124', () => {
    const cases: Array<[string, number, Record<string, string>]> = [['[stub:unreachable]', 3, {}], ['[stub:crash]', 2, {}], ['[stub:other-model]', 2, {}], ['[stub:sleep 5]', 124, { HE_TIME_BUDGET_S: '1' }]];
    for (const [marker, code, extra] of cases) {
      const t = trial('go ' + marker);
      const r = run(t, extra);
      expect(r.status, marker + ' ' + log(t)).toBe(code);
    }
  }, 60_000);

  test('refusals before the CLI runs: another model (HE-CURSOR-001), no key (HE-CURSOR-002), an instruction file (HE-CURSOR-004), another CLI version', () => {
    const other = trial();
    expect(run(other, { HE_MODEL_NAME: 'claude-sonnet-5-5' }).status).toBe(2);
    expect(log(other)).toContain('HE-CURSOR-001');
    const keyless = trial();
    expect(run(keyless, { CURSOR_API_KEY: undefined }).status).toBe(2);
    expect(log(keyless)).toContain('HE-CURSOR-002');
    const seeded = trial();
    mkdirSync(join(seeded.workspace, 'docs'));
    writeFileSync(join(seeded.workspace, 'docs', 'AGENTS.md'), 'be brief');
    expect(run(seeded).status).toBe(2);
    expect(log(seeded)).toContain('HE-CURSOR-004');
    expect(JSON.parse(readFileSync(join(seeded.logs, 'instruction-files.json'), 'utf8')).found).toEqual([join(seeded.workspace, 'docs', 'AGENTS.md')]);
    const old = trial();
    expect(run(old, { STUB_AGENT_VERSION: '2026.01.01-0000000' }).status).toBe(2);
    for (const t of [other, keyless, seeded, old]) expect(calls(t)).toEqual([]);
  });

  test('the key value printed by the CLI on stdout and stderr is in no file under the log directory', () => {
    const t = trial('show env [stub:leak]');
    const r = run(t);
    expect(r.status, log(t)).toBe(0);
    for (const f of files(t.logs)) expect(readFileSync(f, 'utf8'), f).not.toContain(CANARY);
    expect(readFileSync(join(t.logs, 'run.cursor.jsonl'), 'utf8')).toContain('[redacted:CURSOR_API_KEY]');
    expect(readFileSync(join(t.logs, 'run.stderr.log'), 'utf8')).toContain('leaked [redacted:CURSOR_API_KEY]');
    expect(r.stdout + r.stderr).not.toContain(CANARY);
  });

  test('the tool audit: hook lines name each tool, a tool outside the documented values, a call the hooks missed and a denied host are flagged', () => {
    const asTrial = (t: Trial) => {
      const trialDir = mkdtempSync(join(tmpdir(), 'he-cursor-audit-'));
      mkdirSync(join(trialDir, 'logs'), { recursive: true });
      for (const f of ['run.status.json', 'tool-hooks.ndjson']) writeFileSync(join(trialDir, 'logs', f), readFileSync(join(t.logs, f)));
      return trialDir;
    };
    const documented = trial('read it [stub:tool MCP:post_message]');
    expect(run(documented).status).toBe(0);
    const line = JSON.parse(readFileSync(join(documented.logs, 'tool-hooks.ndjson'), 'utf8').trim());
    expect(Object.keys(line).sort()).toEqual(['at', 'event', 'tool_name']);
    expect(line).toMatchObject({ event: 'postToolUse', tool_name: 'MCP:post_message' });
    expect(auditTrial(asTrial(documented)).flags).toEqual([]);
    const other = trial('look it up [stub:tool ExampleUndocumentedTool]');
    expect(run(other).status).toBe(0);
    expect(auditTrial(asTrial(other)).flags).toEqual(['tool ExampleUndocumentedTool x1']);
    const missed = trial('read [stub:nohook]');
    expect(run(missed).status).toBe(0);
    expect(JSON.parse(readFileSync(join(missed.logs, 'run.status.json'), 'utf8'))).toMatchObject({ tool_calls_started: 1, tool_calls: { readToolCall: 1 } });
    expect(auditTrial(asTrial(missed)).flags).toEqual(['1 tool calls in the stream, none in the hook log']);
    const runDir = mkdtempSync(join(tmpdir(), 'he-cursor-audit-run-'));
    const jsonl = join(runDir, 'trials.jsonl');
    const row = (id: string, dir: string) => JSON.stringify({ trial_id: id, harness: 'cursor', paths: { dir } });
    writeFileSync(jsonl, row('r/c/t/r1', asTrial(documented)) + '\n');
    expect(webToolAudit([jsonl])).toBe(0);
    writeFileSync(join(runDir, 'egress.ndjson'), [{ trial: 'r/c/t/r1', decision: 'deny', host: 'api3.cursor.sh', port: 443 }, { trial: 'r/c/t/r1', decision: 'deny', host: 'search.example', port: 443 }].map((d) => JSON.stringify(d)).join('\n') + '\n');
    expect(auditTrial(asTrial(documented), ['search.example:443']).flags).toEqual(['egress denied search.example:443']);
    expect(webToolAudit([jsonl])).toBe(1);
    writeFileSync(join(runDir, 'egress.ndjson'), '');
    writeFileSync(jsonl, row('r/c/t/r2', asTrial(other)) + '\n');
    expect(webToolAudit([jsonl])).toBe(1);
  });
});

describe.skipIf(!NODE)('cursor adapter, serve', () => {
  let mcp: ReturnType<typeof Bun.serve>;
  beforeAll(() => {
    mcp = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => Response.json({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'post_message' }, { name: 'read_channel' }] } }) });
  });
  afterAll(() => mcp.stop(true));

  test('turns resume one chat per conversation; the world MCP server is in a 0600 user config with its bearer token', async () => {
    const t = trial();
    const url = 'http://127.0.0.1:' + mcp.port + '/mcp';
    const child = spawn('bash', [ADAPTER, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], env: env(t, { HE_WORLD_MCP_URL: url, HE_WORLD_MCP_TOKEN: 'world-token-1' }) });
    const until = async (p: string) => { for (let i = 0; i < 300 && !existsSync(p); i++) await Bun.sleep(100); return existsSync(p); };
    try {
      expect(await until(join(t.logs, 'ready'))).toBe(true);
      const ask = async (turn: number, channel: { type: string; id: string }, member: string) => {
        const name = 'turn-' + String(turn).padStart(4, '0');
        writeFileSync(join(t.turns, name + '.request.json'), JSON.stringify({ turn, prompt: 'turn ' + turn, actor: { member }, channel, time_budget_s: 20 }));
        expect(await until(join(t.turns, name + '.response.json'))).toBe(true);
        return JSON.parse(readFileSync(join(t.turns, name + '.response.json'), 'utf8')) as { exit: number; reply_text: string | null };
      };
      expect((await ask(1, { type: 'dm', id: 'D1' }, 'ana')).exit).toBe(0);
      expect((await ask(2, { type: 'dm', id: 'D1' }, 'ana')).exit).toBe(0);
      expect((await ask(3, { type: 'channel', id: 'C1' }, 'ana')).exit).toBe(0);
      const c = calls(t);
      expect(c.length).toBe(3);
      const chats = JSON.parse(readFileSync(join(t.state, 'cursor-chats.json'), 'utf8')) as Record<string, string>;
      expect(Object.keys(chats).sort()).toEqual(['channel:C1', 'dm:ana']);
      expect(c[0]!.args).not.toContain('--resume');
      expect(c[1]!.args[c[1]!.args.indexOf('--resume') + 1]).toBe(chats['dm:ana']!);
      expect(c[2]!.args).not.toContain('--resume');
      const cfg = join(t.state, '.cursor', 'mcp.json');
      expect(statSync(cfg).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(cfg, 'utf8'))).toEqual({ mcpServers: { world: { url, headers: { Authorization: 'Bearer world-token-1' } } } });
      expect(JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8'))).toMatchObject({ harness: 'cursor', version: PIN.version, instruction_files: [] });
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
    }
  }, 60_000);
});

describe('scripts/cursor/install-check.sh', () => {
  test('unsets every key variable, CURSOR_API_KEY included, before any step, and parses as bash', () => {
    const script = join(ROOT, 'scripts/cursor/install-check.sh');
    expect(readFileSync(script, 'utf8')).toMatch(/^unset ANTHROPIC_API_KEY OPENAI_API_KEY .*\bCURSOR_API_KEY\b/m);
    expect(spawnSync('bash', ['-n', script]).status).toBe(0);
  });
});
