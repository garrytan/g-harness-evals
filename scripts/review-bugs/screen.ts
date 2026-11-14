#!/usr/bin/env bun
// The two-judge screen for the real-bug review eval (plan internal-task, "Screening"; build step 1).
//
//   bun scripts/review-bugs/screen.ts --work <dir> --lease-usd 250 [--run-id review-bugs-screen-2026-11] [--limit <n>]
//       [--concurrency 6] [--no-second-read] [--batch 100] [--stop-units 150] [--seed 2665]
//
// Each candidate bug in <work>/candidates.jsonl goes to GPT-6 Astra and to Claude Opus 5.5 as one structured call each
// (scripts/failure-mining/llm.ts: Opus with the CREW.md judge settings, Astra with a strict schema, both with the fixed
// prefix cached). The packet holds the unit's diff for the file, the file at the unit head around the named line, what
// the source said (the review comment for S1 and S2, the fix PR's title and body for S3) and the fix's diff. Each judge
// says whether the bug is real, present at the head, and blocking under R12 (it would fail a test, break production, or
// lose data or secrets), restates it in its own words with the file and line at the head. A bug is kept only when both
// say real, present and blocking.
//
// A second read then checks each kept bug's description (Opus's) against the fix commit, on Astra: does the fix change
// exactly the defect described, and is the description accurate. A kept bug whose second read fails is dropped. The
// description must also share no run of 8 words with the source text (checked here, no model), so no third-party
// comment text reaches the suite; Astra's own description is the fallback.
//
// Every paid call goes through the metering proxy under one lease (--lease-usd) in <work>/screen/ledger.sqlite; the
// keys live only in the proxy's environment. Records are cached by request, so a rerun pays only for what it has not
// asked. The cache-read share of the first 10 paid calls is printed and written to <work>/screen/cache-check.json
// (CREW.md, "Cache fixed prefixes"). Output: <work>/screen/screen.jsonl, one line per bug, appended as each finishes.
//
// Units go in ranked batches (--batch, 100 units): the order the suite itself uses (rankUnits: the 40/20/40 strata mix,
// at most 4 units per repository first, then the rest), all of a unit's bugs together. After each batch the screen
// counts units with at least one kept bug, at most 4 per repository as the suite takes them, and stops once that count
// reaches --stop-units (150), so the pool is screened only as far as the suite needs. An S3 bug is screened only when
// repro.ts --stage s3 confirmed it (the plan's S3 rule), so the screen pays for no S3 bug the suite could not use.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLlm, LlmError, type Llm, type ModelId, type StructuredResult } from '../failure-mining/llm.ts';
import { git } from './git.ts';
import { rankUnits } from './build-suite.ts';
import { cloneDir, MAX_UNITS_PER_REPO, readJsonl, type Bug, type Candidate } from './mine.ts';

export const SCREEN_MODELS: readonly ModelId[] = ['openai:gpt-6-astra', 'anthropic:claude-opus-5-5'];
export const SECOND_READ_MODEL: ModelId = 'openai:gpt-6-astra';
export const TOOL = { name: 'record_screen', description: 'Record the screening verdict for this candidate bug.' };
export const SECOND_TOOL = { name: 'record_second_read', description: 'Record whether the description matches the fix.' };
const BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 32_000];

export const SCREEN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['real_defect', 'present_at_head', 'blocking', 'category', 'file', 'line', 'description', 'why_blocking', 'confidence'],
  properties: {
    real_defect: { type: 'boolean' },
    present_at_head: { type: 'boolean' },
    blocking: { type: 'boolean' },
    category: { type: 'string', enum: ['fails-a-test', 'breaks-production', 'loses-data-or-secrets', 'not-blocking', 'not-a-defect', 'cannot-tell'] },
    file: { type: 'string' },
    line: { type: 'integer' },
    description: { type: 'string' },
    why_blocking: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
} as const;

export const SECOND_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['fix_addresses_it', 'accurate', 'corrected_description', 'note'],
  properties: {
    fix_addresses_it: { type: 'boolean' },
    accurate: { type: 'boolean' },
    corrected_description: { type: ['string', 'null'] },
    note: { type: 'string' },
  },
} as const;

export const SCREEN_PREFIX = [
  'You screen candidate bugs for a benchmark of code review. Each message is one candidate: a pull request (PR) in a public open-source repository, reviewed at one commit (the unit head) against its base. You get the PR title, the unit diff for one file, that file at the unit head with line numbers around the place in question, what a source said about it, and the diff of the change that later fixed it.',
  'The source is either a review comment written on the PR (by a person or a review tool) that was followed by a fix before merge, or a later PR that fixed a bug and points at this PR as the one that introduced it. Treat the source as a claim to check, not as truth. Many review comments are style notes, questions or preferences, and many later fixes change behaviour that was never wrong.',
  'Decide, reading the code yourself:',
  '- real_defect: the code at the unit head is wrong (it does not do what the PR intends or what callers rely on), not merely improvable, untidy or a matter of taste.',
  '- present_at_head: the defect exists in the unit head as shown, in the lines this PR adds or changes or in code they newly reach.',
  '- blocking: the defect meets this bar, and only this bar: shipping it would fail a test (an existing test, or a test a maintainer would reasonably write for the PR\'s stated behaviour), break production (a crash, a hang, wrong results or wrong behaviour for real users or callers, a broken build or install), or lose data or secrets (data loss or corruption, a leak of credentials or private data, an exploitable security hole). Performance concerns, missing docs, naming, style, logging, refactors, defensive checks for inputs that cannot occur, and theoretical issues with no realistic trigger are not blocking.',
  '- category: the one that fits: fails-a-test, breaks-production, loses-data-or-secrets, not-blocking (real but below the bar), not-a-defect, or cannot-tell (the packet does not show enough).',
  '- file and line: where the defect sits at the unit head: the repository path and a line number in the head version shown to you (the line that is wrong, or the first line of the wrong block).',
  '- description: one to three plain sentences in your own words saying what is wrong and what goes wrong because of it, specific enough that a reader could tell whether another review found the same defect. Never copy or closely paraphrase the source\'s wording, never quote it, and never name people, accounts or tools.',
  '- why_blocking: one sentence naming the concrete consequence that meets the bar, or why it does not.',
  '- confidence: low, medium or high.',
  'Be strict. When the evidence is thin, say not blocking or cannot-tell. A fix commit proves that something changed, not that the old code was wrong.',
  'Examples of the bar. Blocking: an off-by-one that drops the last item of every page; a missing await that returns before the write lands; a nil check removed on a path that receives nil from a public API; a cache key that ignores the user id, so one user sees another user\'s data; an error swallowed so a failed upload reports success; a migration that drops a column still read in production. Not blocking: a variable could be named better; a loop could be faster on large inputs; a comment is out of date; a log line is missing; an unreachable branch is not handled; a test could cover more cases; a suggestion to use a newer API.',
].join('\n');

export const SECOND_PREFIX = [
  'You check answer keys for a benchmark of code review. Each message gives a defect description written for one pull request at one commit (the unit head), the location it names, the code at that location, and the diff of the commit that fixed the defect.',
  'Decide:',
  '- fix_addresses_it: the fix diff changes the code the description is about, in a way that removes the defect described (not some other problem in the same file).',
  '- accurate: every claim in the description is true of the code shown: the location, what is wrong and what goes wrong. A description that overstates the consequence, names the wrong function or variable, or describes the fix instead of the defect is not accurate.',
  '- corrected_description: null when the description is accurate; otherwise one to three plain sentences that are accurate, in your own words, naming no people, accounts or tools; or null when no accurate description of a defect the fix removes is possible.',
  '- note: one sentence on what you checked.',
].join('\n');

const lines = (s: string, max: number) => {
  const all = s.split('\n');
  return all.length <= max ? s : all.slice(0, max).join('\n') + '\n[... ' + (all.length - max) + ' more lines cut]';
};

/** The file at rev with line numbers, from line-from to line+to. */
export function excerpt(dir: string, rev: string, path: string, line: number | null, before = 40, after = 40): string {
  const r = git(dir, ['show', rev + ':' + path]);
  if (r.code !== 0) return '(the file does not exist at this commit)';
  const all = r.out.split('\n');
  const at = line ?? 1;
  const a = Math.max(1, at - before), b = Math.min(all.length, at + after);
  return all.slice(a - 1, b).map((l, i) => String(a + i).padStart(5) + '  ' + l).join('\n');
}

export function fixRange(bug: Bug, dir: string, head: string): [string, string] {
  if (bug.fix.kind === 'later-pr') return [bug.fix.commit + '^', bug.fix.commit];
  return [head, bug.fix.commit];
}

export function packet(c: Candidate, bug: Bug, dir: string): string {
  const head = c.head!;
  const [fa, fb] = fixRange(bug, dir, head);
  const unitDiff = git(dir, ['diff', '--no-ext-diff', '-U3', c.base! + '...' + head, '--', bug.path]).out;
  const fixPaths = bug.fix.kind === 'later-pr' ? [bug.path, ...bug.fix.tests.slice(0, 3)] : [bug.path];
  const fixDiff = git(dir, ['diff', '--no-ext-diff', '-U3', fa, fb, '--', ...fixPaths]).out;
  const files = git(dir, ['diff', '--name-only', c.base! + '...' + head]).out.split('\n').filter(Boolean);
  return JSON.stringify({
    repository: c.repo, pr: c.pr, title: c.title,
    unit_files_changed: files.slice(0, 60),
    file: bug.path, line_named_by_source: bug.line,
    unit_diff_for_file: lines(unitDiff, 260),
    file_at_unit_head: excerpt(dir, head, bug.path, bug.line),
    source: { kind: bug.source.kind === 'review-comment' ? (bug.source.reviewer === 'tool' ? 'review comment by a review tool' : 'review comment by a person') : 'later fix PR that points at this PR', text: lines(bug.source.text, 60) },
    fix_diff: lines(fixDiff, 220),
  }, null, 1);
}

/** Runs of n words the two texts share, lower-cased: an empty list means the description is in its own words. */
export function sharedRuns(a: string, b: string, n = 8): string[] {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9_.]+/g, ' ').trim().split(' ').map((w) => w.replace(/^\.+|\.+$/g, '')).filter(Boolean);
  const grams = (w: string[]) => new Set(w.map((_, i) => w.slice(i, i + n).join(' ')).filter((g) => g.split(' ').length === n));
  const gb = grams(words(b));
  return [...grams(words(a))].filter((g) => gb.has(g));
}

export interface ScreenRecord {
  real_defect: boolean; present_at_head: boolean; blocking: boolean; category: string; file: string; line: number; description: string; why_blocking: string; confidence: string;
}
export interface SecondRecord { fix_addresses_it: boolean; accurate: boolean; corrected_description: string | null; note: string }
export interface ScreenLine {
  unit: string; bug: number; stratum: string; verdicts: Record<string, ScreenRecord | null>; kept: boolean;
  second: SecondRecord | null; final: { file: string; line: number; description: string; why_blocking: string; category: string } | null; dropped: string | null;
}

export function validScreen(v: unknown): v is ScreenRecord {
  const r = v as ScreenRecord;
  return !!r && typeof r.real_defect === 'boolean' && typeof r.present_at_head === 'boolean' && typeof r.blocking === 'boolean' && typeof r.file === 'string' && Number.isSafeInteger(r.line) && typeof r.description === 'string' && r.description.length > 10;
}
export const says = (r: ScreenRecord | null) => !!r && r.real_defect && r.present_at_head && r.blocking;

async function ask(llm: Llm, model: ModelId, prefix: string, pkt: string, schema: Record<string, unknown>, tool: { name: string; description: string }, valid: (v: unknown) => boolean): Promise<{ value: unknown; usage: StructuredResult['usage'] }> {
  let feedback: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (let i = 0; ; i++) {
      try {
        const res = await llm.structured({ model, prefix, packet: pkt, schema, tool, ...(feedback ? { feedback } : {}) }, { refresh: attempt > 0 });
        if (valid(res.value)) return { value: res.value, usage: res.usage };
        feedback = 'Your previous reply did not carry one valid record. Return exactly one record with every field the schema names.';
        break;
      } catch (e) {
        const code = e instanceof LlmError ? e.code : 'E_UNKNOWN';
        if (code === 'E_BUDGET') throw e;
        const transient = /^E_HTTP_(429|5\d\d)$/.test(code);
        if (!transient || i >= BACKOFF_MS.length) return { value: null, usage: null };
        await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
      }
    }
  }
  return { value: null, usage: null };
}

/** The order units are screened in: the suite's ranking within the per-repository cap, then the remaining units. */
export function screenOrder(units: readonly Candidate[], seed: number, cap = MAX_UNITS_PER_REPO): Candidate[] {
  const byId = new Map(units.map((c) => [c.id, c]));
  const items = units.filter((c) => c.stratum !== 'N').map((c) => ({ id: c.id, repo: c.repo, stratum: c.stratum as 'S1' | 'S2' | 'S3', repro: false }));
  const first = rankUnits(items, seed, cap);
  const taken = new Set(first.map((x) => x.id));
  const counts = new Map<string, number>();
  for (const x of first) counts.set(x.repo, (counts.get(x.repo) ?? 0) + 1);
  const rest = rankUnits(items.filter((x) => !taken.has(x.id)), seed, Number.MAX_SAFE_INTEGER, counts);
  return [...first, ...rest].map((x) => byId.get(x.id)!);
}

/** Units with at least one kept bug, counting at most cap per repository, as the suite would take them. */
export function keptUnits(lines: readonly ScreenLine[], units: readonly Candidate[], cap = MAX_UNITS_PER_REPO): number {
  const kept = new Set(lines.filter((l) => l.kept).map((l) => l.unit));
  const per = new Map<string, number>();
  for (const c of units) if (kept.has(c.id)) per.set(c.repo, Math.min(cap, (per.get(c.repo) ?? 0) + 1));
  return [...per.values()].reduce((a, n) => a + n, 0);
}

/** Repositories that already have cap kept units, so screening more of their units cannot add to the suite. */
export function fullRepos(lines: readonly ScreenLine[], units: readonly Candidate[], cap = MAX_UNITS_PER_REPO): Set<string> {
  const kept = new Set(lines.filter((l) => l.kept).map((l) => l.unit));
  const per = new Map<string, number>();
  for (const c of units) if (kept.has(c.id)) per.set(c.repo, (per.get(c.repo) ?? 0) + 1);
  return new Set([...per].filter(([, n]) => n >= cap).map(([r]) => r));
}

/** A bug whose judge call failed is not written to screen.jsonl, so the next run asks again. */
export const NO_RECORD = 'a judge returned no record';

export async function screenBug(llm: Llm, c: Candidate, b: number, dir: string, secondRead: boolean, onUsage: (model: string, u: StructuredResult['usage']) => void): Promise<ScreenLine> {
  const bug = c.bugs[b]!;
  const pkt = packet(c, bug, dir);
  const verdicts: Record<string, ScreenRecord | null> = {};
  await Promise.all(SCREEN_MODELS.map(async (m) => {
    const r = await ask(llm, m, SCREEN_PREFIX, pkt, SCREEN_SCHEMA as unknown as Record<string, unknown>, TOOL, validScreen);
    onUsage(m, r.usage);
    verdicts[m] = (r.value as ScreenRecord) ?? null;
  }));
  const base = { unit: c.id, bug: b, stratum: c.stratum, verdicts };
  const opus = verdicts['anthropic:claude-opus-5-5'] ?? null, astra = verdicts['openai:gpt-6-astra'] ?? null;
  if (!opus || !astra) return { ...base, kept: false, second: null, final: null, dropped: NO_RECORD };
  if (!says(opus) || !says(astra)) return { ...base, kept: false, second: null, final: null, dropped: 'not blocking for both judges' };
  if (!secondRead) return { ...base, kept: true, second: null, final: null, dropped: null };
  const [fa, fb] = fixRange(bug, dir, c.head!);
  const second = JSON.stringify({
    description: opus.description, file: opus.file, line: opus.line,
    code_at_unit_head: excerpt(dir, c.head!, opus.file, opus.line, 25, 25),
    fix_diff: lines(git(dir, ['diff', '--no-ext-diff', '-U3', fa, fb, '--', opus.file]).out || git(dir, ['diff', '--no-ext-diff', '-U3', fa, fb, '--', bug.path]).out, 220),
  }, null, 1);
  const s = await ask(llm, SECOND_READ_MODEL, SECOND_PREFIX, second, SECOND_SCHEMA as unknown as Record<string, unknown>, SECOND_TOOL, (v) => !!v && typeof (v as SecondRecord).accurate === 'boolean' && typeof (v as SecondRecord).fix_addresses_it === 'boolean');
  onUsage(SECOND_READ_MODEL, s.usage);
  const sr = (s.value as SecondRecord) ?? null;
  if (!sr) return { ...base, kept: false, second: null, final: null, dropped: 'the second read returned no record' };
  if (!sr.fix_addresses_it) return { ...base, kept: false, second: sr, final: null, dropped: 'the second read found the fix does not address the description' };
  const options = [sr.accurate ? opus.description : sr.corrected_description, astra.description].filter((d): d is string => !!d);
  const description = options.find((d) => sharedRuns(d, bug.source.text).length === 0);
  if (!description) return { ...base, kept: false, second: sr, final: null, dropped: 'no description free of the source text' };
  return { ...base, kept: true, second: sr, final: { file: opus.file, line: opus.line, description, why_blocking: opus.why_blocking, category: opus.category }, dropped: null };
}

function flagsOf(argv: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) if (argv[i]!.startsWith('--')) m.set(argv[i]!, argv[i + 1]?.startsWith('--') ? 'true' : argv[i + 1] ?? 'true');
  return m;
}

if (import.meta.main) {
  const f = flagsOf(process.argv.slice(2));
  const work = resolve(f.get('--work') ?? '');
  const lease = Number(f.get('--lease-usd'));
  if (!existsSync(join(work, 'candidates.jsonl')) || !(lease > 0)) { process.stderr.write('usage: see the header of scripts/review-bugs/screen.ts\n'); process.exit(2); }
  const out = join(work, 'screen');
  mkdirSync(out, { recursive: true });
  const outFile = join(out, 'screen.jsonl');
  const done = new Set(existsSync(outFile) ? readJsonl<ScreenLine>(outFile).map((l) => l.unit + ' ' + l.bug) : []);
  const reproFile = join(work, 'repro', 'results.jsonl');
  const confirmed = new Set((existsSync(reproFile) ? readJsonl<{ unit: string; bug: number; status: string }>(reproFile) : []).filter((r) => r.status === 'confirmed').map((r) => r.unit + ' ' + r.bug));
  const screenable = (c: Candidate, b: number) => c.stratum !== 'S3' || confirmed.has(c.id + ' ' + b);
  const units = readJsonl<Candidate>(join(work, 'candidates.jsonl')).filter((c) => c.stratum !== 'N' && c.head && c.base && c.bugs.some((_, b) => screenable(c, b)));
  if (!existsSync(reproFile)) process.stderr.write('screen: no repro results yet, so no S3 unit is screened (run repro.ts plan --stage s3, run and collect first)\n');
  const ordered = screenOrder(units, Number(f.get('--seed') ?? 2665));
  const batchSize = Number(f.get('--batch') ?? 100), target = Number(f.get('--stop-units') ?? 150);
  const limit = Number(f.get('--limit') ?? Infinity);
  const llm = await createLlm({ cacheDir: join(out, 'cache'), proxy: { dir: join(out, 'proxy'), ledger: join(out, 'ledger.sqlite'), leaseUsd: lease, runId: f.get('--run-id') ?? 'review-bugs-screen-2026-11' } });
  const first: Array<{ model: string; input: number; cached: number; write: number }> = [];
  const onUsage = (model: string, u: StructuredResult['usage']) => {
    if (!u || first.length >= 10) return;
    first.push({ model, input: u.input_tokens, cached: u.cached_input_tokens, write: u.cache_write_tokens });
    if (first.length === 10) {
      const share = (m: string) => { const xs = first.filter((x) => x.model === m); const inp = xs.reduce((a, x) => a + x.input + (m.startsWith('anthropic') ? x.cached + x.write : 0), 0); return inp ? xs.reduce((a, x) => a + x.cached, 0) / inp : null; };
      const check = { calls: first, cache_read_share: Object.fromEntries(SCREEN_MODELS.map((m) => [m, share(m)])) };
      writeFileSync(join(out, 'cache-check.json'), JSON.stringify(check, null, 1) + '\n');
      process.stderr.write('screen: cache-read share on the first 10 paid calls: ' + JSON.stringify(check.cache_read_share) + '\n');
    }
  };
  let kept = 0, n = 0, failed = 0, screenedUnits = 0;
  let stop: string | null = null;
  const lines = () => (existsSync(outFile) ? readJsonl<ScreenLine>(outFile) : []);
  for (let at = 0; at < ordered.length && !stop; at += batchSize) {
    const have = keptUnits(lines(), units);
    if (have >= target) { stop = 'target'; process.stderr.write('screen: ' + have + ' kept units reach the target of ' + target + '\n'); break; }
    const batch = ordered.slice(at, at + batchSize);
    screenedUnits = at + batch.length;
    const full = fullRepos(lines(), units);
    const todo = batch.filter((c) => !full.has(c.repo)).flatMap((c) => c.bugs.map((_, b) => ({ c, b }))).filter((x) => screenable(x.c, x.b) && !done.has(x.c.id + ' ' + x.b)).slice(0, Math.max(0, limit - n));
    let next = 0;
    await Promise.all(Array.from({ length: Number(f.get('--concurrency') ?? 6) }, async () => {
      while (next < todo.length && !stop) {
        const { c, b } = todo[next++]!;
        try {
          const line = await screenBug(llm, c, b, cloneDir(work, c.repo), f.get('--no-second-read') !== 'true', onUsage);
          n += 1;
          if (line.dropped === NO_RECORD) { failed += 1; if (failed >= 10) stop = 'judge failures'; continue; }
          appendFileSync(outFile, JSON.stringify(line) + '\n');
          if (line.kept) kept += 1;
        } catch (e) {
          if (e instanceof LlmError && e.code === 'E_BUDGET') stop = 'E_BUDGET';
          else throw e;
        }
      }
    }));
    process.stderr.write('screen: batch to unit ' + screenedUnits + ' of ' + ordered.length + ': ' + n + ' bugs this run, ' + kept + ' kept, ' + keptUnits(lines(), units) + ' kept units, $' + llm.stats().usd.toFixed(2) + '\n');
    if (n >= limit) { stop = stop ?? 'limit'; break; }
  }
  const stats = await llm.close();
  const final = keptUnits(lines(), units);
  writeFileSync(join(out, 'spend.json'), JSON.stringify({ ...stats, lease_usd: lease, stopped: stop, units_in_pool: ordered.length, units_reached: screenedUnits, kept_units: final, usd_per_kept_unit: final ? stats.usd / final : null }, null, 1) + '\n');
  process.stderr.write('screen: ' + n + ' bugs this run, ' + kept + ' kept, ' + final + ' kept units, ' + failed + ' judge failures left for the next run, $' + stats.usd.toFixed(2) + ' metered this run' + (stop ? ', stopped: ' + stop : '') + '\n');
  if (stop === 'E_BUDGET' || stop === 'judge failures') process.exit(3);
}
