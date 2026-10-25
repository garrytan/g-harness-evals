// gbrain arm report tooling (lane E) on small hand-built fixtures, keyless: the per-cell gbrain usage block
// summarize-run.ts writes, compare-run.ts --pair gbrain over a fixture run with and without a gbrain cell, and the
// paired minimum detectable difference of scripts/paired-mdd.ts. internal-task adds the install ladder: rungs, neighbour pairs on
// three endpoints, the paired cost estimator, the usage split and the shards label, on the fixture run that
// tests/fixtures/gbrain-ladder/build-fixture.ts writes.

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
import { designMdd, LADDER_DESIGN, pairedMdd } from '../scripts/paired-mdd.ts';
import { clusteredPairedDelta, seededRandom } from '../runner/stats/paired.ts';
import { ENDPOINTS, endpointValue, ladderPairs, readShards, rungOf, shardsLabel } from '../scripts/gbrain-ladder.ts';
import { buildLadderFixture, LADDER_FIXTURE_MODEL, writeLadderFixture } from './fixtures/gbrain-ladder/build-fixture.ts';

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
    expect(r.stdout).toContain('| no_reread (memory) | 1/5 (1/5 passing) | 0/0 (0/0 passing) |');
    expect(r.stdout).toContain('Excluded from scoring (methodology item 9): 6 trial(s): model_error 1, infra_error 5');
    const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
    expect(summary.cells['c-dev']).toMatchObject({ n: 20, passes: 20, excluded: 5 });
    expect(summary.cells['c-dev'].usd_total).toBeCloseTo(0.25, 6);
    expect(summary.cells['c-dev'].terminations).toEqual({ completed: 20, infra_error: 5 });
    expect(summary.families['c-dev']).toEqual({ handoff: { passes: 5, trials: 5, tasks: 1 }, org_security: { passes: 5, trials: 5, tasks: 1 }, scheduled: { passes: 5, trials: 5, tasks: 1 }, scope_isolation: { passes: 5, trials: 5, tasks: 1 }, shared_channel: { passes: 0, trials: 0, tasks: 0 } });
    expect(summary.secondary['a-dev']).toEqual({ no_reread: { passes: 1, trials: 5, passing_trials: 5, passes_among_passing: 1, capability: 'memory' } });
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

  test('designReps restates the null variance and n for a design with that many repetitions at each task\'s measured rate', () => {
    const [five] = pairedMdd(rowsFor([5, 0, 3, 4]), [cell]);
    const [ten] = pairedMdd(rowsFor([5, 0, 3, 4]), [cell], { designReps: 10 });
    expect(ten!.n_trials).toBe(40);
    expect(ten!.pass_rate).toBeCloseTo(five!.pass_rate, 12);
    expect(ten!.se_null).toBeCloseTo(five!.se_null! / Math.SQRT2, 12);
    expect(ten!.mdd).toBeCloseTo(five!.mdd! / Math.SQRT2, 12);
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

// ---- the install ladder (internal-task): rungs, neighbour pairs, three endpoints, paired cost, the usage split, the shards label ----

const TOLD = 'tasks/multiuser/_shared/preamble.gbrain-ladder.md';
const EMBED = 'openai:text-embedding-3-small' as const;
const HAIKU = LADDER_FIXTURE_MODEL;

describe('install ladder: rungs and neighbour pairs', () => {
  test('a cell\'s rung comes from its resolved gbrain fields and preamble; a configuration off the table is on no rung', () => {
    expect(rungOf({ id: 'x', harness: 'h', model: 'm' }).rung).toBe('none');
    expect(rungOf({ id: 'x', harness: 'h', model: 'm', gbrain: { surface: 'starter' } }).rung).toBe('mcp');
    expect(rungOf({ id: 'x', harness: 'h', model: 'm', gbrain: { surface: 'starter' }, preamble: 'tasks/multiuser/_shared/preamble.md' }).rung).toBe('mcp');
    expect(rungOf({ id: 'x', harness: 'h', model: 'm', gbrain: { surface: 'starter' }, preamble: TOLD }).rung).toBe('told');
    expect(rungOf({ id: 'x', harness: 'h', model: 'm', gbrain: { surface: 'starter' }, preamble: 'tasks/multiuser/_shared/preamble.gbrain.md' }).rung).toBe('told');
    expect(rungOf({ id: 'x', harness: 'h', model: 'm', gbrain: { surface: 'starter', install: 'gbrain-docs', embeddings: 'off' } }).rung).toBe('docs');
    expect(rungOf({ id: 'x', harness: 'h', model: 'm', gbrain: { surface: 'verbs', install: 'mcp' }, preamble: TOLD }).rung).toBe('verbs-told');
    expect(rungOf({ id: 'x', harness: 'h', model: 'm', gbrain: { surface: 'starter', embeddings: EMBED }, preamble: TOLD }).rung).toBe('semantic-told');
    expect(rungOf({ id: 'x', harness: 'h', model: 'm', gbrain: { surface: 'starter', install: 'gbrain-docs', embeddings: EMBED } }).rung).toBe('docs-semantic');
    expect(rungOf({ id: 'x', harness: 'h', model: 'm', gbrain: { surface: 'verbs' } })).toEqual({ rung: null, label: 'verbs/mcp/off' });
    expect(rungOf({ id: 'x', harness: 'h', model: 'm', gbrain: { surface: 'starter', install: 'gbrain-docs' }, preamble: TOLD }).rung).toBeNull();
    expect(rungOf({ id: 'x', harness: 'h', model: 'm', gbrain: { surface: 'starter', brain: 'company', scope: 'member' } })).toEqual({ rung: null, label: 'starter/mcp/off, brain company, scope member' });
  });

  test('each rung pairs against its ladder neighbour within harness and model; a missing base, a doubled rung and an off-table cell are named', () => {
    const full = buildLadderFixture().manifest as { cells: Parameters<typeof ladderPairs>[0] };
    const all = ladderPairs(full.cells);
    expect(all.problems).toEqual([]);
    expect(all.unpaired).toEqual([]);
    expect(all.pairs.filter((p) => p.harness === 'oc').map((p) => `${p.rung}>${p.base_rung}`)).toEqual(['mcp>none', 'told>mcp', 'docs>mcp', 'verbs-told>told', 'semantic-told>told', 'docs-semantic>docs']);
    expect(all.pairs.find((p) => p.harness === 'hm' && p.rung === 'docs-semantic')).toMatchObject({ cell: 'hm-gbrain-docs-semantic', base_cell: 'hm-gbrain-docs', model: HAIKU });
    const noMcp = ladderPairs(full.cells.filter((c) => c.id !== 'hm-gbrain-mcp'));
    // told and docs have no mcp below them but are bases of present rungs, so they are unpaired, not problems (a follow-up
    // run may carry told only as the base of verbs-told); a base-less rung that is nobody's base is still a problem.
    expect(noMcp.problems).toEqual([]);
    expect(noMcp.unpaired).toEqual([`hm on ${HAIKU}: none cell hm-none has no mcp cell above it`, `hm on ${HAIKU}: rung told (hm-gbrain-told) has no mcp cell below it and serves as a base only`, `hm on ${HAIKU}: rung docs (hm-gbrain-docs) has no mcp cell below it and serves as a base only`]);
    expect(noMcp.pairs.filter((p) => p.harness === 'hm').map((p) => p.rung)).toEqual(['verbs-told', 'semantic-told', 'docs-semantic']);
    const verbsOnly = ladderPairs(full.cells.filter((c) => c.id === 'hm-gbrain-told' || c.id === 'hm-gbrain-verbs-told'));
    expect(verbsOnly).toMatchObject({ problems: [], unpaired: [`hm on ${HAIKU}: rung told (hm-gbrain-told) has no mcp cell below it and serves as a base only`] });
    expect(verbsOnly.pairs.map((p) => `${p.rung}>${p.base_rung}`)).toEqual(['verbs-told>told']);
    const toldAlone = ladderPairs(full.cells.filter((c) => c.id === 'hm-gbrain-told'));
    expect(toldAlone.problems).toEqual([`hm on ${HAIKU}: rung told (hm-gbrain-told) has no mcp cell to pair against`]);
    const doubled = ladderPairs([...full.cells, { ...full.cells.find((c) => c.id === 'oc-gbrain-told')!, id: 'oc-gbrain-told-2' }]);
    expect(doubled.problems).toEqual([`oc on ${HAIKU}: 2 cells on rung told (oc-gbrain-told, oc-gbrain-told-2); the ladder has one cell per rung`]);
    const off = ladderPairs([{ id: 'q-company', harness: 'q', model: 'm', gbrain: { surface: 'starter', brain: 'company' } }]);
    expect(off.problems).toEqual(['q-company: starter/mcp/off, brain company is on no rung of the ladder']);
    expect(ladderPairs([{ id: 'only-none', harness: 'q', model: 'm' }])).toMatchObject({ pairs: [], problems: [], unpaired: ['q on m: none cell only-none has no mcp cell above it'] });
  });

  test('the three endpoints are 1 or 0 per trial; use and cross-scope are 0 without a gbrain record', () => {
    const { rows } = buildLadderFixture();
    const none = rows.find((t) => t.cell === 'oc-none' && t.task === 'si-01-quarrendon-seats')!;
    const told = rows.filter((t) => t.cell === 'oc-gbrain-told' && t.task === 'sc-01-north-two-asks');
    expect(ENDPOINTS.map((e) => endpointValue(e, none, none))).toEqual([1, 0, 0]);
    expect(told.map((t) => endpointValue('cross_scope', t, t))).toEqual([1, 1, 0, 0, 0]);
    expect(told.map((t) => endpointValue('use', t, t))).toEqual([1, 1, 1, 1, 1]);
    expect(endpointValue('pass', told[4]!, { grade: 'pass', consent_violation: true, predicates: [] })).toBe(0);
    expect(endpointValue('pass', told[4]!, { grade: 'pass', consent_violation: false, predicates: [] })).toBe(1);
  });

  test('the shards label says same machine, different machines, or which cell shards.json does not name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-shards-'));
    expect(readShards(dir)).toBeNull();
    writeFileSync(join(dir, 'shards.json'), JSON.stringify({ cells: { a: 'alpha', b: 'alpha', c: 'beta' }, shards: { alpha: { machine: null }, beta: { machine: 'capy-2' } } }));
    const shards = readShards(dir);
    expect(shardsLabel(shards, 'a', 'b')).toBe('same machine (alpha)');
    expect(shardsLabel(shards, 'a', 'c')).toBe('different machines (alpha, beta on capy-2)');
    expect(shardsLabel(shards, 'a', 'd')).toBe('shard unknown for d');
    expect(shardsLabel(null, 'a', 'b')).toBe('shards unknown (no shards.json)');
    writeFileSync(join(dir, 'shards.json'), JSON.stringify({ a: 'alpha' }));
    expect(() => readShards(dir)).toThrow('expected { cells: { <cell id>: <shard name> }, shards: { <name>: {...} } }');
  });
});

describe('compare-run --pair gbrain on the install ladder', () => {
  test('neighbour pairs on three endpoints, Holm families of six and five, the degenerate mcp rows, paired cost with the shards label, the none table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-ladder-'));
    writeLadderFixture(dir);
    const r = run('compare-run.ts', ['--results', dir, '--pair', 'gbrain', '--draws', '1000']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Scope: the install ladder (internal-task), each rung against its ladder neighbour within harness and model; grading as recorded; seed 7, 1000 draws; shards from shards.json.');
    expect(r.stdout).toContain('| `oc-gbrain-semantic-told` | oc | ' + HAIKU + ' | semantic-told | starter/mcp/openai:text-embedding-3-small, preamble ' + TOLD + ' | alpha |');
    const out = JSON.parse(readFileSync(join(dir, 'comparisons.gbrain.json'), 'utf8'));
    expect(out).toMatchObject({ pair: 'gbrain', design: 'ladder', exclusions: ['model_error', 'infra_error', 'exam_fault'], not_paired: [] });
    expect(out.shards.cells['oc-gbrain-docs-semantic']).toBe('beta');
    expect(out.rungs.map((r: { rung: string }) => r.rung).slice(0, 7)).toEqual(['none', 'mcp', 'told', 'docs', 'verbs-told', 'semantic-told', 'docs-semantic']);
    expect(out.scopes.map((s: { scope: string }) => s.scope)).toEqual(['primary', 'all']);
    const primary = out.scopes[0].endpoints;
    expect(Object.keys(primary)).toEqual(['pass', 'use', 'cross_scope']);
    const find = (endpoint: string, harness: string, rung: string, scope = primary) => scope[endpoint].comparisons.find((c: { harness: string; rung: string }) => c.harness === harness && c.rung === rung);
    // pass: six tested comparisons per harness, one Holm family each.
    for (const h of ['oc', 'hm']) {
      const fam = primary.pass.comparisons.filter((c: { harness: string }) => c.harness === h);
      expect(fam).toHaveLength(6);
      expect(fam.every((c: { tested: boolean; holm_family_size: number; holm_p: number | null }) => c.tested && c.holm_family_size === 6 && c.holm_p !== null)).toBe(true);
    }
    const told = find('pass', 'oc', 'told');
    expect(told).toMatchObject({ base_rung: 'mcp', cell: 'oc-gbrain-told', base_cell: 'oc-gbrain-mcp', positive: { base: 15, rung: 17 }, scored: { base: 20, rung: 20 }, n_pairs: 20, n_clusters: 4, excluded: [], discordant: { rung_only: 2, base_only: 0, both: 15, neither: 3 } });
    expect(told.delta).toBeCloseTo(2 / 20, 12);
    expect(told.ci95).toHaveLength(2);
    expect(told.holm_p).toBeGreaterThanOrEqual(told.p);
    expect(find('pass', 'hm', 'told').positive).toEqual({ base: 15, rung: 19 });
    expect(find('pass', 'oc', 'semantic-told')).toMatchObject({ excluded: [{ id: 'sc-01-north-two-asks/1', reason: 'rung infra_error' }], n_pairs: 19, p_method: 'degenerate', holm_p: 1 });
    // use and cross-scope: mcp against none is the mcp cell's rate with an interval and no test; the family is the other five.
    for (const endpoint of ['use', 'cross_scope']) {
      const mcp = find(endpoint, 'oc', 'mcp');
      expect(mcp).toMatchObject({ tested: false, p: null, p_method: null, holm_p: null, holm_family_size: 0, base_rung: 'none' });
      expect(mcp.test_note).toContain('the none cell is 0 by construction');
      const tested = primary[endpoint].comparisons.filter((c: { harness: string; tested: boolean }) => c.harness === 'oc' && c.tested);
      expect(tested).toHaveLength(5);
      expect(tested.every((c: { holm_family_size: number }) => c.holm_family_size === 5)).toBe(true);
    }
    expect(find('use', 'oc', 'mcp')).toMatchObject({ positive: { base: 0, rung: 1 }, delta: 0.05 });
    expect(find('use', 'oc', 'mcp').ci95[1]).toBeGreaterThan(0.05);
    expect(find('use', 'oc', 'told')).toMatchObject({ positive: { base: 1, rung: 19 }, delta: 0.9, n_pairs: 20 });
    expect(find('use', 'hm', 'docs').positive).toEqual({ base: 1, rung: 3 });
    expect(find('cross_scope', 'oc', 'told')).toMatchObject({ positive: { base: 0, rung: 3 }, delta: 0.15 });
    expect(find('cross_scope', 'oc', 'mcp')).toMatchObject({ positive: { base: 0, rung: 0 }, delta: 0, ci95: [0, 0] });
    const all = out.scopes[1].endpoints;
    expect(find('use', 'oc', 'told', all)).toMatchObject({ positive: { base: 1, rung: 22 }, n_pairs: 25, n_clusters: 5 });
    expect(find('use', 'oc', 'told', all).delta).toBeCloseTo(21 / 25, 12);
    // Cost, wall per turn and harness input tokens: paired differences rung minus base, with the machines label.
    const cost = (h: string, rung: string) => out.cost.find((c: { harness: string; rung: string }) => c.harness === h && c.rung === rung);
    const ocTold = cost('oc', 'told');
    expect(ocTold.usd_per_trial.median).toEqual({ base: 0.12, rung: 0.15 });
    expect(ocTold.usd_per_trial.delta).toBeCloseTo(0.03, 12);
    expect(ocTold.usd_per_trial.ci95[0]).toBeCloseTo(0.03, 12);
    expect(ocTold.usd_per_trial.ci95[1]).toBeCloseTo(0.03, 12);
    expect(ocTold.usd_per_trial).toMatchObject({ n_pairs: 25, n_clusters: 5, excluded: 0 });
    expect(ocTold.wall_s_per_turn).toMatchObject({ median: { base: 33, rung: 40 }, delta: 7, ci95: [7, 7] });
    expect(ocTold.harness_input_tokens).toMatchObject({ median: { base: 1400, rung: 1600 }, delta: 200, ci95: [200, 200] });
    expect(ocTold.machines).toBe('same machine (alpha on m-alpha)');
    expect(cost('oc', 'docs-semantic').machines).toBe('different machines (alpha on m-alpha, beta on m-beta)');
    expect(cost('hm', 'told').machines).toBe('same machine (gamma)');
    expect(cost('hm', 'docs').machines).toBe('shard unknown for hm-gbrain-docs');
    expect(cost('oc', 'semantic-told').usd_per_trial).toMatchObject({ n_pairs: 24, excluded: 1 });
    expect(cost('oc', 'verbs-told').harness_input_tokens.delta).toBe(-400);
    expect(r.stdout).toContain('| oc | ' + HAIKU + ' | told vs mcp | 0.1200, 0.1500; +0.0300 [+0.0300, +0.0300] | 33.0, 40.0; +7.0 [+7.0, +7.0] | 1,400, 1,600; +200 [+200, +200] | 25 | same machine (alpha on m-alpha) |');
    // The none table: every rung against its none cell, descriptive.
    expect(out.none_table).toHaveLength(12);
    const noneTold = out.none_table.find((n: { cell: string }) => n.cell === 'oc-gbrain-told');
    expect(noneTold).toMatchObject({ rung: 'told', none_cell: 'oc-none', pass: { positive: { none: 15, rung: 17 }, scored: { none: 25, rung: 25 } }, use: { positive: { none: 0, rung: 22 } }, cross_scope: { positive: { none: 0, rung: 3 } } });
    expect(noneTold.pass.delta).toBeCloseTo(2 / 25, 12);
    expect(noneTold.use.delta).toBeCloseTo(22 / 25, 12);
    expect(noneTold.use.p).toBeUndefined();
    expect(r.stdout).toContain('Against none (descriptive, all tasks, no test)');
    expect(existsSync(join(dir, 'comparisons.json'))).toBe(false);
  });

  test('a rung whose base cell is absent is a refusal naming the cells; a cell off the table too; --design overrides the shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-ladder-'));
    writeLadderFixture(dir);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { cells: Array<{ id: string }> };
    // Without hm's mcp cell, told and docs have no base and (with the rungs above them removed too) are nobody's base.
    const gone = new Set(['hm-gbrain-mcp', 'hm-gbrain-verbs-told', 'hm-gbrain-semantic-told', 'hm-gbrain-docs-semantic']);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...manifest, cells: manifest.cells.filter((c) => !gone.has(c.id)) }));
    const r = run('compare-run.ts', ['--results', dir, '--pair', 'gbrain', '--draws', '1000']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`hm on ${HAIKU}: rung told (hm-gbrain-told) has no mcp cell to pair against; hm on ${HAIKU}: rung docs (hm-gbrain-docs) has no mcp cell to pair against; hm on ${HAIKU}: none cell hm-none has no mcp cell above it`);
    expect(existsSync(join(dir, 'comparisons.gbrain.json'))).toBe(false);
    const off = { ...manifest, cells: manifest.cells.map((c) => (c.id === 'oc-gbrain-verbs-told' ? { ...c, preamble: undefined } : c)) };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(off));
    const r2 = run('compare-run.ts', ['--results', dir, '--pair', 'gbrain', '--draws', '1000']);
    expect(r2.status).toBe(2);
    expect(r2.stderr).toContain('oc-gbrain-verbs-told: verbs/mcp/off is on no rung of the ladder');
    // Two rungs only (none and mcp) look like the arm; --design ladder pairs them as the ladder's first comparison.
    const two = mkdtempSync(join(tmpdir(), 'he-ladder-'));
    writeLadderFixture(two);
    const rows = readFileSync(join(two, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord).filter((t) => ['oc-none', 'oc-gbrain-mcp'].includes(t.cell));
    writeFileSync(join(two, 'trials.jsonl'), rows.map((t) => JSON.stringify(t)).join('\n') + '\n');
    const arm = run('compare-run.ts', ['--results', two, '--pair', 'gbrain', '--draws', '1000']);
    expect(arm.status).toBe(0);
    expect(JSON.parse(readFileSync(join(two, 'comparisons.gbrain.json'), 'utf8')).design).toBeUndefined();
    const ladder = run('compare-run.ts', ['--results', two, '--pair', 'gbrain', '--design', 'ladder', '--draws', '1000']);
    expect(ladder.status).toBe(0);
    const out = JSON.parse(readFileSync(join(two, 'comparisons.gbrain.json'), 'utf8'));
    expect(out.design).toBe('ladder');
    expect(out.pairs).toEqual([{ harness: 'oc', config: null, model: HAIKU, rung: 'mcp', base_rung: 'none', cell: 'oc-gbrain-mcp', base_cell: 'oc-none' }]);
    expect(out.scopes[0].endpoints.pass.comparisons[0].holm_family_size).toBe(1);
    expect(out.scopes[0].endpoints.use.comparisons[0].tested).toBe(false);
    expect(run('compare-run.ts', ['--results', two, '--pair', 'gbrain', '--design', 'other']).status).toBe(2);
  });
});

describe('summarize-run on the install ladder', () => {
  test('summary.json gains a ladder key per cell: harness input tokens, embedding usage, the install bundle, semantic exclusions and degraded calls; cell keys unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-ladder-'));
    writeLadderFixture(dir);
    const r = run('summarize-run.ts', ['--results', dir]);
    expect(r.status).toBe(0);
    const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
    expect(Object.keys(summary.cells['oc-gbrain-semantic-told'])).toEqual(['n', 'passes', 'pass_rate', 'ci95', 'task_clusters', 'consent_violations', 'approval_stops', 'valid_approval_stops', 'terminations', 'excluded', 'cross_scope_read_failures', 'refused_requests', 'usd_total', 'usd_median', 'usd_per_success', 'tokens', 'wall_median_s', 'trial_ids', 'gbrain']);
    expect(summary.cells['oc-gbrain-semantic-told']).toMatchObject({ n: 24, excluded: 1, terminations: { completed: 24, infra_error: 1 } });
    expect(summary.ladder['oc-none']).toEqual({ harness_input_tokens: { median_per_trial: 1000, total: 25000, trials: 25 }, embedding_usage: { trials: 0, requests: 0, input_tokens: 0, usd: 0, refused: 0, failed: 0 }, install_bundle: null, semantic_exclusions: 0, degraded_calls: 0 });
    const semantic = summary.ladder['oc-gbrain-semantic-told'];
    expect(semantic).toMatchObject({ harness_input_tokens: { median_per_trial: 1600, total: 40000, trials: 25 }, embedding_usage: { trials: 25, requests: 75, input_tokens: 1500, refused: 0, failed: 0 }, install_bundle: null, semantic_exclusions: 1, degraded_calls: 0 });
    expect(semantic.embedding_usage.usd).toBeCloseTo(25 * 0.0000012, 12);
    expect(summary.ladder['hm-gbrain-docs']).toMatchObject({ embedding_usage: { trials: 0, requests: 0 }, install_bundle: { trials: 25, files: [131], context_outside_scope_max: 4 }, semantic_exclusions: 0 });
    expect(summary.ladder['hm-gbrain-docs'].install_bundle.view_digests).toHaveLength(1);
    expect(summary.ladder['oc-gbrain-docs-semantic']).toMatchObject({ embedding_usage: { trials: 25, requests: 50, input_tokens: 1000, failed: 5 }, install_bundle: { files: [127], context_outside_scope_max: null }, degraded_calls: 5 });
    expect(r.stdout).toContain('Install ladder (internal-task)');
    expect(r.stdout).toContain('| oc-gbrain-semantic-told | 1,600; 40,000 | 75 / 1,500 / $0.000030 (25) | 0 / 0 | none | 1 | 0 |');
    expect(r.stdout).toContain('| hm-gbrain-docs | 1,500; 37,500 | 0 / 0 / $0.000000 (0) | 0 / 0 | 131; sha256:hmdoc; 4 | 0 | 0 |');
    // A run with no gbrain record prints no ladder table and still writes the key.
    const plain = mkdtempSync(join(tmpdir(), 'he-ladder-'));
    fixtureRun(plain);
    const r2 = run('summarize-run.ts', ['--results', plain]);
    expect(r2.status).toBe(0);
    expect(r2.stdout).not.toContain('Install ladder (internal-task)');
    expect(JSON.parse(readFileSync(join(plain, 'summary.json'), 'utf8')).ladder['a-dev']).toMatchObject({ harness_input_tokens: { median_per_trial: 1000, total: 25000 }, semantic_exclusions: 0 });
  });
});

describe('paired-mdd --ladder', () => {
  test('the design formula: 20 tasks by 5 repetitions at one per-task rate', () => {
    const half = designMdd(0.5);
    expect(half.se_null).toBeCloseTo(Math.sqrt((20 / 19) * 0.5 / 100), 12);
    expect(half.mdd).toBeCloseTo((1.959964 + 0.841621) * half.se_null!, 5);
    expect(designMdd(0.1).mdd!).toBeLessThan(half.mdd!);
    expect(designMdd(0).mdd).toBeNull();
    expect(designMdd(0.5, { tasks: 1, reps: 5 }).se_null).toBeNull();
    expect(LADDER_DESIGN).toEqual({ tasks: 20, reps: 5 });
    // The same arithmetic as pairedMdd on a run where every task sits at the rate.
    const rows = Array.from({ length: 20 }, (_, i) => Array.from({ length: 5 }, (_, r) => trial('x', 'h', 'm', `task-${i}`, r + 1, r < 2, 0, 0, 0))).flat();
    expect(pairedMdd(rows, [{ id: 'x', harness: 'h', model: 'm' }])[0]!.mdd).toBeCloseTo(designMdd(0.4).mdd!, 12);
  });

  test('prints one table per endpoint with its receipt: the arm\'s trials when given, else the committed Haiku sensitivity run for pass and a stated assumption', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-ladder-'));
    writeLadderFixture(dir);
    const measured = run('paired-mdd.ts', ['--ladder', '--results', dir]);
    expect(measured.status).toBe(0);
    expect(measured.stdout).toContain('20 tasks by 5 repetitions, paired and task-clustered, two-sided alpha 0.05, power 0.8');
    expect(measured.stdout).toContain(`Rates from the gbrain arm's Haiku trials at ${dir}.`);
    expect(measured.stdout).toContain(`| gbrain use (at least one gbrain tools/call) | measured | oc-gbrain-told | 88% | 5 (3) | 25 | `);
    expect(measured.stdout).toContain(`| ${join(dir, 'trials.jsonl')} |`);
    expect(measured.stdout.split('\n').filter((l) => l.includes('| measured |'))).toHaveLength(3 * 14);
    expect(measured.stdout).not.toContain('assumption');
    const fallback = run('paired-mdd.ts', ['--ladder']);
    expect(fallback.status).toBe(0);
    const armResults = join(ROOT, 'docs', 'benchmarks', '2026-10-24-gbrain-arm', 'results');
    if (existsSync(join(armResults, 'trials.jsonl'))) {
      expect(fallback.stdout).toContain('| measured |');
      expect(fallback.stdout).toContain('docs/benchmarks/2026-10-24-gbrain-arm/results/trials.jsonl');
    } else {
      expect(fallback.stdout).toContain('| pass | measured, no gbrain | openclaw-haiku-mu-heldout | 64% | 20 (11) | 100 | 4.1 points | 11.5 points | docs/benchmarks/2026-10-24-m3-sensitivity-haiku/results/trials.jsonl |');
      expect(fallback.stdout).toContain('| gbrain use (at least one gbrain tools/call) | assumption: every task at rate 0.5 | any | 50% | 20 (0) | 100 | 7.3 points | 20.3 points | none (assumption) |');
      expect(fallback.stdout).toContain('| cross-scope read via gbrain | assumption: every task at rate 0.1 | any | 10% | 20 (0) | 100 | 4.4 points | 12.2 points | none (assumption) |');
    }
  });
});


describe('merge-shards', () => {
  /** Two shard directories from the ladder fixture: oc's cells on shard-a (with a shard.json), hm's on shard-b. */
  function shardDirs(root: string) {
    const { manifest, rows } = buildLadderFixture();
    const dirs = { a: join(root, 'shard-a'), b: join(root, 'shard-b') };
    for (const [key, dir] of Object.entries(dirs)) {
      const harness = key === 'a' ? 'oc' : 'hm';
      const mine = rows.filter((t) => t.harness === harness);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...manifest, created_at: key === 'a' ? '2026-10-24T01:00:00.000Z' : '2026-10-24T02:00:00.000Z' }));
      writeFileSync(join(dir, 'trials.jsonl'), mine.map((t) => JSON.stringify(t)).join('\n') + '\n');
      for (const t of mine.slice(0, 3)) { const td = join(dir, 'trials', ...t.trial_id.split('/').slice(1)); mkdirSync(td, { recursive: true }); writeFileSync(join(td, 'events.jsonl'), ''); }
      writeFileSync(join(dir, 'ledger.sqlite'), `ledger of ${key}`);
      writeFileSync(join(dir, 'proxy.log'), `proxy of ${key}\n`);
      writeFileSync(join(dir, 'proxy-usage.ndjson'), '');
      writeFileSync(join(dir, 'reconcile-provider.json'), '{}');
      mkdirSync(join(dir, 'preflight-proxy'), { recursive: true });
      writeFileSync(join(dir, 'preflight-proxy', 'proxy.log'), 'preflight');
    }
    writeFileSync(join(dirs.a, 'shard.json'), JSON.stringify({ name: 'shard-a', machine: 'capy-1', commit: 'abc1234', images: { gbrain: 'sha256:aaa' } }));
    return { dirs, manifest, rows };
  }

  test('concatenates trials in manifest order, copies trials/, keeps each shard\'s files under its name, writes one manifest and shards.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'he-merge-'));
    const { dirs, manifest, rows } = shardDirs(root);
    const out = join(root, 'merged');
    const r = run('merge-shards.ts', ['--out', out, '--shard', `shard-a=${dirs.a}`, '--shard', `shard-b=${dirs.b}`]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`Merged 2 shard(s) into ${out}: 14 cells, 350 trials.`);
    expect(r.stdout).toContain('| shard-a | capy-1 | abc1234 | 175 | oc-none, oc-gbrain-mcp, oc-gbrain-told, oc-gbrain-docs, oc-gbrain-verbs-told, oc-gbrain-semantic-told, oc-gbrain-docs-semantic |');
    expect(r.stdout).toContain('| shard-b | unknown | unknown | 175 |');
    const merged = readFileSync(join(out, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord);
    expect(merged.map((t) => t.trial_id)).toEqual(manifest.trials.map((t) => t.id));
    expect(merged.map((t) => t.trial_id)).toEqual(rows.map((t) => t.trial_id));
    expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')).created_at).toBe('2026-10-24T01:00:00.000Z');
    expect(JSON.parse(readFileSync(join(out, 'shard-b.manifest.json'), 'utf8')).created_at).toBe('2026-10-24T02:00:00.000Z');
    expect(existsSync(join(out, 'shard-a.manifest.json'))).toBe(false);
    expect(readFileSync(join(out, 'shard-a.ledger.sqlite'), 'utf8')).toBe('ledger of a');
    expect(readFileSync(join(out, 'shard-b.proxy.log'), 'utf8')).toBe('proxy of b\n');
    for (const f of ['shard-a.proxy-usage.ndjson', 'shard-b.reconcile-provider.json', 'shard-a.preflight-proxy/proxy.log', 'shard-a.shard.json', 'trials/oc-none/si-01-quarrendon-seats/r1/events.jsonl', 'trials/hm-none/si-01-quarrendon-seats/r3/events.jsonl']) expect(existsSync(join(out, f))).toBe(true);
    expect(existsSync(join(out, 'ledger.sqlite'))).toBe(false);
    const shards = JSON.parse(readFileSync(join(out, 'shards.json'), 'utf8'));
    expect(shards.cells).toEqual(Object.fromEntries(manifest.cells.map((c) => [c.id, c.harness === 'oc' ? 'shard-a' : 'shard-b'])));
    expect(shards.shards['shard-a']).toEqual({ name: 'shard-a', machine: 'capy-1', commit: 'abc1234', images: { gbrain: 'sha256:aaa' }, source: dirs.a, trials: 175, cells: manifest.cells.filter((c) => c.harness === 'oc').map((c) => c.id).sort() });
    expect(shards.shards['shard-b']).toMatchObject({ machine: null, commit: null, images: null, trials: 175 });
    // The merged directory is what compare-run reads; the shard label comes through.
    const cmp = run('compare-run.ts', ['--results', out, '--pair', 'gbrain', '--draws', '1000']);
    expect(cmp.status).toBe(0);
    expect(cmp.stdout).toContain('| oc | ' + HAIKU + ' | told vs mcp | 0.1200, 0.1500; +0.0300 [+0.0300, +0.0300] | 33.0, 40.0; +7.0 [+7.0, +7.0] | 1,400, 1,600; +200 [+200, +200] | 25 | same machine (shard-a on capy-1) |');
    expect(cmp.stdout).toContain('| hm | ' + HAIKU + ' | told vs mcp | ');
    expect(cmp.stdout).toContain('| 25 | same machine (shard-b) |');
    // A second merge into the same directory is refused.
    expect(run('merge-shards.ts', ['--out', out, '--shard', `shard-a=${dirs.a}`, '--shard', `shard-b=${dirs.b}`]).status).toBe(2);
  });

  test('refuses a trial in two shards, a manifest trial in no shard, a stray trial, differing manifests and a mislabelled shard.json, naming each', () => {
    const root = mkdtempSync(join(tmpdir(), 'he-merge-'));
    const { dirs, manifest } = shardDirs(root);
    const merge = (n: number) => run('merge-shards.ts', ['--out', join(root, `out-${n}`), '--shard', `shard-a=${dirs.a}`, '--shard', `shard-b=${dirs.b}`]);
    const linesB = readFileSync(join(dirs.b, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean);
    const linesA = readFileSync(join(dirs.a, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean);
    writeFileSync(join(dirs.b, 'trials.jsonl'), [...linesB, linesA[0]!].join('\n') + '\n');
    const dup = merge(1);
    expect(dup.status).toBe(2);
    expect(dup.stderr).toContain(`merge-shards: trial ${JSON.parse(linesA[0]!).trial_id} is in shards shard-a and shard-b; a cell runs on one shard`);
    writeFileSync(join(dirs.b, 'trials.jsonl'), linesB.slice(1).join('\n') + '\n');
    const missing = merge(2);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain(`merge-shards: 1 manifest trial(s) in no shard: ${JSON.parse(linesB[0]!).trial_id}; an incomplete shard is finished with run --resume before the merge`);
    const stray = { ...JSON.parse(linesB[0]!), trial_id: `${manifest.run_id}/hm-none/zz-99-unplanned/r1`, task: 'zz-99-unplanned' };
    writeFileSync(join(dirs.b, 'trials.jsonl'), [...linesB, JSON.stringify(stray)].join('\n') + '\n');
    const strayRun = merge(3);
    expect(strayRun.status).toBe(2);
    expect(strayRun.stderr).toContain(`merge-shards: 1 trial(s) not in the manifest: ${stray.trial_id} (shard shard-b)`);
    writeFileSync(join(dirs.b, 'trials.jsonl'), linesB.join('\n') + '\n');
    writeFileSync(join(dirs.b, 'manifest.json'), JSON.stringify({ ...manifest, spend_cap_usd: 2, per_cell_ceiling_usd: { x: 1 } }));
    const differ = merge(4);
    expect(differ.status).toBe(2);
    expect(differ.stderr).toContain("merge-shards: shard shard-b: manifest.json differs from shard shard-a's in per_cell_ceiling_usd, spend_cap_usd");
    writeFileSync(join(dirs.b, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(dirs.b, 'shard.json'), JSON.stringify({ name: 'shard-c', machine: 'capy-9' }));
    const mislabel = merge(5);
    expect(mislabel.status).toBe(2);
    expect(mislabel.stderr).toContain('merge-shards: shard shard-b: its shard.json names itself "shard-c"');
    for (let n = 1; n <= 5; n++) expect(existsSync(join(root, `out-${n}`))).toBe(false);
    expect(run('merge-shards.ts', ['--out', join(root, 'out-6')]).status).toBe(2);
    expect(run('merge-shards.ts', ['--out', join(root, 'out-7'), '--shard', 'nodir']).status).toBe(2);
  });
});

