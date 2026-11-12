import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const file = process.argv[2] ?? 'data/sample-orders.csv';
const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
const totals = {};
let rows = 0;
let peak = 0;
let header = true;
for await (const line of rl) {
  if (header) { header = false; continue; }
  if (!line) continue;
  const [, region, cents] = line.split(',');
  totals[region] = (totals[region] ?? 0) + Number(cents);
  if (++rows % 100000 === 0) peak = Math.max(peak, process.memoryUsage().rss);
}
peak = Math.max(peak, process.memoryUsage().rss);
console.log(JSON.stringify({ rows, totals, peak_rss_mb: Math.round(peak / 1048576) }));
