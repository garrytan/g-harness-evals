#!/usr/bin/env bun
// Fixture generator engine for the QM S1 edition rerun (internal-task-a, internal-task-b plan step 3).
//
//   bun harnesses/qm/gstack/edition-fixture.ts --bank <bank.json> --seed <seed> --out <empty dir>
//
// Input: a template bank (schema below and in harnesses/qm/gstack/README.md, "Edition fixtures, graders and analysis")
// and a seed string. Output, in --out:
//   tasks.json     the driver's task records: {id, family, request, repo_dir, first_step: {skill}}
//   keys.json      {<id>: {family, template, vars, key}}, read by edition-grade.ts and never by the driver
//   fixtures.json  each repository's identity (head, refs, tree sha256), the bank's sha256 and the seed's sha256
//   repos/<id>/    one git repository per task
//
// Deterministic: the same bank and seed give the same tasks.json (for the same --out), keys.json, fixtures.json and
// commit ids. Every object is written with git hash-object from fixed text, with a fixed author and fixed dates, as in
// s1-fixture.ts, whose helpers this file imports. The seed only picks each template's variable values.
//
// The real bank is private. A bank that is not test-only (test_only: true, every template id starting with "test-")
// is refused inside this checkout, and the repository ships only tests/fixtures/qm-s1-edition/test-only-bank.json.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { FIXTURE_REFS_COMMAND, FIXTURE_TREE_COMMAND, git, gitEnv, writeTree } from './s1-fixture.ts';

export const BANK_SCHEMA = 'qm-s1-edition-bank/1';
export const FAMILIES = ['investigate', 'review', 'plan'] as const;
export type Family = (typeof FAMILIES)[number];
export const ID_PREFIX: Record<Family, string> = { investigate: 'inv', review: 'rev', plan: 'plan' };
export const AUTHOR = 'Rui Tanaka <rui@example.test>';
/** First commit date (2026-10-20 08:00 UTC); commit i is i days later, with a Pacific offset. */
export const BASE_DATE = 1792483200;
/** Review fixtures need this many changed hunks besides the decoys, so an every-hunk-but-the-decoys review flags more than 3. */
export const MIN_REVIEW_HUNKS = 4;
/** Plan fixtures need this many distractors, so naming every constraint and distractor names more than 6. */
export const MIN_PLAN_DISTRACTORS = 4;
const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..');

/** A suspect in an investigate task: named when its file (path, basename or alias) and one mechanism phrase are named. */
export interface Suspect { file: string; aliases?: string[]; mechanism: string[] }
/** A spot in a review diff: lines in the checked-out version of the file, and optional symbols that also locate it. */
export interface Spot { file: string; lines: [number, number]; symbols?: string[]; mechanism?: string[] }
/** A constraint or distractor in a plan task: named when every group in all_of has one of its phrases in the text. */
export interface Item { id: string; description: string; all_of: string[][] }
export interface InvestigateKey { cause: Suspect; decoys: Suspect[] }
export interface ReviewKey { base: string; defect: Spot & { mechanism: string[] }; decoys: Spot[] }
export interface PlanKey { constraints: Item[]; distractors: Item[] }
export type Key = InvestigateKey | ReviewKey | PlanKey;
export interface Hunk { file: string; start: number; end: number }
/** What keys.json holds per task. Review keys gain the diff's changed files and hunks (new side), computed here. */
export type KeyRecord =
  | { family: 'investigate'; template: string; vars: Record<string, string>; key: InvestigateKey }
  | { family: 'review'; template: string; vars: Record<string, string>; key: ReviewKey & { diff_files: string[]; hunks: Hunk[] } }
  | { family: 'plan'; template: string; vars: Record<string, string>; key: PlanKey };

export interface Commit { branch: string; from?: string; message: string; files?: Record<string, string>; remove?: string[]; tag?: string }
export interface Template { id: string; family: Family; request: string; vars?: Record<string, string[]>; commits: Commit[]; checkout: string; key: Key }
export interface Bank { schema: string; bank_id: string; test_only: boolean; templates: Template[] }

/** The driver's task record (the interface shared with the driver half; do not add fields). */
export interface TaskRecord { id: string; family: Family; request: string; repo_dir: string; first_step: { skill: Family } }

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strArr = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.length > 0);
const VAR = /\{\{(\w+)\}\}/g;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!\.git(?:\/|$))[\w.\/-]+$/;

/** Problems with a bank's shape, before any repository is built. Empty means valid. */
export function bankProblems(bank: unknown): string[] {
  const p: string[] = [];
  if (!isObj(bank)) return ['bank must be an object'];
  if (bank.schema !== BANK_SCHEMA) p.push('schema must be ' + BANK_SCHEMA);
  if (typeof bank.bank_id !== 'string' || !bank.bank_id) p.push('bank_id must be a non-empty string');
  if (typeof bank.test_only !== 'boolean') p.push('test_only must be true or false');
  if (!Array.isArray(bank.templates) || !bank.templates.length) return [...p, 'templates must be a non-empty array'];
  const ids = new Set<string>();
  for (const [i, t] of (bank.templates as unknown[]).entries()) {
    const at = (msg: string) => p.push('templates[' + i + ']' + (isObj(t) && typeof t.id === 'string' ? ' (' + t.id + ')' : '') + ': ' + msg);
    if (!isObj(t)) { at('must be an object'); continue; }
    if (typeof t.id !== 'string' || !/^[\w.-]+$/.test(t.id)) at('id must be letters, digits, dot, dash or underscore');
    else if (ids.has(t.id)) at('id repeats'); else ids.add(t.id);
    if (bank.test_only === true && typeof t.id === 'string' && !t.id.startsWith('test-')) at('a test-only bank marks every template id with the prefix "test-"');
    if (!FAMILIES.includes(t.family as Family)) at('family must be investigate, review or plan');
    if (typeof t.request !== 'string' || !t.request.trim()) at('request must be a non-empty string');
    const vars = t.vars ?? {};
    if (!isObj(vars)) at('vars must be an object');
    else for (const [name, values] of Object.entries(vars)) {
      if (!/^\w+$/.test(name)) at('var ' + name + ': the name must be a word');
      if (!strArr(values) || (values as string[]).some((v) => /[\n{}]/.test(v))) at('var ' + name + ': values must be a non-empty list of one-line strings without braces');
    }
    const used = new Set([...JSON.stringify({ r: t.request, c: t.commits, k: t.key, o: t.checkout }).matchAll(VAR)].map((m) => m[1]!));
    for (const u of used) if (!isObj(vars) || !(u in vars)) at('uses {{' + u + '}} but vars does not declare it');
    if (!Array.isArray(t.commits) || !t.commits.length) { at('commits must be a non-empty array'); continue; }
    const branches = new Set<string>();
    for (const [j, c] of (t.commits as unknown[]).entries()) {
      const cat = (msg: string) => at('commits[' + j + ']: ' + msg);
      if (!isObj(c)) { cat('must be an object'); continue; }
      if (typeof c.branch !== 'string' || !/^\w[\w.\/-]*$/.test(c.branch)) cat('branch must be a branch name');
      if (typeof c.message !== 'string' || !c.message.trim()) cat('message must be a non-empty string');
      if (j === 0 && c.from !== undefined) cat('the first commit has no from');
      if (j > 0 && !branches.has(c.branch as string) && (typeof c.from !== 'string' || !branches.has(c.from))) cat('a new branch needs from, naming an earlier branch');
      if (branches.has(c.branch as string) && c.from !== undefined) cat('from is only for the first commit of a branch');
      if (c.files !== undefined && (!isObj(c.files) || Object.values(c.files).some((v) => typeof v !== 'string'))) cat('files must map paths to text');
      if (c.remove !== undefined && !strArr(c.remove)) cat('remove must be a non-empty list of paths');
      for (const path of [...Object.keys(isObj(c.files) ? c.files : {}), ...(Array.isArray(c.remove) ? c.remove : [])]) if (typeof path !== 'string' || !SAFE_PATH.test(path.replace(VAR, 'x'))) cat('unsafe path ' + String(path));
      if (c.tag !== undefined && (typeof c.tag !== 'string' || !/^[\w.-]+$/.test(c.tag))) cat('tag must be a tag name');
      if (!c.files && !c.remove) cat('a commit changes or removes files');
      if (typeof c.branch === 'string') branches.add(c.branch);
    }
    if (typeof t.checkout !== 'string' || !branches.has(t.checkout)) at('checkout must name a branch the commits create');
    for (const m of keyShapeProblems(t.family as Family, t.key)) at('key: ' + m);
  }
  return p;
}

function keyShapeProblems(family: Family, key: unknown): string[] {
  const p: string[] = [];
  if (!isObj(key)) return ['must be an object'];
  const suspect = (s: unknown, at: string) => { if (!isObj(s) || typeof s.file !== 'string' || !strArr(s.mechanism) || (s.aliases !== undefined && !strArr(s.aliases))) p.push(at + ' needs file, mechanism (phrases) and optional aliases'); };
  const spot = (s: unknown, at: string, needMechanism: boolean) => {
    const lines = isObj(s) ? s.lines : null;
    if (!isObj(s) || typeof s.file !== 'string' || !Array.isArray(lines) || lines.length !== 2 || !lines.every((n) => Number.isSafeInteger(n) && n >= 1) || (lines[0] as number) > (lines[1] as number)) p.push(at + ' needs file and lines [start, end]');
    if (isObj(s) && s.symbols !== undefined && !strArr(s.symbols)) p.push(at + '.symbols must be phrases');
    if (needMechanism && (!isObj(s) || !strArr(s.mechanism))) p.push(at + ' needs mechanism (phrases)');
  };
  const item = (s: unknown, at: string) => { if (!isObj(s) || typeof s.id !== 'string' || typeof s.description !== 'string' || !Array.isArray(s.all_of) || !s.all_of.length || !s.all_of.every((g) => strArr(g))) p.push(at + ' needs id, description and all_of (groups of phrases)'); };
  if (family === 'investigate') {
    suspect(key.cause, 'cause');
    if (!Array.isArray(key.decoys) || !key.decoys.length) p.push('decoys must list at least one suspect');
    else key.decoys.forEach((d, i) => suspect(d, 'decoys[' + i + ']'));
  } else if (family === 'review') {
    if (typeof key.base !== 'string') p.push('base must name the branch the review compares against');
    spot(key.defect, 'defect', true);
    if (!Array.isArray(key.decoys) || key.decoys.length !== 2) p.push('decoys must list exactly two spots');
    else key.decoys.forEach((d, i) => spot(d, 'decoys[' + i + ']', false));
  } else if (family === 'plan') {
    if (!Array.isArray(key.constraints) || key.constraints.length !== 3) p.push('constraints must list exactly three items');
    else key.constraints.forEach((c, i) => item(c, 'constraints[' + i + ']'));
    if (!Array.isArray(key.distractors) || key.distractors.length < MIN_PLAN_DISTRACTORS) p.push('distractors must list at least ' + MIN_PLAN_DISTRACTORS + ' items');
    else key.distractors.forEach((c, i) => item(c, 'distractors[' + i + ']'));
    const ids = [...(Array.isArray(key.constraints) ? key.constraints : []), ...(Array.isArray(key.distractors) ? key.distractors : [])].map((x) => (isObj(x) ? x.id : null));
    if (new Set(ids).size !== ids.length) p.push('constraint and distractor ids must be unique');
  }
  return p;
}

/** The value index a seed picks for one variable of one template. */
export function pickIndex(seed: string, templateId: string, name: string, n: number): number {
  return parseInt(sha256(seed + '\0' + templateId + '\0' + name).slice(0, 12), 16) % n;
}

function substitute<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string') return value.replace(VAR, (_, name: string) => vars[name]!) as T;
  if (Array.isArray(value)) return value.map((v) => substitute(v, vars)) as T;
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [substitute(k, vars), substitute(v, vars)])) as T;
  return value;
}

type Files = Record<string, string>;
export interface FixtureIdentity { template: string; head: string; branch: string; refs: string[]; tree_sha256: string; files: number }

/** Builds one template's repository at dir (missing or empty) and returns its identity and the checked-out files. */
export function buildRepo(dir: string, t: Template): { identity: FixtureIdentity; files: Files } {
  mkdirSync(dir, { recursive: true });
  if (readdirSync(dir).length) throw new Error('edition-fixture: ' + dir + ' is not empty');
  git(dir, ['init', '-q', '--template=', '--initial-branch=' + t.commits[0]!.branch]);
  const tips: Record<string, { commit: string; files: Files }> = {};
  t.commits.forEach((c, i) => {
    const parent = tips[c.branch] ?? (c.from ? tips[c.from] : undefined);
    const files: Files = { ...parent?.files, ...c.files };
    for (const path of c.remove ?? []) {
      if (!(path in files)) throw new Error('edition-fixture: ' + t.id + ' commit ' + i + ' removes ' + path + ', which does not exist');
      delete files[path];
    }
    const date = (BASE_DATE + i * 86400) + ' -0700';
    const body = ['tree ' + writeTree(dir, files), ...(parent ? ['parent ' + parent.commit] : []), 'author ' + AUTHOR + ' ' + date, 'committer ' + AUTHOR + ' ' + date, '', c.message, ''].join('\n');
    const commit = git(dir, ['hash-object', '-t', 'commit', '-w', '--stdin'], body);
    tips[c.branch] = { commit, files };
    git(dir, ['update-ref', 'refs/heads/' + c.branch, commit]);
    if (!c.tag) return;
    const tag = git(dir, ['hash-object', '-t', 'tag', '-w', '--stdin'], ['object ' + commit, 'type commit', 'tag ' + c.tag, 'tagger ' + AUTHOR + ' ' + date, '', 'Release ' + c.tag, ''].join('\n'));
    git(dir, ['update-ref', 'refs/tags/' + c.tag, tag]);
  });
  git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/' + t.checkout]);
  git(dir, ['reset', '-q', '--hard']);
  const tree = spawnSync('sh', ['-c', FIXTURE_TREE_COMMAND], { cwd: dir, encoding: 'utf8' });
  const refs = spawnSync('sh', ['-c', FIXTURE_REFS_COMMAND], { cwd: dir, encoding: 'utf8', env: gitEnv() });
  if (tree.status !== 0 || refs.status !== 0) throw new Error('edition-fixture: identity commands failed: ' + tree.stderr + refs.stderr);
  const head = tips[t.checkout]!;
  return { identity: { template: t.id, head: head.commit, branch: t.checkout, refs: refs.stdout.trim().split('\n'), tree_sha256: tree.stdout.trim(), files: Object.keys(head.files).length }, files: head.files };
}

/** Changed hunks of base...head on the new side, from git diff -U0. A pure deletion is a one-line hunk at its position. */
export function diffHunks(dir: string, base: string, head: string): Hunk[] {
  const out = git(dir, ['diff', '--no-color', '--no-ext-diff', '--no-renames', '-U0', base + '...' + head]);
  const hunks: Hunk[] = [];
  let file = '';
  for (const line of out.split('\n')) {
    const f = /^\+\+\+ (?:b\/(.*)|\/dev\/null)$/.exec(line);
    if (f) { file = f[1] ?? ''; continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file) { const start = Math.max(1, Number(h[1])), n = h[2] === undefined ? 1 : Number(h[2]); hunks.push({ file, start, end: start + Math.max(n, 1) - 1 }); }
  }
  return hunks;
}

const lineCount = (text: string) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
/** Spots in one file sit further apart than twice the grader's line slack (edition-grade.ts SLACK, 2), so a line
 *  reference near one spot is never within slack of another. */
export const MIN_SPOT_GAP = 5;
export const overlaps = (h: Hunk, s: Pick<Spot, 'file' | 'lines'>) => h.file === s.file && h.start <= s.lines[1] && s.lines[0] <= h.end;

/** Problems with one task's key against its built repository. */
function keyRepoProblems(t: Template, files: Files, hunks: Hunk[]): string[] {
  const p: string[] = [];
  const exists = (f: string, at: string) => { if (!(f in files)) p.push(at + ': ' + f + ' is not in the checked-out tree'); };
  if (t.family === 'investigate') {
    const k = t.key as InvestigateKey;
    exists(k.cause.file, 'cause');
    k.decoys.forEach((d, i) => { exists(d.file, 'decoys[' + i + ']'); if (d.file === k.cause.file) p.push('decoys[' + i + ']: a decoy must sit in another file than the cause'); });
  } else if (t.family === 'review') {
    const k = t.key as ReviewKey;
    if (k.base === t.checkout || !t.commits.some((c) => c.branch === k.base)) p.push('base must be another branch the commits create');
    const spots: Array<[Spot, string]> = [[k.defect, 'defect'], ...k.decoys.map((d, i): [Spot, string] => [d, 'decoys[' + i + ']'])];
    for (const [s, at] of spots) {
      exists(s.file, at);
      if (s.file in files && s.lines[1] > lineCount(files[s.file]!)) p.push(at + ': lines ' + s.lines.join('-') + ' run past the end of ' + s.file);
      if (!hunks.some((h) => overlaps(h, s))) p.push(at + ': lines ' + s.lines.join('-') + ' of ' + s.file + ' are not in the diff');
    }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
      const [a, b] = [spots[i]!, spots[j]!];
      if (hunks.some((h) => overlaps(h, a[0]) && overlaps(h, b[0]))) p.push(a[1] + ' and ' + b[1] + ' must sit in separate hunks');
      if (a[0].file === b[0].file && Math.max(a[0].lines[0] - b[0].lines[1], b[0].lines[0] - a[0].lines[1]) < MIN_SPOT_GAP) p.push(a[1] + ' and ' + b[1] + ' must sit at least ' + MIN_SPOT_GAP + ' lines apart');
    }
    const plain = hunks.filter((h) => !k.decoys.some((d) => overlaps(h, d)));
    if (plain.length < MIN_REVIEW_HUNKS) p.push('the diff has ' + plain.length + ' hunks besides the decoys; it needs at least ' + MIN_REVIEW_HUNKS);
  }
  return p;
}

export interface Generated { tasks: TaskRecord[]; keys: Record<string, KeyRecord>; fixtures: { schema: string; bank_id: string; test_only: boolean; bank_sha256: string; seed_sha256: string; tasks: Record<string, FixtureIdentity> } }

/** Generates every task of a bank into outDir (missing or empty) and writes tasks.json, keys.json and fixtures.json. */
export function generate(bankText: string, seed: string, outDir: string): Generated {
  if (!seed) throw new Error('edition-fixture: the seed must be a non-empty string');
  const bank = JSON.parse(bankText) as Bank;
  const problems = bankProblems(bank);
  if (problems.length) throw new Error('edition-fixture: invalid bank:\n  ' + problems.join('\n  '));
  const out = resolve(outDir);
  if (!bank.test_only && !relative(REPO_ROOT, out).startsWith('..')) throw new Error('edition-fixture: ' + bank.bank_id + ' is not a test-only bank, so it may not be written inside this checkout (' + out + ')');
  if (existsSync(out) && readdirSync(out).length) throw new Error('edition-fixture: ' + out + ' is not empty');
  mkdirSync(join(out, 'repos'), { recursive: true });
  const counters: Record<string, number> = {};
  const gen: Generated = { tasks: [], keys: {}, fixtures: { schema: BANK_SCHEMA, bank_id: bank.bank_id, test_only: bank.test_only, bank_sha256: sha256(bankText), seed_sha256: sha256(seed), tasks: {} } };
  const failures: string[] = [];
  for (const raw of bank.templates) {
    const vars = Object.fromEntries(Object.keys(raw.vars ?? {}).sort().map((name) => { const values = raw.vars![name]!; return [name, values[pickIndex(seed, raw.id, name, values.length)]!]; }));
    const t: Template = { ...substitute({ request: raw.request, commits: raw.commits, checkout: raw.checkout, key: raw.key }, vars), id: raw.id, family: raw.family };
    counters[t.family] = (counters[t.family] ?? 0) + 1;
    const id = ID_PREFIX[t.family] + '-' + String(counters[t.family]).padStart(2, '0');
    const dir = join(out, 'repos', id);
    const { identity, files } = buildRepo(dir, t);
    const hunks = t.family === 'review' ? diffHunks(dir, (t.key as ReviewKey).base, t.checkout) : [];
    const repoProblems = keyRepoProblems(t, files, hunks);
    if (repoProblems.length) { failures.push(...repoProblems.map((m) => t.id + ': ' + m)); continue; }
    gen.tasks.push({ id, family: t.family, request: t.request, repo_dir: dir, first_step: { skill: t.family } });
    gen.keys[id] = t.family === 'review'
      ? { family: 'review', template: t.id, vars, key: { ...(t.key as ReviewKey), diff_files: [...new Set(hunks.map((h) => h.file))], hunks } }
      : ({ family: t.family, template: t.id, vars, key: t.key } as KeyRecord);
    gen.fixtures.tasks[id] = identity;
  }
  if (failures.length) throw new Error('edition-fixture: keys do not fit their repositories:\n  ' + failures.join('\n  '));
  writeFileSync(join(out, 'tasks.json'), JSON.stringify(gen.tasks, null, 2) + '\n');
  writeFileSync(join(out, 'keys.json'), JSON.stringify(gen.keys, null, 2) + '\n');
  writeFileSync(join(out, 'fixtures.json'), JSON.stringify(gen.fixtures, null, 2) + '\n');
  return gen;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const [bankPath, seed, out] = [flag('--bank'), flag('--seed'), flag('--out')];
  if (!bankPath || !seed || !out) { console.error('usage: bun harnesses/qm/gstack/edition-fixture.ts --bank <bank.json> --seed <seed> --out <empty dir>'); process.exit(2); }
  try {
    const g = generate(readFileSync(bankPath, 'utf8'), seed, out);
    for (const t of g.tasks) console.log('edition-fixture: ' + t.id + ' ' + t.family + ' ' + g.keys[t.id]!.template + ' head ' + g.fixtures.tasks[t.id]!.head.slice(0, 12));
    console.log('edition-fixture: ' + g.tasks.length + ' tasks from ' + g.fixtures.bank_id + ' (bank sha256 ' + g.fixtures.bank_sha256.slice(0, 12) + ') in ' + resolve(out));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
