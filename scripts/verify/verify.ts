#!/usr/bin/env bun
// bun run verify: rebuild every published analysis from the run's committed receipts and compare it with the
// published file. Needs no API keys: every step only reads committed files, and runs with an empty environment apart
// from PATH, HOME, TMPDIR, LANG and TZ. Nothing under docs/benchmarks/ is written: each run's folder is copied into a
// scratch folder (with the files a step writes left out), and git status is compared before and after.
//
//   bun run verify                    every published run, then the README and scoreboard page
//   bun run verify --run <folder>     one run (repeatable); skips the coverage and README checks
//   bun run verify --list             what each recipe rebuilds, its known differences and what it can't rebuild
//   bun run verify --jobs <n>         runs rebuilt at once (default: CPU count)
//
// Exit 0 when every published number matches or is listed as known, 1 when anything differs, 2 on a bad recipe or
// argument. Recipes live in scripts/verify/runs/<folder>.json; docs/verify.md explains them.
import { spawn, spawnSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { asPublished, compareJson, compareText, countNumbers, describe, describeLine, getAt, MISSING, show, type Difference, type LineDifference } from './compare.ts';
import { loadRecipes, missingRequirements, publishedRuns, RECIPES_DIR, validateRecipe, volatileHoldsNumber, type Known, type Recipe, type Step } from './recipes.ts';

export const SCRATCH = '.verify-scratch';

export type Status = 'match' | 'known' | 'differs' | 'not-rebuilt' | 'unavailable';

export interface RunResult {
  run: string;
  status: Status;
  files: number;
  numbers: number;
  seconds: number;
  failures: string[];
  added: number;
  known: string[];
  gaps: string[];
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sideOf = (k: Known, side: 'committed' | 'rebuilt') => (side in k ? k[side] : MISSING);

function scrubbedEnv(tmp: string): Record<string, string> {
  const home = join(tmp, 'home');
  mkdirSync(home, { recursive: true });
  return { PATH: [dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin'].join(':'), HOME: home, TMPDIR: tmp, LANG: 'C.UTF-8', TZ: 'UTC', NO_COLOR: '1' };
}

// Copy the run folder into the scratch folder (.verify-scratch/, ignored by git). Every file is a real copy (a
// copy-on-write clone where the file system has them), so a step that writes or truncates any file, a trial file
// included, only changes the copy. Each output is left out of the copy, so a step writes it fresh. main() still compares
// git status before and after.

export function mirror(src: string, dst: string, outputs: string[], rel = ''): void {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const path = rel ? rel + '/' + e.name : e.name;
    if (outputs.includes(path)) continue;
    const from = join(src, e.name);
    const to = join(dst, e.name);
    if (e.isDirectory()) mirror(from, to, outputs, path);
    else if (e.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
    else copyFileSync(from, to, constants.COPYFILE_FICLONE);
  }
}

function run(cmd: string[], cwd: string, env: Record<string, string>, timeoutS: number): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((done) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, timeoutS * 1000);
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => err.push(b));
    child.on('error', (e) => { clearTimeout(timer); done({ code: 127, stdout: '', stderr: String(e), timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut }); });
  });
}

const MAX_LINES = 10;

function report(lines: string[], into: string[]) {
  into.push(...lines.slice(0, MAX_LINES));
  if (lines.length > MAX_LINES) into.push('... and ' + (lines.length - MAX_LINES) + ' more differences in the same file');
}

export async function verifyRun(root: string, recipe: Recipe, keep = false): Promise<RunResult> {
  const started = Date.now();
  const result: RunResult = { run: recipe.run, status: 'match', files: 0, numbers: 0, seconds: 0, failures: [], added: 0, known: [], gaps: [] };
  for (const g of recipe.not_rebuilt ?? []) result.gaps.push(g.what + (g.file ? ' (' + g.file + ')' : '') + ': ' + g.reason);
  const steps = recipe.steps ?? [];
  const missing = missingRequirements(root, recipe);
  if (missing.length) { result.status = 'unavailable'; result.gaps.push('this copy of the repository does not have ' + missing.join(', ') + ' (the public copy leaves some private folders out), so the run can only be checked in the full repository'); return result; }
  if (!steps.length) { result.status = 'not-rebuilt'; return result; }
  const src = join(root, 'docs/benchmarks', recipe.run);
  mkdirSync(join(root, SCRATCH), { recursive: true });
  const tmp = mkdtempSync(join(root, SCRATCH, recipe.run + '-'));
  const shadow = join(tmp, recipe.run);
  const outputs = [...new Set(steps.flatMap((s: Step) => [...(s.outputs ?? []), ...(s.stdout && 'file' in s.stdout ? [s.stdout.file] : [])]))];
  const usedKnown = new Set<Known>();
  const isKnownJson = (file: string, d: Difference) => {
    const k = (recipe.known ?? []).find((x) => x.file === file && x.path === d.path && sameValue(sideOf(x, 'committed'), d.committed) && sameValue(sideOf(x, 'rebuilt'), d.rebuilt));
    if (k) usedKnown.add(k);
    return k;
  };
  const isKnownLine = (file: string, d: LineDifference, contained: boolean) => {
    const k = (recipe.known ?? []).find((x) => x.file === file && (contained ? (x.rebuilt ?? null) === d.rebuilt : x.line === d.line && (x.committed ?? null) === d.committed && (!('rebuilt' in x) || (x.rebuilt ?? null) === d.rebuilt)));
    if (k) usedKnown.add(k);
    return k;
  };
  try {
    mirror(src, shadow, outputs);
    const env = scrubbedEnv(tmp);
    for (const [i, s] of steps.entries()) {
      const args = s.cmd.map((a) => a.replaceAll('{run}', shadow).replaceAll('{src}', src).replaceAll('{repo}', root));
      const cmd = args[0] === 'bun' ? [process.execPath, '--no-env-file', ...args.slice(1)] : args;
      const r = await run(cmd, root, env, s.timeout_s ?? 900);
      const shown = s.cmd.join(' ');
      if (s.self_check && !r.timedOut && r.code === 1) {
        const said = (r.stdout + r.stderr).trim().split('\n').filter((l) => !l.startsWith('gstack bun shim')).slice(-5).join('\n    ');
        result.failures.push('step ' + (i + 1) + ' (' + shown + ') says its published output no longer matches what the script computes from the receipts' + (said ? ':\n    ' + said : '.'));
        continue;
      }
      if (s.self_check && !r.timedOut && r.code === 0) { result.files++; continue; }
      if (r.timedOut || r.code !== 0) {
        const tail = r.stderr.trim().split('\n').slice(-5).join('\n    ');
        result.failures.push('step ' + (i + 1) + ' (' + shown + ') ' + (r.timedOut ? 'ran past its ' + (s.timeout_s ?? 900) + ' s limit' : 'stopped with exit code ' + r.code) + ', so nothing it rebuilds could be checked' + (tail ? ':\n    ' + tail : '.'));
        break;
      }
      if (s.stdout && 'file' in s.stdout) writeFileSync(join(shadow, s.stdout.file), r.stdout);
      if (s.stdout && 'contained_in' in s.stdout) {
        const file = s.stdout.contained_in;
        const published = readFileSync(join(src, file), 'utf8');
        const have = new Set(published.split('\n'));
        const block = r.stdout.replace(/\n+$/, '');
        result.files++;
        if (!block.trim()) { result.failures.push(file + ': step ' + (i + 1) + ' printed nothing, so there is nothing to find in the published file.'); continue; }
        if (published.includes(block)) continue;
        const lost = block.split('\n').map((t, n) => ({ line: n + 1, committed: null, rebuilt: t })).filter((d) => d.rebuilt.trim() && !have.has(d.rebuilt));
        const lines = lost.filter((d) => !isKnownLine(file, d, true)).map((d) => file + ': the line ' + JSON.stringify(d.rebuilt.length > 160 ? d.rebuilt.slice(0, 157) + '...' : d.rebuilt) + ', printed by step ' + (i + 1) + ' from the receipts, is not in the published file.');
        if (!lost.length) lines.push(file + ': every line printed by step ' + (i + 1) + ' is in the published file, but not in the same order or not together.');
        report(lines, result.failures);
      }
    }
    if (!result.failures.length) {
      for (const f of outputs) {
        const omitted = (recipe.public_copy_omits ?? []).find((o) => o.file === f);
        if (omitted && !existsSync(join(src, f))) { result.gaps.push(f + ': this copy of the repository leaves it out (' + omitted.reason + '), so it was rebuilt but not compared'); continue; }
        const rebuiltPath = join(shadow, f);
        if (!existsSync(rebuiltPath)) { result.failures.push(f + ': the recipe says a step writes this file, but no step wrote it.'); continue; }
        result.files++;
        const committedText = readFileSync(join(src, f), 'utf8');
        const rebuiltText = readFileSync(rebuiltPath, 'utf8');
        if (f.endsWith('.json')) {
          const committed = JSON.parse(committedText);
          const rebuilt = JSON.parse(rebuiltText);
          const volatile = (recipe.volatile ?? []).filter((v): v is typeof v & { path: string } => v.file === f && v.path !== undefined);
          for (const v of volatile) {
            const c = getAt(committed, v.path);
            if (c !== MISSING && volatileHoldsNumber(c)) result.failures.push(f + ': ' + v.path + ' is marked volatile, but it holds a number (' + show(c) + '); a number must match or be listed as a known difference.');
          }
          const diffs = compareJson(committed, rebuilt).filter((d) => !volatile.some((v) => d.path === v.path || d.path.startsWith(v.path + '.') || d.path.startsWith(v.path + '[')));
          result.numbers += countNumbers(committed);
          const added = diffs.filter((d) => d.committed === MISSING);
          result.added += added.length;
          report(diffs.filter((d) => d.committed !== MISSING && !isKnownJson(f, d)).map((d) => describe(f, d)), result.failures);
        } else {
          let published = asPublished(committedText), rebuilt = asPublished(rebuiltText);
          for (const v of (recipe.volatile ?? []).filter((x) => x.file === f && x.pattern)) {
            const re = new RegExp(v.pattern!, 'g');
            for (const m of published.matchAll(re)) if (!/[A-Za-z]/.test(m[0])) result.failures.push(f + ': the volatile pattern ' + JSON.stringify(v.pattern) + ' hides ' + JSON.stringify(m[0]) + ', which looks like a number; a number must match or be listed as a known difference.');
            published = published.replace(re, '<not compared>');
            rebuilt = rebuilt.replace(re, '<not compared>');
          }
          const { differences, added } = compareText(published, rebuilt);
          result.added += added;
          report(differences.filter((d) => !isKnownLine(f, d, false)).map((d) => describeLine(f, d)), result.failures);
        }
      }
      for (const k of recipe.known ?? []) {
        const where = k.file + (k.path ? ' ' + k.path : k.line ? ' line ' + k.line : '');
        if (usedKnown.has(k)) result.known.push(where + ': published ' + show(sideOf(k, 'committed')) + ', rebuilds to ' + show(sideOf(k, 'rebuilt')) + '. ' + k.reason);
        else result.failures.push(where + ': listed as a known difference, but the rebuild no longer shows it (published and rebuilt now ' + (k.path ? 'give ' + show(getAtSafe(join(src, k.file), k.path)) : 'differ in another way') + '). Remove the entry from ' + RECIPES_DIR + '/' + recipe.run + '.json.');
      }
    }
  } finally {
    if (!keep) rmSync(tmp, { recursive: true, force: true });
  }
  result.status = result.failures.length ? 'differs' : result.known.length ? 'known' : 'match';
  result.seconds = (Date.now() - started) / 1000;
  return result;
}

function getAtSafe(file: string, path: string): unknown {
  try { return getAt(JSON.parse(readFileSync(file, 'utf8')), path); } catch { return MISSING; }
}

// The receipts manifest records each run's receipt hashes and counts, and also the commit that added its
// preregistration and every later commit that changed it. Those commit ids only exist in the history they came from:
// the public copy has its own history. So in the public copy the history fields are compared only when this clone has
// the recorded commit; the hashes and counts are always compared. In the full repository (CI checks it out with full
// history) every recorded commit must exist and the history fields are always compared, so a made-up commit is a
// mismatch. The public copy also holds some runs' trial lists back for a later export while keeping their manifest
// rows, so a row whose trial list is not in this clone is skipped and counted in the output, as is any ledger, usage
// log or extra trial list the manifest names that this clone does not have. Those skips apply only in the public copy,
// which has no publication/manifest.json; in the full repository a missing receipt is a mismatch.
export const isPublicCopy = (root: string) => !existsSync(join(root, 'publication/manifest.json'));

export function checkReceiptsManifest(root: string): { failures: string[]; note: string } {
  const out = join(root, SCRATCH, 'receipts-manifest.json');
  mkdirSync(join(root, SCRATCH), { recursive: true });
  const m = spawnSync(process.execPath, ['--no-env-file', 'scripts/receipts-manifest.ts', '--out', out], { cwd: root, encoding: 'utf8', env: scrubbedEnv(join(root, SCRATCH)), maxBuffer: 1 << 26 });
  if (m.status !== 0) return { failures: ['scripts/receipts-manifest.ts failed: ' + (m.stdout + m.stderr).trim().split('\n').slice(-MAX_LINES).join(' ')], note: '' };
  const committed = JSON.parse(readFileSync(join(root, 'docs/receipts-manifest.json'), 'utf8'));
  const rebuilt = JSON.parse(readFileSync(out, 'utf8'));
  rmSync(out, { force: true });
  const haveCommit = (sha: unknown) => typeof sha === 'string' && spawnSync('git', ['cat-file', '-e', sha + '^{commit}'], { cwd: root }).status === 0;
  const publicCopy = isPublicCopy(root);
  const unknownCommits: string[] = [];
  let skipped = 0;
  for (const run of committed.runs ?? []) {
    const first = run.preregistration?.first_commit;
    if (first === null || first === undefined || haveCommit(first)) continue;
    if (!publicCopy) { unknownCommits.push('docs/receipts-manifest.json: ' + run.directory + ' records preregistration commit ' + first + ', which is not in this clone\'s history'); continue; }
    skipped++;
    delete run.preregistration;
    const twin = (rebuilt.runs ?? []).find((r: { directory: string }) => r.directory === run.directory);
    if (twin) delete twin.preregistration;
  }
  const held = new Set<string>();
  if (publicCopy) for (const run of committed.runs ?? []) if (!existsSync(join(root, run.trials_jsonl ?? run.directory + '/results/trials.jsonl'))) held.add(run.directory);
  for (const m of [committed, rebuilt]) m.runs = (m.runs ?? []).filter((r: { directory: string }) => !held.has(r.directory));
  let leftOut = 0;
  if (publicCopy) for (const run of committed.runs ?? []) for (const key of ['ledgers', 'proxy_usage_logs', 'other_trials_jsonl']) {
    if (!Array.isArray(run[key])) continue;
    const kept = run[key].filter((e: { path: string }) => existsSync(join(root, e.path)));
    leftOut += run[key].length - kept.length;
    run[key] = kept;
  }
  delete committed.generated_at;
  delete rebuilt.generated_at;
  const failures: string[] = [...unknownCommits];
  if (JSON.stringify(committed) !== JSON.stringify(rebuilt)) {
    for (const d of compareJson(committed, rebuilt)) failures.push(describe('docs/receipts-manifest.json', d));
    if (failures.length === unknownCommits.length) failures.push('docs/receipts-manifest.json differs from what the receipts give (the order of its entries changed)');
  }
  if (failures.length) failures.push('if the receipts are right, run bun scripts/receipts-manifest.ts and commit the result');
  const notes = [
    ...(skipped ? ['for ' + skipped + ' runs the commit that added the preregistration is not in this clone\'s history, so those commit ids were not compared'] : []),
    ...(leftOut ? [leftOut + ' ledgers, usage logs or trial lists the manifest names are not in this copy of the repository, so their hashes were not compared'] : []),
    ...(held.size ? ['this copy of the repository leaves out the trial list of ' + [...held].join(', ') + ', so ' + (held.size === 1 ? 'its row was' : 'their rows were') + ' not compared'] : []),
  ];
  return { failures, note: notes.map((n) => '; ' + n).join('') };
}

export function receiptsStatus(root: string): string | null {
  const r = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', 'docs/benchmarks'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stdout : null;
}

async function pool<T, R>(items: T[], jobs: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); }
  }));
  return out;
}

const LABEL: Record<Status, string> = { match: 'MATCH  ', known: 'KNOWN  ', differs: 'DIFFERS', 'not-rebuilt': 'CAN\'T REBUILD', unavailable: 'UNAVAILABLE' };

export function printRun(r: RunResult, log: (s: string) => void): void {
  const head = r.status === 'not-rebuilt' || r.status === 'unavailable'
    ? LABEL[r.status] + ' ' + r.run
    : LABEL[r.status] + ' ' + r.run + ': ' + r.files + ' published file' + (r.files === 1 ? '' : 's') + ' rebuilt, ' + r.numbers.toLocaleString('en-US') + ' numbers compared, ' + r.seconds.toFixed(0) + ' s';
  log(head + (r.added ? '; the rebuild also adds ' + r.added + ' value' + (r.added === 1 ? '' : 's') + ' the published files don\'t have (fields the scripts gained later), which are not published and not compared' : ''));
  for (const f of r.failures) log('    MISMATCH ' + f);
  for (const k of r.known) log('    known: ' + k);
  for (const g of r.gaps) log('    can\'t rebuild: ' + g);
}

const ROW_NOTE: Record<Status, string> = {
  match: 'its run rebuilds and matches',
  known: 'its run matches apart from the known differences listed above',
  differs: 'its run does NOT rebuild cleanly, see above',
  'not-rebuilt': 'its run can\'t be rebuilt from receipts, see above',
  unavailable: 'its run can\'t be checked in this copy of the repository',
};

export async function checkScoreboard(root: string, log: (s: string) => void, statusOf: Map<string, Status>): Promise<string[]> {
  const { buildAll } = (await import(join(root, 'scripts/scoreboard/build.ts'))) as typeof import('../scoreboard/build.ts');
  const failures: string[] = [];
  const built = buildAll(root);
  for (const [file, want] of [['README.md', built.readme], ['docs/scoreboard.md', built.page]] as const) {
    const published = readFileSync(join(root, file), 'utf8');
    if (published === want) continue;
    const { differences, added } = compareText(published, want);
    for (const d of differences.slice(0, MAX_LINES)) failures.push(describeLine(file, d).replaceAll('rebuilding from the receipts', 'building it from the analysis files'));
    if (!differences.length) failures.push(file + ': building it from the analysis files adds ' + added + ' line' + (added === 1 ? '' : 's') + ' the published file does not have; run bun scripts/scoreboard/build.ts.');
  }
  for (const t of built.tables) {
    const run = /^docs\/benchmarks\/([^/]+)\//.exec(t.entry.report)?.[1] ?? '';
    for (const row of t.rows) {
      const cost = row.usd_per_solved === null ? 'no solved tasks' : '$' + row.usd_per_solved.toFixed(2) + ' per solved task';
      const from = ' (' + (statusOf.has(run) ? ROW_NOTE[statusOf.get(run)!] : 'its run has no recipe') + ')';
      log('    README row: ' + row.harness + ' on ' + row.model + ' (' + t.entry.run_id + '): ' + row.passes + ' of ' + row.scored + ' passed, ' + (row.pass_rate * 100).toFixed(1) + '%, ' + cost + from);
    }
  }
  return failures;
}

export async function main(argv: string[], root: string, log: (s: string) => void = console.log): Promise<number> {
  const only: string[] = [];
  let list = false;
  let jobs = cpus().length;
  let keep = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--run' && argv[i + 1]) only.push(argv[++i]!);
    else if (a === '--jobs' && Number(argv[i + 1]) > 0) jobs = Number(argv[++i]);
    else if (a === '--list') list = true;
    else if (a === '--keep-temp') keep = true;
    else { log('verify: unknown argument ' + a + ' (usage: bun run verify [--run <folder>]... [--jobs <n>] [--list] [--keep-temp])'); return 2; }
  }
  const recipes = loadRecipes(root);
  const problems = recipes.flatMap((r) => validateRecipe(root, r));
  const have = new Set(recipes.map((r) => r.run));
  if (!only.length) for (const run of publishedRuns(root)) if (!have.has(run)) problems.push('docs/benchmarks/' + run + ' has a published report or scoreboard row but no rebuild recipe; add ' + RECIPES_DIR + '/' + run + '.json');
  for (const run of only) if (!have.has(run)) problems.push('there is no recipe for ' + run + ' (' + RECIPES_DIR + '/' + run + '.json)');
  if (problems.length) { for (const p of problems) log('RECIPE PROBLEM ' + p); return 2; }
  const chosen = only.length ? recipes.filter((r) => only.includes(r.run)) : recipes;
  if (list) {
    for (const r of chosen) {
      log(r.run + (r.about ? ': ' + r.about : ''));
      for (const s of r.steps) log('    rebuilds ' + [...(s.outputs ?? []), ...(s.stdout ? ['file' in s.stdout ? s.stdout.file : 'printed text inside ' + s.stdout.contained_in] : [])].join(', ') + ' with: ' + s.cmd.join(' '));
      for (const k of r.known ?? []) log('    known difference: ' + k.file + (k.path ? ' ' + k.path : '') + ': ' + k.reason);
      for (const v of r.volatile ?? []) log('    not compared: ' + v.file + ' ' + (v.path ?? 'text matching ' + JSON.stringify(v.pattern)) + ': ' + v.reason);
      for (const g of r.not_rebuilt ?? []) log('    can\'t rebuild: ' + g.what + ': ' + g.reason);
    }
    return 0;
  }
  const pinned = existsSync(join(root, 'package.json')) ? /bun@([\d.]+)/.exec(readFileSync(join(root, 'package.json'), 'utf8'))?.[1] : undefined;
  if (pinned && pinned !== Bun.version) log('note: this is bun ' + Bun.version + ' and package.json pins bun ' + pinned + '; CI uses the pinned version, so trust CI if the two disagree.');
  const before = receiptsStatus(root);
  const results = await pool(chosen, jobs, async (r) => { const res = await verifyRun(root, r, keep); printRun(res, log); return res; });
  const after = receiptsStatus(root);
  let failed = results.filter((r) => r.status === 'differs').length;
  const unavailable = results.filter((r) => r.status === 'unavailable').map((r) => r.run);
  if (unavailable.length && !isPublicCopy(root)) {
    failed += unavailable.length;
    log('UNAVAILABLE in the full repository: ' + unavailable.join(', ') + (unavailable.length === 1 ? ' needs' : ' need') + ' files that are missing here (listed above). Only the public copy, which has no publication/ folder, may leave them out. Restore them, or fix the recipe.');
  }
  if (before !== null && after !== before) {
    failed++;
    log('DIFFERS a rebuild step wrote into the committed receipts (git status under docs/benchmarks changed). Declare the file as an output in its recipe and restore it with git checkout:\n    ' + after!.trim().split('\n').slice(0, MAX_LINES).join('\n    '));
  }
  let boardFailures: string[] = [];
  if (!only.length) {
    log('README and docs/scoreboard.md, built from the analysis files checked above:');
    boardFailures = await checkScoreboard(root, log, new Map(results.map((r) => [r.run, r.status])));
    for (const f of boardFailures) log('    MISMATCH ' + f);
    if (boardFailures.length) failed++;
    if (existsSync(join(root, 'scripts/receipts-manifest.ts'))) {
      const problems = checkReceiptsManifest(root);
      if (problems.failures.length) { failed++; log('DIFFERS receipts: docs/receipts-manifest.json no longer matches the committed receipts:\n    ' + problems.failures.slice(0, MAX_LINES).join('\n    ')); }
      else log('MATCH   receipts: docs/receipts-manifest.json matches the hash, trial count and cell counts of every committed receipt' + problems.note);
    }
  }
  const count = (s: Status) => results.filter((r) => r.status === s).length;
  log('');
  log('verify: ' + results.length + ' runs. ' + count('match') + ' rebuilt and match, ' + count('known') + ' match apart from known differences, ' + count('not-rebuilt') + ' can\'t be rebuilt from receipts at all, ' + (count('unavailable') ? count('unavailable') + ' can\'t be checked in this copy, ' : '') + count('differs') + ' differ.');
  const gaps = results.reduce((n, r) => n + r.gaps.length, 0);
  const known = results.reduce((n, r) => n + r.known.length, 0);
  if (gaps || known) log('verify: ' + known + ' known differences and ' + gaps + ' published items that can\'t be rebuilt are listed above; ' + RECIPES_DIR + '/ holds the reasons.');
  if (failed) { log('verify: FAILED. A published value no longer matches what its receipts give. Each MISMATCH line above names the file, the value and what it should be.'); return 1; }
  log('verify: every published analysis value it checked matches what the receipts give. docs/verify.md says what it does not check.');
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2), resolve(import.meta.dir, '../..')));
