#!/usr/bin/env bun
/**
 * Decides whether a change is docs-only, so public CI can skip its heavy test steps (typecheck and `bun test tests/`)
 * while every required job still reports success.
 *
 *   bun scripts/ci/docs-only.ts --base <rev> --head <rev> [--tree <rev>]   prints docs_only=true or docs_only=false
 *   bun scripts/ci/docs-only.ts --audit [--tree <rev>]                     counts the Markdown files that would qualify
 *
 * A change is docs-only when every path it adds, edits or deletes (base...head, renames split into both paths) is a
 * Markdown file outside docs/benchmarks/, docs/scoreboard/ and the code and task trees (CODE_TREES) that nothing at
 * --tree (default HEAD) reads. Markdown fragments in changelog.d/ and todos.d/ always qualify.
 *
 * What counts as reading a Markdown file:
 *   - any non-Markdown file outside docs/benchmarks/ names its repo-relative path (so manifests and fixtures count);
 *   - a script under SCRIPT_ROOTS has a join(), resolve(), template or `+` chain that resolves to it. Constants assigned
 *     in the same file are followed. A chain with an unresolved part reads every Markdown file its literal parts allow,
 *     so every file under its literal prefix. A chain whose root is unknown (a parameter, an import, or the repo root
 *     followed by an unknown path) reads only what its literal directory or file name parts match: that path has to
 *     come from a literal some reader names, or from a listing;
 *   - such a script lists the file's directory (readdir, glob, os.walk, find, ls), or resolves a chain to a directory
 *     above it. A listing whose directory cannot be resolved lists every directory the same file resolves or names as
 *     a whole literal, recursively. A directory name that is only one part of a chain reads nothing.
 * scripts/check-links.py reads every Markdown file but is no reader here: CI runs it in the docs-only path too.
 * Anything the script cannot decide prints docs_only=false. CI runs the base commit's copy of this file, so it
 * imports nothing from the repository.
 */
import { spawnSync } from 'node:child_process';
import { posix } from 'node:path';

export const EXCLUDED = ['docs/benchmarks/', 'docs/scoreboard/'];
export const FRAGMENTS = ['changelog.d/', 'todos.d/'];
export const CODE_TREES = ['tests/', 'scripts/', 'runner/', 'world/', 'harnesses/', 'gbrain/', 'tasks/'];
export const SCRIPT_ROOTS = ['tests/', 'scripts/', 'runner/', 'world/', 'harnesses/', 'gbrain/'];
export const STILL_RUN = ['scripts/check-links.py'];

const UNKNOWN = '\0';
const UNROOTED = '\u0001';

type Tok = { t: 'str'; v: string } | { t: 'tpl'; parts: (string | Tok[])[] } | { t: 'id'; v: string } | { t: 'p'; v: string };
type Node =
  | { k: 'str'; v: string }
  | { k: 'tpl'; parts: (string | Node)[] }
  | { k: 'name'; v: string }
  | { k: 'call'; callee: string; args: Node[]; opts: Map<string, Node> }
  | { k: 'member'; obj: Node; name: string; args: Node[] | null; opts: Map<string, Node> }
  | { k: 'join'; parts: Node[]; sep: string }
  | { k: 'other' };

const OPS = ['===', '!==', '**=', '...', '==', '!=', '<=', '>=', '=>', '+=', '-=', '*=', '/=', '**', '&&', '||', '??', '?.', '//'];
const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '=>', '==', '===', '!=', '!==', '&&', '||', '??', '<=', '>=']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

export function tokenize(src: string, py: boolean): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const quoted = (q: string, multi: boolean): string => {
    let v = '';
    i += q.length;
    while (i < src.length) {
      if (src[i] === '\\') { v += src.slice(i, i + 2); i += 2; continue; }
      if (src.startsWith(q, i)) { i += q.length; return v; }
      if (!multi && src[i] === '\n') return v;
      v += src[i++];
    }
    return v;
  };
  const template = (): (string | Tok[])[] => {
    const parts: (string | Tok[])[] = [];
    let lit = '';
    i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { lit += src.slice(i, i + 2); i += 2; continue; }
      if (src.startsWith('${', i)) {
        let depth = 1, j = i + 2;
        while (j < src.length && depth > 0) {
          const c = src[j]!;
          if (c === '{') depth++;
          else if (c === '}') depth--;
          else if (c === '"' || c === "'" || c === '`') {
            const q = c;
            j++;
            while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
          }
          j++;
        }
        if (lit) parts.push(lit);
        lit = '';
        parts.push(tokenize(src.slice(i + 2, j - 1), false));
        i = j;
        continue;
      }
      lit += src[i++];
    }
    i++;
    if (lit) parts.push(lit);
    return parts;
  };
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (py ? c === '#' : src.startsWith('//', i)) { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
    if (!py && src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (py && (src.startsWith('"""', i) || src.startsWith("'''", i))) { out.push({ t: 'str', v: quoted(src.slice(i, i + 3), true) }); continue; }
    if (c === '"' || c === "'") { out.push({ t: 'str', v: quoted(c, false) }); continue; }
    if (!py && c === '`') { out.push({ t: 'tpl', parts: template() }); continue; }
    if (!py && c === '/') {
      const prev = out[out.length - 1];
      if (!prev || (prev.t === 'p' && REGEX_AFTER.has(prev.v)) || (prev.t === 'id' && REGEX_KEYWORDS.has(prev.v))) {
        let j = i + 1, cls = false;
        while (j < src.length && src[j] !== '\n' && (cls || src[j] !== '/')) {
          if (src[j] === '\\') j++;
          else if (src[j] === '[') cls = true;
          else if (src[j] === ']') cls = false;
          j++;
        }
        i = j + 1;
        while (i < src.length && /[a-z]/.test(src[i]!)) i++;
        out.push({ t: 'p', v: 'regex' });
        continue;
      }
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j]!)) j++;
      out.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i) && (py || o !== '//'));
    out.push({ t: 'p', v: op ?? c });
    i += op ? op.length : 1;
  }
  return out;
}

const isP = (tok: Tok | undefined, v: string) => tok?.t === 'p' && tok.v === v;

class Parser {
  constructor(private toks: Tok[], private py: boolean) {}

  expr(i: number): { node: Node; end: number } {
    const first = this.primary(i);
    const parts = [first.node];
    let end = first.end, sep = '';
    while (isP(this.toks[end], '+') || (this.py && isP(this.toks[end], '/'))) {
      const op = (this.toks[end] as { v: string }).v;
      if (sep && sep !== op) break;
      sep = op;
      const next = this.primary(end + 1);
      parts.push(next.node);
      end = next.end;
    }
    return parts.length === 1 ? { node: first.node, end } : { node: { k: 'join', parts, sep: sep === '+' ? '' : '/' }, end };
  }

  primary(i: number): { node: Node; end: number } {
    const tok = this.toks[i];
    let node: Node, end: number;
    if (!tok) return { node: { k: 'other' }, end: i };
    if (tok.t === 'str') { node = { k: 'str', v: tok.v }; end = i + 1; }
    else if (tok.t === 'tpl') { node = { k: 'tpl', parts: tok.parts.map((p) => (typeof p === 'string' ? p : new Parser(p, false).expr(0).node)) }; end = i + 1; }
    else if (tok.t === 'id') {
      let j = i;
      if (tok.v === 'new' && this.toks[i + 1]?.t === 'id') j = i + 1;
      let name = (this.toks[j] as { v: string }).v;
      j++;
      while ((isP(this.toks[j], '.') || isP(this.toks[j], '?.')) && this.toks[j + 1]?.t === 'id') { name += '.' + (this.toks[j + 1] as { v: string }).v; j += 2; }
      if (isP(this.toks[j], '(')) {
        const a = this.args(j);
        node = { k: 'call', callee: name, args: a.args, opts: a.opts };
        end = a.end;
      } else { node = { k: 'name', v: name }; end = j; }
    } else if (isP(tok, '(')) {
      const inner = this.expr(i + 1);
      if (!isP(this.toks[inner.end], ')')) return { node: { k: 'other' }, end: i + 1 };
      node = inner.node;
      end = inner.end + 1;
    } else return { node: { k: 'other' }, end: i + 1 };
    while ((isP(this.toks[end], '.') || isP(this.toks[end], '?.')) && this.toks[end + 1]?.t === 'id') {
      const name = (this.toks[end + 1] as { v: string }).v;
      if (isP(this.toks[end + 2], '(')) {
        const a = this.args(end + 2);
        node = { k: 'member', obj: node, name, args: a.args, opts: a.opts };
        end = a.end;
      } else { node = { k: 'member', obj: node, name, args: null, opts: new Map() }; end += 2; }
    }
    return { node, end };
  }

  args(open: number): { args: Node[]; opts: Map<string, Node>; end: number } {
    const args: Node[] = [];
    const opts = new Map<string, Node>();
    let i = open + 1;
    while (i < this.toks.length && !isP(this.toks[i], ')')) {
      const start = i;
      const e = this.expr(i);
      if (e.end > start && (isP(this.toks[e.end], ',') || isP(this.toks[e.end], ')'))) { args.push(e.node); i = e.end; }
      else {
        args.push({ k: 'other' });
        let depth = 0;
        for (; i < this.toks.length; i++) {
          const t = this.toks[i]!;
          if (t.t === 'id' && depth === 1 && isP(this.toks[i + 1], ':')) opts.set(t.v, this.expr(i + 2).node);
          if (t.t === 'id' && depth === 0 && this.py && isP(this.toks[i + 1], '=')) opts.set(t.v, this.expr(i + 2).node);
          if (isP(t, '(') || isP(t, '[') || isP(t, '{')) depth++;
          else if (isP(t, ')') || isP(t, ']') || isP(t, '}')) { if (depth === 0) break; depth--; }
          else if (isP(t, ',') && depth === 0) break;
        }
      }
      if (isP(this.toks[i], ',')) i++;
    }
    return { args, opts, end: i + 1 };
  }
}

const IDENTITY = new Set(['abspath', 'realpath', 'normpath', 'fileURLToPath', 'realpathSync', 'String', 'Path', 'PurePath', 'expanduser', 'toString']);
const LISTERS = new Set(['readdirSync', 'readdir', 'opendirSync', 'opendir', 'listdir', 'scandir', 'walk', 'iterdir']);
const GLOBBERS = new Set(['globSync', 'glob', 'iglob', 'rglob']);

export function normalizePath(s: string): string {
  let rooted = s.startsWith(UNROOTED) || s.startsWith(UNKNOWN);
  let rest = s.startsWith(UNROOTED) ? s.slice(1) : s;
  if (rest.startsWith('/') || /^[a-z]+:\/\//.test(rest)) { rooted = true; rest = rest.replace(/^[a-z]+:\/\/[^/]*/, ''); }
  const stack: string[] = [];
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (stack.length && !stack[stack.length - 1]!.includes(UNKNOWN)) stack.pop();
      else if (!stack.length) rooted = true;
      continue;
    }
    stack.push(seg);
  }
  const body = stack.join('/');
  return rooted || body.startsWith(UNKNOWN) ? UNROOTED + '/' + body : body === '' ? '.' : body;
}

class FileScan {
  consts = new Map<string, Node[]>();
  values: string[] = [];
  listings: { v: string; recursive: boolean }[] = [];
  strings: string[] = [];
  segments = new Set<string>();
  private dir: string;

  constructor(private file: string, toks: Tok[], py: boolean) {
    this.dir = posix.dirname(file);
    const p = new Parser(toks, py);
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      if (t.t === 'str') this.strings.push(t.v);
      if (t.t === 'id' && isP(toks[i + 1], '=') && !isP(toks[i - 1], '.')) this.consts.set(t.v, [...(this.consts.get(t.v) ?? []), p.expr(i + 2).node]);
    }
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      if (t.t === 'id' || t.t === 'tpl' || t.t === 'str') this.visit(p.expr(i).node);
    }
  }

  private visit(node: Node): void {
    if (node.k === 'call' || node.k === 'tpl' || node.k === 'join' || node.k === 'member') {
      const v = this.evaluate(node, new Set());
      if (v.includes('/') || v.includes(UNKNOWN)) this.values.push(v);
    }
    if (node.k === 'call') {
      const last = node.callee.split('.').pop()!;
      if (last === 'join' || last === 'resolve') for (const a of node.args) if (a.k === 'str' && !a.v.includes('/')) this.segments.add(a.v);
      const recursive = this.truthy(node.opts.get('recursive')) || node.callee === 'os.walk';
      if (LISTERS.has(last) && (last !== 'walk' || node.callee === 'os.walk')) this.listings.push({ v: this.evaluate(node.args[0] ?? { k: 'other' }, new Set()), recursive });
      else if (GLOBBERS.has(last) && (node.callee === last || /^(glob|fs|path)\./.test(node.callee))) this.listings.push({ v: this.globValue(node.args[0], node.opts.get('cwd') ?? node.opts.get('root_dir')), recursive: false });
    }
    if (node.k === 'member' && node.args) {
      const obj = node.obj;
      if ((node.name === 'scan' || node.name === 'scanSync') && obj.k === 'call' && obj.callee.split('.').pop() === 'Glob') {
        this.listings.push({ v: this.globValue(obj.args[0], node.opts.get('cwd')), recursive: false });
      } else if (node.name === 'glob' || node.name === 'rglob') {
        const base = this.evaluate(obj, new Set());
        const pattern = this.evaluate(node.args[0] ?? { k: 'other' }, new Set());
        this.listings.push({ v: normalizePath(base + '/' + (node.name === 'rglob' ? '**/' : '') + pattern), recursive: false });
      } else if (node.name === 'iterdir' || node.name === 'readdirSync') {
        this.listings.push({ v: this.evaluate(obj, new Set()), recursive: false });
      }
    }
  }

  private truthy(n: Node | undefined): boolean {
    return !!n && n.k === 'name' && (n.v === 'true' || n.v === 'True');
  }

  private globValue(pattern: Node | undefined, cwd: Node | undefined): string {
    const p = this.evaluate(pattern ?? { k: 'other' }, new Set());
    if (p.startsWith(UNROOTED) || p.startsWith(UNKNOWN)) return UNROOTED + '/' + p.replace(/^[\0\u0001]+/, '');
    return normalizePath((cwd ? this.evaluate(cwd, new Set()) : '.') + '/' + p);
  }

  evaluate(node: Node, seen: Set<string>): string {
    switch (node.k) {
      case 'str': return node.v;
      case 'tpl': return node.parts.map((p) => (typeof p === 'string' ? p : this.evaluate(p, seen))).join('');
      case 'join': return node.parts.map((p) => this.evaluate(p, seen)).join(node.sep);
      case 'name': {
        const v = node.v;
        if (['import.meta.dir', 'import.meta.dirname', '__dirname'].includes(v)) return this.dir;
        if (['import.meta.path', 'import.meta.filename', 'import.meta.url', '__filename', '__file__'].includes(v)) return this.file;
        const defs = this.consts.get(v);
        if (!defs || seen.has(v)) return UNKNOWN;
        const vals = [...new Set(defs.map((d) => this.evaluate(d, new Set([...seen, v]))))];
        return vals.length === 1 ? vals[0]! : UNKNOWN;
      }
      case 'call': {
        const last = node.callee.split('.').pop()!;
        const arg = (n: number) => this.evaluate(node.args[n] ?? { k: 'other' }, seen);
        if (last === 'join' || last === 'resolve') {
          if (!node.args.length) return UNKNOWN;
          return normalizePath(node.args.map((_, n) => arg(n)).reduce((acc, a) => (a.startsWith('/') ? a : acc + '/' + a)));
        }
        if (last === 'dirname') { const a = normalizePath(arg(0)); return a.includes(UNKNOWN) || a.startsWith(UNROOTED) ? a : posix.dirname(a); }
        if (IDENTITY.has(last)) return arg(0);
        if (last === 'cwd') return '.';
        if (last === 'URL' && node.args.length >= 2) { const base = arg(1); return base.includes(UNKNOWN) ? UNKNOWN : normalizePath(posix.dirname(base) + '/' + arg(0)); }
        return UNKNOWN;
      }
      case 'member': {
        if (['pathname', 'resolve', 'absolute', 'toString'].includes(node.name)) return this.evaluate(node.obj, seen);
        if (node.name === 'parent') { const a = normalizePath(this.evaluate(node.obj, seen)); return a.includes(UNKNOWN) || a.startsWith(UNROOTED) ? a : posix.dirname(a); }
        return UNKNOWN;
      }
      default: return UNKNOWN;
    }
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globRe(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === UNKNOWN) out += '.*';
    else if (s.startsWith('**/', i)) { out += '(?:.*/)?'; i += 2; }
    else if (s.startsWith('**', i)) { out += '.*'; i++; }
    else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '{' && s.indexOf('}', i) > i) { const e = s.indexOf('}', i); out += '(?:' + s.slice(i + 1, e).split(',').map(escapeRe).join('|') + ')'; i = e; }
    else out += escapeRe(c);
  }
  return out;
}

const pattern = (v: string, md: readonly string[]) => {
  const re = new RegExp('^' + v.split(UNKNOWN).map(escapeRe).join('.*') + '$');
  const rootOnly = !v.split(UNKNOWN).some((l) => l.includes('/'));
  return md.filter((m) => re.test(m) && !(rootOnly && m.includes('/')));
};

/**
 * The Markdown paths one path value reaches. A value with an unresolved part reaches every file its literal parts
 * allow (so every file under its literal prefix); a value whose root is unknown claims nothing unless a literal part
 * names a directory or the value ends in a literal file name.
 */
export function valueReads(raw: string, md: readonly string[]): string[] {
  const v = normalizePath(raw);
  if (!v.startsWith(UNROOTED)) return v.includes(UNKNOWN) ? pattern(v, md) : md.includes(v) ? [v] : [];
  const body = v.slice(2);
  const pieces = body.split(UNKNOWN);
  if (pieces.length === 1) return md.filter((m) => ('/' + body).endsWith('/' + m));
  const last = pieces[pieces.length - 1]!;
  const namesDir = pieces.some((l) => /\/[^/]*[^/.][^/]*\//.test(l));
  if (!namesDir && !/^\/[^/]+\.md$/.test(last)) return [];
  const re = new RegExp('^(?:.*/)?' + pieces.map(escapeRe).join('.*') + '$');
  return md.filter((m) => re.test(m));
}

/** The Markdown paths a directory listing reaches; null when the listing's directory is unknown. */
export function listingReads(raw: string, recursive: boolean, md: readonly string[]): string[] | null {
  const v = normalizePath(raw);
  const rooted = v.startsWith(UNROOTED);
  const body = rooted ? v.slice(2) : v;
  const pieces = body.split(UNKNOWN);
  if (rooted && (!/[^/.*?\0]/.test(body) || (pieces.length > 1 && !pieces.some((l) => /\/[^/]*[^/.*?][^/]*(\/|$)/.test(l))))) return null;
  const head = rooted ? '^(?:.*/)?' : '^';
  if (/[*?{]/.test(body)) {
    const re = new RegExp(head + globRe(body) + '$');
    return md.filter((m) => re.test(m));
  }
  if (body === '.') return recursive ? [...md] : md.filter((m) => !m.includes('/'));
  const re = new RegExp(head + pieces.map(escapeRe).join('.*') + (recursive ? '(?:/.*)?$' : '$'));
  return md.filter((m) => re.test(posix.dirname(m)));
}

const NAMED = /[A-Za-z0-9_.\/@+:-]*\.md(?![A-Za-z0-9_])/g;
const SCRIPT_EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts', '.py'];

/** Every Markdown path one reader file reads (the header gives the rules). */
export function readsOf(file: string, text: string, md: readonly string[], dirs: ReadonlySet<string>): Set<string> {
  const read = new Set<string>();
  const mdSet = new Set(md);
  const add = (list: Iterable<string> | null) => { for (const m of list ?? []) read.add(m); };
  const here = posix.dirname(file);
  for (const [token] of text.matchAll(NAMED)) {
    for (const cand of [token, here + '/' + token]) {
      const v = normalizePath(cand);
      if (!v.startsWith(UNROOTED)) { if (mdSet.has(v)) read.add(v); continue; }
      const segs = v.slice(2).split('/');
      for (let s = 0; s < segs.length; s++) { const tail = segs.slice(s).join('/'); if (mdSet.has(tail)) read.add(tail); }
    }
  }
  if (!SCRIPT_ROOTS.some((r) => file.startsWith(r))) return read;
  const ext = posix.extname(file);
  if (ext === '.sh' || ext === '.bash') {
    const word = (w: string) => normalizePath(w.replace(/["']/g, '').replace(/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/, UNROOTED));
    for (const line of text.split('\n')) {
      const moved = /\bcd\b|\bcwd\b|\s-C\s/.test(line);
      for (const [, w] of line.matchAll(/\bfind\s+(\S+)/g)) if (!moved || !/^['"]?\.\/?['"]?$/.test(w!)) add(listingReads(word(w!), true, md));
      for (const [, w] of line.matchAll(/\bls\s+(?:-\S+\s+)*(\S+)/g)) if (!moved) add(listingReads(word(w!), false, md));
      for (const [w] of line.matchAll(/[^\s"'=;|()<>&]*\*[^\s"'=;|()<>&]*/g)) if (w.includes('/') && !moved) add(listingReads(word(w), false, md));
    }
    return read;
  }
  if (!SCRIPT_EXTS.includes(ext)) return read;
  const scan = new FileScan(file, tokenize(text, ext === '.py'), ext === '.py');
  for (const v of scan.values) {
    add(valueReads(v, md));
    const d = normalizePath(v);
    if (dirs.has(d) && d !== '.' && d !== here) add(listingReads(d, true, md));
  }
  let unknownListing = false;
  for (const l of scan.listings) {
    const r = listingReads(l.v, l.recursive, md);
    if (r === null) unknownListing = true;
    else add(r);
  }
  if (unknownListing) {
    const named = [...scan.values, ...scan.strings.filter((s) => !scan.segments.has(s)), ...[...scan.consts.keys()].map((k) => scan.evaluate({ k: 'name', v: k }, new Set()))];
    for (const n of named) {
      for (const cand of [n, here + '/' + n]) {
        const v = normalizePath(cand);
        if (dirs.has(v) && v !== '.' && v !== here) add(listingReads(v, true, md));
      }
    }
  }
  return read;
}

export const isMarkdown = (p: string) => p.endsWith('.md');
export const isFragment = (p: string) => isMarkdown(p) && FRAGMENTS.some((f) => p.startsWith(f));

export const isReader = (p: string) => !isMarkdown(p) && !p.startsWith('docs/benchmarks/');

export interface Tree { paths: string[]; text: (path: string) => string | null }

/** Every Markdown file in the tree that a reader reads. */
export function readMarkdown(tree: Tree): Set<string> {
  const md = tree.paths.filter(isMarkdown);
  const dirs = new Set<string>(['.']);
  for (const p of tree.paths) for (let d = posix.dirname(p); d !== '.' && !dirs.has(d); d = posix.dirname(d)) dirs.add(d);
  const read = new Set<string>();
  for (const p of tree.paths) {
    if (!isReader(p) || STILL_RUN.includes(p)) continue;
    const text = tree.text(p);
    if (text !== null) for (const m of readsOf(p, text, md, dirs)) read.add(m);
  }
  return read;
}

/** Null when the change is docs-only, else the first path that disqualifies it and why. */
export function disqualifier(changed: readonly string[], read: ReadonlySet<string>): { path: string; why: string } | null {
  if (!changed.length) return { path: '', why: 'no changed paths' };
  for (const p of changed) {
    if (isFragment(p)) continue;
    if (!isMarkdown(p)) return { path: p, why: 'not Markdown' };
    const excluded = EXCLUDED.find((e) => p.startsWith(e)) ?? CODE_TREES.find((e) => p.startsWith(e));
    if (excluded) return { path: p, why: 'under ' + excluded };
    if (read.has(p)) return { path: p, why: 'read by a test, script or data file' };
  }
  return null;
}

function git(args: string[], input?: string): Buffer {
  const r = spawnSync('git', args, { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('git ' + args[0] + ' failed: ' + (r.stderr?.toString().trim().slice(0, 200) ?? ''));
  return r.stdout;
}

/** The tree at a revision: every path, and the text of each file under tests/ or scripts/ (null for binary files). */
export function gitTree(rev: string): Tree {
  const paths = git(['ls-tree', '-r', '--name-only', '-z', rev]).toString().split('\0').filter(Boolean);
  const readers = paths.filter(isReader);
  const texts = new Map<string, string | null>();
  const out = git(['cat-file', '--batch'], readers.map((p) => rev + ':' + p).join('\n') + '\n');
  let off = 0;
  for (const p of readers) {
    const nl = out.indexOf(10, off);
    const size = Number(out.subarray(off, nl).toString().split(' ')[2]);
    if (!Number.isFinite(size)) throw new Error('cat-file: no object for ' + p);
    const body = out.subarray(nl + 1, nl + 1 + size);
    off = nl + 1 + size + 1;
    texts.set(p, body.subarray(0, 8192).includes(0) ? null : body.toString('utf8'));
  }
  return { paths, text: (p) => texts.get(p) ?? null };
}

function main(argv: string[]): number {
  const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const treeRev = arg('--tree') ?? 'HEAD';
  if (argv.includes('--audit')) {
    const tree = gitTree(treeRev);
    const read = readMarkdown(tree);
    const md = tree.paths.filter(isMarkdown);
    const excluded = md.filter((p) => EXCLUDED.some((e) => p.startsWith(e))).length;
    const qualify = md.filter((p) => !disqualifier([p], read)).length;
    console.log(qualify + ' of ' + md.length + ' Markdown files at ' + treeRev + ' qualify for the docs-only path (' + excluded + ' under ' + EXCLUDED.join(' or ') + ', ' + read.size + ' read by a test, script or data file)');
    return 0;
  }
  const base = arg('--base'), head = arg('--head');
  if (!base || !head) { console.error('usage: bun scripts/ci/docs-only.ts --base <rev> --head <rev> [--tree <rev>] | --audit [--tree <rev>]'); return 2; }
  try {
    const changed = git(['diff', '--name-only', '--no-renames', '-z', base + '...' + head]).toString().split('\0').filter(Boolean);
    const bad = disqualifier(changed, readMarkdown(gitTree(treeRev)));
    console.log('docs_only=' + (bad ? 'false' : 'true'));
    console.error(bad ? 'full run: ' + (bad.path || '(empty diff)') + ': ' + bad.why : 'docs-only: ' + changed.length + ' Markdown file(s) that no test or script reads');
  } catch (e) {
    console.log('docs_only=false');
    console.error('full run: ' + (e as Error).message);
  }
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
