// internal-task: the held-out opening counter (runner/heldout/openings.ts). On the repository itself: the backfilled
// ledgers derive the expected order and counts, the CI check is clean, every legacy preregistration matches its
// digest, and run.ts dry-run accepts a legacy run and refuses a copy of it that is not legacy. On synthetic
// repositories: each HE-HELDOUT refusal, idempotent planning of a run's own row, the legacy list, a withdrawn row,
// and two pull requests that each pass alone but together leave main over budget.
import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkOpenings, checkPlan, deriveSet, legacyList, type HeldoutBlock, type LegacyEntry } from '../runner/heldout/openings.ts';
import { buildManifest as buildReceipts } from '../scripts/receipts-manifest.ts';
import { liveSharers, liveSharersAmong, type HeldoutManifest, type OpeningRow } from '../scripts/seal-heldout.ts';

const ROOT = join(import.meta.dir, '..');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const CANDIDATE_A = sha('candidate a');
const CANDIDATE_B = sha('candidate b');

describe('the repository', () => {
  test('v0.1 derives ten opened rows in preregistration order, one confirmatory', () => {
    const d = deriveSet(ROOT, 'v0.1')!;
    expect(d.openings.map((o) => o.run_id)).toEqual([
      'm3-heldout-2026-10', 'm3-sensitivity-haiku-2026-10', 'gbrain-arm-2026-10', 'company-brain-2026-10', 'qm-inner-harness-2026-10',
      'gbrain-ladder-2026-10', 'gbrain-verbs-2026-10', 'gbrain-installer-2026-10', 'gbrain-scoped-2026-10', 'gbrain-installer-hook-2026-10',
    ]);
    expect(d.openings.map((o) => o.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(d.openings.every((o) => o.status === 'opened')).toBe(true);
    expect(d.openings.filter((o) => o.label === 'confirmatory').map((o) => o.run_id)).toEqual(['m3-heldout-2026-10']);
    expect(d.openings.find((o) => o.run_id === 'gbrain-installer-hook-2026-10')!.reason).toBe('revise-then-retest');
    expect(d.openings.find((o) => o.run_id === 'gbrain-scoped-2026-10')!.reason).toBe('revise-then-retest');
    expect(d.openings.find((o) => o.run_id === 'gbrain-verbs-2026-10')!.reason).toBe('re-run after a look');
    expect(d.ledger).toMatchObject({ opening_budget: 1, status: 'spent' });
    expect(d.confirmatory_used).toBe(1);
  });

  test('v0.2 derives three opened rows and one withdrawn row that is not counted', () => {
    const d = deriveSet(ROOT, 'v0.2')!;
    expect(d.openings.map((o) => [o.run_id, o.status, o.label, o.number])).toEqual([
      ['v02-heldout-2026-10', 'opened', 'confirmatory', 1],
      ['gbrain-memory-2026-10', 'opened', 'dev', 2],
      ['gbrain-memory-fix-2026-10', 'withdrawn', 'dev', null],
      ['gbrain-memory-fix-2026-10b', 'opened', 'dev', 3],
    ]);
    expect(d.openings[3]!.reason).toBe('in-sample for gbrain#7744');
    expect(d.ledger).toMatchObject({ opening_budget: 1, status: 'spent' });
  });

  test('the receipts manifest records each held-out run with its derived number, label and concurrent runs', () => {
    const runs = (JSON.parse(readFileSync(join(ROOT, 'docs/receipts-manifest.json'), 'utf8')) as { runs: Array<{ run_id: string; heldout: unknown }> }).runs;
    const of = (id: string) => runs.find((r) => r.run_id === id)!.heldout;
    expect(of('m3-heldout-2026-10')).toEqual({ set: 'v0.1', opening: 1, label: 'confirmatory', status: 'opened', reason: 'first opening; custody by digest only', concurrent_with: [] });
    expect(of('gbrain-scoped-2026-10')).toMatchObject({ set: 'v0.1', opening: 9, label: 'dev', reason: 'revise-then-retest' });
    expect(of('gbrain-verbs-2026-10')).toMatchObject({ opening: 7, concurrent_with: ['qm-inner-harness-2026-10'] });
    expect(of('gbrain-memory-2026-10')).toMatchObject({ set: 'v0.2', opening: 2, label: 'dev' });
    expect(of('m2-pilot-2026-10')).toBeNull();
  });

  test('the CI check finds no problem', () => {
    expect(checkOpenings(ROOT)).toEqual([]);
  });

  test('retired v0.3 stays protected by its live reseal v0.3-gen6, which stays free', () => {
    expect(liveSharers('v0.3', ROOT)).toEqual(['v0.3-gen6']);
    expect(liveSharers('v0.3-gen6', ROOT)).toEqual([]);
  });

  test('every legacy preregistration matches its current prereg.json and plans as its backfilled row', () => {
    const legacy = legacyList();
    expect(legacy).toEqual(JSON.parse(readFileSync(join(ROOT, 'runner/heldout/legacy-preregistrations.json'), 'utf8')).preregistrations);
    expect(legacy).toHaveLength(14);
    expect(new Set(legacy.map((l) => l.run_id)).size).toBe(legacy.length);
    for (const l of legacy) {
      const raw = readFileSync(join(ROOT, l.prereg_json), 'utf8');
      expect(l.sha256).toContain(sha(raw));
      if (l.run_id === 'gbrain-memory-fix-2026-10') {
        expect(() => checkPlan(JSON.parse(raw), sha(raw), ROOT)).toThrow(/^HE-HELDOUT-002 run gbrain-memory-fix-2026-10: its row in the openings ledger of set v0\.2 is withdrawn/);
        continue;
      }
      const lines = checkPlan(JSON.parse(raw), sha(raw), ROOT);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(`run ${l.run_id} set ${l.set}`);
      expect(lines[0]).toContain('registered before internal-task');
    }
  });

  test('run.ts dry-run accepts a legacy held-out run and refuses a copy of it that is not legacy', () => {
    const prereg = 'docs/benchmarks/2026-10-28-gbrain-memory-fix-b/prereg.json';
    const ok = spawnSync('bun', ['runner/run.ts', 'dry-run', '--prereg', prereg], { cwd: ROOT, encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('HELDOUT: run gbrain-memory-fix-2026-10b set v0.2 opening 3 dev (in-sample for gbrain#7744), status opened');
    const copy = join(mkdtempSync(join(tmpdir(), 'heldout-cli-')), 'prereg.json');
    writeFileSync(copy, readFileSync(join(ROOT, prereg), 'utf8').replace('"gbrain-memory-fix-2026-10b"', '"gbrain-memory-fix-2026-10c"'));
    const refused = spawnSync('bun', ['runner/run.ts', 'dry-run', '--prereg', copy], { cwd: ROOT, encoding: 'utf8' });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('HE-HELDOUT-001 run gbrain-memory-fix-2026-10c has held-out cells of set v0.2 and no heldout block');
  });
});

// A synthetic repository: a registry, one held-out set (v0.1) with an openings ledger, and experiments added one commit each.
function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const MANIFEST = 'tasks/multiuser/heldout/MANIFEST.json';

function write(dir: string, file: string, body: string): void {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), body);
}

function readLedger(dir: string): Record<string, unknown> & { openings: OpeningRow[] } {
  return JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8'));
}

function setLedger(dir: string, patch: Record<string, unknown>): void {
  write(dir, MANIFEST, JSON.stringify({ ...readLedger(dir), ...patch }, null, 2) + '\n');
}

function repo(ledger: { opening_budget?: number; status?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'openings-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  write(dir, 'docs/benchmarks/preregistrations.json', JSON.stringify({ schema_version: 1, experiments: [] }));
  write(dir, MANIFEST, JSON.stringify({ schema_version: 1, generated_at: '2026-01-01T00:00:00Z', world_manifest_sha256: '', world_json_sha256: '', tasks: [], files: {}, tree_sha256: '',
    opening_budget: ledger.opening_budget ?? 1, alpha_per_opening: 0.05, status: ledger.status ?? 'open', openings: [], exposures: [] }, null, 2) + '\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

interface Prereg { run_id: string; cells: Array<{ split: string; task_set?: string }>; heldout?: HeldoutBlock }

/** Write an experiment's preregistration, registry entry and (unless row is null) ledger row, and commit them together. */
function addExperiment(dir: string, id: string, block: HeldoutBlock | undefined, row: Partial<OpeningRow> | null = {}): { prereg: Prereg; digest: string } {
  const prereg: Prereg = { run_id: id, cells: [{ split: 'heldout' }], ...(block ? { heldout: block } : {}) };
  const raw = JSON.stringify(prereg, null, 2) + '\n';
  write(dir, `docs/benchmarks/${id}/PREREGISTRATION.md`, `# ${id}\n`);
  write(dir, `docs/benchmarks/${id}/prereg.json`, raw);
  write(dir, `docs/benchmarks/preregistrations.d/${id}.json`, JSON.stringify({ schema_version: 1, experiments: [{ id, preregistration: `docs/benchmarks/${id}/PREREGISTRATION.md`, results: [] }] }));
  if (row) setLedger(dir, { openings: [...readLedger(dir).openings, { run_id: id, status: 'planned', label: block?.label ?? 'dev', ...(block?.reason ? { reason: block.reason } : {}), candidate_sha256: block?.candidate_sha256 ?? null, ...row }] });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `preregister ${id}`);
  return { prereg, digest: sha(raw) };
}

const confirmatory = (candidate = CANDIDATE_A): HeldoutBlock => ({ set: 'v0.1', label: 'confirmatory', candidate_sha256: candidate });
const dev = (reason = 'later opening', candidate = CANDIDATE_B): HeldoutBlock => ({ set: 'v0.1', label: 'dev', reason, candidate_sha256: candidate });

describe('checkPlan refusals', () => {
  test('HE-HELDOUT-001: a held-out cell with no heldout block, or a block naming another set', () => {
    const dir = repo();
    const { prereg, digest } = addExperiment(dir, 'x-2026', undefined, null);
    expect(() => checkPlan(prereg, digest, dir, [])).toThrow(/^HE-HELDOUT-001 run x-2026 has held-out cells of set v0\.1 and no heldout block; fix: add "heldout"/);
    const other = { ...prereg, heldout: { ...confirmatory(), set: 'v0.2' } };
    expect(() => checkPlan(other, digest, dir, [])).toThrow(/^HE-HELDOUT-001 .*heldout\.set is "v0\.2" but its held-out cells run v0\.1/);
    expect(() => checkPlan({ ...prereg, heldout: { ...confirmatory(), candidate_sha256: 'abc' } }, digest, dir, [])).toThrow(/^HE-HELDOUT-001 .*candidate_sha256/);
  });

  test('HE-HELDOUT-002: no ledger row, a withdrawn row, or a row that differs from the block', () => {
    const dir = repo();
    const none = addExperiment(dir, 'x-2026', dev(), null);
    expect(() => checkPlan(none.prereg, none.digest, dir, [])).toThrow(/^HE-HELDOUT-002 run x-2026 has 0 rows in the openings ledger of set v0\.1/);
    const withdrawn = addExperiment(dir, 'y-2026', dev(), { status: 'withdrawn' });
    expect(() => checkPlan(withdrawn.prereg, withdrawn.digest, dir, [])).toThrow(/^HE-HELDOUT-002 .*is withdrawn/);
    const differs = addExperiment(dir, 'z-2026', dev(), { reason: 'something else' });
    expect(() => checkPlan(differs.prereg, differs.digest, dir, [])).toThrow(/^HE-HELDOUT-002 run z-2026: heldout\.reason is "later opening" but its row/);
  });

  test('HE-HELDOUT-003: a planned opening, dev or confirmatory, of a set whose world slice or corpus a live sealed set shares', () => {
    const dir = repo({ status: 'retired' });
    const slice = 'a'.repeat(64);
    setLedger(dir, { released: { world_slice_sha256: slice, heldout_corpus_sha256: 'b'.repeat(64) } });
    const successor = (status: string) => write(dir, 'tasks/multiuser/v9/heldout/MANIFEST.json', JSON.stringify({ schema_version: 1, custody: 'sealed', sealed: { world_slice_sha256: slice, heldout_corpus_sha256: 'c'.repeat(64) }, status }));
    successor('open');
    const d = addExperiment(dir, 'd-2026', dev());
    expect(() => checkPlan(d.prereg, d.digest, dir, [])).toThrow(/^HE-HELDOUT-003 run d-2026 plans an opening of set v0\.1, which shares its world slice or corpus with v9, still in sealed custody and not retired; .* fix: run it on v9$/);
    expect(checkOpenings(dir, []).filter((p) => p.includes('world slice or corpus'))).toEqual(['set v0.1: d-2026 is a planned opening of a set whose world slice or corpus v9 shares while still in sealed custody and not retired; opening it would expose that set, so run it on v9 (HE-HELDOUT-003)']);
    const c = addExperiment(dir, 'c-2026', confirmatory());
    expect(() => checkPlan(c.prereg, c.digest, dir, [])).toThrow(/^HE-HELDOUT-003 run c-2026 plans an opening of set v0\.1, which shares its world slice or corpus with v9/);
    expect(checkOpenings(dir, []).filter((p) => p.includes('world slice or corpus')).map((p) => p.split(' is ')[0])).toEqual(['set v0.1: d-2026', 'set v0.1: c-2026']);
    successor('retired');
    expect(checkPlan(d.prereg, d.digest, dir, [])[0]).toMatch(/^HELDOUT: run d-2026 set v0\.1/);
    expect(checkOpenings(dir, []).filter((p) => p.includes('world slice or corpus'))).toEqual([]);
    setLedger(dir, { status: 'open' });
    expect(checkPlan(c.prereg, c.digest, dir, [])[0]).toMatch(/^HELDOUT: run c-2026 set v0\.1/);
  });

  test('liveSharersAmong: only a matching slice or corpus digest of a live sealed set counts, never null or the digest of nothing', () => {
    const empty = createHash('sha256').digest('hex');
    const sealed = (slice: string | null, corpus: string | null, status = 'open', custody: string | undefined = 'sealed') => ({ schema_version: 1, custody, sealed: { world_slice_sha256: slice, heldout_corpus_sha256: corpus }, status }) as unknown as HeldoutManifest;
    const sets = new Map<string, HeldoutManifest>([
      ['a', sealed('a'.repeat(64), empty)], ['b', sealed('b'.repeat(64), empty)],
      ['r1', sealed(null, null)], ['r2', sealed(null, null)],
      ['old', sealed('c'.repeat(64), 'd'.repeat(64), 'retired')], ['new', sealed('e'.repeat(64), 'd'.repeat(64))],
      ['plain', { schema_version: 1, status: 'open' } as unknown as HeldoutManifest],
    ]);
    expect(Object.fromEntries([...sets.keys()].map((n) => [n, liveSharersAmong(n, sets)]))).toEqual({ a: [], b: [], r1: [], r2: [], old: ['new'], new: [], plain: [] });
  });

  test('HE-HELDOUT-003: a second confirmatory opening past a budget of one, and a planned confirmatory opening of a spent set', () => {
    const dir = repo();
    addExperiment(dir, 'a-2026', confirmatory(CANDIDATE_A));
    const b = addExperiment(dir, 'b-2026', confirmatory(CANDIDATE_B));
    expect(() => checkPlan(b.prereg, b.digest, dir, [])).toThrow(/^HE-HELDOUT-003 run b-2026 is confirmatory opening 2 of set v0\.1, whose budget is 1/);
    const spent = repo({ status: 'spent' });
    const c = addExperiment(spent, 'c-2026', confirmatory());
    expect(() => checkPlan(c.prereg, c.digest, spent, [])).toThrow(/^HE-HELDOUT-003 run c-2026 is a planned confirmatory opening of set v0\.1, whose status is spent/);
  });

  test('HE-HELDOUT-004: a dev opening with no reason', () => {
    const dir = repo();
    const { prereg, digest } = addExperiment(dir, 'x-2026', { set: 'v0.1', label: 'dev', candidate_sha256: CANDIDATE_A } as HeldoutBlock, null);
    expect(() => checkPlan(prereg, digest, dir, [])).toThrow(/^HE-HELDOUT-004 run x-2026 is a dev opening of set v0\.1 with no reason/);
  });

  test("a run's own row passes every time it is planned: shards, resume, and after the opening spends the set", () => {
    const dir = repo();
    const a = addExperiment(dir, 'a-2026', confirmatory());
    const first = checkPlan(a.prereg, a.digest, dir, []);
    expect(first).toEqual(['HELDOUT: run a-2026 set v0.1 opening 1 confirmatory, status planned; budget 1 confirmatory, set status open']);
    expect(checkPlan(a.prereg, a.digest, dir, [])).toEqual(first);
    setLedger(dir, { status: 'spent', openings: readLedger(dir).openings.map((o) => ({ ...o, status: 'opened' })) });
    expect(checkPlan(a.prereg, a.digest, dir, [])[0]).toContain('opening 1 confirmatory, status opened');
    const later = addExperiment(dir, 'b-2026', dev('revise-then-retest'));
    expect(checkPlan(later.prereg, later.digest, dir, [])[0]).toContain('run b-2026 set v0.1 opening 2 dev (revise-then-retest)');
    expect(checkOpenings(dir, [])).toEqual([]);
  });

  test('the legacy list accepts a listed digest whatever the budget, and nothing once the bytes change', () => {
    const dir = repo({ status: 'spent' });
    addExperiment(dir, 'first-2026', confirmatory(CANDIDATE_B), { status: 'opened' });
    const old = addExperiment(dir, 'old-2026', undefined, { status: 'opened', label: 'confirmatory', candidate_sha256: null });
    const legacy: LegacyEntry[] = [{ run_id: 'old-2026', set: 'v0.1', prereg_json: 'docs/benchmarks/old-2026/prereg.json', sha256: [old.digest] }];
    expect(checkPlan(old.prereg, old.digest, dir, legacy)[0]).toContain('run old-2026 set v0.1 opening 2 confirmatory, status opened; registered before internal-task');
    expect(() => checkPlan(old.prereg, sha('edited'), dir, legacy)).toThrow(/^HE-HELDOUT-001/);
    expect(checkOpenings(dir, legacy)).toEqual(['set v0.1: old-2026 is confirmatory opening 2 against a budget of 1 (preregistration first added at ' + git(dir, 'log', '-1', '--format=%H').trim().slice(0, 12) + '); label it dev with a reason, or withdraw it']);
    write(dir, 'docs/benchmarks/old-2026/prereg.json', JSON.stringify({ ...old.prereg, question: 'edited' }));
    expect(checkOpenings(dir, legacy).some((p) => p.includes('old-2026: docs/benchmarks/old-2026/prereg.json runs held-out cells of v0.1 and has no heldout block (it is on the legacy list, but its prereg.json changed since)'))).toBe(true);
  });

  test('a withdrawn row is listed, not counted, and takes no number', () => {
    const dir = repo();
    addExperiment(dir, 'a-2026', confirmatory(), { status: 'withdrawn', reason: 'withdrawn before any trial' });
    const b = addExperiment(dir, 'b-2026', confirmatory(CANDIDATE_B));
    expect(deriveSet(dir, 'v0.1', undefined)!.openings.map((o) => [o.run_id, o.number, o.confirmatory_rank])).toEqual([['a-2026', null, null], ['b-2026', 1, 1]]);
    expect(checkPlan(b.prereg, b.digest, dir, [])[0]).toContain('opening 1 confirmatory');
    expect(checkOpenings(dir, [])).toEqual([]);
  });
});

describe('checkOpenings (CI)', () => {
  /** GitHub's squash merge: the branch's whole diff as one single-parent commit on main. */
  function squash(dir: string, branch: string): void {
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'merge', '-q', '--squash', branch);
    git(dir, 'commit', '-q', '-m', `${branch} (squash)`);
    expect(git(dir, 'rev-list', '--merges', 'main').trim()).toBe('');
  }

  /** Two pull requests from one base, each adding a confirmatory opening; both pass alone, and pr-a is squash-merged first. */
  function racing(): { dir: string; rowA: OpeningRow; rowB: OpeningRow } {
    const dir = repo();
    git(dir, 'checkout', '-q', '-b', 'pr-a');
    addExperiment(dir, 'a-2026', confirmatory(CANDIDATE_A));
    expect(checkOpenings(dir, [])).toEqual([]);
    const rowA = readLedger(dir).openings[0]!;
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'checkout', '-q', '-b', 'pr-b');
    addExperiment(dir, 'b-2026', confirmatory(CANDIDATE_B));
    expect(checkOpenings(dir, [])).toEqual([]);
    const rowB = readLedger(dir).openings[0]!;
    squash(dir, 'pr-a');
    expect(checkOpenings(dir, [])).toEqual([]);
    return { dir, rowA, rowB };
  }

  /** pr-b now conflicts with main on the ledger rows: its author merges main into pr-b keeping the given rows (and the given preregistration), CI runs on that head, and pr-b is squash-merged. */
  function mergeB(dir: string, rows: OpeningRow[], preregB?: Prereg): string[] {
    git(dir, 'checkout', '-q', 'pr-b');
    const merged = spawnSync('git', ['merge', '-q', '--no-edit', 'main'], { cwd: dir, encoding: 'utf8' });
    expect(merged.status).not.toBe(0);
    write(dir, MANIFEST, JSON.stringify({ ...JSON.parse(git(dir, 'show', `main:${MANIFEST}`)), openings: rows }, null, 2) + '\n');
    if (preregB) write(dir, 'docs/benchmarks/b-2026/prereg.json', JSON.stringify(preregB, null, 2) + '\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '--no-edit');
    const atHead = checkOpenings(dir, []);
    squash(dir, 'pr-b');
    return atHead;
  }

  test('two racing pull requests that each passed alone leave main over budget, and main says which one', () => {
    const { dir, rowA, rowB } = racing();
    const atHead = mergeB(dir, [rowA, rowB]);
    const problems = checkOpenings(dir, []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^set v0\.1: b-2026 is confirmatory opening 2 against a budget of 1 \(preregistration first added at [0-9a-f]{12}\)/);
    expect(problems[0]).toContain(git(dir, 'rev-parse', 'HEAD').trim().slice(0, 12));
    expect(atHead).toHaveLength(1);
    expect(atHead[0]).toMatch(/^set v0\.1: b-2026 is confirmatory opening 2 against a budget of 1/);
  });

  test('a pull request that merged main and relabelled its opening dev passes on its own head and on main', () => {
    const { dir, rowA, rowB } = racing();
    const atHead = mergeB(dir, [rowA, { ...rowB, label: 'dev', reason: 'later opening' }], { run_id: 'b-2026', cells: [{ split: 'heldout' }], heldout: dev('later opening', CANDIDATE_B) });
    expect(atHead).toEqual([]);
    expect(checkOpenings(dir, [])).toEqual([]);
    expect(deriveSet(dir, 'v0.1')!.openings.map((o) => [o.run_id, o.number, o.confirmatory_rank])).toEqual([['a-2026', 1, 1], ['b-2026', 2, null]]);
  });

  test('a resolution that puts the later preregistration first is an order problem as well', () => {
    const { dir, rowA, rowB } = racing();
    mergeB(dir, [rowB, rowA]);
    const problems = checkOpenings(dir, []);
    expect(problems).toContain('set v0.1: ledger rows are in the order b-2026, a-2026; preregistration order on first-parent history is a-2026, b-2026; reorder the rows');
    expect(problems.some((p) => p.startsWith('set v0.1: b-2026 is confirmatory opening 2'))).toBe(true);
  });

  test('relabelling the later opening dev with a reason clears main', () => {
    const { dir, rowA, rowB } = racing();
    mergeB(dir, [rowA, { ...rowB, label: 'dev', reason: 'later opening' }]);
    expect(checkOpenings(dir, [])).toEqual(['set v0.1: b-2026: heldout.label in docs/benchmarks/b-2026/prereg.json is "confirmatory", its ledger row says "dev"', 'set v0.1: b-2026: heldout.reason in docs/benchmarks/b-2026/prereg.json is null, its ledger row says "later opening"']);
    write(dir, 'docs/benchmarks/b-2026/prereg.json', JSON.stringify({ run_id: 'b-2026', cells: [{ split: 'heldout' }], heldout: dev('later opening', CANDIDATE_B) }));
    expect(checkOpenings(dir, [])).toEqual([]);
  });

  test('a registered held-out experiment with no row, a row with no experiment, and one candidate opened twice', () => {
    const dir = repo({ opening_budget: 2 });
    addExperiment(dir, 'a-2026', confirmatory(CANDIDATE_A));
    addExperiment(dir, 'b-2026', confirmatory(CANDIDATE_A));
    addExperiment(dir, 'c-2026', dev(), null);
    setLedger(dir, { openings: [...readLedger(dir).openings, { run_id: 'ghost-2026', status: 'planned', label: 'dev', reason: 'x', candidate_sha256: null }] });
    const problems = checkOpenings(dir, []);
    expect(problems).toContain('set v0.1: c-2026 runs held-out cells and has 0 ledger rows; it needs exactly one');
    expect(problems).toContain('set v0.1: ledger row ghost-2026 names no registered experiment with held-out cells of this set');
    expect(problems.some((p) => p.startsWith(`set v0.1: b-2026 is a confirmatory opening of candidate ${CANDIDATE_A.slice(0, 12)}, which a-2026 (set v0.1) already opened confirmatory`))).toBe(true);
  });
});

describe('plan and CI agree', () => {
  test('a superseded row is listed, not counted, refused at plan, and clean in CI', () => {
    const dir = repo();
    const a = addExperiment(dir, 'a-2026', confirmatory(), { status: 'superseded', reason: 'replaced by b-2026' });
    addExperiment(dir, 'b-2026', confirmatory(CANDIDATE_B));
    expect(() => checkPlan(a.prereg, a.digest, dir, [])).toThrow(/^HE-HELDOUT-002 .*is superseded/);
    expect(deriveSet(dir, 'v0.1')!.openings.map((o) => [o.run_id, o.number, o.confirmatory_rank])).toEqual([['a-2026', null, null], ['b-2026', 1, 1]]);
    expect(checkOpenings(dir, [])).toEqual([]);
  });

  test('a set that is not open takes no planned confirmatory opening, at plan or in CI; dev openings pass on any set', () => {
    const retired = repo({ status: 'retired' });
    const c = addExperiment(retired, 'c-2026', confirmatory());
    expect(() => checkPlan(c.prereg, c.digest, retired, [])).toThrow(/^HE-HELDOUT-003 run c-2026 is a planned confirmatory opening of set v0\.1, whose status is retired/);
    expect(checkOpenings(retired, [])).toEqual(["set v0.1: c-2026 is a planned confirmatory opening of a set whose status is retired; mark a set's rows opened before the set is spent or retired, or label the run dev with a reason (HE-HELDOUT-003)"]);
    for (const status of ['open', 'spent', 'retired']) {
      const dir = repo({ status });
      const x = addExperiment(dir, 'x-2026', dev());
      expect(checkPlan(x.prereg, x.digest, dir, [])[0]).toContain(`set status ${status}`);
      expect(checkOpenings(dir, [])).toEqual([]);
    }
  });

  test('CI lists the malformed block plan refuses', () => {
    const dir = repo();
    const x = addExperiment(dir, 'x-2026', { set: 'v0.1', label: 'dev', reason: 'later opening' } as HeldoutBlock);
    expect(() => checkPlan(x.prereg, x.digest, dir, [])).toThrow(/^HE-HELDOUT-001 run x-2026: heldout\.candidate_sha256 must be the 64-hex sha256/);
    expect(checkOpenings(dir, [])).toEqual(['x-2026: run x-2026: heldout.candidate_sha256 must be the 64-hex sha256 of the candidate (docs/methodology.md item 14, R5); got undefined (HE-HELDOUT-001)']);
  });

  test('a cell cannot reach held-out tasks around the heldout split', () => {
    const dir = repo();
    const shapes: Array<[Prereg['cells'][number], RegExp]> = [
      [{ split: './heldout' }, /has split "\.\/heldout"; a cell's split is "dev" or "heldout"/],
      [{ split: 'dev', tasks: ['../heldout/ho-01'] } as Prereg['cells'][number], /names task "\.\.\/heldout\/ho-01", which is not a task id/],
    ];
    for (const [cell, message] of shapes) {
      const prereg: Prereg = { run_id: 'sneak-2026', cells: [cell] };
      expect(() => checkPlan(prereg, sha('x'), dir, [])).toThrow(new RegExp('^HE-HELDOUT-001 run sneak-2026: cell \\? ' + message.source));
      write(dir, 'docs/benchmarks/sneak-2026/prereg.json', JSON.stringify(prereg));
      write(dir, 'docs/benchmarks/preregistrations.d/sneak-2026.json', JSON.stringify({ schema_version: 1, experiments: [{ id: 'sneak-2026', preregistration: 'docs/benchmarks/sneak-2026/PREREGISTRATION.md', results: [] }] }));
      write(dir, 'docs/benchmarks/sneak-2026/PREREGISTRATION.md', '# sneak\n');
      expect(checkOpenings(dir, []).some((p) => p.startsWith('sneak-2026: docs/benchmarks/sneak-2026/prereg.json: run sneak-2026: cell ? ') && message.test(p))).toBe(true);
    }
  });

  test("a legacy run's results pull request leaves main clean; an amendment adds its digest to the legacy list", () => {
    const dir = repo({ status: 'spent' });
    addExperiment(dir, 'first-2026', confirmatory(CANDIDATE_B), { status: 'opened' });
    const old = addExperiment(dir, 'old-2026', undefined, { status: 'opened', label: 'dev', reason: 'later opening', candidate_sha256: null });
    const legacy: LegacyEntry[] = [{ run_id: 'old-2026', set: 'v0.1', prereg_json: 'docs/benchmarks/old-2026/prereg.json', sha256: [old.digest] }];
    git(dir, 'checkout', '-q', '-b', 'results-old');
    write(dir, 'docs/benchmarks/old-2026/results/trials.jsonl', '{"trial_id":"t1"}\n');
    write(dir, 'docs/benchmarks/old-2026/report.md', '# old-2026 report\n');
    write(dir, 'docs/benchmarks/preregistrations.d/old-2026.json', JSON.stringify({ schema_version: 1, experiments: [{ id: 'old-2026', preregistration: 'docs/benchmarks/old-2026/PREREGISTRATION.md', results: ['docs/benchmarks/old-2026/results/'] }] }));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'results old-2026');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'merge', '-q', '--squash', 'results-old');
    git(dir, 'commit', '-q', '-m', 'results old-2026 (squash)');
    expect(checkOpenings(dir, legacy)).toEqual([]);
    expect(checkPlan(old.prereg, old.digest, dir, legacy)[0]).toContain('run old-2026 set v0.1 opening 2 dev (later opening), status opened; registered before internal-task');
    const amended = JSON.stringify({ ...old.prereg, amendment: '2026-10-29' }, null, 2) + '\n';
    write(dir, 'docs/benchmarks/old-2026/prereg.json', amended);
    expect(checkOpenings(dir, legacy)[0]).toContain('a dated amendment to a legacy run adds the new digest to its entry in runner/heldout/legacy-preregistrations.json');
    expect(checkOpenings(dir, [{ ...legacy[0]!, sha256: [old.digest, sha(amended)] }])).toEqual([]);
  });

  test('the receipts generator reproduces the committed held-out fields of finished runs', () => {
    const committed = (JSON.parse(readFileSync(join(ROOT, 'docs/receipts-manifest.json'), 'utf8')) as { runs: Array<{ run_id: string | null; heldout: unknown; trials_window: unknown }> }).runs;
    const live = buildReceipts(ROOT).runs;
    for (const id of ['m3-heldout-2026-10', 'gbrain-arm-2026-10', 'company-brain-2026-10', 'gbrain-verbs-2026-10', 'qm-inner-harness-2026-10', 'gbrain-memory-2026-10', 'm2-pilot-2026-10']) {
      const row = (runs: typeof committed) => runs.find((r) => r.run_id === id)!;
      expect([row(live).heldout, row(live).trials_window]).toEqual([row(committed).heldout, row(committed).trials_window]);
    }
  }, 60_000);
});


describe('second review pass', () => {
  function squashInto(dir: string, branch: string): void {
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'merge', '-q', '--squash', branch);
    git(dir, 'commit', '-q', '-m', `${branch} (squash)`);
  }

  test('the top-level task list and the preamble cannot reach held-out content either', () => {
    const dir = repo();
    const viaTopLevel = { run_id: 'sneak-2026', cells: [{ id: 'c', slice: 'multiuser', split: 'dev' }], tasks: { multiuser: ['../heldout/ho-01'] } };
    expect(() => checkPlan(viaTopLevel, sha('x'), dir, [])).toThrow(/^HE-HELDOUT-001 run sneak-2026: cell c names task "\.\.\/heldout\/ho-01", which is not a task id/);
    const viaPreamble = { run_id: 'sneak-2026', cells: [{ id: 'c', slice: 'multiuser', split: 'dev', preamble: 'tasks/multiuser/v0.2/heldout/ho-01/task.md' }] };
    expect(() => checkPlan(viaPreamble, sha('x'), dir, [])).toThrow(/^HE-HELDOUT-001 run sneak-2026: cell c reads its preamble from "tasks\/multiuser\/v0\.2\/heldout\/ho-01\/task\.md", inside a held-out tree/);
    expect(checkPlan({ run_id: 'ok-2026', cells: [{ id: 'c', slice: 'multiuser', split: 'dev', preamble: 'tasks/multiuser/_shared/preamble.md' }], tasks: { multiuser: ['dev-01'] } }, sha('x'), dir, [])).toEqual([]);
  });

  test('plan refuses a held-out preregistration that is not the registered file', () => {
    const dir = repo();
    const a = addExperiment(dir, 'a-2026', dev());
    const edited = { ...a.prereg, cells: [{ split: 'heldout' }, { split: 'heldout', task_set: 'v0.1' }] };
    expect(() => checkPlan(edited, sha(JSON.stringify(edited)), dir, [])).toThrow(/^HE-HELDOUT-002 run a-2026: this prereg\.json \(sha256 [0-9a-f]{12}\) is not the registered docs\/benchmarks\/a-2026\/prereg\.json/);
    const unregistered = { ...a.prereg, run_id: 'b-2026' };
    expect(() => checkPlan(unregistered, sha('b'), dir, [])).toThrow(/^HE-HELDOUT-002 run b-2026: is not a registered experiment with held-out cells/);
    expect(checkPlan(a.prereg, a.digest, dir, [])[0]).toContain('run a-2026 set v0.1 opening 1 dev');
  });

  test('a withdrawn or superseded row with committed trials is a CI problem', () => {
    const dir = repo();
    addExperiment(dir, 'a-2026', confirmatory(), { status: 'withdrawn', reason: 'withdrawn before any trial' });
    expect(checkOpenings(dir, [])).toEqual([]);
    write(dir, 'docs/benchmarks/a-2026/results/trials.jsonl', '{"trial_id":"t1"}\n');
    expect(checkOpenings(dir, [])).toEqual(['set v0.1: a-2026 is withdrawn but has committed trials in docs/benchmarks/a-2026/results/trials.jsonl; a registration that ran a trial opened the set and stays counted, so mark it opened (HE-HELDOUT-002)']);
  });

  test('a race git merges without a conflict is reported by the push run on main', () => {
    const dir = repo();
    git(dir, 'checkout', '-q', '-b', 'pr-a');
    setLedger(dir, { opening_budget: 0 });
    git(dir, 'commit', '-q', '-am', 'v0.1 takes no confirmatory opening');
    expect(checkOpenings(dir, [])).toEqual([]);
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'checkout', '-q', '-b', 'pr-b');
    addExperiment(dir, 'b-2026', confirmatory());
    expect(checkOpenings(dir, [])).toEqual([]);
    squashInto(dir, 'pr-a');
    squashInto(dir, 'pr-b');
    expect(readLedger(dir)).toMatchObject({ opening_budget: 0, openings: [{ run_id: 'b-2026', status: 'planned' }] });
    const problems = checkOpenings(dir, []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toStartWith(`set v0.1: b-2026 is confirmatory opening 1 against a budget of 0 (preregistration first added at ${git(dir, 'rev-parse', 'HEAD').trim().slice(0, 12)})`);
  });

  test('preregistrations a pull request adds in separate commits take the order its squash merge gives them', () => {
    const dir = repo();
    git(dir, 'checkout', '-q', '-b', 'pr');
    addExperiment(dir, 'z-2026', dev('later opening', CANDIDATE_A));
    addExperiment(dir, 'a-2026', dev('later opening', CANDIDATE_B));
    const atHead = deriveSet(dir, 'v0.1')!.openings.map((o) => o.run_id);
    squashInto(dir, 'pr');
    expect(deriveSet(dir, 'v0.1')!.openings.map((o) => o.run_id)).toEqual(atHead);
    expect(atHead).toEqual(['a-2026', 'z-2026']);
  });
});

