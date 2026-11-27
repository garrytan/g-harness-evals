// internal-task: a held-out set that brings its own world (the owner-identity banks) through the whole sealed lifecycle, keyless.
// A throwaway 256-bit seed generates a bank with world/owner-identity/generate.ts, written outside the checkout; it is sealed
// with seal.ts --world (its world.json, people.json, owner card and coverage under sealed.own_world), opened for a
// preregistered run, planned under the sealed root, run with the fixture adapter as a host process (arm N notes cells
// carrying the bank's owner card), exported under the embargo with the leak scan, cleaned up and released. Every refusal for a
// slice of the public world still holds, and the dev set's public world, people and card never reach a held-out cell. The age
// identity, the custody branch and the gh answer come from tests/sealed-fixture.ts; nothing here is a real key or a real seed.
import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sha256, verifySealedRoot } from '../runner/heldout/sealed.ts';
import { heldoutSet, manifestProblems, readManifest, sealedProblems } from '../scripts/seal-heldout.ts';
import { sealSet } from '../scripts/sealed/seal.ts';
import { openRun } from '../scripts/sealed/open.ts';
import { exportRun } from '../scripts/sealed/export.ts';
import { cleanup } from '../scripts/sealed/cleanup.ts';
import { releaseSet } from '../scripts/sealed/release.ts';
import { readAccessLog } from '../scripts/sealed/custody.ts';
import { generateBank, writeBank } from '../world/owner-identity/generate.ts';
import { executeRun, readRecords } from '../runner/trial/run.ts';
import { buildManifest, loadPrereg, type Manifest } from '../runner/run.ts';
import type { GradeResult } from '../runner/contracts.ts';
import { candidate, cloneCustody, co, commitPush, makeFixture, ROOT, type Fixture } from './sealed-fixture.ts';

const SET = 'oi-syn';
let f: Fixture | undefined;
afterAll(() => { if (f) rmSync(f.tmp, { recursive: true, force: true }); });

const filesUnder = (dir: string): string[] => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
const refused = async (p: Promise<unknown>) => p.then(() => 'no refusal', (e: Error) => e.message);

test('a set with its own world seals, opens, runs on its own world, people and card, exports and releases', async () => {
  f = await makeFixture(2);
  // the bank: a throwaway seed, two import tasks and one live task kept (the rest of the 48 go, to keep the test short)
  const bank = join(f.tmp, 'oi-bank');
  writeBank(generateBank(randomBytes(32).toString('hex'), 'heldout', 42), bank);
  const all = readdirSync(join(bank, 'heldout')).sort();
  const kept = [...all.filter((t) => t.endsWith('-import')).slice(0, 2), all.find((t) => t.endsWith('-live'))!];
  for (const t of all) if (!kept.includes(t)) rmSync(join(bank, 'heldout', t), { recursive: true });
  const people = JSON.parse(readFileSync(join(bank, 'world', 'people.json'), 'utf8')) as { owner: string; people: Array<{ id: string; name: string }> };
  const ownerName = people.people.find((p) => p.id === people.owner)!.name;
  const devWorld = join(ROOT, 'tasks', 'multiuser', 'owner-identity', 'world');
  const base = { repo: f.repo, set: SET, tasks: join(bank, 'heldout'), corpus: join(bank, 'corpus'), custody: f.custody, recipient: f.recipient, gh: f.gh };

  // the old refusals hold: the bank's world is no slice of the public world, a dev world is no held-out world, and a
  // multiuser set takes --slice or --world, exactly one
  expect(await refused(sealSet({ ...base, slice: join(bank, 'world', 'world.json') }))).toMatch(/^HE-SEALED-006 the world slice does not fit the public world: slice: unknown key bot_reads_files_of/);
  expect(await refused(sealSet({ ...base, world: devWorld }))).toMatch(/^HE-SEALED-006 the set's own world is not one a held-out set can bring: world: \d+ of its \d+ members are not in the held-out split/);
  expect(await refused(sealSet({ ...base, world: join(bank, 'world'), slice: join(bank, 'world', 'world.json') }))).toMatch(/exactly one$/);
  expect(await refused(sealSet({ ...base, kind: 'repo', world: join(bank, 'world') }))).toMatch(/drop --slice, --world and --corpus$/);
  const strayWorld = join(f.tmp, 'stray-world');
  cpSync(join(bank, 'world'), strayWorld, { recursive: true });
  mkdirSync(join(strayWorld, 'nested'));
  expect(await refused(sealSet({ ...base, world: strayWorld }))).toMatch(/holds "nested", which is not a regular file/);
  expect(readdirSync(join(f.repo, 'tasks', 'multiuser'))).not.toContain(SET);

  const sealed = await sealSet({ ...base, world: join(bank, 'world') });
  const s = sealed.manifest.sealed!;
  expect(Object.keys(s.own_world!).sort()).toEqual(['world/coverage.json', 'world/owner-card.md', 'world/people.json']);
  expect(s.own_world!['world/people.json']).toBe(sha256(readFileSync(join(bank, 'world', 'people.json'))));
  expect(s.world_slice_sha256).toBe(sha256(readFileSync(join(bank, 'world', 'world.json'))));
  expect([sealed.manifest.world_manifest_sha256, sealed.manifest.world_json_sha256]).toEqual([null, null]);
  expect(s.task_count).toBe(3);
  const m = JSON.parse(readFileSync(sealed.manifestPath, 'utf8'));
  Object.assign(m, { opening_budget: 2, alpha_per_opening: 0.025, status: 'open', openings: [], exposures: [] });
  writeFileSync(sealed.manifestPath, JSON.stringify(m, null, 2) + '\n');
  commitPush(f, 'seal oi-syn');
  const set = heldoutSet(SET, f.repo);
  expect(manifestProblems(set)).toEqual([]);
  // the public world may change after an own-world seal: the set was never written against it
  const seedManifest = join(f.repo, 'world', 'seed', 'MANIFEST.json');
  const seedBytes = readFileSync(seedManifest);
  writeFileSync(seedManifest, seedBytes.toString('utf8').replace(/\n$/, '\n\n'));
  expect(manifestProblems(set)).toEqual([]);
  writeFileSync(seedManifest, seedBytes);
  // a hand-edited own_world is refused keyless
  expect(sealedProblems({ ...m, sealed: { ...m.sealed, own_world: { 'world/world.json': s.world_slice_sha256 } } }, set)).toContain('sealed.own_world must map world/<name> files beside the world.json (never world/world.json or world/slice.json) to 64-hex sha256 digests, on a multiuser set');
  expect(sealedProblems({ ...m, world_manifest_sha256: sha256(seedBytes) }, set)).toContain('world_manifest_sha256 and world_json_sha256 must be null for a set with its own world, which is not written against the public world');

  // nothing of the bank is in the public checkout
  const secrets = [ownerName, ...kept, ...people.people.map((p) => p.name)];
  for (const p of filesUnder(f.repo).filter((p) => !p.includes('/.git/'))) {
    const text = readFileSync(p, 'utf8');
    for (const x of secrets) expect(`${relative(f.repo, p)} holds ${x}: ${text.includes(x)}`).toBe(`${relative(f.repo, p)} holds ${x}: false`);
  }

  // preregister arm N on the bank: a held-out cell's card is the bank's world/owner-card.md, never the dev set's
  const run = { runId: 'oi-syn-run', dir: '2026-11-21-oi-syn-run' };
  const cell = (id: string, extra: Record<string, unknown> = {}) => ({ id, harness: 'claude-code', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'heldout', task_set: SET, repetitions: 1, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, notes: true, ...extra });
  const prereg = (cells: unknown[]) => ({
    schema_version: 1, run_id: run.runId, question: 'Synthetic own-world sealed fixture, never counted.', tasks: {}, cells, wall_clock_s: { multiuser: 60 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [],
    heldout: { set: SET, label: 'confirmatory', candidate_sha256: candidate('oi'), claims: [{ id: 'C1', sentence: 'The carded cell passes more often than the plain cell', source: 'comparisons.json', path: 'comparisons', where: { a: 'plain', b: 'carded' }, rule: 'superiority', direction: 'increase' }] },
  });
  const devCard = join(devWorld, 'owner-card.md');
  const tryPrereg = join(f.tmp, 'try-prereg.json');
  writeFileSync(tryPrereg, JSON.stringify(prereg([cell('plain'), cell('carded', { owner_card: devCard })])));
  expect(() => loadPrereg(tryPrereg)).toThrow(/HE-TASK-002 cell carded: a held-out cell's owner_card is "world\/owner-card\.md", the bank's own card in its sealed root/);
  const dir = join(f.repo, 'docs', 'benchmarks', run.dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'PREREGISTRATION.md'), `# ${run.runId}\n\nSynthetic fixture.\n`);
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify(prereg([cell('plain'), cell('carded', { owner_card: 'world/owner-card.md' })]), null, 2) + '\n');
  const reg = join(f.repo, 'docs', 'benchmarks', 'preregistrations.json');
  const registry = JSON.parse(readFileSync(reg, 'utf8'));
  registry.experiments.push({ id: run.runId, preregistration: `docs/benchmarks/${run.dir}/PREREGISTRATION.md`, results: [`docs/benchmarks/${run.dir}/sealed-results/**`] });
  writeFileSync(reg, JSON.stringify(registry, null, 2) + '\n');
  const mm = JSON.parse(readFileSync(set.manifest, 'utf8'));
  mm.openings.push({ run_id: run.runId, status: 'planned', label: 'confirmatory', candidate_sha256: candidate('oi') });
  writeFileSync(set.manifest, JSON.stringify(mm, null, 2) + '\n');
  commitPush(f, `preregister ${run.runId}`);
  const preregRel = `docs/benchmarks/${run.dir}/prereg.json`;
  // a plan with no sealed root has no card to hand a held-out cell
  const loaded = loadPrereg(join(f.repo, preregRel));
  expect(() => buildManifest({ ...loaded.prereg, cells: loaded.prereg.cells.filter((c) => c.id === 'carded') }, loaded.sha256, undefined, { tasksRoot: join(f!.repo, 'tasks') })).toThrow(/HE-TASK-002 cell carded: a held-out cell's owner card is world\/owner-card\.md of its set's sealed root, and this plan has no sealed root for the cell/);

  // open: the root's world/ is the bank's world dir, verbatim; no public world is merged
  const opened = await openRun({ repo: f.repo, prereg: preregRel, ...co(f), out: join(f.work, 'root'), log: () => undefined });
  const root = opened.root, receiptPath = join(root, 'opening-receipt.json');
  expect(readdirSync(join(root, 'world')).sort()).toEqual(['coverage.json', 'owner-card.md', 'people.json', 'slice.json', 'world.json']);
  for (const n of ['world.json', 'people.json', 'owner-card.md', 'coverage.json']) expect(readFileSync(join(root, 'world', n)).equals(readFileSync(join(bank, 'world', n)))).toBe(true);
  expect(opened.receipt.public_world_sha256).toBeNull();
  expect(opened.receipt.world_sha256).toBe(s.world_slice_sha256);
  expect(opened.receipt.own_world).toEqual(s.own_world);
  expect(readdirSync(join(root, 'corpus', 'heldout', 'people')).length).toBe(people.people.length + 1);
  expect(verifySealedRoot(root, opened.receipt, f.repo)).toEqual([]);
  // an edited card or a planted world file fails the root before any run
  const card = join(root, 'world', 'owner-card.md');
  const cardBytes = readFileSync(card);
  writeFileSync(card, 'not the bank card\n');
  expect(verifySealedRoot(root, opened.receipt, f.repo)).toEqual([`sealed root ${root} has own-world files (3) beside world/world.json that do not match the opening receipt (3)`]);
  writeFileSync(card, cardBytes);
  writeFileSync(join(root, 'world', 'extra.json'), '{}');
  expect(verifySealedRoot(root, opened.receipt, f.repo)).toHaveLength(1);
  rmSync(join(root, 'world', 'extra.json'));

  // plan under the root (the CLI, as the custodian runs it)
  const results = join(f.work, 'results', run.runId);
  const bun = (args: string[]) => spawnSync(process.execPath, args, { cwd: f!.repo, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  const plan = bun([join(ROOT, 'runner', 'run.ts'), 'plan', '--prereg', preregRel, '--out', results, '--sealed-root', root, '--opening-receipt', receiptPath]);
  expect(plan.status, plan.stderr + plan.stdout).toBe(0);
  const manifest = JSON.parse(readFileSync(join(results, 'manifest.json'), 'utf8')) as Manifest;
  expect(manifest.trials.length).toBe(6);
  for (const name of kept) expect(plan.stdout).not.toContain(name);

  // run: the fixture adapter stands in for the harness as a host process (tests only; the CLI refuses process mode for a
  // sealed run). The trial world is the bank's world, the notes store is seeded from its people pages, the grader reads its
  // people.json, and the carded cell is handed the bank's card.
  const asFixture = { ...manifest, cells: manifest.cells.map((c) => ({ ...c, harness: '_fixture', harness_mode: 'process' as const, adapter: join(ROOT, 'tests', 'fixtures', 'serve-adapter.ts') })) };
  const grade = (): GradeResult => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] });
  const ran = await executeRun(asFixture, join(results, 'manifest.json'), { harnessMode: 'process', preamblePath: join(ROOT, 'tasks', 'multiuser', '_shared', 'preamble.md'), grade, proxyEnv: { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY: 'placeholder-anthropic', OPENAI_API_KEY: 'placeholder-openai' }, turnGraceS: 1, stopGraceS: 2, readyTimeoutS: 20, repoRoot: ROOT, sealedRoot: root, sealedSet: SET, worldPath: join(root, 'world', 'world.json'), log: () => undefined });
  expect(ran.records.length).toBe(6);
  const records = readRecords(results);
  const carded = records.filter((r) => r.cell === 'carded');
  expect(carded.map((r) => r.owner_card?.card_sha256)).toEqual(carded.map(() => sha256(cardBytes)));
  expect(sha256(cardBytes)).not.toBe(sha256(readFileSync(devCard)));
  for (const r of records.filter((x) => x.cell === 'plain')) expect(r.owner_card?.expected).toBe(false);
  for (const r of records) {
    const trialDir = join(results, 'trials', ...r.trial_id.split('/').slice(1));
    const verdicts = JSON.parse(readFileSync(join(trialDir, 'owner-identity', 'verdicts.json'), 'utf8')) as { owner?: string; summary?: unknown };
    expect(JSON.stringify(verdicts)).toContain(people.owner);
    const events = readFileSync(join(trialDir, 'events.jsonl'), 'utf8');
    expect(events).not.toContain('owner-identity-dev');
  }

  // summarize under the root, then export under the embargo: the leak scan covers the bank's own world files
  const sum = bun([join(ROOT, 'scripts', 'summarize-run.ts'), '--results', results, '--sealed-root', root]);
  expect(sum.status, sum.stderr + sum.stdout).toBe(0);
  expect(JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8')).families_unresolved ?? []).toEqual([]);
  const exportClone = cloneCustody(f, 'custody-export');
  const { out } = await exportRun({ repo: f.repo, results, sealedRoot: root, receipt: receiptPath, custody: exportClone, gh: f.gh, log: () => undefined });
  expect(readdirSync(out).sort()).toEqual(['README.md', 'export.json', 'opening-receipt.json']);
  for (const p of filesUnder(out)) {
    const text = readFileSync(p, 'utf8');
    for (const x of secrets) expect(`${relative(f.repo, p)} holds ${x}: ${text.includes(x)}`).toBe(`${relative(f.repo, p)} holds ${x}: false`);
  }
  commitPush(f, 'sealed export of oi-syn-run');
  const cleaned = cleanup({ repo: f.repo, exportJson: join(out, 'export.json'), sealedRoot: root, results: [results], custody: exportClone, log: () => undefined });
  expect(cleaned.removed).toEqual([root, results]);

  // release: the bank's own world files come out beside the slice, and --check passes on the plaintext set
  const rel = await releaseSet({ repo: f.repo, set: SET, ...co(f), custody: cloneCustody(f, 'custody-release'), log: () => undefined });
  expect(rel).toEqual({ runs: [run.runId], tasks: 3 });
  for (const n of ['people.json', 'owner-card.md', 'coverage.json']) expect(readFileSync(join(f.repo, 'tasks', 'multiuser', SET, 'sealed-world', 'world', n)).equals(readFileSync(join(bank, 'world', n)))).toBe(true);
  expect(readFileSync(join(f.repo, 'tasks', 'multiuser', SET, 'sealed-world', 'slice.json')).equals(readFileSync(join(bank, 'world', 'world.json')))).toBe(true);
  expect(readManifest(set)!.custody).toBeUndefined();
  expect(manifestProblems(set)).toEqual([]);
  expect(readAccessLog(cloneCustody(f, 'custody-final')).filter((e) => e.set === SET).map((e) => e.event)).toEqual(['sealed', 'opened', 'exported', 'released']);
}, 300_000);
