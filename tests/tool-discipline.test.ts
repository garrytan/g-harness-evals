// internal-task tool discipline classifier (scripts/tool-discipline/). Fixtures under tests/fixtures/tool-discipline/ are cut from
// real receipts: benchmarks/ holds a few verbatim events.jsonl lines per trial (with a trials.jsonl line cut down to trial_id,
// cell, task, harness, model and termination); gsta-135/ holds whole internal-task evidence excerpts (internal-task's drive copies) and
// cells.jsonl lines cut down to the fields normalize.ts reads. One positive and one near miss per kind per harness where the
// data has one; the helper-command cases at the end are synthetic and say so. Keyless; nothing is spawned with keys.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyAll, classifyRow, identifierShape, startFlagProblems, type RowLabels, type TrialSummary } from '../scripts/tool-discipline/classify.ts';
import { evidenceRows, normalizeBenchmarks, normalizeGsta, partialArgs, harnessOf, sealedReason, type CallRow, type RunCount } from '../scripts/tool-discipline/normalize.ts';
import { clusterBootstrap, computeRates } from '../scripts/tool-discipline/rates.ts';
import { draw, drawSample } from '../scripts/tool-discipline/sample.ts';

const ROOT = join(import.meta.dir, '..');
const FIX = join(ROOT, 'tests', 'fixtures', 'tool-discipline');
const B = 'tests/fixtures/tool-discipline/benchmarks/';
const counts: RunCount[] = [];
const eventRows = normalizeBenchmarks(join(FIX, 'benchmarks'), counts);
const gstaRows = normalizeGsta(join(FIX, 'gsta-135'), counts);
const rows = [...eventRows, ...gstaRows];
const { labels, trials } = classifyAll(rows);
const label = (locator: string) => { const l = labels.find(x => x.locator === locator); if (!l) throw new Error('no row ' + locator); return l; };
const trial = (id: string) => { const t = trials.find(x => x.trial === id); if (!t) throw new Error('no trial ' + id); return t; };

describe('normalize: events.jsonl', () => {
  test('assistant rows only, harness and model from trials.jsonl, call classes', () => {
    expect(eventRows.length).toBeGreaterThan(0);
    const f = B + '2026-10-25-company-brain/results/trials/openclaw-haiku-company-scoped-mu-heldout/ho-03-pellucid-prep-call/r5/events.jsonl';
    const here = eventRows.filter(r => r.locator.startsWith(f + '#'));
    expect(here.map(r => r.seq)).toEqual([1, 8, 10, 15]);
    expect(here.map(r => r.call_class)).toEqual(['protocol', 'model', 'model', 'channel']);
    expect(here[1]).toMatchObject({ harness: 'openclaw', model: 'claude-haiku-5-5', task: 'ho-03-pellucid-prep-call', rep: 'r5', termination: 'completed', outcome: 'error', error: 'invalid_params' });
    expect(here[1].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(counts.filter(c => c.source === 'events').every(c => c.included)).toBe(true);
  });
  test('sealed material inside results/trials excludes the run', () => {
    const run = mkdtempSync(join(tmpdir(), 'td-sealed-'));
    try {
      mkdirSync(join(run, 'results', 'trials', 'c', 't', 'r1'), { recursive: true });
      writeFileSync(join(run, 'results', 'trials', 'c', 't', 'r1', 'events.jsonl'), '');
      expect(sealedReason(run)).toBeNull();
      writeFileSync(join(run, 'results', 'trials', 'c', 't', 'r1', 'logs.tar.age'), '');
      expect(sealedReason(run)).toBe('has an age-encrypted file results/trials/c/t/r1/logs.tar.age');
    } finally { rmSync(run, { recursive: true, force: true }); }
  });
  test('multi-word harness names stay whole', () => {
    expect(harnessOf('qm-pi-haiku-gbrain-told-mu-v02-heldout')).toBe('qm-pi');
    expect(harnessOf('claude-code-haiku-none-mu-v03-dev')).toBe('claude-code');
    expect(harnessOf('openclaw-sonnet-mu-dev')).toBe('openclaw');
  });
});

const EVENT_CASES: Array<[string, keyof RowLabels['labels'], boolean, string]> = [
  ['2026-10-25-company-brain/results/trials/openclaw-haiku-company-scoped-mu-heldout/ho-03-pellucid-prep-call/r5/events.jsonl#8', 'malformed_args', true, 'openclaw gbrain.search {query, match}: invalid_params'],
  ['2026-10-25-company-brain/results/trials/openclaw-haiku-company-scoped-mu-heldout/ho-03-pellucid-prep-call/r5/events.jsonl#10', 'malformed_args', false, 'openclaw gbrain.search ok'],
  ['2026-10-24-gbrain-arm/results/trials/openclaw-haiku-gbrain-mu-heldout/ho-05-phl-label-note/r2/events.jsonl#8', 'wrong_identifier', true, 'openclaw chat.postMessage channel_not_found'],
  ['2026-10-24-gbrain-arm/results/trials/openclaw-haiku-gbrain-mu-heldout/ho-05-phl-label-note/r2/events.jsonl#10', 'wrong_identifier', false, 'openclaw chat.postMessage ok'],
  ['2026-10-25-gbrain-installer-hook/results/trials/openclaw-haiku-gbrain-installer-mu-heldout/sc-04-strategic-pod-corrections/r1/events.jsonl#12', 'denied', true, 'openclaw gbrain.search permission_denied'],
  ['2026-10-25-gbrain-installer-hook/results/trials/openclaw-haiku-gbrain-installer-mu-heldout/sc-04-strategic-pod-corrections/r1/events.jsonl#7', 'denied', false, 'openclaw gbrain.search ok'],
  ['2026-10-25-company-brain/results/trials/hermes-haiku-company-scoped-mu-heldout/sd-04-strategic-brief/r2/events.jsonl#24', 'malformed_args', true, 'hermes gbrain.get_page {slug, section}: invalid_params'],
  ['2026-10-25-company-brain/results/trials/hermes-haiku-company-scoped-mu-heldout/sd-04-strategic-brief/r2/events.jsonl#6', 'malformed_args', false, 'hermes chat.postMessage ok'],
  ['2026-10-23-m2-pilot/results/trials/hermes-sonnet-mu-dev/os-02-tansley-rate/r3/events.jsonl#10', 'wrong_identifier', true, 'hermes files.read file_not_found'],
  ['2026-10-23-m2-pilot/results/trials/hermes-sonnet-mu-dev/os-02-tansley-rate/r3/events.jsonl#10', 'denied', false, 'outcome denied, but a not-found refusal is a wrong identifier, not a permission denial'],
  ['2026-10-23-m2-pilot/results/trials/hermes-sonnet-mu-dev/os-02-tansley-rate/r3/events.jsonl#7', 'wrong_identifier', false, 'hermes files.read ok'],
  ['2026-10-29-v03-installer-dev/results/trials/hermes-haiku-gbrain-told-mu-v03-dev/cn-01-tamsin-cold-chain-site/r4/events.jsonl#5', 'denied', true, 'hermes gbrain.remember scope_denied'],
  ['2026-10-29-v03-installer-dev/results/trials/hermes-haiku-gbrain-told-mu-v03-dev/cn-01-tamsin-cold-chain-site/r4/events.jsonl#6', 'denied', false, 'hermes chat.postMessage ok'],
  ['2026-10-25-v02-heldout/results/trials/qm-pi-haiku-gbrain-told-mu-v02-heldout/cn-05-coastal-date-formats/r4/events.jsonl#6', 'malformed_args', true, 'qm-pi gbrain.remember invalid_params'],
  ['2026-10-25-v02-heldout/results/trials/qm-pi-haiku-gbrain-told-mu-v02-heldout/cn-05-coastal-date-formats/r4/events.jsonl#13', 'malformed_args', false, 'qm-pi conversations.list ok'],
  ['2026-10-23-m2-pilot/results/trials/qm-pi-sonnet-mu-dev/os-01-sev1-summary-mail/r2/events.jsonl#2', 'wrong_identifier', true, 'qm-pi conversations.open user_not_found'],
  ['2026-10-23-m2-pilot/results/trials/qm-pi-sonnet-mu-dev/os-01-sev1-summary-mail/r2/events.jsonl#3', 'wrong_identifier', false, 'qm-pi request_approval ok'],
  ['2026-10-26-gbrain-memory/results/trials/qm-pi-haiku-gbrain-told-live-mu-memory/cr-07-pellucid-owner/r3/events.jsonl#7', 'denied', true, 'qm-pi gbrain.remember scope_denied'],
  ['2026-10-26-gbrain-memory/results/trials/qm-pi-haiku-gbrain-told-live-mu-memory/cr-07-pellucid-owner/r3/events.jsonl#19', 'denied', false, 'qm-pi files.list ok'],
];

describe('classify: world event rows', () => {
  for (const [loc, kind, want, why] of EVENT_CASES) test(kind + ' ' + want + ': ' + why, () => expect(label(B + loc).labels[kind]).toBe(want));
  test('events rows never carry phantom_tool, mangled_helper or a skill read', () => {
    for (const l of labels.filter(l => l.source === 'events')) { expect(l.labels.phantom_tool).toBe(false); expect(l.labels.mangled_helper).toBe(false); }
    for (const t of trials.filter(t => t.source === 'events')) { expect(t.skill_md_read).toBeNull(); expect(t.skipped_start).toBeNull(); }
  });
  test('wrong identifier patterns', () => {
    expect(identifierShape('chat.postMessage', { channel: 'ruth.calloway' })).toBe('channel: a person handle, not a DM id');
    expect(identifierShape('chat.postMessage', { channel: '@june.osei-lark' })).toBe('channel: a person handle with @, not a DM id');
    expect(identifierShape('chat.postMessage', { channel: 'c1253qw9nj6' })).toBe('channel: a lowercased channel id');
    expect(identifierShape('conversations.history', { channel: 'teams/team-coastal/digests/coastal-cheatsheet.md' })).toBe('channel: a file path');
    expect(identifierShape('conversations.open', { users: ['June Osei-Lark'] })).toBe('users: a display name');
    expect(identifierShape('conversations.open', { users: ['C1253QW9NJ6'] })).toBe('users: a channel or DM id');
    expect(identifierShape('files.read', { path: 'accounts/orlavine/profile' })).toBe('path: a folder or extensionless guess');
  });
});

const P = 'gsta-135/panel-run/evidence/', P3 = 'gsta-135/panel-run-3610/evidence/';
describe('normalize: internal-task excerpts', () => {
  test('a result marked (matches no waiting call) settles no call; the real result after it does (synthetic excerpts)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'td-orphan-'));
    try {
      const meta = (harness: string) => ({ harness, task: 1, arm: 'candidate', trial_index: 1, model: 'claude-opus-5-5', termination: 'completed', image: '', events: null });
      writeFileSync(join(dir, 'oc.txt'), [
        'session ab seq 1 toolCall exec {"command":"ls"}',
        'session ab seq 2 toolResult exec (error) (matches no waiting call): Tool exec not found',
        'session ab seq 3 toolResult exec (exit 0): a.txt',
      ].join('\n') + '\n');
      const [oc] = evidenceRows(join(dir, 'oc.txt'), 'oc.txt', 'run', 'gsta135-openclaw-t1-candidate-1', meta('openclaw'));
      expect(oc).toMatchObject({ tool: 'exec', outcome: 'ok', exit: 0, result_text: 'a.txt', error: null });
      writeFileSync(join(dir, 'he.txt'), [
        'id 1 tool_call terminal {"command":"ls"}',
        'id 2 tool result (terminal) (error) (matches no waiting call): Tool terminal does not exist',
        'id 3 tool result (terminal) (exit 0): a.txt',
      ].join('\n') + '\n');
      const [he] = evidenceRows(join(dir, 'he.txt'), 'he.txt', 'run', 'gsta135-hermes-t1-candidate-1', meta('hermes'));
      expect(he).toMatchObject({ tool: 'terminal', outcome: 'ok', exit: 0, result_text: 'a.txt', error: null });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test('calls joined to results by session, tool and order', () => {
    const r = gstaRows.find(r => r.locator === P + 'gsta135-openclaw-t1-candidate-2.txt#9762a4b2:6.0')!;
    expect(r).toMatchObject({ harness: 'openclaw', model: 'claude-opus-5-5', task: 't1', arm: 'candidate', tool: 'skills_read', args: { name: 'review' }, outcome: 'error', clipped: false });
    expect(r.result_text).toContain('Tool skills_read not found');
    const h = gstaRows.find(r => r.locator === P + 'gsta135-hermes-t1-candidate-2.txt#2.0')!;
    expect(h).toMatchObject({ tool: 'skill_view', outcome: 'ok', result_clipped: true });
  });
  test('a clipped call keeps the readable fields and the extractor verdict', () => {
    const r = gstaRows.find(r => r.locator === P3 + 'gsta135-openclaw-t2-candidate-4.txt#c084e0a4:13.0')!;
    expect(r.clipped).toBe(true);
    expect(String((r.args as Record<string, unknown>).command)).toContain('$GSTACK_ROOT/bin/gstack-skill-');
    expect(r.extractor).toEqual([expect.objectContaining({ kind: 'helper_run', skill: 'gstack-investigate', exit: 0, exit_belongs: false })]);
    const sibling = gstaRows.find(r => r.locator === P3 + 'gsta135-openclaw-t2-candidate-4.txt#c084e0a4:13.1')!;
    expect(sibling.extractor).toEqual([]);
    expect(partialArgs('{"command":"echo hi \\"there')).toEqual({ command: 'echo hi "there' });
  });
  test('the discovery excerpt has no OpenClaw result lines', () => {
    const d = gstaRows.filter(r => r.run === 'gsta135-discovery');
    expect(d.length).toBeGreaterThan(0);
    expect(d.every(r => r.outcome === 'unknown' && r.result_text === null)).toBe(true);
  });
});

describe('classify: internal-task rows', () => {
  test('phantom_tool: OpenClaw skills_read answered "Tool skills_read not found"', () => {
    expect(label(P + 'gsta135-openclaw-t1-candidate-2.txt#9762a4b2:6.0').labels).toMatchObject({ phantom_tool: true, malformed_args: false, wrong_identifier: false });
  });
  test('phantom_tool near misses: an OpenClaw exec failing with exit 2, a Hermes skill_view that worked', () => {
    const ex = label(P + 'gsta135-openclaw-t2-baseline-3.txt#a8d1169e:6.0');
    expect(ex.outcome).toBe('error');
    expect(ex.labels).toMatchObject({ phantom_tool: false, malformed_args: false, wrong_identifier: false, denied: false });
    expect(label(P + 'gsta135-hermes-t1-candidate-2.txt#2.0').labels).toMatchObject({ phantom_tool: false, wrong_identifier: false });
  });
  test('mangled_helper: the piped start in run 3610 (clipped, settled by exit_belongs)', () => {
    const l = label(P3 + 'gsta135-openclaw-t2-candidate-4.txt#c084e0a4:13.0');
    expect(l.labels.mangled_helper).toBe(true);
    expect(l.reasons.mangled_helper).toContain('not the helper');
  });
  test('mangled_helper near misses: the call beside it, a Hermes terminal call that only mentions gstack', () => {
    expect(label(P3 + 'gsta135-openclaw-t2-candidate-4.txt#c084e0a4:13.1').labels.mangled_helper).toBe(false);
    expect(label(P3 + 'gsta135-hermes-t1-candidate-4.txt#5.0').labels.mangled_helper).toBe(false);
  });
  test('rows with no result line are unknown, never false', () => {
    for (const l of labels.filter(l => l.run === 'gsta135-discovery')) expect(l.labels.phantom_tool).toBe('unknown');
  });
  test('skipped_start: OpenClaw and Hermes trials that read the skill and never started it', () => {
    expect(trial('gsta135-panel-run/gsta135-openclaw-t1-baseline-1')).toMatchObject({ skill_md_read: true, start_attempt: false, skipped_start: true });
    expect(trial('gsta135-panel-run/gsta135-hermes-t1-candidate-2')).toMatchObject({ skill_md_read: true, start_attempt: false, skipped_start: true });
  });
  test('skipped_start near misses: the one start attempt, and a trial whose only skill call was the phantom one', () => {
    expect(trial('gsta135-panel-run-3610/gsta135-openclaw-t2-candidate-4')).toMatchObject({ skill_md_read: true, start_attempt: true, skipped_start: false });
    expect(trial('gsta135-panel-run/gsta135-openclaw-t1-candidate-2')).toMatchObject({ skill_md_read: false, skipped_start: null });
  });
});

/** A synthetic OpenClaw exec row with a full (unclipped) result. */
const shellRow = (command: string, extra: Partial<CallRow> = {}): CallRow => ({
  source: 'gsta135', run: 'synthetic', cell: 'openclaw-opus-x', harness: 'openclaw', model: 'claude-opus-5-5', task: 't1', rep: '1', trial: 'synthetic/t', arm: 'x', termination: 'completed',
  seq: 1, session: null, tool: 'exec', via: 'native', call_class: 'model', args: { command }, outcome: 'ok', exit: 0, effect: null, error: null, result_text: 'SKILL_START_PROTO: 1',
  clipped: false, result_clipped: false, extractor: [], locator: 'synthetic#1', sha256: '0'.repeat(64), ...extra,
});

describe('classify: refused skill reads (synthetic)', () => {
  const read = (result_text: string): CallRow => shellRow('', { tool: 'read', args: { path: '~/openclaw/skills/gstack-review/SKILL.md' }, result_text, trial: 'synthetic/read' });
  test('a read OpenClaw refused to serve is not an opportunity', () => {
    const t = classifyAll([read('[{"type":"text","text":"Skill instructions cannot be partially served: the whole document exceeds this call\'s read or mo ...')]).trials[0];
    expect(t).toMatchObject({ skill_md_read: false, skipped_start: null });
  });
  test('near miss: a served read with no start is a skipped start', () => {
    const t = classifyAll([read('[{"type":"text","text":"---\\nname: review\\ndescription: ...')]).trials[0];
    expect(t).toMatchObject({ skill_md_read: true, start_attempt: false, skipped_start: true });
  });
});

describe('classify: start attempts (synthetic)', () => {
  test('a helper_run of another helper whose command only echoes the start helper\'s name is not a start attempt', () => {
    const read = shellRow('', { tool: 'read', args: { path: '~/openclaw/skills/gstack-review/SKILL.md' }, result_text: '---\nname: review', trial: 'synthetic/echo', seq: 1, locator: 'synthetic#e1' });
    const command = '/opt/gstack/bin/gstack-config get proactive; echo gstack-skill-start';
    const echo = shellRow(command, { trial: 'synthetic/echo', seq: 2, locator: 'synthetic#e2', extractor: [{ kind: 'helper_run', tool: 'exec', detail: 'gstack-config in: ' + command, skill: null, result: 'ok', exit: 0, exit_belongs: true }] });
    expect(classifyAll([read, echo]).trials[0]).toMatchObject({ skill_md_read: true, start_attempt: false, skipped_start: true });
    const ran = 'gstack-skill-start --skill review';
    const start = shellRow(ran, { trial: 'synthetic/echo', seq: 2, locator: 'synthetic#e2', extractor: [{ kind: 'helper_run', tool: 'exec', detail: 'gstack-skill-start in: ' + ran, skill: 'gstack-review', result: 'ok', exit: 0, exit_belongs: true }] });
    expect(classifyAll([read, start]).trials[0]).toMatchObject({ start_attempt: true, skipped_start: false });
  });
});

describe('classify: helper commands (synthetic)', () => {
  const cases: Array<[string, boolean | 'unknown']> = [
    ['"$GSTACK_ROOT/bin/gstack-skill-start" --skill "review" --model "claude"', false],
    ['"$GSTACK_ROOT/bin/gstack-skill-start" --skill "review" --model "claude" 2>&1 | head -40', true],
    ['gstack-skill-start --skill review || :', true],
    ['gstack-skill-start --skill review; echo done', true],
    ['/opt/gstack/bin/gstack-skill-start --skill review 2>&1 | tee /tmp/start.log', true],
    ['gstack-skill-start --skil review', true],
    ['gstack-skill-start --help', true],
    ['gstack-skill-start --model claude', true],
    ['/opt/gstack/bin/gstack-config get proactive', false],
    ['cat /opt/gstack/bin/gstack-skill-start', false],
    ['ls /opt/gstack/bin', false],
    ['cat /opt/gstack/bin/gstack-skill-start; gstack-skill-start --skill review --verbose', true],
    ['gstack-skill-start --skill', true],
    ['gstack-skill-start --skill=', true],
    ['gstack-skill-start --skill --model claude', true],
    ['gstack-skill-start && cat x', true],
  ];
  for (const [cmd, want] of cases) test(String(want) + ': ' + cmd, () => expect(classifyRow(shellRow(cmd)).labels.mangled_helper).toBe(want));
  test('a missing file named schema.json is a wrong identifier, not malformed arguments', () => {
    const l = classifyRow(shellRow('', { tool: 'read', args: { path: '/workspace/schema.json' }, outcome: 'error', exit: null, result_text: 'ENOENT: no such file or directory, open /workspace/schema.json' })).labels;
    expect([l.malformed_args, l.wrong_identifier]).toEqual([false, true]);
  });
  test('a helper path the shell could not run', () => {
    expect(classifyRow(shellRow('/opt/gstack/bin/gstack-skill-start --skill review', { exit: 127, outcome: 'error', result_text: 'sh: /opt/gstack/bin/gstack-skill-start: No such file or directory' })).labels.mangled_helper).toBe(true);
  });
  test('clipped commands the extractor did not see are unknown', () => {
    expect(classifyRow(shellRow('"$GSTACK_ROOT/bin/gstack-skill-start" --skill "rev', { clipped: true, extractor: null })).labels.mangled_helper).toBe('unknown');
    expect(classifyRow(shellRow('[ -d "$GSTACK_ROOT/bin" ] || GSTACK_ROOT=/opt/gs', { clipped: true, extractor: null })).labels.mangled_helper).toBe('unknown');
  });
  test('start flag parsing', () => {
    expect(startFlagProblems('gstack-skill-start --skill=review --brain-health')).toEqual({ problems: [], complete: true, skill: true });
    expect(startFlagProblems('gstack-skill-start --skill review --verbose')!.problems).toEqual(['unknown flag --verbose']);
    expect(startFlagProblems('git status')).toBeNull();
    expect(startFlagProblems('gstack-skill-start --skill --model claude')).toEqual({ problems: ['no value for --skill'], complete: false, skill: false });
    expect(startFlagProblems('gstack-skill-start --skill review --model')!.problems).toEqual(['no value for --model']);
    expect(startFlagProblems('gstack-skill-start && cat x')).toEqual({ problems: [], complete: true, skill: false });
  });
});

describe('classify: reply forms the probe recorded', () => {
  const hermesReply = (JSON.parse(readFileSync(join(ROOT, 'docs', 'tool-discipline', 'replies', 'hermes-oneshot.json'), 'utf8')).turns[0].tool_result.content as string);
  test('Hermes answers an unknown tool with no error flag; the refusal naming the called tool is still a phantom call', () => {
    expect(hermesReply).toStartWith("Tool 'frobnicate' does not exist");
    const row = shellRow('', { harness: 'hermes', tool: 'frobnicate', args: {}, outcome: 'ok', exit: null, result_text: hermesReply });
    expect(classifyRow(row).labels.phantom_tool).toBe(true);
    expect(classifyRow({ ...row, tool: 'read_file' }).labels.phantom_tool).toBe(false);
  });
  test('an error reply clipped before any pattern is unknown, not false', () => {
    const row = shellRow('', { tool: 'skill_view', args: { name: 'x' }, outcome: 'error', exit: null, result_text: 'Error: the request could not be ...', result_clipped: true });
    expect(classifyRow(row).labels).toMatchObject({ phantom_tool: 'unknown', malformed_args: 'unknown', wrong_identifier: 'unknown' });
    expect(classifyRow({ ...row, result_clipped: false }).labels).toMatchObject({ phantom_tool: false, malformed_args: false, wrong_identifier: false });
  });
});

describe('rates', () => {
  test('internal-task infra:* and not_run:* trials are excluded like model_error', () => {
    const t = (trial: string, termination: string) => ({ ...trials[0]!, trial, termination });
    expect(computeRates([], [t('a', 'infra:runtime'), t('b', 'not_run:register_failed'), t('c', 'model_error'), t('d', 'completed')]).excluded_trials).toBe(3);
  });
  test('bootstrap is seeded and clustered', () => {
    const c = [{ k: 1, n: 10 }, { k: 0, n: 10 }, { k: 3, n: 10 }, { k: 0, n: 5 }, { k: 2, n: 10 }];
    expect(clusterBootstrap(c)).toEqual(clusterBootstrap(c));
    const i = clusterBootstrap(c)!;
    expect(i.lo).toBeLessThanOrEqual(6 / 45);
    expect(i.hi).toBeGreaterThanOrEqual(6 / 45);
    expect(clusterBootstrap([{ k: 0, n: 0 }])).toBeNull();
  });
  test('call kinds count model calls only; skipped_start counts trials that read a SKILL.md', () => {
    const r = computeRates(labels, trials);
    const oc = r.rows.find(x => x.source === 'events' && x.harness === 'openclaw' && x.kind === 'malformed_args')!;
    expect(oc.n).toBe(labels.filter(l => l.source === 'events' && l.harness === 'openclaw' && l.call_class === 'model').length);
    expect(oc.k).toBe(1);
    expect(oc.wilson!.lo).toBeGreaterThan(0);
    const ss = r.rows.find(x => x.source === 'gsta135' && x.harness === 'openclaw' && x.kind === 'skipped_start')!;
    expect(ss.n).toBe(trials.filter(t => t.source === 'gsta135' && t.harness === 'openclaw' && t.skill_md_read).length);
    expect(ss.coverage).toBe('full');
    expect(r.rows.find(x => x.source === 'events' && x.kind === 'phantom_tool')!.coverage).toBe('none');
    expect(r.patterns.phantom_tool).toEqual([{ pattern: 'openclaw skills_read', count: 1 }]);
  });
});

describe('sample', () => {
  test('every positive is drawn with probability 1, the template is blind', () => {
    const { items, template } = drawSample(rows, labels, trials, 3, 18);
    const positives = labels.filter(l => l.call_class === 'model' && Object.values(l.labels).some(v => v === true));
    for (const p of positives) expect(items.find(i => i.item_id === 'call:' + p.locator)).toMatchObject({ stratum: 'positive', inclusion_probability: 1 });
    expect(items.filter(i => i.item_type === 'trial' && i.stratum === 'positive').length).toBe(trials.filter(t => t.skipped_start === true).length);
    for (const t of template) { expect(t).not.toHaveProperty('stratum'); expect(t).not.toHaveProperty('classifier'); expect(Object.values(t.label as object).every(v => v === null)).toBe(true); }
    expect(drawSample(rows, labels, trials, 3, 18).items).toEqual(items);
    expect(draw([1, 2, 3, 4, 5], 2, 18)).toEqual(draw([1, 2, 3, 4, 5], 2, 18));
  });
});

describe('command line', () => {
  test('normalize prints the inclusion rule and per-run counts to stderr', () => {
    const out = spawnSync('bun', ['scripts/tool-discipline/normalize.ts', '--benchmarks', join(FIX, 'benchmarks'), '--gsta', join(FIX, 'gsta-135')], { cwd: ROOT, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }, encoding: 'utf8' });
    expect(out.status).toBe(0);
    expect(out.stderr).toContain('inclusion rule:');
    expect(out.stderr).toContain('gsta135-panel-run-3610  included');
    expect(out.stdout.trim().split('\n').length).toBe(rows.length);
  });
});
