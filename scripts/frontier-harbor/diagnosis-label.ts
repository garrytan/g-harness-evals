#!/usr/bin/env bun
// The task feature of fable-diagnosis-2026-11: does the task's instruction point at where the fix goes?
//
//   bun scripts/frontier-harbor/diagnosis-label.ts --src <swe-rebench-07-2026 dataset dir> --out <labels.json>
//   bun scripts/frontier-harbor/diagnosis-label.ts --src <dir> --check <labels.json>
//
// For each task directory (instruction.md and solution/solve.sh), the changed files are the "diff --git a/X b/Y" paths of
// the reference patch in solve.sh, less test files and docs (the TEST and DOC patterns below). A changed file is named
// when the instruction contains its repository path, its file name, or its file stem as a whole word (letters, digits and
// underscore are word characters), the stem counting only when it has at least 4 characters and is not one of the generic
// stems in GENERIC. A task is "diagnosis" when the instruction names none of its changed files, and "pointed" when it
// names at least one. The rule reads only the instruction and the reference patch, never a trial, so it is fixed before
// any trial runs. --check recomputes every label and exits 1 on any difference from the file.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const TEST = /(^|\/)(tests?|__tests__|testdata|spec|e2e)(\/|$)|_test\.go$|\.test\.[jt]sx?$|\.spec\.[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$|Tests?\.java$|(^|\/)src\/test\//i;
export const DOC = /\.(md|rst|txt|adoc)$|(^|\/)(CHANGELOG|CHANGES|NEWS|docs?)(\/|\.|$)/i;
export const GENERIC = new Set(['index', 'mod', 'lib', 'main', '__init__', 'utils', 'util', 'types', 'config', 'common', 'core', 'client', 'server', 'api', 'base', 'app', 'cli', 'errors', 'error', 'helpers', 'constants', 'models', 'model', 'schema']);

export interface TaskLabel { label: 'diagnosis' | 'pointed'; changed: string[]; named: string[] }

const escape = (s: string) => s.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');

export function changedFiles(solve: string): string[] {
  const out: string[] = [];
  for (const m of solve.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) if (!TEST.test(m[2]!) && !DOC.test(m[2]!) && !out.includes(m[2]!)) out.push(m[2]!);
  return out;
}

export function isNamed(file: string, instruction: string): boolean {
  const name = basename(file);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  if (instruction.includes(file) || instruction.includes(name)) return true;
  if (stem.length < 4 || GENERIC.has(stem)) return false;
  return new RegExp('(?<![A-Za-z0-9_])' + escape(stem) + '(?![A-Za-z0-9_])').test(instruction);
}

export function labelTask(instruction: string, solve: string): TaskLabel {
  const changed = changedFiles(solve);
  if (!changed.length) throw new Error('the reference patch changes no source file');
  const named = changed.filter((f) => isNamed(f, instruction));
  return { label: named.length ? 'pointed' : 'diagnosis', changed, named };
}

export function labelDir(src: string): Record<string, TaskLabel> {
  const out: Record<string, TaskLabel> = {};
  for (const id of readdirSync(src).sort()) {
    const dir = join(src, id);
    if (!statSync(dir).isDirectory() || !existsSync(join(dir, 'instruction.md'))) continue;
    out[id] = labelTask(readFileSync(join(dir, 'instruction.md'), 'utf8'), readFileSync(join(dir, 'solution', 'solve.sh'), 'utf8'));
  }
  return out;
}

if (import.meta.main) {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const src = arg('--src'), out = arg('--out'), check = arg('--check');
  if (!src || (!out && !check)) { console.error('usage: diagnosis-label.ts --src <dataset dir> (--out <labels.json> | --check <labels.json>)'); process.exit(2); }
  const labels = labelDir(src);
  const counts = { diagnosis: 0, pointed: 0 };
  for (const l of Object.values(labels)) counts[l.label]++;
  const doc = { schema: 'diagnosis-labels/1', rule: 'scripts/frontier-harbor/diagnosis-label.ts', counts, tasks: labels };
  if (out) { writeFileSync(out, JSON.stringify(doc, null, 2) + '\n'); console.log(JSON.stringify(counts)); }
  if (check) {
    const want = JSON.parse(readFileSync(check, 'utf8'));
    const bad = Object.keys({ ...want.tasks, ...labels }).filter((k) => JSON.stringify(want.tasks[k]) !== JSON.stringify(labels[k]));
    if (bad.length) { console.error('labels differ for: ' + bad.join(', ')); process.exit(1); }
    console.log('labels match: ' + JSON.stringify(counts));
  }
}
