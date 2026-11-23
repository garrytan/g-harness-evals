// A harness that never started (prepare.sh, docker compose up or docker run failed) does not end the invocation: the trial goes to
// not-started.jsonl, never trials.jsonl, the run goes on, the invocation exits 7 (RUN_EXIT.harnessNotStarted), and --resume retries
// it. Keyless, modelled on tests/run-order.test.ts: a stand-in compose harness under a temporary repository root whose prepare.sh
// exits non-zero, the real world and proxy with placeholder keys, a stub grader. Every run is a subprocess with a scrubbed
// environment (PATH and HOME only; HE_CONTAINER_HOST_IP stands in for the docker bridge gateway, as in tests/internal-network.test.ts).
import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildManifest, loadPrereg, type Cell, type Manifest } from '../runner/run.ts';
import { RUN_EXIT, readRecords, unstartedTrials } from '../runner/trial/run.ts';

const ROOT = resolve(import.meta.dir, '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const tmp = mkdtempSync(join(tmpdir(), 'he-run-prepare-failure-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const REPO = join(tmp, 'repo');
const TASKS = join(tmp, 'tasks');
const CLEAN_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? tmp };
const PROXY_ENV = { ...CLEAN_ENV, ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' };

const taskDir = join(TASKS, 'multiuser', 'dev', 'fx-one');
mkdirSync(taskDir, { recursive: true });
writeFileSync(join(taskDir, 'task.toml'), 'id = "fx-one"\nslice = "multiuser"\nsplit = "dev"\ntime_budget_s = 20\nactors = ["dana-okafor"]\n\n[[turns]]\nactor = "dana-okafor"\nchannel = "north-team"\ntext = "hello from fx-one"\n\n[predicates]\nrequired = []\nforbidden_effects = []\n');
const HARNESS = join(REPO, 'harnesses', '_fixture');
mkdirSync(HARNESS, { recursive: true });
writeFileSync(join(HARNESS, 'compose.yaml'), 'services: {}\n');
const brokenPrepare = () => writeFileSync(join(HARNESS, 'prepare.sh'), '#!/bin/bash\necho "prepare refused: the pinned image is missing" >&2\nexit 3\n');
brokenPrepare();

const DRIVER = join(tmp, 'driver.ts');
writeFileSync(DRIVER, [
  "import { readFileSync } from 'node:fs';",
  `import { executeRun } from ${JSON.stringify(join(ROOT, 'runner', 'trial', 'run.ts'))};`,
  'const [manifestPath, optsJson] = process.argv.slice(2);',
  "const grade = () => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] });",
  'try {',
  '  const r = await executeRun(JSON.parse(readFileSync(manifestPath, "utf8")), manifestPath, { ...JSON.parse(optsJson), grade });',
  '  console.log("RESULT " + JSON.stringify({ exit: r.exit, skipped: r.skipped, records: r.records.map((x) => x.trial_id) }));',
  '} catch (e) { console.log("ERROR " + e.message); }',
].join('\n') + '\n');

type Outcome = { exit?: number; skipped?: string[]; records?: string[]; error?: string };
function run(manifestPath: string, opts: Record<string, unknown>): Outcome {
  const full = { preamblePath: join(FIXTURES, 'preamble.md'), proxyEnv: PROXY_ENV, turnGraceS: 1, stopGraceS: 2, readyTimeoutS: 20, repoRoot: REPO, ...opts };
  const p = Bun.spawnSync([process.execPath, DRIVER, manifestPath, JSON.stringify(full)], { cwd: ROOT, env: { ...CLEAN_ENV, HE_CONTAINER_HOST_IP: '127.0.0.2' }, stdout: 'pipe', stderr: 'pipe' });
  const line = p.stdout.toString().split('\n').find((l) => l.startsWith('RESULT ') || l.startsWith('ERROR '));
  if (!line) throw new Error(`driver printed no result (exit ${p.exitCode}): ${p.stderr.toString().slice(-800)}`);
  return line.startsWith('ERROR ') ? { error: line.slice(6) } : JSON.parse(line.slice(7)) as Outcome;
}

const cell = (id: string, extra: Partial<Cell> = {}): Cell => ({ id, harness: '_fixture', model: 'anthropic:claude-sonnet-5-5', slice: 'multiuser', split: 'dev', repetitions: 2, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, harness_mode: 'process', adapter: join(FIXTURES, 'serve-adapter.ts'), ...extra });
let n = 0;
function plan(cells: Cell[]) {
  const runId = `prepare-failure-${++n}`;
  const runDir = join(tmp, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'prereg.json'), JSON.stringify({ schema_version: 1, run_id: runId, question: 'prepare failure', tasks: { multiuser: ['fx-one'] }, cells, wall_clock_s: { multiuser: 60 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] }));
  const { prereg, sha256 } = loadPrereg(join(runDir, 'prereg.json'));
  const manifest = buildManifest(prereg, sha256, '2026-11-22T00:00:00Z', { tasksRoot: TASKS });
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { manifest, manifestPath: join(runDir, 'manifest.json'), runDir };
}
const notStarted = (runDir: string) => readFileSync(join(runDir, 'not-started.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { at: string; trial_id: string; cell: string; error: string });

describe('a harness that never started', () => {
  test('both broken cells go to not-started.jsonl, not trials.jsonl; the invocation finishes and exits 7; --resume retries them and exits 0', () => {
    const { manifest, manifestPath, runDir } = plan([cell('a'), cell('b')]);
    const ids = (c: string) => manifest.trials.filter((t) => t.cell === c).map((t) => t.id);
    const first = run(manifestPath, { harnessMode: 'docker' });
    expect(first.error).toBeUndefined();
    expect(first.exit).toBe(RUN_EXIT.harnessNotStarted);
    expect(first.records).toEqual([]);
    expect(readRecords(runDir)).toEqual([]);
    const lines = notStarted(runDir);
    expect(lines.map((l) => l.trial_id)).toEqual(manifest.trials.map((t) => t.id));
    expect(lines.map((l) => l.cell)).toEqual(manifest.trials.map((t) => t.cell));
    for (const l of lines) {
      expect(l.error).toStartWith('HE-RUN-006 ');
      expect(l.error).toContain('prepare.sh failed: prepare refused: the pinned image is missing');
      expect(Number.isNaN(Date.parse(l.at))).toBe(false);
      expect(l).toMatchObject({ usd: 0, undrained: 0, cap_stop: false });
    }
    const log = readFileSync(join(runDir, 'run.log'), 'utf8');
    expect(log).toContain('4 trials never started (cells a, b)');
    for (const t of manifest.trials) expect(log).toContain(`trial ${t.id} not started (cell ${t.cell})`);

    // prepare.sh is fixed; the trials then run in process mode on the fixture adapter, since a compose stack needs docker.
    writeFileSync(join(HARNESS, 'prepare.sh'), '#!/bin/bash\nexit 0\n');
    const onlyA = run(manifestPath, { harnessMode: 'process', resume: true, cells: ['a'] });
    expect(onlyA.error).toBeUndefined();
    expect(onlyA.records).toEqual(ids('a'));
    expect(onlyA.skipped).toEqual([]);
    expect(onlyA.exit).toBe(RUN_EXIT.ok);
    const rest = run(manifestPath, { harnessMode: 'process', resume: true });
    expect(rest.records).toEqual(ids('b'));
    expect(rest.skipped).toEqual(ids('a'));
    expect(rest.exit).toBe(RUN_EXIT.ok);
    expect(readRecords(runDir).map((r) => r.trial_id).sort()).toEqual(manifest.trials.map((t) => t.id).sort());
    expect(unstartedTrials(runDir, manifest.trials)).toEqual([]);
    brokenPrepare();
  }, 180_000);

  test('a non-start RunnerError still ends the run: HE-RUN-005 on the first trial, no second trial, no not-started.jsonl', () => {
    const { manifestPath, runDir } = plan([cell('noadapter', { adapter: undefined })]);
    const out = run(manifestPath, { harnessMode: 'process' });
    expect(out.error).toStartWith('HE-RUN-005 ');
    expect(existsSync(join(runDir, 'not-started.jsonl'))).toBe(false);
    expect(readFileSync(join(runDir, 'run.log'), 'utf8').match(/ starting \(/g)).toHaveLength(1);
  }, 60_000);

  test('throwOnNotStarted (the one-trial check scripts) keeps the old throw: HE-RUN-006 ends the run and nothing goes to not-started.jsonl', () => {
    const { manifestPath, runDir } = plan([cell('thrown')]);
    const out = run(manifestPath, { harnessMode: 'docker', throwOnNotStarted: true });
    expect(out.error).toStartWith('HE-RUN-006 ');
    expect(out.error).toContain('prepare.sh failed: prepare refused: the pinned image is missing');
    expect(existsSync(join(runDir, 'not-started.jsonl'))).toBe(false);
  }, 60_000);
});

describe('HE-RUN-006 records that are not start failures keep exiting 0', () => {
  const singleShot = (runId: string): Manifest => ({ schema_version: 1, run_id: runId, prereg_sha256: 'x', created_at: '2026-11-22T00:00:00Z', cost_ceiling_usd: 1, per_cell_ceiling_usd: { h: 1 }, spend_cap_usd: 1, trial_hours_at_cap: 1,
    cells: [{ id: 'h', harness: '_fixture', model: 'anthropic:claude-sonnet-5-5', slice: 'hello', split: 'dev', repetitions: 1, ceiling: { input_tokens: 1_000, output_tokens: 100 } }],
    trials: [{ id: `${runId}/h/fx-hello/r1`, cell: 'h', task: 'fx-hello', repetition: 1 }] });
  const write = (m: Manifest) => { const runDir = join(tmp, m.run_id); mkdirSync(runDir, { recursive: true }); writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(m)); return { runDir, manifestPath: join(runDir, 'manifest.json') }; };

  test('single shot: run-trial.sh exiting without result.json is a trials.jsonl line, and the run exits 0', () => {
    writeFileSync(join(REPO, 'harnesses', 'run-trial.sh'), '#!/bin/bash\necho "no image here" >&2\nexit 1\n');
    const m = singleShot('single-shot-no-result');
    const { runDir, manifestPath } = write(m);
    const out = run(manifestPath, { harnessMode: 'process' });
    expect(out.exit).toBe(RUN_EXIT.ok);
    const [record] = readRecords(runDir);
    expect(record!.error).toStartWith('HE-RUN-006 harnesses/run-trial.sh exited 1 without result.json');
    expect(existsSync(join(runDir, 'not-started.jsonl'))).toBe(false);
  }, 60_000);

  test('set T: a record whose error is "left no workspace to grade" counts as run, not unstarted, and a resume over it exits 0', () => {
    const m = singleShot('set-t-no-workspace');
    const { runDir, manifestPath } = write(m);
    const id = m.trials[0]!.id;
    writeFileSync(join(runDir, 'trials.jsonl'), JSON.stringify({ trial_id: id, cell: 'h', termination: 'infra_error', grade: 'n/a', error: `HE-RUN-006 set T trial ${id} left no workspace to grade` }) + '\n');
    expect(unstartedTrials(runDir, m.trials)).toEqual([]);
    writeFileSync(join(runDir, 'not-started.jsonl'), JSON.stringify({ at: '2026-11-22T00:00:00Z', trial_id: id, cell: 'h', error: 'HE-RUN-006 an earlier attempt' }) + '\n');
    expect(unstartedTrials(runDir, m.trials)).toEqual([]);
    const out = run(manifestPath, { harnessMode: 'process', resume: true });
    expect(out.skipped).toEqual([id]);
    expect(out.exit).toBe(RUN_EXIT.ok);
  }, 60_000);

  test('a torn not-started.jsonl line is HE-RUN-007 naming the file and line, never quoting it', () => {
    const m = singleShot('torn-not-started');
    const { runDir } = write(m);
    const id = m.trials[0]!.id;
    writeFileSync(join(runDir, 'not-started.jsonl'), JSON.stringify({ at: '2026-11-22T00:00:00Z', trial_id: id, cell: 'h', error: 'x' }) + '\n{"trial_id":"torn-secret-');
    expect(() => unstartedTrials(runDir, m.trials)).toThrow(/^HE-RUN-007 .*not-started\.jsonl line 2 is not JSON \(SyntaxError\)/);
    expect(() => unstartedTrials(runDir, m.trials)).not.toThrow(/torn-secret/);
  });
});

describe('startDockerHarness: a failed docker run', () => {
  test('removes the container docker created and throws HarnessNotStarted', () => {
    const bin = join(tmp, 'fake-bin');
    const calls = join(tmp, 'docker-calls.log');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'docker'), `#!/bin/bash\necho "$1 $2 $3" >> ${JSON.stringify(calls)}\nif [ "$1" = run ]; then echo "container created but could not start" >&2; exit 125; fi\nexit 0\n`);
    chmodSync(join(bin, 'docker'), 0o755);
    const trialRoot = join(tmp, 'docker-run-trial');
    const code = [
      `import { HarnessNotStarted, startDockerHarness } from ${JSON.stringify(join(ROOT, 'runner', 'trial', 'docker.ts'))};`,
      `import { makeTrialDirs } from ${JSON.stringify(join(ROOT, 'runner', 'trial', 'harness.ts'))};`,
      `try { await startDockerHarness({ harness: '_fixture', image: 'harness-eval/fixture:dev', trialSlug: 'slug-1', dirs: makeTrialDirs(${JSON.stringify(trialRoot)}), env: {} }); console.log('STARTED'); }`,
      "catch (e) { console.log((e instanceof HarnessNotStarted ? 'NOT_STARTED ' : 'OTHER ') + e.message); }",
    ].join('\n');
    const p = Bun.spawnSync([process.execPath, '-e', code], { cwd: ROOT, env: { ...CLEAN_ENV, PATH: `${bin}:${CLEAN_ENV.PATH}` }, stdout: 'pipe', stderr: 'pipe' });
    expect(p.stdout.toString().trim()).toStartWith('NOT_STARTED HE-RUN-006 docker run failed for harness-eval/fixture:dev: container created but could not start');
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual(['rm -f he-slug-1', 'run -d --name', 'rm -f he-slug-1']);
  });
});
