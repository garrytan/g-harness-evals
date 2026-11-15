// internal-task: scripts/gstack-delivery/probes.ts on synthetic capture fixtures only (never a real trial's capture), in the three
// wire formats, with near misses for every marker, the delivery check (d12) and every unparsed code (d13).
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSelection } from '../scripts/gstack-delivery/extract-cards.ts';
import { covers, execNestedCalls, inRepo, markerLines, MARKERS, probeTrial, shellActions, type Arm, type Kind, type ProbeScored, type ProbeUnparsed, type ProbeResult, UNPARSED_CODES } from '../scripts/gstack-delivery/probes.ts';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'gstack-probes-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const SEL = loadSelection();
const CARD = { review: readFileSync(join(ROOT, 'harnesses/routes/gstack-cards/review.md'), 'utf8'), ship: readFileSync(join(ROOT, 'harnesses/routes/gstack-cards/ship.md'), 'utf8') };
const TOOLS = [{ name: 'x' }];

const chain = (l: string) => createHash('sha256').update(l, 'utf8').digest('hex').slice(0, 16);
type Entry = { route: string; body: unknown } | { truncated: true };
function captureText(entries: Entry[]): string {
  let prev = '';
  return entries.map((e, seq) => { const line = JSON.stringify('truncated' in e ? { seq, prev, truncated: true } : { seq, prev, route: e.route, body: e.body }); prev = chain(line); return line; }).join('\n') + '\n';
}
let n = 0;
function file(text: string): string { const p = join(tmp, 'c' + ++n + '.ndjson'); writeFileSync(p, text); return p; }

type Step = { name: string; input: Record<string, unknown>; error?: string };
const bash = (command: string): Step => ({ name: 'Bash', input: { command } });
/** Anthropic Messages: request k carries the task, k tool calls and their results. hook: the card leads every user message. */
function anthropic(steps: Step[], o: { system?: string; hook?: string; housekeeping?: boolean } = {}): Entry[] {
  const user = (t: string) => ({ role: 'user', content: o.hook ? [{ type: 'text', text: o.hook }, { type: 'text', text: t }] : t });
  const out: Entry[] = o.housekeeping ? [{ route: '/v1/messages', body: { model: 'm', messages: [{ role: 'user', content: 'title please' }] } }] : [];
  for (let k = 0; k <= steps.length; k++) {
    const messages: unknown[] = [user('Review the change.')];
    steps.slice(0, k).forEach((s, i) => {
      messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_' + i, name: s.name, input: s.input }] });
      messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_' + i, content: s.error ?? 'ok', ...(s.error ? { is_error: true } : {}) }, ...(o.hook ? [{ type: 'text', text: o.hook }] : [])] });
    });
    out.push({ route: '/v1/messages', body: { model: 'm', system: o.system ?? 'You are an agent.', tools: TOOLS, messages } });
  }
  return out;
}
/** OpenAI Responses, Codex-style shell calls. */
function responses(cmds: string[], o: { developer?: string } = {}): Entry[] {
  const out: Entry[] = [];
  for (let k = 0; k <= cmds.length; k++) {
    const input: unknown[] = [...(o.developer ? [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: o.developer }] }] : []), { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Ship it.' }] }];
    cmds.slice(0, k).forEach((c, i) => {
      input.push({ type: 'function_call', call_id: 'call_' + i, name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', c], workdir: '/work/repo' }) });
      input.push({ type: 'function_call_output', call_id: 'call_' + i, output: 'ok' });
    });
    out.push({ route: '/v1/responses', body: { model: 'm', instructions: 'x', tools: TOOLS, input } });
  }
  return out;
}
/** OpenAI Responses as Codex 0.165 sends it: no body.tools (the tools are in an additional_tools input item) and the shell
 *  and patch tools called from the JavaScript of the code-mode exec tool. */
function codexExec(sources: string[], o: { developer?: string; housekeeping?: boolean } = {}): Entry[] {
  const declared = { type: 'additional_tools', role: 'developer', tools: [{ type: 'namespace', name: 'functions', tools: [{ type: 'custom', name: 'exec' }, { type: 'function', name: 'wait' }] }] };
  const user = { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Review the change.' }] };
  const out: Entry[] = o.housekeeping ? [{ route: '/v1/responses', body: { model: 'm', instructions: 'Name this session.', input: [user] } }] : [];
  for (let k = 0; k <= sources.length; k++) {
    const input: unknown[] = [declared, ...(o.developer ? [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: o.developer }] }] : []), user];
    sources.slice(0, k).forEach((src, i) => {
      input.push({ type: 'custom_tool_call', id: 'ctc_' + i, call_id: 'call_' + i, name: 'exec', input: src });
      input.push({ type: 'custom_tool_call_output', call_id: 'call_' + i, output: 'ok' });
    });
    out.push({ route: '/v1/responses', body: { model: 'm', instructions: 'x', input } });
  }
  return out;
}
/** OpenAI Chat Completions, Hermes-style terminal calls; ids optional to test position keys. */
function chat(cmds: string[], o: { ids?: boolean; system?: string } = {}): Entry[] {
  const out: Entry[] = [];
  for (let k = 0; k <= cmds.length; k++) {
    const messages: unknown[] = [{ role: 'system', content: o.system ?? 'sys' }, { role: 'user', content: 'Ship it.' }];
    cmds.slice(0, k).forEach((c, i) => {
      messages.push({ role: 'assistant', content: null, tool_calls: [{ ...(o.ids === false ? {} : { id: 'c' + i }), type: 'function', function: { name: 'terminal', arguments: JSON.stringify({ command: c }) } }] });
      messages.push({ role: 'tool', ...(o.ids === false ? {} : { tool_call_id: 'c' + i }), content: 'ok' });
    });
    out.push({ route: '/v1/chat/completions', body: { model: 'm', tools: TOOLS, messages } });
  }
  return out;
}
function probe(entries: Entry[] | string, kind: Kind, o: { arm?: Arm; termination?: string; responses?: string; metered?: number; expected?: string } = {}): ProbeResult {
  const arm = o.arm ?? 'none';
  const expected = o.expected ?? (arm === 'hook' || arm === 'startup' ? CARD[kind] : null);
  return probeTrial({ trial_id: 't' + n, kind, arm, capture: file(typeof entries === 'string' ? entries : captureText(entries)), termination: o.termination ?? 'completed', responses: o.responses ?? null, requests_metered: o.metered ?? null, expected }, SEL);
}
const scored = (r: ProbeResult) => { if (r.status !== 'scored') throw new Error('unparsed: ' + r.code + ' ' + r.detail); return r as ProbeScored; };
const states = (r: ProbeResult) => Object.fromEntries(Object.entries(scored(r).markers).map(([k, v]) => [k, v.state]));

const T = '/work/out/tests/test_limit.py';
const REVIEW_JSON = JSON.stringify([{ file: 'schedule/__init__.py', line: 10, summary: 'x', test: T }]);
const writeTest = (path = T): Step => ({ name: 'Write', input: { file_path: path, content: 'def test_x(): pass\n' } });
const writeReview = (content = REVIEW_JSON): Step => ({ name: 'Write', input: { file_path: '/work/out/review.json', content } });

describe('markers map one to one onto card lines (d5)', () => {
  test('every marker sits on exactly one card line, and no demanded line carries one', () => {
    const lines = markerLines(SEL);
    expect(Object.keys(lines).sort()).toEqual(Object.keys(MARKERS).sort());
    for (const spec of Object.values(SEL.cards)) for (const l of spec.lines) if (l.marker) expect(l.task_demands).toBeNull();
    expect(lines['review.full_diff_first']).toBe('review.full_diff');
    expect(lines['ship.fresh_verification']).toBe('ship.iron_law');
    expect(lines['ship.tests_after_merge']).toBeUndefined();
  });
});

describe('review markers, Anthropic Messages', () => {
  const good = [bash('cd /work/repo && git diff main...feature/change-1'), bash("python3 -c 'import schedule; print(schedule.every)'"), writeTest(), bash('cd /work/repo && python -m pytest ' + T + ' -q'), writeReview()];
  test('a session that does every step meets every marker', () => {
    const r = scored(probe(anthropic(good), 'review'));
    expect(states(r)).toEqual({ 'review.full_diff_first': 'met', 'review.check_before_finding': 'met', 'review.test_per_finding': 'met' });
    expect(r.compliance).toEqual({ met: 3, applicable: 3, share: 1, followed: true });
    expect(r).toMatchObject({ wire: 'anthropic-messages', session_end: 'assumed_text', last_action: 'observed', tool_calls: 5, gstack_reads: 0, delivery: null });
  });
  test('near misses: a stat-only diff, a diff limited to one file, a diff piped to head, a diff after the first finding', () => {
    for (const d of ['git diff --stat main...HEAD', 'git diff main...HEAD -- schedule/__init__.py', 'git diff main...HEAD | head -40', 'git diff', 'git diff HEAD', 'git show HEAD']) {
      expect(states(probe(anthropic([bash(d), ...good.slice(1)]), 'review'))['review.full_diff_first']).toBe('not_met');
    }
    expect(states(probe(anthropic([...good.slice(1), bash('git diff main...HEAD')]), 'review'))['review.full_diff_first']).toBe('not_met');
    expect(states(probe(anthropic([bash('git --no-pager log -p main..HEAD'), ...good.slice(1)]), 'review'))['review.full_diff_first']).toBe('met');
    expect(states(probe(anthropic([bash('DIFF_BASE=$(git merge-base main HEAD) && git diff "$DIFF_BASE"'), ...good.slice(1)]), 'review'))['review.full_diff_first']).toBe('met');
  });
  test('a diff written to a file counts when the file is read in full, not when only its head is read', () => {
    const viaFile = (read: Step) => states(probe(anthropic([bash('git diff main...HEAD > /tmp/d.patch'), read, ...good.slice(1)]), 'review'))['review.full_diff_first'];
    expect(viaFile({ name: 'Read', input: { file_path: '/tmp/d.patch' } })).toBe('met');
    expect(viaFile({ name: 'Read', input: { file_path: '/tmp/d.patch', limit: 50 } })).toBe('not_met');
    expect(viaFile(bash('head -50 /tmp/d.patch'))).toBe('not_met');
  });
  test('near misses for the test step: a test run before its file was rewritten, a repository-suite run, a run after review.json, a test never written, a test proved only after its finding was written up', () => {
    const rewritten = [good[0]!, good[1]!, writeTest(), bash('python -m pytest ' + T), { name: 'Edit', input: { file_path: T, old_string: 'pass', new_string: 'assert 0' } }, writeReview()];
    expect(states(probe(anthropic(rewritten), 'review'))['review.test_per_finding']).toBe('not_met');
    const repoSuite = [good[0]!, good[1]!, writeTest(), bash('cd /work/repo && pytest -q'), writeReview()];
    expect(states(probe(anthropic(repoSuite), 'review'))['review.test_per_finding']).toBe('not_met');
    const late = [good[0]!, good[1]!, writeTest(), writeReview(), bash('python -m pytest ' + T)];
    expect(states(probe(anthropic(late), 'review'))['review.test_per_finding']).toBe('not_met');
    const dir = [good[0]!, good[1]!, writeTest(), bash('cd /work/out/tests && python -m pytest'), writeReview()];
    expect(states(probe(anthropic(dir), 'review'))['review.test_per_finding']).toBe('met');
    const unwritten = [good[0]!, good[1]!, bash('python -m pytest ' + T), writeReview()];
    expect(states(probe(anthropic(unwritten), 'review'))['review.test_per_finding']).toBe('not_met');
    const writtenUpFirst = [good[0]!, good[1]!, writeReview(), writeTest(), bash('python -m pytest ' + T), writeReview()];
    expect(states(probe(anthropic(writtenUpFirst), 'review'))['review.test_per_finding']).toBe('not_met');
    const U = '/work/out/tests/test_until.py';
    const both = JSON.stringify([{ file: 'schedule/__init__.py', line: 10, summary: 'x', test: T }, { file: 'schedule/__init__.py', line: 40, summary: 'y', test: U }]);
    const second = [good[0]!, good[1]!, writeTest(), bash('python -m pytest ' + T), writeReview(), writeTest(U), bash('python -m pytest ' + U), writeReview(both)];
    expect(states(probe(anthropic(second), 'review'))['review.test_per_finding']).toBe('met');
  });
  test('the check step: only the findings\' own tests is a near miss; a test of a dropped suspicion counts', () => {
    const own = [good[0]!, writeTest(), bash('python -m pytest ' + T), writeReview()];
    expect(states(probe(anthropic(own), 'review'))['review.check_before_finding']).toBe('not_met');
    const dropped = [good[0]!, writeTest('/work/out/tests/test_decoy.py'), bash('python -m pytest /work/out/tests/test_decoy.py'), writeTest(), bash('python -m pytest ' + T), writeReview()];
    expect(states(probe(anthropic(dropped), 'review'))['review.check_before_finding']).toBe('met');
    const writer = [good[0]!, writeTest(), bash('python -m pytest ' + T), bash("python3 -c 'import json; json.dump([], open(\"/work/out/review.json\",\"w\"))'"), writeReview()];
    expect(states(probe(anthropic(writer), 'review'))['review.check_before_finding']).toBe('not_met');
  });
  test('an empty review.json makes the test step n/a; an unreadable one with no test writes is unscorable, never 0', () => {
    const empty = scored(probe(anthropic([good[0]!, good[1]!, writeReview('[]')]), 'review'));
    expect(empty.markers['review.test_per_finding']!.state).toBe('n/a');
    expect(empty.compliance).toEqual({ met: 2, applicable: 2, share: 1, followed: true });
    const script = scored(probe(anthropic([good[0]!, good[1]!, bash("python3 - <<'PY'\nimport json\njson.dump(rows, open('/work/out/review.json', 'w'))\nPY")]), 'review'));
    expect(script.markers['review.test_per_finding']!.state).toBe('unscorable');
    expect(script.compliance.share).toBeNull();
    expect(script.compliance.followed).toBeNull();
  });
  test('review.json written by a heredoc is read for its findings', () => {
    const heredoc = bash("cat > /work/out/review.json <<'EOF'\n" + REVIEW_JSON + "\nEOF");
    expect(states(probe(anthropic([...good.slice(0, 4), heredoc]), 'review'))['review.test_per_finding']).toBe('met');
  });
  test('a session cut off before review.json: what one more action could meet is unobservable, the rest stays not met (d13)', () => {
    const cut = scored(probe(anthropic(good.slice(0, 4)), 'review', { termination: 'timeout' }));
    expect(cut.last_action).toBe('unobservable');
    expect(states(cut)).toEqual({ 'review.full_diff_first': 'unobservable', 'review.check_before_finding': 'unobservable', 'review.test_per_finding': 'unobservable' });
    const noDiff = scored(probe(anthropic(good.slice(1, 4)), 'review', { termination: 'timeout' }));
    expect(noDiff.markers['review.full_diff_first']!.state).toBe('not_met');
    expect(noDiff.compliance.followed).toBe(false);
    const completed = scored(probe(anthropic(good.slice(0, 4)), 'review', { termination: 'completed' }));
    expect(completed.markers['review.full_diff_first']!.state).toBe('not_met');
  });
  test('a response capture shows the final tool call, so the last action is observed', () => {
    const resp = file(JSON.stringify({ seq: 0, route: '/v1/messages', body: { content: [{ type: 'tool_use', id: 'toolu_last', name: 'Write', input: { file_path: '/work/out/review.json', content: REVIEW_JSON } }] } }) + '\n');
    const r = scored(probe(anthropic(good.slice(0, 4)), 'review', { termination: 'timeout', responses: resp }));
    expect(r.session_end).toBe('tool_call');
    expect(r.last_action).toBe('observed');
    expect(r.compliance.followed).toBe(true);
    const text = file(JSON.stringify({ seq: 0, route: '/v1/messages', body: { content: [{ type: 'text', text: 'done' }] } }) + '\n');
    expect(scored(probe(anthropic(good.slice(0, 4)), 'review', { termination: 'timeout', responses: text })).markers['review.full_diff_first']!.state).toBe('not_met');
    const bad = probe(anthropic(good), 'review', { responses: file('{"seq":0,') });
    expect(bad).toMatchObject({ status: 'unparsed', code: 'PROBE_RESPONSE_UNPARSED', wire: 'anthropic-messages' });
  });
});

describe('ship markers, OpenAI Responses and Chat Completions', () => {
  const good = ['git fetch origin', 'git merge origin/main', 'git commit -am "Merge main"', 'python -m pytest -q', 'git diff origin/main...HEAD', 'git push -u origin feature/ecf4ee'];
  const st = (cmds: string[]) => states(probe(responses(cmds), 'ship'));
  test('quoted command text is not a command: echoing git commit, git diff, pytest and git push earns no ship marker', () => {
    expect(shellActions("echo 'git commit -am done' && echo \"git diff origin/main\" && echo 'pytest' && echo \"git push origin feature/x\"")).toEqual([]);
    const s = st(["echo 'git commit -am done'", "echo 'git diff origin/main'", "echo 'pytest'", "echo 'git push origin feature/x'"]);
    expect(Object.values(s)).not.toContain('met');
    expect(shellActions("bash -lc 'git push origin feature/x'")).toEqual([{ t: 'push', main: false, force: false }]);
  });
  const push = { t: 'push', main: false, force: false } as const;
  const wrappers: Array<[string, string, ReturnType<typeof shellActions>, (c: string) => string]> = [
    ['bash -o pipefail -c', "bash -o pipefail -c 'git merge origin/main && git push origin feature/x'", [{ t: 'merge' }, { t: 'commit' }, push], (c) => `bash -o pipefail -c '${c}'`],
    ['docker exec <ctr> sh -c', "docker exec app sh -c 'cd /work/repo && git commit -am wip && git push origin feature/x'", [{ t: 'commit' }, push], (c) => `docker exec app sh -c '${c}'`],
    ['bash -lc "..."', 'bash -lc "git diff origin/main...HEAD && git push -u origin feature/x"', [{ t: 'diff', full: true }, push], (c) => `bash -lc "${c.replace(/"/g, '\\"')}"`],
    ['env bash -c', "env bash -c 'git push origin feature/x'", [push], (c) => `env bash -c '${c}'`],
  ];
  for (const [name, command, actions, wrap] of wrappers) {
    test(`git inside ${name} is read as commands, and every ship marker is met through it`, () => {
      expect(shellActions(command)).toEqual(actions);
      expect(st(good.map(wrap))).toEqual({ 'ship.fresh_verification': 'met', 'ship.final_diff_after_commit': 'met' });
    });
  }
  test('echoing git push, or a wrapper around it, still earns nothing', () => {
    expect(shellActions("echo 'git push'")).toEqual([]);
    expect(shellActions("echo sh -c 'git push origin feature/x'")).toEqual([]);
    expect(shellActions("echo \"docker exec app sh -c 'git push origin feature/x'\"")).toEqual([]);
  });
  test('Responses: every step met; tests after the merge is reported as descriptive only', () => {
    const r = scored(probe(responses(good), 'ship'));
    expect(r.wire).toBe('openai-responses');
    expect(states(r)).toEqual({ 'ship.fresh_verification': 'met', 'ship.final_diff_after_commit': 'met' });
    expect(r.compliance).toEqual({ met: 2, applicable: 2, share: 1, followed: true });
    expect(r.descriptive['ship.tests_after_merge']!.state).toBe('met');
  });
  test('followed needs fresh verification and the final diff, never tests after the merge', () => {
    const noMerge = scored(probe(responses(['python -m pytest -q', 'git diff origin/main', 'git push origin feature/x']), 'ship'));
    expect(noMerge.descriptive['ship.tests_after_merge']!.state).toBe('not_met');
    expect(noMerge.compliance.followed).toBe(true);
    const staleAfterEdit = scored(probe(responses(['git merge origin/main', 'python -m pytest -q', 'echo "- Added: x" >> CHANGELOG.md', 'git commit -am log', 'git diff origin/main', 'git push origin feature/x']), 'ship'));
    expect(staleAfterEdit.descriptive['ship.tests_after_merge']!.state).toBe('met');
    expect(staleAfterEdit.markers['ship.fresh_verification']!.state).toBe('not_met');
    expect(staleAfterEdit.compliance.followed).toBe(false);
  });
  test('fresh verification near misses: an edit after the last full run, in every write form', () => {
    const after = (edit: string) => st(['git merge origin/main', 'python -m pytest -q', edit, 'git commit -am x', 'git push origin feature/x'])['ship.fresh_verification'];
    expect(after('echo "- Added: x" >> CHANGELOG.md')).toBe('not_met');
    expect(after('printf "1.3.0\\n" > VERSION')).toBe('not_met');
    expect(after("sed -i 's/1.2.0/1.3.0/' VERSION")).toBe('not_met');
    expect(after("perl -pi -e 's/1.2.0/1.3.0/' VERSION")).toBe('not_met');
    expect(after('python3 -c "open(\'CHANGELOG.md\', \'w\').write(\'x\')"')).toBe('not_met');
    expect(after("python3 - <<'EOF'\nfrom pathlib import Path\nPath('VERSION').write_text('1.3.0\\n')\nEOF")).toBe('not_met');
    expect(after('cp /tmp/CHANGELOG.md CHANGELOG.md')).toBe('not_met');
    expect(after('tee VERSION <<< 1.3.0')).toBe('not_met');
    expect(after('git stash pop')).toBe('not_met');
    expect(after('git checkout -- VERSION')).toBe('not_met');
    expect(after('git pull origin main')).toBe('not_met');
    expect(after("apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: VERSION\n@@\n-1.2.0\n+1.3.0\n*** End Patch\nEOF")).toBe('not_met');
  });
  test('fresh verification near misses: a partial run after the last edit, or no run at all', () => {
    expect(st(['git merge origin/main', 'echo x >> CHANGELOG.md', 'pytest tests/test_one.py', 'git push origin feature/x'])['ship.fresh_verification']).toBe('not_met');
    expect(st(['git merge origin/main', 'echo x >> CHANGELOG.md', 'pytest -k textile', 'git push origin feature/x'])['ship.fresh_verification']).toBe('not_met');
    expect(scored(probe(responses(['git merge origin/main', 'git push origin feature/x']), 'ship')).markers['ship.fresh_verification']).toMatchObject({ state: 'not_met', reason: 'no full test-suite run between the last change to the repository and the last push' });
  });
  test('fresh verification met: a full run after the last edit; commits, reads and writes outside /work do not count as changes', () => {
    expect(st(['git merge origin/main', 'echo "- Added: x" >> CHANGELOG.md', "sed -i 's/1.2.0/1.3.0/' VERSION", 'PYTHONPATH=src python -m pytest test tests_feature > /tmp/log 2>&1', 'git commit -am x', 'git diff origin/main', 'git push origin feature/x'])).toEqual({ 'ship.fresh_verification': 'met', 'ship.final_diff_after_commit': 'met' });
    expect(st(['git merge origin/main', 'pytest', 'echo notes > /tmp/notes.txt', 'cat CHANGELOG.md', 'sed -n 1,5p VERSION', 'git push origin feature/x'])['ship.fresh_verification']).toBe('met');
    expect(st(['git merge origin/main', 'cd /tmp && echo x > scratch.txt', 'cd /work/repo && pytest', 'git push origin feature/x'])['ship.fresh_verification']).toBe('met');
  });
  test('native editor writes (Claude Code Edit) count as changes', () => {
    const edit: Step = { name: 'Edit', input: { file_path: '/work/repo/CHANGELOG.md', old_string: '## Unreleased', new_string: '## Unreleased\n\n- Added: x' } };
    const stale = scored(probe(anthropic([bash('git merge origin/main'), bash('python -m pytest -q'), edit, bash('git commit -am x'), bash('git diff origin/main'), bash('git push origin feature/x')]), 'ship'));
    expect(stale.markers['ship.fresh_verification']!.state).toBe('not_met');
    const fresh = scored(probe(anthropic([bash('git merge origin/main'), edit, bash('python -m pytest -q'), bash('git commit -am x'), bash('git diff origin/main'), bash('git push origin feature/x')]), 'ship'));
    expect(fresh.compliance.followed).toBe(true);
  });
  test('final diff near misses: a stat diff, a diff before the last commit, a diff of the work tree only', () => {
    expect(st(['git merge origin/main', 'pytest', 'git diff --stat origin/main', 'git push origin feature/x'])['ship.final_diff_after_commit']).toBe('not_met');
    expect(st(['git merge origin/main', 'git diff origin/main', 'git commit -am fix', 'git push origin feature/x'])['ship.final_diff_after_commit']).toBe('not_met');
    expect(st(['git merge origin/main', 'git commit -am fix', 'git diff', 'git push origin feature/x'])['ship.final_diff_after_commit']).toBe('not_met');
  });
  test('a push to main is not a push of the branch; a later merge without a rerun is a near miss', () => {
    const toMain = scored(probe(responses(['git merge origin/main', 'pytest', 'git diff origin/main', 'git push origin HEAD:main']), 'ship'));
    expect(toMain.markers['ship.fresh_verification']).toMatchObject({ state: 'not_met', reason: 'no push of the branch' });
    const later = scored(probe(responses(['git merge origin/main', 'pytest', 'git pull origin main', 'git push origin feature/x']), 'ship'));
    expect(later.markers['ship.fresh_verification']!.state).toBe('not_met');
    expect(later.descriptive['ship.tests_after_merge']!.state).toBe('not_met');
    expect(st(['git rebase origin/main', 'pytest', 'git diff origin/main...HEAD', 'git push --force-with-lease origin feature/x'])).toEqual({ 'ship.fresh_verification': 'met', 'ship.final_diff_after_commit': 'met' });
  });
  test('Chat Completions: every step met, and repeated commands without call ids stay separate calls', () => {
    const r = scored(probe(chat(good), 'ship'));
    expect(r.wire).toBe('openai-chat');
    expect(r.compliance.followed).toBe(true);
    const noIds = scored(probe(chat(['pytest', 'git merge origin/main', 'pytest', 'git push origin feature/x'], { ids: false }), 'ship'));
    expect(noIds.tool_calls).toBe(4);
    expect(noIds.markers['ship.fresh_verification']!.state).toBe('met');
  });
  test('a session ending without a push: unobservable after a timeout, not met after a completed session', () => {
    expect(states(probe(responses(good.slice(0, 5)), 'ship', { termination: 'timeout' }))).toEqual({ 'ship.fresh_verification': 'unobservable', 'ship.final_diff_after_commit': 'unobservable' });
    expect(states(probe(responses(good.slice(0, 5)), 'ship', { termination: 'completed' }))).toEqual({ 'ship.fresh_verification': 'not_met', 'ship.final_diff_after_commit': 'not_met' });
  });
});

describe('shell parsing', () => {
  test('cd sets the directory of later segments; heredoc bodies are not split', () => {
    expect(shellActions('cd /work/out/tests && pytest test_a.py')).toEqual([{ t: 'test', suite: false, targets: ['/work/out/tests/test_a.py'], cwd: '/work/out/tests' }]);
    expect(shellActions("cat > /work/out/review.json <<'EOF'\n[{\"summary\": \"a; b && c\"}]\nEOF\necho done")).toEqual([{ t: 'write', path: '/work/out/review.json', content: '[{"summary": "a; b && c"}]' }]);
    expect(covers({ targets: [], cwd: '/work/repo' }, T)).toBe(false);
    expect(covers({ targets: ['/work/out/tests'], cwd: null }, T)).toBe(true);
    expect(covers({ targets: ['out/tests/test_limit.py::test_x'], cwd: null }, T)).toBe(true);
  });
});

describe('delivery: the card sha in request 1 (d12) and copies per request (d1)', () => {
  const steps = [bash('git diff main...HEAD'), writeReview('[]')];
  test('hook: the card in every user turn, including tool follow-ups', () => {
    const r = scored(probe(anthropic(steps, { hook: CARD.review }), 'review', { arm: 'hook' }));
    expect(r.delivery).toMatchObject({ in_request_1: true, match: 'exact', request_1_seq: 0, agent_requests: 3, requests_with_copy: 3 });
    expect(r.delivery!.expected_sha256).toBe(SEL.cards.review!.sha256);
    expect(r.delivery!.copies_per_request).toEqual([1, 2, 3]);
    expect(r.infra_class).toBeNull();
  });
  test('startup: the card in the system prompt, after a housekeeping call that declares no tools', () => {
    const r = scored(probe(anthropic(steps, { system: 'Contents of CLAUDE.md:\n' + CARD.review + '\n', housekeeping: true }), 'review', { arm: 'startup' }));
    expect(r.delivery).toMatchObject({ in_request_1: true, request_1_seq: 1, agent_requests: 3 });
    const codex = scored(probe(responses(['git merge origin/main'], { developer: '# AGENTS.md\n' + CARD.ship.trimEnd() }), 'ship', { arm: 'startup' }));
    expect(codex.delivery).toMatchObject({ in_request_1: true, match: 'exact' });
  });
  test('a card missing from request 1 is route_not_delivered, even when a later request has it; a near-miss card does not count', () => {
    const entries = anthropic(steps);
    (entries[2] as { body: { system: string } }).body.system = CARD.review;
    const late = scored(probe(entries, 'review', { arm: 'hook' }));
    expect(late.delivery).toMatchObject({ in_request_1: false, requests_with_copy: 1 });
    expect(late.infra_class).toBe('route_not_delivered');
    const edited = scored(probe(anthropic(steps, { system: CARD.review.replace('FULL', 'full') }), 'review', { arm: 'startup' }));
    expect(edited.infra_class).toBe('route_not_delivered');
    expect(scored(probe(anthropic(steps), 'review', { arm: 'none' })).infra_class).toBeNull();
  });
  test('placebo: checked against the placebo text given', () => {
    const placebo = 'This workspace belongs to a small team.';
    expect(scored(probe(anthropic(steps, { hook: placebo }), 'review', { arm: 'placebo', expected: placebo })).infra_class).toBeNull();
  });
});

describe('contamination: tool calls naming a gstack file', () => {
  test('a read of an installed gstack skill counts; an unrelated path does not', () => {
    const r = scored(probe(anthropic([{ name: 'Read', input: { file_path: '/root/.claude/skills/gstack/review/SKILL.md' } }, bash('ls ~/.local/share/gstack'), bash('cat docs/gstack-notes.md'), writeReview('[]')]), 'review'));
    expect(r.gstack_reads).toBe(2);
  });
});

describe('unparsed captures: a stable code, the trial id and the wire, never 0 steps (d13)', () => {
  const ok = captureText(anthropic([bash('git diff main...HEAD')]));
  const cases: Array<[string, () => ProbeResult, string]> = [
    ['missing file', () => probeTrial({ trial_id: 'tx', kind: 'review', arm: 'none', capture: join(tmp, 'nope.ndjson') }, SEL), 'PROBE_CAPTURE_MISSING'],
    ['empty file', () => probe('', 'review'), 'PROBE_CAPTURE_EMPTY'],
    ['only bodiless lines', () => probe(captureText([{ route: '/v1/models', body: null }]), 'review'), 'PROBE_CAPTURE_EMPTY'],
    ['a line that is not JSON', () => probe(ok + 'not json\n', 'review'), 'PROBE_LINE_JSON'],
    ['a broken chain', () => probe(ok.split('\n').slice(1).join('\n'), 'review'), 'PROBE_CHAIN_BROKEN'],
    ['the size-cap marker', () => probe(captureText([...anthropic([bash('git diff main')]), { truncated: true }]), 'review'), 'PROBE_TRUNCATED'],
    ['a cut last line', () => probe(ok.slice(0, -20), 'review'), 'PROBE_TRUNCATED'],
    ['fewer lines than metered', () => probe(ok, 'review', { metered: 9 }), 'PROBE_INCOMPLETE'],
    ['an unknown wire', () => probe(captureText([{ route: '/v1/embeddings', body: { model: 'e', prompt: 'x' } }]), 'review'), 'PROBE_WIRE_UNKNOWN'],
    ['mixed wires', () => probe(captureText([...anthropic([]), ...chat([])]), 'ship'), 'PROBE_WIRE_UNKNOWN'],
  ];
  for (const [what, run, code] of cases) test(what + ' -> ' + code, () => {
    const r = run() as ProbeUnparsed;
    expect(r.status).toBe('unparsed');
    expect(r.code as string).toBe(code);
    expect(UNPARSED_CODES as readonly string[]).toContain(r.code);
    expect(typeof r.trial_id).toBe('string');
    expect(r.trial_id.length).toBeGreaterThan(0);
    expect(['anthropic-messages', 'openai-responses', 'openai-chat', 'unknown']).toContain(r.wire);
    expect('markers' in r).toBe(false);
  });
  test('the wire is named when it was read before the failure', () => {
    expect(probe(ok + 'not json\n', 'review')).toMatchObject({ code: 'PROBE_LINE_JSON', wire: 'anthropic-messages' });
  });
  test('the CLI writes every line, names the trial and wire on stderr, and exits 3', () => {
    const batch = join(tmp, 'batch.jsonl');
    writeFileSync(batch, [JSON.stringify({ trial_id: 'good-1', capture: file(ok), kind: 'review', arm: 'none', termination: 'completed' }), JSON.stringify({ trial_id: 'bad-1', capture: file(ok + 'x\n'), kind: 'review', arm: 'none' })].join('\n') + '\n');
    const out = join(tmp, 'probes.jsonl');
    const r = Bun.spawnSync(['bun', join(ROOT, 'scripts/gstack-delivery/probes.ts'), '--batch', batch, '--out', out], { env: { PATH: process.env.PATH ?? '' } });
    expect(r.exitCode).toBe(3);
    expect(r.stderr.toString()).toContain('PROBE_UNPARSED trial=bad-1 code=PROBE_LINE_JSON wire=anthropic-messages');
    const rows = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(rows.map((x) => [x.trial_id, x.status])).toEqual([['good-1', 'scored'], ['bad-1', 'unparsed']]);
  });
});

describe('harness tool shapes', () => {
  test('quoted bash -lc commands, a Codex apply_patch command and Hermes-style tools are read', () => {
    const codex = scored(probe(responses(["bash -lc 'git diff main...HEAD'", "python3 -c 'import schedule'", 'python -m pytest ' + T]), 'review', { termination: 'timeout' }));
    expect(codex.markers['review.full_diff_first']!.state).toBe('unobservable');
    const patch = '*** Begin Patch\n*** Add File: /work/out/review.json\n+' + REVIEW_JSON + '\n*** End Patch';
    const withPatch = scored(probe(responses(["bash -lc 'git diff main...HEAD'", "python3 -c 'import schedule'", "cat > " + T + " <<'EOF'\ndef test_x(): pass\nEOF", 'python -m pytest ' + T, "apply_patch <<'EOF'\n" + patch + '\nEOF']), 'review'));
    expect(states(withPatch)).toEqual({ 'review.full_diff_first': 'met', 'review.check_before_finding': 'met', 'review.test_per_finding': 'met' });
    const hermes: Entry[] = [];
    const calls = [
      { name: 'terminal', args: { command: 'git diff main...feature/x' } },
      { name: 'execute_code', args: { code: 'import schedule\nprint(schedule.every(1))' } },
      { name: 'write_file', args: { path: T, content: 'def test_x(): pass\n' } },
      { name: 'terminal', args: { command: 'cd /work/repo && pytest ' + T } },
      { name: 'write_file', args: { path: '/work/out/review.json', content: REVIEW_JSON } },
    ];
    for (let k = 0; k <= calls.length; k++) {
      const messages: unknown[] = [{ role: 'system', content: 's' }, { role: 'user', content: 'Review.' }];
      calls.slice(0, k).forEach((c, i) => { messages.push({ role: 'assistant', content: null, tool_calls: [{ id: 'h' + i, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }] }); messages.push({ role: 'tool', tool_call_id: 'h' + i, content: 'ok' }); });
      hermes.push({ route: '/v1/chat/completions', body: { model: 'm', tools: TOOLS, messages } });
    }
    expect(scored(probe(hermes, 'review')).compliance.followed).toBe(true);
  });
  test('Codex 0.165: tools declared in an additional_tools item, shell and patch calls inside the exec tool\'s JavaScript', () => {
    const patch = (path: string, body: string) => '*** Begin Patch\n*** Add File: ' + path + '\n+' + body + '\n*** End Patch\n';
    const sources = [
      'const r = await tools.exec_command({ cmd: "git diff main...feature/change-1", workdir: "/work/repo" });\ntext(r.output);\n',
      "// @exec: {\"yield_time_ms\": 10000}\nconst r = await tools.exec_command({ 'cmd': \"python3 -c 'import schedule; print(schedule.every)'\", yield_time_ms: 5000 });\ntext(r);\n",
      'await tools.apply_patch(`' + patch(T, 'def test_x(): pass') + '`);\n',
      "const a = await tools.exec_command({ cmd: 'cd /work/repo && python -m pytest " + T + " -q', prefix_rule: ['python', '-m'] });\ntext(a.output);\n",
      'await tools.apply_patch(' + JSON.stringify(patch('/work/out/review.json', REVIEW_JSON)) + ');\n',
    ];
    const r = scored(probe(codexExec(sources), 'review'));
    expect(r).toMatchObject({ wire: 'openai-responses', requests: 6, agent_requests: 6, tool_calls: 5, gstack_reads: 0 });
    expect(states(r)).toEqual({ 'review.full_diff_first': 'met', 'review.check_before_finding': 'met', 'review.test_per_finding': 'met' });
    const startup = scored(probe(codexExec(sources.slice(0, 1), { developer: '# AGENTS.md\n' + CARD.review, housekeeping: true }), 'review', { arm: 'startup' }));
    expect(startup.delivery).toMatchObject({ in_request_1: true, request_1_seq: 1, agent_requests: 2 });
    expect(scored(probe(codexExec(sources.slice(0, 1), { housekeeping: true }), 'review', { arm: 'hook' })).infra_class).toBe('route_not_delivered');
  });
  test('Codex exec: several nested calls, a string argument, and a command that is not a literal', () => {
    expect(execNestedCalls('await tools.exec_command({ cmd: "echo \\"a, }\\" workdir: x", workdir: \'/w\', justification: fmt({ a: [1, 2] }) });\nawait tools.exec_command("git status");\n')).toEqual({
      calls: [{ name: 'exec_command', args: { cmd: 'echo "a, }" workdir: x', workdir: '/w' } }, { name: 'exec_command', args: { cmd: 'git status' } }], whole: false,
    });
    expect(execNestedCalls('const r = await tools.wait({ ms: 10 });').whole).toBe(true);
    const unread = 'const p = "/root/.codex/skills/gstack/review/SKILL.md";\nawait tools.exec_command({ cmd: `cat ${p}` });\n';
    expect(execNestedCalls(unread)).toEqual({ calls: [], whole: true });
    const r = scored(probe(codexExec([unread, 'await tools.exec_command({ cmd: "ls ~/.local/share/gstack" });', 'await tools.exec_command({ cmd: "cat docs/gstack-notes.md" });']), 'review'));
    expect(r.gstack_reads).toBe(2);
  });
  test('a Responses request that continues a stored response is incomplete, not scored', () => {
    const entries = responses(['git merge origin/main']);
    (entries[1] as { body: Record<string, unknown> }).body.previous_response_id = 'resp_1';
    expect(probe(entries, 'ship')).toMatchObject({ status: 'unparsed', code: 'PROBE_INCOMPLETE', wire: 'openai-responses' });
  });
});

describe('what ran: && and || chains, test selection, git rewrites, writes outside the repository, root-level test files', () => {
  const ship = (steps: Step[]) => states(probe(anthropic(steps), 'ship'));
  const failed = (command: string): Step => ({ name: 'Bash', input: { command }, error: 'Exit code 1' });
  const both = (s: 'met' | 'not_met') => ({ 'ship.fresh_verification': s, 'ship.final_diff_after_commit': s });
  test('a step after && earns nothing when the capture shows the call failed, and everything when it shows success', () => {
    expect(ship([bash('git merge origin/main'), failed('false && pytest && git commit -am done && git diff origin/main && git push origin feature/x')])).toEqual(both('not_met'));
    const chained = 'git add -A && python -m pytest -q && git commit -m done && git diff origin/main && git push origin feature/x';
    expect(ship([bash('git merge origin/main'), failed(chained)])).toEqual(both('not_met'));
    expect(ship([bash('git merge origin/main'), bash(chained)])).toEqual(both('met'));
    expect(ship([bash('git merge origin/main'), bash('python -m pytest -q && git commit -am x; git diff origin/main && echo ok'), bash('git push origin feature/x')])['ship.fresh_verification']).toBe('met');
  });
  test('cd is not a gate: a run after cd counts when the call failed', () => {
    expect(ship([bash('git merge origin/main'), failed('cd /work/repo && python -m pytest -q'), bash('git push origin feature/x')])['ship.fresh_verification']).toBe('met');
  });
  test('a step the capture cannot confirm (no exit status, after ||, or before a later ;) is unobservable when only it meets the marker', () => {
    const exec = (cmd: string) => 'const r = await tools.exec_command({ cmd: ' + JSON.stringify(cmd) + ', workdir: "/work/repo" });\ntext(r.output);\n';
    const codex = scored(probe(codexExec([exec('git merge origin/main'), exec('git status && python -m pytest -q'), exec('git push origin feature/x')]), 'ship'));
    expect(codex.markers['ship.fresh_verification']!.state).toBe('unobservable');
    expect(codex.compliance.share).toBeNull();
    expect(ship([bash('git merge origin/main'), bash('false || python -m pytest -q'), bash('git push origin feature/x')])['ship.fresh_verification']).toBe('unobservable');
    expect(ship([bash('git merge origin/main'), bash('git status && python -m pytest -q; echo done'), bash('git push origin feature/x')])['ship.fresh_verification']).toBe('unobservable');
    expect(states(probe(codexExec([exec('git merge origin/main'), exec('python -m pytest -q'), exec('git push origin feature/x')]), 'ship'))['ship.fresh_verification']).toBe('met');
  });
  test('pytest -m and --deselect select tests, like -k and --lf: not a full-suite run', () => {
    for (const c of ['pytest -m smoke', 'pytest -msmoke', 'python -m pytest -m "not slow" -q', 'pytest --deselect tests/test_a.py::test_x', 'pytest --deselect=tests/test_a.py::test_x']) expect(shellActions(c, '/work/repo')).toMatchObject([{ t: 'test', suite: false }]);
    expect(ship([bash('git merge origin/main'), bash('pytest -m smoke'), bash('git push origin feature/x')])['ship.fresh_verification']).toBe('not_met');
    expect(ship([bash('git merge origin/main'), bash('pytest --deselect tests/test_a.py::test_x'), bash('git push origin feature/x')])['ship.fresh_verification']).toBe('not_met');
  });
  test('git reset --hard, git switch and git checkout without -- rewrite files', () => {
    const write: ReturnType<typeof shellActions> = [{ t: 'write', path: '<git>', content: null }];
    for (const c of ['git reset --hard HEAD~1', 'git reset --keep origin/main', 'git switch other', 'git switch -c fix origin/main', 'git checkout HEAD~1 src/x.py', 'git checkout main', 'git checkout -b fix origin/main']) expect(shellActions(c)).toEqual(write);
    for (const c of ['git reset HEAD CHANGELOG.md', 'git reset --soft HEAD~1', 'git switch -c fix', 'git checkout -b fix', 'git checkout']) expect(shellActions(c)).toEqual([]);
    for (const rewrite of ['git reset --hard HEAD~1', 'git switch other', 'git checkout HEAD~1 src/x.py']) expect(ship([bash('git merge origin/main'), bash('pytest'), bash(rewrite), bash('git commit --allow-empty -m done'), bash('git diff origin/main'), bash('git push origin feature/x')])['ship.fresh_verification']).toBe('not_met');
  });
  test('writes under ~, $HOME, $GSTACK_STATE_ROOT and other variables are outside the repository; $PWD is inside', () => {
    for (const c of ['echo x >> ~/.gstack/a.jsonl', 'echo x >> "$HOME/.cache/n"', 'echo x > "$GSTACK_STATE_ROOT/s.json"', 'echo x > ${TMPDIR}/y']) {
      const [a] = shellActions(c, '/work/repo') as Array<{ t: string; path: string }>;
      expect(a!.t).toBe('write');
      expect(inRepo(a!.path)).toBe(false);
    }
    expect(shellActions('echo x > "$PWD/a.py"', '/work/repo')).toEqual([{ t: 'write', path: '/work/repo/a.py', content: null }]);
    expect(inRepo('/work/repo/a.py')).toBe(true);
    expect(ship([bash('git merge origin/main'), bash('python -m pytest -q'), bash('echo done >> "$GSTACK_STATE_ROOT/analytics/eureka.jsonl"'), bash('echo x >> ~/.gstack/a.jsonl'), bash('git push origin feature/x')])['ship.fresh_verification']).toBe('met');
    expect(ship([bash('git merge origin/main'), bash('python -m pytest -q'), bash('echo x >> "$PWD/CHANGELOG.md"'), bash('git push origin feature/x')])['ship.fresh_verification']).toBe('not_met');
  });
  test('the repository\'s documented command, root-level test files plus test folders, is a full-suite run', () => {
    for (const c of ['python -m pytest test_schedule.py tests_feature', 'PYTHONPATH=. python -m pytest test_inflection.py tests_feature -q', 'python -m pytest /work/repo/test_inflection.py', 'pytest ./test_schedule.py']) expect(shellActions(c, '/work/repo')).toMatchObject([{ t: 'test', suite: true }]);
    expect(shellActions('python -m pytest test_inflection.py tests_feature')).toMatchObject([{ t: 'test', suite: true }]);
    for (const c of ['pytest tests/test_one.py', 'pytest test_schedule.py::test_every', 'pytest -k every test_schedule.py tests_feature', 'pytest tests_feature/test_rules.py', 'pytest helpers.py']) expect(shellActions(c, '/work/repo')).toMatchObject([{ t: 'test', suite: false }]);
    expect(shellActions('cd /work/out/tests && pytest test_a.py')).toMatchObject([{ t: 'test', suite: false }]);
    expect(ship([bash('git merge origin/main'), bash('echo x >> CHANGELOG.md'), bash('python -m pytest test_schedule.py tests_feature'), bash('git push origin feature/x')])['ship.fresh_verification']).toBe('met');
  });
});


describe('Hermes hook and placebo: the card appended to a tool result does not hide its exit status', () => {
  const hermes = (result: string, o: { card?: string } = {}): Entry[] => {
    const cmd = 'git merge origin/main && python -m pytest && git push origin feature/x';
    const add = (s: string) => (o.card ? s + '\n\n' + o.card : s);
    const first = { route: '/v1/chat/completions', body: { model: 'm', tools: TOOLS, messages: [{ role: 'system', content: 's' }, { role: 'user', content: add('Ship it.') }] } };
    const second = { route: '/v1/chat/completions', body: { model: 'm', tools: TOOLS, messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'Ship it.' }, { role: 'assistant', content: null, tool_calls: [{ id: 'h0', type: 'function', function: { name: 'terminal', arguments: JSON.stringify({ command: cmd }) } }] }, { role: 'tool', tool_call_id: 'h0', content: add(result) }] } };
    return [first, second];
  };
  const fresh = (r: ProbeResult) => scored(r).markers['ship.fresh_verification']!.state;
  test('a JSON exit_code followed by the card reads as that exit code, on hook as on skill', () => {
    const ok = JSON.stringify({ output: '5 passed in 0.10s', exit_code: 0, error: null });
    expect(fresh(probe(hermes(ok), 'ship', { arm: 'skill' }))).toBe('met');
    const hook = scored(probe(hermes(ok, { card: CARD.ship }), 'ship', { arm: 'hook' }));
    expect(hook.infra_class).toBeNull();
    expect(hook.markers['ship.fresh_verification']!.state).toBe('met');
    const failed = JSON.stringify({ output: '1 failed in 0.10s', exit_code: 1, error: null });
    expect(fresh(probe(hermes(failed, { card: CARD.ship }), 'ship', { arm: 'hook' }))).toBe('not_met');
    expect(fresh(probe(hermes(failed), 'ship', { arm: 'skill' }))).toBe('not_met');
  });
});

