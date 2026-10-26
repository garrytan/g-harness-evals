// internal-task: live ingestion of the scenario into the member brain (docs/gbrain-arm.md, "The member brain and live ingestion").
// Every message posted into the world during a trial (an actor's turn, the bot's reply, every post or DM the bot makes while it
// works) is written into the gbrain sidecar as one remember fact, with provenance (who said it, where, when on the simulation
// clock), into the gbrain source of the conversation it was posted in: a channel's reader-set source from the brain manifest's
// channel map, or private-<member> for a direct message between the bot and a member. gbrain lets one bearer token write to one
// source, so each write goes out under that source's ingest token (ingest-tokens.json, minted at image build); the harness never
// sees those tokens and the trial's own token is never used here.
//
// Why facts and not pages: at the pinned gbrain a brain copied per trial refuses put_page with recovery_required (the source's
// canonical root is stamped with its inode and birth time at build; the copy is a new directory), while remember lands in the
// database and is returned by search (its saved-facts block) and recall at once (gbrain/pin.json copied_brain_writes).
//
// Every write is a WorldEvent (via runner, tool gbrain.ingest) carrying the message's channel and ts, the author, the source and
// the fact id gbrain assigned, so the grader can map a fact a search returned back to its conversation and the report can count
// what the brain held at each turn. The runner awaits flush() after it posts an actor's message and before it hands the harness
// the turn, and again before the next turn, so the brain is current at every turn boundary; a failed write is reported by flush
// and the runner ends the trial as an exam fault (HE-GBRAIN-011) rather than let a silent gap pass for a memory failure.
// The fact's time (its text, its provenance and gbrain's valid_from) is the simulation time the message was posted, in the
// world's clock offset, never the clock when the write ran.
//
// A message in a conversation the brain has no source for (a DM with a member who holds no token, so no private-<member>
// source exists: guests, contacts and vendors; a group DM; a channel outside the manifest's map) is recorded as skipped, not
// as a failure: the harness's own choice of whom to message must not end the trial in this arm alone (an exam fault leaves the
// scored denominator), and the gap is in the event log and the trial record's gbrain.ingested.skipped, never silent.

import type { Member, Message } from '../types.ts';
import { formatOffset } from './clock/clock.ts';
import type { EventLog } from './events.ts';
import { parseRpcBody } from './gbrain-tap.ts';
import type { WorldService } from './world.ts';

export interface GbrainIngestConfig {
  /** source id -> bearer token whose write source is that source. */
  tokens: Record<string, string>;
  /** channel id -> source id for every loaded non-DM channel (the member brain manifest's ingest.channels). */
  channels: Record<string, string>;
  dm_source_prefix: string;
}

export interface IngestResult { seq: number; channel: string; ts: string; source: string; fact_id: string | number | null; outcome: 'ok' | 'skipped' | 'error'; error?: string }

/** gbrain's write_error values that say the write was taken or queued but has not committed yet (error-registry class retryable
 *  at the pin). gbrain answers such a remember with isError, code `unavailable` and the reason in `write_error`, the receipt
 *  under `write_request`; the same remember is sent again, same request_id, a bounded number of times before it counts as a
 *  failure (a replay under the same request_id returns the first write's id). A transport failure (the 30 s request timeout,
 *  a dropped connection) and a 5xx are resent the same way: the sidecar is one process the harness also calls during its turn,
 *  so a slow answer must not end the trial of the harness that uses the brain most. A 4xx and gbrain's own refusals are final. */
export const RETRYABLE_CODES = new Set(['write_pending', 'queue_capacity']);
/** The wait before each resend, or the receipt's retry_after_ms when gbrain asks for longer (capped so the retries stay inside
 *  the flush deadline). */
const RETRY_WAITS_MS = [500, 1500];
const RETRY_AFTER_CAP_MS = 10_000;
/** The error recorded on every message queued behind a failed write; it is not sent, the trial is ending. */
export const NOT_SENT = 'not sent: an earlier write failed';
/** flush() gives the queue this long before it reports what is still pending as failed; one write is at most three attempts of
 *  30 s, and the runner's turn boundary must not wait without bound on a chatty harness. */
export const FLUSH_DEADLINE_MS = 120_000;

/** The simulation time a message was posted, in the world's clock offset: its ts is the sim epoch second plus a counter
 *  (world/services/clock/clock.ts, nextTs). */
export const postedAt = (ts: string, offsetMinutes: number) => formatOffset(Number(ts.split('.')[0]) * 1000, offsetMinutes);

/** The gbrain source a message belongs to: the channel map for a channel, private-<the other member> for a DM with the bot;
 *  null (with the reason) for a conversation the brain has no source for. */
export function sourceForMessage(cfg: GbrainIngestConfig, channel: { id: string; kind: string; members: string[] }, botId: string): { source: string } | { reason: string } {
  if (channel.kind !== 'dm') {
    const s = cfg.channels[channel.id];
    return s ? { source: s } : { reason: `channel ${channel.id} has no source in the brain manifest's channel map` };
  }
  const others = channel.members.filter((m) => m !== botId);
  if (others.length !== 1) return { reason: `DM ${channel.id} is between ${channel.members.join(' and ')}, not the bot and one member` };
  return { source: `${cfg.dm_source_prefix}${others[0]}` };
}

/** The fact text and provenance string for one message, as the brain stores them. The text names the speaker and the place so a
 *  keyword search by the member's name or the channel finds it; the provenance is gbrain's own required field. `postedIso` is
 *  the posting time in the world's offset (postedAt). */
export function factFor(message: Message, author: Member, channel: { name: string; kind: string }, botId: string, postedIso: string): { fact: string; provenance: string } {
  const where = channel.kind === 'dm' ? `a direct message with ${author.id === botId ? channel.name.replace(/^dm:/, '').split('+').filter((m) => m !== botId).join(' and ') : botId}` : `#${channel.name}`;
  const who = author.id === botId ? `${botId} (the workspace bot)` : `${author.name} (${author.id}, ${author.role})`;
  const when = postedIso.replace('T', ' ').slice(0, 16);
  return { fact: `${who} wrote in ${where} on ${when}: ${message.text}`, provenance: `${author.id}, ${where}, ${postedIso}` };
}

export interface GbrainIngestOptions {
  url: string;
  config: GbrainIngestConfig;
  service: WorldService;
  log: EventLog;
  fetchImpl?: typeof fetch;
}

export class GbrainIngest {
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;
  /** Set by the first failed write; later messages are recorded as failed (NOT_SENT) without a call upstream, so a brain that
   *  stopped taking writes does not hold the trial for 30 s per queued message before the runner sees the fault. */
  private failed = false;
  /** Set by stop(): nothing is recorded after it, so no event lands after the trial's snapshot; an in-flight fetch is aborted. */
  private closed = false;
  private readonly aborter = new AbortController();
  readonly results: IngestResult[] = [];
  private readonly unsubscribe: () => void;
  private nextId = 1;

  constructor(private readonly o: GbrainIngestOptions) {
    this.unsubscribe = o.service.onMessage((m) => this.enqueue(m));
  }

  /** Every outcome is one gbrain.ingest event and one result row, so the trial record's counts and the flush agree. */
  private record(message: { channel: string; ts: string; author?: string }, source: string, outcome: 'ok' | 'skipped' | 'error', factId: string | number | null, detail: string | undefined, started: number, status?: 'inserted' | 'duplicate'): void {
    if (this.closed) return;
    const skipped = outcome === 'skipped';
    const e = this.o.log.append({ actor: null, via: 'runner', tool: 'gbrain.ingest', kind: 'admin', args: { channel: message.channel, ts: message.ts, ...(message.author ? { author: message.author } : {}), source }, outcome: skipped ? 'ok' : outcome, ...(detail && !skipped ? { error: detail } : {}), effect: { fact_id: factId, source, latency_ms: Date.now() - started, ...(status ? { status } : {}), ...(skipped ? { skipped: detail } : {}) } });
    this.results.push({ seq: e.seq, channel: message.channel, ts: message.ts, source, fact_id: factId, outcome, ...(detail && !skipped ? { error: detail } : {}) });
    if (outcome === 'error') this.failed = true;
  }

  /** Messages are written in posting order, one at a time, so fact ids follow the conversation. A throw out of write() (a
   *  malformed message, a log that cannot append) is a failure too, never a message with no result. */
  private enqueue(message: Message): void {
    this.pending += 1;
    const started = Date.now();
    this.chain = this.chain.then(() => this.write(message, started)).catch((e) => {
      try { this.record(message, '', 'error', null, `ingest_exception: ${(e as Error).message}`, started); }
      catch { this.results.push({ seq: -1, channel: message.channel, ts: message.ts, source: '', fact_id: null, outcome: 'error', error: `ingest_exception: ${(e as Error).message}` }); this.failed = true; }
    }).finally(() => { this.pending -= 1; });
  }

  private async write(message: Message, started: number): Promise<void> {
    const channel = this.o.service.channel(message.channel);
    const author = this.o.service.member(message.author);
    const botId = this.o.service.bot?.id ?? 'assistant';
    const record = (source: string, outcome: 'ok' | 'error', factId: string | number | null, error?: string, status?: 'inserted' | 'duplicate') => this.record(message, source, outcome, factId, error, started, status);
    const skip = (source: string, reason: string) => this.record(message, source, 'skipped', null, reason, started);
    if (!channel || !author) { record('', 'error', null, `unknown ${channel ? 'author' : 'channel'} for message ${message.id}`); return; }
    const where = sourceForMessage(this.o.config, channel, botId);
    if ('reason' in where) { skip('', where.reason); return; }
    const token = this.o.config.tokens[where.source];
    if (!token) { skip(where.source, `no ingest token for source ${where.source}`); return; }
    if (this.failed) { record(where.source, 'error', null, NOT_SENT); return; }
    const posted = postedAt(message.ts, this.o.service.clock.offsetMinutes);
    const { fact, provenance } = factFor(message, author, channel, botId, posted);
    const request_id = crypto.randomUUID();
    for (let attempt = 0; ; attempt++) {
      const id = this.nextId++;
      const body = { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'remember', arguments: { fact, provenance, valid_from: posted, source_id: where.source, request_id } } };
      // The upstream exchange and the reading of gbrain's answer; the recording happens outside, so a log that cannot append is
      // the exception enqueue() records, never an upstream failure.
      const answer = await this.exchange(token, id, body);
      if (answer.kind === 'ok') { record(where.source, 'ok', answer.fact_id, undefined, answer.status); return; }
      if (answer.kind === 'error') { record(where.source, 'error', answer.fact_id ?? null, answer.error); return; }
      const wait = RETRY_WAITS_MS[attempt];
      if (wait === undefined) { record(where.source, 'error', null, `${answer.reason} after ${attempt + 1} attempts`); return; }
      await new Promise((resolve) => setTimeout(resolve, Math.max(wait, answer.retry_after_ms)));
    }
  }

  private async exchange(token: string, id: number, body: unknown): Promise<{ kind: 'ok'; fact_id: string | number; status: 'inserted' | 'duplicate' } | { kind: 'error'; error: string; fact_id?: string | number | null } | { kind: 'retry'; reason: string; retry_after_ms: number }> {
    try {
      const res = await (this.o.fetchImpl ?? fetch)(`${this.o.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(30_000), this.aborter.signal]) });
      const text = await res.text();
      const reply = parseRpcBody(text, res.headers.get('content-type')).find((r) => String(r.id) === String(id));
      // A 5xx is the sidecar failing the request, not refusing the fact; like a transport failure it is resent under the same
      // request_id (gbrain replays a committed request_id as the first write's own outcome), so a harness that keeps the
      // sidecar busy during its turn does not turn its own trial into an exam fault.
      if (res.status >= 500) return { kind: 'retry', reason: `upstream_${res.status}`, retry_after_ms: 0 };
      if (!res.ok) return { kind: 'error', error: `upstream_${res.status}` };
      if (!reply) return { kind: 'error', error: 'no_response' };
      if (reply.error) return { kind: 'error', error: `rpc_${reply.error.code ?? 'error'}` };
      const result = reply.result as { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
      const payload = (() => { try { return JSON.parse(result?.content?.find((c) => typeof c.text === 'string' && c.text.trim().startsWith('{'))?.text ?? 'null') as Record<string, unknown> | null; } catch { return null; } })();
      const code = typeof payload?.code === 'string' ? payload.code : null;
      const writeError = typeof payload?.write_error === 'string' ? payload.write_error : null;
      const retryAfter = (payload?.write_request as { retry_after_ms?: unknown } | undefined)?.retry_after_ms;
      const factId = payload && (typeof payload.id === 'string' || typeof payload.id === 'number') ? payload.id : null;
      if (result?.isError) {
        const reason = writeError ?? code ?? 'tool_error';
        // gbrain stamps `retryable` on every error envelope (writer_busy, owner_unavailable, storage_error at the pin); those
        // are resent like a pending write, a refusal is final.
        if (!RETRYABLE_CODES.has(reason) && payload?.retryable !== true) return { kind: 'error', error: reason };
        return { kind: 'retry', reason, retry_after_ms: typeof retryAfter === 'number' && retryAfter > 0 ? Math.min(retryAfter, RETRY_AFTER_CAP_MS) : 0 };
      }
      if (factId !== null && (payload?.status === 'inserted' || payload?.status === 'duplicate')) return { kind: 'ok', fact_id: factId, status: payload.status };
      return { kind: 'error', error: `remember answered status ${String(payload?.status)}${factId === null ? ', no id' : ''}`, fact_id: factId };
    } catch (e) {
      return { kind: 'retry', reason: `upstream_unreachable: ${(e as Error).message}`, retry_after_ms: 0 };
    }
  }

  /** Wait for every queued write, up to the deadline; the failures so far are returned so the runner can stop the trial. After
   *  a failure the queue drains without touching the upstream (later messages are recorded NOT_SENT; a routing skip is still a
   *  skip). Past the deadline the writes still pending are reported as one failure and the queue is latched. */
  async flush(deadlineMs = FLUSH_DEADLINE_MS): Promise<{ written: number; skipped: number; failed: IngestResult[] }> {
    const deadline = Date.now() + deadlineMs;
    while (this.pending > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        this.record({ channel: '', ts: '' }, '', 'error', null, `flush timed out after ${deadlineMs} ms with ${this.pending} write(s) pending`, deadline - deadlineMs);
        this.failed = true;
        break;
      }
      await Promise.race([this.chain, new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 1000)))]);
    }
    return { written: this.results.filter((r) => r.outcome === 'ok').length, skipped: this.results.filter((r) => r.outcome === 'skipped').length, failed: this.results.filter((r) => r.outcome === 'error') };
  }

  /** Stop listening and recording: the runner calls it after the drain and before the snapshot, so a write still in flight past
   *  the deadline is aborted and never lands as an event after the record is written. */
  stop(): void { this.unsubscribe(); this.closed = true; this.aborter.abort(); }
}
