import { readFileSync } from 'node:fs';

// Reads the whole nightly export into memory, then totals by region.
const text = readFileSync(process.argv[2], 'utf8');
const totals = {};
for (const line of text.split('\n').slice(1)) {
  if (!line) continue;
  const [, region, cents] = line.split(',');
  totals[region] = (totals[region] ?? 0) + Number(cents);
}
console.log(totals);
