// internal-task: scripts/prompt-archaeology/joint-gate.ts on synthetic probe trials. Family at l2, at l3 and out; fewer than 3
// families; a pair above 80 or below 20 percent dropping alone; the shared claude-code full arm; a short probe and a cell with no
// scored trial; smoke rows, a foreign run id and a foreign commit refused; the 15, 85, 20 and 80 percent boundaries; dropped
// tasks; the validity drop (unknown families count unmatched); P5 with --with-secondary; prereg checks; the CLI with --check.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TrialRecord } from '../runner/contracts.ts';
import type { AblationReceipt } from '../runner/proxy/ablate.ts';
import { trialKey } from '../runner/trial/proxy.ts';
import {
  FAMILIES, HARN33_PREREG, JOINT_LAYERS, LEVELS, MODEL_TAGS, PAIRS, PROBE_RUN_ID, RUN_ID, armOf, cellOf, decide, familyInBand, harn33MinimalLayers, pairBand,
  parseCell, validityCellOf, type Family, type GateInput, type Level,
} from '../scripts/prompt-archaeology/joint-gate.ts';

const ROOT = join(import.meta.dir, '..');
const COMMIT = 'c'.repeat(40);
const MINIMAL = harn33MinimalLayers(JSON.parse(readFileSync(join(ROOT, HARN33_PREREG), 'utf8')));
const PRIMARY = ['claude-code-opus-full', 'openclaw-opus-full', 'codex-sol-full'];
const CUTS = ['claude-code-opus-joint', 'claude-code-opus-minimal', 'openclaw-opus-minimal', 'codex-sol-no-identity'];
const tasksOf = (f: Family, l: Level) => [0, 1, 2, 3].map((k) => f + '-' + String((l === 'l2' ? 5 : 9) + k).padStart(2, '0') + '-' + l + '-synthetic');

function trial(cell: string, task: string, rep: number, passed: boolean, termination: TrialRecord['termination'] = 'completed', runId = PROBE_RUN_ID): TrialRecord {
  const c = parseCell(cell);
  return {
    trial_id: runId + '/' + cell + '/' + task + '/r' + rep, cell, task, harness: c?.harness ?? 'claude-code', harness_mode: 'docker', model: MODEL_TAGS[(c?.modeltag ?? 'opus') as 'opus'], script: null,
    termination, grade: passed ? 'pass' : 'fail', consent_violation: false, approval_stop: false, effects: [], predicates: [], cap_stop: false, turns: { planned: 3, run: 3, exits: [0, 0, 0] },
    usage: null, wall_ms: 1000, started_at: '2026-11-06T00:00:00Z', ended_at: '2026-11-06T00:00:01Z', paths: {},
  };
}
const receipt = (cell: string, task: string, o: { matched?: boolean; unknown?: boolean; housekeeping?: boolean } = {}): AblationReceipt => ({
  at: '2026-11-06T00:00:00.000Z', key: trialKey(PROBE_RUN_ID + '/' + cell + '/' + task + '/r1'), route: '/v1/messages', map_sha256: 'x', layers: [],
  family: o.housekeeping ? 'housekeeping' : o.unknown ? null : 'agent', kind: o.housekeeping ? 'utility' : o.unknown ? null : 'agent-turn', unknown_family: !!o.unknown && !o.housekeeping,
  expected: 1, layers_matched: [], removed_bytes: 0, removed: [], missing: [], changed: [], inserts: [], problems: [], did_not_take: o.matched === false, partial: false,
});

interface Spec {
  reps?: number;
  /** Passing trials per probe cell (of 4 tasks by reps), by arm, family and level; the first n (task, rep) slots pass. */
  passes?: (arm: string, f: Family, l: Level) => number;
  termination?: (cell: string, i: number) => TrialRecord['termination'];
  /** Unmatched receipts (of 20) per validity cell trial. */
  unmatched?: Record<string, number>;
  skipCells?: string[];
}
const half = () => 2;
function probe(s: Spec = {}) {
  const reps = s.reps ?? 1;
  const rows: TrialRecord[] = [];
  const cells: string[] = [];
  const planned: Array<{ cell: string; task: string }> = [];
  for (const arm of PRIMARY) for (const f of FAMILIES) for (const l of LEVELS) {
    const cell = cellOf(arm, f, l);
    cells.push(cell);
    const k = (s.passes ?? (() => 2 * reps))(arm, f, l);
    let i = 0;
    for (const task of tasksOf(f, l)) for (let rep = 1; rep <= reps; rep++, i++) {
      planned.push({ cell, task });
      if (!s.skipCells?.includes(cell)) rows.push(trial(cell, task, rep, i < k, s.termination?.(cell, i) ?? 'completed'));
    }
  }
  const ablation: AblationReceipt[] = [];
  const validityTasks = ['ar-05-l2-brackenwater-rate-hollis', 'er-05-l2-marrow-fieldworks-meeting-time', 'ms-05-l2-synthetic'];
  for (const arm of CUTS) {
    const cell = validityCellOf(arm);
    cells.push(cell);
    for (const task of validityTasks) {
      planned.push({ cell, task });
      rows.push(trial(cell, task, 1, true));
      const bad = s.unmatched?.[cell] ?? 0;
      for (let j = 0; j < 20; j++) ablation.push(receipt(cell, task, { matched: j >= bad }));
    }
  }
  const prereg = { run_id: RUN_ID, cells: PAIRS.flatMap((p) => (['full', p.cut] as const).flatMap((a) => FAMILIES.flatMap((f) => LEVELS.map((l) => ({
    id: cellOf(armOf(p, a), f, l), ablation: { layers: a === 'full' ? [] : a === 'joint' ? JOINT_LAYERS : a === 'no-identity' ? ['identity'] : MINIMAL[p.harness + '-' + p.modeltag]! },
  }))))) };
  const input: GateInput = {
    rows, manifest: { run_id: PROBE_RUN_ID, cells: cells.map((id) => ({ id })), trials: planned }, shards: { cells: Object.fromEntries(cells.map((c) => [c, 'probe-a'])), shards: { 'probe-a': { commit: COMMIT } } },
    ablation, prereg, preregSha256: 'p'.repeat(64), commit: COMMIT, droppedTasks: [], withSecondary: false, minimalLayers: MINIMAL,
  };
  return input;
}
/** Per family and level, the passes of each primary arm's cell (4 tasks by reps). */
const table = (t: Partial<Record<Family, Partial<Record<Level, number | [number, number, number]>>>>) => (arm: string, f: Family, l: Level) => {
  const v = t[f]?.[l] ?? 0;
  return typeof v === 'number' ? v : v[PRIMARY.indexOf(arm)]!;
};

describe('joint gate: families', () => {
  test('a family runs at l2 in band, moves to l3 when l2 is out of band, and is out when neither is in band', () => {
    const d = decide(probe({ passes: table({ ar: { l2: 2 }, cr: { l2: 4, l3: 2 }, er: { l2: 0, l3: 0 }, ms: { l2: 1 }, ss: { l2: 3, l3: 3 } }) }));
    expect(Object.fromEntries(FAMILIES.map((f) => [f, d.families[f].level]))).toEqual({ cr: 'l3', ar: 'l2', er: 'out', ms: 'l2', ss: 'l2' });
    expect(d.families.cr).toEqual({ l2: { passes: 12, scored: 12 }, l3: { passes: 6, scored: 12 }, level: 'l3' });
    expect(d.families.er).toEqual({ l2: { passes: 0, scored: 12 }, l3: { passes: 0, scored: 12 }, level: 'out' });
    expect(d.gate).toBe('pass');
    expect(d.cells).toContain('claude-code-opus-full-v04-cr-l3');
    expect(d.cells.some((c) => c.includes('-er-') || c.endsWith('-cr-l2') || c.endsWith('-ar-l3'))).toBe(false);
  });

  test('fewer than 3 families in band fails the gate with an empty cell list', () => {
    const d = decide(probe({ passes: table({ ar: { l2: 2 }, ms: { l2: 2 } }) }));
    expect(d.gate).toBe('fail');
    expect(d.reason).toBe('fewer than 3 families in band: 2 (ar, ms)');
    expect(d.cells).toEqual([]);
  });

  test('the family band is strict at 15 and 85 percent, end to end at 60 pooled trials', () => {
    expect([familyInBand(3, 20), familyInBand(4, 20), familyInBand(16, 20), familyInBand(17, 20), familyInBand(0, 0)]).toEqual([false, true, true, false, false]);
    const d = decide(probe({ reps: 5, passes: table({ ar: { l2: [3, 3, 3], l3: [10, 10, 10] }, cr: { l2: [17, 17, 17], l3: [10, 10, 10] }, er: { l2: [4, 3, 3] }, ms: { l2: [16, 17, 17] }, ss: { l2: 10 } }) }));
    expect(d.families.ar.l2).toEqual({ passes: 9, scored: 60 });
    expect(d.families.cr.l2).toEqual({ passes: 51, scored: 60 });
    expect(Object.fromEntries(FAMILIES.map((f) => [f, d.families[f].level]))).toEqual({ cr: 'l3', ar: 'l3', er: 'l2', ms: 'l2', ss: 'l2' });
  });
});

describe('joint gate: pairs', () => {
  const inBand = { ar: { l2: 2 }, ms: { l2: 2 }, ss: { l2: 2 } };
  test('a pair above 80 percent is drop-ceiling and one below 20 is drop-floor, alone; the others run', () => {
    const up = decide(probe({ passes: table({ ar: { l2: [2, 2, 4] }, ms: { l2: [2, 2, 4] }, ss: { l2: [2, 2, 4] } }) }));
    expect(up.pairs.P4).toEqual({ full_passes: 12, full_scored: 12, rate: 1, status: 'drop-ceiling' });
    expect([up.pairs.P1!.status, up.pairs.P2!.status, up.pairs.P3!.status, up.gate]).toEqual(['run', 'run', 'run', 'pass']);
    expect(up.cells.some((c) => c.startsWith('codex'))).toBe(false);
    const down = decide(probe({ passes: table({ ar: { l2: [2, 2, 0] }, ms: { l2: [2, 2, 0] }, ss: { l2: [2, 2, 0] } }) }));
    expect(down.pairs.P4!.status).toBe('drop-floor');
    expect([down.pairs.P1!.status, down.pairs.P3!.status, down.gate]).toEqual(['run', 'run', 'pass']);
  });

  test('P1 and P2 share the claude-code full arm: the same counts, the same status, and its cells listed once', () => {
    const d = decide(probe({ passes: table(inBand) }));
    expect(d.pairs.P1).toEqual(d.pairs.P2!);
    const ccFull = d.cells.filter((c) => c.startsWith('claude-code-opus-full'));
    expect(ccFull).toEqual(['claude-code-opus-full-v04-ar-l2', 'claude-code-opus-full-v04-ms-l2', 'claude-code-opus-full-v04-ss-l2']);
    expect(d.cells.length).toBe(3 * 7);
    const ceiling = decide(probe({ passes: table({ ar: { l2: [4, 2, 2] }, ms: { l2: [4, 2, 2] }, ss: { l2: [4, 2, 2] } }) }));
    expect([ceiling.pairs.P1!.status, ceiling.pairs.P2!.status, ceiling.pairs.P3!.status]).toEqual(['drop-ceiling', 'drop-ceiling', 'run']);
    expect(ceiling.cells.some((c) => c.startsWith('claude-code'))).toBe(false);
  });

  test('the pair band is inclusive at 20 and 80 percent', () => {
    expect([pairBand(1, 5), pairBand(4, 5), pairBand(19, 100), pairBand(81, 100), pairBand(0, 0)]).toEqual(['run', 'run', 'drop-floor', 'drop-ceiling', 'drop-floor']);
    const at = (codex: number) => decide(probe({ reps: 5, passes: table({ ar: { l2: [10, 10, codex] }, ms: { l2: [10, 10, codex] }, ss: { l2: [10, 10, codex] } }) })).pairs.P4!;
    expect(at(4)).toEqual({ full_passes: 12, full_scored: 60, rate: 0.2, status: 'run' });
    expect(at(16)).toEqual({ full_passes: 48, full_scored: 60, rate: 0.8, status: 'run' });
    expect(at(3).status).toBe('drop-floor');
    expect(at(17).status).toBe('drop-ceiling');
  });

  test('no primary pair running fails the gate', () => {
    const d = decide(probe({ passes: table({ ar: { l2: [4, 4, 4], l3: [4, 4, 4] }, ms: { l2: [4, 4, 0] }, ss: { l2: [4, 4, 0] }, cr: { l2: [4, 4, 0] } }) }));
    expect(d.gate).toBe('fail');
    expect(d.reason).toBe('no primary pair runs: P1 drop-ceiling, P2 drop-ceiling, P3 drop-ceiling, P4 drop-floor');
  });

  test('dropped tasks leave the family pool and every pair\'s chosen set before the band check, and are listed sorted', () => {
    const base = probe({ reps: 1, passes: table({ ar: { l2: [2, 2, 1] }, ms: { l2: [2, 2, 1] }, ss: { l2: [2, 2, 1] } }) });
    const kept = decide(base);
    expect(kept.pairs.P4).toEqual({ full_passes: 3, full_scored: 12, rate: 0.25, status: 'run' });
    const firstTasks = (['ss', 'ar'] as Family[]).map((f) => tasksOf(f, 'l2')[0]!);
    const d = decide({ ...base, droppedTasks: [...firstTasks, firstTasks[0]!, 'cr-13-l4-unprobed'] });
    expect(d.pairs.P4).toEqual({ full_passes: 1, full_scored: 10, rate: 0.1, status: 'drop-floor' });
    expect(d.pairs.P1).toEqual({ full_passes: 4, full_scored: 10, rate: 0.4, status: 'run' });
    expect(d.dropped_tasks).toEqual(['ar-05-l2-synthetic', 'cr-13-l4-unprobed', 'ss-05-l2-synthetic']);
    expect([kept.families.ar.l2, kept.families.ss.l2, kept.families.ms.l2]).toEqual([{ passes: 5, scored: 12 }, { passes: 5, scored: 12 }, { passes: 5, scored: 12 }]);
    expect([d.families.ar.l2, d.families.ss.l2, d.families.ms.l2]).toEqual([{ passes: 2, scored: 9 }, { passes: 2, scored: 9 }, { passes: 5, scored: 12 }]);
    expect(() => decide({ ...base, droppedTasks: ['not a task'] })).toThrow('dropped task not a task is not a v0.4 task name');
  });

  test('dropping cr-08-l2-brackenwater-renewal-date changes the corrections family rate and moves corrections from l2 to l3', () => {
    const real = 'cr-08-l2-brackenwater-renewal-date';
    const base = probe({ passes: table({ cr: { l2: 3, l3: 2 }, ar: { l2: 2 }, ms: { l2: 2 }, ss: { l2: 2 } }) });
    const rename = <X extends { task: string }>(x: X) => (x.task === 'cr-08-l2-synthetic' ? { ...x, task: real } : x);
    const input = { ...base, rows: base.rows.map((t) => (t.task === 'cr-08-l2-synthetic' ? { ...t, task: real, trial_id: t.trial_id.replace('cr-08-l2-synthetic', real) } : t)), manifest: { ...base.manifest, trials: base.manifest.trials.map(rename) } };
    const kept = decide(input);
    expect(kept.families.cr).toEqual({ l2: { passes: 9, scored: 12 }, l3: { passes: 6, scored: 12 }, level: 'l2' });
    const d = decide({ ...input, droppedTasks: [real] });
    expect(d.families.cr).toEqual({ l2: { passes: 9, scored: 9 }, l3: { passes: 6, scored: 12 }, level: 'l3' });
    expect(d.cells).toContain('claude-code-opus-full-v04-cr-l3');
    expect(d.cells.some((c) => c.endsWith('-cr-l2'))).toBe(false);
  });

  test('a cut arm whose validity cell is under 95 percent fully matched is drop-validity; unknown families count unmatched and housekeeping not at all', () => {
    const base = probe({ passes: table(inBand), unmatched: { 'codex-sol-no-identity-v04-validity': 2, 'openclaw-opus-minimal-v04-validity': 1 } });
    const d = decide(base);
    expect(d.validity['codex-sol-no-identity-v04-validity']).toEqual({ agent_requests: 60, fully_matched: 54, share: 0.9, ok: false });
    expect(d.validity['openclaw-opus-minimal-v04-validity']).toEqual({ agent_requests: 60, fully_matched: 57, share: 0.95, ok: true });
    expect([d.pairs.P3!.status, d.pairs.P4!.status, d.gate]).toEqual(['run', 'drop-validity', 'pass']);
    const cell = 'claude-code-opus-joint-v04-validity';
    const extra = [...Array.from({ length: 4 }, () => receipt(cell, 'ar-05-l2-brackenwater-rate-hollis', { unknown: true })), ...Array.from({ length: 9 }, () => receipt(cell, 'ar-05-l2-brackenwater-rate-hollis', { housekeeping: true }))];
    const u = decide({ ...base, ablation: [...base.ablation, ...extra] });
    expect(u.validity[cell]).toEqual({ agent_requests: 64, fully_matched: 60, share: 60 / 64, ok: false });
    expect([u.pairs.P1!.status, u.pairs.P2!.status]).toEqual(['drop-validity', 'run']);
  });

  test('a cut arm with no validity receipts is not ok and its pair drops', () => {
    const base = probe({ passes: table(inBand) });
    const d = decide({ ...base, ablation: base.ablation.filter((l) => !l.key.includes('openclaw-opus-minimal')) });
    expect(d.validity['openclaw-opus-minimal-v04-validity']).toEqual({ agent_requests: 0, fully_matched: 0, share: null, ok: false });
    expect(d.pairs.P3!.status).toBe('drop-validity');
  });

  test('P5 is listed, as run, only with --with-secondary, and adds the openclaw-sol cells', () => {
    const base = probe({ passes: table(inBand) });
    expect(decide(base).pairs.P5).toBeUndefined();
    const d = decide({ ...base, withSecondary: true });
    expect(d.pairs.P5).toEqual({ full_passes: 0, full_scored: 0, rate: null, status: 'run' });
    expect(d.cells.filter((c) => c.startsWith('openclaw-sol'))).toEqual(['openclaw-sol-full-v04-ar-l2', 'openclaw-sol-full-v04-ms-l2', 'openclaw-sol-full-v04-ss-l2', 'openclaw-sol-minimal-v04-ar-l2', 'openclaw-sol-minimal-v04-ms-l2', 'openclaw-sol-minimal-v04-ss-l2']);
  });
});

describe('joint gate: short probes and refusals', () => {
  const inBand = table({ ar: { l2: 2 }, ms: { l2: 2 }, ss: { l2: 2 } });
  test('under 75 percent of planned probe trials scored fails the gate as short; exactly 75 percent does not', () => {
    const unscored = (n: number) => (cell: string, i: number) => (i < n && !cell.endsWith('validity') ? 'infra_error' as const : 'completed' as const);
    const short = decide(probe({ reps: 4, passes: () => 8, termination: unscored(5) }));
    expect(short.gate).toBe('fail');
    expect(short.reason).toBe('short: 330 of 480 planned probe trials scored (bound 75%)');
    expect(short.cells).toEqual([]);
    expect(decide(probe({ reps: 4, passes: () => 8, termination: unscored(4) })).reason.startsWith('short')).toBe(false);
  });

  test('a probe cell with no scored trial, or no trial at all, fails the gate as short', () => {
    const allErr = decide(probe({ passes: inBand, termination: (cell) => (cell === 'codex-sol-full-v04-ss-l3' ? 'model_error' : 'completed') }));
    expect(allErr.reason).toBe('short: probe cell(s) with no scored trial: codex-sol-full-v04-ss-l3');
    expect(decide(probe({ passes: inBand, skipCells: ['openclaw-opus-full-v04-cr-l2'] })).reason).toBe('short: probe cell(s) with no scored trial: openclaw-opus-full-v04-cr-l2');
  });

  test('smoke rows, a foreign run id and a foreign commit are refused, in trials and in receipts', () => {
    const base = probe({ passes: inBand });
    const row = base.rows[0]!;
    expect(() => decide({ ...base, rows: [...base.rows, { ...row, trial_id: row.trial_id + 'x', harness_mode: 'smoke' }] })).toThrow('smoke row: trial');
    expect(() => decide({ ...base, rows: [...base.rows, { ...row, trial_id: row.trial_id.replace(PROBE_RUN_ID, PROBE_RUN_ID + '-smoke-a') }] })).toThrow('smoke row: trial');
    expect(() => decide({ ...base, rows: [...base.rows, { ...row, trial_id: row.trial_id.replace(PROBE_RUN_ID, 'prompt-archaeology-2026-11') }] })).toThrow('foreign run id: trial prompt-archaeology-2026-11/');
    expect(() => decide({ ...base, rows: [...base.rows, { ...row, trial_id: row.trial_id.replace(PROBE_RUN_ID, RUN_ID) }] })).toThrow('foreign run id');
    expect(() => decide({ ...base, commit: 'd'.repeat(40) })).toThrow('foreign commit: trial ' + row.trial_id + ' ran at ' + COMMIT);
    expect(() => decide({ ...base, shards: { cells: { ...base.shards.cells, [row.cell]: 'probe-b' }, shards: { ...base.shards.shards, 'probe-b': { commit: 'e'.repeat(40) } } } })).toThrow('foreign commit');
    expect(() => decide({ ...base, shards: { ...base.shards, cells: {} } })).toThrow('ran at no recorded commit');
    const r = base.ablation[0]!;
    expect(() => decide({ ...base, ablation: [{ ...r, key: r.key.replace(PROBE_RUN_ID, 'prompt-archaeology-2026-11') }] })).toThrow('foreign run id: ablation receipt of');
    expect(() => decide({ ...base, rows: [...base.rows, row] })).toThrow('appears twice');
    expect(() => decide({ ...base, rows: [...base.rows, trial('claude-code-opus-full-mu-v03-dev', 'ar-05-l2-synthetic', 9, true)] })).toThrow('is not a joint-cut cell id');
  });

  test('a manifest or prereg of another run, a main cell the prereg lacks, and a cell with the wrong layers are refused', () => {
    const base = probe({ passes: inBand });
    expect(() => decide({ ...base, manifest: { ...base.manifest, run_id: RUN_ID } })).toThrow('manifest run id');
    expect(() => decide({ ...base, prereg: { ...base.prereg, run_id: PROBE_RUN_ID } })).toThrow('prereg run id');
    expect(() => decide({ ...base, prereg: { ...base.prereg, cells: base.prereg.cells.filter((c) => c.id !== 'codex-sol-no-identity-v04-ms-l2') } })).toThrow('prereg has no cell codex-sol-no-identity-v04-ms-l2');
    const wrong = base.prereg.cells.map((c) => (c.id === 'claude-code-opus-joint-v04-ar-l2' ? { ...c, ablation: { layers: ['memory-skills'] } } : c));
    expect(() => decide({ ...base, prereg: { ...base.prereg, cells: wrong } })).toThrow('prereg cell claude-code-opus-joint-v04-ar-l2 removes ["memory-skills"], not its arm\'s ["tool-descriptions","memory-skills"]');
    expect(MINIMAL['claude-code-opus']).toEqual(['identity', 'tool-guide', 'tool-descriptions', 'safety', 'memory-skills', 'work-habits', 'style']);
  });
});

describe('joint gate: CLI', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'he-joint-gate-'));
  const env = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: tmp };
  const write = (dir: string, i: GateInput) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'trials.jsonl'), i.rows.map((r) => JSON.stringify(r) + '\n').join(''));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(i.manifest));
    writeFileSync(join(dir, 'shards.json'), JSON.stringify(i.shards));
    writeFileSync(join(dir, 'probe-a.ablation.ndjson'), i.ablation.map((r) => JSON.stringify(r) + '\n').join(''));
    writeFileSync(join(dir, 'prereg.json'), JSON.stringify(i.prereg));
  };
  const cli = (dir: string, extra: string[] = [], commit = COMMIT) => spawnSync('bun', [join(ROOT, 'scripts', 'prompt-archaeology', 'joint-gate.ts'), '--trials', join(dir, 'trials.jsonl'), '--ablation', dir, '--commit', commit,
    '--prereg', join(dir, 'prereg.json'), '--out', join(dir, 'decision.json'), ...extra], { cwd: ROOT, encoding: 'utf8', env });

  test('a passing gate writes decision.json (exit 0) and --check rebuilds it byte for byte; a changed file fails --check', () => {
    const dir = join(tmp, 'pass');
    const input = probe({ passes: table({ ar: { l2: 2 }, ms: { l2: 2 }, ss: { l2: 2 } }) });
    write(dir, input);
    writeFileSync(join(dir, 'dropped.txt'), '# internal-task defects\n\nss-06-l2-synthetic\n');
    const r = cli(dir, ['--dropped-tasks', join(dir, 'dropped.txt'), '--with-secondary']);
    expect({ status: r.status, err: r.stderr }).toEqual({ status: 0, err: '' });
    expect(r.stdout).toContain('# Joint-cut gate: pass');
    const d = JSON.parse(readFileSync(join(dir, 'decision.json'), 'utf8'));
    expect(Object.keys(d)).toEqual(['schema_version', 'run_id', 'probe_run_id', 'commit', 'prereg_sha256', 'families', 'pairs', 'validity', 'gate', 'reason', 'cells', 'dropped_tasks']);
    expect(d.prereg_sha256).toBe(new Bun.CryptoHasher('sha256').update(readFileSync(join(dir, 'prereg.json'))).digest('hex'));
    expect(d.dropped_tasks).toEqual(['ss-06-l2-synthetic']);
    expect(Object.keys(d.pairs)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
    expect(cli(dir, ['--dropped-tasks', join(dir, 'dropped.txt'), '--with-secondary', '--check']).status).toBe(0);
    expect(cli(dir, ['--check']).status).toBe(1);
  });

  test('a failed gate still writes decision.json and exits 1; a refusal exits 2 and writes nothing', () => {
    const fail = join(tmp, 'fail');
    write(fail, probe({ passes: table({ ar: { l2: 2 } }) }));
    const r = cli(fail);
    expect(r.status).toBe(1);
    expect(JSON.parse(readFileSync(join(fail, 'decision.json'), 'utf8')).gate).toBe('fail');
    const refused = join(tmp, 'refused');
    write(refused, probe({ passes: table({ ar: { l2: 2 } }) }));
    const x = cli(refused, [], 'f'.repeat(40));
    expect(x.status).toBe(2);
    expect(x.stderr).toContain('joint-gate: refused: foreign commit');
    expect(existsSync(join(refused, 'decision.json'))).toBe(false);
  });
});
