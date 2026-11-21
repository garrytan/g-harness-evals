// Shared pieces of the rules-at-scale eval: the planted rules (rules.json), the filtered filler (corpus/filler.json), the task
// fields the arms need, and the rung builder that every arm uses, so the ladder is built one way everywhere.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const DIR = dirname(fileURLToPath(import.meta.url));
export const RULES_FILE = join(DIR, 'rules.json');
export const FILLER_FILE = join(DIR, 'corpus', 'filler.json');
export const SOURCES_FILE = join(DIR, 'corpus', 'sources.json');

export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';
export const RULE_IDS: readonly RuleId[] = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
export type Position = 'top' | 'middle' | 'end';
export const POSITIONS: readonly Position[] = ['top', 'middle', 'end'];
export type Harness = 'claude-code' | 'codex' | 'pi' | 'openclaw' | 'hermes' | 'gemini-cli' | 'qm';
export const HARNESSES: readonly Harness[] = ['claude-code', 'codex', 'pi', 'openclaw', 'hermes', 'gemini-cli', 'qm'];
export type Rung = 'b8k' | 'b28k' | 'b80k' | 'b160k';

export interface RulesDoc {
  version: number;
  title: string;
  rules: Array<{ id: RuleId; text: string; sha256: string; stands_for: string }>;
  pairs: RuleId[][];
  rotations: Record<'0' | '1' | '2', Record<Position, [RuleId, RuleId]>>;
  headings: Record<Position | 'split_folder' | 'split_import', string>;
  rules_file: Record<Harness, string>;
  sizes: Record<Rung, number>;
  size_tolerance: number;
  qm_top_max_chars: number;
  split_total_bytes: number;
  filler_seed: string;
}

export interface FillerSection { id: string; source: string; heading: string; text: string }
export interface Filler { version: number; seed: string; sections: FillerSection[] }
export interface Source { id: string; repo: string; path: string; commit: string; license: string; file: string; sha256: string; bytes: number; copyright: string; license_file: string; language: string | null }

export const sha256 = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
export const bytesOf = (s: string) => Buffer.byteLength(s, 'utf8');
export const charsOf = (s: string) => [...s].length;

export function loadRules(file = RULES_FILE): RulesDoc {
  const doc = JSON.parse(readFileSync(file, 'utf8')) as RulesDoc;
  for (const r of doc.rules) if (sha256(r.text) !== r.sha256) throw new Error(file + ': ' + r.id + ' text does not match its sha256');
  return doc;
}
export function loadFiller(file = FILLER_FILE): Filler { return JSON.parse(readFileSync(file, 'utf8')) as Filler; }
export function loadSources(file = SOURCES_FILE): Source[] { return (JSON.parse(readFileSync(file, 'utf8')) as { sources: Source[] }).sources; }
export const ruleText = (doc: RulesDoc, id: RuleId) => doc.rules.find((r) => r.id === id)!.text;

export interface TaskInfo { id: string; rotation: 0 | 1 | 2; package_dir: string; tests_dir: string }
export function loadTask(dir: string): TaskInfo {
  const t = Bun.TOML.parse(readFileSync(join(dir, 'task.toml'), 'utf8')) as Record<string, unknown>;
  const rot = t.rotation;
  if (rot !== 0 && rot !== 1 && rot !== 2) throw new Error(join(dir, 'task.toml') + ': rotation must be 0, 1 or 2');
  for (const k of ['id', 'package_dir', 'tests_dir']) if (typeof t[k] !== 'string' || !(t[k] as string).length) throw new Error(join(dir, 'task.toml') + ': ' + k + ' is missing');
  const clean = (p: string) => p.replace(/^\.\/+/, '').replace(/\/+$/, '');
  return { id: t.id as string, rotation: rot, package_dir: clean(t.package_dir as string), tests_dir: clean(t.tests_dir as string) };
}

/** A planted section: a neutral heading and its bullets. */
export const ruleSection = (heading: string, lines: string[]) => heading + '\n\n' + lines.join('\n') + '\n';

/** One piece of filler taken from the stream: a whole section or the head of one. */
export interface Piece { section: number; source: string; text: string; whole: boolean }

/** Take filler from the stream, starting at section index from, until measure(fixed + taken) is as close as it gets to target
 *  without the cut leaving a section with no body line. Whole sections first; the last one may be cut at the end of any of
 *  its lines or at a space inside one, from its first body line on. atMost: never pass target (a hard cap, such as QM's). Returns the pieces and the next unused section index. */
export function takeFiller(filler: Filler, from: number, fixed: string, target: number, measure: (s: string) => number, atMost = false, sep = '\n'): { pieces: Piece[]; next: number } {
  const pieces: Piece[] = [];
  let used = fixed;
  let i = from;
  for (; i < filler.sections.length; i++) {
    const s = filler.sections[i]!;
    const withWhole = used + sep + s.text;
    if (measure(withWhole) <= target) { pieces.push({ section: i, source: s.source, text: s.text, whole: true }); used = withWhole; continue; }
    const lines = s.text.split('\n');
    const bodyStart = lines.findIndex((l, j) => j > 0 && l.trim().length > 0);
    let best: { text: string; d: number } | null = null;
    const base = Math.abs(target - measure(used));
    const before = measure(used + sep);
    for (let k = bodyStart + 1; k <= lines.length; k++) {
      const prior = lines.slice(0, k - 1).join('\n');
      const line = lines[k - 1]!;
      const cuts = [...line.matchAll(/ /g)].map((m) => m.index!).filter((j) => j > 0).concat([line.length]);
      for (const j of cuts) {
        const head = (prior + '\n' + line.slice(0, j)).replace(/\n*$/, '') + '\n';
        const size = before + measure(head);
        if (atMost && size > target) continue;
        const d = Math.abs(target - size);
        if (!best || d < best.d) best = { text: head, d };
      }
      if (before + measure(prior) > target + 1) break;
    }
    if (best && best.d < base) pieces.push({ section: i, source: s.source, text: best.text, whole: best.text === s.text });
    i++;
    break;
  }
  return { pieces, next: i };
}

/** Assemble a rules file: the title, the top section, the filler, the end section, with the middle section at the filler
 *  boundary whose offset is nearest half of the file's bytes. Blocks are separated by one blank line. Returns the text and
 *  each planted section's byte offset. */
export function assemble(title: string, top: string, middle: string, end: string, filler: string[]): { text: string; offsets: Record<Position, number> } {
  const head = title + '\n';
  const blocks = [head, top, ...filler, end];
  const total = bytesOf(blocks.join('\n')) + bytesOf(middle) + 1;
  let best = { k: 2, d: Infinity };
  for (let k = 2; k <= blocks.length - 1; k++) {
    const at = bytesOf(blocks.slice(0, k).join('\n')) + 1;
    const d = Math.abs(at - total / 2);
    if (d < best.d) best = { k, d };
  }
  const out = [...blocks.slice(0, best.k), middle, ...blocks.slice(best.k)];
  const text = out.join('\n');
  const offsetOf = (idx: number) => bytesOf(out.slice(0, idx).join('\n')) + (idx > 0 ? 1 : 0);
  return { text, offsets: { top: offsetOf(1), middle: offsetOf(best.k), end: offsetOf(out.length - 1) } };
}

/** The bullet lines of one position for a rotation, before any arm edits them. */
export function positionLines(doc: RulesDoc, rotation: 0 | 1 | 2, pos: Position): string[] {
  return doc.rotations[String(rotation) as '0' | '1' | '2'][pos].map((id) => ruleText(doc, id));
}

export interface Built { text: string; pieces: Piece[]; next: number; offsets: Record<Position, number> }

/** A ladder rung (or the short arm when target is null): the planted sections with filler fitted to target by measure.
 *  atMost makes target a hard cap. */
export function buildRung(doc: RulesDoc, filler: Filler, rotation: 0 | 1 | 2, target: number | null, measure: (s: string) => number = bytesOf, atMost = false): Built {
  const sec = (pos: Position) => ruleSection(doc.headings[pos], positionLines(doc, rotation, pos));
  const top = sec('top'), middle = sec('middle'), end = sec('end');
  if (target === null) { const a = assemble(doc.title, top, middle, end, []); return { ...a, pieces: [], next: 0 }; }
  const fixed = [doc.title + '\n', top, middle, end].join('\n');
  const { pieces, next } = takeFiller(filler, 0, fixed, target, measure, atMost);
  const a = assemble(doc.title, top, middle, end, pieces.map((p) => p.text));
  return { ...a, pieces, next };
}
