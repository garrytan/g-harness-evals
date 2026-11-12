// internal-task QM skill-resolver arms, adapter side (harnesses/qm/skill-resolver.mjs), keyless: no docker, no network, no key.
// The resolver is the shared stand-in (scripts/skill-resolver/gbrain-stub.ts, the binary the arm images carry compiled) run by
// bun behind a wrapper that records its argv, with an index of a small fixture catalog built the way Dockerfile.arms builds
// the image's. The module's own CLI runs as adapter.sh runs it. Covers the hook wrapper's command line and input (the
// message is instruction.md byte for byte, no previous_user_message), the status line under the hook wrapper's field names
// read through RESULT_FIELDS, the native arm's shadow call, the emulated hook's prepend, no_skill and the spent budget (not
// INFRA), the absorbed failures, and the INFRA causes with the trial's marker; then the pull arm's lines from a stored session.
import { describe, expect, test } from 'bun:test';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
// @ts-expect-error plain ESM module without type declarations, run by node in the task container
import { pullEntries, pushText, resolveArgv, splitExecuteResult, statusLine } from '../harnesses/qm/skill-resolver.mjs';
import { normalizeReceipt } from '../scripts/skill-resolver/result-fields.ts';

const ROOT = resolve(import.meta.dir, '..');
const CLI = join(ROOT, 'harnesses/qm/skill-resolver.mjs');
const STUB = join(ROOT, 'scripts/skill-resolver/gbrain-stub.ts');
const BUN = process.execPath;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const TEXT = "Before I run rm -rf on the old build directory, is there a skill for doing that safely? It's Dana's repo.";
const SKILLS: Record<string, string> = {
  careful: 'Run destructive commands safely, such as rm -rf on a build directory.',
  freeze: 'Limit edits to one directory.',
  'git-workflow': 'Rebase branches and resolve merge conflicts in git.',
  pdf: 'Read, merge and split PDF files.',
};
const STATUS_FIELDS = ['name', 'turn', 'session_key', 'harness', 'arm', 'mode', 'code', 'exit', 'timing_ms', 'wall_ms', 'index_stale', 'index_hash', 'gbrain_version', 'catalog_hash',
  'block_sha256', 'block_bytes', 'block_tokens', 'suggestions', 'deduped', 'no_skill', 'no_skill_reason', 'budget_exhausted', 'session_block_tokens', 'k', 'block_reason', 'budget_phase',
  'injected', 'repeat', 'infra', 'infra_reasons', 'argv', 'autorebuild_off', 'error', 'trial', 'call', 'label', 'at'];

/** The image's index home: the fixture catalog and its index, built by the stand-in as Dockerfile.arms builds it. */
function indexHome(dir: string) {
  for (const [name, d] of Object.entries(SKILLS)) {
    mkdirSync(join(dir, 'skills', name), { recursive: true });
    writeFileSync(join(dir, 'skills', name, 'SKILL.md'), '---\nname: ' + name + '\ndescription: ' + d + '\n---\n\nBody of ' + name + '.\n');
  }
  const home = join(dir, 'gbrain-home');
  const r = spawnSync(BUN, [STUB, 'skills', 'index', 'build', '--catalog', 'he-skills', '--dir', join(dir, 'skills'), '--harness', 'qm', '--json'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, GBRAIN_HOME: home } });
  if (r.status !== 0) throw new Error('index build failed: ' + r.stderr);
  return home;
}
const SHARED = mkdtempSync(join(tmpdir(), 'he-qm-skill-index-'));
const HOME_SRC = indexHome(SHARED);
const RAW_RECEIPT = JSON.parse(readFileSync(join(HOME_SRC, '.gbrain', 'skill-index', 'he-skills', 'receipt.json'), 'utf8')) as { catalog: Record<string, unknown>; index: Record<string, unknown> };
const RECEIPT = normalizeReceipt(RAW_RECEIPT) as { catalog_hash: string; index_hash: string; gbrain_version: string };

/** A trial dir with instruction.md and a resolver: the stand-in behind a wrapper that records its argv and whether the
 *  rebuild switch is set, or a shell body given instead. o.home picks another index home; o.receipt another receipt. */
function trial(o: { text?: string; receipt?: Record<string, unknown> | null; body?: string; home?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'he-qm-skill-'));
  writeFileSync(join(dir, 'instruction.md'), o.text ?? TEXT);
  if (o.receipt !== undefined && o.receipt !== null) writeFileSync(join(dir, 'receipt.json'), JSON.stringify(o.receipt));
  const bin = join(dir, 'gbrain');
  writeFileSync(bin, o.body ?? '#!/bin/sh\nprintf "%s\\n" "$*" >> "$(dirname "$0")/argv.log"\n[ "$GBRAIN_SKILLS_NO_AUTOREBUILD" = 1 ] && echo set >> "$(dirname "$0")/switch.log"\nexec ' + BUN + ' ' + STUB + ' "$@"\n');
  chmodSync(bin, 0o755);
  mkdirSync(join(dir, 'state'));
  return { dir, home: o.home ?? HOME_SRC, receipt: o.receipt === undefined ? null : o.receipt === null ? join(dir, 'no-receipt.json') : join(dir, 'receipt.json') };
}
type Trial = ReturnType<typeof trial>;
function run(t: Trial, call: 'shadow' | 'push', extraEnv: Record<string, string> = {}) {
  const r = spawnSync('node', [CLI, 'turn', call, join(t.dir, 'instruction.md'), join(t.dir, 'turn.md'), t.dir, 'qm-skill-test'], { encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(t.dir, 'state'), HE_TRIAL_ID: 'qm-skill-test', HE_HARNESS_CONFIG: 'pi-skills-' + (call === 'shadow' ? 'native' : 'push'), QM_SKILL_RESOLVER_BIN: join(t.dir, 'gbrain'), QM_SKILL_GBRAIN_HOME: t.home, ...(t.receipt ? { QM_SKILL_RECEIPT: t.receipt } : {}), ...extraEnv } });
  const read = (f: string) => existsSync(join(t.dir, 'skill-resolver', f)) ? readFileSync(join(t.dir, 'skill-resolver', f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  const marker = existsSync(join(t.dir, 'skill-resolver', 'infra.json')) ? JSON.parse(readFileSync(join(t.dir, 'skill-resolver', 'infra.json'), 'utf8')) : null;
  return { status: r.status, stderr: r.stderr, text: readFileSync(join(t.dir, 'turn.md'), 'utf8'), lines: read('status.ndjson'), results: read('results.ndjson'), marker,
    argv: existsSync(join(t.dir, 'argv.log')) ? readFileSync(join(t.dir, 'argv.log'), 'utf8').trim() : null, switchSet: existsSync(join(t.dir, 'switch.log')) };
}
const flags = (catalog: string, shadow: boolean, dir = '') => 'skills resolve --catalog he-skills --input-json - --json --session qm-skill-test --harness qm --top-k 5' + (shadow ? ' --shadow --shadow-log ' + join(dir, 'skill-resolver', 'shadow.ndjson') : '') + ' --fail-open --expect-catalog ' + catalog;

describe('native arm: the resolver in shadow injects nothing', () => {
  test("the hook wrapper's command line and input, the member text as the message; the turn text unchanged; every status field", () => {
    const t = trial();
    const r = run(t, 'shadow');
    expect(r.status).toBe(0);
    expect(r.argv).toBe(flags(RECEIPT.catalog_hash, true, t.dir));
    expect(resolveArgv('gbrain', 's', 'h', true, 'log')).toEqual(['gbrain', 'skills', 'resolve', '--catalog', 'he-skills', '--input-json', '-', '--json', '--session', 's', '--harness', 'qm', '--top-k', '5', '--shadow', '--shadow-log', 'log', '--fail-open', '--expect-catalog', 'h']);
    expect(r.switchSet).toBe(true);
    expect(r.text).toBe(TEXT);
    expect(r.results).toHaveLength(1);
    expect(r.results[0].input).toEqual({ message: TEXT, session_id: 'qm-skill-test', harness: 'qm', top_k: 5, exclude: [], shadow: true });
    const block = r.results[0].fields.block as string;
    expect(block).toStartWith('Skills that may fit this request (gbrain skills resolve):\n- careful: ');
    expect(block).toEndWith('To open one: skills action read.');
    expect(r.lines).toHaveLength(1);
    const l = r.lines[0];
    expect(Object.keys(l)).toEqual(STATUS_FIELDS);
    expect(l).toMatchObject({ name: 'run', turn: 1, session_key: 'qm-skill-test', harness: 'qm', arm: 'pi-skills-native', mode: 'shadow', code: 'OK', exit: 0, index_stale: false,
      index_hash: RECEIPT.index_hash, gbrain_version: RECEIPT.gbrain_version, catalog_hash: RECEIPT.catalog_hash, block_sha256: sha256(block), block_bytes: Buffer.byteLength(block),
      block_tokens: Math.ceil(Buffer.byteLength(block) / 4), no_skill: false, no_skill_reason: null, budget_exhausted: false, k: 5, block_reason: 'match', budget_phase: 'under_half',
      injected: false, repeat: false, infra: false, infra_reasons: [], autorebuild_off: true, error: null, trial: 'qm-skill-test', call: 'shadow', label: 'native (resolver in shadow)' });
    expect(l.session_block_tokens).toBe(l.block_tokens);
    expect(l.suggestions[0]).toBe('careful');
    expect(l.argv).toEqual([join(t.dir, 'gbrain'), ...flags(RECEIPT.catalog_hash, true, t.dir).split(' ')]);
    expect(r.marker).toBeNull();
  });

  test('a second call in the same trial is turn 2, and session-wide dedupe empties its block', () => {
    const t = trial();
    run(t, 'shadow');
    const r = run(t, 'shadow');
    expect(r.lines.map((l) => l.turn)).toEqual([1, 2]);
    expect(r.lines[1]).toMatchObject({ code: 'EMPTY', block_reason: 'deduped', block_sha256: null, suggestions: [] });
    expect(r.lines[1].deduped).toContain('careful');
  });
});

describe('emulated hook: the block is prepended to the turn text', () => {
  test('block, one blank line, then the instruction byte for byte', () => {
    const r = run(trial(), 'push');
    expect(r.argv).toBe(flags(RECEIPT.catalog_hash, false));
    const block = r.results[0].fields.block as string;
    expect(r.text).toBe(block + '\n\n' + TEXT);
    expect(pushText(block, TEXT)).toBe(r.text);
    expect(r.results[0].input.shadow).toBe(false);
    expect(r.lines[0]).toMatchObject({ mode: 'push', call: 'push', label: 'emulated hook', code: 'OK', injected: true, block_sha256: sha256(block), infra: false });
  });

  test('no_skill comes only with a reason (ack or no_match); the text is unchanged and it is not INFRA', () => {
    for (const [text, reason] of [['ok thanks', 'ack'], ['Paint a picture of the sunset.', 'no_match']]) {
      const r = run(trial({ text }), 'push');
      expect(r.text).toBe(text);
      expect(r.lines[0]).toMatchObject({ code: 'NO_SKILL', no_skill: true, no_skill_reason: reason, block_reason: reason, budget_phase: 'under_half', budget_exhausted: false, injected: false, block_sha256: null, infra: false });
      expect(r.marker).toBeNull();
    }
  });

  test("a spent session block budget (the stand-in's switch) is an empty block, BUDGET_EXHAUSTED, and not INFRA", () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-qm-skill-budget-'));
    const home = indexHome(dir);
    writeFileSync(join(home, 'stub-budget-exhausted'), '');
    for (const call of ['push', 'shadow'] as const) {
      const r = run(trial({ home }), call);
      expect(r.text).toBe(TEXT);
      expect(r.lines[0]).toMatchObject({ code: 'BUDGET_EXHAUSTED', no_skill: false, no_skill_reason: null, budget_exhausted: true, budget_phase: 'exhausted', block_reason: 'budget_exhausted', block_sha256: null, injected: false, infra: false });
      expect(r.marker).toBeNull();
    }
  });

  test('a fail-open runtime error is an empty block and the text unchanged; its null index_hash reads as INFRA, as in the hook wrapper', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-qm-skill-fail-'));
    const home = indexHome(dir);
    writeFileSync(join(home, 'stub-fail'), 'INDEX_MISSING');
    const r = run(trial({ home }), 'push');
    expect(r.text).toBe(TEXT);
    expect(r.lines[0]).toMatchObject({ code: 'INDEX_MISSING', exit: 0, injected: false, block_sha256: null, block_reason: 'error', infra: true, infra_reasons: ['INDEX_HASH_DIFFERS'] });
  });
});

describe('every resolver failure is absorbed: exit 0, empty block, the code logged', () => {
  const cases: Array<[string, string, Record<string, string>]> = [
    ['EXIT_2', '#!/bin/sh\necho "usage" >&2\nexit 2\n', {}],
    ['EXIT_1', '#!/bin/sh\nexit 1\n', {}],
    ['BAD_JSON', '#!/bin/sh\necho not-json\n', {}],
    ['BAD_JSON', '#!/bin/sh\nexit 0\n', {}],
    ['BAD_SCHEMA', '#!/bin/sh\necho \'{"schema_version":2,"block":"x"}\'\n', {}],
    ['WRAPPER_TIMEOUT', '#!/bin/sh\nsleep 5\n', { QM_SKILL_RESOLVER_TIMEOUT_MS: '300' }],
  ];
  for (const [code, body, env] of cases) test(code + ' ' + JSON.stringify(body.split('\n')[1]), () => {
    const r = run(trial({ body }), 'push', env);
    expect(r.status).toBe(0);
    expect(r.text).toBe(TEXT);
    expect(r.lines[0]).toMatchObject({ code, injected: false, block_sha256: null, index_hash: null, suggestions: [] });
  });

  test('a missing resolver binary and an unreadable receipt', () => {
    const missing = run(trial(), 'push', { QM_SKILL_RESOLVER_BIN: '/nonexistent/gbrain' });
    expect(missing.lines[0]).toMatchObject({ code: 'SPAWN_FAILED', injected: false });
    const noReceipt = run(trial({ receipt: null }), 'push');
    expect(noReceipt.argv).toBeNull();
    expect(noReceipt.text).toBe(TEXT);
    expect(noReceipt.lines[0]).toMatchObject({ code: 'RECEIPT_UNREADABLE', infra: true, infra_reasons: ['RECEIPT_UNREADABLE'] });
    expect(noReceipt.marker).toMatchObject({ infra: true, reasons: ['RECEIPT_UNREADABLE'] });
  });
});

describe('INFRA: the trial is marked, intention-to-treat (the turn still runs)', () => {
  test('index_stale: a catalog file changed after the index was built', () => {
    const dir = mkdtempSync(join(tmpdir(), 'he-qm-skill-stale-'));
    const home = indexHome(dir);
    writeFileSync(join(dir, 'skills', 'pdf', 'SKILL.md'), readFileSync(join(dir, 'skills', 'pdf', 'SKILL.md'), 'utf8') + '\n');
    const r = run(trial({ home }), 'shadow');
    expect(r.lines[0]).toMatchObject({ code: 'OK', index_stale: true, infra: true, infra_reasons: ['INDEX_STALE'] });
    expect(r.marker).toMatchObject({ schema: 'he-skill-resolver-infra/1', trial: 'qm-skill-test', infra: true, reasons: ['INDEX_STALE'], turns: [{ turn: 1, call: 'shadow', code: 'OK', infra_reasons: ['INDEX_STALE'] }] });
  });

  test('index_hash and gbrain_version that differ from the build receipt (a mid-run gbrain upgrade)', () => {
    const r = run(trial({ receipt: { ...RAW_RECEIPT, index: { ...RAW_RECEIPT.index, index_hash: 'from-another-build' }, gbrain_version: 'gbrain 9.9.9' } }), 'push');
    expect(r.lines[0]).toMatchObject({ code: 'OK', injected: true, infra: true, infra_reasons: ['INDEX_HASH_DIFFERS', 'GBRAIN_VERSION_DIFFERS'] });
    expect(r.marker.reasons).toEqual(['GBRAIN_VERSION_DIFFERS', 'INDEX_HASH_DIFFERS']);
  });

  test('CATALOG_MISMATCH: the receipt pins another catalog, so --expect-catalog fails and the block is empty', () => {
    const r = run(trial({ receipt: { ...RAW_RECEIPT, catalog: { ...RAW_RECEIPT.catalog, catalog_hash: 'f'.repeat(64) } } }), 'push');
    expect(r.argv).toBe(flags('f'.repeat(64), false));
    expect(r.text).toBe(TEXT);
    expect(r.lines[0]).toMatchObject({ code: 'CATALOG_MISMATCH', exit: 0, injected: false, infra: true });
    expect(r.lines[0].infra_reasons).toContain('CATALOG_MISMATCH');
    expect(r.marker.reasons).toContain('CATALOG_MISMATCH');
  });

  test('statusLine as a pure function: no receipt is INFRA; a result under another field name goes through RESULT_FIELDS (block_reason is derived from the block, never read)', () => {
    expect(statusLine({ result: { schema_version: 1, no_skill: true, no_skill_reason: 'ack', block: '' }, receipt: null, call: 'push', turn: 1, trial: 't' })).toMatchObject({ code: 'NO_SKILL', infra: true, infra_reasons: ['RECEIPT_UNREADABLE'] });
    const old = statusLine({ result: { schema_version: 1, block: 'b', reason: 'trigger', meta: { index_stale: false } }, receipt: RECEIPT, call: 'push', turn: 1, trial: 't' });
    expect(old.block_reason).toBe('match');
    expect('reason' in old).toBe(false);
  });
});

describe('pull arm: status lines from the stored QM session', () => {
  const copyHome = () => { const h = join(mkdtempSync(join(tmpdir(), 'he-qm-pull-')), 'h'); cpSync(HOME_SRC, h, { recursive: true }); return h; };
  const answer = spawnSync(BUN, [STUB, 'skills', 'resolve', '--catalog', 'he-skills', '--input-json', '-', '--json', '--harness', 'qm', '--fail-open', '--expect-catalog', RECEIPT.catalog_hash],
    { input: JSON.stringify({ message: TEXT, session_id: 'dm:U1:pull', harness: 'qm', top_k: 5 }), encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: SHARED, GBRAIN_HOME: copyHome() } });
  const stdout = answer.stdout;

  test('QM appends [exit N] to an execute answer', () => {
    expect(splitExecuteResult(stdout + '\n[exit 0]\n')).toEqual({ stdout, exit: 0 });
    expect(splitExecuteResult('plain')).toEqual({ stdout: 'plain', exit: null });
  });

  test('one line per resolve-skills call, from session items or entries, checked against the receipt', () => {
    const json = JSON.parse(stdout);
    const items = { items: [
      { seq: 1, kind: 'ToolCall', tool: 'execute', callId: 'c1', body: { command: "resolve-skills <<'JSON'\n{}\nJSON" } },
      { seq: 2, kind: 'ToolResult', tool: 'execute', callId: 'c1', code: 0, text: stdout + '\n[exit 0]\n' },
      { seq: 3, kind: 'ToolCall', tool: 'execute', callId: 'c2', body: { command: 'ls' } },
    ] };
    const lines = pullEntries(items, { receipt: RECEIPT, trial: 't', at: 'x' }).map((e: { line: Record<string, unknown> }) => e.line);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ call: 'pull', mode: 'pull', label: 'pull via sandbox tool (QM refuses private-address MCP)', turn: 1, code: 'OK', exit: 0, index_hash: RECEIPT.index_hash, block_sha256: sha256(json.block), k: 5, block_reason: 'match', budget_phase: 'under_half', budget_exhausted: false, no_skill_reason: null, injected: false, infra: false, stdout_sha256: sha256(stdout) });
    const entries = { entries: [
      { seq: 1, type: 'tool_call', payload: { tool: 'execute', callId: 'c1', wire: { argumentsJson: JSON.stringify({ command: "resolve-skills <<'JSON'\n{}\nJSON" }) } } },
      { seq: 2, type: 'tool_result', payload: { tool: 'execute', callId: 'c1', code: 0, result: stdout.replace(RECEIPT.index_hash, 'f'.repeat(64)) + '\n[exit 0]\n' } },
    ] };
    const drifted = pullEntries(entries, { receipt: RECEIPT, trial: 't' }).map((e: { line: Record<string, unknown> }) => e.line);
    expect(drifted[0]).toMatchObject({ code: 'OK', exit: 0, index_hash: 'f'.repeat(64), infra: true, infra_reasons: ['INDEX_HASH_DIFFERS'] });
  });

  test('a call by the installed path (/usr/local/bin/resolve-skills, ./resolve-skills) gets its line too', () => {
    const call = (id: string, command: string) => [{ seq: 1, kind: 'ToolCall', tool: 'execute', callId: id, body: { command } }, { seq: 2, kind: 'ToolResult', tool: 'execute', callId: id, code: 0, text: stdout + '\n[exit 0]\n' }];
    const items = { items: [...call('a', "/usr/local/bin/resolve-skills <<'JSON'\n{}\nJSON"), ...call('b', 'cd /tmp && ./resolve-skills < in.json'), ...call('c', 'ls /usr/local/bin')] };
    const lines = pullEntries(items, { receipt: RECEIPT, trial: 't' }).map((e: { line: Record<string, unknown> }) => e.line);
    expect(lines.map((l: Record<string, unknown>) => [l.turn, l.code])).toEqual([[1, 'OK'], [2, 'OK']]);
  });
});
