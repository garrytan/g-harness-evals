#!/usr/bin/env bun
// Clean-arm audit (CREW rule "Clean no-gstack and no-brain arms", 2026-11-02): counts, per cell, the trials whose
// files show a read of a gstack skill or a Capy drive path. A trial with a hit is contaminated and invalid.
// Usage: bun scripts/prompt-archaeology/clean-arm-audit.ts <results dir> [--out <json>]
// Symbolic links are not followed, .gz files are read decompressed, and every file the audit could not read (a link, a
// binary file, one over 64 MB, a .gz that does not decompress) is listed per cell as skipped.
// Exit 0 when no trial has a hit, 1 when any does, 2 on a usage error, 3 when the audit itself failed.
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gunzipSync } from "node:zlib";

export const PATTERNS: Array<[string, RegExp]> = [
  ["gstack-skill-file", /gstack\/SKILL\.md/],
  ["gstack-skills-dir", /skills\/gstack(\/|\b)/],
  ["gstack-install", /\.local\/share\/gstack|\.gstack\//],
  ["capy-drive", /\.capy\/drive/],
];

export interface Hit { trial: string; file: string; pattern: string }
export interface Skipped { trial: string; file: string; reason: string }
export interface CellAudit { cell: string; trials: number; contaminated: number; hits: Hit[]; skipped: Skipped[] }

function files(dir: string, skip: (p: string, reason: string) => void): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isSymbolicLink()) skip(p, "symbolic link");
    else if (st.isDirectory()) out.push(...files(p, skip));
    else if (!st.isFile()) skip(p, "not a regular file");
    else if (st.size > 64 * 1024 * 1024) skip(p, "over 64 MB");
    else out.push(p);
  }
  return out;
}

function trialScan(trialDir: string, trial: string): { hits: Hit[]; skipped: Skipped[] } {
  const hits: Hit[] = [], skipped: Skipped[] = [];
  const skip = (f: string, reason: string) => skipped.push({ trial, file: relative(trialDir, f), reason });
  for (const f of files(trialDir, skip)) {
    let buf = readFileSync(f);
    if (f.endsWith(".gz")) {
      try { buf = gunzipSync(buf); } catch { skip(f, "gzip that does not decompress"); continue; }
    }
    if (buf.subarray(0, 8000).includes(0)) { skip(f, "binary"); continue; }
    const text = buf.toString("utf8");
    for (const [name, re] of PATTERNS) if (re.test(text)) hits.push({ trial, file: relative(trialDir, f), pattern: name });
  }
  return { hits, skipped };
}

export function audit(resultsDir: string): CellAudit[] {
  const trialsRoot = join(resultsDir, "trials");
  if (!existsSync(trialsRoot)) throw new Error("no trials/ directory under " + resultsDir);
  const cells: CellAudit[] = [];
  for (const cell of readdirSync(trialsRoot).sort()) {
    const cellDir = join(trialsRoot, cell);
    if (!statSync(cellDir).isDirectory()) continue;
    const row: CellAudit = { cell, trials: 0, contaminated: 0, hits: [], skipped: [] };
    for (const task of readdirSync(cellDir).sort()) {
      const taskDir = join(cellDir, task);
      if (!statSync(taskDir).isDirectory()) continue;
      for (const rep of readdirSync(taskDir).sort()) {
        const trialDir = join(taskDir, rep);
        if (!statSync(trialDir).isDirectory()) continue;
        row.trials++;
        const { hits, skipped } = trialScan(trialDir, cell + "/" + task + "/" + rep);
        if (hits.length) { row.contaminated++; row.hits.push(...hits); }
        row.skipped.push(...skipped);
      }
    }
    cells.push(row);
  }
  return cells;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const out = outAt >= 0 ? args[outAt + 1] : undefined;
  const dir = args.find((a, i) => !a.startsWith("--") && (outAt < 0 || i !== outAt + 1));
  if (!dir || (outAt >= 0 && !out)) { console.error("usage: clean-arm-audit.ts <results dir> [--out <json>]"); process.exit(2); }
  let cells: CellAudit[];
  try { cells = audit(dir); } catch (e) { console.error("clean-arm audit: failed: " + (e as Error).message); process.exit(3); }
  const total = cells.reduce((n, c) => n + c.contaminated, 0);
  if (out) writeFileSync(out, JSON.stringify({ results: dir, contaminated_trials: total, cells }, null, 2) + "\n");
  for (const c of cells) console.log(c.cell + " trials=" + c.trials + " contaminated=" + c.contaminated + " skipped=" + c.skipped.length);
  console.log("clean-arm audit: " + total + " contaminated trial(s) in " + cells.length + " cell(s)");
  process.exit(total ? 1 : 0);
}
