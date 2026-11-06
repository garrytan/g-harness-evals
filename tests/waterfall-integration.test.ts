// End to end (internal-task): request bodies split by runner/proxy/sections.ts feed scripts/waterfall/avoidable.ts unchanged.
import { describe, expect, test } from 'bun:test';
import { requestSections } from '../runner/proxy/sections.ts';
import { resentToolResults, unreadCacheWrites, unusedToolSchemas, type SectionRequest } from '../scripts/waterfall/avoidable.ts';
import { validSections } from '../scripts/waterfall/mine.ts';

const tools = [
  { name: 'list_channels', description: 'List channels', input_schema: { type: 'object', properties: {} } },
  { name: 'send_mail', description: 'Send a mail', input_schema: { type: 'object', properties: { to: { type: 'string' } } } },
];
const system = [{ type: 'text', text: 'You are the workspace bot.', cache_control: { type: 'ephemeral' } }];

function conversation(turns: number, page = (i: number) => `channel list page ${i}`) {
  const messages: unknown[] = [{ role: 'user', content: 'Please list the channels.' }];
  for (let i = 0; i < turns; i++) {
    messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'list_channels', input: {} }] });
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: page(i) }] });
  }
  const last = messages[messages.length - 1] as { content: unknown };
  if (Array.isArray(last.content)) (last.content[0] as Record<string, unknown>).cache_control = { type: 'ephemeral' };
  return { model: 'claude-opus-5-5', max_tokens: 1024, system, tools, messages };
}

describe('sections.ts output drives the avoidable-looking categories (internal-task)', () => {
  const reqs: SectionRequest[] = Array.from({ length: 5 }, (_, i) => {
    const body = conversation(i);
    const raw = JSON.stringify(body);
    const sections = requestSections(body, Buffer.byteLength(raw), 'anthropic', '/v1/messages');
    return { at: i * 20_000, turn: 1, usd: 0.01, cache_read: i ? 1000 * i : 0, cache_write: 100, cache_write_1h: 0, sections, tools_called: ['list_channels'] } as unknown as SectionRequest;
  });

  test('every split validates against the miner and partitions the body exactly', () => {
    for (const r of reqs) {
      expect(validSections(r.sections)).toBe(true);
      const s = r.sections as unknown as Record<string, number>;
      const sum = ['system', 'tools', 'user_text', 'tool_result', 'assistant_text', 'tool_use', 'opaque', 'media', 'other'].reduce((a, k) => a + s[k], 0);
      expect(sum).toBe(s.body_bytes);
    }
  });

  test('a breakpoint that moves forward every request leaves only the final write unread', () => {
    expect(unreadCacheWrites(reqs)).toEqual({ requests: 1, tokens: 100 });
  });

  test('history replay of tool results counts nothing, the same output fetched again does, and the uncalled tool is counted', () => {
    expect(resentToolResults(reqs).resends).toBe(0);
    const body = conversation(3, () => 'channel list page 0');
    const again = { ...reqs[0]!, sections: requestSections(body, Buffer.byteLength(JSON.stringify(body)), 'anthropic', '/v1/messages') } as SectionRequest;
    expect(resentToolResults([again])).toEqual({ resends: 2, bytes: 2 * Buffer.byteLength(JSON.stringify('channel list page 0')) });
    expect(unusedToolSchemas(reqs).tools).toEqual(['send_mail']);
  });
});
