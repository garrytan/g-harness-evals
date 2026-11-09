// scripts/public-safety/pregate-markers.ts turns the public-safety rules into the public tree's .gstack/pregate.json
// (sealed.answer_markers plus local_paths). These tests use a synthetic rules fixture; the last one checks, in the
// public tree, that the committed pregate.json markers still equal what rules.json generates.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { KEY_SHAPE, markersOf, PREGATE_KEYS, PREGATE_PATH, publicMarkers, publicPregate, renderPublicPregate, RULES_PATH, SEALED_KEYS } from '../scripts/public-safety/pregate-markers.ts';

const ROOT = resolve(import.meta.dir, '..');
const RULES = {
  rules: [
    { id: 'synthetic-key', regex: 'SYNTH-KEY-[0-9A-Z]{20}', description: 'synthetic key shape' },
    { id: 'synthetic-paths', regexes: ['/synthetic/drive/[a-z]+/', 'synthetic_jam_[0-9A-Z]{26}'] },
    { id: 'synthetic-name', regex: '\\bplaceholder-maker\\b', ignore_case: true },
    { id: 'synthetic-flags', regexes: ['canary-[a-f0-9]{8}', 'SYNTH-KEY-[0-9A-Z]{20}'], flags: 'gi' },
    { id: 'synthetic-patterns', patterns: ['synthetic_machine_[0-9A-Z]{26}'] },
    { id: 'synthetic-excepted', patterns: ['excepted-[0-9]+'], allow_paths: ['docs/x.md'] },
    { id: 'synthetic-prose', patterns: ['prose-[0-9]+'], agent_notes_exempt: true },
    { id: 'synthetic-advisory', patterns: ['advisory-[0-9]+'], blocking: false },
  ],
};
const SOURCE = JSON.parse(readFileSync(join(ROOT, PREGATE_PATH), 'utf8'));

describe('markersOf', () => {
  test('takes regex, patterns and regexes in rule order, folds case with (?i:...), drops duplicates and skips rules with exceptions', () => {
    expect(markersOf(RULES)).toEqual(['SYNTH-KEY-[0-9A-Z]{20}', '/synthetic/drive/[a-z]+/', 'synthetic_jam_[0-9A-Z]{26}', '(?i:\\bplaceholder-maker\\b)', '(?i:canary-[a-f0-9]{8})', '(?i:SYNTH-KEY-[0-9A-Z]{20})', 'synthetic_machine_[0-9A-Z]{26}']);
    expect(new RegExp(markersOf(RULES)[3]!).test('A PLACEHOLDER-MAKER line')).toBe(true);
  });

  test('refuses what gstack-pregate would refuse', () => {
    expect(() => markersOf({})).toThrow('expected {"rules": [...]}');
    expect(() => markersOf({ rules: [{ id: 'x' }] })).toThrow('rules[0] (x): needs a regex string or a non-empty patterns or regexes array');
    expect(() => markersOf({ rules: [{ id: 'x', regex: '(' }] })).toThrow('not a valid regex');
    expect(() => markersOf({ rules: [{ id: 'x', regex: 'a'.repeat(257) }] })).toThrow('1 to 256 characters');
    expect(() => markersOf({ rules: [{ id: 'x', regex: 'a', flags: 'm' }] })).toThrow('flag m has no gstack-pregate equivalent');
    expect(() => markersOf({ rules: Array.from({ length: 65 }, (_, i) => ({ id: 'r' + i, regex: 'canary-' + i })) })).toThrow('at most 64');
  });
});

describe('publicPregate', () => {
  test('changes only sealed.answer_markers and sealed.local_paths of this repository\'s pregate.json', () => {
    const out = publicPregate(RULES, SOURCE) as { sealed: Record<string, unknown> };
    const { sealed, ...rest } = out;
    const { sealed: sourceSealed, ...sourceRest } = SOURCE;
    expect(rest).toEqual(sourceRest);
    expect(sealed).toEqual({ ...sourceSealed, answer_markers: publicMarkers(RULES, sourceSealed.answer_markers), local_paths: true });
    expect(Object.keys(out).every((k) => k === '$schema' || PREGATE_KEYS.includes(k))).toBe(true);
    expect(Object.keys(sealed).every((k) => SEALED_KEYS.includes(k))).toBe(true);
    expect(renderPublicPregate(JSON.stringify(RULES), JSON.stringify(SOURCE))).toBe(JSON.stringify(out, null, 2) + '\n');
  });

  test('keeps the age secret key marker and every other key-shape marker the source has, after the generated ones, and drops the rest', () => {
    const age = (SOURCE.sealed.answer_markers as string[]).find((m) => m.startsWith('AGE-SECRET-KEY-'))!;
    expect(age).toBeDefined();
    expect(KEY_SHAPE.test(age)).toBe(true);
    const out = (publicPregate(RULES, SOURCE) as { sealed: { answer_markers: string[] } }).sealed.answer_markers;
    expect(out).toEqual([...markersOf(RULES), age]);
    const source = ['SYNTH-KEY-[0-9A-Z]{20}', 'synth_tok_[A-Za-z0-9]{8}[a-f]+', '(?i:\\bsomeone private\\b)', 'held-literal-token', '[a-z]{12}', age];
    expect(publicMarkers(RULES, source)).toEqual([...markersOf(RULES), 'synth_tok_[A-Za-z0-9]{8}[a-f]+', age]);
  });

  test('refuses a merged list over 64 markers, and a source marker list that is not strings', () => {
    const rules = { rules: Array.from({ length: 64 }, (_, i) => ({ id: 'r' + i, regex: 'canary-' + i })) };
    expect(publicMarkers(rules, [])).toHaveLength(64);
    expect(() => publicMarkers(rules, ['AGE-SECRET-KEY-1[QPZ]{58}'])).toThrow('65 markers; gstack-pregate takes at most 64');
    expect(() => publicMarkers(RULES, 'x')).toThrow('sealed.answer_markers must be an array of strings');
  });

  test('refuses a key gstack-pregate does not accept', () => {
    expect(() => publicPregate(RULES, { ...SOURCE, answer_markers: [] })).toThrow('does not accept the key answer_markers');
    expect(() => publicPregate(RULES, { ...SOURCE, sealed: { ...SOURCE.sealed, markers: [] } })).toThrow('does not accept the key sealed.markers');
  });
});

const publicTree = !existsSync(join(ROOT, 'publication', 'manifest.json'));
const rulesFile = join(ROOT, RULES_PATH);

test.skipIf(!publicTree && !existsSync(rulesFile))('the public tree\'s pregate.json markers are exactly what rules.json generates', () => {
  const rules = JSON.parse(readFileSync(rulesFile, 'utf8'));
  const generated = markersOf(rules);
  expect(generated.length).toBeGreaterThan(0);
  if (!publicTree) return;
  expect(SOURCE.sealed.answer_markers).toEqual(publicMarkers(rules, SOURCE.sealed.answer_markers));
  expect((SOURCE.sealed.answer_markers as string[]).some((m) => m.startsWith('AGE-SECRET-KEY-'))).toBe(true);
  expect(SOURCE.sealed.local_paths).toBe(true);
});
