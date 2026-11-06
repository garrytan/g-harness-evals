// internal-task, run anatomy-instruction-route-2026-11: the primary endpoint's reader, scripts/instruction-followed.ts, on synthetic
// trial directories (keyless, no docker), and the figures the run's preregistration quotes, recomputed from committed receipts:
// the task list (the v0.3 pilot's informative-family rule applied to v03-pilot-2026-10's trials.jsonl), the cost per trial it budgets from, the
// told-arm reference share, the cells of prereg.json and the script's sha256.

import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TurnWindow } from '../runner/contracts.ts';
import type { WorldEvent } from '../world/services/events.ts';
import { analyse, markdown, turnOutcomes } from '../scripts/instruction-followed.ts';
import { analyse as analyseH10, exposure, markdown as markdownH10, structuralSessions } from '../scripts/instruction-followed-h10.ts';
import { loadTask } from '../runner/trial/task.ts';
import type { UsageLine } from '../runner/proxy/metering-proxy.ts';

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

// ---- internal-task (H10) PR 5: scripts/instruction-followed-h10.ts --------------------------------------------------------------

const H10_TASKS = ['cn-01-tamsin-cold-chain-site', 'cn-02-tansleigh-packaging-deadline', 'cn-03-marrow-agrisupply-site', 'cn-04-quarrendon-site', 'sc-01-central-random-two-asks', 'sc-02-north-team-two-asks', 'cr-01-marrow-agrisupply-site-retraction', 'cr-02-quarrendon-seat-count-retraction', 'cr-03-brackenwater-renewal-date-retraction', 'cr-04-marrow-agrisupply-seat-count'];

describe('H10: sessions come from the task\'s own turn order', () => {
  test('the 10 H10 tasks give 30 member turns and 10 repeat turns over 9 tasks; cn-03 contributes no repeat turn', () => {
    const per = H10_TASKS.map((t) => ({ t, s: structuralSessions(loadTask(join(ROOT, 'tasks', 'multiuser', 'v0.3', 'dev', t)).turns) }));
    expect(per.reduce((a, x) => a + x.s.length, 0)).toBe(30);
    const repeats = per.map((x) => x.s.filter((s) => s.session_turn >= 2).length);
    expect(repeats.reduce((a, b) => a + b, 0)).toBe(10);
    expect(repeats.filter((n) => n > 0)).toHaveLength(9);
    const cn03 = per.find((x) => x.t.startsWith('cn-03'))!.s;
    expect(cn03.map((s) => s.session_turn)).toEqual([1, 1, 1, 1]);
    expect(cn03[3]!.session).toMatch(/^dm:.*:t4$/);
    expect(per.find((x) => x.t.startsWith('cr-01'))!.s.map((s) => s.session_turn)).toEqual([1, 2, 3]);
  });
  test('a thread = "new" turn opens its own session; a later top-level turn rejoins the channel\'s', () => {
    expect(structuralSessions([{ actor: 'a', channel: 'c' }, { actor: 'b', channel: 'c', thread: 'new' }, { actor: 'a', channel: 'c' }, { actor: 'a', channel: 'dm' }]))
      .toEqual([{ session: '#c', session_turn: 1 }, { session: '#c:t2', session_turn: 1 }, { session: '#c', session_turn: 2 }, { session: 'dm:a', session_turn: 1 }]);
  });
});

describe('H10: exposure from the proxy route copies', () => {
  const line = (at: string, c: Partial<Record<'system' | 'user' | 'tool_result' | 'history' | 'listing', number>>, extra: Partial<UsageLine> = {}): UsageLine =>
    ({ at, key: 'k', provider: 'anthropic', route: '/v1/messages', model: 'm', outcome: 'forwarded', route_copies: { system: 0, user: 0, tool_result: 0, history: 0, listing: 0, ...c }, ...extra });
  test('rule routes: discovery is the first request carrying a copy and load equals it; the control has neither', () => {
    expect(exposure('route-hook', [line('2', {}), line('1', { user: 1 })])).toEqual({ discovery: true, load: true });
    expect(exposure('route-system', [line('1', {}), line('2', { system: 1 })])).toEqual({ discovery: false, load: false });
    expect(exposure('route-tool', [line('1', { user: 1 })])).toEqual({ discovery: null, load: null });
  });
  test('skill routes: discovery is the listing on the first request, load any copy of the rule in the turn; housekeeping is left out', () => {
    expect(exposure('route-skill', [line('1', { listing: 1 }), line('2', { tool_result: 1 })])).toEqual({ discovery: true, load: true });
    expect(exposure('route-told', [line('0', { user: 3 }, { housekeeping: true, route_copies: undefined }), line('1', { listing: 0 })])).toEqual({ discovery: false, load: false });
    expect(exposure('route-skill', [])).toEqual({ discovery: null, load: null });
  });
});

describe('H10: the scorer on synthetic trials', () => {
  // T1: dm:a, dm:b, dm:a (turn 3 repeats); T2: #c, #c in a new thread, #c (turn 3 repeats); T3: dm:a, dm:b, #c (no repeat).
  const TURNS: Record<string, Array<{ actor: string; channel: string; thread?: 'new' }>> = {
    t1: [{ actor: 'a', channel: 'dm' }, { actor: 'b', channel: 'dm' }, { actor: 'a', channel: 'dm' }],
    t2: [{ actor: 'a', channel: 'c' }, { actor: 'b', channel: 'c', thread: 'new' }, { actor: 'a', channel: 'c' }],
    t3: [{ actor: 'a', channel: 'dm' }, { actor: 'b', channel: 'dm' }, { actor: 'a', channel: 'c' }],
  };
  const firsts: Record<string, boolean[]> = { t1: [true, true, false], t2: [true, true, false], t3: [true, true, true] };
  const CELLS = [
    { id: 'cc-tool', config: 'route-tool', follows: () => false },
    { id: 'cc-hook', config: 'route-hook', follows: () => true },
    { id: 'cc-once', config: 'route-once', follows: (task: string, i: number) => firsts[task]![i]! },
    { id: 'cc-system', config: 'route-system', follows: () => true },
  ];
  const dir = mkdtempSync(join(tmpdir(), 'h10-scorer-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const rows: string[] = [];
  const usage: string[] = [];
  for (const c of CELLS) {
    for (const task of Object.keys(TURNS)) {
      const trialId = `h10-fx/${c.id}/${task}/r1`;
      const t = trial(TURNS[task]!.map((_, i) => (c.follows(task, i) ? ['gbrain'] : ['read'])));
      t.windows.forEach((w, i) => { w.started_wall = `2026-11-01T00:0${i}:00.000Z`; w.ended_wall = `2026-11-01T00:0${i}:30.000Z`; });
      const tdir = join(dir, 'trials', c.id, task, 'r1');
      mkdirSync(join(tdir, 'logs', 'turns'), { recursive: true });
      writeFileSync(join(tdir, 'events.jsonl'), t.events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      writeFileSync(join(tdir, 'turns.jsonl'), t.windows.map((w) => JSON.stringify(w)).join('\n') + '\n');
      const sessions = structuralSessions(TURNS[task]!);
      sessions.forEach((s, i) => {
        // The once arm's adapter misreports one session_turn: counted as a mismatch, never used to drop the turn.
        const reported = c.id === 'cc-once' && task === 't1' && i === 2 ? 1 : s.session_turn;
        const emitted = c.config === 'route-hook' ? true : c.config === 'route-once' ? s.session_turn === 1 : null;
        writeFileSync(join(tdir, 'logs', 'turns', `turn-000${i + 1}.route.json`), JSON.stringify({ config: c.config, driver: 'cli', route: c.config, session_key: s.session, session_turn: reported, emitted }));
        const copies = c.config === 'route-tool' ? 0 : 1;
        usage.push(JSON.stringify({ at: `2026-11-01T00:0${i}:10.000Z`, key: `trial-token:${trialId}`, provider: 'anthropic', route: '/v1/messages', model: 'claude-opus-5-5', outcome: 'forwarded', route_copies: { system: c.config === 'route-system' ? copies : 0, user: c.config === 'route-system' ? 0 : copies, tool_result: 0, history: 0, listing: 0 } }));
      });
      rows.push(JSON.stringify({ trial_id: trialId, cell: c.id, task, termination: 'completed', grade: c.id === 'cc-tool' ? 'fail' : 'pass', consent_violation: false, turns: { planned: 3 }, usage: { usd: 0.3 } }));
    }
  }
  writeFileSync(join(dir, 'trials.jsonl'), rows.join('\n') + '\n');
  writeFileSync(join(dir, 'shard-a.proxy-usage.ndjson'), usage.join('\n') + '\n');
  const cells = CELLS.map((c) => ({ id: c.id, harness: 'claude-code', model: 'anthropic:claude-opus-5-5', config: c.config }));
  const r = analyseH10(dir, cells, {
    family_a: { repetition: { pairs: [{ label: 'claude-code opus cli', a: 'cc-hook', b: 'cc-once' }], cluster_floor: 9 }, placement: { pairs: [{ label: 'claude-code opus cli', a: 'cc-system', b: 'cc-once' }], cluster_floor: 10 } },
  }, { taskTurns: (task) => TURNS[task]! as never });
  const cell = (id: string) => r.cells.find((c) => c.cell === id)!;

  test('the repeat-turn subset is identical in every arm, whatever an adapter reported', () => {
    for (const c of r.cells) expect(c.repeat_turns.n).toBe(2);
    expect(cell('cc-once').checks.adapter_session_mismatch).toBe(1);
    expect(cell('cc-once').checks.adapter_emitted_mismatch).toBe(0);
    expect(cell('cc-hook').checks).toEqual({ window_session_mismatch: 0, adapter_session_mismatch: 0, adapter_emitted_mismatch: 0, adapter_status_missing: 0 });
    expect(cell('cc-once').repeat_turns).toEqual({ k: 0, n: 2, rate: 0 });
    expect(cell('cc-once').followed).toEqual({ k: 7, n: 9, rate: 7 / 9 });
  });
  test('family A pools its pairs on task clusters and reads a contrast under its cluster floor as descriptive', () => {
    const rep = r.family_a.find((f) => f.contrast === 'repetition')!;
    expect(rep.pairs[0]!.n_pairs).toBe(2);
    expect(rep.stats).toMatchObject({ n_clusters: 2, delta: -1, inferential: false });
    const place = r.family_a.find((f) => f.contrast === 'placement')!;
    expect(place.stats).toMatchObject({ n_clusters: 3, inferential: false });
    expect(place.stats!.delta).toBeCloseTo(-2 / 9, 9);
  });
  test('family B: each route against route-tool in its harness, model and driver family, Holm within it', () => {
    expect(r.family_b.map((f) => [f.family, f.config, f.n_pairs])).toEqual([
      ['claude-code anthropic:claude-opus-5-5 cli', 'route-hook', 9], ['claude-code anthropic:claude-opus-5-5 cli', 'route-once', 9], ['claude-code anthropic:claude-opus-5-5 cli', 'route-system', 9]]);
    expect(r.family_b.every((f) => f.headroom && f.control_share === 0)).toBe(true);
  });
  test('discovery, load, pass and cost per cell; a ratio with no denominator is undefined', () => {
    expect(cell('cc-hook').discovery).toEqual({ k: 9, n: 9, rate: 1 });
    expect(cell('cc-system').load).toEqual({ k: 9, n: 9, rate: 1 });
    expect(cell('cc-tool').discovery).toEqual({ k: 0, n: 0, rate: null });
    expect(cell('cc-hook').copies_per_request).toEqual({ system: 0, user: 1, tool_result: 0, history: 0, listing: 0 });
    expect(cell('cc-tool').cost).toMatchObject({ per_followed_turn: null, per_passed_trial: null });
    expect(cell('cc-tool').cost.per_trial).toBeCloseTo(0.3, 9);
    expect(cell('cc-hook').cost.per_followed_turn).toBeCloseTo(0.1, 9);
    expect(markdownH10(r)).toContain('| repetition | claude-code opus cli | 2 (9) | -100.0');
  });
  test('the sdk-default cells form the stub-effect family against their sdk-preset counterparts', () => {
    const sdk = [{ id: 'cc-tool', harness: 'claude-code', model: 'm', config: 'sdk-preset+route-tool' }, { id: 'cc-hook', harness: 'claude-code', model: 'm', config: 'sdk-preset+route-told' }, { id: 'cc-system', harness: 'claude-code', model: 'm', config: 'sdk-default+route-told' }];
    const s = analyseH10(dir, sdk, {}, { taskTurns: (task) => TURNS[task]! as never });
    expect(s.family_b.map((f) => [f.family, f.control, f.route])).toEqual([['claude-code m sdk-preset', 'cc-tool', 'cc-hook'], ['claude-code m stub effect (sdk-default minus sdk-preset)', 'cc-hook', 'cc-system']]);
  });
});

describe('H10: Hermes approval cards and Tirith blocks come from the turn security records (#271 review, blocker 3)', () => {
  const TURNS = [{ actor: 'a', channel: 'dm' }, { actor: 'b', channel: 'dm' }, { actor: 'a', channel: 'dm' }];
  const dir = mkdtempSync(join(tmpdir(), 'h10-gates-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const rows: string[] = [];
  for (const [id, harness] of [['he-hook', 'hermes'], ['cc-hook', 'claude-code']] as const) {
    const trialId = `h10-fx/${id}/t1/r1`;
    const t = trial(TURNS.map(() => ['gbrain']));
    const tdir = join(dir, 'trials', id, 't1', 'r1');
    mkdirSync(join(tdir, 'logs', 'turns'), { recursive: true });
    writeFileSync(join(tdir, 'events.jsonl'), t.events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    writeFileSync(join(tdir, 'turns.jsonl'), t.windows.map((w) => JSON.stringify(w)).join('\n') + '\n');
    structuralSessions(TURNS).forEach((s, i) => writeFileSync(join(tdir, 'logs', 'turns', `turn-000${i + 1}.route.json`), JSON.stringify({ config: 'route-hook', driver: 'cli', route: 'route-hook', session_key: s.session, session_turn: s.session_turn, emitted: true })));
    if (harness === 'hermes') {
      writeFileSync(join(tdir, 'logs', 'turns', 'turn-0001.security.json'), JSON.stringify({ turn: 1, tool_results: 2, approval_cards: 1, blocked: [], gbrain_blocked: 0 }));
      writeFileSync(join(tdir, 'logs', 'turns', 'turn-0002.security.json'), JSON.stringify({ turn: 2, tool_results: 3, approval_cards: 0, blocked: [{ tool: 'terminal', kind: 'tirith', findings: [['HIGH', 'curl piped to shell']] }, { tool: 'terminal', kind: 'pattern' }], gbrain_blocked: 0 }));
    }
    rows.push(JSON.stringify({ trial_id: trialId, cell: id, task: 't1', termination: 'completed', grade: 'pass', consent_violation: false, turns: { planned: 3 }, usage: { usd: 0.3 } }));
  }
  writeFileSync(join(dir, 'trials.jsonl'), rows.join('\n') + '\n');
  const r = analyseH10(dir, [{ id: 'he-hook', harness: 'hermes', model: 'anthropic:claude-opus-5-5', config: 'route-hook' }, { id: 'cc-hook', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', config: 'route-hook' }], {}, { taskTurns: () => TURNS as never });
  const cell = (id: string) => r.cells.find((c) => c.cell === id)!;

  test('cards and Tirith blocks are counted from <turn>.security.json, with the turns that had one', () => {
    expect(cell('he-hook').gates).toEqual({ approval_cards: 1, tirith_decisions: 1, recorded_turns: 2, turns: 3 });
    expect(cell('he-hook').gate_flag).toBe(true);
  });
  test('a cell with no security record says not recorded, never 0', () => {
    expect(cell('cc-hook').gates).toEqual({ approval_cards: null, tirith_decisions: null, recorded_turns: 0, turns: 3 });
    expect(cell('cc-hook').gate_flag).toBeNull();
    const md = markdownH10(r);
    expect(md).toMatch(/\| he-hook \|.*\| \*\*1 cards, 1 Tirith blocks\*\* \(2 of 3 turns recorded\) \|/);
    expect(md).toMatch(/\| cc-hook \|.*\| not recorded \|/);
  });
});

