// internal-task: the QM inner-harness configs and the runner's model assertion, keyless.
//   1. harnesses/qm/prepare.sh maps HE_HARNESS_CONFIG to the stack variables compose interpolates: the 5 s memory
//      capture quiet time reaches probe configs only, the held-out configs keep QM's shipped 180 s, and an unknown
//      value exits 2 before anything starts.
//   2. harnesses/qm/compose.yaml hands those variables to the core and task services (the one plumbing path).
//   3. foreignModels (runner/trial/trial.ts) names a model other than the cell's from by_model and from refused
//      usage lines that carry a model, and ignores route refusals with model null.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { foreignModels } from '../runner/trial/trial.ts';

const ROOT = resolve(import.meta.dir, '..');
const PREPARE = join(ROOT, 'harnesses/qm/prepare.sh');
const CONFIGS: Record<string, { QM_HARNESS: string; QM_MEMORY_CAPTURE_QUIET_MS: string; QM_PROBE_CONFIG: string }> = {
  '': { QM_HARNESS: 'pi', QM_MEMORY_CAPTURE_QUIET_MS: '180000', QM_PROBE_CONFIG: '' },
  pi: { QM_HARNESS: 'pi', QM_MEMORY_CAPTURE_QUIET_MS: '180000', QM_PROBE_CONFIG: '' },
  claude: { QM_HARNESS: 'claude', QM_MEMORY_CAPTURE_QUIET_MS: '180000', QM_PROBE_CONFIG: '' },
  'pi-probe': { QM_HARNESS: 'pi', QM_MEMORY_CAPTURE_QUIET_MS: '5000', QM_PROBE_CONFIG: '' },
  'claude-probe': { QM_HARNESS: 'claude', QM_MEMORY_CAPTURE_QUIET_MS: '5000', QM_PROBE_CONFIG: '' },
  'pi-strict': { QM_HARNESS: 'pi', QM_MEMORY_CAPTURE_QUIET_MS: '5000', QM_PROBE_CONFIG: 'pi-strict' },
  'pi-command-deny': { QM_HARNESS: 'pi', QM_MEMORY_CAPTURE_QUIET_MS: '5000', QM_PROBE_CONFIG: 'pi-command-deny' },
};

function prepare(config: string | undefined) {
  const env: Record<string, string> = { ...process.env as Record<string, string>, QM_SIGNING_SECRET: 'test-signing', QM_CONNECTOR_SECRET_KEY: 'test-connector' };
  delete env.HE_HARNESS_CONFIG;
  if (config !== undefined) env.HE_HARNESS_CONFIG = config;
  const r = spawnSync('bash', [PREPARE, mkdtempSync(join(tmpdir(), 'he-qm-prepare-'))], { encoding: 'utf8', env });
  const vars: Record<string, string> = {};
  for (const line of r.stdout.split('\n')) { const eq = line.indexOf('='); if (eq > 0) vars[line.slice(0, eq)] = line.slice(eq + 1); }
  return { status: r.status, stderr: r.stderr, vars };
}

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
    expect(probe).toEqual(['claude-probe', 'pi-command-deny', 'pi-probe', 'pi-strict']);
    for (const held of ['pi', 'claude']) expect(prepare(held).vars.QM_MEMORY_CAPTURE_QUIET_MS).toBe('180000');
  });

  test('an unknown config exits 2 naming the accepted values and prints no variables', () => {
    const r = prepare('codex');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('HE_HARNESS_CONFIG=codex is not a QM config');
    for (const name of ['pi', 'claude', 'pi-probe', 'claude-probe', 'pi-strict', 'pi-command-deny']) expect(r.stderr).toContain(name);
    expect(Object.keys(r.vars)).toEqual([]);
  });
});

describe('harnesses/qm/compose.yaml carries the prepared variables', () => {
  const compose = readFileSync(join(ROOT, 'harnesses/qm/compose.yaml'), 'utf8');
  const core = compose.slice(compose.indexOf('\n  core:'), compose.indexOf('\n  task:'));
  const task = compose.slice(compose.indexOf('\n  task:'));

  test('core reads HARNESS, CLAUDE_MODEL, PI_MODEL and MEMORY_CAPTURE_QUIET_MS with the shipped defaults', () => {
    expect(core).toContain('HARNESS: ${QM_HARNESS:-pi}');
    expect(core).toContain('MEMORY_CAPTURE_QUIET_MS: ${QM_MEMORY_CAPTURE_QUIET_MS:-180000}');
    expect(core).toMatch(/CLAUDE_MODEL: \$\{HE_MODEL_NAME/);
    expect(core).toMatch(/PI_MODEL: \$\{HE_MODEL_NAME/);
  });

  test('the task service sees QM_HARNESS, QM_PROBE_CONFIG and HE_HARNESS_CONFIG, each once', () => {
    for (const line of ['QM_HARNESS: ${QM_HARNESS:-pi}', 'QM_PROBE_CONFIG: ${QM_PROBE_CONFIG:-}', 'HE_HARNESS_CONFIG: ${HE_HARNESS_CONFIG:-}']) {
      expect(task.split(line).length - 1).toBe(1);
    }
    for (const name of ['HE_MODEL_BASE_URL', 'HE_MODEL_API_KEY', 'HE_MODEL_NAME']) expect(task.match(new RegExp(`^\\s+${name}:`, 'gm'))?.length).toBe(1);
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

  test('model names compare case-insensitively and each foreign model is listed once', () => {
    const lines = [line({ outcome: 'refused', model: 'Claude-Sonnet-5-5' }), line({ outcome: 'refused', model: 'claude-sonnet-5-5' })];
    expect(foreignModels('Anthropic:Claude-Haiku-5-5', { 'anthropic:claude-haiku-5-5': { usd: 0, requests: 1 } }, lines)).toEqual(['anthropic:Claude-Sonnet-5-5', 'anthropic:claude-sonnet-5-5']);
  });
});
