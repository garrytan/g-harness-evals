// internal-task QM skill-resolver arm configs in harnesses/qm/prepare.sh, keyless (a stand-in docker on PATH, no daemon).
// The four pi-skills-* configs map to the shipped pi settings, check the images' harness-eval.skill-arm label, and only
// pi-skills-pull prints a line the other configs do not (QM_SANDBOX_IMAGE). The existing configs make exactly the
// docker calls and print exactly the lines they did before, so their cells are unchanged.
import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dir, '..');
const PREPARE = join(ROOT, 'harnesses/qm/prepare.sh');
const PIN: string = JSON.parse(readFileSync(join(ROOT, 'harnesses/qm/pin.json'), 'utf8')).commit;
const haveSocket = existsSync('/var/run/docker.sock');

// image inspect: the commit label for any image; the skill-arm label from FAKE_ARM_<core|sandbox> (unset: no label).
const BIN = mkdtempSync(join(tmpdir(), 'he-qm-arm-docker-'));
writeFileSync(join(BIN, 'docker'), [
  '#!/usr/bin/env bash',
  'echo "$*" >> "$FAKE_DOCKER_LOG"',
  'img=${@: -1}',
  'case "$*" in',
  '  *skill-arm*) case "$img" in *qm-sandbox*) v=${FAKE_ARM_sandbox-"<no value>"} ;; *) v=${FAKE_ARM_core-"<no value>"} ;; esac ;;',
  '  *) v=' + PIN + ' ;;',
  'esac',
  'printf "%s\\n" "$v"',
  '',
].join('\n'));
chmodSync(join(BIN, 'docker'), 0o755);

function prepare(config: string | undefined, o: { core?: string; sandbox?: string; arms?: { core?: string; sandbox?: string } } = {}) {
  const log = join(mkdtempSync(join(tmpdir(), 'he-qm-arm-log-')), 'docker.log');
  writeFileSync(log, '');
  const env: Record<string, string> = { PATH: BIN + ':' + process.env.PATH, HOME: mkdtempSync(join(tmpdir(), 'he-qm-arm-home-')), FAKE_DOCKER_LOG: log, QM_SIGNING_SECRET: 's', QM_CONNECTOR_SECRET_KEY: 'k' };
  if (config !== undefined) env.HE_HARNESS_CONFIG = config;
  if (o.core) env.QM_IMAGE = o.core;
  if (o.sandbox) env.QM_SANDBOX_IMAGE = o.sandbox;
  if (o.arms?.core !== undefined) env.FAKE_ARM_core = o.arms.core;
  if (o.arms?.sandbox !== undefined) env.FAKE_ARM_sandbox = o.arms.sandbox;
  const r = spawnSync('bash', [PREPARE, mkdtempSync(join(tmpdir(), 'he-qm-arm-out-'))], { encoding: 'utf8', env });
  const lines = r.stdout.split('\n').filter((l) => l.includes('='));
  return { status: r.status, stderr: r.stderr, keys: lines.map((l) => l.slice(0, l.indexOf('='))), vars: Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])), docker: readFileSync(log, 'utf8').trim().split('\n') };
}

const BEFORE_KEYS = ['QM_SIGNING_SECRET', 'QM_CONNECTOR_SECRET_KEY', 'QM_DOCKER_GID', 'QM_HARNESS', 'QM_MEMORY_CAPTURE_QUIET_MS', 'QM_PROBE_CONFIG', 'HE_HARNESS_CONFIG'];

// prepare.sh reads the Docker socket's group, as tests/qm-config.test.ts's mapping tests do.
describe.if(haveSocket)('prepare.sh: the skill-resolver arm configs', () => {
  test('each maps to pi with the shipped quiet time and no probe; only pull adds QM_SANDBOX_IMAGE', () => {
    for (const [config, core, arms, extra] of [
      ['pi-skills-native', 'harness-eval/qm:harn52-arm-catalog', { core: 'catalog' }, {}],
      ['pi-skills-push', 'harness-eval/qm:harn52-arm-catalog', { core: 'catalog' }, {}],
      ['pi-skills-pull', 'harness-eval/qm:harn52-arm-pull', { core: 'catalog-pull', sandbox: 'catalog-pull' }, { QM_SANDBOX_IMAGE: 'harness-eval/qm-sandbox:harn52-arm-pull' }],
      ['pi-skills-none', 'harness-eval/qm:harn52-arm-none', { core: 'no-catalog' }, {}],
    ] as const) {
      const r = prepare(config, { core, arms });
      expect(r.status).toBe(0);
      expect(r.keys).toEqual([...BEFORE_KEYS, ...Object.keys(extra)]);
      expect(r.vars).toMatchObject({ QM_HARNESS: 'pi', QM_MEMORY_CAPTURE_QUIET_MS: '180000', QM_PROBE_CONFIG: '', HE_HARNESS_CONFIG: config, ...extra });
    }
  });

  test('a config paired with the wrong image, or an unlabelled one, stops before the stack', () => {
    for (const [config, o, want] of [
      ['pi-skills-push', { core: 'harness-eval/qm:harn52-arm-none', arms: { core: 'no-catalog' } }, 'has harness-eval.skill-arm no-catalog, but HE_HARNESS_CONFIG=pi-skills-push needs catalog'],
      ['pi-skills-native', { arms: {} }, 'image harness-eval/qm:dev has harness-eval.skill-arm <none>, but HE_HARNESS_CONFIG=pi-skills-native needs catalog'],
      ['pi-skills-pull', { core: 'harness-eval/qm:harn52-arm-pull', arms: { core: 'catalog-pull' } }, 'image harness-eval/qm-sandbox:harn52-arm-pull has harness-eval.skill-arm <none>, but HE_HARNESS_CONFIG=pi-skills-pull needs catalog-pull'],
      ['pi-skills-native', { core: 'harness-eval/qm:harn52-arm-catalog', arms: { core: 'catalog', sandbox: 'catalog-pull' } }, 'has harness-eval.skill-arm catalog-pull, but HE_HARNESS_CONFIG=pi-skills-native needs <none>'],
    ] as const) {
      const r = prepare(config, o);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(want);
      expect(r.keys).toEqual([]);
    }
  });

  test('the existing configs make the same two docker calls and print the same lines as before', () => {
    for (const config of [undefined, 'pi', 'pi-probe', 'pi-strict', 'pi-command-deny']) {
      const r = prepare(config, { arms: { core: 'catalog', sandbox: 'catalog-pull' } });
      expect(r.status).toBe(0);
      expect(r.keys).toEqual(BEFORE_KEYS);
      expect(r.docker).toEqual([
        'image inspect --format {{index .Config.Labels "harness-eval.commit"}} harness-eval/qm:dev',
        'image inspect --format {{index .Config.Labels "harness-eval.commit"}} harness-eval/qm-sandbox:dev',
      ]);
    }
  });

  test('an unknown config names the new configs in its refusal', () => {
    const r = prepare('pi-skills-bogus');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('pi-skills-native, pi-skills-push, pi-skills-pull, pi-skills-none');
  });
});
