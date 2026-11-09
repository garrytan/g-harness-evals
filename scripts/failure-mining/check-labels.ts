#!/usr/bin/env bun
// Mechanical checks on layer-2 labels (internal-task, failure mining): what can be checked without a judge.
//
//   bun scripts/failure-mining/check-labels.ts --labels <labels.jsonl> --packets <packets.jsonl> --codebook <codebook.json>
//                                              [--out <checked.jsonl>]
//
// For each trial's latest label: root_cause is a codebook id (or "other"); the packet the label was made from is the
// packet on file (same packet_sha256); a cited seq exists in the packet and is a bot event in the named turn (a seq the
// packet's cap cut is reported as cut); a no_action step cites no seq and an action or reply step cites one; gstack_role
// is "absent" when the packet shows no gstack, and not "absent" when it does; for a multi-user packet, brain_role is
// "absent" exactly when the packet's gbrain field is null; every evidence quote appears verbatim in
// one of the packet's strings. For an sdk packet (scripts/failure-mining/sdk-packet.ts) the step index stands in for
// seq and turn must be null: an action cites a tool step, a reply cites a text or result step. Quotes and packet strings are compared after collapsing
// whitespace, reading a JSON escape (\\, \n, \") as the character it stands for, and folding typographic quotes and dashes
// to ASCII, so a quote copied from the packet's JSON text still matches. A label passing every check is verified;
// otherwise unverified with one reason per failed check. A trial whose labelling failed is unverified with its reason.

import { readFileSync, writeFileSync } from 'node:fs';
import type { HashedPacket } from './packet.ts';
import type { HashedSdkPacket } from './sdk-packet.ts';

export interface CodebookClass { id: string; name: string; definition: string; include: string; exclude: string }
export interface Codebook { version?: string; classes: CodebookClass[] }

export const STAGES = ['understand', 'retrieve', 'decide', 'act', 'reply'] as const;
export const BRAIN_ROLES = ['absent', 'not_called', 'called_no_help', 'called_wrong_content', 'called_ignored', 'called_helped_partly'] as const;
export const STEP_KINDS = ['action', 'no_action', 'reply'] as const;
export const CONFIDENCE = ['low', 'medium', 'high'] as const;
export const GSTACK_ROLES = ['absent', 'not_loaded', 'loaded_not_followed', 'followed_partly', 'followed'] as const;

/** A multi-user packet (packet.ts) or a Claude Code SDK packet (sdk-packet.ts, kind "sdk"). */
export type AnyPacket = HashedPacket | HashedSdkPacket;
export const isSdk = (p: AnyPacket): p is HashedSdkPacket => (p as { kind?: string }).kind === 'sdk';
/** Whether the packet shows gstack at all; a multi-user packet never does. */
export const packetHasGstack = (p: AnyPacket): boolean => isSdk(p) && p.gstack !== null;

export function readAnyPackets(path: string): AnyPacket[] {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as AnyPacket);
}

export interface LabelRecord {
  trial_id: string;
  root_cause: string;
  first_wrong_step: { turn: number | null; seq: number | null; kind: (typeof STEP_KINDS)[number] };
  stage: (typeof STAGES)[number];
  brain_role: (typeof BRAIN_ROLES)[number];
  gstack_role: (typeof GSTACK_ROLES)[number];
  evidence_quotes: string[];
  confidence: (typeof CONFIDENCE)[number];
  note: string;
}

/** One line of labels.jsonl: the record's fields at top level when status is ok, and how it was made. */
export type LabelLine = Partial<LabelRecord> & {
  trial_id: string;
  status: 'ok' | 'failed';
  model: string;
  packet_sha256: string;
  codebook_sha256: string;
  prefix_sha256: string;
  attempts: number;
  cached: boolean;
  check: { verified: boolean; reasons: string[] } | null;
  problems?: string[];
  error?: string;
};

export function loadCodebook(path: string): Codebook {
  const cb = JSON.parse(readFileSync(path, 'utf8')) as Codebook;
  const problems: string[] = [];
  if (!Array.isArray(cb.classes) || !cb.classes.length) problems.push('classes must be a non-empty array');
  const seen = new Set<string>();
  for (const [i, c] of (cb.classes ?? []).entries()) {
    for (const k of ['id', 'name', 'definition', 'include', 'exclude'] as const) if (typeof c?.[k] !== 'string' || !c[k].trim()) problems.push(`classes[${i}].${k} must be a non-empty string`);
    if (typeof c?.id === 'string') {
      if (!/^[a-z][a-z0-9_]*$/.test(c.id)) problems.push(`classes[${i}].id "${c.id}" must be snake_case`);
      if (c.id === 'other') problems.push('"other" is reserved for the labeller and cannot be a class id');
      if (seen.has(c.id)) problems.push(`classes[${i}].id "${c.id}" is repeated`);
      seen.add(c.id);
    }
  }
  if (problems.length) throw new Error(`codebook ${path}: ${problems.join('; ')}`);
  return cb;
}

export const normalizeText = (s: string): string => s
  .replace(/\\\\/g, '\\')
  .replace(/\\n|\\r|\\t/g, ' ')
  .replace(/\\"/g, '"')
  .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
  .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
  .replace(/[\u2013\u2014\u2212]/g, '-')
  .replace(/\u2026/g, '...')
  .replace(/\s+/g, ' ')
  .trim();

/** Every string a labeller saw in the packet, normalized; the hashes under inputs are left out. */
export function packetStrings(p: AnyPacket): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key: string | null) => {
    if (key === 'inputs' || key === 'packet_sha256') return;
    if (typeof v === 'string') out.push(normalizeText(v));
    else if (Array.isArray(v)) for (const x of v) walk(x, null);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(p, null);
  return out;
}

/** The mechanical checks for one schema-valid record against the packet it was made from. */
export function checkRecord(r: LabelRecord, p: AnyPacket, codebook: Codebook, strings = packetStrings(p)): { verified: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (r.root_cause !== 'other' && !codebook.classes.some((c) => c.id === r.root_cause)) reasons.push(`root_cause "${r.root_cause}" is not a codebook id`);
  const { turn, seq, kind } = r.first_wrong_step;
  if (kind === 'no_action' && seq !== null) reasons.push('a no_action step cites seq ' + seq + '; it should cite none');
  if (kind !== 'no_action' && seq === null) reasons.push(`a ${kind} step cites no seq`);
  if (packetHasGstack(p) ? r.gstack_role === 'absent' : r.gstack_role !== 'absent') reasons.push(packetHasGstack(p) ? 'gstack_role is absent but the packet shows gstack' : `gstack_role is ${r.gstack_role} but the packet shows no gstack`);
  if (!isSdk(p) && (p.gbrain === null ? r.brain_role !== 'absent' : r.brain_role === 'absent')) reasons.push(p.gbrain === null ? `brain_role is ${r.brain_role} but the packet shows no gbrain` : 'brain_role is absent but the packet shows gbrain');
  if (isSdk(p)) {
    if (turn !== null) reasons.push(`an sdk packet has no turns; turn must be null, not ${turn}`);
    if (seq !== null) {
      const s = p.steps.find((x) => x.step === seq);
      if (!s) reasons.push(p.truncation.dropped_steps.includes(seq) ? `step ${seq} was cut from the packet by its token cap` : `step ${seq} is not in the packet`);
      else if (kind === 'action' && s.kind !== 'tool') reasons.push(`step ${seq} is ${s.kind}, not a tool call`);
      else if (kind === 'reply' && s.kind === 'tool') reasons.push(`step ${seq} is a tool call, not text or the result`);
    }
  } else {
    if (turn !== null && !p.turns.some((t) => t.turn === turn)) reasons.push(`turn ${turn} is not a turn of the task`);
  }
  if (!isSdk(p) && seq !== null) {
    const e = p.events.find((x) => x.seq === seq);
    if (!e) reasons.push(p.truncation.dropped_bot_seqs.includes(seq) || p.truncation.dropped_non_bot_seqs.includes(seq) ? `seq ${seq} was cut from the packet by its token cap` : `seq ${seq} is not in the packet`);
    else {
      if (!e.bot) reasons.push(`seq ${seq} is not a bot event (actor ${e.actor ?? 'none'})`);
      if (e.turn !== turn) reasons.push(`seq ${seq} falls in turn ${e.turn ?? 'none'}, not turn ${turn ?? 'none'}`);
    }
  }
  for (const q of r.evidence_quotes) {
    const n = normalizeText(q);
    if (!n) reasons.push('an evidence quote is empty');
    else if (!strings.some((s) => s.includes(n))) reasons.push(`quote not found verbatim in the packet: "${q.slice(0, 80)}"`);
  }
  return { verified: reasons.length === 0, reasons };
}

/** The latest line per trial id; lines a crash cut short are skipped and counted. */
export function readLabels(path: string): { lines: Map<string, LabelLine>; malformed: number } {
  const lines = new Map<string, LabelLine>();
  let malformed = 0;
  let text = '';
  try { text = readFileSync(path, 'utf8'); } catch { return { lines, malformed }; }
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try { const x = JSON.parse(l) as LabelLine; if (typeof x?.trial_id === 'string') lines.set(x.trial_id, x); else malformed++; } catch { malformed++; }
  }
  return { lines, malformed };
}

export interface CheckedLabel { trial_id: string; status: 'verified' | 'unverified'; reasons: string[] }

export function checkLabels(labels: Map<string, LabelLine>, packets: AnyPacket[], codebook: Codebook): CheckedLabel[] {
  const byId = new Map(packets.map((p) => [p.trial_id, p]));
  const out: CheckedLabel[] = [];
  for (const [id, l] of [...labels.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const p = byId.get(id);
    if (!p) { out.push({ trial_id: id, status: 'unverified', reasons: ['no packet for this trial id'] }); continue; }
    if (l.status !== 'ok') { out.push({ trial_id: id, status: 'unverified', reasons: [`labelling failed: ${(l.problems ?? [l.error ?? 'no record']).join('; ')}`] }); continue; }
    const reasons = l.packet_sha256 === p.packet_sha256 ? [] : ['the label was made from a different packet (packet_sha256 differs)'];
    const c = checkRecord(l as LabelLine & LabelRecord, p, codebook);
    reasons.push(...c.reasons);
    out.push({ trial_id: id, status: reasons.length ? 'unverified' : 'verified', reasons });
  }
  return out;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const one = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const labelsPath = one('labels'), packetsPath = one('packets'), codebookPath = one('codebook');
  if (!labelsPath || !packetsPath || !codebookPath) {
    console.error('usage: bun scripts/failure-mining/check-labels.ts --labels <labels.jsonl> --packets <packets.jsonl> --codebook <codebook.json> [--out <checked.jsonl>]');
    process.exit(2);
  }
  const { lines, malformed } = readLabels(labelsPath);
  const checked = checkLabels(lines, readAnyPackets(packetsPath), loadCodebook(codebookPath));
  const out = one('out');
  if (out) writeFileSync(out, checked.map((c) => JSON.stringify(c)).join('\n') + (checked.length ? '\n' : ''));
  const verified = checked.filter((c) => c.status === 'verified').length;
  console.log(`labels: ${checked.length}; verified ${verified}; unverified ${checked.length - verified}${malformed ? `; ${malformed} malformed line(s) skipped` : ''}${out ? `; written to ${out}` : ''}`);
}
