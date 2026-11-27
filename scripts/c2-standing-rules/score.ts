// Scoring for the C2 standing-rules eval (docs/benchmarks/2026-12-c2-standing-rules/PREREGISTRATION.md), by rule only: no
// model judge. applied() reads session 2's out.md against the item's expect and reject strings; partRan() reads what the trial
// left to say whether the arm's part under test happened (the save in session 1, the owner's approval, the section in session
// 2). Nothing here calls a model or reads a key.

import type { Item } from './items.ts';
import { type NEvent, gbrainArgvFromShell, mcpToolName } from '../gbrain-install/transcript.ts';

/** Words that, within NEGATION_WINDOW words before a reject match, mark it as the old value being denied, not used. */
export const NEGATION_WORDS: readonly string[] = ['not', 'never', 'no longer', 'rather than', 'instead of', 'formerly', 'former', 'previously', "n't", 'ex-'];
export const NEGATION_WINDOW = 6;
/** The first line of gbrain's standing-rules section (src/core/rules/section.ts HEADER). */
export const SECTION_MARKER = 'Standing rules (data:';

/** Lower case, straight quotes, one space, and no thousands commas (`$95,000` reads as `$95000`). */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/\s+/g, ' ').trim();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A pattern for one expect or reject entry: a letter or digit at either end must not touch another letter or digit there. */
export function entryPattern(entry: string): RegExp {
  const e = normalize(entry);
  const pre = /^[a-z0-9]/.test(e) ? '(?<![a-z0-9])' : '';
  const post = /[a-z0-9]$/.test(e) ? '(?![a-z0-9])' : '';
  return new RegExp(pre + esc(e) + post, 'g');
}

/** Whether a negation word ends within the NEGATION_WINDOW words before position `at` of normalized text. */
export function negatedAt(text: string, at: number): boolean {
  const before = text.slice(0, at).split(' ').filter(Boolean).slice(-NEGATION_WINDOW).join(' ');
  return NEGATION_WORDS.some((w) => (w.endsWith('-') || w.startsWith("n'") ? before.includes(w) : new RegExp('(?<![a-z0-9])' + esc(w) + '(?![a-z0-9])').test(before)));
}

export interface AppliedScore {
  applied: boolean;
  /** out.md was there and not empty. */
  answered: boolean;
  missing: string[][];
  /** Reject entries found outside a negation window, with the words before them. */
  rejected: Array<{ entry: string; context: string }>;
  /** Reject entries found only inside a negation window. */
  negated: string[];
}

/** The primary outcome: every expect group matched and no reject entry outside a negation window, case-insensitive. */
export function applied(item: Pick<Item, 'expect' | 'reject'>, out: string | null): AppliedScore {
  const text = normalize(out ?? '');
  const missing = item.expect.filter((g) => !g.some((e) => entryPattern(e).test(text)));
  const rejected: AppliedScore['rejected'] = [];
  const negated: string[] = [];
  for (const entry of item.reject) {
    const hits = [...text.matchAll(entryPattern(entry))];
    if (!hits.length) continue;
    const bare = hits.filter((m) => !negatedAt(text, m.index!));
    if (bare.length) rejected.push({ entry, context: text.slice(Math.max(0, bare[0]!.index! - 60), bare[0]!.index! + entry.length + 20) });
    else negated.push(entry);
  }
  const answered = text.length > 0;
  return { applied: answered && !missing.length && !rejected.length, answered, missing, rejected, negated };
}

/** The gbrain operations a session called, in order: each gbrain MCP tool, and each gbrain CLI command run in a shell
 *  (an agent's CLI call carries its harness's agent marker, so gbrain treats it as the agent's own call). */
export function gbrainOps(events: readonly NEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.kind === 'mcp') { const t = mcpToolName(e.name); if (t && /^gbrain/i.test(t.server)) out.push(t.tool.toLowerCase()); }
    else if (e.kind === 'shell') for (const argv of gbrainArgvFromShell(e.input)) if (argv[0]) out.push(argv[0].toLowerCase());
  }
  return out;
}

/** gbrain operations that read the brain, for the secondary "did session 2 look" count. */
export const READ_OPS: ReadonlySet<string> = new Set(['search', 'query', 'recall', 'get_page', 'context_pack', 'get', 'list_pages', 'find', 'think', 'ask', 'profile']);

export interface RuleRow { id: string; status: string; revision: string; confirmed: boolean; rule: string; corrects?: string | null }
/** gbrain rules list --json, or [] when it did not parse. */
export function parseRules(stdout: string): RuleRow[] {
  try { const r = (JSON.parse(stdout) as { rules?: RuleRow[] }).rules; return Array.isArray(r) ? r : []; } catch { return []; }
}

export interface PartRan {
  /** gbrain operations session 1 called, in order. */
  s1_ops: string[];
  saved_with: 'correct' | 'remember' | 'both' | 'none';
  /** A rule session 1 saved is active after it (the correct call committed). */
  rule_active: boolean;
  /** Rules and control arms: the owner's approval left every rule it targeted active and confirmed. */
  approved: boolean | null;
  /** Session 2's transcript holds the section's first line. */
  section_seen: boolean;
  /** gbrain read operations session 2 called. */
  s2_reads: number;
  /** The rules and control arms' part ran in full: saved with correct and approved, and the section reached session 2 (rules)
   *  or stayed out of it (control, where rules.session_start is off). */
  rules_path_ran: boolean | null;
}

/** The rules the owner approves after session 1: every one session 1 left active or proposed and not yet confirmed. */
export function approvalTargets(rules: readonly RuleRow[]): RuleRow[] {
  return rules.filter((x) => (x.status === 'active' || x.status === 'proposed') && !x.confirmed);
}

/** Session 1's first reply used the planted wrong value (a reject entry outside a negation window). Null for ways of working,
 *  whose session-1 question differs from the probe, and for items with no reject entries. */
export function s1ShowedMistake(item: Pick<Item, 'kind' | 'expect' | 'reject'>, reply: string | null): boolean | null {
  if (item.kind === 'practice' || !item.reject.length) return null;
  return applied(item, reply).rejected.length > 0;
}

export function partRan(o: { arm: 'rules' | 'control' | 'remember' | 'floor'; s1Ops: string[]; s2Ops: string[]; rulesAfterS1: RuleRow[]; rulesAfterApproval: RuleRow[] | null; sectionSeen: boolean }): PartRan {
  const c = o.s1Ops.includes('correct'), r = o.s1Ops.includes('remember');
  const saved_with = c && r ? 'both' : c ? 'correct' : r ? 'remember' : 'none';
  const rule_active = o.rulesAfterS1.some((x) => x.status === 'active');
  const withRule = o.arm === 'rules' || o.arm === 'control';
  const targets = approvalTargets(o.rulesAfterS1);
  const approved = withRule ? targets.length > 0 && targets.every((t) => (o.rulesAfterApproval ?? []).some((x) => x.id === t.id && x.status === 'active' && x.confirmed)) : null;
  return { s1_ops: o.s1Ops, saved_with, rule_active, approved, section_seen: o.sectionSeen, s2_reads: o.s2Ops.filter((x) => READ_OPS.has(x)).length,
    rules_path_ran: withRule ? (saved_with === 'correct' || saved_with === 'both') && approved === true && o.sectionSeen === (o.arm === 'rules') : null };
}

export interface C2Score {
  item: number; kind: Item['kind']; arm: 'rules' | 'control' | 'remember' | 'floor';
  /** Session 1's first reply used the planted wrong value (s1ShowedMistake); null where that cannot be read. */
  s1_mistake: boolean | null;
  s2: AppliedScore;
  part: PartRan;
}
