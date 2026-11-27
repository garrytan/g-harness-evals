// The launch check (scripts/launch-preflight.ts, runner/cost/provider-probe.ts), keyless: the ledger guard is installed with a
// fake transport that answers for the real provider URLs, so pricing, reservations and ledger rows run as they would live.
//
// Value: protects=a counted shard does not launch past its plan's stop, with an unpriced cell, or onto a provider that is out
// of credit, rejects the key or cannot serve the model (a batch of trials became $0 infra records when one provider's
// credit ran out mid-shard in 2026-11); fails_when=a 404 or a non-credit 400 passes, a credit answer is read as a rate limit, the xAI probe
// is refused for lease, a key reaches any output, receipt or log, a probe goes unmetered, or an override is silent;
// why_new=no launch step asked the providers whether they would answer; seam=fetchImpl on installPaidRequestGuard and a fake
// key-limit fetch; no_claim=that a live provider answers these exact bodies (a real probe pass is the receipt for that).
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers, readLedger } from '../runner/ledger/budget-ledger.ts';
import { classify, probeTargets } from '../runner/cost/provider-probe.ts';
import { preflight, type PreflightOptions } from '../scripts/launch-preflight.ts';

const tmp = mkdtempSync(join(tmpdir(), 'he-preflight-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });
let n = 0;
const dir = (name: string) => { const d = join(tmp, `${name}-${++n}`); mkdirSync(d, { recursive: true }); return d; };

const KEYS = { ANTHROPIC_API_KEY: 'fake-anthropic-key-0123456789', OPENAI_API_KEY: 'fake-openai-key-0123456789', XAI_API_KEY: 'fake-xai-key-0123456789',
  GEMINI_API_KEY: 'fakegeminikey0123456789', OPENROUTER_API_KEY: 'fake-openrouter-key-0123456789', PARTICLE_API_KEY: 'fake-particle-key-0123456789' };
const MODELS: Record<string, string> = { claude: 'anthropic:claude-opus-5-5', sol: 'openai:gpt-6.1-sol', grok: 'xai:grok-4.7', carbon: 'google:gemini-4-carbon', muse: 'openrouter:meta/muse-wonder', particle: 'particle:particle-1' };

/** A plan with one cell per model, a pilot of 5 scored trials at $0.10 each, and a ledger holding the pilot's spend. */
function fixture(stop = 1000, pilotTrials = 5) {
  const folder = dir('plan');
  Object.entries(MODELS).forEach(([id, model], i) => writeFileSync(join(folder, `prereg-harbor-s${i}.json`), JSON.stringify({ schema: 'frontier-harbor/1', run_id: 'fixture-run', concurrency: 1,
    cells: [{ id, model, attempts: 1, tasks: { from: 0, to: 10 } }], shards: [{ name: `s${i}`, cells: [id], lease_usd: 50 }] })));
  writeFileSync(join(folder, 'PREREGISTRATION.md'), `## Cost projection\n\n- Spend stop: $${stop}\n`);
  const pilot = dir('pilot');
  writeFileSync(join(pilot, 'trials.jsonl'), Object.keys(MODELS).flatMap(cell => Array.from({ length: pilotTrials }, (_, i) => JSON.stringify({ cell, termination: 'completed', wall_ms: 1000, usage: { usd: 0.1 }, trial_id: `${cell}/${i}` }))).join('\n') + '\n');
  const ledger = join(tmp, `pilot-${++n}.sqlite`);
  const lease = BudgetRun.openLease({ runId: 'pilot', leaseUsd: 100, ledgerPath: ledger });
  lease.settle(lease.reserve(5, 'anthropic:claude-opus-5-5 chat'), { usd: 3, input_tokens: 1, output_tokens: 1 });
  return { folder, pilot, ledger };
}

type Answer = { status: number; body: unknown; headers?: Record<string, string> };
const okBody = (provider: string): unknown => provider === 'google' ? { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 1 } }
  : provider === 'anthropic' ? { type: 'message', content: [{ type: 'text', text: 'OK' }], usage: { input_tokens: 10, output_tokens: 1 } }
  : provider === 'openai' ? { id: 'resp_1', status: 'incomplete', output: [], usage: { input_tokens: 10, output_tokens: 16 } }
  : { id: 'c1', choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 10, completion_tokens: 1 } };

/** A transport that answers by provider: each scripted answer is used once, in order, then the provider answers 200. */
function transport(script: Record<string, Answer[]> = {}) {
  const calls: Array<{ provider: string; url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const providerOf = (url: string) => url.includes('anthropic') ? 'anthropic' : url.includes('openai.com') ? 'openai' : url.includes('x.ai') ? 'xai' : url.includes('googleapis') ? 'google' : url.includes('openrouter') ? 'openrouter' : 'particle';
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const provider = providerOf(url);
    calls.push({ provider, url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    const a = script[provider]?.shift() ?? { status: 200, body: okBody(provider) };
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json', ...(a.headers ?? {}) } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}
const keyLimit = (remaining: number | null, status = 200) => (async () => new Response(JSON.stringify({ data: { limit: remaining === null ? null : 100, limit_remaining: remaining } }), { status })) as unknown as typeof fetch;

function options(f: ReturnType<typeof fixture>, t: ReturnType<typeof transport>, extra: Partial<PreflightOptions> = {}, rawFetch = keyLimit(500)): PreflightOptions {
  return { folder: f.folder, manifest: null, shard: null, cells: Object.keys(MODELS), leaseUsd: 50, dest: dir('dest'), ledgers: [f.ledger], pilot: [f.pilot], results: [], planFiles: [], map: {}, stop: null, own: null, also: [], override: null,
    probe: { env: { ...KEYS }, fetchImpl: t.fetchImpl, rawFetch, sleep: async () => {} }, ...extra };
}
const everything = (r: { lines: string[] }, dest: string) => r.lines.join('\n') + readFileSync(join(dest, 'launch-preflight.json'), 'utf8') + (() => { try { return readFileSync(join(dest, 'launch-overrides.jsonl'), 'utf8'); } catch { return ''; } })();

describe('answers', () => {
  test('only a 2xx completion passes; credit and limit answers are told apart from rate limits, bad keys and missing models', () => {
    expect(classify(200, JSON.stringify({ type: 'message' }))).toEqual({ ok: true });
    expect(classify(200, JSON.stringify({ id: 'resp_1', status: 'incomplete', error: null }))).toEqual({ ok: true });
    expect(classify(200, 'not json').code).toBe('HE-PROVIDER-003');
    expect(classify(200, JSON.stringify({ error: { message: 'x' } })).code).toBe('HE-PROVIDER-003');
    expect(classify(401, '{}').code).toBe('HE-PROVIDER-001');
    expect(classify(403, JSON.stringify({ error: 'model access denied' })).code).toBe('HE-PROVIDER-001');
    expect(classify(402, '{}').code).toBe('HE-PROVIDER-002');
    expect(classify(400, JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } })).code).toBe('HE-PROVIDER-002');
    expect(classify(403, JSON.stringify({ code: 'forbidden', error: 'Your team has either used all available credits or reached its monthly spending limit.' })).code).toBe('HE-PROVIDER-002');
    expect(classify(429, JSON.stringify({ error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } })).code).toBe('HE-PROVIDER-002');
    expect(classify(429, JSON.stringify({ error: { type: 'rate_limit_error', message: 'Number of requests per minute exceeded' } }))).toEqual({ ok: false, code: 'HE-PROVIDER-004', retry: 'rate' });
    expect(classify(404, JSON.stringify({ error: { code: 'model_not_found' } })).code).toBe('HE-PROVIDER-003');
    expect(classify(400, JSON.stringify({ error: { message: 'max_tokens must be at least 16' } })).code).toBe('HE-PROVIDER-003');
    expect(classify(503, '')).toEqual({ ok: false, code: 'HE-PROVIDER-005', retry: 'server' });
    expect(classify(null, '')).toEqual({ ok: false, code: 'HE-PROVIDER-005', retry: 'server' });
  });

  test('probe targets are distinct provider:model pairs, and a provider with no check is bad input', () => {
    expect(probeTargets(['anthropic:claude-opus-5-5', 'anthropic:claude-opus-5-5', 'openrouter:meta/muse-wonder'])).toEqual([{ provider: 'anthropic', model: 'claude-opus-5-5' }, { provider: 'openrouter', model: 'meta/muse-wonder' }]);
    expect(() => probeTargets(['voyage:voyage-4'])).toThrow(/HE-BUDGET-007 no provider check for voyage/);
    expect(() => probeTargets(['claude'])).toThrow(/HE-BUDGET-007/);
  });
});

describe('the launch check', () => {
  test('all six providers answer: pass, every probe metered as a ledger row, the xAI probe not refused for lease, spend under five cents', async () => {
    const f = fixture();
    const t = transport();
    const o = options(f, t);
    const r = await preflight(o);
    expect(r.exit).toBe(0);
    expect(r.lines.at(-2)).toBe('VERDICT: PASS');
    expect(t.calls.map(c => c.provider).sort()).toEqual(['anthropic', 'google', 'openai', 'openrouter', 'particle', 'xai']);
    const probes = (r.receipt as { probes: { spent_usd: number; lease_usd: number; answers: unknown[] } }).probes;
    expect(probes.answers).toHaveLength(6);
    expect(probes.spent_usd).toBeLessThan(0.05);
    expect(probes.lease_usd).toBeGreaterThan(3);
    expect(readLedger(join(o.dest, 'preflight-ledger.sqlite')).entries).toHaveLength(6);
    const muse = t.calls.find(c => c.provider === 'openrouter')!.body;
    expect(muse.provider).toMatchObject({ only: ['meta'], allow_fallbacks: false });
    expect(r.lines.join('\n')).toContain('openrouter key has $500.00 left for a $50.00 lease');
  });

  test('a rerun of the check reuses its ledger and makes room for one more probe pass', async () => {
    const f = fixture();
    const o = options(f, transport());
    await preflight(o);
    const again = await preflight({ ...o, probe: { ...o.probe, fetchImpl: transport().fetchImpl } });
    expect(again.exit).toBe(0);
    expect(readLedger(join(o.dest, 'preflight-ledger.sqlite')).entries).toHaveLength(12);
  });

  test('out of credit, a rejected key and a missing model each refuse with their code, the billing page and what was spent', async () => {
    const f = fixture();
    const t = transport({ xai: [{ status: 403, body: { code: 'forbidden', error: 'Your team has either used all available credits or reached its monthly spending limit.' } }],
      anthropic: [{ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }],
      openai: [{ status: 404, body: { error: { type: 'invalid_request_error', code: 'model_not_found', message: 'The model does not exist' } } }] });
    const r = await preflight(options(f, t));
    expect(r.exit).toBe(3);
    const text = r.lines.join('\n');
    expect(text).toContain('REFUSED: HE-PROVIDER-002 xai:grok-4.7 out of credit or past a spending limit (status 403, code forbidden); next: a person tops up or raises the limit at https://console.x.ai');
    expect(text).toContain('REFUSED: HE-PROVIDER-001 anthropic:claude-opus-5-5 key missing, rejected or without access (status 401, type authentication_error)');
    expect(text).toContain('REFUSED: HE-PROVIDER-003 openai:gpt-6.1-sol model not available to this key, or the probe was rejected (status 404, type invalid_request_error, code model_not_found)');
    expect(text).toMatch(/PROBES: 6 request target\(s\), spent \$\d+\.\d\d under a \$\d+\.\d\d lease, written to the ledger/);
    expect(r.lines.at(-2)).toBe('VERDICT: REFUSED');
  });

  test('a rate limit and a server error get one retry each; a second one refuses as busy or not answering', async () => {
    const f = fixture();
    const once = transport({ anthropic: [{ status: 429, body: { error: { type: 'rate_limit_error' } }, headers: { 'retry-after': '3' } }], google: [{ status: 503, body: {} }] });
    const slept: number[] = [];
    const ok = await preflight({ ...options(f, once), probe: { env: { ...KEYS }, fetchImpl: once.fetchImpl, rawFetch: keyLimit(500), sleep: async ms => { slept.push(ms); } } });
    expect(ok.exit).toBe(0);
    expect(ok.lines.join('\n')).toContain('PROBE: ok anthropic:claude-opus-5-5 status 200 after one retry');
    expect(slept.sort((a, b) => a - b)).toEqual([2000, 3000]);
    const twice = transport({ anthropic: [{ status: 429, body: {} }, { status: 429, body: {} }], google: [{ status: 503, body: {} }, { status: 500, body: {} }] });
    const r = await preflight(options(f, twice));
    expect(r.lines.join('\n')).toContain('REFUSED: HE-PROVIDER-004 anthropic:claude-opus-5-5 rate limited twice');
    expect(r.lines.join('\n')).toContain('REFUSED: HE-PROVIDER-005 google:gemini-4-carbon not answering (status 500)');
  });

  test('no key reaches the output, the receipt or the override log, even when a provider echoes it', async () => {
    const f = fixture();
    const echo = (k: string) => ({ status: 401, body: { error: { type: k, code: k, message: `Incorrect API key provided: ${k}` } } });
    const t = transport({ openai: [echo(KEYS.OPENAI_API_KEY)], google: [echo(KEYS.GEMINI_API_KEY)], openrouter: [echo(KEYS.OPENROUTER_API_KEY)] });
    const o = options(f, t, { override: { reason: 'the coordinator accepts the refusal for one launch', by: 'coordinator-1' } });
    const r = await preflight(o);
    const all = everything(r, o.dest);
    for (const key of Object.values(KEYS)) expect(all).not.toContain(key);
    expect(all).not.toContain('Incorrect API key');
  });

  test('a missing key refuses without sending anything to that provider', async () => {
    const f = fixture();
    const t = transport();
    const env: Record<string, string> = { ...KEYS };
    delete env.XAI_API_KEY;
    const r = await preflight({ ...options(f, t), probe: { env, fetchImpl: t.fetchImpl, rawFetch: keyLimit(500), sleep: async () => {} } });
    expect(r.exit).toBe(3);
    expect(t.calls.some(c => c.provider === 'xai')).toBe(false);
    expect(r.lines.join('\n')).toContain('REFUSED: HE-PROVIDER-001 xai:grok-4.7 key missing: XAI_API_KEY is not set on this machine');
  });

  test('the OpenRouter key limit is read for free and refuses below the shard lease; no limit set passes', async () => {
    const f = fixture();
    const low = await preflight(options(f, transport(), {}, keyLimit(12.5)));
    expect(low.exit).toBe(3);
    expect(low.lines.join('\n')).toContain('REFUSED: HE-PROVIDER-002 openrouter key has $12.50 left, below the shard\'s $50.00 lease; next: a person raises the key\'s limit or adds credit at https://openrouter.ai/settings/credits');
    expect((await preflight(options(f, transport(), {}, keyLimit(null)))).exit).toBe(0);
    expect((await preflight(options(f, transport(), {}, keyLimit(null, 401)))).lines.join('\n')).toContain('REFUSED: HE-PROVIDER-001 openrouter key limit unreadable (status 401)');
  });

  test('a shard cell with no pilot price, or a plan past its stop, refuses before launch', async () => {
    const unpriced = fixture(1000, 4);
    const r = await preflight(options(unpriced, transport(), { cells: ['claude'] }));
    expect(r.exit).toBe(3);
    expect(r.lines.join('\n')).toContain('REFUSED: HE-BUDGET-006 claude has no pilot price');
    const over = fixture(5);
    const o = await preflight(options(over, transport(), { cells: ['claude'] }));
    expect(o.lines.join('\n')).toMatch(/REFUSED: HE-BUDGET-005 projected total \$\d+\.\d\d = spent \$3\.00 \+ remaining \$\d+\.\d\d, which passes the stop \$5\.00/);
  });

  test('the coordinating agent can override a refusal with a reason; it is printed, written to the receipt and appended to the log', async () => {
    const f = fixture(5);
    const o = options(f, transport(), { cells: ['claude'], override: { reason: 'the owner raised the stop; the amendment lands tonight', by: 'coordinator-1' } });
    const r = await preflight(o);
    expect(r.exit).toBe(0);
    expect(r.lines.join('\n')).toMatch(/OVERRIDE: by coordinator-1 \(.+\) at .+: the owner raised the stop; the amendment lands tonight/);
    expect(r.lines.at(-2)).toBe('VERDICT: OVERRIDDEN');
    const log = readFileSync(join(o.dest, 'launch-overrides.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ run_id: 'fixture-run', by: 'coordinator-1', reason: 'the owner raised the stop; the amendment lands tonight' });
    expect(log[0].refusals[0]).toContain('HE-BUDGET-005');
    expect(JSON.parse(readFileSync(join(o.dest, 'launch-preflight.json'), 'utf8')).override.by).toBe('coordinator-1');
    await expect(preflight({ ...o, override: { reason: 'no name', by: '' } })).rejects.toThrow(/HE-RUN-002 an override needs both/);
  });

  test('a fanout.sh manifest names the shard, its cells and its lease; no ledger is bad input', async () => {
    const f = fixture();
    const manifest = join(dir('m'), 'fanout.json');
    writeFileSync(manifest, JSON.stringify({ commit: 'x', prereg: 'p', dest: 'd', shards: [{ name: 'one', cells: 'claude,sol', lease_usd: 30 }, { name: 'two', cells: 'muse', lease_usd: 20 }] }));
    const t = transport();
    const r = await preflight(options(f, t, { manifest, shard: 'one', cells: [] }));
    expect(r.lines[0]).toBe('PREFLIGHT: fixture-run shard=one cells=claude,sol lease=$30.00');
    expect(t.calls.map(c => c.provider).sort()).toEqual(['anthropic', 'openai']);
    await expect(preflight(options(f, transport(), { ledgers: [] }))).rejects.toThrow(/HE-BUDGET-004/);
    await expect(preflight(options(f, transport(), { cells: ['nope'] }))).rejects.toThrow(/HE-RUN-002 shard cell\(s\) nope are not in the plan/);
  });

  test("the receipt vouches for the manifest's commit when the plan files match it, so a run pinned before this script changed can launch", async () => {
    const f = fixture();
    const repo = dir('repo');
    const git = (...a: string[]) => spawnSync('git', ['-C', repo, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...a], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: repo } }).stdout.trim();
    git('init', '-q');
    cpSync(f.folder, join(repo, 'plan'), { recursive: true });
    git('add', '.'); git('commit', '-q', '-m', 'pinned');
    const pinned = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'later.txt'), 'a later change outside the plan\n');
    git('add', '.'); git('commit', '-q', '-m', 'later');
    const manifest = join(dir('m'), 'fanout.json');
    writeFileSync(manifest, JSON.stringify({ commit: pinned.slice(0, 12), prereg: 'plan/prereg-harbor-s0.json', dest: 'd', shards: [{ name: 'one', cells: 'claude', lease_usd: 30 }] }));
    const run = async () => { const o = options({ ...f, folder: join(repo, 'plan') }, transport(), { manifest, shard: 'one', cells: [] }); const r = await preflight(o); return { r, receipt: JSON.parse(readFileSync(join(o.dest, 'launch-preflight.json'), 'utf8')) }; };
    const ok = await run();
    expect(ok.receipt.commit).toBe(pinned);
    expect(ok.receipt.tool_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(ok.r.lines).toContain(`COMMIT: ${pinned} (the manifest's; the plan files read here match it; this script ran at ${ok.receipt.tool_commit.slice(0, 12)})`);
    writeFileSync(join(repo, 'plan', 'PREREGISTRATION.md'), '## Cost projection\n\n- Spend stop: $999\n');
    const edited = await run();
    expect(edited.receipt.commit).toBe(edited.receipt.tool_commit);
    expect(edited.r.lines.join('\n')).toContain('the plan folder or a --plan-file differs from that commit');
    git('checkout', '-q', '--', 'plan');
    writeFileSync(join(repo, 'plan', 'extra.json'), '{}');
    expect((await run()).receipt.commit).not.toBe(pinned);
  });
});
