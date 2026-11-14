#!/usr/bin/env bun
// The blinding normaliser for internal-task's judging (plan "Grading": findings normalised to path, line and one paragraph
// before judging; arm, reader names and gstack's labels stripped; severity mapped by a frozen map). It runs on raw arms in
// gstack-evals' noloss arm contract v1 (the review rig's arms, or merge-arms.ts output) before noloss judge-packet.
//
//   bun scripts/review-bugs/blind.ts --severity-map <file> --out <dir> --key <file> [--date <YYYY-MM-DD>]
//       --arm <arm dir> <blinded id> <map entry> [--arm ...]
//
// Blind every arm of one judging batch in one call, so every arm gets the same vocabulary: a reader name or raw label any
// arm uses is stripped from every arm's text. Each --arm names the source arm, the opaque id its blinded copy gets (it
// may not contain the source's id), and the entry of the severity map file its labels go through. The output is
// <out>/<blinded id>/ per arm, in arm contract v1:
//
// - arm.json: contract_version 1, the blinded id, label "Blinded arm <id>", the source's suite, suite_sha256, passes and
//   status, one date for the whole batch, and coverage gaps cut to "<unit> pass <n>: coverage gap" (the reasons go to
//   the key). No models, readers, told text, source or severity map.
// - findings/<unit>.jsonl: one line per finding with id (b1, b2, ... per unit), severity (CRITICAL or INFORMATIONAL,
//   from the map), path, line, pass, summary (the one paragraph below) and evidence (the same normaliser, when the
//   finding has evidence; noloss adjudication's evidence sheet reads it, and its matching packets do not). Every other
//   field (reader, label, category, confidence, fingerprint, confirmed, merged_from and the rest) is dropped.
// - cost.tsv: the source's all-scope rows only, so no reader or voice row names a reader. Judges never see arm.json or
//   cost.tsv: judge-run sends the brief, batch.json and the packets.
//
// The key (--key, outside --out, never shown to judges) maps each blinded finding back to its source arm, pass and
// finding id, with its raw label, reader and merged_from, and keeps each arm's gap reasons and the sha256 of its source
// files. A source dir is recorded relative to the working directory, or by its name when it sits outside it.
//
// Severity: the raw label is label, else severity, cut at its first comma (noloss contract.ts). CRITICAL and
// INFORMATIONAL map to themselves. Any other label is looked up in the map entry, the reader's by_reader map before
// default, then as a lowercase twin of an entry, then by its first word; a label still unmapped refuses with
// E_BLIND_SEVERITY. The map file is gstack-evals' --severity-map format, one entry per arm name, such as
// wiki/plans/2026-11-03-geva-255-r2-after-pin-amendment/severity-map.rr2.json at gstack-evals 91d76421. The lowercase
// twins, the first word of a compound label and the refusal are the rules R2 froze for internal-task's sevmap.ts (that
// amendment's section 6); its MAJOR and MINOR rows are left to the map file, which holds Major and Minor.
//
// The paragraph (NORMALISER_VERSION 1), applied to summary and fix alike, then fix folded in as " Fix: <fix>":
// 1. Markdown is flattened: fence lines, heading, quote and list markers, ** and __, and backticks go.
// 2. gstack's line shapes go: bracketed tags ([P0] to [P4], [CRITICAL], [HIGH], [AUTO-FIXED] and the rest of TAGS),
//    confidence tags such as "(confidence: 8/10, specialist: security)" or "confidence 7/10", "specialist: <name>",
//    and a "file:line" location at the start of a line. "Recommended fix:" and "Suggested fix:" become "Fix:". Em and en dashes become
//    " - ".
// 3. Words are removed, whole words, case-insensitive, a hyphen matching a hyphen, space or underscore: VOCABULARY
//    (gstack's procedure names), every reader name an arm uses (a finding's reader, specialist or voice, or a
//    reader:<name> cost row) except the ORDINARY words R2's blind.py kept, every source arm id and label, every model
//    id an arm.json lists (and its part after the last /), the model family names in FAMILIES (case-sensitive), and the
//    severity words noloss judge-packet masks (SEVERITY_WORDS) plus every raw label and map key in the batch. noloss
//    masks those as "[severity]"; here they are deleted, so no marker is left to count.
// 4. A machine path (home, /tmp, /workspace and the other folders noloss's publication scan names) is cut to its last
//    part.
// 5. Whitespace collapses to single spaces, empty brackets and stray leading separators go, and the paragraph is cut at
//    CAP (1,200) characters at a word boundary, ending " [cut]". An empty result reads "No description given."
// After normalising, the text is checked again for every stripped name; a hit refuses with E_BLIND_LEAK.
//
// What is reused from R2: blind.py's reader rule (rewrite every reader name an arm uses, with the hyphen, space and
// underscore forms, keeping its ORDINARY list) and its model id rule, applied to every judged arm alike; noloss
// judge-packet's severity word list; sevmap.ts's lookup and refusal as the R2 amendment describes them (its source is
// not in gstack-evals at the pin). Not reused: blind.py's rule that leaves out a finding whose path names a reader or
// model id. That rule existed because judge-packet refuses such a path; blinded arms list no readers or models, so
// judge-packet has nothing to refuse and no finding is left out. R1's publication-scan scrub chain is not at the pin
// either; noloss ingest still runs its scan on the blinded arms, and this step only cuts machine paths.
//
// Refusals exit 2: E_BLIND_SOURCE, E_BLIND_PASS, E_BLIND_COST, E_BLIND_GAP (the arm is not a raw arm contract v1
// directory), E_BLIND_SEVMAP (a map file or entry problem), E_BLIND_SEVERITY (an unmapped label), E_BLIND_LEAK and
// E_BLIND_ARGS.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { ARM_ID, ArmError, readArm, sha256, type Arm, type Mapped, type SeverityEntry } from './arm.ts';

export const NORMALISER_VERSION = 1;
export const CAP = 1200;
/** Severity words noloss judge-packet masks (lanes/review-noloss/judge.ts SEVERITY_WORDS at gstack-evals 91d76421). */
export const SEVERITY_WORDS = ['CRITICAL', 'INFORMATIONAL', 'HIGH', 'MEDIUM', 'LOW', 'BLOCKER', 'BLOCKING', 'FIXABLE', 'INVESTIGATE', 'NIT', 'MAJOR', 'MINOR', 'SEVERE', 'P0', 'P1', 'P2', 'P3'];
/** Bracketed tags gstack's review and ship formats print (review/checklist.md, review/sections/review-army.md). */
export const TAGS = ['P0', 'P1', 'P2', 'P3', 'P4', 'CRITICAL', 'INFORMATIONAL', 'HIGH', 'MEDIUM', 'LOW', 'BLOCKER', 'BLOCKING', 'NIT', 'MAJOR', 'MINOR', 'FIXABLE', 'INVESTIGATE', 'AUTO-FIXED', 'ASK', 'FIXED', 'ALREADY FIXED', 'ADVISORY', 'GAP', 'DONE', 'NOT DONE', 'PARTIAL', 'UNVERIFIABLE', 'OK', 'VALID', 'FALSE POSITIVE', 'SUPPRESSED', 'CHANGED', 'SEVERITY', 'NEEDS INPUT'];
/** gstack's own procedure names and labels, removed from every arm's text. */
export const VOCABULARY = ['Review Army', 'Pre-Landing Review', 'Fix-First Review', 'Fix-First', 'Gate edits', 'AUTO-FIXED', 'NEEDS INPUT', 'outside voice', 'adversarial pass', 'adversarial review', 'adversarial reader', 'adversarial subagent', 'adversarial', 'specialists', 'specialist', 'Plan Completion', 'Scope Drift', 'Greptile', 'gstack'];
/** Reader names that are ordinary words a finding uses for the defect itself, kept (R2's blind.py ORDINARY). */
export const ORDINARY = ['security', 'testing', 'maintainability', 'performance', 'design', 'simplification', 'data-migration', 'api-contract', 'state-machines', 'red-team', 'batched', 'normalizer', 'confirmed', 'unconfirmed', 'other'];
/** Model family names, removed as case-sensitive whole words. */
export const FAMILIES = ['Claude', 'Opus', 'Sonnet', 'Haiku', 'Fable', 'Anthropic', 'OpenAI', 'GPT', 'Codex', 'Sol', 'Astra', 'Gemini'];

export interface BlindArmSpec {
  dir: string;
  id: string;
  entry: string;
}

export interface BlindOptions {
  severityMap: string;
  out: string;
  key: string;
  arms: BlindArmSpec[];
  date?: string;
}

const fail = (kind: string, where: string, detail: string): never => {
  throw new ArmError('E_BLIND_' + kind, where, detail);
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const B = '(?<![A-Za-z0-9_])';
const E = '(?![A-Za-z0-9_])';
/** A whole-word, case-insensitive pattern in which a hyphen, space or underscore matches any of the three. */
const phrase = (s: string) => new RegExp(B + s.split(/[-_ ]+/).map(esc).join('[-_ ]') + E, 'gi');
const word = (s: string, flags: string) => new RegExp(B + esc(s) + E, flags);
const longestFirst = (xs: Iterable<string>) => [...new Set(xs)].filter(Boolean).sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
const MACHINE_PATH = /(^|[\s"'(\x60=:,[])(?:~\/|\/home\/|\/Users\/|\/root\/|\/tmp\/|\/workspace\/|\/var\/folders\/)(\S*)/g;

export interface Normaliser {
  /** One paragraph from a summary and an optional fix. */
  paragraph(summary: string, fix?: string): string;
  /** The same normaliser for a single text, such as evidence. */
  text(t: string): string;
  /** The names a normalised text still holds; empty when it is clean. */
  leaks(t: string): string[];
}

/** Builds the normaliser for one batch from the names its arms use. */
export function normaliser(names: { readers: Iterable<string>; arms: Iterable<string>; models: Iterable<string>; labels: Iterable<string> }): Normaliser {
  const ordinary = new Set(ORDINARY);
  const readers = longestFirst([...names.readers].filter((r) => !ordinary.has(r.toLowerCase())));
  const removals: RegExp[] = [
    ...longestFirst([...VOCABULARY, ...readers, ...[...names.arms].filter((a) => a.length >= 3)]).map(phrase),
    ...longestFirst([...names.models].flatMap((m) => [m, m.split('/').pop()!])).map((m) => new RegExp(esc(m), 'gi')),
    ...FAMILIES.map((f) => word(f, 'g')),
    ...longestFirst([...SEVERITY_WORDS, ...names.labels]).map((w) => word(w, 'gi')),
  ];
  const tags = new RegExp('\\[\\s*(?:' + longestFirst(TAGS).map(esc).join('|') + ')\\s*\\]', 'gi');
  const clean = (input: string): string => {
    let t = input.replace(/\r\n?/g, '\n');
    t = t.replace(/^\s*(?:\x60{3,}|~{3,}).*$/gm, '');
    t = t.replace(/^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gm, '');
    t = t.replace(/\*\*|__|\x60+/g, '');
    t = t.replace(tags, ' ');
    t = t.replace(/[([]\s*confidence\b[^)\]]*[)\]]/gi, ' ');
    t = t.replace(/\bconfidence\s*[:=]?\s*\d+(?:\.\d+)?\s*(?:\/\s*10|%)?/gi, ' ');
    t = t.replace(/\bspecialists?\s*:\s*[\w-]+/gi, ' ');
    t = t.replace(/^[ \t]*\[?[\w./@-]+\.\w+:\d+(?:-\d+)?\]?[ \t]*(?:[-:\u2013\u2014][ \t]*)?/gm, '');
    t = t.replace(/\b(?:recommended|suggested|proposed)\s+fix\s*:/gi, 'Fix:');
    t = t.replace(/\s*[\u2013\u2014]\s*/g, ' - ');
    for (const re of removals) t = t.replace(re, ' ');
    t = t.replace(MACHINE_PATH, (_m, pre: string, rest: string) => pre + (rest.split('/').filter(Boolean).pop() ?? ''));
    t = t.replace(/\s+/g, ' ');
    t = t.replace(/\(\s+\)|\(\s*[,;:]\s*\)|\[\s+\]/g, ' ').replace(/\s+/g, ' ');
    t = t.replace(/([.!?;:,])(?: +[.,;:!?])+/g, '$1').replace(/ +([,.;:!?)])/g, '$1').replace(/\( +/g, '(').replace(/\(\s*[,;:]\s*/g, '(').replace(/(?: ?- ?){2,}/g, ' - ');
    t = t.replace(/^[\s\-:;,.|]+/, '').replace(/[\s\-:;,|]+$/, '');
    return t.trim();
  };
  const cap = (t: string) => {
    if (t.length <= CAP) return t;
    const cut = t.slice(0, CAP);
    const at = cut.lastIndexOf(' ');
    return (at > CAP / 2 ? cut.slice(0, at) : cut) + ' [cut]';
  };
  const or = (t: string) => t || 'No description given.';
  const checks: Array<[string, RegExp]> = [
    ...VOCABULARY.map((v) => ['gstack vocabulary ' + JSON.stringify(v), phrase(v)] as [string, RegExp]),
    ...readers.map((r) => ['reader name ' + JSON.stringify(r), phrase(r)] as [string, RegExp]),
    ...[...names.arms].filter((a) => a.length >= 3).map((a) => ['arm id or label ' + JSON.stringify(a), phrase(a)] as [string, RegExp]),
    ...[...names.models].map((m) => ['model id ' + JSON.stringify(m), new RegExp(esc(m), 'i')] as [string, RegExp]),
  ];
  return {
    paragraph: (summary, fix) => {
      const s = clean(summary);
      const f = fix ? clean(fix).replace(/^fix:\s*/i, '') : '';
      return or(cap(f ? (s ? s + ' ' : '') + 'Fix: ' + f : s));
    },
    text: (t) => or(cap(clean(t))),
    leaks: (t) => checks.filter(([, re]) => new RegExp(re.source, re.flags.replace('g', '')).test(t)).map(([n]) => n),
  };
}

/** One entry of a --severity-map file, with the lookup R2 froze: exact, then lowercase twin, then the first word. */
export function severityLookup(file: string, entryName: string): { lookup: (raw: string, reader: string | null) => Mapped | null; keys: string[]; entry: SeverityEntry; sha256: string } {
  let text: string;
  let map: Record<string, SeverityEntry>;
  try {
    text = readFileSync(file, 'utf8');
    map = JSON.parse(text);
  } catch (e) {
    return fail('SEVMAP', file, 'cannot read it as JSON: ' + (e as Error).message);
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) fail('SEVMAP', file, 'not a JSON object of map entries');
  const entry = map[entryName];
  if (!entry || typeof entry !== 'object') return fail('SEVMAP', file, 'has no entry ' + JSON.stringify(entryName) + '; it has ' + Object.keys(map).join(', '));
  const tables: Array<[string, Record<string, Mapped>]> = [['default', entry.default ?? {}], ...Object.entries(entry.by_reader ?? {}).map(([r, m]) => ['by_reader.' + r, m] as [string, Record<string, Mapped>])];
  const twins = new Map<Record<string, Mapped>, Record<string, Mapped>>();
  for (const [name, table] of tables) {
    const twin: Record<string, Mapped> = {};
    for (const [label, v] of Object.entries(table)) {
      if (v !== 'CRITICAL' && v !== 'INFORMATIONAL') fail('SEVMAP', file, entryName + '.' + name + ' maps ' + JSON.stringify(label) + ' to ' + JSON.stringify(v) + ', not CRITICAL or INFORMATIONAL');
      const low = label.toLowerCase();
      if (low in twin && twin[low] !== v) fail('SEVMAP', file, entryName + '.' + name + ' has labels whose lowercase twin ' + JSON.stringify(low) + ' maps both ways');
      twin[low] = v;
    }
    twins.set(table, twin);
  }
  const once = (raw: string, reader: string | null): Mapped | null => {
    if (raw === 'CRITICAL' || raw === 'INFORMATIONAL') return raw;
    const own = reader !== null ? entry.by_reader?.[reader] : undefined;
    const order = [own, entry.default].filter((t): t is Record<string, Mapped> => !!t);
    for (const t of order) if (raw in t) return t[raw]!;
    for (const t of order) if (raw in twins.get(t)!) return twins.get(t)![raw]!;
    return null;
  };
  const keys = tables.flatMap(([, t]) => Object.keys(t));
  return {
    lookup: (raw, reader) => {
      const direct = once(raw, reader);
      if (direct) return direct;
      const firstWord = raw.split(/[^A-Za-z0-9]+/).filter(Boolean)[0];
      return firstWord && firstWord !== raw ? once(firstWord, reader) : null;
    },
    keys,
    entry,
    sha256: sha256(text!),
  };
}

const inside = (child: string, dir: string) => resolve(child) === resolve(dir) || resolve(child).startsWith(resolve(dir) + sep);
const cell = (v: number | null | undefined) => (v === null || v === undefined ? 'unavailable' : String(v));
const BLIND_COST = ['pr', 'scope', 'pass', 'total_tokens', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'usd', 'wall_seconds', 'meter_source'] as const;

export function blindArms(o: BlindOptions): { out: string; key: string; arms: Array<{ id: string; findings: number }> } {
  const out = resolve(o.out);
  const key = resolve(o.key);
  if (!o.arms.length) fail('ARGS', '--arm', 'give at least one arm');
  if (inside(key, out)) fail('ARGS', key, 'the key is inside --out ' + out + '; it maps blinded ids back to arms and must never travel with the blinded arms');
  if (existsSync(key)) fail('ARGS', key, 'already exists; give each batch a new key path');
  if (existsSync(out) && readdirSync(out).length) fail('ARGS', out, 'is not empty; write each batch to a new directory');
  const date = o.date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('ARGS', '--date', JSON.stringify(date) + ' is not YYYY-MM-DD');

  const sources: Arm[] = o.arms.map((a) => readArm(resolve(a.dir), 'E_BLIND'));
  const ids = o.arms.map((a) => a.id);
  if (new Set(ids).size !== ids.length) fail('ARGS', '--arm', 'a blinded id is given twice: ' + ids.join(', '));
  if (new Set(sources.map((s) => s.dir)).size !== sources.length) fail('ARGS', '--arm', 'an arm directory is given twice');
  o.arms.forEach((a, i) => {
    if (!ARM_ID.test(a.id)) fail('ARGS', '--arm ' + a.dir, 'blinded id ' + JSON.stringify(a.id) + ' does not match ' + ARM_ID);
    for (const s of sources) if (a.id.toLowerCase().includes(s.arm.id.toLowerCase()) || s.arm.id.toLowerCase().includes(a.id.toLowerCase())) fail('ARGS', '--arm ' + o.arms[i]!.dir, 'blinded id ' + JSON.stringify(a.id) + ' overlaps source arm id ' + JSON.stringify(s.arm.id) + '; a blinded id must be opaque');
  });
  const maps = o.arms.map((a) => severityLookup(o.severityMap, a.entry));
  sources.forEach((s, i) => {
    if (s.arm.severity_map && JSON.stringify(s.arm.severity_map) !== JSON.stringify(maps[i]!.entry)) fail('SEVMAP', join(s.dir, 'arm.json'), 'the arm recorded a severity_map that is not entry ' + JSON.stringify(o.arms[i]!.entry) + ' of ' + o.severityMap + '; name the entry the arm ran with');
  });

  const readers = new Set<string>();
  const labels = new Set<string>(maps.flatMap((m) => m.keys));
  const models = new Set<string>();
  const armNames = new Set<string>();
  for (const s of sources) {
    armNames.add(s.arm.id);
    armNames.add(s.arm.label);
    for (const m of s.arm.models ?? []) models.add(m.model);
    for (const r of s.cost) if (r.scope.startsWith('reader:')) readers.add(r.scope.slice('reader:'.length));
    for (const list of s.findings.values())
      for (const f of list) {
        if (f.reader) readers.add(f.reader);
        labels.add(f.raw);
        const merged = f.fields.merged_from as { arm?: unknown } | undefined;
        if (merged && typeof merged.arm === 'string') armNames.add(merged.arm);
      }
  }
  const norm = normaliser({ readers, arms: armNames, models, labels });

  const unmapped: string[] = [];
  sources.forEach((s, i) => {
    for (const [unit, list] of s.findings)
      for (const f of list) if (!maps[i]!.lookup(f.raw, f.reader)) unmapped.push(join(s.dir, 'findings', unit + '.jsonl') + ' line ' + (f.index + 1) + ': raw label ' + JSON.stringify(f.raw) + (f.reader ? ' (reader ' + f.reader + ')' : ''));
  });
  if (unmapped.length) fail('SEVERITY', o.severityMap, unmapped.length + ' finding label' + (unmapped.length === 1 ? ' is' : 's are') + ' unmapped by its arm\'s entry; add them to a new map file before judging:\n' + unmapped.join('\n'));

  const keyArms: unknown[] = [];
  const keyFindings: unknown[] = [];
  const written: Array<{ id: string; findings: number }> = [];
  const outputs: Array<{ dir: string; files: Map<string, string> }> = [];
  sources.forEach((s, i) => {
    const spec = o.arms[i]!;
    const files = new Map<string, string>();
    let n = 0;
    for (const [unit, list] of s.findings) {
      const lines = list.map((f, k) => {
        const id = 'b' + (k + 1);
        const summary = norm.paragraph(String(f.fields.summary), typeof f.fields.fix === 'string' ? f.fields.fix : undefined);
        const evidence = typeof f.fields.evidence === 'string' && f.fields.evidence.trim() ? norm.text(f.fields.evidence) : null;
        const where = join(s.dir, 'findings', unit + '.jsonl') + ' line ' + (f.index + 1);
        const hits = [...norm.leaks(summary), ...(evidence ? norm.leaks(evidence) : [])];
        if (hits.length) fail('LEAK', where, 'the normalised text still names ' + hits.join(', '));
        const mapped = maps[i]!.lookup(f.raw, f.reader)!;
        keyFindings.push({ blinded_arm: spec.id, unit, id, pass: f.pass, source_arm: s.arm.id, source_id: f.id, source_line: f.index + 1, raw_severity: f.raw, reader: f.reader, mapped_severity: mapped, ...(f.fields.merged_from ? { merged_from: f.fields.merged_from } : {}) });
        n++;
        return JSON.stringify({ id, severity: mapped, path: f.fields.path ?? null, line: f.fields.line ?? null, pass: f.pass, summary, ...(evidence ? { evidence } : {}) });
      });
      files.set(join('findings', unit + '.jsonl'), lines.map((l) => l + '\n').join(''));
    }
    const gaps = s.gaps.map((g) => g.ref + ' pass ' + g.pass + ': coverage gap');
    const arm = {
      contract_version: 1, id: spec.id, label: 'Blinded arm ' + spec.id, suite: s.arm.suite, ...(s.arm.suite_sha256 ? { suite_sha256: s.arm.suite_sha256 } : {}), date, passes: s.arm.passes, provenance: 'live', status: s.arm.status ?? 'complete',
      ...(gaps.length ? { coverage_gaps: gaps } : {}),
      blinding: { tool: 'harness-evals scripts/review-bugs/blind.ts', normaliser_version: NORMALISER_VERSION, cap: CAP, severity_map_sha256: maps[i]!.sha256 },
    };
    files.set('arm.json', JSON.stringify(arm, null, 2) + '\n');
    const cost = s.cost.filter((r) => r.scope === 'all').map((r) => [r.pr, r.scope, String(r.pass), ...BLIND_COST.slice(3, -1).map((k) => cell(r.values[k as keyof typeof r.values])), r.meter_source].join('\t'));
    files.set('cost.tsv', [BLIND_COST.join('\t'), ...cost].join('\n') + '\n');
    outputs.push({ dir: join(out, spec.id), files });
    keyArms.push({ blinded_id: spec.id, map_entry: spec.entry, source: { dir: s.dir.startsWith(process.cwd() + sep) ? s.dir.slice(process.cwd().length + 1) : basename(s.dir), arm_id: s.arm.id, label: s.arm.label, arm_json_sha256: s.armJsonSha256, cost_sha256: s.costSha256, findings_sha256: s.findingsSha256 }, coverage_gaps: s.arm.coverage_gaps ?? [] });
    written.push({ id: spec.id, findings: n });
  });

  for (const { dir, files } of outputs) {
    mkdirSync(join(dir, 'findings'), { recursive: true });
    for (const [name, text] of files) writeFileSync(join(dir, name), text);
  }
  const keyDoc = { schema: 'harness-evals-review-bugs-blind-key/1', note: 'Maps blinded findings back to their source arms. Never show this file to a judge.', date, normaliser_version: NORMALISER_VERSION, cap: CAP, severity_map: { file: basename(o.severityMap), sha256: maps[0]!.sha256 }, arms: keyArms, findings: keyFindings };
  writeFileSync(key, JSON.stringify(keyDoc, null, 2) + '\n');
  return { out, key, arms: written };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const o: Partial<BlindOptions> & { arms: BlindArmSpec[] } = { arms: [] };
  try {
    for (let i = 0; i < args.length; ) {
      const k = args[i]!;
      if (k === '--arm') {
        const [dir, id, entry] = args.slice(i + 1, i + 4);
        if (entry === undefined) fail('ARGS', '--arm', 'takes three values: <arm dir> <blinded id> <map entry>');
        o.arms.push({ dir: dir!, id: id!, entry: entry! });
        i += 4;
        continue;
      }
      const v = args[i + 1];
      if (v === undefined) fail('ARGS', k, 'missing value');
      if (k === '--severity-map') o.severityMap = v;
      else if (k === '--out') o.out = v;
      else if (k === '--key') o.key = v;
      else if (k === '--date') o.date = v;
      else fail('ARGS', k, 'unknown flag; usage: --severity-map <file> --out <dir> --key <file> [--date <YYYY-MM-DD>] --arm <arm dir> <blinded id> <map entry>...');
      i += 2;
    }
    const r = blindArms({ severityMap: o.severityMap ?? fail('ARGS', '--severity-map', 'missing'), out: o.out ?? fail('ARGS', '--out', 'missing'), key: o.key ?? fail('ARGS', '--key', 'missing'), arms: o.arms, ...(o.date ? { date: o.date } : {}) });
    console.log('blind: wrote ' + r.arms.map((a) => a.id + ' (' + a.findings + ' findings)').join(', ') + ' under ' + r.out + '; key at ' + r.key);
  } catch (e) {
    if (!(e instanceof ArmError)) throw e;
    console.error(e.message);
    process.exit(2);
  }
}
