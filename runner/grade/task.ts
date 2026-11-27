// Parse and validate a multi-user task.toml (docs/tasks.md). Every error names the file and the field so an
// author can fix it without reading this code.

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { lifecycleProblems } from '../contracts.ts';

export const FAMILIES = ['scope_isolation', 'shared_channel', 'org_security', 'handoff', 'scheduled', 'continuity', 'synthesis', 'corrections', 'approval_relay', 'product_probe',
  'expired_recall', 'memory_scope', 'session_synthesis', 'retired_record', 'week'] as const;
export type Family = (typeof FAMILIES)[number];

export const PREDICATE_KINDS = [
  'reply_matches', 'reply_not_matches', 'message_posted', 'no_message_posted', 'no_cross_scope_reads', 'event', 'no_event',
  'approval_requested', 'no_write_before', 'calendar_created', 'draft_created', 'digest_posted', 'custom',
  'told_by', 'timer_set', 'max_bot_posts', 'no_repeat_posts',
  'fact_readable_at_ask', 'relay_private',
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
const isoInstant = z.string().refine((s) => /T\d\d:\d\d/.test(s) && Number.isFinite(Date.parse(s)), 'an ISO-8601 instant with a time, for example 2026-10-15T09:15:00-05:00');

const base = { id: z.string().min(1), kind: z.enum(PREDICATE_KINDS), capability: z.string().min(1).optional() };

const predicateSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('reply_matches'), turn: turnRef, pattern: regexString }).strict(),
  z.object({ ...base, kind: z.literal('reply_not_matches'), turn: turnRef.optional(), turns: z.array(turnRef).min(1).optional(), pattern: regexString.optional(), hidden_fact: z.string().min(1).optional() }).strict()
    .refine((p) => (p.turn === undefined) !== (p.turns === undefined), 'give exactly one of "turn" or "turns"')
    .refine((p) => (p.pattern === undefined) !== (p.hidden_fact === undefined), 'give exactly one of "pattern" or "hidden_fact"'),
  z.object({ ...base, kind: z.literal('message_posted'), channel: z.string().min(1), pattern: regexString, after_turn: turnRef.optional(), by: memberId.optional() }).strict(),
  z.object({ ...base, kind: z.literal('no_message_posted'), channel: z.string().min(1), pattern: regexString.optional(), before_turn: turnRef.optional() }).strict(),
  z.object({ ...base, kind: z.literal('no_cross_scope_reads'), turns: z.array(turnRef).min(1) }).strict(),
  z.object({ ...base, kind: z.literal('event'), tool: z.string().min(1), turn: turnRef.optional(), args_match: z.record(z.string(), regexString).optional(), outcome: z.enum(['ok', 'denied', 'error']).optional(), recipients_outside: z.array(memberId).min(1).optional() }).strict(),
  z.object({ ...base, kind: z.literal('no_event'), tool: z.string().min(1), turn: turnRef.optional(), args_match: z.record(z.string(), regexString).optional(), outcome: z.enum(['ok', 'denied', 'error']).optional(), recipients_outside: z.array(memberId).min(1).optional(), allow_request_repeat: z.literal(true).optional() }).strict(),
  z.object({ ...base, kind: z.literal('approval_requested'), turn: turnRef, action_pattern: regexString, authorization: z.union([memberId, z.array(memberId).min(1)]), asked_in: z.enum(['dm', 'thread']).optional() }).strict(),
  z.object({ ...base, kind: z.literal('no_write_before'), turn: turnRef, tools: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ ...base, kind: z.literal('calendar_created'), turn: turnRef, title_pattern: regexString, attendees: z.array(memberId).min(1), start: z.string().min(1).optional() }).strict(),
  z.object({ ...base, kind: z.literal('draft_created'), turn: turnRef, to: z.string().min(1), pattern: regexString, only_recipients: z.array(z.string().min(1)).min(1).optional() }).strict(),
  z.object({ ...base, kind: z.literal('digest_posted'), channel: z.string().min(1), after_sim_ts: z.string().min(1), pattern: regexString, sources: z.array(z.string().min(1)).min(1), not_pattern: regexString.optional() }).strict(),
  z.object({ ...base, kind: z.literal('custom'), module: z.string().min(1) }).strict(),
  /** Week events (docs/tasks.md): the bot told a conversation something by a simulated time; a timer was set with a due time
   *  in range; the bot posted at most max messages; no two bot posts in one conversation repeat each other. */
  z.object({ ...base, kind: z.literal('told_by'), channel: z.string().min(1), pattern: regexString, by_sim_ts: isoInstant, after_sim_ts: isoInstant.optional() }).strict(),
  z.object({ ...base, kind: z.literal('timer_set'), turns: z.array(turnRef).min(1).optional(), due_after: isoInstant, due_before: isoInstant, reason_pattern: regexString.optional() }).strict(),
  z.object({ ...base, kind: z.literal('max_bot_posts'), channel: z.string().min(1).optional(), max: z.number().int().min(0) }).strict(),
  z.object({ ...base, kind: z.literal('no_repeat_posts'), channel: z.string().min(1).optional(), threshold: z.number().gt(0).max(1).optional() }).strict(),
  z.object({ ...base, kind: z.literal('fact_readable_at_ask'), needed: z.array(z.number().int().min(0)).min(1).optional() }).strict(),
  /** A fact one member asked the bot to relay to another stays in their two DMs: no bot post anywhere else matches pattern. */
  z.object({ ...base, kind: z.literal('relay_private'), pattern: regexString, allowed: z.array(z.string().min(1)).min(1) }).strict(),
]);

export type Predicate = z.infer<typeof predicateSchema>;

const turnSchema = z.object({
  actor: memberId,
  channel: z.string().min(1),
  text: z.string().min(1),
  advance_clock_s: z.number().int().min(0).optional(),
  wait_s: z.number().int().min(0).max(120).optional(),
  /** internal-task: "new" posts the actor's message as a new thread root, hands the harness thread_ts = that ts, and posts
   *  the bot's reply in the thread; every adapter opens a new session for it (docs/tasks.md). */
  thread: z.literal('new').optional(),
  /** v0.4 (internal-task): before this turn the runner expires every message inside these earlier turns' windows (runner/contracts.ts,
   *  lifecycleProblems for the shape rules). */
  expire_turns: z.array(z.number()).optional(),
  /** Week events ([clock] timers tasks only, docs/tasks.md "Week events"). */
  burst: z.array(z.object({ actor: memberId.optional(), text: z.string().min(1) }).strict()).min(1).optional(),
  redeliver: z.literal(true).optional(),
  restart_before: z.literal(true).optional(),
}).strict();

/** v0.4 (internal-task): one [[mechanism.needed]] entry (MechanismFact in runner/contracts.ts). Values are checked by lifecycleProblems,
 *  whose problems never quote them. */
const neededFactSchema = z.object({ turn: z.number().optional(), slug: z.string().optional(), pattern: z.string(), consumer_turn: z.number() }).strict();

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
  finance: z.object({ pattern: regexString, allowed: z.array(memberId).min(1), allow_request_repeat: z.literal(true).optional() }).strict().optional(),
  /** v0.3 (internal-task): the turn whose post carries the fact a later turn needs, and for a correction the turn it
   *  supersedes; read by scripts/v03/mechanism.ts, never graded. */
  mechanism: z.object({ needed_turn: turnRef.optional(), superseded_turn: turnRef.optional(), needed: z.array(neededFactSchema).optional() }).strict()
    .refine((m) => m.needed_turn !== undefined || m.needed !== undefined, 'give needed_turn (v0.3) or [[mechanism.needed]] (v0.4)').optional(),
  /** v0.4 (internal-task): seed records the trial's world hides from every read surface, by corpus slug. */
  world: z.object({ retire: z.array(z.string()) }).strict().optional(),
  /** Agent-set timers on the simulation clock (docs/tasks.md, "Timers"): the world offers timer_set, timer_list and
   *  timer_cancel, and the runner delivers each timer as a turn when the clock passes it; end_advance_s moves the clock once
   *  more after the last turn so timers due then fire too. expire_turns never hides a message posted in a timer turn. */
  clock: z.object({ timers: z.literal(true), end_advance_s: z.number().int().min(0).optional() }).strict().optional(),
}).strict().refine((t) => !!t.clock || !t.turns.some((x) => x.burst || x.redeliver || x.restart_before), 'burst, redeliver and restart_before need [clock] timers = true')
  .refine((t) => !t.turns.some((x) => x.channel === 'dm' && x.burst?.some((b) => b.actor !== undefined && b.actor !== x.actor)), "a DM burst comes from the turn's own actor")
  .refine((t) => !t.turns.some((x) => x.burst?.some((b) => b.actor !== undefined && !t.actors.includes(b.actor))), 'every burst actor is in actors');

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
  problems.push(...lifecycleProblems(task));
  for (const p of task.predicate) {
    if (p.kind !== 'fact_readable_at_ask') continue;
    if (!task.predicates.secondary?.includes(p.id)) problems.push(`predicate "${p.id}": fact_readable_at_ask never grades; list it in predicates.secondary`);
    if (!task.mechanism?.needed) problems.push(`predicate "${p.id}": fact_readable_at_ask reads the [[mechanism.needed]] facts and the task has none`);
    for (const i of p.needed ?? []) if (i >= (task.mechanism?.needed?.length ?? 0)) problems.push(`predicate "${p.id}": needed = ${i} but [[mechanism.needed]] has ${task.mechanism?.needed?.length ?? 0} fact(s)`);
  }
  if (task.mechanism) {
    for (const [field, n] of [['needed_turn', task.mechanism.needed_turn], ['superseded_turn', task.mechanism.superseded_turn]] as const) {
      if (n !== undefined && n > nTurns) problems.push(`mechanism.${field} = ${n} but the task has ${nTurns} turn(s)`);
    }
    if (task.mechanism.superseded_turn !== undefined && task.mechanism.superseded_turn === task.mechanism.needed_turn) problems.push('mechanism.superseded_turn equals needed_turn');
  }
  const wantsFinance = task.predicates.forbidden_effects.includes('finance_disclosure');
  if (wantsFinance && !task.finance) problems.push('predicates.forbidden_effects names finance_disclosure but there is no [finance] table (pattern, allowed)');
  if (!wantsFinance && task.finance) problems.push('[finance] is set but finance_disclosure is not in predicates.forbidden_effects');
  if (problems.length) throw new TaskError(file, problems);
  return task;
}

export const REPO_TASK_KINDS = ['fix', 'review', 'qa', 'ship'] as const;

/** The kind of the repo task in <dir> (its task.toml's kind, one of REPO_TASK_KINDS, internal-task). The TOML parser's message
 *  is withheld, since it can quote a sealed task. */
export function repoTaskKind(dir: string): string {
  const file = join(dir, 'task.toml');
  if (!existsSync(file)) throw new TaskError(file, ['file not found']);
  let kind: unknown;
  try { kind = (Bun.TOML.parse(readFileSync(file, 'utf8')) as { kind?: unknown }).kind; } catch { throw new TaskError(file, ['TOML syntax error (the parser\'s message is withheld, since it can quote a sealed task)']); }
  if (typeof kind !== 'string' || !(REPO_TASK_KINDS as readonly string[]).includes(kind)) throw new TaskError(file, [`kind: a repo task names its kind (${REPO_TASK_KINDS.join(', ')})`]);
  return kind;
}

/** The family an owner-identity task names (internal-task: owner_identity_I, _L or _C). Such a task has gold.json beside its
 *  task.toml and no predicates, so loadTask's schema does not take it; runner/trial/trial.ts grades it from its store. */
const OWNER_IDENTITY_FAMILY = /^owner_identity_[ILC]$/;

/** The family the report scripts (summarize-run.ts, compare-run.ts) count a task under: a repo task's kind (a task.toml
 *  under tasks/repo/<set>/<split>/<task>/ has a kind and no family, internal-task), an owner-identity task's family (gold.json
 *  beside it), else loadTask's family. */
export function taskFamily(dir: string): string {
  if (/(^|\/)tasks\/repo\/[^/]+\/[^/]+\/[^/]+\/?$/.test(dir)) return repoTaskKind(dir);
  if (existsSync(join(dir, 'gold.json'))) {
    const file = join(dir, 'task.toml');
    let family: unknown;
    try { family = (Bun.TOML.parse(readFileSync(file, 'utf8')) as { family?: unknown }).family; } catch { throw new TaskError(file, ['TOML syntax error (the parser\'s message is withheld, since it can quote a sealed task)']); }
    if (typeof family !== 'string' || !OWNER_IDENTITY_FAMILY.test(family)) throw new TaskError(file, ['family: an owner-identity task (gold.json beside task.toml) is owner_identity_I, owner_identity_L or owner_identity_C']);
    return family;
  }
  return loadTask(dir).family;
}

/** Read and validate <dir>/task.toml; the id must equal the directory name. */
export function loadTask(dir: string): Task {
  const file = join(dir, 'task.toml');
  if (!existsSync(file)) throw new TaskError(file, ['file not found']);
  const task = parseTask(readFileSync(file, 'utf8'), file);
  if (task.id !== basename(dir)) throw new TaskError(file, [`id: "${task.id}" does not match the directory name "${basename(dir)}"`]);
  return task;
}
