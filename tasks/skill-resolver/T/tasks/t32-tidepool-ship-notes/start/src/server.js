import http from 'node:http';
import { route } from './routes/index.js';

http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, version: process.env.FLY_IMAGE_REF ?? 'dev' }));
  }
  return route(req, res);
}).listen(8080);
