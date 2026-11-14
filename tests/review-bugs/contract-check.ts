// A test-side check of the shape gstack-evals' noloss ingest --check accepts for a raw arm (lanes/review-noloss/contract.ts
// and ingest.ts at gstack-evals 91d76421), so the tests can check merged and blinded arms without gstack-evals installed.
// It mirrors the rules a raw arm meets: the files the contract allows, arm.json's required fields, each finding's shape,
// pass and id, a mapped severity for every raw label, and cost.tsv's columns, meter sources and one all row per
// unit-pass. It returns every problem found; an empty list means the arm fits.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const METERS = ['proxy-journal', 'reader-counter', 'lane-counter-delta', 'root-counter-delta', 'estimate'];
const NUMBERS = ['total_tokens', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'usd', 'wall_seconds'];
const unknown = (v: string | undefined) => v === undefined || v === '' || v === '-' || /^unavailable$/i.test(v);

export function contractProblems(dir: string, units: readonly string[]): string[] {
  const p: string[] = [];
  for (const name of readdirSync(dir)) if (!['arm.json', 'findings', 'cost.tsv', 'judgments.tsv', 'adjudication.tsv'].includes(name)) p.push(name + ': not part of arm contract v1');
  const arm = JSON.parse(readFileSync(join(dir, 'arm.json'), 'utf8'));
  if (arm.contract_version !== 1) p.push('arm.json contract_version');
  for (const k of ['id', 'label', 'suite', 'date']) if (typeof arm[k] !== 'string' || !arm[k]) p.push('arm.json ' + k);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(arm.id)) p.push('arm.json id');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arm.date)) p.push('arm.json date');
  if (!Number.isSafeInteger(arm.passes) || arm.passes < 1 || arm.passes > 20) p.push('arm.json passes');
  if (arm.status !== undefined && !['complete', 'stopped'].includes(arm.status)) p.push('arm.json status');
  const map = (raw: string, reader: string | null) => raw === 'CRITICAL' || raw === 'INFORMATIONAL' ? raw : (reader !== null ? arm.severity_map?.by_reader?.[reader]?.[raw] : undefined) ?? arm.severity_map?.default?.[raw] ?? null;
  const files = readdirSync(join(dir, 'findings')).map((f) => f.replace(/\.jsonl$/, ''));
  for (const u of units) if (!files.includes(u)) p.push('findings/' + u + '.jsonl missing');
  for (const f of files) {
    if (!units.includes(f)) p.push('findings/' + f + '.jsonl names no suite unit');
    const lines = readFileSync(join(dir, 'findings', f + '.jsonl'), 'utf8').replace(/\n$/, '').split('\n').filter((l, i, a) => !(a.length === 1 && l === ''));
    const ids = new Set<string>();
    lines.forEach((text, i) => {
      const at = 'findings/' + f + '.jsonl line ' + (i + 1);
      const x = JSON.parse(text);
      if (typeof x.severity !== 'string' || !x.severity) p.push(at + ' severity');
      if (!(x.path === null || typeof x.path === 'string')) p.push(at + ' path');
      if (typeof x.path === 'string' && /^(?:\/|~|[A-Za-z]:[\\/])/.test(x.path)) p.push(at + ' machine path');
      if (!(x.line === null || (Number.isSafeInteger(x.line) && x.line >= 1))) p.push(at + ' line');
      if (typeof x.summary !== 'string' || !x.summary) p.push(at + ' summary');
      const pass = x.pass ?? 1;
      if (!Number.isSafeInteger(pass) || pass < 1 || pass > arm.passes) p.push(at + ' pass');
      const id = String(x.id ?? x.fingerprint ?? '#' + i);
      if (ids.has(pass + ' ' + id)) p.push(at + ' id repeats');
      ids.add(pass + ' ' + id);
      const raw = String(typeof x.label === 'string' && x.label ? x.label : x.severity).split(',')[0]!.trim();
      if (map(raw, x.reader ?? x.specialist ?? x.voice ?? null) === null) p.push(at + ' raw label ' + raw + ' unmapped');
    });
  }
  if (existsSync(join(dir, 'cost.tsv'))) {
    const [head, ...rows] = readFileSync(join(dir, 'cost.tsv'), 'utf8').split('\n').filter((l) => l.trim());
    const cols = head!.split('\t');
    for (const c of ['pr', 'scope', 'total_tokens', 'meter_source']) if (!cols.includes(c)) p.push('cost.tsv header ' + c);
    const totals = new Set<string>();
    rows.forEach((r, i) => {
      const cells = r.split('\t');
      if (cells.length > cols.length) p.push('cost.tsv line ' + (i + 2) + ' ragged');
      const get = (c: string) => cells[cols.indexOf(c)];
      if (!METERS.includes(get('meter_source') ?? '')) p.push('cost.tsv line ' + (i + 2) + ' meter_source');
      if (!units.includes((get('pr') ?? '').replaceAll('/', '__'))) p.push('cost.tsv line ' + (i + 2) + ' pr');
      for (const c of NUMBERS) if (cols.includes(c) && !unknown(get(c)) && !(Number(get(c)) >= 0)) p.push('cost.tsv line ' + (i + 2) + ' ' + c);
      const pass = get('pass');
      if (!unknown(pass) && !(Number(pass) >= 1 && Number(pass) <= arm.passes)) p.push('cost.tsv line ' + (i + 2) + ' pass');
      if (get('scope') === 'all') {
        const key = get('pr') + ' ' + pass;
        if (totals.has(key)) p.push('cost.tsv line ' + (i + 2) + ' second all row');
        totals.add(key);
      }
    });
  }
  return p;
}
