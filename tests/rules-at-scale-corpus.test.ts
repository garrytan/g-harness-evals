import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, jsonText, leaks, ALLOWED, sourceText } from '../scripts/rules-at-scale/corpus/build-corpus.ts';
import { filterFile, reasonsOf, splitSections } from '../scripts/rules-at-scale/corpus/filter.ts';
import { report, wilson } from '../scripts/rules-at-scale/sizes/build-sizes.ts';
import { DIR, loadFiller, loadRules, loadSources, sha256 } from '../scripts/rules-at-scale/lib.ts';

const CORPUS = join(DIR, 'corpus');
const doc = loadRules();

describe('filler corpus', () => {
  test('filler.json, drop-list.json and DROPS.md rebuild byte for byte from the pinned files', () => {
    const b = build();
    expect(readFileSync(join(CORPUS, 'filler.json'), 'utf8')).toBe(b.fillerJson);
    expect(readFileSync(join(CORPUS, 'drop-list.json'), 'utf8')).toBe(b.dropsJson);
    expect(readFileSync(join(CORPUS, 'DROPS.md'), 'utf8')).toBe(b.md);
    expect(readFileSync(join(CORPUS, 'NOTICES.md'), 'utf8')).toBe(b.notices);
  });
  test('every source is pinned by commit, permissively licensed, with its licence text and no leaks', () => {
    const sources = loadSources();
    expect(sources.length).toBeGreaterThanOrEqual(20);
    for (const s of sources) {
      expect(s.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(ALLOWED).toContain(s.license);
      const raw = readFileSync(join(CORPUS, s.file), 'utf8');
      expect(jsonText(JSON.parse(raw))).toBe(raw);
      expect(/[*/'\x60]/.test(raw)).toBe(false);
      const body = sourceText(join(CORPUS, s.file));
      expect(sha256(body)).toBe(s.sha256);
      expect(leaks(body)).toEqual([]);
      const lic = readFileSync(join(CORPUS, s.license_file), 'utf8');
      expect(lic).toContain(s.commit);
      expect(lic.length).toBeGreaterThan(500);
    }
  });
  test('kept filler touches no planted topic, carries no unsafe text, and holds enough for every arm', () => {
    const f = loadFiller();
    let bytes = 0;
    for (const s of f.sections) {
      for (const line of s.text.split('\n')) expect([line, reasonsOf(line)]).toEqual([line, []]);
      for (const r of doc.rules) expect(s.text.includes(r.text.slice(2))).toBe(false);
      expect(Object.values(doc.headings)).not.toContain(s.heading);
      bytes += Buffer.byteLength(s.text);
    }
    expect(bytes).toBeGreaterThan(doc.split_total_bytes + 20000);
  });
});

describe('filter', () => {
  test('drops whole units: a section under a matching heading, a code block, a list item with its children', () => {
    const src = ['# Title', 'intro', '', '## Testing', 'anything here', '', '## Style', '- Prefer small functions', '- Run the linter', '  - with care', '- Keep names short', '', '\x60\x60\x60', 'ok line', 'git status', '\x60\x60\x60', '', 'A paragraph', 'about pip install.', '', 'Plain closing words.'].join('\n');
    const f = filterFile(src);
    expect(f.preamble).toBeNull();
    expect(filterFile('loose intro\n\n## A\nx\n').preamble?.unit).toBe('preamble');
    expect(f.sections.map((s) => [s.heading, s.kept])).toEqual([['## Title', true], ['## Testing', false], ['## Style', true]]);
    expect(f.sections[2]!.body).toBe('- Prefer small functions\n\n- Keep names short\n\nPlain closing words.');
    expect(f.drops.map((d) => [d.unit, d.reasons])).toEqual([['section', ['R3']], ['list_item', ['R2']], ['code_block', ['R4']], ['paragraph', ['network']]]);
  });
  test('safety reasons: at sign, link, email, key, rules file names', () => {
    expect(reasonsOf('See @docs/x.md')).toContain('at_sign');
    expect(reasonsOf('Read https://example.com')).toContain('link');
    expect(reasonsOf('mail someone at a.b(at)c.org')).toContain('email');
    expect(reasonsOf('token = abcdefghijk')).toContain('key');
    expect(reasonsOf('Also read CLAUDE.md')).toContain('rules_file');
    expect(reasonsOf('Never make assumptions, always ask.')).toContain('blocks_one_turn');
    expect(reasonsOf('Confirm before making changes.')).toContain('blocks_one_turn');
    expect(reasonsOf('This project uses bd (beads) for ALL task tracking.')).toContain('missing_tool');
    expect(reasonsOf('Open a Jira ticket first.')).toContain('missing_tool');
    expect(reasonsOf('code\n  make generate\n')).toContain('missing_tool');
    expect(reasonsOf('Prefer small, pure functions.')).toEqual([]);
    expect(reasonsOf('No code comments.')).toEqual([]);
    expect(reasonsOf('Usar siempre el formato de fecha que el equipo prefiere')).toContain('not_english');
    expect(reasonsOf('Prefer the date style de facto used by la casa nova')).not.toContain('not_english');
  });
  test('H1 and H2 start sections, deeper headings stay inside them', () => {
    const s = splitSections('# A\nx\n### B\ny\n## C\nz\n').sections;
    expect(s.map((x) => [x.heading, x.body])).toEqual([['## A', 'x\n### B\ny'], ['## C', 'z\n']]);
  });
});

test('the size report rebuilds from sizes.json and covers 500+ AGENTS.md and CLAUDE.md files', () => {
  const s = JSON.parse(readFileSync(join(DIR, 'sizes', 'sizes.json'), 'utf8'));
  expect(s.rows.filter((r: { name: string }) => r.name === 'AGENTS.md' || r.name === 'CLAUDE.md').length).toBeGreaterThanOrEqual(500);
  const r = report(s.rows, s.index_counts, s.crawled, s.loose);
  expect(r.md).toBe(readFileSync(join(DIR, 'sizes', 'SIZES.md'), 'utf8'));
  expect(wilson(0, 10)[0]).toBe(0);
  expect(r.md).not.toContain('\u2014');
});

test('corpus notices exist for outsiders', () => {
  expect(existsSync(join(CORPUS, 'NOTICES.md'))).toBe(true);
  const notices = readFileSync(join(CORPUS, 'NOTICES.md'), 'utf8');
  for (const s of loadSources()) expect(notices).toContain(s.id);
});
