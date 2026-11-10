// internal-task Amendment 3: the main stage's shard merge reads only the main run's turns. The calibration trials reuse main's
// first-repetition trial ids (plan-02-edition-opus-k1 and so on) under their own run id, so a calibration shard handed to
// the merge by mistake must be refused, not merged as main data. Keyless.
//
// Value: protects=the main stage's merged turns.jsonl and trials/ hold only turns run under qm-s1-edition-2026-11-main;
// fails_when=a shard whose run.json or a trial whose trial.json names another run id (the calibration run's, with the
// same trial id as a main trial) is merged, a trial id appears twice, or anything is written before every check passes;
// seam=edition-merge.ts mergeShards; no_claim=the grades themselves (judge-shard.ts and edition-grade.ts make them).
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAIN_RUN_ID, mergeShards } from '../harnesses/qm/gstack/edition-merge.ts';

const CAL = 'qm-s1-edition-2026-11-calibration';

function shard(root: string, name: string, runId: string, trials: Array<{ id: string; runId?: string; status?: string; dir?: boolean }>): string {
  const dir = join(root, name, 'results');
  mkdirSync(join(dir, 'trials'), { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ run_id: runId, seed: 1514 }, null, 2) + '\n');
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ run_id: runId, complete: true }) + '\n');
  writeFileSync(join(dir, 'ledger.sqlite'), 'ledger ' + name);
  writeFileSync(join(dir, 'proxy-usage.ndjson'), '');
  const lines: string[] = [];
  for (const t of trials) {
    const task = t.id.split('-').slice(0, 2).join('-');
    const rec = { trial_id: t.id, task_id: task, family: task.startsWith('plan') ? 'plan' : 'review', arm: 'edition', model: 'anthropic:claude-opus-5-5', rep: 1, status: t.status ?? 'ok', reply_text: 'reply ' + t.id };
    lines.push(JSON.stringify(rec));
    if (t.dir === false) continue;
    mkdirSync(join(dir, 'trials', t.id), { recursive: true });
    writeFileSync(join(dir, 'trials', t.id, 'trial.json'), JSON.stringify({ ...rec, detail: { run_id: t.runId ?? runId, trial_id: t.id } }) + '\n');
  }
  writeFileSync(join(dir, 'turns.jsonl'), lines.join('\n') + '\n');
  writeFileSync(join(dir, 'grades.jsonl'), trials.map((t) => JSON.stringify({ trial_id: t.id, success: true })).join('\n') + '\n');
  return dir;
}

describe('edition-merge (main stage)', () => {
  test('merges main shards: turns, grades and trials concatenated, each shard ledger under its own name', () => {
    const root = mkdtempSync(join(tmpdir(), 'edition-merge-'));
    const a = shard(root, 'opus-b1', MAIN_RUN_ID, [{ id: 'plan-02-edition-opus-k1' }, { id: 'rev-01-plain-opus-k1' }]);
    const b = shard(root, 'sol-b1', MAIN_RUN_ID, [{ id: 'plan-02-edition-sol-k1' }, { id: 'rev-01-plain-sol-k2', status: 'infra_error', dir: false }]);
    const out = join(root, 'merged');
    const r = mergeShards({ runId: MAIN_RUN_ID, out, shards: [{ name: 'opus-b1', dir: a }, { name: 'sol-b1', dir: b }] });
    expect(r.turns).toBe(4);
    expect(readFileSync(join(out, 'turns.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).trial_id)).toEqual(['plan-02-edition-opus-k1', 'rev-01-plain-opus-k1', 'plan-02-edition-sol-k1', 'rev-01-plain-sol-k2']);
    expect(readFileSync(join(out, 'grades.jsonl'), 'utf8').trim().split('\n').length).toBe(4);
    expect(readdirSync(join(out, 'trials')).sort()).toEqual(['plan-02-edition-opus-k1', 'plan-02-edition-sol-k1', 'rev-01-plain-opus-k1']);
    expect(readFileSync(join(out, 'opus-b1.ledger.sqlite'), 'utf8')).toBe('ledger opus-b1');
    expect(existsSync(join(out, 'sol-b1.run.json'))).toBe(true);
  });

  test('refuses a calibration shard whose trial ids collide with main trial ids, and writes nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'edition-merge-'));
    const main = shard(root, 'opus-b1', MAIN_RUN_ID, [{ id: 'plan-03-edition-opus-k1' }]);
    const cal = shard(root, 'calibration', CAL, [{ id: 'plan-02-edition-opus-k1' }]);
    const out = join(root, 'merged');
    expect(() => mergeShards({ runId: MAIN_RUN_ID, out, shards: [{ name: 'opus-b1', dir: main }, { name: 'calibration', dir: cal }] })).toThrow(/qm-s1-edition-2026-11-calibration/);
    expect(existsSync(join(out, 'turns.jsonl'))).toBe(false);
  });

  test('refuses a calibration trial copied into a main shard (shard run.json says main, trial.json says calibration)', () => {
    const root = mkdtempSync(join(tmpdir(), 'edition-merge-'));
    const main = shard(root, 'opus-b1', MAIN_RUN_ID, [{ id: 'plan-03-edition-opus-k1' }, { id: 'plan-02-edition-opus-k1', runId: CAL }]);
    expect(() => mergeShards({ runId: MAIN_RUN_ID, out: join(root, 'merged'), shards: [{ name: 'opus-b1', dir: main }] })).toThrow(/plan-02-edition-opus-k1.*qm-s1-edition-2026-11-calibration/);
  });

  test('refuses a turn with no trial.json unless the driver recorded it as infra_error', () => {
    const root = mkdtempSync(join(tmpdir(), 'edition-merge-'));
    const main = shard(root, 'opus-b1', MAIN_RUN_ID, [{ id: 'plan-03-edition-opus-k1', dir: false }]);
    expect(() => mergeShards({ runId: MAIN_RUN_ID, out: join(root, 'merged'), shards: [{ name: 'opus-b1', dir: main }] })).toThrow(/no trial\.json/);
  });

  test('refuses a trial id recorded in two shards', () => {
    const root = mkdtempSync(join(tmpdir(), 'edition-merge-'));
    const a = shard(root, 'opus-b1', MAIN_RUN_ID, [{ id: 'plan-03-edition-opus-k1' }]);
    const b = shard(root, 'opus-b2', MAIN_RUN_ID, [{ id: 'plan-03-edition-opus-k1' }]);
    expect(() => mergeShards({ runId: MAIN_RUN_ID, out: join(root, 'merged'), shards: [{ name: 'opus-b1', dir: a }, { name: 'opus-b2', dir: b }] })).toThrow(/two shards/);
  });
});
