// Signed calls to QM core, for the adapter. Requests are source-authenticated the way QM's own
// plugins sign them: x-signature = v0=HMAC-SHA256(secret, "v0:<ts>:<METHOD>\n<path>\n<body>").
//
//   node qm-api.mjs turn <core-url> <secret> <job.json> [timeout-s]
//     job: { actor: { externalId, displayName? }, conversation: { kind, threadRef, channelRef?, channelName? },
//            text_file }
//     Posts one turn to /v1/turns, prints {http, body} as JSON on stdout and exits 0 on a completed turn,
//     3 on a model error, 124 when the request outlived timeout-s, 2 otherwise.
//   node qm-api.mjs mcp-register <core-url> <secret> <admin-actor> <server-id> <server.json>
//     PUT /v1/admin/mcp-servers/<id> as that admin principal (x-admin-actor), body from the file;
//     prints {http, body} and exits 0 when core accepted and probed the server, 2 otherwise.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [mode, coreUrl, secret, ...rest] = process.argv.slice(2);
if (!mode || !coreUrl || !secret) usage();

function usage() {
  console.error('usage: qm-api.mjs turn <core-url> <secret> <job.json> [timeout-s] | mcp-register <core-url> <secret> <admin-actor> <id> <server.json>');
  process.exit(64);
}
function safeJson(s) { try { return JSON.parse(s); } catch { return s; } }

async function signed(method, path, body, extraHeaders = {}, timeoutS = 300) {
  const ts = Math.floor(Date.now() / 1000);
  const signature = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${method}\n${path}\n${body}`).digest('hex');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(timeoutS) * 1000);
  try {
    const res = await fetch(coreUrl + path, {
      method, body, signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-timestamp': String(ts), 'x-signature': signature, ...extraHeaders },
    });
    const text = await res.text();
    return { http: res.status, body: safeJson(text) };
  } catch (e) {
    console.error(`qm-api: ${method} ${path} failed: ${e?.message ?? e}`);
    process.exit(controller.signal.aborted ? 124 : 2);
  } finally {
    clearTimeout(timer);
  }
}

if (mode === 'turn') {
  const [jobPath, timeoutS = '300'] = rest;
  if (!jobPath) usage();
  const job = JSON.parse(readFileSync(jobPath, 'utf8'));
  const body = JSON.stringify({
    surface: 'harness-eval',
    actor: job.actor,
    conversation: job.conversation,
    text: readFileSync(job.text_file, 'utf8'),
  });
  const out = await signed('POST', '/v1/turns', body, {}, timeoutS);
  console.log(JSON.stringify(out));
  if (out.http !== 200) process.exit(2);
  const result = out.body;
  // TurnResult.status: ok | refused | failed | pending_approval | queued | silent | react
  if (result && (result.status === 'ok' || result.status === 'silent' || result.status === 'pending_approval')) process.exit(0);
  if (result && result.refusalKind === 'model_budget') process.exit(3);
  if (result && typeof result.reason === 'string' && /(401|402|403|429|5\d\d|metering proxy|provider|model)/i.test(result.reason)) process.exit(3);
  process.exit(2);
}

if (mode === 'mcp-register') {
  const [adminActor, id, serverPath] = rest;
  if (!adminActor || !id || !serverPath) usage();
  const out = await signed('PUT', `/v1/admin/mcp-servers/${id}`, readFileSync(serverPath, 'utf8'), { 'x-admin-actor': adminActor }, 120);
  console.log(JSON.stringify(out));
  process.exit(out.http >= 200 && out.http < 300 ? 0 : 2);
}

usage();
