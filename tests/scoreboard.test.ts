import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  benchmarkFolders, buildAll, buildTable, callFor, callPhrase, costCallFor, getPath, loadEntries, modelLines, perTaskCosts, rankingStart, rankRows, ratioOf, readResults, renderPage, renderRankingBlock, renderReadme, renderReportsIndex, sameEverywhere, usd, withoutUnindexed,
  RANKING_END, type Comparison, type PairRatio, type Row,
} from '../scripts/scoreboard/build.ts';
import { NO_RESULTS } from '../scripts/scoreboard/build.ts';
import { USE_CASES, validateEntry, validateReports, type ReportRow } from '../scripts/scoreboard/schema.ts';
import type { TrialRecord } from '../runner/contracts.ts';

const root = join(import.meta.dir, '..');
const readJson = readResults(root) as (p: string) => any;

describe('scoreboard', () => {
  const { page, readme, reportsIndex, tables } = buildAll(root);

  test('docs/scoreboard.md, docs/reports-index.md and any README block match the committed data (run bun scripts/scoreboard/build.ts)', () => {
    expect(readFileSync(join(root, 'docs/scoreboard.md'), 'utf8')).toBe(page);
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe(readme);
    expect(withoutUnindexed(readFileSync(join(root, 'docs/reports-index.md'), 'utf8'))).toBe(withoutUnindexed(reportsIndex));
  });

  const readmeText = readFileSync(join(root, 'README.md'), 'utf8');
  const blocks = () => [...readmeText.matchAll(/<!-- ranking:([a-z0-9-]+):([^():]+?) \(generated[^\n]*-->\n([\s\S]*?)<!-- ranking:end -->/g)];

  test("each README ranking row's pass, cost and time cells match its harness and model on the generated scoreboard page", () => {
    const rows: Record<string, number> = {};
    for (const [, runId, model, body] of blocks()) {
      const tableStart = page.indexOf('| Harness | Version | Model | Pass rate', page.indexOf(`(${runId}, `));
      expect(tableStart).toBeGreaterThan(-1);
      const pageRows = new Map(page.slice(tableStart, page.indexOf('\n\n', tableStart)).split('\n').map((l) => l.split('|').map((c) => c.trim())).map((c) => [`${c[1]} / ${c[3]}`, c]));
      expect(body!.startsWith(`**${model}**\n`)).toBe(true);
      for (const line of body!.split('\n').filter((l) => /^\| \d/.test(l))) {
        const [, , harness, , cost, pass, time] = line.split('|').map((c) => c.trim());
        const row = pageRows.get(`${harness} / ${model}`);
        expect(row).toBeDefined();
        expect([pass, cost, time]).toEqual([row![4], row![6], row![8]]);
        rows[runId!] = (rows[runId!] ?? 0) + 1;
      }
    }
    expect(rows).toEqual({ 'frontier-harness-2026-11': 8, 'matrix-mu-2026-11': 7, 'frontier-shootout-2026-11-tb': 33 });
  });

  test('the README has exactly one generated ranking table per main entry and model', () => {
    const shootout = ['Claude Fable 5.2', 'Claude Opus 5.5', 'DeepSeek V4.1 Flash 1017', 'GLM 5.3 on Novita fp8 host', 'GPT-6 Astra', 'GPT-6.1 Sol', 'Gemini 4 Carbon', 'Gemini 4 Hydrogen', 'Grok 4.7', 'Kimi K3.1 Pro', 'Muse Wonder'].map((m) => `frontier-shootout-2026-11-tb:${m}`);
    expect(blocks().map(([, r, m]) => `${r}:${m}`).sort()).toEqual(['frontier-harness-2026-11:GPT-6.1 Sol', 'frontier-harness-2026-11:Opus 5.5', ...shootout, 'matrix-mu-2026-11:GPT-6.1 Sol', 'matrix-mu-2026-11:Opus 5.5'].sort());
  });

  test('a model with one cell has nothing to rank, so it needs no README table', () => {
    const fresh = tables.find((x) => x.entry.run_id === 'frontier-shootout-2026-11-fresh')!;
    expect(fresh.entry.role).toBe('main');
    expect(new Set(fresh.entry.cells.map((c) => c.model)).size).toBe(fresh.entry.cells.length);
    expect(readmeText).not.toContain('<!-- ranking:frontier-shootout-2026-11-fresh:');
  });

  test('a hand-edited rank is rewritten, and a Rank table outside the markers, a missing, repeated or unclosed table, or a run with no main entry is refused', () => {
    const edited = readmeText.replace('| 4 | OpenClaw |', '| 1 | OpenClaw |');
    expect(edited).not.toBe(readmeText);
    expect(renderReadme(edited, tables)).toBe(readmeText);
    expect(() => renderReadme(`${readmeText}\n| Rank | Harness |\n|---|---|\n| 1 | Pi |\n`, tables)).toThrow(/a Rank table outside the generated ranking markers/);
    const [, runId, model] = blocks()[0]!;
    const first = readmeText.indexOf(rankingStart(runId!, model!));
    const end = readmeText.indexOf(RANKING_END, first) + RANKING_END.length;
    expect(() => renderReadme(readmeText.slice(0, first) + readmeText.slice(end), tables)).toThrow(new RegExp(`no ranking table for ${runId}:${model}`));
    expect(() => renderReadme(`${readmeText}\n${readmeText.slice(first, end)}\n`, tables)).toThrow(/a second ranking table/);
    expect(() => renderReadme(readmeText.replace(RANKING_END, '<!-- ranking:stop -->'), tables)).toThrow(/has no <!-- ranking:end --> before the next marker/);
    expect(() => renderReadme(`${readmeText}\n${rankingStart('waterfall-frontier-2026-11', 'Opus 5.5')}\n${RANKING_END}\n`, tables)).toThrow(/not a main scoreboard entry/);
  });

  test('rank counts only the rows clearly cheaper than this one, so ties are not transitive and ranks can skip', () => {
    const row = (id: string, usd: number | null) => ({ id, harness: id, model: 'm', usd_per_solved: usd }) as unknown as Row;
    const pair = (a: string, b: string, lo: number, hi: number): PairRatio => ({ a, b, tasks: 20, ratio: (lo + hi) / 2, ci95: [lo, hi], note: null });
    const pairs = [pair('A', 'B', 0.9, 1.3), pair('B', 'C', 0.95, 1.4), pair('A', 'C', 1.1, 1.6)];
    const ranked = rankRows([row('C', 0.3), row('A', 0.2), row('B', 0.22)], pairs);
    expect(ranked.map((r) => [r.row.id, r.rank, r.cheapest])).toEqual([['A', 1, true], ['B', 1, false], ['C', 2, false]]);
    expect(ranked[2]!.vs_cheapest!.ci95).toEqual([1.1, 1.6]);
    expect(ratioOf(pairs, 'A', 'C')!.ci95).toEqual([1 / 1.6, 1 / 1.1]);
    expect(rankRows([row('A', 0.2), row('B', 0.21), row('C', 0.5)], [pair('A', 'B', 0.9, 1.1), pair('A', 'C', 2, 3), pair('B', 'C', 2, 3)]).map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(rankRows([row('A', 0.2), row('B', null)], [{ a: 'A', b: 'B', tasks: 20, ratio: null, ci95: null, note: 'a side has no solve or no spend on the paired tasks' }]).map((r) => r.rank)).toEqual([1, null]);
  });

  test('a reversed ratio whose range reaches zero spend has no ratio instead of Infinity, and a cell with no trial records is refused', () => {
    expect(ratioOf([{ a: 'A', b: 'B', tasks: 5, ratio: 0, ci95: [0, 0.5], note: null }], 'A', 'B')).toEqual({ a: 'B', b: 'A', tasks: 5, ratio: null, ci95: null, note: 'one side spent nothing on some paired tasks, so the reversed ratio is undefined' });
    expect(ratioOf([{ a: 'A', b: 'B', tasks: 5, ratio: 0.4, ci95: [0, 0.9], note: null }], 'A', 'B')!.ratio).toBeNull();
    const rec = (cell: string) => ({ trial_id: `${cell}/t/a1`, cell, task: 't', grade: 'pass', usage: { usd: 1 } }) as unknown as TrialRecord;
    expect(() => perTaskCosts([{ id: 'X' }, { id: 'Y' }], [rec('X')], new Set(), [])).toThrow(/no trial record for Y/);
    const infra = { trial_id: 'X/t/a2', cell: 'X', task: 't', termination: 'infra_error', grade: 'n/a', usage: { usd: 1 } } as unknown as TrialRecord;
    expect(perTaskCosts([{ id: 'X' }], [rec('X'), infra], new Set(['X/t/a1', 'X/t/a2']), []).X!.t).toEqual({ usd: 2, solves: 0, scored: 2 });
  });

  test('the four README rank sets are the ones the computed rule gives', () => {
    const ranks = Object.fromEntries(blocks().filter(([, r]) => r === 'frontier-harness-2026-11' || r === 'matrix-mu-2026-11').map(([, r, m, body]) => [`${r}:${m}`, body!.split('\n').filter((l) => /^\| \d/.test(l)).map((l) => l.split('|').map((c) => c.trim())).map((c) => `${c[2]} ${c[1]}`)]));
    expect(ranks).toEqual({
      'frontier-harness-2026-11:Opus 5.5': ['Pi 1', 'Claude Code 1', 'OpenClaw 3†', 'Hermes Agent 3'],
      'frontier-harness-2026-11:GPT-6.1 Sol': ['Pi 1', 'Codex 2', 'Hermes Agent 3', 'OpenClaw 4'],
      'matrix-mu-2026-11:Opus 5.5': ['QM (Pi loop) 1', 'Claude Code 1', 'Hermes Agent 2', 'OpenClaw 4'],
      'matrix-mu-2026-11:GPT-6.1 Sol': ['Codex 1', 'OpenClaw 1', 'Hermes Agent 3'],
    });
  });

  test('a ratio with no range prints its reason and never makes a row clearly cheaper', () => {
    const t = structuredClone(tables.find((x) => x.entry.run_id === 'frontier-harness-2026-11')!);
    const p = t.pairs.find((q) => [q.a, q.b].sort().join() === ['sol-codex', 'sol-pi'].join())!;
    p.ci95 = null;
    p.note = 'one paired task: no interval';
    const block = renderRankingBlock(t, 'GPT-6.1 Sol');
    expect(block).toContain('| 1 | Codex | 1.35x (no range: one paired task: no interval)‡ |');
  });

  test('paired_cost.trials may list several files, each inside the run folder, but not beside a correction', () => {
    const many = structuredClone(matrixMu());
    many.paired_cost!.trials = ['results/a/trials.jsonl', 'results/b/trials.jsonl'];
    delete many.paired_cost!.correction;
    expect(() => validateEntry(many, 'fixture')).not.toThrow();
    many.paired_cost!.trials = ['results/a/trials.jsonl', '../b/trials.jsonl'];
    expect(() => validateEntry(many, 'fixture')).toThrow(/paired_cost.trials must name/);
    many.paired_cost!.trials = [];
    expect(() => validateEntry(many, 'fixture')).toThrow(/paired_cost.trials must name/);
    const corrected = structuredClone(frontierHarness());
    corrected.paired_cost!.trials = ['results/merged/trials.jsonl'];
    expect(() => validateEntry(corrected, 'fixture')).toThrow(/paired_cost.correction needs a single trials file/);
  });

  test('a family naming a cell the entry does not list is refused', () => {
    const e = structuredClone(loadEntries(root).find((x) => x.run_id === 'frontier-shootout-2026-11-tb')!);
    e.cells = e.cells.filter((c) => c.id !== 'opus-pi');
    expect(() => buildTable(e, readJson)).toThrow(/vs opus-pi in .* names a cell the entry does not list/);
  });

  test('paired_cost files must stay inside the run folder', () => {
    for (const trials of ['/etc/passwd', '../other/trials.jsonl', '']) {
      const bad = structuredClone(matrixMu());
      bad.paired_cost!.trials = trials;
      expect(() => validateEntry(bad, 'fixture')).toThrow(/paired_cost.trials must name the run's trial records file, inside the run folder/);
    }
  });

  test("on Opus, where the 2026-11-09 correction found no reservation charge, the paired cost ratios reproduce the frontier run's three published home-pair ratios exactly", () => {
    const t = tables.find((x) => x.entry.run_id === 'frontier-harness-2026-11')!;
    const published = (readJson('docs/benchmarks/2026-11-07-frontier-harness/results/analysis/analysis.json').pairs as { cell: string; home: string; cost_per_solve_ratio: { tasks: number; ratio: number; ci95: [number, number] } }[]).filter((p) => p.cell.startsWith('opus-'));
    expect(published.length).toBe(3);
    const r4 = (x: number) => Number(x.toFixed(4));
    for (const p of published) {
      const mine = ratioOf(t.pairs, p.cell, p.home)!;
      expect([mine.tasks, r4(mine.ratio!), mine.ci95!.map(r4)]).toEqual([p.cost_per_solve_ratio.tasks, p.cost_per_solve_ratio.ratio, p.cost_per_solve_ratio.ci95]);
    }
  });

  test('the matrix-mu entry renders, with each disclosure line it names copied onto the page', () => {
    const entry = validateEntry(readJson('docs/scoreboard/entries/matrix-mu-2026-11.json'), 'matrix-mu-2026-11.json');
    expect(tables.map((t) => t.entry.run_id)).toContain(entry.run_id);
    const { lines } = readJson('docs/scoreboard/disclosures.json') as { lines: Record<string, string> };
    expect(entry.disclosures.length).toBeGreaterThan(0);
    for (const s of entry.disclosures) {
      expect(lines[s]).toBeDefined();
      expect(page).toContain(lines[s]!);
    }
  });

  test('the frontier-harness entry renders, with each disclosure line it names copied onto the page', () => {
    const entry = validateEntry(readJson('docs/scoreboard/entries/frontier-harness-2026-11.json'), 'frontier-harness-2026-11.json');
    expect(tables.map((t) => t.entry.run_id)).toContain(entry.run_id);
    const { lines } = readJson('docs/scoreboard/disclosures.json') as { lines: Record<string, string> };
    expect(entry.disclosures.length).toBeGreaterThan(0);
    for (const s of entry.disclosures) {
      expect(lines[s]).toBeDefined();
      expect(page).toContain(lines[s]!);
    }
  });

  const matrixMu = () => loadEntries(root).find((e) => e.run_id === 'matrix-mu-2026-11')!;
  const frontierHarness = () => loadEntries(root).find((e) => e.run_id === 'frontier-harness-2026-11')!;
  const editedJson = (edit: (path: string, doc: Record<string, any>) => void) => (p: string) => {
    const doc = structuredClone(readJson(p));
    edit(p, doc);
    return doc;
  };

  const withWords = (verdictOf: (cell: string) => string) => editedJson((p, doc) => {
    if (p.endsWith('matrix-analysis.json')) for (const c of doc.cells) c.call = verdictOf(c.id);
  });
  const matrixMuWithWords = () => {
    const e = matrixMu();
    e.family = { ...e.family, verdict: { file: 'results/matrix-analysis.json', path: 'cells[id={cell}].call' }, words: { 'within-15': 'within 15 points', inconclusive: "can't tell apart" } };
    return e;
  };

  test('a family can read each comparison\'s verdict from the analysis and map it to a glossary call word', () => {
    const t = buildTable(matrixMuWithWords(), withWords(() => 'within-15'));
    const pair = (getPath(readJson('docs/benchmarks/2026-11-04-matrix-mu/results/matrix-analysis.json'), 'primary.comparisons') as Comparison[])[0]!;
    expect(t.rows.find((r) => r.id === pair.a)!.call).toContain('within 15 points of');
    expect(t.rows.find((r) => r.id === pair.b)!.call).toContain('at most 15 points ahead of');
    expect(t.model_lines.join(' ')).toContain('within 15 points');
  });

  test('an analysis verdict with no mapped call word fails the build, and a mapped word outside the glossary is refused', () => {
    expect(() => buildTable(matrixMuWithWords(), withWords(() => 'saturated'))).toThrow(/verdict "saturated" has no call word in family.words/);
    const bad = matrixMuWithWords();
    bad.family.words = { 'within-15': 'within-15' };
    expect(() => validateEntry(bad, 'fixture')).toThrow(/family.words.within-15 is "within-15", not a call word/);
  });

  test('a featured subject with no disclosure line is refused', () => {
    expect(() => renderPage(tables, {})).toThrow(/no disclosure line/);
  });

  test('an entry whose cells feature a subject it does not disclose is refused', () => {
    const e = matrixMu();
    e.disclosures = e.disclosures.filter((s) => s !== 'Hermes');
    expect(() => buildTable(e, readJson)).toThrow(/disclosures must list Hermes/);
  });

  test('an empty detectable-difference list is refused', () => {
    const read = editedJson((p, doc) => { if (p.endsWith('report-extras.json')) doc.primary = []; });
    expect(() => buildTable(matrixMu(), read)).toThrow(/non-empty list/);
  });

  const costEdit = (passes: number | null, cost: 'keep' | 'null', interval: 'keep' | 'null') => editedJson((p, doc) => {
    if (p.startsWith('docs/scoreboard/paired-cost/')) return;
    const cell = doc.cells.find((c: { id: string }) => c.id === 'codex-sol-none-mu-v03-dev');
    if (p.endsWith('matrix-analysis.json')) {
      if (passes !== null) cell.pass_rate.passes = passes;
      if (cost === 'null') cell.cost.usd_per_pass = null;
    }
    if (p.endsWith('report-extras.json') && interval === 'null') cell.ci95 = null;
  });

  test('a cell with no passes renders "no solved tasks" instead of failing', () => {
    const t = buildTable(matrixMu(), costEdit(0, 'null', 'null'));
    expect(renderPage([t], readJson('docs/scoreboard/disclosures.json').lines)).toContain('| Codex | 0.165.0 | GPT-6.1 Sol | 71.3% [51.2%, 90.0%] | 0 / 80 | no solved tasks |');
  });

  test('a cost without its interval, or an interval without its cost, fails the build', () => {
    expect(() => buildTable(matrixMu(), costEdit(null, 'keep', 'null'))).toThrow(/without its 95% range, or the reverse/);
    expect(() => buildTable(matrixMu(), costEdit(null, 'null', 'keep'))).toThrow(/without its 95% range, or the reverse/);
  });

  test('"no solved tasks" needs zero passes, and zero passes needs no cost', () => {
    expect(() => buildTable(matrixMu(), costEdit(null, 'null', 'null'))).toThrow(/has 57 passes, so its cost per solved task must be a number/);
    expect(() => buildTable(matrixMu(), costEdit(0, 'keep', 'keep'))).toThrow(/has 0 passes, so its cost per solved task must be null/);
  });

  test('cost per trial is the whole spend over the trials recorded, timed-out charges included', () => {
    const t = tables.find((x) => x.entry.run_id === 'matrix-mu-2026-11')!;
    const id = 'openclaw-sol-none-mu-v03-dev';
    const cell = (readJson('docs/benchmarks/2026-11-04-matrix-mu/results/matrix-analysis.json').cells as { id: string; cost: { usd_total: number }; trials: { recorded: number } }[]).find((c) => c.id === id)!;
    expect(t.rows.find((r) => r.id === id)!.usd_per_trial).toBeCloseTo(cell.cost.usd_total / cell.trials.recorded, 9);
  });

  test('an entry holding a number is refused', () => {
    const [e] = loadEntries(root);
    const bad = structuredClone(e!) as unknown as Record<string, unknown>;
    (bad.task_set as Record<string, unknown>).n_tasks = 20;
    expect(() => validateEntry(bad, 'fixture')).toThrow(/entries hold no numbers/);
  });

  test('every rendered call equals the verdict field of its preregistered family', () => {
    for (const t of tables.filter((x) => x.entry.family.kind !== 'cost_per_trial')) {
      const base = dirname(t.entry.report);
      const { a: aKey = 'a', b: bKey = 'b', verdict_key: verdictKey = 'verdict', verdict: verdictSrc, words } = t.entry.family;
      const raw = getPath(readJson(join(base, t.entry.family.file)), t.entry.family.path) as Record<string, string>[];
      const id = (c: Record<string, string>, key: string) => (key.includes('{') ? key.replace(/\{([^}]+)\}/g, (_, p: string) => String(getPath(c, p))) : c[key]!);
      const family = raw.map((c) => {
        const v = verdictSrc ? getPath(readJson(join(base, verdictSrc.file)), verdictSrc.path.replaceAll('{cell}', id(c, aKey))) as string : c[verdictKey]!;
        return { a: id(c, aKey), b: id(c, bKey), verdict: words ? words[v]! : v };
      });
      const modelOf = new Map(t.entry.cells.map((c) => [c.id, c.model]));
      const harnessOf = new Map(t.entry.cells.map((c) => [c.id, c.harness]));
      const [groupOf, nameOf] = t.entry.family.between === 'models' ? [harnessOf, modelOf] : [modelOf, harnessOf];
      const sameModel = family.filter((c) => groupOf.get(c.a) === groupOf.get(c.b));
      expect(sameModel.length).toBeGreaterThan(0);
      for (const c of sameModel) {
        const verdict = c.verdict;
        expect(verdict).toBeDefined();
        const rowA = t.rows.find((r) => r.id === c.a)!;
        const rowB = t.rows.find((r) => r.id === c.b)!;
        expect(rowA.call).toContain(callPhrase(verdict, 'a'));
        expect(rowB.call).toContain(callPhrase(verdict, 'b'));
        expect(rowA.call).toContain(nameOf.get(c.b)!);
        expect(rowB.call).toContain(nameOf.get(c.a)!);
      }
      const pairsInLines = t.model_lines.reduce((n, l) => n + Number(/(\d+) preregistered pairs/.exec(l)?.[1] ?? 0), 0);
      expect(pairsInLines).toBe(sameModel.length);
    }
  });

  test('each verdict word on the page is quoted word for word from its report', () => {
    for (const t of tables) if (t.entry.verdict) expect(readFileSync(join(root, t.entry.report), 'utf8')).toContain(t.entry.verdict.quote);
  });

  test('no appendix-grade model (Sonnet, Haiku, luna) appears in a main table', () => {
    for (const t of tables) for (const r of t.rows) expect(r.model).not.toMatch(/haiku|sonnet|luna/i);
  });

  test('every page number reads from the file the entry names', () => {
    const t = tables.find((x) => x.entry.run_id === 'matrix-mu-2026-11')!;
    const cc = t.rows.find((r) => r.id === 'claude-code-opus-none-mu-v03-dev')!;
    const analysis = readJson('docs/benchmarks/2026-11-04-matrix-mu/results/matrix-analysis.json');
    const cell = (analysis.cells as { id: string; pass_rate: { estimate: number }; cost: { usd_per_pass: number } }[]).find((c) => c.id === cc.id)!;
    expect(cc.pass_rate).toBe(cell.pass_rate.estimate);
    expect(cc.usd_per_solved).toBe(cell.cost.usd_per_pass);
    expect(page).toContain(`| Claude Code | 2.1.312 | Opus 5.5 | 76.3% [57.5%, 92.5%] | 61 / 80 |`);
  });
const waterfall = () => tables.find((x) => x.entry.run_id === 'waterfall-frontier-2026-11')!;

  test('every cost call says what its contrast\'s 95% range says, from both sides', () => {
    for (const t of tables.filter((x) => x.entry.family.kind === 'cost_per_trial')) {
      const contrasts = getPath(readJson(join(dirname(t.entry.report), t.entry.family.file)), t.entry.family.path) as Record<string, unknown>[];
      const harnessOf = new Map(t.entry.cells.map((c) => [c.id, c.harness]));
      expect(contrasts.length).toBeGreaterThan(0);
      for (const c of contrasts) {
        const [lo, hi] = getPath(c, t.entry.family.interval!) as [number, number];
        const rowA = t.rows.find((r) => r.id === c.a)!;
        const rowB = t.rows.find((r) => r.id === c.b)!;
        const [forB, forA] = hi < 0 ? ['cheaper per trial than', 'costs more per trial than'] : lo > 0 ? ['costs more per trial than', 'cheaper per trial than'] : ["cost per trial: can't tell apart from", "cost per trial: can't tell apart from"];
        expect(rowB.call).toMatch(new RegExp(`${forB} [^;]*${harnessOf.get(String(c.a))!.replace(/[()]/g, '\\$&')}`));
        expect(rowA.call).toMatch(new RegExp(`${forA} [^;]*${harnessOf.get(String(c.b))!.replace(/[()]/g, '\\$&')}`));
      }
    }
  });

  test('the waterfall rows match the per-cell table in its report after rounding', () => {
    const t = waterfall();
    const report = readFileSync(join(root, t.entry.report), 'utf8');
    const extras = readJson(join(dirname(t.entry.report), 'results/report-extras.json')).cells as { cell: string; shard: string }[];
    const r2 = (x: string) => usd(Number(x), 2);
    for (const r of t.rows) {
      const shard = extras.find((c) => c.cell === r.id)!.shard;
      const line = report.split('\n').find((l) => l.includes(`(\`${shard}\`) |`))!;
      const [, passes, rate, , perTrial, perPass, , wall] = line.split('|').slice(1).map((s) => s.trim());
      const [cost, lo, hi] = perPass!.match(/[\d.]+/g)!;
      const wallMedian = wall!.split(' ')[0];
      expect(`${r.passes}`).toBe(passes!);
      expect(`${(r.pass_rate * 100).toFixed(1)}% [${(r.pass_ci95[0] * 100).toFixed(1)}%, ${(r.pass_ci95[1] * 100).toFixed(1)}%]`).toBe(rate!);
      expect(usd(r.usd_per_trial, 3)).toBe(usd(Number(perTrial!.slice(1)), 3));
      expect(`${usd(r.usd_per_solved!)} [${usd(r.usd_per_solved_ci95![0])}, ${usd(r.usd_per_solved_ci95![1])}]`).toBe(`${r2(cost!)} [${r2(lo!)}, ${r2(hi!)}]`);
      expect(r.wall_median_s.toFixed(1)).toBe(wallMedian!);
    }
  });

  test('other runs show on the page under their task set\'s main table and never in the README', () => {
    const t = waterfall();
    expect(t.entry.role).toBe('other');
    expect(page.indexOf('### Same tasks, other runs')).toBeGreaterThan(page.indexOf('## 20 public v0.3 multi-user dev tasks'));
    expect(page).toContain(`**Receipts, ${t.entry.run_id}:**`);
    expect(readme).not.toContain(t.entry.run_id);
    expect(() => renderReadme(`${readme}\n${rankingStart(t.entry.run_id, 'Opus 5.5')}\n${RANKING_END}\n`, tables)).toThrow(/not a main scoreboard entry/);
  });

  test('an other entry with no main entry on its task set is refused', () => {
    const t = structuredClone(waterfall());
    t.entry.task_set.id = 'nowhere';
    expect(() => renderPage([t], readJson('docs/scoreboard/disclosures.json').lines)).toThrow(/no main entry has task set nowhere/);
  });

  test('a main entry needs tasks, mdd and paired_cost, and counts same_everywhere from its per-task table when it names no source; an other entry needs none', () => {
    const bad = structuredClone(matrixMu()) as unknown as Record<string, unknown>;
    delete bad.mdd;
    expect(() => validateEntry(bad, 'fixture')).toThrow(/a main entry needs mdd/);
    const noPaired = structuredClone(matrixMu()) as unknown as Record<string, unknown>;
    delete noPaired.paired_cost;
    expect(() => validateEntry(noPaired, 'fixture')).toThrow(/a main entry needs paired_cost/);
    const noSame = structuredClone(matrixMu()) as unknown as Record<string, unknown>;
    delete noSame.same_everywhere;
    expect(() => validateEntry(noSame, 'fixture')).not.toThrow();
    const other = readJson('docs/scoreboard/entries/waterfall-frontier-2026-11.json');
    expect(other.tasks).toBeUndefined();
    expect(() => validateEntry(other, 'fixture')).not.toThrow();
  });

  test('the matrix-mu lead note quotes its report', () => {
    const e = matrixMu();
    expect(readFileSync(join(root, e.report), 'utf8')).toContain(e.lead_note.replace(/ \(descriptive, no test\)\.$/, '.'));
  });

  test("the README's own Disclosures section carries every featured subject's line", () => {
    const { lines } = readJson('docs/scoreboard/disclosures.json') as { lines: Record<string, string> };
    const text = readFileSync(join(root, 'README.md'), 'utf8');
    const start = text.indexOf('\n## Disclosures\n');
    expect(start).toBeGreaterThan(0);
    const next = text.indexOf('\n## ', start + 1);
    const section = text.slice(start, next < 0 ? undefined : next);
    const featured = new Set(tables.filter((t) => t.entry.role === 'main').flatMap((t) => t.entry.disclosures));
    expect(featured.size).toBeGreaterThan(0);
    for (const s of featured) {
      const shortOpenClaw = s === 'OpenClaw' && section.includes(lines.OpenAI!) && section.includes(lines.OpenClaw!.replace(` ${lines.OpenAI!.replace(/^Disclosure: /, '')}`, ''));
      expect(section.includes(lines[s]!) || shortOpenClaw).toBe(true);
    }
  });
});

describe('use cases', () => {
  const { page, tables } = buildAll(root);
  const lines = () => readJson('docs/scoreboard/disclosures.json').lines as Record<string, string>;
  const headings = (text: string) => text.split('\n').filter((l) => /^#{2,4} /.test(l));

  test('the page has one heading per use case, in order, and each task set sits under its own use case', () => {
    const h = headings(page);
    const at = USE_CASES.map(([, title]) => h.indexOf(`## ${title}`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const t of tables.filter((x) => x.entry.role === 'main')) {
      const i = h.findIndex((l) => l.startsWith(`### ${t.entry.task_set.label} (${t.entry.run_id},`));
      const owner = USE_CASES.map(([id, title]) => ({ id, at: h.indexOf(`## ${title}`) })).filter((u) => u.at < i).pop()!;
      expect(owner.id).toBe(t.entry.use_case);
    }
  });

  test('the existing entries are company brain, and a use case with no entries says so in one line', () => {
    expect(tables.map((t) => [t.entry.run_id, t.entry.use_case]).filter(([id]) => id === 'matrix-mu-2026-11' || id === 'waterfall-frontier-2026-11')).toEqual([
      ['matrix-mu-2026-11', 'company-brain'], ['waterfall-frontier-2026-11', 'company-brain'],
    ]);
    const company = tables.filter((t) => t.entry.use_case === 'company-brain');
    const only = renderPage(company, lines());
    expect(only).toContain(`## Codegen\n\n${NO_RESULTS}\n\n## Personal brain\n\n${NO_RESULTS}\n\n## Company brain\n\n### `);
    expect(only.split(NO_RESULTS).length - 1).toBe(2);
  });

  test('a moved entry moves its section, and its other runs follow it', () => {
    const moved = tables.map((t) => ({ ...t, entry: { ...t.entry, use_case: 'personal-brain' as const } }));
    const out = renderPage(moved, lines());
    expect(out.indexOf('### 20 public v0.3 multi-user dev tasks')).toBeGreaterThan(out.indexOf('## Personal brain'));
    expect(out.indexOf('### 20 public v0.3 multi-user dev tasks')).toBeLessThan(out.indexOf('## Company brain'));
    expect(out.indexOf('#### Same tasks, other runs')).toBeLessThan(out.indexOf('## Company brain'));
    expect(out).toContain(`## Company brain\n\n${NO_RESULTS}`);
  });

  test('an other entry on a main entry\'s task set must share its use case', () => {
    const split = tables.map((t) => (t.entry.role === 'other' ? { ...t, entry: { ...t.entry, use_case: 'codegen' as const } } : t));
    expect(() => renderPage(split, lines())).toThrow(/waterfall-frontier-2026-11: use case codegen differs from matrix-mu-2026-11's company-brain/);
  });

  test('use_case is required and must be one of the three', () => {
    const e = readJson('docs/scoreboard/entries/matrix-mu-2026-11.json');
    delete e.use_case;
    expect(() => validateEntry(e, 'fixture')).toThrow(/use_case must be one of codegen, personal-brain, company-brain/);
    e.use_case = 'coding';
    expect(() => validateEntry(e, 'fixture')).toThrow(/use_case must be one of/);
  });

  test("can't-run pairs render as one line under the section, and a bad list is refused", () => {
    expect(page).toContain("**Can't run:** Claude Code with GPT-6.1 Sol (the CLI speaks only Anthropic's Messages API); Codex with Opus 5.5 (Codex speaks only OpenAI's Responses API, which Anthropic does not serve).\n\n**Caveats:**");
    const t = tables.find((x) => x.entry.run_id === 'matrix-mu-2026-11')!;
    const none = { ...t, entry: { ...t.entry, cant_run: undefined } };
    expect(renderPage([none], lines())).not.toMatch(/^\*\*Can't run[:,]/m);
    const e = readJson('docs/scoreboard/entries/matrix-mu-2026-11.json');
    e.cant_run = [{ harness: 'Codex', model: 'Opus 5.5' }];
    expect(() => validateEntry(e, 'fixture')).toThrow(/cant_run must be a list of \{ harness, model, reason \} strings/);
  });

  test("a can't-run pair naming a disclosed subject needs its disclosure", () => {
    const e = loadEntries(root).find((x) => x.run_id === 'matrix-mu-2026-11')!;
    e.cant_run = [...(e.cant_run ?? []), { harness: 'Codex', model: 'particle-1', reason: 'Particle speaks only OpenAI Chat Completions' }];
    expect(() => buildTable(e, readJson)).toThrow(/disclosures must list Particle/);
  });
});

describe('reports index', () => {
  const doc = readJson('docs/scoreboard/reports.json') as { reports: ReportRow[] };

  test('reports.json holds no numbers', () => {
    const numbers: string[] = [];
    const walk = (v: unknown, path: string): void => {
      if (typeof v === 'number') numbers.push(path);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(doc, 'reports.json');
    expect(numbers).toEqual([]);
    expect(() => validateReports({ ...doc, reports: [{ ...doc.reports[0]!, passes: 3 }] }, 'fixture')).toThrow(/holds no numbers/);
  });

  test('every verdict_quote is an exact substring of its report', () => {
    const quoted = doc.reports.filter((r) => r.verdict_quote !== null);
    expect(quoted.length).toBeGreaterThan(0);
    for (const r of quoted) expect(readFileSync(join(root, 'docs/benchmarks', r.folder, r.report!), 'utf8')).toContain(r.verdict_quote!);
  });

  test('a reproduce file is linked beside the report, and a bad or missing one is refused', () => {
    const page = renderReportsIndex(doc.reports, benchmarkFolders(root));
    expect(page).toContain('| [2026-10-24-m3-heldout](benchmarks/2026-10-24-m3-heldout/report.md) ([reproduce](benchmarks/2026-10-24-m3-heldout/reproduce.md)) |');
    const m3 = doc.reports.find((r) => r.folder === '2026-10-24-m3-heldout')!;
    expect(() => validateReports({ ...doc, reports: [{ ...m3, reproduce: '../x.md' }] }, 'fixture')).toThrow(/reproduce must be a \.md file name in the run folder/);
    expect(existsSync(join(root, 'docs/benchmarks', m3.folder, m3.reproduce!))).toBe(true);
  });

  test("every row's folder exists", () => {
    for (const r of doc.reports) expect(existsSync(join(root, 'docs/benchmarks', r.folder))).toBe(true);
  });

  test('a run folder with no row is listed as not yet indexed, and the check ignores that list', () => {
    const rows = doc.reports.filter((r) => r.folder !== '2026-11-04-matrix-mu');
    const folders = benchmarkFolders(root);
    const page = renderReportsIndex(rows, folders);
    expect(page).toContain('## Not yet indexed\n\nRun folders');
    expect(page).toContain('- [2026-11-04-matrix-mu](benchmarks/2026-11-04-matrix-mu/)');
    expect(withoutUnindexed(page)).toBe(withoutUnindexed(renderReportsIndex(rows, folders.filter((f) => f !== '2026-11-04-matrix-mu'))));
  });
});

describe('callFor', () => {
  const modelOf = new Map([['a', 'M'], ['b', 'M'], ['c', 'M'], ['d', 'N'], ['q', 'M']]);
  const harnessOf = new Map([['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D'], ['q', 'Q']]);
  const primary: Comparison[] = [
    { a: 'a', b: 'b', verdict: "can't tell apart", tested: true },
    { a: 'c', b: 'a', verdict: 'behind', tested: true },
    { a: 'a', b: 'd', verdict: 'behind', tested: true },
  ];
  const secondary: Comparison[] = [{ a: 'q', b: 'a', tested: null }];

  test('groups by verdict, names the other harness whichever side it is on, and skips cross-model pairs', () => {
    expect(callFor('a', modelOf, harnessOf, primary, secondary)).toBe("can't tell apart from B; ahead of C");
    expect(callFor('c', modelOf, harnessOf, primary, secondary)).toBe('behind A');
  });

  test('directional calls read a against b from a\'s row and invert on b\'s row', () => {
    const within: Comparison[] = [{ a: 'b', b: 'a', verdict: 'within 15 points', tested: true }, { a: 'c', b: 'a', verdict: 'within 15 points', tested: true }, { a: 'q', b: 'a', verdict: 'ahead', tested: true }];
    expect(callFor('b', modelOf, harnessOf, within, [])).toBe('within 15 points of A');
    expect(callFor('a', modelOf, harnessOf, within, [])).toBe('at most 15 points ahead of B, C; behind Q');
    expect(callFor('q', modelOf, harnessOf, within, [])).toBe('ahead of A');
  });

  test('a cell with only an untested secondary interval says so', () => {
    expect(callFor('q', modelOf, harnessOf, primary, secondary)).toBe('interval only, not tested (vs A)');
  });

  test('a primary pair the analysis did not test is not reported as a null', () => {
    const untested: Comparison[] = [{ a: 'a', b: 'b', verdict: "can't tell apart", tested: false }];
    expect(callFor('a', modelOf, harnessOf, untested, [])).toBe('not tested: B');
    expect(modelLines([{ id: 'a', model: 'M' }, { id: 'b', model: 'M' }], untested)).toEqual(['**M:** 1 preregistered pairs: 1 not tested.']);
  });

  test('cost calls read the interval of b minus a from each side', () => {
    const contrasts = [
      { a: 'a', b: 'b', d: { ci: [-0.2, -0.1] } },
      { a: 'c', b: 'b', d: { ci: [-0.01, 0.01] } },
      { a: 'q', b: 'b', d: { ci: [0.02, 0.06] } },
    ];
    expect(costCallFor('b', harnessOf, contrasts, 'd.ci')).toBe("cheaper per trial than A; cost per trial: can't tell apart from C; costs more per trial than Q");
    expect(costCallFor('a', harnessOf, contrasts, 'd.ci')).toBe('costs more per trial than B');
    expect(costCallFor('q', harnessOf, contrasts, 'd.ci')).toBe('cheaper per trial than B');
    expect(costCallFor('d', harnessOf, contrasts, 'd.ci')).toBe('not compared');
  });

  test('a cell with no comparison on its model says not compared', () => {
    expect(callFor('d', modelOf, harnessOf, primary, secondary)).toBe('not compared');
  });

  test('a family between models groups by harness and names the other model, and its model lines count side a only', () => {
    const models = new Map([['xa', 'X'], ['oa', 'O'], ['xb', 'X'], ['ob', 'O'], ['yb', 'Y']]);
    const harnesses = new Map([['xa', 'A'], ['oa', 'A'], ['xb', 'B'], ['ob', 'B'], ['yb', 'B']]);
    const pairs: Comparison[] = [
      { a: 'xa', b: 'oa', verdict: 'behind', tested: true },
      { a: 'xb', b: 'ob', verdict: "can't tell apart", tested: true },
      { a: 'yb', b: 'ob', verdict: 'within 10 points', tested: true },
      { a: 'xa', b: 'ob', verdict: 'behind', tested: true },
    ];
    expect(callFor('xa', models, harnesses, pairs, [], 'models')).toBe('behind O');
    expect(callFor('ob', models, harnesses, pairs, [], 'models')).toBe("can't tell apart from X; at most 10 points ahead of Y");
    const cells = [...models].map(([id, model]) => ({ id, model }));
    expect(modelLines(cells, pairs.slice(0, 3), 'models')).toEqual([
      '**X:** 2 preregistered pairs against O in the same harness: 1 behind, 1 can\'t tell apart.',
      '**Y:** 1 preregistered pairs against O in the same harness: 1 within 10 points.',
    ]);
  });

  test('same-everywhere counts tasks every cell scored and passed on every try, or failed on every try', () => {
    const t = (solves: number, scored: number) => ({ usd: 1, solves, scored });
    const costs = { a: { p: t(2, 2), f: t(0, 2), m: t(1, 2), u: t(2, 2) }, b: { p: t(3, 3), f: t(0, 1), m: t(3, 3), u: t(0, 0) } };
    expect(sameEverywhere([{ id: 'a' }, { id: 'b' }], costs)).toBe(2);
  });

  test('model lines count only same-model pairs', () => {
    expect(modelLines([{ id: 'a', model: 'M' }, { id: 'b', model: 'M' }, { id: 'c', model: 'M' }, { id: 'd', model: 'N' }], primary)).toEqual([
      "**M:** 2 preregistered pairs: 1 can't tell apart, 1 behind.",
      '**N:** no preregistered pairs.',
    ]);
  });
});

describe('getPath', () => {
  const doc = { cells: [{ id: 'x', v: { n: 1 } }, { id: 'y', v: { n: 2 } }], list: [{ m: 3 }, { m: 4 }] };
  test('selects by key, index and spread', () => {
    expect(getPath(doc, 'cells[id=y].v.n')).toBe(2);
    expect(getPath(doc, 'cells[0].id')).toBe('x');
    expect(getPath(doc, 'list[*].m')).toEqual([3, 4]);
  });
  test('spreads an object\'s values and keeps every spread item matching [?key=value] or not matching [?key!=value]', () => {
    const byKey = { 'tb/x': { calls: [{ set: 'tb', m: 'x' }] }, 'tb/y': { calls: [{ set: 'tb', m: 'y' }] }, 'f/x': { calls: [{ set: 'f', m: 'x' }] } };
    expect(getPath(byKey, '[*].calls[*][?set=tb].m')).toEqual(['x', 'y']);
    expect(getPath(byKey, '[*].calls[*][?set=tb][?m!=y].m')).toEqual(['x']);
    expect(getPath(byKey, '[*].calls[*][?set=none]')).toEqual([]);
  });
  test('refuses a missing key or an ambiguous match', () => {
    expect(() => getPath(doc, 'cells[id=z].v')).toThrow(/matched 0/);
    expect(() => getPath(doc, 'cells[0].w')).toThrow(/no key w/);
  });
});
