#!/usr/bin/env bun
// Checks graded task set T of the skill-resolver eval (internal-task, task phase), keyless and deterministic.
//
//   bun scripts/skill-resolver/check-set-t.ts [--set tasks/skill-resolver/T] [--catalog <catalog out dir>] [--json]
//   bun scripts/skill-resolver/check-set-t.ts --catalog <catalog out dir> --stamp <task id>...
//
// --stamp is for authors: it writes the target's pack and SKILL.md sha256 and the request's overlap, from the catalog,
// into the named tasks' task.json, then checks the set as usual.
//
// Every task under <set>/tasks/<id>/ holds task.json, start/ (the starting files), oracle/ (the reference solution's
// files, laid over start/) and obvious/ (what a scripted fake that does the obvious thing without the skill writes, laid
// over start/). The format is in tasks/skill-resolver/T/README.md. For each task this script requires:
//   - task.json has the right shape, its checks use known kinds, used_it names at least one check, and every used_it check
//     lists markers (the skill's own words) that the request does not contain;
//   - the oracle passes every check (used_it and success true);
//   - doing nothing (start/ alone) fails used_it and success;
//   - the obvious attempt fails used_it but passes every check outside used_it, so used_it is what separates it;
//   - the request does not name the target (name_hit false) and its overlap bin matches its nd_jaccard;
//   - git ignores no file of the set (an ignored fixture is missing from a fresh checkout and changes the set hash).
// With --catalog it also checks the catalog hash, that each target exists with the recorded SKILL.md sha256 and pack, and
// recomputes the overlap from the catalog's name, description and body. It prints one line per task, one line per failure
// and ends with SETT_OK n=<tasks> hash=<sha256 over every file of the set's tasks/ tree> or SETT_FAIL.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Manifest } from './build-catalog.ts';
import { overlap } from './gen-set-p.ts';

export const CATALOG_HASH = 'b6d67f1f044fab694182a424719a40b13a6e63640d8e814c7fd7277d97123fb7';
export const PACK_QUOTA: Record<string, number> = { hermes: 28, gstack: 9, openclaw: 7, qm: 4 };
export const SET_SIZE = 48;
/** Overlap bins on nd_jaccard (request against the target's name and description words), the plan's stratification. */
export const overlapBin = (ndJaccard: number) => (ndJaccard === 0 ? 'none' : ndJaccard <= 0.05 ? 'low' : ndJaccard <= 0.12 ? 'mid' : 'high');

type Where = { path?: string; glob?: string };
type Common = { id: string; why: string; markers?: string[] };
export type Check =
  | (Common & Where & { kind: 'exists'; min?: number; max?: number })
  | (Common & Where & { kind: 'regex'; pattern: string; flags?: string; min?: number; max?: number })
  | (Common & { kind: 'order'; path: string; patterns: string[]; flags?: string })
  | (Common & { kind: 'json'; path: string; pointer: string; equals?: unknown; pattern?: string; min_items?: number })
  | (Common & { kind: 'frontmatter'; path: string; key: string; pattern: string });
export type Task = {
  id: string;
  target: { name: string; pack: string; skill_md_sha256: string };
  request: string;
  skill_step: string;
  used_it: string[];
  checks: Check[];
  overlap: { name_hit: boolean; nd_jaccard: number; body_coverage: number; bin: string };
};
export type Verdict = { used_it: boolean; success: boolean; failed: string[] };

const KINDS = new Set(['exists', 'regex', 'order', 'json', 'frontmatter']);
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const files = (dir: string, glob: string) => [...new Bun.Glob(glob).scanSync({ cwd: dir, dot: true, onlyFiles: true })].sort();
const read = (dir: string, p: string) => (existsSync(join(dir, p)) && statSync(join(dir, p)).isFile() ? readFileSync(join(dir, p), 'utf8') : null);
const targets = (dir: string, c: Where) => (c.glob ? files(dir, c.glob) : c.path && read(dir, c.path) !== null ? [c.path] : []);

function pointer(doc: unknown, ptr: string): unknown {
  let cur = doc;
  for (const raw of ptr.split('/').slice(1)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[raw.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  return cur;
}

/** One check against a finished working directory. Pure and deterministic: it reads files only. */
export function runCheck(dir: string, c: Check): boolean {
  switch (c.kind) {
    case 'exists': {
      const n = targets(dir, c).filter((p) => read(dir, p)!.length > 0).length;
      return c.glob ? n >= (c.min ?? 1) && n <= (c.max ?? Infinity) : n === 1;
    }
    case 'regex': {
      const re = new RegExp(c.pattern, (c.flags ?? '').replace('g', '') + 'g');
      return targets(dir, c).some((p) => {
        const n = [...read(dir, p)!.matchAll(re)].length;
        return n >= (c.min ?? 1) && n <= (c.max ?? Infinity);
      });
    }
    case 'order': {
      const text = read(dir, c.path);
      if (text === null) return false;
      let at = 0;
      for (const p of c.patterns) {
        const m = new RegExp(p, c.flags ?? '').exec(text.slice(at));
        if (!m) return false;
        at += m.index + Math.max(1, m[0].length);
      }
      return true;
    }
    case 'json': {
      const text = read(dir, c.path);
      if (text === null) return false;
      let v: unknown;
      try { v = pointer(JSON.parse(text), c.pointer); } catch { return false; }
      if (v === undefined) return false;
      if ('equals' in c && JSON.stringify(v) !== JSON.stringify(c.equals)) return false;
      if (c.pattern !== undefined && !new RegExp(c.pattern).test(typeof v === 'string' ? v : JSON.stringify(v))) return false;
      return c.min_items === undefined || (Array.isArray(v) && v.length >= c.min_items);
    }
    case 'frontmatter': {
      const text = read(dir, c.path);
      const m = text ? /^---\r?\n([\s\S]*?)\r?\n---/.exec(text) : null;
      if (!m) return false;
      let doc: Record<string, unknown> | null;
      try { doc = (Bun as unknown as { YAML: { parse(s: string): unknown } }).YAML.parse(m[1]!) as Record<string, unknown> | null; } catch { return false; }
      const v = doc?.[c.key];
      return v !== undefined && v !== null && new RegExp(c.pattern).test(typeof v === 'string' ? v : JSON.stringify(v));
    }
  }
}

export function grade(dir: string, t: Task): Verdict {
  const failed = t.checks.filter((c) => !runCheck(dir, c)).map((c) => c.id);
  return { used_it: t.used_it.every((id) => !failed.includes(id)), success: failed.length === 0, failed };
}

/** Lays an attempt's files over the task's start files in a fresh temporary directory. */
export function materialise(taskDir: string, attempt: 'start' | 'oracle' | 'obvious'): string {
  const dir = mkdtempSync(join(tmpdir(), 'sett-'));
  cpSync(join(taskDir, 'start'), dir, { recursive: true });
  if (attempt !== 'start') cpSync(join(taskDir, attempt), dir, { recursive: true });
  return dir;
}

export function setHash(setDir: string): string {
  const root = join(setDir, 'tasks');
  return sha(files(root, '**/*').map((p) => p + '\t' + sha(readFileSync(join(root, p)))).join('\n') + '\n');
}

export function checkTask(taskDir: string, t: Task, cat?: { dir: string; manifest: Manifest }): string[] {
  const errs: string[] = [];
  const e = (m: string) => errs.push((t.id ?? taskDir) + ': ' + m);
  if (t.id !== taskDir.split('/').pop()) e('id does not match its directory');
  if (!t.target?.name || !/^[0-9a-f]{64}$/.test(t.target.skill_md_sha256 ?? '')) e('target needs name, pack and skill_md_sha256');
  if (!PACK_QUOTA[t.target?.pack]) e('unknown pack ' + t.target?.pack);
  if (!t.request?.trim() || !t.skill_step?.trim()) e('request and skill_step must be non-empty');
  const ids = new Set(t.checks?.map((c) => c.id));
  if (!t.checks?.length || ids.size !== t.checks.length) e('checks must be non-empty with unique ids');
  for (const c of t.checks ?? []) {
    if (!KINDS.has(c.kind)) e('check ' + c.id + ': unknown kind ' + c.kind);
    if (!c.why?.trim()) e('check ' + c.id + ': why is required');
    if (c.kind !== 'order' && c.kind !== 'json' && c.kind !== 'frontmatter' && !c.path === !c.glob) e('check ' + c.id + ': give exactly one of path and glob');
    const pats = c.kind === 'order' ? c.patterns : 'pattern' in c && c.pattern !== undefined ? [c.pattern] : [];
    try { for (const p of pats) new RegExp(p, 'flags' in c ? (c.flags ?? '').replace('g', '') : ''); } catch { e('check ' + c.id + ': bad pattern'); }
  }
  if (!t.used_it?.length || t.used_it.some((id) => !ids.has(id))) e('used_it must name existing checks');
  const req = (t.request ?? '').toLowerCase();
  for (const c of t.checks?.filter((c) => t.used_it?.includes(c.id)) ?? []) {
    if (!c.markers?.length) e('used_it check ' + c.id + ' needs markers');
    for (const mk of c.markers ?? []) if (req.includes(mk.toLowerCase())) e('request gives away marker "' + mk + '" of ' + c.id);
  }
  for (const d of ['start', 'oracle', 'obvious']) if (!existsSync(join(taskDir, d))) e('missing ' + d + '/');
  if (errs.length) return errs;

  for (const attempt of ['oracle', 'start', 'obvious'] as const) {
    const dir = materialise(taskDir, attempt);
    try {
      const v = grade(dir, t);
      if (attempt === 'oracle' && !v.success) e('oracle fails ' + v.failed.join(','));
      if (attempt === 'start' && (v.used_it || v.success)) e('doing nothing passes used_it');
      if (attempt === 'obvious') {
        if (v.used_it) e('the obvious attempt passes used_it');
        const outside = v.failed.filter((id) => !t.used_it.includes(id));
        if (outside.length) e('the obvious attempt fails checks outside used_it (' + outside.join(',') + '), so it is not a fair attempt');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  if (t.overlap?.name_hit !== false) e('the request names the target skill');
  if (t.overlap?.bin !== overlapBin(t.overlap?.nd_jaccard)) e('overlap bin does not match nd_jaccard');
  if (cat) {
    const skill = cat.manifest.skills.find((s) => s.name === t.target.name);
    if (!skill) e('target ' + t.target.name + ' is not in the catalog');
    else {
      if (skill.skill_md_sha256 !== t.target.skill_md_sha256) e('skill_md_sha256 differs from the catalog');
      if (skill.pack !== t.target.pack) e('pack differs from the catalog');
      const ov = overlap(t.request, skill.original_name, skill.description, readFileSync(join(cat.dir, 'skills', skill.name, 'SKILL.md'), 'utf8'));
      const want = { ...ov, bin: overlapBin(ov.nd_jaccard) };
      if (JSON.stringify(want) !== JSON.stringify(t.overlap)) e('overlap ' + JSON.stringify(t.overlap) + ' differs from recomputed ' + JSON.stringify(want));
    }
  }
  return errs;
}

export function checkSet(setDir: string, catalog?: string) {
  const cat = catalog ? { dir: catalog, manifest: JSON.parse(readFileSync(join(catalog, 'manifest.json'), 'utf8')) as Manifest } : undefined;
  const errs: string[] = [];
  if (cat && cat.manifest.catalog_hash !== CATALOG_HASH) errs.push('catalog hash ' + cat.manifest.catalog_hash + ' is not the pinned ' + CATALOG_HASH);
  const root = join(setDir, 'tasks');
  const ids = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const tasks: Task[] = [];
  for (const id of ids) {
    let t: Task;
    try { t = JSON.parse(readFileSync(join(root, id, 'task.json'), 'utf8')); } catch { errs.push(id + ': unreadable task.json'); continue; }
    tasks.push(t);
    errs.push(...checkTask(join(root, id), t, cat));
  }
  if (ids.length !== SET_SIZE) errs.push('set holds ' + ids.length + ' tasks, not ' + SET_SIZE);
  const ignored = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '--stdin'], { input: files(root, '**/*').join('\n'), encoding: 'utf8' });
  if (ignored.status === 0) for (const p of ignored.stdout.trim().split('\n')) errs.push(p + ': git ignores this file, so a fresh checkout would lack it and hash differently');
  const byPack: Record<string, number> = {};
  for (const t of tasks) byPack[t.target?.pack] = (byPack[t.target?.pack] ?? 0) + 1;
  for (const [p, n] of Object.entries(PACK_QUOTA)) if ((byPack[p] ?? 0) !== n) errs.push('pack ' + p + ' has ' + (byPack[p] ?? 0) + ' tasks, quota ' + n);
  const names = tasks.map((t) => t.target?.name);
  if (new Set(names).size !== names.length) errs.push('two tasks target the same skill');
  const rows = tasks.map((t) => ({ id: t.id, pack: t.target?.pack, skill: t.target?.name, nd_jaccard: t.overlap?.nd_jaccard, body_coverage: t.overlap?.body_coverage, bin: t.overlap?.bin }));
  return { errs, n: ids.length, hash: setHash(setDir), rows, byPack, catalogChecked: !!cat };
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string, d?: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const setDir = v('--set', join(import.meta.dir, '../../tasks/skill-resolver/T'))!;
  const si = a.indexOf('--stamp');
  if (si >= 0) {
    const catalog = v('--catalog');
    if (!catalog) { console.error('usage: --stamp needs --catalog <dir>'); process.exit(2); }
    const m = JSON.parse(readFileSync(join(catalog, 'manifest.json'), 'utf8')) as Manifest;
    for (const id of a.slice(si + 1).filter((x) => !x.startsWith('--') && x !== catalog)) {
      const f = join(setDir, 'tasks', id, 'task.json');
      const t = JSON.parse(readFileSync(f, 'utf8')) as Task;
      const s = m.skills.find((x) => x.name === t.target.name);
      if (!s) { console.error('SETT_ERR ' + id + ': target ' + t.target.name + ' is not in the catalog'); process.exit(1); }
      const ov = overlap(t.request, s.original_name, s.description, readFileSync(join(catalog, 'skills', s.name, 'SKILL.md'), 'utf8'));
      t.target = { name: s.name, pack: s.pack, skill_md_sha256: s.skill_md_sha256 };
      t.overlap = { ...ov, bin: overlapBin(ov.nd_jaccard) };
      writeFileSync(f, JSON.stringify(t, null, 1) + '\n');
      console.log('stamped ' + id + ' nd_jaccard=' + ov.nd_jaccard + ' name_hit=' + ov.name_hit);
    }
  }
  const r = checkSet(setDir, v('--catalog'));
  if (a.includes('--json')) console.log(JSON.stringify({ n: r.n, hash: r.hash, by_pack: r.byPack, catalog_checked: r.catalogChecked, tasks: r.rows }, null, 1));
  else for (const row of r.rows) console.log(row.id + '\t' + row.pack + '\t' + row.skill + '\tnd_jaccard=' + row.nd_jaccard + '\tbody_coverage=' + row.body_coverage + '\tbin=' + row.bin);
  for (const e of r.errs) console.error('SETT_ERR ' + e);
  if (r.errs.length) { console.error('SETT_FAIL errors=' + r.errs.length + ' n=' + r.n); process.exit(1); }
  console.log('SETT_OK n=' + r.n + ' hash=' + r.hash + (r.catalogChecked ? ' catalog=' + CATALOG_HASH : ''));
}
