#!/usr/bin/env bun
// The gstack steps cards for the delivery eval (HARN-61, plan gate change d6): rebuilds harnesses/routes/gstack-cards/review.md
// and ship.md from the selection list (selection.json beside them), whose every line names a gstack template file, a line
// (or a line span), the heading it sits under and the verbatim text taken from it, at the pinned gstack commit.
//
//   bun scripts/gstack-delivery/extract-cards.ts [--check] [--gstack <checkout>]   rebuild from the pinned templates and
//       compare with the committed cards and their sha256s (the default)
//   bun scripts/gstack-delivery/extract-cards.ts --write [--gstack <checkout>]      rebuild and write the cards, bytes and sha256s
//   bun scripts/gstack-delivery/extract-cards.ts --committed                        keyless and gstack-free: render the cards from
//       the selection's own text and compare with the committed files (what tests/gstack-delivery-cards.test.ts runs)
//
// The checkout defaults to $GSTACK_CAPY_ROOT, else ~/.local/share/gstack; templates are read with git at the pinned commit,
// never from the working tree, so a checkout on a newer commit still rebuilds the pinned cards. It fails closed: any problem
// prints one line "EXTRACT_FAIL code=<CODE> card=<card> line=<line id> <detail>" and exits 2. The codes are stable:
//   CARD_SELECTION_INVALID  selection.json is missing, unparseable or has a malformed entry
//   CARD_GSTACK_MISSING     no gstack checkout at the path
//   CARD_PIN_MISSING        the checkout does not hold the pinned commit
//   CARD_TEMPLATE_MISSING   the named template file does not exist at the pinned commit
//   CARD_SECTION_MOVED      the heading at or above the referenced line is not the recorded section
//   CARD_TEXT_MOVED         the recorded text is not on the referenced line(s) (the detail names where it is now, if anywhere)
//   CARD_FORBIDDEN          a card line names a gstack binary, an AskUserQuestion step, an auto-fix step or a template placeholder
//   CARD_MARKER_INVALID     a probe marker sits on more than one line, or on a line the task already demands
//   CARD_TOO_LARGE          a card is over max_bytes
//   CARD_DRIFT              the committed card, its byte count or its sha256 differs from the rebuilt card
// A card is the rendered lines joined: "text" lines are followed by a blank line, "bullet" lines are "- <text>", and the card
// carries no trailing newline (like harnesses/routes/instruction.md).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CARDS_DIR = join(import.meta.dir, '..', '..', 'harnesses', 'routes', 'gstack-cards');
export const SELECTION_FILE = join(CARDS_DIR, 'selection.json');

export const CARD_CODES = ['CARD_SELECTION_INVALID', 'CARD_GSTACK_MISSING', 'CARD_PIN_MISSING', 'CARD_TEMPLATE_MISSING', 'CARD_SECTION_MOVED',
  'CARD_TEXT_MOVED', 'CARD_FORBIDDEN', 'CARD_MARKER_INVALID', 'CARD_TOO_LARGE', 'CARD_DRIFT'] as const;
export type CardCode = (typeof CARD_CODES)[number];

export interface CardLine {
  id: string;
  file: string;
  line: number;
  end_line?: number;
  /** The nearest Markdown heading at or above line, outside code fences; null when the file has none above it. */
  section: string | null;
  /** Verbatim: a substring of the referenced line, or of the span's lines trimmed and joined with single spaces. */
  text: string;
  render: 'text' | 'bullet';
  /** The probe marker scored for this line (scripts/gstack-delivery/probes.ts), or null. */
  marker: string | null;
  /** The task text that already demands this step, or null. A demanded step carries no marker (plan d5). */
  task_demands: string | null;
  why: string;
}
export interface CardSpec { file: string; bytes: number; sha256: string; lines: CardLine[] }
export interface Selection {
  schema: 1;
  note: string;
  gstack: { repo: string; commit: string; commit_date: string; license: string; copyright: string };
  max_bytes: number;
  cards: Record<string, CardSpec>;
}

export class CardError extends Error {
  constructor(readonly code: CardCode, readonly card: string, readonly lineId: string | null, readonly detail: string) {
    super('EXTRACT_FAIL code=' + code + ' card=' + card + ' line=' + (lineId ?? '-') + ' ' + detail);
  }
}

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** gstack binaries, AskUserQuestion, auto-fix steps and unresolved template placeholders may not reach a card (plan d6). */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bgstack-[a-z]/, 'a gstack binary'],
  [/skills\/gstack|\.local\/share\/gstack|\bbin\//, 'a gstack install path'],
  [/AskUserQuestion/, 'an AskUserQuestion step'],
  [/auto-?fix/i, 'an auto-fix step'],
  [/\{\{|\}\}/, 'a template placeholder'],
];
export function forbidden(text: string): string | null {
  for (const [rx, what] of FORBIDDEN) if (rx.test(text)) return what;
  return null;
}

export function renderLine(l: Pick<CardLine, 'render' | 'text'>): string {
  return l.render === 'bullet' ? '- ' + l.text + '\n' : l.text + '\n\n';
}
export function renderCard(lines: ReadonlyArray<Pick<CardLine, 'render' | 'text'>>): string {
  return lines.map(renderLine).join('').trimEnd();
}

/** The nearest Markdown heading at or above the 1-based line, skipping fenced code blocks; null when there is none. */
export function headingAt(fileLines: readonly string[], lineNo: number): string | null {
  let fence: string | null = null, heading: string | null = null;
  for (let i = 0; i < Math.min(lineNo, fileLines.length); i++) {
    const l = fileLines[i]!;
    const f = /^\s*(~~~+|```+)/.exec(l);
    if (f) { if (fence === null) fence = f[1]![0]!; else if (f[1]![0] === fence) fence = null; continue; }
    if (fence === null && /^#{1,6}\s/.test(l)) heading = l.trimEnd();
  }
  return heading;
}

const spanText = (fileLines: readonly string[], from: number, to: number) => fileLines.slice(from - 1, to).map((l) => l.trim()).join(' ');

/** Fail closed unless the text is on the referenced line(s) under the recorded heading. template null: the file is missing. */
export function checkLine(card: string, l: CardLine, template: string | null): void {
  if (template === null) throw new CardError('CARD_TEMPLATE_MISSING', card, l.id, l.file + ' is not in the pinned commit');
  const fileLines = template.split('\n');
  const end = l.end_line ?? l.line;
  const here = end <= fileLines.length ? spanText(fileLines, l.line, end) : '';
  if (!here.includes(l.text)) {
    const width = end - l.line;
    let found: number | null = null;
    for (let i = 1; i + width <= fileLines.length && found === null; i++) if (spanText(fileLines, i, i + width).includes(l.text)) found = i;
    throw new CardError('CARD_TEXT_MOVED', card, l.id, l.file + ':' + l.line + (width ? '-' + end : '') + ' no longer holds the text' + (found === null ? ' and the file no longer has it anywhere' : '; it is now at line ' + found));
  }
  const heading = headingAt(fileLines, l.line);
  if (heading !== l.section) throw new CardError('CARD_SECTION_MOVED', card, l.id, l.file + ':' + l.line + ' sits under ' + JSON.stringify(heading) + ', not ' + JSON.stringify(l.section));
}

export function loadSelection(file = SELECTION_FILE): Selection {
  let sel: Selection;
  try { sel = JSON.parse(readFileSync(file, 'utf8')) as Selection; } catch (e) { throw new CardError('CARD_SELECTION_INVALID', '-', null, file + ': ' + (e as Error).message); }
  const bad = (card: string, id: string | null, why: string): never => { throw new CardError('CARD_SELECTION_INVALID', card, id, why); };
  if (sel?.schema !== 1 || !/^[0-9a-f]{40}$/.test(sel.gstack?.commit ?? '') || !Number.isSafeInteger(sel.max_bytes) || !sel.cards || typeof sel.cards !== 'object') bad('-', null, 'needs schema 1, gstack.commit (40 hex), max_bytes and cards');
  for (const [card, spec] of Object.entries(sel.cards)) {
    if (typeof spec.file !== 'string' || !/^[a-z0-9-]+\.md$/.test(spec.file) || !Array.isArray(spec.lines) || !spec.lines.length) bad(card, null, 'needs file (<name>.md) and lines');
    const ids = new Set<string>();
    for (const l of spec.lines) {
      if (typeof l.id !== 'string' || ids.has(l.id)) bad(card, l.id ?? null, 'needs a unique id');
      ids.add(l.id);
      if (typeof l.file !== 'string' || l.file.startsWith('/') || l.file.includes('..')) bad(card, l.id, 'file must be a path inside the gstack checkout');
      if (!Number.isSafeInteger(l.line) || l.line < 1 || (l.end_line !== undefined && (!Number.isSafeInteger(l.end_line) || l.end_line < l.line))) bad(card, l.id, 'line (and end_line) must be 1-based line numbers');
      if (typeof l.text !== 'string' || !l.text || l.text.includes('\n')) bad(card, l.id, 'text must be one non-empty line');
      if (l.render !== 'text' && l.render !== 'bullet') bad(card, l.id, 'render must be text or bullet');
      if (l.section !== null && typeof l.section !== 'string') bad(card, l.id, 'section must be a heading line or null');
    }
  }
  return sel;
}

/** Every marker on exactly one line of all cards, and never on a line the task already demands (plan d5). */
export function checkMarkers(sel: Selection): void {
  const seen = new Map<string, string>();
  for (const [card, spec] of Object.entries(sel.cards)) for (const l of spec.lines) {
    if (l.marker === null) continue;
    if (l.task_demands !== null) throw new CardError('CARD_MARKER_INVALID', card, l.id, 'marker ' + l.marker + ' sits on a line the task already demands');
    if (seen.has(l.marker)) throw new CardError('CARD_MARKER_INVALID', card, l.id, 'marker ' + l.marker + ' is also on ' + seen.get(l.marker));
    seen.set(l.marker, l.id);
  }
}

export interface BuiltCard { card: string; file: string; text: string; bytes: number; sha256: string }

/** Rebuild every card. readTemplate returns a template's text at the pinned commit, or null when it is not there; omit it
 *  to render from the selection's own text without checking the templates (--committed). */
export function buildCards(sel: Selection, readTemplate?: (file: string) => string | null): BuiltCard[] {
  checkMarkers(sel);
  const cache = new Map<string, string | null>();
  return Object.entries(sel.cards).map(([card, spec]) => {
    for (const l of spec.lines) {
      const what = forbidden(l.text);
      if (what) throw new CardError('CARD_FORBIDDEN', card, l.id, 'names ' + what);
      if (!readTemplate) continue;
      if (!cache.has(l.file)) cache.set(l.file, readTemplate(l.file));
      checkLine(card, l, cache.get(l.file)!);
    }
    const text = renderCard(spec.lines);
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > sel.max_bytes) throw new CardError('CARD_TOO_LARGE', card, null, bytes + ' bytes, over ' + sel.max_bytes);
    return { card, file: spec.file, text, bytes, sha256: sha256(text) };
  });
}

/** Templates at the pinned commit, read with git from a gstack checkout. */
export function gitTemplateReader(checkout: string, commit: string): (file: string) => string | null {
  if (!existsSync(join(checkout, '.git'))) throw new CardError('CARD_GSTACK_MISSING', '-', null, 'no gstack checkout at ' + checkout);
  const has = Bun.spawnSync(['git', '-C', checkout, 'cat-file', '-e', commit + '^{commit}'], { stdout: 'ignore', stderr: 'ignore' });
  if (has.exitCode !== 0) throw new CardError('CARD_PIN_MISSING', '-', null, checkout + ' does not hold commit ' + commit + ' (git -C ' + checkout + ' fetch origin ' + commit + ')');
  return (file) => {
    const r = Bun.spawnSync(['git', '-C', checkout, 'show', commit + ':' + file], { stdout: 'pipe', stderr: 'ignore' });
    return r.exitCode === 0 ? r.stdout.toString('utf8') : null;
  };
}

/** Compare rebuilt cards with the committed files and the selection's bytes and sha256s. */
export function compareCommitted(sel: Selection, built: BuiltCard[], dir = CARDS_DIR): void {
  for (const b of built) {
    const path = join(dir, b.file);
    const committed = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (committed !== b.text) throw new CardError('CARD_DRIFT', b.card, null, path + (committed === null ? ' is missing' : ' differs from the rebuilt card (rerun with --write)'));
    const spec = sel.cards[b.card]!;
    if (spec.sha256 !== b.sha256 || spec.bytes !== b.bytes) throw new CardError('CARD_DRIFT', b.card, null, 'selection.json records ' + spec.bytes + ' bytes, sha256 ' + spec.sha256 + '; the card is ' + b.bytes + ' bytes, sha256 ' + b.sha256);
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const opt = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const mode = argv.includes('--write') ? 'write' : argv.includes('--committed') ? 'committed' : 'check';
  try {
    const sel = loadSelection(opt('--selection') ?? SELECTION_FILE);
    const dir = opt('--cards-dir') ?? CARDS_DIR;
    const reader = mode === 'committed' ? undefined : gitTemplateReader(opt('--gstack') ?? process.env.GSTACK_CAPY_ROOT ?? join(homedir(), '.local', 'share', 'gstack'), sel.gstack.commit);
    const built = buildCards(sel, reader);
    if (mode === 'write') {
      for (const b of built) {
        writeFileSync(join(dir, b.file), b.text);
        sel.cards[b.card]!.bytes = b.bytes;
        sel.cards[b.card]!.sha256 = b.sha256;
      }
      writeFileSync(opt('--selection') ?? SELECTION_FILE, JSON.stringify(sel, null, 2) + '\n');
    } else compareCommitted(sel, built, dir);
    for (const b of built) console.log('EXTRACT_OK card=' + b.card + ' file=' + b.file + ' bytes=' + b.bytes + ' sha256=' + b.sha256 + ' gstack=' + sel.gstack.commit + ' mode=' + mode);
  } catch (e) {
    if (!(e instanceof CardError)) throw e;
    console.error(e.message);
    process.exit(2);
  }
}
