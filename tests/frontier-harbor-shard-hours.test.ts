/**
 * Amendment 7 of frontier-shootout-2026-11 (scripts/frontier-harbor/shard-hours.ts): each remaining shard's --timeout-hours
 * and UBI_TTL_HOURS come from its canary's measured minutes per trial and start-up, and the launch line names the canary.
 * Keyless.
 *
 * Value: protects=the shard timeouts after s01 measured about twice the planned pace; fails_when=the formula rounds the
 * wrong way, the TTL is not the timeout plus 1, or the run log line drops an input; no_claim=what a shard will take.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shardHours } from '../scripts/frontier-harbor/shard-hours.ts';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'shard-hours-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('amendment 7: shard timeout and TTL from the canary', () => {
  test('trials x minutes / 4 / 60 plus start-up, times 1.25, rounded up; TTL one hour more', () => {
    expect(shardHours({ trials: 156, minutesPerTrial: 23, startupMinutes: 135 })).toEqual({ expected_hours: 17.2, timeout_hours: 22, ttl_hours: 23, concurrency: 4 });
    expect(shardHours({ trials: 156, minutesPerTrial: 11.8, startupMinutes: 30 })).toMatchObject({ timeout_hours: 11, ttl_hours: 12 });
    expect(shardHours({ trials: 96, minutesPerTrial: 10, startupMinutes: 0 })).toMatchObject({ expected_hours: 4, timeout_hours: 5 });
    expect(() => shardHours({ trials: 0, minutesPerTrial: 10, startupMinutes: 0 })).toThrow();
  });

  test('the launch line records the inputs, the canary and the values, and is appended to the run log', () => {
    const log = join(tmp, 'lane.log');
    const run = spawnSync('bun', ['scripts/frontier-harbor/shard-hours.ts', '--shard', 's07', '--trials', '156', '--minutes-per-trial', '23', '--startup-minutes', '135', '--canary', 's01 canary', '--log', log], { cwd: ROOT, encoding: 'utf8', env: { HOME: process.env.HOME, PATH: process.env.PATH } });
    expect(run.status).toBe(0);
    const line = readFileSync(log, 'utf8');
    for (const s of ['SHARD_HOURS: shard=s07', 'canary="s01 canary"', 'trials=156', 'minutes_per_trial=23', 'startup_minutes=135', 'timeout_hours=22', 'UBI_TTL_HOURS=23']) expect(line).toContain(s);
  });

  test('run-shard.sh accepts every timeout up to 998 hours and keeps a TTL above it', () => {
    const src = readFileSync(join(ROOT, 'scripts/ubicloud/run-shard.sh'), 'utf8');
    expect(src).toContain('[[ "$timeout_h" =~ ^[1-9][0-9]{0,2}$ ]] && [ "$timeout_h" -le 998 ]');
    expect(src).toContain('export UBI_TTL_HOURS=$(( timeout_h + 1 ))');
  });
});
