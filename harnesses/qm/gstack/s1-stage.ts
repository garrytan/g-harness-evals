#!/usr/bin/env bun
// S1 probe staging for gstack on QM (internal-task plan v3, M1 step 6, Garry's d3b),
// keyless. It
//   1. stages the raw gstack SKILL.md files the paste-in router names, at one
//      pinned gstack commit, into a QM sandbox image (Dockerfile.skills) at
//      /root/workspace/gstack/<skill>/SKILL.md, inside the workspace QM's
//      files tool can read;
//   2. generates the router with the installed gstack's
//      gstack-harness register generic --print and points every path at the
//      staged copies;
//   3. starts the rig's QM core at b6786d67 on that sandbox image, puts the
//      router in the org SOUL (PUT /v1/admin/scopes/org:harness-eval/soul,
//      which QM prepends to every turn's system prompt as
//      "## Organization instructions"), gives the member's personal scope a
//      default sandbox, and runs one DM turn against the fake Anthropic
//      endpoint, scripted to read one staged SKILL.md that fits QM's inline
//      tool-result budget and one that does not;
//   4. writes a receipt with the evidence: the router in the system prompt, the
//      tool results the model got back compared byte for byte with the staged
//      files, and the stored turn.
// No paid call: the fake refuses any key without the dummy prefix.
//
//   env -i PATH=$PATH HOME=$HOME bun harnesses/qm/gstack/s1-stage.ts \
//     [--gstack ~/.local/share/gstack] [--ref <sha>] [--skill careful] [--over-cap-skill investigate]
//     [--work ~/.capy/work/qm-gstack-s1] [--out <work>/s1-staging-b6786d67.json]
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DUMMY_KEY_PREFIX, ORG_SCOPE, ROOT, imageInfo, lockHost, qmClient, upStack } from './qm-stack.ts';
import { startFakeAnthropic, type Turn } from '../../../scripts/gsta-135/fake-anthropic.ts';

export const SANDBOX_ROOT = '/root/workspace/gstack';
/** QM parks a tool result over tool_result_inline_tokens (default 4096) x 4 chars and shows head and tail (src/sessions/tool-output.ts:10-11, cutToolOutput). */
export const QM_INLINE_CHARS = 4096 * 4;
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/** The paths a router or context block tells the agent to read. */
export function routerPaths(router: string): string[] {
  return [...new Set([...router.matchAll(/(?:Read|read) \x60([^\x60]+\/SKILL\.md)\x60/g)].map(m => m[1]!))];
}

/** The router with every checkout path pointed at the sandbox copy. */
export function pointRouter(router: string, checkout: string, sandboxRoot = SANDBOX_ROOT): string {
  return router.split(checkout.replace(/\/+$/, '') + '/').join(sandboxRoot + '/');
}

export interface Staged { name: string; sandbox_path: string; source: string; bytes: number; chars: number; sha256: string; fits_inline: boolean }

/** Copies each path's content at ref (through symlinks the checkout's setup created) into context/gstack/, refusing when the working tree differs from ref. */
export function stage(checkout: string, ref: string, paths: string[], context: string): Staged[] {
  rmSync(context, { recursive: true, force: true });
  return paths.map(p => {
    const rel = relative(checkout, p);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('fixture: ' + p + ' lies outside the gstack checkout ' + checkout);
    const realRel = relative(realpathSync(checkout), realpathSync(p));
    const shown = spawnSync('git', ['-C', checkout, 'show', ref + ':' + realRel], { maxBuffer: 64 * 1024 * 1024 });
    if (shown.status !== 0) throw new Error('fixture: ' + realRel + ' is not in gstack at ' + ref);
    const blob = shown.stdout as Buffer;
    if (!blob.equals(readFileSync(p))) throw new Error('fixture: ' + rel + ' in the checkout differs from ' + ref + '; check out ' + ref + ' first');
    const dest = join(context, 'gstack', rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, blob);
    const chars = blob.toString('utf8').length;
    return { name: rel === 'SKILL.md' ? '(root)' : rel.split('/')[0]!, sandbox_path: SANDBOX_ROOT + '/' + rel, source: ref.slice(0, 12) + ':' + realRel, bytes: blob.length, chars, sha256: sha256(blob), fits_inline: chars <= QM_INLINE_CHARS };
  });
}

type Block = { type: string; id?: string; tool_use_id?: string; name?: string; input?: Record<string, unknown>; content?: unknown; text?: string };
const blocks = (m: { content?: unknown }): Block[] => (Array.isArray(m.content) ? m.content as Block[] : []);
const resultText = (b: Block): string => typeof b.content === 'string' ? b.content
  : Array.isArray(b.content) ? (b.content as Block[]).filter(c => c.type === 'text').map(c => c.text ?? '').join('\n') : '';

/** Every tool_use the model sent with the tool_result QM returned for it, from the last request's messages. */
export function toolExchanges(messages: Array<{ role?: string; content?: unknown }>): Array<{ name: string; input: Record<string, unknown>; result: string | null }> {
  const results = new Map<string, string>();
  for (const m of messages) for (const b of blocks(m)) if (b.type === 'tool_result' && b.tool_use_id) results.set(b.tool_use_id, resultText(b));
  const out: Array<{ name: string; input: Record<string, unknown>; result: string | null }> = [];
  for (const m of messages) for (const b of blocks(m)) if (b.type === 'tool_use') out.push({ name: b.name ?? '', input: b.input ?? {}, result: b.id ? results.get(b.id) ?? null : null });
  return out;
}

/** How the delivered text compares with the staged file. */
export function compareRead(delivered: string | null, staged: string) {
  if (delivered === null) return { delivered: false } as const;
  const cut = delivered.match(/…\[output cut: showing the first (\d+) and last (\d+) of (\d+) chars\./);
  return {
    delivered: true, delivered_chars: delivered.length, staged_chars: staged.length,
    identical: delivered === staged, delivered_sha256: sha256(delivered), staged_sha256: sha256(staged),
    ...(cut ? { cut: { head: Number(cut[1]), tail: Number(cut[2]), of: Number(cut[3]) }, head_matches: staged.startsWith(delivered.slice(0, Number(cut[1]))) } : {}),
  };
}

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }

async function main(): Promise<number> {
  const checkout = realpathSync(resolve(arg('--gstack') ?? join(homedir(), '.local', 'share', 'gstack')));
  const ref = spawnSync('git', ['-C', checkout, 'rev-parse', '--verify', '--quiet', (arg('--ref') ?? 'HEAD') + '^{commit}'], { encoding: 'utf8' }).stdout.trim();
  if (!ref) { console.error('s1: ' + (arg('--ref') ?? 'HEAD') + ' is not a commit in ' + checkout); return 2; }
  const skill = arg('--skill') ?? 'careful';
  const overCap = arg('--over-cap-skill') ?? 'investigate';
  const work = resolve(arg('--work') ?? join(homedir(), '.capy', 'work', 'qm-gstack-s1'));
  const out = resolve(arg('--out') ?? join(work, 's1-staging-b6786d67.json'));
  const routerName = 's1-router-' + ref.slice(0, 8) + '.md';
  const head = spawnSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  if (head !== spawnSync('git', ['-C', checkout, 'rev-parse', ref + '^{commit}'], { encoding: 'utf8' }).stdout.trim()) { console.error('s1: the router is generated from the checkout, which is at ' + head + ', not ' + ref + '; check out ' + ref + ' first'); return 2; }
  mkdirSync(work, { recursive: true });
  const unlockWork = lockHost(['work-' + createHash('sha256').update(work).digest('hex').slice(0, 12)]);
  process.on('exit', unlockWork);

  const printed = spawnSync('bun', [join(checkout, 'bin', 'gstack-harness'), 'register', 'generic', '--print'], { encoding: 'utf8', cwd: checkout, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
  if (printed.status !== 0) { console.error('s1: gstack-harness register generic --print failed: ' + printed.stderr); return 1; }
  const raw = printed.stdout;
  const router = pointRouter(raw, checkout);
  const staged = stage(checkout, ref, routerPaths(raw), join(work, 'context'));
  const missing = routerPaths(router).filter(p => !staged.some(s => s.sandbox_path === p));
  if (missing.length) { console.error('s1: fixture: router names unstaged paths: ' + missing.join(', ')); return 1; }
  writeFileSync(join(work, routerName), router);
  const pick = (n: string) => { const s = staged.find(x => x.name === n); if (!s) throw new Error('s1: ' + n + ' is not in the router'); return s; };
  const target = pick(skill), big = pick(overCap);
  if (!target.fits_inline) { console.error('s1: ' + skill + ' is ' + target.chars + ' chars, over QM inline budget ' + QM_INLINE_CHARS + '; pick a smaller skill'); return 2; }

  const version = spawnSync('git', ['-C', checkout, 'show', ref + ':VERSION'], { encoding: 'utf8' }).stdout.trim();
  const image = 'harness-eval/qm-sandbox:gstack-' + ref.slice(0, 8);
  const build = spawnSync('docker', ['build', '-f', join(ROOT, 'harnesses', 'qm', 'gstack', 'Dockerfile.skills'), '--build-arg', 'GSTACK_COMMIT=' + ref, '--build-arg', 'GSTACK_VERSION=' + version, '-t', image, join(work, 'context')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(work, 'build-skills.log'), build.stdout + build.stderr);
  if (build.status !== 0) { console.error('s1: sandbox image build failed (' + join(work, 'build-skills.log') + ')'); return 1; }
  const inImage = spawnSync('docker', ['run', '--rm', '--entrypoint', 'sh', image, '-c', 'cd ' + SANDBOX_ROOT + ' && find . -name SKILL.md | wc -l && sha256sum ' + target.sandbox_path], { encoding: 'utf8' }).stdout.trim().split('\n');

  const script: Turn[] = [
    { call: 'files', arguments: { action: 'read', path: target.sandbox_path }, match: { system_contains: '- **' + skill + '**: ' } },
    { call: 'files', arguments: { action: 'read', path: big.sandbox_path } },
    { text: 'done' },
  ];
  const fakeLog = join(work, 'fake-requests.ndjson');
  writeFileSync(fakeLog, '');
  const fake = startFakeAnthropic({ host: '127.0.0.1', port: 0, log: fakeLog, requireKeyPrefix: DUMMY_KEY_PREFIX, script });
  const stack = await upStack({ out: join(work, 'stack'), project: 'qm-gstack-s1', modelBaseUrl: fake.url, modelKey: DUMMY_KEY_PREFIX + '-s1', sandboxImage: image });
  const call = qmClient(stack.url, stack.secret);
  const member = 'U1', scope = 'personal:' + member;
  let soulPut, soulGet, sbxCreate, sbxDefault, turn, sessions, llm, session;
  try {
    soulPut = await call('PUT', '/v1/admin/scopes/' + ORG_SCOPE + '/soul', { content: router });
    soulGet = await call('GET', '/v1/admin/scopes/' + ORG_SCOPE);
    sbxCreate = await stack.createSandbox(() => call('POST', '/v1/admin/sandboxes/' + scope, { action: 'create', backend: 'local', name: 'gstack-probe' }));
    const sandboxId = (sbxCreate.body as { id?: string } | null)?.id ?? null;
    sbxDefault = await call('POST', '/v1/admin/sandboxes/' + scope, { action: 'default', sandboxId });
    turn = await call('POST', '/v1/turns', { surface: 'harness-eval', actor: { externalId: member, displayName: 'Dana Okafor' }, conversation: { kind: 'dm', threadRef: 'dm:' + member }, text: 'Something in my branch broke the login test. Can you figure out why?' }, { admin: false });
    const sessionId = (turn.body as { sessionId?: string })?.sessionId;
    sessions = await call('GET', '/v1/admin/sessions?scope=' + encodeURIComponent(scope));
    const q = '?scope=' + encodeURIComponent(scope);
    if (sessionId) { session = await call('GET', '/v1/admin/sessions/' + sessionId + q); llm = await call('GET', '/v1/admin/sessions/' + sessionId + '/llm' + q); }
  } finally {
    stack.down();
    fake.stop();
  }
  writeFileSync(join(work, 'stored-session.json'), JSON.stringify({ sessions, session, llm }, null, 2));

  const agentRequests = fake.requests.filter(r => r.body && Array.isArray((r.body as { tools?: unknown[] }).tools) && (r.body as { tools: unknown[] }).tools.length);
  const system = (r: typeof fake.requests[number]) => { const s = (r.body as { system?: unknown }).system; return typeof s === 'string' ? s : Array.isArray(s) ? s.map(b => (b as Block).text ?? '').join('\n') : ''; };
  const first = agentRequests[0];
  const last = agentRequests.at(-1);
  const exchanges = last ? toolExchanges((last.body as { messages: Array<{ content?: unknown }> }).messages) : [];
  const stagedText = (s: Staged) => readFileSync(join(work, 'context', 'gstack', s.sandbox_path.slice(SANDBOX_ROOT.length + 1)), 'utf8');
  const readOf = (s: Staged) => exchanges.find(e => e.name === 'files' && e.input.path === s.sandbox_path);
  type Entry = { seq: number; type: string; payload?: { path?: string; action?: string; bytes?: number; found?: boolean; result?: string; output?: { chars: number; shownChars: number; blob: string } } };
  const entries = ((session?.body as { entries?: Entry[] } | undefined)?.entries ?? []).filter(e => e.type === 'tool_result' && e.payload?.path?.startsWith(SANDBOX_ROOT + '/'));
  const stored = (s: Staged) => entries.filter(e => e.payload!.path === s.sandbox_path).map(e => ({
    seq: e.seq, type: e.type, action: e.payload!.action, bytes: e.payload!.bytes, found: e.payload!.found,
    ...(typeof e.payload!.result === 'string' ? { result_chars: e.payload!.result.length, result_identical_to_staged: e.payload!.result === stagedText(s) } : {}),
    ...(e.payload!.output ? { output: e.payload!.output, blob_is_staged_sha256: e.payload!.output.blob === s.sha256 } : {}),
  }));
  const targetText = stagedText(target);
  const evidence = {
    router_in_system_prompt: first ? system(first).includes('## Organization instructions') && system(first).includes('- **' + skill + '**: ') && system(first).includes(target.sandbox_path) : false,
    complete_read: { skill, path: target.sandbox_path, tool_input: readOf(target)?.input ?? null, ...compareRead(readOf(target)?.result ?? null, targetText),
      stored_tool_result: stored(target) },
    over_cap_read: { skill: overCap, path: big.sandbox_path, tool_input: readOf(big)?.input ?? null, ...compareRead(readOf(big)?.result ?? null, stagedText(big)), stored_tool_result: stored(big) },
    played: fake.requests.filter(r => r.played).map(r => ({ played: r.played, at: r.at })),
  };
  const ok = evidence.router_in_system_prompt && evidence.complete_read.delivered && 'identical' in evidence.complete_read && evidence.complete_read.identical;
  const routerOut = join(dirname(out), routerName);
  const receipt = {
    what: 'S1 probe staging for gstack on QM (internal-task-a, internal-task-b plan v3 M1 step 6, d3b), keyless: raw gstack skill texts staged in the QM sandbox, the paste-in router in the org SOUL, one scripted turn reading staged SKILL.md files. The model endpoint was scripts/gsta-135/fake-anthropic.ts, which refuses any key not starting with ' + DUMMY_KEY_PREFIX + '.',
    command: 'env -i PATH=$PATH HOME=$HOME bun harnesses/qm/gstack/s1-stage.ts' + process.argv.slice(2).map(a => ' ' + a).join(''),
    date: new Date().toISOString(),
    qm: { commit: imageInfo(stack.coreImage).qm_commit, inline_tool_result_chars: QM_INLINE_CHARS, inline_source: 'src/sessions/tool-output.ts:10-11 (DEFAULT_INLINE_TOKENS 4096, CHARS_PER_TOKEN 4), cutToolOutput' },
    gstack: { ref, version, router_command: 'bun ' + join('<gstack>', 'bin', 'gstack-harness') + ' register generic --print', router_raw_sha256: sha256(raw), router_file: relative(ROOT, routerOut), router_sha256: sha256(router), router_chars: router.length, router_skills: staged.filter(s => s.name !== '(root)').length },
    staging: {
      image: { name: image, ...imageInfo(image), base: 'harness-eval/qm-sandbox:dev', base_id: imageInfo('harness-eval/qm-sandbox:dev').id, dockerfile: 'harnesses/qm/gstack/Dockerfile.skills' },
      in_image_check: inImage,
      files: staged.length, fit_inline: staged.filter(s => s.fits_inline).length, over_inline: staged.filter(s => !s.fits_inline).length,
      manifest: staged,
    },
    route: { soul_put: soulPut, soul_get_http: soulGet?.http, soul_get_matches: JSON.stringify(soulGet?.body ?? '').includes(JSON.stringify(router).slice(1, -1)) },
    sandbox: { create: sbxCreate, set_default: sbxDefault },
    turn,
    stored: { sessions_http: sessions?.http, session_http: session?.http, llm_http: llm?.http },
    evidence,
    fake_model_requests: fake.requests.length,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(routerOut, router);
  writeFileSync(out, JSON.stringify(receipt, null, 2) + '\n');
  console.log('s1: router_in_system_prompt=' + evidence.router_in_system_prompt + ' complete_read.identical=' + ('identical' in evidence.complete_read ? evidence.complete_read.identical : false) + ' over_cap cut=' + JSON.stringify((evidence.over_cap_read as { cut?: unknown }).cut ?? null));
  console.log('s1: receipt ' + out);
  return ok ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
