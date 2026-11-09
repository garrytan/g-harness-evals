import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  benchmarkFolders, buildAll, buildTable, callFor, callPhrase, costCallFor, getPath, loadEntries, modelLines, renderPage, renderReadmeBlock, renderReportsIndex, usd, withoutUnindexed, type Comparison,
} from '../scripts/scoreboard/build.ts';
import { validateEntry, validateReports, type ReportRow } from '../scripts/scoreboard/schema.ts';

const root = join(import.meta.dir, '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));

describe('scoreboard', () => {
  const { page, readme, reportsIndex, tables } = buildAll(root);

  test('docs/scoreboard.md, docs/reports-index.md and any README block match the committed data (run bun scripts/scoreboard/build.ts)', () => {
    expect(readFileSync(join(root, 'docs/scoreboard.md'), 'utf8')).toBe(page);
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe(readme);
    expect(withoutUnindexed(readFileSync(join(root, 'docs/reports-index.md'), 'utf8'))).toBe(withoutUnindexed(reportsIndex));
  });

  test("each row of the README's hand-written harness rankings matches its harness and model on the generated scoreboard page", () => {
    const text = readFileSync(join(root, 'README.md'), 'utf8');
    const start = text.indexOf('\n## Harness rankings\n');
    expect(start).toBeGreaterThan(-1);
    const section = text.slice(start, text.indexOf('\n## ', start + 1));
    const pageRowsFor = (runId: string) => {
      const tableStart = page.indexOf('| Harness | Version | Model | Pass rate', page.indexOf(`(${runId}, `));
      expect(tableStart).toBeGreaterThan(-1);
      return new Map(page.slice(tableStart, page.indexOf('\n\n', tableStart)).split('\n').map((l) => l.split('|').map((c) => c.trim())).map((c) => [`${c[1]} / ${c[3]}`, c]));
    };
    let pageRows: Map<string, string[]> | undefined;
    let model = '';
    const rows: Record<string, number> = {};
    let runId = '';
    for (const line of section.split('\n')) {
      const heading = /^### .*\(([a-z0-9-]+)\)$/.exec(line);
      if (heading) {
        runId = heading[1]!;
        pageRows = pageRowsFor(runId);
        model = '';
      }
      model = /^\*\*(.+)\*\*$/.exec(line)?.[1] ?? model;
      if (!/^\| \d/.test(line)) continue;
      const [, , harness, pass, cost, time] = line.split('|').map((c) => c.trim());
      const row = pageRows?.get(`${harness} / ${model}`);
      expect(row).toBeDefined();
      expect([pass, cost, time]).toEqual([row![4], row![6], row![8]]);
      rows[runId] = (rows[runId] ?? 0) + 1;
    }
    expect(rows).toEqual({ 'frontier-harness-2026-11': 8, 'matrix-mu-2026-11': 7 });
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
      const { a: aKey = 'a', b: bKey = 'b', verdict: verdictSrc, words } = t.entry.family;
      const raw = getPath(readJson(join(base, t.entry.family.file)), t.entry.family.path) as Record<string, string>[];
      const family = raw.map((c) => {
        const v = verdictSrc ? getPath(readJson(join(base, verdictSrc.file)), verdictSrc.path.replaceAll('{cell}', c[aKey]!)) as string : c.verdict!;
        return { a: c[aKey]!, b: c[bKey]!, verdict: words ? words[v]! : v };
      });
      const modelOf = new Map(t.entry.cells.map((c) => [c.id, c.model]));
      const harnessOf = new Map(t.entry.cells.map((c) => [c.id, c.harness]));
      const sameModel = family.filter((c) => modelOf.get(c.a) === modelOf.get(c.b));
      expect(sameModel.length).toBeGreaterThan(0);
      for (const c of sameModel) {
        const verdict = c.verdict;
        expect(verdict).toBeDefined();
        const rowA = t.rows.find((r) => r.id === c.a)!;
        const rowB = t.rows.find((r) => r.id === c.b)!;
        expect(rowA.call).toContain(callPhrase(verdict, 'a'));
        expect(rowB.call).toContain(callPhrase(verdict, 'b'));
        expect(rowA.call).toContain(harnessOf.get(c.b)!);
        expect(rowB.call).toContain(harnessOf.get(c.a)!);
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
    expect(renderReadmeBlock(tables)).not.toContain(t.entry.run_id);
  });

  test('an other entry with no main entry on its task set is refused', () => {
    const t = structuredClone(waterfall());
    t.entry.task_set.id = 'nowhere';
    expect(() => renderPage([t], readJson('docs/scoreboard/disclosures.json').lines)).toThrow(/no main entry has task set nowhere/);
  });

  test('a main entry needs tasks, same_everywhere and mdd; an other entry does not', () => {
    const bad = structuredClone(matrixMu()) as unknown as Record<string, unknown>;
    delete bad.mdd;
    expect(() => validateEntry(bad, 'fixture')).toThrow(/a main entry needs mdd/);
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
  test('refuses a missing key or an ambiguous match', () => {
    expect(() => getPath(doc, 'cells[id=z].v')).toThrow(/matched 0/);
    expect(() => getPath(doc, 'cells[0].w')).toThrow(/no key w/);
  });
});
