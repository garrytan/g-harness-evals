import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildPackets, type HashedPacket } from '../scripts/failure-mining/packet.ts';
import { buildSdkPackets } from '../scripts/failure-mining/sdk-packet.ts';
import { checkLabels, checkRecord, loadCodebook, normalizeText, readLabels, type LabelLine, type LabelRecord } from '../scripts/failure-mining/check-labels.ts';
import { cohensKappa, judgeCheck } from '../scripts/failure-mining/judge-check.ts';

const ROOT = resolve(import.meta.dir, '..');
const FX = join(ROOT, 'tests/fixtures/failure-mining');
const codebook = loadCodebook(join(FX, 'codebook.json'));
const packets = buildPackets(join(FX, 'taxonomy.json'), { results: join(FX, 'mu'), tasksRoot: join(ROOT, 'tasks/multiuser/v0.3') }).packets;
const CR04 = packets.find((p) => p.trial_id.includes('cr-04'))!;
const SDK = join(FX, 'sdk');
const [SDK_GSTACK, SDK_NONE] = buildSdkPackets({ transcripts: join(SDK, 'transcripts'), results: join(SDK, 'rows'), tasksRoot: join(ROOT, 'tasks/repo/gstack-native-v1'), sources: [{ run: 'gn-follow-2026-11', lease: 'opus-follow', rows: 'gn-follow-2026-11/trials.jsonl' }] }).packets as [any, any];
const tmp = mkdtempSync(join(tmpdir(), 'fm-check-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const rec = (o: Partial<LabelRecord> = {}): LabelRecord => ({
  trial_id: CR04.trial_id, root_cause: 'found_and_ignored', first_wrong_step: { turn: 3, seq: 8, kind: 'reply' }, stage: 'decide', brain_role: 'absent', gstack_role: 'absent',
  evidence_quotes: ["Hollis, it's **382 seats** for Marrow Agrisupply"], confidence: 'high', note: 'It gave the superseded count.', ...o,
});

describe('check-labels.ts', () => {
  test('a label whose seq is a bot event in its turn and whose quotes are in the packet is verified', () => {
    expect(checkRecord(rec(), CR04, codebook)).toEqual({ verified: true, reasons: [] });
    expect(checkRecord(rec({ evidence_quotes: ['none match /\\\\b84\\\\b/'] }), CR04, codebook).verified).toBe(true);
    expect(checkRecord(rec({ root_cause: 'other', first_wrong_step: { turn: 3, seq: null, kind: 'no_action' } }), CR04, codebook).verified).toBe(true);
  });

  test('names each failed check', () => {
    const reasons = (r: LabelRecord, p: HashedPacket = CR04) => checkRecord(r, p, codebook).reasons;
    expect(reasons(rec({ root_cause: 'made_up' }))).toEqual(['root_cause "made_up" is not a codebook id']);
    expect(reasons(rec({ first_wrong_step: { turn: 3, seq: 6, kind: 'action' } }))).toEqual(['seq 6 is not a bot event (actor hollis-mbeki)']);
    expect(reasons(rec({ first_wrong_step: { turn: 2, seq: 8, kind: 'reply' } }))).toEqual(['seq 8 falls in turn 3, not turn 2']);
    expect(reasons(rec({ first_wrong_step: { turn: 3, seq: 99, kind: 'action' } }))).toEqual(['seq 99 is not in the packet']);
    expect(reasons(rec({ first_wrong_step: { turn: 9, seq: null, kind: 'no_action' } }))).toEqual(['turn 9 is not a turn of the task']);
    expect(reasons(rec({ first_wrong_step: { turn: 3, seq: 8, kind: 'no_action' } }))).toEqual(['a no_action step cites seq 8; it should cite none']);
    expect(reasons(rec({ first_wrong_step: { turn: 3, seq: null, kind: 'action' } }))).toEqual(['a action step cites no seq']);
    expect(reasons(rec({ evidence_quotes: ['382 seats', 'the bot said 84 seats'] }))).toEqual(['quote not found verbatim in the packet: "the bot said 84 seats"']);
    const cut = { ...CR04, events: CR04.events.filter((e) => e.seq !== 8), truncation: { ...CR04.truncation, dropped_bot_seqs: [8] } };
    expect(reasons(rec(), cut)).toEqual(['seq 8 was cut from the packet by its token cap']);
  });

  test('gstack_role must be absent when the packet shows no gstack, and not absent when it does', () => {
    expect(checkRecord(rec({ gstack_role: 'followed' }), CR04, codebook).reasons).toEqual(['gstack_role is followed but the packet shows no gstack']);
    const tool = SDK_GSTACK.steps.find((s: any) => s.kind === 'tool')!;
    const sdk = (o: Partial<LabelRecord>) => rec({ trial_id: SDK_GSTACK.trial_id, first_wrong_step: { turn: null, seq: tool.step, kind: 'action' }, evidence_quotes: [SDK_GSTACK.task.prompt.slice(0, 50)], gstack_role: 'loaded_not_followed', ...o });
    expect(checkRecord(sdk({}), SDK_GSTACK, codebook)).toEqual({ verified: true, reasons: [] });
    expect(checkRecord(sdk({ gstack_role: 'absent' }), SDK_GSTACK, codebook).reasons).toEqual(['gstack_role is absent but the packet shows gstack']);
    expect(checkRecord(sdk({ gstack_role: 'not_loaded' }), SDK_NONE, codebook).reasons).toEqual(expect.arrayContaining(['gstack_role is not_loaded but the packet shows no gstack']));
  });

  test('brain_role must be absent exactly when a multi-user packet has no gbrain', () => {
    expect(CR04.gbrain).toBeNull();
    expect(checkRecord(rec({ brain_role: 'called_no_help' }), CR04, codebook).reasons).toEqual(['brain_role is called_no_help but the packet shows no gbrain']);
    const withBrain = { ...CR04, gbrain: { total: 2, discovery: 0, calls: 2, in_turn_calls: 1, writes: 0, degraded: null } } as HashedPacket;
    expect(checkRecord(rec(), withBrain, codebook).reasons).toEqual(['brain_role is absent but the packet shows gbrain']);
    expect(checkRecord(rec({ brain_role: 'not_called' }), withBrain, codebook)).toEqual({ verified: true, reasons: [] });
  });

  test('an sdk packet takes a step index for seq and a null turn', () => {
    const tool = SDK_NONE.steps.find((s: any) => s.kind === 'tool')!;
    const result = SDK_NONE.steps.find((s: any) => s.kind === 'result')!;
    const sdk = (step: LabelRecord['first_wrong_step']) => checkRecord(rec({ trial_id: SDK_NONE.trial_id, first_wrong_step: step, evidence_quotes: [String(tool.input.command ?? tool.input.file_path).slice(0, 30)] }), SDK_NONE, codebook).reasons;
    expect(sdk({ turn: null, seq: tool.step, kind: 'action' })).toEqual([]);
    expect(sdk({ turn: null, seq: result.step, kind: 'reply' })).toEqual([]);
    expect(sdk({ turn: null, seq: null, kind: 'no_action' })).toEqual([]);
    expect(sdk({ turn: 1, seq: tool.step, kind: 'action' })).toEqual(['an sdk packet has no turns; turn must be null, not 1']);
    expect(sdk({ turn: null, seq: result.step, kind: 'action' })).toEqual([`step ${result.step} is result, not a tool call`]);
    expect(sdk({ turn: null, seq: tool.step, kind: 'reply' })).toEqual([`step ${tool.step} is a tool call, not text or the result`]);
    expect(sdk({ turn: null, seq: 999, kind: 'action' })).toEqual(['step 999 is not in the packet']);
    const cut = { ...SDK_NONE, steps: SDK_NONE.steps.slice(1), truncation: { ...SDK_NONE.truncation, dropped_steps: [0] } };
    expect(checkRecord(rec({ trial_id: SDK_NONE.trial_id, first_wrong_step: { turn: null, seq: 0, kind: 'reply' }, evidence_quotes: ['the'] }), cut, codebook).reasons).toEqual(['step 0 was cut from the packet by its token cap']);
  });

  test('quotes match after whitespace, JSON escapes and typographic quotes are folded', () => {
    expect(normalizeText('a\u2019b  \\n c\u2014d \\"e\\"')).toBe('a\'b c-d "e"');
  });

  test('checkLabels marks failed labelling, a changed packet and a missing packet unverified', () => {
    const base = { model: 'm', codebook_sha256: 'c', prefix_sha256: 'p', attempts: 1, cached: false, check: null };
    const lines = new Map<string, LabelLine>([
      [CR04.trial_id, { ...rec(), status: 'ok', packet_sha256: CR04.packet_sha256, ...base }],
      [packets[0]!.trial_id, { trial_id: packets[0]!.trial_id, status: 'failed', packet_sha256: packets[0]!.packet_sha256, problems: ['the reply carried no record'], ...base }],
      [packets[1]!.trial_id, { ...rec({ trial_id: packets[1]!.trial_id }), status: 'ok', packet_sha256: 'stale', ...base }],
      ['gone/x/y/r1', { ...rec({ trial_id: 'gone/x/y/r1' }), status: 'ok', packet_sha256: 'x', ...base }],
    ]);
    const out = new Map(checkLabels(lines, packets, codebook).map((c) => [c.trial_id, c]));
    expect(out.get(CR04.trial_id)).toEqual({ trial_id: CR04.trial_id, status: 'verified', reasons: [] });
    expect(out.get(packets[0]!.trial_id)!.reasons).toEqual(['labelling failed: the reply carried no record']);
    expect(out.get(packets[1]!.trial_id)!.reasons[0]).toBe('the label was made from a different packet (packet_sha256 differs)');
    expect(out.get('gone/x/y/r1')).toMatchObject({ status: 'unverified', reasons: ['no packet for this trial id'] });
  });

  test('loadCodebook refuses a malformed codebook', () => {
    const bad = join(tmp, 'bad.json');
    writeFileSync(bad, JSON.stringify({ classes: [{ id: 'other', name: 'x', definition: 'x', include: 'x', exclude: '' }, { id: 'Bad Id', name: 'x', definition: 'x', include: 'x', exclude: 'x' }] }));
    expect(() => loadCodebook(bad)).toThrow(/classes\[0\]\.exclude.*reserved.*snake_case/);
  });
});

describe('judge-check.ts', () => {
  test("Cohen's kappa matches a hand-worked case and is null when undefined", () => {
    const a = ['x', 'x', 'x', 'y', 'y', 'y', 'x', 'y', 'x', 'x'];
    const b = ['x', 'x', 'y', 'y', 'y', 'x', 'x', 'y', 'x', 'y'];
    expect(cohensKappa(a, b)).toBeCloseTo((0.7 - 0.5) / 0.5, 10);
    expect(cohensKappa(['x', 'x'], ['x', 'x'])).toBeNull();
    expect(cohensKappa([], [])).toBeNull();
    expect(cohensKappa(['x', 'y'], ['x', 'y'])).toBe(1);
  });

  test('gold is where both gold labellers agree; an unlabelled gold item is a disagreement; reports coverage, per-class rates and test-retest', () => {
    const write = (name: string, labels: Record<string, string | null>) => {
      const path = join(tmp, name);
      writeFileSync(path, Object.entries(labels).map(([id, c]) => JSON.stringify(c ? { trial_id: id, status: 'ok', root_cause: c } : { trial_id: id, status: 'failed' })).join('\n') + '\n');
      return path;
    };
    const goldA = write('a.jsonl', { t1: 'p', t2: 'p', t3: 'q', t4: 'q', t5: 'r', t6: 'p' });
    const goldB = write('b.jsonl', { t1: 'p', t2: 'p', t3: 'q', t4: 'q', t5: 'p', t6: 'p' });
    const cand = write('c.jsonl', { t1: 'p', t2: 'q', t3: 'q', t4: 'q', t5: 'p', t6: null });
    const retest = write('c2.jsonl', { t1: 'p', t2: 'q', t3: 'p', t4: 'q', t5: 'p' });
    const r = judgeCheck({ goldA, goldB, candidate: cand, retestA: cand, retestB: retest, classes: ['p', 'q', 'r', 'other'] });
    expect(r.gold).toEqual({ n: 5, by_class: { p: 3, q: 2 } });
    expect(r.gold_labellers.agreement).toMatchObject({ n: 6, agree: 5, x_labelled: 6, y_labelled: 6 });
    // t6 is gold p and the candidate's line failed: it is scored as unlabelled, a disagreement.
    expect(r.candidate).toMatchObject({ n: 5, labelled: 4, missing: 1, coverage: 0.8, agreement: { n: 5, agree: 3, raw_agreement: 0.6 } });
    expect(r.candidate.agreement.kappa).toBeCloseTo(cohensKappa(['p', 'q', 'q', 'q', 'unlabelled'], ['p', 'p', 'q', 'q', 'p'])!, 10);
    const p = r.candidate.per_class.find((c) => c.class === 'p')!;
    expect(p).toEqual({ class: 'p', gold: 3, labelled: 2, coverage: 2 / 3, caught: 1, catch_rate: 1 / 3, others: 2, others_labelled: 2, others_coverage: 1, false_assigned: 0, false_assignment_rate: 0 });
    const q = r.candidate.per_class.find((c) => c.class === 'q')!;
    expect(q).toMatchObject({ gold: 2, caught: 2, catch_rate: 1, others: 3, others_labelled: 2, false_assigned: 1, false_assignment_rate: 1 / 3 });
    expect(r.candidate.per_class.find((c) => c.class === 'other')).toMatchObject({ gold: 0, catch_rate: null, false_assignment_rate: 0 });
    expect(r.retest!.agreement).toMatchObject({ n: 5, agree: 4 });
    expect(r.gate).toMatchObject({ n_gold_ok: false, passes: false });
    expect(readLabels(cand).lines.get('t6')!.status).toBe('failed');
  });

  test('40 gold items with only 2 labelled fails the gate', () => {
    const write = (name: string, labels: Record<string, string>) => {
      const path = join(tmp, name);
      writeFileSync(path, Object.entries(labels).map(([id, c]) => JSON.stringify({ trial_id: id, status: 'ok', root_cause: c })).join('\n') + '\n');
      return path;
    };
    const gold = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`g${String(i).padStart(2, '0')}`, ['p', 'q', 'r', 's'][i % 4]!]));
    const goldA = write('cov-a.jsonl', gold), goldB = write('cov-b.jsonl', gold);
    const cand = write('cov-c.jsonl', { g00: 'p', g01: 'q' });
    const r = judgeCheck({ goldA, goldB, candidate: cand });
    expect(r.gold.n).toBe(40);
    expect(r.candidate).toMatchObject({ n: 40, labelled: 2, missing: 38, coverage: 0.05 });
    expect(r.candidate.agreement.kappa!).toBeLessThan(0.1);
    expect(r.gate).toMatchObject({ n_gold_ok: true, kappa_ok: false, passes: false });
    expect(r.candidate.per_class.find((c) => c.class === 'p')).toMatchObject({ gold: 10, labelled: 1, coverage: 0.1, caught: 1, catch_rate: 0.1 });
    const full = judgeCheck({ goldA, goldB, candidate: goldA });
    expect([full.candidate.coverage, full.candidate.agreement.kappa, full.gate.passes]).toEqual([1, 1, true]);
  });

  test('gold labellers agree over the whole gold sample; a missing label on either side is a disagreement', () => {
    const write = (name: string, labels: Record<string, string>) => {
      const path = join(tmp, name);
      writeFileSync(path, Object.entries(labels).map(([id, c]) => JSON.stringify({ trial_id: id, status: 'ok', root_cause: c })).join('\n') + '\n');
      return path;
    };
    const goldA = write('s-a.jsonl', { t1: 'p', t2: 'q' }), goldB = write('s-b.jsonl', { t1: 'p', t2: 'q', t3: 'p' });
    const r = judgeCheck({ goldA, goldB, candidate: goldA, sample: ['t1', 't2', 't3', 't4'] });
    expect(r.gold_labellers).toMatchObject({ sample: 'samples.json gold', agreement: { n: 4, agree: 2, raw_agreement: 0.5, x_labelled: 2, y_labelled: 3 } });
  });
});
