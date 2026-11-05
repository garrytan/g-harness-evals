// scripts/matrix/clean-arm-preflight.sh, the matrix shards' --pre-smoke clean-arm check, against a stand-in docker. Each run
// uses a temporary root holding copies of the script and the three real mount files, so a case can change one of them.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const FILES = ['scripts/matrix/clean-arm-preflight.sh', 'runner/trial/docker.ts', 'harnesses/run-trial.sh', 'harnesses/qm/compose.yaml'];

function preflight(o: { find?: string; buildFails?: boolean; runFails?: boolean; searchFails?: boolean; realFind?: string; image?: string[]; homeDirs?: string[]; root?: (root: string) => void } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'matrix-clean-arm-'));
  const bin = join(dir, 'bin'), home = join(dir, 'home'), root = join(dir, 'repo');
  for (const f of FILES) { mkdirSync(dirname(join(root, f)), { recursive: true }); cpSync(join(ROOT, f), join(root, f)); }
  o.root?.(root);
  mkdirSync(bin);
  mkdirSync(home);
  for (const d of o.homeDirs ?? []) mkdirSync(join(home, d), { recursive: true });
  writeFileSync(join(dir, 'find.out'), o.find ?? '');
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
echo "$*" >> ${JSON.stringify(join(dir, 'docker.log'))}
case $1 in build) exit ${o.buildFails ? 1 : 0} ;; run) ${o.runFails ? 'exit 1' : o.searchFails || o.realFind ? 'sh -c "${11}"' : `cat ${JSON.stringify(join(dir, 'find.out'))}`} ;; esac
`);
  chmodSync(join(bin, 'docker'), 0o755);
  if (o.searchFails) { writeFileSync(join(bin, 'find'), '#!/bin/sh\nexit 1\n'); chmodSync(join(bin, 'find'), 0o755); }
  if (o.realFind) {
    const image = join(dir, 'image');
    for (const d of o.image ?? []) mkdirSync(join(image, d), { recursive: true });
    writeFileSync(join(bin, 'find'), `#!/bin/sh\nshift\nexec ${o.realFind} ${image} "$@"\n`);
    chmodSync(join(bin, 'find'), 0o755);
  }
  const r = spawnSync('bash', ['scripts/matrix/clean-arm-preflight.sh', 'codex', 'qm'], { cwd: root, encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, HE_PREFLIGHT_IN_DOCKER_GROUP: '1' } });
  const log = join(dir, 'docker.log');
  return { ...r, dockerLog: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

describe('scripts/matrix/clean-arm-preflight.sh', () => {
  test('passes a clean host, the real mount files and clean images, QM sandbox included', () => {
    const r = preflight();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('host clean');
    expect(r.stdout).toContain('mounts clean');
    for (const img of ['harness-eval/codex:dev', 'harness-eval/qm:dev', 'harness-eval/qm-sandbox:dev']) expect(r.stdout).toContain(`${img} clean`);
    expect(r.dockerLog).toContain('build -q -f harnesses/qm/Dockerfile.sandbox -t harness-eval/qm-sandbox:dev harnesses/qm');
  });
  test('fails an image holding a gstack path, an image it cannot search, a search that exits non-zero, and a host with a Capy drive or gstack install', () => {
    const image = preflight({ find: '/root/.local/share/gstack\n' });
    expect(image.status).toBe(5);
    expect(image.stdout).toContain('harness-eval/codex:dev FAIL, gstack or .capy paths: /root/.local/share/gstack');
    const unsearched = preflight({ runFails: true });
    expect(unsearched.status).toBe(5);
    expect(unsearched.stdout).toContain('harness-eval/codex:dev FAIL, the search could not run in the image');
    const failedSearch = preflight({ searchFails: true });
    expect(failedSearch.status).toBe(5);
    expect(failedSearch.stdout).toContain('harness-eval/codex:dev FAIL, the search could not run in the image');
    expect(failedSearch.dockerLog).toContain('run --rm --network none --user 0:0 --entrypoint sh harness-eval/codex:dev -c');
    const host = preflight({ homeDirs: ['.capy/drive', '.claude/skills/gstack'] });
    expect(host.status).toBe(5);
    expect(host.stdout).toMatch(/host FAIL, present: .*\.capy .*\.claude\/skills\/gstack/);
  });
  test('fails a mount file that names a .capy path, and a mount file it cannot read', () => {
    const named = preflight({ root: (root) => appendFileSync(join(root, 'runner/trial/docker.ts'), "\n// '-v', '<private drive>:/drive'\n") });
    expect(named.status).toBe(5);
    expect(named.stdout).toContain('mounts FAIL, runner/trial/docker.ts:');
    const missing = preflight({ root: (root) => rmSync(join(root, 'harnesses/qm/compose.yaml')) });
    expect(missing.status).toBe(5);
    expect(missing.stdout).toContain('mounts FAIL, the mount files could not be read');
  });
  const IMAGE_HITS = ['opt/gstack', 'root/.gstack', 'usr/lib/node_modules/gstack-cli', 'root/.claude/skills/gstack'];
  const hasBusybox = spawnSync('busybox', ['find', '--help']).error === undefined;
  for (const [label, impl, skip] of [['GNU find', '/usr/bin/find', false], ['BusyBox find (the QM image is alpine)', 'busybox find', !hasBusybox]] as const) {
    test.skipIf(skip)(`the image search names every gstack path with ${label}`, () => {
      const r = preflight({ realFind: impl, image: [...IMAGE_HITS, 'usr/share/doc'] });
      expect(r.status).toBe(5);
      for (const hit of IMAGE_HITS) expect(r.stdout).toContain(`/${hit}`);
      expect(r.stdout).not.toContain('usr/share/doc');
    });
  }
  test('stops with exit 3 when an image build fails', () => {
    const r = preflight({ buildFails: true });
    expect(r.status).toBe(3);
    expect(r.stdout).toContain('image build failed for codex');
  });
});
