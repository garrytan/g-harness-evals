// internal-task-a, sealed custody (internal-task-b): release and regeneration see a successor set through the custody remote and the
// custody branch, not through the public checkout's remote.
//
// Value: protects=release.ts and rekey.ts/compare-backups.ts (refuseSetState) refuse a set while a live successor shares
// its world slice or corpus even when the public checkout's own remote is a stale fork, because main is fetched from the
// URL the custody clone pushes to; a rewrite in the checkout's git config that would send that URL elsewhere is refused
// with HE-SEALED-013; a set whose bundle is on the custody branch but whose manifest is not on main or in the checkout
// blocks release and regeneration of every other set, before decrypting and again under the custody lock, so a reseal
// that lands while a release decrypts stops the released line;
// fails_when=a fork as the checkout's origin hides the successor's manifest, an insteadOf rule in the checkout redirects
// the fetch, a custody remote that fetches from a fork and pushes to custody hides it, a manifest that does not commit to
// the bundle on custody (empty, JSON null, another bundle's) clears it, a successor sealed on custody before its manifest
// reaches main lets a release or a backup through, or a protocol.<name>.allow in git config lets a remote helper run;
// why_new=liveSharersCurrent fetched the checkout's remote and read manifests only; seam=releaseSet and refuseSetState
// in-process against a throwaway bare repository with an orphan custody branch; no_claim=a manifest written by hand
// without a bundle, or a reseal that lands after the release (seal.ts does not check released sets).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { encryptTo, sha256 } from '../runner/heldout/sealed.ts';
import { heldoutSet, readManifest } from '../scripts/seal-heldout.ts';
import { compareAndPush, netEnv, readAccessLog, syncCustody } from '../scripts/sealed/custody.ts';
import { openRun } from '../scripts/sealed/open.ts';
import { releaseSet } from '../scripts/sealed/release.ts';
import { refuseSetState } from '../scripts/sealed/rekey.ts';
import { cloneCustody, co, commitPush, git, makeFixture, SCRUBBED_ENV, SET, type Fixture } from './sealed-fixture.ts';

describe('the successor of a set, seen through the custody remote and the custody branch', () => {
  let f: Fixture;
  let n = 0;
  const clone = () => cloneCustody(f, `successor-${++n}`);
  const refusedRelease = (o: Partial<Parameters<typeof releaseSet>[0]> = {}) => releaseSet({ repo: f.repo, set: SET, ...co(f), custody: clone(), log: () => undefined, ...o }).then(() => 'no refusal', (e: Error) => e.message);
  const missingIdentity = () => ({ identityPath: join(f.tmp, 'no-identity') });
  const regeneration = () => { try { refuseSetState(clone(), SET, 'Nothing was decrypted', f.repo, 'origin'); return 'no refusal'; } catch (e) { return (e as Error).message; } };
  const sibling = (name: string) => join(f.repo, 'tasks', 'multiuser', name, 'heldout', 'MANIFEST.json');
  const bundles = new Map<string, Uint8Array>();
  const successor = (name: string, status: string, bundle?: Uint8Array) => {
    mkdirSync(dirname(sibling(name)), { recursive: true });
    writeFileSync(sibling(name), JSON.stringify({ schema_version: 1, custody: 'sealed', sealed: { world_slice_sha256: readManifest(heldoutSet(SET, f.repo))!.sealed!.world_slice_sha256, heldout_corpus_sha256: readManifest(heldoutSet(SET, f.repo))!.sealed!.world_slice_sha256, ...(bundle ? { bundle_sha256: sha256(bundle) } : {}) }, status }));
  };
  /** What seal.ts pushes first: the bundle and its sealed line, before the set's manifest can reach main. */
  const bundleOf = async (name: string) => { const b = await encryptTo(f.recipient, new TextEncoder().encode(`synthetic bundle of ${name}`)); bundles.set(name, b); return b; };
  const sealOnCustody = (name: string, bundle: Uint8Array) => {
    const c = clone();
    compareAndPush(c, { message: () => `seal ${name}`, decide: () => ({ schema_version: 1, event: 'sealed', at: 't', run_id: '*', set: name, bundle_sha256: sha256(bundle), custodian: 'test' }), stage: () => { mkdirSync(join(c, name), { recursive: true }); writeFileSync(join(c, name, 'bundle.tar.age'), bundle); return [`${name}/bundle.tar.age`]; } });
  };
  const resetToMain = () => { git(f.repo, 'fetch', '-q', 'origin', 'main'); git(f.repo, 'reset', '-q', '--hard', 'origin/main'); git(f.repo, 'clean', '-qfd'); };
  const shared = (outcome: string) => `HE-SEALED-008 set vsyn shares its world slice or corpus with vsyn-next, still in sealed custody and not retired; releasing vsyn would publish that set's content. Release it after the retirement of vsyn-next is on main and in this checkout. ${outcome}`;

  beforeAll(async () => { f = await makeFixture(2); }, 120_000);
  afterAll(() => { if (f) rmSync(f.tmp, { recursive: true, force: true }); });

  test('a stale fork as the checkout\'s origin does not hide a successor on main, and a rewrite of the custody URL is refused', async () => {
    const fork = join(f.tmp, 'fork.git');
    execFileSync('git', ['clone', '-q', '--bare', f.bare, fork], { env: SCRUBBED_ENV });
    successor('vsyn-next', 'open');
    commitPush(f, 'synthetic reseal on main');
    git(f.repo, 'reset', '-q', '--hard', 'HEAD~1');
    git(f.repo, 'remote', 'set-url', 'origin', fork);
    git(f.repo, 'update-ref', 'refs/sealed/main', 'HEAD');
    git(f.repo, 'update-ref', 'refs/sealed/main-999999999', 'HEAD');
    try {
      expect(await refusedRelease(missingIdentity())).toBe(shared('Nothing was decrypted or written'));
      expect(regeneration()).toStartWith('HE-SEALED-006 set vsyn shares its world slice or corpus with vsyn-next, still in sealed custody and not retired;');
      expect(git(f.repo, 'for-each-ref', 'refs/sealed')).toBe('');
      const split = clone();
      git(split, 'remote', 'set-url', 'origin', fork);
      git(split, 'remote', 'set-url', '--push', 'origin', f.bare);
      expect(() => refuseSetState(split, SET, 'Nothing was decrypted', f.repo, 'origin')).toThrow(/^HE-SEALED-013 the custody remote origin of .* has more than one fetch or push URL/);
      const raw = clone();
      git(raw, 'config', `url.${fork}.insteadOf`, f.bare);
      expect(() => refuseSetState(raw, SET, 'Nothing was decrypted', f.repo, f.bare)).toThrow(/^HE-SEALED-013 the custody remote .* has more than one fetch or push URL/);
      git(f.repo, 'remote', 'set-url', 'origin', f.bare);
      git(f.repo, 'config', `url.${fork}.insteadOf`, f.bare);
      expect(regeneration()).toMatch(/^HE-SEALED-013 the public checkout .* rewrites the custody remote URL/);
    } finally {
      spawnSync('git', ['config', '--unset-all', `url.${fork}.insteadOf`], { cwd: f.repo, env: SCRUBBED_ENV });
      git(f.repo, 'remote', 'set-url', 'origin', f.bare);
      resetToMain();
      rmSync(dirname(dirname(sibling('vsyn-next'))), { recursive: true, force: true });
      commitPush(f, 'remove the synthetic reseal');
    }
  }, 120_000);

  test('a reseal that lands on custody while release decrypts stops the released line', async () => {
    let pushes = 0;
    const bundle = await bundleOf('vsyn-racer');
    const raced = await refusedRelease({ beforePush: () => { if (!pushes++) sealOnCustody('vsyn-racer', bundle); } });
    expect(pushes).toBe(1);
    expect(raced).toMatch(/^HE-SEALED-008 set vsyn: vsyn-racer has a bundle on refs\/heads\/custody and no manifest on main or in this checkout that commits to its sha256, .* the manifest is left sealed and the released line was not pushed$/);
    expect(readManifest(heldoutSet(SET, f.repo))!.custody).toBe('sealed');
    expect(readAccessLog(clone()).filter((e) => e.set === SET).map((e) => e.event)).not.toContain('released');
    resetToMain();
  }, 120_000);

  test('a set sealed on custody whose manifest is not on main blocks release and regeneration until it is', async () => {
    sealOnCustody('vsyn-pending', await bundleOf('vsyn-pending'));
    expect(await refusedRelease(missingIdentity())).toBe('HE-SEALED-008 set vsyn: vsyn-pending, vsyn-racer have a bundle on refs/heads/custody and no manifest on main or in this checkout that commits to their sha256, so whether they share the world slice or corpus of vsyn is unknown; releasing vsyn could publish that set\'s content. Release it once those manifests are on main and in this checkout. Nothing was decrypted or written');
    successor('vsyn-racer', 'retired', bundles.get('vsyn-racer'));
    commitPush(f, 'the raced reseal reaches main, retired');
    expect(regeneration()).toBe('HE-SEALED-006 set vsyn: vsyn-pending has a bundle on refs/heads/custody and no manifest on main or in this checkout that commits to its sha256, so whether it shares the world slice or corpus of vsyn is unknown; a backup of vsyn could hold that set\'s content, so run this once that manifest is on main. Nothing was decrypted');
    // a malformed manifest on main counts as none
    mkdirSync(dirname(sibling('vsyn-pending')), { recursive: true });
    writeFileSync(sibling('vsyn-pending'), '{ not json');
    commitPush(f, 'a malformed manifest for the pending reseal');
    expect(regeneration()).toStartWith('HE-SEALED-006 set vsyn: vsyn-pending has a bundle on refs/heads/custody and no manifest on main or in this checkout that commits to its sha256');
    writeFileSync(sibling('vsyn-pending'), 'null');
    commitPush(f, 'a manifest that is JSON null');
    expect(regeneration()).toStartWith('HE-SEALED-006 set vsyn: vsyn-pending has a bundle on refs/heads/custody and no manifest on main or in this checkout that commits to its sha256');
    // a manifest that does not commit to the bundle on custody counts as none: an empty one in the checkout, or one naming another bundle on main
    writeFileSync(sibling('vsyn-pending'), '{}');
    expect(regeneration()).toStartWith('HE-SEALED-006 set vsyn: vsyn-pending has a bundle on refs/heads/custody and no manifest on main or in this checkout that commits to its sha256');
    successor('vsyn-pending', 'retired', await bundleOf('vsyn-other'));
    commitPush(f, 'a manifest that commits to another bundle');
    expect(regeneration()).toStartWith('HE-SEALED-006 set vsyn: vsyn-pending has a bundle on refs/heads/custody and no manifest on main or in this checkout that commits to its sha256');
    // its manifest, retired, on main: neither check refuses for it any more
    successor('vsyn-pending', 'retired', bundles.get('vsyn-pending'));
    commitPush(f, 'the pending reseal reaches main, retired');
    expect(await refusedRelease(missingIdentity())).not.toMatch(/no manifest on main|shares its world slice/);
    expect(regeneration()).toBe('no refusal');
  }, 120_000);

  test('a successor named by replaced_by blocks release and regeneration whatever its digests, and so does a manifest on main that does not parse', async () => {
    const own = sibling(SET);
    const original = readFileSync(own, 'utf8');
    try {
      writeFileSync(own, JSON.stringify({ ...JSON.parse(original), status: 'retired', replaced_by: 'vsyn-heir' }, null, 2) + '\n');
      mkdirSync(dirname(sibling('vsyn-heir')), { recursive: true });
      writeFileSync(sibling('vsyn-heir'), JSON.stringify({ schema_version: 1, custody: 'sealed', sealed: { world_slice_sha256: '7'.repeat(64), heldout_corpus_sha256: '6'.repeat(64) }, status: 'open' }));
      commitPush(f, 'vsyn retired as replaced by a reseal with other digests');
      const heir = "vsyn-heir (vsyn's replaced_by chain names it)";
      expect(await refusedRelease(missingIdentity())).toBe(`HE-SEALED-008 set vsyn shares its world slice or corpus with ${heir}, still in sealed custody and not retired; releasing vsyn would publish that set's content. Release it after the retirement of ${heir} is on main and in this checkout. Nothing was decrypted or written`);
      expect(regeneration()).toBe(`HE-SEALED-006 set vsyn shares its world slice or corpus with ${heir}, still in sealed custody and not retired; a backup of vsyn holds that set's content, so name it with --set vsyn-heir. Nothing was decrypted`);
      // a checkout from before that reached main still sees it, through main fetched from the custody remote
      git(f.repo, 'reset', '-q', '--hard', 'HEAD~1');
      expect(regeneration()).toStartWith(`HE-SEALED-006 set vsyn shares its world slice or corpus with ${heir}`);
      resetToMain();
      writeFileSync(own, original);
      rmSync(dirname(dirname(sibling('vsyn-heir'))), { recursive: true, force: true });
      commitPush(f, 'undo the synthetic replacement');
      mkdirSync(dirname(sibling('vsyn-broken')), { recursive: true });
      writeFileSync(sibling('vsyn-broken'), '{ not json');
      commitPush(f, 'a manifest that does not parse, for a set with no bundle');
      git(f.repo, 'reset', '-q', '--hard', 'HEAD~1');
      expect(regeneration()).toBe('HE-SEALED-006 set vsyn shares its world slice or corpus with vsyn-broken (its MANIFEST.json does not parse or validate: it is not JSON; it counts as live until it does), still in sealed custody and not retired; a backup of vsyn holds that set\'s content, so fix the MANIFEST.json named above first. Nothing was decrypted');
      resetToMain();
      rmSync(dirname(dirname(sibling('vsyn-broken'))), { recursive: true, force: true });
      commitPush(f, 'undo the manifest that does not parse');
      writeFileSync(own, JSON.stringify({ ...JSON.parse(original), replaced_by: null }, null, 2) + '\n');
      commitPush(f, "vsyn's own manifest does not validate on main");
      git(f.repo, 'reset', '-q', '--hard', 'HEAD~1');
      const self = 'set vsyn: its own MANIFEST.json on main or in this checkout does not parse or validate, so it counts as live; fix it first.';
      expect(await refusedRelease(missingIdentity())).toBe(`HE-SEALED-008 ${self} Nothing was decrypted or written`);
      expect(regeneration()).toBe(`HE-SEALED-006 ${self} Nothing was decrypted`);
    } finally {
      resetToMain();
      writeFileSync(own, original);
      for (const s of ['vsyn-heir', 'vsyn-broken']) rmSync(dirname(dirname(sibling(s))), { recursive: true, force: true });
      if (git(f.repo, 'status', '--porcelain')) commitPush(f, 'undo the synthetic replacement');
    }
    expect(regeneration()).toBe('no refusal');
  }, 120_000);
});

describe('a remote helper never runs from a custody network call', () => {
  let f: Fixture;
  let bin = '', marker = '', path = '';
  beforeAll(async () => {
    f = await makeFixture(2);
    bin = join(f.tmp, 'helper-bin');
    marker = join(f.tmp, 'helper-ran');
    mkdirSync(bin);
    writeFileSync(join(bin, 'git-remote-evil'), `#!/bin/sh\necho "$@" >> '${marker}'\nexit 1\n`);
    chmodSync(join(bin, 'git-remote-evil'), 0o755);
    path = process.env.PATH ?? '';
    process.env.PATH = `${bin}:${path}`;
  }, 120_000);
  afterAll(() => { process.env.PATH = path; if (f) rmSync(f.tmp, { recursive: true, force: true }); });

  test('the public checkout\'s origin as a helper URL: the shared-set check never fetches it and open.ts refuses it before fetching', async () => {
    git(f.repo, 'remote', 'set-url', 'origin', 'evil::harness-evals');
    try {
      expect(() => refuseSetState(cloneCustody(f, 'helper-check'), SET, 'Nothing was decrypted', f.repo, 'origin')).not.toThrow();
      await expect(openRun({ repo: f.repo, prereg: 'docs/benchmarks/none/prereg.json', ...co(f), out: join(f.work, 'helper-root'), log: () => undefined })).rejects.toThrow(/^HE-SEALED-013 the custody remote URL evil::harness-evals is not garrytan\/harness-evals/);
      expect(existsSync(marker)).toBe(false);
    } finally {
      git(f.repo, 'remote', 'set-url', 'origin', f.bare);
    }
  }, 120_000);

  test('a custody clone whose remote is a helper URL is refused before any git network call', () => {
    const c = cloneCustody(f, 'helper-clone');
    git(c, 'remote', 'set-url', 'origin', 'evil::harness-evals');
    expect(() => refuseSetState(c, SET, 'Nothing was decrypted', f.repo, 'origin')).toThrow(/^HE-SEALED-013 the custody remote URL evil::harness-evals is not garrytan\/harness-evals/);
    expect(() => syncCustody(c, 'origin')).toThrow(/^HE-SEALED-013/);
    expect(existsSync(marker)).toBe(false);
  });

  test('netEnv: under it git refuses a remote helper, even one the git config allows, and still reaches a local repository', () => {
    git(f.repo, 'config', 'protocol.evil.allow', 'always');
    try {
      const r = spawnSync('git', ['ls-remote', 'evil::harness-evals'], { cwd: f.repo, encoding: 'utf8', env: netEnv() });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("transport 'evil' not allowed");
      expect(existsSync(marker)).toBe(false);
    } finally {
      git(f.repo, 'config', '--unset', 'protocol.evil.allow');
    }
    expect(spawnSync('git', ['ls-remote', f.bare, 'refs/heads/main'], { cwd: f.repo, encoding: 'utf8', env: netEnv() }).status).toBe(0);
  });
});
