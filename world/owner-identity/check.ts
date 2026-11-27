// Keyless check of the owner-identity generator and its committed dev bank. Regenerates the dev bank twice and compares
// digests, compares it with tasks/multiuser/owner-identity/, loads every task.toml with the runner's loadTask and world.json
// with loadWorld, checks every gold token sits on exactly the line or turn gold names and nowhere else in the bank, checks
// names, phone numbers and mail domains, checks each session-capture task's turns, capture.json and session gold (checkCapture),
// and checks hard-case coverage on the dev bank and on a 42-task probe bank.
//
//   bun world/owner-identity/check.ts       exit 0 with a PASS line, else the first problem

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { loadTask } from '../../runner/trial/task.ts';
import { loadWorld } from '../services/world.ts';
import { checkNames } from '../brain/names.ts';
import { HARD_CASES, type HardCase } from './facts.ts';
import { DEV_SEED, PROFILES, digest, generateBank, writeBank, type Gold, type Split } from './generate.ts';
import { collides, hasBlocked, isEnglish } from './tokens.ts';
import { CAPTURE_AGENT, CAPTURE_LAUNCHER, type CapturePlan } from './capture.ts';

export const COMMITTED = join('tasks', 'multiuser', 'owner-identity');
export const PROBE_SEED = 'owner-identity-coverage-probe';
/** Hard cases rebuilt from real misattribution shapes; every file of a task carrying one must be in a format gbrain reads. */
export const KNOWN_FORMAT_CASES: HardCase[] = ['recorder_label_absorbs', 'owner_under_generic_label', 'group_thread_one_label', 'reported_speech_in_notes', 'press_paraphrase', 'agent_on_owner_account', 'assistant_relays_thread'];

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const count = (hay: string, needle: string) => hay.toLowerCase().split(needle.toLowerCase()).length - 1;

export function checkBank(files: Map<string, string>, split: Split, nTasks: number): string | null {
  const profile = PROFILES[nTasks]!;
  const dir = mkdtempSync(join(tmpdir(), 'oi-check-'));
  try {
    writeBank(files, dir);
    const world = loadWorld(join(dir, 'world', 'world.json'));
    const people = JSON.parse(files.get('world/people.json')!) as { owner: string; people: Array<{ id: string; name: string; first: string; role_in_story: string; handles: { phones: string[] } }> };
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
    if (taskDirs.length !== nTasks + profile.capture.length) return `${taskDirs.length} tasks, expected ${nTasks} import and live and ${profile.capture.length} session capture`;
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
          if (fact.cue === 'clear') {
            const line = lines[w.line - 1]!, owner = people.people.find((p) => p.id === ownerId)!, speaker = people.people.find((p) => p.id === fact.claimant)!;
            if (!line.includes(`${owner.first}, speaking as your ${speaker.role_in_story}:`) && !line.includes(`${owner.first}, ${speaker.first} here`)) return `${id}: ${fact.id} is marked a clear cue but its line neither addresses the owner by name with the speaker's role nor names the speaker`;
          }
        }
      } else if (gold.family === 'C') {
        const problem = checkCapture(id, t.turns, gold, files.get(`${split}/${id}/capture.json`), ownerId);
        if (problem) return problem;
        const plan = JSON.parse(files.get(`${split}/${id}/capture.json`)!) as CapturePlan;
        material.set(id, [...t.turns.map((tt) => tt.text), ...plan.workers.map((w) => w.brief)].join('\n'));
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
        if (!memberIds.has(f.claimant) && !/^(agent|press):[a-z0-9-]+$/.test(f.claimant)) return `${id}: ${f.id} has claimant ${f.claimant}, neither a person nor an agent: or press: label`;
        const surface = f.claimant === ownerId ? 'owner' : memberIds.has(f.claimant) ? `person:${f.claimant}` : 'not_owner';
        if (f.primary !== expect || f.correct_surface !== surface) return `${id}: ${f.id} has primary ${f.primary} or surface ${f.correct_surface}, expected ${expect} and ${surface}`;
        if (!(HARD_CASES as readonly string[]).includes(f.hard_case)) return `${id}: ${f.id} has an unknown hard case`;
        if ((f.hard_case === 'recorder_label_absorbs') !== (f.cue === 'clear' || f.cue === 'weak')) return `${id}: ${f.id} must carry a cue of clear or weak exactly when it is a recorder_label_absorbs fact`;
      }
      const qs = gold.questions;
      if (gold.family === 'C' ? qs.length !== 0 : qs.map((q) => q.kind).join() !== 'owner_fact,owner_fact,other_fact,who_said') return `${id}: ${gold.family === 'C' ? 'a session-capture task asks no questions (a question session would itself be captured)' : 'the four questions are not owner, owner, other, who said'}`;
      for (const q of qs) {
        const f = gold.facts.find((x) => x.token === q.token);
        if (!f) return `${id}: question ${q.n} names a token no fact carries`;
        if (q.kind === 'owner_fact' && f.primary !== 'owner_recall') return `${id}: question ${q.n} asks an owner fact the owner did not state`;
        if (q.kind !== 'owner_fact' && (f.claimant === ownerId || !memberIds.has(f.claimant))) return `${id}: question ${q.n} needs a contact's fact`;
      }
      if (gold.hard_cases.join() !== HARD_CASES.filter((h) => gold.facts.some((f) => f.hard_case === h)).join()) return `${id}: gold.hard_cases is not the union of its facts' hard cases`;
      if (gold.hard_cases.some((h) => KNOWN_FORMAT_CASES.includes(h)) && gold.formats.some((f) => !f.format_known_to_gbrain)) return `${id}: carries a newer hard case in a file gbrain cannot read`;
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
      if (n < (profile.min[h] ?? 0)) return `hard case ${h} is in ${n} tasks, short of ${profile.min[h]}`;
    }
    for (const [h, need] of Object.entries(profile.minFormats) as Array<[HardCase, number]>) {
      const formats = new Set(golds.filter((g) => g.hard_cases.includes(h)).flatMap((g) => g.formats.map((f) => f.format)));
      if (formats.size < need) return `hard case ${h} is in ${formats.size} formats, short of ${need}`;
    }
    const bySource = new Map<string, number>();
    for (const g of golds) bySource.set(g.source, (bySource.get(g.source) ?? 0) + 1);
    const expectSource = new Map<string, number>([['live', profile.live.length], ...(profile.capture.length ? [['session-capture', profile.capture.length] as [string, number]] : [])]);
    for (const [s] of profile.imports) expectSource.set(s, (expectSource.get(s) ?? 0) + 1);
    if ([...new Set([...bySource.keys(), ...expectSource.keys()])].some((s) => bySource.get(s) !== expectSource.get(s))) return 'the tasks per source do not match the bank profile';
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LABEL_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** A family C task: three owner DM turns, each a new session, the third asking for the launcher; capture.json's four workers (two
 *  with the agent label, two left to detection); every fact on the session gold names, the worker facts the orchestrator's. */
export function checkCapture(id: string, turns: Array<{ actor: string; channel: string; text: string; thread?: string }>, gold: Gold, raw: string | undefined, ownerId: string): string | null {
  if (!raw) return `${id}: a session-capture task has no capture.json`;
  const plan = JSON.parse(raw) as CapturePlan;
  if (plan.task !== id || plan.launcher !== CAPTURE_LAUNCHER || plan.agent_label !== CAPTURE_AGENT || !LABEL_RE.test(plan.agent_label) || ['off', 'owner'].includes(plan.agent_label)) return `${id}: capture.json names another task, launcher or an invalid agent label`;
  if (turns.length !== 3 || turns.some((tt) => tt.actor !== ownerId || tt.channel !== 'dm' || tt.thread !== 'new')) return `${id}: a session-capture task needs three owner DM turns, each a new session`;
  if (plan.orchestrator_turn !== 3 || !turns[2]!.text.includes(`bash ${CAPTURE_LAUNCHER}`)) return `${id}: the third turn does not ask the harness to run the launcher`;
  const launches = plan.workers.map((w) => w.launch);
  if (plan.workers.length !== 4 || launches.filter((l) => l === 'env').length !== 2 || launches.filter((l) => l === 'detected').length !== 2) return `${id}: capture.json needs four workers, two with GBRAIN_SESSION_AGENT and two left to detection`;
  if (plan.workers.some((w, i) => w.n !== i + 1 || w.session !== 4 + i || w.agent !== (w.launch === 'env' ? plan.agent_label : null))) return `${id}: a worker's number, session or agent label is wrong`;
  if (JSON.stringify(gold.sessions) !== JSON.stringify(plan.sessions) || plan.sessions.length !== 7) return `${id}: gold.sessions and capture.json disagree, or there are not seven sessions`;
  if (gold.formats.length) return `${id}: a session-capture task has no import files`;
  for (const f of gold.facts) {
    if (!('session' in f.where)) return `${id}: ${f.id} has no session`;
    const s = plan.sessions.find((x) => x.n === (f.where as { session: number }).session);
    if (!s || s.kind === 'orchestrator') return `${id}: ${f.id} sits on no owner or worker session`;
    if (f.launch !== s.launch) return `${id}: ${f.id} has launch ${f.launch}, its session ${s.launch}`;
    const text = s.kind === 'owner' ? turns[s.turn! - 1]!.text : plan.workers[s.worker! - 1]!.brief;
    if (text.split(f.text).length !== 2) return `${id}: ${f.id}'s text is not in its session exactly once`;
    const worker = s.kind === 'worker';
    if (worker !== (f.claimant === 'agent:orchestrator') || (worker && (f.hard_case !== 'agent_brief_in_user_seat' || f.primary !== 'false_owner' || f.subject !== ownerId))) return `${id}: ${f.id}'s gold roles do not match its session (a worker brief's fact is agent:orchestrator's, about the owner)`;
  }
  if (plan.workers.some((w) => gold.facts.filter((f) => (f.where as { session?: number }).session === w.session).length !== 1)) return `${id}: every worker brief needs exactly one planted fact`;
  if (turns[2]!.text.match(/[A-Z][a-z]{5,9}/g)?.some((w) => gold.facts.some((f) => f.token === w))) return `${id}: the orchestrator turn carries a planted token`;
  return null;
}

export function checkAll(): string {
  const a = generateBank(DEV_SEED, 'dev', 15), b = generateBank(DEV_SEED, 'dev', 15);
  const da = digest(a);
  if (da !== digest(b)) throw new Error('the dev bank is not deterministic: two runs gave different digests');
  if (!existsSync(COMMITTED)) throw new Error(`${COMMITTED} is missing; write the dev bank there with generate.ts`);
  {
    const committed = new Map(walk(COMMITTED).map((p) => [relative(COMMITTED, p), readFileSync(p, 'utf8')]));
    const diff = [...new Set([...committed.keys(), ...a.keys()])].sort().find((k) => committed.get(k) !== a.get(k));
    if (diff) throw new Error(`${COMMITTED}/${diff} differs from the generator's output; regenerate the dev bank`);
  }
  const dev = checkBank(a, 'dev', 15);
  if (dev) throw new Error(`dev bank: ${dev}`);
  const probe = generateBank(PROBE_SEED, 'dev', 42);
  const p = checkBank(probe, 'dev', 42);
  if (p) throw new Error(`42-task probe bank: ${p}`);
  const facts = [...a.entries()].filter(([k]) => k.endsWith('gold.json')).reduce((s, [, v]) => s + (JSON.parse(v) as Gold).facts.length, 0);
  const worldSha = new Bun.CryptoHasher('sha256').update(a.get('world/world.json')!).digest('hex');
  return `PASS owner-identity: dev bank ${PROFILES[15]!.imports.length + PROFILES[15]!.live.length} import and live tasks and ${PROFILES[15]!.capture.length} session-capture tasks, ${facts} facts, digest ${da.slice(0, 12)}, world.json sha256 ${worldSha.slice(0, 12)}, matches ${COMMITTED}; dev bank meets its per-hard-case minimums; 42-task probe bank (with its ${PROFILES[42]!.capture.length} session-capture tasks) covers every hard case at least 6 times`;
}

if (import.meta.main) {
  try { console.log(checkAll()); }
  catch (e) { console.error(`FAIL ${(e as Error).message}`); process.exit(1); }
}
