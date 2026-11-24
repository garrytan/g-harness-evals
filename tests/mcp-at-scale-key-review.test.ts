import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { classify, reviewScan } from '../scripts/mcp-at-scale/key-review.ts';

const script = resolve(import.meta.dir, '../scripts/mcp-at-scale/key-review.ts');
const b64 = (n: number) => Array.from({ length: n }, (_, i) => 'Qx7_k-Z'[i % 7]).join('');
const fixture = 'sk-' + 'test' + '-anthropic-' + 'key-abc';
const g = 'AI' + 'za' + 'B'.repeat(35);
const real = 'sk-' + 'proj-' + 'R'.repeat(60);
function final(files: Record<string, string>, scan: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'key-review-'));
  for (const [f, t] of Object.entries(files)) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), t); }
  writeFileSync(join(dir, 'key-scan.json'), JSON.stringify({ files: 9, unreadable: 0, values: {}, ...scan }));
  return dir;
}
const review = (dir: string) => spawnSync('bun', [script, '--dir', dir], { env: { PATH: process.env.PATH ?? '' } });

describe('key-scan review (amendment 2)', () => {
  test('classifies only test placeholders and matches deep inside long encoded runs', () => {
    const t1 = "KEY: '" + fixture + "' }";
    expect(classify(t1, 6, 6 + fixture.length)).toBe('sk-test-fixture');
    const t2 = b64(300) + g + b64(10);
    expect(classify(t2, 300, 300 + g.length)).toBe('base64-run');
    const t3 = b64(30) + g + b64(30);
    expect(classify(t3, 30, 30 + g.length)).toBeNull();
    const t4 = 'OPENAI_API_KEY=' + real + b64(150);
    expect(classify(t4, 15, 15 + real.length)).toBeNull();
    const t5 = 'x ' + real + ' y';
    expect(classify(t5, 2, 2 + real.length)).toBeNull();
    const t6 = '/' + Array.from({ length: 30 }, () => 'segment').join('/') + '/' + g;
    expect(classify(t6, t6.length - g.length, t6.length)).toBeNull();
    const mixed = 'sk-' + 'test' + 'Q7xRk9PzL2mW';
    expect(classify(' ' + mixed + ' ', 1, 1 + mixed.length)).toBeNull();
    const spaced = b64(300) + 'Bear' + 'er ' + b64(30);
    expect(classify(spaced, 300, spaced.length)).toBeNull();
  });

  test('exempts covered hits, keeps the raw scan and writes no matched text', () => {
    const dir = final({ 'jobs/a/codex.txt': "env({ K: '" + fixture + "' })", 'jobs/b/s.ndjson': '"' + b64(400) + g + b64(80) + '"' }, { patterns: { openai_or_generic_sk: ['jobs/a/codex.txt'], google: ['jobs/b/s.ndjson'] } });
    const raw = readFileSync(join(dir, 'key-scan.json'), 'utf8');
    const r = review(dir);
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, 'key-scan.raw.json'), 'utf8')).toBe(raw);
    const scan = JSON.parse(readFileSync(join(dir, 'key-scan.json'), 'utf8'));
    expect(scan.patterns).toEqual({});
    expect(scan.values).toEqual({});
    const rev = readFileSync(join(dir, 'key-scan-review.json'), 'utf8');
    expect(JSON.parse(rev).hits).toEqual([
      { pattern: 'openai_or_generic_sk', file: 'jobs/a/codex.txt', classes: ['sk-test-fixture'], matches: 1 },
      { pattern: 'google', file: 'jobs/b/s.ndjson', classes: ['base64-run'], matches: 1 },
    ]);
    expect(rev).not.toContain('BBBBBBBB');
    expect(review(dir).status).toBe(2);
  });

  test('an exact-value hit is fatal and changes nothing', () => {
    const dir = final({ 'jobs/a/codex.txt': "K: '" + fixture + "'" }, { patterns: { openai_or_generic_sk: ['jobs/a/codex.txt'] }, values: { OPENAI_API_KEY: ['jobs/a/codex.txt'] } });
    const raw = readFileSync(join(dir, 'key-scan.json'), 'utf8');
    expect(review(dir).status).toBe(1);
    expect(readFileSync(join(dir, 'key-scan.json'), 'utf8')).toBe(raw);
    expect(existsSync(join(dir, 'key-scan-review.json'))).toBe(false);
  });

  test('an unreadable file, an unknown pattern or a hit file with no match left refuses the review', () => {
    const scan = { patterns: { openai_or_generic_sk: ['a.txt'] } };
    const dir = final({ 'a.txt': 'nothing key-shaped here' }, scan);
    expect(reviewScan(dir, { ...scan, values: {}, unreadable: 0 }).problems).toEqual(['openai_or_generic_sk: no match left in a.txt']);
    expect(reviewScan(dir, { patterns: {}, values: {}, unreadable: 1 }).problems).toEqual(['the key scan could not read 1 file(s)']);
    expect(reviewScan(dir, { patterns: { nope: ['a.txt'] }, values: {}, unreadable: 0 }).problems).toEqual(['unknown pattern nope']);
    expect(review(dir).status).toBe(1);
    expect(existsSync(join(dir, 'key-scan.raw.json'))).toBe(false);
  });

  test('an sk-test placeholder is exempt only below 40 characters', () => {
    const short = 'sk-' + 'test' + '-' + 'a'.repeat(31);
    const long = short + 'a';
    expect(short.length).toBe(39);
    expect(classify(' ' + short + ' ', 1, 1 + short.length)).toBe('sk-test-fixture');
    expect(classify(' ' + long + ' ', 1, 1 + long.length)).toBeNull();
  });

  test('one unexempted match in a file refuses the whole review', () => {
    const scan = { patterns: { openai_or_generic_sk: ['a.txt'] } };
    const dir = final({ 'a.txt': "K: '" + fixture + "'\nexport OPENAI_API_KEY=" + real + '\n' }, scan);
    expect(reviewScan(dir, { ...scan, values: {}, unreadable: 0 }).problems).toEqual(['openai_or_generic_sk: an unexempted match in a.txt']);
    expect(review(dir).status).toBe(1);
    expect(existsSync(join(dir, 'key-scan.raw.json'))).toBe(false);
  });

  test('a symlinked hit file or a key-shaped path is never reviewed', () => {
    const outside = mkdtempSync(join(tmpdir(), 'key-review-out-'));
    writeFileSync(join(outside, 'x.txt'), "K: '" + fixture + "'");
    const dir = final({}, { patterns: { openai_or_generic_sk: ['jobs/link/x.txt'] } });
    mkdirSync(join(dir, 'jobs'));
    symlinkSync(outside, join(dir, 'jobs', 'link'));
    expect(reviewScan(dir, { patterns: { openai_or_generic_sk: ['jobs/link/x.txt'] }, values: {}, unreadable: 0 }).problems).toEqual(['openai_or_generic_sk: not a regular file inside the final: jobs/link/x.txt']);
    expect(review(dir).status).toBe(1);
    const named = 'jobs/' + g + '.txt';
    const dir2 = final({ [named]: "K: '" + fixture + "'" }, { patterns: { openai_or_generic_sk: [named] } });
    expect(reviewScan(dir2, { patterns: { openai_or_generic_sk: [named] }, values: {}, unreadable: 0 }).problems).toEqual(['openai_or_generic_sk: a hit path holds key-shaped text']);
  });
  test('a doc placeholder of x letters is exempt only as a whole token (amendment 4)', () => {
    const ph = 'sk-' + 'x'.repeat(20);
    const hdr = 'headers:\n  Authorization: "Bear' + 'er ' + ph + '"\n';
    const i = hdr.indexOf('Bear');
    expect(classify(hdr, i, i + ('Bear' + 'er ' + ph).length)).toBe('x-placeholder');
    expect(classify(hdr, hdr.indexOf(ph), hdr.indexOf(ph) + ph.length)).toBe('x-placeholder');
    const near = 'sk-' + 'x'.repeat(19) + 'Q';
    expect(classify(' ' + near + ' ', 1, 1 + near.length)).toBeNull();
    const glued = 'A' + ph;
    expect(classify(glued, 1, glued.length)).toBeNull();
    const mixed = 'sk-' + 'proj-' + 'x7QmZ2pLk9WvR4tYb8NcHs3Jd6FgXa1E'.repeat(3);
    const realHdr = 'Authorization: "Bear' + 'er ' + mixed + '"';
    const j = realHdr.indexOf('Bear');
    expect(classify(realHdr, j, j + ('Bear' + 'er ' + mixed).length)).toBeNull();
    expect(classify(realHdr, realHdr.indexOf(mixed), realHdr.indexOf(mixed) + mixed.length)).toBeNull();
  });

  test('a Bearer of the trial directory name is exempt only in that trial (amendment 5)', () => {
    const trial = 'r-011__r300__7yFaJsu';
    const h = '{"Authorization":"Bear' + 'er ' + trial + '"}';
    const i = h.indexOf('Bear');
    expect(classify(h, i, i + ('Bear' + 'er ' + trial).length, trial)).toBe('trial-name');
    expect(classify(h, i, i + ('Bear' + 'er ' + trial).length, 'r-012__r300__Q8pLmZt')).toBeNull();
    expect(classify(h, i, i + ('Bear' + 'er ' + trial).length)).toBeNull();
    const longer = 'Bear' + 'er ' + trial + 'Xk9Lm2Pq7Rt4Zw';
    expect(classify(longer, 0, longer.length, trial)).toBeNull();
    const dir = final({ ['jobs/cell-a/' + trial + '/agent/s.jsonl']: h }, { patterns: { bearer: ['jobs/cell-a/' + trial + '/agent/s.jsonl'] } });
    expect(review(dir).status).toBe(0);
    const other = final({ ['jobs/cell-a/r-012__r300__Q8pLmZt/agent/s.jsonl']: h }, { patterns: { bearer: ['jobs/cell-a/r-012__r300__Q8pLmZt/agent/s.jsonl'] } });
    expect(review(other).status).toBe(1);
  });
});
