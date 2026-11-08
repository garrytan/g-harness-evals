import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildAll, buildTable, callFor, getPath, loadEntries, modelLines, renderPage, type Comparison } from '../scripts/scoreboard/build.ts';
import { validateEntry } from '../scripts/scoreboard/schema.ts';

const root = join(import.meta.dir, '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));

describe('scoreboard', () => {
  const { page, readme, tables } = buildAll(root);

  test('docs/scoreboard.md and the README block match the committed data (run bun scripts/scoreboard/build.ts)', () => {
    expect(readFileSync(join(root, 'docs/scoreboard.md'), 'utf8')).toBe(page);
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe(readme);
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

  const matrixMu = () => loadEntries(root).find((e) => e.run_id === 'matrix-mu-2026-11')!;
  const editedJson = (edit: (path: string, doc: Record<string, any>) => void) => (p: string) => {
    const doc = structuredClone(readJson(p));
    edit(p, doc);
    return doc;
  };

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

  test('a cell with no passes renders "no solved tasks" instead of failing', () => {
    const id = 'codex-sol-none-mu-v03-dev';
    const read = editedJson((p, doc) => {
      const cell = doc.cells.find((c: { id: string }) => c.id === id);
      if (p.endsWith('matrix-analysis.json')) cell.cost.usd_per_pass = null;
      if (p.endsWith('report-extras.json')) cell.ci95 = null;
    });
    const t = buildTable(matrixMu(), read);
    expect(renderPage([t], readJson('docs/scoreboard/disclosures.json').lines)).toContain('| Codex | 0.165.0 | GPT-6.1 Sol | 71.3% [51.2%, 90.0%] | 57 / 80 | no solved tasks |');
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
    for (const t of tables) {
      const base = dirname(t.entry.report);
      const family = getPath(readJson(join(base, t.entry.family.file)), t.entry.family.path) as Comparison[];
      const modelOf = new Map(t.entry.cells.map((c) => [c.id, c.model]));
      const harnessOf = new Map(t.entry.cells.map((c) => [c.id, c.harness]));
      const sameModel = family.filter((c) => modelOf.get(c.a) === modelOf.get(c.b));
      expect(sameModel.length).toBeGreaterThan(0);
      for (const c of sameModel) {
        const verdict = c.verdict!;
        const rowA = t.rows.find((r) => r.id === c.a)!;
        const rowB = t.rows.find((r) => r.id === c.b)!;
        const lead = verdict === "can't tell apart" ? "can't tell apart from" : `${verdict}:`;
        expect(rowA.call).toContain(lead);
        expect(rowB.call).toContain(lead);
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
    expect(callFor('a', modelOf, harnessOf, primary, secondary)).toBe("can't tell apart from B; behind: C");
    expect(callFor('c', modelOf, harnessOf, primary, secondary)).toBe('behind: A');
  });

  test('a cell with only an untested secondary interval says so', () => {
    expect(callFor('q', modelOf, harnessOf, primary, secondary)).toBe('interval only, not tested (vs A)');
  });

  test('a primary pair the analysis did not test is not reported as a null', () => {
    const untested: Comparison[] = [{ a: 'a', b: 'b', verdict: "can't tell apart", tested: false }];
    expect(callFor('a', modelOf, harnessOf, untested, [])).toBe('not tested: B');
    expect(modelLines([{ id: 'a', model: 'M' }, { id: 'b', model: 'M' }], untested)).toEqual(['**M:** 1 preregistered pairs: 1 not tested.']);
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
