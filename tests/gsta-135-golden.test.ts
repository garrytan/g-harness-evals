// internal-task's golden test for the shared-scorer changes to internal-task's
// scripts/gsta-135/evidence.ts: both internal-task panels (panel-run and
// panel-run-3610, 60 trials each) re-scored from their published receipts,
// every metric field of every row compared with the published cells.jsonl.
// The fixtures (tests/fixtures/gsta-135-golden/, cut by its cut.ts) hold each
// row's published evidence object and the tool-call lines of its
// evidence/<trial>.txt excerpt. The native session stores were not published,
// so two layers are checked, and README.md beside the fixtures says which
// fields each one covers and why:
//   A. re-score: the published classified events and final text through
//      scoreEvents() reproduce the metrics object and the summary fields
//      byte for byte, on all 120 rows;
//   B. re-classify: the excerpt's tool calls (arguments clipped at 240
//      characters) through classify() reproduce every published event whose
//      call is not clipped, add none, and give the same tool_calls and
//      unmatched_results; on every row whose events all come from unclipped
//      calls, those re-derived events give the published metrics too. The
//      events of clipped calls are pinned by name, so a new one fails.
// Keyless; when the Captain drive copy is mounted, the fixtures are also
// checked against it (skipped otherwise).
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify, scoreEvents, type Call, type Event, type Metrics } from '../scripts/gsta-135/evidence.ts';
import { CALL_LINE, RUNS } from './fixtures/gsta-135-golden/cut.ts';

const FIX = join(import.meta.dir, 'fixtures', 'gsta-135-golden');
const DRIVE = '<private drive>/handoffs/internal-task/gsta-135';
type Row = { trial_id: string; harness: 'openclaw' | 'hermes'; task: 1 | 2 | 3; arm: string; termination: string; cells_line_sha256: string; excerpt_sha256: string; evidence: any; calls: string[] };
const rows = (run: string): Row[] => readFileSync(join(FIX, run + '.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const METRIC_FIELDS: Array<keyof Metrics> = ['task', 'matching_skill', 'matching_skill_opened', 'matching_skill_started', 'started_attempted', 'started_exit', 'control_false_open', 'router_opened', 'skills_opened', 'other_skills_opened', 'task_success'];
/** The published events whose tool call the excerpt clipped, so classify() cannot see their arguments (run, trial, locator). */
const CLIPPED_EVENTS = [
  'panel-run-3610 gsta135-openclaw-t1-candidate-1 transcript_events session 99f433f0 seq 14 gstack_path',
  'panel-run-3610 gsta135-openclaw-t2-candidate-4 transcript_events session c084e0a4 seq 13 helper_run',
];

/** The excerpt's tool calls joined to their result lines, the way evidence.ts joined them in the native store. The excerpt drops
 *  call ids, so a result settles the oldest waiting call of its session with the same tool name (else the oldest), and a line
 *  the extractor marked "(matches no waiting call)" settles nothing. A call whose arguments were clipped (they no longer parse)
 *  is kept with clipped: true. */
function excerptCalls(row: Row): { calls: Array<Call & { clipped: boolean }>; unmatched: number } {
  const ev = row.evidence;
  const file = ev.files[0].path, sha = ev.files[0].sha256;
  const sessions = [...String(ev.note).matchAll(/session (\S+) last/g)].map(m => m[1]);
  const calls: Array<Call & { clipped: boolean }> = [];
  const waiting = new Map<string, Array<Call & { clipped: boolean }>>();
  let unmatched = 0;
  const parseArgs = (s: string) => { try { return { args: JSON.parse(s), clipped: false }; } catch { return { args: s, clipped: true }; } };
  const push = (session: string, c: Call & { clipped: boolean }) => { calls.push(c); waiting.set(session, [...(waiting.get(session) ?? []), c]); };
  const settle = (session: string, tool: string, result: Call['result']) => {
    const q = waiting.get(session) ?? [];
    const i = q.findIndex(c => c.tool === tool);
    const [c] = q.splice(i >= 0 ? i : 0, 1);
    if (c) c.result = result;
  };
  for (const line of row.calls) {
    let m: RegExpMatchArray | null;
    if (row.harness === 'openclaw') {
      if ((m = line.match(/^session (\w+) seq (\d+) toolCall (\S*) (.*)$/))) { push(m[1], { id: null, tool: m[3], locator: 'transcript_events session ' + m[1] + ' seq ' + m[2], file, sha256: sha, result: null, ...parseArgs(m[4]) }); continue; }
      m = line.match(/^session (\w+) seq \d+ toolResult (\S*?)( \(error\)| \(exit (-?\d+)\))?( \(matches no waiting call\))?: /)!;
      if (m[5]) { unmatched++; continue; }
      const exit = m[4] === undefined ? null : Number(m[4]);
      settle(m[1], m[2], { ok: m[3] === ' (error)' ? false : /^(exec|bash|shell|terminal|run)$/.test(m[2]) ? (exit === null ? null : exit === 0) : true, exit });
    } else {
      expect(sessions.length).toBe(1);
      if ((m = line.match(/^id (\d+) tool_call (\S*) (.*)$/))) { push('', { id: null, tool: m[2], locator: 'messages id ' + m[1] + ' session ' + sessions[0], file, sha256: sha, result: null, ...parseArgs(m[3]) }); continue; }
      m = line.match(/^id \d+ tool result \((.*?)\)( \(error\)| \(exit (-?\d+)\))?( \(matches no waiting call\))?: ?(.*)$/)!;
      if (m[4]) { unmatched++; continue; }
      const exit = m[3] === undefined ? null : Number(m[3]);
      settle('', m[1], { ok: m[2] === ' (error)' ? false : exit !== null ? exit === 0 : m[5].trim() ? true : null, exit });
    }
  }
  return { calls, unmatched };
}

const published = RUNS.flatMap(run => rows(run).map(row => ({ run, row })));

describe('internal-task golden: the fixtures', () => {
  test('both panels, 60 rows each, every row with an evidence object and its excerpt hash', () => {
    for (const run of RUNS) {
      const r = rows(run);
      expect(r).toHaveLength(60);
      for (const row of r) { expect(row.evidence?.metrics).toBeDefined(); expect(row.excerpt_sha256).toMatch(/^[0-9a-f]{64}$/); }
    }
    const sources = JSON.parse(readFileSync(join(FIX, 'sources.json'), 'utf8'));
    expect(Object.keys(sources)).toEqual([...RUNS]);
  });
  test.skipIf(!existsSync(join(DRIVE, 'panel-run', 'cells.jsonl')))('the fixtures are a faithful cut of the drive copy: each cells.jsonl line and excerpt hashes as recorded, each evidence object verbatim', () => {
    const sources = JSON.parse(readFileSync(join(FIX, 'sources.json'), 'utf8'));
    const sha = (s: string) => createHash('sha256').update(s).digest('hex');
    for (const run of RUNS) {
      const text = readFileSync(join(DRIVE, run, 'cells.jsonl'), 'utf8');
      expect(sha(text)).toBe(sources[run].cells_jsonl.sha256);
      const lines = text.split('\n').filter(Boolean);
      rows(run).forEach((row, i) => {
        expect(sha(lines[i])).toBe(row.cells_line_sha256);
        expect(JSON.stringify(JSON.parse(lines[i]).evidence)).toBe(JSON.stringify(row.evidence));
        const excerpt = readFileSync(join(DRIVE, run, 'evidence', row.trial_id + '.txt'), 'utf8');
        expect(sha(excerpt)).toBe(row.excerpt_sha256);
        expect(excerpt.split('\n').filter(l => CALL_LINE.test(l))).toEqual(row.calls);
      });
    }
  });
});

describe('internal-task golden A: re-scoring the published events', () => {
  test('every metric field and summary field of all 120 rows reproduces byte for byte', () => {
    let n = 0;
    for (const { run, row } of published) {
      const ev = row.evidence;
      const s = scoreEvents(ev.events, ev.final_text, ev.transcript, row.task);
      const at = run + ' ' + row.trial_id;
      expect({ at, keys: Object.keys(s.metrics) }).toEqual({ at, keys: METRIC_FIELDS as string[] });
      for (const k of METRIC_FIELDS) expect({ at, k, v: JSON.stringify(s.metrics[k]) }).toEqual({ at, k, v: JSON.stringify(ev.metrics[k]) });
      expect({ at, m: JSON.stringify(s.metrics) }).toEqual({ at, m: JSON.stringify(ev.metrics) });
      expect({ at, s: JSON.stringify([s.skill_open, s.sub_skill_open, s.helper_run, s.gstack_paths]) }).toEqual({ at, s: JSON.stringify([ev.skill_open, ev.sub_skill_open, ev.helper_run, ev.gstack_paths]) });
      n++;
    }
    expect(n).toBe(120);
  });
  test('the re-score is not vacuous: the panels carry opens and the one ambiguous start, and task_success follows the final text', () => {
    const m = published.map(p => p.row.evidence.metrics);
    expect(m.filter(x => x.matching_skill_opened === 1).length).toBeGreaterThan(0);
    expect(m.filter(x => x.started_attempted === 1).length).toBe(1);
    expect(m.filter(x => x.started_exit === 'ambiguous').length).toBe(1);
    expect(m.filter(x => x.matching_skill_started === 1).length).toBe(0);
    expect(m.filter(x => x.task_success === true).length).toBe(80);
    expect(m.filter(x => x.task === 3).every(x => x.task_success === null && x.control_false_open !== null)).toBe(true);
    for (const { row } of published.filter(p => p.row.task !== 3)) expect(scoreEvents(row.evidence.events, 'Looks good to me.', row.evidence.transcript, row.task).metrics.task_success).toBe(false);
  });
});

describe('internal-task golden B: re-classifying the excerpts', () => {
  test('classify() reproduces every published event of an unclipped call and no other; tool_calls and unmatched_results match; the clipped events are exactly the pinned two', () => {
    const clipped: string[] = [];
    let reproduced = 0, total = 0, metricRows = 0;
    for (const { run, row } of published) {
      const ev = row.evidence, at = run + ' ' + row.trial_id;
      const { calls, unmatched } = excerptCalls(row);
      expect({ at, tool_calls: calls.length, unmatched }).toEqual({ at, tool_calls: ev.tool_calls, unmatched: ev.unmatched_results });
      const clippedAt = new Set(calls.filter(c => c.clipped).map(c => c.locator));
      const derived: Event[] = calls.filter(c => !c.clipped).flatMap(c => classify(c, row.harness));
      const kept = (ev.events as Event[]).filter(e => !clippedAt.has(e.locator) || derived.some(d => d.locator === e.locator && d.kind === e.kind));
      for (const e of ev.events as Event[]) if (!kept.includes(e)) clipped.push(at + ' ' + e.locator + ' ' + e.kind);
      expect({ at, events: derived }).toEqual({ at, events: kept });
      total += ev.events.length; reproduced += kept.length;
      if (kept.length === ev.events.length) {
        const s = scoreEvents(derived, ev.final_text, ev.transcript, row.task);
        expect({ at, m: JSON.stringify(s.metrics) }).toEqual({ at, m: JSON.stringify(ev.metrics) });
        metricRows++;
      }
    }
    expect(clipped).toEqual(CLIPPED_EVENTS);
    expect({ total, reproduced, metricRows }).toEqual({ total: 54, reproduced: 52, metricRows: 118 });
  });
});
