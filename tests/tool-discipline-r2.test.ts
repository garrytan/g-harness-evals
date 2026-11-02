import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditTrial, summarize } from '../scripts/tool-discipline/clean-arm-audit.ts';
import { score } from '../scripts/tool-discipline/panel-score.ts';
import { hermesOnly, R2_ARMS, R2_DESIGN, R2_RUN_ID, r2ManifestProblem, scoreR2 } from '../scripts/tool-discipline/panel-score-r2.ts';

const row = (harness: string, task: number, arm: string, i: number, started = 0, termination = 'completed') => ({
  trial_id: 'gsta135-' + harness + '-t' + task + '-' + arm + '-' + i, harness, task, arm, trial_index: i, termination,
  usd_spent: termination === 'completed' ? 0.1 : 0, requests_forwarded: termination === 'completed' ? 1 : 0,
  evidence: termination !== 'completed' ? null : {
    transcript: 'complete', events: [],
    metrics: task === 3
      ? { control_false_open: 0, task_success: null, matching_skill_started: 0, matching_skill_opened: 0 }
      : { matching_skill_opened: started, matching_skill_started: started, started_attempted: started, started_exit: started ? 0 : null, task_success: true, control_false_open: null },
  },
});

/** discovery.sh's three-arm order for both harnesses, with the OpenClaw rows left out by --only. */
const panel = () => {
  const rows: any[] = [];
  for (let i = 1; i <= 8; i++) for (const task of [1, 2, 3]) for (const h of ['openclaw', 'hermes']) for (const arm of ['none', 'baseline', 'candidate'])
    rows.push(h === 'openclaw' ? row(h, task, arm, i, 0, 'not_run:not_selected') : row(h, task, arm, i, arm === 'candidate' && task !== 3 && i <= 3 ? 1 : 0));
  return rows;
};
const order = (rows: any[]) => rows.map(r => ({ trial_id: r.trial_id, harness: r.harness, task: r.task, arm: r.arm }));
const manifest = (rows: any[], over: Record<string, unknown> = {}) => ({
  run_id: R2_RUN_ID, upstream: 'default', ...R2_DESIGN, order: order(rows), start_hook: { arm: 'candidate' },
  arms: Object.fromEntries(Object.entries(R2_ARMS).map(([k, v]) => [k, { ...v }])), ...over,
});

describe('panel-score-r2', () => {
  test('accepts the rerun manifest and scores Hermes alone with panel-score.ts rules', () => {
    const rows = panel();
    expect(r2ManifestProblem(manifest(rows))).toBeNull();
    const s = scoreR2(rows, order(rows));
    expect(s.map(x => x.harness)).toEqual(['hermes']);
    expect(s[0].primary.starts).toBe(6);
    expect(s[0].verdict).toBe('pass');
    const h = rows.filter(r => r.harness === 'hermes');
    expect(s).toEqual(score(h, order(h)));
  });

  test('refuses #214 values: its run id, its cap and its candidate', () => {
    const rows = panel();
    expect(r2ManifestProblem(manifest(rows, { run_id: 'tool-discipline-start-2026-11' }))).toContain('run_id');
    expect(r2ManifestProblem(manifest(rows, { panel_cap_usd: 28 }))).toContain('panel_cap_usd');
    const arms = { ...manifest(rows).arms, candidate: { gstack_sha: 'b9fda18c6ac232de2b5a99ac3e6893955c55d7c0', start_hook: 'on' } };
    expect(r2ManifestProblem(manifest(rows, { arms }))).toContain('candidate gstack_sha');
    expect(r2ManifestProblem(manifest(rows, { upstream: 'http://127.0.0.1:9' }))).toContain('upstream');
  });

  test('refuses a plan or hook that differs from the preregistration', () => {
    const rows = panel();
    expect(r2ManifestProblem(manifest(rows, { order: order(rows).slice(1) }))).toContain('7 trials');
    expect(r2ManifestProblem(manifest(rows, { order: [...order(rows), { trial_id: 'x', harness: 'qm', task: 1, arm: 'none' }] }))).toContain('outside the 18');
    expect(r2ManifestProblem(manifest(rows, { start_hook: { arm: 'baseline' } }))).toContain('start_hook.arm');
    const arms = { ...manifest(rows).arms, baseline: { ...R2_ARMS.baseline, start_hook: 'on' } };
    expect(r2ManifestProblem(manifest(rows, { arms }))).toContain('baseline start_hook');
  });

  test('refuses a dispatched OpenClaw trial', () => {
    const rows = panel();
    rows[0] = { ...rows[0], termination: 'completed' };
    expect(() => hermesOnly(rows, order(rows))).toThrow('dispatches Hermes only');
  });

  test('an absent Hermes cell reads incomplete, as in panel-score.ts', () => {
    const rows = panel().map(r => r.harness === 'hermes' && r.task === 2 && r.arm === 'none' && r.trial_index >= 6 ? { ...r, termination: 'not_run:panel_cap', evidence: null } : r);
    expect(scoreR2(rows, order(rows))[0].verdict).toBe('incomplete');
  });
});

describe('clean-arm-audit', () => {
  const stateDb = (dir: string, trial: string, prompt: string, calls: unknown[] | string, agentLog?: string) => {
    const d = join(dir, 'trials', trial, 'state', 'hermes');
    mkdirSync(join(d, 'logs'), { recursive: true });
    if (agentLog !== undefined) writeFileSync(join(d, 'logs', 'agent.log'), agentLog);
    const db = new Database(join(d, 'state.db'));
    db.run('create table messages (id integer primary key, role text, content text, tool_calls text)');
    db.run('create table system_prompts (hash text, prompt text)');
    db.run('create table sessions (id text, system_prompt text)');
    db.run("insert into system_prompts values ('h', ?)", [prompt]);
    db.run("insert into messages (role, content, tool_calls) values ('assistant', '', ?)", [typeof calls === 'string' ? calls : JSON.stringify(calls)]);
    db.close();
  };
  const call = (name: string, args: object) => ({ type: 'function', function: { name, arguments: JSON.stringify(args) } });

  test('counts reads in transcripts and tool calls, and marks a none arm that read a gstack skill as contaminated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clean-arm-'));
    try {
      stateDb(dir, 'n1', 'You have tools.', [call('terminal', { command: 'git diff' })]);
      stateDb(dir, 'n2', 'You have tools.', [call('read_file', { path: '<private drive>/skills/gstack/SKILL.md' })]);
      stateDb(dir, 'c1', 'Skills: gstack-review, gstack-qa', [call('skill_view', { name: 'gstack-review' })]);
      const rows = [
        { trial_id: 'n1', arm: 'none', evidence: { events: [] } },
        { trial_id: 'n2', arm: 'none', evidence: { events: [] } },
        { trial_id: 'c1', arm: 'candidate', evidence: { events: [{ kind: 'skill_open', detail: 'skill_view gstack-review' }] } },
        { trial_id: 'c2', arm: 'candidate', evidence: { events: [] } },
      ];
      const trials = rows.map(r => auditTrial(r, dir, 'hermes'));
      expect(trials[0]).toMatchObject({ transcript_reads: 0, prompt_lists_gstack: false, drive_paths: 0 });
      expect(trials[1]).toMatchObject({ transcript_reads: 1, drive_paths: 1 });
      expect(trials[2]).toMatchObject({ tool_call_reads: 1, transcript_reads: 1, prompt_lists_gstack: true });
      expect(trials[3]).toMatchObject({ state_db: false, prompt_lists_gstack: null });
      const arms = Object.fromEntries(summarize(trials).map(a => [a.arm, a]));
      expect(arms.none).toMatchObject({ dispatched: 2, trials_with_read: 1, none_arm: 'contaminated' });
      expect(arms.candidate).toMatchObject({ trials_with_read: 1, unaudited: 1, none_arm: null });
      expect(summarize(trials.slice(0, 1))[0].none_arm).toBe('clean');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a none arm with an unaudited trial is never clean; path-only evidence and bad JSON are handled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clean-arm-'));
    try {
      stateDb(dir, 'n1', 'You have tools.', 'not json');
      const ok = auditTrial({ trial_id: 'n1', arm: 'none', evidence: { events: [] } }, dir, 'hermes');
      expect(ok).toMatchObject({ transcript_reads: 0, state_db: true });
      const missing = auditTrial({ trial_id: 'n9', arm: 'none', evidence: { events: [] } }, dir, 'hermes');
      expect(summarize([ok, missing])[0].none_arm).toBe('unaudited');
      const path = auditTrial({ trial_id: 'n1', arm: 'none', evidence: { events: [{ kind: 'gstack_path', detail: 'terminal cat /opt/gstack/review/SKILL.md' }] } }, dir, 'hermes');
      expect(path.tool_call_reads).toBe(1);
      expect(summarize([path])[0].none_arm).toBe('contaminated');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('an empty or table-less state.db, an undecodable call, a listed router and a missing none arm are never clean', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clean-arm-'));
    try {
      mkdirSync(join(dir, 'trials', 'e1', 'state', 'hermes'), { recursive: true });
      writeFileSync(join(dir, 'trials', 'e1', 'state', 'hermes', 'state.db'), '');
      const empty = auditTrial({ trial_id: 'e1', arm: 'none', evidence: { events: [] } }, dir, 'hermes');
      expect(empty).toMatchObject({ state_db: false });
      expect(summarize([empty])[0].none_arm).toBe('unaudited');
      stateDb(dir, 'm1', 'p', '[{"function": {"name": "read_file", "arguments": "{\\"path\\": \\"/opt/gstack/review/SKILL.md');
      const bad = auditTrial({ trial_id: 'm1', arm: 'none', evidence: { events: [] } }, dir, 'hermes');
      expect(bad).toMatchObject({ undecoded: 1, transcript_reads: 1 });
      expect(summarize([bad])[0].none_arm).toBe('contaminated');
      stateDb(dir, 'a1', 'p', [{ function: { name: 'skill_view', arguments: '{"name": "gstack-review"' } }]);
      const cut = auditTrial({ trial_id: 'a1', arm: 'none', evidence: { events: [] } }, dir, 'hermes');
      expect(cut).toMatchObject({ undecoded: 1, transcript_reads: 1 });
      stateDb(dir, 'a2', 'p', [{ function: { name: 'read_file', arguments: '{"path": "/tmp/notes' } }]);
      const cut2 = auditTrial({ trial_id: 'a2', arm: 'none', evidence: { events: [] } }, dir, 'hermes');
      expect(cut2).toMatchObject({ undecoded: 1, transcript_reads: 0 });
      expect(summarize([cut2])[0].none_arm).toBe('unaudited');
      stateDb(dir, 'r1', 'Available skills: gstack (router)', []);
      expect(auditTrial({ trial_id: 'r1', arm: 'none', evidence: { events: [] } }, dir, 'hermes').prompt_lists_gstack).toBe(true);
      stateDb(dir, 'r2', 'GSTACK_DIR is set in the shell', []);
      expect(auditTrial({ trial_id: 'r2', arm: 'none', evidence: { events: [] } }, dir, 'hermes').prompt_lists_gstack).toBe(false);
      const base = auditTrial({ trial_id: 'r2', arm: 'baseline', evidence: { events: [] } }, dir, 'hermes');
      expect(summarize([base]).find(a => a.arm === 'none')).toMatchObject({ dispatched: 0, none_arm: 'absent' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('counts Tirith downloads from agent.log in every arm', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clean-arm-'));
    try {
      stateDb(dir, 'b1', 'p', [], 'INFO tools.tirith_security: tirith installed to /harness-state/hermes/bin/tirith (SHA-256 only)\n');
      stateDb(dir, 'b2', 'p', [], 'INFO nothing here\n');
      stateDb(dir, 'b3', 'p', []);
      const trials = ['b1', 'b2', 'b3'].map(id => auditTrial({ trial_id: id, arm: 'baseline', evidence: { events: [] } }, dir, 'hermes'));
      expect(trials.map(t => t.tirith_downloads)).toEqual([1, 0, null]);
      expect(summarize(trials)[0]).toMatchObject({ trials_with_tirith_download: 1, tirith_unknown: 1 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('preflight script usage', () => {
  const run = (script: string, ...args: string[]) => spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
  test('clean-arm-preflight refuses an unknown arm and a gstack arm without a full sha before touching docker', () => {
    expect(run('scripts/tool-discipline/clean-arm-preflight.sh', '--arm', 'other', '--image', 'x').status).toBe(64);
    expect(run('scripts/tool-discipline/clean-arm-preflight.sh', '--arm', 'candidate', '--image', 'x', '--sha', 'e2d9c798').status).toBe(64);
    expect(run('scripts/tool-discipline/clean-arm-preflight.sh', '--arm', 'none').status).toBe(64);
  });
  test('tirith-fence-check refuses the none arm and a missing image before touching docker', () => {
    expect(run('scripts/tool-discipline/tirith-fence-check.sh', '--arm', 'none', '--image', 'x').status).toBe(64);
    expect(run('scripts/tool-discipline/tirith-fence-check.sh', '--arm', 'candidate').status).toBe(64);
  });
});
