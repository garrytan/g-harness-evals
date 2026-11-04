// Provider recalls are not model gbrain calls (#176 /ship adversarial note): gbrainSummary and gbrainUsage split every
// count by caller, so a memory-provider cell whose model made no gbrain call reports zero model calls.

import { describe, expect, test } from 'bun:test';
import type { TurnWindow } from '../runner/contracts.ts';
import { resolveGbrain } from '../runner/run.ts';
import { gbrainSummary } from '../runner/trial/trial.ts';
import { gbrainUsage, isModelGbrainCall } from '../scripts/gbrain-usage.ts';
import type { WorldEvent } from '../world/services/events.ts';

const ev = (seq: number, tool: string, extra: Partial<WorldEvent> = {}): WorldEvent => ({ seq, trial_id: 't', wall_ts: '', sim_ts: '', actor: 'helper-bot', via: 'gbrain', tool, kind: 'read', args_digest: '', args: {}, outcome: 'ok', effect: { pages: ['chats/a'], count: 1, latency_ms: 5 }, ...extra } as WorldEvent);
const provider = (seq: number, tool: string, extra: Partial<WorldEvent> = {}) => ev(seq, tool, { caller: 'provider', provider_op: 'recall', ...extra });
const windows: TurnWindow[] = [{ turn: 1, actor: 'a', slack_user_id: 'U', channel: 'C', channel_name: 'c', channel_type: 'channel', text: '', request_ts: '', started_wall: '', ended_wall: '', started_seq: 0, ended_seq: 100, exit: 0, reply_ts: null, reply_text: null }];
const config = resolveGbrain({ surface: 'verbs' });

// A provider cell where only QM's provider client touched gbrain: its handshake, two recalls and a capture that failed.
const providerOnly = [provider(1, 'gbrain.initialize'), provider(2, 'gbrain.recall'), provider(3, 'gbrain.recall'), provider(4, 'gbrain.capture', { kind: 'write', provider_op: 'write', outcome: 'error', error: 'storage_error' })];

describe('provider recalls are counted apart from the model', () => {
  test('gbrainSummary: no model call means zero model calls; the provider block holds its own counts', () => {
    const g = gbrainSummary(config, { image: 'i', ready_ms: 1 }, providerOnly, windows);
    expect(g.events).toEqual({ total: 0, discovery: 0, calls: 0, in_turn_calls: 0, writes: 0, provider: { total: 4, discovery: 1, calls: 3, in_turn_calls: 3, writes: 1, write_errors: { storage_error: 1 } } });
    const mixed = gbrainSummary(config, { image: 'i', ready_ms: 1 }, [...providerOnly, ev(5, 'gbrain.search', { caller: 'model' })], windows);
    expect(mixed.events).toMatchObject({ total: 1, calls: 1, in_turn_calls: 1, writes: 0, provider: { calls: 3 } });
    expect('provider' in gbrainSummary(config, { image: 'i', ready_ms: 1 }, [ev(5, 'gbrain.search')], windows).events).toBe(false);
  });

  test('gbrainUsage: model counts are zero for a provider-only trial, and the provider block carries the calls', () => {
    const u = gbrainUsage([{ events: providerOnly, predicates: [] }, { events: [ev(1, 'gbrain.search', { caller: 'model' })], predicates: [] }]);
    expect(u).toMatchObject({ events_read: 2, trials_with_calls: 1, trials_with_tools_list: 0, calls_total: 1, tools: { search: 1 }, errors: 0, writes: 0 });
    expect(u.write_errors).toBeUndefined();
    expect(u.provider).toMatchObject({ trials_with_calls: 1, calls_total: 3, tools: { recall: 2, capture: 1 }, errors: 1, writes: 1, write_errors: { storage_error: 1 } });
    expect(gbrainUsage([{ events: providerOnly, predicates: [] }])).toMatchObject({ trials_with_calls: 0, calls_total: 0, tools: {} });
    expect('provider' in gbrainUsage([{ events: [ev(1, 'gbrain.search')], predicates: [] }])).toBe(false);
  });

  test('isModelGbrainCall leaves provider calls out and keeps untagged calls as the model\'s', () => {
    expect(providerOnly.filter(isModelGbrainCall)).toEqual([]);
    expect(isModelGbrainCall(ev(1, 'gbrain.search'))).toBe(true);
    expect(isModelGbrainCall(ev(1, 'gbrain.search', { caller: 'model' }))).toBe(true);
    expect(isModelGbrainCall(ev(1, 'gbrain.tools/list'))).toBe(false);
  });
});
