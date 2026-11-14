#!/usr/bin/env bun
/**
 * End-to-end smoke of the OpenClaw and Hermes review sessions (harness-review.ts) on a synthetic unit repo, through the REAL
 * metering proxy in lease mode, on an internal docker network whose gateway the proxy listens on (the container reaches the
 * proxy and nothing else). Keyless by default: the proxy's upstream is a fake on the loopback (scripts/gsta-135/fake-anthropic.ts
 * for the anthropic route, tests/fixtures/particle/fake-particle.ts for the particle route) and the proxy holds a placeholder
 * key. With --paid the upstream is the provider and the proxy holds the real key, read by name from this process's
 * environment and passed to the proxy alone (never to the container, never printed), under a lease of --lease-usd.
 *
 *   bun scripts/review-bugs/harness-smoke.ts --harness openclaw|hermes --arms plain,review --route anthropic|particle \
 *     --model <name> --out <dir> [--paid --lease-usd 0.5] [--pin 4bee369d] [--time-budget 600]
 *
 * Writes <out>/sessions/<arm>/<trial>/ (session.json, task/, trial/), <out>/arms/<arm>/ (arm contract v1), <out>/usage.ndjson
 * (the proxy's usage log), <out>/ledger.sqlite and <out>/summary.json. The images are harness-eval/<h>:gstack-none (plain) and
 * harness-eval/<h>:gstack-<pin> (review), built per harnesses/README.md "gstack overlay images".
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ensureInternalNetwork, removeInternalNetwork } from '../../runner/trial/docker.ts';
import { collect, runSession } from './harness-review.ts';
import type { ReviewArm, ReviewHarness } from './told.ts';

const ROOT = resolve(import.meta.dir, '../..');
const KEY_ENV: Record<string, string> = { anthropic: 'ANTHROPIC_API_KEY', particle: 'PARTICLE_API_KEY', openai: 'OPENAI_API_KEY' };

/** A synthetic unit: main with one file, branch pr-1 with an off-by-one the review should flag. */
export function makeUnitRepo(dir: string) {
  mkdirSync(dir, { recursive: true });
  mkdirSync(dir + '.home', { recursive: true });
  const g = (...a: string[]) => { const r = spawnSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir + '.home', GIT_CONFIG_NOSYSTEM: '1' } }); if (r.status !== 0) throw new Error('git ' + a.join(' ') + ': ' + r.stderr); return r.stdout; };
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'Synthetic Unit');
  g('config', 'user.email', 'unit@example.invalid');
  writeFileSync(join(dir, 'window.py'), 'def in_window(day, start, end):\n    """True when day is inside the window, both ends included."""\n    return start <= day <= end\n');
  g('add', '-A'); g('commit', '-q', '-m', 'Add the window check');
  g('checkout', '-q', '-b', 'pr-1');
  writeFileSync(join(dir, 'window.py'), 'def in_window(day, start, end):\n    """True when day is inside the window, both ends included."""\n    return start <= day < end\n');
  g('add', '-A'); g('commit', '-q', '-m', 'Speed up the window check');
  g('config', '--unset', 'user.name'); g('config', '--unset', 'user.email');
  return dir;
}

const FAKE_SCRIPT = [
  { tool: 'git diff main...HEAD' },
  { text: 'The change makes the end day fall outside the window.\n\n```json\n[{"file": "window.py", "line": 3, "severity": "CRITICAL", "claim": "The end bound became exclusive, so the last day of the window is now outside it, against the docstring.", "evidence": "return start <= day < end"}]\n```\n' },
];

async function waitUp(url: string, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { await fetch(url); return; } catch { await Bun.sleep(100); } }
  throw new Error('nothing answered at ' + url);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const one = (k: string, d?: string) => { const i = argv.indexOf(k); const v = i >= 0 ? argv[i + 1] : d; if (v === undefined) { console.error('missing ' + k); process.exit(64); } return v; };
  const harness = one('--harness') as ReviewHarness;
  const arms = one('--arms', 'plain,review').split(',') as ReviewArm[];
  const route = one('--route', 'anthropic');
  const model = one('--model', route === 'particle' ? 'particle-1' : 'claude-opus-5-5');
  const out = resolve(one('--out'));
  const paid = argv.includes('--paid');
  const leaseUsd = one('--lease-usd', paid ? '0.5' : '5');
  const pin = one('--pin', '4bee369d');
  const budget = Number(one('--time-budget', '600'));
  mkdirSync(out, { recursive: true });
  const runId = 'harn95-smoke-' + randomBytes(4).toString('hex');
  const net = await ensureInternalNetwork('he-net-' + runId);
  const procs: ReturnType<typeof spawn>[] = [];
  const keyVar = KEY_ENV[route]!;
  try {
    const fakePort = 19000 + Math.floor(Math.random() * 500);
    const upstream: string[] = [];
    if (!paid) {
      const fakeLog = join(out, 'fake-requests.ndjson');
      const cmd = route === 'particle'
        ? ['tests/fixtures/particle/fake-particle.ts', '--host', '127.0.0.1', '--port', String(fakePort), '--log', fakeLog, '--expect-key', 'placeholder-' + route]
        : (writeFileSync(join(out, 'fake-script.json'), JSON.stringify(FAKE_SCRIPT)), ['scripts/gsta-135/fake-anthropic.ts', '--host', '127.0.0.1', '--port', String(fakePort), '--log', fakeLog, '--script', join(out, 'fake-script.json'), '--loop', '--max-seconds', String(budget * 4)]);
      procs.push(spawn(process.execPath, cmd, { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], env: { PATH: process.env.PATH!, HOME: out } }));
      await Bun.sleep(1500);
      upstream.push('--upstream', route + '=http://127.0.0.1:' + fakePort);
    }
    const control = randomBytes(18).toString('hex');
    const port = 19600 + Math.floor(Math.random() * 300);
    const proxyEnv: Record<string, string> = { PATH: process.env.PATH!, HOME: out };
    if (paid) { const v = process.env[keyVar]; if (!v) { console.error(keyVar + ' is not set; a paid smoke needs it in this process'); process.exit(2); } proxyEnv[keyVar] = v; }
    else proxyEnv[keyVar] = 'placeholder-' + route;
    procs.push(spawn(process.execPath, ['runner/proxy/metering-proxy.ts', '--listen', net.gateway + ':' + port, '--control-token', control, '--budget-ledger', join(out, 'ledger.sqlite'),
      '--lease-usd', leaseUsd, '--run-id', runId, '--new-run', '--allow-models', route + ':' + model, '--usage-log', join(out, 'usage.ndjson'), '--max-output-tokens', '128000', ...upstream],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], env: proxyEnv }));
    await waitUp('http://' + net.gateway + ':' + port + '/__proxy/status');
    const results: any[] = [];
    for (const arm of arms) {
      const slot = 'rr-' + harness + '-' + arm + '-' + randomBytes(3).toString('hex');
      const cred = 'trial-token:' + slot + '.' + randomBytes(16).toString('hex');
      const bound = await fetch('http://' + net.gateway + ':' + port + '/__proxy/bind', { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': control }, body: JSON.stringify({ slot, key: 'trial-token:' + slot, token: cred, models: [route + ':' + model] }) });
      if (!bound.ok) throw new Error('bind ' + slot + ' failed: ' + bound.status + ' ' + (await bound.text()).slice(0, 200));
      const unitRepo = makeUnitRepo(join(out, 'unit-' + slot));
      const image = arm === 'plain' ? 'harness-eval/' + harness + ':gstack-none' : 'harness-eval/' + harness + ':gstack-' + pin;
      const rec: any = runSession({ harness, arm, unit: 'synthetic/window#1', unitRepo, base: 'main', pass: 1, image, model,
        baseUrl: 'http://host.docker.internal:' + port + '/' + slot + '/' + route, apiKey: cred, out: join(out, 'sessions', arm, slot), trialId: slot, timeBudget: budget,
        network: net.name, hostGateway: net.gateway });
      results.push({ arm, slot, exit_code: rec.exit_code, termination: rec.termination, wall_ms: rec.wall_ms, transcript: rec.transcript.state, parse: rec.parse, read_audit: rec.read_audit.verdict, audit_counts: { skill_open: rec.read_audit.skill_open, helper_run: rec.read_audit.helper_run, gstack_path: rec.read_audit.gstack_path } });
      await fetch('http://' + net.gateway + ':' + port + '/__proxy/unbind', { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': control }, body: JSON.stringify({ slot }) });
    }
    const armOut: any = {};
    for (const arm of arms) armOut[arm] = collect({ sessions: join(out, 'sessions', arm), out: join(out, 'arms', arm), id: arm + '-' + harness + '-smoke', label: arm + ' on ' + harness + ' (' + model + ', smoke)', suite: 'harness-smoke', usageLogs: [join(out, 'usage.ndjson')], suiteSha256: null, date: new Date().toISOString().slice(0, 10), meterKey: (s) => 'trial-token:' + s.trial_id });
    const usage = existsSync(join(out, 'usage.ndjson')) ? readFileSync(join(out, 'usage.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const summary = { harness, route, model, paid, run_id: runId, network: net, results, arms: Object.fromEntries(Object.entries(armOut).map(([k, v]: any) => [k, { status: v.status, parse_outcomes: v.parse_outcomes, read_audit: v.read_audit }])),
      usage: { lines: usage.length, forwarded: usage.filter((l) => l.outcome === 'forwarded').length, refused: usage.filter((l) => l.outcome === 'refused').length, actual_usd: usage.reduce((a, l) => a + (typeof l.actual_usd === 'number' ? l.actual_usd : 0), 0), models: [...new Set(usage.map((l) => l.model))], served_models: [...new Set(usage.map((l) => l.served_model).filter(Boolean))] } };
    writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    for (const p of procs) p.kill();
    await Bun.sleep(300);
    await removeInternalNetwork(net.name);
  }
}
