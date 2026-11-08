// Scoreboard entry: one per run on docs/scoreboard.md. An entry names where each number lives in the
// run's committed results files and holds no numbers itself; validateEntry refuses any numeric value
// except a field's unit scale.

export interface Source { file: string; path: string; scale?: number; per?: Source }

export const CELL_FIELDS = ['passes', 'scored', 'pass_rate', 'pass_ci95', 'usd_per_solved', 'usd_per_solved_ci95', 'usd_per_trial', 'wall_median_s'] as const;
export type CellField = (typeof CELL_FIELDS)[number];
export type OptionalCellField = 'usd_per_solved_interval_basis';

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
  role: 'main';
  results_pr: string;
  claim_check: { pr: string; reader: string } | null;
  task_set: { id: string; label: string; split: 'dev' | 'held-out'; public: boolean };
  tasks: Source;
  same_everywhere: Source[];
  mdd: Source;
  mdd_holm?: Source;
  family: Source & { label: string };
  secondary?: Source;
  lead_note: string;
  verdict?: { word: 'KEEP' | 'FIX-METHOD' | 'CUT-CANDIDATE'; quote: string };
  fields: Record<CellField, Source>;
  cells: EntryCell[];
  caveats: string[];
  disclosures: string[];
}

export function validateEntry(e: unknown, where: string): Entry {
  const errors: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'number' && !path.endsWith('.scale')) errors.push(`${path}: entries hold no numbers; point at a results file instead`);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(e, where);
  const x = e as Entry;
  if (x?.schema !== 'harness-evals/scoreboard-entry@1') errors.push(`${where}: schema must be harness-evals/scoreboard-entry@1`);
  for (const k of ['run_id', 'report', 'results_pr', 'lead_note'] as const) if (typeof x?.[k] !== 'string' || !x[k]) errors.push(`${where}: ${k} is required`);
  if (x?.role !== 'main') errors.push(`${where}: role must be main`);
  for (const f of CELL_FIELDS) if (!x?.fields?.[f]?.file || !x.fields[f].path) errors.push(`${where}: fields.${f} needs file and path`);
  if (!Array.isArray(x?.cells) || x.cells.length === 0) errors.push(`${where}: cells must be a non-empty list`);
  for (const c of x?.cells ?? []) for (const k of ['id', 'harness', 'version', 'model'] as const) if (typeof c[k] !== 'string' || !c[k]) errors.push(`${where}: cell ${c.id ?? '?'} needs ${k}`);
  if (!Array.isArray(x?.caveats) || !Array.isArray(x?.disclosures)) errors.push(`${where}: caveats and disclosures must be lists`);
  if (errors.length) throw new Error(errors.join('\n'));
  return x;
}
