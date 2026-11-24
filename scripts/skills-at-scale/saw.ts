#!/usr/bin/env bun
// Outcome 1 of the skills-at-scale eval, "saw the right skill" (plan, "Outcomes"): which catalog skills the model's captured
// requests carried. runner/trial/run.ts writes the result to saw-skill.json before the scrub removes the requests, and
// analyze.ts reads it ({described, name_only, resolver, block_requests}).
//   described  listed with at least DESC_CHARS characters of its own description (listing-map.ts place: the harness's native
//              listing, parsed as listing-map.ts parseListing reads it; QM's "## Skills" block as qm-listing.ts reads it),
//              or named in a gbrain resolver block (<relevant_skills>, checks.ts blocks)
//   name_only  listed in a native listing with less of its description than that, and never described
//   resolver   named in a gbrain resolver block, and block_requests the number of requests that carried one (a closed block
//              naming at least one catalog skill, so text that only quotes the tag never counts): the record
//              of the resolver arm's part under test (pilot-gate.ts) and of the no-skill block rate (analyze.ts), since
//              gbrain's own hooks leave no status log of ours and the scrub removes the requests
// Every request the trial sent counts; the body the request cap refused does not, since the model never saw it. The
// descriptions come from the cell's catalog manifest (build-ladder.ts --materialize writes them); a catalog file without a
// description for every skill gives no record, so analyze.ts counts the trial under "no value" rather than guess.

import { readFileSync } from 'node:fs';
import { blockIds, blocks } from './checks.ts';
import { MAP_HARNESSES, parseListing, place, type MapHarness } from './listing-map.ts';
import { findSkillsBlocks, parseBlock } from '../skill-resolver/step0/qm/qm-listing.ts';

export const SAW_FILE = 'saw-skill.json';

/** Each catalog skill's description, or null when the file does not give one for every skill. */
export function readCatalogDescriptions(path: string): Map<string, string> | null {
  try {
    const m = JSON.parse(readFileSync(path, 'utf8')) as { skills?: Array<{ name?: unknown; description?: unknown }> };
    if (!Array.isArray(m.skills) || !m.skills.length || !m.skills.every((s) => typeof s.name === 'string' && typeof s.description === 'string')) return null;
    return new Map(m.skills.map((s) => [s.name as string, s.description as string]));
  } catch { return null; }
}

export function sawSkill(o: { harness: string; catalog: Map<string, string>; requests: unknown[] }): { described: string[]; name_only: string[]; resolver: string[]; block_requests: number; requests: number } {
  const described = new Set<string>(), nameOnly = new Set<string>(), resolver = new Set<string>();
  let blockRequests = 0;
  const listed = (name: string, shown: string) => {
    const d = o.catalog.get(name);
    if (d === undefined) return;
    (place({ name, shown, location: null, catalog: true }, d, null, name) === 'with_description' ? described : nameOnly).add(name);
  };
  for (const body of o.requests) {
    if (o.harness === 'qm') for (const b of findSkillsBlocks(body)) for (const e of parseBlock(b.block).entries) listed(e.name, e.desc ?? '');
    else if ((MAP_HARNESSES as readonly string[]).includes(o.harness)) for (const e of parseListing(o.harness as MapHarness, body).entries) if (e.catalog) listed(e.name, e.shown);
    const bs = blocks(body).filter((b) => b.endsWith('</relevant_skills>') && blockIds(b).some((id) => o.catalog.has(id)));
    if (bs.length) blockRequests++;
    for (const b of bs) for (const id of blockIds(b)) if (o.catalog.has(id)) { described.add(id); resolver.add(id); }
  }
  for (const n of described) nameOnly.delete(n);
  return { described: [...described].sort(), name_only: [...nameOnly].sort(), resolver: [...resolver].sort(), block_requests: blockRequests, requests: o.requests.length };
}
