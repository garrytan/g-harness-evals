// Every report carries a "Next time" section (the report standard, "The end of the report"): two short lists, what we'd
// change if we ran the run again and ideas to improve the eval, one "<change>, because <reason>." line per item. A report.md
// in a run folder dated 2026-11-16 or later must hold it. Reports published earlier carry it in a sibling next-time.md (or,
// when nothing pins the report, in report.md itself), and their docs/scoreboard/reports.json row names it under next_time,
// or, for a run with no row yet, docs/next-time.md links it.
//
// Value: protects=no new report merges without its Next time lessons, and every backfilled section is reachable from the
// reports index; fails_when=a report.md dated from 2026-11-16 lacks the section or an item, an item has no reason, a
// next-time.md has no row naming it, or a row's next_time holds no item; why_new=the section is new; seam=the committed
// run folders and reports.json; no_claim=whether an item is true to its run, which the claim check reads.
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportRow } from '../scripts/scoreboard/schema.ts';

const ROOT = join(import.meta.dir, '..');
const BENCH = join(ROOT, 'docs', 'benchmarks');
const REQUIRED_FROM = '2026-11-16';

/** The item lines under "## Next time", up to the next heading of level one or two; null when the section is missing. */
function nextTimeItems(text: string): string[] | null {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Next time');
  if (start < 0) return null;
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2} /.test(line)) break;
    if (line.startsWith('- ') && !/^- None recorded\.?$/.test(line.trim())) items.push(line.slice(2).trim());
  }
  return items;
}

const problemsOf = (where: string, text: string): string[] => {
  const items = nextTimeItems(text);
  if (items === null) return [`${where}: no "## Next time" section`];
  if (!items.length) return [`${where}: "## Next time" has no item`];
  return items.filter((i) => !i.includes(', because ')).map((i) => `${where}: item has no reason ("<change>, because <reason>."): ${i}`);
};

const folders = readdirSync(BENCH, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const rows = (JSON.parse(readFileSync(join(ROOT, 'docs', 'scoreboard', 'reports.json'), 'utf8')) as { reports: ReportRow[] }).reports;
// docs/next-time.md links the sections of runs with no reports.json row yet, as benchmarks/<folder>/<file>[#anchor].
const unindexed = [...readFileSync(join(ROOT, 'docs', 'next-time.md'), 'utf8').matchAll(/\]\(benchmarks\/([^/)]+)\/([^)#]+)(#[^)]*)?\)/g)].map((m) => ({ folder: m[1]!, file: m[2]! }));

describe('Next time section', () => {
  test('the parser finds items under the section and stops at the next section', () => {
    expect(nextTimeItems('# R\n\n## Why null?\n\n- not this\n')).toBeNull();
    expect(nextTimeItems('## Next time\n\n### Ideas to improve the eval\n\n- None recorded.\n\n## Deviations\n\n- no\n')).toEqual([]);
    const text = "## Next time\n\n### What we'd change if we ran this again\n\n- A, because B.\n\n### Ideas to improve the eval\n\n- C, because D.\n\n## Deviations\n\n- E\n";
    expect(nextTimeItems(text)).toEqual(['A, because B.', 'C, because D.']);
    expect(problemsOf('x', text)).toEqual([]);
    expect(problemsOf('x', '## Next time\n\n- Run more tasks.\n')).toEqual(['x: item has no reason ("<change>, because <reason>."): Run more tasks.']);
  });

  test(`every report.md in a run folder dated ${REQUIRED_FROM} or later has the section with at least one item`, () => {
    const dated = folders.filter((f) => (f.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1] ?? '') >= REQUIRED_FROM);
    const problems = dated
      .filter((f) => existsSync(join(BENCH, f, 'report.md')))
      .flatMap((f) => problemsOf(`docs/benchmarks/${f}/report.md`, readFileSync(join(BENCH, f, 'report.md'), 'utf8')));
    expect(problems).toEqual([]);
  });

  test("every next-time.md has the section with at least one item, and its folder's row names it, or docs/next-time.md does when there is no row", () => {
    const files = folders.filter((f) => existsSync(join(BENCH, f, 'next-time.md')));
    expect(files.length).toBeGreaterThan(0);
    const linked = (f: string) => {
      const row = rows.find((r) => r.folder === f);
      return row ? row.next_time === 'next-time.md' : unindexed.some((u) => u.folder === f && u.file === 'next-time.md');
    };
    const problems = files.flatMap((f) => [
      ...problemsOf(`docs/benchmarks/${f}/next-time.md`, readFileSync(join(BENCH, f, 'next-time.md'), 'utf8')),
      ...(linked(f) ? [] : [`docs/benchmarks/${f}/next-time.md: neither its reports.json row (under next_time) nor, with no row, docs/next-time.md links it`]),
    ]);
    expect(problems).toEqual([]);
  });

  test('every section docs/next-time.md links belongs to a run with no reports.json row and has at least one item', () => {
    expect(unindexed.length).toBeGreaterThan(0);
    const problems = unindexed.flatMap(({ folder, file }) => {
      if (rows.some((r) => r.folder === folder)) return [`docs/next-time.md: ${folder} has a reports.json row, so its next_time field links the section instead`];
      const path = join(BENCH, folder, file);
      if (!existsSync(path)) return [`docs/next-time.md: docs/benchmarks/${folder}/${file} is missing`];
      return problemsOf(`docs/benchmarks/${folder}/${file}`, readFileSync(path, 'utf8'));
    });
    expect(problems).toEqual([]);
  });

  test("every row's next_time points at a Next time section with at least one item", () => {
    const named = rows.filter((r) => r.next_time);
    expect(named.length).toBeGreaterThan(0);
    const problems = named.flatMap((r) => {
      const path = join(BENCH, r.folder, r.next_time!.split('#')[0]!);
      if (!existsSync(path)) return [`reports.json: ${r.folder}: ${r.next_time} is missing`];
      return problemsOf(`docs/benchmarks/${r.folder}/${r.next_time}`, readFileSync(path, 'utf8'));
    });
    expect(problems).toEqual([]);
  });
});
