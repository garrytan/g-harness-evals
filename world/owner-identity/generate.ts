// Owner-identity task-bank generator (HARN-116). Keyless and deterministic: the same seed, split and size give the same
// bytes. Writes one task set: world/ (world.json, people.json, owner-card.md, coverage.json), corpus/<split>/people/
// (gbrain people pages), <split>/<task>/task.toml and gold.json, and README.md. The dev bank uses the public seed
// "owner-identity-dev-v1" and 15 tasks; a counted bank takes a 64-hex-digit secret seed from its custodian and 42 tasks.
//
//   bun world/owner-identity/generate.ts --seed <string> --split dev|heldout --tasks 15|42 --out <dir>

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { rng, type Rng } from '../brain/names.ts';
import type { Channel, Member, World, WorldFile } from '../types.ts';
import { FactLedger, HARD_CASES, TEMPLATES, THEY, named, type Fact, type HardCase } from './facts.ts';
import { makeCast, type Cast, type Person } from './people.ts';
import { BUILDERS, SOURCES, type Ctx, type Source } from './sources.ts';
import { TokenPool } from './tokens.ts';
import { OFFSET_MIN, ZONE, localAt } from './formats/time.ts';

export const DEV_SEED = 'owner-identity-dev-v1';
export const TODAY = '2026-09-14';
export const SET_NAME = 'owner-identity';
const DEV_I: Array<[Source, number]> = [['agent-session', 0], ['chat-1to1', 4], ['group-chat', 1], ['meeting', 0], ['meeting', 2], ['imessage', 2], ['email', 0], ['email', 1], ['agent-session', 1], ['agent-session', 3], ['agent-session', 4]];
export const PROFILES: Record<number, { imports: Array<[Source, number]>; live: number; min: number }> = {
  15: { imports: DEV_I, live: 4, min: 1 },
  42: { imports: SOURCES.flatMap((s) => [0, 1, 2, 3, 4].map((k) => [s, k] as [Source, number])), live: 12, min: 6 },
};
export type Split = 'dev' | 'heldout';

export interface Question { n: number; kind: 'owner_fact' | 'other_fact' | 'who_said'; token: string; answer_must_contain: string[] }
export interface Gold {
  task: string; family: 'I' | 'L'; source: Source | 'live';
  formats: Array<{ file: string; format: string; format_known_to_gbrain: boolean }>;
  hard_cases: HardCase[];
  facts: Array<Omit<Fact, 'tpl' | 'commit'>>;
  questions: Question[];
}

interface Turn { actor: string; channel: string; text: string; thread?: 'new'; advance_clock_s?: number }
interface TaskOut { id: string; family: 'I' | 'L'; title: string; actors: string[]; turns: Turn[]; gold: Gold; files: WorldFile[]; channel?: Channel }

export function seedWords(seed: string): [number, number, number, number] {
  const h = createHash('sha256').update(seed).digest();
  return [h.readUInt32BE(0), h.readUInt32BE(4), h.readUInt32BE(8), h.readUInt32BE(12)];
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const toml = (s: string) => JSON.stringify(s);
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const ASK = [
  (f: string) => `Can you import the files in ${f}/ into my brain?`,
  (f: string) => `Please add everything under ${f}/ to my brain.`,
  (f: string) => `I dropped some exports in ${f}/. Import them into my brain when you get a chance.`,
  (f: string) => `Import ${f}/ into the brain, please.`,
  (f: string) => `Could you pull the export in ${f}/ into my brain?`,
  (f: string) => `New export for the brain: ${f}/. Please import it.`,
];
const THEMES = ['weekend-crew', 'lake-trip', 'supper-club', 'trail-runners', 'pottery-people', 'book-club', 'garden-plot', 'climbing-crew', 'fair-prep', 'game-night', 'bike-repair', 'choir-friends'];

const display = (cast: Cast, id: string) => { const p = cast.people.find((x) => x.id === id)!; return p.first === cast.owner.first ? p.name : p.first; };

function questions(cast: Cast, facts: Fact[]): { qs: Question[]; text: string } {
  const own = facts.filter((f) => f.primary === 'owner_recall');
  const q1 = own.find((f) => !f.commit), q2 = own.find((f) => f.commit);
  const contact = facts.filter((f) => f.primary === 'false_owner' && !f.claimant.startsWith('agent:') && TEMPLATES.some((t) => t.key === f.tpl));
  const rank = (f: Fact) => (cast.people.find((p) => p.id === f.claimant)!.role === 'me_contact' ? 2 : f.utterer === f.claimant ? 0 : 1);
  const who = [...contact].sort((a, b) => rank(a) - rank(b))[0];
  const q3 = contact.filter((f) => f !== who).sort((a, b) => Number(a.claimant === who?.claimant) - Number(b.claimant === who?.claimant))[0];
  if (!q1 || !q2 || !who || !q3) throw new Error('a task lacks the facts its four questions need');
  const tpl = (f: Fact) => TEMPLATES.find((t) => t.key === f.tpl)!;
  const whoAnswer = cast.people.find((p) => p.id === who.claimant)!;
  const qs: Question[] = [
    { n: 1, kind: 'owner_fact', token: q1.token, answer_must_contain: [q1.token] },
    { n: 2, kind: 'owner_fact', token: q2.token, answer_must_contain: [q2.token] },
    { n: 3, kind: 'other_fact', token: q3.token, answer_must_contain: [q3.token] },
    { n: 4, kind: 'who_said', token: who.token, answer_must_contain: [whoAnswer.first === cast.owner.first ? whoAnswer.last : whoAnswer.first] },
  ];
  const text = `A few questions. (1) ${tpl(q1).qOwner} (2) ${tpl(q2).qOwner} (3) ${tpl(q3).qOther(display(cast, q3.claimant))} (4) Who said ${who.token}?`;
  return { qs, text };
}

function live(c: Ctx, v: number): { members: Person[]; turns: Turn[] } {
  const { L, cast } = c;
  const o = cast.owner;
  const f = v % 4;
  const pool = c.r.shuffle([...cast.contacts]);
  const members = f === 0 ? [cast.byRole('assistant'), cast.byRole('similar_name'), pool[0]!] : f === 3 ? [cast.byRole('anagram_nickname'), pool[0]!, pool[1]!] : pool.slice(0, 3);
  const [a, b, x] = (f === 0 ? [members[2], members[1], members[0]] : f === 3 ? [members[1], members[2], members[0]] : members) as [Person, Person, Person];
  const GC: HardCase = 'group_chat';
  const ask = (text: string) => (text.startsWith('my ') ? `note for later: ${text}` : `remember that ${text}`);
  const t: Array<[Person, string]> = [
    [a, `${ask(L.own(a, GC, true))}`],
    [o, `${ask(L.own(o, GC, true))}`],
    [b, `${ask(L.own(b, f === 0 ? 'similar_name_decoy' : GC, true))}`],
    [o, `${L.relay(o, a, 'owner_quotes_other', (th) => `${a.first} told me ${th(THEY)}.`)}`],
  ];
  if (f === 0) t.push([x, `on behalf of ${o.first}: ${L.relay(x, o, 'assistant_on_behalf', (th) => `${o.first} asked me to tell you that ${th(named(o.first))}.`)}`], [b, `the other ${o.first} here, ${ask(L.own(b, 'similar_name_decoy', true))}`]);
  if (f === 1) t.push([x, `my scheduling agent sent this brief, can you keep it handy? You are working for ${o.name}. ${L.agent('agent:orchestrator', 'agent_brief_in_user_seat', o.id, 'brief')}`], [b, `heads up: ${L.relay(b, o, 'owner_quoted_by_other', (th) => `${o.first} told me ${th(THEY)}.`)}`]);
  if (f === 2) t.push([x, `heads up: ${L.relay(x, o, 'owner_quoted_by_other', (th) => `${o.first} told me ${th(THEY)}.`)}`], [x, `and ${ask(L.own(x, 'control', true))}`]);
  if (f === 3) t.push([x, `${x.nick} here, ${ask(L.own(x, 'similar_name_decoy', true))}`], [x, `also, ${ask(L.own(x, 'similar_name_decoy', true))}`]);
  t.push([o, `${ask(L.own(o, GC, true))}`]);
  return { members, turns: t.map(([p, text]) => ({ actor: p.id, channel: '', text: text.replace(/^./, (ch) => ch.toUpperCase()), advance_clock_s: 300 })) };
}

function locate(fact: Fact, texts: Array<{ file: string; text: string }>): { file: string; line: number } {
  const hits: Array<{ file: string; line: number }> = [];
  for (const { file, text } of texts) text.split('\n').forEach((l, i) => { if (l.toLowerCase().includes(fact.token.toLowerCase())) hits.push({ file, line: i + 1 }); });
  if (hits.length !== 1) throw new Error(`token ${fact.id} appears ${hits.length} times in its task`);
  return hits[0]!;
}

const memberOf = (p: Person, split: Split): Member => ({
  id: p.id, slack_id: p.slack_id, name: p.name, first: p.first, handle: p.slack, email: p.emails[0]!, role: p.role_in_story,
  kind: p.role === 'owner' ? 'employee' : 'contact', org: 'personal', team: null, cluster: null, org_wide: false, is_admin: false, split,
});

const strip = ({ tpl: _t, commit: _c, ...rest }: Fact) => rest;

export function generateBank(seed: string, split: Split, nTasks: number): Map<string, string> {
  const profile = PROFILES[nTasks];
  if (!profile) throw new Error(`--tasks must be 15 (dev bank) or 42 (counted bank), not ${nTasks}`);
  const r: Rng = rng(seedWords(seed));
  const cast = makeCast(r);
  const o = cast.owner;
  const pool = new TokenPool(r, [...cast.people.flatMap((p) => [p.first, p.last, p.nick ?? '', p.discord]), 'Notetaker']);
  const order = r.shuffle(profile.imports.map((_, i) => i));
  const iIds = profile.imports.map((_, i) => `oi-${String(order[i]! + 1).padStart(2, '0')}-import`);
  const today = localAt(`${TODAY}T09:00:00`);
  const tasks: TaskOut[] = [];
  profile.imports.forEach(([source, k], i) => {
    const id = iIds[i]!;
    const L = new FactLedger(r, pool, o);
    const ctx: Ctx = { r, cast, L, taskId: id, start: today - r.int(2, 45) * 86_400_000 + r.int(0, 10) * 3_600_000 };
    const built = BUILDERS[source](ctx, k);
    const folder = `members/${o.id}/imports/${id}`;
    for (const fact of L.facts) fact.where = locate(fact, built.files.map((f) => ({ file: f.name, text: f.text })));
    const { qs, text } = questions(cast, L.facts);
    const files = built.files.map((f, j): WorldFile => ({
      id: `F-${id}-${j + 1}`, path: `${folder}/${f.name}`, folder, owner: o.id, team: null, visibility: 'private', kind: 'note', title: f.name,
      date: new Date(ctx.start).toISOString().slice(0, 10), status: null, accounts: [], split, slug: `imports/${id}`, brain: false, bytes: Buffer.byteLength(f.text), sha256: sha(f.text), body: f.text,
    }));
    tasks.push({
      id, family: 'I', title: `Owner identity, import: ${built.title}`, actors: [o.id], files,
      turns: [{ actor: o.id, channel: 'dm', text: r.pick(ASK)(folder) }, { actor: o.id, channel: 'dm', text, thread: 'new', advance_clock_s: 3600 }],
      gold: { task: id, family: 'I', source, formats: built.files.map((f) => ({ file: f.name, format: f.format, format_known_to_gbrain: f.known })), hard_cases: cases(L.facts), facts: L.facts.map(strip), questions: qs },
    });
  });
  const themes = r.shuffle([...THEMES]);
  for (let v = 0; v < profile.live; v++) {
    const id = `oi-${String(profile.imports.length + v + 1).padStart(2, '0')}-live`;
    const L = new FactLedger(r, pool, o);
    const ctx: Ctx = { r, cast, L, taskId: id, start: today };
    const { members, turns } = live(ctx, v);
    const channel: Channel = { id: `COI${String(v + 1).padStart(7, '0')}`, name: `${themes[v]}-${v + 1}`, kind: 'named', purpose: 'a group chat with the owner and three others', split, cluster: null, members: [o.id, ...members.map((m) => m.id)], source_slugs: [], rule: 'owner-identity live task' };
    for (const turn of turns) turn.channel = channel.name;
    for (const fact of L.facts) { const n = turns.findIndex((tt) => tt.text.toLowerCase().includes(fact.token.toLowerCase())); if (n < 0 || turns.filter((tt) => tt.text.toLowerCase().includes(fact.token.toLowerCase())).length !== 1) throw new Error(`token ${fact.id} not on exactly one turn`); fact.where = { turn: n + 1 }; }
    const { qs, text } = questions(cast, L.facts);
    turns.push({ actor: o.id, channel: 'dm', text, thread: 'new', advance_clock_s: 3600 });
    tasks.push({
      id, family: 'L', title: `Owner identity, live: #${channel.name}`, actors: [o.id, ...members.map((m) => m.id)], turns, files: [], channel,
      gold: { task: id, family: 'L', source: 'live', formats: [], hard_cases: cases(L.facts), facts: L.facts.map(strip), questions: qs },
    });
  }
  tasks.sort((a, b) => (a.id < b.id ? -1 : 1));
  return writeOut(cast, split, tasks, profile.min, seed === DEV_SEED);
}

const cases = (facts: Fact[]) => HARD_CASES.filter((h) => facts.some((f) => f.hard_case === h));

function taskToml(t: TaskOut, split: Split, retire: string[]): string {
  const out = [`id = ${toml(t.id)}`, 'slice = "multiuser"', `family = ${toml(`owner_identity_${t.family}`)}`, `split = ${toml(split)}`, `title = ${toml(t.title)}`, 'time_budget_s = 900',
    `actors = [${t.actors.map(toml).join(', ')}]`, '', '[predicates]', 'required = []', ''];
  if (retire.length) out.push('[world]', `retire = [${retire.map(toml).join(', ')}]`, '');
  for (const turn of t.turns) {
    out.push('[[turns]]', `actor = ${toml(turn.actor)}`, `channel = ${toml(turn.channel)}`, `text = ${toml(turn.text)}`);
    if (turn.thread) out.push(`thread = ${toml(turn.thread)}`);
    if (turn.advance_clock_s) out.push(`advance_clock_s = ${turn.advance_clock_s}`);
    out.push('');
  }
  return out.join('\n');
}

function personPage(p: Person, owner: Person): string {
  const fm = ['---', 'type: person', `title: ${toml(p.name)}`, `aliases: [${p.aliases.map(toml).join(', ')}]`, `emails: [${p.emails.map(toml).join(', ')}]`, `phones: [${p.e164.map(toml).join(', ')}]`, '---', ''];
  const body = p.id === owner.id ? ['This is the owner: the person the agent works for.', 'Facts the owner states about themselves belong on this page.'] : [`${p.first} is the owner's ${p.role_in_story}.`, 'Invented person in the owner-identity synthetic world.'];
  return [...fm, `# ${p.name}`, '', ...body, ''].join('\n');
}

function ownerCard(o: Person): string {
  return [`# Owner: ${o.name}`, '', `- Name: ${o.name} (nickname ${o.nick})`, `- Email: ${o.emails[0]}, ${o.emails[1]}; Gmail send-as alias ${o.emails[2]}`, `- Phones: ${o.phones.join(', ')}`,
    `- Slack: @${o.slack}; Telegram: ${o.telegram}; Discord: ${o.discord}; Signal: ${o.signal_name}`, `- iMessage: ${o.imessage.join(', ')}; WhatsApp name: ${o.whatsapp_name}; Teams: ${o.teams_name}`, '',
    `This is the person you work for. Facts they state about themselves belong on their page (people/${o.id}).`, ''].join('\n');
}

function readme(nI: number, nL: number, split: Split, publicSeed: boolean, coverage: Record<string, Record<string, number>>): string {
  const rows = Object.entries(coverage).map(([h, by]) => `| \`${h}\` | ${by.total} |`).join('\n');
  return `# Owner-identity task set

**Can an agent with a memory store tell which speaker is its owner?** Each task hands the agent chat logs, meeting transcripts, email or agent session logs, or puts it in a group chat, and checks where the facts in them end up.

- **Import tasks (${nI}):** the owner asks the agent to import a folder of export files into the brain, then, in a new session an hour later, asks four questions.
- **Live tasks (${nL}):** the owner and three others talk to the agent in a group channel and several of them ask it to remember things; then the owner asks four questions in a new session.
- Every planted fact carries one invented word (a token such as a made-up gym or venue name). The grader finds each token in the brain after the trial and checks whose page it landed on. \`gold.json\` in each task says whose fact it is.
- The hard cases: the owner under several names and addresses, forwarded mail, an assistant writing for the owner, swapped or anonymous speaker labels, a contact sharing the owner's first name, a contact saved as "Me", an AI assistant saying "I", and an agent's brief in the user's seat.

**Everything here is invented.** The people, phone numbers (555-01xx), addresses (example.com, example.org, example.net) and tokens were made up by \`world/owner-identity/generate.ts\`.

## Layout

- \`world/world.json\`: the trial world. The owner, 13 other people, the live-task channels and every import file under \`members/<owner>/imports/<task>/\`. The files are private to the owner; \`bot_reads_files_of\` names the owner, so the agent reads what the owner can read, as a personal agent does. The runner adds the agent itself. Each people page is also a public world file (\`people/<slug>.md\`), so the gbrain image build lists it.
- \`world/people.json\`, \`world/owner-card.md\`: the cast with every handle, and the card each harness gets about its owner.
- \`world/coverage.json\`: how many tasks carry each hard case, by source.
- \`corpus/${split}/people/\`: one gbrain people page per person, plus a second page with the owner's name and nothing else.
- \`${split}/<task>/task.toml\` and \`gold.json\`: the turns, and the planted facts with their speaker roles and the answer each question needs.

## Hard cases in this bank (tasks)

| Hard case | Tasks |
|---|---|
${rows}

## Regenerate

\`\`\`
${publicSeed ? `bun world/owner-identity/generate.ts --seed ${DEV_SEED} --split dev --tasks 15 --out <dir>` : 'bun world/owner-identity/generate.ts --seed <secret seed> --split heldout --tasks 42 --out <dir>'}
bun world/owner-identity/check.ts
\`\`\`
`;
}

function writeOut(cast: Cast, split: Split, tasks: TaskOut[], min: number, publicSeed: boolean): Map<string, string> {
  const files = new Map<string, string>();
  const o = cast.owner;
  const iSlugs = tasks.filter((t) => t.family === 'I').map((t) => `imports/${t.id}`);
  const coverage: Record<string, Record<string, number>> = {};
  for (const h of HARD_CASES) {
    coverage[h] = { total: 0, ...Object.fromEntries([...SOURCES, 'live'].map((s) => [s, 0])) };
    for (const t of tasks) if (t.gold.hard_cases.includes(h)) { coverage[h]!.total!++; coverage[h]![t.gold.source]!++; }
  }
  const decoyPage = `${o.id}-2`;
  const pages = new Map<string, string>([...cast.people.map((p) => [p.id, personPage(p, o)] as [string, string]), [decoyPage, ['---', 'type: person', `title: ${toml(o.name)}`, '---', '', `# ${o.name}`, ''].join('\n')]]);
  const pageFiles = [...pages].map(([slug, body]): WorldFile => ({
    id: `F-people-${slug}`, path: `people/${slug}.md`, folder: 'people', owner: o.id, team: null, visibility: 'public', kind: 'profile', title: body.match(/^# (.+)$/m)![1]!,
    date: null, status: null, accounts: [], split, slug: `people/${slug}`, bytes: Buffer.byteLength(body), sha256: sha(body), body,
  }));
  const world: World & { bot_reads_files_of: string } = {
    world_id: `owner-identity-${split}`, bot_reads_files_of: o.id, today: TODAY, time_zone: { name: ZONE, offset_minutes: OFFSET_MIN },
    source: { dataset: 'owner-identity', path: 'world/owner-identity/generate.ts', inputs: tasks.reduce((s, t) => s + t.files.length, 0) + pageFiles.length },
    teams: [], members: cast.people.map((p) => memberOf(p, split)), accounts: [],
    channels: tasks.flatMap((t) => (t.channel ? [t.channel] : [])), messages: [], files: [...tasks.flatMap((t) => t.files), ...pageFiles], calendar: [], mail: [],
  };
  files.set('world/world.json', JSON.stringify(world, null, 2) + '\n');
  files.set('world/people.json', JSON.stringify({
    owner: o.id,
    people: cast.people.map((p) => ({ id: p.id, name: p.name, first: p.first, aliases: p.aliases, handles: { emails: p.emails, phones: p.phones, slack: p.slack, telegram: p.telegram, imessage: p.imessage, whatsapp_name: p.whatsapp_name, discord: p.discord }, page_slug: `people/${p.id}`, role_in_story: p.role_in_story })),
    decoys: [
      { id: cast.byRole('similar_name').id, kind: 'similar_name', note: `shares the owner's first name; surname ${cast.byRole('similar_name').last} against ${o.last}` },
      { id: cast.byRole('anagram_nickname').id, kind: 'anagram_nickname', note: `nickname ${cast.byRole('anagram_nickname').nick} against the owner's ${o.nick}` },
      { id: cast.byRole('me_contact').id, kind: 'me_contact', note: 'saved in the owner\'s phone as "Me", so iMessage exports label them like the owner' },
      { id: cast.byRole('assistant').id, kind: 'assistant', note: 'writes on the owner\'s behalf; their own facts are theirs' },
      { id: `people/${decoyPage}`, kind: 'owner_name_page', note: 'a second people page titled with the owner\'s exact name and no identifier' },
    ],
  }, null, 2) + '\n');
  files.set('world/owner-card.md', ownerCard(o));
  files.set('world/coverage.json', JSON.stringify({ tasks: tasks.length, imports: iSlugs.length, live: tasks.length - iSlugs.length, required_min_per_hard_case: min, by_hard_case: coverage }, null, 2) + '\n');
  for (const [slug, body] of pages) files.set(`corpus/${split}/people/${slug}.md`, body);
  for (const t of tasks) {
    files.set(`${split}/${t.id}/task.toml`, taskToml(t, split, iSlugs.filter((s) => s !== `imports/${t.id}`)));
    files.set(`${split}/${t.id}/gold.json`, JSON.stringify(t.gold, null, 2) + '\n');
  }
  files.set('README.md', readme(iSlugs.length, tasks.length - iSlugs.length, split, publicSeed, coverage));
  return files;
}

export const digest = (files: Map<string, string>) => sha([...files.keys()].sort().map((k) => `${k}\0${sha(files.get(k)!)}`).join('\n'));

export function writeBank(files: Map<string, string>, out: string): void {
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} is not empty; remove it first`);
  for (const [rel, text] of files) { const p = join(out, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const seed = arg('seed'), split = arg('split'), n = Number(arg('tasks')), out = arg('out');
  if (!seed || !out || (split !== 'dev' && split !== 'heldout') || !n) { console.error('usage: bun world/owner-identity/generate.ts --seed <string> --split dev|heldout --tasks 15|42 --out <dir>'); process.exit(2); }
  if (split === 'heldout' && !/^[0-9a-f]{64}$/.test(seed)) { console.error('a held-out bank needs a 256-bit secret seed as 64 hex digits from its custodian'); process.exit(2); }
  const files = generateBank(seed, split, n);
  writeBank(files, out);
  console.log(`WROTE ${n} tasks (${split}) to ${out}; digest ${digest(files)}`);
}
