// Shared contracts between the runner, the adapters, the task graders and the scripted executor.
// This file is the agreement M1 lanes build against; change it in one PR and update every consumer.
//
//   runner/run.ts run            drives a trial: world, proxy, harness container, turns, fence, snapshot, grade
//   harnesses/<name>/adapter.sh  serve: answers TurnRequest files with TurnResponse files (docs/adapters.md)
//   runner/grade/                gradeTrial(TrialEvidence) -> GradeResult from predicates in task.toml (docs/tasks.md)
//   runner/scripted/             executeScript: an oracle or mutation acting on the world through world-MCP

import type { WorldEvent } from '../world/services/events.ts';

// ---- adapter turn protocol (multi-user trials) -------------------------------------------------------

/** One actor message the runner hands to the harness. Written by the runner as
 *  $HE_TURNS_DIR/turn-<NNNN>.request.json (atomic rename). The adapter answers with
 *  turn-<NNNN>.response.json. `prompt` is the full text the harness must receive, composed by the
 *  runner from tasks/multiuser/_shared/preamble.md and the fields below, identical for every harness. */
export interface TurnRequest {
  turn: number;
  trial_id: string;
  prompt: string;
  actor: { member: string; slack_user_id: string; name: string; role: string; team: string | null };
  channel: { id: string; name: string; type: 'dm' | 'channel' };
  text: string;
  /** Slack ts of the actor's message in the world (already posted by the runner). */
  ts: string;
  thread_ts: string | null;
  /** Simulation clock at the message, ISO-8601 with offset. */
  sim_now: string;
  /** Wall-clock seconds the adapter has for this turn; the runner kills the container 60 s later. */
  time_budget_s: number;
}

/** The adapter's answer. exit follows docs/adapters.md: 0 completed, 2 harness error, 3 model error,
 *  124 wall clock. reply_text is the harness's final answer for this turn; the runner posts it to the
 *  world as the bot, in the request's channel and thread, so the grader reads it from world state. */
export interface TurnResponse {
  turn: number;
  exit: 0 | 2 | 3 | 124;
  reply_text: string | null;
  started_at: string;
  ended_at: string;
  detail?: string;
}

// ---- evidence the grader receives -----------------------------------------------------------------

/** The evaluator-owned record of one turn: who asked, where, and which world events (by seq) fell
 *  inside the harness's work on it. Reads between started_seq and ended_seq are attributed to this
 *  turn's requester. */
export interface TurnWindow {
  turn: number;
  actor: string;
  slack_user_id: string;
  channel: string;
  channel_name: string;
  channel_type: 'dm' | 'channel';
  text: string;
  request_ts: string;
  started_wall: string;
  ended_wall: string;
  /** seq of the last world event before the request was handed over. */
  started_seq: number;
  /** seq of the last world event when the response was read. */
  ended_seq: number;
  exit: 0 | 2 | 3 | 124;
  /** Slack ts of the bot reply the runner posted, null when the turn produced none. */
  reply_ts: string | null;
  reply_text: string | null;
  /** internal-task (H10) addition: the Slack thread ts the turn was posted in, null for a top-level message. Optional until the
   *  runner writes it (H10 PR 5), so turns.jsonl files written before it still parse. */
  thread_ts?: string | null;
  /** internal-task (H10) addition: the turn's session, `<channel id>` for a top-level message or `<channel id>:<thread_ts>` in a
   *  thread, the same key every adapter derives from the TurnRequest (harnesses/routes/README.md, "Sessions"). Optional until
   *  the runner writes it (H10 PR 5). */
  session_key?: string;
}

/** GET /admin/snapshot as the world returns it after the fence. Files are not in the snapshot; graders
 *  load them from the seed filtered by split when a predicate needs them. */
export interface WorldSnapshot {
  trial_id: string;
  split: 'dev' | 'heldout' | 'both';
  clock: { reference: string; time_zone: string; offset_minutes: number; advanced_seconds: number };
  now: string;
  fenced: boolean;
  channels: Array<{ id: string; name: string; kind: string; members: string[] }>;
  messages: Array<{ id: string; channel: string; author: string; ts: string; text: string; thread_ts?: string | null }>;
  calendar: unknown[];
  mail: unknown[];
  pending_actions: unknown[];
  events: number;
}

export interface TrialEvidence {
  trial_id: string;
  /** tasks/multiuser/<split>/<id> */
  task_dir: string;
  split: 'dev' | 'heldout';
  /** world/seed/world.json path the trial ran on */
  world_path: string;
  bot_member: string;
  snapshot: WorldSnapshot;
  events: WorldEvent[];
  turns: TurnWindow[];
}

export interface PredicateResult {
  id: string;
  /** v0.2 task slice addition: 'secondary' is a predicate listed in predicates.secondary of task.toml; it is
   *  evaluated and recorded but never decides the grade (docs/tasks.md). */
  kind: 'required' | 'forbidden_effect' | 'secondary';
  passed: boolean;
  /** Which predicate type evaluated it and what it saw: event seqs, message ts, the matched text. */
  evidence: string;
  /** Set when the predicate needs a harness capability (scheduler, delegation) recorded in pin.json;
   *  the report keeps such predicates in the capability table, never in the primary endpoint. */
  capability?: string;
}

export type Termination = 'completed' | 'timeout' | 'approval_stop' | 'harness_error' | 'model_error' | 'infra_error' | 'exam_fault';

export interface GradeResult {
  grade: 'pass' | 'fail' | 'n/a';
  predicates: PredicateResult[];
  consent_violation: boolean;
  approval_stop: boolean;
  /** Effect classes observed (methodology item 9): paid, destructive, credentials, egress, persistent_install, capture. */
  effects: string[];
}

// ---- scripted oracle and mutation solutions ---------------------------------------------------------

/** An oracle (passes every predicate) or a mutation (fails exactly one) is a script the scripted executor
 *  plays against a live world as the bot: per turn, a list of world-MCP tool calls and the reply the
 *  runner would post. The executor reads TurnRequests like an adapter would, so the same runner path
 *  grades a scripted trial and a harness trial. */
export interface ScriptedTurn {
  turn: number;
  calls: Array<{ tool: string; args: Record<string, unknown> }>;
  reply: string | null;
  /** Pretend the harness failed this turn with this exit (for termination fixtures). */
  exit?: 2 | 3 | 124;
}

export interface Script {
  /** "oracle" or the predicate id this mutation violates. */
  id: string;
  task: string;
  turns: ScriptedTurn[];
}

// ---- M1 lane A additions: what the runner writes about a trial -------------------------------------

/** M1 lane A addition: the placeholders the runner fills in tasks/multiuser/_shared/preamble.md, so the
 *  preamble author and the runner agree on the names. A preamble that carries any other {{name}} is
 *  refused with HE-TASK-003 instead of reaching a harness half filled. */
export const PREAMBLE_PLACEHOLDERS = [
  'requester_name', 'requester_handle', 'requester_role', 'requester_team',
  'channel_name', 'channel_type', 'sim_now', 'message', 'bot_name', 'request_ts',
] as const;

/** M1 lane A addition: how the harness under test is run. docker is the real thing (docs/adapters.md);
 *  process runs an adapter script on the host for keyless tests; scripted plays a Script with no harness. */
export type HarnessMode = 'docker' | 'process' | 'scripted';

/** M1 lane A addition: usage.json, the metering proxy's meter for one trial token plus the token sums from the
 *  usage lines it wrote under it. cached_tokens is the cache-read count the provider reported. meter_id is the
 *  per-trial dummy token the harness sent as its API key and the proxy metered under (`trial-token:<trial id>`;
 *  receipts committed before 2026-10-26 carry `key: "sk-trial-<trial id>"`). It is never a credential. */
export interface TrialUsage {
  meter_id: string;
  requests: number;
  refused: number;
  failed: number;
  usd: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  /** Prompt archaeology addition: the cache-write tokens Anthropic reported (cache_creation_input_tokens) on the forwarded harness lines.
   *  Present only when a usage line carried the field; OpenAI reports cache reads only. */
  cache_write_tokens?: number;
  unpriced: number;
  by_model: Record<string, { usd: number; requests: number }>;
  upstream: { statuses: Record<string, number>; failed: number; unparseable: number } | null;
}

/** gbrain arm lane D addition: a cell's gbrain configuration (docs/gbrain-arm.md). Present on a cell, the runner
 *  starts a gbrain sidecar per trial and the harness registers a second MCP server named gbrain through the
 *  world's /gbrain tap. surface is the gbrain tool surface the sidecar serves. The install ladder makes the
 *  fields orthogonal rungs: surface, install and embeddings, each defaulting to the gbrain arm's value, so the arm's
 *  cells ({surface: "starter"}) keep their meaning and a rung is a readable combination (docs/gbrain-arm.md, "The install
 *  ladder"). Defaults are resolved in the manifest and the trial record, never by mutating the cell. */
export interface GbrainCellConfig {
  /** "starter" (33 tools, the arm's surface) or "verbs" (gbrain's seven memory verbs; the page search is recall). */
  surface: 'starter' | 'verbs';
  /** Install ladder addition: "mcp" (default): the MCP registration only, as the arm does. "gbrain-docs": gbrain's own documented
   *  install for the harness at the pinned commit (the install bundle the image carries, gbrain/pin.json "install") is
   *  applied inside the harness container by the adapter before the first turn; the preamble is untouched.
   *  "gbrain-installer" (gbrain#7489): what `gbrain setup <harness> --instructions-only` at the pinned commit writes into
   *  the harness's own instruction file (OpenClaw /workspace/AGENTS.md, Hermes $HERMES_HOME/SOUL.md, Claude Code $CLAUDE_CONFIG_DIR/CLAUDE.md,
   *  Codex $CODEX_HOME/AGENTS.md) with its per-turn hook, applied the same way; a
   *  gbrain commit without that setup target fails preflight (HE-GBRAIN-006). */
  install?: 'mcp' | 'gbrain-docs' | 'gbrain-installer';
  /** Install ladder addition: "off" (default): the keyword brain, no model call. A model name: the sidecar serves the brain built
   *  with that embedding model and embeds each query through the metering proxy (OPENAI_BASE_URL), metered per trial. */
  embeddings?: 'off' | 'openai:text-embedding-3-small';
  /** Company brain addition: the prebuilt brain the sidecar serves. Absent or "bot-visible" is the gbrain arm's
   *  brain; "company" holds every record of the split behind per-member source grants (docs/gbrain-arm.md, "Company brain"). */
  brain?: 'bot-visible' | 'company' | 'member';
  /** Member brain addition: "live" makes the world write every message of the scenario (an actor's turn, the bot's reply, every
   *  post or DM the bot makes) into the brain as a remember fact with provenance, in the source of the conversation it was
   *  posted in (a DM with the bot into private-<member>), under that source's ingest token, before the next turn starts;
   *  member brain only. Absent or "off": the brain holds what it was built with. */
  ingest?: 'off' | 'live';
  /** Company brain addition: "member" makes the world's tap present the requesting member's gbrain token (public-only before
   *  the first turn) instead of the trial's one unscoped token; company brain only. Absent: every call carries the
   *  unscoped token and the brain answers as the bot. Install ladder addition (gbrain#7481): "sources" keeps the unscoped token
   *  and makes the tap add source_ids to every search and query (and recall and list_pages, gbrain#8074), the sources the requesting member may read (the public
   *  source before the first turn), so one bot token narrows per request; company brain only. Member-sources addition
   *  (gbrain#8074): "member-sources" does both, the requesting member's token (granted server-side with gbrain auth rescope at
   *  image build) and that member's source_ids on every narrowed call; company brain, and the member brain, where it
   *  also satisfies live ingestion's need for the member's own token. */
  scope?: 'member' | 'sources' | 'member-sources';
  /** internal-task addition (the access-rules rerun, gbrain#8134): "rules" serves the member brain built with gbrain's folder rules (one
   *  per source with a reader set, prefix <split>/, the source's readers) and member-bound tokens with no source grant, so the
   *  rules are the only read gate (docs/gbrain-arm.md, "Access-ruled member brain"). Needs brain "member" and scope "member", and
   *  no live ingestion; preflight checks the bindings, the rules and a tap probe per member before any trial (HE-GBRAIN-002). */
  access?: 'rules';
}

/** The install bundle view a gbrain-docs or gbrain-installer trial mounted into the harness, as the runner verified it
 *  before the harness started. */
export interface TrialGbrainInstall {
  harness: string;
  split: 'dev' | 'heldout';
  /** The view's install kind; absent in records written before the installer rung (always gbrain-docs there). */
  install?: 'gbrain-docs' | 'gbrain-installer';
  /** Files in the view (the harness workspace and, for Hermes, .hermes.md) and the view digest from the bundle manifest. */
  files: number;
  view_digest: string;
  /** Hermes only: how many pages the always-loaded context names, and how many of those each actor of the task cannot read in the
   *  world (channel membership for a chat page, the file rule for a file): the exposure that reaches the model with no gbrain call. */
  context?: { kept_slugs: number; outside_scope_by_actor: Record<string, number>; outside_scope_max: number };
  /** gbrain-installer at gbrain#7489's per-turn-hook head (10949a15): the hook the bundle carries (its file count and the harness's own
   *  account of it from the adapter's ready: "loaded" for OpenClaw's plugins inspect --runtime, "healthy" for hermes hooks doctor, "ran"
   *  for Claude Code and Codex when the installed UserPromptSubmit command printed the recorded rule (gbrain#7989); the
   *  adapter exits 2 before ready otherwise; "absent from bundle" when an installer view carries no hook, so a block-only image in a
   *  hook run is visible and compare-run leaves its trials out). Absent in records written before the hook.
   *  turn_runs (issue #153), only when status is "ran": per turn the adapter answered, the gbrain_turn_hook_runs the Claude Code or
   *  Codex adapter wrote into logs/turns/turn-NNNN.status.json (gbrain's heartbeat count for that turn), read when the answer
   *  arrives and before the next turn starts, null when the file or the field is missing; a turn the runner ended itself (its
   *  timeout, or the harness gone) is left out, so a trial that ended there in its first turn has an empty list. "ran" proves only that the adapter ran the hook command once before ready; turn_runs is the evidence the
   *  harness fired it during each turn, and installerNotApplied reads it. turns (issue #193): the turn number of each turn_runs entry,
   *  since a turn answered with exit 2 is left out and positions then stop being turn numbers; absent in records written before it.
   *  Without it, or with a list of another length, installerNotApplied names the position, which is the turn number only when no
   *  turn was left out; which trials it excludes does not depend on turns. */
  turn_hook?: { files: number; status: string; turn_runs?: Array<number | null>; turns?: number[] };
}

/** The turn_hook statuses that mean the hook was in place before the first turn: the harness reported it (OpenClaw's plugins inspect,
 *  Hermes's hooks doctor), or, for Claude Code and Codex, which have no non-interactive hook listing, the adapter ran the installed
 *  hook command the way the harness runs it and got the rule back ("ran"); compare-run leaves an installer trial with any other status
 *  out of the pairs, and a "ran" trial also needs every turn's turn_runs at 1 or more (installerNotApplied). */
export const TURN_HOOK_APPLIED: readonly string[] = ['loaded', 'healthy', 'ran'];

/** Why an installer cell's trial did not get the installer, or null when it did (issue #153). No install record; a turn_hook status
 *  outside TURN_HOOK_APPLIED; or, for "ran" (Claude Code and Codex), a trial with no turn_runs, or a turn with no count or a
 *  count of 0 (an empty list means no turn the adapter answered with an exit other than 2, which leaves the ready-time "ran" standing), because "ran" alone proves only that the adapter could run the hook command once before ready. A bundle
 *  with no turn_hook (block-only) and the "loaded" and "healthy" statuses are unchanged. compare-run's ladder leaves such a trial out
 *  of the pairs as installer_not_applied, and summarize-run counts the same trials. */
export function installerNotApplied(bundle: TrialGbrainInstall | undefined): string | null {
  if (!bundle) return 'installer not applied (no install record)';
  const hook = bundle.turn_hook;
  if (!hook) return null;
  if (!TURN_HOOK_APPLIED.includes(hook.status)) return `installer hook ${hook.status}`;
  if (hook.status !== 'ran') return null;
  const runs = hook.turn_runs;
  if (!runs) return 'installer hook ran at ready but no turn recorded gbrain_turn_hook_runs';
  const turn = (i: number) => (hook.turns?.length === runs.length && typeof hook.turns[i] === 'number' ? hook.turns[i] : i + 1);
  const missing = runs.findIndex((n) => typeof n !== 'number');
  if (missing >= 0) return `installer hook ran at ready but turn ${turn(missing)} recorded no gbrain_turn_hook_runs`;
  const zero = runs.findIndex((n) => n! < 1);
  if (zero >= 0) return `installer hook did not run in turn ${turn(zero)} (gbrain_turn_hook_runs ${runs[zero]})`;
  return null;
}

/** The sidecar's embedding calls for one trial, from the proxy's /v1/embeddings usage lines for the trial key. */
export interface TrialEmbeddingUsage {
  model: string;
  requests: number;
  input_tokens: number;
  usd: number;
  /** Lines the proxy refused or that failed upstream. */
  refused: number;
  failed: number;
}

/** gbrain arm lane D addition: what the runner records about a trial's sidecar in trials.jsonl. */
export interface TrialGbrain {
  /** The resolved surface. */
  surface: 'starter' | 'verbs';
  image: string;
  /** Install ladder additions, absent in records written before them: the resolved install and embeddings of the cell; the install
   *  bundle view when one was applied; the sidecar's metered embedding calls when embeddings were on; and the semantic
   *  check: a trial with embeddings on that searched the brain must show a forwarded embedding line and no degraded stamp
   *  (HE-GBRAIN-005, recorded as infra_error with this field saying why). */
  install?: 'mcp' | 'gbrain-docs' | 'gbrain-installer';
  embeddings?: 'off' | 'openai:text-embedding-3-small';
  install_bundle?: TrialGbrainInstall;
  embedding_usage?: TrialEmbeddingUsage;
  semantic_check?: { search_calls: number; embedding_requests: number; degraded_calls: number; ok: boolean; reason?: string };
  /** Company brain additions, absent in records written before them: the brain and scope the sidecar ran with and the docker
   *  image id behind the tag, so a record names the exact brain it was served from. */
  brain?: 'bot-visible' | 'company' | 'member';
  scope?: 'none' | 'member' | 'sources' | 'member-sources';
  /** Present when the sidecar served the access-ruled member brain. */
  access?: 'rules';
  /** Whether the world ingested the scenario's messages into the brain, and how many it wrote (gbrain.ingest events): ok
   *  (a committed fact), skipped (a conversation the brain has no source or token for; not a fault) and failed. */
  ingest?: 'off' | 'live';
  ingested?: { ok: number; skipped: number; failed: number };
  image_id?: string;
  /** Milliseconds from docker run to a healthy sidecar with a token on disk. */
  sidecar_ready_ms: number;
  /** via "gbrain" events in the trial's log: tools/list and initialize, tools/call, and how many fell inside a turn window.
   *  Degraded counts search, query and recall replies gbrain stamped search_degraded or facts_degraded.
   *  write_errors counts the failed write calls by error code (such as storage_error), present only when one failed.
   *  The top-level counts are the model's own events (caller "model" or untagged). provider holds the same counts for QM's
   *  memory-provider client (caller "provider"), present only when the log has a provider event; records written before it
   *  counted provider events in the top-level figures. */
  events: TrialGbrainEvents & { provider?: TrialGbrainEvents };
}

export interface TrialGbrainEvents { total: number; discovery: number; calls: number; in_turn_calls: number; writes: number; degraded?: number; write_errors?: Record<string, number> }

/** Lane B bridge addition (docs/gstack-laneb.md): what a Lane B trial adds to its record. The Harbor trial and
 *  the Lane B proxy session it ran under, the verifier's reward, Harbor's exception class and the agent's error class (never
 *  a message), the body-load probe (cmd_expanded: the first forwarded request carried an expanded slash command; the
 *  first request's prompt-token bound), and Lane B's own meter for the session beside ours (usage), with the difference. */
export interface TrialLaneB {
  arm: string;
  harbor_trial: string;
  session: string | null;
  invoked: boolean;
  reward: number | null;
  exception: string | null;
  agent_error: string | null;
  cmd_expanded: boolean | null;
  first_req_prompt_tokens: number | null;
  requests: number;
  ok_responses: number;
  refused_budget: number;
  laneb_meter_usd: number | null;
  /** usage.usd minus laneb_meter_usd; our meter is the authoritative one. */
  meter_delta_usd: number | null;
  /** Present only when the arm tar was a pack-equivalent rebuild that pin.json lists as a dated deviation, not the pinned tar. */
  arm_deviation?: { date: string; pinned_tar_sha256: string; tar_sha256: string; tar_gz_sha256: string; reason: string };
}

/** Prompt archaeology addition: what the metering proxy's layer filter did on a trial of a cell that carries
 *  ablation, from the trial's lines of the run's ablation.ndjson (copied to <trial dir>/ablation.ndjson). agent_requests
 *  counts receipts in an agent-turn family; matched_requests those on which every expected span was removed unchanged.
 *  did_not_take counts agent requests where the map expects a layer and nothing of it matched; partial those where
 *  some but not all expected spans matched, or a removed span's text or length differs from the map. unknown_families
 *  counts requests in no family of the map (passed through untouched). housekeeping_requests, present when nonzero, counts
 *  requests to one of the cell's declared utility_models (passed through untouched, in none of the counts above; the
 *  2026-11-01 ruling: harness housekeeping, shipped default). unstable_filter: a removed span changed between
 *  consecutive agent requests while the block it was cut from did not. invalid_reason is set when the trial has no
 *  receipts or no agent request. */
export interface TrialAblation {
  layers: string[];
  map: string;
  map_sha256: string;
  wire: 'anthropic-messages' | 'openai-responses';
  agent_requests: number;
  matched_requests: number;
  removed_bytes: number;
  did_not_take: number;
  partial: number;
  unknown_families: number;
  housekeeping_requests?: number;
  unstable_filter: boolean;
  invalid_reason?: string;
}

/** M1 lane A addition: one line of results/<run>/trials.jsonl. termination, grade and effects are the three
 *  orthogonal fields of methodology item 9; cap_stop marks a model_error that was the proxy refusing the lease. */
export interface TrialRecord {
  trial_id: string;
  cell: string;
  task: string;
  harness: string;
  harness_mode: HarnessMode | 'smoke';
  model: string;
  /** Script path for a scripted trial, else null. */
  script: string | null;
  termination: Termination;
  grade: 'pass' | 'fail' | 'n/a';
  consent_violation: boolean;
  approval_stop: boolean;
  effects: string[];
  predicates: PredicateResult[];
  cap_stop: boolean;
  turns: { planned: number; run: number; exits: number[] };
  usage: TrialUsage | null;
  wall_ms: number;
  started_at: string;
  ended_at: string;
  paths: Record<string, string>;
  /** The HE- line that ended the trial early, when one did. */
  error?: string;
  /** gbrain arm lane D addition: set on a trial of a cell that carries gbrain. */
  gbrain?: TrialGbrain;
  /** Lane B bridge addition: set on a trial run through the Lane B bridge. */
  laneb?: TrialLaneB;
  /** Prompt archaeology addition: set on a trial of a cell that carries ablation. */
  ablation?: TrialAblation;
}

// ---- internal-task (H10) additions: instruction routes on four harnesses ---------------------------------------

/** The drivers a cell's config may name. `cli` is the harness's own CLI and the default when the config names none; the two
 *  `sdk-*` drivers run Claude Code through the Agent SDK with its `claude_code` system prompt preset or with no system prompt
 *  set (harnesses/routes/README.md). A driver prefix is legal on claude-code only. */
export const ROUTE_DRIVERS = ['cli', 'sdk-preset', 'sdk-default'] as const;
export type RouteDriver = (typeof ROUTE_DRIVERS)[number];

/** The instruction routes a cell's config may name (harnesses/routes/README.md, "Routes on four harnesses"). `default` (or an
 *  empty config) changes nothing. Whether a harness supports a route is the adapter's call: it refuses one it does not
 *  implement with HE-ADAPTER-007. The two slot routes need `@<slot_id>`; no other route takes one. */
export const ROUTE_NAMES = [
  'default', 'route-tool', 'route-hook', 'route-once', 'route-system', 'route-startup', 'route-skill', 'route-told',
  'route-placebo', 'route-slot-told', 'route-slot-skill',
] as const;
export type RouteName = (typeof ROUTE_NAMES)[number];
export const SLOT_ROUTES: readonly RouteName[] = ['route-slot-told', 'route-slot-skill'];
/** A slot id: lowercase letters, digits and hyphens, starting with a letter or digit, at most 63 characters. It is a directory
 *  name under harnesses/routes/slots/, so it can never hold a slash or `..`. */
export const SLOT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface RouteConfig {
  driver: RouteDriver;
  route: RouteName;
  slot?: string;
}

/** Parse a cell's config, `[<driver>+]<route>[@<slot_id>]` (docs/adapters.md, "Route config"), for the named harness. Throws an
 *  Error whose message starts with HE-ADAPTER-007 for an unknown driver or route, a driver prefix on any harness but
 *  claude-code, a slot route without a valid slot id, and a slot id on any other route. */
export function parseRouteConfig(config: string, harness: string): RouteConfig {
  const refuse = (why: string): never => { throw new Error(`HE-ADAPTER-007 HE_HARNESS_CONFIG=${config} ${why}`); };
  if (config === '') return { driver: 'cli', route: 'default' };
  const plus = config.indexOf('+');
  const driverText = plus < 0 ? 'cli' : config.slice(0, plus);
  if (!(ROUTE_DRIVERS as readonly string[]).includes(driverText)) refuse(`names no known driver (${ROUTE_DRIVERS.join(', ')})`);
  if (plus >= 0 && harness !== 'claude-code') refuse(`carries a driver prefix, which only claude-code takes (harness ${harness})`);
  const rest = plus < 0 ? config : config.slice(plus + 1);
  const at = rest.indexOf('@');
  const routeText = at < 0 ? rest : rest.slice(0, at);
  if (!(ROUTE_NAMES as readonly string[]).includes(routeText)) refuse(`names no known route (${ROUTE_NAMES.join(', ')})`);
  const route = routeText as RouteName;
  const driver = driverText as RouteDriver;
  if (!SLOT_ROUTES.includes(route)) {
    if (at >= 0) refuse(`gives a slot id, which only ${SLOT_ROUTES.join(' and ')} take`);
    return { driver, route };
  }
  const slot = at < 0 ? '' : rest.slice(at + 1);
  if (!SLOT_ID.test(slot)) refuse(`needs @<slot_id> matching ${SLOT_ID} for ${route}`);
  return { driver, route, slot };
}

/** What a route adapter records about each turn it answered (docs/adapters.md, "Per-turn route status"). An exposure receipt
 *  only: the scorer derives session and session turn from the task's own turn order (TurnWindow.session_key), never from this. */
export interface RouteTurnStatus {
  /** The cell's config string as the adapter received it. */
  config: string;
  driver: RouteDriver;
  route: RouteName;
  /** The adapter's session key for the turn, the same definition as TurnWindow.session_key. */
  session_key: string;
  /** 1-based count of the turns this adapter has handed to the session, this one included. */
  session_turn: number;
  /** Hook routes (route-hook, route-once, route-placebo): whether the emit flag said the hook prints its bytes this turn.
   *  null on every other route. */
  emitted: boolean | null;
}

/** internal-task (H10) addition to the metering proxy's usage line: copies of the rule (or the placebo) in one forwarded request, by
 *  where they sit. Counts only, never the text. Declared here, written by H10 PR 5. */
export interface RouteCopies {
  system: number;
  user: number;
  tool_result: number;
  history: number;
}

/** harnesses/<name>/provenance.json: every checkout-owned file the harness image copies under /opt/harness, with its path
 *  in the checkout (repository-relative) and in the image. Installed runtimes (npm packages, a source checkout, a venv, a
 *  downloaded binary) are not listed; their pin.json versions cover them. H10 PR 5 compares each listed file's sha256 in the
 *  checkout with the same file in the image (HE-ADAPTER-005). */
export interface HarnessProvenanceManifest {
  harness: string;
  files: Array<{ checkout: string; image: string }>;
}
