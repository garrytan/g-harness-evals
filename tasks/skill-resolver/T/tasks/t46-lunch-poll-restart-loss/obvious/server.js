import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const dir = import.meta.dirname;
const port = Number(process.env.PORT ?? 3000);

// Votes live outside the app directory, which is replaced on every redeploy.
// Point VOTES_PATH at the runtime's persistent volume; the default is a conventional state path.
const votesFile = process.env.VOTES_PATH ?? '/var/lib/lunch-poll/votes.json';
mkdirSync(dirname(votesFile), { recursive: true });
if (!existsSync(votesFile)) {
  writeFileSync(votesFile, readFileSync(join(dir, 'votes.json')));
}
let votes = JSON.parse(readFileSync(votesFile, 'utf8'));

function save() {
  const tmp = votesFile + '.tmp';
  writeFileSync(tmp, JSON.stringify(votes));
  renameSync(tmp, votesFile);
}

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
        save();
      }
      res.writeHead(303, { location: '/' });
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(port, () => console.log('lunch poll on :' + port));
