// internal-task: the install canary, keyless. Route extraction from INSTALL_FOR_AGENTS.md at three real gbrain tags, the verdict
// rules, release selection, and the drive publish (lock, idempotence, write order, latest.json and notifications). No VM, no
// model, no network.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dropLock, type IndexLine, latestOf, notifications, type Plan, publish, readIndex, type Release, resultReason, selectJobs, takeLock, versionKey } from '../scripts/install-canary/canary.ts';
import { classifyLine, foundId, lineCommand, MCP_ERROR, mcpArgs, mcpCall, PROVENANCE } from '../scripts/install-canary/fake-model.ts';
import { blockAfter, EXPECTED, resolveRoute, stepOf, substitute } from '../scripts/install-canary/routes.ts';
import { newFakeState } from '../scripts/install-canary/fake-model.ts';
import { evaluateCase, gbrainCode, overall, SCHEMA, stableRelease, type TagResult, verdictFields } from '../scripts/install-canary/run-tag.ts';

const FIX = resolve(import.meta.dir, 'fixtures/install-canary');
const doc = (tag: string) => readFileSync(join(FIX, 'INSTALL_FOR_AGENTS-' + tag + '.txt'), 'utf8');
const tagCh = (tag: string) => ({ kind: 'tag' as const, tag });

describe('route extraction', () => {
  test('v0.60.734.0: Hermes runs the Bun route and registers with hermes mcp add', () => {
    const { route, probe } = resolveRoute('hermes', doc('v0.60.734.0'), tagCh('v0.60.734.0'));
    expect(route.missing).toEqual([]);
    expect(probe).toBeNull();
    expect(route.lines.some((l) => l.step === 'bun' && /bun\.sh\/install|bun install -g/.test(l.command))).toBe(true);
    expect(route.lines.some((l) => /hermes mcp add/.test(l.command))).toBe(true);
    expect(route.lines.every((l) => !/#stable/.test(l.command))).toBe(true);
  });
  for (const tag of ['v0.60.757.0', 'v0.60.761.0']) {
    test(tag + ': Hermes runs the release binary, pinned to the tag, plus a Bun probe', () => {
      const { route, probe } = resolveRoute('hermes', doc(tag), tagCh(tag));
      expect(route.missing).toEqual([]);
      const bin = route.lines.filter((l) => l.step === 'binary');
      expect(bin.length).toBeGreaterThan(0);
      expect(bin.some((l) => l.command.includes('/releases/download/' + tag + '/'))).toBe(true);
      expect(route.lines.every((l) => !l.command.includes('/releases/latest/'))).toBe(true);
      expect(route.lines.some((l) => /setup hermes/.test(l.command))).toBe(true);
      expect(probe?.lines.length).toBeGreaterThan(0);
      expect(probe!.lines[0]!.step).toBe('bun');
      expect(probe!.lines.some((l) => l.command.startsWith('bun install -g github:garrytan/gbrain#' + tag))).toBe(true);
    });
  }
  test('Claude Code and Codex share the setup block, with the harness name swapped in', () => {
    const d = doc('v0.60.761.0');
    const cc = resolveRoute('claude-code', d, tagCh('v0.60.761.0')).route;
    const cx = resolveRoute('codex', d, tagCh('v0.60.761.0')).route;
    expect(cc.missing).toEqual([]);
    expect(cx.missing).toEqual([]);
    expect(cc.lines.length).toBe(cx.lines.length);
    expect(cx.lines.some((l) => /codex/.test(l.command) && l.step === 'setup')).toBe(true);
    expect(cc.lines.some((l) => l.command.includes('#v0.60.761.0'))).toBe(true);
  });
  test('OpenClaw uses the inline setup line before its block existed, and the block at 761', () => {
    const old = resolveRoute('openclaw', doc('v0.60.734.0'), tagCh('v0.60.734.0')).route;
    expect(old.resolved.find((r) => r.found && r.part === 'register')?.selector).toBe('inline-setup-openclaw');
    const now = resolveRoute('openclaw', doc('v0.60.761.0'), tagCh('v0.60.761.0')).route;
    expect(now.resolved.find((r) => r.found && r.part === 'register')?.selector).toBe('if-openclaw');
  });
  test('the blocks at v0.60.761.0 match the recorded checksums, so a changed block is flagged', () => {
    const r = resolveRoute('hermes', doc('v0.60.761.0'), tagCh('v0.60.761.0')).route;
    for (const x of r.resolved.filter((x) => x.found)) expect(x.sha256).toBe(EXPECTED[x.selector]);
    expect(r.resolved.some((x) => x.changed)).toBe(false);
  });
  test('a missing anchor is reported, not guessed', () => {
    const cut = doc('v0.60.761.0').replace('**If you are Hermes:**', '**Hermes users:**');
    const r = resolveRoute('hermes', cut, tagCh('v0.60.761.0')).route;
    expect(r.missing.length).toBeGreaterThan(0);
    expect(blockAfter('no marker here', '**If you are Hermes:**')).toBeNull();
  });
  test('stable channel keeps the doc verbatim', () => {
    const line = 'curl -fsSL https://github.com/garrytan/gbrain/releases/latest/download/gbrain-linux-x64 -o x && bun install -g github:garrytan/gbrain#stable';
    expect(substitute(line, 'hermes', { kind: 'stable' })).toBe(line);
    const pinned = substitute(line, 'hermes', tagCh('v1.2.3.4'));
    expect(pinned).toContain('/releases/download/v1.2.3.4/');
    expect(pinned).toContain('#v1.2.3.4');
    expect(stepOf('curl -fsSL https://bun.sh/install | bash')).toBe('bun');
  });
});

describe('line and verdict rules', () => {
  test('a guard message is a refusal, an exit code is a failure', () => {
    expect(classifyLine('BLOCKED: Security scan flagged this command as dangerous', true).status).toBe('refused');
    expect(classifyLine('Exit code: 1\nerror: not found', true).status).toBe('fail');
  });
  test('a GitHub rate limit makes a failed download incomplete, but a guard refusal still fails', () => {
    const { route } = resolveRoute('hermes', doc('v0.60.734.0'), tagCh('v0.60.734.0'));
    const ev = (status: 'fail' | 'refused', rateLimited: boolean) => {
      const state = newFakeState(route.lines);
      state.results = [{ index: 0, command: route.lines[0]!.command, status, exit_code: status === 'fail' ? 22 : -1, guard: status === 'refused' ? 'BLOCKED: pipe remote content to shell' : null, output: status === 'fail' ? 'curl: (22) The requested URL returned error: 429' : 'BLOCKED' }];
      return { route, state, record: { install: { outcome: 'no_call' } } as any, thrown: null, probes: [], watch: [], security: [], rateLimited };
    };
    expect(evaluateCase('hermes', ev('fail', true)).status).toBe('incomplete');
    expect(evaluateCase('hermes', ev('fail', false)).status).toBe('fail');
    expect(evaluateCase('hermes', ev('refused', true)).status).toBe('fail');
  });
  test('fail beats incomplete beats harness_or_env beats pass, and only fail blocks stable', () => {
    const h = (status: TagResult['status']) => ({ status, version: null, guard_mode: '', route: [], steps: {}, probe: null });
    expect(overall({ a: h('pass'), b: h('incomplete'), c: h('fail') }).status).toBe('fail');
    expect(overall({ a: h('pass'), b: h('incomplete') }).status).toBe('incomplete');
    expect(overall({ a: h('pass'), b: h('harness_or_env') }).status).toBe('harness_or_env');
    expect(verdictFields('fail')).toEqual({ blocks_stable: true, tested: true, promotable: false });
    expect(verdictFields('pass')).toEqual({ blocks_stable: false, tested: true, promotable: true });
    expect(verdictFields('incomplete').blocks_stable).toBe(false);
    expect(verdictFields('skipped').tested).toBe(false);
  });
  test('the stable tag resolves to its version tag', () => {
    const ls = ['aaa\trefs/tags/v0.60.750.0', 'bbb\trefs/tags/v0.60.757.0', 'ccc\trefs/tags/stable', 'bbb\trefs/tags/stable^{}', 'bbb\trefs/tags/stable-v0.60.757.0'].join('\n');
    expect(stableRelease(ls)).toEqual({ commit: 'bbb', tag: 'v0.60.757.0' });
  });
});

const NOW = Date.parse('2026-11-22T12:00:00Z');
const rel = (tag: string, hoursAgo: number, asset = true, prerelease = true): Release => ({ tag, prerelease, published_at: new Date(NOW - hoursAgo * 3600e3).toISOString(), assets: asset ? ['gbrain-linux-x64'] : [] });
const line = (tag: string, status: IndexLine['status'], extra: Partial<IndexLine> = {}): IndexLine => ({ schema: SCHEMA, tag, channel: 'tag', run_id: 'r-' + tag + '-' + status, status, failed: [], blocks_stable: status === 'fail', tested: status !== 'skipped', promotable: status === 'pass', stable_channel: false, prerelease: true, commit: null, finished_at: '2026-11-22T00:00:00Z', result: null, reason: null, ...extra });

describe('selection', () => {
  test('newest first, at most four, older ones recorded as skipped', () => {
    const releases = ['v0.60.755.0', 'v0.60.756.0', 'v0.60.757.0', 'v0.60.758.0', 'v0.60.759.0', 'v0.60.760.0'].map((t, i) => rel(t, 10 - i));
    const p = selectJobs({ releases, index: [], stable: null, now: NOW });
    expect(p.jobs.map((j) => j.tag)).toEqual(['v0.60.760.0', 'v0.60.759.0', 'v0.60.758.0', 'v0.60.757.0']);
    expect(p.skipped.map((s) => s.tag)).toEqual(['v0.60.756.0', 'v0.60.755.0']);
  });
  test('the stable candidate is always tested, first, even past the cap', () => {
    const releases = ['v0.60.755.0', 'v0.60.756.0', 'v0.60.757.0', 'v0.60.758.0', 'v0.60.759.0'].map((t, i) => rel(t, 10 - i));
    const p = selectJobs({ releases, index: [], stable: null, now: NOW, candidate: 'v0.60.755.0' });
    expect(p.jobs[0]!.tag).toBe('v0.60.755.0');
    expect(p.jobs).toHaveLength(4);
    expect(p.skipped.map((s) => s.tag)).not.toContain('v0.60.755.0');
  });
  test('done tags are left out, incomplete ones retried three times', () => {
    const releases = [rel('v0.60.760.0', 5), rel('v0.60.761.0', 4), rel('v0.60.762.0', 3)];
    const index = [line('v0.60.760.0', 'pass'), line('v0.60.761.0', 'incomplete'), line('v0.60.762.0', 'incomplete', { run_id: 'a' }), line('v0.60.762.0', 'incomplete', { run_id: 'b' }), line('v0.60.762.0', 'incomplete', { run_id: 'c' })];
    expect(selectJobs({ releases, index, stable: null, now: NOW }).jobs.map((j) => j.tag)).toEqual(['v0.60.761.0']);
  });
  test('a release without its linux binary waits two hours, then runs', () => {
    expect(selectJobs({ releases: [rel('v0.60.762.0', 1, false)], index: [], stable: null, now: NOW }).deferred.map((d) => d.tag)).toEqual(['v0.60.762.0']);
    expect(selectJobs({ releases: [rel('v0.60.762.0', 3, false)], index: [], stable: null, now: NOW }).jobs.map((j) => j.tag)).toEqual(['v0.60.762.0']);
  });
  test('attribution goes to the last passing older tag; the stable job runs when the stable tag moves', () => {
    const p = selectJobs({ releases: [rel('v0.60.762.0', 3)], index: [line('v0.60.760.0', 'pass'), line('v0.60.761.0', 'fail')], stable: { tag: 'v0.60.757.0', commit: 'x' }, now: NOW });
    expect(p.jobs[0]!.args).toEqual(['--tag', 'v0.60.762.0', '--prerelease', 'true', '--attribute-to', 'v0.60.760.0']);
    expect(p.jobs[1]).toEqual({ id: 'stable-v0.60.757.0', tag: 'v0.60.757.0', channel: 'stable', args: ['--stable'] });
    const again = selectJobs({ releases: [], index: [line('v0.60.757.0', 'pass', { channel: 'stable', stable_channel: true })], stable: { tag: 'v0.60.757.0', commit: 'x' }, now: NOW });
    expect(again.jobs).toEqual([]);
  });
  test('version order is numeric', () => {
    expect(versionKey('v0.60.99.0') < versionKey('v0.60.100.0')).toBe(true);
  });
  test('a by-hand re-run of an older tag attributes to the last pass, even a newer one', () => {
    const p = selectJobs({ releases: [rel('v0.60.760.0', 30)], index: [line('v0.60.762.0', 'pass')], stable: null, now: NOW, only: ['v0.60.760.0'] });
    expect(p.jobs[0]!.args).toEqual(['--tag', 'v0.60.760.0', '--prerelease', 'true', '--attribute-to', 'v0.60.762.0']);
  });
  test('a failed release at or after the stable tag stays in latest.json until a later line for it passes', () => {
    const st = line('v0.60.757.0', 'pass', { channel: 'stable', stable_channel: true });
    const idx = [st, line('v0.60.758.0', 'fail'), line('v0.60.759.0', 'pass')];
    expect(latestOf(idx, [idx[2]!])?.tag).toBe('v0.60.758.0');
    const fixed = [...idx, line('v0.60.758.0', 'pass', { run_id: 'later' })];
    expect(latestOf(fixed, [fixed[3]!])?.tag).toBe('v0.60.759.0');
    const partial = [...idx, line('v0.60.758.0', 'pass', { run_id: 'subset', promotable: false })];
    expect(latestOf(partial, [partial[3]!])?.tag).toBe('v0.60.758.0');
    const broken = [...idx, line('v0.60.758.0', 'incomplete', { run_id: 'rerun' })];
    expect(latestOf(broken, [line('v0.60.760.0', 'pass')])?.tag).toBe('v0.60.758.0');
    const old = [st, line('v0.60.750.0', 'fail'), line('v0.60.759.0', 'pass')];
    expect(latestOf(old, [old[2]!])?.tag).toBe('v0.60.759.0');
  });
});

function result(tag: string, status: TagResult['status'], stable = false): TagResult {
  return { schema: SCHEMA, tag, commit: 'c0ffee', prerelease: true, stable_channel: stable, run_id: 'vm-side', harness_evals_commit: 'abc', started_at: '2026-11-22T00:00:00Z', finished_at: '2026-11-22T00:30:00Z', status,
    failed: status === 'fail' ? ['hermes/bun'] : [], ...verdictFields(status), doc_route: 'same', attribution: null, stable_version_mismatch: [],
    harnesses: { hermes: { status, version: '2026.9.24', guard_mode: 'x', route: [], steps: { bun: { status: status === 'fail' ? 'refused' : 'pass', command: 'curl -fsSL https://bun.sh/install | bash', guard: status === 'fail' ? { kind: 'tirith', message: 'BLOCKED: pipe to shell' } : null, gbrain_code: null, exit_code: null, evidence: '' } }, probe: null } } };
}
function setup(results: Record<string, TagResult | null>, jobs: string[], skipped: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), 'install-canary-'));
  const dest = join(root, 'dest');
  const res = join(root, 'res');
  for (const [id, r] of Object.entries(results)) if (r) { mkdirSync(join(res, id), { recursive: true }); writeFileSync(join(res, id, 'result.json'), JSON.stringify(r)); }
  const plan: Plan = { jobs: jobs.map((id) => ({ id, tag: id.replace(/^stable-/, ''), channel: id.startsWith('stable-') ? 'stable' : 'tag', args: ['--tag', id, '--prerelease', 'true'] })), skipped: skipped.map((tag) => ({ tag, prerelease: true, reason: 'older' })), deferred: [] };
  return { dest, res, plan };
}

describe('publish', () => {
  test('writes per-tag files, the index and latest.json, and is idempotent per run', () => {
    const { dest, res, plan } = setup({ 'v0.60.757.0': result('v0.60.757.0', 'pass') }, ['v0.60.757.0'], ['v0.60.750.0']);
    const a = publish(dest, plan, res, 'run1', null);
    expect(a.added.map((l) => [l.tag, l.status])).toEqual([['v0.60.757.0', 'pass'], ['v0.60.750.0', 'skipped']]);
    expect(existsSync(join(dest, 'runs/v0.60.757.0/result.json'))).toBe(true);
    expect(readFileSync(join(dest, 'runs/v0.60.757.0/summary.md'), 'utf8')).toContain('**PASS**');
    expect(JSON.parse(readFileSync(join(dest, 'latest.json'), 'utf8')).tag).toBe('v0.60.757.0');
    expect(JSON.parse(readFileSync(join(dest, 'runs/v0.60.757.0/result.json'), 'utf8')).run_id).toBe('run1');
    const b = publish(dest, plan, res, 'run1', null);
    expect(b.added).toEqual([]);
    expect(readIndex(dest)).toHaveLength(2);
  });
  test('a fail is latest.json and is notified, with the guard in the summary', () => {
    const { dest, res, plan } = setup({ 'v0.60.734.0': result('v0.60.734.0', 'fail'), 'v0.60.757.0': result('v0.60.757.0', 'pass') }, ['v0.60.757.0', 'v0.60.734.0']);
    const r = publish(dest, plan, res, 'run1', null);
    expect(r.latest?.tag).toBe('v0.60.734.0');
    expect(r.latest?.blocks_stable).toBe(true);
    expect(r.notify.map((l) => l.tag)).toEqual(['v0.60.734.0']);
    expect(readFileSync(join(dest, 'runs/v0.60.734.0/summary.md'), 'utf8')).toContain('BLOCKED: pipe to shell');
  });
  test('a job with no result is incomplete with the VM error, and notified only the second time in a row', () => {
    const { dest, res, plan } = setup({}, ['v0.60.762.0']);
    const a = publish(dest, plan, res, 'run1', 'CANARY_VM');
    expect(a.added[0]!.status).toBe('incomplete');
    expect(a.added[0]!.reason).toStartWith('CANARY_VM:');
    expect(a.notify).toEqual([]);
    expect(publish(dest, plan, res, 'run2', 'CANARY_VM').notify.map((l) => l.tag)).toEqual(['v0.60.762.0']);
  });
  test('latest.json is the newest tag line when the run is all pass, whatever order lines landed in', () => {
    const idx = [line('v0.60.761.0', 'pass'), line('v0.60.760.0', 'pass')];
    expect(latestOf(idx, [idx[1]!])?.tag).toBe('v0.60.761.0');
    expect(notifications([], [line('x', 'harness_or_env')])).toHaveLength(1);
  });
  test('a stable job publishes under the tag it actually tested, and a partial or mismatched run says why', () => {
    const { dest, res, plan } = setup({ 'stable-v0.60.757.0': { ...result('v0.60.759.0', 'pass', true), stable_version_mismatch: [{ harness: 'hermes', expected: '0.60.759.0', seen: '0.60.757.0' }] } }, ['stable-v0.60.757.0']);
    const r = publish(dest, plan, res, 'run1', null);
    expect(r.added[0]!.result).toBe('runs/stable-v0.60.759.0/result.json');
    expect(existsSync(join(dest, 'runs/stable-v0.60.759.0/summary.md'))).toBe(true);
    expect(r.added[0]!.reason).toContain('hermes 0.60.757.0 instead of 0.60.759.0');
    expect(resultReason(result('v0.60.759.0', 'pass'))).toContain('only hermes ran');
  });
  test('the lock refuses a second run until it expires, and only its owner drops it', () => {
    const dest = mkdtempSync(join(tmpdir(), 'install-canary-lock-'));
    expect(takeLock(dest, 'a', 60, NOW).ok).toBe(true);
    expect(takeLock(dest, 'b', 60, NOW + 1000).ok).toBe(false);
    expect(dropLock(dest, 'b')).toBe(false);
    expect(takeLock(dest, 'b', 60, NOW + 61 * 60000).ok).toBe(true);
    expect(dropLock(dest, 'b')).toBe(true);
  });
});

describe('scripted model', () => {
  const L = (command: string, step: 'bun' | 'binary' | 'setup' = 'bun') => ({ part: 'p', selector: 's', step, doc_line: command, command });
  test("Hermes's block (exit_code -1, status blocked) is a refusal with the guard's words", () => {
    const out = JSON.stringify({ output: '', exit_code: -1, error: 'BLOCKED: Command flagged as dangerous (pipe remote content to shell) but single-query mode (-q) runs without a user present to approve it.', status: 'blocked' });
    const c = classifyLine(out, false);
    expect(c.status).toBe('refused');
    expect(c.guard).toStartWith('BLOCKED: Command flagged as dangerous');
  });
  test("gbrain's error code is read from its JSON or its Error [code] line", () => {
    expect(gbrainCode('{"error":"x","code":"invalid_params"}')).toBe('invalid_params');
    expect(gbrainCode('Error [turn_hook_not_loaded]: The per-turn gbrain hook for hermes is not active')).toBe('turn_hook_not_loaded');
    expect(gbrainCode('all good')).toBeNull();
  });
  test("refusal words deep in a command's own output don't count", () => {
    expect(classifyLine('{"status":"healthy",' + 'x'.repeat(3000) + '"note":"blocked by nothing"}', false).status).toBe('unknown');
  });
  test('earlier export lines are carried into later commands, the doc line itself is unchanged', () => {
    const lines = [L('curl -fsSL https://bun.sh/install | bash'), L('export PATH="$HOME/.bun/bin:$PATH"'), L('bun install -g github:garrytan/gbrain#v1', 'binary')];
    expect(lineCommand(lines, 0)).toBe(lines[0]!.command);
    expect(lineCommand(lines, 2)).toBe('export PATH="$HOME/.bun/bin:$PATH" && bun install -g github:garrytan/gbrain#v1');
  });
  test('remember carries a provenance, and any other required string', () => {
    expect(mcpArgs('remember', { properties: { fact: { type: 'string' }, provenance: { type: 'string' } }, required: ['fact', 'provenance'] }, 'cat is Zed')).toEqual({ fact: 'cat is Zed', provenance: PROVENANCE });
    expect(mcpArgs('remember', null, 'cat is Zed')).toEqual({ fact: 'cat is Zed', provenance: PROVENANCE });
    expect(mcpArgs('recall', { properties: { query: { type: 'string' } } }, 'cat')).toEqual({ query: 'cat' });
  });
  test('a tool search result yields the gbrain id for each verb', () => {
    const t = '[{"id":"mcp:gbrain:gbrain__remember","score":1},{"id":"mcp:gbrain:gbrain__recall"}]';
    expect(foundId(t, 'remember')).toBe('mcp:gbrain:gbrain__remember');
    expect(foundId(t, 'recall')).toBe('mcp:gbrain:gbrain__recall');
    expect(foundId('nothing here', 'recall')).toBeNull();
  });
  test("Hermes's tool_search gets its queries array, and tool_call then names the tool it returned", () => {
    const fn = (name: string, parameters: unknown) => ({ type: 'function', function: { name, parameters } });
    const body = { tools: [
      fn('tool_search', { type: 'object', properties: { queries: { type: 'array', items: { type: 'string' } } }, required: ['queries'] }),
      fn('tool_call', { type: 'object', properties: { calls: { type: 'array' } }, required: ['calls'] }),
    ] };
    const state = newFakeState([]);
    expect(mcpCall('remember', body, state, 'cat is Zed', 'save').call?.args).toEqual({ queries: ['gbrain remember'] });
    state.found.remember = foundId('{"results":[{"query":"gbrain remember","matches":["mcp__gbrain__forget","mcp__gbrain__remember"]}]}', 'remember')!;
    const next = mcpCall('remember', body, state, 'cat is Zed', 'save');
    expect(next.via).toBe('tool_call');
    expect(next.call?.args).toEqual({ calls: [{ name: 'mcp__gbrain__remember', arguments: { fact: 'cat is Zed', provenance: PROVENANCE } }] });
  });
  test('gbrain error envelopes are errors', () => {
    expect(MCP_ERROR.test('{ "error": "invalid_params", "message": "Missing required parameter: provenance" }')).toBe(true);
    expect(MCP_ERROR.test('{"facts":[{"fact":"cat is Zed"}],"total":1}')).toBe(false);
  });
});


describe('shell scripts', () => {
  const ROOT = resolve(import.meta.dir, '..');
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: tmpdir() };
  for (const f of ['scripts/install-canary/run.sh', 'scripts/install-canary/vm.sh']) {
    test(f + ' parses', () => {
      expect(spawnSync('bash', ['-n', join(ROOT, f)], { env }).status).toBe(0);
    });
  }
  test('scripts/install-canary/run.sh refuses an unknown argument before it touches anything', () => {
    const r = spawnSync('bash', [join(ROOT, 'scripts/install-canary/run.sh'), '--bogus'], { env, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('unknown argument --bogus');
  });
  test('scripts/install-canary/run.sh puts request.args back when it stops before publishing, and leaves a bad one alone', () => {
    for (const body of ['--max 2\n', '--bogus\n']) {
      const dest = mkdtempSync(join(tmpdir(), 'install-canary-req-'));
      writeFileSync(join(dest, 'request.args'), body);
      spawnSync('bash', [join(ROOT, 'scripts/install-canary/run.sh'), '--dest', dest], { env: { PATH: '/usr/bin:/bin', HOME: dest }, encoding: 'utf8' });
      expect(readFileSync(join(dest, 'request.args'), 'utf8')).toBe(body);
    }
  });
  test('scripts/install-canary/run.sh keeps a claimed request ahead of one written during the run, and later lines in order', () => {
    const dest = mkdtempSync(join(tmpdir(), 'install-canary-req-'));
    const bin = join(dest, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'bun'), '#!/bin/sh\necho "--tag v0.60.770.0" > "' + join(dest, 'request.args') + '"\nexit 1\n', { mode: 0o755 });
    for (const [body, want] of [['--max 2\n--max 3\n', '--max 2\n--max 3\n'], ['--candidate v0.60.769.0', '--candidate v0.60.769.0\n']]) {
      writeFileSync(join(dest, 'request.args'), body);
      const r = spawnSync('bash', [join(ROOT, 'scripts/install-canary/run.sh'), '--dest', dest], { env: { PATH: bin + ':/usr/bin:/bin', HOME: dest }, encoding: 'utf8' });
      expect(r.status).toBe(4);
      expect(readFileSync(join(dest, 'request.args'), 'utf8')).toBe(want + '--tag v0.60.770.0\n');
    }
  });
});

