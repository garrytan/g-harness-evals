#!/usr/bin/env bun
// internal-task QM skill-resolver arms, keyless capture check ($0: fakes only, no provider is reached).
//
//   env -i PATH=$PATH HOME=$HOME bun scripts/skill-resolver/step0/qm/arms/qm-arms-check.ts
//       [--catalog ~/.capy/work/internal-task/catalog] [--out ~/.capy/work/internal-task/arms] [--providers anthropic,openai]
//       [--arms native,push,pull,none] [--no-infra] [--skip-build] [--gbrain <glibc binary> --gbrain-musl <musl binary>]
//
// --gbrain and --gbrain-musl put the pinned release in the arm images instead of the stand-in (the same release compiled with
// bun build --compile for bun-linux-x64 and bun-linux-x64-musl). The release has no budget switch, so the -budget image and
// the budget cell are left out and the budget is checked by the --until-exhausted replay alone; -shared stays the patched
// stand-in, since it checks that the replay catches a shared namespace, not the resolver. The index may leave out skills whose
// frontmatter sets disable-model-invocation: true (the release's not_model_invocable skips), so index_matches counts them.
// With --skip-build the images say which resolver they carry (the receipt's gbrain_version), so the release's rules apply to
// release images whether or not --gbrain is passed. The release's answer does not echo harness or session_id, so for the pull arm the session is shown by the one session
// state file the call left in the sandbox (the stand-in's skill-sessions/ or the release's .gbrain/skill-index/sessions/).
//
// Builds the four targets of Dockerfile.arms from a staged context (the resolver is the stand-in
// scripts/skill-resolver/gbrain-stub.ts compiled for musl and glibc, with its index built inside each image), plus three
// variants of the catalog image: -budget (the stand-in's budget switch file stub-budget-exhausted in the index home, so every
// session answers as spent), -stale (one catalog SKILL.md changed after the index was built, so every result says
// index_stale) and -shared (the stand-in with shadow writing on mode's session state, the fault the shadow replay exists to
// catch). Then one run-entry cell per provider and arm, one INFRA cell (anthropic, native, -stale) and one budget cell
// (anthropic, push, -budget). Each is a fresh QM stack (harnesses/qm/gstack/qm-stack.ts: Postgres and core on the arm's
// image, QM's local sandbox backend) behind the metering proxy in capture mode, whose upstreams are the repository's
// fakes. The turn is posted by the counted adapter itself: harnesses/qm/adapter.sh run, in a task container of the arm's
// image on the host network, with HE_HARNESS_CONFIG=pi-skills-<arm>, after prepare.sh has accepted the config and image
// pair. The fake model is scripted to open the skill careful with skills action read (pull: run resolve-skills through
// execute first). The arms run on the run entry only: QM's serve entry cannot register the world MCP server at this pin
// (harnesses/qm/README.md), and on the run entry instruction.md is the member's own request, so the resolver's message
// must be exactly the instruction (shadow_called, push_called).
// Checks, per cell (check.json; all must pass):
//   native  prepare_ok, listing (the catalog installed), shadow_called (one resolver call, the hook wrapper's argv with
//           --shadow, the member text as the message, no previous message), injected_nothing (the block's bytes in no
//           captured request; the user turn is the instruction byte for byte), status_line, got_skill
//   push    prepare_ok, listing, push_called (the same, without --shadow), block_in_user_turn_only (every occurrence of
//           the block in the agent requests is the start of the user turn, block + blank line + instruction; occurrences in
//           the harness's housekeeping requests are listed apart), status_line (injected, block sha256), got_skill
//   pull    prepare_ok, listing, no_adapter_call, model_call_reached (the model's execute call ran the sandbox's resolver:
//           its answer is the schema_version 1 object for harness qm and the call's session, against the sandbox index,
//           which equals the core image's), status_line (from the stored session, stdout sha256 equal to the execute
//           answer's), got_skill
//   none    prepare_ok, listing_recorded (what QM still installs and lists), no_resolver, skill_absent (the read of
//           careful is answered "no such skill file", so nothing is opened)
//   infra   status_line_infra (INDEX_STALE), infra_marker (skill-resolver/infra.json in the trial's log dir)
//   budget  budget_empty_block (no block header in any request), status_line_budget (BUDGET_EXHAUSTED), not_infra
// Every status line must carry the hook wrapper's field names (k, block_reason, budget_phase, budget_exhausted,
// no_skill_reason, session_block_tokens among them). Also once: prepare_refuses_wrong_image (pi-skills-push on the
// no-catalog image exits 2), index_matches (the core and sandbox receipts agree) and shadow_replay (the shared check
// scripts/skill-resolver/shadow-replay-check.ts through harnesses/qm/shadow-replay.sh on the native and emulated hook
// image: SHADOW_REPLAY_OK, BUDGET_REPLAY_OK with --until-exhausted, and SHADOW_REPLAY_FAIL with exit 1 on -shared).
// Writes <out>/<cell>/ (fake.ndjson, logs/, session.json, capture.json, check.json) and <out>/summary.json.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { RunProxy, summarizeUsage, trialKey, trialSlug, trialToken } from '../../../../../runner/trial/proxy.ts';
import { CAPTURE_DUMMY_KEYS } from '../../../../../runner/trial/capture.ts';
import { startFakeAnthropic, type FakeAnthropic } from '../../../../gsta-135/fake-anthropic.ts';
import { startFakeResponses, type FakeResponses } from '../../../../../tests/fixtures/fake-responses.ts';
import { DUMMY_KEY_PREFIX, ROOT, imageInfo, qmClient, upStack } from '../../../../../harnesses/qm/gstack/qm-stack.ts';
import { findSkillsBlocks, parseBlock } from '../qm-listing.ts';
import { pullCommand } from '../pull/qm-pull-check.ts';
import { skillOpens } from '../../../../../harnesses/qm/skill-opens.ts';
// @ts-expect-error plain ESM module without type declarations, run by node in the task container
import { parseResolverStdout, sessionToolCalls, splitExecuteResult } from '../../../../../harnesses/qm/skill-resolver.mjs';
import { normalizeReceipt, receiptPathIn } from '../../../result-fields.ts';

const HERE = import.meta.dir;
const STEP0 = resolve(HERE, '..');
export const IMAGES = {
  catalog: 'harness-eval/qm:harn52-arm-catalog',
  pull: 'harness-eval/qm:harn52-arm-pull',
  none: 'harness-eval/qm:harn52-arm-none',
  sandboxPull: 'harness-eval/qm-sandbox:harn52-arm-pull',
  sandbox: 'harness-eval/qm-sandbox:dev',
  catalogBudget: 'harness-eval/qm:harn52-arm-catalog-budget',
  catalogStale: 'harness-eval/qm:harn52-arm-catalog-stale',
  catalogShared: 'harness-eval/qm:harn52-arm-catalog-shared',
} as const;
const TARGETS: Array<[string, string]> = [['core-catalog', IMAGES.catalog], ['core-pull', IMAGES.pull], ['core-none', IMAGES.none], ['sandbox-pull', IMAGES.sandboxPull]];
const MODELS = {
  anthropic: { model: 'anthropic:claude-opus-5-5', housekeeping: 'anthropic:claude-haiku-5-5' },
  openai: { model: 'openai:gpt-6.1-sol', housekeeping: 'openai:gpt-5.6-luna' },
} as const;
type Provider = keyof typeof MODELS;
export const ARMS = ['native', 'push', 'pull', 'none'] as const;
type Arm = (typeof ARMS)[number];
const CONFIG: Record<Arm, string> = { native: 'pi-skills-native', push: 'pi-skills-push', pull: 'pi-skills-pull', none: 'pi-skills-none' };
const CORE_IMAGE: Record<Arm, string> = { native: IMAGES.catalog, push: IMAGES.catalog, pull: IMAGES.pull, none: IMAGES.none };
const MEMBER = 'U1', SCOPE = 'personal:' + MEMBER, PROJECT = 'qm-harn52-arms';
const TURN_TEXT = "Before I run rm -rf on the old build directory, is there a skill for doing that safely? It's Dana's repo.";
/** The first line of every block the stand-in renders (gbrain-stub.ts renderBlock); a budget-spent turn must carry none. */
const BLOCK_HEADER = 'Skills that may fit this request (gbrain skills resolve):';
const RECEIPT_PATH = receiptPathIn('/opt/skill-resolver/gbrain-home', 'he-skills');
/** The fields every status line carries, under the hook wrapper's names (scripts/skill-resolver/hook-wrapper.ts StatusLine). */
const STATUS_FIELDS = ['name', 'turn', 'session_key', 'harness', 'arm', 'mode', 'code', 'exit', 'timing_ms', 'wall_ms', 'index_stale', 'index_hash', 'gbrain_version', 'catalog_hash',
  'block_sha256', 'block_bytes', 'block_tokens', 'suggestions', 'deduped', 'no_skill', 'no_skill_reason', 'budget_exhausted', 'session_block_tokens', 'k', 'block_reason', 'budget_phase',
  'injected', 'repeat', 'infra', 'infra_reasons', 'argv', 'autorebuild_off', 'error'];
type Receipt = { catalog_hash: string; index_hash: string; gbrain_version: string; skill_count: number; skipped: Array<{ reason?: string }> };
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sha256File = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
/** The wrapper's command line; in shadow mode its --shadow-log is the trial's <log dir>/skill-resolver/shadow.ndjson (taken from the line seen). */
const argvFor = (session: string, receipt: Receipt, shadow: boolean, seen: string[] = []) => {
  const log = seen[seen.indexOf('--shadow-log') + 1] ?? '';
  return ['gbrain', 'skills', 'resolve', '--catalog', 'he-skills', '--input-json', '-', '--json', '--session', session, '--harness', 'qm', '--top-k', '5',
    ...(shadow ? ['--shadow', '--shadow-log', seen.includes('--shadow-log') && log.endsWith('/skill-resolver/shadow.ndjson') ? log : '<log dir>/skill-resolver/shadow.ndjson'] : []), '--fail-open', '--expect-catalog', receipt.catalog_hash];
};
const receiptOf = (image: string) => normalizeReceipt(JSON.parse(spawnSync('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'cat', image, RECEIPT_PATH], { encoding: 'utf8' }).stdout)) as Receipt;

function locate(body: unknown, needle: string): Array<{ path: string; offset: number; field_chars: number }> {
  const out: Array<{ path: string; offset: number; field_chars: number }> = [];
  if (!needle) return out;
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') { for (let at = v.indexOf(needle); at >= 0; at = v.indexOf(needle, at + 1)) out.push({ path, offset: at, field_chars: v.length }); }
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, path + '[' + i + ']'));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? path + '.' + k : k);
  };
  walk(body, '');
  return out;
}

/** The user turn's text in an agent request and the JSON path prefixes that belong to user-role messages. */
function userTurns(body: Record<string, unknown>): { first: string | null; userPaths: string[] } {
  const userPaths: string[] = [];
  let first: string | null = null;
  const text = (c: unknown) => (typeof c === 'string' ? c : Array.isArray(c) ? (c as Array<{ type?: string; text?: string }>).filter((x) => x.type === 'text' || x.type === 'input_text').map((x) => x.text ?? '').join('') : '');
  (body.messages as Array<{ role?: string; content?: unknown }> | undefined)?.forEach((m, i) => {
    if (m.role !== 'user') return;
    const isToolResult = Array.isArray(m.content) && (m.content as Array<{ type?: string }>).every((c) => c.type === 'tool_result');
    if (isToolResult) return;
    userPaths.push('messages[' + i + ']');
    first ??= text(m.content);
  });
  (body.input as Array<{ role?: string; type?: string; content?: unknown }> | undefined)?.forEach((m, i) => {
    if (m.role !== 'user') return;
    userPaths.push('input[' + i + ']');
    first ??= text(m.content);
  });
  return { first, userPaths };
}

function dockerBuild(args: string[], input?: string) {
  const r = spawnSync('docker', ['build', '-q', ...args], { encoding: 'utf8', input });
  if (r.status !== 0) throw new Error('docker build ' + args.join(' ') + ' failed: ' + r.stderr.slice(-1500));
}

function build(catalog: string, out: string, catalogNames: string[], release: { glibc: string; musl: string } | null) {
  const ctx = join(out, 'context');
  rmSync(ctx, { recursive: true, force: true });
  mkdirSync(join(ctx, 'tools'), { recursive: true });
  mkdirSync(join(ctx, 'harness'), { recursive: true });
  cpSync(join(catalog, 'skills'), join(ctx, 'skills'), { recursive: true });
  cpSync(join(STEP0, 'pull', 'tool'), join(ctx, 'tools', 'resolve-skills'), { recursive: true });
  cpSync(join(ROOT, 'scripts', 'skill-resolver', 'result-fields.ts'), join(ctx, 'result-fields.ts'));
  for (const f of ['adapter.sh', 'skill-resolver.mjs']) cpSync(join(ROOT, 'harnesses', 'qm', f), join(ctx, 'harness', f));
  const stub = join(ROOT, 'scripts', 'skill-resolver', 'gbrain-stub.ts');
  const source = readFileSync(stub, 'utf8'), shared = source.replace("(shadow ? 'shadow' : 'on')", "'on'");
  if (shared === source) throw new Error('gbrain-stub.ts no longer has the namespace expression the -shared variant patches');
  mkdirSync(join(ctx, 'shared'), { recursive: true });
  writeFileSync(join(ctx, 'shared', 'gbrain-stub-shared.ts'), shared);
  if (release) { cpSync(release.glibc, join(ctx, 'gbrain')); cpSync(release.musl, join(ctx, 'gbrain-musl')); }
  const compiled = [...(release ? [] : [[stub, 'bun-linux-x64', 'gbrain'], [stub, 'bun-linux-x64-musl', 'gbrain-musl']]), [join(ctx, 'shared', 'gbrain-stub-shared.ts'), 'bun-linux-x64-musl', 'shared/gbrain']];
  for (const [src, target, outfile] of compiled) {
    const r = spawnSync('bun', ['build', '--compile', '--target=' + target, src, '--outfile', join(ctx, outfile)], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('bun build --compile ' + outfile + ' failed: ' + r.stderr.slice(-800));
  }
  for (const [target, tag] of TARGETS) dockerBuild(['-f', join(HERE, 'Dockerfile.arms'), '--target', target, '-t', tag, ctx]);
  const staleSkill = catalogNames.find((n) => n !== 'careful')!;
  if (!release) dockerBuild(['-t', IMAGES.catalogBudget, '-'], 'FROM ' + IMAGES.catalog + '\nUSER root\nRUN touch /opt/skill-resolver/gbrain-home/stub-budget-exhausted\nUSER node\n');
  dockerBuild(['-t', IMAGES.catalogStale, '-'], 'FROM ' + IMAGES.catalog + '\nUSER root\nRUN printf "\\n" >> /opt/catalog-layer/skills/' + staleSkill + '/SKILL.md\nUSER node\n');
  dockerBuild(['-t', IMAGES.catalogShared, '-f', '-', join(ctx, 'shared')], 'FROM ' + IMAGES.catalog + '\nCOPY --chmod=0755 gbrain /usr/local/bin/gbrain\n');
  rmSync(ctx, { recursive: true, force: true });
}

/** prepare.sh as the runner calls it, for one config and image pair; only the variable names and non-secret values kept. */
function prepare(config: string, core: string, sandbox: string | null, dir: string) {
  mkdirSync(dir, { recursive: true });
  const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', HE_HARNESS_CONFIG: config, QM_IMAGE: core, ...(sandbox ? { QM_SANDBOX_IMAGE: sandbox } : {}) };
  const r = spawnSync('bash', [join(ROOT, 'harnesses', 'qm', 'prepare.sh'), dir], { encoding: 'utf8', env });
  const vars: Record<string, string> = {};
  for (const line of r.stdout.split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(line); if (m) vars[m[1]!] = /SECRET/.test(m[1]!) ? '<per-trial random, not kept>' : m[2]!; }
  return { status: r.status, stderr: r.stderr.trim().slice(0, 600), vars };
}

const readLines = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : []);
const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>; } catch { return null; } };
const leftovers = () => spawnSync('docker', ['ps', '-a', '--filter', 'label=qm.sandbox=1', '--filter', 'label=qm.org=harness-eval', '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

/** The shared shadow replay check through QM's wrapper on one image. */
function replay(image: string, extra: string[] = []) {
  const r = spawnSync('bash', [join(ROOT, 'harnesses', 'qm', 'shadow-replay.sh'), ...extra], { encoding: 'utf8', timeout: 600_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', QM_IMAGE: image } });
  return { image, args: extra, status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim().slice(-400) };
}

/** Every status line carries the hook wrapper's field names and the receipt's hashes. */
function statusShape(s: Record<string, unknown> | undefined, call: string, receipt: Receipt) {
  return !!s && s.call === call && STATUS_FIELDS.every((k) => k in s) && !('reason' in s) && s.index_hash === receipt.index_hash && s.gbrain_version === receipt.gbrain_version && s.catalog_hash === receipt.catalog_hash && typeof s.infra === 'boolean';
}

async function main(): Promise<number> {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const catalog = resolve(arg('--catalog') ?? join(homedir(), '.capy/work/internal-task/catalog'));
  const out = resolve(arg('--out') ?? join(homedir(), '.capy/work/internal-task/arms'));
  const providers = (arg('--providers') ?? 'anthropic,openai').split(',') as Provider[];
  const arms = (arg('--arms') ?? ARMS.join(',')).split(',') as Arm[];
  const catalogNames = readdirSync(join(catalog, 'skills')).sort();
  const glibc = arg('--gbrain'), musl = arg('--gbrain-musl');
  if (!glibc !== !musl) { console.error('qm-arms-check: --gbrain and --gbrain-musl go together'); return 2; }
  const release = glibc && musl ? { glibc: resolve(glibc), musl: resolve(musl) } : null;
  mkdirSync(out, { recursive: true });
  if (!process.argv.includes('--skip-build')) build(catalog, out, catalogNames, release);
  const images = Object.fromEntries(Object.entries(IMAGES).filter(([k]) => !(release && k === 'catalogBudget')).map(([k, tag]) => [k, { tag, ...imageInfo(tag) }]));
  const RECEIPT = receiptOf(IMAGES.catalog);
  const sandboxReceipt = receiptOf(IMAGES.sandboxPull), pullReceipt = receiptOf(IMAGES.pull);
  const onRelease = release !== null || !String(RECEIPT.gbrain_version ?? '').includes('he-stub');
  const notInvocable = RECEIPT.skipped.filter((s) => s.reason === 'not_model_invocable').length;
  const indexMatches = { pass: RECEIPT.skill_count + notInvocable === catalogNames.length && RECEIPT.skipped.length === notInvocable && [sandboxReceipt, pullReceipt].every((x) => x.catalog_hash === RECEIPT.catalog_hash && x.index_hash === RECEIPT.index_hash && x.gbrain_version === RECEIPT.gbrain_version), core: RECEIPT, sandbox: sandboxReceipt, pull: pullReceipt };
  console.log('index_matches=' + indexMatches.pass + ' catalog_hash=' + RECEIPT.catalog_hash + ' index_hash=' + RECEIPT.index_hash + ' gbrain=' + RECEIPT.gbrain_version);

  const refusal = prepare('pi-skills-push', IMAGES.none, null, join(out, 'prepare-refusal'));
  const prepareRefuses = { pass: refusal.status === 2 && /harness-eval\.skill-arm no-catalog, but HE_HARNESS_CONFIG=pi-skills-push needs catalog/.test(refusal.stderr), status: refusal.status, stderr: refusal.stderr };
  console.log('prepare_refuses_wrong_image=' + prepareRefuses.pass);
  const replays = { shadow: replay(IMAGES.catalog), budget: replay(IMAGES.catalog, ['--until-exhausted']), mismatch: replay(IMAGES.catalogShared) };
  const shadowReplay = {
    pass: replays.shadow.status === 0 && replays.shadow.stdout.startsWith('SHADOW_REPLAY_OK ') && replays.budget.status === 0 && replays.budget.stdout.startsWith('BUDGET_REPLAY_OK ')
      && replays.mismatch.status === 1 && /^SHADOW_REPLAY_FAIL .*the shadow block differs from the on block/.test(replays.mismatch.stdout),
    ...replays,
  };
  for (const [k, v] of Object.entries(replays)) console.log('shadow_replay.' + k + ' exit=' + v.status + ' ' + v.stdout.slice(0, 300));

  type Cell = { id: string; provider: Provider; arm: Arm; kind: 'arm' | 'infra' | 'budget'; core: string };
  const cellsToRun: Cell[] = [];
  for (const provider of providers) for (const arm of arms) cellsToRun.push({ id: 'qm-arm-' + provider + '-' + arm, provider, arm, kind: 'arm', core: CORE_IMAGE[arm] });
  if (!process.argv.includes('--no-infra') && providers.includes('anthropic') && arms.includes('native')) cellsToRun.push({ id: 'qm-arm-anthropic-native-infra', provider: 'anthropic', arm: 'native', kind: 'infra', core: IMAGES.catalogStale });
  if (!onRelease && !process.argv.includes('--no-infra') && providers.includes('anthropic') && arms.includes('push')) cellsToRun.push({ id: 'qm-arm-anthropic-push-budget', provider: 'anthropic', arm: 'push', kind: 'budget', core: IMAGES.catalogBudget });

  let fakeA: FakeAnthropic | null = null, fakeR: FakeResponses | null = null;
  const front = (get: () => string | null) => Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const base = get();
    if (!base) return new Response('no fake model bound', { status: 503 });
    const u = new URL(req.url);
    return fetch(base + u.pathname + u.search, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : await req.arrayBuffer() });
  } });
  const frontA = front(() => fakeA ? fakeA.url : null), frontR = front(() => fakeR ? 'http://127.0.0.1:' + fakeR.port : null);
  const proxy = await RunProxy.start({ runId: 'anatomy-capture-harn52-qm-arms', runDir: out, ledgerPath: join(out, 'ledger.sqlite'), leaseUsd: 20, allowModels: providers.flatMap((p) => [MODELS[p].model, MODELS[p].housekeeping]), maxOutputTokens: 128_000, reachableFromContainers: false, newRun: true, capture: { upstream: { anthropic: 'http://127.0.0.1:' + frontA.port, openai: 'http://127.0.0.1:' + frontR.port }, dns: null } });
  const results: Record<string, unknown>[] = [];
  const before = new Set(leftovers());
  try {
    for (const c of cellsToRun) {
      const dir = join(out, c.id);
      rmSync(dir, { recursive: true, force: true });
      const logs = join(dir, 'logs'), work = join(dir, 'workspace'), state = join(dir, 'harness-state');
      for (const d of [logs, work, state]) mkdirSync(d, { recursive: true });
      writeFileSync(join(work, 'instruction.md'), TURN_TEXT);
      const log = join(dir, 'fake.ndjson');
      writeFileSync(log, '');
      const pullSession = 'dm:' + MEMBER + ':' + c.id;
      const read = { call: 'skills', arguments: { action: 'read', name: 'careful' } };
      const script = c.arm === 'pull' ? [{ call: 'execute', arguments: { command: pullCommand(TURN_TEXT, pullSession), purpose: 'Find catalog skills that fit the request' } }, read] : [read];
      fakeA?.stop(); fakeR?.stop(); fakeA = null; fakeR = null;
      if (c.provider === 'anthropic') fakeA = startFakeAnthropic({ host: '127.0.0.1', port: 0, log, requireKeyPrefix: DUMMY_KEY_PREFIX, script });
      else fakeR = startFakeResponses({ host: '127.0.0.1', port: 0, log, requireKeyPrefix: CAPTURE_DUMMY_KEYS.OPENAI_API_KEY, script });
      const cell = MODELS[c.provider];
      const slot = trialSlug(c.id), key = trialKey(c.id), token = trialToken(c.id);
      await proxy.bind(slot, key, token, [cell.model, cell.housekeeping]);
      const coreImage = c.core, sandboxImage = c.arm === 'pull' ? IMAGES.sandboxPull : IMAGES.sandbox;
      const prep = prepare(CONFIG[c.arm], coreImage, c.arm === 'pull' ? null : sandboxImage, join(dir, 'prepare'));
      const detail: Record<string, unknown> = { id: c.id, provider: c.provider, arm: c.arm, kind: c.kind, config: CONFIG[c.arm], model: cell.model, core_image: coreImage, sandbox_image: sandboxImage, prepare: prep, started_at: new Date().toISOString() };
      let error: string | null = null, sandboxSessions: string[] = [], sessionBody: unknown = null;
      try {
        if (prep.status !== 0) throw new Error('prepare.sh refused: ' + prep.stderr);
        const stack = await upStack({ out: join(dir, 'stack'), project: PROJECT, modelBaseUrl: proxy.baseUrlFor(slot, c.provider, false), modelKey: token, modelName: cell.model.split(':')[1], modelProvider: c.provider, coreImage, sandboxImage });
        try {
          const call = qmClient(stack.url, stack.secret);
          const created = await stack.createSandbox(() => call('POST', '/v1/admin/sandboxes/' + SCOPE, { action: 'create', backend: 'local', name: 'harn52-arm' }));
          const selected = await call('POST', '/v1/admin/sandboxes/' + SCOPE, { action: 'default', sandboxId: (created.body as { id?: string } | null)?.id ?? null });
          const machineId = (created.body as { machineId?: string } | null)?.machineId ?? null;
          detail.sandbox = { create_http: created.http, default_http: selected.http, machine_id: machineId };
          const t0 = Date.now();
          // Asynchronous: the fakes answer from this process, so a blocking spawn would starve them.
          const task = Bun.spawn(['docker', 'run', '--rm', '--network', 'host', '--user', process.getuid!() + ':' + process.getgid!(), '--entrypoint', '/opt/harness/adapter.sh',
            '-v', logs + ':/he-logs', '-v', work + ':/workspace', '-v', state + ':/harness-state',
            '-e', 'HE_LOG_DIR=/he-logs', '-e', 'HE_SESSION_STATE_DIR=/harness-state', '-e', 'HE_TRIAL_ID=' + c.id, '-e', 'HE_TIME_BUDGET_S=300', '-e', 'HE_HARNESS_CONFIG=' + CONFIG[c.arm],
            '-e', 'HE_MODEL_BASE_URL=' + proxy.baseUrlFor(slot, c.provider, false), '-e', 'QM_CORE_URL=' + stack.url, '-e', 'QM_SIGNING_SECRET=' + stack.secret,
            coreImage, 'run'], { stdout: 'pipe', stderr: 'pipe', timeout: 420_000 });
          const [taskErr, taskExit] = await Promise.all([new Response(task.stderr).text(), task.exited, new Response(task.stdout).text()]);
          detail.task = { exit: taskExit, ms: Date.now() - t0, stderr_tail: taskErr.split('\n').filter((l) => !l.includes(stack.secret)).slice(-25).join('\n') };
          const turn = readJson(join(logs, 'qm-turn.json')) as { body?: { sessionId?: string; status?: string } } | null;
          detail.turn = { status: turn?.body?.status ?? null, session_id: turn?.body?.sessionId ?? null };
          if (turn?.body?.sessionId) {
            const got = await call('GET', '/v1/admin/sessions/' + turn.body.sessionId + '?scope=' + encodeURIComponent(SCOPE) + '&limit=50000');
            sessionBody = got.body;
            writeFileSync(join(dir, 'session.json'), JSON.stringify(got.body, null, 1) + '\n');
          }
          if (machineId && c.arm === 'pull') {
            const ls = spawnSync('docker', ['exec', machineId, 'sh', '-c', 'find "$HOME/.he-gbrain" -path "*sessions/*" -name "*.json"'], { encoding: 'utf8' });
            sandboxSessions = (ls.stdout ?? '').split('\n').filter(Boolean);
          }
        } finally { stack.down(); }
      } catch (e) { error = String((e as Error)?.message ?? e).slice(0, 2000); }
      const meter = await proxy.finalize(key);
      const lines = proxy.usageLines(key);
      await proxy.unbind(slot);
      detail.usage = summarizeUsage(key, meter, lines).usage;
      detail.error = error;

      const bare = cell.model.split(':')[1]!;
      const reqs = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { body?: Record<string, unknown> });
      const agent = reqs.filter((r) => r.body && String(r.body.model ?? '') === bare && Array.isArray(r.body.tools) && (r.body.tools as unknown[]).length > 0).map((r) => r.body!);
      const house = reqs.filter((r) => r.body && !agent.includes(r.body)).map((r) => r.body!);
      const first = agent[0] ?? null;
      const status = readLines(join(logs, 'skill-resolver', 'status.ndjson'));
      const resolved = readLines(join(logs, 'skill-resolver', 'results.ndjson'));
      const infraMarker = readJson(join(logs, 'skill-resolver', 'infra.json'));
      const listed = readJson(join(logs, 'qm-skills-listed.json')) as { count?: number; by_creator?: Record<string, number>; skills?: Array<{ name: string; createdBy: string }> } | null;
      const blocks = first ? findSkillsBlocks(first) : [];
      const listedInPrompt = blocks[0] ? parseBlock(blocks[0].block).entries.map((e) => e.name) : [];
      const opens = skillOpens({ catalog: catalogNames, requests: agent, ...(sessionBody ? { session: sessionBody } : {}) });
      const fromRequests = skillOpens({ catalog: catalogNames, requests: agent }).opened;
      const fromTrace = sessionBody ? skillOpens({ catalog: catalogNames, session: sessionBody }).opened : [];
      const usage = detail.usage as { usd: number; refused?: number; requests?: number };
      const layerCount = listed?.by_creator?.['system:deployment-layer'] ?? 0;
      const checks: Record<string, Record<string, unknown> & { pass: boolean }> = {};
      checks.prepare_ok = { pass: prep.status === 0 && prep.vars.HE_HARNESS_CONFIG === CONFIG[c.arm] && (c.arm !== 'pull' || prep.vars.QM_SANDBOX_IMAGE === IMAGES.sandboxPull), vars: prep.vars, stderr: prep.stderr };
      const listingSummary = { installed: listed?.count ?? null, by_creator: listed?.by_creator ?? null, listed_in_first_request: listedInPrompt.length, catalog_listed: listedInPrompt.filter((n) => catalogNames.includes(n)).length, other_listed: listedInPrompt.filter((n) => !catalogNames.includes(n)), block_chars: blocks[0] ? blocks[0].end - blocks[0].start : 0, block_path: blocks[0]?.path ?? null };
      if (c.arm === 'none') checks.listing_recorded = { pass: listed !== null && layerCount === 0 && listedInPrompt.every((n) => !catalogNames.includes(n)), ...listingSummary, remaining_installed: listed?.skills?.map((s) => s.name + ' (' + s.createdBy + ')') ?? null };
      else checks.listing = { pass: layerCount === catalogNames.length && listedInPrompt.filter((n) => catalogNames.includes(n)).length > 0, ...listingSummary };
      const r0 = resolved[0] as { input?: { message?: string; previous_user_message?: string; session_id?: string }; fields?: { block?: string } } | undefined;
      const block = r0?.fields?.block ?? '';
      if (c.arm === 'native' || c.arm === 'push') {
        const shadow = c.arm === 'native';
        const s = status[0];
        const argvWant = argvFor(c.id, RECEIPT, shadow, (s?.argv as string[] | undefined) ?? []);
        checks[shadow ? 'shadow_called' : 'push_called'] = { pass: status.length === 1 && resolved.length === 1 && JSON.stringify(s?.argv) === JSON.stringify(argvWant) && s!.autorebuild_off === true && r0?.input?.message === TURN_TEXT && r0.input.previous_user_message === undefined && r0.input.session_id === c.id, calls: status.length, argv: s?.argv ?? null, argv_expected: argvWant, input: r0?.input ?? null };
        const u = first ? userTurns(first) : { first: null, userPaths: [] };
        const wrap = (t: string | null, inner: string) => (t === null || !t.includes(inner) ? null : { before: t.slice(0, t.indexOf(inner)), after: t.slice(t.indexOf(inner) + inner.length) });
        if (c.kind === 'budget') {
          const anywhere = reqs.flatMap((r, i) => (r.body ? locate(r.body, BLOCK_HEADER).map((l) => ({ request: i, ...l })) : []));
          checks.budget_empty_block = { pass: block === '' && anywhere.length === 0 && !!u.first?.includes(TURN_TEXT), block_chars: block.length, block_header_found: anywhere, user_turn_wrapping: wrap(u.first, TURN_TEXT) };
          checks.status_line_budget = { pass: status.length === 1 && statusShape(s, 'push', RECEIPT) && s!.code === 'BUDGET_EXHAUSTED' && s!.budget_exhausted === true && s!.budget_phase === 'exhausted' && s!.block_reason === 'budget_exhausted' && s!.no_skill === false && s!.no_skill_reason === null && s!.injected === false && s!.block_sha256 === null && s!.infra === false, line: s ?? null };
          checks.not_infra = { pass: infraMarker === null, marker: infraMarker };
        } else {
          const locsAgent = agent.flatMap((b, i) => locate(b, block).map((l) => ({ request: i, ...l })));
          const locsHouse = house.flatMap((b, i) => locate(b, block).map((l) => ({ request: i, model: String(b.model ?? ''), ...l })));
          if (shadow) checks.injected_nothing = { pass: block.length > 0 && locsAgent.length === 0 && locsHouse.length === 0 && !!u.first?.includes(TURN_TEXT), block_sha256: sha256(block), block_chars: block.length, found_in_agent_requests: locsAgent, found_in_housekeeping_requests: locsHouse, user_turn_holds_instruction: !!u.first?.includes(TURN_TEXT), user_turn_wrapping: wrap(u.first, TURN_TEXT) };
          else {
            const pushed = block + '\n\n' + TURN_TEXT;
            const userOnly = locsAgent.length > 0 && locsAgent.every((l) => agent[l.request] && userTurns(agent[l.request]!).userPaths.some((p) => l.path.startsWith(p)));
            const followed = agent.every((b) => locate(b, block).length === locate(b, pushed).length);
            checks.block_in_user_turn_only = { pass: block.length > 0 && userOnly && followed && !!u.first?.includes(pushed) && agent.every((b) => locate(b, block).length === 1), block_sha256: sha256(block), block_chars: block.length, user_turn_holds_block_blank_line_instruction: !!u.first?.includes(pushed), user_turn_wrapping: wrap(u.first, pushed), found_in_agent_requests: locsAgent, found_in_housekeeping_requests: locsHouse, agent_requests: agent.length };
          }
          const infra = c.kind === 'infra';
          checks[infra ? 'status_line_infra' : 'status_line'] = { pass: status.length === 1 && statusShape(s, shadow ? 'shadow' : 'push', RECEIPT) && s!.block_sha256 === sha256(block) && s!.injected === !shadow && s!.code === 'OK' && s!.budget_exhausted === false && s!.budget_phase === 'under_half' && s!.k === 5 && s!.block_reason === 'match' && s!.no_skill === false && s!.no_skill_reason === null && s!.session_block_tokens === s!.block_tokens && s!.infra === infra && JSON.stringify(s!.infra_reasons) === JSON.stringify(infra ? ['INDEX_STALE'] : []) && s!.index_stale === infra, line: s ?? null, lines: status.length };
          if (infra) checks.infra_marker = { pass: infraMarker?.infra === true && JSON.stringify(infraMarker.reasons) === JSON.stringify(['INDEX_STALE']), marker: infraMarker };
        }
      }
      if (c.arm === 'pull') {
        const exec = sessionBody ? (sessionToolCalls(sessionBody) as Array<{ tool: string; args: { command?: string }; resultText: string | null }>).filter((x) => x.tool === 'execute' && /resolve-skills/.test(String(x.args.command ?? ''))) : [];
        const stdout = exec[0]?.resultText != null ? (splitExecuteResult(exec[0].resultText) as { stdout: string }).stdout : '';
        const answer = parseResolverStdout(stdout) as Record<string, unknown> | null;
        checks.no_adapter_call = { pass: status.every((s) => s.call === 'pull') && resolved.every((x) => x.call === 'pull'), calls: status.map((s) => s.call) };
        checks.model_call_reached = { pass: exec.length === 1 && answer?.schema_version === 1 && (onRelease || (answer.harness === 'qm' && answer.session_id === pullSession)) && answer.catalog_hash === RECEIPT.catalog_hash && answer.index_hash === RECEIPT.index_hash && typeof answer.block === 'string' && (answer.block as string).length > 0 && sandboxSessions.length === 1, calls: exec.length, answer_fields: answer ? { harness: answer.harness, session_id: answer.session_id, catalog_hash: answer.catalog_hash, index_hash: answer.index_hash, block_reason: answer.block_reason } : null, sandbox_session_files: sandboxSessions };
        const s = status[0];
        checks.status_line = { pass: status.length === 1 && statusShape(s, 'pull', RECEIPT) && s!.stdout_sha256 === sha256(stdout) && s!.block_sha256 === (answer?.block ? sha256(answer.block as string) : null) && s!.code === 'OK' && s!.exit === 0 && s!.budget_exhausted === false && s!.budget_phase === 'under_half' && s!.k === 5 && s!.block_reason === 'match' && s!.no_skill_reason === null && s!.infra === false, line: s ?? null, lines: status.length };
      }
      if (c.arm === 'none') {
        checks.no_resolver = { pass: status.length === 0 && resolved.length === 0, status_lines: status.length };
        checks.skill_absent = { pass: opens.opened.length === 0 && opens.refused.some((o) => o.skill === 'careful'), refused: opens.refused, opened: opens.opened };
      } else if (c.kind === 'arm') checks.got_skill = { pass: JSON.stringify(opens.opened) === '["careful"]' && JSON.stringify(fromRequests) === '["careful"]' && JSON.stringify(fromTrace) === '["careful"]', opened: opens.opened, from_requests: fromRequests, from_trace: fromTrace, opens: opens.opens };
      checks.no_refusal = { pass: (usage.refused ?? 0) === 0 && !error && detail.turn !== undefined && (detail.task as { exit?: number } | undefined)?.exit === 0, refused: usage.refused ?? null, task_exit: (detail.task as { exit?: number } | undefined)?.exit ?? null, error };
      const check = { cell: c.id, provider: c.provider, arm: c.arm, kind: c.kind, ...checks, requests: { total: reqs.length, agent: agent.length, housekeeping: house.length, models: reqs.map((r) => String(r.body?.model ?? '')) }, usd: usage.usd };
      writeFileSync(join(dir, 'capture.json'), JSON.stringify(detail, null, 1) + '\n');
      writeFileSync(join(dir, 'check.json'), JSON.stringify(check, null, 1) + '\n');
      console.log(c.id + ': ' + Object.entries(checks).map(([k, v]) => k + '=' + v.pass).join(' ') + ' usd=' + usage.usd + (error ? ' ERROR ' + error.slice(0, 300) : ''));
      results.push(check);
    }
  } finally {
    await proxy.stop();
    fakeA?.stop(); fakeR?.stop(); frontA.stop(true); frontR.stop(true);
  }
  const left = leftovers().filter((n) => !before.has(n));
  for (const n of left) { spawnSync('docker', ['rm', '-f', n], { stdio: 'ignore' }); spawnSync('docker', ['volume', 'rm', '-f', 'qm-home-' + n.replace(/^qm-sbx-/, '')], { stdio: 'ignore' }); spawnSync('docker', ['network', 'rm', 'qm-net-' + n.replace(/^qm-sbx-/, '')], { stdio: 'ignore' }); }
  const passOf = (c: Record<string, unknown>) => Object.entries(c).filter(([, v]) => v && typeof v === 'object' && 'pass' in (v as object)).map(([k, v]) => [k, (v as { pass: boolean }).pass] as const);
  const all = prepareRefuses.pass && indexMatches.pass && shadowReplay.pass && results.every((c) => passOf(c).every(([, p]) => p));
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ qm: 'main@90e4ced7', resolver: release ? { release: true, glibc: release.glibc, musl: release.musl, sha256: { glibc: sha256File(release.glibc), musl: sha256File(release.musl) } } : { release: false, stand_in: 'scripts/skill-resolver/gbrain-stub.ts' }, labels: { native: 'native (resolver in shadow)', push: 'emulated hook', pull: 'pull via sandbox tool (QM refuses private-address MCP)', none: 'no-catalog' }, receipt: RECEIPT, images, index_matches: indexMatches, prepare_refuses_wrong_image: prepareRefuses, shadow_replay: shadowReplay, all_pass: all, sandboxes_left_and_removed: left, usd_total: results.reduce((a, c) => a + Number(c.usd ?? 0), 0), cells: results.map((c) => ({ cell: c.cell, ...Object.fromEntries(passOf(c)), usd: c.usd })) }, null, 1) + '\n');
  console.log('all_pass=' + all + ' summary=' + join(out, 'summary.json'));
  return all ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
