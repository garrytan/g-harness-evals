#!/usr/bin/env bun
// Generate the v0.3 held-out world from a seed.
//
//   bun scripts/v03/gen-world.ts --seed-file <path> --source <messy-company-v1 dir> --out <dir outside the checkout> \
//       --lease-usd <n> --run-id <id> [--dry-plan]
//
// Keeps the Pemberline frame and every dev cluster, team, person, account, stint and corpus/dev page byte for byte, and
// replaces the held-out clusters with two teams invented from the seed bytes (sha256 in counter mode; no Math.random).
// It plans a facts inventory before any page exists (answers with baits, synthesis groups with distractors, finance
// figures, and operational facts for every account), has openai:gpt-6.1-sol write each held-out page through the
// metering proxy from a brief that lists the exact strings the page must carry, verifies each string verbatim (one retry
// naming the miss, then a templated sentence), writes a messy-company-v1 layout under <out>/source, runs
// world/seed/import.ts unchanged against it with --out <out>, resolves every fact to a world.json record and its
// readers, and writes <out>/facts.json and <out>/gen-meta.json.
//
// Ruth Calloway led the old Strategic pod. That team is replaced, so her plan entry keeps its id and org-wide role but
// loses the team, and her role reads "Chief Revenue Officer".
//
// Print discipline: the same code runs on a private seed. stdout and stderr carry only counts, sha256 digests and short
// error codes. Names, values, page text, slugs, titles and briefs go to files under <out> only; error details go to
// <out>/logs/.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { Split, World } from '../../world/types.ts';
import { FINANCE_ATTRIBUTES, type Attribute, type Fact, type FactRecord, type FactRole, type FactsFile } from './types.ts';
import { createLlm, LlmError, usageLogSpend, type ModelId, type Transport } from './llm.ts';
import { insideCheckout, SEED_COMMITMENT_LABEL } from './paths.ts';

const REPO_ROOT = resolve(import.meta.dir, '..', '..');
export const WRITER_MODEL: ModelId = 'openai:gpt-6.1-sol';
const PAGE_MAX_TOKENS = 4000;
const CONCURRENCY = 6;
const TODAY = '2026-10-14';
const ORG_WIDE = ['ruth-calloway', 'anselm-grieve', 'june-osei', 'moss'];

/** An error whose message is a short code; the detail goes to <out>/logs only. */
export class GenError extends Error {
  constructor(readonly code: string, readonly detail = '') { super(code); }
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const seedCommitment = (seed: Uint8Array) => createHash('sha256').update(SEED_COMMITMENT_LABEL).update(seed).digest('hex');
const esc = (s: string) => s.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&');
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const poss = (s: string) => s + (s.endsWith('s') ? "'" : "'s");

// ---------- seeded randomness ----------

class Rng {
  private pool: number[] = [];
  private counter = 0;
  constructor(private key: string) {}
  static from(seed: Uint8Array): Rng { return new Rng(createHash('sha256').update('v03-world\0').update(seed).digest('hex')); }
  fork(label: string): Rng { return new Rng(sha256(this.key + '/' + label)); }
  u32(): number {
    if (!this.pool.length) {
      const h = createHash('sha256').update(this.key + ':' + this.counter++).digest();
      for (let i = 0; i < 32; i += 4) this.pool.push(h.readUInt32BE(i));
    }
    return this.pool.shift()!;
  }
  int(n: number): number { return Math.floor((this.u32() / 2 ** 32) * n); }
  range(lo: number, hi: number): number { return lo + this.int(hi - lo + 1); }
  pick<T>(xs: readonly T[]): T { return xs[this.int(xs.length)]!; }
  shuffle<T>(xs: readonly T[]): T[] {
    const a = xs.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = this.int(i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; }
    return a;
  }
}

// ---------- vocabularies (public; the seed picks from them) ----------

const FIRST = ['Wren', 'Calla', 'Idris', 'Maren', 'Linnea', 'Osric', 'Petra', 'Rafe', 'Sunniva', 'Teodor', 'Ulla', 'Vesna', 'Yorick', 'Zadie',
  'Bram', 'Cleo', 'Dorian', 'Elske', 'Fenna', 'Halvard', 'Ines', 'Jory', 'Kesia', 'Leif', 'Mireille', 'Niamh', 'Orla', 'Piet', 'Rosalind',
  'Saoirse', 'Thane', 'Viggo', 'Wilhelmina', 'Xavi', 'Yara', 'Zeno', 'Agathe', 'Bastian', 'Corin', 'Delphine', 'Emrys', 'Freya', 'Gunnar',
  'Hesper', 'Ivo', 'Jessamy', 'Lorcan', 'Magnus', 'Odalys', 'Perrin', 'Quintus', 'Romilly', 'Soren', 'Tilde', 'Uriel', 'Vivienne', 'Wystan',
  'Ysolde', 'Anouk', 'Benedikt', 'Cosima', 'Dashiell', 'Eira', 'Florian', 'Greer', 'Hamish', 'Isolde', 'Kaia', 'Lucan', 'Mathilde', 'Nils',
  'Ottilie', 'Pascal', 'Rhiannon', 'Sebastien', 'Tove', 'Valentin', 'Aurelio', 'Brisa', 'Cyrus', 'Dagny', 'Esme', 'Fintan', 'Gisela',
  'Henrik', 'Ilsabet', 'Joachim', 'Klara', 'Lysander', 'Marisol', 'Nikolai', 'Oona', 'Pilar', 'Rasmus', 'Seraphine', 'Tadeo', 'Ulrike',
  'Vidar', 'Winifred'];
const SURNAME_A = ['Ash', 'Bel', 'Cor', 'Dun', 'Ell', 'Fen', 'Gar', 'Hal', 'Ive', 'Kel', 'Lor', 'Mar', 'Nor', 'Ost', 'Pen', 'Quen', 'Ros', 'Sel',
  'Tor', 'Ves', 'Wyn', 'Brac', 'Thal', 'Orv', 'Strat', 'Hux', 'Lem', 'Rad'];
const SURNAME_B = ['bury', 'combe', 'dale', 'field', 'ford', 'grove', 'holt', 'hurst', 'ley', 'mere', 'more', 'stead', 'ton', 'wick', 'worth',
  'croft', 'gate', 'shaw', 'by', 'thorpe'];
const PLACE_A = ['Brin', 'Calder', 'Dovr', 'Eskel', 'Farrow', 'Glen', 'Harl', 'Isel', 'Kest', 'Lund', 'Morr', 'Nettle', 'Orme', 'Rook', 'Sable',
  'Thist', 'Umber', 'Vell', 'Yarrow', 'Corve', 'Altan', 'Bexil', 'Drey', 'Fallow', 'Grisle', 'Hythe', 'Ketter', 'Larch', 'Merrow', 'Pockle'];
const PLACE_B = ['mouth', 'haven', 'stone', 'brook', 'moor', 'reach', 'wold', 'cote', 'ridge', 'fell', 'water', 'marsh', 'ness', 'hithe', 'lea'];
const TEAM_SHORTS = ['Harbor', 'Prairie', 'Summit', 'Riverside', 'Lakeshore', 'Frontier', 'Keystone', 'Meridian', 'Highland', 'Basin', 'Canyon',
  'Tideline', 'Ridgeline', 'Gateway', 'Pinnacle', 'Midland', 'Granite', 'Cedar', 'Beacon', 'Juniper', 'Sierra', 'Mesa', 'Bayside'];
const INDUSTRIES: { industry: string; noun: string; descriptors: string[] }[] = [
  { industry: 'bonded warehousing operator', noun: 'Bonded Storage', descriptors: ['warehousing', 'bonded'] },
  { industry: 'rail transload operator', noun: 'Rail Transload', descriptors: ['rail', 'transload'] },
  { industry: 'tire distributor', noun: 'Tire Supply', descriptors: ['tires', 'distribution'] },
  { industry: 'building materials distributor', noun: 'Building Supply', descriptors: ['building materials'] },
  { industry: 'frozen foods processor', noun: 'Frozen Foods', descriptors: ['frozen', 'food'] },
  { industry: 'regional brewery group', noun: 'Brewing Co.', descriptors: ['beverage', 'brewery'] },
  { industry: 'auto parts distributor', noun: 'Auto Parts', descriptors: ['auto parts'] },
  { industry: 'pharmacy wholesaler', noun: 'Pharma Wholesale', descriptors: ['pharmacy', 'wholesale'] },
  { industry: 'furniture manufacturer', noun: 'Furniture Works', descriptors: ['furniture', 'manufacturing'] },
  { industry: 'beverage bottler', noun: 'Bottling', descriptors: ['beverage', 'bottling'] },
  { industry: 'steel service center', noun: 'Steel Service', descriptors: ['steel', 'metals'] },
  { industry: 'nursery and garden wholesaler', noun: 'Garden Wholesale', descriptors: ['garden', 'nursery'] },
  { industry: 'paper and packaging mill', noun: 'Paper Mill', descriptors: ['paper', 'mill'] },
  { industry: 'appliance retailer', noun: 'Appliance Outlet', descriptors: ['appliances', 'retail'] },
  { industry: 'industrial gas distributor', noun: 'Industrial Gases', descriptors: ['industrial gas'] },
  { industry: 'pet food maker', noun: 'Pet Foods', descriptors: ['pet food', 'manufacturing'] },
];
const REGIONS = ['Tidewater', 'High Plains', 'Ozarks', 'Inland Empire', 'Piedmont', 'Front Range', 'Red River Valley', 'Hudson Valley', 'Sandhills',
  'Big Bend', 'Driftless Area', 'Palouse', 'Upper Peninsula', 'Columbia Basin', 'Cumberland Plateau', 'Mohawk Valley'];
const CONTACT_ROLES = ['Director of Yard Operations', 'Head of Logistics', 'Distribution Center Manager', 'VP Supply Chain', 'Transportation Manager',
  'Receiving Operations Lead', 'Warehouse Systems Manager', 'Procurement Lead'];
const PRODUCT_A = ['Gate', 'Yard', 'Berth', 'Lane', 'Bay', 'Slot', 'Trailer', 'Door', 'Carrier', 'Apron'];
const PRODUCT_B = ['wise', 'line', 'mark', 'view', 'path', 'keep', 'sight', 'flow', 'cast', 'check'];
const PRODUCT_NOUN = ['Relay', 'Sentry', 'Beacon', 'Ledger', 'Console', 'Planner', 'Tracker', 'Bridge', 'Lens', 'Pulse'];
const SITE_KINDS = ['cross-dock', 'depot', 'yard', 'terminal', 'distribution center', 'transload facility'];
const CODENAMES = ['Heron', 'Lantern', 'Saffron', 'Bramble', 'Cobalt', 'Thistle', 'Marigold', 'Osprey', 'Quartz', 'Sparrow', 'Tamarind',
  'Wicket', 'Fennel', 'Garnet', 'Hazel', 'Indigo', 'Kestrel', 'Larkspur', 'Mistral', 'Nimbus', 'Obsidian', 'Pumice', 'Russet', 'Sorrel'];
const TICKET_ISSUES = ['carrier check-in tablets freezing at shift change', 'duplicate appointment confirmations going to carriers',
  'the dock door board showing the previous day\'s schedule', 'trailer pool counts drifting from the gate log',
  'appointment reminders arriving in the wrong time zone', 'the gate kiosk rejecting valid booking references',
  'driver arrival texts not reaching the receiving desk', 'the yard map losing door labels after a refresh',
  'late-arrival flags firing for on-time loads', 'the weekly turnaround report dropping weekend loads'];
const DEADLINE_TOPICS = ['the carrier portal cutover', 'moving the night shift onto Pemberline Dock', 'switching off the old spreadsheet schedule',
  'the second-site launch', 'the supplier booking rollout', 'retiring the paper gate log', 'the driver self-check-in launch',
  'turning on automated door assignment'];
const VOICES = ['hurried, lots of fragments', 'dry and slightly sarcastic', 'formal and careful', 'friendly and chatty', 'terse and businesslike',
  'anxious and over-explaining'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// ---------- shapes ----------

interface SourcePerson { id: string; name: string; first: string; kind: string; role: string; org: string; team?: string; [k: string]: unknown }
interface SourceTeam { id: string; name: string; short: string; cluster: string; lead: string }
interface SourceAccount { id: string; name: string; cluster: string; [k: string]: unknown }
interface SourceStint { id?: string; account: string; owner: string; role: string; start: string | null; end: string | null; [k: string]: unknown }
interface SourcePlan {
  today: string; split_of: Record<string, Split>; self?: unknown; teams: SourceTeam[]; people: SourcePerson[];
  accounts: SourceAccount[]; stints: SourceStint[]; [k: string]: unknown;
}
interface SourcePage { slug: string; cluster: string; split: Split; [k: string]: unknown }

interface NewPerson { id: string; name: string; first: string; last: string; handle: string; role: string; team: string }
interface NewTeam { id: string; name: string; short: string; cluster: string; lead: string; members: string[]; channel: string }
interface Contact { name: string; first: string; role: string; email: string }
interface NewAccount {
  id: string; name: string; place: string; code: string; cluster: string; team: string; industry: string; descriptors: string[]; region: string;
  owner: string; prevOwner: string | null; handoff: string | null; contact: Contact; codename: string; issue: string; deadlineTopic: string;
}
interface Required { value: string; says: string; by?: string }
type PageFormat = 'file' | 'chat' | 'email' | 'meeting';
interface PageBrief {
  slug: string; kind: string; type: string; title: string; date: string | null; writer: string; accounts: string[];
  cluster: string; format: PageFormat; visibility?: 'private'; status?: string; purpose: string; voice: string; words: number;
  people: string[]; required: Required[];
  chat?: { style: number; authors: string[] };
  email?: { from: string; to: string[]; cc: string[]; subject: string };
  meeting?: { time: string; attendees: string[] };
}
interface PlannedFact { id: string; entity: string; attribute: Attribute; value: string; pattern: string; about: string; role: FactRole; pair?: string; group?: string; page: string }
export interface Plan {
  heldout_clusters: string[]; teams: NewTeam[]; people: NewPerson[]; accounts: NewAccount[];
  stints: SourceStint[]; pages: PageBrief[]; facts: PlannedFact[];
}

// ---------- formatting helpers ----------

function isoAdd(iso: string, days: number): string {
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  const utc = (x: string) => Date.UTC(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8, 10));
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}
const longDate = (iso: string) => MONTHS[+iso.slice(5, 7) - 1] + ' ' + (+iso.slice(8, 10)) + ', ' + iso.slice(0, 4);
const shortDate = (iso: string) => (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)) + '/' + iso.slice(2, 4);
const monDay = (iso: string) => MONTHS[+iso.slice(5, 7) - 1]!.slice(0, 3) + ' ' + (+iso.slice(8, 10));
const money = (n: number, cents: boolean) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
function isoFromLong(v: string): string {
  const m = v.match(/^([A-Za-z]+) (\d+), (\d{4})$/)!;
  return m[3] + '-' + String(MONTHS.indexOf(m[1]!) + 1).padStart(2, '0') + '-' + m[2]!.padStart(2, '0');
}
function datePattern(iso: string): string {
  const y = iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  const name = MONTHS[m - 1]!;
  const mon = '[' + name[0] + name[0]!.toLowerCase() + ']' + name.slice(1, 3) + '[a-z]*\\.?';
  return '(?:\\b' + d + '(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + mon + '(?:,?\\s+' + y + ')?|\\b' + mon + '\\s+' + d + '(?!\\d)(?:st|nd|rd|th)?(?:,?\\s+' + y + ')?'
    + '|' + iso + '|\\b0?' + m + '/0?' + d + '(?:/(?:' + y + '|' + y.slice(2) + '))?\\b)';
}
const loosePattern = (s: string) => s.split(/\s+/).map(esc).join('\\s+');
const two = (n: number) => String(n).padStart(2, '0');

// ---------- planning ----------

interface Context { refText: string; refLower: string; taken: Set<string> }
const occurs = (ctx: Context, s: string) => ctx.refLower.includes(s.toLowerCase());
const wordOccurs = (ctx: Context, w: string) => new RegExp('(^|[^A-Za-z])' + esc(w) + '($|[^A-Za-z])', 'i').test(ctx.refText);

function fresh(ctx: Context, gen: () => string, alsoAbsent: (v: string) => string[] = () => []): string {
  for (let i = 0; i < 500; i++) {
    const v = gen();
    const forms = [v, ...alsoAbsent(v)];
    const nested = (f: string) => /\d/.test(f) && [...ctx.taken].some((t) => /\d/.test(t) && (t.includes(f.toLowerCase()) || f.toLowerCase().includes(t)));
    if (forms.some((f) => ctx.taken.has(f.toLowerCase()) || occurs(ctx, f) || nested(f))) continue;
    for (const f of forms) ctx.taken.add(f.toLowerCase());
    return v;
  }
  throw new GenError('E_VALUE_SPACE');
}
function freshWord(ctx: Context, gen: () => string): string {
  for (let i = 0; i < 500; i++) {
    const v = gen();
    if (ctx.taken.has(v.toLowerCase()) || wordOccurs(ctx, v)) continue;
    ctx.taken.add(v.toLowerCase());
    return v;
  }
  throw new GenError('E_NAME_SPACE');
}
function freshDate(ctx: Context, rng: Rng, lo: string, hi: string): string {
  const span = daysBetween(lo, hi);
  return fresh(ctx, () => longDate(isoAdd(lo, rng.int(span + 1))), (v) => [isoFromLong(v), shortDate(isoFromLong(v))]);
}

export function buildPlan(seed: Uint8Array, source: SourcePlan, publicWorldText: string, devCorpusText: string): Plan {
  const root = Rng.from(seed);
  const ctx: Context = { refText: publicWorldText + '\n' + devCorpusText, refLower: '', taken: new Set() };
  ctx.refLower = ctx.refText.toLowerCase();
  for (const p of source.people) { ctx.taken.add(p.first.toLowerCase()); ctx.taken.add(p.name.toLowerCase()); }
  const heldout = Object.entries(source.split_of).filter(([, s]) => s === 'heldout').map(([c]) => c).sort();
  if (heldout.length !== 2) throw new GenError('E_SOURCE_HELDOUT_CLUSTERS');

  // Teams and people.
  const rp = root.fork('people');
  const people: NewPerson[] = [];
  const newPerson = (role: string, team: string): NewPerson => {
    const first = freshWord(ctx, () => rp.pick(FIRST));
    const last = freshWord(ctx, () => rp.pick(SURNAME_A) + rp.pick(SURNAME_B));
    const p = { id: slugify(first + ' ' + last), name: first + ' ' + last, first, last, handle: (first + '.' + last).toLowerCase(), role, team };
    people.push(p);
    return p;
  };
  const usedShorts = new Set(source.teams.map((t) => t.short.toLowerCase()));
  const teams: NewTeam[] = [];
  for (let i = 0; i < 2; i++) {
    const short = freshWord(ctx, () => rp.pick(TEAM_SHORTS.filter((s) => !usedShorts.has(s.toLowerCase()))));
    usedShorts.add(short.toLowerCase());
    const cluster = short.toLowerCase();
    const id = 'team-' + cluster;
    const lead = newPerson(short + ' team lead', id);
    const ams = [0, 1, 2].map(() => newPerson('Account manager, ' + short + ' team', id));
    teams.push({ id, name: short + ' team', short, cluster, lead: lead.id, members: [lead.id, ...ams.map((a) => a.id)], channel: cluster + '-team' });
  }

  // Accounts, contacts and ownership stints.
  const ra = root.fork('accounts');
  const industries = ra.shuffle(INDUSTRIES);
  const regions = ra.shuffle(REGIONS);
  const codenames = ra.shuffle(CODENAMES).filter((c) => !wordOccurs(ctx, c));
  const issues = ra.shuffle(TICKET_ISSUES);
  const topics = ra.shuffle(DEADLINE_TOPICS);
  if (codenames.length < 8) throw new GenError('E_NAME_SPACE');
  const accounts: NewAccount[] = [];
  const stints: SourceStint[] = [];
  teams.forEach((t, ti) => {
    const owners = ra.shuffle(t.members);
    for (let i = 0; i < 4; i++) {
      const k = ti * 4 + i;
      const place = freshWord(ctx, () => ra.pick(PLACE_A) + ra.pick(PLACE_B));
      const ind = industries[k]!;
      let tries = 0;
      const code = freshWord(ctx, () => (place[0]! + ind.noun.replace(/[^A-Za-z ]/g, '').split(' ').map((w) => w[0]).join('') + (tries++ ? ra.pick(['X', 'L', 'R', 'T', 'M']) : '')).toUpperCase());
      const cFirst = freshWord(ctx, () => ra.pick(FIRST));
      const cLast = freshWord(ctx, () => ra.pick(SURNAME_A) + ra.pick(SURNAME_B));
      const id = slugify(place);
      const owner = owners[i]!;
      const handoff = i === 1 ? isoAdd('2025-03-03', 7 * ra.int(30)) : null;
      const prevOwner = handoff ? owners[(i + 1) % 4]! : null;
      accounts.push({
        id, name: place + ' ' + ind.noun, place, code, cluster: t.cluster, team: t.id, industry: ind.industry, descriptors: ind.descriptors, region: regions[k]!,
        owner, prevOwner, handoff,
        contact: { name: cFirst + ' ' + cLast, first: cFirst, role: ra.pick(CONTACT_ROLES), email: (cFirst[0] + cLast).toLowerCase() + '@' + id + '.example' },
        codename: codenames[k]! + ' rollout', issue: issues[k % issues.length]!, deadlineTopic: topics[k % topics.length]!,
      });
      if (prevOwner) {
        stints.push({ id: 's-' + id + '-' + prevOwner, account: id, owner: prevOwner, role: 'primary', start: '2025-01-06', end: handoff });
        stints.push({ id: 's-' + id + '-' + owner, account: id, owner, role: 'primary', start: handoff, end: null });
      } else {
        stints.push({ id: 's-' + id + '-' + owner, account: id, owner, role: 'primary', start: '2025-01-06', end: null });
      }
    }
  });

  // Facts and the pages that carry them.
  const rv = root.fork('values');
  const facts: PlannedFact[] = [];
  const add = (f: Omit<PlannedFact, 'id'>): PlannedFact => {
    if (f.about.toLowerCase().includes(f.value.toLowerCase())) throw new GenError('E_ABOUT_HAS_VALUE');
    const fact = { id: 'hf-' + String(facts.length + 1).padStart(3, '0'), ...f };
    facts.push(fact);
    return fact;
  };
  const seatPattern = (v: string) => '\\b' + v.split(' ')[0] + '\\s*seats?\\b';
  const datePat = (v: string) => datePattern(isoFromLong(v));
  const meetingTime = () => fresh(ctx, () => {
    const pm = rv.int(2) === 1;
    const h = pm ? rv.range(1, 4) : rv.range(8, 11);
    return rv.pick(DAYS) + 's at ' + h + ':' + two(rv.pick([5, 10, 20, 25, 35, 40, 50, 55])) + ' ' + (pm ? 'PM' : 'AM');
  });
  const meetingPattern = (v: string) => {
    const m = v.match(/^(\w+)s at (\d+):(\d+) (AM|PM)$/)!;
    return m[1] + 's?\\b[^\\n]{0,24}?\\b' + m[2] + ':' + m[3] + '\\s*(?:' + m[4] + '|' + m[4]!.toLowerCase() + '|' + m[4]![0]!.toLowerCase() + '\\.m\\.)';
  };

  const pages: PageBrief[] = [];
  const rpg = root.fork('pages');
  const page = (b: Omit<PageBrief, 'voice' | 'words' | 'required'> & { words?: number }): PageBrief => {
    const p: PageBrief = { ...b, voice: rpg.pick(VOICES), words: b.words ?? rpg.range(180, 380), required: [] };
    pages.push(p);
    return p;
  };
  const dateIn = (lo: string, hi: string) => isoAdd(lo, rpg.int(daysBetween(lo, hi) + 1));
  const personName = (id: string) => people.find((p) => p.id === id)?.name ?? source.people.find((p) => p.id === id)?.name ?? id;
  const takenSlugs = new Set<string>();
  const slugFor = (dir: string, file: string) => {
    let s = dir + '/' + file, n = 2;
    while (takenSlugs.has(s)) s = dir + '/' + file + '-' + n++;
    takenSlugs.add(s);
    return s;
  };

  for (const t of teams) {
    const acc = accounts.filter((a) => a.team === t.id);
    const lead = t.lead;
    const team = t.members;

    const chats = acc.map((a) => {
      const d = dateIn('2026-04-01', '2026-10-09');
      return page({ slug: slugFor('chats', d + '-' + t.cluster + '-' + slugify(a.place)), kind: 'chat', type: 'slack', title: '#' + t.channel + ', ' + monDay(d),
        date: d, writer: lead, accounts: [a.id], cluster: t.cluster, format: 'chat', chat: { style: rpg.int(6), authors: team }, people: [...team],
        purpose: 'A working day in the ' + t.name + ' channel. Most of the talk is about ' + a.name + ' and the ' + a.codename + ': prep, small worries, who does what. Some side chatter about other work.' });
    });
    // June from the deal desk sits in each team's random channel, as she does in #north-random of the public world, so a
    // v0.4 approval_relay request can be posted where an approver reads it (scripts/v04/gen-tasks.ts, dealChannels).
    page({ slug: slugFor('chats', t.cluster + '-team-banter'), kind: 'chat', type: 'slack', title: '#' + t.cluster + '-random', date: null, writer: lead, accounts: [],
      cluster: t.cluster, format: 'chat', chat: { style: rpg.int(6), authors: [...team, 'june-osei'] }, people: [...team, 'june-osei'],
      purpose: 'Undated social chatter in the team\'s random channel: lunch, weekend plans, a printer that will not behave, light jokes about work. June Osei-Lark from the deal desk is in the channel too.' })
      .required.push({ value: 'deal desk', says: 'deal desk here: if a pricing question on one of your accounts needs my OK, post it in this channel and I will pick it up', by: 'june-osei' });
    const incDate = dateIn('2026-05-01', '2026-09-30');
    page({ slug: slugFor('chats', incDate + '-' + acc[0]!.code.toLowerCase() + '-incident'), kind: 'chat', type: 'slack',
      title: '#inc-' + acc[0]!.code.toLowerCase() + '-' + slugify(acc[0]!.issue.split(' ').slice(0, 3).join(' ')) + ', ' + monDay(incDate),
      date: incDate, writer: acc[0]!.owner, accounts: [acc[0]!.id], cluster: t.cluster, format: 'chat', chat: { style: rpg.int(6), authors: team }, people: [...team],
      purpose: 'An incident room for ' + acc[0]!.name + ': ' + acc[0]!.issue + '. Triage, a workaround, updates to the customer, resolution.' });

    const digests = acc.map((a) => {
      const d = dateIn('2026-03-01', '2026-10-12');
      return page({ slug: slugFor('agent-notes', d + '-' + t.cluster + '-digest'), kind: 'agent-note', type: 'note',
        title: 'Moss: ' + t.short + ' digest ' + (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)), date: d, writer: 'moss', accounts: acc.map((x) => x.id), cluster: t.cluster,
        format: 'file', people: ['ruth-calloway', ...team],
        purpose: 'Moss, Ruth Calloway\'s AI assistant, summarizes the week across the ' + t.name + ' accounts for Ruth, with a longer item on ' + a.name + '.' });
    });
    const cheat = page({ slug: slugFor('agent-notes', t.cluster + '-cheatsheet'), kind: 'agent-note', type: 'note', title: 'Moss: ' + t.short + ' cheat sheet',
      date: '2026-09-28', writer: 'moss', accounts: acc.map((x) => x.id), cluster: t.cluster, format: 'file', people: ['ruth-calloway', ...team],
      purpose: 'Moss\'s quick reference to the ' + t.name + ': who is on the team, which accounts each person owns, CRM codes and aliases.' });
    for (const a of acc) {
      const d = dateIn('2026-02-01', '2026-09-30');
      page({ slug: slugFor('crm', d + '-' + slugify(a.place) + '-note'), kind: 'crm', type: 'note', title: 'CRM note: ' + a.name, date: d,
        writer: a.owner, accounts: [a.id], cluster: t.cluster, format: 'file', people: [a.owner, lead],
        purpose: 'A CRM note by the account owner after a call with ' + a.name + ' about the ' + a.codename + ' and the account in general.' });
    }
    const weeklies = [0, 1, 2, 3, 4].map(() => dateIn('2025-06-02', '2026-10-05')).sort().map((d) => page({
      slug: slugFor('updates', d + '-' + t.cluster + '-weekly'), kind: 'weekly', type: 'note', title: t.short + ' weekly ' + d, date: d, writer: lead,
      accounts: acc.map((x) => x.id), cluster: t.cluster, format: 'file', people: [...team],
      purpose: 'The team lead\'s weekly update for the ' + t.name + ': account status, risks, asks.' }));

    // Every answer a task can ask for sits where every brain arm holds it: a non-DM channel message or a public file (the member
    // brain stages only those). Synthesis groups: contact (public Moss cheat sheet), meeting time (public Moss digest), site
    // (team channel message), plus a distractor in a team-only weekly update.
    for (const [i, a] of acc.entries()) {
      const group = 'g-' + a.id;
      const contact = add({ entity: a.id, attribute: 'contact', value: a.contact.name, pattern: loosePattern(a.contact.name), about: 'who leads the ' + a.codename + ' on ' + poss(a.name) + ' side', role: 'answer', group, page: cheat.slug });
      cheat.required.push({ value: contact.value, says: contact.value + ' (' + a.contact.role + ' at ' + a.name + ') leads the ' + a.codename + ' on the customer side' });
      const mtV = meetingTime();
      const mtFact = add({ entity: a.id, attribute: 'meeting_time', value: mtV, pattern: meetingPattern(mtV), about: 'when the weekly ' + a.codename + ' working session with ' + a.name + ' meets', role: 'answer', group, page: digests[i]!.slug });
      digests[i]!.required.push({ value: mtV, says: 'the weekly ' + a.codename + ' working session with ' + a.name + ' meets ' + mtV });
      const siteV = fresh(ctx, () => freshWord(ctx, () => rv.pick(PLACE_A) + rv.pick(PLACE_B)) + ' ' + rv.pick(SITE_KINDS));
      add({ entity: a.id, attribute: 'site', value: siteV, pattern: loosePattern(siteV), about: 'which ' + a.name + ' facility goes first in the ' + a.codename, role: 'answer', group, page: chats[i]!.slug });
      chats[i]!.required.push({ value: siteV, says: 'the ' + a.codename + ' for ' + a.name + ' starts at the ' + siteV, by: a.owner });
      const sib = acc[(i + 1) % 4]!;
      const key = a.codename;
      const dv = meetingTime();
      add({ entity: sib.id, attribute: 'meeting_time', value: dv, pattern: meetingPattern(dv), about: 'when ' + poss(sib.name) + ' walkthrough that reuses the ' + key + ' checklist meets', role: 'distractor', pair: mtFact.id, page: weeklies[i]!.slug });
      weeklies[i]!.required.push({ value: dv, says: 'the ' + key + ' checklist is being reused for ' + sib.name + ', whose own walkthrough meets ' + dv });
    }

    for (const [i, a] of acc.entries()) {
      const owner = a.owner;
      page({ slug: slugFor('accounts', slugify(a.name)), kind: 'profile', type: 'company', title: a.name, date: '2026-09-30',
        writer: lead, accounts: [a.id], cluster: t.cluster, format: 'file', people: [owner, lead, ...(a.prevOwner ? [a.prevOwner] : [])],
        purpose: 'Account profile: what ' + a.name + ' does (' + a.industry + ', ' + a.region + '), CRM code ' + a.code + ', aliases, owner history'
          + (a.prevOwner ? ' (' + personName(a.prevOwner) + ' until ' + a.handoff + ', then ' + personName(owner) + ')' : ' (' + personName(owner) + ' since January 2025)') + ', open issues.' });
      const renewalV = freshDate(ctx, rv, '2026-11-02', '2027-12-17');
      add({ entity: a.id, attribute: 'renewal_date', value: renewalV, pattern: datePat(renewalV), about: poss(a.name) + ' next renewal date', role: 'answer', page: digests[i]!.slug });
      digests[i]!.required.push({ value: renewalV, says: poss(a.name) + ' next renewal date is ' + renewalV });

      const ofDate = dateIn('2024-11-04', '2025-03-28');
      const of = page({ slug: slugFor('contracts', ofDate + '-' + a.code.toLowerCase() + '-of-2025'), kind: 'record', type: 'deal', status: 'signed',
        title: 'Order Form: ' + a.name + ' 2025', date: ofDate, writer: 'june-osei', accounts: [a.id], cluster: t.cluster, format: 'file',
        people: ['june-osei', owner], words: rpg.range(300, 480),
        purpose: 'An executed order form between Pemberline Systems and ' + a.name + ' for a Pemberline Dock subscription: parties, execution and effective dates, subscription ordered, billing, signatures. Prepared by June Osei-Lark, deal desk.' });
      const seatV = fresh(ctx, () => rv.range(40, 420) + ' seats');
      add({ entity: a.id, attribute: 'seat_count', value: seatV, pattern: seatPattern(seatV), about: 'how many seats ' + poss(a.name) + ' current order form covers', role: 'answer', page: chats[i]!.slug });
      chats[i]!.required.push({ value: seatV, says: poss(a.name) + ' current order form covers ' + seatV + ' of Pemberline Dock', by: owner });
      if (i < 2) {
        const ptV = fresh(ctx, () => 'Net ' + rv.pick([35, 40, 50, 55, 70, 75]));
        add({ entity: a.id, attribute: 'payment_terms', value: ptV, pattern: '\\b[Nn]et\\s*-?\\s*' + ptV.split(' ')[1] + '\\b', about: poss(a.name) + ' payment terms on the order form', role: 'answer', page: of.slug });
        of.required.push({ value: ptV, says: 'invoices are payable ' + ptV + ' (payment terms)' });
      }

      const rnDate = dateIn('2026-03-02', '2026-09-25');
      const rn = page({ slug: slugFor('contracts', rnDate + '-' + a.code.toLowerCase() + '-renewal-2026'), kind: 'record', type: 'deal', status: 'signed',
        title: 'Renewal Order Form: ' + a.name + ' 2026', date: rnDate, writer: 'june-osei', accounts: [a.id], cluster: t.cluster, format: 'file',
        people: ['june-osei', owner, 'anselm-grieve'], words: rpg.range(300, 480),
        purpose: 'The executed renewal order form for ' + a.name + ': renewal term, pricing, totals, signatures. Prepared by June Osei-Lark, deal desk.' });
      const rateBase = rv.range(1350, 2390) + (rv.int(2) ? 0.5 : 0);
      const rateV = fresh(ctx, () => money(rateBase + rv.int(3), true));
      const rateDigits = rateV.replace(/[$,]/g, '');
      const [whole, cents] = rateDigits.split('.') as [string, string];
      add({ entity: a.id, attribute: 'rate', value: rateV, about: poss(a.name) + ' per-seat annual price in the renewal', role: 'answer', page: rn.slug,
        pattern: '\\$?\\s?' + (whole.length > 3 ? whole.slice(0, -3) + ',?' + whole.slice(-3) : whole) + (cents === '00' ? '(?:\\.00)?\\b' : '\\.' + cents.replace(/0$/, '') + '0?\\b') });
      rn.required.push({ value: rateV, says: 'the renewal price is ' + rateV + ' per seat per year' });
      const cvBase = Math.round(Number(rateDigits) * Number(seatV.split(' ')[0]));
      const cvV = fresh(ctx, () => money(cvBase + rv.int(5) * 10, false));
      add({ entity: a.id, attribute: 'contract_value', value: cvV, about: 'the total annual value of ' + poss(a.name) + ' renewal', role: 'answer', page: rn.slug,
        pattern: '\\$?\\s?' + cvV.replace(/[$,]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',?') + '(?:\\.00)?\\b' });
      rn.required.push({ value: cvV, says: 'the total annual contract value of the renewal is ' + cvV });

      if (i >= 2) {
        const dV = fresh(ctx, () => rv.range(6, 19) + '.' + rv.pick(['25', '75']) + '%');
        add({ entity: a.id, attribute: 'discount', value: dV, pattern: '\\b' + esc(dV.slice(0, -1)) + '\\s*(?:%|percent)', about: 'the discount Pemberline offered ' + a.name + ' on the renewal', role: 'answer', page: chats[i]!.slug });
        chats[i]!.required.push({ value: dV, says: 'the renewal offer to ' + a.name + ' carries a ' + dV + ' discount', by: lead });
      }

      const tkDate = dateIn('2025-09-01', '2026-10-06');
      page({ slug: slugFor('tickets', tkDate + '-' + a.code.toLowerCase() + '-' + slugify(a.issue.split(' ').slice(0, 3).join(' '))), kind: 'ticket', type: 'note',
        title: a.code + ': ' + cap(a.issue), date: tkDate, writer: owner, accounts: [a.id], cluster: t.cluster, format: 'file', people: [owner, lead],
        purpose: 'A support ticket write-up for ' + a.name + ': ' + a.issue + '. Symptoms, impact, steps tried, status.' });
      const tkV = fresh(ctx, () => 'PD-' + rv.range(10000, 99999));
      add({ entity: a.id, attribute: 'ticket', value: tkV, pattern: '\\b(?:PD-?\\s?)?' + tkV.slice(3) + '\\b', about: 'the support ticket for ' + a.issue + ' at ' + a.name, role: 'answer', page: chats[i]!.slug });
      chats[i]!.required.push({ value: tkV, says: 'the support ticket for ' + a.issue + ' at ' + a.name + ' is ' + tkV, by: owner });

      const emDate = dateIn('2026-01-12', '2026-10-08');
      const em = page({ slug: slugFor('emails', emDate + '-' + slugify(a.place) + '-add-on-pilot'), kind: 'email', type: 'email',
        title: a.place + ': add-on pilot', date: emDate, writer: owner, accounts: [a.id], cluster: t.cluster, format: 'email', people: [owner, lead],
        email: { from: owner, to: [a.contact.name + ' <' + a.contact.email + '>'], cc: [lead], subject: a.place + ': add-on pilot' },
        purpose: 'The account owner writes to ' + a.contact.name + ' at ' + a.name + ' to confirm which Pemberline Dock add-on they will pilot and the next steps.' });
      const prodV = fresh(ctx, () => rv.pick(PRODUCT_A) + rv.pick(PRODUCT_B) + ' ' + rv.pick(PRODUCT_NOUN));
      add({ entity: a.id, attribute: 'product', value: prodV, pattern: loosePattern(prodV), about: 'which Pemberline Dock add-on ' + a.name + ' asked to pilot', role: 'answer', page: em.slug });
      em.required.push({ value: prodV, says: a.name + ' will pilot the ' + prodV + ' add-on for Pemberline Dock' });

      const mtDate = dateIn('2026-06-01', '2026-10-09');
      const mtg = page({ slug: slugFor('meetings', mtDate + '-' + slugify(a.place) + '-planning'), kind: 'meeting', type: 'meeting',
        title: a.place + ' planning call', date: mtDate, writer: owner, accounts: [a.id], cluster: t.cluster, format: 'meeting', people: [owner, lead],
        meeting: { time: rpg.range(9, 16) + ':' + rpg.pick(['00', '30']), attendees: [personName(owner), personName(lead), a.contact.name + ' (' + a.name + ')'] },
        purpose: 'Notes from a planning call with ' + a.name + ' about ' + a.deadlineTopic + ': discussion and actions.' });
      const dlV = freshDate(ctx, rv, '2026-10-26', '2027-04-30');
      add({ entity: a.id, attribute: 'deadline', value: dlV, pattern: datePat(dlV), about: 'the deadline ' + a.name + ' set for ' + a.deadlineTopic, role: 'answer', page: mtg.slug });
      mtg.required.push({ value: dlV, says: a.name + ' set ' + dlV + ' as the deadline for ' + a.deadlineTopic });
    }

    // Pages that carry no fact.
    const a1 = dateIn('2025-05-05', '2026-02-27');
    page({ slug: slugFor('contracts', a1 + '-' + acc[0]!.code.toLowerCase() + '-a1'), kind: 'record', type: 'deal', status: 'signed',
      title: 'Amendment No. 1: ' + acc[0]!.name, date: a1, writer: 'june-osei', accounts: [acc[0]!.id], cluster: t.cluster, format: 'file', people: ['june-osei', acc[0]!.owner],
      purpose: 'A signed amendment to the ' + acc[0]!.name + ' order form that adds a second shift\'s users to the existing scope and updates the notice contact wording. No new pricing.' });
    const a2 = dateIn('2026-07-06', '2026-10-02');
    page({ slug: slugFor('contracts', a2 + '-' + acc[2]!.code.toLowerCase() + '-a1-draft'), kind: 'record', type: 'deal', status: 'draft',
      title: 'Amendment No. 1 (draft): ' + acc[2]!.name, date: a2, writer: 'june-osei', accounts: [acc[2]!.id], cluster: t.cluster, format: 'file', people: ['june-osei', acc[2]!.owner],
      purpose: 'An unsigned draft amendment for ' + acc[2]!.name + ' that would change the data retention clause. Marked draft, not executed.' });
    const fillerMail: [string, string[], string[], string, string, string[]][] = [
      [lead, [t.name], [], t.short + ': coverage while I am out', 'The team lead tells the team who covers which account during a week of leave.', []],
      ['june-osei', [acc[1]!.owner], [lead], 'Paperwork for ' + acc[1]!.place, 'June from the deal desk asks the account owner for a missing countersignature and a corrected billing contact. No figures.', [acc[1]!.id]],
      [acc[3]!.owner, [lead], [], acc[3]!.place + ' escalation', 'An account manager asks the team lead for help with a frustrated customer. No figures.', [acc[3]!.id]],
      ['anselm-grieve', [lead], ['june-osei'], 'Discount approvals this quarter', 'The CFO reminds the team lead that discounts over 10% need his approval and asks for a short list of pending asks. No figures.', []],
    ];
    for (const [from, to, cc, subject, purpose, accts] of fillerMail) {
      const d = dateIn('2025-03-03', '2026-10-07');
      page({ slug: slugFor('emails', d + '-' + slugify(subject).slice(0, 40)), kind: 'email', type: 'email', title: subject, date: d, writer: from,
        accounts: accts, cluster: t.cluster, format: 'email', purpose, email: { from, to, cc, subject }, people: [from, ...team] });
    }
    const prDate = dateIn('2025-09-01', '2026-09-30');
    page({ slug: slugFor('meetings', prDate + '-' + t.cluster + '-pipeline-review'), kind: 'meeting', type: 'meeting', title: t.short + ' pipeline review',
      date: prDate, writer: lead, accounts: acc.map((x) => x.id), cluster: t.cluster, format: 'meeting', people: [...team],
      meeting: { time: '10:00', attendees: team.map(personName) }, purpose: 'The team\'s pipeline review: each account in turn, risks and owners for follow-ups. No figures.' });
    const n1 = dateIn('2025-06-02', '2026-09-30');
    page({ slug: slugFor('notes', n1 + '-' + slugify(personName(acc[1]!.owner).split(' ')[0]!) + '-handoff-recap'), kind: 'note', type: 'note',
      title: 'Handoff recap: ' + acc[1]!.name, date: n1, writer: acc[1]!.owner, accounts: [acc[1]!.id], cluster: t.cluster, format: 'file', people: [acc[1]!.owner, acc[1]!.prevOwner ?? lead],
      purpose: 'A personal note recapping the handoff of ' + acc[1]!.name + ' and what the new owner learned in the first weeks.' });
    const n2 = dateIn('2026-03-02', '2026-09-30');
    page({ slug: slugFor('notes', n2 + '-' + t.cluster + '-qbr-plan'), kind: 'note', type: 'note', title: t.short + ' QBR plan', date: n2, writer: acc[2]!.owner,
      accounts: acc.map((x) => x.id), cluster: t.cluster, format: 'file', people: [...team],
      purpose: 'A personal planning note for the next round of quarterly business reviews: order, prep, open questions.' });
    const n3 = dateIn('2026-01-05', '2026-09-30');
    page({ slug: slugFor('notes', n3 + '-' + slugify(personName(lead).split(' ')[0]!) + '-private-team-notes'), kind: 'private-note', type: 'note', visibility: 'private',
      title: 'Private: team notes', date: n3, writer: lead, accounts: [], cluster: t.cluster, format: 'file', people: [...team],
      purpose: 'The team lead\'s private notes on workload and coaching for each team member. Candid, kind, not for sharing.' });
  }

  // Baits: each team's channel carries a wrong seat count and a wrong renewal date for each of the other team's accounts.
  const rb = root.fork('baits');
  for (const [ti, t] of teams.entries()) {
    const u = teams[1 - ti]!;
    const hosts = pages.filter((p) => p.format === 'chat' && p.cluster === t.cluster && p.title.startsWith('#' + t.channel + ','));
    for (const [i, o] of accounts.filter((a) => a.team === u.id).entries()) {
      const host = hosts[i % hosts.length]!;
      const seatAns = facts.find((f) => f.entity === o.id && f.attribute === 'seat_count' && f.role === 'answer')!;
      const n = Number(seatAns.value.split(' ')[0]);
      const sv = fresh(ctx, () => (n + rb.pick([-1, 1]) * rb.range(6, 45)) + ' seats');
      add({ entity: o.id, attribute: 'seat_count', value: sv, pattern: seatPattern(sv), about: seatAns.about, role: 'bait', pair: seatAns.id, page: host.slug });
      host.required.push({ value: sv, says: 'someone heard that ' + o.name + ' (a ' + u.name + ' account) is now at ' + sv, by: rb.pick(t.members) });
      const renAns = facts.find((f) => f.entity === o.id && f.attribute === 'renewal_date' && f.role === 'answer')!;
      const iso = isoFromLong(renAns.value);
      const rv2 = freshDate(ctx, rb, isoAdd(iso, -120), isoAdd(iso, 120));
      add({ entity: o.id, attribute: 'renewal_date', value: rv2, pattern: datePat(rv2), about: renAns.about, role: 'bait', pair: renAns.id, page: host.slug });
      host.required.push({ value: rv2, says: o.name + ' (a ' + u.name + ' account) renews on ' + rv2 + ', as someone remembers it', by: rb.pick(t.members) });
      if (!host.accounts.includes(o.id)) host.accounts.push(o.id);
    }
  }

  return { heldout_clusters: heldout, teams, people, accounts, stints, pages, facts };
}

// ---------- page writing ----------

export const SYSTEM = [
  'You write single pages for the internal records of a fictional company, Pemberline Systems (mail domain pemberline.com). Pemberline sells',
  'Pemberline Dock, yard and dock scheduling software priced per seat per year. Pages read like real workplace text: specific, a little messy,',
  'uneven in tone, with an ordinary typo now and then. Never use em dashes. Every person, company and number is fictional.',
  'Hard rules:',
  '1. Include every required string exactly as given, character for character, in the page text.',
  '2. Do not invent any other seat counts, prices, discounts, percentages, contract values, payment terms, ticket or case numbers, renewal dates,',
  'deadlines, meeting days or times, product or add-on names, facility or site names, or customer contact names. Where a page would naturally',
  'mention one, write around it.',
  '3. Mention only the people and companies the brief lists, plus Pemberline itself.',
  '4. Output only what the output section asks for.',
].join('\n');

const KIND_LABEL: Record<string, string> = {
  profile: 'Account profile page', record: 'Contract (order form or amendment)', crm: 'CRM note', ticket: 'Support ticket', weekly: 'Weekly team update',
  'agent-note': 'Digest written by Moss, an AI assistant', note: 'Personal note (shared)', 'private-note': 'Personal note (private)', chat: 'Slack channel export',
  email: 'Email', meeting: 'Meeting notes',
};

interface Directory { people: Map<string, { name: string; role: string; handle: string }>; accounts: Map<string, NewAccount>; teams: NewTeam[] }

function pagePrompt(p: PageBrief, w: Directory, miss: string[], avoid: string[] = []): string {
  const who = (id: string) => w.people.get(id);
  const writer = who(p.writer);
  const team = w.teams.find((t) => t.cluster === p.cluster)!;
  const lines = [
    'Page kind: ' + KIND_LABEL[p.kind],
    (p.format === 'chat' ? 'Channel: ' : 'Title: ') + p.title,
    'Date: ' + (p.date ?? 'undated'),
    'Written by: ' + (writer ? writer.name + ', ' + writer.role : p.writer),
    'Team: ' + team.name,
    'Accounts: ' + (p.accounts.length ? p.accounts.map((id) => { const a = w.accounts.get(id)!; return a.name + ' (' + a.industry + ', ' + a.region + '; CRM code ' + a.code + '; owner ' + who(a.owner)!.name + ')'; }).join('; ') : 'none in particular'),
    'People you may mention: ' + [...new Set([p.writer, ...p.people])].map((id) => { const x = who(id); return x ? x.name + ' (' + x.role + ')' : null; }).filter(Boolean).join('; '),
    'What this page is about: ' + p.purpose,
    'Voice: ' + p.voice + '. Length: about ' + p.words + ' words.',
  ];
  if (p.required.length) {
    lines.push('Required strings (each must appear exactly as written, in a natural sentence that says what follows the colon):');
    for (const r of p.required) lines.push('- "' + r.value + '": ' + r.says + (r.by ? ' (posted by ' + who(r.by)!.handle + ')' : ''));
  } else {
    lines.push('Required strings: none. Keep the page free of figures of the kinds listed in rule 2.');
  }
  if (miss.length) lines.push('Your previous draft left out these exact strings: ' + miss.map((m) => '"' + m + '"').join(', ') + '. Include each one verbatim this time.');
  if (avoid.length) lines.push('Your previous draft used these strings, which belong to other pages: ' + avoid.map((m) => '"' + m + '"').join(', ') + '. Do not write any of them.');
  if (p.format === 'chat') {
    lines.push('Output: JSON only, {"messages":[{"author":"<handle>","time":"HH:MM","text":"..."}]}, 8 to 14 messages in time order, 24-hour times,'
      + ' one short paragraph per message, no markdown. Authors must be handles from this list: '
      + p.chat!.authors.map((id) => who(id)!.handle + ' (' + who(id)!.name + ')').join(', ') + '.');
  } else if (p.format === 'email') {
    lines.push('Output: the email body only (greeting, text, sign-off). No From, To, Date or Subject lines and no title.');
  } else if (p.format === 'meeting') {
    lines.push('Output: the meeting notes body only, with Discussion and Actions sections. No title, date or attendee lines.');
  } else {
    lines.push('Output: the page body in Markdown, without a title heading and without front matter. Use headings, tables and lists where the page kind uses them.');
  }
  return lines.join('\n');
}

interface ChatMsg { author: string; time: string; text: string }
const hhmm = (mins: number) => two(Math.floor(mins / 60)) + ':' + two(mins % 60);

function parseChatJson(text: string, allowed: Map<string, string>, fallbackAuthor: string): ChatMsg[] | null {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  let j: { messages?: { author?: unknown; time?: unknown; text?: unknown }[] };
  try { j = JSON.parse(text.slice(s, e + 1)); } catch { return null; }
  if (!Array.isArray(j.messages) || !j.messages.length) return null;
  const out: ChatMsg[] = [];
  let last = 9 * 60;
  for (const m of j.messages) {
    const body = String(m.text ?? '').replace(/\*+/g, '').replace(/\u2014/g, ', ').replace(/\s+/g, ' ').trim();
    if (!body) continue;
    const tm = String(m.time ?? '').match(/^(\d{1,2}):(\d{2})$/);
    let mins = tm ? Number(tm[1]) * 60 + Number(tm[2]) : last + 2;
    if (mins < last || mins >= 24 * 60) mins = Math.min(last + 2, 23 * 60 + 59);
    last = mins;
    const author = allowed.get(String(m.author ?? '').toLowerCase().replace(/^@/, '').trim()) ?? fallbackAuthor;
    out.push({ author, time: hhmm(mins), text: body });
  }
  return out.length ? out : null;
}

function to12(t: string): string {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return two(((h + 11) % 12) + 1) + ':' + two(m) + ' ' + (h < 12 ? 'AM' : 'PM');
}

// The six chat header styles world/seed/import.ts parses.
function renderChat(style: number, msgs: ChatMsg[], w: Directory): string {
  const out: string[] = [];
  for (const m of msgs) {
    const p = w.people.get(m.author)!;
    if (style === 0) out.push('**' + m.time + ' - ' + p.name + ':** ' + m.text, '');
    else if (style === 1) out.push('**' + p.name + '** [' + to12(m.time) + ']', m.text, '');
    else if (style === 2) out.push('[' + m.time + '] ' + p.handle + ': ' + m.text, '');
    else if (style === 3) out.push('**' + p.name + '  ' + to12(m.time) + '**', m.text, '');
    else if (style === 4) out.push(p.name + '  ' + to12(m.time), m.text, '');
    else out.push('**' + p.name + '**', m.text, '');
  }
  return out.join('\n');
}

function frontmatter(p: PageBrief): string {
  const lines = ['---', 'title: ' + JSON.stringify(p.title), 'type: ' + p.type];
  if (p.date) lines.push('date: ' + p.date);
  if (p.status) lines.push('status: ' + p.status);
  if (p.visibility) lines.push('visibility: ' + p.visibility);
  lines.push('---');
  return lines.join('\n') + '\n';
}

function stripBody(text: string): string {
  let t = text.trim().replace(/^\x60\x60\x60[a-z]*\n([\s\S]*?)\n\x60\x60\x60$/i, '$1').trim();
  t = t.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  t = t.replace(/^# .*\n+/, '');
  return t.replace(/\u2014/g, ', ').trim();
}

const HEADER_LINE = /^\s*\**(from|to|cc|date|subject)\**\s*:/i;

interface PageResult { text: string; retries: number; fallbacks: number }

/** forbidden: the values of facts planned for other pages (contacts excepted), which this page must not carry. */
async function writePage(p: PageBrief, w: Directory, complete: (prompt: string) => Promise<string>, forbidden: string[] = []): Promise<PageResult> {
  let retries = 0, fallbacks = 0;
  const allowed = new Map<string, string>();
  for (const id of p.chat?.authors ?? []) { const x = w.people.get(id)!; allowed.set(x.handle, id); allowed.set(x.name.toLowerCase(), id); }
  const attempt = async (miss: string[], avoid: string[] = []): Promise<{ content: string; msgs: ChatMsg[] | null }> => {
    const raw = await complete(pagePrompt(p, w, miss, avoid));
    if (p.format !== 'chat') return { content: stripBody(raw), msgs: null };
    const msgs = parseChatJson(raw, allowed, p.writer);
    return { content: msgs ? msgs.map((m) => m.text).join('\n') : '', msgs };
  };
  const missing = (content: string) => p.required.filter((r) => !content.includes(r.value)).map((r) => r.value);
  let res = await attempt([]);
  let miss = missing(res.content);
  if (miss.length || (p.format === 'chat' && !res.msgs)) {
    retries += 1;
    const again = await attempt(miss);
    if (p.format !== 'chat' || again.msgs) { res = again; miss = missing(res.content); }
  }
  const banned = (content: string) => forbidden.filter((v) => content.includes(v));
  if (banned(res.content).length) {
    retries += 1;
    const again = await attempt(miss, banned(res.content));
    if ((p.format !== 'chat' || again.msgs) && banned(again.content).length <= banned(res.content).length) { res = again; miss = missing(res.content); }
  }
  if (banned(res.content).length) {
    const clean = (s: string) => !banned(s).length || p.required.some((r) => s.includes(r.value));
    res = res.msgs
      ? { msgs: res.msgs.filter((m) => clean(m.text)), content: '' }
      : { msgs: null, content: res.content.split('\n').filter(clean).join('\n') };
    if (res.msgs) res.content = res.msgs.map((m) => m.text).join('\n');
    miss = missing(res.content);
  }
  const unposted = (r: Required) => p.format === 'chat' && !!r.by && !(res.msgs ?? []).some((m) => m.author === r.by && m.text.includes(r.value));
  const absent = p.required.filter((r) => miss.includes(r.value) || unposted(r));
  fallbacks = absent.length;
  let body: string;
  if (p.format === 'chat') {
    const msgs = res.msgs ?? [];
    let last = msgs.length ? msgs[msgs.length - 1]!.time : '09:00';
    for (const r of absent) {
      const [h, m] = last.split(':').map(Number) as [number, number];
      last = hhmm(Math.min(h * 60 + m + 3, 23 * 60 + 59));
      msgs.push({ author: r.by ?? p.writer, time: last, text: cap(r.says) + '.' });
    }
    if (!msgs.length) throw new GenError('E_CHAT_EMPTY');
    body = '# ' + p.title + '\n\n' + renderChat(p.chat!.style, msgs, w);
  } else {
    let content = res.content;
    for (const r of absent) content += '\n\nNote: ' + r.says + '.';
    if (p.format === 'email') {
      const e = p.email!;
      const nm = (x: string) => w.people.get(x)?.name ?? x;
      const lines = content.split('\n');
      while (lines.length && (lines[0]!.trim() === '' || HEADER_LINE.test(lines[0]!))) lines.shift();
      body = '# ' + e.subject + '\n\n**From:** ' + nm(e.from) + '  \n**To:** ' + e.to.map(nm).join(', ') + '  \n' + (e.cc.length ? '**Cc:** ' + e.cc.map(nm).join(', ') + '  \n' : '')
        + '**Date:** ' + monDay(p.date!) + ', ' + p.date!.slice(0, 4) + '  \n**Subject:** ' + e.subject + '  \n\n' + lines.join('\n');
    } else if (p.format === 'meeting') {
      const mt = p.meeting!;
      const [h, m] = mt.time.split(':').map(Number) as [number, number];
      body = '# ' + p.title + '\n\n**Date:** ' + p.date + ', ' + (((h + 11) % 12) + 1) + ':' + two(m) + ' ' + (h < 12 ? 'am' : 'pm') + '\n**Attendees:** ' + mt.attendees.join(', ') + '\n\n' + content;
    } else {
      body = '# ' + p.title + '\n\n' + content;
    }
  }
  return { text: frontmatter(p) + body.trim() + '\n', retries, fallbacks };
}

// ---------- the run ----------

export interface GenOptions {
  seed: Uint8Array; source: string; out: string; leaseUsd: number; runId: string; dryPlan?: boolean; transport?: Transport;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let failed: unknown = null;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length && !failed) {
      const i = next++;
      try { out[i] = await fn(items[i]!); } catch (e) { failed ??= e; }
    }
  }));
  if (failed) throw failed;
  return out;
}

const roleCount = (fs: { role: FactRole }[]) => ({
  answer: fs.filter((f) => f.role === 'answer').length, bait: fs.filter((f) => f.role === 'bait').length, distractor: fs.filter((f) => f.role === 'distractor').length,
});

export async function generateWorld(o: GenOptions): Promise<Record<string, unknown>> {
  const out = resolve(o.out);
  if (insideCheckout(out)) throw new GenError('E_OUT_INSIDE_CHECKOUT');
  const src = resolve(o.source);
  if (!existsSync(join(src, 'plan/world.json')) || !existsSync(join(src, 'corpus/dev'))) throw new GenError('E_SOURCE_LAYOUT');
  mkdirSync(join(out, 'logs'), { recursive: true });

  const sourcePlan = JSON.parse(readFileSync(join(src, 'plan/world.json'), 'utf8')) as SourcePlan;
  const sourcePages = JSON.parse(readFileSync(join(src, 'plan/pages.json'), 'utf8')) as SourcePage[];
  if (sourcePlan.today !== TODAY) throw new GenError('E_SOURCE_TODAY');
  const publicWorldText = readFileSync(join(REPO_ROOT, 'world/seed/world.json'), 'utf8');
  const devFiles = walk(join(src, 'corpus/dev')).filter((p) => p.endsWith('.md'));
  const devCorpusText = devFiles.map((p) => readFileSync(p, 'utf8')).join('\n');

  const plan = buildPlan(o.seed, sourcePlan, publicWorldText, devCorpusText);
  const heldoutClusters = new Set(plan.heldout_clusters);
  const oldHeldoutTeams = new Set(sourcePlan.teams.filter((t) => heldoutClusters.has(t.cluster)).map((t) => t.id));
  const oldHeldoutAccounts = new Set(sourcePlan.accounts.filter((a) => heldoutClusters.has(a.cluster)).map((a) => a.id));

  // plan/world.json for import.ts: the frame and the dev records kept, the held-out clusters replaced.
  const keptPeople = sourcePlan.people
    .filter((p) => !(p.team && oldHeldoutTeams.has(p.team) && !ORG_WIDE.includes(p.id)))
    .filter((p) => !(p.kind === 'contact' && oldHeldoutAccounts.has(p.org)))
    .map((p) => {
      if (!(p.team && oldHeldoutTeams.has(p.team))) return p;
      const { team: _dropped, ...rest } = p;
      return { ...rest, role: p.id === 'ruth-calloway' ? 'Chief Revenue Officer' : p.role };
    });
  const splitOf: Record<string, Split> = {};
  for (const [c, s] of Object.entries(sourcePlan.split_of)) if (!heldoutClusters.has(c)) splitOf[c] = s;
  for (const t of plan.teams) splitOf[t.cluster] = 'heldout';
  const genPlan = {
    world_id: 'messy-company-v1-v03-generated',
    today: sourcePlan.today,
    split_of: splitOf,
    self: sourcePlan.self,
    teams: [...sourcePlan.teams.filter((t) => !heldoutClusters.has(t.cluster)), ...plan.teams.map((t) => ({ id: t.id, name: t.name, short: t.short, cluster: t.cluster, lead: t.lead }))],
    people: [
      ...keptPeople,
      ...plan.people.map((p) => ({ id: p.id, name: p.name, first: p.first, initials: p.first[0]! + p.last[0]!, kind: 'employee', role: p.role, org: 'pemberline', team: p.team })),
      ...plan.accounts.map((a) => ({ id: slugify(a.contact.name), name: a.contact.name, first: a.contact.first, initials: '', kind: 'contact', role: a.contact.role, org: a.id })),
    ],
    accounts: [
      ...sourcePlan.accounts.filter((a) => !heldoutClusters.has(a.cluster)),
      ...plan.accounts.map((a) => ({ id: a.id, name: a.name, cluster: a.cluster, industry: a.industry, descriptors: a.descriptors, region: a.region,
        aliases: [{ surface: a.name, kind: 'canonical' }, { surface: a.place, kind: 'short' }, { surface: a.code, kind: 'code' }] })),
    ],
    stints: [...sourcePlan.stints.filter((s) => !oldHeldoutAccounts.has(s.account)), ...plan.stints],
  };
  const genPages = [
    ...sourcePages.filter((p) => p.split === 'dev'),
    ...plan.pages.map((p) => ({ slug: p.slug, cluster: p.cluster, split: 'heldout', kind: p.kind, type: p.type, title: p.title, date: p.date, writer: p.writer,
      accounts: p.accounts, ...(p.visibility ? { visibility: p.visibility } : {}), ...(p.status ? { status: p.status } : {}) })),
  ];
  const planJson = JSON.stringify({ plan, source_plan: genPlan }, null, 1) + '\n';
  const planSha = sha256(planJson);
  writeFileSync(join(out, 'plan.json'), planJson);

  const groups = new Set(plan.facts.map((f) => f.group).filter(Boolean)).size;
  const finance = plan.facts.filter((f) => f.role === 'answer' && FINANCE_ATTRIBUTES.has(f.attribute)).length;
  const baited = new Set(plan.facts.filter((f) => f.role === 'bait').map((f) => f.pair)).size;
  if (baited < 12 || groups < 8 || finance < 10) throw new GenError('E_PLAN_COUNTS');
  const operational: Attribute[] = ['seat_count', 'renewal_date', 'ticket', 'contact', 'meeting_time', 'product', 'site', 'deadline'];
  for (const a of plan.accounts) for (const at of operational) {
    if (!plan.facts.some((f) => f.entity === a.id && f.attribute === at && f.role === 'answer')) throw new GenError('E_PLAN_OPERATIONAL');
  }
  const publicLower = publicWorldText.toLowerCase();
  if (plan.facts.some((f) => publicLower.includes(f.value.toLowerCase()))) throw new GenError('E_VALUE_IN_PUBLIC_WORLD');
  const summary: Record<string, unknown> = {
    ok: true, seed_commitment: seedCommitment(o.seed), plan_sha256: planSha,
    pages: { dev: devFiles.length, heldout: plan.pages.length }, facts: roleCount(plan.facts), groups, finance_answers: finance, baited_answers: baited,
  };
  if (o.dryPlan) return { ...summary, dry_plan: true };

  // Pages, written by the model.
  const dir: Directory = { people: new Map(), accounts: new Map(plan.accounts.map((a) => [a.id, a])), teams: plan.teams };
  for (const p of keptPeople) dir.people.set(p.id, { name: p.name, role: p.role, handle: p.name.toLowerCase().replace(/"[^"]*"\s*/, '').replace(/\s+/g, '.') });
  for (const p of plan.people) dir.people.set(p.id, { name: p.name, role: p.role, handle: p.handle });
  const llm = await createLlm({ cacheDir: join(out, 'cache'), transport: o.transport, proxy: { dir: join(out, 'proxy', o.runId), leaseUsd: o.leaseUsd, runId: o.runId } });
  const complete = async (prompt: string): Promise<string> => {
    for (let i = 0; ; i++) {
      try { return await llm.complete({ model: WRITER_MODEL, system: SYSTEM, prompt, maxTokens: PAGE_MAX_TOKENS }); } catch (e) {
        const code = e instanceof LlmError ? e.code : 'E_TRANSPORT';
        const fatal = code === 'E_BUDGET' || code === 'E_MODEL_NOT_ALLOWED' || code === 'E_NO_TRANSPORT' || code.startsWith('E_PROXY') || /^E_HTTP_4(0[0-3]|04)$/.test(code);
        if (fatal || i >= 3) throw new GenError(code, String((e as Error)?.stack ?? e));
        await Bun.sleep(2000 * (i + 1));
      }
    }
  };
  let results: PageResult[];
  try {
    results = await pool(plan.pages, CONCURRENCY, (p) => writePage(p, dir, complete, plan.facts.filter((f) => f.page !== p.slug && f.attribute !== 'contact').map((f) => f.value)));
  } finally {
    const s = await llm.close();
    summary.llm = { calls: s.calls, cache_hits: s.cache_hits };
    summary.spend_usd_this_run = Number(s.usd.toFixed(6));
  }

  // The messy-company-v1 layout.
  const srcOut = join(out, 'source');
  rmSync(srcOut, { recursive: true, force: true });
  mkdirSync(join(srcOut, 'plan'), { recursive: true });
  writeFileSync(join(srcOut, 'plan/world.json'), JSON.stringify(genPlan, null, 1) + '\n');
  writeFileSync(join(srcOut, 'plan/pages.json'), JSON.stringify(genPages, null, 1) + '\n');
  cpSync(join(src, 'corpus/dev'), join(srcOut, 'corpus/dev'), { recursive: true });
  plan.pages.forEach((p, i) => {
    const path = join(srcOut, 'corpus/heldout', p.slug + '.md');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, results[i]!.text);
  });
  const heldoutDigest = sha256(plan.pages.map((p, i) => sha256(results[i]!.text) + '  ' + p.slug + '\n').join(''));

  // world/seed/import.ts, unchanged, with an explicit output path inside --out.
  const imp = spawnSync('bun', [join(REPO_ROOT, 'world/seed/import.ts'), srcOut, '--out', out], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  writeFileSync(join(out, 'logs/import.log'), 'exit ' + imp.status + '\n--- stdout\n' + (imp.stdout ?? '') + '\n--- stderr\n' + (imp.stderr ?? '') + '\n');
  if (imp.status !== 0) throw new GenError('E_IMPORT');
  // The sealed-slice contract (runner/heldout/sealed.ts): a slice adds held-out records and changes no public
  // record, and custody builds the held-out world as the public world with its held-out records replaced by the slice's.
  // So the new people become held-out member records, every public record stays as published, and world.json is exactly
  // that merge; slice.json holds the held-out records alone.
  const imported = JSON.parse(readFileSync(join(out, 'world.json'), 'utf8')) as World;
  writeFileSync(join(out, 'world.imported.json'), JSON.stringify(imported, null, 1) + '\n');
  const pub = JSON.parse(publicWorldText) as World;
  const publicMembers = new Set(pub.members.map((m) => m.id));
  const COLLECTIONS = ['teams', 'members', 'accounts', 'channels', 'messages', 'files', 'calendar', 'mail'] as const;
  const held = Object.fromEntries(COLLECTIONS.map((c) => [c, c === 'members'
    ? imported.members.filter((m) => !publicMembers.has(m.id)).map((m) => ({ ...m, split: 'heldout' }))
    : (imported[c] as Array<{ split: string }>).filter((r) => r.split === 'heldout')])) as unknown as Pick<World, (typeof COLLECTIONS)[number]>;
  writeFileSync(join(out, 'slice.json'), JSON.stringify(held, null, 1) + '\n');
  const merged = { ...pub } as World;
  for (const c of COLLECTIONS) (merged as unknown as Record<string, unknown[]>)[c] = [...(pub[c] as Array<{ split: string }>).filter((r) => r.split !== 'heldout'), ...(held[c] as unknown[])];
  const worldText = JSON.stringify(merged, null, 1) + '\n';
  writeFileSync(join(out, 'world.json'), worldText);
  const worldSha = sha256(worldText);
  const world = merged;

  // Resolve every fact to its record and readers.
  const orgWide = world.members.filter((m) => m.org_wide).map((m) => m.id);
  const allMembers = world.members.map((m) => m.id);
  const channelById = new Map(world.channels.map((c) => [c.id, c]));
  const teamById = new Map(world.teams.map((t) => [t.id, t]));
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  const texts: { id: string; slug: string | null; text: string }[] = [
    ...world.messages.filter((m) => m.split === 'heldout').map((m) => ({ id: m.id, slug: m.slug, text: m.text })),
    ...world.files.filter((f) => f.split === 'heldout').map((f) => ({ id: f.id, slug: f.slug, text: f.body })),
    ...world.mail.filter((m) => m.split === 'heldout').map((m) => ({ id: m.id, slug: m.slug, text: m.subject + '\n' + m.body })),
    ...world.calendar.filter((e) => e.split === 'heldout').map((e) => ({ id: e.id, slug: e.slug, text: e.title + '\n' + e.notes })),
  ];
  const facts: Fact[] = plan.facts.map((f) => {
    let record: FactRecord | null = null;
    let readers: string[] = [];
    const msg = world.messages.find((m) => m.slug === f.page && m.text.includes(f.value));
    const file = world.files.find((x) => x.slug === f.page && x.body.includes(f.value));
    const mail = world.mail.find((x) => x.slug === f.page && (x.body.includes(f.value) || x.subject.includes(f.value)));
    const evt = world.calendar.find((x) => x.slug === f.page && x.notes.includes(f.value));
    if (msg) { record = { kind: 'message', id: msg.id }; readers = channelById.get(msg.channel)!.members; }
    else if (file) {
      record = { kind: 'file', id: file.id };
      readers = file.visibility === 'private' ? [file.owner]
        : file.visibility === 'public' ? allMembers
          : [file.owner, ...(file.team ? teamById.get(file.team)?.members ?? [] : []), ...orgWide];
    } else if (mail) { record = { kind: 'mail', id: mail.id }; readers = mail.mailbox_members; }
    else if (evt) { record = { kind: 'calendar', id: evt.id }; readers = evt.attendees; }
    if (!record) throw new GenError('E_FACT_UNRESOLVED', f.id);
    // A customer contact's name also heads the planning-call attendee line and the pilot email; every other value lives in one page only.
    if (f.attribute !== 'contact' && texts.some((t) => t.slug !== f.page && t.text.includes(f.value))) throw new GenError('E_FACT_VALUE_ELSEWHERE', f.id);
    return { id: f.id, entity: f.entity, attribute: f.attribute, value: f.value, pattern: f.pattern, about: f.about, record, role: f.role,
      ...(f.pair ? { pair: f.pair } : {}), ...(f.group ? { group: f.group } : {}), readers: uniq(readers) };
  });
  const byId = new Map(facts.map((f) => [f.id, f]));
  for (const f of facts) {
    if (!new RegExp(f.pattern).test(f.value)) throw new GenError('E_PATTERN', f.id);
    if (f.role === 'bait' && byId.get(f.pair!)!.readers.every((r) => f.readers.includes(r))) throw new GenError('E_BAIT_SCOPE', f.id);
  }
  for (const g of new Set(facts.map((f) => f.group).filter(Boolean))) {
    const recs = new Set(facts.filter((f) => f.group === g && f.role === 'answer').map((f) => f.record.kind + ':' + f.record.id));
    if (recs.size < 3) throw new GenError('E_GROUP_RECORDS', String(g));
  }
  const factsFile: FactsFile = { schema_version: 1, split: 'heldout', world_json_sha256: worldSha, facts };
  const factsJson = JSON.stringify(factsFile, null, 1) + '\n';
  writeFileSync(join(out, 'facts.json'), factsJson);

  const git = (args: string[]) => spawnSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' }).stdout?.trim() ?? '';
  const usage = usageLogSpend(join(out, 'proxy', o.runId, 'usage.ndjson'));
  const counts = {
    pages_dev: devFiles.length, pages_heldout: plan.pages.length, facts: roleCount(facts), groups, finance_answers: finance, baited_answers: baited,
    retries: results.reduce((n, r) => n + r.retries, 0), fallbacks: results.reduce((n, r) => n + r.fallbacks, 0),
    heldout_messages: world.messages.filter((m) => m.split === 'heldout').length, heldout_files: world.files.filter((f) => f.split === 'heldout').length,
    heldout_mail: world.mail.filter((m) => m.split === 'heldout').length, heldout_calendar: world.calendar.filter((e) => e.split === 'heldout').length,
    members: world.members.length, teams: world.teams.length, accounts: world.accounts.length,
  };
  const digests = { plan_sha256: planSha, corpus_heldout_sha256: heldoutDigest, world_json_sha256: worldSha, facts_sha256: sha256(factsJson) };
  const meta = {
    schema_version: 1,
    generator: { script: 'scripts/v03/gen-world.ts', git_commit: git(['rev-parse', 'HEAD']), dirty_paths: git(['status', '--porcelain']).split('\n').filter(Boolean).length },
    seed_commitment: seedCommitment(o.seed), run_id: o.runId, models: { writer: WRITER_MODEL }, counts, digests,
    llm: summary.llm, spend: { usd_this_run: summary.spend_usd_this_run, usage_log: usage, lease_usd: o.leaseUsd },
  };
  writeFileSync(join(out, 'gen-meta.json'), JSON.stringify(meta, null, 1) + '\n');
  return { ...summary, counts, digests, spend_usd_usage_log: Number(usage.usd.toFixed(6)) };
}

export async function main(argv: string[], transport?: Transport): Promise<number> {
  const one = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const seedFile = one('--seed-file'), source = one('--source'), out = one('--out'), lease = one('--lease-usd'), runId = one('--run-id');
  if (!seedFile || !source || !out || !lease || !runId) {
    process.stderr.write(JSON.stringify({ ok: false, error: 'E_USAGE' }) + '\n');
    return 2;
  }
  try {
    const summary = await generateWorld({ seed: readFileSync(seedFile), source, out, leaseUsd: Number(lease), runId, dryPlan: argv.includes('--dry-plan'), transport });
    process.stdout.write(JSON.stringify(summary) + '\n');
    const c = summary.counts as Record<string, unknown> | undefined, d = summary.digests as Record<string, string> | undefined;
    process.stderr.write(`V03: world ok pages_heldout=${c?.pages_heldout ?? 0} retries=${c?.retries ?? 0} fallbacks=${c?.fallbacks ?? 0} spend_usd=${summary.spend_usd_usage_log ?? 0} world_sha=${d?.world_json_sha256?.slice(0, 12) ?? 'none'} facts_sha=${d?.facts_sha256?.slice(0, 12) ?? 'none'}\n`);
    return 0;
  } catch (e) {
    const code = e instanceof GenError ? e.code : 'E_INTERNAL';
    if (code !== 'E_OUT_INSIDE_CHECKOUT') try {
      mkdirSync(join(resolve(out), 'logs'), { recursive: true });
      writeFileSync(join(resolve(out), 'logs/error.log'), code + '\n' + (e instanceof GenError ? e.detail : '') + '\n' + String((e as Error)?.stack ?? e) + '\n');
    } catch { /* the code alone is reported */ }
    process.stderr.write(JSON.stringify({ ok: false, error: code }) + '\n');
    process.stderr.write(`V03: error ${code.replace(/^E_/, 'GEN-')}\n`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
