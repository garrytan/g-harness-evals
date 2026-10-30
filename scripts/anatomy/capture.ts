#!/usr/bin/env bun
// Keyless anatomy capture for one harness configuration (internal-task).
//
// Runs one real multi-user trial through the runner in capture mode: the real
// world, task, preamble, slot binding and (with --gbrain) gbrain sidecar, the
// real metering proxy with dummy keys, and the proxy's upstream pointed at the
// fake model endpoint (scripts/gsta-135/fake-anthropic.ts), which records every
// request. Optionally the harness's name lookups go to the egress sink
// (scripts/anatomy/sink), so every outside host it tries to reach is on record.
// Nothing is paid: the fake refuses any credential that is not the dummy.
//
//   bun scripts/anatomy/capture.ts --harness openclaw --scenario plain [--config <label>]
//       [--task <v0.3 dev task>] [--gbrain] [--egress refuse|pass|off] [--model claude-haiku-5-5]
//       [--image <tag>] [--out <dir>]
//
// Scenarios (the fake's turn script, see SCENARIOS below): plain, tools, retry,
// skills (reads probe skills of growing size, or only the sizes in
// ANATOMY_SKILL_KB=52,56; run it on the probe image built from
// scripts/anatomy/probe-skills), growth. Output under --out (default ~/.capy/work/harn15/captures/<id>):
// fake.ndjson (every request the harness sent, through the proxy), egress.ndjson
// (sink log, when --egress is not off), run/ (the runner's results directory),
// capture.json (what ran, at which commit and image, and the file digests).
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');
const DUMMY_ANTHROPIC = 'sk-ant-capture-dummy';
const BRIDGE = '172.17.0.1';

type Turn = Record<string, unknown>;
export const SCENARIOS: Record<string, (harness: string) => Turn[]> = {
  plain: () => [],
  tools: (harness) => harness === 'openclaw'
    ? [
        { call: 'tool_search', arguments: { query: 'list channels' } },
        { call: 'tool_search', arguments: { query: 'gbrain search' } },
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
  growth: (harness) => Array.from({ length: 30 }, (_, i) => {
    const command = `python3 -c "print('anatomy-growth-${i} ' + 'x' * 60000)"`;
    const usage = { input_tokens: 20000 + i * 6000, output_tokens: 50 };
    return harness === 'qm' ? { call: 'execute', arguments: { command, purpose: 'anatomy growth probe' }, usage } : { tool: command, usage };
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
  if (!harness || !SCENARIOS[scenario]) {
    console.error(`usage: capture.ts --harness <name> --scenario <${Object.keys(SCENARIOS).join('|')}> [options]`);
    process.exit(64);
  }
  const config = arg('config', 'default')!;
  const task = arg('task', 'si-01-marrow-agrisupply-site')!;
  const model = arg('model', 'claude-haiku-5-5')!;
  const egress = arg('egress', 'refuse')!;
  const withGbrain = process.argv.includes('--gbrain');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const id = `anatomy-capture-${harness}-${config}-${scenario}${withGbrain ? '-gbrain' : ''}-${stamp}`.toLowerCase();
  const out = resolve(arg('out', join(homedir(), '.capy/work/harn15/captures', id))!);
  mkdirSync(out, { recursive: true });
  const fakePort = 8790 + Math.floor(Math.random() * 100);

  const scriptPath = join(out, 'script.json');
  writeFileSync(scriptPath, JSON.stringify(SCENARIOS[scenario]!(harness), null, 1));
  const fake = spawn(process.execPath, [join(ROOT, 'scripts/gsta-135/fake-anthropic.ts'), '--host', BRIDGE, '--port', String(fakePort),
    '--log', join(out, 'fake.ndjson'), '--script', scriptPath, '--require-key-prefix', DUMMY_ANTHROPIC, '--max-requests', '200', '--max-seconds', '900'],
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
    id: `${harness}-${config}-capture`, harness, model: `anthropic:${model}`, slice: 'multiuser', split: 'dev', task_set: 'v0.3',
    tasks: [task], repetitions: 1, ceiling: { input_tokens: 200000, output_tokens: 128000 },
  };
  if (config !== 'default') cell.config = config;
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
      '--max-output-tokens', '128000', '--capture-upstream', `anthropic=http://${BRIDGE}:${fakePort}`];
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
    id, harness, config, scenario, task, model, gbrain: withGbrain, egress, dns,
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
