// internal-task (H10): which cells are route cells, and the texts the metering proxy counts for them (runner/proxy/metering-proxy.ts
// routeCopies). A route cell is a cell of one of the four route harnesses whose config parses (parseRouteConfig) to a route
// other than "default"; route-tool, the control, is one, so its copies (expected 0) are on the record too. Every other cell,
// and every run with no route cell, binds and starts the proxy exactly as before.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRouteConfig, SLOT_ROUTES, type RouteConfig } from '../contracts.ts';
import type { RouteTexts } from '../proxy/metering-proxy.ts';

export const ROUTE_HARNESSES = ['openclaw', 'hermes', 'claude-code', 'codex'] as const;

/** The brain-first skill's description, the line a skill route puts in the skills list (harnesses/routes/README.md, "Skill
 *  file, both harnesses"). The proxy counts it as a listing, the discovery signal of the skill routes. */
export const BRAIN_FIRST_DESCRIPTION = 'Check GBrain first, before answering any turn.';

/** The cell's parsed route, or null for a cell that is not a route cell (another harness, no config, "default", or a config
 *  the grammar refuses, which the adapter then refuses with HE-ADAPTER-007). */
export function cellRoute(cell: { harness: string; config?: string }): RouteConfig | null {
  if (!(ROUTE_HARNESSES as readonly string[]).includes(cell.harness) || !cell.config) return null;
  try {
    const r = parseRouteConfig(cell.config, cell.harness);
    return r.route === 'default' ? null : r;
  } catch { return null; }
}

/** The proxy's route texts for a run, or undefined when no cell is a route cell: the rule and the placebo bytes as copies, and
 *  as listings the brain-first description plus the description in slot.json of each slot a cell names. */
export function routeTextsFor(cells: Array<{ harness: string; config?: string }>, repoRoot = '.'): RouteTexts | undefined {
  const routes = cells.map(cellRoute).filter((r): r is RouteConfig => r !== null);
  if (!routes.length) return undefined;
  const read = (p: string) => readFileSync(join(repoRoot, p), 'utf8');
  const slots = [...new Set(routes.filter((r) => SLOT_ROUTES.includes(r.route) && r.slot).map((r) => r.slot!))].sort();
  const slotDescriptions = slots.map((s) => join('harnesses', 'routes', 'slots', s, 'slot.json')).filter((p) => existsSync(join(repoRoot, p)))
    .map((p) => (JSON.parse(read(p)) as { description?: unknown }).description).filter((d): d is string => typeof d === 'string' && d.length > 0);
  return {
    copies: [read(join('harnesses', 'routes', 'instruction.md')), read(join('harnesses', 'routes', 'placebo.md'))],
    listing: [...new Set([BRAIN_FIRST_DESCRIPTION, ...slotDescriptions])],
  };
}
