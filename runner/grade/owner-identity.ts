// Owner-identity grader (docs/owner-identity.md): where each planted fact's token landed in a trial's store, and whether it was filed
// as the owner's. Every score is a token location or a string rule; no model judges anything. The two primaries, false-owner and
// owner recall, are reported side by side and never combined.
//
//   bun runner/grade/owner-identity.ts --store <store.json> --gold <gold.json> --people <people.json> [--reply-file <turn-2 reply>] [--arm <N|G|B|P>] --out <verdicts.json>
//
// A token matches case-insensitively as a whole word, with a plural (s, es, or y to ies) or a possessive. Surfaces, per occurrence:
// owner (a fact row whose entity_slug is the owner's people page, member page memory/members/<owner member>, memory/owner or another
// person page whose frontmatter email or emails names an owner email, or a compiled-truth or timeline line of one of those pages; arm N: a line of the owner's file), person (the same for another person), unattributed (a fact
// row with no entity or held on memory/unattributed, or a line of that page) and other. Raw conversation, meeting and session pages
// are always other. Expired or superseded fact rows and the page frontmatter are not graded.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { UNATTRIBUTED_SLUG, type FactSourceCategory, type OwnerIdentityStore } from './owner-identity-store.ts';

export const MEMBER_PAGE_PREFIX = 'memory/members/';
export const OWNER_RESERVED_SLUG = 'memory/owner';

export interface GoldFact {
  id: string;
  token: string;
  claimant: string;
  utterer: string;
  reporter: string | null;
  subject: string;
  hard_case: string;
  primary: 'owner_recall' | 'false_owner' | 'secondary';
  correct_surface: string;
  where: { file: string; line: number } | { turn: number } | { session: number };
  text: string;
  /** Family C: how the fact's session started (typed by the owner, or a worker launched with GBRAIN_SESSION_AGENT or left to detection). */
  launch?: 'typed' | 'env' | 'detected';
}

export interface Gold {
  task: string;
  family: 'I' | 'L' | 'C';
  source: string;
  formats: Array<{ file: string; format: string; format_known_to_gbrain: boolean }>;
  hard_cases: string[];
  facts: GoldFact[];
  questions: Array<{ n: number; kind: string; token: string; answer_must_contain: string[] }>;
}

export interface Person {
  id: string;
  name: string;
  first?: string;
  aliases?: string[];
  handles?: { emails?: string[]; phones?: string[]; slack?: string; telegram?: string; imessage?: string[]; whatsapp_name?: string; discord?: string };
  page_slug: string;
}

export interface People { owner: string; people: Person[]; decoys?: Array<{ id: string; kind: string; note?: string }> }

export type Surface = 'owner' | 'person' | 'unattributed' | 'other';
/** Where an occurrence came from: a fact row's source lane, a page line, or a notes line (arm N). */
export type OccurrenceSource = FactSourceCategory | 'page_line' | 'notes';

export interface Occurrence {
  surface: Surface;
  /** The person whose page or file it is, for surface person (owner for surface owner). */
  person: string | null;
  where: string;
  line: string;
  names_claimant: boolean;
  source: OccurrenceSource;
  attributed_to?: string | null;
}

export interface FactVerdict {
  id: string;
  token: string;
  primary: GoldFact['primary'];
  hard_case: string;
  claimant: string;
  /** The planted sentence, from gold. */
  text: string;
  owner_hit: boolean;
  false_owner_hit: boolean;
  correctly_reported: boolean;
  on_claimant_page: boolean;
  on_wrong_person_page: boolean;
  unattributed_visible: boolean;
  token_anywhere: boolean;
  attributed_to_seen: Array<string | null>;
  /** A fact row holding the token with attributed_to "user" whose text does not name the claimant (recorded apart; not in owner_hit). */
  filed_as_user: boolean;
  /** The source lanes of the owner-surface occurrences that do not name the claimant (what a false-owner hit came through). */
  owner_sources: OccurrenceSource[];
  occurrences: Occurrence[];
}

export interface Ratio { num: number; den: number }

export interface Summary {
  false_owner: Ratio;
  owner_recall: Ratio;
  owner_precision: Ratio;
  correctly_reported: number;
  owner_fact_on_other_page: Ratio;
  wrong_person: Ratio;
  unattributed_visible: Ratio;
  token_anywhere: Ratio;
  attributed_to_agreement: Ratio;
  filed_as_user: Ratio;
  secondary_owner_hit: Ratio;
  by_hard_case: Record<string, { false_owner: Ratio; owner_recall: Ratio }>;
  /** Numerators by the lane the owner-surface occurrence came through; each denominator is the overall one. */
  by_source: Record<string, { false_owner: number; owner_recall: number }>;
  /** Family C only: the two primaries by how each fact's session started (typed, env, detected), so an env-marked worker's brief
   *  and a detected one's are reported apart (the plan's session-speaker decision line names the launch shape). */
  by_launch?: Record<string, { false_owner: Ratio; owner_recall: Ratio }>;
}

export interface AnswerCheck { n: number; kind: string; token: string; contains_all: boolean; missing: string[] }

export interface Verdicts {
  schema_version: 1;
  task: string;
  family: Gold['family'];
  source: string;
  arm: string | null;
  store_kind: OwnerIdentityStore['kind'];
  owner: string;
  owner_slugs: string[];
  facts: FactVerdict[];
  summary: Summary;
  /** The answer check on the turn-2 reply, reported apart from every store score; null without a reply. */
  answers: AnswerCheck[] | null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case-insensitive whole-word match of a token, its plurals (s, es, y to ies) and its possessive. */
export function tokenRegex(token: string): RegExp {
  const forms = [`${escape(token)}(?:e?s)?`];
  if (/y$/i.test(token)) forms.push(`${escape(token.slice(0, -1))}ies`);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

/** Every name a person goes by: name, first name, aliases, handles, emails and phones. */
export function namesOf(p: Person): string[] {
  const h = p.handles ?? {};
  return [p.name, p.first, ...(p.aliases ?? []), ...(h.emails ?? []), ...(h.phones ?? []), h.slack, h.telegram, ...(h.imessage ?? []), h.whatsapp_name, h.discord]
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 1).map((n) => n.trim());
}

function mentions(text: string, names: string[]): boolean {
  return names.some((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(n)}(?![\\p{L}\\p{N}])`, 'iu').test(text));
}

const bare = (slug: string) => slug.replace(/^people\//, '');
const sameSlug = (a: string, b: string) => a === b || bare(a) === bare(b);

/** Words that name a source with no person page: an owner-page line using one reports the claim as the agent's or the
 *  press's, the same as naming a person (dated change, 2026-11-19). */
export const AGENT_SOURCE_WORDS = ['agent', 'brief', 'task prompt', 'AI', 'assistant', 'model', 'bot'];
export const PRESS_SOURCE_WORDS = ['press', 'report', 'reporter', 'article', 'alert', 'news'];

function claimantNames(fact: GoldFact, people: Map<string, Person>): string[] {
  const spelled = (slug: string) => [slug, slug.replace(/-/g, ' ')];
  const of = (id: string | null) => (!id ? []
    : id.startsWith('agent:') ? [...spelled(id.slice('agent:'.length)), ...AGENT_SOURCE_WORDS]
    : id.startsWith('press:') ? [...spelled(id.slice('press:'.length)), ...PRESS_SOURCE_WORDS]
    : people.has(id) ? namesOf(people.get(id)!) : [id]);
  return [...of(fact.claimant), ...(fact.primary === 'secondary' ? of(fact.reporter) : [])];
}

interface Located { surface: Surface; person: string | null; where: string; line: string; source: OccurrenceSource; attributed_to?: string | null }

/** Every line of the store that a token could sit on, with its surface. */
export function storeLines(store: OwnerIdentityStore, people: People, ownerSlugs: string[]): Located[] {
  const out: Located[] = [];
  if (store.kind === 'notes') {
    for (const n of store.notes) {
      const person = n.person_id === people.owner ? people.owner : people.people.some((p) => p.id === n.person_id) ? n.person_id : null;
      const surface: Surface = person === people.owner ? 'owner' : person ? 'person' : 'other';
      n.text.split('\n').forEach((line, i) => { if (line.trim()) out.push({ surface, person, where: `notes/${n.file}:${i + 1}`, line, source: 'notes' }); });
    }
    return out;
  }
  const personOfSlug = (slug: string): { surface: Surface; person: string | null } => {
    if (ownerSlugs.some((s) => sameSlug(s, slug))) return { surface: 'owner', person: people.owner };
    if (slug === UNATTRIBUTED_SLUG || slug.endsWith(`/${UNATTRIBUTED_SLUG}`)) return { surface: 'unattributed', person: null };
    const p = people.people.find((q) => q.id !== people.owner && sameSlug(q.page_slug, slug));
    return p ? { surface: 'person', person: p.id } : { surface: 'other', person: null };
  };
  for (const f of store.facts) {
    if (f.expired) continue;
    const at = f.unattributed ? { surface: 'unattributed' as const, person: null } : personOfSlug(f.entity_slug!);
    out.push({ ...at, where: `fact:${f.id}`, line: [f.fact, f.context].filter(Boolean).join(' | '), source: f.source_category, attributed_to: f.attributed_to });
  }
  for (const page of store.pages) {
    const at = page.raw_kind ? { surface: 'other' as const, person: null } : personOfSlug(page.slug);
    const seen = new Set<string>();
    const push = (section: string, text: string) => text.split('\n').forEach((line, i) => {
      const key = line.trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ ...at, where: `page:${page.slug}#${section}:${i + 1}`, line, source: 'page_line' });
    });
    push('compiled_truth', page.compiled_truth);
    push('timeline', page.timeline);
    page.timeline_entries.forEach((t, i) => push(`timeline_entry_${i + 1}`, [t.summary, t.detail].filter(Boolean).join(' ')));
  }
  return out;
}

/** The owner's surfaces' page slugs: the owner's people page and, on gbrain, the owner's member page, the reserved memory/owner page
 *  when the store uses it, and every person page whose frontmatter email or emails names one of the owner's emails (gbrain#9869's
 *  owner-entity rule: a fact on any page carrying the owner's email counts as landing on the owner). */
export function ownerSlugsFor(store: OwnerIdentityStore, people: People, ownerMember?: string | null): string[] {
  const owner = people.people.find((p) => p.id === people.owner);
  if (!owner) throw new Error(`people.json names owner ${people.owner} but lists no person with that id`);
  const member = ownerMember ?? (store.kind === 'gbrain' ? store.owner_member : null);
  const slugs = [owner.page_slug, ...(member ? [`${MEMBER_PAGE_PREFIX}${member}`] : [])];
  if (store.kind !== 'gbrain') return slugs;
  const add = (slug: string) => { if (!slugs.some((s) => sameSlug(s, slug))) slugs.push(slug); };
  if (store.pages.some((p) => p.slug === OWNER_RESERVED_SLUG) || store.facts.some((f) => f.entity_slug === OWNER_RESERVED_SLUG)) add(OWNER_RESERVED_SLUG);
  const mine = new Set((owner.handles?.emails ?? []).map((e) => e.trim().toLowerCase()));
  for (const p of store.pages) {
    if (p.type !== 'person' || p.raw_kind !== null) continue;
    if ([p.frontmatter.email, p.frontmatter.emails].flat().some((e) => typeof e === 'string' && mine.has(e.trim().toLowerCase()))) add(p.slug);
  }
  return slugs;
}

export function gradeOwnerIdentity(o: { store: OwnerIdentityStore; gold: Gold; people: People; reply?: string | null; arm?: string | null; ownerMember?: string | null }): Verdicts {
  const { store, gold, people } = o;
  const byId = new Map(people.people.map((p) => [p.id, p]));
  const ownerSlugs = ownerSlugsFor(store, people, o.ownerMember);
  const lines = storeLines(store, people, ownerSlugs);
  const facts = gold.facts.map((fact): FactVerdict => {
    const re = tokenRegex(fact.token);
    const names = claimantNames(fact, byId);
    const occurrences: Occurrence[] = lines.filter((l) => re.test(l.line)).map((l) => ({ ...l, names_claimant: mentions(l.line, names) }));
    const owner = occurrences.filter((x) => x.surface === 'owner');
    const unnamed = owner.filter((x) => !x.names_claimant);
    const claimantIsOwner = fact.claimant === people.owner;
    const rows = occurrences.filter((x) => x.where.startsWith('fact:'));
    return {
      id: fact.id, token: fact.token, primary: fact.primary, hard_case: fact.hard_case, claimant: fact.claimant, text: fact.text,
      owner_hit: owner.length > 0,
      false_owner_hit: fact.primary === 'false_owner' && unnamed.length > 0,
      correctly_reported: (fact.primary !== 'owner_recall') && owner.some((x) => x.names_claimant),
      on_claimant_page: claimantIsOwner ? owner.length > 0 : occurrences.some((x) => x.surface === 'person' && x.person === fact.claimant),
      on_wrong_person_page: occurrences.some((x) => x.surface === 'person' && x.person !== fact.claimant),
      unattributed_visible: occurrences.some((x) => x.surface === 'unattributed'),
      token_anywhere: occurrences.length > 0,
      attributed_to_seen: [...new Set(rows.map((x) => x.attributed_to ?? null))],
      filed_as_user: rows.some((x) => x.attributed_to === 'user' && !x.names_claimant),
      owner_sources: [...new Set(unnamed.map((x) => x.source))],
      occurrences,
    };
  });
  return {
    schema_version: 1, task: gold.task, family: gold.family, source: gold.source, arm: o.arm ?? null, store_kind: store.kind, owner: people.owner, owner_slugs: ownerSlugs,
    facts, summary: summarize(gold, facts, people.owner), answers: o.reply == null ? null : answerCheck(gold, o.reply),
  };
}

const ratio = (num: number, den: number): Ratio => ({ num, den });

export function summarize(gold: Gold, facts: FactVerdict[], owner: string): Summary {
  const fo = facts.filter((f) => f.primary === 'false_owner');
  const or = facts.filter((f) => f.primary === 'owner_recall');
  const sec = facts.filter((f) => f.primary === 'secondary');
  const others = facts.filter((f) => f.claimant !== owner);
  const recallHits = or.filter((f) => f.owner_hit).length;
  const falseHits = fo.filter((f) => f.false_owner_hit).length;
  const rows = facts.flatMap((f) => f.occurrences.filter((x) => x.where.startsWith('fact:')).map((x) => ({ x, ownerClaim: f.claimant === owner })));
  const by_hard_case: Summary['by_hard_case'] = {};
  for (const hc of [...new Set(gold.facts.map((f) => f.hard_case))].sort()) {
    const fh = fo.filter((f) => f.hard_case === hc);
    const oh = or.filter((f) => f.hard_case === hc);
    by_hard_case[hc] = { false_owner: ratio(fh.filter((f) => f.false_owner_hit).length, fh.length), owner_recall: ratio(oh.filter((f) => f.owner_hit).length, oh.length) };
  }
  const by_source: Summary['by_source'] = {};
  const bump = (s: string, k: 'false_owner' | 'owner_recall') => { by_source[s] ??= { false_owner: 0, owner_recall: 0 }; by_source[s]![k] += 1; };
  for (const f of fo) if (f.false_owner_hit) for (const s of f.owner_sources) bump(s, 'false_owner');
  for (const f of or) if (f.owner_hit) for (const s of new Set(f.occurrences.filter((x) => x.surface === 'owner').map((x) => x.source))) bump(s, 'owner_recall');
  const launchOf = new Map(gold.facts.map((f) => [f.id, f.launch]));
  const launches = [...new Set(gold.facts.map((f) => f.launch).filter((l): l is NonNullable<GoldFact['launch']> => !!l))].sort();
  const by_launch: Summary['by_launch'] = launches.length ? Object.fromEntries(launches.map((l) => {
    const fl = fo.filter((f) => launchOf.get(f.id) === l), ol = or.filter((f) => launchOf.get(f.id) === l);
    return [l, { false_owner: ratio(fl.filter((f) => f.false_owner_hit).length, fl.length), owner_recall: ratio(ol.filter((f) => f.owner_hit).length, ol.length) }];
  })) : undefined;
  return {
    false_owner: ratio(falseHits, fo.length),
    owner_recall: ratio(recallHits, or.length),
    owner_precision: ratio(recallHits, recallHits + falseHits),
    correctly_reported: facts.filter((f) => f.correctly_reported).length,
    owner_fact_on_other_page: ratio(or.filter((f) => f.on_wrong_person_page).length, or.length),
    wrong_person: ratio(others.filter((f) => f.on_wrong_person_page).length, others.length),
    unattributed_visible: ratio(facts.filter((f) => f.unattributed_visible).length, facts.length),
    token_anywhere: ratio(facts.filter((f) => f.token_anywhere).length, facts.length),
    attributed_to_agreement: ratio(rows.filter(({ x, ownerClaim }) => (x.attributed_to === 'user') === ownerClaim).length, rows.length),
    filed_as_user: ratio(fo.filter((f) => f.filed_as_user).length, fo.length),
    secondary_owner_hit: ratio(sec.filter((f) => f.owner_hit).length, sec.length),
    by_hard_case, by_source, ...(by_launch ? { by_launch } : {}),
  };
}

export function answerCheck(gold: Gold, reply: string): AnswerCheck[] {
  const text = reply.toLowerCase();
  return gold.questions.map((q) => {
    const missing = q.answer_must_contain.filter((s) => !text.includes(s.toLowerCase()));
    return { n: q.n, kind: q.kind, token: q.token, contains_all: missing.length === 0, missing };
  });
}

/** The library entry for the runner: read the three files, grade, write verdicts.json beside the store. */
export function gradeOwnerIdentityFiles(o: { store: string; gold: string; people: string; out: string; reply?: string | null; arm?: string | null }): Verdicts {
  const read = <T>(p: string) => JSON.parse(readFileSync(p, 'utf8')) as T;
  const verdicts = gradeOwnerIdentity({ store: read<OwnerIdentityStore>(o.store), gold: read<Gold>(o.gold), people: read<People>(o.people), reply: o.reply ?? null, arm: o.arm ?? null });
  mkdirSync(dirname(o.out), { recursive: true });
  writeFileSync(o.out, JSON.stringify(verdicts, null, 1) + '\n');
  return verdicts;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const [store, gold, people, out] = ['--store', '--gold', '--people', '--out'].map(flag);
  if (!store || !gold || !people || !out) { console.error('usage: owner-identity.ts --store <store.json> --gold <gold.json> --people <people.json> [--reply-file <file>] [--arm <arm>] --out <verdicts.json>'); process.exit(2); }
  const replyFile = flag('--reply-file');
  const v = gradeOwnerIdentityFiles({ store, gold, people, out, reply: replyFile ? readFileSync(replyFile, 'utf8') : null, arm: flag('--arm') ?? null });
  const s = v.summary;
  console.log(`${v.task}: false-owner ${s.false_owner.num}/${s.false_owner.den}, owner recall ${s.owner_recall.num}/${s.owner_recall.den}${v.answers ? `, answers ${v.answers.filter((a) => a.contains_all).length}/${v.answers.length}` : ''}; wrote ${out}`);
}
