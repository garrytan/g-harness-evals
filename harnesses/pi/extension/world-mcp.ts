// The world's MCP tools as Pi tools (harnesses/pi/README.md, "The world-MCP extension"). Pi is loaded with this file
// through -e; at load it asks the world MCP server (HE_WORLD_MCP_URL, Streamable HTTP, with the bearer
// HE_WORLD_MCP_TOKEN) for its tools and registers each one under the server's own name, with the server's description,
// input schema and annotations. A call is sent to the server as tools/call and its result handed back as it came. A
// pass-through: no instructions, prompt snippets or guidelines are added, no tool is renamed, filtered or wrapped.
//
// A failure before the tools are registered (the server unreachable, an HTTP error, no tool list) ends the Pi process
// with exit 2, so a turn never runs without the world. A call that fails at the transport level throws an error whose
// message starts with "world MCP transport error:", which Pi hands to the model as an error result; the adapter reads
// it from the JSON event stream and fails the turn. A JSON-RPC error answer throws "world MCP error <code>: ..." and a
// tool's own error result comes back with isError set: both are the model's to handle, like any tool error.

const PROTOCOL_VERSION = '2025-06-18';
const TRANSPORT = 'world MCP transport error: ';

type Rpc = { jsonrpc: '2.0'; id?: number; method: string; params?: Record<string, unknown> };
type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: Record<string, unknown> };
type McpContent = { type: string; text?: string; data?: string; mimeType?: string };

export default async function worldMcp(pi: any): Promise<void> {
  const url = process.env.HE_WORLD_MCP_URL;
  const token = process.env.HE_WORLD_MCP_TOKEN;
  if (!url || !token) fail('HE_WORLD_MCP_URL and HE_WORLD_MCP_TOKEN must be set');
  let sessionId: string | null = null;
  let protocol = PROTOCOL_VERSION;
  let nextId = 1;

  async function post(message: Rpc, signal?: AbortSignal): Promise<Record<string, any> | null> {
    const headers: Record<string, string> = { authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    if (message.method !== 'initialize') headers['mcp-protocol-version'] = protocol;
    let res: Response, body: string;
    try {
      res = await fetch(url!, { method: 'POST', headers, body: JSON.stringify(message), signal });
      body = await res.text();
    } catch (e) {
      throw new Error(TRANSPORT + (e as Error).message);
    }
    if (!res.ok) throw new Error(TRANSPORT + 'HTTP ' + res.status + ' ' + body.slice(0, 200));
    if (message.method === 'initialize') sessionId = res.headers.get('mcp-session-id');
    if (message.id === undefined) return null;
    const json = (res.headers.get('content-type') ?? '').includes('text/event-stream')
      ? body.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).find((l) => { try { return JSON.parse(l)?.id === message.id; } catch { return false; } })
      : body;
    let reply: Record<string, any>;
    try { reply = JSON.parse(json ?? ''); } catch { throw new Error(TRANSPORT + 'no JSON-RPC answer to ' + message.method + ': ' + body.slice(0, 200)); }
    if (reply.error) throw new Error('world MCP error ' + reply.error.code + ': ' + String(reply.error.message).slice(0, 300));
    return reply.result ?? {};
  }
  const rpc = (method: string, params: Record<string, unknown>, signal?: AbortSignal) => post({ jsonrpc: '2.0', id: nextId++, method, params }, signal) as Promise<Record<string, any>>;

  const tools: McpTool[] = [];
  try {
    const init = await rpc('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'harness-evals-pi-world-mcp', version: '1' } });
    if (typeof init.protocolVersion === 'string') protocol = init.protocolVersion;
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    let cursor: string | undefined;
    do {
      const page = await rpc('tools/list', cursor ? { cursor } : {});
      if (!Array.isArray(page.tools)) throw new Error('tools/list answered without a tool list');
      tools.push(...page.tools);
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
    } while (cursor);
  } catch (e) {
    fail('could not list the world tools at ' + url + ': ' + (e as Error).message);
  }

  for (const tool of tools) {
    pi.registerTool({
      name: tool.name,
      label: tool.name,
      description: tool.description ?? '',
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
      async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
        const result = await rpc('tools/call', { name: tool.name, arguments: params ?? {} }, signal);
        const content = (Array.isArray(result.content) ? result.content : []).map((c: McpContent) =>
          c.type === 'text' ? { type: 'text', text: c.text ?? '' }
            : c.type === 'image' ? { type: 'image', data: c.data ?? '', mimeType: c.mimeType ?? 'image/png' }
              : { type: 'text', text: JSON.stringify(c) });
        return { content, details: undefined, isError: result.isError === true };
      },
    });
  }
  process.stderr.write('world-mcp: ' + tools.length + ' tools registered from ' + url + ' (protocol ' + protocol + '): ' + tools.map((t) => t.name).join(' ') + '\n');
}

function fail(reason: string): never {
  process.stderr.write('world-mcp: HE-ADAPTER-004 ' + reason + '\n');
  process.exit(2);
}
