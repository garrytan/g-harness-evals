#!/usr/bin/env bun
// internal-task Amendment 3: merge the QM edition eval's main-stage (or forced-stage) shards into one results directory.
//
//   bun harnesses/qm/gstack/edition-merge.ts --run-id <run id> --out <empty dir> --shard <name>=<shard results dir> [...]
//
// What it builds, in --shard order:
//   turns.jsonl, grades.jsonl, grades-secondary.jsonl   each shard's file concatenated (a grades file present in one shard
//                                                       must be present in every shard)
//   trials/                                             each shard's trial directories
//   <name>.ledger.sqlite, <name>.proxy-usage.ndjson, <name>.proxy.log, <name>.run.json, <name>.summary.json,
//   <name>.preflight.json, <name>.tasks-gen.json, <name>.judge-shard.json   each shard's own files under its name
//
// It refuses (exit 2, naming the offender) and writes nothing when a shard's run.json names another run id, a turn's
// trials/<id>/trial.json names another run id (detail.run_id), a turn has no trial.json and is not the driver's infra_error
// record, a trial id is in two shards or twice in one, or --out already holds turns.jsonl. The calibration trials
// (qm-s1-edition-2026-11-calibration) reuse main's first-repetition trial ids, so this is what keeps them out of main.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const MAIN_RUN_ID = 'qm-s1-edition-2026-11-main';
export const FORCED_RUN_ID = 'qm-s1-edition-2026-11-forced';
const OWN_FILES = ['ledger.sqlite', 'proxy-usage.ndjson', 'proxy.log', 'run.json', 'summary.json', 'preflight.json', 'tasks-gen.json', 'judge-shard.json'];
const GRADE_FILES = ['grades.jsonl', 'grades-secondary.jsonl'];

export class MergeError extends Error {}
export interface Shard { name: string; dir: string }
const lines = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());

export function mergeShards(o: { runId: string; out: string; shards: Shard[] }): { turns: number } {
  if (!o.shards.length) throw new MergeError('no --shard given');
  if (existsSync(join(o.out, 'turns.jsonl'))) throw new MergeError(o.out + ' already holds turns.jsonl; merge into an empty directory');
  const seen = new Map<string, string>();
  const turns: string[] = [];
  const grades: Record<string, string[]> = Object.fromEntries(GRADE_FILES.map((f) => [f, []]));
  const gradesIn = GRADE_FILES.map((f) => o.shards.filter((s) => existsSync(join(s.dir, f))).length);
  GRADE_FILES.forEach((f, i) => { if (gradesIn[i]! > 0 && gradesIn[i]! < o.shards.length) throw new MergeError(f + ' is in ' + gradesIn[i] + ' of ' + o.shards.length + ' shards; every shard must have it or none'); });
  for (const s of o.shards) {
    for (const f of ['run.json', 'turns.jsonl']) if (!existsSync(join(s.dir, f))) throw new MergeError('shard ' + s.name + ': ' + join(s.dir, f) + ' is missing');
    const shardRun = (JSON.parse(readFileSync(join(s.dir, 'run.json'), 'utf8')) as { run_id?: string }).run_id;
    if (shardRun !== o.runId) throw new MergeError('shard ' + s.name + ' ran under run id ' + shardRun + ', not ' + o.runId + '; only ' + o.runId + "'s shards merge here");
    for (const line of lines(join(s.dir, 'turns.jsonl'))) {
      const t = JSON.parse(line) as { trial_id: string; status: string };
      const trialFile = join(s.dir, 'trials', t.trial_id, 'trial.json');
      if (!existsSync(trialFile)) {
        if (t.status !== 'infra_error') throw new MergeError('shard ' + s.name + ': trial ' + t.trial_id + ' has no trial.json, so its run id cannot be checked');
      } else {
        const trialRun = (JSON.parse(readFileSync(trialFile, 'utf8')) as { detail?: { run_id?: string } }).detail?.run_id;
        if (trialRun !== o.runId) throw new MergeError('shard ' + s.name + ': trial ' + t.trial_id + ' ran under run id ' + trialRun + ', not ' + o.runId);
      }
      const prior = seen.get(t.trial_id);
      if (prior !== undefined) throw new MergeError('trial ' + t.trial_id + ' is recorded ' + (prior === s.name ? 'twice in shard ' + s.name : 'in two shards, ' + prior + ' and ' + s.name));
      seen.set(t.trial_id, s.name);
      turns.push(line);
    }
    GRADE_FILES.forEach((f, i) => { if (gradesIn[i]) grades[f]!.push(...lines(join(s.dir, f))); });
  }
  mkdirSync(join(o.out, 'trials'), { recursive: true });
  writeFileSync(join(o.out, 'turns.jsonl'), turns.join('\n') + '\n');
  GRADE_FILES.forEach((f, i) => { if (gradesIn[i]) writeFileSync(join(o.out, f), grades[f]!.join('\n') + (grades[f]!.length ? '\n' : '')); });
  for (const s of o.shards) {
    for (const id of existsSync(join(s.dir, 'trials')) ? readdirSync(join(s.dir, 'trials')) : []) cpSync(join(s.dir, 'trials', id), join(o.out, 'trials', id), { recursive: true, errorOnExist: true, force: false });
    for (const f of OWN_FILES) if (existsSync(join(s.dir, f))) copyFileSync(join(s.dir, f), join(o.out, s.name + '.' + f));
  }
  return { turns: turns.length };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const shards = args.flatMap((a, i) => (args[i - 1] === '--shard' ? [a] : [])).map((v) => { const at = v.indexOf('='); return { name: v.slice(0, at), dir: resolve(v.slice(at + 1)) }; });
  const runId = flag('--run-id'), out = flag('--out');
  if (!runId || !out || !shards.length || shards.some((s) => !s.name || !/^[A-Za-z0-9._-]+$/.test(s.name))) { console.error('usage: bun harnesses/qm/gstack/edition-merge.ts --run-id <run id> --out <empty dir> --shard <name>=<shard results dir> [...]'); process.exit(2); }
  try {
    const r = mergeShards({ runId, out: resolve(out), shards });
    console.log('edition-merge: ' + r.turns + ' turns from ' + shards.length + ' shards of ' + runId + ' written to ' + out);
  } catch (e) {
    if (!(e instanceof MergeError)) throw e;
    console.error('edition-merge: refused: ' + e.message);
    process.exit(2);
  }
}
