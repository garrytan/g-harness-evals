/**
 * internal-task: effort recording, the hosted web-tool refusal (HE-PROXY-006) and the per-start output cap of the metering proxy.
 * Keyless: the upstream is a fake fetch, every key is a placeholder, and the request bodies are the shape fixtures in
 * tests/fixtures/proxy-requests/ (each says where its shape comes from).
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers, ledgerStatus } from '../runner/ledger/budget-ledger.ts';
import { DEFAULT_MAX_OUTPUT_TOKENS, effortCounts, effortFields, MeteringProxy, parseProxyArgs, type LeasePolicy, type UsageLine } from '../runner/proxy/metering-proxy.ts';
import { hostedWebTools } from '../runner/proxy/hosted-tools.ts';

const tmp = mkdtempSync(join(tmpdir(), 'proxy-effort-hosted-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });
const FAKE_ENV = { OPENAI_API_KEY: 'placeholder-openai', ANTHROPIC_API_KEY: 'placeholder-anthropic' };
let n = 0;

const fixture = (name: string): Record<string, any> => {
  const { _shape, ...body } = JSON.parse(readFileSync(new URL(`./fixtures/proxy-requests/${name}.json`, import.meta.url), 'utf8'));
  expect(typeof _shape).toBe('string');
  return body;
};
const CLAUDE_CODE = fixture('claude-code-opus'), HERMES = fixture('hermes-opus'), CODEX = fixture('codex-sol');

interface Seen { url: string; body: any }
function start(extra: Partial<LeasePolicy> = {}) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json({ usage: { input_tokens: 20, output_tokens: 5, prompt_tokens: 20, completion_tokens: 5 } });
  }) as unknown as typeof fetch;
  const lease = BudgetRun.openLease({ runId: `effort-${++n}`, leaseUsd: 20, ledgerPath: join(tmp, `lease-${n}.sqlite`) });
  const usageLog = join(tmp, `usage-${n}.ndjson`);
  const proxy = new MeteringProxy({ fetchImpl, policy: { lease, env: FAKE_ENV, usageLog, ...extra } });
  proxy.start();
  proxy.bind('t', 'trial-token:t', 'tok-t');
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${proxy.port}/t${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'tok-t' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any };
  };
  const lines = () => readFileSync(usageLog, 'utf8').trim().split('\n').map(l => JSON.parse(l) as UsageLine);
  const committed = () => ledgerStatus({ ledgerPath: lease.ledgerPath, runId: lease.runId }).run!.committed_usd;
  return { proxy, seen, post, lines, committed, usageLog };
}

describe('effort recording is record-only', () => {
  beforeEach(() => closeLedgers());

  test('Claude Code shape: output_config.effort and adaptive thinking are recorded and forwarded unchanged under a 128,000-token cap', async () => {
    const p = start({ maxOutputTokens: 128_000, refuseHostedTools: true });
    try {
      const r = await p.post('/anthropic/v1/messages', CLAUDE_CODE);
      expect(r.status).toBe(200);
      expect(p.seen).toHaveLength(1);
      expect(p.seen[0]!.body).toEqual(CLAUDE_CODE);
      const [line] = p.lines();
      expect(line).toMatchObject({ outcome: 'forwarded', model: 'claude-opus-5-5', output_config_effort: 'high', thinking_type: 'adaptive' });
      expect(line!.reasoning_effort).toBeUndefined();
      expect(line!.thinking_budget_tokens).toBeUndefined();
      expect(line!.unrecognized_effort_fields).toBeUndefined();
      expect(effortCounts(p.lines())).toEqual({ 'output_config_effort=high thinking_type=adaptive': 1 });
    } finally { p.proxy.stop(); }
  });

  test('the default cap refuses the Claude Code shape (max_tokens 128000), so a frontier lane starts the proxy with --max-output-tokens', async () => {
    const p = start();
    try {
      const r = await p.post('/anthropic/v1/messages', CLAUDE_CODE);
      expect(r.status).toBe(400);
      expect(r.body.error.message).toContain(`above this cell's cap of ${DEFAULT_MAX_OUTPUT_TOKENS}`);
      expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(32_768);
      expect(p.seen).toHaveLength(0);
      expect(p.proxy.status()).toMatchObject({ max_output_tokens: 32_768, refuse_hosted_tools: false });
    } finally { p.proxy.stop(); }
  });

  test('Hermes shape: no effort field is recorded as none, and its own function tool named web_search passes the hosted-tool refusal', async () => {
    const p = start({ refuseHostedTools: true });
    try {
      const r = await p.post('/anthropic/v1/messages', HERMES);
      expect(r.status).toBe(200);
      expect(p.seen[0]!.body.tools.map((t: { name: string }) => t.name)).toEqual(['terminal', 'web_search']);
      expect(p.seen[0]!.body.thinking).toBeUndefined();
      const [line] = p.lines();
      expect(line!.outcome).toBe('forwarded');
      for (const f of ['reasoning_effort', 'output_config_effort', 'thinking_type', 'thinking_budget_tokens', 'unrecognized_effort_fields'] as const) expect(line![f]).toBeUndefined();
      expect(effortCounts(p.lines())).toEqual({ none: 1 });
    } finally { p.proxy.stop(); }
  });

  test('Codex Responses shape: reasoning.effort is recorded and forwarded unchanged, and the per-start cap is what the proxy injects', async () => {
    const p = start({ maxOutputTokens: 128_000, refuseHostedTools: true });
    try {
      const r = await p.post('/openai/v1/responses', CODEX);
      expect(r.status).toBe(200);
      expect(p.seen[0]!.body).toEqual({ ...CODEX, max_output_tokens: 128_000 });
      const [line] = p.lines();
      expect(line).toMatchObject({ outcome: 'forwarded', model: 'gpt-6.1-sol', reasoning_effort: 'high' });
      expect(line!.output_config_effort).toBeUndefined();
      expect(line!.thinking_type).toBeUndefined();
      expect(p.proxy.status()).toMatchObject({ max_output_tokens: 128_000, refuse_hosted_tools: true });
    } finally { p.proxy.stop(); }
  });

  test('an effort value outside the known values is forwarded as sent, its field named and its value never logged', async () => {
    const p = start({ maxOutputTokens: 128_000 });
    const marker = 'private-marker-5e1b';
    try {
      expect((await p.post('/anthropic/v1/messages', { ...CLAUDE_CODE, output_config: { effort: marker } })).status).toBe(200);
      expect(p.seen[0]!.body.output_config.effort).toBe(marker);
      const [line] = p.lines();
      expect(line!.output_config_effort).toBeUndefined();
      expect(line!.unrecognized_effort_fields).toEqual(['output_config.effort']);
      expect(readFileSync(p.usageLog, 'utf8')).not.toContain(marker);
      expect(effortCounts(p.lines())).toEqual({ 'thinking_type=adaptive output_config.effort=unrecognized': 1 });
    } finally { p.proxy.stop(); }
  });
});

describe('effortFields and effortCounts', () => {
  test('each field is read where its provider sends it', () => {
    expect(effortFields({ reasoning: { effort: 'ultra' } })).toEqual({ reasoning_effort: 'ultra' });
    expect(effortFields({ reasoning_effort: 'low' })).toEqual({ reasoning_effort: 'low' });
    expect(effortFields({ thinking: { type: 'enabled', budget_tokens: 4096 }, output_config: { effort: 'max' } })).toEqual({ output_config_effort: 'max', thinking_type: 'enabled', thinking_budget_tokens: 4096 });
    expect(effortFields({ thinking: { type: 'adaptive', budget_tokens: -1 }, reasoning: { effort: 7 } })).toEqual({ thinking_type: 'adaptive', unrecognized_effort_fields: ['reasoning.effort', 'thinking.budget_tokens'] });
    expect(effortFields({ messages: [] })).toEqual({});
    expect(effortFields(undefined)).toEqual({});
  });

  test('counts only calls that reached the provider, one key per effort setting', () => {
    const line = (extra: Partial<UsageLine>): Partial<UsageLine> => ({ outcome: 'forwarded', route: '/v1/messages', ...extra });
    expect(effortCounts([
      line({ output_config_effort: 'high', thinking_type: 'adaptive' }),
      line({ output_config_effort: 'high', thinking_type: 'adaptive', outcome: 'failed' }),
      line({}),
      line({ reasoning_effort: 'high', route: '/v1/responses' }),
      line({ output_config_effort: 'high', outcome: 'refused' }),
      line({ route: '/v1/messages/count_tokens' }),
    ])).toEqual({ 'output_config_effort=high thinking_type=adaptive': 2, none: 1, 'reasoning_effort=high': 1 });
    expect(effortCounts([])).toEqual({});
  });
});

describe('hosted web tools are refused with HE-PROXY-006 under --refuse-hosted-tools', () => {
  beforeEach(() => closeLedgers());
  const anthropicTool = (type: string) => ({ ...CLAUDE_CODE, tools: [...CLAUDE_CODE.tools, { type, name: type.startsWith('web_fetch') ? 'web_fetch' : 'web_search', max_uses: 5 }] });
  const responsesTool = (type: string) => ({ ...CODEX, tools: [...CODEX.tools, { type }] });
  const SHAPES: Array<[string, string, Record<string, unknown>, string]> = [
    ['Anthropic web_search server tool', '/anthropic/v1/messages', anthropicTool('web_search_20250305'), 'tools[2].type web_search_20250305'],
    ['Anthropic web_fetch server tool', '/anthropic/v1/messages', anthropicTool('web_fetch_20250910'), 'tools[2].type web_fetch_20250910'],
    ['Responses web_search', '/openai/v1/responses', responsesTool('web_search'), 'tools[1].type web_search'],
    ['Responses web_search_preview', '/openai/v1/responses', responsesTool('web_search_preview'), 'tools[1].type web_search_preview'],
    ['Responses web_search_preview_2025_03_11', '/openai/v1/responses', responsesTool('web_search_preview_2025_03_11'), 'tools[1].type web_search_preview_2025_03_11'],
    ['Chat Completions web_search_options', '/openai/v1/chat/completions', { model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'high', web_search_options: {} }, 'web_search_options'],
  ];

  for (const [name, path, body, declared] of SHAPES) {
    test(`${name}: a non-retryable 400, a refused usage line with the reason, nothing forwarded or reserved`, async () => {
      const p = start({ maxOutputTokens: 128_000, refuseHostedTools: true });
      try {
        const r = await p.post(path, body);
        expect(r.status).toBe(400);
        expect(r.body.error.message).toContain('HE-PROXY-006');
        expect(r.body.error.message).toContain(declared);
        expect(p.seen).toHaveLength(0);
        expect(p.committed()).toBe(0);
        const lines = p.lines();
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ outcome: 'refused', status: 400, key: 'trial-token:t', model: body.model });
        expect(lines[0]!.reason).toStartWith('HE-PROXY-006');
        expect(lines[0]!.reason).toContain(declared);
        expect(lines[0]!.reserved_usd).toBeUndefined();
        expect(lines[0]!.output_config_effort ?? lines[0]!.reasoning_effort).toBe('high');
        expect(effortCounts(lines)).toEqual({});
        expect(readFileSync(p.usageLog, 'utf8')).not.toContain('placeholder');
      } finally { p.proxy.stop(); }
    });
  }

  test('without the flag the same requests are forwarded as before', async () => {
    const p = start({ maxOutputTokens: 128_000 });
    try {
      for (const [, path, body] of SHAPES) expect((await p.post(path, body)).status).toBe(200);
      expect(p.seen).toHaveLength(SHAPES.length);
      expect(p.lines().every(l => l.outcome === 'forwarded')).toBe(true);
    } finally { p.proxy.stop(); }
  });

  test('only a tool type names a hosted tool; web_search_options null is not a declaration', () => {
    expect(hostedWebTools(HERMES)).toEqual([]);
    expect(hostedWebTools(CLAUDE_CODE)).toEqual([]);
    expect(hostedWebTools(CODEX)).toEqual([]);
    expect(hostedWebTools({ tools: [{ type: 'function', name: 'web_search' }, { type: 'web_searcher' }, { type: 'custom', name: 'web_fetch' }], web_search_options: null })).toEqual([]);
    expect(hostedWebTools({ tools: [{ type: `web_search_${'x'.repeat(80)}` }] })).toEqual(['tools[0].type (unreadable)']);
  });
});

describe('proxy flags', () => {
  const base = ['--budget-ledger', join(tmp, 'cli.sqlite'), '--lease-usd', '1', '--run-id', 'cli'];
  test('--refuse-hosted-tools is parsed and off by default; --max-output-tokens takes the harness\'s max output and refuses a bad value', () => {
    expect(parseProxyArgs(base)).toMatchObject({ refuseHostedTools: false, maxOutputTokens: null });
    expect(parseProxyArgs([...base, '--refuse-hosted-tools', '--max-output-tokens', '128000'])).toMatchObject({ refuseHostedTools: true, maxOutputTokens: 128_000 });
    for (const bad of ['0', '-5', '1.5', 'lots', '']) expect(() => parseProxyArgs([...base, '--max-output-tokens', bad])).toThrow('--max-output-tokens must be a positive whole number');
  });
});
