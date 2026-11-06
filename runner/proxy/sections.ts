/**
 * Request sections and response extras for the metering proxy's usage lines (internal-task, usage-line schema v1).
 *
 * requestSections splits one provider request body into a byte partition by content type, with digests that let a
 * later pass find repeated prefixes and repeated tool results without the text. responseExtras reads the billing
 * classes the cost waterfall needs beside the proxy's existing fields (cache writes, 1-hour cache writes, reasoning
 * tokens) and the names of the tools the response called. Both are pure: they read parsed values and return numbers,
 * digests and declared tool names, never request or response text.
 *
 * Routes: Anthropic POST /v1/messages, OpenAI POST /v1/responses and POST /v1/chat/completions, and Particle POST
 * /v1/chat/completions (the chat completions reading serves both).
 *
 * The byte partition. Every field is Buffer.byteLength of JSON.stringify of a part of the parsed body, and the parts
 * never overlap, so they are substrings of JSON.stringify(body). "other" is body_bytes minus the rest: JSON framing,
 * message roles, keys, settings (model, max_tokens, temperature, thinking, stream), blocks of unknown types, and the
 * difference between the body as sent and its re-serialization (whitespace, escapes). A body whose re-serialized parts
 * come to more than body_bytes cannot be partitioned and throws, so the caller records sections_error.
 *   system: Anthropic system; Responses instructions and the content of system or developer input messages; chat
 *     completions the content of system or developer messages.
 *   tools: the declared tools list (chat completions also its legacy functions list).
 *   user_text, assistant_text: text content of user and assistant messages, each block whole (cache_control included).
 *   tool_use: Anthropic tool_use, server_tool_use and mcp_tool_use blocks; Responses items whose type ends in _call;
 *     chat completions tool_calls entries and a legacy function_call.
 *   tool_result: Anthropic blocks whose type ends in tool_result; Responses items whose type ends in _call_output;
 *     the content of chat completions tool and function messages. Media inside a tool result counts as media.
 *   opaque: Anthropic thinking and redacted_thinking blocks (signatures included); Responses reasoning and compaction
 *     items (encrypted_content included); chat completions reasoning fields on assistant messages.
 *   media: image, document, audio and file blocks, wherever a message or a tool result carries them.
 *
 * Digests are the first 16 hex characters of a sha256. The canonical serialization is JSON.stringify of the parsed
 * value with every cache_control key dropped, which keeps the key order the client sent. Harnesses move their cache
 * breakpoint forward on every request, so a message must digest the same with and without its marker.
 *   conv_sha256: of JSON.stringify([systemParts, firstUser]), where systemParts lists the values counted as system in
 *     body order up to the first message that is not a system or developer message (a system or developer message
 *     later in the conversation still counts as system bytes but leaves the conversation identity alone) and firstUser is the first user message (the whole message object, or a Responses string input), null
 *     when there is none.
 *   boundary_sha256[i]: of JSON.stringify(m[0]) + "\n" + ... + JSON.stringify(m[i]) + "\n", where m is Anthropic
 *     messages, Responses input (a string input is one message) or chat completions messages.
 *   tool_results[k].digest: of JSON.stringify(content), where content is the block's content (Anthropic), the item's
 *     output (Responses) or the message's content (chat completions), null when absent; bytes is the byte length of
 *     that serialization (0 when absent); index is the message index.
 */
import { createHash } from 'node:crypto';
import { sseUsage } from '../ledger/budget-ledger.ts';

export const SECTIONS_VERSION = 1;
/** What a called tool name becomes when the request's tools list does not declare it. */
export const UNLISTED_TOOL = '<unlisted>';
/** What a declared tool name becomes when it is not 1 to 64 word characters, dots or dashes (it is harness-controlled text). */
export const INVALID_TOOL = '<invalid>';
const TOOL_NAME = /^[\w.-]{1,64}$/;
export const SECTION_KEYS = ['system', 'tools', 'user_text', 'tool_result', 'assistant_text', 'tool_use', 'opaque', 'media', 'other'] as const;
export type SectionKey = typeof SECTION_KEYS[number];

export interface RequestSections extends Record<SectionKey, number> {
  v: 1;
  body_bytes: number;
  message_count: number;
  tools_declared: Array<{ name: string; bytes: number }>;
  conv_sha256: string;
  boundary_sha256: string[];
  tool_results: Array<{ digest: string; bytes: number; index: number }>;
}

export interface ResponseExtras { cache_write_tokens: number; cache_write_1h_tokens: number; reasoning_tokens: number; tools_called: string[] }

const ROUTES: Record<string, string[]> = { anthropic: ['/v1/messages'], openai: ['/v1/responses', '/v1/chat/completions'], particle: ['/v1/chat/completions'] };
/** True for the routes the section logger reads. */
export const sectionRoute = (provider: string, route: string) => (ROUTES[provider] ?? []).includes(route);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const size = (v: unknown) => (v === undefined ? 0 : Buffer.byteLength(JSON.stringify(v)));
const digest = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const canon = (v: unknown) => JSON.stringify(v, (k, x) => (k === 'cache_control' ? undefined : x));
const MEDIA = new Set(['image', 'document', 'audio', 'file', 'image_url', 'input_image', 'input_file', 'input_audio']);
const isMedia = (v: unknown) => isObj(v) && typeof v.type === 'string' && MEDIA.has(v.type);

class Partition {
  readonly bytes = Object.fromEntries(SECTION_KEYS.map((k) => [k, 0])) as Record<SectionKey, number>;
  readonly parts = Object.fromEntries(SECTION_KEYS.map((k) => [k, []])) as unknown as Record<SectionKey, unknown[]>;
  readonly toolResults: RequestSections['tool_results'] = [];
  /** How many system parts came before the first non-system message; unset while every message so far is system. */
  leadingSystem: number | undefined;
  /** Marks the end of the leading system run at the first message that is not a system or developer message. */
  message(isSystem: boolean) {
    if (!isSystem && this.leadingSystem === undefined) this.leadingSystem = this.parts.system.length;
  }
  add(key: SectionKey, value: unknown) {
    this.bytes[key] += size(value);
    this.parts[key].push(value);
  }
  /** A tool result (the container, and the field holding its content, or null when the container is the content): its
   *  media children count as media, the rest as tool_result. */
  toolResult(container: unknown, field: 'content' | 'output' | null, index: number) {
    const content = field === null ? container : (container as Obj)[field];
    const media = Array.isArray(content) ? content.filter(isMedia) : [];
    for (const m of media) this.add('media', m);
    this.bytes.tool_result += size(container) - media.reduce((s: number, m) => s + size(m), 0);
    const kept = media.length ? (content as unknown[]).filter((c) => !isMedia(c)) : content;
    this.parts.tool_result.push(field === null ? kept : { ...(container as Obj), [field]: kept });
    this.toolResults.push({ digest: digest(canon(content ?? null)), bytes: size(content), index });
  }
  /** Message content: a string, or parts whose media count as media, whose text counts under key and the rest as other. */
  content(key: SectionKey, content: unknown, textTypes: Set<string>) {
    if (typeof content === 'string') return this.add(key, content);
    if (!Array.isArray(content)) return;
    for (const part of content) {
      if (isMedia(part)) this.add('media', part);
      else if (isObj(part) && typeof part.type === 'string' && textTypes.has(part.type)) this.add(key, part);
    }
  }
}

const ANTHROPIC_TEXT = new Set(['text']);
const RESPONSES_TEXT = new Set(['input_text', 'output_text', 'text', 'refusal', 'summary_text']);
const CHAT_TEXT = new Set(['text', 'refusal']);
const roleKey = (role: unknown): SectionKey => (role === 'user' ? 'user_text' : role === 'assistant' ? 'assistant_text' : role === 'system' || role === 'developer' ? 'system' : 'other');

function anthropic(b: Obj, p: Partition, messages: unknown[]) {
  if (b.system !== undefined) p.add('system', b.system);
  messages.forEach((m, i) => {
    if (!isObj(m)) return;
    const key = m.role === 'user' ? 'user_text' : m.role === 'assistant' ? 'assistant_text' : 'other';
    if (!Array.isArray(m.content)) return p.content(key, m.content, ANTHROPIC_TEXT);
    for (const block of m.content) {
      const type = isObj(block) && typeof block.type === 'string' ? block.type : '';
      if (type === 'text') p.add(key, block);
      else if (type === 'thinking' || type === 'redacted_thinking') p.add('opaque', block);
      else if (MEDIA.has(type)) p.add('media', block);
      else if (type === 'tool_use' || type === 'server_tool_use' || type === 'mcp_tool_use') p.add('tool_use', block);
      else if (type.endsWith('tool_result')) p.toolResult(block, 'content', i);
    }
  });
}

function responses(b: Obj, p: Partition, items: unknown[]) {
  if (b.instructions !== undefined) p.add('system', b.instructions);
  if (typeof b.input === 'string') return p.add('user_text', b.input);
  items.forEach((item, i) => {
    if (!isObj(item)) return;
    const type = typeof item.type === 'string' ? item.type : item.type === undefined ? 'message' : '';
    if (type === 'additional_tools') return p.add('tools', item.tools ?? null);
    p.message(type === 'message' && roleKey(item.role) === 'system');
    if (type === 'message') p.content(roleKey(item.role), item.content, RESPONSES_TEXT);
    else if (type === 'reasoning' || type === 'compaction') p.add('opaque', item);
    else if (type.endsWith('_call_output')) p.toolResult(item, 'output', i);
    else if (type.endsWith('_call')) p.add('tool_use', item);
  });
}

function chat(b: Obj, p: Partition, messages: unknown[]) {
  if (b.functions !== undefined) p.add('tools', b.functions);
  messages.forEach((m, i) => {
    if (!isObj(m)) return;
    p.message(roleKey(m.role) === 'system');
    if (m.role === 'tool' || m.role === 'function') return p.toolResult(m.content, null, i);
    p.content(roleKey(m.role), m.content, CHAT_TEXT);
    if (m.role !== 'assistant') return;
    if (Array.isArray(m.tool_calls)) for (const call of m.tool_calls) p.add('tool_use', call);
    if (m.function_call !== undefined) p.add('tool_use', m.function_call);
    for (const k of ['reasoning_content', 'reasoning', 'reasoning_details', 'thinking']) if (m[k] !== undefined) p.add('opaque', m[k]);
  });
}

/** The name a declared tool goes by: Anthropic and Responses name, chat completions function.name, else its type (a built-in tool). */
function toolName(tool: unknown): string {
  const raw = !isObj(tool) ? '' : typeof tool.name === 'string' ? tool.name
    : isObj(tool.function) && typeof tool.function.name === 'string' ? tool.function.name : typeof tool.type === 'string' ? tool.type : '';
  return TOOL_NAME.test(raw) ? raw : INVALID_TOOL;
}

function partition(body: unknown, provider: string, route: string): { p: Partition; body: Obj; messages: unknown[]; responsesRoute: boolean } {
  if (!sectionRoute(provider, route)) throw new Error(`no section reader for ${provider} ${route}`);
  if (!isObj(body)) throw new Error('the request body is not a JSON object');
  const p = new Partition();
  if (body.tools !== undefined) p.add('tools', body.tools);
  const responsesRoute = route === '/v1/responses';
  const list = responsesRoute ? body.input : body.messages;
  const messages: unknown[] = Array.isArray(list) ? list : responsesRoute && typeof list === 'string' ? [list] : [];
  if (provider === 'anthropic') anthropic(body, p, messages);
  else if (responsesRoute) responses(body, p, messages);
  else chat(body, p, messages);
  return { p, body, messages, responsesRoute };
}

/** The values each section counted, in body order (a tool result without the media it carries), for calibration
 *  (scripts/waterfall/calibrate.ts); "other" lists only the content of messages with an unknown role, since framing is
 *  no value. Throws as requestSections does. */
export function sectionParts(body: unknown, provider: string, route: string): Record<SectionKey, unknown[]> {
  return partition(body, provider, route).p.parts;
}

/**
 * The sections of one request body: body as parsed, rawBytes the byte length of the body as received. Throws when
 * the body is not a JSON object, the route is not one the logger reads, or the parts do not fit in rawBytes.
 */
export function requestSections(raw: unknown, rawBytes: number, provider: string, route: string): RequestSections {
  const { p, body, messages, responsesRoute } = partition(raw, provider, route);
  if (!Number.isSafeInteger(rawBytes) || rawBytes < 0) throw new Error('the body byte count is not a non-negative integer');
  const counted = SECTION_KEYS.reduce((s, k) => s + p.bytes[k], 0);
  if (counted > rawBytes) throw new Error(`the sections re-serialize to ${counted} bytes, more than the ${rawBytes}-byte body`);
  p.bytes.other += rawBytes - counted;
  const firstUser = messages.find((m) => typeof m === 'string' || (isObj(m) && m.role === 'user')) ?? null;
  const prefix = createHash('sha256');
  const boundary = messages.map((m) => { prefix.update(canon(m) + '\n'); return prefix.copy().digest('hex').slice(0, 16); });
  const additional = responsesRoute ? messages.flatMap((m) => (isObj(m) && m.type === 'additional_tools' && Array.isArray(m.tools) ? m.tools : [])) : [];
  const flat = (list: unknown[]): unknown[] => list.flatMap((t) => (isObj(t) && t.type === 'namespace' && Array.isArray(t.tools) ? flat(t.tools) : [t]));
  const declared = flat([...(Array.isArray(body.tools) ? body.tools : []), ...additional, ...(route === '/v1/chat/completions' && Array.isArray(body.functions) ? body.functions : [])]);
  return {
    v: SECTIONS_VERSION, body_bytes: rawBytes, ...p.bytes, message_count: messages.length,
    tools_declared: declared.map((t) => ({ name: toolName(t), bytes: size(t) })),
    conv_sha256: digest(canon([p.parts.system.slice(0, p.leadingSystem), firstUser])), boundary_sha256: boundary, tool_results: p.toolResults,
  };
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

const BUILTIN = 'builtin:';

/** The tool names a parsed response, or the events of a streamed one, called, in order. A Responses built-in call item
 *  (web_search_call and the like) has no name, so it is BUILTIN plus its type without "_call". */
function calledNames(route: string, response: unknown, events: Obj[]): string[] {
  const CALL_ITEMS = ['function_call', 'custom_tool_call'];
  const named = (v: unknown, types: string[]) => (isObj(v) && types.includes(v.type as string) && typeof v.name === 'string' ? [v.name] : []);
  const item = (v: unknown) => (isObj(v) && typeof v.type === 'string' && v.type.endsWith('_call') && !CALL_ITEMS.includes(v.type) ? [`${BUILTIN}${v.type.slice(0, -5)}`] : named(v, CALL_ITEMS));
  const fn = (v: unknown) => (isObj(v) && typeof v.name === 'string' && v.name ? [v.name] : []);
  const chatCalls = (msg: unknown) => (isObj(msg) ? [...(Array.isArray(msg.tool_calls) ? msg.tool_calls.flatMap((c) => (isObj(c) ? fn(c.function) : [])) : []), ...fn(msg.function_call)] : []);
  if (route === '/v1/messages') {
    const blocks = typeof response === 'string' ? events.filter((e) => e.type === 'content_block_start').map((e) => e.content_block) : isObj(response) && Array.isArray(response.content) ? response.content : [];
    return blocks.flatMap((b) => named(b, ['tool_use', 'server_tool_use']));
  }
  if (route === '/v1/responses') {
    if (typeof response !== 'string') return isObj(response) && Array.isArray(response.output) ? response.output.flatMap(item) : [];
    const added = events.filter((e) => e.type === 'response.output_item.added').map((e) => e.item);
    if (added.length) return added.flatMap(item);
    const final = events.map((e) => e.response).filter((r): r is Obj => isObj(r) && Array.isArray(r.output)).at(-1);
    return final ? (final.output as unknown[]).flatMap(item) : [];
  }
  const choices = (v: unknown) => (isObj(v) && Array.isArray(v.choices) ? v.choices.filter(isObj) : []);
  if (typeof response !== 'string') return choices(response).flatMap((c) => chatCalls(c.message));
  return events.flatMap((e) => choices(e).flatMap((c) => chatCalls(c.delta)));
}

/**
 * The billing-class fields and called tools of one response: response is the parsed JSON body, or the text of a
 * streamed (SSE) body. Cache writes follow the ledger's usageCost: Anthropic cache_creation_input_tokens plus an OpenAI
 * input or prompt tokens detail cache_write_tokens; the 1-hour part is Anthropic cache_creation.ephemeral_1h_input_tokens,
 * capped at the cache-write total as the ledger prices it. Reasoning tokens are OpenAI output or completion tokens
 * details reasoning_tokens (already inside output_tokens). A called name the request did not declare is UNLISTED_TOOL; a
 * Responses built-in call matches the declared built-in of its type: the type itself, or its _use, _preview and dated
 * variants (web_search_call: web_search, web_search_preview, web_search_preview_2025_03_11), never another function name.
 */
export function responseExtras(provider: string, route: string, response: unknown, declared: readonly string[]): ResponseExtras {
  const events: Obj[] = [];
  if (typeof response === 'string') {
    for (const line of response.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try { const e = JSON.parse(data); if (isObj(e)) events.push(e); } catch { /* a broken event carries nothing countable */ }
    }
  }
  const raw = typeof response === 'string' ? sseUsage(response) : isObj(response) ? response.usage : null;
  const u: Obj = isObj(raw) ? raw : {};
  const details = (k: string): Obj => (isObj(u[k]) ? u[k] as Obj : {});
  const input = isObj(u.input_tokens_details) ? details('input_tokens_details') : details('prompt_tokens_details');
  const cacheWrite = count(u.cache_creation_input_tokens) + count(input.cache_write_tokens);
  const oneHour = Math.min(cacheWrite, count(details('cache_creation').ephemeral_1h_input_tokens));
  const reasoning = count(details('output_tokens_details').reasoning_tokens) + count(details('completion_tokens_details').reasoning_tokens);
  const known = new Set(declared);
  const called = sectionRoute(provider, route) ? calledNames(route, response, events) : [];
  return { cache_write_tokens: cacheWrite, cache_write_1h_tokens: oneHour, reasoning_tokens: reasoning, tools_called: called.map((n) => {
    if (!n.startsWith(BUILTIN)) return known.has(n) ? n : UNLISTED_TOOL;
    const base = n.slice(BUILTIN.length);
    const variant = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_use)?(_preview)?(_\\d{4}_\\d{2}_\\d{2}|_\\d{8})?$`);
    return known.has(base) ? base : declared.find((d) => variant.test(d)) ?? UNLISTED_TOOL;
  }) };
}
