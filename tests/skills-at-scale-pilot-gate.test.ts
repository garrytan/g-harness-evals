// Keyless test of scripts/skills-at-scale/pilot-gate.ts, the R111 pilot gate: per arm, the part under test ran (native
// listing captured, or a resolver block in a captured request), the judge passes R78 (kappa 0.6 on 100 outputs), the
// requests were supplied at the planned rate and the pilot kept to a tenth of the budget; the separate judge stage when a
// tenth cannot buy 100 labelled outputs; the 2% flag-rate limit per harness; and the command exits 1 naming the failing arm
// (internal-task).

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScaleTrial } from '../scripts/skills-at-scale/analyze.ts';
import { pilotGate } from '../scripts/skills-at-scale/pilot-gate.ts';

const OPUS = 'anthropic:claude-opus-5-5', SOL = 'openai:gpt-6.2-sol';
const turn = (block: boolean) => ({ session: 's', turn: 1, block, block_tokens: block ? 50 : 0, injected: block, on: true, suggestions: [], phase: null, exhausted: false, code: '', infra: [] });
function trials(cell: string, arm: string, model: string, n: number, o: { ran?: (i: number) => boolean; reached?: (i: number) => boolean; usd?: number } = {}): ScaleTrial[] {
  return Array.from({ length: n }, (_, i) => {
    const ran = o.ran ? o.ran(i) : true, reached = o.reached ? o.reached(i) : true;
    return { id: 'run/' + cell + '/l-s-' + i + '/r1', cell, harness: 'h', model, arm, task: (i % 4 === 3 ? 'l-n-' : 'l-s-') + i, termination: reached ? 'completed' : 'infra', opened: [], got_skill_file: false,
      turns: arm === 'native' ? [] : [turn(ran)], infra: reached ? [] : ['E_SUPPLY'], set_t: null, rung: 1500, usage: reached ? { input_tokens: 1000, usd: o.usd ?? 0.01 } : null,
      saw: arm === 'native' ? (ran ? { described: ['sk-a'], name_only: [] } : { described: [], name_only: [] }) : null } as ScaleTrial;
  });
}
const requests = Array.from({ length: 40 }, (_, i) => ({ id: (i % 4 === 3 ? 'l-n-' : 'l-s-') + i, kind: (i % 4 === 3 ? 'none' : 'skill') as 'none' | 'skill', target: i % 4 === 3 ? null : 'sk-a' })); // pregate-literal: R78_OUTPUTS=40 the fixture's 40 requests, not a label count
const check = (astra: number, opus: number, n = 100) => ({ n_gold: n, sources: { 'openai:gpt-6.2-astra': { kappa: astra }, 'anthropic:claude-opus-5-5': { kappa: opus } } });

describe('skills-at-scale pilot gate (R111)', () => {
  test('passing arms pass; each failing check names its arm', () => {
    const ts = [
      ...trials('cc-native', 'native', OPUS, 40), // pregate-literal: R78_OUTPUTS=40 trials per arm in this fixture, not a label count
      ...trials('cc-resolver', 'resolver', OPUS, 40, { ran: (i) => i % 4 === 3 ? false : true }), // pregate-literal: R78_OUTPUTS=40 trials per arm in this fixture, not a label count
      ...trials('cc-broken', 'resolver', OPUS, 40, { ran: (i) => i % 2 === 0 }), // pregate-literal: R78_OUTPUTS=40 trials per arm in this fixture, not a label count
      ...trials('cx-native', 'native', SOL, 40, { reached: (i) => i < 30 }), // pregate-literal: R78_OUTPUTS=40 trials per arm in this fixture, not a label count
    ];
    const g = pilotGate({ trials: ts, planned: { 'cc-native': 40, 'cc-resolver': 40, 'cc-broken': 40, 'cx-native': 40 }, judgeCheck: check(0.7, 0.5), requests, flagged: [] }); // pregate-literal: R78_OUTPUTS=40 planned trials per arm, not a label count
    const by = Object.fromEntries(g.arms.map((a) => [a.arm, a]));
    expect(by['cc-native']!.pass).toBe(true);
    expect(by['cc-resolver']!.pass).toBe(true);
    expect(by['cc-resolver']!.part_ran.detail).toContain('30 of 30 skill-request trials');
    expect(by['cc-broken']!.failing).toEqual(['part_ran']);
    expect(by['cx-native']!.failing).toEqual(['judge', 'supply']);
    expect((by['cx-native']!.judge as { detail: string }).detail).toContain('anthropic:claude-opus-5-5 kappa 0.5');
    expect(g.failing).toEqual(['cc-broken', 'cx-native']);
    expect(g.pass).toBe(false);
  });

  test('a resolver block in a captured request (saw-skill.json block_requests) shows the part ran when no status log exists', () => {
    const seen = (n: number, blocks: (i: number) => number) => trials('he-resolver', 'resolver', OPUS, n).map((t, i) => ({ ...t, turns: [], saw: { described: [], name_only: [], block_requests: blocks(i) } }));
    const pass = pilotGate({ trials: seen(8, () => 1), planned: { 'he-resolver': 8 }, judgeCheck: check(0.9, 0.9), requests, flagged: [] });
    expect(pass.arms[0]!.part_ran).toEqual({ pass: true, detail: 'resolver block in a captured request on 6 of 6 skill-request trials (100.0%)' });
    const fail = pilotGate({ trials: seen(8, (i) => (i === 0 ? 0 : 1)), planned: { 'he-resolver': 8 }, judgeCheck: check(0.9, 0.9), requests, flagged: [] });
    expect(fail.arms[0]!.failing).toEqual(['part_ran']);
  });

  test('the judge needs 100 labelled outputs, and a pilot over a tenth of the budget fails', () => {
    const ts = trials('cc-native', 'native', OPUS, 40, { usd: 0.5 }); // pregate-literal: R78_OUTPUTS=40 trials per arm in this fixture, not a label count
    const g = pilotGate({ trials: ts, planned: { 'cc-native': 40 }, judgeCheck: check(0.9, 0.9, 30), armUsd: { 'cc-native': 150 }, judgeStage: 'pilot', flagged: [] }); // pregate-literal: R78_OUTPUTS=40 planned trials per arm, not a label count
    expect(g.arms[0]!.failing).toEqual(['judge', 'pilot_tenth']);
    expect(g.arms[0]!.pilot_tenth!.detail).toBe('$20.00 spent of a $15.00 pilot tenth');
  });

  test('when a tenth cannot buy 100 labelled outputs the judge is its own stage, and it blocks counted sessions until it passes', () => {
    const ts = trials('cc-native', 'native', OPUS, 40); // pregate-literal: R78_OUTPUTS=40 trials per arm in this fixture, not a label count
    const o = { trials: ts, planned: { 'cc-native': 40 }, armUsd: { 'cc-native': 10 }, judgeUsdPerOutput: 0.05, flagged: [] }; // pregate-literal: R78_OUTPUTS=40 planned trials per arm, not a label count
    const waiting = pilotGate({ ...o, judgeCheck: null });
    expect(waiting.arms[0]!.judge).toBe('separate stage');
    expect(waiting.arms[0]!.pass).toBe(true);
    expect(waiting.judge_stage.required).toBe(true);
    expect(waiting.failing).toEqual(['judge-stage']);
    expect(waiting.pass).toBe(false);
    expect(pilotGate({ ...o, judgeCheck: check(0.65, 0.2) }).pass).toBe(true);
    expect(pilotGate({ ...o, armUsd: { 'cc-native': 1000 }, judgeCheck: null }).arms[0]!.failing).toEqual(['judge']);
    expect(pilotGate({ ...o, armUsd: null, judgeStage: 'separate', judgeCheck: check(0.5, 0.9) }).failing).toEqual(['judge-stage']);
  });

  test('a harness whose pilot flag rate is above 2% fails: fix PR needed before its counted run', () => {
    const ts = [...trials('cc-native', 'native', OPUS, 100), ...trials('pi-native', 'native', SOL, 100).map((t) => ({ ...t, harness: 'pi' }))];
    const flagged = (cell: string, n: number) => ts.filter((t) => t.cell === cell).slice(0, n).map((t) => ({ trial_id: t.id, flags: ['cd-joined' as const] }));
    const o = { trials: ts, planned: { 'cc-native': 100, 'pi-native': 100 }, judgeCheck: check(0.8, 0.8) };
    const g = pilotGate({ ...o, flagged: [...flagged('cc-native', 2), ...flagged('pi-native', 3)] });
    expect(g.harnesses.map((h) => [h.harness, h.flagged, h.flag_rate, h.pass])).toEqual([['h', 2, 0.02, true], ['pi', 3, 0.03, false]]);
    expect(g.harnesses[1]!.detail).toBe("3 of 100 pilot trials flagged (3.0%, limit 2.0%); fix PR needed before this harness's counted run");
    expect(g.failing).toEqual(['harness:pi']);
    expect(g.arms.every((a) => a.pass)).toBe(true);
    const none = pilotGate(o);
    expect(none.failing).toEqual(['harness:h', 'harness:pi']);
    expect(none.harnesses[0]!.detail).toContain('no flagged.jsonl supplied');
  });

  test('the command exits 1 and names the failing arm', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-gate-'));
    const cells = [{ id: 'cc-native-1500', harness: 'claude-code', model: OPUS, skill_arm: 'native', rung: 1500 }, { id: 'pi-native-1500', harness: 'pi', model: OPUS, skill_arm: 'native', rung: 1500 }];
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ run_id: 'run', cells }));
    const rows: string[] = [];
    for (const c of cells) for (let i = 0; i < 20; i++) {
      const d = join(dir, 'trials', c.id, 'l-s-' + i, 'r1');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'got-skill.json'), JSON.stringify({ catalog_opened: [] }));
      if (c.harness === 'claude-code') writeFileSync(join(d, 'saw-skill.json'), JSON.stringify({ described: ['sk-a'], name_only: [] }));
      rows.push(JSON.stringify({ trial_id: 'run/' + c.id + '/l-s-' + i + '/r1', cell: c.id, task: 'l-s-' + i, harness: c.harness, model: c.model, termination: 'completed', usage: { input_tokens: 900, usd: 0.01 } }));
    }
    writeFileSync(join(dir, 'trials.jsonl'), rows.join('\n') + '\n');
    writeFileSync(join(dir, 'planned.json'), JSON.stringify({ 'cc-native-1500': 20, 'pi-native-1500': 20 }));
    writeFileSync(join(dir, 'judge.json'), JSON.stringify(check(0.8, 0.8)));
    writeFileSync(join(dir, 'flagged.jsonl'), JSON.stringify({ trial_id: 'run/pi-native-1500/l-s-0/r1', flags: ['errno13'] }) + '\n');
    const r = spawnSync('bun', [join(import.meta.dir, '..', 'scripts/skills-at-scale/pilot-gate.ts'), '--results', dir, '--planned', join(dir, 'planned.json'), '--judge-check', join(dir, 'judge.json'), '--flagged', join(dir, 'flagged.jsonl')],
      { encoding: 'utf8', env: { PATH: process.env.PATH!, HOME: process.env.HOME! } });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('PILOT_GATE arm=cc-native-1500 part_ran=pass judge=pass supply=pass pilot_tenth=- PASS');
    expect(r.stdout).toContain('PILOT_GATE arm=pi-native-1500 part_ran=FAIL');
    expect(r.stdout).toContain('PILOT_GATE harness=claude-code flag_rate=0 PASS');
    expect(r.stdout).toContain("PILOT_GATE harness=pi flag_rate=0.05 FAIL: 1 of 20 pilot trials flagged (5.0%, limit 2.0%); fix PR needed before this harness's counted run");
    expect(r.stdout).toContain('PILOT_GATE_RESULT FAIL failing=pi-native-1500,harness:pi');
  });
});
