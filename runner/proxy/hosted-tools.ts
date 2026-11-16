/**
 * Provider-hosted tools (internal-task, HE-PROXY-006 in docs/errors.md). A lease proxy started with --refuse-hosted-tools
 * refuses a request that declares one, because the provider runs the search or fetch on its own servers: outside the
 * trial's egress rules and the captured-request audit, and billed per use outside the token prices the proxy meters.
 * On the google and xai routes (internal-task) the proxy refuses them with or without the flag, since it cannot price their
 * per-call fees.
 *
 * Covered shapes:
 *  - Anthropic Messages server tools: a `tools` entry whose type starts with web_search_ or web_fetch_ (web_search_20250305,
 *    web_fetch_20250910);
 *  - OpenAI Responses hosted tools: a `tools` entry of type web_search, web_search_preview or a dated variant
 *    (web_search_preview_2025_03_11, the types runner/proxy/sections.ts maps web_search_call to);
 *  - Chat Completions `web_search_options` set to anything but null;
 *  - google (Gemini generateContent): a `tools` entry holding googleSearch, googleSearchRetrieval, enterpriseWebSearch,
 *    codeExecution, urlContext, googleMaps or fileSearch (or the snake_case spelling of each), which Google runs as search
 *    or Maps grounding, code execution, URL fetches or file search;
 *  - xai: a `tools` entry of a server-side tool type (web_search, x_search, attachment_search, collections_search,
 *    file_search, code_execution, code_interpreter, mcp; docs.x.ai/developers/pricing, Tools Pricing), or Chat
 *    Completions `search_parameters` (Live Search) set to anything but null.
 *
 * A harness's own function tool named web_search (Hermes declares one) runs in the trial's container and is not hosted:
 * only a tool's `type` (or, on google, its hosted-tool key) is read, never its name.
 *
 * Install slots (internal-task) allow these tools and meter their fees instead: unpricedWebTools names the declarations with no
 * fee row in the price table, which an install slot refuses (HE-PROXY-011), and webToolUse counts the calls a response
 * reports and prices them from TOOL_FEES.
 */
import { sseUsage } from '../ledger/budget-ledger.ts';
import { TOOL_FEES } from '../pricing/model-pricing.ts';

const HOSTED_TYPE = /^web_(search|fetch)(_|$)/;
const GOOGLE_HOSTED = ['googleSearch', 'googleSearchRetrieval', 'enterpriseWebSearch', 'codeExecution', 'urlContext', 'googleMaps', 'fileSearch',
  'google_search', 'google_search_retrieval', 'enterprise_web_search', 'code_execution', 'url_context', 'google_maps', 'file_search'];
const XAI_HOSTED_TYPES = new Set(['web_search', 'x_search', 'attachment_search', 'collections_search', 'file_search', 'code_execution', 'code_interpreter', 'mcp']);

/** Where a request declares a hosted tool (`tools[2].type web_search_20250305`, `tools[0].googleSearch`, `web_search_options`); empty when it declares none.
 *  `provider` (the proxy route) adds that provider's own shapes; without it only the Anthropic and OpenAI shapes are read. */
export function hostedWebTools(body: Record<string, any> | undefined, provider?: string): string[] {
  if (!body) return [];
  const found: string[] = [];
  if (Array.isArray(body.tools)) {
    body.tools.forEach((tool: unknown, i: number) => {
      const type = (tool as { type?: unknown } | null)?.type;
      if (typeof type === 'string' && (HOSTED_TYPE.test(type) || (provider === 'xai' && XAI_HOSTED_TYPES.has(type)))) found.push(`tools[${i}].type ${/^[A-Za-z0-9._-]{1,64}$/.test(type) ? type : '(unreadable)'}`);
      if (provider === 'google' && tool && typeof tool === 'object') for (const k of GOOGLE_HOSTED) if (Object.hasOwn(tool, k)) found.push(`tools[${i}].${k}`);
    });
  }
  if (body.web_search_options !== undefined && body.web_search_options !== null) found.push('web_search_options');
  if (provider === 'xai' && body.search_parameters !== undefined && body.search_parameters !== null) found.push('search_parameters');
  return found;
}

/** The tool_fees row a declared hosted tool type bills under: Anthropic's dated web_search_ and web_fetch_ versions as
 *  web_search and web_fetch, OpenAI's web_search and its dated variants as web_search, and any other type as itself
 *  (web_search_preview has no row: its fee depends on whether the model reasons, which the proxy cannot tell). */
function feeTool(provider: string, type: string): string {
  if (provider === 'anthropic') return type.replace(/_\d{8}$/, '');
  if (provider === 'openai' && /^web_search(_\d{4}_\d{2}_\d{2})?$/.test(type)) return 'web_search';
  return type;
}

/** internal-task: the hosted web tools a request declares that have no fee row in the price table (TOOL_FEES), described as
 *  hostedWebTools describes them; Chat Completions `web_search_options` never has one. Empty when every one is priced. */
export function unpricedWebTools(provider: string, body: Record<string, any> | undefined): string[] {
  if (!body) return [];
  const found: string[] = [];
  if (Array.isArray(body.tools)) {
    body.tools.forEach((tool: unknown, i: number) => {
      const type = (tool as { type?: unknown } | null)?.type;
      if (typeof type === 'string' && HOSTED_TYPE.test(type) && !Object.hasOwn(TOOL_FEES, `${provider}:${feeTool(provider, type)}`)) found.push(`tools[${i}].type ${/^[A-Za-z0-9._-]{1,64}$/.test(type) ? type : '(unreadable)'}`);
    });
  }
  if (body.web_search_options !== undefined && body.web_search_options !== null) found.push('web_search_options');
  return found;
}

/** internal-task: the most an install-slot request's priced hosted web tools can bill, reserved on top of its tokens: each declared
 *  tool's fee row times its `max_uses` when the request sets a positive whole one, else WEB_TOOL_ALLOWANCE_CALLS calls. */
export const WEB_TOOL_ALLOWANCE_CALLS = 20;
export function webToolAllowance(provider: string, body: Record<string, any> | undefined): number {
  if (!body || !Array.isArray(body.tools)) return 0;
  return body.tools.reduce((usd: number, tool: unknown) => {
    const { type, max_uses } = (tool ?? {}) as { type?: unknown; max_uses?: unknown };
    if (typeof type !== 'string' || !HOSTED_TYPE.test(type)) return usd;
    const calls = Number.isInteger(max_uses) && (max_uses as number) > 0 ? max_uses as number : WEB_TOOL_ALLOWANCE_CALLS;
    return usd + calls * (TOOL_FEES[`${provider}:${feeTool(provider, type)}`] ?? 0);
  }, 0);
}

export interface WebToolUse { web_search_calls: number; web_search_usd: number; web_fetch_calls: number; web_fetch_usd: number }

/** internal-task: the server-side web tool calls a response reports and their fees from TOOL_FEES. Anthropic Messages:
 *  `usage.server_tool_use.web_search_requests` and `web_fetch_requests` (a stream's merged usage, so its final
 *  message_delta). OpenAI Responses: the `web_search_call` items of the response's `output`; in a stream, those of its terminal
 *  response.completed, response.incomplete or response.failed event together with every response.output_item.done item, by id,
 *  so a stream cut off before its terminal event still counts the searches it completed. `response` is the parsed body, or a
 *  stream's text. */
export function webToolUse(provider: string, route: string, response: unknown, streamed: boolean): WebToolUse {
  const count = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? v as number : 0);
  let search = 0, fetch = 0;
  if (provider === 'anthropic' && route === '/v1/messages') {
    const usage = streamed ? sseUsage(String(response ?? '')) : (response as { usage?: unknown } | null)?.usage;
    const tools = (usage as { server_tool_use?: Record<string, unknown> } | null | undefined)?.server_tool_use;
    search = count(tools?.web_search_requests);
    fetch = count(tools?.web_fetch_requests);
  } else if (provider === 'openai' && route === '/v1/responses') {
    const ids = new Set<string>();
    let unnamed = 0;
    const add = (item: unknown, fromDone = false) => {
      const call = item as { type?: unknown; id?: unknown } | null;
      if (call?.type !== 'web_search_call') return;
      if (typeof call.id === 'string') ids.add(call.id); else if (!fromDone) unnamed++;
    };
    const addOutput = (output: unknown) => { if (Array.isArray(output)) for (const item of output) add(item); };
    if (!streamed) addOutput((response as { output?: unknown } | null)?.output);
    else {
      for (const line of String(response ?? '').split('\n')) {
        if (!line.startsWith('data:')) continue;
        try {
          const event = JSON.parse(line.slice(5).trim()) as { type?: unknown; item?: unknown; response?: { output?: unknown } };
          if (['response.completed', 'response.incomplete', 'response.failed'].includes(String(event.type))) addOutput(event.response?.output);
          else if (event.type === 'response.output_item.done') add(event.item, true);
        } catch { /* [DONE] or a broken line */ }
      }
    }
    search = ids.size + unnamed;
  }
  const fee = (tool: string, calls: number) => (calls ? calls * (TOOL_FEES[`${provider}:${tool}`] ?? 0) : 0);
  return { web_search_calls: search, web_search_usd: fee('web_search', search), web_fetch_calls: fetch, web_fetch_usd: fee('web_fetch', fetch) };
}
