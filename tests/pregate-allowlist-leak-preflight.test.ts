// The pregate allowlist entry for the gbrain access-leak preflight records. Each leak-preflight-<scope>-<split>.json that
// scripts/gbrain-leak-preflight.ts writes carries "token" and "writer_token" fields holding the name of the gbrain token an
// asker used (he-member-<name>, member-<name>, trial-leak-preflight-<arm>-<split>, public-only) and "secret" fields holding
// the scripted PFS<seed><n>Z marker, which gstack-redact reports as env.kv. The entry lets exactly those shapes through on the
// leak-preflight record paths of the gbrain access-leaks preregistration and the always-on week run's shards, and nothing else.
//
// Value: protects=a real-shaped key in a leak-preflight record still fails the pregate secrets check, in a token field and on
// any other line of the file, and the same token names on another path are still reported; fails_when=the entry is widened
// to a general env.kv exemption, a broader path, or a pattern that covers a value past the closing quote; why_new=the entry is
// new (gbrain-access-leaks-2026-11 preregistration, #538); seam=gstack-pregate --only secrets on a throwaway repository whose
// origin/main holds this repository's .gstack/pregate.json, when gstack is installed; no_claim=gstack-redact's detection of
// every key shape.
import { afterAll, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SCRUBBED_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME'].includes(k)).concat([['GIT_CONFIG_GLOBAL', '/dev/null'], ['GIT_CONFIG_NOSYSTEM', '1']])) as Record<string, string>;
const GLOB = 'docs/benchmarks/2026-11-09-gbrain-access-leaks/preflight/**/leak-preflight-*.json';
const WEEK_GLOB = 'docs/benchmarks/2026-11-22-always-on-week/results/shards/*/leak-preflight-*.json';
const RECORD = 'docs/benchmarks/2026-11-09-gbrain-access-leaks/preflight/v0.60.758.0/leak/leak-preflight-member-sources-dev.json';
const FIRST = 'docs/benchmarks/2026-11-09-gbrain-access-leaks/preflight/leak/leak-preflight-open-dev.json';
const OTHER = 'docs/benchmarks/2026-11-09-gbrain-access-leaks/preflight/v0.60.758.0/gbrain-check/check.json';
const PREGATE = [process.env.GSTACK_PREGATE, join(process.env.HOME ?? '', '.local', 'share', 'gstack', 'bin', 'gstack-pregate')].find((p) => p && existsSync(p));
const tmps: string[] = [];
afterAll(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true }); });

const entry = () => (JSON.parse(readFileSync(join(ROOT, '.gstack', 'pregate.json'), 'utf8')).allowlist as Array<{ finding: string; paths?: string[]; pattern?: string }>)
  .filter((e) => e.paths?.some((p) => p.includes('leak-preflight')));
const anthropicKey = () => [['sk', 'ant', 'api03'].join('-'), randomBytes(48).toString('hex').slice(0, 93) + 'AA'].join('-');
const githubToken = () => ['gh', 'p_'].join('') + randomBytes(27).toString('base64').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 36);
const record = (rows: Array<Record<string, string | null>>) => JSON.stringify({ arm: 'member-sources', split: 'dev', rows }, null, 2) + '\n';
const NAMES: Array<Record<string, string | null>> = [
  { asker: 'anselm-grieve', token: 'he-member-anselm-grieve' }, { asker: null, token: 'public-only' }, { token: 'trial-leak-preflight-open-dev' },
  { writer: 'dana-okafor', writer_token: 'he-member-dana-okafor' }, { id: 'dm-anselm-grieve', secret: 'PFS1RJHH3P7Z' }, { id: 'correction-new-dana-okafor', secret: 'PFSX22I0N12N' },
];

test('the leak-preflight entry is env.kv on the record glob only, anchored at the value and ending at its closing quote', () => {
  const found = entry();
  expect(found).toHaveLength(1);
  expect(found[0]).toEqual(expect.objectContaining({ finding: 'env.kv', paths: [GLOB, WEEK_GLOB] }));
  const re = new RegExp('^(?:' + found[0]!.pattern + ')(?![\\w-])');
  const at = (line: string, key: string) => { const k = line.indexOf('"' + key + '": "'); return line.slice(k + key.length + 5); };
  for (const v of ['he-member-anselm-grieve', 'member-moss', 'trial-leak-preflight-open-dev', 'public-only', 'PFS1RJHH3P7Z', 'PFSX22I0N12N']) expect(re.test(at('"token": "' + v + '",', 'token'))).toBe(true);
  for (const v of [anthropicKey(), githubToken(), 'he-member-anselm-grieve7f3a9c', 'he-member-Anselm', 'PFS1RJHH3P7Q', 'public-only2', 'pfs1rjhh3p7z', 'PFS' + 'K'.repeat(24) + '7Z', 'PFS1RJHH3PZ', 'trial-leak-preflight-other-dev', 'he-member-a-b-c-d']) expect(re.test(at('"token": "' + v + '",', 'token'))).toBe(false);
  expect(re.test(at('"token": "he-member-moss ' + anthropicKey() + '",', 'token'))).toBe(false);
});

test.skipIf(!PREGATE)('gstack-pregate secrets lets token names and markers through in leak-preflight records and still fails a real-shaped key there', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'he-pregate-leak-'));
  tmps.push(tmp);
  const bare = join(tmp, 'origin.git'), repo = join(tmp, 'repo');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env: SCRUBBED_ENV, encoding: 'utf8' });
  const write = (rel: string, text: string) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare], { env: SCRUBBED_ENV });
  mkdirSync(repo);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'pregate-leak@example.invalid');
  git('config', 'user.name', 'pregate leak allowlist test');
  git('remote', 'add', 'origin', bare);
  write('.gstack/pregate.json', readFileSync(join(ROOT, '.gstack', 'pregate.json'), 'utf8'));
  write('README.md', 'allowlist test\n');
  git('add', '-A'); git('commit', '-q', '-m', 'base'); git('push', '-q', 'origin', 'main');

  const keys = [anthropicKey(), githubToken()];
  const secrets = (branch: string, files: Record<string, string>) => {
    git('checkout', '-q', '-B', branch, 'main');
    for (const [rel, text] of Object.entries(files)) write(rel, text);
    git('add', '-A'); git('commit', '-q', '-m', branch);
    const run = spawnSync(PREGATE!, ['--only', 'secrets', '--stage', 'preflight', '--base', 'main', '--json'], { cwd: repo, encoding: 'utf8', env: { ...SCRUBBED_ENV, GSTACK_EPHEMERAL: '1' } });
    for (const k of keys) expect(run.stdout + run.stderr).not.toContain(k);
    const check = (JSON.parse(run.stdout).checks as Array<{ id: string; status: string; lines?: string[] }>).find((c) => c.id === 'secrets')!;
    const lines = check.lines ?? [];
    return { status: check.status, allowlisted: lines.filter((l) => l.startsWith('allowlisted env.kv')).length, reported: lines.filter((l) => !l.startsWith('allowlisted ') && /^(HIGH|MEDIUM|LOW|CRITICAL) /.test(l)) };
  };

  const clean = secrets('clean', { [RECORD]: record(NAMES), [FIRST]: record([{ token: 'member-moss' }, ...NAMES]) });
  expect(clean.status).toBe('pass');
  expect(clean.allowlisted).toBeGreaterThan(0);
  expect(clean.reported).toEqual([]);

  const tokenKey = secrets('token-key', { [RECORD]: record([...NAMES, { token: keys[1]! }]) });
  expect(tokenKey.status).toBe('fail');
  expect(tokenKey.reported.length).toBeGreaterThan(0);

  const otherLine = secrets('other-line', { [RECORD]: record([...NAMES, { api_key: keys[0]! }]) });
  expect(otherLine.status).toBe('fail');
  expect(otherLine.reported.some((l) => l.startsWith('HIGH anthropic.key'))).toBe(true);

  const otherPath = secrets('other-path', { [OTHER]: record(NAMES) });
  expect(otherPath.status).toBe('fail');
  expect(otherPath.allowlisted).toBe(0);
  expect(otherPath.reported.some((l) => l.startsWith('MEDIUM env.kv'))).toBe(true);
}, 180_000);
