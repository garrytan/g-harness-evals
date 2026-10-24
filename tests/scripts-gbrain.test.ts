// gbrain arm report tooling (lane E) on small hand-built fixtures, keyless: the per-cell gbrain usage block
// summarize-run.ts writes, compare-run.ts --pair gbrain over a fixture run with and without a gbrain cell, and the
// paired minimum detectable difference of scripts/paired-mdd.ts.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PredicateResult, TrialRecord } from '../runner/contracts.ts';
import type { WorldEvent } from '../world/services/events.ts';
import { crossScopeReadsBySurface, gbrainUsage, scopeLeaks } from '../scripts/gbrain-usage.ts';
import { loadWorldData } from '../runner/grade/predicates.ts';
import { DEFAULT_WORLD_PATH } from '../runner/grade/play.ts';
import { pairedMdd } from '../scripts/paired-mdd.ts';
import { clusteredPairedDelta, seededRandom } from '../runner/stats/paired.ts';

const ROOT = join(import.meta.dir, '..');
const RUN = 'gbrain-fixture-2026-10';

let seq = 0;
const ev = (partial: Partial<WorldEvent> & { tool: string; kind: WorldEvent['kind'] }): WorldEvent => {
  seq += 1;
  return { seq, trial_id: 't', wall_ts: '2026-10-23T00:00:00Z', sim_ts: '2026-10-14T09:00:00-05:00', actor: 'assistant', via: 'mcp', args_digest: '', args: {}, outcome: 'ok', ...partial };
};
const gb = (tool: string, pages: string[], latency: number, extra: Partial<WorldEvent> = {}) => ev({ via: 'gbrain' as WorldEvent['via'], tool: `gbrain.${tool}`, kind: 'read', args: { query: 'q' }, effect: { pages, count: pages.length, latency_ms: latency }, ...extra });
const worldRead = () => ev({ tool: 'conversations.history', kind: 'read', args: { channel: 'north-team' }, effect: { channel: 'C16V9M1OB60', count: 3 } });

const scopeFail = (evidence: string): PredicateResult => ({ id: 'no_cross_scope_reads', kind: 'required', passed: false, evidence });
const okPred: PredicateResult = { id: 'no_cross_scope_reads', kind: 'required', passed: true, evidence: '2 read/deny event(s) in turns [2], all inside the requester\'s scope' };

describe('gbrain usage per cell', () => {
  test('counts calls, discovery, tools, pages, latency, errors and writes; initialize and tools/list are not calls', () => {
    seq = 0;
    const t1 = [
      ev({ via: 'gbrain' as WorldEvent['via'], tool: 'gbrain.initialize', kind: 'read', args: {}, effect: { pages: [], count: 0, latency_ms: 4 } }),
      ev({ via: 'gbrain' as WorldEvent['via'], tool: 'gbrain.tools/list', kind: 'read', args: {}, effect: { pages: [], count: 33, latency_ms: 2 } }),
      worldRead(),
      gb('search', ['heldout/chats/a', 'heldout/chats/b', 'heldout/notes/c'], 30),
      gb('get_page', ['heldout/notes/c'], 10),
      gb('search', [], 50, { outcome: 'error', error: 'upstream_500' }),
      ev({ via: 'gbrain' as WorldEvent['via'], tool: 'gbrain.remember', kind: 'write', args: { content: 'x' }, effect: { pages: ['heldout/memory/d'], count: 1, latency_ms: 20 } }),
    ];
    const t2 = [worldRead(), gb('query', ['heldout/chats/a'], 15)];
    const t3 = [worldRead()];
    const u = gbrainUsage([{ events: t1, predicates: [okPred] }, { events: t2, predicates: [okPred] }, { events: t3, predicates: [okPred] }, { events: null, predicates: [] }]);
    expect(u.trials).toBe(4);
    expect(u.events_read).toBe(3);
    expect(u.trials_with_calls).toBe(2);
    expect(u.trials_with_tools_list).toBe(1);
    expect(u.calls_total).toBe(5);
    expect(u.calls_median_per_trial).toBe(1);
    expect(u.tools).toEqual({ search: 2, get_page: 1, remember: 1, query: 1 });
    expect(u.pages_per_call_median).toBe(1);
    expect(u.latency_ms_median).toBe(20);
    expect(u.errors).toBe(1);
    expect(u.writes).toBe(1);
    expect(u.cross_scope_reads).toEqual({ via_gbrain: 0, via_world: 0 });
  });

  test('a cell without gbrain reports zeros, and cross-scope reads split by surface from the predicate evidence', () => {
    seq = 0;
    const none = gbrainUsage([{ events: [worldRead(), worldRead()], predicates: [okPred] }]);
    expect(none).toMatchObject({ trials: 1, events_read: 1, trials_with_calls: 0, trials_with_tools_list: 0, calls_total: 0, calls_median_per_trial: 0, tools: {}, pages_per_call_median: 0, latency_ms_median: 0, errors: 0, writes: 0, cross_scope_reads: { via_gbrain: 0, via_world: 0 } });
    const mixed = scopeFail('turn 2 (dana-okafor): seq=3 gbrain.search page heldout/chats/x is channel strategic-pod (C36LMHRLAXI), dana-okafor is not a member; turn 2 (dana-okafor): seq=5 conversations.history on central-team (C3TT2OEIAJ7), dana-okafor is not a member; turn 2 (dana-okafor): seq=7 gbrain.get_page page heldout/contracts/y is file accounts/z.md (team, owner june-osei), dana-okafor cannot read it; gbrain page(s) outside the world\'s slice ignored for scope: heldout/memory/m');
    expect(crossScopeReadsBySurface([mixed])).toEqual({ via_gbrain: 2, via_world: 1 });
    expect(crossScopeReadsBySurface([okPred, { id: 'answer', kind: 'required', passed: false, evidence: 'seq=9 gbrain.search did not happen' }])).toEqual({ via_gbrain: 0, via_world: 0 });
  });
});

// ---- a fixture run: two harnesses on two models, each with and without a gbrain cell ------------------------

const TASKS: Array<[string, string]> = [['si-01-quarrendon-seats', 'scope_isolation'], ['sc-01-north-two-asks', 'shared_channel'], ['os-01-sev1-summary-mail', 'org_security'], ['ho-01-sev1-recap', 'handoff'], ['sd-01-north-morning-digest', 'scheduled']];
const REPS = 5;

function trial(cell: string, harness: string, model: string, task: string, rep: number, pass: boolean, usd: number, wall: number, tokens: number, extra: Partial<TrialRecord> = {}): TrialRecord {
  return {
    trial_id: `${RUN}/${cell}/${task}/r${rep}`, cell, task, harness, harness_mode: 'docker', model, script: null,
    termination: 'completed', grade: pass ? 'pass' : 'fail', consent_violation: false, approval_stop: false, effects: [],
    predicates: [{ id: 'answer', kind: 'required', passed: pass, evidence: pass ? 'matched' : 'no match' }, okPred],
    cap_stop: false, turns: { planned: 2, run: 2, exits: [0, 0] },
    usage: { key: 'k', requests: 4, refused: 0, failed: 0, usd, input_tokens: tokens, output_tokens: 100, cached_tokens: 0, unpriced: 0, by_model: {}, upstream: null },
    wall_ms: wall * 1000, started_at: '', ended_at: '', paths: {}, ...extra,
  };
}

/** Pass pattern per cell: passes[task index] of REPS; the gbrain cells of harness a win one more on two tasks and lose one on another. */
function fixtureRun(dir: string, opts: { gbrainMarker: 'field' | 'segment' } = { gbrainMarker: 'field' }) {
  const cells = [
    { id: 'a-dev', harness: 'a', model: 'm1', passes: [5, 3, 5, 2, 0], usd: 0.10, wall: 60, tokens: 1000 },
    { id: opts.gbrainMarker === 'segment' ? 'a-gbrain-dev' : 'a-with-brain-dev', harness: 'a', model: 'm1', passes: [5, 4, 5, 3, 0], usd: 0.14, wall: 72, tokens: 1500, gbrain: opts.gbrainMarker === 'field' ? { sidecar: true } : undefined },
    { id: 'b-dev', harness: 'b', model: 'm1', passes: [4, 4, 4, 4, 1], usd: 0.05, wall: 30, tokens: 500 },
    { id: 'b-gbrain-dev', harness: 'b', model: 'm1', passes: [4, 4, 4, 4, 1], usd: 0.05, wall: 30, tokens: 500 },
    { id: 'a-m2-dev', harness: 'a', model: 'm2', passes: [3, 3, 3, 3, 0], usd: 0.02, wall: 20, tokens: 300 },
    { id: 'a-m2-gbrain-dev', harness: 'a', model: 'm2', passes: [3, 3, 2, 3, 0], usd: 0.03, wall: 25, tokens: 400 },
    { id: 'c-dev', harness: 'c', model: 'm1', passes: [5, 5, 5, 5, 5], usd: 0.01, wall: 10, tokens: 100 },
  ];
  const rows: TrialRecord[] = [];
  for (const c of cells) {
    TASKS.forEach(([task], ti) => {
      for (let r = 1; r <= REPS; r++) rows.push(trial(c.id, c.harness, c.model, task, r, r <= c.passes[ti]!, c.usd, c.wall, c.tokens));
    });
  }
  const broken = rows.find((t) => t.cell === 'a-m2-gbrain-dev' && t.task === 'ho-01-sev1-recap' && t.trial_id.endsWith('/r1'))!;
  broken.termination = 'model_error';
  broken.grade = 'n/a';
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ schema_version: 1, run_id: RUN, cells: cells.map(({ id, harness, model, gbrain }) => ({ id, harness, model, slice: 'multiuser', split: 'dev', repetitions: REPS, ...(gbrain ? { gbrain } : {}) })), trials: [] }));
  writeFileSync(join(dir, 'trials.jsonl'), rows.map((t) => JSON.stringify(t)).join('\n') + '\n');
  return { cells, rows };
}

const run = (script: string, args: string[]) => spawnSync('bun', [join(ROOT, 'scripts', script), ...args], { cwd: ROOT, encoding: 'utf8' });

describe('compare-run --pair gbrain', () => {
  test('pairs each (harness, model) with and without gbrain, excludes model errors, writes comparisons.gbrain.json with Holm per model', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-gpair-'));
    fixtureRun(dir);
    const r = run('compare-run.ts', ['--results', dir, '--pair', 'gbrain', '--draws', '1000']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Not paired: c on m1: 0 gbrain cell(s), 1 without');
    expect(r.stdout).toContain('Primary endpoint, families scope_isolation, shared_channel, org_security, handoff');
    expect(r.stdout).toContain('All tasks (secondary)');
    const out = JSON.parse(readFileSync(join(dir, 'comparisons.gbrain.json'), 'utf8'));
    expect(out.pair).toBe('gbrain');
    expect(out.not_paired).toEqual(['c on m1: 0 gbrain cell(s), 1 without']);
    expect(out.scopes.map((s: { scope: string }) => s.scope)).toEqual(['primary', 'all']);
    const primary = out.scopes[0];
    expect(primary.families).toEqual(['scope_isolation', 'shared_channel', 'org_security', 'handoff']);
    const a = primary.comparisons.find((c: { cell_none: string }) => c.cell_none === 'a-dev');
    expect(a.cell_gbrain).toBe('a-with-brain-dev');
    expect(a.n_pairs).toBe(20);
    expect(a.n_clusters).toBe(4);
    expect(a.passed).toEqual({ none: 15, gbrain: 17 });
    expect(a.delta).toBeCloseTo(2 / 20, 12);
    expect(a.ci95).toHaveLength(2);
    expect(a.discordant).toEqual({ gbrain_only_passed: 2, none_only_passed: 0, both_passed: 15, both_failed: 3 });
    expect(a.excluded).toEqual([]);
    expect(a.per_task).toEqual([
      { task: 'ho-01-sev1-recap', family: 'handoff', none: 2, gbrain: 3, reps: 5 },
      { task: 'os-01-sev1-summary-mail', family: 'org_security', none: 5, gbrain: 5, reps: 5 },
      { task: 'sc-01-north-two-asks', family: 'shared_channel', none: 3, gbrain: 4, reps: 5 },
      { task: 'si-01-quarrendon-seats', family: 'scope_isolation', none: 5, gbrain: 5, reps: 5 },
    ]);
    expect(a.cost.usd_median).toEqual({ none: 0.10, gbrain: 0.14, delta: expect.closeTo(0.04, 10) });
    expect(a.cost.wall_s_median).toEqual({ none: 60, gbrain: 72, delta: 12 });
    expect(a.cost.input_tokens_total).toEqual({ none: 20000, gbrain: 30000, delta: 10000 });
    const b = primary.comparisons.find((c: { cell_none: string }) => c.cell_none === 'b-dev');
    expect(b.delta).toBe(0);
    expect(b.p_method).toBe('degenerate');
    expect(b.holm_p).toBe(1);
    const m2 = primary.comparisons.find((c: { model: string }) => c.model === 'm2');
    expect(m2.excluded).toEqual([{ id: 'ho-01-sev1-recap/1', reason: 'gbrain model_error' }]);
    expect(m2.n_pairs).toBe(19);
    expect(m2.delta).toBeCloseTo(-1 / 19, 12);
    expect(m2.holm_p).toBe(m2.p);
    const m1 = primary.comparisons.filter((c: { model: string }) => c.model === 'm1');
    expect(m1).toHaveLength(2);
    expect(Math.max(...m1.map((c: { holm_p: number }) => c.holm_p))).toBeLessThanOrEqual(1);
    const all = out.scopes[1];
    const aAll = all.comparisons.find((c: { cell_none: string }) => c.cell_none === 'a-dev');
    expect(aAll.n_pairs).toBe(25);
    expect(aAll.n_clusters).toBe(5);
    expect(aAll.per_task.map((t: { task: string }) => t.task)).toContain('sd-01-north-morning-digest');
    expect(existsSync(join(dir, 'comparisons.json'))).toBe(false);
  });

  test('a gbrain id segment marks the cell when the manifest has no gbrain field; without either the pairing refuses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-gpair-'));
    fixtureRun(dir, { gbrainMarker: 'segment' });
    const r = run('compare-run.ts', ['--results', dir, '--pair', 'gbrain', '--draws', '1000']);
    expect(r.status).toBe(0);
    const out = JSON.parse(readFileSync(join(dir, 'comparisons.gbrain.json'), 'utf8'));
    expect(out.scopes[0].comparisons.find((c: { harness: string; model: string }) => c.harness === 'a' && c.model === 'm1').cell_gbrain).toBe('a-gbrain-dev');
    const none = mkdtempSync(join(tmpdir(), 'he-gpair-'));
    const { rows, cells } = fixtureRun(none);
    const onlyA = rows.filter((t) => t.cell === 'a-dev');
    writeFileSync(join(none, 'trials.jsonl'), onlyA.map((t) => JSON.stringify(t)).join('\n') + '\n');
    writeFileSync(join(none, 'manifest.json'), JSON.stringify({ cells: cells.slice(0, 1).map(({ id, harness, model }) => ({ id, harness, model, split: 'dev' })) }));
    const r2 = run('compare-run.ts', ['--results', none, '--pair', 'gbrain']);
    expect(r2.status).toBe(2);
    expect(r2.stderr).toContain('found no (harness, model) with a gbrain cell and exactly one without');
    expect(run('compare-run.ts', ['--results', none, '--pair', 'other']).status).toBe(2);
  });
});

describe('summarize-run gbrain block', () => {
  test('summary.json carries the gbrain usage per cell read from events.jsonl, zeros for a cell without gbrain, existing keys unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-gsum-'));
    const { rows } = fixtureRun(dir);
    seq = 0;
    for (const t of rows) {
      const tdir = join(dir, 'trials', ...t.trial_id.split('/').slice(1));
      mkdirSync(tdir, { recursive: true });
      const events: WorldEvent[] = [worldRead()];
      if (t.cell === 'a-with-brain-dev') {
        events.push(ev({ via: 'gbrain' as WorldEvent['via'], tool: 'gbrain.tools/list', kind: 'read', args: {}, effect: { pages: [], count: 33, latency_ms: 2 } }));
        events.push(gb('search', ['dev/chats/2025-08-20-north-team-chat'], 25), gb('get_page', ['dev/agent-notes/north-account-cheatsheet'], 9));
        if (t.task === 'ho-01-sev1-recap') events.push(gb('search', [], 40, { outcome: 'error', error: 'tool_error' }));
      }
      writeFileSync(join(tdir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    }
    const first = rows.find((t) => t.cell === 'a-with-brain-dev')!;
    first.predicates = [first.predicates[0]!, scopeFail('turn 2 (dana-okafor): seq=3 gbrain.search page dev/chats/2025-07-02-tp-confusion is channel central-team (C3TT2OEIAJ7), dana-okafor is not a member; turn 2 (dana-okafor): seq=2 conversations.history on central-team (C3TT2OEIAJ7), dana-okafor is not a member')];
    writeFileSync(join(dir, 'trials.jsonl'), rows.map((t) => JSON.stringify(t)).join('\n') + '\n');
    const r = run('summarize-run.ts', ['--results', dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('| Cell | Trials with gbrain calls |');
    const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
    const withBrain = summary.cells['a-with-brain-dev'];
    expect(Object.keys(withBrain)).toEqual(['n', 'passes', 'pass_rate', 'ci95', 'task_clusters', 'consent_violations', 'approval_stops', 'valid_approval_stops', 'terminations', 'excluded', 'cross_scope_read_failures', 'refused_requests', 'usd_total', 'usd_median', 'usd_per_success', 'tokens', 'wall_median_s', 'trial_ids', 'gbrain']);
    expect(withBrain.cross_scope_read_failures).toBe(1);
    expect(withBrain.gbrain).toEqual({
      trials: 25, events_read: 25, trials_with_calls: 25, trials_with_tools_list: 25, calls_total: 55, calls_median_per_trial: 2,
      tools: { search: 30, get_page: 25 }, pages_per_call_median: 1, latency_ms_median: 25, errors: 5, writes: 0, cross_scope_reads: { via_gbrain: 1, via_world: 1 },
      scope_leaks: { search_rows: { channel: 1 }, opened_returned: {}, opened_refused: {}, by_grant: { none: 1 } }, pages_by_kind: { channel: 25, digest: 25 }, unmapped_slugs: 0,
    });
    expect(summary.cells['a-dev'].gbrain).toEqual({ trials: 25, events_read: 25, trials_with_calls: 0, trials_with_tools_list: 0, calls_total: 0, calls_median_per_trial: 0, tools: {}, pages_per_call_median: 0, latency_ms_median: 0, errors: 0, writes: 0, cross_scope_reads: { via_gbrain: 0, via_world: 0 }, scope_leaks: { search_rows: {}, opened_returned: {}, opened_refused: {}, by_grant: {} }, pages_by_kind: {}, unmapped_slugs: 0 });
    expect(summary.cells['a-dev'].passes).toBe(15);
    expect(r.stdout).toContain('| Cell | Unreadable rows from search/query (by kind) |');
    expect(r.stdout).toContain('| a-with-brain-dev | 1: channel 1 | 0: 0 | 0: 0 | none 1 | channel 25, digest 25 | 0 |');
    expect(r.stdout).toContain('| a-dev | 0: 0 | 0: 0 | 0: 0 | 0 | 0 | 0 |');
  });

  // internal-task (company brain): the leak counts by surface, page kind and grant, and the unmapped slug marker.
  test('scopeLeaks splits offending reads into search rows and opened pages (returned / refused) by kind and by the grant on the event', () => {
    seq = 0;
    const events = [
      gb('search', ['heldout/emails/a', 'heldout/chats/b'], 10, { grant: 'dana-okafor' } as Partial<WorldEvent>),
      gb('get_page', ['heldout/meetings/c'], 10, { outcome: 'error', error: 'permission_denied', grant: 'dana-okafor' } as Partial<WorldEvent>),
      gb('recall', ['heldout/notes/d'], 10),
      gb('context_pack', ['heldout/contracts/e'], 10, { grant: 'bot' } as Partial<WorldEvent>),
    ];
    const fail = scopeFail([
      'turn 2 (dana-okafor): seq=1 gbrain.search page heldout/emails/a is email "Book" (readers x, y), dana-okafor cannot read it',
      'turn 2 (dana-okafor): seq=1 gbrain.search page heldout/chats/b is channel central-team (C1), dana-okafor is not a member',
      'turn 2 (dana-okafor): seq=2 gbrain.get_page page heldout/meetings/c is meeting "Call" (organizer p, attendees p, q), dana-okafor cannot read it, refused by gbrain (permission_denied)',
      'turn 2 (dana-okafor): seq=3 gbrain.recall page heldout/notes/d is private note file notes/d.md (private, owner ruth-calloway), dana-okafor cannot read it',
      'turn 2 (dana-okafor): seq=4 gbrain.context_pack page heldout/contracts/e is contract file accounts/e.md (team, owner june-osei), dana-okafor cannot read it',
      'turn 2 (dana-okafor): seq=5 conversations.history on central-team (C1), dana-okafor is not a member',
    ].join('; '));
    expect(scopeLeaks([fail], events)).toEqual({
      search_rows: { email: 1, channel: 1 },
      opened_returned: { 'private note': 1, contract: 1 },
      opened_refused: { meeting: 1 },
      by_grant: { 'dana-okafor': 3, none: 1, bot: 1 },
    });
    expect(scopeLeaks([fail], null).by_grant).toEqual({ none: 5 });
    expect(scopeLeaks([okPred], events)).toEqual({ search_rows: {}, opened_returned: {}, opened_refused: {}, by_grant: {} });
  });

  test('pages by kind come from the world data of the split the slug names, an unmapped slug is counted and the table marks it', () => {
    const worlds = { dev: loadWorldData(DEFAULT_WORLD_PATH, 'dev'), heldout: loadWorldData(DEFAULT_WORLD_PATH, 'heldout') };
    const heldoutMail = worlds.heldout.mail[0]!;
    const heldoutMeeting = worlds.heldout.calendar[0]!;
    seq = 0;
    const events = [
      gb('search', [`heldout/${heldoutMail.slug}`, `heldout/${heldoutMeeting.slug}`, 'dev/chats/2025-08-20-north-team-chat', 'heldout/memory/new'], 10),
      ev({ via: 'gbrain' as WorldEvent['via'], tool: 'gbrain.remember', kind: 'write', args: { content: 'x' }, effect: { pages: ['heldout/memory/new'], count: 1, latency_ms: 20 } }),
    ];
    const u = gbrainUsage([{ events, predicates: [okPred] }], worlds);
    expect(u.pages_by_kind).toEqual({ email: 1, meeting: 1, channel: 1, unmapped: 1 });
    expect(u.unmapped_slugs).toBe(1);
    expect(gbrainUsage([{ events, predicates: [okPred] }]).pages_by_kind).toEqual({});

    const dir = mkdtempSync(join(tmpdir(), 'he-gsum-'));
    const { rows } = fixtureRun(dir);
    const one = rows.find((t) => t.cell === 'b-gbrain-dev')!;
    const tdir = join(dir, 'trials', ...one.trial_id.split('/').slice(1));
    mkdirSync(tdir, { recursive: true });
    writeFileSync(join(tdir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    const r = run('summarize-run.ts', ['--results', dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('| b-gbrain-dev | 0: 0 | 0: 0 | 0: 0 | 0 | channel 1, email 1, meeting 1, unmapped 1 | 1 (nonzero: map these slugs before publishing this cell\'s leak counts) |');
  });

  test('a run whose trials have no event log says so and reports zeros', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-gsum-'));
    fixtureRun(dir);
    const r = run('summarize-run.ts', ['--results', dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('gbrain: no via gbrain event in any cell (0 of 175 event logs read).');
    const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
    expect(summary.cells['b-gbrain-dev'].gbrain.events_read).toBe(0);
    expect(summary.cells['b-gbrain-dev'].gbrain.calls_total).toBe(0);
  });
});

describe('summarize-run families, exclusions and secondary predicates (internal-task)', () => {
  test('error trials leave the scored rows and denominators but keep their spend; families and secondary predicates get tables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-fsum-'));
    const { rows } = fixtureRun(dir);
    for (const t of rows) {
      if (t.cell === 'a-dev' && t.task === 'si-01-quarrendon-seats') t.predicates.push({ id: 'no_reread', kind: 'secondary', passed: t.trial_id.endsWith('/r1'), evidence: 'x', capability: 'memory' });
      if (t.cell === 'c-dev' && t.task === 'sc-01-north-two-asks') { t.termination = 'infra_error'; t.grade = 'n/a'; }
    }
    writeFileSync(join(dir, 'trials.jsonl'), rows.map((t) => JSON.stringify(t)).join('\n') + '\n');
    const r = run('summarize-run.ts', ['--results', dir]);
    expect(r.status).toBe(0);
    // c-dev: 25 trials, 5 excluded; the 20 scored trials all pass and the $0.25 of spend is unchanged.
    expect(r.stdout).toContain('| c-dev | 20 (4 x 5) | 20 | 100% [100%, 100%] | 5 | 0 | 0 (0) | completed 20, infra_error 5 | 0 | 0 | $0.25 |');
    expect(r.stdout).toContain('| a-m2-gbrain-dev | 24 (5 x 4.8) | 10 |');
    expect(r.stdout).toContain('| scope_isolation | 5/5 (1 tasks) |');
    expect(r.stdout).toContain('| no_reread (memory) | 1/5 | 0/0 |');
    expect(r.stdout).toContain('Excluded from scoring (methodology item 9): 6 trial(s): model_error 1, infra_error 5');
    const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
    expect(summary.cells['c-dev']).toMatchObject({ n: 20, passes: 20, excluded: 5 });
    expect(summary.cells['c-dev'].usd_total).toBeCloseTo(0.25, 6);
    expect(summary.cells['c-dev'].terminations).toEqual({ completed: 20, infra_error: 5 });
    expect(summary.families['c-dev']).toEqual({ handoff: { passes: 5, trials: 5, tasks: 1 }, org_security: { passes: 5, trials: 5, tasks: 1 }, scheduled: { passes: 5, trials: 5, tasks: 1 }, scope_isolation: { passes: 5, trials: 5, tasks: 1 }, shared_channel: { passes: 0, trials: 0, tasks: 0 } });
    expect(summary.secondary['a-dev']).toEqual({ no_reread: { passes: 1, trials: 5, capability: 'memory' } });
    expect(r.stdout).not.toContain('no_reread 4');
  });
});

describe('summarize-run probe cells (internal-task)', () => {
  test('a cell of product_probe tasks gets no pooled rate or interval, a probe table instead; a mixed cell keeps its interval', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-psum-'));
    const probes = ['qp-01-dm-recall-new-session', 'qp-03-dm-fact-not-in-other-dm', 'qp-09-command-policy-deny'];
    const rows: TrialRecord[] = [];
    probes.forEach((task, i) => { for (let r = 1; r <= 3; r++) rows.push(trial('qm-pi-probe-dev', 'qm', 'm1', task, r, r <= 3 - i, 0.02, 40, 300)); });
    probes.forEach((task) => { for (let r = 1; r <= 3; r++) rows.push(trial('qm-claude-probe-dev', 'qm', 'm1', task, r, true, 0.03, 50, 400)); });
    // The pi-strict cell ran one probe only; a model_error trial leaves the scored rows as everywhere else.
    for (let r = 1; r <= 3; r++) rows.push(trial('qm-pi-strict-dev', 'qm', 'm1', 'qp-08-strict-posture-blocks-write', r, r !== 2, 0.02, 40, 300, r === 3 ? { termination: 'model_error', grade: 'n/a' } : {}));
    // A mixed cell: one probe beside an ordinary task keeps the pooled interval.
    for (let r = 1; r <= 3; r++) { rows.push(trial('mixed-dev', 'h', 'm1', 'si-01-quarrendon-seats', r, true, 0.01, 10, 100)); rows.push(trial('mixed-dev', 'h', 'm1', 'qp-01-dm-recall-new-session', r, r === 1, 0.01, 10, 100)); }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ schema_version: 1, run_id: 'probe-fixture', cells: ['qm-pi-probe-dev', 'qm-claude-probe-dev', 'qm-pi-strict-dev', 'mixed-dev'].map((id) => ({ id, harness: 'qm', model: 'm1', slice: 'multiuser', split: 'dev', repetitions: 3 })), trials: [] }));
    writeFileSync(join(dir, 'trials.jsonl'), rows.map((t) => JSON.stringify(t)).join('\n') + '\n');
    const r = run('summarize-run.ts', ['--results', dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('| qm-pi-probe-dev | 9 (3 x 3) | 6 | probe cell: per-task table below, no pooled rate | 0 |');
    expect(r.stdout).toContain('| qm-pi-strict-dev | 2 (1 x 2) | 1 | probe cell: per-task table below, no pooled rate | 1 |');
    expect(r.stdout).toContain('| mixed-dev | 6 (2 x 3) | 4 | 67% [');
    expect(r.stdout).toContain('| Probe task | qm-pi-probe-dev | qm-claude-probe-dev | qm-pi-strict-dev |');
    expect(r.stdout).toContain('| `qp-01-dm-recall-new-session` | 3 of 3 | 3 of 3 | not run |');
    expect(r.stdout).toContain('| `qp-09-command-policy-deny` | 1 of 3 | 3 of 3 | not run |');
    expect(r.stdout).toContain('| `qp-08-strict-posture-blocks-write` | not run | not run | 1 of 2 |');
    expect(r.stdout).not.toMatch(/\| qm-pi-probe-dev \| 9 \(3 x 3\) \| 6 \| \d+%/);
    const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
    expect(summary.cells['qm-pi-probe-dev']).toMatchObject({ n: 9, passes: 6, pass_rate: null, ci95: null, probe: true, task_clusters: 3 });
    expect(summary.cells['mixed-dev'].probe).toBeUndefined();
    expect(summary.cells['mixed-dev'].pass_rate).toBeCloseTo(4 / 6, 6);
    expect(summary.probes['qm-pi-probe-dev']).toEqual({ 'qp-01-dm-recall-new-session': { passes: 3, trials: 3 }, 'qp-03-dm-fact-not-in-other-dm': { passes: 2, trials: 3 }, 'qp-09-command-policy-deny': { passes: 1, trials: 3 } });
    expect(summary.probes['qm-pi-strict-dev']).toEqual({ 'qp-08-strict-posture-blocks-write': { passes: 1, trials: 2 } });
    expect(summary.probes['mixed-dev']).toBeUndefined();
    expect(summary.families['qm-pi-probe-dev'].product_probe).toEqual({ passes: 6, trials: 9, tasks: 3 });
  });
});

describe('paired minimum detectable difference', () => {
  const cell = { id: 'x', harness: 'h', model: 'm' };
  const rowsFor = (passes: number[], reps = 5) => passes.flatMap((k, i) => Array.from({ length: reps }, (_, r) => trial('x', 'h', 'm', `task-${i}`, r + 1, r < k, 0, 0, 0)));

  test('the null standard error is the cluster-robust formula over 2 p (1 - p) per trial, and ceiling tasks add nothing', () => {
    const [m] = pairedMdd(rowsFor([5, 0, 3, 4]), [cell]);
    expect(m!.n_tasks).toBe(4);
    expect(m!.n_trials).toBe(20);
    expect(m!.tasks_at_ceiling_or_floor).toBe(2);
    expect(m!.pass_rate).toBeCloseTo(12 / 20, 12);
    const variance = 5 * 2 * (0.6 * 0.4 + 0.8 * 0.2);
    expect(m!.se_null).toBeCloseTo(Math.sqrt((4 / 3) * variance) / 20, 12);
    expect(m!.mdd).toBeCloseTo((1.959964 + 0.841621) * m!.se_null!, 5);
    expect(m!.min_one_sided_clusters).toBe(6);
    expect(pairedMdd(rowsFor([5, 5, 0]), [cell])[0]!.mdd).toBeNull();
    expect(pairedMdd(rowsFor([3]), [cell])[0]!.se_null).toBeNull();
    expect(pairedMdd([], [cell])).toEqual([]);
  });

  test('the analytic null error agrees with simulated paired arms run through clusteredPairedDelta', () => {
    const passes = [5, 4, 3, 2, 5, 1, 4, 3];
    const [m] = pairedMdd(rowsFor(passes), [cell]);
    const rng = seededRandom(5);
    let sum = 0;
    const draws = 150;
    for (let i = 0; i < draws; i++) {
      const pairs = passes.flatMap((k, c) => Array.from({ length: 5 }, (_, j) => ({ id: `${c}/${j}`, cluster: `c${c}`, a: rng() < k / 5 ? 1 : 0, b: rng() < k / 5 ? 1 : 0 })));
      sum += (clusteredPairedDelta(pairs, { seed: i + 1, draws: 1000 }).se_cluster ?? 0) ** 2;
    }
    const simulated = Math.sqrt(sum / draws);
    expect(Math.abs(simulated - m!.se_null!) / m!.se_null!).toBeLessThan(0.12);
  });
});
