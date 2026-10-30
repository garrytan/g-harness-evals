// host-harness-pilot-2026-10 (internal-task): scripts/host-pilot-tables.ts recomputes the six preregistered comparisons with
// Holm over those six, excluding a pair with a model_error, infra_error or exam_fault trial on either side, and the
// published tables match the committed receipts. pass^5 needs every trial of a task scored, and the per-turn median is
// the median turn duration from turns.jsonl.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const RESULTS = join(ROOT, 'docs', 'benchmarks', '2026-10-30-host-harness-pilot', 'results');
const run = (results: string, out: string) => Bun.spawnSync(['bun', join(ROOT, 'scripts/host-pilot-tables.ts'), '--results', results, '--out', out], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
type Json = { comparisons: Array<{ n: number; p: number; holm_p: number; as_compare_run_p: number; n_pairs: number; excluded: unknown[]; ci95: [number, number]; verdict: string }> };

const CELLS: Record<string, string> = {
  'claude-code-haiku-none-mu-v03-dev': 'cc-none', 'openclaw-haiku-none-mu-v03-dev': 'oc-none', 'hermes-haiku-none-mu-v03-dev': 'he-none',
  'claude-code-haiku-gbrain-told-mu-v03-dev': 'cc-told', 'openclaw-haiku-gbrain-told-mu-v03-dev': 'oc-told', 'hermes-haiku-gbrain-told-mu-v03-dev': 'he-told',
  'codex-luna-none-mu-v03-dev': 'cx-luna', 'openclaw-luna-none-mu-v03-dev': 'oc-luna', 'hermes-luna-none-mu-v03-dev': 'he-luna',
};

describe('host-harness-pilot-2026-10 tables', () => {
  test('recomputing from the committed receipts gives the committed tables and the six figures the report quotes', () => {
    const out = mkdtempSync(join(tmpdir(), 'host-pilot-tables-'));
    try {
      const p = run(RESULTS, out);
      expect(p.exitCode).toBe(0);
      expect(readFileSync(join(out, 'host-pilot-tables.md'), 'utf8')).toBe(readFileSync(join(RESULTS, 'host-pilot-tables.md'), 'utf8'));
      const j = JSON.parse(readFileSync(join(out, 'host-pilot-tables.json'), 'utf8')) as Json;
      expect(j.comparisons.map((c) => c.p.toFixed(3))).toEqual(['1.000', '0.391', '0.234', '0.795', '0.375', '0.125']);
      expect(j.comparisons.map((c) => c.holm_p.toFixed(3))).toEqual(['1.000', '1.000', '1.000', '1.000', '1.000', '0.750']);
      expect(j.comparisons.map((c) => c.as_compare_run_p.toFixed(3))).toEqual(['1.000', '0.391', '0.234', '0.795', '0.625', '0.125']);
      expect(j.comparisons.map((c) => c.n_pairs)).toEqual([100, 100, 100, 100, 89, 100]);
      expect(j.comparisons.every((c) => c.verdict === 'not distinguished at 20 tasks (dev)')).toBe(true);
      const cells = (j as unknown as { per_cell: Array<{ cell: string; pass_hat_5: number; wall_s_per_turn: { point: number } }> }).per_cell;
      expect(cells.find((c) => c.cell === 'openclaw-luna-none-mu-v03-dev')!.pass_hat_5).toBe(7);
      expect(cells.find((c) => c.cell === 'claude-code-haiku-none-mu-v03-dev')!.wall_s_per_turn.point.toFixed(3)).toBe('7.613');
    } finally { rmSync(out, { recursive: true, force: true }); }
  }, 120_000);

  test('excluded pairs leave the comparison, a harness_error stays counted, Holm runs over the six only, and pass^5 and turn medians use complete tasks and real turn durations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'host-pilot-fixture-'));
    try {
      const rows: string[] = [];
      const trial = (cell: string, task: string, rep: string, termination: string, passes: boolean, turnSeconds: number[]) => {
        const trialDir = join(dir, 'trials', cell, task, rep);
        mkdirSync(trialDir, { recursive: true });
        const t0 = Date.parse('2026-10-30T00:00:00Z');
        let at = t0;
        writeFileSync(join(trialDir, 'turns.jsonl'), turnSeconds.map((s, i) => { const started = at; at += s * 1000; return JSON.stringify({ turn: i + 1, started_wall: new Date(started).toISOString(), ended_wall: new Date(at).toISOString() }); }).join('\n') + '\n');
        rows.push(JSON.stringify({
          trial_id: 'fixture/' + cell + '/' + task + '/' + rep, cell, task, termination, grade: passes ? 'pass' : 'fail', consent_violation: false,
          predicates: [], usage: { usd: 0.01, input_tokens: 100, output_tokens: 10, cached_tokens: 50 }, wall_ms: (at - t0) + 3000, turns: { planned: turnSeconds.length, run: turnSeconds.length, exits: turnSeconds.map(() => 0) },
        }));
      };
      for (const cell of Object.keys(CELLS)) {
        for (let k = 1; k <= 20; k++) {
          const task = 'si-' + String(k).padStart(2, '0');
          // Codex passes every task and the other two gpt-6-luna cells fail every task; the Haiku cells tie.
          // Excluded and must not count: OpenClaw gpt-6-luna si-01 r1 (model_error graded pass) and Codex si-02 r1 (infra_error).
          // Counted as a failure: OpenClaw Haiku none si-03 r1 (harness_error graded fail).
          const termination = cell === 'openclaw-luna-none-mu-v03-dev' && k === 1 ? 'model_error'
            : cell === 'codex-luna-none-mu-v03-dev' && k === 2 ? 'infra_error'
            : cell === 'openclaw-haiku-none-mu-v03-dev' && k === 3 ? 'harness_error' : 'completed';
          const passes = cell.startsWith('codex') || termination === 'model_error' || (cell.includes('haiku') && k % 2 === 0);
          // Unequal turns: 1 s, 1 s and 10 s plus 3 s of trial overhead, so wall over turns would give 5 s, not 1 s.
          trial(cell, task, 'r1', termination, passes, [1, 1, 10]);
        }
        // si-01 r2 everywhere: OpenClaw gpt-6-luna's si-01 is then incomplete (r1 excluded) with one scored pass.
        trial(cell, 'si-01', 'r2', 'completed', cell.startsWith('codex') || cell === 'openclaw-luna-none-mu-v03-dev', [1, 1, 10]);
        // si-20 r2 to r5 everywhere: Codex's si-20 is then a genuine five-pass task; its other tasks pass but are short of five.
        for (const r of ['r2', 'r3', 'r4', 'r5']) trial(cell, 'si-20', r, 'completed', cell.startsWith('codex'), [1, 1, 10]);
      }
      writeFileSync(join(dir, 'trials.jsonl'), rows.join('\n') + '\n');
      writeFileSync(join(dir, 'shards.json'), JSON.stringify({ cells: CELLS }));
      for (const shard of Object.values(CELLS)) writeFileSync(join(dir, shard + '.proxy-usage.ndjson'), JSON.stringify({ key: 'trial-token:x', route: '/v1/messages', model: 'm', outcome: 'forwarded', status: 200 }) + '\n');
      const p = run(dir, dir);
      expect(p.exitCode).toBe(0);
      const j = JSON.parse(readFileSync(join(dir, 'host-pilot-tables.json'), 'utf8')) as Json & { per_cell: Array<{ cell: string; pass_hat_5: number; pass_at_5: number; tasks_short_of_5: string[]; wall_s_per_turn: { point: number } }> };
      const [one, , , , five, six] = j.comparisons as [Json['comparisons'][number], unknown, unknown, unknown, Json['comparisons'][number], Json['comparisons'][number]];
      expect(one.n_pairs).toBe(25);
      expect(one.excluded).toHaveLength(0);
      expect(five.n_pairs).toBe(23);
      expect(five.excluded).toHaveLength(2);
      expect(six.n_pairs).toBe(24);
      expect(six.excluded).toHaveLength(1);
      expect(five.p).toBeCloseTo(2 ** -17, 12);
      expect(six.p).toBeCloseTo(2 ** -18, 12);
      expect(six.holm_p).toBeCloseTo(6 * 2 ** -18, 12);
      expect(five.holm_p).toBeCloseTo(5 * 2 ** -17, 12);
      expect([five.verdict, six.verdict]).toEqual(['B higher (dev)', 'B higher (dev)']);
      expect(j.comparisons.slice(1, 4).map((c) => [c.p, c.holm_p, c.verdict])).toEqual(Array(3).fill([1, 1, 'not distinguished at 20 tasks (dev)']));
      const ocLuna = j.per_cell.find((c) => c.cell === 'openclaw-luna-none-mu-v03-dev')!;
      expect([ocLuna.pass_hat_5, ocLuna.pass_at_5]).toEqual([0, 1]);
      const codex = j.per_cell.find((c) => c.cell === 'codex-luna-none-mu-v03-dev')!;
      expect([codex.pass_hat_5, codex.pass_at_5]).toEqual([1, 19]);
      expect(codex.tasks_short_of_5).toHaveLength(19);
      expect(j.per_cell.every((c) => c.wall_s_per_turn.point === 1)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
