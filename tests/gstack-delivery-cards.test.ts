// internal-task (plan gate change d6): the gstack steps cards and their extractor. Keyless and gstack-free, except one check that
// rebuilds the cards from a local gstack checkout when one holds the pinned commit.
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCards, CardError, CARDS_DIR, compareCommitted, gitTemplateReader, headingAt, loadSelection, renderCard, sha256, type CardLine, type Selection } from '../scripts/gstack-delivery/extract-cards.ts';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'gstack-cards-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const SEL = loadSelection();

const code = (f: () => unknown): string => { try { f(); } catch (e) { if (e instanceof CardError) return e.code; throw e; } return 'no error'; };
function fixture(lines: Array<Partial<CardLine>>, max = 700): Selection {
  return { schema: 1, note: '', gstack: { repo: 'x', commit: 'a'.repeat(40), commit_date: '', license: 'MIT', copyright: '' }, max_bytes: max,
    cards: { review: { file: 'review.md', bytes: 0, sha256: '', lines: lines.map((l, i) => ({ id: 'l' + i, file: 'review/SKILL.md.tmpl', line: 4, section: '## Rules', text: 'Read the diff.', render: 'bullet', marker: null, task_demands: null, why: '', ...l }) as CardLine) } } };
}
const TEMPLATE = ['# Title', '', '## Rules', '- Read the diff. Then stop.', '', '```bash', '# not a heading', '```', 'write the test and prove', 'it fails.'].join('\n');
const reader = (files: Record<string, string>) => (f: string) => files[f] ?? null;

describe('the committed cards', () => {
  test('rebuild from the selection text byte for byte, each at most 700 bytes, with the recorded sha256', () => {
    const built = buildCards(SEL);
    expect(built.map((b) => b.card)).toEqual(['review', 'ship']);
    for (const b of built) {
      expect(b.bytes).toBeLessThanOrEqual(700);
      expect(readFileSync(join(CARDS_DIR, b.file), 'utf8')).toBe(b.text);
      expect(SEL.cards[b.card]!.sha256).toBe(b.sha256);
      expect(SEL.cards[b.card]!.bytes).toBe(b.bytes);
      expect(b.text.endsWith('\n')).toBe(false);
    }
    expect(() => compareCommitted(SEL, built)).not.toThrow();
  });
  test('pin to a full gstack commit; every line names a template under review/ or ship/ and says why', () => {
    expect(SEL.gstack.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(SEL.gstack.license).toBe('MIT');
    for (const spec of Object.values(SEL.cards)) for (const l of spec.lines) {
      expect(l.file).toMatch(/^(review|ship)\//);
      expect(l.why.length).toBeGreaterThan(10);
    }
  });
  test('carry the MIT attribution beside them', () => {
    expect(readFileSync(join(CARDS_DIR, 'GSTACK-LICENSE.txt'), 'utf8')).toStartWith('MIT License\n\nCopyright (c) 2026 Garry Tan');
    const readme = readFileSync(join(CARDS_DIR, 'README.md'), 'utf8');
    expect(readme).toContain(SEL.gstack.commit);
    expect(readme).toContain('MIT License, Copyright (c) 2026 Garry Tan');
    for (const spec of Object.values(SEL.cards)) expect(readme).toContain(spec.sha256);
  });
  test('the --committed CLI passes', () => {
    const r = Bun.spawnSync(['bun', join(ROOT, 'scripts/gstack-delivery/extract-cards.ts'), '--committed'], { env: { PATH: process.env.PATH ?? '' } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain('EXTRACT_OK card=review');
  });
  const local = process.env.GSTACK_CAPY_ROOT ?? join(homedir(), '.local', 'share', 'gstack');
  const hasPin = existsSync(join(local, '.git')) && Bun.spawnSync(['git', '-C', local, 'cat-file', '-e', SEL.gstack.commit + '^{commit}']).exitCode === 0;
  test.skipIf(!hasPin)('rebuild from the pinned gstack templates when a local checkout holds the commit', () => {
    expect(() => compareCommitted(SEL, buildCards(SEL, gitTemplateReader(local, SEL.gstack.commit)))).not.toThrow();
  });
});

describe('the extractor fails closed with stable codes', () => {
  const files = { 'review/SKILL.md.tmpl': TEMPLATE };
  test('a line that holds its text under its heading builds; a span joins trimmed lines', () => {
    expect(buildCards(fixture([{}]), reader(files))[0]!.text).toBe('- Read the diff.');
    expect(buildCards(fixture([{ line: 9, end_line: 10, section: '## Rules', text: 'write the test and prove it fails.' }]), reader(files))[0]!.text).toBe('- write the test and prove it fails.');
    expect(renderCard([{ render: 'text', text: '# T' }, { render: 'bullet', text: 'a' }])).toBe('# T\n\n- a');
  });
  test('a fenced comment is not a heading', () => {
    expect(headingAt(TEMPLATE.split('\n'), 7)).toBe('## Rules');
  });
  test('CARD_TEXT_MOVED names where the text went', () => {
    const moved = { 'review/SKILL.md.tmpl': '\n' + TEMPLATE };
    expect(code(() => buildCards(fixture([{}]), reader(moved)))).toBe('CARD_TEXT_MOVED');
    try { buildCards(fixture([{}]), reader(moved)); } catch (e) { expect((e as Error).message).toContain('now at line 5'); }
    expect(code(() => buildCards(fixture([{ text: 'Read the whole diff.' }]), reader(files)))).toBe('CARD_TEXT_MOVED');
    expect(code(() => buildCards(fixture([{ line: 99 }]), reader(files)))).toBe('CARD_TEXT_MOVED');
  });
  test('CARD_SECTION_MOVED when the heading above the line changed', () => {
    expect(code(() => buildCards(fixture([{}]), reader({ 'review/SKILL.md.tmpl': TEMPLATE.replace('## Rules', '## Other rules') })))).toBe('CARD_SECTION_MOVED');
  });
  test('CARD_TEMPLATE_MISSING, CARD_FORBIDDEN, CARD_TOO_LARGE and CARD_MARKER_INVALID', () => {
    expect(code(() => buildCards(fixture([{}]), reader({})))).toBe('CARD_TEMPLATE_MISSING');
    for (const text of ['Run ~/.claude/skills/gstack/bin/gstack-review-log --start', 'ask via AskUserQuestion', 'Auto-fix all AUTO-FIX items', 'Apply {{PREAMBLE}}']) expect(code(() => buildCards(fixture([{ text }])))).toBe('CARD_FORBIDDEN');
    expect(code(() => buildCards(fixture([{}, {}], 10)))).toBe('CARD_TOO_LARGE');
    expect(code(() => buildCards(fixture([{ marker: 'm' }, { marker: 'm' }])))).toBe('CARD_MARKER_INVALID');
    expect(code(() => buildCards(fixture([{ marker: 'm', task_demands: 'the task says so' }])))).toBe('CARD_MARKER_INVALID');
  });
  test('CARD_GSTACK_MISSING and CARD_PIN_MISSING', () => {
    expect(code(() => gitTemplateReader(join(tmp, 'none'), 'a'.repeat(40)))).toBe('CARD_GSTACK_MISSING');
    const repo = join(tmp, 'empty');
    expect(Bun.spawnSync(['git', 'init', '-q', repo]).exitCode).toBe(0);
    expect(code(() => gitTemplateReader(repo, 'a'.repeat(40)))).toBe('CARD_PIN_MISSING');
  });
  test('CARD_DRIFT when a committed card or its sha256 differs', () => {
    const built = buildCards(SEL);
    expect(code(() => compareCommitted(SEL, built.map((b) => ({ ...b, text: b.text + ' ', sha256: sha256(b.text + ' ') }))))).toBe('CARD_DRIFT');
    const stale = structuredClone(SEL);
    stale.cards.review!.sha256 = '0'.repeat(64);
    expect(code(() => compareCommitted(stale, built))).toBe('CARD_DRIFT');
  });
  test('CARD_SELECTION_INVALID for a missing or malformed selection', () => {
    expect(code(() => loadSelection(join(tmp, 'missing.json')))).toBe('CARD_SELECTION_INVALID');
  });
});
