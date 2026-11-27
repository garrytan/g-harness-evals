// Arm N of the owner-identity category (internal-task): the agent's notes store with no gbrain, one markdown file per person named
// <person id>.md, kept under the trial directory and served through world-MCP's notes tools (world/world-mcp/tools.ts). It is
// seeded with the same people pages the gbrain arms import, so both arms start from the same people. The runner dumps the
// directory into the owner-identity store after the trial (runner/grade/owner-identity-store.ts dumpNotesStore).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Split } from '../types.ts';

/** A notes file's person id: the ids list_members and notes_list show. */
export const NOTE_PERSON_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A notes file may not grow past this. */
export const NOTE_MAX_BYTES = 64 * 1024;

/** The people pages a set world's gbrain brain imports: <set>/corpus/<split>/people beside <set>/world/world.json. */
export const notesSeedDir = (worldPath: string, split: Split): string => join(dirname(dirname(worldPath)), 'corpus', split, 'people');

/** The seed: every people page, keyed by the person id people.json gives its page_slug (else the page's file name). */
export function readNotesSeed(worldPath: string, split: Split): Record<string, string> {
  const dir = notesSeedDir(worldPath, split);
  if (!existsSync(dir)) throw new Error(`no people pages at ${dir} to seed the notes store from`);
  const peoplePath = join(dirname(worldPath), 'people.json');
  const people = existsSync(peoplePath) ? (JSON.parse(readFileSync(peoplePath, 'utf8')) as { people?: Array<{ id: string; page_slug: string }> }).people ?? [] : [];
  const idOfPage = new Map(people.map((p) => [basename(p.page_slug), p.id]));
  const seed: Record<string, string> = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const page = basename(file, '.md');
    const id = idOfPage.get(page) ?? page;
    if (!NOTE_PERSON_RE.test(id)) throw new Error(`people page ${file} maps to ${JSON.stringify(id)}, not a notes person id`);
    seed[id] = readFileSync(join(dir, file), 'utf8');
  }
  if (!Object.keys(seed).length) throw new Error(`no people pages at ${dir} to seed the notes store from`);
  return seed;
}
