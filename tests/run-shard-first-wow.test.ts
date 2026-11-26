// scripts/run-shard.sh with gbrain first-wow cells: after the harness images the shard builds the gbrain-arm images with
// harnesses/_first-wow/build.sh from the cells' first_wow commit and version (QM's qm-native arm adds harness-eval/claude-code:dev and
// its gbrain image, the brain host), records their ids in shard.json, skips the gbrain sidecar build when no cell has a gbrain
// field, and runs the clean-arm preflight with the plain-arm images (QM: core and sandbox) as --plain-image.
//
// Value: protects=each of the four frozen shards of gbrain-first-wow-2026-12 builds and records the images its trials run, and its
// plain arm is checked for gbrain; fails_when=build.sh is not called or gets the wrong commit, version or harnesses, the QM brain host
// image is missing, a first-wow tag is left out of shard.json, the sidecar is built for a shard with no gbrain cell, or the
// clean-arm preflight is skipped or misses a plain image; why_new=a second-model read found the standard shard path could not
// launch these cells; seam=fake docker, bun, build-gbrain-image.sh and _first-wow/build.sh in a throwaway clean checkout holding a
// copy of the script (as tests/run-shard-clean-arm.test.ts); no_claim=real images (scripts/v04/clean-arm-audit.ts covers the probe).
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const PREREG = JSON.parse(readFileSync(join(ROOT, 'docs', 'benchmarks', '2026-11-24-gbrain-first-wow', 'prereg.json'), 'utf8')) as { run_id: string; cells: Array<Record<string, unknown>> };
const COMMIT = 'c341d40de3e5f7cacecb064825655ce926d877f8';
const tmp = mkdtempSync(join(tmpdir(), 'run-shard-first-wow-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function shard(cells: string[], extraCells: Array<Record<string, unknown>> = []) {
  const dir = mkdtempSync(join(tmp, 'repo-'));
  const bin = join(dir, '.fake-bin');
  const logs = mkdtempSync(join(tmp, 'logs-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'harnesses', '_first-wow'), { recursive: true });
  mkdirSync(bin);
  copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(dir, 'scripts', 'run-shard.sh'));
  const script = (path: string, body: string) => { writeFileSync(path, '#!/usr/bin/env bash\n' + body + '\n'); chmodSync(path, 0o755); };
  script(join(dir, 'scripts', 'build-gbrain-image.sh'), `echo "$*" >> '${logs}/sidecar'`);
  script(join(dir, 'harnesses', '_first-wow', 'build.sh'), `echo "$*" >> '${logs}/first-wow'`);
  script(join(bin, 'docker'), [`echo "$*" >> '${logs}/docker'`, `if [ "$1 $2" = "image inspect" ]; then echo "sha256:id-${'$'}{@: -1}"; fi`, `if [ "$1" = run ] && [ "${'$'}{@: -1}" = /opt/first-wow/image.json ]; then echo '{"deps_sha256":"d1"}'; fi`, 'exit 0'].join('\n'));
  script(join(bin, 'bun'), [`echo "$*" >> '${logs}/bun'`, 'case " $* " in *" scripts/v04/clean-arm-audit.ts preflight "*) exit 0 ;; *" preflight "*) exit 1 ;; esac', 'exit 0'].join('\n'));
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: PREREG.run_id, cells: [...PREREG.cells, ...extraCells] }));
  writeFileSync(join(dir, '.gitignore'), '.fake-bin/\nresults/\n');
  const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir });
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fixture');
  const p = spawnSync('bash', ['--noprofile', '--norc', join(dir, 'scripts', 'run-shard.sh'), '--prereg', 'prereg.json', '--name', 's', '--cells', cells.join(','), '--lease-usd', '1'],
    { cwd: dir, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: mkdtempSync(join(tmp, 'home-')) } });
  const read = (f: string) => (existsSync(join(logs, f)) ? readFileSync(join(logs, f), 'utf8') : '').split('\n').filter(Boolean);
  const shardJson = join(dir, 'results', PREREG.run_id, 'shard.json');
  const fwFile = join(dir, 'results', PREREG.run_id, 'first-wow-images.ndjson');
  return { status: p.status, stderr: p.stderr, firstWow: read('first-wow'), sidecar: read('sidecar'), builds: read('docker').filter((l) => l.startsWith('build ')).map((l) => l.split(' -t ')[1]!.split(' ')[0]!),
    clean: read('bun').filter((l) => l.includes('clean-arm-audit.ts')), images: existsSync(shardJson) ? Object.keys((JSON.parse(readFileSync(shardJson, 'utf8')) as { images: object }).images) : [],
    fwImages: existsSync(fwFile) ? readFileSync(fwFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { tag: string; id: string; image: { deps_sha256?: string } }) : [] };
}

describe('run-shard.sh with gbrain first-wow cells', () => {
  test('shard 1 (QM native and plain): QM images, the Claude Code base and brain host image, no sidecar, plain QM images checked for gbrain', () => {
    const r = shard(['qm-opus-native', 'qm-sol-native', 'qm-opus-plain']);
    expect(r.builds).toEqual(['harness-eval/claude-code:dev', 'harness-eval/qm:dev', 'harness-eval/qm-sandbox:dev']);
    expect(r.firstWow).toEqual([`${COMMIT} 0.60.774.0 claude-code`]);
    expect(r.sidecar).toEqual([]);
    expect(r.images.sort()).toEqual(['harness-eval/claude-code-gbrain:c341d40de3e5', 'harness-eval/claude-code:dev', 'harness-eval/qm-sandbox:dev', 'harness-eval/qm:dev']);
    expect(r.clean).toHaveLength(1);
    expect(r.clean[0]).toContain('--image harness-eval/qm:dev');
    expect(r.clean[0]).toContain('--plain-image harness-eval/qm:dev --plain-image harness-eval/qm-sandbox:dev');
    expect(r.clean[0]).not.toContain('gbrain:');
    expect(r.fwImages).toEqual([{ tag: 'harness-eval/claude-code-gbrain:c341d40de3e5', id: 'sha256:id-harness-eval/claude-code-gbrain:c341d40de3e5', image: { deps_sha256: 'd1' } }]);
  }, 30_000);

  test('shard 3 (Claude Code gbrain arms and coding): one build of the Claude Code gbrain image, clean-arm on with no plain image', () => {
    const r = shard(['cc-opus-defaults', 'cc-opus-pr1', 'cc-opus-full', 'cc-opus-defaults-coding', 'cc-opus-full-coding']);
    expect(r.builds).toEqual(['harness-eval/claude-code:dev']);
    expect(r.firstWow).toEqual([`${COMMIT} 0.60.774.0 claude-code`]);
    expect(r.images.sort()).toEqual(['harness-eval/claude-code-gbrain:c341d40de3e5', 'harness-eval/claude-code:dev']);
    expect(r.stderr).toContain('clean-arm preflight: on, as every shard with first-wow cells runs it');
    expect(r.clean[0]).not.toContain('--plain-image');
  }, 30_000);

  test('shard 4 (Claude Code plain, Codex gbrain and plain): the Codex gbrain image, both plain images checked', () => {
    const r = shard(['cc-opus-plain', 'codex-sol-defaults', 'codex-sol-pr1', 'codex-sol-plain']);
    expect(r.builds).toEqual(['harness-eval/claude-code:dev', 'harness-eval/codex:dev']);
    expect(r.firstWow).toEqual([`${COMMIT} 0.60.774.0 codex`]);
    expect(r.images.sort()).toEqual(['harness-eval/claude-code:dev', 'harness-eval/codex-gbrain:c341d40de3e5', 'harness-eval/codex:dev']);
    expect(r.clean[0]).toContain('--plain-image harness-eval/claude-code:dev --plain-image harness-eval/codex:dev');
  }, 30_000);

  test('a shard with a gbrain sidecar cell still builds the sidecar image', () => {
    const r = shard(['mu'], [{ id: 'mu', harness: 'openclaw', slice: 'multiuser', split: 'dev', gbrain: { surface: 'full' } }]);
    expect(r.sidecar).toHaveLength(1);
    expect(r.firstWow).toEqual([]);
    expect(r.images).toContain('harness-eval/gbrain:dev');
    expect(r.clean).toEqual([]);
  }, 30_000);
});
