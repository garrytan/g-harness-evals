// Harness Zero configuration, keyless and in-process: set names and their derivation, validation diagnostics, the
// candidate hash, the explain command, and that every feature switch changes only what it names in the first request
// on all three wires.
import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ablationName, candidateHash, capOutput, diffPaths, firstRequest, isReadOnly, KNOWN_FEATURES, loadConfig, McpClient, parseRpc, promptFiles, redact, resolveSet, scopeOf, setNames, wireFor } from '../harnesses/harness-zero/zero.ts';
import { harnessCopy, runZero, startFakeModel, startProxy, trial, ZERO_DIR, zeroEnv } from './fixtures/harness-zero-fakes.ts';

const cfg = loadConfig();
const slugs = cfg.features.features.map((f) => f.slug);

describe('harness-zero sets', () => {
  test('features.json lists exactly the implemented slugs; zero-min is empty, zero-full is every slug, zero-full-minus-layers is zero-full without the layers; candidates start empty', () => {
    expect(slugs).toEqual([...KNOWN_FEATURES]);
    expect(cfg.features.sets).toEqual({ 'zero-min': [], 'zero-full': [...KNOWN_FEATURES], 'zero-full-minus-layers': KNOWN_FEATURES.filter((s) => !s.startsWith('layer-')) });
    expect(cfg.candidates.sets).toEqual({ 'zero-lean': [], 'zero-conservative': [], 'zero-control': [] });
    const k = resolveSet('zero-min').knobs;
    expect(k).toEqual({ step_cap: 40, retry_max: 6, output_cap_bytes: 8000, max_tokens: 16000, wire: { anthropic: 'anthropic', openai: 'openai-responses', particle: 'chat-completions' } });
  });

  test('every feature has its ablation set, derived by one function; empty config means zero-full', () => {
    const names = setNames();
    expect(names).toEqual(['zero-min', 'zero-full', 'zero-full-minus-layers', ...slugs.map(ablationName), 'zero-lean', 'zero-conservative', 'zero-control']);
    for (const s of slugs) expect(resolveSet(ablationName(s)).features).toEqual(slugs.filter((x) => x !== s));
    expect(resolveSet('').name).toBe('zero-full');
    expect(resolveSet(undefined).features).toEqual(slugs);
  });

  test('zero-full-minus-layers: a fixed set with the five layers off, its own system prompt and candidate hash, and a name candidates.json cannot take', () => {
    const bundled = resolveSet('zero-full-minus-layers');
    expect(bundled.features).toEqual(['caching', 'tool-search', 'scoped-notes', 'output-cap', 'mcp-instructions', 'effort-high']);
    expect(bundled.knobs).toEqual(resolveSet('zero-full').knobs);
    expect(promptFiles(bundled)).toEqual(['config/prompts/identity.md']);
    const sys = (set: string) => firstRequest(resolveSet(set), 'anthropic', 'm').body.system[0].text as string;
    for (const layer of ['tool-use', 'safety', 'scope', 'style', 'planning']) expect(sys('zero-full-minus-layers')).not.toContain(readFileSync(join(ZERO_DIR, 'config/prompts', layer + '.md'), 'utf8').trim());
    expect(sys('zero-full-minus-layers')).toContain('Instructions from the world tool server');
    expect(diffPaths(firstRequest(resolveSet('zero-full'), 'anthropic', 'm').body, firstRequest(bundled, 'anthropic', 'm').body).map((x) => x.path)).toEqual(['.system[0].text']);
    expect(candidateHash(bundled).candidate_sha256).not.toBe(candidateHash(resolveSet('zero-full')).candidate_sha256);
    expect(() => loadConfig(harnessCopy({ 'zero-full-minus-layers': [] }))).toThrow('HE-ZERO-002 config/candidates.json redefines zero-full-minus-layers, which features.json owns');
  });

  test('an unknown set, a bad knob and a wire mismatch each name the value, the code and the fix', () => {
    expect(() => resolveSet('zero-fast')).toThrow(/^HE-ZERO-001 HE_HARNESS_CONFIG=zero-fast is not a Harness Zero set; fix: set it to one of zero-min, zero-full, zero-full-minus-layers, zero-full-no-caching/);
    const dir = harnessCopy({ 'zero-lean': { features: ['caching'], knobs: { step_cap: 0 } }, 'zero-x': ['warp-drive'], 'zero-y': { features: [], knobs: { colour: 1 } },
      'zero-z': { features: ['effort-high'], knobs: { thinking_budget: 8000 } }, 'zero-w': { features: [], knobs: { wire: { anthropic: 'openai-responses' } } }, 'zero-chat': { features: [], knobs: { wire: { openai: 'chat-completions' } } } });
    const c = loadConfig(dir);
    expect(() => resolveSet('zero-lean', c)).toThrow('HE-ZERO-002 set zero-lean sets knob step_cap=0, outside 1..200; fix: an integer from 1 to 200');
    expect(() => resolveSet('zero-x', c)).toThrow('HE-ZERO-002 set zero-x names unknown features warp-drive');
    expect(() => resolveSet('zero-y', c)).toThrow('HE-ZERO-002 set zero-y sets unknown knob colour');
    expect(() => resolveSet('zero-z', c)).toThrow('HE-ZERO-002 set zero-z sets unknown knob thinking_budget');
    expect(() => resolveSet('zero-w', c)).toThrow('HE-ZERO-002 set zero-w sets wire.anthropic=openai-responses; fix: use anthropic for anthropic');
    expect(wireFor('http://p/slot/openai', resolveSet('zero-chat', c))).toEqual({ provider: 'openai', wire: 'chat-completions' });
    expect(() => wireFor('http://p/slot/voyage', resolveSet('zero-min'))).toThrow(/^HE-ZERO-003 HE_MODEL_BASE_URL http:\/\/p\/slot\/voyage ends in \/voyage, which set zero-min has no wire for; fix: use a base URL ending in \/anthropic, \/openai, \/particle/);
    expect(wireFor('http://p/slot/particle/', resolveSet('zero-min'))).toEqual({ provider: 'particle', wire: 'chat-completions' });
  });

  test('candidates.json, the only file the loop writes, cannot redefine a set features.json owns', () => {
    for (const name of ['zero-full', 'zero-min', 'zero-full-no-caching', 'zero-full-no-warp']) {
      expect(() => loadConfig(harnessCopy({ [name]: [] }))).toThrow(`HE-ZERO-002 config/candidates.json redefines ${name}, which features.json owns`);
    }
    expect(setNames(loadConfig(harnessCopy({ 'zero-lean': ['caching'] })))).toContain('zero-lean');
  });

  test('validation failures print one line, exit 2 and write no ready file', async () => {
    const dir = harnessCopy({ 'zero-lean': { features: [], knobs: { retry_max: 99 } } });
    for (const [extra, code, line] of [
      [{ HE_HARNESS_CONFIG: 'nope' }, 'HE-ZERO-001', 'HE_HARNESS_CONFIG=nope is not a Harness Zero set; fix: set it to one of zero-min, zero-full'],
      [{ HE_HARNESS_CONFIG: 'zero-lean' }, 'HE-ZERO-002', 'set zero-lean sets knob retry_max=99, outside 0..10; fix: an integer from 0 to 10'],
      [{ HE_MODEL_BASE_URL: 'http://127.0.0.1:1/s/voyage' }, 'HE-ZERO-003', 'HE_MODEL_BASE_URL http://127.0.0.1:1/s/voyage ends in /voyage'],
    ] as const) {
      const t = trial();
      const r = await runZero(zeroEnv(t, { baseUrl: 'http://127.0.0.1:1/s/anthropic', token: 'trial-token:x.0', name: 'claude-opus-5-5' }, { ...extra }), 'serve', dir);
      expect(r.code, code).toBe(2);
      const lines = r.stderr.trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(code + ' ' + line);
      expect(() => readFileSync(join(t.logs, 'ready'))).toThrow();
    }
  });
});

describe('harness-zero candidate hash', () => {
  test('changes with zero.ts, a knob, a feature and a loaded prompt file; not with an unloaded prompt or the set name', () => {
    const dir = harnessCopy({ 'zero-lean': ['layer-style'], 'zero-lean-alias': ['layer-style'], 'zero-lean-cap': { features: ['layer-style'], knobs: { step_cap: 12 } }, 'zero-lean-more': ['layer-style', 'caching'] });
    const c = loadConfig(dir);
    const base = candidateHash(resolveSet('zero-lean', c), dir).candidate_sha256;
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(candidateHash(resolveSet('zero-lean-alias', c), dir).candidate_sha256).toBe(base);
    expect(candidateHash(resolveSet('zero-lean-cap', c), dir).candidate_sha256).not.toBe(base);
    expect(candidateHash(resolveSet('zero-lean-more', c), dir).candidate_sha256).not.toBe(base);
    const inputs = candidateHash(resolveSet('zero-lean', c), dir).inputs;
    expect(Object.keys(inputs.prompts)).toEqual(['config/prompts/identity.md', 'config/prompts/style.md']);
    writeFileSync(join(dir, 'config/prompts/safety.md'), 'changed, but zero-lean does not load it\n');
    expect(candidateHash(resolveSet('zero-lean', c), dir).candidate_sha256).toBe(base);
    for (const f of ['config/prompts/style.md', 'config/prompts/identity.md', 'zero.ts']) {
      const before = candidateHash(resolveSet('zero-lean', c), dir).candidate_sha256;
      writeFileSync(join(dir, f), readFileSync(join(dir, f), 'utf8') + '\n');
      expect(candidateHash(resolveSet('zero-lean', c), dir).candidate_sha256, f).not.toBe(before);
    }
  });
});

describe('harness-zero switches', () => {
  // What each switch may change in the first request, by wire. output-cap acts on tool results only.
  const allowed: Record<string, Record<string, RegExp | null>> = {
    anthropic: { caching: /^\.(system\[0\]|messages\[0\]\.content\[0\])\.cache_control$/, 'tool-search': /^\.tools/, 'scoped-notes': /^\.tools/, 'effort-high': /^\.(thinking|output_config)$/, 'output-cap': null },
    'openai-responses': { caching: /^\.prompt_cache_key$/, 'tool-search': /^\.tools/, 'scoped-notes': /^\.tools/, 'effort-high': /^\.reasoning$/, 'output-cap': null },
    'chat-completions': { caching: /^\.prompt_cache_key$/, 'tool-search': /^\.tools/, 'scoped-notes': /^\.tools/, 'effort-high': /^\.reasoning_effort$/, 'output-cap': null },
  };
  const systemPath: Record<string, RegExp> = { anthropic: /^\.system\[0\]\.text$/, 'openai-responses': /^\.instructions$/, 'chat-completions': /^\.messages\[0\]\.content$/ };
  for (const [provider, wire] of [['anthropic', 'anthropic'], ['openai', 'openai-responses'], ['particle', 'chat-completions']] as const) {
    test(wire + ': every switch changes only what it names in the first request', () => {
      const full = firstRequest(resolveSet('zero-full'), provider, 'm');
      expect(full.wire).toBe(wire);
      for (const s of slugs) {
        const d = diffPaths(full.body, firstRequest(resolveSet(ablationName(s)), provider, 'm').body).map((x) => x.path);
        const rule = s.startsWith('layer-') || s === 'mcp-instructions' ? systemPath[wire] : allowed[wire]![s];
        if (rule === null) { expect(d, s).toEqual([]); continue; }
        expect(d.length, s).toBeGreaterThan(0);
        for (const p of d) expect(p, s).toMatch(rule!);
      }
      const min = firstRequest(resolveSet('zero-min'), provider, 'm').body;
      expect(JSON.stringify(min)).not.toContain('cache');
      expect([min.thinking, min.output_config, min.reasoning, min.reasoning_effort, min.prompt_cache_key]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    });
  }

  test('a layer switch removes exactly its prompt text, and mcp-instructions removes the server instructions', () => {
    const sys = (set: string) => firstRequest(resolveSet(set), 'anthropic', 'm').body.system[0].text as string;
    for (const layer of ['tool-use', 'safety', 'scope', 'style', 'planning']) {
      const text = readFileSync(join(ZERO_DIR, 'config/prompts', layer + '.md'), 'utf8').trim();
      expect(sys('zero-full')).toContain(text);
      expect(sys(ablationName('layer-' + layer))).not.toContain(text);
      expect(sys(ablationName('layer-' + layer)).length).toBe(sys('zero-full').length - text.length - 2);
    }
    expect(sys('zero-full')).toContain('Instructions from the world tool server');
    expect(sys(ablationName('mcp-instructions'))).not.toContain('Instructions from the world tool server');
    expect(sys('zero-min')).toBe(readFileSync(join(ZERO_DIR, 'config/prompts/identity.md'), 'utf8').trim());
  });
});

describe('harness-zero helpers', () => {
  test('capOutput cuts with a marker; parseRpc reads JSON and SSE; redact hides credentials', () => {
    expect(capOutput('short', 100)).toBe('short');
    const cut = capOutput('a'.repeat(1000), 600);
    expect(cut.startsWith('a'.repeat(600) + '\n[harness-zero output-cap: cut 400 of 1000 bytes]')).toBe(true);
    expect(parseRpc('{"jsonrpc":"2.0","id":3,"result":{"ok":1}}', 'application/json', 3)).toEqual({ jsonrpc: '2.0', id: 3, result: { ok: 1 } });
    expect(parseRpc(': ping\n\nevent: message\ndata: {"jsonrpc":"2.0","method":"note"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":7,"result":{}}\n\n', 'text/event-stream', 7)).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
    const fakeWorld = 'world-secret-1234567890';
    process.env.HZ_TEST_WORLD_TOKEN = fakeWorld;
    expect(redact('auth world-secret-1234567890 and trial-token:abc.0123 and Bearer xyz and sk-ant-abcdefghijklmnop')).toBe('auth [redacted] and [redacted] and Bearer [redacted] and [redacted]');
    delete process.env.HZ_TEST_WORLD_TOKEN;
  });

  test('isReadOnly: the server annotation wins; without one, only the audited world reads; scopeOf strips only a thread suffix', () => {
    for (const name of ['whoami', 'list_members', 'clock_now', 'list_channels', 'read_channel', 'search_messages', 'list_files', 'read_file', 'calendar_list', 'mail_list']) expect(isReadOnly({ name }, 'world'), name).toBe(true);
    for (const name of ['post_message', 'send_dm', 'calendar_create', 'mail_send_draft', 'request_approval']) expect(isReadOnly({ name }, 'world'), name).toBe(false);
    expect(isReadOnly({ name: 'get_or_create_x' }, 'gbrain')).toBe(false);
    expect(isReadOnly({ name: 'read_channel' }, 'gbrain')).toBe(false);
    expect(isReadOnly({ name: 'list_members', annotations: { readOnlyHint: false } }, 'world')).toBe(false);
    expect(isReadOnly({ name: 'query', annotations: { readOnlyHint: true } }, 'gbrain')).toBe(true);
    expect(scopeOf('dm:tobias-rendle')).toBe('dm:tobias-rendle');
    expect(scopeOf('dm:tobias-rendle:t1730390400.000100')).toBe('dm:tobias-rendle');
    expect(scopeOf('channel:tC1:t1.5')).toBe('channel:tC1');
  });

  test('resolveSet: inherited names are unknown sets and knobs; effort-high has no budget to check against max_tokens', () => {
    expect(() => resolveSet('constructor')).toThrow('HE-ZERO-001');
    expect(() => resolveSet('__proto__')).toThrow('HE-ZERO-001');
    const c = { ...cfg, candidates: { ...cfg.candidates, sets: { 'zero-small': { features: [], knobs: { max_tokens: 1024 } }, 'zero-small-high': { features: ['effort-high'], knobs: { max_tokens: 1024 } }, 'zero-odd': { features: [], knobs: { wire: { openai: 'toString' } } }, 'zero-proto': { features: [], knobs: { toString: 5 } } } } } as typeof cfg;
    expect(resolveSet('zero-small', c).knobs.max_tokens).toBe(1024);
    expect(resolveSet('zero-small-high', c)).toMatchObject({ features: ['effort-high'], knobs: { max_tokens: 1024 } });
    expect(() => resolveSet('zero-odd', c)).toThrow('HE-ZERO-002 set zero-odd sets wire.openai=toString');
    expect(() => resolveSet('zero-proto', c)).toThrow('HE-ZERO-002 set zero-proto sets unknown knob toString');
  });
});

describe('harness-zero explain', () => {
  test('prints the first request, its size and a labelled estimate; --diff lists changed paths; --count-tokens is exact through the proxy and refused off Anthropic', async () => {
    const t = trial();
    const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: t.state };
    const r = await runZero(env, 'explain', ZERO_DIR, ['--config', 'zero-min']);
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ config: 'zero-min', wire: 'anthropic', features: [], tokens: { label: 'estimate: request bytes / 4' } });
    expect(out.first_request_bytes).toBe(Buffer.byteLength(JSON.stringify(out.first_request)));
    expect(out.candidate_sha256).toBe(candidateHash(resolveSet('zero-min')).candidate_sha256);
    const d = JSON.parse((await runZero(env, 'explain', ZERO_DIR, ['--config', 'zero-full', '--diff', 'zero-full-no-effort-high', '--provider', 'openai'])).stdout);
    expect(d).toMatchObject({ wire: 'openai-responses', features_only_in_a: ['effort-high'], first_request_changes: [{ path: '.reasoning', a: '{"effort":"high"}', b: null }] });

    const fake = startFakeModel('claude-opus-5-5');
    const proxy = await startProxy(t.dir, fake.url, ['anthropic:claude-opus-5-5'], ['--free-count-tokens']);
    try {
      const { baseUrl, token } = await proxy.bind('zero-explain', 'anthropic', ['anthropic:claude-opus-5-5']);
      const exact = await runZero({ ...env, HE_MODEL_API_KEY: token }, 'explain', ZERO_DIR, ['--config', 'zero-full', '--count-tokens', baseUrl]);
      expect(exact.code, exact.stderr).toBe(0);
      expect(JSON.parse(exact.stdout).tokens).toMatchObject({ label: 'exact: Anthropic count_tokens through the proxy' });
      expect(fake.seen.find((s) => s.path === '/v1/messages/count_tokens')?.apiKey).toBe('placeholder-upstream-key-harness-zero');
      const refused = await runZero(env, 'explain', ZERO_DIR, ['--config', 'zero-full', '--provider', 'openai', '--count-tokens', baseUrl]);
      expect(refused.code).toBe(2);
      expect(refused.stderr).toContain('HE-ZERO-003 --count-tokens needs the anthropic wire');
    } finally { fake.stop(); await proxy.stop(); }
  }, 30_000);
});

describe('harness-zero MCP per-call limit', () => {
  test('a session-expired read, its re-initialize and the read sent again share one per-call limit', async () => {
    let inits = 0, calls = 0;
    const json = (id: number, result: unknown, headers: Record<string, string> = {}) => Response.json({ jsonrpc: '2.0', id, result }, { headers });
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
      const msg = await req.json();
      if (msg.method === 'initialize') {
        if (++inits > 1) await Bun.sleep(600);
        return json(msg.id, { protocolVersion: '2025-06-18' }, { 'mcp-session-id': 's' + inits });
      }
      if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (msg.method === 'tools/list') return json(msg.id, { tools: [{ name: 'read_thing', inputSchema: { type: 'object' } }] });
      if (++calls === 1) return new Response('gone', { status: 404 });
      await Bun.sleep(600);
      return json(msg.id, { content: [{ type: 'text', text: 'late' }] });
    } });
    try {
      const client = new McpClient('fake', `http://127.0.0.1:${server.port}/mcp`, 'dummy');
      await client.initialize();
      const t0 = Date.now();
      const r = await client.call({ ...client.tools[0]!, readOnly: true }, {}, new AbortController().signal, Date.now() + 2000);
      expect(r).toMatchObject({ isError: true, status: 'error', text: expect.stringContaining('read_thing failed') });
      expect(Date.now() - t0).toBeLessThan(1150);
      expect([inits, calls]).toEqual([2, 2]);
    } finally { server.stop(true); }
  }, 10_000);
});
