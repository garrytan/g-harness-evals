#!/usr/bin/env bun
// A stand-in for Harbor in tests/frontier-harbor-mirror.test.ts: one Harbor job of one cell and attempt, its trials one at a
// time the way Harbor 0.24.0 lays them out (<run>/jobs/<cell>__a<n>/<task>__<suffix>/config.json, agent/harness_settings.json,
// result.json last). Each trial binds its slot through the REAL broker, sends two tool-declaring requests at effort high
// through the REAL metering proxy, and is graded pass and fail in turn. After --finish trials it starts one more, binds,
// sends one request and hangs with no result.json, as a VM that dies mid-trial leaves it. Never holds a key.
//
//   bun tests/fixtures/frontier-harbor/fake-harbor.ts --run <run root> --broker <url> --cell <id> --attempt <n>
//       --tasks <a,b,...> --finish <n> [--model anthropic:claude-opus-5-5] [--harness claude-code]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const run = flag('--run')!;
const broker = flag('--broker')!;
const cell = flag('--cell')!;
const attempt = Number(flag('--attempt'));
const tasks = flag('--tasks')!.split(',');
const finish = Number(flag('--finish'));
const model = flag('--model') ?? 'anthropic:claude-opus-5-5';
const harness = flag('--harness') ?? 'claude-code';
const [provider, name] = model.split(':') as [string, string];

async function call(base: string, token: string) {
  const body = { model: name, max_tokens: 1000, stream: true, thinking: { type: 'adaptive' }, output_config: { effort: 'high' },
    tools: [{ name: 'bash', description: 'run a command', input_schema: { type: 'object', properties: { cmd: { type: 'string' } } } }], messages: [{ role: 'user', content: 'solve the task' }] };
  const r = await fetch(base + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': token, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
  await r.text();
  if (r.status !== 200) throw new Error('fake-harbor: the proxy answered ' + r.status);
}

for (const [i, task] of tasks.slice(0, finish + 1).entries()) {
  const trial = task + '__' + Math.random().toString(36).slice(2, 9);
  const dir = join(run, 'jobs', cell + '__a' + attempt, trial);
  mkdirSync(join(dir, 'agent'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ task: { path: join(run, 'tasks', task) }, agent: { model_name: provider + '/' + name, kwargs: { cell, attempt } } }));
  writeFileSync(join(dir, 'agent', 'harness_settings.json'), JSON.stringify({ effort: { requested: 'high' }, endpoint: { slot_models: [model] } }));
  const started_at = new Date().toISOString();
  const bind = await fetch(broker + '/bind', { method: 'POST', body: JSON.stringify({ trial, cell, attempt, harness, model, models: [model] }) });
  if (bind.status !== 200) throw new Error('fake-harbor: the broker answered ' + bind.status);
  const { token, base_url } = await bind.json() as { token: string; base_url: string };
  await call(base_url, token);
  if (i === finish) { console.log('fake-harbor: trial ' + (i + 1) + ' started and hangs'); await new Promise(() => {}); }
  await call(base_url, token);
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ started_at, finished_at: new Date().toISOString(), verifier_result: { rewards: { reward: i % 2 === 0 ? 1 : 0 } }, exception_info: null }));
  console.log('fake-harbor: trial ' + (i + 1) + ' finished');
  await Bun.sleep(300);
}
