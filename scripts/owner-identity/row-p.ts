// Row P of the owner-identity eval (GST-3217): gbrain alone, no harness. For each import task of a set, a fresh gbrain home
// gets the set's people pages and the owner (gbrain access owner set), then each import file goes through the gbrain importer
// that reads its format: `gbrain transcripts ingest --facts` for agent session logs, `gbrain capture` plus
// `gbrain extract-conversation-facts` for every other file. Every gbrain command runs in the sidecar image through
// scripts/owner-identity/gbrain-metered.ts, so gbrain's own model calls are metered under one lease and gbrain never sees a key.
// The brain is then dumped (runner/grade/owner-identity-store.ts) and graded (runner/grade/owner-identity.ts) like a trial.
//
//   bun scripts/owner-identity/row-p.ts --set tasks/multiuser/owner-identity --lease <run id> --cap-usd <n> --out <dir>
//     --image <gbrain image> [--model shipped|opus] [--tasks a,b] [--tries <n>] [--ledger <file>]
//
// --model shipped (default) leaves gbrain's extraction model at its default and expects anthropic:claude-haiku-5-5;
// opus pins facts.extraction_model to anthropic:claude-opus-5-5 first. <out>/<model>/<task>/try-<k>/ holds the home, the
// staged files, one <label>.json per gbrain command, store.json and verdicts.json; <out>/<model>/summary.json totals them.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { RunnerError } from '../../runner/errors.ts';
import { dumpGbrainBrain, writeStore } from '../../runner/grade/owner-identity-store.ts';
import { gradeOwnerIdentityFiles, type Gold, type People } from '../../runner/grade/owner-identity.ts';
import type { World } from '../../world/types.ts';
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

export async function runRowP(o: { set: string; lease: string; capUsd: number; out: string; image: string; model: PModel; tasks?: string[]; tries: number; ledger?: string }): Promise<Record<string, unknown>> {
  const set = resolve(o.set);
  const world = JSON.parse(readFileSync(join(set, 'world', 'world.json'), 'utf8')) as World;
  const people = JSON.parse(readFileSync(join(set, 'world', 'people.json'), 'utf8')) as People;
  const owner = world.members.find((m) => m.id === people.owner);
  if (!owner) throw new RunnerError('HE-TASK-002', `people.json names owner ${people.owner}, no member of ${set}/world/world.json`);
  const model = P_MODELS[o.model];
  const tasks = (o.tasks ?? readdirSync(join(set, 'dev')).filter((t) => existsSync(join(set, 'dev', t, 'gold.json')))).sort()
    .filter((t) => (JSON.parse(readFileSync(join(set, 'dev', t, 'gold.json'), 'utf8')) as Gold & { family?: string }).family === 'I');
  const ledger = o.ledger ?? join(resolve(o.out), 'ledger.sqlite');
  const rows: Array<Record<string, unknown>> = [];
  for (const task of tasks) {
    const gold = JSON.parse(readFileSync(join(set, 'dev', task, 'gold.json'), 'utf8')) as Gold & { formats: Array<{ file: string; format: string; format_known_to_gbrain: boolean }> };
    const files = importFiles(world, owner.id, task);
    for (let k = 1; k <= o.tries; k++) {
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
          mounts: [`${join(set, 'corpus', 'dev')}:/corpus`, `${imports}:/imports`], ...(!model.pin || after ? { expectExtraction: model.extraction } : {}) });
        const usage = record.usage as { requests: number; usd: number; refused: number };
        results.push({ label: step.label, exit, requests: usage.requests, usd: usage.usd, refused: usage.refused });
        console.log(`row-p ${o.model} ${task} try ${k}: ${step.label} exit ${exit}, ${usage.requests} call(s), $${usage.usd.toFixed(4)}`);
      }
      const store = join(dir, 'store.json');
      writeStore(store, dumpGbrainBrain({ brainDir: home, image: o.image, mountAt: '/brain-home' }));
      const verdicts = gradeOwnerIdentityFiles({ store, gold: join(set, 'dev', task, 'gold.json'), people: join(set, 'world', 'people.json'), out: join(dir, 'verdicts.json'), arm: 'P' });
      const row = { task, try: k, model: o.model, extraction_model: model.extraction, formats: gold.formats, steps: results, usd: results.reduce((n, r) => n + Number(r.usd), 0), summary: verdicts.summary };
      writeFileSync(join(dir, 'row.json'), JSON.stringify(row, null, 1) + '\n');
      rows.push(row);
    }
  }
  const summary = { schema_version: 1, set: o.set, model: o.model, extraction_model: model.extraction, image: o.image, lease: o.lease, tries: o.tries, rows, usd: rows.reduce((n, r) => n + Number(r.usd), 0) };
  mkdirSync(join(resolve(o.out), o.model), { recursive: true });
  writeFileSync(join(resolve(o.out), o.model, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  return summary;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const model = (arg(argv, 'model') ?? 'shipped') as PModel;
  const o = { set: arg(argv, 'set') ?? '', lease: arg(argv, 'lease') ?? '', capUsd: Number(arg(argv, 'cap-usd')), out: arg(argv, 'out') ?? '', image: arg(argv, 'image') ?? '', model,
    tries: Number(arg(argv, 'tries') ?? 1), ...(arg(argv, 'tasks') ? { tasks: arg(argv, 'tasks')!.split(',') } : {}), ...(arg(argv, 'ledger') ? { ledger: arg(argv, 'ledger') } : {}) };
  if (!o.set || !o.lease || !o.out || !o.image || !(o.capUsd > 0) || !(model in P_MODELS) || !(o.tries >= 1)) {
    console.error('usage: bun scripts/owner-identity/row-p.ts --set <tasks/multiuser/<set>> --lease <run id> --cap-usd <n> --out <dir> --image <gbrain image> [--model shipped|opus] [--tasks a,b] [--tries <n>] [--ledger <file>]');
    process.exit(2);
  }
  try { const s = await runRowP(o); console.log(`row-p ${model}: ${(s.rows as unknown[]).length} task tries, $${Number(s.usd).toFixed(4)} under lease ${o.lease}`); }
  catch (e) { console.error((e as Error).message); process.exit(e instanceof RunnerError ? e.exit : 2); }
}
