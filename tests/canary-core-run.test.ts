// scripts/canary/run.sh and receipts.sh end to end, keyless: a throwaway clean checkout holding the canary core and stub
// suite scripts (tests/fixtures/canary-core/stub-*.sh) that emit contract-shaped t0.json and trials.jsonl, a local bare
// repository as the receipts remote, and the recorded refs of 2026-11-09 for releases. Every process runs under env -i with an
// allowlist.
//
// Value: protects=the orchestrator's order (lock, releases, state, T0, T1, T2, T3), its exit codes (0 OK/WATCH/REGRESSION,
// 10 BROKEN, 30 INCOMPLETE), the alert block, the history lines and the receipts branch; fails_when=a failure path exits
// silently, a stub crash is not INCOMPLETE, a planted regression does not reach T3, or the rig check is skipped;
// seam=stub suites and a bare remote; no_claim=the real rigs (scripts/canary/gstack and gbrain have their own tests).
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const FIX = join(ROOT, 'tests/fixtures/canary-core');
const tmp = mkdtempSync(join(tmpdir(), 'canary-core-run-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const PREREG = 'docs/benchmarks/2026-11-09-regression-canary/prereg-canary.json';
const SHA = { gs196: '6666b7296766f8e0c9f3cc44b70fd1eff6ad2e92', gs197: 'e75a69c9e15164d090e080fa001dc515495ec350', gb593: '27f8b9d6287c2ba635532c7d3bc015c50e1d769b', gb613: '98dda48fb9fd339609d6d4eef009811280ff648d' };

function sh(cmd: string[], cwd: string, env: Record<string, string>) {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(cmd.join(' ') + ': ' + r.stderr);
  return r.stdout.trim();
}

/** A clean checkout: commit A holds the rig; main (commit B) names A as canary_rig; HEAD is A, detached. */
function rig(opts: { headIsRig?: boolean; prereg?: (p: any) => void } = {}) {
  const base = mkdtempSync(join(tmp, 'case-'));
  const home = join(base, 'home'), repo = join(base, 'repo'), remote = join(base, 'receipts.git');
  mkdirSync(home);
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = canary fixture\n\temail = fixture@example.invalid\n[init]\n\tdefaultBranch = main\n');
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home };
  mkdirSync(repo);
  for (const p of ['runner', 'scripts/publish-audit.ts', 'docs/benchmarks/2026-11-09-regression-canary', 'tests/fixtures/canary-core']) cpSync(join(ROOT, p), join(repo, p), { recursive: true });
  mkdirSync(join(repo, 'scripts/canary'), { recursive: true });
  for (const f of ['run.sh', 'receipts.sh', 'receipts.ts', 'decide.ts', 'alert.ts', 'releases.ts', 'lease.ts']) copyFileSync(join(ROOT, 'scripts/canary', f), join(repo, 'scripts/canary', f));
  for (const s of ['gstack', 'gbrain']) {
    mkdirSync(join(repo, 'scripts/canary', s));
    copyFileSync(join(FIX, 'stub-t0.sh'), join(repo, 'scripts/canary', s, 't0.sh'));
    copyFileSync(join(FIX, 'stub-run-tier.sh'), join(repo, 'scripts/canary', s, 'run-tier.sh'));
  }
  if (opts.prereg) {
    const p = JSON.parse(readFileSync(join(repo, PREREG), 'utf8'));
    opts.prereg(p);
    writeFileSync(join(repo, PREREG), JSON.stringify(p, null, 2) + '\n');
  }
  const g = (...a: string[]) => sh(['git', ...a], repo, env);
  g('init', '-q'); g('add', '-A'); g('commit', '-q', '-m', 'rig');
  const a = g('rev-parse', 'HEAD');
  const prereg = JSON.parse(readFileSync(join(repo, PREREG), 'utf8'));
  prereg.canary_rig = a;
  writeFileSync(join(repo, PREREG), JSON.stringify(prereg, null, 2) + '\n');
  g('commit', '-q', '-am', 'name the rig');
  if (opts.headIsRig !== false) g('checkout', '-q', '--detach', a);
  sh(['git', 'init', '-q', '--bare', remote], base, env);
  const runEnv = { ...env, CANARY_RECEIPTS_REMOTE: remote, CANARY_RELEASES_FIXTURE: join(repo, 'tests/fixtures/canary-core/refs-2026-11-09.json'), CANARY_WORK: join(base, 'work'), CANARY_PREGATE: '/nonexistent' };
  const run = (args: string[], extra: Record<string, string> = {}) => {
    const r = spawnSync('bash', [join(repo, 'scripts/canary/run.sh'), ...args], { cwd: repo, env: { ...runEnv, ...extra }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const history = () => sh(['git', '--git-dir', remote, 'show', 'canary-receipts:history.jsonl'], base, env).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const tree = () => sh(['git', '--git-dir', remote, 'ls-tree', '-r', '--name-only', 'canary-receipts'], base, env).split('\n');
  return { base, repo, remote, run, history, tree, env: runEnv };
}
type Rig = ReturnType<typeof rig>;
const common = ['--fake', '--local', '--prereg-ref', 'main'];
const baseline = (r: Rig, gstackNew = SHA.gs197) => r.run(['--baseline', ...common, '--run-id', 'base', '--now', '2026-11-09T09:00:00Z', '--drive-dir', join(r.base, 'drive'),
  '--gstack-prev', SHA.gs196, '--gstack-new', gstackNew, '--gbrain-prev', SHA.gb593, '--gbrain-new', SHA.gb613]);
const nightly = (r: Rig, id: string, now: string, extra: Record<string, string> = {}) => r.run([...common, '--run-id', id, '--now', now, '--drive-dir', join(r.base, 'drive')], extra);
const block = (out: string) => out.match(/CANARY_ALERT_BEGIN\n([\s\S]*?)CANARY_ALERT_END/)?.[1] ?? null;
const calls = (r: Rig, id: string) => readFileSync(join(r.base, 'work', id, 'out/calls.log'), 'utf8');

describe('run.sh end to end with stub suites', () => {
  test('baseline, then an OK move, then a quiet night, then the dead-man check', () => {
    const r = rig();
    const b = baseline(r);
    expect(b.err).not.toContain('stopped unexpectedly');
    expect(b.code).toBe(0);
    expect(r.history().map((h) => [h.product, h.status, h.tiers.join(','), h.mode])).toEqual([['gstack', 'OK', 'T0,T2', 'baseline'], ['gbrain', 'OK', 'T0,T2', 'baseline']]);
    expect(calls(r, 'base')).toBe('T2 opus,sol plain,prev,new 3\nT2 opus,sol,particle plain,prev,new 3\n');
    const n = nightly(r, 'night1', '2026-11-10T09:30:00Z');
    expect(n.err).not.toContain('stopped unexpectedly');
    expect(n.code).toBe(0);
    expect(block(n.out)).toBeNull();
    expect(n.out).toContain('Harness Evals canary: OK in gstack stable 1.98.0.0 (91009308), previous 1.97.0.0 (e75a69c9); tiers T0,T1');
    const h = r.history().at(-1);
    expect([h.product, h.status, h.tiers, h.new.version, h.lease_month]).toEqual(['gstack', 'OK', ['T0', 'T1'], '1.98.0.0', '2026-11']);
    expect(h.spend_usd).toBeCloseTo(4, 6);
    for (const f of ['verdict.json', 'alert.md', 'summary.md']) expect(existsSync(join(r.base, 'drive/canary/runs/night1', f))).toBe(true);
    expect(r.tree()).toEqual(expect.arrayContaining(['leases/canary-2026-11.sqlite', 'leases/canary-baseline.sqlite', 'runs/night1/gstack/verdict.json', 'runs/night1/gstack/T1/trials.jsonl']));
    expect(r.tree()).not.toContain('lock.json');
    const q = nightly(r, 'night2', '2026-11-11T09:30:00Z');
    expect(q.code).toBe(0);
    expect(q.out.trim()).toBe('Harness Evals canary: OK, no stable move (gstack 1.98.0.0 at 91009308, gbrain 0.60.613.0 at 98dda48f)');
    expect(r.history().at(-1)).toMatchObject({ product: null, status: 'OK', run_id: 'night2' });
    expect(r.run(['dead-man', '--now', '2026-11-12T09:00:00Z']).code).toBe(0);
    const dead = r.run(['dead-man', '--now', '2026-11-13T10:00:00Z']);
    expect(dead.code).toBe(30);
    expect(block(dead.out)).toContain('no run has reported for 48.5 hours');
  }, 300_000);

  test('BROKEN at T0 exits 10 with the alert block and runs no paid tier', () => {
    const r = rig();
    expect(baseline(r).code).toBe(0);
    const n = nightly(r, 'broken', '2026-11-10T09:30:00Z', { CANARY_STUB_MODE: 'broken', CANARY_STUB_SUITE: 'gstack' });
    expect(n.code).toBe(10);
    const alert = block(n.out)!;
    expect(alert).toStartWith('Harness Evals canary: BROKEN in gstack stable 1.98.0.0 (91009308), previous 1.97.0.0 (e75a69c9)\n');
    expect(alert).toContain('- Suggested owner: internal-task; what to check first: install: skills_installed on claude-code (new arm)');
    expect(existsSync(join(r.base, 'work/broken/out/calls.log'))).toBe(false);
    expect(r.history().at(-1)).toMatchObject({ product: 'gstack', status: 'BROKEN', tiers: ['T0'] });
  }, 300_000);

  test('a planted regression goes T1 -> T2 -> T3 and ends REGRESSION', () => {
    const r = rig();
    expect(baseline(r).code).toBe(0);
    const n = nightly(r, 'regress', '2026-11-10T09:30:00Z', { CANARY_STUB_MODE: 'regress', CANARY_STUB_SUITE: 'gstack' });
    expect(n.err).not.toContain('stopped unexpectedly');
    expect(n.code).toBe(0);
    expect(calls(r, 'regress')).toBe('T1 opus,sol prev,new 1\nT2 opus,sol plain,prev,new 1\nT3 opus prev,new 2\n');
    const alert = block(n.out)!;
    expect(alert).toStartWith('Harness Evals canary: REGRESSION in gstack stable 1.98.0.0 (91009308), previous 1.97.0.0 (e75a69c9)\n');
    expect(alert).toContain('- What moved: Opus 5.5 in Claude Code: pass 30/30 -> 18/30 (12 tasks got worse, 0 got better; screen p 0.0002; confirm -40.0 points [');
    expect(alert).toContain('- Exposure: called in 60/60 -> 60/60; install route ./setup --host claude at 91009308');
    expect(alert).toContain('- Releases in range: 1.98.0.0; bisect: not run');
    const v = JSON.parse(readFileSync(join(r.base, 'drive/canary/runs/regress/verdict.json'), 'utf8'));
    expect([v.status, v.products.gstack.tiers_run]).toEqual(['REGRESSION', ['T0', 'T1', 'T2', 'T3']]);
    expect(r.history().at(-1)).toMatchObject({ product: 'gstack', status: 'REGRESSION', tiers: ['T0', 'T1', 'T2', 'T3'] });
  }, 300_000);

  test('two stable moves in range: a confirmed regression is bisected to the first bad release', () => {
    const r = rig();
    expect(baseline(r, SHA.gs196).code).toBe(0);
    const n = nightly(r, 'bisect', '2026-11-10T09:30:00Z', { CANARY_STUB_MODE: 'regress', CANARY_STUB_SUITE: 'gstack' });
    expect(n.err).not.toContain('stopped unexpectedly');
    expect(n.code).toBe(0);
    expect(calls(r, 'bisect')).toBe('T1 opus,sol prev,new 1\nT2 opus,sol plain,prev,new 1\nT3 opus prev,new 2\nT3 opus prev,new 2\n');
    const alert = block(n.out)!;
    expect(alert).toStartWith('Harness Evals canary: REGRESSION in gstack stable 1.98.0.0 (91009308), previous 1.96.0.0 (6666b729)\n');
    expect(alert).toContain('- Releases in range: 1.97.0.0, 1.98.0.0; bisect: 1.97.0.0');
  }, 300_000);

  test('a used-up monthly lease runs T0 and T1 only, says so, and runs the pending T2 when the lease renews', () => {
    const r = rig({ prereg: (p) => { p.leases.monthly.cap_usd = 300; p.leases.per_run_usd.T2.gstack = 90; } });
    expect(baseline(r).code).toBe(0);
    const n = nightly(r, 'dry', '2026-11-10T09:30:00Z', { CANARY_STUB_MODE: 'regress', CANARY_STUB_SUITE: 'gstack', CANARY_STUB_USD: '6' });
    expect(n.code).toBe(0);
    expect(calls(r, 'dry')).toBe('T1 opus,sol prev,new 1\n');
    expect(block(n.out)).toStartWith('Harness Evals canary: WATCH in gstack stable 1.98.0.0 (91009308)');
    const v = JSON.parse(readFileSync(join(r.base, 'drive/canary/runs/dry/verdict.json'), 'utf8')).products.gstack;
    expect(v.notes).toContain('the canary-2026-11.sqlite lease is used up: T2 did not run (it runs when the lease renews)');
    expect(r.history().at(-1)).toMatchObject({ product: 'gstack', status: 'WATCH', pending: 'T2', lease_month: '2026-11' });
    expect(nightly(r, 'same-month', '2026-11-11T09:30:00Z').out.trim()).toStartWith('Harness Evals canary: OK, no stable move');
    const renewed = nightly(r, 'renewed', '2026-12-01T09:30:00Z');
    expect(renewed.code).toBe(0);
    expect(calls(r, 'renewed')).toContain('T2 opus,sol plain,prev,new 1\n');
    expect(r.history().filter((h) => h.run_id === 'renewed').map((h) => [h.product, h.status, h.tiers.join(',')])).toContainEqual(['gstack', 'OK', 'T0,T2']);
  }, 300_000);

  test('a stub crash is INCOMPLETE with a verdict, a history line, the alert and exit 30; the next night retries', () => {
    const r = rig();
    expect(baseline(r).code).toBe(0);
    const n = nightly(r, 'crash', '2026-11-10T09:30:00Z', { CANARY_STUB_MODE: 'crash', CANARY_STUB_SUITE: 'gstack' });
    expect(n.code).toBe(30);
    expect(block(n.out)).toContain('Harness Evals canary: INCOMPLETE in gstack stable 1.98.0.0');
    expect(block(n.out)).toContain('what to check first: the T1 run log of the gstack rig');
    expect(r.history().at(-1)).toMatchObject({ product: 'gstack', status: 'INCOMPLETE' });
    const again = nightly(r, 'retry', '2026-11-11T09:30:00Z');
    expect(again.code).toBe(0);
    expect(r.history().at(-1)).toMatchObject({ run_id: 'retry', product: 'gstack', status: 'OK' });
  }, 300_000);

  test('no history is INCOMPLETE until a baseline runs, and a fresh lock held by another run refuses', () => {
    const r = rig();
    const n = nightly(r, 'first', '2026-11-10T09:30:00Z');
    expect(n.code).toBe(30);
    expect(block(n.out)).toContain('what to check first: run scripts/canary/run.sh --baseline first');
    expect(r.history().map((h) => [h.product, h.status])).toEqual([['gstack', 'INCOMPLETE'], ['gbrain', 'INCOMPLETE']]);
    spawnSync('bash', [join(r.repo, 'scripts/canary/receipts.sh'), 'lock', '--run-id', 'other', '--now', '2026-11-10T10:00:00Z'], { env: r.env });
    const locked = nightly(r, 'second', '2026-11-10T11:00:00Z');
    expect(locked.code).toBe(30);
    expect(block(locked.out)).toContain('what to check first: the run named in canary-receipts lock.json');
    expect(r.tree()).toContain('lock.json');
  }, 300_000);

  test('it refuses unless HEAD is the canary_rig commit, and says so as INCOMPLETE', () => {
    const r = rig({ headIsRig: false });
    const n = nightly(r, 'wrongrig', '2026-11-10T09:30:00Z');
    expect(n.code).toBe(30);
    expect(block(n.out)).toContain('run from a worktree pinned at canary_rig');
    expect(r.history().map((h) => h.status)).toEqual(['INCOMPLETE', 'INCOMPLETE']);
    expect(existsSync(join(r.base, 'work/wrongrig/out/gstack/T0'))).toBe(false);
  }, 120_000);
  test('receipts cat exits 1 only for a missing branch or file and 6 when the remote cannot be read, so a network failure never resets a lease', () => {
    const r = rig();
    const cat = (remote: string, path: string) => spawnSync('bash', [join(r.repo, 'scripts/canary/receipts.sh'), 'cat', '--remote', remote, '--path', path, '--out', join(r.base, 'cat.out')], { cwd: r.repo, env: r.env, encoding: 'utf8' }).status;
    expect(cat(r.remote, 'leases/canary-baseline.sqlite')).toBe(1);
    expect(cat(join(r.base, 'no-such-remote.git'), 'leases/canary-baseline.sqlite')).toBe(6);
    expect(baseline(r).code).toBe(0);
    expect(cat(r.remote, 'leases/canary-baseline.sqlite')).toBe(0);
    expect(cat(r.remote, 'leases/canary-2030-01.sqlite')).toBe(1);
    expect(cat(join(r.base, 'no-such-remote.git'), 'leases/canary-baseline.sqlite')).toBe(6);
  }, 120_000);
});
