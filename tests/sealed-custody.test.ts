// internal-task phase 3, sealed custody: the bundle format and crypto (wrong key, corrupt bundle, unsafe tar paths, cleanup), the
// keyless sealed check, the custodian's open step (admission against the access log, compare-and-push, idempotent resume,
// no refund after withdrawal, one confirmatory opening per candidate, stale roots, main amending, superseding or changing the
// sealed block during admission, a release refused while an opened run has no export, a release racing an opening and an
// opening after release), run.ts's sealed refusals, and the
// build input selection for the gbrain brains (a held-out brain built from the sealed slice holds the slice's pages, not the
// public world's held-out pages). Every key is generated here and thrown away.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { corpusDigest, decryptWith, encryptTo, mergeWorld, renderWorld, packTar, receiptProblems, sealedImageProblem, sha256, sliceProblems, unpackTar, verifySealedRoot, readReceipt, type WorldSlice } from '../runner/heldout/sealed.ts';
import { checkOpenings, claimProblems, publishedOpenings } from '../runner/heldout/openings.ts';
import { heldoutSet, readManifest, sealedProblems } from '../scripts/seal-heldout.ts';
import { closeRoot, openRun } from '../scripts/sealed/open.ts';
import { checkPrivate, compareAndPush, custodyClone, readAccessLog, validateCustodyChange } from '../scripts/sealed/custody.ts';
import { decide, entriesDigest, exportRun, leakScan } from '../scripts/sealed/export.ts';
import { sealSet } from '../scripts/sealed/seal.ts';
import { releaseSet } from '../scripts/sealed/release.ts';
import { pageList, buildBrain } from '../gbrain/build-brain.ts';
import type { World } from '../world/types.ts';
import { candidate, cloneCustody, co, commitPush, ENV_VALUE, fakeGh, git, makeFixture, manifestPath, register, ROOT, SECRETS, SET, setRow, sliceDoc, type Fixture } from './sealed-fixture.ts';
import { identityFileText } from '../scripts/sealed/identity.ts';

const tmps: string[] = [];
afterAll(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'he-sealed-t-')); tmps.push(d); return d; };
const enc = (s: string) => new TextEncoder().encode(s);

/** A raw ustar header, for archives packTar refuses to write. */
function rawTar(path: string, type = '0', body = 'x'): Uint8Array {
  const h = new Uint8Array(512);
  const put = (s: string, at: number) => h.set(enc(s), at);
  put(path, 0); put('0000644\0', 100); put('0000000\0', 108); put('0000000\0', 116);
  put(body.length.toString(8).padStart(11, '0') + '\0', 124); put('00000000000\0', 136); put('        ', 148); put(type, 156); put('ustar\0', 257); put('00', 263);
  let sum = 0; for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const data = new Uint8Array(512); data.set(enc(body));
  const out = new Uint8Array(512 * 4); out.set(h, 0); out.set(data, 512);
  return out;
}

describe('bundle format and crypto', () => {
  test('a bundle round-trips, is reproducible, and a wrong key or a corrupt or truncated bundle fails without naming the key', async () => {
    const id = await generateX25519Identity();
    const other = await generateX25519Identity();
    const entries = [{ path: 'b/two.txt', data: enc('two') }, { path: 'a/one.txt', data: enc('one') }];
    const tar = packTar(entries);
    expect(sha256(packTar([...entries].reverse()))).toBe(sha256(tar));
    const ct = await encryptTo(await identityToRecipient(id), tar);
    expect(unpackTar(await decryptWith(id, ct)).map((e) => [e.path, new TextDecoder().decode(e.data)])).toEqual([['a/one.txt', 'one'], ['b/two.txt', 'two']]);
    for (const bad of [() => decryptWith(other, ct), () => { const c = ct.slice(); c[c.length - 20] ^= 0xff; return decryptWith(id, c); }, () => decryptWith(id, ct.slice(0, ct.length - 40))]) {
      const err = await bad().then(() => null, (e: Error) => e);
      expect(err?.message).toContain('did not decrypt');
      expect(err!.message).not.toContain(id);
      expect(err!.message).not.toContain(other);
    }
    await expect(decryptWith('AGE-SECRET-KEY-1NOTAKEY', ct)).rejects.toThrow('malformed');
  });

  test('unpacking refuses unsafe paths, links, duplicates, bad checksums and truncation; packing refuses unsafe paths', () => {
    for (const p of ['../escape.txt', '/etc/passwd', 'a/../../b', 'a//b', './a']) expect(() => unpackTar(rawTar(p))).toThrow(/unsafe path/);
    expect(() => unpackTar(rawTar('link', '2'))).toThrow(/not a regular file/);
    expect(() => unpackTar(rawTar('dev', '3'))).toThrow(/not a regular file/);
    const one = rawTar('dup.txt');
    const dup = new Uint8Array(512 * 6); dup.set(one.subarray(0, 1024), 0); dup.set(one.subarray(0, 1024), 1024);
    expect(() => unpackTar(dup)).toThrow(/duplicate/);
    const bad = rawTar('ok.txt'); bad[0] = 'p'.charCodeAt(0);
    expect(() => unpackTar(bad)).toThrow(/checksum/);
    expect(() => unpackTar(packTar([{ path: 'a.txt', data: enc('a') }]).slice(0, 700))).toThrow(/truncated/);
    expect(() => packTar([{ path: '../x', data: enc('x') }])).toThrow(/unsafe/);
    expect(unpackTar(packTar([{ path: 'a/' + 'x'.repeat(120) + '/y.txt', data: enc('long') }]))[0]!.path).toBe('a/' + 'x'.repeat(120) + '/y.txt');
  });

  test('corpusDigest equals the shell pipeline gbrain/Dockerfile and build-gbrain-image.sh run', () => {
    const d = scratch();
    mkdirSync(join(d, 'heldout', 'chats'), { recursive: true });
    writeFileSync(join(d, 'heldout', 'chats', 'b.md'), 'b\n');
    writeFileSync(join(d, 'heldout', 'a.md'), 'a\n');
    writeFileSync(join(d, 'heldout', 'Z.md'), 'z\n');
    const sh = spawnSync('bash', ['-c', "cd \"$1\" && find . -type f -printf '%P\\n' | LC_ALL=C sort | xargs -r -d '\\n' sha256sum | sha256sum | cut -d' ' -f1", 'x', d], { encoding: 'utf8' });
    expect(corpusDigest(d)).toBe(sh.stdout.trim());
    const empty = scratch();
    const sh2 = spawnSync('bash', ['-c', "cd \"$1\" && find . -type f -printf '%P\\n' | LC_ALL=C sort | xargs -r -d '\\n' sha256sum | sha256sum | cut -d' ' -f1", 'x', empty], { encoding: 'utf8' });
    expect(corpusDigest(empty)).toBe(sh2.stdout.trim());
  });

  test('a world.json-format slice replaces every public held-out record and nothing else; changed meta, a changed public record or a colliding id is refused', () => {
    const pub = JSON.parse(readFileSync(join(ROOT, 'world', 'seed', 'world.json'), 'utf8')) as World;
    const slice = sliceDoc() as unknown as WorldSlice;
    expect(sliceProblems(slice, pub)).toEqual([]);
    const merged = mergeWorld(pub, slice);
    expect(merged.channels.filter((c) => c.split === 'heldout').map((c) => c.name)).toEqual(['syn-vault']);
    expect(merged.channels.filter((c) => c.split !== 'heldout')).toEqual(pub.channels.filter((c) => c.split !== 'heldout'));
    expect(merged.members).toEqual(pub.members);
    const devId = pub.channels.find((c) => c.split === 'dev')!.id;
    expect(sliceProblems({ channels: [{ id: devId, split: 'heldout' }] }, pub)).toEqual([`slice: channels ${devId} collides with a public channels record outside the held-out split`]);
    expect(sliceProblems({ messages: [{ id: 'x', split: 'dev' }] }, pub)[0]).toContain('is not the public world\'s record; a slice adds held-out records only');
    // world.json format: the whole world is accepted only with the public world's meta and its other records unchanged
    expect(JSON.parse(readFileSync(join(ROOT, 'world', 'seed', 'world.json'), 'utf8')).world_id).toBe((slice as Record<string, unknown>).world_id);
    expect(sliceProblems({ ...slice, today: '2030-01-01' }, pub)).toEqual(['slice: today differs from the public world\'s; a slice is written against the public world']);
    const edited = structuredClone(slice) as unknown as World;
    const devMember = edited.members[0]! as unknown as Record<string, unknown>;
    devMember.name = 'Someone Else';
    expect(sliceProblems(edited as unknown as WorldSlice, pub)[0]).toContain(`slice: members ${devMember.id} has split`);
    expect(sliceProblems({ ...slice, extra: [] } as unknown as WorldSlice, pub)[0]).toContain('slice: unknown key extra');
    // a file of held-out records only merges to the same world as the whole world.json
    const heldOnly = Object.fromEntries(Object.entries(slice).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as Array<{ split: string }>).filter((r) => r.split === 'heldout')])) as unknown as WorldSlice;
    expect(renderWorld(mergeWorld(pub, heldOnly))).toBe(renderWorld(merged));
  });
});

describe('the custodian', () => {
  let f: Fixture;
  const A = { runId: 'syn-a', dir: '2026-11-01-syn-a', label: 'confirmatory' as const, candidate: candidate('a') };

  test('seal writes commitments only; the keyless sealed check passes and refuses plaintext or a missing commitment', async () => {
    f = await makeFixture(2);
    tmps.push(f.tmp);
    const set = heldoutSet(SET, f.repo);
    const m = readManifest(set)!;
    expect(m.custody).toBe('sealed');
    expect(m.tasks).toEqual([]);
    expect(m.files).toEqual({});
    expect(m.sealed!.task_count).toBe(2);
    expect(sealedProblems(m, set)).toEqual([]);
    expect(readFileSync(set.manifest, 'utf8')).not.toContain('sx-01');
    expect(readFileSync(set.manifest, 'utf8')).not.toContain(SECRETS.hiddenFact);
    writeFileSync(join(set.dir, 'stray.toml'), 'x');
    expect(sealedProblems(m, set).join('\n')).toContain('plaintext in a sealed set: 1 file(s)');
    rmSync(join(set.dir, 'stray.toml'));
    const { heldout_corpus_sha256: _c, ...noCorpus } = m.sealed!;
    expect(sealedProblems({ ...m, sealed: noCorpus as typeof m.sealed }, set)).toEqual(['sealed.heldout_corpus_sha256 must be 64 hex characters (got undefined)']);
    await expect(sealSet({ repo: f.repo, set: SET, tasks: join(f.repo, 'docs'), slice: join(f.plain, 'slice.json'), custody: f.custody, recipient: f.recipient, gh: f.gh })).rejects.toThrow('inside the public checkout');
    // a --tasks outside the checkout that links into it is inside it too
    symlinkSync(join(f.repo, 'docs'), join(f.plain, 'docs-link'));
    await expect(sealSet({ repo: f.repo, set: SET, tasks: join(f.plain, 'docs-link'), slice: join(f.plain, 'slice.json'), custody: f.custody, recipient: f.recipient, gh: f.gh })).rejects.toThrow('inside the public checkout');
    rmSync(join(f.plain, 'docs-link'));
    // a checkout directory whose name starts with two dots is inside it too
    mkdirSync(join(f.repo, '..private'));
    await expect(sealSet({ repo: f.repo, set: SET, tasks: join(f.repo, '..private'), slice: join(f.plain, 'slice.json'), custody: f.custody, recipient: f.recipient, gh: f.gh })).rejects.toThrow('inside the public checkout');
    rmSync(join(f.repo, '..private'), { recursive: true });
    // a set named after a public tree would put runner/, tasks/ or docs/ on the custody branch, where every clone is refused
    for (const name of ['runner', 'tasks', 'docs']) await expect(sealSet({ repo: f.repo, set: name, tasks: join(f.plain, 'heldout'), slice: join(f.plain, 'slice.json'), custody: f.custody, recipient: f.recipient, gh: f.gh })).rejects.toThrow(/^HE-SEALED-006 --task-set must name a set other than v0.1, runner, tasks or docs/);
    // a symbolic link would be packed but left out of the corpus commitment, so open could never verify the set
    symlinkSync(join(f.plain, 'slice.json'), join(f.plain, 'corpus', 'heldout', 'linked.md'));
    await expect(sealSet({ repo: f.repo, set: 'vlink', tasks: join(f.plain, 'heldout'), slice: join(f.plain, 'slice.json'), corpus: join(f.plain, 'corpus'), custody: f.custody, recipient: f.recipient, gh: f.gh })).rejects.toThrow(/^HE-SEALED-006 "corpus\/heldout\/linked.md" is a symbolic link/);
    rmSync(join(f.plain, 'corpus', 'heldout', 'linked.md'));
    // a directory link is refused without being followed, so a link loop gets the same refusal
    symlinkSync('..', join(f.plain, 'corpus', 'heldout', 'notes', 'loop'));
    await expect(sealSet({ repo: f.repo, set: 'vlink', tasks: join(f.plain, 'heldout'), slice: join(f.plain, 'slice.json'), corpus: join(f.plain, 'corpus'), custody: f.custody, recipient: f.recipient, gh: f.gh })).rejects.toThrow(/^HE-SEALED-006 "corpus\/heldout\/notes\/loop" is a symbolic link/);
    rmSync(join(f.plain, 'corpus', 'heldout', 'notes', 'loop'));
    // a corpus with no page would commit an empty corpus digest
    mkdirSync(join(f.plain, 'empty-corpus', 'heldout'), { recursive: true });
    await expect(sealSet({ repo: f.repo, set: 'vempty', tasks: join(f.plain, 'heldout'), slice: join(f.plain, 'slice.json'), corpus: join(f.plain, 'empty-corpus'), custody: f.custody, recipient: f.recipient, gh: f.gh })).rejects.toThrow(/^HE-SEALED-006 --corpus \S+ holds no page under heldout\//);
    rmSync(join(f.plain, 'empty-corpus'), { recursive: true });
    // the bundle is on the custody branch with a "sealed" line, and the manifest names the custody ref, not main
    expect(m.sealed!.custody_ref).toBe('refs/heads/custody');
    expect(m.sealed!.custody_repo).toBe('garrytan/harness-evals');
    const c = cloneCustody(f, 'check-seal');
    expect(sha256(readFileSync(join(c, m.sealed!.bundle)))).toBe(m.sealed!.bundle_sha256);
    expect(readAccessLog(c).map((e) => [e.event, e.set])).toEqual([['sealed', SET]]);
    expect(git(c, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n').sort()).toEqual(['README.md', 'access-log.jsonl', 'escrow/identity.age', `${SET}/bundle.tar.age`]);
    expect(git(f.repo, 'ls-tree', '-r', '--name-only', 'origin/main')).not.toContain('.age');
    // a second seal of the same set never replaces the bundle on the custody branch
    await expect(sealSet({ repo: f.repo, set: SET, tasks: join(f.plain, 'heldout'), slice: join(f.plain, 'slice.json'), corpus: join(f.plain, 'corpus'), custody: f.custody, recipient: f.recipient, gh: f.gh })).rejects.toThrow(/plaintext of set|already holds|opened row/);
    git(f.repo, 'checkout', '-q', '--', '.');
  }, 60_000);

  test('open admits a planned row, pushes the access-log line before decrypting, and writes a verified root outside the checkout', async () => {
    register(f, A);
    const out = join(f.work, 'root-a');
    const r = await openRun({ repo: f.repo, prereg: `docs/benchmarks/${A.dir}/prereg.json`, ...co(f), out, log: () => undefined });
    expect(r.resumed).toBe(false);
    expect(r.opening).toBe(1);
    const log = readAccessLog(cloneCustody(f, 'check-1'));
    expect(log.map((e) => [e.event, e.run_id, e.label, e.candidate_sha256])).toEqual([['sealed', '*', undefined, undefined], ['opened', 'syn-a', 'confirmatory', A.candidate]]);
    expect(r.receipt.access.event_sha256).toBe(sha256(readFileSync(join(cloneCustody(f, 'check-2'), 'access-log.jsonl'), 'utf8').trim().split('\n').pop()!));
    expect(r.receipt.access.custody_ref).toBe('refs/heads/custody');
    expect(r.receipt.public_ref).toBe('origin/main');
    expect(r.receipt.public_commit).toBe(git(f.repo, 'rev-parse', 'origin/main'));
    expect(r.receipt.access.custody_commit).toBe(git(cloneCustody(f, 'check-2b'), 'rev-parse', 'HEAD'));
    expect(statSync(join(out, 'tasks', 'multiuser', SET, 'heldout', 'sx-01-vault-ask', 'task.toml')).mode & 0o777).toBe(0o600);
    expect(verifySealedRoot(out, r.receipt, f.repo)).toEqual([]);
    expect(receiptProblems(r.receipt, { run_id: 'syn-a', prereg_sha256: r.receipt.prereg_sha256, set: SET, candidate_sha256: A.candidate }, readManifest(heldoutSet(SET, f.repo)))).toEqual([]);
    const world = JSON.parse(readFileSync(join(out, 'world', 'world.json'), 'utf8')) as World;
    expect(world.channels.filter((c) => c.split === 'heldout').map((c) => c.name)).toEqual(['syn-vault']);
    expect(existsSync(join(f.repo, 'tasks', 'multiuser', SET, 'heldout', 'sx-01-vault-ask'))).toBe(false);
    // tampering with the root is caught
    writeFileSync(join(out, 'tasks', 'multiuser', SET, 'heldout', 'sx-01-vault-ask', 'oracle.json'), '{}');
    expect(verifySealedRoot(out, r.receipt, f.repo).join('\n')).toContain('the sealed task tree digest');
  }, 60_000);

  test('the same run id resumes idempotently; a changed candidate under it is refused', async () => {
    const out = join(f.work, 'root-a');
    const r = await openRun({ repo: f.repo, prereg: `docs/benchmarks/${A.dir}/prereg.json`, ...co(f), out, log: () => undefined });
    expect(r.resumed).toBe(true);
    expect(verifySealedRoot(out, r.receipt, f.repo)).toEqual([]);
    const log = readAccessLog(cloneCustody(f, 'check-3'));
    expect(log.map((e) => e.event)).toEqual(['sealed', 'opened', 'resumed']);
    expect(r.receipt.access.resumed).toBe(true);
    // the same run id with another candidate
    const p = join(f.repo, 'docs', 'benchmarks', A.dir, 'prereg.json');
    const saved = readFileSync(p, 'utf8');
    const changed = JSON.parse(saved); changed.heldout.candidate_sha256 = candidate('a2');
    writeFileSync(p, JSON.stringify(changed, null, 2) + '\n');
    setRow(f, { run_id: 'syn-a', candidate_sha256: candidate('a2') });
    commitPush(f, 'change candidate under syn-a');
    await expect(openRun({ repo: f.repo, prereg: `docs/benchmarks/${A.dir}/prereg.json`, ...co(f), out: join(f.work, 'root-a2'), log: () => undefined })).rejects.toThrow(/was opened with candidate_sha256/);
    writeFileSync(p, saved);
    setRow(f, { run_id: 'syn-a', candidate_sha256: A.candidate });
    commitPush(f, 'restore syn-a');
  }, 60_000);

  test('one confirmatory opening per candidate; a wrong identity, a rotated key that was not re-escrowed, a missing drive copy and a public repository are refused before anything is logged', async () => {
    register(f, { runId: 'syn-b', dir: '2026-11-02-syn-b', label: 'confirmatory', candidate: A.candidate });
    await expect(openRun({ repo: f.repo, prereg: 'docs/benchmarks/2026-11-02-syn-b/prereg.json', ...co(f), out: join(f.work, 'root-b'), log: () => undefined })).rejects.toThrow(/already had its confirmatory opening/);
    const other = await generateX25519Identity();
    const otherPath = join(scratch(), 'other.age-key');
    writeFileSync(otherPath, identityFileText(other, await identityToRecipient(other), 'x'));
    const before = readAccessLog(cloneCustody(f, 'check-4')).length;
    const open = (extra: Record<string, unknown>) => openRun({ repo: f.repo, prereg: 'docs/benchmarks/2026-11-02-syn-b/prereg.json', ...co(f), out: join(f.work, 'root-b'), log: () => undefined, ...extra });
    await expect(open({ identityPath: otherPath })).rejects.toThrow(/HE-SEALED-012 the drive copy .* does not derive the custody recipient/);
    await expect(open({ env: { UBICLOUD_API_KEY: 'a rotated throwaway value' } })).rejects.toThrow(/HE-SEALED-012 the escrow .* does not decrypt with the passphrase derived from the current UBICLOUD_API_KEY; if the key was rotated, run bun scripts\/sealed\/keygen.ts --re-escrow/);
    await expect(open({ env: {} })).rejects.toThrow(/HE-SEALED-012 UBICLOUD_API_KEY is not set/);
    await expect(open({ identityPath: join(f.tmp, 'drive', 'gone.age-key') })).rejects.toThrow(/HE-SEALED-012 the drive copy of the custody identity .* is missing; restore it from the escrow with bun scripts\/sealed\/keygen.ts --restore/);
    await expect(open({ gh: fakeGh(f.tmp, 'false') })).rejects.toThrow(/HE-SEALED-013 garrytan\/harness-evals is not private/);
    await expect(open({ gh: fakeGh(f.tmp, null) })).rejects.toThrow(/HE-SEALED-013 could not read the visibility of garrytan\/harness-evals .*an unknown visibility counts as public/);
    await expect(open({ gh: join(f.tmp, 'no-such-gh') })).rejects.toThrow(/HE-SEALED-013 could not read the visibility .*did not run/);
    expect(readAccessLog(cloneCustody(f, 'check-5')).length).toBe(before);
    expect(existsSync(join(f.work, 'root-b'))).toBe(false);
    setRow(f, { run_id: 'syn-b', status: 'withdrawn', reason: 'refused at custody; never opened' });
    commitPush(f, 'withdraw syn-b');
  }, 60_000);

  test('a root inside a checkout, or another run\'s root, is refused; close removes only an opened root', async () => {
    register(f, { runId: 'syn-c', dir: '2026-11-03-syn-c', label: 'dev', reason: 'synthetic dev opening', candidate: candidate('c') });
    const prereg = 'docs/benchmarks/2026-11-03-syn-c/prereg.json';
    await expect(openRun({ repo: f.repo, prereg, ...co(f), out: join(f.repo, 'leak'), log: () => undefined })).rejects.toThrow(/inside a git work tree/);
    await expect(openRun({ repo: f.repo, prereg, ...co(f), out: join(f.work, 'root-a'), log: () => undefined })).rejects.toThrow(/holds the opened root of run syn-a/);
    const plain = join(f.work, 'not-a-root'); mkdirSync(plain); writeFileSync(join(plain, 'x'), 'x');
    expect(() => closeRoot(plain)).toThrow(/not an opened root/);
    const r = await openRun({ repo: f.repo, prereg, ...co(f), out: join(f.work, 'root-c'), log: () => undefined });
    expect(r.receipt.label).toBe('dev');
    // a dev opening resumes like a confirmatory one, before and after its row is marked opened on main
    const again = await openRun({ repo: f.repo, prereg, ...co(f), out: join(f.work, 'root-c'), log: () => undefined });
    expect([again.resumed, again.receipt.label]).toEqual([true, 'dev']);
    setRow(f, { run_id: 'syn-c', status: 'opened' });
    commitPush(f, 'syn-c opened');
    const afterRow = await openRun({ repo: f.repo, prereg, ...co(f), out: join(f.work, 'root-c'), log: () => undefined });
    expect([afterRow.resumed, afterRow.receipt.label]).toEqual([true, 'dev']);
    expect(readAccessLog(cloneCustody(f, 'check-c')).filter((e) => e.run_id === 'syn-c').map((e) => e.event)).toEqual(['opened', 'resumed', 'resumed']);
    writeFileSync(join(f.work, 'receipt-c.json'), readFileSync(join(r.root, 'opening-receipt.json')));
    closeRoot(r.root);
    expect(existsSync(r.root)).toBe(false);
  }, 60_000);

  test('a withdrawn row never refunds an opening that was opened, in custody and in the CI check', async () => {
    // budget 2: syn-a used one. syn-d takes the second; then syn-a is withdrawn on main and syn-e asks for a third.
    register(f, { runId: 'syn-d', dir: '2026-11-04-syn-d', label: 'confirmatory', candidate: candidate('d') });
    await openRun({ repo: f.repo, prereg: 'docs/benchmarks/2026-11-04-syn-d/prereg.json', ...co(f), out: join(f.work, 'root-d'), log: () => undefined });
    // marking the row opened on main and resuming counts no second opening (syn-e below still sees two)
    setRow(f, { run_id: 'syn-d', status: 'opened' });
    commitPush(f, 'syn-d opened');
    const resumedD = await openRun({ repo: f.repo, prereg: 'docs/benchmarks/2026-11-04-syn-d/prereg.json', ...co(f), out: join(f.work, 'root-d'), log: () => undefined });
    expect([resumedD.resumed, resumedD.receipt.label]).toEqual([true, 'confirmatory']);
    setRow(f, { run_id: 'syn-a', status: 'withdrawn', reason: 'withdrawn after the opening' });
    register(f, { runId: 'syn-e', dir: '2026-11-05-syn-e', label: 'confirmatory', candidate: candidate('e') });
    const err = await openRun({ repo: f.repo, prereg: 'docs/benchmarks/2026-11-05-syn-e/prereg.json', ...co(f), out: join(f.work, 'root-e'), log: () => undefined }).then(() => null, (e: Error) => e);
    expect(err?.message).toContain('has had 2 confirmatory opening(s) (syn-a, syn-d) against a budget of 2; withdrawn or superseded rows never refund');
    // a published receipt for syn-a with its row withdrawn is a CI problem
    const pub = join(f.repo, 'docs', 'benchmarks', A.dir, 'sealed-results');
    mkdirSync(pub, { recursive: true });
    writeFileSync(join(pub, 'opening-receipt.json'), readFileSync(join(f.work, 'root-a', 'opening-receipt.json')));
    expect(publishedOpenings(f.repo).get('syn-a')).toBe(`docs/benchmarks/${A.dir}/sealed-results/opening-receipt.json`);
    expect(checkOpenings(f.repo, [])).toContain(`set ${SET}: syn-a is withdrawn but its sealed opening receipt is published at docs/benchmarks/${A.dir}/sealed-results/opening-receipt.json; an opening that was opened stays counted (a withdrawn or superseded row never refunds it), so its row says opened`);
    setRow(f, { run_id: 'syn-a', status: 'superseded', reason: 'superseded after the opening' });
    expect(checkOpenings(f.repo, [])).toContain(`set ${SET}: syn-a is superseded but its sealed opening receipt is published at docs/benchmarks/${A.dir}/sealed-results/opening-receipt.json; an opening that was opened stays counted (a withdrawn or superseded row never refunds it), so its row says opened`);
    setRow(f, { run_id: 'syn-a', status: 'withdrawn', reason: 'withdrawn after the opening' });
    rmSync(pub, { recursive: true });
    // the same holds for a dev opening
    const pubC = join(f.repo, 'docs', 'benchmarks', '2026-11-03-syn-c', 'sealed-results');
    mkdirSync(pubC, { recursive: true });
    writeFileSync(join(pubC, 'opening-receipt.json'), readFileSync(join(f.work, 'receipt-c.json')));
    for (const status of ['withdrawn', 'superseded']) {
      setRow(f, { run_id: 'syn-c', status, reason: `${status} after the opening` });
      expect(checkOpenings(f.repo, [])).toContain(`set ${SET}: syn-c is ${status} but its sealed opening receipt is published at docs/benchmarks/2026-11-03-syn-c/sealed-results/opening-receipt.json; an opening that was opened stays counted (a withdrawn or superseded row never refunds it), so its row says opened`);
    }
    setRow(f, { run_id: 'syn-c', status: 'opened', reason: 'synthetic dev opening' });
    rmSync(pubC, { recursive: true });
  }, 90_000);

  test('compare-and-push: when another custodian step lands between the read and the push, the push is rejected and the decision reruns on the new state', () => {
    const a = cloneCustody(f, 'race-a'), b = cloneCustody(f, 'race-b');
    let decisions = 0;
    const r = compareAndPush(a, {
      remote: 'origin', message: () => 'race a',
      decide: () => {
        decisions++;
        if (decisions === 1) compareAndPush(b, { remote: 'origin', message: () => 'race b', decide: () => ({ schema_version: 1, event: 'opened', at: 't', run_id: 'race-b', set: 'race', label: 'confirmatory', custodian: 'b' }) });
        const seen = readAccessLog(a).filter((e) => e.set === 'race').map((e) => e.run_id);
        return { schema_version: 1, event: 'opened', at: 't', run_id: seen.includes('race-b') ? 'race-a-after-b' : 'race-a', set: 'race', label: 'confirmatory', custodian: 'a' };
      },
    });
    expect(decisions).toBe(2);
    expect(r.event.run_id).toBe('race-a-after-b');
    expect(readAccessLog(cloneCustody(f, 'race-check')).filter((e) => e.set === 'race').map((e) => e.run_id)).toEqual(['race-b', 'race-a-after-b']);
  }, 60_000);

  test('run.ts refuses a sealed cell without the root, with a tampered root, with another run\'s receipt, and with a root inside a checkout', () => {
    const run = (args: string[]) => spawnSync('bun', [join(ROOT, 'runner', 'run.ts'), 'dry-run', '--prereg', 'docs/benchmarks/2026-11-04-syn-d/prereg.json', ...args], { cwd: f.repo, encoding: 'utf8' });
    expect(run([]).stderr).toContain('HE-SEALED-001');
    const rootD = join(f.work, 'root-d');
    const ok = run(['--sealed-root', rootD, '--opening-receipt', join(rootD, 'opening-receipt.json')]);
    expect(ok.stderr).toBe('');
    expect(ok.stdout).toContain('SEALED: set vsyn opened for run syn-d');
    expect(run(['--sealed-root', rootD, '--opening-receipt', join(f.work, 'root-c-gone.json')]).stderr).toContain('HE-SEALED-001');
    // syn-a's receipt for syn-d
    const wrong = run(['--sealed-root', rootD, '--opening-receipt', join(f.work, 'root-a', 'opening-receipt.json')]);
    expect(wrong.stderr).toContain('HE-SEALED-003');
    expect(wrong.stderr).toContain('run_id: the opening receipt says "syn-a", expected "syn-d"');
    // a copy of syn-d's root (an admitted row) with one corpus page changed
    const tamperedRoot = join(f.work, 'root-d-tampered');
    spawnSync('cp', ['-r', rootD, tamperedRoot]);
    writeFileSync(join(tamperedRoot, 'corpus', 'heldout', 'chats', 'syn-vault-notes.md'), 'tampered\n');
    const tampered = run(['--sealed-root', tamperedRoot, '--opening-receipt', join(tamperedRoot, 'opening-receipt.json')]);
    expect(tampered.status).toBe(2);
    expect(tampered.stderr).toContain('HE-SEALED-004 the sealed root does not match its opening receipt');
    rmSync(tamperedRoot, { recursive: true });
    // a root that cannot be read prints the error class, never the task path in the file-system message
    const brokenRoot = join(f.work, 'root-d-broken');
    spawnSync('cp', ['-r', rootD, brokenRoot]);
    symlinkSync(join(f.work, 'no-such-file'), join(brokenRoot, 'tasks', 'multiuser', SET, 'heldout', 'sx-01-vault-ask', 'dangling.toml'));
    const broken = run(['--sealed-root', brokenRoot, '--opening-receipt', join(brokenRoot, 'opening-receipt.json')]);
    expect(broken.status).toBe(2);
    expect(broken.stderr).toContain(`HE-SEALED-004 the sealed root ${brokenRoot} could not be read (Error)`);
    expect(broken.stderr).not.toContain('sx-01');
    rmSync(brokenRoot, { recursive: true });
    // plan --out inside the checkout is refused before anything is written
    const planArgs = ['--sealed-root', rootD, '--opening-receipt', join(rootD, 'opening-receipt.json')];
    const planInside = spawnSync('bun', [join(ROOT, 'runner', 'run.ts'), 'plan', '--prereg', 'docs/benchmarks/2026-11-04-syn-d/prereg.json', '--out', join(f.repo, 'plan-inside'), ...planArgs], { cwd: f.repo, encoding: 'utf8' });
    expect(planInside.stderr).toContain('HE-SEALED-002');
    expect(existsSync(join(f.repo, 'plan-inside'))).toBe(false);
    // preflight reads only the opening plan copied into the manifest: a resumed receipt of it passes that check, a
    // receipt of another opening is refused
    const planned = join(f.work, 'plan-d');
    const plan = spawnSync('bun', [join(ROOT, 'runner', 'run.ts'), 'plan', '--prereg', 'docs/benchmarks/2026-11-04-syn-d/prereg.json', '--out', planned, ...planArgs], { cwd: f.repo, encoding: 'utf8' });
    expect(plan.status, plan.stderr).toBe(0);
    // preflight and run write custody logs beside the manifest, so a sealed manifest inside a checkout is refused
    const insideRun = join(f.repo, 'inside-run');
    mkdirSync(insideRun);
    writeFileSync(join(insideRun, 'manifest.json'), readFileSync(join(planned, 'manifest.json')));
    const insidePreflight = spawnSync('bun', [join(ROOT, 'runner', 'run.ts'), 'preflight', '--manifest', join(insideRun, 'manifest.json'), ...planArgs], { cwd: f.repo, encoding: 'utf8', timeout: 60_000 });
    expect(insidePreflight.stderr).toContain(`HE-SEALED-002 --manifest ${insideRun} is inside a git work tree`);
    const insideRunCmd = spawnSync('bun', [join(ROOT, 'runner', 'run.ts'), 'run', '--manifest', join(insideRun, 'manifest.json'), '--harness-mode', 'scripted', ...planArgs], { cwd: f.repo, encoding: 'utf8', timeout: 60_000 });
    expect(insideRunCmd.stderr).toContain(`HE-SEALED-002 --manifest ${insideRun} is inside a git work tree`);
    expect(existsSync(join(insideRun, 'sealed-console.log'))).toBe(false);
    rmSync(insideRun, { recursive: true });
    const receiptD = JSON.parse(readFileSync(join(rootD, 'opening-receipt.json'), 'utf8'));
    const preflight = (receipt: unknown) => {
      const p = join(f.work, 'receipt-variant.json');
      writeFileSync(p, JSON.stringify(receipt, null, 2) + '\n');
      return spawnSync('bun', [join(ROOT, 'runner', 'run.ts'), 'preflight', '--manifest', join(planned, 'manifest.json'), '--sealed-root', rootD, '--opening-receipt', p], { cwd: f.repo, encoding: 'utf8', timeout: 60_000 });
    };
    const resumed = preflight({ ...receiptD, written_at: '2030-01-01T00:00:00.000Z', access: { ...receiptD.access, resumed: true } });
    expect(resumed.stderr).not.toContain('HE-SEALED-003');
    expect(resumed.stdout).toContain("SEALED: root and receipt match the manifest's opening (set vsyn, receipt ");
    const other = preflight({ ...receiptD, access: { ...receiptD.access, event_sha256: '0'.repeat(64) } });
    expect(other.status).toBe(2);
    expect(other.stderr).toContain('is not the opening plan copied into the manifest (it differs in access.event_sha256)');
    rmSync(planned, { recursive: true });
    const inside = join(f.repo, 'inside-root');
    spawnSync('cp', ['-r', rootD, inside]);
    expect(run(['--sealed-root', inside, '--opening-receipt', join(inside, 'opening-receipt.json')]).stderr).toContain('HE-SEALED-002');
    rmSync(inside, { recursive: true });
  }, 60_000);

  test('R1: a held-out brain built from the sealed root holds the slice\'s pages and none of the public held-out pages; the image check binds the receipt', () => {
    const rootD = join(f.work, 'root-d');
    const receipt = readReceipt(join(rootD, 'opening-receipt.json'));
    const pub = JSON.parse(readFileSync(join(ROOT, 'world', 'seed', 'world.json'), 'utf8')) as World;
    const merged = JSON.parse(readFileSync(join(rootD, 'world', 'world.json'), 'utf8')) as World;
    const publicSlugs = pageList(pub, 'heldout').map((p) => p.slug);
    // A stand-in for the gbrain CLI: init succeeds, import reports every staged page, --version prints one.
    const bin = scratch();
    const fake = join(bin, 'fake-gbrain.sh');
    writeFileSync(fake, '#!/usr/bin/env bash\ncase "$1" in\n  init) exit 0 ;;\n  import) n=$(find "$2" -name "*.md" | wc -l); echo "{\\"status\\":\\"success\\",\\"imported\\":$n,\\"errors\\":0,\\"duration_s\\":0}" ;;\n  --version) echo "gbrain 0.0.0" ;;\nesac\n');
    chmodSync(fake, 0o755);
    const out = join(bin, 'brain');
    const manifest = buildBrain({ split: 'heldout', corpus: join(rootD, 'corpus'), worldPath: join(rootD, 'world', 'world.json'), out, staging: join(bin, 'staging'), gbrain: ['bash', fake], commit: 'test', corpusCommit: 'sealed', corpusRepo: 'sealed', log: () => undefined }) as { pages: Array<{ slug: string; sha256: string }> };
    expect(manifest.pages.map((p) => p.slug).sort()).toEqual(['chats/syn-vault-notes', 'notes/syn-quoll-brief']);
    for (const s of publicSlugs) expect(manifest.pages.some((p) => p.slug === s)).toBe(false);
    expect(manifest.pages.find((p) => p.slug === 'chats/syn-vault-notes')!.sha256).toBe(sha256(readFileSync(join(rootD, 'corpus', 'heldout', 'chats', 'syn-vault-notes.md'))));
    expect(pageList(merged, 'heldout').map((p) => p.slug).sort()).toEqual(['chats/syn-vault-notes', 'notes/syn-quoll-brief']);
    // the image check: an image built from the public world fails, one built from the sealed root passes
    expect(sealedImageProblem('img', { world_sha256: sha256(readFileSync(join(ROOT, 'world', 'seed', 'world.json'))), heldout_corpus_sha256: null }, receipt)).toContain('would not hold the sealed slice');
    expect(sealedImageProblem('img', { world_sha256: receipt.world_sha256, heldout_corpus_sha256: receipt.heldout_corpus_sha256 }, receipt)).toBeNull();
    expect(sealedImageProblem('img', null, receipt)).toContain('no readable /opt/sidecar/image.json');
  }, 60_000);
});

describe('the custody branch', () => {
  let f: Fixture;
  const B = { runId: 'syn-r1', dir: '2026-11-11-syn-r1', label: 'confirmatory' as const, candidate: candidate('r1') };
  const C = { runId: 'syn-r2', dir: '2026-11-12-syn-r2', label: 'confirmatory' as const, candidate: candidate('r2') };

  test('two custodians race for the last confirmatory opening: the one whose push lands opens, the other reruns admission, is refused and never decrypts', async () => {
    f = await makeFixture(1);
    tmps.push(f.tmp);
    register(f, B);
    const rootA = join(f.work, 'root-r1'), rootB = join(f.work, 'root-r2');
    let raced = 0;
    let other: ReturnType<typeof spawnSync> | undefined;
    const err = await openRun({
      repo: f.repo, prereg: `docs/benchmarks/${B.dir}/prereg.json`, ...co(f), out: rootA, log: () => undefined,
      beforePush: () => {
        if (raced++) return;
        // While custodian A holds its admission commit, main moves on (syn-r1 withdrawn, syn-r2 planned) and custodian B,
        // a separate process with its own public checkout and custody clone, opens syn-r2 and pushes first.
        setRow(f, { run_id: B.runId, status: 'withdrawn', reason: 'withdrawn before custody opened it' });
        register(f, C);
        const pub = join(f.tmp, 'public-b');
        spawnSync('git', ['clone', '-q', f.bare, pub]);
        const clone = cloneCustody(f, 'custody-b');
        other = spawnSync('bun', [join(ROOT, 'scripts', 'sealed', 'open.ts'), '--prereg', `docs/benchmarks/${C.dir}/prereg.json`, '--repo', pub, '--custody', clone, '--identity', f.identityPath, '--out', rootB],
          { cwd: pub, encoding: 'utf8', env: { PATH: `${join(f.gh, '..')}:${process.env.PATH}`, HOME: process.env.HOME, UBICLOUD_API_KEY: ENV_VALUE } });
      },
    }).then(() => null, (e: Error) => e);
    expect(other?.status, String(other?.stderr)).toBe(0);
    // A's first push was rejected; its rerun admission refused, so it never committed or pushed again
    expect(raced).toBe(1);
    expect(err?.message).toContain('has had 1 confirmatory opening(s) (syn-r2) against a budget of 1');
    expect(existsSync(rootA)).toBe(false);
    expect(existsSync(join(rootB, 'opening-receipt.json'))).toBe(true);
    expect(readAccessLog(cloneCustody(f, 'race-final')).filter((e) => e.event === 'opened').map((e) => e.run_id)).toEqual(['syn-r2']);
  }, 120_000);

  test('a push that keeps failing ends the open before anything is decrypted', async () => {
    register(f, { runId: 'syn-r3', dir: '2026-11-13-syn-r3', label: 'dev', reason: 'synthetic dev opening', candidate: candidate('r3') });
    const hook = join(f.bare, 'hooks', 'pre-receive');
    writeFileSync(hook, '#!/usr/bin/env bash\necho "custody push refused by the test" >&2\nexit 1\n');
    chmodSync(hook, 0o755);
    const before = readAccessLog(cloneCustody(f, 'fail-before')).length;
    const out = join(f.work, 'root-r3');
    try {
      await expect(openRun({ repo: f.repo, prereg: 'docs/benchmarks/2026-11-13-syn-r3/prereg.json', ...co(f), out, log: () => undefined })).rejects.toThrow(/HE-SEALED-006 the push to origin refs\/heads\/custody was rejected 5 times .*nothing was decrypted/);
    } finally { rmSync(hook); }
    expect(existsSync(out)).toBe(false);
    expect(readAccessLog(cloneCustody(f, 'fail-after')).length).toBe(before);
  }, 120_000);

  test('main moving during admission is seen: the rerun admission refuses a stale checkout or a withdrawn row, and reads a fresh main when it opens', async () => {
    // while the custodian holds its admission commit, main moves and another custody step lands first, so the push is
    // rejected and admission reruns against both refs as they now are
    const landCustody = (name: string) => compareAndPush(cloneCustody(f, `h5-${name}`), { message: () => `other step ${name}`, decide: () => ({ schema_version: 1, event: 'opened', at: 't', run_id: name, set: 'h5-other', label: 'dev', custodian: 'test' }) });
    const opens = (run: string) => readAccessLog(cloneCustody(f, `h5-check-${run}`)).filter((e) => e.event === 'opened' && e.run_id === run).length;
    const spec = (n: string) => ({ runId: `syn-${n}`, dir: `2026-11-14-syn-${n}`, label: 'dev' as const, reason: 'synthetic dev opening', candidate: candidate(n) });
    const open = (n: string, beforeFirstPush: () => void) => { let pushes = 0; return openRun({ repo: f.repo, prereg: `docs/benchmarks/2026-11-14-syn-${n}/prereg.json`, ...co(f), out: join(f.work, `root-${n}`), log: () => undefined, beforePush: () => { if (!pushes++) beforeFirstPush(); } }); };
    // 1. another checkout withdraws the row on main; this checkout is now behind origin/main
    register(f, spec('h5a'));
    await expect(open('h5a', () => {
      const pub = join(f.tmp, 'public-h5');
      spawnSync('git', ['clone', '-q', f.bare, pub]);
      git(pub, 'config', 'user.email', 'custody-test@example.invalid'); git(pub, 'config', 'user.name', 'custody test');
      const mp = join(pub, 'tasks', 'multiuser', SET, 'heldout', 'MANIFEST.json');
      const man = JSON.parse(readFileSync(mp, 'utf8'));
      man.openings.find((r: { run_id: string }) => r.run_id === 'syn-h5a').status = 'withdrawn';
      writeFileSync(mp, JSON.stringify(man, null, 2) + '\n');
      git(pub, 'commit', '-q', '-am', 'withdraw syn-h5a'); git(pub, 'push', '-q', 'origin', 'HEAD:main');
      landCustody('h5a');
    })).rejects.toThrow(/HE-SEALED-006 the public checkout .* is at [0-9a-f]+, not origin\/main/);
    expect(existsSync(join(f.work, 'root-h5a'))).toBe(false);
    expect(opens('syn-h5a')).toBe(0);
    // 2. this checkout follows main, where the row was withdrawn: the fresh plan check refuses
    git(f.repo, 'merge', '--ff-only', '-q', 'origin/main');
    register(f, spec('h5b'));
    await expect(open('h5b', () => {
      setRow(f, { run_id: 'syn-h5b', status: 'withdrawn' });
      commitPush(f, 'withdraw syn-h5b');
      landCustody('h5b');
    })).rejects.toThrow(/HE-HELDOUT-002 run syn-h5b: its row in the openings ledger of set vsyn is withdrawn/);
    expect(existsSync(join(f.work, 'root-h5b'))).toBe(false);
    expect(opens('syn-h5b')).toBe(0);
    // 3. an unrelated change on main: the rerun admits, and the line and receipt name the main it was decided on
    register(f, spec('h5c'));
    const opened = await open('h5c', () => {
      writeFileSync(join(f.repo, 'h5-unrelated.txt'), 'unrelated\n');
      commitPush(f, 'an unrelated change on main');
      landCustody('h5c');
    });
    const main = git(f.repo, 'rev-parse', 'origin/main');
    expect(opened.receipt.public_commit).toBe(main);
    expect(readAccessLog(cloneCustody(f, 'h5-check-c')).find((e) => e.event === 'opened' && e.run_id === 'syn-h5c')?.public_commit).toBe(main);
    closeRoot(opened.root);
  }, 180_000);

  test('the custody clone is isolated: the public checkout, a directory inside it and a worktree of it are refused', () => {
    expect(() => custodyClone({ dir: f.repo, repo: f.repo })).toThrow(/HE-SEALED-011/);
    expect(() => custodyClone({ dir: join(f.repo, 'docs'), repo: f.repo })).toThrow(/HE-SEALED-011/);
    const wt = join(f.tmp, 'public-wt');
    git(f.repo, 'worktree', 'add', '-q', '--detach', wt);
    expect(() => custodyClone({ dir: wt, repo: f.repo })).toThrow(/HE-SEALED-011/);
    expect(custodyClone({ dir: f.custody, repo: f.repo })).toBe(f.custody);
    expect(git(f.custody, 'symbolic-ref', 'HEAD')).toBe('refs/heads/custody');
  });

  test('the custody-ref validator accepts only validated ciphertext and schema-checked access-log appends', async () => {
    const c = cloneCustody(f, 'validate');
    const base = git(c, 'rev-parse', 'HEAD');
    const commit = (files: Record<string, string | Uint8Array>) => {
      for (const [p, d] of Object.entries(files)) { mkdirSync(join(c, p, '..'), { recursive: true }); writeFileSync(join(c, p), d); }
      git(c, 'add', '-A'); git(c, 'commit', '-q', '-m', 'candidate change');
      const problems = validateCustodyChange(c, base);
      git(c, 'reset', '-q', '--hard', base);
      return problems;
    };
    const line = JSON.stringify({ schema_version: 1, event: 'exported', at: 't', run_id: 'r', set: 'vsyn', results_bundle_sha256: 'a'.repeat(64), custodian: 'test' });
    const log = readFileSync(join(c, 'access-log.jsonl'), 'utf8');
    const ct = await encryptTo(f.recipient, enc('synthetic raw results'));
    expect(commit({ 'access-log.jsonl': log + line + '\n', 'vsyn/results/r.tar.age': ct })).toEqual([]);
    expect(commit({ 'vsyn/results/r.tar.age': enc('plaintext pretending') }).join('\n')).toContain('not age ciphertext to an X25519 recipient');
    expect(commit({ 'notes.txt': 'plaintext' }).join('\n')).toContain('not a file the custody branch holds');
    for (const d of ['runner', 'tasks', 'docs']) expect(commit({ [`${d}/bundle.tar.age`]: ct }).join('\n')).toContain(`${d}/bundle.tar.age: under ${d}/, a public tree`);
    expect(commit({ 'vsyn/bundle.tar.age': ct }).join('\n')).toContain('M; custody files are added once and never changed');
    expect(commit({ 'access-log.jsonl': line + '\n' }).join('\n')).toContain('not an append');
    expect(commit({ 'access-log.jsonl': log + JSON.stringify({ schema_version: 1, event: 'opened', at: 't', run_id: 'r', set: 's', custodian: 'x', note: SECRETS.hiddenFact }) + '\n' }).join('\n')).toContain('unknown field note');
    const leaked = await generateX25519Identity();
    expect(commit({ 'README.md': `notes ${leaked}\n` }).join('\n')).toContain('README.md: holds an age identity');
    expect(JSON.stringify(commit({ 'README.md': `notes ${leaked}\n` }))).not.toContain(leaked);
  }, 60_000);

  test('seal and export refuse a repository that is not private, or whose visibility cannot be read, before reading or writing anything', async () => {
    const pub = fakeGh(f.tmp, 'false');
    await expect(sealSet({ repo: f.repo, set: 'vother', tasks: join(f.plain, 'heldout'), slice: join(f.plain, 'slice.json'), custody: f.custody, recipient: f.recipient, gh: pub })).rejects.toThrow(/HE-SEALED-013 garrytan\/harness-evals is not private/);
    expect(existsSync(join(f.repo, 'tasks', 'multiuser', 'vother'))).toBe(false);
    await expect(exportRun({ repo: f.repo, results: join(f.tmp, 'no-results'), sealedRoot: join(f.tmp, 'no-root'), receipt: join(f.tmp, 'no-receipt'), custody: f.custody, gh: fakeGh(f.tmp, null) })).rejects.toThrow(/HE-SEALED-013 could not read the visibility/);
    expect(() => checkPrivate('garrytan/harness-evals', fakeGh(f.tmp, 'true'))).not.toThrow();
  });
});

describe('admission while main moves, and release against open', () => {
  let f: Fixture;
  const landCustody = (name: string) => compareAndPush(cloneCustody(f, `cells-${name}`), { message: () => `other step ${name}`, decide: () => ({ schema_version: 1, event: 'opened', at: 't', run_id: name, set: 'cells-other', label: 'dev', custodian: 'test' }) });
  const opens = (run: string) => readAccessLog(cloneCustody(f, `cells-check-${run}`)).filter((e) => e.event === 'opened' && e.run_id === run).length;
  const spec = (n: string, label: 'confirmatory' | 'dev') => ({ runId: `syn-${n}`, dir: `2026-11-20-syn-${n}`, label, ...(label === 'dev' ? { reason: 'synthetic dev opening' } : {}), candidate: candidate(n) });
  const open = (n: string, beforeFirstPush: () => void, repo = f.repo, custody = f.custody) => { let pushes = 0; return openRun({ repo, prereg: `docs/benchmarks/2026-11-20-syn-${n}/prereg.json`, ...co(f), custody, out: join(f.work, `root-${n}`), log: () => undefined, beforePush: () => { if (!pushes++) beforeFirstPush(); } }); };
  const editJson = <T>(path: string, change: (x: T) => void) => { const x = JSON.parse(readFileSync(path, 'utf8')); change(x); writeFileSync(path, JSON.stringify(x, null, 2) + '\n'); };
  const plantOpened = (run: string) => compareAndPush(cloneCustody(f, `cells-opened-${run}`), { message: () => `opening ${run}`, decide: () => ({ schema_version: 1, event: 'opened', at: 't', run_id: run, set: SET, label: 'dev', custodian: 'test' }) });
  let releases = 0;
  const releaseOpts = () => ({ repo: f.repo, set: SET, ...co(f), custody: cloneCustody(f, `cells-release-${++releases}`), log: () => undefined });
  const refusedRelease = (o: Partial<Parameters<typeof releaseSet>[0]> = {}) => releaseSet({ ...releaseOpts(), ...o }).then(() => 'no refusal', (e: Error) => e.message);
  /** What export.ts leaves for an opened run, in miniature: an encrypted raw results bundle on the custody branch with its
   *  "exported" line, and the run's sealed-results/export.json naming its digests, which release decrypts and verifies. */
  const exportSynthetic = async (run: string) => pushSynthetic(run, await bundleSynthetic(run));
  const bundleSynthetic = async (run: string) => { const entries = [{ path: 'trials.jsonl', data: enc(`{"run_id":"${run}"}\n`) }]; return { entries, bundle: await encryptTo(f.recipient, gzipSync(packTar(entries))) }; };
  const pushSynthetic = (run: string, { entries, bundle }: Awaited<ReturnType<typeof bundleSynthetic>>) => {
    const rel = `${SET}/results/${run}.tar.age`, c = cloneCustody(f, `cells-export-${run}`);
    compareAndPush(c, {
      message: () => `export ${run}`,
      decide: () => ({ schema_version: 1, event: 'exported', at: 't', run_id: run, set: SET, label: 'dev', results_bundle_sha256: sha256(bundle), custodian: 'test' }),
      stage: () => { mkdirSync(join(c, SET, 'results'), { recursive: true }); writeFileSync(join(c, rel), bundle); return [rel]; },
    });
    const out = join(f.repo, 'docs', 'benchmarks', `2026-11-20-${run}`, 'sealed-results');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'export.json'), JSON.stringify({ run_id: run, set: SET, sealed_results: { repository_path: rel, results_bundle_sha256: sha256(bundle), raw_tree_sha256: entriesDigest(entries), raw_files: { 'trials.jsonl': sha256(entries[0]!.data) } } }));
  };

  test('main amending the preregistration, superseding the row or changing the sealed block or recipient during admission is refused for confirmatory and dev, with no opened line and no root', async () => {
    f = await makeFixture(3);
    tmps.push(f.tmp);
    const cells: Array<[string, 'confirmatory' | 'dev', () => void, RegExp]> = [];
    const changed = (n: string) => new RegExp(`^HE-SEALED-006 docs/benchmarks/2026-11-20-syn-${n}/prereg\\.json, the sealed block of set vsyn or sealed/recipient\\.txt changed on origin/main during admission`);
    const amend = (n: string) => () => editJson<{ question: string }>(join(f.repo, 'docs', 'benchmarks', `2026-11-20-syn-${n}`, 'prereg.json'), (x) => { x.question = `${x.question} Amended during admission.`; });
    const supersede = (n: string) => () => setRow(f, { run_id: `syn-${n}`, status: 'superseded' });
    const superseded = (n: string) => new RegExp(`^HE-HELDOUT-002 run syn-${n}: its row in the openings ledger of set vsyn is superseded`);
    cells.push(['ca', 'confirmatory', amend('ca'), changed('ca')], ['da', 'dev', amend('da'), changed('da')]);
    cells.push(['cs', 'confirmatory', supersede('cs'), superseded('cs')], ['ds', 'dev', supersede('ds'), superseded('ds')]);
    cells.push(['db', 'dev', () => editJson<{ sealed: { task_count: number } }>(manifestPath(f), (m) => { m.sealed.task_count += 1; }), changed('db')]);
    cells.push(['dr', 'dev', () => writeFileSync(join(f.repo, 'sealed', 'recipient.txt'), 'age1anotherrecipientwrittenonmainduringadmission\n'), changed('dr')]);
    for (const [n, label, change, refusal] of cells) {
      register(f, spec(n, label));
      await expect(open(n, () => { change(); commitPush(f, `main moves during the admission of syn-${n}`); landCustody(n); })).rejects.toThrow(refusal);
      expect(existsSync(join(f.work, `root-${n}`))).toBe(false);
      expect(opens(`syn-${n}`)).toBe(0);
      if (n === 'db' || n === 'dr') { git(f.repo, 'revert', '--no-edit', 'HEAD'); git(f.repo, 'push', '-q', 'origin', 'HEAD:main'); }
    }
  }, 240_000);

  test('release refuses, before decrypting or writing anything, while a run of the set has an opened line and no exported line, and names the run', async () => {
    plantOpened('syn-early');
    const status = () => git(f.repo, 'status', '--porcelain', '--untracked-files=all');
    const before = status();
    // a missing identity: a refusal that came after decryption would fail on the identity instead
    expect(await refusedRelease({ identityPath: join(f.tmp, 'no-identity') })).toMatch(/^HE-SEALED-008 the access log has an "opened" line and no "exported" line for 1 run\(s\) of set vsyn \(syn-early\); a released set takes no export, .* Nothing was decrypted or written$/);
    expect(status()).toBe(before);
    expect(readManifest(heldoutSet(SET, f.repo))!.custody).toBe('sealed');
    expect(readAccessLog(cloneCustody(f, 'cells-release-stranded')).map((e) => e.event)).not.toContain('released');
    await exportSynthetic('syn-early');
  }, 60_000);

  test('a run opened while release decrypts is seen before the released line is pushed, and open refuses a set whose access log has a released line, dev and confirmatory', async () => {
    register(f, spec('rel', 'dev'));
    register(f, spec('relc', 'confirmatory'));
    let pushes = 0;
    const raced = await refusedRelease({ beforePush: () => { if (!pushes++) plantOpened('syn-late'); } });
    expect(raced).toMatch(/^HE-SEALED-008 the access log has an "opened" line with no "exported" line, or an "exported" line release did not verify, for 1 run\(s\) of set vsyn that landed after release read it \(syn-late\);.* the manifest is left sealed and the released line was not pushed/);
    expect(pushes).toBe(1);
    expect(readManifest(heldoutSet(SET, f.repo))!.custody).toBe('sealed');
    expect(readAccessLog(cloneCustody(f, 'cells-release-raced')).map((e) => e.event)).not.toContain('released');
    // the rerun reads syn-late in its first read and refuses it before decrypting, since it has no export
    expect(await refusedRelease()).toMatch(/^HE-SEALED-008 the access log has an "opened" line and no "exported" line for 1 run\(s\) of set vsyn \(syn-late\);/);
    expect(readManifest(heldoutSet(SET, f.repo))!.custody).toBe('sealed');
    // once syn-late is exported the first read verifies every export; an opened and exported pair that lands after that
    // read is refused at the push, since release never verified its export
    await exportSynthetic('syn-late');
    const lateBundle = await bundleSynthetic('syn-x');
    let latePushes = 0;
    expect(await refusedRelease({ beforePush: () => { if (!latePushes++) { plantOpened('syn-x'); pushSynthetic('syn-x', lateBundle); } } })).toMatch(/^HE-SEALED-008 the access log has an "opened" line with no "exported" line, or an "exported" line release did not verify, for 1 run\(s\) of set vsyn that landed after release read it \(syn-x\);/);
    expect(readManifest(heldoutSet(SET, f.repo))!.custody).toBe('sealed');
    // the rerun verifies syn-x too, accepts the files the refused attempts wrote and lands the release
    expect(await releaseSet(releaseOpts())).toEqual({ runs: ['syn-early', 'syn-late', 'syn-x'], tasks: expect.any(Number) as unknown as number });
    expect(readFileSync(join(f.repo, 'docs', 'benchmarks', '2026-11-20-syn-late', 'results', 'trials.jsonl'), 'utf8')).toBe('{"run_id":"syn-late"}\n');
    expect(readManifest(heldoutSet(SET, f.repo))!.custody).toBeUndefined();
    expect(readAccessLog(cloneCustody(f, 'cells-release-done')).filter((e) => e.set === SET).map((e) => e.event)).toEqual(['sealed', 'opened', 'exported', 'opened', 'exported', 'opened', 'exported', 'released']);
    // main still shows the set sealed until the release pull request merges; open on a clean checkout of main refuses
    const pub = join(f.tmp, 'public-released');
    spawnSync('git', ['clone', '-q', f.bare, pub]);
    await expect(open('rel', () => undefined, pub, cloneCustody(f, 'cells-open-released'))).rejects.toThrow(/^HE-SEALED-006 set vsyn has a "released" line in the access log on refs\/heads\/custody; a released set takes no opening or resume/);
    expect(existsSync(join(f.work, 'root-rel'))).toBe(false);
    expect(opens('syn-rel')).toBe(0);
    const pubC = join(f.tmp, 'public-released-c');
    spawnSync('git', ['clone', '-q', f.bare, pubC]);
    await expect(open('relc', () => undefined, pubC, cloneCustody(f, 'cells-open-released-c'))).rejects.toThrow(/^HE-SEALED-006 set vsyn has a "released" line in the access log on refs\/heads\/custody; a released set takes no opening or resume/);
    expect(existsSync(join(f.work, 'root-relc'))).toBe(false);
    expect(opens('syn-relc')).toBe(0);
  }, 180_000);
});

describe('export decisions and the leak scan', () => {
  test('one Holm family per opening: superiority claims enter with their p and need the claimed direction, noninferiority claims enter with their one-sided p against the margin', () => {
    const file = { comparisons: [
      { a: 'x', b: 'y', delta: 0.3, ci95: [0.1, 0.5], p: 0.001 },
      { a: 'x', b: 'z', delta: 0.2, ci95: [0.05, 0.35], p: 0.013 },
      { a: 'x', b: 'v', delta: 0.1, ci95: [0.01, 0.2], p: 0.02 },
      { a: 'x', b: 'w', delta: -0.02, ci95: [-0.04, 0.01], p: 0.5, noninferiority: { margin: 0.05, direction: 'higher', p: 0.004 } },
    ] };
    const claim = (id: string, b: string, extra: Record<string, unknown>) => ({ id, sentence: `claim ${id}`, source: 'c.json', path: 'comparisons', where: { a: 'x', b }, rule: 'superiority' as const, direction: 'increase' as const, ...extra });
    const d = decide([claim('C1', 'y', {}), claim('C2', 'z', {}), claim('C2b', 'v', {}), claim('C3', 'w', { rule: 'noninferiority', margin: 0.05 }), claim('C5', 'y', { direction: 'decrease' })], () => file, 0.025);
    // five claims, one family: 0.001 and 0.001 (x5), 0.004 (x3), 0.013 (x2), 0.02 (x1), step-down
    expect(d.map((x) => [x.claim, x.decision])).toEqual([['C1', 'accept'], ['C2', 'reject'], ['C2b', 'reject'], ['C3', 'accept'], ['C5', 'reject']]);
    expect(d.map((x) => x.holm_p)).toEqual([0.005, 0.026, 0.026, 0.012, 0.005].map((x) => expect.closeTo(x, 10)) as unknown as number[]);
    expect(d[3]!.p).toBe(0.004);
    expect(d[0]!.sentence).toBe("C1: accepted. claim C1. Estimate +30.0 points, 95% interval +10.0 to +50.0, superiority, Holm-adjusted p 0.0050 across the opening's 5 claim(s) against alpha 0.025.");
    expect(d[3]!.sentence).toContain('noninferiority with a margin of 5.0 points, Holm-adjusted p 0.012');
    // the same noninferiority p fails once the family is large enough to push it past alpha
    const many = decide([claim('N', 'w', { rule: 'noninferiority', margin: 0.05 }), ...[1, 2, 3, 4, 5, 6].map((i) => claim(`W${i}`, 'w', {}))], () => file, 0.025);
    expect(many[0]!.holm_p).toBeCloseTo(0.028, 10);
    expect(many[0]!.decision).toBe('reject');
    // a superiority claim of a decrease is accepted on a negative estimate with a small p, and rejected as an increase
    const down = { comparisons: [{ a: 'x', b: 'u', delta: -0.15, ci95: [-0.25, -0.05], p: 0.002 }] };
    const dec = decide([claim('D1', 'u', { direction: 'decrease' }), claim('D2', 'u', {})], () => down, 0.025);
    expect(dec.map((x) => [x.claim, x.decision])).toEqual([['D1', 'accept'], ['D2', 'reject']]);
    expect(dec[0]!.sentence).toContain('D1: accepted. claim D1. Estimate -15.0 points');
    expect(() => decide([claim('C4', 'nobody', {})], () => file, 0.025)).toThrow(/0 entries/);
    expect(() => decide([claim('C6', 'w', { rule: 'noninferiority', margin: 0.1 })], () => file, 0.025)).toThrow(/no noninferiority p for margin 0.1 \(higher\)/);
    expect(() => decide([claim('C7', 'w', { rule: 'noninferiority', margin: 0.05, direction: 'decrease' })], () => file, 0.025)).toThrow(/margin 0.05 \(lower\)/);
  });


  test('the leak scan names the file and kind of a hit, never the text', () => {
    const hits = leakScan({ 'export.json': `{"note": "${SECRETS.hiddenFact}"}`, 'README.md': 'clean' }, [{ kind: 'task string', text: SECRETS.hiddenFact }]);
    expect(hits).toEqual([{ file: 'export.json', kind: 'task string', secret_sha256: sha256(SECRETS.hiddenFact).slice(0, 12) }]);
    expect(JSON.stringify(hits)).not.toContain(SECRETS.hiddenFact);
  });
});

describe('slice ids against the public world', () => {
  // Value: protects=seal.ts applies the contract sliceProblems and mergeWorld apply: a held-out slice record may reuse a
  //   public held-out id (every public held-out record is dropped before the slice is added, and #107's gen-world numbers
  //   v0.3's held-out messages from m-82, the first public held-out id), never the id of a record the public world keeps;
  //   fails_when=seal.ts refuses every public id again, or stops refusing a kept one; seam=a fixture repo and custody remote.
  test('a slice reusing a public held-out id seals; one reusing a public dev id is refused; open refuses a withdrawn resume, a row opened only on main and a spent set', async () => {
    const f = await makeFixture(2);
    tmps.push(f.tmp);
    const pub = JSON.parse(readFileSync(join(ROOT, 'world', 'seed', 'world.json'), 'utf8')) as { messages: Array<{ id: string; split: string; text: string }> };
    const heldId = pub.messages.find((m) => m.split === 'heldout')!, devId = pub.messages.find((m) => m.split !== 'heldout')!;
    const withMessage = (name: string, m: Record<string, unknown>) => {
      const doc = sliceDoc() as unknown as { messages: unknown[] };
      const p = join(f.plain, name);
      writeFileSync(p, JSON.stringify({ ...doc, messages: [...doc.messages, m] }, null, 1));
      return p;
    };
    const seal = (set: string, slice: string) => sealSet({ repo: f.repo, set, tasks: join(f.plain, 'heldout'), slice, corpus: join(f.plain, 'corpus'), custody: f.custody, recipient: f.recipient, gh: f.gh });
    await expect(seal('vdevid', withMessage('slice-dev-id.json', { ...devId, split: 'heldout', text: 'new sealed text for a dev id' }))).rejects.toThrow(/^HE-SEALED-006 the world slice does not fit the public world: .*slice: messages m-\d+ collides with a public messages record outside the held-out split/);
    // the public world itself as the slice: its held-out records are public copies
    const worldCopy = join(f.plain, 'public-world-copy.json');
    writeFileSync(worldCopy, readFileSync(join(ROOT, 'world', 'seed', 'world.json')));
    await expect(seal('vcopy', worldCopy)).rejects.toThrow(/^HE-SEALED-006 \d+ held-out record\(s\) of the world slice are copies of public held-out records/);
    // a copy with its keys in another order is still a copy
    const reversed = Object.fromEntries(Object.entries(heldId).reverse());
    await expect(seal('vcopyr', withMessage('slice-copy-reversed.json', reversed))).rejects.toThrow(/^HE-SEALED-006 1 held-out record\(s\) of the world slice are copies of public held-out records/);
    // one unchanged copy of a public held-out record among new ones is refused too
    await expect(seal('vcopy1', withMessage('slice-copy-one.json', heldId))).rejects.toThrow(/^HE-SEALED-006 1 held-out record\(s\) of the world slice are copies of public held-out records/);
    const sealed = await seal('vheldid', withMessage('slice-held-id.json', { ...heldId, text: 'new sealed text for a public held-out id' }));
    expect(sealed.manifest.custody).toBe('sealed');
    expect(readAccessLog(cloneCustody(f, 'check-heldid')).filter((e) => e.set === 'vheldid').map((e) => e.event)).toEqual(['sealed']);
    git(f.repo, 'checkout', '-q', '--', '.');
    rmSync(join(f.repo, 'tasks', 'multiuser', 'vheldid'), { recursive: true, force: true });

    // the open cells the state matrix found untested: each refusal leaves no line and no root
    const opened = () => readAccessLog(cloneCustody(f, `cells-log-${Math.random().toString(16).slice(2)}`)).filter((e) => e.set === SET).length;
    const openSpec = (spec: { runId: string; dir: string }, out: string) => openRun({ repo: f.repo, prereg: `docs/benchmarks/${spec.dir}/prereg.json`, ...co(f), out: join(f.work, out), log: () => undefined });
    // a resume after the row was withdrawn on main reruns the plan check and is refused
    const W = { runId: 'syn-w', dir: '2026-11-21-syn-w', label: 'dev' as const, reason: 'synthetic dev opening', candidate: candidate('w') };
    register(f, W);
    await openSpec(W, 'root-w');
    setRow(f, { run_id: W.runId, status: 'withdrawn', reason: 'withdrawn after the opening' });
    commitPush(f, 'syn-w withdrawn');
    let before = opened();
    await expect(openSpec(W, 'root-w')).rejects.toThrow(/^HE-HELDOUT-00\d /);
    expect(opened()).toBe(before);
    // a row marked opened on main with no opened line in custody does not open
    const O = { runId: 'syn-o', dir: '2026-11-21-syn-o', label: 'dev' as const, reason: 'synthetic dev opening', candidate: candidate('o'), status: 'opened' as const };
    register(f, O);
    before = opened();
    await expect(openSpec(O, 'root-o')).rejects.toThrow(/only a planned row opens/);
    expect([opened(), existsSync(join(f.work, 'root-o'))]).toEqual([before, false]);
    // a preregistration whose claims export.ts could not decide is refused before the opening is spent
    const K = { runId: 'syn-k', dir: '2026-11-21-syn-k', label: 'dev' as const, reason: 'synthetic dev opening', candidate: candidate('k') };
    register(f, K);
    const kPath = join(f.repo, 'docs', 'benchmarks', K.dir, 'prereg.json');
    const kPrereg = JSON.parse(readFileSync(kPath, 'utf8'));
    for (const [claims, want] of [[[], /heldout\.claims must be a non-empty list/], [kPrereg.heldout.claims.map((c: object) => ({ ...c, direction: 'up' })), /direction must be increase or decrease \(got "up"\)/]] as const) {
      writeFileSync(kPath, JSON.stringify({ ...kPrereg, heldout: { ...kPrereg.heldout, claims } }, null, 2) + '\n');
      commitPush(f, 'syn-k claims changed');
      before = opened();
      await expect(openSpec(K, 'root-k')).rejects.toThrow(want);
      expect([opened(), existsSync(join(f.work, 'root-k'))]).toEqual([before, false]);
    }
    expect(claimProblems([{ id: 'a', sentence: 's', source: 'summary.json', path: 'p', where: { a: 1 }, rule: 'noninferiority', direction: 'increase' }, { id: 'a', sentence: '', source: 'comparisons.json', path: 'p', where: {}, rule: 'better', direction: 'increase' }])).toEqual([
      'heldout.claims[0] (a): source must be comparisons.json or comparisons.gbrain.json, the two export.ts makes (got "summary.json")',
      'heldout.claims[0] (a): a noninferiority claim needs a numeric margin >= 0',
      'heldout.claims[1] (a): id is not unique',
      'heldout.claims[1] (a): sentence must be a non-empty string',
      'heldout.claims[1] (a): where must be a non-empty object',
      'heldout.claims[1] (a): rule must be superiority or noninferiority (got "better")',
    ]);
    expect(claimProblems(kPrereg.heldout.claims)).toEqual([]);
    for (const v of [{}, null, true, Number.NaN]) expect(claimProblems(kPrereg.heldout.claims.map((c: object) => ({ ...c, where: { a: v } })))[0]).toMatch(/every where value must be a string or a finite number/);
    // a confirmatory opening of a set whose ledger is spent is refused
    const S = { runId: 'syn-s', dir: '2026-11-21-syn-s', label: 'confirmatory' as const, candidate: candidate('s') };
    const m = JSON.parse(readFileSync(manifestPath(f), 'utf8'));
    writeFileSync(manifestPath(f), JSON.stringify({ ...m, status: 'spent' }, null, 2) + '\n');
    register(f, S);
    before = opened();
    await expect(openSpec(S, 'root-s')).rejects.toThrow(/takes no new confirmatory opening/);
    expect([opened(), existsSync(join(f.work, 'root-s'))]).toEqual([before, false]);
  }, 240_000);
});

