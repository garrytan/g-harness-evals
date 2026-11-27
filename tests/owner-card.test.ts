// owner-identity (internal-task): the owner card reaches every harness where it reads standing context. Claude Code, Codex and
// OpenClaw take it in a startup file (CLAUDE.md, AGENTS.md, OpenClaw's workspace AGENTS.md), Hermes in its user profile
// (memories/USER.md) and QM in its org SOUL, its system-prompt setting. Each adapter's owner-card block is cut out of its
// adapter.sh and run under bash with a scrubbed environment (env -i plus an allowlist, never a login shell): it writes the card
// after whatever was there, records owner-card.json and the ready fragment, and refuses a bad card before ready. QM's block
// talks to a fake QM core that checks the request signature. The runner validates Cell.owner_card and hands the card over as
// HE_OWNER_CARD_B64.

import { afterAll, describe, expect, test } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadPrereg, OWNER_CARD_HARNESSES, type Cell, type Prereg } from '../runner/run.ts';

const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-owner-card-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** The adapters that append the card to a startup file, the environment variable naming its directory and the file. */
const STARTUP = {
  'claude-code': { dirVar: 'CLAUDE_CONFIG_DIR', home: 'claude', file: 'CLAUDE.md' },
  codex: { dirVar: 'CODEX_HOME', home: 'codex', file: 'AGENTS.md' },
  openclaw: { dirVar: 'HE_WORKSPACE_DIR', home: 'workspace', file: 'AGENTS.md' },
} as const;
type StartupHarness = keyof typeof STARTUP;

function ownerCardBlock(harness: string): string {
  const text = readFileSync(join(ROOT, 'harnesses', harness, 'adapter.sh'), 'utf8');
  const start = text.indexOf('# owner-identity (internal-task): HE_OWNER_CARD_B64');
  const endMark = "owner_card_json=$(printf ',\"owner_card\"";
  const end = text.indexOf('\nfi\n', text.indexOf(endMark, start));
  if (start < 0 || end < 0) throw new Error(`no owner-card block in harnesses/${harness}/adapter.sh`);
  return text.slice(start, end + 4);
}

const blockScript = (harness: string, entry = 'serve') =>
  `set -euo pipefail\nentry=${entry}\nlog() { printf '%s\\n' "$*" >> "$HE_LOG_DIR/adapter.log"; }\n${ownerCardBlock(harness)}\nprintf '%s' "$owner_card_json" > "$HE_LOG_DIR/ready-fragment"\n`;
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const readJson = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const fragment = (f: string | null) => JSON.parse('{' + f!.slice(1) + '}');

function run(harness: StartupHarness, name: string, card: string | null, existing?: string, entry = 'serve') {
  const dir = join(tmp, harness, name);
  const home = join(dir, 'state', STARTUP[harness].home);
  const logs = join(dir, 'logs');
  mkdirSync(logs, { recursive: true });
  if (existing !== undefined) { mkdirSync(home, { recursive: true }); writeFileSync(join(home, STARTUP[harness].file), existing); }
  const script = join(dir, 'block.sh');
  writeFileSync(script, blockScript(harness, entry));
  const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HE_LOG_DIR: logs, [STARTUP[harness].dirVar]: home };
  if (card !== null) env.HE_OWNER_CARD_B64 = card;
  const r = spawnSync('bash', [script], { env, encoding: 'utf8' });
  return { status: r.status, startup: read(join(home, STARTUP[harness].file)), rec: readJson(join(logs, 'owner-card.json')), fragment: read(join(logs, 'ready-fragment')), log: read(join(logs, 'adapter.log')) };
}

const CARD = 'You work for Avery Quill (avery@example.test, aq@example.test). Facts they state about themselves belong on their page.';
const b64 = (s: string) => Buffer.from(s).toString('base64');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

for (const harness of Object.keys(STARTUP) as StartupHarness[]) {
  describe(harness + ' adapter owner card', () => {
    test('appended after what the gbrain installer wrote, with a blank line between, and recorded', () => {
      const installer = '<!-- gbrain brain-first -->\nCheck GBrain first.\n';
      const r = run(harness, 'after-installer', b64(CARD), installer);
      expect(r.status).toBe(0);
      expect(r.startup).toBe(installer + '\n\n' + CARD + '\n');
      expect(r.rec.file.endsWith('/' + STARTUP[harness].file)).toBe(true);
      expect(r.rec).toMatchObject({ status: 'ok', card_sha256: sha(CARD), card_bytes: CARD.length, existed: true, bytes_before: installer.length, file_sha256: sha(r.startup!) });
      expect(fragment(r.fragment)).toEqual({ owner_card: { file: r.rec.file, card_sha256: sha(CARD), appended_to_existing: true } });
    });

    test('with no startup file the card alone is written', () => {
      const r = run(harness, 'fresh', b64(CARD));
      expect(r.status).toBe(0);
      expect(r.startup).toBe(CARD + '\n');
      expect(r.rec.existed).toBe(false);
    });

    test('unset, nothing is written or recorded', () => {
      const r = run(harness, 'unset', null, 'seed\n');
      expect(r.status).toBe(0);
      expect(r.startup).toBe('seed\n');
      expect(r.rec).toBeNull();
      expect(r.fragment).toBe('');
    });

    test('a card over 4,000 bytes or not canonical base64 is HE-ADAPTER-007 before ready, the startup file untouched', () => {
      for (const [name, card] of [['big', b64('x'.repeat(4001))], ['bad', 'not base64!']] as const) {
        const r = run(harness, name, card, 'seed\n');
        expect(r.status).toBe(2);
        expect(r.startup).toBe('seed\n');
        expect(r.rec).toMatchObject({ status: 'error', code: 'HE-ADAPTER-007' });
      }
    });
  });
}

test('openclaw: the run entry refuses the card (its /workspace is the task workspace) and writes nothing', () => {
  const r = run('openclaw', 'run-entry', b64(CARD), 'seed\n', 'run');
  expect(r.status).toBe(2);
  expect(r.startup).toBe('seed\n');
  expect(r.rec).toBeNull();
  expect(r.log).toContain('HE-ADAPTER-007 HE_OWNER_CARD_B64 is applied for the serve entry only');
});

// ---- Hermes: the user profile, memories/USER.md ----------------------------------------------------------------------------

const HERMES_DELIM = '\n§\n';
const HERMES_CONFIG = readFileSync(join(ROOT, 'harnesses', 'hermes', 'config', 'config.yaml'), 'utf8');
const HAVE_PY = Bun.which('python3') !== null;

function runHermes(name: string, card: string | null, seed: { user?: string; config?: string } = {}) {
  const dir = join(tmp, 'hermes', name);
  const home = join(dir, 'state', 'hermes');
  const logs = join(dir, 'logs');
  mkdirSync(logs, { recursive: true });
  mkdirSync(join(home, 'memories'), { recursive: true });
  writeFileSync(join(home, 'config.yaml'), seed.config ?? HERMES_CONFIG);
  if (seed.user !== undefined) writeFileSync(join(home, 'memories', 'USER.md'), seed.user);
  const script = join(dir, 'block.sh');
  writeFileSync(script, blockScript('hermes'));
  const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HE_LOG_DIR: logs, HERMES_HOME: home };
  if (card !== null) env.HE_OWNER_CARD_B64 = card;
  const r = spawnSync('bash', [script], { env, encoding: 'utf8' });
  return { status: r.status, user: read(join(home, 'memories', 'USER.md')), config: read(join(home, 'config.yaml')), rec: readJson(join(logs, 'owner-card.json')), fragment: read(join(logs, 'ready-fragment')) };
}

describe.skipIf(!HAVE_PY)('hermes adapter owner card: the user profile', () => {
  const card = CARD + '\n';
  const limit = 1375 + CARD.length + HERMES_DELIM.length;

  test('a fresh home: USER.md holds the card as one entry, the agent keeps its 1,375 characters, recorded', () => {
    const r = runHermes('fresh', b64(card));
    expect(r.status).toBe(0);
    expect(r.user).toBe(CARD);
    expect(r.config).toBe(HERMES_CONFIG + 'memory:\n  user_char_limit: ' + limit + '\n');
    expect(r.rec).toMatchObject({ status: 'ok', card_sha256: sha(card), card_bytes: card.length, existed: false, bytes_before: 0, file_sha256: sha(CARD), user_char_limit: { default: 1375, set: limit } });
    expect(r.rec.file.endsWith('/memories/USER.md')).toBe(true);
    expect(fragment(r.fragment)).toEqual({ owner_card: { file: r.rec.file, setting: 'user profile (memories/USER.md)', card_sha256: sha(card), appended_to_existing: false, user_char_limit: limit } });
  });

  test("existing entries stay first; the card is a new entry after Hermes's delimiter, so Hermes parses both", () => {
    const r = runHermes('existing', b64(card), { user: 'Prefers tea.' + HERMES_DELIM + 'Lives in Lisbon.\n' });
    expect(r.status).toBe(0);
    expect(r.user).toBe('Prefers tea.' + HERMES_DELIM + 'Lives in Lisbon.' + HERMES_DELIM + CARD);
    expect(r.user!.split(HERMES_DELIM).map((e) => e.trim())).toEqual(['Prefers tea.', 'Lives in Lisbon.', CARD]);
    expect(r.rec).toMatchObject({ existed: true, status: 'ok' });
  });

  test('the limit counts characters as Hermes does (Python len), not bytes', () => {
    const text = 'Zoë Ångström runs the café.';
    const r = runHermes('unicode', b64(text));
    expect(r.status).toBe(0);
    expect(r.rec.user_char_limit.set).toBe(1375 + [...text].length + 3);
    expect(Buffer.byteLength(text)).toBeGreaterThan([...text].length);
  });

  test('unset, nothing is written or recorded', () => {
    const r = runHermes('unset', null, { user: 'seed' });
    expect(r.status).toBe(0);
    expect(r.user).toBe('seed');
    expect(r.config).toBe(HERMES_CONFIG);
    expect(r.rec).toBeNull();
    expect(r.fragment).toBe('');
  });

  test('HE-ADAPTER-007 before ready, nothing written: a bad card, a card holding the § delimiter line, a config with a memory: section', () => {
    const memoryConfig = HERMES_CONFIG + 'memory:\n  memory_enabled: true\n';
    for (const [name, c, config] of [['big', b64('x'.repeat(4001)), undefined], ['bad', 'not base64!', undefined], ['delim', b64('a\n§\nb'), undefined], ['memory', b64(card), memoryConfig]] as const) {
      const r = runHermes(name, c, { user: 'seed', ...(config ? { config } : {}) });
      expect(r.status).toBe(2);
      expect(r.user).toBe('seed');
      expect(r.config).toBe(config ?? HERMES_CONFIG);
      expect(r.rec).toMatchObject({ status: 'error', code: 'HE-ADAPTER-007' });
      expect(r.fragment).toBeNull();
    }
  });
});

// ---- QM: the org SOUL, through a fake core --------------------------------------------------------------------------------

const QM_SECRET = 'qm-test-signing';
const QM_SCOPE = 'org:harness-eval';
const DEFAULT_ORG_SOUL = 'You are a helpful internal assistant for this organization. Be concise, accurate, and respect data boundaries: never reveal information to people who are not party to the current conversation.';
const NODE = Bun.which('node');

/** A fake QM core: the org SOUL behind GET /v1/admin/scopes/<org>?view=customize and PUT /v1/admin/scopes/<org>/soul with
 *  expectedVersion, as src/api/routes/admin-resources.ts and config-store.ts setSoulIfVersion do at the pin. Every request must
 *  carry a good signature and the admin actor. ignorePuts answers a PUT with 200 and stores nothing. */
function fakeCore(opts: { ignorePuts?: boolean } = {}) {
  const soul = { content: DEFAULT_ORG_SOUL, version: 1 };
  const calls: Array<{ method: string; path: string; body: string }> = [];
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname + url.search;
    const body = req.method === 'GET' ? '' : await req.text();
    calls.push({ method: req.method, path, body });
    const ts = req.headers.get('x-timestamp') ?? '';
    const want = 'v0=' + createHmac('sha256', QM_SECRET).update('v0:' + ts + ':' + req.method + '\n' + path + '\n' + body).digest('hex');
    if (req.headers.get('x-signature') !== want) return Response.json({ error: 'bad_signature' }, { status: 401 });
    if (req.headers.get('x-admin-actor') !== 'harness-admin@harness-eval') return Response.json({ error: 'forbidden' }, { status: 403 });
    if (req.method === 'GET' && path === '/v1/admin/scopes/' + QM_SCOPE + '?view=customize') return Response.json({ scopeId: QM_SCOPE, soul: soul.content, soulVersion: soul.version, soulHistory: [] });
    if (req.method === 'PUT' && path === '/v1/admin/scopes/' + QM_SCOPE + '/soul') {
      const b = JSON.parse(body) as { content: string; expectedVersion: number };
      if (b.expectedVersion !== soul.version) return Response.json({ error: 'version_conflict' }, { status: 409 });
      if (!opts.ignorePuts) { soul.content = b.content; soul.version += 1; }
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  } });
  return { url: 'http://127.0.0.1:' + server.port, calls, soul, stop: () => server.stop(true) };
}

async function runQm(name: string, card: string | null, core: ReturnType<typeof fakeCore>) {
  const dir = join(tmp, 'qm', name);
  const logs = join(dir, 'logs');
  mkdirSync(logs, { recursive: true });
  const script = join(dir, 'block.sh');
  writeFileSync(script, blockScript('qm').replaceAll('/opt/harness/qm-api.mjs', join(ROOT, 'harnesses', 'qm', 'qm-api.mjs')));
  const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HE_LOG_DIR: logs, QM_CORE_URL: core.url, QM_SIGNING_SECRET: QM_SECRET, QM_ADMIN_ACTOR: 'harness-admin@harness-eval', QM_ORG_SCOPE: QM_SCOPE };
  if (card !== null) env.HE_OWNER_CARD_B64 = card;
  // Async: the fake core answers from this event loop, so a blocking spawn would starve it.
  const proc = Bun.spawn(['bash', script], { env, stdout: 'pipe', stderr: 'pipe' });
  const status = await proc.exited;
  return { status, rec: readJson(join(logs, 'owner-card.json')), fragment: read(join(logs, 'ready-fragment')) };
}

describe.skipIf(!NODE)('qm adapter owner card: the org SOUL', () => {
  test('appended after the org SOUL with a blank line, PUT at the version read, read back, recorded and labelled', async () => {
    const core = fakeCore();
    try {
      const r = await runQm('soul', b64(CARD), core);
      expect(r.status).toBe(0);
      const content = DEFAULT_ORG_SOUL + '\n\n' + CARD + '\n';
      expect(core.soul).toEqual({ content, version: 2 });
      expect(core.calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'GET']);
      expect(JSON.parse(core.calls[1]!.body)).toEqual({ content, expectedVersion: 1 });
      expect(r.rec).toMatchObject({ status: 'ok', file: 'qm:org:harness-eval/soul', card_sha256: sha(CARD), card_bytes: CARD.length, existed: true, bytes_before: DEFAULT_ORG_SOUL.length, file_sha256: sha(content), soul_before: { version: 1, chars: DEFAULT_ORG_SOUL.length, sha256: sha(DEFAULT_ORG_SOUL) }, soul_after: { version: 2, chars: content.length }, put_http: 200 });
      expect(r.rec.setting).toContain('system prompt');
      expect(r.rec.per_actor_profile).toContain('personal:<actor>');
      expect(fragment(r.fragment)).toEqual({ owner_card: { file: 'qm:org:harness-eval/soul', setting: 'system prompt (org SOUL)', card_sha256: sha(CARD), appended_to_existing: true } });
    } finally { core.stop(); }
  });

  test('unset, core is never called and nothing is recorded', async () => {
    const core = fakeCore();
    try {
      const r = await runQm('unset', null, core);
      expect(r.status).toBe(0);
      expect(core.calls).toEqual([]);
      expect(r.rec).toBeNull();
      expect(r.fragment).toBe('');
    } finally { core.stop(); }
  });

  test('a bad card is HE-ADAPTER-007 before any call to core', async () => {
    const core = fakeCore();
    try {
      for (const [name, card] of [['big', b64('x'.repeat(4001))], ['bad', 'not base64!']] as const) {
        const r = await runQm(name, card, core);
        expect(r.status).toBe(2);
        expect(r.rec).toMatchObject({ status: 'error', code: 'HE-ADAPTER-007' });
      }
      expect(core.calls).toEqual([]);
      expect(core.soul.version).toBe(1);
    } finally { core.stop(); }
  });

  test('a SOUL that does not read back as written is HE-ADAPTER-007', async () => {
    const core = fakeCore({ ignorePuts: true });
    try {
      const r = await runQm('no-readback', b64(CARD), core);
      expect(r.status).toBe(2);
      expect(r.rec).toMatchObject({ status: 'error', code: 'HE-ADAPTER-007' });
      expect(r.rec.error).toContain('did not read back');
      expect(r.fragment).toBeNull();
    } finally { core.stop(); }
  });
});

// ---- the runner ------------------------------------------------------------------------------------------------------------

test('the runner hands the card to every adapter that reads it, all five harnesses', () => {
  expect([...OWNER_CARD_HARNESSES].map(String).sort()).toEqual([...Object.keys(STARTUP), 'hermes', 'qm'].sort());
  for (const h of OWNER_CARD_HARNESSES) expect(readFileSync(join(ROOT, 'harnesses', h, 'adapter.sh'), 'utf8')).toContain('# owner-identity (internal-task): HE_OWNER_CARD_B64');
});

test('every owner-card adapter puts owner_card on its ready line', () => {
  for (const h of OWNER_CARD_HARNESSES) {
    const ready = readFileSync(join(ROOT, 'harnesses', h, 'adapter.sh'), 'utf8').split('\n').filter((l) => l.includes('> "$HE_LOG_DIR/ready.tmp"'));
    expect(ready.length).toBeGreaterThan(0);
    for (const l of ready) expect(l).toContain('$owner_card_json');
  }
});

function prereg(cell: Partial<Cell>, runId: string): string {
  const dir = join(tmp, 'prereg', runId);
  mkdirSync(dir, { recursive: true });
  const c = { id: 'oc', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, ...cell } as Cell;
  const p: Prereg = { schema_version: 1, run_id: runId, question: 'owner card fixture', tasks: {}, cells: [c], wall_clock_s: { multiuser: 120 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] };
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify(p));
  return join(dir, 'prereg.json');
}

test('Cell.owner_card loads on all five harnesses; a missing, empty or oversized card or another harness is refused', () => {
  const card = join(tmp, 'card.md');
  writeFileSync(card, CARD);
  expect(loadPrereg(prereg({ owner_card: card }, 'oc-cc')).prereg.cells[0]!.owner_card).toBe(card);
  expect(loadPrereg(prereg({ owner_card: card, harness: 'codex', model: 'openai:gpt-6.1-sol', network: 'internal' }, 'oc-codex')).prereg.cells[0]!.owner_card).toBe(card);
  for (const harness of ['openclaw', 'hermes', 'qm']) expect(loadPrereg(prereg({ owner_card: card, harness }, 'oc-' + harness)).prereg.cells[0]!.owner_card).toBe(card);
  expect(() => loadPrereg(prereg({ owner_card: join(tmp, 'nope.md') }, 'oc-missing'))).toThrow(/HE-TASK-002 .*owner_card not found/);
  const empty = join(tmp, 'empty.md');
  writeFileSync(empty, '');
  expect(() => loadPrereg(prereg({ owner_card: empty }, 'oc-empty'))).toThrow(/HE-TASK-002 .*is 0 bytes/);
  const big = join(tmp, 'big.md');
  writeFileSync(big, 'x'.repeat(4001));
  expect(() => loadPrereg(prereg({ owner_card: big }, 'oc-big'))).toThrow(/HE-TASK-002 .*is 4001 bytes/);
  expect(() => loadPrereg(prereg({ owner_card: card, harness: 'pi' }, 'oc-pi'))).toThrow(/HE-PREREG-005 .*owner_card is read by the claude-code, codex, openclaw, hermes, qm adapters only, not pi/);
});
