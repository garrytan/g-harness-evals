#!/usr/bin/env bun
// One compact, deterministic packet per failed multi-user trial, for the layer-2 labeller (internal-task, failure mining).
//
//   bun scripts/failure-mining/packet.ts --taxonomy <taxonomy.json> --results <results dir> [--tasks tasks/multiuser]
//                                        [--trial <trial id>]... [--cap-tokens 20000] --out <packets.jsonl>
//
// A packet holds what a reader needs to name the first wrong step of a failed trial: the task (id, title, family) and
// each turn (actor, channel, text, exit, reply text), every world event in seq order with its actor, the turn it falls
// in, whether the bot made it, the tool, outcome, trimmed args and effect, the failed predicates with the grader's
// evidence, the layer-1 label and observations from scripts/taxonomy.ts, and the trial row's gbrain exposure counts.
// The task's hidden facts and predicate patterns stay out. An event's turn is the last turn whose started_seq is at or
// before its seq (null before the first turn), so a bot event in turn N is one the bot made after turn N's request was
// handed over and before turn N+1's; the reply the runner posts for a turn is marked reply.
//
// A packet is capped at --cap-tokens (estimated at 4 characters per token over its JSON text): the oldest non-bot
// events go first, then the oldest bot events, and the dropped seqs are recorded under truncation. Output is one JSON
// line per packet, sorted by trial id, each with packet_sha256 over the packet's JSON without that field. Keyless and
// free of timestamps, so the same inputs give byte-identical output.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { PredicateResult, TrialRecord, TurnWindow } from '../../runner/contracts.ts';
import type { WorldEvent } from '../../world/services/events.ts';
import { loadTask } from '../../runner/grade/task.ts';
import { LABELS, type Failure, type RunTaxonomy, type TrialTaxonomy } from '../taxonomy.ts';

export const PACKET_VERSION = '1.0.0';
export const DEFAULT_CAP_TOKENS = 20_000;
export const CHARS_PER_TOKEN = 4;
/** The bot's actor id in every multi-user world; scripts/taxonomy.ts reads the same id (Ctx.bot). */
export const BOT = 'assistant';
const MAX_STRING = 500;
const MAX_EVIDENCE = 1500;

export interface PacketEvent {
  seq: number;
  turn: number | null;
  actor: string | null;
  bot: boolean;
  reply?: true;
  via: string;
  tool: string;
  kind: string;
  outcome: string;
  error?: string;
  args: unknown;
  effect: unknown;
}

export interface PacketTurn {
  turn: number;
  ran: boolean;
  actor: string;
  channel: string;
  channel_type: string | null;
  thread_ts: string | null;
  sim_now: string | null;
  text: string;
  exit: number | null;
  reply_text: string | null;
  started_seq: number | null;
  ended_seq: number | null;
}

export interface Packet {
  packet_version: string;
  trial_id: string;
  cell: string;
  harness: string;
  model: string | null;
  task: { id: string; title: string; family: string; split: string };
  termination: string;
  grade: string;
  consent_violation: boolean;
  gbrain: { total: number; discovery: number; calls: number; in_turn_calls: number; writes: number; degraded: number | null } | null;
  turns: PacketTurn[];
  events: PacketEvent[];
  failed_predicates: Array<{ id: string; kind: string; predicate_kind: string | null; turn: number | null; turns: number[] | null; evidence: string }>;
  layer1: Array<{ predicate: string; label: string; label_definition: string; by_construction: boolean; evidence: string; observations: Failure['observations']; annotation: Failure['annotation'] | null }>;
  truncation: { cap_tokens: number; tokens_before: number; tokens_after: number; dropped_non_bot_seqs: number[]; dropped_bot_seqs: number[]; over_cap: boolean };
  inputs: Record<string, string>;
}

export type HashedPacket = Packet & { packet_sha256: string };

export const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** Strings longer than max keep their first max characters and say how many were cut. */
export function trimDeep(v: unknown, max = MAX_STRING): unknown {
  if (typeof v === 'string') return v.length > max ? `${v.slice(0, max)}…[+${v.length - max} chars]` : v;
  if (Array.isArray(v)) return v.map((x) => trimDeep(x, max));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trimDeep(x, max)]));
  return v ?? null;
}

/** The turn an event falls in: the last turn whose started_seq is at or before its seq, or null before the first turn. */
export function turnOf(windows: TurnWindow[], seq: number): number | null {
  let turn: number | null = null;
  for (const w of windows) if (w.started_seq <= seq && (turn === null || w.turn > turn)) turn = w.turn;
  return turn;
}

export function gbrainExposure(row: TrialRecord): Packet['gbrain'] {
  const e = row.gbrain?.events;
  if (!e) return null;
  return { total: e.total, discovery: e.discovery, calls: e.calls, in_turn_calls: e.in_turn_calls, writes: e.writes, degraded: e.degraded ?? null };
}

/** The packet text a labeller sees: its JSON without the hash. */
export function packetText(p: object): string {
  const { packet_sha256: _, ...rest } = p as { packet_sha256?: string };
  return JSON.stringify(rest);
}

export function hashPacket<T extends object>(p: T): T & { packet_sha256: string } {
  return { ...p, packet_sha256: sha256(packetText(p)) };
}

/** Drop the oldest non-bot events, then the oldest bot events, until the packet's JSON fits the cap. */
export function capPacket(p: Packet, capTokens: number): Packet {
  const before = estimateTokens(packetText(p));
  const out: Packet = { ...p, events: [...p.events], truncation: { cap_tokens: capTokens, tokens_before: before, tokens_after: before, dropped_non_bot_seqs: [], dropped_bot_seqs: [], over_cap: false } };
  const size = () => estimateTokens(packetText(out));
  for (const bot of [false, true]) {
    while (size() > capTokens) {
      const i = out.events.findIndex((e) => e.bot === bot);
      if (i < 0) break;
      const [gone] = out.events.splice(i, 1);
      (bot ? out.truncation.dropped_bot_seqs : out.truncation.dropped_non_bot_seqs).push(gone!.seq);
    }
  }
  out.truncation.tokens_after = size();
  out.truncation.over_cap = out.truncation.tokens_after > capTokens;
  return out;
}

const readJsonl = <T>(path: string): T[] => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
const readJsonIf = <T>(path: string): T | null => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : null);

export interface BuildOptions { results: string; tasksRoot: string; capTokens?: number }

export function findTaskDir(tasksRoot: string, id: string): string {
  const dir = ['dev', 'heldout'].map((s) => join(tasksRoot, s, id)).find((d) => existsSync(join(d, 'task.toml')));
  if (!dir) throw new Error(`task ${id} not found under ${tasksRoot}`);
  return dir;
}

/** Build one packet from a layer-1 trial entry, its trial row and its trial directory. */
export function buildPacket(entry: TrialTaxonomy, row: TrialRecord, o: BuildOptions): HashedPacket {
  const dir = join(o.results, 'trials', ...entry.trial_id.split('/').slice(1));
  const eventsPath = join(dir, 'events.jsonl');
  const turnsPath = join(dir, 'turns.jsonl');
  if (!existsSync(eventsPath) || !existsSync(turnsPath)) throw new Error(`${entry.trial_id}: no events.jsonl or turns.jsonl under ${dir}`);
  const taskDir = findTaskDir(o.tasksRoot, entry.task);
  const task = loadTask(taskDir);
  const events = readJsonl<WorldEvent>(eventsPath).sort((a, b) => a.seq - b.seq);
  const windows = readJsonl<TurnWindow>(turnsPath);
  const gradePath = join(dir, 'grade.json');
  const grade = readJsonIf<{ predicates?: PredicateResult[] }>(gradePath);
  const inputs: Record<string, string> = {
    'events.jsonl': sha256(readFileSync(eventsPath)),
    'turns.jsonl': sha256(readFileSync(turnsPath)),
    'task.toml': sha256(readFileSync(join(taskDir, 'task.toml'))),
  };
  if (grade) inputs['grade.json'] = sha256(readFileSync(gradePath));

  const turns: PacketTurn[] = task.turns.map((t, i) => {
    const n = i + 1;
    const w = windows.find((x) => x.turn === n) ?? null;
    const name = `turns/turn-${String(n).padStart(4, '0')}`;
    const req = readJsonIf<{ thread_ts?: string | null; sim_now?: string; text?: string }>(join(dir, `${name}.request.json`));
    const res = readJsonIf<{ exit?: number; reply_text?: string | null }>(join(dir, `${name}.response.json`));
    if (req) inputs[`${name}.request.json`] = sha256(readFileSync(join(dir, `${name}.request.json`)));
    if (res) inputs[`${name}.response.json`] = sha256(readFileSync(join(dir, `${name}.response.json`)));
    return {
      turn: n,
      ran: !!w,
      actor: w?.actor ?? t.actor,
      channel: w?.channel_name ?? t.channel,
      channel_type: w?.channel_type ?? null,
      thread_ts: w?.thread_ts ?? req?.thread_ts ?? null,
      sim_now: req?.sim_now ?? null,
      text: w?.text ?? req?.text ?? t.text,
      exit: w?.exit ?? res?.exit ?? null,
      reply_text: w?.reply_text ?? res?.reply_text ?? null,
      started_seq: w?.started_seq ?? null,
      ended_seq: w?.ended_seq ?? null,
    };
  });

  const replyTs = new Set(windows.map((w) => w.reply_ts).filter((x): x is string => !!x));
  const packetEvents: PacketEvent[] = events.map((e) => {
    const bot = e.actor === BOT;
    const effectTs = e.effect && typeof e.effect === 'object' ? (e.effect as { ts?: unknown }).ts : undefined;
    const isReply = bot && e.via === 'slack' && typeof effectTs === 'string' && replyTs.has(effectTs);
    return {
      seq: e.seq,
      turn: turnOf(windows, e.seq),
      actor: e.actor,
      bot,
      ...(isReply ? { reply: true as const } : {}),
      via: e.via,
      tool: e.tool,
      kind: e.kind,
      outcome: e.outcome,
      ...(e.error ? { error: String(trimDeep(e.error)) } : {}),
      args: trimDeep(e.args),
      effect: trimDeep(e.effect ?? null),
    };
  });

  const failed_predicates = entry.failures.map((f) => {
    const def = task.predicate.find((p) => p.id === f.predicate);
    const graded = grade?.predicates?.find((p) => p.id === f.predicate) ?? row.predicates.find((p) => p.id === f.predicate);
    const turn = def && 'turn' in def && typeof def.turn === 'number' ? def.turn : null;
    const turnList = def && 'turns' in def && Array.isArray(def.turns) ? (def.turns as number[]) : null;
    return { id: f.predicate, kind: graded?.kind ?? f.kind, predicate_kind: def?.kind ?? f.predicate_kind, turn, turns: turnList, evidence: String(trimDeep(graded?.evidence ?? f.grader_evidence, MAX_EVIDENCE)) };
  });

  const layer1 = entry.failures.map((f) => ({
    predicate: f.predicate,
    label: f.label,
    label_definition: LABELS[f.label] ?? '',
    by_construction: f.by_construction,
    evidence: String(trimDeep(f.evidence, MAX_EVIDENCE)),
    observations: f.observations,
    annotation: f.annotation ?? null,
  }));

  const packet: Packet = {
    packet_version: PACKET_VERSION,
    trial_id: entry.trial_id,
    cell: entry.cell,
    harness: entry.harness,
    model: row.model ?? null,
    task: { id: task.id, title: task.title, family: task.family, split: task.split },
    termination: entry.termination,
    grade: entry.grade,
    consent_violation: entry.consent_violation,
    gbrain: gbrainExposure(row),
    turns,
    events: packetEvents,
    failed_predicates,
    layer1,
    truncation: { cap_tokens: 0, tokens_before: 0, tokens_after: 0, dropped_non_bot_seqs: [], dropped_bot_seqs: [], over_cap: false },
    inputs: Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b))),
  };
  return hashPacket(capPacket(packet, o.capTokens ?? DEFAULT_CAP_TOKENS));
}

/** Packets for the named trials, or for every failed trial in the taxonomy that has receipts, sorted by trial id. */
export function buildPackets(taxonomyPath: string, o: BuildOptions & { trials?: string[] }): { packets: HashedPacket[]; skipped: Array<{ trial_id: string; reason: string }> } {
  const tax = JSON.parse(readFileSync(taxonomyPath, 'utf8')) as Pick<RunTaxonomy, 'trials'>;
  const rows = new Map(readJsonl<TrialRecord>(join(o.results, 'trials.jsonl')).map((r) => [r.trial_id, r]));
  const wanted = o.trials ? new Set(o.trials) : null;
  const entries = tax.trials.filter((t) => !wanted || wanted.has(t.trial_id)).sort((a, b) => a.trial_id.localeCompare(b.trial_id));
  if (wanted) for (const id of wanted) if (!entries.some((e) => e.trial_id === id)) throw new Error(`trial ${id} is not a failed trial in ${taxonomyPath}`);
  const packets: HashedPacket[] = [];
  const skipped: Array<{ trial_id: string; reason: string }> = [];
  for (const entry of entries) {
    const row = rows.get(entry.trial_id);
    if (!row) { skipped.push({ trial_id: entry.trial_id, reason: 'no row in trials.jsonl' }); continue; }
    if (entry.failures.some((f) => f.label === 'no_receipts')) { skipped.push({ trial_id: entry.trial_id, reason: 'no receipts' }); continue; }
    packets.push(buildPacket(entry, row, o));
  }
  return { packets, skipped };
}

export function readPackets(path: string): HashedPacket[] {
  return readJsonl<HashedPacket>(path);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const one = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const trials = argv.flatMap((a, i) => (a === '--trial' && argv[i + 1] ? [argv[i + 1]!] : []));
  const taxonomy = one('taxonomy');
  const results = one('results');
  const out = one('out');
  if (!taxonomy || !results || !out) {
    console.error('usage: bun scripts/failure-mining/packet.ts --taxonomy <taxonomy.json> --results <results dir> [--tasks tasks/multiuser] [--trial <id>]... [--cap-tokens 20000] --out <packets.jsonl>');
    process.exit(2);
  }
  const root = resolve(import.meta.dir, '..', '..');
  const { packets, skipped } = buildPackets(taxonomy, { results, tasksRoot: one('tasks') ?? join(root, 'tasks', 'multiuser'), capTokens: Number(one('cap-tokens') ?? DEFAULT_CAP_TOKENS), trials: trials.length ? trials : undefined });
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, packets.map((p) => JSON.stringify(p)).join('\n') + (packets.length ? '\n' : ''));
  const cut = packets.filter((p) => p.truncation.dropped_non_bot_seqs.length || p.truncation.dropped_bot_seqs.length).length;
  console.log(`packets: ${packets.length} written to ${out}; ${cut} truncated; ${packets.filter((p) => p.truncation.over_cap).length} still over the cap; ${skipped.length} skipped${skipped.length ? ': ' + skipped.map((s) => `${s.trial_id} (${s.reason})`).join('; ') : ''}`);
}
