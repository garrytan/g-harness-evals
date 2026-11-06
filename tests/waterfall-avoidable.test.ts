// scripts/waterfall/avoidable.ts (internal-task): each avoidable-looking category on small hand-built conversations.
import { describe, expect, test } from 'bun:test';
import { avoidable, cacheMissesOnRepeatedBoundary, resentToolResults, retries, sideCalls, unreadCacheWrites, unusedToolSchemas, type SectionRequest } from '../scripts/waterfall/avoidable.ts';
import type { SectionsV1 } from '../scripts/waterfall/types.ts';

interface Spec { s: number; msgs: string[]; conv?: string; read?: number; write?: number; write1h?: number; usd?: number; turn?: number | 'out_of_turn';
  tools?: Array<[string, number]>; called?: string[]; results?: Array<[string, number, number?]> }
const req = (o: Spec): SectionRequest => {
  const sections: SectionsV1 = { v: 1, body_bytes: 0, system: 0, tools: 0, user_text: 0, tool_result: 0, assistant_text: 0, tool_use: 0, opaque: 0, media: 0, other: 0,
    message_count: o.msgs.length, tools_declared: (o.tools ?? []).map(([name, bytes]) => ({ name, bytes })), conv_sha256: o.conv ?? 'A',
    boundary_sha256: o.msgs.map((_, i) => o.msgs.slice(0, i + 1).join('|')), tool_results: (o.results ?? []).map(([digest, bytes, index], k) => ({ digest, bytes, index: index ?? k })) };
  return { at: o.s * 1000, turn: o.turn ?? 1, usd: o.usd ?? 0.01, cache_read: o.read ?? 0, cache_write: o.write ?? 0, cache_write_1h: o.write1h ?? 0, sections, tools_called: o.called ?? [] };
};
const grow = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);

describe('avoidable-looking categories (internal-task)', () => {
  test('(a) a request that repeats a cached prefix inside five minutes but reads less cache counts the shortfall', () => {
    const reqs = [req({ s: 0, msgs: grow(1), write: 1000 }), req({ s: 10, msgs: grow(3), read: 1000, write: 200 }), req({ s: 20, msgs: grow(5), read: 0, write: 1500 }),
      req({ s: 30, msgs: grow(3), conv: 'B' }), req({ s: 400, msgs: grow(7), read: 0 })];
    expect(cacheMissesOnRepeatedBoundary(reqs)).toEqual({ requests: 1, tokens: 1200 });
    expect(cacheMissesOnRepeatedBoundary(reqs.slice(0, 2))).toEqual({ requests: 0, tokens: 0 });
  });

  test('(b) incremental caching with the breakpoint moving forward every request leaves only the final write unread', () => {
    const reqs = Array.from({ length: 6 }, (_, i) => req({ s: i * 20, msgs: grow(2 * i + 1), read: i ? 1000 * i : 0, write: 100 }));
    expect(unreadCacheWrites(reqs)).toEqual({ requests: 1, tokens: 100 });
  });

  test('(b) a write no later request contains, or one read only after its TTL, is unread; a 1-hour write read at ten minutes is not', () => {
    const branch = [req({ s: 0, msgs: ['x', 'y'], write: 300 }), req({ s: 10, msgs: ['x', 'z', 'w'], read: 50, write: 10 }), req({ s: 20, msgs: ['x', 'z', 'w', 'v'], read: 60 })];
    expect(unreadCacheWrites(branch)).toEqual({ requests: 1, tokens: 300 });
    const late = [req({ s: 0, msgs: grow(1), write: 400, write1h: 100 }), req({ s: 600, msgs: grow(3), read: 400 })];
    expect(unreadCacheWrites(late)).toEqual({ requests: 1, tokens: 300 });
  });

  test('(c) schema bytes of tools the trial never called are summed over every request that declared them', () => {
    const tools: Array<[string, number]> = [['Read', 300], ['Write', 500], ['Bash', 700]];
    const reqs = [req({ s: 0, msgs: grow(1), tools, called: ['Read', '<unlisted>'] }), req({ s: 1, msgs: grow(3), tools }), req({ s: 2, msgs: grow(5), tools })];
    expect(unusedToolSchemas(reqs)).toEqual({ tools: ['Bash', 'Write'], bytes: 3 * 1200 });
  });

  test('(d) plain history growth replays tool results and counts nothing', () => {
    const reqs = [req({ s: 0, msgs: grow(3), results: [['d1', 4000, 2]] }), req({ s: 1, msgs: grow(5), results: [['d1', 4000, 2]] }),
      req({ s: 2, msgs: grow(7), results: [['d1', 4000, 2], ['d2', 900, 4]] })];
    expect(resentToolResults(reqs)).toEqual({ resends: 0, bytes: 0 });
  });

  test('(d) a tool result repeated at another index, or in a history the request does not contain, counts each time', () => {
    const moved = [req({ s: 0, msgs: grow(3), results: [['d1', 4000, 2]] }), req({ s: 1, msgs: grow(5), results: [['d1', 4000, 2], ['d1', 4000, 4]] }),
      req({ s: 2, msgs: grow(7), results: [['d1', 4000, 2], ['d1', 4000, 4], ['d1', 4000, 6]] })];
    expect(resentToolResults(moved)).toEqual({ resends: 2, bytes: 8000 });
    const fresh = [req({ s: 0, msgs: grow(3), results: [['d1', 4000, 2]] }), req({ s: 1, msgs: ['x', 'y', 'z'], conv: 'B', results: [['d1', 4000, 2]] })];
    expect(resentToolResults(fresh)).toEqual({ resends: 1, bytes: 4000 });
    const ephemeral = [req({ s: 0, msgs: ['u', 'a', 'tr1', 'e1'], results: [['d1', 4000, 2]] }), req({ s: 1, msgs: ['u', 'a', 'tr1', 'a2', 'tr2', 'e2'], results: [['d1', 4000, 2], ['d2', 900, 4]] }),
      req({ s: 2, msgs: ['u', 'a', 'tr1', 'a2', 'tr2', 'a3', 'tr3', 'e3'], results: [['d1', 4000, 2], ['d2', 900, 4], ['d3', 50, 6]] })];
    expect(resentToolResults(ephemeral)).toEqual({ resends: 0, bytes: 0 });
  });

  test('(e) a request with the same boundaries as the previous one in its conversation is a retry', () => {
    const reqs = [req({ s: 0, msgs: grow(3), usd: 0.02 }), req({ s: 5, msgs: grow(3), conv: 'B', usd: 0.5 }), req({ s: 10, msgs: grow(3), usd: 0.03 }), req({ s: 20, msgs: grow(5), usd: 0.04 })];
    expect(retries(reqs)).toEqual({ requests: 1, usd: 0.03 });
    expect(retries([req({ s: 0, msgs: [] }), req({ s: 1, msgs: [] })])).toEqual({ requests: 0, usd: 0 });
  });

  test('(f) side calls: conversations other than the main one of each turn; a fresh conversation per turn is not a side call', () => {
    const reqs = [req({ s: 0, msgs: grow(1), conv: 'A' }), req({ s: 1, msgs: ['t'], conv: 'T', usd: 0.001 }), req({ s: 2, msgs: grow(3), conv: 'A' }), req({ s: 3, msgs: grow(5), conv: 'A' }),
      req({ s: 10, msgs: ['n'], conv: 'C', turn: 2 }), req({ s: 11, msgs: ['n', 'o', 'p'], conv: 'C', turn: 2 }), req({ s: 20, msgs: ['q'], conv: 'Q', turn: 'out_of_turn', usd: 0.002 })];
    const s = sideCalls(reqs);
    expect(s.requests).toBe(2);
    expect(s.usd).toBeCloseTo(0.003, 12);
  });

  test('avoidable() returns all six categories', () => {
    expect(Object.keys(avoidable([req({ s: 0, msgs: grow(1) })]))).toEqual(['cache_miss_repeated_boundary', 'unread_cache_writes', 'unused_tool_schemas', 'resent_tool_results', 'retries', 'side_calls']);
  });
});
