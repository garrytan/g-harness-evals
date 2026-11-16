/**
 * Gemini CLI's tool schemas through both google routes of the metering proxy (internal-task), keyless. The fixture
 * tests/fixtures/gemini-cli/tools-0.68.0-request.json is the tools field of the first generateContent request the real Gemini CLI
 * 0.68.0 sends with Harbor's settings (the ones tests/gemini-cli-via-openrouter.test.ts uses), captured keylessly against
 * scripts/frontier-harbor/fake-upstream.ts. On the native google route the body the proxy forwards must carry those tools
 * byte-identical. On the via-OpenRouter route each function's parameters must be the faithful JSON Schema translation (type
 * names lower-cased, nullable folded into the type list; a parametersJsonSchema passes unchanged), with every other keyword,
 * default, enum, description, format and example included, byte-identical. When GEMINI_CLI_PACKAGE names an extracted
 * @google/gemini-cli 0.68.0 package (npm pack @google/gemini-cli@0.68.0, the sha512 in scripts/frontier-harbor/pin.json),
 * the same checks run on what the real binary sends through each route, and GEMINI_CLI_TOOLS_WRITE=1 rewrites the fixture
 * from it; without the package those tests are skipped. Every key is a placeholder.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BudgetRun, closeLedgers } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy } from '../runner/proxy/metering-proxy.ts';
import { reply, SAFETY_MARKER } from '../scripts/frontier-harbor/fake-upstream.ts';

type Json = Record<string, any>;
const FIXTURE = join(import.meta.dir, 'fixtures/gemini-cli/tools-0.68.0-request.json');
const TOKEN = 'trial-token:t.0123456789abcdef0123456789abcdef';
const MODEL = 'gemini-4-carbon';
const tmp = mkdtempSync(join(tmpdir(), 'gemini-cli-tool-schemas-'));
const upstream: { path: string; raw: string }[] = [];
let n = 0;
const fake = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async (req) => {
  const path = new URL(req.url).pathname;
  const raw = req.method === 'POST' ? await req.text() : '';
  upstream.push({ path, raw });
  return reply(path, raw ? JSON.parse(raw) : {}, ++n);
} });
afterAll(() => { fake.stop(true); closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

function proxy(via: boolean, slotModels = ['google:' + MODEL]) {
  const id = ++n;
  const lease = BudgetRun.openLease({ runId: 'tool-schemas-' + id, leaseUsd: 5, ledgerPath: join(tmp, 'lease-' + id + '.sqlite') });
  const base = 'http://127.0.0.1:' + fake.port;
  const p = new MeteringProxy({ upstream: via ? { openrouter: base + '/openrouter' } : { google: base + '/google' },
    policy: { lease, env: via ? { OPENROUTER_API_KEY: 'placeholder-openrouter' } : { GEMINI_API_KEY: 'placeholder-gemini' }, usageLog: join(tmp, 'usage-' + id + '.ndjson'),
      maxOutputTokens: 128_000, refuseHostedTools: true, ...(via ? { googleVia: 'openrouter' as const } : {}) } });
  p.start();
  p.bind('t', 'trial-token:t', TOKEN, slotModels);
  return p;
}

const SCHEMA_KEYS = ['items', 'prefixItems', 'anyOf', 'oneOf', 'allOf', 'not', 'additionalProperties'];
const KEPT = ['default', 'enum', 'description', 'format', 'example'];

/** The faithful translation of a Gemini Schema: type names lower-cased, nullable folded into the type list, nothing else touched. */
function faithful(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(faithful);
  if (!s || typeof s !== 'object') return s;
  const out: Json = {};
  for (const [k, v] of Object.entries(s as Json)) {
    if (k === 'nullable') continue;
    if (k === 'type' && typeof v === 'string') out.type = v.toLowerCase();
    else if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v as Json).map(([p, ps]) => [p, faithful(ps)]));
    else out[k] = SCHEMA_KEYS.includes(k) ? faithful(v) : v;
  }
  if ((s as Json).nullable === true && typeof out.type === 'string') out.type = [out.type, 'null'];
  return out;
}

/** Every default, enum, description, format and example of a schema and the schemas under it, with where it sits. */
function keywords(s: unknown, at = '$'): string[] {
  if (Array.isArray(s)) return s.flatMap((x, i) => keywords(x, at + '[' + i + ']'));
  if (!s || typeof s !== 'object') return [];
  const o = s as Json;
  return [...KEPT.filter((k) => k in o).map((k) => at + '.' + k + '=' + JSON.stringify(o[k])),
    ...Object.entries(o.properties ?? {}).flatMap(([p, ps]) => keywords(ps, at + '.properties.' + p)),
    ...SCHEMA_KEYS.filter((k) => o[k] && typeof o[k] === 'object').flatMap((k) => keywords(o[k], at + '.' + k))];
}

const declarations = (tools: Json[]) => tools.flatMap((t) => (t.functionDeclarations ?? []) as Json[]);
const request = (tools: Json[]) => ({ contents: [{ role: 'user', parts: [{ text: 'List the files. ' + SAFETY_MARKER }] }], tools });

/** The tools each route forwards for one request carrying these tools: the native body's tools, the translated functions. */
async function routes(tools: Json[]) {
  const out: { native?: string; translated?: Json[] } = {};
  for (const via of [false, true]) {
    const p = proxy(via);
    const from = upstream.length;
    const r = await fetch('http://127.0.0.1:' + p.port + '/t/google/v1beta/models/' + MODEL + ':streamGenerateContent?alt=sse',
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': TOKEN }, body: JSON.stringify(request(tools)) });
    await r.text();
    p.stop();
    expect(r.status).toBe(200);
    const sent = upstream.slice(from).map((u) => JSON.parse(u.raw) as Json);
    expect(sent).toHaveLength(1);
    if (via) out.translated = sent[0]!.tools;
    else out.native = JSON.stringify(sent[0]!.tools);
  }
  return out as { native: string; translated: Json[] };
}

function expectFaithful(tools: Json[], translated: Json[]) {
  const decls = declarations(tools);
  expect(translated.map((t) => t.function.name)).toEqual(decls.map((d) => d.name));
  decls.forEach((d, i) => {
    const fn = translated[i]!.function;
    const source = d.parametersJsonSchema ?? d.parameters;
    const want = d.parametersJsonSchema ?? faithful(d.parameters);
    expect([d.name, JSON.stringify(fn.parameters)]).toEqual([d.name, JSON.stringify(want)]);
    expect([d.name, keywords(fn.parameters)]).toEqual([d.name, keywords(source)]);
    expect([d.name, fn.description ?? null]).toEqual([d.name, d.description ?? null]);
  });
}

describe("Gemini CLI 0.68.0's tool schemas, from the committed fixture", () => {
  const tools = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Json[];

  test('the fixture holds function declarations only, with descriptions to check', () => {
    expect(tools.every((t) => Object.keys(t).join() === 'functionDeclarations')).toBe(true);
    expect(declarations(tools).length).toBeGreaterThanOrEqual(5);
    const all = declarations(tools).flatMap((d) => keywords(d.parametersJsonSchema ?? d.parameters));
    expect(all.some((k) => k.includes('.description='))).toBe(true);
  });

  test('the native google route forwards the tools byte-identical, and the via-OpenRouter route sends each function its faithful translation', async () => {
    const r = await routes(tools);
    expect(r.native).toBe(JSON.stringify(tools));
    expectFaithful(tools, r.translated);
  });

  test('a Gemini Schema declaration with literal values shaped like schemas reaches both routes unrewritten', async () => {
    const literal = { type: 'CARD', nullable: true };
    const planted = [{ functionDeclarations: [...declarations(tools), { name: 'planted', description: 'A planted check', parameters: { type: 'OBJECT', properties: {
      card: { type: 'OBJECT', nullable: true, description: 'A card', default: literal, example: literal, enum: [literal] },
      when: { type: 'STRING', format: 'date-time', default: '2026-11-15T00:00:00Z' },
      list: { type: 'ARRAY', items: { type: 'STRING', enum: ['A', 'B'], default: 'A' } },
    }, required: ['card'] } }] }];
    const r = await routes(planted);
    expect(r.native).toBe(JSON.stringify(planted));
    expectFaithful(planted, r.translated);
    expect(JSON.stringify(r.translated.at(-1)!.function.parameters.properties.card.default)).toBe(JSON.stringify(literal));
  });
});

const PKG = process.env.GEMINI_CLI_PACKAGE ?? '';
const CLI = join(PKG, 'bundle/gemini.js');
const runnable = !!PKG && existsSync(CLI) && JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version === '0.68.0';
const NODE = Bun.which('node') ?? '/usr/bin/node';

describe.skipIf(!runnable)('the real Gemini CLI 0.68.0 through both google routes', () => {
  const rendered = (() => {
    const r = spawnSync('python3', [join(import.meta.dir, '../scripts/frontier-harbor/frontier_settings.py'), 'gemini-cli', 'google:' + MODEL, 'http://127.0.0.1:1/t/google', TOKEN], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
    if (r.status !== 0) throw new Error(r.stderr);
    return JSON.parse(r.stdout) as { config: Json; settings: { endpoint: { slot_models: string[] } } };
  })();
  const SETTINGS = {
    security: { auth: { selectedType: 'gemini-api-key' } },
    modelConfigs: { customAliases: { 'harbor-gemini-4-carbon-high': { modelConfig: { model: MODEL, generateContentConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' } } } } },
      ...rendered.config.modelConfigs },
    tools: { exclude: ['google_web_search', 'web_fetch'] },
    experimental: { skills: true },
    privacy: rendered.config.privacy,
  };

  /** Gemini CLI against the proxy through a recorder that keeps each body the CLI sent; the prompt stops the fake on its first answer. */
  async function cli(via: boolean) {
    const dir = join(tmp, 'cli-' + (via ? 'via' : 'native'));
    mkdirSync(join(dir, 'home/.gemini'), { recursive: true });
    mkdirSync(join(dir, 'work'), { recursive: true });
    writeFileSync(join(dir, 'home/.gemini/settings.json'), JSON.stringify(SETTINGS, null, 2));
    const p = proxy(via, rendered.settings.endpoint.slot_models);
    const sent: { path: string; raw: string; upstreamFrom: number }[] = [];
    const recorder = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async (req) => {
      const url = new URL(req.url);
      const raw = req.method === 'POST' ? await req.text() : '';
      sent.push({ path: url.pathname, raw, upstreamFrom: upstream.length });
      const headers = new Headers(req.headers);
      headers.delete('host');
      headers.delete('content-length');
      const res = await fetch('http://127.0.0.1:' + p.port + url.pathname + url.search, { method: req.method, headers, body: raw || undefined });
      return new Response(await res.arrayBuffer(), { status: res.status, headers: res.headers });
    } });
    const child = Bun.spawn([NODE, CLI, '--yolo', '--model=harbor-gemini-4-carbon-high', '--prompt=List the files here. ' + SAFETY_MARKER], {
      cwd: join(dir, 'work'), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      env: { PATH: dirname(NODE) + ':/usr/bin:/bin', HOME: join(dir, 'home'), GEMINI_API_KEY: TOKEN, GOOGLE_GEMINI_BASE_URL: 'http://127.0.0.1:' + recorder.port + '/t/google',
        GEMINI_CLI_TRUST_WORKSPACE: 'true', HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost', NO_COLOR: '1', CI: '1' },
    });
    const kill = setTimeout(() => child.kill(), 120_000);
    const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    clearTimeout(kill);
    recorder.stop(true);
    p.stop();
    const generate = sent.filter((s) => /:(stream)?[gG]enerateContent$/.test(s.path) && (JSON.parse(s.raw) as Json).tools);
    if (!generate.length) console.error((out + err).slice(-4000));
    return generate.map((s) => ({ tools: (JSON.parse(s.raw) as Json).tools as Json[], forwarded: upstream.slice(s.upstreamFrom).map((u) => JSON.parse(u.raw) as Json).find((b) => b.tools) }));
  }

  test('on the native route every request the CLI sends reaches Google with its tools byte-identical, and they are the fixture', async () => {
    const reqs = await cli(false);
    expect(reqs.length).toBeGreaterThanOrEqual(1);
    for (const r of reqs) expect(JSON.stringify(r.forwarded!.tools)).toBe(JSON.stringify(r.tools));
    if (process.env.GEMINI_CLI_TOOLS_WRITE === '1') { mkdirSync(dirname(FIXTURE), { recursive: true }); writeFileSync(FIXTURE, JSON.stringify(reqs[0]!.tools, null, 1) + '\n'); }
    expect(reqs[0]!.tools).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  }, 180_000);

  test('on the via-OpenRouter route every request the CLI sends reaches OpenRouter with each function its faithful translation', async () => {
    const reqs = await cli(true);
    expect(reqs.length).toBeGreaterThanOrEqual(1);
    for (const r of reqs) expectFaithful(r.tools, r.forwarded!.tools);
    expect(reqs[0]!.tools).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  }, 180_000);
});
