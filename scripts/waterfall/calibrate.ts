#!/usr/bin/env bun
// Tokens per byte for each request section (internal-task), at no cost.
//
// The section logger (runner/proxy/sections.ts) records bytes, not tokens. This step measures how many tokens a byte of
// each section type costs, so the cost waterfall can turn the logged bytes into tokens. It reads anatomy capture logs
// (the full request bodies scripts/anatomy/capture.ts recorded against the fake endpoint), splits every generation
// request with the same code the proxy uses, wraps each section's values (their JSON, concatenated) as one user text
// message, and counts it with Anthropic's free count_tokens route through the metering proxy (--free-count-tokens, as
// scripts/anatomy/count-tokens.ts does), minus a baseline request whose message is ".". The key stays in the proxy's
// environment and every call is on its usage log at $0. "other" (JSON framing) has no value of its own to count and is
// left out.
//
//   bun scripts/waterfall/calibrate.ts (--log <fake.ndjson> | --receipts <capture receipts dir>) [...] [--model claude-opus-5-5] [--out <file>] [--dry-run]
//
// --receipts reads a committed receipts directory (requests.ndjson and blobs/, scripts/anatomy/store.ts). --dry-run counts
// with a stub (one token per four bytes of the request's messages JSON) and needs no key and no network.
//
// Output (stdout, or --out): per section type, n (requests with that section), bytes and tokens summed, and tokens per
// byte pooled (tokens over bytes) with the per-request mean, median, min, max and standard deviation.
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseLog, readLog, type LogRow } from '../anatomy/dissect.ts';
import { unpack } from '../anatomy/store.ts';
import { SECTION_KEYS, sectionParts, sectionRoute, type SectionKey } from '../../runner/proxy/sections.ts';

export type Counter = (body: { model: string; messages: Array<{ role: 'user'; content: string }> }) => Promise<number>;
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const CALIBRATED: SectionKey[] = SECTION_KEYS.filter((k) => k !== 'other');
const BASELINE_TEXT = '.';

/** The stub counter of --dry-run: one token per four bytes of the messages JSON, rounded up. */
export const stubCounter: Counter = async (body) => Math.ceil(Buffer.byteLength(JSON.stringify(body.messages)) / 4);

/** The provider and route of a captured generation request, or null for anything else (discovery, a count, an error). */
export function routeOf(row: LogRow): { provider: string; route: string } | null {
  if (row.method !== 'POST' || (row.status ?? 200) >= 400) return null;
  const route = row.path.split('?')[0]!;
  const provider = route === '/v1/messages' ? 'anthropic' : 'openai';
  return sectionRoute(provider, route) ? { provider, route } : null;
}

interface Sample { bytes: number; tokens: number }
const stats = (xs: number[]) => {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const mid = sorted.length >> 1;
  const round = (x: number) => Number(x.toFixed(6));
  return { mean: round(mean), median: round(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2), min: round(sorted[0]!), max: round(sorted.at(-1)!),
    sd: round(Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length)) };
};

/** Count every section of every generation request in the given logs (name and rows each) under one model. */
export async function calibrate(logs: Array<{ name: string; rows: LogRow[] }>, model: string, count: Counter) {
  const baseline = await count({ model, messages: [{ role: 'user', content: BASELINE_TEXT }] });
  const samples = Object.fromEntries(CALIBRATED.map((k) => [k, [] as Sample[]])) as Record<SectionKey, Sample[]>;
  const inputs = [];
  for (const log of logs) {
    let requests = 0;
    for (const row of log.rows) {
      const at = routeOf(row);
      if (!at || !row.body || typeof row.body !== 'object') continue;
      const parts = sectionParts(row.body, at.provider, at.route);
      requests++;
      for (const key of CALIBRATED) {
        if (!parts[key].length) continue;
        const text = parts[key].map((v) => JSON.stringify(v)).join('');
        samples[key].push({ bytes: Buffer.byteLength(text), tokens: (await count({ model, messages: [{ role: 'user', content: text }] })) - baseline });
      }
    }
    inputs.push({ name: log.name, requests });
  }
  const sections = Object.fromEntries(CALIBRATED.map((k) => {
    const s = samples[k];
    const bytes = s.reduce((a, x) => a + x.bytes, 0), tokens = s.reduce((a, x) => a + x.tokens, 0);
    return [k, { n: s.length, bytes, tokens, tokens_per_byte: s.length ? { pooled: Number((tokens / bytes).toFixed(6)), ...stats(s.map((x) => x.tokens / x.bytes))! } : null }];
  }));
  return { model, baseline_tokens: baseline, inputs, sections,
    note: 'Each section type of each request is its values JSON-serialized and concatenated, sent as one user text message to count_tokens, minus a baseline whose message is "."; tokens_per_byte is per request, pooled is tokens over bytes across requests. "other" (JSON framing, settings) is not counted.' };
}

function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => { if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]!); });
  return out;
}

if (import.meta.main) {
  const logs = [
    ...args('log').map((p) => ({ name: resolve(p), rows: readLog(resolve(p)).rows })),
    ...args('receipts').map((d) => ({ name: resolve(d), rows: parseLog(unpack(resolve(d))) })),
  ];
  if (!logs.length) { console.error('usage: calibrate.ts (--log <fake.ndjson> | --receipts <dir>) [...] [--model claude-opus-5-5] [--out <file>] [--dry-run]'); process.exit(64); }
  for (const l of logs) if (!existsSync(l.name)) { console.error(`calibrate: ${l.name} does not exist`); process.exit(64); }
  const model = args('model')[0] ?? DEFAULT_MODEL;
  const dry = process.argv.includes('--dry-run');
  let stop = () => {};
  let count = stubCounter;
  if (!dry) {
    const { startProxy } = await import('../anatomy/count-tokens.ts');
    const proxy = await startProxy(mkdtempSync(join(tmpdir(), 'waterfall-calibrate-')));
    count = (body) => proxy.count(body);
    stop = proxy.stop;
  }
  try {
    const out = { ...(await calibrate(logs, model, count)), counter: dry ? 'stub (--dry-run): one token per four bytes of the messages JSON' : 'anthropic count_tokens through the metering proxy (free)' };
    const text = JSON.stringify(out, null, 2) + '\n';
    if (args('out')[0]) writeFileSync(resolve(args('out')[0]!), text); else process.stdout.write(text);
    for (const [k, v] of Object.entries(out.sections)) console.error(`CALIBRATE: ${k} n=${v.n} tokens_per_byte=${v.tokens_per_byte?.pooled ?? 'n/a'}`);
  } finally { stop(); }
}
