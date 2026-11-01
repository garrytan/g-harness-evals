import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startWorld, tokenOf } from './world-helpers.ts';
import { exitCode, extract, scrub, TARGETS, type Req, type Step } from '../scripts/tool-discipline/reply-probe.ts';

const steps: Step[] = [
  { label: '1 unknown tool', turn: { raw_tool: 'frobnicate', input: {} } },
  { label: '5 shell call piping a helper', turn: { raw_tool: 'exec', input: { command: '/bin/true 2>&1 | head -40' } } },
];
const tools = [{ name: 'exec' }, { name: 'tool_search' }];
const use = (id: string, name: string, input: unknown) => ({ role: 'assistant', content: [{ type: 'tool_use', id, name, input }] });
const res = (id: string, text: string, is_error?: boolean) => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], ...(is_error === undefined ? {} : { is_error }) }] });
const requests: Req[] = [
  { at: '2026-10-31T00:00:01Z', sent_at: '2026-10-31T00:00:02Z', played: steps[0]!.turn, body: { tools, messages: [{ role: 'user', content: 'go' }] } },
  { at: '2026-10-31T00:00:03Z', sent_at: '2026-10-31T00:00:04Z', played: steps[1]!.turn, body: { tools, messages: [
    use('toolu_fake_1', 'frobnicate', {}), res('toolu_fake_1', 'Tool frobnicate not found; use tool_search or exec. key sk-ant-abcdef123456', true)] } },
  { at: '2026-10-31T00:00:05Z', sent_at: null, played: null, body: { tools, messages: [
    use('call_renamed', 'exec', { command: '/bin/true 2>&1 | head -40' }), res('call_renamed', '(no output)\n\nExit code: 0')] } },
];

describe('tool-discipline probe extraction', () => {
  test('pulls each verbatim reply from the next request, scrubbed, with names and exit code', () => {
    const events = [{ wall_ts: '2026-10-31T00:00:02.5Z', tool: 'chat.postMessage', outcome: 'denied' }, { wall_ts: '2026-10-31T00:00:09Z', tool: 'late' }];
    const [a, b] = extract(steps, requests, events) as Record<string, any>[];
    expect(a!.next_request_index).toBe(1);
    expect(a!.is_error).toBe(true);
    expect(a!.offered_names_in_text).toEqual(['exec', 'tool_search']);
    expect(a!.called_name_offered_next).toBe(false);
    expect(JSON.stringify(a!.tool_result)).not.toContain('sk-ant-abcdef');
    expect(a!.world_events.map((e: any) => e.tool)).toEqual(['chat.postMessage']);
    expect(b!.tool_use_id).toBe('call_renamed');
    expect(b!.is_error).toBeNull();
    expect(b!.exit_code).toEqual({ code: 0, from: 'Exit code: 0' });
  });

  test('a call with no reply is recorded as such, not inferred', () => {
    const [a] = extract([steps[0]!], [requests[0]!], []) as Record<string, any>[];
    expect(a!.tool_result).toBeNull();
    expect(a!.outcome).toContain('no tool_result');
  });

  test('scrub and exitCode', () => {
    expect(scrub({ t: 'trial-token:abc123 Bearer abcdefghijkl' })).toEqual({ t: 'trial-token:[scrubbed] Bearer [scrubbed]' });
    const digest = 'e3cebc18873044ec14f4bd3e479b77797d77d1fc0920474b33b8e4df112c02e4';
    expect(scrub({ digest, opaque: 'Xy9' + 'aB3'.repeat(12) })).toEqual({ digest, opaque: '[scrubbed]' });
    expect(exitCode('{"exit_code": 1, "output": ""}')?.code).toBe(1);
    expect(exitCode('Process exited with code 2')?.code).toBe(2);
    expect(exitCode('ok')).toBeNull();
  });

  test('every target scripts the five turns in order', () => {
    for (const [name, make] of Object.entries(TARGETS)) {
      const labels = make().steps.filter((s) => !s.extra).map((s) => s.label[0]);
      expect([name, labels.join('')]).toEqual([name, '12345']);
    }
  });
});

describe('H3 at the world-MCP server', () => {
  test('a call that fails the input schema leaves no events.jsonl line; a wrong channel leaves a deny line', async () => {
    const ws = startWorld('tool-discipline-h3');
    const c = new Client({ name: 'test', version: '0' });
    try {
      await c.connect(new StreamableHTTPClientTransport(new URL(ws.url + '/mcp'), { requestInit: { headers: { authorization: 'Bearer ' + tokenOf(ws, 'dana-okafor') } } }));
      const before = ws.log.events.length;
      const missing = await c.callTool({ name: 'post_message', arguments: { channel: '#north-team' } });
      expect(missing.isError).toBe(true);
      expect((missing.content as { text: string }[])[0]!.text).toContain('Input validation error');
      expect(ws.log.events.length).toBe(before);
      const wrong = await c.callTool({ name: 'post_message', arguments: { channel: '@nobody', text: 'probe' } });
      expect(wrong.isError).toBe(true);
      expect(ws.log.events.slice(before)).toEqual([expect.objectContaining({ actor: 'dana-okafor', via: 'mcp', tool: 'chat.postMessage', kind: 'deny', outcome: 'denied', error: 'channel_not_found' })]);
    } finally {
      await c.close().catch(() => undefined);
      ws.stop();
    }
  });
});
