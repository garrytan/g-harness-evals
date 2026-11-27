// The C2 standing-rules eval's prereg.json (docs/benchmarks/2026-12-c2-standing-rules/PREREGISTRATION.md) and its pilot's: the six
// correction cells (two directions by the rules, control and remember arms) on the 70 counted items, and the coding check (rules.session_start on and off,
// each harness) on the time-to-first-wow eval's 15 coding seeds, all on one gbrain build. The pilot runs items 101 to 103 and two
// coding seeds outside the counted ones (pilot 2; pilot 1, at commit 8ee17e3b, ran the floor arm in place of the control arm). Cells run in the runner's interleave-task order (seed 3827).
// usage: bun scripts/c2-standing-rules/prereg.ts --gbrain-commit <40 hex> --gbrain-version <v> [--pilot] [--claude-code-advertise-starter] [--out <file>]
import { writeFileSync } from 'node:fs';
import { taskForSeed } from '../../runner/trial/first-wow-cell.ts';
import { COUNTED_CODING_SEEDS } from '../gbrain-first-wow/coding.ts';
import { COUNTED_ITEMS, PILOT_ITEMS } from './items.ts';

export const RUN_ID = 'c2-standing-rules-2026-12';
export const PILOT_RUN_ID = 'c2-standing-rules-pilot-2';
/** Paid model calls (PREREGISTRATION.md, Money): the counted run's cap, and pilot 2's. With the pilots' $11.42 spent they stay inside the
 *  plan's $160 for paid calls. */
export const SPEND_CAP_USD = 148;
export const PILOT_CAP_USD = 12;
export const ORDER_SEED = 3827;
/** Pilot coding seeds: coding-12 and coding-14 (seed mod 15), outside the counted seeds 200 to 214. */
export const PILOT_CODING_SEEDS: readonly number[] = [101, 103];
/** Two sessions per correction trial, so twice the time-to-first-wow eval's per-trial ceiling. */
const CEILING = { input_tokens: 800000, output_tokens: 40000 };
const CODING_CEILING = { input_tokens: 400000, output_tokens: 20000 };
export const HARNESSES = [
  { harness: 'claude-code', short: 'cc', model: 'anthropic:claude-opus-5-5' },
  { harness: 'codex', short: 'codex', model: 'openai:gpt-6.2-sol' },
] as const;

export function c2Prereg(o: { commit: string; version: string; pilot?: boolean; claudeCodeAdvertise?: 'starter' }) {
  if (!/^[0-9a-f]{40}$/.test(o.commit)) throw new Error('--gbrain-commit must be 40 hex characters');
  if (!/^\d+(\.\d+){2,3}$/.test(o.version)) throw new Error('--gbrain-version must be a package version such as 0.60.778.0');
  const build = { gbrain_commit: o.commit, gbrain_version: o.version, suggestion_switch: true };
  const items = (o.pilot ? PILOT_ITEMS : COUNTED_ITEMS).map(taskForSeed);
  const coding = (o.pilot ? PILOT_CODING_SEEDS : COUNTED_CODING_SEEDS).map(taskForSeed);
  const arms = ['rules', 'control', 'remember'];
  const cells: Record<string, unknown>[] = [];
  for (const [a, b] of [[HARNESSES[0], HARNESSES[1]], [HARNESSES[1], HARNESSES[0]]] as const)
    for (const arm of arms)
      cells.push({ id: `${a.short}-${b.short}-${arm}`, harness: a.harness, model: a.model, utility_models: [b.model], slice: 'gbrain-first-wow', split: 'dev', repetitions: 1,
        ceiling: CEILING, network: 'internal', tasks: items, first_wow: { arm: `c2-${arm}`, ...build, task: 'correction', ...(o.claudeCodeAdvertise ? { claude_code_advertise: o.claudeCodeAdvertise } : {}) } });
  for (const h of HARNESSES)
    for (const state of ['on', 'off'])
      cells.push({ id: `${h.short}-coding-rules-${state}`, harness: h.harness, model: h.model, slice: 'gbrain-first-wow', split: 'dev', repetitions: 1,
        ceiling: CODING_CEILING, network: 'internal', tasks: coding, first_wow: { arm: 'defaults', ...build, task: 'coding', standing_rules: state } });
  const ids = cells.map((c) => c.id as string);
  return {
    schema_version: 1, run_id: o.pilot ? PILOT_RUN_ID : RUN_ID,
    question: o.pilot
      ? `UNCOUNTED pilot of the C2 standing-rules eval (docs/benchmarks/2026-12-c2-standing-rules/PREREGISTRATION.md, Pilot) on gbrain ${o.commit.slice(0, 8)} (${o.version}): does each arm's part run (the rules arm saves with correct, is approved and the section reaches session 2; the control arm saves with correct, is approved and the section stays out of session 2; the remember arm saves with remember), and can the probes and the coding check be supplied and scored? Items 101 to 103 in the rules, control and remember arms both ways, and coding seeds 101 and 103 with rules.session_start on and off. Publishes no verdict.`
      : `The C2 standing-rules eval's counted run (docs/benchmarks/2026-12-c2-standing-rules/PREREGISTRATION.md) on gbrain ${o.commit.slice(0, 8)} (${o.version}): when a user corrects their agent in one harness, does loading an approved standing rule at session start (rules.session_start on) make a fresh session in the other harness apply the correction more often than the same approved rule with the switch off (primary), how does it compare with plain remember (secondary, descriptive), and does the section cost the coding check any solved tasks?`,
    tasks: {}, wall_clock_s: { 'gbrain-first-wow': 1800 }, spend_cap_usd: o.pilot ? PILOT_CAP_USD : SPEND_CAP_USD,
    drop_order: [], minimum_v01: ids,
    order: { kind: 'interleave-task', seed: ORDER_SEED },
    cells,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const p = c2Prereg({ commit: opt('--gbrain-commit') ?? '', version: opt('--gbrain-version') ?? '', pilot: args.includes('--pilot'), ...(args.includes('--claude-code-advertise-starter') ? { claudeCodeAdvertise: 'starter' as const } : {}) });
  const text = JSON.stringify(p, null, 2) + '\n';
  if (opt('--out')) writeFileSync(opt('--out')!, text); else process.stdout.write(text);
}
