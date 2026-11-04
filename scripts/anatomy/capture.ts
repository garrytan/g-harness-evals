#!/usr/bin/env bun
// Keyless anatomy capture for one harness configuration.
//
// Runs one real multi-user trial through the runner in capture mode: the real
// world, task, preamble, slot binding and (with --gbrain) gbrain sidecar, the
// real metering proxy with dummy keys, and the proxy's upstream pointed at a
// fake model endpoint, which records every request body. --provider anthropic
// (the default) uses scripts/gsta-135/fake-anthropic.ts on the Messages wire;
// --provider openai uses tests/fixtures/fake-responses.ts on the Responses wire
// and makes the cell an openai:<model> cell, so OpenClaw and Hermes take their
// OpenAI branch and Codex runs at all; the growth and retry scenarios stay
// anthropic-only, since the Responses fake has no scripted usage or shell result.
// Optionally the harness's name lookups go
// to the egress sink (scripts/anatomy/sink), so every outside host it tries to
// reach is on record. Nothing is paid: each fake refuses any credential that is
// not the proxy's capture dummy (runner/trial/capture.ts CAPTURE_DUMMY_KEYS).
//
//   bun scripts/anatomy/capture.ts --harness openclaw --scenario plain [--config <label>]
//       [--provider anthropic|openai] [--model <name>] [--network bridge|internal]
//       [--task <v0.3 dev task>] [--gbrain] [--egress refuse|pass|off]
//       [--image <tag>] [--record <name>] [--max-output-tokens 128000] [--out <dir>]
//
// --max-output-tokens is the proxy's output cap (default 128000, what every shard runs). The proxy writes it into a
// request that names no cap and refuses one that names more, so a capture at a lower cap shows whether a harness
// states its own cap (refused, the trial ends model_error) or leaves it to the proxy (forwarded with the lower value).
// --model defaults to claude-haiku-5-5 on anthropic and gpt-6.1-sol on openai.
// --network internal puts the harness on the run's internal docker network (no
// route out, no DNS), as counted Codex cells run (HE-NET-001); it is the default
// for codex and the only network the runner allows it. The egress sink cannot be
// reached from the internal network, so there --egress defaults to off and the
// network itself is the egress control.
//
// Scenarios (the fake's turn script, see SCENARIOS below): plain, tools, retry,
// skills (reads probe skills of growing size, or only the sizes in
// ANATOMY_SKILL_KB=52,56; run it on the probe image built from
// scripts/anatomy/probe-skills), growth. Output under --out (default ~/.capy/work/harn15/captures/<id>):
// fake.ndjson (every request the harness sent, through the proxy), egress.ndjson
// (sink log, when --egress is not off), run/ (the runner's results directory),
// capture.json (what ran, at which commit and image, and the file digests).
// --record names the records directory publish.sh writes (default <harness>-<config>, the harness without a leading
// underscore, as in the image name: _fake records as fake-default), so a capture at a new pin
// or model sits beside the old one instead of replacing it (QM at b6786d67: --record qm-pi-b6786d67; a Responses-wire
// capture: --record openclaw-sol). A capture with --record has the record name in its id in place of <harness>-<config>.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { CAPTURE_DUMMY_KEYS } from '../../runner/trial/capture.ts';
import { resolveSet } from '../../harnesses/harness-zero/zero.ts';

const ROOT = resolve(import.meta.dir, '../..');
const BRIDGE = '172.17.0.1';
export const PROVIDERS = {
  anthropic: { fake: 'scripts/gsta-135/fake-anthropic.ts', key: CAPTURE_DUMMY_KEYS.ANTHROPIC_API_KEY, model: 'claude-haiku-5-5' },
  openai: { fake: 'tests/fixtures/fake-responses.ts', key: CAPTURE_DUMMY_KEYS.OPENAI_API_KEY, model: 'gpt-6.1-sol' },
} as const;

type Turn = Record<string, unknown>;
/** Harness Zero's world calls: by name under a set without tool-search (zero-min), through tool_search and call_tool under
 *  a set with it. */
const zeroSearch = (config: string): boolean => resolveSet(config === 'default' ? undefined : config).features.includes('tool-search');
const zeroCall = (config: string, tool: string): Turn => !zeroSearch(config)
  ? { call: tool }
  : { call: 'call_tool', arguments: { name: `mcp__world__${tool}`, arguments: {} } };

export const SCENARIOS: Record<string, (harness: string, config?: string) => Turn[]> = {
  plain: () => [],
  tools: (harness, config = 'default') => harness === 'harness-zero'
    ? !zeroSearch(config)
      ? [{ call: 'list_channels' }, { call: 'whoami' }, { call: 'search' }, { text: 'done' }]
      : [
          { call: 'tool_search', arguments: { query: 'list channels' } },
          zeroCall(config, 'list_channels'),
          { call: 'tool_search', arguments: { query: 'gbrain search' } },
          { text: 'done' },
        ]
    : harness === 'openclaw'
    ? [
        { call: 'tool_search', arguments: { query: 'list channels' } },
        { call: 'tool_search', arguments: { query: 'gbrain search' } },
        { text: 'done' },
      ]
    : harness === 'codex'
    ? [
        { call: 'mcp__world__list_channels' },
        { call: 'mcp__world__whoami' },
        { tool: 'ls /workspace' },
        { text: 'done' },
      ]
    : harness === 'hermes'
    ? [
        { call: 'tool_search', arguments: { queries: ['list channels'] } },
        { call: 'tool_describe', arguments: { names: ['mcp__world__list_channels', 'mcp__world__whoami'] } },
        { call: 'tool_call', arguments: { calls: [{ name: 'mcp__world__list_channels', arguments: {} }] } },
        { text: 'done' },
      ]
    : harness === 'claude-code'
    ? [
        { call: 'ToolSearch', arguments: { query: 'select:mcp__world__list_channels' } },
        { call: 'list_channels' },
        { call: 'ToolSearch', arguments: { query: 'gbrain search' } },
        { text: 'done' },
      ]
    : [
        { call: 'list_channels' },
        { call: 'whoami' },
        { call: 'search' },
        { text: 'done' },
      ],
  retry: () => [
    { status: 529 },
    { status: 529 },
    { status: 429, headers: { 'retry-after': '2' } },
    { status: 500 },
    { text: 'done after failures' },
  ],
  skills: (harness) => [
    ...(process.env.ANATOMY_SKILL_KB ? process.env.ANATOMY_SKILL_KB.split(',').map(Number) : [4, 8, 12, 16, 20, 24, 32, 48, 64, 80]).map((kb) => harness === 'openclaw'
      ? { call: 'read', arguments: { path: `/workspace/skills/probe-${kb}k/SKILL.md` } }
      : { call: 'skill_view', arguments: { name: `probe-${kb}k` } }),
    { text: 'done' },
  ],
  growth: (harness, config = 'default') => Array.from({ length: 30 }, (_, i) => {
    // Harness Zero has no shell tool, so its 30 calls are world reads with small results: the record shows whether the
    // history is kept whole, not how large tool output is handled (output-cap has its own test in harness-zero-serve).
    if (harness === 'harness-zero') return { ...zeroCall(config, 'list_channels'), usage: { input_tokens: 20000 + i * 6000, output_tokens: 50 } };
    const command = `python3 -c "print('anatomy-growth-${i} ' + 'x' * 60000)"`;
    const usage = { input_tokens: 20000 + i * 6000, output_tokens: 50 };
    if (harness === 'qm') return { call: 'execute', arguments: { command, purpose: 'anatomy growth probe' }, usage };
    return harness === 'claude-code'
      ? { call: 'Bash', arguments: { command: `node -e "console.log('anatomy-growth-${i} ' + 'x'.repeat(60000))"` }, usage }
      : { tool: command, usage };
  }),
};

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const git = (...a: string[]) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: homedir(), ...extra };
}

async function waitFor(path: string, test: (s: string) => boolean, ms: number) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (existsSync(path) && test(readFileSync(path, 'utf8'))) return;
    await Bun.sleep(200);
  }
  throw new Error(`timed out waiting for ${path}`);
}

if (import.meta.main) {
  const harness = arg('harness');
  const scenario = arg('scenario', 'plain')!;
  if (!harness || !Object.hasOwn(SCENARIOS, scenario)) {
    console.error(`usage: capture.ts --harness <name> --scenario <${Object.keys(SCENARIOS).join('|')}> [options]`);
    process.exit(64);
  }
  const config = arg('config', 'default')!;
  const task = arg('task', 'si-01-marrow-agrisupply-site')!;
  const provider = arg('provider', 'anthropic')! as keyof typeof PROVIDERS;
  const network = arg('network', harness === 'codex' ? 'internal' : 'bridge')!;
  if (!Object.hasOwn(PROVIDERS, provider) || !['bridge', 'internal'].includes(network)) {
    console.error('capture.ts: --provider is anthropic or openai, --network is bridge or internal');
    process.exit(64);
  }
  if (provider === 'openai' && (scenario === 'growth' || scenario === 'retry')) {
    console.error(`capture.ts: the Responses fake does not play the ${scenario} scenario (no scripted usage or shell result); use --provider anthropic`);
    process.exit(64);
  }
  const model = arg('model', PROVIDERS[provider].model)!;
  const egress = arg('egress', network === 'internal' ? 'off' : 'refuse')!;
  if (network === 'internal' && egress !== 'off') {
    console.error('capture.ts: the egress sink is not reachable from the internal network; drop --egress or pass --egress off');
    process.exit(64);
  }
  const record = arg('record', `${harness.replace(/^_/, '')}-${config}`)!;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(record)) {
    console.error(`capture.ts: --record ${record} is not [A-Za-z0-9._-]+`);
    process.exit(64);
  }
  const maxOutputTokens = arg('max-output-tokens', '128000')!;
  if (!/^[1-9][0-9]*$/.test(maxOutputTokens)) {
    console.error('capture.ts: --max-output-tokens is a positive integer');
    process.exit(64);
  }
  const withGbrain = process.argv.includes('--gbrain');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const id = `anatomy-capture-${record}-${scenario}${withGbrain ? '-gbrain' : ''}-${stamp}`.toLowerCase();
  const out = resolve(arg('out', join(homedir(), '.capy/work/harn15/captures', id))!);
  mkdirSync(out, { recursive: true });
  const fakePort = 8790 + Math.floor(Math.random() * 100);

  const scriptPath = join(out, 'script.json');
  writeFileSync(scriptPath, JSON.stringify(SCENARIOS[scenario]!(harness, config), null, 1));
  const fake = spawn(process.execPath, [join(ROOT, PROVIDERS[provider].fake), '--host', BRIDGE, '--port', String(fakePort),
    '--log', join(out, 'fake.ndjson'), '--script', scriptPath, '--require-key-prefix', PROVIDERS[provider].key, '--max-requests', '200', '--max-seconds', '900'],
    { env: cleanEnv(), stdio: ['ignore', openSync(join(out, 'fake.out'), 'a'), openSync(join(out, 'fake.out'), 'a')] });
  await waitFor(join(out, 'fake.out'), (s) => s.includes('listening'), 20_000);

  let sinkName: string | null = null;
  let dns = 'none';
  if (egress !== 'off') {
    sinkName = `anat-sink-${process.pid}`;
    const r = spawnSync('docker', ['run', '-d', '--rm', '--name', sinkName, '-v', `${out}:/out`, 'harness-eval/anatomy-sink:dev',
      '--log', '/out/egress.ndjson', '--mode', egress], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`sink did not start: ${r.stderr}`);
    await waitFor(join(out, 'egress.ndjson'), (s) => s.includes('"ready"'), 20_000);
    dns = JSON.parse(readFileSync(join(out, 'egress.ndjson'), 'utf8').split('\n')[0]!).address;
  }

  const cell: Record<string, unknown> = {
    id: `${harness}-${config}-capture`, harness, model: `${provider}:${model}`, slice: 'multiuser', split: 'dev', task_set: 'v0.3',
    tasks: [task], repetitions: 1, ceiling: { input_tokens: 200000, output_tokens: 128000 },
  };
  if (network === 'internal') cell.network = 'internal';
  if (config !== 'default') cell.config = config;
  // Harness Zero cells must run on the internal network (HE-NET-001), which also rules out any direct connection out.
  if (harness === 'harness-zero') cell.network = 'internal';
  if (withGbrain) cell.gbrain = { surface: 'starter' };
  const prereg = { schema_version: 1, run_id: id, question: `internal-task keyless anatomy capture: ${harness} ${config} ${scenario}`, tasks: {}, cells: [cell], wall_clock_s: 3600, spend_cap_usd: 5 };
  const preregPath = join(out, 'prereg.json');
  writeFileSync(preregPath, JSON.stringify(prereg, null, 2));
  const runDir = join(out, 'run');
  const env = cleanEnv();
  const plan = spawnSync(process.execPath, ['runner/run.ts', 'plan', '--prereg', preregPath, '--out', runDir], { cwd: ROOT, env, encoding: 'utf8' });
  writeFileSync(join(out, 'plan.log'), plan.stdout + plan.stderr);
  let runStatus: number | null = null;
  if (plan.status === 0) {
    const runArgs = ['runner/run.ts', 'run', '--manifest', join(runDir, 'manifest.json'), '--lease-usd', '5', '--new-lease',
      '--max-output-tokens', maxOutputTokens, '--capture-upstream', `${provider}=http://${BRIDGE}:${fakePort}`];
    if (dns !== 'none') runArgs.push('--capture-dns', dns);
    if (arg('image')) runArgs.push('--image', arg('image')!);
    const run = spawnSync(process.execPath, runArgs, { cwd: ROOT, env, encoding: 'utf8', timeout: 1_800_000 });
    writeFileSync(join(out, 'run.log'), (run.stdout ?? '') + (run.stderr ?? ''));
    runStatus = run.status;
  }
  fake.kill('SIGTERM');
  if (sinkName) spawnSync('docker', ['rm', '-f', sinkName]);

  const files = ['fake.ndjson', 'egress.ndjson', 'script.json', 'prereg.json'].filter((f) => existsSync(join(out, f)));
  const capture = {
    id, harness, config, record, scenario, task, provider, model, network, max_output_tokens: Number(maxOutputTokens), gbrain: withGbrain, egress, dns,
    harness_evals_commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0,
    image: arg('image', `harness-eval/${harness.replace(/^_/, '')}:dev`),
    image_id: spawnSync('docker', ['image', 'inspect', '-f', '{{.Id}}', arg('image', `harness-eval/${harness.replace(/^_/, '')}:dev`)!], { encoding: 'utf8' }).stdout.trim(),
    plan_exit: plan.status, run_exit: runStatus,
    files: Object.fromEntries(files.map((f) => [f, sha(join(out, f))])),
  };
  writeFileSync(join(out, 'capture.json'), JSON.stringify(capture, null, 2));
  console.log(`CAPTURE: ${id} plan=${plan.status} run=${runStatus} requests=${existsSync(join(out, 'fake.ndjson')) ? readFileSync(join(out, 'fake.ndjson'), 'utf8').trim().split('\n').length : 0} out=${out}`);
  process.exit(plan.status === 0 && runStatus === 0 ? 0 : 1);
}
