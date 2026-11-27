import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkFirstWowCell, c2ArmOf, otherHarness, secondImageFor, setupArgv } from '../runner/trial/first-wow-cell.ts';
import { CODING_CHECK_RULES, COUNTED_ITEMS, ITEMS, PILOT_ITEMS, sessionOneTurns } from '../scripts/c2-standing-rules/items.ts';
import { applied, approvalTargets, gbrainOps, negatedAt, normalize, partRan, s1ShowedMistake } from '../scripts/c2-standing-rules/score.ts';
import { recordKeyNames, scrubRecord, transcriptMarker } from '../runner/trial/first-wow.ts';
import { filesWritten } from '../runner/trial/c2-rules.ts';
import { c2Prereg } from '../scripts/c2-standing-rules/prereg.ts';
import { CODING_MIN_PAIRS, PLANNED_PAIRS, PRIMARY, SECONDARY, codingResults, contrast, correctionRows, decide, newcombePaired, type Rec } from '../scripts/c2-standing-rules/analyze.ts';
import type { NEvent } from '../scripts/gbrain-install/transcript.ts';

const commit = '7fdd1d09754851794ee10cb1f6a87e7a1540c70e';
const c2cell = (over: Record<string, unknown> = {}, fw: Record<string, unknown> = {}) => ({ id: 'c', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', utility_models: ['openai:gpt-6.2-sol'],
  slice: 'gbrain-first-wow', split: 'dev', repetitions: 1, ceiling: { input_tokens: 1, output_tokens: 1 }, network: 'internal', tasks: ['seed-0001'],
  first_wow: { arm: 'c2-rules', gbrain_commit: commit, gbrain_version: '0.60.778.0', suggestion_switch: true, task: 'correction', ...fw }, ...over });

describe('C2 items', () => {
  test('70 counted items (24 roles, 21 values, 25 ways of working) and 3 pilot items, ids unique', () => {
    expect(COUNTED_ITEMS).toHaveLength(70);
    expect(PILOT_ITEMS).toEqual([101, 102, 103]);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    const counted = ITEMS.filter((i) => i.id <= 70);
    expect(counted.filter((i) => i.kind === 'role')).toHaveLength(24);
    expect(counted.filter((i) => i.kind === 'value')).toHaveLength(21);
    expect(counted.filter((i) => i.kind === 'practice')).toHaveLength(25);
    for (const i of ITEMS) { expect(i.probe).toContain('out.md'); expect(i.page.slug).toMatch(/^(people|companies)\/[a-z]+-example$/); expect(i.expect.length).toBeGreaterThan(0); }
  });
  test('every item scores its own right answer as applied, and its planted mistake as not applied', () => {
    for (const i of ITEMS) {
      const right = i.expect.map((g) => g[0]).join(' and ');
      expect({ id: i.id, ok: applied(i, right).applied }).toEqual({ id: i.id, ok: true });
      expect({ id: i.id, ok: applied(i, i.wrong_fact).applied }).toEqual({ id: i.id, ok: false });
    }
  });
  test('the arms differ only in the correction suffix, and the floor sends no correction', () => {
    const i = ITEMS[0]!;
    const [q1, r] = sessionOneTurns(i, 'rules'), [q2, m] = sessionOneTurns(i, 'remember');
    expect(q1).toBe(q2);
    expect(r!.replace('Keep this as a standing rule.', '')).toBe(m!.replace('Remember this.', ''));
    expect(sessionOneTurns(i, 'floor')).toEqual([i.question]);
    expect(sessionOneTurns(i, 'control')).toEqual(sessionOneTurns(i, 'rules'));
  });
  test('30 coding-check rules, short enough to fill the section', () => {
    expect(CODING_CHECK_RULES).toHaveLength(30);
    expect(new Set(CODING_CHECK_RULES).size).toBe(30);
    // each rendered line adds "- [me] " and " (you told your agent this...)" to the text, after the section's ~190-character header
    expect(CODING_CHECK_RULES.reduce((n, r) => n + r.length + 34, 190)).toBeGreaterThan(1500);
  });
});

describe('C2 scoring', () => {
  const item = { expect: [['VP of Engineering', 'VP Engineering']], reject: ['CTO'] };
  test('expect and reject match whole words, case-insensitive, with thousands commas dropped', () => {
    expect(applied(item, 'Alice-example, vp of engineering at acme-example.').applied).toBe(true);
    expect(applied(item, 'Alice-example, VP of Engineering (CTO).').applied).toBe(false);
    expect(applied(item, 'Alice-example is our CTOX lead, VP Engineering').applied).toBe(true);
    expect(applied({ expect: [['95000']], reject: ['120000'] }, 'Budget: $95,000 a year').applied).toBe(true);
    expect(applied({ expect: [['$42']], reject: [] }, '$420 per seat').applied).toBe(false);
    expect(normalize('A  \u201cB\u201d 1,200')).toBe('a "b" 1200');
  });
  test('a reject match inside a negation window does not count; one outside it does', () => {
    expect(applied(item, 'Alice-example is VP of Engineering, not the CTO.').applied).toBe(true);
    expect(applied(item, 'Alice-example (formerly CTO) is VP of Engineering.').applied).toBe(true);
    expect(applied(item, "She isn't the CTO; she is VP of Engineering.").applied).toBe(true);
    expect(applied(item, 'Not a manager. Alice-example is VP of Engineering and the company has a big team and a CTO.').applied).toBe(false);
    expect(negatedAt('never call her the cto', 'never call her the '.length)).toBe(true);
  });
  test('an empty or missing out.md is not applied', () => {
    expect(applied(item, null)).toMatchObject({ applied: false, answered: false });
    expect(applied(item, '   ').answered).toBe(false);
  });
  test('gbrain operations come from MCP calls and from gbrain CLI commands in a shell', () => {
    const ev = (kind: NEvent['kind'], name: string, input = ''): NEvent => ({ kind, name, input, output: '', is_error: false, exit_code: null, session: 's', turn: 1 });
    expect(gbrainOps([ev('mcp', 'gbrain__recall'), ev('mcp', 'mcp__gbrain__correct'), ev('shell', 'bash', 'cd /x && gbrain remember "a" --json'), ev('mcp', 'other__correct')])).toEqual(['recall', 'correct', 'remember']);
  });
  test('part ran: the rules path needs correct, the approval and the section', () => {
    const rule = { id: 'me/a', status: 'active', revision: 'r', confirmed: false, rule: 'x' };
    const ok = partRan({ arm: 'rules', s1Ops: ['recall', 'correct'], s2Ops: ['search'], rulesAfterS1: [rule], rulesAfterApproval: [{ ...rule, confirmed: true }], sectionSeen: true });
    expect(ok).toMatchObject({ saved_with: 'correct', rule_active: true, approved: true, s2_reads: 1, rules_path_ran: true });
    expect(partRan({ arm: 'rules', s1Ops: ['correct'], s2Ops: [], rulesAfterS1: [rule], rulesAfterApproval: [{ ...rule, confirmed: true }], sectionSeen: false }).rules_path_ran).toBe(false);
    expect(partRan({ arm: 'control', s1Ops: ['correct'], s2Ops: [], rulesAfterS1: [rule], rulesAfterApproval: [{ ...rule, confirmed: true }], sectionSeen: false })).toMatchObject({ approved: true, rules_path_ran: true });
    expect(partRan({ arm: 'control', s1Ops: ['correct'], s2Ops: [], rulesAfterS1: [rule], rulesAfterApproval: [{ ...rule, confirmed: true }], sectionSeen: true }).rules_path_ran).toBe(false);
    expect(partRan({ arm: 'remember', s1Ops: ['remember'], s2Ops: [], rulesAfterS1: [], rulesAfterApproval: null, sectionSeen: false })).toMatchObject({ saved_with: 'remember', approved: null, rules_path_ran: null });
  });
});

describe('C2 cells', () => {
  test('a correction cell names the other harness\'s model in utility_models and runs task correction', () => {
    expect(() => checkFirstWowCell(c2cell())).not.toThrow();
    expect(() => checkFirstWowCell(c2cell({ harness: 'codex', model: 'openai:gpt-6.2-sol', utility_models: ['anthropic:claude-opus-5-5'] }, { arm: 'c2-remember' }))).not.toThrow();
    expect(() => checkFirstWowCell(c2cell({ utility_models: undefined }))).toThrow(/utility_models/);
    expect(() => checkFirstWowCell(c2cell({ utility_models: ['anthropic:claude-opus-5-5'] }))).toThrow(/openai model/);
    expect(() => checkFirstWowCell(c2cell({}, { task: undefined }))).toThrow(/correction/);
    expect(() => checkFirstWowCell(c2cell({}, { arm: 'defaults' }))).toThrow(/correction/);
    expect(() => checkFirstWowCell(c2cell({}, { image: 'x' }))).toThrow(/drop first_wow.image/);
    expect(c2ArmOf('c2-floor')).toBe('floor');
    expect(c2ArmOf('c2-control')).toBe('control');
    expect(() => checkFirstWowCell(c2cell({}, { claude_code_advertise: 'starter' }))).not.toThrow();
    expect(() => checkFirstWowCell(c2cell({}, { claude_code_advertise: 'full' }))).toThrow(/claude_code_advertise/);
    expect(setupArgv('claude-code', 'c2-rules', true, 'starter')).toEqual(['gbrain', 'setup', 'claude-code', '--surface', 'starter', '--advertise', 'starter', '--history', 'none', '--no-suggestion', '--json']);
    expect(setupArgv('claude-code', 'c2-rules', true)).toEqual(['gbrain', 'setup', 'claude-code', '--surface', 'starter', '--advertise', 'verbs', '--history', 'none', '--no-suggestion', '--json']);
    expect(setupArgv('codex', 'c2-rules', true, 'starter')).toEqual(setupArgv('codex', 'c2-rules', true));
    expect(c2ArmOf('defaults')).toBeNull();
    expect(otherHarness('codex')).toBe('claude-code');
    expect(secondImageFor({ harness: 'claude-code', first_wow: { arm: 'c2-rules', gbrain_commit: commit } })).toBe('harness-eval/codex-gbrain:7fdd1d097548');
    expect(setupArgv('codex', 'c2-rules', true)).toEqual(['gbrain', 'setup', 'codex', '--surface', 'full', '--history', 'none', '--no-suggestion', '--json']);
  });
  test('standing_rules goes only on a defaults coding cell with the suggestion switch', () => {
    const coding = (fw: Record<string, unknown>) => c2cell({ utility_models: undefined, tasks: ['seed-0200'] }, { arm: 'defaults', task: 'coding', standing_rules: 'on', ...fw });
    expect(() => checkFirstWowCell(coding({}))).not.toThrow();
    expect(() => checkFirstWowCell(coding({ standing_rules: 'maybe' }))).toThrow(/standing_rules/);
    expect(() => checkFirstWowCell(coding({ arm: 'full' }))).toThrow(/standing_rules/);
    expect(() => checkFirstWowCell(coding({ task: 'questions' }))).toThrow(/standing_rules/);
  });
  test('the counted and pilot preregistrations hold the planned cells and trials', () => {
    const counted = c2Prereg({ commit, version: '0.60.778.0' });
    const pilot = c2Prereg({ commit, version: '0.60.778.0', pilot: true });
    for (const p of [counted, pilot]) for (const c of p.cells) expect(() => checkFirstWowCell(c as never)).not.toThrow();
    const trials = (p: typeof counted) => p.cells.reduce((n, c) => n + (c.tasks as string[]).length, 0);
    expect(trials(counted)).toBe(6 * 70 + 4 * 15);
    expect(trials(pilot)).toBe(6 * 3 + 4 * 2);
    expect(counted.cells.map((c) => c.id)).toEqual(['cc-codex-rules', 'cc-codex-control', 'cc-codex-remember', 'codex-cc-rules', 'codex-cc-control', 'codex-cc-remember', 'cc-coding-rules-on', 'cc-coding-rules-off', 'codex-coding-rules-on', 'codex-coding-rules-off']);
    expect(counted.spend_cap_usd).toBe(148);
    expect(pilot.spend_cap_usd).toBe(12);
  });
});

describe('C2 analysis', () => {
  const rec = (cell: string, direction: string, arm: string, item: number, ok: boolean | null, termination = 'completed'): Rec => ({ trial_id: `${cell}-${item}`, cell, task: 'x', harness: 'claude-code', model: 'm', termination,
    first_wow: { direction, arm: 'c2-' + arm, item, score: ok === null ? null : { item, kind: 'role', arm, s1_mistake: true, s2: { applied: ok, answered: true, missing: [], rejected: [], negated: [] }, part: { s1_ops: [], saved_with: 'correct', rule_active: true, approved: true, section_seen: true, s2_reads: 0, rules_path_ran: true } } } });
  test('Newcombe paired interval: no difference is centred on 0, a sweep lies above 0', () => {
    const none = newcombePaired(Array.from({ length: 30 }, (_, i) => ({ a: i % 3 === 0 ? 1 : 0, b: i % 3 === 1 ? 1 : 0 })))!;
    expect(none[0]).toBeLessThan(0); expect(none[1]).toBeGreaterThan(0);
    const sweep = newcombePaired(Array.from({ length: 30 }, (_, i) => ({ a: 0, b: i < 15 ? 1 : 0 })))!;
    expect(sweep[0]).toBeGreaterThan(0.25); expect(sweep[1]).toBeLessThan(0.7);
  });
  test('pairs by item and direction, drops a pair with an unscored side, and applies the decision rules', () => {
    const recs: Rec[] = [];
    for (const d of ['cc->codex', 'codex->cc']) for (let i = 1; i <= 30; i++) {
      recs.push(rec(d + '-rules', d, 'rules', i, i <= 25));
      recs.push(rec(d + '-control', d, 'control', i, i <= 10 ? true : i === 30 ? null : false, i === 30 ? 'infra_error' : 'completed'));
      recs.push(rec(d + '-remember', d, 'remember', i, i <= 20));
    }
    const rows = correctionRows(recs);
    const pooled = contrast(rows, 'pooled', ['cc->codex', 'codex->cc'], PRIMARY)!;
    expect(pooled).toMatchObject({ test: 'rules', base: 'control', n_pairs: 58, dropped_pairs: 2 });
    expect(pooled.mcnemar).toMatchObject({ test_only: 30, base_only: 0 });
    expect(contrast(rows, 'pooled', ['cc->codex', 'codex->cc'], SECONDARY)).toMatchObject({ base: 'remember', n_pairs: 60, mcnemar: { test_only: 10, base_only: 0 } });
    const dirs = ['cc->codex', 'codex->cc'].map((d) => contrast(rows, d, [d], PRIMARY));
    const coding = [{ harness: 'claude-code', n_pairs: 15, dropped_pairs: 0, solved_on: 15, solved_off: 15, on_only: 0, off_only: 0, fails: false, section_seen_on: 15, section_seen_off: 0, treatment_failed: 0 },
      { harness: 'codex', n_pairs: 15, dropped_pairs: 0, solved_on: 14, solved_off: 15, on_only: 0, off_only: 1, fails: false, section_seen_on: 15, section_seen_off: 0, treatment_failed: 0 }];
    expect(decide(pooled, dirs, coding).decision).toBe('rule-1-turn-on');
    expect(decide(pooled, dirs, [coding[0]!, { ...coding[1]!, fails: true }]).decision).toBe('rule-5-coding-fails');
    const flat = contrast(correctionRows(recs.map((r) => ({ ...r, first_wow: { ...r.first_wow, score: r.first_wow!.score ? { ...(r.first_wow!.score as object), s2: { applied: Number((r.first_wow as { item: number }).item) % 2 === 0 } } : null } }))), 'pooled', ['cc->codex', 'codex->cc'], PRIMARY)!;
    expect(decide(flat, [flat, flat], coding).decision).toBe('rule-3-why-null');
  });
  test('natural right answers score applied, and near misses do not', () => {
    const it = (id: number) => ITEMS.find((i) => i.id === id)!;
    expect(applied(it(20), 'The pallet weighs 50 kilograms and the truck is 80 kilometres away.').applied).toBe(true);
    expect(applied(it(20), 'The pallet weighs 110 pounds (50 kilograms) and the truck is 80 km away.').applied).toBe(false);
    expect(applied(it(22), 'The support add-on costs 300 euros per year.').applied).toBe(true);
    expect(applied(it(22), 'The support add-on costs $300 per year.').applied).toBe(false);
    expect(applied(it(28), 'The data import took 6 person-days of work (8-hour days).').applied).toBe(true);
    expect(applied(it(28), 'The data import took 48 hours of work.').applied).toBe(false);
    expect(applied(it(60), 'The onboarding package costs C$800.').applied).toBe(true);
    expect(applied(it(66), 'The next invoice is due on June 3, 2027.').applied).toBe(true);
    expect(applied(it(66), 'The next invoice is due on 03/06/2027.').applied).toBe(false);
    expect(applied(it(45), 'The cyberdyne-example contract is worth $310,000 a year.').applied).toBe(true);
    expect(applied(it(36), 'Quinn-example is an Engineering Manager on the internal tools group.').applied).toBe(true);
  });
  test('session 1 showing the mistake is read only where the question asks for the planted value', () => {
    const role = ITEMS.find((i) => i.kind === 'role')!, practice = ITEMS.find((i) => i.kind === 'practice')!;
    expect(s1ShowedMistake(role, `She is the ${role.reject[0]}.`)).toBe(true);
    expect(s1ShowedMistake(role, 'I do not know.')).toBe(false);
    expect(s1ShowedMistake(practice, 'anything')).toBeNull();
  });
  test('the approval counts only when every rule it targeted is active and confirmed', () => {
    const a = { id: 'me/a', status: 'proposed', revision: 'r', confirmed: false, rule: 'x' }, b = { ...a, id: 'me/b' };
    const run = (after: typeof a[]) => partRan({ arm: 'rules', s1Ops: ['correct'], s2Ops: [], rulesAfterS1: [a, b], rulesAfterApproval: after, sectionSeen: true }).approved;
    expect(run([{ ...a, status: 'active', confirmed: true }, { ...b, status: 'active', confirmed: true }])).toBe(true);
    expect(run([{ ...a, status: 'active', confirmed: true }, b])).toBe(false);
    expect(approvalTargets([a, { ...b, status: 'active', confirmed: true }]).map((r) => r.id)).toEqual(['me/a']);
  });
  test('the record scrub removes the trial token, and a key value in the record is named', () => {
    expect(scrubRecord({ out: 'x tok-123 y', n: [1, 'tok-123'] }, 'tok-123')).toEqual({ out: 'x [trial-token-removed] y', n: [1, '[trial-token-removed]'] });
    expect(recordKeyNames({ out: 'sk-zzz' }, { OPENAI_API_KEY: 'sk-zzz', ANTHROPIC_API_KEY: undefined })).toEqual(['OPENAI_API_KEY']);
  });
  test('Newcombe matches the reference with its continuity-corrected phi', () => {
    const pairs = [...Array(2).fill({ a: 1, b: 1 }), ...Array(12).fill({ a: 1, b: 0 }), ...Array(4).fill({ a: 0, b: 1 }), ...Array(42).fill({ a: 0, b: 0 })];
    const [lo, hi] = newcombePaired(pairs)!;
    expect(hi).toBeGreaterThan(0);
    expect(hi).toBeCloseTo(0.0007, 3);
    expect(lo).toBeLessThan(-0.2);
  });
  test('a missing mate counts as a dropped pair, and an incomplete coding check blocks rule 1', () => {
    const rows = correctionRows([rec('a', 'cc->codex', 'rules', 1, true), rec('b', 'cc->codex', 'control', 2, false), rec('c', 'cc->codex', 'rules', 3, true), rec('d', 'cc->codex', 'control', 3, false)]);
    expect(contrast(rows, 'x', ['cc->codex'], PRIMARY)).toMatchObject({ n_pairs: 1, dropped_pairs: 2 });
    const recs: Rec[] = [];
    for (const d of ['cc->codex', 'codex->cc']) for (let i = 1; i <= 30; i++) { recs.push(rec(d + '-rules', d, 'rules', i, i <= 25)); recs.push(rec(d + '-control', d, 'control', i, i <= 5)); }
    const r2 = correctionRows(recs);
    const pooled = contrast(r2, 'pooled', ['cc->codex', 'codex->cc'], PRIMARY)!, dirs = ['cc->codex', 'codex->cc'].map((d) => contrast(r2, d, [d], PRIMARY));
    const full = { dropped_pairs: 0, solved_on: 15, solved_off: 15, on_only: 0, off_only: 0, fails: false, section_seen_on: 15, section_seen_off: 0, treatment_failed: 0 };
    expect(decide(pooled, dirs, [{ harness: 'claude-code', n_pairs: 15, ...full }, { harness: 'codex', n_pairs: 15, ...full }]).decision).toBe('rule-1-turn-on');
    expect(decide(pooled, dirs, [{ harness: 'claude-code', n_pairs: 15, ...full }, { harness: 'codex', n_pairs: CODING_MIN_PAIRS - 1, ...full }]).decision).toBe('rule-2-smaller-gain');
    expect(decide(pooled, dirs, [{ harness: 'claude-code', n_pairs: 0, ...full }, { harness: 'codex', n_pairs: 0, ...full }]).decision).toBe('rule-2-smaller-gain');
  });
  test('the primary contrast is also reported by item type', () => {
    const rows = correctionRows([rec('a', 'cc->codex', 'rules', 1, true), rec('b', 'cc->codex', 'control', 1, false)]);
    expect(contrast(rows.filter((r) => r.kind === 'role'), 'role', ['cc->codex'], PRIMARY)).toMatchObject({ label: 'role', n_pairs: 1, delta: 1 });
  });
  test('files session 1 wrote: outside gbrain and the harness folders, plus their instruction files, never through a link', () => {
    const home = mkdtempSync(join(tmpdir(), 'c2-files-'));
    for (const d of ['src/notes', '.gbrain', 'codex', 'claude', 'elsewhere']) mkdirSync(join(home, d), { recursive: true });
    for (const f of ['src/notes/README.md', 'src/notes/rule.md', '.gbrain/brain.json', 'codex/AGENTS.md', 'codex/state.sqlite', 'claude/CLAUDE.md', 'elsewhere/x.md']) writeFileSync(join(home, f), 'x');
    symlinkSync(join(home, 'elsewhere'), join(home, 'src/notes/link'));
    const old = new Date(1_000_000);
    for (const f of ['src/notes/README.md', 'claude/CLAUDE.md', 'elsewhere/x.md']) utimesSync(join(home, f), old, old);
    expect(filesWritten(home, 2_000_000, Date.now() + 1000)).toEqual(['codex/AGENTS.md', 'src/notes/rule.md']);
    const rows = correctionRows([{ ...rec('a', 'cc->codex', 'control', 1, true), first_wow: { ...rec('a', 'cc->codex', 'control', 1, true).first_wow, files_s1: ['src/notes/rule.md'] } }, rec('b', 'cc->codex', 'rules', 1, true)]);
    expect(rows.map((r) => r.s1_files)).toEqual([1, 0]);
  });
  test('a cap stop is a runner event: excluded as cap_stop, not as the harness model_error', () => {
    const r = { ...rec('x', 'cc->codex', 'rules', 1, null, 'model_error'), cap_stop: true };
    expect(correctionRows([r])[0]).toMatchObject({ applied: null, excluded: 'cap_stop' });
  });
  test('no decision on an incomplete run: every planned pair must be scored or listed as dropped', () => {
    const recs: Rec[] = [];
    for (const d of ['cc->codex', 'codex->cc']) for (let i = 1; i <= 3; i++) { recs.push(rec(d + '-rules', d, 'rules', i, true)); recs.push(rec(d + '-control', d, 'control', i, false)); }
    const rows = correctionRows(recs);
    const pooled = contrast(rows, 'pooled', ['cc->codex', 'codex->cc'], PRIMARY)!, dirs = ['cc->codex', 'codex->cc'].map((d) => contrast(rows, d, [d], PRIMARY));
    const full = { n_pairs: 15, dropped_pairs: 0, solved_on: 15, solved_off: 15, on_only: 0, off_only: 0, fails: false, section_seen_on: 15, section_seen_off: 0, treatment_failed: 0 };
    expect(PLANNED_PAIRS).toBe(140);
    expect(decide(pooled, dirs, [{ harness: 'claude-code', ...full }, { harness: 'codex', ...full }], PLANNED_PAIRS)).toMatchObject({ decision: 'run-incomplete' });
    expect(decide(pooled, dirs, [{ harness: 'claude-code', ...full }, { harness: 'codex', ...full }], 6).decision).toBe('rule-1-turn-on');
  });
  test('a coding pair counts only when the section loaded with the switch on and not with it off', () => {
    const c = (seed: number, state: string, seen: boolean): Rec => ({ trial_id: 'codex' + seed + state, cell: 'x', task: 't', harness: 'codex', model: 'm', termination: 'completed', first_wow: { seed, standing_rules: { state, section_seen: seen }, coding: { grade: { passed: true } } } });
    const recs = [c(0, 'on', true), c(0, 'off', false), c(1, 'on', false), c(1, 'off', false), c(2, 'on', true), c(2, 'off', true)];
    expect(codingResults(recs)[0]).toMatchObject({ n_pairs: 1, treatment_failed: 2 });
  });
  test('the transcript scan reads only regular files, never a link or a FIFO', () => {
    const state = mkdtempSync(join(tmpdir(), 'c2-scan-')), logs = mkdtempSync(join(tmpdir(), 'c2-logs-'));
    mkdirSync(join(state, 'claude', 'projects', 'p'), { recursive: true });
    writeFileSync(join(logs, 'elsewhere.jsonl'), 'Standing rules (data:');
    symlinkSync(join(logs, 'elsewhere.jsonl'), join(state, 'claude', 'projects', 'p', 'link.jsonl'));
    expect(spawnSync('mkfifo', [join(state, 'claude', 'projects', 'p', 'pipe.jsonl')]).status).toBe(0);
    expect(transcriptMarker(state, logs, 0, 'Standing rules (data:').seen).toBe(false);
    writeFileSync(join(state, 'claude', 'projects', 'p', 'real.jsonl'), 'Standing rules (data:');
    expect(transcriptMarker(state, logs, 0, 'Standing rules (data:')).toMatchObject({ seen: true, files: ['state/claude/projects/p/real.jsonl'] });
  });
  test('no counted probe names its own expected answer', () => {
    const word = (e: string) => new RegExp('(^|[^a-z0-9])' + e.replace(/[^a-z0-9 ]/gi, (ch) => '\\' + ch) + '($|[^a-z0-9])', 'i');
    for (const it of ITEMS.filter((i) => COUNTED_ITEMS.includes(i.id))) for (const group of it.expect) expect([it.id, group.some((e) => word(e).test(it.probe))]).toEqual([it.id, false]);
  });
  test('the coding check pairs on and off by harness and seed, and fails at 3 fewer solved', () => {
    const c = (h: string, seed: number, state: string, passed: boolean): Rec => ({ trial_id: `${h}${seed}${state}`, cell: 'x', task: 't', harness: h, model: 'm', termination: 'completed', first_wow: { seed, standing_rules: { state, section_seen: state === 'on' }, coding: { grade: { passed } } } });
    const recs = [0, 1, 2, 3].flatMap((s) => [c('codex', s, 'off', true), c('codex', s, 'on', s === 3)]);
    expect(codingResults(recs)[0]).toMatchObject({ harness: 'codex', n_pairs: 4, solved_on: 1, solved_off: 4, fails: true, section_seen_on: 4 });
  });
});

describe('pty-answer.py', () => {
  test('types the short code the command asks for and returns the command\'s exit code', () => {
    const dir = mkdtempSync(join(tmpdir(), 'c2-pty-'));
    const stub = join(dir, 'stub.sh');
    writeFileSync(stub, '#!/bin/sh\nprintf "Type 1b3df58d to approve this standing rule (anything else cancels): " >&2\nread a\n[ "$a" = 1b3df58d ] && echo approved && exit 0\necho declined; exit 1\n');
    chmodSync(stub, 0o755);
    const r = spawnSync('python3', [join(import.meta.dir, '..', 'scripts', 'c2-standing-rules', 'pty-answer.py'), stub], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, encoding: 'utf8', timeout: 30000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('approved');
  });
});
