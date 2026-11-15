// Stage 2 adjudication tooling (scripts/review-bugs/rejudge.ts): items from an adjudication key, the seeded sample, the
// label and judge-check scores, and the adjudication.tsv files for the re-judged guards. Keyless.
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adjudicationTsv, buildItems, itemId, kappa, sample, score, type ItemKey, type RulingRow } from '../../scripts/review-bugs/rejudge.ts';

const tmp = mkdtempSync(join(tmpdir(), 'rejudge-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('the seeded sample', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ item: 'p' + i + '-F1' }));
  test('orders by sha256("<seed>:<item>") and keeps the first n, whatever the input order', () => {
    const want = [...items].sort((a, b) => (sha('2665:' + a.item) < sha('2665:' + b.item) ? -1 : 1)).slice(0, 5).map((x) => x.item);
    expect(sample(items, 5, 2665).map((x) => x.item)).toEqual(want);
    expect(sample([...items].reverse(), 5, 2665).map((x) => x.item)).toEqual(want);
    expect(sample(items, 5, 1).map((x) => x.item)).not.toEqual(want);
    expect(sample(items, 99, 2665).length).toBe(30);
  });
  test('item ids are the packet stem and the opaque id', () => expect(itemId('packets/3801@b8df37213291.json', 'F2')).toBe('3801@b8df37213291-F2'));
});

describe('kappa', () => {
  test('perfect, chance and a worked value', () => {
    expect(kappa(['a', 'b', 'a'], ['a', 'b', 'a'])).toBe(1);
    expect(kappa(['a', 'a', 'b', 'b'], ['a', 'b', 'a', 'b'])).toBe(0);
    expect(kappa(['d', 'd', 'n', 'n', 'n'], ['d', 'n', 'n', 'n', 'n'])).toBeCloseTo(0.5455, 4);
    expect(kappa([], [])).toBeNull();
    expect(kappa(['d', 'd'], ['d', 'd'])).toBeNull();
  });
});

const A = 'openai:gpt-6-astra', O = 'anthropic:claude-opus-5-5';
const row = (item: string, role: 'judge' | 'labeller', judge: string, ruling: string | null, usd = 0.5): RulingRow => ({ item, role, judge, outcome: ruling ? 'ruled' : 'filtered', ruling, tool_calls: 4, usage: { input: 1000, cached: 800, output: 100 }, usd });

describe('score', () => {
  const rows: RulingRow[] = [
    row('i1', 'labeller', A, 'defect'), row('i1', 'labeller', O, 'defect'), row('i1', 'judge', A, 'defect'), row('i1', 'judge', O, 'defect'),
    row('i2', 'labeller', A, 'not-defect'), row('i2', 'labeller', O, 'not-defect'), row('i2', 'judge', A, 'cant-tell'), row('i2', 'judge', O, 'not-defect'),
    row('i3', 'labeller', A, 'cant-tell'), row('i3', 'labeller', O, 'defect'), row('i3', 'judge', A, 'defect'), row('i3', 'judge', O, 'defect'),
    row('i4', 'labeller', A, 'defect'), row('i4', 'labeller', O, 'not-defect'), row('i4', 'judge', A, 'not-defect'), row('i4', 'judge', O, null),
    row('i5', 'labeller', A, 'not-defect'), row('i5', 'labeller', O, 'not-defect'), row('i5', 'judge', A, 'not-defect'), row('i5', 'judge', O, 'not-defect'),
  ];
  const s = score(rows, A, O, 3, 0.6);
  test('labellers: unsure rate over every labeller read, agreement, and the agreed labels', () => {
    expect(s.labellers.unsure_rate).toBe(0.1);
    expect(s.labellers.agreed_labels).toBe(3);
    expect(s.labels).toEqual({ i1: 'defect', i2: 'not-defect', i5: 'not-defect' });
    expect(s.labellers.raw_agreement_all).toBe(0.6);
    expect(s.labellers.dropped).toBe(2);
  });
  test('each judge against the labels, with can\'t-tell as a disagreement and apart', () => {
    expect(s.judge_vs_labels[A]).toMatchObject({ n: 3, raw_agreement: 0.6667, judge_cant_tell: 1, kappa_without_cant_tell: 1 });
    expect(s.judge_vs_labels[O]).toMatchObject({ n: 3, raw_agreement: 1, kappa: 1 });
    expect(s.r78).toMatchObject({ n: 3, pass: false });
  });
  test('reads: outcomes, the can\'t-tell rate, cost and tokens per read', () => {
    expect(s.reads['judge ' + O]).toMatchObject({ reads: 5, outcomes: { ruled: 4, filtered: 1 }, usd_per_read: 0.5, tokens_per_read: { input: 1000, cached: 800, output: 100 }, cache_read_share: 0.8 });
    expect(s.reads['judge ' + A]).toMatchObject({ cant_tell_rate: 0.2 });
  });
  const labelled = (item: string, label: string) => [row(item, 'labeller', A, label), row(item, 'labeller', O, label)];
  test('a judge read with no ruling on an agreed item counts as a disagreement in R78', () => {
    const t = score([...labelled('i1', 'defect'), row('i1', 'judge', A, null), ...labelled('i2', 'not-defect'), row('i2', 'judge', A, 'not-defect')], A, O, 1, 0.6);
    expect(t.judge_vs_labels[A]).toMatchObject({ n: 2, raw_agreement: 0.5, judge_cant_tell: 0, judge_unruled: 1, not_read: 0 });
  });
  test('a failed read gives way to a later read; an agreed item left unread fails R78; two usable reads are refused', () => {
    const failed: RulingRow = { ...row('i1', 'judge', A, null), outcome: 'failed' };
    const t = score([...labelled('i1', 'defect'), failed, row('i1', 'judge', A, 'defect'), ...labelled('i2', 'not-defect'), row('i2', 'judge', A, 'not-defect')], A, O, 1, 0.6);
    expect(t.judge_vs_labels[A]).toMatchObject({ n: 2, raw_agreement: 1, not_read: 0 });
    expect(t.r78).toMatchObject({ pass: true, not_read: 0 });
    const u = score([...labelled('i1', 'defect'), failed, ...labelled('i2', 'not-defect'), row('i2', 'judge', A, 'not-defect')], A, O, 1, 0.6);
    expect(u.r78).toMatchObject({ n: 1, not_read: 1, pass: false });
    expect(() => score([row('i1', 'judge', A, 'defect'), row('i1', 'judge', A, 'not-defect')], A, O, 1, 0.6)).toThrow(/two usable judge reads/);
  });
  test('cost, tokens and tool calls count a failed read that was read again; the kept read decides the ruling', () => {
    const failed: RulingRow = { ...row('i1', 'judge', A, null, 1), outcome: 'failed' };
    const t = score([failed, row('i1', 'judge', A, 'defect', 2)], A, O, 1, 0.6);
    expect(t.reads['judge ' + A]).toMatchObject({ reads: 1, replaced_failed_reads: 1, usd_total: 3, usd_per_read: 3, tool_calls_per_read: 8, tokens_per_read: { input: 2000 }, rulings: { defect: 1 } });
  });
  test('R78 fails when every agreed label and every ruling is the same category, where kappa is undefined', () => {
    const items = Array.from({ length: 60 }, (_, i) => 'k' + i);
    const t = score(items.flatMap((i) => [...labelled(i, 'defect'), row(i, 'judge', A, 'defect')]), A, O, 60, 0.6);
    expect(t.judge_vs_labels[A]).toMatchObject({ n: 60, raw_agreement: 1, kappa: null });
    expect(t.r78).toMatchObject({ n: 60, kappa: null, pass: false });
  });
});

describe('adjudication.tsv for the re-judged guards', () => {
  const keys: ItemKey[] = [
    { item: '12-F1', packet: 'packets/12.json', opaque: 'F1', arm: 'T5', pass: 1, finding: 'b3', unit: 'a/b#12@x', pr: '12', stratum: 'S1' },
    { item: '12-F2', packet: 'packets/12.json', opaque: 'F2', arm: 'M2', pass: 2, finding: 'b1', unit: 'a/b#12@x', pr: '12', stratum: 'S1' },
    { item: '12-F3', packet: 'packets/12.json', opaque: 'F3', arm: 'T5', pass: 2, finding: 'b4', unit: 'a/b#12@x', pr: '12', stratum: 'S1' },
  ];
  const rows = [row('12-F1', 'judge', A, 'cant-tell'), row('12-F2', 'judge', A, 'not-defect'), row('12-F3', 'judge', A, null), row('12-F1', 'judge', O, 'defect')];
  test('can\'t-tell and unruled reads take the chosen side, with a note; one file per arm', () => {
    const asDefect = adjudicationTsv(rows, keys, A, 'defect', 'B');
    expect([...asDefect.keys()].sort()).toEqual(['M2', 'T5']);
    const t5 = asDefect.get('T5')!.trim().split('\n').map((l) => l.split('\t'));
    expect(t5[0]).toEqual(['pr', 'finding', 'pass', 'ruling', 'judge', 'saw_label', 'version', 'batch', 'note']);
    expect(t5[1]).toEqual(['12', 'b3', '1', 'defect', 'openai/gpt-6-astra', 'no', '1', 'B', 'cant-tell, counted as defect']);
    expect(t5[2]).toEqual(['12', 'b4', '2', 'defect', 'openai/gpt-6-astra', 'no', '1', 'B', 'no ruling (filtered), counted as defect']);
    const asNot = adjudicationTsv(rows, keys, A, 'not-defect', 'B');
    expect(asNot.get('T5')!).toContain('12\tb3\t1\tnot-defect');
    expect(asNot.get('M2')!.split('\n')[1]).toBe('12\tb1\t2\tnot-defect\topenai/gpt-6-astra\tno\t1\tB\t');
  });
  test('a finding with no usable read is refused, by name; a failed read is replaced by a later read', () => {
    const failed: RulingRow = { ...row('12-F3', 'judge', A, null), outcome: 'failed' };
    expect(() => adjudicationTsv(rows.filter((r) => r.item !== '12-F3'), keys, A, 'not-defect', 'B')).toThrow(/1 item\(s\) have no usable read .*12-F3/);
    expect(() => adjudicationTsv([...rows.filter((r) => r.item !== '12-F3'), failed], keys, A, 'not-defect', 'B')).toThrow(/12-F3/);
    const redone = adjudicationTsv([...rows.filter((r) => r.item !== '12-F3'), failed, row('12-F3', 'judge', A, 'defect')], keys, A, 'not-defect', 'B');
    expect(redone.get('T5')!).toContain('12\tb4\t2\tdefect\topenai/gpt-6-astra');
  });
});

describe('items from an adjudication key', () => {
  const repo = join(tmp, 'clone');
  mkdirSync(repo, { recursive: true });
  const g = (...a: string[]) => { const r = spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
  g('init', '-q', '-b', 'main'); writeFileSync(join(repo, 'a.txt'), '1\n'); g('add', '.'); g('commit', '-q', '-m', 'b');
  const base = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'pr'); writeFileSync(join(repo, 'a.txt'), '2\n'); g('commit', '-q', '-am', 'h');
  const head = g('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'a.txt'), '3\n'); g('commit', '-q', '-am', 'fix');
  const fix = g('rev-parse', 'HEAD');
  g('checkout', '-q', 'main');
  const unit = 'acme/app#12@' + head.slice(0, 12);
  const packets = join(tmp, 'packets');
  mkdirSync(join(packets, 'packets'), { recursive: true });
  const packet = JSON.stringify({ version: 1, kind: 'adjudicate', unit: { repo: 'acme/app', pr: 12, head, base }, known_informational: [], findings: [{ id: 'F1', path: 'a.txt', line: 1, text: 'value is wrong' }] });
  writeFileSync(join(packets, 'packets', '12.json'), packet);
  const key = { packets: [{ file: 'packets/12.json', unit, sha256: sha(packet) }], entries: [{ packet: 'packets/12.json', opaque: 'F1', arm: 'T5', pass: 2, finding: 'b7' }] };
  const suite = { units: [{ id: unit, repo: 'acme/app', pr: 12, head, base, stratum: 'S1', blockers: [{ id: 'B1', case: 'case-1' }] }] };
  mkdirSync(join(tmp, 'catalog'), { recursive: true });
  writeFileSync(join(tmp, 'catalog', 'case-1.json'), JSON.stringify({ defect: { file: 'a.txt', line: 1, summary: 'two should be three' }, fix: { commit: fix } }));
  mkdirSync(join(tmp, 'pr', 'acme_app_12_' + head.slice(0, 12)), { recursive: true });
  writeFileSync(join(tmp, 'pr', 'acme_app_12_' + head.slice(0, 12), 'pr.md'), '# Bump\n\nBumps a.\n');
  const o = { key, packetsDir: packets, suite, catalogDir: join(tmp, 'catalog'), prContext: join(tmp, 'pr'), clones: new Map([['acme/app', join(repo, '.git')]]) };
  test('one item per key entry, blind, with the later tip, fixes and bugs; the key keeps the arm', () => {
    const { items, keys } = buildItems(o);
    expect(items).toEqual([{ item: '12-F1', unit, git_dir: join(repo, '.git'), head, merge_base: base, pr_text: '# Bump\n\nBumps a.\n', finding: { path: 'a.txt', line: 1, text: 'value is wrong' },
      known_informational: [], later: { tip: base, fixes: [fix], bugs: ['a.txt:1: two should be three'] } }]);
    expect(Object.keys(items[0]!)).not.toContain('arm');
    expect(JSON.stringify(items)).not.toContain('"b7"');
    expect(keys).toEqual([{ item: '12-F1', packet: 'packets/12.json', opaque: 'F1', arm: 'T5', pass: 2, finding: 'b7', unit, pr: '12', stratum: 'S1' }]);
  });
  test('a decoy\'s stand-in over-blocking blocker gives labellers no known bug and no fix', () => {
    const decoy = { ...o, suite: { units: [{ ...suite.units[0]!, blockers: [{ id: 'B1', case: 'case-1', counts: 'over-blocking' }] }] } };
    expect(buildItems(decoy).items[0]!.later).toEqual({ tip: base, fixes: [], bugs: [] });
  });
  test('a blocker whose catalog case is missing is refused', () => {
    const missing = { ...o, suite: { units: [{ ...suite.units[0]!, blockers: [{ id: 'B1', case: 'case-gone', counts: 'blocking' }] }] } };
    expect(() => buildItems(missing)).toThrow(/no catalog case case-gone/);
  });
  test('a packet that does not match its key digest is refused', () => {
    expect(() => buildItems({ ...o, key: { ...key, packets: [{ ...key.packets[0]!, sha256: 'x' }] } })).toThrow(/does not match the key sha256/);
  });
});
