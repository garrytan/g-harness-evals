// Item overlap between two generated v0.3 trees: a fresh draw shares the dev fact pool and the six templates with
// the first draw, so its overlap with that draw is measured and reported (tasks/multiuser/v0.3/dev-draw-2/README.md).
// Reads only the task directories; no model is called.
//
//   bun scripts/v03/overlap.ts --tasks <dir> --against <dir>
//
// Prints JSON: for each task of --tasks, the --against tasks with the same id, a byte-identical directory, the same
// family and hidden facts (and of those, the same requester), the same family and expected answer values, or any hidden
// fact in common; then the counts.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO_ROOT } from './paths.ts';

interface Spec { id: string; family: string; requester: string; facts: string[]; expects: Array<{ value: string }> }
interface Loaded { id: string; spec: Spec; bytes: string }

function filesOf(dir: string, base = dir, out: Array<[string, string]> = []): Array<[string, string]> {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) filesOf(p, base, out);
    else out.push([relative(base, p), readFileSync(p, 'utf8')]);
  }
  return out;
}

const load = (root: string): Loaded[] => readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory()).sort()
  .map((id) => ({ id, spec: JSON.parse(readFileSync(join(root, id, 'spec.json'), 'utf8')) as Spec, bytes: JSON.stringify(filesOf(join(root, id))) }));

const key = (xs: string[]) => [...xs].sort().join('\0');

export function overlap(tasksDir: string, againstDir: string) {
  const mine = load(tasksDir), theirs = load(againstDir);
  const perTask = mine.map((t) => {
    const ids = (f: (o: Loaded) => boolean) => theirs.filter(f).map((o) => o.id);
    const answers = key(t.spec.expects.map((e) => e.value));
    return {
      id: t.id,
      family: t.spec.family,
      facts: t.spec.facts,
      same_id: theirs.some((o) => o.id === t.id),
      identical: ids((o) => o.bytes === t.bytes),
      same_family_and_facts: t.spec.facts.length ? ids((o) => o.spec.family === t.spec.family && key(o.spec.facts) === key(t.spec.facts)) : [],
      same_family_and_answers: t.spec.expects.length ? ids((o) => o.spec.family === t.spec.family && key(o.spec.expects.map((e) => e.value)) === answers) : [],
      same_item_and_requester: t.spec.facts.length ? ids((o) => o.spec.family === t.spec.family && key(o.spec.facts) === key(t.spec.facts) && o.spec.requester === t.spec.requester) : [],
      shares_a_fact: ids((o) => o.spec.facts.some((f) => t.spec.facts.includes(f))),
    };
  });
  const factsMine = new Set(mine.flatMap((t) => t.spec.facts)), factsTheirs = new Set(theirs.flatMap((t) => t.spec.facts));
  const count = (f: (t: (typeof perTask)[number]) => boolean) => perTask.filter(f).length;
  return {
    tasks: relative(REPO_ROOT, tasksDir),
    against: relative(REPO_ROOT, againstDir),
    n_tasks: mine.length,
    n_against: theirs.length,
    same_id: count((t) => t.same_id),
    identical: count((t) => t.identical.length > 0),
    fact_backed: count((t) => t.facts.length > 0),
    same_family_and_facts: count((t) => t.same_family_and_facts.length > 0),
    same_family_and_answers: count((t) => t.same_family_and_answers.length > 0),
    repeated_item: count((t) => t.same_family_and_facts.length > 0 || t.same_family_and_answers.length > 0),
    repeated_item_same_requester: count((t) => t.same_item_and_requester.length > 0),
    shares_a_fact: count((t) => t.shares_a_fact.length > 0),
    facts_used: factsMine.size,
    facts_used_against: factsTheirs.size,
    facts_in_common: [...factsMine].filter((f) => factsTheirs.has(f)).length,
    per_task: perTask,
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (k: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const tasks = arg('tasks'), against = arg('against');
  if (!tasks || !against) { console.error('usage: bun scripts/v03/overlap.ts --tasks <dir> --against <dir>'); process.exit(2); }
  console.log(JSON.stringify(overlap(tasks, against), null, 2));
}
