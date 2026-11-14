// internal-task QM /review smoke (harnesses/qm/gstack/review-smoke.ts and review-signals.ts), keyless. The fixtures under
// tests/fixtures/qm-review-smoke/ come from the driver's own --dry-run on QM 90e4ced7 (the scripted fake model loads the
// review skill, opens a testing reader and an adversarial reader, waits, and ends): the stored session with the skill
// answer's text cut down, and the tool names of the first captured request with and without QM's persistent_subagents
// feature. The last test runs the driver's --dry-run --plan, which builds the unit repository and the skill layer and
// stops before any image, stack or proxy.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { REVIEW_PREFIX, PREFIX_FILE_SHA256, TOLD_SHA256, TOLD_TEMPLATE, buildUnitRepo, fakeAnswer, jsonBlock, loadReaderMap, reviewLayer, toldLine, unitProblems, type Unit } from '../harnesses/qm/gstack/review-smoke.ts';
import { ADVERSARIAL, BATCHED, OTHER, SignalError, readerOf, reviewSignals } from '../harnesses/qm/gstack/review-signals.ts';

const ROOT = resolve(import.meta.dir, '..');
const DIR = join(import.meta.dir, 'fixtures', 'qm-review-smoke');
const json = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const map = loadReaderMap();
const told = toldLine('main');
const GIT_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
const git = (dir: string, ...a: string[]) => { const r = spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: GIT_ENV }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };

/** A source repository with a base branch, a feature branch of two commits, and a later commit on the base. */
function sourceRepo(): { dir: string; head: string; base: string; forkPoint: string } {
  const dir = mkdtempSync(join(tmpdir(), 'qm-review-src-'));
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'base');
  const forkPoint = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-q', '-b', 'feature');
  writeFileSync(join(dir, 'a.ts'), 'export const a = 2;\nexport const b = a + 1;\n');
  git(dir, 'commit', '-q', '-am', 'change a');
  writeFileSync(join(dir, 'b.ts'), 'export const c = 3;\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'add b');
  const head = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-q', 'main');
  writeFileSync(join(dir, 'later.ts'), 'export const later = true;\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'a later commit the reviewer must not see');
  git(dir, 'tag', 'v1');
  return { dir, head, base: git(dir, 'rev-parse', 'HEAD'), forkPoint };
}
const fixtureUnit = (s: { head: string; base: string }): Unit => ({ id: 'fixture/repo#7@' + s.head.slice(0, 12), repo: 'fixture/repo', pr: 7, head: s.head, base: s.base, base_branch: 'main', licence: 'MIT', url: 'https://example.invalid/pr/7' });

/** A gstack-shaped checkout with a small review/ folder. */
function gstackFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qm-review-gstack-'));
  mkdirSync(join(dir, 'review', 'specialists'), { recursive: true });
  writeFileSync(join(dir, 'review', 'SKILL.md'), '---\nname: review\ndescription: Use when you review this PR\'s diff. (fixture)\n---\n# Review\n');
  writeFileSync(join(dir, 'review', 'specialists', 'testing.md'), '# Testing checklist (fixture)\n');
  writeFileSync(join(dir, 'review', '.DS_Store'), 'junk');
  git(dir, 'init', '-q'); git(dir, 'add', 'review/SKILL.md', 'review/specialists'); git(dir, 'commit', '-q', '-m', 'fixture');
  return dir;
}

describe('told line', () => {
  test('the template is gstack-evals TOLD_TEMPLATE and the prefix is the R2 file without its newline', () => {
    expect(sha256(TOLD_TEMPLATE)).toBe(TOLD_SHA256);
    expect(TOLD_SHA256).toBe('16862a34212cd2eddbcedbc5654b26cb92b0dad50e3d501686770e6bc3d088ad');
    expect(sha256(REVIEW_PREFIX + '\n')).toBe(PREFIX_FILE_SHA256);
    expect(told.startsWith(REVIEW_PREFIX + ' Review the changes on this branch against the base branch main: ')).toBe(true);
    expect(told).toContain('as git diff main...HEAD shows them.');
    expect(told).not.toContain('{base}');
  });
});

describe('reader map and reader names', () => {
  test('the vendored map is the R2 map', () => {
    expect(map.gstack.sha).toBe('699a41cb6808e01240d02e82247693f9170d401a');
    expect(map.adversarial).toEqual(['Think like an attacker and a chaos engineer']);
  });
  test('one checklist, two checklists, the marker alone, neither', () => {
    expect(readerOf('Read /root/workspace/.agent-skills/x/y/review/specialists/testing.md', map).reader).toBe('testing');
    expect(readerOf('review/specialists/security.md and review/specialists/performance.md', map).reader).toBe(BATCHED);
    expect(readerOf('Think like an attacker and a chaos engineer. Review the diff.', map)).toEqual({ reader: ADVERSARIAL, checklists: [], adversarial: true });
    expect(readerOf('Summarise the diff', map).reader).toBe(OTHER);
  });
});

describe('unit repository', () => {
  const s = sourceRepo();
  const dest = join(mkdtempSync(join(tmpdir(), 'qm-review-unit-')), 'repo');
  const repo = buildUnitRepo(fixtureUnit(s), s.dir, dest);
  test('head and its ancestry only, the base branch and origin/<base> at the merge-base, no tags or remotes', () => {
    expect(repo.merge_base).toBe(s.forkPoint);
    expect(repo.ancestry.count).toBe(3);
    expect(repo.changed_lines).toBe(4);
    expect(git(dest, 'rev-parse', 'main')).toBe(s.forkPoint);
    expect(git(dest, 'rev-parse', 'origin/main')).toBe(s.forkPoint);
    expect(git(dest, 'rev-parse', 'HEAD')).toBe(s.head);
    expect(git(dest, 'tag', '-l')).toBe('');
    expect(git(dest, 'remote')).toBe('');
    expect(() => git(dest, 'cat-file', '-t', s.base)).toThrow();
    expect(readFileSync(join(dest, '.git', 'info', 'exclude'), 'utf8')).toContain('.agent-skills/');
    expect(unitProblems(dest, repo)).toEqual([]);
  });
  test('a dirty tree or a moved ref is a problem', () => {
    writeFileSync(join(dest, 'b.ts'), 'changed\n');
    expect(unitProblems(dest, repo)).toContain('the working tree is not clean');
    git(dest, 'checkout', '-q', '--', 'b.ts');
    git(dest, 'update-ref', 'refs/heads/main', s.head);
    expect(unitProblems(dest, repo).some((p) => p.startsWith('refs are'))).toBe(true);
  });
});

describe('review skill layer', () => {
  test('every regular file under review/ at skills/review/<path>, junk names skipped', () => {
    const layer = reviewLayer(gstackFixture());
    expect(layer.contract).toBe(1);
    expect(layer.skills.map((f) => f.path)).toEqual(['skills/review/SKILL.md', 'skills/review/specialists/testing.md']);
  });
  test('a symlink or a missing SKILL.md is refused', () => {
    const g = gstackFixture();
    symlinkSync('SKILL.md', join(g, 'review', 'alias.md'));
    expect(() => reviewLayer(g)).toThrow('not a regular file');
    const bare = mkdtempSync(join(tmpdir(), 'qm-review-bare-'));
    mkdirSync(join(bare, 'review'));
    writeFileSync(join(bare, 'review', 'notes.md'), 'x');
    expect(() => reviewLayer(bare)).toThrow('no review/SKILL.md');
  });
});

describe('signals from the dry run\'s stored QM session', () => {
  const session = json('dry-run-session.json');
  const requests = json('dry-run-requests.json');
  test('known good: skill opened, testing and adversarial readers dispatched, both reports back before the end', () => {
    const s = reviewSignals({ session, requests, map, told, endSeq: 11 });
    expect(s.skill_opened).toBe(true);
    expect(s.subagent_tool_offered).toBe(true);
    expect(s.specialists_dispatched).toEqual(['testing']);
    expect(s.adversarial_dispatched).toBe(true);
    expect(s.readers.map((r) => [r.reader, r.returned_before_end, r.kind])).toEqual([['testing', true, 'final_answer'], [ADVERSARIAL, true, 'final_answer']]);
    expect(s.all_returned_before_end).toBe(true);
  });
  test('a report after the told turn ended is late, not returned before the end', () => {
    const s = reviewSignals({ session, map, told, endSeq: 9 });
    expect(s.readers.every((r) => r.returned && !r.returned_before_end)).toBe(true);
    expect(s.all_returned_before_end).toBe(false);
  });
  test('QM without the subagent feature offers no subagents tool', () => {
    expect(json('dry-run-requests-subagents-off.json')[0].tools.map((t: { name: string }) => t.name)).not.toContain('subagents');
    expect(reviewSignals({ session, requests: json('dry-run-requests-subagents-off.json'), map, told }).subagent_tool_offered).toBe(false);
  });
  test('a refused launch is no reader', () => {
    const items = structuredClone(session.items) as Array<Record<string, unknown>>;
    const open = items.find((i) => i.kind === 'ToolResult' && i.tool === 'subagents' && String(i.text).startsWith('Opened'))!;
    open.text = '[error] subagents aren\'t available on this turn.';
    open.isError = true;
    const s = reviewSignals({ session: { items }, map, told });
    expect(s.launches.filter((l) => l.refused)).toHaveLength(1);
    expect(s.readers).toHaveLength(1);
  });
  test('an unreadable trace is an error with a stable code', () => {
    expect(() => reviewSignals({ session: { items: [] }, map, told })).toThrow(SignalError);
    expect(() => reviewSignals({ session: { items: [] }, map, told })).toThrow('E_QM_TRACE_EMPTY');
    expect(() => reviewSignals({ session: { items: session.items.slice(1) }, map, told })).toThrow('E_QM_TRACE_NO_TOLD');
  });
});

describe('the dry run\'s scripted model', () => {
  const user = { role: 'user', content: told };
  const tools = ['skills', 'execute', 'subagents'].map((name) => ({ name }));
  const use = (name: string, input: Record<string, unknown>) => ({ role: 'assistant', content: [{ type: 'tool_use', id: 't', name, input }] });
  test('the reviewing session: skill, git, two readers, then waits until both reports are in', () => {
    expect(fakeAnswer({ tools, messages: [user] }).content[0]).toMatchObject({ name: 'skills', input: { action: 'read', name: 'review' } });
    const two = [user, use('skills', {}), use('execute', {}), use('subagents', {}), use('subagents', {})];
    expect(fakeAnswer({ tools, messages: two }).content[0]).toMatchObject({ name: 'subagents', input: { action: 'wait' } });
    const back = [...two, { role: 'user', content: [{ type: 'tool_result', content: '<wake reason="subagent" name="a" sessionId="s1" kind="final_answer">\n<wake reason="subagent" name="b" sessionId="s2" kind="final_answer">' }] }];
    expect(jsonBlock(String(fakeAnswer({ tools, messages: back }).content[0]!.text))).toEqual({ parsed: true, findings: 0 });
  });
  test('without the subagents tool it ends after the git command; a reader answers at once; no tools gets ok', () => {
    expect(fakeAnswer({ tools: tools.slice(0, 2), messages: [user, use('skills', {}), use('execute', {})] }).stop).toBe('end_turn');
    expect(fakeAnswer({ tools, messages: [{ role: 'user', content: 'Review the testing checklist' }] }).content[0]!.text).toContain('fake reader report');
    expect(fakeAnswer({ messages: [user] }).content[0]!.text).toBe('ok');
  });
});

test('--dry-run --plan: keyless, builds the unit and the layer and stops before docker', () => {
  const s = sourceRepo();
  const work = mkdtempSync(join(tmpdir(), 'qm-review-work-'));
  writeFileSync(join(work, 'unit.json'), JSON.stringify(fixtureUnit(s)));
  const r = spawnSync('bun', [join(ROOT, 'harnesses', 'qm', 'gstack', 'review-smoke.ts'), '--dry-run', '--plan', '--work', work, '--out', join(work, 'out'), '--gstack', gstackFixture(), '--source', s.dir, '--unit', join(work, 'unit.json')], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: work }, cwd: ROOT, timeout: 25_000 });
  expect(r.status).toBe(0);
  const plan = JSON.parse(r.stdout);
  expect(plan.dry_run).toBe(true);
  expect(plan.told.text).toBe(told);
  expect(plan.skill.files).toBe(2);
  expect(plan.unit.changed_lines).toBe(4);
  expect(plan.model).toBe('anthropic:claude-opus-5-5');
  expect(plan.subagents).toBe('persistent_subagents on for personal:U1');
});
