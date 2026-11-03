/**
 * The custody identity (docs/sealed-custody.md): one age X25519 identity, generated in-process by
 * scripts/sealed/keygen.ts and kept in a file in the harness-eval project-user drive, with an escrow copy encrypted under a
 * passphrase derived from UBICLOUD_API_KEY and kept at escrow/identity.age on the custody branch. Only scripts/sealed/* read
 * it, through custodyIdentity, which also checks the escrow every time; keygen.ts --restore recreates a lost drive copy
 * from the escrow. The identity is never printed, logged, put in argv or in an environment variable; errors name paths
 * only.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { Decrypter, Encrypter, identityToRecipient } from 'age-encryption';
import { RunnerError } from '../../runner/errors.ts';
import { LOCAL_PATH_ENV, localPath } from '../local-paths.ts';

/** The drive copy's path: HE_CUSTODY_IDENTITY, else custody_identity in config/local-paths.json (private checkout only). */
export const DEFAULT_IDENTITY_PATH: string | undefined = localPath('custody_identity');

/** The identity path a caller passed, else the default; refused (HE-SEALED-010) when neither exists. */
export function identityPath(given?: string): string {
  const path = given ?? DEFAULT_IDENTITY_PATH;
  if (!path) throw new RunnerError('HE-SEALED-010', `no custody identity path: pass --identity or set ${LOCAL_PATH_ENV.custody_identity}`);
  return path;
}
export const ESCROW_ENV = 'UBICLOUD_API_KEY';
export const ESCROW_LABEL = 'harness-evals custody escrow v1';
const IDENTITY_LINE = /^AGE-SECRET-KEY-1[0-9A-Z]+$/;

/** The escrow passphrase: HMAC-SHA256 keyed by the UBICLOUD_API_KEY value over the label, hex. Never printed. */
export function escrowPassphrase(envValue: string): string {
  return createHmac('sha256', envValue).update(ESCROW_LABEL).digest('hex');
}

/** The one AGE-SECRET-KEY-1 line of an identity file's text (age-keygen's format: comment lines, then the key). */
export function identityFromText(text: string, where: string): string {
  const keys = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (keys.length !== 1 || !IDENTITY_LINE.test(keys[0]!)) throw new RunnerError('HE-SEALED-010', `${where} does not hold exactly one AGE-SECRET-KEY-1 line`);
  return keys[0]!;
}

export const identityFileText = (identity: string, recipient: string, at: string) => `# created: ${at}\n# public key: ${recipient}\n${identity}\n`;

/** Create a file that must not exist, mode 0600, its parent 0700: written to a temporary name in the same directory and
 *  linked into place (atomic and exclusive); where the filesystem has no hard links, an O_EXCL create of the final name. */
export function createExclusive(path: string, data: string | Uint8Array): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  if (existsSync(path)) throw new RunnerError('HE-SEALED-010', `${path} already exists; nothing was written`);
  const write = (p: string) => { const fd = openSync(p, 'wx', 0o600); try { writeSync(fd, typeof data === 'string' ? new TextEncoder().encode(data) : data); fsyncSync(fd); } finally { closeSync(fd); } };
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  write(tmp);
  try {
    linkSync(tmp, path);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new RunnerError('HE-SEALED-010', `${path} already exists; nothing was written`);
    if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP' && code !== 'ENOSYS' && code !== 'EXDEV') throw e;
    write(path);
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
  chmodSync(path, 0o600);
}

export async function encryptEscrow(identityText: string, envValue: string, logN?: number): Promise<Uint8Array> {
  const e = new Encrypter();
  e.setPassphrase(escrowPassphrase(envValue));
  if (logN) e.setScryptWorkFactor(logN);
  return e.encrypt(identityText);
}

export async function decryptEscrow(bytes: Uint8Array, envValue: string, where: string): Promise<string> {
  const d = new Decrypter();
  d.addPassphrase(escrowPassphrase(envValue));
  try { return await d.decrypt(bytes, 'text'); } catch { throw new RunnerError('HE-SEALED-010', `the escrow ${where} did not decrypt with the passphrase derived from ${ESCROW_ENV}`); }
}

/**
 * The custody identity for scripts/sealed/*, after the escrow check (keygen.ts --check-escrow; open.ts runs it before
 * any decryption). Every step must hold, or HE-SEALED-012 names the step and prints nothing secret:
 *   - the drive copy exists and holds one identity that derives the expected recipient (sealed/recipient.txt);
 *   - the escrow exists and decrypts with the passphrase derived from the current UBICLOUD_API_KEY, to an identity that
 *     derives the same recipient (so a rotated key that was not re-escrowed is caught here, not on the day the drive copy
 *     is lost).
 * The drive file's mode is not checked: the drive's FUSE mount reports 0644 whatever was requested.
 * Returns the identity from the drive copy.
 */
export async function custodyIdentity(o: { identityPath?: string; escrowPath: string; recipient: string; env?: Record<string, string | undefined> }): Promise<string> {
  const path = identityPath(o.identityPath);
  const env = o.env ?? process.env;
  const want = o.recipient.trim();
  const fail = (msg: string): never => { throw new RunnerError('HE-SEALED-012', msg); };
  if (!/^age1[0-9a-z]+$/.test(want)) fail('the expected recipient is not a public age recipient (age1...); sealed/recipient.txt must hold the custody recipient');
  if (!existsSync(path)) fail(`the drive copy of the custody identity ${path} is missing; restore it from the escrow with bun scripts/sealed/keygen.ts --restore (docs/sealed-custody.md)`);
  let identity = '';
  try { identity = identityFromText(readFileSync(path, 'utf8'), path); } catch { fail(`the drive copy ${path} does not hold exactly one AGE-SECRET-KEY-1 line`); }
  if ((await identityToRecipient(identity)) !== want) fail(`the drive copy ${path} does not derive the custody recipient ${want.slice(0, 16)}...`);
  if (!existsSync(o.escrowPath)) fail(`the escrow ${o.escrowPath} is missing from the custody branch`);
  const v = env[ESCROW_ENV];
  if (!v) fail(`${ESCROW_ENV} is not set, so the escrow cannot be checked`);
  const d = new Decrypter();
  d.addPassphrase(escrowPassphrase(v!));
  let text = '';
  try { text = await d.decrypt(new Uint8Array(readFileSync(o.escrowPath)), 'text'); } catch { fail(`the escrow ${o.escrowPath} does not decrypt with the passphrase derived from the current ${ESCROW_ENV}; if the key was rotated, run bun scripts/sealed/keygen.ts --re-escrow (docs/sealed-custody.md, "Rotating UBICLOUD_API_KEY")`); }
  let escrowed = '';
  try { escrowed = identityFromText(text, o.escrowPath); } catch { fail(`the escrow ${o.escrowPath} decrypts but holds no single AGE-SECRET-KEY-1 line`); }
  if ((await identityToRecipient(escrowed)) !== want) fail(`the escrow ${o.escrowPath} decrypts to an identity that does not derive the custody recipient ${want.slice(0, 16)}...`);
  return identity;
}
