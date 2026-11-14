// The OpenClaw and Hermes review sessions of the real-bug review eval (scripts/review-bugs/harness-review.ts, told.ts,
// rig-findings.ts, harness-smoke.ts). Keyless and docker-free: the told lines and their pins, the image rule per arm, the
// work-dir preparation on a synthetic unit repo, the parse of a finished session, and collect's arm contract v1 output from
// session records and proxy usage lines. The end-to-end runs (real images, real proxy, fake or paid upstream) are
// harness-smoke.ts, recorded in scripts/review-bugs/README.md.
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkUnitRepo, collect, COST_COLUMNS, imageRefusal, meterRow, parseSession, prepareTask, ReviewError, unitFile, type ImageLabels, type SessionOptions } from '../../scripts/review-bugs/harness-review.ts';
import { makeUnitRepo } from '../../scripts/review-bugs/harness-smoke.ts';
import { HOST_COMMAND, R2_PREFIX_FILE_SHA256, R2_REVIEW_PREFIX, reviewPrefix, sha256, TOLD_SHA256, TOLD_TEMPLATE, toldRecord, toldText } from '../../scripts/review-bugs/told.ts';
import { UPSTREAM_PARSER_SHA256 } from '../../scripts/review-bugs/rig-findings.ts';

const tmp = mkdtempSync(join(tmpdir(), 'harness-review-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const ROOT = resolve(import.meta.dir, '../..');
const FENCE = '\x60\x60\x60';

describe('told lines', () => {
  test('the template is gstack-evals #108 template byte for byte, and the R2 prefix is told-gstack-full-rr2.txt', () => {
    expect(sha256(TOLD_TEMPLATE)).toBe(TOLD_SHA256);
    expect(TOLD_SHA256).toBe('16862a34212cd2eddbcedbc5654b26cb92b0dad50e3d501686770e6bc3d088ad');
    expect(sha256(R2_REVIEW_PREFIX + '\n')).toBe(R2_PREFIX_FILE_SHA256);
    expect(sha256(R2_REVIEW_PREFIX)).toBe('e1beaf226c671bcdcf5aa21dc8a2665994f65838cb3d3c9ce65f563bf9e9ff27');
  });
  test('plain is the template with the base filled and no prefix, on both hosts', () => {
    for (const h of ['openclaw', 'hermes'] as const) {
      const t = toldText('plain', h, 'main');
      expect(t).toBe(TOLD_TEMPLATE.replaceAll('{base}', 'main'));
      expect(t.startsWith('Review the changes on this branch against the base branch main:')).toBe(true);
      expect(toldRecord('plain', h)).toMatchObject({ prefix: '', prefix_sha256: null, adapted: false });
    }
  });
  test('review keeps R2 on OpenClaw and changes only the command word on Hermes', () => {
    expect(reviewPrefix('openclaw')).toBe(R2_REVIEW_PREFIX);
    expect(reviewPrefix('hermes')).toBe('/gstack-review' + R2_REVIEW_PREFIX.slice('/review'.length));
    expect(HOST_COMMAND).toEqual({ openclaw: '/review', hermes: '/gstack-review' });
    expect(toldText('review', 'openclaw', 'master')).toBe(R2_REVIEW_PREFIX + ' ' + TOLD_TEMPLATE.replaceAll('{base}', 'master'));
    expect(toldRecord('review', 'openclaw').adapted).toBe(false);
    expect(toldRecord('review', 'hermes').adapted).toBe(true);
  });
  test('a base name with whitespace is refused', () => {
    expect(() => toldText('plain', 'openclaw', 'main; rm')).toThrow(/base branch name/);
  });
});

describe('vendored findings parser', () => {
  const upstream = process.env.GSTACK_EVALS_DIR ? join(process.env.GSTACK_EVALS_DIR, 'src/trial/review/findings.ts') : null;
  test.skipIf(!upstream || !existsSync(upstream))('matches gstack-evals findings.ts apart from the two marked lines', () => {
    const up = readFileSync(upstream!, 'utf8');
    expect(createHash('sha256').update(up).digest('hex')).toBe(UPSTREAM_PARSER_SHA256);
    const mine = readFileSync(join(ROOT, 'scripts/review-bugs/rig-findings.ts'), 'utf8').split('\n').slice(6)
      .filter((l) => !l.startsWith('type Termination = ') && !l.startsWith('export const UPSTREAM_PARSER_SHA256'));
    const theirs = up.split('\n').filter((l) => !l.startsWith('import type { Termination }'));
    expect(mine).toEqual(theirs);
  });
});

describe('the image decides the arm', () => {
  const l = (o: Partial<ImageLabels>): ImageLabels => ({ id: 'sha256:x', commit: 'none', start_hook: 'off', overlay: 'openclaw', ref: 'none', ...o });
  const pin = '4bee369d4a417fb82c6d43c0b79351428305ef10';
  test('plain needs the no-gstack overlay, review a pinned gstack overlay, both with the hook off', () => {
    expect(imageRefusal(l({}), 'plain', 'openclaw')).toBeNull();
    expect(imageRefusal(l({ commit: pin }), 'review', 'openclaw')).toBeNull();
    expect(imageRefusal(l({ commit: pin }), 'plain', 'openclaw')).toMatch(/no-gstack overlay/);
    expect(imageRefusal(l({}), 'review', 'openclaw')).toMatch(/40-character gstack commit/);
    expect(imageRefusal(l({ commit: pin, start_hook: 'on' }), 'review', 'openclaw')).toMatch(/start_hook on/);
    expect(imageRefusal(l({ overlay: 'hermes' }), 'plain', 'openclaw')).toMatch(/hermes overlay/);
    expect(imageRefusal(l({ overlay: null }), 'plain', 'openclaw')).toMatch(/unlabelled/);
  });
});

describe('the work dir', () => {
  const repo = makeUnitRepo(join(tmp, 'unit'));
  const opts = (o: Partial<SessionOptions> = {}): SessionOptions => ({ harness: 'openclaw', arm: 'plain', unit: 'synthetic/window#1', unitRepo: repo, base: 'main', pass: 1, image: 'x', model: 'm',
    baseUrl: 'http://host.docker.internal:1/s/anthropic', apiKey: 'trial-token:s.x', out: join(tmp, 'out'), trialId: 's', timeBudget: 600, network: null, hostGateway: null, ...o });
  test('the unit repo is checked: base present, HEAD off the base, a clean tree', () => {
    const u = checkUnitRepo(repo, 'main');
    expect(u.branch).toBe('pr-1');
    expect(u.merge_base).toBe(u.base_sha);
    expect(u.diff_shortstat).toContain('1 file changed');
    expect(() => checkUnitRepo(repo, 'develop')).toThrow(/no local branch develop/);
    writeFileSync(join(repo, 'stray.txt'), 'x');
    expect(() => checkUnitRepo(repo, 'main')).toThrow(/dirty/);
    rmSync(join(repo, 'stray.txt'));
    expect(() => checkUnitRepo(join(tmp, 'nowhere'), 'main')).toThrow(ReviewError);
  });
  test('the told text is instruction.md, excluded from git, and the copied tree stays clean with the same diff', () => {
    const task = join(tmp, 'task');
    const text = prepareTask(opts({ arm: 'review', harness: 'hermes' }), task);
    expect(readFileSync(join(task, 'instruction.md'), 'utf8')).toBe(text);
    expect(text.startsWith('/gstack-review Run the full review procedure')).toBe(true);
    expect(readFileSync(join(task, 'workspace', '.git', 'info', 'exclude'), 'utf8')).toContain('/instruction.md\n');
    writeFileSync(join(task, 'workspace', 'instruction.md'), text);
    const g = (...a: string[]) => spawnSync('git', ['-C', join(task, 'workspace'), ...a], { encoding: 'utf8' }).stdout.trim();
    expect(g('status', '--porcelain', '--untracked-files=all')).toBe('');
    expect(g('diff', '--name-only', 'main...HEAD')).toBe('window.py');
    expect(readFileSync(join(task, 'task.toml'), 'utf8')).toContain('time_budget_s = 600');
    expect(spawnSync(join(task, 'grader', 'check.sh')).status).toBe(0);
  });
});

describe('the parse of a finished session', () => {
  const block = 'Done.\n\n' + FENCE + 'json\n[{"file": "a.py", "line": 2, "severity": "P1", "claim": "x", "evidence": "y"}]\n' + FENCE;
  test('only an exit 0 with a complete transcript is read; anything else is incomplete, never zero findings', () => {
    expect(parseSession(0, { transcript: 'complete', final_text: block })).toMatchObject({ kind: 'findings' });
    expect(parseSession(0, { transcript: 'complete', final_text: 'no block' })).toEqual({ kind: 'missing' });
    expect(parseSession(0, { transcript: 'complete', final_text: FENCE + 'json\n{\n' + FENCE })).toMatchObject({ kind: 'malformed' });
    expect(parseSession(124, { transcript: 'complete', final_text: block })).toEqual({ kind: 'incomplete', reason: 'the session ended timeout (exit 124)' });
    expect(parseSession(0, { transcript: 'truncated', final_text: block })).toEqual({ kind: 'incomplete', reason: 'the transcript is truncated' });
    expect(parseSession(0, { transcript: 'complete', final_text: null })).toMatchObject({ kind: 'incomplete' });
    expect(parseSession(3, { transcript: 'missing', final_text: null })).toMatchObject({ kind: 'incomplete', reason: 'the session ended model_error (exit 3)' });
  });
});

describe('collect writes arm contract v1', () => {
  const usage = [
    { key: 'trial-token:s1', outcome: 'forwarded', actual_usd: 0.002, input_tokens: 1000, output_tokens: 100, cached_tokens: 600, cache_write_tokens: 100, reasoning_tokens: 10 },
    { key: 'trial-token:s1', outcome: 'forwarded', actual_usd: 0.001, input_tokens: 500, output_tokens: 50, cached_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0 },
    { key: 'trial-token:s1', outcome: 'refused', route: '/v1/models' },
    { key: 'trial-token:s2', outcome: 'forwarded', actual_usd: 0.5, charged_reservation: true, usage_unknown: true, input_tokens: 0, output_tokens: 0 },
    { key: 'trial-token:other', outcome: 'forwarded', actual_usd: 9 },
  ];
  test('meterRow sums one slot, splits cache from input and marks an unknown call', () => {
    expect(meterRow(usage, 'trial-token:s1')).toEqual({ input: 800, output: 150, cache_read: 600, cache_write: 100, reasoning: 10, usd: 0.003, requests: 2, refused: 1, unknown: 0 });
    expect(meterRow(usage, 'trial-token:s2').unknown).toBe(1);
  });
  const sessions = join(tmp, 'sessions');
  const finding = { severity: 'CRITICAL', path: 'window.py', line: 3, summary: 'end is exclusive', pass: 1, id: 'p1-1', evidence: 'start <= day < end' };
  const base = { schema_version: 1, harness: 'openclaw', arm: 'plain', model: 'particle-1', image: 'harness-eval/openclaw:gstack-none', image_labels: {}, told: { arm: 'plain' }, parser_sha256: 'a', upstream_parser_sha256: 'b' };
  const write = (dir: string, rec: object) => { mkdirSync(join(sessions, dir), { recursive: true }); writeFileSync(join(sessions, dir, 'session.json'), JSON.stringify(rec)); };
  write('s1', { ...base, unit: 'acme/app#12@abc1234', pass: 1, trial_id: 's1', wall_ms: 12345, parse: { outcome: 'findings', findings: 1 }, findings: [finding], read_audit: { verdict: 'clean' } });
  write('s2', { ...base, unit: 'acme/app#12@abc1234', pass: 2, trial_id: 's2', wall_ms: 5000, parse: { outcome: 'incomplete', reason: 'the session ended timeout (exit 124)' }, findings: [], read_audit: { verdict: 'clean' } });
  write('s3', { ...base, unit: 'acme/lib#7', pass: 1, trial_id: 's3', wall_ms: 1000, parse: { outcome: 'empty', findings: 0 }, findings: [], read_audit: { verdict: 'contaminated' } });
  writeFileSync(join(tmp, 'usage.ndjson'), usage.map((u) => JSON.stringify(u)).join('\n') + '\n');
  test('arm.json, one findings file per unit and an all row per unit-pass; a gap stops the arm', () => {
    const out = join(tmp, 'arm');
    const arm: any = collect({ sessions, out, id: 'plain-particle1-openclaw', label: 'plain on OpenClaw', suite: 'review-real-bugs', usageLogs: [join(tmp, 'usage.ndjson')], suiteSha256: null, date: '2026-11-14', meterKey: (s) => 'trial-token:' + s.trial_id });
    expect(arm).toMatchObject({ contract_version: 1, id: 'plain-particle1-openclaw', suite: 'review-real-bugs', passes: 2, kind: 'reference', provenance: 'live', status: 'stopped', models: [{ role: 'driver', model: 'particle-1' }] });
    expect(arm.coverage_gaps).toEqual(['acme/app#12@abc1234 pass 2: incomplete (the session ended timeout (exit 124))', 'acme/lib#7 pass 2: not run']);
    expect(arm.parse_outcomes).toMatchObject({ findings: 1, empty: 1, incomplete: 1 });
    expect(arm.read_audit).toEqual({ clean: 2, contaminated: 1 });
    expect(unitFile('acme/app#12@abc1234')).toBe('acme__app#12@abc1234.jsonl');
    expect(readFileSync(join(out, 'findings', 'acme__app#12@abc1234.jsonl'), 'utf8')).toBe(JSON.stringify(finding) + '\n');
    expect(readFileSync(join(out, 'findings', 'acme__lib#7.jsonl'), 'utf8')).toBe('');
    const rows = readFileSync(join(out, 'cost.tsv'), 'utf8').trim().split('\n').map((r) => r.split('\t'));
    expect(rows[0]).toEqual([...COST_COLUMNS]);
    expect(rows[1]).toEqual(['acme/app#12@abc1234', 'all', '1', '1650', '800', '150', '600', '100', '10', '0.003000', '12.3', 'proxy-journal', '2', '1', '0']);
    expect(rows[2]!.slice(0, 4)).toEqual(['acme/app#12@abc1234', 'all', '2', 'unavailable']);
    expect(rows[2]![9]).toBe('unavailable');
    expect(rows[3]!.slice(0, 3)).toEqual(['acme/lib#7', 'all', '1']);
  });
  test('sessions that mix harnesses or arms are refused, and a bad arm id too', () => {
    const mixed = join(tmp, 'mixed');
    mkdirSync(join(mixed, 'a'), { recursive: true }); mkdirSync(join(mixed, 'b'), { recursive: true });
    writeFileSync(join(mixed, 'a', 'session.json'), JSON.stringify({ ...base, unit: 'u', pass: 1, trial_id: 'a', wall_ms: 1, parse: { outcome: 'empty' }, findings: [], read_audit: { verdict: 'clean' } }));
    writeFileSync(join(mixed, 'b', 'session.json'), JSON.stringify({ ...base, arm: 'review', unit: 'u', pass: 2, trial_id: 'b', wall_ms: 1, parse: { outcome: 'empty' }, findings: [], read_audit: { verdict: 'clean' } }));
    const o = { sessions: mixed, out: join(tmp, 'm-out'), id: 'x', label: 'x', suite: 's', usageLogs: [], suiteSha256: null, date: '2026-11-14', meterKey: (s: any) => s.trial_id };
    expect(() => collect(o)).toThrow(/mix arm values/);
    expect(() => collect({ ...o, id: "A'" })).toThrow(/arm id/);
  });
});
