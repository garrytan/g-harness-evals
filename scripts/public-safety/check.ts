// The public-safety admission gate: one CLI in front of every push to the public repository. It scans every object new
// in a push (commits and their metadata, every path name, every intermediate blob, gzip and tar members) against the
// value-free rules in this folder and, when given, the private pack; it never prints matched text. Modes and exit codes
// are in docs/public-safety.md. Everything this file needs lives in this folder, so a pinned copy runs on its own.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { doctor } from './lib/doctor.ts';
import { blobId, identityProblems, maskAcceptedIdentity, parseCommit, treeIdOfDir } from './lib/git.ts';
import { isPublicRemote } from './lib/hook.ts';
import { Boundary, escapeControls } from './lib/output.ts';
import { exactHit, loadPack, packHits, type LoadedPack } from './lib/pack.ts';
import { PsError, runSync } from './lib/proc.ts';
import { catBlobs, catObjects, compileRules, expand, leafHits, nameKind, ruleApplies, ruleLines, type CompiledRule, type MarkerRule } from './lib/scan.ts';
import { gitleaks, gitleaksStdin, readLock, readyTool, type ReadyTool } from './lib/tools.ts';

export const DIR = import.meta.dir;
export const TOOL = 'public-safety/1';
const ZERO = /^0{40}$|^0{64}$/;

export interface GateRule extends MarkerRule { code: string; agent_notes_exempt?: boolean }
export interface CodeInfo { class: 'marker' | 'key' | 'private' | 'structural' | 'infra' | 'usage' | 'doctor'; allow: boolean; fix: string }
export interface RulesFile { rules: GateRule[]; spend_paths: string[]; identity: { allowed: string[]; owner_accepted: string[] }; codes: Record<string, CodeInfo> }
export interface ClassesFile {
  content_classes: Record<string, { formats: string[]; max_bytes: number; description: string }>;
  deny: { globs: string[]; except?: string[]; reason: string }[];
  classes: { name: string; globs: string[]; content_class: string }[];
}
export interface AllowEntry { code: string; path: string; line: number | number[]; member?: string; blob: string; reason: string; date: string }
export type Where =
  | { kind: 'blob'; path: string; blob: string; member?: string }
  | { kind: 'path'; path: string; blob?: string; n: number }
  | { kind: 'commit'; commit: string; field: string }
  | { kind: 'ref'; ref: string; n: number }
  | { kind: 'text' }
  | { kind: 'op'; op: string };
export interface Hit { code: string; where: Where; line?: number }

const RULES = JSON.parse(readFileSync(join(DIR, 'rules.json'), 'utf8')) as RulesFile;
const CLASSES = JSON.parse(readFileSync(join(DIR, 'classes.json'), 'utf8')) as ClassesFile;
const COMPILED: CompiledRule[] = compileRules(RULES.rules, { ownerEmails: [], custodyPatterns: [] });
const CODE_OF = new Map(RULES.rules.map((r) => [r.id, r.code]));
const IDENTITY = RULES.identity.allowed.map((p) => new RegExp(p, 'i'));
const ACCEPTED = RULES.identity.owner_accepted;
const SPEND = RULES.spend_paths.map((g) => new Bun.Glob(g));
const glob = (gs: string[]) => gs.map((g) => new Bun.Glob(g));
const DENY = CLASSES.deny.map((d) => ({ globs: glob(d.globs), except: glob(d.except ?? []) }));
const CLASS_LIST = CLASSES.classes.map((c) => ({ c, globs: glob(c.globs) }));

type Classification = { kind: 'class'; name: string; content_class: string } | { kind: 'denied' } | { kind: 'unclassified' };
const CLASSIFIED = new Map<string, Classification>();

export function classify(path: string): Classification {
  const known = CLASSIFIED.get(path);
  if (known) return known;
  const hit = CLASS_LIST.find((x) => x.globs.some((g) => g.match(path)));
  const c: Classification = DENY.some((d) => d.globs.some((g) => g.match(path)) && !d.except.some((g) => g.match(path))) ? { kind: 'denied' } : hit ? { kind: 'class', name: hit.c.name, content_class: hit.c.content_class } : { kind: 'unclassified' };
  CLASSIFIED.set(path, c);
  return c;
}

export function loadAllow(path = join(DIR, 'allow.json')): AllowEntry[] {
  const j = JSON.parse(readFileSync(path, 'utf8')) as { schema: string; entries: AllowEntry[] };
  if (j.schema !== 'harness-evals-public-safety-allow/1') throw new Error('allow.json: unknown schema');
  for (const e of j.entries) {
    if (!RULES.codes[e.code]?.allow) throw new Error('allow.json: an entry names a code that is not allowlistable');
    const lines = Array.isArray(e.line) ? e.line : [e.line];
    if (!/^[0-9a-f]{40}$/.test(e.blob) || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !e.reason?.trim() || !e.path || !lines.length || !lines.every((l) => Number.isInteger(l) && l >= 0) || (e.member !== undefined && typeof e.member !== 'string')) throw new Error('allow.json: every entry needs a code, path, line or list of lines, blob id, reason and date');
  }
  return j.entries;
}

let stage = 'start';
let stageAt = Date.now();
function enter(s: string): void {
  if (process.env.PUBLIC_SAFETY_TIMING) process.stderr.write('public-safety: stage ' + stage + ' ms=' + (Date.now() - stageAt) + '\n');
  stage = s;
  stageAt = Date.now();
  if (process.env.PUBLIC_SAFETY_TEST_FAULT === s) throw new Error('injected fault in stage ' + s);
}

const HOME = process.env.HOME ?? tmpdir();
export const CACHE_ROOT = join(process.env.XDG_CACHE_HOME || join(HOME, '.cache'), 'harness-evals', 'public-safety');
export const CONFIG_DIR = join(HOME, '.config', 'harness-evals', 'public-safety');

export function childEnv(extra: string[] = []): Record<string, string> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME, LANG: 'C.UTF-8' };
  for (const k of ['TMPDIR', 'XDG_CACHE_HOME', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', ...extra]) { const v = process.env[k]; if (v) env[k] = v; }
  return env;
}

export interface Ctx { gitDir: string; env: Record<string, string>; pack: LoadedPack | null; gate: string; work: string; allow: AllowEntry[]; boundary: Boundary; gl: ReadyTool | null; noCache: boolean; stats: { cached: number; scanned: number } }

export function git(ctx: { gitDir: string; env: Record<string, string> }, args: string[], op: string, input?: string, timeoutMs = 120_000): Buffer {
  const r = runSync(['git', '--git-dir=' + ctx.gitDir, ...args], { op, timeoutMs, env: ctx.env, input });
  if (r.status !== 0) throw new Error(op + ' exited ' + r.status);
  return r.stdout;
}

export function boundaryFor(pack: LoadedPack | null): Boundary {
  return new Boundary((s) => {
    const b = Buffer.from(s);
    if (leafHits(b, [], COMPILED, () => true).length) return true;
    if (!pack) return false;
    if (exactHit(pack, b) >= 0) return true;
    return pack.patterns.some((p) => p.re.test(s));
  });
}

const maskAgentNotes = (text: string) => {
  const lines = text.split('\n');
  let inDetails = false;
  let heading = 0;
  return lines.map((l) => {
    const h = /^(#{1,6})\s/.exec(l);
    if (heading && h && h[1]!.length <= heading) heading = 0;
    if (/^#{1,6}\s+Agent notes\b/i.test(l)) { heading = h![1]!.length; return ''; }
    if (/<summary>\s*Agent notes\s*<\/summary>/i.test(l)) { inDetails = true; return ''; }
    if (inDetails) { if (/<\/details>/i.test(l)) inDetails = false; return ''; }
    return heading ? '' : l;
  }).join('\n');
};

// Commit messages, headers, ref names and PR text: every rule applies as prose, the crew-talk rules skip a collapsed
// Agent notes section, and the private pack (shingles included) runs over the whole text.
function scanText(ctx: Ctx, text: string, contentClass: string, where: Where, out: Hit[]): void {
  const data = Buffer.from(text);
  const masked = Buffer.from(maskAgentNotes(text));
  const applies = (exempt: boolean) => (r: MarkerRule) => !!(r as GateRule).agent_notes_exempt === exempt && ruleApplies(r, 'message', contentClass);
  for (const h of [...leafHits(data, [], COMPILED, applies(false)), ...leafHits(masked, [], COMPILED, applies(true))]) out.push({ code: CODE_OF.get(h.rule)!, where, line: h.line });
  if (ctx.pack) for (const h of packHits(ctx.pack, data, true)) out.push({ code: h.code, where, line: h.line });
}

const ALLOW_PATHS = new Map(RULES.rules.map((r) => [r.id, glob(r.allow_paths ?? [])]));
const allowPath = (r: MarkerRule, path: string) => ALLOW_PATHS.get(r.id)!.some((g) => g.match(path));

export function refProblem(ref: string, env: Record<string, string>): boolean {
  if (!/^refs\/heads\/./.test(ref)) return true;
  return runSync(['git', 'check-ref-format', ref], { op: 'git check-ref-format', timeoutMs: 10_000, env }).status !== 0;
}

function loadSeen(file: string): Set<string> {
  if (!existsSync(file)) return new Set();
  return new Set(readFileSync(file, 'utf8').split('\n').filter(Boolean));
}

export async function scanRange(ctx: Ctx, base: string, head: string): Promise<{ hits: Hit[]; objects: number }> {
  enter('rev-list');
  const oids = git(ctx, ['rev-list', '--objects', '--no-object-names', head, '--not', base], 'git rev-list', undefined, 300_000).toString('latin1').split('\n').filter((l) => /^[0-9a-f]{40,64}$/.test(l));
  const hits: Hit[] = [];
  if (!oids.length) return { hits, objects: 0 };
  enter('batch-check');
  const commits: string[] = [];
  const blobSize = new Map<string, number>();
  for (const l of git(ctx, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], 'git cat-file --batch-check', oids.join('\n') + '\n', 300_000).toString('latin1').split('\n')) {
    const [o, t, s] = l.split(' ');
    if (t === 'commit') commits.push(o!);
    else if (t === 'blob') blobSize.set(o!, Number(s));
  }
  enter('diff-tree');
  const refs = new Map<string, string[]>();
  const paths = new Map<string, { blob?: string; gitlink: boolean }>();
  if (commits.length) {
    const tok = git(ctx, ['diff-tree', '--stdin', '-r', '-m', '--root', '-z', '--no-renames', '--raw', '--no-ext-diff'], 'git diff-tree', commits.join('\n') + '\n', 300_000).toString('utf8').split('\0');
    for (let i = 0; i < tok.length; i++) {
      const t = tok[i]!;
      if (!t.startsWith(':')) continue;
      const path = tok[++i]!;
      const [, mode, , dst, status] = t.split(' ');
      if (status === 'D') continue;
      if (mode === '160000') { paths.set(path, { gitlink: true }); continue; }
      if (!paths.has(path)) paths.set(path, { blob: dst, gitlink: false });
      const rs = refs.get(dst!) ?? [];
      if (!rs.includes(path)) rs.push(path);
      refs.set(dst!, rs);
    }
  }
  const known = [...refs.keys()].filter((o) => !blobSize.has(o));
  if (known.length) {
    for (const l of git(ctx, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], 'git cat-file --batch-check', known.join('\n') + '\n', 300_000).toString('latin1').split('\n')) {
      const [o, t, s] = l.split(' ');
      if (t === 'blob') blobSize.set(o!, Number(s));
    }
  }
  const meta: { text: string; where: Where }[] = [];
  enter('commits');
  for await (const o of catObjects(ctx.gitDir, commits, ctx.env)) {
    const c = parseCommit(o.data);
    for (const p of identityProblems(c, IDENTITY, ACCEPTED, ctx.pack)) hits.push({ code: p.code, where: { kind: 'commit', commit: o.oid, field: p.field } });
    const header = maskAcceptedIdentity(c.header, ACCEPTED);
    scanText(ctx, c.message, 'commit-message', { kind: 'commit', commit: o.oid, field: 'message' }, hits);
    scanText(ctx, header, 'commit-message', { kind: 'commit', commit: o.oid, field: 'header' }, hits);
    meta.push({ text: header + '\n' + c.message, where: { kind: 'commit', commit: o.oid, field: 'message' } });
  }
  enter('paths');
  let n = 0;
  for (const [path, info] of paths) {
    const where: Where = { kind: 'path', path, blob: info.blob, n: ++n };
    const cls = classify(path);
    if (info.gitlink || cls.kind !== 'class') hits.push({ code: 'PS-CLASS', where });
    if (SPEND.some((g) => g.match(path))) hits.push({ code: 'PS-SPEND-PATH', where });
    const contentClass = cls.kind === 'class' ? cls.content_class : 'unclassified';
    for (const h of leafHits(Buffer.from(path), [], COMPILED, (r) => ruleApplies(r, 'other', contentClass) && !allowPath(r, path))) hits.push({ code: CODE_OF.get(h.rule)!, where });
    if (ctx.pack) for (const h of packHits(ctx.pack, Buffer.from(path), false)) hits.push({ code: h.code, where });
    meta.push({ text: path, where });
  }
  enter('blobs');
  const seenFile = join(CACHE_ROOT, 'seen', ctx.gate.slice(0, 12) + '-' + (ctx.pack ? ctx.pack.sha256.slice(0, 12) : 'none') + '.txt');
  const seen = ctx.noCache ? new Set<string>() : loadSeen(seenFile);
  const dirty = new Set<string>();
  // An allowlist entry admits its code in its blob (and member) at its listed lines only. A rule reports the first line it
  // matches in a leaf, so when an entry applies, every line the rule matches must be listed; the first unlisted one is
  // reported.
  const add = (h: Hit, every?: () => number[]) => {
    if (h.where.kind === 'blob') {
      const w = h.where;
      const listed = RULES.codes[h.code]?.allow ? ctx.allow.filter((e) => e.code === h.code && e.path === w.path && e.blob === w.blob && e.member === w.member).flatMap((e) => (Array.isArray(e.line) ? e.line : [e.line])) : [];
      if (listed.length) {
        const open = (every ? every() : [h.line ?? 0]).find((l) => !listed.includes(l));
        if (open === undefined) return;
        h = { ...h, line: open };
      }
      dirty.add(w.blob);
    }
    hits.push(h);
  };
  const todo: string[] = [];
  for (const [oid, size] of blobSize) {
    const rs = refs.get(oid) ?? ['(unnamed)'];
    if (!refs.has(oid)) refs.set(oid, rs);
    if (rs.every((p) => seen.has(oid + '\t' + p))) { ctx.stats.cached++; continue; }
    let over = false;
    for (const p of rs) {
      const c = classify(p);
      if (c.kind === 'class' && size > CLASSES.content_classes[c.content_class]!.max_bytes) { add({ code: 'PS-SIZE', where: { kind: 'blob', path: p, blob: oid } }); over = true; }
    }
    if (!over) todo.push(oid);
  }
  const glDir = join(ctx.work, 'leaves');
  mkdirSync(glDir, { recursive: true });
  type Mapped = { start: number; oid: string; member?: string; meta?: string[] };
  const chunks: Mapped[][] = [];
  let parts: Buffer[] = [Buffer.from(GITLEAKS_TEXT_HEAD)];
  let size = 0;
  let line = GITLEAKS_HEAD_LINES + 1;
  let map: Mapped[] = [];
  const flush = () => {
    if (!map.length) return;
    writeFileSync(join(glDir, String(chunks.length)), Buffer.concat(parts));
    chunks.push(map);
    parts = [Buffer.from(GITLEAKS_TEXT_HEAD)];
    map = [];
    size = 0;
    line = GITLEAKS_HEAD_LINES + 1;
  };
  for await (const { oid, data } of catBlobs(ctx.gitDir, todo, ctx.env)) {
    ctx.stats.scanned++;
    const views = refs.get(oid)!.map((path) => { const c = classify(path); return { path, cls: c.kind === 'class' ? c.content_class : null }; });
    const ex = expand(data);
    for (const v of views) {
      if (!v.cls) continue;
      for (const p of ex.problems) add({ code: 'PS-FORMAT', where: { kind: 'blob', path: v.path, blob: oid, member: p.member || undefined } });
      if (!CLASSES.content_classes[v.cls]!.formats.includes(ex.format)) add({ code: 'PS-FORMAT', where: { kind: 'blob', path: v.path, blob: oid } });
    }
    for (const leaf of ex.leaves) {
      const member = leaf.member || undefined;
      const lv = views.map((v) => ({ ...v, kind: nameKind(v.path, leaf.member) }));
      const ok = (r: MarkerRule, v: (typeof lv)[number]) => ruleApplies(r, v.kind, v.cls ?? 'unclassified') && !allowPath(r, v.path);
      for (const h of leafHits(leaf.data, [], COMPILED, (r) => lv.some((v) => ok(r, v)))) {
        const compiled = COMPILED.find((c) => c.rule.id === h.rule)!;
        const rule = compiled.rule as GateRule;
        for (const v of lv) if (ok(rule, v)) add({ code: rule.code, where: { kind: 'blob', path: v.path, blob: oid, member }, line: h.line }, () => ruleLines(leaf.data, compiled));
      }
      if (ctx.pack) for (const h of packHits(ctx.pack, leaf.data, leaf.format === 'text')) for (const v of lv) add({ code: h.code, where: { kind: 'blob', path: v.path, blob: oid, member }, line: h.line });
      map.push({ start: line, oid, member, meta: leaf.meta ? leaf.data.toString('utf8').split('\n') : undefined });
      parts.push(leaf.data, Buffer.from('\n'));
      let nl = 0;
      for (let i = leaf.data.indexOf(10); i >= 0; i = leaf.data.indexOf(10, i + 1)) nl++;
      line += nl + 1;
      size += leaf.data.length + 1;
      if (size >= 8 * 2 ** 20) flush();
    }
  }
  enter('gitleaks');
  if (!ctx.gl) throw new PsError('PS-TOOL-DOWNLOAD', 'gitleaks is not ready');
  const config = join(DIR, 'gitleaks.toml');
  flush();
  if (chunks.length) {
    const r = gitleaks(ctx.gl, glDir, config, join(ctx.work, 'gl'), ctx.env);
    if (!r.ok) throw new PsError('PS-INTERNAL', 'gitleaks did not complete (' + r.error + ')');
    for (const f of r.findings) {
      const cm = chunks[Number(basename(f.file))];
      if (!cm) throw new PsError('PS-INTERNAL', 'gitleaks reported a file the gate did not write');
      const at = f.line ?? 1;
      let i = cm.length - 1;
      while (i > 0 && cm[i]!.start > at) i--;
      const m = cm[i]!;
      const flagged = m.meta?.[at - m.start];
      if (flagged) ctx.boundary.withhold(flagged);
      for (const path of refs.get(m.oid)!) add({ code: 'PS-GITLEAKS', where: { kind: 'blob', path, blob: m.oid, member: m.member }, line: at - m.start + 1 });
    }
  }
  if (meta.length) glMeta(ctx, meta, hits);
  rmSync(glDir, { recursive: true, force: true });
  if (!ctx.noCache) {
    const lines = todo.filter((o) => !dirty.has(o)).flatMap((o) => refs.get(o)!.filter((p) => !/[\r\n]/.test(p)).map((p) => o + '\t' + p));
    if (lines.length) { mkdirSync(join(CACHE_ROOT, 'seen'), { recursive: true }); appendFileSync(seenFile, lines.join('\n') + '\n'); }
  }
  return { hits, objects: oids.length };
}

// gitleaks skips a file or stream whose bytes sniff as a binary type, at offset 0 (SQLite, gzip, %PDF-) or further in
// (tar at 257, ISO 9660 at 32769), so every chunk and stdin stream starts with 64 KiB of plain text lines and the line
// maps start after them.
const GITLEAKS_HEAD_LINES = 64;
const GITLEAKS_TEXT_HEAD = ('public-safety gitleaks input ' + '.'.repeat(994) + '\n').repeat(GITLEAKS_HEAD_LINES);

// Messages and metadata go to gitleaks through stdin; a finding's line maps back to the segment it came from.
function glMeta(ctx: Ctx, meta: { text: string; where: Where }[], hits: Hit[]): void {
  const starts: number[] = [];
  let line = GITLEAKS_HEAD_LINES + 1;
  for (const m of meta) { starts.push(line); line += m.text.split('\n').length; }
  const r = gitleaksStdin(ctx.gl!, GITLEAKS_TEXT_HEAD + meta.map((m) => m.text).join('\n'), join(DIR, 'gitleaks.toml'), join(ctx.work, 'gl'), ctx.env);
  if (!r.ok) throw new PsError('PS-INTERNAL', 'gitleaks did not complete on messages (' + r.error + ')');
  for (const f of r.findings) {
    let i = starts.length - 1;
    while (i > 0 && starts[i]! > (f.line ?? 1)) i--;
    hits.push({ code: 'PS-GITLEAKS', where: meta[i]!.where, line: (f.line ?? 1) - starts[i]! + 1 });
  }
}

const docs = (code: string) => 'docs/public-safety.md#' + code.toLowerCase();
const corr = (code: string, locator: string, line: number) => createHash('sha256').update('public-safety-corr\0' + code + '\0' + locator + '\0' + line).digest('hex').slice(0, 12);

function locatorOf(b: Boundary, w: Where): string {
  switch (w.kind) {
    case 'blob': { const raw = w.path + (w.member ? '|' + w.member : ''); return b.name(raw, 'obj:' + w.blob.slice(0, 12)); }
    case 'path': return b.name(w.path, w.blob ? 'obj:' + w.blob.slice(0, 12) : 'path#' + w.n);
    case 'commit': return 'commit:' + w.commit.slice(0, 12) + ':' + w.field;
    case 'ref': return b.name('ref:' + w.ref, 'ref#' + w.n);
    case 'text': return 'text';
    case 'op': return 'op:' + w.op;
  }
}

export interface Rendered { code: string; locator: string; line: number; fix: string; docs: string; corr?: string }

export function render(b: Boundary, hits: Hit[]): Rendered[] {
  const seen = new Set<string>();
  const out: Rendered[] = [];
  const ci = !!process.env.GITHUB_ACTIONS;
  for (const h of hits) {
    if (h.code === 'PS-GITLEAKS' && h.where.kind === 'path') b.withhold(h.where.path);
    if (h.code === 'PS-GITLEAKS' && h.where.kind === 'ref') b.withhold(h.where.ref);
  }
  for (const h of hits) {
    const info = RULES.codes[h.code] ?? RULES.codes['PS-INTERNAL']!;
    let locator = locatorOf(b, h.where);
    let line = h.line ?? 0;
    let id: string | undefined;
    if (info.class === 'key' || info.class === 'private') {
      id = corr(h.code, locator, line);
      if (ci) { locator = 'corr:' + id; line = 0; }
    }
    const key = h.code + '\0' + locator + '\0' + line;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code: h.code, locator, line, fix: info.fix, docs: docs(h.code), corr: id });
  }
  return out;
}

export function findingLine(f: Rendered): string {
  if (f.corr && process.env.GITHUB_ACTIONS) return f.code + ' corr=' + f.corr;
  return f.code + ' ' + f.locator + ':' + f.line + ' fix: ' + f.fix + ' docs: ' + f.docs + (f.corr ? ' corr=' + f.corr : '');
}

const USAGE = [
  'usage:',
  '  bun scripts/public-safety/check.ts --base <ref> --head <ref> [--ref refs/heads/<name>] [--private-pack <path>] [--pin <path>] [--json]',
  '  bun scripts/public-safety/check.ts --pr-text <file> [--private-pack <path>] [--pin <path>] [--json]',
  '  bun scripts/public-safety/check.ts --hook <remote-name> <remote-url> --private-pack <path> [--pin <path>]   (pre-push lines on stdin)',
  '  bun scripts/public-safety/check.ts --doctor [--pack <path>] [--pin <path>]',
  '  bun scripts/public-safety/check.ts --allow <code> <path>:<line>[,<line>...] --reason <text>',
].join('\n');

export interface Args { mode: 'range' | 'text' | 'hook' | 'doctor' | 'allow'; base?: string; head?: string; ref?: string; text?: string; remote?: string; url?: string; pack?: string; pin?: string; json: boolean; noCache: boolean; allowCode?: string; allowAt?: string; reason?: string }

const usage = (msg: string) => new PsError('PS-USAGE', msg);

export function parseArgs(argv: string[]): Args {
  const a: Partial<Args> & { json: boolean; noCache: boolean } = { json: false, noCache: false };
  const modes: Args['mode'][] = [];
  const val = (i: number, flag: string) => { const v = argv[i]; if (v === undefined || v.startsWith('--')) throw usage(flag + ' needs a value'); return v; };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]!;
    switch (f) {
      case '--base': a.base = val(++i, f); if (!modes.includes('range')) modes.push('range'); break;
      case '--head': a.head = val(++i, f); if (!modes.includes('range')) modes.push('range'); break;
      case '--ref': a.ref = val(++i, f); break;
      case '--pr-text': a.text = val(++i, f); modes.push('text'); break;
      case '--hook': a.remote = val(++i, f); a.url = val(++i, f); modes.push('hook'); break;
      case '--doctor': modes.push('doctor'); break;
      case '--allow': a.allowCode = val(++i, f); a.allowAt = val(++i, f); modes.push('allow'); break;
      case '--reason': a.reason = val(++i, f); break;
      case '--private-pack': case '--pack': a.pack = val(++i, f); break;
      case '--pin': a.pin = val(++i, f); break;
      case '--json': a.json = true; break;
      case '--no-cache': a.noCache = true; break;
      default: throw usage('unknown argument ' + JSON.stringify(f));
    }
  }
  if (modes.length !== 1) throw usage(modes.length ? 'choose one mode, not ' + modes.join(' and ') : 'no mode given');
  a.mode = modes[0]!;
  if (a.mode === 'range' && (!a.base || !a.head)) throw usage(a.base ? '--head is missing' : '--base is missing');
  if (a.mode === 'allow' && !a.reason?.trim()) throw usage('--reason is missing');
  if (a.mode !== 'range' && a.ref) throw usage('--ref only goes with --base and --head');
  return a as Args;
}

function resolveCommit(ctx: { gitDir: string; env: Record<string, string> }, rev: string, code: string, what: string): string {
  const r = runSync(['git', '--git-dir=' + ctx.gitDir, 'rev-parse', '--verify', '--quiet', '--end-of-options', rev + '^{commit}'], { op: 'git rev-parse', timeoutMs: 30_000, env: ctx.env });
  if (r.status !== 0) throw new PsError(code, what + ' is not a commit in this repository');
  return r.stdout.toString('latin1').trim();
}

export function gitDirOf(env: Record<string, string>): string {
  const r = runSync(['git', 'rev-parse', '--absolute-git-dir'], { op: 'git rev-parse', timeoutMs: 30_000, env: { ...env, ...childEnv(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) } });
  if (r.status !== 0) throw usage('run check.ts inside a git repository');
  return r.stdout.toString('utf8').trim();
}

export function readyGitleaks(env: Record<string, string>, work: string): ReadyTool {
  const lock = readLock(join(DIR, 'tools.lock'));
  return readyTool('gitleaks', lock.tools.gitleaks!, { cache: join(CACHE_ROOT, 'tools'), dest: join(work, 'bin'), env });
}

let boundary = boundaryFor(null);
let gateTree = '';
let packSha: string | null = null;
let jsonMode = false;

function emit(result: 'pass' | 'fail' | 'error', findings: Rendered[], lines: string[]): void {
  if (jsonMode) {
    const clean = findings.map((f) => ({ code: f.code, locator: escapeControls(f.locator), line: f.line, fix: f.fix, docs: f.docs }));
    boundary.out(JSON.stringify({ schema: 1, result, findings: clean, tool: TOOL + ' gitleaks ' + readLock(join(DIR, 'tools.lock')).tools.gitleaks!.version, gate: gateTree, pack: packSha }));
    return;
  }
  for (const f of findings) boundary.out(findingLine(f));
  for (const l of lines) boundary.out(l);
}

const receipt = (ref: string, head: string, objects: number) => 'PUBLIC_SAFETY: ok ref=' + ref + ' head=' + head + ' gate=' + gateTree.slice(0, 12) + ' pack=' + (packSha ? packSha.slice(0, 12) : 'none') + ' objects=' + objects;

async function run(argv: string[]): Promise<number> {
  enter('args');
  const a = parseArgs(argv);
  jsonMode = a.json;
  gateTree = treeIdOfDir(DIR);
  const env = childEnv();
  if (a.mode === 'doctor') {
    enter('doctor');
    const r = await doctor({ pack: a.pack ?? join(CONFIG_DIR, 'pack.json'), pin: a.pin ?? join(CONFIG_DIR, 'pack.sha256'), env, cacheRoot: CACHE_ROOT, cwd: process.cwd() });
    boundary.out(r.codes.length ? 'public-safety: fail ' + r.codes.join(' ') : 'public-safety: ok');
    return r.codes.length ? (r.codes.some((c) => RULES.codes[c]?.class === 'infra') ? 3 : 1) : 0;
  }
  if (a.mode === 'allow') return allowEntry(a, env);
  if (a.mode === 'hook' && !(process.env.PUBLIC_SAFETY_TEST_FORCE_PUBLIC === '1' || isPublicRemote(a.url!))) {
    boundary.out('PUBLIC_SAFETY: not-public remote');
    return 0;
  }
  enter('pack');
  if (a.mode === 'hook' && !a.pack) throw new PsError('PS-PACK-MISSING', 'a push to the public repository needs the private pack (--private-pack)');
  const pack = a.pack ? loadPack(resolve(a.pack), resolve(a.pin ?? join(CONFIG_DIR, 'pack.sha256'))) : null;
  packSha = pack?.sha256 ?? null;
  boundary = boundaryFor(pack);
  if (a.mode === 'hook' && pack!.pack.gate_tree !== gateTree) throw new PsError('PS-GATE-TREE', 'this gate copy is not the tree the private pack pins');
  const work = mkdtempSync(join(tmpdir(), 'public-safety-'));
  try {
    enter('tools');
    const ctx: Ctx = { gitDir: '', env, pack, gate: gateTree, work, allow: loadAllow(), boundary, gl: null, noCache: a.noCache, stats: { cached: 0, scanned: 0 } };
    if (a.mode === 'text') return await textMode(ctx, a);
    ctx.gitDir = gitDirOf(env);
    const jobs: { ref: string; base: string | null; head: string; n: number }[] = [];
    const hits: Hit[] = [];
    const refTexts: { text: string; where: Where }[] = [];
    if (a.mode === 'range') {
      enter('refs');
      if (a.ref) refCheck(ctx, a.ref, 1, hits, refTexts);
      const base = resolveCommit(ctx, a.base!, 'PS-BASE', 'the base');
      const head = resolveCommit(ctx, a.head!, 'PS-USAGE', '--head');
      jobs.push({ ref: a.ref ?? a.head!, base, head, n: 1 });
    } else {
      enter('refs');
      const input = await Bun.stdin.text();
      let n = 0;
      for (const l of input.split('\n')) {
        if (!l.trim()) continue;
        const [, lsha, rref, rsha, extra] = l.trim().split(/\s+/);
        if (!lsha || !rsha || extra !== undefined || !/^[0-9a-f]{40,64}$/.test(lsha) || !/^[0-9a-f]{40,64}$/.test(rsha)) throw usage('malformed pre-push line ' + ++n);
        n++;
        if (!refCheck(ctx, rref!, n, hits, refTexts)) continue;
        if (ZERO.test(lsha)) { jobs.push({ ref: rref!, base: null, head: lsha, n }); continue; }
        let base: string;
        if (ZERO.test(rsha)) {
          const mb = runSync(['git', '--git-dir=' + ctx.gitDir, 'merge-base', lsha, 'refs/remotes/' + a.remote + '/main'], { op: 'git merge-base', timeoutMs: 60_000, env });
          if (mb.status !== 0) throw new PsError('PS-BASE', 'no merge base with the fetched public main (refs/remotes/<remote>/main)');
          base = mb.stdout.toString('latin1').trim();
        } else base = resolveCommit(ctx, rsha, 'PS-BASE', 'the remote sha');
        jobs.push({ ref: rref!, base, head: resolveCommit(ctx, lsha, 'PS-USAGE', 'the local sha'), n });
      }
    }
    const lines: string[] = [];
    const scanned = jobs.filter((j) => j.base);
    if (scanned.length || refTexts.length) ctx.gl = readyGitleaks(env, work);
    if (refTexts.length) glMeta(ctx, refTexts, hits);
    for (const j of jobs) {
      if (!j.base) { lines.push(receipt(j.ref, j.head, 0)); continue; }
      const t0 = Date.now();
      const r = await scanRange(ctx, j.base, j.head);
      hits.push(...r.hits);
      if (!r.hits.length) lines.push(receipt(j.ref, j.head, r.objects));
      if (process.env.PUBLIC_SAFETY_TIMING) process.stderr.write('public-safety: timing ms=' + (Date.now() - t0) + ' objects=' + r.objects + ' scanned=' + ctx.stats.scanned + ' cached=' + ctx.stats.cached + '\n');
    }
    const findings = render(boundary, hits);
    emit(findings.length ? 'fail' : 'pass', findings, findings.length ? [] : lines);
    return findings.length ? 1 : 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// A ref name, refused or not, goes through the same rule, pack and gitleaks scan as a message.
function refCheck(ctx: Ctx, ref: string, n: number, hits: Hit[], texts: { text: string; where: Where }[]): boolean {
  const where: Where = { kind: 'ref', ref, n };
  scanText(ctx, ref, 'ref-name', where, hits);
  texts.push({ text: ref, where });
  if (refProblem(ref, ctx.env)) { hits.push({ code: 'PS-REF', where }); return false; }
  return true;
}

async function textMode(ctx: Ctx, a: Args): Promise<number> {
  enter('text');
  if (!existsSync(a.text!) || !statSync(a.text!).isFile()) throw usage('--pr-text names no file');
  const bytes = readFileSync(a.text!);
  const hits: Hit[] = [];
  scanText(ctx, bytes.toString('utf8'), 'pr-text', { kind: 'text' }, hits);
  ctx.gl = readyGitleaks(ctx.env, ctx.work);
  glMeta(ctx, [{ text: bytes.toString('utf8'), where: { kind: 'text' } }], hits);
  const findings = render(boundary, hits);
  const lines = findings.length ? [] : ctx.pack ? ['PUBLIC_SAFETY: ok text=' + createHash('sha256').update(bytes).digest('hex')] : ['not authorizing'];
  if (!ctx.pack && findings.length) lines.push('not authorizing');
  emit(findings.length ? 'fail' : 'pass', findings, lines);
  return findings.length ? 1 : 0;
}

function allowEntry(a: Args, env: Record<string, string>): number {
  const code = a.allowCode!;
  if (!RULES.codes[code]) throw usage('unknown code ' + JSON.stringify(code));
  if (!RULES.codes[code]!.allow) throw usage(code + ' is not allowlistable');
  const m = /^(.+):(\d+(?:,\d+)*)$/.exec(a.allowAt!);
  if (!m) throw usage('the location must be <path>:<line> or <path>:<line>,<line>,...');
  const lines = [...new Set(m[2]!.split(',').map(Number))];
  const top = runSync(['git', 'rev-parse', '--show-toplevel'], { op: 'git rev-parse', timeoutMs: 30_000, env }).stdout.toString('utf8').trim() || process.cwd();
  const file = resolve(m[1]!);
  if (!existsSync(file) || !statSync(file).isFile()) throw usage('no file at the given path');
  const entry: AllowEntry = { code, path: relative(top, file), line: lines.length === 1 ? lines[0]! : lines, blob: blobId(readFileSync(file)), reason: a.reason!.trim(), date: new Date().toISOString().slice(0, 10) };
  boundary.out(JSON.stringify(entry));
  return 0;
}

export function exitFor(code: string): number {
  const c = RULES.codes[code]?.class;
  return c === 'usage' ? 2 : c === 'infra' || !c ? 3 : 1;
}

function fail(e: unknown): number {
  const code = e instanceof PsError && RULES.codes[e.code] ? e.code : 'PS-INTERNAL';
  const finding: Rendered = { code, locator: 'op:' + stage, line: 0, fix: RULES.codes[code]!.fix, docs: docs(code) };
  const msg = e instanceof Error ? e.message : String(e);
  const lines: string[] = [];
  if (code === 'PS-INTERNAL') {
    const dir = mkdtempSync(join(tmpdir(), 'public-safety-trace-'));
    const trace = join(dir, 'trace.txt');
    writeFileSync(trace, '');
    boundary.file(trace, 'tool ' + TOOL + ' gate ' + (gateTree || 'unknown') + ' operation ' + stage);
    boundary.file(trace, (e instanceof Error && e.stack) || msg);
    lines.push('public-safety: internal error in operation ' + stage + ', tool ' + TOOL + ', trace ' + trace);
  } else lines.push('public-safety: ' + msg);
  if (jsonMode) emit('error', [finding], []);
  else boundary.out(findingLine(finding));
  for (const l of lines) boundary.err(l);
  if (code === 'PS-USAGE') boundary.err(USAGE);
  return exitFor(code);
}

if (import.meta.main) {
  run(process.argv.slice(2)).then((c) => process.exit(c), (e) => process.exit(fail(e)));
}
