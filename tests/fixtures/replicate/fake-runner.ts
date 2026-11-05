#!/usr/bin/env bun
// A stand-in for runner/run.ts in tests/replicate.test.ts: plan is the real runner's; preflight passes; run drives the REAL
// metering proxy (lease mode, a fake Anthropic upstream) through one or more requests per trial and writes trials.jsonl,
// run-summary.json and proxy-usage.ndjson the way the runner does. FAKE_REQUESTS_PER_TRIAL (default 2) and FAKE_HANG_AT
// (the 0-based pending trial that charges one request and then hangs) shape a run. Never holds a real key.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..', '..', '..');
const [cmd, ...rest] = process.argv.slice(2);
const flag = (n: string) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };

if (cmd === 'plan') {
  const r = spawnSync(process.execPath, [join(ROOT, 'runner', 'run.ts'), cmd, ...rest], { cwd: ROOT, stdio: 'inherit', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
  process.exit(r.status ?? 1);
}
if (cmd === 'preflight') {
  if (process.env.FAKE_PREFLIGHT_TAIL) { await Bun.write(Bun.stderr, process.env.FAKE_PREFLIGHT_TAIL); process.exit(2); }
  console.log('PREFLIGHT: ok (fake)');
  process.exit(0);
}
if (cmd !== 'run') process.exit(2);

const manifestPath = flag('--manifest')!;
const runDir = dirname(manifestPath);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { run_id: string; trials: Array<{ id: string; cell: string; task_dir: string }> };
const recorded = new Set(existsSync(join(runDir, 'trials.jsonl')) ? readFileSync(join(runDir, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { trial_id: string }).trial_id) : []);
const pending = manifest.trials.filter((t) => !recorded.has(t.id));
const upstream = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => Response.json({ id: 'msg', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1000, output_tokens: 200 } }) });
const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
const port = probe.port!;
probe.stop(true);
mkdirSync(runDir, { recursive: true });
const proxy = Bun.spawn([process.execPath, join(ROOT, 'runner', 'proxy', 'metering-proxy.ts'), '--listen', `127.0.0.1:${port}`, '--budget-ledger', flag('--ledger')!, '--lease-usd', flag('--lease-usd')!, '--run-id', manifest.run_id,
  '--usage-log', join(runDir, 'proxy-usage.ndjson'), '--upstream', `anthropic=http://127.0.0.1:${upstream.port}`], { cwd: ROOT, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ANTHROPIC_API_KEY: 'placeholder-anthropic' }, stdout: 'ignore', stderr: Bun.file(join(runDir, 'proxy.log')) });
let up = false;
for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${port}/__proxy/status`)).ok; } catch { await Bun.sleep(50); } }
if (!up) { console.error('HE-PROXY-003 fake: the metering proxy did not start'); process.exit(2); }
const perTrial = Number(process.env.FAKE_REQUESTS_PER_TRIAL ?? 2);
const hangAt = process.env.FAKE_HANG_AT === undefined ? -1 : Number(process.env.FAKE_HANG_AT);
const body = JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 1000, messages: [{ role: 'user', content: 'hello' }] });
let capStop = false;
let exit = 0;
for (const [i, t] of pending.entries()) {
  const slot = t.id.replace(/[^A-Za-z0-9._-]+/g, '-');
  await fetch(`http://127.0.0.1:${port}/__proxy/bind`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot, key: `trial-token:${t.id}` }) });
  const call = () => fetch(`http://127.0.0.1:${port}/${slot}/anthropic/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'container-dummy', 'anthropic-version': '2023-06-01' }, body }).then((r) => r.status);
  if (i === hangAt) { await call(); console.log(`trial ${t.id} starting`); await new Promise(() => {}); }
  let refused = 0;
  for (let k = 0; k < perTrial; k++) if ((await call()) !== 200) refused++;
  const task = t.task_dir.split('/').pop()!;
  const record = { trial_id: t.id, cell: t.cell, task, grade: refused || /^sd-0[3-6]/.test(task) ? 'fail' : 'pass', termination: refused ? 'model_error' : 'completed', cap_stop: refused > 0, usage: { usd: 0, refused }, wall_ms: 10 };
  appendFileSync(join(runDir, 'trials.jsonl'), JSON.stringify(record) + '\n');
  console.log(`trial ${t.id}: grade=${record.grade}${refused ? ' cap_stop' : ''}`);
  if (refused) { capStop = true; console.error(`HE-BUDGET-001 the metering proxy refused a call for trial ${t.id}: ... Recovery: raise the cap in the ledger (set-cap, with the owner's authorization)`); if (rest.includes('--stop-on-cap')) { exit = 3; break; } }
}
proxy.kill('SIGTERM');
await proxy.exited;
upstream.stop(true);
const all = readFileSync(join(runDir, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).length;
writeFileSync(join(runDir, 'run-summary.json'), JSON.stringify({ run_id: manifest.run_id, trials_recorded: all, trials_planned: manifest.trials.length, cap_stop: capStop, complete: all === manifest.trials.length && !capStop }) + '\n');
process.exit(exit);
