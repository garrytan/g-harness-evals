// Audit 3 side check: for each counted run with no gbrain version in any probe record, did any gbrain call succeed in its transcript?
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTurn, isGbrainCall } from '<controller-work>/run-wt/scripts/gbrain-install/transcript.ts';
import { succeeded } from '<controller-work>/run-wt/scripts/gbrain-install/steps.ts';
const RUN = '<controller-work>/run';
const A = '<controller-work>/audits/audit3.json';
const a = JSON.parse(readFileSync(A, 'utf8'));
const shard = new Map(readFileSync(join(RUN, 'readers/cell-shard.txt'), 'utf8').trim().split('\n').map(l => l.split(/\s+/) as [string, string]));
const recs = new Map(readFileSync(join(RUN, 'merged/trials.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return [r.trial_id, r]; }));
const rows: any[] = [];
for (const t of a.trials.filter((t: any) => t.counted && t.recount.no_version_seen)) {
  const r = recs.get(t.trial_id);
  const dir = join(RUN, 'lite', shard.get(r.cell)!, 'results/trials', r.cell, 'gbrain-install', t.trial_id.split('/').at(-1));
  const turns = JSON.parse(readFileSync(join(dir, 'install-turns.json'), 'utf8'));
  const evs = turns.flatMap((x: any) => parseTurn(r.harness, join(dir, 'logs'), x.turn, x.session));
  const calls = evs.filter(isGbrainCall);
  const ok = calls.filter((e: any) => succeeded(e) && e.output.trim());
  rows.push({ trial_id: t.trial_id, outcome: r.install.outcome, gbrain_calls: calls.length, gbrain_calls_succeeded_with_output: ok.length, examples: ok.slice(0, 3).map((e: any) => ({ input: e.input.slice(0, 200), output: e.output.slice(0, 200) })) });
}
a.edge_checks.no_version_runs_transcript_check = rows;
writeFileSync(A, JSON.stringify(a, null, 1) + '\n');
console.log(JSON.stringify(rows.map(r => [r.trial_id.split('/')[1] + '/' + r.trial_id.split('/').at(-1), r.gbrain_calls, r.gbrain_calls_succeeded_with_output, r.examples.map((e: any) => e.input.slice(0, 120) + ' => ' + e.output.slice(0, 100))])));
