#!/usr/bin/env bun
// Packets for internal-task-a's Claude Code SDK transcripts (internal-task-b, failure mining): one per failed Lane B session.
//
//   bun scripts/failure-mining/sdk-packet.ts [--transcripts <dir>] [--results <dir>] [--tasks tasks/repo/gstack-native-v1]
//       [--cap-tokens 20000] [--out-dir ~/.capy/work/harn66/packets/sdk]
//       [--index docs/benchmarks/2026-11-09-failure-mining/corpus/sdk-packet-index.jsonl]
//
// Sources (SOURCES below): the trial rows of record in docs/benchmarks/2026-11-01-opus-gstack-follow/results/ and the
// transcripts in the org drive at handoffs/internal-task/transcripts/<run>/<lease>/laneb/jobs/<job>/<harbor trial>/agent/
// sdk-messages.jsonl. A trial failed when its grade is not pass or its verifier reward is 0. Every one of these runs is
// uncounted, so every packet and index line says population uncounted, reporting descriptive.
//
// A packet keeps packet.ts's shape where it fits (trial_id, cell, harness, model, task, termination, grade,
// failed_predicates, truncation, inputs, packet_sha256) and adds kind "sdk": the task prompt (the task's instruction.md,
// null for a task tree not in this checkout), the arm and its Lane B flags, and the session as ordered steps. A step is
// the agent's text (trimmed), or one tool call with its trimmed input and the trimmed result and error flag of its tool
// result, or the session's final result. Thinking blocks and signatures stay out. A step is marked when it is a Skill
// tool call (skill_call), a read of a gstack SKILL.md (gstack_skill_md_read), or a call to a gstack bin script
// (gstack_bin). gstack is null when the arm installed no gstack and no step is marked; a labeller reads that as absent.
//
// Same cap rule as packet.ts (4 characters per token over the packet's JSON): the oldest tool results are dropped first,
// then the oldest steps, and both are recorded under truncation. Output is packets.jsonl in --out-dir, sorted by trial
// id, and one index line per failed trial (with or without a packet). Keyless, no timestamps of its own, deterministic.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { TrialRecord } from '../../runner/contracts.ts';
import { DEFAULT_CAP_TOKENS, estimateTokens, hashPacket, packetText, trimDeep } from './packet.ts';

export const SDK_PACKET_VERSION = '1.0.0';
const MAX_TEXT = 1000;
const MAX_INPUT = 500;
const RESULT_HEAD = 800;
const RESULT_TAIL = 800;

export interface SdkSource { run: string; lease: string; rows: string; arm?: string }

/** The four internal-task transcript sets and the trial rows of record for each (rows relative to --results). */
export const SOURCES: SdkSource[] = [
  { run: 'gn-follow-2026-11', lease: 'opus-follow', rows: 'gn-follow-2026-11/trials.jsonl' },
  { run: 'gn-follow-preset-2026-11', lease: 'opus-follow-preset', rows: 'gn-follow-preset-2026-11/trials.jsonl' },
  { run: 'gn-hard-follow-2026-11', lease: 'opus-hard-gstack', rows: 'gn-hard-follow-2026-11/reprobed-trials.jsonl', arm: 'gstack' },
  { run: 'gn-hard-follow-2026-11', lease: 'opus-hard-none', rows: 'gn-hard-follow-2026-11/reprobed-trials.jsonl', arm: 'none' },
];

export type StepMark = 'skill_call' | 'gstack_skill_md_read' | 'gstack_bin';

export interface SdkStep {
  step: number;
  t: number | null;
  kind: 'text' | 'tool' | 'result';
  text?: string;
  tool?: string;
  input?: unknown;
  result?: string | null;
  is_error?: boolean | null;
  mark?: StepMark;
}

export interface SdkPacket {
  packet_version: string;
  kind: 'sdk';
  population: 'uncounted';
  reporting: 'descriptive';
  trial_id: string;
  run: string;
  cell: string;
  harness: string;
  model: string | null;
  arm: string;
  task: { id: string; set: string | null; prompt: string | null };
  termination: string;
  grade: string;
  reward: number | null;
  exception: string | null;
  agent_error: string | null;
  gstack: { installed: boolean; invoked: boolean | null; cmd_expanded: boolean | null; skill_probe: Record<string, unknown> | null; marked_steps: number[] } | null;
  steps: SdkStep[];
  failed_predicates: Array<{ id: string; kind: string; evidence: string }>;
  truncation: { cap_tokens: number; tokens_before: number; tokens_after: number; dropped_result_steps: number[]; dropped_steps: number[]; over_cap: boolean };
  inputs: Record<string, string>;
}

export type HashedSdkPacket = SdkPacket & { packet_sha256: string };

export interface SdkIndexLine {
  trial_id: string; run: string; lease: string; arm: string; task: string; kind: 'sdk'; population: 'uncounted'; reporting: 'descriptive';
  grade: string; reward: number | null; termination: string; gstack_present: boolean;
  packet_sha256: string | null; tokens: number | null; truncated: boolean | null; transcript_sha256: string | null; skipped: string | null;
}

const sha256 = (d: string | Buffer) => createHash('sha256').update(d).digest('hex');

/** Long results keep their head and their tail, where errors and test summaries usually are. */
export function headTail(s: string, head = RESULT_HEAD, tail = RESULT_TAIL): string {
  return s.length <= head + tail ? s : `${s.slice(0, head)}…[${s.length - head - tail} chars cut]…${s.slice(-tail)}`;
}

export function markOf(tool: string, input: unknown, arm: string): StepMark | undefined {
  if (tool === 'Skill') return 'skill_call';
  const s = JSON.stringify(input ?? null);
  if (/\.claude\/skills\/gstack\/bin\//.test(s)) return 'gstack_bin';
  if (/SKILL\.md/.test(s) && (/gstack/.test(s) || arm === 'gstack')) return 'gstack_skill_md_read';
  return undefined;
}

const blocks = (content: unknown): any[] => {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') { try { const v = JSON.parse(content); return Array.isArray(v) ? v : [{ text: content }]; } catch { return [{ text: content }]; } }
  return [];
};
const resultText = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b: any) => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : b?.type ? `[${b.type}]` : '')).join('\n') : c == null ? '' : JSON.stringify(c));

/** The session as ordered steps: each tool call carries the result that answered it. */
export function stepsOf(lines: any[], arm: string): SdkStep[] {
  const steps: SdkStep[] = [];
  const byToolId = new Map<string, SdkStep>();
  for (const m of lines) {
    const t = typeof m?.t === 'number' ? m.t : null;
    if (m?.type === 'AssistantMessage') {
      for (const b of blocks(m.content)) {
        if (typeof b?.name === 'string' && typeof b?.id === 'string') {
          const mark = markOf(b.name, b.input, arm);
          const s: SdkStep = { step: steps.length, t, kind: 'tool', tool: b.name, input: trimDeep(b.input ?? null, MAX_INPUT), result: null, is_error: null, ...(mark ? { mark } : {}) };
          steps.push(s);
          byToolId.set(b.id, s);
        } else if (typeof b?.text === 'string' && b.text.trim() && !('thinking' in b)) {
          steps.push({ step: steps.length, t, kind: 'text', text: String(trimDeep(b.text, MAX_TEXT)) });
        }
      }
    } else if (m?.type === 'UserMessage') {
      for (const b of blocks(m.content)) {
        const s = typeof b?.tool_use_id === 'string' ? byToolId.get(b.tool_use_id) : undefined;
        if (s) { s.result = headTail(resultText(b.content)); s.is_error = b.is_error === true; }
      }
    } else if (m?.type === 'ResultMessage') {
      steps.push({ step: steps.length, t, kind: 'result', text: String(trimDeep(typeof m.result === 'string' ? m.result : '', MAX_TEXT)), is_error: m.is_error === true });
    }
  }
  return steps;
}

export function capSdkPacket(p: SdkPacket, capTokens: number): SdkPacket {
  const before = estimateTokens(packetText(p));
  const out: SdkPacket = { ...p, steps: p.steps.map((s) => ({ ...s })), truncation: { cap_tokens: capTokens, tokens_before: before, tokens_after: before, dropped_result_steps: [], dropped_steps: [], over_cap: false } };
  const size = () => estimateTokens(packetText(out));
  for (const s of out.steps) {
    if (size() <= capTokens) break;
    if (s.kind === 'tool' && s.result) { s.result = null; out.truncation.dropped_result_steps.push(s.step); }
  }
  while (size() > capTokens && out.steps.length) out.truncation.dropped_steps.push(out.steps.shift()!.step);
  out.truncation.tokens_after = size();
  out.truncation.over_cap = out.truncation.tokens_after > capTokens;
  return out;
}

export const failed = (r: TrialRecord): boolean => r.grade !== 'pass' || r.laneb?.reward === 0;

export interface SdkBuildOptions { transcripts: string; results: string; tasksRoot: string; capTokens?: number; sources?: SdkSource[] }

function findTranscript(dir: string, harborTrial: string): string | null {
  const jobs = join(dir, 'laneb', 'jobs');
  if (!existsSync(jobs)) return null;
  for (const job of readdirSync(jobs).sort()) {
    const p = join(jobs, job, harborTrial, 'agent', 'sdk-messages.jsonl');
    if (existsSync(p)) return p;
  }
  return null;
}

export function buildSdkPacket(row: TrialRecord, src: SdkSource, o: SdkBuildOptions, transcript: string): HashedSdkPacket {
  const arm = row.laneb?.arm ?? 'unknown';
  const raw = readFileSync(transcript, 'utf8');
  const lines = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const steps = stepsOf(lines, arm);
  const instruction = ['dev', 'heldout'].map((s) => join(o.tasksRoot, s, row.task, 'instruction.md')).find((p) => existsSync(p)) ?? null;
  const inputs: Record<string, string> = { 'sdk-messages.jsonl': sha256(raw), 'trial row': sha256(JSON.stringify(row)) };
  if (instruction) inputs['instruction.md'] = sha256(readFileSync(instruction));
  const marked = steps.filter((s) => s.mark).map((s) => s.step);
  const lb = row.laneb;
  const packet: SdkPacket = {
    packet_version: SDK_PACKET_VERSION,
    kind: 'sdk',
    population: 'uncounted',
    reporting: 'descriptive',
    trial_id: row.trial_id,
    run: src.run,
    cell: row.cell,
    harness: row.harness,
    model: row.model ?? null,
    arm,
    task: { id: row.task, set: instruction ? basename(resolve(o.tasksRoot)) : null, prompt: instruction ? readFileSync(instruction, 'utf8').trim() : null },
    termination: row.termination,
    grade: row.grade,
    reward: lb?.reward ?? null,
    exception: lb?.exception ?? null,
    agent_error: lb?.agent_error ?? null,
    gstack: arm === 'gstack' || marked.length
      ? { installed: arm === 'gstack', invoked: lb?.invoked ?? null, cmd_expanded: lb?.cmd_expanded ?? null, skill_probe: ((lb as unknown as { skill_probe?: Record<string, unknown> })?.skill_probe) ?? null, marked_steps: marked }
      : null,
    steps,
    failed_predicates: row.predicates.filter((p) => !p.passed).map((p) => ({ id: p.id, kind: p.kind, evidence: String(trimDeep(p.evidence, 1500)) })),
    truncation: { cap_tokens: 0, tokens_before: 0, tokens_after: 0, dropped_result_steps: [], dropped_steps: [], over_cap: false },
    inputs,
  };
  return hashPacket(capSdkPacket(packet, o.capTokens ?? DEFAULT_CAP_TOKENS));
}

export interface SdkArmCount { run: string; lease: string; arm: string; sessions: number; failed: number; packets: number }

export function buildSdkPackets(o: SdkBuildOptions): { packets: HashedSdkPacket[]; index: SdkIndexLine[]; counts: SdkArmCount[] } {
  const packets: HashedSdkPacket[] = [];
  const index: SdkIndexLine[] = [];
  const counts: SdkArmCount[] = [];
  for (const src of o.sources ?? SOURCES) {
    const rows = readFileSync(join(o.results, src.rows), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrialRecord).filter((r) => !src.arm || r.laneb?.arm === src.arm);
    const dir = join(o.transcripts, src.run, src.lease);
    const arms = new Map<string, SdkArmCount>();
    for (const r of rows) {
      const arm = r.laneb?.arm ?? 'unknown';
      const c = arms.get(arm) ?? { run: src.run, lease: src.lease, arm, sessions: 0, failed: 0, packets: 0 };
      arms.set(arm, c);
      c.sessions++;
      if (!failed(r)) continue;
      c.failed++;
      const harbor = r.laneb?.harbor_trial;
      const transcript = harbor ? findTranscript(dir, harbor) : null;
      const base = { trial_id: r.trial_id, run: src.run, lease: src.lease, arm, task: r.task, kind: 'sdk' as const, population: 'uncounted' as const, reporting: 'descriptive' as const, grade: r.grade, reward: r.laneb?.reward ?? null, termination: r.termination };
      if (!transcript) { index.push({ ...base, gstack_present: arm === 'gstack', packet_sha256: null, tokens: null, truncated: null, transcript_sha256: null, skipped: 'no sdk-messages.jsonl for this trial' }); continue; }
      const p = buildSdkPacket(r, src, o, transcript);
      c.packets++;
      packets.push(p);
      index.push({ ...base, gstack_present: p.gstack !== null, packet_sha256: p.packet_sha256, tokens: p.truncation.tokens_after, truncated: p.truncation.dropped_steps.length + p.truncation.dropped_result_steps.length > 0, transcript_sha256: p.inputs['sdk-messages.jsonl']!, skipped: null });
    }
    counts.push(...[...arms.values()].sort((a, b) => a.arm.localeCompare(b.arm)));
  }
  packets.sort((a, b) => a.trial_id.localeCompare(b.trial_id));
  index.sort((a, b) => a.trial_id.localeCompare(b.trial_id));
  return { packets, index, counts };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const one = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes('--help')) {
    console.error('usage: bun scripts/failure-mining/sdk-packet.ts [--transcripts <dir>] [--results <dir>] [--tasks tasks/repo/gstack-native-v1] [--cap-tokens 20000] [--out-dir <dir>] [--index <sdk-packet-index.jsonl>]');
    process.exit(2);
  }
  const root = resolve(import.meta.dir, '..', '..');
  const outDir = one('out-dir') ?? join(homedir(), '.capy/work/harn66/packets/sdk');
  const indexPath = one('index') ?? join(root, 'docs/benchmarks/2026-11-09-failure-mining/corpus/sdk-packet-index.jsonl');
  const { packets, index, counts } = buildSdkPackets({
    transcripts: one('transcripts') ?? join(homedir(), '.capy/drive/org-gstack-gbrain/handoffs/internal-task/transcripts'),
    results: one('results') ?? join(root, 'docs/benchmarks/2026-11-01-opus-gstack-follow/results'),
    tasksRoot: one('tasks') ?? join(root, 'tasks/repo/gstack-native-v1'),
    capTokens: Number(one('cap-tokens') ?? DEFAULT_CAP_TOKENS),
  });
  mkdirSync(outDir, { recursive: true });
  mkdirSync(dirname(indexPath), { recursive: true });
  const jsonl = (xs: unknown[]) => xs.map((x) => JSON.stringify(x)).join('\n') + (xs.length ? '\n' : '');
  writeFileSync(join(outDir, 'packets.jsonl'), jsonl(packets));
  writeFileSync(indexPath, jsonl(index));
  for (const c of counts) console.log(`${c.run} ${c.lease} arm ${c.arm}: ${c.sessions} sessions, ${c.failed} failed, ${c.packets} packets`);
  console.log(`sdk packets: ${packets.length} written to ${join(outDir, 'packets.jsonl')}; index ${indexPath} (${index.length} lines; ${packets.filter((p) => p.truncation.dropped_steps.length + p.truncation.dropped_result_steps.length).length} truncated, ${packets.filter((p) => p.truncation.over_cap).length} over the cap)`);
}
