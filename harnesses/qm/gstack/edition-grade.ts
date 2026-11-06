#!/usr/bin/env bun
// Graders for the QM S1 edition rerun (internal-task-a, internal-task-b plan step 3 and decision F1).
//
//   bun harnesses/qm/gstack/edition-grade.ts --turns <turns.jsonl> --keys <keys.json> [--tasks <tasks.json>] [--judge <module>] --out <grades.jsonl>
//
// One final-answer extraction step, the same code for every arm: the reply is split into sections at its headings
// (ATX, setext, a bold-only line or a "Label:" line), heading lines are dropped, markdown markers are stripped, and
// trailing follow-up sections (next steps, questions, options) and courtesy lines ("Want me to fix it?") are cut. The
// result is a list of sections, each a list of units (a paragraph, a top-level list item or a table row).
//
// - investigate: the final answer is the last section that names a suspect (the key's cause or a decoy: its file and
//   one mechanism phrase, in clauses that do not clear it). Success when that section names the cause and no decoy.
//   So a hypothesis list that concludes wrong fails, and so does a list that never concludes.
// - review: the final answer is every section. Success when one unit flags the planted defect (its file, its line or
//   symbol, and a mechanism phrase), no unit flags a decoy (its file and its line or symbol), and at most 3 distinct
//   issues are flagged (issues are counted by diff hunk).
// - plan: the final answer is every section. Success when the judge finds at least 2 of the 3 constraints named and
//   respected and at most 6 constraint-like items named in total. The judge is pluggable (--judge <module>, whose
//   default export is a PlanJudge; the main amendment pins it) and arm-blind (it gets the request, the extracted text
//   and the constraint descriptions, never the arm or the model). Without --judge the deterministic aliasJudge grades:
//   it can only check that constraints are named, so its grades are a declared fallback, and every grade's grader
//   field names the judge that made it.
//
// Clearing: a clause that exonerates a candidate ("is fine", "not the cause", "ruled out", "intentional") does not
// name it. Decoys are also cleared by plain negation and hedges ("might", "could", "I first suspected"); the cause and
// the defect are cleared only by explicit exoneration. A section whose heading exonerates ("Ruled out", "Looks odd but
// is fine") names nothing. Every grade records reply_chars and final_chars.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Family, Hunk, InvestigateKey, Item, KeyRecord, PlanKey, ReviewKey, Spot, Suspect, TaskRecord } from './edition-fixture.ts';

export const GRADER_VERSION = 'edition-grade/1';
export const MAX_REVIEW_ISSUES = 3;
export const MIN_PLAN_CONSTRAINTS = 2;
export const MAX_PLAN_NAMED = 6;

export interface Section { heading: string | null; units: string[] }

const FENCE = /^\s{0,3}(?:```|~~~)/;
const ATX = /^\s{0,3}#{1,6}(?:\s+(.*?))?\s*#*\s*$/;
const SETEXT = /^\s{0,3}(?:=+|-+)\s*$/;
const RULE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:_\s*){3,}|(?:-\s*){3,})$/;
const BOLD_LINE = /^\s{0,3}(?:\*\*|__)([^*_\n]{1,80}?)(?:\*\*|__)\s*:?\s*$/;
const LABEL_LINE = /^\s{0,3}([A-Za-z][A-Za-z0-9 '\/&()-]{0,40}):\s*$/;
const ITEM = /^(\s*)(?:[-*+\u2022]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const FOLLOW_UP = /^(?:next steps?|suggested next steps?|follow[- ]?ups?|open questions?|questions?(?: for you)?|options?|want me to.*|what (?:i|we) can do next|appendix|references?)$/i;
const COURTESY = /^(?:let me know|want me to|would you like|do you want|should i|shall i|i can (?:also )?(?:fix|open|make|write|apply|help|go ahead|implement)|if you(?:'d)? like|happy to|feel free)/i;

/** Markdown markers out, whitespace collapsed: links keep their text, code ticks, bold, emphasis and quote marks go. */
export function strip(s: string): string {
  return s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/`+/g, '')
    .replace(/\*\*/g, '')
    .replace(/(?<![\w/.])__(?=\S)(.+?)(?<=\S)__(?!\w|\.\w)/g, '$1')
    .replace(/(?<![\w/.])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w|\.\w)/g, '$1')
    .replace(/(^|[\s(])\*(?=\S)|(?<=\S)\*(?=[\s).,;:!?]|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function toUnits(lines: string[]): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let kind: 'item' | 'para' | null = null;
  let indent = 0;
  const flush = () => { const u = strip(cur.join(' ')); if (u) out.push(u); cur = []; kind = null; };
  for (const raw of lines) {
    const line = raw.replace(/^(\s*)>+\s?/, '$1');
    if (!line.trim()) { flush(); continue; }
    if (/^\s*\|/.test(line)) { flush(); if (!TABLE_SEP.test(line)) { const u = strip(line.replace(/\|/g, ' ')); if (u) out.push(u); } continue; }
    const m = ITEM.exec(line);
    if (m) {
      if (kind === 'item' && m[1]!.length > indent) { cur.push(m[2]!); continue; }
      flush();
      kind = 'item'; indent = m[1]!.length; cur = [m[2]!];
      continue;
    }
    if (kind === null) kind = 'para';
    cur.push(line.trim());
  }
  flush();
  return out;
}

/** The reply's sections with headings dropped and markers stripped; empty sections are left out. */
export function sections(reply: string): Section[] {
  const raw: Array<{ heading: string | null; lines: string[] }> = [{ heading: null, lines: [] }];
  let fence = false;
  for (const line of reply.replace(/\r\n?/g, '\n').split('\n')) {
    const cur = raw[raw.length - 1]!;
    if (FENCE.test(line)) { fence = !fence; continue; }
    if (fence) { cur.lines.push(line); continue; }
    const prev = cur.lines[cur.lines.length - 1];
    const atx = ATX.exec(line);
    if (atx) { raw.push({ heading: atx[1] ?? '', lines: [] }); continue; }
    if (RULE.test(line) && (prev === undefined || !prev.trim())) { raw.push({ heading: null, lines: [] }); continue; }
    if (SETEXT.test(line) && prev !== undefined && prev.trim() && !ITEM.test(prev)) { cur.lines.pop(); raw.push({ heading: prev, lines: [] }); continue; }
    const label = BOLD_LINE.exec(line) ?? LABEL_LINE.exec(line);
    if (label) { raw.push({ heading: label[1]!, lines: [] }); continue; }
    cur.lines.push(line);
  }
  return raw.map((s) => ({ heading: s.heading === null ? null : strip(s.heading), units: toUnits(s.lines) })).filter((s) => s.units.length);
}

/** The extraction step every grader uses: sections, minus trailing follow-up sections and courtesy lines. */
export function extract(reply: string): Section[] {
  const s = sections(reply).map((x) => ({ heading: x.heading, units: [...x.units] }));
  while (s.length) {
    const last = s[s.length - 1]!;
    while (last.units.length && COURTESY.test(last.units[last.units.length - 1]!)) last.units.pop();
    if (!last.units.length || (s.length > 1 && last.heading !== null && FOLLOW_UP.test(last.heading.replace(/[:.]\s*$/, '')))) { s.pop(); continue; }
    break;
  }
  return s;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
/** A phrase in text, case-insensitive, at word edges where the phrase has word characters. "stem*" matches a prefix. */
export function has(text: string, phrase: string): boolean {
  const prefix = phrase.endsWith('*');
  const p = norm(prefix ? phrase.slice(0, -1) : phrase).trim();
  if (!p) return false;
  const before = /^[\w]/.test(p) ? '(?<![\\w-])' : '';
  const after = !prefix && /[\w]$/.test(p) ? '(?![\\w])' : '';
  return new RegExp(before + escapeRe(p) + after).test(norm(text));
}
const any = (text: string, phrases: readonly string[]) => phrases.some((p) => has(text, p));
const base = (file: string) => file.split('/').pop()!;
const fileNames = (file: string, aliases: readonly string[] = []) => [...new Set([file, base(file), ...aliases])];

const NARROW = new RegExp('\\b(?:' + [
  "not (?:the |a |an )?(?:root |real |actual |likely )?(?:cause|culprit|problem|issue|bug|defect|reason|source|regression)",
  'not (?:responsible|involved|related|relevant|at fault|to blame|why|it)',
  "(?:is|are|was|were|looks?|seems?|appears?|remains?|'s|'re|’s|’re) (?:fine|correct|ok|okay|safe|harmless|benign|intentional|deliberate|right|good|unrelated|irrelevant|innocent|unaffected|as intended)",
  "(?:isn't|wasn't|aren't|weren't|isnt|wasnt) (?:the |a |an )?(?:root |real )?(?:cause|culprit|problem|issue|bug|defect|reason|related|relevant|involved|responsible)",
  'rul(?:ed|es|e|ing) (?:it |this |that |them )?out', 'red herrings?', 'unrelated', 'irrelevant', 'innocent', 'harmless', 'benign', 'exonerat\\w*',
  'by design', 'on purpose', 'intentional(?:ly)?', 'deliberate(?:ly)?', 'false (?:alarm|positive)s?',
  'no (?:issues?|problems?|bugs?|concerns?|effect|impact|change needed|action needed|bearing)', 'nothing (?:wrong|to (?:fix|change|worry))',
  'looks? (?:good|right|fine|correct)', 'not a (?:bug|problem|issue|defect|concern)', 'can be ignored', 'non-issue',
  "(?:doesn't|does not|didn't|did not) (?:matter|affect|explain|cause|break)", 'has nothing to do', 'is a decoy', 'unchanged',
  "(?:don't|do not|didn't|did not) (?:think|believe|suspect)", "(?:it's|it is|this is|that's|that is) not (?:the|it|what|why)\\b",
  "(?:can't|cannot|couldn't|could not) be (?:(?:the |a |an )?(?:root |real |actual |likely )?(?:cause|culprit|problem|issue|bug|defect|reason|source|regression|it)|responsible|involved|related|relevant|at fault|to blame)", 'unlikely', 'no evidence', 'doubt(?:ful)?',
  'leave (?:it|them|that|this|those)(?: alone| as is)?', 'keep (?:it|them|that|this) as is', 'as (?:documented|specified|intended)',
  'match(?:es)? the (?:readme|spec|docs?|documentation|rfc)', '(?:what|as) the (?:readme|spec|docs?|documentation|rfc) (?:describes|says|specifies|documents|requires)', 'per the (?:readme|spec|docs?|rfc)', 'follows? (?:the )?(?:rfc|spec|readme)',
].join('|') + ')\\b', 'i');
const BROAD = /\b(?:not (?:in|from|due to|caused by|because of)|might|could|possibly|perhaps|maybe|suspect(?:ed|s)?|initially|at first|hypothes\w+|alternatively|candidates?|either|whether|(?:also )?(?:checked|looked at|considered)|only (?:affects?|touches|changes))\b/i;
/** A section under one of these headings exonerates everything in it ("Ruled out", "Looks odd but is fine"). */
const EXONERATING = /\b(?:ruled out|not the cause|red herrings?|false leads?|eliminated|non-?issues?|also (?:checked|looked at|considered)|other suspects|what i (?:checked|ruled out)|fine|ok(?:ay)?|correct(?! (?:fix|behaviou?r|approach|version|implementation|solution|value|code))|no (?:issues?|action|change)|non-blocking|not (?:a |an )?(?:bugs?|issues?|problems?|concerns?)|odd but|intentional|deliberate|looks good)\b/i;
const exonerated = (s: Section) => s.heading !== null && EXONERATING.test(s.heading);
/** A section's units with its heading in front of each when the heading names a candidate ("## src/price.js:17"), so a
 *  location given only in the heading still counts for the text under it. */
const headed = (s: Section, candidates: (t: string) => number) => (s.heading && candidates(s.heading) ? s.units.map((u) => s.heading + ': ' + u) : s.units);

interface Part { text: string; clearNarrow: boolean; clearBroad: boolean }

/** A later clause can clear the clause before it only when it points back at it ("but it is fine", "which is
 *  intentional", "but looks correct"), not when it is about something else ("but the rest is fine"). */
const ANAPHOR = /^[\s,:;]*(?:(?:it|this|that|these|those|they|which|both|each|all of (?:them|these|those)|the (?:change|line|code|call|check))\b|(?:is|are|was|were|looks?|seems?|appears?|remains?)\b)/i;
/** A unit's clauses, each marked cleared or not. Sentences split at . ! ? ; and dashes, clauses at but/however/
 *  although/whereas/yet. "rather than X" and "instead of X" clear X, up to the next comma, when X names a candidate;
 *  otherwise they are part of the clause ("should use Math.ceil instead of Math.floor"). A hedged clause naming two or
 *  more candidates ("it could be A, B or C") is a list of possibilities and clears them all. A later clause that clears,
 *  names no candidate of its own and points back with a pronoun ("but it is fine") also clears the clause before it. */
export function clauses(unit: string, candidates: (t: string) => number): Part[] {
  const out: Part[] = [];
  for (const sentence of unit.split(/(?<=[.!?])\s+|;\s*|\s+[\u2014\u2013]\s+|\s+-\s+/)) {
    const ps: Array<Part & { forced: boolean; back: boolean }> = [];
    for (const piece of sentence.split(/\b(?:but|however|whereas|although|though|yet)\b/i)) {
      const rt = /\b(?:rather than|instead of|as opposed to)\b/i.exec(piece);
      let segs = [{ t: piece, forced: false }];
      if (rt) {
        const rest = piece.slice(rt.index), comma = rest.indexOf(',');
        const span = comma >= 0 ? rest.slice(0, comma) : rest;
        if (candidates(span)) segs = [{ t: piece.slice(0, rt.index), forced: false }, { t: span, forced: true }, { t: comma >= 0 ? rest.slice(comma + 1) : '', forced: false }];
      }
      segs.forEach((seg, k) => {
        const t = seg.t.trim();
        if (!t) return;
        const broad = seg.forced || NARROW.test(t) || BROAD.test(t);
        const n = seg.forced || NARROW.test(t) || (broad && candidates(t) >= 2);
        ps.push({ text: t, clearNarrow: n, clearBroad: broad, forced: seg.forced, back: k === 0 && ANAPHOR.test(t) });
      });
    }
    for (let i = ps.length - 1; i > 0; i--) {
      if (ps[i]!.forced || !ps[i]!.back || candidates(ps[i]!.text)) continue;
      if (ps[i]!.clearNarrow) ps[i - 1]!.clearNarrow = true;
      if (ps[i]!.clearBroad) ps[i - 1]!.clearBroad = true;
    }
    out.push(...ps.map(({ forced: _f, back: _b, ...p }) => p));
  }
  return out;
}
const kept = (ps: Part[], strict: boolean) => ps.filter((p) => !(strict ? p.clearBroad : p.clearNarrow)).map((p) => p.text).join(' \n ');

// ---------- investigate ----------

/** The suspects a section names: 'cause' and 'decoy-<i>'. The cause counts unless explicitly exonerated, a decoy
 *  unless negated, hedged or exonerated. File and mechanism may sit in different clauses of the section. */
export function namedSuspects(section: Section, key: InvestigateKey): string[] {
  if (exonerated(section)) return [];
  const all: Array<[string, Suspect, boolean]> = [['cause', key.cause, false], ...key.decoys.map((d, i): [string, Suspect, boolean] => ['decoy-' + i, d, true])];
  const candidates = (t: string) => all.filter(([, s]) => any(t, fileNames(s.file, s.aliases))).length;
  const ps = headed(section, candidates).flatMap((u) => clauses(u, candidates));
  const texts = { strict: kept(ps, true), loose: kept(ps, false) };
  return all.filter(([, s, strict]) => { const t = strict ? texts.strict : texts.loose; return any(t, fileNames(s.file, s.aliases)) && any(t, s.mechanism); }).map(([id]) => id);
}

export interface FamilyGrade { success: boolean; final_text: string; detail: Record<string, unknown> }

/** Conclusion wording: a unit that says what the cause is. */
const CONCLUDES = /\b(?:root cause|the (?:real |actual |underlying )?cause|caused by|culprit|the (?:real |actual )?(?:bug|problem|issue|regression) (?:is|was|lies)|is (?:the |what )?(?:causing|breaking)|in conclusion)\b/i;
/** A source file path in prose: a code or config file extension, with or without folders ("Math.ceil" is not one). */
const FILE = /(?:^|[\s(`'"])[\w.\/-]*\w\.(?:[cm]?[jt]sx?|py|go|rb|rs|java|kt|swift|php|cs|c|h|cc|cpp|hpp|ex|exs|scala|sh|sql|json|ya?ml|toml|ini|cfg|conf|env|md|html|css|scss|vue|svelte|lock)\b(?![\w(])/i;
const lastSuspectUnit = (s: Section, namesSuspect: (t: string) => boolean) => { for (let k = s.units.length - 1; k >= 0; k--) if (namesSuspect(s.units[k]!)) return k; return -1; };

/** The final answer is the last section that names a suspect, and it must name the cause alone. A later unit that
 *  concludes on another file ("the real cause is the missing index in src/database.js") overrides that section, so an
 *  abandoned hypothesis followed by a wrong conclusion fails. */
export function gradeInvestigate(secs: Section[], key: InvestigateKey): FamilyGrade {
  const suspects = [key.cause, ...key.decoys];
  const namesSuspect = (t: string) => suspects.some((s) => any(t, fileNames(s.file, s.aliases)));
  for (let i = secs.length - 1; i >= 0; i--) {
    const named = namedSuspects(secs[i]!, key);
    if (!named.length) continue;
    const later = secs.slice(i).flatMap((s, k) => (k === 0 ? s.units.slice(lastSuspectUnit(s, namesSuspect) + 1) : exonerated(s) ? [] : s.units));
    const elsewhere = later.find((u) => CONCLUDES.test(u) && FILE.test(u) && !namesSuspect(u));
    if (elsewhere) return { success: false, final_text: elsewhere, detail: { section: i, heading: secs[i]!.heading, named, later_conclusion: elsewhere.slice(0, 200) } };
    return { success: named.length === 1 && named[0] === 'cause', final_text: secs[i]!.units.join('\n'), detail: { section: i, heading: secs[i]!.heading, named } };
  }
  return { success: false, final_text: '', detail: { section: null, named: [] } };
}

// ---------- review ----------

const LINE_REFS = [
  /\b(?:lines?|ln)\s*#?(\d{1,5})(?:\s*(?:-|\u2013|to|through|and)\s*(\d{1,5}))?/gi,
  /[\w.\/-]+\.\w+:(\d{1,5})(?:[-:](\d{1,5}))?/g,
  /\bL(\d{1,5})(?:-L?(\d{1,5}))?\b/g,
];
/** Every line or line range a text refers to. */
export function lineRefs(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const re of LINE_REFS) for (const m of text.matchAll(re)) { const a = Number(m[1]), b = m[2] ? Number(m[2]) : a; out.push([Math.min(a, b), Math.max(a, b)]); }
  return out;
}
const SLACK = 2;
const gap = (r: [number, number], s: Spot) => Math.max(0, s.lines[0] - r[1], r[0] - s.lines[1]);
const nearSpot = (r: [number, number], s: Spot) => gap(r, s) <= SLACK;
/** A text locates a spot: it names the spot's file and either one of its symbols or a line near the spot. Given the
 *  key's spots, a line reference counts only for the nearest spot in its file (ties to the earlier spot), unless it
 *  covers the spot, so "lines 10-11" for a defect at line 10 does not also flag a decoy at line 13, but "lines 10-13"
 *  flags both. */
export const locates = (text: string, s: Spot, spots: readonly Spot[] = []) => any(text, fileNames(s.file))
  && (any(text, s.symbols ?? []) || lineRefs(text).some((r) => nearSpot(r, s) && spots.every((o) => o === s || o.file !== s.file || gap(r, s) === 0 || gap(r, s) < gap(r, o) || (gap(r, s) === gap(r, o) && spots.indexOf(s) < spots.indexOf(o)))));
/** Wording that raises a problem. A review issue is counted only from a unit that raises one (or names the defect's
 *  mechanism), so a file overview or a neutral walkthrough line is not an issue. */
const FLAGS = /\b(?:bugs?|buggy|defects?|wrong|incorrect(?:ly)?|broken|breaks?|fails?|failing|errors?|erroneous|issues?|problems?|should(?:n't)?|must|needs? to|off[- ]by[- ]one|missing|leaks?|crash\w*|races?|regressions?|vulnerab\w*|unsafe|risk\w*|concerns?|fix(?:es|ed)?|nits?|blocker|blocking|mistakes?|typos?|flaws?|forgets?|forgot|drops?|ignores?|skips?|never)\b/i;

type ReviewKeyFull = ReviewKey & { diff_files: string[]; hunks: Hunk[] };

export function gradeReview(secs: Section[], key: ReviewKeyFull): FamilyGrade {
  const spots: Array<[string, Spot]> = [['defect', key.defect], ...key.decoys.map((d, i): [string, Spot] => ['decoy-' + i, d])];
  const candidates = (t: string) => key.diff_files.filter((f) => any(t, fileNames(f))).length;
  const hunkOf = (file: string, r: [number, number]) => key.hunks.findIndex((h) => h.file === file && r[0] <= h.end + SLACK && h.start - SLACK <= r[1]);
  const spotHunk = (s: Spot) => key.hunks.findIndex((h) => h.file === s.file && h.start <= s.lines[1] && s.lines[0] <= h.end);
  let defect = false;
  const decoys = new Set<string>();
  const issues = new Set<string>();
  const units = secs.flatMap((s) => s.units);
  const allSpots = spots.map(([, s]) => s);
  for (const u of secs.filter((s) => !exonerated(s)).flatMap((s) => headed(s, candidates))) {
    const ps = clauses(u, candidates);
    const loose = kept(ps, false), strict = kept(ps, true);
    if (locates(loose, key.defect, allSpots) && any(loose, key.defect.mechanism)) defect = true;
    key.decoys.forEach((d, i) => { if (locates(strict, d, allSpots)) decoys.add('decoy-' + i); });
    if (!FLAGS.test(loose) && !any(loose, key.defect.mechanism)) continue;
    for (const f of key.diff_files.filter((f) => any(loose, fileNames(f)))) {
      const ids = [
        ...lineRefs(loose).map((r) => hunkOf(f, r)).filter((h) => h >= 0),
        ...spots.filter(([, s]) => s.file === f && any(loose, s.symbols ?? [])).map(([, s]) => spotHunk(s)),
      ];
      if (ids.length) for (const h of ids) issues.add('hunk-' + h); else issues.add('file:' + f);
    }
  }
  for (const id of [...issues]) if (id.startsWith('file:') && [...issues].some((o) => o.startsWith('hunk-') && key.hunks[Number(o.slice(5))]!.file === id.slice(5))) issues.delete(id);
  const success = defect && decoys.size === 0 && issues.size <= MAX_REVIEW_ISSUES;
  return { success, final_text: units.join('\n'), detail: { defect_flagged: defect, decoys_flagged: [...decoys], issues: [...issues].sort(), issue_count: issues.size } };
}

// ---------- plan ----------

export interface PlanJudgeInput { request: string; final_answer: string; constraints: Array<{ id: string; description: string }> }
/** named: the constraint ids the plan names and respects (aliasJudge: names). named_count: every constraint-like item
 *  the plan names, distractors included. */
export interface PlanJudgement { named: string[]; named_count: number }
/** An arm-blind plan judge. It gets the request, the extracted final answer (headings and markers stripped) and the
 *  constraint descriptions; the key is passed for the deterministic fallback, and a model judge must read only
 *  input. Its model and prompt are pinned in the preregistration's amendment, not here. */
export interface PlanJudge { id: string; judge(input: PlanJudgeInput, key: PlanKey): Promise<PlanJudgement> }

const itemNamed = (text: string, item: Item) => item.all_of.every((group) => any(text, group));
/** The deterministic fallback: a constraint is named when every group of its all_of has a phrase in the text, and
 *  named_count adds the distractors named the same way. */
export const aliasJudge: PlanJudge = {
  id: 'alias-judge/1',
  async judge(input, key) {
    const named = key.constraints.filter((c) => itemNamed(input.final_answer, c)).map((c) => c.id);
    const distractors = key.distractors.filter((d) => itemNamed(input.final_answer, d)).map((d) => d.id);
    return { named, named_count: named.length + distractors.length };
  },
};

export async function gradePlan(secs: Section[], key: PlanKey, request: string, judge: PlanJudge = aliasJudge): Promise<FamilyGrade & { judge: string }> {
  const text = secs.flatMap((s) => s.units).join('\n');
  const j = await judge.judge({ request, final_answer: text, constraints: key.constraints.map(({ id, description }) => ({ id, description })) }, key);
  const named = j.named.filter((id) => key.constraints.some((c) => c.id === id));
  const success = named.length >= MIN_PLAN_CONSTRAINTS && j.named_count <= MAX_PLAN_NAMED;
  return { success, final_text: text, judge: judge.id, detail: { named, named_count: j.named_count } };
}

// ---------- one trial ----------

export interface Grade { trial_id: string; task_id: string; family: Family; success: boolean; reply_chars: number; final_chars: number; grader: string; detail: Record<string, unknown> }

/** Grades one reply against its task's key. The same extraction runs for every arm; nothing here reads the arm. */
export async function gradeReply(trialId: string, taskId: string, reply: string, rec: KeyRecord, request = '', judge: PlanJudge = aliasJudge): Promise<Grade> {
  const secs = extract(reply);
  const head = { trial_id: trialId, task_id: taskId, family: rec.family, reply_chars: reply.length };
  if (rec.family === 'investigate') { const g = gradeInvestigate(secs, rec.key); return { ...head, success: g.success, final_chars: g.final_text.length, grader: GRADER_VERSION, detail: g.detail }; }
  if (rec.family === 'review') { const g = gradeReview(secs, rec.key); return { ...head, success: g.success, final_chars: g.final_text.length, grader: GRADER_VERSION, detail: g.detail }; }
  const g = await gradePlan(secs, rec.key, request, judge);
  return { ...head, success: g.success, final_chars: g.final_text.length, grader: GRADER_VERSION + '+' + g.judge, detail: g.detail };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const [turnsPath, keysPath, tasksPath, judgePath, out] = [flag('--turns'), flag('--keys'), flag('--tasks'), flag('--judge'), flag('--out')];
  if (!turnsPath || !keysPath || !out) { console.error('usage: bun harnesses/qm/gstack/edition-grade.ts --turns <turns.jsonl> --keys <keys.json> [--tasks <tasks.json>] [--judge <module>] --out <grades.jsonl>'); process.exit(2); }
  const judge = (judgePath ? (await import(resolve(judgePath))).default : aliasJudge) as PlanJudge;
  if (typeof judge?.id !== 'string' || typeof judge.judge !== 'function') { console.error('edition-grade: ' + judgePath + ' has no default export with an id and a judge function'); process.exit(2); }
  const keys = JSON.parse(readFileSync(keysPath, 'utf8')) as Record<string, KeyRecord>;
  const requests = new Map(tasksPath ? (JSON.parse(readFileSync(tasksPath, 'utf8')) as TaskRecord[]).map((t) => [t.id, t.request]) : []);
  const turns = readFileSync(turnsPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as { trial_id: string; task_id: string; reply_text?: string });
  const grades: Grade[] = [];
  for (const t of turns) {
    const rec = keys[t.task_id];
    if (!rec) { console.error('edition-grade: no key for task ' + t.task_id + ' (trial ' + t.trial_id + ')'); process.exit(1); }
    grades.push(await gradeReply(t.trial_id, t.task_id, t.reply_text ?? '', rec, requests.get(t.task_id) ?? '', judge));
  }
  writeFileSync(out, grades.map((g) => JSON.stringify(g)).join('\n') + (grades.length ? '\n' : ''));
  console.log('edition-grade: ' + grades.length + ' trials graded with plan judge ' + judge.id + ', ' + grades.filter((g) => g.success).length + ' successes, written to ' + out);
}
