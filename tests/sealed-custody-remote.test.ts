// internal-task phase 3, sealed custody: where custody writes may go and how two processes share one custody clone.
//
// Value: protects=checkCustodyRemote classifies only a file:// URL or an existing local directory as local and requires
// every other URL to be https, ssh or the scp form (with or without a user) naming garrytan/harness-evals, refusing
// http://, git:// and remote-helper schemes; every fetch and push
// checks each URL the remote resolves to (configured fetch and push URLs, a raw --remote value, insteadOf and
// pushInsteadOf rewrites) before anything leaves the clone; compareAndPush holds the clone's lock from the sync through
// the push and pushes the commit it validated, so two processes on one clone both land and each gets back the commit
// holding its own line; a lock whose pid is dead, or that has had no pid for 30 s, is taken over and a live one times out
// with HE-SEALED-011;
// fails_when=a fork URL, a push URL or a rewrite to a fork reaches git push, a same-clone race loses a line or returns
// another process's commit, or a stale lock blocks custody forever; why_new=the remote resolution and the clone lock are
// new; seam=custody.ts in-process and as bun subprocesses, keygen.ts --re-escrow as a subprocess, against a throwaway bare
// repository with an orphan custody branch; no_claim=GitHub's own access control, or which hosts may serve the repository.
import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCustodyRemote, compareAndPush, initCustodyClone, readAccessLog, syncCustody, type AccessEvent } from '../scripts/sealed/custody.ts';
import { fakeGh } from './sealed-fixture.ts';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-custody-remote-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const FORK = 'https://github.com/someone/harness-evals.git';

const bare = join(tmp, 'origin.git');
execFileSync('git', ['init', '-q', '--bare', bare]);
const seed = join(tmp, 'seed');
execFileSync('git', ['init', '-q', '-b', 'custody', seed]);
g(seed, 'config', 'user.email', 'custody-remote-test@example.invalid'); g(seed, 'config', 'user.name', 'custody remote test');
writeFileSync(join(seed, 'README.md'), 'synthetic custody branch\n');
g(seed, 'add', '-A'); g(seed, 'commit', '-q', '-m', 'custody: readme'); g(seed, 'push', '-q', bare, 'HEAD:refs/heads/custody');

let clones = 0;
function clone(): string {
  const d = join(tmp, `clone-${++clones}`);
  initCustodyClone(d, bare);
  g(d, 'config', 'user.email', 'custody-remote-test@example.invalid');
  g(d, 'config', 'user.name', 'custody remote test');
  return d;
}
const event = (run: string): AccessEvent => ({ schema_version: 1, event: 'opened', at: 't', run_id: run, set: 'remote', label: 'dev', custodian: run });
const tip = () => g(bare, 'rev-parse', 'refs/heads/custody');

// synthetic userinfo in these URLs is split at the @ so the pregate's credential scanner does not read a test input as a secret
const AT = '@';

describe('the custody remote', () => {
  test('checkCustodyRemote accepts garrytan/harness-evals over the network and existing local directories, and refuses everything else', () => {
    mkdirSync(join(tmp, 'local-bare'));
    const accepted = ['https://github.com/garrytan/harness-evals.git', 'https://github.com/garrytan/harness-evals', 'git@github.com:garrytan/harness-evals.git', 'ssh://git@github.com/garrytan/harness-evals.git', 'https://git.capy.ai/garrytan/harness-evals.git', 'github.com:garrytan/harness-evals.git', bare, 'local-bare', './local-bare', `file://${join(tmp, 'anything')}`];
    for (const url of accepted) expect(checkCustodyRemote(url, tmp)).toBe(url);
    const refused = [FORK, 'https://github.com/someone/fork.git', 'ssh://git@github.com/someone/fork.git', 'git@github.com:someone/fork.git', 'github.com:someone/fork.git', 'missing:dir/repo', 'missing-dir/sub:repo', 'local-bare:x', 'https://github.com/garrytan/harness-evals-fork.git', 'https://github.com/garrytan/harness-evals.git/extra', ''];
    for (const url of refused) expect(() => checkCustodyRemote(url, tmp), url).toThrow(/^HE-SEALED-013 the custody remote URL .* is not garrytan\/harness-evals/);
    // the refusal names the URL without its credentials
    let message = '';
    try { checkCustodyRemote(`https://user:secret-token${AT}github.com/someone/fork.git`, tmp); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('https://github.com/someone/fork.git');
    expect(message).not.toContain('secret-token');
  });

  test('checkCustodyRemote allows only github.com and git.capy.ai as the host of a network custody URL', () => {
    const accepted = ['https://GitHub.com/garrytan/harness-evals.git', 'ssh://git@github.com:22/garrytan/harness-evals.git', `https://user:token${AT}git.capy.ai/garrytan/harness-evals.git`, 'git@git.capy.ai:garrytan/harness-evals.git', 'git.capy.ai:garrytan/harness-evals'];
    for (const url of accepted) expect(checkCustodyRemote(url, tmp)).toBe(url);
    const refused = ['https://gitlab.com/garrytan/harness-evals.git', 'git@evil.example:garrytan/harness-evals.git', 'evil.example:garrytan/harness-evals', 'ssh://git@capy.ai/garrytan/harness-evals.git', 'https://github.com.evil.example/garrytan/harness-evals.git', 'https://evil.example/github.com/garrytan/harness-evals.git', 'https://github.com/x/garrytan/harness-evals.git', 'https://user@evil.example@github.com/garrytan/harness-evals.git', 'http://127.0.0.1/garrytan/harness-evals.git', `http://127.0.0.1:9#${AT}github.com/garrytan/harness-evals.git`, `http://127.0.0.1:9?${AT}github.com/garrytan/harness-evals.git`, 'https://evil.example\\@github.com/garrytan/harness-evals.git', 'https://github.com/garrytan/harness-evals.git#x', 'https://github.com/garrytan/harness-evals.git?x', 'evil.example# @github.com:garrytan/harness-evals.git', 'http://github.com/garrytan/harness-evals', 'http://github.com/garrytan/harness-evals.git', 'git://github.com/garrytan/harness-evals.git', 'foo://github.com/garrytan/harness-evals', 'git+ssh://git@github.com/garrytan/harness-evals.git', 'HTTPS://github.com/garrytan/harness-evals.git', 'ext::github.com/garrytan/harness-evals', 'github.com::garrytan/harness-evals'];
    for (const url of refused) expect(() => checkCustodyRemote(url, tmp), url).toThrow(/^HE-SEALED-013 the custody remote URL .* is not garrytan\/harness-evals on github\.com or git\.capy\.ai over https or ssh/);
  });

  test('a fork as --remote, as a configured remote, as a push URL or through a pushInsteadOf rewrite is refused before any fetch or push', () => {
    const before = tip();
    const decisions: string[] = [];
    const attempt = (c: string, remote: string) => () => compareAndPush(c, { remote, message: () => 'must not land', decide: () => { decisions.push(remote); return event('fork'); } });
    const c = clone();
    expect(attempt(c, FORK)).toThrow(/HE-SEALED-013/);
    expect(() => syncCustody(c, FORK)).toThrow(/HE-SEALED-013/);
    g(c, 'remote', 'add', 'fork', 'github.com:someone/fork.git');
    expect(attempt(c, 'fork')).toThrow(/HE-SEALED-013/);
    g(c, 'remote', 'set-url', '--push', 'origin', FORK);
    expect(attempt(c, 'origin')).toThrow(/HE-SEALED-013/);
    const r = clone();
    g(r, 'config', `url.${FORK}.pushInsteadOf`, bare);
    expect(attempt(r, bare)).toThrow(/HE-SEALED-013/);
    expect(decisions).toEqual([]);
    expect(tip()).toBe(before);
    expect(existsSync(join(c, '.git', 'custody.lock'))).toBe(false);
    // the same clone pushes once every URL of its remote is the custody repository's
    g(c, 'remote', 'set-url', '--delete', '--push', 'origin', FORK);
    expect(compareAndPush(c, { message: () => 'lands', decide: () => event('origin-ok') }).commit).toBe(tip());
  }, 60_000);

  test('keygen.ts --re-escrow --remote <a fork> is refused with HE-SEALED-013 before anything is pushed', () => {
    const repo = join(tmp, 'public');
    execFileSync('git', ['init', '-q', repo]);
    mkdirSync(join(repo, 'sealed'));
    writeFileSync(join(repo, 'sealed', 'recipient.txt'), 'age1syntheticrecipientforthecustodyremotetest\n');
    g(repo, 'remote', 'add', 'origin', bare);
    const c = clone();
    const before = tip();
    const r = spawnSync('bun', [join(ROOT, 'scripts', 'sealed', 'keygen.ts'), '--re-escrow', '--identity', join(tmp, 'no-identity'), '--custody', c, '--repo', repo, '--remote', FORK, '--gh', fakeGh(join(tmp, 'gh-bin'), 'true')],
      { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, UBICLOUD_API_KEY: 'throwaway-value-for-the-remote-test' } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('HE-SEALED-013 the custody remote URL https://github.com/someone/harness-evals.git is not garrytan/harness-evals');
    expect(r.stderr).not.toContain('throwaway-value');
    expect(tip()).toBe(before);
  }, 60_000);
});

describe('the custody clone lock', () => {
  test('two processes appending to one clone both land, and each gets back the commit that holds its own line', async () => {
    const c = clone();
    const script = join(tmp, 'append.ts');
    writeFileSync(script, `import { compareAndPush } from ${JSON.stringify(join(ROOT, 'scripts', 'sealed', 'custody.ts'))};
const [clone, name] = process.argv.slice(2);
const r = compareAndPush(clone!, {
  message: () => 'append ' + name,
  decide: () => ({ schema_version: 1, event: 'opened', at: 't', run_id: name!, set: 'lock', label: 'dev', custodian: name! }),
  beforePush: () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500); },
});
console.log(JSON.stringify({ commit: r.commit, line: r.line }));
`);
    const procs = ['lock-a', 'lock-b'].map((name) => Bun.spawn(['bun', script, c, name], { stdout: 'pipe', stderr: 'pipe' }));
    const results = await Promise.all(procs.map(async (p) => ({ code: await p.exited, out: await new Response(p.stdout).text(), err: await new Response(p.stderr).text() })));
    for (const r of results) expect(r.code, r.err).toBe(0);
    const pushed = results.map((r) => JSON.parse(r.out) as { commit: string; line: string });
    expect(pushed[0]!.commit).not.toBe(pushed[1]!.commit);
    for (const p of pushed) expect(execFileSync('git', ['cat-file', 'blob', `${p.commit}:access-log.jsonl`], { cwd: bare, encoding: 'utf8' }).split('\n')).toContain(p.line);
    expect(readAccessLog(clone()).filter((e) => e.set === 'lock').map((e) => e.run_id).sort()).toEqual(['lock-a', 'lock-b']);
    expect([pushed[0]!.commit, pushed[1]!.commit]).toContain(tip());
    expect(existsSync(join(c, '.git', 'custody.lock'))).toBe(false);
  }, 60_000);

  test('a lock left by a dead process is taken over; a lock held by a live process times out with HE-SEALED-011 and nothing is pushed', () => {
    const c = clone();
    const lock = join(c, '.git', 'custody.lock');
    const dead = spawnSync('true').pid;
    mkdirSync(lock);
    writeFileSync(join(lock, 'pid'), `${dead}\n`);
    const r = compareAndPush(c, { message: () => 'after a dead lock', decide: () => event('dead-lock') });
    expect(r.commit).toBe(tip());
    expect(existsSync(lock)).toBe(false);
    mkdirSync(lock);
    writeFileSync(join(lock, 'pid'), `${process.pid}\n`);
    const before = tip();
    try {
      expect(() => compareAndPush(c, { lockWaitMs: 600, message: () => 'blocked', decide: () => event('blocked') })).toThrow(`HE-SEALED-011 the custody clone ${c} is locked by process ${process.pid} (${lock})`);
    } finally { rmSync(lock, { recursive: true, force: true }); }
    expect(tip()).toBe(before);
  }, 60_000);

  test('a lock with no pid is taken over only once it is 30 s old; a lock made by a custody command holds its pid', () => {
    const c = clone();
    const lock = join(c, '.git', 'custody.lock');
    mkdirSync(lock);
    const before = tip();
    expect(() => compareAndPush(c, { lockWaitMs: 600, message: () => 'blocked', decide: () => event('no-pid-young') })).toThrow(`HE-SEALED-011 the custody clone ${c} is locked by process (no pid yet) (${lock})`);
    expect(tip()).toBe(before);
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    let pid = '';
    const r = compareAndPush(c, { message: () => 'after a pid-less lock', decide: () => { pid = readFileSync(join(lock, 'pid'), 'utf8').trim(); return event('no-pid-old'); } });
    expect(r.commit).toBe(tip());
    expect(pid).toBe(String(process.pid));
    expect(readdirSync(join(c, '.git')).filter((n) => n.startsWith('custody.lock'))).toEqual([]);
  }, 60_000);
});
