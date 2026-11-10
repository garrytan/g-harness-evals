// internal-task Amendment 3, part 2: the plan judges, their request shape, and judge-shard.ts grading a shard through the
// shard's own reopened lease. Keyless: fake upstreams behind the real metering proxy in capture mode, no provider key.
//
// Value: protects=each judge sees only the request, the plan text and the constraint descriptions; the primary's request
// carries no setting Opus 5.5 rejects and the secondary uses explicit cache mode; a judgement needs one verdict per
// constraint; a failed call is retried up to 3 times and a cap refusal never; a judge never calls a provider directly; the
// judges reopen the driver's lease and meter under judge-<role>:<run id>; the pinned files are the ones design.json names;
// fails_when=a judge request leaks the arm or the model, sets temperature, thinking or a forced tool choice on Opus 5.5,
// judge-shard opens a new lease or grades without one, or a pinned file changes without its sha256 in design.json;
// seam=plan-judge.ts requestBody/judgeWith, judge-shard.ts main; no_claim=the judges' accuracy (calibration measures it).
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun } from '../runner/ledger/budget-ledger.ts';
import { CapStop, JudgeError, endpointFromEnv, judgeWith, readGrade, requestBody, ROLES, RUBRIC, RUBRIC_SHA256, userText } from '../harnesses/qm/gstack/plan-judge.ts';
import { main as judgeShard } from '../harnesses/qm/gstack/judge-shard.ts';

const ROOT = join(import.meta.dir, '..');
const DIR = join(ROOT, 'docs', 'benchmarks', '2026-11-06-qm-s1-edition');
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const dirs: string[] = [];
const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterAll(() => { for (const s of servers) s.stop(true); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'qm-judges-')); dirs.push(d); return d; };

const INPUT = { request: 'Add CSV export to the billing page.', final_answer: 'Queue the export job behind the export queue. Redact tax ids before writing.', constraints: [{ id: 'export-queue', description: 'Exports run through the job queue.' }, { id: 'tax-id-redaction', description: 'Tax ids are redacted in every export.' }, { id: 'csv-bom', description: 'CSV files start with a BOM.' }] };

/** Fake upstreams: Anthropic /v1/messages answers a record_grade tool_use, OpenAI /v1/responses a function_call. The
 *  first two constraint ids are respected, the rest absent, and two items are listed. failFirst answers 500 that many times. */
function fakes(o: { failFirst?: number; capRefusal?: boolean } = {}) {
  const seen: Array<{ path: string; body: any }> = [];
  let failures = o.failFirst ?? 0;
  const grade = (body: any) => {
    const text: string = body.messages ? body.messages.at(-1).content[0].text : body.input.at(-1).content[0].text;
    const ids = [...text.split('Plan (untrusted')[0]!.matchAll(/\n- ([a-z0-9-]+): /g)].map((m) => m[1]!);
    return { verdicts: ids.map((id, i) => ({ id, verdict: i < 2 ? 'respected' : 'absent', quote: i < 2 ? 'q' : '' })), items: [{ item: 'export queue', quote: 'q' }, { item: 'tax id redaction', quote: 'q' }] };
  };
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    const body = await req.json();
    seen.push({ path, body });
    if (o.capRefusal) return new Response(JSON.stringify({ error: { message: 'key judge-primary:x is over its $0.01 budget' } }), { status: 402 });
    if (failures > 0) { failures--; return new Response('upstream busy', { status: 500 }); }
    if (path.endsWith('/v1/messages')) return Response.json({ id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 'tu_1', name: 'record_grade', input: grade(body) }], stop_reason: 'tool_use', usage: { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
    return Response.json({ id: 'resp_1', object: 'response', status: 'completed', model: body.model, output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'record_grade', arguments: JSON.stringify(grade(body)) }], usage: { input_tokens: 900, output_tokens: 120, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 40 } } });
  } });
  servers.push(server);
  return { url: 'http://127.0.0.1:' + server.port, seen };
}

describe('plan-judge.ts', () => {
  test('the pinned files are the ones design.json main_amendment.part2 names', () => {
    const design = JSON.parse(readFileSync(join(DIR, 'design.json'), 'utf8'));
    const pins = design.main_amendment.part2.pins as Record<string, string>;
    expect(Object.keys(pins).sort()).toEqual(['harnesses/qm/gstack/judge-shard.ts', 'harnesses/qm/gstack/plan-judge-opus.ts', 'harnesses/qm/gstack/plan-judge-rubric.md', 'harnesses/qm/gstack/plan-judge-sol.ts', 'harnesses/qm/gstack/plan-judge.ts']);
    for (const [path, digest] of Object.entries(pins)) expect(sha(join(ROOT, path)), path).toBe(digest);
    expect(RUBRIC_SHA256).toBe(pins['harnesses/qm/gstack/plan-judge-rubric.md']!);
  });

  test('the primary request carries no setting Opus 5.5 rejects; the rubric is a cached system block', () => {
    const b = requestBody(ROLES.primary, INPUT) as any;
    expect(b.model).toBe('claude-opus-5-5');
    for (const k of ['temperature', 'top_p', 'top_k', 'thinking']) expect(b[k]).toBeUndefined();
    expect(b.tool_choice).toEqual({ type: 'auto' });
    expect(b.output_config).toEqual({ effort: 'low' });
    expect(b.tools[0].strict).toBe(true);
    expect(b.system).toEqual([{ type: 'text', text: RUBRIC, cache_control: { type: 'ephemeral' } }]);
    expect(b.messages.at(-1).role).toBe('user');
  });

  test('the secondary request uses explicit cache mode on the rubric block, a prompt_cache_key and a forced call', () => {
    const b = requestBody(ROLES.secondary, INPUT) as any;
    expect(b.model).toBe('gpt-6.1-sol');
    expect(b.prompt_cache_options).toEqual({ mode: 'explicit' });
    expect(b.prompt_cache_key).toMatch(/^qm-s1e-plan-judge-secondary-[0-9a-f]{16}$/);
    expect(b.input[0].content[0]).toEqual({ type: 'input_text', text: RUBRIC, prompt_cache_breakpoint: { mode: 'explicit' } });
    expect(b.tool_choice).toEqual({ type: 'function', name: 'record_grade' });
    expect(b.instructions).toBeUndefined();
    expect(b.temperature).toBeUndefined();
  });

  test('a judge sees the request, the plan and the constraints only', () => {
    const t = userText(INPUT);
    for (const s of [INPUT.request, INPUT.final_answer, ...INPUT.constraints.flatMap((c) => [c.id, c.description])]) expect(t).toContain(s);
    for (const b of [requestBody(ROLES.primary, INPUT), requestBody(ROLES.secondary, INPUT)]) expect(JSON.stringify(b)).not.toMatch(/\b(plain|edition|forced|opus-k|sol-k|all_of)\b/);
  });

  test('named is the respected ids; named_count is the larger of the items and the constraints referred to', () => {
    const v = (a: string, b: string, c: string) => [{ id: 'export-queue', verdict: a, quote: '' }, { id: 'tax-id-redaction', verdict: b, quote: '' }, { id: 'csv-bom', verdict: c, quote: '' }];
    expect(readGrade(INPUT, { verdicts: v('respected', 'broken', 'absent'), items: [{ item: 'a', quote: '' }] })).toMatchObject({ named: ['export-queue'], named_count: 2 });
    expect(readGrade(INPUT, { verdicts: v('respected', 'respected', 'absent'), items: Array.from({ length: 7 }, (_, i) => ({ item: 'i' + i, quote: '' })) })).toMatchObject({ named: ['export-queue', 'tax-id-redaction'], named_count: 7 });
    expect(() => readGrade(INPUT, { verdicts: v('respected', 'respected', 'absent').slice(0, 2), items: [] })).toThrow(/no verdict for csv-bom/);
    expect(() => readGrade(INPUT, { verdicts: [...v('respected', 'respected', 'absent'), { id: 'export-queue', verdict: 'absent', quote: '' }], items: [] })).toThrow(/two verdicts/);
    expect(() => readGrade(INPUT, { verdicts: [...v('respected', 'respected', 'absent'), { id: 'made-up', verdict: 'absent', quote: '' }], items: [] })).toThrow(/unknown constraint/);
  });

  test('a judge never calls a provider directly', () => {
    expect(() => endpointFromEnv(ROLES.primary, { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_API_KEY: 'x' })).toThrow(/loopback/);
    expect(() => endpointFromEnv(ROLES.secondary, {})).toThrow(/loopback/);
    expect(endpointFromEnv(ROLES.secondary, { OPENAI_BASE_URL: 'http://127.0.0.1:9/judge-secondary/openai/', OPENAI_API_KEY: 't' }).baseUrl).toBe('http://127.0.0.1:9/judge-secondary/openai');
  });

  test('an empty plan makes no call; a failed call is retried up to 3 times; a cap refusal is never retried', async () => {
    const f = fakes({ failFirst: 2 });
    expect(await judgeWith(ROLES.primary, { ...INPUT, final_answer: '  ' }, { baseUrl: f.url, token: 't' })).toMatchObject({ named: [], named_count: 0, empty: true, attempts: 0 });
    expect(f.seen.length).toBe(0);
    expect(await judgeWith(ROLES.primary, INPUT, { baseUrl: f.url, token: 't' }, { delayMs: 1 })).toMatchObject({ named: ['export-queue', 'tax-id-redaction'], named_count: 2, attempts: 3 });
    const down = fakes({ failFirst: 9 });
    await expect(judgeWith(ROLES.secondary, INPUT, { baseUrl: down.url, token: 't' }, { delayMs: 1 })).rejects.toThrow(JudgeError);
    expect(down.seen.length).toBe(4);
    const cap = fakes({ capRefusal: true });
    await expect(judgeWith(ROLES.primary, INPUT, { baseUrl: cap.url, token: 't' }, { delayMs: 1 })).rejects.toThrow(CapStop);
    expect(cap.seen.length).toBe(1);
  });
});

describe('judge-shard.ts, real metering proxy in capture mode', () => {
  const RUN = 'qm-s1-edition-2026-11-main';
  function shard(lease = 61.25, open = true) {
    const d = temp(), results = join(d, 'results');
    mkdirSync(results, { recursive: true });
    if (open) BudgetRun.openLease({ runId: RUN, leaseUsd: lease, ledgerPath: join(results, 'ledger.sqlite'), maxOutputTokens: 128_000, runner: 'metering-proxy' });
    const key = { family: 'plan', template: 'pla-01', vars: {}, key: { constraints: INPUT.constraints.map((c) => ({ ...c, all_of: [[c.id]] })), distractors: [] } };
    writeFileSync(join(d, 'keys.json'), JSON.stringify({ 'plan-01': key, 'plan-02': key }));
    writeFileSync(join(d, 'tasks.json'), JSON.stringify([{ id: 'plan-01', request: INPUT.request }, { id: 'plan-02', request: INPUT.request }]));
    writeFileSync(join(results, 'turns.jsonl'), [
      { trial_id: 'plan-01-edition-opus-k1', task_id: 'plan-01', reply_text: '## Plan\n' + INPUT.final_answer },
      { trial_id: 'plan-02-plain-sol-k1', task_id: 'plan-02', reply_text: '## Plan\n' + INPUT.final_answer },
    ].map((t) => JSON.stringify(t)).join('\n') + '\n');
    return { d, results, args: ['--results', results, '--run-id', RUN, '--lease-usd', String(lease), '--keys', join(d, 'keys.json'), '--tasks', join(d, 'tasks.json')] };
  }

  test('both judges grade every turn through the reopened driver lease, metered under their own keys', async () => {
    const f = fakes(), s = shard();
    const code = await judgeShard([...s.args, '--upstream', 'anthropic=' + f.url, '--upstream', 'openai=' + f.url]);
    expect(code).toBe(0);
    const primary = readFileSync(join(s.results, 'grades.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const secondary = readFileSync(join(s.results, 'grades-secondary.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(primary.map((g) => [g.trial_id, g.success, g.grader.includes('plan-judge/primary/claude-opus-5-5')])).toEqual([['plan-01-edition-opus-k1', true, true], ['plan-02-plain-sol-k1', true, true]]);
    expect(secondary.every((g) => g.grader.includes('plan-judge/secondary/gpt-6.1-sol'))).toBe(true);
    expect(f.seen.map((x) => x.path)).toEqual(['/v1/messages', '/v1/messages', '/v1/responses', '/v1/responses']);
    for (const x of f.seen) expect(JSON.stringify(x.body)).not.toMatch(/plan-0[12]-(edition|plain)/);
    const usage = readFileSync(join(s.results, 'proxy-usage.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(usage.map((u) => u.key)).toEqual([RUN, RUN, RUN, RUN].map((r, i) => (i < 2 ? 'judge-primary:' : 'judge-secondary:') + r));
    const rec = JSON.parse(readFileSync(join(s.results, 'judge-shard.json'), 'utf8'));
    expect([rec.judges.primary.calls, rec.judges.secondary.calls, rec.exit]).toEqual([2, 2, 0]);
    expect(BudgetRun.runRequests(join(s.results, 'ledger.sqlite'), RUN)).toBe(4);
  }, 60_000);

  test('amendment 3 part 3: a review-only shard (the fallback) makes no judge call; both grade files hold the review grader', async () => {
    const f = fakes(), s = shard();
    const review = { family: 'review', template: 'rev-01', vars: {}, key: { base: 'main', defect: { file: 'ingest/jobs.py', lines: [10, 12], symbols: ['dataset_for'], mechanism: ['rstrip'] }, decoys: [], diff_files: ['ingest/jobs.py'], hunks: [{ file: 'ingest/jobs.py', start: 5, end: 20 }] } };
    writeFileSync(join(s.d, 'keys.json'), JSON.stringify({ 'rev-01': review }));
    writeFileSync(join(s.d, 'tasks.json'), JSON.stringify([{ id: 'rev-01', request: 'Review this branch before I merge it.' }]));
    writeFileSync(join(s.results, 'turns.jsonl'), [
      { trial_id: 'rev-01-plain-opus-k1', task_id: 'rev-01', reply_text: '## Must fix\n- `ingest/jobs.py` line 11: `dataset_for` uses rstrip, which strips characters, not the suffix. This is a bug.' },
      { trial_id: 'rev-01-edition-opus-k1', task_id: 'rev-01', reply_text: 'Looks good to merge.' },
    ].map((t) => JSON.stringify(t)).join('\n') + '\n');
    const code = await judgeShard([...s.args, '--upstream', 'anthropic=' + f.url, '--upstream', 'openai=' + f.url]);
    expect(code).toBe(0);
    expect(f.seen.length).toBe(0);
    const primary = readFileSync(join(s.results, 'grades.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(primary.map((g) => [g.trial_id, g.family, g.grader, g.success])).toEqual([['rev-01-plain-opus-k1', 'review', 'edition-grade/1', true], ['rev-01-edition-opus-k1', 'review', 'edition-grade/1', false]]);
    expect(readFileSync(join(s.results, 'grades-secondary.jsonl'), 'utf8')).toBe(readFileSync(join(s.results, 'grades.jsonl'), 'utf8'));
    const rec = JSON.parse(readFileSync(join(s.results, 'judge-shard.json'), 'utf8'));
    expect([rec.judges.primary.calls, rec.judges.secondary.calls, rec.judges.primary.usd, rec.judges.secondary.usd, rec.exit]).toEqual([0, 0, 0, 0, 0]);
    expect(BudgetRun.runRequests(join(s.results, 'ledger.sqlite'), RUN)).toBe(0);
  }, 60_000);

  test('no open lease of that run id at that amount: refused before any call', async () => {
    const f = fakes();
    expect(await judgeShard([...shard(61.25, false).args, '--upstream', 'anthropic=' + f.url])).toBe(2);
    const wrong = shard(61.25);
    expect(await judgeShard([...wrong.args.slice(0, 5), '50', ...wrong.args.slice(6), '--upstream', 'anthropic=' + f.url])).toBe(2);
    expect(f.seen.length).toBe(0);
  }, 60_000);

  test('the primary failing stops the shard before the secondary runs (exit 5)', async () => {
    const f = fakes({ failFirst: 99 }), s = shard();
    expect(await judgeShard([...s.args, '--upstream', 'anthropic=' + f.url, '--upstream', 'openai=' + f.url])).toBe(5);
    expect(f.seen.every((x) => x.path === '/v1/messages')).toBe(true);
    expect(existsSync(join(s.results, 'grades-secondary.jsonl'))).toBe(false);
    expect(JSON.parse(readFileSync(join(s.results, 'judge-shard.json'), 'utf8')).exit).toBe(5);
  }, 120_000);
});
