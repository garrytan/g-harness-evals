/**
 * Headroom: which tasks can tell arms apart.
 *
 * A task can't tell two arms apart when both arms passed it on every scored try, or both failed it on every scored
 * try: whatever the arms do differently, that task scores the same in both. A run's headroom is the per-task, per-arm
 * pass table with each task tagged, and how many tasks are left that can tell arms apart. A comparison's headroom is the
 * same count for its two arms, plus the most the tasks left could move the pass rate in each direction.
 *
 * The gate: a "no worse than" or "better than" call is refused, and reads "can't tell: no room to improve" with the
 * counts, when fewer than the minimum number of the comparison's tasks are ones the run can tell apart, or when on those
 * tasks the reference arm leaves less room than the smallest difference the preregistration named (docs/methods.md,
 * "Headroom").
 */

export const NO_ROOM = "can't tell: no room to improve";

export type TaskTag = 'every_arm_passed' | 'every_arm_failed' | 'can_tell_apart';

export interface RunHeadroom {
  arms: Array<{ arm: string; passes: number; tries: number; pass_rate: number | null }>;
  tasks: Array<{ task: string; tag: TaskTag; arms: Record<string, { passes: number; tries: number }> }>;
  counts: { tasks: number; every_arm_passed: number; every_arm_failed: number; can_tell_apart: number };
}

/** The per-task, per-arm table of one run, from its scored tries (pass 1 or 0). Arms and tasks keep first-seen order. The tags agree with runCanTellApart. */
export function runHeadroom(tries: ReadonlyArray<{ arm: string; task: string; pass: 0 | 1 }>): RunHeadroom {
  const arms: string[] = [];
  const tasks: string[] = [];
  const cells = new Map<string, Map<string, { passes: number; tries: number }>>();
  for (const t of tries) {
    if (!arms.includes(t.arm)) arms.push(t.arm);
    if (!cells.has(t.task)) { tasks.push(t.task); cells.set(t.task, new Map()); }
    const row = cells.get(t.task)!;
    const c = row.get(t.arm) ?? { passes: 0, tries: 0 };
    c.passes += t.pass;
    c.tries += 1;
    row.set(t.arm, c);
  }
  const taskRows = tasks.map((task) => {
    const row = cells.get(task)!;
    const all = [...row.values()];
    const tag: TaskTag = all.every((c) => c.passes === c.tries) ? 'every_arm_passed' : all.every((c) => c.passes === 0) ? 'every_arm_failed' : 'can_tell_apart';
    return { task, tag, arms: Object.fromEntries(arms.filter((a) => row.has(a)).map((a) => [a, row.get(a)!])) };
  });
  const count = (tag: TaskTag) => taskRows.filter((t) => t.tag === tag).length;
  return {
    arms: arms.map((arm) => {
      const cs = taskRows.flatMap((t) => (t.arms[arm] ? [t.arms[arm]] : []));
      const passes = cs.reduce((s, c) => s + c.passes, 0), n = cs.reduce((s, c) => s + c.tries, 0);
      return { arm, passes, tries: n, pass_rate: n ? passes / n : null };
    }),
    tasks: taskRows,
    counts: { tasks: taskRows.length, every_arm_passed: count('every_arm_passed'), every_arm_failed: count('every_arm_failed'), can_tell_apart: count('can_tell_apart') },
  };
}

export interface PairHeadroom {
  /** Paired tasks of the comparison. */
  tasks: number;
  /** Paired tasks the run can tell apart: not passed in every arm of the run on every try, and not failed in every arm on every try. The gate counts these. */
  run_can_tell_apart: number;
  /** Paired tasks both arms of this pair passed on every try, and both failed on every try (reported, not gated on). */
  both_passed: number;
  both_failed: number;
  /** On the tasks the run can tell apart, over every paired item: the most an arm could gain over A's results (A's failed share). */
  room_above_a: number;
  /** The most an arm could fall below A's results (A's passed share). */
  room_below_a: number;
  /** The most an arm could gain over B's results. */
  room_above_b: number;
}

/** The tasks a run can tell apart, from each arm's per-task pass means (0 to 1): every task some arm has, except those every arm that has it passed every time (mean 1) or failed every time (mean 0). */
export function runCanTellApart(arms: Iterable<ReadonlyMap<string, number>>): Set<string> {
  const byTask = new Map<string, number[]>();
  for (const arm of arms) for (const [task, mean] of arm) byTask.set(task, [...(byTask.get(task) ?? []), mean]);
  return new Set([...byTask].filter(([, ms]) => !ms.every((m) => m === 1) && !ms.every((m) => m === 0)).map(([task]) => task));
}

/**
 * One comparison's headroom from its paired items (pass values 1 or 0, or per-task means), clustered by task, and the
 * run's set of tasks that can tell arms apart. The gate counts tasks from the run's set, not from the pair's own results,
 * so two arms that agree on a task are not counted against a "no worse than" call. Rooms are on the scale of the paired
 * difference (the mean of b minus a over every item), so they compare directly with a margin. Null when a value lies
 * outside 0 to 1.
 */
export function pairHeadroom(items: ReadonlyArray<{ cluster: string; a: number; b: number }>, runSet: ReadonlySet<string>): PairHeadroom | null {
  if (!items.length || !items.every((p) => p.a >= 0 && p.a <= 1 && p.b >= 0 && p.b <= 1)) return null;
  const byCluster = new Map<string, Array<{ a: number; b: number }>>();
  for (const p of items) byCluster.set(p.cluster, [...(byCluster.get(p.cluster) ?? []), p]);
  let inRun = 0, bothPassed = 0, bothFailed = 0, aboveA = 0, belowA = 0, aboveB = 0;
  for (const [cluster, ps] of byCluster) {
    if (ps.every((p) => p.a === 1 && p.b === 1)) bothPassed++;
    if (ps.every((p) => p.a === 0 && p.b === 0)) bothFailed++;
    if (!runSet.has(cluster)) continue;
    inRun++;
    for (const p of ps) { aboveA += 1 - p.a; belowA += p.a; aboveB += 1 - p.b; }
  }
  return { tasks: byCluster.size, run_can_tell_apart: inRun, both_passed: bothPassed, both_failed: bothFailed, room_above_a: aboveA / items.length, room_below_a: belowA / items.length, room_above_b: aboveB / items.length };
}

/**
 * The gate, applied after any multiple-comparison correction. room is the room in the direction of the call, holding the
 * reference arm at its results: for "B better than A", room_above_a; for "A better than B", room_above_b; for "B no worse
 * than A", room_below_a. Returns null when the call may stand, else the reason that replaces it, starting with NO_ROOM.
 */
export function noRoomReason(h: PairHeadroom, need: { room: number; smallest_difference: number; min_tasks: number }): string | null {
  const counts = `${h.run_can_tell_apart} of ${h.tasks} paired tasks can tell the arms of this run apart (the other ${h.tasks - h.run_can_tell_apart} passed in every arm on every try, or failed in every arm on every try)`;
  if (h.run_can_tell_apart < need.min_tasks) return `${NO_ROOM}: only ${counts}; a call needs at least ${need.min_tasks}`;
  if (need.room < need.smallest_difference - 1e-12) return `${NO_ROOM}: ${counts}, and on them the pass rate can move by at most ${points(need.room)} points, less than the ${points(need.smallest_difference)}-point smallest difference the preregistration named`;
  return null;
}

const points = (x: number) => (100 * x).toFixed(1).replace(/\.0$/, '');
const share = (c: { passes: number; tries: number }) => `${c.passes}/${c.tries}`;
const TAG_WORDS: Record<TaskTag, string> = { every_arm_passed: 'passed every try', every_arm_failed: 'failed every try', can_tell_apart: 'can tell apart' };

/** The plain-English section a results pull request includes. */
export function renderHeadroom(h: RunHeadroom, minTasks = 10): string {
  const c = h.counts;
  const out = ['## Headroom: which tasks can tell the arms apart', ''];
  out.push(`**${c.can_tell_apart} of ${c.tasks} tasks can tell the arms apart.** ${c.every_arm_passed} passed in every arm on every try and ${c.every_arm_failed} failed in every arm on every try. Those ${c.every_arm_passed + c.every_arm_failed} can't show a difference between arms, whatever the arms do.`, '');
  out.push(`A "no worse than" or "better than" call needs at least ${minTasks} of these tasks among the two arms' paired tasks, and room on them for the smallest difference the preregistration named. Otherwise the call reads "${NO_ROOM}".`, '');
  out.push('Pass rate per arm, all scored tries: ' + h.arms.map((a) => `\`${a.arm}\` ${a.passes}/${a.tries}${a.pass_rate === null ? '' : ` (${points(a.pass_rate)}%)`}`).join('; ') + '.', '');
  out.push(`| Task | Every arm | ${h.arms.map((a) => `\`${a.arm}\``).join(' | ')} |`, `|---|---|${h.arms.map(() => '---|').join('')}`);
  for (const t of h.tasks) out.push(`| \`${t.task}\` | ${TAG_WORDS[t.tag]} | ${h.arms.map((a) => (t.arms[a.arm] ? share(t.arms[a.arm]!) : '-')).join(' | ')} |`);
  return out.join('\n') + '\n';
}
