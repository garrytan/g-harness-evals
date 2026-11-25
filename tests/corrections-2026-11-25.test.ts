// The 2026-11-25 correction applies R126 to review-real-bugs' judges with Gemini 4 Neon labels (docs/corrections/2026-11-25/README.md).
// The rebuild needs the run's private raw archive, so these tests check the scorer and the labeller's parsing on small
// fixtures, and that the published prose quotes the committed sensitivity.json.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootKappa, compare, score } from '../scripts/review-bugs/third-model-score.ts';
import { body, meterReading, packetItems, parse, parseModel, readReply } from '../scripts/review-bugs/third-model-label.ts';

const ROOT = join(import.meta.dir, '..');
const DIR = join(ROOT, 'docs/corrections/2026-11-25');

describe('third-model-score', () => {
  test('the third model\'s unsure is an abstention, and a judge\'s cant-tell counts as a disagreement', () => {
    const ref = new Map([['a', 'defect'], ['b', 'cant-tell'], ['c', 'not-defect'], ['d', 'defect']]);
    const third = new Map<string, string | null>([['a', 'defect'], ['b', 'defect'], ['c', 'not-defect'], ['d', 'cant-tell']]);
    const r = compare(ref, third);
    expect(r.n).toBe(3);
    expect(r.agree).toBe(2);
    expect(r.n_without_reference_cant_tell).toBe(2);
    expect(r.kappa_without_reference_cant_tell).toBe(1);
    expect(r.kappa_reference_cant_tell_as_defect).toBe(1);
    expect(r.table_reference_vs_third).toEqual({ 'defect | defect': 1, 'cant-tell | defect': 1, 'not-defect | not-defect': 1 });
  });
  test('the bootstrap range is seeded', () => {
    const a = ['x', 'y', 'x', 'y', 'x', 'x', 'y', 'y'], b = ['x', 'y', 'x', 'x', 'x', 'y', 'y', 'y'];
    expect(bootKappa(a, b)).toEqual(bootKappa(a, b));
  });
});

describe('third-model-label', () => {
  test('a matching reply must label every item the packet lists', () => {
    const prompt = '...\n=== Items to label (label packet L001.txt) ===\nI01: kind match; known bug B1; finding F4 in the matching packet\nI02: kind match; known bug B1; finding F5 in the matching packet\n';
    expect(packetItems(prompt)).toEqual(['I01', 'I02']);
    expect(readReply('{"items":[{"item":"I01","kind":"match","label":"match"}]}', ['I01', 'I02'])).toBe('unlabelled items: I02');
    expect(readReply('text {"items":[{"item":"I01","kind":"match","label":"match"},{"item":"I02","kind":"match","label":"no-match"}]} text', ['I01', 'I02']))
      .toEqual([{ item: 'I01', kind: 'match', label: 'match' }, { item: 'I02', kind: 'match', label: 'no-match' }]);
  });
  test('Gemini requests carry the thinking level and tool schemas, and a safety stop is its own outcome', () => {
    const m = parseModel('google:gemini-4-neon');
    const b = body(m, 'p', [], [{ name: 't', description: 'd', parameters: { type: 'object', properties: {} } }]) as any;
    expect(b.generationConfig.thinkingConfig.thinkingLevel).toBe('medium');
    expect(b.tools[0].functionDeclarations[0].parametersJsonSchema).toEqual({ type: 'object', properties: {} });
    expect(parse(m, { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }], usageMetadata: { promptTokenCount: 5 } }).filtered).toBe(true);
    const t = parse(m, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'x', thought: true }, { functionCall: { name: 'grep', args: { pattern: 'a' } } }] } }],
      usageMetadata: { promptTokenCount: 10, cachedContentTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 3 } });
    expect(t.calls).toEqual([{ id: 'c0', name: 'grep', args: { pattern: 'a' } }]);
    expect(t.text).toBe('');
    expect(t.usage).toEqual({ input: 10, cached: 4, output: 5 });
  });
  test('only google and xai models are taken', () => {
    expect(() => parseModel('openai:gpt-6-astra')).toThrow();
  });
});

describe('the published prose quotes sensitivity.json', () => {
  const s = JSON.parse(readFileSync(join(DIR, 'sensitivity.json'), 'utf8'));
  const md = readFileSync(join(DIR, 'README.md'), 'utf8');
  const k = (x: number) => x.toFixed(2);
  test('anchors and abstention', () => {
    expect(s.anchors.match.right).toBe(20);
    expect(s.anchors.adjudicate.right).toBe(20);
    expect(md).toContain('20 of 20 on both kinds');
  });
  test('every primary judge\'s kappa and range', () => {
    for (const [check, label] of [['rejudge', 'Stage 1 re-judge | Astra (primary)'], ['c1', 'C1 | Astra'], ['c2', 'C2 | Opus 5.5'], ['c3', 'C3 | Astra']] as const) {
      const c = s.adjudicate[check];
      const j = c.judges[c.primary];
      expect(md).toContain('| ' + label + ' | ' + j.n + ' of ' + c.items + ' | **' + k(j.kappa) + ' [' + k(j.range95[0]) + ', ' + k(j.range95[1]) + ']** |');
      expect(j.kappa).toBeLessThan(0.6);
    }
    for (const [check, label] of [['stage1', 'Stage 1 matching | Astra'], ['c2', 'C2 matching | Opus 5.5']] as const) {
      const j = s.match[check].match.judge;
      expect(md).toContain('| ' + label + ' | ' + j.n + ' of 120 | **' + k(j.kappa) + ' [' + k(j.range95[0]) + ', ' + k(j.range95[1]) + ']** |');
      expect(j.kappa).toBeGreaterThanOrEqual(0.6);
    }
  });
  test('the sample is 100 findings per check, all 99 of C3', () => {
    const sample = JSON.parse(readFileSync(join(DIR, 'third-model/sample.json'), 'utf8'));
    expect(Object.fromEntries(Object.entries(sample.items).map(([c, ids]) => [c, (ids as string[]).length]))).toEqual({ rejudge: 100, c1: 100, c2: 100, c3: 99 });
  });
});

describe('the rebuild scripts', () => {
  test('the rebuild refuses to run without the unpacked archive and an output path', () => {
    const r = spawnSync('bun', ['scripts/corrections/r126-review-bugs-2026-11-25.ts'], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir() } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('usage: r126-review-bugs-2026-11-25.ts --archive <dir> --out <file>');
  });
  test('the reproduce script parses, runs the rebuild with a scrubbed environment and compares with the committed file', () => {
    const sh = 'scripts/corrections/reproduce-2026-11-25.sh';
    expect(spawnSync('bash', ['-n', sh], { cwd: ROOT }).status).toBe(0);
    const text = readFileSync(join(ROOT, sh), 'utf8');
    expect(text).toContain('run() { env -i PATH="$PATH" HOME="$HOME" bun "$@"; }');
    expect(text).toContain('run scripts/corrections/r126-review-bugs-2026-11-25.ts --archive "$A" --out "$T/sensitivity.json"');
    expect(text).toContain('cmp "$T/sensitivity.json" "$REF"');
  });
  test('a scratch dir that links to the correction dir is refused, and --check never writes into it', () => {
    const sh = join(ROOT, 'scripts/corrections/reproduce-2026-11-25.sh');
    const before = readFileSync(join(DIR, 'sensitivity.json'), 'utf8');
    const t = mkdtempSync(join(tmpdir(), 'r126-alias-'));
    mkdirSync(join(t, 'archive'));
    symlinkSync(DIR, join(t, 'linked'));
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir() };
    const w = spawnSync('bash', [sh, join(t, 'archive'), join(t, 'linked')], { cwd: ROOT, encoding: 'utf8', env });
    expect(w.status).toBe(2);
    expect(w.stderr).toContain('the scratch dir must not be the correction dir');
    mkdirSync(join(t, 'scratch'));
    symlinkSync(join(DIR, 'sensitivity.json'), join(t, 'scratch', 'sensitivity.json'));
    expect(spawnSync('bash', [sh, join(t, 'archive'), join(t, 'scratch')], { cwd: ROOT, encoding: 'utf8', env }).status).toBe(2);
    expect(spawnSync('bash', [sh, join(t, 'archive'), join(t, 'linked'), '--check'], { cwd: ROOT, encoding: 'utf8', env }).status).not.toBe(0);
    expect(readFileSync(join(DIR, 'sensitivity.json'), 'utf8')).toBe(before);
  });
});

describe('the labeller counts a charge only from a complete meter reading', () => {
  test('a failed, unparsable, partial or undrained finalize leaves the cost incomplete', () => {
    expect(meterReading(200, JSON.stringify({ usd: 0.25, requests: 3 }))).toEqual({ usd: 0.25, requests: 3 });
    expect(meterReading(500, JSON.stringify({ usd: 0.25, requests: 3 }))).toBe('finalize returned HTTP 500');
    expect(meterReading(200, 'not json')).toBe('finalize reply is not JSON');
    expect(meterReading(200, JSON.stringify({ requests: 3 }))).toBe('finalize reply has no usd or request count');
    expect(meterReading(200, JSON.stringify({ usd: null, requests: 3 }))).toBe('finalize reply has no usd or request count');
    expect(meterReading(200, JSON.stringify({ usd: 0.25, requests: 3, undrained: 1 }))).toBe('finalize left 1 request(s) undrained');
    expect(meterReading(200, '{"usd":0.25,"requests":1e400}')).toBe('finalize reply has no usd or request count');
    expect(meterReading(200, JSON.stringify({ usd: 0.25, requests: 3, undrained: 'unknown' }))).toBe('finalize reply has an unreadable undrained count');
  });
});

describe('third-model-score subcommands on synthetic fixtures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'r126-score-'));
  const put = (name: string, rows: unknown[] | object, lines = true) => { const p = join(dir, name); writeFileSync(p, lines ? (rows as unknown[]).map((r) => JSON.stringify(r)).join('\n') + '\n' : JSON.stringify(rows)); return p; };
  test('anchors pass needs 18 of 20 right and 8 on each side', () => {
    const key = put('key.json', [...Array(10)].map((_, i) => ({ item: 'd' + i, want: 'defect' })).concat([...Array(10)].map((_, i) => ({ item: 'n' + i, want: 'not-defect' }))), false);
    const rulings = (wrongDefects: number) => put('anchors-' + wrongDefects + '.jsonl', [...Array(10)].map((_, i) => ({ item: 'd' + i, ruling: i < wrongDefects ? 'not-defect' : 'defect' })).concat([...Array(10)].map((_, i) => ({ item: 'n' + i, ruling: 'not-defect' }))));
    const two = score(['anchors', '--key', key, '--labels', rulings(2)]) as { right: number; pass: boolean; by_side: Record<string, { right: number }> };
    expect([two.right, two.pass, two.by_side.defect!.right]).toEqual([18, true, 8]);
    const three = score(['anchors', '--key', key, '--labels', rulings(3)]) as { right: number; pass: boolean };
    expect([three.right, three.pass]).toEqual([17, false]);
  });
  test('adjudicate scores each judge on the items the third model decided, and the labellers on the items they agree on', () => {
    const items = put('items.jsonl', ['a', 'b', 'c', 'd', 'e'].map((item) => ({ item })));
    const third = put('third.jsonl', [['a', 'defect'], ['b', 'not-defect'], ['c', 'defect'], ['d', 'unsure'], ['e', null]].map(([item, ruling]) => ({ item, ruling })));
    const rows = [['a', 'defect'], ['b', 'not-defect'], ['c', 'cant-tell'], ['d', 'defect'], ['e', 'defect']].map(([item, ruling]) => ({ item, ruling, role: 'judge', judge: 'j1' }))
      .concat(['a', 'b', 'c'].flatMap((item) => ['l1', 'l2'].map((judge) => ({ item, ruling: item === 'b' ? 'not-defect' : 'defect', role: 'labeller', judge }))));
    const s = score(['adjudicate', '--items', items, '--labels', third, '--rulings', put('rulings.jsonl', rows), '--primary', 'j1']) as any;
    expect(s.abstention).toEqual({ items: 5, decided: 3, unsure: 1, no_label: 1, abstain_share: 0.4 });
    expect([s.judges.j1.n, s.judges.j1.agree, s.judges.j1.n_without_reference_cant_tell, s.judges.j1.kappa_without_reference_cant_tell]).toEqual([3, 2, 2, 1]);
    expect(s.judges.j1.table_reference_vs_third['cant-tell | defect']).toBe(1);
    expect([s.agreed_labels_vs_third.n, s.agreed_labels_vs_third.agree]).toEqual([3, 3]);
  });
  test('match maps each item to its packet line and names the judge of each kind', () => {
    const prompts = join(dir, 'prompts');
    mkdirSync(prompts);
    writeFileSync(join(prompts, 'p1.txt'), 'brief\n=== Items to label\nI1: kind match, known bug B1, finding F1\nI2: kind match, known bug B1, finding F2\nI3: kind match, known bug B2, finding F3\nI4: kind adjudicate, finding F4\n');
    writeFileSync(join(prompts, 'manifest.json'), JSON.stringify([{ file: 'p1.txt', unit: 'u1' }]));
    const items = put('match-items.json', [{ kind: 'match', unit: 'u1', blocker: 'B1', finding: 'F1', judge: 'match' }, { kind: 'match', unit: 'u1', blocker: 'B1', finding: 'F2', judge: 'no-match' },
      { kind: 'match', unit: 'u1', blocker: 'B2', finding: 'F3', judge: 'no-match' }, { kind: 'adjudicate', unit: 'u1', finding: 'F4', judge: 'defect' }], false);
    const labels = put('match-labels.jsonl', [{ packet: 'p1.txt', labels: [{ item: 'I1', label: 'match' }, { item: 'I2', label: 'no-match' }, { item: 'I3', label: 'match' }, { item: 'I4', label: 'unsure' }] }]);
    const answer = put('answers.json', { p1: { packet: 'p1.txt', labels: [{ item: 'I1', label: 'match' }, { item: 'I2', label: 'no-match' }, { item: 'I3', label: 'no-match' }] } }, false);
    const s = score(['match', '--prompts', prompts, '--items', items, '--labels', labels, '--answers', answer, '--answers', answer, '--judge', 'the matcher', '--adjudicate-judge', 'the adjudicator']) as any;
    expect([s.match.judge.name, s.match.judge.n, s.match.judge.agree, s.match.abstention.abstain_share]).toEqual(['the matcher', 3, 2, 0]);
    expect([s.adjudicate.judge.name, s.adjudicate.abstention.unsure, s.adjudicate.judge.n]).toEqual(['the adjudicator', 1, 0]);
    expect([s.match.published_check_reproduced.n, s.match.agreed_labels_vs_third.agree]).toEqual([3, 2]);
  });
});

describe('reply and ruling checks added after review', () => {
  test('a matching reply with conflicting duplicate labels or a label outside its kind is asked again', () => {
    const kinds = new Map([['I01', 'match'], ['I02', 'adjudicate']]);
    expect(readReply('{"items":[{"item":"I01","label":"match"},{"item":"I01","label":"no-match"},{"item":"I02","label":"defect"}]}', ['I01', 'I02'], kinds)).toBe('conflicting labels for I01');
    expect(readReply('{"items":[{"item":"I01","label":"defect"},{"item":"I02","label":"defect"}]}', ['I01', 'I02'], kinds)).toBe('labels outside the allowed set: I01');
    expect(readReply('{"items":[{"item":"I01","label":"no-match"},{"item":"I02","label":"not-defect"}]}', ['I01', 'I02'], kinds)).toEqual([{ item: 'I01', kind: '', label: 'no-match' }, { item: 'I02', kind: '', label: 'not-defect' }]);
  });
  test('the scorer refuses two rulings by one judge on one item', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r126-dup-'));
    const w = (n: string, rows: unknown[]) => { writeFileSync(join(dir, n), rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); return join(dir, n); };
    const rulings = w('rulings.jsonl', [{ item: 'a', role: 'judge', judge: 'j', ruling: 'defect' }, { item: 'a', role: 'judge', judge: 'j', ruling: null }]);
    expect(() => score(['adjudicate', '--items', w('items.jsonl', [{ item: 'a' }]), '--labels', w('third.jsonl', [{ item: 'a', ruling: 'defect' }]), '--rulings', rulings])).toThrow('two rulings for judge|j|a');
  });
});
