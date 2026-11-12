#!/usr/bin/env bun
// The recognition and compaction scan of fable-5-2-coding-cc322-2026-11: did Claude Code know the cell model, and did it
// compact the conversation early? Claude Code 2.1.312 logged `[claude-code:unrecognized_model]` for claude-fable-5-2 and
// compacted at about 167K tokens, the point for a 200K window; a release that knows the model's 1M window compacts at
// about 967K. This is the preregistered hard stop on the recognition smoke and the canary, and the per-arm counts at the end.
//
//   bun scripts/frontier-harbor/recognition.ts [--min-pre-tokens 900000] [--model <provider:model>] --out <scan.json> <results dir> [...]
//   bun scripts/frontier-harbor/recognition.ts [--min-pre-tokens 900000] [--model <provider:model>] --out <scan.json> --jobs <shard results>/run/jobs
//
// It reads every file under each trial's harbor/agent/ directory (Claude Code's stream-json output and debug output),
// over the records of each results dir's trials.jsonl, like refusals.ts. With --jobs it reads a running shard's raw Harbor
// trial directories instead (<jobs>/<job>/<trial>, before to-trials.ts writes trials.jsonl at the shard's end): every
// trial that has finished (its result.json exists), its cell and model from its config.json. A finished trial whose
// config.json cannot be read or names no model is scanned whatever --model says, and stops the run. Per trial it counts lines that contain
// unrecognized_model, lists the pre_tokens of every compact_boundary event (stream-json compact_metadata.pre_tokens, or a
// session file's compactMetadata.preTokens), and the peak context of any assistant message (input, cache write and cache
// read tokens of its usage). A trial stops the run when it has an unrecognized_model line, a compaction below
// --min-pre-tokens, a compact_boundary event whose pre_tokens cannot be read, or no agent log at all (nothing to scan
// is not a pass). It writes { min_pre_tokens, trials, by_cell }
// and exits 1 when any scanned trial stops the run, naming them; --model scans only that model's records.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type TrialLine = { trial_id: string; cell: string; model: string; paths?: Record<string, string> };
export interface RecognitionScan { logs: number; unrecognized_lines: number; compactions: number[]; unreadable_compactions: number; peak_context_tokens: number | null }
export interface RecognitionRow extends RecognitionScan { trial_id: string; cell: string; stops: string[] }

const files = (dir: string): string[] => !existsSync(dir) ? [] : readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });

export function scanTrial(trialDir: string): RecognitionScan {
  const logs = files(join(trialDir, 'agent'));
  let unrecognized = 0, unreadable = 0, peak: number | null = null;
  const pre = new Set<number>();
  for (const f of logs) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (line.includes('unrecognized_model')) unrecognized++;
      if (!line.includes('compact') && !line.includes('usage')) continue;
      let ev: any;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev?.type === 'system' && ev.subtype === 'compact_boundary') {
        const t = ev.compact_metadata?.pre_tokens ?? ev.compactMetadata?.preTokens;
        if (typeof t === 'number') pre.add(t); else unreadable++;
      }
      const u = ev?.type === 'assistant' ? ev.message?.usage : undefined;
      if (u) peak = Math.max(peak ?? 0, (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0));
    }
  }
  return { logs: logs.length, unrecognized_lines: unrecognized, compactions: [...pre].sort((a, b) => a - b), unreadable_compactions: unreadable, peak_context_tokens: peak };
}

const EMPTY: RecognitionScan = { logs: 0, unrecognized_lines: 0, compactions: [], unreadable_compactions: 0, peak_context_tokens: null };

const readJson = (f: string): any => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/** The finished trials of a running shard's Harbor jobs dir, as trial lines whose trial_dir is the Harbor trial dir. */
export function jobTrials(jobsDir: string): Array<TrialLine & { dir: string; unidentified: boolean }> {
  if (!existsSync(jobsDir)) return [];
  return readdirSync(jobsDir).flatMap((job) => {
    const jd = join(jobsDir, job);
    if (!statSync(jd).isDirectory()) return [];
    return readdirSync(jd).flatMap((name) => {
      const dir = join(jd, name);
      if (!statSync(dir).isDirectory() || !existsSync(join(dir, 'result.json'))) return [];
      const config = readJson(join(dir, 'config.json'));
      const model = String(config?.agent?.model_name ?? '').replace('/', ':');
      return [{ trial_id: job + '/' + name, cell: String(config?.agent?.kwargs?.cell ?? ''), model, dir, unidentified: !config?.task || !model }];
    });
  });
}

export function scanRecognition(dirs: string[], minPreTokens = 900000, model?: string, jobsDir?: string) {
  const lines: Array<TrialLine & { unidentified?: boolean; scan: () => RecognitionScan }> = jobsDir ? jobTrials(jobsDir).map((t) => ({ ...t, scan: () => scanTrial(t.dir) }))
    : dirs.flatMap((dir) => readFileSync(join(dir, 'trials.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => {
      const r = JSON.parse(l) as TrialLine;
      return { ...r, scan: () => (r.paths?.trial_dir ? scanTrial(join(dir, r.paths.trial_dir, 'harbor')) : EMPTY) };
    }));
  const rows: RecognitionRow[] = [];
  const byCell: Record<string, { trials: number; unrecognized: number; compacted: number; compacted_early: number; stopped: number }> = {};
  for (const r of lines) {
    if (model && r.model !== model && !r.unidentified) continue;
    const s = r.scan();
    const stops = [
      ...(r.unidentified ? ['unidentified trial (config.json unreadable or names no model)'] : []),
      ...(s.logs === 0 ? ['no agent log'] : []),
      ...(s.unrecognized_lines > 0 ? ['unrecognized_model'] : []),
      ...(s.compactions.some((t) => t < minPreTokens) ? ['compaction below ' + minPreTokens] : []),
      ...(s.unreadable_compactions > 0 ? ['compaction with unreadable pre_tokens'] : []),
    ];
    rows.push({ trial_id: r.trial_id, cell: r.cell, ...s, stops });
    const c = (byCell[r.cell] ??= { trials: 0, unrecognized: 0, compacted: 0, compacted_early: 0, stopped: 0 });
    c.trials++;
    if (s.unrecognized_lines > 0) c.unrecognized++;
    if (s.compactions.length || s.unreadable_compactions) c.compacted++;
    if (s.compactions.some((t) => t < minPreTokens) || s.unreadable_compactions) c.compacted_early++;
    if (stops.length) c.stopped++;
  }
  rows.sort((a, b) => a.trial_id.localeCompare(b.trial_id));
  return { min_pre_tokens: minPreTokens, model: model ?? null, trials: rows, by_cell: byCell };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const out = flag('--out') ?? (console.error('--out is required'), process.exit(2));
  const min = Number(flag('--min-pre-tokens') ?? 900000);
  if (!(min > 0)) { console.error('--min-pre-tokens must be a positive number'); process.exit(2); }
  const dirs = argv.filter((a, i) => !a.startsWith('--') && !['--out', '--min-pre-tokens', '--model', '--jobs'].includes(argv[i - 1]!)).map((d) => resolve(d));
  const jobs = flag('--jobs');
  if (!dirs.length && !jobs) { console.error('name at least one results dir, or --jobs <dir>'); process.exit(2); }
  const s = scanRecognition(dirs, min, flag('--model'), jobs ? resolve(jobs) : undefined);
  writeFileSync(resolve(out), JSON.stringify(s, null, 1) + '\n');
  const stopped = s.trials.filter((t) => t.stops.length);
  console.log('recognition: ' + s.trials.length + ' trial(s) scanned, ' + stopped.length + ' stop the run');
  for (const t of stopped) console.log('STOP ' + t.trial_id + ': ' + t.stops.join(', '));
  if (!s.trials.length || stopped.length) process.exit(1);
}
