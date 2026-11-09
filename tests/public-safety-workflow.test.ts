// .github/workflows/public-safety.yml: the gate copy a run uses, and the check name each event reports. The gate step's
// own shell runs here against scratch repositories, so a push is judged by the default branch head's gate (fetched
// fresh from origin), never by the pushed branch's previous head, and a pull request by its base commit's gate.
// Keyless; every spawned process gets PATH, HOME and TMPDIR plus the step's own variables.
import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const WORKFLOW = Bun.YAML.parse(readFileSync(join(ROOT, '.github', 'workflows', 'public-safety.yml'), 'utf8')) as { jobs: Record<string, { name: string; steps: { name?: string; run?: string }[] }> };
const JOB = WORKFLOW.jobs['public-safety']!;
const tmp = mkdtempSync(join(tmpdir(), 'he-public-safety-workflow-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, TMPDIR: tmpdir(), GIT_CONFIG_NOSYSTEM: '1' };

const sh = (cwd: string, cmd: string[], extra: Record<string, string> = {}) => {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(cmd.join(' ') + ': ' + r.stderr);
  return r.stdout.trim();
};

test('a pull request reports the required check public-safety, and a push reports public-safety-push', () => {
  expect(JOB.name).toBe("${{ github.event_name == 'push' && 'public-safety-push' || 'public-safety' }}");
});

test('a push runs the default branch head\'s gate fetched from origin; a pull request runs its base commit\'s gate', () => {
  const step = JOB.steps.find((s) => s.name === 'The gate copy')!;
  const origin = join(tmp, 'origin.git');
  const seed = join(tmp, 'seed');
  sh(tmp, ['git', 'init', '-q', '--bare', '-b', 'main', origin]);
  sh(tmp, ['git', 'init', '-q', '-b', 'main', seed]);
  const g = (...a: string[]) => sh(seed, ['git', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a]);
  const put = (text: string, msg: string) => { mkdirSync(join(seed, 'scripts', 'public-safety'), { recursive: true }); writeFileSync(join(seed, 'scripts', 'public-safety', 'check.ts'), text); g('add', '-A'); g('commit', '-q', '-m', msg); return g('rev-parse', 'HEAD'); };
  put('// main gate v1\n', 'main v1');
  g('remote', 'add', 'origin', origin);
  g('push', '-q', 'origin', 'main');
  g('checkout', '-q', '-b', 'feature');
  const before = put('// weakened gate\n', 'weaken');
  g('push', '-q', 'origin', 'feature');
  const work = join(tmp, 'work');
  sh(tmp, ['git', 'clone', '-q', origin, work]);
  g('checkout', '-q', 'main');
  const mainHead = put('// main gate v2\n', 'main v2');
  g('push', '-q', 'origin', 'main');
  const run = (event: string, base: string) => {
    const temp = mkdtempSync(join(tmp, 'runner-'));
    const out = join(temp, 'output');
    writeFileSync(out, '');
    sh(work, ['bash', '-c', step.run!], { GITHUB_EVENT_NAME: event, BASE: base, DEFAULT_BRANCH: 'main', RUNNER_TEMP: temp, GITHUB_OUTPUT: out });
    return { gate: readFileSync(join(temp, 'gate', 'scripts', 'public-safety', 'check.ts'), 'utf8'), output: readFileSync(out, 'utf8') };
  };
  const push = run('push', before);
  expect(push.gate).toBe('// main gate v2\n');
  expect(push.output).toContain('gate=' + mainHead + '\n');
  expect(run('pull_request', before).gate).toBe('// weakened gate\n');
});
