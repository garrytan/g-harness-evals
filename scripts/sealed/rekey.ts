#!/usr/bin/env bun
/**
 * Re-encrypt a set author's backup to another age recipient, so the author can regenerate from it (docs/sealed-custody.md,
 * "Re-encrypting for regeneration"). The backup is a tar (optionally gzipped) of the author's working tree encrypted to
 * sealed/recipient.txt, as seal.ts --from-backup takes it. rekey.ts decrypts it in memory, parses it with backupEntries
 * only to refuse an unsafe tar, and encrypts the identical decrypted bytes to --to. No plaintext is written to disk.
 *
 *   bun scripts/sealed/rekey.ts --from-backup <file.tar.age> --sha256 <hex> --to <age1 recipient> --out <path> --set <set>
 *        [--custodian <name>] [--custody <isolated custody clone>] [--identity <drive copy>]
 *        [--recipient <file or age1...>, default sealed/recipient.txt] [--repo <public checkout, default .>] [--remote origin]
 *
 * The order matches seal.ts --from-backup: --sha256 (64 hex characters, uppercase accepted) is checked before anything
 * else; --to must be an age X25519 recipient the age library parses and must not be the custody recipient; --out must not
 * exist and must be outside every git work tree; then the repository must be private (checkPrivate), the backup's sha256
 * must equal --sha256 before anything is decrypted, and the identity comes only from identity.ts custodyIdentity after the
 * escrow check; the set must have a bundle on the custody branch, no opened run and no "released" line. The re-encrypted
 * bytes stay in memory while the access-log line is pushed; only after the push are they written to a temporary name
 * beside --out, fsynced and linked to --out (exclusively, never overwriting). A refused push writes nothing; a write that
 * fails after the push leaves no file and says that the line was pushed.
 *
 * The access-log line is "reencrypted" with run_id "*", the set, the custodian, source_sha256 (the backup), output_sha256
 * (the file written) and recipient (--to). It changes no other custody file and is not an opening. The CLI prints one
 * line with the two sha256 values and the custody commit, never content and never a path inside the tar.
 *
 * openBackups, wantDigest and checkSetName are shared with scripts/sealed/compare-backups.ts.
 */
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { RunnerError } from '../../runner/errors.ts';
import { decryptWith, encryptTo, sha256 } from '../../runner/heldout/sealed.ts';
import { checkPrivate, compareAndPush, CUSTODY_REF, CUSTODY_REPO, custodyClone, ESCROW_FILE, insideGitTree, isX25519Recipient, openedRuns, readAccessLog, SET_NAME, syncCustody } from './custody.ts';
import { custodyIdentity } from './identity.ts';
import { backupEntries, type BackupEntry } from './intake.ts';
import { SealRefusal } from './seal.ts';

/** What rekey.ts and compare-backups.ts take to reach custody. */
export interface CustodianOptions {
  /** The public checkout (default .), whose remote makes the custody clone when it is missing. */
  repo: string;
  /** The set the access-log line names. */
  set: string;
  /** The custody recipient: a file (default sealed/recipient.txt) or an age1 value. */
  recipient: string;
  custodian?: string;
  /** The isolated custody clone (default ~/.capy/work/custody/harness-evals). */
  custody?: string;
  /** The drive copy of the custody identity (default identity.ts DEFAULT_IDENTITY_PATH). */
  identityPath?: string;
  remote?: string;
  /** The gh binary asked for the repository's visibility (default gh on PATH). */
  gh?: string;
  /** Where UBICLOUD_API_KEY is read for the escrow check (default process.env). */
  env?: Record<string, string | undefined>;
  now?: () => string;
}

export interface RekeyOptions extends CustodianOptions {
  /** The author's backup: a tar (optionally gzipped) encrypted to the custody recipient. */
  backup: string;
  /** The sha256 the backup file must have (64 hex characters, required). */
  sha256: string;
  /** The age X25519 recipient to re-encrypt to. */
  to: string;
  /** The file to write; it must not exist. */
  out: string;
}

const fail = (msg: string): never => { throw new SealRefusal(msg); };
export const readRecipient = (r: string) => (existsSync(r) ? readFileSync(r, 'utf8') : r).trim();

/** A required backup digest flag, lowercased; refused when missing or not 64 hex characters. */
export function wantDigest(flag: string, value: string | undefined): string {
  const want = (value ?? '').toLowerCase();
  if (!want) fail(`${flag} is required, the sha256 of the backup file; nothing was decrypted`);
  if (!/^[0-9a-f]{64}$/.test(want)) fail(`${flag} must be 64 hex characters; nothing was decrypted`);
  return want;
}

export function checkSetName(set: string): void {
  if (!SET_NAME.test(set ?? '')) fail(`--set must name a set, such as v0.3 (got ${JSON.stringify(set)}); nothing was decrypted`);
}

/**
 * Refuse a set that regeneration does not apply to: one with a "released" line, one with an "opened" run, or one whose
 * <set>/bundle.tar.age is not on the custody branch. Read from the synced clone: once before anything is decrypted, and
 * again in decide() under the custody lock, so an opening or release that lands meanwhile is seen.
 */
export function refuseSetState(clone: string, set: string, outcome: string): void {
  if (readAccessLog(clone).some((e) => e.event === 'released' && e.set === set)) fail(`set ${set} has a "released" line in the access log on ${CUSTODY_REF}; regeneration is for a sealed set that was never opened. ${outcome}`);
  const opened = openedRuns(clone, set).size;
  if (opened) fail(`set ${set} has ${opened} opened run(s) in the access log on ${CUSTODY_REF}; regeneration is for a sealed set that was never opened. ${outcome}`);
  if (!existsSync(join(clone, set, 'bundle.tar.age'))) fail(`${CUSTODY_REF} has no ${set}/bundle.tar.age; --set names the sealed set the backup belongs to. ${outcome}`);
}

/**
 * After the argument checks: the repository must be private, each backup's sha256 must equal its digest (checked for
 * every backup before any is decrypted), the custody clone is synced, the set must pass refuseSetState, the identity comes
 * from custodyIdentity after the escrow check, and each backup is decrypted in memory (a failure is a refusal naming the
 * flag) and parsed whole with backupEntries, which refuses an unsafe tar. Writes nothing.
 */
export async function openBackups(o: CustodianOptions, backups: Array<{ flag: string; file: string; sha256: string }>): Promise<{ clone: string; plain: Array<{ bytes: Uint8Array; entries: BackupEntry[] }> }> {
  checkPrivate(CUSTODY_REPO, o.gh);
  const ciphertexts = backups.map((b) => {
    const bytes = new Uint8Array(readFileSync(b.file));
    if (sha256(bytes) !== b.sha256) fail(`${b.flag} ${b.file} has sha256 ${sha256(bytes).slice(0, 12)}, the digest given asks for ${b.sha256.slice(0, 12)}; nothing was decrypted`);
    return bytes;
  });
  const remote = o.remote ?? 'origin';
  const clone = custodyClone({ dir: o.custody, repo: resolve(o.repo), remote });
  syncCustody(clone, remote);
  refuseSetState(clone, o.set, 'Nothing was decrypted');
  const identity = await custodyIdentity({ identityPath: o.identityPath, escrowPath: join(clone, ESCROW_FILE), recipient: readRecipient(o.recipient), env: o.env });
  const plain: Array<{ bytes: Uint8Array; entries: BackupEntry[] }> = [];
  for (const [i, c] of ciphertexts.entries()) {
    const bytes = await decryptWith(identity, c).catch((): never => fail(`${backups[i]!.flag} ${backups[i]!.file} did not decrypt with the custody identity; nothing was written`));
    plain.push({ bytes, entries: backupEntries(bytes) });
  }
  return { clone, plain };
}

export async function rekeyBackup(o: RekeyOptions): Promise<{ sourceSha256: string; outputSha256: string; commit: string; out: string }> {
  const want = wantDigest('--sha256', o.sha256);
  if (!isX25519Recipient(o.to)) fail('--to must be an age X25519 recipient (age1 and 58 bech32 characters, as age-keygen prints); nothing was decrypted');
  if (o.to === readRecipient(o.recipient)) fail('--to is the custody recipient; a re-encrypted backup goes to the author\'s own recipient, and the custody identity already opens the original. Nothing was decrypted');
  checkSetName(o.set);
  const out = resolve(o.out);
  if (lstatSync(out, { throwIfNoEntry: false })) fail(`--out ${out} exists; rekey.ts never overwrites a file. Nothing was decrypted`);
  if (insideGitTree(out)) fail(`--out ${out} is inside a git work tree; a re-encrypted backup is kept outside every checkout. Nothing was decrypted`);
  const { clone, plain } = await openBackups(o, [{ flag: '--from-backup', file: o.backup, sha256: want }]);
  const ciphertext = await encryptTo(o.to, plain[0]!.bytes);
  const outputSha256 = sha256(ciphertext);
  const now = o.now ?? (() => new Date().toISOString());
  const pushed = compareAndPush(clone, {
    remote: o.remote ?? 'origin',
    message: () => `reencrypt a backup of ${o.set}`,
    decide: () => {
      refuseSetState(clone, o.set, 'Nothing was pushed or written');
      return { schema_version: 1, event: 'reencrypted', at: now(), run_id: '*', set: o.set, source_sha256: want, output_sha256: outputSha256, recipient: o.to, custodian: o.custodian ?? 'scripts/sealed/rekey.ts' };
    },
    onFailure: 'the backup was decrypted and re-encrypted in memory only; nothing was written',
  });
  const tmp = `${out}.rekey-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
    const fd = openSync(tmp, 'wx', 0o600);
    try {
      for (let at = 0; at < ciphertext.length;) {
        const n = writeSync(fd, ciphertext, at);
        if (n <= 0) throw new Error('short write');
        at += n;
      }
      fsyncSync(fd);
    } finally { closeSync(fd); }
    linkSync(tmp, out);
    const dirFd = openSync(dirname(out), 'r');
    try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
  } catch (e) {
    throw new SealRefusal(`the "reencrypted" access-log line was pushed in ${pushed.commit.slice(0, 12)}, but --out ${out} could not be written (${(e as NodeJS.ErrnoException).code ?? 'error'}); nothing was written to --out. The logged re-encryption reached nobody; run rekey.ts again with a new --out`);
  } finally {
    try { unlinkSync(tmp); } catch { /* never written, or already linked */ }
  }
  return { sourceSha256: want, outputSha256, commit: pushed.commit, out };
}

/** Parse a custody CLI's flags: each known flag takes one value that does not start with "--", each boolean flag takes
 *  none (flag() answers "true"), and only the repeatable ones repeat; exits 2 with HE-RUN-002. */
export function parseFlags(argv: string[], known: string[], repeatable: string[], usage: string, booleans: string[] = []): { flag: (n: string) => string | undefined; all: (n: string) => string[] } {
  const usageError = (msg: string): never => { console.error(`HE-RUN-002 ${msg}; ${usage}`); process.exit(2); };
  const seen: Array<[string, string]> = [];
  const unknown: string[] = [];
  let missing = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const name = a.startsWith('--') ? a.slice(2) : '';
    if (booleans.includes(name)) { seen.push([name, 'true']); continue; }
    if (!known.includes(name)) { unknown.push(a); if (name && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--')) i++; continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) { missing = true; continue; }
    seen.push([name, v]);
    i++;
  }
  if (unknown.length || missing) usageError(`${unknown.length ? `unknown argument(s) ${unknown.join(' ')}` : 'a flag without a value'}; every flag takes one value${booleans.length ? ` except --${booleans.join(', --')}` : ''}`);
  const names = seen.map(([n]) => n);
  const repeated = [...new Set(names.filter((n, i) => !repeatable.includes(n) && names.indexOf(n) !== i))].map((n) => `--${n}`);
  if (repeated.length) usageError(`${repeated.join(' ')} given more than once; ${repeatable.length ? `only --${repeatable.join(', --')} repeats` : 'no flag repeats'}`);
  return { flag: (n) => seen.find(([k]) => k === n)?.[1], all: (n) => seen.filter(([k]) => k === n).map(([, v]) => v) };
}

/** A custody CLI's refusal line: a RunnerError's code and message (rekey.ts and compare-backups.ts name paths, digests and
 *  entry numbers only), or the class of any other error with its message withheld. */
export function refusalLine(e: unknown, what: string): string {
  return e instanceof RunnerError ? e.message : `HE-SEALED-006 ${what} failed: ${e instanceof Error ? e.constructor.name : 'error'} (message withheld)`;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const usage = 'usage: bun scripts/sealed/rekey.ts --from-backup <file.tar.age> --sha256 <hex> --to <age1 recipient> --out <path> --set <set> [--custodian <name>] [--custody <clone>] [--identity <drive copy>] [--recipient sealed/recipient.txt] [--repo <checkout>] [--remote origin]';
  const usageError = (msg: string): never => { console.error(`HE-RUN-002 ${msg}; ${usage}`); process.exit(2); };
  const { flag } = parseFlags(argv, ['from-backup', 'sha256', 'to', 'out', 'set', 'custodian', 'custody', 'identity', 'recipient', 'repo', 'remote'], [], usage);
  const repo = flag('repo') ?? join(import.meta.dir, '..', '..');
  const recipient = flag('recipient') ?? join(repo, 'sealed', 'recipient.txt');
  if (!flag('sha256')) usageError('--sha256 <hex> is required, the sha256 of the backup file the author sent; nothing was decrypted');
  if (!/^[0-9a-fA-F]{64}$/.test(flag('sha256')!)) usageError('--sha256 must be 64 hex characters; nothing was decrypted');
  const need = ['from-backup', 'to', 'out', 'set'].filter((k) => !flag(k));
  if (need.length) usageError(`missing --${need.join(', --')}`);
  if (!isX25519Recipient(flag('to'))) usageError('--to must be an age X25519 recipient (age1 and 58 bech32 characters); nothing was decrypted');
  if (flag('to') === readRecipient(recipient)) usageError('--to is the custody recipient; re-encrypt to the author\'s own recipient. Nothing was decrypted');
  try {
    const r = await rekeyBackup({ repo, set: flag('set')!, backup: flag('from-backup')!, sha256: flag('sha256')!, to: flag('to')!, out: flag('out')!, recipient, custodian: flag('custodian'), custody: flag('custody'), identityPath: flag('identity'), remote: flag('remote') });
    console.log(`REKEY: backup sha256 ${r.sourceSha256} re-encrypted to the --to recipient as sha256 ${r.outputSha256}; "reencrypted" access-log line pushed to ${CUSTODY_REF} in ${r.commit}`);
  } catch (e) {
    console.error(refusalLine(e, 'rekey'));
    process.exit(2);
  }
}
