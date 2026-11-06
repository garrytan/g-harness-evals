// "Avoidable-looking" spend in one trial (internal-task), from the content sections the metering proxy logs with
// --log-sections. Each category is a pure function of the trial's requests in time order. "Avoidable-looking" means
// the pattern often signals waste; it does not prove that a different harness could have skipped it.
//
// A boundary digest is the sha256 of messages[0..i] for each i, so two requests that share the digest at index i share
// their whole history up to that message. A request "contains" an earlier one when it carries the earlier request's
// last boundary digest at the same index.
import type { SectionsV1 } from './types.ts';

export interface SectionRequest {
  /** Epoch milliseconds the proxy received the request. */
  at: number;
  turn: number | 'out_of_turn';
  usd: number;
  cache_read: number;
  /** Total cache-write tokens, 1-hour writes included. */
  cache_write: number;
  cache_write_1h: number;
  sections: SectionsV1;
  tools_called: string[];
}

const FIVE_MINUTES = 5 * 60_000, ONE_HOUR = 60 * 60_000;
const contains = (later: SectionRequest, earlier: SectionRequest) => {
  const k = earlier.sections.boundary_sha256.length - 1;
  return k < 0 || later.sections.boundary_sha256[k] === earlier.sections.boundary_sha256[k];
};
const sameConversation = (a: SectionRequest, b: SectionRequest) => a.sections.conv_sha256 === b.sections.conv_sha256;

/**
 * (a) Cache misses on a repeated boundary. For each request, the earlier same-conversation requests from the last
 * five minutes that it contains had cached (read plus written) a prefix it repeats; when it reads fewer cache tokens
 * than the largest of those, the shortfall counts.
 */
export function cacheMissesOnRepeatedBoundary(reqs: readonly SectionRequest[]) {
  let requests = 0, tokens = 0;
  reqs.forEach((r, i) => {
    let expected = 0;
    for (const q of reqs.slice(0, i)) if (sameConversation(q, r) && r.at - q.at <= FIVE_MINUTES && contains(r, q)) expected = Math.max(expected, q.cache_read + q.cache_write);
    if (expected > r.cache_read) { requests++; tokens += expected - r.cache_read; }
  });
  return { requests, tokens };
}

/**
 * (b) Unread cache writes. A later same-conversation request inside the write's TTL (five minutes, or one hour for
 * 1-hour writes) that contains the writing request reads the written tokens its cache read reaches past the writer's
 * own cache read; the most any such request reaches counts as read and the rest of the write is unread. 1-hour
 * breakpoints come before 5-minute ones in a prompt, so the 1-hour part is the front of the write. The final write of a
 * conversation has no later request, so it always counts.
 */
export function unreadCacheWrites(reqs: readonly SectionRequest[]) {
  let requests = 0, tokens = 0;
  reqs.forEach((p, i) => {
    if (p.cache_write <= 0) return;
    const reach = (ttl: number) => Math.max(0, ...reqs.slice(i + 1).filter((r) => sameConversation(p, r) && r.at - p.at <= ttl && contains(r, p)).map((r) => r.cache_read - p.cache_read));
    const oneHour = p.cache_write_1h, fiveMinute = p.cache_write - oneHour;
    const unread = oneHour - Math.min(oneHour, reach(ONE_HOUR)) + fiveMinute - Math.min(fiveMinute, Math.max(0, reach(FIVE_MINUTES) - oneHour));
    if (unread > 0) { requests++; tokens += unread; }
  });
  return { requests, tokens };
}

/** (c) Schema bytes of declared tools the trial never called, summed over every request that declared them. */
export function unusedToolSchemas(reqs: readonly SectionRequest[]) {
  const called = new Set(reqs.flatMap((r) => r.tools_called));
  const tools = new Set<string>();
  let bytes = 0;
  for (const r of reqs) for (const t of r.sections.tools_declared) if (!called.has(t.name)) { tools.add(t.name); bytes += t.bytes; }
  return { tools: [...tools].sort(), bytes };
}

/**
 * (d) Tool results repeated rather than replayed. A stateless API resends the whole history on every request, so a tool
 * result an earlier request carried at the same message index, with the same history up to and including it (equal
 * boundary digest at that index), is replay and does not count, even when a trailing context message changed. Every
 * other copy of a digest already seen (another index, or a different history before it) counts each time.
 */
export function resentToolResults(reqs: readonly SectionRequest[]) {
  const seen = new Map<string, Array<{ req: number; index: number }>>();
  let resends = 0, bytes = 0;
  reqs.forEach((r, i) => {
    for (const t of r.sections.tool_results) {
      const earlier = seen.get(t.digest) ?? [];
      const replay = earlier.some((s) => s.req < i && s.index === t.index && reqs[s.req]!.sections.boundary_sha256[t.index] === r.sections.boundary_sha256[t.index]);
      if (earlier.length && !replay) { resends++; bytes += t.bytes; }
      seen.set(t.digest, [...earlier, { req: i, index: t.index }]);
    }
  });
  return { resends, bytes };
}

/** (e) Retries: a request whose boundary digests equal the previous same-conversation request's, so no message is new. */
export function retries(reqs: readonly SectionRequest[]) {
  let requests = 0, usd = 0;
  reqs.forEach((r, i) => {
    const prev = reqs.slice(0, i).findLast((q) => sameConversation(q, r));
    const a = prev?.sections.boundary_sha256, b = r.sections.boundary_sha256;
    if (a && b.length > 0 && a.length === b.length && a.at(-1) === b.at(-1)) { requests++; usd += r.usd; }
  });
  return { requests, usd };
}

/**
 * (f) Side calls: requests outside the main conversation. The main conversation is chosen per user turn (the one with
 * the most requests in that turn; ties go to the one with more requests in the whole trial, then the earliest),
 * because some harnesses start a fresh conversation for each turn. Out-of-turn requests use the trial's main
 * conversation. Every other conversation, single-request ones included, is a side call.
 */
export function sideCalls(reqs: readonly SectionRequest[]) {
  const count = (rs: readonly SectionRequest[]) => {
    const m = new Map<string, number>();
    for (const r of rs) m.set(r.sections.conv_sha256, (m.get(r.sections.conv_sha256) ?? 0) + 1);
    return m;
  };
  const trialCounts = count(reqs);
  const firstAt = new Map<string, number>();
  for (const r of reqs) if (!firstAt.has(r.sections.conv_sha256)) firstAt.set(r.sections.conv_sha256, r.at);
  const mainOf = (rs: readonly SectionRequest[]) => [...count(rs).entries()]
    .sort(([x, a], [y, b]) => b - a || trialCounts.get(y)! - trialCounts.get(x)! || firstAt.get(x)! - firstAt.get(y)!)[0]?.[0];
  const trialMain = mainOf(reqs);
  const mains = new Map<SectionRequest['turn'], string | undefined>();
  let requests = 0, usd = 0;
  for (const r of reqs) {
    if (!mains.has(r.turn)) mains.set(r.turn, r.turn === 'out_of_turn' ? trialMain : mainOf(reqs.filter((q) => q.turn === r.turn)));
    if (r.sections.conv_sha256 !== mains.get(r.turn)) { requests++; usd += r.usd; }
  }
  return { requests, usd };
}

export function avoidable(reqs: readonly SectionRequest[]) {
  return {
    cache_miss_repeated_boundary: cacheMissesOnRepeatedBoundary(reqs),
    unread_cache_writes: unreadCacheWrites(reqs),
    unused_tool_schemas: unusedToolSchemas(reqs),
    resent_tool_results: resentToolResults(reqs),
    retries: retries(reqs),
    side_calls: sideCalls(reqs),
  };
}
export type Avoidable = ReturnType<typeof avoidable>;
