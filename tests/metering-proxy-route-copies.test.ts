// internal-task (H10) PR 5: the metering proxy's route copies (runner/proxy/metering-proxy.ts routeCopies), keyless.
// The byte-identity check: tests/fixtures/metering-proxy-golden/golden.json is the usage log and ledger the proxy at
// origin/main (205c1432, without this change; re-recorded after #293's usage-line schema v1) wrote for drive.ts's fixed request sequence (record.ts re-records it
// from a checkout; a deliberate proxy or price change re-records it in the same commit). Today's proxy must write the same
// bytes, times aside, when no route texts are set and when the slot is bound without routes.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetRun, closeLedgers, readLedger } from '../runner/ledger/budget-ledger.ts';
import { MeteringProxy, parseProxyArgs, routeCopies, type UsageLine } from '../runner/proxy/metering-proxy.ts';
import { BRAIN_FIRST_DESCRIPTION, cellRoute, routeTextsFor } from '../runner/trial/routes.ts';
import { drive, LISTING, PLACEBO, RULE, snapshot } from './fixtures/metering-proxy-golden/drive.ts';

const ROOT = join(import.meta.dir, '..');
const GOLDEN = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'metering-proxy-golden', 'golden.json'), 'utf8')) as { usage: string[]; ledger: string[] };
const tmp = mkdtempSync(join(tmpdir(), 'route-copies-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });
const TEXTS = { copies: [RULE, PLACEBO], listing: [LISTING] };

let n = 0;
async function run(o: Parameters<typeof drive>[3] = {}) {
  const dir = join(tmp, String(++n));
  mkdirSync(dir, { recursive: true });
  const { usageLog, ledgerPath } = await drive(MeteringProxy as never, BudgetRun as never, dir, o);
  const text = readFileSync(usageLog, 'utf8');
  return { snap: snapshot(text, readLedger(ledgerPath).entries as never), lines: text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine) };
}

describe('byte-identical without route fields', () => {
  test('no route texts: every usage line and ledger entry is the one the proxy wrote before H10 PR 5', async () => {
    const { snap } = await run();
    expect(snap.usage).toEqual(GOLDEN.usage);
    expect(snap.ledger).toEqual(GOLDEN.ledger);
  });
  test('route texts given, slot bound without routes: still byte-identical', async () => {
    const { snap } = await run({ routeTexts: TEXTS });
    expect(snap.usage).toEqual(GOLDEN.usage);
    expect(snap.ledger).toEqual(GOLDEN.ledger);
  });
  test('a routes slot without route texts: still byte-identical', async () => {
    const { snap } = await run({ routes: true });
    expect(snap.usage).toEqual(GOLDEN.usage);
  });
});

describe('a routes slot with route texts', () => {
  test('the ledger is unchanged, and each usage line is the golden one plus route_copies or housekeeping', async () => {
    const { snap, lines } = await run({ routes: true, routeTexts: TEXTS });
    expect(snap.ledger).toEqual(GOLDEN.ledger);
    const stripped = snap.usage.map((l) => { const o = JSON.parse(l); delete o.route_copies; delete o.housekeeping; return JSON.stringify(o); });
    expect(stripped).toEqual(GOLDEN.usage);
    const zero = { system: 0, user: 0, tool_result: 0, history: 0, listing: 0 };
    expect(lines.map((l) => l.route_copies ?? (l.housekeeping ? 'housekeeping' : null))).toEqual([
      { ...zero, system: 1, user: 1 },
      { ...zero, user: 1, tool_result: 1 },
      { ...zero, user: 1, history: 1, listing: 1 },
      'housekeeping',
      null,
      zero,
      { ...zero, user: 1 },
      null,
    ]);
    expect(lines[3]!.route_copies).toBeUndefined();
    expect(JSON.stringify(lines)).not.toContain('Fixture rule bytes');
  });
});

describe('routeCopies by location', () => {
  const texts = { copies: ['RULE'], listing: ['DESC'] };
  test('Anthropic: the per-turn hook carries N copies on turn N, the one-time hook one copy in history', () => {
    const t1 = { role: 'user', content: 'RULE\n\nq1' }, a1 = { role: 'assistant', content: 'a1' };
    expect(routeCopies({ messages: [t1, a1, { role: 'user', content: 'RULE\n\nq2' }] }, texts)).toEqual({ system: 0, user: 1, tool_result: 0, history: 1, listing: 0 });
    expect(routeCopies({ messages: [t1, a1, { role: 'user', content: 'q2' }] }, texts)).toEqual({ system: 0, user: 0, tool_result: 0, history: 1, listing: 0 });
    expect(routeCopies({ system: 'DESC RULE', messages: [{ role: 'user', content: [{ type: 'text', text: 'RULE' }, { type: 'text', text: 'q' }] }] }, texts)).toEqual({ system: 1, user: 1, tool_result: 0, history: 0, listing: 1 });
  });
  test('consecutive user messages at the end are all the current turn; a tool result in history is still a tool result', () => {
    const body = { messages: [{ role: 'user', content: 'old RULE' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Read', input: { p: 'RULE' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: [{ type: 'text', text: 'RULE RULE' }] }] }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'RULE' }, { role: 'user', content: 'q' }] };
    expect(routeCopies(body, texts)).toEqual({ system: 0, user: 1, tool_result: 2, history: 2, listing: 0 });
  });
  test('OpenAI Responses: instructions and developer items are system, function_call_output is a tool result', () => {
    expect(routeCopies({ instructions: 'RULE', input: [{ role: 'developer', content: 'DESC' }, { role: 'user', content: [{ type: 'input_text', text: 'RULE q' }] }, { type: 'function_call', arguments: '{}' }, { type: 'function_call_output', output: 'RULE' }] }, texts))
      .toEqual({ system: 1, user: 1, tool_result: 1, history: 0, listing: 1 });
    expect(routeCopies({ input: 'RULE and RULE' }, texts)).toEqual({ system: 0, user: 2, tool_result: 0, history: 0, listing: 0 });
  });
  test('Chat Completions: a system message is system, a tool message a tool result; no body counts nothing', () => {
    expect(routeCopies({ messages: [{ role: 'system', content: 'RULE' }, { role: 'user', content: 'RULE' }, { role: 'assistant', content: null, tool_calls: [] }, { role: 'tool', content: 'RULE' }] }, texts))
      .toEqual({ system: 1, user: 1, tool_result: 1, history: 0, listing: 0 });
    expect(routeCopies(undefined, texts)).toEqual({ system: 0, user: 0, tool_result: 0, history: 0, listing: 0 });
  });
});

describe('the route texts a run hands the proxy', () => {
  const base = ['--listen', '127.0.0.1:0', '--budget-ledger', join(tmp, 'x.sqlite'), '--lease-usd', '1', '--run-id', 'x'];
  test('parseProxyArgs reads --route-texts and refuses a malformed file; without it there are none', () => {
    const good = join(tmp, 'texts.json');
    writeFileSync(good, JSON.stringify(TEXTS));
    expect(parseProxyArgs([...base, '--route-texts', good]).routeTexts).toEqual(TEXTS);
    expect(parseProxyArgs(base).routeTexts).toBeNull();
    const bad = join(tmp, 'bad.json');
    writeFileSync(bad, JSON.stringify({ copies: [''] }));
    expect(() => parseProxyArgs([...base, '--route-texts', bad])).toThrow(/--route-texts must name/);
  });
  test('only a route cell on a route harness turns counting on; the texts are the rule, the placebo and the skill descriptions', () => {
    expect(routeTextsFor([{ harness: 'qm', config: 'pi' }, { harness: 'openclaw' }, { harness: 'hermes', config: 'default' }, { harness: 'codex', config: 'sdk-preset+route-hook' }], ROOT)).toBeUndefined();
    expect(cellRoute({ harness: 'claude-code', config: 'sdk-preset+route-told' })).toEqual({ driver: 'sdk-preset', route: 'route-told' });
    const t = routeTextsFor([{ harness: 'openclaw', config: 'route-tool' }], ROOT)!;
    expect(t.copies).toEqual([readFileSync(join(ROOT, 'harnesses/routes/instruction.md'), 'utf8'), readFileSync(join(ROOT, 'harnesses/routes/placebo.md'), 'utf8')]);
    expect(t.listing).toEqual([BRAIN_FIRST_DESCRIPTION]);
  });
  test('the brain-first description is the one the adapters write', () => {
    for (const h of ['openclaw', 'hermes']) expect(readFileSync(join(ROOT, 'harnesses', h, 'adapter.sh'), 'utf8')).toContain(BRAIN_FIRST_DESCRIPTION);
  });
});
