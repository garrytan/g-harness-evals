// internal-task (the access-rules rerun): a preregistration's top-level gbrain_commit carries the rerun's gbrain commit end to end
// while gbrain/pin.json stays the first run's pin. plan reads and copies it into the manifest, scripts/run-shard.sh builds
// the image with --gbrain <sha>, and preflight and run refuse an image that records any other commit (HE-GBRAIN-016). Without
// the field each step behaves as before. The runner and run-shard.sh run against fake docker, bun and build-gbrain-image.sh
// on PATH with an allowlist environment (PATH and HOME only), never a login shell.

import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildManifest, loadPrereg, type Cell, type Prereg } from '../runner/run.ts';
import { preregCommitProblem } from '../runner/trial/gbrain.ts';

const ROOT = resolve(import.meta.dir, '..');
const PIN = (JSON.parse(readFileSync(join(ROOT, 'gbrain', 'pin.json'), 'utf8')) as { gbrain: { commit: string } }).gbrain.commit;
const RERUN = 'f650eac5cf063f9ecda767bc424eae146dee84eb';
const OTHER = 'a'.repeat(40);
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'he-prereg-gbrain-commit-')));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const cell = (id = 'fake-acl-mu-v03-dev'): Cell => ({ id, harness: '_fake', harness_mode: 'process', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1,
  ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, gbrain: { surface: 'starter', brain: 'member', scope: 'member', access: 'rules' } });
function writePrereg(runId: string, extra: Record<string, unknown> = {}): string {
  const dir = join(tmp, runId);
  mkdirSync(dir, { recursive: true });
  const p: Prereg = { schema_version: 1, run_id: runId, question: 'gbrain_commit fixture', tasks: {}, cells: [cell()], wall_clock_s: { multiuser: 120 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] };
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ ...p, ...extra }));
  return join(dir, 'prereg.json');
}
function fake(dir: string, name: string, body: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), '#!/usr/bin/env bash\n' + body + '\n');
  chmodSync(join(dir, name), 0o755);
}

// ---- the field ----------------------------------------------------------------------------------------------------------

describe('prereg gbrain_commit', () => {
  test('loads as a full sha and is copied into the manifest; absent, the manifest has no such key', () => {
    const named = loadPrereg(writePrereg('named', { gbrain_commit: RERUN }));
    expect(named.prereg.gbrain_commit).toBe(RERUN);
    expect(buildManifest(named.prereg, named.sha256, '2026-11-02T00:00:00Z').gbrain_commit).toBe(RERUN);
    const plain = loadPrereg(writePrereg('plain'));
    expect(plain.prereg.gbrain_commit).toBeUndefined();
    expect('gbrain_commit' in buildManifest(plain.prereg, plain.sha256, '2026-11-02T00:00:00Z')).toBe(false);
  });

  test('anything but a full lowercase 40-character sha is HE-GBRAIN-016', () => {
    for (const bad of [RERUN.slice(0, 12), RERUN.toUpperCase(), 'v0.60.554.0', 42, null, ''])
      expect(() => loadPrereg(writePrereg('bad-' + String(bad).slice(0, 8), { gbrain_commit: bad }))).toThrow(/^HE-GBRAIN-016 gbrain_commit must be a full 40-character gbrain sha/);
  });
});

// ---- the gate -----------------------------------------------------------------------------------------------------------

test('preregCommitProblem passes only the preregistered commit and refuses a missing image.json or a different --gbrain-commit', () => {
  expect(preregCommitProblem({ image: 'img', built: RERUN, prereg: RERUN })).toBeNull();
  expect(preregCommitProblem({ image: 'img', built: RERUN, prereg: RERUN, flag: RERUN })).toBeNull();
  expect(preregCommitProblem({ image: 'img', built: PIN, prereg: RERUN })).toContain('image img records gbrain ' + PIN + ", the preregistration's gbrain_commit is " + RERUN + '; fix: scripts/build-gbrain-image.sh --gbrain ' + RERUN);
  expect(preregCommitProblem({ image: 'img', built: null, prereg: RERUN })).toContain('records gbrain no commit');
  expect(preregCommitProblem({ image: 'img', built: RERUN, prereg: RERUN, flag: OTHER })).toContain('--gbrain-commit names ' + OTHER + " and the preregistration's gbrain_commit is " + RERUN);
});

// ---- preflight and run --------------------------------------------------------------------------------------------------

describe('runner preflight and run against the image commit', () => {
  // A fake docker: image inspect succeeds unless MISSING is set; cat of /opt/sidecar/image.json prints IMAGE_COMMIT's image.json,
  // or fails when IMAGE_COMMIT is empty; every other call fails, so a preflight that passes the gate stops at the next docker step.
  const bin = join(tmp, 'runner-bin');
  fake(bin, 'docker', ['case "$1" in', '  image) [ -z "$MISSING" ] || exit 1; [ "$3" = -f ] && [ "$4" = \'{{.Id}}\' ] && echo sha256:fake-image; exit 0 ;;',
    '  run) [ "$6" = /opt/sidecar/image.json ] && [ -n "$IMAGE_COMMIT" ] && [ -z "$MISSING" ] || exit 1; printf \'{"gbrain_commit":"%s","gbrain_version":"0.60.554.0","sealed":false}\\n\' "$IMAGE_COMMIT" ;;',
    '  *) exit 1 ;;', 'esac'].join('\n'));
  function manifest(runId: string, gbrainCommit?: string): string {
    const { prereg, sha256 } = loadPrereg(writePrereg(runId, gbrainCommit ? { gbrain_commit: gbrainCommit } : {}));
    const file = join(tmp, runId, 'out', 'manifest.json');
    mkdirSync(join(tmp, runId, 'out'), { recursive: true });
    writeFileSync(file, JSON.stringify(buildManifest(prereg, sha256)));
    return file;
  }
  function runner(args: string[], env: { IMAGE_COMMIT?: string; MISSING?: string }) {
    const r = spawnSync('bun', ['runner/run.ts', ...args, '--gbrain-image', 'harness-eval/gbrain:fake'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000,
      env: { PATH: bin + ':' + (process.env.PATH ?? ''), HOME: tmp, IMAGE_COMMIT: env.IMAGE_COMMIT ?? '', MISSING: env.MISSING ?? '' } });
    return { code: r.status, out: r.stdout, err: r.stderr };
  }

  test('preflight refuses an image at another commit, or none, with HE-GBRAIN-016 and passes the preregistered one', () => {
    const m = manifest('pf-named', RERUN);
    const pinned = runner(['preflight', '--manifest', m], { IMAGE_COMMIT: PIN });
    expect(pinned.code).toBe(2);
    expect(pinned.err).toContain('HE-GBRAIN-016 image harness-eval/gbrain:fake records gbrain ' + PIN + ", the preregistration's gbrain_commit is " + RERUN);
    const none = runner(['preflight', '--manifest', m], {});
    expect(none.err).toContain('HE-GBRAIN-016 image harness-eval/gbrain:fake records gbrain no commit');
    const flagged = runner(['preflight', '--manifest', m, '--gbrain-commit', OTHER], { IMAGE_COMMIT: OTHER });
    expect(flagged.err).toContain('HE-GBRAIN-016 --gbrain-commit names ' + OTHER);
    const ok = runner(['preflight', '--manifest', m], { IMAGE_COMMIT: RERUN });
    expect(ok.out).toContain('GBRAIN: image harness-eval/gbrain:fake records gbrain ' + RERUN + ", the preregistration's gbrain_commit");
    expect(ok.err).not.toContain('HE-GBRAIN-016');
  }, 120_000);

  test('without the field preflight holds the image to gbrain/pin.json as before (HE-GBRAIN-002)', () => {
    const m = manifest('pf-plain');
    const off = runner(['preflight', '--manifest', m], { IMAGE_COMMIT: RERUN });
    expect(off.code).toBe(2);
    expect(off.err).toContain('HE-GBRAIN-002 image harness-eval/gbrain:fake records gbrain ' + RERUN + ', gbrain/pin.json pins ' + PIN);
    const ok = runner(['preflight', '--manifest', m], { IMAGE_COMMIT: PIN });
    expect(ok.out).toContain('GBRAIN: image harness-eval/gbrain:fake records gbrain ' + PIN + ', the pinned commit');
    expect(ok.err).not.toContain('HE-GBRAIN-016');
  }, 120_000);

  test('run refuses an image at another commit, and a missing image, with HE-GBRAIN-016 before any trial', () => {
    const m = manifest('run-named', RERUN);
    for (const env of [{ IMAGE_COMMIT: PIN }, { MISSING: '1' }]) {
      const r = runner(['run', '--manifest', m, '--lease-usd', '1'], env);
      expect(r.code).toBe(2);
      expect(r.err).toContain("HE-GBRAIN-016 image harness-eval/gbrain:fake records gbrain " + (env.IMAGE_COMMIT ?? 'no commit'));
      expect(existsSync(join(tmp, 'run-named', 'out', 'trials.jsonl'))).toBe(false);
    }
  }, 120_000);

  test('run refuses an access-ruled cell with no access preflight record, or one for another image id, with HE-GBRAIN-002', () => {
    const m = manifest('run-acl', RERUN);
    const missing = runner(['run', '--manifest', m, '--lease-usd', '1'], { IMAGE_COMMIT: RERUN });
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('HE-GBRAIN-002 access=rules: no access preflight record for dev at ' + join(tmp, 'run-acl', 'out', 'access-preflight-dev.json'));
    writeFileSync(join(tmp, 'run-acl', 'out', 'access-preflight-dev.json'), JSON.stringify({ split: 'dev', ok: true, evidence: { image_id: 'sha256:before-the-resume' } }));
    const rebuilt = runner(['run', '--manifest', m, '--lease-usd', '1'], { IMAGE_COMMIT: RERUN });
    expect(rebuilt.code).toBe(2);
    expect(rebuilt.err).toContain('HE-GBRAIN-002 access=rules: the access preflight for dev ran on image id sha256:before-the-resume, harness-eval/gbrain:fake is now sha256:fake-image');
    expect(existsSync(join(tmp, 'run-acl', 'out', 'trials.jsonl'))).toBe(false);
  }, 120_000);
});

// ---- run-shard.sh -------------------------------------------------------------------------------------------------------

describe('scripts/run-shard.sh builds at the preregistration\'s gbrain_commit', () => {
  function shard(name: string, extra: Record<string, unknown>) {
    const dir = join(tmp, 'shard-' + name);
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(repo, 'scripts', 'run-shard.sh'));
    fake(join(repo, 'scripts'), 'build-gbrain-image.sh', 'echo "build $*" >> "$SEEN"');
    const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('add', '.'); g('commit', '-q', '-m', 'shard scripts');
    const bin = join(dir, 'bin');
    fake(bin, 'docker', 'case "$1" in image) echo "sha256:0000" ;; *) exit 0 ;; esac');
    fake(bin, 'bun', ['step=$2; out=""; manifest=""', 'echo "bun $*" >> "$SEEN"', 'while [ $# -gt 0 ]; do case "$1" in --out) out=$2 ;; --manifest) manifest=$2 ;; esac; shift; done',
      'case "$step" in', '  plan) mkdir -p "$out" && echo "{}" > "$out/manifest.json" ;;', '  preflight) echo "PREFLIGHT: ok" ;;', '  run) echo \'{"trial_id":"t"}\' >> "$(dirname "$manifest")/trials.jsonl" ;;', 'esac'].join('\n'));
    const prereg = join(dir, 'prereg.json');
    writeFileSync(prereg, JSON.stringify({ run_id: 'shard-' + name, cells: [cell('sonnet')], ...extra }));
    const seen = join(dir, 'seen.log'), printed = join(dir, 'run-shard.out');
    // the prune loop leaves a sleep holding the script's stdout, so the output goes through a file rather than a pipe
    const r = spawnSync('bash', ['-c', 'bash "$1" "${@:2}" > "$0" 2>&1', printed, join(repo, 'scripts', 'run-shard.sh'), '--prereg', prereg, '--name', 's1', '--cells', 'sonnet', '--lease-usd', '1', '--out', join(dir, 'out')],
      { cwd: repo, encoding: 'utf8', timeout: 60_000, env: { PATH: bin + ':' + (process.env.PATH ?? ''), HOME: dir, SEEN: seen } });
    return { code: r.status, out: readFileSync(printed, 'utf8'), calls: existsSync(seen) ? readFileSync(seen, 'utf8').split('\n').filter(Boolean) : [] };
  }

  test('a preregistration naming gbrain_commit gets --gbrain <sha> on the image build, and the shard log names it', () => {
    const r = shard('named', { gbrain_commit: RERUN });
    expect(r.code, r.out).toBe(0);
    const build = r.calls.filter((c) => c.startsWith('build '));
    expect(build).toHaveLength(1);
    expect(build[0]).toContain('--gbrain ' + RERUN);
    expect(r.out).toContain("gbrain " + RERUN + ", the preregistration's gbrain_commit (not gbrain/pin.json's)");
    expect(r.calls.map((c) => c.split(' ')[0] + ' ' + (c.split(' ')[0] === 'bun' ? c.split(' ')[2] : ''))).toEqual(['build ', 'bun plan', 'bun preflight', 'bun run']);
  }, 60_000);

  test('without the field the build line is unchanged (no --gbrain, so the pin)', () => {
    const r = shard('plain', {});
    expect(r.code, r.out).toBe(0);
    const build = r.calls.filter((c) => c.startsWith('build '));
    expect(build).toEqual(['build --tag harness-eval/gbrain:dev --out ' + join(tmp, 'shard-plain', 'out', 'gbrain-image')]);
    expect(r.out).not.toContain("preregistration's gbrain_commit");
  }, 60_000);

  test('a malformed gbrain_commit is refused before any build (HE-GBRAIN-016)', () => {
    const r = shard('bad', { gbrain_commit: RERUN.slice(0, 12) });
    expect(r.code).toBe(2);
    expect(r.out).toContain("run-shard: HE-GBRAIN-016 the preregistration's gbrain_commit must be a full 40-character sha (got \"" + RERUN.slice(0, 12) + '")');
    expect(r.calls).toEqual([]);
  }, 60_000);
});
