// The pregate allowlist entry for Lane B proxy session ids: each Harbor result.json the bridge writes carries
// `"session": "s-<12 hex>",` in its laneb block, which gstack-redact reports as env.kv. The entry in .gstack/pregate.json
// lets that line through on the two Harbor result.json paths. The pattern starts at the value, so it cannot check the
// key: any env.kv value of exactly that shape ending its line on those paths passes, and nothing else does.
//
// Value: protects=a real-shaped key in a Lane B result.json still fails the pregate secrets check, on the session line
// itself and on any other line of the file, and a session line outside the Harbor result.json paths is still reported;
// fails_when=the entry is widened to a general env.kv exemption, a whole-file or broader path exemption, or a pattern that
// covers more than the session id at the end of its line; why_new=the entry is new (internal-task, run
// laneb-tb2-replication-2026-10); seam=gstack-pregate --only secrets on a throwaway repository whose origin/main holds this
// repository's .gstack/pregate.json, when gstack is installed; no_claim=gstack-redact's detection of every key shape.
import { afterAll, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SCRUBBED_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME'].includes(k)).concat([['GIT_CONFIG_GLOBAL', '/dev/null'], ['GIT_CONFIG_NOSYSTEM', '1']])) as Record<string, string>;
const JOBS = 'docs/benchmarks/2026-10-30-fixture/results/haiku-gstack/laneb/jobs/run-haiku-gstack/task-a__AbC123/result.json';
const TRIALS = 'docs/benchmarks/2026-10-30-fixture/results/haiku-gstack/trials/haiku-gstack/task-a/r1/harbor/result.json';
const OTHER = 'docs/benchmarks/2026-10-30-fixture/results/haiku-gstack/result.json';
const SESSION = '"session": "s-0123456789ab",';
const PREGATE = [process.env.GSTACK_PREGATE, join(process.env.HOME ?? '', '.local', 'share', 'gstack', 'bin', 'gstack-pregate')].find((p) => p && existsSync(p));
const tmps: string[] = [];
afterAll(() => { for (const t of tmps) rmSync(t, { recursive: true, force: true }); });

const entry = () => (JSON.parse(readFileSync(join(ROOT, '.gstack', 'pregate.json'), 'utf8')).allowlist as Array<{ finding: string; paths?: string[]; pattern?: string }>)
  .filter((e) => e.paths?.some((p) => p.endsWith('/result.json')));
const fakeKey = () => [['sk', 'ant', 'api03'].join('-'), randomBytes(48).toString('hex').slice(0, 93) + 'AA'].join('-');
const resultJson = (laneb: string[]) => ['{', '  "trial_name": "task-a__AbC123",', '  "laneb": {', ...laneb.map((l) => `    ${l}`), '    "proxy": "laneb"', '  }', '}', ''].join('\n');

test('the session-id entry is env.kv on the two Harbor result.json globs, anchored at the value and ending the line', () => {
  const found = entry();
  expect(found).toEqual([expect.objectContaining({
    finding: 'env.kv',
    paths: ['docs/benchmarks/*/results/*/laneb/jobs/*/*/result.json', 'docs/benchmarks/*/results/*/trials/*/*/*/harbor/result.json'],
    pattern: 's-[0-9a-f]{12}",?\\s*$',
  })]);
  // gstack-pregate tests the pattern as ^(?:pattern)(?![\w-]) on the line from the finding's column, which gstack-redact
  // puts at the value
  const re = new RegExp(`^(?:${found[0]!.pattern})(?![\\w-])`);
  const at = (line: string) => line.slice(line.indexOf('"s-') + 1);
  expect(re.test(at(`    ${SESSION}`))).toBe(true);
  expect(re.test(at('    "session": "s-0123456789ab"'))).toBe(true);
  expect(re.test(at(`    ${SESSION}\r`))).toBe(true);
  expect(re.test(at('    "session": "s-0123456789abc",'))).toBe(false);
  expect(re.test(at('    "session": "s-0123456789AB",'))).toBe(false);
  expect(re.test(at(`    ${SESSION} "api_key": "${fakeKey()}",`))).toBe(false);
});

test.skipIf(!PREGATE)('gstack-pregate secrets lets session ids through on Harbor result.json paths and still fails a real-shaped key', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'he-pregate-allow-'));
  tmps.push(tmp);
  const bare = join(tmp, 'origin.git'), repo = join(tmp, 'repo');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env: SCRUBBED_ENV, encoding: 'utf8' });
  const write = (rel: string, text: string) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare], { env: SCRUBBED_ENV });
  mkdirSync(repo);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'pregate-allow@example.invalid');
  git('config', 'user.name', 'pregate allowlist test');
  git('remote', 'add', 'origin', bare);
  write('.gstack/pregate.json', readFileSync(join(ROOT, '.gstack', 'pregate.json'), 'utf8'));
  write('README.md', 'allowlist test\n');
  git('add', '-A'); git('commit', '-q', '-m', 'base'); git('push', '-q', 'origin', 'main');

  const key = fakeKey();
  const secrets = (branch: string, files: Record<string, string>) => {
    git('checkout', '-q', '-B', branch, 'main');
    for (const [rel, text] of Object.entries(files)) write(rel, text);
    git('add', '-A'); git('commit', '-q', '-m', branch);
    const run = spawnSync(PREGATE!, ['--only', 'secrets', '--stage', 'preflight', '--base', 'main', '--json'], { cwd: repo, encoding: 'utf8', env: { ...SCRUBBED_ENV, GSTACK_EPHEMERAL: '1' } });
    expect(run.stdout + run.stderr).not.toContain(key);
    const check = (JSON.parse(run.stdout).checks as Array<{ id: string; status: string; lines?: string[] }>).find((c) => c.id === 'secrets')!;
    const lines = check.lines ?? [];
    return { status: check.status, allowlisted: lines.filter((l) => l.startsWith('allowlisted env.kv')).length, reported: lines.filter((l) => !l.startsWith('allowlisted ')) };
  };

  expect(secrets('clean', { [JOBS]: resultJson([SESSION]), [TRIALS]: resultJson([SESSION]) })).toEqual({ status: 'pass', allowlisted: 2, reported: [] });
  const lastKey = ['{', '  "laneb": {', '    "proxy": "laneb",', '    "session": "s-0123456789ab"', '  }', '}', ''].join('\n');
  expect(secrets('last-key', { [JOBS]: lastKey })).toEqual({ status: 'pass', allowlisted: 1, reported: [] });

  const sameLine = secrets('same-line', { [JOBS]: resultJson([`${SESSION} "api_key": "${key}",`]) });
  expect(sameLine.status).toBe('fail');
  expect(sameLine.allowlisted).toBe(0);
  expect(sameLine.reported.some((l) => l.startsWith('HIGH anthropic.key'))).toBe(true);

  const keyFirst = secrets('key-first', { [JOBS]: resultJson([`"api_key": "${key}", ${SESSION}`]) });
  expect(keyFirst.status).toBe('fail');
  expect(keyFirst.reported.some((l) => l.startsWith('HIGH anthropic.key'))).toBe(true);

  const elsewhere = secrets('elsewhere', { [TRIALS]: resultJson([SESSION, `"api_key": "${key}",`]) });
  expect(elsewhere.status).toBe('fail');
  expect(elsewhere.allowlisted).toBe(1);
  expect(elsewhere.reported.some((l) => l.startsWith('HIGH anthropic.key'))).toBe(true);

  const otherPath = secrets('other-path', { [OTHER]: resultJson([SESSION]) });
  expect(otherPath.status).toBe('fail');
  expect(otherPath.allowlisted).toBe(0);
  expect(otherPath.reported.some((l) => l.startsWith('MEDIUM env.kv'))).toBe(true);
}, 120_000);
