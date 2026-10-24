// Parse and validate a multi-user task.toml (docs/tasks.md). Every error names the file and the field so an
// author can fix it without reading this code.

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';

export const FAMILIES = ['scope_isolation', 'shared_channel', 'org_security', 'handoff', 'scheduled', 'continuity', 'synthesis', 'corrections', 'approval_relay'] as const;
export type Family = (typeof FAMILIES)[number];

export const PREDICATE_KINDS = [
  'reply_matches', 'reply_not_matches', 'message_posted', 'no_message_posted', 'no_cross_scope_reads', 'event', 'no_event',
  'approval_requested', 'no_write_before', 'calendar_created', 'draft_created', 'digest_posted', 'custom',
] as const;
export type PredicateKind = (typeof PREDICATE_KINDS)[number];

/** Effect classes the grader can observe in this world. external_mail: a mail draft addressed outside
 *  pemberline.com. finance_disclosure: a finance figure (the task's [finance] pattern) posted or drafted where
 *  someone outside [finance].allowed can read it. */
export const EFFECT_CLASSES = ['external_mail', 'finance_disclosure'] as const;
export type EffectClass = (typeof EFFECT_CLASSES)[number];

/** Patterns are JavaScript regular expressions; a leading `(?i)` means case-insensitive, as in the docs. */
export function compileRegex(pattern: string): RegExp {
  return pattern.startsWith('(?i)') ? new RegExp(pattern.slice(4), 'i') : new RegExp(pattern);
}

const memberId = z.string().regex(/^[a-z][a-z0-9-]*$/, 'member ids are lower-case kebab-case, for example dana-okafor');
const regexString = z.string().min(1).refine((s) => { try { compileRegex(s); return true; } catch { return false; } }, 'not a valid regular expression');
const turnRef = z.number().int().min(1);

const base = { id: z.string().min(1), kind: z.enum(PREDICATE_KINDS), capability: z.string().min(1).optional() };

const predicateSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('reply_matches'), turn: turnRef, pattern: regexString }).strict(),
  z.object({ ...base, kind: z.literal('reply_not_matches'), turn: turnRef.optional(), turns: z.array(turnRef).min(1).optional(), pattern: regexString.optional(), hidden_fact: z.string().min(1).optional() }).strict()
    .refine((p) => (p.turn === undefined) !== (p.turns === undefined), 'give exactly one of "turn" or "turns"')
    .refine((p) => (p.pattern === undefined) !== (p.hidden_fact === undefined), 'give exactly one of "pattern" or "hidden_fact"'),
  z.object({ ...base, kind: z.literal('message_posted'), channel: z.string().min(1), pattern: regexString, after_turn: turnRef.optional(), by: memberId.optional() }).strict(),
  z.object({ ...base, kind: z.literal('no_message_posted'), channel: z.string().min(1), pattern: regexString.optional(), before_turn: turnRef.optional() }).strict(),
  z.object({ ...base, kind: z.literal('no_cross_scope_reads'), turns: z.array(turnRef).min(1) }).strict(),
  z.object({ ...base, kind: z.literal('event'), tool: z.string().min(1), turn: turnRef.optional(), args_match: z.record(z.string(), regexString).optional(), outcome: z.enum(['ok', 'denied', 'error']).optional() }).strict(),
  z.object({ ...base, kind: z.literal('no_event'), tool: z.string().min(1), turn: turnRef.optional(), args_match: z.record(z.string(), regexString).optional(), outcome: z.enum(['ok', 'denied', 'error']).optional() }).strict(),
  z.object({ ...base, kind: z.literal('approval_requested'), turn: turnRef, action_pattern: regexString, authorization: z.union([memberId, z.array(memberId).min(1)]), asked_in: z.enum(['dm', 'thread']).optional() }).strict(),
  z.object({ ...base, kind: z.literal('no_write_before'), turn: turnRef, tools: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ ...base, kind: z.literal('calendar_created'), turn: turnRef, title_pattern: regexString, attendees: z.array(memberId).min(1), start: z.string().min(1).optional() }).strict(),
  z.object({ ...base, kind: z.literal('draft_created'), turn: turnRef, to: z.string().min(1), pattern: regexString, only_recipients: z.array(z.string().min(1)).min(1).optional() }).strict(),
  z.object({ ...base, kind: z.literal('digest_posted'), channel: z.string().min(1), after_sim_ts: z.string().min(1), pattern: regexString, sources: z.array(z.string().min(1)).min(1), not_pattern: regexString.optional() }).strict(),
  z.object({ ...base, kind: z.literal('custom'), module: z.string().min(1) }).strict(),
]);

export type Predicate = z.infer<typeof predicateSchema>;

const turnSchema = z.object({
  actor: memberId,
  channel: z.string().min(1),
  text: z.string().min(1),
  advance_clock_s: z.number().int().min(0).optional(),
  wait_s: z.number().int().min(0).max(120).optional(),
}).strict();

const taskSchema = z.object({
  id: z.string().regex(/^[a-z]{2}-\d{2}-[a-z0-9-]+$/, 'ids look like si-01-north-renewal'),
  slice: z.literal('multiuser'),
  family: z.enum(FAMILIES),
  split: z.enum(['dev', 'heldout']),
  title: z.string().min(1),
  time_budget_s: z.number().int().positive(),
  actors: z.array(memberId).min(1),
  hidden_facts: z.record(z.string(), z.string().min(1)).optional(),
  turns: z.array(turnSchema).min(1),
  predicates: z.object({ required: z.array(z.string().min(1)).min(1), forbidden_effects: z.array(z.enum(EFFECT_CLASSES)), secondary: z.array(z.string().min(1)).optional() }).strict(),
  predicate: z.array(predicateSchema).min(1),
  finance: z.object({ pattern: regexString, allowed: z.array(memberId).min(1) }).strict().optional(),
}).strict();

export type Task = z.infer<typeof taskSchema>;
export type Turn = z.infer<typeof turnSchema>;

export class TaskError extends Error {
  constructor(readonly file: string, readonly problems: string[]) {
    super(`${file}:\n  ${problems.join('\n  ')}`);
  }
}

function pathText(path: PropertyKey[]): string {
  return path.map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join('') || '(root)';
}

/** Parse task.toml text. `file` is only used in error messages. */
export function parseTask(text: string, file = 'task.toml'): Task {
  let raw: unknown;
  try {
    raw = Bun.TOML.parse(text);
  } catch (e) {
    throw new TaskError(file, [`TOML syntax: ${(e as Error).message}`]);
  }
  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => {
      const where = pathText(i.path);
      const kind = (raw as { predicate?: { kind?: string; id?: string }[] })?.predicate?.[i.path[1] as number];
      const label = i.path[0] === 'predicate' && kind ? `predicate "${kind.id ?? '?'}" (kind ${kind.kind ?? '?'}): ${pathText(i.path.slice(2))}` : where;
      return `${label}: ${i.message}`;
    });
    throw new TaskError(file, problems);
  }
  const task = parsed.data;
  const problems: string[] = [];
  const ids = new Map<string, number>();
  task.predicate.forEach((p, i) => {
    if (ids.has(p.id)) problems.push(`predicate[${i}].id: "${p.id}" is also predicate[${ids.get(p.id)}].id`);
    ids.set(p.id, i);
  });
  for (const id of task.predicates.required) if (!ids.has(id)) problems.push(`predicates.required: "${id}" is not the id of any [[predicate]]`);
  for (const id of task.predicates.secondary ?? []) {
    if (!ids.has(id)) problems.push(`predicates.secondary: "${id}" is not the id of any [[predicate]]`);
    if (task.predicates.required.includes(id)) problems.push(`predicates.secondary: "${id}" is also in predicates.required; a predicate is one or the other`);
  }
  for (const p of task.predicate) if (!task.predicates.required.includes(p.id) && !task.predicates.secondary?.includes(p.id)) problems.push(`predicate "${p.id}": defined but not listed in predicates.required or predicates.secondary`);
  const nTurns = task.turns.length;
  const checkTurn = (p: Predicate, field: string, n: number | undefined) => {
    if (n !== undefined && n > nTurns) problems.push(`predicate "${p.id}": ${field} = ${n} but the task has ${nTurns} turn(s)`);
  };
  for (const p of task.predicate) {
    if ('turn' in p) checkTurn(p, 'turn', p.turn);
    if ('turns' in p && p.turns) for (const t of p.turns) checkTurn(p, 'turns', t);
    if ('after_turn' in p) checkTurn(p, 'after_turn', p.after_turn);
    if ('before_turn' in p) checkTurn(p, 'before_turn', p.before_turn);
    if (p.kind === 'reply_not_matches' && p.hidden_fact && !task.hidden_facts?.[p.hidden_fact]) problems.push(`predicate "${p.id}": hidden_fact "${p.hidden_fact}" is not a key of [hidden_facts]`);
    if (p.kind === 'digest_posted' && p.capability !== 'scheduler') problems.push(`predicate "${p.id}": digest_posted must declare capability = "scheduler"`);
    if (p.kind === 'digest_posted' && Number.isNaN(Date.parse(p.after_sim_ts))) problems.push(`predicate "${p.id}": after_sim_ts "${p.after_sim_ts}" is not an ISO-8601 instant`);
    if (p.kind === 'calendar_created' && p.start && Number.isNaN(Date.parse(p.start))) problems.push(`predicate "${p.id}": start "${p.start}" is not an ISO-8601 instant`);
  }
  task.turns.forEach((t, i) => {
    if (!task.actors.includes(t.actor)) problems.push(`turns[${i}].actor: "${t.actor}" is not in actors`);
  });
  const wantsFinance = task.predicates.forbidden_effects.includes('finance_disclosure');
  if (wantsFinance && !task.finance) problems.push('predicates.forbidden_effects names finance_disclosure but there is no [finance] table (pattern, allowed)');
  if (!wantsFinance && task.finance) problems.push('[finance] is set but finance_disclosure is not in predicates.forbidden_effects');
  if (problems.length) throw new TaskError(file, problems);
  return task;
}

/** Read and validate <dir>/task.toml; the id must equal the directory name. */
export function loadTask(dir: string): Task {
  const file = join(dir, 'task.toml');
  if (!existsSync(file)) throw new TaskError(file, ['file not found']);
  const task = parseTask(readFileSync(file, 'utf8'), file);
  if (task.id !== basename(dir)) throw new TaskError(file, [`id: "${task.id}" does not match the directory name "${basename(dir)}"`]);
  return task;
}
