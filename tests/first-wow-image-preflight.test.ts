// runner/run.ts preflight for gbrain first-wow cells: every image a cell's trials run (the arm's image; on QM the sandbox base and,
// in qm-native, the Claude Code gbrain image the brain host runs) must be present, else HE-ADAPTER-005 before the first trial.
//
// Value: protects=a first-wow shard fails at preflight, naming the image and its build command, instead of at its first trial;
// fails_when=a missing gbrain-arm image, QM sandbox or brain host image passes preflight, or a present set is refused;
// why_new=preflight checked only harness-eval/<harness>:dev, never the images first-wow trials run; seam=a fake docker on PATH
// and a two-seed copy of the frozen preregistration; no_claim=the image contents (the trial checks /opt/first-wow/image.json).
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-fw-preflight-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const bin = join(tmp, 'bin');
mkdirSync(bin);
writeFileSync(join(bin, 'docker'), ['#!/usr/bin/env bash', 'if [ "$1 $2" = "image inspect" ]; then case " $MISSING " in *" ${@: -1} "*) exit 1 ;; esac; echo "sha256:fake"; exit 0; fi', 'exit 1'].join('\n') + '\n');
chmodSync(join(bin, 'docker'), 0o755);

const CELLS = ['qm-opus-native', 'qm-opus-plain', 'cc-opus-pr1'];
const src = JSON.parse(readFileSync(join(ROOT, 'docs', 'benchmarks', '2026-11-24-gbrain-first-wow', 'prereg.json'), 'utf8')) as Record<string, unknown> & { cells: Array<{ id: string }>; drop_order: string[]; minimum_v01: string[]; order: { blocks?: Array<{ cells: string[] }> } };
const prereg = { ...src, run_id: 'first-wow-preflight-test', cells: src.cells.filter((c) => CELLS.includes(c.id)).map((c) => ({ ...c, tasks: ['seed-0000'] })),
  drop_order: src.drop_order.filter((c) => CELLS.includes(c)), minimum_v01: src.minimum_v01.filter((c) => CELLS.includes(c)),
  order: { ...src.order, ...(src.order.blocks ? { blocks: src.order.blocks.map((b) => ({ ...b, cells: b.cells.filter((c) => CELLS.includes(c)) })).filter((b) => b.cells.length) } : {}) } };
writeFileSync(join(tmp, 'prereg.json'), JSON.stringify(prereg));
const env = (extra: Record<string, string> = {}) => ({ PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: tmp, ...extra });
const plan = spawnSync('bun', ['runner/run.ts', 'plan', '--prereg', join(tmp, 'prereg.json'), '--out', join(tmp, 'run')], { cwd: ROOT, env: env(), encoding: 'utf8' });
const preflight = (cells: string, missing: string) => spawnSync('bun', ['runner/run.ts', 'preflight', '--manifest', join(tmp, 'run', 'manifest.json'), '--cells', cells], { cwd: ROOT, env: env({ MISSING: missing }), encoding: 'utf8' });

describe('runner preflight: first-wow images', () => {
  test('plan accepts the copy', () => expect([plan.status, plan.stderr]).toEqual([0, '']));

  test('each missing image is refused with HE-ADAPTER-005, naming the cell, the image and how to build it', () => {
    const cases: Array<[string, string, string]> = [
      ['qm-opus-native', 'harness-eval/claude-code-gbrain:c341d40de3e5', 'bash harnesses/_first-wow/build.sh c341d40de3e5f7cacecb064825655ce926d877f8 0.60.774.0 claude-code'],
      ['qm-opus-plain', 'harness-eval/qm-sandbox:dev', 'docker build -q -f harnesses/qm/Dockerfile.sandbox'],
      ['qm-opus-plain', 'harness-eval/qm:dev', 'docker build -q -t harness-eval/qm:dev harnesses/qm'],
      ['cc-opus-pr1', 'harness-eval/claude-code-gbrain:c341d40de3e5', 'bash harnesses/_first-wow/build.sh c341d40de3e5f7cacecb064825655ce926d877f8 0.60.774.0 claude-code'],
    ];
    for (const [cell, image, fix] of cases) {
      const r = preflight(cell, image);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain(`HE-ADAPTER-005 cell ${cell}: image ${image}, which its first-wow trials run, is absent`);
      expect(r.stderr).toContain(fix);
    }
  }, 60_000);

  test('with every image present the check passes and says so', () => {
    const r = preflight('qm-opus-native,qm-opus-plain', '');
    expect(r.stdout).toContain('FIRSTWOW: cell qm-opus-native (qm-native) images harness-eval/qm:dev, harness-eval/qm-sandbox:dev, harness-eval/claude-code-gbrain:c341d40de3e5 present');
    expect(r.stdout).toContain('FIRSTWOW: cell qm-opus-plain (plain) images harness-eval/qm:dev, harness-eval/qm-sandbox:dev present');
    expect(r.stderr).not.toContain('HE-ADAPTER-005');
  }, 30_000);
});
