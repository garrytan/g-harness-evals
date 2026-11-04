// Tests for the keyless parts of the gstack-on-QM scripts (harnesses/qm/gstack/):
// the signed admin client against a fake QM admin API that checks signatures
// and answers the skill-pack routes the way QM core at b6786d67 does
// (src/api/routes/skill-packs.ts, src/api/app-skills.ts), the refusal
// classifier, the pack sizing, and the S1 staging helpers. No Docker, no
// network beyond 127.0.0.1, no key: the secret here is a placeholder.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADMIN_ACTOR, attributeSandboxes, lockHost, qmClient, signature, upStack } from '../harnesses/qm/gstack/qm-stack.ts';
import { GSTACK_REPO_URL, PACK_CONFIG, classifyRefusal, outcome, packSize, runSmokeCalls } from '../harnesses/qm/gstack/smoke.ts';
import { QM_INLINE_CHARS, SANDBOX_ROOT, compareRead, pointRouter, routerPaths, stage, toolExchanges } from '../harnesses/qm/gstack/s1-stage.ts';

const SECRET = 'placeholder-signing-secret';
const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterAll(() => { for (const s of servers) s.stop(true); });

/** A fake QM admin API: verifies x-signature and x-admin-actor, then plays QM's skill-pack handlers with a fetcher that always refuses with fetchError. */
function fakeQm(fetchError: string) {
  const seen: Array<{ method: string; path: string; body: string; signed: boolean; admin: string | null }> = [];
  const packs = new Map<string, Record<string, unknown>>();
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname + url.search;
    const body = req.method === 'GET' ? '' : await req.text();
    const ts = Number(req.headers.get('x-timestamp'));
    const signed = req.headers.get('x-signature') === signature(SECRET, req.method, path, body, ts);
    seen.push({ method: req.method, path, body, signed, admin: req.headers.get('x-admin-actor') });
    if (!signed) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (req.headers.get('x-admin-actor') !== ADMIN_ACTOR) return Response.json({ error: 'forbidden' }, { status: 403 });
    const fail = (id: string) => { packs.get(id)!.lastImport = { at: Date.now(), commit: packs.get(id)!.ref, status: 'error', error: fetchError }; };
    if (req.method === 'POST' && url.pathname === '/v1/admin/skill-packs') {
      const b = JSON.parse(body);
      const pack = { id: 'pack-1', kind: 'git', url: b.url, ref: b.ref, config: b.config, trustTier: b.trustTier, syncMode: 'pinned', subset: 'all', createdBy: 'harness-admin' };
      packs.set(pack.id, pack); fail(pack.id);
      return Response.json({ pack: packs.get(pack.id) });
    }
    if (req.method === 'GET' && url.pathname === '/v1/admin/skill-packs') return Response.json({ packs: [...packs.values()].map(p => ({ ...p, importedCount: 0 })) });
    const m = url.pathname.match(/^\/v1\/admin\/skill-packs\/([^/]+)\/(catalog|import)$/);
    if (m && packs.has(m[1]!)) {
      if (m[2] === 'import') fail(m[1]!);
      return Response.json({ error: 'internal_error', message: 'internal server error' }, { status: 500 });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  } });
  servers.push(server);
  return { url: 'http://127.0.0.1:' + server.port, seen };
}

describe('qm admin client', () => {
  test('signs v0:<ts>:<METHOD>\\n<path>\\n<body> the way qm-api.mjs does', () => {
    const qmApi = readFileSync(join(import.meta.dir, '..', 'harnesses', 'qm', 'qm-api.mjs'), 'utf8');
    expect(qmApi).toContain('v0:${ts}:${method}\\n${path}\\n${body}');
    expect(signature('s', 'GET', '/a', '', 1)).not.toBe(signature('s', 'GET', '/b', '', 1));
    expect(signature('s', 'GET', '/a', '', 1)).toMatch(/^v0=[0-9a-f]{64}$/);
  });

  test('a wrong secret is refused by the fake, so the fake really checks signatures', async () => {
    const qm = fakeQm('pack exceeds max bytes (33554432)');
    const res = await qmClient(qm.url, 'wrong')('GET', '/v1/admin/skill-packs');
    expect(res.http).toBe(401);
  });

  test('upStack refuses a model key without the dummy prefix before it starts anything', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'qm-gstack-stack-')), 'stack');
    await expect(upStack({ out, project: 'x', modelBaseUrl: 'http://127.0.0.1:1', modelKey: 'sk-ant-not-a-dummy' })).rejects.toThrow(/dummy model key/);
    expect(existsSync(out)).toBe(false);
  });
});

describe('smoke sequence against a fake QM', () => {
  test('register, list, catalog, import, list; the refusal comes from lastImport.error', async () => {
    const qm = fakeQm('pack exceeds max bytes (33554432)');
    const calls = await runSmokeCalls(qmClient(qm.url, SECRET), 'a'.repeat(40));
    expect(qm.seen.map(s => s.method + ' ' + s.path)).toEqual([
      'POST /v1/admin/skill-packs', 'GET /v1/admin/skill-packs', 'GET /v1/admin/skill-packs/pack-1/catalog',
      'POST /v1/admin/skill-packs/pack-1/import', 'GET /v1/admin/skill-packs',
    ]);
    expect(qm.seen.every(s => s.signed && s.admin === ADMIN_ACTOR)).toBe(true);
    expect(JSON.parse(qm.seen[0]!.body)).toEqual({ url: GSTACK_REPO_URL, ref: 'a'.repeat(40), config: PACK_CONFIG, trustTier: 'third-party' });
    expect(JSON.parse(qm.seen[3]!.body)).toEqual({ selected: 'all' });
    expect(outcome(calls)).toMatchObject({ registered: true, pack_id: 'pack-1', register_http: 200, catalog_http: 500, import_http: 500, imported: false,
      refusal: 'pack exceeds max bytes (33554432)', refusal_kind: 'bytes_cap', register_last_import_error: 'pack exceeds max bytes (33554432)' });
  });

  test('a clone timeout is classified as such', async () => {
    const qm = fakeQm('git clone timed out after 60000ms');
    expect(outcome(await runSmokeCalls(qmClient(qm.url, SECRET), 'b'.repeat(40))).refusal_kind).toBe('clone_timeout');
  });

  test('no pack id: catalog and import are skipped', async () => {
    const call = async (method: string, path: string) => ({ method, path, http: 400, ms: 1, body: { error: 'bad_request' } });
    const calls = await runSmokeCalls(call, 'c'.repeat(40));
    expect(calls.catalog).toBeNull();
    expect(calls.import).toBeNull();
    expect(outcome(calls)).toMatchObject({ registered: false, refusal_kind: 'none' });
  });

  test('a successful import after a failed register reports no refusal', () => {
    const list = (lastImport: object) => ({ method: 'GET', path: '/v1/admin/skill-packs', http: 200, ms: 1, body: { packs: [{ id: 'p', lastImport }] } });
    const ok = (path: string) => ({ method: 'POST', path, http: 200, ms: 1, body: {} });
    const r = outcome({ packId: 'p', register: { ...ok('/v1/admin/skill-packs'), body: { pack: { id: 'p' } } }, listAfterRegister: list({ status: 'error', error: 'pack exceeds max bytes (1)' }),
      catalog: ok('/catalog'), import: ok('/import'), listAfterImport: list({ status: 'ok' }) });
    expect(r).toMatchObject({ imported: true, refusal: null, refusal_kind: 'none', register_last_import_error: 'pack exceeds max bytes (1)' });
  });

  test('lockHost refuses a key a live process holds and takes over a dead one', () => {
    const key = 'test', dir = mkdtempSync(join(tmpdir(), 'qm-lock-'));
    const path = join(dir, 'qm-gstack-' + key + '.lock');
    const child = Bun.spawn(['sleep', '30']);
    writeFileSync(path, String(child.pid));
    expect(() => lockHost([key], dir)).toThrow('holds ' + key);
    child.kill();
    writeFileSync(path, '999999999');
    const release = lockHost([key], dir);
    expect(readFileSync(path, 'utf8')).toBe(String(process.pid));
    release();
    expect(existsSync(path)).toBe(false);
  });

  test('lockHost leaves a dead owner\'s lock alone while another run holds the takeover guard, and removes its own guard', () => {
    const key = 'race', dir = mkdtempSync(join(tmpdir(), 'qm-lock-'));
    const path = join(dir, 'qm-gstack-' + key + '.lock');
    writeFileSync(path, '999999999');
    writeFileSync(path + '.takeover', '999999998');
    expect(() => lockHost([key], dir)).toThrow('taking over ' + key);
    expect(readFileSync(path, 'utf8')).toBe('999999999');
    rmSync(path + '.takeover');
    const release = lockHost([key], dir);
    expect(readFileSync(path, 'utf8')).toBe(String(process.pid));
    expect(existsSync(path + '.takeover')).toBe(false);
    release();
  });

  test('attributeSandboxes adopts only the new sandbox whose name carries this call\'s sandbox id; another run\'s and an unattributable one are skipped', () => {
    const receipt = JSON.parse(readFileSync(join(import.meta.dir, '..', 'harnesses', 'qm', 'gstack', 'receipts', 's1-staging-b6786d67.json'), 'utf8'));
    const body = { ...receipt.sandbox.create.body, machineId: undefined };
    const mine = receipt.sandbox.create.body.machineId as string;
    const concurrent = 'qm-sbx-sandbox-1234abcd-0510-4782-b759-48777a63-abcdef';
    const old = 'qm-sbx-sandbox-949f45aa-0000-0000-0000-000000000000-aaaaaa';
    const names = [mine, concurrent, old, 'qm-sbx-sandbox-949f-1b711b', 'qm-sbx-other'];
    expect(attributeSandboxes(names, new Set([old]), body)).toEqual({ adopt: [mine], skipped: [concurrent, 'qm-sbx-sandbox-949f-1b711b', 'qm-sbx-other'] });
    expect(attributeSandboxes(names, new Set([old]), { id: body.id })).toEqual({ adopt: [mine], skipped: [concurrent, 'qm-sbx-sandbox-949f-1b711b', 'qm-sbx-other'] });
    for (const unattributable of [null, 'internal error', {}, { id: '' }]) expect(attributeSandboxes(names, new Set([old]), unattributable)).toEqual({ adopt: [], skipped: [mine, concurrent, 'qm-sbx-sandbox-949f-1b711b', 'qm-sbx-other'] });
  });

  test('a transport failure is http 0, not a throw', async () => {
    const res = await qmClient('http://127.0.0.1:1', SECRET)('GET', '/v1/admin/whoami', undefined, { timeoutMs: 500 });
    expect(res.http).toBe(0);
    expect(typeof res.body).toBe('string');
  });
});

describe('classifyRefusal', () => {
  test('names each pack-fetcher limit', () => {
    expect(classifyRefusal('pack exceeds max bytes (33554432)')).toBe('bytes_cap');
    expect(classifyRefusal('pack exceeds max files (5000)')).toBe('files_cap');
    expect(classifyRefusal('git checkout timed out after 60000ms')).toBe('clone_timeout');
    expect(classifyRefusal('skill pack url must use https')).toBe('other');
    expect(classifyRefusal(undefined)).toBe('none');
  });
});

function tempRepo(): { dir: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), 'qm-gstack-'));
  const g = (...a: string[]) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: mkdtempSync(join(tmpdir(), 'qm-home-')), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  g('init', '-q');
  mkdirSync(join(dir, 'careful')); writeFileSync(join(dir, 'careful', 'SKILL.md'), '---\nname: careful\n---\nbody\n');
  mkdirSync(join(dir, 'big')); writeFileSync(join(dir, 'big', 'SKILL.md'), 'x'.repeat(QM_INLINE_CHARS + 10));
  writeFileSync(join(dir, 'SKILL.md'), 'root\n');
  symlinkSync('careful', join(dir, 'alias'));
  g('add', '-A'); g('commit', '-qm', 'one');
  return { dir, head: g('rev-parse', 'HEAD').stdout.trim() };
}

describe('packSize', () => {
  test('counts regular files and their bytes, skipping symlinks as QM readTree does', () => {
    const { dir, head } = tempRepo();
    expect(packSize(dir, head)).toEqual({ files: 3, bytes: 27 + QM_INLINE_CHARS + 10 + 5, symlinks: 1 });
  });
});

describe('S1 staging helpers', () => {
  const router = (root: string) => ['---', 'name: gstack', '---', '- **careful**: Use for: safety. Read \x60' + root + '/careful/SKILL.md\x60',
    '- **alias**: Use for: alias. Read \x60' + root + '/alias/SKILL.md\x60', '- **big**: Use for: big. Read \x60' + root + '/big/SKILL.md\x60',
    '<!-- gstack:begin harness-routing -->', 'For a coding task, read \x60' + root + '/SKILL.md\x60, pick the one skill.', '<!-- gstack:end harness-routing -->'].join('\n');

  test('routerPaths finds router lines and the context block; pointRouter moves them into the sandbox', () => {
    const r = router('/home/u/gstack');
    expect(routerPaths(r)).toEqual(['/home/u/gstack/careful/SKILL.md', '/home/u/gstack/alias/SKILL.md', '/home/u/gstack/big/SKILL.md', '/home/u/gstack/SKILL.md']);
    const pointed = pointRouter(r, '/home/u/gstack');
    expect(pointed).not.toContain('/home/u/gstack');
    expect(routerPaths(pointed)).toEqual(routerPaths(r).map(p => p.replace('/home/u/gstack', SANDBOX_ROOT)));
  });

  test('stage copies each file at the ref, follows setup symlinks and marks the inline budget', () => {
    const { dir, head } = tempRepo();
    const ctx = join(mkdtempSync(join(tmpdir(), 'qm-ctx-')), 'context');
    const staged = stage(dir, head, routerPaths(router(dir)), ctx);
    expect(staged.map(s => [s.name, s.sandbox_path, s.fits_inline])).toEqual([
      ['careful', SANDBOX_ROOT + '/careful/SKILL.md', true], ['alias', SANDBOX_ROOT + '/alias/SKILL.md', true],
      ['big', SANDBOX_ROOT + '/big/SKILL.md', false], ['(root)', SANDBOX_ROOT + '/SKILL.md', true]]);
    expect(staged[1]!.source).toBe(head.slice(0, 12) + ':careful/SKILL.md');
    expect(readFileSync(join(ctx, 'gstack', 'alias', 'SKILL.md'), 'utf8')).toBe('---\nname: careful\n---\nbody\n');
  });

  test('stage refuses a checkout whose file differs from the ref', () => {
    const { dir, head } = tempRepo();
    writeFileSync(join(dir, 'careful', 'SKILL.md'), 'edited\n');
    expect(() => stage(dir, head, [join(dir, 'careful', 'SKILL.md')], join(mkdtempSync(join(tmpdir(), 'qm-ctx-')), 'c'))).toThrow(/differs from/);
  });

  test('stage refuses a router path outside the checkout before it writes anything', () => {
    const { dir, head } = tempRepo();
    const outside = join(mkdtempSync(join(tmpdir(), 'qm-out-')), 'SKILL.md');
    writeFileSync(outside, 'x\n');
    const ctx = join(mkdtempSync(join(tmpdir(), 'qm-ctx-')), 'c');
    expect(() => stage(dir, head, [outside], ctx)).toThrow(/lies outside the gstack checkout/);
    expect(existsSync(join(ctx, 'gstack'))).toBe(false);
  });

  test('toolExchanges pairs each tool_use with its tool_result; compareRead reads the cut marker', () => {
    const messages = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'files', input: { action: 'read', path: 'a' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'full text' }] }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'files', input: { action: 'read', path: 'b' } }] },
    ];
    expect(toolExchanges(messages)).toEqual([{ name: 'files', input: { action: 'read', path: 'a' }, result: 'full text' }, { name: 'files', input: { action: 'read', path: 'b' }, result: null }]);
    expect(compareRead('full text', 'full text')).toMatchObject({ delivered: true, identical: true });
    expect(compareRead(null, 'x')).toEqual({ delivered: false });
    const staged = 'h'.repeat(20) + 't'.repeat(20);
    const cut = 'h'.repeat(10) + '\n…[output cut: showing the first 10 and last 10 of 40 chars. The full output is in tool-output/md5/x]…\n' + 't'.repeat(10);
    expect(compareRead(cut, staged)).toMatchObject({ identical: false, cut: { head: 10, tail: 10, of: 40 }, head_matches: true });
  });
});
