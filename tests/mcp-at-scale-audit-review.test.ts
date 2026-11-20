import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun } from '../runner/ledger/budget-ledger.ts';
import { loadCatalog } from '../scripts/mcp-at-scale/catalog-load.ts';
import { adjudicateInteractive, applyAudit, collectStage, customId, planStage, readAnswers, submitStage, writeStage, type Lease } from '../scripts/mcp-at-scale/requests/audit.ts';
import { catalogListing } from '../scripts/mcp-at-scale/requests/prompts.ts';
import { readJsonl, type RItem } from '../scripts/mcp-at-scale/requests/sets.ts';

const item: RItem = { id: 'r-audit', set: 'R', kind: 'tool', text: 'Look up a sample ticket.', stratum: 'capability_only', target: { server: 'sample', tool: 'lookup' }, bait: false, acceptable: [{ server: 'sample', tool: 'lookup' }] };
const disputed = 'sample/search';
const queue = [{ item: item.id, tool: disputed, judges: ['opus', 'astra'] }];
const other = { ...item, id: 'r-other', text: 'Look up another example.' };
const dirs: string[] = [];
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), 'mcp-audit-review-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const json = (value: unknown) => Response.json(value);
const label = (out: string, items = [item], catalogText = 'sample catalog') => writeStage(out, 'label', planStage({ stage: 'label', items, catalogText }));
const adjudicate = (out: string, catalogText = 'sample catalog', work = queue, items = [item]) => writeStage(out, 'adjudicate', planStage({ stage: 'adjudicate', items, catalogText, queue: work }));
const journal = (out: string, stage: string) => JSON.parse(readFileSync(join(out, stage, 'journal.json'), 'utf8')).intents;
const fakeLease = () => {
  const reserved: string[] = [], settled: Array<Parameters<Lease['settle']>> = [];
  const lease: Lease = { reserve: () => { const id = 'reservation-' + (reserved.length + 1); reserved.push(id); return id; }, settle: (...args) => { settled.push(args); } };
  return { lease, reserved, settled };
};
const labelText = JSON.stringify({ no_tool_needed: false, acceptable: [disputed] });
const labelUsage = { input_tokens: 10, output_tokens: 12 };
const antRow = (id: string, usage: object | null = labelUsage) => ({ custom_id: id, result: { type: 'succeeded', message: { content: [{ type: 'text', text: labelText }], usage } } });
const openAiRow = (id: string) => ({ custom_id: id, response: { status_code: 200, body: { choices: [{ message: { content: labelText } }], usage: { prompt_tokens: 10, completion_tokens: 12 } } } });
const gemini = (text: string) => json({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 12 } });
const runCli = (home: string, args: string[], preload?: string) => Bun.spawnSync([process.execPath, ...(preload ? ['--preload', preload] : []), 'scripts/mcp-at-scale/requests/audit.ts', ...args], { cwd: join(import.meta.dir, '..'), env: { HOME: home, PATH: '/usr/local/bin:/usr/bin:/bin' }, stdout: 'pipe', stderr: 'pipe' });
const fakeLabels = (ant: () => unknown[], openAi: () => unknown[] = () => [openAiRow(customId('label', item.id))]) => async (url: string, init?: RequestInit) => {
  const path = new URL(url).pathname;
  if (init?.method === 'POST') return json({ id: path === '/v1/files' ? 'input' : path === '/v1/batches' ? 'astra-batch' : 'opus-batch' });
  if (path === '/v1/messages/batches/opus-batch') return json({ processing_status: 'ended' });
  if (path === '/v1/batches/astra-batch') return json({ status: 'completed', output_file_id: 'results' });
  if (path === '/v1/messages/batches/opus-batch/results' || path === '/v1/files/results/content') return new Response((path.endsWith('/results') ? ant() : openAi()).map((r) => JSON.stringify(r)).join('\n') + '\n');
  throw new Error('unexpected fetch: ' + path);
};

test('paid adjudication defaults to guarded Gemini generateContent, and explicit batch is refused before a lease', async () => {
  const out = tmp(), sets = join(out, 'items.jsonl'), ledger = join(out, 'audit.sqlite');
  const catalog = join(import.meta.dir, '..', 'tasks', 'mcp-at-scale', 'catalog');
  writeFileSync(sets, JSON.stringify(item) + '\n');
  label(out, [item], catalogListing(loadCatalog(catalog)));
  const { lease } = fakeLease();
  const fetch = fakeLabels(() => [antRow(customId('label', item.id))]);
  await submitStage({ out, stage: 'label', fetch, lease });
  await collectStage({ out, stage: 'label', fetch, lease });
  const preload = join(out, 'fake-fetch.ts'), routes = join(out, 'routes.txt');
  writeFileSync(preload, `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (u) => {
  appendFileSync(${JSON.stringify(routes)}, new URL(String(u)).pathname + '\\n');
  return Response.json({ candidates: [{ content: { parts: [{ text: '{"verdict":"acceptable"}' }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 12 } });
};\n`);
  const runId = 'keyless-fake-audit';
  const run = (...flags: string[]) => runCli(out, ['adjudicate', '--sets', sets, '--catalog', catalog, '--out', out, '--ledger', ledger, '--run-id', runId, '--lease-usd', '100', ...flags], preload);
  const refused = run('--batch');
  expect(refused.exitCode).toBe(2);
  expect(refused.stderr.toString()).toContain('Gemini batch adjudication is not supported');
  expect(existsSync(ledger)).toBe(false);
  expect(existsSync(routes)).toBe(false);
  const paid = run();
  expect(paid.stderr.toString()).toBe('');
  expect(paid.exitCode).toBe(0);
  expect(readFileSync(routes, 'utf8')).toBe('/v1beta/models/gemini-4-carbon:generateContent\n');
  expect(BudgetRun.runRequests(ledger, runId)).toBe(1);
  expect(journal(out, 'adjudicate')[0]).toMatchObject({ state: 'settled', batch_id: null });
  const apply = () => {
    const applied = runCli(out, ['apply', '--sets', sets, '--out', out]);
    expect(applied.exitCode).toBe(0);
    return JSON.parse(readFileSync(join(out, 'audit-status.json'), 'utf8'));
  };
  const original = apply();
  expect(original.items[item.id]).toBe('widened');
  expect(original.manifest_sha256.adjudicate).toBe(journal(out, 'adjudicate')[0].manifest_sha256);
  writeFileSync(sets, JSON.stringify({ ...item, text: 'Look up a different sample.' }) + '\n');
  const revised = apply();
  expect(revised.items[item.id]).toBe('pending');
  expect(revised.item_sha256[item.id]).not.toBe(original.item_sha256[item.id]);
});

test('the batch submitter rejects Gemini before reserving or sending', async () => {
  const out = tmp(), { lease, reserved } = fakeLease();
  adjudicate(out);
  await expect(submitStage({ out, stage: 'adjudicate', fetch: async () => { throw new Error('unexpected fetch'); }, lease })).rejects.toThrow('Gemini batch adjudication is not supported');
  expect(reserved).toEqual([]);
  expect(existsSync(join(out, 'adjudicate', 'journal.json'))).toBe(false);
});

test('audit answers from an old item, catalog or intent cannot pass the current request', async () => {
  const out = tmp(), { lease } = fakeLease();
  label(out);
  const fetch = fakeLabels(() => [antRow(customId('label', item.id))]);
  await submitStage({ out, stage: 'label', fetch, lease });
  await collectStage({ out, stage: 'label', fetch, lease });
  adjudicate(out);
  await adjudicateInteractive({ out, fetch: async () => gemini('{"verdict":"acceptable"}') });
  const apply = (it: RItem) => applyAudit([it], readAnswers(out, 'label', [it]), readAnswers(out, 'adjudicate', [it])).status[it.id];
  expect(apply(item)).toBe('widened');
  expect(apply({ ...item, text: 'Use a different ticket.' })).toBe('pending');
  const answers = join(out, 'adjudicate', 'answers.jsonl');
  const record = readJsonl<Record<string, unknown>>(answers)[0]!;
  writeFileSync(answers, JSON.stringify({ ...record, intent_id: 'another-intent' }) + '\n');
  expect(apply(item)).toBe('pending');
  writeFileSync(answers, JSON.stringify(record) + '\n');
  adjudicate(out, 'updated catalog');
  expect(apply(item)).toBe('pending');
  label(out, [item], 'updated catalog');
  expect(readAnswers(out, 'label', [item]).size).toBe(0);
});

test('batch settlement needs the exact submitted IDs and valid usage for every result', async () => {
  const out = tmp(), { lease, settled } = fakeLease();
  label(out, [item, other]);
  const first = customId('label', item.id), second = customId('label', other.id);
  let opus = [antRow(first)];
  const fetch = fakeLabels(() => opus, () => [openAiRow(first), openAiRow(second)]);
  await submitStage({ out, stage: 'label', fetch, lease });
  expect(await collectStage({ out, stage: 'label', fetch, lease })).toEqual({ settled: 1, open: 1 });
  opus = [antRow(first), antRow(first)];
  expect(await collectStage({ out, stage: 'label', fetch, lease })).toEqual({ settled: 0, open: 1 });
  opus = [antRow(first), antRow('not-submitted')];
  expect(await collectStage({ out, stage: 'label', fetch, lease })).toEqual({ settled: 0, open: 1 });
  opus = [antRow(first), antRow(second, null)];
  expect(await collectStage({ out, stage: 'label', fetch, lease })).toEqual({ settled: 0, open: 1 });
  opus = [antRow(first), antRow(second, {})];
  expect(await collectStage({ out, stage: 'label', fetch, lease })).toEqual({ settled: 0, open: 1 });
  expect(settled.map(([id]) => id)).toEqual(['reservation-2']);
  expect(readAnswers(out, 'label', [item, other]).get(item.id)?.has('opus')).toBe(false);
  label(out, [item], 'updated catalog');
  opus = [antRow(first), antRow(second)];
  expect(await collectStage({ out, stage: 'label', fetch, lease })).toEqual({ settled: 1, open: 0 });
  expect(settled[1]).toEqual(['reservation-1', { usd: expect.any(Number), input_tokens: 20, output_tokens: 24 }]);
  expect(readAnswers(out, 'label', [item]).size).toBe(0);
});

test('same-manifest retry sends only the request missing a Gemini verdict', async () => {
  const out = tmp();
  adjudicate(out, 'sample catalog', [...queue, { ...queue[0]!, item: other.id }], [item, other]);
  const urls: string[] = [];
  const fetch = async (_url: string, init?: RequestInit) => {
    const text: string = JSON.parse(init!.body as string).contents[0].parts[0].text;
    urls.push(text.split(':')[0]!);
    if (urls.length === 1) return json({ candidates: [{ content: { parts: [{ thought: true, text: '{"verdict":"ambiguous"}' }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 0, thoughtsTokenCount: 16384 } });
    return gemini('{"verdict":"acceptable"}');
  };
  expect(await adjudicateInteractive({ out, fetch, concurrency: 1 })).toMatchObject({ answers: 2, errors: 1 });
  expect(journal(out, 'adjudicate')[0].state).toBe('sending');
  expect(readAnswers(out, 'adjudicate', [item, other]).get(item.id + '\u0000' + disputed)).toBeUndefined();
  expect(await adjudicateInteractive({ out, fetch, concurrency: 1 })).toMatchObject({ answers: 1, errors: 0 });
  expect(urls).toEqual(['Request id ' + item.id, 'Request id ' + other.id, 'Request id ' + item.id]);
  expect(journal(out, 'adjudicate')).toHaveLength(1);
  expect(journal(out, 'adjudicate')[0].state).toBe('settled');
  expect(readAnswers(out, 'adjudicate', [item, other]).get(item.id + '\u0000' + disputed)?.get('carbon')).toEqual({ verdict: 'acceptable' });
});

test('a label retry skips a submitted judge and resumes only work that was never sent', async () => {
  const out = tmp(), { lease } = fakeLease();
  label(out);
  const seen: string[] = [];
  const fetch = async (url: string) => { const path = new URL(url).pathname; seen.push(path); return json({ id: path }); };
  const reserve = lease.reserve;
  lease.reserve = (usd, description) => { if (description.includes('openai:')) throw new Error('interrupted before sending'); return reserve(usd, description); };
  await expect(submitStage({ out, stage: 'label', fetch, lease })).rejects.toThrow('interrupted before sending');
  lease.reserve = reserve;
  expect((await submitStage({ out, stage: 'label', fetch, lease })).map((i) => i.judge)).toEqual(['astra']);
  expect(seen).toEqual(['/v1/messages/batches', '/v1/files', '/v1/batches']);
});

test('a label retry reports an uncertain submission and never sends it again', async () => {
  const out = tmp(), { lease } = fakeLease();
  label(out);
  const seen: string[] = [];
  const fetch = async (url: string) => {
    const path = new URL(url).pathname;
    seen.push(path);
    if (path === '/v1/messages/batches') throw new Error('lost submission response');
    return json({ id: path });
  };
  await expect(submitStage({ out, stage: 'label', fetch, lease })).rejects.toThrow('lost submission response');
  await expect(submitStage({ out, stage: 'label', fetch, lease })).rejects.toThrow('reconcile');
  expect(seen).toEqual(['/v1/messages/batches', '/v1/files', '/v1/batches']);
  expect(journal(out, 'label').map((i: { state: string }) => i.state)).toEqual(['unknown', 'submitted']);
});
