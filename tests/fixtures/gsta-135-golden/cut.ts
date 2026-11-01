#!/usr/bin/env bun
// Cuts the golden fixtures for tests/gsta-135-golden.test.ts from internal-task's
// published internal-task panel receipts (the Captain drive's
// handoffs/internal-task/gsta-135/{panel-run,panel-run-3610}/: cells.jsonl and
// evidence/<trial>.txt). For each panel it writes <run>.jsonl, one line per
// cells.jsonl row in file order: the row's identity, its published evidence
// object verbatim, the sha256 of the cells.jsonl line and of the excerpt file,
// and the excerpt's tool-call and tool-result lines (the only lines the
// re-classification reads). sources.json records each source file's sha256
// and size. README.md says what the golden covers.
//
//   bun tests/fixtures/gsta-135-golden/cut.ts <dir holding panel-run and panel-run-3610>
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const RUNS = ['panel-run', 'panel-run-3610'] as const;
export const CALL_LINE = /^(?:session \w+ seq \d+ (?:toolCall|toolResult) |id \d+ (?:tool_call |tool result \())/;
const sha = (b: string) => createHash('sha256').update(b).digest('hex');

if (import.meta.main) {
  const src = process.argv[2];
  if (!src) { console.error('usage: cut.ts <dir holding panel-run and panel-run-3610>'); process.exit(64); }
  const sources: Record<string, unknown> = {};
  for (const run of RUNS) {
    const cellsPath = join(src, run, 'cells.jsonl');
    const cellsText = readFileSync(cellsPath, 'utf8');
    const lines = cellsText.split('\n').filter(Boolean);
    if (readdirSync(join(src, run, 'evidence')).length !== lines.length) throw new Error(run + ': evidence/ does not hold one excerpt per cells.jsonl row');
    const excerpts: Record<string, { sha256: string; bytes: number }> = {};
    const out = lines.map(line => {
      const row = JSON.parse(line);
      const txt = join(src, run, 'evidence', row.trial_id + '.txt');
      const excerpt = readFileSync(txt, 'utf8');
      excerpts[row.trial_id] = { sha256: sha(excerpt), bytes: statSync(txt).size };
      return JSON.stringify({ trial_id: row.trial_id, harness: row.harness, task: row.task, arm: row.arm, termination: row.termination, cells_line_sha256: sha(line), excerpt_sha256: excerpts[row.trial_id].sha256,
        evidence: row.evidence, calls: excerpt.split('\n').filter(l => CALL_LINE.test(l)) });
    });
    writeFileSync(join(import.meta.dir, run + '.jsonl'), out.join('\n') + '\n');
    sources[run] = { cells_jsonl: { path: 'handoffs/internal-task/gsta-135/' + run + '/cells.jsonl', sha256: sha(cellsText), bytes: statSync(cellsPath).size, rows: lines.length }, excerpts };
  }
  writeFileSync(join(import.meta.dir, 'sources.json'), JSON.stringify(sources, null, 2) + '\n');
}
