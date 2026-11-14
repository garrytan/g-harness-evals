// Exposure reader (scripts/review-bugs/exposure.ts) on the fixtures in tests/fixtures/review-bugs/exposure/ (see the
// README there for where each case came from): the four signals per harness, a missing expected reader, a reader
// dispatched but not returned, a refused dispatch, the small-diff case where gstack's depth rule names no readers, strict
// beside the gate, every gap code, the TSV and JSON output and the CLI exit codes. Keyless; no docker.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADVERSARIAL, EXIT, GAP_CODES, assess, exposureRow, loadReaderMap, main, readSession, readersOf, totals, ExposureGap, type GapCode, type Harness, type ReaderMap } from '../../scripts/review-bugs/exposure.ts';
import { FIXTURES, materialize } from '../fixtures/review-bugs/exposure/materialize.ts';

const ROOT = join(import.meta.dir, '..', '..');
const loaded = loadReaderMap(join(FIXTURES, 'reader-map.json'));
if ('problem' in loaded) throw new Error(loaded.problem);
const MAP: ReaderMap = loaded.map;
const read = (h: Harness, c: string) => readSession(h, materialize(h, c));
const gapOf = (h: Harness, c: string) => { try { read(h, c); return null; } catch (e) { if (e instanceof ExposureGap) return e.code; throw e; } };

describe('known-good session per harness', () => {
  const cases: Array<[Harness, string, string[], string]> = [
    ['claude-code', 'good', ['testing', 'security', ADVERSARIAL], 'pass'],
    ['codex', 'good', ['testing', ADVERSARIAL], 'pass'],
    ['hermes', 'oneshot-good', ['testing', ADVERSARIAL], 'pass'],
    ['hermes', 'chat-good', ['testing', ADVERSARIAL], 'pass'],
    ['openclaw', 'good', ['testing'], 'fail (no adversarial reader)'],
  ];
  for (const [h, c, expected, strict] of cases) test(h + ' ' + c + ': all four signals, gate pass', () => {
    const a = assess(read(h, c), MAP, expected);
    expect(a.skill_opened).toBe(true);
    expect(a.army_dispatched).toBe(true);
    expect(a.adv_dispatched).toBe(expected.includes(ADVERSARIAL));
    expect(a.all_returned).toBe(true);
    expect(a.returned).toEqual([...expected].sort());
    expect(a.expected_missing).toEqual([]);
    expect(a.gate).toBe('pass');
    expect(a.strict).toBe(strict);
  });
  test('the locators name the rows the signals rest on', () => {
    const he = read('hermes', 'chat-good');
    expect(he.skill.how).toBe('skill_view gstack-review');
    expect(he.launches.map(l => l.note)).toEqual(['async_delegation_complete at id 11 (deleg_c26ae9ef)', 'async_delegation_complete at id 11 (deleg_c26ae9ef)']);
    const cx = read('codex', 'good');
    expect(cx.launches.map(l => /FINAL_ANSWER from (\S+)/.exec(l.note)?.[1])).toEqual(['/root/testing_reader', '/root/adversarial_reader']);
    expect(read('openclaw', 'good').skill.how).toBe('read /harness-state/openclaw/skills/gstack/skills/gstack-review/SKILL.md');
  });
});

describe('known-bad sessions', () => {
  test('skill not opened: Claude Code with no skill, OpenClaw reading only the stub', () => {
    expect(assess(read('claude-code', 'no-skill'), MAP, []).gate).toBe('fail (skill not opened)');
    const stub = assess(read('openclaw', 'stub-only'), MAP, []);
    expect(stub.skill_opened).toBe(false);
    expect(stub.gate).toBe('fail (skill not opened)');
  });
  test('an expected reader never dispatched: Review Army only, no adversarial reader', () => {
    const a = assess(read('claude-code', 'missing-adversarial'), MAP, ['testing', 'security', ADVERSARIAL]);
    expect([a.army_dispatched, a.adv_dispatched, a.all_returned]).toEqual([true, false, true]);
    expect(a.expected_missing).toEqual([ADVERSARIAL + ' (not dispatched)']);
    expect(a.gate).toBe('fail (missing adversarial-native (not dispatched))');
    expect(a.strict).toBe('fail (no adversarial reader)');
  });
  const notReturned: Array<[Harness, string, string[], string]> = [
    ['claude-code', 'not-returned', ['testing', 'security', ADVERSARIAL], 'task_notification completed at line 14, after the final result at line 13'],
    ['codex', 'not-returned', ['testing'], 'no FINAL_ANSWER from /root/testing_reader before task_complete'],
    ['hermes', 'chat-not-returned', ['testing'], 'dispatched deleg_90301aff, no async_delegation_complete row before the session ended'],
    ['openclaw', 'run-failed', ['testing'], 'run failed: published reply runtime missing for main'],
  ];
  for (const [h, c, expected, note] of notReturned) test(h + ' ' + c + ': dispatched, started, not returned', () => {
    const s = read(h, c);
    const a = assess(s, MAP, expected);
    expect(a.all_returned).toBe(false);
    expect(a.not_returned).toContain('testing');
    expect(a.expected_missing).toContain('testing (not returned)');
    expect(a.gate.startsWith('fail (')).toBe(true);
    expect(a.strict).toContain('not every reader returned');
    expect(s.launches.some(l => l.started && !l.returned && l.note === note)).toBe(true);
  });
  test('refused dispatches cover no reader: OpenClaw spawn error, Hermes one-shot delegation budget', () => {
    const oc = assess(read('openclaw', 'spawn-refused'), MAP, ['testing', ADVERSARIAL]);
    expect([oc.refused, oc.dispatched.length]).toEqual([2, 0]);
    expect(oc.gate).toBe('fail (missing testing (not dispatched), adversarial-native (not dispatched))');
    const he = read('hermes', 'oneshot-budget-refused');
    expect(he.launches.map(l => [l.started, l.returned])).toEqual([[false, false], [false, false]]);
    expect(he.launches[0].refused).toStartWith('Delegation budget for this one-shot run is exhausted');
    expect(assess(he, MAP, ['testing']).gate).toBe('fail (missing testing (not dispatched))');
  });
});

describe('small diff: the depth rule names no readers', () => {
  for (const [h, c] of [['hermes', 'small-diff'], ['openclaw', 'spawn-refused']] as Array<[Harness, string]>) test(h + ' ' + c + ': the gate passes on the skill open alone, strict says no readers', () => {
    const a = assess(read(h, c), MAP, []);
    expect(a.skill_opened).toBe(true);
    expect(a.gate).toBe('pass');
    expect(a.strict).toBe('fail (no readers dispatched)');
  });
  test('an empty expected list does not rescue a session with no skill open', () => {
    expect(assess(read('claude-code', 'no-skill'), MAP, []).strict).toBe('fail (skill not opened; no readers dispatched)');
  });
});

describe('Hermes background delivery', () => {
  test('the async_delegation_complete user row is the delivery, not tampering', () => {
    expect(gapOf('hermes', 'chat-good')).toBeNull();
  });
  test('the same row without its display_kind is an injected turn', () => {
    expect(gapOf('hermes', 'chat-tampered')).toBe(GAP_CODES.tampered);
  });
});

describe('gaps: an unreadable transcript is never exposed or not exposed', () => {
  const table: Array<[Harness, string, GapCode]> = [];
  for (const h of ['claude-code', 'codex', 'openclaw', 'hermes'] as Harness[]) for (const k of ['missing', 'empty', 'undecodable', 'truncated'] as const) table.push([h, k, GAP_CODES[k]]);
  table.push(['openclaw', 'tampered', GAP_CODES.tampered], ['hermes', 'chat-tampered', GAP_CODES.tampered]);
  for (const [h, c, code] of table) test(h + ' ' + c + ' is ' + code, () => expect(gapOf(h, c)).toBe(code));
  test('a gap row prints gap for the gate and strict and null signals', () => {
    const r = exposureRow({ unit: 'u1', pass: '1', harness: 'codex', path: materialize('codex', 'truncated') }, MAP, { u1: ['testing'] });
    expect([r.gate, r.strict, r.skill_opened, r.all_returned, r.gap?.code]).toEqual(['gap', 'gap', null, null, GAP_CODES.truncated]);
  });
});

describe('readersOf', () => {
  test('two checklists in one prompt cover both (batched)', () => {
    expect(readersOf('Read review/specialists/testing.md and ~/x/review/specialists/security.md', MAP)).toEqual(['security', 'testing']);
  });
  test('a checklist beats the adversarial marker; the marker alone is adversarial-native', () => {
    expect(readersOf('Think like an attacker and a chaos engineer. review/specialists/testing.md', MAP)).toEqual(['testing']);
    expect(readersOf('Think like an attacker and a chaos engineer.', MAP)).toEqual([ADVERSARIAL]);
  });
  test('a path counts only whole', () => {
    expect(readersOf('see review/specialists/testing.md.bak and xreview/specialists/testing.md', MAP)).toEqual([]);
  });
});

describe('CLI', () => {
  const setup = (rows: string[][], expected: Record<string, string[]>, header = ['unit', 'pass', 'harness', 'path']) => {
    const d = mkdtempSync(join(tmpdir(), 'exposure-cli-'));
    writeFileSync(join(d, 'sessions.tsv'), [header, ...rows].map(r => r.join('\t')).join('\n') + '\n');
    writeFileSync(join(d, 'expected.json'), JSON.stringify(expected));
    return d;
  };
  const run = (args: string[]) => { let out = '', err = ''; const code = main(args, s => { out += s; }, s => { err += s; }); return { code, out, err }; };
  const args = (d: string, more: string[] = []) => ['--sessions', join(d, 'sessions.tsv'), '--map', join(FIXTURES, 'reader-map.json'), '--expected', join(d, 'expected.json'), ...more];
  const good = () => [['u1', '1', 'codex', materialize('codex', 'good'), 'review'], ['u1', '1', 'hermes', materialize('hermes', 'chat-good'), 'review'], ['u2', '1', 'hermes', materialize('hermes', 'small-diff'), 'review'], ['u1', '1', 'openclaw', materialize('openclaw', 'spawn-refused'), 'plain']];
  test('every row read: exit 0, one TSV row per PR-pass, totals per harness and per arm', () => {
    const d = setup(good(), { u1: ['testing', ADVERSARIAL], u2: [] }, ['unit', 'pass', 'harness', 'path', 'arm']);
    const r = run(args(d));
    expect(r.code).toBe(EXIT.ok);
    expect(r.err).toBe('');
    const [body, tot] = r.out.split('\n\n');
    const lines = body.split('\n');
    expect(lines[0].split('\t').slice(0, 8)).toEqual(['unit', 'pass', 'harness', 'arm', 'skill_opened', 'army_dispatched', 'adv_dispatched', 'all_returned']);
    expect(lines.slice(1).map(l => l.split('\t')[14])).toEqual(['pass', 'pass', 'pass', 'fail (missing testing (not dispatched), adversarial-native (not dispatched))']);
    expect(lines.slice(1).map(l => l.split('\t')[15])).toEqual(['pass', 'pass', 'fail (no readers dispatched)', 'fail (no readers dispatched)']);
    expect(tot.trim().split('\n').map(l => l.split('\t').slice(1, 4).join(' '))).toEqual(['harness arm pr_passes', 'codex - 1', 'codex review 1', 'hermes - 2', 'hermes review 2', 'openclaw - 1', 'openclaw plain 1']);
  });
  test('--json prints rows and totals', () => {
    const d = setup(good().map(r => r.slice(0, 4)), { u1: ['testing', ADVERSARIAL], u2: [] });
    const r = run(args(d, ['--json']));
    const j = JSON.parse(r.out);
    expect(j.rows.map((x: { gate: string }) => x.gate)).toEqual(['pass', 'pass', 'pass', 'fail (missing testing (not dispatched), adversarial-native (not dispatched))']);
    expect(j.totals).toEqual(totals(j.rows));
    expect(j.totals.find((t: { harness: string }) => t.harness === 'hermes')).toMatchObject({ pass_n: 2, gaps: 0, skill_opened: 2, gate_pass: 2, strict_pass: 1 });
  });
  test('a gap: exit 3, every other row still printed, one stderr line naming the code, file and expected format', () => {
    const d = setup([['u1', '1', 'codex', materialize('codex', 'good')], ['u1', '2', 'hermes', materialize('hermes', 'missing')]], { u1: ['testing'] });
    const r = run(args(d));
    expect(r.code).toBe(EXIT.gap);
    expect(r.out.split('\n')[1].split('\t')[14]).toBe('pass');
    expect(r.out.split('\n')[2].split('\t')[14]).toBe('gap');
    expect(r.err).toMatch(/^E_EXPOSURE_MISSING \S+\/state\/hermes\/state\.db: no state\/hermes\/state\.db \(unit u1 pass 2\); expected state\/hermes\/state\.db with messages and sessions/);
  });
  test('usage and input errors exit 64', () => {
    const d = setup([['u1', '1', 'codex', materialize('codex', 'good')]], { u9: [] });
    const unlisted = run(args(d));
    expect([unlisted.code, unlisted.err.split(' ')[0]]).toEqual([EXIT.usage, 'E_EXPOSURE_EXPECTED']);
    expect(run(['--sessions', join(d, 'sessions.tsv')]).code).toBe(EXIT.usage);
    expect(run([...args(d), '--bogus', 'x']).code).toBe(EXIT.usage);
    const badHarness = setup([['u1', '1', 'cursor', '/nowhere']], { u1: [] });
    expect(run(args(badHarness)).err).toContain('harness "cursor" is not one of');
    const badReader = setup([['u1', '1', 'codex', '/nowhere']], { u1: ['nobody'] });
    expect(run(args(badReader)).code).toBe(EXIT.usage);
    writeFileSync(join(d, 'map.json'), JSON.stringify({ schema_version: 2 }));
    expect(run(['--sessions', join(d, 'sessions.tsv'), '--map', join(d, 'map.json'), '--expected', join(d, 'expected.json')]).code).toBe(EXIT.usage);
  });
  test('the program itself exits with the same codes', () => {
    const d = setup([['u1', '1', 'openclaw', materialize('openclaw', 'empty')]], { u1: [] });
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir() };
    const gap = spawnSync('bun', ['scripts/review-bugs/exposure.ts', ...args(d)], { cwd: ROOT, env, encoding: 'utf8' });
    expect([gap.status, gap.stderr.split(' ')[0]]).toEqual([EXIT.gap, GAP_CODES.empty]);
    expect(spawnSync('bun', ['scripts/review-bugs/exposure.ts'], { cwd: ROOT, env, encoding: 'utf8' }).status).toBe(EXIT.usage);
  });
});
