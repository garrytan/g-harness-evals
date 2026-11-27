// internal-task: a shard resumed on a new Ubicloud VM rebuilds its gbrain image, which gets a new image id. The resume skips preflight
// on purpose (its lease is closed and a closed lease is never reopened, HE-PROXY-003), so the stored leak preflight records named
// the old id and run refused every live-ingestion cell (HE-GBRAIN-020). The resume now reruns the keyless leak preflight alone.
//
// Value: protects=a resume whose image id changed reruns every leak arm on the new image with no lease, keeps the earlier
// records beside the new ones and the new sidecar's manifest and ingest tokens for merge-shards, and then passes run's
// image check; a resume on the same image reruns nothing; a failed rerun stops the shard before run; fails_when=the resume
// keeps the stale record, overwrites the first one, or reruns a record already made on this image; seam=an injected
// runLeakPreflight, and fake bun and docker on PATH in a throwaway checkout holding a copy of scripts/run-shard.sh;
// no_claim=a real gbrain sidecar (tests/gbrain-leak-preflight.test.ts's docker-gated block).
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leakRecordProblem, preflightLeakArms, type LeakPreflightRecord, type runLeakPreflight } from '../runner/trial/gbrain-leak-preflight.ts';
import { leakArmKeys, type Cell } from '../runner/run.ts';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'shard-resume-leak-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const OLD = 'sha256:' + 'a'.repeat(64);
const NEW = 'sha256:' + 'b'.repeat(64);
const record = (arm: 'open' | 'member-sources', imageId: string): LeakPreflightRecord => ({ schema_version: 1, arm, split: 'dev', image: 'harness-eval/gbrain:dev', image_id: imageId, gbrain_commit: 'c0ffee', ok: true,
  layout: { sidecar: { brain: 'member' }, manifest_sha256: 'm', ingest_tokens_sha256: 'i' }, facts: [], asked: [], write_carry: null, informational: {}, problems: [], summary: { askers: 0, facts: 0, database_only: 0, calls: 0 } });

function runDir(imageId: string | null) {
  const d = mkdtempSync(join(tmp, 'run-'));
  if (imageId) for (const arm of ['open', 'member-sources'] as const) writeFileSync(join(d, `leak-preflight-${arm}-dev.json`), JSON.stringify(record(arm, imageId)));
  return d;
}

/** A runLeakPreflight that records its calls and answers a record on imageId, failing the arms named in fail. */
function fakeRun(imageId: string, fail: string[] = []) {
  const calls: Array<{ arm: string; keep?: string }> = [];
  const run = (async (o) => {
    calls.push({ arm: o.arm, keep: o.keep });
    const r = record(o.arm, imageId);
    return { record: fail.includes(o.arm) ? { ...r, ok: false, problems: [{ check: 'own-returned', token: 'member-a', member: 'a', tool: 'search', fact: 'f1', source: 'private-a', what: 'did not come back' }] } : r, secrets: [] };
  }) as typeof runLeakPreflight;
  return { run, calls };
}

const KEYS = ['member-sources|dev', 'open|dev'];
const opts = (dir: string, run: typeof runLeakPreflight, imageId: string) => ({ keys: KEYS, runDir: dir, image: 'harness-eval/gbrain:dev', worldPath: 'world/seed/world.json', log: () => undefined, resume: { imageId }, run });

describe('the leak preflight on a resume (internal-task)', () => {
  test('the arm keys come from the live-ingestion member-brain cells, one per scope and split, channel remember included', () => {
    const cell = (id: string, gbrain: Record<string, unknown>) => ({ id, harness: 'hermes', model: 'm', slice: 's', split: 'dev', repetitions: 1, gbrain }) as unknown as Cell;
    expect(leakArmKeys([cell('o', { brain: 'member', ingest: 'live', scope: 'open' }), cell('r', { brain: 'member', ingest: 'live', scope: 'member-sources', channel_remember: 'conversation' }), cell('r2', { brain: 'member', ingest: 'live', scope: 'member-sources' }), cell('c', { brain: 'company', scope: 'member' }), cell('m', { brain: 'member', ingest: 'live', scope: 'member' })]))
      .toEqual(['member-sources|dev', 'member-sources|dev|conversation', 'open|dev']);
  });

  test('a new image id reruns every arm on it, keeps the earlier records, gives each arm a preflight-leak directory for its layout files, and run then accepts the records', async () => {
    const dir = runDir(OLD);
    expect(leakRecordProblem(join(dir, 'leak-preflight-open-dev.json'), 'open', 'dev', 'harness-eval/gbrain:dev', NEW)).toMatch(/passed on image id sha256:a+, the run uses/);
    const { run, calls } = fakeRun(NEW);
    const out = await preflightLeakArms(opts(dir, run, NEW));
    expect(out.ran).toBe(true);
    expect(calls.map((c) => [c.arm, c.keep])).toEqual([['member-sources', join(dir, 'preflight-leak-member-sources-dev-bbbbbbbbbbbb')], ['open', join(dir, 'preflight-leak-open-dev-bbbbbbbbbbbb')]]);
    expect(out.kept.map((p) => p.slice(dir.length + 1)).sort()).toEqual(['leak-preflight-member-sources-dev.image-aaaaaaaaaaaa.json', 'leak-preflight-open-dev.image-aaaaaaaaaaaa.json']);
    expect(JSON.parse(readFileSync(join(dir, 'leak-preflight-open-dev.image-aaaaaaaaaaaa.json'), 'utf8')).image_id).toBe(OLD);
    for (const arm of ['open', 'member-sources'] as const) expect(leakRecordProblem(join(dir, `leak-preflight-${arm}-dev.json`), arm, 'dev', 'harness-eval/gbrain:dev', NEW)).toBeNull();
    const again = fakeRun(NEW);
    expect((await preflightLeakArms(opts(dir, again.run, NEW))).ran).toBe(false);
    expect(again.calls).toEqual([]);
    const third = fakeRun(OLD);
    await preflightLeakArms(opts(dir, third.run, OLD));
    expect(readdirSync(dir).filter((f) => f.includes('.image-')).sort()).toEqual(['leak-preflight-member-sources-dev.image-aaaaaaaaaaaa.json', 'leak-preflight-member-sources-dev.image-bbbbbbbbbbbb.json', 'leak-preflight-open-dev.image-aaaaaaaaaaaa.json', 'leak-preflight-open-dev.image-bbbbbbbbbbbb.json']);
  });

  test('a missing record reruns too; a rerun that finds a problem is refused with the arm\'s code, leaves the failing record for run to refuse, and is not rerun on that image', async () => {
    const missing = runDir(null);
    const ok = fakeRun(NEW);
    expect((await preflightLeakArms(opts(missing, ok.run, NEW))).kept).toEqual([]);
    expect(ok.calls.length).toBe(2);
    const dir = runDir(OLD);
    const bad = fakeRun(NEW, ['member-sources']);
    const err = await preflightLeakArms(opts(dir, bad.run, NEW)).then(() => null, (e) => e as { code: string; message: string });
    expect(err?.code).toBe('HE-GBRAIN-017');
    expect(leakRecordProblem(join(dir, 'leak-preflight-member-sources-dev.json'), 'member-sources', 'dev', 'harness-eval/gbrain:dev', NEW)).toMatch(/did not pass/);
    const retry = fakeRun(NEW);
    const again = await preflightLeakArms(opts(dir, retry.run, NEW)).then(() => null, (e) => e as { code: string; message: string });
    expect(again?.code).toBe('HE-GBRAIN-020');
    expect(again?.message).toContain('already failed on image id');
    expect(retry.calls).toEqual([]);
  });

  test('a resume on the image the records name still refuses two arms whose records disagree on the brain layout', async () => {
    const dir = runDir(NEW);
    writeFileSync(join(dir, 'leak-preflight-open-dev.json'), JSON.stringify({ ...record('open', NEW), layout: { sidecar: { brain: 'member' }, manifest_sha256: 'other', ingest_tokens_sha256: 'i' } }));
    const { run, calls } = fakeRun(NEW);
    const err = await preflightLeakArms(opts(dir, run, NEW)).then(() => null, (e) => e as { code: string; message: string });
    expect(err?.code).toBe('HE-GBRAIN-021');
    expect(calls).toEqual([]);
  });
});

describe('scripts/run-shard.sh --resume and the leak preflight', () => {
  function resume(leakExit: number) {
    const dir = mkdtempSync(join(tmp, 'repo-'));
    const bin = join(dir, '.fake-bin');
    const logs = mkdtempSync(join(tmp, 'logs-'));
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    mkdirSync(bin);
    copyFileSync(join(ROOT, 'scripts', 'run-shard.sh'), join(dir, 'scripts', 'run-shard.sh'));
    const script = (path: string, body: string) => { writeFileSync(path, '#!/usr/bin/env bash\n' + body + '\n'); chmodSync(path, 0o755); };
    script(join(dir, 'scripts', 'build-gbrain-image.sh'), 'exit 0');
    script(join(bin, 'sleep'), '[ "$1" = 300 ] && exit 1\nexec /bin/sleep "$@"');
    script(join(bin, 'docker'), `if [ "$1 $2" = "image inspect" ]; then echo "${NEW}"; fi\nexit 0`);
    script(join(bin, 'bun'), `echo "$*" >> '${logs}/bun'\ncase " $* " in *" leak-preflight "*) echo "LEAK: fake"; exit ${leakExit} ;; esac\nexit 0`);
    writeFileSync(join(dir, 'prereg.json'), JSON.stringify({ run_id: 'resume-leak-test', cells: [{ id: 'r', harness: 'hermes', split: 'dev', gbrain: { brain: 'member', ingest: 'live', scope: 'member-sources' } }] }));
    writeFileSync(join(dir, '.gitignore'), '.fake-bin/\nresults/\n');
    const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
    git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fixture');
    const out = join(dir, 'results', 'resume-leak-test');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'shard.json'), JSON.stringify({ name: 's', commit: git('rev-parse', 'HEAD').stdout.trim(), cells: 'r', images: {} }));
    writeFileSync(join(out, 'manifest.json'), '{}');
    writeFileSync(join(out, 'preflight.log'), 'PREFLIGHT: ok run=resume-leak-test trials=1\n');
    const p = spawnSync('bash', ['--noprofile', '--norc', join(dir, 'scripts', 'run-shard.sh'), '--prereg', 'prereg.json', '--name', 's', '--cells', 'r', '--lease-usd', '1', '--resume', '--skip-build'],
      { cwd: dir, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: mkdtempSync(join(tmp, 'home-')) } });
    const bun = existsSync(join(logs, 'bun')) ? readFileSync(join(logs, 'bun'), 'utf8').split('\n').filter(Boolean) : [];
    return { status: p.status, stderr: p.stderr, bun, out };
  }

  test('a resume whose preflight is skipped runs leak-preflight for its cells before run, and no preflight under the closed lease', () => {
    const r = resume(0);
    const leak = r.bun.findIndex((l) => l.startsWith('runner/run.ts leak-preflight '));
    const run = r.bun.findIndex((l) => l.startsWith('runner/run.ts run '));
    expect(r.stderr).toContain('preflight skipped');
    expect(leak).toBeGreaterThanOrEqual(0);
    expect(r.bun[leak]).toContain('--manifest results/resume-leak-test/manifest.json --cells r --gbrain-image harness-eval/gbrain:dev');
    expect(run).toBeGreaterThan(leak);
    expect(r.bun.some((l) => l.startsWith('runner/run.ts preflight '))).toBe(false);
    expect(readFileSync(join(r.out, 'leak-preflight-resume.log'), 'utf8')).toContain('LEAK: fake');
  }, 60_000);

  test('a failed leak preflight on resume stops the shard with exit 2 before run', () => {
    const r = resume(3);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('leak preflight on resume failed; no trial ran');
    expect(r.bun.some((l) => l.startsWith('runner/run.ts run '))).toBe(false);
  }, 60_000);
});
