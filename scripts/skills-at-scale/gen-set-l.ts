#!/usr/bin/env bun
// Writes set L, the request set of the skills-at-scale eval (internal-task plan, "Requests and tasks"), without calling a model
// itself: it builds the writer prompts, reads the writer's answers from a cache, filters them by word overlap and splits a
// sealed half off.
//
//   bun scripts/skills-at-scale/gen-set-l.ts --catalog <1,500-skill catalog dir> --ladder <ladder.json> --cache <dir>
//       --out <dir> --sealed-dir <dir outside the checkout>
//
// 300 skill-needing requests, 3 per target skill (the ladder's 100 rung), and 120 no-skill requests (#449's 30 everyday
// topics, 4 variants each). The writer is Gemini 4 Carbon, a third family, so neither judge's family writes the requests.
// For each target it sees the SKILL.md body with the name, the name's words and the description masked (gen-set-p.ts
// maskBody), and writes one user message per style: low (everyday words), mid (a practitioner's common terms) and high (an
// expert's precise terms), each a different situation from the ones already kept. Each answer gets #449's overlap measures
// (gen-set-p.ts overlap). It is kept when it does not name the target, its name-plus-description Jaccard is at most
// MAX_ND_JACCARD and its text is new for that target; it is rewritten with feedback, up to MAX_ATTEMPTS, while it misses its
// style, and on the last attempt it is kept in the stratum it measured. Preregistered strata by name-plus-description
// Jaccard: low up to 0.05, mid up to 0.15, high up to 0.35. The spread is met when each stratum holds at least
// MIN_STRATUM_SHARE of the kept skill-needing requests. A request whose exact text another request already has is dropped.
//
// The writer is a function (tests pass a fake). The CLI's writer reads <cache>/<key>.json ({"text": ...}, key = sha256 of
// model, system and prompt); every miss is written to <cache>/pending.jsonl ({key, model, system, prompt}) and the run exits
// 3. Prompts and answers carry test-half requests, so the cache is refused inside the checkout or any git work tree.
// The wave 1 operator sends those prompts to Carbon through the metering proxy, stores the answers in the cache and
// reruns until nothing is pending: a rewrite's prompt depends on the earlier answer, so a request can take three rounds.
//
// Halves: targets are split per source pack by a seeded hash, alternating dev and test, and every request takes its
// target's half, so the halves share no target cluster; no-skill requests alternate by the same hash. The dev half goes to
// <out>/setl-dev.jsonl. The test half goes to <sealed-dir>/setl-test.jsonl, refused inside the checkout or any git work
// tree, and is committed by digest in <out>/setl-sealed.json: per-row sha256 plus the tree digest seal-heldout.ts records
// for a held-out tree (treeFiles). scripts/sealed/seal.ts seals task trees with a world slice or repository tasks, not
// request sets, so the sealed half is held by digest as #449's set P test half was, until custody takes request sets.
// <out>/setl-plan.json records the constants, targets, halves, strata, drops and attempts.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Manifest } from '../skill-resolver/build-catalog.ts';
import { NO_SKILL_TOPICS, maskBody, overlap } from '../skill-resolver/gen-set-p.ts';
import { treeFiles } from '../seal-heldout.ts';

export const SEED = 'harn-107-set-l-v1';
export const WRITER_MODEL = 'google:gemini-4-carbon';
export const STYLES = ['low', 'mid', 'high'] as const;
export const STRATA: Record<(typeof STYLES)[number], number> = { low: 0.05, mid: 0.15, high: 0.35 };
export const MAX_ND_JACCARD = 0.35;
export const MAX_ATTEMPTS = 3;
export const MIN_STRATUM_SHARE = 0.25;
export const NO_SKILL_VARIANTS = 4;
export const WRITER_SYSTEM = 'You write realistic messages that people send to an AI agent (a chat assistant or a coding agent). Output only the message text, with no quotes and no preamble.';
const STYLE_ASK: Record<(typeof STYLES)[number], string> = {
  low: 'Write it in everyday words, the way someone who does not know this field would describe their problem. Use none of the technical terms the file uses.',
  mid: 'Write it the way someone who works in this field would, using a few common terms of the field where they fit naturally.',
  high: 'Write it the way an expert would, using the precise technical terms of the field that a reference on this job would use.',
};
const ROOT = resolve(import.meta.dir, '..', '..');

export type Style = (typeof STYLES)[number];
export type WriteRequest = { key: string; model: string; system: string; prompt: string };
export type Writer = (r: WriteRequest) => Promise<string | null>;
export type SkillRow = { id: string; kind: 'skill'; target: string; pack: string; style: Style; stratum: Style; style_miss: boolean; request: string; overlap: ReturnType<typeof overlap>; attempts: number; half: string };
export type NoneRow = { id: string; kind: 'none'; target: null; topic: string; request: string; half: string };
export type Row = SkillRow | NoneRow;

const h = (...parts: string[]) => createHash('sha256').update(parts.join('\u0000')).digest('hex');
export const writeKey = (model: string, system: string, prompt: string) => createHash('sha256').update(JSON.stringify([model, system, prompt])).digest('hex');
const normal = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** The preregistered stratum of a name-plus-description Jaccard, or null above MAX_ND_JACCARD. */
export const stratumOf = (j: number): Style | null => STYLES.find((s) => j <= STRATA[s]) ?? null;

export function skillPrompt(body: string, style: Style, kept: string[], feedback: string): string {
  return [
    'Below is the body of an instruction file an AI agent has for one kind of job. Its name and summary are withheld.',
    'Write ONE message (one to three sentences) that a real user might send the agent: a task of their own, about a concrete situation, where the right way to handle it is to follow this instruction file.',
    STYLE_ASK[style],
    'Rules: do not mention skills, instruction files or procedures; do not name the job or its tool directly; do not copy any phrase of four or more words from the file; write the way a busy person types, with specifics (names of files, people, places or numbers you invent).',
    kept.length ? 'Describe a different situation from these messages, which other users already sent:\n' + kept.map((k) => '- ' + k).join('\n') : '',
    feedback ? 'Your previous attempt was rejected: ' + feedback : '',
    '--- instruction file body ---', body,
  ].filter(Boolean).join('\n\n');
}

export const noSkillPrompt = (topic: string, variant: number) => 'Write ONE short message (one or two sentences) a person might send an AI assistant: ' + topic + '. Make it specific and natural, with details you invent. Variant ' + variant + ' of ' + NO_SKILL_VARIANTS + '.';

/** A writer that answers from <cacheDir>/<key>.json and records every miss in pending. */
export function cacheWriter(cacheDir: string, pending: WriteRequest[]): Writer {
  return async (r) => {
    const f = join(cacheDir, r.key + '.json');
    if (existsSync(f)) return String(JSON.parse(readFileSync(f, 'utf8')).text ?? '').trim();
    pending.push(r);
    return null;
  };
}

/** Targets split per pack by seeded hash, alternating dev and test. */
export function halves(skills: Array<{ name: string; pack: string }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, group] of Object.entries(Object.groupBy(skills, (s) => s.pack)).sort(([a], [b]) => a.localeCompare(b)))
    group!.map((s) => s.name).sort((a, b) => h(SEED, 'half', a).localeCompare(h(SEED, 'half', b))).forEach((n, i) => out.set(n, i % 2 ? 'test' : 'dev'));
  return out;
}

export async function generate(o: { catalog: string; targets: string[]; writer: Writer }) {
  const m = JSON.parse(readFileSync(join(o.catalog, 'manifest.json'), 'utf8')) as Pick<Manifest, 'catalog_hash' | 'skills'>;
  const skills = new Map(m.skills.map((s) => [s.name, s]));
  const missing = o.targets.filter((t) => !skills.has(t));
  if (missing.length) throw new Error('HE-SCALE-SETL-001 ' + missing.length + ' target(s) are not in the catalog: ' + missing.slice(0, 5).join(', '));
  const targets = [...o.targets].sort();
  const half = halves(targets.map((t) => ({ name: t, pack: skills.get(t)!.pack })));
  const rows: Row[] = [];
  const drops: Array<{ id: string; target: string; style: Style; reason: string }> = [];
  let pending = 0;
  const ask = (prompt: string, system = WRITER_SYSTEM) => o.writer({ key: writeKey(WRITER_MODEL, system, prompt), model: WRITER_MODEL, system, prompt });

  const jobs = targets.map((t, i) => async () => {
    const s = skills.get(t)!;
    const raw = readFileSync(join(o.catalog, 'skills', t, 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?\n---\n?/, '');
    const body = maskBody(raw, s.original_name, s.description);
    const kept: string[] = [];
    for (const [k, style] of STYLES.entries()) {
      const id = 'l-s-' + String(i + 1).padStart(3, '0') + '-' + (k + 1);
      let feedback = '';
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const text = await ask(skillPrompt(body, style, kept, feedback));
        if (text === null) { pending++; return; }
        const ov = overlap(text, s.original_name, s.description, raw);
        const stratum = stratumOf(ov.nd_jaccard);
        const problem = ov.name_hit ? 'it names the job too directly; describe the situation instead.'
          : !stratum ? 'it reuses too many of the file\'s own words; use your own words for the situation.'
          : kept.some((x) => normal(x) === normal(text)) || !text ? 'it repeats an earlier message; describe a different situation.' : null;
        if (!problem && (stratum === style || attempt === MAX_ATTEMPTS)) {
          kept.push(text);
          rows.push({ id, kind: 'skill', target: t, pack: s.pack, style, stratum: stratum!, style_miss: stratum !== style, request: text, overlap: ov, attempts: attempt, half: half.get(t)! });
          break;
        }
        if (attempt === MAX_ATTEMPTS) { drops.push({ id, target: t, style, reason: problem! }); break; }
        feedback = problem ?? (STYLES.indexOf(stratum!) > STYLES.indexOf(style) ? 'it uses more of the field\'s own terms than asked; use fewer.' : 'it uses fewer of the field\'s own terms than asked; use more.');
      }
    }
  });
  const noneIds = NO_SKILL_TOPICS.flatMap((topic, j) => Array.from({ length: NO_SKILL_VARIANTS }, (_, k) => ({ id: 'l-n-' + String(j * NO_SKILL_VARIANTS + k + 1).padStart(3, '0'), topic, variant: k + 1 })));
  const noneHalf = new Map(noneIds.map((x) => x.id).sort((a, b) => h(SEED, 'half', a).localeCompare(h(SEED, 'half', b))).map((id, i) => [id, i % 2 ? 'test' : 'dev']));
  for (const x of noneIds) jobs.push(async () => {
    const text = await ask(noSkillPrompt(x.topic, x.variant));
    if (text === null) { pending++; return; }
    rows.push({ id: x.id, kind: 'none', target: null, topic: x.topic, request: text, half: noneHalf.get(x.id)! });
  });
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (next < jobs.length) await jobs[next++]!(); }));

  rows.sort((a, b) => a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const k = normal(r.request);
    if (seen.has(k)) { if (r.kind === 'skill') drops.push({ id: r.id, target: r.target, style: r.style, reason: 'duplicate text of an earlier request' }); return false; }
    seen.add(k); return true;
  });
  const skillRows = unique.filter((r): r is SkillRow => r.kind === 'skill');
  const spread = Object.fromEntries(STYLES.map((s) => [s, skillRows.filter((r) => r.stratum === s).length]));
  const plan = {
    schema: 'he-skills-at-scale-set-l-plan/1', seed: SEED, writer_model: WRITER_MODEL, writer_system_sha256: h(WRITER_SYSTEM), catalog_hash: m.catalog_hash,
    constants: { styles: STYLES, strata_upper: STRATA, max_nd_jaccard: MAX_ND_JACCARD, max_attempts: MAX_ATTEMPTS, min_stratum_share: MIN_STRATUM_SHARE, no_skill_variants: NO_SKILL_VARIANTS },
    targets, target_halves: Object.fromEntries(targets.map((t) => [t, half.get(t)])),
    counts: { skill: skillRows.length, none: unique.length - skillRows.length, dev: unique.filter((r) => r.half === 'dev').length, test: unique.filter((r) => r.half === 'test').length, style_miss: skillRows.filter((r) => r.style_miss).length },
    spread, spread_met: STYLES.every((s) => spread[s]! >= MIN_STRATUM_SHARE * skillRows.length), drops: drops.sort((a, b) => a.id.localeCompare(b.id)),
    attempts: Object.fromEntries([1, 2, 3].map((n) => [n, skillRows.filter((r) => r.attempts === n).length])),
  };
  return { rows: unique, plan, pending };
}

/** Refuses a directory that will hold sealed plaintext inside the checkout or any git work tree. */
function workTreeProblem(what: string, dir: string): string | null {
  const abs = resolve(dir);
  const rel = relative(ROOT, abs);
  if (!rel.startsWith('..') && !rel.startsWith('/')) return 'the ' + what + ' ' + abs + ' is inside the checkout; sealed plaintext is kept outside it';
  mkdirSync(abs, { recursive: true });
  try { if (execFileSync('git', ['-C', abs, 'rev-parse', '--is-inside-work-tree'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() === 'true') return 'the ' + what + ' ' + abs + ' is inside a git work tree'; } catch { }
  return null;
}

/** The writer cache holds every prompt and answer, test-half requests included, so it is refused where sealedDirProblem refuses. */
export const cacheDirProblem = (dir: string) => workTreeProblem('cache directory', dir);

/** Refuses a sealed directory inside the checkout or any git work tree, or one holding other files. */
export function sealedDirProblem(dir: string): string | null {
  const problem = workTreeProblem('sealed directory', dir);
  if (problem) return problem;
  const abs = resolve(dir);
  const other = readdirSync(abs).filter((f) => f !== 'setl-test.jsonl');
  return other.length ? 'the sealed directory holds other files (' + other.slice(0, 3).join(', ') + '); use a directory for the test half alone' : null;
}

export function writeSet(o: { rows: Row[]; plan: object; out: string; sealedDir: string }) {
  const problem = sealedDirProblem(o.sealedDir);
  if (problem) throw new Error('HE-SCALE-SETL-002 ' + problem);
  mkdirSync(o.out, { recursive: true });
  const lines = (rs: Row[]) => rs.map((r) => JSON.stringify(r));
  const dev = o.rows.filter((r) => r.half === 'dev'), test = o.rows.filter((r) => r.half === 'test');
  writeFileSync(join(o.out, 'setl-dev.jsonl'), lines(dev).join('\n') + '\n');
  writeFileSync(join(resolve(o.sealedDir), 'setl-test.jsonl'), lines(test).join('\n') + '\n');
  const sealed = { schema: 'he-skills-at-scale-set-l-sealed/1', seed: SEED, file: 'setl-test.jsonl', rows: test.length, ids: test.map((r) => r.id),
    row_sha256: Object.fromEntries(test.map((r) => [r.id, h(JSON.stringify(r))])), ...treeFiles(resolve(o.sealedDir)),
    custody: 'held by digest outside the checkout until the gbrain build is frozen (plan F10); scripts/sealed/seal.ts does not take request sets' };
  writeFileSync(join(o.out, 'setl-sealed.json'), JSON.stringify(sealed, null, 1) + '\n');
  writeFileSync(join(o.out, 'setl-plan.json'), JSON.stringify(o.plan, null, 1) + '\n');
  return sealed;
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
  const [catalog, ladder, cache, out, sealedDir] = ['catalog', 'ladder', 'cache', 'out', 'sealed-dir'].map(v);
  if (!catalog || !ladder || !cache || !out || !sealedDir) { console.error('usage: gen-set-l.ts --catalog <dir> --ladder <ladder.json> --cache <dir outside the checkout> --out <dir> --sealed-dir <dir outside the checkout>'); process.exit(2); }
  try {
    const problem = sealedDirProblem(sealedDir);
    if (problem) throw new Error('HE-SCALE-SETL-002 ' + problem);
    const cacheProblem = cacheDirProblem(cache);
    if (cacheProblem) throw new Error('HE-SCALE-SETL-004 ' + cacheProblem);
    const targets = (JSON.parse(readFileSync(ladder, 'utf8')).rungs?.['100'] ?? []) as string[];
    if (!targets.length) throw new Error('HE-SCALE-SETL-003 the ladder has no 100 rung of target skills');
    const pending: WriteRequest[] = [];
    mkdirSync(cache, { recursive: true });
    const g = await generate({ catalog, targets, writer: cacheWriter(cache, pending) });
    const pendingFile = join(cache, 'pending.jsonl');
    if (g.pending) {
      writeFileSync(pendingFile, pending.map((p) => JSON.stringify(p)).join('\n') + '\n');
      console.log('SETL_PENDING prompts=' + pending.length + ' file=' + pendingFile + ' (answer them into ' + cache + '/<key>.json and rerun)');
      process.exit(3);
    }
    rmSync(pendingFile, { force: true });
    const s = writeSet({ rows: g.rows, plan: g.plan, out, sealedDir });
    console.log('SETL rows=' + g.rows.length + ' skill=' + g.plan.counts.skill + ' none=' + g.plan.counts.none + ' spread=' + JSON.stringify(g.plan.spread) + ' spread_met=' + g.plan.spread_met + ' drops=' + g.plan.drops.length + ' sealed_rows=' + s.rows + ' tree_sha256=' + s.tree_sha256);
  } catch (e) { console.error((e as Error).message.startsWith('HE-') ? (e as Error).message : 'HE-SCALE-SETL-000 ' + (e as Error).message); process.exit(2); }
}
