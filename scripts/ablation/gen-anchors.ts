#!/usr/bin/env bun
// Span candidates for the prompt-archaeology layer maps, generated
// from the anatomy records and their receipts, so a new pin re-maps
// mechanically. Generation is separate from coding: this script only cuts the
// harness text into candidates and finds anchors for them; two coders assign
// a layer to each candidate (harnesses/ablation/coding/), and
// scripts/ablation/settle.ts turns their codes into maps.
//
//   bun scripts/ablation/gen-anchors.ts [--record <record dir name>]... [--out <candidates.json>] [--items <coder input.json>]
//
// Both outputs carry raw harness text, so both must be outside the repository;
// settle.ts writes the hashes-only coding/items.json that is committed.
//
// For each recaptured (harness, wire, model) in COMBOS it reads
// docs/harness-anatomy/records/<record>/*.json, unpacks each scenario's
// receipts with scripts/anatomy/store.ts (checking the log's sha256 against
// the record), and takes every agent request. Requests are grouped into
// families by fingerprint (path, tools present, the start of the system text
// with digits cut off). Each unit (scripts/ablation/maps.ts) is cut into
// pieces: dissect.ts sections, then one piece per line-led paragraph or list
// item; a heading stays with the line after it, an XML-like tag section stays
// whole, fenced code and indented lines stay with the line before them, and a
// run of one-word lines (a list of names) stays together. Pieces of the same
// unit in different requests are aligned by their opening bytes. Each
// candidate gets an anchor (the opening bytes all its variants share, cut
// before the first digit unless that leaves under 8 bytes, at most 64 bytes,
// then shortened to the first word boundary past 16 bytes, so a date or name
// later in the line is left out; an anchor that resolves to the wrong place in
// any captured request grows a word at a time), its presence, its observed byte
// range and its coding item: the sha256 of its text, so identical text in two
// maps, or in a later pin, is coded once. Tool definitions (name and
// parameter schema) and the world MCP tools' descriptions are fixed as
// protocol-and-discovery by rule and are not coded.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AnatomyRecord, type LogRow, type Wire, parseLog, splitSections, systemBlocks } from '../anatomy/dissect.ts';
import { unpack } from '../anatomy/store.ts';
import { type Location, ROOT, byteLen, locKey, privateTextPath, resolveAnchors, sha256, units } from './maps.ts';

export interface Combo { harness: string; wire: Wire; model: string; record: string }
export const COMBOS: Combo[] = [
  { harness: 'claude-code', wire: 'anthropic-messages', model: 'claude-opus-5-5', record: 'claude-code-opus' },
  { harness: 'openclaw', wire: 'anthropic-messages', model: 'claude-opus-5-5', record: 'openclaw-opus' },
  { harness: 'hermes', wire: 'anthropic-messages', model: 'claude-opus-5-5', record: 'hermes-opus' },
  { harness: 'codex', wire: 'openai-responses', model: 'gpt-6.1-sol', record: 'codex-sol' },
  { harness: 'openclaw', wire: 'openai-responses', model: 'gpt-6.1-sol', record: 'openclaw-sol' },
  { harness: 'hermes', wire: 'openai-responses', model: 'gpt-6.1-sol', record: 'hermes-sol' },
];
export const comboId = (c: { harness: string; wire: string }) => `${c.harness}.${c.wire}`;

export interface Candidate {
  id: string;
  combo: string;
  family: string;
  unit: string;
  location: Location;
  section: string;
  n: number;
  anchor?: string;
  presence: 'always' | 'when_present';
  bytes: { min: number; max: number };
  text_sha256?: string;
  text: string;
  variants: number;
  item: string;
  fixed?: { never_removed: 'protocol-and-discovery'; rule: string };
}
export interface FamilyInfo { id: string; kind: 'agent-turn' | 'side'; fingerprint: { path_suffix: string; has_tools: boolean; system_prefix: string }; requests: string[] }
export interface Source { scenario: string; record: string; receipts: string; source_log_sha256: string }
export interface ComboCandidates { combo: Combo; sources: Source[]; families: FamilyInfo[]; candidates: Candidate[]; problems: string[] }

const RECORDS = join(ROOT, 'docs/harness-anatomy/records');
const RECEIPTS = join(ROOT, 'docs/harness-anatomy/receipts');

/** Opening bytes of s, cut before the first digit that is not a leading list number (unless that leaves under 8 bytes), at most max bytes, on a character boundary. */
export function staticPrefix(s: string, max = 64): string {
  const lead = s.match(/^\s*\d+[.)]\s/)?.[0].length ?? 0;
  const digit = s.slice(lead).search(/\d/);
  let out = digit < 0 || byteLen(s.slice(0, lead + digit)) < 8 ? s : s.slice(0, lead + digit);
  while (byteLen(out) > max) out = out.slice(0, -1);
  return out;
}

/** The shortest prefix of s that ends at a word boundary (before a space or newline) and has at least min bytes; s itself when none does. */
export function wordPrefix(s: string, min: number): string {
  for (let i = 0; i < s.length; i++) if ((s[i] === ' ' || s[i] === '\n') && byteLen(s.slice(0, i)) >= min) return s.slice(0, i);
  return s;
}

const commonPrefix = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return a.slice(0, i); };

/** Cuts one unit's text into pieces (see the header). Offsets are bytes. */
export function pieces(text: string): Array<{ start: number; bytes: number; section: string; text: string }> {
  const out: Array<{ start: number; bytes: number; section: string; text: string }> = [];
  const buf = Buffer.from(text, 'utf8');
  for (const s of splitSections([text])) {
    const body = buf.subarray(s.start, s.start + s.bytes).toString('utf8');
    const tag = s.title.startsWith('<') && !s.title.endsWith('(cont.)');
    const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const local: string[] = [];
    let fence = false;
    let prev = '';
    for (const line of lines) {
      const t = line.replace(/\n$/, '');
      const blank = t.trim() === '';
      const fenceLine = /^\s*(```|~~~)/.test(t);
      const word = /^[\w.:-]+$/.test(t.trim());
      let cont = local.length === 0 ? false : tag || fence || blank || /^#{1,6}\s/.test(prev) || (fenceLine && /:\s*$/.test(prev)) || (/^(\s{2,}|\t)/.test(t) && !/^\s{0,3}([-*+]|\d+[.)])\s/.test(t)) || (word && (/:\s*$/.test(prev) || /^[\w.:-]+$/.test(prev.trim())));
      if (fenceLine) fence = !fence;
      if (cont) local[local.length - 1] += line; else local.push(line);
      if (!blank) prev = t;
    }
    let at = s.start;
    for (const p of local) {
      const n = byteLen(p);
      const last = out[out.length - 1];
      if (p.trim() === '' && last) { last.bytes += n; last.text += p; } else out.push({ start: at, bytes: n, section: s.title, text: p });
      at += n;
    }
  }
  if (out.length > 1 && out[0]!.text.trim() === '') { const [w, next] = out; next!.start = 0; next!.bytes += w!.bytes; next!.text = w!.text + next!.text; out.shift(); }
  return out;
}

function loadCombo(c: Combo): { sources: Source[]; requests: Array<{ ref: string; row: LogRow }> } {
  const dir = join(RECORDS, c.record);
  const sources: Source[] = [];
  const requests: Array<{ ref: string; row: LogRow }> = [];
  const captures = readdirSync(RECEIPTS).filter((d) => existsSync(join(RECEIPTS, d, 'capture.json'))).map((d) => ({ d, cap: JSON.parse(readFileSync(join(RECEIPTS, d, 'capture.json'), 'utf8')) }));
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const scenario = f.replace(/\.json$/, '');
    const rec = JSON.parse(readFileSync(join(dir, f), 'utf8')) as AnatomyRecord;
    if (rec.wire !== c.wire) throw new Error(`${c.record}/${f}: wire ${rec.wire}, expected ${c.wire}`);
    const hit = captures.filter((x) => x.cap.record === c.record && (x.cap.scenario + (x.cap.gbrain ? '-gbrain' : '')) === scenario && existsSync(join(RECEIPTS, x.d, 'requests.ndjson')));
    const log = hit.map((x) => ({ x, text: unpack(join(RECEIPTS, x.d)) })).find((y) => sha256(y.text) === rec.source_log_sha256);
    if (!log) throw new Error(`${c.record}/${f}: no receipts whose request log has sha256 ${rec.source_log_sha256}`);
    if (log.x.cap.model !== c.model) throw new Error(`${c.record}/${f}: captured on ${log.x.cap.model}, expected ${c.model}`);
    sources.push({ scenario, record: `docs/harness-anatomy/records/${c.record}/${f}`, receipts: `docs/harness-anatomy/receipts/${log.x.d}`, source_log_sha256: rec.source_log_sha256 });
    const rows = parseLog(log.text);
    for (const r of rec.requests) if (r.class === 'agent' || r.class === 'side') requests.push({ ref: `${scenario}#${r.i}`, row: rows[r.i]! });
  }
  return { sources, requests };
}

const where = (l: Location, section: string) => {
  switch (l.kind) {
    case 'system_block': return `system block ${l.index}, section "${section}"`;
    case 'instructions': return `Responses instructions, section "${section}"`;
    case 'message': return `harness-injected ${l.role}-role message (ordinal ${l.ordinal}, part ${l.part}), section "${section}"`;
    case 'tool_description': return `description of tool ${l.namespace ? l.namespace + '/' : ''}${l.tool}`;
    case 'additional_tool': return `description of Codex additional_tools entry ${l.namespace}/${l.tool}, section "${section}"`;
    case 'tool_definition': return `definition of tool ${l.tool} (name and parameter schema)`;
  }
};
export { where as describeLocation };

export function generate(c: Combo): ComboCandidates {
  const { sources, requests } = loadCombo(c);
  const problems: string[] = [];
  const famMap = new Map<string, FamilyInfo & { rows: Array<{ ref: string; row: LogRow }> }>();
  for (const r of requests) {
    const body = r.row.body;
    const sys = systemBlocks(body, c.wire).map((b) => b.text).join('');
    const hasTools = units(body, c.wire).some((u) => u.loc.kind === 'tool_definition');
    const fp = { path_suffix: r.row.path.endsWith('/responses') ? '/responses' : '/messages', has_tools: hasTools, system_prefix: staticPrefix(sys, 48) };
    const key = JSON.stringify(fp);
    if (!famMap.has(key)) famMap.set(key, { id: hasTools ? (famMap.size ? `agent-${famMap.size + 1}` : 'agent') : `side-${famMap.size + 1}`, kind: hasTools ? 'agent-turn' : 'side', fingerprint: fp, requests: [], rows: [] });
    famMap.get(key)!.requests.push(r.ref);
    famMap.get(key)!.rows.push(r);
  }
  const candidates: Candidate[] = [];
  const cid = comboId(c);
  for (const fam of famMap.values()) {
    const nreq = fam.rows.length;
    // Unit groups: same location; messages by role, part and opening bytes, with the ordinals they took.
    const groups = new Map<string, { loc: Location; occ: Array<{ req: number; text: string; ordinal?: number }>; world: boolean }>();
    fam.rows.forEach((r, req) => {
      for (const u of units(r.row.body, c.wire)) {
        const key = u.loc.kind === 'message' ? `${locKey(u.loc)}~${staticPrefix(u.text, 24)}` : locKey(u.loc);
        if (!groups.has(key)) groups.set(key, { loc: u.loc, occ: [], world: !!u.world_tool });
        groups.get(key)!.occ.push({ req, text: u.text, ...(u.loc.kind === 'message' ? { ordinal: u.loc.ordinal as number } : {}) });
      }
    });
    for (const [gkey, g] of groups) {
      let loc = g.loc;
      let unit = locKey(loc);
      if (loc.kind === 'message') {
        const ords = new Set(g.occ.map((o) => o.ordinal));
        const perReq = new Map<number, number>();
        for (const o of g.occ) perReq.set(o.req, (perReq.get(o.req) ?? 0) + 1);
        const ordinal = ords.size === 1 && [...perReq.values()].every((n) => n === 1) ? g.occ[0]!.ordinal! : 'any';
        loc = { ...loc, ordinal };
        unit = `message:${loc.role}#${ordinal}.part[${loc.part}]${ordinal === 'any' ? '~' + gkey.split('~')[1] : ''}`;
      }
      const unitInEvery = new Set(g.occ.map((o) => o.req)).size === nreq && !(loc.kind === 'message' && loc.ordinal === 'any');
      const fixed = loc.kind === 'tool_definition' ? { never_removed: 'protocol-and-discovery' as const, rule: 'tool definition: name and parameter schema' } : g.world ? { never_removed: 'protocol-and-discovery' as const, rule: 'world MCP tool: the eval owns its definition' } : undefined;
      const variants = [...new Set(g.occ.map((o) => o.text))];
      const split = variants.map((v) => (fixed ? [{ start: 0, bytes: byteLen(v), section: '', text: v }] : pieces(v)));
      // Align pieces across variants by opening bytes (k-th piece with the same opening is the same candidate).
      const keyed = split.map((ps) => { const seen: Record<string, number> = {}; return ps.map((p) => { const k0 = staticPrefix(p.text, 32); const k = `${k0}#${seen[k0] = (seen[k0] ?? -1) + 1}`; return { k, p }; }); });
      const order: string[] = [];
      for (const list of keyed) {
        let pos = 0;
        for (const { k } of list) {
          const found = order.indexOf(k, pos);
          if (found >= 0) pos = found + 1; else { order.splice(pos, 0, k); pos++; }
        }
      }
      const occOf = (vi: number) => g.occ.filter((o) => o.text === variants[vi]);
      const cands = order.map((k, n) => {
        const hits = keyed.map((list, vi) => ({ vi, p: list.find((x) => x.k === k)?.p })).filter((h): h is { vi: number; p: NonNullable<typeof h.p> } => h.p !== undefined);
        const texts = hits.map((h) => h.p.text);
        const lens = hits.flatMap((h) => occOf(h.vi).map(() => h.p.bytes));
        const reqs = new Set(hits.flatMap((h) => occOf(h.vi).map((o) => o.req)));
        const same = new Set(texts).size === 1;
        const shared = texts.reduce(commonPrefix);
        const anchor = loc.kind === 'tool_definition' ? undefined : wordPrefix(staticPrefix(shared, 64), 16);
        const lo = Math.min(...lens);
        const hi = Math.max(...lens);
        const slack = (x: number) => Math.max(16, Math.ceil(x * 0.1));
        const cand: Candidate = {
          id: `${cid}/${fam.id}/${unit}#${n}`, combo: cid, family: fam.id, unit, location: loc, section: hits[0]!.p.section, n,
          ...(anchor !== undefined ? { anchor } : {}),
          presence: unitInEvery && reqs.size === nreq && hits.length === variants.length ? 'always' : 'when_present',
          bytes: same ? { min: lo, max: hi } : { min: Math.max(1, lo - slack(lo)), max: hi + slack(hi) },
          ...(same ? { text_sha256: sha256(texts[0]!) } : {}),
          text: texts[0]!, variants: new Set(texts).size, item: 'i' + sha256(texts[0]!).slice(0, 16),
          ...(fixed ? { fixed } : {}),
        };
        return { cand, hits, full: staticPrefix(shared, 64) };
      });
      // Every variant must resolve back to its own piece boundaries; an anchor that resolves wrongly grows a word at a time.
      const check = (report: boolean) => {
        let bad = -1;
        variants.forEach((v, vi) => {
          const want = cands.map(({ hits }) => hits.find((h) => h.vi === vi)?.p.start ?? null);
          let got: Array<number | null>;
          try { got = resolveAnchors(v, cands.map(({ cand }) => ({ anchor: cand.anchor, presence: cand.presence }))); } catch (e) { if (report) problems.push(`${cid}/${fam.id}/${unit} variant ${vi}: ${(e as Error).message}`); if (bad < 0) bad = 0; return; }
          cands.forEach(({ cand }, i) => { if (got[i] !== want[i]) { if (report) problems.push(`${cand.id}: anchor ${JSON.stringify(cand.anchor)} resolves to ${got[i]}, expected ${want[i]} in variant ${vi}`); if (bad < 0 || i < bad) bad = i; } });
        });
        return bad;
      };
      for (let round = 0; round < 200; round++) {
        const bad = check(false);
        if (bad < 0) break;
        const c = cands.find((x, i) => i >= bad && x.cand.anchor !== undefined && x.cand.anchor !== x.full);
        if (!c) break;
        c.cand.anchor = wordPrefix(c.full, byteLen(c.cand.anchor!) + 1);
      }
      check(true);
      if (cands.some(({ cand }, i) => i > 0 && (cand.anchor === undefined || byteLen(cand.anchor) < 3))) problems.push(`${cid}/${fam.id}/${unit}: an anchor is shorter than 3 bytes`);
      candidates.push(...cands.map((x) => x.cand));
    }
  }
  const families = [...famMap.values()].map(({ rows: _rows, ...f }) => f);
  return { combo: c, sources, families, candidates, problems };
}

/** The coders' input: one item per distinct candidate text that is not fixed by rule, with every place it occurs. */
export function codingItems(all: ComboCandidates[]): Array<{ id: string; text: string; bytes: number; contexts: string[] }> {
  const items = new Map<string, { id: string; text: string; bytes: number; contexts: string[] }>();
  for (const cc of all) for (const c of cc.candidates) {
    if (c.fixed) continue;
    const ctx = `${cc.combo.harness} on ${cc.combo.wire} (${cc.combo.model}): ${where(c.location, c.section)}${c.variants > 1 ? ` (text varies between requests; first variant shown)` : ''}`;
    const it = items.get(c.item) ?? items.set(c.item, { id: c.item, text: c.text, bytes: byteLen(c.text), contexts: [] }).get(c.item)!;
    if (!it.contexts.includes(ctx)) it.contexts.push(ctx);
  }
  return [...items.values()];
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const many = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]!] : []));
  const pick = many('--record');
  for (const p of [...many('--out'), ...many('--items')]) {
    try { privateTextPath(p); } catch (e) { console.error(`GEN: ${(e as Error).message}`); process.exit(2); }
  }
  const all = COMBOS.filter((c) => !pick.length || pick.includes(c.record)).map(generate);
  for (const cc of all) {
    const coded = cc.candidates.filter((c) => !c.fixed);
    console.log(`GEN: ${comboId(cc.combo)} ${cc.combo.model}: ${cc.families.length} famil${cc.families.length === 1 ? 'y' : 'ies'} (${cc.families.map((f) => `${f.id} ${f.requests.length} requests`).join(', ')}), ${new Set(cc.candidates.map((c) => c.unit)).size} units, ${cc.candidates.length} candidates, ${coded.length} to code, ${cc.problems.length} problems`);
    for (const p of cc.problems) console.log(`  PROBLEM: ${p}`);
  }
  const out = many('--out')[0];
  if (out) writeFileSync(out, JSON.stringify(all, null, 1) + '\n');
  const items = many('--items')[0];
  if (items) { const list = codingItems(all); writeFileSync(items, JSON.stringify(list, null, 1) + '\n'); console.log(`GEN: ${list.length} distinct items to code, ${list.reduce((n, i) => n + i.bytes, 0)} bytes`); }
  if (all.some((cc) => cc.problems.length)) process.exit(1);
}
