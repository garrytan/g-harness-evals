#!/usr/bin/env bun
// Select the v0.3 held-out set from its candidates by rule, with no trial result involved.
//
//   bun scripts/v03/select.ts --candidates <dir> --world <world.json> --facts <facts.json> --audit <audit.jsonl> --out <dir>
//
// Rules (the approved plan, decision 3): a candidate is excluded when check-set flags it or the audit names any code;
// within each family the lowest-numbered passing candidates are kept up to the family's quota (QUOTAS); at most
// MAX_REPLACEMENTS candidates are passed over in all; fewer than MIN_TASKS kept stops the selection with exit 3. The kept
// tasks are copied to <out>/tasks and every excluded or surplus candidate is listed in <out>/exclusions.json (opaque id,
// family, code), which is sealed with the bundle; a stopped selection copies no task. --out may not lie inside the
// checkout, overlap --candidates or hold anything but a previous selection. Prints only V03: lines with counts and codes.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { checkSet } from './check-set.ts';
import { insideCheckout } from './paths.ts';
import type { FactsFile, FamilyV03 } from './types.ts';

export const QUOTAS: Record<FamilyV03, number> = { scope_isolation: 7, shared_channel: 5, synthesis: 6, continuity: 8, corrections: 8, approval_relay: 6 };
export const MAX_REPLACEMENTS = 8;
export const MIN_TASKS = 30;

export interface Candidate { id: string; family: FamilyV03; n: number; codes: string[] }
export interface Selection { kept: Candidate[]; excluded: Array<{ id: string; family: FamilyV03; code: string }>; shortfall: Partial<Record<FamilyV03, number>>; replacements: number; stop: 'SELECT-BELOW-MIN' | 'SELECT-TOO-MANY-REPLACEMENTS' | null }

export function select(cands: Candidate[]): Selection {
  const kept: Candidate[] = [];
  const excluded: Selection['excluded'] = [];
  const shortfall: Selection['shortfall'] = {};
  let replacements = 0;
  for (const family of Object.keys(QUOTAS) as FamilyV03[]) {
    const pool = cands.filter((c) => c.family === family).sort((a, b) => a.n - b.n);
    let have = 0;
    for (const c of pool) {
      if (have >= QUOTAS[family]) { excluded.push({ id: c.id, family, code: c.codes.length ? c.codes.join(',') : 'SURPLUS' }); continue; }
      if (c.codes.length) {
        excluded.push({ id: c.id, family, code: c.codes.join(',') });
        replacements += 1;
        continue;
      }
      kept.push(c);
      have += 1;
    }
    if (have < QUOTAS[family]) shortfall[family] = QUOTAS[family] - have;
  }
  const stop = kept.length < MIN_TASKS ? 'SELECT-BELOW-MIN' : replacements > MAX_REPLACEMENTS ? 'SELECT-TOO-MANY-REPLACEMENTS' : null;
  return { kept, excluded, shortfall, replacements, stop };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (k: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const [dir, worldPath, factsPath, auditPath, out] = ['candidates', 'world', 'facts', 'audit', 'out'].map(arg);
  if (!dir || !worldPath || !factsPath || !auditPath || !out) { console.log('V03: error SELECT-USAGE'); process.exit(2); }
  const within = (a: string, b: string) => resolve(a) === resolve(b) || resolve(a).startsWith(resolve(b) + sep);
  const isFile = existsSync(out) && !statSync(out).isDirectory();
  const previous = existsSync(out) && !isFile ? readdirSync(out) : [];
  if (isFile || insideCheckout(out) || within(dir, out) || within(out, dir) || previous.some((e) => e !== 'tasks' && e !== 'exclusions.json')) { console.log('V03: error SELECT-OUT-PATH'); process.exit(2); }
  const facts = (JSON.parse(readFileSync(factsPath, 'utf8')) as FactsFile).facts;
  const checks = await checkSet(dir, worldPath, 'heldout', facts);
  const audit = new Map(readFileSync(auditPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string; codes: string[] }).map((a) => [a.id, a.codes]));
  const cands: Candidate[] = readdirSync(dir).filter((d) => existsSync(join(dir, d, 'spec.json'))).map((id) => {
    const spec = JSON.parse(readFileSync(join(dir, id, 'spec.json'), 'utf8')) as { family: FamilyV03 };
    const check = checks.find((c) => c.id === id);
    const codes = [...(check?.flags ?? ['CHECK_MISSING']), ...(audit.has(id) ? audit.get(id)! : ['AUDIT_MISSING'])];
    return { id, family: spec.family, n: Number(id.split('-')[1]), codes };
  });
  const s = select(cands);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'tasks'), { recursive: true });
  if (!s.stop) for (const c of s.kept) cpSync(join(dir, c.id), join(out, 'tasks', c.id), { recursive: true });
  writeFileSync(join(out, 'exclusions.json'), JSON.stringify({ schema_version: 1, rules: { quotas: QUOTAS, max_replacements: MAX_REPLACEMENTS, min_tasks: MIN_TASKS, order: 'lowest-numbered passing candidate per family' }, candidates: cands.length, kept: s.kept.length, replacements: s.replacements, shortfall: s.shortfall, stop: s.stop, excluded: s.excluded }, null, 1) + '\n');
  const fam = (xs: Candidate[]) => (Object.keys(QUOTAS) as FamilyV03[]).map((f) => f + '=' + xs.filter((x) => x.family === f).length).join(',');
  for (const e of s.excluded) console.log('V03: excluded ' + e.id + ' ' + e.code);
  console.log('V03: selected kept=' + s.kept.length + ' families=' + fam(s.kept) + ' replacements=' + s.replacements + ' shortfall=' + (Object.values(s.shortfall).reduce((a, b) => a + b!, 0)));
  if (s.stop) { console.log('V03: error ' + s.stop); process.exit(3); }
}
