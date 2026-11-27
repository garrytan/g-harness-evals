// The invented cast of the owner-identity world: one owner with several identities, about 14 contacts, and the decoys the
// plan names (a contact sharing the owner's first name with a near surname, a near-anagram nickname, a contact saved as "Me",
// an executive assistant). Names come from world/brain/names.ts's tables; phone numbers are 555-01xx; mail domains are
// example.com, example.org and example.net.

import { FIRST_NAMES, surname, type Rng } from '../brain/names.ts';
import { capitalise, isEnglish, pseudoWord } from './tokens.ts';
import { pad } from './formats/time.ts';

export type Role = 'owner' | 'assistant' | 'similar_name' | 'anagram_nickname' | 'me_contact' | 'contact';

export interface Person {
  id: string;
  name: string;
  first: string;
  last: string;
  nick: string | null;
  role: Role;
  role_in_story: string;
  emails: string[];
  phones: string[];
  e164: string[];
  slack: string;
  slack_id: string;
  telegram: string;
  imessage: string[];
  whatsapp_name: string;
  discord: string;
  signal_name: string;
  teams_name: string;
  aliases: string[];
}

export interface Cast {
  owner: Person;
  people: Person[];
  byRole: (role: Role) => Person;
  contacts: Person[];
}

const STORY = ['climbing partner', 'former colleague', 'neighbour', 'book club friend', 'side-project cofounder', 'college roommate', 'cousin', 'running coach', 'designer friend'];

const phone = (n: number, area: string) => ({ display: `+1 (${area}) 555-${pad(n, 4)}`, e164: `+1${area}555${pad(n, 4)}` });

function nearSurname(r: Rng, last: string): string {
  const vowels = [...last].map((c, i) => ('aeiou'.includes(c) ? i : -1)).filter((i) => i > 0);
  for (let tries = 0; tries < 20; tries++) {
    const i = r.pick(vowels);
    const v = r.pick(['a', 'e', 'i', 'o', 'u'].filter((x) => x !== last[i]));
    const out = last.slice(0, i) + v + last.slice(i + 1);
    if (out !== last && !isEnglish(out)) return out;
  }
  return last + 'e';
}

function nickname(r: Rng): string {
  for (;;) {
    const n = capitalise(pseudoWord(r, 2, false));
    if (n.length >= 4 && n.length <= 5 && !isEnglish(n) && /^[^aeiou][aeiou][^aeiou][aeiou]/i.test(n)) return n;
  }
}

const anagram = (n: string) => (n[2]!.toUpperCase() + n[1] + n[0]!.toLowerCase() + n.slice(3));

export function makeCast(r: Rng): Cast {
  const firsts = r.shuffle([...FIRST_NAMES]);
  const usedLast = new Set<string>();
  const freshLast = () => { for (;;) { const s = surname(r); if (!usedLast.has(s) && !isEnglish(s)) { usedLast.add(s); return s; } } };
  const ownerFirst = firsts[0]!;
  const ownerLast = freshLast();
  const ownerNick = nickname(r);
  let ph = 110;
  const roles: Array<{ role: Role; story: string }> = [
    { role: 'owner', story: 'the owner: the person the agent works for' },
    { role: 'assistant', story: 'executive assistant who writes on the owner\'s behalf' },
    { role: 'similar_name', story: 'acquaintance who shares the owner\'s first name, with a near surname' },
    { role: 'anagram_nickname', story: 'friend whose nickname is a near-anagram of the owner\'s' },
    { role: 'me_contact', story: 'friend the owner saved in their phone as "Me"' },
    ...STORY.map((s) => ({ role: 'contact' as Role, story: s })),
  ];
  const people = roles.map(({ role, story }, i): Person => {
    const first = role === 'owner' || role === 'similar_name' ? ownerFirst : firsts[i]!;
    const last = role === 'owner' ? ownerLast : role === 'similar_name' ? nearSurname(r, ownerLast) : freshLast();
    usedLast.add(last);
    const nick = role === 'owner' ? ownerNick : role === 'anagram_nickname' ? anagram(ownerNick) : null;
    const id = `${first}-${last}`.toLowerCase();
    const lf = first.toLowerCase(), ll = last.toLowerCase();
    if (role === 'owner') {
      const p1 = phone(101, '415'), p2 = phone(102, '628');
      const disc = `${ownerNick.toLowerCase()}${pad(r.int(10, 99))}`;
      return {
        id, name: `${first} ${last}`, first, last, nick, role, role_in_story: story,
        emails: [`${lf}.${ll}@example.com`, `${lf}@${ll}.example.org`, `${ownerNick.toLowerCase()}.${ll}@example.net`],
        phones: [p1.display, p2.display], e164: [p1.e164, p2.e164], slack: lf, slack_id: `UOI${pad(i + 1, 6)}`, telegram: `@${ownerNick.toLowerCase()}${ll}`,
        imessage: [p1.e164, p2.e164, `${lf}.${ll}@example.com`], whatsapp_name: `${first} ${last[0]}`, discord: disc, signal_name: ownerNick,
        teams_name: `${first} ${last} (Personal)`,
        aliases: [ownerNick, `${first} ${last[0]}`, `${first} ${last} (Personal)`, disc],
      };
    }
    const p = phone(ph++, r.pick(['510', '650', '408', '707']));
    const domain = i % 2 ? 'example.com' : 'example.net';
    const disc = role === 'similar_name' ? `${lf}.${ll[0]}` : `${lf}_${ll.slice(0, 3)}`;
    return {
      id, name: `${first} ${last}`, first, last, nick, role, role_in_story: story,
      emails: [`${lf}.${ll}@${domain}`], phones: [p.display], e164: [p.e164], slack: `${lf}${ll[0]}`, slack_id: `UOI${pad(i + 1, 6)}`,
      telegram: `@${lf}${ll}`, imessage: [p.e164], whatsapp_name: `${first} ${last[0]}.`, discord: disc, signal_name: nick ?? first, teams_name: `${first} ${last}`,
      aliases: nick ? [nick] : [],
    };
  });
  const byRole = (role: Role) => people.find((p) => p.role === role)!;
  return { owner: people[0]!, people, byRole, contacts: people.filter((p) => p.role === 'contact') };
}
