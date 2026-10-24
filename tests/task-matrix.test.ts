// The oracle and mutation matrix (docs/tasks.md): for every task under tasks/multiuser/{dev,heldout} (the v0.1 set)
// and tasks/multiuser/<set>/{dev,heldout} (later sets such as v0.2), task.toml validates, the oracle passes, and each
// mutations/<id>.json fails exactly the predicate or forbidden effect it is named for while every other predicate
// still passes. Keyless; one in-process world per script.

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Script } from '../runner/contracts.ts';
import { gradeTrial } from '../runner/grade/index.ts';
import { playScript } from '../runner/grade/play.ts';
import { loadTask, type Task } from '../runner/grade/task.ts';
import { world } from './world-helpers.ts';

const ROOT = join(import.meta.dir, '..', 'tasks', 'multiuser');
const SPLITS = ['dev', 'heldout'] as const;
const V02_FAMILIES = ['continuity', 'synthesis', 'corrections', 'approval_relay'];

/** Task sets: v0.1 at the root, then every tasks/multiuser/<set>/ that holds a dev or heldout directory. */
const SETS: Array<{ name: string; root: string }> = [
  { name: 'v0.1', root: ROOT },
  ...readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !['dev', 'heldout', '_shared'].includes(d.name) && SPLITS.some((s) => existsSync(join(ROOT, d.name, s))))
    .map((d) => ({ name: d.name, root: join(ROOT, d.name) })).sort((a, b) => a.name.localeCompare(b.name)),
];

function taskDirs(root: string, split: 'dev' | 'heldout'): string[] {
  const dir = join(root, split);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'task.toml'))).map((d) => join(dir, d.name)).sort();
}

function readScript(path: string): Script {
  return JSON.parse(readFileSync(path, 'utf8')) as Script;
}

const allTasks = SETS.flatMap((set) => SPLITS.flatMap((sp) => taskDirs(set.root, sp).map((dir) => ({ set, dir }))));
const allDirs = allTasks.map((t) => t.dir);
const corpusText = (split: 'dev' | 'heldout') => [
  ...world.messages.filter((m) => m.split === 'both' || m.split === split).map((m) => m.text),
  ...world.files.filter((f) => f.split === 'both' || f.split === split).map((f) => f.body ?? ''),
  ...world.mail.filter((m) => m.split === 'both' || m.split === split).map((m) => `${m.subject ?? ''}\n${m.body ?? ''}`),
].join('\n').toLowerCase().replace(/\s+/g, ' ');

describe('task set v0.1', () => {
  test('30 tasks: 10 dev and 20 held-out, six per family', () => {
    expect(taskDirs(ROOT, 'dev')).toHaveLength(10);
    expect(taskDirs(ROOT, 'heldout')).toHaveLength(20);
    const families = new Map<string, number>();
    for (const dir of SPLITS.flatMap((s) => taskDirs(ROOT, s))) {
      const t = loadTask(dir);
      families.set(t.family, (families.get(t.family) ?? 0) + 1);
    }
    expect([...families.entries()].sort()).toEqual([['handoff', 6], ['org_security', 6], ['scheduled', 6], ['scope_isolation', 6], ['shared_channel', 6]]);
  });
});

for (const set of SETS.slice(1)) {
  describe(`task set ${set.name}`, () => {
    test('every task is in one of the four v0.2 families and names its split directory', () => {
      for (const split of SPLITS) for (const dir of taskDirs(set.root, split)) {
        const t = loadTask(dir);
        expect(V02_FAMILIES, `${t.id}: family ${t.family}`).toContain(t.family);
        expect(t.split).toBe(split);
      }
    });
  });
}

describe('every task set', () => {
  test('every task has a unique id, a preamble exists, and no task names a placeholder the runner does not fill', () => {
    const ids = allDirs.map((d) => loadTask(d).id);
    expect(new Set(ids).size).toBe(ids.length);
    const preamble = readFileSync(join(ROOT, '_shared', 'preamble.md'), 'utf8');
    const allowed = new Set(['requester_name', 'requester_handle', 'requester_role', 'requester_team', 'channel_name', 'channel_type', 'sim_now', 'message', 'bot_name', 'request_ts']);
    for (const m of preamble.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) expect(allowed.has(m[1]!)).toBe(true);
    for (const dir of allDirs) for (const [, fact] of Object.entries(loadTask(dir).hidden_facts ?? {})) expect(preamble.toLowerCase()).not.toContain(fact.toLowerCase());
  });

  test('no hidden fact appears anywhere in the world seed of its split (messages, file bodies, mail)', () => {
    const corpus = { dev: corpusText('dev'), heldout: corpusText('heldout') };
    for (const dir of allDirs) {
      const t = loadTask(dir);
      for (const [key, fact] of Object.entries(t.hidden_facts ?? {})) {
        const needle = fact.toLowerCase().replace(/\s+/g, ' ');
        expect(corpus[t.split].includes(needle), `${t.id}: hidden fact "${key}" (${fact}) occurs in the ${t.split} world records`).toBe(false);
      }
    }
  });
});

for (const { set, dir } of allTasks) {
  const task: Task = loadTask(dir);
  describe(`${set.name}/${task.split}/${task.id}`, () => {
    test('task.toml is grounded in the world: actors exist, channels exist in the split, digests stay in scope', () => {
      const members = new Set(world.members.map((m) => m.id));
      for (const a of task.actors) expect(members.has(a)).toBe(true);
      const channels = world.channels.filter((c) => c.split === 'both' || c.split === task.split);
      for (const t of task.turns) {
        if (t.channel === 'dm') continue;
        const ch = channels.find((c) => c.name === t.channel);
        expect(ch, `#${t.channel} exists in split ${task.split}`).toBeDefined();
        expect(ch!.members, `${t.actor} is in #${t.channel}`).toContain(t.actor);
      }
      for (const p of task.predicate) {
        if (p.kind !== 'digest_posted') continue;
        const target = p.channel.startsWith('dm:') ? p.channel.slice(3).split('+').filter((m) => m !== 'assistant') : channels.find((c) => c.name === p.channel)?.members;
        expect(target, `digest channel ${p.channel} exists`).toBeDefined();
        for (const src of p.sources) {
          const s = channels.find((c) => c.name === src);
          expect(s, `source #${src} exists`).toBeDefined();
          for (const m of target!) expect(s!.members, `${m} reads #${src} and the digest in ${p.channel}`).toContain(m);
        }
      }
    });

    test('oracle passes every predicate', async () => {
      const evidence = await playScript(dir, task, readScript(join(dir, 'oracle.json')), { world });
      const grade = await gradeTrial(evidence, task);
      const failed = grade.predicates.filter((p) => !p.passed).map((p) => `${p.id}: ${p.evidence}`);
      expect(failed).toEqual([]);
      expect(grade.grade).toBe('pass');
      for (const id of task.predicates.secondary ?? []) expect(grade.predicates.find((p) => p.id === id)?.kind).toBe('secondary');
      expect(grade.consent_violation).toBe(false);
      expect(grade.approval_stop).toBe(task.predicate.some((p) => p.kind === 'approval_requested' && p.turn === task.turns.length));
      if (set.name !== 'v0.1') {
        // Availability: every world call the oracle makes as the bot succeeds, so every fact the task needs is
        // reachable through the bot token (a denied or failed read would mean the task rests on a record the bot
        // cannot see).
        const notOk = evidence.events.filter((e) => e.actor === evidence.bot_member && e.outcome !== 'ok').map((e) => `seq=${e.seq} ${e.tool} ${e.outcome}`);
        expect(notOk).toEqual([]);
        const reads = evidence.events.filter((e) => e.actor === evidence.bot_member && e.kind === 'read');
        expect(reads.length, 'the oracle reads the world at least once').toBeGreaterThan(0);
      }
    }, 20_000);

    const mutationDir = join(dir, 'mutations');
    const mutations = existsSync(mutationDir) ? readdirSync(mutationDir).filter((f) => f.endsWith('.json')).sort() : [];

    test('mutations cover every required predicate and forbidden effect (secondary predicates may have one too)', () => {
      const expected = [...task.predicates.required, ...task.predicates.forbidden_effects].sort();
      const secondary = new Set(task.predicates.secondary ?? []);
      expect(mutations.map((f) => f.replace(/\.json$/, '')).filter((id) => !secondary.has(id)).sort()).toEqual(expected);
    });

    for (const file of mutations) {
      const id = file.replace(/\.json$/, '');
      test(`mutation ${id} fails exactly that predicate`, async () => {
        const script = readScript(join(mutationDir, file));
        expect(script.id).toBe(id);
        const evidence = await playScript(dir, task, script, { world });
        const grade = await gradeTrial(evidence, task);
        const failed = grade.predicates.filter((p) => !p.passed).map((p) => p.id);
        expect(failed, grade.predicates.filter((p) => !p.passed).map((p) => `${p.id}: ${p.evidence}`).join('\n')).toEqual([id]);
        // A mutation of a secondary predicate fails only that predicate and leaves the grade a pass.
        expect(grade.grade).toBe(task.predicates.secondary?.includes(id) ? 'pass' : 'fail');
        expect(grade.consent_violation).toBe(task.predicates.forbidden_effects.includes(id as never));
      }, 20_000);
    }
  });
}
