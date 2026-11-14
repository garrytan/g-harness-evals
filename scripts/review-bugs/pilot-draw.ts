#!/usr/bin/env bun
// The pre-freeze plain pilot's unit draw (plan internal-task, pre-freeze pilot). Not counted.
//
//   bun scripts/review-bugs/pilot-draw.ts --suite <suite.json> --seed 2665 --take S1=3,S2=11,S3=1 [--out <file>]
//
// It takes the suite's ranked non-gstack units (groups S1, S2-* and S3; home-field H and decoy N units are left out),
// puts each in its stratum (every S2-* group is S2), and within each stratum orders units by sha256("<seed>:<unit id>")
// and keeps the first n. The order depends only on the seed and the ids, so anyone can redo the draw by hand.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export interface DrawUnit { id: string; group: string }

export const stratumOf = (group: string): string | null => (group === 'S1' || group === 'S3' ? group : group.startsWith('S2') ? 'S2' : null);

export function drawUnits(units: readonly DrawUnit[], seed: number, take: Readonly<Record<string, number>>): Record<string, string[]> {
  const key = (id: string) => createHash('sha256').update(seed + ':' + id).digest('hex');
  const out: Record<string, string[]> = {};
  for (const [stratum, n] of Object.entries(take)) {
    const pool = units.filter((u) => stratumOf(u.group) === stratum).map((u) => u.id);
    if (pool.length < n) throw new Error('stratum ' + stratum + ' has ' + pool.length + ' units, fewer than ' + n);
    out[stratum] = pool.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)).slice(0, n);
  }
  return out;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const val = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] ?? null : null; };
  const suitePath = val('--suite'), seed = Number(val('--seed')), takeArg = val('--take');
  if (!suitePath || !Number.isInteger(seed) || !takeArg) { process.stderr.write('usage: see the header of scripts/review-bugs/pilot-draw.ts\n'); process.exit(2); }
  const take = Object.fromEntries(takeArg.split(',').map((p) => { const [s, n] = p.split('='); return [s!, Number(n)]; }));
  const text = readFileSync(suitePath, 'utf8');
  const suite = JSON.parse(text) as { id: string; units: DrawUnit[] };
  const drawn = drawUnits(suite.units, seed, take);
  const result = { suite: suite.id, suite_sha256: createHash('sha256').update(text).digest('hex'), seed, take, method: 'within each stratum, ascending sha256("<seed>:<unit id>")', units: drawn };
  const json = JSON.stringify(result, null, 1) + '\n';
  if (val('--out')) writeFileSync(val('--out')!, json);
  process.stdout.write(json);
}
