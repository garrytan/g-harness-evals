// The public-safety gate's allowances for the gbrain leak tests' leak-preflight records: the scripted markers and token
// names (scripts/public-safety/gitleaks.toml), and one blob-bound allow.json entry per record for its ingest-token digest.
//
// Value: protects=the real leak-preflight records pass the range check while a credential written into the same records
// is still refused and never printed; fails_when=a record value the gate flagged passes through anything but those
// allowances, a digest entry is not bound to the committed blob and its digest line, a 64-hex value passes in any other
// blob or under any other key, or a real-shaped key in a secret, token or ingest_tokens_sha256 field passes;
// why_new=push 8 of the public export found 88 gitleaks generic-api-key hits on these records (58 markers, 30 digests);
// seam=bun check.ts on synthetic repositories holding the committed records; no_claim=the export's own gitleaks config
// (publication/gitleaks.toml).
import { afterAll, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { check, GATE, gitleaksReady, keyCanary, rand, repo, ROOT, tokenCanary } from './public-safety-fixture.ts';
import { randomBytes } from 'node:crypto';

const tmp = mkdtempSync(join(tmpdir(), 'he-public-safety-leak-preflight-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const READY = gitleaksReady();
const GLOBS = [
  'docs/benchmarks/2026-11-09-gbrain-access-leaks/preflight/**/leak-preflight-*.json',
  'docs/benchmarks/2026-11-09-gbrain-access-leaks/results/*.leak-preflight-*.json',
  'docs/benchmarks/2026-11-22-always-on-week/results/shards/*/leak-preflight-*.json',
];
const RECORDS = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', '--', ...GLOBS.map((g) => ':(glob)' + g)], { encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
const MARKER = /^(?:(?:he-)?member-[a-z]{2,16}(?:-[a-z]{2,16})?|trial-leak-preflight-(?:open|member-sources)-(?:dev|heldout)|public-only|PFS[0-9A-Z]{1,7}[0-9]{1,3}[ZN])$/;
const hex64 = () => randomBytes(32).toString('hex');
let n = 0;
const fresh = () => { const r = repo(join(tmp, 'r' + ++n)); r.commit({ 'docs/methods.md': '# Methods\n' }, 'base'); r.g('checkout', '-q', '-b', 'feature'); return r; };
const range = (r: ReturnType<typeof fresh>, script?: string) => check(['--base', 'main', '--head', 'feature', '--no-cache'], { cwd: r.dir, script });
const hits = (stdout: string, code = 'PS-GITLEAKS') => [...stdout.matchAll(new RegExp('^' + code + ' (\\S+):(\\d+) ', 'gm'))].map((m) => ({ path: m[1]!, line: Number(m[2]) }));
const committed = () => Object.fromEntries(RECORDS.map((p) => [p, readFileSync(join(ROOT, p))]));

test('the leak-preflight globs find the committed records', () => {
  expect(RECORDS.length).toBeGreaterThanOrEqual(30);
});

test.skipIf(!READY)('every value the gate flags in the committed records is a marker, a token name or an ingest-token digest, and the marker allowance and the blob-bound digest entries pass all of them', () => {
  const r = fresh();
  r.commit(committed(), 'add the leak-preflight records');
  const stripped = join(tmp, 'stripped');
  cpSync(GATE, join(stripped, 'scripts', 'public-safety'), { recursive: true });
  const toml = join(stripped, 'scripts', 'public-safety', 'gitleaks.toml');
  const blocks = readFileSync(toml, 'utf8').split('\n[[allowlists]]\n');
  const kept = blocks.filter((b) => !b.includes('leak-preflight records'));
  expect(blocks.length - kept.length).toBe(1);
  writeFileSync(toml, kept.join('\n[[allowlists]]\n'));
  const allowPath = join(stripped, 'scripts', 'public-safety', 'allow.json');
  const allow = JSON.parse(readFileSync(allowPath, 'utf8')) as { entries: { path: string; line: number | number[]; blob: string }[] };
  const digests = allow.entries.filter((e) => RECORDS.includes(e.path));
  expect(digests.length).toBe(RECORDS.length);
  for (const e of digests) {
    const lines = readFileSync(join(ROOT, e.path), 'utf8').split('\n');
    expect(e.blob).toBe(spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD:' + e.path], { encoding: 'utf8' }).stdout.trim());
    expect(lines[(e.line as number) - 1]).toMatch(/^\s*"ingest_tokens_sha256": "[0-9a-f]{64}",?\s*$/);
  }
  writeFileSync(allowPath, JSON.stringify({ ...allow, entries: allow.entries.filter((e) => !RECORDS.includes(e.path)) }, null, 2) + '\n');
  const before = range(r, join(stripped, 'scripts', 'public-safety', 'check.ts'));
  const flagged = hits(before.stdout);
  expect(flagged.length).toBeGreaterThanOrEqual(88);
  for (const h of flagged) {
    const line = readFileSync(join(ROOT, h.path), 'utf8').split('\n')[h.line - 1]!;
    const m = line.match(/^\s*"([a-z0-9_]+)":\s*"([^"]*)",?\s*$/);
    expect(m, h.path + ':' + h.line + ' ' + line.replace(/[0-9a-f]{64}/g, '<HEX>').replace(/: *"[^"]*"/g, ': "<V>"')).not.toBeNull();
    const [, key, value] = m!;
    expect(key === 'ingest_tokens_sha256' ? /^[0-9a-f]{64}$/.test(value!) : MARKER.test(value!)).toBe(true);
  }
  const after = range(r);
  expect(hits(after.stdout)).toEqual([]);
  expect(after.status).toBe(0);
}, 300_000);

test.skipIf(!READY)('a real-shaped key in the same records, a fresh 64-hex value in the digest field, or a 64-hex value under any other key, is still refused and never printed', () => {
  const base = RECORDS.find((p) => readFileSync(join(ROOT, p), 'utf8').includes('"ingest_tokens_sha256"'))!;
  const text = readFileSync(join(ROOT, base), 'utf8');
  const key = keyCanary();
  const tok = tokenCanary();
  const generic = rand(40);
  const hex = hex64();
  const field = (k: string, v: string) => JSON.stringify(k) + ': ' + JSON.stringify(v);
  const swap = (k: string, to: string) => text.replace(new RegExp(JSON.stringify(k) + ': "[^"]*"'), to);
  const cases: Record<string, string> = {
    'secret-key': swap('secret', field('secret', key)),
    'token-pat': swap('token', field('token', tok)),
    'digest-not-hex': swap('ingest_tokens_sha256', field('ingest_tokens_sha256', generic)),
    'digest-real-shaped': swap('ingest_tokens_sha256', field('ingest_tokens_sha256', hex)),
    'hex-other-key': swap('ingest_tokens_sha256', field('ingest_tokens_sha256', hex64()) + ',\n    ' + field('access_token', hex)),
  };
  for (const [name, body] of Object.entries(cases)) {
    expect(body).not.toBe(text);
    const r = fresh();
    r.commit({ [base]: body }, name);
    const out = range(r);
    expect(out.status).toBe(1);
    expect(hits(out.stdout, name === 'secret-key' ? 'PS-KEY-SHAPE' : 'PS-GITLEAKS').length, name).toBeGreaterThanOrEqual(1);
    for (const s of [key, tok, generic, hex]) expect(out.all).not.toContain(s);
  }
}, 300_000);
