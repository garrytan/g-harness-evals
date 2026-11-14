import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sha256 } from '../../scripts/review-bugs/arm.ts';
import { mergeArms, parseSource } from '../../scripts/review-bugs/merge-arms.ts';
import { contractProblems } from './contract-check.ts';

const ROOT = resolve(import.meta.dir, '../..');
const FX = join(ROOT, 'tests/fixtures/review-bugs');
const ARMS = join(FX, 'arms');
const U1 = 'example-org__widget#101@a1b2c3d4e5f6';
const U2 = 'example-org__widget#102@b2c3d4e5f6a1';
const tmp = mkdtempSync(join(tmpdir(), 'merge-arms-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const outDir = () => join(tmp, 'out-' + ++n);
const findings = (dir: string, unit: string) => readFileSync(join(dir, 'findings', unit + '.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const cost = (dir: string) => {
  const [head, ...rows] = readFileSync(join(dir, 'cost.tsv'), 'utf8').trim().split('\n');
  const cols = head!.split('\t');
  return rows.map((r) => Object.fromEntries(r.split('\t').map((v, i) => [cols[i], v])) as Record<string, string>);
};
const row = (dir: string, unit: string, pass: number, scope = 'all') => cost(dir).find((r) => r.pr.replaceAll('/', '__') === unit && r.pass === String(pass) && r.scope === scope);
const passOf = (dir: string, unit: string) => findings(dir, unit).map((f) => [f.pass, f.id]);
const plain = (window: number, last8?: number, last = 2) => mergeArms({ id: 'plain-' + window, label: 'plain, ' + window + ' sessions per pass', out: outDir(), rule: 'window', window, date: '2026-11-13', sources: [{ dir: join(ARMS, 'none-opus'), first: 1, last }, ...(last8 ? [{ dir: join(ARMS, 'none8-opus'), first: 1, last: last8 }] : [])] });
const copyArm = (name: string, edit: (dir: string) => void) => {
  const dir = join(tmp, 'src-' + ++n, name);
  cpSync(join(ARMS, name), dir, { recursive: true });
  edit(dir);
  return dir;
};
const editJson = (path: string, f: (j: any) => void) => {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  f(j);
  writeFileSync(path, JSON.stringify(j, null, 2) + '\n');
};
const cli = (args: string[]) => {
  const r = Bun.spawnSync([process.execPath, join(ROOT, 'scripts/review-bugs/merge-arms.ts'), ...args], { cwd: ROOT, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, TMPDIR: tmp }, stdout: 'pipe', stderr: 'pipe' });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};
const refuse = (args: string[]) => {
  const r = cli(['--id', 'm', '--label', 'm', '--out', outDir(), '--date', '2026-11-13', ...args]);
  expect(r.code).toBe(2);
  return r.err.trim();
};

describe('merge-arms --rule pass (plain-2fam)', () => {
  const out = outDir();
  const r = mergeArms({ id: 'plain-2fam', label: 'plain Opus plus plain Sol', out, rule: 'pass', date: '2026-11-13', sources: [{ dir: join(ARMS, 'none-opus'), first: 1, last: 2 }, { dir: join(ARMS, 'none-sol'), first: 1, last: 2 }] });

  test('pass k is the union of both sources\' pass k, with every original field kept and ids traceable', () => {
    expect(r.arm.passes).toBe(2);
    expect(passOf(out, U1)).toEqual([
      [1, 's1.none-opus.p1.p1-1'], [1, 's1.none-opus.p1.p1-2'], [1, 's2.none-sol.p1.p1-1'],
      [2, 's1.none-opus.p2.p2-1'],
    ]);
    expect(passOf(out, U2)).toEqual([[1, 's2.none-sol.p1.p1-1'], [2, 's1.none-opus.p2.p2-1']]);
    const f = findings(out, U1)[2];
    expect(f).toEqual({ severity: 'P1', path: 'src/cache.ts', line: 42, summary: 'Tenant id missing from the cache key.', pass: 1, id: 's2.none-sol.p1.p1-1', evidence: 'See line 42.', merged_from: { source: 2, arm: 'none-sol', pass: 1, id: 'p1-1' } });
    expect(r.findings).toBe(6);
  });

  test('a gap in one source makes that merged unit-pass a gap, and the arm stopped', () => {
    expect(r.arm.coverage_gaps).toEqual(['example-org/widget#102@b2c3d4e5f6a1 pass 2: source 2 (none-sol) pass 2: malformed, the json block does not parse']);
    expect(r.arm.status).toBe('stopped');
  });

  test('cost sums both sessions per unit-pass, unknown when either part is unknown', () => {
    expect(row(out, U1, 1)).toMatchObject({ total_tokens: '3000', input_tokens: '2800', usd: 'unavailable', wall_seconds: '70.5', meter_source: 'proxy-journal', requests: '4', unknown_calls: '1', sessions: '2' });
    expect(row(out, U1, 2)).toMatchObject({ total_tokens: '3200', usd: '0.032000', sessions: '2' });
    expect(row(out, U2, 2)).toMatchObject({ total_tokens: '2900', usd: '0.029000' });
    expect(cost(out)).toHaveLength(4);
  });

  test('arm.json records the suite, models, severity map, sources with their sha256 and the pass map', () => {
    expect(r.arm).toMatchObject({ contract_version: 1, id: 'plain-2fam', suite: 'rb-fixture', date: '2026-11-13', provenance: 'live', models: [{ role: 'driver', model: 'anthropic/claude-opus-5-5' }, { role: 'driver', model: 'openai/gpt-6.1-sol' }] });
    expect(r.arm.severity_map).toEqual(JSON.parse(readFileSync(join(ARMS, 'none-opus', 'arm.json'), 'utf8')).severity_map);
    const merge = r.arm.merge as any;
    expect(merge.rule).toBe('pass');
    expect(merge.sources.map((s: any) => [s.source, s.arm_id, s.passes_used])).toEqual([[1, 'none-opus', [1, 2]], [2, 'none-sol', [1, 2]]]);
    for (const s of merge.sources) {
      const dir = join(ARMS, s.arm_id);
      expect(s.arm_json_sha256).toBe(sha256(readFileSync(join(dir, 'arm.json'))));
      expect(s.cost_sha256).toBe(sha256(readFileSync(join(dir, 'cost.tsv'))));
      expect(s.findings_sha256[U1]).toBe(sha256(readFileSync(join(dir, 'findings', U1 + '.jsonl'))));
      expect(s.findings_sha256[U2]).toBe(sha256(readFileSync(join(dir, 'findings', U2 + '.jsonl'))));
      expect(resolve(out, '..', s.dir)).toBe(dir);
    }
    expect(merge.pass_map).toEqual([
      { pass: 1, sessions: [{ source: 1, arm_id: 'none-opus', pass: 1 }, { source: 2, arm_id: 'none-sol', pass: 1 }] },
      { pass: 2, sessions: [{ source: 1, arm_id: 'none-opus', pass: 2 }, { source: 2, arm_id: 'none-sol', pass: 2 }] },
    ]);
  });

  test('the merged arm fits the shape noloss ingest --check accepts', () => {
    expect(contractProblems(out, [U1, U2])).toEqual([]);
  });
});

describe('merge-arms --rule window (plain-N)', () => {
  const map = (r: ReturnType<typeof mergeArms>) => (r.arm.merge as any).pass_map.map((p: any) => p.sessions.map((s: any) => s.arm_id.replace('-opus', '') + ':' + s.pass));

  test('plain-1, plain-2, plain-4 and plain-8 use the stated windows over sessions 1 to 8', () => {
    expect(map(plain(1))).toEqual([['none:1'], ['none:2']]);
    expect(map(plain(2, 2))).toEqual([['none:1', 'none:2'], ['none8:1', 'none8:2']]);
    expect(map(plain(4, 6))).toEqual([['none:1', 'none:2', 'none8:1', 'none8:2'], ['none8:3', 'none8:4', 'none8:5', 'none8:6']]);
    const p8 = plain(8, 6);
    expect(p8.arm.passes).toBe(1);
    expect(map(p8)).toEqual([['none:1', 'none:2', 'none8:1', 'none8:2', 'none8:3', 'none8:4', 'none8:5', 'none8:6']]);
    expect((p8.arm.merge as any).rule_text).toBe('the sources\' passes are sessions 1 to 8 in source order, and merged pass j is the union of sessions (j-1)*8+1 to j*8');
  });

  test('plain-4 pass 2 holds the plain-8 sessions 3 to 6, and a session that never ran is a gap there', () => {
    const r = plain(4, 6);
    expect(passOf(r.dir, U1)).toEqual([[1, 's1.none-opus.p1.p1-1'], [1, 's1.none-opus.p1.p1-2'], [1, 's1.none-opus.p2.p2-1'], [2, 's2.none8-opus.p3.p3-1']]);
    expect(passOf(r.dir, U2)).toEqual([[1, 's1.none-opus.p2.p2-1'], [2, 's2.none8-opus.p6.p6-1']]);
    expect(r.arm.coverage_gaps).toEqual(['example-org/widget#102@b2c3d4e5f6a1 pass 2: source 2 (none8-opus) pass 5 did not run (no all-scope row in its cost.tsv)']);
    expect(row(r.dir, U2, 2)).toMatchObject({ total_tokens: 'unavailable', usd: 'unavailable', sessions: '3' });
    expect(row(r.dir, U1, 2)).toMatchObject({ total_tokens: String(1003 + 1004 + 1005 + 1006), usd: '0.058000', sessions: '4' });
    expect(contractProblems(r.dir, [U1, U2])).toEqual([]);
  });

  test('plain-8 sums all 8 sessions of a unit', () => {
    const r = plain(8, 6);
    expect(row(r.dir, U1, 1)).toMatchObject({ total_tokens: String(1000 + 1100 + 1001 + 1002 + 1003 + 1004 + 1005 + 1006), sessions: '8' });
    expect(r.findings).toBe(6);
  });

  test('a source that stopped makes the merged arm stopped even when its gap falls outside the window', () => {
    const r = plain(2, 2);
    expect(r.arm.coverage_gaps).toBeUndefined();
    expect(r.arm.status).toBe('stopped');
    expect(plain(1).arm.status).toBe('complete');
  });

  test('component scopes (voice, reader) are summed over the sessions that have them', () => {
    const r = mergeArms({ id: 'g2', label: 'gstack, 2 sessions per pass', out: outDir(), rule: 'window', window: 2, date: '2026-11-13', sources: [{ dir: join(ARMS, 'gstack-opus') }] });
    expect(r.arm.passes).toBe(1);
    expect(row(r.dir, U1, 1, 'reader:claude-adversarial-subagent')).toMatchObject({ total_tokens: '3000', usd: 'unavailable', meter_source: 'reader-counter', sessions: '1' });
    expect(row(r.dir, U2, 1, 'voice')).toMatchObject({ total_tokens: '500', usd: '0.005000', sessions: '1' });
    expect(row(r.dir, U1, 1)).toMatchObject({ total_tokens: '18100', usd: '0.181000', wall_seconds: '610' });
    expect(contractProblems(r.dir, [U1, U2])).toEqual([]);
  });

  test('a merged arm can be merged again: its gaps read back in the same form', () => {
    const p4 = plain(4, 6);
    const again = mergeArms({ id: 'again', label: 'again', out: outDir(), rule: 'window', window: 2, date: '2026-11-13', sources: [{ dir: p4.dir }] });
    expect(again.arm.coverage_gaps).toEqual(['example-org/widget#102@b2c3d4e5f6a1 pass 1: source 1 (plain-4) pass 2: source 2 (none8-opus) pass 5 did not run (no all-scope row in its cost.tsv)']);
  });
});

describe('merge-arms refusals', () => {
  const opus = join(ARMS, 'none-opus');
  const sol = join(ARMS, 'none-sol');

  test('the CLI writes an arm and reports it', () => {
    const out = outDir();
    const r = cli(['--id', 'plain-2fam', '--label', 'x', '--out', out, '--rule', 'pass', '--date', '2026-11-13', '--source', opus + ':1-2', '--source', sol]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('merge-arms: wrote plain-2fam (2 passes, 6 findings, 1 coverage gaps, status stopped)');
    expect(contractProblems(out, [U1, U2])).toEqual([]);
  });

  test('a missing unit names the file', () => {
    const dir = copyArm('none-sol', (d) => unlinkSync(join(d, 'findings', U2 + '.jsonl')));
    expect(refuse(['--rule', 'pass', '--source', opus, '--source', dir])).toBe('E_MERGE_UNIT ' + join(dir, 'findings', U2 + '.jsonl') + ': missing, and cost.tsv line 4 names unit example-org/widget#102@b2c3d4e5f6a1');
    const quiet = copyArm('none-opus', (d) => {
      unlinkSync(join(d, 'findings', U2 + '.jsonl'));
      writeFileSync(join(d, 'cost.tsv'), readFileSync(join(d, 'cost.tsv'), 'utf8').split('\n').filter((l) => !l.includes('#102@')).join('\n'));
    });
    expect(refuse(['--rule', 'pass', '--source', quiet, '--source', sol])).toBe('E_MERGE_UNIT ' + join(quiet, 'findings', U2 + '.jsonl') + ': missing: another source has unit ' + U2 + ', and every source must cover the same units');
  });

  test('a pass out of range, a window the sessions do not fill and unequal pass counts are refused', () => {
    expect(refuse(['--rule', 'pass', '--source', opus + ':1-3', '--source', sol])).toBe('E_MERGE_PASS ' + join(opus, 'arm.json') + ': pass 3 is out of range: arm none-opus has passes 1 to 2');
    expect(refuse(['--rule', 'window', '--window', '4', '--source', opus + ':1-2', '--source', join(ARMS, 'none8-opus') + ':1-4'])).toBe('E_MERGE_PASS ' + join(ARMS, 'none8-opus', 'arm.json') + ': the sources give 6 sessions per unit, not a multiple of --window 4');
    expect(refuse(['--rule', 'pass', '--source', opus + ':1-2', '--source', sol + ':1-1'])).toStartWith('E_MERGE_PASS ' + join(sol, 'arm.json') + ': gives 1 passes; --rule pass needs');
    expect(refuse(['--rule', 'window', '--window', '1', '--source', opus + ':1-2', '--source', opus + ':2-2'])).toStartWith('E_MERGE_PASS ' + join(opus, 'arm.json') + ': pass 2 is given twice');
    expect(refuse(['--rule', 'window', '--window', '1', '--source', opus + ':0-1'])).toStartWith('E_MERGE_PASS');
  });

  test('a finding or cost row past the arm\'s passes is refused', () => {
    const dir = copyArm('none-opus', (d) => editJson(join(d, 'arm.json'), (j) => (j.passes = 1)));
    expect(refuse(['--rule', 'window', '--window', '1', '--source', dir])).toBe('E_MERGE_PASS ' + join(dir, 'findings', U1 + '.jsonl') + ' line 3: pass 2 is not 1 to 1 (arm.json passes)');
  });

  test('mismatched suites and suite digests are refused', () => {
    const other = copyArm('none-sol', (d) => editJson(join(d, 'arm.json'), (j) => (j.suite = 'other-suite')));
    expect(refuse(['--rule', 'pass', '--source', opus, '--source', other])).toBe('E_MERGE_SUITE ' + join(other, 'arm.json') + ': suite other-suite is not rb-fixture, the suite of ' + join(opus, 'arm.json'));
    const a = copyArm('none-opus', (d) => editJson(join(d, 'arm.json'), (j) => (j.suite_sha256 = 'a'.repeat(64))));
    const b = copyArm('none-sol', (d) => editJson(join(d, 'arm.json'), (j) => (j.suite_sha256 = 'b'.repeat(64))));
    expect(refuse(['--rule', 'pass', '--source', a, '--source', b])).toStartWith('E_MERGE_SUITE ' + join(b, 'arm.json') + ': suite_sha256 ' + 'b'.repeat(64) + ' is not ' + 'a'.repeat(64));
  });

  test('a source that is not a raw arm contract v1 directory is refused', () => {
    const v2 = copyArm('none-sol', (d) => editJson(join(d, 'arm.json'), (j) => (j.contract_version = 2)));
    expect(refuse(['--rule', 'pass', '--source', opus, '--source', v2])).toBe('E_MERGE_SOURCE ' + join(v2, 'arm.json') + ': contract_version is 2, not 1');
    const judged = copyArm('none-sol', (d) => writeFileSync(join(d, 'judgments.tsv'), 'pr\n'));
    expect(refuse(['--rule', 'pass', '--source', opus, '--source', judged])).toStartWith('E_MERGE_SOURCE ' + join(judged, 'judgments.tsv') + ': the arm is already judged');
    const extra = copyArm('none-sol', (d) => writeFileSync(join(d, 'notes.txt'), 'x\n'));
    expect(refuse(['--rule', 'pass', '--source', opus, '--source', extra])).toStartWith('E_MERGE_SOURCE ' + join(extra, 'notes.txt') + ': not part of arm contract v1');
    const bare = copyArm('none-sol', (d) => unlinkSync(join(d, 'arm.json')));
    expect(refuse(['--rule', 'pass', '--source', opus, '--source', bare])).toBe('E_MERGE_SOURCE ' + join(bare, 'arm.json') + ': missing, so this is not an arm contract v1 directory');
    const shape = copyArm('none-sol', (d) => writeFileSync(join(d, 'findings', U1 + '.jsonl'), JSON.stringify({ severity: 'P1', path: 'a.ts', line: 0, summary: 'x' }) + '\n'));
    expect(refuse(['--rule', 'pass', '--source', opus, '--source', shape])).toBe('E_MERGE_SOURCE ' + join(shape, 'findings', U1 + '.jsonl') + ' line 1: line is not a whole number from 1, or null');
  });

  test('cost, gap and severity map conflicts are refused', () => {
    const meter = copyArm('none-sol', (d) => writeFileSync(join(d, 'cost.tsv'), readFileSync(join(d, 'cost.tsv'), 'utf8').replaceAll('proxy-journal', 'estimate')));
    expect(refuse(['--rule', 'pass', '--source', opus, '--source', meter])).toStartWith('E_MERGE_COST ' + join(meter, 'cost.tsv') + ' line 2: meter_source estimate differs from proxy-journal');
    const nocost = copyArm('none-sol', (d) => unlinkSync(join(d, 'cost.tsv')));
    expect(refuse(['--rule', 'pass', '--source', opus, '--source', nocost])).toStartWith('E_MERGE_COST ' + join(nocost, 'cost.tsv') + ': missing');
    const gap = copyArm('none-sol', (d) => editJson(join(d, 'arm.json'), (j) => (j.coverage_gaps = ['something broke'])));
    expect(refuse(['--rule', 'pass', '--source', opus, '--source', gap])).toBe('E_MERGE_GAP ' + join(gap, 'arm.json') + ' coverage_gaps: "something broke" does not read "<unit> pass <n>: <reason>"');
    const sev = copyArm('none-sol', (d) => editJson(join(d, 'arm.json'), (j) => (j.severity_map.default.High = 'INFORMATIONAL')));
    expect(refuse(['--rule', 'pass', '--source', opus, '--source', sev])).toBe('E_MERGE_SEVMAP ' + join(sev, 'arm.json') + ': maps "High" to INFORMATIONAL, and an earlier source maps it to CRITICAL');
  });

  test('bad arguments and a non-empty output directory are refused', () => {
    const r = cli(['--id', 'bad id', '--label', 'x', '--out', outDir(), '--rule', 'pass', '--source', opus]);
    expect(r.code).toBe(2);
    expect(r.err).toStartWith('E_MERGE_ARGS --id');
    const full = outDir();
    mergeArms({ id: 'a', label: 'a', out: full, rule: 'pass', sources: [{ dir: opus }] });
    expect(() => mergeArms({ id: 'a', label: 'a', out: full, rule: 'pass', sources: [{ dir: opus }] })).toThrow('E_MERGE_ARGS ' + full + ': is not empty');
    expect(refuse(['--rule', 'window', '--source', opus])).toStartWith('E_MERGE_ARGS --window');
    expect(parseSource('a/b:3-4')).toEqual({ dir: 'a/b', first: 3, last: 4 });
    expect(parseSource('a/b')).toEqual({ dir: 'a/b' });
  });
});
