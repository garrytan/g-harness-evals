import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { assertNoKeyShapes, compareProvider, dayIn, fetchPaged, readRun, reconcileAll, redact, renderMarkdown, summarizeProxy, type ProviderFixture, type UsageLine } from '../scripts/reconcile-provider.ts';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

// Synthetic key-shaped strings are built at run time so no literal in this file matches a secret scan.
const fakeAdminKey = ['sk-ant', 'admin01-abcdefghijklmnop'].join('-');
const fakeBotToken = ['xoxb', '1234567890-abc'].join('-');

const RUN = 'fixture-run-2026-10';
const key = (run: string, trial: string) => `sk-trial-${run}/cell-a/${trial}/r1`;
const line = (run: string, at: string, trial: string, usd: number, input: number, output: number, cached: number, extra: Partial<UsageLine> = {}): UsageLine =>
  ({ at, key: key(run, trial), provider: 'anthropic', model: 'claude-haiku-5-5', outcome: 'forwarded', status: 200, actual_usd: usd, input_tokens: input, output_tokens: output, cached_tokens: cached, ...extra });

/** A results directory: two trials on two UTC days (the second day's lines fall on the first local day in Los Angeles), one refused line, one forwarded 4xx, a ledger. */
function fixtureResults(opts: { run?: string; ledgerDriftUsd?: number; dropLedger?: boolean; dropUsage?: boolean; shift?: number } = {}): string {
  const run = opts.run ?? RUN;
  const dir = mkdtempSync(join(tmpdir(), 'reconcile-provider-')); dirs.push(dir);
  const day = (d: number) => `2026-10-${String(22 + d + (opts.shift ?? 0)).padStart(2, '0')}`;
  const lines: UsageLine[] = [
    line(run, `${day(0)}T23:50:00.000Z`, 't1', 0.10, 1000, 100, 400),
    line(run, `${day(1)}T00:10:00.000Z`, 't1', 0.20, 2000, 200, 800),
    line(run, `${day(1)}T01:00:00.000Z`, 't2', 0.30, 3000, 300, 0),
    { at: `${day(1)}T01:00:01.000Z`, key: key(run, 't2'), provider: 'anthropic', model: null, outcome: 'refused', status: 403 },
    line(run, `${day(1)}T01:00:02.000Z`, 't2', 0, 0, 0, 0, { status: 400 }),
    { at: `${day(1)}T01:00:03.000Z`, key: 'sk-trial-other-run/cell/t/r1', provider: 'anthropic', model: 'claude-haiku-5-5', outcome: 'forwarded', status: 200, actual_usd: 9, input_tokens: 9, output_tokens: 9, cached_tokens: 0 },
  ];
  writeFileSync(join(dir, 'proxy-usage.ndjson'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const trial = (id: string, usd: number, requests: number, input: number, output: number, cached: number, usage = true) => ({ trial_id: `${run}/cell-a/${id}/r1`, cell: 'cell-a', task: id, harness: 'fake', harness_mode: 'docker', model: 'anthropic:claude-haiku-5-5', script: null, termination: 'completed', grade: 'pass', consent_violation: false, approval_stop: false, effects: [], predicates: [], cap_stop: false, turns: { planned: 1, run: 1, exits: [0] }, usage: usage ? { key: key(run, id), requests, refused: 0, failed: 0, usd, input_tokens: input, output_tokens: output, cached_tokens: cached, unpriced: 0, by_model: {}, upstream: null } : null, wall_ms: 1, started_at: '', ended_at: '', paths: {} });
  writeFileSync(join(dir, 'trials.jsonl'), [trial('t1', 0.30, 2, 3000, 300, 1200), trial('t2', 0.30, 1, 3000, 300, 0, !opts.dropUsage)].map((t) => JSON.stringify(t)).join('\n') + '\n');
  if (!opts.dropLedger) {
    const db = new Database(join(dir, 'ledger.sqlite'));
    db.exec(`CREATE TABLE runs (run_id TEXT PRIMARY KEY, runner TEXT NOT NULL, budget_usd REAL NOT NULL, estimate_usd REAL, started_at TEXT NOT NULL, finished_at TEXT, committed_usd REAL NOT NULL DEFAULT 0, overshoot_usd REAL NOT NULL DEFAULT 0);
      CREATE TABLE entries (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL, description TEXT NOT NULL, reserved_usd REAL NOT NULL, actual_usd REAL, status TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, created_at TEXT NOT NULL, settled_at TEXT, participant TEXT, legacy INTEGER NOT NULL DEFAULT 0);`);
    const drift = opts.ledgerDriftUsd ?? 0;
    db.query('INSERT INTO runs (run_id, runner, budget_usd, started_at, committed_usd) VALUES (?, ?, ?, ?, ?)').run(run, 'metering-proxy', 10, '2026-10-22T23:00:00Z', 0.6 + drift);
    const ins = db.query('INSERT INTO entries (id, run_id, description, reserved_usd, actual_usd, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    ins.run('e1', run, 'chat', 1, 0.1, 'reconciled', '2026-10-22T23:50:00Z'); ins.run('e2', run, 'chat', 1, 0.2, 'reconciled', '2026-10-23T00:10:00Z'); ins.run('e3', run, 'chat', 1, 0.3 + drift, 'reconciled', '2026-10-23T01:00:00Z');
    ins.run('e9', 'other-run', 'chat', 1, 9, 'reconciled', '2026-10-23T01:00:00Z');
    db.close();
  }
  return dir;
}

const providerFixture = (scale = 1, fetchedAt = '2026-10-30T00:00:00Z'): ProviderFixture => ({
  source: 'test fixture', fetched_at: fetchedAt,
  usage: [
    { starting_at: '2026-10-22T00:00:00Z', ending_at: '2026-10-23T00:00:00Z', results: [
      { api_key_id: 'apikey_proxy', model: 'claude-haiku-5-5', uncached_input_tokens: 600 * scale, cache_read_input_tokens: 400 * scale, cache_creation: { ephemeral_5m_input_tokens: 0 }, output_tokens: 100 * scale },
      { api_key_id: 'apikey_other', model: 'claude-haiku-5-5', uncached_input_tokens: 50_000, cache_read_input_tokens: 0, output_tokens: 5_000 } ] },
    { starting_at: '2026-10-23T00:00:00Z', ending_at: '2026-10-24T00:00:00Z', results: [
      { api_key_id: 'apikey_proxy', model: 'claude-haiku-5-5', uncached_input_tokens: 4200 * scale, cache_read_input_tokens: 800 * scale, output_tokens: 500 * scale } ] },
  ],
  cost: [
    { starting_at: '2026-10-22T00:00:00Z', ending_at: '2026-10-23T00:00:00Z', results: [ { amount: '10', currency: 'USD', model: 'claude-haiku-5-5', token_type: 'uncached_input_tokens', cost_type: 'tokens', description: 'Claude Haiku 5.5 Usage - Input Tokens' }, { amount: '500', currency: 'USD', model: 'claude-opus-5-5', cost_type: 'tokens', description: 'Claude Opus 5.5 Usage - Input Tokens' } ] },
    { starting_at: '2026-10-23T00:00:00Z', ending_at: '2026-10-24T00:00:00Z', results: [ { amount: '50', currency: 'USD', model: 'claude-haiku-5-5', token_type: 'output_tokens', cost_type: 'tokens', description: 'Claude Haiku 5.5 Usage - Output Tokens' } ] },
  ],
});
const noProvider = { tz: 'UTC', apiKeyId: null, fixture: null, adminKey: null };

describe('reconcile-provider: proxy side', () => {
  test('sums only this run\'s priced 200 lines, per UTC day and per local day; 4xx and refused lines are counted apart', () => {
    const lines = require('node:fs').readFileSync(join(fixtureResults(), 'proxy-usage.ndjson'), 'utf8').split('\n').filter(Boolean).map((l: string) => JSON.parse(l) as UsageLine);
    const p = summarizeProxy(lines, RUN, 'America/Los_Angeles');
    expect(p).toMatchObject({ priced_requests: 3, refused_requests: 1, forwarded_4xx: 1, failed_requests: 0 });
    expect(p.total).toEqual({ requests: 3, usd: 0.6000000000000001, input_tokens: 6000, output_tokens: 600, cached_tokens: 1200 });
    expect(Object.keys(p.by_utc_day)).toEqual(['2026-10-22', '2026-10-23']);
    expect(p.by_utc_day['2026-10-23']!['claude-haiku-5-5']!.input_tokens).toBe(5000);
    expect(Object.keys(p.by_local_day)).toEqual(['2026-10-22']);
    expect(dayIn('2026-10-23T06:59:59Z', 'America/Los_Angeles')).toBe('2026-10-22');
    expect(dayIn('2026-10-23T07:00:00Z', 'America/Los_Angeles')).toBe('2026-10-23');
  });

  test('lines metered under the trial-token: shape and under the pre-2026-10-26 sk-trial- shape both belong to the run', () => {
    const lines = require('node:fs').readFileSync(join(fixtureResults(), 'proxy-usage.ndjson'), 'utf8').split('\n').filter(Boolean).map((l: string) => JSON.parse(l) as UsageLine);
    const renamed = lines.map((l: UsageLine, i: number) => (i % 2 === 0 ? { ...l, key: l.key.replace(/^sk-trial-/, 'trial-token:') } : l));
    expect(summarizeProxy(renamed, RUN, 'UTC').total).toEqual(summarizeProxy(lines, RUN, 'UTC').total);
    expect(summarizeProxy(renamed, 'other-run', 'UTC').priced_requests).toBe(1);
  });

  test('cross-checks usage lines, trials.jsonl and the ledger, and says when they disagree', async () => {
    const [ok] = await reconcileAll([fixtureResults()], noProvider);
    expect(ok!.cross_check).toMatchObject({ usage_lines_usd: 0.6, trials_usd: 0.6, ledger_committed_usd: 0.6, ledger_settled_usd: 0.6, consistent: true });
    expect(ok!.ledger).toMatchObject({ lease_usd: 10, entries: 3, statuses: { reconciled: 3 } });
    expect(ok!.trials).toMatchObject({ trials: 2, harness_trials: 2, with_usage: 2, requests: 3, input_tokens: 6000 });
    const [bad] = await reconcileAll([fixtureResults({ ledgerDriftUsd: 0.05 })], noProvider);
    expect(bad!.cross_check.consistent).toBe(false);
    expect(bad!.cross_check.max_abs_diff_usd).toBeCloseTo(0.05, 6);
  });

  test('missing receipts are HE-RECONCILE-003 refusals that name the file, never zero totals', () => {
    expect(() => readRun(fixtureResults({ dropLedger: true }), 'UTC')).toThrow(/HE-RECONCILE-003 .*ledger\.sqlite has no lease/);
    expect(() => readRun(fixtureResults({ dropUsage: true }), 'UTC')).toThrow(/HE-RECONCILE-003 1 harness trial\(s\) .* no usage block/);
    expect(() => readRun(join(tmpdir(), 'nowhere-at-all'), 'UTC')).toThrow(/HE-RECONCILE-003 .*trials\.jsonl is missing/);
  });

  test('without an Admin key the status is not_performed, the line names the missing access, and the sheet still renders', async () => {
    const [r] = await reconcileAll([fixtureResults()], noProvider);
    expect(r!.provider).toBeNull(); expect(r!.status).toBe('not_performed');
    expect(r!.provider_reconciliation).toMatch(/^not performed: needs an Anthropic Admin API key .*ANTHROPIC_ADMIN_KEY/);
    const md = renderMarkdown(r!);
    expect(md).toContain('| 2026-10-23 | claude-haiku-5-5 | 2 | 5,000 | 800 | 500 | $0.50 |');
    expect(md).toContain('largest difference $0.00 (consistent)');
    expect(md).toContain('1 forwarded 4xx at $0');
  });
});

describe('reconcile-provider: provider side', () => {
  test('compares tokens per UTC day and model for the given key, pooled across runs that share a day, and USD per day against the cost report', async () => {
    const a = fixtureResults({ run: 'run-a' });
    const b = fixtureResults({ run: 'run-b', shift: 1 });
    const fixture = providerFixture();
    fixture.usage[1]!.results[0]!.uncached_input_tokens += 600; fixture.usage[1]!.results[0]!.cache_read_input_tokens += 400; fixture.usage[1]!.results[0]!.output_tokens += 100;
    fixture.usage.push({ starting_at: '2026-10-24T00:00:00Z', ending_at: '2026-10-25T00:00:00Z', results: [{ api_key_id: 'apikey_proxy', model: 'claude-haiku-5-5', uncached_input_tokens: 4200, cache_read_input_tokens: 800, output_tokens: 500 }] });
    const runs = await reconcileAll([a, b], { tz: 'UTC', apiKeyId: 'apikey_proxy', fixture, adminKey: null });
    const p = runs[0]!.provider!;
    expect(p.cells.map((c) => [c.day, c.runs, c.proxy.input_tokens, c.provider!.input_tokens, c.within_bar])).toEqual([
      ['2026-10-22', ['run-a'], 1000, 1000, true], ['2026-10-23', ['run-a', 'run-b'], 6000, 6000, true], ['2026-10-24', ['run-b'], 5000, 5000, true]]);
    expect(p.within_bar).toBe(true); expect(p.max_rel_residual).toBe(0);
    expect(runs[0]!.status).toBe('performed'); expect(runs[1]!.status).toBe('performed');
    expect(runs[0]!.provider_reconciliation).toMatch(/^performed: test fixture: .*2 of 2 day x model cell\(s\) judged, largest relative residual 0\.00% against the 1% bar; 1 cell\(s\) pooled with run-b/);
    expect(p.cost_by_day[0]).toEqual({ day: '2026-10-22', proxy_usd: 0.1, workspace_usd: 5.1, workspace_usd_matching_models: 0.1 });
    expect(p.receipt.usage.flatMap((u) => u.results).every((r) => r.api_key_id === 'apikey_proxy')).toBe(true);
  });

  test('a residual over 1% is a mismatch with a residual field; an unsettled day is left out; no key id means unattributed', async () => {
    const [m] = await reconcileAll([fixtureResults()], { tz: 'UTC', apiKeyId: 'apikey_proxy', fixture: providerFixture(1.02), adminKey: null });
    expect(m!.status).toBe('performed_mismatch');
    expect(m!.provider!.cells[0]!.residual).toEqual({ input_tokens: 20, output_tokens: 2, cached_tokens: 8 });
    expect(m!.provider!.max_rel_residual).toBeCloseTo(0.02, 3);
    const [u] = await reconcileAll([fixtureResults()], { tz: 'UTC', apiKeyId: 'apikey_proxy', fixture: providerFixture(1, '2026-10-24T06:00:00Z'), adminKey: null });
    expect(u!.provider!.cells.map((c) => c.settled)).toEqual([true, false]);
    expect(u!.provider_reconciliation).toContain('1 of 2 day x model cell(s) judged');
    const [n] = await reconcileAll([fixtureResults()], { tz: 'UTC', apiKeyId: null, fixture: providerFixture(), adminKey: null });
    expect(n!.status).toBe('performed_unattributed');
    expect(n!.provider!.api_key_ids_seen).toEqual(['apikey_other', 'apikey_proxy']);
  });

  test('fetchPaged follows cursors, sends only the Admin key, and refuses truncated or failing pages without echoing bodies', async () => {
    const seen: Array<{ url: string; key: string | null }> = [];
    const pages: Record<string, unknown> = { '': { data: [1], has_more: true, next_page: 'p2' }, p2: { data: [2], has_more: false, next_page: null } };
    const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input)); seen.push({ url: u.pathname, key: new Headers(init?.headers).get('x-api-key') });
      return new Response(JSON.stringify(pages[u.searchParams.get('page') ?? '']), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchPaged<number>('https://api.anthropic.com/v1/organizations/usage_report/messages?x=1', fakeAdminKey, stub)).toEqual([1, 2]);
    expect(seen).toEqual([{ url: '/v1/organizations/usage_report/messages', key: fakeAdminKey }, { url: '/v1/organizations/usage_report/messages', key: fakeAdminKey }]);
    const loop = (async () => new Response(JSON.stringify({ data: [], has_more: true, next_page: 'same' }), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchPaged('https://api.anthropic.com/v1/organizations/cost_report', fakeAdminKey, loop)).rejects.toThrow(/HE-RECONCILE-002 .*fresh next_page/);
    const bad = (async () => new Response(JSON.stringify({ nope: true }), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchPaged('https://api.anthropic.com/v1/organizations/cost_report', fakeAdminKey, bad)).rejects.toThrow(/HE-RECONCILE-002 .*envelope/);
    const denied = (async () => new Response(JSON.stringify({ error: { message: `secret ${fakeAdminKey}` } }), { status: 401, headers: { 'request-id': 'req_1' } })) as unknown as typeof fetch;
    const err = await fetchPaged('https://api.anthropic.com/v1/organizations/cost_report', fakeAdminKey, denied).catch((e: Error) => e.message);
    expect(err).toMatch(/^HE-RECONCILE-001 .*answered 401; ANTHROPIC_ADMIN_KEY must be an Admin API key.*request id req_1$/);
    expect(err).not.toContain(fakeAdminKey);
  });

  test('a key value or key-shaped string in the output aborts the write; redaction covers what is printed', () => {
    expect(() => assertNoKeyShapes('fine: sk-trial-run/cell/task/r1 and $1.00', [fakeAdminKey])).not.toThrow();
    expect(() => assertNoKeyShapes(`leak: ${fakeAdminKey}`)).toThrow(/key-shaped/);
    expect(() => assertNoKeyShapes(`value: ${fakeAdminKey.slice(0, 7)}X`, [fakeAdminKey.slice(0, 7) + 'X'])).toThrow(/key value itself/);
    expect(redact(`Admin API said ${fakeAdminKey} and ${fakeBotToken}`)).toBe('Admin API said [redacted] and [redacted]');
  });
});
