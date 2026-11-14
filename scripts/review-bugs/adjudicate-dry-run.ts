#!/usr/bin/env bun
// Adjudication brief dry run (internal-task, plan section "Grading"): sends a fixed set of noloss adjudication packets to two
// or more judges and measures how far they agree with each other and with a reference ruling.
//
//   bun scripts/review-bugs/adjudicate-dry-run.ts run --packets <dir> --key <key.json> --sheets <dir> --items <items.tsv>
//       --brief <file> --judge <provider:model>... --out <dir> --lease-usd <n> --run-id <id> [--ledger <file>]
//       [--source <owner/repo>=<clone>]... [--concurrency <n>] [--dry-run]
//   bun scripts/review-bugs/adjudicate-dry-run.ts score --items <items.tsv> --rulings <name>=<rulings.tsv>... [--out <file>]
//
// Why not gstack-evals noloss judge-run itself: judge-run needs three different judges, and it picks the findings its
// second judge reads from its primary judge's rulings (every finding the primary does not rule a defect, plus a seeded
// 20% sample). A dry run that asks two named judges to rule one fixed set of findings, such as R2's 22 second-read
// findings, cannot be expressed as a judge-run. So this script sends the same thing judge-run would send, through this
// repository's metering proxy under one lease, and nothing else. It does not import gstack-evals; the parts it mirrors
// are named where they sit:
// - The prompt is judge-run's: the brief, batch.json, the packet and the packet's evidence sheet, in that order, each
//   under the same "=== ... ===" header (noloss judge-run.ts at gstack-evals 91d76421).
// - The request is judge-run's judgeRequest: one user message, no tools, max output 16,000 tokens, reasoning effort
//   medium on the OpenAI route (Responses API, store false) and no thinking field on the Anthropic route.
// - An answer is the first JSON object in the reply; a packet answer that leaves a finding unruled, rules an id the
//   packet does not have or gives a ruling outside defect, not-defect and known-informational is asked again once in a
//   fresh request, then left unjudged, as judge-run does.
// - Evidence sheets are judge-run's own sheets (sheets/<packet>.json, which a judge-run writes). With --source each
//   sheet's code is rebuilt from a clone at the unit's head the way judge-run's codeAt builds it (30 lines either side
//   of the finding's line, the first 200 lines when it names none) and must be identical.
//
// items.tsv: packet, opaque id and an optional reference ruling, tab separated, no header. A judge rules every finding
// in each packet that holds an item; score reads only the items. Every paid call goes through
// runner/proxy/metering-proxy.ts in lease mode, started here on the loopback with its own control token, one slot per
// judge. Provider keys live only in the proxy's environment; this script never prints a key, a request body or a
// response body, and writes replies only under --out.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { priceRequest, reservationUsd } from '../../runner/ledger/budget-ledger.ts';
import { cohensKappa } from '../failure-mining/judge-check.ts';

export const RULINGS = ['defect', 'not-defect', 'known-informational'] as const;
export type Ruling = (typeof RULINGS)[number];
export const UNRULED = 'unruled';
export const MAX_OUTPUT_TOKENS = 16_000;
export const JUDGE_REASONING_EFFORT = 'medium';
export const ROUTE = { anthropic: '/v1/messages', openai: '/v1/responses' } as const;
type Provider = keyof typeof ROUTE;
const HOSTS: Record<Provider, string> = { anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com' };
const REPO_ROOT = join(import.meta.dir, '..', '..');

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

export interface Judge { id: string; provider: Provider; model: string; slug: string }
export function parseJudge(id: string): Judge {
  const [provider, model] = id.split(':');
  if (!model || !(provider! in ROUTE)) throw new Error('--judge takes anthropic:<model> or openai:<model>, not ' + JSON.stringify(id));
  return { id, provider: provider as Provider, model, slug: model.replace(/[^\w.-]/g, '_') };
}

export interface KeyFile { batch: string; kind?: string; packets: Array<{ file: string; unit: string; sha256: string }>; entries: Array<{ packet: string; opaque: string }> }
export interface PacketFinding { id: string; path: string | null; line: number | null }
export interface Packet { file: string; sha256: string; text: string; unit: { repo: string; head: string }; findings: PacketFinding[]; known: number }
export interface Batch { batch: string; batchText: string; packets: Map<string, Packet> }

/** The batch as judge-packet wrote it: batch.json and every packet, each packet's sha256 checked against the key. */
export function loadBatch(packetsDir: string, keyPath: string): Batch {
  const key = JSON.parse(readFileSync(keyPath, 'utf8')) as KeyFile;
  if (key.kind !== 'adjudicate') throw new Error(keyPath + ' is not an adjudication key');
  const batchText = readFileSync(join(packetsDir, 'batch.json'), 'utf8');
  if ((JSON.parse(batchText) as { batch?: string }).batch !== key.batch) throw new Error('batch.json is not the instructions of batch ' + key.batch);
  const packets = new Map<string, Packet>();
  for (const p of key.packets) {
    const text = readFileSync(join(packetsDir, p.file), 'utf8');
    if (sha256(text) !== p.sha256) throw new Error(p.file + ' does not match the key\'s sha256; it changed since judge-packet wrote it');
    const body = JSON.parse(text) as { unit: { repo: string; head: string }; findings: PacketFinding[]; known_informational?: unknown[] };
    packets.set(p.file, { file: p.file, sha256: p.sha256, text, unit: body.unit, findings: body.findings.map((f) => ({ id: f.id, path: f.path ?? null, line: f.line ?? null })), known: (body.known_informational ?? []).length });
  }
  return { batch: key.batch, batchText, packets };
}

export interface Item { packet: string; opaque: string; reference: string | null }
export function readItems(path: string): Item[] {
  const items = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => {
    const [packet, opaque, reference] = l.split('\t');
    if (!packet || !opaque) throw new Error(path + ': each line needs a packet and an opaque id');
    if (reference && !(RULINGS as readonly string[]).includes(reference)) throw new Error(path + ': reference ruling ' + JSON.stringify(reference) + ' is not one of ' + RULINGS.join(', '));
    return { packet, opaque, reference: reference || null };
  });
  const seen = new Set<string>();
  for (const i of items) { const k = i.packet + ' ' + i.opaque; if (seen.has(k)) throw new Error(path + ': ' + k + ' is listed twice'); seen.add(k); }
  return items;
}

/** judge-run's codeAt: the head's code around a finding's line, with line numbers, or why there is none. */
export function codeAt(read: (path: string) => string | null, path: string | null, line: number | null): { code: { path: string; from: number; to: number; text: string } | null; code_note: string | null } {
  if (!path) return { code: null, code_note: 'the finding names no file, so the sheet shows no code' };
  const text = read(path);
  if (text === null) return { code: null, code_note: path + ' is not a file in the repository at the head, so the sheet shows no code' };
  const lines = text.replace(/\n$/, '').split('\n');
  if (line !== null && line > lines.length) return { code: null, code_note: 'line ' + line + ' is past the end of ' + path + ' (' + lines.length + ' lines) at the head' };
  const from = line === null ? 1 : Math.max(1, line - 30);
  const to = Math.min(lines.length, line === null ? 200 : line + 30);
  return { code: { path, from, to, text: lines.slice(from - 1, to).map((l, i) => String(from + i).padStart(String(to).length) + '  ' + l).join('\n') }, code_note: null };
}

/** The sheet text for a packet, checked against the packet; with a reader, every finding's code is rebuilt and compared. */
export function checkSheet(sheetText: string, p: Packet, read?: (path: string) => string | null): void {
  const sheet = JSON.parse(sheetText) as { packet: string; packet_sha256: string; findings: Array<{ id: string; code: unknown; code_note: unknown }> };
  if (sheet.packet !== p.file || sheet.packet_sha256 !== p.sha256) throw new Error('the evidence sheet for ' + p.file + ' names another packet or digest');
  const ids = p.findings.map((f) => f.id).sort().join(',');
  if (sheet.findings.map((f) => f.id).sort().join(',') !== ids) throw new Error('the evidence sheet for ' + p.file + ' does not cover exactly the packet\'s findings');
  if (!read) return;
  for (const f of p.findings) {
    const want = codeAt(read, f.path, f.line);
    const got = sheet.findings.find((x) => x.id === f.id)!;
    if (JSON.stringify(want.code) !== JSON.stringify(got.code ?? null) || want.code_note !== (got.code_note ?? null)) throw new Error('the evidence sheet for ' + p.file + ' finding ' + f.id + ' does not match the code at head ' + p.unit.head);
  }
}

export const promptFor = (brief: string, b: Batch, p: Packet, sheetText: string) =>
  ['=== Judge brief ===', brief, '=== Instructions: batch.json ===', b.batchText, '=== Packet: ' + p.file + ' ===', p.text, '=== Evidence sheet: ' + p.file + ' ===', sheetText].join('\n');

/** judge-run's judgeRequest at gstack-evals 91d76421. */
export function judgeRequest(j: Judge, prompt: string): Record<string, unknown> {
  const input = [{ role: 'user', content: prompt }];
  return j.provider === 'openai'
    ? { model: j.model, input, store: false, max_output_tokens: MAX_OUTPUT_TOKENS, reasoning: { effort: JUDGE_REASONING_EFFORT } }
    : { model: j.model, messages: input, max_tokens: MAX_OUTPUT_TOKENS };
}

export function judgeAnswer(provider: Provider, body: any): string {
  if (provider === 'anthropic') return (body?.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
  return (body?.output ?? []).filter((i: any) => i?.type === 'message').flatMap((i: any) => i.content ?? []).filter((c: any) => c?.type === 'output_text').map((c: any) => c.text).join('');
}

/** The first JSON object in a reply, inside a markdown fence or not. */
export function firstObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('the answer holds no JSON object');
  let depth = 0, str = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; }
    else if (c === '"') str = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('the answer\'s first JSON object never closes');
}

export interface Ruled { id: string; ruling: Ruling; verifiable: boolean | null; test: string | null; entry: Record<string, unknown> }

/** One packet's rulings from an answer, or why judge-run would refuse it. */
export function validateAnswer(answer: string, p: Packet): Ruled[] | string {
  let body: Record<string, any> | undefined;
  try {
    const list = (firstObject(answer) as { packets?: unknown } | null)?.packets;
    const entries = (Array.isArray(list) ? list : []) as Array<Record<string, any>>;
    body = entries.find((x) => x?.file === p.file) ?? (entries.length === 1 ? entries[0] : undefined);
  } catch (e) {
    return (e as Error).message;
  }
  if (!body || typeof body !== 'object') return 'the answer has no packets entry for ' + p.file;
  const ids = new Set(p.findings.map((f) => f.id));
  const out = new Map<string, Ruled>();
  for (const f of (Array.isArray(body.findings) ? body.findings : []) as Array<Record<string, unknown>>) {
    if (typeof f.id !== 'string' || !ids.has(f.id)) return 'the answer rules finding ' + JSON.stringify(f.id) + ', which ' + p.file + ' does not have';
    if (out.has(f.id)) return 'the answer rules ' + f.id + ' twice';
    if (!(RULINGS as readonly unknown[]).includes(f.ruling)) return 'the ruling for ' + f.id + ' is ' + JSON.stringify(f.ruling) + ', not one of ' + RULINGS.join(', ');
    if (f.ruling === 'known-informational' && !p.known) return 'the answer rules ' + f.id + ' known-informational, but the unit has no known informational case';
    const v = body.verifiable?.[f.id];
    out.set(f.id, { id: f.id, ruling: f.ruling as Ruling, verifiable: typeof v === 'boolean' ? v : null, test: typeof f.test === 'string' ? f.test : null, entry: f });
  }
  const short = [...ids].filter((id) => !out.has(id));
  if (short.length) return 'the answer leaves ' + short.length + ' of the ' + ids.size + ' findings unruled: ' + short.join(', ');
  return [...out.values()];
}

export interface Pair { a: string; b: string; n: number; agree: number; kappa: number | null; table: Record<string, Record<string, number>> }

/** Cohen's kappa and the agreement table for one pair of raters over the items; an item a rater left unruled is "unruled". */
export function pairStats(a: string, b: string, ra: Array<string>, rb: Array<string>): Pair {
  const cats = [...RULINGS, UNRULED].filter((c) => ra.includes(c) || rb.includes(c) || c !== UNRULED);
  const table: Pair['table'] = Object.fromEntries(cats.map((x) => [x, Object.fromEntries(cats.map((y) => [y, 0]))]));
  for (let i = 0; i < ra.length; i++) table[ra[i]!]![rb[i]!]! += 1;
  const k = cohensKappa(ra, rb);
  return { a, b, n: ra.length, agree: ra.filter((x, i) => x === rb[i]).length, kappa: k === null ? null : Math.round(k * 10_000) / 10_000, table };
}

export function score(items: Item[], raters: Array<{ name: string; rulings: Map<string, string> }>): Pair[] {
  const cols = [...raters];
  if (items.every((i) => i.reference)) cols.push({ name: 'reference', rulings: new Map(items.map((i) => [i.packet + ' ' + i.opaque, i.reference!])) });
  const pairs: Pair[] = [];
  for (let x = 0; x < cols.length; x++)
    for (let y = x + 1; y < cols.length; y++) {
      const of = (c: (typeof cols)[number]) => items.map((i) => c.rulings.get(i.packet + ' ' + i.opaque) ?? UNRULED);
      pairs.push(pairStats(cols[x]!.name, cols[y]!.name, of(cols[x]!), of(cols[y]!)));
    }
  return pairs;
}

export function readRulings(path: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of readFileSync(path, 'utf8').split('\n').slice(1).filter((x) => x.trim())) {
    const [packet, opaque, ruling] = l.split('\t');
    m.set(packet + ' ' + opaque, ruling!);
  }
  return m;
}

export function renderPairs(pairs: Pair[]): string {
  const lines: string[] = [];
  for (const p of pairs) {
    lines.push(p.a + ' vs ' + p.b + ': n ' + p.n + ', agree ' + p.agree + ', kappa ' + (p.kappa === null ? 'undefined' : p.kappa.toFixed(4)) + (p.kappa !== null && p.kappa >= 0.6 ? ' (clears 0.6)' : ' (below 0.6)'));
    const cats = Object.keys(p.table);
    lines.push('  rows ' + p.a + ', columns ' + p.b + ': ' + cats.join(' | '));
    for (const r of cats) lines.push('  ' + r + ': ' + cats.map((c) => p.table[r]![c]).join(' | '));
  }
  return lines.join('\n');
}

export type Transport = (j: Judge, body: Record<string, unknown>) => Promise<{ status: number; text: string }>;

export interface RunResult { judge: string; packets: number; answered: number; unjudged: string[]; refused: string | null; stopped: string | null; requests: number }

/** Asks one judge to rule every packet; writes raw replies, answers.json and rulings.tsv under out/<judge slug>/. */
export async function runJudge(j: Judge, brief: string, b: Batch, sheets: Map<string, string>, files: string[], out: string, send: Transport, concurrency = 4): Promise<RunResult> {
  const dir = join(out, j.slug);
  mkdirSync(join(dir, 'raw'), { recursive: true });
  const answers = new Map<string, Ruled[]>();
  const unjudged: string[] = [];
  let refused: string | null = null, stopped: string | null = null, requests = 0;
  const ask = async (file: string) => {
    const p = b.packets.get(file)!;
    let reason = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (refused || stopped) return;
      requests++;
      const res = await send(j, judgeRequest(j, promptFor(brief, b, p, sheets.get(file)!)));
      let answer: string | null = null;
      try { answer = res.status === 200 ? judgeAnswer(j.provider, JSON.parse(res.text)) : null; } catch { answer = null; }
      writeFileSync(join(dir, 'raw', basename(file, '.json') + '.' + attempt + '.txt'), answer ?? res.text);
      if (res.status !== 200) {
        if (/cyber_policy/.test(res.text)) refused ??= 'cyber_policy on ' + file + ' (HTTP ' + res.status + ')';
        else stopped ??= 'HTTP ' + res.status + ' on ' + file;
        return;
      }
      const got = answer === null ? 'the provider\'s response is not JSON' : validateAnswer(answer, p);
      if (typeof got !== 'string') { answers.set(file, got); return; }
      reason = got;
      process.stderr.write('adjudicate-dry-run: ' + j.id + ' answer for ' + file + ' refused (attempt ' + attempt + '): ' + reason + '\n');
    }
    unjudged.push(file + ': ' + reason);
  };
  const queue = [...files];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => { while (queue.length && !refused && !stopped) await ask(queue.shift()!); }));
  writeFileSync(join(dir, 'answers.json'), JSON.stringify(Object.fromEntries([...answers].map(([f, rs]) => [f, rs.map((r) => r.entry)])), null, 2) + '\n');
  writeFileSync(join(dir, 'rulings.tsv'), ['packet\topaque\truling\tverifiable\ttest', ...files.flatMap((f) => (answers.get(f) ?? []).map((r) => [f, r.id, r.ruling, String(r.verifiable), r.test ?? ''].join('\t')))].join('\n') + '\n');
  return { judge: j.id, packets: files.length, answered: answers.size, unjudged, refused, stopped, requests };
}

interface Proxy { base: string; token: string; child: ChildProcess }

async function startProxy(o: { dir: string; ledger: string; leaseUsd: number; runId: string; judges: Judge[] }): Promise<Proxy> {
  mkdirSync(o.dir, { recursive: true });
  const token = randomBytes(24).toString('hex');
  const errFd = openSync(join(o.dir, 'proxy.stderr.log'), 'a');
  const child = spawn('bun', [join(REPO_ROOT, 'runner/proxy/metering-proxy.ts'), '--listen', '127.0.0.1:0', '--budget-ledger', o.ledger, '--lease-usd', String(o.leaseUsd), '--run-id', o.runId,
    '--allow-models', o.judges.map((j) => j.id).join(','), '--max-output-tokens', String(MAX_OUTPUT_TOKENS), '--control-token', token, '--usage-log', join(o.dir, 'usage.ndjson')],
  { cwd: REPO_ROOT, env: process.env, stdio: ['ignore', 'ignore', 'pipe'] });
  const port = await new Promise<number>((done, fail) => {
    let buf = '';
    const timer = setTimeout(() => fail(new Error('the metering proxy did not start within 20 s; see ' + join(o.dir, 'proxy.stderr.log'))), 20_000);
    child.stderr!.on('data', (d: Buffer) => {
      writeSync(errFd, d);
      buf += d.toString('utf8');
      const m = buf.match(/ on 127\.0\.0\.1:(\d+);/);
      if (m) { clearTimeout(timer); done(Number(m[1])); }
    });
    child.on('exit', () => { clearTimeout(timer); fail(new Error('the metering proxy exited; see ' + join(o.dir, 'proxy.stderr.log'))); });
  });
  const base = 'http://127.0.0.1:' + port;
  for (const j of o.judges) {
    const res = await fetch(base + '/__proxy/bind', { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': token }, body: JSON.stringify({ slot: j.slug, key: 'adjudicate:' + o.runId + ':' + j.slug, models: [j.id] }) });
    if (!res.ok) { child.kill('SIGTERM'); throw new Error('the metering proxy refused the bind for ' + j.id); }
  }
  return { base, token, child };
}

/** Sends through the proxy slot; a 429 or 5xx is sent again up to 3 sends in all, 10 s then 30 s apart. */
const proxyTransport = (p: Proxy, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Transport => async (j, body) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (j.provider === 'anthropic') { headers['x-api-key'] = 'unauthenticated'; headers['anthropic-version'] = '2023-06-01'; } else headers.authorization = 'Bearer unauthenticated';
  let res = { status: 0, text: '' };
  for (const wait of [0, 10_000, 30_000]) {
    if (wait) await sleep(wait);
    const r = await fetch(p.base + '/' + j.slug + '/' + j.provider + ROUTE[j.provider], { method: 'POST', headers, body: JSON.stringify(body), timeout: false } as RequestInit);
    res = { status: r.status, text: await r.text() };
    if (res.status !== 429 && res.status < 500) break;
  }
  return res;
};

function flags(argv: string[], repeat: string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) throw new Error('unexpected argument ' + JSON.stringify(a));
    if (a === '--dry-run') { m.set(a, ['true']); continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error(a + ' needs a value');
    if (m.has(a) && !repeat.includes(a)) throw new Error(a + ' is given twice');
    m.set(a, [...(m.get(a) ?? []), v]);
  }
  return m;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const f = flags(rest, ['--judge', '--source', '--rulings']);
  const one = (k: string) => f.get(k)?.[0] ?? (() => { throw new Error(cmd + ' needs ' + k); })();
  if (cmd === 'score') {
    const items = readItems(one('--items'));
    const raters = (f.get('--rulings') ?? []).map((s) => ({ name: s.slice(0, s.indexOf('=')), rulings: readRulings(s.slice(s.indexOf('=') + 1)) }));
    const pairs = score(items, raters);
    console.log(renderPairs(pairs));
    if (f.has('--out')) writeFileSync(one('--out'), JSON.stringify({ items: items.length, pairs }, null, 2) + '\n');
    return 0;
  }
  if (cmd !== 'run') throw new Error('usage: adjudicate-dry-run.ts run|score ...; see the header of this file');
  const b = loadBatch(resolve(one('--packets')), resolve(one('--key')));
  const items = readItems(one('--items'));
  for (const i of items) if (!b.packets.get(i.packet)?.findings.some((x) => x.id === i.opaque)) throw new Error('item ' + i.packet + ' ' + i.opaque + ' is not a finding of this batch');
  const files = [...new Set(items.map((i) => i.packet))].sort();
  const sources = new Map((f.get('--source') ?? []).map((s) => [s.slice(0, s.indexOf('=')), resolve(s.slice(s.indexOf('=') + 1))]));
  const sheets = new Map<string, string>();
  for (const file of files) {
    const p = b.packets.get(file)!;
    const text = readFileSync(join(resolve(one('--sheets')), basename(file)), 'utf8');
    const clone = sources.get(p.unit.repo);
    const read = clone ? (path: string) => { const r = spawnSync('git', ['-C', clone, 'show', p.unit.head + ':' + path], { encoding: 'utf8', maxBuffer: 256 << 20 }); return r.status === 0 ? r.stdout : null; } : undefined;
    checkSheet(text, p, read);
    sheets.set(file, text);
  }
  const brief = readFileSync(one('--brief'), 'utf8');
  const judges = (f.get('--judge') ?? []).map(parseJudge);
  if (!judges.length) throw new Error('run needs at least one --judge');
  const out = resolve(one('--out'));
  const leaseUsd = Number(one('--lease-usd'));
  if (!(leaseUsd > 0)) throw new Error('--lease-usd must be a positive number of dollars');
  console.log('batch ' + b.batch + ': ' + items.length + ' items in ' + files.length + ' packets; sheets checked' + (sources.size ? ' against the --source clones' : ' for packet binding only') + '; brief sha256 ' + sha256(brief));
  if (f.has('--dry-run')) {
    let all = 0;
    for (const j of judges)
      for (const file of files) {
        const prompt = promptFor(brief, b, b.packets.get(file)!, sheets.get(file)!);
        const body = judgeRequest(j, prompt);
        const worst = reservationUsd(priceRequest(HOSTS[j.provider] + ROUTE[j.provider], body)!) * 2;
        all += worst;
        console.log(j.id + '  ' + file + '  prompt ' + prompt.length + ' chars  worst case $' + worst.toFixed(4) + ' (asked twice)');
      }
    console.log('worst case: $' + all.toFixed(4) + ' for ' + judges.length + ' judges on ' + files.length + ' packets, every answer asked twice; lease $' + leaseUsd.toFixed(2) + (all <= leaseUsd ? ' fits it' : ' does not fit it') + '. Nothing was sent.');
    return 0;
  }
  if (existsSync(out)) throw new Error('--out ' + out + ' exists; give each run a new directory');
  mkdirSync(out, { recursive: true });
  const runId = one('--run-id');
  const proxy = await startProxy({ dir: out, ledger: resolve(f.get('--ledger')?.[0] ?? join(out, 'ledger.sqlite')), leaseUsd, runId, judges });
  const results: RunResult[] = [];
  const meters: Record<string, unknown> = {};
  const ctl = (path: string, body: unknown) => fetch(proxy.base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': proxy.token }, body: JSON.stringify(body) });
  try {
    const send = proxyTransport(proxy);
    results.push(...(await Promise.all(judges.map((j) => runJudge(j, brief, b, sheets, files, out, send, Number(f.get('--concurrency')?.[0] ?? 4))))));
  } finally {
    for (const j of judges) {
      await ctl('/__proxy/unbind', { slot: j.slug });
      meters[j.id] = await (await ctl('/__proxy/finalize', { key: 'adjudicate:' + runId + ':' + j.slug, timeout_ms: 60_000 })).json();
    }
    await new Promise<void>((done) => { proxy.child.once('exit', () => done()); proxy.child.kill('SIGTERM'); setTimeout(done, 5_000); });
  }
  writeFileSync(join(out, 'run.json'), JSON.stringify({ version: 1, run_id: runId, batch: b.batch, brief_sha256: sha256(brief), items: items.length, packets: files, results, meters }, null, 2) + '\n');
  for (const r of results) console.log(r.judge + ': ' + r.answered + ' of ' + r.packets + ' packets answered, ' + r.requests + ' requests, $' + Number((meters[r.judge] as { usd?: number })?.usd ?? 0).toFixed(4) + (r.unjudged.length ? ', unjudged ' + r.unjudged.length : '') + (r.refused ? ', REFUSED ' + r.refused : '') + (r.stopped ? ', STOPPED ' + r.stopped : ''));
  return results.some((r) => r.refused || r.stopped) ? 3 : 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { process.stderr.write('adjudicate-dry-run: ' + (e as Error).message + '\n'); process.exit(2); });
}
