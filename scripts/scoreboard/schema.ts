// Scoreboard entry: one per run on docs/scoreboard.md. An entry names where each number lives in the
// run's committed results files and holds no numbers itself; validateEntry refuses any numeric value
// except a field's unit scale.

export interface Source { file: string; path: string; scale?: number; per?: Source }

export const CELL_FIELDS = ['passes', 'scored', 'pass_rate', 'pass_ci95', 'usd_per_solved', 'usd_per_solved_ci95', 'usd_per_trial', 'wall_median_s'] as const;
export type CellField = (typeof CELL_FIELDS)[number];
export type OptionalCellField = 'usd_per_solved_interval_basis';

export const CALL_WORD = /^(can't tell apart|can't tell: no room to improve|behind|ahead|within \d+ points)$/;

export interface EntryCell {
  id: string;
  harness: string;
  version: string;
  model: string;
  caveats?: string[];
  overrides?: Partial<Record<CellField | OptionalCellField, Source>>;
}

export interface Entry {
  schema: 'harness-evals/scoreboard-entry@1';
  run_id: string;
  report: string;
  role: 'main' | 'other';
  results_pr: string;
  claim_check: { pr: string; reader: string } | null;
  task_set: { id: string; label: string; split: 'dev' | 'held-out'; public: boolean };
  tasks?: Source;
  same_everywhere?: Source[];
  mdd?: Source;
  mdd_holm?: Source;
  family: Source & { label: string; kind?: 'verdict' | 'cost_per_trial'; interval?: string; a?: string; b?: string; verdict?: Source; words?: Record<string, string> };
  secondary?: Source;
  lead_note: string;
  verdict?: { word: 'KEEP' | 'FIX-METHOD' | 'CUT-CANDIDATE'; quote: string };
  fields: Record<CellField, Source>;
  cells: EntryCell[];
  caveats: string[];
  disclosures: string[];
}

const numbersIn = (v: unknown, path: string, allowed: (path: string) => boolean = () => false): string[] => {
  if (typeof v === 'number') return allowed(path) ? [] : [path];
  if (Array.isArray(v)) return v.flatMap((x, i) => numbersIn(x, `${path}[${i}]`, allowed));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => numbersIn(x, `${path}.${k}`, allowed));
  return [];
};

export function validateEntry(e: unknown, where: string): Entry {
  const errors: string[] = numbersIn(e, where, (p) => p.endsWith('.scale')).map((p) => `${p}: entries hold no numbers; point at a results file instead`);
  const x = e as Entry;
  if (x?.schema !== 'harness-evals/scoreboard-entry@1') errors.push(`${where}: schema must be harness-evals/scoreboard-entry@1`);
  for (const k of ['run_id', 'report', 'results_pr', 'lead_note'] as const) if (typeof x?.[k] !== 'string' || !x[k]) errors.push(`${where}: ${k} is required`);
  if (x?.role !== 'main' && x?.role !== 'other') errors.push(`${where}: role must be main or other`);
  if (x?.role === 'main') for (const k of ['tasks', 'same_everywhere', 'mdd'] as const) if (!x[k]) errors.push(`${where}: a main entry needs ${k}`);
  if (x?.role === 'other' && x.verdict) errors.push(`${where}: only a main entry carries a verdict`);
  if (x?.family?.kind !== undefined && x.family.kind !== 'verdict' && x.family.kind !== 'cost_per_trial') errors.push(`${where}: family.kind must be verdict or cost_per_trial`);
  if (x?.family?.kind === 'cost_per_trial' && !x.family.interval) errors.push(`${where}: a cost_per_trial family needs interval, the path to each contrast's 95% range`);
  if (x?.family?.verdict && (!x.family.verdict.file || !x.family.verdict.path)) errors.push(`${where}: family.verdict needs file and path`);
  for (const [k, w] of Object.entries(x?.family?.words ?? {})) if (!CALL_WORD.test(w)) errors.push(`${where}: family.words.${k} is ${JSON.stringify(w)}, not a call word from docs/glossary.md`);
  for (const f of CELL_FIELDS) if (!x?.fields?.[f]?.file || !x.fields[f].path) errors.push(`${where}: fields.${f} needs file and path`);
  if (!Array.isArray(x?.cells) || x.cells.length === 0) errors.push(`${where}: cells must be a non-empty list`);
  for (const c of x?.cells ?? []) for (const k of ['id', 'harness', 'version', 'model'] as const) if (typeof c[k] !== 'string' || !c[k]) errors.push(`${where}: cell ${c.id ?? '?'} needs ${k}`);
  if (!Array.isArray(x?.caveats) || !Array.isArray(x?.disclosures)) errors.push(`${where}: caveats and disclosures must be lists`);
  if (errors.length) throw new Error(errors.join('\n'));
  return x;
}

// Reports index: one row per run folder under docs/benchmarks, rendered into docs/reports-index.md. Rows hold no numbers.
export const VERDICT_WORDS = ['KEEP', 'FIX-METHOD', 'CUT-CANDIDATE'] as const;

export interface ReportRow {
  folder: string;
  report: string | null;
  question: string;
  grade: 'frontier' | 'method' | 'appendix';
  status: string;
  claim_check: string | null;
  superseded_by: string | null;
  verdict: (typeof VERDICT_WORDS)[number] | null;
  verdict_quote: string | null;
  note?: string;
}

export function validateReports(doc: unknown, where: string): ReportRow[] {
  const errors: string[] = numbersIn(doc, where).map((p) => `${p}: the reports index holds no numbers`);
  const d = doc as { schema?: string; reports?: ReportRow[] };
  if (d?.schema !== 'harness-evals/reports-index@1') errors.push(`${where}: schema must be harness-evals/reports-index@1`);
  if (!Array.isArray(d?.reports)) errors.push(`${where}: reports must be a list`);
  for (const r of d?.reports ?? []) {
    for (const k of ['folder', 'question', 'status'] as const) if (typeof r[k] !== 'string' || !r[k]) errors.push(`${where}: ${r.folder ?? '?'} needs ${k}`);
    if (!['frontier', 'method', 'appendix'].includes(r.grade)) errors.push(`${where}: ${r.folder}: grade must be frontier, method or appendix`);
    if (r.verdict !== null && !VERDICT_WORDS.includes(r.verdict)) errors.push(`${where}: ${r.folder}: verdict must be KEEP, FIX-METHOD, CUT-CANDIDATE or null`);
    if ((r.verdict === null) !== (r.verdict_quote === null)) errors.push(`${where}: ${r.folder}: a verdict needs its verdict_quote, and a quote needs its verdict`);
    if (r.verdict_quote !== null && !r.report) errors.push(`${where}: ${r.folder}: verdict_quote needs a report`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return d.reports!;
}
