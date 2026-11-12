import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = import.meta.dirname;
const port = Number(process.env.PORT ?? 3000);

// The runtime resets the app's disk on every relaunch; only $DATA_DIR survives, and
// SQLite at exactly $DATA_DIR/app.db gets the strongest durability.
if (!process.env.DATA_DIR) {
  console.warn('DATA_DIR is not set: this runtime has no durable storage, so votes are kept in memory and lost on restart.');
}
const db = new DatabaseSync(process.env.DATA_DIR ? join(process.env.DATA_DIR, 'app.db') : ':memory:');
db.exec('CREATE TABLE IF NOT EXISTS votes (choice TEXT PRIMARY KEY, count INTEGER NOT NULL)');

// One-time import of the old votes.json shipped beside the code.
if (db.prepare('SELECT COUNT(*) AS n FROM votes').get().n === 0) {
  const seed = JSON.parse(readFileSync(join(dir, 'votes.json'), 'utf8'));
  const insert = db.prepare('INSERT INTO votes (choice, count) VALUES (?, ?)');
  for (const [choice, count] of Object.entries(seed)) insert.run(choice, count);
}

const addVote = db.prepare('INSERT INTO votes (choice, count) VALUES (?, 1) ON CONFLICT(choice) DO UPDATE SET count = count + 1');
const allVotes = db.prepare('SELECT choice, count FROM votes ORDER BY choice');

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(readFileSync(join(dir, 'public/index.html')));
  }
  if (req.method === 'GET' && req.url === '/results') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(Object.fromEntries(allVotes.all().map((r) => [r.choice, r.count]))));
  }
  if (req.method === 'POST' && req.url === '/vote') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const choice = new URLSearchParams(body).get('choice');
      if (choice) addVote.run(choice);
      res.writeHead(303, { location: '/' });
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(port, () => console.log('lunch poll on :' + port));
