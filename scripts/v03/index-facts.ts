// Index a hand-written list of facts against a world.json: fills each fact's readers from the world's
// access rules, checks the value occurs verbatim in its record, and writes a FactsFile. Used for the public dev
// facts; the held-out facts file comes from scripts/v03/gen-world.ts.
//
//   bun scripts/v03/index-facts.ts --world world/seed/world.json --source tasks/multiuser/v0.3/dev-facts.source.json --split dev --out tasks/multiuser/v0.3/dev-facts.json

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { World } from '../../world/types.ts';
import type { Fact, FactsFile } from './types.ts';

export function readersOf(world: World, f: Pick<Fact, 'record'>): string[] {
  if (f.record.kind === 'message') {
    const m = world.messages.find((x) => x.id === f.record.id);
    const c = m && world.channels.find((x) => x.id === m.channel);
    if (!c) throw new Error('INDEX-RECORD-MISSING ' + f.record.id);
    return [...c.members].sort();
  }
  if (f.record.kind === 'file') {
    const file = world.files.find((x) => x.id === f.record.id);
    if (!file) throw new Error('INDEX-RECORD-MISSING ' + f.record.id);
    return world.members.filter((m) => m.id === file.owner || file.visibility === 'public' || (file.visibility === 'team' && (m.org_wide || (file.team !== null && m.team === file.team)))).map((m) => m.id).sort();
  }
  if (f.record.kind === 'mail') {
    const mail = world.mail.find((x) => x.id === f.record.id);
    if (!mail) throw new Error('INDEX-RECORD-MISSING ' + f.record.id);
    return [...mail.mailbox_members].sort();
  }
  const ev = world.calendar.find((x) => x.id === f.record.id);
  if (!ev) throw new Error('INDEX-RECORD-MISSING ' + f.record.id);
  return [...new Set([ev.organizer, ...ev.attendees])].sort();
}

export function recordText(world: World, f: Pick<Fact, 'record'>): string {
  const r = f.record;
  if (r.kind === 'message') return world.messages.find((x) => x.id === r.id)?.text ?? '';
  if (r.kind === 'file') return world.files.find((x) => x.id === r.id)?.body ?? '';
  if (r.kind === 'mail') { const m = world.mail.find((x) => x.id === r.id); return m ? m.subject + '\n' + m.body : ''; }
  const e = world.calendar.find((x) => x.id === r.id);
  return e ? e.title + '\n' + e.notes : '';
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (k: string) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const worldPath = arg('world')!, source = arg('source')!, out = arg('out')!, split = arg('split') as 'dev' | 'heldout';
  const worldText = readFileSync(worldPath, 'utf8');
  const world = JSON.parse(worldText) as World;
  const facts = (JSON.parse(readFileSync(source, 'utf8')) as Array<Omit<Fact, 'readers'>>).map((f) => ({ ...f, readers: readersOf(world, f) }));
  for (const f of facts) if (!recordText(world, f).includes(f.value)) throw new Error('INDEX-VALUE-NOT-IN-RECORD ' + f.id);
  const file: FactsFile = { schema_version: 1, split, world_json_sha256: createHash('sha256').update(worldText).digest('hex'), facts };
  writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
  console.log('V03: indexed facts=' + facts.length);
}
