// Pilot summary for the gbrain first-wow eval: re-scores every trial of a run from the files it left (fixture.json, the replies,
// the transcripts, the brain export and setup's history) with the current scorer, then prints the pilot's checks per arm
// (PREREGISTRATION.md, Pilot). Keyless; reads only the run directory.
// usage: bun scripts/gbrain-first-wow/pilot-summary.ts <run dir> [--json <out>] [--md <out>]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseQmTurn, parseTurn, type NEvent } from '../gbrain-install/transcript.ts';
import { scoreFirstWow } from '../../runner/trial/first-wow.ts';
import { readBrainExport, type Arm, type BrainPage } from './score.ts';
import { QM_FILE_ROOTS } from '../../runner/trial/first-wow-qm.ts';
import { suggestionIn } from '../../runner/trial/first-wow-cell.ts';
import type { FixtureManifest } from './fixtures.ts';
import { trialDirFor } from '../../runner/trial/run.ts';
import type { Trial } from '../../runner/run.ts';

export interface Rec { trial_id: string; cell: string; task: string; harness: string; model: string; termination: string; usage: { usd: number } | null; paths: { dir: string }; first_wow: { arm: Arm; persona: string; sessions_imported: number | null; brain_pages: number | null; registration: { ok: boolean } | null; image_record: string; setup: Array<{ history: unknown; suggestion?: { state?: string } | null }>; setup_ms: number; question_ms: number | null; person_needed: number; turns: Array<{ turn: number }>; onboarding?: { delivered_sessions?: number; state?: string }; suggestion_seen?: { seen: boolean; pages: string[]; brain_text?: string; files?: string[] }; coding?: { task: string; grade: { passed: boolean; pass: number; fail: number } | null }; qm?: { brain_host: { access_check: { ok: boolean } | null; token_reads_import: { holds_value: boolean } | null } | null } } }

// A merged sharded run keeps each trial under <results dir>/trials/..., while paths.dir is the absolute path on the shard VM.
export function rescore(r: Rec, resultsDir?: string) {
  const local = resultsDir ? trialDirFor(resultsDir, { id: r.trial_id } as Trial) : null;
  const dir = local && existsSync(local) ? local : r.paths.dir;
  const manifest = JSON.parse(readFileSync(join(dir, 'fixture.json'), 'utf8')) as FixtureManifest;
  const fw = r.first_wow;
  const replies = fw.turns.map((t) => { const p = join(dir, 'logs', 'turns', 'turn-' + String(t.turn).padStart(4, '0') + '.reply.txt'); return existsSync(p) ? readFileSync(p, 'utf8') : null; });
  const events: NEvent[] = fw.turns.flatMap((t) => r.harness === 'qm' ? parseQmTurn(join(dir, 'logs'), t.turn, 'first-wow') : parseTurn(r.harness, join(dir, 'logs'), t.turn, 'first-wow'));
  // QM (runner/trial/first-wow-qm.ts): the brain export sits under gbrain/, and the agent's files are the sandbox workspace capture.sh copied out.
  const qm = r.harness === 'qm';
  const exportDir = join(dir, qm ? 'gbrain' : 'logs', 'brain-export');
  let brain: BrainPage[] = [];
  if (existsSync(exportDir)) { try { brain = readBrainExport(exportDir); } catch { brain = []; } }
  const readFile = (rel: string) => { try { return readFileSync(join(dir, qm ? 'workspace' : 'state', rel), 'utf8'); } catch { return null; } };
  // PR 2's section as the transcript recorded it; a record written before brain_text existed is read again from the files it names.
  const seen = fw.suggestion_seen;
  const sessionStart = seen?.brain_text ?? (seen?.files ?? []).map((f) => { try { return suggestionIn(readFileSync(join(dir, f), 'utf8')).brain_text; } catch { return ''; } }).filter(Boolean).join('\n');
  const score = scoreFirstWow({ manifest, arm: fw.arm, replies, events, brain, readFile, setupOutput: fw.setup.map((s) => JSON.stringify(s.history)).join('\n'), ...(qm ? { fileRoots: QM_FILE_ROOTS } : {}), sessionStart }) as unknown as Record<string, unknown>;
  const planted = manifest.questions.filter((q) => q.answer).map((q) => brain.some((p) => p.text.includes(q.answer!)));
  return { manifest, score, events, brain_holds_planted: planted, sessions_in_fixture: manifest.sessions.length };
}

if (import.meta.main) {
  const [runDir, ...rest] = process.argv.slice(2);
  if (!runDir) { console.error('usage: bun scripts/gbrain-first-wow/pilot-summary.ts <run dir> [--json <out>] [--md <out>]'); process.exit(2); }
  const opt = (k: string) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  const all = readFileSync(join(runDir, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Rec);
  const recs = all.filter((r) => !r.first_wow.coding);
  const codingRecs = all.filter((r) => r.first_wow.coding);
  const trials = recs.map((r) => { const s = rescore(r, runDir); return { trial: r.trial_id, cell: r.cell, harness: r.harness, model: r.model, arm: r.first_wow.arm, seed: s.manifest.seed, persona: s.manifest.persona, termination: r.termination, usd: r.usage?.usd ?? 0,
    sessions_in_fixture: s.sessions_in_fixture, sessions_imported: r.first_wow.sessions_imported, brain_pages: r.first_wow.brain_pages, brain_holds_planted: s.brain_holds_planted, registration_ok: r.first_wow.registration?.ok ?? null,
    access_check_ok: r.first_wow.qm?.brain_host?.access_check?.ok ?? null, token_reads_import: r.first_wow.qm?.brain_host?.token_reads_import?.holds_value ?? null,
    image_record: r.first_wow.image_record, setup_s: r.first_wow.setup_ms / 1000, question_s: (r.first_wow.question_ms ?? 0) / 1000, person_needed: r.first_wow.person_needed,
    suggestion_state: r.first_wow.setup.at(-1)?.suggestion?.state ?? null, suggestion_delivered: r.first_wow.onboarding?.delivered_sessions ?? null, suggestion_seen: r.first_wow.suggestion_seen?.seen ?? null, suggestion_pages: r.first_wow.suggestion_seen?.pages.length ?? null, score: s.score }; });
  const cells = [...new Set(trials.map((t) => t.cell))];
  const rows = cells.map((cell) => {
    const ts = trials.filter((t) => t.cell === cell);
    const rich = ts.filter((t) => t.persona !== 'no-history');
    const none = ts.filter((t) => t.persona === 'no-history');
    const sum = (f: (t: typeof ts[number]) => number) => ts.reduce((a, t) => a + f(t), 0);
    return { cell, harness: ts[0]!.harness, arm: ts[0]!.arm, n: ts.length, usd: +sum((t) => t.usd).toFixed(4),
      finish_any: rich.filter((t) => t.score.finish_any).length, finish_strict: rich.filter((t) => t.score.finish_strict).length, history_rich: rich.length,
      questions_passed: rich.reduce((a, t) => a + Number(t.score.passed_any), 0), cross_harness_passed: rich.filter((t) => (t.score.questions as Array<{ cross_harness: boolean; passed_any: boolean }>).some((q) => q.cross_harness && q.passed_any)).length,
      abstained: none.filter((t) => t.score.correct_abstention).length, no_history: none.length, fallback_shown: none.filter((t) => t.score.fallback_shown === true).length,
      import_ran: rich.filter((t) => (t.sessions_imported ?? 0) > 0).length, imported_all: rich.filter((t) => t.sessions_imported === t.sessions_in_fixture).length,
      brain_holds_all_planted: rich.filter((t) => t.brain_holds_planted.length === 3 && t.brain_holds_planted.every(Boolean)).length,
      registration_ok: ts.filter((t) => t.registration_ok === true).length, access_check_ok: ts.filter((t) => t.access_check_ok === true).length, gbrain_calls: sum((t) => Number(t.score.gbrain_calls)), person_needed: sum((t) => t.person_needed),
      suggestion_armed: ts.filter((t) => t.suggestion_state === 'armed').length, suggestion_off: ts.filter((t) => t.suggestion_state === 'off').length, suggestion_delivered: ts.filter((t) => (t.suggestion_delivered ?? 0) > 0).length, suggestion_seen: ts.filter((t) => t.suggestion_seen === true).length,
      unsegmented: ts.filter((t) => !t.score.segmented).length, terminations: [...new Set(ts.map((t) => t.termination))].join(','),
      median_question_s: ts.map((t) => t.question_s).sort((a, b) => a - b)[Math.floor(ts.length / 2)], median_setup_s: ts.map((t) => t.setup_s).sort((a, b) => a - b)[Math.floor(ts.length / 2)] };
  });
  const codingTrials = codingRecs.map((r) => ({ trial: r.trial_id, cell: r.cell, harness: r.harness, arm: r.first_wow.arm, task: r.first_wow.coding!.task, termination: r.termination, usd: r.usage?.usd ?? 0, passed: r.first_wow.coding!.grade?.passed ?? null,
    pass: r.first_wow.coding!.grade?.pass ?? null, fail: r.first_wow.coding!.grade?.fail ?? null, suggestion_state: r.first_wow.setup.at(-1)?.suggestion?.state ?? null, suggestion_delivered: r.first_wow.onboarding?.delivered_sessions ?? null,
    suggestion_seen: r.first_wow.suggestion_seen?.seen ?? null, person_needed: r.first_wow.person_needed, session_s: (r.first_wow.question_ms ?? 0) / 1000 }));
  const codingRows = [...new Set(codingTrials.map((t) => t.cell))].map((cell) => { const ts = codingTrials.filter((t) => t.cell === cell);
    return { cell, harness: ts[0]!.harness, arm: ts[0]!.arm, n: ts.length, usd: +ts.reduce((a, t) => a + t.usd, 0).toFixed(4), passed: ts.filter((t) => t.passed).length, suggestion_seen: ts.filter((t) => t.suggestion_seen).length,
      person_needed: ts.reduce((a, t) => a + t.person_needed, 0), median_session_s: ts.map((t) => t.session_s).sort((a, b) => a - b)[Math.floor(ts.length / 2)], tasks: ts.map((t) => t.task + (t.passed ? ' pass' : ' fail')).join(', ') }; });
  const out = { run: runDir.split('/').filter(Boolean).pop(), trials: trials.length + codingTrials.length, usd: +(trials.reduce((a, t) => a + t.usd, 0) + codingTrials.reduce((a, t) => a + t.usd, 0)).toFixed(4), coding_rows: codingRows, coding_trials: codingTrials,  rows, trial_rows: trials.map(({ score, image_record: _i, ...t }) => ({ ...t, finish_any: score.finish_any ?? null, finish_strict: score.finish_strict ?? null, passed_any: score.passed_any ?? null, correct_abstention: score.correct_abstention ?? null, segmented: score.segmented, gbrain_calls: score.gbrain_calls })) };
  const md = ['| Cell | Arm | n | Paid $ | Finish (any ref) | Finish (strict) | Questions passed | Cross-harness q passed | No-history abstained | Import ran | All sessions imported | Brain holds planted facts | Registration ok | gbrain calls | Person turns | Median question s | Median setup s |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => '| ' + [r.cell, r.arm, r.n, r.usd.toFixed(2), r.finish_any + '/' + r.history_rich, r.finish_strict + '/' + r.history_rich, r.questions_passed + '/' + 3 * r.history_rich, r.cross_harness_passed + '/' + r.history_rich, r.abstained + '/' + r.no_history, r.import_ran + '/' + r.history_rich, r.imported_all + '/' + r.history_rich, r.brain_holds_all_planted + '/' + r.history_rich, r.arm === 'plain' || r.harness === 'qm' ? 'n/a' : r.registration_ok + '/' + r.n, r.gbrain_calls, r.person_needed, r.median_question_s.toFixed(0), r.median_setup_s.toFixed(0)].join(' | ') + ' |')].join('\n');
  const extra: string[] = [];
  if (trials.some((t) => t.suggestion_state !== null)) extra.push('', '| Cell | Arm | Suggestion armed at setup | Off at setup | Delivered (gbrain) | Section in transcript |', '|---|---|---|---|---|---|',
    ...rows.map((r) => '| ' + [r.cell, r.arm, r.suggestion_armed + '/' + r.n, r.suggestion_off + '/' + r.n, r.suggestion_delivered + '/' + r.n, r.suggestion_seen + '/' + r.n].join(' | ') + ' |'));
  if (codingRows.length) extra.push('', '| Coding cell | Arm | n | Paid $ | Passed | Section in transcript | Person turns | Median session s | Tasks |', '|---|---|---|---|---|---|---|---|---|',
    ...codingRows.map((r) => '| ' + [r.cell, r.arm, r.n, r.usd.toFixed(2), r.passed + '/' + r.n, r.suggestion_seen + '/' + r.n, r.person_needed, Math.round(r.median_session_s ?? 0), r.tasks].join(' | ') + ' |'));
  const mdAll = [md, ...extra].join('\n');
  if (opt('--json')) writeFileSync(opt('--json')!, JSON.stringify(out, null, 1) + '\n');
  if (opt('--md')) writeFileSync(opt('--md')!, mdAll + '\n');
  console.log(mdAll);
  console.log('PILOT: trials=' + out.trials + ' usd=' + out.usd);
}
