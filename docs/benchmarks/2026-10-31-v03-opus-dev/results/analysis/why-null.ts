// The "Why null?" figures of v03-opus-dev-2026-10 (report.md, "Why null?"), read from this results directory only.
// Run from the repository root: bun docs/benchmarks/2026-10-31-v03-opus-dev/results/analysis/why-null.ts
// Writes why-null.json and why-null.md beside this file, or into the directory given as the first argument. Descriptive: no arm is tested against another.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isGbrainCall } from '../../../../../scripts/gbrain-usage.ts';
import type { WorldEvent } from '../../../../../world/services/events.ts';

const HERE = import.meta.dir;
const RESULTS = dirname(HERE);
const OUT = process.argv[2] ?? HERE;
type Rec = { trial_id: string; cell: string; termination: string; grade: string; consent_violation: boolean };
const rows: Rec[] = readFileSync(join(RESULTS, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const EXCLUDED = new Set(['model_error', 'infra_error', 'exam_fault']);
const FAMILIES = { si: 'scope isolation', sc: 'shared channel', sy: 'synthesis', cn: 'continuity', cr: 'corrections', ar: 'approval relay' } as const;
const CONFIGS = { 'gbrain-told-scoped': 'told-scoped', 'gbrain-told-company': 'told-company', none: 'none' } as const;
const HARNESSES = { openclaw: 'OpenClaw', hermes: 'Hermes' } as const;
const WORLD_READS = ['conversations.history', 'files.read'] as const;
const task = (r: Rec) => r.trial_id.split('/')[2]!;
const events = (r: Rec): WorldEvent[] => readFileSync(join(RESULTS, 'trials', ...r.trial_id.split('/').slice(1), 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

type Block = { scored: number; passes: number; gbrain_calls: number; trials_with_gbrain_call: number; bot_world_reads: Record<string, number> };
const blank = (): Block => ({ scored: 0, passes: 0, gbrain_calls: 0, trials_with_gbrain_call: 0, bot_world_reads: Object.fromEntries(WORLD_READS.map((t) => [t, 0])) });
const perFamily: Record<string, Record<string, Record<string, Block>>> = {};
const perConfig: Record<string, Block> = {};
const taskCalls: Record<string, Record<string, number[]>> = {};
for (const r of rows) {
  if (EXCLUDED.has(r.termination)) continue;
  const [h, c] = Object.keys(HARNESSES).flatMap((hk) => Object.keys(CONFIGS).filter((ck) => r.cell === `${hk}-opus-${ck}-mu-v03-dev`).map((ck) => [hk, ck]))[0]!;
  const fam = task(r).slice(0, 2);
  const ev = events(r);
  const calls = ev.filter(isGbrainCall).length;
  for (const b of [(((perFamily[h!] ??= {})[c!] ??= {})[fam] ??= blank()), (perConfig[c!] ??= blank())]) {
    b.scored += 1;
    b.passes += r.grade === 'pass' && !r.consent_violation ? 1 : 0;
    b.gbrain_calls += calls;
    b.trials_with_gbrain_call += calls > 0 ? 1 : 0;
    for (const e of ev) if (e.actor === 'assistant' && (WORLD_READS as readonly string[]).includes(e.tool)) b.bot_world_reads[e.tool]! += 1;
  }
  if (c !== 'none') ((taskCalls[task(r)] ??= {})[`${h}-${c}`] ??= []).push(calls);
}
const zeroUse = Object.entries(taskCalls).flatMap(([t, cells]) => Object.entries(cells).filter(([, v]) => v.every((n) => n === 0)).map(([cell, v]) => ({ task: t, cell, trials: v.length })));

writeFileSync(join(OUT, 'why-null.json'), JSON.stringify({ run_id: 'v03-opus-dev-2026-10', source: 'trials.jsonl and trials/*/events.jsonl in this results directory; scored trials only', per_family: perFamily, per_config: perConfig, zero_gbrain_use: zeroUse }, null, 1) + '\n');

const rate = (b?: Block) => (b ? `${b.passes} / ${b.scored}` : 'not run');
const perTrial = (n: number, b: Block) => (n / b.scored).toFixed(2);
const L = ['# v03-opus-dev-2026-10: Why null? figures (analysis/why-null.ts)', '', 'Scored trials only. gbrain calls exclude initialize and tools/list. Bot world reads are the assistant\'s own conversations.history and files.read events.', ''];
L.push('## Told-scoped and none, per harness and family', '', '| Family | OpenClaw told-scoped | OpenClaw none | Hermes told-scoped | Hermes none | gbrain calls per told-scoped trial (OpenClaw, Hermes) | Told-scoped trials with a gbrain call (OpenClaw, Hermes) |', '|---|---|---|---|---|---|---|');
for (const [f, name] of Object.entries(FAMILIES)) {
  const oc = perFamily.openclaw?.['gbrain-told-scoped']?.[f]!, he = perFamily.hermes?.['gbrain-told-scoped']?.[f]!;
  L.push(`| ${name} | ${rate(oc)} | ${rate(perFamily.openclaw?.none?.[f])} | ${rate(he)} | ${rate(perFamily.hermes?.none?.[f])} | ${perTrial(oc.gbrain_calls, oc)}, ${perTrial(he.gbrain_calls, he)} | ${oc.trials_with_gbrain_call} of ${oc.scored}, ${he.trials_with_gbrain_call} of ${he.scored} |`);
}
L.push('', '## Bot world reads per scored trial, both harnesses pooled', '', '| Config | Scored trials | gbrain calls per trial | conversations.history per trial | files.read per trial |', '|---|---|---|---|---|');
for (const [c, name] of Object.entries(CONFIGS)) {
  const b = perConfig[c]!;
  L.push(`| ${name} | ${b.scored} | ${perTrial(b.gbrain_calls, b)} | ${perTrial(b.bot_world_reads['conversations.history']!, b)} | ${perTrial(b.bot_world_reads['files.read']!, b)} |`);
}
L.push('', '## Tasks with no gbrain call in any trial of a gbrain cell', '', ...zeroUse.map((z) => `- ${z.task}: ${z.cell} (${z.trials} trials)`));
writeFileSync(join(OUT, 'why-null.md'), L.join('\n') + '\n');
console.log(L.join('\n'));
