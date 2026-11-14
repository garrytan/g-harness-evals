#!/usr/bin/env bun
// QM /review smoke (internal-task plan, Cells: "QM smoke", Opus 5.5 on QM, one unit, a harness finding that is not counted).
// One review session of one unit repository on QM through Pi (harnesses/qm, pinned in harnesses/qm/pin.json), told the
// plan's review line: the R2 prefix (gstack-evals wiki/plans/2026-11-03-geva-255-r2-after-pin-amendment/
// told-gstack-full-rr2.txt), a space, and gstack-evals' TOLD_TEMPLATE with {base} filled. It writes the session's four
// exposure signals (review-signals.ts), its termination, the proxy's cost and the wall time.
//
// How gstack gets onto QM here. gstack at the pin (GSTACK_PIN, v1.99.3.0) ships no review skill for QM: its QM edition
// (gstack qm/edition.json, hosts/qm.ts) holds gstack-plan only since gstack#4279 (internal-task), and gstack-harness register
// qm imports the whole repository as a QM skill pack, which QM refuses at its 5,000-file and 32 MiB caps
// (src/skills/pack-fetcher.ts:156-157; gstack at the pin is 5,049 files and 87 MB). So the smoke installs gstack's own
// review/ folder at the pin, every regular file byte for byte, as one QM skill named review through the deployment
// layer, the way gstack's qm/README.md installs an edition skill (PUT /v1/deployment-layer, as qm up sends it; QM file:line
// citations in harnesses/qm/gstack/README.md). The text is the default host's rendering (~/.claude/skills/gstack paths,
// "the Agent tool"); nothing is rewritten.
//
// QM's subagents. QM's subagent tool (subagents, action open) is offered only when the member has the persistent_subagents
// or responsive_spine feature (src/core/orchestrator.ts:1032-1035 and src/agent/agent-run.ts:791 at 90e4ced7); both are
// off on a new org. --subagents on (the default) turns persistent_subagents on for the member's personal scope through
// QM's admin API (PUT /v1/admin/scopes/org:<org>/feature-flags), so gstack's Review Army has a tool to dispatch with;
// --subagents off leaves QM as shipped.
//
// The unit repository is built the way gstack-evals src/trial/review/unit.ts builds one (head and its ancestry only, no
// remotes, tags or reflog, the base branch and refs/remotes/origin/<base> at the merge-base) and baked into the sandbox
// image at /root/workspace, the directory QM's shell starts in, so it is the session's work dir; .agent-skills/ (where QM
// syncs a skill's files) goes in .git/info/exclude.
//
//   env -i PATH=$PATH HOME=$HOME bun harnesses/qm/gstack/review-smoke.ts --dry-run [--subagents on|off] [--skip-build]
//   env -i PATH=$PATH HOME=$HOME ANTHROPIC_API_KEY=... bun harnesses/qm/gstack/review-smoke.ts --ledger <ledger.sqlite>
//       --lease-usd <at most 10> [--new-run] [--skip-build]   (the proxy creates the lease ledger when the file is missing)
//     common: [--work ~/.capy/work/harn95/qm-smoke] [--out <dir>] [--gstack <checkout at GSTACK_PIN>]
//             [--source <full clone of the unit's repository>] [--unit <unit.json>] [--settle-s <s>] [--plan]
// --plan prints the resolved plan (told line, unit, skill files) and exits before any image, stack or proxy.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ORG_SCOPE, ROOT, imageInfo, lockHost, qmClient, upStack, type Call } from './qm-stack.ts';
import { MODELS, sandboxProblem } from './s1-probe.ts';
import { nextApproval } from './s1e-count.ts';
import { entriesOf, reviewSignals, SignalError, type ReaderMap, type ReviewSignals } from './review-signals.ts';
import { RunProxy, reconcile, summarizeUsage, trialKey, trialSlug, trialToken } from '../../../runner/trial/proxy.ts';
import { stream } from '../../../scripts/gsta-135/fake-anthropic.ts';

export const GSTACK_PIN = '4bee369d4a417fb82c6d43c0b79351428305ef10';
export const GSTACK_VERSION = '1.99.3.0';
const GSTACK_REPO = 'https://github.com/garrytan/gstack';
export const SKILL_ID = 'review';
/** gstack-evals src/trial/review/told.ts TOLD_TEMPLATE at 91d76421, word for word; its sha256 is the preregistered one. */
export const TOLD_TEMPLATE = [
  'Review the changes on this branch against the base branch {base}: the commits this branch adds since it left {base}, as git diff {base}...HEAD shows them.',
  '',
  'You may write and run throwaway tests, repro scripts and commands, but only under a scratch directory outside this repository (for example one made with mktemp -d). Do not change the code under review, and do not commit or push.',
  '',
  'End your reply with one fenced json block that lists your findings: a JSON array with one object per finding, or [] when you have none. Each object has these fields:',
  '- "file": the path of the file, relative to the repository root',
  '- "line": the line number on this branch, or null',
  '- "severity": the label your review procedure gives the finding',
  '- "claim": what is wrong, in one or two sentences',
  '- "evidence": what shows it, such as the code involved or a command you ran and what it printed',
  '- "confirmed": true or false when your procedure confirms findings by running something; leave it out otherwise',
].join('\n');
export const TOLD_SHA256 = '16862a34212cd2eddbcedbc5654b26cb92b0dad50e3d501686770e6bc3d088ad';
/** The R2 review prefix: told-gstack-full-rr2.txt without its final newline (the file's sha256 is PREFIX_FILE_SHA256). */
export const REVIEW_PREFIX = '/review Run the full review procedure: dispatch the Review Army specialists your plan selects and run the adversarial pass. Do not make Fix-First edits; report findings only. Writes to gstack\'s own state (its learnings, timeline and review log) are allowed. If a stop hook blocks your reply, end your next reply again with the complete fenced json block.';
export const PREFIX_FILE_SHA256 = 'c6334bf77190ad4db057100d5e3e0b1ee27b454215739474e89a5e0cc7c93482';
/** The told line, unchanged for QM: QM has no slash commands, so "/review" reaches the model as text, and the skill it
 *  names is installed under that name in QM's skill index. */
export const toldLine = (base: string) => REVIEW_PREFIX + ' ' + TOLD_TEMPLATE.replaceAll('{base}', base);
/** gstack-evals' reader map for /review (copied byte for byte; the sha256 is the source file's). */
export const READER_MAP_FILE = join(import.meta.dir, 'reader-map-gstack-699a41cb6808.json');
export const READER_MAP_SHA256 = 'd74a9e1c21d635a2a7def12f1c0e77ae5566f74f787be2fe215518f164470651';

export interface Unit { id: string; repo: string; pr: number; head: string; base: string; base_branch: string; licence: string; url: string }
/** honojs/hono#5353 "fix(etag): preserve commas within quoted entity tags", merged 2026-11-04: MIT, 30 lines added and 4
 *  removed in 2 files, no .gstack directory. */
export const UNIT: Unit = { id: 'honojs/hono#5353@7ed15311447c', repo: 'honojs/hono', pr: 5353, head: '7ed15311447c06f595eace4a46fe0ee2b426ac4e', base: '28e7498e88cc3d0dad2bc22ffece685dfb16eff7', base_branch: 'main', licence: 'MIT', url: 'https://github.com/honojs/hono/pull/5353' };

export const CAP_USD = 10;
export const RUN_ID = 'qm-review-smoke-2026-11';
export const DRY_RUN_ID = 'anatomy-capture-qm-review-smoke';
export const SUBAGENT_FEATURE = 'persistent_subagents';
export const WORKDIR = '/root/workspace';
export const APPROVAL_CAP = 12;
const MEMBER = 'U1', SCOPE = 'personal:' + MEMBER, PROJECT = 'qm-review-smoke';
const CORE_IMAGE = 'harness-eval/qm:dev', BASE_SANDBOX = 'harness-eval/qm-sandbox:dev';
const JUNK_FILE = /^(?:\.DS_Store|Thumbs\.db|\._.*)$/;
const FENCE = '```';
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const GIT_ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, env: GIT_ENV });
  return { status: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
};
const DIFF = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--binary', '--full-index'];

export interface UnitRepo { dir: string; head: string; merge_base: string; head_branch: string; base_branch: string; ancestry: { count: number; sha256: string }; diff_sha256: string; changed_lines: number; files: number }

/** The unit repository at dest (which must not exist), built from a full local clone as gstack-evals unit.ts builds it. */
export function buildUnitRepo(unit: Unit, source: string, dest: string): UnitRepo {
  const need = (dir: string, what: string, ...args: string[]) => {
    const r = git(dir, ...args);
    if (r.status !== 0) throw new Error('unit ' + unit.id + ': ' + what + ': ' + r.stderr.split('\n').pop());
    return r.stdout;
  };
  if (need(source, 'not a git repository', 'rev-parse', '--is-shallow-repository') === 'true') throw new Error('unit ' + unit.id + ': the source clone ' + source + ' is shallow; clone it in full');
  const head = need(source, 'no head commit', 'rev-parse', '--verify', '--quiet', unit.head + '^{commit}');
  const base = need(source, 'no base commit', 'rev-parse', '--verify', '--quiet', unit.base + '^{commit}');
  const mergeBase = need(source, 'no merge-base', 'merge-base', head, base);
  const ancestry = need(source, 'rev-list', 'rev-list', head).split('\n').filter(Boolean).sort();
  const diff = spawnSync('git', ['-C', source, ...DIFF, mergeBase, head], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, env: GIT_ENV }).stdout ?? '';
  const numstat = need(source, 'numstat', 'diff', '--numstat', mergeBase, head).split('\n').filter(Boolean);
  if (existsSync(dest)) throw new Error('unit ' + unit.id + ': ' + dest + ' already exists');
  mkdirSync(dest, { recursive: true });
  const headBranch = 'pr-' + unit.pr;
  need(dest, 'git init', 'init', '-q', '-b', headBranch);
  need(dest, 'fetch the head', '-c', 'uploadpack.allowAnySHA1InWant=true', 'fetch', '-q', '--no-tags', '--no-write-fetch-head', resolve(source), head);
  need(dest, 'head branch', 'update-ref', 'refs/heads/' + headBranch, head);
  need(dest, 'base branch', 'update-ref', 'refs/heads/' + unit.base_branch, mergeBase);
  need(dest, 'origin base', 'update-ref', 'refs/remotes/origin/' + unit.base_branch, mergeBase);
  need(dest, 'origin HEAD', 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/' + unit.base_branch);
  need(dest, 'checkout', 'reset', '-q', '--hard', head);
  need(dest, 'reflog', 'reflog', 'expire', '--expire=now', '--all');
  for (const leftover of ['logs', 'FETCH_HEAD', 'ORIG_HEAD']) rmSync(join(dest, '.git', leftover), { recursive: true, force: true });
  need(dest, 'gc', 'gc', '-q', '--prune=now');
  rmSync(join(dest, '.git', 'logs'), { recursive: true, force: true });
  appendFileSync(join(dest, '.git', 'info', 'exclude'), '\n.agent-skills/\n');
  const changed = numstat.reduce((a, l) => { const [add, del] = l.split('\t'); return a + (Number(add) || 0) + (Number(del) || 0); }, 0);
  return { dir: dest, head, merge_base: mergeBase, head_branch: headBranch, base_branch: unit.base_branch, ancestry: { count: ancestry.length, sha256: sha256(ancestry.join('\n')) }, diff_sha256: sha256(diff), changed_lines: changed, files: numstat.length };
}

/** Every way dir differs from the unit repository that was built (gstack-evals unit.ts historyProblems); empty passes. */
export function unitProblems(dir: string, repo: UnitRepo): string[] {
  const problems: string[] = [];
  const lines = (...args: string[]) => { const r = git(dir, ...args); if (r.status !== 0) problems.push('git ' + args.join(' ') + ' failed'); return r.stdout.split('\n').filter(Boolean); };
  const all = lines('rev-list', '--all').sort();
  if (all.length !== repo.ancestry.count || sha256(all.join('\n')) !== repo.ancestry.sha256) problems.push('git rev-list --all holds ' + all.length + ' commits, not the head\'s ancestry of ' + repo.ancestry.count);
  if (lines('tag', '-l').length) problems.push('tags present');
  if (lines('remote').length) problems.push('remotes configured');
  for (const leftover of ['logs', 'FETCH_HEAD', 'ORIG_HEAD']) if (existsSync(join(dir, '.git', leftover))) problems.push('.git/' + leftover + ' is present');
  const refs = lines('for-each-ref', '--format=%(refname) %(objectname)').sort();
  const want = ['refs/heads/' + repo.base_branch + ' ' + repo.merge_base, 'refs/heads/' + repo.head_branch + ' ' + repo.head, 'refs/remotes/origin/' + repo.base_branch + ' ' + repo.merge_base, 'refs/remotes/origin/HEAD ' + repo.merge_base].sort();
  if (refs.join('\n') !== want.join('\n')) problems.push('refs are ' + JSON.stringify(refs));
  if (git(dir, 'rev-parse', 'HEAD').stdout !== repo.head) problems.push('HEAD is not the head commit');
  const diff = spawnSync('git', ['-C', dir, ...DIFF, repo.base_branch + '...HEAD'], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, env: GIT_ENV }).stdout ?? '';
  if (sha256(diff) !== repo.diff_sha256) problems.push('git diff ' + repo.base_branch + '...HEAD is not the unit\'s diff');
  if (git(dir, 'status', '--porcelain').stdout) problems.push('the working tree is not clean');
  return problems;
}

export interface LayerFile { path: string; content: string; executable?: true }
/** gstack's review/ folder as one QM deployment-layer skill: every regular file under <gstack>/review, read the way qm up
 *  reads a deploy dir (regular text files only, junk names skipped, the executable bit kept), at skills/review/<path>. */
export function reviewLayer(gstackRoot: string): { contract: 1; tools: never[]; skills: LayerFile[] } {
  const root = join(gstackRoot, SKILL_ID);
  const skills: LayerFile[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      if (JUNK_FILE.test(name)) continue;
      const r = rel ? rel + '/' + name : name;
      const st = lstatSync(join(root, r));
      if (st.isDirectory()) { walk(r); continue; }
      if (!st.isFile()) throw new Error('review layer: ' + r + ' is not a regular file');
      skills.push({ path: 'skills/' + SKILL_ID + '/' + r, content: readFileSync(join(root, r), 'utf8'), ...((st.mode & 0o111) !== 0 ? { executable: true as const } : {}) });
    }
  };
  walk('');
  if (!skills.some((f) => f.path === 'skills/' + SKILL_ID + '/SKILL.md')) throw new Error('review layer: no ' + SKILL_ID + '/SKILL.md under ' + gstackRoot);
  return { contract: 1, tools: [], skills: skills.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
}

export function loadReaderMap(file = READER_MAP_FILE): ReaderMap {
  const bytes = readFileSync(file);
  if (sha256(bytes) !== READER_MAP_SHA256) throw new Error('reader map ' + file + ' has sha256 ' + sha256(bytes) + ', want ' + READER_MAP_SHA256);
  return JSON.parse(bytes.toString('utf8')) as ReaderMap;
}

type Block = Record<string, unknown>;
const textOf = (c: unknown): string => typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b && typeof b === 'object' ? String((b as Block).text ?? (b as Block).content ?? '') : '')).join('\n') : '';
/** The dry run's scripted model, stateless: the answer depends only on the request. The reviewing session (its first user
 *  message holds the told line) loads the review skill, runs one git command in the work dir, opens a testing reader and
 *  an adversarial reader when QM offers subagents, waits until both reports are back and ends with a json block. Any
 *  other session with tools (a reader) answers with a report at once; a request without tools gets "ok". */
export function fakeAnswer(body: Block): { content: Block[]; stop: string } {
  const tools = Array.isArray(body.tools) ? (body.tools as Block[]).map((t) => String(t.name ?? '')) : [];
  const messages = Array.isArray(body.messages) ? (body.messages as Block[]) : [];
  const text = (t: string) => ({ content: [{ type: 'text', text: t }], stop: 'end_turn' });
  if (!tools.length) return text('ok');
  const call = (name: string, input: Block) => ({ content: [{ type: 'tool_use', id: 'toolu_fake_' + crypto.randomUUID().slice(0, 8), name, input }], stop: 'tool_use' });
  const firstUser = textOf(messages.find((m) => m.role === 'user')?.content);
  if (!firstUser.includes(REVIEW_PREFIX.slice(0, 60))) return text('fake reader report: no findings (dry run)');
  const uses = messages.filter((m) => m.role === 'assistant').flatMap((m) => (Array.isArray(m.content) ? (m.content as Block[]) : [])).filter((b) => b.type === 'tool_use');
  const history = messages.map((m) => textOf(m.content)).join('\n');
  const finals = (history.match(/<wake reason="subagent"[^>]*kind="final_answer"/g) ?? []).length;
  const done = text('Dry run review done.\n\n' + FENCE + 'json\n[]\n' + FENCE);
  const step = uses.length;
  if (step === 0) return call('skills', { action: 'read', name: SKILL_ID });
  if (step === 1) return call('execute', { command: 'git diff --stat main...HEAD', purpose: 'See the diff under review' });
  if (!tools.includes('subagents')) return done;
  if (step === 2) return call('subagents', { action: 'open', name: 'testing', task: 'Read the checklist review/specialists/testing.md in the synced review skill and review git diff main...HEAD in /root/workspace. Report findings only. (dry run)' });
  if (step === 3) return call('subagents', { action: 'open', name: 'adversarial', task: 'Think like an attacker and a chaos engineer. Review git diff main...HEAD in /root/workspace and report findings only. (dry run)' });
  if (finals >= 2 || step > 12) return done;
  return call('subagents', { action: 'wait', timeoutMs: 20000 });
}

function startFake(log: string) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname.endsWith('/v1/models')) return Response.json({ data: [{ id: 'claude-opus-5-5', type: 'model' }], has_more: false });
    if (req.method !== 'POST' || !url.pathname.endsWith('/v1/messages')) return new Response('not found', { status: 404 });
    const body = (await req.json()) as Block;
    const a = fakeAnswer(body);
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), model: body.model, tools: Array.isArray(body.tools) ? body.tools.length : 0, messages: Array.isArray(body.messages) ? body.messages.length : 0, answer: a.content }) + '\n');
    const msg = { id: 'msg_fake_' + Date.now(), type: 'message', role: 'assistant', model: String(body.model ?? ''), content: a.content, stop_reason: a.stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!body.stream) return Response.json(msg);
    return new Response(stream(msg, a.content, a.stop), { headers: { 'content-type': 'text/event-stream' } });
  } });
  return { url: 'http://127.0.0.1:' + server.port, stop: () => server.stop(true) };
}

const docker = (...args: string[]) => spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const names = () => ({
  containers: docker('ps', '-a', '--format', '{{.Names}}').stdout.split('\n').filter(Boolean),
  volumes: docker('volume', 'ls', '-q').stdout.split('\n').filter(Boolean),
  networks: docker('network', 'ls', '--format', '{{.Name}}').stdout.split('\n').filter(Boolean),
});
type Names = ReturnType<typeof names>;
const newSince = (before: Names, after: Names) => ({ containers: after.containers.filter((n) => !before.containers.includes(n)), volumes: after.volumes.filter((n) => !before.volumes.includes(n)), networks: after.networks.filter((n) => !before.networks.includes(n)) });
const empty = (n: Names) => !n.containers.length && !n.volumes.length && !n.networks.length;

/** The unit's sandbox image: QM's sandbox with the unit repository as /root/workspace and nothing else added. */
function buildImages(work: string, unitDir: string, repo: UnitRepo, skipBuild: boolean) {
  const run = (name: string, args: string[], input?: string) => {
    const r = spawnSync('docker', ['build', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...(input ? { input } : {}) });
    writeFileSync(join(work, 'build-' + name + '.log'), (r.stdout ?? '') + (r.stderr ?? ''));
    if (r.status !== 0) throw new Error('image build ' + name + ' failed (' + join(work, 'build-' + name + '.log') + ')');
  };
  if (!skipBuild) {
    run('core', ['-t', CORE_IMAGE, join(ROOT, 'harnesses', 'qm')]);
    run('sandbox', ['-f', join(ROOT, 'harnesses', 'qm', 'Dockerfile.sandbox'), '-t', BASE_SANDBOX, join(ROOT, 'harnesses', 'qm')]);
  }
  const context = join(work, 'context');
  rmSync(context, { recursive: true, force: true });
  mkdirSync(context, { recursive: true });
  cpSync(unitDir, join(context, 'repo'), { recursive: true, verbatimSymlinks: true });
  const image = 'harness-eval/qm-sandbox:review-smoke-' + repo.diff_sha256.slice(0, 12);
  run('unit', ['-f', '-', '-t', image, '--label', 'org.harness-eval.unit=' + repo.head, context], 'FROM ' + BASE_SANDBOX + '\nRUN --mount=type=bind,source=.,target=/ctx rm -rf ' + WORKDIR + ' && cp -a /ctx/repo ' + WORKDIR + '\n');
  return { core: { name: CORE_IMAGE, ...imageInfo(CORE_IMAGE) }, sandbox: { name: BASE_SANDBOX, ...imageInfo(BASE_SANDBOX) }, unit: { name: image, ...imageInfo(image) }, built: !skipBuild };
}

/** The unit image's own check: the work dir is the unit repository at its head with the expected refs, and no gstack
 *  file (a SKILL.md, a gstack path, a ~/.claude/skills tree) is anywhere in the image. */
function imageProblems(image: string, repo: UnitRepo): string[] {
  const r = docker('run', '--rm', '--network', 'none', '--user', '0', '--entrypoint', 'sh', image, '-c',
    'cd ' + WORKDIR + ' && git rev-parse HEAD && git for-each-ref --format="%(refname) %(objectname)" | sort | tr "\\n" "|" && echo && git status --porcelain | wc -l && { find / -xdev \\( -name SKILL.md -o -iname "*gstack*" \\) -print 2>/dev/null; ls -d /root/.claude/skills 2>/dev/null; true; }');
  if (r.status !== 0) return ['image check failed: ' + (r.stderr ?? '').slice(-300)];
  const [head, refs, dirty, ...found] = r.stdout.trim().split('\n');
  const problems: string[] = [];
  if (head !== repo.head) problems.push('work dir HEAD is ' + head);
  const want = ['refs/heads/' + repo.base_branch + ' ' + repo.merge_base, 'refs/heads/' + repo.head_branch + ' ' + repo.head, 'refs/remotes/origin/' + repo.base_branch + ' ' + repo.merge_base, 'refs/remotes/origin/HEAD ' + repo.merge_base].sort().join('|') + '|';
  if (refs !== want) problems.push('refs in the image: ' + refs);
  if (dirty?.trim() !== '0') problems.push('work dir not clean (' + dirty + ' lines)');
  for (const f of found.filter((p) => p.endsWith('/SKILL.md') || p.startsWith('/root/.claude') || /(?:^|[^a-z])gstack/i.test(p))) problems.push('gstack file in the image: ' + f);
  return problems;
}

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }
const has = (name: string) => process.argv.includes(name);

/** A gstack checkout at GSTACK_PIN: --gstack, or one fetched by sha into the work dir. */
function gstackCheckout(work: string, given: string | undefined): string {
  if (given) return resolve(given);
  const dir = join(work, 'gstack');
  if (git(dir, 'rev-parse', 'HEAD').stdout !== GSTACK_PIN) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q');
    const f = git(dir, 'fetch', '-q', '--depth', '1', GSTACK_REPO, GSTACK_PIN);
    if (f.status !== 0 || git(dir, 'checkout', '-q', 'FETCH_HEAD').status !== 0) throw new Error('could not fetch gstack ' + GSTACK_PIN + ': ' + f.stderr);
  }
  return dir;
}

/** A full clone of the unit's repository with the PR head fetched: --source, or one cloned into the work dir. */
function sourceClone(work: string, unit: Unit, given: string | undefined): string {
  const dir = given ? resolve(given) : join(work, 'src', unit.repo.split('/').pop()!);
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(join(dir, '..'), { recursive: true });
    const c = spawnSync('git', ['clone', '-q', 'https://github.com/' + unit.repo, dir], { encoding: 'utf8', env: GIT_ENV });
    if (c.status !== 0) throw new Error('could not clone ' + unit.repo + ': ' + c.stderr);
  }
  if (git(dir, 'cat-file', '-t', unit.head).stdout !== 'commit') git(dir, 'fetch', '-q', 'origin', 'pull/' + unit.pr + '/head');
  return dir;
}

/** The findings block the told line asks for: the reply's last fenced json block, parsed. */
export function jsonBlock(reply: string): { parsed: boolean; findings: number | null } {
  const blocks = [...reply.matchAll(new RegExp(FENCE + 'json\\s*\\n([\\s\\S]*?)\\n' + FENCE, 'g'))];
  const last = blocks.at(-1)?.[1];
  if (!last) return { parsed: false, findings: null };
  try { const v = JSON.parse(last); return Array.isArray(v) ? { parsed: true, findings: v.length } : { parsed: false, findings: null }; } catch { return { parsed: false, findings: null }; }
}

async function main(): Promise<number> {
  const dryRun = has('--dry-run');
  const fail = (m: string) => { console.error('review-smoke: ' + m); return 2; };
  const work = resolve(arg('--work') ?? join(homedir(), '.capy', 'work', 'harn95', 'qm-smoke'));
  const out = resolve(arg('--out') ?? join(work, dryRun ? 'dry-run-' + new Date().toISOString().replace(/[:.]/g, '-') : 'results'));
  const subagents = arg('--subagents') ?? 'on';
  if (subagents !== 'on' && subagents !== 'off') return fail('--subagents takes on or off');
  const leaseUsd = Number(arg('--lease-usd') ?? (dryRun ? 20 : NaN));
  if (!(leaseUsd > 0 && leaseUsd <= (dryRun ? 20 : CAP_USD))) return fail('--lease-usd must be above 0 and at most ' + (dryRun ? '$20 in a dry run (capture mode, never paid)' : 'the smoke cap of $' + CAP_USD));
  const ledgerPath = dryRun ? join(out, 'ledger.sqlite') : arg('--ledger');
  if (!dryRun && !ledgerPath) return fail('a paid run needs --ledger <the lease ledger file; the metering proxy creates it>');
  const settleS = Number(arg('--settle-s') ?? (dryRun ? 180 : 1200));
  const unit: Unit = arg('--unit') ? JSON.parse(readFileSync(resolve(arg('--unit')!), 'utf8')) : UNIT;
  if (sha256(TOLD_TEMPLATE) !== TOLD_SHA256 || sha256(REVIEW_PREFIX + '\n') !== PREFIX_FILE_SHA256) return fail('the told template or the R2 prefix moved from its pinned sha256');
  const map = loadReaderMap();
  mkdirSync(out, { recursive: true });

  const gstackRoot = gstackCheckout(work, arg('--gstack'));
  const gstackHead = git(gstackRoot, 'rev-parse', 'HEAD').stdout;
  if (!dryRun && (gstackHead !== GSTACK_PIN || git(gstackRoot, 'status', '--porcelain', '--', SKILL_ID).stdout)) return fail('--gstack must be a checkout at ' + GSTACK_PIN + ' with review/ unchanged');
  const layer = reviewLayer(gstackRoot);
  const source = sourceClone(work, unit, arg('--source'));
  const unitDir = join(out, 'unit', 'repo');
  rmSync(join(out, 'unit'), { recursive: true, force: true });
  const repo = buildUnitRepo(unit, source, unitDir);
  const unitBad = unitProblems(unitDir, repo);
  if (unitBad.length) return fail('unit repository: ' + unitBad.join('; '));
  const told = toldLine(repo.base_branch);
  const cell = MODELS.opus;
  const skillMd = layer.skills.find((f) => f.path === 'skills/' + SKILL_ID + '/SKILL.md')!;
  const plan = {
    run_id: dryRun ? DRY_RUN_ID : RUN_ID, dry_run: dryRun, cap_usd: CAP_USD, lease_usd: leaseUsd,
    qm: JSON.parse(readFileSync(join(ROOT, 'harnesses', 'qm', 'pin.json'), 'utf8')).commit as string,
    gstack: { pin: GSTACK_PIN, version: GSTACK_VERSION, checkout_head: gstackHead },
    skill: { id: SKILL_ID, files: layer.skills.length, chars: layer.skills.reduce((a, f) => a + f.content.length, 0), skill_md_chars: skillMd.content.length, bundle_sha256: sha256(JSON.stringify(layer)) },
    told: { text: told, sha256: sha256(told), template_sha256: TOLD_SHA256, prefix_file_sha256: PREFIX_FILE_SHA256 },
    reader_map: { file: READER_MAP_FILE.slice(ROOT.length + 1), sha256: READER_MAP_SHA256, gstack: map.gstack.sha },
    unit: { ...unit, head_branch: repo.head_branch, merge_base: repo.merge_base, ancestry: repo.ancestry, diff_sha256: repo.diff_sha256, changed_lines: repo.changed_lines, files: repo.files, workdir: WORKDIR },
    model: cell.model, housekeeping: cell.housekeeping, subagents: subagents === 'on' ? SUBAGENT_FEATURE + ' on for ' + SCOPE : 'QM default (no subagent feature)',
  };
  writeFileSync(join(out, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  if (has('--plan')) { console.log(JSON.stringify(plan, null, 2)); return 0; }

  const unlock = lockHost(['work-' + sha256(work).slice(0, 12)]);
  process.on('exit', unlock);
  const images = buildImages(work, unitDir, repo, has('--skip-build'));
  const preProblems = imageProblems(images.unit.name, repo);
  writeFileSync(join(out, 'preflight.json'), JSON.stringify({ images, problems: preProblems }, null, 2) + '\n');
  console.log('review-smoke: preflight ' + (preProblems.length ? 'FAILED: ' + preProblems.join('; ') : 'ok') + ' (' + images.unit.name + ')');
  if (preProblems.length) return 3;

  const fake = dryRun ? startFake(join(out, 'fake-requests.ndjson')) : null;
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
  if (!dryRun && process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const proxy = await RunProxy.start({ runId: plan.run_id, runDir: out, ledgerPath: ledgerPath!, leaseUsd, allowModels: [cell.model, cell.housekeeping], maxOutputTokens: 128_000, reachableFromContainers: false, newRun: dryRun || has('--new-run'), env, ...(fake ? { capture: { upstream: { anthropic: fake.url }, dns: null } } : {}) });
  const id = 'qm-review-smoke-' + unit.repo.split('/').pop() + '-' + unit.pr + (dryRun ? '-dry' : '');
  const slot = trialSlug(id), key = trialKey(id), token = trialToken(id);
  const before = names();
  const calls: Record<string, unknown> = {};
  let stackError: string | null = null, approvalStop: string | null = null, last: Call | null = null, turnMs = 0, settleMs = 0, machineId: string | null = null;
  let parent: unknown = null, endSeq: number | null = null, sessionId: string | null = null;
  const extra = new Set<string>();
  const children: Record<string, unknown> = {};
  const requests: Array<Record<string, unknown>> = [];
  const approvals: Array<{ command: string; http: number; status: string | null }> = [];
  const started = new Date().toISOString();
  await proxy.bind(slot, key, token, [cell.model, cell.housekeeping]);
  try {
    const stack = await upStack({ out: join(out, 'stack'), project: PROJECT, modelBaseUrl: proxy.baseUrlFor(slot, 'anthropic', false), modelKey: token, modelName: cell.model.split(':')[1], modelProvider: 'anthropic', sandboxImage: images.unit.name });
    try {
      const call = qmClient(stack.url, stack.secret);
      const put = await call('PUT', '/v1/deployment-layer', layer, { admin: false });
      calls.layer_put = { http: put.http, body: put.body };
      if (put.http !== 200) throw new Error('PUT /v1/deployment-layer answered ' + put.http + ' ' + JSON.stringify(put.body).slice(0, 500));
      const got = await call('GET', '/v1/deployment-layer', undefined, { admin: false });
      const paths = ((got.body as { bundle?: { skills?: Array<{ path?: string }> } } | null)?.bundle?.skills ?? []).map((f) => String(f.path));
      calls.layer_get = { http: got.http, files: paths.length, same_paths: JSON.stringify(paths.slice().sort()) === JSON.stringify(layer.skills.map((f) => f.path)) };
      if (subagents === 'on') {
        const flag = await call('PUT', '/v1/admin/scopes/' + ORG_SCOPE + '/feature-flags', { featureName: SUBAGENT_FEATURE, scopeId: SCOPE, on: true });
        calls.feature_flag_put = { http: flag.http, body: flag.body };
        if (flag.http < 200 || flag.http >= 300) throw new Error('feature flag PUT answered ' + flag.http + ' ' + JSON.stringify(flag.body).slice(0, 300));
      }
      const scope = await call('GET', '/v1/admin/scopes/' + ORG_SCOPE);
      calls.feature_flags = (scope.body as { featureFlags?: unknown } | null)?.featureFlags ?? null;
      const created = await stack.createSandbox(() => call('POST', '/v1/admin/sandboxes/' + SCOPE, { action: 'create', backend: 'local', name: 'review-smoke' }));
      const selected = await call('POST', '/v1/admin/sandboxes/' + SCOPE, { action: 'default', sandboxId: (created.body as { id?: string } | null)?.id ?? null });
      machineId = (created.body as { machineId?: string } | null)?.machineId ?? null;
      calls.sandbox = { create_http: created.http, default_http: selected.http, machine_id: machineId };
      const bad = sandboxProblem(created, selected);
      if (bad) throw new Error(bad);
      const turnBody = { surface: 'harness-eval', actor: { externalId: MEMBER, displayName: 'Dana Okafor' }, conversation: { kind: 'dm', threadRef: 'dm:' + MEMBER + ':' + id }, text: told };
      const turnTimeout = Number(arg('--turn-timeout-s') ?? 3600) * 1000;
      console.log('review-smoke: turn started ' + new Date().toISOString());
      last = await call('POST', '/v1/turns', turnBody, { admin: false, timeoutMs: turnTimeout });
      turnMs += last.ms;
      const answered = new Set<string>();
      for (;;) {
        if (last.http === 0) break;
        const next = nextApproval(last.body, answered, APPROVAL_CAP);
        if (!next) break;
        if ('stop' in next) { approvalStop = next.stop + ' after ' + answered.size; break; }
        answered.add(next.requestId);
        last = await call('POST', '/v1/turns', { ...turnBody, approval: { requestId: next.requestId, approved: true, scope: 'once' } }, { admin: false, timeoutMs: turnTimeout });
        turnMs += last.ms;
        approvals.push({ command: next.command.slice(0, 500), http: last.http, status: (last.body as { status?: string } | null)?.status ?? null });
      }
      console.log('review-smoke: turn ended ' + new Date().toISOString() + ' http=' + last.http + ' status=' + String((last.body as { status?: unknown } | null)?.status ?? null));
      sessionId = (last.body as { sessionId?: string } | null)?.sessionId ?? null;
      const q = '?scope=' + encodeURIComponent(SCOPE);
      const readSession = async (sid: string) => { const r = await call('GET', '/v1/admin/sessions/' + sid + q + '&limit=50000'); return r.http === 200 ? r.body : { http: r.http, body: r.body }; };
      if (sessionId) {
        parent = await readSession(sessionId);
        const at = entriesOf(parent);
        endSeq = at.length ? Math.max(...at.map((e) => e.seq)) : null;
        const t0 = performance.now();
        let stable = 0, lastCount = -1;
        while ((performance.now() - t0) / 1000 < settleS) {
          let s: ReviewSignals | null = null;
          try { s = reviewSignals({ session: parent, map, told, endSeq: endSeq ?? undefined }); } catch { s = null; }
          const count = entriesOf(parent).length;
          stable = count === lastCount ? stable + 1 : 0;
          lastCount = count;
          if (s && s.readers.every((r) => r.returned) && stable >= 2) break;
          await Bun.sleep(15_000);
          parent = await readSession(sessionId);
        }
        settleMs = Math.round(performance.now() - t0);
        let sig: ReviewSignals | null = null;
        try { sig = reviewSignals({ session: parent, map, told, endSeq: endSeq ?? undefined }); } catch { sig = null; }
        for (const l of sig?.launches ?? []) if (l.session_id) children[l.session_id] = await readSession(l.session_id);
        const llmList = await call('GET', '/v1/admin/sessions/' + sessionId + '/llm' + q);
        const turnSeqs = [...new Set(((llmList.body as { requests?: Array<{ turnSeq?: unknown }> } | null)?.requests ?? []).map((r) => r.turnSeq).filter((n): n is number => typeof n === 'number'))].sort((a, b) => a - b);
        calls.llm = { list_http: llmList.http, turn_seqs: turnSeqs };
        for (const seq of turnSeqs.length ? turnSeqs : [0]) {
          const got = await call('GET', '/v1/admin/sessions/' + sessionId + '/llm' + q + '&turnSeq=' + seq);
          const reqs = ((got.body as { requests?: Array<{ step?: number; promptEnvelope?: unknown }> } | null)?.requests ?? []).slice().sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
          requests.push(...reqs.map((r) => (r.promptEnvelope ?? {}) as Record<string, unknown>));
        }
      }
      if (machineId) calls.workdir_after = docker('exec', machineId, 'sh', '-c', 'cd ' + WORKDIR + ' && git rev-parse HEAD && git status --porcelain && echo --- && find .agent-skills -maxdepth 4 -type d 2>/dev/null | head -20').stdout.slice(0, 4000);
      for (const n of docker('ps', '-a', '--filter', 'label=qm.sandbox=1', '--format', '{{.Names}}').stdout.split('\n').filter(Boolean)) if (!before.containers.includes(n) && n !== machineId && n.startsWith('qm-sbx-')) extra.add(n);
    } finally {
      stack.down();
      for (const n of extra) { docker('rm', '-f', n); docker('volume', 'rm', '-f', 'qm-home-' + n.replace(/^qm-sbx-/, '')); docker('network', 'rm', 'qm-net-' + n.replace(/^qm-sbx-/, '')); }
    }
  } catch (e) { stackError = String((e as Error)?.message ?? e).slice(0, 2000); }
  const meter = await proxy.finalize(key);
  const lines = proxy.usageLines(key);
  await proxy.unbind(slot);
  await proxy.stop();
  fake?.stop();
  const usage = summarizeUsage(key, meter, lines);
  const byModel: Record<string, { requests: number; usd: number }> = {};
  for (const l of lines) { const m = String(l.model ?? 'unknown'); byModel[m] ??= { requests: 0, usd: 0 }; byModel[m].requests++; byModel[m].usd += l.actual_usd ?? 0; }
  let signals: ReviewSignals | null = null, signalError: string | null = null;
  if (parent) { try { signals = reviewSignals({ session: parent, requests, map, told, endSeq: endSeq ?? undefined }); } catch (e) { signalError = e instanceof SignalError ? e.message : String(e); } }
  else signalError = stackError ? 'no session (stack error)' : 'POST /v1/turns returned no sessionId';
  const reply = String((last?.body as { reply?: unknown } | null)?.reply ?? '');
  const status = (last?.body as { status?: string } | null)?.status ?? null;
  const termination = stackError ? 'stack_error' : usage.cap_stop ? 'cap_stop' : !last || last.http !== 200 ? 'turn_error' : status === 'ok' || status === 'silent' ? 'ok' : 'turn_' + status;
  const leftover = newSince(before, names());
  const childSummary = Object.fromEntries(Object.entries(children).map(([sid, s]) => {
    const es = entriesOf(s);
    return [sid, { entries: es.length, tool_calls: es.filter((e) => e.type === 'tool_call').length, last_type: es.at(-1)?.type ?? null }];
  }));
  const summary = {
    ...plan, started_at: started, ended_at: new Date().toISOString(), termination, stack_error: stackError, final_turn: last ? { http: last.http, status } : null,
    reply_chars: reply.length, reply_json: jsonBlock(reply), approvals, approval_stop: approvalStop,
    wall_s: { turn: turnMs / 1000, settle: settleMs / 1000 }, end_seq: endSeq, session_id: sessionId,
    signals, signal_error: signalError, children: childSummary, captured_requests: requests.length,
    usage: usage.usage, cap_stop: usage.cap_stop, by_model: byModel, reconcile: reconcile(key, meter, lines),
    calls, leftover, extra_sandboxes_removed: [...extra],
  };
  writeFileSync(join(out, 'session.json'), JSON.stringify(parent, null, 1) + '\n');
  writeFileSync(join(out, 'children.json'), JSON.stringify(children, null, 1) + '\n');
  writeFileSync(join(out, 'requests.json'), JSON.stringify(requests, null, 1) + '\n');
  writeFileSync(join(out, 'reply.md'), reply + '\n');
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log('review-smoke: ' + termination + ' skill_opened=' + signals?.skill_opened + ' specialists=' + JSON.stringify(signals?.specialists_dispatched ?? null) + ' adversarial=' + signals?.adversarial_dispatched + ' returned_before_end=' + signals?.all_returned_before_end + ' usd=' + usage.usage.usd.toFixed(4) + ' turn_s=' + (turnMs / 1000).toFixed(0) + ' (' + join(out, 'summary.json') + ')');
  if (!dryRun) return termination === 'ok' && !signalError ? 0 : 1;
  const want = subagents === 'on'
    ? !!signals && signals.skill_opened && signals.subagent_tool_offered === true && signals.specialists_dispatched.includes('testing') && signals.adversarial_dispatched && signals.all_returned_before_end === true
    : !!signals && signals.skill_opened && signals.subagent_tool_offered === false && signals.launches.length === 0;
  const checks = { ok: termination === 'ok', signals_as_scripted: want, reconciled: summary.reconcile.proxy_consistent && usage.usage.requests > 0, nothing_left_behind: empty(leftover) };
  console.log('review-smoke: dry-run checks ' + JSON.stringify(checks));
  return Object.values(checks).every(Boolean) ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
