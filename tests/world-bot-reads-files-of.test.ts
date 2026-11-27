// owner-identity (internal-task): World.bot_reads_files_of makes the bot a member's personal agent for files: it reads every file
// that member can read (the owner's private import folder), and nothing more; absent, the bot reads under the ordinary rules.

import { describe, expect, test } from 'bun:test';
import { createWorldServer } from '../world/services/server.ts';
import type { World } from '../world/types.ts';
import { world } from './world-helpers.ts';

const privateFile = world.files.find((f) => f.visibility === 'private' && f.split !== 'heldout')!;
const owner = world.members.find((m) => m.id === privateFile.owner)!;
const otherPrivate = world.files.find((f) => f.visibility === 'private' && f.split !== 'heldout' && f.owner !== owner.id)!;

function service(w: World) {
  const ws = createWorldServer({ world: w, split: 'dev', trialId: 'bot-reads', eventsPath: null });
  return { s: ws.service, stop: () => ws.stop() };
}

describe('bot_reads_files_of', () => {
  test('absent, the bot cannot read a member\'s private file', () => {
    const { s, stop } = service(world);
    try { expect(s.canReadFile(s.bot!, privateFile)).toBe(false); } finally { stop(); }
  });

  test('set, the bot reads exactly what that member reads: their private files, not another member\'s', () => {
    const { s, stop } = service({ ...world, bot_reads_files_of: owner.id });
    try {
      expect(s.botReadsFilesOf?.id).toBe(owner.id);
      expect(s.canReadFile(s.bot!, privateFile)).toBe(true);
      expect(s.canReadFile(s.bot!, otherPrivate)).toBe(false);
      for (const f of s.files) expect(s.canReadFile(s.bot!, f)).toBe(s.canReadFile(owner, f));
      const other = s.members.find((m) => m.kind === 'employee' && m.id !== owner.id)!;
      expect(s.canReadFile(other, privateFile)).toBe(privateFile.owner === other.id);
    } finally { stop(); }
  });

  test('a member id outside the split is refused', () => {
    expect(() => service({ ...world, bot_reads_files_of: 'no-such-member' })).toThrow(/bot_reads_files_of names no-such-member/);
  });
});
