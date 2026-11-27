// Row P of the owner-identity eval (internal-task): gbrain alone, no harness. For each import task of a set, a fresh gbrain home
// gets the set's people pages and the owner (gbrain access owner set), then each import file goes through the gbrain importer
// that reads its format: `gbrain transcripts ingest --facts` for agent session logs, `gbrain capture` plus
// `gbrain extract-conversation-facts` for every other file. Every gbrain command runs in the sidecar image through
// scripts/owner-identity/gbrain-metered.ts, so gbrain's own model calls are metered under one lease and gbrain never sees a key.
// The brain is then dumped (runner/grade/owner-identity-store.ts) and graded (runner/grade/owner-identity.ts) like a trial.
//
//   bun scripts/owner-identity/row-p.ts (--set tasks/multiuser/owner-identity | --sealed-root <opened root>) --lease <run id>
//     --cap-usd <n> --out <dir> --image <gbrain image> [--model shipped|opus] [--tasks a,b] [--tries <n>] [--ledger <file>]
//
// --sealed-root (custodian only, docs/sealed-custody.md): the bank's world, people.json, held-out gold and people pages come from
// the opened root (a set sealed with its own world), --out must be outside every git work tree (use <raw results>/row-p, which
// export.ts bundles and scripts/owner-identity/analyze.ts reads), summary.json records the opening it belongs to, and the
// terminal gets progress counts and one closing line of paths and a digest; every other line goes to <out>/row-p.sealed.log.
//
// --model shipped (default) leaves gbrain's extraction model at its default and expects anthropic:claude-haiku-5-5;
// opus pins facts.extraction_model to anthropic:claude-opus-5-5 first. <out>/<model>/<task>/try-<k>/ holds the home (removed after the store dump under --sealed-root, to keep the encrypted results small), the
// staged files, one <label>.json per gbrain command, store.json and verdicts.json; <out>/<model>/summary.json totals them.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { RunnerError } from '../../runner/errors.ts';
import { dumpGbrainBrain, writeStore } from '../../runner/grade/owner-identity-store.ts';
import { gradeOwnerIdentityFiles, type Gold, type People } from '../../runner/grade/owner-identity.ts';
import type { World } from '../../world/types.ts';
import { sealedGuard } from '../../runner/heldout/guard.ts';
import { readReceipt, RECEIPT_FILE, sealedPaths, sha256, verifySealedRoot } from '../../runner/heldout/sealed.ts';
import { insideGitTree } from '../sealed/custody.ts';
import { runMetered } from './gbrain-metered.ts';

export const P_MODELS = {
  shipped: { extraction: 'anthropic:claude-haiku-5-5', pin: null },
  opus: { extraction: 'anthropic:claude-opus-5-5', pin: 'anthropic:claude-opus-5-5' },
} as const;
export type PModel = keyof typeof P_MODELS;

/** The gbrain transcripts importer's --format for an agent-session file format, or null for a file gbrain captures. */
export const TRANSCRIPT_FORMATS: Record<string, string> = {
  'claude-code-session-jsonl': 'claude-code',
  'codex-rollout-jsonl': 'codex',
  'chatgpt-conversations-json': 'chatgpt',
};

export interface PStep { label: string; args: string[] }

/** The gbrain commands one task runs, in order, with the files staged at /imports and the set's corpus at /corpus. */
export function taskSteps(o: { task: string; owner: { id: string; name: string; email: string }; pin: string | null; files: Array<{ file: string; format: string }> }): PStep[] {
  const steps: PStep[] = [
    { label: 'people', args: ['import', '/corpus', '--no-embed', '--allow-noncanonical-root', '--json'] },
    { label: 'owner-member', args: ['access', 'member', 'add', o.owner.id, '--name', o.owner.name, '--email', o.owner.email, '--json'] },
    { label: 'owner-set', args: ['access', 'owner', 'set', o.owner.id, '--json'] },
    ...(o.pin ? [{ label: 'pin', args: ['config', 'set', 'facts.extraction_model', o.pin] }] : []),
  ];
  o.files.forEach((f, i) => {
    const transcript = TRANSCRIPT_FORMATS[f.format];
    if (transcript) { steps.push({ label: `file-${i + 1}-ingest`, args: ['transcripts', 'ingest', `/imports/${f.file}`, '--format', transcript, '--facts', '--json'] }); return; }
    const slug = `imports/${o.task}/${f.file.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    steps.push({ label: `file-${i + 1}-capture`, args: ['capture', '--file', `/imports/${f.file}`, '--type', 'conversation', '--slug', slug, '--json'] });
    steps.push({ label: `file-${i + 1}-extract`, args: ['extract-conversation-facts', '--slug', slug, '--workers', '1', '--json'] });
  });
  return steps;
}

/** The task's import files as world.json holds them: the owner's private files under members/<owner>/imports/<task>/. */
export function importFiles(world: World, owner: string, task: string): Array<{ file: string; body: string }> {
  const folder = `members/${owner}/imports/${task}`;
  return world.files.filter((f) => f.folder === folder).map((f) => ({ file: basename(f.path), body: f.body }));
}

function arg(argv: string[], name: string): string | undefined { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; }

/** Where a row P run reads its bank: a set's dev tree (--set), or under sealed custody an opened root (--sealed-root) whose
 *  world, people.json, held-out gold and people pages are the bank sealed with its own world (seal.ts --world). */
export interface RowPInput {
  set: string;
  world: string;
  people: string;
  /** The people pages gbrain imports first, mounted at /corpus. */
  corpus: string;
  taskDir: (task: string) => string;
  /** Every task with a gold.json, sorted. */
  tasks: string[];
  /** Under sealed custody: the opening this row P belongs to (analyze.ts reads only row P bound to its run). */
  sealed: { set: string; run_id: string; receipt_sha256: string } | null;
  preregJson: string | null;
}

const goldTasks = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((t) => existsSync(join(dir, t, 'gold.json'))).sort() : []);

export function rowPInput(o: { set?: string; sealedRoot?: string; repoRoot?: string }): RowPInput {
  if (!!o.set === !!o.sealedRoot) throw new RunnerError('HE-RUN-002', 'row P reads --set <tasks/multiuser/<set>> or --sealed-root <opened root>, exactly one');
  if (o.sealedRoot) {
    const root = resolve(o.sealedRoot), receiptFile = join(root, RECEIPT_FILE);
    if (!existsSync(receiptFile)) throw new RunnerError('HE-SEALED-003', `${root} has no ${RECEIPT_FILE}; open the run with scripts/sealed/open.ts first`);
    const receipt = readReceipt(receiptFile);
    const problems = verifySealedRoot(root, receipt, resolve(o.repoRoot ?? process.cwd()));
    if (problems.length) throw new RunnerError('HE-SEALED-003', `the sealed root does not match its opening receipt (${problems.length} problem(s)): ${problems.join('; ')}`);
    if (!receipt.own_world?.['world/people.json']) throw new RunnerError('HE-SEALED-003', `set ${receipt.set} was not sealed with its own world and people.json (seal.ts --world); row P reads an owner-identity bank's world, people and people pages from the opened root`);
    const p = sealedPaths(root, receipt.set);
    return { set: receipt.set, world: p.world, people: join(dirname(p.world), 'people.json'), corpus: join(p.corpus, 'heldout'), taskDir: (t) => join(p.tasks, t), tasks: goldTasks(p.tasks),
      sealed: { set: receipt.set, run_id: receipt.run_id, receipt_sha256: sha256(readFileSync(receiptFile)) }, preregJson: receipt.prereg_json };
  }
  const set = resolve(o.set!);
  return { set: o.set!, world: join(set, 'world', 'world.json'), people: join(set, 'world', 'people.json'), corpus: join(set, 'corpus', 'dev'), taskDir: (t) => join(set, 'dev', t), tasks: goldTasks(join(set, 'dev')), sealed: null, preregJson: null };
}

/** A sealed row P's progress line: counts, a step label and spend, never a task id (the output guard allows exactly these). */
export const SEALED_PROGRESS = /^row-p (shipped|opus) task try \d+ of \d+: [a-z0-9-]+ exit -?\d+, \d+ call\(s\), \$\d+\.\d{4}$/;

export async function runRowP(o: { set?: string; sealedRoot?: string; lease: string; capUsd: number; out: string; image: string; model: PModel; tasks?: string[]; tries: number; ledger?: string }): Promise<Record<string, unknown>> {
  const input = rowPInput(o);
  if (input.sealed && insideGitTree(o.out)) throw new RunnerError('HE-SEALED-002', `--out ${resolve(o.out)} is inside a git work tree; a sealed row P writes outside every checkout (use <raw results>/row-p, which the export bundles and analyze.ts reads)`);
  const world = JSON.parse(readFileSync(input.world, 'utf8')) as World;
  const people = JSON.parse(readFileSync(input.people, 'utf8')) as People;
  const owner = world.members.find((m) => m.id === people.owner);
  if (!owner) throw new RunnerError('HE-TASK-002', `people.json names an owner that is no member of ${input.world}`);
  const model = P_MODELS[o.model];
  const goldOf = (t: string) => JSON.parse(readFileSync(join(input.taskDir(t), 'gold.json'), 'utf8')) as Gold & { formats: Array<{ file: string; format: string; format_known_to_gbrain: boolean }> };
  const tasks = (o.tasks ?? input.tasks).filter((t) => goldOf(t).family === 'I').sort();
  const ledger = o.ledger ?? join(resolve(o.out), 'ledger.sqlite');
  const rows: Array<Record<string, unknown>> = [];
  let done = 0;
  for (const task of tasks) {
    const gold = goldOf(task);
    const files = importFiles(world, owner.id, task);
    for (let k = 1; k <= o.tries; k++) {
      done++;
      const dir = join(resolve(o.out), o.model, task, `try-${k}`);
      rmSync(dir, { recursive: true, force: true });
      const home = join(dir, 'home'), imports = join(dir, 'imports');
      mkdirSync(imports, { recursive: true });
      for (const f of files) writeFileSync(join(imports, f.file), f.body);
      const steps = taskSteps({ task, owner, pin: model.pin, files: gold.formats.map((f) => ({ file: f.file, format: f.format })) });
      const results: Array<Record<string, unknown>> = [];
      for (const step of steps) {
        const after = model.pin && steps.indexOf(step) > steps.findIndex((s) => s.label === 'pin');
        const { exit, record } = await runMetered({ lease: o.lease, capUsd: o.capUsd, home, out: dir, models: [model.extraction], args: step.args, label: step.label, ledger, image: o.image,
          mounts: [`${input.corpus}:/corpus`, `${imports}:/imports`], ...(!model.pin || after ? { expectExtraction: model.extraction } : {}) });
        const usage = record.usage as { requests: number; usd: number; refused: number };
        results.push({ label: step.label, exit, requests: usage.requests, usd: usage.usd, refused: usage.refused });
        console.log(input.sealed ? `row-p ${o.model} task try ${done} of ${tasks.length * o.tries}: ${step.label} exit ${exit}, ${usage.requests} call(s), $${usage.usd.toFixed(4)}`
          : `row-p ${o.model} ${task} try ${k}: ${step.label} exit ${exit}, ${usage.requests} call(s), $${usage.usd.toFixed(4)}`);
      }
      const store = join(dir, 'store.json');
      writeStore(store, dumpGbrainBrain({ brainDir: home, image: o.image, mountAt: '/brain-home' }));
      if (o.sealedRoot) rmSync(home, { recursive: true, force: true });
      const verdicts = gradeOwnerIdentityFiles({ store, gold: join(input.taskDir(task), 'gold.json'), people: input.people, out: join(dir, 'verdicts.json'), arm: 'P' });
      const row = { task, try: k, model: o.model, extraction_model: model.extraction, formats: gold.formats, steps: results, usd: results.reduce((n, r) => n + Number(r.usd), 0), summary: verdicts.summary };
      writeFileSync(join(dir, 'row.json'), JSON.stringify(row, null, 1) + '\n');
      rows.push(row);
    }
  }
  const summary = { schema_version: 1, set: input.set, model: o.model, extraction_model: model.extraction, image: o.image, lease: o.lease, tries: o.tries, rows, usd: rows.reduce((n, r) => n + Number(r.usd), 0), ...(input.sealed ? { sealed: input.sealed } : {}) };
  mkdirSync(join(resolve(o.out), o.model), { recursive: true });
  writeFileSync(join(resolve(o.out), o.model, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  return summary;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const model = (arg(argv, 'model') ?? 'shipped') as PModel;
  const sealedRoot = arg(argv, 'sealed-root');
  const o = { ...(arg(argv, 'set') ? { set: arg(argv, 'set')! } : {}), ...(sealedRoot ? { sealedRoot } : {}), lease: arg(argv, 'lease') ?? '', capUsd: Number(arg(argv, 'cap-usd')), out: arg(argv, 'out') ?? '', image: arg(argv, 'image') ?? '', model,
    tries: Number(arg(argv, 'tries') ?? 1), ...(arg(argv, 'tasks') ? { tasks: arg(argv, 'tasks')!.split(',') } : {}), ...(arg(argv, 'ledger') ? { ledger: arg(argv, 'ledger') } : {}) };
  if (!o.set === !sealedRoot || !o.lease || !o.out || !o.image || !(o.capUsd > 0) || !(model in P_MODELS) || !(o.tries >= 1)) {
    console.error('usage: bun scripts/owner-identity/row-p.ts (--set <tasks/multiuser/<set>> | --sealed-root <opened root>) --lease <run id> --cap-usd <n> --out <dir> --image <gbrain image> [--model shipped|opus] [--tasks a,b] [--tries <n>] [--ledger <file>]');
    process.exit(2);
  }
  try {
    if (!sealedRoot) { const s = await runRowP(o); console.log(`row-p ${model}: ${(s.rows as unknown[]).length} task tries, $${Number(s.usd).toFixed(4)} under lease ${o.lease}`); }
    else {
      // Under sealed custody: refusals that name only paths and counts come before the guard, then every line goes to the log and
      // the terminal gets the progress counts and one closing line of paths and a digest (docs/sealed-custody.md, "What may print").
      if (insideGitTree(o.out)) throw new RunnerError('HE-SEALED-002', `--out ${resolve(o.out)} is inside a git work tree; a sealed row P writes outside every checkout (use <raw results>/row-p)`);
      const input = rowPInput({ sealedRoot });
      const g = sealedGuard({ root: resolve(sealedRoot), set: input.set, repoRoot: process.cwd(), ...(input.preregJson ? { preregJson: input.preregJson } : {}), logFile: join(resolve(o.out), 'row-p.sealed.log'), allow: [SEALED_PROGRESS], label: 'scripts/owner-identity/row-p.ts' });
      const s = await runRowP(o);
      const file = join(resolve(o.out), model, 'summary.json');
      g.say(`row-p ${model}: ${(s.rows as unknown[]).length} task tries, $${Number(s.usd).toFixed(4)} under lease ${o.lease}; wrote ${file} (sha256 ${sha256(readFileSync(file))}); the step log is ${g.logFile} (custody only)`);
    }
  } catch (e) { console.error(e instanceof RunnerError ? e.message : `row-p: ${(e as Error).name}`); process.exit(e instanceof RunnerError ? e.exit : 2); }
}
