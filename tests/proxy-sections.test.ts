// internal-task: runner/proxy/sections.ts, the request byte partition and digests, and the response billing-class fields and
// called tools, per provider and route. Pure functions; no proxy, no network, no key.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { requestSections, responseExtras, SECTION_KEYS, sectionRoute, UNLISTED_TOOL, type RequestSections } from '../runner/proxy/sections.ts';

const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
const sha16 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const sse = (events: unknown[]) => events.map((e) => (e === '[DONE]' ? 'data: [DONE]\n\n' : `event: x\ndata: ${JSON.stringify(e)}\n\n`)).join('');
const sectionsOf = (body: unknown, provider: string, route: string, raw = JSON.stringify(body)) => requestSections(body, Buffer.byteLength(raw), provider, route);
const partitionSum = (s: RequestSections) => SECTION_KEYS.reduce((a, k) => a + s[k], 0);

const A_TOOLS = [
  { name: 'search_docs', description: 'DESC-search tool zeta', input_schema: { type: 'object', properties: { q: { type: 'string', description: 'DESC-query field' } } } },
  { name: 'read_page', description: 'DESC-read tool eta', input_schema: { type: 'object' }, cache_control: { type: 'ephemeral' } },
];
const A_IMAGE = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'IMGDATA-iVBORw0KGgo' } };
const A_DOC = { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'DOCDATA-attached notes' } };
const A_TOOL_USE_1 = { type: 'tool_use', id: 'toolu_01', name: 'search_docs', input: { q: 'QUERY-needle' } };
const A_TOOL_USE_2 = { type: 'tool_use', id: 'toolu_02', name: 'read_page', input: {} };
const A_RESULT_1 = { type: 'tool_result', tool_use_id: 'toolu_01', content: [{ type: 'text', text: 'RESULT-doc body' }, A_IMAGE] };
const A_RESULT_2 = { type: 'tool_result', tool_use_id: 'toolu_02', content: 'RESULT-page text' };
const A_THINKING = { type: 'thinking', thinking: 'THINK-private reasoning', signature: 'SIG-EqQBCgIYAhIM' };
const A_REDACTED = { type: 'redacted_thinking', data: 'REDACTED-blob' };
const A_ASSIST = { type: 'text', text: 'ASSIST-let me look' };
const A_FOLLOW = { type: 'text', text: 'USER-follow up', cache_control: { type: 'ephemeral', ttl: '1h' } };
const A_SYSTEM_BLOCKS = [{ type: 'text', text: 'SYSTEM-alpha you are an agent' }, { type: 'text', text: 'SYSTEM-beta rules', cache_control: { type: 'ephemeral' } }];
const anthropicBody = {
  model: 'claude-opus-5-5', max_tokens: 4096, stream: true, thinking: { type: 'enabled', budget_tokens: 2048 },
  system: A_SYSTEM_BLOCKS, tools: A_TOOLS,
  messages: [
    { role: 'user', content: 'USER-first question about café ☕ and naïve 日本語' },
    { role: 'assistant', content: [A_THINKING, A_ASSIST, A_TOOL_USE_1] },
    { role: 'user', content: [A_RESULT_1, A_FOLLOW] },
    { role: 'assistant', content: [A_REDACTED, A_TOOL_USE_2] },
    { role: 'user', content: [A_RESULT_2, A_DOC, { type: 'search_result', source: 'SRC-unknown block', content: [] }] },
  ],
};

const R_TOOLS = [{ type: 'function', name: 'run_shell', description: 'DESC-shell tool', parameters: { type: 'object', properties: {} } }, { type: 'web_search' }];
const R_IMAGE = { type: 'input_image', image_url: 'data:image/png;base64,IMGB64-responses' };
const R_TEXT = { type: 'input_text', text: 'USER-please run it' };
const R_REASONING = { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'SUMMARY-thought' }], encrypted_content: 'ENC-gAAAAABo' };
const R_CALL = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'run_shell', arguments: '{"cmd":"ARGS-ls -la"}' };
const R_OUTPUT = { type: 'function_call_output', call_id: 'call_1', output: 'OUTPUT-file list' };
const R_OUTPUT_IMG = { type: 'function_call_output', call_id: 'call_2', output: [{ type: 'input_text', text: 'OUTPUT-screenshot caption' }, R_IMAGE] };
const R_ASSIST = { type: 'output_text', text: 'ASSIST-done', annotations: [] };
const responsesBody = {
  model: 'gpt-6.1-sol', instructions: 'INSTR-be helpful', reasoning: { effort: 'high' }, store: false, include: ['reasoning.encrypted_content'], tools: R_TOOLS,
  input: [
    { role: 'developer', content: 'DEV-policy text' },
    { role: 'user', content: [R_TEXT, R_IMAGE] },
    R_REASONING, R_CALL, R_OUTPUT,
    { type: 'message', role: 'assistant', content: [R_ASSIST] },
    R_OUTPUT_IMG,
    { type: 'item_reference', id: 'msg_REF-x' },
  ],
};

const C_TOOLS = [{ type: 'function', function: { name: 'lookup', description: 'DESC-lookup tool', parameters: { type: 'object' } } }];
const C_IMAGE = { type: 'image_url', image_url: { url: 'data:image/png;base64,IMG-chat' } };
const C_CALL = { id: 'call_c1', type: 'function', function: { name: 'lookup', arguments: '{"k":"ARG-chat key"}' } };
const chatBody = {
  model: 'particle-1', stream: true, tools: C_TOOLS,
  messages: [
    { role: 'system', content: 'SYS-chat system' },
    { role: 'user', content: [{ type: 'text', text: 'USER-chat question' }, C_IMAGE] },
    { role: 'assistant', content: null, reasoning_content: 'REASON-chat chain', tool_calls: [C_CALL] },
    { role: 'tool', tool_call_id: 'call_c1', content: 'TOOLRES-chat result' },
    { role: 'assistant', content: 'ASSIST-chat answer' },
  ],
};

describe('requestSections: Anthropic /v1/messages', () => {
  const s = sectionsOf(anthropicBody, 'anthropic', '/v1/messages');
  test('every block lands in its bucket, media inside a tool result counts as media, and the nine fields sum to body_bytes', () => {
    expect(s.v).toBe(1);
    expect(s.body_bytes).toBe(size(anthropicBody));
    expect(s.system).toBe(size(A_SYSTEM_BLOCKS));
    expect(s.tools).toBe(size(A_TOOLS));
    expect(s.user_text).toBe(size(anthropicBody.messages[0]!.content) + size(A_FOLLOW));
    expect(s.assistant_text).toBe(size(A_ASSIST));
    expect(s.tool_use).toBe(size(A_TOOL_USE_1) + size(A_TOOL_USE_2));
    expect(s.tool_result).toBe(size(A_RESULT_1) - size(A_IMAGE) + size(A_RESULT_2));
    expect(s.opaque).toBe(size(A_THINKING) + size(A_REDACTED));
    expect(s.media).toBe(size(A_IMAGE) + size(A_DOC));
    expect(partitionSum(s)).toBe(s.body_bytes);
    expect(s.other).toBeGreaterThan(0);
    expect(s.message_count).toBe(5);
  });
  test('tools_declared, tool_results and digests', () => {
    const canon = (v: unknown) => JSON.stringify(v, (k, x) => (k === 'cache_control' ? undefined : x));
    expect(s.tools_declared).toEqual(A_TOOLS.map((t) => ({ name: t.name, bytes: size(t) })));
    expect(s.tool_results).toEqual([
      { digest: sha16(canon(A_RESULT_1.content)), bytes: size(A_RESULT_1.content), index: 2 },
      { digest: sha16(canon(A_RESULT_2.content)), bytes: size(A_RESULT_2.content), index: 4 },
    ]);
    expect(s.conv_sha256).toBe(sha16(canon([[A_SYSTEM_BLOCKS], anthropicBody.messages[0]])));
    let acc = '';
    expect(s.boundary_sha256).toEqual(anthropicBody.messages.map((m) => sha16(acc += canon(m) + '\n')));
    for (const d of [s.conv_sha256, ...s.boundary_sha256, ...s.tool_results.map((t) => t.digest)]) expect(d).toMatch(/^[0-9a-f]{16}$/);
  });
  test('a later turn of the same conversation keeps conv_sha256 and every earlier boundary digest; another system prompt changes conv_sha256', () => {
    const next = { ...anthropicBody, messages: [...anthropicBody.messages, { role: 'assistant', content: [{ type: 'text', text: 'ASSIST-final' }] }] };
    const n = sectionsOf(next, 'anthropic', '/v1/messages');
    expect(n.conv_sha256).toBe(s.conv_sha256);
    expect(n.boundary_sha256.slice(0, 5)).toEqual(s.boundary_sha256);
    expect(n.boundary_sha256).toHaveLength(6);
    expect(sectionsOf({ ...anthropicBody, system: 'SYSTEM-other' }, 'anthropic', '/v1/messages').conv_sha256).not.toBe(s.conv_sha256);
  });
  test('moving or dropping cache_control markers leaves every digest unchanged', () => {
    const strip = (v: unknown) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'cache_control' ? undefined : x)));
    const bare = sectionsOf(strip(anthropicBody), 'anthropic', '/v1/messages');
    expect(bare.conv_sha256).toBe(s.conv_sha256);
    expect(bare.boundary_sha256).toEqual(s.boundary_sha256);
    expect(bare.tool_results.map((t) => t.digest)).toEqual(s.tool_results.map((t) => t.digest));
  });
  test('system as a string, a tiny body counted by hand, and non-ASCII text counted in UTF-8 bytes', () => {
    const body = { model: 'm', system: 'S', messages: [{ role: 'user', content: 'é☕' }] };
    const t = sectionsOf(body, 'anthropic', '/v1/messages');
    expect(t.system).toBe(3);
    expect(t.user_text).toBe(2 + 2 + 3);
    expect(t.body_bytes).toBe(Buffer.byteLength(JSON.stringify(body)));
    expect(t.other).toBe(t.body_bytes - 3 - 7);
    expect(t.tools_declared).toEqual([]);
    expect(t.tool_results).toEqual([]);
  });
  test('whitespace and escapes in the body as sent go to other; the content buckets do not move', () => {
    const pretty = JSON.stringify(anthropicBody, null, 2);
    const escaped = JSON.stringify(anthropicBody).replace(/é/g, '\\u00e9');
    for (const raw of [pretty, escaped]) {
      const p = sectionsOf(JSON.parse(raw), 'anthropic', '/v1/messages', raw);
      expect(p.body_bytes).toBe(Buffer.byteLength(raw));
      for (const k of SECTION_KEYS.filter((k) => k !== 'other')) expect(p[k]).toBe(s[k]);
      expect(p.other - s.other).toBe(p.body_bytes - s.body_bytes);
      expect(partitionSum(p)).toBe(p.body_bytes);
    }
  });
  test('two tool results with the same content share a digest', () => {
    const body = { model: 'm', messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'RESULT-same' }, { type: 'tool_result', tool_use_id: 'b', content: 'RESULT-same' }] }] };
    const [x, y] = sectionsOf(body, 'anthropic', '/v1/messages').tool_results;
    expect(x!.digest).toBe(y!.digest);
  });
});

describe('requestSections: OpenAI /v1/responses', () => {
  const s = sectionsOf(responsesBody, 'openai', '/v1/responses');
  test('instructions and developer input are system, reasoning is opaque, calls and outputs are tool_use and tool_result, images are media', () => {
    expect(s.system).toBe(size('INSTR-be helpful') + size('DEV-policy text'));
    expect(s.tools).toBe(size(R_TOOLS));
    expect(s.user_text).toBe(size(R_TEXT));
    expect(s.assistant_text).toBe(size(R_ASSIST));
    expect(s.opaque).toBe(size(R_REASONING));
    expect(s.tool_use).toBe(size(R_CALL));
    expect(s.tool_result).toBe(size(R_OUTPUT) + size(R_OUTPUT_IMG) - size(R_IMAGE));
    expect(s.media).toBe(2 * size(R_IMAGE));
    expect(partitionSum(s)).toBe(s.body_bytes);
    expect(s.message_count).toBe(8);
    expect(s.tools_declared.map((t) => t.name)).toEqual(['run_shell', 'web_search']);
    expect(s.tool_results).toEqual([
      { digest: sha16(JSON.stringify(R_OUTPUT.output)), bytes: size(R_OUTPUT.output), index: 4 },
      { digest: sha16(JSON.stringify(R_OUTPUT_IMG.output)), bytes: size(R_OUTPUT_IMG.output), index: 6 },
    ]);
    expect(s.conv_sha256).toBe(sha16(JSON.stringify([['INSTR-be helpful', 'DEV-policy text'], responsesBody.input[1]])));
    expect(s.boundary_sha256).toHaveLength(8);
  });
  test('a developer message later in the conversation counts as system bytes but keeps conv_sha256', () => {
    const later = { ...responsesBody, input: [...responsesBody.input, { role: 'developer', content: 'DEV-mid-run reminder' }] };
    const t = sectionsOf(later, 'openai', '/v1/responses');
    expect(t.conv_sha256).toBe(s.conv_sha256);
    expect(t.system).toBe(s.system + size('DEV-mid-run reminder'));
    const chatLater = { ...chatBody, messages: [...chatBody.messages, { role: 'system', content: 'SYS-late' }] };
    expect(sectionsOf(chatLater, 'openai', '/v1/chat/completions').conv_sha256).toBe(sectionsOf(chatBody, 'openai', '/v1/chat/completions').conv_sha256);
  });
  test('Codex additional_tools items count as tools, their namespaced declarations are declared, and they do not end the leading system run', () => {
    const extra = { type: 'additional_tools', tools: [{ type: 'namespace', name: 'mcp', tools: [{ type: 'function', name: 'read_doc', parameters: {} }] }, { type: 'function', name: 'apply_patch', parameters: {} }] };
    const body = (policy: string) => ({ model: 'gpt-6.1-sol', input: [{ role: 'developer', content: 'PERMS-x' }, extra, { role: 'developer', content: policy }, { role: 'user', content: 'USER-y' }] });
    const s = requestSections(body('POLICY-a'), Buffer.byteLength(JSON.stringify(body('POLICY-a'))), 'openai', '/v1/responses');
    expect(s.tools).toBe(Buffer.byteLength(JSON.stringify(extra.tools)));
    expect(s.tools_declared.map((t) => t.name)).toEqual(['read_doc', 'apply_patch']);
    const other = requestSections(body('POLICY-b'), Buffer.byteLength(JSON.stringify(body('POLICY-b'))), 'openai', '/v1/responses');
    expect(other.conv_sha256).not.toBe(s.conv_sha256);
  });
  test('a string input is one user message', () => {
    const t = sectionsOf({ model: 'gpt-6.1-sol', input: 'USER-hi there' }, 'openai', '/v1/responses');
    expect(t.user_text).toBe(size('USER-hi there'));
    expect(t.message_count).toBe(1);
    expect(t.boundary_sha256).toEqual([sha16(JSON.stringify('USER-hi there') + '\n')]);
    expect(t.conv_sha256).toBe(sha16(JSON.stringify([[], 'USER-hi there'])));
  });
});

describe('requestSections: OpenAI /v1/chat/completions', () => {
  const s = sectionsOf(chatBody, 'openai', '/v1/chat/completions');
  test('system content, user text and image parts, tool_calls, reasoning fields and role tool content', () => {
    expect(s.system).toBe(size('SYS-chat system'));
    expect(s.tools).toBe(size(C_TOOLS));
    expect(s.user_text).toBe(size({ type: 'text', text: 'USER-chat question' }));
    expect(s.media).toBe(size(C_IMAGE));
    expect(s.tool_use).toBe(size(C_CALL));
    expect(s.opaque).toBe(size('REASON-chat chain'));
    expect(s.tool_result).toBe(size('TOOLRES-chat result'));
    expect(s.assistant_text).toBe(size('ASSIST-chat answer'));
    expect(partitionSum(s)).toBe(s.body_bytes);
    expect(s.message_count).toBe(5);
    expect(s.tools_declared).toEqual([{ name: 'lookup', bytes: size(C_TOOLS[0]) }]);
    expect(s.tool_results).toEqual([{ digest: sha16(JSON.stringify('TOOLRES-chat result')), bytes: size('TOOLRES-chat result'), index: 3 }]);
  });
  test('legacy functions are declared tools and a legacy function_call is tool_use', () => {
    const fns = [{ name: 'old_fn', parameters: {} }];
    const body = { model: 'm', functions: fns, messages: [{ role: 'assistant', content: null, function_call: { name: 'old_fn', arguments: '{}' } }, { role: 'function', name: 'old_fn', content: 'FNRES-x' }] };
    const t = sectionsOf(body, 'openai', '/v1/chat/completions');
    expect(t.tools).toBe(size(fns));
    expect(t.tool_use).toBe(size(body.messages[0]!.function_call));
    expect(t.tool_result).toBe(size('FNRES-x'));
    expect(t.tools_declared.map((x) => x.name)).toEqual(['old_fn']);
  });
});

describe('requestSections refusals and edge bodies', () => {
  test('a body that is not a JSON object, an unknown route or a bad byte count throws', () => {
    for (const body of [null, 'a string', [1, 2], 42, undefined]) expect(() => requestSections(body, 10, 'anthropic', '/v1/messages')).toThrow('not a JSON object');
    expect(() => requestSections({}, 2, 'openai', '/v1/embeddings')).toThrow('no section reader');
    expect(() => requestSections({}, 2, 'voyage', '/v1/messages')).toThrow('no section reader');
    expect(() => requestSections({}, -1, 'anthropic', '/v1/messages')).toThrow('non-negative integer');
    expect(sectionRoute('openai', '/v1/responses') && sectionRoute('anthropic', '/v1/messages') && !sectionRoute('anthropic', '/v1/messages/count_tokens')).toBe(true);
    expect([sectionRoute('particle', '/v1/chat/completions'), sectionRoute('particle', '/v1/responses'), sectionRoute('voyage', '/v1/embeddings')]).toEqual([true, false, false]);
  });
  test('an empty object is all framing', () => {
    const s = requestSections({}, 2, 'anthropic', '/v1/messages');
    expect(s.other).toBe(2);
    expect(partitionSum(s)).toBe(2);
    expect(s.message_count).toBe(0);
    expect(s.boundary_sha256).toEqual([]);
    expect(s.conv_sha256).toBe(sha16(JSON.stringify([[], null])));
  });
  test('messages that are not objects, null content and unknown blocks are framing, never an error', () => {
    const body = { messages: ['loose string', null, 7, { role: 'user' }, { role: 'user', content: { odd: 'ODD-object content' } }, { role: 'narrator', content: 'NARR-text' }] };
    const s = sectionsOf(body, 'anthropic', '/v1/messages');
    expect(partitionSum(s)).toBe(s.body_bytes);
    expect(s.user_text).toBe(0);
    expect(s.message_count).toBe(6);
  });
  test('parts that re-serialize longer than the body as sent cannot be partitioned and throw', () => {
    const raw = '{"messages":[{"role":"user","content":[{"type":"text","text":"","pad":[' + Array(60).fill('1e300').join(',') + ']}]}]}';
    expect(() => requestSections(JSON.parse(raw), Buffer.byteLength(raw), 'anthropic', '/v1/messages')).toThrow('more than the');
    expect(() => requestSections(anthropicBody, 10, 'anthropic', '/v1/messages')).toThrow('more than the 10-byte body');
  });
});

describe('responseExtras', () => {
  const declared = ['search_docs', 'read_page'];
  test('Anthropic JSON: cache writes, the 1-hour part, no reasoning tokens, and an undeclared tool name as <unlisted>', () => {
    const res = { id: 'msg_1', content: [{ type: 'text', text: 'REPLY-sure' }, { type: 'tool_use', id: 't1', name: 'search_docs', input: {} }, { type: 'tool_use', id: 't2', name: 'SECRET-made-up tool', input: {} }],
      usage: { input_tokens: 10, cache_creation_input_tokens: 500, cache_read_input_tokens: 2000, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 300 }, output_tokens: 50 } };
    expect(responseExtras('anthropic', '/v1/messages', res, declared)).toEqual({ cache_write_tokens: 500, cache_write_1h_tokens: 300, reasoning_tokens: 0, tools_called: ['search_docs', UNLISTED_TOOL] });
  });
  test('Anthropic SSE: usage merged from message_start and message_delta, tools from content_block_start', () => {
    const text = sse([
      { type: 'message_start', message: { usage: { input_tokens: 5, cache_creation_input_tokens: 800, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 800 }, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't', name: 'read_page', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"PARTIAL-x":1' } },
      { type: 'message_delta', usage: { output_tokens: 90 } }, { type: 'message_stop' },
    ]);
    expect(responseExtras('anthropic', '/v1/messages', text, declared)).toEqual({ cache_write_tokens: 800, cache_write_1h_tokens: 800, reasoning_tokens: 0, tools_called: ['read_page'] });
  });
  test('the 1-hour part never exceeds the cache-write total, as the ledger prices it', () => {
    expect(responseExtras('anthropic', '/v1/messages', { usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 900 } } }, []).cache_write_1h_tokens).toBe(100);
  });
  test('OpenAI Responses JSON and SSE: cache_write_tokens and reasoning_tokens from the details, function calls from output items', () => {
    const usage = { input_tokens: 4000, input_tokens_details: { cached_tokens: 3000, cache_write_tokens: 40 }, output_tokens: 90, output_tokens_details: { reasoning_tokens: 70 } };
    const json = { output: [{ type: 'reasoning', encrypted_content: 'ENC-x' }, { type: 'function_call', name: 'run_shell', arguments: '{}' }, { type: 'message', content: [] }], usage };
    expect(responseExtras('openai', '/v1/responses', json, ['run_shell'])).toEqual({ cache_write_tokens: 40, cache_write_1h_tokens: 0, reasoning_tokens: 70, tools_called: ['run_shell'] });
    const streamed = sse([
      { type: 'response.output_item.added', item: { type: 'reasoning' } }, { type: 'response.output_item.added', item: { type: 'function_call', name: 'run_shell' } },
      { type: 'response.output_item.added', item: { type: 'custom_tool_call', name: 'apply_patch' } },
      { type: 'response.completed', response: { output: [{ type: 'function_call', name: 'run_shell' }], usage } },
    ]);
    expect(responseExtras('openai', '/v1/responses', streamed, ['run_shell'])).toEqual({ cache_write_tokens: 40, cache_write_1h_tokens: 0, reasoning_tokens: 70, tools_called: ['run_shell', UNLISTED_TOOL] });
    const onlyFinal = sse([{ type: 'response.completed', response: { output: [{ type: 'function_call', name: 'run_shell' }], usage } }]);
    expect(responseExtras('openai', '/v1/responses', onlyFinal, ['run_shell']).tools_called).toEqual(['run_shell']);
  });
  test('OpenAI chat completions JSON and SSE: reasoning from completion_tokens_details, tool names from tool_calls once per call', () => {
    const usage = { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 50 }, completion_tokens_details: { reasoning_tokens: 12 } };
    const json = { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'lookup', arguments: '{}' } }] } }], usage };
    expect(responseExtras('openai', '/v1/chat/completions', json, ['lookup'])).toEqual({ cache_write_tokens: 0, cache_write_1h_tokens: 0, reasoning_tokens: 12, tools_called: ['lookup'] });
    const streamed = sse([
      { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'c', type: 'function', function: { name: 'lookup', arguments: '' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"ARG-k":' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'd', function: { name: 'other_tool', arguments: '' } }] } }] },
      { choices: [], usage }, '[DONE]',
    ]);
    expect(responseExtras('openai', '/v1/chat/completions', streamed, ['lookup'])).toEqual({ cache_write_tokens: 0, cache_write_1h_tokens: 0, reasoning_tokens: 12, tools_called: ['lookup', UNLISTED_TOOL] });
  });
  test('no usage, a broken stream, garbage values and another route give zeros and no tools, never an error', () => {
    const zero = { cache_write_tokens: 0, cache_write_1h_tokens: 0, reasoning_tokens: 0, tools_called: [] };
    for (const res of [null, undefined, 'not an event stream', 'data: {broken\n\ndata: [DONE]\n\n', 42, [], { usage: null }, { usage: { cache_creation_input_tokens: -5, output_tokens_details: { reasoning_tokens: Number.NaN } } }]) {
      expect(responseExtras('anthropic', '/v1/messages', res, declared)).toEqual(zero);
      expect(responseExtras('openai', '/v1/responses', res, declared)).toEqual(zero);
      expect(responseExtras('openai', '/v1/chat/completions', res, declared)).toEqual(zero);
    }
    expect(responseExtras('openai', '/v1/embeddings', { usage: { prompt_tokens: 3, prompt_tokens_details: { cache_write_tokens: 2 } } }, [])).toEqual({ ...zero, cache_write_tokens: 2 });
  });
  test('a built-in call type with regex characters matches no declared tool by pattern and keeps the usage counts', () => {
    const usage = { input_tokens: 10, input_tokens_details: { cache_write_tokens: 7 }, output_tokens: 3, output_tokens_details: { reasoning_tokens: 2 } };
    const res = { output: [{ type: '(.*_call' }, { type: 'web.search_call' }], usage };
    expect(responseExtras('openai', '/v1/responses', res, ['anything', 'webXsearch'])).toEqual({ cache_write_tokens: 7, cache_write_1h_tokens: 0, reasoning_tokens: 2, tools_called: [UNLISTED_TOOL, UNLISTED_TOOL] });
  });
});

describe('no request or response text reaches the output', () => {
  const strings = (v: unknown, out: string[] = []): string[] => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
    return out;
  };
  const SENTINEL = /[A-Z][A-Z0-9]+-/;
  test('every fixture string carrying a sentinel is absent from the serialized sections and extras', () => {
    const responses = [
      ['anthropic', '/v1/messages', { content: [{ type: 'text', text: 'REPLY-visible answer' }, { type: 'tool_use', name: 'SECRET-made-up tool', input: { q: 'INPUT-arg' } }], usage: { input_tokens: 1, output_tokens: 1 } }],
      ['openai', '/v1/responses', { output: [{ type: 'function_call', name: 'HIDDEN-fn', arguments: '{"a":"ARGS-x"}' }, { type: 'message', content: [{ type: 'output_text', text: 'REPLY-out' }] }] }],
      ['openai', '/v1/chat/completions', { choices: [{ message: { content: 'REPLY-chat', tool_calls: [{ function: { name: 'HIDDEN-chat fn', arguments: 'ARGS-y' } }] } }] }],
    ] as const;
    const out = JSON.stringify([
      sectionsOf(anthropicBody, 'anthropic', '/v1/messages'), sectionsOf(responsesBody, 'openai', '/v1/responses'), sectionsOf(chatBody, 'openai', '/v1/chat/completions'),
      ...responses.map(([p, r, b]) => responseExtras(p, r, b, [])),
    ]);
    const secret = strings([anthropicBody, responsesBody, chatBody, responses]).filter((s) => SENTINEL.test(s));
    expect(secret.length).toBeGreaterThan(40);
    for (const s of secret) {
      expect(out.includes(s)).toBe(false);
      expect(out.includes(s.match(SENTINEL)![0])).toBe(false);
    }
  });
});
