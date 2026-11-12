#!/usr/bin/env bun
// internal-task QM pull arm, keyless check ($0, fakes only): "pull via sandbox tool (QM refuses private-address MCP)".
//
//   env -i PATH=$PATH HOME=$HOME bun scripts/skill-resolver/step0/qm/pull/qm-pull-check.ts
//       [--catalog ~/.capy/work/internal-task/catalog] [--out ~/.capy/work/internal-task/pull] [--providers anthropic,openai] [--skip-build]
//       [--gbrain <pinned gbrain binary>]
//
// --gbrain runs the same cells against the pinned release instead of the stand-in: the sandbox image is Dockerfile.pull's
// sandbox-release target (the binary behind gbrain-record.cjs, which logs each call in the stand-in's shape, the index built
// by the release in the image, the tool's catalog pin read from its receipt), and the error cells use sandbox-release-missing
// (index.bin removed) with the ok cells' message, since the release has no magic input. Result fields are read through
// scripts/skill-resolver/result-fields.ts, so check 4 accepts the release's skill_index_missing as INDEX_MISSING.
//
// Builds the two images in Dockerfile.pull from a staged context (the catalog, tools/resolve-skills from ./tool, and
// gbrain-stub.cjs), then runs four cells: {anthropic, openai} x {ok, error}. Each cell is one fresh QM stack
// (harnesses/qm/gstack/qm-stack.ts: Postgres and core, QM's local sandbox backend) behind the metering proxy in capture
// mode, whose upstreams are the repository's fakes, scripted to make one `execute` call that passes the input JSON to
// resolve-skills on stdin. Before teardown the stub's call log is read from the sandbox container. The cell checks:
//   1 tool_visible   the tool's hint is in the first agent request (where and at which offsets)
//   2 call_reached   the execute call reached the stub with the exact argv, GBRAIN_SKILLS_NO_AUTOREBUILD set
//   3 result_exact   the next agent request's tool result holds the stub's stdout byte for byte
//   4 error_fail_open (error cells) exit 0, block "", error.code INDEX_MISSING
// Writes <out>/<cell>/ (fake.ndjson, stub-calls.ndjson, sandbox-files.txt, capture.json, check.json) and <out>/summary.json.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { normalizeResult } from '../../../result-fields.ts';
import { RunProxy, summarizeUsage, trialKey, trialSlug, trialToken } from '../../../../../runner/trial/proxy.ts';
import { CAPTURE_DUMMY_KEYS } from '../../../../../runner/trial/capture.ts';
import { startFakeAnthropic, type FakeAnthropic } from '../../../../gsta-135/fake-anthropic.ts';
import { startFakeResponses, type FakeResponses } from '../../../../../tests/fixtures/fake-responses.ts';
import { DUMMY_KEY_PREFIX, imageInfo, qmClient, upStack } from '../../../../../harnesses/qm/gstack/qm-stack.ts';

const HERE = import.meta.dir;
const CORE_IMAGE = 'harness-eval/qm:harn52-pull', SANDBOX_IMAGE = 'harness-eval/qm-sandbox:harn52-pull';
const SANDBOX_RELEASE = 'harness-eval/qm-sandbox:harn52-pull-release', SANDBOX_RELEASE_MISSING = 'harness-eval/qm-sandbox:harn52-pull-release-missing';
const MODELS = {
  anthropic: { model: 'anthropic:claude-opus-5-5', housekeeping: 'anthropic:claude-haiku-5-5' },
  openai: { model: 'openai:gpt-6.1-sol', housekeeping: 'openai:gpt-5.6-luna' },
} as const;
type Provider = keyof typeof MODELS;
const MEMBER = 'U1', SCOPE = 'personal:' + MEMBER, PROJECT = 'qm-harn52-pull';
const TURN_TEXT = "Before I run rm -rf on the old build directory, is there a skill for doing that safely? It's Dana's repo.";
const MESSAGES = { ok: TURN_TEXT, error: '__gbrain_stub_index_missing__' } as const;
type Case = keyof typeof MESSAGES;
const EXPECT_CATALOG = readFileSync(join(HERE, 'tool', 'expect-catalog'), 'utf8').trim();
const expectedArgv = (expectCatalog: string) => ['skills', 'resolve', '--catalog', 'he-skills', '--input-json', '-', '--json', '--harness', 'qm', '--fail-open', '--expect-catalog', expectCatalog];

/** The command the scripted model runs: the hint's form (a quoted heredoc, so a request may hold any quote), with the
 *  cell's input JSON. */
export function pullCommand(message: string, session: string): string {
  return "resolve-skills <<'JSON'\n" + JSON.stringify({ message, session_id: session, harness: 'qm', top_k: 5 }) + '\nJSON';
}

/** Every string in a request body holding needle: its JSON path and offset. */
function locate(body: unknown, needle: string): Array<{ path: string; offset: number; field_chars: number }> {
  const out: Array<{ path: string; offset: number; field_chars: number }> = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') { for (let at = v.indexOf(needle); at >= 0; at = v.indexOf(needle, at + 1)) out.push({ path, offset: at, field_chars: v.length }); }
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, path + '[' + i + ']'));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? path + '.' + k : k);
  };
  walk(body, '');
  return out;
}

/** Tool results in a request: Anthropic tool_result blocks, Responses function_call_output items. */
function toolResults(body: Record<string, unknown>): Array<{ path: string; id: string; text: string }> {
  const out: Array<{ path: string; id: string; text: string }> = [];
  (body.messages as Array<{ content?: unknown }> | undefined)?.forEach((m, i) => Array.isArray(m.content) && (m.content as Array<Record<string, unknown>>).forEach((c, j) => {
    if (c.type !== 'tool_result') return;
    const text = typeof c.content === 'string' ? c.content : (c.content as Array<{ text?: string }>).map((x) => x.text ?? '').join('');
    out.push({ path: 'messages[' + i + '].content[' + j + ']', id: String(c.tool_use_id), text });
  }));
  (body.input as Array<Record<string, unknown>> | undefined)?.forEach((x, i) => {
    if (x.type === 'function_call_output') out.push({ path: 'input[' + i + ']', id: String(x.call_id), text: typeof x.output === 'string' ? x.output : JSON.stringify(x.output) });
  });
  return out;
}

/** The execute calls a request's history carries (what the fake asked for, as QM replays it). */
function executeCalls(body: Record<string, unknown>): Array<{ id: string; command: string }> {
  const out: Array<{ id: string; command: string }> = [];
  for (const m of (body.messages as Array<{ content?: unknown }> | undefined) ?? []) if (Array.isArray(m.content)) for (const c of m.content as Array<Record<string, unknown>>) if (c.type === 'tool_use' && c.name === 'execute') out.push({ id: String(c.id), command: String((c.input as { command?: string })?.command) });
  for (const x of (body.input as Array<Record<string, unknown>> | undefined) ?? []) if (x.type === 'function_call' && x.name === 'execute') out.push({ id: String(x.call_id), command: String((JSON.parse(String(x.arguments ?? '{}')) as { command?: string }).command) });
  return out;
}

function build(catalog: string, out: string, gbrain?: string) {
  const ctx = join(out, 'context');
  rmSync(ctx, { recursive: true, force: true });
  mkdirSync(join(ctx, 'tools'), { recursive: true });
  cpSync(join(catalog, 'skills'), join(ctx, 'skills'), { recursive: true });
  cpSync(join(HERE, 'tool'), join(ctx, 'tools', 'resolve-skills'), { recursive: true });
  cpSync(join(HERE, 'gbrain-stub.cjs'), join(ctx, 'gbrain-stub.cjs'));
  if (gbrain) { cpSync(gbrain, join(ctx, 'gbrain-release')); cpSync(join(HERE, 'gbrain-record.cjs'), join(ctx, 'gbrain-record.cjs')); }
  const targets = gbrain ? [['core', CORE_IMAGE], ['sandbox-release', SANDBOX_RELEASE], ['sandbox-release-missing', SANDBOX_RELEASE_MISSING]] : [['core', CORE_IMAGE], ['sandbox', SANDBOX_IMAGE]];
  for (const [target, tag] of targets) {
    const r = spawnSync('docker', ['build', '-q', '-f', join(HERE, 'Dockerfile.pull'), '--target', target, '-t', tag, ctx], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('docker build ' + target + ' failed: ' + r.stderr.slice(-1500));
  }
  rmSync(ctx, { recursive: true, force: true });
}

async function main(): Promise<number> {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const catalog = resolve(arg('--catalog') ?? join(homedir(), '.capy/work/internal-task/catalog'));
  const out = resolve(arg('--out') ?? join(homedir(), '.capy/work/internal-task/pull'));
  const providers = (arg('--providers') ?? 'anthropic,openai').split(',') as Provider[];
  mkdirSync(out, { recursive: true });
  const gbrain = arg('--gbrain') ? resolve(arg('--gbrain')!) : undefined;
  if (!process.argv.includes('--skip-build')) build(catalog, out, gbrain);
  const sandboxFor = (kase: Case) => (!gbrain ? SANDBOX_IMAGE : kase === 'error' ? SANDBOX_RELEASE_MISSING : SANDBOX_RELEASE);
  const images = gbrain
    ? { core: { tag: CORE_IMAGE, ...imageInfo(CORE_IMAGE) }, sandbox: { tag: SANDBOX_RELEASE, ...imageInfo(SANDBOX_RELEASE) }, sandbox_error: { tag: SANDBOX_RELEASE_MISSING, ...imageInfo(SANDBOX_RELEASE_MISSING) } }
    : { core: { tag: CORE_IMAGE, ...imageInfo(CORE_IMAGE) }, sandbox: { tag: SANDBOX_IMAGE, ...imageInfo(SANDBOX_IMAGE) } };
  const expectCatalog = gbrain ? spawnSync('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'cat', SANDBOX_RELEASE, '/usr/local/lib/resolve-skills/expect-catalog'], { encoding: 'utf8' }).stdout.trim() : EXPECT_CATALOG;
  const resolver = gbrain ? { binary: gbrain, sha256: createHash('sha256').update(readFileSync(gbrain)).digest('hex'), expect_catalog: expectCatalog } : { stand_in: 'gbrain-stub.cjs', expect_catalog: expectCatalog };
  const hint = (JSON.parse(readFileSync(join(HERE, 'tool', 'tool.json'), 'utf8')) as { hints: string[] }).hints[0]!;

  let fakeA: FakeAnthropic | null = null, fakeR: FakeResponses | null = null;
  const front = (get: () => string | null) => Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const base = get();
    if (!base) return new Response('no fake model bound', { status: 503 });
    const u = new URL(req.url);
    return fetch(base + u.pathname + u.search, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : await req.arrayBuffer() });
  } });
  const frontA = front(() => fakeA ? fakeA.url : null), frontR = front(() => fakeR ? 'http://127.0.0.1:' + fakeR.port : null);
  const proxy = await RunProxy.start({ runId: 'anatomy-capture-harn52-qm-pull', runDir: out, ledgerPath: join(out, 'ledger.sqlite'), leaseUsd: 20, allowModels: providers.flatMap((p) => [MODELS[p].model, MODELS[p].housekeeping]), maxOutputTokens: 128_000, reachableFromContainers: false, newRun: true, capture: { upstream: { anthropic: 'http://127.0.0.1:' + frontA.port, openai: 'http://127.0.0.1:' + frontR.port }, dns: null } });
  const cells: Record<string, unknown>[] = [];
  try {
    for (const provider of providers) for (const kase of ['ok', 'error'] as Case[]) {
      const id = 'qm-pull-' + provider + '-' + kase;
      const dir = join(out, id);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const log = join(dir, 'fake.ndjson');
      writeFileSync(log, '');
      const command = pullCommand(gbrain ? MESSAGES.ok : MESSAGES[kase], 'dm:' + MEMBER + ':' + id);
      const script = [{ call: 'execute', arguments: { command, purpose: 'Find catalog skills that fit the request' } }];
      fakeA?.stop(); fakeR?.stop(); fakeA = null; fakeR = null;
      if (provider === 'anthropic') fakeA = startFakeAnthropic({ host: '127.0.0.1', port: 0, log, requireKeyPrefix: DUMMY_KEY_PREFIX, script });
      else fakeR = startFakeResponses({ host: '127.0.0.1', port: 0, log, requireKeyPrefix: CAPTURE_DUMMY_KEYS.OPENAI_API_KEY, script });
      const cell = MODELS[provider];
      const slot = trialSlug(id), key = trialKey(id), token = trialToken(id);
      await proxy.bind(slot, key, token, [cell.model, cell.housekeeping]);
      const detail: Record<string, unknown> = { id, provider, case: kase, model: cell.model, images, command, started_at: new Date().toISOString() };
      let error: string | null = null, stubLines: Array<Record<string, unknown>> = [];
      try {
        const stack = await upStack({ out: join(dir, 'stack'), project: PROJECT, modelBaseUrl: proxy.baseUrlFor(slot, provider, false), modelKey: token, modelName: cell.model.split(':')[1], modelProvider: provider, coreImage: CORE_IMAGE, sandboxImage: sandboxFor(kase) });
        try {
          const call = qmClient(stack.url, stack.secret);
          const layer = await call('GET', '/v1/deployment-layer', undefined, { admin: false });
          detail.layer = { http: layer.http, live: (layer.body as { live?: unknown } | null)?.live ?? null };
          const created = await stack.createSandbox(() => call('POST', '/v1/admin/sandboxes/' + SCOPE, { action: 'create', backend: 'local', name: 'harn52-pull' }));
          const selected = await call('POST', '/v1/admin/sandboxes/' + SCOPE, { action: 'default', sandboxId: (created.body as { id?: string } | null)?.id ?? null });
          const machineId = (created.body as { machineId?: string } | null)?.machineId ?? null;
          detail.sandbox = { create_http: created.http, default_http: selected.http, machine_id: machineId };
          const turn = await call('POST', '/v1/turns', { surface: 'harness-eval', actor: { externalId: MEMBER, displayName: 'Dana Okafor' }, conversation: { kind: 'dm', threadRef: 'dm:' + MEMBER + ':' + id }, text: TURN_TEXT }, { admin: false, timeoutMs: 300_000 });
          detail.turn = { http: turn.http, status: (turn.body as { status?: string } | null)?.status ?? null, reply: (turn.body as { reply?: string } | null)?.reply ?? null, ms: turn.ms };
          if (machineId) {
            const calls = spawnSync('docker', ['exec', machineId, 'cat', '/tmp/gbrain-stub/calls.ndjson'], { encoding: 'utf8' });
            writeFileSync(join(dir, 'stub-calls.ndjson'), calls.stdout ?? '');
            stubLines = (calls.stdout ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
            const files = spawnSync('docker', ['exec', machineId, 'sh', '-c', 'ls -l /usr/local/bin/gbrain /usr/local/bin/resolve-skills /usr/local/lib/resolve-skills/expect-catalog; sha256sum /usr/local/bin/gbrain /usr/local/bin/resolve-skills /usr/local/lib/resolve-skills/expect-catalog'], { encoding: 'utf8' });
            writeFileSync(join(dir, 'sandbox-files.txt'), (files.stdout ?? '') + (files.stderr ?? ''));
          }
        } finally { stack.down(); }
      } catch (e) { error = String((e as Error)?.message ?? e).slice(0, 2000); }
      const meter = await proxy.finalize(key);
      const lines = proxy.usageLines(key);
      await proxy.unbind(slot);
      detail.usage = summarizeUsage(key, meter, lines).usage;
      detail.error = error;

      const bare = cell.model.split(':')[1]!;
      const reqs = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { body?: Record<string, unknown>; played?: unknown });
      const agent = reqs.filter((r) => r.body && String(r.body.model ?? '') === bare && Array.isArray(r.body.tools) && (r.body.tools as unknown[]).length > 0);
      const first = agent[0]?.body ?? null, next = agent[1]?.body ?? null;
      const stub = stubLines[0] ?? null;
      const stdout = typeof stub?.stdout === 'string' ? stub.stdout : null;
      const results = next ? toolResults(next) : [];
      const result = results.find((r) => stdout !== null && r.text.includes(stdout)) ?? results[0] ?? null;
      const replayed = next ? executeCalls(next) : [];
      const printed = stdout ? JSON.parse(stdout) as { block?: string; error?: { code?: string } } : null;
      const toolNames = first ? ((first.tools as Array<{ name?: string; function?: { name?: string } }>) ?? []).map((t) => t.name ?? t.function?.name ?? '') : [];
      const check = {
        cell: id,
        '1_tool_visible': {
          pass: !!first && locate(first, hint).length > 0,
          hint_at: first ? locate(first, hint) : [],
          heading_at: first ? locate(first, '## Deployment tool hints') : [],
          name_mentions: first ? locate(first, 'resolve-skills').map((l) => l.path + '@' + l.offset) : [],
          in_tools_array: toolNames.includes('resolve-skills'),
          execute_offered: toolNames.includes('execute'),
        },
        '2_call_reached': {
          pass: !!stub && JSON.stringify(stub.argv) === JSON.stringify(expectedArgv(expectCatalog)) && stub.no_autorebuild_set === true && replayed.some((c) => c.command === command),
          stub_calls: stubLines.length,
          argv: stub?.argv ?? null,
          argv_expected: expectedArgv(expectCatalog),
          no_autorebuild_set: stub?.no_autorebuild_set ?? null,
          stdin: stub?.stdin ?? null,
          execute_command_replayed: replayed.map((c) => c.command),
        },
        '3_result_exact': {
          pass: !!result && stdout !== null && result.text.includes(stdout),
          result_path: result?.path ?? null,
          stdout_sha256: stub?.stdout_sha256 ?? null,
          stdout_chars: stdout?.length ?? null,
          offset_in_result: result && stdout ? result.text.indexOf(stdout) : null,
          result_chars: result?.text.length ?? null,
          result_text: result?.text ?? null,
        },
        ...(kase === 'error' ? { '4_error_fail_open': {
          pass: stub?.exit === 0 && printed?.block === '' && (printed ? normalizeResult(printed).error_code : null) === 'INDEX_MISSING' && !!result && result.text.includes(stdout!),
          stub_exit: stub?.exit ?? null, block: printed?.block ?? null, error: printed?.error ?? null,
        } } : {}),
        requests: { total: reqs.length, agent: agent.length, models: reqs.map((r) => String(r.body?.model ?? '')), played: reqs.map((r) => r.played ?? null) },
        turn: detail.turn ?? null,
        usd: (detail.usage as { usd: number }).usd,
        error,
      };
      writeFileSync(join(dir, 'capture.json'), JSON.stringify(detail, null, 1) + '\n');
      writeFileSync(join(dir, 'check.json'), JSON.stringify(check, null, 1) + '\n');
      const passes = Object.entries(check).filter(([k]) => /^\d_/.test(k)).map(([k, v]) => k + '=' + (v as { pass: boolean }).pass);
      console.log(id + ': ' + passes.join(' ') + ' usd=' + check.usd + (error ? ' ERROR ' + error.slice(0, 300) : ''));
      cells.push(check);
    }
  } finally {
    await proxy.stop();
    fakeA?.stop(); fakeR?.stop(); frontA.stop(true); frontR.stop(true);
  }
  const all = cells.every((c) => Object.entries(c).filter(([k]) => /^\d_/.test(k)).every(([, v]) => (v as { pass: boolean }).pass));
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ label: 'pull via sandbox tool (QM refuses private-address MCP)', qm: 'main@90e4ced7', images, resolver, all_pass: all, cells: cells.map((c) => ({ cell: c.cell, ...Object.fromEntries(Object.entries(c).filter(([k]) => /^\d_/.test(k)).map(([k, v]) => [k, (v as { pass: boolean }).pass])), usd: c.usd, error: c.error })) }, null, 1) + '\n');
  return all ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
