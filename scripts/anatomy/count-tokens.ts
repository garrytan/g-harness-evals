#!/usr/bin/env bun
// Token counts for captured prompts, at no cost.
//
// The capture itself never touches a provider. For an Anthropic Messages
// capture this separate step sends the first agent request, and each piece of
// it, to Anthropic's free count_tokens endpoint through the metering proxy in
// lease mode, so the key stays in the proxy's environment and every call is on
// the usage log at $0. Only public dev-task prompts are captured, so nothing
// held out is sent.
//
// An OpenAI Responses capture is counted locally instead, with the o200k_base
// tokenizer (gpt-tokenizer, pinned in package.json), and needs no key: the
// metering proxy has no free OpenAI counting route, and none is added. The
// output says method "local" and names the tokenizer. A local count is of the
// text and JSON as sent; the provider renders tools and message framing in its
// own format, so its input_tokens will differ. It is never an Anthropic count,
// and an Anthropic count is never written for a Responses capture.
//
//   bun scripts/anatomy/count-tokens.ts --capture <capture dir> [--capture <dir> ...] [--out <dir>]
//
// Writes <capture dir>/tokens.json (or <out>/<capture id>.tokens.json):
// whole request, system, tools, messages, every system section (from
// dissect.ts) and every tool. System, sections and tools are input_tokens minus
// a one-message baseline; messages are counted alone as sent, framing included.
// The proxy's usage log (its path is printed) proves the calls cost $0. For a
// Responses capture: whole request (instructions, input and tools as sent),
// system (instructions plus system and developer input messages), every system
// section, the tools (every definition, additional_tools included) and each
// tool, and the messages (the other input items), each counted alone.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { type AnatomyRecord, dissect, readLog, systemBlocks } from './dissect.ts';

const ROOT = resolve(import.meta.dir, '../..');
const KEEP = ['model', 'system', 'tools', 'messages', 'tool_choice'];
const BASE_MESSAGES = [{ role: 'user', content: '.' }];

function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => { if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]!); });
  return out;
}

async function startProxy(dir: string) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set in this shell; the proxy needs it (it is never printed)');
  const port = 18700 + Math.floor(Math.random() * 200);
  const control = randomBytes(16).toString('hex');
  const proc = spawn(process.execPath, ['runner/proxy/metering-proxy.ts', '--listen', `127.0.0.1:${port}`, '--control-token', control,
    '--budget-ledger', join(dir, 'ledger.sqlite'), '--lease-usd', '1', '--run-id', `anatomy-count-${Date.now()}`, '--new-run',
    '--usage-log', join(dir, 'usage.ndjson'), '--free-count-tokens'],
    { cwd: ROOT, stdio: 'ignore', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: homedir(), ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/__proxy/status`)).ok) break; } catch { /* starting */ } await Bun.sleep(100); }
  const token = `trial-token:anatomy-count.${randomBytes(16).toString('hex')}`;
  await fetch(`${base}/__proxy/bind`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': control }, body: JSON.stringify({ slot: 'count', key: 'trial-token:anatomy-count', token }) });
  const count = async (body: Record<string, unknown>): Promise<number> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`${base}/count/anthropic/v1/messages/count_tokens`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': token, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
      if (res.ok) return ((await res.json()) as { input_tokens: number }).input_tokens;
      if (res.status !== 429 && res.status < 500) throw new Error(`count_tokens answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      await Bun.sleep(2000 * (attempt + 1));
    }
    throw new Error('count_tokens kept failing');
  };
  return { count, stop: () => proc.kill('SIGTERM') };
}

export const LOCAL_TOKENIZER = 'o200k_base (gpt-tokenizer 4.1.0)';

const o200k = (s: string) => countTokens(s, { disallowedSpecial: new Set() });

/** The local o200k_base counts for a Responses capture's first agent request. No network, no key. */
export function countResponsesLocally(rec: AnatomyRecord, body: Record<string, unknown>, capture: string): Record<string, unknown> {
  const fa = rec.first_agent!;
  const text = systemBlocks(body, rec.wire).map((b) => b.text).join('');
  const buf = Buffer.from(text, 'utf8');
  const additional = Array.isArray(body.input) ? (body.input as Array<Record<string, unknown>>).filter((m) => m && m.type === 'additional_tools') : [];
  const toolDefs: unknown[] = [...(Array.isArray(body.tools) ? body.tools : []), ...additional.flatMap((m) => (Array.isArray(m.tools) ? m.tools : []))];
  const flat: Array<{ name: string; def: unknown }> = [];
  const walk = (list: unknown[]) => { for (const t of list) { const r = (t ?? {}) as Record<string, unknown>; if (r.type === 'namespace' && Array.isArray(r.tools)) walk(r.tools); else flat.push({ name: String(r.name ?? r.type ?? ''), def: t }); } };
  walk(toolDefs);
  const conversation = Array.isArray(body.input) ? (body.input as Array<Record<string, unknown>>).filter((m) => !(m && (m.type === 'additional_tools' || ((m.role === 'system' || m.role === 'developer') && (m.type === undefined || m.type === 'message'))))) : body.input;
  const prompt = Object.fromEntries(['instructions', 'input', 'tools'].filter((k) => k in body).map((k) => [k, body[k]]));
  const counted = JSON.stringify(prompt);
  const total = o200k(counted);
  return {
    capture, model: String(body.model), method: 'local', tokenizer: LOCAL_TOKENIZER, source_log_sha256: rec.source_log_sha256, request_index: fa.i,
    total_tokens: total, system_tokens: o200k(text), tools_tokens: toolDefs.length ? o200k(JSON.stringify(toolDefs)) : 0,
    messages_tokens: conversation === undefined ? 0 : o200k(typeof conversation === 'string' ? conversation : JSON.stringify(conversation)), body_bytes: fa.body_bytes,
    counted_bytes: Buffer.byteLength(counted), bytes_per_token: Number((Buffer.byteLength(counted) / total).toFixed(3)),
    sections: fa.system.sections.map((s) => ({ title: s.title, bytes: s.bytes, tokens: o200k(buf.subarray(s.start, s.start + s.bytes).toString('utf8')) })),
    tools: flat.map((t) => ({ name: t.name, tokens: o200k(JSON.stringify(t.def)) })),
    note: `Local count with the ${LOCAL_TOKENIZER} tokenizer, not a provider count: no free OpenAI counting route exists in the metering proxy, so nothing was sent anywhere. System is the text of instructions and of every system or developer input message; tools are the tool definitions as JSON (the tools array and every additional_tools item); messages are the other input items as JSON; the total is instructions, input and tools as JSON, and bytes_per_token is that JSON's bytes (counted_bytes) per token, not the whole body's. The provider renders tools and message framing in its own format, so its input_tokens will differ, and these numbers are not comparable with Anthropic count_tokens numbers.`,
  };
}

if (import.meta.main) {
  const captures = args('capture');
  if (!captures.length) { console.error('usage: count-tokens.ts --capture <dir> [--capture <dir> ...] [--out <dir>]'); process.exit(64); }
  const work = mkdtempSync(join(tmpdir(), 'anatomy-count-'));
  const responsesOnly = captures.every((d) => {
    const log = join(resolve(d), 'fake.ndjson');
    return existsSync(log) && readLog(log).rows.some((r) => r.path.endsWith('/responses'));
  });
  let proxy: Awaited<ReturnType<typeof startProxy>> | null = responsesOnly ? null : await startProxy(work);
  try {
    for (const dir of captures.map((d) => resolve(d))) {
      const log = join(dir, 'fake.ndjson');
      if (!existsSync(log)) { console.log(`TOKENS: ${basename(dir)} skipped (no fake.ndjson)`); continue; }
      const { rows, sha256 } = readLog(log);
      const cap = existsSync(join(dir, 'capture.json')) ? JSON.parse(readFileSync(join(dir, 'capture.json'), 'utf8')) : {};
      const rec = dissect(rows, { harness: cap.harness ?? 'unknown', config: cap.config ?? 'default', source_log_sha256: sha256 });
      if (!rec.first_agent) { console.log(`TOKENS: ${basename(dir)} skipped (no agent request)`); continue; }
      const body = rows[rec.first_agent.i]!.body as Record<string, unknown>;
      const target = args('out')[0] ? join(resolve(args('out')[0]!), `${basename(dir)}.tokens.json`) : join(dir, 'tokens.json');
      if (rec.wire === 'openai-responses') {
        const out = countResponsesLocally(rec, body, basename(dir));
        writeFileSync(target, JSON.stringify(out, null, 2));
        console.log(`TOKENS: ${basename(dir)} method=local tokenizer=${LOCAL_TOKENIZER} total=${out.total_tokens} system=${out.system_tokens} tools=${out.tools_tokens} messages=${out.messages_tokens} bytes/token=${out.bytes_per_token}`);
        continue;
      }
      proxy ??= await startProxy(work);
      const model = String(body.model);
      if (Array.isArray(body.messages)) body.messages = (body.messages as Array<Record<string, unknown>>).map(({ role, content }) => ({ role, content }));
      const full = Object.fromEntries(KEEP.filter((k) => k in body).map((k) => [k, body[k]]));
      const baseline = await proxy.count({ model, messages: BASE_MESSAGES });
      const total = await proxy.count(full);
      const system = body.system !== undefined ? (await proxy.count({ model, system: body.system, messages: BASE_MESSAGES })) - baseline : 0;
      const toolsList = Array.isArray(body.tools) ? body.tools as Array<Record<string, unknown>> : [];
      const tools = toolsList.length ? (await proxy.count({ model, tools: toolsList, messages: BASE_MESSAGES })) - baseline : 0;
      const messages = (await proxy.count({ model, messages: body.messages })) ;
      const text = systemBlocks(body, rec.wire).map((b) => b.text).join('');
      const sections = [];
      for (const s of rec.first_agent.system.sections) {
        const slice = Buffer.from(text, 'utf8').subarray(s.start, s.start + s.bytes).toString('utf8');
        sections.push({ title: s.title, bytes: s.bytes, tokens: slice.trim() ? (await proxy.count({ model, system: slice, messages: BASE_MESSAGES })) - baseline : 0 });
      }
      const perTool = [];
      for (const t of toolsList) perTool.push({ name: String(t.name), tokens: t.defer_loading === true ? null : (await proxy.count({ model, tools: [t], messages: BASE_MESSAGES })) - baseline });
      const out = { capture: basename(dir), model, method: 'anthropic count_tokens', source_log_sha256: sha256, request_index: rec.first_agent.i, baseline_tokens: baseline,
        total_tokens: total, system_tokens: system, tools_tokens: tools, messages_tokens: messages, body_bytes: rec.first_agent.body_bytes,
        bytes_per_token: Number((rec.first_agent.body_bytes / total).toFixed(3)), sections, tools: perTool,
        note: 'The thinking setting and any per-message field other than role and content (Claude Code puts output_config on a message) are left out of every count, because count_tokens refuses them. System, sections and tools are each counted alone with a one-message baseline subtracted; messages are counted alone as sent. Parts do not sum exactly to the total because the API adds framing per request.' };
      writeFileSync(target, JSON.stringify(out, null, 2));
      console.log(`TOKENS: ${basename(dir)} total=${total} system=${system} tools=${tools} messages=${messages} bytes/token=${out.bytes_per_token}`);
    }
  } finally { proxy?.stop(); }
  const usage = existsSync(join(work, 'usage.ndjson')) ? readFileSync(join(work, 'usage.ndjson'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const paid = usage.reduce((s, l) => s + (l.actual_usd ?? 0), 0);
  console.log(`TOKENS_USAGE: ${usage.length} calls through the proxy, actual_usd total ${paid}, refused ${usage.filter((l) => l.outcome !== 'forwarded').length} (log ${join(work, 'usage.ndjson')})`);
}
