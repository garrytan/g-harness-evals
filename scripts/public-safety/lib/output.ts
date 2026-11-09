// The one output boundary (plan R2): every byte check.ts writes to stdout, stderr, --json or a trace file passes through
// a Boundary. Control and bidirectional characters are escaped, a locator that itself matches a rule or a pack value is
// replaced with an opaque one, and any free-text line that matches is withheld whole, so matched text is never printed.
import { appendFileSync } from 'node:fs';

const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

export const escapeControls = (s: string) => s.replace(UNSAFE, (c) => { const n = c.codePointAt(0)!; return n < 0x100 ? '\\x' + n.toString(16).padStart(2, '0') : '\\u{' + n.toString(16) + '}'; });

export const WITHHELD = '[line withheld by the output boundary]';

export class Boundary {
  private withheld: string[] = [];
  constructor(private rules: (s: string) => boolean) {}
  private hits(s: string): boolean { return this.rules(s) || this.withheld.some((w) => s.includes(w)); }
  // A string another detector (gitleaks) flagged: every later line or name that contains it is withheld.
  withhold(s: string): void { if (s) this.withheld.push(s); }
  safe(s: string): boolean { return !this.hits(s); }
  // A whole line of free text: escaped, or withheld when any rule or pack value matches it.
  line(s: string): string { return s.split('\n').map((l) => (this.hits(l) ? WITHHELD : escapeControls(l))).join('\n'); }
  // A name the caller wants to show (a path, member or ref): itself when clean, else the opaque fallback.
  name(raw: string, opaque: string): string { return this.hits(raw) ? opaque : escapeControls(raw); }
  out(s: string): void { process.stdout.write(this.line(s) + '\n'); }
  err(s: string): void { process.stderr.write(this.line(s) + '\n'); }
  file(path: string, s: string): void { appendFileSync(path, this.line(s) + '\n'); }
}
