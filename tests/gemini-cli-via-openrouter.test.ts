/**
 * The real Gemini CLI against the google route's via-OpenRouter mode (internal-task), keyless: Gemini CLI 0.68.0, configured the
 * way Harbor 0.24.0's GeminiCli class configures it (API-key auth pinned, a model alias carrying thinkingLevel HIGH with
 * thoughts included, web search and web fetch excluded, --yolo, a trusted workspace), talks to the metering proxy's google
 * route, and the proxy talks to the fake OpenRouter (scripts/frontier-harbor/fake-upstream.ts), which answers two tool turns
 * with thought signatures and then text, refuses a tool turn replayed without its signature, and stops on SAFETY_MARKER.
 * Our overlay (frontier_settings.py gemini_cli_settings, what agents.py FrontierGeminiCli merges into Harbor's settings) is
 * added, and the proxy runs with the run-wide output cap vm-run.sh gives it, so the route's own 65,536 cap is what holds.
 * Gemini CLI is not vendored: the test runs when GEMINI_CLI_PACKAGE names an extracted @google/gemini-cli 0.68.0 package
 * (npm pack @google/gemini-cli@0.68.0, the sha512 in scripts/frontier-harbor/pin.json) and is skipped otherwise. Every key
 * is a placeholder, and anything Gemini CLI tries to reach off the loopback goes to a dead proxy address. With
 * GEMINI_CLI_E2E_KEEP=<prefix> each run's output, usage lines and upstream requests are written to <prefix>-<run>.json.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BudgetRun, closeLedgers } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy, type UsageLine } from '../runner/proxy/metering-proxy.ts';
import { GEMINI_PROBE, reply, SAFETY_MARKER, signatureFor } from '../scripts/frontier-harbor/fake-upstream.ts';

type Json = Record<string, any>;
const PKG = process.env.GEMINI_CLI_PACKAGE ?? '';
const CLI = join(PKG, 'bundle/gemini.js');
const runnable = !!PKG && existsSync(CLI) && JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version === '0.68.0';
const NODE = Bun.which('node') ?? '/usr/bin/node';
const tmp = mkdtempSync(join(tmpdir(), 'gemini-cli-via-'));
const TOKEN = 'trial-token:t.0123456789abcdef0123456789abcdef';
const seen: { path: string; body: Json; status: number }[] = [];
let n = 0;
const fake = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async (req) => {
  const path = new URL(req.url).pathname;
  const body = req.method === 'POST' ? await req.json() as Json : {};
  const res = reply(path, body, ++n);
  seen.push({ path, body, status: res.status });
  return res;
} });
afterAll(() => { fake.stop(true); closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });

const rendered = (() => {
  const r = spawnSync('python3', [join(import.meta.dir, '../scripts/frontier-harbor/frontier_settings.py'), 'gemini-cli', 'google:gemini-4-carbon', 'http://127.0.0.1:1/t/google', TOKEN], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout) as { config: Json; settings: { endpoint: { slot_models: string[] } } };
})();
const SETTINGS = {
  security: { auth: { selectedType: 'gemini-api-key' } },
  modelConfigs: { customAliases: { 'harbor-gemini-4-carbon-high': { modelConfig: { model: 'gemini-4-carbon', generateContentConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' } } } } },
    ...rendered.config.modelConfigs },
  tools: { exclude: ['google_web_search', 'web_fetch'] },
  experimental: { skills: true },
  privacy: rendered.config.privacy,
};

function run(name: string, prompt: string) {
  const dir = join(tmp, name);
  mkdirSync(join(dir, 'home/.gemini'), { recursive: true });
  mkdirSync(join(dir, 'work'), { recursive: true });
  writeFileSync(join(dir, 'home/.gemini/settings.json'), JSON.stringify(SETTINGS, null, 2));
  const lease = BudgetRun.openLease({ runId: 'gemini-cli-' + name, leaseUsd: 5, ledgerPath: join(dir, 'lease.sqlite') });
  const usageLog = join(dir, 'usage.ndjson');
  const proxy = new MeteringProxy({ upstream: { openrouter: 'http://127.0.0.1:' + fake.port + '/openrouter' },
    policy: { lease, env: { OPENROUTER_API_KEY: 'placeholder-openrouter' }, usageLog, maxOutputTokens: 128_000, refuseHostedTools: true, googleVia: 'openrouter' } });
  proxy.start();
  proxy.bind('t', 'trial-token:t', TOKEN, rendered.settings.endpoint.slot_models);
  const from = seen.length;
  return new Promise<{ status: number | null; output: string; usage: UsageLine[]; upstream: typeof seen }>((resolve) => {
    const child = Bun.spawn([NODE, CLI, '--yolo', '--model=harbor-gemini-4-carbon-high', '--prompt=' + prompt], {
      cwd: join(dir, 'work'), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      env: { PATH: dirname(NODE) + ':/usr/bin:/bin', HOME: join(dir, 'home'), GEMINI_API_KEY: TOKEN, GOOGLE_GEMINI_BASE_URL: 'http://127.0.0.1:' + proxy.port + '/t/google',
        GEMINI_CLI_TRUST_WORKSPACE: 'true', HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost', NO_COLOR: '1', CI: '1' },
    });
    const kill = setTimeout(() => child.kill(), 150_000);
    void Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]).then(async ([out, err, status]) => {
      clearTimeout(kill);
      await Bun.sleep(100);
      const usage = existsSync(usageLog) ? readFileSync(usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine) : [];
      writeFileSync(join(dir, 'gemini-cli.txt'), out + '\n--- stderr ---\n' + err);
      if (process.env.GEMINI_CLI_E2E_KEEP) writeFileSync(process.env.GEMINI_CLI_E2E_KEEP + '-' + name + '.json', JSON.stringify({ status, output: out + '\n--- stderr ---\n' + err, usage, upstream: seen.slice(from) }, null, 1));
      proxy.stop();
      resolve({ status, output: out + err, usage, upstream: seen.slice(from) });
    });
  });
}

describe.skipIf(!runnable)('Gemini CLI 0.68.0 through the proxy to the fake OpenRouter', () => {
  test('a multi-turn tool loop: Gemini CLI runs both calls, every replayed tool turn carries its signature, and it ends on the text answer', async () => {
    const r = await run('loop', 'Run the probe commands you are given, then stop.');
    const carbon = r.upstream.filter((u) => u.path === '/openrouter/v1/chat/completions' && u.body.model === 'google/gemini-4-carbon');
    if (r.status !== 0 || carbon.length < 3) console.error(r.output.slice(-4000), JSON.stringify(r.usage.map((l) => [l.model, l.outcome, l.status, l.reason])));
    expect(r.status).toBe(0);
    expect(carbon.map((u) => u.status)).toEqual([200, 200, 200]);
    expect(carbon.every((u) => u.body.stream === true)).toBe(true);
    // Harbor's alias alone reaches only the first request of a turn (0.68.0 then asks for no thinking level after a tool result);
    // our customOverrides entry for the bare model puts thinkingLevel HIGH on every request, and the route caps output at 65,536.
    expect(carbon.map((u) => u.body.reasoning ?? null)).toEqual(Array(3).fill({ effort: 'high' }));
    expect(carbon.map((u) => u.body.max_completion_tokens)).toEqual([65_536, 65_536, 65_536]);
    expect(r.usage.filter((l) => l.outcome === 'forwarded' && !l.local_estimate).map((l) => l.thinking_level ?? null)).toEqual(['high', 'high', 'high']);
    const last = carbon[2]!.body.messages as Json[];
    const assistants = last.filter((m) => m.role === 'assistant' && m.tool_calls?.length);
    expect(assistants).toHaveLength(2);
    for (const a of assistants) expect(a.reasoning_details).toContainEqual({ type: 'reasoning.encrypted', data: signatureFor(a.tool_calls[0].id), id: a.tool_calls[0].id, format: 'google-gemini-v1', index: 1 });
    const results = last.filter((m) => m.role === 'tool').map((m) => m.content as string);
    expect(results[0]).toContain('he-gemini-probe-1-42');
    expect(results[1]).toContain('he-gemini-probe-2-42');
    expect(r.output).toContain('Fake upstream reply');
    const lines = r.usage.filter((l) => l.outcome === 'forwarded' && !l.local_estimate);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.every((l) => l.provider === 'google' && l.upstream === 'openrouter' && l.served_provider === 'Google' && l.streamed === true)).toBe(true);
  }, 180_000);

  test('a SAFETY stop ends the run with nothing executed, and the usage line records it', async () => {
    const r = await run('safety', 'Please do this: ' + SAFETY_MARKER);
    const carbon = r.upstream.filter((u) => u.path === '/openrouter/v1/chat/completions' && u.body.model === 'google/gemini-4-carbon');
    if (!carbon.length) console.error(r.output.slice(-4000));
    expect(carbon.length).toBeGreaterThanOrEqual(1);
    expect(carbon.every((u) => !(u.body.messages as Json[]).some((m) => m.role === 'tool'))).toBe(true);
    expect(r.usage.filter((l) => l.safety_stop).map((l) => l.safety_stop)).toContain('finish_reason:content_filter');
    expect(r.output).not.toContain('he-gemini-probe');
  }, 180_000);
});
