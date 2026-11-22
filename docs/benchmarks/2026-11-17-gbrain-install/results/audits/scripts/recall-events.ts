import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseTurn, isGbrainServed, hasToken, isGbrainCall } from '../../../../../../scripts/gbrain-install/transcript.ts';
// Usage: bun recall-events.ts <run dir> <scratch dir>. <run dir> is the run/ folder of the raw archive raw-2026-11-17-gbrain-install--run.
if (process.argv.length < 4) { console.error('usage: bun recall-events.ts <run dir> <scratch dir>'); process.exit(2); }
const [RUN, SCRATCH] = process.argv.slice(2, 4).map(p => resolve(p));
const shard = new Map(readFileSync(join(RUN, 'readers/cell-shard.txt'), 'utf8').trim().split('\n').map(l => l.split(/\s+/) as [string, string]));
const recs = readFileSync(join(RUN, 'merged/trials.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const out: any[] = [];
for (const r of recs) {
  if (r.install.outcome !== 'recalled') continue;
  const rn = r.trial_id.split('/').at(-1);
  const dir = join(RUN, 'lite', shard.get(r.cell)!, 'results/trials', r.cell, 'gbrain-install', rn);
  const turns = JSON.parse(readFileSync(join(dir, 'install-turns.json'), 'utf8'));
  const recall = turns.find((t: any) => t.role === 'recall');
  const evs = parseTurn(r.harness, join(dir, 'logs'), recall.turn, recall.session);
  const credited = evs.filter(e => isGbrainServed(e) && !e.is_error && hasToken(e.output, r.install.nonce));
  out.push({ trial_id: r.trial_id, cell: r.cell, harness: r.harness, termination: r.termination, nonce: r.install.nonce, shard: shard.get(r.cell), rn, dir, recall_turn: recall.turn,
    gbrain_calls: evs.filter(isGbrainCall).map(e => ({ kind: e.kind, name: e.name, input: e.input.slice(0, 400), served: isGbrainServed(e), is_error: e.is_error, has_nonce: hasToken(e.output, r.install.nonce) })),
    credited: credited.map(e => ({ kind: e.kind, name: e.name, input: e.input, output: e.output })) });
}
mkdirSync(SCRATCH, { recursive: true });
writeFileSync(join(SCRATCH, 'recall-events.json'), JSON.stringify(out, null, 1));
console.log(out.length, out.filter(o => o.credited.length === 0).length);
