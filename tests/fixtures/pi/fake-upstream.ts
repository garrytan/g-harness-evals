// A fake model endpoint for tests/pi-adapter.test.ts that answers the four APIs Pi's routes use, streamed: Anthropic
// Messages (POST .../v1/messages), OpenAI Responses (.../v1/responses) and Chat Completions (.../v1/chat/completions, the
// Particle and OpenRouter routes). It records every request (path, headers, parsed body) and answers by one rule: when the
// conversation ends on a user message whose text holds "[call whoami]", it asks for the world tool whoami; otherwise it
// answers with the text "fake reply <n>", n counting the requests it has served. A path holding "/refuse403/" gets the
// proxy's 403 refusal instead. "[call bash-sleep]" asks for Pi's bash tool with the command "sleep 3031" instead of whoami,
// for a turn that outlives its budget.
import { stream as anthropicStream } from '../../../scripts/gsta-135/fake-anthropic.ts';
import { stream as responsesStream } from '../fake-responses.ts';

export interface SeenRequest { method: string; path: string; headers: Record<string, string>; body: Record<string, any> }
export interface FakeUpstream { port: number; requests: SeenRequest[]; stop(): void }

const CALLS: Array<[string, string, Record<string, unknown>]> = [['[call whoami]', 'whoami', {}], ['[call bash-sleep]', 'bash', { command: 'sleep 3031' }]];
const text = (content: unknown): string => typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((c: any) => (c?.type === 'text' || c?.type === 'input_text' ? String(c.text ?? '') : '')).join('') : '';

/** The tool call asked for when the last conversation item is the user's own text (not a tool result) with a marker. */
function wantsTool(path: string, body: Record<string, any>): { name: string; input: Record<string, unknown> } | null {
  const items = path.endsWith('/v1/responses') ? (body.input ?? []).filter((i: any) => i?.type !== 'additional_tools') : body.messages ?? [];
  const last = items.at(-1);
  if (last?.role !== 'user' || (Array.isArray(last.content) && last.content.some((c: any) => c?.type === 'tool_result'))) return null;
  const hit = CALLS.find(([marker]) => text(last.content).includes(marker));
  return hit ? { name: hit[1], input: hit[2] } : null;
}

function chatStream(model: string, tool: { name: string; input: Record<string, unknown> } | null, reply: string, usage: boolean): string {
  const base = { id: 'chatcmpl-pi-fake', object: 'chat.completion.chunk', created: 1_790_000_000, model };
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
  const chunks: Array<Record<string, unknown>> = [chunk({ role: 'assistant', content: '' })];
  if (tool) chunks.push(chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.input) } }] }), chunk({}, 'tool_calls'));
  else chunks.push(chunk({ content: reply }), chunk({}, 'stop'));
  if (usage) chunks.push({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
  return chunks.map((c) => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n';
}

export function startFakeUpstream(hostname = '127.0.0.1'): FakeUpstream {
  const requests: SeenRequest[] = [];
  const server = Bun.serve({ hostname, port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    requests.push({ method: req.method, path, headers: Object.fromEntries(req.headers), body });
    if (path.includes('/refuse403/')) {
      return Response.json({ type: 'error', error: { type: 'permission_error', message: 'metering proxy: model not on the allowlist' } }, { status: 403 });
    }
    const n = requests.length;
    const tool = wantsTool(path, body);
    const reply = 'fake reply ' + n;
    const sse = { headers: { 'content-type': 'text/event-stream' } };
    if (path.endsWith('/v1/messages')) {
      const content = tool ? [{ type: 'tool_use', id: 'toolu_1', name: tool.name, input: tool.input }] : [{ type: 'text', text: reply }];
      const stop = tool ? 'tool_use' : 'end_turn';
      const msg = { id: 'msg_fake_' + n, type: 'message', role: 'assistant', model: body.model, content, stop_reason: stop, stop_sequence: null };
      return new Response(anthropicStream(msg, content, stop), sse);
    }
    if (path.endsWith('/v1/responses')) {
      const output = tool ? [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: tool.name, arguments: JSON.stringify(tool.input), status: 'completed' }]
        : [{ type: 'message', id: 'msg_fake_' + n, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: reply, annotations: [] }] }];
      return new Response(responsesStream('resp_fake_' + n, String(body.model), output), sse);
    }
    if (path.endsWith('/v1/chat/completions')) return new Response(chatStream(String(body.model), tool, reply, body.stream_options?.include_usage === true), sse);
    return Response.json({ error: { message: 'no such route on the fake: ' + path } }, { status: 404 });
  } });
  return { port: server.port!, requests, stop: () => server.stop(true) };
}
