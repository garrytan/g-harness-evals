// internal-task: sealed/recipient.txt is the public age recipient of the custody identity, written by scripts/sealed/keygen.ts.
//
// Value: protects=the committed file holds exactly one age X25519 recipient line with a valid bech32 checksum and nothing
// else; fails_when=the file gains a second line, loses its trailing newline, holds a malformed or corrupted recipient, or
// carries an age secret key marker; why_new=sealed/recipient.txt is new and no other lane names it; seam=the committed
// file read from the checkout; no_claim=that the recipient matches the identity in the drive (keygen checks that when it
// writes the file).
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32ChecksumValid(s: string): boolean {
  const sep = s.lastIndexOf('1');
  const hrp = s.slice(0, sep);
  const values = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat(0, [...hrp].map((c) => c.charCodeAt(0) & 31), [...s.slice(sep + 1)].map((c) => CHARSET.indexOf(c)));
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3].forEach((g, i) => { if ((top >> i) & 1) chk ^= g; });
  }
  return chk === 1;
}

test('sealed/recipient.txt holds exactly one age1 recipient line and no secret key marker', () => {
  const text = readFileSync(join(ROOT, 'sealed', 'recipient.txt'), 'utf8');
  expect(text.endsWith('\n')).toBe(true);
  const lines = text.slice(0, -1).split('\n');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/^age1[02-9ac-hj-np-z]{58}$/);
  expect(bech32ChecksumValid(lines[0]!)).toBe(true);
  expect(text.toUpperCase()).not.toContain('AGE-SECRET-KEY-');
});
