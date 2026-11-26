// The counted run's prereg.json for the gbrain time-to-first-wow eval (PREREGISTRATION.md): every cell of design.json on one gbrain
// build, the verdict seeds 0 to 99 and the no-history seeds 9000 to 9009 in each question cell, and the coding check on seeds 200
// to 214. Trials run in the runner's interleave-task order (seed 1125): seed by seed in one seeded order, each seed's cells interleaved,
// and a shard that runs some of the cells keeps that order, so the interim look reads the first 50 verdict seeds of it.
// usage: bun scripts/gbrain-first-wow/prereg.ts --gbrain-commit <40 hex> --gbrain-version <v> [--out <file>]
import { writeFileSync } from 'node:fs';
import { COUNTED_CODING_SEEDS } from './coding.ts';
import { taskForSeed } from '../../runner/trial/first-wow-cell.ts';
import { mddFromDiscordance } from './verdict.ts';

export const RUN_ID = 'gbrain-first-wow-2026-12';
export const SPEND_CAP_USD = 700;
export const VERDICT_SEEDS = Array.from({ length: 100 }, (_, i) => i);
export const ORDER_SEED = 1125;
/** The interim look's 50 units: the first 50 verdict seeds of the manifest's trial order (tests/gbrain-first-wow.test.ts checks it). */
export const INTERIM_SEEDS: readonly number[] = [0, 3, 4, 6, 9, 14, 15, 17, 18, 20, 21, 24, 25, 28, 29, 31, 33, 34, 42, 43, 45, 47, 48, 49, 50, 51, 53, 54, 60, 61, 62, 63, 65, 67, 69, 70, 71, 72, 73, 75, 78, 79, 83, 87, 88, 91, 93, 96, 97, 99];
/** Pilot pairs and discordant pairs on each harness's primary contrast (PREREGISTRATION.md, Freeze): pilot 1's record run, pilot 2 and its messy
 *  run; for Codex, pilot 3's full arm (the first build whose section reaches Codex) against pilots 2's defaults on the same seeds. */
export const PILOT_DISCORDANCE: Record<string, { pairs: number; discordant: number }> = {
  'claude-code/claude-opus-5-5': { pairs: 8, discordant: 7 },
  'codex/gpt-6.2-sol': { pairs: 5, discordant: 2 },
  'qm/claude-opus-5-5': { pairs: 5, discordant: 2 },
  'qm/gpt-6.2-sol': { pairs: 5, discordant: 0 },
  'qm/particle-1': { pairs: 5, discordant: 2 },
};
/** The stated difference per harness: the smallest detectable difference at 100 pairs from the pilot discordance, rounded to a point, never below 20 points. */
export const STATED_DIFFERENCE: Record<string, number> = Object.fromEntries(Object.entries(PILOT_DISCORDANCE).map(([h, p]) =>
  [h, Math.max(0.2, Math.round(mddFromDiscordance(p.discordant / p.pairs, VERDICT_SEEDS.length) * 100) / 100)]));
const NO_HISTORY_SEEDS = Array.from({ length: 10 }, (_, i) => 9000 + i);
const CEILING = { input_tokens: 400000, output_tokens: 20000 };
const QM_UTILITY: Record<string, string[]> = {
  'anthropic:claude-opus-5-5': ['anthropic:claude-sonnet-5-5', 'anthropic:claude-haiku-5-5'],
  'openai:gpt-6.2-sol': ['openai:gpt-5.6-luna'],
};

export function countedPrereg(o: { commit: string; version: string }) {
  if (!/^[0-9a-f]{40}$/.test(o.commit)) throw new Error('--gbrain-commit must be 40 hex characters');
  const questions = [...VERDICT_SEEDS, ...NO_HISTORY_SEEDS].map(taskForSeed);
  const coding = COUNTED_CODING_SEEDS.map(taskForSeed);
  const build = { gbrain_commit: o.commit, gbrain_version: o.version };
  const cells: Record<string, unknown>[] = [];
  const harnessCell = (id: string, harness: string, model: string, arm: string, extra: Record<string, unknown> = {}, tasks = questions) =>
    cells.push({ id, harness, model, slice: 'gbrain-first-wow', split: 'dev', repetitions: 1, ceiling: CEILING, network: 'internal', tasks,
      first_wow: arm === 'plain' ? { arm } : { arm, ...build, suggestion_switch: true, ...extra } });
  for (const [h, prefix, model] of [['claude-code', 'cc-opus', 'anthropic:claude-opus-5-5'], ['codex', 'codex-sol', 'openai:gpt-6.2-sol']] as const) {
    for (const arm of ['defaults', 'pr1', 'full', 'plain']) harnessCell(`${prefix}-${arm}`, h, model, arm);
    for (const arm of ['defaults', 'full']) harnessCell(`${prefix}-${arm}-coding`, h, model, arm, { task: 'coding' }, coding);
  }
  for (const [name, model] of [['opus', 'anthropic:claude-opus-5-5'], ['sol', 'openai:gpt-6.2-sol'], ['particle', 'particle:particle-1']] as const)
    for (const arm of ['qm-native', 'plain'])
      cells.push({ id: `qm-${name}-${arm === 'plain' ? 'plain' : 'native'}`, harness: 'qm', model, slice: 'gbrain-first-wow', split: 'dev', repetitions: 1, ceiling: CEILING,
        ...(QM_UTILITY[model] ? { utility_models: QM_UTILITY[model] } : {}), tasks: questions,
        first_wow: arm === 'plain' ? { arm } : { arm, ...build, provider_read: 'query' } });
  const ids = cells.map((c) => c.id as string);
  return {
    schema_version: 1, run_id: RUN_ID,
    question: `The gbrain time-to-first-wow eval's counted run (docs/benchmarks/2026-11-24-gbrain-first-wow/PREREGISTRATION.md) on gbrain ${o.commit.slice(0, 8)} (${o.version}): per harness, does setup's history import (pr1) and the first-session suggestion (full) get a new user to a correct, cited answer from their own history more often than today's defaults, and does a plain agent with the same files do as well?`,
    tasks: {}, wall_clock_s: { 'gbrain-first-wow': 900 }, spend_cap_usd: SPEND_CAP_USD,
    drop_order: ids.filter((id) => id.startsWith('qm-particle')),
    minimum_v01: ids.filter((id) => /-(defaults|full)$/.test(id)),
    order: { kind: 'interleave-task', seed: ORDER_SEED },
    cells,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const p = countedPrereg({ commit: opt('--gbrain-commit') ?? '', version: opt('--gbrain-version') ?? '' });
  const text = JSON.stringify(p, null, 2) + '\n';
  if (opt('--out')) writeFileSync(opt('--out')!, text); else process.stdout.write(text);
}
