#!/usr/bin/env bun
// MCP over stdio for harnesses that only launch local servers. This process holds one actor's token and
// forwards every tools/list and tools/call to the world server's /mcp endpoint, so the HTTP server stays the
// single place where scope is enforced and events are logged.
//
//   WORLD_MCP_URL=http://127.0.0.1:8790/mcp WORLD_MCP_TOKEN=<actor token> bun world/world-mcp/stdio.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const url = process.env.WORLD_MCP_URL;
const token = process.env.WORLD_MCP_TOKEN;
if (!url || !token) {
  console.error('world-mcp stdio: set WORLD_MCP_URL and WORLD_MCP_TOKEN');
  process.exit(2);
}

const upstream = new Client({ name: 'world-mcp-stdio', version: '0.1.0' });
await upstream.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));

const server = new Server({ name: 'world-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => upstream.listTools());
server.setRequestHandler(CallToolRequestSchema, async (req) => upstream.callTool({ name: req.params.name, arguments: req.params.arguments ?? {} }));
await server.connect(new StdioServerTransport());
