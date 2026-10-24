// A multi-user task as the runner reads it: task.toml (schema in docs/tasks.md) and the shared preamble the
// prompt for every turn is composed from. Parsing uses Bun's built-in TOML parser; no dependency.

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PREAMBLE_PLACEHOLDERS } from '../contracts.ts';
import { RunnerError } from '../errors.ts';

export interface TaskTurn {
  actor: string;
  /** "dm" for the actor's DM with the bot, else a channel name. */
  channel: string;
  text: string;
  advance_clock_s?: number;
  wait_s?: number;
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
  /** The directory task.toml was read from. */
  dir: string;
}

export const DEFAULT_PREAMBLE_PATH = join('tasks', 'multiuser', '_shared', 'preamble.md');

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

export function loadPreamble(path = DEFAULT_PREAMBLE_PATH): string {
  if (!existsSync(path)) throw new RunnerError('HE-TASK-002', `preamble not found at ${path}; fix: add tasks/multiuser/_shared/preamble.md (docs/tasks.md) or pass --preamble <file>`);
  const text = readFileSync(path, 'utf8');
  const unknown = [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!).filter((n) => !(PREAMBLE_PLACEHOLDERS as readonly string[]).includes(n));
  if (unknown.length) throw new RunnerError('HE-TASK-003', `${basename(path)} uses placeholders the runner does not fill: ${[...new Set(unknown)].join(', ')}; the known set is ${PREAMBLE_PLACEHOLDERS.join(', ')} (runner/contracts.ts)`);
  return text;
}

export type PreambleValues = Record<(typeof PREAMBLE_PLACEHOLDERS)[number], string>;

export function composePrompt(preamble: string, values: PreambleValues): string {
  return preamble.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => values[name as keyof PreambleValues] ?? '');
}
