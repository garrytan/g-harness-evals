// HARN-116: gbrain's own model route (gbrain.llm "proxy"), keyless. The sidecar's docker arguments (a cell without llm gets
// exactly the arguments it got before; with llm, only the proxy slot URL and the runner's per-trial token, never a provider
// key), the entrypoint's refusals, the extraction-model check (HE-GBRAIN-017), the proxy's caller tag on the sidecar's slot,
// the usage split by caller and the cell fields. With HE_GBRAIN_IMAGE naming an image built from this checkout, the docker
// case starts a sidecar behind a real metering proxy in front of a fake Anthropic upstream and checks the route end to end.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BudgetRun, closeLedgers } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy, type Meter, type UsageLine } from '../runner/proxy/metering-proxy.ts';
import { buildManifest, gbrainLlmModels, loadPrereg, resolveGbrain, type Cell, type Prereg } from '../runner/run.ts';
import { executeRun } from '../runner/trial/run.ts';
import type { GradeResult, TrialEvidence } from '../runner/contracts.ts';
import { callGbrain, extractionModelProblem, gbrainImagePresent, sidecarEnvArgs, startGbrainSidecar } from '../runner/trial/gbrain.ts';
import { GBRAIN_CALLER, RunProxy, gbrainLlmUsage, summarizeUsage, trialKey, trialToken } from '../runner/trial/proxy.ts';
import { foreignModels } from '../runner/trial/trial.ts';
import { drive, KEY, requests } from './fixtures/proxy-install-slot/drive.ts';
import { meteredDockerArgs, parseMeteredArgs, runMetered } from '../scripts/owner-identity/gbrain-metered.ts';

const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-gbrain-llm-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

const TOKEN = 'trial-token:t1.00112233445566778899aabbccddeeff';
const URL_ = 'http://host.docker.internal:4100/t1.gbrain/anthropic';
const KEY_SHAPES = /sk-|ANTHROPIC_API_KEY=|OPENAI_API_KEY=|ANTHROPIC_AUTH_TOKEN=|OPENROUTER_API_KEY=|GEMINI_API_KEY=|VOYAGE_API_KEY=/;
const base = { trialId: 't1', trialSlug: 't1', split: 'dev' as const, outDir: '/unused' };

describe('the sidecar docker arguments', () => {
  test('a cell without llm gets exactly the arguments it got before (keyword, embedded, and member brain with serves)', () => {
    expect(sidecarEnvArgs(base)).toEqual(['-e', 'HE_GBRAIN_SPLIT=dev', '-e', 'HE_GBRAIN_OUT=/he-gbrain', '-e', 'HE_TRIAL_ID=t1', '-e', 'HE_GBRAIN_BRAIN=bot-visible', '-e', 'HE_GBRAIN_SCOPE=none', '-e', 'HE_GBRAIN_INGEST=off', '-e', 'HE_GBRAIN_SURFACE=starter', '-e', 'HE_GBRAIN_EMBEDDINGS=off']);
    expect(sidecarEnvArgs({ ...base, embeddings: 'openai:text-embedding-3-small', openaiBaseUrl: 'http://host.docker.internal:4100/t1.gbrain/openai', proxyToken: TOKEN, surface: 'verbs' })).toEqual(['-e', 'HE_GBRAIN_SPLIT=dev', '-e', 'HE_GBRAIN_OUT=/he-gbrain', '-e', 'HE_TRIAL_ID=t1', '-e', 'HE_GBRAIN_BRAIN=bot-visible', '-e', 'HE_GBRAIN_SCOPE=none', '-e', 'HE_GBRAIN_INGEST=off', '-e', 'HE_GBRAIN_SURFACE=verbs', '-e', 'HE_GBRAIN_EMBEDDINGS=openai:text-embedding-3-small', '-e', 'OPENAI_BASE_URL=http://host.docker.internal:4100/t1.gbrain/openai', '-e', `HE_GBRAIN_PROXY_TOKEN=${TOKEN}`]);
    expect(sidecarEnvArgs({ ...base, brain: 'member', scope: 'member', ingest: 'live', access: 'rules', channelRemember: 'conversation' })).toEqual(['-e', 'HE_GBRAIN_SPLIT=dev', '-e', 'HE_GBRAIN_OUT=/he-gbrain', '-e', 'HE_TRIAL_ID=t1', '-e', 'HE_GBRAIN_BRAIN=member', '-e', 'HE_GBRAIN_SCOPE=member', '-e', 'HE_GBRAIN_INGEST=live', '-e', 'HE_GBRAIN_ACCESS=rules', '-e', 'HE_GBRAIN_SURFACE=starter', '-e', 'HE_GBRAIN_EMBEDDINGS=off', '-e', 'HE_GBRAIN_CHANNEL_REMEMBER=conversation']);
    expect(sidecarEnvArgs({ ...base, scope: 'member', serves: 'several', servesMembers: ['dana-okafor', 'june-osei'], labels: 'readers' }).slice(-6)).toEqual(['-e', 'HE_GBRAIN_SERVES=several', '-e', 'HE_GBRAIN_MEMBERS=dana-okafor,june-osei', '-e', 'HE_GBRAIN_LABELS=readers']);
  });

  test('with llm proxy the sidecar sees the proxy slot URL and the per-trial token, appended, and no provider key', () => {
    const args = sidecarEnvArgs({ ...base, llm: 'proxy', anthropicBaseUrl: URL_, proxyToken: TOKEN, extractionModel: 'anthropic:claude-haiku-5-5' });
    expect(args.slice(0, 16)).toEqual(sidecarEnvArgs(base));
    expect(args.slice(16)).toEqual(['-e', 'HE_GBRAIN_LLM=proxy', '-e', `ANTHROPIC_BASE_URL=${URL_}`, '-e', `HE_GBRAIN_PROXY_TOKEN=${TOKEN}`]);
    for (const a of args) expect(a).not.toMatch(KEY_SHAPES);
    const pinned = sidecarEnvArgs({ ...base, llm: 'proxy', anthropicBaseUrl: URL_, proxyToken: TOKEN, extractionModel: 'anthropic:claude-opus-5-5', extractionPin: true });
    expect(pinned.slice(-2)).toEqual(['-e', 'HE_GBRAIN_EXTRACTION_PIN=anthropic:claude-opus-5-5']);
    // With embeddings too, one token serves both routes and is passed once.
    const both = sidecarEnvArgs({ ...base, embeddings: 'openai:text-embedding-3-small', openaiBaseUrl: 'http://h/o', llm: 'proxy', anthropicBaseUrl: URL_, proxyToken: TOKEN, extractionModel: 'anthropic:claude-haiku-5-5' });
    expect(both.filter((a) => a.startsWith('HE_GBRAIN_PROXY_TOKEN='))).toEqual([`HE_GBRAIN_PROXY_TOKEN=${TOKEN}`]);
    for (const a of both) expect(a).not.toMatch(KEY_SHAPES);
  });

  test('llm proxy without the route, the token or the expected model is HE-GBRAIN-002', () => {
    expect(() => sidecarEnvArgs({ ...base, llm: 'proxy', proxyToken: TOKEN, extractionModel: 'anthropic:claude-haiku-5-5' })).toThrow(/HE-GBRAIN-002 .*ANTHROPIC_BASE_URL/);
    expect(() => sidecarEnvArgs({ ...base, llm: 'proxy', anthropicBaseUrl: URL_, extractionModel: 'anthropic:claude-haiku-5-5' })).toThrow(/HE-GBRAIN-002 .*HE_GBRAIN_PROXY_TOKEN/);
    expect(() => sidecarEnvArgs({ ...base, llm: 'proxy', anthropicBaseUrl: URL_, proxyToken: TOKEN })).toThrow(/HE-GBRAIN-002 .*facts extraction model/);
  });
});

describe('the entrypoint refusals (run outside docker; each refusal comes before the brain is read)', () => {
  const run = (vars: Record<string, string>) => {
    const out = join(tmp, `ep-${Math.random().toString(36).slice(2)}`);
    // A scrubbed environment: PATH and the sidecar variables only, never the caller's.
    const r = spawnSync('bash', [join(ROOT, 'gbrain', 'entrypoint.sh')], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HE_GBRAIN_SPLIT: 'dev', HE_GBRAIN_OUT: out, ...vars }, encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr };
  };
  test('a bad value, a missing route, a token of another shape, a pin off Anthropic, or a route without proxy exits 2', () => {
    expect(run({ HE_GBRAIN_LLM: 'on' })).toMatchObject({ status: 2, stderr: expect.stringContaining('HE_GBRAIN_LLM must be off or proxy') });
    expect(run({ HE_GBRAIN_LLM: 'proxy', HE_GBRAIN_PROXY_TOKEN: TOKEN })).toMatchObject({ status: 2, stderr: expect.stringContaining('needs ANTHROPIC_BASE_URL') });
    for (const bad of ['', 'sk-ant-api03-not-a-real-key', 'trial-token:t1.short', `${TOKEN} extra`]) {
      const r = run({ HE_GBRAIN_LLM: 'proxy', ANTHROPIC_BASE_URL: URL_, HE_GBRAIN_PROXY_TOKEN: bad });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('needs HE_GBRAIN_PROXY_TOKEN');
      if (bad) expect(r.stderr).not.toContain(bad);
    }
    expect(run({ HE_GBRAIN_LLM: 'proxy', ANTHROPIC_BASE_URL: URL_, HE_GBRAIN_PROXY_TOKEN: TOKEN, HE_GBRAIN_EXTRACTION_PIN: 'openai:gpt-6.1-sol' })).toMatchObject({ status: 2, stderr: expect.stringContaining('must be an anthropic:<model> id') });
    expect(run({ ANTHROPIC_BASE_URL: URL_ })).toMatchObject({ status: 2, stderr: expect.stringContaining('need HE_GBRAIN_LLM=proxy') });
    expect(run({ HE_GBRAIN_EXTRACTION_PIN: 'anthropic:claude-opus-5-5' })).toMatchObject({ status: 2, stderr: expect.stringContaining('need HE_GBRAIN_LLM=proxy') });
  });
  test('the dummy token never sits in the environment under a key name; a real key variable still refuses the sidecar', () => {
    const src = readFileSync(join(ROOT, 'gbrain', 'entrypoint.sh'), 'utf8');
    expect(src).toContain('for k in ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN OPENAI_API_KEY');
    // The token becomes ANTHROPIC_API_KEY only after the key check, and only under proxy.
    expect(src.indexOf('export ANTHROPIC_API_KEY="$HE_GBRAIN_PROXY_TOKEN"')).toBeGreaterThan(src.indexOf('for k in ANTHROPIC_API_KEY'));
  });
});

test('extractionModelProblem: the receipt must name the cell\'s model', () => {
  const receipt = { schema_version: 1, extraction: { model: 'anthropic:claude-haiku-5-5', source: 'measured_default' }, pinned: null, route: { env: 'ANTHROPIC_BASE_URL', url: URL_ } };
  expect(extractionModelProblem(receipt, 'anthropic:claude-haiku-5-5')).toBeNull();
  expect(extractionModelProblem(receipt, 'anthropic:claude-opus-5-5')).toBe('gbrain resolved facts extraction to anthropic:claude-haiku-5-5 (source measured_default), the cell expects anthropic:claude-opus-5-5');
  expect(extractionModelProblem({ ...receipt, schema_version: 2 }, 'anthropic:claude-haiku-5-5')).toContain('not a schema 1 receipt');
  expect(extractionModelProblem(null, 'anthropic:claude-haiku-5-5')).toContain('not a schema 1 receipt');
});

describe('the proxy caller tag', () => {
  const linesOf = async (caller?: string) => {
    const dir = join(tmp, `caller-${caller ?? 'none'}`);
    mkdirSync(dir, { recursive: true });
    class Tagged extends MeteringProxy { override bind(...a: Parameters<MeteringProxy['bind']>) { a[9] = caller ?? null; return super.bind(...a); } }
    const out = await drive(Tagged as never, BudgetRun as never, dir);
    return readFileSync(out.usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine);
  };
  test('a slot bound with a caller writes it on every line of the trial key, and the lines are otherwise unchanged', async () => {
    const plain = await linesOf();
    const tagged = await linesOf('gbrain');
    expect(tagged).toHaveLength(requests().length);
    const strip = (l: UsageLine) => { const { at: _at, caller: _c, ...rest } = l; return rest; };
    expect(tagged.map(strip)).toEqual(plain.map(strip));
    expect(plain.some((l) => 'caller' in l)).toBe(false);
    for (const l of tagged) expect(l.caller).toBe(l.key === KEY ? 'gbrain' : undefined);
    expect(tagged.filter((l) => l.key === KEY && l.route === '/v1/messages/count_tokens' && l.caller === 'gbrain').length).toBeGreaterThan(0);
  });
  test('the control endpoint takes a short lowercase caller and refuses anything else', async () => {
    const lease = BudgetRun.openLease({ runId: 'caller-bind', leaseUsd: 1, ledgerPath: join(tmp, 'caller-bind.sqlite') });
    const proxy = new MeteringProxy({ hostname: '127.0.0.1', port: 0, controlToken: 'ctl', policy: { lease, env: {}, usageLog: join(tmp, 'caller-bind.ndjson') } as never });
    proxy.start();
    try {
      const bind = (caller: unknown) => fetch(`http://127.0.0.1:${proxy.port}/__proxy/bind`, { method: 'POST', headers: { 'x-proxy-control': 'ctl', 'content-type': 'application/json' }, body: JSON.stringify({ slot: 's', key: 'k', caller }) }).then((r) => r.status);
      expect(await bind('gbrain')).toBe(200);
      for (const bad of ['GBrain', 'g brain', '', 42, 'x'.repeat(40)]) expect(await bind(bad)).toBe(400);
    } finally { proxy.stop(); }
  });
});

describe('the usage split by caller', () => {
  const line = (o: Partial<UsageLine>): UsageLine => ({ at: '2026-11-19T00:00:00Z', key: 'k', provider: 'anthropic', route: '/v1/messages', model: 'claude-opus-5-5', outcome: 'forwarded', actual_usd: 0.1, input_tokens: 100, output_tokens: 10, ...o });
  const lines = [
    line({}), line({ input_tokens: 50 }),
    line({ caller: GBRAIN_CALLER, model: 'claude-haiku-5-5', actual_usd: 0.01, input_tokens: 400, output_tokens: 40, cached_tokens: 5 }),
    line({ caller: GBRAIN_CALLER, model: 'claude-haiku-4-5-20251001', outcome: 'refused', actual_usd: undefined }),
    line({ caller: GBRAIN_CALLER, model: 'claude-haiku-5-5', outcome: 'failed', actual_usd: 0.02, input_tokens: undefined, output_tokens: undefined }),
    line({ caller: GBRAIN_CALLER, provider: 'openai', route: '/v1/embeddings', model: 'text-embedding-3-small', actual_usd: 0.0001, input_tokens: 4, output_tokens: undefined }),
  ];
  const meter: Meter = { requests: 5, usd: 0.2301, unpriced: 0, byModel: { 'anthropic:claude-opus-5-5': { usd: 0.2, requests: 2 }, 'anthropic:claude-haiku-5-5': { usd: 0.03, requests: 2 }, 'openai:text-embedding-3-small': { usd: 0.0001, requests: 1 } } } as Meter;
  test('the harness figures leave gbrain\'s lines out, usd stays the meter total, and gbrainLlmUsage reports them apart', () => {
    const { usage } = summarizeUsage('k', meter, lines);
    expect(usage).toMatchObject({ requests: 2, refused: 0, failed: 0, input_tokens: 150, output_tokens: 20, usd: 0.2301 });
    expect(gbrainLlmUsage(lines)).toEqual({ requests: 1, input_tokens: 400, output_tokens: 40, cached_tokens: 5, usd: 0.03, by_model: { 'anthropic:claude-haiku-5-5': 2 }, refused: 1, failed: 1 });
    // Without a caller tag the split is what it was: only embedding lines leave the harness figures.
    const untagged = lines.map(({ caller: _c, ...l }) => l as UsageLine);
    expect(summarizeUsage('k', meter, untagged).usage).toMatchObject({ requests: 4, refused: 1, failed: 1 });
    expect(gbrainLlmUsage(untagged).requests).toBe(0);
  });
  test('gbrain\'s models are not foreign to the trial, but the harness asking for one still is', () => {
    const harnessLines = lines.filter((l) => l.caller !== GBRAIN_CALLER);
    expect(foreignModels('anthropic:claude-opus-5-5', meter.byModel, harnessLines, 'openai:text-embedding-3-small', [], ['anthropic:claude-haiku-5-5'])).toEqual([]);
    expect(foreignModels('anthropic:claude-opus-5-5', meter.byModel, harnessLines, 'openai:text-embedding-3-small')).toEqual(['anthropic:claude-haiku-5-5']);
    const harnessAsked = [...harnessLines, line({ model: 'claude-haiku-5-5', outcome: 'refused' })];
    expect(foreignModels('anthropic:claude-opus-5-5', meter.byModel, harnessAsked, 'openai:text-embedding-3-small', [], ['anthropic:claude-haiku-5-5'])).toEqual(['anthropic:claude-haiku-5-5']);
  });
});

describe('the cell fields gbrain.llm, extraction_model, extraction_pin and llm_models', () => {
  const cell = (gbrain: Cell['gbrain']): Cell => ({ id: 'fake-llm', harness: '_fake', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, gbrain });
  const load = (c: Cell, runId: string) => {
    const dir = join(tmp, runId);
    mkdirSync(dir, { recursive: true });
    const p: Prereg = { schema_version: 1, run_id: runId, question: 'llm fixture', tasks: {}, cells: [c], wall_clock_s: { multiuser: 120 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] };
    writeFileSync(join(dir, 'prereg.json'), JSON.stringify(p));
    return loadPrereg(join(dir, 'prereg.json')).prereg.cells[0]!;
  };
  test('a cell without llm resolves exactly as before, and has no gbrain models', () => {
    const r = resolveGbrain({ surface: 'starter' });
    expect(r).toEqual({ surface: 'starter', install: 'mcp', embeddings: 'off', brain: 'bot-visible', scope: 'none', ingest: 'off' });
    expect(resolveGbrain({ surface: 'starter', llm: 'off' })).toEqual(r);
    expect(gbrainLlmModels(r)).toEqual([]);
  });
  test('llm proxy loads with an Anthropic extraction model, resolves with it first, and is refused otherwise', () => {
    const ok = load(cell({ surface: 'starter', llm: 'proxy', extraction_model: 'anthropic:claude-haiku-5-5', llm_models: ['anthropic:claude-haiku-5-5', 'anthropic:claude-opus-5-5'] }), 'llm-ok');
    expect(gbrainLlmModels(resolveGbrain(ok.gbrain!))).toEqual(['anthropic:claude-haiku-5-5', 'anthropic:claude-opus-5-5']);
    expect(resolveGbrain(load(cell({ surface: 'starter', llm: 'proxy', extraction_model: 'anthropic:claude-opus-5-5', extraction_pin: true }), 'llm-pin').gbrain!)).toMatchObject({ llm: 'proxy', extraction_model: 'anthropic:claude-opus-5-5', extraction_pin: true });
    expect(() => load(cell({ surface: 'starter', llm: 'on' as 'proxy' }), 'llm-value')).toThrow(/HE-GBRAIN-001 .*gbrain.llm must be one of/);
    expect(() => load(cell({ surface: 'starter', llm: 'proxy' }), 'llm-no-model')).toThrow(/HE-GBRAIN-001 .*needs gbrain.extraction_model/);
    expect(() => load(cell({ surface: 'starter', extraction_model: 'anthropic:claude-haiku-5-5' }), 'llm-off-model')).toThrow(/HE-GBRAIN-001 .*need gbrain.llm "proxy"/);
    expect(() => load(cell({ surface: 'starter', llm: 'proxy', extraction_model: 'openai:gpt-6.1-sol' }), 'llm-openai')).toThrow(/HE-GBRAIN-001 .*Anthropic models only/);
    expect(() => load(cell({ surface: 'starter', llm: 'proxy', extraction_model: 'anthropic:claude-unpriced-9' }), 'llm-unpriced')).toThrow(/HE-PIN-002 .*claude-unpriced-9 has no price/);
    expect(() => load(cell({ surface: 'starter', llm: 'proxy', extraction_model: 'anthropic:claude-haiku-5-5', extraction_pin: 'yes' as unknown as boolean }), 'llm-pin-value')).toThrow(/HE-GBRAIN-001 .*extraction_pin must be true or false/);
  });
});

describe('the row P helper (scripts/owner-identity/gbrain-metered.ts)', () => {
  const argv = ['--lease', 'p-dev', '--cap-usd', '2', '--home', join(tmp, 'p-home'), '--out', join(tmp, 'p-out'), '--model', 'anthropic:claude-haiku-5-5'];
  test('parses its options and refuses a missing command, model or cap, a non-Anthropic or unpriced model, and a bad mount', () => {
    expect(parseMeteredArgs([...argv, '--mount', `${tmp}:/imports`, '--', 'import', '/imports', '--json'])).toMatchObject({ lease: 'p-dev', capUsd: 2, models: ['anthropic:claude-haiku-5-5'], mounts: [`${tmp}:/imports`], args: ['import', '/imports', '--json'] });
    expect(() => parseMeteredArgs(argv)).toThrow(/HE-GBRAIN-001 .*command after --/);
    expect(() => parseMeteredArgs([...argv.slice(0, -2), '--', 'models'])).toThrow(/at least one --model/);
    expect(() => parseMeteredArgs([...argv.slice(2), '--', 'models'])).toThrow(/needs --lease/);
    expect(() => parseMeteredArgs([...argv, '--model', 'openai:gpt-6.1-sol', '--', 'models'])).toThrow(/Anthropic models only/);
    expect(() => parseMeteredArgs([...argv, '--model', 'anthropic:claude-unpriced-9', '--', 'models'])).toThrow(/HE-PIN-002/);
    expect(() => parseMeteredArgs([...argv, '--expect-extraction', 'anthropic:claude-opus-5-5', '--', 'models'])).toThrow(/not among the --model ids/);
    expect(() => parseMeteredArgs([...argv, '--mount', 'relative', '--', 'models'])).toThrow(/--mount takes/);
    expect(() => parseMeteredArgs([...argv, '--key', 'x', '--', 'models'])).toThrow(/unknown option --key/);
  });
  test('the container gets the route and the token only, from an environment built from nothing', () => {
    const args = meteredDockerArgs({ home: '/h', mounts: ['/data:/imports'] }, { baseUrl: URL_, token: TOKEN }, ['/opt/gbrain/src/cli.ts', 'models'], '1000:1000');
    const env = args.flatMap((a, i) => (args[i - 1] === '-e' ? [a] : []));
    expect(env).toEqual(['GBRAIN_HOME=/brain-home', 'HOME=/brain-home', 'NO_COLOR=1', 'GBRAIN_SKIP_STARTUP_HOOKS=1', 'GBRAIN_MODEL_DISCOVERY=off', `ANTHROPIC_BASE_URL=${URL_}`, `ANTHROPIC_API_KEY=${TOKEN}`]);
    expect(args).toContain('/data:/imports:ro');
    for (const a of args) expect(a).not.toMatch(/sk-|OPENAI_API_KEY|--env-file/);
  });
});

const IMAGE = process.env.HE_GBRAIN_IMAGE;
const haveImage = !!IMAGE && spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0 && gbrainImagePresent(IMAGE);

describe.skipIf(!haveImage)('docker: gbrain\'s own model route through the metering proxy', () => {
  test('gbrain resolves the measured default, calls through the slot with the token only, and its lines are tagged; a mismatch is HE-GBRAIN-017', async () => {
    const seen: Array<{ path: string; key: string | null; auth: string | null; model: string | null }> = [];
    const fake = Bun.serve({ port: 0, hostname: '0.0.0.0', fetch: async (req) => {
      const body = await req.json().catch(() => ({})) as { model?: string };
      seen.push({ path: new URL(req.url).pathname, key: req.headers.get('x-api-key'), auth: req.headers.get('authorization'), model: body.model ?? null });
      return Response.json({ id: 'msg_f', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: '[]' }], stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 2 } });
    } });
    const runDir = join(tmp, 'docker-run');
    const proxy = await RunProxy.start({ runId: 'harn116-llm-docker', runDir, ledgerPath: join(runDir, 'ledger.sqlite'), leaseUsd: 1, allowModels: ['anthropic:claude-haiku-5-5', 'anthropic:claude-haiku-4-5-20251001'], reachableFromContainers: true, newRun: true,
      env: { PATH: process.env.PATH, HOME: tmp, ANTHROPIC_API_KEY: 'placeholder-anthropic' }, upstream: { anthropic: `http://127.0.0.1:${fake.port}` } });
    try {
      const key = trialKey('llm-docker'), token = trialToken('llm-docker'), slot = 'llm-docker.gbrain';
      await proxy.bind(slot, key, token, ['anthropic:claude-haiku-5-5', 'anthropic:claude-haiku-4-5-20251001'], undefined, false, {}, false, GBRAIN_CALLER);
      const o = { trialId: 'llm-docker', split: 'dev' as const, image: IMAGE, llm: 'proxy' as const, anthropicBaseUrl: proxy.baseUrlFor(slot, 'anthropic', true), proxyToken: token };
      const sidecar = await startGbrainSidecar({ ...o, trialSlug: 'llm-docker', outDir: join(tmp, 'docker-sidecar'), extractionModel: 'anthropic:claude-haiku-5-5' });
      try {
        const receipt = JSON.parse(readFileSync(join(tmp, 'docker-sidecar', 'llm.json'), 'utf8'));
        expect(receipt).toMatchObject({ schema_version: 1, extraction: { model: 'anthropic:claude-haiku-5-5', source: 'measured_default' }, pinned: null, route: { env: 'ANTHROPIC_BASE_URL', url: o.anthropicBaseUrl } });
        await callGbrain(sidecar.url, sidecar.token, 'query', { query: 'renewal pricing discount', limit: 3 }).catch(() => undefined);
      } finally { await sidecar.stop(); }
      for (const f of ['sidecar.log', 'llm.json', 'serve.log', 'llm.stderr.log']) expect(readFileSync(join(tmp, 'docker-sidecar', f), 'utf8')).not.toContain(token);
      for (const s of seen) { expect(s.key).toBe('placeholder-anthropic'); expect(s.auth).toBeNull(); }
      const lines = proxy.usageLines(key);
      for (const l of lines) expect(l.caller).toBe(GBRAIN_CALLER);
      expect(lines.length).toBe(seen.length);
      console.log(`gbrain made ${seen.length} model call(s) through the slot: ${[...new Set(seen.map((s) => `${s.path} ${s.model}`))].join(', ') || 'none'}`);
      await expect(startGbrainSidecar({ ...o, trialSlug: 'llm-docker-wrong', outDir: join(tmp, 'docker-wrong'), extractionModel: 'anthropic:claude-opus-5-5' })).rejects.toThrow(/^HE-GBRAIN-017 gbrain resolved facts extraction to anthropic:claude-haiku-5-5 \(source measured_default\), the cell expects anthropic:claude-opus-5-5/);
      const pinned = await startGbrainSidecar({ ...o, trialSlug: 'llm-docker-pin', outDir: join(tmp, 'docker-pin'), extractionModel: 'anthropic:claude-opus-5-5', extractionPin: true });
      await pinned.stop();
      expect(JSON.parse(readFileSync(join(tmp, 'docker-pin', 'llm.json'), 'utf8'))).toMatchObject({ extraction: { model: 'anthropic:claude-opus-5-5', source: 'config_key' }, pinned: 'anthropic:claude-opus-5-5' });
    } finally { await proxy.stop(); fake.stop(true); }
  }, 240_000);
  test('the row P helper inits a fresh home, imports, and meters gbrain\'s extraction calls under the lease, tagged', async () => {
    const imports = join(tmp, 'p-imports', 'chats');
    mkdirSync(imports, { recursive: true });
    writeFileSync(join(imports, 'dm-sam.md'), '---\ntitle: DM with Sam Rivera\ntype: conversation\ndate: 2026-11-01\n---\n\n**Avery Quill** (2026-11-01 09:00): I moved to Portland last month.\n\n**Sam Rivera** (2026-11-01 09:02): I just started at Fernwick Labs.\n');
    const seen: Array<{ path: string; key: string | null; model: string | null }> = [];
    const fake = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async (req) => {
      const body = await req.json().catch(() => ({})) as { model?: string };
      seen.push({ path: new URL(req.url).pathname, key: req.headers.get('x-api-key'), model: body.model ?? null });
      return Response.json({ id: 'msg_f', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 20, output_tokens: 2 } });
    } });
    try {
      const env = { PATH: process.env.PATH, HOME: tmp, ANTHROPIC_API_KEY: 'placeholder-anthropic' }, up = { anthropic: `http://127.0.0.1:${fake.port}` };
      const common = ['--lease', 'p-docker', '--cap-usd', '1', '--home', join(tmp, 'p-home'), '--out', join(tmp, 'p-out'), '--model', 'anthropic:claude-haiku-5-5', '--expect-extraction', 'anthropic:claude-haiku-5-5', '--image', IMAGE!, '--mount', `${join(tmp, 'p-imports')}:/imports`];
      const imported = await runMetered(parseMeteredArgs([...common, '--label', 'import', '--', 'import', '/imports', '--no-embed', '--json']), env, up);
      expect(imported.exit).toBe(0);
      expect(seen).toEqual([]);
      const o = parseMeteredArgs([...common, '--label', 'extract', '--', 'extract-conversation-facts']);
      const { record } = await runMetered(o, env, up);
      expect(record.receipt).toMatchObject({ extraction: { model: 'anthropic:claude-haiku-5-5', source: 'measured_default' } });
      const usage = record.usage as { requests: number; refused: number };
      console.log(`gbrain extract-conversation-facts through the helper: ${seen.length} upstream call(s) (${[...new Set(seen.map((s) => s.model))].join(', ')}), ${usage.requests} metered, ${usage.refused} refused`);
      expect(seen.length).toBeGreaterThan(0);
      expect(usage.requests).toBe(seen.length);
      for (const s of seen) expect(s.key).toBe('placeholder-anthropic');
      expect(seen.every((s) => s.model === 'claude-haiku-5-5')).toBe(true);
      const lines = readFileSync(join(tmp, 'p-out', 'extract.proxy', 'proxy-usage.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as UsageLine);
      for (const l of lines.filter((l) => l.key.startsWith('trial-token:'))) expect(l.caller).toBe(GBRAIN_CALLER);
      await expect(runMetered({ ...o, label: 'wrong', models: ['anthropic:claude-haiku-5-5', 'anthropic:claude-sonnet-4-6'], expectExtraction: 'anthropic:claude-sonnet-4-6' }, env, up)).rejects.toThrow(/^HE-GBRAIN-017 gbrain resolved facts extraction to anthropic:claude-haiku-5-5/);
    } finally { fake.stop(true); }
  }, 240_000);
  test('through the runner: a cell with llm proxy completes with the receipt and gbrain\'s usage on its record; a wrong extraction model is the trial\'s exam_fault', async () => {
    if (spawnSync('docker', ['image', 'inspect', 'harness-eval/fake:dev'], { stdio: 'ignore' }).status !== 0) return void console.log('skip: no harness-eval/fake:dev');
    const tasksRoot = join(tmp, 'llm-tasks');
    const taskDir = join(tasksRoot, 'multiuser', 'dev', 'gb-llm');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'task.toml'), ['id = "gb-llm"', 'slice = "multiuser"', 'split = "dev"', 'time_budget_s = 30', 'actors = ["dana-okafor"]', '',
      '[[turns]]', 'actor = "dana-okafor"', 'channel = "north-team"', 'text = """Which room?', '[fake:gbrain tools/list {}]"""', '', '[predicates]', 'required = []', 'forbidden_effects = []', ''].join('\n'));
    const cell = (id: string, extraction_model: string): Cell => ({ id, harness: '_fake', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, tasks: ['gb-llm'], gbrain: { surface: 'starter', llm: 'proxy', extraction_model } });
    const dir = join(tmp, 'llm-run');
    mkdirSync(dir, { recursive: true });
    const p: Prereg = { schema_version: 1, run_id: 'llm-run', question: 'llm fixture', tasks: {}, cells: [cell('llm-ok', 'anthropic:claude-haiku-5-5'), cell('llm-wrong', 'anthropic:claude-opus-5-5')], wall_clock_s: { multiuser: 120 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] };
    writeFileSync(join(dir, 'prereg.json'), JSON.stringify(p));
    const { prereg, sha256 } = loadPrereg(join(dir, 'prereg.json'));
    const manifest = buildManifest(prereg, sha256, '2026-11-19T00:00:00Z', { tasksRoot });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const fake = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async (req) => { const body = await req.json().catch(() => ({})) as { model?: string }; return Response.json({ id: 'm', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 1 } }); } });
    try {
      const grade = (_e: TrialEvidence): GradeResult => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] });
      const result = await executeRun(manifest, join(dir, 'manifest.json'), { harnessMode: 'docker', preamblePath: join(ROOT, 'tests', 'fixtures', 'preamble.md'), grade, repoRoot: ROOT, turnGraceS: 5, stopGraceS: 5, readyTimeoutS: 60, gbrainImage: IMAGE,
        proxyEnv: { PATH: process.env.PATH, HOME: tmp, ANTHROPIC_API_KEY: 'placeholder-anthropic' }, proxyUpstream: { anthropic: `http://127.0.0.1:${fake.port}` } });
      const ok = result.records.find((r) => r.cell === 'llm-ok')!, wrong = result.records.find((r) => r.cell === 'llm-wrong')!;
      expect(ok.termination).toBe('completed');
      expect(ok.gbrain!.llm).toMatchObject({ mode: 'proxy', expected_extraction_model: 'anthropic:claude-haiku-5-5', receipt: { extraction: { model: 'anthropic:claude-haiku-5-5', source: 'measured_default' } }, usage: { refused: 0, failed: 0 } });
      expect(wrong.termination).toBe('exam_fault');
      expect(wrong.error).toStartWith('HE-GBRAIN-017 gbrain resolved facts extraction to anthropic:claude-haiku-5-5');
      expect(wrong.turns.run).toBe(0);
      expect(wrong.gbrain!.llm).toMatchObject({ expected_extraction_model: 'anthropic:claude-opus-5-5', receipt: { extraction: { model: 'anthropic:claude-haiku-5-5' } } });
    } finally { fake.stop(true); }
  }, 300_000);
});
