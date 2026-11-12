#!/usr/bin/env bun
// Writes set P, the public request set of the skill-resolver eval (internal-task, docs/benchmarks/2026-11-08-skill-resolver/PREREGISTRATION.md).
//
//   bun scripts/skill-resolver/gen-set-p.ts --catalog <dir> --out <dir> [--lease-usd 15] [--run-id setp-gen-1] [--dry-plan]
//
// 240 skill-needing requests, one per distinct target skill drawn by a seeded, pack-stratified sample of the catalog, and
// 60 no-skill requests over fixed everyday topics. The writer (GPT-6.1 Sol, through the metering proxy under a lease,
// scripts/v03/llm.ts) sees the target's SKILL.md body with its name, the name's words and its description masked, never
// the name or description itself. Each request gets overlap measures against its target (name hit, Jaccard with name plus
// description, coverage by the body); a request that names the target or has name-plus-description Jaccard above
// MAX_ND_JACCARD is rewritten up to twice with that feedback, then dropped. The target is the writer's input only: the
// acceptable-skill labels come later from blind judges (label-set.ts). Every request is assigned to the dev or test half
// by sha256(seed, id). Output: <out>/setp.jsonl (one row per request) and <out>/setp-plan.json (seed, targets, counts,
// drops, spend).

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLlm, LlmError, type Llm } from '../v03/llm.ts';
import type { Manifest } from './build-catalog.ts';

export const SEED = 'harn-52-set-p-v1';
export const SKILL_TARGETS = 240;
export const NO_SKILL_TOPICS = [
  'a quick arithmetic question', 'a unit conversion', 'a word definition', 'a synonym for a word', 'casual small talk about the weekend',
  'a thank-you reply', 'a capital city', 'a history date', 'a recipe substitution', 'a fun fact request', 'a short joke request',
  'what day of the week a date falls on', 'rephrasing one sentence more politely', 'a spelling check of one word', 'a time zone difference',
  'a sports rule', 'a book recommendation in one line', 'how to pronounce a word', 'a tip calculation', 'a greeting',
  'an opinion on a movie', 'translating one short phrase', 'what an acronym stands for', 'a simple science fact', 'a birthday message idea',
  'a riddle', 'how many days until a date', 'the plural of a word', 'a quick motivational line', 'confirming a meeting time in words',
];
export const MAX_ND_JACCARD = 0.25;
const STOP = new Set('a an and are as at be by can could do does for from have how i if in into is it its me my of on or our please should so that the their them then there this to us was we what when where which who why will with would you your'.split(' '));

export const tokens = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
const h = (...parts: string[]) => createHash('sha256').update(parts.join('\u0000')).digest('hex');

export function overlap(request: string, name: string, description: string, body: string) {
  const q = new Set(tokens(request));
  const nameWords = tokens(name.replace(/[-_]/g, ' '));
  const nd = new Set([...nameWords, ...tokens(description)]);
  const bodySet = new Set(tokens(body));
  const inter = [...q].filter((w) => nd.has(w)).length;
  const union = new Set([...q, ...nd]).size || 1;
  return {
    name_hit: request.toLowerCase().includes(name.toLowerCase()) || (nameWords.length > 1 && nameWords.every((w) => q.has(w))),
    nd_jaccard: Number((inter / union).toFixed(4)),
    body_coverage: Number((q.size ? [...q].filter((w) => bodySet.has(w)).length / q.size : 0).toFixed(4)),
  };
}

export function maskBody(body: string, name: string, description: string): string {
  let out = body.replaceAll(description, '[description withheld]');
  const words = [name, ...name.split(/[-_]/).filter((w) => w.length >= 4)].sort((a, b) => b.length - a.length);
  for (const w of words) out = out.replace(new RegExp(w.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&'), 'gi'), '[skill]');
  return out.slice(0, 6000);
}

export function pickTargets(m: Manifest, n: number): string[] {
  const byPack = Object.groupBy(m.skills, (s) => s.pack);
  const packs = Object.keys(byPack).sort();
  const quota = Object.fromEntries(packs.map((p) => [p, Math.round((byPack[p]!.length / m.skills.length) * n)]));
  let diff = n - Object.values(quota).reduce((a, b) => a + b, 0);
  for (const p of packs.toSorted((a, b) => byPack[b]!.length - byPack[a]!.length)) { if (!diff) break; quota[p] += Math.sign(diff); diff -= Math.sign(diff); }
  return packs.flatMap((p) => byPack[p]!.map((s) => s.name).sort((a, b) => h(SEED, a).localeCompare(h(SEED, b))).slice(0, quota[p]));
}

const half = (id: string) => (parseInt(h(SEED, 'half', id).slice(0, 8), 16) % 2 === 0 ? 'dev' : 'test');

const WRITER_SYSTEM = 'You write realistic messages that people send to an AI agent (a chat assistant or a coding agent). Output only the message text, with no quotes and no preamble.';

async function writeSkill(llm: Llm, skill: Manifest['skills'][number], body: string, feedback: string): Promise<string> {
  const prompt = [
    'Below is the body of an instruction file the agent has for one kind of job. Its name and summary are withheld.',
    'Write ONE message (one to three sentences) that a real user might send, about a concrete situation of their own, where the right way to handle it is to follow this instruction file.',
    'Rules: do not mention skills, instruction files or procedures; do not reuse the file\'s headings or any phrase of four or more words from it; write the way a busy person types, with specifics (names of files, people, places or numbers you invent).',
    feedback ? 'Your previous attempt was rejected: ' + feedback : '',
    '--- instruction file body ---', body,
  ].filter(Boolean).join('\n\n');
  return (await llm.complete({ model: 'openai:gpt-6.1-sol', system: WRITER_SYSTEM, prompt, maxTokens: 2000 })).trim();
}

export async function generate(o: { catalog: string; out: string; leaseUsd: number; runId: string; dryPlan: boolean }) {
  const m = JSON.parse(readFileSync(join(o.catalog, 'manifest.json'), 'utf8')) as Manifest;
  mkdirSync(o.out, { recursive: true });
  const targets = pickTargets(m, SKILL_TARGETS);
  const plan = { seed: SEED, catalog_hash: m.catalog_hash, skill_targets: targets, no_skill_topics: NO_SKILL_TOPICS, max_nd_jaccard: MAX_ND_JACCARD };
  if (o.dryPlan) { writeFileSync(join(o.out, 'setp-plan.json'), JSON.stringify(plan, null, 1) + '\n'); return { plan }; }
  const llm = await createLlm({ cacheDir: join(o.out, 'cache'), proxy: { dir: join(o.out, 'proxy', o.runId), leaseUsd: o.leaseUsd, runId: o.runId } });
  const rows: unknown[] = [];
  const drops: { id: string; target: string; reason: string }[] = [];
  const skills = new Map(m.skills.map((s) => [s.name, s]));
  const jobs = targets.map((t, i) => async () => {
    const s = skills.get(t)!;
    const raw = readFileSync(join(o.catalog, 'skills', t, 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?\n---\n?/, '');
    const body = maskBody(raw, s.original_name, s.description);
    const id = 'p-s-' + String(i + 1).padStart(3, '0');
    let feedback = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const request = await writeSkill(llm, s, body, feedback);
      const ov = overlap(request, s.original_name, s.description, raw);
      if (!ov.name_hit && ov.nd_jaccard <= MAX_ND_JACCARD) { rows.push({ id, kind: 'skill', writer_target: t, request, overlap: ov, attempts: attempt + 1, half: half(id) }); return; }
      feedback = ov.name_hit ? 'it names the job too directly; describe the situation instead.' : 'it reuses too many of the file\'s own words; use your own words for the situation.';
    }
    drops.push({ id, target: t, reason: 'overlap after 3 attempts' });
  });
  NO_SKILL_TOPICS.forEach((topic, j) => [0, 1].forEach((k) => jobs.push(async () => {
    const id = 'p-n-' + String(j * 2 + k + 1).padStart(3, '0');
    const request = (await llm.complete({ model: 'openai:gpt-6.1-sol', system: WRITER_SYSTEM, maxTokens: 2000,
      prompt: 'Write ONE short message (one or two sentences) a person might send an AI assistant: ' + topic + '. Make it specific and natural. Variant ' + (k + 1) + '.' })).trim();
    rows.push({ id, kind: 'none', writer_target: null, request, overlap: null, attempts: 1, half: half(id) });
  })));
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (next < jobs.length) await jobs[next++]!(); }));
  const stats = await llm.close();
  rows.sort((a: any, b: any) => a.id.localeCompare(b.id));
  writeFileSync(join(o.out, 'setp.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const summary = { ...plan, rows: rows.length, drops, halves: Object.groupBy(rows as any[], (r: any) => r.half + ':' + r.kind), llm: stats };
  writeFileSync(join(o.out, 'setp-plan.json'), JSON.stringify({ ...summary, halves: Object.fromEntries(Object.entries(summary.halves).map(([k, v]) => [k, v!.length])) }, null, 1) + '\n');
  return summary;
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string, d?: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const catalog = v('--catalog'); const out = v('--out');
  if (!catalog || !out) { console.error('usage: gen-set-p.ts --catalog <dir> --out <dir> [--lease-usd 15] [--run-id setp-gen-1] [--dry-plan]'); process.exit(2); }
  try {
    const s: any = await generate({ catalog, out, leaseUsd: Number(v('--lease-usd', '15')), runId: v('--run-id', 'setp-gen-1')!, dryPlan: a.includes('--dry-plan') });
    console.log(s.rows === undefined ? 'SETP_PLAN targets=' + s.plan.skill_targets.length : 'SETP rows=' + s.rows + ' drops=' + s.drops.length + ' calls=' + s.llm.calls + ' usd=' + s.llm.usd);
  } catch (e) { console.error('HE-SKILLS-002 ' + (e instanceof LlmError ? e.code : (e as Error).message)); process.exit(2); }
}
