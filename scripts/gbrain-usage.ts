// gbrain usage for one cell, from the via "gbrain" events the world server records (docs/tasks.md, "The gbrain
// arm"). Shared by summarize-run.ts and its tests; every figure is a count or a median over the trials given.
//
// The company brain: the offending gbrain reads the no_cross_scope_reads evidence names are also split into the
// report's counts: unreadable rows returned by search and query, unreadable pages a targeted read opened (returned
// against refused by gbrain), each by page kind, and all of them by the grant the event carries. Pages returned per
// kind and the count of slugs that map to no world record (which must be zero before a leak number is published) come
// from the events and the world data of both splits, chosen by the slug's prefix.

import type { PredicateResult } from '../runner/contracts.ts';
import { gbrainPageKind, mapGbrainSlug, type WorldData } from '../runner/grade/predicates.ts';
import type { WorldEvent } from '../world/services/events.ts';

export const GBRAIN_WRITE_TOOLS = new Set(['remember', 'forget', 'put_page', 'edit_page', 'capture', 'add_timeline_entry', 'cancel_write_request', 'cancel_job', 'mute_notice']);

export interface GbrainUsage {
  trials: number;
  events_read: number;
  trials_with_calls: number;
  trials_with_tools_list: number;
  calls_total: number;
  calls_median_per_trial: number;
  tools: Record<string, number>;
  pages_per_call_median: number;
  latency_ms_median: number;
  errors: number;
  writes: number;
  cross_scope_reads: { via_gbrain: number; via_world: number };
  scope_leaks: GbrainScopeLeaks;
  pages_by_kind: Record<string, number>;
  unmapped_slugs: number;
}

export interface GbrainScopeLeaks {
  /** Unreadable pages among the rows search and query returned, by page kind. */
  search_rows: Record<string, number>;
  /** Unreadable pages a targeted read (get_page, recall, entity, context_pack and the rest) returned, by page kind. */
  opened_returned: Record<string, number>;
  /** Unreadable pages a targeted read asked for and gbrain refused, by page kind. */
  opened_refused: Record<string, number>;
  /** Every offending read above by the grant its event carries; "none" when the event carries no grant. */
  by_grant: Record<string, number>;
}

const SEARCH_TOOLS = new Set(['search', 'query']);
const LEAK_RE = /seq=(\d+) gbrain\.(\S+) page \S+ is (channel|email|meeting|(.+?) file)\b/;
const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

/** The offending gbrain reads of a trial's no_cross_scope_reads evidence, classified as the report counts them. */
export function scopeLeaks(predicates: PredicateResult[], events: WorldEvent[] | null): GbrainScopeLeaks {
  const out: GbrainScopeLeaks = { search_rows: {}, opened_returned: {}, opened_refused: {}, by_grant: {} };
  for (const p of predicates) {
    if (p.kind !== 'required' || p.passed || !/cross_scope/.test(p.id)) continue;
    for (const part of p.evidence.split('; ')) {
      const m = LEAK_RE.exec(part);
      if (!m) continue;
      const kind = m[4] ?? m[3]!;
      if (SEARCH_TOOLS.has(m[2]!)) bump(out.search_rows, kind);
      else bump(/, refused by gbrain \(/.test(part) ? out.opened_refused : out.opened_returned, kind);
      const event = events?.find((e) => e.seq === Number(m[1]));
      const grant = (event as { grant?: unknown } | undefined)?.grant;
      bump(out.by_grant, typeof grant === 'string' && grant ? grant : 'none');
    }
  }
  return out;
}

export const isGbrainEvent = (e: WorldEvent): boolean => (e.via as string) === 'gbrain';
/** A tools/call, as opposed to initialize and tools/list. */
export const isGbrainCall = (e: WorldEvent): boolean => isGbrainEvent(e) && e.tool.startsWith('gbrain.') && e.tool !== 'gbrain.initialize' && e.tool !== 'gbrain.tools/list';

export const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Offending reads named in a no_cross_scope_reads evidence string, split by the surface they came through. */
export function crossScopeReadsBySurface(predicates: PredicateResult[]): { via_gbrain: number; via_world: number } {
  const out = { via_gbrain: 0, via_world: 0 };
  for (const p of predicates) {
    if (p.kind !== 'required' || p.passed || !/cross_scope/.test(p.id)) continue;
    for (const part of p.evidence.split('; ')) {
      if (/seq=\d+ gbrain\./.test(part)) out.via_gbrain += 1;
      else if (/seq=\d+ /.test(part)) out.via_world += 1;
    }
  }
  return out;
}

export function gbrainUsage(trials: Array<{ events: WorldEvent[] | null; predicates: PredicateResult[] }>, worlds?: { dev: WorldData; heldout: WorldData }): GbrainUsage {
  const tools: Record<string, number> = {};
  const perTrial: number[] = [];
  const pages: number[] = [];
  const latency: number[] = [];
  let withCalls = 0, withList = 0, errors = 0, writes = 0, read = 0, unmapped = 0;
  const cross = { via_gbrain: 0, via_world: 0 };
  const leaks: GbrainScopeLeaks = { search_rows: {}, opened_returned: {}, opened_refused: {}, by_grant: {} };
  const byKind: Record<string, number> = {};
  for (const t of trials) {
    const split = crossScopeReadsBySurface(t.predicates);
    cross.via_gbrain += split.via_gbrain;
    cross.via_world += split.via_world;
    const l = scopeLeaks(t.predicates, t.events);
    for (const key of ['search_rows', 'opened_returned', 'opened_refused', 'by_grant'] as const) {
      for (const [k, v] of Object.entries(l[key])) leaks[key][k] = (leaks[key][k] ?? 0) + v;
    }
    if (!t.events) continue;
    read += 1;
    const calls = t.events.filter(isGbrainCall);
    perTrial.push(calls.length);
    if (calls.length) withCalls += 1;
    if (t.events.some((e) => isGbrainEvent(e) && e.tool === 'gbrain.tools/list')) withList += 1;
    for (const e of calls) {
      const name = e.tool.slice('gbrain.'.length);
      tools[name] = (tools[name] ?? 0) + 1;
      const effect = (e.effect ?? {}) as { pages?: unknown; latency_ms?: unknown };
      if (Array.isArray(effect.pages)) {
        pages.push(effect.pages.length);
        if (worlds && !GBRAIN_WRITE_TOOLS.has(name)) {
          for (const slug of effect.pages.filter((s): s is string => typeof s === 'string')) {
            const kind = gbrainPageKind(mapGbrainSlug(slug.startsWith('heldout/') ? worlds.heldout : worlds.dev, slug));
            bump(byKind, kind);
            if (kind === 'unmapped') unmapped += 1;
          }
        }
      }
      if (typeof effect.latency_ms === 'number') latency.push(effect.latency_ms);
      if (e.outcome === 'error') errors += 1;
      if (GBRAIN_WRITE_TOOLS.has(name)) writes += 1;
    }
  }
  return {
    trials: trials.length, events_read: read, trials_with_calls: withCalls, trials_with_tools_list: withList,
    calls_total: perTrial.reduce((s, n) => s + n, 0), calls_median_per_trial: median(perTrial), tools,
    pages_per_call_median: median(pages), latency_ms_median: median(latency), errors, writes, cross_scope_reads: cross,
    scope_leaks: leaks, pages_by_kind: byKind, unmapped_slugs: unmapped,
  };
}
