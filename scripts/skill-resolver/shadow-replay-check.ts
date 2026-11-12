#!/usr/bin/env bun
// Shadow replay check for the skill-resolver arms (internal-task, spec section 9, last eng review). Keyless, no network, no model.
//
//   bun scripts/skill-resolver/shadow-replay-check.ts (--kit <kit dir> | --gbrain <binary>) [--harness <h>] [--until-exhausted]
//       [--out <file.json>]
//
// It runs the pinned resolver binary (the kit's bin/gbrain, or --gbrain) on one fixed transcript in shadow mode and in on mode and
// requires byte-identical block sequences. The binary builds an index of a fixed fixture catalog in a scratch GBRAIN_HOME, then
// each transcript turn is resolved twice in the same session, on mode then shadow, with the hook wrapper's command line and input
// (--input-json -, --session, --harness, --top-k 5, --fail-open, --expect-catalog with the index's catalog_hash, and in shadow
// mode --shadow-log, whose line is the shadow result read, as the wrapper reads it; env -i plus PATH, HOME, GBRAIN_HOME and
// GBRAIN_SKILLS_NO_AUTOREBUILD=1). Each side keeps its own running total of delivered block tokens, from which the budget phase
// and block reason are derived (result-fields.ts deriveSessionFields), as the wrapper derives them. Interleaving the two modes in one session is the stricter replay: shadow must
// keep its own state namespace, or its turns would see on mode's suggestions as repeats. The transcript walks a session through
// a match, an acknowledgement, a repeat, no match, an explicit skill name, every budget phase and the spent budget. Results are
// read through the field-name table in result-fields.ts.
//
// Prints SHADOW_REPLAY_OK with the turn count, the non-empty block count, the sha256 of the block sequence and the phases and block
// reasons seen, and exits 0. Any mismatch, error result, nonzero exit, unreadable output, shadow flag on the wrong side, or a
// sequence with no non-empty block prints SHADOW_REPLAY_FAIL with the reasons and exits 1; a shard whose preflight fails this is
// INFRA (scripts/skill-resolver/preflight.ts runs it per harness; QM's wrapper calls this same script). Usage errors exit 2.
//
// --until-exhausted is the budget check for a build without the stand-in's budget switch: the same session and comparison on a
// long transcript (a match, an acknowledgement, then one ledger request a turn, each naming a new close variant, at most 300 turns) until a turn reports
// budget_exhausted, then three more turns (a ledger request, an acknowledgement, a git request). It requires the budget to run out,
// the session's delivered block tokens to total at most 2,000, and every turn from the first exhausted one to have an empty
// block, budget_phase exhausted and, except an acknowledgement, budget_exhausted true. An acknowledgement after the budget ran
// out (no_skill_reason ack) passes whatever its budget_exhausted says: the pinned release answers it false (resolve.ts:290
// returns before the exhaustion check at :346), a known defect recorded in the preregistration. Prints BUDGET_REPLAY_OK or
// BUDGET_REPLAY_FAIL (exit 1).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FRESH_SESSION, normalizeReceipt, normalizeResult, type NormalizedResult, type SessionBefore } from './result-fields.ts';

export const REPLAY_CATALOG = 'he-shadow-replay';
export const REPLAY_SESSION = 'he-shadow-replay';
export const SESSION_BLOCK_BUDGET = 2000;
const MAX_TURNS = 300;
const sha = (b: string) => createHash('sha256').update(b).digest('hex');

/** The fixture catalog: three small skills and 200 ledger tools, enough for any transcript here to spend the whole block budget. */
export const REPLAY_SKILLS: Record<string, string> = {
  'git-workflow': 'Rebase branches and resolve merge conflicts in git.',
  pdf: 'Read, merge and split PDF files.',
  xlsx: 'Build and edit Excel spreadsheets with formulas.',
  ...Object.fromEntries(Array.from({ length: 200 }, (_, i) => ['ledger-tool-' + String(i).padStart(3, '0'),
    'Reconcile the ledger and audit journal entries for close variant ' + i + ', with a description long enough to reach the hint cap.'])),
};

const GIT = 'Please rebase my git branch and resolve the merge conflicts.';
/** A ledger request naming one close variant, so each turn ranks a ledger tool first that the session has not seen: the release
 *  dedupes within the top k (an empty block when every one of them was suggested before), so a repeated text would stop spending. */
const ledger = (i: number) => 'Reconcile the ledger before the close, variant ' + i + '.';
let ledgerTurns = 0;
const LEDGER = () => ledger(ledgerTurns++);
/** The fixed transcript, one user message per turn. */
export const REPLAY_TRANSCRIPT: string[] = [
  GIT, 'ok thanks', GIT, 'Paint a picture of the sunset.', 'Use git-workflow for this one.', 'Fill the formulas in.',
  ...Array.from({ length: 8 }, LEDGER), 'Fill the formulas in.', 'Merge these two PDF files.',
  ...Array.from({ length: 6 }, LEDGER), GIT, ...Array.from({ length: 14 }, LEDGER), 'sounds good', GIT, LEDGER(),
];
const AFTER_EXHAUSTED = (n: number) => [ledger(n), 'ok thanks', GIT];

type Side = { exit: number | null; block_sha256: string | null; fields: NormalizedResult | null };
type Turn = { turn: number; message: string; on: Side; shadow: Side };
export type ReplayReport = { ok: boolean; mode: 'shadow' | 'until-exhausted'; problems: string[]; line: string; gbrain_version: string | null; turns: Turn[] };

export function shadowReplay(gbrain: string, harness: string, opts: { untilExhausted?: boolean } = {}): ReplayReport {
  const mode = opts.untilExhausted ? 'until-exhausted' : 'shadow';
  const tmp = mkdtempSync(join(tmpdir(), 'he-shadow-replay-'));
  const problems: string[] = [];
  const turns: Turn[] = [];
  let version: string | null = null;
  try {
    const skills = join(tmp, 'skills'), home = join(tmp, 'gbrain-home');
    for (const [name, d] of Object.entries(REPLAY_SKILLS)) {
      mkdirSync(join(skills, name), { recursive: true });
      writeFileSync(join(skills, name, 'SKILL.md'), '---\nname: ' + name + '\ndescription: ' + d + '\n---\n\nBody of ' + name + '.\n');
    }
    const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: tmp, GBRAIN_HOME: home, GBRAIN_SKILLS_NO_AUTOREBUILD: '1' };
    const run = (args: string[], input?: string) => spawnSync(gbrain, args, { input, encoding: 'utf8', env, timeout: 30_000, maxBuffer: 8 << 20 });
    const v = run(['--version']);
    version = v.status === 0 ? String(v.stdout).trim() : null;
    const b = run(['skills', 'index', 'build', '--catalog', REPLAY_CATALOG, '--dir', skills, '--harness', harness, '--json']);
    let catalogHash = '';
    try { catalogHash = normalizeReceipt(JSON.parse(String(b.stdout))).catalog_hash ?? ''; } catch { /* reported below */ }
    if (b.status !== 0 || !catalogHash) return { ok: false, mode, problems: ['index build exited ' + b.status + ': ' + String(b.stderr ?? b.error ?? '').trim().slice(0, 300)], line: '', gbrain_version: version, turns };
    let previous = '';
    const state: Record<'on' | 'shadow', SessionBefore> = { on: FRESH_SESSION, shadow: FRESH_SESSION };
    const shadowLog = join(tmp, 'shadow.ndjson');
    const step = (message: string): Turn => {
      const n = turns.length + 1;
      const side = (shadow: boolean): Side => {
        rmSync(shadowLog, { force: true });
        const r = run(['skills', 'resolve', '--catalog', REPLAY_CATALOG, '--input-json', '-', '--json', '--session', REPLAY_SESSION, '--harness', harness, '--top-k', '5',
          ...(shadow ? ['--shadow', '--shadow-log', shadowLog] : []), '--fail-open', '--expect-catalog', catalogHash],
          JSON.stringify({ message, ...(previous ? { previous_user_message: previous } : {}), session_id: REPLAY_SESSION, harness, top_k: 5, exclude: [], shadow }));
        let fields: NormalizedResult | null = null;
        const key = shadow ? 'shadow' : 'on';
        try {
          const out = JSON.parse(String(r.stdout));
          const logged = shadow && existsSync(shadowLog) ? JSON.parse(readFileSync(shadowLog, 'utf8').trim().split('\n').pop()!) : null;
          fields = normalizeResult(logged ?? out, state[key]);
          state[key] = { spent: fields.session_block_tokens ?? state[key].spent, exhausted: state[key].exhausted || fields.budget_phase === 'exhausted' };
        } catch { problems.push('turn ' + n + (shadow ? ' shadow' : ' on') + ': output is not JSON'); }
        return { exit: r.status, block_sha256: fields?.block ? sha(fields.block) : null, fields };
      };
      const t: Turn = { turn: n, message, on: side(false), shadow: side(true) };
      turns.push(t);
      previous = message;
      for (const [m, s] of [['on', t.on], ['shadow', t.shadow]] as const) {
        if (s.exit !== 0) problems.push('turn ' + n + ' ' + m + ': exit ' + s.exit);
        if (s.fields?.error) problems.push('turn ' + n + ' ' + m + ': error ' + s.fields.error_code + ' ' + String(s.fields.error_message).slice(0, 160));
        if (s.fields && s.fields.shadow !== (m === 'shadow')) problems.push('turn ' + n + ' ' + m + ': shadow is ' + JSON.stringify(s.fields.shadow));
      }
      if (t.on.block_sha256 !== t.shadow.block_sha256) problems.push('turn ' + n + ': the shadow block differs from the on block');
      return t;
    };
    let exhaustedAt = 0;
    if (!opts.untilExhausted) REPLAY_TRANSCRIPT.forEach(step);
    else {
      for (const m of [GIT, 'ok thanks']) step(m);
      while (turns.length < MAX_TURNS && !exhaustedAt) if (step(ledger(turns.length)).on.fields?.budget_exhausted) exhaustedAt = turns.length;
      if (exhaustedAt) AFTER_EXHAUSTED(turns.length).forEach(step);
      else problems.push('the budget never ran out in ' + MAX_TURNS + ' turns');
    }
    const blocks = turns.filter((t) => t.on.block_sha256).length;
    if (!blocks) problems.push('no turn produced a block, so the replay proves nothing');
    const seen = (f: (s: NormalizedResult) => unknown) => [...new Set(turns.map((t) => String(t.on.fields ? f(t.on.fields) : null)))].join(',');
    const tail = ' harness=' + harness + ' gbrain=' + JSON.stringify(version) + ' phases=' + seen((s) => s.budget_phase) + ' reasons=' + seen((s) => s.block_reason);
    let line = 'turns=' + turns.length + ' blocks=' + blocks + ' sequence_sha256=' + sha(turns.map((t) => t.on.block_sha256 ?? '-').join('\n')) + tail;
    if (opts.untilExhausted) {
      const spent = turns.reduce((n, t) => n + (t.on.fields?.block ? t.on.fields.block_tokens ?? NaN : 0), 0);
      if (!(spent <= SESSION_BLOCK_BUDGET)) problems.push('the session delivered ' + spent + ' block tokens, over ' + SESSION_BLOCK_BUDGET);
      if (exhaustedAt) for (const t of turns.slice(exhaustedAt - 1)) {
        const f = t.on.fields;
        if (!f || f.block) problems.push('turn ' + t.turn + ': after the budget ran out the block is not empty');
        else if (f.budget_exhausted !== true && f.no_skill_reason !== 'ack') problems.push('turn ' + t.turn + ': after the budget ran out budget_exhausted is not true');
        else if (f.budget_phase !== 'exhausted') problems.push('turn ' + t.turn + ': after the budget ran out budget_phase is ' + f.budget_phase);
      }
      line = 'turns=' + turns.length + ' exhausted_at=' + (exhaustedAt || '-') + ' spent=' + spent + ' blocks=' + blocks + tail;
    }
    return { ok: problems.length === 0, mode, problems, line, gbrain_version: version, turns };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const valued = ['--kit', '--gbrain', '--harness', '--out'];
  const arg = (n: string) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
  const kit = arg('kit'), gbrain = arg('gbrain') ?? (kit ? join(resolve(kit), 'bin', 'gbrain') : undefined);
  const rest = argv.filter((a) => a !== '--until-exhausted');
  if (!gbrain || rest.length % 2 || rest.some((a, i) => i % 2 === 0 && !valued.includes(a))) {
    console.error('usage: shadow-replay-check.ts (--kit <kit dir> | --gbrain <binary>) [--harness <h>] [--until-exhausted] [--out <file.json>]');
    process.exit(2);
  }
  const harness = arg('harness') ?? 'claude-code';
  const r = shadowReplay(resolve(gbrain), harness, { untilExhausted: argv.includes('--until-exhausted') });
  const out = arg('out');
  if (out) writeFileSync(out, JSON.stringify({ gbrain: resolve(gbrain), harness, ...r }, null, 1) + '\n');
  const prefix = r.mode === 'shadow' ? 'SHADOW_REPLAY_' : 'BUDGET_REPLAY_';
  if (r.ok) console.log(prefix + 'OK ' + r.line);
  else console.log(prefix + 'FAIL ' + (r.line ? r.line + ' ' : '') + 'problems: ' + r.problems.slice(0, 5).join('; ') + (r.problems.length > 5 ? '; and ' + (r.problems.length - 5) + ' more' : ''));
  process.exit(r.ok ? 0 : 1);
}
