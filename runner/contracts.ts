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
  /** internal-task (v0.2 task slice) addition: 'secondary' is a predicate listed in predicates.secondary of task.toml; it is
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

/** M1 lane A addition: usage.json, the metering proxy's meter for one trial key plus the token sums from the
 *  usage lines it wrote for that key. cached_tokens is the cache-read count the provider reported. */
export interface TrialUsage {
  key: string;
  requests: number;
  refused: number;
  failed: number;
  usd: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  unpriced: number;
  by_model: Record<string, { usd: number; requests: number }>;
  upstream: { statuses: Record<string, number>; failed: number; unparseable: number } | null;
}

/** gbrain arm lane D addition: a cell's gbrain configuration (docs/gbrain-arm.md). Present on a cell, the runner
 *  starts a gbrain sidecar per trial and the harness registers a second MCP server named gbrain through the
 *  world's /gbrain tap. surface is the gbrain tool surface the sidecar serves; only "starter" (33 tools) is pinned. */
export interface GbrainCellConfig {
  surface: 'starter';
}

/** gbrain arm lane D addition: what the runner records about a trial's sidecar in trials.jsonl. */
export interface TrialGbrain {
  surface: 'starter';
  image: string;
  /** Milliseconds from docker run to a healthy sidecar with a token on disk. */
  sidecar_ready_ms: number;
  /** via "gbrain" events in the trial's log: tools/list and initialize, tools/call, and how many fell inside a turn window. */
  events: { total: number; discovery: number; calls: number; in_turn_calls: number; writes: number };
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
}
