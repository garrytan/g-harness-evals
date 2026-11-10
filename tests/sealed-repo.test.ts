// internal-task PR A: custody for repo-kind held-out sets (tasks/repo/<set>/, the gstack-native task format), end to end on a
// synthetic set, offline and keyless. A two-task repo set with a generator/ directory and one extra is sealed next to the
// fixture's multiuser set, preregistered with three arms on two models (none, gstack, placebo), opened and resumed, given a
// fake trials.jsonl and a gate file in which one model fails its gate, exported with a primary and a secondary claim
// family, cleaned up (Harbor job directories and labelled images, with an inventory) and released. Beside it: a world
// change touches the multiuser set and not the repo set, set names are unique across kinds, and a repo task body planted
// under tasks/repo/<set>/heldout/ is refused by the publication check and by gstack-pregate sealed.
//
// Value: protects=the custody chain for repository task sets (seal, open, export, cleanup, release) and its guards;
// fails_when=a repo set's plaintext, generator or task ids reach a public file or the terminal, a gate failure still enters
// Holm, a world change breaks a repo set, or a planted repo task body passes either guard; why_new=repo-kind sets are new in
// internal-task; seam=the in-process custody functions on a throwaway repository with a local bare custody remote, the
// publication check on a throwaway git repository, gstack-pregate sealed when gstack is installed; no_claim=Harbor itself,
// docker itself (a stand-in answers), the Lane B bridge (PR B) and a real gstack-native task.
import { afterAll, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decryptWith, sha256, unpackTar, verifySealedRoot } from '../runner/heldout/sealed.ts';
import { claimProblems, deriveSet, type HeldoutClaim } from '../runner/heldout/openings.ts';
import { heldoutSet, heldoutSets, manifestProblems, readManifest, setNameProblems } from '../scripts/seal-heldout.ts';
import { finalStageSealed, sealSet } from '../scripts/sealed/seal.ts';
import { openRun } from '../scripts/sealed/open.ts';
import { collectSecrets, decide, exportRun, failedGates, leakScan } from '../scripts/sealed/export.ts';
import { sealedRedactor } from '../runner/heldout/guard.ts';
import { cleanup } from '../scripts/sealed/cleanup.ts';
import { releaseSet } from '../scripts/sealed/release.ts';
import { readAccessLog } from '../scripts/sealed/custody.ts';
import { publicationFindings } from '../scripts/check-sealed-publication.ts';
import { candidate, cloneCustody, co, commitPush, git, makeFixture, ROOT, SCRUBBED_ENV, SET as MU_SET, type Fixture } from './sealed-fixture.ts';

const RSET = 'rsyn';
const TASKS = ['rx-01-fix-parser', 'rx-02-review-ledger'];
const RSECRETS = {
  instruction: 'The Zephyrine parser drops the last field of a line that ends in a comma; fix it on the main branch.',
  review: 'Review the Marrowfield ledger change and list each defect in findings.json.',
  seed: "SEED = 'quartzite-otter-4471'",
  audit: 'audit note: quartzite batch kept 2 of 9 drafts',
};
const CELLS = ['haiku-none', 'haiku-gstack', 'haiku-placebo', 'opus-none', 'opus-gstack', 'opus-placebo'];
const modelOf = (cell: string) => (cell.startsWith('haiku') ? 'anthropic:claude-haiku-5-5' : 'anthropic:claude-opus-5-5');

let f: Fixture | undefined;
const tmps: string[] = [];
afterAll(() => { if (f) rmSync(f.tmp, { recursive: true, force: true }); for (const t of tmps) rmSync(t, { recursive: true, force: true }); });
const write = (p: string, s: string) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const filesUnder = (dir: string): string[] => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));

function writeRepoPlaintext(dir: string) {
  const task = (id: string, kind: string, skill: string, instruction: string) => {
    write(join(dir, 'heldout', id, 'task.toml'), `# Synthetic repo task for the custody tests; not a counted task.\nid = "${id}"\nkind = "${kind}"\nskill = "${skill}"\nagent_timeout_s = 600\nverifier_timeout_s = 120\ncpus = 1\nmemory_mb = 2048\nstorage_mb = 4096\nworkdir = "/work/repo"\nrepo_dir = ""\n`);
    write(join(dir, 'heldout', id, 'instruction.md'), `${instruction}\n`);
    write(join(dir, 'heldout', id, 'environment', 'Dockerfile'), 'FROM scratch\nLABEL harness-eval.sealed=true\n');
    write(join(dir, 'heldout', id, 'verifier', 'verify.sh'), '#!/bin/sh\ngrep -q "accepted" /work/out.txt || grep -q "Holm-adjusted" /work/out.txt\necho 0 > /logs/verifier/reward.txt\n');
    chmodSync(join(dir, 'heldout', id, 'verifier', 'verify.sh'), 0o755);
    write(join(dir, 'heldout', id, 'oracle', 'solve.sh'), '#!/bin/sh\ntrue\n');
  };
  task(TASKS[0]!, 'fix', 'investigate', RSECRETS.instruction);
  task(TASKS[1]!, 'review', 'review', RSECRETS.review);
  write(join(dir, 'generator', 'generate.py'), `# synthetic generator\n${RSECRETS.seed}\nHARBOUR = "cobalt\\u002dharbor\\u002d9911"\nOCT = "basalt\\055harbor\\0554471"\nLONG = "granite-\\\nferry-2208"\nprint('generated')\n`);
  write(join(dir, 'audit.json'), JSON.stringify({ note: RSECRETS.audit }));
}

const repoManifest = (fx: Fixture) => heldoutSet(RSET, fx.repo).manifest;

function setRepoRow(fx: Fixture, row: Record<string, unknown>) {
  const m = JSON.parse(readFileSync(repoManifest(fx), 'utf8'));
  const i = m.openings.findIndex((o: { run_id: string }) => o.run_id === row.run_id);
  if (i >= 0) m.openings[i] = { ...m.openings[i], ...row }; else m.openings.push(row);
  writeFileSync(repoManifest(fx), JSON.stringify(m, null, 2) + '\n');
}

const CLAIMS: HeldoutClaim[] = [
  { id: 'H1', sentence: 'On Haiku the gstack arm passes more tasks than the none arm', source: 'comparisons.json', path: 'comparisons', where: { a: 'haiku-none', b: 'haiku-gstack' }, rule: 'superiority', direction: 'increase', requires_gate: { file: 'gates.json', key: 'haiku' } },
  { id: 'H2', sentence: 'On Haiku the gstack arm passes more tasks than the placebo arm', source: 'comparisons.json', path: 'comparisons', where: { a: 'haiku-gstack', b: 'haiku-placebo' }, rule: 'superiority', direction: 'decrease', requires_gate: { file: 'gates.json', key: 'haiku' } },
  { id: 'O1', sentence: 'On Opus the gstack arm passes more tasks than the none arm', source: 'comparisons.json', path: 'comparisons', where: { a: 'opus-none', b: 'opus-gstack' }, rule: 'superiority', direction: 'increase', family: 'secondary', requires_gate: { file: 'gates.json', key: 'opus' } },
  { id: 'O2', sentence: 'On Opus the placebo arm passes no fewer tasks than the none arm, within fifty points', source: 'comparisons.json', path: 'comparisons', where: { a: 'opus-none', b: 'opus-placebo' }, rule: 'noninferiority', direction: 'increase', margin: 0.5, family: 'secondary' },
];

function registerRepo(fx: Fixture, runId: string, dir: string, cand: string): string {
  const cell = (id: string) => ({ id, harness: 'laneb', model: modelOf(id), slice: 'repo', split: 'heldout', task_set: RSET, repetitions: 2, ceiling: { input_tokens: 0, output_tokens: 0 } });
  const prereg = { schema_version: 1, run_id: runId, question: 'Synthetic repo-kind custody fixture, never counted.', tasks: {}, cells: CELLS.map(cell), heldout: { set: RSET, label: 'confirmatory', candidate_sha256: cand, claims: CLAIMS } };
  write(join(fx.repo, 'docs', 'benchmarks', dir, 'PREREGISTRATION.md'), `# ${runId}\n\nSynthetic fixture.\n`);
  write(join(fx.repo, 'docs', 'benchmarks', dir, 'prereg.json'), JSON.stringify(prereg, null, 2) + '\n');
  const reg = join(fx.repo, 'docs', 'benchmarks', 'preregistrations.json');
  const r = JSON.parse(readFileSync(reg, 'utf8'));
  r.experiments.push({ id: runId, preregistration: `docs/benchmarks/${dir}/PREREGISTRATION.md`, results: [`docs/benchmarks/${dir}/sealed-results/**`] });
  writeFileSync(reg, JSON.stringify(r, null, 2) + '\n');
  setRepoRow(fx, { run_id: runId, status: 'planned', label: 'confirmatory', candidate_sha256: cand });
  commitPush(fx, `preregister ${runId}`);
  return `docs/benchmarks/${dir}/prereg.json`;
}

/** A fake Harbor-converted run: manifest.json bound to the opening, trials.jsonl (6 cells x 2 tasks x 2 repetitions) and
 *  gates.json, in which Opus fails its gate. */
function fakeResults(dir: string, runId: string, preregSha: string, receipt: Record<string, unknown>) {
  const passes: Record<string, number[]> = { 'haiku-none': [0, 0], 'haiku-gstack': [2, 2], 'haiku-placebo': [1, 0], 'opus-none': [1, 1], 'opus-gstack': [2, 1], 'opus-placebo': [1, 1] };
  const trials: Array<Record<string, unknown>> = [];
  for (const cell of CELLS) for (const [ti, task] of TASKS.entries()) for (const rep of [1, 2]) {
    const pass = rep <= passes[cell]![ti]!;
    trials.push({
      trial_id: `${runId}/${cell}/${task}/r${rep}`, cell, task, harness: 'laneb', harness_mode: 'docker', model: modelOf(cell), script: null,
      termination: 'completed', grade: pass ? 'pass' : 'fail', consent_violation: false, approval_stop: false, effects: [], predicates: [], cap_stop: false, turns: { planned: 1, run: 1, exits: [0] },
      usage: { meter_id: 'k', requests: 1, refused: 0, failed: 0, usd: 0.01, input_tokens: 10, output_tokens: 10, cached_tokens: 0, unpriced: 0, by_model: {}, upstream: null },
      wall_ms: 1000, started_at: '', ended_at: '', paths: {},
    });
  }
  mkdirSync(dir, { recursive: true });
  const cells = CELLS.map((id) => ({ id, harness: 'laneb', model: modelOf(id), slice: 'repo', split: 'heldout', task_set: RSET, repetitions: 2 }));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ schema_version: 1, run_id: runId, prereg_sha256: preregSha, created_at: '', cells, trials: trials.map((t) => ({ id: t.trial_id, cell: t.cell, task: t.task })), cost_ceiling_usd: 1, per_cell_ceiling_usd: {}, spend_cap_usd: 1, trial_hours_at_cap: 0, sealed: { set: RSET, receipt_sha256: sha256(JSON.stringify(receipt)), receipt } }, null, 1));
  // trials out of manifest order: compare-run pairs cells in the manifest's order, never the order trials were recorded
  writeFileSync(join(dir, 'trials.jsonl'), [...trials].reverse().map((t) => JSON.stringify(t)).join('\n') + '\n');
  writeFileSync(join(dir, 'gates.json'), JSON.stringify({ haiku: { body_load_rate: 0.95, pass: true }, opus: { body_load_rate: 0.2, pass: false } }));
}

/** A stand-in docker: image ls answers one labelled image, rm and builder prune succeed; every call is logged. */
function fakeDocker(dir: string): { bin: string; log: string } {
  const bin = join(dir, 'docker'), log = join(dir, 'docker.log');
  mkdirSync(dir, { recursive: true });
  writeFileSync(bin, `#!/usr/bin/env bash\necho "$*" >> ${log}\nif [ "$1 $2" = "image ls" ]; then echo "sha256:abc123 harness-eval/rsyn-${TASKS[0]}:latest"; fi\nexit 0\n`);
  chmodSync(bin, 0o755);
  return { bin, log };
}

test('a repo set: seal, open, resume, export with a failed gate and a secondary family, cleanup and release', async () => {
  f = await makeFixture(2);
  const fx = f;
  const plain = join(fx.tmp, 'rplain');
  writeRepoPlaintext(plain);
  const sealOpts = { repo: fx.repo, set: RSET, kind: 'repo' as const, tasks: join(plain, 'heldout'), generator: join(plain, 'generator'), extras: { 'audit.json': join(plain, 'audit.json') }, custody: fx.custody, recipient: fx.recipient, gh: fx.gh };
  const refused = (o: Parameters<typeof sealSet>[0]) => sealSet(o).then(() => 'no refusal', (e: Error) => e.message);

  // refusals before anything is pushed: a slice with --kind repo, a name the multiuser kind uses, a generator on a
  // multiuser set, an input inside the checkout, a symbolic link, and plaintext of the set in the checkout
  expect(await refused({ ...sealOpts, slice: join(fx.plain, 'slice.json') })).toMatch(/^HE-SEALED-006 --kind repo seals a repository task set, which has no world slice and no corpus pages/);
  expect(await refused({ ...sealOpts, set: MU_SET })).toBe('HE-SEALED-006 set name vsyn is already used by tasks/multiuser/ in the checkout; set names are unique across kinds');
  expect(await refused({ ...sealOpts, kind: 'multiuser', set: 'vother', slice: join(fx.plain, 'slice.json') })).toMatch(/^HE-SEALED-006 --generator goes with --kind repo/);
  const inside = join(fx.repo, 'scratch-tasks');
  mkdirSync(inside);
  expect(await refused({ ...sealOpts, tasks: inside })).toMatch(/is inside the public checkout/);
  rmSync(inside, { recursive: true });
  symlinkSync(join(plain, 'audit.json'), join(plain, 'heldout', TASKS[0]!, 'linked.json'));
  expect(await refused(sealOpts)).toMatch(/is a symbolic link; a bundle holds regular files only/);
  rmSync(join(plain, 'heldout', TASKS[0]!, 'linked.json'));
  write(join(fx.repo, 'tasks', 'repo', RSET, 'heldout', 'planted', 'task.toml'), 'id = "planted"\n');
  expect(await refused(sealOpts)).toMatch(/^HE-SEALED-006 plaintext of set rsyn is in the checkout: 1 file\(s\)/);
  rmSync(join(fx.repo, 'tasks', 'repo', RSET), { recursive: true });
  // a repo task with no known kind, or whose Dockerfile lacks the sealed label cleanup finds images by, is refused
  const toml = join(plain, 'heldout', TASKS[0]!, 'task.toml');
  const tomlText = readFileSync(toml, 'utf8');
  writeFileSync(toml, tomlText.replace('kind = "fix"', 'kind = "refactor"'));
  expect(await refused(sealOpts)).toMatch(/^HE-SEALED-006 1 repo task\(s\) have no kind of fix, review, qa, ship in task\.toml/);
  writeFileSync(toml, tomlText);
  const dockerfile = join(plain, 'heldout', TASKS[1]!, 'environment', 'Dockerfile');
  for (const text of ['FROM scratch\n', 'FROM scratch\nLABEL description="contains harness-eval.sealed=true marker"\n', 'FROM scratch AS build\nLABEL harness-eval.sealed=true\nFROM scratch\n',
    'FROM scratch\nLABEL harness-eval.sealed=true\nLABEL harness-eval.sealed=false\n', 'FROM scratch\nLABEL harness-eval.sealed="tr\\ue"\n', 'FROM scratch\nCOPY <<EOF /x\nLABEL harness-eval.sealed=true\n',
    'FROM scratch\nRUN true \\\n# a comment\nLABEL harness-eval.sealed=true\n', '# escape=`\nFROM scratch\nLABEL harness-eval.sealed=true\n',
    'FROM scratch\nCOPY <<"#X" /x\nLABEL harness-eval.sealed=true\n#X\n', 'FROM scratch\nCOPY <<#X /x\nLABEL harness-eval.sealed=true\n#X\n', 'FROM scratch\nCOPY <<A <<"#B" /d/\na\nA\nLABEL harness-eval.sealed=true\n#B\n',
    '# syntax=example.com/custom-frontend\nFROM scratch\nLABEL harness-eval.sealed=true\n', '# syntax=example.invalid/frontend:1 --x\nFROM scratch\nLABEL harness-eval.sealed=true\n',
    '// syntax=example.invalid/frontend:1\nFROM scratch\nLABEL harness-eval.sealed=true\n', 'FROM scratch\nLABEL x=<<EOF\nCOPY <<"#X" /x\nEOF\nLABEL harness-eval.sealed=true\n#X\n',
    'FROM scratch\nENV E=<<EOF\nCOPY <<"#X" /x\nEOF\nLABEL harness-eval.sealed=true\n#X\n', 'FROM scratch\nCOPY <<A \\\n<<"#B" /d/\na\nA\nLABEL harness-eval.sealed=true\n#B\n',
    'FROM scratch\nCOPY <<EOF /x\nhello\nEOF\nLABEL harness-eval.sealed=true\n', '# escape=`\r\r\nFROM scratch\nLABEL a `\nLABEL harness-eval.sealed=true\n',
    '# syntax=example.invalid/frontend:1\r\r\nFROM scratch\nLABEL harness-eval.sealed=true\n', 'FROM scratch\nLABEL harness-eval.sealed=true\uFEFF\n', 'FROM scratch\nCOPY \\\n\uFEFF#* <<"#X" \\\n/x/\nLABEL harness-eval.sealed=true\n#X\n']) {
    writeFileSync(dockerfile, text);
    expect(await refused(sealOpts)).toMatch(/^HE-SEALED-006 1 repo task\(s\) have no environment\/Dockerfile whose last instruction is LABEL harness-eval\.sealed=true/);
  }
  for (const text of ['# escape=\\\nFROM scratch\nLABEL harness-eval.sealed=true\n', '# syntax=docker/dockerfile:1\nFROM scratch\nLABEL harness-eval.sealed=true\n', 'ARG BASE=scratch\nFROM ${BASE}\n# a comment with << in it\nLABEL harness-eval.sealed=true\n']) expect(finalStageSealed(text)).toBe(true);
  writeFileSync(dockerfile, 'FROM scratch\nLABEL harness-eval.sealed=true\n');
  expect(readAccessLog(cloneCustody(fx, 'custody-before')).map((e) => e.event)).toEqual(['sealed']);

  const sealed = await sealSet(sealOpts);
  const m = sealed.manifest;
  expect(m.kind).toBe('repo');
  expect(relative(fx.repo, sealed.manifestPath)).toBe(`tasks/repo/${RSET}/heldout/MANIFEST.json`);
  expect([m.world_manifest_sha256, m.world_json_sha256, m.sealed!.world_slice_sha256, m.sealed!.heldout_corpus_sha256]).toEqual([null, null, null, null]);
  expect(m.sealed!.null_digests).toMatch(/no world slice and no corpus pages/);
  expect(m.sealed!.generator_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(m.sealed!.task_count).toBe(2);
  expect(Object.keys(m.sealed!.extras!)).toEqual(['extras/audit.json']);
  // the bundle holds the task tree, the generator, the extra and the salt, and nothing of a world
  const entries = unpackTar(await decryptWith(fx.identity, new Uint8Array(readFileSync(sealed.bundlePath)))).map((e) => e.path).sort();
  expect(entries.filter((p) => !p.startsWith(`tasks/repo/${RSET}/heldout/`))).toEqual(['extras/audit.json', 'generator/generate.py', 'opaque-salt']);
  const mm = JSON.parse(readFileSync(repoManifest(fx), 'utf8'));
  Object.assign(mm, { opening_budget: 1, alpha_per_opening: 0.025, status: 'open', openings: [], exposures: [] });
  writeFileSync(repoManifest(fx), JSON.stringify(mm, null, 2) + '\n');
  commitPush(fx, 'seal rsyn');
  // both kinds are discovered by name and pass the keyless check
  expect(heldoutSets(fx.repo).map((s) => [s.name, s.kind])).toEqual([['v0.1', 'multiuser'], [MU_SET, 'multiuser'], [RSET, 'repo']]);
  expect(heldoutSet(RSET, fx.repo).kind).toBe('repo');
  expect(manifestProblems(heldoutSet(RSET, fx.repo))).toEqual([]);
  expect(setNameProblems(fx.repo)).toEqual([]);
  expect(publicationFindings(fx.repo, 'origin/main')).toEqual([]);
  for (const p of filesUnder(fx.repo).filter((p) => !p.includes('/.git/'))) {
    const text = readFileSync(p, 'utf8');
    for (const s of [...Object.values(RSECRETS), ...TASKS]) expect(`${relative(fx.repo, p)}: ${text.includes(s)}`).toBe(`${relative(fx.repo, p)}: false`);
  }

  // a world change: the multiuser set reports it, the repo set does not, and the repo set still opens below
  const worldManifest = join(fx.repo, 'world', 'seed', 'MANIFEST.json');
  writeFileSync(worldManifest, readFileSync(worldManifest, 'utf8') + '\n');
  commitPush(fx, 'a world change');
  expect(manifestProblems(heldoutSet(MU_SET, fx.repo)).join('\n')).toContain('world/seed/MANIFEST.json changed since sealing');
  expect(manifestProblems(heldoutSet(RSET, fx.repo))).toEqual([]);

  // the same name under both kinds is refused
  mkdirSync(join(fx.repo, 'tasks', 'multiuser', RSET));
  expect(setNameProblems(fx.repo)).toEqual([`set name ${RSET} is used by tasks/multiuser/ and tasks/repo/; set names are unique across kinds, so rename one`]);
  rmSync(join(fx.repo, 'tasks', 'multiuser', RSET), { recursive: true });

  const runId = 'rsyn-e2e', dirName = '2026-11-12-rsyn-e2e', cand = candidate('rsyn');
  const preregPath = registerRepo(fx, runId, dirName, cand);
  // the openings ledger counts a repo set as it counts a multiuser set
  expect(deriveSet(fx.repo, RSET)!.openings.map((o) => [o.run_id, o.number, o.confirmatory_rank])).toEqual([[runId, 1, 1]]);
  // a claim naming its two cells against the run's cell order, a bad gate and an unknown family are refused before any
  // opening is spent
  expect(claimProblems([{ ...CLAIMS[0]!, requires_gate: { file: 'comparisons.json', key: 'haiku' } }], CELLS)).toEqual(['heldout.claims[0] (H1): requires_gate.file comparisons.json is a file export.ts rewrites (summary*.json, comparisons*.json); name a gate file of its own, such as gates.json']);
  expect(claimProblems([{ ...CLAIMS[0]!, where: { a: 'haiku-gstack', b: 'haiku-none' } }], CELLS)).toEqual([`heldout.claims[0] (H1): where names a = haiku-gstack and b = haiku-none, but compare-run.ts compares b minus a with a before b in the run's cell order (${CELLS.join(', ')}); name a = haiku-none and b = haiku-gstack and flip the direction`]);
  expect(claimProblems([{ ...CLAIMS[0]!, requires_gate: { file: '../gates.json', key: 'haiku' } }, { ...CLAIMS[1]!, family: 'tertiary' as never }])).toEqual([
    'heldout.claims[0] (H1): requires_gate must be {"file": "<name>.json", a file at the top of the raw results, "key": "<the gate entry, such as the model>"}',
    'heldout.claims[1] (H2): family must be primary or secondary (got "tertiary")',
  ]);
  expect(claimProblems(CLAIMS, CELLS)).toEqual([]);

  const lines: string[] = [];
  const root = join(fx.work, 'rroot');
  const opened = await openRun({ repo: fx.repo, prereg: preregPath, ...co(fx), out: root, log: (l) => lines.push(l) });
  expect(opened.resumed).toBe(false);
  expect(opened.receipt).toMatchObject({ kind: 'repo', set: RSET, world_slice_sha256: null, heldout_corpus_sha256: null, public_world_sha256: null, world_sha256: null, generator_sha256: m.sealed!.generator_sha256, task_count: 2, tree_sha256: m.tree_sha256 });
  expect(readdirSync(root).sort()).toEqual(['extras', 'generator', 'opaque-salt', 'opening-receipt.json', 'tasks']);
  expect(readdirSync(join(root, 'tasks', 'repo', RSET, 'heldout')).sort()).toEqual(TASKS);
  expect(verifySealedRoot(root, opened.receipt, fx.repo)).toEqual([]);
  // the executable bit survives sealing: open writes executables 0700 and other files 0600
  const openedTask = join(root, 'tasks', 'repo', RSET, 'heldout', TASKS[0]!);
  expect([statSync(join(openedTask, 'verifier', 'verify.sh')).mode & 0o777, statSync(join(openedTask, 'instruction.md')).mode & 0o777]).toEqual([0o700, 0o600]);
  // open prints the access-log line and the root's path and counts only, and hands off to no runner
  expect(lines.length).toBe(2);
  expect(lines[1]).toMatch(new RegExp(`^CUSTODY: root ${root} \\(repo set, 2 tasks, tree [0-9a-f]{12}, generator [0-9a-f]{12}, 1 extra file\\(s\\)\\); receipt ${root}/opening-receipt\\.json$`));
  expect(lines.join('\n')).not.toContain('runner/run.ts');
  for (const s of [...Object.values(RSECRETS), ...TASKS]) expect(lines.join('\n')).not.toContain(s);
  // an edited generator file fails the root
  const gen = join(root, 'generator', 'generate.py');
  const genBytes = readFileSync(gen);
  writeFileSync(gen, 'edited\n');
  expect(verifySealedRoot(root, opened.receipt, fx.repo)[0]).toMatch(/^the generator\/ digest is [0-9a-f]{12}, the opening receipt says [0-9a-f]{12}$/);
  writeFileSync(gen, genBytes);
  // a generator value alone (the seed inside its quotes, not the whole line) is redacted from output and found by the leak scan
  const seedValue = 'quartzite-otter-4471';
  expect(sealedRedactor(root, RSET).redact(`HE-SEALED-007 seed ${seedValue} reached a claim`)).not.toContain(seedValue);
  const emptyRaw = mkdtempSync(join(tmpdir(), 'rsyn-raw-'));
  tmps.push(emptyRaw);
  const secrets = collectSecrets({ root, set: RSET, raw: emptyRaw, publicTexts: [] });
  expect(leakScan({ 'README.md': `the seed was ${seedValue}\n` }, secrets).map((h) => h.kind)).toContain('generator string');
  // a value written with escapes is sealed in the form a program prints it
  for (const value of ['cobalt-harbor-9911', 'basalt-harbor-4471', 'granite-ferry-2208']) {
    expect(sealedRedactor(root, RSET).redact(`HE-SEALED-007 value ${value}`)).not.toContain(value);
    expect(leakScan({ 'README.md': `${value}\n` }, secrets).map((h) => h.kind)).toContain('generator string');
  }

  // resume: the same run reopens the same opening
  const resumed = await openRun({ repo: fx.repo, prereg: preregPath, ...co(fx), out: root, log: () => undefined });
  expect(resumed.resumed).toBe(true);
  expect(resumed.receipt.access.event_sha256).toBe(opened.receipt.access.event_sha256);
  expect(readAccessLog(cloneCustody(fx, 'custody-opened')).filter((e) => e.set === RSET).map((e) => e.event)).toEqual(['sealed', 'opened', 'resumed']);

  const receiptPath = join(root, 'opening-receipt.json');
  const results = join(fx.work, 'rresults', runId);
  fakeResults(results, runId, sha256(readFileSync(join(fx.repo, preregPath))), JSON.parse(readFileSync(receiptPath, 'utf8')));
  // a missing gate file refuses the export before anything is pushed
  const gates = readFileSync(join(results, 'gates.json'));
  rmSync(join(results, 'gates.json'));
  const exportClone = cloneCustody(fx, 'custody-rexport');
  expect(await exportRun({ repo: fx.repo, results, sealedRoot: root, receipt: receiptPath, custody: exportClone, gh: fx.gh, log: () => undefined }).then(() => 'no refusal', (e: Error) => e.message)).toBe('HE-SEALED-007 claim H1 requires the gate haiku in gates.json, and the raw results have no gates.json; nothing was pushed or published');
  writeFileSync(join(results, 'gates.json'), gates);
  expect([...failedGates(CLAIMS, results)]).toEqual(['O1']);

  const exportLines: string[] = [];
  const { out, export: exp } = await exportRun({ repo: fx.repo, results, sealedRoot: root, receipt: receiptPath, custody: exportClone, gh: fx.gh, log: (l) => exportLines.push(l) });
  expect(exp.mode).toBe('full');
  const decisions = exp.decisions as Array<{ claim: string; family: string; decision: string; p?: number | null; holm_p?: number | null; sentence: string }>;
  expect(decisions.map((d) => [d.claim, d.family, d.decision === 'dropped' ? 'dropped' : 'decided'])).toEqual([['H1', 'primary', 'decided'], ['H2', 'primary', 'decided'], ['O1', 'secondary', 'dropped'], ['O2', 'secondary', 'decided']]);
  expect(decisions[2]).toEqual({ claim: 'O1', decision: 'dropped', family: 'secondary', sentence: 'O1: dropped from the secondary Holm family, not measuring skill bodies (the gate opus in gates.json failed). On Opus the gstack arm passes more tasks than the none arm.' });
  expect(decisions[0]!.sentence).toContain("across the opening's 2 primary claim(s) against alpha 0.025.");
  // a secondary claim publishes its bit and wording only, in full mode too (its Holm is checked in the next test)
  expect(Object.keys(decisions[3]!).sort()).toEqual(['claim', 'decision', 'family', 'sentence']);
  expect(decisions[3]!.sentence).toMatch(/^O2: (accepted|rejected)\. On Opus the placebo arm passes no fewer tasks than the none arm, within fifty points\.$/);
  expect(exportLines[0]).toContain('1 dropped by a failed gate');
  // the claims read compare-run's pairs in the manifest's cell order: none before gstack before placebo
  const comparisons = JSON.parse(readFileSync(join(results, 'comparisons.json'), 'utf8')) as { comparisons: Array<{ a: string; b: string }> };
  expect(comparisons.comparisons.length).toBe(15);
  for (const c of comparisons.comparisons) expect(`${c.a} before ${c.b}: ${CELLS.indexOf(c.a) < CELLS.indexOf(c.b)}`).toBe(`${c.a} before ${c.b}: true`);
  // the summary counts repo tasks under their kind
  const summary = JSON.parse(readFileSync(join(results, 'summary.json'), 'utf8')) as { families?: Record<string, Record<string, unknown>> };
  expect(Object.keys(summary.families ?? {}).sort()).toEqual([...CELLS].sort());
  expect(Object.keys(summary.families!['haiku-none']!).sort()).toEqual(['fix', 'review']);
  // no public byte and no line printed holds a task id, a task string, the generator or the extra
  for (const p of filesUnder(out)) {
    const text = readFileSync(p, 'utf8');
    for (const s of [...Object.values(RSECRETS), ...TASKS, 'quartzite', 'Zephyrine']) expect(`${relative(fx.repo, p)} holds ${s}: ${text.includes(s)}`).toBe(`${relative(fx.repo, p)} holds ${s}: false`);
  }
  for (const s of [...Object.values(RSECRETS), ...TASKS]) expect(exportLines.join('\n')).not.toContain(s);
  const sealedResults = exp.sealed_results as { repository_path: string };
  const raw = unpackTar(gunzipSync(await decryptWith(fx.identity, new Uint8Array(readFileSync(join(cloneCustody(fx, 'custody-rraw'), sealedResults.repository_path))))));
  expect(raw.some((e) => e.path === 'gates.json')).toBe(true);
  commitPush(fx, 'sealed export of rsyn-e2e');
  expect(publicationFindings(fx.repo, 'origin/main')).toEqual([]);

  // cleanup: Harbor job directories under the root and the results go with them, the labelled images go without --images
  // (a repo set's task images carry the task bodies), and the inventory names them in a 0600 custody log only
  write(join(root, 'jobs', '2026-11-12__10-00-00', `${TASKS[0]}__a1`, 'result.json'), '{}');
  write(join(results, 'jobs', '2026-11-12__10-05-00', 'config.json'), '{}');
  const docker = fakeDocker(join(fx.tmp, 'docker-bin'));
  const cleanLines: string[] = [];
  const cleaned = cleanup({ repo: fx.repo, exportJson: join(out, 'export.json'), sealedRoot: root, results: [results], custody: exportClone, docker: docker.bin, logDir: join(fx.tmp, 'custody-logs'), log: (l) => cleanLines.push(l) });
  expect(cleaned).toMatchObject({ removed: [root, results], images: 1, harborJobs: 2, unresolvedVms: [], unresolvedCopies: [] });
  expect(existsSync(root) || existsSync(results)).toBe(false);
  expect(readFileSync(docker.log, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ').slice(0, 2).join(' '))).toEqual(['image ls', 'image rm', 'builder prune']);
  const inventory = readFileSync(cleaned.inventory!, 'utf8');
  expect(inventory).toContain('harbor job directories: 2');
  expect(inventory).toContain(join(root, 'jobs', '2026-11-12__10-00-00'));
  expect(inventory).toContain(`sealed images (label harness-eval.sealed=true): 1\nsha256:abc123 harness-eval/rsyn-${TASKS[0]}:latest`);
  expect(statSync(cleaned.inventory!).mode & 0o777).toBe(0o600);
  expect(cleanLines[1]).toBe(`CLEANUP: inventory: 2 Harbor job directories removed with the directories holding them, 1 sealed image(s) removed (a repo set's task images are always removed); the list is in ${cleaned.inventory} (custody only)`);
  for (const s of TASKS) expect(cleanLines.join('\n')).not.toContain(s);

  // release: the tree goes to tasks/repo/<set>/released/, the generator, the extra and the salt to sealed-bundle/, and the
  // held-out directory keeps MANIFEST.json alone
  // an identical file already in place without its executable bit gets the bit back
  const preVerify = join(fx.repo, 'tasks', 'repo', RSET, 'released', TASKS[0]!, 'verifier', 'verify.sh');
  write(preVerify, readFileSync(join(plain, 'heldout', TASKS[0]!, 'verifier', 'verify.sh'), 'utf8'));
  chmodSync(preVerify, 0o644);
  const rel = await releaseSet({ repo: fx.repo, set: RSET, ...co(fx), custody: cloneCustody(fx, 'custody-rrelease'), log: () => undefined });
  expect(rel).toEqual({ runs: [runId], tasks: 2 });
  const after = readManifest(heldoutSet(RSET, fx.repo))!;
  expect([after.custody, after.kind, after.status, after.tree_sha256]).toEqual([undefined, 'repo', 'retired', m.tree_sha256]);
  expect(readdirSync(join(fx.repo, 'tasks', 'repo', RSET)).sort()).toEqual(['heldout', 'released', 'sealed-bundle']);
  expect(readdirSync(join(fx.repo, 'tasks', 'repo', RSET, 'heldout'))).toEqual(['MANIFEST.json']);
  expect(readdirSync(join(fx.repo, 'tasks', 'repo', RSET, 'released')).sort()).toEqual(TASKS);
  expect(statSync(join(fx.repo, 'tasks', 'repo', RSET, 'released', TASKS[0]!, 'verifier', 'verify.sh')).mode & 0o111).not.toBe(0);
  expect(readFileSync(join(fx.repo, 'tasks', 'repo', RSET, 'sealed-bundle', 'generator', 'generate.py'), 'utf8')).toContain(RSECRETS.seed);
  expect(manifestProblems(heldoutSet(RSET, fx.repo))).toEqual([]);
  expect(publicationFindings(fx.repo)).toEqual([]);
  expect(readAccessLog(cloneCustody(fx, 'custody-rfinal')).filter((e) => e.set === RSET).map((e) => e.event)).toEqual(['sealed', 'opened', 'resumed', 'exported', 'released']);
}, 240_000);

test('Holm runs within each claim family, and a claim whose gate failed enters none', () => {
  const file = { comparisons: ['w', 'x', 'y', 'z'].map((b, i) => ({ a: 'base', b, delta: 0.3, ci95: [0.1, 0.5], p: [0.01, 0.02, 0.01, 0.04][i] })) };
  const claim = (id: string, b: string, extra: Partial<HeldoutClaim>): HeldoutClaim => ({ id, sentence: `claim ${id}`, source: 'comparisons.json', path: 'comparisons', where: { a: 'base', b }, rule: 'superiority', direction: 'increase', ...extra });
  const d = decide([claim('P1', 'w', {}), claim('P2', 'x', {}), claim('S1', 'y', { family: 'secondary' }), claim('S2', 'z', { family: 'secondary' })], () => file, 0.025);
  // primary: p 0.01 and 0.02 give Holm 0.02 and 0.02; secondary: p 0.01 and 0.04 give Holm 0.02 and 0.04
  expect(d.map((x) => [x.claim, x.family, x.decision])).toEqual([['P1', 'primary', 'accept'], ['P2', 'primary', 'accept'], ['S1', 'secondary', 'accept'], ['S2', 'secondary', 'reject']]);
  expect(d.map((x) => x.holm_p)).toEqual([0.02, 0.02, 0.02, 0.04].map((x) => expect.closeTo(x, 10)) as unknown as number[]);
  // dropping P2 leaves P1 alone in its family, unadjusted
  const g = decide([claim('P1', 'w', {}), claim('P2', 'x', { requires_gate: { file: 'gates.json', key: 'm' } })], () => file, 0.025, new Set(['P2']));
  expect(g.map((x) => [x.claim, x.holm_p, x.decision])).toEqual([['P1', 0.01, 'accept'], ['P2', null, 'dropped']]);
  // with one family and no gate the sentence keeps its wording
  expect(decide([claim('P1', 'w', {})], () => file, 0.025)[0]!.sentence).toContain("across the opening's 1 claim(s) against alpha 0.025.");
});

test('a repo task body planted under tasks/repo/<set>/heldout/ is refused by the publication check and by gstack-pregate sealed', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'he-repo-plant-'));
  tmps.push(tmp);
  const bare = join(tmp, 'origin.git'), repo = join(tmp, 'repo');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare], { env: SCRUBBED_ENV });
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'repo-plant@example.invalid');
  git(repo, 'config', 'user.name', 'repo plant test');
  git(repo, 'remote', 'add', 'origin', bare);
  write(join(repo, '.gstack', 'pregate.json'), readFileSync(join(ROOT, '.gstack', 'pregate.json'), 'utf8'));
  write(join(repo, 'README.md'), 'plant test\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'base'); git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'checkout', '-q', '-b', 'plant');
  // a sealed repo manifest is publishable; a task body beside it is not, sealed or not; released files of a sealed set are
  // not; the public dev split is
  write(join(repo, 'tasks', 'repo', 'gx', 'heldout', 'MANIFEST.json'), JSON.stringify({ schema_version: 1, kind: 'repo', custody: 'sealed', sealed: {} }));
  write(join(repo, 'tasks', 'repo', 'gx', 'heldout', 'gx-01-fix', 'task.toml'), 'id = "gx-01-fix"\nkind = "fix"\n');
  write(join(repo, 'tasks', 'repo', 'gx', 'released', 'gx-01-fix', 'task.toml'), 'id = "gx-01-fix"\n');
  write(join(repo, 'tasks', 'repo', 'gy', 'heldout', 'gy-01', 'instruction.md'), 'an unsealed set is refused too\n');
  write(join(repo, 'tasks', 'repo', 'gx', 'dev', 'gx-90', 'task.toml'), 'id = "gx-90"\n');
  // a Harbor job directory at the top of the checkout is refused, whatever the set
  write(join(repo, 'jobs', 'j1', 'gx-01-fix__abc', 'agent.log'), 'transcript\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'plant');
  const kinds = Object.fromEntries(publicationFindings(repo, 'HEAD').map((x) => [x.path, x.kind.split(' (')[0]]));
  expect(kinds).toEqual({
    'tasks/repo/gx/heldout/gx-01-fix/task.toml': 'a held-out task body of repo set gx',
    'tasks/repo/gx/released/gx-01-fix/task.toml': 'released content of set gx, which is still in sealed custody',
    'tasks/repo/gy/heldout/gy-01/instruction.md': 'a held-out task body of repo set gy',
    'jobs/j1/gx-01-fix__abc/agent.log': 'a Harbor job directory',
  });
  const cli = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-sealed-publication.ts'), '--repo', repo, '--ref', 'HEAD'], { encoding: 'utf8', env: SCRUBBED_ENV });
  expect(cli.status).toBe(1);
  expect(cli.stdout + cli.stderr).not.toContain('kind = "fix"');

  // gstack-pregate's own guard reads .gstack/pregate.json: tasks/repo/*/heldout/** is sealed and MANIFEST.json is exempt
  const sealed = JSON.parse(readFileSync(join(ROOT, '.gstack', 'pregate.json'), 'utf8')).sealed as { paths: string[]; allow_paths: string[] };
  expect(sealed.paths).toContain('tasks/repo/*/heldout/**');
  expect(sealed.allow_paths).toEqual(['tasks/repo/*/heldout/MANIFEST.json', 'tasks/multiuser/*/heldout/MANIFEST.json']);
  // a gstack older than 1.91.311.0 refuses sealed.allow_paths as an unknown key, so the ship policy requires that release
  const minGstack = (JSON.parse(readFileSync(join(import.meta.dir, '..', '.gstack', 'ship-policy.json'), 'utf8')) as { min_gstack_version: string }).min_gstack_version.split('.').map(Number);
  const allowPathsRelease = [1, 91, 311, 0];
  const firstDiff = allowPathsRelease.findIndex((n, i) => (minGstack[i] ?? 0) !== n);
  expect(firstDiff === -1 || (minGstack[firstDiff] ?? 0) > allowPathsRelease[firstDiff]).toBe(true);
  const pregate = [process.env.GSTACK_PREGATE, join(process.env.HOME ?? '', '.local', 'share', 'gstack', 'bin', 'gstack-pregate')].find((p) => p && existsSync(p));
  if (!pregate) { console.log('gstack-pregate is not installed here; its config is checked above and the run is skipped'); return; }
  const run = spawnSync(pregate, ['sealed', '--remote', 'origin', '--base', 'main'], { cwd: repo, encoding: 'utf8', env: { ...SCRUBBED_ENV, GSTACK_EPHEMERAL: '1' } });
  const outText = run.stdout + run.stderr;
  expect(run.status, outText).toBe(1);
  expect(outText).toContain('SEALED_OUTPUT_REFUSED');
  expect(outText).toContain('sealed.path  tasks/repo/gx/heldout/gx-01-fix/task.toml');
  expect(outText).toContain('sealed.path  tasks/repo/gy/heldout/gy-01/instruction.md');
  expect(outText).toContain('exempt sealed.path  tasks/repo/gx/heldout/MANIFEST.json');
  expect(outText).toContain('sealed.path  jobs/j1/gx-01-fix__abc/agent.log');
  expect(outText).not.toContain('tasks/repo/gx/dev/');
}, 120_000);
