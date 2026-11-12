// internal-task-a (internal-task-b plan v3, M1 step 5, the C4 told-live run): the runner wiring for QM's memory-provider cell and for live
// ingestion under the two-layer scope "member-sources", keyless.
//   1. The draft's three cells load and dry-run: none, memory-provider (config pi-memory-provider) and route-tool (scope
//      member-sources with ingest live, which main refused with HE-GBRAIN-003).
//   2. pi-memory-provider builds the exact MEMORY_PROVIDER_CONFIG, the tap's provider block, and no gbrain MCP registration.
//   3. Byte identity: QM's existing none and route-tool configs produce the artifacts main produced (the plan, the compose
//      override, the gbrain upstream, the adapter's gbrain variables, prepare.sh's output).
//   4. Write errors are counted by code in the trial record and in summarize-run's gbrain usage.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildManifest, loadPrereg, renderPlan, type Cell } from '../runner/run.ts';
import { composeOverride } from '../runner/trial/docker.ts';
import { gbrainHarnessEnv, gbrainSummary, gbrainUpstream } from '../runner/trial/trial.ts';
import { resolveGbrain } from '../runner/run.ts';
import { gbrainUsage } from '../scripts/gbrain-usage.ts';
import { renderLayers } from '../scripts/gbrain-scope-layers.ts';
import { LIST_PAGES_MAX_PAGES, listPagesToEnd } from '../runner/trial/gbrain.ts';
import { RunnerError } from '../runner/errors.ts';
import { CLIENT_ID, CLIENT_ID_ENV, CLIENT_SECRET_ENV, isQmMemoryProvider, memoryProviderWiring, providerConfig } from '../harnesses/qm/memory-provider.ts';
import type { WorldEvent } from '../world/services/events.ts';

const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-qm-mp-'));

const TASKS = ['cn-01-tamsin-cold-chain-site', 'cn-02-tansleigh-packaging-deadline', 'cn-03-marrow-agrisupply-site', 'cn-04-quarrendon-site', 'cr-01-marrow-agrisupply-site-retraction', 'cr-02-quarrendon-seat-count-retraction', 'cr-03-brackenwater-renewal-date-retraction', 'cr-04-marrow-agrisupply-seat-count'];
const base: Omit<Cell, 'id'> = { harness: 'qm', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', task_set: 'v0.3', config: 'pi', utility_models: ['anthropic:claude-haiku-5-5'], tasks: TASKS, repetitions: 5, ceiling: { input_tokens: 80000, output_tokens: 6000 } };
// The C4 draft's cells (qm-c4-told-live-2026-11), and the pilot's told-live scope for the identity check.
const NONE = { id: 'qm-pi-opus-none-mu-v03-dev', ...base } as Cell;
const MEMORY_PROVIDER = { id: 'qm-pi-opus-gbrain-memory-provider-mu-v03-dev', ...base, config: 'pi-memory-provider', gbrain: { surface: 'starter', brain: 'member', scope: 'member', ingest: 'live' } } as Cell;
const ROUTE_TOOL = { id: 'qm-pi-opus-gbrain-route-tool-mu-v03-dev', ...base, gbrain: { surface: 'starter', brain: 'member', scope: 'member-sources', ingest: 'live' }, preamble: 'tasks/multiuser/_shared/preamble.gbrain-memory.md' } as Cell;
const ROUTE_TOOL_MEMBER = { ...ROUTE_TOOL, gbrain: { ...ROUTE_TOOL.gbrain!, scope: 'member' } } as Cell;

function writePrereg(cells: Cell[], runId: string): string {
  const dir = join(tmp, runId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'prereg.json');
  writeFileSync(file, JSON.stringify({ schema_version: 1, run_id: runId, question: 'identity', tasks: {}, cells, wall_clock_s: { multiuser: 1500 }, spend_cap_usd: 25, drop_order: [], minimum_v01: [] }));
  return file;
}
const planOf = (cells: Cell[], runId: string) => { const { prereg, sha256 } = loadPrereg(writePrereg(cells, runId)); return renderPlan(buildManifest(prereg, sha256, '2026-10-31T00:00:00Z')); };

// The draft's MEMORY_PROVIDER_CONFIG, verbatim ("The exact MEMORY_PROVIDER_CONFIG"), with the tap URL filled in.
const DRAFT_CONFIG = {"providers":[{"id":"gbrain","type":"mcp","url":"http://host.docker.internal:8790/gbrain","timeoutMs":10000,
  "read":{"tool":"recall","queryArg":"question","maxCharsArg":"max_chars","clientIdEnv":"QM_GBRAIN_READ_CLIENT_ID","clientSecretEnv":"QM_GBRAIN_READ_CLIENT_SECRET"}}],
 "routes":[{"provider":"default","scopes":["personal","channel","group","team","org"],"capture":"automatic"},
  {"provider":"gbrain","scopes":["personal"],"capture":"off","manage":false,"label":"gbrain","failOpen":true}]};

// renderPlan at main 3a9b403be for [NONE, ROUTE_TOOL_MEMBER] (main refuses ROUTE_TOOL's member-sources with live ingestion).
const PLAN_AT_MAIN = [
  "RUN: qm-identity trials=80 cells=2 ceiling_usd=110 cap_usd=25 trial_hours_at_cap=33.3",
  "CELL: qm-pi-opus-none-mu-v03-dev harness=qm mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3 utility_models=anthropic:claude-haiku-5-5 config=pi reps=5 trials=40 turns=125 ceiling_usd=55",
  "CELL: qm-pi-opus-gbrain-route-tool-mu-v03-dev harness=qm mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3 utility_models=anthropic:claude-haiku-5-5 config=pi reps=5 trials=40 turns=125 ceiling_usd=55 gbrain=starter/mcp/off brain=member scope=member ingest=live preamble=tasks/multiuser/_shared/preamble.gbrain-memory.md",
  "GBRAIN: cells qm-pi-opus-gbrain-route-tool-mu-v03-dev run with a gbrain sidecar per trial (image harness-eval/gbrain:dev unless --gbrain-image; starter/mcp/off: the 34-tool starter surface; MCP registration only; keyword-only, no model call; docs/gbrain-arm.md)",
  "WARN: HE-BUDGET-003 cost ceiling 110 exceeds the preregistered cap 25; cells past the cap stop incomplete in drop order",
].join('\n');

describe('the C4 draft cells (gate 3 and gate 8)', () => {
  test('all three load and plan; route-tool takes scope member-sources with live ingestion (HE-GBRAIN-003 on main)', () => {
    const plan = planOf([NONE, MEMORY_PROVIDER, ROUTE_TOOL], 'qm-c4-draft');
    const line = (id: string) => plan.split('\n').find((l) => l.startsWith(`CELL: ${id} `))!;
    expect(line(ROUTE_TOOL.id)).toContain('brain=member scope=member-sources ingest=live');
    expect(line(MEMORY_PROVIDER.id)).toContain('config=pi-memory-provider');
    expect(plan).toContain(`GBRAIN: cells ${MEMORY_PROVIDER.id} run with a gbrain sidecar per trial`);
    expect(plan).toContain(`GBRAIN: cells ${ROUTE_TOOL.id} run with a gbrain sidecar per trial`);
    const gbrainLines = plan.split('\n').filter((l) => l.startsWith('GBRAIN: '));
    expect(gbrainLines.find((l) => l.includes(MEMORY_PROVIDER.id))).toContain('no gbrain MCP server registered');
    expect(gbrainLines.find((l) => l.includes(MEMORY_PROVIDER.id))).not.toContain('MCP registration only');
    expect(gbrainLines.find((l) => l.includes(ROUTE_TOOL.id))).toContain('MCP registration only');
    const qm = plan.split('\n').filter((l) => l.startsWith('QM-PROVIDER: '));
    expect(qm).toHaveLength(1);
    expect(qm[0]).toContain(JSON.stringify(providerConfig('<world /gbrain tap, as core reaches it>')));
    expect(qm[0]).toContain('"max_chars_arg":"max_chars","max_chars":6000,"timeout_ms":10000,"actor_arg":"acting_user"');
  });

  test('live ingestion still needs the member token layer: scope sources or no scope is refused, member and member-sources load', () => {
    for (const scope of [undefined, 'sources'] as const) {
      expect(() => loadPrereg(writePrereg([{ ...ROUTE_TOOL, gbrain: { surface: 'starter', brain: 'member', ingest: 'live', ...(scope ? { scope } : {}) } }], `live-${scope ?? 'none'}`))).toThrow(/HE-GBRAIN-003 .*ingest "live" needs gbrain.scope "member" or "member-sources"/);
    }
    for (const scope of ['member', 'member-sources'] as const) expect(() => loadPrereg(writePrereg([{ ...ROUTE_TOOL, gbrain: { ...ROUTE_TOOL.gbrain!, scope } }], `live-ok-${scope}`))).not.toThrow();
  });

  test('config pi-memory-provider needs harness qm, a gbrain sidecar over MCP and docker mode', () => {
    expect(() => loadPrereg(writePrereg([{ ...MEMORY_PROVIDER, harness: 'openclaw' }], 'mp-openclaw'))).toThrow(/HE-PREREG-007 .*pi-memory-provider/);
    expect(() => loadPrereg(writePrereg([{ ...MEMORY_PROVIDER, gbrain: undefined }], 'mp-no-gbrain'))).toThrow(/HE-GBRAIN-001 .*carries no gbrain/);
    expect(() => loadPrereg(writePrereg([{ ...MEMORY_PROVIDER, harness_mode: 'process', adapter: 'x' }], 'mp-process'))).toThrow(/HE-GBRAIN-001 .*docker mode only/);
    expect(isQmMemoryProvider(MEMORY_PROVIDER)).toBe(true);
    for (const c of [NONE, ROUTE_TOOL, { ...MEMORY_PROVIDER, harness: 'hermes' }]) expect(isQmMemoryProvider(c)).toBe(false);
  });

  test('config pi-memory-provider is refused on the hello and smoke slices, which run single-shot with no provider wiring (HE-GBRAIN-001)', () => {
    for (const slice of ['hello', 'smoke'] as const) {
      expect(() => loadPrereg(writePrereg([{ ...MEMORY_PROVIDER, slice }], 'mp-' + slice))).toThrow(/HE-GBRAIN-001 .*pi-memory-provider.* multi-user trials only; slice /);
      expect(() => loadPrereg(writePrereg([{ ...NONE, slice }], 'none-' + slice))).not.toThrow();
    }
    expect(() => loadPrereg(writePrereg([MEMORY_PROVIDER], 'mp-multiuser'))).not.toThrow();
  });

  test('config pi-memory-provider with gbrain.access "rules" is refused until a preregistration asks for it (HE-GBRAIN-003)', () => {
    const rules = { ...MEMORY_PROVIDER, gbrain: { surface: 'starter', brain: 'member', scope: 'member', access: 'rules' } } as Cell;
    expect(() => loadPrereg(writePrereg([rules], 'mp-rules'))).toThrow(/HE-GBRAIN-003 .*pi-memory-provider.* with gbrain.access "rules" is untested/);
    expect(() => loadPrereg(writePrereg([{ ...rules, config: 'pi' }], 'pi-rules'))).not.toThrow();
  });

  test('run refuses --harness-mode process for a pi-memory-provider cell without live ingestion (HE-GBRAIN-001) before any trial starts', () => {
    const manifest = join(tmp, 'mp-process-manifest.json');
    const cell = { ...MEMORY_PROVIDER, gbrain: { surface: 'starter', brain: 'member', scope: 'member' } };
    writeFileSync(manifest, JSON.stringify({ schema_version: 1, run_id: 'mp-process', prereg_sha256: 'p'.repeat(64), created_at: '2026-10-31T00:00:00Z', cells: [cell, NONE], trials: [] }));
    const run = (...extra: string[]) => spawnSync('bun', ['runner/run.ts', 'run', '--manifest', manifest, '--harness-mode', 'process', ...extra], { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH!, HOME: process.env.HOME! } });
    const r = run();
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain('HE-GBRAIN-001 cells ' + MEMORY_PROVIDER.id + ' use config "pi-memory-provider", which runs in docker mode only');
    expect(run('--cells', NONE.id).stderr).not.toContain('HE-GBRAIN-001');
  });

  test('the dry run on the draft cells exits 0 with no paid call', () => {
    const r = spawnSync('bun', ['runner/run.ts', 'dry-run', '--prereg', writePrereg([NONE, MEMORY_PROVIDER, ROUTE_TOOL], 'qm-c4-dry')], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH!, HOME: process.env.HOME! } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('RUN: qm-c4-dry trials=120 cells=3');
    expect(r.stdout).toContain('QM-PROVIDER: cell qm-pi-opus-gbrain-memory-provider-mu-v03-dev');
  });
});

describe('pi-memory-provider wiring (gate 8)', () => {
  const url = 'http://host.docker.internal:8790/gbrain';

  test('MEMORY_PROVIDER_CONFIG is the draft\'s, byte for byte', () => {
    expect(JSON.stringify(providerConfig(url))).toBe(JSON.stringify(DRAFT_CONFIG));
  });

  test('a trial gets a fresh client pair for core only; the provider block lets the issuer accept it as the bot and the tap split callers', () => {
    const a = memoryProviderWiring({ mcpUrl: url, actor: 'helper-bot' });
    const b = memoryProviderWiring({ mcpUrl: url, actor: 'helper-bot' });
    expect(Object.keys(a.coreEnv)).toEqual(['MEMORY_PROVIDER_CONFIG', CLIENT_ID_ENV, CLIENT_SECRET_ENV]);
    expect(JSON.parse(a.coreEnv.MEMORY_PROVIDER_CONFIG!)).toEqual(DRAFT_CONFIG);
    expect(a.coreEnv[CLIENT_ID_ENV]).toBe(CLIENT_ID);
    expect(a.coreEnv[CLIENT_SECRET_ENV]).toMatch(/^[0-9a-f]{48}$/);
    expect(a.coreEnv[CLIENT_SECRET_ENV]).not.toBe(b.coreEnv[CLIENT_SECRET_ENV]);
    expect(a.coreEnv.MEMORY_PROVIDER_CONFIG).not.toContain(a.coreEnv[CLIENT_SECRET_ENV]!);
    expect(a.provider).toEqual({ clients: { [CLIENT_ID]: { secret: a.coreEnv[CLIENT_SECRET_ENV]!, member: 'helper-bot' } }, tokens: {}, actor: 'helper-bot', max_chars_arg: 'max_chars', max_chars: 6000, timeout_ms: 10000, actor_arg: 'acting_user' });
  });

  const sidecar = { url: 'http://127.0.0.1:41234', token: 'gbrain_trial', tokens: { schema_version: 1, brain: 'member', split: 'dev', members: { 'dana-okafor': 'gbrain_dana' }, public_only: 'gbrain_public' }, grants: { members: { 'dana-okafor': ['public', 'private-dana-okafor'] }, public: ['public'] }, ingest: { tokens: { schema_version: 1, brain: 'member', split: 'dev', sources: { public: 'gbrain_ingest_public' } }, map: { channels: { C1: 'public' }, dm_source_prefix: 'private-' } } } as unknown as Parameters<typeof gbrainUpstream>[0];

  test('the adapter gets no gbrain MCP variables, so adapter.sh registers no gbrain server; the upstream carries the provider block', () => {
    expect(gbrainHarnessEnv(sidecar, 'http://host.docker.internal:8790', 'xoxb-bot', true)).toEqual({});
    const w = memoryProviderWiring({ mcpUrl: url, actor: 'helper-bot', secret: 's3cret' });
    expect((gbrainUpstream(sidecar, w.provider) as { provider?: unknown }).provider).toBe(w.provider);
    const adapter = readFileSync(join(ROOT, 'harnesses/qm/adapter.sh'), 'utf8');
    expect(adapter.indexOf('config pi-memory-provider registers no gbrain MCP server')).toBeLessThan(adapter.indexOf('mcp-register "$QM_CORE_URL" "$QM_SIGNING_SECRET" "$QM_ADMIN_ACTOR" gbrain'));
  });

  test('the compose override hands core the provider variables by name only; no value reaches the file', () => {
    const w = memoryProviderWiring({ mcpUrl: url, actor: 'helper-bot', secret: 'never-in-a-file' });
    const text = composeOverride({ HE_TRIAL_ID: 't1' }, '/tmp/turns', w.coreEnv);
    expect(text).toContain('  core:\n    environment:\n      MEMORY_PROVIDER_CONFIG: ${MEMORY_PROVIDER_CONFIG}\n      QM_GBRAIN_READ_CLIENT_ID: ${QM_GBRAIN_READ_CLIENT_ID}\n      QM_GBRAIN_READ_CLIENT_SECRET: ${QM_GBRAIN_READ_CLIENT_SECRET}\n');
    expect(text).not.toContain('never-in-a-file');
    expect(text).not.toContain('recall');
    expect(text.slice(0, text.indexOf('  core:'))).not.toContain('QM_GBRAIN');
  });
});

describe('byte identity: QM none and route-tool build what main built', () => {
  test('the plan of the none cell and the told-live route-tool cell is main\'s', () => {
    expect(planOf([NONE, ROUTE_TOOL_MEMBER], 'qm-identity')).toBe(PLAN_AT_MAIN);
  });

  test('the compose override without coreEnv is main\'s template', () => {
    const env = { HE_TRIAL_ID: 't1', HE_GBRAIN_MCP_URL: 'http://host.docker.internal:8790/gbrain', HE_HARNESS_CONFIG: 'pi' };
    const main = `# Written by the runner for one multi-user trial: the task service serves turns instead of running once.\nservices:\n  task:\n    command: ["serve"]\n    environment:\n      HE_TRIAL_ID: "t1"\n      HE_GBRAIN_MCP_URL: "http://host.docker.internal:8790/gbrain"\n      HE_HARNESS_CONFIG: "pi"\n    volumes:\n      - /tmp/turns:/he-turns\n`;
    expect(composeOverride(env, '/tmp/turns')).toBe(main);
    expect(composeOverride(env, '/tmp/turns', {})).toBe(main);
  });

  test('the gbrain upstream and the adapter\'s gbrain variables for a route-tool cell are main\'s', () => {
    const sidecar = { url: 'http://127.0.0.1:41234', token: 'gbrain_trial', tokens: { members: { a: 'ta' }, public_only: 'tp', schema_version: 1 }, grants: { members: { a: ['public'] }, public: ['public'] }, ingest: { tokens: { sources: { public: 'ti' } }, map: { channels: { C1: 'public' }, dm_source_prefix: 'private-' } } } as unknown as Parameters<typeof gbrainUpstream>[0];
    expect(JSON.stringify(gbrainUpstream(sidecar))).toBe('{"url":"http://127.0.0.1:41234","token":"gbrain_trial","tokens":{"members":{"a":"ta"},"public_only":"tp"},"grants":{"members":{"a":["public"]},"public":["public"]},"ingest":{"tokens":{"public":"ti"},"channels":{"C1":"public"},"dm_source_prefix":"private-"}}');
    expect(JSON.stringify(gbrainUpstream({ url: 'u', token: 't', tokens: null, grants: null, ingest: null }))).toBe('{"url":"u","token":"t"}');
    expect(gbrainHarnessEnv(sidecar, 'http://host.docker.internal:8790', 'xoxb-bot', false)).toEqual({ HE_GBRAIN_MCP_URL: 'http://host.docker.internal:8790/gbrain', HE_GBRAIN_MCP_TOKEN: 'xoxb-bot' });
    expect(gbrainHarnessEnv(null, 'http://host.docker.internal:8790', 'xoxb-bot', false)).toEqual({});
  });
});

// prepare.sh: a stand-in docker answers the image label check; the socket's group is read, so the daemon's socket must exist.
const FAKE = mkdtempSync(join(tmpdir(), 'he-qm-mp-docker-'));
writeFileSync(join(FAKE, 'docker'), `#!/usr/bin/env bash\njq -r .commit "\${QM_PIN}"\n`);
chmodSync(join(FAKE, 'docker'), 0o755);
function prepare(config: string, extra: Record<string, string> = {}) {
  const env = { PATH: `${FAKE}:${process.env.PATH}`, HOME: tmp, QM_PIN: join(ROOT, 'harnesses/qm/pin.json'), QM_SIGNING_SECRET: 's', QM_CONNECTOR_SECRET_KEY: 'c', HE_HARNESS_CONFIG: config, ...extra };
  const r = spawnSync('bash', [join(ROOT, 'harnesses/qm/prepare.sh'), mkdtempSync(join(tmp, 'p-'))], { encoding: 'utf8', env });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('harnesses/qm/prepare.sh takes pi-memory-provider (gate 8a)', () => {
  test('without the runner\'s provider variables it exits 2 naming the first missing one, printing no value', () => {
    for (const [extra, missing] of [[{}, 'MEMORY_PROVIDER_CONFIG'], [{ MEMORY_PROVIDER_CONFIG: '{}' }, CLIENT_ID_ENV], [{ MEMORY_PROVIDER_CONFIG: '{}', [CLIENT_ID_ENV]: CLIENT_ID }, CLIENT_SECRET_ENV]] as const) {
      const r = prepare('pi-memory-provider', extra);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`needs ${missing} from the runner`);
      expect(r.stdout).toBe('');
    }
  });

  test.if(existsSync('/var/run/docker.sock'))('with them it maps like pi, keeps the secret out of its output, and pi itself is unchanged', () => {
    const r = prepare('pi-memory-provider', { MEMORY_PROVIDER_CONFIG: JSON.stringify(DRAFT_CONFIG), [CLIENT_ID_ENV]: CLIENT_ID, [CLIENT_SECRET_ENV]: 'top-secret-value' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('QM_HARNESS=pi\nQM_MEMORY_CAPTURE_QUIET_MS=180000\nQM_PROBE_CONFIG=\nHE_HARNESS_CONFIG=pi-memory-provider\n');
    expect(r.stdout).not.toContain('top-secret-value');
    const pi = prepare('pi');
    expect(pi.status).toBe(0);
    expect(pi.stdout.split('\n').slice(2).join('\n')).toBe(`QM_DOCKER_GID=${spawnSync('stat', ['-c', '%g', '/var/run/docker.sock'], { encoding: 'utf8' }).stdout.trim()}\nQM_HARNESS=pi\nQM_MEMORY_CAPTURE_QUIET_MS=180000\nQM_PROBE_CONFIG=\nHE_HARNESS_CONFIG=pi\n`);
  });
});

describe('write errors are counted and disclosed (member-source page writes fail until #161)', () => {
  const ev = (seq: number, tool: string, outcome: 'ok' | 'error', error?: string): WorldEvent => ({ seq, wall_ts: '', sim_ts: '', actor: 'helper-bot', via: 'gbrain', tool, kind: 'write', args_digest: '', args: {}, outcome, ...(error ? { error } : {}) } as unknown as WorldEvent);
  const events = [ev(1, 'gbrain.capture', 'error', 'storage_error'), ev(2, 'gbrain.put_page', 'error', 'storage_error'), ev(3, 'gbrain.remember', 'ok'), ev(4, 'gbrain.search', 'error', 'tool_error')];

  test('the trial record counts failed writes by code, and stays as it was when no write failed', () => {
    const g = gbrainSummary(resolveGbrain(ROUTE_TOOL.gbrain!), { image: 'i', ready_ms: 1 }, events, []);
    expect(g.events.writes).toBe(3);
    expect(g.events.write_errors).toEqual({ storage_error: 2 });
    expect('write_errors' in gbrainSummary(resolveGbrain(ROUTE_TOOL.gbrain!), { image: 'i', ready_ms: 1 }, [events[2]!, events[3]!], []).events).toBe(false);
  });

  test('summarize-run\'s gbrain usage carries them per cell', () => {
    const u = gbrainUsage([{ events, predicates: [] }]);
    expect(u.write_errors).toEqual({ storage_error: 2 });
    expect('write_errors' in gbrainUsage([{ events: [events[2]!], predicates: [] }])).toBe(false);
  });
});

test('the layer probe receipt has one row per layer and tool, named by which layers are on', () => {
  const n = { calls: 1, rows: 2, outside: 0, unattributed: 0, outside_seeded_facts: 0 };
  const tools = { search: n, query: n, recall: n, list_pages: n, 'recall (question)': n };
  const md = renderLayers({ image_id: 'sha256:x', brain: 'member', split: 'dev', members: 15, queries: ['a'], seeded: [{ member: 'm', source_id: 'private-m', ok: true }], layers: { both: tools, token: tools, sources: tools, neither: { ...tools, recall: { ...n, outside: 2, outside_seeded_facts: 1 } } }, examples: [] });
  const rows = md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Layers'));
  expect(rows).toHaveLength(20);
  expect(md).toContain('| unscoped token only | recall | 1 | 2 | 2 | 1 | 0 |');
  expect(md).toContain('| member token + source_ids | recall (question) |');
});

test('the layer probe pages list_pages to the end and fails closed when gbrain ignores the offset or never stops (R40, HE-GBRAIN-002)', async () => {
  const fail = (what: string) => new RunnerError('HE-GBRAIN-002', 'the member brain for dev in test-image ' + what);
  const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ slug: 'page-' + (from + i), source_id: 'public' }));
  const offsets: number[] = [];
  const paged = await listPagesToEnd(async (offset) => { offsets.push(offset); return offset < 200 ? rows(offset, 100) : rows(offset, 7); }, fail);
  expect(offsets).toEqual([0, 100, 200]);
  expect(paged.map((r) => r.slug)).toEqual(rows(0, 207).map((r) => r.slug));
  let calls = 0;
  await expect(listPagesToEnd(async () => { calls++; return rows(0, 100); }, fail)).rejects.toThrow(/^HE-GBRAIN-002 .*offset 100 with the same rows as at offset 0; gbrain ignored the offset/);
  expect(calls).toBe(2);
  calls = 0;
  await expect(listPagesToEnd(async () => rows(calls++ * 100, 100), fail)).rejects.toThrow(new RegExp('^HE-GBRAIN-002 .*after ' + LIST_PAGES_MAX_PAGES + ' pages'));
  expect(calls).toBe(LIST_PAGES_MAX_PAGES);
});
