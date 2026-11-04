// internal-task: the QM inner-harness configs and the runner's model assertion, keyless.
//   1. harnesses/qm/prepare.sh maps HE_HARNESS_CONFIG to the stack variables compose interpolates: the 5 s memory
//      capture quiet time reaches probe configs only, the held-out config keeps QM's shipped 180 s, and an unknown
//      value (the claude configs included, since QM b6786d67 has no Claude harness) exits 2 before anything starts.
//   2. harnesses/qm/compose.yaml hands those variables to the core and task services (the one plumbing path).
//   2b. prepare.sh refuses a core or sandbox image whose harness-eval.commit label is not pin.json's commit, or a
//      missing image (HE-RUN-006; a stand-in docker on PATH answers image inspect), and the QM Dockerfiles'
//      QM_COMMIT and QM_VERSION defaults equal pin.json.
//   3. foreignModels (runner/trial/trial.ts) names a model other than the cell's from by_model and from refused
//      usage lines that carry a model, and ignores route refusals with model null.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { foreignModels } from '../runner/trial/trial.ts';

const ROOT = resolve(import.meta.dir, '..');
const PREPARE = join(ROOT, 'harnesses/qm/prepare.sh');
const CONFIGS: Record<string, { QM_HARNESS: string; QM_MEMORY_CAPTURE_QUIET_MS: string; QM_PROBE_CONFIG: string }> = {
  '': { QM_HARNESS: 'pi', QM_MEMORY_CAPTURE_QUIET_MS: '180000', QM_PROBE_CONFIG: '' },
  pi: { QM_HARNESS: 'pi', QM_MEMORY_CAPTURE_QUIET_MS: '180000', QM_PROBE_CONFIG: '' },
  'pi-probe': { QM_HARNESS: 'pi', QM_MEMORY_CAPTURE_QUIET_MS: '5000', QM_PROBE_CONFIG: '' },
  'pi-strict': { QM_HARNESS: 'pi', QM_MEMORY_CAPTURE_QUIET_MS: '5000', QM_PROBE_CONFIG: 'pi-strict' },
  'pi-command-deny': { QM_HARNESS: 'pi', QM_MEMORY_CAPTURE_QUIET_MS: '5000', QM_PROBE_CONFIG: 'pi-command-deny' },
};

const PIN_COMMIT: string = JSON.parse(readFileSync(join(ROOT, 'harnesses/qm/pin.json'), 'utf8')).commit;

// A stand-in docker on PATH: `image inspect` prints FAKE_QM_LABEL_<core|sandbox> (unset: no such image).
const FAKE_DOCKER = mkdtempSync(join(tmpdir(), 'he-qm-docker-'));
writeFileSync(join(FAKE_DOCKER, 'docker'), [
  '#!/usr/bin/env bash',
  '[ -n "${FAKE_DOCKER_LOG:-}" ] && echo "$*" >> "$FAKE_DOCKER_LOG"',
  'img=${@: -1}',
  'case "$img" in *qm-sandbox*) v=${FAKE_QM_LABEL_sandbox-__none__} ;; *) v=${FAKE_QM_LABEL_core-__none__} ;; esac',
  '[ "$v" = __none__ ] && { echo "Error: No such image: $img" >&2; exit 1; }',
  'printf "%s\\n" "$v"',
  '',
].join('\n'));
chmodSync(join(FAKE_DOCKER, 'docker'), 0o755);

function prepare(config: string | undefined, labels: { core?: string; sandbox?: string } = { core: PIN_COMMIT, sandbox: PIN_COMMIT }, script = PREPARE) {
  const env: Record<string, string> = { PATH: `${FAKE_DOCKER}:${process.env.PATH}`, HOME: mkdtempSync(join(tmpdir(), 'he-qm-home-')), QM_SIGNING_SECRET: 'test-signing', QM_CONNECTOR_SECRET_KEY: 'test-connector' };
  if (labels.core !== undefined) env.FAKE_QM_LABEL_core = labels.core;
  if (labels.sandbox !== undefined) env.FAKE_QM_LABEL_sandbox = labels.sandbox;
  if (config !== undefined) env.HE_HARNESS_CONFIG = config;
  const r = spawnSync('bash', [script, mkdtempSync(join(tmpdir(), 'he-qm-prepare-'))], { encoding: 'utf8', env });
  const vars: Record<string, string> = {};
  for (const line of r.stdout.split('\n')) { const eq = line.indexOf('='); if (eq > 0) vars[line.slice(0, eq)] = line.slice(eq + 1); }
  return { status: r.status, stderr: r.stderr, vars };
}

// The image check runs before prepare.sh reads the socket, so it needs no daemon.
describe('harnesses/qm/prepare.sh refuses images that are not the pinned build (HE-RUN-006)', () => {
  test('a core or sandbox image that is not a build of the pinned commit, or is missing, stops the trial before the stack', () => {
    const stale = '7417aa2a3f917cf97406914897078ae3b273e173';
    for (const [labels, want] of [
      [{ core: stale, sandbox: PIN_COMMIT }, `image harness-eval/qm:dev is QM ${stale}, not the pinned ${PIN_COMMIT}`],
      [{ core: PIN_COMMIT, sandbox: stale }, `image harness-eval/qm-sandbox:dev is QM ${stale}, not the pinned ${PIN_COMMIT}`],
      [{ core: '', sandbox: PIN_COMMIT }, 'image harness-eval/qm:dev is QM <no harness-eval.commit label>'],
      [{ core: PIN_COMMIT }, 'image harness-eval/qm-sandbox:dev is missing'],
    ] as const) {
      const r = prepare('pi', labels);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(want);
      expect(Object.keys(r.vars)).toEqual([]);
    }
  });

  test('harnesses/run-trial.sh stops at the refusal and never starts the stack', () => {
    const log = join(mkdtempSync(join(tmpdir(), 'he-qm-rt-')), 'docker.log');
    const out = mkdtempSync(join(tmpdir(), 'he-qm-rt-out-'));
    const env = { PATH: `${FAKE_DOCKER}:${process.env.PATH}`, HOME: mkdtempSync(join(tmpdir(), 'he-qm-home-')), FAKE_DOCKER_LOG: log, FAKE_QM_LABEL_core: '7417aa2a3f917cf97406914897078ae3b273e173', FAKE_QM_LABEL_sandbox: PIN_COMMIT, QM_SIGNING_SECRET: 'test-signing', QM_CONNECTOR_SECRET_KEY: 'test-connector' };
    const r = spawnSync('bash', [join(ROOT, 'harnesses/run-trial.sh'), '--harness', 'qm', '--task', 'tasks/hello', '--trial-id', 'qm-stale-image', '--base-url', 'http://127.0.0.1:9', '--api-key', 'dummy', '--out', out], { cwd: ROOT, encoding: 'utf8', env });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('harnesses/qm/prepare.sh refused (exit 2)');
    expect(r.stderr).toContain('not the pinned');
    expect(readFileSync(log, 'utf8')).not.toContain('compose');
  });

  test('a pin.json with no 40-hex commit refuses every trial; a reformatted one still reads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-qm-pin-'));
    copyFileSync(PREPARE, join(dir, 'prepare.sh'));
    const pin = JSON.parse(readFileSync(join(ROOT, 'harnesses/qm/pin.json'), 'utf8'));
    writeFileSync(join(dir, 'pin.json'), JSON.stringify({ ...pin, commit: 'v0.1.15' }));
    const bad = prepare('pi', undefined, join(dir, 'prepare.sh'));
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('no commit in pin.json');
    const { commit, ...rest } = pin;
    writeFileSync(join(dir, 'pin.json'), JSON.stringify({ ...rest, commit }));
    const minified = prepare('pi', { core: PIN_COMMIT, sandbox: 'stale' }, join(dir, 'prepare.sh'));
    expect(minified.stderr).toContain(`not the pinned ${PIN_COMMIT}`);
  });
});

// prepare.sh reads the Docker socket's group for the core service; without a daemon there is nothing to map.
const haveSocket = existsSync('/var/run/docker.sock');

describe.if(haveSocket)('harnesses/qm/prepare.sh maps HE_HARNESS_CONFIG', () => {
  for (const [config, want] of Object.entries(CONFIGS)) {
    test(`${config || '(unset)'} -> ${want.QM_HARNESS}, quiet ${want.QM_MEMORY_CAPTURE_QUIET_MS} ms${want.QM_PROBE_CONFIG ? ', probe ' + want.QM_PROBE_CONFIG : ''}`, () => {
      const r = prepare(config || undefined);
      expect(r.status).toBe(0);
      expect(r.vars).toMatchObject({ ...want, HE_HARNESS_CONFIG: config || 'pi', QM_SIGNING_SECRET: 'test-signing', QM_CONNECTOR_SECRET_KEY: 'test-connector' });
    });
  }

  test('the 5 s quiet time reaches probe configs only', () => {
    const probe = Object.entries(CONFIGS).filter(([, v]) => v.QM_MEMORY_CAPTURE_QUIET_MS === '5000').map(([k]) => k).sort();
    expect(probe).toEqual(['pi-command-deny', 'pi-probe', 'pi-strict']);
    expect(prepare('pi').vars.QM_MEMORY_CAPTURE_QUIET_MS).toBe('180000');
  });

  test('an unknown config exits 2 naming the accepted values and prints no variables', () => {
    const r = prepare('codex');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('HE_HARNESS_CONFIG=codex is not a QM config');
    for (const name of ['pi', 'pi-probe', 'pi-strict', 'pi-command-deny']) expect(r.stderr).toContain(name);
    expect(Object.keys(r.vars)).toEqual([]);
  });

  test('the Claude configs QM removed at b6786d67 (yc-software/qm#2768) are refused like any unknown config', () => {
    for (const gone of ['claude', 'claude-probe']) {
      const r = prepare(gone);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`HE_HARNESS_CONFIG=${gone} is not a QM config`);
      expect(Object.keys(r.vars)).toEqual([]);
    }
  });
});

describe('harnesses/qm/compose.yaml carries the prepared variables', () => {
  const compose = readFileSync(join(ROOT, 'harnesses/qm/compose.yaml'), 'utf8');
  const core = compose.slice(compose.indexOf('\n  core:'), compose.indexOf('\n  task:'));
  const task = compose.slice(compose.indexOf('\n  task:'));

  test('core reads PI_MODEL and MEMORY_CAPTURE_QUIET_MS with the shipped defaults, and no HARNESS or CLAUDE_MODEL (gone at b6786d67)', () => {
    expect(core).toContain('MEMORY_CAPTURE_QUIET_MS: ${QM_MEMORY_CAPTURE_QUIET_MS:-180000}');
    expect(core).toContain('PI_MODEL: ${QM_PI_MODEL:-${HE_MODEL_NAME:-claude-sonnet-5-5}}');
    expect(core).not.toMatch(/^\s+HARNESS:/m);
    expect(core).not.toMatch(/CLAUDE_MODEL:/);
    expect(readFileSync(join(ROOT, 'harnesses/qm/config/core.env'), 'utf8')).not.toMatch(/^(HARNESS|CLAUDE_MODEL)=/m);
  });

  test('the task service sees QM_HARNESS, QM_PROBE_CONFIG and HE_HARNESS_CONFIG, each once', () => {
    for (const line of ['QM_HARNESS: ${QM_HARNESS:-pi}', 'QM_PROBE_CONFIG: ${QM_PROBE_CONFIG:-}', 'HE_HARNESS_CONFIG: ${HE_HARNESS_CONFIG:-}']) {
      expect(task.split(line).length - 1).toBe(1);
    }
    for (const name of ['HE_MODEL_BASE_URL', 'HE_MODEL_API_KEY', 'HE_MODEL_NAME']) expect(task.match(new RegExp(`^\\s+${name}:`, 'gm'))?.length).toBe(1);
  });
});

describe('harnesses/qm images build the commit pin.json records', () => {
  const pin = JSON.parse(readFileSync(join(ROOT, 'harnesses/qm/pin.json'), 'utf8'));

  test('every QM_COMMIT and QM_VERSION default in both Dockerfiles equals pin.json, and no QM_TAG is left', () => {
    for (const file of ['Dockerfile', 'Dockerfile.sandbox']) {
      const docker = readFileSync(join(ROOT, 'harnesses/qm', file), 'utf8');
      const commits = [...docker.matchAll(/^ARG QM_COMMIT=(\S+)$/gm)].map((m) => m[1]);
      const versions = [...docker.matchAll(/^ARG QM_VERSION=(\S+)$/gm)].map((m) => m[1]);
      expect(commits.length).toBeGreaterThan(0);
      expect(versions.length).toBeGreaterThan(0);
      for (const c of commits) expect(c).toBe(pin.commit);
      for (const v of versions) expect(v).toBe(pin.version);
      expect(docker).not.toContain('QM_TAG');
    }
  });
});

describe('foreignModels (HE-MODEL-001)', () => {
  const cell = 'anthropic:claude-haiku-5-5';
  const line = (over: Partial<{ outcome: string; model: string | null; provider: string }>) => ({ outcome: 'forwarded', model: 'claude-haiku-5-5', provider: 'anthropic', ...over });

  test('a trial on the cell\'s model alone, with route refusals carrying no model, names nothing', () => {
    const lines = [line({}), line({ outcome: 'refused', model: null }), line({ outcome: 'refused', model: null })];
    expect(foreignModels(cell, { [cell]: { usd: 0.01, requests: 3 } }, lines)).toEqual([]);
  });

  test('a forwarded request on another model is named', () => {
    expect(foreignModels(cell, { [cell]: { usd: 0.01, requests: 3 }, 'anthropic:claude-sonnet-5-5': { usd: 0.2, requests: 1 } }, [])).toEqual(['anthropic:claude-sonnet-5-5']);
  });

  test('an allowlist refusal that carries another model is named even when nothing was forwarded on it', () => {
    const lines = [line({}), line({ outcome: 'refused', model: 'claude-sonnet-5-5' })];
    expect(foreignModels(cell, { [cell]: { usd: 0.01, requests: 1 } }, lines)).toEqual(['anthropic:claude-sonnet-5-5']);
  });

  test('the cell\'s declared embedding model is its own (internal-task amendment 1); without a declaration it is foreign', () => {
    const byModel = { [cell]: { usd: 0.01, requests: 3 }, 'openai:text-embedding-3-small': { usd: 0.0000004, requests: 2 } };
    expect(foreignModels(cell, byModel, [], 'openai:text-embedding-3-small')).toEqual([]);
    expect(foreignModels(cell, byModel, [line({ outcome: 'refused', model: 'text-embedding-3-small', provider: 'openai' })], 'openai:text-embedding-3-small')).toEqual([]);
    expect(foreignModels(cell, byModel, [], 'off')).toEqual(['openai:text-embedding-3-small']);
    expect(foreignModels(cell, byModel, [])).toEqual(['openai:text-embedding-3-small']);
  });

  test('QM\'s Haiku auxiliary requests are the cell\'s model on a Haiku cell and another model on a Sonnet cell', () => {
    const aux = [line({ outcome: 'refused', model: 'claude-haiku-5-5' })];
    expect(foreignModels(cell, {}, aux)).toEqual([]);
    expect(foreignModels('anthropic:claude-sonnet-5-5', { 'anthropic:claude-sonnet-5-5': { usd: 0.1, requests: 2 } }, aux)).toEqual(['anthropic:claude-haiku-5-5']);
  });

  test('a preregistered utility model is the cell\'s own, refused or forwarded; any other model stays foreign (internal-task, v02-heldout amendment 2)', () => {
    const sonnet = 'anthropic:claude-sonnet-5-5';
    const aux = [line({ outcome: 'refused', model: 'claude-haiku-5-5' })];
    expect(foreignModels(sonnet, { [sonnet]: { usd: 0.1, requests: 2 } }, aux, 'off', ['anthropic:claude-haiku-5-5'])).toEqual([]);
    expect(foreignModels(sonnet, { [sonnet]: { usd: 0.1, requests: 2 }, 'anthropic:claude-haiku-5-5': { usd: 0.001, requests: 3 } }, [], 'off', ['anthropic:claude-haiku-5-5'])).toEqual([]);
    expect(foreignModels(sonnet, { [sonnet]: { usd: 0.1, requests: 2 }, 'anthropic:claude-opus-5-5': { usd: 0.3, requests: 1 } }, [], 'off', ['anthropic:claude-haiku-5-5'])).toEqual(['anthropic:claude-opus-5-5']);
  });

  test('model names compare case-insensitively and each foreign model is listed once', () => {
    const lines = [line({ outcome: 'refused', model: 'Claude-Sonnet-5-5' }), line({ outcome: 'refused', model: 'claude-sonnet-5-5' })];
    expect(foreignModels('Anthropic:Claude-Haiku-5-5', { 'anthropic:claude-haiku-5-5': { usd: 0, requests: 1 } }, lines)).toEqual(['anthropic:Claude-Sonnet-5-5', 'anthropic:claude-sonnet-5-5']);
  });
});
