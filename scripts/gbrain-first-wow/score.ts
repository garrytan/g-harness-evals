// Deterministic scoring for the gbrain time-to-first-wow eval. No model judge: every score is a rule over the reply, the
// question session's tool events and the trial's end state (the brain's pages, the fixture's files).
//
// A question passes when its numbered answer names the planted value, its first line that names the value or a decoy names the value
// and no decoy (a decoy named later, to tell the two apart, does not fail it; pilot 2), and the answer cites an auditable reference: a file the
// fixture holds that contains the value and that a tool call in the session read (its output held the value, and its input or output named the
// file), or a gbrain page that the end-state brain holds with the value and that a gbrain call in the session returned (its output held the
// value, and its input or output named the page; PR 2's first-session section, when the transcript records it, counts as such a call). A trial reaches the finish
// line when all three questions pass. Which kinds of reference count in which arm is the plan's reference rule: "any" (the plan's
// recommendation) or "strict", where a gbrain arm must cite a gbrain page. Both are scored and reported.
//
// The no-history persona is scored apart: each answer must say it found no record and must not state a value of the question's
// shape (abstention), and in the gbrain arms the setup or the session must show gbrain's import fallback, matched on the markers the
// plan pins from gbrain's build.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { asksForInput } from '../gbrain-install/classify.ts';
import { hasToken, isGbrainCall, norm, type NEvent } from '../gbrain-install/transcript.ts';
import type { FixtureManifest, PlantedQuestion, QuestionKind } from './fixtures.ts';

export type Arm = 'defaults' | 'pr1' | 'full' | 'plain' | 'qm-native';
export const GBRAIN_ARMS: readonly Arm[] = ['defaults', 'pr1', 'full', 'qm-native'];
export type ReferenceRule = 'any' | 'strict';

export interface BrainPage { slug: string; text: string }

/**
 * The end-state brain from `gbrain export --dir <dir>`, run into a fresh directory at the end of the trial. The export writes each page as
 * Markdown named by its slug, or under an escaped name with a `slug:` line when the slug is not a portable file name, and writes
 * .gbrain-export-status, whose last line is COMPLETE only after a full write. An incomplete export throws: the trial is then an
 * infra_error, never a brain with missing pages. The layout is checked against a real export at the pilot.
 */
export function readBrainExport(dir: string): BrainPage[] {
  const status = join(dir, '.gbrain-export-status');
  const last = existsSync(status) ? readFileSync(status, 'utf8').trim().split('\n').pop()?.trim() : undefined;
  if (last !== 'COMPLETE') throw new Error('gbrain export in ' + dir + ' is not complete (.gbrain-export-status: ' + (last ?? 'missing') + ')');
  const pages: BrainPage[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) {
        const text = readFileSync(p, 'utf8');
        const named = /^slug:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(text);
        pages.push({ slug: named ? named[1]! : relative(dir, p).replace(/\.md$/, ''), text });
      }
    }
  };
  walk(dir);
  return pages.sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
}

export interface TrialInput {
  manifest: FixtureManifest;
  arm: Arm;
  /** The question session's final reply. */
  reply: string;
  /** The question session's normalized tool events (scripts/gbrain-install/transcript.ts). */
  events: NEvent[];
  /** The brain's pages at the end of the trial; empty in the plain arm. */
  brain: BrainPage[];
  /** A HOME-relative file as it stood at the end of the trial, or null. */
  readFile: (homeRelative: string) => string | null;
  /** What the runner captured from the scripted setup (gbrain arms), searched for the import-fallback markers. */
  setupOutput?: string;
  /** The fallback markers the plan pins from gbrain's build (empty until they are pinned). */
  fallbackMarkers?: readonly string[];
  /** Other places the agent saw the HOME, as it may name them (QM plain: the sandbox workspace /root/workspace, or ~/workspace
   *  with the sandbox's HOME at /root). A path under one is read as HOME-relative. */
  fileRoots?: readonly string[];
  /** PR 2's first-session section as the harness transcript recorded it (full arm), counted as a gbrain read of the pages it names. */
  sessionStart?: string;
}

export interface Reference { kind: 'file' | 'page'; ref: string; holds_value: boolean; read_in_session: boolean }

export interface QuestionScore {
  id: PlantedQuestion['id'];
  kind: QuestionKind;
  cross_harness: boolean;
  value_named: boolean;
  decoy_named: boolean;
  superseded_only: boolean;
  correct: boolean;
  references: Reference[];
  file_ref_ok: boolean;
  page_ref_ok: boolean;
  passed_any: boolean;
  passed_strict: boolean;
}

export interface TrialScore {
  persona: FixtureManifest['persona'];
  segmented: boolean;
  questions: QuestionScore[];
  /** All three questions passed, with either kind of reference. */
  finish_any: boolean;
  /** All three passed; in a gbrain arm each by a gbrain page, in the plain arm each by a file. */
  finish_strict: boolean;
  passed_any: number;
  passed_strict: number;
  commands: number;
  gbrain_calls: number;
  closing_asks_for_input: boolean;
}

export interface NoHistoryScore {
  persona: 'no-history';
  segmented: boolean;
  abstained: boolean[];
  fabricated: boolean[];
  correct_abstention: boolean;
  /** null in the plain arm, where there is no gbrain fallback to show. */
  fallback_shown: boolean | null;
  commands: number;
  gbrain_calls: number;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The reply split into its numbered answers 1 to 3, or null when it is not a numbered list holding 1, 2 and 3 in order. */
export function splitAnswers(reply: string): string[] | null {
  const text = norm(reply);
  const re = /^\s{0,3}(?:[-*]\s+)?(?:\*\*|__)?(?:Q(?:uestion)?\s*)?([1-3])(?:\*\*|__)?\s*[.):\]]/gim;
  const marks: Array<{ n: number; at: number }> = [];
  for (let m = re.exec(text); m; m = re.exec(text)) marks.push({ n: Number(m[1]), at: m.index });
  const firsts: Array<{ n: number; at: number }> = [];
  for (const want of [1, 2, 3]) {
    const after = firsts.length ? firsts[firsts.length - 1]!.at : -1;
    const hit = marks.find(x => x.n === want && x.at > after);
    if (!hit) return null;
    firsts.push(hit);
  }
  return firsts.map((x, i) => text.slice(x.at, i < 2 ? firsts[i + 1]!.at : text.length));
}

/** The value as a whole token: ports by digits with no digit beside them, flags exactly (case-insensitive), names as words. */
export function names(text: string, value: string): boolean {
  if (/^\d+$/.test(value)) return new RegExp('(?<!\\d)' + esc(value) + '(?!\\d)').test(text);
  if (/_/.test(value)) return new RegExp('(?<![A-Za-z0-9_])' + esc(value) + '(?![A-Za-z0-9_])', 'i').test(text);
  return hasToken(text, value);
}

/** HOME-relative file paths cited in the text: ~/x, <home>/x, or a bare .claude/, .codex/ or src/ path. Other absolute paths are dropped. */
export function citedFiles(text: string, homeDir: string, roots: readonly string[] = []): string[] {
  const out = new Set<string>();
  const t = roots.reduce((s, r) => s.split(r + '/').join('~/'), norm(text));
  const re = /(?:~\/|\/home\/[A-Za-z0-9._-]+\/|(?<![\w\/.-])(?=\.claude\/|\.codex\/|src\/))[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)+/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const whole = m[0].replace(/[.,;:)]+$/, '');
    const rel = whole.startsWith('~/') ? whole.slice(2) : whole.startsWith(homeDir + '/') ? whole.slice(homeDir.length + 1) : whole.startsWith('/home/') ? null : whole;
    if (rel) out.add(rel);
  }
  return [...out];
}

const fileStem = (rel: string) => rel.split('/').pop()!.replace(/\.jsonl?$/, '');

function scoreQuestion(q: PlantedQuestion, item: string, input: TrialInput): QuestionScore {
  const value = q.answer!;
  const valueNamed = names(item, value);
  const decoyNamed = q.decoys.some(d => names(item, d));
  const lead = item.split('\n').find(l => names(l, value) || q.decoys.some(d => names(l, d))) ?? '';
  const correct = valueNamed && names(lead, value) && !q.decoys.some(d => names(lead, d));
  const refs: Reference[] = [];
  for (const rel of citedFiles(item, input.manifest.home_dir, input.fileRoots)) {
    const body = input.readFile(rel);
    const stem = fileStem(rel);
    refs.push({
      kind: 'file', ref: rel,
      holds_value: body !== null && names(body, value),
      read_in_session: input.events.some(e => e.kind !== 'text' && names(e.output, value) && (e.input.includes(stem) || e.output.includes(stem))),
    });
  }
  for (const page of input.brain) {
    if (!page.slug || !item.includes(page.slug)) continue;
    refs.push({
      kind: 'page', ref: page.slug,
      holds_value: names(page.text, value),
      read_in_session: input.events.some(e => isGbrainCall(e) && names(e.output, value) && (e.input.includes(page.slug) || e.output.includes(page.slug)))
        || (input.sessionStart ?? '').split('\n').some(l => l.includes(page.slug) && names(l, value)),
    });
  }
  const ok = (k: Reference['kind']) => refs.some(r => r.kind === k && r.holds_value && r.read_in_session);
  const fileOk = ok('file'), pageOk = ok('page');
  return {
    id: q.id, kind: q.kind, cross_harness: q.cross_harness,
    value_named: valueNamed, decoy_named: decoyNamed, superseded_only: !!q.superseded && names(item, q.superseded) && !valueNamed, correct,
    references: refs, file_ref_ok: fileOk, page_ref_ok: pageOk,
    passed_any: correct && (fileOk || pageOk),
    passed_strict: correct && (GBRAIN_ARMS.includes(input.arm) ? pageOk : fileOk),
  };
}

const countCommands = (events: NEvent[]) => events.filter(e => e.kind !== 'text').length;
const countGbrain = (events: NEvent[]) => events.filter(isGbrainCall).length;

/** Scores one history-rich or messy trial. An unnumbered reply is scored as one block for every question and flagged unsegmented. */
export function scoreTrial(input: TrialInput): TrialScore {
  const m = input.manifest;
  if (m.persona === 'no-history') throw new Error('scoreTrial: the no-history persona is scored by scoreNoHistory');
  const items = splitAnswers(input.reply);
  const questions = m.questions.map((q, i) => scoreQuestion(q, items ? items[i]! : norm(input.reply), input));
  return {
    persona: m.persona,
    segmented: !!items,
    questions,
    finish_any: questions.every(q => q.passed_any),
    finish_strict: questions.every(q => q.passed_strict),
    passed_any: questions.filter(q => q.passed_any).length,
    passed_strict: questions.filter(q => q.passed_strict).length,
    commands: countCommands(input.events),
    gbrain_calls: countGbrain(input.events),
    closing_asks_for_input: asksForInput(input.reply),
  };
}

/** A statement that no record was found. */
export const ABSTAIN_RE = /\b(could ?n[o']?t (find|verify|confirm|locate)|can ?not find|can'?t find|did ?n[o']?t find|do ?n[o']?t (see|have|find)|no (record|mention|trace|history|notes?|sessions?|prior|previous|past|information|evidence)|nothing (in|about|on)|not (able|found)|unable to (find|locate)|found no|there (is|are) no|I have no)\b/i;
/** A value of the question's shape stated anyway. Provider names have no fixed shape, so only abstention is checked for them. */
export const SHAPE_RE: Record<QuestionKind, RegExp | null> = {
  flag: /\bff_[a-z]+_[a-z]+\b/i,
  port: /(?<![\d.\/-])[1-6]\d{4}(?!\d|\.\d)/,
  vendor: null,
};

/** Scores one no-history trial: abstention on every question, and the import fallback in the gbrain arms. */
export function scoreNoHistory(input: TrialInput): NoHistoryScore {
  const m = input.manifest;
  if (m.persona !== 'no-history') throw new Error('scoreNoHistory: only the no-history persona');
  const items = splitAnswers(input.reply);
  const item = (i: number) => items ? items[i]! : norm(input.reply);
  const fabricated = m.questions.map((q, i) => { const re = SHAPE_RE[q.kind]; return !!re && re.test(item(i)); });
  const abstained = m.questions.map((_, i) => ABSTAIN_RE.test(item(i)) && !fabricated[i]);
  const markers = input.fallbackMarkers ?? [];
  const haystack = [input.setupOutput ?? '', input.reply, ...input.events.map(e => e.output)].join('\n');
  return {
    persona: 'no-history',
    segmented: !!items,
    abstained,
    fabricated,
    correct_abstention: abstained.every(Boolean),
    fallback_shown: GBRAIN_ARMS.includes(input.arm) ? markers.length > 0 && markers.some(x => haystack.includes(x)) : null,
    commands: countCommands(input.events),
    gbrain_calls: countGbrain(input.events),
  };
}
