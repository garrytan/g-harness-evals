// HARN-116: the facts drain before grading, for a cell with gbrain's model on (gbrain.llm "proxy"). After the world is fenced and the
// harness is stopped, and before any store read: wait, bounded, until gbrain's facts work is quiet; stop serve gracefully, keeping the
// container; copy its /brain out; dump the store (gbrain/owner-identity-dump.ts); when facts-absorb jobs of this trial are still
// queued, run gbrain's own drain once (`gbrain dream --phase facts_drain`) in a one-off CLI container on the copy and dump again.
//
// What gbrain at a26eb922 lets us see. Its in-process facts queue (src/core/facts/queue.ts), which serve's put_page hook feeds, keeps
// its counters (enqueued, completed, dropped_overflow, dropped_shutdown, failed) in serve's memory with no MCP, CLI or doctor read,
// and the facts_drain readiness entry is not visible over HTTP. So idle is inferred: no change for quiet_ms in the facts:absorb rows of
// get_ingest_log, the facts-absorb rows of list_jobs and get_stats, with no queued job of the trial. Drops are read after the stop
// from ingest_log (writeFactsAbsorbLog reasons) and minion_jobs; a pending job that serve's shutdown drops writes no row, which is why
// the wait comes first. The trial record's gbrain.drain carries the counts, and any drop is infra class gbrain_extraction_dropped.

import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GbrainCellConfig, TrialGbrainDrain } from '../contracts.ts';
import { dumpDockerArgs, gbrainStoreFrom, storePath, writeStore, type GbrainStore } from '../grade/owner-identity-store.ts';
import { callGbrain, sh, uidGid, type GbrainSidecar } from './gbrain.ts';

export const DRAIN_DEFAULTS = { timeoutMs: 120_000, quietMs: 15_000, pollMs: 2_000, haltGraceMs: 30_000 };
const QUEUED = new Set(['waiting', 'delayed', 'active']);
const INFORMATION_ONLY = new Set(['write_pending_accepted']);

/** The cell turns gbrain's own model on (HE_GBRAIN_LLM=proxy on the sidecar); absent or anything else is off. */
export const gbrainLlmOn = (c: GbrainCellConfig | undefined): boolean => (c as { llm?: unknown } | undefined)?.llm === 'proxy';

export interface IdleProbe { backlog: number | null; signature: string; signals: string[] }

const rowsOf = (v: unknown, keys: string[]): Array<Record<string, unknown>> | null => {
  if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  if (v && typeof v === 'object') for (const k of keys) { const r = (v as Record<string, unknown>)[k]; if (Array.isArray(r)) return r as Array<Record<string, unknown>>; }
  return null;
};

/** One read of what gbrain exposes over MCP; a tool that errors or answers without rows is left out of signals. */
export async function probeFactsIdle(call: (tool: string, args: Record<string, unknown>) => Promise<unknown>, since: string): Promise<IdleProbe> {
  const signals: string[] = [];
  const parts: string[] = [];
  let backlog: number | null = null;
  const absorb = rowsOf(await call('get_ingest_log', { limit: 50 }).catch(() => null), ['entries', 'rows', 'items']);
  if (absorb) { signals.push('get_ingest_log'); const mine = absorb.filter((r) => r.source_type === 'facts:absorb'); parts.push(`absorb:${mine.length}:${mine.map((r) => r.id).join(',')}`); }
  const jobs = rowsOf(await call('list_jobs', { name: 'facts-absorb', limit: 100 }).catch(() => null), ['jobs', 'rows', 'items']);
  if (jobs) {
    signals.push('list_jobs');
    const mine = jobs.filter((j) => typeof j.created_at !== 'string' || j.created_at >= since);
    backlog = mine.filter((j) => QUEUED.has(String(j.status))).length;
    parts.push(`jobs:${mine.map((j) => `${j.id}=${j.status}`).join(',')}`);
  }
  const stats = await call('get_stats', {}).catch(() => null);
  if (stats && typeof stats === 'object') { signals.push('get_stats'); parts.push(`stats:${JSON.stringify(stats)}`); }
  return { backlog, signature: parts.join('|'), signals };
}

/** Poll until the signature has not changed for quietMs with no queued job of the trial, or until timeoutMs. */
export async function waitFactsIdle(o: { probe: () => Promise<IdleProbe>; timeoutMs?: number; quietMs?: number; pollMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> }): Promise<{ idle: boolean; wait_ms: number; polls: number; signals: string[] }> {
  const { timeoutMs, quietMs, pollMs } = { ...DRAIN_DEFAULTS, ...Object.fromEntries(Object.entries({ timeoutMs: o.timeoutMs, quietMs: o.quietMs, pollMs: o.pollMs }).filter(([, v]) => v !== undefined)) };
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => Bun.sleep(ms));
  const start = now();
  const signals = new Set<string>();
  let last: string | null = null;
  let changed = start;
  let polls = 0;
  for (;;) {
    const p = await o.probe();
    polls += 1;
    for (const s of p.signals) signals.add(s);
    const t = now();
    if (p.signature !== last) { last = p.signature; changed = t; }
    if ((p.backlog ?? 0) === 0 && t - changed >= quietMs) return { idle: true, wait_ms: t - start, polls, signals: [...signals].sort() };
    if (t - start >= timeoutMs) return { idle: false, wait_ms: t - start, polls, signals: [...signals].sort() };
    await sleep(pollMs);
  }
}

/** The counts of a trial's drain from the final store: drops and queued jobs created at or after since. */
export function drainCounts(store: GbrainStore, since: string, cliCompleted: number): Pick<TrialGbrainDrain, 'drained' | 'dropped' | 'timed_out' | 'preexisting_backlog' | 'facts_rows'> {
  const dropped: Record<string, number> = {};
  const bump = (k: string) => { dropped[k] = (dropped[k] ?? 0) + 1; };
  for (const r of store.absorb_log) if (r.created_at >= since && !INFORMATION_ONLY.has(r.reason)) bump(r.reason || 'unknown');
  const mine = store.absorb_jobs.filter((j) => j.created_at >= since);
  for (const j of mine) if (j.status === 'failed' || j.status === 'dead') bump(`job_${j.status}`);
  return {
    drained: cliCompleted + mine.filter((j) => j.status === 'completed').length,
    dropped,
    timed_out: mine.filter((j) => QUEUED.has(j.status)).length,
    preexisting_backlog: store.absorb_jobs.filter((j) => j.created_at < since && QUEUED.has(j.status)).length,
    facts_rows: store.facts.length,
  };
}

/** The HE-GBRAIN-018 line for a drain that lost work, or null. */
export function drainProblem(trialId: string, d: TrialGbrainDrain): string | null {
  const dropped = Object.values(d.dropped).reduce((a, b) => a + b, 0);
  const why = [
    d.error ? `the drain failed (${d.error})` : '',
    !d.queue_idle ? `gbrain's facts work did not go quiet within ${Math.round(d.timeout_ms / 1000)} s` : '',
    dropped ? `${dropped} extraction job(s) dropped (${Object.entries(d.dropped).map(([k, v]) => `${k} ${v}`).join(', ')})` : '',
    d.timed_out ? `${d.timed_out} facts-absorb job(s) still queued after gbrain's drain` : '',
  ].filter(Boolean);
  if (!why.length) return null;
  return `HE-GBRAIN-018 trial ${trialId}: ${why.join('; ')}; the trial is infra_error, infra class gbrain_extraction_dropped (docs/errors.md); read <trial dir>/gbrain/serve.log and owner-identity/store.json (absorb_log, absorb_jobs)`;
}

/** Find gbrain's facts_drain phase result in a `dream --json` document. */
export function factsDrainPhase(doc: unknown): { outcome?: string; completed?: number } | null {
  if (!doc || typeof doc !== 'object') return null;
  if ((doc as { phase?: unknown }).phase === 'facts_drain') {
    const d = ((doc as { details?: Record<string, unknown> }).details ?? {});
    return { ...(typeof d.outcome === 'string' ? { outcome: d.outcome } : { outcome: String((doc as { status?: unknown }).status ?? 'unknown') }), ...(typeof d.completed === 'number' ? { completed: d.completed } : {}) };
  }
  for (const v of Object.values(doc as Record<string, unknown>)) { const f = factsDrainPhase(v); if (f) return f; }
  return null;
}

const parseLastJson = (stdout: string): unknown => {
  const start = stdout.indexOf('{');
  try { return start >= 0 ? JSON.parse(stdout.slice(start)) : null; } catch { return null; }
};

/** The facts drain of one trial (see the file header); writes <trial dir>/owner-identity/store.json and returns the record. */
export async function drainGbrain(o: {
  sidecar: Pick<GbrainSidecar, 'url' | 'token' | 'image' | 'container' | 'cliRunArgs' | 'cliEnv' | 'halt'>;
  trialId: string; trialDir: string; since: string; log: (line: string) => void;
  timeoutMs?: number; quietMs?: number; pollMs?: number;
  run?: (argv: string[], timeoutMs?: number) => Promise<{ status: number | null; stdout: string; stderr: string }>;
  callTool?: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
}): Promise<{ record: TrialGbrainDrain; store: GbrainStore | null }> {
  const t0 = Date.now();
  const run = o.run ?? sh;
  const call = o.callTool ?? ((tool: string, args: Record<string, unknown>) => callGbrain(o.sidecar.url, o.sidecar.token, tool, args));
  const timeout_ms = o.timeoutMs ?? DRAIN_DEFAULTS.timeoutMs;
  const quiet_ms = o.quietMs ?? DRAIN_DEFAULTS.quietMs;
  const wait = await waitFactsIdle({ probe: () => probeFactsIdle(call, o.since), timeoutMs: timeout_ms, quietMs: quiet_ms, ...(o.pollMs !== undefined ? { pollMs: o.pollMs } : {}) });
  o.log(`gbrain facts drain: ${wait.idle ? 'quiet' : 'not quiet'} after ${wait.wait_ms} ms (${wait.polls} polls; signals ${wait.signals.join(', ') || 'none'})`);
  const base = { queue_idle: wait.idle, wait_ms: wait.wait_ms, quiet_ms, timeout_ms, polls: wait.polls, signals: wait.signals };
  const brainDir = resolve(o.trialDir, 'gbrain', 'brain-after');
  const fail = (error: string, cli: TrialGbrainDrain['cli_drain'] = 'not_needed') => ({ record: { ...base, cli_drain: cli, drained: 0, dropped: {}, timed_out: 0, preexisting_backlog: 0, facts_rows: 0, wall_ms: Date.now() - t0, error }, store: null });
  try {
    await o.sidecar.halt(DRAIN_DEFAULTS.haltGraceMs);
    rmSync(brainDir, { recursive: true, force: true });
    const cp = await run(['docker', 'cp', '-a', `${o.sidecar.container}:/brain`, brainDir], 300_000);
    if (cp.status !== 0 || !existsSync(join(brainDir, '.gbrain'))) return fail(`docker cp of /brain failed: ${(cp.stderr || cp.stdout).trim().slice(0, 200)}`);
    await run(['bash', '-c', `rm -f '${brainDir}'/.gbrain/*.lock '${brainDir}'/.gbrain/persistence/locks/*`]);
    const dump = async (): Promise<GbrainStore> => {
      const r = await run(dumpDockerArgs(o.sidecar.image, brainDir, uidGid()), 300_000);
      const doc = r.status === 0 ? parseLastJson(r.stdout) : null;
      if (!doc) throw new Error(`store dump failed (exit ${r.status}): ${r.stderr.trim().split('\n').slice(-1)[0]?.slice(0, 200) ?? ''}`);
      return gbrainStoreFrom(doc as Record<string, unknown>);
    };
    let store = await dump();
    let cli: TrialGbrainDrain['cli_drain'] = 'not_needed';
    let cliOutcome: string | undefined;
    let cliCompleted = 0;
    if (drainCounts(store, o.since, 0).timed_out > 0) {
      const script = 'ids="default $(jq -r \'(.sources // [])[].id\' /brain/manifest.json 2>/dev/null | tr \'\\n\' \' \')"; bun /opt/sidecar/gbrain/rebind-sources.ts $ids >&2 && bun /opt/gbrain/src/cli.ts dream --phase facts_drain --json';
      const r = await run(['docker', 'run', '--rm', ...o.sidecar.cliRunArgs, ...o.sidecar.cliEnv, '-v', `${brainDir}:/brain`, '-e', 'GBRAIN_HOME=/brain', '-e', 'HOME=/tmp', '-e', 'GBRAIN_SKIP_STARTUP_HOOKS=1', '-e', 'NO_COLOR=1', '--entrypoint', 'bash', o.sidecar.image, '-c', script], 600_000);
      const phase = factsDrainPhase(parseLastJson(r.stdout));
      cli = r.status === 0 && phase ? 'ran' : 'failed';
      cliOutcome = phase?.outcome ?? `exit ${r.status}`;
      cliCompleted = phase?.completed ?? 0;
      o.log(`gbrain facts drain: gbrain dream --phase facts_drain on the stopped brain: ${cliOutcome}, ${cliCompleted} completed`);
      store = await dump();
    }
    writeStore(storePath(o.trialDir), store);
    const record: TrialGbrainDrain = { ...base, cli_drain: cli, ...(cliOutcome ? { cli_outcome: cliOutcome } : {}), ...drainCounts(store, o.since, cliCompleted), wall_ms: Date.now() - t0 };
    return { record, store };
  } catch (e) {
    return fail((e as Error).message);
  } finally {
    rmSync(brainDir, { recursive: true, force: true });
  }
}
