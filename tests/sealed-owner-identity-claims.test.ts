// internal-task: owner-identity claims decided under sealed custody, keyless. A throwaway bank (world/owner-identity/generate.ts) is
// sealed with its own world, preregistered with two comparisons.owner-identity.json claims and its heldout.owner_identity
// analysis config, opened, planned and run with the fixture adapter (as tests/sealed-own-world.test.ts does), and given a
// sealed row P output under <results>/row-p (row P's sealed input from the root; its gbrain steps are not run here). The trial
// verdicts of one cell are hand-edited to stand for arm G with false-owner hits, so the claims have something to decide.
// scripts/owner-identity/analyze.ts then runs inside custody and prints paths only, and export.ts decides both claims through
// it under the embargo with the leak scan. Nothing here is a real key or a real seed.
import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sealSet } from '../scripts/sealed/seal.ts';
import { openRun } from '../scripts/sealed/open.ts';
import { exportRun } from '../scripts/sealed/export.ts';
import { heldoutSet } from '../scripts/seal-heldout.ts';
import { generateBank, writeBank } from '../world/owner-identity/generate.ts';
import { executeRun, readRecords } from '../runner/trial/run.ts';
import type { Manifest } from '../runner/run.ts';
import type { GradeResult } from '../runner/contracts.ts';
import { rowPInput } from '../scripts/owner-identity/row-p.ts';
import { readRowP } from '../scripts/owner-identity/analyze.ts';
import { candidate, cloneCustody, co, commitPush, makeFixture, ROOT, type Fixture } from './sealed-fixture.ts';

const SET = 'oi-claims';
const MODEL = 'anthropic:claude-opus-5-5';
let f: Fixture | undefined;
afterAll(() => { if (f) rmSync(f.tmp, { recursive: true, force: true }); });
const filesUnder = (dir: string): string[] => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));

test('owner-identity claims are decided from verdicts and sealed row P inside custody, and the export prints only bits', async () => {
  f = await makeFixture(2);
  const bank = join(f.tmp, 'oi-bank');
  writeBank(generateBank(randomBytes(32).toString('hex'), 'heldout', 42), bank);
  const all = readdirSync(join(bank, 'heldout')).sort();
  const kept = [...all.filter((t) => t.endsWith('-import')).slice(0, 3)];
  for (const t of all) if (!kept.includes(t)) rmSync(join(bank, 'heldout', t), { recursive: true });
  const people = JSON.parse(readFileSync(join(bank, 'world', 'people.json'), 'utf8')) as { owner: string; people: Array<{ id: string; name: string }> };
  const sealed = await sealSet({ repo: f.repo, set: SET, tasks: join(bank, 'heldout'), corpus: join(bank, 'corpus'), custody: f.custody, recipient: f.recipient, gh: f.gh, world: join(bank, 'world') });
  const m = JSON.parse(readFileSync(sealed.manifestPath, 'utf8'));
  Object.assign(m, { opening_budget: 2, alpha_per_opening: 0.025, status: 'open', openings: [], exposures: [] });
  writeFileSync(sealed.manifestPath, JSON.stringify(m, null, 2) + '\n');
  commitPush(f, 'seal ' + SET);
  const secrets = [...kept, ...people.people.map((p) => p.name)];

  const run = { runId: 'oi-claims-run', dir: '2026-11-21-oi-claims-run' };
  const cell = (id: string, extra: Record<string, unknown> = {}) => ({ id, harness: 'claude-code', model: MODEL, slice: 'multiuser', split: 'heldout', task_set: SET, repetitions: 1, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, notes: true, ...extra });
  const gn = `g_vs_n/false_owner/${MODEL}/claude-code`, pg = `p_vs_g/false_owner/${MODEL}/pooled/I`;
  const owner_identity = { seed: 5, draws: 2000, sdd: { g_vs_n_harness: 0.11, g_vs_n_pooled: 0.06, b_vs_g_harness: 0.11, b_vs_g_pooled: 0.06, p_vs_g: 0.07, harness_vs_harness: 0.13 }, p_vs_g: { model: MODEL, margin: 0.1 } };
  const claims = [
    { id: 'OI-1', sentence: 'Arm G files more non-owner facts as the owner than arm N on Claude Code', source: 'comparisons.owner-identity.json', path: 'comparisons', where: { id: gn }, rule: 'superiority', direction: 'increase' },
    { id: 'OI-2', sentence: 'Row P with Opus extraction is no worse than the Opus G cells on family I false-owner, within 10 points', source: 'comparisons.owner-identity.json', path: 'comparisons', where: { id: pg }, rule: 'noninferiority', direction: 'decrease', margin: 0.1 },
  ];
  const prereg = (heldout: Record<string, unknown>) => ({
    schema_version: 1, run_id: run.runId, question: 'Synthetic owner-identity claims fixture, never counted.', tasks: {}, cells: [cell('plain'), cell('carded', { owner_card: 'world/owner-card.md' })], wall_clock_s: { multiuser: 60 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [],
    heldout: { set: SET, label: 'confirmatory', candidate_sha256: candidate('oi-claims'), claims, ...heldout },
  });
  const dir = join(f.repo, 'docs', 'benchmarks', run.dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'PREREGISTRATION.md'), `# ${run.runId}\n\nSynthetic fixture.\n`);
  const preregRel = `docs/benchmarks/${run.dir}/prereg.json`;
  const reg = join(f.repo, 'docs', 'benchmarks', 'preregistrations.json');
  const registry = JSON.parse(readFileSync(reg, 'utf8'));
  registry.experiments.push({ id: run.runId, preregistration: `docs/benchmarks/${run.dir}/PREREGISTRATION.md`, results: [`docs/benchmarks/${run.dir}/sealed-results/**`] });
  writeFileSync(reg, JSON.stringify(registry, null, 2) + '\n');
  const set = heldoutSet(SET, f.repo);
  const mm = JSON.parse(readFileSync(set.manifest, 'utf8'));
  mm.openings.push({ run_id: run.runId, status: 'planned', label: 'confirmatory', candidate_sha256: candidate('oi-claims') });
  writeFileSync(set.manifest, JSON.stringify(mm, null, 2) + '\n');

  // without the analysis config the claims cannot be decided, so open.ts refuses before an opening is spent
  writeFileSync(join(f.repo, preregRel), JSON.stringify(prereg({}), null, 2) + '\n');
  commitPush(f, `preregister ${run.runId} without its analysis config`);
  const noConfig = await openRun({ repo: f.repo, prereg: preregRel, ...co(f), out: join(f.work, 'root-refused'), log: () => undefined }).then(() => 'opened', (e: Error) => e.message);
  expect(noConfig).toMatch(/heldout.owner_identity is missing/);
  writeFileSync(join(f.repo, preregRel), JSON.stringify(prereg({ owner_identity }), null, 2) + '\n');
  commitPush(f, `preregister ${run.runId}`);

  const opened = await openRun({ repo: f.repo, prereg: preregRel, ...co(f), out: join(f.work, 'root'), log: () => undefined });
  const root = opened.root, receiptPath = join(root, 'opening-receipt.json');
  const results = join(f.work, 'results', run.runId);
  const bun = (args: string[]) => spawnSync(process.execPath, args, { cwd: f!.repo, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  const plan = bun([join(ROOT, 'runner', 'run.ts'), 'plan', '--prereg', preregRel, '--out', results, '--sealed-root', root, '--opening-receipt', receiptPath]);
  expect(plan.status, plan.stderr + plan.stdout).toBe(0);
  const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as Manifest;
  const asFixture = { ...manifest, cells: manifest.cells.map((c) => ({ ...c, harness: '_fixture', harness_mode: 'process' as const, adapter: join(ROOT, 'tests', 'fixtures', 'serve-adapter.ts') })) };
  const grade = (): GradeResult => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] });
  await executeRun(asFixture, join(results, 'manifest.json'), { harnessMode: 'process', preamblePath: join(ROOT, 'tasks', 'multiuser', '_shared', 'preamble.md'), grade, proxyEnv: { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' }, turnGraceS: 1, stopGraceS: 2, readyTimeoutS: 20, repoRoot: ROOT, sealedRoot: root, sealedSet: SET, worldPath: join(root, 'world', 'world.json'), log: () => undefined });
  const records = readRecords(results);
  expect(records.length).toBe(6);

  // hand-edited verdicts: the carded cell stands for arm G, with every non-owner fact filed on the owner
  type V = { arm: string; family: string; facts: Array<{ primary: string; false_owner_hit: boolean; owner_sources: string[] }> };
  const verdictsOf = (r: (typeof records)[number]) => join(results, 'trials', ...r.trial_id.split('/').slice(1), 'owner-identity', 'verdicts.json');
  for (const r of records) {
    const v = JSON.parse(readFileSync(verdictsOf(r), 'utf8')) as V;
    const g = r.cell === 'carded';
    v.arm = g ? 'G' : 'N';
    for (const x of v.facts) if (x.primary === 'false_owner') { x.false_owner_hit = g; x.owner_sources = g ? ['model_write'] : []; }
    writeFileSync(verdictsOf(r), JSON.stringify(v, null, 1) + '\n');
  }
  // sealed row P: its input comes from the opened root, bound to this opening; the tries are the plain cell's verdicts as arm P
  const input = rowPInput({ sealedRoot: root, repoRoot: f.repo });
  expect(input.sealed).toMatchObject({ set: SET, run_id: run.runId });
  expect(input.tasks.sort()).toEqual([...kept].sort());
  expect(input.people).toBe(join(root, 'world', 'people.json'));
  expect(input.corpus).toBe(join(root, 'corpus', 'heldout'));
  const pDir = join(results, 'row-p', 'opus');
  const rows = records.filter((r) => r.cell === 'plain').map((r) => {
    mkdirSync(join(pDir, r.task, 'try-1'), { recursive: true });
    const v = JSON.parse(readFileSync(verdictsOf(r), 'utf8')) as V;
    writeFileSync(join(pDir, r.task, 'try-1', 'verdicts.json'), JSON.stringify({ ...v, arm: 'P' }));
    return { task: r.task, try: 1 };
  });
  const summary = { schema_version: 1, set: input.set, model: 'opus', extraction_model: MODEL, rows, sealed: input.sealed };
  writeFileSync(join(pDir, 'summary.json'), JSON.stringify(summary));
  expect(() => readRowP(join(results, 'row-p'), () => null, 'another-run')).toThrow(/^HE-SEALED-003 .* is bound to run oi-claims-run, not run another-run/);

  // the analysis inside custody prints paths only; a run planned with a sealed root is refused without one
  const bare = bun([join(ROOT, 'scripts', 'owner-identity', 'analyze.ts'), '--results', results]);
  expect(bare.status).toBe(2);
  expect(bare.stderr).toMatch(/^HE-SEALED-001 /);
  const an = bun([join(ROOT, 'scripts', 'owner-identity', 'analyze.ts'), '--results', results, '--sealed-root', root]);
  expect(an.status, an.stderr).toBe(0);
  expect(an.stdout.trim().split('\n')).toEqual([expect.stringMatching(/^analyze: wrote \S+comparisons\.owner-identity\.json and \S+comparisons\.owner-identity\.md \(2 cells, 1 row P models, \d+ comparisons\)$/)]);
  for (const x of secrets) expect(an.stdout + an.stderr).not.toContain(x);
  const analysis = JSON.parse(readFileSync(join(results, 'comparisons.owner-identity.json'), 'utf8'));
  expect(analysis.config).toEqual(owner_identity);
  expect(analysis.comparisons.find((c: { id: string }) => c.id === gn)).toMatchObject({ delta: 1, n_clusters: 3 });
  expect(analysis.comparisons.find((c: { id: string }) => c.id === pg)).toMatchObject({ delta: -1, noninferiority: { margin: 0.1, direction: 'lower' } });

  // export decides both claims through analyze.ts (with one --margin for OI-2) under the embargo; nothing sealed reaches the public files
  const { out, export: exp } = await exportRun({ repo: f.repo, results, sealedRoot: root, receipt: receiptPath, custody: cloneCustody(f, 'custody-export'), gh: f.gh, log: () => undefined });
  expect(exp.mode).toBe('embargo');
  expect(exp.decisions).toEqual([
    { claim: 'OI-1', decision: 'reject', sentence: `OI-1: rejected. ${claims[0]!.sentence}.` },
    { claim: 'OI-2', decision: 'accept', sentence: `OI-2: accepted. ${claims[1]!.sentence}.` },
  ]);
  expect(readFileSync(join(results, 'export.analyze.log'), 'utf8')).toContain(`--margin G/pooled/${MODEL},P/opus,0.1,lower,false_owner`);
  for (const p of filesUnder(out)) {
    const text = readFileSync(p, 'utf8');
    for (const x of secrets) expect(`${relative(f.repo, p)} holds ${x}: ${text.includes(x)}`).toBe(`${relative(f.repo, p)} holds ${x}: false`);
  }
}, 300_000);
