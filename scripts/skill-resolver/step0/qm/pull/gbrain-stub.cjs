#!/usr/bin/env node
// internal-task-a stand-in for `gbrain skills resolve` (internal-task-b's release is not pinned yet), for the Step 0 pull check
// (qm-pull-check.ts, Dockerfile.pull) only. The QM arm images carry the shared stand-in scripts/skill-resolver/gbrain-stub.ts
// instead (scripts/skill-resolver/step0/qm/arms/Dockerfile.arms), the same resolver as the four push harnesses.
// It accepts the eval's command line:
//   gbrain skills resolve --input-json - --json --fail-open --expect-catalog <hash> [--shadow]
// reads the input JSON ({message, session_id, ...}) on stdin and prints one schema_version 1 object in the gateless
// contract (resolver-interface-spec.md section 9): ranker {id, version, variant, k}, no no_skill_score, no_skill true only
// with no_skill_reason "ack" or "no_match", the block's reason, k, budget_phase and budget_exhausted.
//
// Ranking is a fixed keyword table over ten catalog skills (TABLE below), so the answer depends only on the message and
// the session state. State is one JSON file per session and namespace (shadow or on) under
// ${GBRAIN_HOME:-$HOME/.gbrain}/stub-sessions, holding the turn count, the block tokens spent and the turn each skill was
// last suggested; shadow and on never share it and follow the same delivery rule, so one transcript replayed in each gives
// the same block sequence. The delivery rule, as the contract states it:
//   - block budget 2,000 tokens per session (block_tokens = ceil(chars / 4), the stand-in's tokenizer). Phase by tokens
//     spent before the turn: under_half (k 5), half_to_80 (k 3), over_80 (k 1), exhausted (empty block,
//     budget_exhausted true). A block that would pass the budget is cut by whole lines; if no line fits, exhausted.
//   - after half, only a name, trigger or routing match spends budget (a description-only turn: empty block, reason
//     paced_weak_match).
//   - session-wide no-repeat: a skill already suggested in the session is dropped (deduped) unless the message names it
//     explicitly ("/name" or "name skill"), or it is a strong top-1 match (trigger or name, score >= 3) at least 10 turns
//     after it was last suggested (reason strong_top1_return).
//   - reason is the delivered top line's match kind (name, trigger, routing, description, strong_top1_return), or why the
//     block is empty (ack, no_match, all_repeated, paced_weak_match, budget_exhausted).
//
// Magic input, for the checks: a message equal to __gbrain_stub_index_missing__ is a runtime error (exit 0 under
// --fail-open, exit 1 without, block "", error INDEX_MISSING); an --expect-catalog other than STUB_CATALOG_HASH is the same
// kind of error, code CATALOG_MISMATCH. A message containing __gbrain_stub_index_stale__ answers with meta.index_stale
// true; __gbrain_stub_index_drift__ with an index_hash and gbrain_version no build receipt holds; __gbrain_stub_ack__ or
// __gbrain_stub_no_match__ with that no_skill reason; __gbrain_stub_budget_exhausted__ as a session past its budget.
// --shadow sets shadow true and selects the shadow namespace (GBRAIN_STUB_SHARED_NAMESPACE=1 makes shadow write the on
// namespace instead: the fault the shadow replay preflight exists to catch). Usage errors exit 2. Every call appends one line to
// /tmp/gbrain-stub/calls.ndjson (GBRAIN_STUB_LOG_DIR moves it, for keyless tests on a host): argv, whether
// GBRAIN_SKILLS_NO_AUTOREBUILD is set (never its value), the input, the exit code and the exact stdout.
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');

const STUB_CATALOG_HASH = 'c0ffee5f0b5a2c6e1d8e4b7a9f3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4';
const MAGIC_INDEX_MISSING = '__gbrain_stub_index_missing__';
const MAGIC_INDEX_STALE = '__gbrain_stub_index_stale__';
const MAGIC_INDEX_DRIFT = '__gbrain_stub_index_drift__';
const MAGIC_ACK = '__gbrain_stub_ack__';
const MAGIC_NO_MATCH = '__gbrain_stub_no_match__';
const MAGIC_BUDGET = '__gbrain_stub_budget_exhausted__';
const BUDGET = 2000;
const K = 5;
const RANKER = { id: 'stub', version: '0.0.0-harn52-stub', variant: 'D', k: K };
const HEADER = 'Skills that may fit this request:';
const FOOTER = 'Open one with skills action read.';
const ACK = /^\s*(?:thanks|thank you|ok|okay|got it|cool|great|perfect)\b[\s.!]*$/i;
// name, hint, triggers (3 each), routing phrases (2 each), description words (1 each)
const TABLE = [
  ['careful', 'Safety guardrails for destructive commands.', ['rm -rf', 'destructive', 'force push', 'drop table'], [], ['delete', 'safely', 'dangerous', 'prod']],
  ['systematic-debugging', 'Systematic debugging with root cause investigation.', ['debug', 'root cause', 'broke', 'failing test'], [], ['bug', 'error', 'why']],
  ['review', 'Pre-landing review of a diff.', ['review', 'diff'], [], ['merge', 'risky']],
  ['ship', 'Ship workflow: tests, review and a pull request.', ['ship it', 'deploy'], ['open a pr', 'land this'], ['release']],
  ['document-release', 'Update docs and release notes after shipping.', ['release notes', 'changelog'], [], ['docs', 'tag']],
  ['learn', 'Save and search project learnings.', ['remember', 'learnings'], [], ['save', 'next time']],
  ['qa', 'QA a web app and fix what it finds.', ['qa', 'test the site'], [], ['bugs', 'browser']],
  ['retro', 'Weekly engineering retrospective.', ['retro', 'retrospective'], [], ['week', 'shipped']],
  ['freeze', 'Limit edits to one directory.', ['freeze', 'only edit'], [], ['directory', 'scope']],
  ['office-hours', 'Office hours for a new idea.', ['office hours', 'brainstorm'], [], ['idea', 'startup']],
];

const argv = process.argv.slice(2);
const stdin = (() => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } })();

function log(entry) {
  try {
    const dir = process.env.GBRAIN_STUB_LOG_DIR || '/tmp/gbrain-stub';
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(dir + '/calls.ndjson', JSON.stringify(entry) + '\n');
  } catch { /* logging never changes the answer */ }
}
function finish(code, out, extra) {
  const stdout = out === null ? '' : JSON.stringify(out) + '\n';
  log({ argv, cwd: process.cwd(), no_autorebuild_set: Boolean(process.env.GBRAIN_SKILLS_NO_AUTOREBUILD), stdin, exit: code, stdout, stdout_sha256: crypto.createHash('sha256').update(stdout).digest('hex'), ...extra });
  process.stdout.write(stdout, () => process.exit(code));
}

const flag = (name) => argv.includes(name);
const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const usage = argv[0] !== 'skills' || argv[1] !== 'resolve' || value('--input-json') !== '-' || !flag('--json') || !value('--expect-catalog');
let input = null;
try { input = JSON.parse(stdin); } catch { /* handled below */ }
const message = typeof input?.message === 'string' ? input.message : '';
const has = (magic) => message.includes(magic);
const drift = has(MAGIC_INDEX_DRIFT);
const shadow = flag('--shadow');
const base = { schema_version: 1, gbrain_version: drift ? '0.0.1-harn52-stub-drift' : '0.0.0-harn52-stub', catalog: 'harn52-public', catalog_hash: STUB_CATALOG_HASH, index_hash: drift ? 'stub-index-ffffffffffffffff' : 'stub-index-0000000000000000', ranker: RANKER };
const empty = { suggestions: [], no_skill: false, no_skill_reason: null, reason: null, k: K, block: '', block_tokens: 0, budget_phase: 'under_half', budget_exhausted: false, deduped: [], shadow };
const fail = (code, msg) => finish(flag('--fail-open') ? 0 : 1, { ...base, ...empty, meta: { index_stale: false, timing_ms: 0 }, error: { code, message: msg } });

const phaseOf = (spent) => (spent >= BUDGET ? 'exhausted' : spent >= BUDGET * 0.8 ? 'over_80' : spent >= BUDGET / 2 ? 'half_to_80' : 'under_half');
const kOf = (phase) => ({ under_half: 5, half_to_80: 3, over_80: 1, exhausted: 0 })[phase];
const tokens = (s) => Math.ceil(s.length / 4);
function rank(text) {
  const t = text.toLowerCase();
  const out = [];
  for (const [name, hint, triggers, routing, words] of TABLE) {
    const named = new RegExp('(?:^|\\s)/' + name + '\\b|\\b' + name + '\\s+skill\\b').test(t);
    const tr = triggers.filter((w) => t.includes(w));
    const ro = routing.filter((w) => t.includes(w));
    const de = words.filter((w) => new RegExp('\\b' + w + '\\b').test(t));
    const score = (named ? 3 : 0) + 3 * tr.length + 2 * ro.length + de.length;
    if (!score) continue;
    const kind = named ? 'name' : tr.length ? 'trigger' : ro.length ? 'routing' : 'description';
    const terms = [...(named ? [name] : []), ...tr, ...ro, ...de];
    out.push({ id: name, name, score, hint, path: 'skills/' + name + '/SKILL.md', kind, reason: kind + ': ' + terms.map((w) => JSON.stringify(w)).join(', ') });
  }
  return out.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : 1));
}
function stateFile(session, namespace) {
  const root = (process.env.GBRAIN_HOME || ((process.env.HOME || '/tmp') + '/.gbrain')) + '/stub-sessions';
  return root + '/' + crypto.createHash('sha256').update(String(session)).digest('hex').slice(0, 16) + '.' + namespace + '.json';
}
function resolveTurn() {
  const file = stateFile(input.session_id ?? '', shadow && !process.env.GBRAIN_STUB_SHARED_NAMESPACE ? 'shadow' : 'on');
  let st = { turn: 0, spent: 0, last: {} };
  try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new session */ }
  const turn = st.turn + 1;
  const forcedOut = has(MAGIC_BUDGET);
  const phase = forcedOut ? 'exhausted' : phaseOf(st.spent);
  const k = kOf(phase);
  const out = { ...empty, k, budget_phase: phase };
  const save = () => { fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ ...st, turn })); };
  const ranked = rank(message);
  const strip = ({ kind, ...s }) => s;
  if (phase === 'exhausted') { save(); return { ...out, suggestions: ranked.slice(0, K).map(strip), reason: 'budget_exhausted', budget_exhausted: true }; }
  const ack = has(MAGIC_ACK) || ACK.test(message);
  if (ack || has(MAGIC_NO_MATCH) || !ranked.length) { save(); const why = ack ? 'ack' : 'no_match'; return { ...out, no_skill: true, no_skill_reason: why, reason: why }; }
  const strongTop = ranked[0].score >= 3 && (ranked[0].kind === 'name' || ranked[0].kind === 'trigger');
  const deduped = [];
  const eligible = ranked.filter((c, i) => {
    const last = st.last[c.name];
    if (last === undefined || c.kind === 'name') return true;
    if (i === 0 && strongTop && turn - last >= 10) { c.returned = true; return true; }
    deduped.push(c.name);
    return false;
  });
  if (!eligible.length) { save(); return { ...out, deduped, reason: 'all_repeated' }; }
  const spendable = phase === 'under_half' ? eligible : eligible.filter((c) => c.kind !== 'description');
  if (!spendable.length) { save(); return { ...out, deduped, reason: 'paced_weak_match' }; }
  let chosen = spendable.slice(0, k);
  const render = (cs) => [HEADER, ...cs.map((c) => '- ' + c.name + ': ' + c.hint), FOOTER].join('\n');
  while (chosen.length && st.spent + tokens(render(chosen)) > BUDGET) chosen = chosen.slice(0, -1);
  if (!chosen.length) { st.spent = BUDGET; save(); return { ...out, deduped, suggestions: spendable.slice(0, k).map(strip), reason: 'budget_exhausted', budget_exhausted: true }; }
  const block = render(chosen);
  st.spent += tokens(block);
  for (const c of chosen) st.last[c.name] = turn;
  save();
  return { ...out, suggestions: chosen.map(({ returned, ...c }) => strip(c)), deduped, reason: chosen[0].returned ? 'strong_top1_return' : chosen[0].kind, block, block_tokens: tokens(block) };
}

if (usage) {
  process.stderr.write('usage: gbrain skills resolve --input-json - --json [--fail-open] --expect-catalog <hash> [--shadow]\n');
  finish(2, null, { usage_error: true });
} else if (!input || typeof input.message !== 'string') fail('BAD_INPUT', 'stub: stdin is not a JSON object with a message string');
else if (value('--expect-catalog') !== STUB_CATALOG_HASH) fail('CATALOG_MISMATCH', 'stub: --expect-catalog does not match the index catalog_hash');
else if (input.message === MAGIC_INDEX_MISSING) fail('INDEX_MISSING', 'stub: skill index missing (forced by magic input)');
else finish(0, { ...base, ...resolveTurn(), meta: { index_stale: has(MAGIC_INDEX_STALE), timing_ms: 3 } });
