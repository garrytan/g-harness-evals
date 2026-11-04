// scripts/run-shard.sh (internal-task, TODOS "The shard path never builds the QM sandbox image"): a shard with a qm cell builds
// harnesses/qm/Dockerfile.sandbox as harness-eval/qm-sandbox:dev and records its image id in shard.json; a shard without
// one builds no sandbox. seam=fake docker, bun and build-gbrain-image.sh on PATH in a throwaway clean checkout holding a
// copy of the script; no_claim=a real image build.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'run-shard-qm-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function shard(cells: string, opts: { missing?: string; noId?: string; extra?: string[]; env?: Record<string, string>; tag?: string } = {}) {
  const dir = mkdtempSync(join(tmp, 'repo-'));
  const bin = join(dir, '.fake-bin');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(bin);
  copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(dir, 'scripts', 'run-shard.sh'));
  const script = (path: string, body: string) => { writeFileSync(path, '#!/usr/bin/env bash\n' + body + '\n'); chmodSync(path, 0o755); };
  script(join(dir, 'scripts', 'build-gbrain-image.sh'), 'exit 0');
  const log = join(tmp, `docker-${cells.replace(/,/g, '-')}${opts.missing ? '-missing' : ''}${opts.env ? '-env' : ''}${opts.tag ?? ''}.log`);
  script(join(bin, 'docker'), `echo "$*" >> '${log}'\nif [ "$1 $2" = "image inspect" ]; then [ "${'$'}{@: -1}" != '${opts.missing ?? ''}' ] || exit 1; [ "$3 ${'$'}{@: -1}" != '-f ${opts.noId ?? ''}' ] || exit 1; echo "sha256:id-${'$'}{@: -1}"; fi\nexit 0`);
  const bunEnv = log.replace(/\.log$/, '.bun-env');
  script(join(bin, 'bun'), `printf '%s' "${'$'}{QM_SANDBOX_IMAGE-unset}" > '${bunEnv}'\nexit 1`);
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'qm-sandbox-test', cells: [{ id: 'q', harness: 'qm' }, { id: 'o', harness: 'openclaw' }] }));
  writeFileSync(join(dir, '.gitignore'), '.fake-bin/\nresults/\n');
  const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fixture');
  const p = spawnSync('bash', ['--noprofile', '--norc', join(dir, 'scripts', 'run-shard.sh'), '--prereg', 'prereg.json', '--name', 's', '--cells', cells, '--lease-usd', '1', ...(opts.extra ?? [])],
    { cwd: dir, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: mkdtempSync(join(tmp, 'home-')), ...opts.env } });
  if (!existsSync(log) && opts.tag !== '-refuse') throw new Error(`run-shard.sh exited ${p.status} before any docker call: ${p.stderr}`);
  const calls = existsSync(log) ? readFileSync(log, 'utf8') : '';
  const shardPath = join(dir, 'results', 'qm-sandbox-test', 'shard.json');
  const images = existsSync(shardPath) ? (JSON.parse(readFileSync(shardPath, 'utf8')) as { images: Record<string, string> }).images : undefined;
  const runnerSandbox = existsSync(bunEnv) ? readFileSync(bunEnv, 'utf8') : undefined;
  return { status: p.status, calls, images, stderr: p.stderr + p.stdout, runnerSandbox };
}

describe('run-shard.sh and the QM sandbox image', () => {
  test('a shard with a qm cell builds Dockerfile.sandbox as harness-eval/qm-sandbox:dev and records its id', () => {
    const r = shard('q,o');
    expect(r.calls).toContain('build -q -f harnesses/qm/Dockerfile.sandbox -t harness-eval/qm-sandbox:dev harnesses/qm');
    expect(r.images?.['harness-eval/qm-sandbox:dev']).toBe('sha256:id-harness-eval/qm-sandbox:dev');
    expect(r.images?.['harness-eval/qm:dev']).toBe('sha256:id-harness-eval/qm:dev');
    expect(r.runnerSandbox).toBe('harness-eval/qm-sandbox:dev');
  }, 30_000);
  test('a shard without a qm cell builds and records no sandbox image', () => {
    const r = shard('o');
    expect(r.calls).not.toContain('Dockerfile.sandbox');
    expect(r.images?.['harness-eval/qm-sandbox:dev']).toBeUndefined();
    expect(r.images?.['harness-eval/openclaw:dev']).toBe('sha256:id-harness-eval/openclaw:dev');
  }, 30_000);
  test('under --skip-build a missing sandbox image stops the shard instead of recording an empty id', () => {
    const r = shard('q,o', { missing: 'harness-eval/qm-sandbox:dev', extra: ['--skip-build'] });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('harness-eval/qm-sandbox:dev is missing');
    expect(r.images).toBeUndefined();
  }, 30_000);
  test('a qm shard refuses a QM_SANDBOX_IMAGE other than the tag it builds and records, before any docker call', () => {
    for (const tag of ['custom/qm-sandbox:1', 'docker.io/harness-eval/qm:dev']) {
      const r = shard('q,o', { env: { QM_SANDBOX_IMAGE: tag }, tag: '-refuse' });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`QM_SANDBOX_IMAGE=${tag}`);
      expect(r.calls).toBe('');
      expect(r.images).toBeUndefined();
    }
    expect(shard('q', { env: { QM_SANDBOX_IMAGE: 'harness-eval/qm-sandbox:dev' }, tag: '-same' }).images?.['harness-eval/qm-sandbox:dev']).toBe('sha256:id-harness-eval/qm-sandbox:dev');
    expect(shard('o', { env: { QM_SANDBOX_IMAGE: 'custom/qm-sandbox:1' }, tag: '-noqm' }).images?.['harness-eval/openclaw:dev']).toBe('sha256:id-harness-eval/openclaw:dev');
  }, 60_000);
  test('an image whose id lookup fails stops the shard instead of recording an empty id', () => {
    const r = shard('q,o', { noId: 'harness-eval/qm-sandbox:dev', extra: ['--skip-build'], tag: '-noid' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('harness-eval/qm-sandbox:dev is missing');
    expect(r.images).toBeUndefined();
  }, 30_000);
});
