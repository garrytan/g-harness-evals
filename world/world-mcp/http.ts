// MCP over Streamable HTTP, mounted at /mcp on the world server. Stateless: each request builds a server bound
// to the actor named by the bearer token, so attribution never depends on model-controlled arguments.

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Member } from '../types.ts';
import type { WorldService } from '../services/world.ts';
import { buildMcpServer } from './tools.ts';

export async function handleMcpRequest(req: Request, service: WorldService, resolveActor: (req: Request) => Member | null): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed; this server is stateless and only serves POST' }, id: null }), {
      status: 405, headers: { 'content-type': 'application/json', allow: 'POST' },
    });
  }
  const actor = resolveActor(req);
  if (!actor) {
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'unknown or missing bearer token' }, id: null }), {
      status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="world-mcp"' },
    });
  }
  const server = buildMcpServer(service, actor);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void transport.close().catch(() => undefined);
  }
}
