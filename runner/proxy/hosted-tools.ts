/**
 * Provider-hosted web tools (internal-task, HE-PROXY-006 in docs/errors.md). A lease proxy started with --refuse-hosted-tools
 * refuses a request that declares one, because the provider runs the search or fetch on its own servers: outside the
 * trial's egress rules and the captured-request audit, and billed per use outside the token prices the proxy meters.
 *
 * Covered shapes:
 *  - Anthropic Messages server tools: a `tools` entry whose type starts with web_search_ or web_fetch_ (web_search_20250305,
 *    web_fetch_20250910);
 *  - OpenAI Responses hosted tools: a `tools` entry of type web_search, web_search_preview or a dated variant
 *    (web_search_preview_2025_03_11, the types runner/proxy/sections.ts maps web_search_call to);
 *  - Chat Completions `web_search_options` set to anything but null.
 *
 * A harness's own function tool named web_search (Hermes declares one) runs in the trial's container and is not hosted:
 * only a tool's `type` is read, never its name.
 */
const HOSTED_TYPE = /^web_(search|fetch)(_|$)/;

/** Where a request declares a hosted web tool (`tools[2].type web_search_20250305`, `web_search_options`); empty when it declares none. */
export function hostedWebTools(body: Record<string, any> | undefined): string[] {
  if (!body) return [];
  const found: string[] = [];
  if (Array.isArray(body.tools)) {
    body.tools.forEach((tool: unknown, i: number) => {
      const type = (tool as { type?: unknown } | null)?.type;
      if (typeof type === 'string' && HOSTED_TYPE.test(type)) found.push(`tools[${i}].type ${/^[A-Za-z0-9._-]{1,64}$/.test(type) ? type : '(unreadable)'}`);
    });
  }
  if (body.web_search_options !== undefined && body.web_search_options !== null) found.push('web_search_options');
  return found;
}
