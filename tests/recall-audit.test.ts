// The recall re-reading of gbrain-memory-2026-10 (internal-task): scripts/recall-audit.ts over the committed receipts reproduces the
// committed derived files (all four), the case the report named (cr-05: 13 Sonnet searches under Kwame's token, the correction in
// the brain and readable, no saved fact) is counted as it says, the definitions the ship review corrected hold (a needed fact is
// ingested before the consumer turn, a re-read matches a channel id or name, a hot-memory block only matters for a private
// fact, and OpenClaw and QM never show it to the model), both oracles are counted, the case list carries both id sets and the
// question, and the figures README.md and the CHANGELOG cite are the ones the audit computes. Keyless; reads only
// docs/benchmarks/2026-10-26-gbrain-memory/ and the world seed.

import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { audit, markdown, NEEDS, recallCases, summarize } from '../scripts/recall-audit.ts';

const ROOT = join(import.meta.dir, '..');
const RUN = join(ROOT, 'docs/benchmarks/2026-10-26-gbrain-memory');
const result = audit(join(RUN, 'results'), join(ROOT, 'world/seed/world.json'));
const summary = summarize(result.calls, result.turns);
const lines = (f: string) => readFileSync(join(RUN, 'recall-rereading', f), 'utf8').trim().split('\n');
const ran = result.turns.filter((t) => t.outcome !== 'turn not run' && !String(t.outcome).startsWith('excluded'));

test('the committed calls.jsonl, turns.jsonl, summary.json and summary.md match a fresh run of the audit', () => {
  expect(result.calls.map((c) => JSON.stringify(c))).toEqual(lines('calls.jsonl'));
  expect(result.turns.map((t) => JSON.stringify(t))).toEqual(lines('turns.jsonl'));
  expect(JSON.parse(readFileSync(join(RUN, 'recall-rereading', 'summary.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(summary)));
  expect(markdown(summary, result.turns)).toBe(readFileSync(join(RUN, 'recall-rereading', 'summary.md'), 'utf8'));
});

test('the figures README.md and the CHANGELOG cite are the ones the audit computes', () => {
  expect(summary.reads).toBe(870);
  expect(summary.overall).toMatchObject({ calls: 308, original_hits: 112, any_hits: 151, saved_facts_hits: 122 });
  expect(summary.misses).toEqual({ calls: 157, returned_saved_facts: 117, current_question_among_them: 115, only_the_current_question: 111 });
  expect(summary.consumer_turns).toBe(299);
  expect(Object.fromEntries(summary.outcomes.map((o) => [o.outcome, o.turns]))).toEqual({
    'needed predicates passed': 160, 'fail: no gbrain read this turn': 28, 'fail: not readable under the grant': 8, 'fail: retrieval miss': 25,
    'fail: retrieval miss (saved facts; hot memory not shown to the model)': 37, 'fail: returned, predicate still failed': 41,
  });
});

test('a needed fact is one ingested before the consumer turn began: ar-04 never counts the approver\'s own turn-3 message', () => {
  const ar04 = result.calls.filter((c) => c.task === 'ar-04-mateo-hartford-mail' && c.need !== null);
  expect(ar04.length).toBeGreaterThan(0);
  for (const c of ar04) for (const f of c.needed_readable as Array<{ author: string }>) expect(f.author).not.toBe('ruth-calloway');
  expect(ar04.filter((c) => c.needed_in_hot_memory === true)).toHaveLength(0);
});

test('a re-read of the source conversation matches the channel by id or by name: every ms-05 live trial re-read the incident channel', () => {
  const ms05 = ran.filter((t) => t.task === 'ms-05-vantorre-tickets');
  expect(ms05).toHaveLength(30);
  for (const t of ms05) expect(t.reread_source_conversation).toBe(true);
});

test('a hot-memory block qualifies a miss only when a needed fact sat in the requester\'s private source, and OpenClaw and QM never show it', () => {
  const cr05 = ran.filter((t) => t.task === 'cr-05-pellow-seat-retraction' && String(t.outcome).startsWith('fail: retrieval miss'));
  expect(cr05).toHaveLength(25);
  for (const t of cr05) expect(t.outcome).toBe('fail: retrieval miss');
  const notShown = ran.filter((t) => t.outcome === 'fail: retrieval miss (saved facts; hot memory not shown to the model)');
  expect(notShown).toHaveLength(37);
  for (const t of notShown) {
    expect(t.where_fact_lives).toBe('dm');
    expect(t.harness).not.toBe('hermes');
  }
  expect(ran.filter((t) => t.outcome === 'fail: retrieval miss (saved facts; hot memory not recorded)')).toHaveLength(0);
  for (const c of result.calls) {
    if (c.harness === 'hermes') expect(c.needed_in_hot_memory).not.toBe('not shown to the model');
    else expect(c.needed_in_hot_memory).toBe('not shown to the model');
    if (c.harness !== 'hermes' && c.recall === 'hit') expect((c.needed_in_saved_facts as string[]).length).toBeGreaterThan(0);
  }
});

test('two oracles: an original fact returned is a member\'s own message, and every original hit is also an information hit', () => {
  expect(summary.oracles.original.name).toBe('original fact returned');
  expect(summary.oracles.information.name).toBe('information returned (original or a correct assistant restatement)');
  const scored = result.calls.filter((c) => c.recall !== 'n/a' && ['search', 'query', 'recall'].includes(String(c.tool)));
  for (const c of result.calls) expect(c.recall_original === 'n/a').toBe(c.recall === 'n/a');
  for (const c of scored) {
    if (c.recall_original === 'hit') expect(c.recall).toBe('hit');
    const originals = (c.needed_readable as Array<{ id: string; author: string }>).filter((f) => f.author !== 'assistant').map((f) => f.id);
    if (c.harness !== 'hermes') expect(c.recall_original === 'hit').toBe((c.needed_in_saved_facts as string[]).some((id) => originals.includes(id)));
  }
  const restatementOnly = scored.filter((c) => c.recall === 'hit' && c.recall_original === 'miss');
  expect(restatementOnly).toHaveLength(summary.overall.any_hits - summary.overall.original_hits);
  expect(new Set(restatementOnly.map((c) => c.task))).toEqual(new Set(['ar-04-mateo-hartford-mail', 'ar-05-driftmoor-rate-to-bettina']));
  for (const t of result.turns.filter((t) => t.returned_original === true)) expect(t.returned_needed).toBe(true);
});

test('every predicate NEEDS names is a graded predicate of its task in the counted run', () => {
  const graded = new Map<string, Set<string>>();
  for (const l of readFileSync(join(RUN, 'results', 'trials.jsonl'), 'utf8').trim().split('\n')) {
    const r = JSON.parse(l) as { task: string; predicates: Array<{ id: string }> };
    if (!graded.has(r.task)) graded.set(r.task, new Set());
    for (const p of r.predicates) graded.get(r.task)!.add(p.id);
  }
  for (const [task, needs] of Object.entries(NEEDS)) for (const n of needs) for (const p of n.predicates) expect(graded.get(task)?.has(p) ? p : task + ':' + p).toBe(p);
});

test('the recall case list has one case per scored call, miss or control as the call recalled, each with a repo-relative events path', () => {
  const scored = result.calls.filter((c) => c.recall !== 'n/a' && ['search', 'query', 'recall'].includes(String(c.tool)));
  const { cases } = recallCases(result.calls, join(RUN, 'results'));
  expect(cases).toHaveLength(scored.length);
  expect(cases.filter((c) => c.kind === 'miss')).toHaveLength(scored.filter((c) => c.recall === 'miss').length);
  expect(cases.filter((c) => c.original_returned)).toHaveLength(summary.overall.original_hits);
  for (const c of cases) {
    expect(c.events.startsWith('/')).toBe(false);
    expect(existsSync(join(ROOT, c.events))).toBe(true);
    expect(c.needed.length).toBeGreaterThan(0);
    expect([...c.needed_ids, ...c.restatement_ids].sort()).toEqual(c.needed.map((f) => f.id).sort());
    for (const f of c.needed) expect(f.author === 'assistant').toBe(c.restatement_ids.includes(f.id));
    const scenario = readFileSync(join(ROOT, c.events.replace(/events\.jsonl$/, 'turns.jsonl')), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { turn: number; text: string });
    expect(c.question).toBe(scenario.find((s) => s.turn === c.turn)!.text);
  }
  expect(cases.some((c) => c.needed_ids.length > 0 && c.restatement_ids.length > 0)).toBe(true);
  expect(cases.filter((c) => c.needed_ids.length === 0).every((c) => c.task === 'ar-05-driftmoor-rate-to-bettina')).toBe(true);
});

test('README.md and the CHANGELOG entry state the misses, both oracles and the harness-side losses with the counts summary.json gives', () => {
  const readme = readFileSync(join(RUN, 'recall-rereading', 'README.md'), 'utf8');
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8').split('\n## [').find((entry) => entry.includes('### internal-task: a recall re-reading of gbrain-memory-2026-10'))!;
  const m = summary.misses, o = summary.overall, out = Object.fromEntries(summary.outcomes.map((x) => [x.outcome, x.turns]));
  const missLine = 'Of the ' + m.returned_saved_facts + ' misses that returned saved facts, ' + m.current_question_among_them + ' included the asker\'s own current message and in ' + m.only_the_current_question + ' it was the only fact returned.';
  const losses = (out['fail: returned, predicate still failed']) + ' turns that got the fact back and still failed the predicate and ' + out['fail: no gbrain read this turn'] + ' that made no gbrain read';
  const pctOf = (h: number) => Math.round((100 * h) / o.calls);
  for (const doc of [readme, changelog]) {
    expect(doc).toContain(missLine);
    for (const h of [o.original_hits, o.any_hits]) expect(doc).toMatch(new RegExp('\\b' + h + '( of ' + o.calls + ')? \\(' + pctOf(h) + ' percent'));
  }
  expect(changelog).toContain('harness-side losses are ' + losses);
  expect(readme).toContain(out['fail: returned, predicate still failed'] + ' consumer turns got the fact back and still failed the predicate, and ' + out['fail: no gbrain read this turn'] + ' made no gbrain read');
});

test('cr-05: every Sonnet search under Kwame had the correction readable and returned no saved fact', () => {
  const sonnet = result.calls.filter((c) => String(c.task).startsWith('cr-05') && c.model === 'sonnet' && c.turn === 3 && c.tool === 'search');
  expect(sonnet).toHaveLength(13);
  for (const c of sonnet) {
    expect(c.grant).toBe('kwame-adjei');
    expect((c.needed_readable as unknown[]).length).toBeGreaterThan(0);
    expect(c.saved_facts).toEqual([]);
    expect((c.pages as string[]).length).toBe(4);
    expect(c.recall).toBe('miss');
  }
});

test('a read outside a consumer turn, or with the needed fact unreadable, is never scored as a miss', () => {
  for (const c of result.calls) {
    if (c.need === null) expect(c.recall).toBe('n/a');
    if ((c.needed_readable as unknown[]).length === 0) expect(c.recall).toBe('n/a');
  }
  const ar05 = result.turns.filter((t) => t.outcome === 'fail: not readable under the grant');
  expect(ar05.length).toBeGreaterThan(0);
  for (const t of ar05) expect(t.task).toBe('ar-05-driftmoor-rate-to-bettina');
});
