#!/usr/bin/env bun
/**
 * R126 check of skill-resolver's model labels against construction labels (internal-task, 2026-11-25). Each set P request was
 * written from one target skill (writer_target) or written to need none (kind "none"), so construction gives known
 * positives and known no-skill rows at $0. This writes two relabelled copies of each published label file, which
 * results/tools/analyze-sensitivity.ts then reads in place of the originals. The relabel is applied to the panel's final
 * label and to every judge's label, because with cross-family labels analyze.ts scores Claude cells with judges.astra
 * and GPT cells with judges.opus:
 *   construction  { no_skill_needed: kind == "none", acceptable: [writer_target] }
 *   union         acceptable = the published set plus writer_target; a row written for a skill is never no-skill
 * Construction has no negatives, so false suggestion (b) under it assumes every writer target is acceptable; it is not a bound.
 *
 *   bun scripts/corrections/skill-resolver-construction-labels.ts --out <dir>
 * then see scripts/corrections/check-r126-2026-11-25.sh for the analyze-sensitivity runs.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Label { no_skill_needed?: boolean; acceptable?: string[]; [k: string]: unknown }
interface Row { id: string; final: Label; judges?: Record<string, Label | null>; [k: string]: unknown }
interface SetP { id: string; kind: string; writer_target: string | null }

const RUN = join(import.meta.dir, '..', '..', 'docs', 'benchmarks', '2026-11-08-skill-resolver');
const jsonl = <T>(p: string): T[] => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
const i = process.argv.indexOf('--out');
if (i < 0 || !process.argv[i + 1]) throw new Error('usage: skill-resolver-construction-labels.ts --out <dir>');
const out = process.argv[i + 1]!;
mkdirSync(out, { recursive: true });
const setp = new Map(jsonl<SetP>(join(RUN, 'results/sets/setp.jsonl')).map((r) => [r.id, r]));
const relabel: Record<string, (l: Label, p: SetP) => Label> = {
  construction: (l, p) => ({ ...l, no_skill_needed: p.kind === 'none', acceptable: p.kind === 'none' ? [] : [p.writer_target!] }),
  union: (l, p) => ({ ...l, no_skill_needed: p.kind === 'none' ? l.no_skill_needed : false, acceptable: [...new Set([...(l.acceptable ?? []), ...(p.writer_target ? [p.writer_target] : [])])] }),
};
for (const name of ['labels.jsonl', 'labels-astra.jsonl']) {
  const rows = jsonl<Row>(join(RUN, 'results/sets', name));
  for (const [kind, f] of Object.entries(relabel)) {
    writeFileSync(join(out, kind + '-' + name), rows.map((row) => {
      const p = setp.get(row.id);
      if (!p) throw new Error('no set P row ' + row.id);
      const judges = row.judges ? Object.fromEntries(Object.entries(row.judges).map(([k, l]) => [k, l ? f(l, p) : l])) : row.judges;
      return JSON.stringify({ ...row, judges, final: f(row.final, p) });
    }).join('\n') + '\n');
  }
  const agree = rows.filter((row) => { const p = setp.get(row.id)!; return p.kind === 'none' ? row.final.no_skill_needed : (row.final.acceptable ?? []).includes(p.writer_target!); }).length;
  console.log(name + ': the published final label agrees with construction on ' + agree + ' of ' + rows.length + ' rows');
}
