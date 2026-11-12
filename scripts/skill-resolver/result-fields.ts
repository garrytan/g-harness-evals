// The one table from the pinned resolver build's result field names to the names the eval uses (internal-task). The hook wrapper,
// the shadow replay check, preflight and the capture checks read every resolve result through normalizeResult, so when the
// pinned gbrain build names a field differently, the fix is one edit here: set "from" to the build's name (a dotted path for a
// nested field), and list any enum values it spells differently under "values" (the build's value to ours). The pin is gbrain
// v0.60.633.0 (docs/schemas/skill-resolver.v1.turn-output.json there); the stand-in (gbrain-stub.ts) answers in the same shape.
//
// Three status fields are not in the release's turn output, so the eval derives them (deriveSessionFields below) from what the
// release does output and from the running total of block tokens the trial's own wrapper has delivered in the session (the
// hook wrapper and QM's wrapper keep it per session and mode, so shadow turns keep their own total):
//   session_block_tokens  the total before this turn plus this turn's block_tokens when its block is non-empty
//   budget_phase          exhausted once any turn of the session has been (the result says budget_exhausted or the total
//                         reaches the budget), otherwise the phase of the total before this turn (the one the release paces
//                         k by): under_half, half_to_80 or over_80. It stays exhausted on later acknowledgement turns, which
//                         the release answers with budget_exhausted false (resolve.ts:290 returns before the check at :346)
//   block_reason          error, ack, no_match, match (a non-empty block) and budget_exhausted map directly; an empty block with
//                         any deduped id is deduped (a paced turn lists none); otherwise below_pace once half the budget was
//                         spent before the turn, else empty (an empty block the output gives no reason for)
// The budget is the release's default (SESSION_TOKEN_BUDGET, config.ts DEFAULT_SESSION_TOKEN_BUDGET); the kit writes no
// config.json, so no trial changes it.

export const RESULT_FIELDS = {
  schema_version: { from: 'schema_version' },
  gbrain_version: { from: 'gbrain_version' },
  catalog_hash: { from: 'catalog_hash' },
  index_hash: { from: 'index_hash' },
  block: { from: 'block' },
  block_tokens: { from: 'block_tokens' },
  suggestions: { from: 'suggestions' },
  deduped: { from: 'deduped' },
  no_skill: { from: 'no_skill' },
  no_skill_reason: { from: 'no_skill_reason', values: {} },
  budget_exhausted: { from: 'budget_exhausted' },
  k: { from: 'ranker.k' },
  shadow: { from: 'shadow' },
  index_stale: { from: 'meta.index_stale' },
  timing_ms: { from: 'meta.timing_ms' },
  error: { from: 'error' },
  error_code: { from: 'error.code', values: { skill_index_missing: 'INDEX_MISSING', skill_catalog_mismatch: 'CATALOG_MISMATCH', skill_resolve_invalid_input: 'INPUT_INVALID' } },
  error_message: { from: 'error.message' },
} as const satisfies Record<string, { from: string; values?: Record<string, string> }>;

/** Inside each entry of suggestions: the build's name for the skill id, falling back to its name field. */
export const SUGGESTION_FIELDS = { id: 'id', name: 'name' } as const;

/** The build receipt (docs/schemas/skill-resolver.v1.build-receipt.json): our names to its dotted paths. */
export const RECEIPT_FIELDS = {
  gbrain_version: 'gbrain_version', gbrain_commit: 'gbrain_commit', catalog_hash: 'catalog.catalog_hash', index_hash: 'index.index_hash',
  skill_count: 'catalog.skill_count', skipped: 'catalog.skipped',
} as const;

/** Where the build receipt sits under a GBRAIN_HOME: the release keeps its files under GBRAIN_HOME/.gbrain (paths.ts). */
export const receiptPathIn = (gbrainHome: string, catalog: string) => gbrainHome.replace(/\/+$/, '') + '/.gbrain/skill-index/' + catalog + '/receipt.json';

/** skills.resolver.session_token_budget's default at the pin (config.ts DEFAULT_SESSION_TOKEN_BUDGET). */
export const SESSION_TOKEN_BUDGET = 2000;

export type SessionFields = { session_block_tokens: number | null; budget_phase: string | null; block_reason: string | null };
/** What the wrapper keeps per session and mode between turns: delivered block tokens so far and whether the budget ran out. */
export type SessionBefore = { spent: number; exhausted: boolean };
export const FRESH_SESSION: SessionBefore = { spent: 0, exhausted: false };
export type NormalizedResult = {
  schema_version: unknown; gbrain_version: string | null; catalog_hash: string | null; index_hash: string | null; block: string; block_tokens: number | null;
  suggestions: string[]; deduped: string[]; no_skill: boolean | null; no_skill_reason: string | null; budget_exhausted: boolean | null;
  k: number | null; shadow: boolean | null; index_stale: boolean | null; timing_ms: number | null; error: unknown; error_code: string | null; error_message: string | null;
} & SessionFields;
export type NormalizedReceipt = { gbrain_version: string | null; gbrain_commit: string | null; catalog_hash: string | null; index_hash: string | null; skill_count: number | null; skipped: unknown[] };

const at = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);
const str = (v: unknown) => (typeof v === 'string' ? v : null), num = (v: unknown) => (typeof v === 'number' ? v : null), bool = (v: unknown) => (typeof v === 'boolean' ? v : null);

/** The three status fields the release does not output, from its result and the session's delivered block tokens before this turn. */
export function deriveSessionFields(f: Omit<NormalizedResult, keyof SessionFields>, before: SessionBefore, budget = SESSION_TOKEN_BUDGET): SessionFields {
  const spentBefore = before.spent;
  const total = spentBefore + (f.block ? f.block_tokens ?? 0 : 0);
  if (f.error) return { session_block_tokens: spentBefore, budget_phase: null, block_reason: 'error' };
  const phase = before.exhausted || f.budget_exhausted || total >= budget ? 'exhausted' : spentBefore >= budget * 0.8 ? 'over_80' : spentBefore >= budget * 0.5 ? 'half_to_80' : 'under_half';
  const reason = f.no_skill_reason === 'ack' || f.no_skill_reason === 'no_match' ? f.no_skill_reason : f.block ? 'match' : f.budget_exhausted ? 'budget_exhausted'
    : f.deduped.length ? 'deduped' : spentBefore >= budget * 0.5 ? 'below_pace' : 'empty';
  return { session_block_tokens: total, budget_phase: phase, block_reason: reason };
}

/** The result under the eval's names, each field typed or null when the build gave something else or nothing. Given the session's
 *  state before this turn (delivered block tokens and whether the budget ran out), the derived session fields too; without
 *  it they are null. */
export function normalizeResult(raw: unknown, before?: SessionBefore): NormalizedResult {
  const get = (name: keyof typeof RESULT_FIELDS) => {
    const f: { from: string; values?: Record<string, string> } = RESULT_FIELDS[name];
    const v = at(raw, f.from);
    return typeof v === 'string' && f.values && v in f.values ? f.values[v] : v;
  };
  const suggestions = get('suggestions');
  const deduped = get('deduped');
  const base = {
    schema_version: get('schema_version'), gbrain_version: str(get('gbrain_version')), catalog_hash: str(get('catalog_hash')), index_hash: str(get('index_hash')),
    block: str(get('block')) ?? '', block_tokens: num(get('block_tokens')),
    suggestions: Array.isArray(suggestions) ? suggestions.map((s) => String(at(s, SUGGESTION_FIELDS.id) ?? at(s, SUGGESTION_FIELDS.name))) : [],
    deduped: Array.isArray(deduped) ? deduped.map(String) : [], no_skill: bool(get('no_skill')), no_skill_reason: str(get('no_skill_reason')),
    budget_exhausted: bool(get('budget_exhausted')), k: num(get('k')), shadow: bool(get('shadow')), index_stale: bool(get('index_stale')), timing_ms: num(get('timing_ms')),
    error: get('error') ?? null, error_code: get('error') ? String(get('error_code') ?? 'ERROR') : null, error_message: get('error') ? String(get('error_message') ?? '') : null,
  };
  const session: SessionFields = before ? deriveSessionFields(base, before) : { session_block_tokens: null, budget_phase: null, block_reason: null };
  return { ...base, ...session };
}

/** A build receipt under the eval's names. */
export function normalizeReceipt(raw: unknown): NormalizedReceipt {
  const skipped = at(raw, RECEIPT_FIELDS.skipped);
  return {
    gbrain_version: str(at(raw, RECEIPT_FIELDS.gbrain_version)), gbrain_commit: str(at(raw, RECEIPT_FIELDS.gbrain_commit)), catalog_hash: str(at(raw, RECEIPT_FIELDS.catalog_hash)),
    index_hash: str(at(raw, RECEIPT_FIELDS.index_hash)), skill_count: num(at(raw, RECEIPT_FIELDS.skill_count)), skipped: Array.isArray(skipped) ? skipped : [],
  };
}
