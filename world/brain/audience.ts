// Audience manifests for qm-brain-native (K8): what each task's audience may see, and what each arm actually receives.
//
// manifestFor computes the authorized page set from corpus.json's access fields (source, readable_by, rooms). The two delivery
// paths are computed independently from rendered artifacts: filesDelivered parses the F arm's files export, brainDelivered
// evaluates the rendered gbrain import tree under the bindings QM is configured with for that audience (BINDINGS). The keyless
// check is that F, R, T and TC receive exactly the manifest and N receives nothing (tests/brain-corpus.test.ts).

import type { Corpus, Page } from './corpus.ts';
import { renderImportPage } from './corpus.ts';

export type Audience = { kind: 'dm'; member: string } | { kind: 'room'; room: string };
export type Arm = 'F' | 'R' | 'T' | 'TC' | 'N';
export const ARMS: readonly Arm[] = ['F', 'R', 'T', 'TC', 'N'];

export const audienceKey = (a: Audience) => (a.kind === 'dm' ? `dm:${a.member}` : `room:${a.room}`);

/**
 * The authorized set. A DM: org pages that are unrestricted or restricted to the member, plus the member's own personal
 * brain. A room: the room's own source, plus unrestricted org pages when every participant may see org memory (no guest).
 * Restricted pages never reach a room; the vault reaches nobody.
 */
export function manifestFor(c: Corpus, a: Audience): Set<string> {
  const out = new Set<string>();
  if (a.kind === 'dm') {
    for (const p of c.pages) {
      if (p.source === 'org' && (!p.readable_by || p.readable_by === a.member)) out.add(p.slug);
      if (p.source === `personal-${a.member}`) out.add(p.slug);
    }
    return out;
  }
  const room = c.rooms.find(r => r.id === a.room);
  if (!room) throw new Error(`HE-BRAIN-008: unknown room ${a.room}`);
  for (const p of c.pages) {
    if (p.source === room.source) out.add(p.slug);
    if (p.source === 'org' && !p.readable_by && room.guests.length === 0) out.add(p.slug);
  }
  return out;
}

/** What QM binds for an audience in the brain arms: which brains, attested as whom, naming which sources. */
export interface Binding { brain: 'company' | 'personal'; attest: string | null; sources: string[] | 'person-grants' }
export function bindingsFor(c: Corpus, a: Audience): Binding[] {
  if (a.kind === 'dm') {
    const b: Binding[] = [{ brain: 'company', attest: a.member, sources: 'person-grants' }];
    if (c.sources.some(s => s.kind === 'personal' && s.owner === a.member)) b.push({ brain: 'personal', attest: a.member, sources: [`personal-${a.member}`] });
    return b;
  }
  const room = c.rooms.find(r => r.id === a.room)!;
  return [{ brain: 'company', attest: null, sources: room.guests.length ? [room.source] : [room.source, 'org'] }];
}

/** Frontmatter fields of a rendered import page. */
function frontmatter(md: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) throw new Error('HE-BRAIN-008: rendered page has no frontmatter');
  return Object.fromEntries(m[1]!.split('\n').map(l => { const i = l.indexOf(': '); return [l.slice(0, i), l.slice(i + 2)]; }));
}

/** The gbrain view: evaluate the rendered import tree under the audience's bindings with gbrain's access rules as configured. */
export function brainDelivered(c: Corpus, a: Audience, rendered: Map<string, string> = renderImportTree(c)): Set<string> {
  const out = new Set<string>();
  for (const b of bindingsFor(c, a)) {
    for (const md of rendered.values()) {
      const fm = frontmatter(md);
      const inBrain = b.brain === 'personal' ? fm.source!.startsWith('personal-') : !fm.source!.startsWith('personal-');
      if (!inBrain || fm.source === 'vault') continue;
      if (b.sources === 'person-grants') {
        if (fm.source !== 'org') continue;
        if (fm.readable_by && fm.readable_by !== b.attest) continue;
      } else {
        if (!b.sources.includes(fm.source!)) continue;
        if (fm.readable_by) continue;
      }
      out.add(fm.slug!);
    }
  }
  return out;
}

export function renderImportTree(c: Corpus): Map<string, string> {
  return new Map(c.pages.map(p => [`${p.source}/${p.slug}.md`, renderImportPage(p)]));
}

/** One files-export page: source, trust, dates, the audience label and relations, with facts and timeline inline. */
export function renderExportPage(c: Corpus, p: Page, inbound: Map<string, string[]>): string {
  const fm = ['---', `slug: ${p.slug}`, `title: ${JSON.stringify(p.title)}`, `source: ${p.source}`, `trust: ${p.trust}`, `created: ${p.created}`, `updated: ${p.updated}`,
    `readable_by: ${p.readable_by ? c.members.find(m => m.id === p.readable_by)!.name : 'everyone in this conversation'}`,
    `links_out: ${JSON.stringify(p.links.map(l => `${l.kind}:${l.to}`))}`, `links_in: ${JSON.stringify(inbound.get(p.slug) ?? [])}`, '---'];
  const parts = [fm.join('\n'), '', `# ${p.title}`, '', p.body];
  if (p.facts.length) parts.push('', '## Facts', '', ...p.facts.map(f => `- ${f.date}: ${f.text}`));
  if (p.timeline.length) parts.push('', '## Timeline', '', ...p.timeline.map(t => `- ${t.date}: ${t.text}`));
  return parts.join('\n') + '\n';
}

/** The F arm's files: one file per manifest page, at notes/<slug>.md, placed in the conversation scope's sandbox workspace. */
export function filesExport(c: Corpus, a: Audience): Map<string, string> {
  const allowed = manifestFor(c, a);
  const inbound = new Map<string, string[]>();
  for (const p of c.pages) if (allowed.has(p.slug)) for (const l of p.links) if (allowed.has(l.to)) inbound.set(l.to, [...(inbound.get(l.to) ?? []), `${l.kind}:${p.slug}`]);
  return new Map(c.pages.filter(p => allowed.has(p.slug)).map(p => [`notes/${p.slug}.md`, renderExportPage(c, p, inbound)]));
}

export function filesDelivered(files: Map<string, string>): Set<string> {
  return new Set([...files.values()].map(md => frontmatter(md).slug!));
}

/** The artifacts each arm receives for an audience: F the files, R, T and TC the bound brains, N nothing. */
export function delivered(c: Corpus, a: Audience, arm: Arm): Set<string> {
  if (arm === 'N') return new Set();
  if (arm === 'F') return filesDelivered(filesExport(c, a));
  return brainDelivered(c, a);
}
