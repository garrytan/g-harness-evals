// Tests for the S1 edition rerun driver (harnesses/qm/gstack/s1e-probe.ts, s1e-count.ts) without Docker or a key. The
// counters run against the stored S1 sessions under docs/benchmarks/2026-11-03-qm-s1-gstack-probe/results/turns/ (QM
// b6786d67's real tool_call and tool_result shapes, skills reads included) and against small sessions in the same shape.
// The edition here is a test-only stub with the layout of gstack's qm/ folder (tests/fixtures/qm-s1e/gstack/qm/) and the
// real edition.json's marker regexes; the requests are test-only. None of it is the private task bank. The end-to-end
// dry run against the real edition needs Docker and the rig images; it is a command in harnesses/qm/gstack/README.md.
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SKILL_ROOT, toolCalls, type Entry } from '../harnesses/qm/gstack/s1-count.ts';
import { systemOf } from '../harnesses/qm/gstack/s1-probe.ts';
import { ARMS, INDEX_DASH, cleanArm, countTrial, editionCompleteRead, editionFrom, editionOpens, indexHas, indexIntact, layerBundle, nextApproval, parseTasks, pathRewrite, skillFor, splitFrontmatter, summarize, trialPlan, trialStatus, type CleanEvidence, type EditionSkill, type Task, type TurnRecord } from '../harnesses/qm/gstack/s1e-count.ts';
import { APPROVAL_PROBE, DRY_RUN_FIRST_STEP, DRY_RUN_TASKS, TEST_FIXTURES, dryRunScript, imageProblems, inputProblems, leaseProblem, nextAttempts, readEdition } from '../harnesses/qm/gstack/s1e-probe.ts';

const S1_TURNS = join(import.meta.dir, '..', 'docs', 'benchmarks', '2026-11-03-qm-s1-gstack-probe', 'results', 'turns');
const DEPLOY = mkdtempSync(join(tmpdir(), 's1e-deploy-'));
const LOADED = readEdition(join(TEST_FIXTURES, 'gstack'), DEPLOY);
const EDITION = LOADED.skills;
const MARKERS = LOADED.markers;
const byName = (n: string) => EDITION.find((s) => s.name === n)!;
const INV = 'gstack-investigate', REV = 'gstack-review', PLAN = 'gstack-plan';
const SYNC = '/root/workspace/.agent-skills/30920e29b43a3008e9083dd6/ba7fb918009fdbaf';

function session(steps: Step[]): Entry[] {
  const entries: Entry[] = [{ seq: 0, type: 'user', payload: { text: 'request' } }];
  steps.forEach(([tool, args, result], i) => {
    const callId = 'toolu_' + i;
    entries.push({ seq: entries.length, type: 'tool_call', payload: { tool, callId, ...('action' in args ? { action: args.action } : {}), wire: { argumentsJson: JSON.stringify(args) } } });
    if (result) entries.push({ seq: entries.length, type: 'tool_result', payload: { callId, tool, ...result } });
  });
  return entries;
}
type Step = [string, Record<string, unknown>, Record<string, unknown> | null];
const skillRead = (name: string, result: Record<string, unknown>): Step => ['skills', { action: 'read', name }, { name, action: 'read', ...result }];
const loadBody = (s: EditionSkill, extra: Record<string, unknown> = {}): Step => skillRead(s.name, { found: true, bytes: s.body.length, sourceScopeId: 'org:harness-eval', result: s.body, ...extra });
const exec = (command: string, result = 'ok', code = 0): Step => ['execute', { command, purpose: 'Checking' }, { code, result }];
const systemWith = (edition: EditionSkill[], extra = '') => '# This session\n' + extra + '\n## Skills\nIf the task matches a skill...\n- admin' + INDEX_DASH + 'Act for an org admin\n' + edition.map((s) => '- ' + s.name + INDEX_DASH + s.description).join('\n');
const evidence = (arm: 'plain' | 'edition' | 'forced', matched = INV, over: Partial<CleanEvidence> = {}): CleanEvidence => ({
  agent_skills: [], layer_paths: arm === 'plain' ? [] : layerBundle(EDITION).skills.map((f) => f.path),
  soul: arm === 'forced' ? byName(matched).body : 'You are a helpful internal assistant.',
  first_system: arm === 'plain' ? systemWith([]) : systemWith(EDITION, arm === 'forced' ? '## Organization instructions\n' + byName(matched).body : ''),
  ...over,
});
const count = (arm: 'plain' | 'edition' | 'forced', steps: Step[], matched = INV, over: Partial<CleanEvidence> = {}, approvals = 0) =>
  countTrial({ arm, matched, entries: session(steps), edition: EDITION, markers: MARKERS, approvalsAnswered: approvals, evidence: evidence(arm, matched, over) });

describe('s1e inputs: tasks and the edition', () => {
  const task = { id: 'inv-01', family: 'investigate', request: 'Something broke (test-only).', repo_dir: '/tmp/x/repo', first_step: { skill: 'investigate' } };
  test('tasks.json is the shared task record; a relative repo_dir, a duplicate id or an unknown family is refused', () => {
    expect(parseTasks([task])).toEqual([task as Task]);
    expect(() => parseTasks([{ ...task, repo_dir: 'repo' }])).toThrow(/absolute/);
    expect(() => parseTasks([task, task])).toThrow(/duplicate/);
    expect(() => parseTasks([{ ...task, family: 'ship' }])).toThrow(/family/);
    expect(() => parseTasks([{ ...task, first_step: { skill: 'careful' } }])).toThrow(/first_step/);
    expect(() => parseTasks([])).toThrow(/non-empty/);
  });

  test('the edition is copied the way its handoff installs it: only the listed gstack-* folders reach the deploy dir', () => {
    expect(EDITION.map((s) => [s.name, s.files.map((f) => f.path)])).toEqual([[INV, ['SKILL.md']], [REV, ['SKILL.md', 'scripts/diff-base.sh']], [PLAN, ['SKILL.md']]]);
    expect(readdirSync(join(DEPLOY, 'sandbox', 'skills')).sort()).toEqual([INV, PLAN, REV]);
    expect(existsSync(join(DEPLOY, 'sandbox', 'skills', 'README.md')) || existsSync(join(DEPLOY, 'sandbox', 'skills', 'edition.json'))).toBe(false);
    expect(EDITION.every((s) => s.body.includes('TEST-ONLY STUB') && !s.body.startsWith('---'))).toBe(true);
    expect(byName(INV).description).toBe('Test-only stub: find the cause of a failing test before any fix. (stub)');
  });

  test('the markers come from edition.json, and the dry run\'s first steps match them; plain\'s neutral command matches none', () => {
    const manifest = JSON.parse(readFileSync(join(TEST_FIXTURES, 'gstack', 'qm', 'edition.json'), 'utf8')) as { skills: Array<{ id: string; first_step_marker: string }> };
    expect(MARKERS).toEqual(Object.fromEntries(manifest.skills.map((s) => [s.id, { execute_regex: s.first_step_marker }])));
    for (const family of ['investigate', 'review', 'plan']) expect(new RegExp(MARKERS[skillFor(family)]!.execute_regex).test(DRY_RUN_FIRST_STEP[family]!)).toBe(true);
    expect(new RegExp(MARKERS[REV]!.execute_regex).test(DRY_RUN_FIRST_STEP['review-edition']!)).toBe(true);
    expect(Object.values(MARKERS).some((m) => new RegExp(m.execute_regex).test('cd /root/workspace/repo && git status --short'))).toBe(false);
  });

  test('the layer body is what qm up sends: contract 1, no tools, skills/<id>/<file> sorted by path, the executable bit kept', () => {
    const bundle = layerBundle(EDITION);
    expect(bundle).toMatchObject({ contract: 1, tools: [] });
    expect(bundle.skills.map((f) => f.path)).toEqual(['skills/gstack-investigate/SKILL.md', 'skills/gstack-plan/SKILL.md', 'skills/gstack-review/SKILL.md', 'skills/gstack-review/scripts/diff-base.sh']);
    expect(bundle.skills.some((f) => 'executable' in f)).toBe(false);
    const exe = layerBundle([{ ...byName(REV), files: byName(REV).files.map((f) => (f.path.endsWith('.sh') ? { ...f, executable: true as const } : f)) }]);
    expect(exe.skills.find((f) => f.path.endsWith('.sh'))).toMatchObject({ executable: true });
  });

  test('a manifest whose files differ from the folder, a missing marker, a stray file or a wrong name is refused', () => {
    const md = (name: string, desc = 'x') => '---\nname: ' + name + '\ndescription: ' + desc + '\n---\nBody line.\n';
    const m = (files: string[], marker = '\\bgit\\s+log\\b') => ({ skills: [{ id: PLAN, files, first_step_marker: marker }] });
    expect(editionFrom(m(['SKILL.md']), [{ path: PLAN + '/SKILL.md', content: md(PLAN) }]).markers).toEqual({ [PLAN]: { execute_regex: '\\bgit\\s+log\\b' } });
    expect(() => editionFrom(m(['SKILL.md', 'notes.md']), [{ path: PLAN + '/SKILL.md', content: md(PLAN) }])).toThrow(/edition.json lists/);
    expect(() => editionFrom(m(['SKILL.md'], ''), [{ path: PLAN + '/SKILL.md', content: md(PLAN) }])).toThrow(/first_step_marker/);
    expect(() => editionFrom(m(['SKILL.md']), [{ path: PLAN + '/SKILL.md', content: md(PLAN) }, { path: 'stray/SKILL.md', content: md('stray') }])).toThrow(/outside the listed skills/);
    expect(() => editionFrom(m(['SKILL.md']), [{ path: PLAN + '/SKILL.md', content: md('gstack-review') }])).toThrow(/frontmatter name/);
    expect(() => editionFrom(m(['SKILL.md']), [{ path: PLAN + '/SKILL.md', content: md(PLAN, '>') }])).toThrow(/description/);
    expect(splitFrontmatter(md(PLAN, '"Quoted: text (gstack)"'))).toEqual({ name: PLAN, description: 'Quoted: text (gstack)', body: 'Body line.\n' });
  });

  test('input problems: a task family without its gstack-<family> skill or marker, a file over QM\'s inline budget', () => {
    const tasks = DRY_RUN_TASKS.map((t) => ({ ...t, repo_dir: '/tmp/' + t.id }));
    expect(inputProblems(tasks, EDITION, MARKERS)).toEqual([]);
    expect(inputProblems(tasks, EDITION.filter((s) => s.name !== PLAN), MARKERS).join()).toMatch(/no edition skill named gstack-plan/);
    expect(inputProblems(tasks, EDITION, { [INV]: MARKERS[INV]! }).length).toBe(2);
    const big = { ...byName(PLAN), files: [{ path: 'SKILL.md', content: 'x'.repeat(17_000), sha256: 'x' }] };
    expect(inputProblems([], [big], MARKERS).join()).toMatch(/inline budget/);
  });
});

describe('s1e order, approvals and resume', () => {
  const tasks = DRY_RUN_TASKS.map((t) => ({ ...t, repo_dir: '/tmp/' + t.id }));
  test('every (task, arm, model, rep) once, in the same seeded order on every call, with the arms interleaved', () => {
    const a = trialPlan(tasks, ['plain', 'edition'], ['opus'], 3, 1514);
    expect(a.length).toBe(12);
    expect(new Set(a.map((t) => t.trial_id)).size).toBe(12);
    expect(trialPlan(tasks, ['plain', 'edition'], ['opus'], 3, 1514).map((t) => t.trial_id)).toEqual(a.map((t) => t.trial_id));
    expect(trialPlan(tasks, ['plain', 'edition'], ['opus'], 3, 7).map((t) => t.trial_id)).not.toEqual(a.map((t) => t.trial_id));
    const firstHalf = a.slice(0, 6).map((t) => t.arm);
    expect(firstHalf).toContain('plain');
    expect(firstHalf).toContain('edition');
    expect(a[0]!.trial_id).toMatch(/^dry-(rev|plan)-01-(plain|edition)-opus-k[123]$/);
  });

  test('each pending command is approved once; a repeat, an empty list or the sixth approval stops the trial', () => {
    const pending = (ids: string[]) => ({ status: 'pending_approval', sessionId: 's', pendingApprovals: ids.map((requestId) => ({ requestId, command: 'rm -rf /tmp/x', reason: 'recursive delete' })) });
    expect(nextApproval({ status: 'ok', reply: 'done' }, new Set())).toBe(null);
    expect(nextApproval(pending(['a']), new Set())).toEqual({ requestId: 'a', command: 'rm -rf /tmp/x' });
    expect(nextApproval(pending(['a', 'b']), new Set(['a']))).toEqual({ requestId: 'b', command: 'rm -rf /tmp/x' });
    expect(nextApproval(pending(['a']), new Set(['a']))).toEqual({ stop: 'repeat' });
    expect(nextApproval({ status: 'pending_approval' }, new Set())).toEqual({ stop: 'no_request' });
    expect(nextApproval(pending(['f']), new Set(['a', 'b', 'c', 'd', 'e']))).toEqual({ stop: 'over_cap' });
  });

  test('a restart skips recorded trials; --repair runs the next attempt', () => {
    const plan = trialPlan(tasks, ['plain'], ['opus'], 1, 1);
    const ids = plan.map((t) => t.trial_id);
    expect(nextAttempts(plan, [ids[0]!], false).map((x) => [x.trial.trial_id, x.attempt])).toEqual(ids.slice(1).map((id) => [id, 1]));
    expect(nextAttempts([plan[0]!], [ids[0]!, ids[0] + '-r2'], true).map((x) => x.attempt)).toEqual([3]);
  });
});

describe('s1e counters against stored S1 sessions (QM b6786d67)', () => {
  const dirs = readdirSync(S1_TURNS).filter((d) => !d.includes('fault')).sort();
  const load = (d: string) => ({ entries: (JSON.parse(readFileSync(join(S1_TURNS, d, 'session.json'), 'utf8')) as { entries: Entry[] }).entries, llm: JSON.parse(readFileSync(join(S1_TURNS, d, 'llm-turn0.json'), 'utf8')) as { requests: Array<{ step?: number; promptEnvelope: unknown }> } });
  const first = (llm: { requests: Array<{ step?: number; promptEnvelope: unknown }> }) => systemOf(llm.requests.slice().sort((a, b) => (a.step ?? 0) - (b.step ?? 0))[0]?.promptEnvelope);

  test('no S1 turn opens an edition skill, and as a plain trial every one is clean; seed skill reads are listed apart', () => {
    expect(dirs.length).toBe(60);
    let seedReads = 0;
    for (const d of dirs) {
      const { entries, llm } = load(d);
      const r = countTrial({ arm: 'plain', matched: INV, entries, edition: EDITION, markers: MARKERS, approvalsAnswered: 0, evidence: { agent_skills: [], layer_paths: [], soul: 'default', first_system: first(llm) } });
      expect([d, r.counts.open_any, r.counts.complete_read, r.counts.contaminated]).toEqual([d, false, false, false]);
      seedReads += r.detail.other_skill_reads.length;
    }
    expect(seedReads).toBe(15);
  });

  test('a real stored skill call counts as an open and a whole read when the skill is in the edition', () => {
    const { entries } = load('s1-r1-k1-sol-no-gstack');
    const calls = toolCalls(entries);
    const read = calls.find((c) => c.tool === 'skills')!;
    const text = String(read.result!.result);
    const body = text.slice(text.indexOf('\n\n') + 2);
    const skill: EditionSkill = { name: 'github-gitlab', description: 'Act on GitHub or GitLab', body, files: [{ path: 'SKILL.md', content: body, sha256: 'x' }, { path: 'scripts/watch-ci.mjs', content: '', sha256: 'y' }] };
    expect(editionOpens(calls, new Set(['github-gitlab']))).toEqual([{ seq: read.seq, skill: 'github-gitlab', via: 'skill' }]);
    expect(editionCompleteRead(calls, skill, null)).toBe('inline');
    expect(editionCompleteRead(calls, { ...skill, body: body + '\nA line QM never sent back to the model.\n' }, null)).toBe(null);
    const r = countTrial({ arm: 'edition', matched: 'github-gitlab', entries, edition: [skill], markers: { 'github-gitlab': { execute_regex: 'gh ' } }, approvalsAnswered: 0, evidence: { agent_skills: [], layer_paths: null, soul: null, first_system: null } });
    expect([r.counts.open_matched, r.detail.read_whole]).toEqual([true, true]);
    expect(String(read.result!.dir)).toMatch(/^\/root\/workspace\/\.agent-skills\/[0-9a-f]{24}\/[0-9a-f]{16}\/github-gitlab$/);
  });

  test('the stored first prompts carry QM\'s skills index, which indexHas reads', () => {
    const sys = first(load('s1-r1-k1-opus-no-gstack').llm)!;
    expect(indexHas(sys, 'admin')).toBe(true);
    expect(EDITION.some((s) => indexHas(sys, s.name))).toBe(false);
  });
});

describe('s1e counters: opens, whole reads, the path rewrite and first steps', () => {
  const inv = byName(INV), rev = byName(REV);
  test('an open is a skill call QM answered with the body; another edition skill is open_any only; a miss, an asset or a refusal is none', () => {
    expect(count('edition', [loadBody(inv)]).counts).toMatchObject({ open_matched: true, open_any: true, complete_read: true });
    expect(count('edition', [loadBody(rev)]).counts).toMatchObject({ open_matched: false, open_any: true });
    expect(count('edition', [skillRead(INV, { found: false, result: '[no such skill file: gstack-investigate/SKILL.md]' })]).counts.open_any).toBe(false);
    expect(count('edition', [['skills', { action: 'read', name: REV, path: 'scripts/diff-base.sh' }, { name: REV, action: 'read', found: true, result: 'x' }]], REV).counts.open_any).toBe(false);
    expect(count('edition', [['skills', { action: 'read', name: INV }, { result: 'Validation failed for tool "skills"' }]]).counts.open_any).toBe(false);
  });

  test('a files read or a cat of the synced SKILL.md is kept in the detail and counts toward a complete read, but is not an open', () => {
    const p = SYNC + '/gstack-investigate/SKILL.md';
    const viaFiles = count('edition', [['files', { action: 'read', path: p }, { path: p, action: 'read', found: true, bytes: inv.body.length, result: inv.body }]]);
    expect([viaFiles.counts.open_matched, viaFiles.counts.complete_read, viaFiles.detail.read_whole, viaFiles.detail.opens[0]?.via]).toEqual([false, true, false, 'files']);
    expect(count('edition', [exec('cat ' + p, inv.body)]).detail.opens[0]).toMatchObject({ via: 'execute' });
    expect(count('edition', [exec('grep -n step ' + p)]).detail.opens).toEqual([]);
    expect(count('edition', [exec('cat ' + SKILL_ROOT + '/investigate/SKILL.md', inv.body)]).detail.opens).toEqual([]);
  });

  test('read_whole needs one uncut skill answer with no park marker; a cut answer completed from the parked copy is complete but not whole', () => {
    const lines = inv.body.split('\n');
    const marker = '…[output cut: showing the first 100 and last 100 of ' + inv.body.length + ' chars. The full output is in tool-output/md5/abc123; reading it with the files tool copies it onto the computer (kept 30 days)]…';
    const cut = loadBody(inv, { output: { chars: inv.body.length, shownChars: 200 }, result: lines.slice(0, 3).join('\n') + '\n' + marker + '\n' + lines.slice(-2).join('\n') });
    const parked: Step = ['files', { action: 'read', path: 'tool-output/md5/abc123' }, { path: 'tool-output/md5/abc123', action: 'read', found: true, bytes: 10, result: 'copied' }];
    const done = count('edition', [cut, parked, exec('sed -n 1,200p /root/workspace/tool-output/abc123.txt', lines.join('\n'))]);
    expect([done.detail.complete_via, done.detail.read_whole]).toEqual(['cut', false]);
    expect(count('edition', [cut]).counts.complete_read).toBe(false);
    expect(count('edition', [loadBody(inv)]).detail.read_whole).toBe(true);
  });

  test('the path rewrite: rewritten when the answer names the synced folder and no skills/gstack-review/ is left', () => {
    const dir = SYNC + '/gstack-review';
    const rewritten = rev.body.split('skills/gstack-review/').join(dir + '/');
    const ok = count('edition', [loadBody(rev, { result: '[skill files synced to ' + dir + '/]\n\n' + rewritten, dir })], REV, { agent_skills: [dir + '/SKILL.md', dir + '/scripts/diff-base.sh'] });
    expect(ok.detail.path_rewrite).toEqual({ expected: true, dir, rewritten: true });
    expect([ok.detail.complete_via, ok.detail.read_whole]).toEqual(['inline', true]);
    expect(count('edition', [loadBody(rev, { dir })], REV).detail.path_rewrite).toEqual({ expected: true, dir, rewritten: false });
    expect(count('edition', [loadBody(rev)], REV).detail.path_rewrite.rewritten).toBe(false);
    expect(pathRewrite(toolCalls(session([loadBody(inv)])), inv)).toEqual({ expected: false, dir: null, rewritten: null });
    expect(pathRewrite([], rev)).toEqual({ expected: true, dir: null, rewritten: null });
  });

  test('first_step: an executed command matching the edition marker after the open; from the start when the body is in the prompt', () => {
    const step = exec(DRY_RUN_FIRST_STEP.investigate!, 'abc123 commit');
    expect(count('edition', [loadBody(inv), step]).counts.first_step).toBe(true);
    const before = count('edition', [step, loadBody(inv)]);
    expect([before.counts.first_step, before.detail.first_step_anywhere]).toEqual([false, true]);
    const forced = count('forced', [step]);
    expect([forced.counts.open_matched, forced.counts.complete_read, forced.detail.complete_via, forced.counts.first_step]).toEqual([false, true, 'soul', true]);
    const plain = count('plain', [step]);
    expect([plain.counts.first_step, plain.detail.first_step_anywhere]).toEqual([false, true]);
    expect(count('edition', [loadBody(rev), exec('cd repo && sh ' + SYNC + '/gstack-review/scripts/diff-base.sh main', 'MERGE_BASE: abc')], REV).detail.first_step_runs).toEqual([{ seq: 3, command: 'cd repo && sh ' + SYNC + '/gstack-review/scripts/diff-base.sh main', code: 0, output: 'MERGE_BASE: abc' }]);
    expect(count('edition', [loadBody(inv), ['execute', { command: DRY_RUN_FIRST_STEP.investigate }, { result: 'Validation failed for tool "execute"' }]]).counts.first_step).toBe(false);
  });

  test('first_step counts only after the whole body reached the model: not after a cut load alone, yes after a whole files read', () => {
    const step = exec(DRY_RUN_FIRST_STEP.investigate!, 'abc123 commit');
    const lines = inv.body.split('\n');
    const marker = '…[output cut: showing the first 100 and last 100 of ' + inv.body.length + ' chars. The full output is in tool-output/md5/abc123; reading it with the files tool copies it onto the computer (kept 30 days)]…';
    const cut = loadBody(inv, { output: { chars: inv.body.length, shownChars: 200 }, result: lines.slice(0, 3).join('\n') + '\n' + marker + '\n' + lines.slice(-2).join('\n') });
    const parked: Step = ['files', { action: 'read', path: 'tool-output/md5/abc123' }, { path: 'tool-output/md5/abc123', action: 'read', found: true, bytes: 10, result: 'copied' }];
    const rest = exec('sed -n 1,200p /root/workspace/tool-output/abc123.txt', lines.join('\n'));
    const early = count('edition', [cut, step, parked, rest]);
    expect([early.counts.complete_read, early.counts.first_step, early.detail.first_step_anywhere]).toEqual([true, false, true]);
    expect(count('edition', [cut, parked, rest, step]).counts.first_step).toBe(true);
    expect(count('edition', [cut, step]).counts.first_step).toBe(false);
    const p = SYNC + '/gstack-investigate/SKILL.md';
    const viaFiles = count('edition', [['files', { action: 'read', path: p }, { path: p, action: 'read', found: true, bytes: inv.body.length, result: inv.body }], step]);
    expect([viaFiles.counts.open_matched, viaFiles.counts.complete_read, viaFiles.counts.first_step]).toEqual([false, true, true]);
  });

  test('approvals answered pass through to the counts', () => {
    expect(count('plain', [exec(APPROVAL_PROBE)], INV, {}, 1).counts.approvals_answered).toBe(1);
  });
});

describe('s1e clean-arm check', () => {
  test('a clean trial in each arm is not contaminated', () => {
    for (const arm of ARMS) expect([arm, count(arm, []).detail.clean.problems]).toEqual([arm, []]);
  });

  test('plain: an index line, a layer skill, a body in the SOUL, a synced file or an edition body in a tool answer contaminates it', () => {
    expect(count('plain', [], INV, { first_system: systemWith([byName(PLAN)]) }).detail.clean.problems).toEqual(['first prompt lists gstack-plan']);
    expect(count('plain', [], INV, { layer_paths: ['skills/gstack-plan/SKILL.md'] }).counts.contaminated).toBe(true);
    expect(count('plain', [], INV, { soul: byName(REV).body }).counts.contaminated).toBe(true);
    expect(count('plain', [], INV, { agent_skills: [SYNC + '/gstack-review/scripts/diff-base.sh'] }).counts.contaminated).toBe(true);
    expect(count('plain', [], INV, { agent_skills: [SYNC + '/github-gitlab/SKILL.md'] }).counts.contaminated).toBe(false);
    expect(count('plain', [exec('cat /tmp/notes', byName(PLAN).body)]).counts.contaminated).toBe(true);
  });

  test('evidence that could not be read is a problem in every arm', () => {
    for (const arm of ARMS) expect(count(arm, [], INV, { agent_skills: null }).detail.clean.problems).toContain('unverified: agent_skills unread');
  });

  test('edition and forced: a missing or shortened index line, a missing layer file, a wrong SOUL, or a loaded skill with files that never synced', () => {
    expect(count('edition', [], INV, { first_system: systemWith(EDITION.slice(1)) }).detail.clean.problems).toEqual(['first prompt does not list gstack-investigate']);
    const short = systemWith(EDITION).replace(byName(PLAN).description, byName(PLAN).description.slice(0, 20) + '…');
    expect(indexIntact(short, byName(PLAN))).toBe(false);
    expect(count('edition', [], INV, { first_system: short }).detail.clean.problems).toEqual(['first prompt shortens the gstack-plan description']);
    expect(count('edition', [], INV, { layer_paths: [] }).counts.contaminated).toBe(true);
    expect(count('edition', [], INV, { soul: byName(INV).body }).counts.contaminated).toBe(true);
    expect(count('forced', [], INV, { soul: 'You are helpful' }).detail.clean.problems).toEqual(['org SOUL is not the gstack-investigate body']);
    expect(count('forced', [], INV, { first_system: systemWith(EDITION) }).detail.clean.problems).toEqual(['first prompt does not hold the gstack-investigate body']);
    expect(count('edition', [loadBody(byName(REV))], REV).detail.clean.problems).toEqual(['gstack-review was loaded but nothing was synced to .agent-skills']);
    expect(count('edition', [loadBody(byName(REV))], REV, { agent_skills: [SYNC + '/gstack-review/SKILL.md', SYNC + '/gstack-review/scripts/diff-base.sh'] }).counts.contaminated).toBe(false);
    expect(count('edition', [loadBody(byName(PLAN))], PLAN).counts.contaminated).toBe(false);
    expect(cleanArm('edition', EDITION, 'gstack-ship', evidence('edition'), []).problems).toEqual(['no edition skill named gstack-ship']);
  });
});

describe('s1e leases: each stage fits its cap across its shards', () => {
  test('a paid run names its stage and shards, and the shards together stay inside the stage cap', () => {
    expect(leaseProblem(true, undefined, NaN, 20)).toBeNull();
    expect(leaseProblem(true, undefined, NaN, 21)).toContain('dry run');
    expect(leaseProblem(false, undefined, 1, 10)).toContain('--stage');
    expect(leaseProblem(false, 'main', NaN, 10)).toContain('--shards');
    expect(leaseProblem(false, 'main', 8, 65)).toBeNull();
    expect(leaseProblem(false, 'main', 8, 520)).toContain('above the main cap of $520');
    expect(leaseProblem(false, 'pilot', 1, 10)).toBeNull();
    expect(leaseProblem(false, 'pilot', 1, 11)).toContain('$10');
    expect(leaseProblem(false, 'headroom', 8, 5.625)).toBeNull();
    expect(leaseProblem(false, 'forced', 8, 6)).toContain('$45');
    expect(leaseProblem(false, 'main', 1, 0)).toContain('above 0');
  });
});

describe('s1e trial status and summary', () => {
  const ok = { http: 200, body: { status: 'ok', reply: 'done' } };
  test('statuses: ok, infra_error, model_error on a cap stop or a provider failure, context_length, timeout, turn_error', () => {
    expect(trialStatus({ capStop: false, turn: ok, lines: [] })).toEqual({ status: 'ok', reason: null });
    expect(trialStatus({ capStop: true, turn: ok, lines: [] }).status).toBe('model_error');
    expect(trialStatus({ capStop: false, stackError: 'compose up failed', turn: null, lines: [] }).status).toBe('infra_error');
    expect(trialStatus({ capStop: false, evidenceError: 'GET session answered 500', turn: ok, lines: [] })).toEqual({ status: 'ok', reason: 'evidence read-back failed: GET session answered 500' });
    expect(trialStatus({ capStop: false, turn: { http: 0, body: 'The operation was aborted due to timeout' }, lines: [] }).status).toBe('timeout');
    expect(trialStatus({ capStop: false, turn: { http: 0, body: 'ECONNREFUSED' }, lines: [] }).status).toBe('infra_error');
    expect(trialStatus({ capStop: false, approvalStop: 'pending approval left unanswered: over_cap', turn: { http: 200, body: { status: 'pending_approval' } }, lines: [] }).status).toBe('turn_error');
    expect(trialStatus({ capStop: false, turn: { http: 200, body: { status: 'failed', reason: 'prompt is too long: 210000 tokens' } }, lines: [] }).status).toBe('context_length');
    expect(trialStatus({ capStop: false, turn: { http: 200, body: { status: 'failed', reason: 'turn wall clock exceeded' } }, lines: [] }).status).toBe('timeout');
    expect(trialStatus({ capStop: false, turn: { http: 200, body: { status: 'failed', reason: 'upstream' } }, lines: [{ outcome: 'forwarded', status: 529 }] }).status).toBe('model_error');
    expect(trialStatus({ capStop: false, turn: { http: 403, body: { status: 'refused', reason: 'nope' } }, lines: [{ outcome: 'forwarded', status: 200 }] }).status).toBe('turn_error');
    expect(trialStatus({ capStop: false, turn: { http: 200, body: { status: 'failed', reason: 'tool loop' } }, lines: [{ outcome: 'forwarded', status: 429 }, { outcome: 'forwarded', status: 200 }] }).status).toBe('turn_error');
  });

  test('the summary counts ok trials per model and arm and names the rest and the contaminated', () => {
    const counts = { open_matched: true, open_any: true, complete_read: true, first_step: false, approvals_answered: 1, contaminated: false };
    const rec = (id: string, arm: 'plain' | 'edition', status: TurnRecord['status'], c = counts): TurnRecord => ({ trial_id: id, task_id: 't', family: 'investigate', arm, model: 'anthropic:claude-opus-5-5', rep: 1, status, reply_text: '', counts: c, usage: null, wall_s: 2 });
    const s = summarize([rec('a', 'edition', 'ok'), rec('b', 'edition', 'timeout'), rec('c', 'plain', 'ok', { ...counts, open_matched: false, contaminated: true })]) as Record<string, Record<string, unknown>>;
    expect(s['anthropic:claude-opus-5-5/edition']).toMatchObject({ trials: 2, ok: 1, open_matched: 1, approvals_answered: 2, not_ok: [{ trial_id: 'b', status: 'timeout' }], wall_s: 4 });
    expect(s['anthropic:claude-opus-5-5/plain']).toMatchObject({ open_matched: 0, contaminated: ['c'] });
  });
});

describe('s1e driver pieces', () => {
  test('the dry-run model calls the gstack-<family> skill only in edition, runs the synced script in edition review, and asks one approval in every arm', () => {
    const t = { first_step: { skill: 'review' as const } };
    expect(dryRunScript('edition', t)[0]).toEqual({ call: 'skills', arguments: { action: 'read', name: REV }, match: { system_contains: '\n- ' + REV + INDEX_DASH } });
    expect(dryRunScript('edition', t, 'openai')[0]).toEqual({ call: 'skills', arguments: { action: 'read', name: REV } });
    expect(JSON.stringify(dryRunScript('edition', t))).toContain('.agent-skills/*/*/gstack-review/scripts/diff-base.sh');
    for (const arm of ARMS) expect(JSON.stringify(dryRunScript(arm, t))).toContain(APPROVAL_PROBE);
    expect(JSON.stringify(dryRunScript('plain', t))).not.toMatch(/skills|gstack|git diff/);
    expect(JSON.stringify(dryRunScript('forced', t))).not.toMatch(/"skills"|agent-skills/);
  });

  test('image check: a gstack path, an edition file\'s sha256, ~/.claude/skills or a baked .agent-skills is a problem', () => {
    const sha = byName(PLAN).files[0]!.sha256;
    expect(imageProblems('c'.repeat(64) + ' /app/skills-seed/admin/SKILL.md\n' + 'd'.repeat(64) + ' /root/workspace/repo/README.md', EDITION)).toEqual([]);
    expect(imageProblems(sha + ' /root/notes.md', EDITION)).toEqual(['edition file /root/notes.md']);
    expect(imageProblems('e'.repeat(64) + ' /opt/gstack/bin/x\npresent /root/.claude/skills', EDITION).length).toBe(2);
  });
});
