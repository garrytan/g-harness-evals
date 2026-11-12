import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = import.meta.dirname;
const votesFile = join(dir, 'votes.json');
let votes = JSON.parse(readFileSync(votesFile, 'utf8'));

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(readFileSync(join(dir, 'public/index.html')));
  }
  if (req.method === 'GET' && req.url === '/results') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(votes));
  }
  if (req.method === 'POST' && req.url === '/vote') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const choice = new URLSearchParams(body).get('choice');
      if (choice) {
        votes[choice] = (votes[choice] ?? 0) + 1;
        writeFileSync(votesFile, JSON.stringify(votes));
      }
      res.writeHead(303, { location: '/' });
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(3000, () => console.log('lunch poll on :3000'));
