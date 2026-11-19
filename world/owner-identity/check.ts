// Keyless check of the owner-identity generator and its committed dev bank. Regenerates the dev bank twice and compares
// digests, compares it with tasks/multiuser/owner-identity/, loads every task.toml with the runner's loadTask and world.json
// with loadWorld, checks every gold token sits on exactly the line or turn gold names and nowhere else in the bank, checks
// names, phone numbers and mail domains, and checks hard-case coverage on the dev bank and on a 42-task probe bank.
//
//   bun world/owner-identity/check.ts       exit 0 with a PASS line, else the first problem

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { loadTask } from '../../runner/trial/task.ts';
import { loadWorld } from '../services/world.ts';
import { checkNames } from '../brain/names.ts';
import { HARD_CASES } from './facts.ts';
import { DEV_SEED, PROFILES, digest, generateBank, writeBank, type Gold, type Split } from './generate.ts';
import { collides, hasBlocked, isEnglish } from './tokens.ts';

export const COMMITTED = join('tasks', 'multiuser', 'owner-identity');
export const PROBE_SEED = 'owner-identity-coverage-probe';

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const count = (hay: string, needle: string) => hay.toLowerCase().split(needle.toLowerCase()).length - 1;

export function checkBank(files: Map<string, string>, split: Split, nTasks: number): string | null {
  const profile = PROFILES[nTasks]!;
  const dir = mkdtempSync(join(tmpdir(), 'oi-check-'));
  try {
    writeBank(files, dir);
    const world = loadWorld(join(dir, 'world', 'world.json'));
    const people = JSON.parse(files.get('world/people.json')!) as { owner: string; people: Array<{ id: string; name: string; first: string; handles: { phones: string[] } }> };
    const ownerId = people.owner;
    const memberIds = new Set(world.members.map((m) => m.id));
    for (const m of world.members) for (const k of ['id', 'slack_id', 'name', 'first', 'handle', 'email', 'role', 'kind', 'org', 'split'] as const) if (typeof m[k] !== 'string' || !m[k]) return `world member ${m.id} lacks ${k}`;
    if (!world.members.some((m) => m.id === ownerId && m.kind === 'employee') || world.members.some((m) => m.kind === 'agent')) return 'world lacks the owner (employee) or carries an agent member the runner adds itself';
    if ((world as typeof world & { bot_reads_files_of?: string }).bot_reads_files_of !== ownerId) return 'world.json does not set bot_reads_files_of to the owner';
    if (world.members.filter((m) => m.kind === 'contact').length < 12) return 'world has fewer than 12 contacts';
    for (const f of world.files) {
      if (new Bun.CryptoHasher('sha256').update(f.body).digest('hex') !== f.sha256 || Buffer.byteLength(f.body) !== f.bytes) return `file ${f.path} has a wrong sha256 or byte count`;
      if (f.folder === 'people') {
        if (f.visibility !== 'public' || f.kind !== 'profile' || f.owner !== ownerId || f.split !== split || f.path !== `${f.slug}.md` || files.get(`corpus/${split}/${f.slug}.md`) !== f.body) return `people file ${f.path} does not match its corpus page or the public profile shape`;
        continue;
      }
      if (!f.path.startsWith(`members/${ownerId}/imports/`) || f.owner !== ownerId || f.visibility !== 'private' || f.split !== split) return `file ${f.path} is outside the owner's imports or has the wrong owner, visibility or split`;
    }
    const pageKeys = [...files.keys()].filter((k) => k.startsWith(`corpus/${split}/people/`)).map((k) => k.slice(`corpus/${split}/`.length, -3)).sort();
    if (JSON.stringify(pageKeys) !== JSON.stringify(world.files.filter((f) => f.folder === 'people').map((f) => f.slug).sort())) return 'world.json does not carry exactly one public file per people page';
    const card = files.get('world/owner-card.md')!;
    if (card.length >= 1200) return `owner-card.md is ${card.length} characters (limit 1,200)`;
    const nameProblems = checkNames(people.people.map((p) => p.name), []);
    if (nameProblems.length) return `name check: ${nameProblems[0]!.name} ${nameProblems[0]!.problem}`;
    const all = [...files.values()].join('\n');
    for (const m of all.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[a-z]{2,})/g)) if (!/(^|\.)example\.(com|org|net)$/.test(m[1]!) && m[1] !== 'xxx') return `mail domain ${m[1]} is not an example domain`;
    for (const m of all.matchAll(/\+1\d{3}(\d{3})(\d{4})(?!\d)|\(?\d{3}\)?[ -](\d{3})-(\d{4})(?!\d)/g)) if ((m[1] ?? m[3]) !== '555' || !/^01\d\d$/.test(m[2] ?? m[4]!)) return `phone-like number ${m[0]} is not 555-01xx`;
    const taskDirs = readdirSync(join(dir, split)).sort();
    if (taskDirs.length !== nTasks) return `${taskDirs.length} tasks, expected ${nTasks}`;
    const golds: Gold[] = [];
    const material = new Map<string, string>();
    const questionText = new Map<string, string>();
    for (const id of taskDirs) {
      const t = loadTask(join(dir, split, id));
      const gold = JSON.parse(files.get(`${split}/${id}/gold.json`)!) as Gold;
      golds.push(gold);
      if (t.id !== id || t.slice !== 'multiuser' || t.family !== `owner_identity_${gold.family}` || t.split !== split || t.time_budget_s !== 900 || t.predicates.required.length) return `${id}: task.toml header does not match the contract`;
      for (const a of t.actors) if (!memberIds.has(a)) return `${id}: actor ${a} is not a world member`;
      const last = t.turns.at(-1)!;
      if (last.actor !== ownerId || last.thread !== 'new' || last.channel !== 'dm') return `${id}: the last turn is not the owner's new-thread DM`;
      const ownSlug = `imports/${id}`;
      const expectRetire = world.files.filter((f) => f.folder !== 'people').map((f) => f.slug).filter((s, i, xs) => xs.indexOf(s) === i && s !== ownSlug).sort();
      if (JSON.stringify([...(t.world?.retire ?? [])].sort()) !== JSON.stringify(expectRetire)) return `${id}: [world] retire is not every other task's import slug`;
      if (gold.family === 'I') {
        const tf = world.files.filter((f) => f.slug === ownSlug);
        if (!tf.length || tf.length > 4 || t.turns.length !== 2 || last.advance_clock_s !== 3600) return `${id}: an import task needs 1 to 4 files and two turns`;
        if (JSON.stringify(gold.formats.map((f) => f.file).sort()) !== JSON.stringify(tf.map((f) => f.title).sort())) return `${id}: gold.formats does not list the task's files`;
        material.set(id, tf.map((f) => f.body).join('\n') + '\n' + t.turns[0]!.text);
        for (const fact of gold.facts) {
          if (!('file' in fact.where)) return `${id}: ${fact.id} has no file location`;
          const w = fact.where;
          const lines = tf.find((f) => f.title === w.file)?.body.split('\n') ?? [];
          if (!lines[w.line - 1]?.toLowerCase().includes(fact.token.toLowerCase())) return `${id}: ${fact.id} is not on ${w.file}:${w.line}`;
          if (count(tf.find((f) => f.title === w.file)!.body, fact.text) !== 1 && !tf.find((f) => f.title === w.file)!.body.includes(JSON.stringify(fact.text).slice(1, -1))) return `${id}: ${fact.id}'s text is not in its file exactly once`;
        }
      } else {
        if (t.turns.length < 6 || t.turns.length > 10) return `${id}: a live task needs 5 to 9 turns before the questions`;
        const ch = world.channels.find((c) => c.name === t.turns[0]!.channel);
        if (!ch || !ch.members.includes(ownerId) || ch.members.length !== 4) return `${id}: its channel is missing or not the owner plus three`;
        if (t.turns.slice(0, -1).some((tt) => tt.text.includes('@moss') || !ch.members.includes(tt.actor))) return `${id}: a channel turn names a bot handle or comes from outside the channel`;
        if (t.turns.slice(0, -1).filter((tt) => tt.actor !== ownerId && /(remember that I|note for later: my)/i.test(tt.text)).length < 2) return `${id}: fewer than two non-owners ask the bot to remember their own facts`;
        material.set(id, t.turns.slice(0, -1).map((tt) => tt.text).join('\n'));
        for (const fact of gold.facts) {
          if (!('turn' in fact.where) || !t.turns[fact.where.turn - 1]?.text.includes(fact.text)) return `${id}: ${fact.id} is not on the turn gold names`;
        }
      }
      questionText.set(id, last.text);
      const own = gold.facts.filter((f) => f.primary === 'owner_recall').length, other = gold.facts.filter((f) => f.primary === 'false_owner').length, sec = gold.facts.filter((f) => f.primary === 'secondary').length;
      if (gold.facts.length < 6 || gold.facts.length > 10 || own < 2 || own > 3 || other < 3 || other > 5 || sec > 2) return `${id}: fact mix ${own} owner, ${other} other, ${sec} secondary is outside the contract`;
      for (const f of gold.facts) {
        const expect = f.claimant === ownerId ? (f.utterer === ownerId ? 'owner_recall' : 'secondary') : 'false_owner';
        const surface = f.claimant === ownerId ? 'owner' : f.claimant.startsWith('agent:') ? 'not_owner' : `person:${f.claimant}`;
        if (f.primary !== expect || f.correct_surface !== surface) return `${id}: ${f.id} has primary ${f.primary} or surface ${f.correct_surface}, expected ${expect} and ${surface}`;
        if (!(HARD_CASES as readonly string[]).includes(f.hard_case)) return `${id}: ${f.id} has an unknown hard case`;
      }
      const qs = gold.questions;
      if (qs.map((q) => q.kind).join() !== 'owner_fact,owner_fact,other_fact,who_said') return `${id}: the four questions are not owner, owner, other, who said`;
      for (const q of qs) {
        const f = gold.facts.find((x) => x.token === q.token);
        if (!f) return `${id}: question ${q.n} names a token no fact carries`;
        if (q.kind === 'owner_fact' && f.primary !== 'owner_recall') return `${id}: question ${q.n} asks an owner fact the owner did not state`;
        if (q.kind !== 'owner_fact' && (f.claimant === ownerId || f.claimant.startsWith('agent:'))) return `${id}: question ${q.n} needs a contact's fact`;
      }
      if (gold.hard_cases.join() !== HARD_CASES.filter((h) => gold.facts.some((f) => f.hard_case === h)).join()) return `${id}: gold.hard_cases is not the union of its facts' hard cases`;
    }
    const tokens = golds.flatMap((g) => g.facts.map((f) => ({ task: g.task, token: f.token, gold: g })));
    const names = people.people.flatMap((p) => p.name.split(' '));
    for (const [i, { task, token, gold }] of tokens.entries()) {
      if (!/^[A-Z][a-z]{5,9}$/.test(token) || isEnglish(token) || hasBlocked(token)) return `${task}: token ${token} is not a 6 to 10 letter non-English pseudo-word`;
      for (const other of tokens.slice(i + 1)) if (collides(token, other.token)) return `tokens ${token} and ${other.token} collide under case- and plural-insensitive matching`;
      for (const n of names) if (collides(token, n)) return `token ${token} collides with the name ${n}`;
      for (const [tid, text] of material) {
        const c = count(text, token.replace(/s$/i, ''));
        if (c !== (tid === task ? 1 : 0)) return `token ${token} of ${task} appears ${c} times in ${tid}'s material`;
      }
      const isWho = gold.questions.some((q) => q.kind === 'who_said' && q.token === token);
      for (const [tid, text] of questionText) if (count(text, token) !== (tid === task && isWho ? 1 : 0)) return `token ${token} appears where it should not in ${tid}'s questions`;
      if (count(all, token) !== 1 + (isWho ? 1 : 0) + count(files.get(`${split}/${task}/gold.json`)!, token)) return `token ${token} appears outside its task`;
    }
    const coverage = JSON.parse(files.get('world/coverage.json')!) as { by_hard_case: Record<string, { total: number }> };
    for (const h of HARD_CASES) {
      const n = golds.filter((g) => g.hard_cases.includes(h)).length;
      if (coverage.by_hard_case[h]?.total !== n) return `coverage.json disagrees with gold for ${h}`;
      if (n < profile.min) return `hard case ${h} is in ${n} tasks, short of ${profile.min}`;
    }
    const bySource = new Map<string, number>();
    for (const g of golds) bySource.set(g.source, (bySource.get(g.source) ?? 0) + 1);
    if (nTasks === 42 && [...bySource].some(([s, n]) => n !== (s === 'live' ? 12 : 5))) return 'a counted bank needs five import tasks per source and 12 live tasks';
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function checkAll(): string {
  const a = generateBank(DEV_SEED, 'dev', 12), b = generateBank(DEV_SEED, 'dev', 12);
  const da = digest(a);
  if (da !== digest(b)) throw new Error('the dev bank is not deterministic: two runs gave different digests');
  if (!existsSync(COMMITTED)) throw new Error(`${COMMITTED} is missing; write the dev bank there with generate.ts`);
  {
    const committed = new Map(walk(COMMITTED).map((p) => [relative(COMMITTED, p), readFileSync(p, 'utf8')]));
    const diff = [...new Set([...committed.keys(), ...a.keys()])].sort().find((k) => committed.get(k) !== a.get(k));
    if (diff) throw new Error(`${COMMITTED}/${diff} differs from the generator's output; regenerate the dev bank`);
  }
  const dev = checkBank(a, 'dev', 12);
  if (dev) throw new Error(`dev bank: ${dev}`);
  const probe = generateBank(PROBE_SEED, 'dev', 42);
  const p = checkBank(probe, 'dev', 42);
  if (p) throw new Error(`42-task probe bank: ${p}`);
  const facts = [...a.entries()].filter(([k]) => k.endsWith('gold.json')).reduce((s, [, v]) => s + (JSON.parse(v) as Gold).facts.length, 0);
  return `PASS owner-identity: dev bank 12 tasks, ${facts} facts, digest ${da.slice(0, 12)}, matches ${COMMITTED}; 42-task probe bank covers every hard case at least 6 times`;
}

if (import.meta.main) {
  try { console.log(checkAll()); }
  catch (e) { console.error(`FAIL ${(e as Error).message}`); process.exit(1); }
}
