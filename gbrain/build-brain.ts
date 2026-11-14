#!/usr/bin/env bun
// Build one PGLite brain for the gbrain arm, for one split, imported into a fresh keyless gbrain home.
// Runs at image build time (gbrain/Dockerfile) and by hand:
//
//   bun gbrain/build-brain.ts --split heldout --corpus <gbrain-evals>/eval/data/messy-company-v1/corpus \
//       --world world/seed/world.json --out /brains/heldout --staging /tmp/staging-heldout \
//       --gbrain "bun /opt/gbrain/src/cli.ts" --commit <gbrain commit> [--brain bot-visible|company]
//
// Two brains (docs/gbrain-arm.md). --brain bot-visible (the default, the gbrain arm): the slice of the
// Pemberline corpus the bot can already read in the world: the source_slugs of every non-DM channel loaded
// for the split (record.split is the split or "both") plus the slug of every file with visibility
// "public" loaded for the split, all in gbrain's one default source. --brain company (the company-brain
// run): every record loaded for the split, every chat and DM page, every file whatever its
// visibility, every email and every meeting, grouped into one gbrain source per distinct set of members
// who may read the record, each source federated so an unscoped token reads them all, plus one bearer
// token per member granted exactly the sources whose readers include that member and one public-only
// token, written to <out>/tokens.json. The page list comes from world.json, never from a directory
// listing. Each page is copied into the staging directory at <split>/<corpus slug>.md (under a per-source
// directory for the company brain), so the gbrain page slug is <split>/<corpus slug> in both brains, the
// name docs/gbrain-arm.md and the grader use. A listed page missing from the corpus fails the build.
// gbrain runs with an environment that holds no API key: init prints its search-mode notice and picks
// keyword-only search because nothing else is available; import runs with --no-embed.
//
// The install ladder: --embeddings openai:text-embedding-3-small builds a bot-visible brain whose chunks carry
// embeddings. Still no key: OPENAI_BASE_URL in the environment must name the metering proxy's slot URL (gbrain treats a
// configured base URL as satisfying the OpenAI key requirement and sends "Bearer unauthenticated"; the proxy injects the
// key on the host and meters every call). init takes --embedding-model, import runs without --no-embed (at this commit
// import leaves a backlog), and `gbrain embed --stale --catch-up --json --yes` embeds the backlog; the manifest records the
// model, the dimensions and gbrain's embed summary, and scripts/build-gbrain-image.sh adds the proxy's usage summary.
//
// The member brain, run gbrain-memory-2026-10: --brain member holds the bot-visible slice only (the company brain's
// DMs, private files, mail and meetings stay out) but stages it the company way, one federated source per reader set, so a
// channel page is readable by that channel's members and a public file by everyone; every loaded non-DM channel gets a source
// even when it has no page, and every token member an empty private-<member> source, because the world's live ingestion
// (world/services/gbrain-ingest.ts) writes each message of the scenario into the source of the conversation it was posted in
// (a DM with the bot into private-<member>). gbrain lets one bearer token write to one source, so beside the member tokens the
// build mints one ingest token per source into ingest-tokens.json; the manifest (schema_version 3) maps each channel id to
// its source and names the ingest tokens without their secrets.
//
// internal-task (the access-rules rerun, installer-cc-codex-acl-2026-11): --access rules, with --brain member (or company), keeps
// the sources, pages and imports as they are and changes how reads are gated, the way gbrain's company-brain tutorial
// ("Model C", gbrain#8134) says per-member reads must be set up. After the imports: one folder rule per source that has a
// reader set (gbrain access rule add --prefix <split>/ --readers <that source's readers> --source <id> --yes), none on the
// public source; gbrain access member add <id> per token member; each member token rescoped with --member <id> and no
// --sources, so the rules are the only read gate; the public-only token created and left bound to nobody, so it reads only
// pages under no rule. The manifest records access "rules", every rule and every binding; the tokens stay in tokens.json.
//
// internal-task (gbrain v0.60.717.0, the shared-bot fixes): --labels readers, bot-visible only, writes each staged page's readers among
// the token members (labelledPageList: a channel page its channel's employees and agent, a public file every one of them) into
// its frontmatter as readable_by before import, so a member-bound key reads only the pages its member may read in the world.
// The manifest records labels "readers" and each page's readers; the brain builds at /brains/<split>-labelled by default.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Member, Split, World, WorldFile } from '../world/types.ts';

export interface BrainPage {
  /** gbrain page slug: <split>/<corpus slug>. */
  page_slug: string;
  /** Corpus slug without the split prefix, as world.json carries it. */
  slug: string;
  /** Path under the corpus checkout, <split>/<slug>.md. */
  source_path: string;
  sha256: string;
  bytes: number;
  kind: 'channel' | 'file';
  /** The world record the page came from: a channel id or a file id. */
  world_id: string;
  world_name: string;
  visibility: 'channel' | 'public';
  /** internal-task: present only in a brain built with --labels readers: the token members written into the page's readable_by. */
  readers?: string[];
}

/** How an embedded brain was built. The usage summary is added by scripts/build-gbrain-image.sh from the proxy's ledger. */
export interface BrainEmbeddings {
  model: string;
  dimensions: number;
  route: 'OPENAI_BASE_URL';
  init: string[];
  embed: string[];
  /** gbrain's `embed --stale` JSON summary (embedded, pages_processed, failures and the rest) plus backlog_after from a dry run, both zero. */
  embed_summary: Record<string, unknown>;
  usage?: { requests: number; input_tokens: number; usd: number; run_id: string };
}

export interface BrainManifest {
  schema_version: 1;
  gbrain_commit: string;
  gbrain_version: string | null;
  corpus: { repo: string; commit: string; path: string };
  split: 'dev' | 'heldout';
  world_id: string;
  built_at: string;
  /** 'off' (keyword-only, the gbrain arm) or the embedding record. */
  embeddings: 'off' | BrainEmbeddings;
  /** internal-task: present only when every page carries its world readers in its frontmatter (--labels readers). */
  labels?: 'readers';
  pages: BrainPage[];
  counts: { channel_pages: number; public_files: number; total: number };
  import: Record<string, unknown>;
}

export type ListedPage = Omit<BrainPage, 'sha256' | 'bytes' | 'source_path'>;

// ---- the company brain --------------------------------------------------------------------

export type CompanyPageKind = 'channel' | 'dm' | 'contract' | 'ticket' | 'crm' | 'profile' | 'update' | 'digest' | 'note' | 'email' | 'meeting';

export interface CompanyPage {
  page_slug: string;
  slug: string;
  source_path: string;
  sha256: string;
  bytes: number;
  kind: CompanyPageKind;
  world_id: string;
  world_name: string;
  visibility: string;
  /** Member ids who may read this record in the world; the source is named from this set. */
  readers: string[];
  /** The gbrain source the page is imported into. */
  source: string;
}

export type ListedCompanyPage = Omit<CompanyPage, 'sha256' | 'bytes' | 'source_path'>;

export interface CompanySource { id: string; readers: string[]; pages: number }
export interface CompanyGrant { member: string; token_name: string; write: string; sources: string[] }

/** The brains built as federated sources with per-member grants: company and member. */
export type ScopedBrainKind = 'company' | 'member';

/** How the world's live ingestion finds the source of a conversation: the channel id to source map for every loaded
 *  non-DM channel (a DM with the bot goes to private-<the other member>), and the ingest token names (the secrets are in
 *  ingest-tokens.json). */
export interface BrainIngest {
  channels: Record<string, string>;
  dm_source_prefix: 'private-';
  token_names: string[];
}

/** manifest.json of a company brain (schema_version 2) or a member brain (schema_version 3, with ingest). The bot-visible
 *  manifest keeps schema_version 1 unchanged. */
export interface CompanyBrainManifest {
  schema_version: 2 | 3;
  brain: ScopedBrainKind;
  gbrain_commit: string;
  gbrain_version: string | null;
  corpus: { repo: string; commit: string; path: string };
  split: 'dev' | 'heldout';
  world_id: string;
  built_at: string;
  embeddings: 'off';
  pages: CompanyPage[];
  counts: Record<CompanyPageKind, number> & { total: number };
  sources: CompanySource[];
  /** One grant per member token plus public-only; the tokens themselves are in tokens.json, never here. */
  grants: CompanyGrant[];
  imports: Record<string, Record<string, unknown>>;
  /** Member brains only. */
  ingest?: BrainIngest;
  /** internal-task: present only on a brain built with --access rules. grants then still list each member's readable sources (the
   *  world's reader sets), but no token carries --sources: the rules below and the member bindings gate every remote read. */
  access?: 'rules';
  rules?: AccessRule[];
  bindings?: AccessBinding[];
}

/** internal-task: one gbrain folder rule as the build added it: the source, the prefix, the rule id gbrain answered with and the
 *  readers (member ids as the world names them; a guest reader matches no gbrain member and so reads nothing remotely). */
export interface AccessRule { source: string; prefix: string; rule_id: string; readers: string[]; pages_restamped: number }
/** internal-task: a token and the member it is bound to (null for the public-only token, bound to nobody). */
export interface AccessBinding { token_name: string; member: string | null }

/** tokens.json beside a company or member brain: the plaintext bearer tokens, mode 0600, copied per trial into the
 *  evaluator-owned <trial dir>/gbrain/ and never committed (the results .gitignore excludes that directory). */
export interface CompanyTokens {
  schema_version: 1;
  /** bot-visible only in the copy a serves-several sidecar writes from gbrain's member keys (internal-task). */
  brain: ScopedBrainKind | 'bot-visible';
  split: 'dev' | 'heldout';
  /** member id -> bearer token; each granted the sources whose readers include the member, writing to private-<member>. */
  members: Record<string, string>;
  /** Granted the public source only: what the tap presents before the first turn under member scope. */
  public_only: string;
}

/** ingest-tokens.json beside a member brain: one bearer token per source, each granted exactly that source, so the
 *  world's live ingestion can write a message into the source of its conversation. Mode 0600, per trial copy, never committed. */
export interface IngestTokens {
  schema_version: 1;
  brain: 'member';
  split: 'dev' | 'heldout';
  /** source id -> bearer token whose write source is that source. */
  sources: Record<string, string>;
}

/** gbrain's source id rule at the pinned commit: lower-case, digits and hyphens, 1 to 32 characters. */
export const SOURCE_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

const sortedUnique = (ids: Iterable<string>): string[] => [...new Set(ids)].sort();

/** The members loaded for a split: employees, Moss and the guests who appear in it. */
export function loadedMembers(world: World, split: 'dev' | 'heldout'): Member[] {
  return world.members.filter((m) => loaded(m, split));
}

/** The world's file rule, as runner/grade/predicates.ts canReadFile states it (kept in step by tests/gbrain-brain.test.ts;
 *  this file cannot import the grader because the sidecar image copies only gbrain/ and world/types.ts). */
export function memberReadsFile(member: Member, file: WorldFile): boolean {
  if (file.owner === member.id) return true;
  if (file.visibility === 'private') return false;
  if (file.visibility === 'public') return true;
  if (member.org_wide) return true;
  return file.team !== null && member.team === file.team;
}

function fileReaders(world: World, split: 'dev' | 'heldout', file: WorldFile): string[] {
  return sortedUnique(loadedMembers(world, split).filter((m) => memberReadsFile(m, file)).map((m) => m.id));
}

/** The source id for a reader set: public (everyone loaded), private-<member> (one member), team-<short> (a team plus the
 *  org-wide roles, the file rule), team-<short>-members (the team alone, which is what its channels' membership is),
 *  channel-<name> (exactly a channel's members), else readers-<8 hex of sha256 over the sorted ids>. */
export function sourceIdFor(world: World, split: 'dev' | 'heldout', readers: string[]): string {
  const key = sortedUnique(readers);
  const everyone = sortedUnique(loadedMembers(world, split).map((m) => m.id));
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (same(key, everyone)) return 'public';
  if (key.length === 1) return `private-${key[0]}`;
  const orgWide = world.members.filter((m) => m.org_wide).map((m) => m.id);
  for (const t of world.teams) {
    if (!loaded(t, split)) continue;
    const lead = world.members.find((m) => m.id === t.lead);
    const teamSet = sortedUnique([...t.members, ...(lead ? [lead.id] : []), ...orgWide].filter((id) => loadedMembers(world, split).some((m) => m.id === id)));
    if (same(key, teamSet)) return `team-${t.short.toLowerCase()}`;
  }
  for (const t of world.teams) {
    if (!loaded(t, split)) continue;
    if (same(key, sortedUnique([...t.members, t.lead]))) return `team-${t.short.toLowerCase()}-members`;
  }
  for (const c of world.channels) {
    if (c.kind === 'dm' || !loaded(c, split)) continue;
    if (same(key, sortedUnique(c.members))) return `channel-${c.name}`;
  }
  return `readers-${createHash('sha256').update(key.join(',')).digest('hex').slice(0, 8)}`;
}

/** Every record loaded for a split as a brain page with its readers and source, in world.json order: channels and DMs,
 *  files, mail, meetings. Readers: channel membership for a chat or DM page, canReadFile for a file, mailbox_members for
 *  an email, organizer plus attendees for a meeting. */
export function companyPageList(world: World, split: 'dev' | 'heldout'): ListedCompanyPage[] {
  const pages: ListedCompanyPage[] = [];
  const add = (p: Omit<ListedCompanyPage, 'page_slug' | 'source' | 'readers'> & { readers: string[] }) => {
    const readers = sortedUnique(p.readers);
    const source = sourceIdFor(world, split, readers);
    if (!SOURCE_ID_RE.test(source)) throw new Error(`source id ${source} for readers [${readers.join(', ')}] does not match gbrain's source id rule`);
    pages.push({ ...p, readers, source, page_slug: `${split}/${p.slug}` });
  };
  for (const c of world.channels) {
    if (!loaded(c, split)) continue;
    for (const slug of c.source_slugs) add({ slug, kind: c.kind === 'dm' ? 'dm' : 'channel', world_id: c.id, world_name: c.name, visibility: c.kind === 'dm' ? 'dm' : 'channel', readers: c.members });
  }
  for (const f of world.files) {
    if (!loaded(f, split)) continue;
    add({ slug: f.slug, kind: f.kind, world_id: f.id, world_name: f.title, visibility: f.visibility, readers: fileReaders(world, split, f) });
  }
  for (const m of world.mail) {
    if (!loaded(m, split) || !m.slug) continue;
    add({ slug: m.slug, kind: 'email', world_id: m.id, world_name: m.subject, visibility: 'mailbox', readers: m.mailbox_members });
  }
  for (const e of world.calendar) {
    if (!loaded(e, split) || !e.slug) continue;
    add({ slug: e.slug, kind: 'meeting', world_id: e.id, world_name: e.title, visibility: 'attendees', readers: [e.organizer, ...e.attendees] });
  }
  return pages;
}

/** The sources of a company brain: one per distinct reader set, plus an empty private-<member> source for every
 *  employee and agent without one, so each member token has a write source only that member reads. */
export function companySources(world: World, split: 'dev' | 'heldout', pages: ListedCompanyPage[]): CompanySource[] {
  const bySource = new Map<string, CompanySource>();
  for (const p of pages) {
    const s = bySource.get(p.source) ?? { id: p.source, readers: p.readers, pages: 0 };
    s.pages += 1;
    bySource.set(p.source, s);
  }
  for (const m of tokenMembers(world, split)) {
    const id = `private-${m.id}`;
    if (!bySource.has(id)) bySource.set(id, { id, readers: [m.id], pages: 0 });
  }
  if (!bySource.has('public')) bySource.set('public', { id: 'public', readers: sortedUnique(loadedMembers(world, split).map((m) => m.id)), pages: 0 });
  return [...bySource.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The member brain's pages: the bot-visible slice (pageList) with the company brain's readers and sources: a channel
 *  page is readable by the channel's members, a public file by every loaded member. */
export function memberPageList(world: World, split: 'dev' | 'heldout'): ListedCompanyPage[] {
  const everyone = sortedUnique(loadedMembers(world, split).map((m) => m.id));
  return pageList(world, split).map((p) => {
    const readers = p.kind === 'channel' ? sortedUnique(world.channels.find((c) => c.id === p.world_id)!.members) : everyone;
    const source = sourceIdFor(world, split, readers);
    if (!SOURCE_ID_RE.test(source)) throw new Error(`source id ${source} for readers [${readers.join(', ')}] does not match gbrain's source id rule`);
    const kind: CompanyPageKind = p.kind === 'channel' ? 'channel' : world.files.find((f) => f.id === p.world_id)!.kind;
    return { page_slug: p.page_slug, slug: p.slug, kind, world_id: p.world_id, world_name: p.world_name, visibility: p.visibility, readers, source };
  });
}

/** The member brain's sources: companySources over its pages, plus an empty source for every loaded non-DM channel
 *  whose reader set has none yet (#general has no page and still takes live posts). */
export function memberSources(world: World, split: 'dev' | 'heldout', pages: ListedCompanyPage[]): CompanySource[] {
  const sources = companySources(world, split, pages);
  for (const c of world.channels) {
    if (c.kind === 'dm' || !loaded(c, split)) continue;
    const readers = sortedUnique(c.members);
    const id = sourceIdFor(world, split, readers);
    if (!sources.some((s) => s.id === id)) sources.push({ id, readers, pages: 0 });
  }
  return sources.sort((a, b) => a.id.localeCompare(b.id));
}

/** Channel id -> source id for every loaded non-DM channel, what the live ingestion reads from the manifest. */
export function conversationSources(world: World, split: 'dev' | 'heldout'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of world.channels) if (c.kind !== 'dm' && loaded(c, split)) out[c.id] = sourceIdFor(world, split, sortedUnique(c.members));
  return out;
}

/** Who gets a member token: the employees and the agent (Moss) loaded for the split; guests ask nothing of the bot. */
export function tokenMembers(world: World, split: 'dev' | 'heldout'): Member[] {
  return loadedMembers(world, split).filter((m) => m.kind === 'employee' || m.kind === 'agent');
}

/** The name of a member's token in a company or member brain. gbrain's own `access serves several` names the key it mints for a
 *  member member-<id> and refuses to run while a token of that name exists, so ours carry a prefix gbrain never uses. */
export const memberTokenName = (member: string): string => `he-member-${member}`;

/** The grants: for each token member every source whose readers include them, private-<member> first as the write source. */
export function companyGrants(world: World, split: 'dev' | 'heldout', sources: CompanySource[]): CompanyGrant[] {
  const grants: CompanyGrant[] = tokenMembers(world, split).map((m) => {
    const write = `private-${m.id}`;
    const reads = sources.filter((s) => s.id !== write && s.readers.includes(m.id)).map((s) => s.id).sort();
    return { member: m.id, token_name: memberTokenName(m.id), write, sources: [write, ...reads] };
  });
  grants.push({ member: 'public-only', token_name: 'public-only', write: 'public', sources: ['public'] });
  return grants;
}

const loaded = (record: { split: Split }, split: 'dev' | 'heldout') => record.split === split || record.split === 'both';

/** The bot-visible slice for a split, in world.json order: channel pages first, then public files. */
export function pageList(world: World, split: 'dev' | 'heldout'): ListedPage[] {
  const pages: ListedPage[] = [];
  for (const c of world.channels) {
    if (c.kind === 'dm' || !loaded(c, split)) continue;
    for (const slug of c.source_slugs) pages.push({ page_slug: `${split}/${slug}`, slug, kind: 'channel', world_id: c.id, world_name: c.name, visibility: 'channel' });
  }
  for (const f of world.files) {
    if (f.visibility !== 'public' || !loaded(f, split)) continue;
    pages.push({ page_slug: `${split}/${f.slug}`, slug: f.slug, kind: 'file', world_id: f.id, world_name: f.title, visibility: 'public' });
  }
  return pages;
}

/** internal-task: the bot-visible slice with each page's readers among the token members (employees and the agent; guests are
 *  dropped): a channel page its channel's token members, a public file every token member. */
export function labelledPageList(world: World, split: 'dev' | 'heldout'): Array<ListedPage & { readers: string[] }> {
  const members = tokenMembers(world, split).map((m) => m.id);
  return pageList(world, split).map((p) => ({ ...p, readers: p.kind === 'channel' ? sortedUnique(world.channels.find((c) => c.id === p.world_id)!.members.filter((id) => members.includes(id))) : sortedUnique(members) }));
}

/** Find a page in the corpus: under its own split first, then the other split for a "both" record. */
function locate(corpus: string, split: 'dev' | 'heldout', slug: string): string | null {
  for (const s of [split, split === 'dev' ? 'heldout' : 'dev']) {
    const p = join(corpus, s, `${slug}.md`);
    if (existsSync(p)) return p;
  }
  return null;
}

/** An environment for gbrain with no provider key in it. */
export function keylessEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    GBRAIN_HOME: home,
    GBRAIN_SKIP_STARTUP_HOOKS: '1',
    NO_COLOR: '1',
    CI: '1',
  };
  for (const k of ['LANG', 'LC_ALL', 'TMPDIR', 'BUN_INSTALL']) if (process.env[k]) env[k] = process.env[k]!;
  // The embedding route and its timeouts pass through; they name a proxy, never a key.
  for (const k of ['OPENAI_BASE_URL', 'GBRAIN_QUERY_EMBED_TIMEOUT_MS', 'GBRAIN_AI_EMBED_TIMEOUT_MS']) if (process.env[k]) env[k] = process.env[k]!;
  return env;
}

/** An empty <dir>: its entries are removed, the directory itself kept (it may be a bind mount, which cannot be removed). */
function emptyDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const e of readdirSync(dir)) rmSync(join(dir, e), { recursive: true, force: true });
}

function run(cmd: string[], env: Record<string, string>, label: string): { stdout: string; stderr: string } {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`${label} exited ${r.status}\n${r.stderr.split('\n').slice(-20).join('\n')}`);
  }
  return { stdout: r.stdout, stderr: r.stderr };
}

export interface BuildOptions {
  split: 'dev' | 'heldout';
  corpus: string;
  worldPath: string;
  out: string;
  staging: string;
  /** The gbrain command, split on spaces (for example "bun /opt/gbrain/src/cli.ts"). */
  gbrain: string[];
  commit: string;
  corpusCommit: string;
  corpusRepo: string;
  /** bot-visible (default), company (docs/gbrain-arm.md, "Company brain") or member ("The member brain"). */
  brain?: 'bot-visible' | ScopedBrainKind;
  /** An embedding model (openai:text-embedding-3-small); bot-visible only; needs OPENAI_BASE_URL in the environment. */
  embeddings?: string;
  /** internal-task: "rules" gates reads with folder rules and member-bound tokens instead of per-token source grants; member or company only. */
  access?: 'rules';
  /** internal-task: "readers" writes each page's readers (labelledPageList) into its frontmatter as readable_by; bot-visible only. */
  labels?: 'readers';
  log?: (line: string) => void;
}

/** The embedding models a brain may be built with: priced in runner/pricing/embedding-pricing.ts and served by the proxy's /v1/embeddings route. */
export const EMBEDDING_MODELS = ['openai:text-embedding-3-small'] as const;

export function buildBrain(o: BuildOptions): BrainManifest | CompanyBrainManifest {
  if (o.access !== undefined && o.access !== 'rules') throw new Error(`--access must be "rules" (got ${String(o.access)})`);
  if (o.access && o.brain !== 'member' && o.brain !== 'company') throw new Error(`--access rules needs --brain member or company; the ${o.brain ?? 'bot-visible'} brain has no reader sets to gate`);
  if (o.labels !== undefined && (o.labels !== 'readers' || (o.brain ?? 'bot-visible') !== 'bot-visible' || o.embeddings)) throw new Error(`--labels must be "readers" on the keyword bot-visible brain (got --labels ${String(o.labels)} --brain ${o.brain ?? 'bot-visible'}${o.embeddings ? ` --embeddings ${o.embeddings}` : ''})`);
  if ((o.brain === 'company' || o.brain === 'member') && o.embeddings) throw new Error(`--embeddings is for bot-visible brains only; the ${o.brain} brains are keyword-only`);
  if (o.brain === 'company' || o.brain === 'member') return buildScopedBrain(o, o.brain);
  if (o.embeddings && !(EMBEDDING_MODELS as readonly string[]).includes(o.embeddings)) throw new Error(`--embeddings must be one of ${EMBEDDING_MODELS.join(', ')} (got ${o.embeddings})`);
  const log = o.log ?? ((l) => console.error(l));
  const world = JSON.parse(readFileSync(o.worldPath, 'utf8')) as World;
  const listed: Array<ListedPage & { readers?: string[] }> = o.labels ? labelledPageList(world, o.split) : pageList(world, o.split);
  if (!listed.length) throw new Error(`no bot-visible pages for split ${o.split} in ${o.worldPath}`);

  rmSync(o.staging, { recursive: true, force: true });
  mkdirSync(o.staging, { recursive: true });
  const missing: string[] = [];
  const pages: BrainPage[] = [];
  for (const p of listed) {
    const src = locate(o.corpus, o.split, p.slug);
    if (!src) { missing.push(p.slug); continue; }
    const body = readFileSync(src);
    const dest = join(o.staging, o.split, `${p.slug}.md`);
    mkdirSync(dirname(dest), { recursive: true });
    if (p.readers) {
      const text = body.toString('utf8');
      const end = text.indexOf('\n---', 3);
      if (!text.startsWith('---\n') || end < 0 || /^readable_by:/m.test(text.slice(0, end))) throw new Error(`${p.slug}: --labels readers needs frontmatter without readable_by`);
      writeFileSync(dest, `---\nreadable_by: [${p.readers.join(', ')}]\n${text.slice(4)}`);
    } else copyFileSync(src, dest);
    pages.push({ ...p, source_path: `${o.split}/${p.slug}.md`, sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length });
  }
  if (missing.length) throw new Error(`${missing.length} listed page(s) missing from ${o.corpus}: ${missing.join(', ')}`);
  log(`${o.split}: staged ${pages.length} pages (${pages.filter((p) => p.kind === 'channel').length} channel pages, ${pages.filter((p) => p.kind === 'file').length} public files) under ${o.staging}`);

  emptyDir(o.out);
  const env = keylessEnv(resolve(o.out));
  if (o.embeddings && !env.OPENAI_BASE_URL) throw new Error('--embeddings needs OPENAI_BASE_URL in the environment (the metering proxy slot URL); no key is ever read here');
  const initArgs = o.embeddings ? ['init', '--pglite', '--non-interactive', '--embedding-model', o.embeddings] : ['init', '--pglite', '--non-interactive', '--no-embedding'];
  const init = run([...o.gbrain, ...initArgs], env, 'gbrain init');
  log(`gbrain init: ${(init.stdout + init.stderr).split('\n').filter((l) => /search|embedding|engine/i.test(l)).slice(0, 3).join(' | ')}`);
  const importArgs = ['import', resolve(o.staging), ...(o.embeddings ? [] : ['--no-embed']), '--allow-noncanonical-root', '--json'];
  const imp = run([...o.gbrain, ...importArgs], env, 'gbrain import');
  const summaryLine = imp.stdout.split('\n').reverse().find((l) => l.trim().startsWith('{'));
  if (!summaryLine) throw new Error(`gbrain import printed no JSON summary\n${imp.stderr.slice(-800)}`);
  const summary = JSON.parse(summaryLine) as Record<string, unknown>;
  if (summary.status !== 'success' || Number(summary.imported) !== pages.length || Number(summary.errors) !== 0) {
    throw new Error(`gbrain import did not import exactly ${pages.length} pages: ${summaryLine}`);
  }
  log(`gbrain import: ${summary.imported} pages in ${summary.duration_s} s`);
  let embeddings: BrainManifest['embeddings'] = 'off';
  if (o.embeddings) {
    // At this commit import leaves every chunk in the embedding backlog; --yes is the operator's consent to the paid
    // call, which the proxy's lease bounds. Every page must come out embedded with no failure.
    const embedArgs = ['embed', '--stale', '--catch-up', '--json', '--yes'];
    const emb = run([...o.gbrain, ...embedArgs], env, 'gbrain embed --stale');
    // The summary is pretty-printed JSON: parse from the last line that is exactly "{" to the end.
    const lines = emb.stdout.split('\n');
    const start = lines.map((l) => l.trim()).lastIndexOf('{');
    const embLine = start >= 0 ? lines.slice(start).join('\n').trim() : '';
    if (!embLine) throw new Error(`gbrain embed --stale printed no JSON summary\n${(emb.stdout + emb.stderr).slice(-800)}`);
    const embedSummary = JSON.parse(embLine) as Record<string, unknown>;
    if (Number(embedSummary.failures) !== 0) throw new Error(`gbrain embed --stale reported failures: ${embLine.slice(0, 600)}`);
    // Import may already have embedded some chunks at this commit, so the proof is an empty backlog afterwards, not a count.
    const check = run([...o.gbrain, 'embed', '--stale', '--dry-run', '--json'], env, 'gbrain embed --stale --dry-run');
    const checkLines = check.stdout.split('\n');
    const checkStart = checkLines.map((l) => l.trim()).lastIndexOf('{');
    const backlog = JSON.parse(checkLines.slice(checkStart).join('\n').trim()) as Record<string, unknown>;
    if (Number(backlog.would_embed) !== 0 || Number(backlog.total_chunks) !== 0) throw new Error(`chunks without an embedding remain after gbrain embed --stale: ${JSON.stringify({ would_embed: backlog.would_embed, total_chunks: backlog.total_chunks })}`);
    embedSummary.backlog_after = { would_embed: backlog.would_embed, total_chunks: backlog.total_chunks };
    const config = JSON.parse(readFileSync(join(o.out, '.gbrain', 'config.json'), 'utf8')) as { embedding_model?: string; embedding_dimensions?: number };
    if (config.embedding_model !== o.embeddings || !config.embedding_dimensions) throw new Error(`config.json records embedding_model ${config.embedding_model} (${config.embedding_dimensions} dims), expected ${o.embeddings}`);
    embeddings = { model: o.embeddings, dimensions: config.embedding_dimensions, route: 'OPENAI_BASE_URL', init: ['gbrain', ...initArgs], embed: ['gbrain', ...embedArgs], embed_summary: embedSummary };
    log(`gbrain embed: ${embedSummary.embedded} chunks over ${embedSummary.pages_processed} pages, ${config.embedding_dimensions} dims, through OPENAI_BASE_URL`);
  }

  const version = run([...o.gbrain, '--version'], env, 'gbrain --version').stdout.trim().match(/\d+\.\d+\.\d+(\.\d+)?/)?.[0] ?? null;
  const manifest: BrainManifest = {
    schema_version: 1,
    gbrain_commit: o.commit,
    gbrain_version: version,
    corpus: { repo: o.corpusRepo, commit: o.corpusCommit, path: 'eval/data/messy-company-v1/corpus' },
    split: o.split,
    world_id: world.world_id,
    built_at: new Date().toISOString(),
    embeddings,
    ...(o.labels ? { labels: o.labels } : {}),
    pages,
    counts: { channel_pages: pages.filter((p) => p.kind === 'channel').length, public_files: pages.filter((p) => p.kind === 'file').length, total: pages.length },
    import: summary,
  };
  writeFileSync(join(o.out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  return manifest;
}


/** Build a company brain: every record of the split, one federated source per reader set. */
export function buildCompanyBrain(o: BuildOptions): CompanyBrainManifest { return buildScopedBrain(o, 'company'); }

/** Build a company or member brain: stage every page under <out>/sources/<source>/<split>/<slug>.md, init a keyless brain,
 *  register one federated source per reader set and import each, mint one token per member (and public-only) granted its
 *  sources, and for a member brain one ingest token per source, write manifest.json (schema_version 2, or 3 with the ingest
 *  map), tokens.json and ingest-tokens.json (mode 0600) into <out>. */
export function buildScopedBrain(o: BuildOptions, kind: ScopedBrainKind): CompanyBrainManifest {
  const log = o.log ?? ((l) => console.error(l));
  const world = JSON.parse(readFileSync(o.worldPath, 'utf8')) as World;
  const listed = kind === 'company' ? companyPageList(world, o.split) : memberPageList(world, o.split);
  if (!listed.length) throw new Error(`no records for split ${o.split} in ${o.worldPath}`);
  const sources = kind === 'company' ? companySources(world, o.split, listed) : memberSources(world, o.split, listed);
  const grants = companyGrants(world, o.split, sources);
  const ingestGrants = kind === 'member' ? sources.map((s) => ({ source: s.id, token_name: `ingest-${s.id}` })) : [];
  for (const g of ingestGrants) if (g.token_name.length > 64) throw new Error(`ingest token name ${g.token_name} is too long`);

  // Each source's checkout lives inside the brain, so it travels with the brain into the image and back to /brain at
  // serve time; the entrypoint re-stamps it there (gbrain/rebind-sources.ts) because a copied directory has a new inode.
  emptyDir(o.out);
  const staging = join(resolve(o.out), 'sources');
  const missing: string[] = [];
  const pages: CompanyPage[] = [];
  for (const p of listed) {
    const src = locate(o.corpus, o.split, p.slug);
    if (!src) { missing.push(p.slug); continue; }
    const body = readFileSync(src);
    const dest = join(staging, p.source, o.split, `${p.slug}.md`);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    pages.push({ ...p, source_path: `${o.split}/${p.slug}.md`, sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length });
  }
  if (missing.length) throw new Error(`${missing.length} listed page(s) missing from ${o.corpus}: ${missing.join(', ')}`);
  for (const s of sources) mkdirSync(join(staging, s.id), { recursive: true });
  const counts = Object.fromEntries((['channel', 'dm', 'contract', 'ticket', 'crm', 'profile', 'update', 'digest', 'note', 'email', 'meeting'] as CompanyPageKind[]).map((k) => [k, pages.filter((p) => p.kind === k).length])) as Record<CompanyPageKind, number>;
  log(`${o.split} ${kind}: staged ${pages.length} pages in ${sources.length} sources (${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')}) under ${staging}`);

  const env = keylessEnv(resolve(o.out));
  const init = run([...o.gbrain, 'init', '--pglite', '--non-interactive', '--no-embedding'], env, 'gbrain init');
  log(`gbrain init: ${(init.stdout + init.stderr).split('\n').filter((l) => /search|embedding|engine/i.test(l)).slice(0, 3).join(' | ')}`);

  // One federated source per reader set, each imported from its own staging directory, each import checked against
  // that source's page count. An empty private-<member> source is registered and imported too (zero pages), so a member
  // token always has a write source nobody else reads.
  const imports: Record<string, Record<string, unknown>> = {};
  for (const s of sources) {
    const dir = join(staging, s.id);
    run([...o.gbrain, 'sources', 'add', s.id, '--path', dir, '--force', '--federated'], env, `gbrain sources add ${s.id}`);
    if (s.pages === 0) { imports[s.id] = { status: 'success', imported: 0, skipped: 0, errors: 0, empty_source: true }; continue; }
    const imp = run([...o.gbrain, 'import', dir, '--source', s.id, '--no-embed', '--allow-noncanonical-root', '--json'], env, `gbrain import ${s.id}`);
    const summaryLine = imp.stdout.split('\n').reverse().find((l) => l.trim().startsWith('{'));
    if (!summaryLine) throw new Error(`gbrain import ${s.id} printed no JSON summary\n${imp.stderr.slice(-800)}`);
    const summary = JSON.parse(summaryLine) as Record<string, unknown>;
    if (summary.status !== 'success' || Number(summary.imported) !== s.pages || Number(summary.errors) !== 0 || summary.source_id !== s.id) {
      throw new Error(`gbrain import into ${s.id} did not import exactly ${s.pages} pages: ${summaryLine}`);
    }
    imports[s.id] = summary;
    log(`gbrain import ${s.id}: ${summary.imported} pages (readers ${s.readers.length})`);
  }

  // internal-task: under --access rules each source with a reader set gets one folder rule over its pages (the public source none),
  // each token member becomes a gbrain member, and only then are tokens minted and bound. gbrain applies a new rule at once (a
  // narrowing) and restamps the source's pages; the build refuses a rule that did not apply to every page of its source.
  const rules: AccessRule[] = [];
  if (o.access === 'rules') {
    const prefix = `${o.split}/`;
    for (const s of sources) {
      if (s.id === 'public') continue;
      const added = run([...o.gbrain, 'access', 'rule', 'add', '--prefix', prefix, '--readers', s.readers.join(','), '--source', s.id, '--yes', '--json'], env, `gbrain access rule add ${s.id}`);
      const r = lastJsonObject(added.stdout) as { applied?: unknown; state?: unknown; changes?: Array<{ rule?: unknown }>; pages_restamped?: unknown } | null;
      if (!r || r.applied !== true || r.state !== 'applied' || Number(r.pages_restamped) !== s.pages) throw new Error(`gbrain access rule add on ${s.id} did not apply to its ${s.pages} pages: ${JSON.stringify(r ?? added.stdout.slice(-300))}`);
      rules.push({ source: s.id, prefix, rule_id: typeof r.changes?.[0]?.rule === 'string' ? r.changes[0].rule : '', readers: s.readers, pages_restamped: s.pages });
    }
    for (const g of grants) if (g.member !== 'public-only') run([...o.gbrain, 'access', 'member', 'add', g.member, '--json'], env, `gbrain access member add ${g.member}`);
    log(`gbrain access: ${rules.length} folder rules at ${prefix} over ${rules.reduce((n, r) => n + r.pages_restamped, 0)} pages, ${grants.length - 1} members`);
  }

  // Tokens: gbrain prints each secret once; it goes to tokens.json and nowhere else (never a log line).
  const members: Record<string, string> = {};
  let publicOnly = '';
  const bindings: AccessBinding[] = [];
  let unscoped: string[] = [];
  const mint = (name: string, bind: string[]): string => {
    let created: { stdout: string; stderr: string };
    try {
      created = run([...o.gbrain, 'auth', 'create', name, ...(bind.length ? bind : unscoped)], env, `gbrain auth create ${name}`);
    } catch (e) {
      if (bind.length || unscoped.length || !/credential_scope_required/.test(String(e))) throw e;
      unscoped = ['--reads-unscoped', '--yes'];
      return mint(name, bind);
    }
    const token = /gbrain_[0-9a-f]+/.exec(created.stdout + created.stderr)?.[0];
    if (!token) throw new Error(`gbrain auth create ${name} printed no token`);
    return token;
  };
  for (const g of grants) {
    const token = mint(g.token_name, o.access === 'rules' && g.member !== 'public-only' ? ['--member', g.member] : []);
    if (o.access !== 'rules') run([...o.gbrain, 'auth', 'rescope', '--token', g.token_name, '--sources', g.sources.join(',')], env, `gbrain auth rescope ${g.token_name}`);
    else if (g.member !== 'public-only') run([...o.gbrain, 'auth', 'rescope', '--token', g.token_name, '--member', g.member], env, `gbrain auth rescope ${g.token_name}`);
    if (o.access === 'rules') bindings.push({ token_name: g.token_name, member: g.member === 'public-only' ? null : g.member });
    if (g.member === 'public-only') publicOnly = token; else members[g.member] = token;
  }
  log(`gbrain auth: ${Object.keys(members).length} member tokens and public-only minted and ${o.access === 'rules' ? `bound (public-only bound to nobody${unscoped.length ? ', marked --reads-unscoped' : ''})` : 'granted'}`);
  const tokens: CompanyTokens = { schema_version: 1, brain: kind, split: o.split, members, public_only: publicOnly };
  const tokensPath = join(o.out, 'tokens.json');
  writeFileSync(tokensPath, JSON.stringify(tokens, null, 1) + '\n', { mode: 0o600 });
  chmodSync(tokensPath, 0o600);
  // One ingest token per source, its write source that source (gbrain writes to one source per connection).
  if (kind === 'member') {
    const ingestSources: Record<string, string> = {};
    for (const g of ingestGrants) {
      const token = mint(g.token_name, []);
      run([...o.gbrain, 'auth', 'rescope', '--token', g.token_name, '--sources', g.source], env, `gbrain auth rescope ${g.token_name}`);
      ingestSources[g.source] = token;
    }
    const ingest: IngestTokens = { schema_version: 1, brain: 'member', split: o.split, sources: ingestSources };
    const ingestPath = join(o.out, 'ingest-tokens.json');
    writeFileSync(ingestPath, JSON.stringify(ingest, null, 1) + '\n', { mode: 0o600 });
    chmodSync(ingestPath, 0o600);
    log(`gbrain auth: ${ingestGrants.length} ingest tokens minted, one per source`);
  }

  const version = run([...o.gbrain, '--version'], env, 'gbrain --version').stdout.trim().match(/\d+\.\d+\.\d+(\.\d+)?/)?.[0] ?? null;
  const manifest: CompanyBrainManifest = {
    schema_version: kind === 'company' ? 2 : 3,
    brain: kind,
    gbrain_commit: o.commit,
    gbrain_version: version,
    corpus: { repo: o.corpusRepo, commit: o.corpusCommit, path: 'eval/data/messy-company-v1/corpus' },
    split: o.split,
    world_id: world.world_id,
    built_at: new Date().toISOString(),
    embeddings: 'off',
    pages,
    counts: { ...counts, total: pages.length },
    sources,
    grants,
    imports,
    ...(kind === 'member' ? { ingest: { channels: conversationSources(world, o.split), dm_source_prefix: 'private-' as const, token_names: ingestGrants.map((g) => g.token_name) } } : {}),
    ...(o.access === 'rules' ? { access: 'rules' as const, rules, bindings } : {}),
  };
  writeFileSync(join(o.out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  return manifest;
}

/** The last JSON object a gbrain command printed with --json (pretty-printed: from the last line that opens one to the end). */
function lastJsonObject(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split('\n');
  const start = lines.map((l) => l.trimEnd()).lastIndexOf('{');
  if (start < 0) return null;
  try { return JSON.parse(lines.slice(start).join('\n')) as Record<string, unknown>; } catch { return null; }
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

if (import.meta.main) {
  const split = arg('split');
  const brain = arg('brain', 'bot-visible');
  const access = arg('access');
  const labels = arg('labels');
  if ((split !== 'dev' && split !== 'heldout') || (brain !== 'bot-visible' && brain !== 'company' && brain !== 'member') || (access !== undefined && access !== 'rules') || (labels !== undefined && labels !== 'readers')) { console.error('usage: bun gbrain/build-brain.ts --split dev|heldout [--brain bot-visible|company|member] [--access rules] [--labels readers] [--embeddings openai:text-embedding-3-small] --corpus <dir> --world <world.json> --out <brain home> [--staging <dir>] [--gbrain "<cmd>"] [--commit <sha>] [--corpus-commit <sha>]'); process.exit(2); }
  const home = brain === 'bot-visible' ? `${split}${labels ? '-labelled' : ''}` : `${split}-${brain}${access ? '-acl' : ''}`;
  const pin = JSON.parse(readFileSync(join(import.meta.dir, 'pin.json'), 'utf8')) as { gbrain: { commit: string }; corpus: { repo: string; commit: string } };
  try {
    const m = buildBrain({
      split,
      corpus: resolve(arg('corpus', join(process.env.HOME ?? '.', '.capy', 'work', 'harness-eval', 'gbrain-evals', 'eval', 'data', 'messy-company-v1', 'corpus'))!),
      worldPath: resolve(arg('world', join(import.meta.dir, '..', 'world', 'seed', 'world.json'))!),
      out: resolve(arg('out', join('/brains', home))!),
      staging: resolve(arg('staging', join('/tmp', `gbrain-staging-${home}`))!),
      brain,
      ...(access ? { access } : {}),
      ...(labels ? { labels: 'readers' as const } : {}),
      embeddings: arg('embeddings'),
      gbrain: (arg('gbrain', 'gbrain')!).split(' ').filter(Boolean),
      commit: arg('commit', pin.gbrain.commit)!,
      corpusCommit: arg('corpus-commit', pin.corpus.commit)!,
      corpusRepo: pin.corpus.repo,
    });
    console.log(JSON.stringify({ split: m.split, brain, ...(access ? { access, rules: 'rules' in m ? m.rules?.length : 0 } : {}), pages: m.counts, ...('sources' in m ? { sources: m.sources.length, tokens: m.grants.length } : {}), embeddings: m.embeddings === 'off' ? 'off' : { model: m.embeddings.model, dimensions: m.embeddings.dimensions }, gbrain_version: m.gbrain_version, out: arg('out', join('/brains', home)) }));
  } catch (e) {
    console.error(`build-brain failed: ${(e as Error).message}`);
    process.exit(1);
  }
}
