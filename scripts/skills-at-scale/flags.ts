#!/usr/bin/env bun
// Hand-settled flags for the skills-at-scale eval (internal-task's decision, 2026-11-19). #491 joins a relative read to an earlier
// cd in the same command (got-skill.ts shellReadArgs), and its follow-up fix (todos.d/cd-join-skill-read-gaps.md) was
// dropped. The preregistration handles the known gaps by flagging the trials they could touch and settling those by hand
// (adjudicate-flags.ts), so no automatic verdict on a flagged trial counts unread.
//
// flagTrial runs on each trial before the scrub removes its requests and traces (runner/trial/run.ts writes the result to
// skill-flags.json, which the scrub keeps and redacts). A trial is flagged
//   cd-joined        when the clean-arm verdict (skill-requests.ts gstackReads) or the opened-skill set (got-skill.ts
//                    catalog_opened; on QM, harnesses/qm/skill-opens.ts opened) differs with cd joining on and off
//                    (shellReadArgs followCd; QM's execute reads go through it by qmReadArgs, and its skills and files
//                    read tools do not depend on a cd);
//   failed-cd-probe  when a read joined to a cd has a result with a shell's own failed-cd line (bash "cd: <dir>: No such file
//                    or directory", sh "can't cd to", zsh "cd: no such file or directory: <dir>");
//   json-permission  when a read's result is JSON whose decoded string values carry a permission error;
//   errno13          when a read's result has Python's "[Errno 13] Permission denied".
// Each flagged call is kept with its id, tool, its full input, up to RESULT_MAX characters of its result (a longer result is
// cut and the cut marked) and where it came from, so a reader can settle the trial from skill-flags.json after the scrub,
// which redacts request text in it as in every file it keeps.
//
//   bun scripts/skills-at-scale/flags.ts --results <merged results dir> --out <dir>
//
// writes <out>/flagged.jsonl (one row per flagged trial: trial id, cell, arm, harness, rung, flags, the tool-call ids
// involved, and the paths a reader opens) and <out>/flags-summary.json (the flag rate per arm and per harness). A trial with no
// skill-flags.json fails closed (internal-task, 2026-11-19): it is flagged missing-flag-record and settled by hand like any other.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gotSkill, readArgs, strings, toolCalls, type Harness, type ToolCall } from '../skill-resolver/got-skill.ts';
import { gstackReads, qmReadArgs, traceFiles } from '../../runner/trial/skill-requests.ts';
import { skillOpens } from '../../harnesses/qm/skill-opens.ts';

export const FLAGS = ['cd-joined', 'failed-cd-probe', 'json-permission', 'errno13'] as const;
export type Flag = (typeof FLAGS)[number];
export const FLAG_FILE = 'skill-flags.json';
const HARNESSES = ['openclaw', 'claude-code', 'codex', 'hermes', 'pi', 'qm'];
export const RESULT_MAX = 8000;
export const FAILED_CD = /\bcd: [^\n]*: No such file or directory|\bcan't cd to\b|\bcd: no such file or directory: /i;
export const ERRNO13 = /\[Errno 13\] Permission denied/;
const PERMISSION = /permission denied|\bEACCES\b|\bEPERM\b|operation not permitted/i;

function jsonPermission(text: string): boolean {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return false;
  try { return strings(JSON.parse(t)).some((s) => PERMISSION.test(s)); } catch { return false; }
}

export type FlagRecord = ReturnType<typeof flagTrial>;

export function flagTrial(o: { harness: string; catalog: string[]; requests: unknown[]; trialDir: string }) {
  if (!HARNESSES.includes(o.harness)) throw new Error('HE-SCALE-FLAGS-001 no flag reader for harness ' + o.harness);
  const sources = ['proxy-requests', ...traceFiles(o.harness, o.trialDir)];
  const qm = o.harness === 'qm';
  const traces = qm ? [] : traceFiles(o.harness, o.trialDir).map((f) => readFileSync(join(o.trialDir, f), 'utf8').split('\n'));
  const reads = (c: ToolCall, followCd: boolean) => (qm ? qmReadArgs(c, { followCd }) : readArgs(o.harness as Harness, c, { followCd }));
  const skillRead = (c: ToolCall) => qm && c.name === 'skills' && (c.input as { action?: unknown } | null)?.action === 'read';
  const verdict = (followCd: boolean) => ({
    contaminated: gstackReads(o.harness, o.requests, o.trialDir, { followCd }).contaminated,
    catalog_opened: qm ? skillOpens({ catalog: o.catalog, requests: o.requests as Array<Record<string, unknown>>, followCd }).opened
      : gotSkill({ harness: o.harness as Harness, catalog: o.catalog, requests: o.requests, traces, followCd }).catalog_opened,
  });
  const on = verdict(true), off = verdict(false);
  const differs = on.contaminated !== off.contaminated || JSON.stringify(on.catalog_opened) !== JSON.stringify(off.catalog_opened);
  const calls = toolCalls(o.requests, traces).flatMap((c) => {
    const joined = reads(c, true);
    const read = joined.length > 0 || skillRead(c), cd = joined.length > 0 && JSON.stringify(joined) !== JSON.stringify(reads(c, false));
    const result = c.result ?? '';
    const flags: Flag[] = [...(cd && differs ? ['cd-joined' as const] : []), ...(cd && FAILED_CD.test(result) ? ['failed-cd-probe' as const] : []),
      ...(read && jsonPermission(result) ? ['json-permission' as const] : []), ...(read && ERRNO13.test(result) ? ['errno13' as const] : [])];
    const cut = result.length > RESULT_MAX;
    return flags.length ? [{ id: c.id, name: c.name, source: c.source, flags, input: c.input, result_chars: result.length, result_cut: cut,
      result: cut ? result.slice(0, RESULT_MAX) + '\n[cut: ' + (result.length - RESULT_MAX) + ' more characters]' : result }] : [];
  });
  const flags = FLAGS.filter((f) => (f === 'cd-joined' ? differs : calls.some((c) => c.flags.includes(f))));
  return { schema: 'he-skill-flags/1' as const, harness: o.harness, flags, verdicts: { cd_on: on, cd_off: off }, calls, sources };
}

export type FlaggedRow = { trial_id: string; cell: string; arm: string | null; harness: string; model: string; rung: number | null; flags: Array<Flag | 'missing-flag-record'>; call_ids: Array<string | null>; trace_paths: string[]; sources: string[] };

const readJsonl = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

/** Every trial's flag record in a merged results directory. */
export function collectFlags(results: string) {
  const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as { cells: Array<{ id: string; harness: string; model: string; skill_arm?: string; rung?: number }> };
  const cells = new Map(manifest.cells.map((c) => [c.id, c]));
  const trials = (readJsonl(join(results, 'trials.jsonl')) as Array<{ trial_id: string; cell: string }>).filter((t) => cells.has(t.cell));
  const flagged: FlaggedRow[] = [];
  const missing: string[] = [];
  const rows = trials.map((t) => {
    const c = cells.get(t.cell)!;
    const dir = join('trials', ...t.trial_id.split('/').slice(1));
    const file = join(results, dir, FLAG_FILE);
    const rec = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as FlagRecord) : null;
    if (!rec) { missing.push(t.trial_id); flagged.push({ trial_id: t.trial_id, cell: t.cell, arm: c.skill_arm ?? null, harness: c.harness, model: c.model, rung: c.rung ?? null, flags: ['missing-flag-record'], call_ids: [], trace_paths: [dir], sources: [] }); }
    else if (rec.flags.length) flagged.push({ trial_id: t.trial_id, cell: t.cell, arm: c.skill_arm ?? null, harness: c.harness, model: c.model, rung: c.rung ?? null, flags: rec.flags,
      call_ids: rec.calls.map((x) => x.id), trace_paths: [join(dir, FLAG_FILE), ...rec.sources.filter((s) => existsSync(join(results, dir, s))).map((s) => join(dir, s))], sources: rec.sources });
    return { arm: c.skill_arm ?? 'none', harness: c.harness, record: !!rec, flagged: !rec || rec.flags.length > 0, flags: rec?.flags ?? [] };
  });
  const rate = (key: 'arm' | 'harness') => Object.fromEntries([...new Set(rows.map((r) => r[key]))].sort().map((k) => {
    const s = rows.filter((r) => r[key] === k);
    const withRecord = s.filter((r) => r.record);
    const n = s.filter((r) => r.flagged).length;
    return [k, { trials: s.length, with_flag_record: withRecord.length, missing_flag_record: s.length - withRecord.length, flagged: n,
      rate: Number((n / s.length).toFixed(4)), by_flag: Object.fromEntries(FLAGS.map((f) => [f, s.filter((r) => r.flags.includes(f)).length])) }];
  }));
  return { flagged, missing, summary: { schema: 'he-skills-at-scale-flags/1', trials: rows.length, flagged: flagged.length, missing_flag_record: missing.length, by_arm: rate('arm'), by_harness: rate('harness') } };
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
  if (!v('results') || !v('out')) { console.error('usage: flags.ts --results <merged results dir> --out <dir>'); process.exit(2); }
  try {
    const r = collectFlags(v('results')!);
    mkdirSync(v('out')!, { recursive: true });
    writeFileSync(join(v('out')!, 'flagged.jsonl'), r.flagged.map((x) => JSON.stringify(x)).join('\n') + (r.flagged.length ? '\n' : ''));
    writeFileSync(join(v('out')!, 'flags-summary.json'), JSON.stringify(r.summary, null, 1) + '\n');
    for (const [h, s] of Object.entries(r.summary.by_harness)) console.log('FLAGS harness=' + h + ' trials=' + s.trials + ' flagged=' + s.flagged + ' rate=' + s.rate + ' missing_flag_record=' + s.missing_flag_record);
    console.log('FLAGGED trials=' + r.summary.trials + ' flagged=' + r.summary.flagged + ' missing_flag_record=' + r.summary.missing_flag_record + ' out=' + v('out'));
  } catch (e) { console.error((e as Error).message.startsWith('HE-') ? (e as Error).message : 'HE-SCALE-FLAGS-000 ' + (e as Error).message); process.exit(2); }
}
