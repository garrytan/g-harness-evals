#!/usr/bin/env bun
// The failure-mining corpus (internal-task): one manifest row per trial of every committed run, so every later count has its
// denominator, and the layer-1 labels from scripts/taxonomy.ts for every multi-user results folder.
//
//   bun scripts/failure-mining/corpus.ts             writes corpus/manifest.jsonl and corpus/runs.json
//   bun scripts/failure-mining/corpus.ts --layer1    also runs scripts/taxonomy.ts --out per multi-user results folder into
//                                                    layer1/<run>/<results-subpath>/ and writes corpus/layer1-status.json
//
// Inputs: every docs/benchmarks/**/trials.jsonl tracked on this checkout (results/ and the other result folders a run
// keeps, such as results-acl/, calibration/ and probe/), plus #337's merged trials.jsonl read with git show from
// origin/harn50/frontier-results (source pr337). Files named <x>.trials.jsonl (smokes, covered subsets, reprobes) are
// listed in runs.json, not scanned. Every classification (counted, population, kind, task root, world)
// carries a one-line reason naming the file it came from; a reason that quotes a file is checked against that file, so a
// quote that is not there stops the script. A manifest row names its reasons by id (the first 10 hex digits of the
// reason's sha256); runs.json "reasons" holds the text. Keyless and deterministic: no clock, rows in file order.
// Writes only under docs/benchmarks/2026-11-09-failure-mining/.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { TAXONOMY_VERSION } from '../taxonomy.ts';

export const ROOT = resolve(import.meta.dir, '..', '..');
export const BENCH = 'docs/benchmarks';
export const OUT = join(BENCH, '2026-11-09-failure-mining');
const PR337 = { ref: 'origin/harn50/frontier-results', file: join(BENCH, '2026-11-07-frontier-harness/results/merged/trials.jsonl') };
const FRONTIER = new Set(['claude-opus-5-5', 'gpt-6.1-sol', 'particle-1']);
/** scripts/summarize-run.ts EXCLUDED (methodology item 9). */
const EXCLUDED_TERMINATIONS = new Set(['model_error', 'infra_error', 'exam_fault']);
const HARBOR_RUNS = new Set(['2026-11-01-opus-gstack-follow', '2026-11-03-investigate-gate', '2026-11-07-frontier-harness']);

type Population = 'default' | 'variant' | 'uncounted' | 'excluded';
type Row = Record<string, any>;

const git = (...a: string[]) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 1 << 30 }).toString();
const gitOk = (...a: string[]) => spawnSync('git', a, { cwd: ROOT, stdio: 'ignore' }).status === 0;
const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const readRepo = (file: string, ref?: string) => (ref ? git('show', `${ref}:${file}`) : readFileSync(join(ROOT, file), 'utf8'));
const fileCache = new Map<string, string>();
/** `<file>: "<quote>"`, after checking the quote is in the file (on the ref when given). */
function cite(file: string, quote: string, ref?: string): string {
  const key = `${ref ?? ''}:${file}`;
  if (!fileCache.has(key)) fileCache.set(key, readRepo(file, ref));
  if (!fileCache.get(key)!.includes(quote)) throw new Error(`citation check: "${quote}" is not in ${ref ? ref + ':' : ''}${file}`);
  return `${ref ? ref + ':' : ''}${file}: "${quote}"`;
}
const bareModel = (m: unknown) => String(m ?? '').replace(/^[a-z]+:/, '');
const runOf = (resultsDir: string) => resultsDir.split('/')[2]!;

/** Whole results folders that are not counted, or whose rows are set aside, with the line that says so. */
const FOLDER_RULES: Array<{ dir: string; population: 'uncounted' | 'excluded'; why: () => string }> = [
  { dir: '2026-10-23-m2-pilot/results', population: 'uncounted', why: () => `pilot run; ${cite(`${BENCH}/2026-10-23-m2-pilot/report.md`, 'Pilot, not a comparison.')}` },
  { dir: '2026-10-25-v02-pilot/results', population: 'uncounted', why: () => `pilot run; ${cite(`${BENCH}/2026-10-25-v02-pilot/report.md`, 'This is a pilot, not a counted comparison.')}` },
  { dir: '2026-10-25-qm-probes/results', population: 'uncounted', why: () => `probe run; ${cite(`${BENCH}/2026-10-25-qm-probes/report.md`, 'This is a product check, not a skill test')}` },
  { dir: '2026-10-25-qm-probes-qp07/results', population: 'uncounted', why: () => `probe rerun; ${cite(`${BENCH}/2026-10-25-qm-probes-qp07/report.md`, '# QM probe qp-07 rerun report')}` },
  { dir: '2026-10-25-company-brain/results/rereading-preregistered-rule', population: 'excluded', why: () => `same trial ids as results/trials.jsonl re-read under another rule, so each trial is kept once, from results/trials.jsonl; ${cite(`${BENCH}/2026-10-25-company-brain/report.md`, 'the re-reading is the labelled directory')}` },
  { dir: '2026-10-25-gbrain-ladder/results/shards/sem-aborted-e278fb0', population: 'excluded', why: () => `aborted shard, its cells rerun into results/trials.jsonl; ${cite(`${BENCH}/2026-10-25-gbrain-ladder/report.md`, 'its aborted 44 trials and $0.80 are kept uncounted')}` },
  { dir: '2026-11-01-prompt-archaeology/calibration', population: 'uncounted', why: () => `calibration before the counted run; ${cite(`${BENCH}/2026-11-01-prompt-archaeology/calibration/calibration.md`, '# internal-task calibration: prompt-archaeology-calib-2026-11 (uncounted)')}` },
  { dir: '2026-11-06-prompt-archaeology-joint/probe', population: 'uncounted', why: () => `sizing probe before the main run; ${cite(`${BENCH}/2026-11-06-prompt-archaeology-joint/report.md`, 'Runs \`prompt-archaeology-joint-probe-2026-11\` (probe)')}` },
  { dir: '2026-11-01-installer-cc-codex/results/costing-smoke', population: 'uncounted', why: () => `costing smoke before the counted run; ${cite(`${BENCH}/2026-11-01-installer-cc-codex/report.md`, '\`costing-smoke/\` (its scratch preregistration')}` },
  { dir: '2026-11-01-opus-gstack-follow/results', population: 'uncounted', why: () => `uncounted gstack follow checks; ${cite(`${BENCH}/2026-11-01-opus-gstack-follow/report.md`, 'These are uncounted checks')}` },
  { dir: '2026-11-01-replicate-validation/results', population: 'uncounted', why: () => `tooling check on Sonnet; ${cite(`${BENCH}/2026-11-01-replicate-validation/report.md`, 'Tooling validation, not a finding.')}` },
  { dir: '2026-11-02-v04-frozen-dev/results', population: 'uncounted', why: () => `cancelled read, canary only; ${cite(`${BENCH}/2026-11-02-v04-frozen-dev/results/UNCOUNTED.md`, '**Uncounted. Not a frozen-dev result.**')}` },
];

interface CellCtx { run: string; cell: string; harness: string | null; arm?: string; prereg: string }
/** Default (shipped or plain configuration) against variant arms, plan decision d2. First match wins. */
const CELL_RULES: Array<{ when: (c: CellCtx) => boolean; population: 'default' | 'variant'; why: (c: CellCtx) => string }> = [
  { when: (c) => c.run === '2026-11-01-prompt-archaeology' && /-full-/.test(c.cell), population: 'default', why: () => `full shipped prompt, the arm every cut is measured against; ${cite(`${BENCH}/2026-11-01-prompt-archaeology/report.md`, '# Prompt archaeology (prompt-archaeology-2026-11): report')}` },
  { when: (c) => c.run === '2026-11-01-prompt-archaeology', population: 'variant', why: () => `prompt-archaeology cut (d2); ${cite(`${BENCH}/2026-11-01-prompt-archaeology/report.md`, '# Prompt archaeology (prompt-archaeology-2026-11): report')}` },
  { when: (c) => c.run === '2026-11-06-prompt-archaeology-joint' && /-full-/.test(c.cell), population: 'default', why: () => `full shipped prompt, the arm the cuts are measured against; ${cite(`${BENCH}/2026-11-06-prompt-archaeology-joint/report.md`, '# Prompt archaeology joint cut')}` },
  { when: (c) => c.run === '2026-11-06-prompt-archaeology-joint', population: 'variant', why: () => `prompt-archaeology joint or minimal cut (d2); ${cite(`${BENCH}/2026-11-06-prompt-archaeology-joint/report.md`, '# Prompt archaeology joint cut')}` },
  { when: (c) => c.run === '2026-10-31-harness-zero-select', population: 'variant', why: () => `harness-zero switch selection arm (d2); ${cite(`${BENCH}/2026-10-31-harness-zero-select/report.md`, '# Harness Zero switch selection')}` },
  { when: (c) => c.run === '2026-11-06-harness-zero-h2h' && c.harness === 'harness-zero', population: 'variant', why: () => `harness-zero head-to-head variant (d2); ${cite(`${BENCH}/2026-11-06-harness-zero-h2h/report.md`, '# Harness Zero against the field')}` },
  { when: (c) => c.run === '2026-11-06-harness-zero-h2h', population: 'default', why: () => `field harness at its shipped configuration (its gbrain cell paired with its none cell); ${cite(`${BENCH}/2026-11-06-harness-zero-h2h/report.md`, '# Harness Zero against the field')}` },
  { when: (c) => c.run === '2026-11-07-h10-instruction-placement', population: 'variant', why: () => `h10 instruction placement arm (d2); ${cite(`${BENCH}/2026-11-07-h10-instruction-placement/report.md`, '# H10: where must an instruction live to be obeyed?')}` },
  { when: (c) => c.run === '2026-10-31-anatomy-instruction-route', population: 'variant', why: () => `instruction route placement arm (d2); ${cite(`${BENCH}/2026-10-31-anatomy-instruction-route/report.md`, '# Instruction routes: one gbrain rule delivered five ways')}` },
  { when: (c) => c.run === '2026-11-02-v04-cal-r1', population: 'variant', why: () => `v0.4 calibration round (d2); ${cite(`${BENCH}/2026-11-02-v04-cal-r1/report.md`, '# v0.4 calibration on Opus 5.5: report')}` },
  ...(['2', '3', '4'] as const).map((n) => ({ when: (c: CellCtx) => c.run === `2026-11-02-v04-cal-r${n}`, population: 'variant' as const, why: () => `v0.4 calibration round (d2); ${cite(`${BENCH}/2026-11-02-v04-cal-r${n}/PREREGISTRATION.md`, `# v0.4 calibration round ${n} on Opus 5.5`)}` })),
  { when: (c) => c.run === '2026-11-02-v04-transfer', population: 'variant', why: () => `v0.4 calibration transfer check (d2); ${cite(`${BENCH}/2026-11-02-v04-transfer/PREREGISTRATION.md`, '# v0.4 transfer check on the rehearsal set')}` },
  { when: (c) => c.run === '2026-11-03-qm-c4-told-live', population: 'default', why: () => `QM's gbrain arms and their none arm; ${cite(`${BENCH}/2026-11-03-qm-c4-told-live/report.md`, '\`route-tool\` (gbrain as tools the model calls)')}` },
  { when: (c) => c.run === '2026-11-03-investigate-gate' && c.arm === 'H', population: 'variant', why: () => `gstack plus the reproduce-first gate; ${cite(`${BENCH}/2026-11-03-investigate-gate/report.md`, 'H is S plus the reproduce-first gate')}` },
  { when: (c) => c.run === '2026-11-03-investigate-gate' && c.arm === 'S', population: 'default', why: () => `gstack /investigate as shipped; ${cite(`${BENCH}/2026-11-03-investigate-gate/report.md`, 'S is gstack \`04f80459\` with \`/investigate\` and no gate')}` },
  { when: (c) => c.run === '2026-11-03-investigate-gate' && c.arm === 'N', population: 'default', why: () => `no-gstack arm paired with S; ${cite(`${BENCH}/2026-11-03-investigate-gate/report.md`, 'N has no gstack installed and a plain prompt.')}` },
  { when: (c) => c.run === '2026-11-07-frontier-harness' && /-kept$/.test(c.cell), population: 'variant', why: () => `kept sample, reported separately; ${cite(`${BENCH}/2026-11-07-frontier-harness/report.md`, '**Kept sample (8 tasks, descriptive):**', PR337.ref)}` },
  { when: (c) => c.run === '2026-11-07-frontier-harness', population: 'default', why: () => `main arm of the frontier run; ${cite(`${BENCH}/2026-11-07-frontier-harness/report.md`, '**Tasks:** 52 Terminal-Bench 2.1 tasks', PR337.ref)}` },
  { when: (c) => /-verbs-/.test(c.cell), population: 'variant', why: (c) => `gbrain verbs arm, an install variant; cell id in ${c.prereg}` },
  { when: (c) => /-gbrain-(mcp|docs|semantic)/.test(c.cell), population: 'variant', why: (c) => `gbrain install ladder rung; cell id in ${c.prereg}` },
  { when: (c) => /-route-/.test(c.cell), population: 'variant', why: (c) => `instruction placement arm; cell id in ${c.prereg}` },
  { when: (c) => /-perturn$/.test(c.cell), population: 'variant', why: (c) => `per-turn session variant; cell id in ${c.prereg}` },
  { when: () => true, population: 'default', why: (c) => `${/gbrain|company/.test(c.cell) ? 'gbrain arm' : 'no-brain arm'} at the harness's shipped configuration; cell id in ${c.prereg}` },
];

interface Experiment { id: string; results: string[]; file: string }
function experiments(): Experiment[] {
  const out: Experiment[] = [];
  const take = (file: string) => { for (const e of (JSON.parse(readRepo(file)).experiments ?? []) as Array<{ id: string; results?: string[] }>) out.push({ id: e.id, results: e.results ?? [], file }); };
  take(join(BENCH, 'preregistrations.json'));
  for (const f of readdirSync(join(ROOT, BENCH, 'preregistrations.d')).filter((f) => f.endsWith('.json')).sort()) take(join(BENCH, 'preregistrations.d', f));
  return out;
}

export interface ResultsDir {
  results_dir: string; source: 'main' | 'pr337'; source_commit: string | null; trials_sha256: string; rows: number; kind: 'multiuser' | 'harbor'; kind_reason: string;
  counted: boolean; counted_reason: string; folder_population: Population | null;
  task_sets: string[]; tasks_root: string | null; tasks_root_reason: string; world: string | null; world_sha256: string | null; world_reason: string;
  run_created_at: string | null; tasks_commit: string | null; tasks_commit_reason: string; tree_paths: string[]; tree_differs_at_head: boolean | null;
  cells: Record<string, { population: Population; reason: string; rows: number; frontier_rows: number; frontier_failed: number }>;
}

function nearestManifest(resultsDir: string): { path: string; m: any } | null {
  for (let d = resultsDir; d.split('/').length >= 4; d = dirname(d)) {
    const p = join(d, 'manifest.json');
    if (existsSync(join(ROOT, p))) { const m = JSON.parse(readRepo(p)); if (Array.isArray(m.cells) && m.cells.length) return { path: p, m }; }
    if (d.endsWith('/results')) break;
  }
  return null;
}

function taskTree(resultsDir: string, rows: Row[]) {
  const man = nearestManifest(resultsDir);
  const cellCfg = new Map<string, any>((man?.m.cells ?? []).map((c: any) => [c.id, c]));
  const ids = new Set(rows.map((r) => r.trial_id));
  const taskDirs = [...new Set(((man?.m.trials ?? []) as Array<{ id: string; task_dir: string }>).filter((t) => ids.has(t.id)).map((t) => t.task_dir))].sort();
  const sets = [...new Set([...new Set(rows.map((r) => r.cell))].map((c) => cellCfg.get(c)).filter(Boolean).map((c: any) => `${c.task_set ?? 'v0.1'}/${c.split}`))].sort();
  let root: string | null = null, rootReason = '';
  const tasks = [...new Set(rows.map((r) => String(r.task)))];
  const roots = [...new Set(taskDirs.map((d) => dirname(dirname(d))))];
  if (man && roots.length === 1) { root = roots[0]!; rootReason = `every task_dir in ${man.path} for these rows sits under ${root}/<split>/ (task sets ${sets.join(', ')})`; }
  else if (man && roots.length > 1) rootReason = `${man.path} names ${roots.length} task roots for these rows (${roots.join(', ')}); taxonomy.ts takes one`;
  else {
    const cand = ['tasks/multiuser', 'tasks/multiuser/v0.2', 'tasks/multiuser/v0.3', 'tasks/multiuser/v0.4'].filter((r) => tasks.every((t) => ['dev', 'heldout'].some((s) => existsSync(join(ROOT, r, s, t, 'task.toml')))));
    if (cand.length === 1) { root = cand[0]!; rootReason = `no manifest.json listing these trials at or above ${resultsDir}; all ${tasks.length} task ids have a task.toml under ${root} and under no other task set`; }
    else rootReason = `no manifest.json listing these trials at or above ${resultsDir}, and the task ids resolve under ${cand.length} task sets (${cand.join(', ') || 'none'})`;
  }
  let world: string, worldReason: string;
  const pinFile = join(resultsDir, 'set-worlds.json');
  const pins = existsSync(join(ROOT, pinFile)) ? Object.values(JSON.parse(readRepo(pinFile)) as Record<string, { path: string; sha256: string }>) : [];
  const pinPaths = [...new Set(pins.map((p) => p.path))];
  if (pinPaths.length === 1) { world = pinPaths[0]!; worldReason = `${pinFile} pins ${world} for the set's dev cells`; }
  else if (root && existsSync(join(ROOT, root, 'world', 'world.json')) && sets.every((s) => s.endsWith('/dev'))) { world = join(root, 'world', 'world.json'); worldReason = 'the set carries its own world (runner/run.ts setWorldPath) and every cell is a dev cell'; }
  else { world = 'world/seed/world.json'; worldReason = `no set world for ${root ?? 'these tasks'} (runner/run.ts setWorldPath), so the run world`; }
  const worldSha = existsSync(join(ROOT, world)) ? sha256(readFileSync(join(ROOT, world))) : null;
  if (pins.length && worldSha && pins.some((p) => p.sha256 !== worldSha)) worldReason += '; the world on disk does not match the pinned sha256';
  const created: string | null = man?.m.created_at ?? null;
  const dirsUsed = taskDirs.length ? taskDirs : root ? tasks.flatMap((t) => ['dev', 'heldout'].map((s) => join(root!, s, t)).filter((d) => existsSync(join(ROOT, d, 'task.toml')))) : [];
  const treePaths = [...dirsUsed, dirname(world)];
  const shardFiles = readdirSync(join(ROOT, resultsDir)).filter((f) => f === 'shard.json' || f.endsWith('.shard.json')).sort();
  const commits = [...new Set(shardFiles.map((f) => JSON.parse(readRepo(join(resultsDir, f))).commit as string | undefined).filter((c): c is string => !!c))].sort();
  let tasksCommit: string | null = null, commitReason: string;
  if (commits.length && commits.every((c) => gitOk('cat-file', '-e', `${c}^{commit}`))) {
    if (commits.every((c) => gitOk('diff', '--quiet', commits[0]!, c, '--', ...treePaths))) { tasksCommit = commits[0]!; commitReason = `the ${shardFiles.length} shard record(s) in ${resultsDir} name ${commits.map((c) => c.slice(0, 12)).join(', ')}${commits.length > 1 ? ', whose task dirs and world are identical' : ''}`; }
    else commitReason = `the shard records in ${resultsDir} name ${commits.map((c) => c.slice(0, 12)).join(', ')}, whose task dirs or world differ, so no one tree fits every row`;
  } else if (created) {
    tasksCommit = git('log', '-1', `--before=${created}`, '--format=%H', '--', ...treePaths).trim() || null;
    commitReason = `no shard record with a commit in this checkout under ${resultsDir}; the last commit touching these task dirs or the world before ${man!.path} created_at ${created}`;
  } else commitReason = `no shard record and no manifest created_at under ${resultsDir}, so the checkout's tree`;
  const differs = tasksCommit ? !gitOk('diff', '--quiet', tasksCommit, 'HEAD', '--', ...treePaths) : null;
  return { task_sets: sets, tasks_root: root, tasks_root_reason: rootReason, world, world_sha256: worldSha, world_reason: worldReason, run_created_at: created, tasks_commit: tasksCommit, tasks_commit_reason: commitReason, tree_paths: treePaths, tree_differs_at_head: differs, cellCfg, manifestPath: man?.path ?? null };
}

const cellReasons = new Map<string, string>();
const reasons = new Map<string, string>();
function reasonId(text: string): string {
  const id = sha256(text).slice(0, 10);
  if (reasons.has(id) && reasons.get(id) !== text) throw new Error(`reason id ${id} collides`);
  reasons.set(id, text);
  return id;
}

function buildCorpus() {
  const exps = experiments();
  const files = git('ls-files', `:(glob)${BENCH}/**/*trials.jsonl`).split('\n').filter(Boolean).sort();
  const scanned = files.filter((f) => f.split('/').pop() === 'trials.jsonl');
  const other = files.filter((f) => !scanned.includes(f));
  const prCommit = git('rev-parse', PR337.ref).trim();
  const inputs = [...scanned.map((f) => ({ file: f, source: 'main' as const, text: readRepo(f) })), { file: PR337.file, source: 'pr337' as const, text: readRepo(PR337.file, PR337.ref) }];
  const pr337Dirs = new Set(git('ls-tree', '-r', '-d', '--name-only', PR337.ref, join(dirname(PR337.file), 'trials')).split('\n').filter(Boolean));

  const manifest: Row[] = [];
  const dirs: ResultsDir[] = [];
  for (const inp of inputs) {
    const resultsDir = dirname(inp.file);
    const run = runOf(resultsDir);
    const rows = inp.text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row);
    if (new Set(rows.map((r) => r.trial_id)).size !== rows.length) throw new Error(`${inp.file}: duplicate trial ids`);
    const kind = HARBOR_RUNS.has(run) ? 'harbor' : 'multiuser';
    const kindReason = kind === 'harbor' ? `${inp.file} rows are Harbor coding trials scored by a verifier reward (${rows[0]!.laneb ? 'laneb' : rows[0]!.frontier ? 'frontier' : 'harbor_trial_dir'} fields), no world` : `${inp.file} rows are multi-user trials graded on the world`;
    const rel = relative(BENCH, resultsDir);
    const rule = FOLDER_RULES.find((r) => rel === r.dir || rel.startsWith(r.dir + '/'));
    const exp = exps.find((e) => e.results.some((g) => new Bun.Glob(g).match(inp.file)));
    let counted: boolean, countedReason: string;
    if (rule) { counted = false; countedReason = rule.why(); }
    else if (exp) { counted = true; countedReason = `registered as ${exp.id} in ${exp.file}, whose results glob covers ${inp.file}`; }
    else if (run === '2026-11-03-investigate-gate') { counted = true; countedReason = `rows carry their own counted flag; ${cite(`${BENCH}/2026-11-03-investigate-gate/report.md`, "They're excluded under the prereg's INFRA rule")}`; }
    else throw new Error(`${inp.file}: no preregistration covers it and no folder rule names it; add one`);
    const tree = kind === 'multiuser' ? taskTree(resultsDir, rows) : null;
    const suffix = /^results-(.+)$/.exec(resultsDir.split('/')[3] ?? '')?.[1];
    const preregFile = [join(BENCH, run, suffix ? `prereg-${suffix}.json` : 'prereg.json'), tree?.manifestPath].find((p): p is string => !!p && existsSync(join(ROOT, p))) ?? inp.file;
    const sha = sha256(inp.text);
    const dir: ResultsDir = {
      results_dir: resultsDir, source: inp.source, source_commit: inp.source === 'pr337' ? prCommit : null, trials_sha256: sha, rows: rows.length, kind, kind_reason: kindReason,
      counted, counted_reason: countedReason, folder_population: rule?.population ?? null,
      task_sets: tree?.task_sets ?? [], tasks_root: tree?.tasks_root ?? null, tasks_root_reason: tree?.tasks_root_reason ?? 'Harbor run: no multi-user task tree, so no layer 1',
      world: tree?.world ?? null, world_sha256: tree?.world_sha256 ?? null, world_reason: tree?.world_reason ?? 'Harbor run: no world',
      run_created_at: tree?.run_created_at ?? null, tasks_commit: tree?.tasks_commit ?? null, tasks_commit_reason: tree?.tasks_commit_reason ?? 'Harbor run', tree_paths: tree?.tree_paths ?? [], tree_differs_at_head: tree?.tree_differs_at_head ?? null, cells: {},
    };
    for (const r of rows) {
      const arm: string | undefined = run === '2026-11-03-investigate-gate' ? String(r.arm) : r.laneb?.arm;
      const model = bareModel(r.model);
      const cell: string = r.cell ?? `${model}.${arm}`;
      const harness: string | null = r.harness ?? (r.runtime?.claude_code_version ? 'claude-code' : null);
      const grade: string = r.grade ?? (r.pass === true ? 'pass' : r.pass === false ? 'fail' : 'n/a');
      const frontier = FRONTIER.has(model);
      let population: Population, reason: string;
      if (!counted) { population = rule?.population ?? 'uncounted'; reason = countedReason; }
      else if (r.counted === false) { population = 'excluded'; reason = `row counted=false (${[r.termination, ...(r.infra_reasons ?? [])].join(', ')}) in ${inp.file}`; }
      else if (EXCLUDED_TERMINATIONS.has(r.termination)) { population = 'excluded'; reason = `termination ${r.termination}${r.frontier?.infra_class ? ` (${r.frontier.infra_class})` : ''}, excluded from scoring (scripts/summarize-run.ts EXCLUDED)`; }
      else if (r.cap_stop === true) { population = 'excluded'; reason = 'cap_stop, an incomplete trial (CLAUDE.md evidence rules)'; }
      else {
        const ctx: CellCtx = { run, cell, harness, arm, prereg: preregFile };
        const c = CELL_RULES.find((x) => x.when(ctx))!;
        const key = `${run}|${cell}`;
        if (!cellReasons.has(key)) {
          if (kind === 'multiuser' && !readRepo(preregFile).includes(`"${cell}"`)) throw new Error(`cell ${cell} is not in ${preregFile}`);
          cellReasons.set(key, c.why(ctx));
        }
        population = c.population; reason = cellReasons.get(key)!;
      }
      const cfg = tree?.cellCfg.get(cell);
      const g = r.gbrain as Row | undefined;
      const gbrain = g ? Object.fromEntries(Object.entries({ present: true, surface: g.surface, brain: g.brain, scope: g.scope, install: g.install, install_bundle: g.install_bundle, ingest: g.ingest, embeddings: g.embeddings, route: cfg?.config, preamble: cfg?.preamble, in_turn_calls: g.events?.in_turn_calls, calls: g.events?.calls, writes: g.events?.writes }).filter(([, v]) => v !== undefined && v !== null)) : { present: false };
      const gstack = run === '2026-11-03-investigate-gate' ? { present: arm === 'S' || arm === 'H', source: 'arm (investigate-gate report.md: N has no gstack, S and H run gstack)' }
        : r.laneb ? { present: arm === 'gstack', source: 'laneb.arm' }
        : { present: /gstack/.test(cell), source: 'cell id' };
      const trialDir: string = r.harbor_trial_dir ?? join(resultsDir, r.paths?.trial_dir ?? join('trials', ...String(r.trial_id).split('/').slice(1)));
      const trialDirExists = inp.source === 'pr337' ? pr337Dirs.has(trialDir) : !trialDir.startsWith('/') && existsSync(join(ROOT, trialDir));
      const isCounted = population === 'default' || population === 'variant';
      manifest.push({
        run, results_dir: resultsDir, trial_id: r.trial_id, cell, task: r.task, harness, model, grade, termination: r.termination ?? null, kind, frontier,
        counted: isCounted, counted_reason: reasonId(isCounted ? countedReason : reason), population, population_reason: reasonId(reason),
        gbrain, gstack_present: gstack.present, gstack_source: gstack.source, trial_dir_exists: trialDirExists,
      });
      const cs = (dir.cells[cell] ??= { population, reason, rows: 0, frontier_rows: 0, frontier_failed: 0 });
      if (cs.population === 'excluded' && population !== 'excluded') { cs.population = population; cs.reason = reason; }
      cs.rows++;
      if (frontier) { cs.frontier_rows++; if (grade !== 'pass') cs.frontier_failed++; }
    }
    dirs.push(dir);
  }

  const resultsFolders = readdirSync(join(ROOT, BENCH)).filter((d) => existsSync(join(ROOT, BENCH, d, 'results'))).sort();
  const runs: Record<string, unknown> = {};
  for (const run of [...new Set([...resultsFolders, ...dirs.map((d) => runOf(d.results_dir))])].sort()) {
    const mine = dirs.filter((d) => runOf(d.results_dir) === run);
    const runDir = join(ROOT, BENCH, run);
    const sideFolders = readdirSync(runDir, { withFileTypes: true }).filter((x) => x.isDirectory() && x.name !== 'results').map((x) => x.name).sort()
      .filter((name) => /^(results.+|sealed-results|calibration|probe)$/.test(name) || files.some((f) => f.startsWith(`${BENCH}/${run}/${name}/`)));
    const otherFolders = sideFolders.map((name) => {
      const prefix = `${BENCH}/${run}/${name}/`;
      const inside = mine.filter((d) => (d.results_dir + '/').startsWith(prefix));
      if (inside.length) return { folder: prefix.slice(0, -1), scanned: true, reason: `holds ${inside.map((d) => relative(prefix, join(d.results_dir, 'trials.jsonl'))).join(', ')}, so its rows are in the manifest: ${inside[0]!.counted ? 'counted' : 'not counted'}, ${inside[0]!.counted_reason}` };
      const named = files.filter((f) => f.startsWith(prefix));
      const jsonl = readdirSync(join(ROOT, prefix)).filter((f) => f.endsWith('.jsonl'));
      return { folder: prefix.slice(0, -1), scanned: false, reason: named.length ? `holds only ${named.map((f) => relative(prefix, f)).join(', ')}, smokes not named trials.jsonl, so nothing is scanned` : `holds no trials.jsonl (its .jsonl files: ${jsonl.join(', ') || 'none'}), so nothing from it is in the manifest` };
    });
    runs[run] = {
      ...(otherFolders.length ? { other_folders: otherFolders } : {}),
      run_ids: [...new Set(manifest.filter((m) => m.run === run).map((m) => String(m.trial_id).split('/')[0]))].sort(),
      results: mine,
      other_trial_files: other.filter((f) => f.startsWith(`${BENCH}/${run}/`)).map((f) => ({ file: f, reason: /smoke/.test(f) ? 'a smoke, not named trials.jsonl, so not scanned' : 'not named trials.jsonl (a subset, reprobe or per-harness copy of rows in a scanned file), so not scanned' })),
      ...(mine.length ? {} : { note: `${BENCH}/${run}/results/ holds no trials.jsonl, so nothing from this run is in the manifest` }),
    };
  }
  return { manifest, dirs, runs, prCommit };
}


function writeJson(path: string, v: unknown) { mkdirSync(dirname(join(ROOT, path)), { recursive: true }); writeFileSync(join(ROOT, path), JSON.stringify(v, null, 1) + '\n'); }

/** Calls fn with the task root and world a results folder was graded with, relative to the repository: the checkout's own
 *  when its tree matches the run commit, else that commit's tree, extracted with git archive under .pinned-tree/ and
 *  deleted when fn returns or throws. */
export function withTaskTree<T>(d: Pick<ResultsDir, 'tasks_root' | 'world' | 'tasks_commit' | 'tree_paths' | 'tree_differs_at_head'>, fn: (tasksRoot: string, world: string) => T): T {
  if (!d.tasks_root || !d.world) throw new Error('no task root or world for this folder');
  if (d.tree_differs_at_head === false) return fn(d.tasks_root, d.world);
  if (!d.tasks_commit) throw new Error('no run commit to read the task tree from');
  const pinned = join(ROOT, OUT, '.pinned-tree');
  rmSync(pinned, { recursive: true, force: true }); mkdirSync(pinned, { recursive: true });
  try {
    const tar = spawnSync('git', ['archive', d.tasks_commit, '--', ...d.tree_paths], { cwd: ROOT, maxBuffer: 1 << 30 });
    if (tar.status !== 0 || spawnSync('tar', ['-x', '-C', pinned], { input: tar.stdout }).status !== 0) throw new Error(`could not read the task tree at ${d.tasks_commit}`);
    return fn(relative(ROOT, join(pinned, d.tasks_root)), relative(ROOT, join(pinned, d.world)));
  } finally {
    rmSync(pinned, { recursive: true, force: true });
  }
}

function layer1(dirs: ResultsDir[]) {
  const status: Array<Record<string, unknown>> = [];
  for (const d of dirs.filter((x) => x.kind === 'multiuser')) {
    const out = join(OUT, 'layer1', relative(BENCH, d.results_dir));
    const base = { results_dir: d.results_dir, out, tasks_root: d.tasks_root, world: d.world, tree: d.tree_differs_at_head ? `at ${d.tasks_commit}` : 'checkout (identical to the run commit)', trials_sha256: d.trials_sha256, population: d.folder_population ?? 'counted' };
    if (d.folder_population === 'excluded') { status.push({ ...base, status: 'skipped', error: `rows excluded (${d.counted_reason.split(';')[0]}) and the folder holds no trial receipts` }); continue; }
    if (!d.tasks_root) { status.push({ ...base, status: 'unclassified', error: d.tasks_root_reason }); continue; }
    if (d.tree_differs_at_head !== false && !d.tasks_commit) { status.push({ ...base, status: 'unclassified', error: d.tasks_commit_reason }); continue; }
    let p: ReturnType<typeof spawnSync>;
    try { p = withTaskTree(d, (tasksRoot, world) => spawnSync(process.execPath, ['scripts/taxonomy.ts', '--results', d.results_dir, '--tasks', tasksRoot, '--world', world, '--out', out], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: 'utf8', maxBuffer: 1 << 28 })); }
    catch (err) { status.push({ ...base, status: 'error', error: String((err as Error).message) }); continue; }
    if (p.status !== 0) { status.push({ ...base, status: 'error', error: String(p.stderr || p.stdout).trim().split('\n').slice(-3).join(' | ').slice(0, 600) }); continue; }
    const t = JSON.parse(readFileSync(join(ROOT, out, 'taxonomy.json'), 'utf8'));
    const failedPreds: number = t.counts.failed_predicates;
    const noReceipts = (t.trials as Array<{ failures: Array<{ label: string }> }>).flatMap((x) => x.failures).filter((f) => f.label === 'no_receipts').length;
    const share = (n: number) => (failedPreds ? +(n / failedPreds).toFixed(4) : 0);
    status.push({ ...base, status: 'ok', taxonomy_version: t.taxonomy_version, failed_trials: t.counts.failed_trials, failed_predicates: failedPreds, unclassified: t.counts.unclassified, unclassified_share: share(t.counts.unclassified), no_receipts: noReceipts, no_receipts_share: share(noReceipts), trials_without_logs: t.counts.trials_without_logs.length });
  }
  writeJson(join(OUT, 'corpus', 'layer1-status.json'), { taxonomy_version: TAXONOMY_VERSION, folders: status });
  return status;
}

if (import.meta.main) {
  const { manifest, dirs, runs, prCommit } = buildCorpus();
  mkdirSync(join(ROOT, OUT, 'corpus'), { recursive: true });
  writeFileSync(join(ROOT, OUT, 'corpus', 'manifest.jsonl'), manifest.map((m) => JSON.stringify(m)).join('\n') + '\n');
  writeJson(join(OUT, 'corpus', 'runs.json'), {
    generated_by: 'scripts/failure-mining/corpus.ts', taxonomy_version: TAXONOMY_VERSION, frontier_models: [...FRONTIER],
    pr337: { ref: PR337.ref, commit: prCommit, file: PR337.file },
    inputs: dirs.map((d) => ({ file: join(d.results_dir, 'trials.jsonl'), source: d.source, sha256: d.trials_sha256, rows: d.rows })),
    runs,
    reasons: Object.fromEntries([...reasons].sort((a, b) => a[0].localeCompare(b[0]))),
  });
  const status = process.argv.includes('--layer1') ? layer1(dirs) : null;

  const failed = manifest.filter((m) => m.frontier && m.grade !== 'pass');
  const pops = ['default', 'variant', 'uncounted', 'excluded'] as const;
  const lines = [`${manifest.length} trials in ${dirs.length} files; ${manifest.filter((m) => m.frontier).length} frontier, ${failed.length} frontier not passed.`, '', 'Frontier not passed, by kind and population (default/variant/uncounted/excluded):'];
  for (const kind of ['multiuser', 'harbor']) lines.push(`  ${kind}: ${pops.map((p) => failed.filter((r) => r.kind === kind && r.population === p).length).join('/')}`);
  lines.push('', 'Frontier not passed, by run (default/variant/uncounted/excluded):');
  for (const run of [...new Set(failed.map((r) => r.run))].sort()) { const f = failed.filter((r) => r.run === run); lines.push(`  ${run}: ${pops.map((p) => f.filter((r) => r.population === p).length).join('/')}`); }
  const gb = failed.filter((r) => r.gbrain.present);
  lines.push('', `gbrain present among frontier not passed: ${gb.length} (${pops.map((p) => gb.filter((r) => r.population === p).length).join('/')}); with an in-turn gbrain call: ${gb.filter((r) => (r.gbrain.in_turn_calls ?? 0) > 0).length}`);
  lines.push(`gstack present among frontier not passed: ${failed.filter((r) => r.gstack_present).length} (${pops.map((p) => failed.filter((r) => r.gstack_present && r.population === p).length).join('/')})`);
  if (status) {
    lines.push('', 'Layer 1 (share of failed predicates unclassified; share with no receipts):');
    for (const s of status) lines.push(`  ${relative(BENCH, String(s.results_dir))}: ${s.status === 'ok' ? `${s.unclassified_share} unclassified, ${s.no_receipts_share} no receipts, ${s.failed_trials} failed trials` : `${s.status}: ${s.error}`}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}
