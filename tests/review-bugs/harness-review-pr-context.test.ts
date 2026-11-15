// harness-review.ts session --pr-context and collect across units with different bases (internal-task stage 2, C3). Keyless and
// docker-free: the PR template is gstack-evals #344's byte for byte, prepareTask tells it with the unit's pr.md, a missing or
// unshowable pr.md refuses the session, and collect takes sessions whose told lines differ only in base and PR text.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, prepareTask, readPrText, ReviewError, type SessionOptions } from '../../scripts/review-bugs/harness-review.ts';
import { makeUnitRepo } from '../../scripts/review-bugs/harness-smoke.ts';
import { prTextProblem, sha256, TOLD_PR_SHA256, TOLD_PR_TEMPLATE, TOLD_TEMPLATE, toldRecord, toldText } from '../../scripts/review-bugs/told.ts';

const tmp = mkdtempSync(join(tmpdir(), 'harness-review-pr-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('the PR template', () => {
  test('is the stage 1 pin: TOLD_TEMPLATE with the PR block after its first paragraph', () => {
    expect(sha256(TOLD_PR_TEMPLATE)).toBe(TOLD_PR_SHA256);
    expect(TOLD_PR_SHA256).toBe('f52ecea76a934596833e535d314b14ce696d4e6ed40926eea532542cdf876a79');
    const [first, ...rest] = TOLD_TEMPLATE.split('\n\n');
    expect(TOLD_PR_TEMPLATE).toBe(first + "\n\nThe pull request's title and description, as its author first wrote them:\n\n{pr}\n\n" + rest.join('\n\n'));
  });
  test('toldText fills the PR text after the base, unchanged, and keeps the arm prefix first', () => {
    const pr = '# Fix {base} parsing\n\nUses $& and {base} literally.\n\n';
    const t = toldText('review', 'openclaw', 'dev', pr);
    expect(t.startsWith('/review Run the full review procedure')).toBe(true);
    expect(t).toContain('as its author first wrote them:\n\n# Fix {base} parsing\n\nUses $& and {base} literally.\n\nYou may write');
    expect(t).toContain('against the base branch dev:');
    expect(toldText('plain', 'openclaw', 'main', pr).startsWith('Review the changes')).toBe(true);
    expect(toldText('plain', 'openclaw', 'main')).toBe(TOLD_TEMPLATE.replaceAll('{base}', 'main'));
    expect(toldRecord('plain', 'openclaw', true)).toMatchObject({ template_sha256: TOLD_PR_SHA256, pr_context: true });
    expect(toldRecord('plain', 'openclaw')).toMatchObject({ template_sha256: sha256(TOLD_TEMPLATE), pr_context: false });
  });
  test('PR text with no title or a control character is refused', () => {
    expect(prTextProblem('#  \n')).toMatch(/no title/);
    expect(prTextProblem('# T\n\u0007')).toMatch(/U\+0007/);
    expect(prTextProblem('# T\n\tbody\n')).toBeNull();
    expect(() => toldText('plain', 'openclaw', 'main', '# T\u001b')).toThrow(/cannot be shown/);
  });
});

describe('a session with --pr-context', () => {
  const repo = makeUnitRepo(join(tmp, 'unit'));
  const prDir = join(tmp, 'pr');
  const unit = 'synthetic/window#1@abc123456789';
  mkdirSync(join(prDir, 'synthetic_window_1_abc123456789'), { recursive: true });
  writeFileSync(join(prDir, 'synthetic_window_1_abc123456789', 'pr.md'), '# Window ends\n\nMake the window end exclusive.\n');
  const opts = (o: Partial<SessionOptions> = {}): SessionOptions => ({ harness: 'openclaw', arm: 'review', unit, unitRepo: repo, base: 'main', pass: 1, image: 'x', model: 'm',
    baseUrl: 'http://proxy/slot/particle', apiKey: 't', out: join(tmp, 'out'), trialId: 't1', timeBudget: 600, network: null, hostGateway: null, ...o });
  test('instruction.md carries the PR block from the unit\'s pr.md', () => {
    const text = prepareTask(opts({ prContext: prDir }), join(tmp, 'task-pr'));
    expect(readFileSync(join(tmp, 'task-pr', 'instruction.md'), 'utf8')).toBe(text);
    expect(text).toBe(toldText('review', 'openclaw', 'main', '# Window ends\n\nMake the window end exclusive.\n'));
  });
  test('without --pr-context the told text is unchanged', () => {
    expect(prepareTask(opts(), join(tmp, 'task-plain'))).toBe(toldText('review', 'openclaw', 'main'));
  });
  test('a unit with no pr.md, or an unshowable one, is refused', () => {
    expect(() => readPrText(prDir, 'synthetic/other#2@abc')).toThrow(ReviewError);
    mkdirSync(join(prDir, 'synthetic_bad_3_x'), { recursive: true });
    writeFileSync(join(prDir, 'synthetic_bad_3_x', 'pr.md'), '#\n');
    expect(() => readPrText(prDir, 'synthetic/bad#3@x')).toThrow(/E_REVIEW_PR .*no title/);
  });
});

describe('collect across units', () => {
  const base = { schema_version: 1, harness: 'openclaw', arm: 'plain', model: 'particle-1', image: 'harness-eval/openclaw:gstack-none', image_labels: {}, parser_sha256: 'a', upstream_parser_sha256: 'b', wall_ms: 1, parse: { outcome: 'empty', findings: 0 }, findings: [], read_audit: { verdict: 'clean' } };
  const told = (b: string, pr: string | null) => ({ ...toldRecord('plain', 'openclaw', true), text_sha256: sha256(b + (pr ?? '')), base: b, ...(pr ? { pr_sha256: sha256(pr) } : {}) });
  const write = (root: string, dir: string, rec: object) => { mkdirSync(join(root, dir), { recursive: true }); writeFileSync(join(root, dir, 'session.json'), JSON.stringify(rec)); };
  test('sessions whose told lines differ only in base and PR text collect as one arm', () => {
    const s = join(tmp, 'sessions-ok');
    write(s, 'a', { ...base, unit: 'acme/app#1@aaa', pass: 1, trial_id: 'a', told: told('main', 'one') });
    write(s, 'b', { ...base, unit: 'acme/lib#2@bbb', pass: 1, trial_id: 'b', told: told('dev', 'two') });
    const arm: any = collect({ sessions: s, out: join(tmp, 'arm-ok'), id: 'plain-x', label: 'x', suite: 's', usageLogs: [], suiteSha256: null, date: '2026-11-15', meterKey: (r) => r.trial_id });
    expect(arm.passes).toBe(1);
  });
  test('sessions with different told templates are still refused', () => {
    const s = join(tmp, 'sessions-mixed');
    write(s, 'a', { ...base, unit: 'acme/app#1@aaa', pass: 1, trial_id: 'a', told: told('main', 'one') });
    write(s, 'b', { ...base, unit: 'acme/lib#2@bbb', pass: 1, trial_id: 'b', told: { ...toldRecord('plain', 'openclaw'), text_sha256: 'x', base: 'main' } });
    expect(() => collect({ sessions: s, out: join(tmp, 'arm-mixed'), id: 'plain-x', label: 'x', suite: 's', usageLogs: [], suiteSha256: null, date: '2026-11-15', meterKey: (r) => r.trial_id })).toThrow(/mix told lines/);
  });
});
