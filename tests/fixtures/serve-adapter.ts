#!/usr/bin/env bun
// Fixture adapter for the runner tests: honours the serve protocol of docs/adapters.md as a host process,
// with no harness and no model. It writes $HE_LOG_DIR/ready, then answers $HE_TURNS_DIR/turn-NNNN.request.json
// files with turn-NNNN.response.json until SIGTERM. Markers in the request text drive its behaviour:
//   [fx:sleep N]        take N seconds before answering (for the runner's wall clock)
//   [fx:exit 2]         answer with exit 2 (harness error); [fx:exit 3] exit 3 (model error)
//   [fx:read #name]     read that channel's history through the Slack mock with the bot token (a cross-scope read when the requester is not a member)
//   [fx:leak]           put every earlier turn's text into the reply (a DM fact leaks into another conversation)
//   [fx:model]          make one model call through HE_MODEL_BASE_URL (the proxy refuses it keyless; the reply then carries exit 3)
// FX_NEVER_READY=1 in the environment makes it never write ready (for the ready timeout).

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const env = (k: string) => { const v = process.env[k]; if (!v) { console.error(`fixture adapter: ${k} is not set`); process.exit(2); } return v; };
if (process.argv[2] !== 'serve') { console.error(`fixture adapter: only serve is implemented (got ${process.argv[2]})`); process.exit(2); }
const logs = env('HE_LOG_DIR');
const turns = env('HE_TURNS_DIR');
const state = env('HE_SESSION_STATE_DIR');
mkdirSync(logs, { recursive: true }); mkdirSync(turns, { recursive: true }); mkdirSync(state, { recursive: true });
const log = (line: string) => writeFileSync(join(logs, 'adapter.log'), `${new Date().toISOString()} fixture[${process.env.HE_TRIAL_ID}] ${line}\n`, { flag: 'a' });

const memory: string[] = [];
let running = true;
process.on('SIGTERM', () => { running = false; log('SIGTERM'); process.exit(0); });

async function answer(file: string) {
  const req = JSON.parse(readFileSync(join(turns, file), 'utf8')) as { turn: number; text: string; prompt: string; actor: { member: string }; channel: { name: string }; thread_ts: string | null };
  const started_at = new Date().toISOString();
  const text = req.text;
  let exit = 0;
  const parts: string[] = [];
  const sleep = text.match(/\[fx:sleep (\d+)\]/);
  if (sleep) await Bun.sleep(Number(sleep[1]) * 1000);
  const read = text.match(/\[fx:read #([a-z0-9-]+)\]/);
  if (read) {
    const res = await fetch(`${env('HE_SLACK_API_URL')}conversations.history`, { method: 'POST', headers: { authorization: `Bearer ${env('HE_SLACK_BOT_TOKEN')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ channel: read[1]!, limit: '5' }) });
    const body = await res.json() as { ok: boolean; messages?: unknown[]; error?: string };
    parts.push(body.ok ? `I looked at #${read[1]} (${body.messages?.length ?? 0} messages).` : `#${read[1]}: ${body.error}`);
  }
  if (text.includes('[fx:model]')) {
    const res = await fetch(`${env('HE_MODEL_BASE_URL')}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env('HE_MODEL_API_KEY') }, body: JSON.stringify({ model: process.env.HE_MODEL_NAME, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] }) }).catch(() => null);
    if (!res || res.status >= 400) exit = 3;
    parts.push(`model call: ${res ? res.status : 'unreachable'}`);
  }
  if (text.includes('[fx:leak]')) parts.push(`Earlier I was told: ${memory.join(' | ')}`);
  const forced = text.match(/\[fx:exit (2|3)\]/);
  if (forced) exit = Number(forced[1]);
  memory.push(text);
  if (!parts.length) parts.push(`ack from ${req.channel.name}: ${text.replace(/\[fx:[^\]]*\]/g, '').trim()}`);
  if (req.thread_ts) parts.push(`(new session for thread ${req.thread_ts})`);
  writeFileSync(join(state, 'fixture-state.json'), JSON.stringify({ turns: memory.length }));
  const response = { turn: req.turn, exit, reply_text: exit === 0 ? parts.join(' ') : null, started_at, ended_at: new Date().toISOString(), detail: exit ? 'fixture marker' : undefined };
  const out = join(turns, file.replace('.request.json', '.response.json'));
  writeFileSync(out + '.tmp', JSON.stringify(response));
  renameSync(out + '.tmp', out);
  log(`turn ${req.turn} exit ${exit}`);
}

if (process.env.FX_NEVER_READY !== '1') writeFileSync(join(logs, 'ready'), new Date().toISOString());
log(`serving ${turns}; prompt placeholders filled by the runner`);
const seen = new Set<string>();
while (running) {
  for (const f of readdirSync(turns).filter((f) => f.endsWith('.request.json')).sort()) {
    if (seen.has(f) || existsSync(join(turns, f.replace('.request.json', '.response.json')))) continue;
    seen.add(f);
    await answer(f);
  }
  await Bun.sleep(50);
}
