/**
 * The eval-loop practices every new preregistration states, and the two lines a new run's results carry.
 *
 * The org's eval-loop practices page lists twelve habits; CI enforces four of them in the plan (items 1, 3, 5 and 6)
 * and one in the results (item 12). A preregistration registered in docs/benchmarks/preregistrations.json or
 * preregistrations.d/ is read as text, by these headings and fields (docs/methodology.md item 16 has a copyable block):
 *
 * - `## Eval loop` declares `- Size:` (`counted run` or `quick look`), `- Paid budget: $<n>` (model calls through
 *   the metering proxy) and `- Model judge:` (`none`, or the judge model).
 * - A quick look (R112) is at most $100 paid and carries the three-line plan as `- Question:`, `- Decision:` and
 *   `- Stop rule:` fields in the same section. Nothing else is required of it.
 * - A counted run needs `## What the result changes` with at least two outcome bullets (R97); `## Pilot` with a table
 *   of `Arm`, `Arm budget` and `Pilot cap` (each cap above $0 and at most a tenth of its arm's budget, the arm budgets
 *   adding up to no more than the paid budget) and the fields `- Part under test ran:`, `- Tasks can be supplied:` and,
 *   with a model judge, `- Judge passes R78:` (R111); with a model judge, `## Judge check` with a table of `Arm`,
 *   `Labelled outputs` and `Kappa bar` that has a row for every pilot arm, at least 40 labelled outputs in all and a
 *   bar of at least 0.6 (R78); and above $500 paid, `## Interim look` with `- Look at: <n> of <N> units` at half the
 *   units and `- Stop bounds:` (R113).
 *
 * A Markdown field reads `- Name: value` or `- **Name:** value`. An empty value, or one that still holds a template
 * placeholder such as `<n>`, counts as missing. HTML comments and fenced code blocks are ignored.
 *
 * Results, for a run folder whose every registered experiment is new: report.md, once it exists, carries
 * `- **Settled:** <the ship-or-kill call this result settled, or none>`, and the private repository's
 * spend-internal.md beside it carries `- **Paid spend:** $<n>` and `- **Meter spend:** $<n>`. The public export drops
 * spend-internal.md, so the public check (`spend: false`) reads only report.md.
 *
 * A registered experiment whose preregistration is not Markdown (a shard's prereg-harbor JSON) is covered by the
 * Markdown preregistration registered from the same folder, and fails when there is none.
 *
 * Experiments registered before this check landed are exempt by a grandfather list,
 * runner/prereg/practices-grandfathered.json, never by date: their preregistrations are frozen or counted. The list is
 * pinned by its sha256 below, so it can't grow to wave a new plan through.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ManifestEntry } from './prereg.ts';

export const GRANDFATHERED_PATH = 'runner/prereg/practices-grandfathered.json';
export const GRANDFATHERED_SHA256 = 'd796f85b3340a685e3ef68dcb3f96236f6abd2f6c6e16637a33e8a0adcacb3bb';

const QUICK_LOOK_MAX_USD = 100;
const INTERIM_LOOK_ABOVE_USD = 500;
const MIN_LABELLED = 40;
const MIN_KAPPA = 0.6;

export interface PracticeProblem {
  id: string;
  file: string;
  problem: string;
}

export interface PracticesResult {
  grandfathered: number;
  checked: number;
  problems: PracticeProblem[];
}

const clean = (text: string) => text.replace(/<!--[\s\S]*?-->/g, '').replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');

/** Level-2 sections by lowercased heading, each holding its lines up to the next level-2 heading. */
function sections(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of clean(text).split('\n')) {
    const h = /^## +(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      current = [];
      out.set(h[1]!.toLowerCase(), current);
    } else current?.push(line);
  }
  return out;
}

const present = (value: string | undefined): value is string => value !== undefined && value.trim() !== '' && !/<[^>]*>/.test(value);

/** `- Name: value` and `- **Name:** value` list items, by lowercased name; the first of a name wins. */
function fields(lines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of lines) {
    const m = /^\s*[-*] +(?:\*\*([^*]+?):\*\*|\*\*([^*]+?)\*\*:|([^:*|]+?):)\s*(.*)$/.exec(line);
    const name = (m?.[1] ?? m?.[2] ?? m?.[3])?.trim().toLowerCase();
    if (name && !out.has(name)) out.set(name, m![4]!.trim());
  }
  return out;
}

const bullets = (lines: string[]) => lines.filter(line => /^[-*] +\S/.test(line) && present(line.replace(/^[-*] +/, '')));

function dollars(value: string | undefined): number | null {
  const m = present(value) ? /\$\s*(\d[\d,]*(?:\.\d+)?)\s*([a-z]*)/i.exec(value) : null;
  if (!m || /^(k|m|b|bn|thousand|million|billion)$/i.test(m[2]!)) return null;
  return Number(m[1]!.replace(/,/g, ''));
}

function number(value: string | undefined): number | null {
  const text = present(value) ? value.trim().replace(/,/g, '') : '';
  return /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? Number(text) : null;
}

/** The first Markdown table in the lines: rows keyed by lowercased header cell. */
function table(lines: string[]): Array<Map<string, string>> {
  const start = lines.findIndex(line => line.trim().startsWith('|'));
  if (start < 0) return [];
  const block: string[] = [];
  for (const line of lines.slice(start)) {
    if (!line.trim().startsWith('|')) break;
    block.push(line);
  }
  const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim().replace(/\*\*/g, ''));
  const header = cells(block[0]!).map(c => c.toLowerCase());
  return block.slice(1).filter(line => !/^\|?[\s:|-]+$/.test(line.trim())).map(line => new Map(cells(line).map((c, i) => [header[i] ?? '', c])));
}

/** Problems with one Markdown preregistration's eval-loop practices; empty when it states them all. */
export function planProblems(text: string): string[] {
  const s = sections(text);
  const loop = s.get('eval loop');
  if (!loop) return ['no "## Eval loop" section declaring Size (counted run or quick look), Paid budget and Model judge'];
  const f = fields(loop);
  const problems: string[] = [];
  const size = f.get('size') ?? '';
  const budget = dollars(f.get('paid budget'));
  if (budget === null) problems.push('"## Eval loop" has no "Paid budget: $<n>" field');
  if (/^quick look\b/i.test(size)) {
    if (budget !== null && budget > QUICK_LOOK_MAX_USD) problems.push(`a quick look is at most $${QUICK_LOOK_MAX_USD} paid (R112); this one plans $${budget}, so it is a counted run`);
    for (const field of ['question', 'decision', 'stop rule']) if (!present(f.get(field))) problems.push(`a quick look's three-line plan has no "${field[0]!.toUpperCase() + field.slice(1)}:" field in "## Eval loop" (R112)`);
    return problems;
  }
  if (!/^counted run\b/i.test(size)) problems.push('"## Eval loop" Size must be "counted run" or "quick look"');
  const judgeField = f.get('model judge');
  if (!present(judgeField)) problems.push('"## Eval loop" has no "Model judge:" field ("none", or the judge model)');
  const judge = present(judgeField) && !/^(none|no)\b/i.test(judgeField);

  if (bullets(s.get('what the result changes') ?? []).length < 2) {
    problems.push('no "## What the result changes" section with a bullet for each way the result could come out, at least two (R97)');
  }

  const pilot = s.get('pilot');
  const arms: string[] = [];
  if (!pilot) problems.push('no "## Pilot" section: a pilot per arm, capped at a tenth of that arm\'s budget (R111)');
  else {
    const rows = table(pilot).filter(r => r.has('arm') && r.has('arm budget') && r.has('pilot cap'));
    if (!rows.length) problems.push('"## Pilot" has no table with Arm, Arm budget and Pilot cap columns, one row per arm (R111)');
    let total = 0;
    for (const row of rows) {
      const arm = row.get('arm')!;
      const armBudget = dollars(row.get('arm budget'));
      const cap = dollars(row.get('pilot cap'));
      if (!present(arm) || armBudget === null || cap === null) {
        problems.push(`"## Pilot" row "${arm}" needs an arm name, an Arm budget in dollars and a Pilot cap in dollars (R111)`);
        continue;
      }
      arms.push(arm);
      total += armBudget;
      if (cap <= 0 || cap * 10 > armBudget + 1e-9) problems.push(`"## Pilot" arm "${arm}": the pilot cap $${cap} must be above $0 and at most a tenth of the arm's $${armBudget} budget (R111)`);
    }
    if (budget !== null && total > budget + 1e-9) problems.push(`"## Pilot" arm budgets add up to $${total}, more than the $${budget} paid budget`);
    const pf = fields(pilot);
    const shows = ['part under test ran', 'tasks can be supplied', ...(judge ? ['judge passes R78'] : [])];
    for (const label of shows) if (!present(pf.get(label.toLowerCase()))) problems.push(`"## Pilot" does not say how the pilot shows "${label}" (a "${label[0]!.toUpperCase() + label.slice(1)}:" field) (R111)`);
  }

  if (judge) {
    const check = s.get('judge check');
    if (!check) problems.push('a model judge is used but there is no "## Judge check" section, read per arm (R78)');
    else {
      const rows = table(check).filter(r => r.has('arm') && r.has('labelled outputs') && r.has('kappa bar'));
      if (!rows.length) problems.push('"## Judge check" has no table with Arm, Labelled outputs and Kappa bar columns, one row per arm (R78)');
      else {
        const named = new Set(rows.map(r => r.get('arm')!.toLowerCase()));
        for (const arm of arms) if (!named.has(arm.toLowerCase())) problems.push(`"## Judge check" has no row for arm "${arm}": the judge is read per arm, not pooled (R78)`);
        for (const r of rows) {
          const n = number(r.get('labelled outputs'));
          if (n === null || n <= 0) problems.push(`"## Judge check" arm "${r.get('arm')}" plans no labelled outputs of its own: the judge is read per arm, not pooled (R78)`);
        }
        const labelled = rows.reduce((n, r) => n + Math.max(number(r.get('labelled outputs')) ?? 0, 0), 0);
        if (labelled < MIN_LABELLED) problems.push(`"## Judge check" plans ${labelled} labelled outputs; R78 needs at least ${MIN_LABELLED}`);
        for (const r of rows) {
          const kappa = number(r.get('kappa bar'));
          if (kappa === null || kappa < MIN_KAPPA) problems.push(`"## Judge check" arm "${r.get('arm')}": the kappa bar must be at least ${MIN_KAPPA} (R78)`);
        }
      }
    }
  }

  if (budget !== null && budget > INTERIM_LOOK_ABOVE_USD) {
    const look = s.get('interim look');
    if (!look) problems.push(`the plan is above $${INTERIM_LOOK_ABOVE_USD} paid but has no "## Interim look" section: one look at half the units, with stop bounds (R113)`);
    else {
      const lf = fields(look);
      const at = present(lf.get('look at')) ? /^(\d{1,3}(?:,\d{3})+|\d+) +of +(\d{1,3}(?:,\d{3})+|\d+)(?![\d,])/.exec(lf.get('look at')!) : null;
      const [n, total] = at ? [Number(at[1]!.replace(/,/g, '')), Number(at[2]!.replace(/,/g, ''))] : [0, 0];
      const half = total > 0 && [Math.floor(total / 2), Math.ceil(total / 2)].includes(n);
      if (!half) problems.push('"## Interim look" needs "Look at: <n> of <N> units" with n half of N (R113)');
      if (!present(lf.get('stop bounds'))) problems.push('"## Interim look" has no "Stop bounds:" field (R113)');
    }
  }
  return problems;
}

/** Problems with a new run's results: the Settled line in report.md and, with spend, the cost lines in spend-internal.md. */
export function resultsProblems(folder: string, cwd: string, spend: boolean): PracticeProblem[] {
  const report = join(folder, 'report.md');
  if (!existsSync(join(cwd, report))) return [];
  const out: PracticeProblem[] = [];
  const id = folder;
  if (!present(fields(clean(readFileSync(join(cwd, report), 'utf8')).split('\n')).get('settled'))) {
    out.push({ id, file: report, problem: 'no "- **Settled:**" line naming the ship-or-kill call this result settled, or "none"' });
  }
  if (!spend) return out;
  const file = join(folder, 'spend-internal.md');
  if (!existsSync(join(cwd, file))) return [...out, { id, file, problem: 'missing: a run with a report keeps its paid and meter spend here' }];
  const f = fields(clean(readFileSync(join(cwd, file), 'utf8')).split('\n'));
  for (const name of ['Paid spend', 'Meter spend']) if (dollars(f.get(name.toLowerCase())) === null) out.push({ id, file, problem: `no "- **${name}:** $<n>" line` });
  return out;
}

export function readGrandfathered(cwd = process.cwd()): Set<string> {
  const bytes = readFileSync(join(cwd, GRANDFATHERED_PATH));
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== GRANDFATHERED_SHA256) {
    throw new Error(`${GRANDFATHERED_PATH} has sha256 ${sha}, not the pinned ${GRANDFATHERED_SHA256}. The grandfather list is frozen: a new preregistration states the eval-loop practices instead of joining it.`);
  }
  return new Set((JSON.parse(bytes.toString('utf8')) as { experiments: string[] }).experiments);
}

export function checkPractices(entries: ManifestEntry[], cwd = process.cwd(), opts: { spend: boolean; grandfathered?: Set<string> }): PracticesResult {
  const old = opts.grandfathered ?? readGrandfathered(cwd);
  const isMd = (e: ManifestEntry) => e.preregistration.endsWith('.md');
  const folderOf = (e: ManifestEntry) => dirname(e.preregistration);
  const oldFolders = new Set(entries.filter(e => old.has(e.id)).map(folderOf));
  const fresh = entries.filter(e => !old.has(e.id));
  const problems: PracticeProblem[] = [];
  for (const e of fresh) {
    if (!isMd(e)) {
      const plans = entries.filter(p => isMd(p) && folderOf(p) === folderOf(e));
      if (!plans.length) problems.push({ id: e.id, file: e.preregistration, problem: `no Markdown preregistration is registered from ${folderOf(e)}, so nothing states this experiment's eval-loop practices` });
      continue;
    }
    if (!existsSync(join(cwd, e.preregistration))) {
      problems.push({ id: e.id, file: e.preregistration, problem: 'the preregistration is missing' });
      continue;
    }
    for (const problem of planProblems(readFileSync(join(cwd, e.preregistration), 'utf8'))) problems.push({ id: e.id, file: e.preregistration, problem });
  }
  const folders = [...new Set(fresh.filter(isMd).map(folderOf))].filter(f => !oldFolders.has(f)).sort();
  for (const folder of folders) problems.push(...resultsProblems(folder, cwd, opts.spend));
  return { grandfathered: entries.length - fresh.length, checked: fresh.length, problems };
}
