import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { countWorld, importWorld, parseChat } from '../world/seed/import.ts';
import type { World } from '../world/types.ts';

const seedDir = join(import.meta.dir, '..', 'world', 'seed');
const worldText = readFileSync(join(seedDir, 'world.json'), 'utf8');
const world = JSON.parse(worldText) as World;
const manifest = JSON.parse(readFileSync(join(seedDir, 'MANIFEST.json'), 'utf8')) as { world_json_sha256: string; inputs_sha256: string; counts: Record<string, number>; inputs: { path: string }[] };

const corpus = process.env.MESSY_COMPANY_V1 ?? join(homedir(), '.capy/work/harness-eval/gbrain-evals/eval/data/messy-company-v1');

const resolve = (name: string) => ({
  'dana okafor': 'dana-okafor', dana: 'dana-okafor', 'dana.okafor': 'dana-okafor', 'ilse varga': 'ilse-varga', 'ilse.varga': 'ilse-varga',
  pree: 'pree-sundaram', bkroll: 'bettina-kroll', 'gideon sato': 'gideon-sato',
}[name.toLowerCase()] ?? null);

describe('parseChat', () => {
  test('reads every header style the corpus uses', () => {
    const body = [
      '# #north-team, Aug 20', '', '**2025-08-20**', '',
      '**09:12 — Dana Okafor:** first style', '',
      '**Ilse Varga** [09:14 AM]', 'second style', 'continues here', '',
      '[14:06] pree: third style',
      '[14:18] bkroll: also third',
      '**Dana Okafor  07:02 AM**', 'fourth style', '',
      'Ilse Varga  10:42 AM', 'fifth style', '',
      '**Gideon Sato**', 'sixth style, no time', '',
      '**Exported:** 4 Nov 2025',
    ].join('\n');
    const msgs = parseChat(body, resolve);
    expect(msgs.map((m) => [m.author, m.time, m.text])).toEqual([
      ['dana-okafor', '09:12', 'first style'],
      ['ilse-varga', '09:14 AM', 'second style\ncontinues here'],
      ['pree-sundaram', '14:06', 'third style'],
      ['bettina-kroll', '14:18', 'also third'],
      ['dana-okafor', '07:02 AM', 'fourth style'],
      ['ilse-varga', '10:42 AM', 'fifth style'],
      ['gideon-sato', null, 'sixth style, no time\n\n**Exported:** 4 Nov 2025'],
    ]);
  });

  test('ignores header-looking lines whose name does not resolve', () => {
    expect(parseChat('**Date:** 2025-01-01\n**Nobody Known  09:00 AM**\ntext', resolve)).toEqual([]);
  });
});

describe('committed seed', () => {
  test('world.json matches its manifest hash', () => {
    expect(createHash('sha256').update(worldText).digest('hex')).toBe(manifest.world_json_sha256);
  });

  test('manifest counts match the file', () => {
    expect(countWorld(world)).toEqual(manifest.counts);
  });

  test('has the 14 employees, 16 accounts, 5 private notes and the frozen today', () => {
    expect(world.today).toBe('2026-10-14');
    expect(world.members.filter((m) => m.kind === 'employee')).toHaveLength(14);
    expect(world.accounts).toHaveLength(16);
    expect(world.files.filter((f) => f.visibility === 'private')).toHaveLength(5);
    expect(world.channels.some((c) => c.name === 'general')).toBe(true);
    expect(world.channels.filter((c) => c.kind === 'incident').map((c) => c.name).sort()).toEqual(['inc-qfl-sev1', 'inc-tansley-carrier-api', 'inc-vtg-hartford']);
  });

  test('every record carries a split and clusters stay separable', () => {
    const splits = new Set(['dev', 'heldout', 'both']);
    for (const list of [world.teams, world.members, world.accounts, world.channels, world.messages, world.files, world.calendar, world.mail] as { split: string }[][]) {
      for (const r of list) expect(splits.has(r.split)).toBe(true);
    }
    const accountSplit = new Map(world.accounts.map((a) => [a.id, a.split]));
    for (const f of world.files) {
      for (const a of f.accounts) expect(f.split).toBe(accountSplit.get(a)!);
    }
    const channelSplit = new Map(world.channels.map((c) => [c.id, c.split]));
    for (const m of world.messages) expect(m.split).toBe(channelSplit.get(m.channel)!);
    expect(world.messages.filter((m) => m.split === 'dev').length).toBeGreaterThan(0);
    expect(world.messages.filter((m) => m.split === 'heldout').length).toBeGreaterThan(0);
  });

  test('private notes belong to their writer and dates are preserved', () => {
    const priv = world.files.filter((f) => f.visibility === 'private');
    for (const f of priv) expect(f.path.startsWith(`members/${f.owner}/notes/`)).toBe(true);
    const chat = world.messages.find((m) => m.slug === 'chats/2025-08-20-north-team-chat')!;
    expect(chat.date).toBe('2025-08-20');
    expect(chat.ts.startsWith(String(Math.floor(Date.UTC(2025, 7, 20, 14, 12) / 1000)))).toBe(true);
    const undated = world.messages.filter((m) => m.date_basis === 'undated');
    expect(new Set(undated.map((m) => m.slug))).toEqual(new Set(['chats/north-team-random', 'chats/central-team-banter', 'chats/coastal-team-banter', 'chats/strategic-pod-banter']));
  });
});

describe.skipIf(!existsSync(corpus))('import against the messy-company-v1 checkout', () => {
  test('reproduces the committed world.json and input hashes', () => {
    const { world: fresh, inputs } = importWorld(corpus);
    const json = JSON.stringify(fresh, null, 1) + '\n';
    expect(createHash('sha256').update(json).digest('hex')).toBe(manifest.world_json_sha256);
    const inputsHash = createHash('sha256').update(inputs.map((i) => `${i.sha256}  ${i.path}\n`).join('')).digest('hex');
    expect(inputsHash).toBe(manifest.inputs_sha256);
    expect(inputs.length).toBe(manifest.inputs.length);
    expect(countWorld(fresh)).toEqual(manifest.counts);
  });
});
