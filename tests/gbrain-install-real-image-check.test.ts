// internal-task: the real-image check's fake model upstream and its checks (scripts/gbrain-install/real-image-check.ts), keyless.
// The VM run itself needs Docker and the four images; these tests cover the scripted conversation, the HECHECK markers,
// the three reply shapes and the pass rules, and run the shell commands under a scrubbed environment.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answer, CODEX_TOOLS_SOURCE, installScript, embeddingsReply, envCommand, evaluate, evaluateSemantic, fakeVector, gbrainQueryCall, gbrainToolCount, installPlan, markers, newSemanticState, newState, nextCommand, promptKind, recallPlan, SEMANTIC_KEY, SEMANTIC_QUESTION, SEMANTIC_VERSIONS, semanticScript, startFake, startSemanticFake } from '../scripts/gbrain-install/real-image-check.ts';
import { trialKey } from '../runner/trial/proxy.ts';
import type { TrialRecord } from '../runner/contracts.ts';

const COMMIT = 'b82c23a7330bb9468720617a89af08c329fe6b10';
const PATH = '/usr/local/bin:/usr/bin:/bin';
/** A command under env -i: PATH, HOME and only the variables the test names. */
const sh = (command: string, env: Record<string, string> = {}, home = mkdtempSync(join(tmpdir(), 'ric-home-'))) =>
  spawnSync('env', ['-i', 'PATH=' + PATH, 'HOME=' + home, ...Object.entries(env).map(([k, v]) => k + '=' + v), 'bash', '-c', command], { encoding: 'utf8', timeout: 30_000 });
const bashTool = [{ name: 'Bash', input_schema: { type: 'object' } }];
const msg = (content: unknown, role = 'user') => ({ role, content });

describe('the shell commands', () => {
  test('every planned command parses', () => {
    for (const h of ['claude-code', 'codex', 'openclaw', 'hermes']) {
      for (const step of [...installPlan(h, COMMIT), ...recallPlan(h)]) expect({ h, step: step.name, status: spawnSync('bash', ['-n', '-c', step.command]).status }).toEqual({ h, step: step.name, status: 0 });
    }
  });

  test('the environment check prints names and a count, never a value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ric-'));
    const token = join(dir, 'token');
    writeFileSync(token, 'trial-token:t1.0123abcd');
    const leaky = sh(envCommand('install', token), { ANTHROPIC_API_KEY: 'trial-token:t1.0123abcd', OTHER: 'x' });
    expect(leaky.status).toBe(0);
    expect(leaky.stdout).not.toContain('0123abcd');
    expect(markers(leaky.stdout)).toEqual({ 'install.env_names': 'ANTHROPIC_API_KEY', 'install.token_read': '1', 'install.token_hits': '1', 'step.install-env': '1' });
    const clean = sh(envCommand('recall', token));
    expect(markers(clean.stdout)).toEqual({ 'recall.env_names': 'none', 'recall.token_read': '1', 'recall.token_hits': '0', 'step.recall-env': '1' });
    expect(markers(sh(envCommand('recall', join(dir, 'missing'))).stdout)['recall.token_read']).toBe('0');
  });

  test('the wait step prints the result lines the install script wrote, and no command text holds a marker', () => {
    const home = mkdtempSync(join(tmpdir(), 'ric-home-'));
    const wait = installPlan('hermes', COMMIT).find((s) => s.name === 'wait')!.command;
    sh('mkdir -p "$HOME/.he-check" && m=HE && m="$m"CHECK && printf "%s install.bun_exit=0\\n%s install_done=1\\n" "$m" "$m" > "$HOME/.he-check/result"', {}, home);
    expect(markers(sh(wait, {}, home).stdout)).toEqual({ 'install.bun_exit': '0', install_done: '1' });
    for (const h of ['claude-code', 'codex', 'openclaw', 'hermes']) for (const step of [...installPlan(h, COMMIT), ...recallPlan(h)]) expect(markers(step.command)).toEqual({});
  });

  test('the install script writes its result lines, the brain path last before install_done', () => {
    const home = mkdtempSync(join(tmpdir(), 'ric-home-'));
    const bin = join(home, '.bun', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'bun'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(bin, 'gbrain'), '#!/bin/sh\nmkdir -p "$HOME/.gbrain"; printf \'{"engine": "pglite", "database_path": "%s"}\\n\' "$HOME/.gbrain/brain.pglite" > "$HOME/.gbrain/config.json"\n', { mode: 0o755 });
    mkdirSync(join(home, '.he-check'));
    writeFileSync(join(home, '.he-check', 'install.sh'), installScript('codex', COMMIT));
    sh('bash "$HOME/.he-check/install.sh"', {}, home);
    expect(markers(readFileSync(join(home, '.he-check', 'result'), 'utf8'))).toEqual({ 'install.started': '1', 'install.bun_exit': '0', 'install.install_exit': '0', 'install.setup_exit': '0', brain_path: home + '/.gbrain/brain.pglite', gbrain_bin: bin + '/gbrain', install_done: '1' });
    for (const h of ['codex', 'hermes']) expect(installScript(h, COMMIT)).not.toMatch(/\b(bun|node|python3?)\s+(-[ec]\b|-\s*<<|<<)/);
  });
});

describe('the scripted conversation', () => {
  test('markers come from command output, not from the command text, and survive JSON-escaped tool results', () => {
    const command = envCommand('install');
    expect(markers({ messages: [msg([{ type: 'tool_use', id: 'x', name: 'Bash', input: { command } }], 'assistant')] })).toEqual({});
    expect(markers({ messages: [msg([{ type: 'tool_result', tool_use_id: 'x', content: JSON.stringify({ output: 'HECHECK brain_path=/h/.gbrain/brain.pglite\nHECHECK step.install-brain=1\n' }) }])] }))
      .toEqual({ brain_path: '/h/.gbrain/brain.pglite', 'step.install-brain': '1' });
  });

  test('the prompt kind is the newest user message carrying a task text, on each API', () => {
    expect(promptKind({ messages: [msg('install gbrain'), msg('ok', 'assistant'), msg([{ type: 'tool_result', content: 'x' }, { type: 'text', text: '<system-reminder>' }])] })).toBe('install');
    expect(promptKind({ messages: [msg('install gbrain'), msg('done', 'assistant'), msg("Remember that my sister's new cat is called Zib.")] })).toBe('save');
    expect(promptKind({ input: [{ role: 'user', content: [{ type: 'input_text', text: "What's my sister's new cat called?" }] }] })).toBe('recall');
    expect(promptKind({ messages: [{ role: 'system', content: 's' }, msg("Check your gbrain memory: what's my sister's new cat called?")] })).toBe('hinted');
    expect(promptKind({ messages: [msg("I don't have a preference. Use the defaults you recommend.")] })).toBe('install');
    expect(promptKind({ messages: [msg('write a title')] })).toBe('other');
  });

  test('the install plan: env, write, run once, then waits until install_done or 780 s, then text; Hermes runs it with background', () => {
    const state = newState();
    const body = (out: string) => ({ messages: [msg('install gbrain'), msg([{ type: 'tool_result', content: out }])] });
    const step = (out: string, now = 0) => nextCommand('install', body(out), state, 'codex', COMMIT, now)?.name ?? null;
    expect([step(''), step(''), step('')]).toEqual(['install-env', 'install-env', 'install-write']);
    const env = 'HECHECK step.install-env=1\n';
    expect(step(env)).toBe('install-write');
    const written = env + 'HECHECK step.install-write=1\n';
    expect(step(written, 1_000)).toBe('install-run');
    expect(step(written, 2_000)).toBe('wait');
    expect(step(written, 3_000)).toBe('wait');
    expect(step(written + 'HECHECK install_done=1\n', 4_000)).toBeNull();
    const late = newState();
    late.attempts['install-run'] = 1;
    expect(nextCommand('install', body(written), late, 'codex', COMMIT, 0)?.name).toBe('wait');
    expect(nextCommand('install', body(written), late, 'codex', COMMIT, 781_000)).toBeNull();
    const early = newState();
    expect(nextCommand('install', body(env + 'HECHECK step.install-write=1\n'), early, 'codex', COMMIT, 0)?.name).toBe('install-run');
    expect(nextCommand('save', body(''), newState(), 'codex', COMMIT)).toBeNull();
    expect(installPlan('codex', COMMIT)[1]!.command).toContain('github:garrytan/gbrain#' + COMMIT);
    expect(installPlan('hermes', COMMIT)[1]!.command).toContain('hermes mcp add gbrain');
    expect(installPlan('hermes', COMMIT)[2]).toEqual({ name: 'install-run', command: 'bash "$HOME/.he-check/install.sh"', once: true, background: true });
    expect(installPlan('codex', COMMIT)[2]!.command).toContain('setsid nohup');
  });
});

describe('the reply shapes', () => {
  const call = (name: string, custom = false) => ({ tool: { name, custom }, command: 'echo hi' });
  test('Messages: a Bash tool_use, streamed or not, and text', async () => {
    const plain = await answer('/v1/messages', { model: 'claude-opus-5-5' }, 1, call('Bash'), 'x').json() as any;
    expect(plain.content[0]).toMatchObject({ type: 'tool_use', name: 'Bash', input: { command: 'echo hi' } });
    expect(plain.stop_reason).toBe('tool_use');
    const streamed = await answer('/v1/messages', { model: 'm', stream: true }, 2, call('Bash'), 'x').text();
    expect(streamed).toContain('"partial_json":"{\\"command\\":\\"echo hi\\"');
    expect((await answer('/v1/messages', { model: 'm' }, 3, null, 'Saved.').json() as any).content[0]).toEqual({ type: 'text', text: 'Saved.' });
  });
  test("Responses: Codex's custom exec runs the command through exec_command", async () => {
    const r = await answer('/v1/responses', { model: 'gpt-6.1-sol' }, 1, call('exec', true), 'x').json() as any;
    expect(r.output[0]).toMatchObject({ type: 'custom_tool_call', name: 'exec' });
    expect(r.output[0].input).toContain('tools.exec_command({ cmd: "echo hi"');
    const f = await answer('/v1/responses', { model: 'm' }, 2, call('exec_command'), 'x').json() as any;
    expect(JSON.parse(f.output[0].arguments)).toEqual({ cmd: 'echo hi', yield_time_ms: 120000 });
  });
  test('Chat Completions on the Particle route echoes particle-ai/<model> and calls terminal', async () => {
    const r = await answer('/particle/v1/chat/completions', { model: 'particle-1' }, 1, call('terminal'), 'x').json() as any;
    expect(r.model).toBe('particle-ai/particle-1');
    expect(JSON.parse(r.choices[0].message.tool_calls[0].function.arguments)).toEqual({ command: 'echo hi' });
    const s = await answer('/v1/chat/completions', { model: 'gpt-6.1-sol', stream: true }, 2, null, 'Done.').text();
    expect(s).toContain('"content":"Done."');
    expect(s).toContain('[DONE]');
  });
});

describe('the fake upstream drives a conversation to the end', () => {
  let active: ReturnType<typeof newState> | null = newState();
  const fake = startFake(() => (active ? { harness: 'openclaw', commit: COMMIT, state: active } : null));
  afterAll(() => fake.stop(true));
  test('a Messages client running each Bash call under a scrubbed environment gets the recall plan, then text', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ric-home-'));
    const messages: any[] = [msg("What's my sister's new cat called?")];
    let reply: any = null;
    for (let i = 0; i < 6; i++) {
      reply = await (await fetch('http://127.0.0.1:' + fake.port + '/v1/messages', { method: 'POST', body: JSON.stringify({ model: 'claude-opus-5-5', tools: bashTool, messages }) })).json();
      if (reply.stop_reason !== 'tool_use') break;
      const use = reply.content[0];
      messages.push(msg(reply.content, 'assistant'), msg([{ type: 'tool_result', tool_use_id: use.id, content: sh(use.input.command, {}, home).stdout }]));
    }
    expect(reply.content[0]).toEqual({ type: 'text', text: 'I checked the gbrain setup.' });
    expect(active!.requests).toBe(3);
    expect(active!.seen).toMatchObject({ 'recall.env_names': 'none', 'recall.token_read': '0', mcp_listed: '0', 'step.recall-mcp': '1' });
    expect(active!.seen.gbrain_procs).toMatch(/^\d+$/);
    active = null;
  });
});

describe('the pass rules', () => {
  const record = { trial_id: 'r/check/gbrain-install/r1' } as TrialRecord;
  const good = {
    record, requests: 40, gbrainTools: 3,
    usage: [{ key: trialKey(record.trial_id), outcome: 'forwarded', provider: 'openai', model: 'gpt-6.1-sol', token_presented: true }],
    seen: { 'install.bun_exit': '0', 'install.install_exit': '0', 'install.setup_exit': '0', mcp_listed: '1', gbrain_procs: '1', brain_path: '/s/.gbrain/brain.pglite',
      'install.env_names': 'none', 'install.token_read': '1', 'install.token_hits': '0', 'recall.env_names': 'HE_MODEL_API_KEY', 'recall.token_read': '1', 'recall.token_hits': '0' },
    probes: [{ brain_path: null }, { brain_path: '/s/.gbrain/brain.pglite' }], watch: [{ brain_path: '/s/.gbrain/brain.pglite' }],
  };
  const codex = { harness: 'codex', model: 'openai:gpt-6.1-sol' };
  const oks = (e: typeof good, c = codex) => Object.fromEntries(Object.entries(evaluate(c, e)).map(([k, v]) => [k, v.ok]));
  test('all four pass on good evidence', () => expect(oks(good)).toEqual({ a: true, b: true, c: true, d: true }));
  test('each rule fails on its own evidence', () => {
    expect(oks({ ...good, usage: [{ ...good.usage[0]!, token_presented: false }] }).a).toBe(false);
    expect(oks({ ...good, usage: [{ ...good.usage[0]!, key: 'trial-token:other' }] }).a).toBe(false);
    expect(oks({ ...good, seen: { ...good.seen, 'install.setup_exit': '1' } }).b).toBe(false);
    expect(oks({ ...good, gbrainTools: 0 }).b).toBe(false);
    expect(oks({ ...good, gbrainTools: 0 }, { harness: 'claude-code', model: 'anthropic:claude-opus-5-5' }).b).toBe(true);
    expect(oks({ ...good, seen: { ...good.seen, 'recall.token_hits': '1' } }).c).toBe(false);
    expect(oks({ ...good, seen: { ...good.seen, 'install.env_names': 'OPENAI_API_KEY' } }).c).toBe(false);
    expect(oks({ ...good, seen: { ...good.seen, 'install.token_read': '0' } }).c).toBe(false);
    expect(oks({ ...good, watch: [{ brain_path: '/s/.gbrain/config.json' }] }).d).toBe(false);
    expect(oks({ ...good, probes: [] }).d).toBe(false);
  });
});

describe('the Codex semantic-search case', () => {
  test('the container script parses and names only the dummy key', () => {
    for (const commit of Object.values(SEMANTIC_VERSIONS)) {
      const script = semanticScript(commit, 'http://host.docker.internal:1');
      expect(spawnSync('bash', ['-n', '-c', script]).status).toBe(0);
      expect(script).toContain('github:garrytan/gbrain#' + commit);
      expect(script).not.toMatch(/sk-(ant-|proj-)/);
    }
  });

  test('fake vectors are deterministic unit vectors, and the embeddings reply honours dimensions and base64', async () => {
    const v = fakeVector('zebra codename', 64);
    expect(v).toEqual(fakeVector('zebra codename', 64));
    expect(Math.hypot(...v)).toBeCloseTo(1, 9);
    const plain = await embeddingsReply({ model: 'text-embedding-3-small', input: ['a', 'b'] }).json() as any;
    expect(plain.data.map((d: any) => d.embedding.length)).toEqual([1536, 1536]);
    const b64 = await embeddingsReply({ model: 'm', input: 'a', dimensions: 8, encoding_format: 'base64' }).json() as any;
    expect(new Float32Array(Buffer.from(b64.data[0].embedding, 'base64').buffer.slice(0)).length).toBe(8);
  });

  test("the query call uses gbrain's MCP query tool, namespaced or flat, else Codex's exec", () => {
    expect(gbrainQueryCall({ input: [{ type: 'additional_tools', tools: [{ type: 'namespace', name: 'mcp__gbrain__', tools: [{ type: 'function', name: 'search' }, { type: 'function', name: 'query' }] }] }] }))
      .toMatchObject({ tool: { name: 'query', custom: false, namespace: 'mcp__gbrain__' }, args: { query: expect.any(String) } });
    expect(gbrainQueryCall({ tools: [{ type: 'function', name: 'mcp__gbrain__search' }] })?.tool.name).toBe('mcp__gbrain__search');
    expect(gbrainQueryCall({ tools: [{ type: 'custom', name: 'exec' }] })?.source).toContain('Object.keys(tools)');
    expect(gbrainQueryCall({ tools: [{ type: 'function', name: 'shell' }] })).toBeNull();
  });

  test('a run of the fake: embeddings during codex exec with the dummy key, the query called, vector_enabled true, passes', async () => {
    const state = newSemanticState();
    const fake = startSemanticFake('127.0.0.1', () => state);
    const base = 'http://127.0.0.1:' + fake.port;
    try {
      await fetch(base + '/v1/embeddings', { method: 'POST', headers: { authorization: 'Bearer ' + SEMANTIC_KEY }, body: JSON.stringify({ model: 'text-embedding-3-small', input: ['page'] }) });
      await fetch(base + '/__he/phase?p=codex');
      const tools = [{ type: 'namespace', name: 'mcp__gbrain__', tools: [{ type: 'function', name: 'query' }] }];
      const first = await (await fetch(base + '/v1/responses', { method: 'POST', body: JSON.stringify({ model: 'gpt-6.1-sol', tools, input: [{ role: 'user', content: 'q' }] }) })).json() as any;
      expect(first.output[0]).toMatchObject({ type: 'function_call', namespace: 'mcp__gbrain__', name: 'query' });
      await fetch(base + '/v1/embeddings', { method: 'POST', headers: { authorization: 'Bearer ' + SEMANTIC_KEY }, body: JSON.stringify({ model: 'text-embedding-3-small', input: SEMANTIC_QUESTION }) });
      const second = await (await fetch(base + '/v1/responses', { method: 'POST', body: JSON.stringify({ model: 'gpt-6.1-sol', tools, input: [{ role: 'user', content: 'q' }, { type: 'function_call_output', call_id: 'c', output: '{"returned_count":1,"vector_enabled":true,"degraded":[]}' }] }) })).json() as any;
      expect(second.output[0].type).toBe('message');
    } finally { fake.stop(true); }
    const marks = { config_names_OPENAI_API_KEY: '1', config_names_OPENAI_BASE_URL: '1' };
    expect(Object.fromEntries(Object.entries(evaluateSemantic(state, marks)).map(([k, v]) => [k, v.ok]))).toEqual({ a: true, b: true, c: true });
    const keyless = { ...state, embeddings: state.embeddings.filter((e) => e.phase !== 'codex'), outputs: ['{"vector_enabled":false,"degraded":[{"stage":"embed_unavailable"}]}'] };
    expect(Object.fromEntries(Object.entries(evaluateSemantic(keyless, {})).map(([k, v]) => [k, v.ok]))).toEqual({ a: false, b: false, c: false });
  });

  test('on the verbs surface exec calls recall: (c) passes when recall reports no search_degraded, fails on keyword fallback', () => {
    const s = { ...newSemanticState(), called: 'functions/exec', embeddings: [{ phase: 'codex', key_matches: true, inputs: 1, model: 'm', query: true }] };
    const c = (out: string) => evaluateSemantic({ ...s, outputs: [out] }, {}).c.ok;
    expect(c('TOOLS mcp__gbrain__recall\nCALLED mcp__gbrain__recall\n{"facts":[{"text":"x"}]}')).toBe(true);
    expect(c('CALLED mcp__gbrain__recall\n{"facts":[],"search_degraded":"keyword_only_no_embedding_provider"}')).toBe(false);
    expect(c('NO_GBRAIN_TOOL')).toBe(false);
  });
});

describe('gbrain tools a request offers', () => {
  test('declared gbrain tools, or the mcp__gbrain__ names Codex code mode lists inside exec', () => {
    expect(gbrainToolCount({ tools: [{ type: 'function', name: 'mcp__gbrain__query' }, { type: 'function', name: 'shell' }] })).toBe(1);
    expect(gbrainToolCount({ tools: [{ type: 'custom', name: 'exec', description: 'tools.mcp__gbrain__recall(args), tools.mcp__gbrain__remember(args), tools.mcp__gbrain__recall' }] })).toBe(2);
    expect(gbrainToolCount({ tools: [{ type: 'custom', name: 'exec', description: 'no memory tools' }], input: 'mcp__gbrain__recall' })).toBe(0);
  });

  test('Codex recall runs an exec that counts the mcp__gbrain__ keys of its tools object, and its source holds no marker', () => {
    const step = recallPlan('codex').at(-1)!;
    expect(step).toMatchObject({ name: 'recall-tools', source: CODEX_TOOLS_SOURCE });
    expect(recallPlan('hermes').some((s) => s.source)).toBe(false);
    expect(markers(CODEX_TOOLS_SOURCE)).toEqual({});
    const out: string[] = [];
    new Function('tools', 'text', CODEX_TOOLS_SOURCE)({ exec_command: () => null, mcp__gbrain__query: () => null, mcp__gbrain__put_page: () => null }, (s: string) => out.push(s));
    const result = out.join('\n');
    expect(markers(result)).toEqual({ gbrain_tools: '2', 'step.recall-tools': '1' });
    expect(gbrainToolCount({ tools: [{ type: 'custom', name: 'exec' }], input: [{ type: 'custom_tool_call_output', output: result }] })).toBe(2);
  });
});
