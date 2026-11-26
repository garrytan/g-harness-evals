// gbrain time-to-first-wow eval: fixtures, scorer, verdict and the keyless dry run (scripts/gbrain-first-wow/). No model, no key.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { planProblems } from '../runner/prereg/practices.ts';
import type { NEvent } from '../scripts/gbrain-install/transcript.ts';
import { CELLS, fixtureProblems, findAnswer, messages, PLANNING_MDD, runDryRun, standInImport } from '../scripts/gbrain-first-wow/dry-run.ts';
import { buildFixture, personaFor, questionPrompt, writeFixture, NO_HISTORY_SEED_BASE, type Fixture } from '../scripts/gbrain-first-wow/fixtures.ts';
import { citedFiles, readBrainExport, scoreNoHistory, scoreTrial, splitAnswers, type Arm, type BrainPage } from '../scripts/gbrain-first-wow/score.ts';
import { contrast, contrastsFor, decide, interimCall, mddFromDiscordance, plainMatches, type ContrastResult, type Row } from '../scripts/gbrain-first-wow/verdict.ts';
import { INTERIM_SEEDS, STATED_DIFFERENCE, countedPrereg } from '../scripts/gbrain-first-wow/prereg.ts';
import { MAIN, RATES, projection } from '../scripts/gbrain-first-wow/projection.ts';
import { buildManifest, type Prereg } from '../runner/run.ts';

const ROOT = resolve(import.meta.dir, '..');
const PLAN = join(ROOT, 'docs/benchmarks/2026-11-24-gbrain-first-wow/PREREGISTRATION.md');
const ev = (kind: NEvent['kind'], name: string, input: string, output: string): NEvent => ({ kind, name, input, output, is_error: false, exit_code: 0, session: 's1', turn: 1 });
const reader = (f: Fixture) => (rel: string) => f.files.get(rel) ?? null;

function plainTrial(f: Fixture, reply: string, events: NEvent[], arm: Arm = 'plain', brain: BrainPage[] = []) {
  return scoreTrial({ manifest: f.manifest, arm, reply, events, brain, readFile: reader(f) });
}

/** A correct reply citing each answer's newest source file, and the grep events that read them. */
function goodFileAnswer(f: Fixture) {
  const qs = f.manifest.questions;
  const events = qs.map(q => ev('shell', 'Bash', 'rg -n "' + q.answer + '" ~/.claude ~/.codex', '/home/dev/' + q.source_files.at(-1) + ':3:... ' + q.answer + ' ...'));
  const reply = qs.map((q, i) => (i + 1) + '. ' + q.answer + ' (found in ~/' + q.source_files.at(-1) + ')').join('\n');
  return { reply, events };
}

describe('fixtures', () => {
  test('the same seed gives byte-identical files, and other seeds give other answers', () => {
    const a = buildFixture(4, 'history-rich', 'claude-code'), b = buildFixture(4, 'history-rich', 'claude-code'), c = buildFixture(6, 'history-rich', 'claude-code');
    expect(a.manifest.files).toEqual(b.manifest.files);
    expect(a.manifest.questions.map(q => q.answer)).not.toEqual(c.manifest.questions.map(q => q.answer));
  });
  test('sessions fall in the 28 days before the trial start, and the files carry their last message as modification time', () => {
    const now = Date.parse('2026-12-09T15:00:00Z');
    const f = buildFixture(3, 'messy', 'codex', now);
    expect(f.manifest.questions.map(q => q.answer)).toEqual(buildFixture(3, 'messy', 'codex').manifest.questions.map(q => q.answer));
    for (const s of f.manifest.sessions) {
      expect(Date.parse(s.started_at)).toBeGreaterThan(now - 28 * 86400000);
      expect(Date.parse(s.ended_at)).toBeLessThan(now);
    }
    const dir = mkdtempSync(join(tmpdir(), 'fw-mtime-'));
    writeFixture(f, join(dir, 'home'), join(dir, 'fixture.json'));
    const s = f.manifest.sessions[0]!;
    expect(statSync(join(dir, 'home', s.path)).mtimeMs).toBe(Date.parse(s.ended_at));
  });
  test('personas rotate history-rich and messy by seed, and no-history seeds are their own set', () => {
    expect([0, 1, 2, 3].map(personaFor)).toEqual(['history-rich', 'messy', 'history-rich', 'messy']);
    expect(personaFor(NO_HISTORY_SEED_BASE + 3)).toBe('no-history');
  });
  test('answers sit only in session files, and question 3 sits in the other harness', () => {
    for (const home of ['claude-code', 'codex'] as const) for (let seed = 0; seed < 40; seed++) {
      const f = buildFixture(seed, personaFor(seed), home);
      expect(fixtureProblems(f)).toEqual([]);
      const q3 = f.manifest.questions[2]!;
      expect(q3.cross_harness).toBe(true);
      expect(q3.source_harness).not.toBe(home);
      expect(q3.source_files.every(p => p.startsWith(home === 'codex' ? '.claude/' : '.codex/'))).toBe(true);
    }
  });
  test('messy fixtures plant a superseded port and a decoy for every question', () => {
    const f = buildFixture(1, 'messy', 'codex');
    const port = f.manifest.questions.find(q => q.kind === 'port')!;
    expect(port.superseded).not.toBeNull();
    expect(f.manifest.questions.every(q => q.decoys.length === 1)).toBe(true);
    expect(f.manifest.projects.length).toBe(5);
  });
  test('no-history fixtures have no sessions and no answers', () => {
    const f = buildFixture(NO_HISTORY_SEED_BASE, 'no-history', 'claude-code');
    expect(f.manifest.sessions).toEqual([]);
    expect(f.manifest.questions.every(q => q.answer === null)).toBe(true);
    expect([...f.files.keys()].every(k => k.startsWith('src/'))).toBe(true);
  });
  test('the question prompt never names gbrain, a harness, memory or a file', () => {
    for (const seed of [0, 1, NO_HISTORY_SEED_BASE]) expect(questionPrompt(buildFixture(seed, personaFor(seed), 'codex').manifest)).not.toMatch(/gbrain|brain|claude|codex|memory|\.jsonl/i);
  });
});

describe('scorer', () => {
  const f = buildFixture(2, 'history-rich', 'claude-code');
  test('a correct, cited, read answer passes all three questions', () => {
    const { reply, events } = goodFileAnswer(f);
    const s = plainTrial(f, reply, events);
    expect(s.segmented).toBe(true);
    expect(s.finish_any).toBe(true);
    expect(s.finish_strict).toBe(true);
  });
  test('a right value with no reference, or a reference no tool call read, fails', () => {
    const qs = f.manifest.questions;
    expect(plainTrial(f, qs.map((q, i) => (i + 1) + '. ' + q.answer).join('\n'), []).passed_any).toBe(0);
    const { reply } = goodFileAnswer(f);
    expect(plainTrial(f, reply, []).passed_any).toBe(0);
  });
  test('citing a file that does not hold the value fails that question', () => {
    const { reply, events } = goodFileAnswer(f);
    const other = f.manifest.sessions.find(s => !f.manifest.questions.some(q => q.source_files.includes(s.path)))!.path;
    const bad = reply.replace(f.manifest.questions[0]!.source_files.at(-1)!, other);
    const s = plainTrial(f, bad, events);
    expect(s.questions[0]!.passed_any).toBe(false);
    expect(s.passed_any).toBe(2);
  });
  test('a decoy or a superseded value alone is wrong; naming the old value beside the new one is allowed', () => {
    const m = buildFixture(1, 'messy', 'claude-code');
    const port = m.manifest.questions[1]!;
    const src = port.source_files.at(-1)!;
    const events = [ev('shell', 'Bash', 'rg staging', '/home/dev/' + src + ':9:moved ' + port.superseded + ' to ' + port.answer)];
    const one = (text: string) => plainTrial(m, '1. none\n2. ' + text + ' (~/' + src + ')\n3. none', events).questions[1]!;
    expect(one(port.answer!).passed_any).toBe(true);
    expect(one('moved from ' + port.superseded + ' to ' + port.answer).passed_any).toBe(true);
    const old = one(port.superseded!);
    expect(old.passed_any).toBe(false);
    expect(old.superseded_only).toBe(true);
    expect(one(port.answer + ' or maybe ' + port.decoys[0]).correct).toBe(false);
    expect(one(port.decoys[0] + '\n   - or ' + port.answer).correct).toBe(false);
    expect(one(port.answer + '\n   - Not ' + port.decoys[0] + ', which is the other project').passed_any).toBe(true);
  });
  test('the naive stand-in that takes the first match is caught by the messy fixtures', () => {
    let naiveWrong = 0, carefulWrong = 0;
    for (let seed = 1; seed < 40; seed += 2) {
      const m = buildFixture(seed, 'messy', 'claude-code');
      for (const q of m.manifest.questions) {
        if (findAnswer(messages(m), q, true)?.value !== q.answer) naiveWrong++;
        if (findAnswer(messages(m), q)?.value !== q.answer) carefulWrong++;
      }
    }
    expect(carefulWrong).toBe(0);
    expect(naiveWrong).toBeGreaterThan(10);
  });
  test('a gbrain page reference passes when the page holds the value and a gbrain call returned it', () => {
    const brain = standInImport(f);
    const qs = f.manifest.questions;
    const pageOf = (q: typeof qs[number]) => brain.find(p => p.text.includes(q.answer!))!;
    const reply = qs.map((q, i) => (i + 1) + '. ' + q.answer + ', from the page ' + pageOf(q).slug).join('\n');
    const events = qs.map(q => ev('mcp', 'gbrain__search', '{"query":"x"}', JSON.stringify({ results: [{ slug: pageOf(q).slug, snippet: q.answer }] })));
    const s = plainTrial(f, reply, events, 'full', brain);
    expect(s.finish_any).toBe(true);
    expect(s.finish_strict).toBe(true);
    expect(s.gbrain_calls).toBe(3);
    const viaFiles = goodFileAnswer(f);
    const g = plainTrial(f, viaFiles.reply, viaFiles.events, 'pr1', brain);
    expect(g.finish_any).toBe(true);
    expect(g.finish_strict).toBe(false);
  });
  test('a gbrain call counts for a page only when it named that page; the first-session list counts for the pages it names', () => {
    const brain = standInImport(f);
    const qs = f.manifest.questions;
    const pageOf = (q: typeof qs[number]) => brain.find(p => p.text.includes(q.answer!))!;
    const reply = qs.map((q, i) => (i + 1) + '. ' + q.answer + ', from the page ' + pageOf(q).slug).join('\n');
    const other = brain.find(p => !qs.some(q => pageOf(q).slug === p.slug))!.slug;
    const elsewhere = qs.map(q => ev('mcp', 'gbrain__search', '{"query":"x"}', JSON.stringify({ results: [{ slug: other, snippet: q.answer }] })));
    expect(plainTrial(f, reply, elsewhere, 'full', brain).questions.some(q => q.page_ref_ok)).toBe(false);
    const byInput = qs.map(q => ev('mcp', 'gbrain__get_page', JSON.stringify({ slug: pageOf(q).slug }), '# page\n' + q.answer));
    expect(plainTrial(f, reply, byInput, 'full', brain).finish_strict).toBe(true);
    const list = qs.map(q => '- "' + q.answer + '" -> ' + pageOf(q).slug).join('\n');
    const s = scoreTrial({ manifest: f.manifest, arm: 'full', reply, events: [], brain, readFile: reader(f), sessionStart: list });
    expect(s.finish_strict).toBe(true);
    expect(s.gbrain_calls).toBe(0);
    const apart = qs.map(q => '- ' + pageOf(q).slug + '\n- "' + q.answer + '"').join('\n');
    expect(scoreTrial({ manifest: f.manifest, arm: 'full', reply, events: [], brain, readFile: reader(f), sessionStart: apart }).finish_strict).toBe(false);
  });
  test('the end-state brain is read from a complete gbrain export, by file path or by a slug line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fw-export-'));
    mkdirSync(join(dir, 'conversations/codex'), { recursive: true });
    writeFileSync(join(dir, 'conversations/codex/2026-11-04-8fa83b09.md'), '# session\nport 47213\n');
    writeFileSync(join(dir, 'escaped-0001.md'), '---\nslug: "notes/odd name"\n---\nbody\n');
    expect(() => readBrainExport(dir)).toThrow(/not complete/);
    writeFileSync(join(dir, '.gbrain-export-status'), 'writing\nCOMPLETE\n');
    expect(readBrainExport(dir).map(p => p.slug)).toEqual(['conversations/codex/2026-11-04-8fa83b09', 'notes/odd name']);
  });
  test('answers split by number, in order, with bold or Q prefixes', () => {
    expect(splitAnswers('**1.** a\n**2.** b\n**3.** c')?.length).toBe(3);
    expect(splitAnswers('Q1: a\nQ2: b\nQ3: c')?.map(x => x.trim())).toEqual(['Q1: a', 'Q2: b', 'Q3: c']);
    expect(splitAnswers('1. a\n3. c')).toBeNull();
  });
  test('cited paths become HOME-relative; other absolute paths are dropped', () => {
    expect(citedFiles('see ~/.codex/sessions/a/b.jsonl, and /home/dev/src/x/README.md.', '/home/dev')).toEqual(['.codex/sessions/a/b.jsonl', 'src/x/README.md']);
    expect(citedFiles('/etc/passwd /tmp/x/y', '/home/dev')).toEqual([]);
  });
  test('no-history: abstaining passes, a made-up flag or port fails, and the fallback counts only on its marker', () => {
    const n = buildFixture(NO_HISTORY_SEED_BASE + 1, 'no-history', 'codex');
    const run = (reply: string, arm: Arm, setupOutput?: string) => scoreNoHistory({ manifest: n.manifest, arm, reply, events: [], brain: [], readFile: reader(n), setupOutput, fallbackMarkers: ['MARK'] });
    const abstain = '1. I could not find any record of that.\n2. There is no mention of a staging port.\n3. I did not find that decision.';
    expect(run(abstain, 'plain').correct_abstention).toBe(true);
    expect(run(abstain, 'plain').fallback_shown).toBeNull();
    expect(run(abstain, 'pr1', 'setup ... MARK').fallback_shown).toBe(true);
    expect(run(abstain, 'defaults', 'setup ok').fallback_shown).toBe(false);
    const made = run('1. It is ff_amber_quokka.\n2. I could not find it, maybe localhost:41234.\n3. I could not find it.', 'plain');
    expect(run('1. No record.\n2. No record; the README says v1.23456 and 2026-11-20.\n3. No record.', 'plain').fabricated).toEqual([false, false, false]);
    expect(made.fabricated.slice(0, 2)).toEqual([true, true]);
    expect(made.correct_abstention).toBe(false);
  });
});

describe('verdict', () => {
  const rows = (pairs: Array<[boolean, boolean]>): Row[] => pairs.flatMap(([a, b], seed) => [
    { harness: 'h', model: 'm', arm: 'defaults' as Arm, seed, persona: 'messy' as const, finish: a, time_ms: 100000, timed_out: false, commands: 4, person_needed: 0 },
    { harness: 'h', model: 'm', arm: 'full' as Arm, seed, persona: 'messy' as const, finish: b, time_ms: 60000, timed_out: false, commands: 3, person_needed: 0 },
  ]);
  const c = { harness: 'h', a: 'defaults' as Arm, b: 'full' as Arm, label: 'primary' };
  test('the smallest detectable difference at 30 pairs and a 30% discordance rate is about 28 points', () => {
    expect(mddFromDiscordance(0.3, 30)).toBeCloseTo(0.281, 2);
    expect(PLANNING_MDD).toBeCloseTo(0.281, 2);
    expect(mddFromDiscordance(0.3, 20)).toBeGreaterThan(0.34);
  });
  test('rule 1 needs both the stated difference and the final bound; a big early lead stops at the interim look', () => {
    const win = rows(Array.from({ length: 30 }, (_, i) => [i < 5, i < 25] as [boolean, boolean]));
    const r = contrast(win, c)!;
    expect(r.delta).toBeCloseTo(20 / 30, 5);
    expect(decide(r, 0.28)).toBe('rule-1-defaults-on');
    const half = contrast(win, c, new Set(Array.from({ length: 15 }, (_, i) => i)))!;
    expect(interimCall(half)).toBe('stop-candidate-ahead');
  });
  test('rule 3 when the interval is wholly below zero, rule 2 when it sits inside the stated difference, rule 5 otherwise', () => {
    const lose = contrast(rows(Array.from({ length: 30 }, (_, i) => [i < 20, i < 8] as [boolean, boolean])), c)!;
    expect(decide(lose, 0.28)).toBe('rule-3-keep-today');
    const tie = contrast(rows(Array.from({ length: 30 }, (_, i) => [i % 2 === 0, i % 2 === 0 ? i % 4 !== 0 : i % 6 === 1] as [boolean, boolean])), c)!;
    expect(['rule-2-why-null', 'rule-5-defaults-off-undecided']).toContain(decide(tie, 0.28));
    const flat: ContrastResult = { ...lose, delta: 0.02, ci95: [-0.1, 0.12], mcnemar: { wins: 3, losses: 2, p_two_sided: 1 } };
    expect(decide(flat, 0.28)).toBe('rule-2-why-null');
    expect(decide({ ...flat, ci95: [-0.2, 0.33] }, 0.28)).toBe('rule-5-defaults-off-undecided');
  });
  test('a gain that clears the final bound below the stated difference is rule 5, even when its interval sits inside it', () => {
    const base = contrast(rows(Array.from({ length: 30 }, (_, i) => [i < 10, i < 12] as [boolean, boolean])), c)!;
    const small: ContrastResult = { ...base, delta: 0.12, ci95: [0.06, 0.19], mcnemar: { wins: 13, losses: 1, p_two_sided: 0.00049 } };
    expect(decide(small, 0.2)).toBe('rule-5-defaults-off-undecided');
    expect(decide({ ...small, mcnemar: { wins: 8, losses: 4, p_two_sided: 0.39 }, ci95: [-0.05, 0.19] }, 0.2)).toBe('rule-2-why-null');
  });
  test('rule 4 needs the interval to hold zero, not only to start below it', () => {
    const base = contrast(rows(Array.from({ length: 30 }, (_, i) => [i < 10, i < 12] as [boolean, boolean])), c)!;
    expect(plainMatches({ ...base, delta: -0.2, ci95: [-0.3, -0.1] }, 0.2)).toBe(false);
    expect(plainMatches({ ...base, delta: 0.05, ci95: [-0.05, 0.15] }, 0.2)).toBe(true);
    expect(plainMatches({ ...base, delta: 0.25, ci95: [-0.01, 0.4] }, 0.2)).toBe(false);
  });
  test('full minus defaults is the one primary contrast of a harness with gbrain setup arms', () => {
    expect(contrastsFor('h', ['defaults', 'pr1', 'full', 'plain']).filter(x => x.label.startsWith('primary')).map(x => x.a + '>' + x.b)).toEqual(['defaults>full']);
  });
  test('the pre-pilot planning projection names a rate for every line and adds up', () => {
    for (const l of MAIN) expect(RATES[l.rate]).toBeDefined();
    const p = projection();
    expect(p.trials.main).toBe(620);
    expect([Math.round(p.all_in.low), Math.round(p.all_in.high)]).toEqual([578, 1257]);
  });
  test('the stated differences are the plan\'s Freeze table: 26 points for Claude Code and 20 for every other harness', () => {
    expect(Object.fromEntries(Object.entries(STATED_DIFFERENCE).map(([h, x]) => [h, Math.round(x * 100)]))).toEqual({
      'claude-code/claude-opus-5-5': 26, 'codex/gpt-6.2-sol': 20, 'qm/claude-opus-5-5': 20, 'qm/gpt-6.2-sol': 20, 'qm/particle-1': 20,
    });
  });
  test('excluded trials drop their pair and no-history trials never enter a contrast', () => {
    const r = rows([[true, true], [false, true], [false, false]]);
    r[2]!.excluded = 'infra_error';
    r.push({ ...r[0]!, seed: 9000, persona: 'no-history', finish: null }, { ...r[1]!, seed: 9000, persona: 'no-history', finish: null });
    const x = contrast(r, c)!;
    expect(x.n_pairs).toBe(2);
    expect(x.excluded_pairs).toBe(1);
  });
});

describe('dry run and plan', () => {
  test('the keyless dry run covers every cell and seed with no fixture problem', () => {
    const d = runDryRun(join(tmpdir(), 'fw-test-' + process.pid));
    expect(d.fixture_problems).toEqual([]);
    expect(d.trials).toBe(CELLS.reduce((n, c) => n + c.arms.length * 110, 0));
  }, 120000);
  test('the committed prereg.json is what prereg.ts writes, and the interim seeds are the first 50 verdict seeds of its trial order', () => {
    const file = JSON.parse(readFileSync(join(ROOT, 'docs/benchmarks/2026-11-24-gbrain-first-wow/prereg.json'), 'utf8'));
    const fw = (file.cells as Array<{ first_wow: { gbrain_commit?: string; gbrain_version?: string } }>).find(c => c.first_wow.gbrain_commit)!.first_wow;
    expect(file).toEqual(countedPrereg({ commit: fw.gbrain_commit!, version: fw.gbrain_version! }));
    const order: number[] = [];
    for (const t of buildManifest(file as Prereg, 'x').trials) { const s = Number(t.task.slice(5)); if (s < 100 && !order.includes(s)) order.push(s); }
    expect(order.slice(0, 50).sort((a, b) => a - b)).toEqual([...INTERIM_SEEDS]);
  });
  test('the frozen plan states every eval-loop practice, the pilot-priced projection included', () => {
    expect(planProblems(readFileSync(PLAN, 'utf8'), '2026-11-25')).toEqual([]);
  });
  test('the plan quotes internal-task\'s five decision rules word for word', () => {
    const text = readFileSync(PLAN, 'utf8');
    expect(text).toContain("(1) the candidate beats today's defaults on a harness by more than the stated difference: its defaults turn on for that harness; (2) no difference: one Why-null cycle, then KEEP, FIX-METHOD or CUT-CANDIDATE, and Garry hears any cut (R48); (3) worse on a harness: that harness keeps today's setup; (4) the plain-agent arm matches gbrain: the proof page says so; (5) the eval can't decide a harness: defaults stay off there.");
  });
});
