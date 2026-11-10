// scripts/replicate.ts (internal-task PR 2, docs/replicate.md), keyless. A small H1 bundle is built from the committed receipts;
// paid-path tests replace Docker and the runner (tests/fixtures/replicate/fake-runner.ts drives the REAL metering proxy in
// lease mode against a fake Anthropic upstream with a placeholder key), so the lease, the cap stop, SIGINT and --resume are
// exercised end to end without a container or a real key.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, sha256 } from '../scripts/bundle.ts';
import { packBundleArchive, readBundleArchive } from '../runner/archive.ts';
import { closeLedgers, ledgerStatus } from '../runner/ledger/budget-ledger.ts';
import { chargedUnrecorded, compare, keyTrial, main, parseArgs, readFinding, redact, type Deps } from '../scripts/replicate.ts';

const ROOT = resolve(import.meta.dir, '..');
const FAKE = join(ROOT, 'tests', 'fixtures', 'replicate', 'fake-runner.ts');
const CELL = 'openclaw-sonnet-mu-heldout';
const HEAD = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: ROOT }).stdout.toString().trim();
let tmp = '';
let bundle = '';
let digest = '';
const outs: string[] = [];

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'replicate-test-'));
  const b = build({ root: ROOT, run: 'docs/benchmarks/2026-10-24-m3-heldout', finding: 'h1-test', analyses: ['summarize-run'], out: join(tmp, 'h1.bundle.tar.gz') });
  bundle = b.path;
  digest = b.sha256;
}, 120_000);
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); for (const o of outs) rmSync(o, { recursive: true, force: true }); });

function deps(over: Partial<Deps> = {}, fakeEnv: Record<string, string> = {}) {
  const lines: string[] = [];
  const calls: string[] = [];
  const d: Deps = {
    platform: 'linux', arch: 'x64',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY: 'placeholder-anthropic' },
    isTTY: false, readLine: async () => '',
    fetch: (async () => { throw new Error('no network in tests'); }) as unknown as typeof fetch,
    sleep: async () => {},
    docker: (args) => { calls.push(`docker ${args[0]}`); return { status: 0, stdout: args[0] === 'image' ? 'sha256:fake\n' : '', stderr: '' }; },
    freeBytes: () => 100 * 1024 ** 3,
    startRunner: (args, env) => { calls.push(`runner ${args[0]}`); return spawn(process.execPath, [FAKE, ...args], { cwd: ROOT, env: { ...env, ...fakeEnv }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); },
    out: (l) => lines.push(l), err: (l) => lines.push(l),
    now: () => new Date('2026-11-01T00:00:00Z'),
    checkout: () => ({ commit: HEAD, dirty: [] }),
    ...over,
  };
  return { d, lines, calls };
}
const newOut = (name: string) => { const o = join(ROOT, 'replications', `test-${name}-${process.pid}`); rmSync(o, { recursive: true, force: true }); outs.push(o); return o; };
const report = (out: string) => JSON.parse(readFileSync(join(out, 'replicate-report.json'), 'utf8'));
const paid = (out: string, cap: string, extra: string[] = []) => ['--bundle', bundle, '--sha256', digest, '--cell', CELL, '--max-usd', cap, '--yes', '--out', out, ...extra];

describe('arguments', () => {
  test('bad flags refuse with HE-REPL-001', () => {
    for (const argv of [['--bundle'], ['--bundle=x'], ['--nope'], ['--bundle', 'x', '--reanalyze', '--estimate-only'], ['--reanalyze'], ['--bundle', 'x', '--reps', '0'], ['--bundle', 'x', '--max-usd', '-1']]) {
      expect(() => parseArgs(argv)).toThrow(/^HE-REPL-001/);
    }
  });
  test('the finding front matter names the archive, its digest and the rerun commit', () => {
    const f = readFinding(`---\nid: x\ndata: https://example.test/b.tar.gz sha256 ${'a'.repeat(64)}\nrerun_commit: abc1234\n---\nbody`);
    expect(f).toEqual({ url: 'https://example.test/b.tar.gz', sha256: 'a'.repeat(64), rerunCommit: 'abc1234' });
  });
  test('redaction keeps trial ids and hides key-shaped strings and trial token secrets', () => {
    const key = 'sk-' + 'ant-' + 'x'.repeat(30);
    expect(redact(`a ${key} b`)).toBe('a <redacted> b');
    expect(redact('sk-trial-run/cell/task/r1.' + 'f'.repeat(32))).toBe('sk-trial-run/cell/task/r1.<redacted>');
    expect(keyTrial('trial-token:r/c/t/r1')).toBe('r/c/t/r1');
    expect(keyTrial('sk-trial-r/c/t/r1')).toBe('r/c/t/r1');
  });
});

describe('free modes', () => {
  const noPaid = () => deps({ env: { PATH: process.env.PATH, HOME: process.env.HOME }, docker: () => { throw new Error('docker must not run'); }, startRunner: () => { throw new Error('no runner, no proxy'); } });
  test('--reanalyze reproduces expected-output.txt with no key, no Docker and no proxy', async () => {
    const { d, lines } = noPaid();
    expect(await main(['--bundle', bundle, '--sha256', digest, '--reanalyze'], d)).toBe(0);
    expect(lines.join('\n')).toMatch(/REANALYZE: MATCH: summarize-run/);
  }, 60_000);
  test('--estimate-only prices every cell with no key, no Docker and no proxy', async () => {
    const { d, lines } = noPaid();
    expect(await main(['--bundle', bundle, '--sha256', digest, '--estimate-only', '--json'], d)).toBe(0);
    const est = lines.filter((l) => l.startsWith('ESTIMATE:'));
    expect(est.length).toBe(3);
    expect(est[0]).toMatch(/openclaw-sonnet-mu-heldout at 1 rep\(s\): 20 trials, expected \$3\.\d\d/);
  });
  test('a tampered archive is refused before it is read', async () => {
    const bytes = new Uint8Array(readFileSync(bundle));
    bytes[bytes.length - 40] ^= 0xff;
    const bad = join(tmp, 'tampered.tar.gz');
    writeFileSync(bad, bytes);
    const { d, lines } = noPaid();
    expect(await main(['--bundle', bad, '--sha256', digest, '--reanalyze'], d)).toBe(2);
    expect(lines.join('\n')).toMatch(/HE-BUNDLE-005/);
  });
  test('an analysis.json step off the allowlist is never executed', async () => {
    const entries = readBundleArchive(new Uint8Array(readFileSync(bundle)));
    const enc = new TextEncoder();
    const evil = enc.encode(JSON.stringify({ steps: [{ id: 'evil', script: 'results/run.ts', args: [] }] }) + '\n');
    const man = JSON.parse(new TextDecoder().decode(entries.find((e) => e.path === 'bundle.json')!.data));
    const f = man.files.find((x: { path: string }) => x.path === 'analysis.json');
    if (f) { f.sha256 = sha256(evil); f.bytes = evil.length; }
    const next = entries.map((e) => (e.path === 'analysis.json' ? { ...e, data: evil } : e.path === 'bundle.json' ? { ...e, data: enc.encode(JSON.stringify(man, null, 2) + '\n') } : e));
    const path = join(tmp, 'evil.tar.gz');
    writeFileSync(path, packBundleArchive(next));
    const { d, lines } = noPaid();
    expect(await main(['--bundle', path, '--reanalyze'], d)).toBe(2);
    expect(lines.join('\n')).toMatch(/HE-REPL-009 analysis\.json names step "evil"|HE-BUNDLE/);
  });
});

describe('paid rerun refusals before any work', () => {
  const cases: Array<[string, Partial<Deps>, string[], RegExp]> = [
    ['macOS', { platform: 'darwin', arch: 'arm64' }, [], /HE-REPL-004 a paid rerun needs Linux x86_64; this is darwin arm64/],
    ['no key', { env: { PATH: process.env.PATH, HOME: process.env.HOME } }, [], /HE-REPL-004 ANTHROPIC_API_KEY is not set/],
    ['dirty checkout', { checkout: () => ({ commit: HEAD, dirty: ['runner/run.ts'] }) }, [], /HE-REPL-004 the checkout has uncommitted changes \(runner\/run\.ts\)/],
    ['short cap', {}, [], /HE-REPL-007 --max-usd \$1\.00 is under/],
  ];
  for (const [name, over, extra, re] of cases) {
    test(name, async () => {
      const out = newOut(name.replace(/\W+/g, '-'));
      const { d, lines, calls } = deps(over);
      expect(await main(paid(out, '1', extra), d)).toBe(2);
      expect(lines.join('\n')).toMatch(re);
      expect(calls.filter((c) => c.startsWith('runner') || c === 'docker build')).toEqual([]);
    });
  }
  test('a cell of a run with no held-out cells is refused before any work', async () => {
    const dev = build({ root: ROOT, run: 'docs/benchmarks/2026-10-25-qm-probes-qp07', finding: 'qp07-test', out: join(tmp, 'qp07.bundle.tar.gz') });
    const out = newOut('dev-only');
    const { d, lines, calls } = deps();
    expect(await main(['--bundle', dev.path, '--sha256', dev.sha256, '--cell', 'qm-pi-haiku-qp07', '--max-usd', '10', '--yes', '--out', out], d)).toBe(2);
    expect(lines.join('\n')).toMatch(/HE-REPL-011 run qm-probes-qp07-2026-10 has no held-out cells/);
    expect(calls).toEqual([]);
  }, 120_000);
  test('a fresh rerun refuses an --out that exists and is not empty', async () => {
    const out = newOut('not-empty');
    mkdirSync(join(out, 'results'), { recursive: true });
    writeFileSync(join(out, 'results', 'manifest.json'), '{}');
    const { d, lines, calls } = deps();
    expect(await main(paid(out, '10'), d)).toBe(2);
    expect(lines.join('\n')).toMatch(/HE-REPL-001 --out \S+ exists and is not empty/);
    expect(calls).toEqual([]);
    expect(readFileSync(join(out, 'results', 'manifest.json'), 'utf8')).toBe('{}');
  });
  test('no terminal and no --yes', async () => {
    const out = newOut('no-tty');
    const { d, lines, calls } = deps();
    expect(await main(paid(out, '10').filter((a) => a !== '--yes'), d)).toBe(2);
    expect(lines.join('\n')).toMatch(/HE-REPL-008 no terminal to confirm the \$10\.00 cap and no --yes/);
    expect(calls.filter((c) => c.startsWith('runner') || c === 'docker build')).toEqual([]);
  });
});

describe('compare and resume bookkeeping', () => {
  const rows = (xs: object[]) => xs.map((x) => JSON.stringify(x)).join('\n') + '\n';
  test('NO BAND when a rerun task has no published scored trial, instead of a band over other tasks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'replicate-gap-'));
    try {
      const pub = join(dir, 'published');
      mkdirSync(pub);
      writeFileSync(join(pub, 'trials.jsonl'), rows([1, 2, 3, 4, 5].flatMap((i) => [
        { trial_id: `p/c/a/${i}`, cell: 'c', task: 'a', grade: 'pass', termination: 'completed' },
        { trial_id: `p/c/b/${i}`, cell: 'c', task: 'b', grade: 'fail', termination: 'model_error' },
      ])));
      const out = join(dir, 'out');
      mkdirSync(join(out, 'results'), { recursive: true });
      writeFileSync(join(out, 'results', 'manifest.json'), JSON.stringify({ trials: [{ id: 'r/c/a/1', cell: 'c' }, { id: 'r/c/b/1', cell: 'c' }] }));
      writeFileSync(join(out, 'results', 'trials.jsonl'), rows([
        { trial_id: 'r/c/a/1', cell: 'c', task: 'a', grade: 'pass', termination: 'completed' },
        { trial_id: 'r/c/b/1', cell: 'c', task: 'b', grade: 'pass', termination: 'completed' },
      ]));
      const b = { path: 'x', sha256: 'x', manifest: { run_id: 'p' }, results: pub, finding: {} };
      const state = { run_id: 'r', cell: 'c', reps: 1, max_usd: 1, commit: HEAD, image: { tag: '', id: null }, started_at: '', resumes: [], interrupted: false, drift_experiment: false, equivalence: null, estimate: null };
      const { d, lines } = deps();
      const r = compare(b as never, state as never, out, d);
      expect(r.exit).toBe(5);
      expect(r.report.verdict).toBe('NO BAND');
      expect(r.report.band).toBeNull();
      expect(r.report.task_gap).toEqual({ no_published_scored_trial: ['b'], not_rerun: [] });
      expect(lines.join('\n')).toMatch(/NO BAND: the published counts and the rerun cover different tasks \(no published scored trial: b; not rerun: none\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a charged failed request counts as charged but unrecorded, so --resume asks for --replay-charged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'replicate-charged-'));
    try {
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ trials: [{ id: 'r/c/a/1', cell: 'c' }, { id: 'r/c/b/1', cell: 'c' }] }));
      writeFileSync(join(dir, 'trials.jsonl'), '');
      writeFileSync(join(dir, 'proxy-usage.ndjson'), rows([
        { key: 'trial-token:r/c/a/1', outcome: 'failed', reserved_usd: 0.5, actual_usd: 0.5, charged_reservation: true },
        { key: 'trial-token:r/c/b/1', outcome: 'refused', reason: 'cap' },
      ]));
      expect(chargedUnrecorded(dir, 'c')).toEqual([{ trial: 'r/c/a/1', usd: 0.5 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('paid rerun through the real metering proxy (fake upstream)', () => {
  test('a runner error line with no trailing newline still reaches the person and runner.log', async () => {
    const out = newOut('tail');
    const { d, lines } = deps({}, { FAKE_PREFLIGHT_TAIL: 'HE-RUN-002 fake preflight failure' });
    expect(await main(paid(out, '10'), d)).toBe(2);
    expect(lines).toContain('HE-RUN-002 fake preflight failure');
    expect(readFileSync(join(out, 'runner.log'), 'utf8')).toContain('HE-RUN-002 fake preflight failure\n');
  }, 120_000);
  test('a complete rerun gives a verdict, stays under the cap and bundles the rerun', async () => {
    const out = newOut('complete');
    const { d, lines } = deps();
    const code = await main(paid(out, '10'), d);
    const r = report(out);
    expect(lines.join('\n')).toMatch(/^(WITHIN BAND|OUTSIDE BAND)$/m);
    expect([0, 4]).toContain(code);
    expect(r.completeness).toMatchObject({ planned: 20, kept: 20, complete: true });
    expect(r.spend.committed_usd).toBeGreaterThan(0);
    expect(r.spend.committed_usd).toBeLessThanOrEqual(10);
    expect(r.band.lo).toBe(12);
    expect(r.rerun_bundle.sha256).toMatch(/^[0-9a-f]{64}$/);
  }, 120_000);

  test('a cap stop is INCOMPLETE (exit 3), leaves the cap-stopped trial out and spends no more than the cap', async () => {
    const out = newOut('capstop');
    const { d, lines } = deps();
    expect(await main(paid(out, '0.05', ['--allow-short-cap']), d)).toBe(3);
    const r = report(out);
    expect(r.verdict).toBe('INCOMPLETE');
    expect(r.completeness.cap_stop).toBe(true);
    expect(r.completeness.excluded.length).toBe(1);
    expect(r.spend.committed_usd).toBeLessThanOrEqual(0.05);
    expect(lines.join('\n')).toMatch(/A cap stop is the end of this rerun/);
    expect(lines.join('\n')).not.toMatch(/set-cap/);
  }, 120_000);

  test('SIGINT keeps the lease open; --resume refuses a charged unrecorded trial until --replay-charged, then finishes under the same lease', async () => {
    const out = newOut('sigint');
    const first = deps({}, { FAKE_HANG_AT: '3' });
    const running = main(paid(out, '10'), first.d);
    for (let i = 0; i < 600 && !first.lines.some((l) => /^trial .* starting$/.test(l)); i++) await Bun.sleep(50);
    process.emit('SIGINT');
    expect(await running).toBe(3);
    const r1 = report(out);
    expect(r1.rerun.interrupted).toBe(true);
    expect(r1.completeness.kept).toBe(3);
    closeLedgers();
    const lease = ledgerStatus({ ledgerPath: join(out, 'ledger.sqlite'), runId: r1.rerun.run_id });
    expect(lease.run?.finished_at).toBeNull();
    const charged = lease.run!.committed_usd;

    const dirty = deps({ checkout: () => ({ commit: HEAD, dirty: ['runner/run.ts'] }) });
    expect(await main(['--resume', out], dirty.d)).toBe(2);
    expect(dirty.lines.join('\n')).toMatch(/HE-REPL-010 the checkout has uncommitted changes \(runner\/run\.ts\)/);
    expect(dirty.calls.filter((c) => c.startsWith('runner') || c === 'docker build')).toEqual([]);

    const refuse = deps();
    expect(await main(['--resume', out], refuse.d)).toBe(2);
    expect(refuse.lines.join('\n')).toMatch(/HE-REPL-010 1 interrupted trial\(s\) were charged but not recorded/);

    const again = deps();
    const code = await main(['--resume', out, '--replay-charged'], again.d);
    expect([0, 4]).toContain(code);
    expect(again.lines.join('\n')).toMatch(/RESUME: run replicate-openclaw-sonnet-mu-heldout-\S+ at commit/);
    const r2 = report(out);
    expect(r2.completeness).toMatchObject({ planned: 20, kept: 20, complete: true });
    expect(r2.rerun.resumes.length).toBe(1);
    expect(r2.rerun.resumes[0].replay_charged.length).toBe(1);
    closeLedgers();
    const after = ledgerStatus({ ledgerPath: join(out, 'ledger.sqlite'), runId: r1.rerun.run_id });
    expect(after.runs).toBe(1);
    expect(after.run!.budget_usd).toBe(10);
    expect(after.run!.committed_usd).toBeGreaterThan(charged);
    expect(existsSync(join(out, 'rerun.bundle.tar.gz'))).toBe(true);
  }, 180_000);
});
