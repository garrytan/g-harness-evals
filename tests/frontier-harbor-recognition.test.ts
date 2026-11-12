// Keyless check of recognition.ts: an unrecognized_model line, a compaction below the threshold and a trial with no agent
// log each stop the run; a trial that compacts near its 1M window, or never, does not.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { scanRecognition } from '../scripts/frontier-harbor/recognition.ts';

const ROOT = resolve(import.meta.dir, '..');
const LOG_2_1_312 = join(ROOT, 'docs/benchmarks/2026-11-09-fable-5-2-coding/results/hidden-test-rejections/fable52-r1h1-pytorch-model-cli-a1/claude-code.txt');
const tmp = mkdtempSync(join(tmpdir(), 'frontier-recognition-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const assistant = (context: number) => JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: context - 1002, output_tokens: 10 } } });
const compact = (pre: number) => JSON.stringify({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: pre } });

describe('recognition.ts', () => {
  const rows: object[] = [];
  const put = (id: string, model: string, files: Record<string, string> | null, copy?: string) => {
    const dir = join(tmp, 'trials', id);
    mkdirSync(join(dir, 'harbor'), { recursive: true });
    if (copy) { mkdirSync(join(dir, 'harbor', 'agent'), { recursive: true }); copyFileSync(copy, join(dir, 'harbor', 'agent', 'claude-code.txt')); }
    for (const [f, text] of Object.entries(files ?? {})) { mkdirSync(join(dir, 'harbor', 'agent', 'sessions'), { recursive: true }); writeFileSync(join(dir, 'harbor', 'agent', f), text); }
    rows.push({ trial_id: 'r/' + id, cell: id.split('-')[0], model, paths: { trial_dir: 'trials/' + id } });
  };
  put('old-1', 'anthropic:claude-fable-5-2', null, LOG_2_1_312);
  put('early-1', 'anthropic:claude-fable-5-2', { 'claude-code.txt': [assistant(150000), compact(167000), assistant(40000)].join('\n') });
  put('late-1', 'anthropic:claude-fable-5-2', { 'claude-code.txt': [assistant(960000), compact(967000)].join('\n'), 'sessions/s.jsonl': JSON.stringify({ type: 'system', subtype: 'compact_boundary', compactMetadata: { preTokens: 967000 } }) });
  put('clean-1', 'anthropic:claude-fable-5-2', { 'claude-code.txt': [assistant(12000), assistant(250000)].join('\n') });
  put('nolog-1', 'anthropic:claude-fable-5-2', null);
  put('opus-1', 'anthropic:claude-opus-5-5', { 'claude-code.txt': assistant(5000) });
  put('odd-1', 'anthropic:claude-fable-5-2', { 'claude-code.txt': [assistant(300000), JSON.stringify({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto' } })].join('\n') });
  writeFileSync(join(tmp, 'trials.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  test('stops on the committed 2.1.312 log, an early compaction and a missing log; passes a late compaction and none', () => {
    const s = scanRecognition([tmp]);
    const by = Object.fromEntries(s.trials.map((t) => [t.trial_id, t]));
    expect(by['r/old-1']!.unrecognized_lines).toBeGreaterThan(0);
    expect(by['r/old-1']!.stops).toEqual(['unrecognized_model']);
    expect(by['r/early-1']!.compactions).toEqual([167000]);
    expect(by['r/early-1']!.stops).toEqual(['compaction below 900000']);
    expect(by['r/early-1']!.peak_context_tokens).toBe(150000);
    expect(by['r/late-1']!.compactions).toEqual([967000]);
    expect(by['r/late-1']!.stops).toEqual([]);
    expect(by['r/clean-1']!.compactions).toEqual([]);
    expect(by['r/clean-1']!.peak_context_tokens).toBe(250000);
    expect(by['r/clean-1']!.stops).toEqual([]);
    expect(by['r/nolog-1']!.stops).toEqual(['no agent log']);
    expect(by['r/odd-1']!.stops).toEqual(['compaction with unreadable pre_tokens']);
    expect(s.by_cell.late).toEqual({ trials: 1, unrecognized: 0, compacted: 1, compacted_early: 0, stopped: 0 });
  });

  test('--model scans only that model, and the command exits 1 naming each trial that stops the run', () => {
    expect(scanRecognition([tmp], 900000, 'anthropic:claude-opus-5-5').trials.map((t) => t.trial_id)).toEqual(['r/opus-1']);
    const run = (...a: string[]) => spawnSync('bun', [join(ROOT, 'scripts/frontier-harbor/recognition.ts'), '--out', join(tmp, 'scan.json'), ...a], { env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8' });
    const all = run(tmp);
    expect(all.status).toBe(1);
    expect(all.stdout).toContain('STOP r/early-1: compaction below 900000');
    expect(run('--model', 'anthropic:claude-opus-5-5', tmp).status).toBe(0);
    const empty = join(tmp, 'empty');
    mkdirSync(empty, { recursive: true });
    writeFileSync(join(empty, 'trials.jsonl'), '');
    expect(run(empty).status).toBe(1);
  });

  test('--jobs scans a running shard\'s finished Harbor trials, by the model in their config.json', () => {
    const jobs = join(tmp, 'run', 'jobs');
    const trial = (job: string, name: string, model: string, log: string | null, finished = true) => {
      const dir = join(jobs, job, name);
      mkdirSync(join(dir, 'agent'), { recursive: true });
      writeFileSync(join(dir, 'config.json'), JSON.stringify({ task: { path: '/run/tasks/t' }, agent: { model_name: model, kwargs: { cell: 'fable52-r1h1', attempt: 1 } } }));
      if (log !== null) writeFileSync(join(dir, 'agent', 'claude-code.txt'), log);
      if (finished) writeFileSync(join(dir, 'result.json'), '{}');
    };
    trial('j1', 'a__1', 'anthropic/claude-fable-5-2', [assistant(400000)].join('\n'));
    trial('j1', 'b__1', 'anthropic/claude-fable-5-2', [compact(167000)].join('\n'));
    trial('j1', 'c__1', 'anthropic/claude-fable-5-2', null, false);
    trial('j2', 'd__1', 'anthropic/claude-opus-5-5', '[claude-code:unrecognized_model] {}');
    trial('j2', 'e__1', 'anthropic/claude-fable-5-2', '[claude-code:unrecognized_model] {}');
    writeFileSync(join(jobs, 'j2', 'e__1', 'config.json'), '{not json');
    const s = scanRecognition([], 900000, 'anthropic:claude-fable-5-2', jobs);
    expect(s.trials.map((t) => [t.trial_id, t.stops])).toEqual([['j1/a__1', []], ['j1/b__1', ['compaction below 900000']], ['j2/e__1', ['unidentified trial (config.json unreadable or names no model)', 'unrecognized_model']]]);
    expect(s.trials[0]!.peak_context_tokens).toBe(400000);
  });
});
