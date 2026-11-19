// The owner-identity store: what a trial's memory holds once it is drained and stopped, in one shape for every arm
// (docs/owner-identity.md). A gbrain arm (G, B) and row P dump the brain with gbrain/owner-identity-dump.ts, run by gbrain's own
// engine against the stopped brain: read-only SQL through gbrain, because gbrain at a26eb922 has no CLI or MCP read that lists
// fact rows with attributed_to, and `gbrain call list_pages` pages 100 rows with no compiled truth. The no-gbrain arm (N) dumps a
// notes directory, one <person id>.md file per person. writeStore puts the result at <trial dir>/owner-identity/store.json.
//
//   bun runner/grade/owner-identity-store.ts --brain <dir> [--image <gbrain image> | --gbrain-src <gbrain checkout>/src] --out <store.json>
//   bun runner/grade/owner-identity-store.ts --notes <dir> --out <store.json>

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export type RawKind = 'conversation' | 'meeting' | 'session';
export type FactSourceCategory = 'hook' | 'sweep' | 'model_write' | 'import';

export interface StorePage {
  slug: string;
  source_id: string;
  type: string;
  title: string;
  frontmatter: Record<string, unknown>;
  compiled_truth: string;
  timeline: string;
  timeline_entries: Array<{ date: string; source: string; summary: string; detail: string }>;
  source_kind: string | null;
  /** Set on a raw conversation, meeting or capture-banked session page, which holds its import verbatim and is never an owner surface. */
  raw_kind: RawKind | null;
}

export interface StoreFact {
  id: number;
  source_id: string;
  entity_slug: string | null;
  fact: string;
  context: string | null;
  kind: string;
  visibility: string;
  /** facts.source as gbrain wrote it (a capture-sources.ts tag, or remember's provenance text) and its category. */
  source: string;
  source_category: FactSourceCategory;
  source_session: string | null;
  attributed_to: string | null;
  /** gbrain's speaker-unknown home: no entity, or held on memory/unattributed (a folder's own holding page included). */
  unattributed: boolean;
  /** Expired or superseded: kept in the dump, never graded. */
  expired: boolean;
}

export interface StoreAbsorb { id: number; source_ref: string; reason: string; summary: string; created_at: string }
export interface StoreJob { status: string; created_at: string }

export interface GbrainStore {
  schema_version: 1;
  kind: 'gbrain';
  read_via: 'gbrain/owner-identity-dump.ts (read-only SQL through gbrain\'s engine)';
  gbrain_version: string | null;
  owner_member: string | null;
  pages: StorePage[];
  facts: StoreFact[];
  absorb_log: StoreAbsorb[];
  absorb_jobs: StoreJob[];
}

export interface NotesStore {
  schema_version: 1;
  kind: 'notes';
  notes: Array<{ person_id: string; file: string; text: string }>;
}

export type OwnerIdentityStore = GbrainStore | NotesStore;

export const UNATTRIBUTED_SLUG = 'memory/unattributed';
const RAW_TYPES: Record<string, RawKind> = { conversation: 'conversation', transcript: 'conversation', slack: 'conversation', email: 'conversation', meeting: 'meeting', session: 'session' };
const RAW_PREFIXES: Array<[string, RawKind]> = [['conversations/sessions/', 'session'], ['sessions/', 'session'], ['conversations/', 'conversation'], ['transcripts/', 'conversation'], ['meetings/', 'meeting']];

/** A page that holds an import or a captured session verbatim: by type, by slug folder, or by a capture source kind. */
export function rawKind(page: Pick<StorePage, 'slug' | 'type' | 'source_kind'>): RawKind | null {
  const byType = RAW_TYPES[page.type];
  if (byType) return byType;
  const prefix = RAW_PREFIXES.find(([p]) => page.slug.startsWith(p));
  if (prefix) return prefix[1];
  return /capture|session|transcript/i.test(page.source_kind ?? '') ? 'session' : null;
}

/** facts.source by lane (src/core/facts/capture-sources.ts at a26eb922): hook:* and sweep:* are the ambient capture lanes; sync:import,
 *  file_upload, code_import and conversation extraction are imports; everything else (put_page, extract_facts, remember with its
 *  provenance text) is a write the model asked for. */
export function factSourceCategory(source: string): FactSourceCategory {
  if (source.startsWith('hook:')) return 'hook';
  if (source.startsWith('sweep:')) return 'sweep';
  if (['sync:import', 'file_upload', 'code_import'].includes(source) || /^(conversation|import)/.test(source)) return 'import';
  return 'model_write';
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null);

/** The dump script's JSON document as the store. */
export function gbrainStoreFrom(doc: Record<string, unknown>): GbrainStore {
  const pages = (doc.pages as Array<Record<string, unknown>> ?? []).map((p): StorePage => {
    const page = {
      slug: str(p.slug), source_id: str(p.source_id), type: str(p.type), title: str(p.title),
      frontmatter: (p.frontmatter && typeof p.frontmatter === 'object' ? p.frontmatter : {}) as Record<string, unknown>,
      compiled_truth: str(p.compiled_truth), timeline: str(p.timeline),
      timeline_entries: (p.timeline_entries as Array<Record<string, unknown>> ?? []).map((t) => ({ date: str(t.date), source: str(t.source), summary: str(t.summary), detail: str(t.detail) })),
      source_kind: strOrNull(p.source_kind),
    };
    return { ...page, raw_kind: rawKind(page) };
  });
  const facts = (doc.facts as Array<Record<string, unknown>> ?? []).map((f): StoreFact => {
    const entity = strOrNull(f.entity_slug);
    return {
      id: Number(f.id), source_id: str(f.source_id), entity_slug: entity, fact: str(f.fact), context: strOrNull(f.context), kind: str(f.kind), visibility: str(f.visibility),
      source: str(f.source), source_category: factSourceCategory(str(f.source)), source_session: strOrNull(f.source_session), attributed_to: strOrNull(f.attributed_to),
      unattributed: !entity || entity === UNATTRIBUTED_SLUG || entity.endsWith(`/${UNATTRIBUTED_SLUG}`),
      expired: f.expired_at != null || f.superseded_by != null,
    };
  });
  const absorb_log = (doc.absorb_log as Array<Record<string, unknown>> ?? []).map((r) => ({ id: Number(r.id), source_ref: str(r.source_ref), reason: str(r.summary).split(':')[0]!.trim(), summary: str(r.summary), created_at: str(r.created_at) }));
  const absorb_jobs = (doc.absorb_jobs as Array<Record<string, unknown>> ?? []).map((j) => ({ status: str(j.status), created_at: str(j.created_at) }));
  return { schema_version: 1, kind: 'gbrain', read_via: 'gbrain/owner-identity-dump.ts (read-only SQL through gbrain\'s engine)', gbrain_version: strOrNull(doc.gbrain_version), owner_member: strOrNull(doc.owner_member), pages, facts, absorb_log, absorb_jobs };
}

export const DUMP_SCRIPT = resolve(import.meta.dir, '../../gbrain/owner-identity-dump.ts');

/** The docker argv that dumps a stopped brain directory (the copy of the sidecar's /brain) from the gbrain image, offline. */
export function dumpDockerArgs(image: string, brainDir: string, uidGid: string, mountAt = '/brain'): string[] {
  return ['docker', 'run', '--rm', '--user', uidGid, '--network', 'none', '-v', `${resolve(brainDir)}:${mountAt}`, '-v', `${DUMP_SCRIPT}:/he-dump/owner-identity-dump.ts:ro`,
    '-e', `GBRAIN_HOME=${mountAt}`, '-e', 'HOME=/tmp', '-e', 'GBRAIN_SKIP_STARTUP_HOOKS=1', '-e', 'NO_COLOR=1', '--entrypoint', 'bun', image, '/he-dump/owner-identity-dump.ts'];
}

/** Dump a stopped brain: from the image (sidecar brains, whose recorded paths are /brain) or with a host gbrain checkout (row P's
 *  fresh gbrain home). The host run gets a scrubbed environment: PATH, HOME, GBRAIN_HOME and HE_GBRAIN_SRC only. */
/** mountAt: where the brain was mounted when gbrain wrote it (its config records absolute paths); the sidecar's /brain by default. */
export function dumpGbrainBrain(o: { brainDir: string; image?: string; gbrainSrc?: string; uidGid?: string; timeoutMs?: number; mountAt?: string }): GbrainStore {
  if (!o.image === !o.gbrainSrc) throw new Error('dumpGbrainBrain needs exactly one of image or gbrainSrc');
  const uidGid = o.uidGid ?? `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
  const [cmd, ...args] = o.image ? dumpDockerArgs(o.image, o.brainDir, uidGid, o.mountAt) : ['bun', DUMP_SCRIPT];
  const env = o.image ? { PATH: process.env.PATH ?? '/usr/bin:/bin' } : { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(resolve(o.brainDir), '.he-home'), GBRAIN_HOME: resolve(o.brainDir), HE_GBRAIN_SRC: resolve(o.gbrainSrc!), GBRAIN_SKIP_STARTUP_HOOKS: '1', NO_COLOR: '1' };
  if (!o.image) mkdirSync(env.HOME!, { recursive: true });
  const r = spawnSync(cmd!, args, { env, encoding: 'utf8', timeout: o.timeoutMs ?? 300_000, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`owner-identity dump of ${o.brainDir} failed (exit ${r.status}): ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`);
  return gbrainStoreFrom(JSON.parse(r.stdout) as Record<string, unknown>);
}

/** Arm N: one <person id>.md file per person in the notes directory; other files are skipped. */
export function dumpNotesStore(dir: string): NotesStore {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : [];
  return { schema_version: 1, kind: 'notes', notes: files.map((file) => ({ person_id: basename(file, '.md'), file, text: readFileSync(join(dir, file), 'utf8') })) };
}

export const storePath = (trialDir: string) => join(trialDir, 'owner-identity', 'store.json');

export function writeStore(path: string, store: OwnerIdentityStore): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 1) + '\n');
  return path;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const out = flag('--out');
  const notes = flag('--notes');
  const brain = flag('--brain');
  if (!out || !notes === !brain) { console.error('usage: owner-identity-store.ts (--brain <dir> (--image <tag> | --gbrain-src <dir>) | --notes <dir>) --out <store.json>'); process.exit(2); }
  const store = notes ? dumpNotesStore(notes) : dumpGbrainBrain({ brainDir: brain!, ...(flag('--image') ? { image: flag('--image')! } : {}), ...(flag('--gbrain-src') ? { gbrainSrc: flag('--gbrain-src')! } : {}) });
  writeStore(out, store);
  console.log(`wrote ${out}: ${store.kind === 'gbrain' ? `${store.pages.length} pages, ${store.facts.length} facts` : `${store.notes.length} notes files`}`);
}
