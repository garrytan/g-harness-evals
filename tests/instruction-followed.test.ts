// internal-task, run anatomy-instruction-route-2026-11: the primary endpoint's reader, scripts/instruction-followed.ts, on synthetic
// trial directories (keyless, no docker), and the figures the run's preregistration quotes, recomputed from committed receipts:
// the task list (the v0.3 pilot's informative-family rule applied to v03-pilot-2026-10's trials.jsonl), the cost per trial it budgets from, the
// told-arm reference share, the cells of prereg.json and the script's sha256.

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TurnWindow } from '../runner/contracts.ts';
import type { WorldEvent } from '../world/services/events.ts';
import { analyse, markdown, turnOutcomes } from '../scripts/instruction-followed.ts';

const ROOT = join(import.meta.dir, '..');
const RUN_DIR = join(ROOT, 'docs', 'benchmarks', '2026-10-31-anatomy-instruction-route');
const PILOT = join(ROOT, 'docs', 'benchmarks', '2026-10-29-v03-pilot');
const SCRIPT = join(ROOT, 'scripts', 'instruction-followed.ts');

type Step = 'gbrain' | 'get_page' | 'tools/list' | 'post' | 'denied-post' | 'read' | 'between';

/** One trial's events and turn windows: per turn the member's post (by the runner), the bot's steps inside the window, then
 *  the runner's post of the reply unless the turn is listed in noReply. 'between' puts a gbrain call after the window. */
function trial(turns: Step[][], noReply: number[] = []): { events: WorldEvent[]; windows: TurnWindow[] } {
  const events: WorldEvent[] = [];
  const windows: TurnWindow[] = [];
  const push = (via: WorldEvent['via'], tool: string, outcome: WorldEvent['outcome'] = 'ok', effect?: Record<string, unknown>) =>
    events.push({ seq: events.length + 1, trial_id: 't', wall_ts: '', sim_ts: '', actor: 'bot', via, tool, kind: 'read', args_digest: '', args: {}, outcome, ...(effect ? { effect } : {}) });
  turns.forEach((steps, i) => {
    push('slack', 'chat.postMessage', 'ok', { ts: 'm' + i });
    const started_seq = events.length;
    const after: Step[] = [];
    for (const s of steps) {
      if (s === 'gbrain') push('gbrain', 'gbrain.search');
      else if (s === 'get_page') push('gbrain', 'gbrain.get_page');
      else if (s === 'tools/list') push('gbrain', 'gbrain.tools/list');
      else if (s === 'post') push('mcp', 'chat.postMessage', 'ok', { ts: 'p' + events.length });
      else if (s === 'denied-post') push('mcp', 'chat.postMessage', 'denied');
      else if (s === 'read') push('mcp', 'conversations.history');
      else after.push(s);
    }
    const ended_seq = events.length;
    const reply = noReply.includes(i) ? null : 'r' + i;
    if (reply) push('slack', 'chat.postMessage', 'ok', { ts: reply });
    for (const _ of after) push('gbrain', 'gbrain.search');
    windows.push({ turn: i + 1, actor: 'alice', slack_user_id: 'U1', channel: 'D1', channel_name: 'dm:alice', channel_type: 'dm', text: '', request_ts: 'm' + i, started_wall: '', ended_wall: '', started_seq, ended_seq, exit: reply ? 0 : 2, reply_ts: reply, reply_text: reply });
  });
  return { events, windows };
}
const outcomes = (turns: Step[][], noReply: number[] = []) => { const t = trial(turns, noReply); return turnOutcomes(t.events, t.windows); };

describe('turnOutcomes: a gbrain call before the first reply of the member turn', () => {
  test('a call before the bot posts through world-MCP is followed; a call after it is not', () => {
    expect(outcomes([['gbrain', 'post']])[0]).toMatchObject({ followed: true, reply: 'world_post', gbrain_calls_before_reply: 1 });
    expect(outcomes([['post', 'gbrain']])[0]).toMatchObject({ followed: false, reply: 'world_post', gbrain_calls_before_reply: 0 });
  });
  test('with no world-MCP post the first reply is the runner posting reply_text, after the window', () => {
    const [o] = outcomes([['read', 'gbrain']]);
    expect(o).toMatchObject({ followed: true, reply: 'runner_reply' });
    expect(o!.first_reply_seq).toBe(4);
  });
  test('initialize and tools/list are not calls; get_page is a call, but not search or query', () => {
    expect(outcomes([['tools/list', 'read']])[0]!.followed).toBe(false);
    expect(outcomes([['get_page']])[0]).toMatchObject({ followed: true, followed_search_query: false });
    expect(outcomes([['gbrain']])[0]).toMatchObject({ followed: true, followed_search_query: true });
  });
  test('a post the world refused is not a reply', () => {
    expect(outcomes([['denied-post', 'gbrain', 'post']])[0]).toMatchObject({ followed: true, reply: 'world_post' });
  });
  test('a turn with no reply is followed when a call sits in its window', () => {
    expect(outcomes([['gbrain']], [0])[0]).toMatchObject({ followed: true, reply: 'none', first_reply_seq: null });
    expect(outcomes([['read']], [0])[0]).toMatchObject({ followed: false, reply: 'none' });
  });
  test('each turn reads only its own window: a call in turn 1, or between turns, does not count for turn 2', () => {
    expect(outcomes([['gbrain'], ['read']]).map((o) => o.followed)).toEqual([true, false]);
    expect(outcomes([['read', 'between'], ['read']]).map((o) => o.followed)).toEqual([false, false]);
  });
  test('a reply_ts with no matching post in events.jsonl is refused', () => {
    const t = trial([['gbrain']]);
    t.windows[0]!.reply_ts = 'missing';
    expect(() => turnOutcomes(t.events, t.windows)).toThrow(/reply_ts missing/);
  });
});

describe('analyse: per-cell shares and each route against route-tool, on a synthetic results directory', () => {
  test('shares, exclusions, turns not run, pairing and Holm within the harness', () => {
    const dir = mkdtempSync(join(tmpdir(), 'instruction-followed-'));
    try {
      const run = 'synthetic-run';
      const cells = [
        { id: 'he-tool', harness: 'hermes', config: 'route-tool' },
        { id: 'he-hook', harness: 'hermes', config: 'route-hook' },
        { id: 'he-system', harness: 'hermes', config: 'route-system' },
      ];
      const rows: string[] = [];
      for (const cell of cells) for (let k = 0; k < 10; k++) for (const r of [1, 2]) {
        const task = 't' + k;
        const id = run + '/' + cell.id + '/' + task + '/r' + r;
        const follows = cell.config === 'route-hook' || (cell.config === 'route-system' && k < 5);
        const step: Step[] = follows ? ['gbrain', 'post'] : ['read', 'post'];
        let termination = 'completed';
        let turns: Step[][] = [step, step];
        if (cell.config === 'route-hook' && k === 0 && r === 2) termination = 'infra_error';
        if (cell.config === 'route-system' && k === 9 && r === 1) { termination = 'harness_error'; turns = [step]; }
        const t = trial(turns);
        const d = join(dir, 'trials', cell.id, task, 'r' + r);
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, 'events.jsonl'), t.events.map((e) => JSON.stringify(e)).join('\n') + '\n');
        writeFileSync(join(d, 'turns.jsonl'), t.windows.map((w) => JSON.stringify(w)).join('\n') + '\n');
        rows.push(JSON.stringify({ trial_id: id, cell: cell.id, task, termination, turns: { planned: 2 } }));
      }
      writeFileSync(join(dir, 'trials.jsonl'), rows.join('\n') + '\n');
      const r = analyse(dir, cells);
      const [tool, hook, system] = r.cells;
      expect(tool!.followed).toMatchObject({ k: 0, n: 40, rate: 0, ci95: [0, 0], tasks: 10 });
      expect(hook!.excluded).toEqual({ infra_error: 1 });
      expect(hook!.followed).toMatchObject({ k: 38, n: 38, rate: 1, tasks: 10 });
      expect(system!.turns_not_run).toBe(1);
      expect(system!.followed).toMatchObject({ k: 20, n: 39 });
      expect(system!.by_turn).toEqual({ 1: { turns: 20, followed: 10 }, 2: { turns: 19, followed: 10 } });
      const [h, s] = r.comparisons;
      expect(h).toMatchObject({ route: 'he-hook', n_pairs: 38, unpaired: { control: 2, route: 0 } });
      expect(h!.stats).toMatchObject({ n_clusters: 10, delta: 1, ci95: [1, 1], p_method: 'exact-sign-flip', inferential: true });
      expect(h!.stats!.p_two_sided).toBeCloseTo(2 / 1024, 12);
      expect(s).toMatchObject({ route: 'he-system', n_pairs: 39, unpaired: { control: 1, route: 0 } });
      expect(s!.stats!.p_two_sided).toBeCloseTo(64 / 1024, 12);
      expect(h!.stats!.p_holm).toBeCloseTo(4 / 1024, 12);
      expect(s!.stats!.p_holm).toBeCloseTo(64 / 1024, 12);
      const prereg = join(dir, 'prereg.json');
      writeFileSync(prereg, JSON.stringify({ cells }));
      const out = join(dir, 'out');
      const p = Bun.spawnSync(['bun', SCRIPT, '--results', dir, '--prereg', prereg, '--out', out], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
      expect(p.exitCode).toBe(0);
      const md = readFileSync(join(out, 'instruction-followed.md'), 'utf8');
      expect(md).toContain('| he-hook | route-hook | 20 (1) | 38 (0) | 38 | 100.0% [100.0%, 100.0%] | 10 |');
      expect(md).toContain('| hermes | route-hook | 38 (10) | 0.0% | 100.0% | +100.0 [+100.0, +100.0] | 0.0020 (exact-sign-flip) | 0.0039 |');
      expect(JSON.parse(readFileSync(join(out, 'instruction-followed.json'), 'utf8')).comparisons).toHaveLength(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('analyse: trials that never became ready, cap stops, and a family with an empty comparison', () => {
  test('a harness_error trial with no turns.jsonl counts its planned turns as not run; cap stops are counted; Holm keeps the family size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'instruction-followed-'));
    try {
      const cells = [
        { id: 'oc-tool', harness: 'openclaw', config: 'route-tool' },
        { id: 'oc-hook', harness: 'openclaw', config: 'route-hook' },
        { id: 'oc-skill', harness: 'openclaw', config: 'route-skill' },
      ];
      const rows: string[] = [];
      for (const cell of cells) for (let k = 0; k < 10; k++) {
        const task = 't' + k;
        const d = join(dir, 'trials', cell.id, task, 'r1');
        mkdirSync(d, { recursive: true });
        let termination = 'completed';
        let cap_stop = false;
        if (cell.config === 'route-skill') { termination = 'model_error'; cap_stop = true; }
        if (cell.config === 'route-hook' && k === 0) termination = 'harness_error';
        else {
          const t = trial([[cell.config === 'route-hook' ? 'gbrain' : 'read', 'post']]);
          writeFileSync(join(d, 'events.jsonl'), t.events.map((e) => JSON.stringify(e)).join('\n') + '\n');
          writeFileSync(join(d, 'turns.jsonl'), t.windows.map((w) => JSON.stringify(w)).join('\n') + '\n');
        }
        rows.push(JSON.stringify({ trial_id: 'synthetic/' + cell.id + '/' + task + '/r1', cell: cell.id, task, termination, cap_stop, turns: { planned: 1 } }));
      }
      writeFileSync(join(dir, 'trials.jsonl'), rows.join('\n') + '\n');
      const r = analyse(dir, cells);
      const [, hook, skill] = r.cells;
      expect(hook).toMatchObject({ no_turns_log: 1, turns_planned: 10, turns_not_run: 1, excluded: {} });
      expect(hook!.followed).toMatchObject({ k: 9, n: 9 });
      expect(skill).toMatchObject({ cap_stop: 10, excluded: { model_error: 10 }, turns_planned: 0 });
      const [h, s] = r.comparisons;
      expect(s).toMatchObject({ route: 'oc-skill', n_pairs: 0, stats: null });
      expect(h!.stats!.p_two_sided).toBeCloseTo(2 / 512, 12);
      expect(h!.stats!.p_holm).toBeCloseTo(4 / 512, 12);
      const md = markdown(r);
      expect(md).toContain('- oc-hook: 0 cap-stop trials');
      expect(md).toContain('1 `harness_error` trials with no `turns.jsonl`');
      rmSync(join(dir, 'trials', 'oc-tool', 't3', 'r1', 'turns.jsonl'));
      expect(() => analyse(dir, cells)).toThrow(/turns.jsonl \(termination completed\)/);
      expect(md).toContain('- oc-skill: 10 cap-stop trials');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('anatomy-instruction-route-2026-11: the preregistration matches its receipts', () => {
  const prereg = JSON.parse(readFileSync(join(RUN_DIR, 'prereg.json'), 'utf8')) as { run_id: string; spend_cap_usd: number; cells: Array<{ id: string; harness: string; model: string; split: string; task_set: string; config: string; gbrain: unknown; tasks: string[]; repetitions: number; preamble?: string }> };
  const text = readFileSync(join(RUN_DIR, 'PREREGISTRATION.md'), 'utf8');
  const pilot = readFileSync(join(PILOT, 'results', 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { cell: string; task: string; grade: string; consent_violation: boolean; termination: string; usage: { usd: number } | null });
  const TOLD = ['openclaw-haiku-gbrain-told-mu-v03-dev', 'hermes-haiku-gbrain-told-mu-v03-dev'];

  test('nine cells: the routes each harness supports, one instruction text, the same tasks and repetitions', () => {
    expect(prereg.run_id).toBe('anatomy-instruction-route-2026-11');
    expect(prereg.spend_cap_usd).toBe(20);
    expect(prereg.cells.map((c) => c.harness + ':' + c.config)).toEqual([
      'openclaw:route-tool', 'openclaw:route-startup', 'openclaw:route-hook', 'openclaw:route-skill',
      'hermes:route-tool', 'hermes:route-system', 'hermes:route-startup', 'hermes:route-hook', 'hermes:route-skill']);
    for (const c of prereg.cells) {
      expect(c.id).toBe(c.harness + '-haiku-gbrain-' + c.config + '-mu-v03-dev');
      expect([c.model, c.split, c.task_set, c.repetitions, c.preamble]).toEqual(['anthropic:claude-haiku-5-5', 'dev', 'v0.3', 5, undefined]);
      expect(c.gbrain).toEqual({ surface: 'starter' });
      expect(c.tasks).toEqual(prereg.cells[0]!.tasks);
    }
    expect(prereg.cells.reduce((s, c) => s + c.tasks.length * c.repetitions, 0)).toBe(585);
  });

  test('the tasks are every dev task of the families the pilot rule finds informative in its told arm', () => {
    const family = (task: string) => /^family = "([^"]+)"/m.exec(readFileSync(join(ROOT, 'tasks/multiuser/v0.3/dev', task, 'task.toml'), 'utf8'))![1]!;
    const told = pilot.filter((t) => TOLD.includes(t.cell) && !['model_error', 'infra_error', 'exam_fault'].includes(t.termination));
    const rate = (ts: typeof told) => ts.filter((t) => t.grade === 'pass' && !t.consent_violation).length / ts.length;
    const families = [...new Set(told.map((t) => family(t.task)))];
    const informative = families.filter((f) => { const r = rate(told.filter((t) => family(t.task) === f)); return r >= 0.1 && r <= 0.9; });
    expect(informative.sort()).toEqual(['continuity', 'scope_isolation', 'shared_channel', 'synthesis']);
    const tasks = [...new Set(told.map((t) => t.task))].filter((task) => informative.includes(family(task))).sort();
    expect(tasks).toHaveLength(13);
    expect([...prereg.cells[0]!.tasks].sort()).toEqual(tasks);
  });

  test('the cost per trial the budget starts from: the told cells on the run tasks', () => {
    const tasks = prereg.cells[0]!.tasks;
    const mean = (cell: string) => { const ts = pilot.filter((t) => t.cell === cell && tasks.includes(t.task)); return ts.reduce((s, t) => s + (t.usage?.usd ?? 0), 0) / ts.length; };
    expect(mean(TOLD[0]!).toFixed(5)).toBe('0.00599');
    expect(mean(TOLD[1]!).toFixed(5)).toBe('0.00804');
    expect(text).toContain('$0.00599');
    expect(text).toContain('$0.00804');
  });

  test('the told-arm reference share the preregistration quotes', () => {
    const cells = TOLD.map((id) => ({ id, harness: id.split('-')[0]! }));
    const r = analyse(join(PILOT, 'results'), cells, 'route-tool', prereg.cells[0]!.tasks);
    expect(r.cells.map((c) => c.followed.k + '/' + c.followed.n)).toEqual(['58/160', '64/160']);
    expect(text).toContain('58 of 160');
    expect(text).toContain('64 of 160');
  });

  test('the preregistration names the analysis script by its sha256', () => {
    expect(text).toContain(createHash('sha256').update(readFileSync(SCRIPT)).digest('hex'));
  });
});
