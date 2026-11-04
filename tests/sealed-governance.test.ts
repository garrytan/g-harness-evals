// internal-task, sealed custody (internal-task items 1, 2 and 4): a retired set names the set that replaced it, a sealed set's status
// moves only forward and retires only through a release or a replacement, and a manifest that does not parse or validate
// counts as a live sharer.
//
// Value: protects=the live-sharer guard (liveSharersAmong, and through it release.ts, rekey.ts, compare-backups.ts,
// runner/heldout/openings.ts and check-sealed-publication.ts) keeps a retired set protected while a set in its
// replaced_by chain is still in sealed custody and not retired as a replaced set, even when no slice or corpus digest
// matches; seal-heldout.ts --check refuses a replaced_by that names no set, loops or sits on a set that is not retired, a
// sealed set that is retired with no replaced_by, a status that moves backwards against the base branch, custody dropped
// without the released block release.ts writes, and a base it cannot read; an unparseable or malformed manifest never
// drops out of the guard or the publication check; fails_when=a reseal that changes the slice but keeps task bodies lets
// the old set open or release, a hand edit flips a live sealed set such as v0.3-gen6 to retired and --check passes, or a
// broken manifest hides a live set; why_new=liveSharersAmong compared digests only and skipped manifests it could not
// parse, and --check never compared statuses with the base branch; seam=the functions on synthetic manifest maps and
// throwaway git repositories, and on this checkout; no_claim=the custody branch (tests/sealed-successor.test.ts covers the
// release and regeneration callers end to end).
import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkPlan } from '../runner/heldout/openings.ts';
import { publicationFindings } from '../scripts/check-sealed-publication.ts';
import { BACKUPS_FILE, backupsProblems, governanceProblems, heldoutSets, isUnreadable, liveSharers, liveSharersAmong, liveTarget, manifestEntries, manifestProblems, ownUnreadable, parseManifest, recordedBackups, replacementProblems, statusTransitionProblems, type HeldoutManifest, type ManifestEntry } from '../scripts/seal-heldout.ts';
import { bindBackups } from '../scripts/sealed/rekey.ts';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-governance-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const hex = (c: string) => c.repeat(64);
const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir: string, p: string, s: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
const sealed = (slice: string, o: Record<string, unknown> = {}) => ({ schema_version: 1, custody: 'sealed', sealed: { bundle_sha256: hex('f'), world_slice_sha256: slice, heldout_corpus_sha256: slice }, status: 'open', ...o }) as unknown as HeldoutManifest;
const released = (slice: string, o: Record<string, unknown> = {}) => ({ schema_version: 1, released: { bundle_sha256: hex('f'), world_slice_sha256: slice, heldout_corpus_sha256: slice }, status: 'retired', ...o }) as unknown as HeldoutManifest;
const map = (o: Record<string, ManifestEntry>) => new Map(Object.entries(o));
let n = 0;
function repo(): string {
  const dir = join(tmp, `repo-${++n}`);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'governance-test@example.invalid');
  git(dir, 'config', 'user.name', 'governance test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}
const manifestAt = (dir: string, set: string, m: unknown) => write(dir, `tasks/multiuser/${set}/heldout/MANIFEST.json`, typeof m === 'string' ? m : JSON.stringify(m, null, 2) + '\n');

describe('replaced_by in the live-sharer guard', () => {
  test('a set is protected by a live set in its replaced_by chain even when no digest matches', () => {
    const sets = map({
      old: sealed(hex('1'), { status: 'retired', replaced_by: 'mid' }),
      mid: sealed(hex('2'), { status: 'retired', replaced_by: 'new' }),
      new: sealed(hex('3')),
      other: sealed(hex('4')),
    });
    expect(liveSharersAmong('old', sets)).toEqual(["new (old's replaced_by chain names it)"]);
    expect(liveSharersAmong('mid', sets)).toEqual(["new (mid's replaced_by chain names it)"]);
    expect(liveSharersAmong('new', sets)).toEqual([]);
    expect(liveSharersAmong('other', sets)).toEqual([]);
  });

  test('the chain stops protecting once its live end is released, and a digest sharer keeps its plain name', () => {
    expect(liveSharersAmong('old', map({ old: sealed(hex('1'), { status: 'retired', replaced_by: 'new' }), new: released(hex('3')) }))).toEqual([]);
    expect(liveSharersAmong('old', map({ old: sealed(hex('1'), { status: 'retired', replaced_by: 'new' }), new: sealed(hex('1')) }))).toEqual(['new']);
  });

  test('a chain member that is retired without a replaced_by, a chain that names no manifest and a loop all count as live', () => {
    expect(liveSharersAmong('old', map({ old: sealed(hex('1'), { status: 'retired', replaced_by: 'new' }), new: sealed(hex('3'), { status: 'retired' }) }))).toEqual(["new (old's replaced_by chain names it)"]);
    expect(liveSharersAmong('old', map({ old: sealed(hex('1'), { status: 'retired', replaced_by: 'gone' }) }))).toEqual(["gone (old's replaced_by chain names it, and it has no manifest)"]);
    expect(liveSharersAmong('old', map({ old: sealed(hex('1'), { status: 'retired', replaced_by: 'a' }), a: sealed(hex('2'), { status: 'retired', replaced_by: 'old' }) }))).toEqual(["old (old's replaced_by chain loops)"]);
  });

  test('every caller reading a checkout: liveSharers, the openings plan check and the publication check', () => {
    const dir = repo();
    write(dir, 'docs/benchmarks/preregistrations.json', JSON.stringify({ schema_version: 1, experiments: [] }));
    manifestAt(dir, 'v7', released(hex('1'), { replaced_by: 'v8', opening_budget: 1, alpha_per_opening: 0.05, openings: [{ run_id: 'p-2026', status: 'planned', label: 'dev', reason: 'r', candidate_sha256: hex('a') }], exposures: [] }));
    write(dir, 'tasks/multiuser/v7/sealed-world/slice.json', '{}');
    manifestAt(dir, 'v8', sealed(hex('2')));
    const prereg = { run_id: 'p-2026', cells: [{ split: 'heldout', task_set: 'v7' }], heldout: { set: 'v7', label: 'dev', reason: 'r', candidate_sha256: hex('a') } };
    write(dir, 'docs/benchmarks/p-2026/PREREGISTRATION.md', '# p\n');
    write(dir, 'docs/benchmarks/p-2026/prereg.json', JSON.stringify(prereg, null, 2) + '\n');
    write(dir, 'docs/benchmarks/preregistrations.d/p-2026.json', JSON.stringify({ schema_version: 1, experiments: [{ id: 'p-2026', preregistration: 'docs/benchmarks/p-2026/PREREGISTRATION.md', results: [] }] }));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    const digest = new Bun.CryptoHasher('sha256').update(readFileSync(join(dir, 'docs/benchmarks/p-2026/prereg.json'))).digest('hex');
    expect(liveSharers('v7', dir)).toEqual(["v8 (v7's replaced_by chain names it)"]);
    expect(publicationFindings(dir)).toEqual([{ path: 'tasks/multiuser/v7/sealed-world/slice.json', kind: "released content of set v7, whose world slice or corpus set v8 (v7's replaced_by chain names it) shares while still in sealed custody" }]);
    expect(() => checkPlan(prereg as never, digest, dir, [])).toThrow("HE-HELDOUT-003 run p-2026 plans an opening of set v7, which shares its world slice or corpus with v8 (v7's replaced_by chain names it), still in sealed custody and not retired; opening v7 would expose that set. fix: run it on v8");
    manifestAt(dir, 'v8', released(hex('2')));
    git(dir, 'add', '-A');
    expect(liveSharers('v7', dir)).toEqual([]);
    expect(publicationFindings(dir)).toEqual([]);
  });

  test('this checkout: retired v0.3 names v0.3-gen6 and stays protected by it', () => {
    const m = manifestEntries(ROOT);
    expect((m.get('v0.3') as HeldoutManifest).replaced_by).toBe('v0.3-gen6');
    expect(liveSharers('v0.3', ROOT)).toEqual(['v0.3-gen6']);
    const gen6 = m.get('v0.3-gen6') as HeldoutManifest;
    const noDigests = new Map(m);
    noDigests.set('v0.3-gen6', { ...gen6, sealed: { ...gen6.sealed!, world_slice_sha256: hex('9'), heldout_corpus_sha256: hex('8') } });
    expect(liveSharersAmong('v0.3', noDigests)).toEqual(["v0.3-gen6 (v0.3's replaced_by chain names it)"]);
  });
});

describe('an unreadable manifest fails closed', () => {
  test('liveSharersAmong and liveSharers count a manifest that does not parse or validate as a live sharer', () => {
    const sets = map({ a: sealed(hex('1')), b: { unreadable: 'it is not JSON' } });
    expect(liveSharersAmong('a', sets)).toEqual(['b (its MANIFEST.json does not parse or validate: it is not JSON; it counts as live until it does)']);
    const dir = repo();
    manifestAt(dir, 'v7', released(hex('1')));
    manifestAt(dir, 'v8', '{ not json');
    manifestAt(dir, 'v9', { schema_version: 1, custody: 'sealed' });
    manifestAt(dir, 'v6', { schema_version: 1, custody: 'sealed', sealed: { world_slice_sha256: 'abc' } });
    manifestAt(dir, 'v5', 'null');
    manifestAt(dir, 'v4', { schema_version: 1, sealed: { bundle_sha256: hex('f'), world_slice_sha256: hex('2'), heldout_corpus_sha256: hex('3') } });
    expect(liveSharers('v7', dir)).toEqual([
      'v4 (its MANIFEST.json does not parse or validate: it has a sealed block but custody is not "sealed"; a released set keeps its commitments under released; it counts as live until it does)',
      'v5 (its MANIFEST.json does not parse or validate: it is not a JSON object; it counts as live until it does)',
      'v6 (its MANIFEST.json does not parse or validate: sealed.world_slice_sha256 is not a sha256; it counts as live until it does)',
      'v8 (its MANIFEST.json does not parse or validate: it is not JSON; it counts as live until it does)',
      'v9 (its MANIFEST.json does not parse or validate: custody is "sealed" but it has no sealed block; it counts as live until it does)',
    ]);
  });

  test('the publication check keeps the set of an unreadable manifest, and every other set, protected', () => {
    const dir = repo();
    manifestAt(dir, 'v7', released(hex('1')));
    write(dir, 'tasks/multiuser/v7/sealed-world/slice.json', '{}');
    manifestAt(dir, 'v8', '{ not json');
    write(dir, 'tasks/multiuser/v8/heldout/t1/task.toml', 'id = "t1"');
    git(dir, 'add', '-A');
    expect(publicationFindings(dir)).toEqual([
      { path: 'tasks/multiuser/v7/sealed-world/slice.json', kind: 'released content of set v7, whose world slice or corpus set v8 (its MANIFEST.json does not parse or validate: it is not JSON; it counts as live until it does) shares while still in sealed custody' },
      { path: 'tasks/multiuser/v8/heldout/t1/task.toml', kind: 'released content of set v8, whose MANIFEST.json does not parse or validate (it is not JSON), so it counts as still in sealed custody' },
    ]);
  });

  test('--check names a manifest that does not parse instead of calling it missing', () => {
    const dir = repo();
    manifestAt(dir, 'v8', '{ not json');
    const v8 = heldoutSets(dir).find((s) => s.name === 'v8')!;
    expect(manifestProblems(v8)).toEqual(['tasks/multiuser/v8/heldout/MANIFEST.json does not parse or validate: it is not JSON']);
  });
});

describe('status governance', () => {
  const gen6 = sealed(hex('1'));
  const v03 = sealed(hex('1'), { status: 'retired', replaced_by: 'gen6' });
  const NO_REPLACED_BY = (s: string) => `set ${s} is in sealed custody and retired with no replaced_by; a sealed set retires only through scripts/sealed/release.ts, which writes a released block, or as a replaced set that names its successor in replaced_by`;
  const BACKWARDS = (s: string, from: string, to: string) => `set ${s}: status went ${from} -> ${to}; a sealed set goes open -> spent -> retired or open -> retired and never leaves spent or retired`;
  const NOT_LIVE = (s: string, t: string) => `set ${s}: replaced_by newly names ${t}, which is not in sealed custody or is retired; a set is retired as replaced only by a live reseal`;
  const BASE_NOT_LIVE = (s: string, t: string) => `set ${s}: replaced_by newly names ${t}, which the base does not hold in sealed custody and not retired; a set is retired as replaced only by a live reseal that is already on the base`;
  const CHANGED = (s: string, keys: string) => `set ${s}: its sealed commitments (${keys}) changed while it stays in sealed custody; they never change once sealed`;
  const NO_RELEASE = "set s left sealed custody without the released block scripts/sealed/release.ts writes (released bundle, world slice and corpus digests equal to the base's sealed ones, and the base's tree_sha256)";

  test('replacementProblems: replaced_by names a set with a manifest, never loops, sits only on a retired set; a sealed set retires only with replaced_by', () => {
    expect(replacementProblems(map({ v03, gen6 }))).toEqual([]);
    expect(replacementProblems(map({ v03: sealed(hex('1'), { status: 'retired', replaced_by: 'gone' }) }))).toEqual(['set v03: replaced_by names gone, which has no held-out manifest']);
    expect(replacementProblems(map({ a: sealed(hex('1'), { status: 'retired', replaced_by: 'b' }), b: sealed(hex('1'), { status: 'retired', replaced_by: 'a' }) }))).toEqual(['set a: the replaced_by chain loops (a -> b -> a)', 'set b: the replaced_by chain loops (b -> a -> b)']);
    expect(replacementProblems(map({ a: sealed(hex('1'), { status: 'retired', replaced_by: 'a' }) }))).toEqual(['set a: the replaced_by chain loops (a -> a)']);
    expect(replacementProblems(map({ a: sealed(hex('1'), { replaced_by: 'gen6' }), gen6 }))).toEqual(['set a: replaced_by sits only on a retired set (status is open)']);
    expect(replacementProblems(map({ a: sealed(hex('1'), { status: 'retired' }) }))).toEqual([NO_REPLACED_BY('a')]);
    expect(replacementProblems(map({ a: released(hex('1')) }))).toEqual([]);
  });

  // Value: protects=the status step table allows open -> retired and spent -> retired; fails_when=a forward step to retired is refused; why_new=the table listed no forward step to retired; seam=none; no_claim=replaced_by rules (replacementProblems).
  test('statusTransitionProblems: open -> spent -> retired or open -> retired, never back; custody ends only with the released block', () => {
    const step = (from: string, to: string) => statusTransitionProblems(map({ s: sealed(hex('1'), { status: from }) }), map({ s: sealed(hex('1'), { status: to }) }));
    for (const [from, to] of [['open', 'open'], ['open', 'spent'], ['open', 'retired'], ['spent', 'spent'], ['spent', 'retired'], ['retired', 'retired']]) expect(step(from!, to!)).toEqual([]);
    for (const [from, to] of [['spent', 'open'], ['retired', 'open'], ['retired', 'spent']]) expect(step(from!, to!)).toEqual([BACKWARDS('s', from!, to!)]);
    expect(statusTransitionProblems(map({ s: sealed(hex('1'), { status: 'spent' }) }), map({ s: sealed(hex('1'), { status: undefined }) }))).toEqual([BACKWARDS('s', 'spent', 'absent')]);
    expect(statusTransitionProblems(map({ s: sealed(hex('1')) }), map({}))).toEqual(["set s: its MANIFEST.json is gone; a sealed set's manifest stays"]);
    expect(statusTransitionProblems(map({ s: sealed(hex('1')) }), map({ s: released(hex('1')) }))).toEqual([]);
    expect(statusTransitionProblems(map({ s: sealed(hex('1'), { status: 'spent' }) }), map({ s: released(hex('1')) }))).toEqual([]);
    expect(statusTransitionProblems(map({ s: sealed(hex('1')) }), map({ s: released(hex('1'), { released: undefined }) }))).toEqual([NO_RELEASE]);
    expect(statusTransitionProblems(map({ s: sealed(hex('1')) }), map({ s: released(hex('1'), { released: { bundle_sha256: hex('0') } }) }))).toEqual([NO_RELEASE]);
    expect(statusTransitionProblems(map({ s: sealed(hex('1'), { tree_sha256: hex('a') }) }), map({ s: released(hex('1'), { tree_sha256: hex('a') }) }))).toEqual([]);
    expect(statusTransitionProblems(map({ s: sealed(hex('1'), { tree_sha256: hex('a') }) }), map({ s: released(hex('1'), { tree_sha256: hex('e') }) }))).toEqual([NO_RELEASE]);
    expect(statusTransitionProblems(map({ s: sealed(hex('1')) }), map({ s: released(hex('2')) }))).toEqual([NO_RELEASE]);
  });

  // Value: protects=a sealed set's bundle, slice and corpus digests and tree_sha256 stay fixed while it stays in sealed custody; fails_when=a PR swaps gen6's tree_sha256 for the empty digest or changes its slice or corpus digest and --check passes; why_new=only status, release and replaced_by were compared with the base; seam=none; no_claim=a reseal under a new set name.
  test('statusTransitionProblems: sealed commitments never change while the set stays in sealed custody', () => {
    const at = (o: Record<string, unknown>) => sealed(hex('1'), { tree_sha256: hex('a'), ...o });
    expect(statusTransitionProblems(map({ s: at({}) }), map({ s: at({ status: 'spent' }) }))).toEqual([]);
    expect(statusTransitionProblems(map({ s: at({}) }), map({ s: at({ tree_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }) }))).toEqual([CHANGED('s', 'tree_sha256')]);
    expect(statusTransitionProblems(map({ s: at({}) }), map({ s: sealed(hex('2'), { tree_sha256: hex('a') }) }))).toEqual([CHANGED('s', 'sealed.world_slice_sha256, sealed.heldout_corpus_sha256')]);
    expect(statusTransitionProblems(map({ s: at({}) }), map({ s: at({ sealed: { bundle_sha256: hex('0'), world_slice_sha256: hex('1'), heldout_corpus_sha256: hex('2') } }) }))).toEqual([CHANGED('s', 'sealed.bundle_sha256, sealed.heldout_corpus_sha256')]);
  });

  // Value: protects=a newly set replaced_by names a set that is live in sealed custody on the base too; fails_when=one PR adds a fake successor and retires a live set onto it; why_new=the successor was checked in the head only; seam=none; no_claim=the real v0.3 -> v0.3-gen6 history beyond this checkout.
  test('statusTransitionProblems: a new replaced_by names a set live in sealed custody on the base as well as in the head', () => {
    expect(statusTransitionProblems(map({ v03: sealed(hex('1')) }), map({ v03, gen6 }))).toEqual([BASE_NOT_LIVE('v03', 'gen6')]);
    expect(statusTransitionProblems(map({ v03: sealed(hex('1')), gen6: sealed(hex('1'), { status: 'retired' }) }), map({ v03, gen6 }))).toEqual([BASE_NOT_LIVE('v03', 'gen6'), BACKWARDS('gen6', 'retired', 'open')]);
    expect(statusTransitionProblems(map({ v03: sealed(hex('1')), gen6: { unreadable: 'it is not JSON' } }), map({ v03, gen6 }))).toEqual([BASE_NOT_LIVE('v03', 'gen6'), "set gen6: its MANIFEST.json on the base does not parse or validate (it is not JSON), so the status check cannot compare it and fails closed"]);
  });

  test('statusTransitionProblems: replaced_by is set once, to a set in sealed custody and not retired, and never changes', () => {
    expect(statusTransitionProblems(map({ v03: sealed(hex('1'), { status: 'retired' }), gen6 }), map({ v03, gen6 }))).toEqual([]);
    expect(statusTransitionProblems(map({ v03: sealed(hex('1')), gen6 }), map({ v03, gen6 }))).toEqual([]);
    expect(statusTransitionProblems(map({ v03, gen6, gen7: gen6 }), map({ v03: { ...v03, replaced_by: 'gen7' }, gen6, gen7: gen6 }))).toEqual(['set v03: replaced_by changed from gen6 to gen7; it never changes once set']);
    expect(statusTransitionProblems(map({ v03: sealed(hex('1')), v02: released(hex('2')) }), map({ v03: { ...v03, replaced_by: 'v02' }, v02: released(hex('2')) }))).toEqual([NOT_LIVE('v03', 'v02')]);
    expect(statusTransitionProblems(map({ v03: { unreadable: 'it is not JSON' } }), map({ v03 }))).toEqual(['set v03: its MANIFEST.json on the base does not parse or validate (it is not JSON), so the status check cannot compare it and fails closed']);
  });

  test('a set whose own manifest does not parse or validate stays protected, and --check and the status check name it', () => {
    const own = { unreadable: 'replaced_by is not a set name' };
    expect(liveSharersAmong('v03', map({ v03: own, gen6 }))).toEqual(['v03 (its own MANIFEST.json does not parse or validate: replaced_by is not a set name; it counts as live until it does)']);
    expect(statusTransitionProblems(map({ v03, gen6 }), map({ v03: own, gen6 }))).toEqual(['set v03: its MANIFEST.json does not parse or validate (replaced_by is not a set name), so the status check cannot compare it and fails closed']);
    const dir = repo();
    manifestAt(dir, 'v8', sealed(hex('1'), { status: 'retired', replaced_by: null }));
    const v8 = heldoutSets(dir).find((s) => s.name === 'v8')!;
    expect(manifestProblems(v8)).toEqual(['tasks/multiuser/v8/heldout/MANIFEST.json does not parse or validate: replaced_by is not a set name']);
    expect(ownUnreadable('v03', liveSharersAmong('v03', map({ v03: own, gen6 })))).toBe(true);
    const loop = liveSharersAmong('v03', map({ v03: { ...v03, replaced_by: 'v03' } as HeldoutManifest, gen6 }));
    expect(loop).toContain("v03 (v03's replaced_by chain loops)");
    expect(ownUnreadable('v03', loop)).toBe(false);
    expect(liveTarget(['b (its MANIFEST.json does not parse or validate: it is not JSON; it counts as live until it does)'])).toBeUndefined();
    expect(liveTarget(['b (its MANIFEST.json does not parse or validate: it is not JSON; it counts as live until it does)', "gen6 (v03's replaced_by chain names it)"])).toBe('gen6');
  });

  // Value: protects=a refusal names only a plain sharer or a replaced_by chain successor as the --set to use; fails_when=it tells the custodian to use a set with no manifest or a looping chain; why_new=liveTarget skipped only unreadable labels; seam=none; no_claim=the refusal text of callers.
  test('liveTarget names only a plain sharer or a set the replaced_by chain names', () => {
    expect(liveTarget(["gone (old's replaced_by chain names it, and it has no manifest)"])).toBeUndefined();
    expect(liveTarget(["old (old's replaced_by chain loops)"])).toBeUndefined();
    expect(liveTarget(["old (old's replaced_by chain loops)", 'gen6'])).toBe('gen6');
    expect(liveTarget(["gone (old's replaced_by chain names it, and it has no manifest)", "gen6 (old's replaced_by chain names it)"])).toBe('gen6');
    expect(liveTarget([])).toBeUndefined();
  });

  // Value: protects=a multiuser set in sealed custody reads only with both a world slice and a corpus digest; fails_when=a manifest with one digest reads and the other content stops sharing; why_new=one digest was enough; seam=none; no_claim=repo sets, whose digests are null.
  test('a multiuser set in sealed custody without both a world slice and a corpus digest does not read, so it stays live; a repo set may have null digests', () => {
    const NONE = 'sealed lacks world_slice_sha256 or heldout_corpus_sha256; a multiuser set in sealed custody commits to both its world slice and its corpus';
    expect(parseManifest(JSON.stringify(sealed(hex('1'), { sealed: { bundle_sha256: hex('f'), world_slice_sha256: hex('1') } })))).toEqual({ unreadable: NONE });
    expect(parseManifest(JSON.stringify(sealed(hex('1'), { sealed: { bundle_sha256: hex('f'), world_slice_sha256: null, heldout_corpus_sha256: hex('1') } })))).toEqual({ unreadable: NONE });
    expect(parseManifest(JSON.stringify(sealed(hex('1'), { sealed: { bundle_sha256: hex('f') } })))).toEqual({ unreadable: NONE });
    expect(parseManifest(JSON.stringify(sealed(hex('1'), { sealed: { bundle_sha256: hex('f'), world_slice_sha256: null, heldout_corpus_sha256: null } })))).toEqual({ unreadable: NONE });
    expect(isUnreadable(parseManifest(JSON.stringify(sealed(hex('1'), { kind: 'repo', sealed: { bundle_sha256: hex('f'), world_slice_sha256: null, heldout_corpus_sha256: null } }))))).toBe(false);
    expect(liveSharersAmong('a', map({ a: released(hex('1')), b: parseManifest(JSON.stringify(sealed(hex('1'), { sealed: { bundle_sha256: hex('f') } }))) }))).toEqual([`b (its MANIFEST.json does not parse or validate: ${NONE}; it counts as live until it does)`]);
  });

  test('this checkout passes, and a hand flip of v0.3-gen6 to retired fails however it is dressed', () => {
    expect(governanceProblems(ROOT)).toEqual([]);
    const head = manifestEntries(ROOT);
    const live = head.get('v0.3-gen6') as HeldoutManifest;
    const flip = (o: Record<string, unknown>) => { const h = new Map(head); h.set('v0.3-gen6', { ...live, status: 'retired', ...o } as HeldoutManifest); return [...replacementProblems(h), ...statusTransitionProblems(head, h)]; };
    expect(flip({})).toEqual([NO_REPLACED_BY('v0.3-gen6')]);
    expect(flip({ replaced_by: 'v0.3' })).toEqual(['set v0.3: the replaced_by chain loops (v0.3 -> v0.3-gen6 -> v0.3)', 'set v0.3-gen6: the replaced_by chain loops (v0.3-gen6 -> v0.3 -> v0.3-gen6)', NOT_LIVE('v0.3-gen6', 'v0.3')]);
    expect(flip({ replaced_by: 'v0.2' })).toEqual([NOT_LIVE('v0.3-gen6', 'v0.2')]);
  });

  test('governanceProblems reads the base from the merge base with origin/main or main, and fails closed without one', () => {
    const dir = repo();
    manifestAt(dir, 'v8', sealed(hex('1')));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    git(dir, 'branch', '-m', 'work');
    expect(governanceProblems(dir)).toEqual(["the status check could not read the base branch's manifests (no origin/main or main, or no merge base with HEAD); it fails closed. Fetch main (git fetch origin main) and run it again"]);
    git(dir, 'branch', 'main');
    expect(governanceProblems(dir)).toEqual([]);
    manifestAt(dir, 'v8', sealed(hex('1'), { status: 'retired' }));
    expect(governanceProblems(dir)).toEqual([NO_REPLACED_BY('v8')]);
    manifestAt(dir, 'v8', sealed(hex('1'), { status: 'spent' }));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'spend');
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    manifestAt(dir, 'v8', sealed(hex('1'), { status: 'open' }));
    expect(governanceProblems(dir)).toEqual([BACKWARDS('v8', 'spent', 'open')]);
  });

  // Value: protects=sealed/backups.json only grows against the base, and a base file that does not parse fails closed; fails_when=a PR drops or rewrites a recorded backup and --check passes; why_new=the file was checked on the head only; seam=none; no_claim=the custody branch.
  test('governanceProblems keeps sealed/backups.json append-only against the base', () => {
    const dir = repo();
    const doc = (...backups: Array<{ set: string; sha256: string; what: string }>) => JSON.stringify({ schema_version: 1, backups }, null, 2) + '\n';
    const a = { set: 'v8', sha256: hex('a'), what: 'w' };
    const b = { set: 'v8', sha256: hex('b'), what: 'w' };
    manifestAt(dir, 'v8', sealed(hex('1')));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'no backups file');
    expect(governanceProblems(dir)).toEqual([]);
    write(dir, BACKUPS_FILE, doc(a));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'one backup');
    git(dir, 'checkout', '-q', '-b', 'work');
    expect(governanceProblems(dir)).toEqual([]);
    write(dir, BACKUPS_FILE, doc(a, b));
    expect(governanceProblems(dir)).toEqual([]);
    const GONE = `${BACKUPS_FILE}: the base's entry for set v8 (sha256 ${hex('a').slice(0, 12)}) is gone or changed; the file is append-only, so every entry stays as it was`;
    write(dir, BACKUPS_FILE, doc(b));
    expect(governanceProblems(dir)).toEqual([GONE]);
    write(dir, BACKUPS_FILE, doc({ ...a, what: 'rewritten' }, b));
    expect(governanceProblems(dir)).toEqual([GONE]);
    write(dir, BACKUPS_FILE, doc({ ...a, set: 'v9' }));
    expect(governanceProblems(dir)).toEqual([GONE]);
    rmSync(join(dir, BACKUPS_FILE));
    expect(governanceProblems(dir)).toEqual([GONE]);
    write(dir, BACKUPS_FILE, '{ not json');
    expect(governanceProblems(dir)).toEqual([`${BACKUPS_FILE} does not parse as a list of backups, so the append-only check cannot compare it with the base and fails closed`]);
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'a broken backups file on main');
    git(dir, 'checkout', '-q', 'work');
    git(dir, 'reset', '-q', '--hard', 'main');
    write(dir, BACKUPS_FILE, doc(a));
    expect(governanceProblems(dir)).toEqual([`${BACKUPS_FILE} on the base does not parse as a list of backups, so the append-only check cannot compare it and fails closed`]);
  });
});

describe('backup commitments (sealed/backups.json)', () => {
  const GEN5 = '1e69dc119598d9580e32dd8431dec785966be31eff792f40b3effc74641130e9';
  const GEN6 = '8f262b42847c10c184e6bb135e9e0dc7418ea5a1c89ed1f1414a850f5167c3f6';
  const text = () => readFileSync(join(ROOT, BACKUPS_FILE), 'utf8');

  test('this checkout records the gen5 backup for v0.3 and the gen6 backup for v0.3-gen6, and the reseal comparison binds', () => {
    const recorded = recordedBackups(text());
    expect(recorded.map((b) => [b.set, b.sha256])).toEqual([['v0.3', GEN5], ['v0.3-gen6', GEN6]]);
    const m = manifestEntries(ROOT);
    expect(backupsProblems(text(), new Set(m.keys()))).toEqual([]);
    const a = { flag: '--a', file: 'gen5.tar.age', sha256: GEN5 }, b = { flag: '--b', file: 'gen6.tar.age', sha256: GEN6, own: true };
    expect(bindBackups('v0.3-gen6', [a, b], [], m, recorded, m)).toEqual({ declared: [], via: ['v0.3'] });
    expect(bindBackups('v0.3', [{ ...a, flag: '--from-backup' }], [], m, recorded, m)).toEqual({ declared: [], via: [] });
    expect(bindBackups('v0.3-gen6', [{ ...a, flag: '--from-backup' }], [], m, recorded, m)).toEqual({ declared: [], via: ['v0.3'] });
    expect(() => bindBackups('v0.3-gen6', [{ ...a, sha256: GEN6, file: 'gen6.tar.age' }, { ...b, sha256: GEN5, file: 'gen5.tar.age' }], [], m, recorded, m)).toThrow(`HE-SEALED-006 --b gen5.tar.age has sha256 ${GEN5.slice(0, 12)}, which sealed/backups.json on main records for v0.3, not for v0.3-gen6;`);
    expect(() => bindBackups('v0.3', [{ ...b, flag: '--from-backup', own: false }], [GEN6], m, recorded, m)).toThrow(`HE-SEALED-006 --from-backup gen6.tar.age has sha256 ${GEN6.slice(0, 12)}, which sealed/backups.json on main records for v0.3-gen6, not for v0.3 or a set it replaced;`);
    expect(bindBackups('v0.3-gen6', [a, b], [GEN5], m, recorded, m)).toEqual({ declared: [GEN5], via: ['v0.3'] });
  });

  test("a replaced set's backup binds to its successor only while no other live set shares the replaced set's slice or corpus", () => {
    const recorded = [{ set: 'old', sha256: hex('a'), what: 'w' }];
    const ok = map({ old: sealed(hex('1'), { status: 'retired', replaced_by: 'new' }), new: sealed(hex('2')) });
    const bk = [{ flag: '--from-backup', file: 'old.tar.age', sha256: hex('a') }];
    expect(bindBackups('new', bk, [], ok, recorded, new Map())).toEqual({ declared: [], via: ['old'] });
    expect(() => bindBackups('new', bk, [], new Map([...ok, ['other', sealed(hex('1'))]]), recorded, new Map(), 'Nothing was pushed or written')).toThrow("HE-SEALED-006 --from-backup old.tar.age is recorded for old, which new replaced, but old also shares its world slice or corpus with other, still in sealed custody and not retired; a backup of old holds that set's content too. Nothing was pushed or written");
  });

  // Value: protects=a replaced set's backup does not bind while a set sealed only in the --repo checkout shares its slice or corpus; fails_when=a pending set in the checkout shares the replaced set's content and the backup binds; why_new=only main's manifests were read; seam=none; no_claim=the custody branch and the access-log check (tests/sealed-rekey.test.ts).
  test("a replaced set's backup does not bind while a set in the checkout's manifests shares its slice or corpus", () => {
    const recorded = [{ set: 'old', sha256: hex('a'), what: 'w' }];
    const ok = map({ old: sealed(hex('1'), { status: 'retired', replaced_by: 'new' }), new: sealed(hex('2')) });
    const bk = [{ flag: '--from-backup', file: 'old.tar.age', sha256: hex('a') }];
    expect(bindBackups('new', bk, [], ok, recorded, new Map([...ok, ['new', sealed(hex('1'))]]))).toEqual({ declared: [], via: ['old'] });
    expect(() => bindBackups('new', bk, [], ok, recorded, new Map([...ok, ['pending', sealed(hex('1'))]]))).toThrow("HE-SEALED-006 --from-backup old.tar.age is recorded for old, which new replaced, but old also shares its world slice or corpus with pending, still in sealed custody and not retired; a backup of old holds that set's content too. Nothing was decrypted");
  });

  test('--check refuses a malformed file, an unknown set, a bad digest, a missing reason and a backup recorded twice', () => {
    const names = new Set(['v8', 'v9']);
    expect(backupsProblems(null, names)).toEqual([]);
    expect(backupsProblems('{ not json', names)).toEqual([`${BACKUPS_FILE} does not parse as JSON`]);
    expect(backupsProblems(JSON.stringify({ schema_version: 2, backups: {} }), names)).toEqual([`${BACKUPS_FILE}: schema_version is not 1`, `${BACKUPS_FILE}: backups is not a list`]);
    const entry = (set: string, sha256: string, what = 'w') => ({ set, sha256, what });
    expect(backupsProblems(JSON.stringify({ schema_version: 1, backups: [entry('v8', hex('a')), entry('vx', hex('b')), entry('v9', 'ABC'), entry('v9', hex('c'), ''), entry('v9', hex('a'))] }), names)).toEqual([
      `${BACKUPS_FILE}: backups[1]: set "vx" names no held-out set with a manifest`,
      `${BACKUPS_FILE}: backups[2]: sha256 is not 64 lowercase hex characters`,
      `${BACKUPS_FILE}: backups[3]: what is missing (say which backup it is and how the set was sealed from it)`,
      `${BACKUPS_FILE}: backups[4]: sha256 ${hex('a').slice(0, 12)} is recorded twice; a backup belongs to one set`,
    ]);
    expect(() => recordedBackups('{ not json')).toThrow(`HE-SEALED-006 ${BACKUPS_FILE} on main does not parse as JSON; nothing binds a backup to a set until it does. Nothing was decrypted`);
  });

  // Value: protects=the runtime binding refuses a sealed/backups.json on main that records one sha256 twice; fails_when=a backup recorded for two sets binds to either; why_new=only --check refused a repeated sha256; seam=none; no_claim=the custody branch.
  test('recordedBackups refuses a sha256 recorded more than once', () => {
    const entry = (set: string, sha256: string) => ({ set, sha256, what: 'w' });
    expect(recordedBackups(JSON.stringify({ schema_version: 1, backups: [entry('v8', hex('a')), entry('v9', hex('b'))] })).length).toBe(2);
    expect(() => recordedBackups(JSON.stringify({ schema_version: 1, backups: [entry('v8', hex('a')), entry('v9', hex('a'))] }))).toThrow(`HE-SEALED-006 ${BACKUPS_FILE} on main records sha256 ${hex('a').slice(0, 12)} more than once; a backup belongs to one set, so nothing binds it until it is recorded once. Nothing was decrypted`);
  });
});
