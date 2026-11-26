#!/usr/bin/env bun
// Amendment 7 of frontier-shootout-2026-11: a shard's --timeout-hours and UBI_TTL_HOURS from its canary's measured pace.
//
//   bun scripts/frontier-harbor/shard-hours.ts --shard <name> --trials <n> --minutes-per-trial <m> --startup-minutes <s>
//       --canary <where the measurement came from> [--concurrency 4] [--log <dest>/lane.log]
//
// timeout hours = ceil(1.25 * (trials * minutes per trial / concurrency / 60 + startup minutes / 60)); TTL = timeout + 1.
// Prints one SHARD_HOURS line with the inputs, the canary and the two values, and with --log appends it to that file
// (the shard's lane.log, before run-shard.sh starts). run-shard.sh takes --timeout-hours from 1 to 998 and any
// UBI_TTL_HOURS above it, so the values need no other change.
import { appendFileSync } from 'node:fs';

export function shardHours(o: { trials: number; minutesPerTrial: number; startupMinutes: number; concurrency?: number }) {
  const concurrency = o.concurrency ?? 4;
  if (![o.trials, o.minutesPerTrial, concurrency].every((x) => Number.isFinite(x) && x > 0) || !(Number.isFinite(o.startupMinutes) && o.startupMinutes >= 0)) throw new Error('trials, minutes per trial and concurrency must be positive numbers, startup minutes zero or more');
  const hours = o.trials * o.minutesPerTrial / concurrency / 60 + o.startupMinutes / 60;
  const timeout = Math.ceil(+(hours * 1.25).toFixed(9));
  return { expected_hours: +hours.toFixed(3), timeout_hours: timeout, ttl_hours: timeout + 1, concurrency };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const need = (n: string) => flag(n) ?? (console.error('shard-hours: needs ' + n), process.exit(2));
  try {
    const shard = need('--shard'), canary = need('--canary');
    const input = { trials: Number(need('--trials')), minutesPerTrial: Number(need('--minutes-per-trial')), startupMinutes: Number(need('--startup-minutes')), concurrency: Number(flag('--concurrency') ?? 4) };
    const h = shardHours(input);
    const line = new Date().toISOString() + ' SHARD_HOURS: shard=' + shard + ' canary=' + JSON.stringify(canary) + ' trials=' + input.trials + ' minutes_per_trial=' + input.minutesPerTrial + ' startup_minutes=' + input.startupMinutes + ' concurrency=' + h.concurrency + ' expected_hours=' + h.expected_hours + ' timeout_hours=' + h.timeout_hours + ' UBI_TTL_HOURS=' + h.ttl_hours + ' (amendment 7)';
    const log = flag('--log');
    if (log) appendFileSync(log, line + '\n');
    console.log(line);
  } catch (e) { console.error('shard-hours: ' + (e as Error).message); process.exit(2); }
}
