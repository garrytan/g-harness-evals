// The zero-data-retention gate of the frontier Harbor path (internal-task): the fake upstream's Responses tool turn and its
// 400 for a chained request, and zdr-check.ts reading an install check's captures. Keyless, in-process.
//
// Value: protects=(a) the fake upstream answers a Responses request that declares a function tool with one call of it,
// answers the turn that carries its output with text, and refuses a request chained on previous_response_id with
// OpenAI's zero-data-retention 400; (b) zdr-check.ts passes a cell only when no request chained and a tool-output turn
// was seen (or the route is Chat Completions), and exits 4 otherwise; fails_when=a harness that chains, or one the probe
// never drove to a second turn, passes the gate; seam=fixture captures in the install check's layout; no_claim=a real
// harness or the real API.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { placeholderArgs, reply, requestFacts, ZDR_ERROR } from '../scripts/frontier-harbor/fake-upstream.ts';
import { checkZdr } from '../scripts/frontier-harbor/zdr-check.ts';

const ROOT = join(import.meta.dir, '..');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const shell = { type: 'function', name: 'exec_command', parameters: { type: 'object', properties: { cmd: { type: 'array', items: { type: 'string' } }, workdir: { type: 'string' } }, required: ['cmd'] } };

describe('(a) the fake upstream drives a second Responses turn and refuses a chained one', () => {
  test('a request with a function tool gets one call of it; the turn carrying its output gets text', async () => {
    const first = await (reply('/v1/responses', { model: 'gpt-6.1-sol', input: 'hi', tools: [shell] }, 1)).json() as any;
    expect(first.output[0]).toMatchObject({ type: 'function_call', name: 'exec_command', call_id: 'call_fake_1', arguments: JSON.stringify({ cmd: ['true'] }) });
    const second = await (reply('/v1/responses', { model: 'gpt-6.1-sol', tools: [shell], input: [{ type: 'function_call', call_id: 'call_fake_1' }, { type: 'function_call_output', call_id: 'call_fake_1', output: 'ok' }] }, 2)).json() as any;
    expect(second.output[0].type).toBe('message');
    const none = await (reply('/v1/responses', { model: 'gpt-6.1-sol', input: 'title this' }, 3)).json() as any;
    expect(none.output[0].type).toBe('message');
  });

  test('the pinned Codex 0.165.0 request, whose tools all sit in namespaces, gets one custom call of functions.exec, streamed too', async () => {
    const codex = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'frontier-harbor-gstack', 'codex-none-first-request.json'), 'utf8')).body;
    const first = await (reply('/v1/responses', { ...codex, stream: false }, 6)).json() as any;
    expect(first.output).toEqual([{ type: 'custom_tool_call', id: 'ctc_fake_6', call_id: 'call_fake_6', namespace: 'functions', name: 'exec', input: 'true', status: 'completed' }]);
    const text = await (reply('/v1/responses', codex, 7)).text();
    const events = text.split('\n\n').filter(Boolean).map((b) => JSON.parse(b.split('\n').find((l) => l.startsWith('data: '))!.slice(6)));
    expect(events.map((e) => e.type)).toEqual(['response.created', 'response.in_progress', 'response.output_item.added', 'response.custom_tool_call_input.delta', 'response.custom_tool_call_input.done', 'response.output_item.done', 'response.completed']);
    expect(events[5].item).toMatchObject({ type: 'custom_tool_call', name: 'exec', input: 'true' });
    const second = await (reply('/v1/responses', { ...codex, stream: false, input: [...codex.input, first.output[0], { type: 'custom_tool_call_output', call_id: 'call_fake_6', output: 'Script completed' }] }, 8)).json() as any;
    expect(second.output[0].type).toBe('message');
  });

  test('a Codex-style additional_tools input item is read, and the streamed call carries its arguments', async () => {
    const text = await (reply('/v1/responses', { model: 'gpt-6.1-sol', stream: true, input: [{ type: 'additional_tools', tools: [shell] }, { role: 'user', content: 'hi' }] }, 4)).text();
    const events = text.split('\n\n').filter(Boolean).map((b) => JSON.parse(b.split('\n').find((l) => l.startsWith('data: '))!.slice(6)));
    expect(events.map((e) => e.type)).toEqual(['response.created', 'response.in_progress', 'response.output_item.added', 'response.function_call_arguments.delta', 'response.function_call_arguments.done', 'response.output_item.done', 'response.completed']);
    expect(events.map((e) => e.sequence_number)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(events[4].arguments).toBe(JSON.stringify({ cmd: ['true'] }));
  });

  test('a request chained on previous_response_id gets the zero-data-retention 400, and the log records it', async () => {
    const r = reply('/v1/responses', { model: 'gpt-6.1-sol', previous_response_id: 'resp_fake_1', input: [{ type: 'function_call_output', call_id: 'call_fake_1', output: 'ok' }] }, 5);
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toMatchObject({ message: ZDR_ERROR, param: 'previous_response_id' });
    expect(requestFacts('/v1/responses', { model: 'gpt-6.1-sol', previous_response_id: 'resp_fake_1', store: false })).toMatchObject({ previous_response_id: true, store: false });
    expect(requestFacts('/v1/responses', { model: 'gpt-6.1-sol' })).toMatchObject({ previous_response_id: false, store: null });
  });

  test('placeholder arguments follow the schema types', () => {
    expect(placeholderArgs({ properties: { a: { type: 'string' }, b: { type: ['integer', 'null'] }, c: { type: 'boolean' }, d: { type: 'object' }, e: { type: 'string' } }, required: ['a', 'b', 'c', 'd'] })).toEqual({ a: 'true', b: 1, c: false, d: {} });
    expect(placeholderArgs(undefined)).toEqual({});
  });
});

describe('(b) zdr-check.ts', () => {
  const cells = [
    { id: 'sol-hermes', harness: 'hermes', model: 'openai:gpt-6.1-sol' },
    { id: 'sol-openclaw', harness: 'openclaw', model: 'openai:gpt-6.1-sol' },
    { id: 'sol-pi', harness: 'pi', model: 'openai:gpt-6.1-sol' },
    { id: 'sol-dsh', harness: 'dsh', model: 'openai:gpt-6.1-sol' },
    { id: 'sol-codex', harness: 'codex', model: 'openai:gpt-6.1-sol' },
    { id: 'opus-hermes', harness: 'hermes', model: 'anthropic:claude-opus-5-5' },
  ];
  const responses = (input: unknown, extra: object = {}) => ({ route: '/v1/responses', body: { model: 'gpt-6.1-sol', store: false, input, ...extra } });
  const out = [{ type: 'function_call_output', call_id: 'c', output: 'ok' }];
  const captures: Record<string, object[]> = {
    'hermes-sol': [responses('hi'), responses(out)],
    'openclaw-sol': [responses('hi'), responses(out, { previous_response_id: 'resp_fake_1' })],
    'pi-sol': [responses('hi'), responses('hi again')],
    'dsh-sol': [{ route: '/v1/chat/completions', body: { model: 'gpt-6.1-sol', messages: [] } }],
  };
  const harnessOf: Record<string, string> = { 'hermes-sol': 'hermes', 'openclaw-sol': 'openclaw', 'pi-sol': 'pi', 'dsh-sol': 'dsh', 'codex-sol': 'codex' };
  function smoke() {
    const dir = mkdtempSync(join(tmpdir(), 'zdr-smoke-'));
    dirs.push(dir);
    const run = join(dir, 'agents', 'run');
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, 'binds.jsonl'), Object.entries(harnessOf).map(([cell, harness]) => JSON.stringify({ at: '2026-11-14T00:00:00Z', trial: 't__' + cell, cell, attempt: 1, harness, model: 'openai:gpt-6.1-sol', models: [] }) + '\n').join(''));
    for (const [cell, lines] of Object.entries(captures)) {
      const d = join(run, 'jobs', cell + '__a1', 't__' + cell, 'proxy-capture');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'proxy-requests.ndjson'), lines.map((l, i) => JSON.stringify({ seq: i, prev: '', ...l }) + '\n').join(''));
    }
    const prereg = join(dir, 'prereg.json');
    writeFileSync(prereg, JSON.stringify({ cells }));
    return { dir, prereg };
  }

  test('each OpenAI cell gets its verdict; other cells are not read', () => {
    const s = smoke();
    const r = checkZdr({ smoke: s.dir, prereg: s.prereg, cells: cells.map((c) => c.id) });
    expect(r.pass).toBe(false);
    expect(Object.fromEntries(r.cells.map((c) => [c.cell, c.status]))).toEqual({ 'sol-hermes': 'pass', 'sol-openclaw': 'fail', 'sol-pi': 'fail', 'sol-dsh': 'pass', 'sol-codex': 'no_capture' });
    expect(r.cells.find((c) => c.cell === 'sol-openclaw')).toMatchObject({ responses_requests: 2, chained_requests: 1 });
    expect(r.cells.find((c) => c.cell === 'sol-pi')!.note).toContain('no Responses request carried a tool output');
    expect(r.cells.find((c) => c.cell === 'sol-dsh')!.note).toContain('Chat Completions only');
  });

  test('the CLI exits 0 for passing cells, 4 for a failing one, 2 for a cell outside the preregistration', () => {
    const s = smoke();
    const run = (c: string) => spawnSync('bun', [join(ROOT, 'scripts', 'frontier-harbor', 'zdr-check.ts'), '--smoke', s.dir, '--prereg', s.prereg, '--cells', c], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
    const ok = run('sol-hermes,opus-hermes');
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain('ZDR: ok openai_cells=1 pass=1 fail=0');
    const bad = run('sol-hermes,sol-openclaw');
    expect(bad.status).toBe(4);
    expect(bad.stdout).toContain('HE-FRONTIER-013 zero-data-retention check: cell sol-openclaw (openclaw, openai:gpt-6.1-sol): 1 of 2 Responses requests chain on previous_response_id');
    expect(JSON.parse(readFileSync(join(s.dir, 'zdr.json'), 'utf8')).pass).toBe(false);
    expect(run('nope').status).toBe(2);
  });
});
