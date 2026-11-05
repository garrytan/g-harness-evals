/**
 * Trial-bundle archives (docs/trial-bundle.md): a gzipped reproducible ustar of regular files, written and read with the
 * tar code sealed custody already uses (runner/heldout/sealed.ts packTar, unpackTar and safeRelPath, imported unchanged so
 * a sealed bundle's bytes and checks never move). This module adds what a downloaded archive needs on top: a size cap on
 * decompression, caps on entry count and total bytes, and a refusal code per failure.
 *
 * Reading never trusts the archive: callers hash the bytes first, then readBundleArchive gunzips under a byte cap, walks
 * the tar headers to enforce the entry and byte caps before any entry is copied, and unpackTar refuses links, devices, unsafe or duplicate paths and truncated entries.
 */
import { constants as bufferConstants } from 'node:buffer';
import { gunzipSync, gzipSync } from 'node:zlib';
import { RunnerError } from './errors.ts';
import { packTar, unpackTar, type TarEntry } from './heldout/sealed.ts';

export type { TarEntry };

export interface ArchiveCaps { maxEntries: number; maxBytes: number }
export const DEFAULT_CAPS: ArchiveCaps = { maxEntries: 200_000, maxBytes: 2 * 1024 ** 3 };

/** The largest tar a bundle under the caps can be: its file bytes plus a header and padding per entry and the end blocks. */
export const tarLimit = (caps: ArchiveCaps): number => Math.min(caps.maxBytes + caps.maxEntries * 1024 + 10240, bufferConstants.MAX_LENGTH);

/** A gzipped ustar of the entries, sorted by path, mtime 0, owner 0, mode 0644, no gzip name or time: the same entries
 *  give the same bytes on the same Bun. */
export function packBundleArchive(entries: TarEntry[]): Uint8Array {
  return new Uint8Array(gzipSync(packTar(entries.map((e) => ({ path: e.path, data: e.data }))), { level: 9 }));
}

/** The regular files of a gzipped ustar, under the caps. Throws RunnerError HE-BUNDLE-004 naming the failure (never a
 *  file's contents). */
export function readBundleArchive(bytes: Uint8Array, caps: ArchiveCaps = DEFAULT_CAPS): TarEntry[] {
  let tar: Uint8Array;
  try {
    tar = new Uint8Array(gunzipSync(bytes, { maxOutputLength: tarLimit(caps) }));
  } catch (e) {
    const code = (e as { code?: string }).code;
    throw new RunnerError('HE-BUNDLE-004', code === 'ERR_BUFFER_TOO_LARGE'
      ? `the archive expands past the ${caps.maxBytes}-byte cap; fix: it is not a trial bundle this tool reads, or raise --max-bytes for a bundle you trust`
      : `the archive is not gzip data (${code ?? 'unknown error'}); fix: download it again and check its sha256`);
  }
  let count = 0;
  let total = 0;
  for (let at = 0; at + 512 <= tar.length; ) {
    const h = tar.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const raw = Buffer.from(h.subarray(124, 136)).toString('latin1').replace(/\0.*$/s, '').trim();
    if (!/^[0-7]*$/.test(raw)) throw new RunnerError('HE-BUNDLE-004', `the archive's entry ${count + 1} has a size field that is not plain octal; fix: it is not a trial bundle this tool reads`);
    const size = parseInt(raw || '0', 8);
    count += 1;
    total += size;
    if (count > caps.maxEntries) throw new RunnerError('HE-BUNDLE-004', `the archive holds more than ${caps.maxEntries} files, past the cap`);
    if (total > caps.maxBytes) throw new RunnerError('HE-BUNDLE-004', `the archive's files total more than ${caps.maxBytes} bytes, past the cap`);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  let entries: TarEntry[];
  try {
    entries = unpackTar(tar);
  } catch (e) {
    throw new RunnerError('HE-BUNDLE-004', `the archive is not a readable trial bundle: ${e instanceof Error ? e.message : String(e)}; fix: download it again and check its sha256`);
  }
  if (entries.length > caps.maxEntries) throw new RunnerError('HE-BUNDLE-004', `the archive holds ${entries.length} files, past the cap of ${caps.maxEntries}`);
  if (entries.reduce((n, e) => n + e.data.length, 0) > caps.maxBytes) throw new RunnerError('HE-BUNDLE-004', `the archive's files total more than ${caps.maxBytes} bytes, past the cap`);
  return entries;
}
