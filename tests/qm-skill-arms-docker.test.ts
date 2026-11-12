// internal-task QM skill-resolver arms, keyless capture check in docker: scripts/skill-resolver/step0/qm/arms/qm-arms-check.ts
// on the Anthropic fake, one cell per arm (native with the resolver in shadow, emulated hook, pull via sandbox tool,
// no-catalog), plus its prepare.sh refusal and the shadow replay preflight on the arm image. $0: fakes only.
// Skips cleanly unless docker answers, the four arm images and the base images exist (build them with one run of the
// script without --skip-build) and the catalog is at ~/.capy/work/internal-task/catalog (or HE_SKILL_CATALOG).
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dir, '..');
const CATALOG = process.env.HE_SKILL_CATALOG ?? join(homedir(), '.capy/work/internal-task/catalog');
const IMAGES = ['harness-eval/qm:harn52-arm-catalog', 'harness-eval/qm:harn52-arm-pull', 'harness-eval/qm:harn52-arm-none', 'harness-eval/qm-sandbox:harn52-arm-pull', 'harness-eval/qm-sandbox:dev', 'pgvector/pgvector:0.8.1-pg16'];
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
const haveDocker = spawnSync('docker', ['info'], { env, stdio: 'ignore' }).status === 0;
const ready = haveDocker && existsSync(join(CATALOG, 'skills')) && IMAGES.every((i) => spawnSync('docker', ['image', 'inspect', i], { env, stdio: 'ignore' }).status === 0);

describe.if(ready)('QM skill-resolver arms capture check (docker, fakes)', () => {
  test('every arm passes its capture checks on the Anthropic fake', () => {
    const out = mkdtempSync(join(tmpdir(), 'he-qm-arms-'));
    const r = spawnSync('bun', [join(ROOT, 'scripts/skill-resolver/step0/qm/arms/qm-arms-check.ts'), '--skip-build', '--no-infra', '--providers', 'anthropic', '--catalog', CATALOG, '--out', out], { encoding: 'utf8', env, timeout: 1_500_000 });
    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')) as { all_pass: boolean; cells: Array<{ cell: string }>; shadow_replay: { pass: boolean }; prepare_refuses_wrong_image: { pass: boolean }; sandboxes_left_and_removed: string[] };
    expect(r.stdout).toContain('all_pass=true');
    expect(summary.all_pass).toBe(true);
    expect(summary.shadow_replay.pass).toBe(true);
    expect(summary.prepare_refuses_wrong_image.pass).toBe(true);
    expect(summary.cells.map((c) => c.cell)).toEqual(['qm-arm-anthropic-native', 'qm-arm-anthropic-push', 'qm-arm-anthropic-pull', 'qm-arm-anthropic-none']);
    expect(summary.sandboxes_left_and_removed).toEqual([]);
  }, 1_600_000);
});
