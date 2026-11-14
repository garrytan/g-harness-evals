// Background-wait canary (scripts/review-bugs/wait-canary.ts) and its fake model (scripts/review-bugs/fake-reader-model.ts).
// Unit tests are keyless and need no docker. The docker tests run one short canary per harness image (5-second reader
// delay instead of 120) through the real metering proxy with dummy keys, and skip when docker or the image is missing.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fill, pick, startFakeReaderModel, texts, validateRules, type Rule } from '../../scripts/review-bugs/fake-reader-model.ts';
import { ADV_PROMPT, DEFAULT_IMAGE, INSTRUCTION, MAIN, READER, REPORT, TESTING_PROMPT, canaryRules, refusals, runCanary, verdictOf, type CanaryHarness } from '../../scripts/review-bugs/wait-canary.ts';
import { ExposureGap, GAP_CODES, type Launch, type SessionRead } from '../../scripts/review-bugs/exposure.ts';

const tools = [{ name: 'x', input_schema: { type: 'object' } }];
const body = (user: string, extra: Record<string, unknown> = {}) => ({ model: 'm', tools, messages: [{ role: 'user', content: user }], ...extra });

describe('fake reader model rules', () => {
  test('the first matching rule answers; times limits a rule; absent and contains are checked on the whole body', () => {
    const rules: Rule[] = [{ id: 'a', when: { user_contains: 'MAIN', absent: 'DONE' }, times: 1, reply: { text: 'a' } }, { id: 'b', when: { contains: 'MAIN' }, reply: { text: 'b' } }];
    const used = new Map<string, number>();
    expect(pick(body('MAIN go'), rules, used)?.id).toBe('a');
    used.set('a', 1);
    expect(pick(body('MAIN go'), rules, used)?.id).toBe('b');
    expect(pick(body('MAIN go DONE'), rules, new Map())?.id).toBe('b');
    expect(pick(body('nothing'), rules, new Map())).toBeNull();
  });
  test('a request without tools (a title or summary call) meets no rule', () => {
    expect(pick({ model: 'm', messages: [{ role: 'user', content: 'MAIN' }] }, [{ id: 'a', reply: { text: 'a' } }], new Map())).toBeNull();
  });
  test('texts reads system and user text from both wires; tool results are not user text', () => {
    expect(texts({ system: [{ type: 'text', text: 'S' }], messages: [{ role: 'user', content: [{ type: 'tool_result', content: 'R' }] }, { role: 'user', content: 'U' }] })).toEqual({ system: 'S', users: ['U'] });
    expect(texts({ instructions: 'I', input: [{ role: 'developer', content: [{ type: 'input_text', text: 'D' }] }, { role: 'user', content: [{ type: 'input_text', text: 'U' }] }] })).toEqual({ system: 'I\nD', users: ['U'] });
  });
  test('fill takes the last match of a regex from the request', () => {
    expect(fill({ ids: ['{{re:runId=(\\w+)}}'] }, 'runId=a1 then runId=b2')).toEqual({ ids: ['b2'] });
    expect(fill('{{re:nope=(\\w+)}}', 'x')).toBe('');
  });
  test('validateRules refuses a rule with no reply or a bad delay', () => {
    expect(() => validateRules([{ id: 'a' }])).toThrow();
    expect(() => validateRules([{ id: 'a', reply: { text: 'x' }, delay_s: -1 }])).toThrow();
    expect(validateRules([{ id: 'a', reply: { custom_tool: 'exec', code: 'x' } }]).length).toBe(1);
  });
  test('the server answers both wires, holds a delayed stream open and records only a hash of the key', async () => {
    const fake = startFakeReaderModel({ rules: [{ id: 'slow', when: { user_contains: 'SLOW' }, delay_s: 1, reply: { text: 'late' } }, { id: 'tool', when: { user_contains: 'TOOL' }, reply: { tool: 'spawn_agent', namespace: 'collaboration', input: { message: 'm' } } }] });
    try {
      const base = 'http://127.0.0.1:' + fake.port;
      const t0 = Date.now();
      const slow = await fetch(base + '/v1/messages', { method: 'POST', headers: { 'x-api-key': 'dummy' }, body: JSON.stringify(body('SLOW', { stream: true })) });
      const text = await slow.text();
      expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
      expect(text).toContain('late');
      const tool = await (await fetch(base + '/v1/responses', { method: 'POST', body: JSON.stringify({ model: 'm', tools, input: [{ role: 'user', content: [{ type: 'input_text', text: 'TOOL' }] }] }) })).json() as { output: Array<Record<string, unknown>> };
      expect(tool.output[0]).toMatchObject({ type: 'function_call', name: 'spawn_agent', namespace: 'collaboration' });
      expect(fake.requests.map(r => [r.wire, r.rule])).toEqual([['anthropic', 'slow'], ['responses', 'tool']]);
      expect(fake.requests[0].authorization_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(fake.requests)).not.toContain('dummy');
    } finally { fake.stop(); }
  });
});

describe('canary rules', () => {
  test('only the reader rules carry the delay; the final rule needs every report', () => {
    for (const h of ['openclaw', 'hermes', 'codex'] as CanaryHarness[]) for (const s of ['wait', 'full'] as const) {
      const rules = canaryRules(h, s, 120);
      expect(rules.filter(r => r.delay_s).map(r => r.id).sort()).toEqual(['reader', 'reader-adv']);
      expect(rules.find(r => r.id === 'reader')?.delay_s).toBe(120);
      expect(rules[0].id).toBe('final');
    }
  });
  test('the main session dispatches through the harness tool, and only full opens the skill', () => {
    const first = (h: CanaryHarness, s: 'wait' | 'full' | 'collector' | 'end-turn') => pick(body(INSTRUCTION), canaryRules(h, s, 1), new Map())?.reply;
    expect(first('hermes', 'wait')).toMatchObject({ tool: 'delegate_task' });
    expect(first('codex', 'wait')).toMatchObject({ tool: 'spawn_agent', namespace: 'collaboration' });
    expect(first('openclaw', 'collector')).toMatchObject({ tool: 'tool_call', input: { id: 'sessions_spawn', args: { collect: true } } });
    expect(first('hermes', 'full')).toMatchObject({ tool: 'skill_view', input: { name: 'gstack-review' } });
    expect(first('openclaw', 'full')).toMatchObject({ tool: 'read' });
  });
  test('the reader prompts name the testing checklist and the adversarial marker', () => {
    expect(TESTING_PROMPT).toContain('review/specialists/testing.md');
    expect(ADV_PROMPT).toContain('Think like an attacker and a chaos engineer');
    expect(pick(body(TESTING_PROMPT), canaryRules('codex', 'wait', 7), new Map())).toMatchObject({ id: 'reader', delay_s: 7 });
    expect(pick(body(MAIN + ' ' + READER + ' ' + REPORT), canaryRules('codex', 'wait', 7), new Map())?.id).toBe('final');
  });
});

describe('verdict', () => {
  const launch = (started: boolean, returned: boolean): Launch => ({ locator: 'x', tool: 't', prompt: TESTING_PROMPT, started, refused: started ? null : 'no', returned, note: '' });
  const s = (ls: Launch[]): SessionRead => ({ harness: 'codex', files: [], skill: { opened: false, locator: null, how: null }, launches: ls, note: '' });
  test('each verdict from the transcript and the reader call count', () => {
    expect(verdictOf(new ExposureGap(GAP_CODES.missing, 'f', 'd'), 0)).toBe('gap');
    expect(verdictOf(s([]), 0)).toBe('not-dispatched');
    expect(verdictOf(s([launch(false, false)]), 0)).toBe('spawn-refused');
    expect(verdictOf(s([launch(true, true)]), 1)).toBe('waited');
    expect(verdictOf(s([launch(true, false)]), 0)).toBe('reader-never-ran');
    expect(verdictOf(s([launch(true, true), launch(true, false)]), 2)).toBe('ended-early');
  });
  test("Hermes's metadata probes are not refused model calls", () => {
    const lines = [
      { outcome: 'refused', model: null, route: '/api/tags' }, { outcome: 'refused', model: null, route: '/v1/models/claude-opus-5-5' },
      { outcome: 'refused', model: 'claude-sonnet-5-5', route: '/v1/messages' }, { outcome: 'refused', model: null, route: '/v1/responses' },
      { outcome: 'forwarded', model: 'claude-opus-5-5', route: '/v1/messages' },
    ].map(l => JSON.stringify(l));
    expect(refusals(lines)).toEqual({ refused_model_calls: 2, metadata_probes: 2 });
    expect(refusals(['not json']).refused_model_calls).toBe(1);
  });
});

const ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin' };
const haveDocker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore', env: ENV }).status === 0;
const have = (image: string) => haveDocker && spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore', env: ENV }).status === 0;
describe('canary through the real proxy (docker)', () => {
  const run = (h: CanaryHarness, image: string) => runCanary({ harness: h, scenario: 'full', image, delay: 5, budget: 300, out: join(mkdtempSync(join(tmpdir(), 'wait-canary-test-')), h) });
  for (const [h, image] of [['codex', DEFAULT_IMAGE.codex], ['hermes', DEFAULT_IMAGE.hermes], ['hermes', DEFAULT_IMAGE['hermes-chat']]] as Array<[CanaryHarness, string]>)
    test.skipIf(!have(image))(h + ' ' + image + ' waits for both readers; only the dummy key reached the fake', async () => {
      const r = await run(h, image);
      expect(r.verdict).toBe('waited');
      expect(r.readers).toEqual(['adversarial-native', 'testing']);
      expect(r.final_text_seen).toBe(true);
      expect(r.proxy.dummy_key_only).toBe(true);
      expect(r.proxy.refused_model_calls).toBe(0);
    }, 420_000);
  test.skipIf(!have(DEFAULT_IMAGE.openclaw))('openclaw ' + DEFAULT_IMAGE.openclaw + ' gives a verdict from its own store', async () => {
    const r = await run('openclaw', DEFAULT_IMAGE.openclaw);
    expect(r.gap).toBeNull();
    expect(r.launches.length).toBe(2);
    expect(r.proxy.dummy_key_only).toBe(true);
  }, 420_000);
});
