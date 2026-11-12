import { createWriteStream } from 'node:fs';

const [out, n = '5000000'] = process.argv.slice(2);
const regions = ['north', 'south', 'east', 'west'];
const w = createWriteStream(out);
w.write('order_id,region,amount_cents,placed_at\n');
for (let i = 0; i < Number(n); i++) {
  const ok = w.write(200000 + i + ',' + regions[i % 4] + ',' + ((i * 37) % 9000 + 100) + ',2026-11-01T00:00:00Z\n');
  if (!ok) await new Promise((r) => w.once('drain', r));
}
w.end();
