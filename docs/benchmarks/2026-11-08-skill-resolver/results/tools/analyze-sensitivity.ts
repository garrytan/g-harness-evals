#!/usr/bin/env bun
// Sensitivity driver for skill-resolver-2026-11. Not the preregistered command: it runs scripts/skill-resolver/analyze.ts's
// own exported loadTrials, loadLabels, readReachable, analyze and markdown, unchanged, with the preregistered CLI's inputs,
// after at most two named changes to the trial list:
//   --drop-trials <file>     leave out the trial ids listed, one per line
//   --uncontaminate <file>   treat the trial ids listed as not contaminated (rule c: a failed open is not a read)
// Usage, from the repository root:
//   bun docs/benchmarks/2026-11-08-skill-resolver/results/tools/analyze-sensitivity.ts --results <dir> --labels P=<f>
//     --cross-family P=<f> --duplicate-groups <prereg.json> --judge-check <f> --reachable <f> --set-t <dir> --out <dir>
//     [--drop-trials <f>] [--uncontaminate <f>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { analyze, loadLabels, loadTrials, markdown, readReachable, type JudgeCheck } from '../../../../../scripts/skill-resolver/analyze.ts';
import { setTTaskIds, loadSetTTask } from '../../../../../runner/trial/set-t.ts';

const argv = process.argv.slice(2);
const all = (n: string) => argv.flatMap((x, i) => (x === '--' + n && argv[i + 1] ? [argv[i + 1]!] : []));
const pairsOf = (n: string) => all(n).map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)] as [string, string]; });
const ids = (f?: string) => new Set(f ? readFileSync(f, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : []);
const drop = ids(all('drop-trials')[0]);
const unc = ids(all('uncontaminate')[0]);
let trials = all('results').flatMap((d) => loadTrials(d));
const before = trials.length;
trials = trials.filter((t) => !drop.has(t.id));
let flipped = 0;
trials = trials.map((t) => (unc.has(t.id) && t.contaminated ? (flipped++, { ...t, contaminated: false }) : t));
const setTDir = all('set-t')[0]!;
const root = resolve(setTDir, '..', '..', '..');
const setT = new Map(setTTaskIds(root).map((id) => { const t = loadSetTTask(join(setTDir, id)); return [id, { bin: t.overlap.bin, body_coverage: t.overlap.body_coverage }]; }));
const groups = (JSON.parse(readFileSync(all('duplicate-groups')[0]!, 'utf8')).request_duplicate_groups ?? []) as string[][];
const a = analyze({ trials, labels: loadLabels(pairsOf('labels'), pairsOf('requests'), groups, pairsOf('cross-family')), reachable: readReachable(all('reachable')[0]!), setT,
  judgeCheck: JSON.parse(readFileSync(all('judge-check')[0]!, 'utf8')) as JudgeCheck });
const out = all('out')[0]!;
mkdirSync(out, { recursive: true });
const note = { driver: 'analyze-sensitivity.ts', trials_loaded: before, dropped: before - trials.length, uncontaminated: flipped };
writeFileSync(join(out, 'analysis.json'), JSON.stringify({ sensitivity: note, ...a }, null, 1) + '\n');
writeFileSync(join(out, 'analysis.md'), '> Sensitivity run, not the preregistered command: ' + JSON.stringify(note) + '\n\n' + markdown(a));
console.log('SENSITIVITY ' + JSON.stringify(note) + ' primary_pairs=' + a.primary.n_pairs + ' delta=' + a.primary.delta);
