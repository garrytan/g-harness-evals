#!/usr/bin/env bun
// Stand-in for the gbrain skill resolver (internal-task). The eval's kit now pins the real release (gbrain v0.60.633.0, build-kit.ts
// --gbrain); the stand-in stays as the keyless test double the tests and the kit's default build use. It answers the same command
// lines the eval's hook wrapper and preflight use, with the release's turn output fields (ranker.k is the paced k) and the
// release's index layout and receipt shape (<GBRAIN_HOME>/.gbrain/skill-index/<catalog>/index.bin and receipt.json, receipt
// fields catalog.catalog_hash, index.index_hash, catalog.skill_count, catalog.skipped), plus its own top-level k, block_reason,
// budget_phase and session_block_tokens, which the eval no longer reads (it derives them, result-fields.ts).
//
//   gbrain --version
//   gbrain skills index build --catalog <name> --dir <skills root>... [--harness <h>] [--json]
//   gbrain skills resolve --catalog <name> (--stdin | --input-json -) --json [--session <id>] [--exclude <a,b>] [--top-k <n>]
//       [--harness <h>] [--shadow [--shadow-log <file>]] [--fail-open] [--expect-catalog <hash>]
//
// The index lives under <GBRAIN_HOME>/.gbrain/skill-index/<catalog>/ (~/.gbrain without GBRAIN_HOME): index.bin (JSON), written
// atomically and byte-identical for the same inputs, and receipt.json, the build receipt (build.ms is its only volatile field).
// --shadow-log appends the shadow result to the file, as the release does (the stand-in's stdout still carries it too).
// Ranking is word overlap on the name (weight 3) and description (weight 1) of each skill, with the previous user message at
// half weight; the score is the weighted count of matched terms. There is no score gate (spec section 9): no_skill is true only
// for a known acknowledgement (no_skill_reason "ack") or when no skill matches a term (no_skill_reason "no_match"). No network,
// no model, no clock or randomness. A session (--session or the input's session_id) spends at most 2,000 block tokens, paced
// (spec section 9, last eng review): the budget phase is under_half, half_to_80 (half spent: k at most 3, and only a skill whose
// name matches a message term, or that the message names, is suggested), over_80 (80% spent: k at most 1, same match rule) or
// exhausted (a block that would pass the budget is withheld, and from then on every block of the session is empty with
// budget_exhausted true). The stand-in has no trigger or routing fields, so its name match stands for "name, trigger or routing
// match". A session never repeats a skill it already suggested (session-wide dedupe: repeats leave the candidates before the
// top k are taken, and deduped lists the repeats that would have been in the top k), except a skill the message names
// explicitly and a top-1 skill whose name matches, 10 or more turns after it was last suggested. Every turn counts, ack and
// no_match turns included. Each result carries k (after pacing), block_reason (match, ack, no_match, deduped, below_pace,
// budget_exhausted, error) and budget_phase. The session state is <GBRAIN_HOME>/.gbrain/skill-sessions/<sha256(namespace + "\n" +
// session)>.json, namespace "on" or "shadow": --shadow keeps its own state and advances it under the same delivery rule as on
// mode (as if the block were delivered), so replaying one transcript in shadow and in on mode gives identical block sequences
// (scripts/skill-resolver/shadow-replay-check.ts). A shadow result is marked shadow: the caller injects nothing.
//
// Exit codes: 0 for a result (a no_skill result included); 2 for a usage error (unknown flag, missing value, missing --json
// or input); 1 for a runtime error without --fail-open. With --fail-open a runtime error exits 0 with block "" and
// error {code, message}. Runtime codes: INDEX_MISSING, CATALOG_MISMATCH, INPUT_INVALID, and the stand-in's switch: when
// GBRAIN_STUB_FAIL is set, or <GBRAIN_HOME>/stub-fail exists, its content (default STUB_FAIL) is raised as a runtime error
// code before anything else runs. The second switch, GBRAIN_STUB_BUDGET_EXHAUSTED set or <GBRAIN_HOME>/stub-budget-exhausted
// present, marks the session's block budget spent (block "", budget_exhausted true, budget_phase exhausted). meta.index_stale is true when the SKILL.md files under the index's recorded roots no longer
// hash to the index's catalog_hash. The stand-in never rebuilds an index on its own (GBRAIN_SKILLS_NO_AUTOREBUILD is the
// real resolver's switch; the stand-in behaves as if it were always set).

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const STUB_VERSION = '0.0.0-he-stub.4';
const WEIGHTS = { name_weight: 3, description_weight: 1, previous_message_factor: 0.5, min_term_length: 3 };
const TOP_K_DEFAULT = 5;
/** spec section 9: ranker is {id, version, variant, k}. The stand-in's variant names its overlap scoring, not BM25F's D or T. */
export const RANKER = { id: 'he-stub-overlap', version: '3', variant: 'overlap', k: TOP_K_DEFAULT };
export const SESSION_BLOCK_BUDGET = 2000;
/** Paced budget (spec section 9, last eng review): k falls to 3 once half the budget is spent and to 1 at 80%; after half only a
 *  name match spends budget; a strong top-1 match may return 10 or more turns after it was last suggested. */
export const PACE = { half_at: 0.5, over_80_at: 0.8, k_half_to_80: 3, k_over_80: 1, resuggest_after_turns: 10 };
export type BudgetPhase = 'under_half' | 'half_to_80' | 'over_80' | 'exhausted';
export type BlockReason = 'match' | 'ack' | 'no_match' | 'deduped' | 'below_pace' | 'budget_exhausted' | 'error';
type SessionState = { turn: number; seen: Record<string, number>; spent: number; exhausted: boolean };
/** Known acknowledgements: a whole message made of these words is no_skill "ack". */
const ACK = new Set('ok okay k kk thanks thank you thx ty cool great nice good perfect sure yes yep yeah no nope got it sounds lgtm done awesome noted alright right fine will do'.split(' '));
export const TOKENIZER = 'he-stub-utf8-bytes-div-4';
export const BLOCK_TOKEN_CAP = 400;
export const HINT_MAX = 80;
const TOP_K_MAX = 8;
const MAX_SKILL_BYTES = 262_144;

/** How each harness opens a suggested skill (spec section 3); on Codex each suggestion line also carries the path. */
export const READ_HINTS: Record<string, string> = {
  openclaw: 'read with skills_read',
  'claude-code': 'use the Skill tool',
  codex: 'open the SKILL.md path on its line',
  hermes: 'load with skill_view(name)',
  qm: 'skills action read',
};

type IndexSkill = { id: string; name: string; description: string; path: string; body_sha256: string };
export type SkillIndex = {
  schema_version: 1; catalog: string; harness: string | null; catalog_hash: string; ranker: typeof RANKER;
  tokenizer: string; dirs: string[]; skills: IndexSkill[]; skipped: { path: string; reason: string }[];
};
export type Suggestion = { id: string; name: string; score: number; hint: string; path: string; reason: string };
export type ResolveResult = {
  schema_version: 1; gbrain_version: string; catalog: string; catalog_hash: string | null; index_hash: string | null; harness: string | null;
  session_id: string | null; ranker: typeof RANKER; suggestions: Suggestion[]; no_skill: boolean; no_skill_reason: 'ack' | 'no_match' | null; block: string; block_tokens: number;
  block_reason: BlockReason | null; k: number | null; budget_phase: BudgetPhase | null; tokenizer: string; deduped: string[]; budget_exhausted: boolean; session_block_tokens: number; shadow: boolean; meta: { index_stale: boolean; timing_ms: number }; error?: { code: string; message: string };
};

const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
/** The switch files sit in GBRAIN_HOME itself; the index and sessions under GBRAIN_HOME/.gbrain, the release's config dir. */
const gbrainHome = () => process.env.GBRAIN_HOME || join(homedir(), '.gbrain');
const configDir = () => (process.env.GBRAIN_HOME ? join(process.env.GBRAIN_HOME, '.gbrain') : join(homedir(), '.gbrain'));
const indexDir = () => join(configDir(), 'skill-index');
const atomic = (p: string, body: string) => { writeFileSync(p + '.tmp', body); renameSync(p + '.tmp', p); };
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

class UsageError extends Error {}
class RuntimeFailure extends Error { constructor(public code: string, message: string) { super(message); } }

function frontmatter(text: string): Record<string, string> | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  try {
    const doc = (Bun as unknown as { YAML: { parse(s: string): unknown } }).YAML.parse(m[1]!) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(doc ?? {})) if (typeof v === 'string') out[k] = v.trim();
    return out;
  } catch { return null; }
}

/** Every <root>/<dir>/SKILL.md, in byte order of the directory name, with its frontmatter name and description. */
function scan(dirs: string[]): { skills: IndexSkill[]; skipped: { path: string; reason: string }[] } {
  const skills: IndexSkill[] = [], skipped: { path: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const root of dirs) {
    if (!existsSync(root)) throw new RuntimeFailure('INDEX_SOURCE_MISSING', 'no skills root at ' + root);
    for (const d of readdirSync(root).filter((n) => !n.startsWith('.')).sort()) {
      const p = join(root, d, 'SKILL.md');
      if (!existsSync(p)) continue;
      const buf = readFileSync(p);
      if (buf.length > MAX_SKILL_BYTES) { skipped.push({ path: p, reason: 'over size' }); continue; }
      const fm = frontmatter(buf.toString('utf8'));
      if (!fm || !fm.name) { skipped.push({ path: p, reason: 'no frontmatter' }); continue; }
      if (seen.has(fm.name)) { skipped.push({ path: p, reason: 'duplicate name' }); continue; }
      seen.add(fm.name);
      skills.push({ id: fm.name, name: fm.name, description: (fm.description ?? '').replace(/\s+/g, ' '), path: p, body_sha256: sha(buf) });
    }
  }
  return { skills, skipped };
}

const catalogHash = (skills: IndexSkill[]) => sha([...skills].sort(byId).map((s) => [s.id, s.name, s.description, s.body_sha256, s.path].join('\t') + '\n').join(''));

export function buildIndex(catalog: string, dirs: string[], harness: string | null): { index: SkillIndex; body: string; receipt: Record<string, unknown> } {
  const t0 = performance.now();
  const { skills, skipped } = scan(dirs);
  const index: SkillIndex = { schema_version: 1, catalog, harness, catalog_hash: catalogHash(skills), ranker: RANKER, tokenizer: TOKENIZER, dirs, skills, skipped };
  const body = JSON.stringify(index) + '\n';
  const receipt = {
    schema_version: 1, gbrain_version: STUB_VERSION, gbrain_commit: null, stand_in: true,
    catalog: { name: catalog, catalog_hash: index.catalog_hash, source: { kind: 'dir', dirs }, skill_count: skills.length, skipped, harness },
    ranker: RANKER, index: { file: 'index.bin', index_hash: sha(body) }, block: { token_cap: BLOCK_TOKEN_CAP, tokenizer: TOKENIZER },
    dedupe: 'session', session_block_budget: SESSION_BLOCK_BUDGET, pace: PACE, state_namespaces: ['on', 'shadow'], build: { ms: Math.round(performance.now() - t0) },
  };
  return { index, body, receipt };
}

const STOP = new Set('the and for with that this from your you are was were have has had not but all any can will into out our use using how what when where which who why its about over then than them they their there these those also just like make made does did doing done get got need needs want wants please could would should here been being more most some such very only other each per via'.split(' '));
const terms = (text: string) => [...new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= WEIGHTS.min_term_length && !STOP.has(t)))];
export const blockTokens = (block: string) => Math.ceil(Buffer.byteLength(block, 'utf8') / 4);

function rank(index: SkillIndex, message: string, previous: string, exclude: Set<string>): Suggestion[] {
  const now = terms(message), prev = terms(previous).filter((t) => !now.includes(t));
  if (!now.length && !prev.length) return [];
  const out: Suggestion[] = [];
  for (const s of index.skills) {
    if (exclude.has(s.id) || exclude.has(s.name)) continue;
    const nameTerms = new Set(terms(s.name.replace(/[-_]/g, ' '))), descTerms = new Set(terms(s.description));
    let score = 0;
    const hitName: string[] = [], hitDesc: string[] = [];
    for (const [list, factor] of [[now, 1], [prev, WEIGHTS.previous_message_factor]] as const) {
      for (const t of list) {
        if (nameTerms.has(t)) { score += WEIGHTS.name_weight * factor; hitName.push(t); }
        if (descTerms.has(t)) { score += WEIGHTS.description_weight * factor; hitDesc.push(t); }
      }
    }
    if (!score) continue;
    const fields = [hitName.length ? 'name' : '', hitDesc.length ? 'description' : ''].filter(Boolean).join('+');
    const hits = [...new Set([...hitName, ...hitDesc])].sort();
    const hint = s.description.length > HINT_MAX ? s.description.slice(0, HINT_MAX - 3).trimEnd() + '...' : s.description;
    out.push({ id: s.id, name: s.name, score: Math.round(score * 100) / 100, hint, path: s.path, reason: fields + ': ' + hits.map((h) => JSON.stringify(h)).join(', ') });
  }
  return out.sort((a, b) => b.score - a.score || byId(a, b));
}

/** The block a harness gets: one header line, one line per suggestion carrying the load selector (and the path on Codex),
 *  one line on how to open it. Truncated by whole suggestion lines to the token cap. */
export function renderBlock(suggestions: Suggestion[], harness: string | null): { block: string; kept: Suggestion[] } {
  if (!suggestions.length) return { block: '', kept: [] };
  const header = 'Skills that may fit this request (gbrain skills resolve):';
  const footer = 'To open one: ' + (READ_HINTS[harness ?? ''] ?? 'read its SKILL.md') + '.';
  const line = (s: Suggestion) => harness === 'codex' ? '- ' + s.id + ' (' + s.path + '): ' + s.hint : '- ' + s.id + ': ' + s.hint;
  const render = (k: Suggestion[]) => [header, ...k.map(line), footer].join('\n');
  let kept = [...suggestions];
  while (kept.length > 1 && blockTokens(render(kept)) > BLOCK_TOKEN_CAP) kept = kept.slice(0, -1);
  return { block: render(kept), kept };
}

function readIndex(catalog: string): { index: SkillIndex; hash: string } {
  const p = join(indexDir(), catalog, 'index.bin');
  if (!existsSync(p)) throw new RuntimeFailure('INDEX_MISSING', 'no index for catalog ' + catalog + ' under ' + indexDir() + '; run gbrain skills index build');
  const body = readFileSync(p, 'utf8');
  return { index: JSON.parse(body) as SkillIndex, hash: sha(body) };
}

function stale(index: SkillIndex): boolean {
  try { return catalogHash(scan(index.dirs).skills) !== index.catalog_hash; } catch { return true; }
}

type Input = { message?: unknown; previous_user_message?: unknown; session_id?: unknown; harness?: unknown; top_k?: unknown; exclude?: unknown; shadow?: unknown };

export function resolve(opts: { catalog: string; input: Input; session?: string; harness?: string; topK?: number; exclude?: string[]; shadow: boolean; expectCatalog?: string; inputError?: string }): ResolveResult {
  const t0 = performance.now();
  const harness = opts.harness ?? (typeof opts.input.harness === 'string' ? opts.input.harness : null);
  const session = opts.session ?? (typeof opts.input.session_id === 'string' ? opts.input.session_id : null);
  const shadow = opts.shadow || opts.input.shadow === true;
  const out: ResolveResult = {
    schema_version: 1, gbrain_version: STUB_VERSION, catalog: opts.catalog, catalog_hash: null, index_hash: null, harness, session_id: session, ranker: RANKER,
    suggestions: [], no_skill: false, no_skill_reason: null, block: '', block_tokens: 0, block_reason: null, k: null, budget_phase: null, tokenizer: TOKENIZER, deduped: [],
    budget_exhausted: false, session_block_tokens: 0, shadow, meta: { index_stale: false, timing_ms: 0 },
  };
  const failFile = join(gbrainHome(), 'stub-fail');
  const failSwitch = process.env.GBRAIN_STUB_FAIL || (existsSync(failFile) ? readFileSync(failFile, 'utf8').trim() || 'STUB_FAIL' : '');
  try {
    if (failSwitch) throw new RuntimeFailure(failSwitch, "the stand-in's failure switch raised " + failSwitch);
    const { index, hash } = readIndex(opts.catalog);
    out.catalog_hash = index.catalog_hash;
    out.index_hash = hash;
    if (opts.expectCatalog && opts.expectCatalog !== index.catalog_hash) throw new RuntimeFailure('CATALOG_MISMATCH', "the index's catalog_hash is " + index.catalog_hash + ', the caller expects ' + opts.expectCatalog);
    if (opts.inputError) throw new RuntimeFailure('INPUT_INVALID', opts.inputError);
    if (typeof opts.input.message !== 'string') throw new RuntimeFailure('INPUT_INVALID', 'the input has no message string');
    const message = opts.input.message;
    out.meta.index_stale = stale(index);
    const topK = Math.min(TOP_K_MAX, Math.max(1, Math.floor(opts.topK ?? (typeof opts.input.top_k === 'number' ? opts.input.top_k : TOP_K_DEFAULT))));
    const exclude = new Set([...(opts.exclude ?? []), ...(Array.isArray(opts.input.exclude) ? opts.input.exclude.filter((x): x is string => typeof x === 'string') : [])]);
    const ranked = rank(index, message, typeof opts.input.previous_user_message === 'string' ? opts.input.previous_user_message : '', exclude);
    out.ranker = { ...RANKER, k: topK };
    const statePath = session ? join(configDir(), 'skill-sessions', sha((shadow ? 'shadow' : 'on') + '\n' + session) + '.json') : null;
    const state: SessionState = statePath && existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) as SessionState : { turn: 0, seen: {}, spent: 0, exhausted: false };
    state.turn += 1;
    if (process.env.GBRAIN_STUB_BUDGET_EXHAUSTED || existsSync(join(gbrainHome(), 'stub-budget-exhausted'))) state.exhausted = true;
    const phase: BudgetPhase = state.exhausted ? 'exhausted' : state.spent >= SESSION_BLOCK_BUDGET * PACE.over_80_at ? 'over_80' : state.spent >= SESSION_BLOCK_BUDGET * PACE.half_at ? 'half_to_80' : 'under_half';
    const k = phase === 'exhausted' ? 0 : phase === 'over_80' ? Math.min(topK, PACE.k_over_80) : phase === 'half_to_80' ? Math.min(topK, PACE.k_half_to_80) : topK;
    Object.assign(out, { k, ranker: { ...RANKER, k }, budget_phase: phase, budget_exhausted: state.exhausted, session_block_tokens: state.spent });
    const words = message.toLowerCase().match(/[a-z]+/g) ?? [];
    if (words.length && words.every((w) => ACK.has(w))) Object.assign(out, { no_skill: true, no_skill_reason: 'ack', block_reason: 'ack' });
    else if (!ranked.length) Object.assign(out, { no_skill: true, no_skill_reason: 'no_match', block_reason: 'no_match' });
    else if (state.exhausted) out.block_reason = 'budget_exhausted';
    else {
      const now = terms(message), lower = message.toLowerCase();
      const nameMatch = (s: Suggestion) => terms(s.name.replace(/[-_]/g, ' ')).some((t) => now.includes(t));
      const explicit = (s: Suggestion) => new RegExp('(^|[^a-z0-9_-])' + s.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9_-])').test(lower);
      const eligible = phase === 'under_half' ? ranked : ranked.filter((s) => nameMatch(s) || explicit(s));
      const strongTop = nameMatch(ranked[0]!) ? ranked[0]!.id : null;
      const repeat = (s: Suggestion) => s.id in state.seen && !explicit(s) && !(s.id === strongTop && state.turn - state.seen[s.id]! >= PACE.resuggest_after_turns);
      out.deduped = eligible.slice(0, k).filter(repeat).map((s) => s.id);
      const { block, kept } = renderBlock(eligible.filter((s) => !repeat(s)).slice(0, k), harness);
      const tokens = blockTokens(block);
      if (!eligible.length) out.block_reason = 'below_pace';
      else if (!block) out.block_reason = 'deduped';
      else if (state.spent + tokens > SESSION_BLOCK_BUDGET) {
        state.exhausted = true;
        Object.assign(out, { budget_exhausted: true, budget_phase: 'exhausted', block_reason: 'budget_exhausted' });
      } else {
        state.spent += tokens;
        for (const s of kept) state.seen[s.id] = state.turn;
        Object.assign(out, { suggestions: kept, block, block_tokens: tokens, block_reason: 'match', session_block_tokens: state.spent });
      }
    }
    if (statePath) { mkdirSync(dirname(statePath), { recursive: true }); atomic(statePath, JSON.stringify(state)); }
  } catch (e) {
    if (!(e instanceof RuntimeFailure)) throw e;
    Object.assign(out, { suggestions: [], block: '', block_tokens: 0, block_reason: 'error', no_skill: false, error: { code: e.code, message: e.message } });
  }
  out.meta.timing_ms = Math.round((performance.now() - t0) * 100) / 100;
  return out;
}

function parseArgs(argv: string[], spec: Record<string, 'flag' | 'value' | 'list'>): Record<string, string | boolean | string[]> {
  const out: Record<string, string | boolean | string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) throw new UsageError('unexpected argument ' + a);
    const k = a.slice(2), kind = spec[k];
    if (!kind) throw new UsageError('unknown flag ' + a);
    if (kind === 'flag') { out[k] = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new UsageError(a + ' needs a value');
    if (kind === 'list') out[k] = [...((out[k] as string[] | undefined) ?? []), v]; else out[k] = v;
  }
  return out;
}

function main(argv: string[]): number {
  if (argv[0] === '--version' || argv[0] === 'version') { process.stdout.write('gbrain ' + STUB_VERSION + '\n'); return 0; }
  if (argv[0] !== 'skills') throw new UsageError('the stand-in implements only "skills index build" and "skills resolve"');
  if (argv[1] === 'index' && argv[2] === 'build') {
    const a = parseArgs(argv.slice(3), { catalog: 'value', dir: 'list', harness: 'value', json: 'flag', 'from-json': 'value' });
    if (typeof a.catalog !== 'string' || !Array.isArray(a.dir)) throw new UsageError('index build needs --catalog <name> and at least one --dir <skills root>');
    if (a['from-json'] !== undefined) throw new UsageError('the stand-in does not implement --from-json');
    const { body, receipt } = buildIndex(a.catalog, a.dir, typeof a.harness === 'string' ? a.harness : null);
    mkdirSync(join(indexDir(), a.catalog), { recursive: true });
    atomic(join(indexDir(), a.catalog, 'index.bin'), body);
    atomic(join(indexDir(), a.catalog, 'receipt.json'), JSON.stringify(receipt, null, 1) + '\n');
    process.stdout.write(JSON.stringify(receipt) + '\n');
    return 0;
  }
  if (argv[1] === 'resolve') {
    const a = parseArgs(argv.slice(2), { catalog: 'value', stdin: 'flag', 'input-json': 'value', json: 'flag', session: 'value', exclude: 'value', 'top-k': 'value', harness: 'value', shadow: 'flag', 'shadow-log': 'value', 'fail-open': 'flag', 'expect-catalog': 'value' });
    if (typeof a.catalog !== 'string') throw new UsageError('resolve needs --catalog <name>');
    if (!a.json) throw new UsageError('resolve needs --json');
    if (!a.stdin && a['input-json'] !== '-') throw new UsageError('resolve needs --stdin or --input-json -');
    if (a['top-k'] !== undefined && !/^[1-9][0-9]*$/.test(String(a['top-k']))) throw new UsageError('--top-k needs a positive integer');
    let input: Input = {}, inputError = '';
    try {
      const parsed = JSON.parse(readFileSync(0, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Input; else inputError = 'stdin is not a JSON object';
    } catch (e) { inputError = 'stdin is not JSON: ' + (e as Error).message; }
    const r = resolve({ catalog: a.catalog, input, session: a.session as string | undefined, harness: a.harness as string | undefined, topK: a['top-k'] ? Number(a['top-k']) : undefined,
      exclude: typeof a.exclude === 'string' ? a.exclude.split(',').filter(Boolean) : undefined, shadow: !!a.shadow, expectCatalog: a['expect-catalog'] as string | undefined, inputError });
    process.stdout.write(JSON.stringify(r) + '\n');
    if (typeof a['shadow-log'] === 'string' && r.shadow && !r.error) appendFileSync(a['shadow-log'], JSON.stringify(r) + '\n');
    return r.error && !a['fail-open'] ? 1 : 0;
  }
  throw new UsageError('unknown command skills ' + (argv[1] ?? ''));
}

if (import.meta.main) {
  try { process.exit(main(process.argv.slice(2))); }
  catch (e) {
    if (e instanceof UsageError) { process.stderr.write('gbrain: usage: ' + e.message + '\n'); process.exit(2); }
    process.stderr.write('gbrain: ' + ((e as Error).stack ?? String(e)) + '\n');
    process.exit(1);
  }
}
