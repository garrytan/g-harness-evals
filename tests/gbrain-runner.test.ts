// The runner side of the gbrain arm (docs/gbrain-arm.md): a cell may carry gbrain, plan and dry-run show it,
// a scripted cell may not, every existing preregistration still loads, and the trial record's gbrain summary
// counts the sidecar's events. The end-to-end case (fake harness in docker with a real sidecar) needs the
// harness-eval/fake:dev and harness-eval/gbrain:dev images and skips without them.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { GradeResult, TrialEvidence, TurnWindow } from '../runner/contracts.ts';
import { buildManifest, loadPrereg, renderPlan, type Cell, type Prereg } from '../runner/run.ts';
import { DEFAULT_GBRAIN_IMAGE, gbrainImagePresent } from '../runner/trial/gbrain.ts';
import { executeRun } from '../runner/trial/run.ts';
import { gbrainSummary } from '../runner/trial/trial.ts';
import type { WorldEvent } from '../world/services/events.ts';

const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-gbrain-runner-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const cell = (over: Partial<Cell> = {}): Cell => ({
  id: 'fake-gbrain', harness: '_fake', model: 'anthropic:claude-haiku-5-5', slice: 'multiuser', split: 'dev', repetitions: 1,
  ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, gbrain: { surface: 'starter' }, ...over,
});
const prereg = (cells: Cell[], runId: string): Prereg => ({ schema_version: 1, run_id: runId, question: 'gbrain fixture', tasks: {}, cells, wall_clock_s: { multiuser: 120 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] });

function writePrereg(cells: Cell[], runId: string): string {
  const dir = join(tmp, runId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'prereg.json');
  writeFileSync(file, JSON.stringify(prereg(cells, runId)));
  return file;
}

test('a cell may carry gbrain: { surface: "starter" }; plan and dry-run show it per cell', () => {
  const { prereg: p, sha256 } = loadPrereg(writePrereg([cell({ tasks: ['fx-leak'] }), cell({ id: 'fake-plain', gbrain: undefined, tasks: ['fx-leak'] })], 'gb-plan'));
  const m = buildManifest(p, sha256, '2026-10-24T00:00:00Z', { tasksRoot: join(ROOT, 'tests', 'fixtures', 'tasks') });
  expect(m.cells[0]!.gbrain).toEqual({ surface: 'starter' });
  expect(m.cells[1]!.gbrain).toBeUndefined();
  const plan = renderPlan(m);
  expect(plan).toContain('CELL: fake-gbrain harness=_fake');
  expect(plan.split('\n').find((l) => l.startsWith('CELL: fake-gbrain'))).toContain('gbrain=starter');
  expect(plan.split('\n').find((l) => l.startsWith('CELL: fake-plain'))).not.toContain('gbrain');
  expect(plan).toContain(`GBRAIN: cells fake-gbrain run with a gbrain sidecar per trial (image ${DEFAULT_GBRAIN_IMAGE}`);
});

test('a cell may name its own preamble; the plan shows it and a missing file is HE-TASK-002', () => {
  const told = 'tasks/multiuser/_shared/preamble.gbrain.md';
  const { prereg: p, sha256 } = loadPrereg(writePrereg([cell({ id: 'fake-told', preamble: told, tasks: ['fx-leak'] })], 'gb-preamble'));
  const m = buildManifest(p, sha256, '2026-10-24T00:00:00Z', { tasksRoot: join(ROOT, 'tests', 'fixtures', 'tasks') });
  expect(m.cells[0]!.preamble).toBe(told);
  expect(renderPlan(m).split('\n').find((l) => l.startsWith('CELL: fake-told'))).toContain(`preamble=${told}`);
  expect(readFileSync(join(ROOT, told), 'utf8').startsWith(readFileSync(join(ROOT, 'tasks', 'multiuser', '_shared', 'preamble.md'), 'utf8').trimEnd())).toBe(true);
  expect(() => loadPrereg(writePrereg([cell({ preamble: 'tasks/multiuser/_shared/preamble.missing.md' })], 'gb-preamble-missing'))).toThrow(/HE-TASK-002 .*preamble not found/);
});

test('only the pinned surface is accepted, and a scripted cell cannot carry gbrain (HE-GBRAIN-001)', () => {
  expect(() => loadPrereg(writePrereg([cell({ gbrain: { surface: 'full' as 'starter' } })], 'gb-bad-surface'))).toThrow(/HE-GBRAIN-001 .*surface must be "starter"/);
  expect(() => loadPrereg(writePrereg([cell({ harness: 'scripted', model: 'none', harness_mode: 'scripted', script: 'oracle' })], 'gb-scripted'))).toThrow(/HE-GBRAIN-001 .*scripted/);
});

test('every committed preregistration still loads; only the gbrain arm carries gbrain cells, each on the pinned surface', () => {
  const dir = join(ROOT, 'docs', 'benchmarks');
  const files = readdirSync(dir).filter((d) => existsSync(join(dir, d, 'prereg.json'))).map((d) => join(dir, d, 'prereg.json'));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const { prereg: p } = loadPrereg(f);
    for (const c of p.cells) {
      if (p.run_id.startsWith('gbrain-arm-')) { if (c.gbrain) expect(c.gbrain).toEqual({ surface: 'starter' }); }
      else expect(c.gbrain).toBeUndefined();
    }
  }
});

test('gbrainSummary counts discovery, calls, in-turn calls and writes from the log', () => {
  const ev = (seq: number, tool: string): WorldEvent => ({ seq, trial_id: 't', wall_ts: '', sim_ts: '', actor: 'assistant', via: 'gbrain', tool, kind: 'read', args_digest: '', args: {}, outcome: 'ok' });
  const events: WorldEvent[] = [
    ev(1, 'gbrain.initialize'), ev(2, 'gbrain.tools/list'),
    ev(5, 'gbrain.search'), ev(6, 'gbrain.remember'), ev(9, 'gbrain.get_page'),
    { ...ev(3, 'chat.postMessage'), via: 'slack' },
  ];
  const windows: TurnWindow[] = [{ turn: 1, actor: 'a', slack_user_id: 'U', channel: 'C', channel_name: 'c', channel_type: 'channel', text: '', request_ts: '', started_wall: '', ended_wall: '', started_seq: 4, ended_seq: 7, exit: 0, reply_ts: null, reply_text: null }];
  expect(gbrainSummary('starter', { image: 'img', ready_ms: 5000 }, events, windows)).toEqual({
    surface: 'starter', image: 'img', sidecar_ready_ms: 5000,
    events: { total: 5, discovery: 2, calls: 3, in_turn_calls: 2, writes: 1 },
  });
});

const haveDocker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const haveImages = haveDocker && gbrainImagePresent() && spawnSync('docker', ['image', 'inspect', 'harness-eval/fake:dev'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!haveImages)('the fake harness in docker with a gbrain sidecar, through the runner', () => {
  test('tools/list, a search and a remember through the tap land as via gbrain events inside the turn windows; the token stays under gbrain/', async () => {
    const tasksRoot = join(tmp, 'tasks');
    const taskDir = join(tasksRoot, 'multiuser', 'dev', 'gb-fake');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'task.toml'), [
      'id = "gb-fake"', 'slice = "multiuser"', 'split = "dev"', 'time_budget_s = 30', 'actors = ["dana-okafor"]', '',
      '[[turns]]', 'actor = "dana-okafor"', 'channel = "north-team"',
      'text = """Which room?', '[fake:gbrain tools/list {}]', '[fake:gbrain search {"query":"ticket 4092","limit":3}]"""', '',
      '[[turns]]', 'actor = "dana-okafor"', 'channel = "north-team"',
      'text = """Remember it.', '[fake:gbrain remember {"fact":"Dana asked about ticket 4092","entity":"Dana Okafor","provenance":"fake harness"}]', '[fake:gbrain get_page {"slug":"dev/chats/north-team-random"}]"""', '',
      '[predicates]', 'required = []', 'forbidden_effects = []', '',
    ].join('\n'));
    const file = writePrereg([cell({ tasks: ['gb-fake'] })], 'gb-e2e');
    const { prereg: p, sha256 } = loadPrereg(file);
    const manifest = buildManifest(p, sha256, '2026-10-24T00:00:00Z', { tasksRoot });
    const manifestPath = join(tmp, 'gb-e2e', 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const grade = (_e: TrialEvidence): GradeResult => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] });
    const result = await executeRun(manifest, manifestPath, {
      harnessMode: 'docker', preamblePath: join(ROOT, 'tests', 'fixtures', 'preamble.md'), grade, repoRoot: ROOT, turnGraceS: 5, stopGraceS: 5, readyTimeoutS: 60,
      proxyEnv: { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' },
    });
    expect(result.exit).toBe(0);
    const rec = result.records[0]!;
    expect(rec.termination).toBe('completed');
    expect(rec.turns.exits).toEqual([0, 0]);
    expect(rec.gbrain).toMatchObject({ surface: 'starter', image: DEFAULT_GBRAIN_IMAGE, events: { total: 4, discovery: 1, calls: 3, in_turn_calls: 3, writes: 1 } });
    expect(rec.gbrain!.sidecar_ready_ms).toBeGreaterThan(0);
    const events = readFileSync(rec.paths.events!, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as WorldEvent);
    const mine = events.filter((e) => e.via === 'gbrain');
    expect(mine.map((e) => e.tool)).toEqual(['gbrain.tools/list', 'gbrain.search', 'gbrain.remember', 'gbrain.get_page']);
    expect(mine[0]!.effect).toMatchObject({ pages: [], count: 33 });
    expect((mine[1]!.effect as { pages: string[] }).pages.every((s) => s.startsWith('dev/'))).toBe(true);
    expect(mine[2]).toMatchObject({ kind: 'write', outcome: 'ok', args: { fact: 'Dana asked about ticket 4092' } });
    expect(mine[3]!.effect).toMatchObject({ pages: ['dev/chats/north-team-random'], count: 1 });
    for (const e of mine) expect(e.actor).toBe('assistant');
    const windows = readFileSync(rec.paths.turns!, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TurnWindow);
    expect(mine.filter((e) => windows.some((w) => e.seq > w.started_seq && e.seq <= w.ended_seq))).toHaveLength(4);
    expect(existsSync(join(rec.paths.gbrain!, 'token'))).toBe(true);
    expect(existsSync(join(rec.paths.gbrain!, 'sidecar.log'))).toBe(true);
    const token = readFileSync(join(rec.paths.gbrain!, 'token'), 'utf8');
    for (const f of ['trial.json', 'events.jsonl', 'turns.jsonl']) expect(readFileSync(join(rec.paths.dir!, f), 'utf8')).not.toContain(token);
    expect(readFileSync(join(rec.paths.logs!, 'docker.log'), 'utf8')).not.toContain(token);
    expect(spawnSync('docker', ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout).not.toContain('he-gbrain-gb-e2e');
  }, 180_000);
});
