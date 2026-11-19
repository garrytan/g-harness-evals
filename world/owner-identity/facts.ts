// Planted-fact sentence templates and the per-task fact ledger. Every fact carries one token; its gold roles (claimant,
// utterer, reporter, subject) and its scoring class follow the contract in the HARN-116 generator spec.

import type { Rng } from '../brain/names.ts';
import type { Person } from './people.ts';
import type { TokenPool } from './tokens.ts';

export const HARD_CASES = [
  'owner_quoted_by_other', 'owner_quotes_other', 'owner_aliases', 'forwarded_email', 'assistant_on_behalf', 'group_chat',
  'swapped_or_anonymous_labels', 'similar_name_decoy', 'me_contact_decoy', 'assistant_model_says_I', 'agent_brief_in_user_seat', 'control',
] as const;
export type HardCase = (typeof HARD_CASES)[number];

export interface Who { s: string; p: string }

interface Template { key: string; commit: boolean; first: (t: string) => string; third: (w: Who, t: string) => string; qOwner: string; qOther: (n: string) => string }

const T = (key: string, commit: boolean, first: Template['first'], third: Template['third'], qOwner: string, qOther: Template['qOther']): Template => ({ key, commit, first, third, qOwner, qOther });

export const TEMPLATES: Template[] = [
  T('gym', false, (t) => `my climbing gym is ${t} Works`, (w, t) => `${w.p} climbing gym is ${t} Works`, 'Which climbing gym do I use?', (n) => `Which climbing gym does ${n} use?`),
  T('deck', true, (t) => `I'll send the ${t} deck on Friday`, (w, t) => `${w.s} will send the ${t} deck on Friday`, 'Which deck did I commit to sending?', (n) => `Which deck did ${n} commit to sending?`),
  T('coffee', false, (t) => `my usual coffee order is the ${t} roast`, (w, t) => `${w.p} usual coffee order is the ${t} roast`, 'What is my usual coffee order?', (n) => `What is ${n}'s usual coffee order?`),
  T('move', false, (t) => `I'm moving to ${t} Heights next month`, (w, t) => `${w.s} will move to ${t} Heights next month`, 'Where am I moving next month?', (n) => `Where is ${n} moving next month?`),
  T('bike', false, (t) => `my bike is a ${t} roadster`, (w, t) => `${w.p} bike is a ${t} roadster`, 'What kind of bike do I ride?', (n) => `What kind of bike does ${n} ride?`),
  T('trip', false, (t) => `I'm going to ${t} Lake in June`, (w, t) => `${w.s} will go to ${t} Lake in June`, 'Where am I going in June?', (n) => `Where is ${n} going in June?`),
  T('review', true, (t) => `I'll review the ${t} proposal by Tuesday`, (w, t) => `${w.s} will review the ${t} proposal by Tuesday`, 'Which proposal did I promise to review?', (n) => `Which proposal did ${n} promise to review?`),
  T('lunch', false, (t) => `my favorite lunch spot is ${t} Kitchen`, (w, t) => `${w.p} favorite lunch spot is ${t} Kitchen`, 'Where is my favorite lunch spot?', (n) => `Where is ${n}'s favorite lunch spot?`),
  T('dog', false, (t) => `my dog is called ${t}`, (w, t) => `${w.p} dog is called ${t}`, 'What is my dog called?', (n) => `What is ${n}'s dog called?`),
  T('dentist', false, (t) => `my dentist is at ${t} Clinic`, (w, t) => `${w.p} dentist is at ${t} Clinic`, 'Where is my dentist?', (n) => `Where is ${n}'s dentist?`),
  T('pottery', false, (t) => `I signed up for the ${t} pottery class`, (w, t) => `${w.s} signed up for the ${t} pottery class`, 'Which pottery class did I sign up for?', (n) => `Which pottery class did ${n} sign up for?`),
  T('venue', true, (t) => `I'll book ${t} Hall for the offsite`, (w, t) => `${w.s} will book ${t} Hall for the offsite`, 'Which venue did I commit to booking?', (n) => `Which venue did ${n} commit to booking?`),
  T('race', true, (t) => `I'll run the ${t} half marathon in April`, (w, t) => `${w.s} will run the ${t} half marathon in April`, 'Which race did I commit to running?', (n) => `Which race did ${n} commit to running?`),
  T('car', false, (t) => `my car is a ${t} hatchback`, (w, t) => `${w.p} car is a ${t} hatchback`, 'What car do I drive?', (n) => `What car does ${n} drive?`),
  T('bookclub', false, (t) => `my book club is reading ${t} next`, (w, t) => `${w.p} book club is reading ${t} next`, 'What is my book club reading next?', (n) => `What is ${n}'s book club reading next?`),
  T('storage', false, (t) => `my storage unit is at ${t} Depot`, (w, t) => `${w.p} storage unit is at ${t} Depot`, 'Where is my storage unit?', (n) => `Where is ${n}'s storage unit?`),
  T('tea', false, (t) => `my go-to tea is ${t} Blend`, (w, t) => `${w.p} go-to tea is ${t} Blend`, 'What is my go-to tea?', (n) => `What is ${n}'s go-to tea?`),
  T('intro', true, (t) => `I'll set up the intro call with ${t} Partners next week`, (w, t) => `${w.s} will set up the intro call with ${t} Partners next week`, 'Which intro call did I commit to setting up?', (n) => `Which intro call did ${n} commit to setting up?`),
];

const AI_TEMPLATES = [
  (t: string) => `I'll name the new module ${t} unless you object`,
  (t: string) => `I prefer the ${t} layout for the settings page`,
  (t: string) => `I'll keep a running checklist in the ${t} file`,
  (t: string) => `my suggestion is to call the release branch ${t}`,
];

export type Primary = 'owner_recall' | 'false_owner' | 'secondary';

export interface Fact {
  id: string;
  token: string;
  claimant: string;
  utterer: string;
  reporter: string | null;
  subject: string;
  hard_case: HardCase;
  primary: Primary;
  correct_surface: string;
  where: { file: string; line: number } | { turn: number };
  text: string;
  tpl: string;
  commit: boolean;
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const THEY: Who = { s: 'they', p: 'their' };
export const named = (n: string): Who => ({ s: n, p: `${n}'s` });

export class FactLedger {
  readonly facts: Fact[] = [];
  private used = new Set<string>();
  private ownerCount = 0;

  constructor(private readonly r: Rng, private readonly pool: TokenPool, readonly owner: Person) {}

  private tpl(want?: boolean): Template {
    const free = TEMPLATES.filter((t) => !this.used.has(t.key) && (want === undefined || t.commit === want));
    const t = this.r.pick(free);
    this.used.add(t.key);
    return t;
  }

  private add(f: Omit<Fact, 'id' | 'where'>): Fact {
    const fact = { id: `f${this.facts.length + 1}`, where: { file: '', line: 0 }, ...f } as Fact;
    this.facts.push(fact);
    return fact;
  }

  private surface = (id: string) => (id === this.owner.id ? 'owner' : id.startsWith('agent:') ? 'not_owner' : `person:${id}`);

  own(p: Person, hc: HardCase, lower = false): string {
    const isOwner = p.id === this.owner.id;
    const t = this.tpl(isOwner ? (this.ownerCount === 0 ? true : this.ownerCount === 1 ? false : undefined) : undefined);
    if (isOwner) this.ownerCount++;
    const token = this.pool.next();
    const text = (lower ? t.first(token) : cap(t.first(token))) + '.';
    this.add({ token, claimant: p.id, utterer: p.id, reporter: null, subject: p.id, hard_case: hc, primary: isOwner ? 'owner_recall' : 'false_owner', correct_surface: this.surface(p.id), text, tpl: t.key, commit: t.commit });
    return text;
  }

  relay(by: Person, about: Person, hc: HardCase, frame: (third: (w: Who) => string) => string, reporter: string | null = by.id): string {
    const t = this.tpl(about.id === this.owner.id ? false : undefined);
    const token = this.pool.next();
    const text = frame((w) => t.third(w, token));
    const isOwner = about.id === this.owner.id;
    this.add({ token, claimant: about.id, utterer: by.id, reporter, subject: about.id, hard_case: hc, primary: isOwner ? 'secondary' : 'false_owner', correct_surface: this.surface(about.id), text, tpl: t.key, commit: t.commit });
    return text;
  }

  agent(label: string, hc: HardCase, subject: string, kind: 'ai' | 'brief'): string {
    const token = this.pool.next();
    let text: string;
    let key = kind;
    if (kind === 'ai') text = cap(this.r.pick(AI_TEMPLATES)(token)) + '.';
    else { const t = this.tpl(); key = t.key as 'brief'; text = cap(t.third({ s: 'the user', p: "the user's" }, token)) + '.'; }
    this.add({ token, claimant: label, utterer: label, reporter: null, subject, hard_case: hc, primary: 'false_owner', correct_surface: 'not_owner', text, tpl: key, commit: false });
    return text;
  }

  template(key: string): Template { return TEMPLATES.find((t) => t.key === key)!; }
}
