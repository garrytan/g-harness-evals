// internal-task phase 3: what a custody command prints is as good as published (crew threads read each other's transcripts),
// so under a sealed root no task id, task body, hidden fact, slice record or corpus page may reach stdout or stderr. This
// runs every custody command on the synthetic set as a subprocess and scans everything each one printed: open.ts, one
// sealed shard through scripts/run-shard.sh, run.ts dry-run, plan, preflight and run, summarize-run.ts, compare-run.ts,
// export.ts, keygen.ts --check-escrow, a failing sealed build-gbrain-image.sh (docker faked), release.ts and cleanup.ts,
// plus canaries: malformed JSON with a sealed string in it (export.ts and seal.ts, whose parsers would quote it) and a
// corrupt archive entry. It also checks that the full output did land in the custody log files (seal.ts's in a private
// 0600 log it names), that a sealed merge refuses an --out or shard inside a checkout, another opening's root and a mix of
// sealed and plaintext shards before writing anything, that planMerge accepts a shard planned from a resumed receipt, and
// the guard's own rules on lines no command prints today.
//
// Value: protects=the rule in docs/sealed-custody.md, "What may print"; fails_when=a custody command prints a trial or turn
// line, a per-task table, a failed step's log tail or an error message carrying sealed content; why_new=sealed custody is
// new; seam=subprocesses with a throwaway key, a fake docker, the fixture repository with the runner symlinked into it;
// no_claim=a real gbrain image build, a Ubicloud VM (tests/sealed-shard.test.ts covers the VM lane's copy and cleanup).
import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packTar, unpackTar } from '../runner/heldout/sealed.ts';
import { planMerge } from '../scripts/merge-shards.ts';
import { candidate, ENV_VALUE, makeFixture, register, ROOT, SECRETS, type Fixture } from './sealed-fixture.ts';

let f: Fixture | undefined;
afterAll(() => { if (f) rmSync(f.tmp, { recursive: true, force: true }); });

const NEEDLES = ['sx-01-vault-ask', 'sx-02-dm-guard', ...Object.values(SECRETS), 'syn-vault', 'CSYNVAULT01', 'm-syn-1', 'f-syn-quoll-brief', 'syn-quoll-brief', 'Quoll', 'quoll_discount', 'Zirconia', 'vault channel'];
const printed: Array<{ what: string; status: number | null; text: string }> = [];

test('no custody command prints sealed content, and the full output lands in custody log files', async () => {
  f = await makeFixture(2);
  const run = { runId: 'syn-out', dir: '2026-11-12-syn-out', label: 'confirmatory' as const, candidate: candidate('out') };
  register(f, run);
  const prereg = `docs/benchmarks/${run.dir}/prereg.json`;
  const linked = ['runner', 'scripts', 'harnesses', 'gbrain', 'node_modules', 'package.json', 'tsconfig.json'];
  for (const n of linked) symlinkSync(join(ROOT, n), join(f.repo, n));
  appendFileSync(join(f.repo, '.git', 'info', 'exclude'), linked.map((n) => `/${n}`).join('\n') + '\n');
  const bin = join(f.tmp, 'bin');
  mkdirSync(bin);
  // docker: image inspect answers an id; build echoes what a build log could hold, the sealed corpus page names, and fails
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
case "$1" in
  image) echo "sha256:0000000000000000000000000000000000000000000000000000000000000000" ;;
  build) for a in "$@"; do case "$a" in heldout-corpus=*) find "\${a#heldout-corpus=}" -type f ;; esac; done; echo "#9 [keyword 3/9] RUN build-brain"; echo "${SECRETS.corpusLine}"; exit 1 ;;
  *) exit 0 ;;
esac
`);
  chmodSync(join(bin, 'docker'), 0o755);
  const env = { PATH: `${bin}:${join(f.gh, '..')}:${process.env.PATH}`, HOME: process.env.HOME, UBICLOUD_API_KEY: ENV_VALUE };
  const sh = (what: string, args: string[], cwd = f!.repo) => {
    const r = spawnSync(args[0]!, args.slice(1), { cwd, encoding: 'utf8', env, timeout: 120_000 });
    printed.push({ what, status: r.status, text: `${r.stdout}${r.stderr}` });
    return r;
  };
  const root = join(f.work, 'root');
  const receipt = join(root, 'opening-receipt.json');
  const sealed = ['--sealed-root', root, '--opening-receipt', receipt];
  const results = join(f.work, 'results');
  const shard = join(f.work, 'shard');

  const custody = ['--custody', f.custody, '--identity', f.identityPath];
  expect(sh('keygen.ts --check-escrow', ['bun', 'scripts/sealed/keygen.ts', '--check-escrow', ...custody, '--repo', f.repo]).status).toBe(0);
  expect(sh('open.ts', ['bun', 'scripts/sealed/open.ts', '--prereg', prereg, ...custody, '--out', root]).status).toBe(0);
  // run-shard.sh's prune loop leaves a sleep holding its stdout, so its output goes through a file rather than a pipe
  const shardOut = join(f.work, 'run-shard.out');
  const shardRun = spawnSync('bash', ['-c', 'bash scripts/run-shard.sh "$@" > "$0" 2>&1', shardOut, '--prereg', prereg, '--name', 's1', '--cells', 'base', '--lease-usd', '1', '--out', shard, '--skip-build', ...sealed], { cwd: f.repo, encoding: 'utf8', env, timeout: 120_000 });
  printed.push({ what: 'run-shard.sh', status: shardRun.status, text: readFileSync(shardOut, 'utf8') });
  expect(shardRun.status).toBe(0);
  expect(readFileSync(shardOut, 'utf8')).toContain('run exited 0; 4 trial lines');
  expect(readFileSync(join(shard, 'trials.jsonl'), 'utf8').trim().split('\n').length).toBe(4);
  // merging one shard of two: the refusal lists the missing trial ids, which carry task ids, so it goes to the log only
  const merged = join(f.work, 'merged');
  const unrooted = sh('merge-shards.ts (no sealed root)', ['bun', 'scripts/merge-shards.ts', '--out', merged, '--shard', `s1=${shard}`]);
  expect(unrooted.status).toBe(2);
  expect(unrooted.stderr).toContain('HE-SEALED-001');
  const partial = sh('merge-shards.ts (missing trials)', ['bun', 'scripts/merge-shards.ts', '--out', merged, '--shard', `s1=${shard}`, '--sealed-root', root]);
  expect(partial.status).toBe(2);
  expect(partial.stderr).toMatch(/SEALED: 1 line\(s\) of task-level output withheld/);
  expect(readFileSync(join(merged, 'merge-shards.sealed.log'), 'utf8')).toContain('manifest trial(s) in no shard');
  // a sealed merge refuses an --out or a shard inside a git work tree before the guard writes its log or anything else
  const insideOut = join(f.repo, 'results', 'merge-inside');
  const inside = sh('merge-shards.ts (inside a checkout)', ['bun', 'scripts/merge-shards.ts', '--out', insideOut, '--shard', `s1=${shard}`, '--shard', `s2=${join(f.repo, 'docs')}`, '--sealed-root', root]);
  expect(inside.status).toBe(2);
  expect(inside.stderr).toContain(`HE-SEALED-002 --out ${insideOut}, --shard s2 ${join(f.repo, 'docs')} are inside a git work tree`);
  expect(existsSync(insideOut)).toBe(false);
  // a root holding another opening's receipt, and a mix of sealed and plaintext shards, are refused the same way
  const otherRoot = join(f.work, 'other-root');
  mkdirSync(otherRoot);
  writeFileSync(join(otherRoot, 'opening-receipt.json'), JSON.stringify({ ...JSON.parse(readFileSync(receipt, 'utf8')), run_id: 'syn-other' }));
  const merged2 = join(f.work, 'merged-2');
  const otherRun = sh('merge-shards.ts (another opening)', ['bun', 'scripts/merge-shards.ts', '--out', merged2, '--shard', `s1=${shard}`, '--sealed-root', otherRoot]);
  expect(otherRun.status).toBe(2);
  expect(otherRun.stderr).toContain('HE-SEALED-003');
  expect(otherRun.stderr).toContain('it differs in run_id');
  const plainShard = join(f.work, 'plain-shard');
  mkdirSync(plainShard);
  writeFileSync(join(plainShard, 'manifest.json'), JSON.stringify({ run_id: 'syn-out', trials: [] }));
  writeFileSync(join(plainShard, 'trials.jsonl'), '');
  const mixed = sh('merge-shards.ts (sealed and plaintext shards)', ['bun', 'scripts/merge-shards.ts', '--out', merged2, '--shard', `s1=${shard}`, '--shard', `p1=${plainShard}`, '--sealed-root', root]);
  expect(mixed.status).toBe(2);
  expect(mixed.stderr).toContain('HE-SEALED-001 shards s1 were planned with a sealed root and p1 without one');
  expect(existsSync(merged2)).toBe(false);
  expect(sh('run.ts dry-run', ['bun', 'runner/run.ts', 'dry-run', '--prereg', prereg, ...sealed]).status).toBe(0);
  expect(sh('run.ts plan', ['bun', 'runner/run.ts', 'plan', '--prereg', prereg, '--out', results, ...sealed]).status).toBe(0);
  expect(sh('run.ts preflight', ['bun', 'runner/run.ts', 'preflight', '--manifest', join(results, 'manifest.json'), ...sealed]).status).toBe(0);
  expect(sh('run.ts run', ['bun', 'runner/run.ts', 'run', '--manifest', join(results, 'manifest.json'), '--harness-mode', 'scripted', ...sealed]).status).toBe(0);
  expect(sh('summarize-run.ts', ['bun', 'scripts/summarize-run.ts', '--results', results, '--sealed-root', root]).status).toBe(0);
  expect(sh('compare-run.ts', ['bun', 'scripts/compare-run.ts', '--results', results, '--sealed-root', root]).status).toBe(0);
  expect(sh('export.ts', ['bun', 'scripts/sealed/export.ts', '--results', results, ...sealed, '--custody', f.custody]).status).toBe(0);
  // canaries: a parser's message quotes the bad token, so a malformed file holding sealed text must not reach the terminal
  const canary = join(f.work, 'canary-results');
  mkdirSync(canary);
  writeFileSync(join(canary, 'manifest.json'), `{"run_id": CSYNVAULT01 ${SECRETS.ledgerCode}}`);
  expect(sh('export.ts (malformed manifest.json)', ['bun', 'scripts/sealed/export.ts', '--results', canary, ...sealed, '--custody', f.custody]).status).toBe(2);
  // seal.ts prints the code, a count and a private log path; the log (under HOME, here a scratch one) holds the message
  const sealHome = join(f.tmp, 'seal-home');
  const seal = (what: string, slice: string) => {
    writeFileSync(join(f!.work, 'canary-slice.json'), slice);
    const r = spawnSync('bun', ['scripts/sealed/seal.ts', '--task-set', 'vcanary', '--tasks', join(f!.plain, 'heldout'), '--slice', join(f!.work, 'canary-slice.json'), '--custody', f!.custody, '--recipient', f!.recipient, '--repo', f!.repo], { cwd: f!.repo, encoding: 'utf8', env: { ...env, HOME: sealHome }, timeout: 120_000 });
    printed.push({ what, status: r.status, text: `${r.stdout}${r.stderr}` });
    expect(r.status).toBe(2);
    const log = /read (\S+\.log) inside custody only/.exec(r.stderr)?.[1] ?? '';
    expect(log.startsWith(join(sealHome, '.capy', 'work', 'custody', 'logs', 'seal-'))).toBe(true);
    expect(statSync(log).mode & 0o777).toBe(0o600);
    return { stderr: r.stderr, log: readFileSync(log, 'utf8') };
  };
  const malformed = seal('seal.ts (malformed slice)', `{"channels": [Zirconia ${SECRETS.hiddenFact}]}`);
  expect(malformed.stderr).toMatch(/^HE-SEALED-006 seal failed: SyntaxError \(1 problem\(s\)\)/);
  expect(malformed.log).toContain('Zirconia');
  const refused = seal('seal.ts (slice refusal naming record ids)', JSON.stringify({ zzz: 1, channels: [{ id: 'CSYNVAULT01', split: 'heldout', name: 'syn-vault' }, { id: 'CSYNVAULT01', split: 'heldout', name: 'syn-vault' }] }));
  expect(refused.stderr).toMatch(/^HE-SEALED-006 seal refused \(2 problem\(s\)\); the message can name sealed tasks or slice records/);
  expect(refused.log).toContain('slice: channels CSYNVAULT01 appears twice');
  const tar = packTar([{ path: 'tasks/multiuser/vsyn/heldout/sx-02-dm-guard/task.toml', data: new TextEncoder().encode(SECRETS.hiddenFact) }]);
  tar[150] = tar[150]! ^ 1;
  let tarError = '';
  try { unpackTar(tar); } catch (e) { tarError = e instanceof Error ? e.message : String(e); }
  expect(tarError).toMatch(/HE-SEALED|entry|checksum/);
  printed.push({ what: 'unpackTar (corrupt entry)', status: null, text: tarError });
  const wrongTag = sh('build-gbrain-image.sh (wrong tag)', ['bash', join(ROOT, 'scripts', 'build-gbrain-image.sh'), '--tag', 'harness-eval/gbrain:dev-sealed', '--out', join(f.work, 'gbrain-image'), '--sealed-root', root], ROOT);
  expect(wrongTag.status).toBe(2);
  expect(wrongTag.stderr).toContain('is tagged harness-eval/gbrain:sealed-');
  const build = sh('build-gbrain-image.sh', ['bash', join(ROOT, 'scripts', 'build-gbrain-image.sh'), '--out', join(f.work, 'gbrain-image'), '--sealed-root', root], ROOT);
  expect(build.status).toBe(2);
  expect(build.stderr).toContain('HE-GBRAIN-007');
  expect(build.stderr).toContain(join(root, 'logs', 'build-gbrain-image.log'));
  spawnSync('git', ['add', '-A'], { cwd: f.repo });
  spawnSync('git', ['commit', '-qm', 'export'], { cwd: f.repo });
  expect(sh('release.ts', ['bun', 'scripts/sealed/release.ts', '--task-set', 'vsyn', ...custody, '--retire']).status).toBe(0);

  const leaks = printed.flatMap((p) => NEEDLES.filter((n) => p.text.includes(n)).map((n) => `${p.what} printed ${JSON.stringify(n)}`));
  expect(leaks).toEqual([]);
  // the commands did print something, with opaque ids only where tasks are named
  expect(printed.find((p) => p.what === 'run.ts run')!.text).toMatch(/progress: 8 of 8 trials this invocation/);
  expect(printed.find((p) => p.what === 'run.ts run')!.text).toMatch(/SEALED: \d+ line\(s\) of task-level output withheld/);
  // and the full output is in the custody logs
  const runLog = readFileSync(join(results, 'sealed-console.log'), 'utf8');
  expect(runLog).toContain('sx-01-vault-ask');
  expect(runLog).toContain('#syn-vault');
  expect(readFileSync(join(results, 'summarize-run.sealed.log'), 'utf8')).toContain('base');
  expect(existsSync(join(results, 'compare-run.sealed.log'))).toBe(true);
  expect(readFileSync(join(shard, 'sealed-console.log'), 'utf8')).toContain('sx-02-dm-guard');
  expect(readFileSync(join(root, 'logs', 'build-gbrain-image.log'), 'utf8')).toContain(SECRETS.corpusLine);
}, 300_000);

test('planMerge: shards of one opening merge when one was planned from a resumed receipt; another opening, set or a plaintext shard is refused', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'he-merge-sealed-'));
  try {
    const receipt = { run_id: 'syn-m', set: 'vsyn', candidate_sha256: 'c'.repeat(64), written_at: '2026-11-01T00:00:00.000Z', access: { event_sha256: 'e'.repeat(64), custody_commit: 'a'.repeat(40), resumed: false } };
    const shardDir = (name: string, trial: string, sealed: unknown) => {
      const d = join(tmp, name);
      mkdirSync(d);
      writeFileSync(join(d, 'manifest.json'), JSON.stringify({ run_id: 'syn-m', created_at: name, trials: [{ id: 't1', cell: 'a' }, { id: 't2', cell: 'b' }], ...(sealed ? { sealed } : {}) }));
      writeFileSync(join(d, 'trials.jsonl'), JSON.stringify({ trial_id: trial, cell: trial === 't1' ? 'a' : 'b' }) + '\n');
      return { name, dir: d };
    };
    const a = shardDir('a', 't1', { set: 'vsyn', receipt_sha256: '1'.repeat(64), receipt });
    const resumed = shardDir('b', 't2', { set: 'vsyn', receipt_sha256: '2'.repeat(64), receipt: { ...receipt, written_at: '2026-11-02T00:00:00.000Z', access: { ...receipt.access, custody_commit: 'b'.repeat(40), resumed: true } } });
    expect(planMerge(join(tmp, 'out'), [a, resumed]).rows.map((t) => t.trial_id)).toEqual(['t1', 't2']);
    const other = shardDir('c', 't2', { set: 'vsyn', receipt_sha256: '1'.repeat(64), receipt: { ...receipt, candidate_sha256: 'd'.repeat(64) } });
    expect(() => planMerge(join(tmp, 'out'), [a, other])).toThrow('differs from shard a\'s in sealed.receipt.candidate_sha256');
    const otherSet = shardDir('d', 't2', { set: 'vother', receipt_sha256: '1'.repeat(64), receipt });
    expect(() => planMerge(join(tmp, 'out'), [a, otherSet])).toThrow('in sealed.set');
    const plain = shardDir('e', 't2', null);
    expect(() => planMerge(join(tmp, 'out'), [a, plain])).toThrow("differs from shard a's in sealed;");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Value: protects=a malformed results file is HE-RUN-007 naming the file, the line and the parser's error class in runner/run.ts
// (preflight and run), summarize-run.ts, compare-run.ts and merge-shards.ts, never the parser's message, which quotes the bad
// token; fails_when=a reader goes back to a bare JSON.parse, or the message starts quoting the input again; why_new=no test fed
// these readers a malformed file (testing review, pass 3); seam=subprocesses on synthetic files; no_claim=a real sealed run.
const PARSE_CANARY = 'SYNTHETIC_SEALED_TASK_CANARY_531';

test('HE-RUN-007: a malformed manifest or trials.jsonl prints its path, line and parser class, never the sealed token in it', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'he-run-007-'));
  try {
    const bad = `{"task": ${PARSE_CANARY}}\n`;
    const run = (args: string[]) => {
      const r = spawnSync('bun', args, { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
      return { code: r.status, err: r.stderr, all: r.stdout + r.stderr };
    };
    const manifest = join(tmp, 'manifest.json');
    writeFileSync(manifest, bad);
    for (const cmd of ['preflight', 'run']) {
      const r = run(['runner/run.ts', cmd, '--manifest', manifest]);
      expect(r.code).toBe(2);
      expect(r.err).toContain(`HE-RUN-007 ${manifest} is not JSON (SyntaxError); the parser's message is withheld`);
      expect(r.all).not.toContain(PARSE_CANARY);
    }
    const results = join(tmp, 'results');
    mkdirSync(results);
    writeFileSync(join(results, 'manifest.json'), JSON.stringify({ run_id: 'syn-007', cells: [], trials: [] }));
    writeFileSync(join(results, 'trials.jsonl'), bad);
    const trials = join(results, 'trials.jsonl');
    for (const [what, args] of [
      ['summarize-run.ts', ['scripts/summarize-run.ts', '--results', results]],
      ['compare-run.ts', ['scripts/compare-run.ts', '--results', results]],
      ['merge-shards.ts', ['scripts/merge-shards.ts', '--out', join(tmp, 'merged'), '--shard', `s1=${results}`]],
    ] as const) {
      const r = run([...args]);
      expect(r.code, what).toBe(2);
      expect(r.err, what).toContain(`HE-RUN-007 ${trials} line 1 is not JSON (SyntaxError)`);
      expect(r.all, what).not.toContain(PARSE_CANARY);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 60_000);

// Value: protects=compare-run.ts reads both manifests before any trial row and refuses a sealed run against an unsealed one
// (HE-SEALED-001, either way round) and two sealed runs of different openings (HE-SEALED-003), so a sealed --against never
// reaches the public task lookup, whose missing-file error names the task; fails_when=--against rows are combined before its
// manifest is checked; why_new=outside voice, pass 3; seam=synthetic results directories; no_claim=a real sealed comparison.
test('compare-run.ts refuses a sealed --against with an unsealed --results (and the reverse) or another opening, naming no task', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'he-compare-against-'));
  try {
    const receipt = { run_id: 'syn-c', set: 'vsyn', candidate_sha256: 'c'.repeat(64), access: { event_sha256: 'e'.repeat(64) } };
    const dir = (name: string, sealed: unknown) => {
      const d = join(tmp, name);
      mkdirSync(d);
      writeFileSync(join(d, 'manifest.json'), JSON.stringify({ cells: [{ id: 'base', harness: 'hermes', model: 'anthropic:claude-sonnet-5-5', split: 'heldout', task_set: 'vsyn' }], ...(sealed ? { sealed } : {}) }));
      writeFileSync(join(d, 'trials.jsonl'), JSON.stringify({ trial_id: `syn-c/base/${PARSE_CANARY}/r1`, cell: 'base', task: PARSE_CANARY, grade: 'pass' }) + '\n');
      return d;
    };
    const plain = dir('plain', null);
    const sealed = dir('sealed', { set: 'vsyn', receipt_sha256: '1'.repeat(64), receipt });
    const other = dir('other', { set: 'vsyn', receipt_sha256: '2'.repeat(64), receipt: { ...receipt, candidate_sha256: 'd'.repeat(64) } });
    const compare = (a: string, b: string) => {
      const r = spawnSync('bun', ['scripts/compare-run.ts', '--results', a, '--against', b], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
      return { code: r.status, err: r.stderr, all: r.stdout + r.stderr };
    };
    const mixed = compare(plain, sealed);
    expect(mixed.code).toBe(2);
    expect(mixed.err).toContain(`HE-SEALED-001 ${sealed} was planned with a sealed root and ${plain} without one`);
    const reverse = compare(sealed, plain);
    expect(reverse.code).toBe(2);
    expect(reverse.err).toContain(`HE-SEALED-001 ${sealed} was planned with a sealed root and ${plain} without one`);
    const opening = compare(sealed, other);
    expect(opening.code).toBe(2);
    expect(opening.err).toContain(`HE-SEALED-003 --against ${other} was planned with another opening than --results ${sealed} (it differs in candidate_sha256)`);
    for (const r of [mixed, reverse, opening]) expect(r.all).not.toContain(PARSE_CANARY);
    expect(existsSync(join(plain, 'comparisons.json')) || existsSync(join(sealed, 'comparisons.json'))).toBe(false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 60_000);

// Value: protects=preflight and run of a run with no sealed root refuse a gbrain image labelled harness-eval.sealed=true, even
// when its image.json cannot be read (HE-SEALED-005); fails_when=the gbrainImagePresent branch or the label fallback is
// dropped from runner/run.ts; why_new=only the pure helpers were tested (testing review, pass 3); seam=a fake docker on PATH;
// no_claim=a real image.
test('a public run refuses a gbrain image labelled harness-eval.sealed=true in preflight and run (HE-SEALED-005), docker faked', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'he-public-sealed-image-'));
  try {
    const bin = join(tmp, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
echo "docker $*" >> "${join(tmp, 'docker.log')}"
case "$1 $2" in
  "image inspect") case "$3" in -f) echo true ;; esac; exit 0 ;;
  "run --rm") exit 1 ;;
  *) exit 1 ;;
esac
`);
    chmodSync(join(bin, 'docker'), 0o755);
    const manifest = join(tmp, 'manifest.json');
    writeFileSync(manifest, JSON.stringify({ schema_version: 1, run_id: 'syn-public', prereg_sha256: 'p'.repeat(64), created_at: '2026-10-28T00:00:00Z', cells: [{ id: 'g', harness: 'hermes', harness_mode: 'process', model: 'anthropic:claude-sonnet-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, gbrain: { surface: 'starter' } }], trials: [], cost_ceiling_usd: 1, per_cell_ceiling_usd: { g: 1 }, spend_cap_usd: 1, trial_hours_at_cap: 1 }));
    for (const cmd of ['preflight', 'run']) {
      const r = spawnSync('bun', ['runner/run.ts', cmd, '--manifest', manifest, '--gbrain-image', 'harness-eval/gbrain:sealed-syn'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME } });
      expect(r.status, cmd + r.stderr).toBe(2);
      expect(r.stderr).toContain('HE-SEALED-005 gbrain image harness-eval/gbrain:sealed-syn was built from a sealed root');
    }
    expect(readFileSync(join(tmp, 'docker.log'), 'utf8')).toContain('image inspect -f {{index .Config.Labels "harness-eval.sealed"}} harness-eval/gbrain:sealed-syn');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 60_000);

// Value: protects=run refuses --harness-mode process for any selected non-scripted cell of a sealed run before it opens the root
// (HE-SEALED-001), since a process-mode harness runs as the runner's user and could read the root and the custody files;
// fails_when=the refusal is dropped or ignores --cells; why_new=red-team review, pass 4; seam=a synthetic manifest, no root;
// no_claim=docker mode's isolation.
test('run refuses --harness-mode process for every non-scripted cell of a sealed run (HE-SEALED-001) before it opens anything', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'he-sealed-process-'));
  try {
    const manifest = join(tmp, 'manifest.json');
    const cell = (id: string, extra: Record<string, unknown>) => ({ id, harness: 'hermes', model: 'anthropic:claude-sonnet-5-5', slice: 'multiuser', split: 'heldout', task_set: 'vsyn', repetitions: 1, ...extra });
    writeFileSync(manifest, JSON.stringify({ schema_version: 1, run_id: 'syn-process', prereg_sha256: 'p'.repeat(64), created_at: '2026-10-28T00:00:00Z', sealed: { set: 'vsyn', receipt_sha256: 'r'.repeat(64), receipt: { run_id: 'syn-process' } }, cells: [cell('h', {}), cell('s', { harness: 'scripted', harness_mode: 'scripted', model: 'none', script: 'oracle' }), cell('d', { split: 'dev' })], trials: [], cost_ceiling_usd: 1, per_cell_ceiling_usd: { h: 1, s: 0, d: 1 }, spend_cap_usd: 1, trial_hours_at_cap: 1 }));
    const run = (...extra: string[]) => spawnSync('bun', ['runner/run.ts', 'run', '--manifest', manifest, '--harness-mode', 'process', ...extra], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    const all = run();
    expect(all.status, all.stderr).toBe(2);
    expect(all.stderr).toContain('HE-SEALED-001 cells h, d belong to run syn-process, which opens set vsyn in sealed custody; in process mode the harness runs as the runner\'s user and could read the opened sealed root');
    // a dev cell of a sealed run is refused too: the root is opened for every cell, so a process-mode harness could read it
    const dev = run('--cells', 'd');
    expect(dev.status, dev.stderr).toBe(2);
    expect(dev.stderr).toContain('HE-SEALED-001 cells d belong to run syn-process');
    // a scripted cell runs no harness, so it passes this check and meets the usual flag check of a sealed manifest
    const scripted = run('--cells', 's');
    expect(scripted.status, scripted.stderr).toBe(2);
    expect(scripted.stderr).toContain('HE-SEALED-001 run syn-process has held-out cells of set vsyn');
    expect(scripted.stderr).not.toContain('in process mode');
    expect(existsSync(join(tmp, 'sealed-console.log'))).toBe(false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 60_000);

test('the guard: an allowlisted line gets opaque ids and [sealed]; an unsafe error code prints its code, opaque ids and the log path; a crash prints HE-SEALED-009', () => {
  if (!f) throw new Error('needs the first test');
  const root = join(f.work, 'root');
  const script = join(f.tmp, 'guard-probe.ts');
  writeFileSync(script, `import { sealedGuard } from ${JSON.stringify(join(ROOT, 'runner', 'heldout', 'guard.ts'))};
const g = sealedGuard({ root: process.argv[2]!, set: 'vsyn', repoRoot: process.argv[3]!, logFile: process.argv[4]!, allow: [/^OK: /], label: 'probe' });
console.log('OK: task sx-01-vault-ask in #syn-vault');
console.log('turn 1: kwame-adjei in #syn-vault');
console.error('HE-TASK-001 sx-02-dm-guard/task.toml: ${SECRETS.hiddenFact}');
console.error('HE-SEALED-004 the sealed task tree digest is abc');
g.say('SUMMARY: done');
if (process.argv[5] === 'crash') throw new Error('${SECRETS.ledgerCode}');
`);
  const log = join(f.work, 'probe.log');
  const r = spawnSync('bun', [script, root, f.repo, log], { encoding: 'utf8' });
  const ids = [...r.stdout.matchAll(/T-[0-9a-f]{10}/g)].map((m) => m[0]);
  expect(ids.length).toBe(1);
  expect(r.stdout).toBe(`OK: task ${ids[0]} in #[sealed]\nSUMMARY: done\n`);
  expect(r.stderr).toMatch(/^HE-TASK-001 \(sealed: the message is withheld from this terminal; opaque task ids T-[0-9a-f]{10}; read it in .*probe\.log inside custody only\)\nHE-SEALED-004 the sealed task tree digest is abc\nSEALED: 1 line\(s\) of task-level output withheld/);
  expect(readFileSync(log, 'utf8')).toContain(SECRETS.hiddenFact);
  const c = spawnSync('bun', [script, root, f.repo, log, 'crash'], { encoding: 'utf8' });
  expect(c.status).toBe(2);
  expect(c.stderr).toContain('HE-SEALED-009 an unexpected error inside custody');
  expect(c.stderr).not.toContain(SECRETS.ledgerCode);
  expect(readFileSync(log, 'utf8')).toContain(SECRETS.ledgerCode);
  // a slice the guard cannot parse refuses with the parser's class only, never the sealed text the message quotes
  const badRoot = join(f.work, 'root-bad-slice');
  spawnSync('cp', ['-r', root, badRoot]);
  writeFileSync(join(badRoot, 'world', 'slice.json'), `{"x": ${SECRETS.ledgerCode}`);
  const b = spawnSync('bun', [script, badRoot, f.repo, log], { encoding: 'utf8' });
  expect(b.status).not.toBe(0);
  expect(b.stderr).toContain(`HE-SEALED-004 the output guard could not read the sealed root ${badRoot} (SyntaxError)`);
  expect(b.stderr).not.toContain(SECRETS.ledgerCode);
  rmSync(badRoot, { recursive: true });
});

test('cleanup removes the plaintext copies once the export is proven, printing counts and paths only', () => {
  if (!f) throw new Error('needs the first test');
  const root = join(f.work, 'root'), results = join(f.work, 'results'), shard = join(f.work, 'shard'), canary = join(f.work, 'canary-results');
  const exportJson = join(f.repo, 'docs', 'benchmarks', '2026-11-12-syn-out', 'sealed-results', 'export.json');
  const env = { PATH: `${join(f.gh, '..')}:${process.env.PATH}`, HOME: process.env.HOME };
  const cleanup = (extra: string[]) => spawnSync('bun', ['scripts/sealed/cleanup.ts', '--export', exportJson, '--sealed-root', root, '--results', results, '--results', shard, ...extra, '--custody', f!.custody], { cwd: f!.repo, encoding: 'utf8', env });
  // an export committed but never pushed is refused: cleanup removes export-pending/, the only other copy
  const unpushed = cleanup([]);
  expect(unpushed.status).toBe(2);
  expect(unpushed.stderr).toMatch(/^HE-SEALED-014 the commit holding \S+\/sealed-results \([0-9a-f]{12}\) is on no remote-tracking branch; push the export first/);
  const push = spawnSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: f.repo, encoding: 'utf8' });
  expect(push.status, push.stderr).toBe(0);
  // the canary directory's manifest.json is malformed on purpose, so it names no run and cleanup refuses all of it
  const unbound = cleanup(['--results', canary]);
  expect(unbound.status).toBe(2);
  expect(unbound.stderr).toContain(`HE-SEALED-014 --results ${canary} names no run`);
  expect(existsSync(root) && existsSync(results) && existsSync(shard) && existsSync(canary)).toBe(true);
  const clean = cleanup([]);
  expect(clean.status, clean.stderr).toBe(0);
  expect(clean.stdout).toContain('removed 3 plaintext directories');
  expect(NEEDLES.filter((n) => (unbound.stdout + unbound.stderr + clean.stdout + clean.stderr).includes(n))).toEqual([]);
  rmSync(canary, { recursive: true, force: true });
  expect(existsSync(root) || existsSync(results) || existsSync(shard)).toBe(false);
});
