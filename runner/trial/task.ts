// A multi-user task as the runner reads it: task.toml (schema in docs/tasks.md) and the shared preamble the
// prompt for every turn is composed from. Parsing uses Bun's built-in TOML parser; no dependency.

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { lifecycleProblems, PREAMBLE_PLACEHOLDERS } from '../contracts.ts';
import { RunnerError } from '../errors.ts';

export interface TaskTurn {
  actor: string;
  /** "dm" for the actor's DM with the bot, else a channel name. */
  channel: string;
  text: string;
  advance_clock_s?: number;
  wait_s?: number;
  /** "new": the turn opens a new thread, and a new harness session (docs/tasks.md). */
  thread?: 'new';
  /** v0.4 (internal-task): earlier turns whose windows the runner expires before this turn (runner/contracts.ts, expiryWindows). */
  expire_turns?: number[];
  /** Week events ([clock] timers tasks only, docs/tasks.md "Week events"): messages posted in the same conversation just before
   *  this turn's own message, with no turn of their own; actor defaults to the turn's actor. */
  burst?: Array<{ actor?: string; text: string }>;
  /** Week events: after the answer, hand the same message again as a retry (retry_attempt 1). */
  redeliver?: true;
  /** Week events: stop the harness and start it again on the same workspace and state before this turn. */
  restart_before?: true;
}

export interface TaskSpec {
  id: string;
  slice: string;
  family?: string;
  split: 'dev' | 'heldout';
  title?: string;
  time_budget_s: number;
  actors: string[];
  hidden_facts: Record<string, string>;
  turns: TaskTurn[];
  predicates: { required: string[]; forbidden_effects: string[] };
  predicate: Array<Record<string, unknown>>;
  /** v0.4 (internal-task): seed records the trial's world hides from every read surface, by corpus slug ([world] retire). */
  world?: { retire?: string[] };
  /** Agent-set timers on the simulation clock (docs/tasks.md, "Timers"); absent, the trial runs exactly as before. */
  clock?: { timers: true; end_advance_s?: number };
  /** The directory task.toml was read from. */
  dir: string;
}

export const DEFAULT_PREAMBLE_PATH = join('tasks', 'multiuser', '_shared', 'preamble.md');
/** internal-task: preamble.md with rule 2's 2026-11-09 exception (the member who told you may have it passed to a person they name,
 *  within rule 3). The default for a cell on a v0.3.1 task set; every other cell keeps preamble.md, so no committed
 *  preregistration resolves to different bytes (tests/prereg-preamble-digests.test.ts). */
export const V031_PREAMBLE_PATH = join('tasks', 'multiuser', '_shared', 'preamble.v031.md');

/** The preamble a cell reads when it names none. */
export const defaultPreambleFor = (taskSet: string | undefined): string => (/^v0\.3\.1(\/|$)/.test(taskSet ?? '') ? V031_PREAMBLE_PATH : DEFAULT_PREAMBLE_PATH);

export function loadTask(dir: string): TaskSpec {
  const file = join(dir, 'task.toml');
  if (!existsSync(file)) throw new RunnerError('HE-TASK-001', `no task.toml in ${dir}; fix: name a task directory under tasks/multiuser/[<task_set>/]<split>/ (docs/tasks.md)`);
  let raw: Record<string, unknown>;
  try { raw = Bun.TOML.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; }
  catch (e) { throw new RunnerError('HE-TASK-001', `${file} is not valid TOML: ${(e as Error).message}`); }
  const turns = Array.isArray(raw.turns) ? raw.turns as TaskTurn[] : [];
  const problems: string[] = [];
  if (typeof raw.id !== 'string') problems.push('id');
  if (!Array.isArray(raw.actors) || !raw.actors.length) problems.push('actors');
  if (!turns.length) problems.push('turns');
  turns.forEach((t, i) => {
    if (typeof t.actor !== 'string' || typeof t.channel !== 'string' || typeof t.text !== 'string') problems.push(`turns[${i}] needs actor, channel and text`);
    if (t.advance_clock_s !== undefined && !(Number(t.advance_clock_s) >= 0)) problems.push(`turns[${i}].advance_clock_s`);
    if (t.wait_s !== undefined && !(Number(t.wait_s) >= 0)) problems.push(`turns[${i}].wait_s`);
    if (t.thread !== undefined && t.thread !== 'new') problems.push(`turns[${i}].thread (only "new" is defined)`);
  });
  if (turns.length) problems.push(...lifecycleProblems({ turns, world: raw.world as { retire?: unknown } | undefined, mechanism: raw.mechanism as { needed?: unknown } | undefined }));
  const clock = raw.clock as { timers?: unknown; end_advance_s?: unknown } | undefined;
  if (clock !== undefined) {
    if (clock.timers !== true) problems.push('clock.timers (only true is defined)');
    if (clock.end_advance_s !== undefined && !(Number(clock.end_advance_s) >= 0)) problems.push('clock.end_advance_s');
  }
  turns.forEach((t, i) => {
    if (t.burst === undefined && t.redeliver === undefined && t.restart_before === undefined) return;
    if (clock?.timers !== true) problems.push(`turns[${i}]: burst, redeliver and restart_before need [clock] timers = true`);
    if (t.redeliver !== undefined && t.redeliver !== true) problems.push(`turns[${i}].redeliver (only true is defined)`);
    if (t.restart_before !== undefined && t.restart_before !== true) problems.push(`turns[${i}].restart_before (only true is defined)`);
    if (t.burst !== undefined && (!Array.isArray(t.burst) || !t.burst.length || t.burst.some((b) => typeof b?.text !== 'string' || !b.text || (b.actor !== undefined && typeof b.actor !== 'string')))) problems.push(`turns[${i}].burst needs one or more { text, actor? }`);
    else if (t.burst && t.channel === 'dm' && t.burst.some((b) => b.actor !== undefined && b.actor !== t.actor)) problems.push(`turns[${i}].burst: a DM burst comes from the turn's own actor`);
    else if (t.burst?.some((b) => b.actor !== undefined && !(Array.isArray(raw.actors) && raw.actors.includes(b.actor)))) problems.push(`turns[${i}].burst: every burst actor is in actors`);
  });
  const budget = Number(raw.time_budget_s ?? 0);
  if (!(budget > 0)) problems.push('time_budget_s');
  if (problems.length) throw new RunnerError('HE-TASK-001', `${file} is missing or malformed: ${problems.join(', ')}; schema in docs/tasks.md`);
  const predicates = (raw.predicates ?? {}) as { required?: string[]; forbidden_effects?: string[] };
  return {
    id: raw.id as string,
    slice: String(raw.slice ?? 'multiuser'),
    family: typeof raw.family === 'string' ? raw.family : undefined,
    split: (raw.split === 'heldout' ? 'heldout' : 'dev'),
    title: typeof raw.title === 'string' ? raw.title : undefined,
    time_budget_s: budget,
    actors: raw.actors as string[],
    hidden_facts: (raw.hidden_facts ?? {}) as Record<string, string>,
    turns,
    predicates: { required: predicates.required ?? [], forbidden_effects: predicates.forbidden_effects ?? [] },
    predicate: Array.isArray(raw.predicate) ? raw.predicate as Array<Record<string, unknown>> : [],
    ...(raw.world ? { world: raw.world as { retire?: string[] } } : {}),
    ...(clock ? { clock: { timers: true as const, ...(clock.end_advance_s !== undefined ? { end_advance_s: Number(clock.end_advance_s) } : {}) } } : {}),
    dir,
  };
}

/** Turn count straight from task.toml, for manifest pricing; 0 when the file is absent so the caller can refuse. */
export function taskTurnCount(dir: string): number {
  const file = join(dir, 'task.toml');
  if (!existsSync(file)) return 0;
  try { return ((Bun.TOML.parse(readFileSync(file, 'utf8')) as { turns?: unknown[] }).turns ?? []).length; }
  catch { return 0; }
}

/** True when task.toml turns timers on ([clock] timers = true); false when absent or unreadable. */
export function taskHasTimers(dir: string): boolean {
  try { return (Bun.TOML.parse(readFileSync(join(dir, 'task.toml'), 'utf8')) as { clock?: { timers?: unknown } }).clock?.timers === true; }
  catch { return false; }
}

/** harnesses/clock-capabilities.json: the harnesses tests/timer-turn-adapters.test.ts certifies for timer turns. */
export const CLOCK_CAPABILITIES_PATH = join(import.meta.dir, '..', '..', 'harnesses', 'clock-capabilities.json');
export function timerTurnsCertified(harness: string): boolean {
  const caps = JSON.parse(readFileSync(CLOCK_CAPABILITIES_PATH, 'utf8')) as { harnesses: Record<string, { timer_turns?: string }> };
  return caps.harnesses[harness]?.timer_turns === 'certified';
}

export function loadPreamble(path = DEFAULT_PREAMBLE_PATH): string {
  if (!existsSync(path)) throw new RunnerError('HE-TASK-002', `preamble not found at ${path}; fix: add tasks/multiuser/_shared/preamble.md (docs/tasks.md) or pass --preamble <file>`);
  const text = readFileSync(path, 'utf8');
  const unknown = [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!).filter((n) => !(PREAMBLE_PLACEHOLDERS as readonly string[]).includes(n));
  if (unknown.length) throw new RunnerError('HE-TASK-003', `${basename(path)} uses placeholders the runner does not fill: ${[...new Set(unknown)].join(', ')}; the known set is ${PREAMBLE_PLACEHOLDERS.join(', ')} (runner/contracts.ts)`);
  return text;
}

export type PreambleValues = Record<(typeof PREAMBLE_PLACEHOLDERS)[number], string>;

/** The prompt of a timer turn ([clock] timers): tasks/multiuser/_shared/timer.md, filled with the timer_* values and the
 *  originating turn's requester and conversation. */
export const TIMER_PROMPT_PATH = join(import.meta.dir, '..', '..', 'tasks', 'multiuser', '_shared', 'timer.md');

export function composePrompt(preamble: string, values: PreambleValues): string {
  return preamble.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => values[name as keyof PreambleValues] ?? '');
}
