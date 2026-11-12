#!/usr/bin/env bun
// Context footprint of the skill resolver (internal-task, docs/benchmarks/2026-11-08-skill-resolver/PREREGISTRATION.md: what the
// resolver costs in context at turns 1, 10 and 50). Keyless sessions: fake model endpoints, capture-mode proxy, dummy keys, no
// model provider reached.
//
//   bun scripts/skill-resolver/footprint.ts transcript --set <setp-dev.jsonl> --out <transcript.jsonl> [--turns 50]
//   bun scripts/skill-resolver/footprint.ts run --transcript <transcript.jsonl> --out <dir> [--cell <harness>=<provider:model> ...]
//       [--local] [--qm-image <tag>] [--catalog <manifest.json>]
//
// transcript: a fixed public transcript of set P dev rows, never set R. The rows are ordered by sha256("20261108\n" + id) and
// the first --turns with distinct texts are kept (a row repeating an earlier row's text is skipped, since turns are told apart
// by their text), so the same set file gives the same transcript on every machine. A file whose sha256 is set R's
// (SETS.md), or any row with prev_user_text (set R's shape) or a half other than dev, is refused.
//
// run: for each push harness (OpenClaw, Claude Code, Codex, Hermes) one serve-entry session per arm, native (skills-native:
// the resolver in shadow, nothing injected) and resolver-on (skills-resolver: the block pushed every member turn), on the
// image harness-eval/<harness>:skills-kit, one multi-user task whose turns are the transcript's texts as DMs from dana-okafor
// in the v0.1 world, so every turn lands in one session. The fake answers every request with a plain reply. In the captured
// requests, the agent request of turn t is the largest request that carries turn t's text and not turn t+1's. Tokens added by
// the resolver at turn t = tokens(resolver-on request t) - tokens(native request t), so the blocks still in the session's
// history count as well as the current one. Counting: Anthropic requests through the metering proxy's free count_tokens
// route (lease mode with the proxy's key; never priced or metered, and only these public set P dev texts are sent); OpenAI
// requests locally with o200k_base (gpt-tokenizer), since the proxy has no free OpenAI counting route; --local counts every
// request locally. Each cell records its method. From the resolver-on arm's status lines (logs/skill-resolver/status.ndjson,
// one per member turn): each turn's block_tokens (the resolver's own count), session_block_tokens, and the first turn whose
// budget_exhausted is true.
// QM: one-turn runs only (its skill arms run on the run entry; its serve entry cannot register the world MCP server at this
// pin): pi-skills-native vs pi-skills-push on transcript turn 1 through scripts/skill-resolver/phase-b-fake-run.ts with the QM
// arm image. Turns 10 and 50 are recorded as not applicable, with that reason.
//
// Writes <out>/footprint.json and <out>/footprint.md, and keeps each session's fake.ndjson and trial logs under <out>/<cell>/.
// Until internal-task's release is pinned the kit carries the stand-in resolver (scripts/skill-resolver/gbrain-stub.ts), so the
// figures are the stand-in's; footprint.json records the gbrain_version the status lines report.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import type { GradeResult } from '../../runner/contracts.ts';
import { buildManifest, loadPrereg } from '../../runner/run.ts';
import { CAPTURE_DUMMY_KEYS } from '../../runner/trial/capture.ts';
import { executeRun } from '../../runner/trial/run.ts';
import { LOCAL_TOKENIZER, startProxy } from '../anatomy/count-tokens.ts';

const ROOT = resolve(import.meta.dir, '../..');
const ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
export const TURNS_REPORTED = [1, 10, 50] as const;
export const TRANSCRIPT_SEED = '20261108';
/** setR.jsonl's sha256 (docs/benchmarks/2026-11-08-skill-resolver/SETS.md). */
export const SET_R_SHA256 = '38664f325d701117700e351851320fe208ded5903f78c3c50affbad8193a0508';
export const ACTOR = 'dana-okafor';
export const DEFAULT_CELLS = ['openclaw=anthropic:claude-opus-5-5', 'claude-code=anthropic:claude-opus-5-5', 'codex=openai:gpt-6.1-sol', 'hermes=anthropic:claude-opus-5-5', 'qm=anthropic:claude-opus-5-5'];
export const QM_NOT_APPLICABLE = 'QM runs one request per trial on its run entry (its serve entry cannot register the world MCP server at this pin), so it has no multi-turn session';
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

export type TranscriptTurn = { turn: number; id: string; text: string };

/** The transcript: set P dev rows in a seeded order, the first n kept. Refuses set R and any row that is not a dev row. */
export function buildTranscript(setFile: string, n = 50): TranscriptTurn[] {
  const raw = readFileSync(setFile);
  if (sha256(raw) === SET_R_SHA256) throw new Error('refused: this is set R (its sha256 is in SETS.md); the footprint transcript is built from set P dev rows only');
  const rows = raw.toString('utf8').split('\n').filter(Boolean).map((l, i) => {
    const r = JSON.parse(l) as { id?: unknown; request?: unknown; text?: unknown; prev_user_text?: unknown; half?: unknown };
    if (r.prev_user_text !== undefined && r.prev_user_text !== null) throw new Error('refused: line ' + (i + 1) + ' has prev_user_text, set R\'s shape; the transcript is built from set P dev rows only');
    if (r.half !== 'dev') throw new Error('refused: line ' + (i + 1) + ' (id ' + String(r.id) + ') is not a dev row (half ' + JSON.stringify(r.half) + '); the test half stays held out');
    const text = typeof r.request === 'string' ? r.request : typeof r.text === 'string' ? r.text : '';
    if (typeof r.id !== 'string' || !text) throw new Error('line ' + (i + 1) + ': a row needs id and request');
    return { id: r.id, text };
  });
  const seen = new Set<string>();
  const kept = rows.map((r) => ({ ...r, key: sha256(TRANSCRIPT_SEED + '\n' + r.id) })).sort((a, b) => (a.key < b.key ? -1 : 1))
    .filter((r) => !seen.has(r.text) && !!seen.add(r.text)).slice(0, n);
  if (kept.length < n) throw new Error('the set has ' + kept.length + ' dev rows with distinct texts; the transcript needs ' + n);
  return kept.map((r, i) => ({ turn: i + 1, id: r.id, text: r.text }));
}

export function readTranscript(file: string): TranscriptTurn[] {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TranscriptTurn);
}

/** The session's multi-user task: one DM per transcript turn, no predicates. */
export function writeSessionTask(turns: TranscriptTurn[], dir: string, timeBudgetS = 180): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'task.toml'), ['id = "footprint-' + turns.length + '"', 'slice = "multiuser"', 'split = "dev"', 'time_budget_s = ' + timeBudgetS, 'actors = ["' + ACTOR + '"]', '',
    ...turns.flatMap((t) => ['[[turns]]', 'actor = "' + ACTOR + '"', 'channel = "dm"', 'text = ' + JSON.stringify(t.text), '']), '[predicates]', 'required = []', 'forbidden_effects = []', ''].join('\n'));
}

export type LogRow = { method?: string; path?: string; body?: Record<string, unknown> };
export const readLog = (file: string): LogRow[] => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LogRow) : [];

/** For each turn, the index of its agent request in the captured log: the largest request whose body carries the turn's text
 *  and not the next turn's (a title or summary call may carry the text too, but not the system prompt and tools). A text is
 *  looked for as the runner's preamble sets the member's message, between blank lines, so a short text such as "ok" is not
 *  found inside other words or in the fake's own replies; with no preamble (QM's run entry) the bare text is looked for. */
export function turnRequests(rows: LogRow[], texts: string[]): Array<number | null> {
  const bodies = rows.map((r) => (r.method === 'POST' && r.body ? JSON.stringify(r.body) : ''));
  const framed = (s: string) => JSON.stringify('\n\n' + s + '\n\n').slice(1, -1);
  const bare = (s: string) => JSON.stringify(s).slice(1, -1);
  const find = (needle: (s: string) => string, t: string, next: string | undefined) => {
    let best: number | null = null;
    bodies.forEach((b, j) => {
      if (!b.includes(needle(t)) || (next !== undefined && b.includes(needle(next)))) return;
      if (best === null || b.length > bodies[best]!.length) best = j;
    });
    return best;
  };
  return texts.map((t, i) => find(framed, t, texts[i + 1]) ?? find(bare, t, texts[i + 1]));
}

/** The fields a provider counts: Anthropic Messages (model, system, tools, tool_choice, messages as role and content) or
 *  OpenAI Responses (instructions, input, tools). */
export function countedBody(body: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(body.input) || typeof body.instructions === 'string') return Object.fromEntries(['instructions', 'input', 'tools'].filter((k) => k in body).map((k) => [k, body[k]]));
  const messages = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>).map(({ role, content }) => ({ role, content })) : [];
  return { ...Object.fromEntries(['model', 'system', 'tools', 'tool_choice'].filter((k) => k in body).map((k) => [k, body[k]])), messages };
}

export const countLocal = (body: Record<string, unknown>): number => countTokens(JSON.stringify(countedBody(body)), { disallowedSpecial: new Set() });

export type Status = { budget_exhausted?: boolean | null; block_tokens?: number | null; session_block_tokens?: number | null; budget_phase?: string | null; gbrain_version?: string | null };
export const readStatus = (file: string): Status[] => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Status) : [];
/** The first turn (1-based, one status line per member turn) whose budget_exhausted is true, or null. */
export function firstExhausted(lines: Status[]): number | null {
  const i = lines.findIndex((l) => l.budget_exhausted === true);
  return i < 0 ? null : i + 1;
}

export type ArmCounts = { requests: Array<number | null>; tokens: Array<number | null> };
/** Per reported turn: native and resolver-on request tokens and their difference (null when a turn's request is missing). */
export function addedAt(native: ArmCounts, resolverOn: ArmCounts, turns: readonly number[] = TURNS_REPORTED): Record<string, { native: number | null; resolver_on: number | null; added: number | null }> {
  return Object.fromEntries(turns.map((t) => {
    const n = native.tokens[t - 1] ?? null, r = resolverOn.tokens[t - 1] ?? null;
    return [String(t), { native: n, resolver_on: r, added: n === null || r === null ? null : r - n }];
  }));
}

async function waitFor(ok: () => boolean, ms: number, what: string) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (ok()) return; await Bun.sleep(200); }
  throw new Error('timed out waiting for ' + what);
}

/** A fake model endpoint that answers every request with a plain reply (an empty script). */
async function startFake(provider: 'anthropic' | 'openai', dir: string, maxRequests: number) {
  writeFileSync(join(dir, 'script.json'), '[]');
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port as number;
  probe.stop(true);
  const out = openSync(join(dir, 'fake.out'), 'a');
  const proc = spawn(process.execPath, [join(ROOT, provider === 'anthropic' ? 'scripts/gsta-135/fake-anthropic.ts' : 'tests/fixtures/fake-responses.ts'), '--host', '127.0.0.1', '--port', String(port),
    '--log', join(dir, 'fake.ndjson'), '--script', join(dir, 'script.json'), '--require-key-prefix', CAPTURE_DUMMY_KEYS[provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'],
    '--max-requests', String(maxRequests), '--max-seconds', '10800'], { env: ENV, stdio: ['ignore', out, out] });
  await waitFor(() => readFileSync(join(dir, 'fake.out'), 'utf8').includes('listening'), 20_000, 'the fake model endpoint');
  return { port, stop: () => proc.kill('SIGTERM') };
}

/** One serve-entry session of the transcript on a push harness, one arm. */
async function pushSession(o: { harness: string; model: string; config: string; arm: string; turns: TranscriptTurn[]; dir: string; image: string }) {
  const provider = o.model.slice(0, o.model.indexOf(':')) as 'anthropic' | 'openai';
  rmSync(o.dir, { recursive: true, force: true });
  mkdirSync(o.dir, { recursive: true });
  const tasksRoot = join(o.dir, 'tasks');
  const taskId = 'footprint-' + o.turns.length;
  writeSessionTask(o.turns, join(tasksRoot, 'multiuser', 'dev', taskId));
  const fake = await startFake(provider, o.dir, 40 * o.turns.length);
  try {
    const runId = ('anatomy-capture-footprint-' + o.harness + '-' + o.arm + '-' + Date.now().toString(36)).toLowerCase();
    const cell = { id: o.harness + '-' + o.arm, harness: o.harness, model: o.model, slice: 'multiuser', split: 'dev', config: o.config, tasks: [taskId], repetitions: 1,
      ceiling: { input_tokens: 200_000, output_tokens: 4_000 }, ...(o.harness === 'codex' ? { network: 'internal' } : {}) };
    writeFileSync(join(o.dir, 'prereg.json'), JSON.stringify({ schema_version: 1, run_id: runId, question: 'internal-task resolver context footprint: uncounted and keyless, against a fake model endpoint', tasks: {}, cells: [cell], wall_clock_s: { multiuser: 3 * 3600 }, spend_cap_usd: 50, drop_order: [], minimum_v01: [] }, null, 1));
    const { prereg, sha256: preregSha } = loadPrereg(join(o.dir, 'prereg.json'));
    const runDir = join(o.dir, 'run');
    mkdirSync(runDir, { recursive: true });
    const manifestPath = join(runDir, 'manifest.json');
    const manifest = buildManifest(prereg, preregSha, new Date().toISOString(), { tasksRoot });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
    const grade = (): GradeResult => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] });
    const result = await executeRun(manifest, manifestPath, { harnessMode: 'docker', image: o.image, grade, proxyEnv: ENV, repoRoot: ROOT, leaseUsd: 50, newLease: true, maxOutputTokens: 128_000,
      capture: { upstream: { [provider]: 'http://127.0.0.1:' + fake.port }, dns: null }, log: (l) => writeFileSync(join(o.dir, 'progress.log'), l + '\n', { flag: 'a' }) });
    const record = result.records[0]!;
    return { record, log: readLog(join(o.dir, 'fake.ndjson')), status: readStatus(join(record.paths.dir, 'logs', 'skill-resolver', 'status.ndjson')) };
  } finally { fake.stop(); }
}

/** QM's one-turn run (run entry) of transcript turn 1, one arm, through the Phase B fake driver. */
function qmTurnOne(o: { model: string; config: string; arm: string; turn: TranscriptTurn; dir: string; image: string; catalog: string }) {
  rmSync(o.dir, { recursive: true, force: true });
  mkdirSync(o.dir, { recursive: true });
  writeFileSync(join(o.dir, 'set.jsonl'), JSON.stringify({ id: o.turn.id, request: o.turn.text, half: 'dev' }) + '\n');
  const run = spawnSync(process.execPath, ['scripts/skill-resolver/phase-b-fake-run.ts', '--harness', 'qm', '--model', o.model, '--kind', 'none', '--skill', 'none', '--catalog', o.catalog,
    '--set', join(o.dir, 'set.jsonl'), '--request', o.turn.id, '--out', join(o.dir, 'runs'), '--config', o.config, '--arm', o.arm, '--image', o.image], { cwd: ROOT, env: ENV, encoding: 'utf8', timeout: 1_800_000 });
  writeFileSync(join(o.dir, 'driver.log'), (run.stdout ?? '') + (run.stderr ?? ''));
  const runs = join(o.dir, 'runs');
  const caseDir = existsSync(runs) ? readdirSync(runs).map((d) => join(runs, d)).find((d) => existsSync(join(d, 'fake.ndjson'))) : undefined;
  if (!caseDir) throw new Error('qm ' + o.arm + ': no fake.ndjson; see ' + join(o.dir, 'driver.log'));
  const statusFile = spawnSync('find', [caseDir, '-name', 'status.ndjson'], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean)[0];
  return { log: readLog(join(caseDir, 'fake.ndjson')), status: statusFile ? readStatus(statusFile) : [], line: (run.stdout ?? '').trim().split('\n').filter((l) => l.startsWith('PHASEB_FAKE')).at(-1) ?? '' };
}

async function counter(local: boolean, provider: string, work: string) {
  if (local || provider !== 'anthropic') return { method: 'local', tokenizer: LOCAL_TOKENIZER, count: async (b: Record<string, unknown>) => countLocal(b), stop: () => {} };
  const proxy = await startProxy(work);
  return { method: 'count_tokens', tokenizer: 'anthropic count_tokens (free, through the metering proxy in lease mode)', count: (b: Record<string, unknown>) => proxy.count(countedBody(b)), stop: proxy.stop };
}

async function countArm(log: LogRow[], texts: string[], count: (b: Record<string, unknown>) => Promise<number>): Promise<ArmCounts> {
  const requests = turnRequests(log, texts);
  const tokens: Array<number | null> = [];
  for (const i of requests) tokens.push(i === null ? null : await count(log[i]!.body!));
  return { requests, tokens };
}

// deno-lint-ignore no-explicit-any
export function renderTable(cells: Array<Record<string, any>>): string {
  const at = (c: Record<string, any>, t: string) => c.turns[t]?.added ?? (c.turns[t]?.not_applicable ? 'n/a' : '-');
  const lines = ['| Harness | Model | Entry | Counting | Added at turn 1 | Turn 10 | Turn 50 | First turn with budget_exhausted |', '|---|---|---|---|---|---|---|---|'];
  for (const c of cells) lines.push('| ' + [c.harness, c.model, c.entry, c.method, at(c, '1'), at(c, '10'), at(c, '50'), c.budget_exhausted_first_turn ?? (c.entry === 'run' ? 'n/a' : 'none in ' + (c.status_lines?.resolver_on ?? 0) + ' turns')].join(' | ') + ' |');
  return lines.join('\n');
}

async function runAll(o: { transcript: string; out: string; cells: string[]; local: boolean; qmImage: string; catalog: string }) {
  const turns = readTranscript(o.transcript);
  const texts = turns.map((t) => t.text);
  mkdirSync(o.out, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'footprint-count-'));
  const results: Array<Record<string, any>> = [];
  for (const spec of o.cells) {
    const harness = spec.slice(0, spec.indexOf('=')), model = spec.slice(spec.indexOf('=') + 1);
    const provider = model.slice(0, model.indexOf(':'));
    const dir = join(o.out, harness + '-' + provider);
    const c = await counter(o.local, provider, work);
    try {
      if (harness === 'qm') {
        const native = qmTurnOne({ model, config: 'pi-skills-native', arm: 'native', turn: turns[0]!, dir: join(dir, 'native'), image: o.qmImage, catalog: o.catalog });
        const push = qmTurnOne({ model, config: 'pi-skills-push', arm: 'resolver-on', turn: turns[0]!, dir: join(dir, 'resolver-on'), image: o.qmImage, catalog: o.catalog });
        const n = await countArm(native.log, texts.slice(0, 1), c.count), r = await countArm(push.log, texts.slice(0, 1), c.count);
        results.push({ harness, model, entry: 'run', configs: ['pi-skills-native', 'pi-skills-push'], method: c.method, tokenizer: c.tokenizer,
          turns: { '1': addedAt(n, r, [1])['1'], '10': { not_applicable: QM_NOT_APPLICABLE }, '50': { not_applicable: QM_NOT_APPLICABLE } },
          block_tokens: { '1': push.status[0]?.block_tokens ?? null }, budget_exhausted_first_turn: null, budget_note: QM_NOT_APPLICABLE, gbrain_version: push.status[0]?.gbrain_version ?? null, driver: [native.line, push.line] });
        continue;
      }
      const image = 'harness-eval/' + harness + ':skills-kit';
      const native = await pushSession({ harness, model, config: 'skills-native', arm: 'native', turns, dir: join(dir, 'native'), image });
      const resolverOn = await pushSession({ harness, model, config: 'skills-resolver', arm: 'resolver-on', turns, dir: join(dir, 'resolver-on'), image });
      const n = await countArm(native.log, texts, c.count), r = await countArm(resolverOn.log, texts, c.count);
      const line = (s: Status[], t: number) => s[t - 1] ?? null;
      results.push({ harness, model, entry: 'serve', configs: ['skills-native', 'skills-resolver'], method: c.method, tokenizer: c.tokenizer, turns: addedAt(n, r),
        block_tokens: Object.fromEntries(TURNS_REPORTED.map((t) => [String(t), line(resolverOn.status, t)?.block_tokens ?? null])),
        session_block_tokens: Object.fromEntries(TURNS_REPORTED.map((t) => [String(t), line(resolverOn.status, t)?.session_block_tokens ?? null])),
        budget_exhausted_first_turn: firstExhausted(resolverOn.status), status_lines: { native: native.status.length, resolver_on: resolverOn.status.length },
        turns_found: { native: n.requests.filter((x) => x !== null).length, resolver_on: r.requests.filter((x) => x !== null).length },
        terminations: { native: native.record.termination, resolver_on: resolverOn.record.termination }, gbrain_version: resolverOn.status[0]?.gbrain_version ?? null,
        per_turn: { native: n.tokens, resolver_on: r.tokens } });
    } finally { c.stop(); }
  }
  const out = { schema_version: 1, transcript: { path: o.transcript, sha256: sha256(readFileSync(o.transcript)), turns: turns.length, seed: TRANSCRIPT_SEED }, turns_reported: TURNS_REPORTED, cells: results,
    note: 'tokens added = tokens of the resolver-on agent request minus the native one at the same turn of the same transcript, so blocks still in the session history count. block_tokens is the resolver\'s own count of that turn\'s block.' };
  writeFileSync(join(o.out, 'footprint.json'), JSON.stringify(out, null, 1) + '\n');
  writeFileSync(join(o.out, 'footprint.md'), '# Resolver context footprint (keyless)\n\nTranscript ' + out.transcript.sha256.slice(0, 12) + ' (' + turns.length + ' set P dev turns). Tokens the resolver adds to the agent request at turns 1, 10 and 50: resolver-on minus native.\n\n' + renderTable(results) + '\n\nQM: ' + QM_NOT_APPLICABLE + '.\n');
  return out;
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string, d?: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const all = (k: string) => a.flatMap((x, i) => (x === k && a[i + 1] ? [a[i + 1]!] : []));
  if (a[0] === 'transcript') {
    const set = v('--set'), out = v('--out');
    if (!set || !out) { console.error('usage: footprint.ts transcript --set <setp-dev.jsonl> --out <transcript.jsonl> [--turns 50]'); process.exit(2); }
    const t = buildTranscript(set, Number(v('--turns', '50')));
    writeFileSync(out, t.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log('TRANSCRIPT ' + out + ' turns=' + t.length + ' sha256=' + sha256(readFileSync(out)) + ' first=' + t[0]!.id);
  } else if (a[0] === 'run') {
    const transcript = v('--transcript'), out = v('--out');
    if (!transcript || !out) { console.error('usage: footprint.ts run --transcript <file> --out <dir> [--cell <harness>=<provider:model> ...] [--local] [--qm-image <tag>] [--catalog <manifest.json>]'); process.exit(2); }
    const r = await runAll({ transcript: resolve(transcript), out: resolve(out), cells: all('--cell').length ? all('--cell') : DEFAULT_CELLS, local: a.includes('--local'),
      qmImage: v('--qm-image', 'harness-eval/qm:harn52-arm-catalog')!, catalog: resolve(v('--catalog', join(process.env.HOME ?? '', '.capy/work/internal-task/catalog/manifest.json'))!) });
    console.log(renderTable(r.cells));
    console.log('FOOTPRINT_OK ' + join(resolve(out), 'footprint.json'));
  } else { console.error('usage: footprint.ts transcript|run ...'); process.exit(2); }
}
