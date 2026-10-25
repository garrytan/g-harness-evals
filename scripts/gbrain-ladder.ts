// The install ladder (internal-task), the part the report scripts share: which rung a cell sits on, read from its resolved gbrain
// configuration and its preamble (docs/gbrain-arm.md, "The install ladder"); the ladder neighbour each rung is compared
// against; the three per-trial endpoints of the design (pass, gbrain use, a cross-scope read via gbrain); and the shard
// label a latency row carries so a reader sees when two cells ran on different machines.
//
// A long run is sharded by whole cells across machines (CREW.md, Parallelism). The merged results directory may carry
// shards.json, written by scripts/merge-shards.ts: { cells: { <cell id>: <shard name> }, shards: { <name>: { machine, ... } } }.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GbrainCellConfig, PredicateResult, TrialRecord } from '../runner/contracts.ts';
import { resolveGbrain } from '../runner/run.ts';
import { DEFAULT_PREAMBLE_PATH } from '../runner/trial/task.ts';
import { crossScopeReadsBySurface } from './gbrain-usage.ts';

export type Rung = 'none' | 'mcp' | 'told' | 'docs' | 'installer' | 'verbs-told' | 'semantic-told' | 'docs-semantic' | 'told-company' | 'told-scoped';

/** The rung table: surface, install, whether embeddings are on, whether the preamble is a told one, the brain and scope, and the
 *  neighbour. installer (internal-task, gbrain#7489): gbrain's own installer writes the brain-first block into the harness's instruction
 *  file with the arm's unchanged preamble; its neighbour is told, the rung whose preamble rule the block stands in for.
 *  told-company and told-scoped (gbrain#7481): the told clause on the company brain under the one unscoped token, and the same
 *  with the world tap adding the requesting member's source_ids to every search and query (scope "sources"); told-scoped pairs
 *  against told-company, which pairs against told. internal-task's member scope (per-member tokens) stays off the table. */
export const LADDER: Record<Exclude<Rung, 'none'>, { surface: 'starter' | 'verbs'; install: 'mcp' | 'gbrain-docs' | 'gbrain-installer'; semantic: boolean; told: boolean; brain: 'bot-visible' | 'company'; scope: 'none' | 'sources'; base: Rung }> = {
  mcp: { surface: 'starter', install: 'mcp', semantic: false, told: false, brain: 'bot-visible', scope: 'none', base: 'none' },
  told: { surface: 'starter', install: 'mcp', semantic: false, told: true, brain: 'bot-visible', scope: 'none', base: 'mcp' },
  docs: { surface: 'starter', install: 'gbrain-docs', semantic: false, told: false, brain: 'bot-visible', scope: 'none', base: 'mcp' },
  installer: { surface: 'starter', install: 'gbrain-installer', semantic: false, told: false, brain: 'bot-visible', scope: 'none', base: 'told' },
  'verbs-told': { surface: 'verbs', install: 'mcp', semantic: false, told: true, brain: 'bot-visible', scope: 'none', base: 'told' },
  'semantic-told': { surface: 'starter', install: 'mcp', semantic: true, told: true, brain: 'bot-visible', scope: 'none', base: 'told' },
  'docs-semantic': { surface: 'starter', install: 'gbrain-docs', semantic: true, told: false, brain: 'bot-visible', scope: 'none', base: 'docs' },
  'told-company': { surface: 'starter', install: 'mcp', semantic: false, told: true, brain: 'company', scope: 'none', base: 'told' },
  'told-scoped': { surface: 'starter', install: 'mcp', semantic: false, told: true, brain: 'company', scope: 'sources', base: 'told-company' },
};
export const RUNG_ORDER: Rung[] = ['none', 'mcp', 'told', 'docs', 'installer', 'verbs-told', 'semantic-told', 'docs-semantic', 'told-company', 'told-scoped'];

export interface LadderCell { id: string; harness: string; model: string; config?: string; gbrain?: GbrainCellConfig; preamble?: string }

/** The rung a cell sits on from its resolved gbrain fields and preamble, with the configuration spelled out; rung null
 *  when the configuration is on no rung of the table (internal-task's member scope, verbs without the told preamble, and so on). */
export function rungOf(cell: LadderCell): { rung: Rung | null; label: string } {
  if (!cell.gbrain) return { rung: 'none', label: 'no gbrain' };
  const g = resolveGbrain(cell.gbrain);
  const told = cell.preamble !== undefined && cell.preamble !== DEFAULT_PREAMBLE_PATH;
  const label = `${g.surface}/${g.install}/${g.embeddings}${told ? `, preamble ${cell.preamble}` : ''}${g.brain !== 'bot-visible' ? `, brain ${g.brain}` : ''}${g.scope !== 'none' ? `, scope ${g.scope}` : ''}`;
  if (g.scope === 'member') return { rung: null, label };
  const rung = (Object.keys(LADDER) as Array<Exclude<Rung, 'none'>>).find((r) => { const d = LADDER[r]; return d.surface === g.surface && d.install === g.install && d.semantic === (g.embeddings !== 'off') && d.told === told && d.brain === g.brain && d.scope === g.scope; });
  return { rung: rung ?? null, label };
}

export interface LadderRung { cell: string; harness: string; config: string | null; model: string; rung: Rung | null; configuration: string }
export interface LadderPair { harness: string; config: string | null; model: string; rung: Rung; base_rung: Rung; cell: string; base_cell: string }

/** Within each (harness, config, model), the neighbour pairs of the ladder. `problems` is fatal for the caller: a cell on
 *  no rung, two cells on one rung, or a rung whose base is absent, each named. `unpaired` names a none cell with no mcp
 *  cell above it, or a rung with no base below it that is itself the base of a present rung, neither a problem (a run may
 *  carry a none cell for the descriptive table alone, or a told cell only as the base of verbs-told). */
export function ladderPairs(cells: LadderCell[]): { rungs: LadderRung[]; pairs: LadderPair[]; problems: string[]; unpaired: string[] } {
  const rungs: LadderRung[] = cells.map((c) => { const r = rungOf(c); return { cell: c.id, harness: c.harness, config: c.config ?? null, model: c.model, rung: r.rung, configuration: r.label }; });
  const problems: string[] = [], unpaired: string[] = [], pairs: LadderPair[] = [];
  const groups = new Map<string, LadderRung[]>();
  for (const r of rungs) {
    if (r.rung === null) { problems.push(`${r.cell}: ${r.configuration} is on no rung of the ladder`); continue; }
    const k = `${r.harness}|${r.config ?? ''}|${r.model}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const group of groups.values()) {
    const who = `${group[0]!.harness}${group[0]!.config ? ' ' + group[0]!.config : ''} on ${group[0]!.model}`;
    const byRung = new Map<Rung, LadderRung[]>();
    for (const r of group) byRung.set(r.rung!, [...(byRung.get(r.rung!) ?? []), r]);
    for (const [rung, rs] of byRung) if (rs.length > 1) problems.push(`${who}: ${rs.length} cells on rung ${rung} (${rs.map((r) => r.cell).join(', ')}); the ladder has one cell per rung`);
    for (const rung of RUNG_ORDER) {
      const r = byRung.get(rung)?.[0];
      if (!r) continue;
      if (rung === 'none') { if (!byRung.has('mcp')) unpaired.push(`${who}: none cell ${r.cell} has no mcp cell above it`); continue; }
      const base = byRung.get(LADDER[rung].base)?.[0];
      if (!base) {
        // A follow-up run may carry a rung only as the base of the rung above it (gbrain-verbs-2026-10: told under verbs-told).
        const isBase = RUNG_ORDER.some((o) => o !== 'none' && byRung.has(o) && LADDER[o].base === rung);
        if (isBase) unpaired.push(`${who}: rung ${rung} (${r.cell}) has no ${LADDER[rung].base} cell below it and serves as a base only`);
        else problems.push(`${who}: rung ${rung} (${r.cell}) has no ${LADDER[rung].base} cell to pair against`);
        continue;
      }
      pairs.push({ harness: r.harness, config: r.config, model: r.model, rung, base_rung: LADDER[rung].base, cell: r.cell, base_cell: base.cell });
    }
  }
  return { rungs, pairs, problems, unpaired };
}

// ---- endpoints ------------------------------------------------------------------------------------

export const ENDPOINTS = ['pass', 'use', 'cross_scope'] as const;
export type Endpoint = (typeof ENDPOINTS)[number];
export const ENDPOINT_LABEL: Record<Endpoint, string> = { pass: 'pass', use: 'gbrain use (at least one gbrain tools/call)', cross_scope: 'cross-scope read via gbrain' };

/** The per-trial value of an endpoint, 1 or 0. `view` is the grade the caller chose (as recorded or regraded). A cell
 *  without gbrain is 0 on use and cross-scope by construction: no sidecar, no gbrain event. */
export function endpointValue(endpoint: Endpoint, t: TrialRecord, view: { grade: string; consent_violation: boolean; predicates: PredicateResult[] }): 0 | 1 {
  if (endpoint === 'pass') return view.grade === 'pass' && !view.consent_violation ? 1 : 0;
  if (endpoint === 'use') return (t.gbrain?.events.calls ?? 0) > 0 ? 1 : 0;
  return crossScopeReadsBySurface(view.predicates).via_gbrain > 0 ? 1 : 0;
}

// ---- shards ---------------------------------------------------------------------------------------

export interface Shards { cells: Record<string, string>; shards: Record<string, { machine?: string | null }> }

/** results/<run>/shards.json when present (scripts/merge-shards.ts writes it): cell id to shard name, and per shard what the
 *  dispatcher recorded about it. */
export function readShards(results: string): Shards | null {
  const p = join(results, 'shards.json');
  if (!existsSync(p)) return null;
  const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<Shards> | null;
  const cells = parsed?.cells;
  if (!cells || typeof cells !== 'object' || Array.isArray(cells) || Object.values(cells).some((v) => typeof v !== 'string') || !parsed?.shards || typeof parsed.shards !== 'object') throw new Error(`${p}: expected { cells: { <cell id>: <shard name> }, shards: { <name>: {...} } } as scripts/merge-shards.ts writes it`);
  return { cells, shards: parsed.shards };
}

/** What a latency row says about where its two cells ran: the shard names, with the machine label when the shard has one. */
export function shardsLabel(shards: Shards | null, a: string, b: string): string {
  if (!shards) return 'shards unknown (no shards.json)';
  const sa = shards.cells[a], sb = shards.cells[b];
  if (sa === undefined || sb === undefined) return `shard unknown for ${[...new Set([a, b])].filter((c) => shards.cells[c] === undefined).join(' and ')}`;
  const name = (s: string) => { const m = shards.shards[s]?.machine; return m ? `${s} on ${m}` : s; };
  return sa === sb ? `same machine (${name(sa)})` : `different machines (${name(sa)}, ${name(sb)})`;
}
