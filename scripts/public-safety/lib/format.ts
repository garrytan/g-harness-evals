// Content sniffing shared by the public-safety gate and the public export: the format of a byte string from its magic
// bytes, never from its name.
export const FORMATS = ['text', 'empty', 'gzip', 'tar', 'sqlite', 'git-object', 'git-index', 'zip', 'xz', 'bzip2', 'zstd', '7z', 'binary'] as const;
export type Format = (typeof FORMATS)[number];

export function sniff(b: Uint8Array): Format {
  if (b.length === 0) return 'empty';
  if (b[0] === 0x1f && b[1] === 0x8b) return 'gzip';
  if (b.length >= 262 && String.fromCharCode(...b.subarray(257, 262)) === 'ustar') return 'tar';
  if (b.length >= 16 && Buffer.from(b.subarray(0, 16)).toString('latin1') === 'SQLite format 3\0') return 'sqlite';
  if (b.length >= 12 && Buffer.from(b.subarray(0, 4)).toString('latin1') === 'DIRC') return 'git-index';
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7)) return 'zip';
  if (b[0] === 0xfd && b[1] === 0x37 && b[2] === 0x7a && b[3] === 0x58) return 'xz';
  if (b[0] === 0x42 && b[1] === 0x5a && b[2] === 0x68) return 'bzip2';
  if (b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd) return 'zstd';
  if (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf) return '7z';
  return b.indexOf(0) >= 0 ? 'binary' : 'text';
}
