// The oracle and mutation matrix (docs/tasks.md): for every task under tasks/multiuser/{dev,heldout}, task.toml
// validates, the oracle passes, and each mutations/<id>.json fails exactly the predicate or forbidden effect it
// is named for while every other predicate still passes. Keyless; one in-process world per script.

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

function taskDirs(split: 'dev' | 'heldout'): string[] {
  return readdirSync(join(ROOT, split), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(ROOT, split, d.name)).sort();
}

function readScript(path: string): Script {
  return JSON.parse(readFileSync(path, 'utf8')) as Script;
}

const allDirs = SPLITS.flatMap((s) => taskDirs(s));

describe('task set', () => {
  test('30 tasks: 10 dev and 20 held-out, six per family', () => {
    expect(taskDirs('dev')).toHaveLength(10);
    expect(taskDirs('heldout')).toHaveLength(20);
    const families = new Map<string, number>();
    for (const dir of allDirs) {
      const t = loadTask(dir);
      families.set(t.family, (families.get(t.family) ?? 0) + 1);
    }
    expect([...families.entries()].sort()).toEqual([['handoff', 6], ['org_security', 6], ['scheduled', 6], ['scope_isolation', 6], ['shared_channel', 6]]);
  });

  test('every task has a unique id, a preamble exists, and no task names a placeholder the runner does not fill', () => {
    const ids = allDirs.map((d) => loadTask(d).id);
    expect(new Set(ids).size).toBe(ids.length);
    const preamble = readFileSync(join(ROOT, '_shared', 'preamble.md'), 'utf8');
    const allowed = new Set(['requester_name', 'requester_handle', 'requester_role', 'requester_team', 'channel_name', 'channel_type', 'sim_now', 'message', 'bot_name', 'request_ts']);
    for (const m of preamble.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) expect(allowed.has(m[1]!)).toBe(true);
    for (const dir of allDirs) for (const [, fact] of Object.entries(loadTask(dir).hidden_facts ?? {})) expect(preamble.toLowerCase()).not.toContain(fact.toLowerCase());
  });
});

for (const dir of allDirs) {
  const task: Task = loadTask(dir);
  describe(`${task.split}/${task.id}`, () => {
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
      expect(grade.consent_violation).toBe(false);
      expect(grade.approval_stop).toBe(task.family === 'org_security');
    }, 20_000);

    const mutationDir = join(dir, 'mutations');
    const mutations = existsSync(mutationDir) ? readdirSync(mutationDir).filter((f) => f.endsWith('.json')).sort() : [];

    test('mutations cover every required predicate and forbidden effect', () => {
      const expected = [...task.predicates.required, ...task.predicates.forbidden_effects].sort();
      expect(mutations.map((f) => f.replace(/\.json$/, '')).sort()).toEqual(expected);
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
        expect(grade.grade).toBe('fail');
        expect(grade.consent_violation).toBe(task.predicates.forbidden_effects.includes(id as never));
      }, 20_000);
    }
  });
}
