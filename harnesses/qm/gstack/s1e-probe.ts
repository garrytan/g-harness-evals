#!/usr/bin/env bun
// The S1 edition rerun driver (internal-task-a, internal-task-b plan step 3). It asks QM each task of a tasks.json once per arm, model
// and repetition, in a seeded order that interleaves the arms, and writes one turn record per trial to turns.jsonl. The
// arms, on QM through Pi as S1 ran it (harnesses/qm, pinned in harnesses/qm/pin.json):
//   plain    QM as shipped: default SOUL, no edition text in any layer.
//   edition  gstack's QM edition at EDITION_REF (internal-task): the three qm/sandbox/skills/gstack-* folders copied into a
//            deploy dir's sandbox/skills/ and sent as the deployment layer qm up would send (PUT /v1/deployment-layer;
//            QM file:line citations in the README), with QM's default SOUL. First-step markers come from qm/edition.json.
//   forced   edition, plus the matched skill's whole SKILL.md body as the org SOUL (PUT /v1/admin/scopes/org:<org>/soul).
// Per trial: the task's repo_dir alone is baked into a sandbox image at /root/workspace/repo (Dockerfile.skills,
// STAGE_GSTACK=0), the trial gets a fresh stack whose volumes are removed at teardown and must leave nothing behind, and
// the clean-arm check (s1e-count.ts cleanArm) reads the layer, the SOUL, the first model request and the sandbox's
// .agent-skills. A turn that answers pending_approval (QM's org floor rules, src/policy/command-policy.ts:7-21) is
// approved once per command through POST /v1/turns {approval}, the same way in every arm, up to APPROVAL_CAP per trial.
//
// Dry run (--dry-run, $0): the proxy runs in capture mode in front of the scripted fakes S1 used, with test-only tasks
// built from s1-fixture.ts and the real edition at EDITION_REF. The fake loads the matched skill in edition, runs a
// first step that matches the edition's marker in edition and forced (in edition review, the synced diff-base.sh), and
// runs one recursive delete in every arm, so every trial answers one approval. --inject-fault adds a plain trial with the
// edition installed, which must count as contaminated.
//
//   env -i PATH=$PATH HOME=$HOME bun harnesses/qm/gstack/s1e-probe.ts --dry-run [--inject-fault] [--skip-build]
//   bun harnesses/qm/gstack/s1e-probe.ts --tasks <tasks.json> --seed <n> [--edition <gstack checkout at EDITION_REF>]
//       --stage headroom|pilot|main|forced --shards <n> --ledger <ledger.sqlite> --lease-usd <usd> [--new-run]
//       [--run-id qm-s1-edition-...]
//     common: [--arms plain,edition] [--models opus,sol] [--reps 1] [--work ~/.capy/work/qm-s1e-probe] [--out <dir>]
//             [--only <trial id,...> [--repair <text>]]
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DUMMY_KEY_PREFIX, ORG_SCOPE, ROOT, imageInfo, lockHost, qmClient, upStack, type Call } from './qm-stack.ts';
import { MODELS, sandboxProblem, sessionEvidence, systemOf } from './s1-probe.ts';
import { FIXTURE_PATH, FIXTURE_TREE_COMMAND, buildFixture } from './s1-fixture.ts';
import { QM_INLINE_CHARS } from './s1-stage.ts';
import { ARMS, INDEX_DASH, countTrial, editionFrom, indexHas, indexIntact, layerBundle, nextApproval, parseTasks, skillFor, summarize, trialPlan, trialStatus, type Arm, type CountDetail, type EditionSkill, type Markers, type ModelKey, type PlannedTrial, type Task, type TurnRecord } from './s1e-count.ts';
import type { Entry } from './s1-count.ts';
import { RunProxy, reconcile, summarizeUsage, trialKey, trialSlug, trialToken } from '../../../runner/trial/proxy.ts';
import { CAPTURE_DUMMY_KEYS } from '../../../runner/trial/capture.ts';
import { startFakeAnthropic, type FakeAnthropic, type Turn } from '../../../scripts/gsta-135/fake-anthropic.ts';
import { startFakeResponses, type Turn as ResponsesTurn } from '../../../tests/fixtures/fake-responses.ts';

export const RUN_ID = 'qm-s1-edition-2026-11';
export const DRY_RUN_ID = 'anatomy-capture-qm-s1-edition-dry-run';
/** The preregistration's paid-call cap for each stage (Spend). A paid run names its stage and its shard count, and the
 *  shards' leases together must fit the stage's cap: --lease-usd times --shards at most the cap. */
export const STAGE_CAPS_USD = { headroom: 45, pilot: 10, main: 520, forced: 45 } as const;
export type Stage = keyof typeof STAGE_CAPS_USD;
/** The lease check for one invocation; null when it is inside the cap. */
export function leaseProblem(dryRun: boolean, stage: string | undefined, shards: number, leaseUsd: number): string | null {
  if (!(leaseUsd > 0)) return '--lease-usd must be above 0';
  if (dryRun) return leaseUsd <= 20 ? null : 'a dry run takes --lease-usd of at most $20';
  if (!stage || !(stage in STAGE_CAPS_USD)) return 'a paid run needs --stage ' + Object.keys(STAGE_CAPS_USD).join('|');
  if (!(Number.isInteger(shards) && shards > 0)) return 'a paid run needs --shards <the number of shards in this stage>';
  const cap = STAGE_CAPS_USD[stage as Stage];
  return leaseUsd * shards <= cap ? null : '--lease-usd ' + leaseUsd + ' times ' + shards + ' shards is above the ' + stage + ' cap of $' + cap;
}
export const DESIGN = join(ROOT, 'docs', 'benchmarks', '2026-11-06-qm-s1-edition', 'design.json');
export const TEST_FIXTURES = join(ROOT, 'tests', 'fixtures', 'qm-s1e');
/** gstack's QM edition (internal-task, gstack#4049): the commit every arm that installs it is pinned to. */
export const EDITION_REF = 'eaf1701da2d68b5c03136ff530aa228013eedb7c';
const EDITION_REPO = 'https://github.com/garrytan/gstack';
/** Names qm up skips in a deploy dir (cli/src/deployment-layer.ts JUNK_FILE at 850599e9). */
const JUNK_FILE = /^(?:\.DS_Store|Thumbs\.db|\._.*)$/;
const CORE_IMAGE = 'harness-eval/qm:dev', BASE_SANDBOX = 'harness-eval/qm-sandbox:dev';
const MEMBER = 'U1', SCOPE = 'personal:' + MEMBER, PROJECT = 'qm-s1e-probe';
const GSTACK_WORD = /(?:^|[^a-z])gstack/i;
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/** Test-only requests for the dry run's generated tasks, one per family. Not the task bank. */
export const DRY_RUN_TASKS: Array<Omit<Task, 'repo_dir'>> = [
  { id: 'dry-inv-01', family: 'investigate', request: '(test-only) The login test started failing on my branch. Can you find out why before I change anything?', first_step: { skill: 'investigate' } },
  { id: 'dry-rev-01', family: 'review', request: '(test-only) Can you look over the diff on my branch for anything risky before I merge?', first_step: { skill: 'review' } },
  { id: 'dry-plan-01', family: 'plan', request: '(test-only) I want to add a password reset flow. Can you write a short plan first?', first_step: { skill: 'plan' } },
];
/** Commands the dry-run model runs as each family's first step; the edition's markers match them (checked in the tests).
 *  In edition, review runs the synced diff-base.sh, which exists only once QM has synced the skill's files. */
export const DRY_RUN_FIRST_STEP: Record<string, string> = {
  investigate: 'cd ' + FIXTURE_PATH + ' && git log --oneline -20 --',
  review: 'cd ' + FIXTURE_PATH + ' && git diff --stat main',
  'review-edition': 'cd ' + FIXTURE_PATH + ' && sh /root/workspace/.agent-skills/*/*/gstack-review/scripts/diff-base.sh main',
  plan: 'cd ' + FIXTURE_PATH + ' && git log --oneline -10',
};
/** A recursive delete, which QM's org floor sends for approval in every scope (src/policy/command-policy.ts:9-11). */
export const APPROVAL_PROBE = 'rm -rf /tmp/s1e-approval-probe';

/** The scripted model of the dry run: edition loads the matched skill (on anthropic only once its index line is in the
 *  system prompt), edition and forced run the matched skill's first step, plain runs a neutral command, and every arm
 *  then runs APPROVAL_PROBE and replies. */
export function dryRunScript(arm: Arm, task: Pick<Task, 'first_step'>, provider: 'anthropic' | 'openai' = 'anthropic'): Turn[] {
  const exec = (command: string): Turn => ({ call: 'execute', arguments: { command, purpose: 'Working on the request' } });
  const family = task.first_step.skill;
  const skill = skillFor(family);
  const load: Turn[] = arm === 'edition' ? [{ call: 'skills', arguments: { action: 'read', name: skill }, ...(provider === 'anthropic' ? { match: { system_contains: '\n- ' + skill + INDEX_DASH } } : {}) } as Turn] : [];
  const step = arm === 'plain' ? 'cd ' + FIXTURE_PATH + ' && git status --short' : DRY_RUN_FIRST_STEP[arm === 'edition' && family === 'review' ? 'review-edition' : family]!;
  return [...load, exec(step), exec(APPROVAL_PROBE), { text: 'done (dry run)' }];
}

/** The edition the way its handoff installs it: the skill folders qm/edition.json lists (and nothing else from qm/) copied
 *  from a gstack checkout into <deployDir>/sandbox/skills/, then read back the way qm up reads a deploy dir: regular text
 *  files only, junk names skipped, the executable bit kept (cli/src/deployment-layer.ts textFile and walkText at 850599e9). */
export function readEdition(gstackRoot: string, deployDir: string): ReturnType<typeof editionFrom> & { manifest_sha256: string } {
  const manifestText = readFileSync(join(gstackRoot, 'qm', 'edition.json'), 'utf8');
  const manifest = JSON.parse(manifestText) as { layer_root?: unknown; skills?: Array<{ id?: unknown }> };
  const layerRoot = typeof manifest.layer_root === 'string' ? manifest.layer_root : 'qm/sandbox/skills';
  const skillsDir = join(deployDir, 'sandbox', 'skills');
  rmSync(skillsDir, { recursive: true, force: true });
  mkdirSync(skillsDir, { recursive: true });
  for (const entry of manifest.skills ?? []) {
    const id = String(entry.id ?? '');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) throw new Error('edition.json: bad skill id ' + JSON.stringify(entry.id));
    cpSync(join(gstackRoot, layerRoot, id), join(skillsDir, id), { recursive: true, verbatimSymlinks: true });
  }
  const files: Array<{ path: string; content: string; executable?: boolean }> = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(skillsDir, rel)).sort()) {
      if (JUNK_FILE.test(name)) continue;
      const r = rel ? rel + '/' + name : name;
      const st = lstatSync(join(skillsDir, r));
      if (st.isDirectory()) { walk(r); continue; }
      if (!st.isFile()) throw new Error('edition: ' + r + ' is not a regular file');
      files.push({ path: r, content: readFileSync(join(skillsDir, r), 'utf8'), ...((st.mode & 0o111) !== 0 ? { executable: true } : {}) });
    }
  };
  walk('');
  return { ...editionFrom(manifest, files), manifest_sha256: sha256(manifestText) };
}

/** The gstack checkout the edition comes from: --edition, which a paid run needs at EDITION_REF with qm/ unchanged, or a
 *  checkout of EDITION_REF fetched by sha into the work directory. */
function editionCheckout(work: string, given: string | undefined, dryRun: boolean): string {
  const git = (dir: string, ...a: string[]) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GIT_TERMINAL_PROMPT: '0' } });
  if (given) {
    const dir = resolve(given);
    if (!dryRun && (git(dir, 'rev-parse', 'HEAD').stdout.trim() !== EDITION_REF || git(dir, 'status', '--porcelain', '--', 'qm').stdout.trim())) throw new Error('s1e: --edition must be a gstack checkout at ' + EDITION_REF + ' with qm/ unchanged');
    return dir;
  }
  const dir = join(work, 'gstack-edition');
  if (git(dir, 'rev-parse', 'HEAD').stdout.trim() !== EDITION_REF || git(dir, 'status', '--porcelain', '--', 'qm').stdout.trim()) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q');
    const f = git(dir, 'fetch', '-q', '--depth', '1', EDITION_REPO, EDITION_REF);
    if (f.status !== 0 || git(dir, 'checkout', '-q', 'FETCH_HEAD').status !== 0) throw new Error('s1e: could not fetch gstack ' + EDITION_REF + ': ' + f.stderr);
  }
  return dir;
}

/** Problems with the inputs before any image or stack: each task's gstack-<family> skill is in the edition with a marker,
 *  each file fits QM's inline tool-result budget (QM_INLINE_CHARS) so one load delivers it whole, and the index fits QM's
 *  12,000 characters (src/skills/materialize.ts SKILLS_INDEX_BUDGET) with the QM seed skills' share left out. */
export function inputProblems(tasks: Task[], edition: EditionSkill[], markers: Markers): string[] {
  const names = new Set(edition.map((s) => s.name));
  const problems: string[] = [];
  for (const t of tasks) {
    const skill = skillFor(t.first_step.skill);
    if (!names.has(skill)) problems.push(t.id + ': no edition skill named ' + skill);
    if (!markers[skill]) problems.push(t.id + ': no first-step marker for ' + skill);
  }
  for (const s of edition) for (const f of s.files) if (f.content.length > QM_INLINE_CHARS) problems.push(s.name + '/' + f.path + ' is ' + f.content.length + ' characters, over QM\'s inline budget of ' + QM_INLINE_CHARS);
  const index = edition.reduce((a, s) => a + ('- ' + s.name + INDEX_DASH + s.description).length + 1, 0);
  if (index > 12_000) problems.push('edition index is ' + index + ' characters, over QM\'s 12,000');
  return problems;
}

/** One image listing (sha256 and path per file, "present <dir>" per directory) against the edition: a path naming gstack,
 *  a file with an edition file's sha256, ~/.claude/skills or a baked .agent-skills is a problem in every image. */
export function imageProblems(listing: string, edition: EditionSkill[]): string[] {
  const shas = new Set(edition.flatMap((s) => s.files.map((f) => f.sha256)));
  const problems: string[] = [];
  for (const line of listing.split('\n').filter(Boolean)) {
    const [head, ...rest] = line.split(' ');
    const path = rest.join(' ');
    if (head === 'present') problems.push(path + ' present');
    else if (GSTACK_WORD.test(path)) problems.push('gstack path ' + path);
    else if (shas.has(head!)) problems.push('edition file ' + path);
  }
  return problems;
}

const LISTING = "{ find / -xdev \\( -name SKILL.md -o -iname '*gstack*' \\) -type f -print 2>/dev/null; find /root -xdev -type f -print 2>/dev/null; } | LC_ALL=C sort -u | while IFS= read -r f; do echo \"$(sha256sum \"$f\" | cut -d' ' -f1) $f\"; done; for d in /root/.claude/skills /home/*/.claude/skills /root/workspace/.agent-skills; do [ -e \"$d\" ] && echo \"present $d\"; done; true";
const docker = (...args: string[]) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const inImage = (image: string, script: string) => docker('run', '--rm', '--network', 'none', '--user', '0', '--entrypoint', 'sh', image, '-c', script);
const names = () => ({
  containers: docker('ps', '-a', '--format', '{{.Names}}').stdout.split('\n').filter(Boolean),
  volumes: docker('volume', 'ls', '-q').stdout.split('\n').filter(Boolean),
  networks: docker('network', 'ls', '--format', '{{.Name}}').stdout.split('\n').filter(Boolean),
});
type Names = ReturnType<typeof names>;
const newSince = (before: Names, after: Names) => ({ containers: after.containers.filter((n) => !before.containers.includes(n)), volumes: after.volumes.filter((n) => !before.volumes.includes(n)), networks: after.networks.filter((n) => !before.networks.includes(n)) });
const empty = (n: Names) => !n.containers.length && !n.volumes.length && !n.networks.length;

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }
const has = (name: string) => process.argv.includes(name);
const treeOf = (dir: string) => spawnSync('sh', ['-c', FIXTURE_TREE_COMMAND], { cwd: dir, encoding: 'utf8' }).stdout.trim();
export const taskImage = (task: Task, tree: string) => 'harness-eval/qm-sandbox:s1e-' + sha256(task.id + '\n' + tree).slice(0, 12);

/** The rig images (unless --skip-build) and one sandbox image per task holding only that task's repository. */
function build(work: string, skipBuild: boolean, tasks: Task[]) {
  const run = (name: string, args: string[]) => {
    const r = docker('build', ...args);
    writeFileSync(join(work, 'build-' + name + '.log'), r.stdout + r.stderr);
    if (r.status !== 0) throw new Error('s1e: image build ' + name + ' failed (' + join(work, 'build-' + name + '.log') + ')');
  };
  if (!skipBuild) {
    run('core', ['-t', CORE_IMAGE, join(ROOT, 'harnesses', 'qm')]);
    run('sandbox', ['-f', join(ROOT, 'harnesses', 'qm', 'Dockerfile.sandbox'), '-t', BASE_SANDBOX, join(ROOT, 'harnesses', 'qm')]);
  }
  const images: Record<string, { image: string; id: string | null; tree_sha256: string }> = {};
  for (const t of tasks) {
    const tree = treeOf(t.repo_dir);
    if (!tree) throw new Error('s1e: ' + t.id + ': could not hash ' + t.repo_dir);
    const context = join(work, 'context', t.id);
    rmSync(context, { recursive: true, force: true });
    cpSync(t.repo_dir, join(context, 'repo'), { recursive: true, verbatimSymlinks: true });
    const image = taskImage(t, tree);
    run('task-' + t.id, ['-f', join(ROOT, 'harnesses', 'qm', 'gstack', 'Dockerfile.skills'), '--build-arg', 'BASE=' + BASE_SANDBOX, '--build-arg', 'STAGE_GSTACK=0', '-t', image, context]);
    images[t.id] = { image, id: imageInfo(image).id, tree_sha256: tree };
  }
  return { core: { name: CORE_IMAGE, ...imageInfo(CORE_IMAGE) }, sandbox: { name: BASE_SANDBOX, ...imageInfo(BASE_SANDBOX) }, tasks: images, built: !skipBuild };
}

function preflight(dryRun: boolean, edition: EditionSkill[], images: ReturnType<typeof build>) {
  const home = homedir();
  const host = Object.fromEntries([join(home, '.capy', 'drive'), join(home, '.local', 'share', 'gstack'), join(home, '.claude', 'skills')].map((p) => [p, existsSync(p)]));
  const problems: string[] = dryRun ? [] : Object.entries(host).filter(([, e]) => e).map(([p]) => 'host: ' + p + ' exists');
  const checks: Array<{ image: string; git?: string | null; problems: string[] }> = [];
  for (const [label, image, tree] of [['core', CORE_IMAGE, null], ...Object.entries(images.tasks).map(([id, i]) => [id, i.image, i.tree_sha256])] as Array<[string, string, string | null]>) {
    const r = inImage(image, LISTING);
    const p = r.status === 0 ? imageProblems(r.stdout, edition) : ['listing failed: ' + r.stderr.slice(-300)];
    let git: string | null = null;
    if (tree !== null) {
      const got = inImage(image, 'cd ' + FIXTURE_PATH + ' && ' + FIXTURE_TREE_COMMAND).stdout.trim();
      if (got !== tree) p.push('repository tree sha256 ' + (got || 'missing') + ', want ' + tree);
      git = docker('run', '--rm', '--network', 'none', image, 'sh', '-c', 'command -v git && git --version').stdout.trim() || null;
      if (!git) p.push('git is not on PATH');
    }
    checks.push({ image, ...(tree !== null ? { git } : {}), problems: p });
    problems.push(...p.map((x) => label + ' (' + image + '): ' + x));
  }
  return { host, host_enforced: !dryRun, image_checks: checks, problems };
}

/** The synced files under the sandbox's .agent-skills, or null when the container cannot be read. */
function agentSkills(machineId: string | null): string[] | null {
  if (!machineId) return null;
  const r = docker('exec', machineId, 'sh', '-c', 'find /root/workspace/.agent-skills -type f 2>/dev/null; true');
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean).sort() : null;
}

export const attemptId = (id: string, attempt: number) => id + (attempt > 1 ? '-r' + attempt : '');
/** The attempt each planned trial runs next given the trial ids already in turns.jsonl: a recorded trial is skipped (a
 *  restart resumes) unless --repair names it, which runs its next attempt. */
export function nextAttempts(plan: PlannedTrial[], recorded: string[], repair: boolean): Array<{ trial: PlannedTrial; attempt: number }> {
  return plan.flatMap((t) => {
    const done = recorded.filter((id) => id === t.trial_id || new RegExp('^' + t.trial_id.replace(/[.]/g, '\\.') + '-r(\\d+)$').test(id)).map((id) => (id === t.trial_id ? 1 : Number(id.slice(t.trial_id.length + 2))));
    const last = done.length ? Math.max(...done) : 0;
    return last && !repair ? [] : [{ trial: t, attempt: last + 1 }];
  });
}

interface Ctx { proxy: RunProxy; work: string; results: string; edition: EditionSkill[]; markers: Markers; images: ReturnType<typeof build>; dryRun: boolean; runId: string; repair?: string; setFake: (provider: 'anthropic' | 'openai', script: Turn[]) => void }

async function runTrial(t: PlannedTrial, attempt: number, o: Ctx): Promise<{ record: TurnRecord; detail: Record<string, unknown> }> {
  const cell = MODELS[t.model];
  const provider = cell.model.split(':')[0] as 'anthropic' | 'openai';
  const id = attemptId(t.trial_id, attempt);
  const slot = trialSlug(id), key = trialKey(id), token = trialToken(id);
  const dir = join(o.results, 'trials', id);
  mkdirSync(dir, { recursive: true });
  const matched = o.edition.find((s) => s.name === skillFor(t.task.first_step.skill))!;
  const detail: Record<string, unknown> = { run_id: o.runId, trial_id: id, attempt, ...(o.repair ? { repair: o.repair } : {}), dry_run: o.dryRun, ...(t.fault ? { injected_fault: t.fault } : {}), started_at: new Date().toISOString(), images: { core: imageInfo(CORE_IMAGE).id, sandbox: o.images.tasks[t.task.id] } };
  const before = names();
  if (o.dryRun) o.setFake(provider, dryRunScript(t.arm, t.task, provider));
  await o.proxy.bind(slot, key, token, [cell.model, cell.housekeeping]);
  let session: { entries: Entry[] } | null = null, llm: unknown = null, stackError: string | undefined, evidenceError: string | undefined, approvalStop: string | undefined;
  let last: Call | null = null, wallMs = 0, machineId: string | null = null;
  const evidence = { agent_skills: null as string[] | null, first_system: null as string | null, layer_paths: null as string[] | null, soul: null as string | null };
  const approvals: Array<{ requestId: string; command: string; http: number; status: string | null }> = [];
  try {
    const stack = await upStack({ out: join(o.work, 'trials', id), project: PROJECT, modelBaseUrl: o.proxy.baseUrlFor(slot, provider, false), modelKey: token, modelName: cell.model.split(':')[1], modelProvider: provider, sandboxImage: o.images.tasks[t.task.id]!.image });
    try {
      const call = qmClient(stack.url, stack.secret);
      if (t.arm !== 'plain' || t.fault === 'edition-in-plain') {
        const put = await call('PUT', '/v1/deployment-layer', layerBundle(o.edition), { admin: false });
        detail.layer_put = { http: put.http, version: (put.body as { version?: unknown } | null)?.version ?? null, contentHash: (put.body as { contentHash?: unknown } | null)?.contentHash ?? null };
        if (put.http !== 200) throw new Error('PUT /v1/deployment-layer answered ' + put.http + ' ' + JSON.stringify(put.body).slice(0, 300));
      }
      if (t.arm === 'forced') {
        const soul = await call('PUT', '/v1/admin/scopes/' + ORG_SCOPE + '/soul', { content: matched.body });
        if (soul.http !== 200) throw new Error('PUT org soul answered ' + soul.http);
      }
      const layer = await call('GET', '/v1/deployment-layer', undefined, { admin: false });
      const lb = (layer.body ?? {}) as { status?: string; bundle?: { skills?: Array<{ path?: string }> } };
      if (layer.http === 200) evidence.layer_paths = (lb.bundle?.skills ?? []).map((f) => String(f.path));
      detail.layer = { http: layer.http, status: lb.status ?? null, skill_files: evidence.layer_paths?.length ?? null };
      const scope = await call('GET', '/v1/admin/scopes/' + ORG_SCOPE);
      const soul = (scope.body as { soul?: unknown } | null)?.soul;
      if (scope.http === 200 && typeof soul === 'string') evidence.soul = soul;
      detail.soul = evidence.soul === null ? null : { chars: evidence.soul.length, sha256: sha256(evidence.soul) };
      const created = await stack.createSandbox(() => call('POST', '/v1/admin/sandboxes/' + SCOPE, { action: 'create', backend: 'local', name: 's1e-probe' }));
      const selected = await call('POST', '/v1/admin/sandboxes/' + SCOPE, { action: 'default', sandboxId: (created.body as { id?: string } | null)?.id ?? null });
      machineId = (created.body as { machineId?: string } | null)?.machineId ?? null;
      detail.sandbox = { create_http: created.http, default_http: selected.http, machine_id: machineId };
      const badSandbox = sandboxProblem(created, selected);
      if (badSandbox) throw new Error(badSandbox);
      const turnBody = { surface: 'harness-eval', actor: { externalId: MEMBER, displayName: 'Dana Okafor' }, conversation: { kind: 'dm', threadRef: 'dm:' + MEMBER + ':' + id }, text: t.task.request };
      last = await call('POST', '/v1/turns', turnBody, { admin: false, timeoutMs: 900_000 });
      wallMs += last.ms;
      const answered = new Set<string>();
      for (;;) {
        if (last.http === 0) break;
        const next = nextApproval(last.body, answered);
        if (!next) break;
        if ('stop' in next) { approvalStop = 'pending approval left unanswered: ' + next.stop + ' after ' + answered.size + ' approval(s)'; break; }
        answered.add(next.requestId);
        last = await call('POST', '/v1/turns', { ...turnBody, approval: { requestId: next.requestId, approved: true, scope: 'once' } }, { admin: false, timeoutMs: 900_000 });
        wallMs += last.ms;
        approvals.push({ requestId: next.requestId, command: next.command.slice(0, 500), http: last.http, status: (last.body as { status?: string } | null)?.status ?? null });
      }
      const sessionId = (last.body as { sessionId?: string } | null)?.sessionId;
      if (sessionId) {
        const q = '?scope=' + encodeURIComponent(SCOPE);
        const got = sessionEvidence(await call('GET', '/v1/admin/sessions/' + sessionId + q + '&limit=50000'));
        if ('error' in got) evidenceError = got.error; else session = got;
        const prompts = await call('GET', '/v1/admin/sessions/' + sessionId + '/llm' + q + '&turnSeq=0');
        if (prompts.http === 200) llm = prompts.body; else evidenceError ??= 'GET session llm answered ' + prompts.http;
      } else evidenceError = 'POST /v1/turns returned no sessionId';
      evidence.agent_skills = agentSkills(machineId);
    } finally { stack.down(); }
  } catch (e) {
    stackError = String((e as Error)?.message ?? e).slice(0, 2000);
  }
  detail.leftover = newSince(before, names());
  const meter = await o.proxy.finalize(key);
  const lines = o.proxy.usageLines(key);
  await o.proxy.unbind(slot);
  const usage = summarizeUsage(key, meter, lines);
  const requests = ((llm as { requests?: Array<{ step?: number; promptEnvelope?: unknown }> } | null)?.requests ?? []).slice().sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
  evidence.first_system = systemOf(requests[0]?.promptEnvelope);
  const { counts, detail: countDetail } = countTrial({ arm: t.arm, matched: matched.name, entries: session?.entries ?? [], edition: o.edition, markers: o.markers, approvalsAnswered: approvals.length, evidence });
  const bare = (m: string) => m.split(':').pop()!;
  const status = trialStatus({ capStop: usage.cap_stop, stackError, evidenceError, approvalStop, turn: last, lines: lines.filter((l) => !l.model || bare(l.model) !== bare(cell.housekeeping)) });
  const hk = usage.usage.by_model[cell.housekeeping];
  const record: TurnRecord = { trial_id: id, task_id: t.task.id, family: t.task.family, arm: t.arm, model: cell.model, rep: t.rep, status: status.status, reply_text: String((last?.body as { reply?: unknown } | null)?.reply ?? ''), counts, usage: usage.usage, wall_s: last ? wallMs / 1000 : null };
  Object.assign(detail, {
    ended_at: new Date().toISOString(), status_reason: status.reason, cap_stop: usage.cap_stop, approvals, final_turn: last ? { http: last.http, status: (last.body as { status?: string } | null)?.status ?? null } : null,
    evidence: { agent_skills: evidence.agent_skills, first_system_chars: evidence.first_system?.length ?? null, index_lines: Object.fromEntries(o.edition.map((s) => [s.name, evidence.first_system === null ? null : { listed: indexHas(evidence.first_system, s.name), description_intact: indexIntact(evidence.first_system, s) }])), layer_paths: evidence.layer_paths },
    count_detail: countDetail satisfies CountDetail, reconcile: reconcile(key, meter, lines), housekeeping: { model: cell.housekeeping, requests: hk?.requests ?? 0, usd: hk?.usd ?? 0 },
  });
  writeFileSync(join(dir, 'session.json'), JSON.stringify(session, null, 1) + '\n');
  writeFileSync(join(dir, 'llm-turn0.json'), JSON.stringify(llm, null, 1) + '\n');
  writeFileSync(join(dir, 'trial.json'), JSON.stringify({ ...record, detail }, null, 2) + '\n');
  appendFileSync(join(o.results, 'turns.jsonl'), JSON.stringify(record) + '\n');
  return { record, detail };
}

/** The keyless proof: every arm behaves as scripted and the clean-arm check holds, every trial answered one approval
 *  and reconciled, the injected fault is caught, and nothing is left behind. The claim checks are internal-task's two unverified
 *  claims about the edition: (0) QM lists each skill with its whole description and a skill call returns the body whole,
 *  (1) QM rewrites skills/gstack-review/ to the synced folder, and the synced diff-base.sh runs; plus git on PATH. */
export function dryRunChecks(rows: Array<{ record: TurnRecord; detail: Record<string, unknown> }>, planned: number, edition: EditionSkill[], leftover: { containers: string[]; volumes: string[]; networks: string[] }, injected: boolean, gitOnPath: boolean) {
  const counted = rows.filter((r) => !r.detail.injected_fault);
  const arm = (a: Arm) => counted.filter((r) => r.record.arm === a).map((r) => r.record.counts);
  const shipsFiles = new Set(edition.filter((s) => s.files.length > 1).map((s) => s.name));
  const cd = (r: { detail: Record<string, unknown> }) => r.detail.count_detail as CountDetail;
  const editionRows = counted.filter((r) => r.record.arm === 'edition');
  const reviewRows = editionRows.filter((r) => r.record.family === 'review');
  return {
    claim0_index_lists_whole_descriptions: counted.filter((r) => r.record.arm !== 'plain').every((r) => Object.values((r.detail.evidence as { index_lines: Record<string, { listed: boolean; description_intact: boolean } | null> }).index_lines).every((l) => l?.listed && l.description_intact)),
    claim0_skill_call_returns_body_whole: editionRows.length > 0 && editionRows.every((r) => cd(r).read_whole),
    claim1_review_path_rewritten: reviewRows.length > 0 && reviewRows.every((r) => cd(r).path_rewrite.expected && cd(r).path_rewrite.rewritten === true),
    claim1_synced_diff_base_runs: reviewRows.length > 0 && reviewRows.every((r) => cd(r).first_step_runs.some((x) => x.command.includes('diff-base.sh') && x.code === 0 && x.output.includes('MERGE_BASE:'))),
    git_on_path: gitOnPath,
    trials: counted.length === planned,
    all_ok: counted.every((r) => r.record.status === 'ok'),
    edition_opens_reads_and_steps: arm('edition').every((c) => c.open_matched && c.complete_read && c.first_step),
    forced_body_in_prompt: arm('forced').every((c) => c.complete_read && c.first_step && !c.open_matched),
    plain_untouched: arm('plain').every((c) => !c.open_any && !c.complete_read && !c.first_step),
    no_contamination: counted.every((r) => !r.record.counts.contaminated),
    one_approval_each: counted.every((r) => r.record.counts.approvals_answered === 1),
    edition_tree_synced: counted.filter((r) => r.record.arm === 'edition' && shipsFiles.has(skillFor(r.record.family))).every((r) => ((r.detail.evidence as { agent_skills: string[] | null }).agent_skills ?? []).some((p) => p.includes('/' + skillFor(r.record.family) + '/'))),
    usage_reconciled: counted.every((r) => (r.detail.reconcile as { proxy_consistent?: boolean } | null)?.proxy_consistent && (r.record.usage?.requests ?? 0) > 0),
    injected_fault_caught: !injected || rows.filter((r) => r.detail.injected_fault).every((r) => r.record.counts.contaminated),
    nothing_left_behind: empty({ ...leftover }) && rows.every((r) => empty(r.detail.leftover as Names)),
  };
}

async function main(): Promise<number> {
  const dryRun = has('--dry-run');
  const work = resolve(arg('--work') ?? join(homedir(), '.capy', 'work', 'qm-s1e-probe'));
  const results = resolve(arg('--out') ?? join(work, dryRun ? 'dry-run-results-' + new Date().toISOString().replace(/[:.]/g, '-') : 'results'));
  const runId = dryRun ? DRY_RUN_ID : arg('--run-id') ?? RUN_ID;
  const leaseUsd = Number(arg('--lease-usd') ?? (dryRun ? 20 : NaN));
  const ledgerPath = dryRun ? join(work, 'ledger.sqlite') : arg('--ledger');
  const seed = Number(arg('--seed') ?? (dryRun ? 1514 : NaN));
  const reps = Number(arg('--reps') ?? 1);
  const arms = (arg('--arms') ?? (dryRun ? ARMS.join(',') : 'plain,edition')).split(',') as Arm[];
  const models = (arg('--models') ?? 'opus,sol').split(',') as ModelKey[];
  const only = arg('--only')?.split(',').filter(Boolean);
  const repair = arg('--repair');
  const fail = (m: string) => { console.error('s1e: ' + m); return 2; };
  if (!runId.startsWith(dryRun ? 'anatomy-capture-' : 'qm-s1-edition')) return fail('a paid run id starts with qm-s1-edition');
  if (!dryRun && (!ledgerPath || !existsSync(ledgerPath))) return fail('a paid run needs --ledger <an initialised ledger>');
  const leaseBad = leaseProblem(dryRun, arg('--stage'), Number(arg('--shards') ?? NaN), leaseUsd);
  if (leaseBad) return fail(leaseBad);
  if (!Number.isSafeInteger(seed)) return fail('a paid run needs --seed <integer>, from the preregistration');
  if (!(Number.isInteger(reps) && reps > 0)) return fail('--reps must be a positive integer');
  if (!arms.length || arms.some((a) => !ARMS.includes(a))) return fail('--arms takes ' + ARMS.join(', '));
  if (!models.length || models.some((m) => !(m in MODELS))) return fail('--models takes opus, sol');
  if (repair !== undefined && !only) return fail('--repair reruns named trials only; pass --only <trial id,...>');
  if (!dryRun && !existsSync(DESIGN)) return fail('a paid run needs the merged preregistration ' + DESIGN);
  const loaded = readEdition(editionCheckout(work, arg('--edition'), dryRun), join(work, 'deploy'));
  const { skills: edition, markers } = loaded;
  let tasks: Task[];
  if (dryRun && !arg('--tasks')) {
    tasks = DRY_RUN_TASKS.map((t) => ({ ...t, repo_dir: join(work, 'dry-run-tasks', t.id, 'repo') }));
    for (const t of tasks) buildFixture(t.repo_dir);
    writeFileSync(join(work, 'dry-run-tasks', 'tasks.json'), JSON.stringify(tasks, null, 2) + '\n');
  } else {
    if (!arg('--tasks')) return fail('a paid run needs --tasks <tasks.json>');
    tasks = parseTasks(JSON.parse(readFileSync(resolve(arg('--tasks')!), 'utf8')));
  }
  const bad = inputProblems(tasks, edition, markers);
  if (bad.length) return fail('inputs: ' + bad.join('; '));

  mkdirSync(results, { recursive: true });
  const design = { run_id: runId, seed, arms, models, reps, tasks_sha256: sha256(JSON.stringify(tasks)), edition_ref: EDITION_REF, edition_manifest_sha256: loaded.manifest_sha256, layer_sha256: sha256(JSON.stringify(layerBundle(edition))) };
  const runFile = join(results, 'run.json');
  if (existsSync(runFile) && readFileSync(runFile, 'utf8') !== JSON.stringify(design, null, 2) + '\n') return fail(runFile + ' records another run design; pass another --out');
  writeFileSync(runFile, JSON.stringify(design, null, 2) + '\n');
  const turnsFile = join(results, 'turns.jsonl');
  const prior = (existsSync(turnsFile) ? readFileSync(turnsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []) as TurnRecord[];
  const fullPlan = trialPlan(tasks, arms, models, reps, seed);
  const todo = nextAttempts(fullPlan.filter((t) => !only || only.includes(t.trial_id)), prior.map((r) => r.trial_id), repair !== undefined);
  const unlock = lockHost(['work-' + sha256(work).slice(0, 12)]);
  process.on('exit', unlock);

  const images = build(work, has('--skip-build'), tasks);
  const pre = preflight(dryRun, edition, images);
  const preName = existsSync(join(results, 'preflight.json')) ? 'preflight-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json' : 'preflight.json';
  writeFileSync(join(results, preName), JSON.stringify({ ...design, dry_run: dryRun, date: new Date().toISOString(), images, edition: edition.map((s) => ({ name: s.name, description: s.description, body_chars: s.body.length, marker: markers[s.name]!.execute_regex, files: s.files.map(({ content, ...f }) => ({ ...f, chars: content.length })) })), ...pre }, null, 2) + '\n');
  console.log('s1e: preflight ' + (pre.problems.length ? 'FAILED: ' + pre.problems.join('; ') : 'ok') + ' (' + Object.keys(images.tasks).length + ' task images; host checks ' + (pre.host_enforced ? 'enforced' : 'recorded only, dry run') + ')');
  if (pre.problems.length) return 3;

  let fake: FakeAnthropic | null = null;
  const front = dryRun ? Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    if (!fake) return new Response('no fake model for this trial', { status: 503 });
    const u = new URL(req.url);
    return fetch(fake.url + u.pathname + u.search, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : await req.arrayBuffer() });
  } }) : null;
  const responses = dryRun ? startFakeResponses({ host: '127.0.0.1', port: 0, log: join(results, 'fake-responses.ndjson'), requireKeyPrefix: CAPTURE_DUMMY_KEYS.OPENAI_API_KEY }) : null;
  const setFake = (provider: 'anthropic' | 'openai', script: Turn[]) => {
    if (provider === 'openai') { responses!.setScript(script as ResponsesTurn[]); return; }
    fake?.stop();
    fake = startFakeAnthropic({ host: '127.0.0.1', port: 0, log: join(results, 'fake-requests.ndjson'), requireKeyPrefix: DUMMY_KEY_PREFIX, script });
  };
  const allowModels = models.flatMap((m) => [MODELS[m].model, MODELS[m].housekeeping]);
  const upstream = front && responses ? { anthropic: 'http://127.0.0.1:' + front.port, openai: 'http://127.0.0.1:' + responses.port } : null;
  const proxy = await RunProxy.start({ runId, runDir: results, ledgerPath: ledgerPath!, leaseUsd, allowModels, maxOutputTokens: 128_000, reachableFromContainers: false, newRun: has('--new-run') || dryRun, ...(upstream ? { capture: { upstream, dns: null } } : {}) });
  if (dryRun && has('--inject-fault')) todo.push({ trial: { trial_id: 'dry-fault-edition-in-plain-' + models[0], task: tasks[0]!, arm: 'plain', model: models[0]!, rep: 0, fault: 'edition-in-plain' }, attempt: 1 });
  const baseline = names();
  const rows: Array<{ record: TurnRecord; detail: Record<string, unknown> }> = [];
  try {
    for (const { trial, attempt: next } of todo) {
      const residue = newSince(baseline, names());
      if (!empty(residue)) { console.error('s1e: an earlier trial left ' + JSON.stringify(residue) + '; later trials could not be clean, so the run stops'); break; }
      let attempt = next, died = false;
      for (let lines = proxy.usageLines(trialKey(attemptId(trial.trial_id, attempt))); lines.length; lines = proxy.usageLines(trialKey(attemptId(trial.trial_id, ++attempt)))) {
        const key = trialKey(attemptId(trial.trial_id, attempt));
        const meter = await proxy.finalize(key).catch(() => null);
        const usd = lines.reduce((s, l) => s + (l.actual_usd ?? (l.charged_reservation ? l.reserved_usd ?? 0 : 0)), 0);
        const dead: TurnRecord = { trial_id: attemptId(trial.trial_id, attempt), task_id: trial.task.id, family: trial.task.family, arm: trial.arm, model: MODELS[trial.model].model, rep: trial.rep, status: 'infra_error', reply_text: '', counts: { open_matched: false, open_any: false, complete_read: false, first_step: false, approvals_answered: 0, contaminated: false }, usage: meter ? { ...summarizeUsage(key, meter, lines).usage, usd } : null, wall_s: null };
        appendFileSync(turnsFile, JSON.stringify(dead) + '\n');
        console.error('s1e: ' + dead.trial_id + ' made ' + lines.length + ' metered calls ($' + usd.toFixed(6) + ' from the usage log) but left no record (the driver or machine died mid-trial); recorded as infra_error');
        died = true;
      }
      if (died && repair === undefined) { console.error('s1e: ' + trial.trial_id + ' is not rerun without a named repair; rerun it with --only ' + trial.trial_id + ' --repair <what was fixed>'); continue; }
      const row = await runTrial(trial, attempt, { proxy, work, results, edition, markers, images, dryRun, runId, repair, setFake });
      rows.push(row);
      const c = row.record.counts;
      console.log('s1e: ' + row.record.trial_id + ' ' + row.record.status + ' open=' + c.open_matched + ' complete=' + c.complete_read + ' first_step=' + c.first_step + ' approvals=' + c.approvals_answered + ' contaminated=' + c.contaminated + ' usd=' + (row.record.usage?.usd ?? 0).toFixed(6));
      if (row.detail.cap_stop) { console.error('s1e: cap stop (HE-BUDGET-001); the run is incomplete and nothing is rerun'); break; }
    }
  } finally {
    await proxy.stop();
    (fake as FakeAnthropic | null)?.stop();
    responses?.stop();
    front?.stop(true);
  }
  const leftover = newSince(baseline, names());
  const latest = new Map<string, TurnRecord>();
  for (const r of [...prior, ...rows.filter((x) => !x.detail.injected_fault).map((x) => x.record)]) latest.set(r.trial_id.replace(/-r\d+$/, ''), r);
  const planned = fullPlan.filter((t) => !only || only.includes(t.trial_id)).length;
  const missing = fullPlan.filter((t) => !latest.has(t.trial_id)).map((t) => t.trial_id);
  const capStop = rows.some((r) => r.detail.cap_stop);
  const gitOnPath = pre.image_checks.every((c) => c.git !== null);
  const checks = dryRun ? dryRunChecks(rows, planned, edition, leftover, has('--inject-fault'), gitOnPath) : null;  const summary = { ...design, dry_run: dryRun, date: new Date().toISOString(), trials_this_invocation: rows.length, trials_recorded: latest.size, complete: !capStop && !missing.length, cap_stop: capStop, missing, cells: summarize([...latest.values()]), injected: rows.filter((r) => r.detail.injected_fault).map((r) => ({ trial_id: r.record.trial_id, contaminated: r.record.counts.contaminated, problems: (r.detail.count_detail as CountDetail).clean.problems })), leftover, ...(checks ? { checks } : {}) };
  writeFileSync(join(results, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log('s1e: summary ' + join(results, 'summary.json'));
  if (checks) { console.log('s1e: dry-run checks ' + JSON.stringify(checks)); return Object.values(checks).every(Boolean) ? 0 : 1; }
  if (!summary.complete) console.error('s1e: the run is incomplete (cap stop ' + capStop + ', ' + missing.length + ' planned trials without a record)');
  return summary.complete ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
