// QM on an OpenAI cell model (GPT-6.1 Sol), keyless. The runner starts QM's compose stack with the cell model's provider;
// for openai it merges harnesses/qm/compose.openai.yaml over compose.yaml, so QM core gets OPENAI_BASE_URL (the metering
// proxy's /openai route plus /v1), OPENAI_API_KEY (the per-trial dummy token) and MODEL_PROVIDER openai. An Anthropic cell
// loads no extra file and renders exactly as a start without a provider does. A stand-in docker on PATH records each
// compose command and, when the docker CLI is installed, renders the stack with "docker compose config" (no daemon call).
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startComposeHarness } from '../runner/trial/docker.ts';
import { makeTrialDirs } from '../runner/trial/harness.ts';
import { trialToken } from '../runner/trial/proxy.ts';

const ROOT = resolve(import.meta.dir, '..');
const COMPOSE = join(ROOT, 'harnesses/qm/compose.yaml');
const OPENAI_FILE = join(ROOT, 'harnesses/qm/compose.openai.yaml');
const REAL_DOCKER = spawnSync('bash', ['-c', 'command -v docker'], { encoding: 'utf8' }).stdout.trim();
const CAN_RENDER = !!REAL_DOCKER && spawnSync(REAL_DOCKER, ['compose', 'version'], { encoding: 'utf8' }).status === 0;

const BIN = mkdtempSync(join(tmpdir(), 'he-qm-openai-docker-'));
writeFileSync(join(BIN, 'docker'), [
  '#!/usr/bin/env bash',
  '[ "$1" = compose ] || exit 0',
  'echo "$*" >> "$FAKE_DOCKER_LOG"',
  'if [ "${@: -3:1}" = up ] && [ -n "$REAL_DOCKER" ]; then "$REAL_DOCKER" "${@:1:$#-3}" config --format json > "$FAKE_RENDER" 2>> "$FAKE_RENDER.err"; fi',
  'exit 0',
  '',
].join('\n'));
chmodSync(join(BIN, 'docker'), 0o755);

type Rendered = { services: Record<string, { environment: Record<string, string | null> }> };

async function start(model: string, provider: string | undefined): Promise<{ up: string; rendered: Rendered | null; text: string; token: string; baseUrl: string }> {
  const work = mkdtempSync(join(tmpdir(), 'he-qm-openai-'));
  const dirs = makeTrialDirs(join(work, 'trial'));
  const log = join(work, 'docker.log');
  const render = join(work, 'render.json');
  const token = trialToken('t-qm');
  const baseUrl = `http://host.docker.internal:39001/t-qm/${provider ?? 'anthropic'}`;
  const saved = { PATH: process.env.PATH, FAKE_DOCKER_LOG: process.env.FAKE_DOCKER_LOG, FAKE_RENDER: process.env.FAKE_RENDER, REAL_DOCKER: process.env.REAL_DOCKER };
  Object.assign(process.env, { PATH: `${BIN}:${process.env.PATH}`, FAKE_DOCKER_LOG: log, FAKE_RENDER: render, REAL_DOCKER: CAN_RENDER ? REAL_DOCKER : '' });
  try {
    await startComposeHarness({
      harness: 'qm', image: 'harness-eval/qm:dev', trialSlug: 't-qm', dirs, env: { HE_TRIAL_ID: 't-qm' }, composeFile: COMPOSE, timeBudgetS: 60,
      repoRoot: work, stackEnv: { HE_MODEL_BASE_URL: baseUrl, HE_MODEL_API_KEY: token, HE_MODEL_NAME: model, HE_TIME_BUDGET_S: '60', HE_TASK_SLICE: 'multiuser', HE_TRIAL_ID: 't-qm' },
      ...(provider ? { modelProvider: provider } : {}),
    });
    const up = readFileSync(log, 'utf8').split('\n').find((l) => l.includes(' up '))!;
    const text = CAN_RENDER ? readFileSync(render, 'utf8') : '';
    return { up: up.split(work).join('<work>'), rendered: text ? JSON.parse(text) as Rendered : null, text: text.split(work).join('<work>').split(token).join('<token>'), token, baseUrl };
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(work, { recursive: true, force: true });
  }
}

describe('QM cells on GPT-6.1 Sol reach OpenAI through the metering proxy', () => {
  test('compose.openai.yaml interpolates only HE_MODEL_*, never a real key variable', () => {
    const text = readFileSync(OPENAI_FILE, 'utf8');
    expect(text).toContain('OPENAI_API_KEY: ${HE_MODEL_API_KEY}');
    expect(text).toContain('OPENAI_BASE_URL: ${HE_MODEL_BASE_URL}/v1');
    expect([...text.matchAll(/\$\{([A-Z_]+)/g)].map((m) => m[1]).sort()).toEqual(['HE_MODEL_API_KEY', 'HE_MODEL_BASE_URL']);
  });

  test('a Sol cell merges compose.openai.yaml, and core gets the proxy route plus /v1 and the dummy token', async () => {
    const sol = await start('gpt-6.1-sol', 'openai');
    expect(sol.up).toContain(`-f ${COMPOSE} -f ${OPENAI_FILE} -f `);
    if (!sol.rendered) return;
    const core = sol.rendered.services.core!.environment;
    expect(core.OPENAI_BASE_URL).toBe(`${sol.baseUrl}/v1`);
    expect(core.OPENAI_BASE_URL).toBe('http://host.docker.internal:39001/t-qm/openai/v1');
    expect(core.OPENAI_API_KEY).toBe(sol.token);
    expect(core.OPENAI_API_KEY).toMatch(/^trial-token:t-qm\.[0-9a-f]{32}$/);
    expect(core.MODEL_PROVIDER).toBe('openai');
    expect(core.PI_MODEL).toBe('gpt-6.1-sol');
    expect(core.ANTHROPIC_API_KEY).toBe('');
    expect(core.ANTHROPIC_BASE_URL).toBe('');
  });

  test('an Opus cell loads no extra file and renders exactly as a start without a provider', async () => {
    const opus = await start('claude-opus-5-5', 'anthropic');
    const plain = await start('claude-opus-5-5', undefined);
    expect(opus.up).not.toContain('compose.openai.yaml');
    expect(opus.up).toBe(plain.up);
    if (!opus.rendered || !plain.rendered) return;
    const core = opus.rendered.services.core!.environment;
    expect(core.ANTHROPIC_API_KEY).toBe(opus.token);
    expect(core.ANTHROPIC_BASE_URL).toBe('http://host.docker.internal:39001/t-qm/anthropic');
    expect(core.PI_MODEL).toBe('claude-opus-5-5');
    expect(core.MODEL_PROVIDER).toBe('anthropic');
    expect(Object.keys(core).filter((k) => k.startsWith('OPENAI_'))).toEqual([]);
    expect(opus.text).toBe(plain.text);
  });

  test('no compose.anthropic.yaml exists, so the Anthropic path has no provider file to load', () => {
    expect(existsSync(join(ROOT, 'harnesses/qm/compose.anthropic.yaml'))).toBe(false);
  });
});
