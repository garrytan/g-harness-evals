#!/usr/bin/env bun
// Keyless memory-provider preflight for QM (internal-task-a, internal-task-b plan v3, M1 step 3). harnesses/qm/README.md, "Memory-provider
// preflight", lists the inputs, the outputs and the exact MEMORY_PROVIDER_CONFIG.
//
//   env -i PATH=$PATH HOME=$HOME bun harnesses/qm/provider-preflight.ts [--qm-commit <sha>] [--qm-image <tag>]
//       [--gbrain-image <tag>] [--out <dir>] [--receipt <file>] [--core-port 58080] [--pg-port 55432]
//
// One run, nothing paid: QM core (the image built at --qm-commit, default pin.json's) beside Postgres, its model pointed at
// scripts/gsta-135/fake-anthropic.ts (refuses any key not starting with the dummy prefix), the world server in process with
// the gbrain tap and its OAuth client-credentials issuer (world/services/oauth-issuer.ts), and the keyword gbrain sidecar.
// QM reaches gbrain only as a memory provider: no MCP server is registered. Steps:
//   1. seed one fact into gbrain with remember (straight to the sidecar, not through the tap)
//   2. core with MEMORY_PROVIDER_CONFIG (failOpen false) and the right client pair: a DM turn that asks for the fact, then
//      a DM turn in a new thread that asks something unrelated
//   3. core recreated with a wrong client secret, same database: the fact question again in a third thread
// Each stored UserMessage (Postgres items, kind UserMessage) is read back: payload.environment, payload.memoryRecall and,
// where QM records it (f3577189 and later), memoryRecallOutcomes. The tap's events (via gbrain) and the issuer's (via oauth)
// come from the world's event log. The receipt holds image ids, the config with no secret values, every assertion and the
// verdict; the client secret and issued tokens are never written. Exit 0 when every assertion passes, 1 otherwise, 2 when
// an input is missing.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');
const QM_DIR = join(ROOT, 'harnesses/qm');
const DUMMY_KEY = 'sk-ant-capture-dummy';
export const CLIENT_ID = 'qm-memory-read';
export const CLIENT_ID_ENV = 'QM_PF_READ_CLIENT_ID';
export const CLIENT_SECRET_ENV = 'QM_PF_READ_CLIENT_SECRET';
export const SEED = {
  fact: 'The Heron loading dock gate code is QMPF-4471-HERON.',
  entity: 'heron-loading-dock',
  provenance: 'harness-evals QM memory-provider preflight seed (internal-task)',
  marker: 'QMPF-4471-HERON',
};
export const PROMPTS = {
  positive: 'What is the gate code for the Heron loading dock?',
  unrelated: 'What time does the Friday all-hands start?',
};

/** The exact MEMORY_PROVIDER_CONFIG the preflight gives QM; mcpUrl is the world's /gbrain tap as core reaches it. */
export function providerConfig(mcpUrl: string) {
  return {
    providers: [{
      id: 'gbrain',
      type: 'mcp',
      url: mcpUrl,
      timeoutMs: 10000,
      read: { tool: 'recall', queryArg: 'question', maxCharsArg: 'max_chars', clientIdEnv: CLIENT_ID_ENV, clientSecretEnv: CLIENT_SECRET_ENV },
    }],
    routes: [
      { provider: 'default', scopes: ['personal', 'channel', 'group', 'team', 'org'], capture: 'automatic' },
      { provider: 'gbrain', scopes: ['personal'], capture: 'off', manage: false, label: 'gbrain', failOpen: false },
    ],
  };
}

/** A stored user turn as the preflight reads it: QM's items row body, with payload fields wherever this commit keeps them. */
export interface StoredTurn { session_id: string; seq: number; text: string | null; body: Record<string, unknown> }

function field(body: Record<string, unknown>, key: string): unknown {
  const payload = body.payload && typeof body.payload === 'object' ? body.payload as Record<string, unknown> : undefined;
  return payload?.[key] ?? body[key];
}

/** What a stored user turn shows about memory recall. Accepts both shapes: b6786d67 (recall text inside the environment
 *  block, payload.memoryRecall the shown-fact record) and f3577189 (the recall rows fenced in an untrusted-data block, and
 *  memoryRecallOutcomes on the turn). */
export function inspectTurn(turn: StoredTurn | undefined, marker: string) {
  if (!turn) return { stored: false, environment_has_fact: false, memory_recall: null as unknown, memory_recall_outcomes: null as unknown, untrusted_fence: false, environment_chars: 0, gbrain_section: null as string | null };
  const environment = String(field(turn.body, 'environment') ?? '');
  const i = environment.indexOf(marker);
  const heading = i >= 0 ? environment.lastIndexOf('### gbrain', i) : -1;
  const start = heading >= 0 ? heading : environment.indexOf('### gbrain');
  return {
    stored: true,
    environment_has_fact: i >= 0,
    memory_recall: field(turn.body, 'memoryRecall') ?? null,
    memory_recall_outcomes: field(turn.body, 'memoryRecallOutcomes') ?? null,
    untrusted_fence: /untrusted-data/.test(environment),
    environment_chars: environment.length,
    gbrain_section: start >= 0 ? environment.slice(start, start + 4000) : null,
  };
}
export type TurnView = ReturnType<typeof inspectTurn>;

/** The outcome QM recorded for the gbrain provider, when the turn carries memoryRecallOutcomes (f3577189 and later). */
export function providerOutcome(outcomes: unknown, provider = 'gbrain'): string | null {
  const list = Array.isArray(outcomes) ? outcomes : outcomes && typeof outcomes === 'object' ? Object.values(outcomes as object) : [];
  for (const o of list) if (o && typeof o === 'object' && (o as { provider?: unknown }).provider === provider) return String((o as { outcome?: unknown }).outcome ?? '');
  return null;
}

/** Token-shaped strings that must never reach the receipt. */
export const SECRET_PATTERNS: RegExp[] = [/sk-ant-[A-Za-z0-9_-]{8,}/, /sk-[A-Za-z0-9]{20,}/, /xox[abp]-[A-Za-z0-9-]{8,}/, /xapp-[A-Za-z0-9-]{8,}/, /wgat-[A-Za-z0-9_-]{8,}/, /wadm-[A-Za-z0-9_-]{8,}/, /gbrain_[0-9a-f]{16,}/, /\bv0=[0-9a-f]{32,}/];
export function secretHits(text: string, extra: string[] = []): string[] {
  return [...SECRET_PATTERNS.filter((p) => p.test(text)).map(String), ...extra.filter((s) => s && text.includes(s)).map(() => 'run secret')];
}

export interface Assertion { id: string; pass: boolean; detail: string }
export interface TurnObservation { status: string | null; turn: TurnView; recalls: Array<{ outcome: string; args: Record<string, unknown> }> }

/** The plan's checks, from what the run observed. Pure, so the assertion logic is unit-tested without docker. */
export function evaluate(o: {
  mcpUrl: string; prm: { authorization_servers?: string[]; resource?: string } | null; asMeta: { issuer?: string } | null;
  tokenEvents: Array<{ phase: string; outcome: string; auth_method?: string | null }>;
  config: ReturnType<typeof providerConfig>;
  positive: TurnObservation; unrelated: TurnObservation;
  wrong: TurnObservation & { http: number | null; errorText: string };
  seedOk: boolean;
}): Assertion[] {
  const origin = new URL(o.mcpUrl).origin;
  const same = (a?: string) => !!a && a.replace(/\/$/, '') === origin;
  const issued = (phase: string) => o.tokenEvents.filter((e) => e.phase === phase && e.outcome === 'ok');
  const denied = o.tokenEvents.filter((e) => e.phase === 'wrong' && e.outcome === 'denied');
  const gbrainRoute = o.config.routes.find((r) => r.provider === 'gbrain');
  const posOutcome = providerOutcome(o.positive.turn.memory_recall_outcomes);
  const wrongOutcome = providerOutcome(o.wrong.turn.memory_recall_outcomes);
  const methods = [...new Set(issued('right').map((e) => e.auth_method))].join(',') || 'none';
  const wrongStored = o.wrong.turn.stored ? (o.wrong.turn.environment_has_fact ? 'shows the fact' : 'without the fact') : 'absent';
  return [
    { id: 'seed', pass: o.seedOk, detail: o.seedOk ? 'remember inserted the seed fact' : 'remember did not insert the seed fact' },
    { id: 'oauth_issuer_matches_mcp_origin', pass: same(o.prm?.authorization_servers?.[0]) && same(o.asMeta?.issuer) && o.prm?.resource === o.mcpUrl,
      detail: `MCP URL ${o.mcpUrl}; protected-resource authorization_servers[0] ${o.prm?.authorization_servers?.[0]}; issuer ${o.asMeta?.issuer}` },
    { id: 'oauth_client_credentials_token', pass: issued('right').length > 0 && issued('right').every((e) => e.auth_method === 'client_secret_basic'),
      detail: `${issued('right').length} token(s) issued to the right client pair (grant client_credentials, ${methods})` },
    { id: 'fail_open_false', pass: gbrainRoute?.failOpen === false, detail: 'the gbrain route sets failOpen false (preflight only)' },
    { id: 'positive_turn_ok', pass: o.positive.status === 'ok', detail: `turn status ${o.positive.status}` },
    { id: 'stored_turn_shows_fact', pass: o.positive.turn.environment_has_fact && o.positive.turn.memory_recall !== null && (posOutcome === null || posOutcome === 'ok'),
      detail: `payload.environment ${o.positive.turn.environment_has_fact ? 'contains' : 'lacks'} the seed fact; payload.memoryRecall ${o.positive.turn.memory_recall === null ? 'absent' : 'present'}${posOutcome === null ? '' : '; memoryRecallOutcomes gbrain ' + posOutcome}${o.positive.turn.untrusted_fence ? '; untrusted-data fence' : ''}` },
    { id: 'recall_event_logged', pass: o.positive.recalls.some((r) => r.outcome === 'ok'), detail: `${o.positive.recalls.length} gbrain recall event(s) in the tap's log during the positive turn` },
    { id: 'negative_unrelated_query', pass: o.unrelated.status === 'ok' && o.unrelated.turn.stored && !o.unrelated.turn.environment_has_fact && o.unrelated.recalls.some((r) => r.outcome === 'ok'),
      detail: `unrelated question: turn status ${o.unrelated.status}, ${o.unrelated.recalls.length} recall event(s), stored turn ${o.unrelated.turn.environment_has_fact ? 'shows' : 'does not show'} the seed fact` },
    { id: 'negative_wrong_credentials', pass: denied.length > 0 && issued('wrong').length === 0 && o.wrong.recalls.length === 0 && !o.wrong.turn.environment_has_fact,
      detail: `wrong secret: ${denied.length} token request(s) denied, ${issued('wrong').length} issued, ${o.wrong.recalls.length} recall event(s), stored turn ${wrongStored}` },
    { id: 'fail_closed_visible', pass: o.wrong.http !== null && (o.wrong.http >= 500 || o.wrong.status === 'failed') && wrongOutcome !== 'ok',
      detail: `wrong-credential turn: HTTP ${o.wrong.http}, status ${o.wrong.status}${wrongOutcome === null ? '' : ', memoryRecallOutcomes gbrain ' + wrongOutcome}; ${o.wrong.errorText.slice(0, 240)}` },
  ];
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v === undefined || v.startsWith('--') ? fallback : v;
}
const sh = (cmd: string, args: string[], env?: Record<string, string>) => spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT, env, maxBuffer: 64 * 1024 * 1024 });
const rnd = () => randomBytes(24).toString('hex');
const baseEnv = () => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: homedir() });

async function waitFor(test: () => boolean | Promise<boolean>, ms: number, what: string) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await test()) return; await Bun.sleep(500); }
  throw new Error(`timed out waiting for ${what}`);
}

if (import.meta.main) {
  const pin = JSON.parse(readFileSync(join(QM_DIR, 'pin.json'), 'utf8')) as { commit: string };
  const qmCommit = arg('qm-commit', pin.commit)!;
  const qmImage = arg('qm-image', 'harness-eval/qm:dev')!;
  const gbrainImage = arg('gbrain-image', 'harness-eval/gbrain:dev')!;
  const corePort = Number(arg('core-port', '58080'));
  const pgPort = Number(arg('pg-port', '55432'));
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).toLowerCase();
  const id = `qm-provider-preflight-${qmCommit.slice(0, 8)}-${stamp}`;
  const out = resolve(arg('out', join(homedir(), '.capy/work/harn15/provider-preflight', `${id}-${process.pid}`))!);
  const receiptPath = arg('receipt');
  mkdirSync(out, { recursive: true });
  const log = (line: string) => { console.log(`[preflight] ${line}`); writeFileSync(join(out, 'preflight.log'), line + '\n', { flag: 'a' }); };

  if (!/^[0-9a-f]{40}$/.test(qmCommit)) { console.error('--qm-commit must be a full sha'); process.exit(2); }
  const label = sh('docker', ['image', 'inspect', '-f', '{{index .Config.Labels "harness-eval.commit"}}', qmImage]).stdout.trim();
  if (label !== qmCommit) {
    console.error(`qm image ${qmImage} is QM ${label || '<missing>'}, not ${qmCommit}; build it: docker build --build-arg QM_COMMIT=${qmCommit} -t ${qmImage} harnesses/qm`);
    process.exit(2);
  }
  const { startGbrainSidecar, callGbrain, gbrainImageCommit } = await import('../../runner/trial/gbrain.ts');
  const { createWorldServer } = await import('../../world/services/server.ts');
  const { loadWorld } = await import('../../world/services/world.ts');
  const imageId = (tag: string) => sh('docker', ['image', 'inspect', '-f', '{{.Id}}', tag]).stdout.trim();
  const images = {
    qm_core: { tag: qmImage, image_id: imageId(qmImage), label_commit: label },
    gbrain: { tag: gbrainImage, image_id: imageId(gbrainImage), gbrain_commit: gbrainImageCommit(gbrainImage) },
    postgres: { tag: 'pgvector/pgvector:0.8.1-pg16', image_id: '' },
  };

  const cleanups: Array<() => Promise<void> | void> = [];
  let cleaning: Promise<void> | null = null;
  const runCleanups = () => (cleaning ??= (async () => { for (const c of cleanups.splice(0).reverse()) { try { await c(); } catch (e) { log(`cleanup: ${(e as Error).message}`); } } })());
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]] as const) process.on(sig, () => { void runCleanups().then(() => process.exit(code)); });
  let exitCode = 1;
  try {
    const fakePort = 18700 + Math.floor(Math.random() * 200);
    const fakeOut = openSync(join(out, 'fake.out'), 'a');
    const fake = spawn(process.execPath, [join(ROOT, 'scripts/gsta-135/fake-anthropic.ts'), '--host', '127.0.0.1', '--port', String(fakePort), '--log', join(out, 'fake.ndjson'),
      '--require-key-prefix', DUMMY_KEY, '--max-requests', '200', '--max-seconds', '1800'], { env: baseEnv(), stdio: ['ignore', fakeOut, fakeOut] });
    cleanups.push(() => { fake.kill('SIGTERM'); });
    await waitFor(() => readFileSync(join(out, 'fake.out'), 'utf8').includes('listening'), 20_000, 'the fake model endpoint');

    const sidecar = await startGbrainSidecar({ trialId: id, trialSlug: `qmpf-${stamp}-${process.pid}`, split: 'dev', outDir: join(out, 'gbrain'), image: gbrainImage, log });
    cleanups.push(() => sidecar.stop());
    const seed = await callGbrain(sidecar.url, sidecar.token, 'remember', { fact: SEED.fact, entity: SEED.entity, provenance: SEED.provenance });
    const seedOk = (seed as { status?: string } | null)?.status === 'inserted';
    log(`seed: ${seedOk ? 'inserted' : JSON.stringify(seed).slice(0, 300)}`);

    const world = loadWorld(join(ROOT, 'world/seed/world.json'));
    const clientSecret = rnd();
    const provider = { clients: { [CLIENT_ID]: { secret: clientSecret, member: 'assistant' } }, tokens: {} as Record<string, string> };
    const ws = createWorldServer({ world, split: 'dev', trialId: id, eventsPath: join(out, 'events.ndjson'), hostname: '127.0.0.1', port: 0,
      gbrain: { url: sidecar.url, token: sidecar.token, provider } });
    cleanups.push(() => ws.stop());
    const mcpUrl = `${ws.url}/gbrain`;
    const origin = new URL(mcpUrl).origin;
    const config = providerConfig(mcpUrl);
    const prm = await (await fetch(`${ws.url}/.well-known/oauth-protected-resource/gbrain`)).json() as { authorization_servers?: string[]; resource?: string };
    const asMeta = await (await fetch(`${ws.url}/.well-known/oauth-authorization-server`)).json() as { issuer?: string };

    const project = `qmpf-${stamp}-${process.pid}`;
    for (const d of ['state/qm', 'logs', 'turns', 'workspace']) mkdirSync(join(out, d), { recursive: true });
    const override = join(out, 'compose.preflight.yaml');
    writeFileSync(override, [
      '# Written by harnesses/qm/provider-preflight.ts: QM core gets the memory-provider config and the env names it reads the',
      '# OAuth client pair from; the values come from the preflight process environment, never from this file.',
      'services:', '  core:', '    environment:',
      '      MEMORY_PROVIDER_CONFIG: $' + '{QM_PF_MEMORY_PROVIDER_CONFIG}',
      `      ${CLIENT_ID_ENV}: $` + `{${CLIENT_ID_ENV}}`,
      `      ${CLIENT_SECRET_ENV}: $` + `{${CLIENT_SECRET_ENV}}`, '',
    ].join('\n'));
    const signing = rnd();
    const connectorKey = rnd();
    const composeEnv = (secret: string): Record<string, string> => ({
      ...baseEnv(),
      HE_STATE: join(out, 'state'), HE_LOGS: join(out, 'logs'), HE_TURNS: join(out, 'turns'), HE_WORKSPACE: join(out, 'workspace'),
      HE_UID: String(process.getuid?.() ?? 1000), HE_GID: String(process.getgid?.() ?? 1000),
      QM_DOCKER_GID: sh('stat', ['-c', '%g', '/var/run/docker.sock']).stdout.trim() || '999',
      QM_IMAGE: qmImage, QM_CORE_PORT: String(corePort), QM_PG_PORT: String(pgPort),
      QM_SIGNING_SECRET: signing, QM_CONNECTOR_SECRET_KEY: connectorKey,
      HE_MODEL_BASE_URL: `http://127.0.0.1:${fakePort}`, HE_MODEL_API_KEY: DUMMY_KEY, HE_MODEL_NAME: 'claude-haiku-5-5',
      QM_PF_MEMORY_PROVIDER_CONFIG: JSON.stringify(config), [CLIENT_ID_ENV]: CLIENT_ID, [CLIENT_SECRET_ENV]: secret,
    });
    const compose = (secret: string, ...a: string[]) => {
      if (cleaning && a[0] !== 'logs' && a[0] !== 'down') throw new Error(`cleanup has started; refusing docker compose ${a[0]}`);
      return sh('docker', ['compose', '-p', project, '-f', join(QM_DIR, 'compose.yaml'), '-f', override, ...a], composeEnv(secret));
    };
    cleanups.push(() => {
      writeFileSync(join(out, 'core.log'), compose(clientSecret, 'logs', '--no-color', 'core').stdout);
      compose(clientSecret, 'down', '-v', '--remove-orphans');
    });
    const coreUrl = `http://127.0.0.1:${corePort}`;
    const startCore = async (secret: string, recreate: boolean) => {
      const up = compose(secret, 'up', '-d', ...(recreate ? ['--no-deps', '--force-recreate', 'core'] : ['pg', 'core']));
      if (up.status !== 0) throw new Error(`docker compose up failed: ${up.stderr.slice(-600)}`);
      if (recreate) await Bun.sleep(1500);
      await waitFor(async () => { try { return (await fetch(`${coreUrl}/healthz`)).ok; } catch { return false; } }, 180_000, 'QM core /healthz');
    };
    // The world answers QM's provider calls from this process, so the turn is posted without blocking the event loop.
    const turn = async (name: string, threadRef: string, text: string) => {
      const textFile = join(out, 'turns', `${name}.txt`);
      const job = join(out, 'turns', `${name}.job.json`);
      writeFileSync(textFile, text);
      writeFileSync(job, JSON.stringify({ actor: { externalId: 'U1', displayName: 'Preflight Member' }, conversation: { kind: 'dm', threadRef }, text_file: textFile }));
      const before = ws.log.events.length;
      const proc = Bun.spawn(['node', join(QM_DIR, 'qm-api.mjs'), 'turn', coreUrl, signing, job, '180'], { cwd: ROOT, env: baseEnv(), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
      const [stdout, status] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      const r = { stdout, status };
      writeFileSync(join(out, `${name}.turn.json`), r.stdout);
      let parsed: { http?: number; body?: unknown } = {};
      try { parsed = JSON.parse(r.stdout); } catch { /* recorded raw */ }
      const body = (parsed.body && typeof parsed.body === 'object' ? parsed.body : {}) as { status?: string; reply?: string; reason?: unknown; error?: unknown };
      const recalls = ws.log.events.slice(before).filter((e) => e.via === 'gbrain' && e.tool === 'gbrain.recall')
        .map((e) => ({ outcome: e.outcome, error: e.error ?? null, args: e.args as Record<string, unknown>, latency_ms: (e.effect as { latency_ms?: number } | undefined)?.latency_ms ?? null }));
      log(`${name}: exit ${r.status}, HTTP ${parsed.http}, status ${body.status ?? '-'}, ${recalls.length} recall event(s)`);
      const errorText = typeof parsed.body === 'string' ? parsed.body : JSON.stringify({ reason: body.reason ?? null, error: body.error ?? null });
      return { exit: r.status, http: parsed.http ?? null, status: body.status ?? null, reply: body.reply ?? null, errorText, recalls, threadRef };
    };
    const storedTurns = (): StoredTurn[] => {
      const q = "select coalesce(json_agg(json_build_object('session_id', i.session_id, 'seq', i.seq, 'text', i.text, 'body', i.body) order by i.created_at), '[]') from items i where i.kind = 'UserMessage'";
      const r = compose(clientSecret, 'exec', '-T', 'pg', 'psql', '-U', 'postgres', '-d', 'qm', '-At', '-c', q);
      if (r.status !== 0) throw new Error(`psql failed: ${r.stderr.slice(-400)}`);
      return JSON.parse(r.stdout.trim() || '[]') as StoredTurn[];
    };
    const tokenEvents = (phase: string, from: number) => ws.log.events.slice(from).filter((e) => e.via === 'oauth').map((e) => {
      const a = e.args as Record<string, unknown>;
      return { phase, outcome: e.outcome, error: e.error ?? null, client_id: (a.client_id ?? null) as string | null, auth_method: (a.auth_method ?? null) as string | null, resource: a.resource === mcpUrl ? '<MCP URL>' : (a.resource ?? null) };
    });

    log(`core ${qmImage} (${images.qm_core.image_id}) at ${coreUrl}, world ${ws.url}, fake model 127.0.0.1:${fakePort}`);
    const rightFrom = ws.log.events.length;
    await startCore(clientSecret, false);
    images.postgres.image_id = imageId('pgvector/pgvector:0.8.1-pg16');
    const positive = await turn('positive', 'dm:preflight-positive', PROMPTS.positive);
    const unrelated = await turn('unrelated', 'dm:preflight-unrelated', PROMPTS.unrelated);
    const rightTokens = tokenEvents('right', rightFrom);
    const afterRight = storedTurns();

    const wrongFrom = ws.log.events.length;
    await startCore(rnd(), true);
    const wrong = await turn('wrong-credentials', 'dm:preflight-wrong-credentials', PROMPTS.positive);
    const wrongTokens = tokenEvents('wrong', wrongFrom);
    const stored = storedTurns();
    writeFileSync(join(out, 'stored-turns.json'), JSON.stringify(stored, null, 1));
    const asks = (t: StoredTurn, text: string) => (t.text ?? JSON.stringify(t.body)).includes(text);
    const positiveTurn = inspectTurn(afterRight.find((t) => asks(t, PROMPTS.positive)), SEED.marker);
    const unrelatedTurn = inspectTurn(stored.find((t) => asks(t, PROMPTS.unrelated)), SEED.marker);
    const wrongTurn = inspectTurn(stored.find((t) => asks(t, PROMPTS.positive) && !afterRight.some((a) => a.session_id === t.session_id && a.seq === t.seq)), SEED.marker);

    const fakeRequests = existsSync(join(out, 'fake.ndjson')) ? readFileSync(join(out, 'fake.ndjson'), 'utf8').trim().split('\n').filter(Boolean) : [];
    const assertions = evaluate({
      mcpUrl, prm, asMeta, tokenEvents: [...rightTokens, ...wrongTokens], config,
      positive: { status: positive.status, turn: positiveTurn, recalls: positive.recalls },
      unrelated: { status: unrelated.status, turn: unrelatedTurn, recalls: unrelated.recalls },
      wrong: { status: wrong.status, http: wrong.http, turn: wrongTurn, recalls: wrong.recalls, errorText: wrong.errorText },
      seedOk,
    });
    const section = positiveTurn.gbrain_section ?? '';
    const view = (t: typeof positive, s: TurnView, prompt: string) => ({
      thread: t.threadRef, prompt, http: t.http, status: t.status, reply: t.reply, error: t.status === 'ok' ? null : t.errorText, recall_events: t.recalls,
      stored_user_turn: { stored: s.stored, environment_chars: s.environment_chars, environment_has_seed_fact: s.environment_has_fact, memory_recall: s.memory_recall, memory_recall_outcomes: s.memory_recall_outcomes, untrusted_data_fence: s.untrusted_fence, gbrain_section_excerpt: s.gbrain_section },
    });
    const receipt = {
      what: 'Keyless memory-provider preflight for QM (internal-task-a, internal-task-b plan v3, M1 step 3): QM core reaches gbrain only through MEMORY_PROVIDER_CONFIG, authenticated with OAuth client credentials from the world issuer at the MCP URL origin. No paid call: the model endpoint was scripts/gsta-135/fake-anthropic.ts, which refuses any key not starting with the dummy prefix.',
      run: id,
      date: new Date().toISOString().slice(0, 10),
      command: 'env -i PATH=$PATH HOME=$HOME bun harnesses/qm/provider-preflight.ts' + (qmCommit !== pin.commit ? ' --qm-commit ' + qmCommit : '') + (receiptPath ? ' --receipt <file>' : ''),
      qm: { repo: 'https://github.com/yc-software/qm', commit: qmCommit, pinned_commit: pin.commit },
      harness_evals_commit: sh('git', ['rev-parse', 'HEAD']).stdout.trim(),
      dirty: sh('git', ['status', '--porcelain']).stdout.trim().length > 0,
      images,
      model_route: { endpoint: 'scripts/gsta-135/fake-anthropic.ts on 127.0.0.1 (core runs on the host network and reaches it directly)', model: 'claude-haiku-5-5', key: "a dummy with the fake's required prefix", requests: fakeRequests.length, model_request_carried_seed_fact: fakeRequests.some((l) => l.includes(SEED.marker)) },
      memory_provider_config: { ...config, providers: config.providers.map((p) => ({ ...p, url: 'http://127.0.0.1:<world port>/gbrain' })) },
      env_given_to_core: { MEMORY_PROVIDER_CONFIG: 'the JSON above, with the world port', [CLIENT_ID_ENV]: CLIENT_ID, [CLIENT_SECRET_ENV]: '<random per run, never written>' },
      oauth: {
        mcp_url: 'http://127.0.0.1:<world port>/gbrain',
        protected_resource: { resource: prm.resource === mcpUrl ? '<MCP URL>' : prm.resource, authorization_servers: prm.authorization_servers?.map((s) => (s === origin ? '<MCP URL origin>' : s)) },
        authorization_server: { issuer: asMeta.issuer === origin ? '<MCP URL origin>' : asMeta.issuer },
        qm_expected_issuer: 'new URL("/", <MCP URL>).href (src/mcp/mcp-client.ts, ClientCredentialsProvider expectedIssuer)',
        token_requests: [...rightTokens, ...wrongTokens],
      },
      seed: { tool: 'remember', fact: SEED.fact, entity: SEED.entity, provenance: SEED.provenance, inserted: seedOk, via: 'the sidecar directly, with its token (not through the tap)' },
      turns: {
        positive: view(positive, positiveTurn, PROMPTS.positive),
        unrelated: view(unrelated, unrelatedTurn, PROMPTS.unrelated),
        wrong_credentials: view(wrong, wrongTurn, PROMPTS.positive),
      },
      max_chars: {
        configured: 'read.maxCharsArg max_chars',
        sent_by_qm: positive.recalls.some((r) => 'max_chars' in r.args),
        values_seen: [...new Set(positive.recalls.map((r) => r.args.max_chars).filter((v) => v !== undefined))],
        gbrain_ran_the_call: positive.recalls.some((r) => r.outcome === 'ok' && 'max_chars' in r.args),
        max_chars_warning_in_stored_environment: section.includes('unknown parameter "max_chars" ignored'),
        acting_user_warning_in_stored_environment: section.includes('unknown parameter "acting_user" ignored'),
      },
      assertions,
      pass: assertions.every((a) => a.pass),
    };
    const text = JSON.stringify(receipt, null, 2) + '\n';
    const hits = secretHits(text, [clientSecret, signing, sidecar.token, ...Object.keys(provider.tokens)]);
    if (hits.length) throw new Error(`receipt failed the secret scan (${hits.join(', ')}); not written`);
    writeFileSync(join(out, 'receipt.json'), text);
    if (receiptPath) writeFileSync(resolve(receiptPath), text);
    for (const a of assertions) log(`${a.pass ? 'PASS' : 'FAIL'} ${a.id}: ${a.detail}`);
    log(`max_chars: ${JSON.stringify(receipt.max_chars)}`);
    log(`PREFLIGHT: ${receipt.pass ? 'pass' : 'fail'} out=${out}`);
    exitCode = receipt.pass ? 0 : 1;
  } catch (e) {
    log(`error: ${(e as Error).stack ?? e}`);
    exitCode = 1;
  } finally {
    await runCleanups();
  }
  process.exit(exitCode);
}
