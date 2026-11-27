// The provider stop (runner/cost/provider-stop.ts, internal-task): a shard stops once one provider has refused 3 trials in a row
// for want of credit. The rule against single trials' proxy lines, the usage-log scan and its CLI (which
// frontier-harbor's vm-run.sh runs beside Harbor), and the runner's trial loop end to end, offline: the fixture adapter as a
// host process makes one model call per trial through the real metering proxy to a fake Anthropic upstream. No key, no
// model, no docker.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { GradeResult } from '../runner/contracts.ts';
import { classify } from '../runner/cost/provider-probe.ts';
import { PROVIDER_STOP_AFTER, ProviderStopWatch, creditRefusal, scanUsage, trialVerdicts, type StopLine } from '../runner/cost/provider-stop.ts';
import { buildManifest, loadPrereg, type Cell, type Prereg } from '../runner/run.ts';
import { RUN_EXIT, executeRun, readRecords } from '../runner/trial/run.ts';

const ROOT = resolve(import.meta.dir, '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const tmp = mkdtempSync(join(tmpdir(), 'he-provider-stop-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const XAI_OUT = { error: 'Your team has either used all available credits or reached its monthly spending limit.' };
const line = (key: string, provider: string, status: number, extra: Partial<StopLine> = {}): StopLine => ({ key, provider, outcome: 'forwarded', status, ...extra });

describe('the credit rule', () => {
  test('402 always; 400, 401, 403 and 429 only with credit wording; the launch check reads the same answers as HE-PROVIDER-002', () => {
    expect(creditRefusal(402, '')).toBe(true);
    expect(creditRefusal(403, JSON.stringify(XAI_OUT))).toBe(true);
    expect(creditRefusal(400, 'Your credit balance is too low to access the Anthropic API.')).toBe(true);
    expect(creditRefusal(401, 'billing account suspended')).toBe(true);
    expect(creditRefusal(429, 'insufficient_quota')).toBe(true);
    expect(creditRefusal(429, 'Number of requests per minute exceeded')).toBe(false);
    expect(creditRefusal(429, JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Resource has been exhausted (e.g. check quota).' } }))).toBe(false);
    expect(classify(429, 'Resource has been exhausted (e.g. check quota).').code).toBe('HE-PROVIDER-004');
    const geminiRate = JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.' } });
    expect(creditRefusal(429, geminiRate)).toBe(false);
    expect(classify(429, geminiRate).code).toBe('HE-PROVIDER-004');
    expect(creditRefusal(429, 'insufficient_quota You exceeded your current quota, please check your plan and billing details.')).toBe(true);
    expect(creditRefusal(429, JSON.stringify(XAI_OUT))).toBe(true);
    expect(creditRefusal(403, 'model access denied')).toBe(false);
    expect(creditRefusal(500, 'credit')).toBe(false);
    expect(creditRefusal(200, 'balance')).toBe(false);
    expect(classify(401, 'billing account suspended').code).toBe('HE-PROVIDER-002');
    expect(classify(401, '{}').code).toBe('HE-PROVIDER-001');
  });
});

describe('one trial against each provider', () => {
  test('a forwarded 402 anywhere in the trial counts, as in the skills-at-scale analysis, even when a later answer succeeded', () => {
    const v = trialVerdicts([line('t', 'particle', 402), line('t', 'particle', 200)]);
    expect(v.get('particle')!.refused?.status).toBe(402);
  });

  test('a worded 403 or 429 counts only when it is the provider\'s last answer in the trial', () => {
    expect(trialVerdicts([line('t', 'xai', 200), line('t', 'xai', 403, { error_body: XAI_OUT })]).get('xai')!.refused?.status).toBe(403);
    expect(trialVerdicts([line('t', 'google', 429, { error_text: 'Resource has been exhausted (e.g. check quota).' }), line('t', 'google', 200)]).get('google')!.refused).toBeNull();
  });

  test('the proxy\'s own refusals are not the provider\'s, and each provider is judged on its own lines', () => {
    const v = trialVerdicts([{ key: 't', provider: 'anthropic', outcome: 'refused', status: 402 }, line('t', 'openai', 200), line('t', 'xai', 402)]);
    expect([...v.keys()].sort()).toEqual(['openai', 'xai']);
    expect(v.get('openai')!.refused).toBeNull();
    expect(v.get('xai')!.refused?.status).toBe(402);
  });
});

describe('trials in a row', () => {
  test('the third refused trial in a row stops, naming the provider, the three trials and the last answer', () => {
    const w = new ProviderStopWatch();
    expect(PROVIDER_STOP_AFTER).toBe(3);
    expect(w.observe('a', [line('a', 'xai', 403, { error_body: XAI_OUT, error_code: 'forbidden' })])).toBeNull();
    expect(w.observe('b', [line('b', 'xai', 403, { error_body: XAI_OUT, error_code: 'forbidden' })])).toBeNull();
    const stop = w.observe('c', [line('c', 'xai', 403, { error_body: XAI_OUT, error_code: 'forbidden' })], new Date('2026-11-26T20:00:00Z'));
    expect(stop).toEqual({ schema: 'provider-stop/1', at: '2026-11-26T20:00:00.000Z', provider: 'xai', after: 3, trials: ['a', 'b', 'c'], last: { status: 403, error_code: 'forbidden' } });
  });

  test('a trial the provider answered resets its run; a trial that never called it leaves the run alone', () => {
    const w = new ProviderStopWatch();
    w.observe('a', [line('a', 'xai', 402)]);
    w.observe('b', [line('b', 'xai', 402)]);
    expect(w.observe('c', [line('c', 'xai', 200)])).toBeNull();
    w.observe('d', [line('d', 'xai', 402)]);
    w.observe('e', [line('e', 'xai', 402)]);
    expect(w.observe('f', [line('f', 'anthropic', 200)])).toBeNull();
    expect(w.observe('g', [line('g', 'xai', 402)])?.trials).toEqual(['d', 'e', 'g']);
  });

  test('a scan can leave out lines before a start time and trials that are still logging', () => {
    const t0 = Date.parse('2026-11-26T10:00:00.000Z'), at = (s: number) => new Date(t0 + s * 1000).toISOString();
    const old = ['a', 'b', 'c'].map((k) => line(k, 'xai', 402, { at: at(-3600) }));
    expect(scanUsage(old)?.trials).toEqual(['a', 'b', 'c']);
    expect(scanUsage(old, PROVIDER_STOP_AFTER, new Date(), { since: t0 })).toBeNull();
    const now = [line('d', 'xai', 403, { at: at(10), error_text: XAI_OUT.error }), line('e', 'xai', 403, { at: at(20), error_text: XAI_OUT.error }),
      line('f', 'xai', 403, { at: at(400), error_text: XAI_OUT.error })];
    expect(scanUsage([...old, ...now], PROVIDER_STOP_AFTER, new Date(), { since: t0, settledBefore: t0 + 100_000 })).toBeNull();
    expect(scanUsage([...old, ...now], PROVIDER_STOP_AFTER, new Date(), { since: t0, settledBefore: t0 + 400_000 })?.trials).toEqual(['d', 'e', 'f']);
  });

  test('a trial still logging between refused ones breaks the run, and the stop waits until it settles refused', () => {
    const t0 = Date.parse('2026-11-26T10:00:00.000Z'), at = (s: number) => new Date(t0 + s * 1000).toISOString();
    const refused = (k: string, s: number) => line(k, 'xai', 403, { at: at(s), error_text: XAI_OUT.error });
    const log = [refused('d', 10), refused('e', 20), line('g', 'xai', 403, { at: at(30), error_text: XAI_OUT.error }), line('g', 'xai', 200, { at: at(500) }), refused('f', 40), refused('h', 50)];
    expect(scanUsage(log, PROVIDER_STOP_AFTER, new Date(), { since: t0, settledBefore: t0 + 100_000 })).toBeNull();
    expect(scanUsage(log, PROVIDER_STOP_AFTER, new Date(), { since: t0, settledBefore: t0 + 600_000 })).toBeNull();
    const late = [...log.slice(0, 3), line('g', 'xai', 403, { at: at(500), error_text: XAI_OUT.error }), ...log.slice(4)];
    expect(scanUsage(late, PROVIDER_STOP_AFTER, new Date(), { since: t0, settledBefore: t0 + 100_000 })).toBeNull();
    expect(scanUsage(late, PROVIDER_STOP_AFTER, new Date(), { since: t0, settledBefore: t0 + 600_000 })?.trials).toEqual(['d', 'e', 'g']);
  });

  test('a scan of a usage log orders trials by their first line and skips slot: keys', () => {
    const log = [line('t1', 'xai', 402), line('slot:x', 'xai', 402), line('t2', 'xai', 402), line('t1', 'xai', 402), line('t3', 'xai', 402)];
    expect(scanUsage(log)?.trials).toEqual(['t1', 't2', 't3']);
    expect(scanUsage(log.slice(0, 4))).toBeNull();
  });
});

describe('the CLI frontier-harbor runs beside Harbor', () => {
  const usage = join(tmp, 'proxy-usage.ndjson');
  const env = { PATH: process.env.PATH ?? '', HOME: tmp };
  const cli = join(ROOT, 'runner', 'cost', 'provider-stop.ts');

  test('scan exits 0 with no stop and 8 with one, and writes the stop reason', () => {
    writeFileSync(usage, [line('a', 'xai', 402), line('b', 'xai', 402)].map((l) => JSON.stringify(l)).join('\n') + '\n{"partial');
    const out = join(tmp, 'stop.json');
    expect(spawnSync('bun', [cli, 'scan', '--usage', usage, '--out', out], { env }).status).toBe(0);
    expect(existsSync(out)).toBe(false);
    writeFileSync(usage, [line('a', 'xai', 402), line('b', 'xai', 402), line('c', 'xai', 402)].map((l) => JSON.stringify(l)).join('\n') + '\n');
    const r = spawnSync('bun', [cli, 'scan', '--usage', usage, '--out', out], { env, encoding: 'utf8' });
    expect(r.status).toBe(8);
    expect(r.stderr).toContain('HE-PROVIDER-006 xai refused 3 trials in a row');
    expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ provider: 'xai', trials: ['a', 'b', 'c'] });
    expect(spawnSync('bun', [cli, 'watch', '--usage', usage], { env }).status).toBe(2);
  });

  test('watch signals the shard with USR1 once the log shows a stop', async () => {
    const live = join(tmp, 'live.ndjson'), out = join(tmp, 'watch-stop.json'), mark = join(tmp, 'usr1');
    writeFileSync(live, '');
    const shard = spawn('bash', ['-c', `trap 'echo got > ${mark}; exit 8' USR1; while :; do sleep 0.2; done`], { env });
    const watch = spawn('bun', [cli, 'watch', '--usage', live, '--out', out, '--signal-pid', String(shard.pid), '--every', '0.2', '--quiet', '0'], { env });
    const watchExit = new Promise<number | null>((r) => watch.on('exit', r));
    const shardExit = new Promise<number | null>((r) => shard.on('exit', r));
    await Bun.sleep(600);
    expect(existsSync(mark)).toBe(false);
    const at = new Date().toISOString();
    writeFileSync(live, [line('a', 'openrouter', 402, { at }), line('b', 'openrouter', 402, { at }), line('c', 'openrouter', 402, { at })].map((l) => JSON.stringify(l)).join('\n') + '\n');
    expect(await watchExit).toBe(8);
    expect(await shardExit).toBe(8);
    expect(readFileSync(mark, 'utf8').trim()).toBe('got');
    expect(JSON.parse(readFileSync(out, 'utf8')).provider).toBe('openrouter');
  }, 20_000);

  test('watch ignores refusals logged before it started, so a resumed shard is not stopped by the stop it resumes from', async () => {
    const live = join(tmp, 'resume.ndjson'), out = join(tmp, 'resume-stop.json');
    const old = new Date(Date.now() - 3_600_000).toISOString();
    writeFileSync(live, ['a', 'b', 'c'].map((k) => JSON.stringify(line(k, 'xai', 402, { at: old }))).join('\n') + '\n');
    const shard = spawn('bash', ['-c', "trap 'exit 8' USR1; for i in $(seq 15); do sleep 0.2; done; exit 0"], { env });
    const watch = spawn('bun', [cli, 'watch', '--usage', live, '--out', out, '--signal-pid', String(shard.pid), '--every', '0.2', '--quiet', '0'], { env });
    try {
      expect(await new Promise<number | null>((r) => shard.on('exit', r))).toBe(0);
      expect(existsSync(out)).toBe(false);
    } finally { watch.kill(); }
  }, 20_000);
});

describe("vm-run.sh's watcher (read from the script: vm-run.sh runs only on a VM)", () => {
  const src = readFileSync(join(ROOT, 'scripts', 'frontier-harbor', 'vm-run.sh'), 'utf8');
  const fin = src.slice(src.indexOf('finish() {'), src.indexOf('\n}\n', src.indexOf('finish() {')));

  test('finish() ignores USR1 and stops the watcher before it writes any record, and a stop found then still exits 8', () => {
    const stopsWatcher = fin.indexOf('kill "$stop_pid"');
    expect(fin.indexOf("trap '' USR1")).toBeGreaterThan(-1);
    expect(fin.indexOf("trap '' USR1")).toBeLessThan(stopsWatcher);
    expect(stopsWatcher).toBeLessThan(fin.indexOf('unbind-all'));
    const after = src.slice(src.indexOf('\nfinish 8 120000\n'));
    expect(after.split('\n')[2]).toContain('[ ! -e "$out/provider-stop.json" ] || {');
    expect(after.split('\n')[2]).toContain('rc=8');
  });

  test("an interrupt's handler ignores a USR1 that lands while it writes the records, and an earlier stop file is moved aside", () => {
    const sig = src.slice(src.indexOf('on_signal() {'), src.indexOf('\n}\n', src.indexOf('on_signal() {')));
    expect(sig).toContain("trap '' USR1");
    expect(sig).not.toMatch(/trap - [A-Z ]*USR1/);
    expect(src.indexOf('mv "$out/provider-stop.json"')).toBeLessThan(src.indexOf('provider-stop.ts watch'));
  });

  // Value: protects=the Cursor key scan runs, and a hit exits 5, after a provider stop or an interrupt as well as at the normal
  // end, so results holding the key are never handed to the lane as a plain exit 8; and finish() ignores USR1 from its first
  // line, before it stops the journal; fails_when=on_signal exits with its own code before any key scan; why_new=#626's
  // second-model review (exit 8 hid the scan); seam=vm-run.sh's own key_scan and on_signal, cut from the script and run in
  // bash with finish and the key scanner stubbed; no_claim=a VM, Harbor or the real key scan.
  test("after a provider stop, on_signal still runs the Cursor key scan, and a hit exits 5, not 8", () => {
    const fn = (name: string) => { const i = src.indexOf('\n' + name + '() {\n'); expect(i).toBeGreaterThan(-1); return src.slice(i + 1, src.indexOf('\n}\n', i) + 3); };
    expect(fin.split('\n')[1]?.trim()).toBe("trap '' USR1");
    const dir = mkdtempSync(join(tmp, 'vmrun-'));
    mkdirSync(join(dir, 'bin'));
    const shell = (scan: number) => {
      writeFileSync(join(dir, 'bin', 'bun'), '#!/usr/bin/env bash\necho "scanned $2"\nexit ' + scan + '\n', { mode: 0o755 });
      const body = ['set -euo pipefail', 'say() { echo "say: $*"; }', 'run_scrubbed() { "$@"; }', 'finish() { echo finished; }',
        'out=' + JSON.stringify(dir) + ' repo=' + JSON.stringify(dir) + ' cursor_key=placeholder-not-a-key cursor_key_dir=' + JSON.stringify(join(dir, 'kd')),
        'harbor_pid="" harbor_started=1 lane_pids=() rc=""', fn('key_scan'), fn('on_signal'), 'on_signal 8'].join('\n');
      return spawnSync('bash', ['-c', body], { encoding: 'utf8', env: { PATH: join(dir, 'bin') + ':/usr/bin:/bin', HOME: dir } });
    };
    const clean = shell(0);
    expect(clean.status, clean.stderr).toBe(8);
    expect(clean.stdout).toContain('finished\n');
    expect(clean.stdout).toContain('scanned ' + dir);
    const hit = shell(1);
    expect(hit.status, hit.stderr).toBe(5);
    expect(hit.stdout).toContain('say: HE-CURSOR-003 the key scan of ' + dir + ' exited 1');
    expect(src.slice(src.indexOf('\nfinish 8 120000\n')).trim().split('\n').slice(-2)).toEqual(['key_scan', 'exit "$rc"']);
  });
});

describe("the runner's trial loop", () => {
  const PROXY_ENV = { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' };
  const stubGrade = (): GradeResult => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] });
  const OK = { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 1 } };
  const NO_CREDIT = { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } };

  /** A fake Anthropic that answers each call with the next status in `plan` (the last one repeats). */
  function fakeAnthropic(plan: number[]) {
    let calls = 0;
    return Bun.serve({ port: 0, fetch: () => {
      const status = plan[Math.min(calls++, plan.length - 1)]!;
      return Response.json(status === 200 ? OK : status === 402 ? { type: 'error', error: { type: 'billing_error', message: 'payment required' } } : NO_CREDIT, { status });
    } });
  }

  async function run(name: string, plan: number[], tasks = 5, only?: string[]) {
    const root = join(tmp, name, 'tasks');
    const ids = Array.from({ length: tasks }, (_, i) => `fx-model-${i + 1}`);
    for (const id of ids) {
      const dir = join(root, 'multiuser', 'dev', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'task.toml'), `id = "${id}"\nslice = "multiuser"\nsplit = "dev"\ntime_budget_s = 20\nactors = ["dana-okafor"]\n\n[[turns]]\nactor = "dana-okafor"\nchannel = "north-team"\ntext = "call the model [fx:model]"\n\n[predicates]\nrequired = []\nforbidden_effects = []\n`);
    }
    const cell: Cell = { id: 'fx', harness: '_fixture', model: 'anthropic:claude-sonnet-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, tasks: ids,
      ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, harness_mode: 'process', adapter: join(FIXTURES, 'serve-adapter.ts') };
    const runId = `ps-${name}`;
    const dir = join(tmp, runId);
    mkdirSync(dir, { recursive: true });
    const preregFile = join(dir, 'prereg.json');
    const cells = only ? [cell, { ...cell, id: 'fx2' }] : [cell];
    writeFileSync(preregFile, JSON.stringify({ schema_version: 1, run_id: runId, question: 'fixture', tasks: {}, cells, wall_clock_s: { multiuser: 120 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] } satisfies Prereg));
    const { prereg, sha256 } = loadPrereg(preregFile);
    const manifest = buildManifest(prereg, sha256, '2026-11-26T00:00:00Z', { tasksRoot: root });
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const fake = fakeAnthropic(plan);
    try {
      const result = await executeRun(manifest, manifestPath, { harnessMode: 'process', preamblePath: join(FIXTURES, 'preamble.md'), grade: stubGrade, proxyEnv: PROXY_ENV,
        ...(only ? { cells: only } : {}), leaseUsd: 1, newLease: true, turnGraceS: 1, stopGraceS: 2, readyTimeoutS: 20, repoRoot: ROOT, proxyUpstream: { anthropic: `http://127.0.0.1:${fake.port}` } });
      return { result, dir, manifest };
    } finally { fake.stop(true); }
  }

  test('three trials in a row refused for credit stop the run with exit 8 and write provider-stop.json; the rest never start', async () => {
    const { result, dir, manifest } = await run('stop', [400]);
    expect(result.exit).toBe(RUN_EXIT.providerStop);
    expect(RUN_EXIT.providerStop).toBe(8);
    expect(result.records).toHaveLength(3);
    expect(readRecords(dir)).toHaveLength(3);
    const stop = JSON.parse(readFileSync(join(dir, 'provider-stop.json'), 'utf8'));
    expect(stop).toMatchObject({ schema: 'provider-stop/1', run_id: manifest.run_id, provider: 'anthropic', after: 3, last: { status: 400 } });
    expect(stop.trials).toEqual(manifest.trials.slice(0, 3).map((t) => t.id));
    expect(JSON.parse(readFileSync(join(dir, 'run-summary.json'), 'utf8'))).toMatchObject({ provider_stop: 'anthropic', complete: false, trials_recorded: 3, trials_planned: 5 });
  }, 120_000);

  test('a stop reached on the last trial leaves a full run complete with exit 0, and still writes provider-stop.json', async () => {
    const { result, dir } = await run('last', [400], 3);
    expect(result.exit).toBe(RUN_EXIT.ok);
    expect(readRecords(dir)).toHaveLength(3);
    expect(JSON.parse(readFileSync(join(dir, 'provider-stop.json'), 'utf8'))).toMatchObject({ provider: 'anthropic', after: 3 });
    expect(JSON.parse(readFileSync(join(dir, 'run-summary.json'), 'utf8'))).toMatchObject({ provider_stop: 'anthropic', complete: true, trials_recorded: 3, trials_planned: 3 });
  }, 120_000);

  test("a stop on the last trial of a shard's selected cells exits 0, while the run as a whole stays incomplete", async () => {
    const { result, dir } = await run('shard', [400], 3, ['fx']);
    expect(result.exit).toBe(RUN_EXIT.ok);
    expect(readRecords(dir)).toHaveLength(3);
    expect(JSON.parse(readFileSync(join(dir, 'run-summary.json'), 'utf8'))).toMatchObject({ provider_stop: 'anthropic', complete: false, trials_recorded: 3, trials_planned: 6 });
  }, 120_000);

  test('two refused trials and then an answered one do not stop the run', async () => {
    const { result, dir } = await run('recover', [402, 402, 200], 4);
    expect(result.exit).toBe(RUN_EXIT.ok);
    expect(result.records).toHaveLength(4);
    expect(existsSync(join(dir, 'provider-stop.json'))).toBe(false);
  }, 120_000);
});
