// An allowlisting HTTP CONNECT proxy for the catalog capture's install step. It runs in its own container, attached to
// the default bridge and to an internal network that the install containers sit on, so an install can reach the package
// registries named on the command line and nothing else. Every decision is logged as one JSON line on stdout.
//
//   node egress-proxy.mjs 3128 registry.npmjs.org,pypi.org,...
import { createServer, request } from 'node:http';
import { connect } from 'node:net';

const port = Number(process.argv[2] ?? 3128);
const allow = (process.argv[3] ?? '').split(',').filter(Boolean);
const allowed = (host) => allow.some((a) => host === a || host.endsWith(`.${a}`));
const log = (o) => process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), ...o })}\n`);

const server = createServer((req, res) => {
  let url;
  try { url = new URL(req.url); } catch { res.writeHead(400).end(); return; }
  if (url.protocol !== 'http:' || !allowed(url.hostname)) {
    log({ kind: 'http', host: url.hostname, ok: false });
    res.writeHead(403).end('blocked by catalog egress allowlist\n');
    return;
  }
  log({ kind: 'http', host: url.hostname, ok: true });
  const up = request(url, { method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => res.writeHead(502).end());
  req.pipe(up);
});

server.on('connect', (req, sock, head) => {
  const [host, p] = String(req.url).split(':');
  if (!allowed(host) || p !== '443') {
    log({ kind: 'connect', host, port: p, ok: false });
    sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  log({ kind: 'connect', host, ok: true });
  const up = connect(443, host, () => {
    sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) up.write(head);
    up.pipe(sock);
    sock.pipe(up);
  });
  up.on('error', () => sock.destroy());
  sock.on('error', () => up.destroy());
});

server.listen(port, '0.0.0.0', () => log({ kind: 'listen', port, allow }));
