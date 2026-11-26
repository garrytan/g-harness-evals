// The gbrain first-wow counted-run analysis (scripts/gbrain-first-wow/analyze.ts): how a trial record becomes a verdict row under the
// plan's exclusions, safety-filter stops from the proxy's usage lines, and the coding check's pairs. Keyless; synthetic records only.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NEvent } from '../scripts/gbrain-install/transcript.ts';
import { codingPairs, labelOf, rowFor, safetyStops } from '../scripts/gbrain-first-wow/analyze.ts';
import { rescore, type Rec } from '../scripts/gbrain-first-wow/pilot-summary.ts';
import { buildFixture, personaFor } from '../scripts/gbrain-first-wow/fixtures.ts';

const rec = (o: { arm?: string; termination?: string; question_ms?: number | null; harness?: string; task?: string; trial?: string; coding?: boolean | null } = {}): Rec => ({
  trial_id: o.trial ?? 'run/cell/' + (o.task ?? 'seed-0001') + '/r1', cell: 'cell', task: o.task ?? 'seed-0001', harness: o.harness ?? 'claude-code', model: 'anthropic:claude-opus-5-5',
  termination: o.termination ?? 'completed', usage: { usd: 0.1 }, paths: { dir: '/nowhere' },
  first_wow: { arm: (o.arm ?? 'full') as Rec['first_wow']['arm'], persona: 'messy', sessions_imported: 4, brain_pages: 9, registration: { ok: true }, image_record: '', setup: [], setup_ms: 20000,
    question_ms: o.question_ms === undefined ? 30000 : o.question_ms, person_needed: 0, turns: [{ turn: 1 }],
    ...(o.coding !== undefined ? { coding: { task: 'coding-01', grade: o.coding === null ? null : { passed: o.coding, pass: 3, fail: o.coding ? 0 : 1 } } } : {}) },
});
const ev = (input: string, kind: NEvent['kind'] = 'shell'): NEvent => ({ kind, name: 'bash', input, output: '', is_error: false, exit_code: 0, session: 's', turn: 1 });

describe('first-wow analysis rows', () => {
  test('a completed trial carries its score, its setup-inclusive time and its harness/model label', () => {
    const r = rowFor(rec(), { finish_any: true, commands: 5 }, [], 1, 'messy', false);
    expect(r).toMatchObject({ harness: 'claude-code/claude-opus-5-5', finish: true, time_ms: 30000, total_ms: 50000, commands: 5, timed_out: false });
    expect(r.excluded).toBeUndefined();
    expect(labelOf('qm', 'particle:particle-1')).toBe('qm/particle-1');
  });
  test('a timeout is a miss counted at the 600 s cap, and a harness error is a miss, whatever the scorer said', () => {
    const t = rowFor(rec({ termination: 'timeout', question_ms: 640000 }), { finish_any: true }, [], 1, 'messy', false);
    expect(t).toMatchObject({ finish: false, time_ms: 600000, timed_out: true });
    expect(t.excluded).toBeUndefined();
    expect(rowFor(rec({ termination: 'harness_error' }), { finish_any: true }, [], 1, 'messy', false).finish).toBe(false);
  });
  test('model, infra and exam faults, safety-filter stops and contaminated plain trials are excluded and say why', () => {
    for (const t of ['model_error', 'infra_error', 'exam_fault']) expect(rowFor(rec({ termination: t }), null, [], 1, 'messy', false).excluded).toBe(t);
    expect(rowFor(rec(), { finish_any: true }, [], 1, 'messy', true).excluded).toBe('safety_filter');
    expect(rowFor(rec({ arm: 'plain' }), { finish_any: true }, [ev('cat ~/.local/share/gstack/SKILL.md')], 1, 'messy', false).excluded).toBe('contaminated');
    expect(rowFor(rec({ arm: 'plain' }), { finish_any: true }, [ev('rg 5432 ~/.claude')], 1, 'messy', false).excluded).toBeUndefined();
    expect(rowFor(rec({ arm: 'full' }), { finish_any: true }, [ev('gbrain query staging')], 1, 'messy', false).excluded).toBeUndefined();
  });
  test('a no-history trial has no finish line and keeps its abstention and fallback', () => {
    const r = rowFor(rec(), { correct_abstention: true, fallback_shown: false }, [], 9000, 'no-history', false);
    expect(r).toMatchObject({ finish: null, correct_abstention: true, fallback_shown: false });
  });
});

describe('first-wow analysis inputs', () => {
  test('safety-filter stops are read from every shard usage log by trial key', () => {
    const d = mkdtempSync(join(tmpdir(), 'fw-an-'));
    writeFileSync(join(d, 's1.proxy-usage.ndjson'), JSON.stringify({ key: 'trial-token:run/a/seed-0001/r1', outcome: 'forwarded', safety_stop: 'stop_reason:refusal' }) + '\n' + JSON.stringify({ key: 'trial-token:run/b/seed-0001/r1', outcome: 'forwarded' }) + '\n');
    writeFileSync(join(d, 'proxy-usage.ndjson'), JSON.stringify({ key: 'trial-token:run/c/seed-0002/r1', safety_stop: 'finish_reason:content_filter' }) + '\n');
    expect([...safetyStops(d)].sort()).toEqual(['run/a/seed-0001/r1', 'run/c/seed-0002/r1']);
  });
  test('a safety-filter stop is reported as itself even when the trial also ended in an error', () => {
    for (const t of ['model_error', 'harness_error', 'completed']) expect(rowFor(rec({ termination: t }), { finish_any: true }, [], 1, 'messy', true).excluded).toBe('safety_filter');
  });
  test('coding pairs match defaults and full by harness and seed, and drop a pair with an excluded trial', () => {
    const recs = [
      rec({ arm: 'defaults', task: 'seed-0200', coding: true, trial: 'd200' }), rec({ arm: 'full', task: 'seed-0200', coding: false, trial: 'f200' }),
      rec({ arm: 'defaults', task: 'seed-0201', coding: true, trial: 'd201' }), rec({ arm: 'full', task: 'seed-0201', coding: true, termination: 'timeout', trial: 'f201' }),
      rec({ arm: 'defaults', task: 'seed-0202', coding: true, termination: 'model_error', trial: 'd202' }), rec({ arm: 'full', task: 'seed-0202', coding: true, trial: 'f202' }),
    ];
    const { pairs, excluded } = codingPairs(recs, new Set());
    expect(pairs).toEqual([{ harness: 'claude-code/claude-opus-5-5', seed: 200, defaults: true, full: false }, { harness: 'claude-code/claude-opus-5-5', seed: 201, defaults: true, full: false }]);
    expect(excluded).toEqual([{ harness: 'claude-code/claude-opus-5-5', trial: 'd202', reason: 'model_error' }]);
  });
});

describe('rescoring a merged sharded run', () => {
  test('reads each trial from the results directory, not the absolute path the shard VM recorded', () => {
    const results = mkdtempSync(join(tmpdir(), 'fw-merged-'));
    const f = buildFixture(1, personaFor(1), 'claude-code');
    const dir = join(results, 'trials', 'cell', 'seed-0001', 'r1');
    mkdirSync(join(dir, 'logs', 'turns'), { recursive: true });
    writeFileSync(join(dir, 'fixture.json'), JSON.stringify(f.manifest));
    writeFileSync(join(dir, 'logs', 'turns', 'turn-0001.reply.txt'), 'reply');
    const r = rec({ trial: 'run/cell/seed-0001/r1' });
    expect(r.paths.dir).toBe('/nowhere');
    const s = rescore(r, results);
    expect(s.manifest.seed).toBe(f.manifest.seed);
    expect(s.sessions_in_fixture).toBe(f.manifest.sessions.length);
    expect(() => rescore(r)).toThrow();
  });
});
