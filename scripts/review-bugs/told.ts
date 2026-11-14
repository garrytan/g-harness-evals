// The told lines for the OpenClaw and Hermes review sessions of the real-bug review eval (internal-task, plan
// handoffs/internal-task/autoplan/plan-full.md, "Arms"). Both come from the gstack-evals review rig, vendored here byte for byte so
// the harness cells are told what the Claude Code and Codex cells are told:
//
// - TOLD_TEMPLATE is gstack-evals src/trial/review/told.ts TOLD_TEMPLATE (garrytan/gstack-evals at 0030e40c, MIT,
//   Copyright (c) 2026 Garry Tan). Its sha256 is pinned: 16862a34..., the #108 template R2 froze. The plain arm's line is the
//   template with {base} filled and no prefix, which is the #108 none told line.
// - R2_REVIEW_PREFIX is gstack-evals wiki/plans/2026-11-03-geva-255-r2-after-pin-amendment/told-gstack-full-rr2.txt (sha256
//   c6334bf7...), R2's full-procedure /review line. The review arm's line is the host's prefix, a space, then the template.
//
// Host adaptation, and only where the host needs it (plan: "adapted only as needed for the host"):
// - OpenClaw: none. gstack registers the skill under the name review, and `openclaw agent exec` turns a leading /review into
//   "Use the following explicitly referenced skills for this request. Read each skill's SKILL.md before acting: - review"
//   ahead of the message (keyless probe, 2026-11-14, OpenClaw 2026.10.6, gstack 4bee369d).
// - Hermes: the command word becomes /gstack-review, the only name gstack registers the skill under on Hermes (frontmatter
//   name gstack-review; Hermes has no skill named review). Nothing else changes. Hermes's one-shot entry does not expand a
//   slash command at all (only the interactive CLI does, cli.py), so the model sees the line as text either way and must open
//   the skill itself through skill_view.
// The rest of the prefix is unchanged on both hosts, including its last sentence about a stop hook, which neither host has:
// rewording it would change the review arm's text against R2's for no reader's benefit.
import { createHash } from 'node:crypto';

export const TOLD_TEMPLATE = [
  'Review the changes on this branch against the base branch {base}: the commits this branch adds since it left {base}, as git diff {base}...HEAD shows them.',
  '',
  'You may write and run throwaway tests, repro scripts and commands, but only under a scratch directory outside this repository (for example one made with mktemp -d). Do not change the code under review, and do not commit or push.',
  '',
  'End your reply with one fenced json block that lists your findings: a JSON array with one object per finding, or [] when you have none. Each object has these fields:',
  '- "file": the path of the file, relative to the repository root',
  '- "line": the line number on this branch, or null',
  '- "severity": the label your review procedure gives the finding',
  '- "claim": what is wrong, in one or two sentences',
  '- "evidence": what shows it, such as the code involved or a command you ran and what it printed',
  '- "confirmed": true or false when your procedure confirms findings by running something; leave it out otherwise',
].join('\n');

export const TOLD_SHA256 = '16862a34212cd2eddbcedbc5654b26cb92b0dad50e3d501686770e6bc3d088ad';

export const R2_REVIEW_PREFIX = '/review Run the full review procedure: dispatch the Review Army specialists your plan selects and run the adversarial pass. Do not make Fix-First edits; report findings only. Writes to gstack\'s own state (its learnings, timeline and review log) are allowed. If a stop hook blocks your reply, end your next reply again with the complete fenced json block.';

/** sha256 of told-gstack-full-rr2.txt, which ends in one newline the prefix itself does not carry. */
export const R2_PREFIX_FILE_SHA256 = 'c6334bf77190ad4db057100d5e3e0b1ee27b454215739474e89a5e0cc7c93482';

export type ReviewHarness = 'openclaw' | 'hermes';
export type ReviewArm = 'plain' | 'review';
export const REVIEW_HARNESSES: readonly ReviewHarness[] = ['openclaw', 'hermes'];
export const REVIEW_ARMS: readonly ReviewArm[] = ['plain', 'review'];

/** The skill command word each host's review arm opens with. */
export const HOST_COMMAND: Readonly<Record<ReviewHarness, string>> = { openclaw: '/review', hermes: '/gstack-review' };

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** The review arm's prefix on a host: R2's line with its command word replaced by the host's. */
export function reviewPrefix(harness: ReviewHarness): string {
  return HOST_COMMAND[harness] + R2_REVIEW_PREFIX.slice('/review'.length);
}

/** The whole told text for one arm on one host, {base} filled. A base name with whitespace or a control character is refused. */
export function toldText(arm: ReviewArm, harness: ReviewHarness, base: string): string {
  if (!/^[\w./-]+$/.test(base)) throw new Error('base branch name ' + JSON.stringify(base) + ' must be letters, digits and . _ / -');
  const text = TOLD_TEMPLATE.replaceAll('{base}', base);
  return arm === 'plain' ? text : reviewPrefix(harness) + ' ' + text;
}

/** What arm.json records about the told line of one arm on one host. */
export function toldRecord(arm: ReviewArm, harness: ReviewHarness) {
  const prefix = arm === 'plain' ? '' : reviewPrefix(harness);
  return { arm, harness, prefix, prefix_sha256: prefix ? sha256(prefix) : null, template_sha256: sha256(TOLD_TEMPLATE), r2_prefix_file_sha256: arm === 'plain' ? null : R2_PREFIX_FILE_SHA256, adapted: prefix !== '' && prefix !== R2_REVIEW_PREFIX };
}
