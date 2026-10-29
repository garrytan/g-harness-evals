// Keyless checks of a generated v0.3 task tree (internal-task). The held-out tasks are never read by a person before they
// are sealed, so these checks are their reviewers and are tested like graders (tests/v03-generators.test.ts).
//
//   bun scripts/v03/check-set.ts --tasks <dir> --world <world.json> --split dev|heldout [--facts <facts.json>] [--log <file>]
//
// For every task: task.toml validates; the oracle passes every predicate, every bot call it makes succeeds and it
// reads the world at least once; each mutation fails exactly the predicate or effect it is named for; mutations
// cover every required predicate and forbidden effect; actors and channels exist in the split and each actor
// belongs to the channel it writes in; no hidden fact occurs in the split's records or the preamble; each expected
// answer can be read by every member of the conversation it lands in; each bait or distractor the task uses sits
// where the requester cannot read it (bait) and in a record the bot can read; each value a reply must not assert is
// asserted by its own source record under the task's guard, so repeating the source does not excuse it. stdout carries V03: lines with opaque
// ids and flag codes only; details go to --log.

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Script } from '../../runner/contracts.ts';
import { gradeTrial } from '../../runner/grade/index.ts';
import { playScript } from '../../runner/grade/play.ts';
import { compileRegex, loadTask, type Task } from '../../runner/grade/task.ts';
import type { World } from '../../world/types.ts';
import { corpusOf, stripI } from './gen-tasks.ts';
import { readersOf, recordText } from './index-facts.ts';
import { insideCheckout } from './paths.ts';
import type { Fact, FactsFile } from './types.ts';

export type Flag =
  | 'PARSE' | 'ORACLE_FAILS' | 'ORACLE_UNAVAILABLE' | 'ORACLE_NO_READ' | 'MUTATION_WRONG' | 'MUTATION_MISSING'
  | 'ACTOR_UNKNOWN' | 'CHANNEL_SCOPE' | 'HIDDEN_IN_CORPUS' | 'ANSWER_NOT_VISIBLE' | 'BAIT_VISIBLE' | 'BAIT_NOT_IN_BRAIN' | 'GUARD_EXCUSES_SOURCE' | 'SPEC_MISSING';

export interface TaskCheck { id: string; flags: Flag[]; details: string[] }

const inSplit = (s: string, split: string) => s === 'both' || s === split;


export async function checkTask(dir: string, worldPath: string, world: World, split: 'dev' | 'heldout', facts: Fact[], preamble: string, corpus: string): Promise<TaskCheck> {
  const id = dir.split('/').filter(Boolean).at(-1)!;
  const out: TaskCheck = { id, flags: [], details: [] };
  const flag = (f: Flag, detail: string) => { if (!out.flags.includes(f)) out.flags.push(f); out.details.push(f + ': ' + detail); };
  let task: Task;
  try { task = loadTask(dir); } catch (e) { flag('PARSE', (e as Error).message); return out; }

  const members = new Set(world.members.map((m) => m.id));
  const channels = world.channels.filter((c) => inSplit(c.split, split));
  for (const a of task.actors) if (!members.has(a)) flag('ACTOR_UNKNOWN', a);
  for (const t of task.turns) {
    if (t.channel === 'dm') continue;
    const ch = channels.find((c) => c.name === t.channel);
    if (!ch || !ch.members.includes(t.actor)) flag('CHANNEL_SCOPE', t.actor + ' in #' + t.channel);
  }
  for (const [k, fact] of Object.entries(task.hidden_facts ?? {})) {
    const needle = fact.toLowerCase().replace(/\s+/g, ' ');
    if (corpus.includes(needle) || preamble.toLowerCase().includes(needle)) flag('HIDDEN_IN_CORPUS', k);
  }

  const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Script;
  try {
    const ev = await playScript(dir, task, read(join(dir, 'oracle.json')), { world, worldPath });
    const g = await gradeTrial(ev, task);
    const failed = g.predicates.filter((p) => !p.passed);
    if (failed.length || g.grade !== 'pass' || g.consent_violation) flag('ORACLE_FAILS', failed.map((p) => p.id + ' ' + p.evidence).join(' | '));
    const notOk = ev.events.filter((e) => e.actor === ev.bot_member && e.outcome !== 'ok');
    if (notOk.length) flag('ORACLE_UNAVAILABLE', notOk.map((e) => e.tool + ' ' + e.outcome).join(', '));
    if (!ev.events.some((e) => e.actor === ev.bot_member && e.kind === 'read')) flag('ORACLE_NO_READ', 'no bot read');
  } catch (e) { flag('ORACLE_FAILS', 'play error ' + (e as Error).message); }

  const mdir = join(dir, 'mutations');
  const files = existsSync(mdir) ? readdirSync(mdir).filter((f) => f.endsWith('.json')).sort() : [];
  const secondary = new Set(task.predicates.secondary ?? []);
  const expected = [...task.predicates.required, ...task.predicates.forbidden_effects].sort();
  const have = files.map((f) => f.replace(/\.json$/, '')).filter((x) => !secondary.has(x)).sort();
  if (JSON.stringify(have) !== JSON.stringify(expected)) flag('MUTATION_MISSING', 'have ' + have.join(',') + ' want ' + expected.join(','));
  for (const f of files) {
    const mid = f.replace(/\.json$/, '');
    try {
      const ev = await playScript(dir, task, read(join(mdir, f)), { world, worldPath });
      const g = await gradeTrial(ev, task);
      const failed = g.predicates.filter((p) => !p.passed).map((p) => p.id);
      const wantFail = secondary.has(mid) ? 'pass' : 'fail';
      if (JSON.stringify(failed) !== JSON.stringify([mid]) || g.grade !== wantFail || g.consent_violation !== task.predicates.forbidden_effects.includes(mid as never)) flag('MUTATION_WRONG', mid + ' failed=' + failed.join(','));
    } catch (e) { flag('MUTATION_WRONG', mid + ' play error ' + (e as Error).message); }
  }

  const specPath = join(dir, 'spec.json');
  if (!existsSync(specPath)) { flag('SPEC_MISSING', 'spec.json'); return out; }
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as { requester: string; facts: string[]; expects: Array<{ predicate: string; turn: number; fact?: string; readers: string[] }> };
  const byId = new Map(facts.map((f) => [f.id, f]));
  for (const e of spec.expects) {
    const turn = task.turns[e.turn - 1];
    const audience = !turn ? [] : turn.channel === 'dm' ? [turn.actor] : (channels.find((c) => c.name === turn.channel)?.members ?? []).filter((m) => m !== 'assistant');
    if (e.fact) {
      const fact = byId.get(e.fact);
      const readers = fact ? readersOf(world, fact) : [];
      const blind = audience.filter((m) => !readers.includes(m));
      if (!fact || blind.length) flag('ANSWER_NOT_VISIBLE', e.predicate + ' unreadable by ' + blind.length + ' member(s) of the conversation');
    }
  }
  for (const fid of spec.facts) {
    const fact = byId.get(fid);
    if (!fact || fact.role === 'answer') continue;
    const readers = readersOf(world, fact);
    if (fact.role === 'bait' && readers.includes(spec.requester)) flag('BAIT_VISIBLE', fid);
    const botVisible = fact.record.kind === 'message'
      ? (() => { const m = world.messages.find((x) => x.id === fact.record.id); return channels.find((c) => c.id === m?.channel)?.kind !== 'dm'; })()
      : fact.record.kind === 'file' && world.files.find((x) => x.id === fact.record.id)?.visibility === 'public';
    if (!botVisible) flag('BAIT_NOT_IN_BRAIN', fid);
  }
  const guards = task.predicate.flatMap((x) => (x.kind === 'reply_not_matches' && x.pattern ? [x.pattern] : []));
  for (const fid of spec.facts) {
    const fact = byId.get(fid);
    const guard = fact && guards.find((x) => x.startsWith('(?i)(?=(?:' + stripI(fact.pattern) + '))'));
    if (!fact || !guard) continue;
    const source = recordText(world, fact);
    if (compileRegex(fact.pattern).test(source) && !compileRegex(guard).test(source)) flag('GUARD_EXCUSES_SOURCE', fid);
  }
  return out;
}

export async function checkSet(tasksDir: string, worldPath: string, split: 'dev' | 'heldout', facts: Fact[]): Promise<TaskCheck[]> {
  const world = JSON.parse(readFileSync(worldPath, 'utf8')) as World;
  const preamble = readFileSync(join(import.meta.dir, '..', '..', 'tasks', 'multiuser', '_shared', 'preamble.md'), 'utf8');
  const corpus = corpusOf(world, split);
  const dirs = readdirSync(tasksDir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(tasksDir, d.name, 'task.toml'))).map((d) => join(tasksDir, d.name)).sort();
  const out: TaskCheck[] = [];
  for (const d of dirs) out.push(await checkTask(d, worldPath, world, split, facts, preamble, corpus));
  return out;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (k: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const split = arg('split') as 'dev' | 'heldout';
  const facts = arg('facts') ? (JSON.parse(readFileSync(arg('facts')!, 'utf8')) as FactsFile).facts : [];
  const log = arg('log');
  if (log && insideCheckout(log)) { console.log('V03: error CHECK-LOG-INSIDE-CHECKOUT'); process.exit(2); }
  if (log) writeFileSync(log, '');
  const results = await checkSet(arg('tasks')!, arg('world')!, split, facts);
  for (const r of results) {
    console.log('V03: task ' + r.id + ' ' + (r.flags.length ? 'FLAG ' + r.flags.join(',') : 'ok'));
    if (log && r.details.length) appendFileSync(log, r.id + '\n  ' + r.details.join('\n  ') + '\n');
  }
  const bad = results.filter((r) => r.flags.length).length;
  console.log('V03: checked tasks=' + results.length + ' flagged=' + bad);
  process.exit(bad ? 1 : 0);
}
