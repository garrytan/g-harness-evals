#!/usr/bin/env bun
// Materializes the rules files of one rules-at-scale arm for one task and harness (wave 0 spec, "Rules-file materializer").
// Keyless and deterministic: the same task, arm and harness give the same bytes.
//
//   bun scripts/rules-at-scale/materialize.ts --task <task dir> --arm <arm> --harness <harness> --out <dir>
//
// Arms: none, short, b8k, b28k, b80k, b160k, split, hook, cutlift, qm-repo, qm-top. Harnesses: claude-code (CLAUDE.md),
// codex, pi, openclaw, hermes (AGENTS.md), gemini-cli (GEMINI.md), qm (soul.txt, QM's organization instructions).
// Writes each file at its path relative to the repository root under <dir> (QM's soul.txt and the hook arm's hooktext.md at
// the top of <dir>), plus manifest.json:
//   {arm, harness, task, rotation, files: [{path, bytes, chars, sha256, placement}], rules: [{id, file, byte_offset, position}],
//    filler_sources: [{id, repo, path, commit, license, sections, bytes}]}
// placement is "repo" (place at that path in the task repository), "qm-organization-instructions" (set as QM's
// organization instructions) or "hook" (deliver once beside the task message through the harness's hook).
// The out dir must be empty or absent. Exit 2 on a usage error or an arm the harness does not take.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assemble, buildRung, bytesOf, charsOf, HARNESSES, loadFiller, loadRules, loadSources, loadTask, ruleSection, ruleText, sha256, takeFiller, type Filler, type Harness, type Piece, type Position, type RuleId, type RulesDoc, type Source, type TaskInfo } from './lib.ts';

export const ARMS = ['none', 'short', 'b8k', 'b28k', 'b80k', 'b160k', 'split', 'hook', 'cutlift', 'qm-repo', 'qm-top'] as const;
export type Arm = (typeof ARMS)[number];
const QM_ONLY: ReadonlySet<Arm> = new Set<Arm>(['qm-repo', 'qm-top']);
const NOT_QM: ReadonlySet<Arm> = new Set<Arm>(['b160k', 'split', 'hook', 'cutlift']);

export type Placement = 'repo' | 'qm-organization-instructions' | 'hook';
export interface OutFile { path: string; text: string; placement: Placement }
export interface RuleAt { id: RuleId; file: string; byte_offset: number; position: Position | 'folder' | 'import' | 'hook' }
export interface Materialized { files: OutFile[]; rules: RuleAt[]; pieces: Piece[] }
export interface Manifest {
  arm: Arm; harness: Harness; task: string; rotation: 0 | 1 | 2;
  files: Array<{ path: string; bytes: number; chars: number; sha256: string; placement: Placement }>;
  rules: RuleAt[];
  filler_sources: Array<{ id: string; repo: string; path: string; commit: string; license: string; sections: number; bytes: number }>;
}

export class Refused extends Error {}

/** Where each planted rule line sits in a text: its byte offset, or -1. */
function lineOffset(text: string, line: string): number {
  const at = text.indexOf('\n' + line + '\n');
  return at < 0 ? -1 : bytesOf(text.slice(0, at + 1));
}

/** The rules of a laddered file, each at its position. */
function placedRules(doc: RulesDoc, task: TaskInfo, file: string, text: string, skip: ReadonlySet<RuleId> = new Set()): RuleAt[] {
  const out: RuleAt[] = [];
  const rot = doc.rotations[String(task.rotation) as '0' | '1' | '2'];
  for (const pos of ['top', 'middle', 'end'] as Position[]) for (const id of rot[pos]) {
    if (skip.has(id)) continue;
    const at = lineOffset(text, ruleText(doc, id));
    if (at < 0) throw new Error(id + ' is missing from ' + file);
    out.push({ id, file, byte_offset: at, position: pos });
  }
  return out;
}

export function materialize(arm: Arm, harness: Harness, task: TaskInfo, doc: RulesDoc = loadRules(), filler: Filler = loadFiller()): Materialized {
  if (QM_ONLY.has(arm) && harness !== 'qm') throw new Refused('arm ' + arm + ' runs on qm only');
  if (NOT_QM.has(arm) && harness === 'qm') throw new Refused('arm ' + arm + ' does not run on qm (its organization instructions are capped at 100,000 characters and it reads no folder files)');
  const name = doc.rules_file[harness];
  const placement: Placement = harness === 'qm' ? 'qm-organization-instructions' : 'repo';
  const single = (text: string, pieces: Piece[]): Materialized => ({ files: [{ path: name, text, placement }], rules: placedRules(doc, task, name, text), pieces });

  switch (arm) {
    case 'none': return { files: [], rules: [], pieces: [] };
    case 'short': { const b = buildRung(doc, filler, task.rotation, null); return single(b.text, []); }
    case 'b8k': case 'b28k': case 'b80k': case 'b160k': { const b = buildRung(doc, filler, task.rotation, doc.sizes[arm]); return single(b.text, b.pieces); }
    case 'cutlift': { const b = buildRung(doc, filler, task.rotation, doc.sizes.b160k); return single(b.text, b.pieces); }
    case 'qm-top': { const b = buildRung(doc, filler, task.rotation, doc.qm_top_max_chars, charsOf, true); return single(b.text, b.pieces); }
    case 'qm-repo': {
      const b = buildRung(doc, filler, task.rotation, doc.sizes.b8k);
      const repoFile = doc.rules_file.codex;
      return { files: [{ path: repoFile, text: b.text, placement: 'repo' }, { path: name, text: '', placement }], rules: placedRules(doc, task, repoFile, b.text), pieces: b.pieces };
    }
    case 'hook': {
      const b = buildRung(doc, filler, task.rotation, doc.sizes.b160k);
      const m = single(b.text, b.pieces);
      const hook = doc.rules.map((r) => r.text).join('\n') + '\n';
      m.files.push({ path: 'hooktext.md', text: hook, placement: 'hook' });
      for (const r of doc.rules) m.rules.push({ id: r.id, file: 'hooktext.md', byte_offset: lineOffset('\n' + hook, r.text) - 1, position: 'hook' });
      return m;
    }
    case 'split': return split(doc, filler, task, harness);
  }
}

/** The split arm: the b8k root minus R3 and R5 (on claude-code minus R1 too, imported from docs/conventions.md at R1's place),
 *  R3 in <tests_dir>/<rules file>, R5 in <package_dir>/<rules file>, and the rest of 160 KB of filler across those two files
 *  and docs/<rules file>, in stream order. */
function split(doc: RulesDoc, filler: Filler, task: TaskInfo, harness: Harness): Materialized {
  if (task.tests_dir === task.package_dir || !task.tests_dir || !task.package_dir) throw new Refused('the split arm needs distinct tests_dir and package_dir (task ' + task.id + ')');
  const name = doc.rules_file[harness];
  const out = new Set<RuleId>(['R3', 'R5']);
  const importR1 = harness === 'claude-code';
  const r1 = ruleText(doc, 'R1');
  const edit = (_p: Position, lines: string[]) => lines.filter((l) => !out.has(doc.rules.find((r) => r.text === l)!.id)).map((l) => (importR1 && l === r1 ? '@docs/conventions.md' : l));
  const base = buildRung(doc, filler, task.rotation, doc.sizes.b8k);
  const rootLines = (pos: Position) => edit(pos, doc.rotations[String(task.rotation) as '0' | '1' | '2'][pos].map((id) => ruleText(doc, id)));
  const sec = (pos: Position) => ruleSection(doc.headings[pos], rootLines(pos));
  const root = assemble(doc.title, sec('top'), sec('middle'), sec('end'), base.pieces.map((p) => p.text)).text;
  const files: OutFile[] = [{ path: name, text: root, placement: 'repo' }];
  const rules: RuleAt[] = placedRules(doc, task, name, root, new Set<RuleId>(importR1 ? ['R1', 'R3', 'R5'] : ['R3', 'R5']));
  let conventions = '';
  if (importR1) {
    conventions = doc.title.replace(/^# .*/, '# Conventions') + '\n\n' + ruleSection(doc.headings.split_import, [r1]);
    files.push({ path: 'docs/conventions.md', text: conventions, placement: 'repo' });
    rules.push({ id: 'R1', file: 'docs/conventions.md', byte_offset: lineOffset(conventions, r1), position: 'import' });
  }
  const folder = (id: RuleId) => doc.title + '\n\n' + ruleSection(doc.headings.split_folder, [ruleText(doc, id)]);
  const heads: Array<{ path: string; head: string; rule: RuleId | null }> = [
    { path: task.tests_dir + '/' + name, head: folder('R3'), rule: 'R3' },
    { path: task.package_dir + '/' + name, head: folder('R5'), rule: 'R5' },
    { path: 'docs/' + name, head: doc.title + '\n', rule: null },
  ];
  const left = doc.split_total_bytes - bytesOf(root) - bytesOf(conventions);
  const pieces: Piece[] = [...base.pieces];
  let next = base.next, spent = 0;
  heads.forEach((h, j) => {
    const target = j < 2 ? Math.round(left / 3) : left - spent;
    const fixed = h.head;
    const t = takeFiller(filler, next, fixed, target, bytesOf);
    next = t.next;
    pieces.push(...t.pieces);
    const text = [fixed, ...t.pieces.map((p) => p.text)].join('\n');
    const body = text.endsWith('\n') ? text : text + '\n';
    spent += bytesOf(body);
    files.push({ path: h.path, text: body, placement: 'repo' });
    if (h.rule) rules.push({ id: h.rule, file: h.path, byte_offset: lineOffset(body, ruleText(doc, h.rule)), position: 'folder' });
  });
  return { files, rules, pieces };
}

export function manifestOf(arm: Arm, harness: Harness, task: TaskInfo, m: Materialized, filler: Filler, sources: Source[]): Manifest {
  const per = new Map<string, { sections: number; bytes: number }>();
  for (const p of m.pieces) { const e = per.get(p.source) ?? { sections: 0, bytes: 0 }; e.sections++; e.bytes += bytesOf(p.text); per.set(p.source, e); }
  return {
    arm, harness, task: task.id, rotation: task.rotation,
    files: m.files.map((f) => ({ path: f.path, bytes: bytesOf(f.text), chars: charsOf(f.text), sha256: sha256(f.text), placement: f.placement })),
    rules: m.rules,
    filler_sources: [...per].map(([id, e]) => { const s = sources.find((x) => x.id === id); if (!s) throw new Error('filler source ' + id + ' is not in sources.json'); return { id, repo: s.repo, path: s.path, commit: s.commit, license: s.license, ...e }; }).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const opt = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const usage = (why: string): never => { console.error('materialize: ' + why + '\nusage: bun scripts/rules-at-scale/materialize.ts --task <task dir> --arm <' + ARMS.join('|') + '> --harness <' + HARNESSES.join('|') + '> --out <dir>'); process.exit(2); };
  const taskDir = opt('--task'), arm = opt('--arm') as Arm | undefined, harness = opt('--harness') as Harness | undefined, out = opt('--out');
  if (!taskDir || !arm || !harness || !out) usage('missing an option');
  if (!ARMS.includes(arm!)) usage('unknown arm ' + arm);
  if (!HARNESSES.includes(harness!)) usage('unknown harness ' + harness);
  if (existsSync(out!) && readdirSync(out!).length) usage(out + ' is not empty');
  let task: TaskInfo;
  try { task = loadTask(taskDir!); } catch (e) { task = usage((e as Error).message); }
  const filler = loadFiller();
  let m: Materialized;
  try { m = materialize(arm!, harness!, task, loadRules(), filler); } catch (e) { if (e instanceof Refused) m = usage(e.message); else throw e; }
  mkdirSync(out!, { recursive: true });
  for (const f of m.files) { mkdirSync(dirname(join(out!, f.path)), { recursive: true }); writeFileSync(join(out!, f.path), f.text); }
  const manifest = manifestOf(arm!, harness!, task, m, filler, loadSources());
  writeFileSync(join(out!, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('materialize: ' + arm + ' on ' + harness + ' for ' + task.id + ': ' + manifest.files.map((f) => f.path + ' (' + f.bytes + ' bytes)').join(', '));
}
