// The public-safety gate's value-free core (scripts/public-safety/lib, rules.json, classes.json, allow.json).
//
// Value: protects=the admission rules find every public marker inside a .gz inside a .tar, the private pack's prefilter
// leaks at most 16 bits per window, the output boundary escapes and withholds, classes refuse by default and every
// spawn is bounded; fails_when=a rule misses its canary, a prefilter value is wider than 16 bits, the rolling hash drifts
// from the direct one, a shingle threshold is off by one, a control character or matched text passes the boundary, an
// unclassified, denied or over-budget path is accepted, a timed-out tool leaves its process group or partial file behind,
// a gate file matches its own rules, or a code has no docs section; why_new=the gate replaces the weekly export's checks;
// seam=the library functions on synthetic inputs; no_claim=the CLI and hook (tests/public-safety-cli.test.ts and
// tests/public-safety-hook.test.ts).
import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { classify, loadAllow, refProblem, type GateRule, type RulesFile } from '../scripts/public-safety/check.ts';
import { identityProblems, parseCommit } from '../scripts/public-safety/lib/git.ts';
import { isPublicRemote } from '../scripts/public-safety/lib/hook.ts';
import { Boundary, escapeControls, WITHHELD } from '../scripts/public-safety/lib/output.ts';
import { exactHit, parsePack, prefilter16, prefilterCandidates, prefilterKey, shingleHit } from '../scripts/public-safety/lib/pack.ts';
import { PsError, runSync } from '../scripts/public-safety/lib/proc.ts';
import { compileRules, expand, leafHits, nameKind, ruleApplies } from '../scripts/public-safety/lib/scan.ts';
import { tarOf } from '../scripts/public-safety/lib/tools.ts';
import { buildPack, GATE, keyCanary, NOREPLY, ROOT, scrubbedEnv } from './public-safety-fixture.ts';

const tmp = mkdtempSync(join(tmpdir(), 'he-public-safety-core-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const RULES = JSON.parse(readFileSync(join(GATE, 'rules.json'), 'utf8')) as RulesFile;
const COMPILED = compileRules(RULES.rules, { ownerEmails: [], custodyPatterns: [] });
const ENV = scrubbedEnv(tmp);
const GATE_TREE = 'a'.repeat(40);

test('every rule finds its own canary inside a .gz inside a .tar, at the right line', () => {
  for (const c of COMPILED) {
    const rule = c.rule as GateRule;
    expect(RULES.codes[rule.code]).toBeDefined();
    const ex = expand(tarOf([{ name: 'canary.md.gz', data: gzipSync(Buffer.from('line one\n' + rule.canary + '\n')) }]));
    const inner = ex.leaves.find((l) => l.member === 'canary.md.gz|gunzip')!;
    expect(leafHits(inner.data, [], [c], () => true).map((h) => [h.rule, h.line])).toEqual([[rule.id, 2]]);
  }
});

test('rules.json carries no private-pack rule and no thread-code rule, and every code has a fix and a docs section', () => {
  const ids = RULES.rules.map((r) => r.id);
  for (const id of ['owner-email', 'custody-sha', 'proprietary-prompt', 'benchmark-canary', 'private-repo-link', 'thread-code']) expect(ids).not.toContain(id);
  expect(RULES.rules.every((r) => !('source' in r))).toBe(true);
  const doc = readFileSync(join(ROOT, 'docs', 'public-safety.md'), 'utf8');
  for (const [code, info] of Object.entries(RULES.codes)) {
    expect(info.fix.length).toBeGreaterThan(10);
    expect(doc).toContain('<a id="' + code.toLowerCase() + '"></a>');
    if (info.class === 'private') { expect(info.allow).toBe(false); expect(info.fix).toBe('Not allowlistable; see the private record.'); }
  }
});

test('the gate files, its docs and its tests never match a rule, and the fix texts pass the output boundary', () => {
  const files = [...readdirSync(GATE).map((f) => join('scripts/public-safety', f)), ...readdirSync(join(GATE, 'lib')).map((f) => join('scripts/public-safety/lib', f)), 'docs/public-safety.md', ...readdirSync(join(ROOT, 'tests')).filter((f) => f.startsWith('public-safety')).map((f) => join('tests', f))].filter((p) => !p.endsWith('/lib'));
  for (const p of files) {
    const data = readFileSync(join(ROOT, p));
    const cls = classify(p);
    expect(cls.kind).toBe('class');
    const hits = leafHits(data, [], COMPILED, (r) => ruleApplies(r, nameKind(p, ''), cls.kind === 'class' ? cls.content_class : ''));
    expect({ p, hits: hits.map((h) => h.rule + ':' + h.line) }).toEqual({ p, hits: [] });
  }
  const b = new Boundary((s) => leafHits(Buffer.from(s), [], COMPILED, () => true).length > 0);
  for (const info of Object.values(RULES.codes)) expect(b.line(info.fix)).toBe(info.fix);
});

test('the prefilter is 16 bits wide, the rolling hash equals the direct one, and a pack with a wider value is refused', () => {
  const salt = randomBytes(16);
  const key = prefilterKey(salt);
  const data = randomBytes(4096);
  for (const len of [8, 12, 16, 61]) {
    const all = new Set<number>();
    for (let i = 0; i + len <= 600; i++) { const p = prefilter16(key, data.subarray(i, i + len)); expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(65536); all.add(p); }
    const target = prefilter16(key, data.subarray(300, 300 + len));
    expect(prefilterCandidates(key, data, len, new Set([target]))).toContain(300);
    for (const at of prefilterCandidates(key, data.subarray(0, 600), len, all)) expect(all.has(prefilter16(key, data.subarray(at, at + len)))).toBe(true);
  }
  const { pack } = buildPack({ gateTree: GATE_TREE, values: [keyCanary()] });
  for (const e of pack.exact) for (const p of e.prefilter16) expect(p).toBeLessThan(2 ** 16);
  const wide = { ...pack, exact: [{ ...pack.exact[0]!, prefilter16: [65536] }] };
  expect(() => parsePack(Buffer.from(JSON.stringify(wide)), 'x')).toThrow('wider than 16 bits');
  expect(() => parsePack(Buffer.from(JSON.stringify({ ...pack, schema: 'other/1' })), 'x')).toThrow('schema');
});

test('exact values are found in full and by their head and tail windows, confirmed by sha256, and nothing else is', () => {
  const v = keyCanary();
  const p = buildPack({ gateTree: GATE_TREE, values: [v] });
  const lp = parsePack(Buffer.from(p.json), p.sha);
  expect(exactHit(lp, Buffer.from('a\nb ' + v + ' c'))).toBe(4);
  expect(exactHit(lp, Buffer.from('x ' + v.slice(0, 16) + ' y'))).toBe(2);
  expect(exactHit(lp, Buffer.from('x ' + v.slice(-12)))).toBe(2);
  expect(exactHit(lp, Buffer.from(keyCanary() + ' ' + v.slice(1, 13) + ' ' + randomBytes(2000).toString('base64')))).toBe(-1);
});

test('shingles block at 20 or more shared 8-word shingles in one text, and not at 19', () => {
  const words = Array.from({ length: 60 }, (_, i) => 'word' + i + 'x' + randomBytes(2).toString('hex'));
  const p = buildPack({ gateTree: GATE_TREE, shingleText: words.join(' ') });
  const lp = parsePack(Buffer.from(p.json), p.sha);
  expect(shingleHit(lp, 'intro\n' + words.slice(0, 27).join(' '))).toBeGreaterThanOrEqual(0);
  expect(shingleHit(lp, words.slice(0, 26).join(' '))).toBe(-1);
  expect(shingleHit(lp, words.slice(0, 26).join(' ').toUpperCase())).toBe(-1);
  expect(shingleHit(lp, words.slice(10, 37).join('  ,  '))).toBeGreaterThanOrEqual(0);
});

test('the identity gate allows GitHub noreply forms only, in author, committer and every trailer, and the pack blocks listed ones', () => {
  const mk = (author: string, committer: string, trailers: string[] = []) => parseCommit(Buffer.from('tree ' + 'a'.repeat(40) + '\nauthor A <' + author + '> 1 +0000\ncommitter C <' + committer + '> 1 +0000\n\nmsg\n\n' + trailers.join('\n') + '\n'));
  const allowed = RULES.identity.allowed.map((r) => new RegExp(r, 'i'));
  for (const ok of [NOREPLY, 'noreply@github.com', '12345+capy-ai[bot]@users.noreply.github.com', '9+A-b@USERS.NOREPLY.GITHUB.COM']) expect(identityProblems(mk(ok, ok), allowed, null)).toEqual([]);
  for (const bad of ['dev@example.com', 'x+tester@users.noreply.github.com', '1+tester@users.noreply.github.com.example.com', 'tester@users.noreply.github.com', '']) {
    expect(identityProblems(mk(bad, NOREPLY), allowed, null)).toEqual([{ code: 'PS-IDENTITY', field: 'author' }]);
    expect(identityProblems(mk(NOREPLY, bad), allowed, null)).toEqual([{ code: 'PS-IDENTITY', field: 'committer' }]);
  }
  expect(identityProblems(mk(NOREPLY, NOREPLY, ['Co-authored-by: X <dev@example.com>', 'Signed-off-by: Y <' + NOREPLY + '>', 'signed-off-by: Z']), allowed, null)).toEqual([{ code: 'PS-IDENTITY', field: 'co-authored-by#1' }, { code: 'PS-IDENTITY', field: 'signed-off-by#3' }]);
  const listed = '7+listed@users.noreply.github.com';
  const p = buildPack({ gateTree: GATE_TREE, identities: [listed] });
  expect(identityProblems(mk(listed, NOREPLY), allowed, parsePack(Buffer.from(p.json), p.sha))).toEqual([{ code: 'PS-PRIVATE-IDENTITY', field: 'author' }]);
});

test('the output boundary escapes control and bidirectional characters, withholds matching lines and swaps matching names', () => {
  const b = new Boundary((s) => s.includes('SECRET'));
  expect(escapeControls('a\u001b[31mb\u202ec\r')).toBe('a\\x1b[31mb\\u{202e}c\\x0d');
  expect(b.line('ok line\nhas SECRET here')).toBe('ok line\n' + WITHHELD);
  expect(b.name('dir/SECRET.txt', 'obj:abc')).toBe('obj:abc');
  expect(b.name('dir/plain\u0007.txt', 'obj:abc')).toBe('dir/plain\\x07.txt');
});

test('the hook enforces only on the public repository, over any host, https, ssh or scp form', () => {
  for (const u of ['https://github.com/garrytan/g-harness-evals', 'https://github.com/garrytan/g-harness-evals.git', Object.assign(new URL('https://git.example.com/garrytan/g-harness-evals'), { username: 'u', password: 'p' }).href, 'git@github.com:garrytan/g-harness-evals.git', 'ssh://git@github.com/garrytan/G-Harness-Evals.git/', 'github.com:garrytan/g-harness-evals.git', 'gh-work:garrytan/g-harness-evals', 'git+ssh://git@github.com/garrytan/g-harness-evals']) expect(isPublicRemote(u)).toBe(true);
  for (const u of ['https://github.com/garrytan/harness-evals', 'https://github.com/garrytan/g-harness-evals-fork', '/tmp/repo.git', 'https://github.com/other/g-harness-evals', 'git@github.com:garrytan/harness-evals.git']) expect(isPublicRemote(u)).toBe(false);
});

test('only refs/heads/* passes the ref check: tags, notes, pull refs and malformed names are refused', () => {
  expect(refProblem('refs/heads/main', ENV)).toBe(false);
  expect(refProblem('refs/heads/feature/x-1', ENV)).toBe(false);
  for (const r of ['refs/tags/v1', 'refs/notes/commits', 'refs/pull/1/head', 'refs/heads/', 'refs/heads/a..b', 'refs/heads/x.lock', 'main', 'refs/custody']) expect(refProblem(r, ENV)).toBe(true);
});

test('classes refuse by default: unclassified and denied paths, formats a class does not allow, and over-budget sizes', () => {
  const classes = JSON.parse(readFileSync(join(GATE, 'classes.json'), 'utf8'));
  expect(classify('docs/methods.md')).toEqual({ kind: 'class', name: 'docs', content_class: 'docs' });
  expect(classify('changelog.d/x.md').kind).toBe('class');
  expect(classify('docs/benchmarks/r1/results/trials.jsonl')).toMatchObject({ content_class: 'receipts' });
  for (const p of ['weird.bin', 'random/dir/file.txt', 'Makefile']) expect(classify(p)).toEqual({ kind: 'unclassified' });
  for (const p of ['publication/scrub-table.json', 'tasks/multiuser/v0.3/heldout/t1.json', 'a/b/x.age-key', 'docs/ledger/lanes.json', '.env', 'scripts/public-export/export.ts']) expect(classify(p)).toEqual({ kind: 'denied' });
  expect(classify('tasks/multiuser/v0.3/heldout/MANIFEST.json')).toMatchObject({ content_class: 'commitments' });
  for (const [name, c] of Object.entries(classes.content_classes) as [string, { formats: string[]; max_bytes: number }][]) {
    expect(c.max_bytes).toBeGreaterThan(0);
    expect(c.max_bytes).toBeLessThanOrEqual(99614720);
    expect(c.formats).not.toContain('zip');
    expect(c.formats).not.toContain('binary');
    expect(name.length).toBeGreaterThan(0);
  }
  const text = JSON.stringify(classes);
  expect(text.includes('/home/')).toBe(false);
  expect(loadAllow()).toEqual([]);
});

test('a timed-out tool is killed with its whole process group and maps to PS-TOOL-TIMEOUT', () => {
  const marker = join(tmp, 'grandchild-' + randomBytes(4).toString('hex'));
  const t0 = Date.now();
  let err: unknown;
  try { runSync(['bash', '-c', '(sleep 3; touch ' + marker + ') & sleep 30'], { op: 'sleeper', timeoutMs: 800, env: ENV }); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(PsError);
  expect((err as PsError).code).toBe('PS-TOOL-TIMEOUT');
  expect(Date.now() - t0).toBeLessThan(10_000);
  Bun.sleepSync(3500);
  expect(existsSync(marker)).toBe(false);
});

test('a download that hangs past its deadline is retried once, then refused as PS-TOOL-TIMEOUT, leaving no partial file', () => {
  const server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
  const cache = join(tmp, 'dl-cache');
  const pin = { version: '1.0.0', url: 'http://127.0.0.1:' + server.port + '/tool.tar.gz', sha256: createHash('sha256').update('x').digest('hex'), archive: 'tar.gz' as const, member: 'tool', version_args: ['--version'], version_output: 'tool 1.0.0' };
  const run = spawnSync('bun', ['-e', `import { readyTool } from '${join(GATE, 'lib', 'tools.ts')}'; try { readyTool('tool', ${JSON.stringify(pin)}, { cache: '${cache}', dest: '${join(tmp, 'dl-bin')}', env: { PATH: process.env.PATH }, deadlineMs: 1000 }); } catch (e) { console.log(e.code); }`], { env: ENV, encoding: 'utf8', timeout: 30_000 });
  server.stop(true);
  expect(run.stdout.trim()).toBe('PS-TOOL-TIMEOUT');
  expect(readdirSync(join(cache, 'tool-1.0.0'))).toEqual([]);
});
