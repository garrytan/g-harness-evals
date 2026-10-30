// seal.ts --from-backup (docs/sealed-custody.md, "Sealing from an author's encrypted backup"): a synthetic backup in the
// shape of v0.3's (one top-level v03/ folder: selected/tasks with 40 task directories, selected/exclusions.json,
// world/slice.json, corpus-seal/heldout/<category>/<page>.md, and generation residue beside them), made with GNU tar and
// encrypted to a throwaway recipient, sealed into a local bare custody remote, opened again and released. It checks the digest
// refusals (a missing, malformed or different --sha256), the tar-slip, link and device refusals, that only the named inputs (and --include extras) enter the bundle,
// that the unpacked plaintext is gone after success, a refusal and SIGTERM, that stale intake directories are swept by the
// next run and by cleanup.ts, and that no decrypted content reaches stdout or stderr. Nothing here is a real task, key or
// result.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { bundleEntryProblem, corpusDigest, decryptWith, encryptTo, sha256, unpackTar, verifySealedRoot } from '../runner/heldout/sealed.ts';
import { heldoutSet, readManifest, sealedProblems } from '../scripts/seal-heldout.ts';
import { openRun } from '../scripts/sealed/open.ts';
import { sealedRedactor } from '../runner/heldout/guard.ts';
import { collectSecrets, leakScan } from '../scripts/sealed/export.ts';
import { readAccessLog } from '../scripts/sealed/custody.ts';
import { backupEntries, makeIntakeDir, sweepStaleIntake, writeBackup } from '../scripts/sealed/intake.ts';
import { releaseSet } from '../scripts/sealed/release.ts';
import { sealFromBackup } from '../scripts/sealed/seal.ts';
import { candidate, cloneCustody, co, ENV_VALUE, makeFixture, register, ROOT, SCRUBBED_ENV, SECRETS, SET, sliceDoc, type Fixture } from './sealed-fixture.ts';

const tmps: string[] = [];
afterAll(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'he-intake-t-')); tmps.push(d); return d; };
/** tar and truncate run with the API keys scrubbed from their environment. */
const run0 = (cmd: string, args: string[]) => execFileSync(cmd, args, { env: SCRUBBED_ENV, maxBuffer: 1 << 30 });
const write = (p: string, s: string | Uint8Array) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const enc = (s: string) => new TextEncoder().encode(s);

const CANARY = { task: 'Wombat canary task body 5512', exclusion: 'Wombat canary exclusion 8830', page: 'Wombat canary corpus page 1207', residue: 'Wombat canary generation residue 4471' };
const TASKS = Array.from({ length: 40 }, (_, i) => `ix-${String(i + 1).padStart(2, '0')}-synthetic`);
const LONG = `v03/llm-cache/${'c'.repeat(64)}/${'d'.repeat(64)}.json`;

/** The v03/ tree of a synthetic backup under src: the named inputs plus residue, every file carrying a canary. */
function v03Tree(src: string, residueBytes = 0) {
  for (const t of TASKS) write(join(src, 'v03', 'selected', 'tasks', t, 'task.toml'), `# synthetic intake task, not counted\nid = "${t}"\nslice = "multiuser"\nsplit = "heldout"\ntitle = "${CANARY.task} ${t}"\n`);
  write(join(src, 'v03', 'selected', 'exclusions.json'), JSON.stringify({ excluded: [{ id: 'ix-99', why: CANARY.exclusion }] }, null, 1));
  write(join(src, 'v03', 'world', 'slice.json'), JSON.stringify(sliceDoc(), null, 1));
  write(join(src, 'v03', 'corpus-seal', 'heldout', 'chats', 'syn-vault-notes.md'), `---\ntitle: syn vault notes\n---\n${SECRETS.corpusLine} ${CANARY.page}\n`);
  write(join(src, 'v03', 'corpus-seal', 'heldout', 'notes', 'syn-quoll-brief.md'), `---\ntitle: Quoll Haulage brief\n---\n${CANARY.page} brief\n`);
  write(join(src, 'v03', 'corpus-seal', 'heldout', 'memos', 'syn-memo.md'), `---\ntitle: memo\n---\n${CANARY.page} memo\n`);
  for (const p of ['v03/candidates/c-01/task.toml', 'v03/audits/audit-01.json', 'v03/proxy-logs/proxy.jsonl', LONG, 'v03/world.json', 'v03/logs/gen.log']) write(join(src, p), `${CANARY.residue} in ${p}\n`);
  if (residueBytes) write(join(src, 'v03', 'llm-cache', 'big.bin'), randomBytes(residueBytes));
}

/** GNU tar of src's v03/ (optionally pax and gzip), encrypted to recipient, written to out. */
async function backupOf(src: string, recipient: string, out: string, flags: string[] = []): Promise<Uint8Array> {
  const tar = run0('tar', ['-C', src, ...flags, '-cf', '-', 'v03']);
  const bytes = await encryptTo(recipient, new Uint8Array(tar));
  write(out, bytes);
  return bytes;
}

/** A raw ustar archive of one entry, for archives GNU tar would not write. */
function rawTar(path: string, type = '0', body = 'x', prefix = ''): Uint8Array {
  const h = new Uint8Array(512);
  const put = (s: string, at: number) => h.set(enc(s), at);
  put(path, 0); put('0000644\0', 100); put('0000000\0', 108); put('0000000\0', 116);
  put(body.length.toString(8).padStart(11, '0') + '\0', 124); put('00000000000\0', 136); put('        ', 148); put(type, 156); put('ustar\0', 257); put('00', 263); put(prefix, 345);
  let sum = 0; for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const data = new Uint8Array(Math.ceil(body.length / 512) * 512); data.set(enc(body));
  const out = new Uint8Array(512 + data.length + 1024); out.set(h, 0); out.set(data, 512);
  return out;
}

const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const paxHeader = (records: Record<string, string>) => {
  const body = Object.entries(records).map(([k, v]) => { const rec = ` ${k}=${v}\n`; let len = rec.length + 1; while (`${len}${rec}`.length !== len) len++; return `${len}${rec}`; }).join('');
  return rawTar('PaxHeader', 'x', body).subarray(0, 512 + Math.ceil(body.length / 512) * 512);
};

describe('seal.ts --from-backup', () => {
  let f: Fixture;
  let src = '';
  let intakeRoot = '';
  let backupSha = '';
  const lines: string[] = [];

  beforeAll(async () => {
    f = await makeFixture(2, async (fx) => {
      src = join(fx.tmp, 'author');
      intakeRoot = join(fx.tmp, 'intake');
      v03Tree(src);
      const backup = await backupOf(src, fx.recipient, join(fx.tmp, 'backup.tar.age'));
      backupSha = sha256(backup);
      await sealFromBackup({ repo: fx.repo, set: SET, backup: join(fx.tmp, 'backup.tar.age'), sha256: backupSha, tasks: 'v03/selected/tasks', slice: 'v03/world/slice.json', corpus: 'v03/corpus-seal', include: ['v03/selected/exclusions.json'], custody: fx.custody, recipient: fx.recipient, gh: fx.gh, identityPath: fx.identityPath, env: fx.env, intakeRoot, custodian: 'internal-task', log: (l) => lines.push(l) });
    });
    tmps.push(f.tmp);
  }, 120_000);

  test('round trip: a v03-shaped backup seals only the named inputs and the extra, nested corpus pages in the digest, and open verifies it', async () => {
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/^SEAL: removed the unpacked intake \S+intake-\d+-\d+-[0-9a-f]{8} \(checked: it no longer exists\)$/);
    expect(readdirSync(intakeRoot)).toEqual([]);
    const set = heldoutSet(SET, f.repo);
    const m = readManifest(set)!;
    expect(sealedProblems(m, set)).toEqual([]);
    expect(m.sealed!.task_count).toBe(40);
    const corpus = join(src, 'v03', 'corpus-seal');
    expect(m.sealed!.heldout_corpus_sha256).toBe(corpusDigest(corpus));
    expect(Object.keys(m.sealed!.extras!)).toEqual(['extras/v03/selected/exclusions.json']);
    expect(m.sealed!.extras!['extras/v03/selected/exclusions.json']).toBe(sha256(readFileSync(join(src, 'v03', 'selected', 'exclusions.json'))));
    const c = cloneCustody(f, 'check-intake');
    expect(readAccessLog(c).map((e) => [e.event, e.set, e.custodian])).toEqual([['sealed', SET, 'internal-task']]);
    const entries = unpackTar(await decryptWith(f.identity, new Uint8Array(readFileSync(join(c, m.sealed!.bundle)))));
    const paths = entries.map((e) => e.path);
    expect(paths.filter((p) => p.startsWith('corpus/'))).toEqual(['corpus/heldout/chats/syn-vault-notes.md', 'corpus/heldout/memos/syn-memo.md', 'corpus/heldout/notes/syn-quoll-brief.md']);
    expect(paths.filter((p) => p.startsWith('tasks/')).length).toBe(40);
    expect(paths.filter((p) => !p.startsWith('tasks/') && !p.startsWith('corpus/'))).toEqual(['extras/v03/selected/exclusions.json', 'opaque-salt', 'world/slice.json']);
    expect(entries.some((e) => new TextDecoder().decode(e.data).includes(CANARY.residue))).toBe(false);
    // open accepts the extra, writes it into the root and verifies every digest, nested pages included
    const D = { runId: 'syn-intake', dir: '2026-11-02-syn-intake', label: 'dev' as const, reason: 'intake round trip', candidate: candidate('intake') };
    register(f, D);
    const out = join(f.work, 'root-intake');
    const r = await openRun({ repo: f.repo, prereg: `docs/benchmarks/${D.dir}/prereg.json`, ...co(f), out, log: () => undefined });
    expect(verifySealedRoot(out, r.receipt, f.repo)).toEqual([]);
    expect(r.receipt.task_count).toBe(40);
    expect(readFileSync(join(out, 'extras', 'v03', 'selected', 'exclusions.json'), 'utf8')).toContain(CANARY.exclusion);
    expect(existsSync(join(out, 'corpus', 'heldout', 'memos', 'syn-memo.md'))).toBe(true);
    // the extra's text is sealed text: guarded output redacts it and the export leak scan flags it
    expect(sealedRedactor(out, SET).redact(`note: ${CANARY.exclusion}`)).not.toContain(CANARY.exclusion);
    const secrets = collectSecrets({ root: out, set: SET, raw: mkdtempSync(join(f.work, 'raw-')), publicTexts: [] });
    expect(leakScan({ 'summary.md': `row ${CANARY.exclusion}` }, secrets).some((l) => l.kind.startsWith('extra '))).toBe(true);
    // a short excluded id under an id key is sealed text too
    expect(sealedRedactor(out, SET).redact('excluded ix-99 earlier')).not.toContain('ix-99');
    expect(leakScan({ 'summary.md': 'ix-99' }, secrets).map((l) => l.kind)).toEqual(['extra id']);
    // the receipt binds the extras: a missing or edited extra fails the root
    expect(r.receipt.extras).toEqual(m.sealed!.extras);
    const extraFile = join(out, 'extras', 'v03', 'selected', 'exclusions.json');
    const extraBytes = readFileSync(extraFile);
    writeFileSync(extraFile, 'edited');
    expect(verifySealedRoot(out, r.receipt, f.repo)).toEqual([expect.stringContaining('has extras/ files (1) that do not match the opening receipt (1)')]);
    rmSync(extraFile);
    expect(verifySealedRoot(out, r.receipt, f.repo)).toEqual([expect.stringContaining('has extras/ files (0) that do not match the opening receipt (1)')]);
    writeFileSync(extraFile, extraBytes);
    expect(verifySealedRoot(out, r.receipt, f.repo)).toEqual([]);
    // the keyless check shape-checks sealed.extras
    expect(sealedProblems({ ...m, sealed: { ...m.sealed!, extras: { 'extras/../x': '0'.repeat(64) } } }, set)).toEqual(['sealed.extras must map bundle paths under extras/ to 64-hex sha256 digests']);
  }, 120_000);

  test('release writes the extras and the nested corpus pages into sealed-world/ after checking their digests', async () => {
    let author = '';
    const g = await makeFixture(1, async (fx) => {
      author = join(fx.tmp, 'author');
      v03Tree(author);
      const bytes = await backupOf(author, fx.recipient, join(fx.tmp, 'backup.tar.age'), ['--format=pax', '-z']);
      await sealFromBackup({ repo: fx.repo, set: SET, backup: join(fx.tmp, 'backup.tar.age'), sha256: sha256(bytes), tasks: 'v03/selected/tasks', slice: 'v03/world/slice.json', corpus: 'v03/corpus-seal', include: ['v03/selected/exclusions.json'], custody: fx.custody, recipient: fx.recipient, gh: fx.gh, identityPath: fx.identityPath, env: fx.env, intakeRoot: join(fx.tmp, 'intake') });
    });
    tmps.push(g.tmp);
    const world = join(g.repo, 'tasks', 'multiuser', SET, 'sealed-world');
    const manifestPath = join(heldoutSet(SET, g.repo).dir, 'MANIFEST.json');
    const good = readFileSync(manifestPath, 'utf8');
    const m = JSON.parse(good);
    for (const extras of [{}, { 'extras/v03/selected/exclusions.json': '0'.repeat(64) }]) {
      writeFileSync(manifestPath, JSON.stringify({ ...m, sealed: { ...m.sealed, extras } }, null, 2) + '\n');
      await expect(releaseSet({ repo: g.repo, set: SET, ...co(g), log: () => undefined })).rejects.toThrow(/outside the task tree|do not match sealed\.extras/);
      expect(existsSync(world)).toBe(false);
    }
    writeFileSync(manifestPath, good);
    expect(await releaseSet({ repo: g.repo, set: SET, ...co(g), log: () => undefined })).toEqual({ runs: [], tasks: 40 });
    expect(readFileSync(join(world, 'extras', 'v03', 'selected', 'exclusions.json'))).toEqual(readFileSync(join(author, 'v03', 'selected', 'exclusions.json')));
    expect(corpusDigest(join(world, 'corpus'))).toBe(corpusDigest(join(author, 'v03', 'corpus-seal')));
  }, 120_000);

  test('bundleEntryProblem: the one entry check open.ts and release.ts share refuses strays and extras that differ from the manifest', () => {
    const e = (path: string, body = 'x') => ({ path, data: new TextEncoder().encode(body) });
    const base = [e(`tasks/multiuser/${SET}/heldout/t1/task.json`), e('world/slice.json'), e('opaque-salt'), e('corpus/heldout/a/p.md')];
    const extra = e('extras/v03/selected/exclusions.json', '{"x":1}');
    const listed = { [extra.path]: sha256(extra.data) };
    expect(bundleEntryProblem(base, SET)).toBeNull();
    expect(bundleEntryProblem([...base, extra], SET, listed)).toBeNull();
    expect(bundleEntryProblem([...base, extra], SET)).toMatch(/^the bundle holds an entry \(path sha256 [0-9a-f]{12}\) outside/);
    expect(bundleEntryProblem(base, SET, listed)).toMatch(/do not match sealed\.extras/);
    expect(bundleEntryProblem([...base, extra], SET, { [extra.path]: '0'.repeat(64) })).toMatch(/do not match sealed\.extras/);
    expect(bundleEntryProblem([...base, e('tasks/multiuser/other/heldout/t.json')], SET)).toMatch(/outside the task tree of set/);
    expect(bundleEntryProblem([...base, e('constructor')], SET, listed)).toMatch(/outside the task tree/);
  });

  test.skipIf(!existsSync('/proc/1/stat'))('the stale sweep keeps a directory a live process holds and removes one whose pid was reused or is gone', () => {
    const root = mkdtempSync(join(tmpdir(), 'he-intake-sweep-'));
    tmps.push(root);
    const stat = readFileSync('/proc/1/stat', 'utf8');
    const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
    const held = join(root, `intake-1-${ticks}-0000000a`), unknown = join(root, 'intake-1-0-0000000d'), reused = join(root, `intake-1-${ticks + 1}-0000000b`), gone = join(root, 'intake-2147483646-1-0000000c');
    for (const d of [held, unknown, reused, gone]) mkdirSync(d);
    expect(sweepStaleIntake(root)).toEqual({ removed: [reused, gone].sort(), failed: [], kept: [held, unknown].sort() });
    expect(readdirSync(root).sort()).toEqual([held, unknown].map((d) => d.slice(root.length + 1)).sort());
  });

  test('--exposures refuses an exposure with a missing field or a bad date before anything is sealed', async () => {
    await expect(sealFromBackup({ repo: f.repo, set: 'vexpose', backup: join(f.tmp, 'backup.tar.age'), sha256: backupSha, tasks: 'v03/selected/tasks', slice: 'v03/world/slice.json', ...co(f), recipient: f.recipient, intakeRoot, exposures: [{ date: '28-10-2026', kind: 'generator' } as never] })).rejects.toThrow('--exposures: exposures[0]: recipient is missing; exposures[0]: what is missing; exposures[0]: source is missing; exposures[0]: date must be YYYY-MM-DD');
    expect(readdirSync(intakeRoot)).toEqual([]);
    expect(existsSync(join(cloneCustody(f, 'check-expose'), 'vexpose'))).toBe(false);
  }, 60_000);

  test('a backup with no --sha256, a malformed one or another digest is refused before anything is decrypted or unpacked', async () => {
    // a missing or malformed digest is refused before the stale sweep, so a stale directory it would remove stays
    const stale = join(intakeRoot, 'intake-2147483646-1-0000000e');
    mkdirSync(stale, { recursive: true });
    for (const [digest, message] of [
      [undefined, '--from-backup needs --sha256, the sha256 of the backup file; nothing was decrypted'], ['', '--from-backup needs --sha256, the sha256 of the backup file; nothing was decrypted'],
      ['abc', '--sha256 must be 64 hex characters; nothing was decrypted'], [`${backupSha.slice(0, 63)}g`, '--sha256 must be 64 hex characters; nothing was decrypted'], [`${backupSha}00`, '--sha256 must be 64 hex characters; nothing was decrypted'],
    ] as const) await expect(sealFromBackup({ repo: f.repo, set: 'vdigest', backup: join(f.tmp, 'backup.tar.age'), sha256: digest as string, tasks: 'v03/selected/tasks', slice: 'v03/world/slice.json', ...co(f), recipient: f.recipient, intakeRoot })).rejects.toThrow(`HE-SEALED-006 ${message}`);
    expect(existsSync(stale)).toBe(true);
    rmSync(stale, { recursive: true });
    await expect(sealFromBackup({ repo: f.repo, set: 'vdigest', backup: join(f.tmp, 'backup.tar.age'), sha256: sha256('another backup'), tasks: 'v03/selected/tasks', slice: 'v03/world/slice.json', ...co(f), recipient: f.recipient, intakeRoot })).rejects.toThrow(/^HE-SEALED-006 --from-backup \S+ has sha256 [0-9a-f]{12}, --sha256 asks for [0-9a-f]{12}; nothing was decrypted$/);
    expect(readdirSync(intakeRoot)).toEqual([]);
    // an uppercase digest is the same digest: the backup is decrypted and unpacked, and the seal goes on to the exposures check
    const upper: string[] = [];
    await expect(sealFromBackup({ repo: f.repo, set: 'vdigest', backup: join(f.tmp, 'backup.tar.age'), sha256: backupSha.toUpperCase(), tasks: 'v03/selected/tasks', slice: 'v03/world/slice.json', ...co(f), recipient: f.recipient, intakeRoot, exposures: [{ date: '28-10-2026' } as never], log: (l) => upper.push(l) })).rejects.toThrow('--exposures: ');
    expect(upper).toEqual([expect.stringMatching(/^SEAL: removed the unpacked intake /)]);
    expect(readdirSync(intakeRoot)).toEqual([]);
    await expect(sealFromBackup({ repo: f.repo, set: 'vdigest', backup: join(f.tmp, 'backup.tar.age'), sha256: backupSha, tasks: '../outside', slice: 'v03/world/slice.json', ...co(f), recipient: f.recipient, intakeRoot })).rejects.toThrow('must be a path under the unpacked backup');
    await expect(sealFromBackup({ repo: f.repo, set: 'vdigest', backup: join(f.tmp, 'backup.tar.age'), sha256: backupSha, tasks: 'v03/selected/tasks', slice: '/etc/passwd', ...co(f), recipient: f.recipient, intakeRoot })).rejects.toThrow('must be a path under the unpacked backup');
    expect(existsSync(join(cloneCustody(f, 'check-digest'), 'vdigest'))).toBe(false);
  }, 60_000);

  test('unpacking refuses tar-slip paths, symbolic and hard links and devices, and writes nothing outside the intake directory', async () => {
    const t = scratch();
    for (const [name, tar] of [
      ['parent', rawTar('../evil.txt')], ['nested parent', rawTar('v03/../../evil.txt')], ['absolute', rawTar('/tmp/evil.txt')], ['prefix parent', rawTar('evil.txt', '0', 'x', '..')],
      ['pax parent', cat(paxHeader({ path: '../evil.txt' }), rawTar('innocent.txt'))], ['gnu long name parent', cat(rawTar('././@LongLink', 'L', '../../evil.txt').subarray(0, 1024), rawTar('innocent.txt'))],
    ] as const) expect(() => backupEntries(tar), name).toThrow(/^HE-SEALED-006 backup tar: entry \d \(path sha256 [0-9a-f]{12}\) has (an absolute path|a path with "\.\.")/);
    expect(() => backupEntries(rawTar('dev/null', '3'))).toThrow('is a character device');
    expect(() => backupEntries(rawTar('fifo', '6'))).toThrow('is a fifo');
    expect(() => backupEntries(rawTar('/', '5'))).toThrow('has an absolute path');
    expect(() => backupEntries(cat(paxHeader({ 'GNU.sparse.major': '1', 'GNU.sparse.minor': '0', 'GNU.sparse.name': 'v03/a' }), rawTar('v03/GNUSparseFile.1/a')))).toThrow('is a sparse file');
    expect(() => backupEntries(cat(paxHeader({ 'GNU.sparse.major': '1', 'GNU.sparse.minor': '0' }), paxHeader({ path: 'v03/a' }), rawTar('v03/b')))).toThrow('is a sparse file');
    // a backup made with tar -cf backup.tar . starts with a ./ entry, which is accepted
    const dotDir = join(t, 'dot');
    write(join(dotDir, 'v03', 'x.txt'), 'x');
    expect(backupEntries(new Uint8Array(run0('tar', ['-c', '-C', dotDir, '.']))).map((e) => e.path)).toEqual(['v03', 'v03/x.txt']);
    // the intake root is never a symbolic link
    symlinkSync(t, join(t, 'linked-root'));
    expect(() => makeIntakeDir(join(t, 'linked-root'))).toThrow('is a symbolic link');
    const sparseDir = join(t, 'sparse');
    mkdirSync(sparseDir);
    run0('truncate', ['-s', '2M', join(sparseDir, 'a')]);
    writeFileSync(join(sparseDir, 'b'), 'x');
    for (const v of ['0.0', '0.1', '1.0']) expect(() => backupEntries(new Uint8Array(run0('tar', ['-c', '--sparse', '--format=pax', `--sparse-version=${v}`, '-C', sparseDir, 'a'])))).toThrow('is a sparse file');
    expect(() => backupEntries(rawTar('v03/link', '2'))).toThrow('is a symbolic link');
    // GNU tar's own symbolic and hard link entries
    const s = join(t, 'sym');
    write(join(s, 'v03', 'a.txt'), 'a');
    symlinkSync('/etc/passwd', join(s, 'v03', 'link'));
    expect(() => backupEntries(new Uint8Array(run0('tar', ['-C', s, '-cf', '-', 'v03'])))).toThrow(/entry \d \(path sha256 [0-9a-f]{12}\) is a symbolic link; an intake unpacks regular files and directories only and follows no link/);
    const hl = join(t, 'hard');
    write(join(hl, 'v03', 'a.txt'), 'a');
    linkSync(join(hl, 'v03', 'a.txt'), join(hl, 'v03', 'b.txt'));
    expect(() => backupEntries(new Uint8Array(run0('tar', ['-C', hl, '-cf', '-', 'v03'])))).toThrow(/is a hard link; an intake unpacks regular files and directories only/);
    // a pax archive with a long path and a gzipped GNU archive both unpack
    const longPath = `v03/${'p'.repeat(120)}/page.md`;
    write(join(t, 'long', longPath), 'long');
    for (const flags of [['--format=pax'], ['-z']]) {
      const got = backupEntries(new Uint8Array(run0('tar', ['-C', join(t, 'long'), ...flags, '-cf', '-', 'v03'])));
      expect(got.filter((e) => !e.dir).map((e) => e.path)).toEqual([longPath]);
    }
    // writeBackup creates only under its directory and refuses a file where a directory is needed
    const dir = join(t, 'intake-dir');
    mkdirSync(dir);
    expect(writeBackup(dir, [{ path: 'a/b.txt', dir: false, data: enc('b') }])).toBe(1);
    expect(() => writeBackup(dir, [{ path: 'a/b.txt/c', dir: false, data: enc('c') }])).toThrow('is a file where a directory is needed');
    expect(existsSync(join(t, 'evil.txt'))).toBe(false);
    // a backup holding a link is refused end to end, and the intake directory is gone
    const linked = await backupOf(s, f.recipient, join(t, 'linked.tar.age'));
    const lines: string[] = [];
    await expect(sealFromBackup({ repo: f.repo, set: 'vlinked', backup: join(t, 'linked.tar.age'), sha256: sha256(linked), tasks: 'v03', slice: 'v03/a.txt', ...co(f), recipient: f.recipient, intakeRoot, log: (l) => lines.push(l) })).rejects.toThrow('is a symbolic link');
    expect(lines).toEqual([expect.stringMatching(/^SEAL: removed the unpacked intake /)]);
    expect(readdirSync(intakeRoot)).toEqual([]);
  }, 60_000);

  test('the CLI: success, a forced refusal and SIGTERM leave no plaintext; stale intake is swept by the next run and by cleanup.ts; no decrypted content is printed', async () => {
    const home = join(f.tmp, 'cli-home');
    const intake = join(home, '.capy', 'work', 'custody', 'intake');
    const env = { PATH: `${join(f.gh, '..')}:${process.env.PATH}`, HOME: home, UBICLOUD_API_KEY: ENV_VALUE };
    const cli = (set: string, extra: string[], backup = join(f.tmp, 'backup.tar.age')) => ['scripts/sealed/seal.ts', '--from-backup', backup, '--task-set', set, '--slice', 'v03/world/slice.json', '--corpus', 'v03/corpus-seal', '--custody', f.custody, '--recipient', f.recipient, '--repo', f.repo, '--identity', f.identityPath, '--custodian', 'internal-task', ...extra];
    const printed: string[] = [];
    const run = (args: string[]) => { const r = spawnSync('bun', args, { cwd: ROOT, encoding: 'utf8', env, timeout: 120_000 }); printed.push(r.stdout + r.stderr); return r; };
    const exposures = [
      { date: '2026-10-28', kind: 'generation', recipient: 'openai gpt-6.1-sol', what: 'world pages', source: 'synthetic' },
      { date: '2026-10-28', kind: 'author', recipient: 'internal-task', what: 'the whole set', source: 'synthetic' },
    ];
    write(join(f.work, 'exposures.json'), JSON.stringify(exposures));
    // a stale intake directory from a killed run is reported and removed by the next run
    const stale = join(intake, 'intake-2147483646-1-deadbeef');
    write(join(stale, 'v03', 'leftover.md'), CANARY.residue);
    const ok = run(cli('vintake', ['--tasks', 'v03/selected/tasks', '--include', 'v03/selected/exclusions.json', '--sha256', backupSha, '--exposures', join(f.work, 'exposures.json')]));
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain(`SEAL: removed 1 stale intake directory an earlier run left: ${stale}`);
    expect(ok.stdout).toMatch(/SEAL: removed the unpacked intake \S+ \(checked: it no longer exists\)\nsealed set vintake: 40 tasks, .*, 1 extra file\(s\)\n/);
    expect(ok.stdout).toContain('the manifest carries exposures but no openings ledger yet');
    expect(readdirSync(intake)).toEqual([]);
    const m = JSON.parse(readFileSync(join(f.repo, 'tasks', 'multiuser', 'vintake', 'heldout', 'MANIFEST.json'), 'utf8'));
    expect(m.exposures).toEqual(exposures);
    expect(readAccessLog(cloneCustody(f, 'check-cli')).filter((e) => e.set === 'vintake').map((e) => e.custodian)).toEqual(['internal-task']);
    // an unknown or misspelled flag is refused before anything is read
    const typo = run(cli('vtypo', ['--tasks', 'v03/selected/tasks', '--sha-256', backupSha]));
    expect(typo.status).toBe(2);
    expect(typo.stderr).toStartWith('HE-RUN-002 unknown argument(s) --sha-256; every flag takes one value;');
    expect(readdirSync(intake)).toEqual([]);
    // --from-backup without --sha256, or with one that is not 64 hex characters, is a usage error before anything is read;
    // the stale sweep never runs, so a stale directory stays
    write(join(stale, 'v03', 'leftover.md'), CANARY.residue);
    const noDigest = run(cli('vnodigest', ['--tasks', 'v03/selected/tasks']));
    expect(noDigest.status).toBe(2);
    expect(noDigest.stdout).toBe('');
    expect(noDigest.stderr).toStartWith('HE-RUN-002 --from-backup needs --sha256 <hex>, the sha256 of the backup file the author sent; nothing was decrypted; usage: ');
    for (const bad of ['abc', `${backupSha.slice(0, 63)}g`, `${backupSha}00`]) {
      const malformed = run(cli('vbaddigest', ['--tasks', 'v03/selected/tasks', '--sha256', bad]));
      expect(malformed.status).toBe(2);
      expect(malformed.stdout).toBe('');
      expect(malformed.stderr).toStartWith('HE-RUN-002 --sha256 must be 64 hex characters; nothing was decrypted; usage: ');
    }
    // a repeated single-value flag and a flag where the digest should be are usage errors too
    for (const digests of [[backupSha, 'abc'], ['abc', backupSha], [backupSha, sha256('another backup')]]) {
      const twice = run(cli('vtwice', ['--tasks', 'v03/selected/tasks', '--sha256', digests[0]!, '--sha256', digests[1]!]));
      expect(twice.status).toBe(2);
      expect(twice.stdout).toBe('');
      expect(twice.stderr).toStartWith('HE-RUN-002 --sha256 given more than once; only --include repeats; usage: ');
    }
    const flagValue = run(cli('vflagvalue', ['--tasks', 'v03/selected/tasks', '--sha256', '--include', 'v03/selected/exclusions.json']));
    expect(flagValue.status).toBe(2);
    expect(flagValue.stderr).toStartWith('HE-RUN-002 ');
    expect(existsSync(stale)).toBe(true);
    rmSync(stale, { recursive: true });
    expect(readdirSync(intake)).toEqual([]);
    // a refusal after unpacking (no task directory directly under --tasks) prints its code, a count and the log path
    const refused = run(cli('vrefused', ['--tasks', 'v03/selected', '--sha256', backupSha]));
    expect(refused.status).toBe(2);
    expect(refused.stdout).toMatch(/^SEAL: removed the unpacked intake \S+ \(checked: it no longer exists\)\n$/);
    expect(refused.stderr).toMatch(/^HE-SEALED-006 seal refused \(1 problem\(s\)\); the message can name sealed tasks or slice records, so it is withheld from this terminal; read \S+\.log inside custody only\n$/);
    expect(readdirSync(intake)).toEqual([]);
    // SIGTERM while the backup is decrypted removes the intake directory before exiting
    const big = join(f.tmp, 'big-author');
    v03Tree(big, 48 << 20);
    const bigSha = sha256(await backupOf(big, f.recipient, join(f.tmp, 'big.tar.age')));
    const child = spawn('bun', cli('vsignal', ['--tasks', 'v03/selected/tasks', '--sha256', bigSha], join(f.tmp, 'big.tar.age')), { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let childOut = '';
    child.stdout.on('data', (d) => { childOut += d; });
    child.stderr.on('data', (d) => { childOut += d; });
    const exited = new Promise<number | null>((res) => child.on('exit', (code) => res(code)));
    const deadline = Date.now() + 60_000;
    while (!(existsSync(intake) && readdirSync(intake).length) && Date.now() < deadline) await Bun.sleep(5);
    child.kill('SIGTERM');
    expect(await exited).toBe(143);
    printed.push(childOut);
    expect(childOut).toMatch(/SEAL: SIGTERM: removed the unpacked intake \S+intake-\d+-\d+-[0-9a-f]{8}\n/);
    expect(readdirSync(intake)).toEqual([]);
    // cleanup.ts --intake sweeps what a SIGKILL leaves
    write(join(stale, 'v03', 'leftover.md'), CANARY.residue);
    const swept = spawnSync('bun', ['scripts/sealed/cleanup.ts', '--intake'], { cwd: ROOT, encoding: 'utf8', env });
    expect(swept.status).toBe(0);
    expect(swept.stdout).toBe(`CLEANUP: removed 1 stale seal.ts intake directory: ${stale}\n`);
    expect(existsSync(stale)).toBe(false);
    printed.push(swept.stdout + swept.stderr);
    // canary: nothing decrypted reached a terminal
    const all = printed.join('\n');
    for (const s of [...Object.values(CANARY), SECRETS.corpusLine, SECRETS.ledgerCode, 'ix-01-synthetic', 'syn-vault-notes', 'exclusions.json"']) expect(all).not.toContain(s);
  }, 240_000);
});
