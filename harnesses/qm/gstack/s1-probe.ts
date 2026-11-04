#!/usr/bin/env bun
// The S1 gstack probe driver (docs/benchmarks/2026-11-03-qm-s1-gstack-probe/PREREGISTRATION.md, gate 3). Two arms on QM
// b6786d67 through Pi, each on two models (Opus 5.5 and GPT-6.1 Sol, Captain F1): gstack-router (gstack 21277291c's paste-in router in the org SOUL, its 63 SKILL.md files staged in
// the sandbox) and no-gstack (no SOUL change, no gstack file). Both arms' sandbox images carry the same fixture repository
// (s1-fixture.ts). 5 invented requests x 3 repetitions per arm and model, each turn a new DM on a fresh stack, all under
// one metering proxy lease. A Sol turn starts core with harnesses/qm/compose.openai.yaml over compose.yaml. It
//   1. builds harness-eval/qm:dev, harness-eval/qm-sandbox:dev and both arm images (Dockerfile.skills, STAGE_GSTACK=1 or 0)
//      and records their ids, the staged files and the fixture's tree sha256;
//   2. runs the clean-arm preflight (CREW.md, "Clean no-gstack and no-brain arms"): no Capy drive, gstack install or
//      ~/.claude/skills on the host; every SKILL.md and gstack path in the core image and each arm image (none outside
//      the 63 staged files); the fixture in both arm images; the org SOUL on a stack per arm. A failed check stops the run
//      before the proxy starts, so before any paid call;
//   3. per turn: binds a slot with a fresh trial token for the cell model and QM's housekeeping model for that provider
//      (claude-haiku-5-5 beside Opus, gpt-5.6-luna beside Sol: QM's auxiliary model of the provider), starts the stack
//      with the token and the slot URL, sets or leaves the SOUL, creates and selects the member's default sandbox, sends
//      the request as a new DM, reads the stored session and the first model request, tears the stack down (only what it
//      created), finalizes the meter and writes the turn record: session, usage, reconciliation and counts (s1-count.ts);
//   4. writes summary.json with the counts per arm and, in a dry run, the checks the keyless proof asks for.
//
// Dry run (--dry-run, $0): the proxy runs in capture mode (dummy provider keys, runner/trial/capture.ts) in front of
// scripts/gsta-135/fake-anthropic.ts (Opus) and tests/fixtures/fake-responses.ts (Sol, the Responses API), scripted per
// turn to open the matched skill and run its start command in gstack-router only. --inject-fault adds one extra turn whose default sandbox is removed before the DM.
//
//   env -i PATH=$PATH HOME=$HOME bun harnesses/qm/gstack/s1-probe.ts --dry-run [--inject-fault] [--skip-build]
//   bun harnesses/qm/gstack/s1-probe.ts --ledger <ledger.sqlite> --lease-usd 20 [--new-run] [--out <results dir>]
//     common: [--work ~/.capy/work/qm-s1-probe] [--gstack <gstack checkout>] [--reps 3] [--only <turn id,...>] [--repair <text>]
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DUMMY_KEY_PREFIX, ORG_SCOPE, ROOT, imageInfo, lockHost, qmClient, upStack, type Call } from './qm-stack.ts';
import { ARMS, REQUESTS, SKILL_ROOT, countTurn, type Arm, type Entry, type Request, type StagedFile, type TurnCounts } from './s1-count.ts';
import { FIXTURE_PATH, FIXTURE_REFS_COMMAND, FIXTURE_TREE_COMMAND, buildFixture, type Fixture } from './s1-fixture.ts';
import { RunProxy, reconcile, summarizeUsage, trialKey, trialSlug, trialToken } from '../../../runner/trial/proxy.ts';
import { CAPTURE_DUMMY_KEYS } from '../../../runner/trial/capture.ts';
import { startFakeAnthropic, type FakeAnthropic, type Turn } from '../../../scripts/gsta-135/fake-anthropic.ts';
import { startFakeResponses, type Turn as ResponsesTurn } from '../../../tests/fixtures/fake-responses.ts';

export const RUN_ID = 'qm-s1-gstack-probe-2026-11';
/** Capture runs are never counted runs, and their id says so (runner/trial/capture.ts CAPTURE_RUN_PREFIX). */
export const DRY_RUN_ID = 'anatomy-capture-qm-s1-gstack-probe-dry-run';
/** The models under test, each with QM's housekeeping model for its provider (auxiliaryModelForProvider at b6786d67). */
export const MODELS = {
  opus: { model: 'anthropic:claude-opus-5-5', housekeeping: 'anthropic:claude-haiku-5-5' },
  sol: { model: 'openai:gpt-6.1-sol', housekeeping: 'openai:gpt-5.6-luna' },
} as const;
export type ModelKey = keyof typeof MODELS;
export const MODEL_KEYS = Object.keys(MODELS) as ModelKey[];
export const CAP_USD = 20;
export const GSTACK_REF = '21277291c850765052ea9f80f6be4ccf1f1eb191';
export const ARM_IMAGES: Record<Arm, string> = { 'gstack-router': 'harness-eval/qm-sandbox:s1-gstack-21277291', 'no-gstack': 'harness-eval/qm-sandbox:s1-no-gstack' };
const CORE_IMAGE = 'harness-eval/qm:dev', BASE_SANDBOX = 'harness-eval/qm-sandbox:dev';
const RECEIPTS = join(ROOT, 'harnesses', 'qm', 'gstack', 'receipts');
const DESIGN = join(ROOT, 'docs', 'benchmarks', '2026-11-03-qm-s1-gstack-probe', 'design.json');
const MEMBER = 'U1', SCOPE = 'personal:' + MEMBER, PROJECT = 'qm-s1-probe';
const GSTACK_WORD = /(?:^|[^a-z])gstack/i;
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

export interface PlannedTurn { id: string; request: Request; rep: number; model: ModelKey; arm: Arm; fault?: 'remove-default-sandbox' }
export const cellOf = (t: { model: ModelKey; arm: Arm }) => t.model + '/' + t.arm;

/** Run order (PREREGISTRATION.md, Spend): request by request and repetition by repetition, each model's gstack-router turn
 *  and then its no-gstack turn, so a cap stop leaves whole pairs. */
export function turnPlan(reps: number): PlannedTurn[] {
  return REQUESTS.flatMap((request) => Array.from({ length: reps }, (_, k) => MODEL_KEYS.flatMap((model) => ARMS.map((arm) => ({ id: 's1-r' + request.id + '-k' + (k + 1) + '-' + model + '-' + arm, request, rep: k + 1, model, arm }))))).flat();
}

/** The scripted model of the dry run: in gstack-router it opens the matched skill (only once the router's line for that
 *  skill is in the system prompt) and runs the skill's start command; in both arms it then makes the request's progress
 *  move, and ends with a short reply. The Responses fake has no prompt match, so on openai the open is unconditional and
 *  the router check rests on the recorded first request. */
export function dryRunScript(arm: Arm, request: Request, provider: 'anthropic' | 'openai' = 'anthropic'): Turn[] {
  const exec = (command: string): Turn => ({ call: 'execute', arguments: { command, purpose: 'Checking the repository' } });
  const progress: Record<number, Turn | null> = {
    1: exec('cd ' + FIXTURE_PATH + ' && git log --oneline -20 -- && node test/login.test.js'),
    2: exec('cd ' + FIXTURE_PATH + ' && git diff main'),
    3: null,
    4: exec('cd ' + FIXTURE_PATH + ' && git describe --tags --abbrev=0 && git log --oneline v0.1.0..HEAD'),
    5: { call: 'memory', arguments: { action: 'add', facts: [{ text: 'The retry test is flaky when the first call throws.' }] } },
  };
  const start = request.skill === 'careful' ? 'GSTACK_STATE_ROOT=$(~/.claude/skills/gstack/bin/gstack-paths --get GSTACK_STATE_ROOT)' : 'gstack-skill-start --skill "' + request.skill + '" --model "claude"';
  const gstack: Turn[] = arm === 'gstack-router' ? [
    { call: 'files', arguments: { action: 'read', path: SKILL_ROOT + '/' + request.skill + '/SKILL.md' }, ...(provider === 'anthropic' ? { match: { system_contains: '- **' + request.skill + '**: ' } } : {}) },
    exec(start),
  ] : [];
  return [...gstack, ...(progress[request.id] ? [progress[request.id]!] : []), { text: 'done' }];
}

export interface ImageCheck { image: string; id: string | null; skill_files: number; gstack: string[]; claude_skills: string[]; problems: string[] }

/** Classifies one image's listing (sha256 and path per file, "- path" per directory, "claude-skills path"): a gstack entry
 *  is a path with "gstack" as a word in it, or a file whose sha256 is a staged file's. core and no-gstack must have none;
 *  gstack-router must have exactly the staged files (with their sha256) and the directories under the staged root. */
export function checkImageListing(kind: 'core' | Arm, listing: string, staged: Array<{ sandbox_path: string; sha256: string }>): Omit<ImageCheck, 'image' | 'id'> {
  const shas = new Set(staged.map((s) => s.sha256));
  const gstack: string[] = [], claude: string[] = [], problems: string[] = [];
  let skillFiles = 0;
  const seen = new Map<string, string>();
  for (const line of listing.split('\n').filter(Boolean)) {
    const [head, ...rest] = line.split(' ');
    const path = rest.join(' ');
    if (head === 'claude-skills') { claude.push(path); continue; }
    if (path.endsWith('/SKILL.md')) skillFiles++;
    if (GSTACK_WORD.test(path) || (head !== '-' && shas.has(head!))) { gstack.push(path); if (head !== '-') seen.set(path, head!); }
  }
  if (claude.length) problems.push('~/.claude/skills present: ' + claude.join(', '));
  if (kind !== 'gstack-router') {
    if (gstack.length) problems.push(gstack.length + ' gstack path(s), want none: ' + gstack.slice(0, 5).join(', '));
    return { skill_files: skillFiles, gstack, claude_skills: claude, problems };
  }
  const want = new Map(staged.map((s) => [s.sandbox_path, s.sha256]));
  const extra = gstack.filter((p) => !(want.has(p) || ((p === SKILL_ROOT || p.startsWith(SKILL_ROOT + '/')) && !seen.has(p))));
  const missing = [...want.keys()].filter((p) => !seen.has(p));
  const changed = [...want].filter(([p, s]) => seen.has(p) && seen.get(p) !== s).map(([p]) => p);
  if (extra.length) problems.push('gstack path(s) outside the staged files: ' + extra.slice(0, 5).join(', '));
  if (missing.length) problems.push(missing.length + ' staged file(s) missing: ' + missing.slice(0, 5).join(', '));
  if (changed.length) problems.push(changed.length + ' staged file(s) differ from the manifest: ' + changed.slice(0, 5).join(', '));
  return { skill_files: skillFiles, gstack, claude_skills: claude, problems };
}

/** The router reached the model: QM's org-instructions heading and the whole router in the first request's system prompt. */
export const routerInPrompt = (system: string, router: string) => system.includes('## Organization instructions') && system.includes(router.trim());

/** The system prompt of one stored request body: Anthropic's system (a string or text blocks), or the Responses API's
 *  instructions plus any system or developer input item. Null when the body has neither. */
export function systemOf(envelope: unknown): string | null {
  const e = (envelope ?? {}) as { system?: unknown; instructions?: unknown; input?: unknown };
  const text = (v: unknown): string => typeof v === 'string' ? v : Array.isArray(v) ? v.map((b) => (b && typeof b === 'object' ? String((b as { text?: unknown }).text ?? '') : String(b))).join('\n') : '';
  if (e.system !== undefined) return text(e.system);
  const items = Array.isArray(e.input) ? e.input.filter((i) => i && typeof i === 'object' && ['system', 'developer'].includes(String((i as { role?: unknown }).role))).map((i) => text((i as { content?: unknown }).content)) : [];
  if (typeof e.instructions !== 'string' && !items.length) return null;
  return [typeof e.instructions === 'string' ? e.instructions : '', ...items].filter(Boolean).join('\n');
}

const LISTING = "find / -xdev \\( -name SKILL.md -o -iname '*gstack*' \\) -print 2>/dev/null | LC_ALL=C sort | while IFS= read -r f; do if [ -f \"$f\" ]; then echo \"$(sha256sum \"$f\" | cut -d' ' -f1) $f\"; else echo \"- $f\"; fi; done; for d in /root/.claude/skills /home/*/.claude/skills; do [ -e \"$d\" ] && echo \"claude-skills $d\"; done; true";
const inImage = (image: string, script: string) => spawnSync('docker', ['run', '--rm', '--network', 'none', '--user', '0', '--entrypoint', 'sh', image, '-c', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const docker = (...args: string[]) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const names = () => ({
  containers: docker('ps', '-a', '--format', '{{.Names}}').stdout.split('\n').filter(Boolean),
  volumes: docker('volume', 'ls', '-q').stdout.split('\n').filter(Boolean),
  networks: docker('network', 'ls', '--format', '{{.Name}}').stdout.split('\n').filter(Boolean),
});

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }
const has = (name: string) => process.argv.includes(name);

interface Staging { manifest: Array<StagedFile & { sha256: string; source: string }>; router: string; router_sha256: string; version: string; context: string; fixture: Fixture }

/** The build context: gstack/ from the staging receipt's manifest (each file read with git show <ref>:<source>, its sha256
 *  checked), and repo/ (the fixture). The router is the committed receipt, checked against its recorded sha256. */
function prepareContext(work: string, gstackDir: string): Staging {
  const receipt = JSON.parse(readFileSync(join(RECEIPTS, 's1-staging-b6786d67.json'), 'utf8')) as { gstack: { ref: string; router_sha256: string; router_file: string }; staging: { manifest: Array<{ sandbox_path: string; source: string; chars: number; sha256: string }> } };
  if (receipt.gstack.ref !== GSTACK_REF) throw new Error('s1: the staging receipt is at gstack ' + receipt.gstack.ref + ', not the pin ' + GSTACK_REF);
  const router = readFileSync(join(ROOT, receipt.gstack.router_file), 'utf8');
  if (sha256(router) !== receipt.gstack.router_sha256) throw new Error('s1: ' + receipt.gstack.router_file + ' differs from the sha256 the staging receipt recorded');
  if (spawnSync('git', ['-C', gstackDir, 'cat-file', '-e', GSTACK_REF + '^{commit}']).status !== 0) {
    mkdirSync(gstackDir, { recursive: true });
    spawnSync('git', ['-C', gstackDir, 'init', '-q']);
    const f = spawnSync('git', ['-C', gstackDir, 'fetch', '-q', '--depth', '1', 'https://github.com/garrytan/gstack', GSTACK_REF], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GIT_TERMINAL_PROMPT: '0' } });
    if (f.status !== 0) throw new Error('s1: could not fetch gstack ' + GSTACK_REF + ' into ' + gstackDir + ': ' + f.stderr);
  }
  const context = join(work, 'context');
  rmSync(context, { recursive: true, force: true });
  const manifest = receipt.staging.manifest.map((s) => {
    const blob = spawnSync('git', ['-C', gstackDir, 'show', GSTACK_REF + ':' + s.source.split(':')[1]], { maxBuffer: 64 * 1024 * 1024 }).stdout as Buffer;
    if (sha256(blob) !== s.sha256) throw new Error('s1: ' + s.source + ' at ' + GSTACK_REF + ' does not match the manifest sha256');
    const dest = join(context, 'gstack', s.sandbox_path.slice(SKILL_ROOT.length + 1));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, blob);
    return { sandbox_path: s.sandbox_path, chars: s.chars, sha256: s.sha256, source: s.source, text: blob.toString('utf8') };
  });
  const version = spawnSync('git', ['-C', gstackDir, 'show', GSTACK_REF + ':VERSION'], { encoding: 'utf8' }).stdout.trim();
  return { manifest, router, router_sha256: sha256(router), version, context, fixture: buildFixture(join(context, 'repo')) };
}

function build(work: string, skipBuild: boolean, s: Staging) {
  const run = (name: string, args: string[]) => {
    const r = docker('build', ...args);
    writeFileSync(join(work, 'build-' + name + '.log'), r.stdout + r.stderr);
    if (r.status !== 0) throw new Error('s1: image build ' + name + ' failed (' + join(work, 'build-' + name + '.log') + ')');
  };
  if (!skipBuild) {
    run('core', ['-t', CORE_IMAGE, join(ROOT, 'harnesses', 'qm')]);
    run('sandbox', ['-f', join(ROOT, 'harnesses', 'qm', 'Dockerfile.sandbox'), '-t', BASE_SANDBOX, join(ROOT, 'harnesses', 'qm')]);
  }
  for (const arm of ARMS) run(arm, ['-f', join(ROOT, 'harnesses', 'qm', 'gstack', 'Dockerfile.skills'), '--build-arg', 'BASE=' + BASE_SANDBOX, '--build-arg', 'STAGE_GSTACK=' + (arm === 'gstack-router' ? 1 : 0), ...(arm === 'gstack-router' ? ['--build-arg', 'GSTACK_COMMIT=' + GSTACK_REF, '--build-arg', 'GSTACK_VERSION=' + s.version] : []), '-t', ARM_IMAGES[arm], s.context]);
  return { core: { name: CORE_IMAGE, ...imageInfo(CORE_IMAGE) }, sandbox: { name: BASE_SANDBOX, ...imageInfo(BASE_SANDBOX) }, ...Object.fromEntries(ARMS.map((a) => [a, { name: ARM_IMAGES[a], ...imageInfo(ARM_IMAGES[a]) }])), built: !skipBuild };
}

async function soulOf(call: ReturnType<typeof qmClient>): Promise<{ http: number; soul: string }> {
  const r = await call('GET', '/v1/admin/scopes/' + ORG_SCOPE);
  return { http: r.http, soul: typeof (r.body as { soul?: unknown })?.soul === 'string' ? (r.body as { soul: string }).soul : '' };
}
/** gstack-router: the SOUL is the router; no-gstack: it is QM's own default, with no router and no gstack word in it. */
export function soulProblems(arm: Arm, soul: string, router: string): string[] {
  if (arm === 'gstack-router') return soul === router ? [] : ['the org SOUL is not the router (' + soul.length + ' characters)'];
  return [...(soul.includes(router.trim()) ? ['the org SOUL holds the router'] : []), ...(GSTACK_WORD.test(soul) ? ['the org SOUL names gstack'] : [])];
}

function preflight(dryRun: boolean, s: Staging): { host: Record<string, boolean>; host_enforced: boolean; image_checks: ImageCheck[]; fixture_in_images: Record<Arm, { tree_sha256: string; refs: string[] }>; problems: string[] } {
  const home = homedir();
  const host = Object.fromEntries([join(home, '.capy', 'drive'), join(home, '.local', 'share', 'gstack'), join(home, '.claude', 'skills')].map((p) => [p, existsSync(p)]));
  const problems: string[] = dryRun ? [] : Object.entries(host).filter(([, e]) => e).map(([p]) => 'host: ' + p + ' exists');
  const images: ImageCheck[] = [];
  for (const [kind, image] of [['core', CORE_IMAGE], ...ARMS.map((a) => [a, ARM_IMAGES[a]])] as Array<['core' | Arm, string]>) {
    const r = inImage(image, LISTING);
    const c = { image, id: imageInfo(image).id, ...(r.status === 0 ? checkImageListing(kind, r.stdout, s.manifest) : { skill_files: 0, gstack: [], claude_skills: [], problems: ['listing failed: ' + r.stderr.slice(-300)] }) };
    images.push(c);
    problems.push(...c.problems.map((p) => kind + ' (' + image + '): ' + p));
  }
  const fixture = Object.fromEntries(ARMS.map((arm) => {
    const tree = inImage(ARM_IMAGES[arm], 'cd ' + FIXTURE_PATH + ' && ' + FIXTURE_TREE_COMMAND).stdout.trim();
    const refs = inImage(ARM_IMAGES[arm], 'cd ' + FIXTURE_PATH + ' && git config --global --add safe.directory ' + FIXTURE_PATH + ' && ' + FIXTURE_REFS_COMMAND).stdout.trim().split('\n');
    if (tree !== s.fixture.tree_sha256) problems.push(arm + ': fixture tree sha256 ' + (tree || 'missing') + ', want ' + s.fixture.tree_sha256);
    if (JSON.stringify(refs) !== JSON.stringify(s.fixture.refs)) problems.push(arm + ': fixture refs differ from the built fixture');
    return [arm, { tree_sha256: tree, refs }];
  })) as Record<Arm, { tree_sha256: string; refs: string[] }>;
  return { host, host_enforced: !dryRun, image_checks: images, fixture_in_images: fixture, problems };
}

/** One keyless stack per arm, before the proxy starts: the SOUL each arm's turns will see. No model call can be made. */
async function soulPreflight(work: string, s: Staging) {
  const out: Record<string, unknown> = {}, problems: string[] = [];
  for (const arm of ARMS) {
    const stack = await upStack({ out: join(work, 'preflight', arm), project: PROJECT, modelBaseUrl: 'http://127.0.0.1:9', modelKey: DUMMY_KEY_PREFIX + '-s1-preflight', sandboxImage: ARM_IMAGES[arm] });
    try {
      const call = qmClient(stack.url, stack.secret);
      if (arm === 'gstack-router') await call('PUT', '/v1/admin/scopes/' + ORG_SCOPE + '/soul', { content: s.router });
      const got = await soulOf(call);
      const p = got.http === 200 ? soulProblems(arm, got.soul, s.router) : ['GET org scope answered ' + got.http];
      out[arm] = { http: got.http, chars: got.soul.length, sha256: sha256(got.soul), is_router: got.soul === s.router, problems: p };
      problems.push(...p.map((x) => arm + ': ' + x));
    } finally { stack.down(); }
  }
  return { soul: out, problems };
}

/** The preregistration check: a paid run needs design.json (merged before the first counted turn) and refuses a driver
 *  whose requests or run id differ from it; a dry run checks it only when it exists. */
export function designProblem(dryRun: boolean, design = DESIGN): string | null {
  if (!existsSync(design)) return dryRun ? null : 's1: a paid run needs the merged preregistration ' + design;
  const d = JSON.parse(readFileSync(design, 'utf8')) as { requests: Array<{ id: number; skill: string; text: string }>; run_id: string };
  const want = JSON.stringify(REQUESTS.map((r) => [r.id, r.skill, r.text]));
  return JSON.stringify(d.requests.map((r) => [r.id, r.skill, r.text])) !== want || d.run_id !== RUN_ID ? 's1: the driver\'s requests or run id differ from ' + design : null;
}

/** A turn's record id: attempt 1 is the planned id, a later attempt adds -r<attempt>. */
export const attemptId = (id: string, attempt: number) => id + (attempt > 1 ? '-r' + attempt : '');
const baseIdOf = (r: { turn_id: string; attempt: number }) => (r.attempt > 1 ? r.turn_id.slice(0, -('-r' + r.attempt).length) : r.turn_id);

/** What this invocation runs, given the records already in turns.jsonl: a turn with a record is done (a restart resumes);
 *  under --repair the named turns run again as their next attempt. Records of another run id (a dry run's beside a paid
 *  run's) refuse the results directory. */
export function resumePlan(plan: PlannedTurn[], prior: Array<{ run_id: string; turn_id: string; attempt: number }>, runId: string, repair: boolean): { todo: Array<{ turn: PlannedTurn; attempt: number }>; problem: string | null } {
  const other = prior.find((r) => r.run_id !== runId);
  if (other) return { todo: [], problem: 's1: the results directory holds records of run ' + other.run_id + '; pass another --out' };
  const last = new Map<string, number>();
  for (const r of prior) last.set(baseIdOf(r), Math.max(last.get(baseIdOf(r)) ?? 0, r.attempt));
  return { todo: plan.filter((t) => repair || !last.has(t.id)).map((t) => ({ turn: t, attempt: (last.get(t.id) ?? 0) + 1 })), problem: null };
}

/** The latest attempt of each turn, and the record ids of the attempts it supersedes. */
export function latestAttempts<R extends { turn_id: string; attempt: number }>(records: R[]): { latest: R[]; superseded: string[] } {
  const by = new Map<string, R>();
  const superseded: string[] = [];
  for (const r of records) {
    const prev = by.get(baseIdOf(r));
    if (prev && prev.attempt > r.attempt) { superseded.push(r.turn_id); continue; }
    if (prev) superseded.push(prev.turn_id);
    by.set(baseIdOf(r), r);
  }
  return { latest: [...by.values()], superseded };
}

/** A run is complete when no turn stopped on the cap, every planned turn has a record and at least one of them ran to the end
 *  (a turn that did not is excluded and named, as preregistered). A paid run that is not complete exits 1. */
export function runStatus(planIds: string[], latest: Array<{ turn_id: string; attempt: number; termination: string }>): { complete: boolean; cap_stop: boolean; missing: string[]; not_ok: string[] } {
  const have = new Map(latest.map((r) => [baseIdOf(r), r]));
  const missing = planIds.filter((id) => !have.has(id));
  const cap = latest.some((r) => r.termination === 'cap_stop');
  const notOk = planIds.filter((id) => have.has(id) && have.get(id)!.termination !== 'ok');
  return { complete: !cap && !missing.length && notOk.length < planIds.length, cap_stop: cap, missing, not_ok: notOk };
}

/** The stored session is evidence only from a 200 answer whose body holds an entries array. */
export function sessionEvidence(res: { http: number; body: unknown }): { entries: Entry[] } | { error: string } {
  const entries = (res.body as { entries?: unknown } | null)?.entries;
  return res.http === 200 && Array.isArray(entries) ? { entries: entries as Entry[] } : { error: 'GET session answered ' + res.http + ' ' + JSON.stringify(res.body ?? null).slice(0, 300) };
}

/** A sandbox QM did not create (no 2xx, no id) or did not select as the member's default stops the turn before the DM. */
export function sandboxProblem(created: { http: number; body: unknown }, selected: { http: number }): string | null {
  const ok = (http: number) => http >= 200 && http < 300;
  if (!ok(created.http) || !(created.body as { id?: unknown } | null)?.id) return 'sandbox create answered ' + created.http;
  return ok(selected.http) ? null : 'sandbox default answered ' + selected.http;
}

interface TurnRecord {
  run_id: string; turn_id: string; model: string; housekeeping: { model: string; requests: number; usd: number }; arm: Arm; request: number; skill: string; rep: number; attempt: number; repair?: string; dry_run: boolean; injected_fault?: string;
  started_at: string; ended_at: string; wall_ms: number | null; termination: 'ok' | 'turn_error' | 'stack_error' | 'evidence_error' | 'cap_stop'; error?: string;
  images: { core: string | null; sandbox: string; sandbox_id: string | null };
  soul: { chars: number; sha256: string; problems: string[] } | null;
  sandbox: { create_http: number; default_http: number; machine_id: string | null; removed?: unknown } | null;
  turn: { http: number; status: string | null; session_id: string | null } | null;
  first_prompt: { system_chars: number; router: boolean; gstack_word: boolean } | null;
  counts: TurnCounts | null; usage: ReturnType<typeof summarizeUsage>['usage'] | null; reconcile: ReturnType<typeof reconcile> | null;
}

async function runTurn(t: PlannedTurn, o: { proxy: RunProxy; work: string; results: string; s: Staging; dryRun: boolean; runId: string; attempt: number; repair?: string; setFake: (provider: 'anthropic' | 'openai', script: Turn[]) => void }): Promise<TurnRecord> {
  const cell = MODELS[t.model];
  const provider = cell.model.split(':')[0] as 'anthropic' | 'openai';
  const id = attemptId(t.id, o.attempt);
  const slot = trialSlug(id), key = trialKey(id), token = trialToken(id);
  const dir = join(o.results, 'turns', id);
  mkdirSync(dir, { recursive: true });
  const rec: TurnRecord = {
    run_id: o.runId, turn_id: id, model: cell.model, housekeeping: { model: cell.housekeeping, requests: 0, usd: 0 }, arm: t.arm, request: t.request.id, skill: t.request.skill, rep: t.rep, attempt: o.attempt, ...(o.repair ? { repair: o.repair } : {}), dry_run: o.dryRun, ...(t.fault ? { injected_fault: t.fault } : {}),
    started_at: new Date().toISOString(), ended_at: '', wall_ms: null, termination: 'ok',
    images: { core: imageInfo(CORE_IMAGE).id, sandbox: ARM_IMAGES[t.arm], sandbox_id: imageInfo(ARM_IMAGES[t.arm]).id },
    soul: null, sandbox: null, turn: null, first_prompt: null, counts: null, usage: null, reconcile: null,
  };
  if (o.dryRun) o.setFake(provider, dryRunScript(t.arm, t.request, provider));
  await o.proxy.bind(slot, key, token, [cell.model, cell.housekeeping]);
  let session: { entries?: Entry[] } | null = null, llm: unknown = null;
  try {
    const stack = await upStack({ out: join(o.work, 'turns', id), project: PROJECT, modelBaseUrl: o.proxy.baseUrlFor(slot, provider, false), modelKey: token, modelName: cell.model.split(':')[1], modelProvider: provider, sandboxImage: ARM_IMAGES[t.arm] });
    try {
      const call = qmClient(stack.url, stack.secret);
      if (t.arm === 'gstack-router') await call('PUT', '/v1/admin/scopes/' + ORG_SCOPE + '/soul', { content: o.s.router });
      const soul = await soulOf(call);
      rec.soul = { chars: soul.soul.length, sha256: sha256(soul.soul), problems: soulProblems(t.arm, soul.soul, o.s.router) };
      if (rec.soul.problems.length) throw new Error('the org SOUL check failed before the DM: ' + rec.soul.problems.join('; '));
      const created: Call = await stack.createSandbox(() => call('POST', '/v1/admin/sandboxes/' + SCOPE, { action: 'create', backend: 'local', name: 's1-probe' }));
      const sandboxId = (created.body as { id?: string } | null)?.id ?? null;
      const selected = await call('POST', '/v1/admin/sandboxes/' + SCOPE, { action: 'default', sandboxId });
      rec.sandbox = { create_http: created.http, default_http: selected.http, machine_id: (created.body as { machineId?: string } | null)?.machineId ?? null };
      const badSandbox = sandboxProblem(created, selected);
      if (badSandbox) throw new Error(badSandbox);
      if (t.fault === 'remove-default-sandbox') {
        const unset = await call('POST', '/v1/admin/sandboxes/' + SCOPE, { action: 'default', sandboxId: null });
        const retire = await call('POST', '/v1/admin/sandboxes/' + SCOPE, { action: 'retire', sandboxId });
        rec.sandbox.removed = { unset_http: unset.http, retire_http: retire.http };
      }
      const turn = await call('POST', '/v1/turns', { surface: 'harness-eval', actor: { externalId: MEMBER, displayName: 'Dana Okafor' }, conversation: { kind: 'dm', threadRef: 'dm:' + MEMBER + ':' + id }, text: t.request.text }, { admin: false, timeoutMs: 900_000 });
      const body = (turn.body ?? {}) as { status?: string; sessionId?: string };
      rec.wall_ms = turn.ms;
      rec.turn = { http: turn.http, status: body.status ?? null, session_id: body.sessionId ?? null };
      if (turn.http !== 200 || body.status !== 'ok') { rec.termination = 'turn_error'; rec.error = 'POST /v1/turns answered ' + turn.http + ' ' + JSON.stringify(turn.body).slice(0, 300); }
      const evidenceError = (e: string) => { if (rec.termination === 'ok') { rec.termination = 'evidence_error'; rec.error = e; } };
      if (body.sessionId) {
        const q = '?scope=' + encodeURIComponent(SCOPE);
        const got = sessionEvidence(await call('GET', '/v1/admin/sessions/' + body.sessionId + q + '&limit=50000'));
        if ('error' in got) evidenceError(got.error); else session = got;
        const prompts = await call('GET', '/v1/admin/sessions/' + body.sessionId + '/llm' + q + '&turnSeq=0');
        if (prompts.http === 200) llm = prompts.body; else evidenceError('GET session llm answered ' + prompts.http);
      } else evidenceError('POST /v1/turns returned no sessionId');
    } finally { stack.down(); }
  } catch (e) {
    rec.termination = 'stack_error';
    rec.error = String((e as Error)?.message ?? e).slice(0, 2000);
  }
  const meter = await o.proxy.finalize(key);
  const lines = o.proxy.usageLines(key);
  await o.proxy.unbind(slot);
  const summary = summarizeUsage(key, meter, lines);
  rec.usage = summary.usage;
  rec.reconcile = reconcile(key, meter, lines);
  if (summary.cap_stop) rec.termination = 'cap_stop';
  const hk = summary.usage.by_model[cell.housekeeping];
  rec.housekeeping = { model: cell.housekeeping, requests: hk?.requests ?? 0, usd: hk?.usd ?? 0 };
  const requests = ((llm as { requests?: Array<{ step?: number; promptEnvelope?: unknown }> } | null)?.requests ?? []).slice().sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
  const systemText = systemOf(requests[0]?.promptEnvelope);
  if (systemText !== null) rec.first_prompt = { system_chars: systemText.length, router: routerInPrompt(systemText, o.s.router), gstack_word: GSTACK_WORD.test(systemText) };
  if (session) rec.counts = countTurn({ arm: t.arm, request: t.request, entries: session.entries ?? [], staged: o.s.manifest, routerInFirstPrompt: rec.first_prompt ? rec.first_prompt.router : null });
  rec.ended_at = new Date().toISOString();
  writeFileSync(join(dir, 'session.json'), JSON.stringify(session, null, 1) + '\n');
  writeFileSync(join(dir, 'llm-turn0.json'), JSON.stringify(llm, null, 1) + '\n');
  writeFileSync(join(dir, 'turn.json'), JSON.stringify(rec, null, 2) + '\n');
  appendFileSync(join(o.results, 'turns.jsonl'), JSON.stringify(rec) + '\n');
  return rec;
}

/** Counts per cell (model/arm) over the turns that ran to the end without a fixture fault, with the excluded turns named. */
export function summarize(records: TurnRecord[]) {
  const per = (model: ModelKey, arm: Arm) => {
    const all = records.filter((r) => r.arm === arm && r.model === MODELS[model].model);
    const faulted = all.filter((r) => r.termination !== 'ok' || !r.counts || r.counts.faults.length);
    const ok = all.filter((r) => !faulted.includes(r));
    const n = (f: (c: TurnCounts) => boolean) => ok.filter((r) => f(r.counts!)).length;
    const sum = (f: (r: TurnRecord) => number) => all.reduce((a, r) => a + f(r), 0);
    return {
      turns: all.length, counted: ok.length,
      excluded: faulted.map((r) => ({ turn_id: r.turn_id, termination: r.termination, faults: r.counts?.faults ?? [], error: r.error ?? null })),
      matched_opens: n((c) => c.open_matched), any_opens: n((c) => c.open_any),
      complete_inline: n((c) => c.complete_read === 'inline'), complete_cut: n((c) => c.complete_read === 'cut'), complete_pieces: n((c) => c.complete_read === 'pieces'),
      start_preamble: n((c) => c.start_preamble), start_first_step: n((c) => c.start_first_step === true), cut_reads: ok.reduce((a, r) => a + r.counts!.cut_reads, 0),
      progress: n((c) => c.progress === true), progress_possible: ok.filter((r) => r.counts!.progress !== null).length,
      contaminated: all.filter((r) => r.counts?.contaminated).map((r) => r.turn_id),
      router_in_first_prompt: all.filter((r) => r.first_prompt?.router).length,
      housekeeping: { model: MODELS[model].housekeeping, requests: sum((r) => r.housekeeping.requests), usd: sum((r) => r.housekeeping.usd) },
      usage: { usd: sum((r) => r.usage?.usd ?? 0), input_tokens: sum((r) => r.usage?.input_tokens ?? 0), cached_tokens: sum((r) => r.usage?.cached_tokens ?? 0), output_tokens: sum((r) => r.usage?.output_tokens ?? 0), requests: sum((r) => r.usage?.requests ?? 0) },
      reconciled: all.filter((r) => r.reconcile?.proxy_consistent).length,
      wall_ms: sum((r) => r.wall_ms ?? 0),
      by_request: REQUESTS.map((q) => ({ request: q.id, skill: q.skill, turns: ok.filter((r) => r.request === q.id).length, matched_opens: ok.filter((r) => r.request === q.id && r.counts!.open_matched).length, progress: ok.filter((r) => r.request === q.id && r.counts!.progress).length })),
    };
  };
  return Object.fromEntries(MODEL_KEYS.flatMap((m) => ARMS.map((a) => [cellOf({ model: m, arm: a }), per(m, a)]))) as Record<string, ReturnType<typeof per>>;
}

async function main(): Promise<number> {
  const dryRun = has('--dry-run');
  const work = resolve(arg('--work') ?? join(homedir(), '.capy', 'work', 'qm-s1-probe'));
  const results = resolve(arg('--out') ?? join(work, dryRun ? 'dry-run-results-' + new Date().toISOString().replace(/[:.]/g, '-') : 'results'));
  const reps = Number(arg('--reps') ?? 3);
  const only = arg('--only')?.split(',').filter(Boolean);
  const repair = arg('--repair');
  const runId = dryRun ? DRY_RUN_ID : RUN_ID;
  const leaseUsd = Number(arg('--lease-usd') ?? (dryRun ? CAP_USD : NaN));
  const ledgerPath = dryRun ? join(work, 'ledger.sqlite') : arg('--ledger');
  if (!dryRun && (!ledgerPath || !existsSync(ledgerPath))) { console.error('s1: a paid run needs --ledger <an initialised ledger>'); return 2; }
  if (!(leaseUsd > 0 && leaseUsd <= CAP_USD)) { console.error('s1: --lease-usd must be above 0 and at most the $' + CAP_USD + ' cap'); return 2; }
  if (repair !== undefined && !only) { console.error('s1: --repair reruns named turns only; pass --only <turn id,...>'); return 2; }
  const badDesign = designProblem(dryRun);
  if (badDesign) { console.error(badDesign); return 2; }
  const turnsFile = join(results, 'turns.jsonl');
  const prior = (existsSync(turnsFile) ? readFileSync(turnsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []) as TurnRecord[];
  const fullPlan = turnPlan(reps);
  const plan = fullPlan.filter((t) => !only || only.includes(t.id));
  const resume = resumePlan(plan, prior, runId, repair !== undefined);
  if (resume.problem) { console.error(resume.problem); return 2; }
  mkdirSync(results, { recursive: true });
  const unlock = lockHost(['work-' + sha256(work).slice(0, 12)]);
  process.on('exit', unlock);
  const before = names();

  const staging = prepareContext(work, resolve(arg('--gstack') ?? join(work, 'gstack-src')));
  const images = build(work, has('--skip-build'), staging);
  const pre = preflight(dryRun, staging);
  const soul = await soulPreflight(work, staging);
  const preReceipt = {
    run_id: runId, dry_run: dryRun, date: new Date().toISOString(), images,
    gstack: { ref: GSTACK_REF, staged_files: staging.manifest.length, router_sha256: staging.router_sha256, router_chars: staging.router.length },
    fixture: staging.fixture, ...pre, soul: soul.soul, problems: [...pre.problems, ...soul.problems],
  };
  const preflightName = existsSync(join(results, 'preflight.json')) ? 'preflight-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json' : 'preflight.json';
  writeFileSync(join(results, preflightName), JSON.stringify({ ...preReceipt, gstack_manifest: staging.manifest.map(({ text: _t, ...m }) => m) }, null, 2) + '\n');
  console.log('s1: preflight ' + (preReceipt.problems.length ? 'FAILED: ' + preReceipt.problems.join('; ') : 'ok') + ' (gstack files: ' + pre.image_checks.map((i) => i.image + '=' + i.gstack.filter((p) => p.endsWith('/SKILL.md')).length).join(', ') + '; host checks ' + (pre.host_enforced ? 'enforced' : 'recorded only, dry run') + ')');
  if (preReceipt.problems.length) return 3;

  let fake: FakeAnthropic | null = null;
  const front = dryRun ? Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    if (!fake) return new Response('no fake model for this turn', { status: 503 });
    const u = new URL(req.url);
    return fetch(fake.url + u.pathname + u.search, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : await req.arrayBuffer() });
  } }) : null;
  const responses = dryRun ? startFakeResponses({ host: '127.0.0.1', port: 0, log: join(results, 'fake-responses.ndjson'), requireKeyPrefix: CAPTURE_DUMMY_KEYS.OPENAI_API_KEY }) : null;
  const fakeLog = join(results, 'fake-requests.ndjson');
  const setFake = (provider: 'anthropic' | 'openai', script: Turn[]) => {
    if (provider === 'openai') { responses!.setScript(script as ResponsesTurn[]); return; }
    fake?.stop();
    fake = startFakeAnthropic({ host: '127.0.0.1', port: 0, log: fakeLog, requireKeyPrefix: DUMMY_KEY_PREFIX, script });
  };
  const allowModels = MODEL_KEYS.flatMap((m) => [MODELS[m].model, MODELS[m].housekeeping]);
  const upstream = front && responses ? { anthropic: 'http://127.0.0.1:' + front.port, openai: 'http://127.0.0.1:' + responses.port } : null;
  const proxy = await RunProxy.start({ runId, runDir: results, ledgerPath: ledgerPath!, leaseUsd, allowModels, maxOutputTokens: 128_000, reachableFromContainers: false, newRun: has('--new-run') || dryRun, ...(upstream ? { capture: { upstream, dns: null } } : {}) });
  const todo = resume.todo.slice();
  if (dryRun && has('--inject-fault')) todo.push({ turn: { id: 's1-r3-fault-opus-gstack-router', request: REQUESTS[2], rep: 0, model: 'opus', arm: 'gstack-router', fault: 'remove-default-sandbox' }, attempt: 1 });
  const records: TurnRecord[] = [];
  try {
    for (const { turn: t, attempt: next } of todo) {
      let attempt = next;
      while (proxy.usageLines(trialKey(attemptId(t.id, attempt))).length) attempt++;
      const r = await runTurn(t, { proxy, work, results, s: staging, dryRun, runId, attempt, repair, setFake });
      records.push(r);
      console.log('s1: ' + r.turn_id + ' ' + r.termination + (r.counts ? ' matched_open=' + r.counts.open_matched + ' start=' + r.counts.start_preamble + ' progress=' + r.counts.progress + ' faults=' + (r.counts.faults.join(',') || 'none') : '') + ' housekeeping=' + r.housekeeping.model + 'x' + r.housekeeping.requests + ' usd=' + (r.usage?.usd ?? 0).toFixed(6));
      if (r.termination === 'cap_stop') { console.error('s1: cap stop (HE-BUDGET-001); the run is incomplete and nothing is rerun'); break; }
    }
  } finally {
    await proxy.stop();
    (fake as FakeAnthropic | null)?.stop();
    responses?.stop();
    front?.stop(true);
  }
  const after = names();
  const leftover = { containers: after.containers.filter((n) => !before.containers.includes(n)), volumes: after.volumes.filter((n) => !before.volumes.includes(n)), networks: after.networks.filter((n) => !before.networks.includes(n)) };
  const { latest, superseded } = latestAttempts([...prior, ...records]);
  const counted = latest.filter((r) => !r.injected_fault);
  const cells = summarize(counted);
  const status = runStatus(fullPlan.map((t) => t.id), counted);
  const injected = records.filter((r) => r.injected_fault).map((r) => ({ turn_id: r.turn_id, fault: r.injected_fault, classified: r.counts?.faults ?? [], termination: r.termination }));
  const both = (f: (g: (typeof cells)[string], n: (typeof cells)[string], m: ModelKey) => boolean) => MODEL_KEYS.every((m) => f(cells[m + '/gstack-router']!, cells[m + '/no-gstack']!, m));
  const checks = dryRun ? {
    turns: counted.length === plan.length && counted.length === (only ? only.length : REQUESTS.length * reps * ARMS.length * MODEL_KEYS.length),
    router_only_in_gstack_prompts: both((g, n) => g.router_in_first_prompt === g.turns && n.router_in_first_prompt === 0) && counted.filter((r) => r.arm === 'no-gstack').every((r) => r.first_prompt && !r.first_prompt.gstack_word),
    staged_files: pre.image_checks.find((i) => i.image === ARM_IMAGES['gstack-router'])!.gstack.filter((p) => p.endsWith('/SKILL.md')).length === staging.manifest.length && pre.image_checks.filter((i) => i.image !== ARM_IMAGES['gstack-router']).every((i) => i.gstack.length === 0),
    usage_reconciled_every_turn: counted.every((r) => r.reconcile?.proxy_consistent && (r.usage?.requests ?? 0) > 0),
    housekeeping_on_its_provider: counted.every((r) => r.housekeeping.requests > 0 && Object.keys(r.usage?.by_model ?? {}).every((k) => k === r.model || k === r.housekeeping.model)),
    matched_opens: both((g, n) => g.matched_opens === g.turns && n.matched_opens === 0 && n.any_opens === 0),
    no_contamination: both((_g, n) => n.contaminated.length === 0),
    injected_fault_classified: !has('--inject-fault') || injected.every((f) => f.classified.includes('no-default-sandbox')),
    nothing_left_behind: !leftover.containers.length && !leftover.volumes.length && !leftover.networks.length,
  } : null;
  const summary = { run_id: runId, dry_run: dryRun, date: new Date().toISOString(), models: MODELS, housekeeping_label: 'harness housekeeping, shipped default', lease_usd: leaseUsd, turns: records.length, turns_recorded: counted.length, superseded, complete: status.complete, cap_stop: status.cap_stop, missing: status.missing, not_ok: status.not_ok, cells, injected_faults: injected, leftover, ...(checks ? { checks } : {}) };
  writeFileSync(join(results, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  for (const [cell, c] of Object.entries(cells)) console.log('s1: ' + cell + ' matched opens ' + c.matched_opens + '/' + c.counted + ', starts ' + c.start_preamble + ', progress ' + c.progress + '/' + c.progress_possible + ', router in prompt ' + c.router_in_first_prompt + ', reconciled ' + c.reconciled + ', housekeeping ' + c.housekeeping.model + ' x' + c.housekeeping.requests + ', metered $' + c.usage.usd.toFixed(6));
  console.log('s1: summary ' + join(results, 'summary.json'));
  if (checks) { console.log('s1: dry-run checks ' + JSON.stringify(checks)); return Object.values(checks).some((v) => !v) ? 1 : 0; }
  if (!status.complete) console.error('s1: the run is incomplete (cap stop ' + status.cap_stop + ', ' + status.missing.length + ' planned turns without a record, ' + status.not_ok.length + ' not ok)');
  return status.complete ? 0 : 1;
}

if (import.meta.main) process.exit(await main());

