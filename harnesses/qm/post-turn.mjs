// Post one turn to QM core and print the result as JSON.
// Usage: node post-turn.mjs <core-url> <signing-secret> <actor-id> <thread-ref> <instruction-file> [timeout-s]
// Requests are source-authenticated the way QM's own plugins sign them:
// x-signature = v0=HMAC-SHA256(secret, "v0:<ts>:<METHOD>\n<path>\n<body>").
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [coreUrl, secret, actorId, threadRef, file, timeoutS = '300'] = process.argv.slice(2);
if (!coreUrl || !secret || !actorId || !threadRef || !file) {
  console.error('usage: post-turn.mjs <core-url> <signing-secret> <actor-id> <thread-ref> <instruction-file> [timeout-s]');
  process.exit(64);
}
const body = JSON.stringify({
  surface: 'harness-eval',
  actor: { externalId: actorId },
  conversation: { kind: 'dm', threadRef },
  text: readFileSync(file, 'utf8'),
});
const path = '/v1/turns';
const ts = Math.floor(Date.now() / 1000);
const signature = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:POST\n${path}\n${body}`).digest('hex');

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), Number(timeoutS) * 1000);
let res;
try {
  res = await fetch(coreUrl + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-timestamp': String(ts), 'x-signature': signature },
    body,
    signal: controller.signal,
  });
} catch (e) {
  console.error(`post-turn: request failed: ${e?.message ?? e}`);
  process.exit(controller.signal.aborted ? 124 : 2);
} finally {
  clearTimeout(timer);
}
const text = await res.text();
console.log(JSON.stringify({ http: res.status, body: safeJson(text) }));
if (res.status !== 200) process.exit(2);
const result = safeJson(text);
// TurnResult.status: ok | refused | failed | pending_approval | queued | silent | react
if (result && (result.status === 'ok' || result.status === 'silent' || result.status === 'pending_approval')) process.exit(0);
if (result && result.refusalKind === 'model_budget') process.exit(3);
if (result && typeof result.reason === 'string' && /(401|402|403|429|5\d\d|metering proxy|provider|model)/i.test(result.reason)) process.exit(3);
process.exit(2);

function safeJson(s) { try { return JSON.parse(s); } catch { return s; } }
