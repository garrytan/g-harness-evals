// Synthetic personas for the gbrain time-to-first-wow eval (docs/benchmarks/2026-11-24-gbrain-first-wow/PREREGISTRATION.md).
//
// One fixture is a HOME directory for a new user who has already used Claude Code and Codex for a while: project folders plus the
// session files those two harnesses write (Claude Code: ~/.claude/projects/<encoded cwd>/<session>.jsonl; Codex:
// ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<session>.jsonl). Three facts are planted in the session files only, never in a
// project file, and the question session asks about them. Everything is generated from a seed: names, values, dates and where each
// fact sits, so no two seeds share an answer and nothing comes from a real person.
//
// Sessions fall in the 28 days before the fixture's "now" (the trial's start in a counted run), inside gbrain's 30-day import window.
//
// Personas rotate by seed (personaFor): history-rich (two projects, a coding-heavy user), messy (five projects, a value that was
// later changed, and the same kind of fact in another project as a decoy) and no-history (one project, no sessions). The home
// harness is the harness under test for Claude Code and Codex trials: questions 1 and 2 sit in its own history and question 3 in
// the other harness's history (the cross-harness question). QM and OpenClaw trials use the claude-code home.
import { createHash } from 'node:crypto';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { seededRandom } from '../../runner/stats/paired.ts';

export type PersonaKind = 'history-rich' | 'messy' | 'no-history';
export type Home = 'claude-code' | 'codex';
export type QuestionKind = 'flag' | 'port' | 'vendor';

export const HOME_DIR = '/home/dev';
export const SCHEMA = 'gbrain-first-wow-fixture/1';
/** The default "now" of a fixture. A counted trial passes its own start time, so every session falls in the 28 days before the trial
 *  and inside gbrain's 30-day import window; the seed alone fixes everything else. */
export const FIXTURE_NOW = Date.parse('2026-11-20T17:00:00Z');
export const HISTORY_DAYS = 28;

export interface PlantedQuestion {
  id: 'q1' | 'q2' | 'q3';
  kind: QuestionKind;
  /** The question as the person asks it. It never names gbrain, a harness or a file. */
  text: string;
  project: string;
  /** The feature, service or need the question is about, as the history words it. */
  topic: string;
  /** The value a correct answer gives; null on the no-history persona, where the right answer is that there is no record. */
  answer: string | null;
  /** An older value the history later replaced (messy persona, port question). Naming it beside the answer is allowed. */
  superseded: string | null;
  /** The same kind of fact for another project or feature. An answer that names one is wrong. */
  decoys: string[];
  /** The harness whose session files hold the answer. */
  source_harness: Home | null;
  /** HOME-relative session files that hold the answer (the newest one last). */
  source_files: string[];
  /** Asked in one harness, written in the other. */
  cross_harness: boolean;
}

export interface SessionInfo { path: string; harness: Home; project: string; started_at: string; ended_at: string; id: string }

export interface FixtureManifest {
  schema: typeof SCHEMA;
  seed: number;
  persona: PersonaKind;
  home: Home;
  now: string;
  home_dir: typeof HOME_DIR;
  projects: Array<{ name: string; dir: string }>;
  questions: PlantedQuestion[];
  sessions: SessionInfo[];
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

export interface Fixture { manifest: FixtureManifest; files: Map<string, string> }

const ROTATION: readonly PersonaKind[] = ['history-rich', 'messy'];

/** Verdict trials alternate history-rich and messy by seed; no-history trials are their own set (seeds from NO_HISTORY_SEED_BASE). */
export const NO_HISTORY_SEED_BASE = 9000;
export function personaFor(seed: number): PersonaKind {
  if (seed >= NO_HISTORY_SEED_BASE) return 'no-history';
  return ROTATION[seed % ROTATION.length]!;
}

const PROJECT_NAMES = ['tidepool', 'lanternfish', 'mossbank', 'kestrel-api', 'quillstone', 'brackenridge', 'harrowgate', 'fernwick', 'saltmarsh-web', 'cobblecrest', 'thistledown', 'larkspur-cli'];
const ADJ = ['amber', 'cobalt', 'russet', 'saffron', 'slate', 'juniper', 'umber', 'heron', 'ochre', 'pewter', 'sorrel', 'tamarind'];
const ANIMAL = ['quokka', 'pangolin', 'axolotl', 'okapi', 'tarsier', 'numbat', 'kinkajou', 'caracal', 'dugong', 'serow', 'binturong', 'markhor'];
const SYL = ['vel', 'tor', 'qua', 'nix', 'bra', 'dov', 'sel', 'mur', 'kai', 'zen', 'lor', 'pim', 'rax', 'tev', 'oss', 'wyn'];
const FEATURES = ['bulk CSV export', 'invite links', 'dark-mode toggle', 'usage alerts', 'saved searches', 'webhook retries', 'audit log view', 'team billing page'];
const SERVICES = ['API', 'worker', 'websocket gateway', 'image resizer'];
const NEEDS = ['transactional email', 'error tracking', 'feature-flag hosting', 'SMS verification', 'log storage', 'uptime checks'];
const CHORES = [
  'fix the flaky date test in the scheduler', 'add pagination to the list endpoint', 'bump the lint config and fix the warnings',
  'write a migration for the new column', 'clean up the unused env vars', 'speed up the slow integration test',
  'add a retry around the HTTP client', 'rename the helpers module', 'tighten the input validation on signup',
  'split the big component into two', 'add a health-check route', 'cache the config lookup',
];

type Rng = () => number;
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
function shuffle<T>(rng: Rng, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}
function uuid(rng: Rng): string {
  const h = Array.from({ length: 32 }, () => Math.floor(rng() * 16).toString(16)).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32);
}
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Distinct generated values; each draw is new within the fixture, so an answer and its decoys never collide. */
class Values {
  private used = new Set<string>();
  constructor(private rng: Rng) {}
  private fresh(make: () => string): string {
    for (;;) { const v = make(); if (!this.used.has(v)) { this.used.add(v); return v; } }
  }
  flag() { return this.fresh(() => 'ff_' + pick(this.rng, ADJ) + '_' + pick(this.rng, ANIMAL)); }
  port() { return this.fresh(() => String(40000 + Math.floor(this.rng() * 20000))); }
  vendor() {
    return this.fresh(() => {
      const w = pick(this.rng, SYL) + pick(this.rng, SYL) + pick(this.rng, ['ix', 'ora', 'ent', 'aly', 'ica', 'ex']);
      return w[0]!.toUpperCase() + w.slice(1);
    });
  }
}

interface Turn { role: 'user' | 'assistant'; text: string; tool?: { command: string; output: string } }

function choreTurns(rng: Rng, project: string): Turn[] {
  const chore = pick(rng, CHORES);
  const file = pick(rng, ['src/index.ts', 'src/routes.ts', 'src/db.ts', 'src/util/time.ts', 'test/app.test.ts']);
  const n = 3 + Math.floor(rng() * 40);
  return [
    { role: 'user', text: 'In ' + project + ', can you ' + chore + '?' },
    { role: 'assistant', text: 'Looking at the code first.', tool: { command: 'rg -n "export" ' + file, output: Array.from({ length: 4 }, (_, i) => file + ':' + (i * 7 + 3) + ':export function step' + i + '() {').join('\n') } },
    { role: 'assistant', text: 'Made the change in ' + file + ' and ran the tests.', tool: { command: 'bun test', output: n + ' pass\n0 fail\nRan ' + n + ' tests across 6 files.' } },
    { role: 'user', text: pick(rng, ['Thanks, looks good.', 'Great, ship it.', 'Perfect.', 'OK, commit that.']) },
  ];
}

function plantTurns(kind: QuestionKind, project: string, topic: string, value: string, previous: string | null): Turn[] {
  if (kind === 'flag') return [
    { role: 'user', text: 'For ' + project + ', the ' + topic + ' work should sit behind a feature flag until QA signs off. Name the flag ' + value + '.' },
    { role: 'assistant', text: 'Noted: the ' + topic + ' flag is ' + value + ', default off. I will wire it when the branch lands.' },
  ];
  if (kind === 'port') return previous ? [
    { role: 'user', text: 'The ' + project + ' staging ' + topic + ' keeps colliding with the metrics agent on ' + previous + '. Move it to ' + value + '.' },
    { role: 'assistant', text: 'Done: the ' + project + ' staging ' + topic + ' now listens on ' + value + ' instead of ' + previous + '. I left the deploy notes for you to update.' },
  ] : [
    { role: 'user', text: 'Set the ' + project + ' staging ' + topic + ' to listen on port ' + value + '.' },
    { role: 'assistant', text: 'Okay, the ' + project + ' staging ' + topic + ' uses port ' + value + '.' },
  ];
  return [
    { role: 'user', text: 'I compared a few providers for ' + topic + ' in ' + project + '. Let us go with ' + value + ': cheaper at our volume and it has an EU region.' },
    { role: 'assistant', text: 'Got it: ' + project + ' uses ' + value + ' for ' + topic + '. I will keep the integration behind one adapter so it is easy to swap.' },
  ];
}

function claudeSession(rng: Rng, id: string, cwd: string, start: number, turns: Turn[]): string {
  const lines: string[] = [];
  let parent: string | null = null;
  let t = start;
  const base = { isSidechain: false, userType: 'external', cwd, sessionId: id, version: '2.1.312', gitBranch: 'main' };
  const push = (o: Record<string, unknown>) => { const u = uuid(rng); lines.push(JSON.stringify({ parentUuid: parent, ...base, ...o, uuid: u, timestamp: new Date(t).toISOString() })); parent = u; t += 4000 + Math.floor(rng() * 50000); };
  for (const turn of turns) {
    if (turn.role === 'user') { push({ type: 'user', message: { role: 'user', content: turn.text } }); continue; }
    const content: unknown[] = [{ type: 'text', text: turn.text }];
    const toolId = 'toolu_' + uuid(rng).replace(/-/g, '').slice(0, 24);
    if (turn.tool) content.push({ type: 'tool_use', id: toolId, name: 'Bash', input: { command: turn.tool.command } });
    push({ type: 'assistant', message: { id: 'msg_' + uuid(rng).replace(/-/g, '').slice(0, 24), type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: turn.tool ? 'tool_use' : 'end_turn' } });
    if (turn.tool) push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: turn.tool.output }] } });
  }
  return lines.join('\n') + '\n';
}

function codexSession(rng: Rng, id: string, cwd: string, start: number, turns: Turn[]): string {
  let t = start;
  const lines: string[] = [];
  const push = (type: string, payload: Record<string, unknown>) => { lines.push(JSON.stringify({ timestamp: new Date(t).toISOString(), type, payload })); t += 3000 + Math.floor(rng() * 40000); };
  push('session_meta', { id, timestamp: new Date(start).toISOString(), cwd, originator: 'codex_cli_rs', cli_version: '0.165.0', instructions: null });
  for (const turn of turns) {
    if (turn.role === 'user') { push('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: turn.text }] }); continue; }
    push('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: turn.text }] });
    if (turn.tool) {
      const call = 'call_' + uuid(rng).replace(/-/g, '').slice(0, 20);
      push('response_item', { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', turn.tool.command] }), call_id: call });
      push('response_item', { type: 'function_call_output', call_id: call, output: JSON.stringify({ output: turn.tool.output, metadata: { exit_code: 0 } }) });
    }
  }
  return lines.join('\n') + '\n';
}

function sessionPath(harness: Home, project: string, id: string, start: number): string {
  if (harness === 'claude-code') return '.claude/projects/' + (HOME_DIR + '/src/' + project).replace(/[^A-Za-z0-9]/g, '-') + '/' + id + '.jsonl';
  const d = new Date(start).toISOString();
  return '.codex/sessions/' + d.slice(0, 4) + '/' + d.slice(5, 7) + '/' + d.slice(8, 10) + '/rollout-' + d.slice(0, 19).replace(/:/g, '-') + '-' + id + '.jsonl';
}

function projectFiles(name: string, feature: string, service: string): Map<string, string> {
  const dir = 'src/' + name + '/';
  return new Map([
    [dir + 'README.md', '# ' + name + '\n\nA small TypeScript service. Run it with \x60bun run dev\x60 and test it with \x60bun test\x60.\n\n## Roadmap\n\n- ' + feature + ' (in progress)\n- staging ' + service + ' hardening\n'],
    [dir + 'package.json', JSON.stringify({ name, version: '0.3.0', private: true, scripts: { dev: 'bun run src/index.ts', test: 'bun test' } }, null, 2) + '\n'],
    [dir + 'src/index.ts', 'import { routes } from "./routes.ts";\n\nexport function start(port = Number(process.env.PORT ?? 3000)) {\n  return Bun.serve({ port, fetch: routes });\n}\n'],
    [dir + 'src/routes.ts', 'export function routes(req: Request): Response {\n  const url = new URL(req.url);\n  if (url.pathname === "/health") return new Response("ok");\n  return new Response("not found", { status: 404 });\n}\n'],
    [dir + 'test/app.test.ts', 'import { expect, test } from "bun:test";\nimport { routes } from "../src/routes.ts";\n\ntest("health", () => {\n  expect(routes(new Request("http://x/health")).status).toBe(200);\n});\n'],
  ]);
}

const QUESTION_TEXT: Record<QuestionKind, (project: string, topic: string) => string> = {
  flag: (p, t) => 'What did we decide to name the feature flag for the ' + t + ' work in ' + p + '?',
  port: (p, t) => 'Which port does the ' + p + ' staging ' + t + ' listen on now?',
  vendor: (p, t) => 'Which provider did I pick for ' + t + ' in ' + p + '?',
};

interface Plan { kind: QuestionKind; id: PlantedQuestion['id']; harness: Home; cross: boolean }

/** The whole fixture for one seed, persona and home harness. Deterministic: the same arguments give byte-identical files. */
export function buildFixture(seed: number, persona: PersonaKind, home: Home, now = FIXTURE_NOW): Fixture {
  const rng = seededRandom(seed * 7919 + (home === 'codex' ? 1 : 0) * 104729 + 17);
  const other: Home = home === 'claude-code' ? 'codex' : 'claude-code';
  const nProjects = persona === 'messy' ? 5 : persona === 'history-rich' ? 2 : 1;
  const projects = shuffle(rng, PROJECT_NAMES).slice(0, nProjects);
  const features = shuffle(rng, FEATURES);
  const services = shuffle(rng, SERVICES);
  const needs = shuffle(rng, NEEDS);
  const values = new Values(rng);
  const files = new Map<string, string>();
  projects.forEach((p, i) => { for (const [k, v] of projectFiles(p, features[i % features.length]!, services[i % services.length]!)) files.set(k, v); });

  const plans: Plan[] = [
    { kind: 'flag', id: 'q1', harness: home, cross: false },
    { kind: 'port', id: 'q2', harness: home, cross: false },
    { kind: 'vendor', id: 'q3', harness: other, cross: true },
  ];
  const target = projects[0]!;
  const topicOf: Record<QuestionKind, string> = { flag: features[0]!, port: services[0]!, vendor: needs[0]! };
  const questions: PlantedQuestion[] = [];
  const sessions: SessionInfo[] = [];

  if (persona === 'no-history') {
    for (const p of plans) questions.push({ id: p.id, kind: p.kind, text: QUESTION_TEXT[p.kind](target, topicOf[p.kind]), project: target, topic: topicOf[p.kind], answer: null, superseded: null, decoys: [], source_harness: null, source_files: [], cross_harness: false });
    return finish(seed, persona, home, now, projects, questions, sessions, files);
  }

  const span = HISTORY_DAYS * 86400000;
  const nHome = persona === 'messy' ? 24 : 14;
  const nOther = persona === 'messy' ? 16 : 8;
  type Slot = { harness: Home; project: string; start: number; turns: Turn[]; id: string };
  const slots: Slot[] = [];
  const addSlots = (harness: Home, n: number) => {
    for (let i = 0; i < n; i++) {
      const project = i < 2 ? target : pick(rng, projects);
      const start = now - span + Math.floor(rng() * (span - 86400000));
      const turns: Turn[] = [];
      const chores = 1 + Math.floor(rng() * 3);
      for (let c = 0; c < chores; c++) turns.push(...choreTurns(rng, project));
      slots.push({ harness, project, start, turns, id: uuid(rng) });
    }
  };
  addSlots(home, nHome);
  addSlots(other, nOther);

  const sessionsOf = (harness: Home, project: string) => slots.filter(s => s.harness === harness && s.project === project).sort((a, b) => a.start - b.start);
  const insert = (s: Slot, ts: Turn[]) => { const at = Math.floor(rng() * (s.turns.length + 1)); s.turns.splice(at - (at % 2), 0, ...ts); };
  const plantedIn = new Map<string, Slot[]>();
  for (const p of plans) {
    const own = sessionsOf(p.harness, target);
    const answer = p.kind === 'flag' ? values.flag() : p.kind === 'port' ? values.port() : values.vendor();
    const q: PlantedQuestion = { id: p.id, kind: p.kind, text: QUESTION_TEXT[p.kind](target, topicOf[p.kind]), project: target, topic: topicOf[p.kind], answer, superseded: null, decoys: [], source_harness: p.harness, source_files: [], cross_harness: p.cross };
    const holders: Slot[] = [];
    if (persona === 'messy' && p.kind === 'port' && own.length >= 2) {
      const older = own[0]!, newer = own[own.length - 1]!;
      const previous = values.port();
      q.superseded = previous;
      insert(older, plantTurns('port', target, topicOf.port, previous, null));
      insert(newer, plantTurns('port', target, topicOf.port, answer, previous));
      holders.push(newer);
    } else {
      const s = own[Math.floor(rng() * own.length)]!;
      insert(s, plantTurns(p.kind, target, topicOf[p.kind], answer, null));
      holders.push(s);
    }
    if (persona === 'messy') {
      const decoyProject = projects[1 + Math.floor(rng() * (projects.length - 1))]!;
      const decoy = p.kind === 'flag' ? values.flag() : p.kind === 'port' ? values.port() : values.vendor();
      const decoyTopic = p.kind === 'flag' ? features[1]! : topicOf[p.kind];
      const pool = slots.filter(s => s.project === decoyProject);
      insert(pick(rng, pool), plantTurns(p.kind, decoyProject, decoyTopic, decoy, null));
      q.decoys.push(decoy);
    }
    plantedIn.set(p.id, holders);
    questions.push(q);
  }

  for (const s of slots) {
    const path = sessionPath(s.harness, s.project, s.id, s.start);
    const cwd = HOME_DIR + '/src/' + s.project;
    const body = s.harness === 'claude-code' ? claudeSession(rng, s.id, cwd, s.start, s.turns) : codexSession(rng, s.id, cwd, s.start, s.turns);
    files.set(path, body);
    const ended = JSON.parse(body.trimEnd().split('\n').pop()!).timestamp as string;
    sessions.push({ path, harness: s.harness, project: s.project, started_at: new Date(s.start).toISOString(), ended_at: ended, id: s.id });
  }
  for (const q of questions) q.source_files = (plantedIn.get(q.id) ?? []).map(s => sessionPath(s.harness, s.project, s.id, s.start));
  sessions.sort((a, b) => a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0);
  return finish(seed, persona, home, now, projects, questions, sessions, files);
}

function finish(seed: number, persona: PersonaKind, home: Home, now: number, projects: string[], questions: PlantedQuestion[], sessions: SessionInfo[], files: Map<string, string>): Fixture {
  const listed = [...files.keys()].sort().map(path => ({ path, bytes: Buffer.byteLength(files.get(path)!), sha256: sha256(files.get(path)!) }));
  return {
    manifest: { schema: SCHEMA, seed, persona, home, now: new Date(now).toISOString(), home_dir: HOME_DIR, projects: projects.map(name => ({ name, dir: 'src/' + name })), questions, sessions, files: listed },
    files,
  };
}

/** The question session's one prompt. It names no tool, harness, memory or file. */
export function questionPrompt(m: FixtureManifest): string {
  return 'I am picking things back up after a break and want to check a few things from my past work.\n\n'
    + m.questions.map((q, i) => (i + 1) + '. ' + q.text).join('\n')
    + '\n\nAnswer each one as a numbered list in the same order, and for each say exactly where you found it, so I can check it myself. If you cannot find something, say so.';
}

/** Writes the fixture under dir as HOME, plus fixture.json (the manifest, which the agent never sees) beside it. Each session file's
 *  modification time is its last message, because gbrain's import preview orders files by modification time. */
export function writeFixture(f: Fixture, homeDir: string, manifestPath: string): void {
  const ended = new Map(f.manifest.sessions.map(s => [s.path, new Date(s.ended_at)]));
  for (const [rel, body] of f.files) {
    const p = join(homeDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
    const t = ended.get(rel);
    if (t) utimesSync(p, t, t);
  }
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(f.manifest, null, 2) + '\n');
}

if (import.meta.main) {
  const [seedArg, homeArg, out, nowArg] = process.argv.slice(2);
  const home = (homeArg ?? 'claude-code') as Home;
  if (!seedArg || !out || !['claude-code', 'codex'].includes(home)) {
    console.error('usage: bun scripts/gbrain-first-wow/fixtures.ts <seed> <claude-code|codex> <out dir> [<now, ISO time>]   (writes <out>/home and <out>/fixture.json)');
    process.exit(2);
  }
  const seed = Number(seedArg);
  const f = buildFixture(seed, personaFor(seed), home, nowArg ? Date.parse(nowArg) : FIXTURE_NOW);
  writeFixture(f, join(out, 'home'), join(out, 'fixture.json'));
  console.log('FIXTURE: seed=' + seed + ' persona=' + f.manifest.persona + ' home=' + home + ' files=' + f.files.size + ' sessions=' + f.manifest.sessions.length);
}
