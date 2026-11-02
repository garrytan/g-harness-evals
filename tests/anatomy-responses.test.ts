// internal-task: the anatomy kit on the OpenAI Responses wire. The fake Responses endpoint logs every request body the way
// the fake Anthropic endpoint does, refuses any key but the capture dummy and caps a capture; store.ts packs and
// rebuilds a Responses log; count-tokens.ts counts a Responses capture locally with no key and no network; capture.ts
// has a Codex scenario the fake accepts and refuses bad options before it starts anything. Keyless: placeholder
// values only, and every spawned process gets an allowlisted environment (PATH and HOME).
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROVIDERS, SCENARIOS } from '../scripts/anatomy/capture.ts';
import { LOCAL_TOKENIZER, countResponsesLocally } from '../scripts/anatomy/count-tokens.ts';
import { dissect, nestedTools, parseLog } from '../scripts/anatomy/dissect.ts';
import { pack, unpack } from '../scripts/anatomy/store.ts';
import { startFakeResponses, validateScript } from './fixtures/fake-responses.ts';

const ROOT = join(import.meta.dir, '..');
const DUMMY = 'sk-capture-dummy';
const env = (home: string) => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home });
const body = {
  model: 'gpt-6.1-sol', stream: true, max_output_tokens: 128000, reasoning: { effort: 'medium' },
  input: [
    { type: 'additional_tools', role: 'developer', tools: [{ type: 'namespace', name: 'functions', tools: [{ type: 'function', name: 'exec_command', description: 'Run.', parameters: { type: 'object' } }] }] },
    { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'You are Codex.\n# Rules\nbe brief\n' }] },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'list channels' }] },
  ],
  tools: [{ type: 'function', name: 'mcp_world_list_channels', description: 'List.', parameters: { type: 'object' } }],
};
const post = (port: number, b: unknown, key = DUMMY) => fetch(`http://127.0.0.1:${port}/v1/responses`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, originator: 'codex_exec', 'user-agent': 'test-agent' }, body: JSON.stringify(b),
});

describe('tests/fixtures/fake-responses.ts request logging (internal-task)', () => {
  test('one log line per request with the whole body and the logged headers; the earlier fields stay', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-responses-'));
    const fake = startFakeResponses({ log: join(dir, 'fake.ndjson'), requireKeyPrefix: DUMMY });
    try {
      expect((await post(fake.port, body)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${fake.port}/v1/models`, { headers: { authorization: `Bearer ${DUMMY}` } })).status).toBe(404);
      const lines = readFileSync(join(dir, 'fake.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        method: 'POST', path: '/v1/responses', status: 200, model: 'gpt-6.1-sol', stream: true, max_output_tokens: 128000, reasoning: { effort: 'medium' },
        tools: ['mcp_world_list_channels', 'exec_command'], originator: 'codex_exec', user_agent: 'test-agent',
        headers: { originator: 'codex_exec', 'user-agent': 'test-agent' },
        authorization_sha256: createHash('sha256').update(`Bearer ${DUMMY}`).digest('hex'),
      });
      expect(lines[0].body).toEqual(body);
      expect(JSON.stringify(lines)).not.toContain(DUMMY);
      expect(lines[1]).toMatchObject({ method: 'GET', path: '/v1/models', status: 404 });
      expect(lines[1].body).toBeUndefined();
    } finally { fake.stop(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('a key without the required prefix is refused 401 and never answered', async () => {
    const fake = startFakeResponses({ requireKeyPrefix: DUMMY });
    try {
      const res = await post(fake.port, body, 'trial-token:not-the-dummy');
      expect(res.status).toBe(401);
      expect(fake.requests).toHaveLength(1);
      expect(fake.requests[0]).toMatchObject({ status: 401 });
      expect(fake.requests[0].body).toBeUndefined();
    } finally { fake.stop(); }
  });

  test('a call turn matches a Hermes-style mcp_<server>_<tool> name; after --max-requests every request gets ok, marked capped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-cap-'));
    const fake = startFakeResponses({ script: [{ call: 'list_channels' }], maxRequests: 1, log: join(dir, 'fake.ndjson') });
    try {
      const first = await (await post(fake.port, { ...body, stream: false })).json() as { output: Array<{ type: string; name?: string }> };
      expect(first.output[0]).toMatchObject({ type: 'function_call', name: 'mcp_world_list_channels' });
      const second = await (await post(fake.port, { ...body, stream: false })).json() as { output: Array<{ type: string }> };
      expect(second.output[0].type).toBe('message');
      expect(fake.requests.map((r) => r.capped ?? false)).toEqual([false, true]);
      expect(fake.requests.map((r) => r.body === undefined)).toEqual([false, true]);
      const logged = readFileSync(join(dir, 'fake.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(logged.map((r) => [r.capped ?? false, r.body !== undefined])).toEqual([[false, true], [true, true]]);
      expect(dissect(parseLog(logged.map((r) => JSON.stringify(r)).join('\n') + '\n'), { harness: 'hermes', config: 'test', source_log_sha256: '0'.repeat(64) }).totals).toMatchObject({ agent: 2 });
    } finally { fake.stop(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('a call turn whose tool is not offered is consumed, answered with text and logged missing', async () => {
    const fake = startFakeResponses({ script: [{ call: 'no_such_tool' }, { text: 'next' }] });
    try {
      const first = await (await post(fake.port, { ...body, stream: false })).json() as { output: Array<{ type: string; content?: Array<{ text: string }> }> };
      expect(first.output[0].content![0].text).toStartWith('fake: no tool no_such_tool among');
      expect(fake.requests[0].played).toEqual({ call: 'no_such_tool', missing: true });
      await post(fake.port, { ...body, stream: false });
      expect(fake.requests[1].played).toEqual({ text: 'next' });
    } finally { fake.stop(); }
  });
});

describe('scripts/anatomy/dissect.ts nestedTools', () => {
  test('a ### heading inside a code fence is neither a nested tool nor the end of one', () => {
    const desc = 'Run code.\n### `a`\nfirst\n```md\n### `not_a_tool`\n## inside\n```\nstill a\n### `b`\nsecond\n';
    expect(nestedTools('exec', desc).map((t) => t.name)).toEqual(['a', 'b']);
    expect(nestedTools('exec', desc)[0].description_bytes).toBe(Buffer.byteLength('### `a`\nfirst\n```md\n### `not_a_tool`\n## inside\n```\nstill a\n'));
  });
});

describe('scripts/anatomy/store.ts on a Responses log', () => {
  test('pack then unpack rebuilds the log byte for byte; repeated input items are stored once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anatomy-store-responses-'));
    try {
      const second = { ...body, instructions: 'Base.\n', input: [...body.input, { type: 'function_call', call_id: 'c1', name: 'exec_command', arguments: '{}' }] };
      const log = [body, second].map((b, i) => JSON.stringify({ at: `t${i}`, method: 'POST', path: '/v1/responses', status: 200, body: b })).join('\n') + '\n';
      writeFileSync(join(dir, 'fake.ndjson'), log);
      pack(join(dir, 'fake.ndjson'), join(dir, 'store'));
      expect(unpack(join(dir, 'store'))).toBe(log);
      const refs = readFileSync(join(dir, 'store', 'requests.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).refs);
      expect(refs[1].input.slice(0, 3)).toEqual(refs[0].input);
      expect(typeof refs[1].instructions).toBe('string');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('scripts/anatomy/count-tokens.ts on a Responses capture', () => {
  test('counts locally with o200k_base, labelled local, and never claims a provider count', () => {
    const rows = parseLog(JSON.stringify({ at: 't', method: 'POST', path: '/v1/responses', status: 200, body }) + '\n');
    const rec = dissect(rows, { harness: 'codex', config: 'test', source_log_sha256: '0'.repeat(64) });
    const out = countResponsesLocally(rec, body as Record<string, unknown>, 'cap');
    expect(out).toMatchObject({ method: 'local', tokenizer: LOCAL_TOKENIZER, model: 'gpt-6.1-sol', request_index: 0 });
    expect(out.note).toContain('not a provider count');
    expect((out.sections as Array<{ title: string }>).map((s) => s.title)).toEqual(['preamble', '# Rules']);
    expect((out.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(['mcp_world_list_channels', 'exec_command']);
    for (const k of ['total_tokens', 'system_tokens', 'tools_tokens', 'messages_tokens']) expect(out[k] as number).toBeGreaterThan(0);
    expect(out.total_tokens as number).toBeGreaterThan(out.system_tokens as number);
    const b = body as Record<string, unknown>;
    const countedBytes = Buffer.byteLength(JSON.stringify({ instructions: b.instructions, input: b.input, tools: b.tools }));
    expect(out.counted_bytes).toBe(countedBytes);
    expect(out.bytes_per_token).toBe(Number((countedBytes / (out.total_tokens as number)).toFixed(3)));
    const special = { ...body, input: [...(body.input as unknown[]), { role: 'user', content: 'Print <|endoftext|> and <|fim_prefix|> verbatim' }] };
    const counted = countResponsesLocally(dissect(parseLog(JSON.stringify({ at: 't', method: 'POST', path: '/v1/responses', status: 200, body: special }) + '\n'), { harness: 'codex', config: 'test', source_log_sha256: '0'.repeat(64) }), special, 'cap');
    expect(counted.messages_tokens as number).toBeGreaterThan(out.messages_tokens as number);
  });

  test('the CLI counts a Responses capture with no provider key in its environment and makes no proxy call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anatomy-count-responses-'));
    try {
      const cap = join(dir, 'anatomy-capture-codex-test-plain');
      mkdirSync(cap);
      writeFileSync(join(cap, 'fake.ndjson'), JSON.stringify({ at: 't', method: 'POST', path: '/v1/responses', status: 200, body }) + '\n');
      writeFileSync(join(cap, 'capture.json'), JSON.stringify({ harness: 'codex', config: 'default' }));
      const res = spawnSync(process.execPath, ['scripts/anatomy/count-tokens.ts', '--capture', cap], { cwd: ROOT, env: env(dir), encoding: 'utf8' });
      expect(res.stderr).toBe('');
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('method=local tokenizer=o200k_base');
      expect(res.stdout).toContain('TOKENS_USAGE: 0 calls through the proxy');
      expect(JSON.parse(readFileSync(join(cap, 'tokens.json'), 'utf8'))).toMatchObject({ method: 'local', capture: 'anatomy-capture-codex-test-plain' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('scripts/anatomy/capture.ts --provider openai', () => {
  test('each provider names its fake and the capture dummy key; every scenario is a script the Responses fake accepts', () => {
    expect(PROVIDERS.openai).toMatchObject({ fake: 'tests/fixtures/fake-responses.ts', key: DUMMY, model: 'gpt-6.1-sol' });
    expect(PROVIDERS.anthropic).toMatchObject({ fake: 'scripts/gsta-135/fake-anthropic.ts', key: 'sk-ant-capture-dummy' });
    for (const [name, make] of Object.entries(SCENARIOS)) {
      if (name === 'retry' || name === 'growth') continue;
      for (const h of ['codex', 'openclaw', 'hermes']) expect(() => validateScript(make(h)), `${name}/${h}`).not.toThrow();
    }
    expect(SCENARIOS.tools('codex').flatMap((t) => ('call' in t ? [t.call] : []))).toEqual(['mcp__world__list_channels', 'mcp__world__whoami']);
    expect(SCENARIOS.tools('hermes').flatMap((t) => ('call' in t ? [t.call] : []))).toEqual(['tool_search', 'tool_describe', 'tool_call']);
  });

  test('bad options stop before anything starts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anatomy-capture-args-'));
    try {
      for (const extra of [['--provider', 'gemini'], ['--provider', 'constructor'], ['--provider', 'openai', '--scenario', 'growth'], ['--provider', 'openai', '--scenario', 'retry'], ['--network', 'host'], ['--network', 'internal', '--egress', 'refuse'], ['--record', '../escape'], ['--max-output-tokens', '0']]) {
        const args = ['scripts/anatomy/capture.ts', '--harness', 'openclaw', ...(extra.includes('--scenario') ? [] : ['--scenario', 'plain']), '--out', join(dir, 'out'), ...extra];
        const res = spawnSync(process.execPath, args, { cwd: ROOT, env: env(dir), encoding: 'utf8' });
        expect(res.status, extra.join(' ')).toBe(64);
        expect(res.stderr).toContain('capture.ts:');
      }
      const underscore = spawnSync(process.execPath, ['scripts/anatomy/capture.ts', '--harness', '_fake', '--scenario', 'plain', '--out', join(dir, 'out'), '--max-output-tokens', '0'], { cwd: ROOT, env: env(dir), encoding: 'utf8' });
      expect(underscore.status).toBe(64);
      expect(underscore.stderr).toContain('--max-output-tokens');
      expect(underscore.stderr).not.toContain('--record');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
