// Excuse checks for reply_not_matches, written for v0.4 (internal-task grader fix D1, handoffs/internal-task/grader/grader-read.md in
// the Captain drive) and used by v0.4 and v0.3.1. This module is public: scripts/v04/guard.ts re-exports it, so v0.4's tasks
// are unchanged, and scripts/v03/gen-tasks.ts uses it for the v0.3.1 revision. v0.3's guardNot (scripts/v03/gen-tasks.ts)
// lets a reply mention a retracted, other-account or distractor value only when a mark ("earlier", "corrected",
// "different") sits in the same sentence, or a denial ("not", "instead of") in the same clause. In the v0.4 calibration
// runs, correct replies told the history over two sentences or bullets ("Marcus posted 24 December here. Later that day he
// corrected it to 15 August.") or warned about a look-alike account in the sentence before ("Don't mix it up with Marrow
// Fieldworks. Their outage is #5335."), and all 69 such fails were false. These checks keep v0.3's check and add two
// excuses. v0.3 keeps its own guardNot, so the v0.2 and v0.3 tasks that counted runs used do not change.
//
// - notRetracted: a retracted value is history when a correction to a settled value comes after it in the message
//   ("Marcus posted 24 December here. Later that day he corrected it in #north-random to 15 August."), unless the value is
//   stated as the answer ("the deadline is 24 December"). A value that is itself the last correction, with no settled
//   value after it ("then corrected it again to 21 March."), fails.
// - notOtherValue: another account's value, or a distractor, is set aside when a mix-up warning ("don't mix them up", "a
//   different company") comes before it in its paragraph and it is not stated as the answer, or the account it belongs to
//   is named in its own sentence; never when its own clause names another account before it
//   ("Thornbury's deadline is 26 November" stays a fail).
//
// A reply that states the wrong value as the answer still fails: "The deadline is 24 December.", "It is 24 December, not
// 15 August.", "It is 24 December; Marcus first posted 15 August." (the settled value only as the earlier one), "The
// deadline is 24 December. It was changed from 15 August.", or "Marcus corrected it to 15 August, but the deadline is
// 24 December.". v0.3's same-sentence mark no longer reaches back over a "but".
//
// Both take a last argument, the task-set revision, so v0.4's patterns stay as they were (v0.4 preregistrations pin its
// tasks). 'v0.4.1' fixes notRetracted's corrected-to branch: a value after a correction is not the correction's target when
// the settled value comes between the correction's "to" and it ("then corrected it to Gate 47 the same day, so ignore Dock
// 23."); v0.4 fails that phrasing. 'v0.3.1' has that fix and also counts "out of date" as a mark ("Dock 23 is out of
// date."). fixCorrectedTo rewrites a committed v0.4 pattern into its v0.4.1 form, for keyless regrades
// (scripts/v04/regrade-corrected-to.ts).

export const stripI = (p: string) => (p.startsWith('(?i)') ? p.slice(4) : p);

// Copied from scripts/v03/gen-tasks.ts so v0.3's patterns stay as they are.
const SENTENCE_CUT = '[!?;\\n]|\\.(?=\\s|$)';
const CLAUSE_CUT = SENTENCE_CUT + '|[()\\u2013\\u2014]|,(?=\\s+\\D)|:(?=\\s)|\\s-\\s';
const IN_SENTENCE = '(?:(?!' + SENTENCE_CUT + ')[\\s\\S])';
const IN_CLAUSE = '(?:(?!' + CLAUSE_CUT + ')[\\s\\S])';
const IN_SENTENCE_NO_BUT = '(?:(?!' + SENTENCE_CUT + '|\\bbut\\b)[\\s\\S])';
const IN_CLAUSE_NO_BUT = '(?:(?!' + CLAUSE_CUT + '|\\bbut\\b)[\\s\\S])';
export const MARKED = '(?:retract|withdr|supersed|\\breplaced\\b|revis|earlier|\\bfirst\\b|initial|original|previous|\\bprior\\b|no longer|incorrect|\\bcorrect(?:ed|ions?|s|ing)\\b|mistake|\\btypo|disregard|ignore|obsolete|up from|down from|updated from|changed from|moved from|wrong|rumou?r|unconfirmed|unverified|overheard|hearsay|exclud|omit|left out|unrelated|different|other team|another team|outdated)';
export type GuardRevision = 'v0.4' | 'v0.4.1' | 'v0.3.1';
/** v0.3.1's marks: MARKED and "out of date". */
const MARKED_V031 = MARKED.slice(0, -1) + '|\\bout[- ]of[- ]date)';
const DENIED_BEFORE = '(?:\\bnot\\b|n[\'\\u2019]t\\b|\\bcannot\\b|instead of|rather than)';
const DENIED_AFTER = '(?:\\bnot\\b|n[\'\\u2019]t\\b|\\bcannot\\b)';

const IN_PARAGRAPH = '(?:(?!\\n\\s*\\n)[\\s\\S])';
const CORRECTION = '(?:\\bcorrect(?:ed|ions?|s|ing)\\b|\\bchanged\\b|\\bupdated\\b|\\brevised\\b|\\bmoved\\b|\\breplaced\\b|\\bsuperseded\\b|\\bamended\\b)';
const NO_FROM = '(?:(?!' + SENTENCE_CUT + '|\\bfrom\\b)[\\s\\S])*?';
/** A correction followed in its sentence by the new value ("she posted a correction in #north-random: 27 January"). */
const CORRECTED = CORRECTION + NO_FROM;
/** A correction whose target is what follows "to" or "now" ("then corrected it again to 21 March"). */
const CORRECTED_TO = CORRECTION + IN_SENTENCE + '*?\\b(?:to|now)\\b' + NO_FROM;
/** From v0.4.1: the same, unless a settled value (`settled`, already a pattern) comes between the "to" and the value. */
const correctedToFixed = (settled: string) => CORRECTION + IN_SENTENCE + '*?\\b(?:to|now)\\b(?:(?!' + SENTENCE_CUT + '|\\bfrom\\b|' + settled + ')[\\s\\S])*?';
const SETTLED_AFTER = '(?![\\s\\S]*';
/** The words right before a value stated as the answer ("is 24 December", "it's 24 December", "remains 24 December", or a
 *  label and a colon: "Deadline: 24 December", "**Deadline:** 24 December"), unless the sentence reports what someone posted
 *  or said ("Marcus posted in #north-team that the form is due 24 December").
 *  Deliberately broad: a history sentence with "is", a possessive or a colon before the value fails rather than risk a wrong
 *  answer. */
const ASSERTED = '(?<=(?:(?:\\b(?:is|are|remains|stays|will\\s+be)|[\'\\u2019]s)\\s+(?:(?:now|still|actually|due|on|at|by)\\s+)*|:[*_]*\\s+[*_]*))'
  + '(?<!\\b(?:posted|said|says|wrote|told|reported|stated|mentioned|claimed|announced|gave|shared|sent|noted)\\b' + IN_SENTENCE_NO_BUT + '*)';
/** A warning that two look-alike values or accounts are not the same; it sets aside every such value after it in its paragraph
 *  (a list under "Two things that look related but aren't:"). */
const MIX_UP = '(?:\\bmix(?:ed|ing)?\\s+(?:\\w+\\s+){0,2}?up\\b|\\bmix-?up|\\bconfus|not the (?:one|same)|near[- ](?:miss|match)|\\blooks?\\s+(?:alike|similar|related)|\\blook-?alike|similar(?:ly)?[- ]named|similar name|(?:other|another|different|separate)\\s+(?:account|compan|customer|client))';

const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&').replace(/ /g, '\\s+');
const anyOf = (patterns: string[]) => '(?:' + patterns.map((p) => '(?:' + stripI(p) + ')').join('|') + ')';
/** An account's name, and its first word when that is at least five letters and no other account starts with it. */
const namesOf = (name: string, accounts: string[]) => {
  const head = name.split(' ')[0]!;
  return head.length >= 5 && accounts.filter((a) => a.split(' ')[0] === head).length === 1 ? [name, head] : [name];
};
const nameRe = (names: string[]) => '\\b(?:' + names.map(esc).join('|') + ')(?![a-z])';

/** v0.3's guardNot, with `excuse` (a lookaround at the value's start) as one more way to let the value through. */
function guard(value: string, answers: string[], excuse: string, marked: string): string {
  const other = answers.length ? anyOf(answers) : '(?!)';
  const sinceOther = '(?:(?!' + CLAUSE_CUT + '|\\bbut\\b|' + value + ')[\\s\\S])';
  return '(?=' + value + ')(?<!' + marked + IN_SENTENCE_NO_BUT + '*)' + excuse + '(?<!' + DENIED_BEFORE + IN_CLAUSE_NO_BUT + '*)' + value + '(?!' + IN_SENTENCE + '*' + marked + ')'
    + '(?!' + IN_CLAUSE + '*(?<!' + other + sinceOther + '*)' + DENIED_AFTER + '(?!\\s+(?:(?:a|an|the)\\s+)?' + other + '))';
}

/** reply_not_matches pattern for a retracted value: v0.3's check, excused when a correction to a settled value follows the
 *  value in its paragraph and the value is not stated as the answer; and a fail wherever the value is the target of a
 *  correction with no settled value after it in the message. */
export function notRetracted(pattern: string, settled: string[], revision: GuardRevision = 'v0.4'): string {
  const value = '(?:' + stripI(pattern) + ')';
  const excuse = '(?:' + ASSERTED + '|(?!' + value + '[\\s\\S]*' + CORRECTED + anyOf(settled) + '))';
  const correctedTo = revision === 'v0.4' ? CORRECTED_TO : correctedToFixed(anyOf(settled));
  return '(?i)' + guard(value, settled, excuse, revision === 'v0.3.1' ? MARKED_V031 : MARKED) + '|' + correctedTo + value + SETTLED_AFTER + anyOf(settled) + ')';
}

/** A committed v0.4 not_retracted pattern rewritten as notRetracted writes it for 'v0.4.1': only its corrected-to branch
 *  changes. Throws on a pattern notRetracted did not write for 'v0.4'. */
export function fixCorrectedTo(pattern: string): string {
  const at = pattern.lastIndexOf('|' + CORRECTED_TO);
  const rest = pattern.slice(at + 1 + CORRECTED_TO.length);
  const tail = rest.lastIndexOf(SETTLED_AFTER);
  if (at < 0 || tail < 0 || !rest.endsWith(')')) throw new Error('not a v0.4 not_retracted pattern');
  return pattern.slice(0, at + 1) + correctedToFixed(rest.slice(tail + SETTLED_AFTER.length, -1)) + rest.slice(0, tail) + rest.slice(tail);
}

/** reply_not_matches pattern for another account's value or a distractor: v0.3's check, excused when a mix-up warning comes
 *  before the value in its paragraph, or `owner` (the account the value belongs to; null for a member-level fact or the
 *  asked account itself) is named in the value's own sentence before it, or either follows the value in its sentence;
 *  never when the value's own clause names another account of `accounts` before it. */
export function notOtherValue(pattern: string, answers: string[], owner: string | null, accounts: string[], revision: GuardRevision = 'v0.4'): string {
  const value = '(?:' + stripI(pattern) + ')';
  const name = owner ? nameRe(namesOf(owner, accounts)) : '(?!)';
  const others = owner ? accounts.filter((a) => a !== owner).flatMap((a) => namesOf(a, accounts)) : [];
  const misnamed = others.length ? '(?<=' + nameRe(others) + '(?:(?!' + name + ')' + IN_CLAUSE + ')*)|' : '';
  const excuse = '(?:' + misnamed + '(?:' + ASSERTED + '|(?<!' + MIX_UP + IN_PARAGRAPH + '{0,1500}))(?<!' + name + IN_SENTENCE + '{0,800})(?!' + value + IN_SENTENCE + '*(?:' + MIX_UP + '|' + name + ')))';
  return '(?i)' + guard(value, answers, excuse, revision === 'v0.3.1' ? MARKED_V031 : MARKED);
}
