// Reads one review arm in gstack-evals' noloss arm contract v1 (lanes/review-noloss/README.md, "Arm contract v1", at
// gstack-evals 91d76421). gstack-evals is not a dependency of this repository, so this is a reimplementation of the parts
// merge-arms.ts and blind.ts need, kept to the same rules as the pinned contract.ts and ingest.ts:
//
// - An arm directory holds arm.json, findings/<unit>.jsonl, cost.tsv, judgments.tsv and adjudication.tsv, nothing else.
// - arm.json needs contract_version 1, id, label, suite, date and passes (1 to 20).
// - A finding line needs severity, path (string or null), line (whole number from 1, or null) and summary. Its pass
//   defaults to 1. Its id is id, else fingerprint, else #<0-based line index>, and is unique within its pass.
// - The raw severity label is label, else severity, cut at its first comma.
// - cost.tsv needs pr, scope, total_tokens and meter_source (with the contract's aliases). Blank, - or unavailable is
//   unknown.
//
// Two rules here are this repository's own, for the review rig's raw arms (gstack-evals src/trial/review/run.ts):
// - A coverage gap reads "<unit id> pass <n>: <reason>", the form the rig writes and noloss derive --drop-gaps reads.
// - A unit-pass with no all-scope row in cost.tsv did not run: the rig writes an all row for every session it ran, and
//   counts the rest as not_run without listing them as gaps.
//
// Every refusal is an ArmError: a stable code, the file it names, and what is wrong.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export class ArmError extends Error {
  constructor(readonly code: string, readonly where: string, readonly detail: string) {
    super(code + ' ' + where + ': ' + detail);
  }
}

export const ARM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
export const MAX_PASSES = 20;
const TOP = new Set(['arm.json', 'findings', 'cost.tsv', 'judgments.tsv', 'adjudication.tsv']);

export interface ArmJson {
  contract_version: number;
  id: string;
  label: string;
  suite: string;
  date: string;
  passes: number;
  suite_sha256?: string;
  provenance?: string;
  status?: string;
  coverage_gaps?: string[];
  models?: Array<{ role: string; model: string; effort?: string }>;
  severity_map?: SeverityEntry;
  [key: string]: unknown;
}

export type Mapped = 'CRITICAL' | 'INFORMATIONAL';
export interface SeverityEntry {
  default?: Record<string, Mapped>;
  by_reader?: Record<string, Record<string, Mapped>>;
}

export interface Finding {
  /** The finding's id as the contract reads it: id, else fingerprint, else #<0-based line index>. */
  id: string;
  index: number;
  pass: number;
  raw: string;
  reader: string | null;
  fields: Record<string, unknown>;
}

export const COST_NUMBERS = ['total_tokens', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'usd', 'wall_seconds', 'requests', 'refused', 'unknown_calls'] as const;
export type CostNumber = (typeof COST_NUMBERS)[number];
const COST_ALIASES: Record<string, string[]> = {
  pr: ['pr'], scope: ['scope', 'voice'], pass: ['pass'], meter_source: ['meter_source'], covers: ['covers'],
  total_tokens: ['total_tokens'], input_tokens: ['input_tokens', 'input'], output_tokens: ['output_tokens', 'output'],
  cache_read_tokens: ['cache_read_tokens', 'cache_read'], cache_write_tokens: ['cache_write_tokens', 'cache_write'],
  reasoning_tokens: ['reasoning_tokens', 'reasoning'], usd: ['usd'], wall_seconds: ['wall_seconds'],
  requests: ['requests'], refused: ['refused'], unknown_calls: ['unknown_calls'],
};

export interface CostRow {
  line: number;
  /** The pr cell as written, a unit id. */
  pr: string;
  /** The findings file name (without .jsonl) the row belongs to. */
  unit: string;
  scope: string;
  pass: number;
  meter_source: string;
  /** null is unknown; a column the file does not have is undefined. */
  values: Partial<Record<CostNumber, number | null>>;
}

export interface Gap {
  text: string;
  /** The unit as the gap names it. */
  ref: string;
  /** The findings file name (without .jsonl). */
  unit: string;
  pass: number;
  reason: string;
}

export interface Arm {
  dir: string;
  arm: ArmJson;
  armJsonSha256: string;
  costSha256: string;
  /** findings file name (without .jsonl) to sha256 of its bytes. */
  findingsSha256: Record<string, string>;
  /** findings file name (without .jsonl) to its findings, in file order. */
  findings: Map<string, Finding[]>;
  cost: CostRow[];
  costColumns: CostNumber[];
  gaps: Gap[];
}

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
/** A unit ref as a findings file name: / written __, as the rig's unitFile does. */
export const unitFile = (ref: string): string => ref.replaceAll('/', '__');
/** The raw label a severity map reads: label, else severity, cut at its first comma (contract.ts rawLabel). */
export const rawLabel = (f: Record<string, unknown>): string => String(typeof f.label === 'string' && f.label ? f.label : f.severity).split(',')[0]!.trim();
export const readerOf = (f: Record<string, unknown>): string | null => {
  const r = f.reader ?? f.specialist ?? f.voice;
  return typeof r === 'string' && r ? r : null;
};
export const unknownCell = (v: string | undefined): boolean => v === undefined || v === '' || v === '-' || /^unavailable$/i.test(v);
const GAP = /^(.+?) pass (\d+): (.*)$/s;

/** Reads and checks one raw arm. code is the caller's prefix, such as E_MERGE: refusals are <code>_SOURCE, _UNIT, _PASS, _COST and _GAP. */
export function readArm(dir: string, code: string): Arm {
  const fail = (kind: string, where: string, detail: string): never => {
    throw new ArmError(code + '_' + kind, where, detail);
  };
  const at = (name: string) => join(dir, name);
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) fail('SOURCE', dir, 'not an arm directory');
  const extra = readdirSync(dir).filter((n) => !TOP.has(n));
  if (extra.length) fail('SOURCE', at(extra.sort()[0]!), 'not part of arm contract v1, which holds arm.json, findings/, cost.tsv, judgments.tsv and adjudication.tsv only');
  if (!existsSync(at('arm.json'))) fail('SOURCE', at('arm.json'), 'missing, so this is not an arm contract v1 directory');
  const armText = readFileSync(at('arm.json'));
  let arm: ArmJson;
  try {
    arm = JSON.parse(armText.toString('utf8'));
  } catch (e) {
    return fail('SOURCE', at('arm.json'), 'not JSON: ' + (e as Error).message);
  }
  if (!arm || typeof arm !== 'object' || Array.isArray(arm)) fail('SOURCE', at('arm.json'), 'not a JSON object');
  if (arm.contract_version !== 1) fail('SOURCE', at('arm.json'), 'contract_version is ' + JSON.stringify(arm.contract_version) + ', not 1');
  for (const k of ['id', 'label', 'suite', 'date'] as const) if (typeof arm[k] !== 'string' || !arm[k]) fail('SOURCE', at('arm.json'), k + ' is missing or not text');
  if (!ARM_ID.test(arm.id)) fail('SOURCE', at('arm.json'), 'id ' + JSON.stringify(arm.id) + ' does not match ' + ARM_ID);
  if (!Number.isSafeInteger(arm.passes) || arm.passes < 1 || arm.passes > MAX_PASSES) fail('SOURCE', at('arm.json'), 'passes is ' + JSON.stringify(arm.passes) + ', not a whole number from 1 to ' + MAX_PASSES);
  if ((arm.provenance ?? 'live') !== 'live') fail('SOURCE', at('arm.json'), 'provenance is ' + JSON.stringify(arm.provenance) + '; only a live arm has findings to work on');
  for (const judged of ['judgments.tsv', 'adjudication.tsv']) if (existsSync(at(judged))) fail('SOURCE', at(judged), 'the arm is already judged; this step takes raw arms (findings and cost, no judgments)');
  if (!existsSync(at('findings')) || !lstatSync(at('findings')).isDirectory()) fail('SOURCE', at('findings'), 'missing; a live arm needs findings/<unit>.jsonl for every unit');

  const findings = new Map<string, Finding[]>();
  const findingsSha256: Record<string, string> = {};
  for (const name of readdirSync(at('findings')).sort()) {
    const path = join(dir, 'findings', name);
    if (!name.endsWith('.jsonl') || !lstatSync(path).isFile()) fail('SOURCE', path, 'not a findings/<unit>.jsonl file');
    const unit = name.slice(0, -'.jsonl'.length);
    const bytes = readFileSync(path);
    findingsSha256[unit] = sha256(bytes);
    const list: Finding[] = [];
    const ids = new Set<string>();
    const lines = bytes.toString('utf8').replace(/\n$/, '').split('\n');
    if (lines.length === 1 && lines[0] === '') lines.length = 0;
    lines.forEach((text, index) => {
      const where = path + ' line ' + (index + 1);
      let f: Record<string, unknown>;
      try {
        f = JSON.parse(text);
      } catch {
        return fail('SOURCE', where, 'not a JSON object');
      }
      if (!f || typeof f !== 'object' || Array.isArray(f)) fail('SOURCE', where, 'not a JSON object');
      if (typeof f.severity !== 'string' || !f.severity) fail('SOURCE', where, 'severity is missing');
      if (!(f.path === null || typeof f.path === 'string')) fail('SOURCE', where, 'path is not a string or null');
      if (!(f.line === null || (Number.isSafeInteger(f.line) && (f.line as number) >= 1))) fail('SOURCE', where, 'line is not a whole number from 1, or null');
      if (typeof f.summary !== 'string' || !f.summary) fail('SOURCE', where, 'summary is missing');
      const pass = f.pass === undefined ? 1 : (f.pass as number);
      if (!Number.isSafeInteger(pass) || pass < 1 || pass > arm.passes) fail('PASS', where, 'pass ' + JSON.stringify(f.pass) + ' is not 1 to ' + arm.passes + ' (arm.json passes)');
      const id = String(f.id ?? f.fingerprint ?? '#' + index);
      if (ids.has(pass + ' ' + id)) fail('SOURCE', where, 'id ' + JSON.stringify(id) + ' repeats in pass ' + pass);
      ids.add(pass + ' ' + id);
      list.push({ id, index, pass, raw: rawLabel(f), reader: readerOf(f), fields: f });
    });
    findings.set(unit, list);
  }
  if (!findings.size) fail('SOURCE', at('findings'), 'holds no findings/<unit>.jsonl file');

  if (!existsSync(at('cost.tsv'))) fail('COST', at('cost.tsv'), 'missing; the rig writes an all-scope row for every session it ran');
  const costText = readFileSync(at('cost.tsv'));
  const lines = costText.toString('utf8').split(/\r?\n/);
  const header = (lines[0] ?? '').split('\t').map((h) => h.trim());
  const col = (name: string) => COST_ALIASES[name]!.find((a) => header.includes(a)) ?? null;
  for (const need of ['pr', 'scope', 'total_tokens', 'meter_source']) if (!col(need)) fail('COST', at('cost.tsv') + ' header', 'missing column ' + need);
  const costColumns = COST_NUMBERS.filter((k) => col(k));
  const cost: CostRow[] = [];
  const totals = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]!.trim()) continue;
    const where = at('cost.tsv') + ' line ' + (i + 1);
    const cells = lines[i]!.split('\t');
    if (cells.length > header.length) fail('COST', where, 'more cells than header columns');
    const get = (name: string) => {
      const c = col(name);
      return c === null ? undefined : (cells[header.indexOf(c)] ?? '').trim();
    };
    const pr = get('pr')!;
    if (pr === '*') fail('COST', where, 'a pr * row covers several units and cannot be split per unit-pass');
    const unit = unitFile(pr);
    if (!findings.has(unit)) fail('UNIT', join(dir, 'findings', unit + '.jsonl'), 'missing, and cost.tsv line ' + (i + 1) + ' names unit ' + pr);
    const passCell = get('pass');
    const pass = unknownCell(passCell) ? (arm.passes === 1 ? 1 : fail('COST', where, 'no pass, and the arm has ' + arm.passes + ' passes')) : Number(passCell);
    if (!Number.isSafeInteger(pass) || pass < 1 || pass > arm.passes) fail('PASS', where, 'pass ' + JSON.stringify(passCell) + ' is not 1 to ' + arm.passes + ' (arm.json passes)');
    const scope = get('scope')!;
    if (!scope) fail('COST', where, 'scope is blank');
    if (scope === 'all') {
      if (totals.has(unit + ' ' + pass)) fail('COST', where, 'a second all-scope row for ' + pr + ' pass ' + pass);
      totals.add(unit + ' ' + pass);
    }
    const values: CostRow['values'] = {};
    for (const k of costColumns) {
      const raw = get(k);
      const v = unknownCell(raw) ? null : Number(raw);
      if (v !== null && (!Number.isFinite(v) || v < 0)) fail('COST', where + ' ' + k, JSON.stringify(raw) + ' is not a non-negative number');
      values[k] = v;
    }
    cost.push({ line: i + 1, pr, unit, scope, pass, meter_source: get('meter_source') ?? '', values });
  }

  const gaps: Gap[] = [];
  if (arm.coverage_gaps !== undefined && !Array.isArray(arm.coverage_gaps)) fail('GAP', at('arm.json'), 'coverage_gaps is not a list');
  for (const text of arm.coverage_gaps ?? []) {
    const m = GAP.exec(String(text));
    if (!m) fail('GAP', at('arm.json') + ' coverage_gaps', JSON.stringify(text) + ' does not read "<unit> pass <n>: <reason>"');
    const unit = unitFile(m![1]!.trim());
    if (!findings.has(unit)) fail('UNIT', join(dir, 'findings', unit + '.jsonl'), 'missing, and arm.json coverage_gaps names unit ' + m![1]!.trim());
    const pass = Number(m![2]);
    if (pass < 1 || pass > arm.passes) fail('PASS', at('arm.json') + ' coverage_gaps', JSON.stringify(text) + ' names pass ' + pass + ', not 1 to ' + arm.passes);
    gaps.push({ text: String(text), ref: m![1]!.trim(), unit, pass, reason: m![3]! });
  }
  return { dir, arm, armJsonSha256: sha256(armText), costSha256: sha256(costText), findingsSha256, findings, cost, costColumns, gaps };
}

/** The unit ref to write for a findings file: the pr a cost row or gap gives it, else the file name. */
export function unitRefs(arms: readonly Arm[]): Map<string, string> {
  const refs = new Map<string, string>();
  for (const a of arms) {
    for (const r of a.cost) if (!refs.has(r.unit)) refs.set(r.unit, r.pr);
    for (const g of a.gaps) if (!refs.has(g.unit)) refs.set(g.unit, g.ref);
  }
  return refs;
}
