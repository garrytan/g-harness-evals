/**
 * Muse Code on the proxy's OpenRouter route (internal-task), keyless. Three parts:
 *  - the proxy alone: the /muse-code/models catalog Muse reads at its base URL's origin, Responses requests for
 *    meta/muse-wonder forwarded with the provider pin and metered (and no other OpenRouter model on that route), previous_response_id refused (HE-PROXY-013), and the
 *    served-elsewhere check running only when a Responses body names a provider;
 *  - the real Muse Code 1.4.20 binary (HE_TEST_MUSE_BIN, the sha256 in scripts/frontier-harbor/pin.json; not vendored) through
 *    broker.ts and the proxy to the fake OpenRouter Responses route (fake-upstream.ts museReply), inside a network namespace
 *    with only loopback (unshare -rn), run the way Harbor's MuseCode runs it with the settings.json frontier_settings.py renders:
 *    a streamed two-call bash loop whose encrypted reasoning comes back byte for byte, and Muse's reminder observers on the
 *    cell model, told apart by their prompt_cache_key;
 *  - agents.py FrontierMuseCode against Harbor 0.24.0's MuseCode (HE_TEST_HARBOR_PYTHON).
 * Every key is a placeholder or a random canary, and every spawned process gets an environment built from scratch.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BudgetRun, closeLedgers } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy, MUSE_CODE_CATALOG, type UsageLine } from '../runner/proxy/metering-proxy.ts';
import { createBroker } from '../scripts/frontier-harbor/broker.ts';
import { MUSE_PROBE, museEncrypted, reply } from '../scripts/frontier-harbor/fake-upstream.ts';

type Json = Record<string, any>;
const ROOT = resolve(import.meta.dir, '..');
const HERE = join(ROOT, 'scripts/frontier-harbor');
const MODEL = 'openrouter:meta/muse-wonder';
const TOKEN = 'trial-token:t.0123456789abcdef0123456789abcdef';
const PIN = { only: ['meta'], allow_fallbacks: false, max_price: { prompt: 4, completion: 20 } };
const pin = JSON.parse(readFileSync(join(HERE, 'pin.json'), 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'muse-code-via-'));
let k = 0;
const fresh = (name: string) => { const d = join(tmp, name + '-' + ++k); mkdirSync(d, { recursive: true }); return d; };
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

describe('the proxy\'s OpenRouter route for Muse Code', () => {
  const seen: { path: string; body: Json }[] = [];
  let named: string | null = null;
  const fake = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    const body = req.method === 'POST' ? await req.json() as Json : {};
    seen.push({ path, body });
    const res = reply(path, body, seen.length);
    if (named === null || body.stream) return res;
    return Response.json({ ...await res.json() as Json, provider: named });
  } });
  const dir = fresh('proxy');
  const usageLog = join(dir, 'usage.ndjson');
  const lease = BudgetRun.openLease({ runId: 'muse-route', leaseUsd: 100, ledgerPath: join(dir, 'lease.sqlite') });
  const proxy = new MeteringProxy({ upstream: { openrouter: 'http://127.0.0.1:' + fake.port + '/openrouter' },
    policy: { lease, env: { OPENROUTER_API_KEY: 'placeholder-openrouter' }, usageLog, maxOutputTokens: 128_000, refuseHostedTools: true } });
  proxy.start();
  proxy.bind('t', 'trial-token:t', TOKEN, [MODEL]);
  afterAll(() => { proxy.stop(); fake.stop(true); });
  const usage = () => existsSync(usageLog) ? readFileSync(usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine) : [];
  const post = (body: Json) => fetch('http://127.0.0.1:' + proxy.port + '/t/openrouter/v1/responses', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const request = { model: 'meta/muse-wonder', store: false, include: ['reasoning.encrypted_content'], reasoning: { effort: 'high', summary: 'auto' }, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }] };

  test('GET /muse-code/models at the root answers the one-model catalog itself: nothing forwarded, nothing metered, no token needed', async () => {
    const [before, lines] = [seen.length, usage().length];
    const res = await fetch('http://127.0.0.1:' + proxy.port + '/muse-code/models');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(MUSE_CODE_CATALOG);
    expect(MUSE_CODE_CATALOG).toEqual({ data: [{ id: 'meta/muse-wonder' }] });
    expect(seen.length).toBe(before);
    expect(usage().length).toBe(lines);
  });

  test('a Responses request goes to OpenRouter\'s /v1/responses pinned to Meta\'s endpoint, its output held to the cap, and is metered from OpenRouter\'s usage', async () => {
    named = null;
    const before = seen.length;
    const over = await post({ ...request, max_output_tokens: 500_000 });
    expect(over.status).toBe(400);
    expect(await over.text()).toContain('above this cell\'s cap of 128000');
    expect(seen.length).toBe(before);
    const res = await post({ ...request, max_output_tokens: 128_000 });
    expect(res.status).toBe(200);
    const sent = seen.at(-1)!;
    expect(sent.path).toBe('/openrouter/v1/responses');
    expect(sent.body.provider).toEqual(PIN);
    expect(sent.body.max_output_tokens).toBe(128_000);
    expect(sent.body.store).toBe(false);
    const line = usage().at(-1)!;
    expect(line).toMatchObject({ provider: 'openrouter', route: '/v1/responses', model: 'meta/muse-wonder', outcome: 'forwarded', status: 200, reasoning_effort: 'high', input_tokens: 100, output_tokens: 20, reasoning_tokens: 10, openrouter_cost_usd: 0.0001 });
    expect(line.generation_id).toMatch(/^gen-fake-meta-/);
    expect(line.served_elsewhere).toBeUndefined();
    expect(line.served_provider).toBeUndefined();
  });

  test('another OpenRouter model on /v1/responses is refused 403: the Responses route serves only Muse Code\'s catalog', async () => {
    const DS = 'openrouter:deepseek/deepseek-v4.1-flash-1017';
    proxy.bind('d', 'trial-token:d', TOKEN.replace('t.', 'd.'), [DS]);
    const before = seen.length;
    const res = await fetch('http://127.0.0.1:' + proxy.port + '/d/openrouter/v1/responses', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN.replace('t.', 'd.'), 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, model: 'deepseek/deepseek-v4.1-flash-1017' }) });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('allowlisted only for the Muse Code catalog (meta/muse-wonder)');
    expect(seen.length).toBe(before);
  });

  test('previous_response_id is refused (HE-PROXY-013) before anything is sent', async () => {
    const before = seen.length;
    const res = await post({ ...request, previous_response_id: 'resp_1' });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('HE-PROXY-013');
    expect(seen.length).toBe(before);
    expect(usage().at(-1)).toMatchObject({ outcome: 'refused', status: 400, route: '/v1/responses' });
  });

  test('a Responses body naming Meta records it; one naming another provider is served_elsewhere; one naming none is not', async () => {
    named = 'Meta';
    expect((await post(request)).status).toBe(200);
    expect(usage().at(-1)).toMatchObject({ served_provider: 'Meta' });
    expect(usage().at(-1)!.served_elsewhere).toBeUndefined();
    named = 'Some Other Host';
    expect((await post(request)).status).toBe(200);
    expect(usage().at(-1)).toMatchObject({ served_provider: 'Some Other Host', served_elsewhere: true });
    named = null;
    expect((await post(request)).status).toBe(200);
    expect(usage().at(-1)!.served_elsewhere).toBeUndefined();
  });
});

const MUSE = process.env.HE_TEST_MUSE_BIN ?? '';
const netns = !!Bun.which('unshare') && !!(Bun.which('ip') ?? (existsSync('/usr/sbin/ip') ? '/usr/sbin/ip' : null));
describe.skipIf(!MUSE || !existsSync(MUSE) || !netns)('the real Muse Code 1.4.20 through broker.ts and the proxy to the fake OpenRouter (keyless)', () => {
  test('a streamed two-call bash loop: every replayed function call carries its reasoning item byte for byte, and the observers stay out of the agent loop', async () => {
    const dir = fresh('e2e');
    const ip = Bun.which('ip') ?? '/usr/sbin/ip';
    const child = Bun.spawn(['unshare', '-rn', 'sh', '-c', ip + ' link set lo up && exec "$0" "$@"', process.execPath, join(ROOT, 'tests/fixtures/frontier-harbor/muse-e2e.ts'), MUSE, dir],
      { cwd: ROOT, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, TMPDIR: dir }, stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, err.slice(-3000)).toBe(0);
    const r = JSON.parse(out.trim().split('\n').at(-1)!) as { exit: number; out: string; token: string; upstream: { path: string; body: Json; status: number }[]; usage: UsageLine[]; loop: string[]; efforts: Json; replay: Json };
    expect(r.exit, r.out).toBe(0);
    expect(r.out).toContain('"terminal":"completed","text":"ok"');
    const key = (u: { body: Json }) => String(u.body.prompt_cache_key);
    const main = r.upstream.filter((u) => key(u).startsWith('tbh:main:'));
    const observers = r.upstream.filter((u) => !key(u).startsWith('tbh:main:'));
    expect(main).toHaveLength(3);
    expect(observers.length).toBeGreaterThanOrEqual(1);
    for (const u of r.upstream) {
      expect(u.path).toBe('/openrouter/v1/responses');
      expect(u.status).toBe(200);
      expect(u.body).toMatchObject({ model: 'meta/muse-wonder', stream: true, store: false, include: ['reasoning.encrypted_content'], provider: PIN });
      expect(u.body.previous_response_id).toBeUndefined();
    }
    expect(main.map((u) => u.body.reasoning)).toEqual(Array(3).fill({ effort: 'high', summary: 'auto' }));
    for (const u of observers) {
      expect(key(u)).toMatch(/^tbh:(skill|goal|verify)-reminder:/);
      expect(u.body.tools).toEqual([expect.objectContaining({ type: 'namespace', name: 'muse', tools: [expect.objectContaining({ name: 'submit_reminder_decision' })] })]);
    }
    expect(main[0]!.body.tools).toEqual([expect.objectContaining({ type: 'namespace', name: 'muse', tools: expect.arrayContaining([expect.objectContaining({ type: 'function', name: 'bash' })]) })]);
    const input = main[2]!.body.input as Json[];
    const calls = input.flatMap((it, i) => it.type === 'function_call' ? [i] : []);
    expect(calls).toHaveLength(2);
    for (const i of calls) {
      expect(input[i]).toMatchObject({ name: 'muse.bash' });
      expect(input[i]!.namespace).toBeUndefined();
      expect(input[i - 1]).toEqual({ type: 'reasoning', id: expect.stringMatching(/^rs_fake_meta_/), encrypted_content: museEncrypted(input[i]!.call_id), summary: [] });
    }
    expect(input.filter((it) => it.type === 'function_call').map((it) => JSON.parse(it.arguments).command)).toEqual([MUSE_PROBE(1), MUSE_PROBE(2)]);
    expect(JSON.stringify(input)).toContain('he-muse-probe-1-42');
    expect(JSON.stringify(input)).toContain('he-muse-probe-2-42');
    expect(JSON.stringify(r.upstream)).not.toContain(r.token);
    expect(r.usage).toHaveLength(r.upstream.length);
    expect(r.usage.every((l) => l.outcome === 'forwarded' && l.route === '/v1/responses' && l.streamed === true && l.served_elsewhere === undefined && typeof l.openrouter_cost_usd === 'number')).toBe(true);
    expect(r.loop).toEqual(main.map(key));
    expect(r.efforts).toEqual({ requests: 3, matching: 3, sent: { 'reasoning_effort=high': 3 } });
    expect(r.replay).toEqual({ requests: 3, replaying: 2, with_reasoning: 2, fields: { encrypted_content: 2 } });
  }, 220_000);
});

const HARBOR_PY = process.env.HE_TEST_HARBOR_PYTHON ?? '';
describe.skipIf(!HARBOR_PY || !existsSync(HARBOR_PY))('agents.py FrontierMuseCode against Harbor 0.24.0\'s MuseCode', () => {
  test('Harbor uploads our settings.json with the slot\'s URL, runs muse exec with the slot\'s token, and a binary with another sha256 stops the trial', async () => {
    const dir = fresh('harbor');
    const binds: Json[] = [];
    const broker = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createBroker({ proxy: 'http://proxy', gateway: 'http://172.17.0.1:8790', models: [MODEL], log: join(dir, 'binds.jsonl'), controlToken: 'c',
      fetch: (async (_u: string, init: RequestInit) => { binds.push(JSON.parse(String(init.body))); return new Response('{}'); }) as typeof fetch }) });
    try {
      const sha = pin.harnesses['muse-code'].binary_sha256 as string;
      const proc = Bun.spawn([HARBOR_PY, join(ROOT, 'tests/fixtures/frontier-harbor/muse_check.py'), 'http://127.0.0.1:' + broker.port, join(dir, 'jobs'), sha],
        { env: { PATH: '/usr/bin:/bin', PYTHONPATH: HERE }, stdout: 'pipe', stderr: 'pipe' });
      const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      expect(stderr).not.toContain('Traceback');
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(binds.map((b) => [b.slot, b.models])).toEqual([['muse-wonder__Trial', [MODEL]]]);
      const token = binds[0]!.token as string;
      expect(out.install).toEqual([expect.stringContaining("curl -fsSL '" + pin.harnesses['muse-code'].binary_url + "'")]);
      expect(out.install[0]).toContain('"$HOME/.local/bin/muse" --version');
      expect(out.muse.extra_env).toEqual({ META_API_KEY: token });
      expect(out.muse.settings).toEqual([{ target: '/tmp/harbor-muse/agent/config/muse/settings.json', settings: {
        schema_version: 1, endpoint_transport: { base_url: 'http://172.17.0.1:8790/muse-wonder__Trial/openrouter/v1', auth: 'bearer' },
        tools: { web_search: { mode: 'off' }, web_fetch: { enabled: false } }, telemetry: { enabled: false }, context_compaction: { provider_context_limit_tokens: 1_048_576 } } }]);
      expect(JSON.stringify(out.muse.settings)).not.toContain(token);
      expect(out.muse.run_command).toContain('muse exec --json --yolo --user-input-auto-resolve --session-id ');
      expect(out.muse.run_command).toContain('--model meta/muse-wonder --reasoning-effort high');
      expect(out.muse.run_env).toEqual({ META_API_KEY: token, MUSE_NO_AUTO_UPDATE: '1', XDG_CONFIG_HOME: '/tmp/harbor-muse/agent/config', XDG_DATA_HOME: '/tmp/harbor-muse/agent/data' });
      expect(out.muse.checks).toEqual({ binary: { binary_sha256: sha, matches_pin: true } });
      expect(out.muse.mismatch).toContain('HE-FRONTIER-014');
    } finally {
      broker.stop(true);
    }
  });
});
