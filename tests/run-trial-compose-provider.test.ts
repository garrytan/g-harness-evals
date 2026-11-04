// harnesses/run-trial.sh on a compose harness loads compose.<provider>.yaml beside compose.yaml when the proxy route's last
// segment names one, the way runner/trial/docker.ts merges it (QM: compose.openai.yaml for an openai cell such as GPT-6.1
// Sol). Keyless and daemon-free: a stand-in docker on PATH answers prepare.sh's image check with the pinned label, records
// run-trial.sh's up, logs and down commands and, when the docker CLI is installed, renders the stack with "docker compose config" twice: with
// the files run-trial.sh chose, and with compose.yaml alone, so an Anthropic cell can be compared byte for byte with the
// stack before this change.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const PIN = JSON.parse(readFileSync(join(ROOT, 'harnesses/qm/pin.json'), 'utf8')).commit as string;
const REAL_DOCKER = spawnSync('bash', ['-c', 'command -v docker'], { encoding: 'utf8' }).stdout.trim();
const CAN_RENDER = !!REAL_DOCKER && spawnSync(REAL_DOCKER, ['compose', 'version'], { encoding: 'utf8' }).status === 0;
const TOKEN = 'trial-token:t-rt.' + '0'.repeat(32);

const BIN = mkdtempSync(join(tmpdir(), 'he-rt-docker-'));
writeFileSync(join(BIN, 'docker'), [
  '#!/usr/bin/env bash',
  'echo "$*" >> "$FAKE_DOCKER_LOG"',
  'if [ "$1 $2" = "image inspect" ]; then printf "%s\\n" "$FAKE_QM_LABEL"; exit 0; fi',
  '[ "$1" = compose ] || exit 0',
  'args=("$@"); up=""; project=""',
  'for i in "${!args[@]}"; do [ "${args[$i]}" = up ] && up=$i; [ "${args[$i]}" = -p ] && project=${args[$((i+1))]}; done',
  'if [ -n "$up" ] && [ -n "$REAL_DOCKER" ]; then',
  '  "$REAL_DOCKER" "${args[@]:0:$up}" config --format json > "$FAKE_RENDER" 2>> "$FAKE_RENDER.err"',
  '  "$REAL_DOCKER" compose -f "${args[2]}" -p "$project" config --format json > "$FAKE_RENDER.base" 2>> "$FAKE_RENDER.err"',
  'fi',
  'exit 0',
  '',
].join('\n'));
chmodSync(join(BIN, 'docker'), 0o755);

type Rendered = { services: Record<string, { environment: Record<string, string | null> }> };

function runTrial(provider: 'anthropic' | 'openai', model: string) {
  const work = mkdtempSync(join(tmpdir(), 'he-rt-'));
  const task = join(work, 'task');
  mkdirSync(join(task, 'grader'), { recursive: true });
  writeFileSync(join(task, 'instruction.md'), 'Say hello.\n');
  writeFileSync(join(task, 'task.toml'), 'slice = "smoke"\ntime_budget_s = 5\n');
  writeFileSync(join(task, 'grader', 'check.sh'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(join(task, 'grader', 'check.sh'), 0o755);
  const log = join(work, 'docker.log'), render = join(work, 'render.json');
  const baseUrl = 'http://host.docker.internal:39001/t-rt/' + provider;
  const env = {
    PATH: BIN + ':' + process.env.PATH, HOME: work, FAKE_DOCKER_LOG: log, FAKE_RENDER: render, FAKE_QM_LABEL: PIN, REAL_DOCKER: CAN_RENDER ? REAL_DOCKER : '',
    QM_SIGNING_SECRET: 'test-signing', QM_CONNECTOR_SECRET_KEY: 'test-connector',
  };
  const r = spawnSync('bash', ['harnesses/run-trial.sh', '--harness', 'qm', '--task', task, '--trial-id', 't-rt', '--base-url', baseUrl, '--api-key', TOKEN, '--model', model, '--out', join(work, 'out')], { cwd: ROOT, encoding: 'utf8', env });
  const compose = readFileSync(log, 'utf8').split('\n').filter((l) => / -p he-t-rt (up|logs|down) /.test(l));
  const read = (p: string) => (CAN_RENDER && existsSync(p) ? readFileSync(p, 'utf8') : '');
  return { status: r.status, stderr: r.stderr, compose, baseUrl, text: read(render), base: read(render + '.base') };
}

describe('harnesses/run-trial.sh merges compose.<provider>.yaml like the runner', () => {
  test('an Opus cell loads compose.yaml alone and renders byte for byte as before', () => {
    const opus = runTrial('anthropic', 'claude-opus-5-5');
    expect(opus.status).toBe(0);
    expect(opus.compose.length).toBe(3);
    for (const line of opus.compose) expect(line).toStartWith('compose -f harnesses/qm/compose.yaml -p he-t-rt ');
    if (!CAN_RENDER) return;
    expect(opus.text.length).toBeGreaterThan(0);
    expect(opus.text).toBe(opus.base);
    const core = (JSON.parse(opus.text) as Rendered).services.core!.environment;
    expect([core.ANTHROPIC_BASE_URL, core.PI_MODEL, core.OPENAI_BASE_URL ?? null]).toEqual([opus.baseUrl, 'claude-opus-5-5', null]);
  });

  test('a Sol cell also loads compose.openai.yaml on up, logs and down, and core gets the OpenAI wiring', () => {
    const sol = runTrial('openai', 'gpt-6.1-sol');
    expect(sol.status).toBe(0);
    expect(sol.compose.length).toBe(3);
    for (const line of sol.compose) expect(line).toStartWith('compose -f harnesses/qm/compose.yaml -f harnesses/qm/compose.openai.yaml -p he-t-rt ');
    if (!CAN_RENDER) return;
    const rendered = JSON.parse(sol.text) as Rendered, before = JSON.parse(sol.base) as Rendered;
    const core = rendered.services.core!.environment;
    expect(core).toMatchObject({ OPENAI_BASE_URL: sol.baseUrl + '/v1', OPENAI_API_KEY: TOKEN, MODEL_PROVIDER: 'openai', ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: '', PI_MODEL: 'gpt-6.1-sol' });
    expect(rendered.services.task).toEqual(before.services.task);
    expect(rendered.services.pg).toEqual(before.services.pg);
  });

  test('the clean-arm preflight still finds exactly the three trial binds in the docker run block', () => {
    const script = readFileSync(join(ROOT, 'harnesses/run-trial.sh'), 'utf8');
    const block = script.slice(script.indexOf('docker run -i --rm --name'), script.indexOf('"$image" run') + 12);
    expect([...block.matchAll(/-v "([^"]+)"/g)].map((m) => m[1])).toEqual(['$abs_out/workspace:/workspace', '$abs_out/state:/harness-state', '$abs_out/logs:/he-logs']);
    expect(script).not.toContain('.capy');
  });
});
