// Harness Zero's three wire clients, keyless, at the process level: zero.ts run under a scrubbed environment, through the
// real metering proxy in lease mode, to a strict fake upstream that refuses (400) any request whose history breaks its
// wire's rules. Covers the tool loop, parallel and mixed calls, call-id continuity, broken arguments, empty and cut-off
// answers, thinking and reasoning round trips under effort-high, the step cap, retries and the exit mapping, the turn
// budget, and that no credential lands in any file.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANTHROPIC_ENABLED_REFUSAL, files, harnessCopy, runZero, startFakeMcp, startFakeModel, startProxy, trial, turnLines, UPSTREAM_KEY, zeroEnv, type FakeMcp, type FakeModel, type FakeWire } from './fixtures/harness-zero-fakes.ts';

const MCP_TOKEN = 'world-bot-token-for-zero-tests-0001';
const WIRES: Array<{ wire: FakeWire; provider: 'anthropic' | 'openai'; model: string }> = [
  { wire: 'anthropic', provider: 'anthropic', model: 'claude-opus-5-5' },
  { wire: 'openai-responses', provider: 'openai', model: 'gpt-6.1-sol' },
  { wire: 'chat-completions', provider: 'openai', model: 'gpt-6.1-sol' },
];

for (const w of WIRES) {
  describe('harness-zero ' + w.wire + ' through the metering proxy', () => {
    let fake: FakeModel, mcp: FakeMcp, proxy: Awaited<ReturnType<typeof startProxy>>, dir: string, root: ReturnType<typeof trial>;
    const knobs = w.wire === 'chat-completions' ? { wire: { openai: 'chat-completions' } } : {};
    beforeAll(async () => {
      root = trial();
      fake = startFakeModel(w.model);
      mcp = startFakeMcp({ token: MCP_TOKEN });
      proxy = await startProxy(root.dir, fake.url, ['anthropic:claude-opus-5-5', 'openai:gpt-6.1-sol']);
      dir = harnessCopy({ 'zero-lean': { features: [], knobs }, 'zero-conservative': { features: ['effort-high'], knobs }, 'zero-control': { features: [], knobs: { ...knobs, step_cap: 2 } } });
    });
    afterAll(async () => { fake.stop(); mcp.stop(); await proxy.stop(); });

    let n = 0;
    async function go(set: string, script: typeof fake.script, extra: Record<string, string> = {}) {
      const t = trial('Dana asks for the notes.');
      const id = 'zero-' + w.wire + '-' + ++n;
      const { baseUrl, token } = await proxy.bind(id, w.provider, [w.provider + ':' + w.model]);
      fake.script.splice(0, fake.script.length, ...script);
      const from = fake.seen.length;
      const r = await runZero(zeroEnv(t, { baseUrl, token, name: w.model }, { HE_HARNESS_CONFIG: set, HE_TRIAL_ID: id, HE_WORLD_MCP_URL: mcp.url, HE_WORLD_MCP_TOKEN: MCP_TOKEN, ...extra }), 'run', dir);
      const seen = fake.seen.slice(from);
      return { ...r, t, token, seen, violations: seen.filter((s) => s.violation).map((s) => s.violation), last: turnLines(t).at(-1) };
    }

    test('tool loop: mixed text and parallel calls, then a write, then the answer; call ids carried; metered on the cell model', async () => {
      const from = mcp.calls.length;
      const r = await go('zero-lean', [
        { text: 'Looking.', calls: [{ name: 'mcp__world__read_notes' }, { name: 'mcp__world__lookup_member', args: { handle: 'dana' } }] },
        { calls: [{ name: 'mcp__world__post_message', args: { channel: 'C1', text: 'hello' } }] },
        { text: 'All done.' },
      ]);
      expect(r.violations).toEqual([]);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe('All done.\n');
      expect(mcp.calls.slice(from).map((c) => c.tool)).toEqual(['read_notes', 'lookup_member', 'post_message']);
      expect(r.seen).toHaveLength(3);
      for (const s of r.seen) {
        expect(s.body.model).toBe(w.model);
        expect(s.apiKey ?? s.authorization).toBe(w.wire === 'anthropic' ? UPSTREAM_KEY : 'Bearer ' + UPSTREAM_KEY);
      }
      const ids = w.wire === 'anthropic' ? r.seen[1]!.body.messages.at(-1).content.map((b: any) => b.tool_use_id)
        : w.wire === 'openai-responses' ? r.seen[1]!.body.input.filter((i: any) => i.type === 'function_call_output').map((i: any) => i.call_id)
        : r.seen[1]!.body.messages.filter((m: any) => m.role === 'tool').map((m: any) => m.tool_call_id);
      const prefix = w.wire === 'anthropic' ? 'toolu_' : 'call_';
      expect(ids).toEqual([prefix + (ids[0].split('_')[1]) + '_0', prefix + (ids[0].split('_')[1]) + '_1']);
      expect(r.last).toMatchObject({ steps: 3, stop_reason: w.wire === 'anthropic' ? 'end_turn' : w.wire === 'openai-responses' ? 'completed' : 'stop', retries: 0, exit: 0,
        tool_calls: [{ tool: 'mcp__world__read_notes', status: 'ok' }, { tool: 'mcp__world__lookup_member', status: 'ok' }, { tool: 'mcp__world__post_message', status: 'ok' }], tool_outcomes: { ok: 3, error: 0, unknown: 0 } });
      const calls = readFileSync(join(r.t.logs, 'adapter.log'), 'utf8').split('\n').filter((l) => l.includes('ZERO_CALL ')).map((l) => JSON.parse(l.slice(l.indexOf('ZERO_CALL ') + 10)));
      expect(calls.map((c) => [c.id, c.tool, c.status])).toEqual([['1.1', 'mcp__world__read_notes', 'ok'], ['1.2', 'mcp__world__lookup_member', 'ok'], ['1.3', 'mcp__world__post_message', 'ok']]);
      for (const c of calls) expect(typeof c.ms).toBe('number');
      const usage = readFileSync(join(root.dir, 'usage.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((u) => u.key === 'trial-token:zero-' + w.wire + '-1');
      expect(usage.map((u) => [u.outcome, u.model])).toEqual([['forwarded', w.model], ['forwarded', w.model], ['forwarded', w.model]]);
      // No credential in any file the trial wrote: the per-trial token, the world-MCP token, the proxy's upstream key.
      for (const f of files(r.t.dir)) for (const secret of [r.token, MCP_TOKEN, UPSTREAM_KEY]) expect(f.text.includes(secret), f.path).toBe(false);
    }, 30_000);

    test('effort-high: thinking or reasoning goes out, comes back and is sent again unchanged', async () => {
      const r = await go('zero-conservative', [{ calls: [{ name: 'mcp__world__read_notes' }] }, { text: 'Read them.' }]);
      expect(r.violations).toEqual([]);
      expect(r.code, r.stderr).toBe(0);
      const [first, second] = r.seen;
      if (w.wire === 'anthropic') {
        expect(first!.body.thinking).toEqual({ type: 'adaptive' });
        expect(first!.body.output_config).toEqual({ effort: 'high' });
        expect(second!.body.thinking).toEqual({ type: 'adaptive' });
        const refused = await fetch(fake.url + '/v1/messages', { method: 'POST', body: JSON.stringify({ ...first!.body, thinking: { type: 'enabled', budget_tokens: 8000 } }) });
        expect(refused.status).toBe(400);
        expect(((await refused.json()) as any).error).toEqual({ type: 'invalid_request_error', message: ANTHROPIC_ENABLED_REFUSAL });
        expect(second!.body.messages[1].content[0]).toMatchObject({ type: 'thinking', signature: expect.stringMatching(/^sig-/) });
      } else if (w.wire === 'openai-responses') {
        expect(first!.body.reasoning).toEqual({ effort: 'high' });
        expect(second!.body.input.find((i: any) => i.type === 'reasoning')).toMatchObject({ encrypted_content: expect.stringMatching(/^enc-/) });
      } else {
        expect(first!.body.reasoning_effort).toBe('high');
        expect(second!.body.messages.find((m: any) => m.role === 'assistant').reasoning_content).toMatch(/^reasoning /);
      }
    }, 30_000);

    test('broken arguments, a cut-off answer with a call, and an empty answer', async () => {
      const broken = w.wire === 'anthropic' ? [] : [{ calls: [{ name: 'mcp__world__lookup_member', args: '{"handle": "da' }] }];
      const r = await go('zero-lean', [...broken, { cutoff: true, calls: [{ name: 'mcp__world__post_message', args: { channel: 'C1', text: 'half' } }] }, { empty: true }]);
      expect(r.violations).toEqual([]);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe('\n');
      expect(r.last).toMatchObject({ stop_reason: 'empty', exit: 0, tool_outcomes: { ok: 0, error: broken.length + 1 } });
      const sent = JSON.stringify(r.seen.at(-1)!.body);
      if (broken.length) expect(sent).toContain('the arguments are not valid JSON');
      expect(sent).toContain('Not run: the response hit the output token limit');
      const cut = await go('zero-lean', [{ cutoff: true, text: 'Partial answer' }]);
      expect(cut.code).toBe(0);
      expect(cut.stdout).toBe('Partial answer\n');
      expect(cut.last.stop_reason).toBe(w.wire === 'anthropic' ? 'max_tokens' : w.wire === 'openai-responses' ? 'incomplete:max_output_tokens' : 'length');
    }, 30_000);

    test('an answer with no text and no calls cut off at the output limit keeps the provider stop reason', async () => {
      const r = await go('zero-lean', [{ cutoff: true, empty: true }]);
      expect(r.violations).toEqual([]);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe('\n');
      expect(r.last.stop_reason).toBe(w.wire === 'anthropic' ? 'max_tokens' : w.wire === 'openai-responses' ? 'incomplete:max_output_tokens' : 'length');
    }, 30_000);

    test('step cap with no text yet: exit 0, no reply, stop_reason step_cap', async () => {
      const call = { calls: [{ name: 'mcp__world__read_notes' }] };
      const r = await go('zero-control', [call, call, call]);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe('\n');
      expect(r.seen).toHaveLength(2);
      expect(r.last).toMatchObject({ steps: 2, stop_reason: 'step_cap', exit: 0 });
      const narrated = await go('zero-control', [{ text: 'Let me look.', calls: [{ name: 'mcp__world__read_notes' }] }, { text: 'Still looking.', calls: [{ name: 'mcp__world__read_notes' }] }]);
      expect(narrated.code, narrated.stderr).toBe(0);
      expect(narrated.stdout).toBe('\n');
      expect(narrated.last).toMatchObject({ steps: 2, stop_reason: 'step_cap', exit: 0 });
    }, 30_000);

    test('retries 529, 529, 429 and 500 inside the turn; none on 400, 401, 403 or 422; exhausted retries exit 3', async () => {
      const ok = await go('zero-lean', [{ status: 529 }, { status: 529 }, { status: 429 }, { status: 500 }, { text: 'after retries' }]);
      expect(ok.code, ok.stderr).toBe(0);
      expect(ok.stdout).toBe('after retries\n');
      expect(ok.seen.map((s) => s.status)).toEqual([529, 529, 429, 500, 200]);
      expect(ok.last).toMatchObject({ retries: 4, exit: 0 });
      for (const [status, code, text] of [[400, 2, 'HE-ZERO-004 the provider rejected a request Harness Zero built: 400'], [422, 2, 'HE-ZERO-004'], [401, 3, 'HE-ZERO-007'], [403, 3, 'HE-ZERO-007 model request refused: 403']] as const) {
        const r = await go('zero-lean', [{ status }]);
        expect(r.code, String(status)).toBe(code);
        expect(r.seen, String(status)).toHaveLength(1);
        expect(r.stderr).toContain(text);
        expect(r.stderr).toContain('request id req_fake_');
      }
      const budget = await go('zero-lean', [{ status: 502, errorType: 'budget' }, { text: 'never' }]);
      expect(budget.code).toBe(3);
      expect(budget.seen).toHaveLength(1);
      expect(budget.stderr).toContain('HE-ZERO-007 the metering proxy refused the request under its budget policy: 502 budget');
      const gone = await go('zero-lean', Array.from({ length: 7 }, () => ({ status: 529 })));
      expect(gone.code).toBe(3);
      expect(gone.seen).toHaveLength(7);
      expect(gone.stderr).toContain('HE-ZERO-007 model request failed after 6 retries: 529');
    }, 60_000);

    test('a request the proxy refuses (a token that is not the slot\'s) is exit 3 without a retry', async () => {
      const t = trial('hello');
      const { baseUrl } = await proxy.bind('zero-refused-' + w.wire, w.provider);
      const r = await runZero(zeroEnv(t, { baseUrl, token: 'trial-token:zero-refused.ffffffffffffffffffffffffffffffff', name: w.model }, { HE_HARNESS_CONFIG: 'zero-lean' }), 'run', dir);
      expect(r.code).toBe(3);
      expect(r.stderr).toContain('HE-ZERO-007 model request refused: 403');
      expect(r.stderr).not.toContain('ffffffffffffffffffffffffffffffff');
    }, 30_000);
  });
}

describe('harness-zero turn budget and the particle route', () => {
  test('a hanging upstream: the turn ends 124 at its budget and the request is closed', async () => {
    const fake = startFakeModel('claude-opus-5-5');
    try {
      fake.script.push({ hang: true });
      const t = trial('hello');
      const began = Date.now();
      const r = await runZero(zeroEnv(t, { baseUrl: fake.url + '/slot/anthropic', token: 'trial-token:zero-hang.0', name: 'claude-opus-5-5' }, { HE_TIME_BUDGET_S: '2', HE_HARNESS_CONFIG: 'zero-min' }));
      expect(r.code).toBe(124);
      expect(Date.now() - began).toBeLessThan(6_000);
      await Bun.sleep(100);
      expect(fake.closed).toEqual(['/v1/messages']);
      expect(turnLines(t).at(-1)).toMatchObject({ stop_reason: 'budget', exit: 124 });
    } finally { fake.stop(); }
  }, 20_000);

  test('an answer that breaks off mid-body is retried, not a crash; a failed Responses object is a model error', async () => {
    const fake = startFakeModel('claude-opus-5-5');
    try {
      fake.script.push({ breakBody: true }, { text: 'after a break' });
      const t = trial('hello');
      const r = await runZero(zeroEnv(t, { baseUrl: fake.url + '/slot/anthropic', token: 'trial-token:zero-break.0', name: 'claude-opus-5-5' }, { HE_HARNESS_CONFIG: 'zero-min' }));
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe('after a break\n');
      expect(turnLines(t).at(-1)).toMatchObject({ retries: 1, exit: 0 });
      expect(readFileSync(join(t.logs, 'adapter.log'), 'utf8')).toContain('model 200: retry 1');
      fake.script.push({ breakBody: true, status: 400 }, { text: 'never' });
      const t4 = trial('hello');
      const from = fake.seen.length;
      const r4 = await runZero(zeroEnv(t4, { baseUrl: fake.url + '/slot/anthropic', token: 'trial-token:zero-break4.0', name: 'claude-opus-5-5' }, { HE_HARNESS_CONFIG: 'zero-min' }));
      expect(r4.code, r4.stderr).toBe(2);
      expect(fake.seen.length - from).toBe(1);
      expect(r4.stderr).toContain('HE-ZERO-004');
      fake.script.splice(0);
    } finally { fake.stop(); }
    const sol = startFakeModel('gpt-6.1-sol');
    try {
      sol.script.push({ failed: true });
      const t = trial('hello');
      const r = await runZero(zeroEnv(t, { baseUrl: sol.url + '/slot/openai', token: 'trial-token:zero-failed.0', name: 'gpt-6.1-sol' }, { HE_HARNESS_CONFIG: 'zero-min' }));
      expect(r.code).toBe(3);
      expect(r.stderr).toContain('HE-ZERO-007 the provider answered 200 with a failed response (server_error: fake failure)');
      expect(turnLines(t).at(-1)).toMatchObject({ exit: 3 });
    } finally { sol.stop(); }
  }, 20_000);

  test('a base URL ending in /particle uses chat completions', async () => {
    const fake = startFakeModel('particle-1');
    try {
      fake.script.push({ text: 'particle reply' });
      const t = trial('hello');
      const r = await runZero(zeroEnv(t, { baseUrl: fake.url + '/slot/particle', token: 'trial-token:zero-p.0', name: 'particle-1' }, { HE_HARNESS_CONFIG: 'zero-full' }));
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe('particle reply\n');
      expect(fake.seen[0]).toMatchObject({ path: '/v1/chat/completions', authorization: 'Bearer trial-token:zero-p.0' });
      expect(fake.seen[0]!.body).toMatchObject({ reasoning_effort: 'high', prompt_cache_key: expect.stringMatching(/^harness-zero-/) });
    } finally { fake.stop(); }
  }, 20_000);
});
