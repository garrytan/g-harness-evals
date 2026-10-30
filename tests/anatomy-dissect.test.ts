// scripts/anatomy/dissect.ts on three captured request logs and on synthetic ones. The captured logs
// (tests/fixtures/anatomy/README.md) are an OpenClaw 2026.10.6 first request through the metering proxy and the
// internal-task panel-preflight probes of Hermes one-shot and Hermes chat (older fake format: no status on success).
// The synthetic logs cover the rest: block-array systems, tags and fences, the Responses wire, compaction and
// retries. Keyless; the CLI runs with an allowlisted environment and placeholder values only.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AnatomyRecord, type LogRow, checkSections, classify, dissect, readLog, splitSections } from '../scripts/anatomy/dissect.ts';
import { unpack } from '../scripts/anatomy/store.ts';

const ROOT = join(import.meta.dir, '..');
const FIX = join(ROOT, 'tests', 'fixtures', 'anatomy');
const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'scripts', 'anatomy', 'record.schema.json'), 'utf8'));
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const load = (name: string, harness: string): AnatomyRecord => {
  const { rows, sha256 } = readLog(join(FIX, name));
  return dissect(rows, { harness, config: 'fixture', source_log_sha256: sha256 });
};

/** The subset of JSON Schema record.schema.json uses: $ref, const, enum, type, required, properties, additionalProperties, items, oneOf, pattern, minimum. */
function validate(value: unknown, schema: Record<string, any>, path = '$'): string[] {
  if (schema.$ref) return validate(value, SCHEMA.$defs[schema.$ref.replace('#/$defs/', '')], path);
  if (schema.oneOf) {
    const ok = schema.oneOf.filter((s: Record<string, any>) => validate(value, s, path).length === 0).length;
    return ok === 1 ? [] : [`${ path}: matches ${ ok} oneOf branches`];
  }
  const errors: string[] = [];
  if ('const' in schema && value !== schema.const) errors.push(`${ path}: not ${ schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${ path}: ${ value} not in enum`);
  if (schema.type) {
    const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
    const types = [schema.type].flat();
    if (!types.includes(kind) && !(kind === 'integer' && types.includes('number'))) return [`${ path}: ${ kind} is not ${ types.join('|')}`];
  }
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${ path}: pattern`);
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.push(`${ path}: below minimum`);
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items, `${ path}[${ i}]`)));
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (!(k in o)) errors.push(`${ path}: missing ${ k}`);
    for (const [k, v] of Object.entries(o)) {
      if (schema.properties?.[k]) errors.push(...validate(v, schema.properties[k], `${ path}.${ k}`));
      else if (schema.additionalProperties === false) errors.push(`${ path}: unexpected ${ k}`);
    }
  }
  return errors;
}

const tools = (names: string[]) => names.map(name => ({ name, description: 'd ' + name, input_schema: { type: 'object', properties: {} } }));
const row = (over: Partial<LogRow> & { body?: unknown }): LogRow => ({ at: '2026-10-30T00:00:00.000Z', method: 'POST', path: '/v1/messages', ...over });
const agentBody = (messages: unknown[], system: unknown = 'You are a test agent.') => ({ model: 'claude-haiku-5-5', max_tokens: 1000, stream: true, system, tools: tools(['read', 'write']), messages });
const at = (ms: number) => new Date(Date.UTC(2026, 9, 30) + ms).toISOString();
const run = (rows: LogRow[]) => dissect(rows, { harness: 'synthetic', config: 'test', source_log_sha256: '0'.repeat(64) });

describe('classification', () => {
  test('error, agent, side and discovery by the rules', () => {
    expect(classify(row({ body: agentBody([{ role: 'user', content: 'hi' }]) }))).toBe('agent');
    expect(classify(row({ body: { model: 'm', max_tokens: 512, system: 'Name this chat.', messages: [{ role: 'user', content: 'hi' }] } }))).toBe('side');
    expect(classify(row({ body: { ...agentBody([]), tools: [] } }))).toBe('side');
    expect(classify(row({ method: 'GET', path: '/v1/models', status: 200 }))).toBe('discovery');
    expect(classify(row({ path: '/v1/messages/count_tokens', body: agentBody([]) }))).toBe('discovery');
    expect(classify(row({ path: '/v1/responses', body: { model: 'gpt', input: 'hi', tools: [{ type: 'function', name: 'shell' }] } }))).toBe('agent');
    expect(classify(row({ status: 529, body: agentBody([]) }))).toBe('error');
    expect(classify(row({ method: 'GET', path: '/anthropic/v1/models/claude-opus-5-5', status: 404 }))).toBe('error');
  });

  test('the Hermes one-shot probe: four 404 model probes, the agent turn, then the title side call', () => {
    const rec = load('hermes-oneshot-probe.ndjson.gz', 'hermes');
    expect(rec.requests.map(r => r.class)).toEqual(['error', 'error', 'error', 'error', 'agent', 'side']);
    expect(rec.totals).toEqual({ requests: 6, agent: 1, side: 1, discovery: 0, error: 4 });
    expect(rec.side_calls).toEqual([{ i: 5, purpose_guess: 'session title', body_bytes: 1301 }]);
    expect(rec.requests[4].status).toBeNull();
    expect(rec.requests[5].max_tokens).toBe(512);
    expect(rec.retries).toEqual([]);
  });
});

describe('sections tile the system prompt', () => {
  for (const [name, harness] of [['openclaw-2026.10.6-spike.ndjson.gz', 'openclaw'], ['hermes-oneshot-probe.ndjson.gz', 'hermes'], ['hermes-chat-probe.ndjson.gz', 'hermes']]) {
    test(name, () => {
      const fa = load(name, harness).first_agent!;
      expect(fa.system.sections.reduce((n, s) => n + s.bytes, 0)).toBe(fa.system.bytes);
      expect(() => checkSections(fa.system.sections, fa.system.bytes)).not.toThrow();
      expect(fa.system.sections[0].title).toBe('preamble');
    });
  }

  test('headings, a tag block with headings inside, a fenced heading and the text after the tag', () => {
    const text = 'intro line\n# One\nbody\n<rules>\n## not a split\n</rules>\nafter tag\n## Two\n' + '```' + '\n# not a split\n' + '```' + '\n### Three\nlast';
    const s = splitSections([text]);
    expect(s.map(x => x.title)).toEqual(['preamble', '# One', '<rules>', '# One (cont.)', '## Two', '### Three']);
    expect(s.reduce((n, x) => n + x.bytes, 0)).toBe(bytes(text));
    expect(s[2].bytes).toBe(bytes('<rules>\n## not a split\n</rules>\n'));
  });

  test('an unclosed tag line and an inline tag do not open a section; #### is not a heading', () => {
    const s = splitSections(['a\n<their message>\n<b>x</b>\n#### four\n# H\nz']);
    expect(s.map(x => x.title)).toEqual(['preamble', '# H']);
  });

  test('a tampered section list throws', () => {
    const s = splitSections(['p\n# A\nbody\n']);
    expect(() => checkSections(s, bytes('p\n# A\nbody\n') + 1)).toThrow(/sum to/);
    expect(() => checkSections([s[1], s[0]], bytes('p\n# A\nbody\n'))).toThrow(/starts at byte/);
  });

  test('multibyte text: starts and sizes are UTF-8 bytes', () => {
    const s = splitSections(['caf\u00e9 \u2192 ok\n# \u00dcber\n\u00e9']);
    expect(s[1].start).toBe(bytes('caf\u00e9 \u2192 ok\n'));
    expect(s[1].bytes).toBe(bytes('# \u00dcber\n\u00e9'));
  });
});

describe('string versus block-array system', () => {
  const head = 'You are a bot.\n# Rules\nBe brief.\n';
  const tail = '## Runtime\nnow\n';
  const asString = run([row({ body: agentBody([{ role: 'user', content: 'hi' }], head + tail) })]).first_agent!;
  const asBlocks = run([row({ body: agentBody([{ role: 'user', content: 'hi' }], [{ type: 'text', text: head, cache_control: { type: 'ephemeral' } }, { type: 'text', text: tail }]) })]).first_agent!;

  test('same bytes and the same sections either way', () => {
    expect(asBlocks.system.bytes).toBe(asString.system.bytes);
    expect(asBlocks.system.bytes).toBe(bytes(head + tail));
    expect(asBlocks.system.sections.map(s => [s.title, s.start, s.bytes, s.sha256])).toEqual(asString.system.sections.map(s => [s.title, s.start, s.bytes, s.sha256]));
  });

  test('block boundaries and cache marks are recorded, and no section crosses a block', () => {
    expect(asString.system.blocks).toEqual([{ start: 0, bytes: bytes(head + tail), cache_control: false }]);
    expect(asBlocks.system.blocks).toEqual([{ start: 0, bytes: bytes(head), cache_control: true }, { start: bytes(head), bytes: bytes(tail), cache_control: false }]);
    expect(asBlocks.system.sections.map(s => s.block)).toEqual([0, 0, 1]);
    const split = run([row({ body: agentBody([], [{ type: 'text', text: 'one\ntwo' }, { type: 'text', text: ' still two\n# H\n' }]) })]).first_agent!;
    expect(split.system.sections.map(s => [s.title, s.block])).toEqual([['preamble', 0], ['preamble', 1], ['# H', 1]]);
  });
});

describe('OpenClaw 2026.10.6 first request', () => {
  const rec = load('openclaw-2026.10.6-spike.ndjson.gz', 'openclaw');
  const fa = rec.first_agent!;

  test('one agent request, sizes and cache marks', () => {
    expect(rec.wire).toBe('anthropic-messages');
    expect(rec.totals).toEqual({ requests: 1, agent: 1, side: 0, discovery: 0, error: 0 });
    expect(fa.body_bytes).toBe(47354);
    expect(fa.system.bytes).toBe(28861);
    expect(rec.requests[0]).toMatchObject({ model: 'claude-haiku-5-5', stream: true, max_tokens: 128000, thinking: { type: 'adaptive', display: 'summarized' } });
    expect(rec.requests[0].cache_control).toEqual([{ where: 'system', index: 0 }, { where: 'tools', index: 13 }, { where: 'messages', index: 1, block: 0 }]);
  });

  test('deferred tools: 14 sent, the listed deferred tools marked, and the omitted-tools note', () => {
    const direct = fa.tools.filter(t => !t.deferred).map(t => t.name);
    expect(direct.length).toBe(14);
    expect(direct).toEqual(expect.arrayContaining(['tool_search', 'tool_describe', 'tool_call', 'exec', 'read']));
    const deferred = fa.tools.filter(t => t.deferred);
    expect(deferred.length).toBeGreaterThan(0);
    expect(deferred.map(t => t.name)).toEqual(expect.arrayContaining(['agents_list', 'ask_user', 'browser']));
    expect(deferred.every(t => t.schema_bytes === 0 && t.description_bytes > 0)).toBe(true);
    expect(fa.deferred_tools_omitted).toBe(15);
    expect(fa.deferred_tools_note!.startsWith('15 additional tools omitted. Use tool_search')).toBe(true);
    expect(fa.system.sections.map(s => s.title)).toEqual(expect.arrayContaining(['### Deferred Tool Schemas', '<available_skills>', '## Workspace Files (injected)']));
  });

  test('the user prefix is measured against the task prompt when it is given', () => {
    const { rows } = readLog(join(FIX, 'openclaw-2026.10.6-spike.ndjson.gz'));
    const prompt = 'Quick check: what time is it on the company clock right now, and which channels am I a member of? One line is enough.';
    const withPrompt = dissect(rows, { harness: 'openclaw', config: 'fixture', source_log_sha256: '0'.repeat(64), prompt }).first_agent!;
    expect(fa.user_prefix_bytes).toBeNull();
    expect(withPrompt.user_prefix_bytes).toBe(fa.user_text_bytes - bytes(prompt));
    expect(() => dissect(rows, { harness: 'openclaw', config: 'fixture', source_log_sha256: '0'.repeat(64), prompt: 'not sent' })).toThrow(/prompt is not/);
  });
});

describe('Hermes one-shot versus chat', () => {
  const oneshot = load('hermes-oneshot-probe.ndjson.gz', 'hermes');
  const chat = load('hermes-chat-probe.ndjson.gz', 'hermes');

  test('first agent bodies of 54,402 and 59,152 bytes with 23 and 24 tools', () => {
    expect(oneshot.first_agent!.body_bytes).toBe(54402);
    expect(chat.first_agent!.body_bytes).toBe(59152);
    expect(oneshot.first_agent!.tools.length).toBe(23);
    expect(chat.first_agent!.tools.length).toBe(24);
  });

  test('chat adds skill_manage; the agent request is chosen by tools, not by position', () => {
    const names = (r: AnatomyRecord) => r.first_agent!.tools.map(t => t.name);
    expect(names(chat).filter(n => !names(oneshot).includes(n))).toEqual(['skill_manage']);
    expect(chat.first_agent!.i).toBe(5);
    expect(chat.side_calls).toEqual([{ i: 4, purpose_guess: 'session title', body_bytes: 1301 }]);
    expect(oneshot.first_agent!.deferred_tools_note).toBeUndefined();
  });
});

describe('compaction', () => {
  const u = (t: string) => ({ role: 'user', content: t });
  const a = (t: string) => ({ role: 'assistant', content: t });
  const long = [u('task'), a('step 1'), u('result 1'), a('step 2'), u('result 2'), a('step 3'), u('result 3')];
  test('a drop in messages after a summary is a summary-like compaction; a plain truncation is not', () => {
    const rec = run([
      row({ at: at(0), body: agentBody(long.slice(0, 3)) }),
      row({ at: at(1000), body: agentBody(long) }),
      row({ at: at(1500), body: { model: 'm', max_tokens: 2000, system: 'Summarize the conversation so far.', messages: long } }),
      row({ at: at(2000), body: agentBody([u('Summary of the earlier conversation: the agent ran steps 1 to 3.'), u('continue')]) }),
      row({ at: at(3000), body: agentBody([u('continue'), a('step 4'), u('result 4')]) }),
      row({ at: at(4000), body: agentBody([u('result 4')]) }),
    ]);
    expect(rec.growth.map(g => g.messages)).toEqual([3, 7, 2, 3, 1]);
    expect(rec.compaction).toEqual([
      { i: 3, before_messages: 7, after_messages: 2, summary_like: true, summary_call: 2, kind: 'compaction' },
      { i: 5, before_messages: 3, after_messages: 1, summary_like: false, summary_call: null, kind: 'compaction' },
    ]);
    expect(rec.side_calls).toEqual([{ i: 2, purpose_guess: 'summary', body_bytes: rec.requests[2].body_bytes }]);
  });
  test('a drop to messages the previous request never carried, with no summary call, is a new session', () => {
    const rec = run([
      row({ at: at(0), body: agentBody(long) }),
      row({ at: at(1000), body: agentBody([u('next turn: write a summary')]) }),
    ]);
    expect(rec.compaction).toEqual([{ i: 1, before_messages: 7, after_messages: 1, summary_like: true, summary_call: null, kind: 'new_session' }]);
  });
});

describe('retries', () => {
  test('529, 500 and 429 then success: each failure points at the next attempt, gaps from sent_at', () => {
    const body = agentBody([{ role: 'user', content: 'hi' }]);
    const rec = run([
      row({ at: at(0), status: 529, sent_at: at(10), body }),
      row({ at: at(510), status: 500, sent_at: at(520), body }),
      row({ at: at(2520), status: 429, body }),
      row({ at: at(5520), status: 200, body: { ...body, messages: [{ role: 'user', content: 'hi again' }] } }),
      row({ method: 'GET', path: '/v1/models', status: 404, at: at(6000) }),
    ]);
    expect(rec.retries).toEqual([
      { i: 0, status: 529, next_i: 1, gap_ms: 500, same_body: true },
      { i: 1, status: 500, next_i: 2, gap_ms: 2000, same_body: true },
      { i: 2, status: 429, next_i: 3, gap_ms: 3000, same_body: false },
    ]);
    expect(rec.totals).toEqual({ requests: 5, agent: 1, side: 0, discovery: 0, error: 4 });
    expect(rec.first_agent!.i).toBe(3);
  });

  test('a failed agent request is paired with the next agent request, not a side call in between', () => {
    const body = agentBody([{ role: 'user', content: 'hi' }]);
    const rec = run([
      row({ at: at(0), status: 529, body }),
      row({ at: at(100), status: 200, body: { model: 'm', max_tokens: 50, system: 'Write a title.', messages: [{ role: 'user', content: 'hi' }] } }),
      row({ at: at(900), status: 200, body }),
    ]);
    expect(rec.retries).toEqual([{ i: 0, status: 529, next_i: 2, gap_ms: 900, same_body: true }]);
  });

  test('a failure with no later attempt has next_i null', () => {
    const rec = run([row({ status: 500, body: agentBody([]) })]);
    expect(rec.retries).toEqual([{ i: 0, status: 500, next_i: null, gap_ms: null, same_body: null }]);
    expect(rec.first_agent).toBeNull();
  });
});

describe('OpenAI Responses wire', () => {
  test('instructions are the system, input the messages, flat function tools', () => {
    const instructions = 'You are Codex.\n# Sandbox\nread only\n';
    const body = { model: 'gpt-6.1-sol', instructions, input: [{ role: 'user', content: [{ type: 'input_text', text: 'list files' }] }], tools: [{ type: 'function', name: 'shell', description: 'run', parameters: { type: 'object' } }, { type: 'web_search' }], max_output_tokens: 4000, reasoning: { effort: 'medium' }, stream: true };
    const rec = run([row({ path: '/v1/responses', body })]);
    expect(rec.wire).toBe('openai-responses');
    expect(rec.requests[0]).toMatchObject({ class: 'agent', max_tokens: 4000, system_bytes: bytes(instructions), thinking: { effort: 'medium' }, messages: { count: 1 }, tools: { count: 2, names: ['shell', 'web_search'] } });
    expect(rec.first_agent!.body_bytes).toBe(bytes(JSON.stringify(body)));
    expect(rec.first_agent!.system.sections.map(s => s.title)).toEqual(['preamble', '# Sandbox']);
    expect(rec.first_agent!.tools).toEqual([{ name: 'shell', description_bytes: 3, schema_bytes: bytes('{"type":"object"}') }, { name: 'web_search', description_bytes: 0, schema_bytes: 0 }]);
    expect(rec.first_agent!.user_text_bytes).toBe(bytes('list files'));
  });

  test('a log that mixes wires throws', () => {
    expect(() => run([row({ path: '/v1/responses', body: { input: 'x' } }), row({ body: agentBody([]) })])).toThrow(/mixes wire/);
  });
});

describe('record schema and CLI', () => {
  test('every fixture record and the synthetic ones validate against record.schema.json', () => {
    for (const [name, harness] of [['openclaw-2026.10.6-spike.ndjson.gz', 'openclaw'], ['hermes-oneshot-probe.ndjson.gz', 'hermes'], ['hermes-chat-probe.ndjson.gz', 'hermes']]) {
      expect(validate(JSON.parse(JSON.stringify(load(name, harness))), SCHEMA)).toEqual([]);
    }
    expect(validate(JSON.parse(JSON.stringify(run([]))), SCHEMA)).toEqual([]);
    expect(validate({ schema: 'harness-anatomy/1' }, SCHEMA).length).toBeGreaterThan(0);
  });

  test('every published record validates and rebuilds byte for byte from its receipts', () => {
    const docs = join(ROOT, 'docs', 'harness-anatomy');
    const logs = new Map<string, () => LogRow[]>();
    for (const id of readdirSync(join(docs, 'receipts'))) {
      const dir = join(docs, 'receipts', id);
      const cap = JSON.parse(readFileSync(join(dir, 'capture.json'), 'utf8'));
      const log = unpack(dir);
      expect(createHash('sha256').update(log).digest('hex')).toBe(cap.files['fake.ndjson']);
      logs.set(cap.files['fake.ndjson'], () => log.split('\n').filter(Boolean).map(l => JSON.parse(l)));
    }
    for (const name of readdirSync(FIX).filter(n => n.endsWith('.ndjson.gz'))) {
      const { rows, sha256 } = readLog(join(FIX, name));
      logs.set(sha256, () => rows);
    }
    const records = readdirSync(join(docs, 'records')).flatMap(h => readdirSync(join(docs, 'records', h)).map(f => join(docs, 'records', h, f)));
    expect(records.length).toBeGreaterThan(0);
    for (const path of records) {
      const rec = JSON.parse(readFileSync(path, 'utf8')) as AnatomyRecord;
      expect(validate(rec, SCHEMA)).toEqual([]);
      const rows = logs.get(rec.source_log_sha256);
      expect(rows).toBeDefined();
      expect(JSON.parse(JSON.stringify(dissect(rows!(), { harness: rec.harness, config: rec.config, source_log_sha256: rec.source_log_sha256 })))).toEqual(rec);
    }
  });

  test('the CLI writes the record and prints the summary under an allowlisted environment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anatomy-dissect-test-'));
    const out = join(dir, 'record.json');
    const prompt = join(dir, 'prompt.txt');
    writeFileSync(prompt, 'Quick check: what time is it on the company clock right now, and which channels am I a member of? One line is enough.');
    const args = ['scripts/anatomy/dissect.ts', '--log', join(FIX, 'openclaw-2026.10.6-spike.ndjson.gz'), '--harness', 'openclaw', '--config', 'spike', '--out', out, '--prompt-file', prompt];
    const res = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir } });
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('47,354 body bytes, system 28,861 bytes in 2 block(s)');
    expect(res.stdout).toContain('### Deferred Tool Schemas');
    expect(res.stdout).toContain('deferred-tool note: 15 additional tools omitted.');
    const rec = JSON.parse(readFileSync(out, 'utf8')) as AnatomyRecord;
    expect(rec).toMatchObject({ schema: 'harness-anatomy/1', harness: 'openclaw', config: 'spike', source_log_sha256: '915e679f7ef547ecf66d57405ce7ff6530fa1f84bb5771937ff05153bda69b2d' });
    expect(rec.first_agent!.user_prefix_bytes).toBeGreaterThan(0);
    const bad = spawnSync(process.execPath, ['scripts/anatomy/dissect.ts', '--log', out], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir } });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('usage:');
  });
});
