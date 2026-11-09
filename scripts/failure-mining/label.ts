#!/usr/bin/env bun
// The layer-2 labeller (internal-task, failure mining): one record per failed-trial packet, from one model, against a codebook.
//
//   bun scripts/failure-mining/label.ts --packets <packets.jsonl> --codebook <codebook.json> --model <provider:model>
//       --out <dir>/labels.jsonl --run-id <id> --lease-usd <n> (--preregistration <path> | --allow-unregistered-smoke)
//       [--instructions <file>] [--cache-dir <dir>] [--proxy-dir <dir>] [--ledger <file>] [--trial <id>]... [--limit <n>]
//       [--concurrency 4] [--retry-failed]
//
// Each packet goes to the model as one structured call (scripts/failure-mining/llm.ts): the fixed prefix (instructions
// and the rendered codebook, cached at the provider), the packet's JSON, a closing line. The reply must carry exactly one
// record: {trial_id, root_cause, first_wrong_step {turn, seq, kind}, stage, brain_role, gstack_role, evidence_quotes (1 to 3),
// confidence, note}. Packets may be multi-user packets (packet.ts) or Claude Code SDK packets (sdk-packet.ts, kind sdk). A reply without a schema-valid record is asked again once, with the problems named, then recorded as failed. A
// valid record that fails the mechanical checks of check-labels.ts (seq, turn, quotes, class id) is also asked again once
// with the failed checks named; the second record is kept if it is valid, else the first, and the check result is stored
// beside it.
//
// labels.jsonl is appended one line per trial as each finishes, so a cap stop or a crash loses at most the items in
// flight. A rerun skips every trial id already in the file (the latest line per id counts; a line a crash cut short is
// ignored), and refuses to start if any line in the file was made by a different model, codebook_sha256 or
// prefix_sha256, so one file always holds one labeller. --retry-failed asks the model again for trials whose latest line
// is a failure: those calls skip the record cache, so a cached failure is never replayed.
//
// HTTP errors: a 429 or 5xx is retried after 2, 4, 8, 16 and 32 seconds; if it still fails, or on any other 4xx (not
// transient, never retried), the trial is recorded as failed with the status named. After 10 such transport failures in
// a row (a success resets the count) the run stops with exit 4 and writes nothing for the items in flight. A 402 from
// the proxy (the lease is spent) stops the run with exit 3 and writes nothing for the items in flight.
//
// Preregistration gate: before the first request that is not a cache hit, runner/prereg/prereg.ts attestPreregistration
// must pass for --preregistration (committed, clean, on origin), and its attestation is written to attestation.json beside
// labels.jsonl. --allow-unregistered-smoke skips attestation, only for a --run-id ending in -smoke with --lease-usd of at
// most 3, and writes an uncounted marker there instead. A paid run (no injected transport) refuses to start with neither.
// A rerun under a different preregistration commit, or a smoke rerun into a registered run's folder, is refused.

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { attestPreregistration, type Attestation } from '../../runner/prereg/prereg.ts';
import { packetText } from './packet.ts';
import { BRAIN_ROLES, CONFIDENCE, GSTACK_ROLES, STAGES, STEP_KINDS, checkRecord, loadCodebook, packetStrings, readAnyPackets, readLabels, type AnyPacket, type Codebook, type LabelLine, type LabelRecord } from './check-labels.ts';
import { LlmError, MODELS, createLlm, type Llm, type LlmStats, type ModelId, type ProxyOptions, type Transport } from './llm.ts';

const REPO_ROOT = resolve(import.meta.dir, '..', '..');
export const SMOKE_MAX_LEASE_USD = 3;
export const BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 32_000] as const;
export const MAX_CONSECUTIVE_TRANSPORT_FAILURES = 10;
export const EXIT = { budget: 3, transport: 4 } as const;
class TransportStop extends Error {}
export const TOOL = { name: 'record_label', description: 'Record the one layer-2 label for this failed trial.' };

export const DEFAULT_INSTRUCTIONS = [
  'You label why an AI workspace bot failed one task in a simulated company Slack. Each message gives you one packet: the task, each turn a member wrote (actor, channel, text) with the bot\'s reply, every world event in seq order (who acted, in which turn, the tool, its outcome, trimmed arguments and effect), the predicates the grader failed with its evidence, a rule-based first-pass label (layer1) with the facts it was read from, and how often the bot used its gbrain memory tools (gbrain, null when the trial had no brain).',
  'Events with bot true are the bot\'s own; the one marked reply is the reply the runner posted for that turn. An event\'s turn is the turn whose request it followed. The bot\'s private reasoning is not in the packet, so judge from what it did and said.',
  'A packet with kind "sdk" is instead one Claude Code coding session: the task prompt, the arm (gstack, none or placebo), and the session as numbered steps (the agent\'s text, each tool call with its trimmed input and result and whether the result was an error, and the final result). Steps marked skill_call, gstack_skill_md_read or gstack_bin are where the agent used gstack. gstack is null when the session had no gstack. For an sdk packet, first_wrong_step.seq is the step number and turn is null.',
  'Return exactly one record:',
  '- trial_id: the packet\'s trial_id, copied exactly.',
  '- root_cause: the id of the one codebook class that best explains the failure, judged by its definition, include and exclude rules; "other" only when no class fits, and then say why in the note.',
  '- first_wrong_step: the earliest point where the bot went wrong. kind "action" for a wrong tool call and "reply" for a wrong reply: give its turn and seq, and the seq must be a bot event in that turn. kind "no_action" when the error is something the bot failed to do: give the turn where it should have acted and seq null.',
  '- stage: where in its work the bot went wrong: understand (misread the request or the policy), retrieve (did not find or read the right source), decide (had what it needed and chose wrongly), act (a wrong or malformed write or tool call), reply (said the wrong thing after doing the right work).',
  '- brain_role: absent (no gbrain in this trial), not_called (gbrain was there and the bot never called it), called_no_help (called, returned nothing useful), called_wrong_content (returned wrong or stale content), called_ignored (returned the right content and the bot did not use it), called_helped_partly (helped with part of the task).',
  '- gstack_role: absent (the packet shows no gstack: always for a multi-user packet, and for an sdk packet whose gstack is null), not_loaded (gstack was installed and the agent never loaded or used it), loaded_not_followed (it loaded a gstack skill and did not follow its steps), followed_partly (it followed some of the skill\'s steps), followed (it followed the skill and still failed).',
  '- evidence_quotes: 1 to 3 short strings, each copied character for character from one string in the packet (a reply, a turn text, an argument, the grader\'s evidence), under 200 characters, that show the failure.',
  '- confidence: low, medium or high.',
  '- note: one plain sentence on what went wrong.',
].join('\n');

export function renderPrefix(instructions: string, cb: Codebook): string {
  const classes = cb.classes.map((c) => `### ${c.id}: ${c.name}\nDefinition: ${c.definition}\nInclude: ${c.include}\nExclude: ${c.exclude}`).join('\n\n');
  return `${instructions.trim()}\n\n## Codebook${cb.version ? ` (version ${cb.version})` : ''}\n\n${classes}\n\n### other\nNo class fits. Say why in the note.\n`;
}

export function recordSchema(cb: Codebook): Record<string, unknown> {
  const str = (e: readonly string[]) => ({ type: 'string', enum: [...e] });
  const intOrNull = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
  return {
    type: 'object', additionalProperties: false,
    required: ['trial_id', 'root_cause', 'first_wrong_step', 'stage', 'brain_role', 'gstack_role', 'evidence_quotes', 'confidence', 'note'],
    properties: {
      trial_id: { type: 'string' },
      root_cause: str([...cb.classes.map((c) => c.id), 'other']),
      first_wrong_step: { type: 'object', additionalProperties: false, required: ['turn', 'seq', 'kind'], properties: { turn: intOrNull, seq: intOrNull, kind: str(STEP_KINDS) } },
      stage: str(STAGES),
      brain_role: str(BRAIN_ROLES),
      gstack_role: str(GSTACK_ROLES),
      evidence_quotes: { type: 'array', items: { type: 'string' }, minItems: 1 },
      confidence: str(CONFIDENCE),
      note: { type: 'string' },
    },
  };
}

/** Schema checks the model's structured output may not have enforced (Particle's tool is not strict; quote counts). */
export function validateRecord(v: unknown, cb: Codebook, trialId: string): { record: LabelRecord | null; problems: string[] } {
  const p: string[] = [];
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { record: null, problems: ['the record is not an object'] };
  const r = v as Record<string, unknown>;
  const keys = ['trial_id', 'root_cause', 'first_wrong_step', 'stage', 'brain_role', 'gstack_role', 'evidence_quotes', 'confidence', 'note'];
  for (const k of keys) if (!(k in r)) p.push(`missing ${k}`);
  for (const k of Object.keys(r)) if (!keys.includes(k)) p.push(`unexpected field ${k}`);
  if (r.trial_id !== trialId) p.push('trial_id must be the packet\'s trial_id');
  if (!(r.root_cause === 'other' || cb.classes.some((c) => c.id === r.root_cause))) p.push('root_cause must be a codebook id or "other"');
  const s = r.first_wrong_step as Record<string, unknown> | undefined;
  const intOrNull = (x: unknown) => x === null || (typeof x === 'number' && Number.isInteger(x));
  if (!s || typeof s !== 'object' || Array.isArray(s)) p.push('first_wrong_step must be an object');
  else {
    if (Object.keys(s).some((k) => !['turn', 'seq', 'kind'].includes(k)) || !('turn' in s) || !('seq' in s) || !('kind' in s)) p.push('first_wrong_step must have exactly turn, seq and kind');
    if (!intOrNull(s.turn)) p.push('first_wrong_step.turn must be an integer or null');
    if (!intOrNull(s.seq)) p.push('first_wrong_step.seq must be an integer or null');
    if (!(STEP_KINDS as readonly unknown[]).includes(s.kind)) p.push(`first_wrong_step.kind must be one of ${STEP_KINDS.join(', ')}`);
  }
  if (!(STAGES as readonly unknown[]).includes(r.stage)) p.push(`stage must be one of ${STAGES.join(', ')}`);
  if (!(BRAIN_ROLES as readonly unknown[]).includes(r.brain_role)) p.push(`brain_role must be one of ${BRAIN_ROLES.join(', ')}`);
  if (!(GSTACK_ROLES as readonly unknown[]).includes(r.gstack_role)) p.push(`gstack_role must be one of ${GSTACK_ROLES.join(', ')}`);
  const q = r.evidence_quotes;
  if (!Array.isArray(q) || q.length < 1 || q.length > 3 || q.some((x) => typeof x !== 'string' || !x.trim())) p.push('evidence_quotes must be 1 to 3 non-empty strings');
  if (!(CONFIDENCE as readonly unknown[]).includes(r.confidence)) p.push(`confidence must be one of ${CONFIDENCE.join(', ')}`);
  if (typeof r.note !== 'string' || !r.note.trim()) p.push('note must be a non-empty sentence');
  if (p.length) return { record: null, problems: p };
  return { record: { trial_id: trialId, root_cause: r.root_cause as string, first_wrong_step: { turn: s!.turn as number | null, seq: s!.seq as number | null, kind: s!.kind as LabelRecord['first_wrong_step']['kind'] }, stage: r.stage as LabelRecord['stage'], brain_role: r.brain_role as LabelRecord['brain_role'], gstack_role: r.gstack_role as LabelRecord['gstack_role'], evidence_quotes: q as string[], confidence: r.confidence as LabelRecord['confidence'], note: r.note as string }, problems: [] };
}

export type Gate = { preregistration: string } | { smoke: true } | null;
export type AttestationFile = (Attestation & { earlier_runner_commits?: string[] }) | { uncounted: true; reason: string; run_id: string; lease_usd: number; attested_at: string };

export interface LabelOptions {
  packets: AnyPacket[];
  codebookPath: string;
  model: ModelId;
  /** labels.jsonl; attestation.json is written beside it. */
  out: string;
  runId: string;
  leaseUsd: number;
  cacheDir?: string;
  instructions?: string;
  transport?: Transport;
  proxy?: Omit<ProxyOptions, 'leaseUsd' | 'runId'>;
  preregistration?: string;
  allowUnregisteredSmoke?: boolean;
  /** The checkout attestPreregistration reads; defaults to the repository root. */
  cwd?: string;
  retryFailed?: boolean;
  concurrency?: number;
  /** The backoff wait; tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
}

export interface LabelSummary { packets: number; skipped: number; asked: number; ok: number; failed: number; verified: number; stopped: 'budget' | 'transport' | null; malformed_lines: number; stats: LlmStats }

/** Every parsed line of a labels file, older lines for a trial included; a line a crash cut short is skipped. */
function allLines(path: string): LabelLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').flatMap((l) => { try { const x = JSON.parse(l) as LabelLine; return x && typeof x.trial_id === 'string' ? [x] : []; } catch { return []; } });
}

/** Refuse to append to a labels file holding lines from another model, codebook or prefix. */
export function assertSameLabeller(path: string, want: { model: string; codebook_sha256: string; prefix_sha256: string }): void {
  const other = allLines(path).filter((l) => l.model !== want.model || l.codebook_sha256 !== want.codebook_sha256 || l.prefix_sha256 !== want.prefix_sha256);
  if (!other.length) return;
  const l = other[0]!;
  const diff = [l.model !== want.model ? `model ${l.model}, not ${want.model}` : '', l.codebook_sha256 !== want.codebook_sha256 ? `codebook_sha256 ${String(l.codebook_sha256).slice(0, 12)}, not ${want.codebook_sha256.slice(0, 12)}` : '', l.prefix_sha256 !== want.prefix_sha256 ? `prefix_sha256 ${String(l.prefix_sha256).slice(0, 12)}, not ${want.prefix_sha256.slice(0, 12)}` : ''].filter(Boolean).join('; ');
  throw new Error(`${path} holds ${other.length} line(s) from a different labeller (first, ${l.trial_id}: ${diff}); label into a new file`);
}

/** Resolve the preregistration gate before any work, so a misconfigured paid run never starts. */
export function resolveGate(o: Pick<LabelOptions, 'preregistration' | 'allowUnregisteredSmoke' | 'runId' | 'leaseUsd' | 'transport'>): Gate {
  if (o.preregistration && o.allowUnregisteredSmoke) throw new Error('give --preregistration or --allow-unregistered-smoke, not both');
  if (o.allowUnregisteredSmoke) {
    if (!o.runId.endsWith('-smoke') || !(o.leaseUsd <= SMOKE_MAX_LEASE_USD)) throw new Error(`--allow-unregistered-smoke needs a --run-id ending in -smoke and --lease-usd of at most ${SMOKE_MAX_LEASE_USD}`);
    return { smoke: true };
  }
  if (o.preregistration) return { preregistration: o.preregistration };
  if (!o.transport) throw new Error('a paid labelling run needs --preregistration <path> (or --allow-unregistered-smoke for a -smoke run id under a lease of at most $3)');
  return null;
}

function writeAttestation(path: string, next: AttestationFile): void {
  const prev = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as AttestationFile : null;
  if (prev) {
    if ('uncounted' in prev !== 'uncounted' in next) throw new Error(`${path} records a ${'uncounted' in prev ? 'smoke' : 'registered'} run; label into a new folder`);
    if (!('uncounted' in prev) && !('uncounted' in next)) {
      const was = prev as Attestation & { earlier_runner_commits?: string[] };
      if (was.preregistration !== next.preregistration || was.preregistration_commit !== next.preregistration_commit) throw new Error(`${path} was attested under ${was.preregistration} at ${was.preregistration_commit.slice(0, 12)}; label into a new folder`);
      const earlier = [...(was.earlier_runner_commits ?? []), was.runner_commit].filter((c, i, a) => c !== (next as Attestation).runner_commit && a.indexOf(c) === i);
      if (earlier.length) next = { ...next, earlier_runner_commits: earlier };
    }
  }
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n');
}

export async function labelPackets(o: LabelOptions): Promise<LabelSummary> {
  const gate = resolveGate(o);
  const codebookText = readFileSync(o.codebookPath, 'utf8');
  const codebook = loadCodebook(o.codebookPath);
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const prefix = renderPrefix(o.instructions ?? DEFAULT_INSTRUCTIONS, codebook);
  const schema = recordSchema(codebook);
  const base = { model: o.model, codebook_sha256: sha(codebookText), prefix_sha256: sha(prefix) };
  const outDir = dirname(resolve(o.out));
  mkdirSync(outDir, { recursive: true });
  const attestationPath = join(outDir, 'attestation.json');
  const cwd = o.cwd ?? REPO_ROOT;
  const beforeFirstRequest = gate === null ? undefined : () => {
    if ('smoke' in gate) writeAttestation(attestationPath, { uncounted: true, reason: 'unregistered smoke of the labelling clients', run_id: o.runId, lease_usd: o.leaseUsd, attested_at: new Date().toISOString() });
    else writeAttestation(attestationPath, attestPreregistration(gate.preregistration, cwd));
  };

  assertSameLabeller(o.out, base);
  const { lines, malformed } = readLabels(o.out);
  const todo = o.packets.filter((p) => { const l = lines.get(p.trial_id); return !l || (o.retryFailed && l.status === 'failed'); });
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let consecutiveFailures = 0;
  /** One structured call with backoff on 429 and 5xx; an HTTP failure comes back as its problem text. */
  const ask = async (req: Parameters<Llm['structured']>[0], refresh: boolean): Promise<Awaited<ReturnType<Llm['structured']>> | { error: string }> => {
    for (let retry = 0; ; retry++) {
      if (consecutiveFailures >= MAX_CONSECUTIVE_TRANSPORT_FAILURES) throw new TransportStop();
      try {
        const res = await llm.structured(req, { refresh });
        if (!res.cached) consecutiveFailures = 0;
        return res;
      } catch (e) {
        const m = e instanceof LlmError ? /^E_HTTP_(\d+)$/.exec(e.code) : null;
        if (!m) throw e;
        const status = Number(m[1]);
        const transient = status === 429 || status >= 500;
        if (transient && retry < BACKOFF_MS.length) { await sleep(BACKOFF_MS[retry]!); continue; }
        if (++consecutiveFailures >= MAX_CONSECUTIVE_TRANSPORT_FAILURES) throw new TransportStop();
        return { error: transient ? `request failed: E_HTTP_${status} after ${BACKOFF_MS.length} retries` : `request failed: E_HTTP_${status} (not transient, not retried)` };
      }
    }
  };
  if (existsSync(o.out)) { const t = readFileSync(o.out, 'utf8'); if (t && !t.endsWith('\n')) appendFileSync(o.out, '\n'); }

  const llm: Llm = await createLlm({ cacheDir: o.cacheDir ?? join(outDir, 'cache'), transport: o.transport, proxy: o.proxy ? { ...o.proxy, leaseUsd: o.leaseUsd, runId: o.runId } : undefined, beforeFirstRequest });
  const summary: LabelSummary = { packets: o.packets.length, skipped: o.packets.length - todo.length, asked: 0, ok: 0, failed: 0, verified: 0, stopped: null, malformed_lines: malformed, stats: llm.stats() };

  const labelOne = async (p: AnyPacket): Promise<LabelLine> => {
    const text = packetText(p);
    const strings = packetStrings(p);
    let best: { record: LabelRecord; check: { verified: boolean; reasons: string[] }; cached: boolean } | null = null;
    let problems: string[] = [];
    let feedback: string | undefined;
    let attempts = 0;
    const refresh = !!o.retryFailed && lines.get(p.trial_id)?.status === 'failed';
    for (let attempt = 1; attempt <= 2; attempt++) {
      attempts = attempt;
      const res = await ask({ model: o.model, prefix, packet: text, schema, tool: TOOL, feedback }, refresh);
      if ('error' in res) { problems = [res.error]; break; }
      if (res.value === null) { problems = ['the reply carried no record']; feedback = `Your previous reply carried no record. ${o.model.startsWith('openai:') ? 'Return the record as JSON.' : `Call ${TOOL.name} once.`}`; continue; }
      const v = validateRecord(res.value, codebook, p.trial_id);
      if (!v.record) { problems = v.problems; feedback = `Your previous record was rejected: ${v.problems.join('; ')}. Return one corrected record.`; continue; }
      const check = checkRecord(v.record, p, codebook, strings);
      best = { record: v.record, check, cached: res.cached };
      if (check.verified) break;
      feedback = `Your previous record failed these checks: ${check.reasons.join('; ')}. Return one corrected record.`;
    }
    const meta = { ...base, packet_sha256: p.packet_sha256, attempts };
    if (best) return { ...best.record, status: 'ok', ...meta, cached: best.cached, check: best.check };
    return { trial_id: p.trial_id, status: 'failed', ...meta, cached: false, check: null, problems };
  };

  let next = 0;
  let fatal: unknown = null;
  const worker = async () => {
    while (!fatal && summary.stopped === null && next < todo.length) {
      const p = todo[next++]!;
      try {
        const line = await labelOne(p);
        if (fatal || summary.stopped) return;
        appendFileSync(o.out, JSON.stringify(line) + '\n');
        summary.asked++;
        if (line.status === 'ok') { summary.ok++; if (line.check?.verified) summary.verified++; } else summary.failed++;
      } catch (e) {
        if (e instanceof LlmError && e.code === 'E_BUDGET') summary.stopped = 'budget';
        else if (e instanceof TransportStop) summary.stopped ??= 'transport';
        else fatal ??= e;
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 4, todo.length || 1)) }, worker));
  } finally {
    summary.stats = await llm.close();
  }
  if (fatal) throw fatal;
  return summary;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const one = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const trials = argv.flatMap((a, i) => (a === '--trial' && argv[i + 1] ? [argv[i + 1]!] : []));
  const packetsPath = one('packets'), codebookPath = one('codebook'), model = one('model'), out = one('out'), runId = one('run-id'), lease = one('lease-usd');
  if (!packetsPath || !codebookPath || !model || !out || !runId || !lease || !(MODELS as readonly string[]).includes(model) || !(Number(lease) > 0)) {
    console.error([
      'usage: bun scripts/failure-mining/label.ts --packets <packets.jsonl> --codebook <codebook.json> --model <' + MODELS.join('|') + '>',
      '         --out <dir>/labels.jsonl --run-id <id> --lease-usd <n> (--preregistration <path> | --allow-unregistered-smoke)',
      '         [--instructions <file>] [--cache-dir <dir>] [--proxy-dir <dir>] [--ledger <file>] [--trial <id>]... [--limit <n>] [--concurrency 4] [--retry-failed]',
      '  --preregistration <path>: attested (committed, clean, on origin) before the first paid request; written to attestation.json beside labels.jsonl.',
      '  --allow-unregistered-smoke: skips attestation, only for a --run-id ending in -smoke with --lease-usd of at most ' + SMOKE_MAX_LEASE_USD + ' (a smoke of the clients before the preregistration exists).',
    ].join('\n'));
    process.exit(2);
  }
  let packets = readAnyPackets(packetsPath);
  if (trials.length) packets = packets.filter((p) => trials.includes(p.trial_id));
  if (one('limit')) packets = packets.slice(0, Number(one('limit')));
  const outDir = dirname(resolve(out));
  const prereg = one('preregistration');
  try {
    const s = await labelPackets({
      packets, codebookPath, model: model as ModelId, out, runId, leaseUsd: Number(lease),
      cacheDir: one('cache-dir'), instructions: one('instructions') ? readFileSync(one('instructions')!, 'utf8') : undefined,
      proxy: { dir: one('proxy-dir') ?? join(outDir, 'proxy', runId), ledger: one('ledger') },
      preregistration: prereg ? relative(REPO_ROOT, resolve(prereg)) : undefined,
      allowUnregisteredSmoke: argv.includes('--allow-unregistered-smoke'),
      retryFailed: argv.includes('--retry-failed'), concurrency: one('concurrency') ? Number(one('concurrency')) : undefined,
    });
    const share = s.stats.input_tokens ? (s.stats.cached_input_tokens / s.stats.input_tokens) : 0;
    const stop = s.stopped === 'budget' ? '; STOPPED: the lease is spent' : s.stopped === 'transport' ? `; STOPPED: ${MAX_CONSECUTIVE_TRANSPORT_FAILURES} transport failures in a row` : '';
    console.log(`labels: ${s.packets} packets, ${s.skipped} already labelled, ${s.asked} asked: ${s.ok} ok (${s.verified} verified), ${s.failed} failed; ${s.stats.calls} calls, ${s.stats.cache_hits} cache hits, cache-read share ${(share * 100).toFixed(1)}% of input tokens, $${s.stats.usd.toFixed(4)} metered${stop}`);
    process.exit(s.stopped ? EXIT[s.stopped] : 0);
  } catch (e) {
    console.error(`label: ${e instanceof LlmError ? e.code : (e as Error).message}`);
    process.exit(1);
  }
}
