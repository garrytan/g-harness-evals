// The gbrain install run's post-run audit scripts (docs/benchmarks/2026-11-17-gbrain-install/results/audits/scripts) and its local
// prune script, run end to end on a small run folder built from two committed trials: a Codex run that recalled and a Hermes run that
// never got a gbrain binary. audit1.py and run-brains.sh need the raw archive and pglite, so only their arguments are checked here.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const RES = join(ROOT, 'docs/benchmarks/2026-11-17-gbrain-install/results');
const SCRIPTS = join(RES, 'audits/scripts');
const RUN_ID = 'gbrain-install-2026-11';
const TRIALS = [`${RUN_ID}/codex-sol-bare-gbrain-install/gbrain-install/r1`, `${RUN_ID}/hermes-opus-bare-gbrain-install/gbrain-install/r1`];
const ENV = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: tmpdir() };
const run = (cmd: string, args: string[], cwd = ROOT) => spawnSync(cmd, args, { cwd, env: ENV, encoding: 'utf8' });
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

function fixtureRun(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gbrain-audits-'));
  const records = readFileSync(join(RES, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => TRIALS.includes(r.trial_id));
  expect(records.length).toBe(2);
  mkdirSync(join(dir, 'run/merged'), { recursive: true });
  mkdirSync(join(dir, 'run/readers'), { recursive: true });
  writeFileSync(join(dir, 'run/merged/trials.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(dir, 'run/readers/cell-shard.txt'), records.map(r => `${r.cell} s01`).join('\n') + '\n');
  for (const t of TRIALS) {
    const rel = t.slice(RUN_ID.length + 1);
    cpSync(join(RES, 'trials', rel), join(dir, 'run/lite/s01/results/trials', rel), { recursive: true });
  }
  mkdirSync(join(dir, 'audits/scratch'), { recursive: true });
  return dir;
}

describe('gbrain install audit scripts', () => {
  test('every script refuses to run without its folders', () => {
    for (const s of ['recall-events.ts', 'save-events.ts', 'audit2.ts', 'audit3.ts', 'audit3-noversion.ts']) {
      const r = run('bun', [join(SCRIPTS, s)]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('usage: bun ' + s);
    }
    for (const s of ['audit1.py', 'make-md.py']) expect(run('python3', [join(SCRIPTS, s)]).stderr).toContain('usage: python3 ' + s);
    expect(run('bash', [join(SCRIPTS, 'run-brains.sh')]).status).toBe(2);
    for (const f of [...['recall-events.ts', 'save-events.ts', 'audit1.py', 'audit2.ts', 'audit3.ts', 'audit3-noversion.ts', 'make-md.py', 'run-brains.sh', 'brain-dump.ts'].map(s => join(SCRIPTS, s))])
      expect(readFileSync(f, 'utf8')).not.toContain('<controller-work>');
  });

  test('recall, save, audit 2 and audit 3 run on a fresh checkout and a run folder', () => {
    const dir = fixtureRun();
    const RUN = join(dir, 'run'), A = join(dir, 'audits'), S = join(A, 'scratch');
    for (const [s, args] of [['recall-events.ts', [RUN, S]], ['save-events.ts', [S]], ['audit2.ts', [RUN, A]], ['audit3.ts', [RUN, A]], ['audit3-noversion.ts', [RUN, A]]] as const) {
      const r = run('bun', [join(SCRIPTS, s), ...args]);
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
    }
    const recalls = json(join(S, 'recall-events.json'));
    expect(recalls.map((t: any) => t.trial_id)).toEqual([TRIALS[0]]);
    expect(recalls[0].credited.length).toBeGreaterThan(0);
    expect(json(join(S, 'save-events.json')).map((t: any) => t.trial_id)).toEqual([TRIALS[0]]);
    const a2 = json(join(A, 'audit2.json'));
    expect(a2.recalled_trials).toBe(1);
    expect(a2.credited_through_bare_number_pipe).toEqual([]);
    const a3 = json(join(A, 'audit3.json'));
    const hermes = a3.trials.find((t: any) => t.trial_id === TRIALS[1]);
    expect(hermes.recount.no_version_seen).toBe(true);
    expect(a3.edge_checks.no_version_runs_transcript_check.map((t: any) => t.trial_id)).toEqual([TRIALS[1]]);
  });

  test('recall-events.ts and audit3.ts take relative folders and create the scratch folder', () => {
    const dir = fixtureRun();
    rmSync(join(dir, 'audits'), { recursive: true, force: true });
    const recall = run('bun', [join(SCRIPTS, 'recall-events.ts'), 'run', 'audits/scratch'], dir);
    expect(recall.stderr).toBe('');
    expect(recall.status).toBe(0);
    expect(json(join(dir, 'audits/scratch/recall-events.json')).map((t: any) => t.trial_id)).toEqual([TRIALS[0]]);
    const a3 = run('bun', [join(SCRIPTS, 'audit3.ts'), 'run', 'audits'], dir);
    expect(a3.stderr).toBe('');
    expect(a3.status).toBe(0);
    expect(existsSync(join(dir, 'audits/audit3.json'))).toBe(true);
  });

  test('run-brains.sh skips a shard with no recalled trials and leaves PGLITE_TOOLS untouched', () => {
    const dir = fixtureRun();
    const tools = join(dir, 'tools');
    mkdirSync(join(tools, 'node_modules'), { recursive: true });
    writeFileSync(join(dir, 'audits/scratch/recall-events.json'), JSON.stringify([{ trial_id: TRIALS[0], shard: 's01', cell: 'c', rn: 'r1', nonce: 'n' }]));
    const r = spawnSync('bash', [join(SCRIPTS, 'run-brains.sh'), 'run', 'audits', 's05'], { cwd: dir, env: { ...ENV, PGLITE_TOOLS: 'tools' }, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('s05: no recalled trials, skipped');
    expect(readdirSync(tools)).toEqual(['node_modules']);
    expect(existsSync(join(dir, 'audits/scratch/x'))).toBe(false);
    expect(existsSync(join(dir, 'audits/scratch/tools/brain-dump.ts'))).toBe(true);
  });

  test('make-md.py rebuilds the published AUDITS.md from the committed audit files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-audits-md-'));
    for (const f of ['audit1.json', 'audit2.json', 'audit3.json']) cpSync(join(RES, 'audits', f), join(dir, f));
    const r = run('python3', [join(SCRIPTS, 'make-md.py'), dir]);
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'AUDITS.md'), 'utf8')).toBe(readFileSync(join(RES, 'audits/AUDITS.md'), 'utf8'));
  });
});

describe('prune-local.sh', () => {
  test('removes package caches by NUL-separated path, so a newline in a folder name reaches rm as one path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-prune-'));
    const state = join(dir, 's01/results/trials/cell/gbrain-install/r1/state');
    mkdirSync(join(state, 'node_modules/x'), { recursive: true });
    mkdirSync(join(state, 'odd\nname/.cache'), { recursive: true });
    mkdirSync(join(state, 'odd'), { recursive: true });
    mkdirSync(join(state, '.gbrain'), { recursive: true });
    writeFileSync(join(state, '.gbrain/brain'), 'kept');
    writeFileSync(join(state, 'odd/kept'), 'kept');
    const r = run('bash', [join(RES, 'ops/prune-local.sh'), join(dir, 's01')]);
    expect(r.status).toBe(0);
    expect(existsSync(join(state, 'node_modules'))).toBe(false);
    expect(existsSync(join(state, 'odd\nname/.cache'))).toBe(false);
    expect(readFileSync(join(state, 'odd/kept'), 'utf8')).toBe('kept');
    expect(readFileSync(join(state, '.gbrain/brain'), 'utf8')).toBe('kept');
    expect(readFileSync(join(dir, 's01/state-pruned-local.txt'), 'utf8')).toContain('node_modules');
  });
});
