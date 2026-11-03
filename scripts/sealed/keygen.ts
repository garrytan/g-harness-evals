#!/usr/bin/env bun
/**
 * The custody identity's keygen and escrow (docs/sealed-custody.md). No person handles the key.
 *
 *   bun scripts/sealed/keygen.ts [--identity <path>] [--escrow <path>] [--repo <checkout, default .>]
 *   bun scripts/sealed/keygen.ts --check-escrow [--identity <path>] [--custody <clone>] [--repo .] [--remote origin]
 *   bun scripts/sealed/keygen.ts --re-escrow    [--identity <path>] [--custody <clone>] [--repo .] [--remote origin] [--gh <path>]
 *   bun scripts/sealed/keygen.ts --restore      [--identity <path>] [--custody <clone>] [--repo .] [--remote origin]
 *
 * Generation (no mode flag) makes an age X25519 identity in-process with the pinned age-encryption package and creates the
 * identity file at --identity (default: HE_CUSTODY_IDENTITY, else custody_identity in config/local-paths.json)
 * exclusively and atomically: parent directory 0700, file 0600 where the filesystem honours modes, refused when the file
 * already exists. With --escrow it also creates the escrow file the same way: the identity file's text encrypted with age's
 * scrypt passphrase mode, under a passphrase derived in-process as HMAC-SHA256 of the UBICLOUD_API_KEY value with the label
 * "harness-evals custody escrow v1" (refused before anything is written when UBICLOUD_API_KEY is not set). It reads both
 * back, checks they derive the recipient, and writes the public recipient to sealed/recipient.txt in the checkout (refused
 * when that file holds another recipient). It prints only the recipient and its sha256 fingerprint.
 *
 * The other modes work on the escrow at escrow/identity.age of the custody branch, through an isolated custody clone
 * (--custody, default ~/.capy/work/custody/harness-evals, made from the checkout's remote when missing; scripts/sealed/custody.ts):
 *   --check-escrow  fails (HE-SEALED-012, exit 2, nothing secret printed) unless the drive copy exists and derives the
 *                   recipient in sealed/recipient.txt and the escrow decrypts under the current UBICLOUD_API_KEY to an
 *                   identity deriving the same recipient. open.ts runs the same check before it decrypts anything.
 *   --re-escrow     after a UBICLOUD_API_KEY rotation: encrypts the drive copy under the passphrase derived from the current
 *                   value, decrypts the new escrow in memory and checks its recipient, and only then replaces
 *                   escrow/identity.age with it in one custody commit (an "escrowed" access-log line), pushed without force.
 *                   The old escrow stays in the branch history. It then runs --check-escrow on the pushed state. When the
 *                   escrow already decrypts under the current value it pushes nothing. Before a push it refuses unless the
 *                   repository is private (HE-SEALED-013), as seal, open and export do; --gh names the gh binary asked
 *                   (default gh on PATH; the tests pass a stand-in).
 *   --restore       when the drive copy is lost: decrypts the escrow and creates the drive copy exclusively, checking its
 *                   recipient against sealed/recipient.txt.
 * The identity is never printed, logged, passed through argv or put in the environment.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { RunnerError } from '../../runner/errors.ts';
import { sha256 } from '../../runner/heldout/sealed.ts';
import { checkPrivate, compareAndPush, CUSTODY_REPO, custodyClone, ESCROW_FILE, syncCustody } from './custody.ts';
import { createExclusive, custodyIdentity, decryptEscrow, encryptEscrow, ESCROW_ENV, identityFileText, identityFromText, identityPath as resolveIdentityPath } from './identity.ts';

export async function keygen(o: { identityPath?: string; escrowPath?: string; repo?: string; env?: Record<string, string | undefined>; now?: () => string; scryptLogN?: number }): Promise<{ recipient: string; fingerprint: string }> {
  const identityPath = resolve(resolveIdentityPath(o.identityPath));
  const escrowPath = o.escrowPath ? resolve(o.escrowPath) : undefined;
  const repo = resolve(o.repo ?? '.');
  const env = o.env ?? process.env;
  const recipientFile = join(repo, 'sealed', 'recipient.txt');
  if (existsSync(identityPath)) throw new RunnerError('HE-SEALED-010', `${identityPath} already exists; keygen never replaces an identity (a new one orphans every set sealed to the old recipient)`);
  if (escrowPath && existsSync(escrowPath)) throw new RunnerError('HE-SEALED-010', `${escrowPath} already exists; nothing was written`);
  const envValue = env[ESCROW_ENV];
  if (escrowPath && !envValue) throw new RunnerError('HE-SEALED-010', `--escrow needs ${ESCROW_ENV} in the environment (the escrow passphrase is derived from it); nothing was written`);
  if (existsSync(recipientFile) && readFileSync(recipientFile, 'utf8').trim()) throw new RunnerError('HE-SEALED-010', `${recipientFile} already names a recipient; a new identity would orphan every set sealed to it. Nothing was written`);

  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  const text = identityFileText(identity, recipient, (o.now ?? (() => new Date().toISOString()))());
  createExclusive(identityPath, text);
  if (escrowPath) createExclusive(escrowPath, await encryptEscrow(text, envValue!, o.scryptLogN));

  const back = identityFromText(readFileSync(identityPath, 'utf8'), identityPath);
  if ((await identityToRecipient(back)) !== recipient) throw new RunnerError('HE-SEALED-010', `${identityPath} read back does not derive the generated recipient`);
  if (escrowPath) {
    const recovered = identityFromText(await decryptEscrow(new Uint8Array(readFileSync(escrowPath)), envValue!, escrowPath), escrowPath);
    if ((await identityToRecipient(recovered)) !== recipient) throw new RunnerError('HE-SEALED-010', `the escrow ${escrowPath} does not recover the generated identity`);
  }
  mkdirSync(join(repo, 'sealed'), { recursive: true });
  writeFileSync(recipientFile, recipient + '\n');
  return { recipient, fingerprint: sha256(recipient) };
}

export interface EscrowOptions { identityPath?: string; custody?: string; repo?: string; remote?: string; env?: Record<string, string | undefined>; scryptLogN?: number; now?: () => string; /** The gh binary asked for the repository's visibility before a re-escrow push (default gh on PATH). */ gh?: string }

function escrowContext(o: EscrowOptions) {
  const repo = resolve(o.repo ?? '.');
  const recipientFile = join(repo, 'sealed', 'recipient.txt');
  if (!existsSync(recipientFile)) throw new RunnerError('HE-SEALED-012', `${recipientFile} is missing; the escrow is checked against the committed custody recipient`);
  const recipient = readFileSync(recipientFile, 'utf8').trim();
  const remote = o.remote ?? 'origin';
  const clone = custodyClone({ dir: o.custody, repo, remote });
  const commit = syncCustody(clone, remote);
  return { repo, recipient, remote, clone, commit, identityPath: resolve(resolveIdentityPath(o.identityPath)), escrowPath: join(clone, ESCROW_FILE), env: o.env ?? process.env };
}

/** keygen.ts --check-escrow: the drive copy and the escrow on the custody ref both derive sealed/recipient.txt. */
export async function checkEscrow(o: EscrowOptions = {}): Promise<{ fingerprint: string; commit: string | null }> {
  const c = escrowContext(o);
  await custodyIdentity({ identityPath: c.identityPath, escrowPath: c.escrowPath, recipient: c.recipient, env: c.env });
  return { fingerprint: sha256(c.recipient), commit: c.commit };
}

/** keygen.ts --re-escrow: a new escrow under the current UBICLOUD_API_KEY, verified before it replaces the old one. */
export async function reEscrow(o: EscrowOptions = {}): Promise<{ pushed: boolean; commit: string | null; fingerprint: string }> {
  const c = escrowContext(o);
  const v = c.env[ESCROW_ENV];
  if (!v) throw new RunnerError('HE-SEALED-012', `--re-escrow needs ${ESCROW_ENV} (the new passphrase is derived from it); nothing was written`);
  if (!existsSync(c.identityPath)) throw new RunnerError('HE-SEALED-012', `the drive copy ${c.identityPath} is missing; --re-escrow encrypts the drive copy (restore it first with --restore under the old key)`);
  const text = readFileSync(c.identityPath, 'utf8');
  const identity = identityFromText(text, c.identityPath);
  if ((await identityToRecipient(identity)) !== c.recipient) throw new RunnerError('HE-SEALED-012', `the drive copy ${c.identityPath} does not derive the recipient in sealed/recipient.txt; nothing was written`);
  try {
    await custodyIdentity({ identityPath: c.identityPath, escrowPath: c.escrowPath, recipient: c.recipient, env: c.env });
    return { pushed: false, commit: c.commit, fingerprint: sha256(c.recipient) };
  } catch { /* the escrow does not open under the current value: re-escrow */ }
  const fresh = await encryptEscrow(text, v, o.scryptLogN);
  const back = identityFromText(await decryptEscrow(fresh, v, 'the new escrow'), 'the new escrow');
  if ((await identityToRecipient(back)) !== c.recipient) throw new RunnerError('HE-SEALED-012', 'the new escrow does not decrypt to the custody identity; the old escrow was left in place');
  checkPrivate(CUSTODY_REPO, o.gh);
  const pushed = compareAndPush(c.clone, {
    remote: c.remote,
    message: () => 'escrow: re-encrypt the custody identity under the current UBICLOUD_API_KEY',
    decide: () => ({ schema_version: 1, event: 'escrowed', at: (o.now ?? (() => new Date().toISOString()))(), run_id: '*', set: '*', escrow_sha256: sha256(fresh), custodian: 'scripts/sealed/keygen.ts' }),
    stage: () => { mkdirSync(join(c.clone, 'escrow'), { recursive: true }); writeFileSync(c.escrowPath, fresh); return [ESCROW_FILE]; },
  });
  syncCustody(c.clone, c.remote);
  await custodyIdentity({ identityPath: c.identityPath, escrowPath: c.escrowPath, recipient: c.recipient, env: c.env });
  return { pushed: true, commit: pushed.commit, fingerprint: sha256(c.recipient) };
}

/** keygen.ts --restore: recreate a lost drive copy from the escrow. */
export async function restoreIdentity(o: EscrowOptions = {}): Promise<{ fingerprint: string }> {
  const c = escrowContext(o);
  if (existsSync(c.identityPath)) throw new RunnerError('HE-SEALED-012', `${c.identityPath} exists; --restore only recreates a missing drive copy`);
  const v = c.env[ESCROW_ENV];
  if (!v) throw new RunnerError('HE-SEALED-012', `--restore needs ${ESCROW_ENV} to decrypt the escrow; nothing was written`);
  if (!existsSync(c.escrowPath)) throw new RunnerError('HE-SEALED-012', 'the custody branch has no escrow/identity.age; losing the drive copy and the escrow means a new identity and resealing every sealed set');
  let text: string;
  try { text = await decryptEscrow(new Uint8Array(readFileSync(c.escrowPath)), v, ESCROW_FILE); } catch { throw new RunnerError('HE-SEALED-012', `the escrow does not decrypt with the passphrase derived from the current ${ESCROW_ENV}; restore needs the value it was escrowed under`); }
  if ((await identityToRecipient(identityFromText(text, ESCROW_FILE))) !== c.recipient) throw new RunnerError('HE-SEALED-012', 'the escrow decrypts to an identity that does not derive sealed/recipient.txt; nothing was written');
  createExclusive(c.identityPath, text);
  await custodyIdentity({ identityPath: c.identityPath, escrowPath: c.escrowPath, recipient: c.recipient, env: c.env });
  return { fingerprint: sha256(c.recipient) };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const valued = ['--identity', '--escrow', '--repo', '--custody', '--remote', '--gh'];
  const modes = ['--check-escrow', '--re-escrow', '--restore'];
  const unknown = argv.filter((a, i) => a.startsWith('--') && !valued.includes(a) && !modes.includes(a) && !valued.includes(argv[i - 1] ?? ''));
  const mode = modes.filter((m) => argv.includes(m));
  if (unknown.length || mode.length > 1 || (mode.length && flag('escrow'))) { console.error(`HE-RUN-002 ${unknown.length ? `unknown argument ${unknown[0]}` : 'one mode at a time'} (usage: bun scripts/sealed/keygen.ts [--identity <path>] [--escrow <path>] [--repo .] | --check-escrow | --re-escrow | --restore [--identity <path>] [--custody <clone>] [--repo .] [--remote origin] [--gh <path>])`); process.exit(2); }
  const eo: EscrowOptions = { identityPath: flag('identity'), custody: flag('custody'), repo: flag('repo'), remote: flag('remote'), gh: flag('gh') };
  try {
    if (mode[0] === '--check-escrow') {
      const r = await checkEscrow(eo);
      console.log(`ESCROW: ok; the drive copy and the escrow at refs/heads/custody ${(r.commit ?? 'unborn').slice(0, 12)} derive the recipient in sealed/recipient.txt (fingerprint sha256 ${r.fingerprint.slice(0, 12)})`);
    } else if (mode[0] === '--re-escrow') {
      const r = await reEscrow(eo);
      console.log(r.pushed ? `ESCROW: re-escrowed under the current ${ESCROW_ENV} in ${r.commit!.slice(0, 12)} on refs/heads/custody; the new escrow checks (fingerprint sha256 ${r.fingerprint.slice(0, 12)})` : `ESCROW: the escrow already decrypts under the current ${ESCROW_ENV}; nothing pushed`);
    } else if (mode[0] === '--restore') {
      const r = await restoreIdentity(eo);
      console.log(`ESCROW: drive copy restored from the escrow (fingerprint sha256 ${r.fingerprint.slice(0, 12)})`);
    } else {
      const r = await keygen({ identityPath: flag('identity'), escrowPath: flag('escrow'), repo: flag('repo') });
      console.log(`recipient ${r.recipient}`);
      console.log(`fingerprint sha256 ${r.fingerprint}`);
    }
  } catch (e) {
    console.error(e instanceof RunnerError ? e.message : `HE-SEALED-${mode.length ? '012' : '010'} keygen failed: ${e instanceof Error ? e.constructor.name : 'error'} (message withheld)`);
    process.exit(2);
  }
}
