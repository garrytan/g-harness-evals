// internal-task (#152 ship review, for the C4 told-live run): the facts mechanism.ts counts must not look like JSON.
// qmDelivery (world/services/gbrain-tap.ts) matches a fact's raw text and its JSON-escaped form inside gbrain's JSON reply,
// and marks a fact not delivered when its occurrence lies inside a longer fact's. A fact whose text carried JSON syntax
// ({, }, a "key": pair, an escaped quote) could match across row boundaries and hide another fact's real occurrence. So for each
// counted C4 task, the needed and superseded posts as live ingestion writes them (factFor, world/services/gbrain-ingest.ts)
// carry no JSON syntax, and neither contains the other.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadTask } from '../runner/trial/task.ts';
import { DEFAULT_WORLD_PATH, worldAt } from '../runner/trial/world.ts';
import { factFor } from '../world/services/gbrain-ingest.ts';

const ROOT = resolve(import.meta.dir, '..');
// The C4 told-live cells' tasks (qm-c4-told-live-2026-11): every one carries [mechanism].
const C4_TASKS = ['cn-01-tamsin-cold-chain-site', 'cn-02-tansleigh-packaging-deadline', 'cn-03-marrow-agrisupply-site', 'cn-04-quarrendon-site', 'cr-01-marrow-agrisupply-site-retraction', 'cr-02-quarrendon-seat-count-retraction', 'cr-03-brackenwater-renewal-date-retraction', 'cr-04-marrow-agrisupply-seat-count'];
const JSON_SYNTAX = /[{}\\]|":|","|\[\s*"/;

test('no counted C4 fact looks like JSON: the needed and superseded posts carry no braces, backslashes or quoted key-value pairs, and neither contains the other', () => {
  const world = worldAt(join(ROOT, DEFAULT_WORLD_PATH));
  const bot = 'helper-bot';
  let checked = 0;
  for (const id of C4_TASKS) {
    const dir = join(ROOT, 'tasks/multiuser/v0.3/dev', id);
    const task = loadTask(dir);
    const raw = Bun.TOML.parse(readFileSync(join(dir, 'task.toml'), 'utf8')) as { mechanism?: { needed_turn: number; superseded_turn?: number } };
    expect(raw.mechanism).toBeDefined();
    const facts = [raw.mechanism!.needed_turn, raw.mechanism!.superseded_turn].filter((n): n is number => typeof n === 'number').map((n) => {
      const turn = task.turns[n - 1]!;
      const author = world.members.find((m) => m.id === turn.actor)!;
      expect(author).toBeDefined();
      const channel = turn.channel === 'dm' ? { name: `dm:${bot}+${author.id}`, kind: 'dm' } : { name: turn.channel, kind: 'channel' };
      expect(turn.text).not.toMatch(/["{}]/);
      return factFor({ id: `${id}-${n}`, channel: 'C', author: author.id, ts: '1', text: turn.text } as Parameters<typeof factFor>[0], author, channel, bot, '2026-10-14T09:00:00-04:00').fact;
    });
    for (const f of facts) { expect(f).not.toMatch(JSON_SYNTAX); checked++; }
    if (facts.length === 2) { expect(facts[0]!.includes(facts[1]!)).toBe(false); expect(facts[1]!.includes(facts[0]!)).toBe(false); }
  }
  expect(checked).toBe(12);
});
