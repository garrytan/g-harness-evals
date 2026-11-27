// The gbrain first-wow eval's cell fields, their checks and the setup commands (runner/trial/first-wow.ts runs the trial). Kept apart
// so runner/run.ts can import the checks without loading the trial driver.

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RunnerError } from '../errors.ts';

export const FIRST_WOW_SLICE = 'gbrain-first-wow';
export const FIRST_WOW_HARNESSES: readonly string[] = ['claude-code', 'codex', 'qm'];
export const FIRST_WOW_ARMS = ['defaults', 'pr1', 'full', 'plain', 'qm-native'] as const;
export type FirstWowArm = (typeof FIRST_WOW_ARMS)[number];
/** The arms each harness runs. QM has no gbrain setup, so it runs gbrain as its memory provider against plain QM (PREREGISTRATION.md, QM). */
export const ARMS_BY_HARNESS: Record<string, readonly FirstWowArm[]> = { 'claude-code': ['defaults', 'pr1', 'full', 'plain'], codex: ['defaults', 'pr1', 'full', 'plain'], qm: ['qm-native', 'plain'] };
/** The QM config of each QM arm (harnesses/qm/prepare.sh). */
export const QM_CONFIG: Record<string, string> = { 'qm-native': 'pi-memory-provider', plain: 'pi' };
/** The member the QM person is in the qm-native brain, made its owner (PREREGISTRATION.md, QM). */
export const QM_BRAIN_MEMBER = 'first-wow-user';
/** The Slack user id the question turn comes from; QM's DM scope is personal:<this>, and gbrain links it to QM_BRAIN_MEMBER. */
export const QM_ACTOR_ID = 'U0FIRSTWOW';
/** The registration every gbrain arm must carry after setup (decision G): the serve argv after gbrain's own path. */
export const REGISTRATION: Record<string, string[]> = { 'claude-code': ['serve', '--surface', 'starter', '--advertise', 'verbs'], codex: ['serve', '--surface', 'full'] };
/** The question session's turn budget; a timeout counts at this cap. */
export const QUESTION_BUDGET_S = 600;
export const SETUP_TIMEOUT_S = 180;
/** The runner's one answer when the reply ends by asking for input. */
export const PERSON_REPLY = "I'm not sure, use your best judgement";
/** The import fallback, as gbrain 87277dd2's setup --json reports it (history.no_history and status nothing_found). */
export const FALLBACK_MARKERS: readonly string[] = ['"no_history":true', '"status":"nothing_found"'];
/** The first line of PR 2's first-session section as gbrain 2b4cc26f writes it (docs/guides/first-session-suggestion.md). */
export const SUGGESTION_MARKER = '[gbrain] First sessions on this brain';

/** Whether a session transcript holds the first-session section, the page slugs its "Recent pages" list names, and that list's lines,
 *  the brain text the section puts in the session (scored as a gbrain read of those pages). */
export function suggestionIn(raw: string): { seen: boolean; pages: string[]; brain_text: string } {
  if (!raw.includes(SUGGESTION_MARKER)) return { seen: false, pages: [], brain_text: '' };
  const text = raw.replace(/\\n/g, '\n').replace(/\\"/g, '"');
  const list = text.slice(text.indexOf(SUGGESTION_MARKER)).split('Recent pages in the brain')[1] ?? '';
  const items = [...list.matchAll(/^- "[^"\n]*" -> ([A-Za-z0-9._/-]+)/gm)];
  return { seen: true, pages: [...new Set(items.map((m) => m[1]!))], brain_text: [...new Set(items.map((m) => m[0]))].join('\n') };
}

/** The full candidate accepts setup's offer at most this many times: the newest session, then the 30-day range. */
export const MAX_ACCEPTS = 2;

export interface FirstWowCellConfig {
  arm: FirstWowArm;
  /** The gbrain build of the gbrain arms, which their image records (harnesses/_first-wow/Dockerfile.gbrain). Absent in plain. */
  gbrain_commit?: string;
  gbrain_version?: string;
  /** The image; by default harness-eval/<harness>-gbrain:<commit 12> in a gbrain arm and harness-eval/<harness>:dev in plain. On
   *  QM it is the core image, harness-eval/qm:dev by default. */
  image?: string;
  /** qm-native only: the gbrain tool QM's memory provider reads with (harnesses/qm/memory-provider.ts); recall by default. */
  provider_read?: 'recall' | 'query';
  /** True when the build carries PR 2's first-session suggestion (gbrain#10346): defaults and pr1 then set up with
   *  --no-suggestion, and full leaves it on as it ships. Absent on a build without it, which has no such flag. */
  suggestion_switch?: boolean;
  /** "coding": the first session after setup is a coding check task (scripts/gbrain-first-wow/coding.ts) instead of the three
   *  questions, on the defaults and full arms of Claude Code and Codex. Questions by default. */
  task?: 'questions' | 'coding';
}

const CELL_KEYS = new Set(['id', 'harness', 'model', 'slice', 'split', 'repetitions', 'ceiling', 'harness_mode', 'network', 'utility_models', 'tasks', 'first_wow']);

/** HE-PREREG-007 for a malformed first-wow cell. A cell of another slice may not carry first_wow. */
export function checkFirstWowCell(c: { id: string; harness: string; slice: string; harness_mode?: string; network?: string; repetitions?: number; tasks?: unknown; first_wow?: unknown }): void {
  const bad = (msg: string) => new RunnerError('HE-PREREG-007', `cell ${c.id}: ${msg}`);
  if (c.slice !== FIRST_WOW_SLICE) { if (c.first_wow !== undefined) throw bad(`first_wow belongs to ${FIRST_WOW_SLICE} cells only (slice ${c.slice})`); return; }
  const extra = Object.keys(c).filter((k) => !CELL_KEYS.has(k));
  if (extra.length) throw bad(`a ${FIRST_WOW_SLICE} cell cannot carry ${extra.join(', ')}; allowed: ${[...CELL_KEYS].join(', ')}`);
  if (!FIRST_WOW_HARNESSES.includes(c.harness)) throw bad(`harness ${c.harness} has no first-wow run; ${FIRST_WOW_SLICE} runs on ${FIRST_WOW_HARNESSES.join(', ')}`);
  if (c.harness_mode !== undefined && c.harness_mode !== 'docker') throw bad('a first-wow cell runs in docker mode only');
  // QM is a compose stack with core on the host network, which the runner never moves onto the internal network (runner/trial/run.ts).
  if (c.harness === 'qm' && c.network !== undefined) throw new RunnerError('HE-NET-001', `cell ${c.id}: a QM ${FIRST_WOW_SLICE} cell runs its compose stack on the default bridge; fix: drop network`);
  if (c.harness !== 'qm' && c.network !== 'internal') throw new RunnerError('HE-NET-001', `cell ${c.id}: a ${FIRST_WOW_SLICE} cell needs network "internal"; nothing in a trial needs the internet. fix: add "network": "internal"`);
  if (c.repetitions !== 1) throw bad('a first-wow cell runs each seed once; set repetitions to 1 and list the seeds as tasks');
  if (!Array.isArray(c.tasks) || !c.tasks.length || c.tasks.some((t) => typeof t !== 'string' || seedOfTask(t) === null)) throw bad('tasks must list seeds as "seed-NNNN" (scripts/gbrain-first-wow/fixtures.ts)');
  const f = c.first_wow as Partial<FirstWowCellConfig> | undefined;
  if (!f || typeof f !== 'object' || Array.isArray(f)) throw bad('a first-wow cell needs first_wow: {arm[, gbrain_commit, gbrain_version, image]}');
  const unknown = Object.keys(f).filter((k) => !['arm', 'gbrain_commit', 'gbrain_version', 'image', 'provider_read', 'suggestion_switch', 'task'].includes(k));
  if (unknown.length) throw bad(`first_wow has unknown key(s) ${unknown.join(', ')}`);
  const arms = ARMS_BY_HARNESS[c.harness]!;
  if (!arms.includes(f.arm as FirstWowArm)) throw bad(`first_wow.arm must be one of ${arms.join(', ')} on ${c.harness} (got ${JSON.stringify(f.arm)})`);
  if (f.provider_read !== undefined && (f.arm !== 'qm-native' || !['recall', 'query'].includes(f.provider_read))) throw bad(`first_wow.provider_read is recall or query, on the qm-native arm only (got ${JSON.stringify(f.provider_read)} on ${f.arm})`);
  if (f.suggestion_switch !== undefined && (f.suggestion_switch !== true || !['defaults', 'pr1', 'full'].includes(f.arm as string))) throw bad(`first_wow.suggestion_switch is true on the defaults, pr1 and full arms only (got ${JSON.stringify(f.suggestion_switch)} on ${f.arm})`);
  if (f.task !== undefined && !(f.task === 'questions' || (f.task === 'coding' && c.harness !== 'qm' && ['defaults', 'full'].includes(f.arm as string)))) throw bad(`first_wow.task is "questions", or "coding" on the defaults and full arms of Claude Code and Codex (got ${JSON.stringify(f.task)} on ${c.harness} ${f.arm})`);
  if (f.arm === 'plain') { if (f.gbrain_commit !== undefined || f.gbrain_version !== undefined) throw bad('the plain arm runs no gbrain; drop gbrain_commit and gbrain_version'); return; }
  if (typeof f.gbrain_commit !== 'string' || !/^[0-9a-f]{40}$/.test(f.gbrain_commit)) throw bad(`first_wow.gbrain_commit must be the full 40-character gbrain commit (got ${JSON.stringify(f.gbrain_commit)})`);
  if (typeof f.gbrain_version !== 'string' || !/^\d+(\.\d+){2,3}$/.test(f.gbrain_version)) throw bad(`first_wow.gbrain_version must be gbrain's package version, such as "0.60.773.0" (got ${JSON.stringify(f.gbrain_version)})`);
}

export const taskForSeed = (seed: number): string => `seed-${String(seed).padStart(4, '0')}`;
export function seedOfTask(task: string): number | null { const m = /^seed-(\d{4})$/.exec(task); return m ? Number(m[1]) : null; }
export const imageFor = (cell: { harness: string; first_wow?: FirstWowCellConfig }): string =>
  cell.first_wow!.image ?? (cell.first_wow!.arm === 'plain' || cell.harness === 'qm' ? `harness-eval/${cell.harness}:dev` : `harness-eval/${cell.harness}-gbrain:${cell.first_wow!.gbrain_commit!.slice(0, 12)}`);
/** qm-native's brain host: the Claude Code gbrain image of the commit, for its gbrain and bun only (Claude Code never starts there). */
export const brainHostImage = (commit: string): string => `harness-eval/claude-code-gbrain:${commit.slice(0, 12)}`;

/** The brain host's commands for qm-native, in order, before serve (PREREGISTRATION.md, QM): a keyless brain, the install receipt
 *  gbrain setup writes right after init (without it the import refuses a brain setup did not make), PR 1's import previewed then
 *  run over 30 days, QM's token, and the access steps that make the person the owner and bind the token to them. The link to QM's
 *  actor id is not in the plan: a member-bound token refuses every call whose acting_user names anyone but its member or a linked
 *  id (actor_not_attested, pilot 1), and QM's provider sends the speaker's id as acting_user. */
export function brainHostSteps(tokenName: string, member = QM_BRAIN_MEMBER, actor = QM_ACTOR_ID): Array<{ id: string; argv: string[] }> {
  return [
    { id: 'init', argv: ['gbrain', 'init', '--pglite', '--no-embedding', '--json'] },
    { id: 'receipt', argv: ['gbrain', 'transcripts', 'archive', 'setup-import', 'receipt', '--harness', 'claude-code', '--created-by-setup', '--json'] },
    { id: 'preview', argv: ['gbrain', 'transcripts', 'archive', 'setup-import', 'preview', '--stage', 'range', '--days', '30', '--json'] },
    { id: 'run', argv: ['gbrain', 'transcripts', 'archive', 'setup-import', 'run', '--stage', 'range', '--days', '30', '--harness', 'claude-code', '--json'] },
    { id: 'token', argv: ['gbrain', 'auth', 'create', tokenName] },
    { id: 'member_add', argv: ['gbrain', 'access', 'member', 'add', member] },
    { id: 'owner_set', argv: ['gbrain', 'access', 'owner', 'set', member] },
    { id: 'rescope', argv: ['gbrain', 'auth', 'rescope', '--token', tokenName, '--member', member] },
    { id: 'link', argv: ['gbrain', 'access', 'member', 'link', member, '--qm', actor] },
    { id: 'access_check', argv: ['gbrain', 'access', 'check', '--token', tokenName, '--json'] },
  ];
}

/** Whether gbrain access check says the token reads the imported archive as the brain's owner: bound to the member, owner, and
 *  the conversations source among what it reads now. With nothing imported (the no-history fixture) gbrain has no
 *  conversations source yet, so only the member and owner binding is checked. */
export function accessCheckOk(stdout: string, imported: boolean, member = QM_BRAIN_MEMBER): { ok: boolean; verdict: string | null; reads_now: string[] } {
  try {
    const c = JSON.parse(stdout) as { verdict?: string; owner?: boolean; member?: { id?: string }; reads_now?: string[] };
    const reads = Array.isArray(c.reads_now) ? c.reads_now : [];
    return { ok: c.owner === true && c.member?.id === member && (!imported || reads.includes('conversations')), verdict: c.verdict ?? null, reads_now: reads };
  } catch { return { ok: false, verdict: null, reads_now: [] }; }
}

/** The first setup run of a gbrain arm (the full arm's later runs are the accept commands setup prints). */
export function setupArgv(harness: string, arm: FirstWowArm, suggestionSwitch = false): string[] {
  const pin = harness === 'codex' ? ['--surface', 'full'] : ['--surface', 'starter', '--advertise', 'verbs'];
  const history = arm === 'defaults' ? ['--history', 'none'] : arm === 'pr1' ? ['--history', '30'] : [];
  const suggestion = suggestionSwitch && arm !== 'full' ? ['--no-suggestion'] : [];
  return ['gbrain', 'setup', harness, ...pin, ...history, ...suggestion, '--json'];
}

/** The gbrain MCP entry the harness config holds after setup: its args, and whether they end in the pinned serve argv. */
export function readRegistration(harness: string, home: string): { file: string; args: string[] | null; ok: boolean } {
  const want = REGISTRATION[harness]!;
  const check = (args: string[] | null) => !!args && args.length === want.length + 1 && want.every((w, i) => args[i + 1] === w);
  if (harness === 'claude-code') {
    const file = join(home, '.claude', '.claude.json');
    try { const args = (JSON.parse(readFileSync(file, 'utf8')) as { mcpServers?: Record<string, { args?: string[] }> }).mcpServers?.gbrain?.args ?? null; return { file, args, ok: check(args) }; }
    catch { return { file, args: null, ok: false }; }
  }
  const file = join(home, '.codex', 'config.toml');
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return { file, args: null, ok: false }; }
  const block = /^\[mcp_servers\.gbrain\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text)?.[1] ?? '';
  const line = /^args\s*=\s*(\[.*\])\s*$/m.exec(block)?.[1];
  let args: string[] | null = null;
  try { args = line ? JSON.parse(line) as string[] : null; } catch { args = null; }
  return { file, args, ok: check(args) };
}

/**
 * Shrinks a finished trial's home after its token scrub and canary scan: gbrain's raw database becomes
 * .gbrain/brain.pglite.tgz and bun's package download cache is removed. A gbrain trial leaves about 100 MB there, which
 * 1,600 trials could not bring back from the shard VMs; scoring reads the brain export and the agent's text files, never
 * these. A database tar cannot pack stays as it was, and a folder it cannot remove is named in the list with the error
 * instead of failing the finished trial. The harness can write its home, so a path with a symlink anywhere below the home
 * is named in the list and left alone: following it would pack or delete files outside the trial. Returns what changed,
 * for the run log.
 */
export function packRawBrain(home: string): string[] {
  const done: string[] = [];
  const remove = (path: string) => { try { rmSync(path, { recursive: true, force: true }); return ''; } catch (e) { return ` (not removed: ${(e as Error).message})`; } };
  const linked = (parts: string[]) => parts.map((_, i) => parts.slice(0, i + 1).join('/')).find(rel => { try { return lstatSync(join(home, rel)).isSymbolicLink(); } catch { return false; } });
  const gbrain = join(home, '.gbrain');
  const db = ['.gbrain', 'brain.pglite'];
  const dbLink = linked(db) ?? linked(['.gbrain', 'brain.pglite.tgz']);
  if (dbLink) done.push(`.gbrain/brain.pglite (not packed: ${dbLink} is a symlink)`);
  else if (existsSync(join(gbrain, 'brain.pglite')) && spawnSync('tar', ['-czf', 'brain.pglite.tgz', 'brain.pglite'], { cwd: gbrain }).status === 0) {
    done.push('.gbrain/brain.pglite.tgz' + remove(join(gbrain, 'brain.pglite')));
  }
  const cacheParts = ['.bun', 'install', 'cache'];
  const cacheLink = linked(cacheParts);
  if (cacheLink) done.push(`-.bun/install/cache (not removed: ${cacheLink} is a symlink)`);
  else if (existsSync(join(home, ...cacheParts))) done.push('-.bun/install/cache' + remove(join(home, ...cacheParts)));
  return done;
}
