import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import { buildPackets, capPacket, estimateTokens, gbrainExposure, hashPacket, packetText, trimDeep, turnOf, type HashedPacket } from '../scripts/failure-mining/packet.ts';

const ROOT = resolve(import.meta.dir, '..');
const FX = join(ROOT, 'tests/fixtures/failure-mining');
const TASKS = join(ROOT, 'tasks/multiuser/v0.3');
const opts = { results: join(FX, 'mu'), tasksRoot: TASKS };
const CR04 = 'matrix-mu-2026-11/openclaw-sol-none-mu-v03-dev/cr-04-marrow-agrisupply-seat-count/r1';
const AR03 = 'matrix-mu-2026-11/claude-code-opus-none-mu-v03-dev/ar-03-tansley-parcel-rate-tobias/r1';
const tmp = mkdtempSync(join(tmpdir(), 'fm-packet-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const build = () => buildPackets(join(FX, 'taxonomy.json'), opts);
const byId = (ps: HashedPacket[], id: string) => ps.find((p) => p.trial_id === id)!;

describe('packet.ts', () => {
  test('one packet per failed fixture trial, sorted by trial id, deterministic, with a sha256 over its JSON', () => {
    const a = build(), b = build();
    expect(a.skipped).toEqual([]);
    expect(a.packets.map((p) => p.trial_id)).toEqual([...a.packets.map((p) => p.trial_id)].sort());
    expect(a.packets.length).toBe(3);
    expect(a.packets.map((p) => JSON.stringify(p))).toEqual(b.packets.map((p) => JSON.stringify(p)));
    for (const p of a.packets) {
      expect(p.packet_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(hashPacket(JSON.parse(packetText(p))).packet_sha256).toBe(p.packet_sha256);
    }
  });

  test('carries the task, turns, bot events by turn, replies, failed predicates, layer 1 and no hidden facts', () => {
    const p = byId(build().packets, CR04);
    expect(p.task).toEqual({ id: 'cr-04-marrow-agrisupply-seat-count', title: expect.any(String), family: 'corrections', split: 'dev' });
    expect(p.model).toBe('openai:gpt-6.1-sol');
    expect(p.turns.map((t) => [t.turn, t.actor, t.channel, t.ran])).toEqual([[1, 'tobias-rendle', 'central-team', true], [2, 'tobias-rendle', 'central-random', true], [3, 'hollis-mbeki', 'central-team', true]]);
    expect(p.turns[2]!.reply_text).toContain('382 seats');
    const bot = p.events.filter((e) => e.bot).map((e) => [e.seq, e.turn, e.tool, e.reply ?? false]);
    expect(bot).toEqual([[2, 1, 'chat.postMessage', true], [4, 2, 'chat.postMessage', true], [7, 3, 'conversations.list', false], [8, 3, 'chat.postMessage', true]]);
    expect(p.events.find((e) => e.seq === 6)).toMatchObject({ actor: 'hollis-mbeki', bot: false, turn: 3 });
    expect(p.failed_predicates.map((f) => [f.id, f.turn])).toEqual([['answer', 3], ['not_retracted', 3]]);
    expect(p.failed_predicates[0]!.evidence).toContain('none match');
    expect(p.layer1.map((l) => l.label)).toEqual(['source_not_read', 'forbidden_content']);
    expect(p.layer1[0]!.label_definition.length).toBeGreaterThan(10);
    expect(p.gbrain).toBeNull();
    expect(JSON.stringify(p)).not.toContain('hidden_facts');
    expect(JSON.stringify(p)).not.toContain('corrected_value');
    expect(Object.keys(p.inputs)).toContain('turns/turn-0003.response.json');
    expect(p.truncation).toMatchObject({ cap_tokens: 20000, dropped_non_bot_seqs: [], dropped_bot_seqs: [], over_cap: false });
  });

  test('trims long strings in args and effects and says how much was cut', () => {
    expect(trimDeep('x'.repeat(510), 500)).toBe('x'.repeat(500) + '…[+10 chars]');
    expect(trimDeep({ a: ['y'.repeat(3)], b: null, c: 2 }, 2)).toEqual({ a: ['yy…[+1 chars]'], b: null, c: 2 });
  });

  test('an event belongs to the last turn whose started_seq is at or before it', () => {
    const w = [{ turn: 1, started_seq: 2 }, { turn: 2, started_seq: 14 }] as any;
    expect([1, 2, 3, 13, 14, 40].map((s) => turnOf(w, s))).toEqual([null, 1, 1, 1, 2, 2]);
  });

  test('the cap drops the oldest non-bot events first, then the oldest bot events, and records the cut', () => {
    const full = byId(build().packets, AR03);
    const nonBot = full.events.filter((e) => !e.bot).map((e) => e.seq);
    const size = estimateTokens(packetText(full));
    const cut = capPacket(full, size - 100);
    expect(cut.truncation.dropped_non_bot_seqs.length).toBeGreaterThan(0);
    expect(cut.truncation.dropped_non_bot_seqs).toEqual(nonBot.slice(0, cut.truncation.dropped_non_bot_seqs.length));
    expect(cut.truncation.dropped_bot_seqs).toEqual([]);
    expect(cut.events.filter((e) => e.bot).length).toBe(full.events.filter((e) => e.bot).length);
    expect(cut.truncation.over_cap).toBe(false);
    const tiny = capPacket(full, 1500);
    expect(tiny.truncation.dropped_non_bot_seqs).toEqual(nonBot);
    expect(tiny.truncation.dropped_bot_seqs[0]).toBe(full.events.find((e) => e.bot)!.seq);
    expect(tiny.events.every((e) => e.bot)).toBe(true);
    const none = capPacket(full, 10);
    expect(none.events).toEqual([]);
    expect(none.truncation.over_cap).toBe(true);
  });

  test('gbrain exposure comes from the trial row', () => {
    const row = { gbrain: { events: { total: 9, discovery: 2, calls: 7, in_turn_calls: 5, writes: 1, degraded: 0 } } } as unknown as TrialRecord;
    expect(gbrainExposure(row)).toEqual({ total: 9, discovery: 2, calls: 7, in_turn_calls: 5, writes: 1, degraded: 0 });
    expect(gbrainExposure({} as TrialRecord)).toBeNull();
  });

  test('an unknown trial id is an error', () => {
    expect(() => buildPackets(join(FX, 'taxonomy.json'), { ...opts, trials: ['nope/x/y/r1'] })).toThrow(/not a failed trial/);
  });

  test('the CLI writes the same bytes on every run', () => {
    const run = (out: string) => spawnSync('bun', ['scripts/failure-mining/packet.ts', '--taxonomy', join(FX, 'taxonomy.json'), '--results', join(FX, 'mu'), '--tasks', TASKS, '--out', out],
      { cwd: ROOT, env: { PATH: process.env.PATH ?? '', HOME: tmp }, encoding: 'utf8' });
    const a = run(join(tmp, 'a.jsonl')), b = run(join(tmp, 'b.jsonl'));
    expect(a.status).toBe(0);
    expect(a.stdout).toContain('packets: 3 written');
    expect(b.status).toBe(0);
    expect(readFileSync(join(tmp, 'a.jsonl'), 'utf8')).toBe(readFileSync(join(tmp, 'b.jsonl'), 'utf8'));
    expect(readFileSync(join(tmp, 'a.jsonl'), 'utf8').trim().split('\n').length).toBe(3);
  });
});
