#!/usr/bin/env bun
// Cursor's usage export, attributed to trials: the cost line of a Cursor cell (harnesses/cursor/README.md, "Cost").
// Cursor cells run without the metering proxy, so their spend comes from the account's own usage export (dashboard,
// Usage, export CSV). Each row is attributed to the trial whose window (started_at to ended_at in trials.jsonl, widened
// by --slack-seconds at both ends) holds its date; a row in no window, or in two, is reported apart and never guessed.
// The output is a per-cell total, labelled unreconciled: no proxy record exists to check it against.
//
//   bun scripts/cursor/usage-export.ts --csv <export.csv> --header
//   bun scripts/cursor/usage-export.ts --csv <export.csv> --columns <columns.json> --trials <trials.jsonl> [--trials ...]
//       [--out <file>] [--slack-seconds 0]
//
// Cursor's public docs do not list the export's columns, so none is written here. The script reads the header at run
// time. --header prints it, one name per line. --columns names a file written from the first real export:
//   { "header": [every column name, exactly as exported], "date": "<column>", "cost": "<column>", "model": "<column>",
//     "source": "<which export, read when>" }
// An export whose header has a column the file does not list, or lacks one it lists, stops the script with exit 2 (it
// fails closed on unknown columns), as do a date that does not parse and a cost that is not a dollar amount (a plan that
// shows "Included" has no per-call price). Rows whose model is neither pin.json's model_id nor its init_model_name
// (case-insensitive) are counted per cell as foreign_model_rows. Exit 0 otherwise, the JSON on stdout or in --out.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class ExportError extends Error {}

export interface Columns { header: string[]; date: string; cost: string; model: string; source?: string }

/** RFC 4180 rows: quoted fields with doubled quotes, commas and newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export function readHeader(text: string): string[] {
  const [header] = parseCsv(text.replace(/^\uFEFF/, ''));
  if (!header) throw new ExportError('the export is empty');
  return header.map((h) => h.trim());
}

export function readColumns(json: string): Columns {
  const c = JSON.parse(json) as Partial<Columns>;
  if (!Array.isArray(c.header) || !c.header.length || !c.header.every((h) => typeof h === 'string')) throw new ExportError('the columns file has no header list');
  for (const role of ['date', 'cost', 'model'] as const) if (typeof c[role] !== 'string' || !c.header.includes(c[role]!)) throw new ExportError('the columns file names no ' + role + ' column from its header list');
  return c as Columns;
}

export interface UsageRow { at: number; date: string; model: string; usd: number }

export function readExport(text: string, columns: Columns): UsageRow[] {
  const cols = readHeader(text);
  const body = parseCsv(text.replace(/^\uFEFF/, '')).slice(1);
  const missing = columns.header.filter((c) => !cols.includes(c));
  const unknown = cols.filter((c) => !columns.header.includes(c));
  if (missing.length || unknown.length) throw new ExportError('the export header does not match the columns file: ' + [missing.length ? 'missing ' + missing.join(', ') : '', unknown.length ? 'unknown ' + unknown.join(', ') : ''].filter(Boolean).join('; ') + '. Got ' + cols.join(', ') + '. Check the export before changing the columns file');
  const at = (r: string[], c: string) => (r[cols.indexOf(c)] ?? '').trim();
  return body.map((r, i) => {
    const n = i + 2;
    if (r.length !== cols.length) throw new ExportError('row ' + n + ' has ' + r.length + ' fields, the header ' + cols.length);
    const date = at(r, columns.date);
    const t = Date.parse(date);
    if (!Number.isFinite(t)) throw new ExportError('row ' + n + ': ' + columns.date + ' ' + JSON.stringify(date) + ' does not parse as a time');
    const cost = at(r, columns.cost);
    if (!/^\$?\d+(\.\d+)?$/.test(cost)) throw new ExportError('row ' + n + ': ' + columns.cost + ' is ' + JSON.stringify(cost) + ', not a dollar amount (an "Included" row has no per-call price; the harness needs usage-based pricing at list price)');
    return { at: t, date, model: at(r, columns.model), usd: Number(cost.replace('$', '')) };
  });
}

export interface TrialWindow { trial_id: string; cell: string; harness: string; started_at: string; ended_at: string }

interface Sum { rows: number; usd: number }
const empty = (): Sum => ({ rows: 0, usd: 0 });
const add = (s: Sum, r: UsageRow) => { s.rows++; s.usd += r.usd; };
const round = <T extends Sum>(s: T) => ({ ...s, usd: Math.round(s.usd * 1e6) / 1e6 });

/** The model names a Cursor cell's rows may carry: pin.json's model_id and init_model_name, both from Cursor's docs. */
export function cellModelNames(root = join(import.meta.dir, '..', '..')): string[] {
  const m = (JSON.parse(readFileSync(join(root, 'harnesses', 'cursor', 'pin.json'), 'utf8')) as { model_cursor: { model_id: string; init_model_name: string } }).model_cursor;
  return [m.model_id, m.init_model_name].map((s) => s.toLowerCase());
}

export function attribute(rows: UsageRow[], trials: TrialWindow[], slackS = 0, models = cellModelNames()) {
  const windows = trials.filter((t) => t.harness === 'cursor').map((t) => ({ t, from: Date.parse(t.started_at) - slackS * 1000, to: Date.parse(t.ended_at) + slackS * 1000 }));
  const byTrial = new Map<string, Sum>(), byCell = new Map<string, Sum & { trials: number; foreign_model_rows: number }>();
  for (const w of windows) {
    byTrial.set(w.t.trial_id, empty());
    if (!byCell.has(w.t.cell)) byCell.set(w.t.cell, { ...empty(), trials: 0, foreign_model_rows: 0 });
    byCell.get(w.t.cell)!.trials++;
  }
  const unattributed = empty(), ambiguous = empty();
  for (const r of rows) {
    const hits = windows.filter((w) => r.at >= w.from && r.at <= w.to);
    if (!hits.length) { add(unattributed, r); continue; }
    if (hits.length > 1) { add(ambiguous, r); continue; }
    const w = hits[0]!;
    add(byTrial.get(w.t.trial_id)!, r);
    const cell = byCell.get(w.t.cell)!;
    add(cell, r);
    if (!models.includes(r.model.toLowerCase())) cell.foreign_model_rows++;
  }
  return {
    source: 'Cursor usage export (dashboard CSV), attributed by trial time window; unreconciled: no metering-proxy record exists for Cursor cells',
    slack_seconds: slackS, export_rows: rows.length,
    cells: Object.fromEntries([...byCell].map(([k, v]) => [k, round(v)])),
    trials: Object.fromEntries([...byTrial].map(([k, v]) => [k, round(v)])),
    unattributed: round(unattributed), ambiguous: round(ambiguous),
  };
}

export function main(argv: string[]): number {
  const all = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]!] : []));
  const csv = all('--csv')[0], columnsFile = all('--columns')[0], trialsFiles = all('--trials'), out = all('--out')[0], slack = Number(all('--slack-seconds')[0] ?? 0);
  const usage = 'usage: bun scripts/cursor/usage-export.ts --csv <export.csv> --header | --csv <export.csv> --columns <columns.json> --trials <trials.jsonl> [--trials ...] [--out <file>] [--slack-seconds 0]';
  try {
    if (csv && argv.includes('--header')) { for (const h of readHeader(readFileSync(csv, 'utf8'))) console.log(h); return 0; }
    if (!csv || !trialsFiles.length || !Number.isFinite(slack) || slack < 0) { console.error(usage); return 2; }
    if (!columnsFile) throw new ExportError('no --columns file: Cursor\'s docs list no usage-export columns, so the columns come from the first real export (--header prints them); the header read here is ' + readHeader(readFileSync(csv, 'utf8')).join(', '));
    const rows = readExport(readFileSync(csv, 'utf8'), readColumns(readFileSync(columnsFile, 'utf8')));
    const trials = trialsFiles.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialWindow));
    const json = JSON.stringify(attribute(rows, trials, slack), null, 1) + '\n';
    if (out) writeFileSync(out, json); else process.stdout.write(json);
    return 0;
  } catch (e) {
    if (e instanceof ExportError) { console.error('usage-export (cursor): ' + e.message); return 2; }
    throw e;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
