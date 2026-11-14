#!/usr/bin/env bun
// The zero-data-retention gate of the frontier Harbor path. Since 2026-11-14 the OpenAI organization behind the shared
// OPENAI_API_KEY enforces Zero Data Retention, so a Responses request that chains on previous_response_id fails with
// HTTP 400 ("Previous response cannot be used for this organization due to Zero Data Retention"; org faq). A harness
// that chains would lose every OpenAI trial at its second turn. In the keyless install check, fake-upstream.ts answers a
// Responses request that declares a function or custom tool (in a namespace too, as Codex does) with one call of that
// tool, so each harness sends a second turn, and it refuses a chained request with that 400. This reads what each harness sent, from the install check's captures:
//
//   bun scripts/frontier-harbor/zdr-check.ts --smoke <install-check out dir> --prereg <prereg.json> --cells a,b [--out <file>]
//
// For each of the given cells whose model is openai:*, it takes the install check trial of the same harness and model
// (else the same harness and provider) and reads its captured request bodies, as web-tools-check.ts does. The cell
// passes when no captured request carries previous_response_id and the harness sent a Responses turn with the tool's
// output (function_call_output) in its input, so the probe saw a whole continuation; a harness whose OpenAI calls are
// all Chat Completions has nothing to chain and passes as such. It fails when a request chained, when no Responses turn
// carried a tool output, or when the trial has no capture. Other cells are not read.
// scripts/ubicloud/run-shard.sh runs it (--zdr-gate) before any VM for a frontier-harbor shard with an OpenAI cell.
//
// Writes the JSON (counts only, never a body) and prints one line per failing cell, then the verdict.
// Exit 0: every OpenAI cell passes, or there is none. 4: a cell fails. 2: usage.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPTURE_FILE } from '../../runner/proxy/capture.ts';
import { captureDir, readBinds } from './broker.ts';

export interface ZdrRow {
  cell: string; harness: string; model: string; status: 'pass' | 'fail' | 'no_capture';
  smoke_cell: string | null; smoke_trial: string | null;
  responses_requests: number; chained_requests: number; tool_output_turns: number; chat_requests: number; note?: string;
}
export interface ZdrReport { schema: 'frontier-harbor-zdr/1'; smoke: string; pass: boolean; cells: ZdrRow[] }

export class UsageError extends Error {}

const CODE = 'HE-FRONTIER-013';

/** Counts over one capture file: Responses requests, those chained on previous_response_id, those whose input carries a
 *  tool output, and Chat Completions requests. */
export function zdrCounts(file: string) {
  const c = { responses_requests: 0, chained_requests: 0, tool_output_turns: 0, chat_requests: 0 };
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (!raw.trim()) continue;
    const e = JSON.parse(raw) as { route?: string; body?: unknown };
    const body = (typeof e.body === 'string' ? (() => { try { return JSON.parse(e.body as string); } catch { return null; } })() : e.body) as Record<string, any> | null;
    if (!body || typeof body !== 'object') continue;
    const route = String(e.route ?? '');
    if (route.endsWith('/chat/completions')) { c.chat_requests++; continue; }
    if (!route.endsWith('/v1/responses')) continue;
    c.responses_requests++;
    if (typeof body.previous_response_id === 'string' && body.previous_response_id !== '') c.chained_requests++;
    if (Array.isArray(body.input) && body.input.some((i: any) => i && (i.type === 'function_call_output' || i.type === 'custom_tool_call_output'))) c.tool_output_turns++;
  }
  return c;
}

export function checkZdr(o: { smoke: string; prereg: string; cells: string[] }): ZdrReport {
  const p = JSON.parse(readFileSync(o.prereg, 'utf8')) as { cells?: Array<{ id: string; harness: string; model: string }> };
  const known = new Set((p.cells ?? []).map((c) => c.id));
  const missing = o.cells.filter((c) => !known.has(c));
  if (missing.length) throw new UsageError('cell(s) ' + missing.join(',') + ' not in ' + o.prereg);
  const run = join(o.smoke, 'agents', 'run');
  const binds = readBinds(join(run, 'binds.jsonl'));
  const provider = (m: string) => m.split(':')[0];
  const rows = (p.cells ?? []).filter((c) => o.cells.includes(c.id) && provider(c.model) === 'openai').map((c): ZdrRow => {
    const row: ZdrRow = { cell: c.id, harness: c.harness, model: c.model, status: 'no_capture', smoke_cell: null, smoke_trial: null, responses_requests: 0, chained_requests: 0, tool_output_turns: 0, chat_requests: 0 };
    const b = binds.find((x) => x.harness === c.harness && x.model === c.model) ?? binds.find((x) => x.harness === c.harness && provider(x.model) === 'openai');
    if (!b) return { ...row, note: binds.length ? 'the install check bound no ' + c.harness + ' slot on openai' : 'no install check binds at ' + join(run, 'binds.jsonl') };
    const found = { ...row, smoke_cell: b.cell, smoke_trial: b.trial };
    const file = join(run, 'jobs', captureDir(b.cell ?? '', b.attempt ?? 1, b.trial, b.job), CAPTURE_FILE);
    if (!existsSync(file)) return { ...found, note: 'the install check trial has no capture file' };
    const n = { ...found, ...zdrCounts(file) };
    if (n.chained_requests) return { ...n, status: 'fail', note: n.chained_requests + ' of ' + n.responses_requests + ' Responses requests chain on previous_response_id, which a zero-data-retention organization refuses with HTTP 400' };
    if (n.responses_requests && !n.tool_output_turns) return { ...n, status: 'fail', note: 'no Responses request carried a tool output, so the check never saw how this harness continues a turn' };
    if (!n.responses_requests && !n.chat_requests) return { ...n, note: 'the install check trial captured no OpenAI request' };
    return { ...n, status: 'pass', ...(n.responses_requests ? {} : { note: 'Chat Completions only: nothing to chain' }) };
  });
  return { schema: 'frontier-harbor-zdr/1', smoke: o.smoke, pass: rows.every((r) => r.status === 'pass'), cells: rows };
}

export function reportLines(r: ZdrReport): string[] {
  const lines = r.cells.filter((c) => c.status !== 'pass').map((c) => CODE + ' zero-data-retention check: cell ' + c.cell + ' (' + c.harness + ', ' + c.model + '): ' + (c.note ?? c.status) + '; this cell does not run');
  const count = (s: ZdrRow['status']) => r.cells.filter((c) => c.status === s).length;
  lines.push('ZDR: ' + (r.pass ? 'ok' : 'fail') + ' openai_cells=' + r.cells.length + ' pass=' + count('pass') + ' fail=' + (count('fail') + count('no_capture')));
  return lines;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const smoke = flag('--smoke'), prereg = flag('--prereg'), cells = flag('--cells');
  if (!smoke || !prereg || !cells) { console.error('usage: zdr-check.ts --smoke <install-check out dir> --prereg <prereg.json> --cells a,b [--out <file>]'); process.exit(2); }
  let report: ZdrReport;
  try { report = checkZdr({ smoke, prereg, cells: cells.split(',').filter(Boolean) }); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error('zdr-check: ' + e.message);
    process.exit(2);
  }
  writeFileSync(flag('--out') ?? join(smoke, 'zdr.json'), JSON.stringify(report, null, 2) + '\n');
  for (const l of reportLines(report)) console.log(l);
  process.exit(report.pass ? 0 : 4);
}
