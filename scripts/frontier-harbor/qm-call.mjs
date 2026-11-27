// Signed calls to QM core on the frontier Harbor path (internal-task), run inside the core container with docker exec -i, so
// the signing secret and the per-trial token come from core's own environment and never from an argument or a file.
// Requests are signed the way QM's own plugins sign them (harnesses/qm/qm-api.mjs):
// x-signature = v0=HMAC-SHA256(CORE_SIGNING_SECRET, "v0:<ts>:<METHOD>\n<path>\n<body>").
//
//   node qm-call.mjs admin <METHOD> <path>     body on stdin, sent as harness-admin@harness-eval (x-admin-actor); a
//                                              JSON body whose top-level apiKey is exactly @HE_QM_PROXY_TOKEN@ (the custom
//                                              provider's key) gets that variable of core's environment there and nowhere
//                                              else, so the marker in any other field (a SOUL's text) is sent as written;
//                                              the reply's body is printed without the token
//   node qm-call.mjs turn <thread-ref>         the turn's text on stdin: POST /v1/turns {surface: harness-eval, actor U1,
//                                              conversation dm <thread-ref>, origin human with a messageTs}. The task is a
//                                              person's message, and QM treats a turn with no origin as an automated
//                                              caller (direct), which changes its memory, screening, approvals and author
//                                              checks
//   node qm-call.mjs health                    GET /healthz
//
// Prints {http, body} as JSON on stdout. It uses node:http with no request timeout, unlike qm-api.mjs's fetch (undici's
// 300-second headers timeout), because a QM turn holds its one HTTP request open until the turn ends; Harbor's agent timeout
// bounds the turn. Exit 0 on a 2xx, 2 otherwise, 64 on bad usage.
import { createHmac } from 'node:crypto';
import http from 'node:http';

const ADMIN = 'harness-admin@harness-eval';
const [mode, ...rest] = process.argv.slice(2);
const secret = process.env.CORE_SIGNING_SECRET;
const port = Number(process.env.PORT);
if (!secret || !port) fail(64, 'CORE_SIGNING_SECRET and PORT must be set in the core container');

function fail(code, message) {
  console.error('qm-call: ' + message);
  process.exit(code);
}

async function stdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function call(method, path, body, headers = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const signature = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${method}\n${path}\n${body}`).digest('hex');
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: {
      'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-timestamp': String(ts), 'x-signature': signature, ...headers,
    } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = text;
        try { parsed = JSON.parse(text); } catch {}
        resolve({ http: res.statusCode, body: parsed });
      });
      res.on('error', reject);
    });
    req.setTimeout(0);
    req.on('error', reject);
    req.end(method === 'GET' ? undefined : body);
  });
}

let out;
try {
  if (mode === 'health' && rest.length === 0) out = await call('GET', '/healthz', '');
  else if (mode === 'admin' && rest.length === 2 && ['GET', 'PUT', 'POST', 'DELETE'].includes(rest[0])) {
    const token = process.env.HE_QM_PROXY_TOKEN ?? '';
    let body = rest[0] === 'GET' ? '' : await stdin();
    let parsed = null;
    try { parsed = JSON.parse(body); } catch {}
    if (parsed?.apiKey === '@HE_QM_PROXY_TOKEN@') {
      if (!token) fail(2, 'the body\'s apiKey is @HE_QM_PROXY_TOKEN@ and core has no HE_QM_PROXY_TOKEN');
      body = JSON.stringify({ ...parsed, apiKey: token });
    }
    out = await call(rest[0], rest[1], body, { 'x-admin-actor': ADMIN });
    if (token) out = JSON.parse(JSON.stringify(out).replaceAll(token, '<per-trial token>'));
  } else if (mode === 'turn' && rest.length === 1) {
    const body = JSON.stringify({ surface: 'harness-eval', actor: { externalId: 'U1' }, conversation: { kind: 'dm', threadRef: rest[0] }, origin: { kind: 'human', messageTs: (Date.now() / 1000).toFixed(6) }, text: await stdin() });
    out = await call('POST', '/v1/turns', body);
  } else fail(64, 'usage: qm-call.mjs admin <GET|PUT|POST|DELETE> <path> < body | turn <thread-ref> < text | health');
} catch (e) {
  fail(2, `${mode} failed: ${e?.message ?? e}`);
}
console.log(JSON.stringify(out));
process.exitCode = out.http >= 200 && out.http < 300 ? 0 : 2;
