// The value-free scanning core of the public-safety gate, shared with the public export: stream objects out of git,
// open gzip and tar containers within a budget, and match marker rules. Every finding names a rule, a path, a blob and a
// container member, never the text that matched.
import { gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';
import { sniff, type Format } from './format.ts';
import { spawnBounded } from './proc.ts';

export const BUDGET = { maxDepth: 4, maxContainerBytes: 512 * 2 ** 20, maxFileBytes: 2 * 2 ** 30, maxMembers: 200_000 };
export type Budget = typeof BUDGET;
export type ProblemKind = 'unsupported' | 'corrupt' | 'over-budget';
// A meta leaf is archive metadata (member names, header fields) whose lines can reappear inside locators.
export interface Leaf { member: string; format: Format; data: Buffer; meta?: boolean }
export interface Problem { member: string; kind: ProblemKind; detail: string }
export interface Expansion { format: Format; leaves: Leaf[]; problems: Problem[]; containers: number }

const GIT_OBJECT = /\.git\/objects\/[0-9a-f]{2}\/[0-9a-f]{38}$/;

interface TarEntry { name: string; kind: 'file' | 'dir' | 'link' | 'other'; typeflag: string; data: Buffer }

const cstr = (b: Buffer) => { const z = b.indexOf(0); return (z >= 0 ? b.subarray(0, z) : b).toString('utf8'); };

// Every text field of every tar header (link targets, owner names, a name that a long-name or pax record replaced),
// the GNU long-name and long-link records, the pax extended and global records, and whatever follows the first all-zero
// block once whole zero blocks are skipped: none of it is a member, so expand() scans it as metadata leaves.
export interface TarScan { entries: TarEntry[]; meta: string[]; trailing?: Buffer; error?: string }

export function tarEntries(buf: Buffer): TarScan {
  const entries: TarEntry[] = [];
  const meta: string[] = [];
  let off = 0;
  let longName: string | undefined;
  let paxPath: string | undefined;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) {
      let rest = off + 512;
      while (rest + 512 <= buf.length && buf.subarray(rest, rest + 512).every((b) => b === 0)) rest += 512;
      const trailing = buf.subarray(rest);
      return { entries, meta, trailing: trailing.some((b) => b !== 0) ? trailing : undefined };
    }
    const stored = parseInt(cstr(h.subarray(148, 156)).trim(), 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i]!;
    if (stored !== sum) return { entries, meta, error: 'tar header checksum does not match' };
    if (h[124]! & 0x80) return { entries, meta, error: 'tar entry uses a base-256 size' };
    const size = parseInt(cstr(h.subarray(124, 136)).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0) return { entries, meta, error: 'tar entry size is not a number' };
    const start = off + 512;
    if (start + size > buf.length) return { entries, meta, error: 'tar entry runs past the end of the archive' };
    const data = buf.subarray(start, start + size);
    off = start + Math.ceil(size / 512) * 512;
    const typeflag = h[156] === 0 ? '0' : String.fromCharCode(h[156]!);
    const prefix = cstr(h.subarray(345, 500));
    const own = (prefix ? prefix + '/' : '') + cstr(h.subarray(0, 100));
    meta.push(...[cstr(h.subarray(157, 257)), cstr(h.subarray(265, 297)), cstr(h.subarray(297, 329))].filter(Boolean));
    if ('LKxg'.includes(typeflag)) {
      meta.push(own, data.toString('utf8'));
      if (typeflag === 'L') longName = cstr(data);
      if (typeflag === 'x') paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'))?.[1];
      continue;
    }
    const name = paxPath ?? longName ?? own;
    if (name !== own) meta.push(own);
    longName = paxPath = undefined;
    const kind = typeflag === '0' || typeflag === '7' ? 'file' : typeflag === '5' ? 'dir' : typeflag === '1' || typeflag === '2' ? 'link' : 'other';
    entries.push({ name, kind, typeflag, data });
  }
  return { entries, meta, error: 'tar archive has no end-of-archive marker' };
}

// The FEXTRA, FNAME and FCOMMENT fields of every member of a gzip stream; gunzipSync decodes the members but drops them.
function gzipHeaders(buf: Buffer, maxOutputLength: number): Buffer[] {
  const out: Buffer[] = [];
  let off = 0;
  while (off + 10 <= buf.length && buf[off] === 0x1f && buf[off + 1] === 0x8b) {
    const flags = buf[off + 3]!;
    let p = off + 10;
    if (flags & 4) { const n = buf.readUInt16LE(p); out.push(buf.subarray(p + 2, p + 2 + n)); p += 2 + n; }
    for (const bit of [8, 16]) {
      if (!(flags & bit)) continue;
      const z = buf.indexOf(0, p);
      if (z < 0) throw new Error('gzip header field has no terminator');
      out.push(buf.subarray(p, z));
      p = z + 1;
    }
    if (flags & 2) p += 2;
    const r = inflateRawSync(buf.subarray(p), { info: true, maxOutputLength } as object) as unknown as { engine: { bytesWritten: number } };
    off = p + r.engine.bytesWritten + 8;
  }
  return out;
}

export function expand(data: Buffer, budget: Budget = BUDGET): Expansion {
  const out: Expansion = { format: sniff(data), leaves: [], problems: [], containers: 0 };
  let total = 0;
  let members = 0;
  // A loose git object inside an archived repository: inflate it, then scan a blob, commit or tag body as content and a
  // tree (binary entry lists) as it is.
  const gitObject = (buf: Buffer, member: string, depth: number): void => {
    out.containers++;
    let raw: Buffer;
    try {
      raw = inflateSync(buf, { maxOutputLength: budget.maxContainerBytes });
    } catch (e) {
      const big = (e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE';
      out.problems.push({ member, kind: big ? 'over-budget' : 'corrupt', detail: big ? 'git object expands past ' + budget.maxContainerBytes + ' bytes' : 'git object does not inflate' });
      out.leaves.push({ member, format: 'binary', data: buf });
      return;
    }
    const z = raw.indexOf(0);
    const type = raw.subarray(0, Math.max(z, 0)).toString('latin1').split(' ')[0];
    if (z < 0 || !['blob', 'tree', 'commit', 'tag'].includes(type ?? '')) { out.problems.push({ member, kind: 'corrupt', detail: 'not a git object' }); out.leaves.push({ member, format: 'binary', data: buf }); return; }
    if (type === 'tree') { out.leaves.push({ member: member + '|tree', format: 'git-object', data: raw }); return; }
    visit(raw.subarray(z + 1), member + '|' + type, depth);
  };
  const visit = (buf: Buffer, member: string, depth: number): void => {
    const format = sniff(buf);
    total += buf.length;
    if (total > budget.maxFileBytes) { out.problems.push({ member, kind: 'over-budget', detail: 'decoded contents pass ' + budget.maxFileBytes + ' bytes' }); return; }
    if ((format === 'gzip' || format === 'tar') && depth >= budget.maxDepth) {
      out.problems.push({ member, kind: 'over-budget', detail: 'containers nest deeper than ' + budget.maxDepth });
      out.leaves.push({ member, format, data: buf });
      return;
    }
    if (format === 'gzip') {
      out.containers++;
      let decoded: Buffer;
      let header: Buffer[];
      try {
        decoded = gunzipSync(buf, { maxOutputLength: budget.maxContainerBytes });
        header = gzipHeaders(buf, budget.maxContainerBytes);
      } catch (e) {
        const big = (e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE';
        out.problems.push({ member, kind: big ? 'over-budget' : 'corrupt', detail: big ? 'gzip expands past ' + budget.maxContainerBytes + ' bytes' : 'gzip stream does not decode' });
        out.leaves.push({ member, format, data: buf });
        return;
      }
      if (header.length) out.leaves.push({ member: (member ? member + '|' : '') + 'gzip-header', format: 'text', data: Buffer.from(header.map((b) => b.toString('utf8')).join('\n')), meta: true });
      visit(decoded, member ? member + '|gunzip' : 'gunzip', depth + 1);
      return;
    }
    if (format === 'tar') {
      out.containers++;
      const { entries, meta, trailing, error } = tarEntries(buf);
      if (error) { out.problems.push({ member, kind: 'corrupt', detail: error }); out.leaves.push({ member, format, data: buf }); return; }
      const at = (s: string) => (member ? member + '|' : '') + s;
      out.leaves.push({ member: at('names'), format: 'text', data: Buffer.from(entries.map((e) => e.name).join('\n')), meta: true });
      if (meta.length) out.leaves.push({ member: at('headers'), format: 'text', data: Buffer.from(meta.join('\n')), meta: true });
      if (trailing) visit(trailing, at('trailing'), depth + 1);
      for (const e of entries) {
        if (++members > budget.maxMembers) { out.problems.push({ member, kind: 'over-budget', detail: 'more than ' + budget.maxMembers + ' archive members' }); return; }
        const m = (member ? member + '|' : '') + e.name;
        if (e.kind === 'file' && GIT_OBJECT.test(e.name)) gitObject(e.data, m, depth + 1);
        else if (e.kind === 'file') visit(e.data, m, depth + 1);
        else if (e.kind === 'other') out.problems.push({ member: m, kind: 'unsupported', detail: 'tar entry type ' + JSON.stringify(e.typeflag) });
      }
      return;
    }
    if (!['text', 'empty', 'sqlite', 'git-index'].includes(format)) out.problems.push({ member, kind: 'unsupported', detail: format + ' content is not decoded' });
    out.leaves.push({ member, format, data: buf });
  };
  visit(data, '', 0);
  return out;
}

export interface Needle { name: string; part: 'full' | 'head16' | 'tail12'; bytes: Buffer }

export function lineAt(data: Buffer, offset: number): number {
  let n = 1;
  for (let i = data.indexOf(10); i >= 0 && i < offset; i = data.indexOf(10, i + 1)) n++;
  return n;
}

export interface MarkerRule {
  id: string;
  description: string;
  blocking: boolean;
  scope: 'all' | 'prose' | 'prose-and-code';
  patterns?: string[];
  source?: 'owner-email' | 'scrub-table:custody';
  allow_classes?: string[];
  allow_paths?: string[];
  history?: 'advisory';
  ignore_case?: boolean;
  canary?: string;
}
export interface CompiledRule { rule: MarkerRule; regexes: { re: RegExp; anchor: Buffer | null }[]; literals: Buffer[] }

// The longest run of plain characters a match must contain, so most blobs are ruled out with one indexOf.
export function anchorOf(pattern: string): string | null {
  if (/(^|[^\\])\|/.test(pattern)) return null;
  let best = '';
  let run = '';
  const end = () => { if (run.length > best.length) best = run; run = ''; };
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '\\') {
      const n = pattern[++i] ?? '';
      if (/[bBdDwWsS]/.test(n)) { end(); continue; }
      run += n;
      continue;
    }
    if ('?*{'.includes(c)) { run = run.slice(0, -1); end(); if (c === '{') i = pattern.indexOf('}', i); continue; }
    if ('+'.includes(c)) { end(); continue; }
    if ('[('.includes(c)) { end(); const close = c === '[' ? ']' : ')'; i = pattern.indexOf(close, i); if (i < 0) return best.length >= 3 ? best : null; continue; }
    if ('^$.)]'.includes(c)) { end(); continue; }
    run += c;
  }
  end();
  return best.length >= 3 ? best : null;
}

export function compileRules(rules: MarkerRule[], extra: { ownerEmails: string[]; custodyPatterns: string[] }): CompiledRule[] {
  return rules.map((rule) => {
    const patterns = rule.source === 'scrub-table:custody' ? extra.custodyPatterns : (rule.patterns ?? []);
    const literals = rule.source === 'owner-email' ? extra.ownerEmails.flatMap((e) => [...new Set([e, e.toLowerCase()])]).map((e) => Buffer.from(e)) : [];
    return { rule, literals, regexes: patterns.map((p) => { const a = rule.ignore_case ? null : anchorOf(p); return { re: new RegExp(p, rule.ignore_case ? 'i' : ''), anchor: a === null ? null : Buffer.from(a, 'latin1') }; }) };
  });
}

const PROSE = new Set(['md', 'markdown', 'txt', 'rst']);
const CODE = new Set(['ts', 'tsx', 'js', 'mjs', 'cjs', 'sh', 'bash', 'py']);

export function nameKind(path: string, member: string): 'prose' | 'code' | 'other' {
  const segs = member.split('|').filter((s) => s && !['gunzip', 'names', 'headers', 'gzip-header', 'trailing'].includes(s));
  const name = (segs.length ? segs[segs.length - 1]! : path).replace(/\.gz$/, '');
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return PROSE.has(ext) ? 'prose' : CODE.has(ext) ? 'code' : 'other';
}

export function ruleApplies(rule: MarkerRule, kind: 'prose' | 'code' | 'other' | 'message', contentClass: string): boolean {
  if (rule.allow_classes?.includes(contentClass)) return false;
  if (rule.scope === 'all') return true;
  if (kind === 'message' || kind === 'prose') return true;
  return rule.scope === 'prose-and-code' && kind === 'code';
}

// Every line one compiled rule matches in a leaf, in order.
export function ruleLines(data: Buffer, c: CompiledRule): number[] {
  const at = new Set<number>();
  for (const l of c.literals) for (let i = data.indexOf(l); i >= 0; i = data.indexOf(l, i + 1)) at.add(i);
  if (c.regexes.length) {
    const text = data.toString('latin1');
    for (const { re } of c.regexes) {
      const g = new RegExp(re.source, re.flags.replace('g', '') + 'g');
      for (let m = g.exec(text); m; m = g.exec(text)) { at.add(m.index); if (!m[0]) g.lastIndex++; }
    }
  }
  return [...new Set([...at].sort((a, b) => a - b).map((o) => lineAt(data, o)))];
}

// One pass over a leaf: which rules and needles hit, with the line of the first hit.
export function leafHits(data: Buffer, needles: Needle[], rules: CompiledRule[], applies: (r: MarkerRule) => boolean): { rule: string; blocking: boolean; exact: boolean; line: number }[] {
  const hits: { rule: string; blocking: boolean; exact: boolean; line: number }[] = [];
  for (const n of needles) {
    const at = data.indexOf(n.bytes);
    if (at >= 0) hits.push({ rule: n.name + ' (' + n.part + ')', blocking: true, exact: true, line: lineAt(data, at) });
  }
  let text: string | null = null;
  for (const c of rules) {
    if (!applies(c.rule)) continue;
    let at = -1;
    for (const l of c.literals) { at = data.indexOf(l); if (at >= 0) break; }
    for (const { re, anchor } of c.regexes) {
      if (at >= 0) break;
      if (anchor && data.indexOf(anchor) < 0) continue;
      text ??= data.toString('latin1');
      const m = re.exec(text);
      if (m) at = m.index;
    }
    if (at >= 0) hits.push({ rule: c.rule.id, blocking: c.rule.blocking, exact: false, line: lineAt(data, at) });
  }
  return hits;
}

// git cat-file --batch, read as a stream: yields each object in the order asked, under one deadline for the whole batch.
export async function* catObjects(gitDir: string, oids: string[], env: Record<string, string>, timeoutMs = 10 * 60_000): AsyncGenerator<{ oid: string; type: string; data: Buffer }> {
  const run = spawnBounded(['git', '--git-dir=' + gitDir, 'cat-file', '--batch'], { op: 'git cat-file --batch', timeoutMs, env });
  const { p } = run;
  const writer = (async () => {
    for (let i = 0; i < oids.length; i += 1000) {
      if (!p.stdin.write(oids.slice(i, i + 1000).join('\n') + '\n')) await new Promise((r) => p.stdin.once('drain', r));
    }
    p.stdin.end();
  })();
  const it = p.stdout[Symbol.asyncIterator]();
  let buf: Buffer = Buffer.alloc(0);
  const pull = async (): Promise<boolean> => {
    const { value, done } = await it.next();
    if (done) { if (run.timedOut()) throw run.timeoutError(); return false; }
    buf = buf.length ? Buffer.concat([buf, value as Buffer]) : (value as Buffer);
    return true;
  };
  try {
    for (const oid of oids) {
      let nl: number;
      while ((nl = buf.indexOf(10)) < 0) if (!(await pull())) throw new Error('git cat-file ended early');
      const [got, type, size] = buf.subarray(0, nl).toString('latin1').split(' ');
      buf = buf.subarray(nl + 1);
      if (got !== oid || type === 'missing' || size === undefined) throw new Error('git cat-file: ' + oid + ' is ' + (type ?? 'missing'));
      const out = Buffer.allocUnsafe(Number(size));
      let filled = 0;
      while (filled < out.length) {
        if (!buf.length && !(await pull())) throw new Error('git cat-file ended inside ' + oid);
        const n = Math.min(out.length - filled, buf.length);
        buf.copy(out, filled, 0, n);
        filled += n;
        buf = buf.subarray(n);
      }
      while (!buf.length) if (!(await pull())) throw new Error('git cat-file ended after ' + oid);
      buf = buf.subarray(1);
      yield { oid, type: type!, data: out };
    }
  } finally {
    await writer.catch(() => {});
    run.kill();
  }
}

export async function* catBlobs(gitDir: string, oids: string[], env: Record<string, string>, timeoutMs?: number): AsyncGenerator<{ oid: string; data: Buffer }> {
  for await (const o of catObjects(gitDir, oids, env, timeoutMs)) {
    if (o.type !== 'blob') throw new Error('git cat-file: ' + o.oid + ' is ' + o.type);
    yield { oid: o.oid, data: o.data };
  }
}
