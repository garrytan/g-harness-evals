// Phase B (internal-task skill-requests): the request set reader and half filter, the cell rules and the private-set guard, the
// metering proxy's opt-in request cap and in-memory request collection, got-skill.json, the scrub that keeps request text out of
// the trial directory, analyze.ts on the reachable.ts shape, and one plan-and-run per case through the runner CLI with a stub
// docker that plays a harness against a fake Anthropic endpoint. Keyless: capture mode with dummy keys, no Docker daemon.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { GradeResult } from '../runner/contracts.ts';
import { executeRun } from '../runner/trial/run.ts';
import { loadTask } from '../runner/trial/task.ts';
import { buildManifest, cellModels, loadPrereg } from '../runner/run.ts';
import { BudgetRun } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy, ProxyControl, REQUEST_CAP, type UsageLine } from '../runner/proxy/metering-proxy.ts';
import { KEEP, PHASE_B_ACTOR, SKILL_REQUESTS_SLICE, checkBlockDelivery, composeRequest, gotSkillRecord, gstackReads, insideDir, readRequestSet, redactRequest, requestSetIds, scrubTrialDir, writeRequestTask, writeRunRequestTask } from '../runner/trial/skill-requests.ts';
import { ineligible, readReachable, type Label } from '../scripts/skill-resolver/analyze.ts';
import { queryText } from '../scripts/skill-resolver/offline-rankers.ts';
import { validateRecords } from '../scripts/validate-records.ts';

const ROOT = join(import.meta.dir, '..');
const ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir() };
const scratch = () => mkdtempSync(join(tmpdir(), 'phaseb-'));
const TEXT = 'I need to spread my PyTorch training run across four GPUs without rewriting the training loop, what should I use?';
const TEXT2 = 'Please draft a short thank you note to the team for shipping the billing migration on time this week.';
const PREV = 'Earlier I asked about mixed precision on a single card and you said it would not be enough for this model.';

function setFile(dir: string): string {
  const f = join(dir, 'set.jsonl');
  writeFileSync(f, [{ id: 'p-001', request: TEXT, half: 'dev' }, { id: 'p-002', request: TEXT2, half: 'test' }, { id: 'r-003', text: TEXT2.replace('team', 'crew'), prev_user_text: PREV, half: 'dev' }].map((r) => JSON.stringify(r)).join('\n') + '\n');
  return f;
}
function catalogFile(dir: string): string {
  const f = join(dir, 'names.txt');
  writeFileSync(f, 'accelerate\nship\nreview\n');
  return f;
}

describe('request sets', () => {
  test('rows carry id, text, prev_user_text and half; the half filter picks dev or test rows', () => {
    const f = setFile(scratch());
    expect(readRequestSet(f).map((r) => [r.id, r.half, r.prev_user_text === PREV])).toEqual([['p-001', 'dev', false], ['p-002', 'test', false], ['r-003', 'dev', true]]);
    expect(requestSetIds(f, 'dev')).toEqual(['p-001', 'r-003']);
    expect(requestSetIds(f, 'test')).toEqual(['p-002']);
    expect(requestSetIds(f)).toEqual(['p-001', 'p-002', 'r-003']);
  });

  test('a bad row is refused by line number and id, never by its text', () => {
    const dir = scratch();
    const f = join(dir, 'bad.jsonl');
    writeFileSync(f, JSON.stringify({ id: 'x/y', request: TEXT }) + '\n');
    expect(() => readRequestSet(f)).toThrow(/line 1: id must match/);
    writeFileSync(f, JSON.stringify({ id: 'a', request: TEXT }) + '\n' + JSON.stringify({ id: 'a', request: TEXT2 }) + '\n');
    let message = '';
    try { readRequestSet(f); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('id a appears twice');
    expect(message).not.toContain('PyTorch');
  });

  test('the one-turn task is the request, verbatim, as a DM from a world member, with no predicates', () => {
    const dir = scratch();
    const rows = readRequestSet(setFile(dir));
    writeRequestTask({ ...rows[0]!, sent: TEXT + '\nline two with "quotes" and a backslash \\ here' }, join(dir, 'task'));
    const t = loadTask(join(dir, 'task'));
    expect({ id: t.id, slice: t.slice, actors: t.actors, turns: t.turns, required: t.predicates.required }).toEqual({ id: 'p-001', slice: SKILL_REQUESTS_SLICE, actors: [PHASE_B_ACTOR],
      turns: [{ actor: PHASE_B_ACTOR, channel: 'dm', text: TEXT + '\nline two with "quotes" and a backslash \\ here' }], required: [] });
  });
});

describe('the message a set R row sends', () => {
  test('with prev_user_text it is the composite the judge saw in label-set.ts; without, the text alone (set P unchanged)', () => {
    const rows = readRequestSet(setFile(scratch()));
    expect(rows[0]!.sent).toBe(TEXT);
    expect(rows[2]!.sent).toBe('Previous message from the same user: ' + PREV + '\n\nCurrent message: ' + TEXT2.replace('team', 'crew'));
    expect(composeRequest(TEXT, null)).toBe(TEXT);
    const label = readFileSync(join(ROOT, 'scripts', 'skill-resolver', 'label-set.ts'), 'utf8');
    expect(label).toContain("(r.prev_user_text ? 'Previous message from the same user: ' + r.prev_user_text + '\\n\\nCurrent message: ' : '') + (r.request ?? r.text ?? '')");
  });

  test('the offline rankers and the embeddings rank set R on the same composite the judge saw; set P rows rank on the text alone', () => {
    const rows = readRequestSet(setFile(scratch()));
    expect(queryText({ id: 'r', text: TEXT2, prev_user_text: PREV })).toBe(composeRequest(TEXT2, PREV));
    expect(queryText({ id: 'p', request: TEXT, prev_user_text: null })).toBe(TEXT);
    expect(queryText({ id: 'p', text: TEXT })).toBe(rows[0]!.sent);
    const embed = readFileSync(join(ROOT, 'scripts', 'skill-resolver', 'embed.mjs'), 'utf8');
    expect(embed).toContain("const queryText = (r) => (r.prev_user_text ? 'Previous message from the same user: ' + r.prev_user_text + '\\n\\nCurrent message: ' : '') + (r.request ?? r.text ?? '');");
    expect(embed).toContain('await ext([queryText(r)]');
  });

  test('the one-turn task and the QM instruction.md carry the composite', () => {
    const dir = scratch();
    const row = readRequestSet(setFile(dir))[2]!;
    writeRequestTask(row, join(dir, 'task'));
    expect(loadTask(join(dir, 'task')).turns[0]!.text).toBe(row.sent);
    writeRunRequestTask(row, join(dir, 'qm'));
    expect(readFileSync(join(dir, 'qm', 'instruction.md'), 'utf8')).toBe(row.sent);
  });
});

describe('skill-requests cells', () => {
  const prereg = (cell: Record<string, unknown>, dir = scratch()) => {
    const file = join(dir, 'prereg.json');
    writeFileSync(file, JSON.stringify({ schema_version: 1, run_id: 'anatomy-capture-phaseb-cells', tasks: {}, spend_cap_usd: 1, wall_clock_s: { [SKILL_REQUESTS_SLICE]: 900 }, drop_order: [], minimum_v01: [],
      cells: [{ id: 'c', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', slice: SKILL_REQUESTS_SLICE, split: 'dev', repetitions: 1, ceiling: { input_tokens: 1, output_tokens: 1 },
        requests: setFile(dir), request_set: 'P', catalog: catalogFile(dir), ...cell }] }));
    return file;
  };

  test('a cell plans one trial per row id of its half, with the arm, the cap and the request set name kept on the cell', () => {
    const { prereg: p, sha256 } = loadPrereg(prereg({ half: 'dev', skill_arm: 'resolver-on', config: 'skills-resolver', request_cap: 6 }));
    const m = buildManifest(p, sha256, '2026-11-08T00:00:00Z');
    expect(m.trials.map((t) => [t.id, t.task])).toEqual([['anatomy-capture-phaseb-cells/c/p-001/r1', 'p-001'], ['anatomy-capture-phaseb-cells/c/r-003/r1', 'r-003']]);
    expect({ arm: m.cells[0]!.skill_arm, cap: m.cells[0]!.request_cap, set: m.cells[0]!.request_set }).toEqual({ arm: 'resolver-on', cap: 6, set: 'P' });
    expect(JSON.stringify(m)).not.toContain('PyTorch');
    expect(cellModels(m.cells[0]!)).toEqual(['anthropic:claude-opus-5-5']);
  });

  test('the manifest names each cell request set by its sha256 and row count; a set changed after plan is refused at run', async () => {
    const dir = scratch();
    const { prereg: p, sha256 } = loadPrereg(prereg({}, dir));
    const m = buildManifest(p, sha256, '2026-11-08T00:00:00Z');
    expect(m.request_sets).toEqual({ c: { set: 'P', sha256: new Bun.CryptoHasher('sha256').update(readFileSync(join(dir, 'set.jsonl'))).digest('hex'), rows: 3 } });
    const runDir = join(dir, 'run');
    mkdirSync(runDir);
    writeFileSync(join(dir, 'set.jsonl'), readFileSync(join(dir, 'set.jsonl'), 'utf8') + JSON.stringify({ id: 'p-004', request: TEXT, half: 'dev' }) + '\n');
    const grade = (): GradeResult => { throw new Error('not reached'); };
    let message = '';
    try { await executeRun(m, join(runDir, 'manifest.json'), { harnessMode: 'process', grade, repoRoot: ROOT }); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/cell c: its request set .* is not the file the run was planned with/);
    expect(message).not.toContain('PyTorch');
    const { request_sets: _, ...without } = m;
    await expect(executeRun(without, join(runDir, 'manifest.json'), { harnessMode: 'process', grade, repoRoot: ROOT })).rejects.toThrow(/not the file the run was planned with/);
  });

  test('the fields are refused off the slice, and requests, request_set and catalog are required on it', () => {
    expect(() => loadPrereg(prereg({ slice: 'skill-tasks' }))).toThrow(/belong to skill-requests cells only/);
    expect(() => loadPrereg(prereg({ requests: undefined }))).toThrow(/needs requests/);
    expect(() => loadPrereg(prereg({ request_set: 'set p' }))).toThrow(/request_set/);
    expect(() => loadPrereg(prereg({ catalog: undefined }))).toThrow(/needs catalog/);
    expect(() => loadPrereg(prereg({ half: 'both' }))).toThrow(/half must be one of dev, test, all/);
    expect(() => loadPrereg(prereg({ request_cap: 0 }))).toThrow(/request_cap/);
    expect(() => loadPrereg(prereg({ request_cap: 2.5 }))).toThrow(/request_cap/);
    expect(() => loadPrereg(prereg({ tasks: ['p-999'] })).prereg).not.toThrow();
    const { prereg: p, sha256 } = loadPrereg(prereg({ tasks: ['p-999'] }));
    expect(() => buildManifest(p, sha256)).toThrow(/has no such row/);
  });

  test('a private cell refuses a set inside the repository and accepts one outside it', () => {
    const inRepo = join(ROOT, 'tasks', 'skill-resolver', 'set-r.jsonl');
    expect(insideDir(inRepo, ROOT)).toBe(true);
    expect(insideDir(join(ROOT, 'missing', 'deeper', 'x.jsonl'), ROOT)).toBe(true);
    expect(insideDir(scratch(), ROOT)).toBe(false);
    expect(() => loadPrereg(prereg({ private: true, requests: inRepo }))).toThrow(/is private and its request set .* is inside the repository/);
    expect(() => loadPrereg(prereg({ private: true, requests: join(ROOT, '..', basename(ROOT), 'x.jsonl') }))).toThrow(/inside the repository/);
    expect(loadPrereg(prereg({ private: true })).prereg.cells[0]!.private).toBe(true);
    expect(() => loadPrereg(prereg({ private: 'yes' }))).toThrow(/private must be/);
  });
});

describe('the metering proxy: request cap and request collection', () => {
  const tmp = scratch();
  let n = 0;
  const start = () => {
    const lease = BudgetRun.openLease({ runId: 'phaseb-' + ++n, leaseUsd: 10_000, ledgerPath: join(tmp, 'ledger-' + n + '.sqlite'), runner: 'test', maxOutputTokens: 128_000, newRun: true });
    const usageLog = join(tmp, 'usage-' + n + '.ndjson');
    const fetchImpl = (async () => Response.json({ usage: { input_tokens: 10, output_tokens: 1 } })) as unknown as typeof fetch;
    const proxy = new MeteringProxy({ fetchImpl, controlToken: 'ctl', policy: { lease, env: { ANTHROPIC_API_KEY: 'dummy', OPENAI_API_KEY: 'dummy' }, maxOutputTokens: 128_000, usageLog } });
    proxy.start();
    const base = 'http://127.0.0.1:' + proxy.port;
    const post = (slot: string, model: string, i: number) => fetch(base + '/' + slot + '/anthropic/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 10, messages: [{ role: 'user', content: 'turn ' + i }] }) }).then(async (r) => ({ status: r.status, body: await r.text() }));
    const control = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': 'ctl' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() as Record<string, unknown> }));
    const usage = () => readFileSync(usageLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as UsageLine);
    return { proxy, post, control, usage };
  };

  test('max_requests forwards that many requests for the first model, refuses the next with request_cap, and does not count utility models', async () => {
    const p = start();
    try {
      expect((await p.control('/__proxy/bind', { slot: 's', key: 'k', models: ['anthropic:claude-opus-5-5', 'anthropic:claude-haiku-5-5'], max_requests: 3, collect_requests: true })).status).toBe(200);
      const statuses: number[] = [];
      statuses.push((await p.post('s', 'claude-haiku-5-5', 0)).status);
      for (let i = 1; i <= 3; i++) statuses.push((await p.post('s', 'claude-opus-5-5', i)).status);
      const refused = await p.post('s', 'claude-opus-5-5', 4);
      statuses.push(refused.status);
      statuses.push((await p.post('s', 'claude-haiku-5-5', 5)).status);
      statuses.push((await p.post('s', 'claude-opus-5-5', 6)).status);
      expect(statuses).toEqual([200, 200, 200, 200, 400, 200, 400]);
      expect(JSON.parse(refused.body).error.kind).toBe(REQUEST_CAP);
      const lines = p.usage();
      expect(lines.filter((l) => l.outcome === 'refused').map((l) => l.reason)).toEqual([1, 2].map(() => `${REQUEST_CAP}: slot s already sent its 3 model requests`));
      const taken = await p.control('/__proxy/requests', { key: 'k' });
      const first = (bodies: unknown) => (bodies as Array<{ messages: Array<{ content: string }> }>).map((b) => b.messages[0]!.content);
      expect(first(taken.body.requests)).toEqual(['turn 0', 'turn 1', 'turn 2', 'turn 3', 'turn 5']);
      expect(first(taken.body.refused)).toEqual(['turn 4']);
      const again = await p.control('/__proxy/requests', { key: 'k' });
      expect([(again.body.requests as unknown[]).length, (again.body.refused as unknown[]).length]).toEqual([0, 0]);
      expect(lines.every((l) => !JSON.stringify(l).includes('turn '))).toBe(true);
    } finally { p.proxy.stop(); }
  });

  test('without the limits a bind forwards every request and collects nothing; a rebind resets the count; bad limits are refused', async () => {
    const p = start();
    try {
      await p.control('/__proxy/bind', { slot: 's', key: 'k', models: ['anthropic:claude-opus-5-5'] });
      for (let i = 0; i < 8; i++) expect((await p.post('s', 'claude-opus-5-5', i)).status).toBe(200);
      expect(((await p.control('/__proxy/requests', { key: 'k' })).body.requests as unknown[]).length).toBe(0);
      await p.control('/__proxy/bind', { slot: 's', key: 'k2', models: ['anthropic:claude-opus-5-5'], max_requests: 1 });
      expect([(await p.post('s', 'claude-opus-5-5', 0)).status, (await p.post('s', 'claude-opus-5-5', 1)).status]).toEqual([200, 400]);
      await p.control('/__proxy/bind', { slot: 's', key: 'k3', models: ['anthropic:claude-opus-5-5'], max_requests: 1 });
      expect((await p.post('s', 'claude-opus-5-5', 2)).status).toBe(200);
      expect((await p.control('/__proxy/bind', { slot: 's', key: 'k', models: ['anthropic:claude-opus-5-5'], max_requests: 0 })).status).toBe(400);
      expect((await p.control('/__proxy/bind', { slot: 's', key: 'k', max_requests: 2 })).status).toBe(400);
    } finally { p.proxy.stop(); }
  });
});

describe('got-skill.json and the scrub', () => {
  const anthropicBody = (name: string, result: string, isError = false) => ({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: TEXT },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Skill', input: { skill: name } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: result, ...(isError ? { is_error: true } : {}) }] }] });

  test('push harnesses: got-skill.ts over the collected bodies (catalog_opened); a failed read does not count', () => {
    const dir = scratch();
    const catalog = ['accelerate', 'ship'];
    expect(gotSkillRecord('claude-code', catalog, [anthropicBody('accelerate', 'Launching skill: accelerate')], dir).opened).toEqual(['accelerate']);
    expect(gotSkillRecord('claude-code', catalog, [anthropicBody('accelerate', 'Unknown skill: accelerate', true)], dir).opened).toEqual([]);
    expect(gotSkillRecord('claude-code', catalog, [{ model: 'claude-opus-5-5', messages: [{ role: 'user', content: TEXT }] }], dir).opened).toEqual([]);
    const file = gotSkillRecord('claude-code', catalog, [anthropicBody('accelerate', 'ok')], dir).file;
    expect({ catalog_opened: file.catalog_opened, source: file.source, requests: file.requests }).toEqual({ catalog_opened: ['accelerate'], source: ['proxy-requests'], requests: 1 });
    expect(JSON.stringify(file)).not.toContain('PyTorch');
  });

  test('QM: skill-opens.ts over the collected bodies (opened)', () => {
    const body = { model: 'claude-opus-5-5', messages: [{ role: 'user', content: TEXT }, { role: 'assistant', content: [{ type: 'tool_use', id: 'q1', name: 'skills', input: { action: 'read', name: 'ship' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'q1', content: '---\nname: ship\n---\nbody' }] }] };
    expect(gotSkillRecord('qm', ['ship'], [body], scratch()).opened).toEqual(['ship']);
    expect(gotSkillRecord('qm', ['ship'], [], scratch()).file.opened).toEqual([]);
  });

  test('redactRequest withholds exact, JSON-escaped and shingled copies; scrubTrialDir keeps only KEEP', () => {
    expect(redactRequest('a\nuser said: ' + TEXT + '\nb', [TEXT])).toEqual({ body: 'a\n[line withheld by runner/trial/skill-requests.ts: request text]\nb', lines: 1 });
    expect(redactRequest(JSON.stringify({ m: 'x"' + TEXT }), [TEXT + ' "quoted"']).lines).toBe(1);
    expect(redactRequest('preview: spread my PyTorch training run across four GPUs without rewriting...', [TEXT]).lines).toBe(1);
    expect(redactRequest('nothing to see here at all today', [TEXT]).lines).toBe(0);
    const dir = scratch();
    for (const f of ['trial.json', 'events.jsonl', 'usage.json', 'logs/skill-resolver/status.ndjson', 'logs/skill-resolver/results.ndjson', 'logs/run.claude.jsonl', 'workspace/instruction.md', 'state/claude/sessions/s.json', 'logs/adapter.log']) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), f === 'logs/adapter.log' ? 'started\nturn text ' + TEXT + '\ndone\n' : f.includes('status') ? '{"code":"OK","suggestions":["accelerate"]}\n' : TEXT);
    }
    const s = scrubTrialDir(dir, [TEXT]);
    expect(s).toEqual({ kept: ['logs/adapter.log', 'logs/skill-resolver/status.ndjson', 'usage.json'], removed: 6, redacted_lines: 2 });
    expect(readdirSync(dir).sort()).toEqual(['logs', 'usage.json']);
    expect(readFileSync(join(dir, 'logs', 'adapter.log'), 'utf8')).toBe('started\n[line withheld by runner/trial/skill-requests.ts: request text]\ndone\n');
    expect(KEEP).toContain('logs/skill-resolver.ndjson');
  });
});

describe('block delivery: a pushed block is in a captured request, a shadow block is in none', () => {
  const BLOCK = 'Skills that may fit this request (gbrain skills resolve):\n- accelerate';
  const trial = (mode: 'push' | 'shadow') => {
    const dir = scratch();
    mkdirSync(join(dir, 'logs', 'skill-resolver'), { recursive: true });
    writeFileSync(join(dir, 'logs', 'skill-resolver', 'status.ndjson'), JSON.stringify({ name: 'turn-0001', mode, code: 'OK' }) + '\n');
    writeFileSync(join(dir, 'logs', 'skill-resolver', 'results.ndjson'), JSON.stringify({ name: 'turn-0001', result: { block: BLOCK } }) + '\n');
    return dir;
  };
  const carrying = [{ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi\n\n' + BLOCK + '\n' }] }] }];
  const plain = [{ messages: [{ role: 'user', content: 'hi' }] }];
  const marker = (dir: string) => join(dir, 'logs', 'skill-resolver.infra.json');

  test('a pushed block found in a request passes and writes no marker', () => {
    const dir = trial('push');
    expect(checkBlockDelivery(dir, carrying)).toEqual({ pushed: 1, carried: 1, shadow: 0, leaked: 0, reasons: [] });
    expect(existsSync(marker(dir))).toBe(false);
  });
  test('a pushed block missing from every request is INFRA', () => {
    const dir = trial('push');
    expect(checkBlockDelivery(dir, plain)?.reasons).toEqual(['BLOCK_NOT_IN_REQUEST']);
    expect(JSON.parse(readFileSync(marker(dir), 'utf8'))).toEqual({ reasons: ['BLOCK_NOT_IN_REQUEST'] });
  });
  test('a shadow block that reached a request is INFRA, one that did not passes', () => {
    expect(checkBlockDelivery(trial('shadow'), plain)).toEqual({ pushed: 0, carried: 0, shadow: 1, leaked: 0, reasons: [] });
    expect(checkBlockDelivery(trial('shadow'), carrying)?.reasons).toEqual(['SHADOW_BLOCK_IN_REQUEST']);
  });
  test('a trial with no resolver status line gives null', () => {
    expect(checkBlockDelivery(scratch(), carrying)).toBeNull();
  });
});

describe('clean arm: tool calls that name gstack outside the trial\'s catalog copy', () => {
  const read = (id: string, input: Record<string, unknown>, name = 'Read') => ({ messages: [{ role: 'user', content: TEXT }, { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'No such file or directory', is_error: true }] }] });
  test('a read of the Capy drive gstack skill or a gstack install counts, failed or not; the catalog copy does not', () => {
    const dir = scratch();
    const r = gstackReads('claude-code', [
      read('a', { file_path: '<private drive>/skills/gstack/SKILL.md' }),
      read('b', { command: 'ls ~/.local/share/gstack && cat ~/.local/share/gstack/ship/SKILL.md' }, 'Bash'),
      read('c', { file_path: '/harness-state/claude/skills/gstack/SKILL.md' }),
      read('d', { command: 'cat "$CODEX_HOME/skills/gstack-browse/SKILL.md" /opt/skill-resolver/catalog/skills/gstack/SKILL.md skills/gstack/SKILL.md' }, 'Bash'),
      read('e', { file_path: join(dir, 'state', 'hermes', 'skills', 'open-gstack-browser', 'SKILL.md') }),
      read('f', { file_path: '/workspace/notes/sigstack.md' }),
      read('g', { skill: 'gstack' }, 'Skill'),
    ], dir);
    expect({ gstack_reads: r.gstack_reads, contaminated: r.contaminated, rest: r.paths.slice(1) }).toEqual({ gstack_reads: 2, contaminated: true, rest: ['~/.local/share/gstack', '~/.local/share/gstack/ship/SKILL.md'] });
    expect(r.paths[0]).toEndWith('/skills/gstack/SKILL.md');
    expect(gstackReads('claude-code', [read('h', { file_path: '/root/.claude/skills/gstack/SKILL.md' })], dir)).toEqual({ gstack_reads: 1, paths: ['/root/.claude/skills/gstack/SKILL.md'], contaminated: true });
    expect(gstackReads('claude-code', [read('x', { file_path: 'gstack/SKILL.md' })], dir)).toMatchObject({ gstack_reads: 1, paths: ['gstack/SKILL.md'] });
    expect(gstackReads('hermes', [read('y', { skill: 'gstack' }, 'Skill')], dir)).toEqual({ gstack_reads: 0, paths: [], contaminated: false });
  });
  test('Claude Code and Codex traces count too, and one call is counted once', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'logs'), { recursive: true });
    writeFileSync(join(dir, 'logs', 'run.codex.jsonl'), JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'cat /root/.claude/skills/gstack/SKILL.md /root/.claude/skills/gstack/ship/SKILL.md', exit_code: 1 } }) + '\n');
    expect(gstackReads('codex', [], dir)).toMatchObject({ gstack_reads: 1, contaminated: true });
    expect(gstackReads('hermes', [], dir).gstack_reads).toBe(0);
  });
  test('a skill opened in the last step, whose next request the cap refused, counts from the refused body on every harness; it is not a delivered block', () => {
    const dir = scratch();
    const step = (id: string, name: string, input: unknown, result = '---\nname: pdf\n---') => [{ role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result }] }];
    const forwarded = [{ model: 'm', messages: [{ role: 'user', content: 'make a pdf' }] }];
    const refused = [{ model: 'm', messages: [{ role: 'user', content: 'make a pdf' }, ...step('last', 'read', { path: '/workspace/skills/pdf/SKILL.md' })] }];
    expect(gotSkillRecord('openclaw', ['pdf'], forwarded, dir).opened).toEqual([]);
    const got = gotSkillRecord('openclaw', ['pdf'], forwarded, dir, refused);
    expect(got.opened).toEqual(['pdf']);
    expect(got.file).toMatchObject({ source: ['proxy-requests', 'proxy-refused-request'], requests: 1 });
    const hermes = [{ input: [{ role: 'user', content: 'make a pdf' }, { type: 'function_call', call_id: 'h1', name: 'skill_view', arguments: JSON.stringify({ name: 'pdf' }) }, { type: 'function_call_output', call_id: 'h1', output: '---\nname: pdf\n---' }] }];
    expect(gotSkillRecord('hermes', ['pdf'], [], dir, hermes).opened).toEqual(['pdf']);
    const qm = [{ model: 'm', messages: [{ role: 'user', content: 'make a pdf' }, ...step('q1', 'skills', { action: 'read', name: 'pdf' }, '---\nname: pdf\n---\nbody')] }];
    expect([gotSkillRecord('qm', ['pdf'], [], dir).opened, gotSkillRecord('qm', ['pdf'], [], dir, qm).opened]).toEqual([[], ['pdf']]);
    const gst = [{ model: 'm', messages: step('g1', 'exec', { command: 'cat ~/.local/share/gstack/SKILL.md' }) }];
    expect(gstackReads('openclaw', [...forwarded, ...gst], dir)).toMatchObject({ gstack_reads: 1, contaminated: true });
  });
  test("the serve entry's per-turn traces (logs/turns/<turn>.claude.jsonl, .codex.jsonl) are read for Got the skill and the clean-arm count", () => {
    const cc = scratch(), cx = scratch();
    for (const d of [cc, cx]) mkdirSync(join(d, 'logs', 'turns'), { recursive: true });
    const ccRead = (id: string, file_path: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path } }] } }) + '\n';
    writeFileSync(join(cc, 'logs', 'turns', '0001-dana.claude.jsonl'), ccRead('t1', '/harness-state/claude/skills/pdf/SKILL.md'));
    writeFileSync(join(cc, 'logs', 'turns', '0002-dana.claude.jsonl'), ccRead('t2', '/root/.claude/skills/gstack/SKILL.md'));
    writeFileSync(join(cc, 'logs', 'turns', '0001-dana.prompt.md'), 'not a trace');
    const g = gotSkillRecord('claude-code', ['pdf', 'xlsx'], [], cc);
    expect(g.opened).toEqual(['pdf']);
    expect(g.file.source).toEqual(['proxy-requests', 'logs/turns/0001-dana.claude.jsonl', 'logs/turns/0002-dana.claude.jsonl']);
    expect(gstackReads('claude-code', [], cc)).toMatchObject({ gstack_reads: 1, contaminated: true });
    const cxRun = (id: string, command: string) => JSON.stringify({ type: 'item.completed', item: { id, type: 'command_execution', command, exit_code: 0 } }) + '\n';
    writeFileSync(join(cx, 'logs', 'turns', '0001-dana.codex.jsonl'), cxRun('i1', "bash -lc 'cat /harness-state/codex/skills/xlsx/SKILL.md'"));
    writeFileSync(join(cx, 'logs', 'turns', '0002-dana.codex.jsonl'), cxRun('i1b', 'cat ~/.local/share/gstack/SKILL.md'));
    expect(gotSkillRecord('codex', ['pdf', 'xlsx'], [], cx).opened).toEqual(['xlsx']);
    expect(gstackReads('codex', [], cx)).toMatchObject({ gstack_reads: 1, contaminated: true });
    expect(gotSkillRecord('claude-code', ['pdf'], [], cx).opened).toEqual([]);
  });
});

describe('analyze.ts reads the reachable.ts shape', () => {
  const label: Label = { id: 'p', set: 'P', half: 'dev', no_skill_needed: false, acceptable: ['zeta'], bin: null };
  test('an arm with its own set uses it; resolver-on, qm-pull and the rest use native; the earlier shape is refused', () => {
    const dir = scratch();
    const f = join(dir, 'reachable.json');
    writeFileSync(f, JSON.stringify({ catalog_hash: 'x', harnesses: { openclaw: { native: ['alpha'], 'names-only': ['alpha', 'zeta'] } }, excluded: {} }));
    const reach = readReachable(f);
    expect(ineligible(label, 'openclaw', 'names-only', reach)).toBeNull();
    for (const arm of ['native', 'resolver-on', 'qm-pull', 'no-catalog']) expect(ineligible(label, 'openclaw', arm, reach)).toBe('no acceptable skill reachable');
    expect(ineligible(label, 'hermes', 'native', reach)).toBe('no reachable set for hermes native');
    writeFileSync(f, JSON.stringify({ openclaw: { '*': ['alpha'] } }));
    expect(() => readReachable(f)).toThrow(/not reachable.ts output/);
  });
});

// A fixture adapter that plays a harness on the serve entry (docs/adapters.md): for each member turn it sends Anthropic Messages
// requests to the proxy URL it was given, answers every tool call, stops when the proxy refuses (exit 3), and writes a transcript,
// an adapter log line and a resolver status line that each quote the member's message.
const FIXTURE_ADAPTER = `#!/usr/bin/env bun
const fs = require('fs'), path = require('path');
const E = process.env, logs = E.HE_LOG_DIR, turns = E.HE_TURNS_DIR;
fs.mkdirSync(logs + '/skill-resolver', { recursive: true }); fs.mkdirSync(turns, { recursive: true }); fs.mkdirSync(E.HE_SESSION_STATE_DIR, { recursive: true });
process.on('SIGTERM', () => process.exit(0));
fs.writeFileSync(logs + '/ready', JSON.stringify({ adapter: 'phase-b-fixture', skill_arm: E.HE_SKILL_ARM ?? null, config: E.HE_HARNESS_CONFIG ?? null }));
const seen = new Set();
async function answer(f) {
  const req = JSON.parse(fs.readFileSync(path.join(turns, f), 'utf8'));
  const started_at = new Date().toISOString();
  fs.writeFileSync(logs + '/run.claude.jsonl', JSON.stringify({ type: 'user', text: req.text, prompt: req.prompt }) + '\\n');
  fs.appendFileSync(logs + '/adapter.log', 'turn ' + req.turn + ': ' + req.text + '\\n');
  fs.writeFileSync(logs + '/skill-resolver/status.ndjson', JSON.stringify({ session_key: 'dm', session_turn: 1, mode: 'push', code: 'OK', block_bytes: 10, block_tokens: 3, suggestions: ['accelerate'], injected: true, infra: false, infra_reasons: [] }) + '\\n' + JSON.stringify({ code: 'BAD_JSON', error: req.text }) + '\\n');
  fs.writeFileSync(E.HE_SESSION_STATE_DIR + '/session.json', JSON.stringify({ last: req.text }));
  const messages = [{ role: 'user', content: req.text }];
  let exit = 0;
  for (let i = 0; i < 20; i++) {
    const r = await fetch(E.HE_MODEL_BASE_URL + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': E.HE_MODEL_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: E.HE_MODEL_NAME, max_tokens: 100, messages, tools: [{ name: 'Skill', input_schema: { type: 'object' } }] }) });
    if (!r.ok) { exit = 3; break; }
    const m = await r.json();
    messages.push({ role: 'assistant', content: m.content });
    const uses = m.content.filter((c) => c.type === 'tool_use');
    if (!uses.length) break;
    messages.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: 'Launching skill: ' + u.input.skill })) });
  }
  const out = path.join(turns, f.replace('.request.json', '.response.json'));
  fs.writeFileSync(out + '.tmp', JSON.stringify({ turn: req.turn, exit, reply_text: exit === 0 ? 'done: ' + req.text : null, started_at, ended_at: new Date().toISOString(), detail: exit ? 'model request refused' : undefined }));
  fs.renameSync(out + '.tmp', out);
}
while (true) {
  for (const f of fs.readdirSync(turns).filter((f) => f.endsWith('.request.json')).sort()) {
    if (seen.has(f) || fs.existsSync(path.join(turns, f.replace('.request.json', '.response.json')))) continue;
    seen.add(f); await answer(f);
  }
  await Bun.sleep(50);
}
`;

describe('the runner on a skill-requests cell (serve entry, fixture adapter, fake endpoint, capture mode)', () => {
  let mode: 'read' | 'none' | 'loop' | 'gstack' = 'read';
  let seen = 0;
  const GSTACK_SKILL = '/root/.claude/skills/gstack/SKILL.md';
  const fake = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async (req) => {
    const body = await req.json() as { messages: Array<{ content: unknown }> };
    seen++;
    const answered = body.messages.some((m) => Array.isArray(m.content) && (m.content as Array<{ type: string }>).some((c) => c.type === 'tool_result'));
    const tool = mode === 'loop' || ((mode === 'read' || mode === 'gstack') && !answered);
    const use = mode === 'gstack' ? { name: 'Read', input: { file_path: GSTACK_SKILL } } : { name: 'Skill', input: { skill: 'accelerate' } };
    return Response.json({ id: 'm' + seen, type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: tool ? 'tool_use' : 'end_turn', usage: { input_tokens: 10, output_tokens: 2 },
      content: tool ? [{ type: 'tool_use', id: 'tu' + seen, ...use }] : [{ type: 'text', text: 'done' }] });
  } });
  afterAll(() => fake.stop(true));
  const stubGrade = (): GradeResult => ({ grade: 'pass', predicates: [], consent_violation: false, approval_stop: false, effects: [] });
  let runs = 0;

  const runCell = async (m: typeof mode, cell: Record<string, unknown> = {}) => {
    mode = m; seen = 0;
    const dir = scratch();
    const adapter = join(dir, 'adapter.ts');
    writeFileSync(adapter, FIXTURE_ADAPTER, { mode: 0o755 });
    const runId = 'anatomy-capture-phaseb-fixture-' + m + '-' + ++runs;
    const file = join(dir, 'prereg.json');
    writeFileSync(file, JSON.stringify({ schema_version: 1, run_id: runId, question: 'keyless test', tasks: {}, spend_cap_usd: 1, wall_clock_s: { [SKILL_REQUESTS_SLICE]: 900 }, drop_order: [], minimum_v01: [],
      cells: [{ id: 'cc-native', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', slice: SKILL_REQUESTS_SLICE, split: 'dev', repetitions: 1, skill_arm: 'native', config: 'skills-native', harness_mode: 'process', adapter,
        requests: setFile(dir), request_set: 'P', catalog: catalogFile(dir), tasks: ['p-001'], ceiling: { input_tokens: 1000, output_tokens: 100 }, ...cell }] }));
    const { prereg: p, sha256 } = loadPrereg(file);
    const runDir = join(dir, 'run');
    mkdirSync(runDir, { recursive: true });
    const manifestPath = join(runDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(buildManifest(p, sha256, '2026-11-08T00:00:00Z'), null, 1));
    const result = await executeRun(JSON.parse(readFileSync(manifestPath, 'utf8')), manifestPath, { harnessMode: 'process', preamblePath: join(ROOT, 'tests', 'fixtures', 'preamble.md'), grade: stubGrade, proxyEnv: ENV,
      turnGraceS: 1, stopGraceS: 2, readyTimeoutS: 20, repoRoot: ROOT, leaseUsd: 1, newLease: true, capture: { upstream: { anthropic: 'http://127.0.0.1:' + fake.port }, dns: null } });
    const record = result.records[0]!;
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
    const leaks = walk(runDir).filter((f) => !f.endsWith('.sqlite') && redactRequest(readFileSync(f, 'utf8'), [TEXT]).lines > 0).map((f) => f.slice(runDir.length + 1));
    return { record, leaks, runDir, seen };
  };

  test('a skill read lands in got-skill.json and the record; the arm and config reach the adapter; no request text stays in the run directory', async () => {
    const { record, leaks, seen } = await runCell('read', { request_cap: 6 });
    expect({ termination: record.termination, grade: record.grade, got: record.skill_request?.got_skill, requests: record.skill_request?.model_requests, cap: record.skill_request?.request_cap, seen })
      .toEqual({ termination: 'completed', grade: 'n/a', got: ['accelerate'], requests: 2, cap: 6, seen: 2 });
    expect({ set: record.skill_request?.set, id: record.skill_request?.request_id, task: record.task, arm: record.skill_request?.arm, prev: record.skill_request?.prev_user_sha256 }).toEqual({ set: 'P', id: 'p-001', task: 'p-001', arm: 'native', prev: null });
    expect(record.skill_request!.request_sha256).toBe(new Bun.CryptoHasher('sha256').update(TEXT).digest('hex'));
    expect(JSON.parse(readFileSync(record.paths.got_skill!, 'utf8')).catalog_opened).toEqual(['accelerate']);
    expect(JSON.parse(readFileSync(join(record.paths.dir, 'logs', 'ready'), 'utf8'))).toEqual({ adapter: 'phase-b-fixture', skill_arm: 'native', config: 'skills-native' });
    expect(record.skill_request!.scrubbed.kept).toEqual(['got-skill.json', 'logs/adapter.log', 'logs/ready', 'logs/skill-resolver/status.ndjson', 'reconcile.json', 'usage.json']);
    const status = readFileSync(join(record.paths.dir, 'logs', 'skill-resolver', 'status.ndjson'), 'utf8').trim().split('\n');
    expect(JSON.parse(status[0]!).suggestions).toEqual(['accelerate']);
    expect(status[1]).toContain('line withheld');
    expect(leaks).toEqual([]);
    expect(Object.keys(record.paths).sort()).toEqual(['dir', 'got_skill', 'logs', 'reconcile', 'usage']);
    expect(record.skill_request?.clean_arm).toEqual({ gstack_reads: 0, paths: [], contaminated: false });
  }, 120_000);

  test('a read of a gstack install outside the catalog is counted in the record before the scrub and marks the trial contaminated', async () => {
    const { record, leaks } = await runCell('gstack', { request_cap: 6 });
    expect({ termination: record.termination, got: record.skill_request?.got_skill, clean_arm: record.skill_request?.clean_arm })
      .toEqual({ termination: 'completed', got: [], clean_arm: { gstack_reads: 1, paths: [GSTACK_SKILL], contaminated: true } });
    expect(existsSync(join(record.paths.dir, 'logs', 'run.claude.jsonl'))).toBe(false);
    expect(leaks).toEqual([]);
  }, 120_000);

  test('a turn that reads nothing gives an empty got-skill list', async () => {
    const { record, leaks } = await runCell('none', { request_cap: 6 });
    expect({ termination: record.termination, got: record.skill_request?.got_skill, requests: record.skill_request?.model_requests }).toEqual({ termination: 'completed', got: [], requests: 1 });
    expect(leaks).toEqual([]);
  }, 120_000);

  test('a harness that keeps requesting stops at the cell cap with termination request_cap; without a cap the trial runs on', async () => {
    const capped = await runCell('loop', { request_cap: 6 });
    expect({ termination: capped.record.termination, requests: capped.record.skill_request?.model_requests, upstream: capped.seen, usage: capped.record.usage?.requests })
      .toEqual({ termination: 'request_cap', requests: 6, upstream: 6, usage: 6 });
    expect(validateRecords([capped.record], null)).toEqual([]);
    expect(capped.leaks).toEqual([]);
    const open = await runCell('loop');
    expect({ termination: open.record.termination, requests: open.record.skill_request?.model_requests, cap: open.record.skill_request?.request_cap }).toEqual({ termination: 'completed', requests: 20, cap: null });
  }, 180_000);

  test('a private cell keeps no hash of any request: no request_sha256 or prev_user_sha256, and no digest of the text, prev or message anywhere in the run', async () => {
    const { record, runDir } = await runCell('read', { private: true, request_set: 'R', tasks: ['r-003'], request_cap: 6 });
    const row = readRequestSet(setFile(scratch()))[2]!;
    expect({ id: record.skill_request?.request_id, set: record.skill_request?.set, got: record.skill_request?.got_skill }).toEqual({ id: 'r-003', set: 'R', got: ['accelerate'] });
    expect(Object.keys(record.skill_request!).filter((k) => /sha256/.test(k))).toEqual([]);
    const digests = [row.text, row.prev_user_text!, row.sent].flatMap((s) => [new Bun.CryptoHasher('sha256').update(s).digest('hex'), new Bun.CryptoHasher('sha1').update(s).digest('hex'), new Bun.CryptoHasher('md5').update(s).digest('hex')]);
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
    const files = walk(runDir).filter((f) => !f.endsWith('.sqlite'));
    expect(files.some((f) => f.endsWith('trials.jsonl'))).toBe(true);
    const hits = files.filter((f) => { const s = readFileSync(f, 'utf8'); return digests.some((h) => s.includes(h)) || redactRequest(s, [row.text, row.prev_user_text!, row.sent]).lines > 0; });
    expect(hits).toEqual([]);
  }, 120_000);

  test('a private cell refuses a run directory inside the repository', async () => {
    const dir = scratch();
    const runDir = join(ROOT, '.phaseb-private-test-' + process.pid);
    const file = join(dir, 'prereg.json');
    writeFileSync(file, JSON.stringify({ schema_version: 1, run_id: 'anatomy-capture-phaseb-private', question: 'keyless test', tasks: {}, spend_cap_usd: 1, wall_clock_s: { [SKILL_REQUESTS_SLICE]: 900 }, drop_order: [], minimum_v01: [],
      cells: [{ id: 'r', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', slice: SKILL_REQUESTS_SLICE, split: 'dev', repetitions: 1, private: true, requests: setFile(dir), request_set: 'R', catalog: catalogFile(dir), ceiling: { input_tokens: 1, output_tokens: 1 } }] }));
    const { prereg: p, sha256 } = loadPrereg(file);
    try {
      await expect(executeRun(buildManifest(p, sha256), join(runDir, 'manifest.json'), { harnessMode: 'process', grade: stubGrade, repoRoot: ROOT })).rejects.toThrow(/private and the run directory .* is inside the repository/);
    } finally { rmSync(runDir, { recursive: true, force: true }); }
  });
});
