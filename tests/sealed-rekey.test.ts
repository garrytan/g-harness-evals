// internal-task, regeneration for v0.3 (docs/sealed-custody.md, "Re-encrypting for regeneration"): rekey.ts re-encrypts an
// author's backup to the author's own recipient, and compare-backups.ts compares two backups by task family, world-slice
// record and corpus page without printing content. Synthetic v03/-shaped backups made with GNU tar, encrypted to the
// fixture's throwaway custody recipient, a throwaway "author" identity, and the local bare custody remote of
// tests/sealed-fixture.ts. It checks the round trip (the author decrypts the identical tar bytes), every refusal (no output
// file, no access-log line), a refused push and a failed write after the push, the access-log line shapes, the set-state
// refusals, that the new events are not openings, the comparison counts, labels and exit codes (0, 1, 3), and that no
// decrypted text, task id or deep path reaches stdout or stderr. Nothing here is a real task, key or result.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { decryptWith, encryptTo, sha256 } from '../runner/heldout/sealed.ts';
import { compareAndPush, eventProblems, isX25519Recipient, openedRuns, readAccessLog, validateCustodyChange } from '../scripts/sealed/custody.ts';
import { rekeyBackup } from '../scripts/sealed/rekey.ts';
import { compareBackups, publicFamilies, reportLines, type CompareOptions } from '../scripts/sealed/compare-backups.ts';
import { openRun } from '../scripts/sealed/open.ts';
import { sealFromBackup } from '../scripts/sealed/seal.ts';
import { candidate, cloneCustody, co, commitPush, ENV_VALUE, git as fixtureGit, makeFixture, recordBackup, register, ROOT, SCRUBBED_ENV, SET, type Fixture } from './sealed-fixture.ts';

const CANARY = { task: 'Numbat canary task body 6620', notes: 'Numbat canary task notes 3391', slice: 'Numbat canary slice 0457', audit: 'Numbat canary audit 7718', page: 'Numbat canary corpus page 2284', brief: 'Numbat canary brief 5530', readme: 'Numbat canary tasks readme 9043' };
const TASK_IDS = ['ix-01-alpha', 'ix-02-beta', 'sx-01-gamma', 'qq-01-delta', 'qq-02-epsilon', 'loner', 'wxyzq-01-odd'];
const DEEP = ['task.toml', 'notes.md', 'exclusions.json', 'slice.json', 'ix-01-alpha.audit.json', 'page.md', 'README.md', 'heldout/chats', 'brief.md', 'wxyzq', 'empty'];
const write = (p: string, s: string) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const tasksDir = (src: string) => join(src, 'v03', 'selected', 'tasks');
const SLICE = { world_id: 'syn', channels: [{ id: 'c1', name: 'one' }], messages: [{ id: 'm1', text: CANARY.slice }, { id: 'm2', text: 'two' }], files: [] };
const c0 = { same: 0, changed: 0, added: 0, removed: 0 };

/** The base v03/ tree: four tasks in three families, one file directly in tasks/, a slice, corpus pages and residue. */
function baseTree(src: string) {
  for (const t of TASK_IDS.slice(0, 4)) write(join(tasksDir(src), t, 'task.toml'), `# synthetic, not counted\nid = "${t}"\ntitle = "${CANARY.task} ${t}"\n`);
  write(join(tasksDir(src), 'ix-01-alpha', 'sub', 'notes.md'), `${CANARY.notes}\n`);
  write(join(tasksDir(src), 'README.md'), `${CANARY.readme}\n`);
  write(join(src, 'v03', 'selected', 'exclusions.json'), JSON.stringify({ excluded: [] }));
  write(join(src, 'v03', 'world', 'slice.json'), JSON.stringify(SLICE));
  write(join(src, 'v03', 'audits', 'ix-01-alpha.audit.json'), JSON.stringify({ note: CANARY.audit }));
  write(join(src, 'v03', 'corpus-seal', 'heldout', 'chats', 'page.md'), `${CANARY.page}\n`);
  write(join(src, 'v03', 'corpus-seal', 'heldout', 'notes', 'ix-02-beta-brief.md'), `${CANARY.brief}\n`);
}

describe('rekey.ts and compare-backups.ts', () => {
  let f: Fixture;
  const author = { identity: '', recipient: '' };
  const base = { dir: '', tar: new Uint8Array(), file: '', sha: '' };
  let n = 0;
  const fresh = () => cloneCustody(f, `check-${++n}`);
  const logLength = () => readAccessLog(fresh()).length;
  const printed: string[] = [];
  const cli = (script: string, args: string[]) => {
    const r = spawnSync('bun', [`scripts/sealed/${script}`, ...args, '--custody', f.custody, '--recipient', f.recipient, '--repo', f.repo, '--identity', f.identityPath, '--custodian', 'internal-task'], { cwd: ROOT, encoding: 'utf8', env: { PATH: `${dirname(f.gh)}:${process.env.PATH}`, HOME: join(f.tmp, 'cli-home'), UBICLOUD_API_KEY: ENV_VALUE }, timeout: 120_000 });
    printed.push(r.stdout + r.stderr);
    return r;
  };
  /** A backup of base's tree after edit: GNU tar of the named roots under src (flags, e.g. -z), encrypted to recipient, and
   *  recorded for o.record (default SET; null records it for no set) in sealed/backups.json on main. */
  async function backup(name: string, edit: (src: string) => void = () => {}, o: { flags?: string[]; root?: string; paths?: string[]; recipient?: string; record?: string | null } = {}) {
    const src = join(f.tmp, 'trees', name);
    cpSync(base.dir, src, { recursive: true });
    edit(src);
    const tar = new Uint8Array(execFileSync('tar', ['-C', join(src, o.root ?? ''), ...(o.flags ?? []), '-cf', '-', ...(o.paths ?? ['v03'])], { env: SCRUBBED_ENV }));
    const bytes = await encryptTo(o.recipient ?? f.recipient, tar);
    const file = join(f.tmp, `${name}.tar.age`);
    writeFileSync(file, bytes);
    if (o.record !== null) recordBackup(f, o.record ?? SET, sha256(bytes));
    return { tar, file, sha: sha256(bytes) };
  }
  const compare = async (b: { file: string; sha: string }, o: Partial<CompareOptions> = {}, a: { file: string; sha: string } = base) => {
    const r = await compareBackups({ repo: f.repo, set: SET, a: a.file, aSha256: a.sha, b: b.file, bSha256: b.sha, tasks: 'v03/selected/tasks/', slice: 'v03/world/slice.json', corpus: 'v03/corpus-seal', allowFamily: ['ix'], recipient: f.recipient, ...co(f), custodian: 'internal-task', ...o });
    printed.push(reportLines(r).join('\n'));
    return r;
  };
  const rejectHook = (on: boolean) => {
    const hook = join(f.bare, 'hooks', 'pre-receive');
    if (on) { write(hook, '#!/bin/sh\necho "synthetic refusal" >&2\nexit 1\n'); chmodSync(hook, 0o755); } else rmSync(hook, { force: true });
  };

  beforeAll(async () => {
    f = await makeFixture(2);
    author.identity = await generateX25519Identity();
    author.recipient = await identityToRecipient(author.identity);
    base.dir = join(f.tmp, 'base');
    baseTree(base.dir);
    Object.assign(base, await backup('base'));
  }, 120_000);
  afterAll(() => { if (f) rmSync(f.tmp, { recursive: true, force: true }); });

  test('isX25519Recipient takes what the age library parses as an X25519 recipient, and nothing else', () => {
    expect(isX25519Recipient(author.recipient)).toBe(true);
    const flipped = author.recipient.slice(0, -1) + (author.recipient.endsWith('q') ? 'p' : 'q');
    for (const bad of ['', 'age1', 'age1notarecipient', flipped, author.recipient.toUpperCase(), ` ${author.recipient}`, author.identity, 'age1' + 'q'.repeat(58), null, 42]) expect(isX25519Recipient(bad)).toBe(false);
  });

  test('rekey round trip: the author decrypts the identical tar bytes, plain and gzipped, and one valid "reencrypted" line is pushed', async () => {
    const gz = await backup('base-gz', () => {}, { flags: ['-z'] });
    for (const [i, b] of [base, gz].entries()) {
      const out = join(f.work, 'rekey', `round-${i}.tar.age`);
      const r = await rekeyBackup({ repo: f.repo, set: SET, backup: b.file, sha256: i ? b.sha.toUpperCase() : b.sha, to: author.recipient, out, recipient: f.recipient, ...co(f), custodian: 'internal-task' });
      const bytes = new Uint8Array(readFileSync(out));
      expect(r).toEqual({ sourceSha256: b.sha, outputSha256: sha256(bytes), commit: expect.stringMatching(/^[0-9a-f]{40}$/), out });
      expect(Buffer.from(await decryptWith(author.identity, bytes)).equals(Buffer.from(b.tar))).toBe(true);
      await expect(decryptWith(f.identity, bytes)).rejects.toThrow('did not decrypt');
      expect(readdirSync(dirname(out)).filter((x) => x.includes('.rekey-'))).toEqual([]);
      const c = fresh();
      const last = readAccessLog(c).at(-1)!;
      expect(Object.keys(last).sort()).toEqual(['at', 'custodian', 'event', 'output_sha256', 'recipient', 'run_id', 'schema_version', 'set', 'source_sha256']);
      expect(last).toMatchObject({ schema_version: 1, event: 'reencrypted', run_id: '*', set: SET, source_sha256: b.sha, output_sha256: sha256(bytes), recipient: author.recipient, custodian: 'internal-task' });
      expect(validateCustodyChange(c, `${r.commit}^`, r.commit)).toEqual([]);
      expect(execFileSync('git', ['diff', '--name-only', `${r.commit}^`, r.commit], { cwd: c, encoding: 'utf8', env: SCRUBBED_ENV }).trim()).toBe('access-log.jsonl');
    }
  }, 120_000);

  test('eventProblems: exact field lists for reencrypted and compared, and the three new fields on no other event', () => {
    const line = (e: Record<string, unknown>) => eventProblems(JSON.stringify({ schema_version: 1, at: 'now', run_id: '*', set: SET, custodian: 'internal-task', ...e }));
    const h = sha256('x');
    const re = { event: 'reencrypted', source_sha256: h, output_sha256: h, recipient: author.recipient };
    expect(line(re)).toEqual([]);
    expect(line({ event: 'compared', source_sha256: h, output_sha256: h })).toEqual([]);
    expect(line({ ...re, recipient: 'age1notarecipient' })).toEqual(['recipient is not an age X25519 recipient']);
    expect(line({ event: 'reencrypted', source_sha256: h, output_sha256: 'abc' })).toEqual(['recipient missing', 'output_sha256 is not a sha256']);
    expect(line({ event: 'compared', source_sha256: h, output_sha256: h, recipient: author.recipient })).toEqual(['recipient is not a field of a compared line']);
    expect(line({ event: 'compared', output_sha256: h, run_id: 'r1' })).toEqual(['source_sha256 missing', 'run_id is not *']);
    expect(line({ ...re, label: 'dev' })).toEqual(['label is not a field of a reencrypted line']);
    expect(line({ ...re, bundle_sha256: h })).toEqual(['bundle_sha256 is not a field of a reencrypted line']);
    expect(line({ ...re, extra: 1 })).toEqual(['unknown field extra']);
    expect(line({ ...re, set: '*' })).toEqual(['set is not a set name']);
    expect(line({ ...re, set: 'Bad Set' })).toEqual(['set is not a set name']);
    expect(line({ event: 'opened', source_sha256: h })).toEqual(['source_sha256 is only on sealed, reencrypted and compared lines']);
    expect(line({ event: 'sealed', bundle_sha256: h, source_sha256: h })).toEqual([]);
    expect(line({ event: 'sealed', bundle_sha256: h, output_sha256: h })).toEqual(['output_sha256 is only on reencrypted and compared lines']);
    expect(line({ event: 'escrowed', set: '*', recipient: author.recipient })).toEqual(['recipient is only on reencrypted and compared lines']);
    // declared_sha256 (--declare-backup): a list of the line's own backup digests, on these two events only
    const h2 = sha256('y');
    expect(line({ ...re, output_sha256: h2, declared_sha256: [h] })).toEqual([]);
    expect(line({ event: 'compared', source_sha256: h, output_sha256: h2, declared_sha256: [h2, h] })).toEqual([]);
    expect(line({ ...re, output_sha256: h2, declared_sha256: [h2] })).toEqual(['declared_sha256 names a digest that is not a backup this line read']);
    for (const bad of ['x', [], [h, h], ['abc']]) expect(line({ ...re, declared_sha256: bad })).toEqual(['declared_sha256 is not a list of distinct sha256 digests']);
    expect(line({ event: 'opened', declared_sha256: [h] })).toEqual(['declared_sha256 is only on reencrypted and compared lines']);
  });

  test('rekey refusals leave no output file and no access-log line', async () => {
    const before = logLength();
    const out = join(f.work, 'refused', 'out.tar.age');
    const lib = (o: Record<string, unknown>) => rekeyBackup({ repo: f.repo, set: SET, backup: base.file, sha256: base.sha, to: author.recipient, out, recipient: f.recipient, ...co(f), ...o } as never);
    const toAuthor = await backup('to-author', () => {}, { recipient: author.recipient });
    for (const [o, message] of [
      [{ sha256: undefined }, '--sha256 is required, the sha256 of the backup file; nothing was decrypted'],
      [{ sha256: 'abc' }, '--sha256 must be 64 hex characters; nothing was decrypted'],
      [{ sha256: base.sha.slice(0, 63) + 'g' }, '--sha256 must be 64 hex characters; nothing was decrypted'],
      [{ sha256: sha256('another backup') }, `--from-backup ${base.file} has sha256 `],
      [{ to: 'age1notarecipient' }, '--to must be an age X25519 recipient'],
      [{ to: author.identity }, '--to must be an age X25519 recipient'],
      [{ to: f.recipient }, '--to is the custody recipient'],
      [{ out: join(f.repo, 'rekeyed.tar.age') }, `--out ${join(f.repo, 'rekeyed.tar.age')} is inside a git work tree`],
      [{ set: 'Bad Set' }, '--set must name a set'],
      [{ set: 'vnone' }, 'refs/heads/custody has no vnone/bundle.tar.age; --set names the sealed set the backup belongs to. Nothing was decrypted'],
      [{ backup: toAuthor.file, sha256: toAuthor.sha }, `--from-backup ${toAuthor.file} did not decrypt with the custody identity; nothing was written`],
    ] as const) await expect(lib(o)).rejects.toThrow(`HE-SEALED-006 ${message}`);
    const sibling = join(f.repo, 'tasks', 'multiuser', `${SET}-next`, 'heldout', 'MANIFEST.json');
    try {
      const slice = JSON.parse(readFileSync(join(f.repo, 'tasks', 'multiuser', SET, 'heldout', 'MANIFEST.json'), 'utf8')).sealed.world_slice_sha256;
      write(sibling, JSON.stringify({ schema_version: 1, custody: 'sealed', sealed: { world_slice_sha256: slice, heldout_corpus_sha256: slice }, status: 'open' }));
      await expect(lib({})).rejects.toThrow(`HE-SEALED-006 set ${SET} shares its world slice or corpus with ${SET}-next, still in sealed custody and not retired; a backup of ${SET} holds that set's content, so name it with --set ${SET}-next. Nothing was decrypted`);
      await expect(compare(await backup('shared-set'))).rejects.toThrow(`HE-SEALED-006 set ${SET} shares its world slice or corpus with ${SET}-next`);
      // a checkout from before the reseal reached main is refused too: the check also reads a fresh fetch of origin/main
      commitPush(f, 'synthetic reseal on main');
      fixtureGit(f.repo, 'reset', '-q', '--hard', 'HEAD~1');
      expect(existsSync(sibling)).toBe(false);
      await expect(lib({})).rejects.toThrow(`HE-SEALED-006 set ${SET} shares its world slice or corpus with ${SET}-next`);
    } finally {
      fixtureGit(f.repo, 'fetch', '-q', 'origin', 'main');
      fixtureGit(f.repo, 'reset', '-q', '--hard', 'origin/main');
      rmSync(dirname(dirname(sibling)), { recursive: true, force: true });
      if (fixtureGit(f.repo, 'status', '--porcelain')) commitPush(f, 'remove the synthetic reseal');
    }
    expect(existsSync(dirname(out))).toBe(false);
    expect(existsSync(join(f.repo, 'rekeyed.tar.age'))).toBe(false);
    write(out, 'keep');
    await expect(lib({})).rejects.toThrow(`HE-SEALED-006 --out ${out} exists; rekey.ts never overwrites a file. Nothing was decrypted`);
    // the CLI: usage errors (HE-RUN-002) and library refusals, each before anything is written or logged
    const args = (extra: Record<string, string | string[]>) => Object.entries({ '--from-backup': base.file, '--sha256': base.sha, '--to': author.recipient, '--out': join(f.work, 'refused', 'cli.tar.age'), '--set': SET, ...extra }).flatMap(([k, v]) => (Array.isArray(v) ? v.flatMap((x) => [k, x]) : v === '' ? [] : [k, v]));
    for (const [extra, err] of [
      [{ '--sha256': '' }, 'HE-RUN-002 --sha256 <hex> is required'],
      [{ '--sha256': 'abc' }, 'HE-RUN-002 --sha256 must be 64 hex characters; nothing was decrypted'],
      [{ '--sha256': [base.sha, base.sha] }, 'HE-RUN-002 --sha256 given more than once; no flag repeats'],
      [{ '--to': [author.recipient, author.recipient] }, 'HE-RUN-002 --to given more than once'],
      [{ '--to': 'age1notarecipient' }, 'HE-RUN-002 --to must be an age X25519 recipient'],
      [{ '--to': f.recipient }, 'HE-RUN-002 --to is the custody recipient'],
      [{ '--sha-256': base.sha }, 'HE-RUN-002 unknown argument(s) --sha-256'],
      [{ '--sha256': sha256('another backup') }, 'HE-SEALED-006 --from-backup '],
      [{ '--out': out }, `HE-SEALED-006 --out ${out} exists`],
    ] as const) {
      const r = cli('rekey.ts', args(extra as Record<string, string | string[]>));
      expect(r.status).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr).toStartWith(err);
    }
    expect(readFileSync(out, 'utf8')).toBe('keep');
    expect(readdirSync(dirname(out))).toEqual(['out.tar.age']);
    expect(logLength()).toBe(before);
    // the CLI's success line: the two digests and the commit, nothing else
    const ok = cli('rekey.ts', args({ '--out': join(f.work, 'cli-ok', 'author.tar.age') }));
    expect(ok.status).toBe(0);
    expect(ok.stderr).toBe('');
    expect(logLength()).toBe(before + 1);
    const outSha = sha256(readFileSync(join(f.work, 'cli-ok', 'author.tar.age')));
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.custody, encoding: 'utf8', env: SCRUBBED_ENV }).trim();
    expect(ok.stdout).toBe(`REKEY: backup sha256 ${base.sha} re-encrypted to the --to recipient as sha256 ${outSha}; "reencrypted" access-log line pushed to refs/heads/custody in ${commit}\n`);
  }, 240_000);

  test('a refused push writes nothing (rekey) and prints nothing (compare); a write that fails after the push leaves no file and says the line was pushed', async () => {
    const before = logLength();
    const dir = join(f.work, 'push-refused');
    const same = await backup('same-push');
    rejectHook(true);
    try {
      await expect(rekeyBackup({ repo: f.repo, set: SET, backup: base.file, sha256: base.sha, to: author.recipient, out: join(dir, 'out.tar.age'), recipient: f.recipient, ...co(f) })).rejects.toThrow(/^HE-SEALED-006 the push to origin refs\/heads\/custody was rejected 5 times .*the backup was decrypted and re-encrypted in memory only; nothing was written$/);
      expect(existsSync(dir)).toBe(false);
      const r = cli('compare-backups.ts', ['--a', base.file, '--a-sha256', base.sha, '--b', same.file, '--b-sha256', same.sha, '--tasks', 'v03/selected/tasks', '--set', SET]);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/^HE-SEALED-006 the push to origin refs\/heads\/custody was rejected 5 times .*both backups were decrypted in memory only and nothing was printed\n$/);
    } finally { rejectHook(false); }
    expect(logLength()).toBe(before);
    if (process.getuid?.() === 0) return;
    const ro = join(f.work, 'read-only');
    mkdirSync(ro);
    chmodSync(ro, 0o500);
    try {
      await expect(rekeyBackup({ repo: f.repo, set: SET, backup: base.file, sha256: base.sha, to: author.recipient, out: join(ro, 'out.tar.age'), recipient: f.recipient, ...co(f) })).rejects.toThrow(/^HE-SEALED-006 the "reencrypted" access-log line was pushed in [0-9a-f]{12}, but --out \S+ could not be written \(EACCES\); nothing was written to --out\. The logged re-encryption reached nobody; run rekey\.ts again with a new --out$/);
      expect(readdirSync(ro)).toEqual([]);
    } finally { chmodSync(ro, 0o700); }
    expect(logLength()).toBe(before + 1);
    expect(readAccessLog(fresh()).at(-1)!.event).toBe('reencrypted');
  }, 240_000);

  test('a backup is bound to --set by sealed/backups.json on main, or by --declare-backup, which the access-log line records', async () => {
    const before = logLength();
    const loose = await backup('bind-loose', () => {}, { record: null });
    const elsewhere = await backup('bind-elsewhere', () => {}, { record: 'vother' });
    let k = 0;
    const rekey = (b: { file: string; sha: string }, o: Record<string, unknown> = {}) => rekeyBackup({ repo: f.repo, set: SET, backup: b.file, sha256: b.sha, to: author.recipient, out: join(f.work, 'bind', `out-${++k}.tar.age`), recipient: f.recipient, ...co(f), custodian: 'internal-task', ...o } as never);
    const NONE = (flag: string, b: { file: string; sha: string }) => `HE-SEALED-006 ${flag} ${b.file} has sha256 ${b.sha.slice(0, 12)}, which sealed/backups.json on main records for no set, so nothing binds it to set ${SET}; if it is a backup of ${SET}, say so with --declare-backup ${b.sha} (the access-log line records it). Nothing was decrypted`;
    await expect(rekey(loose)).rejects.toThrow(NONE('--from-backup', loose));
    await expect(rekey(elsewhere)).rejects.toThrow(`HE-SEALED-006 --from-backup ${elsewhere.file} has sha256 ${elsewhere.sha.slice(0, 12)}, which sealed/backups.json on main records for vother, not for ${SET} or a set it replaced; --set names the set the backup belongs to, and --declare-backup cannot override a recorded binding. Nothing was decrypted`);
    await expect(rekey(elsewhere, { declared: [elsewhere.sha] })).rejects.toThrow('records for vother, not for');
    await expect(rekey(loose, { declared: [base.sha] })).rejects.toThrow(`HE-SEALED-006 --declare-backup ${base.sha.slice(0, 12)} is not the sha256 of a backup this run reads; nothing was decrypted`);
    await expect(compare(loose)).rejects.toThrow(NONE('--b', loose));
    await expect(compare(base, {}, loose)).rejects.toThrow(NONE('--a', loose));
    expect(logLength()).toBe(before);
    expect(existsSync(join(f.work, 'bind'))).toBe(false);
    // declared: accepted, and the line names the declared digest
    await rekey(loose, { declared: [loose.sha.toUpperCase()] });
    expect(readAccessLog(fresh()).at(-1)).toMatchObject({ event: 'reencrypted', source_sha256: loose.sha, declared_sha256: [loose.sha] });
    expect((await compare(loose, { declared: [loose.sha] })).exitCode).toBe(0);
    expect(readAccessLog(fresh()).at(-1)).toMatchObject({ event: 'compared', source_sha256: base.sha, output_sha256: loose.sha, declared_sha256: [loose.sha] });
    // a reseal: --set names the new set, a is the backup the set it replaced was sealed from, b the reseal's own
    const old = join(f.repo, 'tasks', 'multiuser', `${SET}-old`, 'heldout', 'MANIFEST.json');
    write(old, JSON.stringify({ schema_version: 1, custody: 'sealed', sealed: { world_slice_sha256: '7'.repeat(64), heldout_corpus_sha256: '7'.repeat(64) }, status: 'retired', replaced_by: SET }));
    commitPush(f, 'a synthetic set that SET replaced');
    try {
      const gen5 = await backup('bind-gen5', () => {}, { record: `${SET}-old` });
      const gen6 = await backup('bind-gen6', (s) => write(join(s, 'v03', 'audits', 'ix-01-alpha.audit.json'), 'rerendered'));
      expect((await compare(gen6, { allowGroup: ['v03/audits'] }, gen5)).exitCode).toBe(0);
      await rekey(gen5);
      await expect(compare(gen5, {}, gen6)).rejects.toThrow(`HE-SEALED-006 --b ${gen5.file} has sha256 ${gen5.sha.slice(0, 12)}, which sealed/backups.json on main records for ${SET}-old, not for ${SET}; --set names the set the backup belongs to`);
      // the CLI takes --declare-backup, repeatable on compare-backups.ts
      const cliArgs = ['--a', loose.file, '--a-sha256', loose.sha, '--b', gen6.file, '--b-sha256', gen6.sha, '--tasks', 'v03/selected/tasks', '--allow-group', 'v03/audits', '--set', SET];
      expect(cli('compare-backups.ts', cliArgs).stderr).toStartWith(NONE('--a', loose));
      expect(cli('compare-backups.ts', [...cliArgs, '--declare-backup', 'abc']).stderr).toStartWith('HE-RUN-002 --declare-backup must be 64 hex characters');
      const ok = cli('compare-backups.ts', [...cliArgs, '--declare-backup', loose.sha, '--declare-backup', gen6.sha]);
      expect(ok.status, ok.stderr).toBe(0);
      expect(readAccessLog(fresh()).at(-1)).toMatchObject({ event: 'compared', source_sha256: loose.sha, output_sha256: gen6.sha, declared_sha256: [loose.sha, gen6.sha] });
      // Value: protects=a backup recorded for a replaced set does not bind once that set has a "released" line; fails_when=rekey or compare-backups decrypts gen5 after the replaced set was released; why_new=only --set's access-log state was checked; seam=none; no_claim=an opened run of the replaced set (the same check, refuseOpenedVia).
      compareAndPush(cloneCustody(f, 'release-old'), { message: () => 'synthetic release of the replaced set', decide: () => ({ schema_version: 1, event: 'released', at: 'now', run_id: '*', set: `${SET}-old`, bundle_sha256: sha256('old'), custodian: 'synthetic' }) });
      const VIA = `HE-SEALED-006 set ${SET}-old, which ${SET} replaced and a backup is recorded for, has a "released" line in the access log on refs/heads/custody; regeneration is for a set that was never opened. Nothing was decrypted`;
      await expect(rekey(gen5)).rejects.toThrow(VIA);
      await expect(compare(gen6, { allowGroup: ['v03/audits'] }, gen5)).rejects.toThrow(VIA);
    } finally {
      rmSync(dirname(dirname(old)), { recursive: true, force: true });
      commitPush(f, 'remove the synthetic replaced set');
    }
    expect(logLength()).toBe(before + 6);
  }, 240_000);

  test('rekey: a backup that another set\'s "sealed" line names as its source is bound to that set, so --declare-backup cannot bind it before sealed/backups.json reaches main', async () => {
    const src = await backup('seal-source-rekey', () => {}, { record: null });
    compareAndPush(cloneCustody(f, 'seal-source-rekey'), { message: () => 'synthetic seal of vsealed from a backup', decide: () => ({ schema_version: 1, event: 'sealed', at: 'now', run_id: '*', set: 'vsealed', bundle_sha256: sha256('vsealed'), source_sha256: src.sha, custodian: 'synthetic' }) });
    const before = logLength();
    const out = join(f.work, 'seal-source', 'rekey.tar.age');
    await expect(rekeyBackup({ repo: f.repo, set: SET, backup: src.file, sha256: src.sha, to: author.recipient, out, recipient: f.recipient, ...co(f), custodian: 'internal-task', declared: [src.sha] })).rejects.toThrow(`HE-SEALED-006 --from-backup ${src.file} has sha256 ${src.sha.slice(0, 12)}, which a "sealed" line in the access log on refs/heads/custody records for vsealed, not for ${SET} or a set it replaced; --set names the set the backup belongs to, and --declare-backup cannot override a recorded binding. Nothing was decrypted`);
    expect(existsSync(dirname(out))).toBe(false);
    expect(logLength()).toBe(before);
  }, 120_000);

  test('compare-backups: a --b that another set\'s "sealed" line names as its source is refused even when declared, and a backup a "compared" line names cannot seal another set', async () => {
    const src = await backup('seal-source-compare', () => {}, { record: null });
    compareAndPush(cloneCustody(f, 'seal-source-compare'), { message: () => 'synthetic seal of vsealed2 from a backup', decide: () => ({ schema_version: 1, event: 'sealed', at: 'now', run_id: '*', set: 'vsealed2', bundle_sha256: sha256('vsealed2'), source_sha256: src.sha, custodian: 'synthetic' }) });
    const before = logLength();
    await expect(compare(src, { declared: [src.sha] })).rejects.toThrow(`HE-SEALED-006 --b ${src.file} has sha256 ${src.sha.slice(0, 12)}, which a "sealed" line in the access log on refs/heads/custody records for vsealed2, not for ${SET}; --set names the set the backup belongs to`);
    expect(logLength()).toBe(before);
    const own = await backup('compared-own', (s) => { for (const t of TASK_IDS.slice(0, 4)) { write(join(tasksDir(s), t, 'task.toml'), `# synthetic, not counted\nid = "${t}"\nkind = "fix"\n`); write(join(tasksDir(s), t, 'environment', 'Dockerfile'), 'FROM scratch\nLABEL harness-eval.sealed=true\n'); } }, { record: null });
    await compare(own, { declared: [own.sha] });
    expect(readAccessLog(fresh()).at(-1)).toMatchObject({ event: 'compared', set: SET, output_sha256: own.sha });
    const intakeRoot = join(f.tmp, 'intake-compared');
    await expect(sealFromBackup({ repo: f.repo, set: 'vcompared', kind: 'repo', backup: own.file, sha256: own.sha, tasks: 'v03/selected/tasks', ...co(f), recipient: f.recipient, intakeRoot })).rejects.toThrow(`the access log on refs/heads/custody has a "compared" line for set ${SET} that names this backup (sha256 ${own.sha.slice(0, 12)}); a backup belongs to one set, so it cannot seal vcompared. Nothing was pushed`);
    expect(existsSync(join(fresh(), 'vcompared'))).toBe(false);
    expect(existsSync(join(f.repo, 'tasks', 'repo', 'vcompared'))).toBe(false);
  }, 240_000);

  test('compare-backups: tasks, non-task entries, slice records and corpus pages, with exit codes 0, 1 and 3', async () => {
    const r = await compare(await backup('same'));
    expect(r.exitCode).toBe(0);
    expect(r.families).toEqual([{ family: 'ix', allowed: true, ...c0, same: 2 }, { family: 'qq', allowed: false, ...c0, same: 1 }, { family: 'sx', allowed: false, ...c0, same: 1 }]);
    expect(r.groups).toEqual([
      { group: 'v03/audits', allowed: false, allowedNamed: 0, ...c0, same: 2 }, { group: 'v03/corpus-seal', allowed: false, allowedNamed: 0, ...c0, same: 4 },
      { group: 'v03/selected', allowed: false, allowedNamed: 0, ...c0, same: 2 }, { group: 'v03/world', allowed: false, allowedNamed: 0, ...c0, same: 1 },
    ]);
    expect(r.slice).toEqual([{ collection: '(other keys)', ...c0, same: 1 }, { collection: 'channels', ...c0, same: 1 }, { collection: 'messages', ...c0, same: 2 }]);
    expect(r.corpus).toEqual({ ...c0, same: 2, allowedNamed: 0, otherNamed: 0, allowed: false });
    expect(reportLines(r).at(-2)).toBe('COMPARE: pass: checked every task directory under --tasks (identical outside --allow-family: ix); every other entry by path, kind, executable bit and bytes (identical outside --allow-group: none); every --slice record by collection and id; every --corpus page (0 differing page(s) named for an allowed family, not allowed without --allow-family-pages)');
    expect(reportLines(await compare(await backup('same-bare'), { slice: undefined, corpus: undefined })).at(-2)).toEndWith('; no world slice record by record (no --slice); no corpus page by page (no --corpus)');

    // an allowed family's task and its named corpus page change: the page needs judgment unless --allow-family-pages
    const allowedTask = await backup('allowed', (s) => {
      write(join(tasksDir(s), 'ix-02-beta', 'task.toml'), 'changed\n');
      write(join(s, 'v03', 'corpus-seal', 'heldout', 'notes', 'ix-02-beta-brief.md'), 'changed\n');
    });
    const a = await compare(allowedTask);
    expect(a.exitCode).toBe(3);
    expect(a.judgment).toEqual({ entries: 0, records: 0, pages: 0, familyPages: 1 });
    expect(a.families[0]).toEqual({ family: 'ix', allowed: true, ...c0, same: 1, changed: 1 });
    expect(a.corpus).toEqual({ ...c0, same: 1, changed: 1, allowedNamed: 1, otherNamed: 0, allowed: false });
    expect(reportLines(a).at(-2)).toStartWith('COMPARE: needs judgment: every task outside --allow-family is identical, but 0 non-task entr(ies), 0 slice record(s), 0 corpus page(s) not named for an allowed family and 1 named for one (allowed only with --allow-family-pages) differ outside --allow-group; checked ');
    const af = await compare(allowedTask, { allowFamilyPages: true });
    expect(af.exitCode).toBe(0);
    expect(reportLines(af).at(-2)).toContain('every --corpus page (1 differing page(s) named for an allowed family, allowed by --allow-family-pages)');
    expect((await compare(allowedTask, { allowFamily: [] })).failing).toEqual(['ix']);

    // a non-task entry differs: needs judgment, unless its group is allowed
    const audit = await backup('audit', (s) => write(join(s, 'v03', 'audits', 'ix-01-alpha.audit.json'), 'changed'));
    const au = await compare(audit);
    expect(au.exitCode).toBe(3);
    expect(au.judgment).toEqual({ entries: 1, records: 0, pages: 0, familyPages: 0 });
    expect(au.groups[0]).toEqual({ group: 'v03/audits', allowed: false, allowedNamed: 1, ...c0, same: 1, changed: 1 });
    expect(reportLines(au).at(-2)).toStartWith('COMPARE: needs judgment: every task outside --allow-family is identical, but 1 non-task entr(ies), 0 slice record(s), 0 corpus page(s) not named for an allowed family and 0 named for one (allowed only with --allow-family-pages) differ outside --allow-group; checked ');
    expect((await compare(audit, { allowGroup: ['v03/audits'] })).exitCode).toBe(0);

    // slice records: changed and added records need judgment, unless the slice's group is allowed
    const sliced = await backup('slice', (s) => write(join(s, 'v03', 'world', 'slice.json'), JSON.stringify({ ...SLICE, channels: [...SLICE.channels, { id: 'c2', name: 'two' }], messages: [{ id: 'm2', text: 'changed' }, SLICE.messages[0]] })));
    const sl = await compare(sliced);
    expect(sl.exitCode).toBe(3);
    expect(sl.slice).toEqual([{ collection: '(other keys)', ...c0, same: 1 }, { collection: 'channels', ...c0, same: 1, added: 1 }, { collection: 'messages', ...c0, same: 1, changed: 1 }]);
    expect(sl.judgment).toEqual({ entries: 0, records: 2, pages: 0, familyPages: 0 });
    expect(sl.groups.find((g) => g.group === 'v03/world')).toEqual({ group: 'v03/world', allowed: false, allowedNamed: 0, ...c0, same: 1 });
    expect((await compare(sliced, { allowGroup: ['v03/world'] })).exitCode).toBe(0);
    await expect(compare(await backup('bad-slice', (s) => write(join(s, 'v03', 'world', 'slice.json'), '{ not json')))).rejects.toThrow('HE-SEALED-006 --slice is not JSON in backup b; nothing was pushed or printed');
    await expect(compare(sliced, { slice: 'v03/world/missing.json' })).rejects.toThrow('HE-SEALED-006 --slice is not in either backup');

    // a corpus page not named for an allowed family: needs judgment
    const page = await compare(await backup('page', (s) => write(join(s, 'v03', 'corpus-seal', 'heldout', 'chats', 'page.md'), 'changed\n')));
    expect(page.exitCode).toBe(3);
    expect(page.corpus).toEqual({ ...c0, same: 1, changed: 1, allowedNamed: 0, otherNamed: 1, allowed: false });
    expect(page.judgment).toEqual({ entries: 0, records: 0, pages: 1, familyPages: 0 });

    // a task outside the allowed families changed, added or removed: fail
    expect((await compare(await backup('other', (s) => write(join(tasksDir(s), 'sx-01-gamma', 'task.toml'), 'changed\n')))).failing).toEqual(['sx']);
    const ad = await compare(await backup('added', (s) => write(join(tasksDir(s), 'qq-02-epsilon', 'task.toml'), CANARY.task)));
    expect(ad.families.find((x) => x.family === 'qq')).toEqual({ family: 'qq', allowed: false, ...c0, same: 1, added: 1 });
    const rm = await compare(await backup('removed', (s) => rmSync(join(tasksDir(s), 'qq-01-delta'), { recursive: true })));
    expect(rm.families.find((x) => x.family === 'qq')).toEqual({ family: 'qq', allowed: false, ...c0, removed: 1 });
    expect([ad.exitCode, rm.exitCode]).toEqual([1, 1]);
  }, 300_000);

  test('compare-backups: the executable bit and empty directories count, in tasks and outside them', async () => {
    const taskMode = await compare(await backup('task-mode', (s) => chmodSync(join(tasksDir(s), 'sx-01-gamma', 'task.toml'), 0o755)));
    expect([taskMode.exitCode, taskMode.failing]).toEqual([1, ['sx']]);
    const fileMode = await compare(await backup('file-mode', (s) => chmodSync(join(s, 'v03', 'selected', 'exclusions.json'), 0o755)));
    expect(fileMode.exitCode).toBe(3);
    expect(fileMode.groups.find((g) => g.group === 'v03/selected')).toEqual({ group: 'v03/selected', allowed: false, allowedNamed: 0, ...c0, same: 1, changed: 1 });
    const pageMode = await compare(await backup('page-mode', (s) => chmodSync(join(s, 'v03', 'corpus-seal', 'heldout', 'chats', 'page.md'), 0o755)));
    expect(pageMode.corpus).toEqual({ ...c0, same: 1, changed: 1, allowedNamed: 0, otherNamed: 1, allowed: false });
    const taskDir = await compare(await backup('task-dir', (s) => mkdirSync(join(tasksDir(s), 'sx-01-gamma', 'empty'))));
    expect([taskDir.exitCode, taskDir.failing]).toEqual([1, ['sx']]);
    const otherDir = await compare(await backup('other-dir', (s) => mkdirSync(join(s, 'v03', 'world', 'empty'))));
    expect(otherDir.exitCode).toBe(3);
    expect(otherDir.groups.find((g) => g.group === 'v03/world')).toEqual({ group: 'v03/world', allowed: false, allowedNamed: 0, ...c0, same: 1, added: 1 });
  }, 300_000);

  test('compare-backups: a family with no prefix or an odd prefix, and a group whose name is a file or a task, print only as labels', async () => {
    const loner = await compare(await backup('loner', (s) => write(join(tasksDir(s), 'loner', 'task.toml'), CANARY.task)));
    expect(loner.failing).toEqual(['(none)']);
    expect(loner.families[0]).toEqual({ family: '(none)', allowed: false, ...c0, added: 1 });
    const odd = await compare(await backup('odd', (s) => write(join(tasksDir(s), 'wxyzq-01-odd', 'task.toml'), CANARY.task)));
    expect(odd.failing).toEqual([sha256('wxyzq').slice(0, 12)]);
    // a backup with no v03/ root: audits/<file> and world/slice.json would be labels; they print as digests
    const noRoot = (name: string, edit: (s: string) => void = () => {}) => backup(name, edit, { root: 'v03', paths: ['selected', 'audits', 'world', 'corpus-seal'] });
    const plainA = await noRoot('noroot-a');
    const nr = await compare(await noRoot('noroot-b', (s) => write(join(s, 'v03', 'audits', 'ix-01-alpha.audit.json'), 'changed')), { tasks: 'selected/tasks', slice: undefined, corpus: undefined }, plainA);
    expect(nr.exitCode).toBe(3);
    const h = (s: string) => sha256(s).slice(0, 12);
    const auditLabel = `audits/${h('ix-01-alpha.audit.json')}`;
    expect(nr.groups.find((g) => g.group === auditLabel)).toEqual({ group: auditLabel, allowed: false, allowedNamed: 1, ...c0, changed: 1 });
    expect(nr.groups.map((g) => g.group)).toEqual(['audits', 'corpus-seal', 'corpus-seal/heldout', `selected/${h('exclusions.json')}`, 'selected/tasks', auditLabel, 'world', `world/${h('slice.json')}`].sort());
    expect((await compare(await noRoot('noroot-c', (s) => write(join(s, 'v03', 'audits', 'ix-01-alpha.audit.json'), 'changed')), { tasks: 'selected/tasks', slice: undefined, corpus: undefined, allowGroup: [auditLabel] }, plainA)).exitCode).toBe(0);
    // a directory named like a task prints as a digest too
    const dirTask = await compare(await backup('dir-task', (s) => write(join(s, 'v03', 'ix-01-alpha-scratch', 'x.md'), 'x')));
    expect(dirTask.groups.map((g) => g.group)).toContain(`v03/${h('ix-01-alpha-scratch')}`);
    expect(JSON.stringify([loner, odd, nr, dirTask])).not.toMatch(/loner|wxyzq|ix-01-alpha|slice\.json|exclusions/);
  }, 300_000);

  test('compare-backups: group segments print only when lowercase words, free of task ids and family prefixes, and a directory in both backups', async () => {
    const h = (s: string) => sha256(s).slice(0, 12);
    const probe = async (name: string, edit: (s: string) => void, o: Partial<CompareOptions> = {}) => (await compare(await backup(name, edit), o)).groups.map((g) => g.group);
    // a task id outside --tasks, with digits and uppercase
    expect(await probe('probe-ar', (s) => write(join(s, 'v03', 'ar-99-SYNTHETIC_HIDDEN_ID', 'x.md'), 'x'))).toContain(`v03/${h('ar-99-SYNTHETIC_HIDDEN_ID')}`);
    // a lowercase name that contains a task id
    expect(await probe('probe-trace', (s) => write(join(s, 'v03', 'trace_ix-01-alpha', 'x.md'), 'x'))).toContain(`v03/${h('trace_ix-01-alpha')}`);
    // digits outside a leading v<digits>
    expect(await probe('probe-zz', (s) => write(join(s, 'v03', 'zz-09-omega', 'x.md'), 'x'))).toContain(`v03/${h('zz-09-omega')}`);
    // a task id in another case
    expect(await probe('probe-upper', (s) => write(join(s, 'v03', 'IX-01-ALPHA', 'x.md'), 'x'))).toContain(`v03/${h('IX-01-ALPHA')}`);
    // a family prefix named only by --allow-family, and one only in a task directory
    expect(await probe('probe-allowed', (s) => write(join(s, 'v03', 'notes_ar-draft', 'x.md'), 'x'), { allowFamily: ['ix', 'ar'] })).toContain(`v03/${h('notes_ar-draft')}`);
    expect(await probe('probe-family', (s) => write(join(s, 'v03', 'old_qq-pages', 'x.md'), 'x'))).toContain(`v03/${h('old_qq-pages')}`);
    // a file in one backup and a directory in the other
    const fileA = await backup('probe-flip-a', (s) => write(join(s, 'v03', 'flipname'), 'x'));
    const flip = await compare(await backup('probe-flip-b', (s) => write(join(s, 'v03', 'flipname', 'x.md'), 'x')), {}, fileA);
    expect(flip.groups.map((g) => g.group)).toContain(`v03/${h('flipname')}`);
    // a plain directory name still prints
    expect(await probe('probe-plain', (s) => write(join(s, 'v03', 'review_notes', 'x.md'), 'x'))).toContain('v03/review_notes');
    expect(printed.join('\n')).not.toMatch(/SYNTHETIC_HIDDEN_ID|trace_ix|zz-09|IX-01|notes_ar|old_qq|flipname/);
  }, 300_000);

  test('compare-backups: a top-level __proto__ key in the slice is compared like any other key', async () => {
    const proto = (x: number) => (s: string) => write(join(s, 'v03', 'world', 'slice.json'), JSON.stringify(SLICE).replace('{', `{"__proto__":{"x":${x}},`));
    const a = await backup('proto-a', proto(1));
    const r = await compare(await backup('proto-b', proto(2)), {}, a);
    expect(r.slice!.find((s) => s.collection === '(other keys)')).toEqual({ collection: '(other keys)', ...c0, changed: 1 });
    expect(r.exitCode).toBe(3);
    expect((await compare(await backup('proto-c', proto(1)), {}, a)).exitCode).toBe(0);
  }, 120_000);

  test('compare-backups: --family-field groups tasks by their task.toml family across several --tasks, and --manifest-commit checks a manifest key', async () => {
    const h = (s: string) => sha256(s).slice(0, 12);
    const head = fixtureGit(f.repo, 'rev-parse', 'HEAD');
    const FAM: Record<string, string> = { 'ix-01-alpha': 'approval_relay', 'ix-02-beta': 'synthesis', 'sx-01-gamma': 'approval_relay', 'qq-01-delta': 'zz_secret_fam' };
    const famTree = (s: string, o: { family?: Record<string, string>; body?: Record<string, string>; manifest?: unknown } = {}) => {
      const toml = (t: string) => `# synthetic\nid = "${t}"\nfamily = "${o.family?.[t] ?? FAM[t]}"\ntitle = "${CANARY.task} ${t} ${o.body?.[t] ?? ''}"\n`;
      for (const t of Object.keys(FAM)) write(join(tasksDir(s), t, 'task.toml'), toml(t));
      for (const t of ['ix-02-beta', 'sx-01-gamma']) write(join(s, 'v03', 'candidates', t, 'task.toml'), toml(`${t}`) + (o.body?.[`cand:${t}`] ?? ''));
      write(join(s, 'v03', 'GEN6-MANIFEST.json'), JSON.stringify(o.manifest ?? { proof: { template_commit: head.slice(0, 9) } }));
      write(join(s, 'v03', 'zz_secret_fam', 'notes.txt'), 'a non-task directory named for a family that is not public\n');
      write(join(s, 'v03', 'zz-secret-fam', 'notes.txt'), 'the same family name with dashes\n');
    };
    const fa = await backup('ff-a', (s) => famTree(s));
    const field = { tasks: ['v03/selected/tasks', 'v03/candidates'], familyField: true, allowFamily: ['approval_relay'], publicFamilies: ['approval_relay', 'synthesis', 'continuity'], manifest: 'v03/GEN6-MANIFEST.json', manifestCommit: [`proof.template_commit=${head}`] };
    const sel = 'v03/selected/tasks', cand = 'v03/candidates';

    // only approval_relay tasks changed, in both task directories: pass, with counts by family and a manifest match
    const ok = await compare(await backup('ff-ok', (s) => famTree(s, { body: { 'ix-01-alpha': 'rerendered', 'cand:sx-01-gamma': '# rerendered\n' } })), field, fa);
    expect([ok.failing, ok.manifest]).toEqual([[], [{ key: 'proof.template_commit', commit: head, match: true }]]);
    expect(ok.exitCode).toBe(0);
    expect(ok.families).toHaveLength(5);
    expect(ok.families).toEqual(expect.arrayContaining([
      { tasks: sel, family: 'approval_relay', allowed: true, ...c0, same: 1, changed: 1 },
      { tasks: sel, family: 'synthesis', allowed: false, ...c0, same: 1 },
      { tasks: sel, family: h('zz_secret_fam'), allowed: false, ...c0, same: 1 },
      { tasks: cand, family: 'approval_relay', allowed: true, ...c0, changed: 1 },
      { tasks: cand, family: 'synthesis', allowed: false, ...c0, same: 1 },
    ]));
    expect(ok.manifest).toEqual([{ key: 'proof.template_commit', commit: head, match: true }]);
    const lines = reportLines(ok);
    expect(lines).toContain(`COMPARE: family approval_relay in ${sel} (allowed to differ): same 1, changed 1, added 0, removed 0 task(s)`);
    expect(lines).toContain(`COMPARE: family synthesis in ${cand}: same 1, changed 0, added 0, removed 0 task(s)`);
    expect(lines).toContain(`COMPARE: manifest key proof.template_commit names commit ${head}: match`);
    expect(lines.at(-2)).toStartWith(`COMPARE: pass: checked every task directory under --tasks ${sel}, ${cand} by family field (identical outside --allow-family: approval_relay); `);

    // a task in a family outside --allow-family changed, or a task changed family: fail
    const other = await compare(await backup('ff-other', (s) => famTree(s, { body: { 'qq-01-delta': 'changed' } })), field, fa);
    expect([other.exitCode, other.failing]).toEqual([1, [h('zz_secret_fam')]]);
    const moved = await compare(await backup('ff-moved', (s) => famTree(s, { family: { 'sx-01-gamma': 'synthesis' } })), field, fa);
    expect([moved.exitCode, moved.failing]).toEqual([1, ['(moved)']]);
    const unread = await compare(await backup('ff-unread', (s) => famTree(s, { body: { 'cand:sx-01-gamma': 'not toml\n' } })), field, fa);
    expect([unread.exitCode, unread.failing]).toEqual([1, ['(moved)']]);
    const noFamily = await backup('ff-nofam', (s) => famTree(s, { family: { 'sx-01-gamma': '' } }));
    const unreadNoFamily = await compare(await backup('ff-nofam-unread', (s) => famTree(s, { family: { 'sx-01-gamma': '' }, body: { 'cand:sx-01-gamma': 'not toml\n' } })), field, noFamily);
    expect([unreadNoFamily.exitCode, unreadNoFamily.failing]).toEqual([1, ['(moved)']]);
    const hiddenDir = (s: string) => { famTree(s); write(join(s, 'v03', 'zz_secret_fam', 'zz-01-eps', 'task.toml'), 'family = "synthesis"\n'); };
    const echoed = await compare(await backup('ff-dir-b', hiddenDir), { ...field, tasks: [sel, 'v03/zz_secret_fam'] }, await backup('ff-dir-a', hiddenDir));
    expect(echoed.tasks).toEqual([sel, `v03/${h('zz_secret_fam')}`]);
    expect(echoed.families).toContainEqual({ tasks: `v03/${h('zz_secret_fam')}`, family: 'synthesis', allowed: false, ...c0, same: 1 });
    expect(JSON.stringify(echoed) + reportLines(echoed).join('\n')).not.toMatch(/zz.secret.fam|zz-01/);

    // the manifest key names another commit, is not a commit, or is missing: fail, and the value never prints
    for (const [name, manifest] of [['ff-m1', { proof: { template_commit: 'deadbeef1' } }], ['ff-m2', { proof: { template_commit: 'not a commit' } }], ['ff-m3', { proof: {} }], ['ff-m4', { proof: { template_commit: 'HEAD' } }]] as const) {
      const m = await compare(await backup(name, (s) => famTree(s, { manifest })), { ...field, allowGroup: ['v03/' + h('GEN6-MANIFEST.json')] }, fa);
      expect([m.exitCode, m.failing, m.manifest]).toEqual([1, [], [{ key: 'proof.template_commit', commit: head, match: false }]]);
      expect(reportLines(m).at(-2)).toBe('COMPARE: fail: manifest key(s) do not name the expected commit: proof.template_commit');
      expect(reportLines(m).join('\n')).not.toMatch(/deadbeef1|not a commit/);
    }
    // a branch or tag named like a hex value does not stand in for the commit it would abbreviate
    fixtureGit(f.repo, 'tag', 'abcdef1234', 'HEAD');
    try {
      const tagged = await compare(await backup('ff-tag', (s) => famTree(s, { manifest: { proof: { template_commit: 'abcdef1234' } } })), { ...field, allowGroup: ['v03/' + h('GEN6-MANIFEST.json')] }, fa);
      expect([tagged.exitCode, tagged.manifest]).toEqual([1, [{ key: 'proof.template_commit', commit: head, match: false }]]);
    } finally { fixtureGit(f.repo, 'tag', '-d', 'abcdef1234'); }
    await expect(compare(fa, { ...field, manifest: 'v03/missing.json' }, base)).rejects.toThrow('HE-SEALED-006 --manifest is not a file in backup b; nothing was pushed or printed');
    await expect(compare(fa, { ...field, manifestCommit: ['proof.template_commit=no-such-rev'] }, base)).rejects.toThrow('HE-SEALED-006 --manifest-commit proof.template_commit names no commit in --repo; nothing was decrypted');
    await expect(compare(fa, { ...field, manifest: undefined }, base)).rejects.toThrow('HE-SEALED-006 --manifest-commit needs --manifest; nothing was decrypted');
    await expect(compare(fa, { ...field, manifestCommit: [] }, base)).rejects.toThrow('HE-SEALED-006 --manifest needs at least one --manifest-commit; nothing was decrypted');
    await expect(compare(fa, { ...field, manifestCommit: ['=HEAD'] }, base)).rejects.toThrow('HE-SEALED-006 --manifest-commit takes <key>=<commit>');
    await expect(compare(fa, { ...field, tasks: ['v03', cand] }, base)).rejects.toThrow(`HE-SEALED-006 --tasks ${cand} is inside --tasks v03; nothing was decrypted`);

    // the CLI takes the same flags
    const b = await backup('ff-cli', (s) => famTree(s, { body: { 'ix-01-alpha': 'rerendered' } }));
    const r = cli('compare-backups.ts', ['--a', fa.file, '--a-sha256', fa.sha, '--b', b.file, '--b-sha256', b.sha, '--tasks', sel, '--tasks', cand, '--family-field', '--allow-family', 'approval_relay', '--manifest', field.manifest, '--manifest-commit', `proof.template_commit=${head}`, '--set', SET]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`COMPARE: manifest key proof.template_commit names commit ${head}: match`);
    expect(r.stdout).toContain(`COMPARE: family ${h('synthesis')} in ${cand}: same 1, changed 0, added 0, removed 0 task(s)`);
    expect(ok.groups).toContainEqual(expect.objectContaining({ group: `v03/${h('zz_secret_fam')}`, changed: 0 }));
    expect(JSON.stringify([ok, other, moved]) + r.stdout).not.toMatch(/zz.secret.fam|ix-0|sx-0|qq-0/);
  }, 300_000);

  test('compare-backups refusals before anything is decrypted, and a backup the custody identity cannot open', async () => {
    const same = await backup('same-refusal');
    const before = logLength();
    await expect(compare(base)).rejects.toThrow('HE-SEALED-006 --a-sha256 and --b-sha256 are the same digest; compare two different backups. Nothing was decrypted');
    await expect(compare(same, { slice: 'v03/selected/tasks/x.json' })).rejects.toThrow('HE-SEALED-006 --slice v03/selected/tasks/x.json overlaps --tasks');
    await expect(compare(same, { corpus: '../x' })).rejects.toThrow('HE-SEALED-006 --corpus ../x must be a path under the unpacked backup');
    await expect(compare(same, { allowFamily: ['ix-01'] })).rejects.toThrow('HE-SEALED-006 --allow-family takes a family prefix');
    await expect(compare(same, { set: 'vnone' })).rejects.toThrow('HE-SEALED-006 refs/heads/custody has no vnone/bundle.tar.age');
    const toAuthor = await backup('compare-to-author', () => {}, { recipient: author.recipient });
    await expect(compare(toAuthor)).rejects.toThrow(`HE-SEALED-006 --b ${toAuthor.file} did not decrypt with the custody identity; nothing was written`);
    await expect(compare(same, { tasks: 'v03/nothing' })).rejects.toThrow('HE-SEALED-006 --tasks v03/nothing holds no task directory in either backup');
    expect(logLength()).toBe(before);
    // the CLI: exit codes 0, 1 and 3, and usage errors
    const other = await backup('cli-other', (s) => write(join(tasksDir(s), 'sx-01-gamma', 'task.toml'), 'changed\n'));
    const audit = await backup('cli-audit', (s) => write(join(s, 'v03', 'audits', 'ix-01-alpha.audit.json'), 'changed'));
    const args = (b: { file: string; sha: string }, extra: string[] = []) => ['--a', base.file, '--a-sha256', base.sha, '--b', b.file, '--b-sha256', b.sha, '--tasks', 'v03/selected/tasks', '--slice', 'v03/world/slice.json', '--corpus', 'v03/corpus-seal', '--allow-family', 'ix', '--set', SET, ...extra];
    const pass = cli('compare-backups.ts', args(same));
    expect(pass.status).toBe(0);
    expect(pass.stdout).toContain('COMPARE: family ix (allowed to differ): same 2, changed 0, added 0, removed 0 task(s)\n');
    expect(pass.stdout).toContain('COMPARE: slice messages: same 2, changed 0, added 0, removed 0 record(s)\n');
    expect(pass.stdout).toContain('COMPARE: corpus: same 2, changed 0, added 0, removed 0 page(s); of the differing pages 0 are named for an allowed family and 0 are not\n');
    expect(pass.stdout).toContain('COMPARE: pass: checked every task directory under --tasks');
    const fail1 = cli('compare-backups.ts', args(other));
    expect(fail1.status).toBe(1);
    expect(fail1.stdout).toContain('COMPARE: fail: tasks differ in family outside --allow-family: sx\n');
    const judge = cli('compare-backups.ts', args(audit));
    expect(judge.status).toBe(3);
    expect(judge.stdout).toContain('COMPARE: non-task v03/audits: same 1, changed 1, added 0, removed 0 entr(ies); 1 of the differing entries are named for an allowed family\n');
    expect(judge.stdout).toContain('COMPARE: needs judgment: ');
    const allowed = cli('compare-backups.ts', args(audit, ['--allow-group', 'v03/audits', '--allow-group', 'v03/world']));
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toContain('COMPARE: non-task v03/audits (allowed to differ): ');
    expect(allowed.stdout).toContain('(identical outside --allow-group: v03/audits, v03/world)');
    const pages = await backup('cli-pages', (s) => write(join(s, 'v03', 'corpus-seal', 'heldout', 'notes', 'ix-02-beta-brief.md'), 'changed\n'));
    expect(cli('compare-backups.ts', args(pages)).status).toBe(3);
    const pagesOk = cli('compare-backups.ts', args(pages, ['--allow-family-pages']));
    expect(pagesOk.status).toBe(0);
    expect(pagesOk.stdout).toContain('every --corpus page (1 differing page(s) named for an allowed family, allowed by --allow-family-pages)');
    const mid = logLength();
    expect(mid).toBe(before + 6);
    for (const [cmd, err] of [
      [['--a', base.file, '--a-sha256', 'abc', '--b', same.file, '--b-sha256', same.sha, '--tasks', 'v03/selected/tasks', '--set', SET], 'HE-RUN-002 --a-sha256 must be 64 hex characters; nothing was decrypted'],
      [['--a', base.file, '--b', same.file, '--b-sha256', same.sha, '--tasks', 'v03/selected/tasks', '--set', SET], 'HE-RUN-002 --a-sha256 <hex> is required'],
      [[...args(same), '--b-sha256', base.sha], 'HE-RUN-002 --b-sha256 given more than once'],
      [[...args(same), '--slice', 'x'], 'HE-RUN-002 --slice given more than once'],
      [[...args(same), '--allow-family-pages', '--allow-family-pages'], 'HE-RUN-002 --allow-family-pages given more than once'],
      [[...args(same), '--tasks'], 'HE-RUN-002 a flag without a value; every flag takes one value except --allow-family-pages'],
      [args({ file: same.file, sha: base.sha }), 'HE-SEALED-006 --a-sha256 and --b-sha256 are the same digest'],
      [args({ file: same.file, sha: sha256('another') }), 'HE-SEALED-006 --b '],
    ] as const) {
      const r1 = cli('compare-backups.ts', [...cmd]);
      expect(r1.status).toBe(2);
      expect(r1.stdout).toBe('');
      expect(r1.stderr).toStartWith(err);
    }
    expect(logLength()).toBe(mid);
    // the compared lines are valid custody commits with no recipient
    const c = fresh();
    const last = readAccessLog(c).at(-1)!;
    expect(Object.keys(last).sort()).toEqual(['at', 'custodian', 'event', 'output_sha256', 'run_id', 'schema_version', 'set', 'source_sha256']);
    expect(last).toMatchObject({ event: 'compared', run_id: '*', set: SET, source_sha256: base.sha, output_sha256: pages.sha, custodian: 'internal-task' });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: c, encoding: 'utf8', env: SCRUBBED_ENV }).trim();
    expect(validateCustodyChange(c, `${head}~6`, head)).toEqual([]);
  }, 300_000);

  test('reencrypted and compared lines are not openings; after an opening, and after a release, both scripts refuse the set', async () => {
    const c = fresh();
    const events = readAccessLog(c).filter((e) => e.set === SET).map((e) => e.event);
    expect(events).toContain('reencrypted');
    expect(events).toContain('compared');
    expect(events).not.toContain('opened');
    expect(openedRuns(c, SET).size).toBe(0);
    const spec = { runId: 'syn-rekey', dir: '2026-11-03-syn-rekey', label: 'confirmatory' as const, candidate: candidate('rekey') };
    register(f, spec);
    const r = await openRun({ repo: f.repo, prereg: `docs/benchmarks/${spec.dir}/prereg.json`, ...co(f), out: join(f.work, 'root-rekey'), log: () => undefined });
    expect(r.resumed).toBe(false);
    expect(r.opening).toBe(1);
    rmSync(join(f.work, 'root-rekey'), { recursive: true, force: true });
    expect(openedRuns(fresh(), SET).size).toBe(1);
    const same = await backup('after-open');
    const before = logLength();
    const rekey = () => rekeyBackup({ repo: f.repo, set: SET, backup: base.file, sha256: base.sha, to: author.recipient, out: join(f.work, 'after', 'out.tar.age'), recipient: f.recipient, ...co(f) });
    await expect(rekey()).rejects.toThrow(`HE-SEALED-006 set ${SET} has 1 opened run(s) in the access log on refs/heads/custody; regeneration is for a sealed set that was never opened. Nothing was decrypted`);
    await expect(compare(same)).rejects.toThrow(`HE-SEALED-006 set ${SET} has 1 opened run(s)`);
    const rel = cloneCustody(f, 'release-line');
    compareAndPush(rel, { message: () => 'synthetic release', decide: () => ({ schema_version: 1, event: 'released', at: 'now', run_id: '*', set: SET, bundle_sha256: sha256('x'), custodian: 'synthetic' }) });
    await expect(rekey()).rejects.toThrow(`HE-SEALED-006 set ${SET} has a "released" line in the access log on refs/heads/custody; regeneration is for a sealed set that was never opened. Nothing was decrypted`);
    await expect(compare(same)).rejects.toThrow(`HE-SEALED-006 set ${SET} has a "released" line`);
    expect(logLength()).toBe(before + 1);
    expect(existsSync(join(f.work, 'after'))).toBe(false);
  }, 180_000);

  test('publicFamilies reads the family key of every committed task.toml under tasks/', () => {
    expect(publicFamilies(ROOT)).toEqual(expect.arrayContaining(['approval_relay', 'continuity', 'corrections', 'scope_isolation', 'shared_channel', 'synthesis']));
    const repo = join(f.tmp, 'families-repo');
    write(join(repo, 'tasks', 'a', 'task.toml'), 'family = "pub_fam"\n');
    fixtureGit(repo, 'init', '-q', '-b', 'main');
    fixtureGit(repo, 'config', 'user.email', 'custody-test@example.invalid');
    fixtureGit(repo, 'config', 'user.name', 'custody test');
    fixtureGit(repo, 'add', '-A');
    fixtureGit(repo, 'commit', '-q', '-m', 'synthetic');
    write(join(repo, 'tasks', 'a', 'task.toml'), 'family = "edited_fam"\n');
    write(join(repo, 'tasks', 'b', 'task.toml'), 'family = "staged_fam"\n');
    fixtureGit(repo, 'add', 'tasks/b/task.toml');
    expect(publicFamilies(repo)).toEqual(['pub_fam']);
    mkdirSync(join(f.tmp, 'not-a-repo'), { recursive: true });
    expect(() => publicFamilies(join(f.tmp, 'not-a-repo'))).toThrow('HE-SEALED-006 --family-field reads the task.toml families committed at HEAD in --repo');
  });

  test('no decrypted text, task id or path below the second segment reached stdout or stderr', () => {
    const all = printed.join('\n');
    expect(all).toContain('COMPARE: ');
    for (const s of [...Object.values(CANARY), ...TASK_IDS, ...DEEP]) expect(all).not.toContain(s);
  });
});
