// Pure parts of the S1 edition rerun (internal-task-a, plan in the internal-task-b handoff): the task input, the edition (gstack's
// qm/edition.json and its three gstack-<family> skills, internal-task) as QM skills, the seeded trial order, the counters, the per-trial clean-arm check, the status of a trial and the turn
// record. No I/O; s1e-probe.ts calls these once per trial and tests/qm-s1e-probe.test.ts feeds them stored sessions.
//
// The edition reaches QM as org skills through the deployment layer (PUT /v1/deployment-layer, see the README). QM
// lists every skill in a "## Skills" block of the system prompt (one "- <name>" line each, then INDEX_DASH and the
// description) and loads a body on demand with its skill tool (skills with action read at b6786d67, skill at main), stored as a tool_call {tool: "skills", action: "read", name} and a tool_result {found, bytes,
// result, dir?}. A skill that ships no file besides SKILL.md is answered from the store and never synced to the
// computer; one that ships files is synced to /root/workspace/.agent-skills/<thread>/<version>/<name>/ on read.
import { createHash } from 'node:crypto';
import { toolCalls, type Call, type Entry } from './s1-count.ts';
import { seededRandom } from '../../../runner/stats/paired.ts';
import type { summarizeUsage } from '../../../runner/trial/proxy.ts';

export const ARMS = ['plain', 'edition', 'forced'] as const;
export type Arm = (typeof ARMS)[number];
export const FAMILIES = ['investigate', 'review', 'plan'] as const;
export type Family = (typeof FAMILIES)[number];
export const STATUSES = ['ok', 'turn_error', 'model_error', 'infra_error', 'context_length', 'timeout'] as const;
export type Status = (typeof STATUSES)[number];
/** Pending command approvals the driver answers in one trial before the trial becomes a turn_error. */
export const APPROVAL_CAP = 5;

export interface Task { id: string; family: Family; request: string; repo_dir: string; first_step: { skill: Family } }
export interface EditionFile { path: string; content: string; sha256: string; executable?: true }
export interface EditionSkill { name: string; description: string; body: string; files: EditionFile[] }
export type Markers = Record<string, { execute_regex: string }>;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** tasks.json: an array of task records. Throws on the first malformed record, a duplicate id or a relative repo_dir. */
export function parseTasks(json: unknown): Task[] {
  if (!Array.isArray(json) || !json.length) throw new Error('tasks.json must be a non-empty array');
  const ids = new Set<string>();
  return json.map((t, i) => {
    const where = 'tasks.json[' + i + ']';
    if (!isObj(t)) throw new Error(where + ' is not an object');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(str(t.id))) throw new Error(where + '.id must be a plain id');
    if (ids.has(str(t.id))) throw new Error(where + ': duplicate id ' + t.id);
    ids.add(str(t.id));
    if (!FAMILIES.includes(t.family as Family)) throw new Error(where + '.family must be one of ' + FAMILIES.join(', '));
    if (!str(t.request).trim()) throw new Error(where + '.request is empty');
    if (!str(t.repo_dir).startsWith('/')) throw new Error(where + '.repo_dir must be an absolute path');
    const skill = isObj(t.first_step) ? t.first_step.skill : undefined;
    if (!FAMILIES.includes(skill as Family)) throw new Error(where + '.first_step.skill must be one of ' + FAMILIES.join(', '));
    return { id: str(t.id), family: t.family as Family, request: str(t.request), repo_dir: str(t.repo_dir), first_step: { skill: skill as Family } };
  });
}

/** name, description and the body after the closing fence of a SKILL.md, the fields QM's deployment layer keeps
 *  (src/skills/frontmatter.ts parseSeedSkillFrontmatter). Single-line values only; a block value reads as null. */
export function splitFrontmatter(text: string): { name: string | null; description: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { name: null, description: null, body: text };
  const field = (k: string) => {
    const v = new RegExp('^' + k + ':[ \\t]*(.*)$', 'm').exec(m[1]!)?.[1]?.trim() ?? '';
    const unq = v.replace(/^(["'])(.*)\1$/, '$2');
    return unq && !/^[>|]/.test(unq) ? unq : null;
  };
  return { name: field('name'), description: field('description'), body: m[2]! };
}

/** The edition skill a task's family opens: gstack-<family> (qm/edition.json at the pinned gstack commit). */
export const skillFor = (family: string) => 'gstack-' + family;

/** The edition from gstack's qm/edition.json and the layer files as qm up reads them (paths relative to the deploy dir's
 *  sandbox/skills/, <id>/<file>). Each skill in the manifest needs exactly its listed files, a SKILL.md whose frontmatter
 *  name is its id, and a first_step_marker; the markers come from the manifest, never from this code. */
export function editionFrom(manifest: unknown, files: Array<{ path: string; content: string; executable?: boolean }>): { skills: EditionSkill[]; markers: Markers } {
  const m = isObj(manifest) ? manifest : {};
  const listed = Array.isArray(m.skills) ? m.skills.filter(isObj) : [];
  if (!listed.length) throw new Error('edition.json lists no skills');
  const markers: Markers = {};
  const skills = listed.map((entry) => {
    const id = str(entry.id);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) throw new Error('edition.json: bad skill id ' + JSON.stringify(entry.id));
    const want = (Array.isArray(entry.files) ? entry.files.map(str) : []).slice().sort();
    const mine = files.filter((f) => f.path.startsWith(id + '/')).map((f) => ({ ...f, path: f.path.slice(id.length + 1) })).sort((a, b) => (a.path < b.path ? -1 : 1));
    if (JSON.stringify(mine.map((f) => f.path)) !== JSON.stringify(want)) throw new Error('edition: ' + id + ' holds ' + JSON.stringify(mine.map((f) => f.path)) + ', edition.json lists ' + JSON.stringify(want));
    for (const f of mine) if (f.content.includes('\u0000') || f.path.split('/').some((p) => !p || p === '..' || p === '.')) throw new Error('edition: ' + id + '/' + f.path + ' is not a text file at a safe path');
    const fm = splitFrontmatter(mine.find((f) => f.path === 'SKILL.md')?.content ?? '');
    if (fm.name !== id) throw new Error('edition: ' + id + '/SKILL.md names ' + (fm.name ?? 'no skill') + '; the frontmatter name must be the skill id');
    if (!fm.description) throw new Error('edition: ' + id + '/SKILL.md has no single-line description');
    if (!fm.body.trim()) throw new Error('edition: ' + id + '/SKILL.md has an empty body');
    if (!str(entry.first_step_marker)) throw new Error('edition.json: ' + id + ' has no first_step_marker');
    new RegExp(str(entry.first_step_marker));
    markers[id] = { execute_regex: str(entry.first_step_marker) };
    return { name: id, description: fm.description, body: fm.body, files: mine.map((f) => ({ path: f.path, content: f.content, sha256: sha256(f.content), ...(f.executable ? { executable: true as const } : {}) })) };
  });
  const stray = files.filter((f) => !skills.some((s) => f.path.startsWith(s.name + '/')));
  if (stray.length) throw new Error('edition: files outside the listed skills: ' + stray.map((f) => f.path).join(', '));
  return { skills, markers };
}

/** The body of PUT /v1/deployment-layer that qm up sends for a deploy dir holding the edition under sandbox/skills/: QM's
 *  CLI at 850599e9 (cli/src/deployment-layer.ts deploymentLayerBundle and normalizedLayerBody) sends contract 1, no tools,
 *  and one {path: "skills/<id>/<file>", content, executable?} per file, sorted by path. */
export function layerBundle(edition: EditionSkill[]): { contract: 1; tools: never[]; skills: Array<{ path: string; content: string; executable?: true }> } {
  const skills = edition.flatMap((s) => s.files.map((f) => ({ path: 'skills/' + s.name + '/' + f.path, content: f.content, ...(f.executable ? { executable: true as const } : {}) })));
  return { contract: 1, tools: [], skills: skills.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
}

export type ModelKey = 'opus' | 'sol';
export interface PlannedTrial { trial_id: string; task: Task; arm: Arm; model: ModelKey; rep: number; fault?: 'edition-in-plain' }

/** Every (task, arm, model, rep) once, in a seeded order: a Fisher-Yates shuffle driven by runner/stats/paired.ts
 *  seededRandom, so arms of one model interleave and the same inputs and seed give the same order on every machine. */
export function trialPlan(tasks: Task[], arms: readonly Arm[], models: readonly ModelKey[], reps: number, seed: number): PlannedTrial[] {
  const all: PlannedTrial[] = tasks.flatMap((task) => models.flatMap((model) => arms.flatMap((arm) => Array.from({ length: reps }, (_, k) => ({ trial_id: task.id + '-' + arm + '-' + model + '-k' + (k + 1), task, arm, model, rep: k + 1 })))));
  const rand = seededRandom(seed);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [all[i], all[j]] = [all[j]!, all[i]!]; }
  return all;
}

/** What the driver does with a turn answer: the next pending approval to answer once, a stop, or nothing (the turn ended). */
export function nextApproval(body: unknown, answered: ReadonlySet<string>, cap = APPROVAL_CAP): { requestId: string; command: string } | { stop: 'over_cap' | 'repeat' | 'no_request' } | null {
  const b = isObj(body) ? body : {};
  if (b.status !== 'pending_approval') return null;
  const pending = Array.isArray(b.pendingApprovals) ? b.pendingApprovals.filter(isObj) : [];
  const next = pending.find((p) => str(p.requestId) && !answered.has(str(p.requestId)));
  if (!next) return { stop: pending.length ? 'repeat' : 'no_request' };
  if (answered.size >= cap) return { stop: 'over_cap' };
  return { requestId: str(next.requestId), command: str(next.command) };
}

const SEGMENT = /;|&&|\|\||\||\n/;
const READS = /^\s*\(?\s*(?:cat|sed|head)\b/;
const SYNCED_SKILL = /\.agent-skills\/[^\s'";|&]*?\/([\w.-]+)\/SKILL\.md/g;
/** QM's marker on a tool result it cut at the inline budget (src/sessions/tool-output.ts). */
const CUT_MARKER = /…\[output cut: showing the first (\d+) and last (\d+) of (\d+) chars\. The full output is in (tool-output\/[\w/]+);[^\]]*\]…/;
const command = (c: Call) => (c.tool === 'execute' ? str(c.args.command) : '');
const resultText = (c: Call) => str(c.result?.result);
const ran = (c: Call) => !!c.result && c.result.isError !== true && !/^Validation failed for tool/.test(resultText(c));
const isCut = (c: Call) => { const o = c.result?.output as { chars?: unknown; shownChars?: unknown } | undefined; return !!o && typeof o.chars === 'number' && typeof o.shownChars === 'number' && o.shownChars < o.chars; };
const syncedSkillOf = (path: string) => [...path.matchAll(SYNCED_SKILL)].find((m) => m.index! + m[0].length === path.length)?.[1] ?? null;
const syncedSkills = (text: string) => [...text.matchAll(SYNCED_SKILL)].map((m) => m[1]!);

export interface EditionOpen { seq: number; skill: string; via: 'skill' | 'files' | 'execute' }

/** Loads of an edition skill's body: a skill tool call QM answered with SKILL.md (found: true, no other path; the open the
 *  counts use), a files read of the synced .agent-skills/.../<name>/SKILL.md, or an execute that exited 0 with a cat, sed
 *  or head segment naming it (both kept in the trial detail and used for complete reads). */
export function editionOpens(calls: Call[], names: ReadonlySet<string>): EditionOpen[] {
  const out: EditionOpen[] = [];
  for (const c of calls) {
    if (c.tool === 'skills' && str(c.args.action) === 'read') {
      const name = str(c.args.name);
      const path = str(c.args.path);
      if (names.has(name) && (!path || path === 'SKILL.md') && c.result?.found === true && ran(c)) out.push({ seq: c.seq, skill: name, via: 'skill' });
    } else if (c.tool === 'files' && str(c.args.action) === 'read') {
      const skill = syncedSkillOf(str(c.result?.path) || str(c.args.path));
      if (skill && names.has(skill) && c.result?.found === true && ran(c)) out.push({ seq: c.seq, skill, via: 'files' });
    } else if (c.tool === 'execute' && c.result?.code === 0) {
      for (const seg of command(c).split(SEGMENT).filter((s) => READS.test(s))) for (const skill of syncedSkills(seg)) if (names.has(skill)) out.push({ seq: c.seq, skill, via: 'execute' });
    }
  }
  return out;
}

const deliveredLines = (text: string) => text.replace(CUT_MARKER, '\n').split('\n');

/** How the whole matched body reached the model, if it did: soul (the first request's system prompt holds the body, the
 *  forced arm), inline (one uncut load delivers every non-blank line), cut (a cut load plus later reads of its parked
 *  tool-output copy or of the synced path deliver every line) or pieces (execute reads of the synced path alone do). QM
 *  rewrites skills/<name>/ in a body to the synced directory (src/skills/materialize.ts rehomeSkillPaths), so a line
 *  holding it also matches with the directory a load reported. */
export function editionCompleteRead(calls: Call[], skill: EditionSkill, firstSystem: string | null): 'soul' | 'inline' | 'cut' | 'pieces' | null {
  if (firstSystem !== null && firstSystem.includes(skill.body.trim())) return 'soul';
  const names = new Set([skill.name]);
  const loads = calls.filter((c) => editionOpens([c], names).some((o) => o.via !== 'execute'));
  const dirs = loads.map((c) => str(c.result?.dir)).filter(Boolean);
  const lines = skill.body.split('\n').filter((l) => l.trim());
  const covers = (delivered: Set<string>) => lines.every((l) => delivered.has(l) || dirs.some((d) => delivered.has(l.split('skills/' + skill.name + '/').join(d + '/'))));
  if (loads.some((c) => !isCut(c) && covers(new Set(deliveredLines(resultText(c)))))) return 'inline';
  const parked = new Set<string>();
  for (const c of loads) { const m = CUT_MARKER.exec(resultText(c)); if (m) parked.add(m[4]!.split('/').pop()!); }
  const namesPath = (c: Call) => { const s = c.raw + ' ' + str(c.result?.path); return [...parked].some((id) => s.includes(id)) || syncedSkills(s).includes(skill.name); };
  const pieces = calls.filter((c) => !loads.includes(c) && (c.tool === 'execute' || c.tool === 'files') && ran(c) && namesPath(c));
  if (!covers(new Set([...loads, ...pieces].flatMap((c) => deliveredLines(resultText(c)))))) return null;
  return loads.some(isCut) ? 'cut' : pieces.length ? 'pieces' : null;
}

/** What QM puts between a skill's name and its description in the "## Skills" block: a spaced U+2014 dash. */
export const INDEX_DASH = ' \u2014 ';
/** The skill's line in QM's "## Skills" block (src/skills/materialize.ts skillsIndex). */
export const indexHas = (system: string, name: string) => ('\n' + system).includes('\n- ' + name + INDEX_DASH);
/** The skill's index line carries its whole description, not one QM shortened to fit the index budget. */
export const indexIntact = (system: string, s: Pick<EditionSkill, 'name' | 'description'>) => system.split('\n').includes('- ' + s.name + INDEX_DASH + s.description);

/** What the driver read back around the turn: the synced files under .agent-skills (null when the listing could not be
 *  read), the first model request's system prompt, the skill paths of the stored deployment layer and the org SOUL. */
export interface CleanEvidence { agent_skills: string[] | null; first_system: string | null; layer_paths: string[] | null; soul: string | null }

/** The per-trial clean-arm check. plain must hold no edition anywhere: no layer skill, no index line, no body in the SOUL
 *  or the prompt, no synced edition file and no edition body in any tool answer. edition and forced must hold the whole
 *  edition in the layer and every index line in the first prompt; forced also the matched body as the SOUL and in the
 *  prompt, edition never in the SOUL. A synced tree is expected only after a load of a skill that ships files besides
 *  SKILL.md, because QM syncs nothing else. Evidence that could not be read is a problem in every arm. */
export function cleanArm(arm: Arm, edition: EditionSkill[], matched: string, ev: CleanEvidence, calls: Call[]): { contaminated: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const [k, v] of Object.entries(ev)) if (v === null) problems.push('unverified: ' + k + ' unread');
  const synced = (ev.agent_skills ?? []).filter((p) => p.includes('/.agent-skills/') && edition.some((s) => p.includes('/' + s.name + '/')));
  const inSystem = (text: string) => ev.first_system !== null && ev.first_system.includes(text.trim());
  const target = edition.find((s) => s.name === matched);
  if (arm === 'plain') {
    if (ev.layer_paths?.length) problems.push('deployment layer holds ' + ev.layer_paths.length + ' skill file(s)');
    for (const s of edition) {
      if (ev.first_system !== null && indexHas(ev.first_system, s.name)) problems.push('first prompt lists ' + s.name);
      if (inSystem(s.body)) problems.push('first prompt holds the ' + s.name + ' body');
      if (ev.soul?.includes(s.body.trim())) problems.push('org SOUL holds the ' + s.name + ' body');
      const line = s.body.split('\n').find((l) => l.trim().length >= 24);
      if (line && calls.some((c) => resultText(c).includes(line))) problems.push('a tool answer delivered the ' + s.name + ' body');
    }
    if (synced.length) problems.push('.agent-skills holds edition file(s): ' + synced.slice(0, 3).join(', '));
    return { contaminated: problems.length > 0, problems };
  }
  const want = layerBundle(edition).skills.map((f) => f.path).sort();
  if (ev.layer_paths && JSON.stringify(ev.layer_paths.slice().sort()) !== JSON.stringify(want)) problems.push('deployment layer skill files differ from the edition');
  if (ev.first_system !== null) for (const s of edition) if (!indexHas(ev.first_system, s.name)) problems.push('first prompt does not list ' + s.name); else if (!indexIntact(ev.first_system, s)) problems.push('first prompt shortens the ' + s.name + ' description');
  if (!target) problems.push('no edition skill named ' + matched);
  else if (arm === 'forced') {
    if (ev.soul !== null && ev.soul.trim() !== target.body.trim()) problems.push('org SOUL is not the ' + matched + ' body');
    if (ev.first_system !== null && !inSystem(target.body)) problems.push('first prompt does not hold the ' + matched + ' body');
  } else if (ev.soul?.includes(target.body.trim())) problems.push('org SOUL holds the ' + matched + ' body');
  for (const s of edition.filter((s) => s.files.length > 1)) {
    const loaded = editionOpens(calls, new Set([s.name])).some((o) => o.via === 'skill');
    if (loaded && ev.agent_skills !== null && !synced.some((p) => p.includes('/' + s.name + '/'))) problems.push(s.name + ' was loaded but nothing was synced to .agent-skills');
  }
  return { contaminated: problems.length > 0, problems };
}

/** The seq of the call after which the skill's whole body had reached the model: the shortest prefix of the calls for
 *  which editionCompleteRead holds. */
export function deliveredAt(calls: Call[], skill: EditionSkill, firstSystem: string | null): number {
  const sorted = [...calls].sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < sorted.length; i++) if (editionCompleteRead(sorted.slice(0, i + 1), skill, firstSystem) !== null) return sorted[i]!.seq;
  return Infinity;
}

export interface Counts { open_matched: boolean; open_any: boolean; complete_read: boolean; first_step: boolean; approvals_answered: number; contaminated: boolean }
export interface CountDetail { opens: EditionOpen[]; complete_via: ReturnType<typeof editionCompleteRead>; read_whole: boolean; first_step_runs: Array<{ seq: number; command: string; code: number | null; output: string }>; path_rewrite: { expected: boolean; dir: string | null; rewritten: boolean | null }; first_step_anywhere: boolean; other_skill_reads: string[]; clean: ReturnType<typeof cleanArm> }

/** Whether QM rewrote skills/<name>/ in the matched body to the synced folder (src/skills/materialize.ts:22-33
 *  rehomeSkillPaths), read from the first skill tool answer for it: expected when the body names skills/<name>/, rewritten
 *  when the answer names <dir>/ (the folder QM reported) and no skills/<name>/ is left. */
export function pathRewrite(calls: Call[], skill: EditionSkill): CountDetail['path_rewrite'] {
  const expected = skill.body.includes('skills/' + skill.name + '/');
  const load = calls.find((c) => editionOpens([c], new Set([skill.name])).some((o) => o.via === 'skill'));
  if (!load) return { expected, dir: null, rewritten: null };
  const dir = str(load.result?.dir) || null;
  const text = resultText(load);
  return { expected, dir, rewritten: expected ? !!dir && text.includes(dir + '/') && !text.includes('skills/' + skill.name + '/') : null };
}

/** One trial's counts. open_matched and open_any: a skill tool call QM answered with the matched (or any) edition body.
 *  complete_read: the whole matched body reached the model by any route; read_whole: one skill tool answer delivered it
 *  uncut, with no park marker. first_step: an execute that ran and matches the matched skill's marker, after the matched
 *  body reached the model whole (after the call that completed the delivery, or from the start when the body is in the
 *  system prompt), so a command run before a cut load was completed does not count.
 *  first_step_anywhere drops that order, for the plain arm's baseline. */
export function countTrial(t: { arm: Arm; matched: string; entries: Entry[]; edition: EditionSkill[]; markers: Markers; approvalsAnswered: number; evidence: CleanEvidence }): { counts: Counts; detail: CountDetail } {
  const calls = toolCalls(t.entries);
  const names = new Set(t.edition.map((s) => s.name));
  const opens = editionOpens(calls, names);
  const skillOpens = opens.filter((o) => o.via === 'skill');
  const matched = skillOpens.filter((o) => o.skill === t.matched);
  const skill = t.edition.find((s) => s.name === t.matched);
  const via = skill ? editionCompleteRead(calls, skill, t.evidence.first_system) : null;
  const marker = t.markers[t.matched] ? new RegExp(t.markers[t.matched]!.execute_regex) : null;
  const after = !skill || via === null ? Infinity : via === 'soul' ? -Infinity : deliveredAt(calls, skill, t.evidence.first_system);
  const steps = marker ? calls.filter((c) => c.tool === 'execute' && ran(c) && marker.test(command(c))) : [];
  const clean = cleanArm(t.arm, t.edition, t.matched, t.evidence, calls);
  return {
    counts: { open_matched: matched.length > 0, open_any: skillOpens.length > 0, complete_read: via !== null, first_step: steps.some((c) => c.seq > after), approvals_answered: t.approvalsAnswered, contaminated: clean.contaminated },
    detail: { opens, complete_via: via, read_whole: !!skill && matched.some((o) => { const c = calls.find((x) => x.seq === o.seq)!; return !CUT_MARKER.test(resultText(c)) && editionCompleteRead([c], skill, null) === 'inline'; }), first_step_runs: steps.map((c) => ({ seq: c.seq, command: command(c).slice(0, 300), code: typeof c.result?.code === 'number' ? c.result.code : null, output: resultText(c).slice(0, 300) })), path_rewrite: skill ? pathRewrite(calls, skill) : { expected: false, dir: null, rewritten: null }, first_step_anywhere: steps.length > 0, other_skill_reads: calls.filter((c) => c.tool === 'skills' && str(c.args.action) === 'read' && !names.has(str(c.args.name))).map((c) => str(c.args.name)), clean },
  };
}

const CONTEXT = /context[_ ]length|context window|prompt is too long|maximum context|too many tokens/i;
const TIMEOUT = /timed? ?out|timeout|wall[- ]?clock/i;

/** A trial's status. A cap stop is model_error (runner/trial/trial.ts trialTermination) and ends the run; a stack
 *  failure is infra_error. A turn QM finished is ok and graded even when the evidence read-back failed (the failure is
 *  the status reason, and the clean-arm check reports what it could not see), so a finished reply is never rerun. A
 *  turn QM did not finish is context_length or timeout when its answer says so, model_error only when the turn's last
 *  provider call (the cell model's; the driver leaves housekeeping calls out of lines) failed (failed, 429 or 5xx), so a provider error QM recovered from does not exclude the trial, else
 *  turn_error, as is a trial whose approvals went past the cap. */
export function trialStatus(o: { capStop: boolean; stackError?: string; evidenceError?: string; approvalStop?: string; turn: { http: number; body: unknown } | null; lines: ReadonlyArray<{ outcome: string; status?: number }> }): { status: Status; reason: string | null } {
  if (o.capStop) return { status: 'model_error', reason: 'cap stop (HE-BUDGET-001)' };
  if (o.stackError) return { status: 'infra_error', reason: o.stackError };
  if (!o.turn) return { status: 'infra_error', reason: 'no turn answer' };
  const b = isObj(o.turn.body) ? o.turn.body : {};
  const text = typeof o.turn.body === 'string' ? o.turn.body : [str(b.reason), str(b.errorCode), str(b.error), str(b.message)].join(' ');
  if (o.turn.http === 0) return { status: TIMEOUT.test(text) ? 'timeout' : 'infra_error', reason: 'POST /v1/turns: ' + text.slice(0, 300) };
  if (o.approvalStop) return { status: 'turn_error', reason: o.approvalStop };
  if (o.turn.http === 200 && b.status === 'ok') return { status: 'ok', reason: o.evidenceError ? 'evidence read-back failed: ' + o.evidenceError : null };
  const reason = 'POST /v1/turns answered ' + o.turn.http + ' ' + JSON.stringify(o.turn.body ?? null).slice(0, 300);
  if (CONTEXT.test(text)) return { status: 'context_length', reason };
  if (TIMEOUT.test(text)) return { status: 'timeout', reason };
  const lastCall = o.lines[o.lines.length - 1];
  if (lastCall && (lastCall.outcome === 'failed' || lastCall.status === 429 || (lastCall.status !== undefined && lastCall.status >= 500))) return { status: 'model_error', reason };
  return { status: 'turn_error', reason };
}

/** One line of turns.jsonl (the shared interface with the grader half): these keys and no others. */
export interface TurnRecord {
  trial_id: string; task_id: string; family: Family; arm: Arm; model: string; rep: number; status: Status; reply_text: string;
  counts: Counts; usage: ReturnType<typeof summarizeUsage>['usage'] | null; wall_s: number | null;
}

/** Counts per model and arm: ok trials carry the counts, every other status is named; contaminated trials are listed
 *  whatever their status. */
export function summarize(records: TurnRecord[]) {
  const out: Record<string, unknown> = {};
  for (const model of [...new Set(records.map((r) => r.model))].sort()) for (const arm of ARMS) {
    const all = records.filter((r) => r.model === model && r.arm === arm);
    if (!all.length) continue;
    const ok = all.filter((r) => r.status === 'ok');
    const n = (k: keyof Counts) => ok.filter((r) => r.counts[k] === true).length;
    out[model + '/' + arm] = {
      trials: all.length, ok: ok.length,
      by_status: Object.fromEntries(STATUSES.map((s) => [s, all.filter((r) => r.status === s).length])),
      not_ok: all.filter((r) => r.status !== 'ok').map((r) => ({ trial_id: r.trial_id, status: r.status })),
      open_matched: n('open_matched'), open_any: n('open_any'), complete_read: n('complete_read'), first_step: n('first_step'),
      approvals_answered: all.reduce((a, r) => a + r.counts.approvals_answered, 0),
      contaminated: all.filter((r) => r.counts.contaminated).map((r) => r.trial_id),
      usd: all.reduce((a, r) => a + (r.usage?.usd ?? 0), 0), wall_s: all.reduce((a, r) => a + (r.wall_s ?? 0), 0),
    };
  }
  return out;
}
