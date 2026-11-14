import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { blindArms, CAP, normaliser, severityLookup } from '../../scripts/review-bugs/blind.ts';
import { mergeArms } from '../../scripts/review-bugs/merge-arms.ts';
import { contractProblems } from './contract-check.ts';

const ROOT = resolve(import.meta.dir, '../..');
const FX = join(ROOT, 'tests/fixtures/review-bugs');
const ARMS = join(FX, 'arms');
const MAP = join(FX, 'severity-map.json');
const U1 = 'example-org__widget#101@a1b2c3d4e5f6';
const U2 = 'example-org__widget#102@b2c3d4e5f6a1';
const tmp = mkdtempSync(join(tmpdir(), 'blind-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const fresh = () => join(tmp, 'b' + ++n);
const lines = (path: string) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const copyArm = (name: string, edit: (dir: string) => void) => {
  const dir = join(tmp, 'src-' + ++n, name);
  cpSync(join(ARMS, name), dir, { recursive: true });
  edit(dir);
  return dir;
};
const cli = (args: string[]) => {
  const r = Bun.spawnSync([process.execPath, join(ROOT, 'scripts/review-bugs/blind.ts'), ...args], { cwd: ROOT, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, TMPDIR: tmp }, stdout: 'pipe', stderr: 'pipe' });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};

describe('the normaliser', () => {
  const norm = normaliser({ readers: ['claude-adversarial-subagent', 'security', 'outside-voice'], arms: ['gstack-opus', 'gstack on anthropic/claude-opus-5-5'], models: ['anthropic/claude-opus-5-5', 'openai/gpt-6.1-sol'], labels: ['FIXABLE', 'Medium'] });
  const markers = ['Review Army', 'specialist', 'adversarial', 'Pre-Landing Review', 'Gate edits', 'Fix-First', 'AUTO-FIXED', 'outside voice', 'gstack', '[P1]', 'confidence', 'INFORMATIONAL', 'CRITICAL', 'FIXABLE', 'Medium', 'claude-adversarial-subagent', 'claude adversarial subagent', 'gstack-opus', 'claude-opus-5-5', 'gpt-6.1-sol', 'Codex', 'Opus', '**', '\x60', '#', '\u2014'];
  const text = [
    '## Pre-Landing Review: 2 issues (1 critical, 1 informational)',
    '- [P1] (confidence: 9/10, specialist: security) src/cache.ts:42 \u2014 The **Review Army** specialist and the adversarial pass agree:',
    '  the cache key \x60key()\x60 ignores the tenant id. CRITICAL. INFORMATIONAL note (confidence 8/10). FIXABLE, Medium.',
    'Gate edits: Fix-First AUTO-FIXED nothing. The claude-adversarial-subagent, the claude adversarial subagent and the outside voice',
    '(gpt-6.1-sol, via Codex) back it, as gstack-opus on claude-opus-5-5 and Opus said; the security reader also agrees.',
  ].join('\n');
  const out = norm.paragraph(text, 'Recommended fix: add the tenant id to the key.');

  test('strips every listed marker and keeps the substance', () => {
    for (const m of markers) expect(out.toLowerCase()).not.toContain(m.toLowerCase());
    expect(out).toContain('the cache key key() ignores the tenant id.');
    expect(out).toContain('Fix: add the tenant id to the key.');
    expect(out).toContain('security reader also agrees');
    expect(out).not.toMatch(/\s{2}|\n/);
    expect(norm.leaks(out)).toEqual([]);
  });

  test('folds summary and fix into one paragraph, with one Fix: and plain words kept', () => {
    expect(norm.paragraph('The loop\n\n  never   sleeps.', 'Suggested fix: sleep 1s.')).toBe('The loop never sleeps. Fix: sleep 1s.');
    expect(norm.paragraph('Plain words stay: a critical section, a blocker, a red team.')).toBe('Plain words stay: a section, a, a red team.');
    expect(norm.paragraph('[CRITICAL]')).toBe('No description given.');
    expect(norm.text('See ' + '/' + 'workspace/run-1/src/cache.ts and ~/notes/x.md.')).toBe('See cache.ts and x.md.');
  });

  test('cuts a long paragraph at the cap, on a word boundary', () => {
    const long = norm.paragraph(Array.from({ length: 400 }, (_, i) => 'word' + i).join(' '));
    expect(long.length).toBeLessThanOrEqual(CAP + ' [cut]'.length);
    expect(long).toEndWith(' [cut]');
    expect(long.slice(0, -' [cut]'.length)).toMatch(/word\d+$/);
    expect(CAP).toBe(1200);
  });
});

describe('severity lookup', () => {
  test('exact, by_reader before default, lowercase twin, then the first word of a compound label', () => {
    const path = join(tmp, 'map.json');
    writeFileSync(path, JSON.stringify({ none: { default: { HIGH: 'CRITICAL', Medium: 'INFORMATIONAL' }, by_reader: { unconfirmed: { HIGH: 'INFORMATIONAL' } } } }));
    const { lookup } = severityLookup(path, 'none');
    expect(lookup('HIGH', null)).toBe('CRITICAL');
    expect(lookup('HIGH', 'unconfirmed')).toBe('INFORMATIONAL');
    expect(lookup('high', null)).toBe('CRITICAL');
    expect(lookup('medium', null)).toBe('INFORMATIONAL');
    expect(lookup('High', null)).toBeNull();
    expect(lookup('Medium (style)', null)).toBe('INFORMATIONAL');
    expect(lookup('CRITICAL', null)).toBe('CRITICAL');
    expect(lookup('INFORMATIONAL', 'unconfirmed')).toBe('INFORMATIONAL');
    expect(lookup('SHOULD', null)).toBeNull();
  });

  test('refuses a missing entry, a value that is not CRITICAL or INFORMATIONAL, and twins that disagree', () => {
    expect(() => severityLookup(MAP, 'pstack')).toThrow('E_BLIND_SEVMAP ' + MAP + ': has no entry "pstack"; it has none, gstack');
    const bad = join(tmp, 'bad.json');
    writeFileSync(bad, JSON.stringify({ none: { default: { HIGH: 'BLOCKING' } } }));
    expect(() => severityLookup(bad, 'none')).toThrow('E_BLIND_SEVMAP ' + bad + ': none.default maps "HIGH" to "BLOCKING", not CRITICAL or INFORMATIONAL');
    const twin = join(tmp, 'twin.json');
    writeFileSync(twin, JSON.stringify({ none: { default: { HIGH: 'CRITICAL', High: 'INFORMATIONAL' } } }));
    expect(() => severityLookup(twin, 'none')).toThrow('lowercase twin "high" maps both ways');
  });
});

describe('blindArms', () => {
  const merged = mergeArms({ id: 'plain-2fam', label: 'plain Opus plus plain Sol', out: join(tmp, 'arms', 'plain-2fam'), rule: 'pass', date: '2026-11-13', sources: [{ dir: join(ARMS, 'none-opus') }, { dir: join(ARMS, 'none-sol') }] });
  const out = fresh();
  const key = join(tmp, 'key-main.json');
  const r = blindArms({ severityMap: MAP, out, key, date: '2026-11-13', arms: [{ dir: join(ARMS, 'gstack-opus'), id: 'X7', entry: 'gstack' }, { dir: merged.dir, id: 'Q3', entry: 'none' }] });
  const k = JSON.parse(readFileSync(key, 'utf8'));

  test('writes each blinded arm with path, line, pass, mapped severity and one paragraph only', () => {
    expect(r.arms).toEqual([{ id: 'X7', findings: 3 }, { id: 'Q3', findings: 6 }]);
    const x = lines(join(out, 'X7', 'findings', U1 + '.jsonl'));
    expect(x.map((f) => Object.keys(f).sort())).toEqual([['evidence', 'id', 'line', 'pass', 'path', 'severity', 'summary'], ['id', 'line', 'pass', 'path', 'severity', 'summary']]);
    expect(x[0]).toMatchObject({ id: 'b1', severity: 'CRITICAL', path: 'src/cache.ts', line: 42, pass: 1 });
    expect(x[0].summary).toBe('data-migration found that the cache key ignores the tenant id. cross-tenant read. Fix: put the tenant id in the key, as the and suggested.');
    expect(x[0].evidence).toBe('2 issues (1, 1). The read line 42.');
    const q = lines(join(out, 'Q3', 'findings', U1 + '.jsonl'));
    expect(q.map((f) => [f.id, f.pass, f.severity])).toEqual([['b1', 1, 'CRITICAL'], ['b2', 1, 'INFORMATIONAL'], ['b3', 1, 'CRITICAL'], ['b4', 2, 'CRITICAL']]);
    expect(lines(join(out, 'Q3', 'findings', U2 + '.jsonl')).map((f) => [f.id, f.pass, f.severity])).toEqual([['b1', 1, 'CRITICAL'], ['b2', 2, 'INFORMATIONAL']]);
  });

  test('no blinded file names an arm, reader, model or gstack label', () => {
    for (const id of ['X7', 'Q3']) {
      const text = [readFileSync(join(out, id, 'arm.json'), 'utf8'), readFileSync(join(out, id, 'cost.tsv'), 'utf8'), readFileSync(join(out, id, 'findings', U1 + '.jsonl'), 'utf8'), readFileSync(join(out, id, 'findings', U2 + '.jsonl'), 'utf8')].join('\n');
      for (const s of ['gstack', 'none-opus', 'none-sol', 'plain-2fam', 'claude', 'opus', 'gpt', 'sol', 'codex', 'adversarial', 'specialist', 'review army', 'pre-landing', 'gate edits', 'confidence', 'reader', 'confirmed', 'merged_from', '[p1]']) expect(text.toLowerCase()).not.toContain(s);
    }
  });

  test('arm.json and cost.tsv keep only what scoring needs', () => {
    const a = JSON.parse(readFileSync(join(out, 'Q3', 'arm.json'), 'utf8'));
    expect(a).toEqual({ contract_version: 1, id: 'Q3', label: 'Blinded arm Q3', suite: 'rb-fixture', date: '2026-11-13', passes: 2, provenance: 'live', status: 'stopped', coverage_gaps: ['example-org/widget#102@b2c3d4e5f6a1 pass 2: coverage gap'], blinding: { tool: 'harness-evals scripts/review-bugs/blind.ts', normaliser_version: 1, cap: 1200, severity_map_sha256: k.severity_map.sha256 } });
    const cost = readFileSync(join(out, 'X7', 'cost.tsv'), 'utf8').trim().split('\n');
    expect(cost[0]).toBe('pr\tscope\tpass\ttotal_tokens\tinput_tokens\toutput_tokens\tcache_read_tokens\tcache_write_tokens\treasoning_tokens\tusd\twall_seconds\tmeter_source');
    expect(cost.slice(1).map((l) => l.split('\t')[1])).toEqual(['all', 'all', 'all', 'all']);
    expect(cost[1]).toBe('example-org/widget#101@a1b2c3d4e5f6\tall\t1\t9000\t8900\t100\t0\t0\t0\t0.09\t300\tproxy-journal');
  });

  test('the key maps every blinded finding back to its source arm, pass and id, and keeps the gap reasons', () => {
    expect(k.findings).toHaveLength(9);
    expect(k.findings[0]).toEqual({ blinded_arm: 'X7', unit: U1, id: 'b1', pass: 1, source_arm: 'gstack-opus', source_id: 'p1-1', source_line: 1, raw_severity: 'CRITICAL', reader: 'confirmed', mapped_severity: 'CRITICAL' });
    expect(k.findings.find((f: any) => f.blinded_arm === 'Q3' && f.unit === U1 && f.id === 'b3')).toEqual({ blinded_arm: 'Q3', unit: U1, id: 'b3', pass: 1, source_arm: 'plain-2fam', source_id: 's2.none-sol.p1.p1-1', source_line: 3, raw_severity: 'P1', reader: null, mapped_severity: 'CRITICAL', merged_from: { source: 2, arm: 'none-sol', pass: 1, id: 'p1-1' } });
    expect(k.arms.map((a: any) => [a.blinded_id, a.map_entry, a.source.arm_id])).toEqual([['X7', 'gstack', 'gstack-opus'], ['Q3', 'none', 'plain-2fam']]);
    expect(k.arms[1].coverage_gaps).toEqual(merged.arm.coverage_gaps);
    expect(k.severity_map.file).toBe('severity-map.json');
  });

  test('blinded arms fit the shape noloss ingest --check accepts', () => {
    for (const id of ['X7', 'Q3']) expect(contractProblems(join(out, id), [U1, U2])).toEqual([]);
  });

  test('lowercase and compound labels map through the frozen rules', () => {
    const arm = copyArm('none-opus', (d) => {
      const p = join(d, 'findings', U1 + '.jsonl');
      writeFileSync(p, readFileSync(p, 'utf8').replace('"severity":"LOW"', '"severity":"low"').replace('"severity":"High"', '"severity":"High (data loss)"'));
      const a = JSON.parse(readFileSync(join(d, 'arm.json'), 'utf8'));
      delete a.severity_map;
      writeFileSync(join(d, 'arm.json'), JSON.stringify(a));
    });
    const o = fresh();
    blindArms({ severityMap: MAP, out: o, key: join(tmp, 'key-' + n + '.json'), arms: [{ dir: arm, id: 'Z1', entry: 'none' }] });
    expect(lines(join(o, 'Z1', 'findings', U1 + '.jsonl')).map((f) => f.severity)).toEqual(['CRITICAL', 'INFORMATIONAL', 'CRITICAL']);
  });
});

describe('blind refusals', () => {
  const gstack = join(ARMS, 'gstack-opus');

  test('an unmapped label refuses with every finding it hits', () => {
    const arm = copyArm('gstack-opus', (d) => {
      const p = join(d, 'findings', U1 + '.jsonl');
      writeFileSync(p, readFileSync(p, 'utf8').replace('"reader":"confirmed"', '"reader":"confirmed","label":"FIXABLE"'));
    });
    const o = fresh();
    const r = cli(['--severity-map', MAP, '--out', o, '--key', o + '.key.json', '--arm', arm, 'X7', 'gstack']);
    expect(r.code).toBe(2);
    expect(r.err.trim()).toBe('E_BLIND_SEVERITY ' + MAP + ': 1 finding label is unmapped by its arm\'s entry; add them to a new map file before judging:\n' + join(arm, 'findings', U1 + '.jsonl') + ' line 1: raw label "FIXABLE" (reader confirmed)');
  });

  test('the key may not sit in --out or already exist, and a blinded id must be opaque', () => {
    const o = fresh();
    expect(() => blindArms({ severityMap: MAP, out: o, key: join(o, 'key.json'), arms: [{ dir: gstack, id: 'X7', entry: 'gstack' }] })).toThrow('E_BLIND_ARGS ' + join(o, 'key.json') + ': the key is inside --out');
    const existing = join(tmp, 'exists.json');
    writeFileSync(existing, '{}');
    expect(() => blindArms({ severityMap: MAP, out: fresh(), key: existing, arms: [{ dir: gstack, id: 'X7', entry: 'gstack' }] })).toThrow('E_BLIND_ARGS ' + existing + ': already exists');
    expect(() => blindArms({ severityMap: MAP, out: fresh(), key: join(tmp, 'k' + n + '.json'), arms: [{ dir: gstack, id: 'gstack-opus-b', entry: 'gstack' }] })).toThrow('blinded id "gstack-opus-b" overlaps source arm id "gstack-opus"');
    expect(() => blindArms({ severityMap: MAP, out: fresh(), key: join(tmp, 'k' + n + '.json'), arms: [{ dir: gstack, id: 'A1', entry: 'gstack' }, { dir: join(ARMS, 'none-opus'), id: 'A1', entry: 'none' }] })).toThrow('E_BLIND_ARGS --arm: a blinded id is given twice');
  });

  test('an arm whose recorded severity map is not the named entry is refused', () => {
    expect(() => blindArms({ severityMap: MAP, out: fresh(), key: join(tmp, 'k' + n + '.json'), arms: [{ dir: join(ARMS, 'none-opus'), id: 'A1', entry: 'gstack' }] })).toThrow('E_BLIND_SEVMAP ' + join(ARMS, 'none-opus', 'arm.json') + ': the arm recorded a severity_map that is not entry "gstack"');
  });

  test('a judged arm is refused before blinding', () => {
    const judged = copyArm('gstack-opus', (d) => writeFileSync(join(d, 'judgments.tsv'), 'pr\n'));
    expect(() => blindArms({ severityMap: MAP, out: fresh(), key: join(tmp, 'k' + n + '.json'), arms: [{ dir: judged, id: 'A1', entry: 'gstack' }] })).toThrow('E_BLIND_SOURCE ' + join(judged, 'judgments.tsv') + ': the arm is already judged');
  });

  test('the CLI needs three values per --arm', () => {
    const r = cli(['--severity-map', MAP, '--out', fresh(), '--key', join(tmp, 'k.json'), '--arm', gstack, 'X7']);
    expect(r.code).toBe(2);
    expect(r.err.trim()).toBe('E_BLIND_ARGS --arm: takes three values: <arm dir> <blinded id> <map entry>');
  });
});
