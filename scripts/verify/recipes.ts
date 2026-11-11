// Rebuild recipes: one JSON file per published run under scripts/verify/runs/, named after its folder under
// docs/benchmarks/. A recipe lists the commands that rebuild the run's published analysis files from its receipts, the
// differences we already know about, values that change on every rebuild without being numbers (a checkout's commit id),
// and the published numbers that can't be rebuilt at all. docs/verify.md explains the format.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasNumber } from './compare.ts';

export interface Step {
  cmd: string[];
  outputs?: string[];
  stdout?: { file: string } | { contained_in: string };
  self_check?: boolean;
  timeout_s?: number;
  note?: string;
}

export interface Known {
  file: string;
  path?: string;
  line?: number;
  committed?: unknown;
  rebuilt?: unknown;
  reason: string;
}

export interface Volatile { file: string; path?: string; pattern?: string; reason: string }

export interface Gap { what: string; file?: string; reason: string }

export interface RebuildOnly { file: string; paths?: string[]; starts?: string; lines?: number; reason: string }

export interface Recipe {
  run: string;
  about?: string;
  requires?: string[];
  steps: Step[];
  known?: Known[];
  volatile?: Volatile[];
  not_rebuilt?: Gap[];
  public_copy_omits?: Array<{ file: string; reason: string }>;
  rebuild_only?: RebuildOnly[];
}

export const RECIPES_DIR = 'scripts/verify/runs';
export const PROGRAMS = new Set(['bun', 'python3']);

export function loadRecipes(root: string): Recipe[] {
  const dir = join(root, RECIPES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const r = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Recipe;
    if (r.run + '.json' !== f) throw new Error(RECIPES_DIR + '/' + f + ': "run" is ' + JSON.stringify(r.run) + ', but the file name says ' + f.slice(0, -5));
    return r;
  });
}

const str = (v: unknown) => typeof v === 'string' && v.length > 0;

export function validateRecipe(root: string, r: Recipe): string[] {
  const where = RECIPES_DIR + '/' + r.run + '.json';
  const errs: string[] = [];
  const runDir = join(root, 'docs/benchmarks', r.run);
  if (!existsSync(runDir)) errs.push(where + ': there is no folder docs/benchmarks/' + r.run);
  if (!Array.isArray(r.steps)) errs.push(where + ': "steps" must be a list (it may be empty when everything is under not_rebuilt)');
  const steps = Array.isArray(r.steps) ? r.steps : [];
  if (!steps.length && !(r.not_rebuilt ?? []).length) errs.push(where + ': it rebuilds nothing and lists nothing under not_rebuilt; say what this run publishes and why it can or cannot be rebuilt');
  const produced = new Set<string>();
  steps.forEach((s, i) => {
    const at = where + ' step ' + (i + 1);
    if (!Array.isArray(s.cmd) || !s.cmd.length || !s.cmd.every(str)) { errs.push(at + ': "cmd" must be a non-empty list of strings'); return; }
    if (!PROGRAMS.has(s.cmd[0]!)) errs.push(at + ': a rebuild may only run bun or python3, not ' + s.cmd[0]);
    for (const o of s.outputs ?? []) {
      if (!str(o) || o.startsWith('/') || o.split('/').includes('..')) errs.push(at + ': output ' + JSON.stringify(o) + ' must be a path inside the run folder');
      else produced.add(o);
    }
    const printed = s.stdout ? ('file' in s.stdout ? s.stdout.file : s.stdout.contained_in) : undefined;
    if (printed !== undefined && (!str(printed) || printed.startsWith('/') || printed.split('/').includes('..'))) errs.push(at + ': stdout path ' + JSON.stringify(printed) + ' must be a path inside the run folder');
    if (s.stdout && 'file' in s.stdout) produced.add(s.stdout.file);
    if (s.stdout && !('file' in s.stdout) && !('contained_in' in s.stdout)) errs.push(at + ': "stdout" needs "file" or "contained_in"');
    if (s.self_check && ((s.outputs ?? []).length || s.stdout || !s.cmd.includes('--check'))) errs.push(at + ': a self_check step runs a script\'s own --check mode and passes on exit 0, so it needs --check and no outputs or stdout');
    if (!s.self_check && !(s.outputs ?? []).length && !s.stdout) errs.push(at + ': the step neither writes an output nor compares its printed text, so it checks nothing');
  });
  for (const p of r.requires ?? []) if (!str(p) || p.startsWith('/') || p.split('/').includes('..')) errs.push(where + ': required path ' + JSON.stringify(p) + ' must be a path inside the repository');
  const omitted = new Set((r.public_copy_omits ?? []).map((o) => o.file));
  for (const o of r.public_copy_omits ?? []) if (!str(o.file) || !str(o.reason) || !produced.has(o.file)) errs.push(where + ': every public_copy_omits entry needs "file", one of the files a step rebuilds, and "reason"');
  if (!missingRequirements(root, r).length) for (const f of produced) if (!omitted.has(f) && !existsSync(join(runDir, f))) errs.push(where + ': ' + f + ' is listed as a rebuilt file, but there is no committed copy to compare it with');
  const contained = new Set(steps.flatMap((s) => (s.stdout && 'contained_in' in s.stdout ? [s.stdout.contained_in] : [])));
  for (const k of r.known ?? []) {
    if (!str(k.file) || !str(k.reason)) errs.push(where + ': every known difference needs "file" and "reason"');
    else if (!produced.has(k.file) && !contained.has(k.file)) errs.push(where + ': known difference in ' + k.file + ', which no step rebuilds');
    if (k.path !== undefined && !('committed' in k)) errs.push(where + ': known difference at ' + k.file + ' ' + k.path + ' has no published value; a value only the rebuild has is not published, so verify ignores it and the entry can go');
    if (k.path === undefined && k.line === undefined && !contained.has(k.file)) errs.push(where + ': known difference in ' + k.file + ' needs a JSON "path" or a text "line"');
  }
  for (const v of r.volatile ?? []) {
    if (!str(v.file) || !str(v.reason)) { errs.push(where + ': every volatile value needs "file" and "reason"'); continue; }
    if (!produced.has(v.file)) errs.push(where + ': volatile value in ' + v.file + ', which no step rebuilds');
    if (v.file.endsWith('.json') ? !str(v.path) || v.pattern !== undefined : !str(v.pattern) || v.path !== undefined) errs.push(where + ': a volatile value in a JSON file needs a "path", and one in a text file needs a "pattern" (a regular expression for the text to skip)');
    else if (v.pattern !== undefined) { try { new RegExp(v.pattern); } catch { errs.push(where + ': volatile pattern ' + JSON.stringify(v.pattern) + ' is not a valid regular expression'); } }
  }
  for (const g of r.not_rebuilt ?? []) if (!str(g.what) || !str(g.reason)) errs.push(where + ': every not_rebuilt entry needs "what" and "reason"');
  for (const a of r.rebuild_only ?? []) {
    if (!str(a.file) || !str(a.reason)) { errs.push(where + ': every rebuild_only entry needs "file" and "reason"'); continue; }
    if (!produced.has(a.file)) errs.push(where + ': rebuild_only entry for ' + a.file + ', which no step rebuilds');
    const isPaths = Array.isArray(a.paths) && a.paths.length > 0 && a.paths.every(str) && a.starts === undefined && a.lines === undefined;
    const isBlock = a.paths === undefined && str(a.starts) && Number.isInteger(a.lines) && a.lines! > 0;
    if (a.file.endsWith('.json') ? !isPaths : !isBlock) errs.push(where + ': a rebuild_only entry for a JSON file needs "paths" (the exact paths only the rebuild has), and one for a text file needs "starts" (the start of the first line of the added block) and "lines" (its number of non-blank lines)');
  }
  return errs;
}

// Paths a recipe needs that this copy of the repository may not have (the public export leaves some private folders
// out): its own requires list plus the script each step runs.
export function missingRequirements(root: string, r: Recipe): string[] {
  const scripts = (r.steps ?? []).map((s) => (s.cmd ?? []).find((a, i) => i > 0 && !a.startsWith('-') && /\.(ts|py)$/.test(a) && !a.includes('{')) ?? '').filter(Boolean);
  return [...new Set([...(r.requires ?? []), ...scripts])].filter((p) => !existsSync(join(root, p)));
}

export function volatileHoldsNumber(committed: unknown): boolean {
  return hasNumber(committed);
}

// The runs verify must cover: every docs/benchmarks folder with a report.md, every folder in docs/scoreboard/reports.json
// that has a report or is listed as reported or superseded, and every scoreboard entry's report folder.
export function publishedRuns(root: string): string[] {
  const runs = new Set<string>();
  const benchmarks = join(root, 'docs/benchmarks');
  for (const d of readdirSync(benchmarks)) if (existsSync(join(benchmarks, d, 'report.md'))) runs.add(d);
  const reports = JSON.parse(readFileSync(join(root, 'docs/scoreboard/reports.json'), 'utf8')) as { reports: { folder: string; report: string | null; status: string }[] };
  for (const r of reports.reports) if (r.report || r.status === 'reported' || r.status === 'superseded') runs.add(r.folder);
  const entries = join(root, 'docs/scoreboard/entries');
  for (const f of readdirSync(entries).filter((x) => x.endsWith('.json'))) {
    const e = JSON.parse(readFileSync(join(entries, f), 'utf8')) as { report: string };
    const m = /^docs\/benchmarks\/([^/]+)\//.exec(e.report);
    if (m) runs.add(m[1]!);
  }
  return [...runs].sort();
}
