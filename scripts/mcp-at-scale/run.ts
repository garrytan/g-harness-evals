#!/usr/bin/env bun
// The paid MCP-at-scale runner (internal-task): a run spec (mcp-at-scale/1, below) names the request sets, the cells (a
// harness variant from agents.py, a model, an arm, rungs and items) and the shards; one shard runs on one machine under
// its own ledger lease.
//
//   bun scripts/mcp-at-scale/run.ts show   --spec <spec.json>        cells, trials and leases per shard
//   bun scripts/mcp-at-scale/run.ts check  --spec <spec.json>        every set hash, item and rung resolves; leases fit the cap
//   bun scripts/mcp-at-scale/run.ts bundle --spec <spec.json> --out <dir>
//       copies the spec and its set files into <dir> (spec.json naming sets/<file>), for a machine that lacks the set files
//   bun scripts/mcp-at-scale/run.ts keys   --spec <spec.json> --name <shard>   the provider key names the shard's proxy needs
//   bun scripts/mcp-at-scale/run.ts shard  --spec <spec.json> --name <shard> [--out <dir>] [--venv <harbor venv>]
//       [--fake-upstream] [--no-egress] [--gbrain <dir from gbrain.ts build>] [--proxy-port 8790] [--broker-port 8791]
//       [--fake-port 8799] [--phase 1|2 [--prior-phase <phase 1 final dir>]]
//   bun scripts/mcp-at-scale/run.ts merge-phases --spec <spec.json> --name <shard> --out <shard dest>
//   A shard with gbrain cells and no --gbrain builds the gbrain image at versions.json's frozen tag into <out>/work/gbrain-build;
//   either way the image's release must be that tag and commit.
//
// shard starts runner/proxy/metering-proxy.ts and scripts/frontier-harbor/broker.ts the way scripts/frontier-harbor/vm-run.sh
// does (same flags, the proxy alone holding the provider keys, the control token only in the proxy's and the broker's
// environment), under the lease <run_id>:<shard> of the shard's lease_usd in <out>/ledger.sqlite. It materializes the
// shard's tasks with materialize.ts, then runs one Harbor job per trial: each cell's trials one at a time in the shared
// order (below), up to `concurrency` cells at once. The agent classes bind their trial slot through the broker, so a
// container sees only the proxy URL and its per-trial token. After each trial the slot is unbound, its meter finalized,
// and one row appended to <out>/trials.jsonl (TrialRow below; the shape analysis/stats.ts reads). At the end every slot
// is drained as vm-run.sh's finish() does (accounting.json), the ledger summarized (ledger-summary.json) and every file
// under <out> scanned for key-shaped text and for the exact key values (key-scan.json; names and paths only).
//
// Resume: run shard again with the same --out. Trials with a row are skipped; a trial that started without a row (the
// machine stopped mid-trial) has its job directory moved to <out>/jobs-abandoned/ and runs again. Its spend stays in the
// ledger; the new attempt's row takes only a meter key bound after it started, never the abandoned attempt's. The lease reopens under the same id, so lease_usd and the output cap must not change.
// Lease: before each trial the shard reads the lease; with less than trial_headroom_usd left it stops (exit 4, stop.json).
// A trial the proxy refused for budget (HTTP 402) is recorded as INFRA HE-MCP-042 and the shard stops the same way.
// A trial whose metered models (less the harness's housekeeping ones) or setup-probed harness version differ from the
// cell's is INFRA HE-MCP-047; the row's observed field records what ran.
// --fake-upstream runs the keyless proof: scripts/frontier-harbor/fake-upstream.ts behind the proxy, every provider key a
// canary value that must never show up in <out>. Without it the shard's provider keys must be set in this process's
// environment; run.ts takes every provider key out of its own environment before anything else runs, so only the proxy
// gets them.
// Exit: 0 done; 1 spec problems; 2 usage or a missing key, Harbor or gbrain build (nothing ran); 3 the proxy or broker did
// not start; 4 stopped on the lease; 5 the key scan found something; 6 the meter did not drain; 7 an error stopped the shard
// mid-run (the drain, accounting and key scan still ran); 130 stopped by a signal.
//
// Spec (JSON):
//   { "schema": "mcp-at-scale/1", "run_id": "<id>", "catalog"?: "<dir in the repo>" (default tasks/mcp-at-scale/catalog),
//     "sets": [ { "name": "<set>", "file": "<path, relative to the spec>", "sha256": "<hex>" } ],   JSONL, requests/schema.json
//     "cells": [ { "id": "<cell>", "variant": "<listing-map.ts VARIANTS key>", "model": "<provider>/<model>",
//                  "arm": "native" | "mechanism" | "gbrain", "gbrain_cell"?: "full" | "starter" | "verbs" | "registered",
//                  "rungs": [30, ...], "sets": ["<set>"], "items"?: ["<id>", ...] (default: every item of those sets),
//                  "reps"?: <n> (default 1), "rep_sets"?: ["<set>", ...] (default: all the cell's sets) } ],
//     "harness_versions": { "<harness>": "<version from scripts/frontier-harbor/pin.json or scripts/mcp-at-scale/versions.json>" },
//     "shards": [ { "name": "<shard>", "cells": ["<cell>"], "lease_usd": <n>,
//                  "phases"?: [ { "lease_usd": <n>, "expected_hours": <n> }, { "lease_usd": <n>, "expected_hours": <n> } ] } ],
//     "cap_usd": <n>, "reserve_usd": <n>, "concurrency": <cells at once on a shard>, "shared_order_seed": "<seed>",
//     "trial_headroom_usd"?: <n> (default 1), "agent_timeout_sec"?: <n> (default 900), "egress"?: <bool> (default true) }
// Trial id: <run_id>/<cell>/<rung>/<item>. Shared order: a cell's (rung, item) pairs sorted by sha256(seed \0 <rung>/<item>)
// as hex, ties by key, so every cell meets the pairs it shares with another cell in the same order.
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ledgerStatus, verifyLedger } from '../../runner/ledger/budget-ledger.ts';
import { KEY_ENV, upstreamTrouble, type Meter, type UsageLine } from '../../runner/proxy/metering-proxy.ts';
import { ALLOW, TOKEN_PATTERNS } from '../publish-audit.ts';
import { checkCatalog, loadCatalog, rungServers, type Catalog } from './catalog-load.ts';
import { DESIGN_FILE, interimUnits, PHASE1_INDEX, PHASE1_INDEX_SCHEMA, type Design } from './analysis/interim.ts';
import { buildGbrain, GBRAIN_CELLS } from './gbrain.ts';
import { EGRESS_ENVIRONMENT, gatewayIp, SKIPPED, VARIANTS } from './listing-map.ts';
import { acceptableAtRung, materialize, treeSha256, type McpRequest, type PlannedTask } from './materialize.ts';
import { clusterOf } from './requests/seal.ts';
import { schemaProblems, type Item } from './requests/sets.ts';
import { trialEffort, type Effort } from './search-effort.ts';

const REPO = resolve(import.meta.dir, '../..');
export const SPEC_SCHEMA = 'mcp-at-scale/1';
export const ROW_SCHEMA = 'mcp-at-scale-trial/1';
export const DEFAULT_CATALOG = 'tasks/mcp-at-scale/catalog';
/** The frozen harness and gbrain releases (versions.json): a spec may name these besides pin.json's versions. */
const interimDesignBytes = readFileSync(DESIGN_FILE);
export const INTERIM_DESIGN = JSON.parse(interimDesignBytes.toString('utf8')) as Design;
export const VERSIONS = JSON.parse(readFileSync(join(import.meta.dir, 'versions.json'), 'utf8')) as { harnesses: Record<string, { version: string }>; gbrain: { tag: string; commit: string } };
const SLOT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** The row arm (analysis/stats.ts) of each mechanism variant; every other variant is a native arm. */
export const MECHANISM_ARMS: Record<string, string> = { 'claude-code-no-tool-search': 'tool-search-off', 'pi-deferred': 'pi-deferred', 'pi-direct': 'pi-direct' };
/** Providers a harness can call; a harness not listed takes any provider pin.json lists. */
const HARNESS_PROVIDERS: Record<string, string[]> = { 'claude-code': ['anthropic'], codex: ['openai'], 'gemini-cli': ['google'] };
const SPEC_KEYS = ['schema', 'note', 'run_id', 'catalog', 'sets', 'cells', 'harness_versions', 'shards', 'cap_usd', 'reserve_usd', 'concurrency', 'shared_order_seed', 'trial_headroom_usd', 'agent_timeout_sec', 'egress'];
const CELL_KEYS = ['id', 'note', 'variant', 'model', 'arm', 'gbrain_cell', 'rungs', 'sets', 'items', 'reps', 'rep_sets'];

export interface SpecSet { name: string; file: string; sha256: string }
export interface SpecCell { id: string; variant: string; model: string; arm: 'native' | 'mechanism' | 'gbrain'; gbrain_cell?: string; rungs: number[]; sets: string[]; items?: string[]; reps?: number; rep_sets?: string[] }
type Phase = 1 | 2;
interface SpecPhase { lease_usd: number; expected_hours: number }
export interface SpecShard { name: string; cells: string[]; lease_usd: number; phases?: [SpecPhase, SpecPhase] }
export interface Spec {
  schema: string; run_id: string; catalog?: string; sets: SpecSet[]; cells: SpecCell[]; harness_versions: Record<string, string>; shards: SpecShard[];
  cap_usd: number; reserve_usd: number; concurrency: number; shared_order_seed: string; trial_headroom_usd?: number; agent_timeout_sec?: number; egress?: boolean;
}
export interface LoadedSpec { spec: Spec; path: string; dir: string; sha256: string }
export interface PlannedTrial { trial_id: string; cell: string; set: string; item_set: string; request: string; rung: number; rep: number; phase: Phase; order: number }
export interface CellPlan { cell: SpecCell; harness: string; cls: string; version: string; arm: string; shard: string; trials: PlannedTrial[] }
export interface Plan { items: Map<string, Item>; cells: Map<string, CellPlan>; catalogDir: string }

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function loadSpec(path: string): LoadedSpec {
  const raw = readFileSync(path, 'utf8');
  return { spec: JSON.parse(raw) as Spec, path: resolve(path), dir: dirname(resolve(path)), sha256: sha256(raw) };
}

export const setFile = (l: LoadedSpec, s: SpecSet) => (isAbsolute(s.file) ? s.file : resolve(l.dir, s.file));
export const leaseRunId = (spec: Spec, shard: string, phase?: Phase) => spec.run_id + ':' + shard + (phase ? ':p' + phase : '');
const phaseTtl = (p: SpecPhase) => Math.ceil(p.expected_hours * 1.5 + 2);
const phaseDir = (out: string, name: string, phase: Phase) => join(out, 'phase-' + phase, 'final', name);
const phaseSpecSha = (s: Spec) => sha256(JSON.stringify({ ...s, sets: s.sets.map(({ file: _file, ...pin }) => pin) }));
const repSuffix = (rep: number) => rep > 1 ? '/rep' + rep : '';
export const trialId = (runId: string, cell: string, rung: number, item: string, rep = 1) => [runId, cell, rung, item].join('/') + repSuffix(rep);

/** A cell's (rung, item) keys in the shared order: sha256(seed \0 key) as hex, ties by key. */
export function sharedOrder(seed: string, keys: string[]): string[] {
  const h = new Map(keys.map((k) => [k, sha256(seed + '\0' + k)]));
  return [...keys].sort((a, b) => (h.get(a)! < h.get(b)! ? -1 : h.get(a)! > h.get(b)! ? 1 : a < b ? -1 : a > b ? 1 : 0));
}

/** The row arm analysis/stats.ts reads: native, tool-search-off, pi-deferred, pi-direct or gbrain-<surface>. */
export const rowArm = (c: SpecCell) => (c.arm === 'gbrain' ? 'gbrain-' + c.gbrain_cell : c.arm === 'mechanism' ? MECHANISM_ARMS[c.variant] ?? 'mechanism' : 'native');

export function itemRequest(i: Item): McpRequest {
  return { id: i.id, text: i.text, kind: i.kind, acceptable: i.acceptable ?? [], fixtures: (i as { fixtures?: McpRequest['fixtures'] }).fixtures ?? [] };
}
const itemTarget = (i: Item) => ('target' in i && i.target ? i.target : i.acceptable?.[0] ? { server: i.acceptable[0].server, tool: i.acceptable[0].tool } : null);

/** Every problem with the spec, and the plan it gives when there is none. Reads the set files, pin.json and the catalog. */
export function checkSpec(l: LoadedSpec, o: { catalog?: Catalog; pin?: any; versions?: typeof VERSIONS } = {}): { problems: string[]; plan: Plan } {
  const s = l.spec;
  const problems: string[] = [];
  const bad = (m: string) => { problems.push(m); };
  const pin = o.pin ?? JSON.parse(readFileSync(join(REPO, 'scripts/frontier-harbor/pin.json'), 'utf8'));
  const frozen = (o.versions ?? VERSIONS).harnesses;
  const catalogDir = resolve(REPO, s.catalog ?? DEFAULT_CATALOG);
  const items = new Map<string, Item>();
  const cells = new Map<string, CellPlan>();
  let units: Set<string> | undefined;
  const plan: Plan = { items, cells, catalogDir };
  if (s.schema !== SPEC_SCHEMA) bad('schema must be ' + SPEC_SCHEMA);
  for (const k of Object.keys(s)) if (!SPEC_KEYS.includes(k)) bad('unknown spec field ' + k);
  if (typeof s.run_id !== 'string' || !SLOT.test(s.run_id)) bad('run_id must be letters, digits, dot, underscore or dash');
  if (typeof s.shared_order_seed !== 'string' || !s.shared_order_seed) bad('shared_order_seed must be a non-empty string');
  if (!Number.isInteger(s.concurrency) || s.concurrency < 1) bad('concurrency must be a whole number of at least 1');
  if (!num(s.cap_usd) || s.cap_usd <= 0) bad('cap_usd must be a positive number');
  if (!num(s.reserve_usd) || s.reserve_usd < 0) bad('reserve_usd must be zero or more');
  const headroom = s.trial_headroom_usd ?? 1;
  if (!num(headroom) || headroom < 0) bad('trial_headroom_usd must be zero or more');
  if (s.agent_timeout_sec !== undefined && (!Number.isInteger(s.agent_timeout_sec) || s.agent_timeout_sec < 60)) bad('agent_timeout_sec must be a whole number of at least 60');
  if (s.egress !== undefined && typeof s.egress !== 'boolean') bad('egress must be true or false');

  let cat: Catalog | null = o.catalog ?? null;
  if (!cat) {
    try { cat = loadCatalog(catalogDir); } catch (e) { bad('catalog ' + (s.catalog ?? DEFAULT_CATALOG) + ' does not load: ' + (e as Error).message); }
    if (cat) for (const p of checkCatalog(cat)) bad('catalog: ' + p);
  }

  const setItems = new Map<string, Item[]>();
  if (!Array.isArray(s.sets) || !s.sets.length) bad('sets must list at least one set file');
  for (const set of s.sets ?? []) {
    if (typeof set.name !== 'string' || !SLOT.test(set.name)) { bad('set name ' + JSON.stringify(set.name) + ' must be letters, digits, dot, underscore or dash'); continue; }
    if (setItems.has(set.name)) { bad('set ' + set.name + ' is listed twice'); continue; }
    setItems.set(set.name, []);
    const file = setFile(l, set);
    if (!existsSync(file)) { bad('set ' + set.name + ': ' + set.file + ' does not exist'); continue; }
    const raw = readFileSync(file);
    if (sha256(raw) !== set.sha256) { bad('set ' + set.name + ': sha256 of ' + set.file + ' is ' + sha256(raw) + ', the spec pins ' + set.sha256); continue; }
    let list: Item[] = [];
    try { list = raw.toString('utf8').split('\n').filter((x) => x.trim()).map((x) => JSON.parse(x) as Item); } catch (e) { bad('set ' + set.name + ': a line is not JSON (' + (e as Error).message + ')'); }
    for (const p of schemaProblems(list)) bad('set ' + set.name + ': ' + p);
    for (const it of list) {
      if (items.has(it.id)) bad('item ' + it.id + ' is in more than one set');
      items.set(it.id, it);
    }
    setItems.set(set.name, list);
  }

  const versionOf = (harness: string): string | null => {
    const want = s.harness_versions?.[harness];
    const h = pin.harnesses?.[harness];
    if (!h) { bad('pin.json has no harness ' + harness); return null; }
    if (typeof want !== 'string') { bad('harness_versions has no version for ' + harness); return null; }
    if (want !== String(h.version) && !(h.releases && want in h.releases) && want !== frozen[harness]?.version) { bad('harness_versions.' + harness + ' = ' + want + ' is neither pinned in scripts/frontier-harbor/pin.json (pinned ' + h.version + (h.releases ? '; releases ' + Object.keys(h.releases).join(', ') : '') + ') nor frozen in scripts/mcp-at-scale/versions.json (' + (frozen[harness]?.version ?? 'none') + ')'); return null; }
    return want;
  };
  for (const h of Object.keys(s.harness_versions ?? {})) if (!pin.harnesses?.[h]) bad('harness_versions names ' + h + ', which pin.json does not have');

  const shardOf = new Map<string, string>();
  if (!Array.isArray(s.shards) || !s.shards.length) bad('shards must list at least one shard');
  if (s.shards?.some((sh) => sh.phases !== undefined) && s.shards.some((sh) => sh.phases === undefined)) bad('all shards must have phases when the spec uses an interim look');
  const shardNames = new Set<string>();
  for (const sh of s.shards ?? []) {
    if (typeof sh.name !== 'string' || !SLOT.test(sh.name)) { bad('shard name ' + JSON.stringify(sh.name) + ' must be letters, digits, dot, underscore or dash'); continue; }
    if (shardNames.has(sh.name)) bad('shard ' + sh.name + ' is listed twice');
    shardNames.add(sh.name);
    const id = leaseRunId(s, sh.name, sh.phases === undefined ? undefined : 2);
    if (typeof s.run_id === 'string' && id.length > 128) bad('lease id ' + id + ' is longer than 128 characters');
    if (!num(sh.lease_usd) || sh.lease_usd <= 0) bad('shard ' + sh.name + ': lease_usd must be a positive number');
    else if (num(headroom) && sh.lease_usd <= headroom) bad('shard ' + sh.name + ': lease_usd ' + sh.lease_usd + ' is not above trial_headroom_usd ' + headroom + ', so no trial could start');
    if (sh.phases !== undefined) {
      if (!Array.isArray(sh.phases) || sh.phases.length !== 2) bad('shard ' + sh.name + ': phases must list phase 1 and phase 2 in order');
      else {
        for (const [i, p] of sh.phases.entries()) {
          const where = 'shard ' + sh.name + ' phase ' + (i + 1);
          if (!num(p?.lease_usd) || p.lease_usd <= headroom) bad(where + ': lease_usd must be above trial_headroom_usd ' + headroom);
          if (!num(p?.expected_hours) || p.expected_hours <= 0 || phaseTtl(p) > 999) bad(where + ': expected_hours must be positive and give a TTL no greater than 999 hours');
        }
        if (sh.phases.every((p) => num(p?.lease_usd)) && Math.abs(sh.phases[0].lease_usd + sh.phases[1].lease_usd - sh.lease_usd) > 1e-9) {
          bad('shard ' + sh.name + ': phase leases must add up to its lease_usd');
        }
      }
    }
    if (!Array.isArray(sh.cells) || !sh.cells.length) bad('shard ' + sh.name + ' has no cells');
    for (const c of sh.cells ?? []) {
      if (shardOf.has(c)) bad('cell ' + c + ' is on shards ' + shardOf.get(c) + ' and ' + sh.name + '; a cell runs on exactly one shard');
      else shardOf.set(c, sh.name);
    }
  }
  const leases = (s.shards ?? []).reduce((n, sh) => n + (num(sh.lease_usd) ? sh.lease_usd : 0), 0);
  if (num(s.cap_usd) && num(s.reserve_usd) && leases + s.reserve_usd > s.cap_usd + 1e-9) bad('the leases ($' + leases.toFixed(2) + ') plus reserve_usd ($' + s.reserve_usd.toFixed(2) + ') exceed cap_usd ($' + s.cap_usd.toFixed(2) + ')');

  if (!Array.isArray(s.cells) || !s.cells.length) bad('cells must list at least one cell');
  const analysisKeys = new Map<string, string>();
  for (const c of s.cells ?? []) {
    const where = 'cell ' + c.id;
    if (typeof c.id !== 'string' || !SLOT.test(c.id)) { bad('cell id ' + JSON.stringify(c.id) + ' must be letters, digits, dot, underscore or dash'); continue; }
    if (cells.has(c.id)) { bad(where + ' is listed twice'); continue; }
    for (const k of Object.keys(c)) if (!CELL_KEYS.includes(k)) bad(where + ': unknown field ' + k);
    const v = VARIANTS[c.variant];
    if (!v) { bad(where + ': unknown variant ' + c.variant + (SKIPPED[c.variant] ? ' (' + SKIPPED[c.variant] + ')' : '') + '; known: ' + Object.keys(VARIANTS).join(', ')); continue; }
    const m = /^([a-z]+)\/([A-Za-z0-9._-]+)$/.exec(c.model ?? '');
    if (!m) bad(where + ': model must be <provider>/<model>');
    else {
      if (!pin.models?.[m[1] + ':' + m[2]]) bad(where + ': model ' + c.model + ' is not in pin.json models');
      if (HARNESS_PROVIDERS[v.harness] && !HARNESS_PROVIDERS[v.harness]!.includes(m[1]!)) bad(where + ': ' + v.harness + ' cannot call ' + m[1] + ' models');
    }
    if (!['native', 'mechanism', 'gbrain'].includes(c.arm)) bad(where + ': arm must be native, mechanism or gbrain');
    else if (c.arm === 'mechanism' && !MECHANISM_ARMS[c.variant]) bad(where + ': arm mechanism needs a mechanism variant (' + Object.keys(MECHANISM_ARMS).join(', ') + ')');
    else if (c.arm !== 'mechanism' && MECHANISM_ARMS[c.variant]) bad(where + ': variant ' + c.variant + ' is a mechanism variant, so its arm is mechanism');
    if (c.arm === 'gbrain' && !GBRAIN_CELLS.includes(c.gbrain_cell as never)) bad(where + ': a gbrain arm names gbrain_cell (' + GBRAIN_CELLS.join(', ') + ')');
    if (c.arm !== 'gbrain' && c.gbrain_cell !== undefined) bad(where + ': gbrain_cell is only for the gbrain arm');
    const version = versionOf(v.harness);
    if (!shardOf.has(c.id)) bad(where + ' is on no shard');
    const rungs = Array.isArray(c.rungs) ? c.rungs : [];
    if (!rungs.length) bad(where + ': rungs must list at least one rung');
    if (new Set(rungs).size !== rungs.length) bad(where + ': a rung is listed twice');
    const servers = new Map<number, Set<string>>();
    for (const r of rungs) {
      if (!Number.isInteger(r)) { bad(where + ': rung ' + JSON.stringify(r) + ' is not a whole number'); continue; }
      if (!cat) continue;
      try { servers.set(r, new Set(rungServers(cat, String(r)).flatMap((x) => x.tools.map((t) => x.server + '/' + t.name)))); } catch (e) { bad(where + ': ' + (e as Error).message); }
    }
    if (!Array.isArray(c.sets) || !c.sets.length) bad(where + ': sets must name at least one set');
    const reps = c.reps === undefined ? 1 : c.reps;
    if (!Number.isSafeInteger(reps) || reps < 1) { bad(where + ': reps must be a positive whole number'); continue; }
    if (c.rep_sets !== undefined && (reps === 1 || !Array.isArray(c.rep_sets) || !c.rep_sets.length
      || new Set(c.rep_sets).size !== c.rep_sets.length || c.rep_sets.some((s) => !c.sets?.includes(s)))) {
      bad(where + ': rep_sets must name distinct cell sets and needs reps above 1'); continue;
    }
    const pool = (c.sets ?? []).flatMap((n) => { if (!setItems.has(n)) { bad(where + ': unknown set ' + n); return []; } return setItems.get(n)!.map((i) => [i, n] as const); });
    const poolIds = new Map(pool.map(([i, n]) => [i.id, n]));
    if (c.items !== undefined && (!Array.isArray(c.items) || !c.items.length)) bad(where + ': items, when given, lists at least one item');
    const ids = c.items ?? pool.map(([i]) => i.id);
    if (new Set(ids).size !== ids.length) bad(where + ': an item is listed twice');
    for (const id of ids) {
      if (!poolIds.has(id)) { bad(where + ': item ' + id + ' is not in its sets (' + (c.sets ?? []).join(', ') + ')'); continue; }
      if (cat) for (const [r, names] of servers) {
        const unserved = acceptableAtRung(items.get(id)!.acceptable ?? [], cat, names, r, c.arm === 'gbrain');
        if (unserved) bad(where + ': item ' + id + ': ' + unserved);
      }
    }
    const keyed = new Map<string, [number, string, number]>();
    for (const r of rungs) for (const id of ids) if (poolIds.has(id)) {
      const n = !c.rep_sets || c.rep_sets.includes(poolIds.get(id)!) ? reps : 1;
      for (let rep = 1; rep <= n; rep++) keyed.set(r + '/' + id + repSuffix(rep), [r, id, rep]);
    }
    units ??= interimUnits([...items.values()], INTERIM_DESIGN.seed, INTERIM_DESIGN.fraction);
    const lookUnits = units;
    const trials = sharedOrder(String(s.shared_order_seed), [...keyed.keys()]).map((k) => {
      const [rung, id, rep] = keyed.get(k)!;
      const phase: 1 | 2 = lookUnits.has(clusterOf(items.get(id)!).cluster) ? 1 : 2;
      return { trial_id: trialId(s.run_id, c.id, rung, id, rep), cell: c.id, set: poolIds.get(id)!, item_set: items.get(id)!.set, request: id, rung, rep, phase, order: 0 };
    }).sort((a, b) => a.phase - b.phase).map((t, i) => ({ ...t, order: i }));
    const arm = rowArm(c);
    for (const t of trials) {
      const key = JSON.stringify([v.harness, c.model, arm, t.rung, t.request, t.rep]);
      const prior = analysisKeys.get(key);
      if (prior) bad('HE-MCP-031 trials ' + prior + ' and ' + t.trial_id + ' share the analysis key ' + key);
      else analysisKeys.set(key, t.trial_id);
    }
    cells.set(c.id, { cell: c, harness: v.harness, cls: v.cls, version: version ?? '', arm, shard: shardOf.get(c.id) ?? '', trials });
  }
  const defined = new Set((s.cells ?? []).map((c) => c.id));
  for (const [c, sh] of shardOf) if (!defined.has(c)) bad('shard ' + sh + ' names cell ' + c + ', which the spec does not define');
  for (const sh of s.shards ?? []) {
    if (!sh.phases || !Array.isArray(sh.cells)) continue;
    for (const phase of [1, 2]) if (!sh.cells.some((id) => cells.get(id)?.trials.some((t) => t.phase === phase))) {
      bad('shard ' + sh.name + ': phase ' + phase + ' has no trials');
    }
  }
  return { problems, plan };
}

export function showSpec(l: LoadedSpec, plan: Plan): string {
  const s = l.spec;
  const lines = ['run ' + s.run_id + ' (spec sha256 ' + l.sha256 + ')', 'cap $' + s.cap_usd + ', reserve $' + s.reserve_usd + ', concurrency ' + s.concurrency + ', shared order seed ' + s.shared_order_seed];
  let total = 0, leases = 0;
  for (const sh of s.shards) {
    const cs = sh.cells.map((c) => plan.cells.get(c)).filter((c): c is CellPlan => !!c);
    const n = cs.reduce((x, c) => x + c.trials.length, 0);
    total += n; leases += sh.lease_usd;
    const p1 = cs.reduce((x, c) => x + c.trials.filter((t) => t.phase === 1).length, 0);
    lines.push('shard ' + sh.name + ': lease $' + sh.lease_usd + (sh.phases ? '' : ' (' + leaseRunId(s, sh.name) + ')') + ', ' + cs.length + ' cell(s), ' + n + ' trial(s): phase 1 ' + p1 + ', phase 2 ' + (n - p1));
    for (const phase of [1, 2] as const) if (sh.phases) {
      const p = sh.phases[phase - 1]!;
      lines.push('  phase ' + phase + ': lease $' + p.lease_usd.toFixed(2) + ' (' + leaseRunId(s, sh.name, phase) + '), expected ' + p.expected_hours + 'h, TTL ' + phaseTtl(p) + 'h');
    }
    for (const c of cs) lines.push('  ' + c.cell.id + '\t' + c.cell.variant + '@' + c.version + '\t' + c.cell.model + '\t' + c.arm + '\trungs ' + c.cell.rungs.join(',') + '\t' + new Set(c.trials.map((t) => t.request)).size + ' item(s)\t' + c.trials.length + ' trial(s)');
  }
  lines.push('total: ' + total + ' trial(s), leases $' + leases.toFixed(2) + ' of the $' + s.cap_usd + ' cap');
  return lines.join('\n');
}

// ---- rows -------------------------------------------------------------------------------------------------------------

export interface TrialUsage {
  requests: number; forwarded: number; refused: number; failed: number; lease_refused: number;
  input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; line_usd: number;
}
export const newUsage = (): TrialUsage => ({ requests: 0, forwarded: 0, refused: 0, failed: 0, lease_refused: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, line_usd: 0 });
/** A request the proxy refused because the lease could not reserve it (an unpriced request is a different 402). */
export const leaseRefusal = (l: UsageLine) => l.outcome === 'refused' && l.status === 402 && !/unpriced/i.test(l.reason ?? '');
export function addUsage(u: TrialUsage, l: UsageLine): TrialUsage {
  if (l.outcome === 'estimated') return u;
  u.requests += 1;
  if (l.outcome === 'forwarded') u.forwarded += 1;
  else if (l.outcome === 'refused') u.refused += 1;
  else if (l.outcome === 'failed') u.failed += 1;
  if (leaseRefusal(l)) u.lease_refused += 1;
  u.input_tokens += l.input_tokens ?? 0;
  u.output_tokens += l.output_tokens ?? 0;
  u.cache_read_tokens += l.cached_tokens ?? 0;
  u.cache_write_tokens += l.cache_write_tokens ?? 0;
  u.line_usd += l.actual_usd ?? 0;
  return u;
}

export interface Infra { code: string; detail: string; source: 'grader' | 'runner' }
export interface TrialRow {
  schema: string; trial_id: string; run_id: string; shard: string; cell: string; set: string; spec_set: string; request: string; rung: number; rep: number; phase: Phase; order: number;
  harness: string; variant: string; version: string; model: string; arm: string; cell_arm: string; gbrain_cell?: string;
  job: string; meter_key: string | null; outcomes: Record<string, any> | null; infra: Infra | null; reward: number | null;
  usage: { usd: number; requests: number; forwarded: number; refused: number; failed: number; input_tokens: number; output_tokens: number;
    cache_read_tokens: number; cache_write_tokens: number; cache_read_share: number | null; unpriced: number; undrained: number; by_model: Meter['byModel'] } | null;
  effort: Effort | null; host_log: string | null; harbor_exception: { type: string; message: string } | null;
  observed: { models: string[]; version: string | null };
  started_at: string; ended_at: string; duration_s: number; gap_s: number | null;
}
export interface RowInput {
  runId: string; shard: string; planned: PlannedTrial; cell: CellPlan; job: string; meterKey: string | null;
  result: Record<string, any> | null; outcomes: Record<string, any> | null; meter: Meter | null; usage: TrialUsage | null;
  effort: Effort | null; hostLog: string | null; startedAt: string; endedAt: string; gapS: number | null; trialDirFound: boolean;
  housekeeping?: string[]; cliVersion?: string | null;
}

export function observedCliVersion(trialDir: string | null): string | null {
  if (!trialDir) return null;
  try {
    const value: unknown = JSON.parse(readFileSync(join(trialDir, 'observed-cli-version.json'), 'utf8'));
    return typeof value === 'string' && value ? value : null;
  } catch { return null; }
}

export function observedRun(i: Pick<RowInput, 'cell' | 'meter' | 'housekeeping' | 'cliVersion'>): { models: string[]; version: string | null; problem: string | null } {
  const want = i.cell.cell.model.replace('/', ':');
  const models = Object.keys(i.meter?.byModel ?? {}).filter((m) => !(i.housekeeping ?? []).includes(m)).sort();
  const version = i.cliVersion ?? null;
  const problems = [
    ...models.filter((m) => m !== want).map((m) => 'the proxy metered ' + m + ', not the cell model ' + want),
    ...(i.cliVersion !== undefined && (i.cell.harness === 'codex' || i.cell.harness === 'claude-code') && version !== i.cell.version
      ? ['the ' + i.cell.harness + ' setup observed version ' + (version ?? 'none') + ', not the pinned ' + i.cell.version] : []),
  ];
  return { models, version, problem: problems.length ? problems.join('; ') : null };
}

/** The INFRA a runner sees and the grader cannot: the lease refused a request, Harbor gave no trial or no verdict, the
 *  meter did not drain, or the provider failed. A lease refusal comes first, ahead of the grader's own INFRA too, so the
 *  shard always stops on it; otherwise the grader's INFRA comes first. */
export function runnerInfra(i: Pick<RowInput, 'result' | 'outcomes' | 'meter' | 'usage' | 'trialDirFound'>): { code: string; detail: string } | null {
  const ex = i.result?.exception_info;
  if (i.usage && i.usage.lease_refused > 0) return { code: 'HE-MCP-042', detail: i.usage.lease_refused + ' request(s) refused because the lease could not reserve them' };
  if (!i.trialDirFound) return { code: 'HE-MCP-040', detail: 'Harbor left no trial directory' };
  if (!i.outcomes) return ex
    ? { code: 'HE-MCP-040', detail: 'Harbor trial failed before a verdict: ' + String(ex.exception_type ?? 'exception') + ': ' + String(ex.exception_message ?? '').slice(0, 300) }
    : { code: 'HE-MCP-041', detail: 'the verifier wrote no outcomes.json' };
  if (i.meter && (i.meter.undrained ?? 0) > 0) return { code: 'HE-MCP-043', detail: i.meter.undrained + ' request(s) still in flight when the meter was finalized; the cost is incomplete' };
  if (upstreamTrouble(i.meter)) return { code: 'HE-MCP-044', detail: 'the provider failed during the trial: ' + JSON.stringify(i.meter!.upstream) };
  return null;
}

/** One trials.jsonl row. outcomes is grade.py's outcomes.json; when the runner finds INFRA the grader did not (or a lease
 *  refusal, which replaces the grader's), the row's
 *  outcomes carry it in infra (so analysis/stats.ts leaves the trial out) and infra.source says "runner". */
export function buildRow(i: RowInput): TrialRow {
  const c = i.cell;
  const seen = observedRun(i);
  const found = runnerInfra(i) ?? (seen.problem ? { code: 'HE-MCP-047', detail: seen.problem } : null);
  const graderInfra = i.outcomes?.infra && found?.code !== 'HE-MCP-042' ? { code: String(i.outcomes.infra.code), detail: String(i.outcomes.infra.detail ?? ''), source: 'grader' as const } : null;
  const mine = graderInfra ? null : found;
  const infra: Infra | null = graderInfra ?? (mine ? { ...mine, source: 'runner' } : null);
  const outcomes = i.outcomes ? (mine ? { ...i.outcomes, infra: { code: mine.code, detail: mine.detail } } : i.outcomes) : null;
  const u = i.usage;
  const ex = i.result?.exception_info;
  const secs = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 10) / 100;
  return {
    schema: ROW_SCHEMA, trial_id: i.planned.trial_id, run_id: i.runId, shard: i.shard, cell: c.cell.id, set: i.planned.item_set, spec_set: i.planned.set, request: i.planned.request,
    rung: i.planned.rung, rep: i.planned.rep, phase: i.planned.phase, order: i.planned.order, harness: c.harness, variant: c.cell.variant, version: c.version, model: c.cell.model, arm: c.arm,
    cell_arm: c.cell.arm, ...(c.cell.gbrain_cell ? { gbrain_cell: c.cell.gbrain_cell } : {}), job: i.job, meter_key: i.meterKey,
    outcomes, infra, reward: infra || !outcomes ? null : Number(outcomes.reward),
    usage: i.meter || u ? {
      usd: i.meter?.usd ?? u?.line_usd ?? 0, requests: u?.requests ?? i.meter?.requests ?? 0, forwarded: u?.forwarded ?? 0, refused: u?.refused ?? 0, failed: u?.failed ?? 0,
      input_tokens: u?.input_tokens ?? 0, output_tokens: u?.output_tokens ?? 0, cache_read_tokens: u?.cache_read_tokens ?? 0, cache_write_tokens: u?.cache_write_tokens ?? 0,
      cache_read_share: u && u.input_tokens > 0 ? Number((u.cache_read_tokens / u.input_tokens).toFixed(4)) : null,
      unpriced: i.meter?.unpriced ?? 0, undrained: i.meter?.undrained ?? 0, by_model: i.meter?.byModel ?? {},
    } : null,
    effort: i.effort, host_log: i.hostLog,
    harbor_exception: ex ? { type: String(ex.exception_type ?? 'exception'), message: String(ex.exception_message ?? '').slice(0, 300) } : null,
    observed: { models: seen.models, version: seen.version },
    started_at: i.startedAt, ended_at: i.endedAt, duration_s: secs(i.startedAt, i.endedAt), gap_s: i.gapS,
  };
}

export function readRows(path: string): TrialRow[] {
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as TrialRow) : [];
}
/** Appends a row; a trial that already has one is refused, since a row is never rewritten. */
export function appendRow(path: string, row: TrialRow): void {
  if (readRows(path).some((r) => r.trial_id === row.trial_id)) throw new Error('HE-MCP-045 trial ' + row.trial_id + ' already has a row in ' + path + '; rows are never rewritten');
  appendFileSync(path, JSON.stringify(row) + '\n');
}

/** Reads the proxy's usage log as it grows and sums it per meter key. */
export class UsageReader {
  private offset = 0;
  private rest = '';
  readonly byKey = new Map<string, TrialUsage>();
  constructor(private path: string) {}
  read(): void {
    if (!existsSync(this.path)) return;
    const fd = openSync(this.path, 'r');
    try {
      const size = fstatSync(fd).size;
      if (size <= this.offset) return;
      const buf = Buffer.alloc(size - this.offset);
      readSync(fd, buf, 0, buf.length, this.offset);
      this.offset = size;
      const lines = (this.rest + buf.toString('utf8')).split('\n');
      this.rest = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const l = JSON.parse(line) as UsageLine;
        if (!this.byKey.has(l.key)) this.byKey.set(l.key, newUsage());
        addUsage(this.byKey.get(l.key)!, l);
      }
    } finally { closeSync(fd); }
  }
  get(key: string): TrialUsage | null { this.read(); return this.byKey.get(key) ?? null; }
}

/** Key-shaped text (scripts/publish-audit.ts TOKEN_PATTERNS, less its allowlist) and the exact secret values in every
 *  readable file under root. Returns pattern and value names with file paths, never a match. */
export function scanForKeys(root: string, values: Record<string, string>): { files: number; unreadable: number; patterns: Record<string, string[]>; values: Record<string, string[]> } {
  const out = { files: 0, unreadable: 0, patterns: {} as Record<string, string[]>, values: {} as Record<string, string[]> };
  const walk = (d: string) => {
    let names: string[] = [];
    try { names = readdirSync(d); } catch { out.unreadable += 1; return; }
    for (const n of names) {
      const p = join(d, n);
      let st;
      try { st = lstatSync(p); } catch { out.unreadable += 1; continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { walk(p); continue; }
      if (!st.isFile()) continue;
      let text: string;
      try { text = readFileSync(p, 'latin1'); } catch { out.unreadable += 1; continue; }
      out.files += 1;
      const rel = relative(root, p);
      for (const [name, re] of Object.entries(TOKEN_PATTERNS)) {
        const g = new RegExp(re.source, 'g');
        for (let m = g.exec(text); m; m = g.exec(text)) if (!ALLOW.some((a) => a.test(m![0]))) { (out.patterns[name] ??= []).push(rel); break; }
      }
      for (const [name, v] of Object.entries(values)) if (v && v.length >= 8 && text.includes(v)) (out.values[name] ??= []).push(rel);
    }
  };
  walk(root);
  return out;
}

/** Copies the spec and its set files into out, the spec naming each set as sets/<set>-<file>. */
export function bundleSpec(l: LoadedSpec, out: string): string {
  mkdirSync(join(out, 'sets'), { recursive: true });
  const sets = l.spec.sets.map((s) => {
    const name = s.name + '-' + basename(s.file);
    copyFileSync(setFile(l, s), join(out, 'sets', name));
    return { ...s, file: 'sets/' + name };
  });
  const path = join(out, 'spec.json');
  writeFileSync(path, JSON.stringify({ ...l.spec, sets }, null, 1) + '\n');
  return path;
}

export function shardIdentity(l: LoadedSpec, plan: Plan, name: string, commit: string, fake: boolean, egress: boolean, phase?: Phase) {
  return {
    run_id: l.spec.run_id, shard: name, phase: phase ?? null, commit, mode: fake ? 'fake-upstream' : 'paid', egress,
    spec_sha256: l.sha256, spec_content_sha256: phaseSpecSha(l.spec), catalog_sha256: treeSha256(plan.catalogDir),
  };
}
type ShardIdentity = ReturnType<typeof shardIdentity>;
const jsonAt = (dir: string, name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const identityDiff = (a: ShardIdentity, b: ShardIdentity) => (Object.keys(a) as (keyof ShardIdentity)[]).filter((k) => a[k] !== b?.[k]);

function finalAccountingProblem(dir: string, identity: ShardIdentity, lease: string, cap: number): string | null {
  for (const f of ['ledger.sqlite', 'accounting.json', 'ledger-summary.json', 'key-scan.json']) {
    if (!existsSync(join(dir, f))) return 'missing phase final receipt: ' + f;
  }
  try {
    const a = jsonAt(dir, 'accounting.json');
    const summary = jsonAt(dir, 'ledger-summary.json');
    const scan = jsonAt(dir, 'key-scan.json');
    if (identityDiff(identity, a.identity).length) return 'final accounting does not match the shard identity';
    if (a.drained !== true || !Array.isArray(a.undrained) || a.undrained.length || !num(a.committed_usd)
      || a.lease !== lease || summary.run_id !== lease || a.lease_usd !== cap || summary.lease_usd !== cap || !num(summary.committed_usd)
      || Math.abs(a.committed_usd - summary.committed_usd) > 1e-6 || summary.committed_usd < 0 || summary.committed_usd > cap + 1e-6) {
      return 'phase ledger is not drained under its lease';
    }
    const ledger = join(dir, 'ledger.sqlite');
    const verified = verifyLedger(ledger);
    const held = verified.ok ? ledgerStatus({ ledgerPath: ledger, runId: lease }) : null;
    if (!held?.run || held.runs !== 1 || held.totals.open_reservations_usd !== 0 || Math.abs(held.run.budget_usd - cap) > 1e-9
      || Math.abs(held.run.committed_usd - a.committed_usd) > 1e-6 || Math.abs(held.totals.committed_usd - a.committed_usd) > 1e-6) {
      return 'phase ledger.sqlite does not reconcile with its final accounting (one drained lease, committed as recorded)';
    }
    if (!scan.patterns || !scan.values || scan.unreadable !== 0 || Object.keys(scan.patterns).length || Object.keys(scan.values).length) {
      return 'phase key scan is not clean';
    }
    return null;
  } catch { return 'phase finals contain an invalid receipt'; }
}

function phaseRows(l: LoadedSpec, plan: Plan, shard: SpecShard, phase: Phase, dir: string, commit: string, fake: boolean, requireCleanup = true): TrialRow[] {
  const fail = (reason: string): never => { throw new Error('shard ' + shard.name + ' phase ' + phase + ': ' + reason); };
  const read = (file: string) => {
    const path = join(dir, file);
    if (!existsSync(path)) fail('missing phase final receipt: ' + file);
    return JSON.parse(readFileSync(path, 'utf8'));
  };
  if (requireCleanup && read('cleanup.json').cleanup !== 'done') fail('cleanup is not done');
  const actual: ShardIdentity = read('run-identity.json');
  const expected = shardIdentity(l, plan, shard.name, commit, fake, !fake || actual.egress, phase);
  if (!commit || !/^[0-9a-f]{64}$/.test(actual.spec_sha256) || identityDiff(expected, actual).some((k) => k !== 'spec_sha256')) {
    fail('phase does not match the spec, commit, catalog or mode');
  }
  const lease = leaseRunId(l.spec, shard.name, phase);
  const cap = shard.phases![phase - 1]!.lease_usd;
  const finalProblem = finalAccountingProblem(dir, actual, lease, cap);
  if (finalProblem) fail(finalProblem);
  const rows = readRows(join(dir, 'trials.jsonl'));
  const outstanding = new Set(shard.cells.flatMap((id) => plan.cells.get(id)!.trials.filter((t) => t.phase === phase).map((t) => t.trial_id)));
  for (const r of rows) if (r.phase !== phase || r.run_id !== l.spec.run_id || r.shard !== shard.name || !outstanding.delete(r.trial_id)) {
    fail('duplicate or unexpected trial row ' + r.trial_id);
  }
  if (outstanding.size) fail(outstanding.size + ' planned trial(s) missing from the phase final');
  return rows;
}

/** A phase final's rows with each host log made relative to out, the directory of the index they go into. */
function rebased(rows: TrialRow[], dir: string, out: string): TrialRow[] {
  return rows.map((r) => {
    if (!r.host_log) return r;
    const log = resolve(dir, r.host_log);
    if (!log.startsWith(dir + '/') || !existsSync(log)) throw new Error('missing or invalid phase host log for ' + r.trial_id);
    return { ...r, host_log: relative(out, log) };
  });
}

function mergePhases(l: LoadedSpec, plan: Plan, shard: SpecShard, out: string, commit: string, fake: boolean) {
  const rows = ([1, 2] as const).flatMap((phase) => {
    const dir = phaseDir(out, shard.name, phase);
    return rebased(phaseRows(l, plan, shard, phase, dir, commit, fake), dir, out);
  });
  writeFileSync(join(out, 'trials.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { flag: 'wx' });
  return rows.length;
}

/** The interim look's input: every phased shard's phase 1 final, each complete, drained and cleaned up (phaseRows), as one
 *  index at <out>/trials.jsonl, with <out>/phase-1-index.json naming each shard's phase 1 trials.jsonl sha256 and the
 *  index's. interim.ts look refuses an index without it. */
export function phase1Index(l: LoadedSpec, plan: Plan, finals: string[], out: string, commit: string, fake: boolean): number {
  const byShard = new Map<string, string>();
  for (const d of finals) {
    const dir = resolve(d);
    const name = String(jsonAt(dir, 'run-identity.json').shard);
    if (byShard.has(name)) throw new Error('two phase 1 finals for shard ' + name);
    byShard.set(name, dir);
  }
  const phased = l.spec.shards.filter((s) => s.phases);
  const missing = phased.filter((s) => !byShard.has(s.name)).map((s) => s.name);
  if (!phased.length || missing.length || byShard.size !== phased.length) {
    throw new Error('the phase 1 index needs exactly one phase 1 final per phased shard' + (missing.length ? '; missing ' + missing.join(', ') : ''));
  }
  const shards: Record<string, string> = {};
  const rows = phased.flatMap((sh) => {
    const dir = byShard.get(sh.name)!;
    const r = rebased(phaseRows(l, plan, sh, 1, dir, commit, fake), dir, out);
    shards[sh.name] = sha256(readFileSync(join(dir, 'trials.jsonl')));
    return r;
  });
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'trials.jsonl'), text, { flag: 'wx' });
  writeFileSync(join(out, PHASE1_INDEX), JSON.stringify({ schema: PHASE1_INDEX_SCHEMA, run_id: l.spec.run_id, shards, trials_sha256: sha256(text),
    design_sha256: sha256(interimDesignBytes), sets_sha256: l.spec.sets.map((set) => set.sha256) }, null, 1) + '\n', { flag: 'wx' });
  return rows.length;
}

/** Why phase 2 of a shard may not start: no completed interim look, or a look computed from other phase 1 trials. */
export function interimProblem(l: LoadedSpec, statePath: string | undefined, shard: string, phase1Dir: string): string | null {
  try {
    const s = JSON.parse(readFileSync(statePath!, 'utf8'));
    if (s.schema !== 'he-mcp-at-scale-interim-state/1' || s.look !== 'interim' || s.status !== 'complete' || !s.decisions) return 'the interim look has no recorded decision';
    if (s.phase1_shards?.[shard] !== sha256(readFileSync(join(phase1Dir, 'trials.jsonl')))) return 'the interim decision was not computed from this shard\'s phase 1 trials';
    if (s.run_id !== l.spec.run_id || s.design_sha256 !== sha256(interimDesignBytes)
      || JSON.stringify(s.sets_sha256) !== JSON.stringify(l.spec.sets.map((set) => set.sha256))) return 'the interim decision does not match the frozen run, design and request sets';
    const roster = l.spec.shards.map((sh) => sh.name).sort();
    if (JSON.stringify(Object.keys(s.phase1_shards).sort()) !== JSON.stringify(roster)
      || !Object.values(s.phase1_shards).every((hash) => typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash))) return 'the interim decision does not cover all phase 1 shards';
    const decisions = ['no data at the look', 'continue', 'stop_efficacy', 'stop_opposite', 'stop_futility'];
    if (Object.keys(s.decisions).length !== INTERIM_DESIGN.comparisons.length
      || !INTERIM_DESIGN.comparisons.every((comparison) => decisions.includes(s.decisions[comparison.id]))) return 'the interim look has no recorded decision for every frozen comparison';
    return null;
  } catch { return 'phase 2 needs the interim look\'s completed state file (--interim-state)'; }
}

// ---- the shard --------------------------------------------------------------------------------------------------------

interface ShardOptions { out: string; venv: string; fake: boolean; phase?: Phase; priorPhase?: string; egress: boolean; gbrain?: string; proxyPort: number; brokerPort: number; fakePort: number; keys: Record<string, string> }
const git = (...a: string[]) => Bun.spawnSync(['git', ...a], { cwd: REPO, env: baseEnv(), stdout: 'pipe' }).stdout.toString().trim();
interface Stop { reason: 'lease' | 'signal' | 'error'; detail: string }

const baseEnv = () => ({ PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', TZ: 'UTC' });
const say = (out: string, m: string) => { const line = new Date().toISOString() + ' ' + m; console.log(line); appendFileSync(join(out, 'run.log'), line + '\n'); };

async function post(url: string, body: unknown, control?: string): Promise<any> {
  const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(control ? { 'x-proxy-control': control } : {}) }, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(new URL(url).pathname + ' answered ' + res.status);
  return res.json();
}

/** The models a shard's slots allow (frontier_settings.slot_models: each cell model plus its harness's housekeeping model). */
export function slotModels(cells: CellPlan[]): string[] {
  const pairs = JSON.stringify(cells.map((c) => [c.harness, c.cell.model.replace('/', ':')]));
  const p = Bun.spawnSync(['python3', '-c', 'import sys,json; sys.path.insert(0, sys.argv[1]); import frontier_settings as f; print(",".join(sorted({m for a in json.loads(sys.argv[2]) for m in f.slot_models(*a)})))', join(REPO, 'scripts/frontier-harbor'), pairs], { env: baseEnv(), stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error('HE-MCP-046 reading the slot models failed: ' + p.stderr.toString().slice(-400));
  return p.stdout.toString().trim().split(',').filter(Boolean);
}

export function plannedTaskInputs(cells: CellPlan[], items: Map<string, Item>) {
  const trials = cells.flatMap((c) => c.trials.map((t): PlannedTask => ({
    request: t.request, rung: String(t.rung), gbrainCell: c.cell.gbrain_cell,
  })));
  return {
    requests: [...new Set(trials.map((t) => t.request))].map((id) => itemRequest(items.get(id)!)),
    rungs: [...new Set(trials.map((t) => t.rung))],
    planned: trials,
  };
}

export async function runShard(l: LoadedSpec, plan: Plan, name: string, o: ShardOptions): Promise<number> {
  const s = l.spec;
  const shard = s.shards.find((x) => x.name === name);
  if (!shard) { console.error('the spec has no shard ' + name); return 2; }
  if (!o.fake && (s.egress === false || !o.egress)) { console.error('a paid shard must run behind the egress blocklist'); return 2; }
  if (!!shard.phases !== !!o.phase) { console.error('shard ' + name + ': --phase is required only for shards with phase leases'); return 2; }
  const commit = git('rev-parse', 'HEAD');
  if (!commit) { console.error('cannot identify the shard checkout commit'); return 2; }
  let prior: TrialRow[] = [];
  if (o.phase === 2) {
    try {
      if (!o.priorPhase) throw new Error('phase 2 needs --prior-phase with phase 1 final receipts');
      prior = phaseRows(l, plan, shard, 1, o.priorPhase, commit, o.fake);
      const interim = interimProblem(l, join(o.priorPhase, 'interim-state.json'), name, o.priorPhase);
      if (interim) throw new Error('shard ' + name + ' phase 2: ' + interim);
    } catch (e) { console.error((e as Error).message); return 2; }
  }
  const cells = shard.cells.map((c) => plan.cells.get(c)!).map((c) => (o.phase ? { ...c, trials: c.trials.filter((t) => t.phase === o.phase) } : c));
  const leaseUsd = o.phase ? shard.phases![o.phase - 1]!.lease_usd : shard.lease_usd;
  const leaseRun = leaseRunId(s, name, o.phase);
  const out = o.out;
  const identity = shardIdentity(l, plan, name, commit, o.fake, o.egress, o.phase);
  try {
    mkdirSync(out, { recursive: true });
    const state = join(out, 'run-identity.json');
    if (existsSync(state)) {
      const mismatch = identityDiff(identity, jsonAt(out, 'run-identity.json'));
      if (mismatch.length) throw new Error('shard resume identity mismatch: ' + mismatch.join(', '));
    } else {
      if (readdirSync(out).length) throw new Error('shard output already exists without an immutable run identity');
      writeFileSync(state, JSON.stringify(identity, null, 1) + '\n', { flag: 'wx' });
    }
  } catch (e) { console.error((e as Error).message); return 2; }
  for (const d of ['jobs', 'configs', 'logs', 'work']) mkdirSync(join(out, d), { recursive: true });
  const trialsPath = join(out, 'trials.jsonl');
  const rowsAtStart = readRows(trialsPath);
  if (o.phase && rowsAtStart.some((r) => r.phase !== o.phase || r.run_id !== s.run_id || r.shard !== name)) {
    console.error('shard ' + name + ': output rows belong to a different run, shard or phase'); return 2;
  }
  const done = new Set([...prior, ...rowsAtStart].map((r) => r.trial_id));
  const todo = cells.reduce((n, c) => n + c.trials.filter((t) => !done.has(t.trial_id)).length, 0);
  const dirty = git('status', '--porcelain', '--untracked-files=no') !== '';
  const mode = o.fake ? 'fake-upstream' : 'paid';
  appendFileSync(join(out, 'shard-runs.jsonl'), JSON.stringify({ at: new Date().toISOString(), event: rowsAtStart.length ? 'resume' : 'start', run_id: s.run_id, shard: name, spec_sha256: l.sha256, commit, dirty, mode, egress: o.egress, phase: o.phase ?? null, recorded: rowsAtStart.length, prior_phase_recorded: prior.length, todo }) + '\n');
  say(out, 'shard ' + name + ': ' + rowsAtStart.length + ' trial(s) recorded, ' + todo + ' to run' + (o.phase ? ' (phase ' + o.phase + ' only)' : '') + (commit ? ', commit ' + commit.slice(0, 12) + (dirty ? ' (dirty tree)' : '') : ''));
  if (!todo && !finalAccountingProblem(out, identity, leaseRun, leaseUsd)) return 0;
  const ledgerPath = join(out, 'ledger.sqlite');
  const summarize = () => Bun.spawnSync([process.execPath, 'runner/proxy/metering-proxy.ts', 'summary', '--budget-ledger', ledgerPath, '--run-id', leaseRun, '--usage-log', join(out, 'proxy-usage.ndjson')], { cwd: REPO, env: baseEnv(), stdout: 'pipe', stderr: 'pipe' });
  if (existsSync(ledgerPath) ? summarize().exitCode !== 0 : rowsAtStart.length > 0) {
    say(out, 'shard state has no matching original lease; refusing to open a new lease'); return 6;
  }

  const models = slotModels(cells);
  const housekeeping = new Map(cells.map((c) => [c.cell.id, slotModels([c]).filter((m) => m !== c.cell.model.replace('/', ':'))]));
  const providers = [...new Set(models.map((m) => m.split(':')[0]!))];
  const keyNames = providers.map((p) => KEY_ENV[p as keyof typeof KEY_ENV]).filter(Boolean);
  const missing = o.fake ? [] : keyNames.filter((k) => !o.keys[k]);
  if (missing.length) { say(out, 'the shard calls ' + providers.join(', ') + ' and ' + missing.join(', ') + ' is not set; nothing ran'); return 2; }
  if (todo && !existsSync(join(o.venv, 'bin/harbor'))) { say(out, 'no Harbor at ' + join(o.venv, 'bin/harbor') + '; nothing ran'); return 2; }

  const pending = cells.map((c) => ({ ...c, trials: c.trials.filter((t) => !done.has(t.trial_id)) })).filter((c) => c.trials.length);
  const plain = pending.filter((c) => c.cell.arm !== 'gbrain');
  const gb = pending.filter((c) => c.cell.arm === 'gbrain');
  const agentTimeout = s.agent_timeout_sec ?? 900;
  let gbrainDir = o.gbrain;
  if (gb.length && !gbrainDir) {
    gbrainDir = join(out, 'work/gbrain-build');
    say(out, 'building the gbrain image at the frozen ' + VERSIONS.gbrain.tag + ' (scripts/mcp-at-scale/versions.json)');
    try { await buildGbrain(gbrainDir, VERSIONS.gbrain.tag); } catch (e) { say(out, 'the gbrain build failed: ' + (e as Error).message.slice(0, 600) + '; nothing ran'); return 2; }
  }
  if (gb.length) {
    const rel = JSON.parse(readFileSync(join(gbrainDir!, 'gbrain-image.json'), 'utf8')).release ?? {};
    if (rel.tag !== VERSIONS.gbrain.tag || rel.commit !== VERSIONS.gbrain.commit) { say(out, 'the gbrain image is ' + rel.tag + ' ' + rel.commit + ', not the frozen ' + VERSIONS.gbrain.tag + ' ' + VERSIONS.gbrain.commit + ' (scripts/mcp-at-scale/versions.json); nothing ran'); return 2; }
  }
  if (plain.length) await materialize({ catalog: plan.catalogDir, ...plannedTaskInputs(plain, plan.items), out: join(out, 'work/native'), build: true, agentTimeout });
  if (gb.length) {
    const image = JSON.parse(readFileSync(join(gbrainDir!, 'gbrain-image.json'), 'utf8'));
    const surfaces = [...new Set(gb.map((c) => c.cell.gbrain_cell!))];
    await materialize({ catalog: plan.catalogDir, ...plannedTaskInputs(gb, plan.items), out: join(out, 'work/gbrain'), build: true, agentTimeout, gbrain: { image: image.tag, cells: Object.fromEntries(surfaces.map((g) => [g, image.cells[g].serve_args])) } });
  }
  const taskDir = (c: CellPlan, t: PlannedTrial) => (c.cell.arm === 'gbrain' ? join(out, 'work/gbrain/tasks', t.request + '__r' + t.rung + '__gb-' + c.cell.gbrain_cell) : join(out, 'work/native/tasks', t.request + '__r' + t.rung));

  // the proxy, the broker and (keyless) the fake upstream, started as vm-run.sh starts them
  const gw = gatewayIp();
  const control = randomBytes(32).toString('hex');
  const pin = JSON.parse(readFileSync(join(REPO, 'scripts/frontier-harbor/pin.json'), 'utf8'));
  const maxOut = Math.max(...Object.values(pin.models as Record<string, { max_output_tokens: number }>).map((m) => m.max_output_tokens));
  const procs: Array<ReturnType<typeof Bun.spawn>> = [];
  const canary = o.fake ? 'fake-provider-key-canary-' + randomBytes(16).toString('hex') : null;
  let upstream: string[] = [];
  if (canary) {
    const f = 'http://127.0.0.1:' + o.fakePort;
    procs.push(Bun.spawn([process.execPath, 'scripts/frontier-harbor/fake-upstream.ts', '--listen', '127.0.0.1:' + o.fakePort, '--log', join(out, 'fake-upstream.jsonl'), '--bodies', join(out, 'fake-upstream-bodies.jsonl'), '--canary-env', 'FAKE_UPSTREAM_CANARY'],
      { cwd: REPO, env: { ...baseEnv(), FAKE_UPSTREAM_CANARY: canary }, stdout: Bun.file(join(out, 'fake-upstream.log')), stderr: Bun.file(join(out, 'fake-upstream.err.log')) }));
    upstream = ['anthropic=' + f, 'openai=' + f, 'particle=' + f + '/particle', 'openrouter=' + f + '/openrouter', 'google=' + f + '/google', 'xai=' + f + '/xai'].flatMap((u) => ['--upstream', u]);
  }
  const keys: Record<string, string> = Object.fromEntries(keyNames.map((k) => [k, canary ?? o.keys[k]!]));
  const proxyUrl = 'http://' + gw + ':' + o.proxyPort;
  procs.push(Bun.spawn([process.execPath, 'runner/proxy/metering-proxy.ts', '--listen', gw + ':' + o.proxyPort, '--budget-ledger', ledgerPath, '--lease-usd', String(leaseUsd), '--run-id', leaseRun,
    '--usage-log', join(out, 'proxy-usage.ndjson'), '--allow-models', models.join(','), '--refuse-hosted-tools', '--capture-bodies', join(out, 'jobs'), '--max-output-tokens', String(maxOut), ...upstream],
  { cwd: REPO, env: { ...baseEnv(), ...keys, SHOOTOUT_PROXY_CONTROL_TOKEN: control }, stdout: Bun.file(join(out, 'proxy.log')), stderr: Bun.file(join(out, 'proxy.err.log')) }));
  procs.push(Bun.spawn([process.execPath, 'scripts/frontier-harbor/broker.ts', '--listen', '127.0.0.1:' + o.brokerPort, '--proxy', proxyUrl, '--gateway', proxyUrl, '--models', models.join(','), '--log', join(out, 'binds.jsonl'), '--capture'],
    { cwd: REPO, env: { ...baseEnv(), SHOOTOUT_PROXY_CONTROL_TOKEN: control }, stdout: Bun.file(join(out, 'broker.log')), stderr: Bun.file(join(out, 'broker.err.log')) }));
  const stopProcs = async () => { for (const p of procs) try { p.kill(); } catch { /* gone */ } await Promise.all(procs.map((p) => p.exited)); };
  const status = async () => (await fetch(proxyUrl + '/__proxy/status', { signal: AbortSignal.timeout(10_000) })).json() as Promise<{ run_id: string; lease_usd: number; committed_usd: number }>;
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await status()).run_id === leaseRun && (await fetch('http://127.0.0.1:' + o.brokerPort + '/binds')).ok; } catch { up = false; }
    if (!up) await Bun.sleep(500);
  }
  if (!up || procs.some((p) => p.exitCode !== null)) { say(out, 'the metering proxy (lease ' + leaseRun + ') or the broker did not come up; see proxy.err.log and broker.err.log'); await stopProcs(); return 3; }
  say(out, 'proxy up on ' + gw + ':' + o.proxyPort + ' (lease ' + leaseRun + ' $' + leaseUsd + ', models ' + models.join(',') + (o.fake ? ', fake upstream' : '') + '), broker on 127.0.0.1:' + o.brokerPort + ', ' + (o.egress ? 'egress blocklist' : 'plain docker'));

  const usage = new UsageReader(join(out, 'proxy-usage.ndjson'));
  const harborEnv = { ...baseEnv(), PATH: join(o.venv, 'bin') + ':' + baseEnv().PATH, PYTHONPATH: [join(REPO, 'scripts/mcp-at-scale'), join(REPO, 'scripts/frontier-harbor')].join(':'), PYTHONDONTWRITEBYTECODE: '1' };
  const headroom = s.trial_headroom_usd ?? 1;
  let stop: Stop | null = null;
  const running = new Set<ReturnType<typeof Bun.spawn>>();
  const onSignal = (sig: string) => () => { stop ??= { reason: 'signal', detail: sig }; for (const p of running) try { p.kill('SIGINT'); } catch { /* gone */ } };
  process.on('SIGINT', onSignal('SIGINT'));
  process.on('SIGTERM', onSignal('SIGTERM'));
  const readJson = (f: string | null) => { try { return f && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; } catch { return null; } };
  const binds = () => (existsSync(join(out, 'binds.jsonl')) ? readFileSync(join(out, 'binds.jsonl'), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x) as { trial: string; job?: string }) : []);

  const lastEnds = new Map<string, string>();
  for (const r of rowsAtStart) if (r.ended_at > (lastEnds.get(r.cell) ?? '')) lastEnds.set(r.cell, r.ended_at);
  const runCell = async (c: CellPlan) => {
    for (const t of c.trials) {
      if (stop) return;
      if (done.has(t.trial_id)) continue;
      const st = await status();
      if (st.lease_usd - st.committed_usd < headroom) { stop ??= { reason: 'lease', detail: '$' + (st.lease_usd - st.committed_usd).toFixed(4) + ' left of the $' + st.lease_usd + ' lease, below trial_headroom_usd $' + headroom }; return; }
      const job = c.cell.id + '__a1__r' + t.rung + '-' + t.request + (t.rep > 1 ? '__rep' + t.rep : '');
      if (existsSync(join(out, 'jobs', job))) {
        mkdirSync(join(out, 'jobs-abandoned'), { recursive: true });
        renameSync(join(out, 'jobs', job), join(out, 'jobs-abandoned', job + '.' + Date.now()));
        say(out, 'moved the unrecorded job ' + job + ' to jobs-abandoned/');
      }
      const config = {
        job_name: job, jobs_dir: join(out, 'jobs'), n_attempts: 1, n_concurrent_trials: 1, quiet: true, retry: { max_retries: 0 },
        environment: { import_path: o.egress ? EGRESS_ENVIRONMENT : 'harbor.environments.docker.docker:DockerEnvironment', delete: true },
        verifier: { disable: false },
        agents: [{ name: 'mcp-' + c.cell.variant, import_path: 'agents:' + c.cls, model_name: c.cell.model, kwargs: { version: c.version, broker_url: 'http://127.0.0.1:' + o.brokerPort, cell: c.cell.id, attempt: 1 } }],
        tasks: [{ path: taskDir(c, t) }],
      };
      writeFileSync(join(out, 'configs', job + '.json'), JSON.stringify(config, null, 1) + '\n');
      const startedAt = new Date().toISOString();
      const bindsBefore = binds().length;
      const p = Bun.spawn([join(o.venv, 'bin/harbor'), 'run', '-y', '-c', join(out, 'configs', job + '.json')], { cwd: out, env: harborEnv, stdout: Bun.file(join(out, 'logs', job + '.log')), stderr: Bun.file(join(out, 'logs', job + '.stderr')) });
      running.add(p);
      const guard = setTimeout(() => { try { p.kill('SIGINT'); } catch { /* gone */ } setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* gone */ } }, 60_000); }, (agentTimeout + 1800) * 1000);
      const code = await p.exited;
      clearTimeout(guard);
      running.delete(p);
      const endedAt = new Date().toISOString();
      const jobDir = join(out, 'jobs', job);
      const trialName = existsSync(jobDir) ? readdirSync(jobDir).find((d) => existsSync(join(jobDir, d, 'result.json')) || existsSync(join(jobDir, d, 'agent'))) ?? null : null;
      const trialDir = trialName ? join(jobDir, trialName) : null;
      const meterKey = binds().slice(bindsBefore).filter((b) => b.job === job).pop()?.trial ?? null;
      let meter: Meter | null = null;
      if (meterKey) {
        await post(proxyUrl + '/__proxy/unbind', { slot: meterKey }, control).catch(() => null);
        for (let i = 0; i < 3; i++) {
          meter = await post(proxyUrl + '/__proxy/finalize', { key: meterKey, timeout_ms: 30_000 }, control).catch(() => meter);
          if (!meter?.undrained) break;
        }
        appendFileSync(join(out, 'meter-final.jsonl'), JSON.stringify({ key: meterKey, meter }) + '\n');
      }
      const outcomes = readJson(trialDir && join(trialDir, 'verifier/outcomes.json'));
      const item = plan.items.get(t.request)!;
      const target = item.kind === 'tool' ? itemTarget(item) : null;
      let effort: Effort | null = null;
      if (trialDir && target) try { effort = trialEffort(trialDir, target); } catch { effort = null; }
      const hostLog = trialDir && existsSync(join(trialDir, 'verifier/catalog-calls.jsonl')) ? relative(out, join(trialDir, 'verifier/catalog-calls.jsonl')) : null;
      const lastEnd = lastEnds.get(c.cell.id);
      const gapS = lastEnd ? Math.round((Date.parse(startedAt) - Date.parse(lastEnd)) / 10) / 100 : null;
      const row = buildRow({ runId: s.run_id, shard: name, planned: t, cell: c, job, meterKey, result: readJson(trialDir && join(trialDir, 'result.json')), outcomes, meter, usage: meterKey ? usage.get(meterKey) : null, effort, hostLog, startedAt, endedAt, gapS, trialDirFound: !!trialDir,
        housekeeping: housekeeping.get(c.cell.id), cliVersion: observedCliVersion(trialDir) });
      if ((stop as Stop | null)?.reason === 'signal' && !row.outcomes) { say(out, job + ' was cut by a signal; no row, so it runs again on resume'); return; }
      appendRow(trialsPath, row);
      done.add(t.trial_id);
      lastEnds.set(c.cell.id, endedAt);
      say(out, [t.trial_id, 'harbor exit ' + code, row.infra ? 'INFRA ' + row.infra.code : 'reward ' + row.reward, '$' + (row.usage?.usd ?? 0).toFixed(4), (row.usage?.requests ?? 0) + ' request(s)'].join('  '));
      if (row.infra?.code === 'HE-MCP-042') { stop ??= { reason: 'lease', detail: 'the proxy refused a request of ' + t.trial_id + ' for budget' }; return; }
    }
  };
  for (const phase of (o.phase ? [o.phase] : [1, 2])) {
    if (stop) break;
    const queue = cells.map((c) => ({ ...c, trials: c.trials.filter((t) => t.phase === phase && !done.has(t.trial_id)) })).filter((c) => c.trials.length);
    await Promise.all(Array.from({ length: Math.min(s.concurrency, queue.length) }, async () => {
      try { for (let c = queue.shift(); c; c = queue.shift()) await runCell(c); } catch (e) {
        say(out, 'shard ' + name + ' failed: ' + ((e as Error).stack ?? String(e)).slice(0, 2000));
        stop ??= { reason: 'error', detail: String((e as Error).message ?? e).slice(0, 300) };
      }
    }));
  }

  // the drain, as vm-run.sh's finish(): unbind every slot, then finalize every bound key until nothing is in flight
  await post('http://127.0.0.1:' + o.brokerPort + '/unbind-all', {}).catch(() => null);
  const keysBound = [...new Set(binds().map((b) => b.trial))];
  const undrained: string[] = [];
  for (const k of keysBound) {
    let m: Meter | null = null;
    for (let i = 0; i < 3; i++) { m = await post(proxyUrl + '/__proxy/finalize', { key: k, timeout_ms: 30_000 }, control).catch(() => null); if (m && !m.undrained) break; }
    if (!m || m.undrained) undrained.push(k);
  }
  const final = await status().catch(() => null);
  writeFileSync(join(out, 'accounting.json'), JSON.stringify({ at: new Date().toISOString(), lease: leaseRun, lease_usd: leaseUsd, committed_usd: final?.committed_usd ?? null, keys: keysBound.length, undrained, drained: !!final && undrained.length === 0, identity }, null, 1) + '\n');
  await stopProcs();
  const summary = summarize();
  writeFileSync(join(out, 'ledger-summary.json'), summary.stdout.toString());
  const rows = readRows(trialsPath);
  const recorded = new Set(rows.map((r) => r.trial_id));
  const left = cells.reduce((n, c) => n + c.trials.filter((t) => !recorded.has(t.trial_id)).length, 0);
  const scan = scanForKeys(out, { ...keys, SHOOTOUT_PROXY_CONTROL_TOKEN: control });
  writeFileSync(join(out, 'key-scan.json'), JSON.stringify({ at: new Date().toISOString(), ...scan }, null, 1) + '\n');
  const hits = Object.keys(scan.patterns).length + Object.keys(scan.values).length;
  const stopped = stop as Stop | null;
  if (stopped) writeFileSync(join(out, 'stop.json'), JSON.stringify({ at: new Date().toISOString(), ...stopped, left }, null, 1) + '\n');
  appendFileSync(join(out, 'shard-runs.jsonl'), JSON.stringify({ at: new Date().toISOString(), event: 'end', recorded: rows.length, left, stop: stopped, committed_usd: final?.committed_usd ?? null, undrained: undrained.length, key_scan_hits: hits }) + '\n');
  say(out, 'shard ' + name + ' ended: ' + rows.length + ' row(s), ' + left + ' left' + (stopped ? ', stopped (' + stopped.reason + ': ' + stopped.detail + ')' : '') + ', lease $' + (final?.committed_usd ?? 0).toFixed(4) + ' of $' + leaseUsd + ' committed, key scan ' + (hits ? hits + ' HIT(S), see key-scan.json' : 'clean') + ' over ' + scan.files + ' file(s)');
  if (hits) return 5;
  const finalProblem = finalAccountingProblem(out, identity, leaseRun, leaseUsd);
  if (finalProblem) { say(out, finalProblem); return 6; }
  if (stopped) return stopped.reason === 'lease' ? 4 : stopped.reason === 'error' ? 7 : 130;
  return 0;
}

if (import.meta.main) {
  const providerKeys: Record<string, string> = {};
  for (const k of new Set(Object.values(KEY_ENV))) {
    if (process.env[k]) providerKeys[k] = process.env[k]!;
    delete process.env[k];
  }
  const [cmd, ...argv] = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const specPath = flag('--spec');
  if (!specPath || !['show', 'check', 'shard', 'bundle', 'keys', 'phase-ttl', 'phase-check', 'phase-complete', 'merge-phases', 'phase-1-index'].includes(cmd ?? '')) {
    console.error('usage: run.ts show|check|bundle|keys|shard|phase-ttl|phase-check|phase-complete|merge-phases|phase-1-index --spec <spec.json> [--name <shard>] [--out <dir>] [--phase 1|2] [--prior-phase <dir>] [--interim-state <state.json>] [--finals <dir>...]');
    process.exit(2);
  }
  const l = loadSpec(specPath);
  const { problems, plan } = checkSpec(l);
  if (problems.length) {
    console.error('the spec has ' + problems.length + ' problem(s):\n' + problems.map((p) => '  ' + p).join('\n'));
    process.exit(1);
  }
  if (cmd === 'check') { console.log('ok: ' + l.spec.run_id + ' (spec sha256 ' + l.sha256 + ')'); process.exit(0); }
  if (cmd === 'show') { console.log(showSpec(l, plan)); process.exit(0); }
  if (cmd === 'phase-1-index') {
    const out = flag('--out');
    const finals = argv.includes('--finals') ? argv.slice(argv.indexOf('--finals') + 1) : [];
    const end = finals.findIndex((x) => x.startsWith('--'));
    if (!out || !finals.length || end === 0) { console.error('phase-1-index needs --out <dir> and --finals <phase 1 final dir>...'); process.exit(2); }
    try { console.log('indexed ' + phase1Index(l, plan, end < 0 ? finals : finals.slice(0, end), resolve(out), git('rev-parse', 'HEAD'), argv.includes('--fake-upstream')) + ' phase 1 rows into ' + join(resolve(out), 'trials.jsonl')); }
    catch (e) { console.error((e as Error).message); process.exit(2); }
    process.exit(0);
  }
  if (cmd === 'bundle') {
    const out = flag('--out');
    if (!out) { console.error('bundle needs --out'); process.exit(2); }
    console.log(bundleSpec(l, resolve(out)));
    process.exit(0);
  }
  const name = flag('--name');
  const shard = l.spec.shards.find((s) => s.name === name);
  if (!name || !shard) { console.error(cmd + ' needs --name <one of the spec\'s shards>'); process.exit(2); }
  if (cmd === 'keys') {
    const models = slotModels(shard.cells.map((c) => plan.cells.get(c)!));
    console.log([...new Set(models.map((m) => KEY_ENV[m.split(':')[0] as keyof typeof KEY_ENV]))].filter(Boolean).join(' '));
    process.exit(0);
  }
  const phaseArg = flag('--phase');
  if (argv.includes('--phase') && phaseArg !== '1' && phaseArg !== '2') { console.error('--phase takes 1 or 2'); process.exit(2); }
  const phase = phaseArg === '1' ? 1 : phaseArg === '2' ? 2 : undefined;
  const fake = argv.includes('--fake-upstream');
  if ((cmd === 'phase-ttl' || cmd === 'shard') && !!phase !== !!shard.phases) { console.error('--phase is required only for shards with phase leases'); process.exit(2); }
  if (cmd === 'phase-ttl') {
    if (!fake && l.spec.egress === false) { console.error('a paid shard must run behind the egress blocklist'); process.exit(2); }
    if (phase) console.log(phaseTtl(shard.phases![phase - 1]!) + ' ' + leaseRunId(l.spec, name, phase));
    process.exit(0);
  }
  if (cmd === 'phase-check' || cmd === 'phase-complete' || cmd === 'merge-phases') {
    const out = flag('--out');
    if (!out || !shard.phases || (cmd !== 'merge-phases' && !phase)) { console.error(cmd + ' needs a phased shard, an --out directory and --phase except when merging'); process.exit(2); }
    const dir = resolve(out);
    const commit = git('rev-parse', 'HEAD');
    try {
      if (cmd === 'merge-phases') console.log('merged ' + mergePhases(l, plan, shard, dir, commit, fake) + ' rows into ' + join(dir, 'trials.jsonl'));
      else {
        phaseRows(l, plan, shard, phase!, dir, commit, fake, cmd === 'phase-check');
        const interim = cmd === 'phase-check' ? interimProblem(l, flag('--interim-state') && resolve(flag('--interim-state')!), name, dir) : null;
        if (interim) throw new Error('shard ' + name + ' phase 2: ' + interim);
        if (cmd === 'phase-complete') writeFileSync(join(dir, 'cleanup.json'), JSON.stringify({ cleanup: 'done', at: new Date().toISOString() }) + '\n', { flag: 'wx' });
      }
    } catch (e) { console.error((e as Error).message); process.exit(2); }
    process.exit(0);
  }
  const noEgress = argv.includes('--no-egress');
  if (noEgress && !fake) { console.error('--no-egress is only for the keyless --fake-upstream proof; a paid shard runs behind the egress blocklist'); process.exit(2); }
  const out = resolve(flag('--out') ?? join('results/mcp-at-scale', l.spec.run_id, name));
  mkdirSync(out, { recursive: true });
  const code = await runShard(l, plan, name, {
    out, phase, priorPhase: flag('--prior-phase'), venv: resolve(flag('--venv') ?? join(process.env.HOME ?? '', '.frontier-harbor/venv')), fake, egress: (l.spec.egress ?? true) && !noEgress,
    gbrain: flag('--gbrain') ? resolve(flag('--gbrain')!) : undefined,
    proxyPort: Number(flag('--proxy-port') ?? 8790), brokerPort: Number(flag('--broker-port') ?? 8791), fakePort: Number(flag('--fake-port') ?? 8799), keys: providerKeys,
  });
  process.exit(code);
}
