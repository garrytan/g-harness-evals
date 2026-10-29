// internal-task panel (Lane B): lease arithmetic against the proxy's own numbers,
// the panel cap (from the ledger, so an undrained request counts), the fixed
// order, termination classification (a charged upstream reservation, a
// concurrent lease refusal), the ledger's lease-id acceptance and
// killed-trial recovery, the merge-base refusal, the max-size admission smoke
// through the real metering proxy against a fake upstream on 127.0.0.1 (ports
// 8820-8839; the only "key" is a placeholder string the proxy needs to forward
// at all, never a real one), the ceilings derivation, the panel dry run, and
// the panel loop itself: keyless with a stubbed docker on PATH (ports
// 8830-8835), and one real one-trial panel against fake-anthropic.ts when the
// openclaw image and the gstack checkout at bd8907d6 exist (skipped otherwise).
import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { BudgetRun, CHAT_PRICE_OVERRIDES, closeLedgers, priceRequest, readLedger, reservationUsd } from '../runner/ledger/budget-ledger.ts';
import { OPUS_CONTEXT_TOKENS, PANEL_MODEL, PLACEHOLDER_CEILINGS, boundRequestBody, capInputsFromLedger, classifyTermination, leaseUsd, ledgerSummary, panelCapAllows, panelOrder, proxyReservation, rMax, readUsage, spendFromUsage, type Spend } from '../scripts/gsta-135/lease.ts';
import { wilson } from '../scripts/gsta-135/report.ts';
import { PROVIDER_ERROR_NOT_BILLED } from '../runner/proxy/metering-proxy.ts';

const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'gsta135-panel-'));
afterAll(() => { closeLedgers(); rmSync(tmp, { recursive: true, force: true }); });
const PIN = 128_000;
const DISCOVERY = join(ROOT, 'results/gsta-135/runs/gsta-135-discovery-2026-10/proxy-usage.ndjson');
const sha256 = (buf: Uint8Array) => new Bun.CryptoHasher('sha256').update(buf).digest('hex');
const rows = (file: string) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const ledgerClose = (ledger: string, leaseId: string) => spawnSync('bun', ['runner/ledger/budget-ledger.ts', 'close', '--budget-ledger', ledger, '--budget-run-id', leaseId], { cwd: ROOT, encoding: 'utf8' });

describe('R_max and the lease', () => {
  test('R_max is the reservation the proxy itself takes for the bound body: bytes/3 + 16 estimated, bounded below by body bytes + 64, cache-write premium, pinned output', () => {
    const body = boundRequestBody({ model: PANEL_MODEL, maxTokens: PIN });
    const price = priceRequest('https://api.anthropic.com/v1/messages', body)!;
    const bytes = Buffer.byteLength(JSON.stringify(body));
    const proxyBounded = { ...price, inputTokens: Math.max(price.inputTokens, bytes + 64) };
    const r = rMax({ model: PANEL_MODEL, maxTokens: PIN });
    expect(r.r_max_usd).toBeCloseTo(reservationUsd(proxyBounded), 6);
    expect(price.inputTokens).toBeGreaterThanOrEqual(OPUS_CONTEXT_TOKENS);
    expect(r.inputs.bounded_input_tokens).toBe(bytes + 64);
    expect(r.inputs.cache_write_premium).toBe(true);
    expect(r.inputs.input_rate_per_mtok).toBe(5);
    expect(r.inputs.output_usd).toBeCloseTo(PIN * 20 / 1e6, 9);
    expect(r.r_max_usd).toBeCloseTo((bytes + 64) * 5 / 1e6 + 2.56, 6);
    expect(leaseUsd(1, r.r_max_usd)).toBeCloseTo(1 + r.r_max_usd, 6);
    const synthetic = { model: PANEL_MODEL, max_tokens: 1000, messages: [{ role: 'user', content: 'hello' }] };
    const p2 = priceRequest('https://api.anthropic.com/v1/messages', synthetic)!;
    expect(p2.inputTokens).toBe(Math.ceil(Buffer.byteLength('user' + 'hello') / 3) + 16);
    expect(proxyReservation(synthetic).bounded_input_tokens).toBe(Buffer.byteLength(JSON.stringify(synthetic)) + 64);
    expect(proxyReservation(synthetic).cache_write_premium).toBe(false);
  });
  test.skipIf(!existsSync(DISCOVERY))('the discovery run\'s largest reservation is below R_max and its bodies stayed under the 3 bytes per token the bound assumes', () => {
    const lines = readFileSync(DISCOVERY, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(l => l.outcome === 'forwarded' && l.input_tokens > 1000);
    const r = rMax({ model: PANEL_MODEL, maxTokens: PIN });
    expect(Math.max(...lines.map(l => l.reserved_usd))).toBeLessThan(r.r_max_usd);
    // reserved = (bytes + 64) x $5 + 128,000 x $20, so the body bytes per billed input token follow from the line.
    const ratio = lines.map(l => ((l.reserved_usd - PIN * 20 / 1e6) / 5e-6 - 64) / l.input_tokens);
    expect(Math.max(...ratio)).toBeLessThanOrEqual(3);
    expect(Math.max(...ratio)).toBeGreaterThan(2);
  });
  test('the panel cap check counts settled, reserved-unknown and the whole next lease', () => {
    expect(panelCapAllows({ settled: 8, unknown: 0.4, lease: 6.56, cap: 15 })).toBe(true);
    expect(panelCapAllows({ settled: 8.44, unknown: 0, lease: 6.56, cap: 15 })).toBe(true);
    expect(panelCapAllows({ settled: 8.45, unknown: 0, lease: 6.56, cap: 15 })).toBe(false);
    expect(panelCapAllows({ settled: 8, unknown: 0.5, lease: 6.56, cap: 15 })).toBe(false);
    expect(() => panelCapAllows({ settled: -1, unknown: 0, lease: 1, cap: 15 })).toThrow(/settled/);
    const cli = (s: string) => spawnSync('bun', ['scripts/gsta-135/lease.ts', 'cap-check', '--settled', s, '--unknown', '0', '--lease', '6.561305', '--cap', '15'], { cwd: ROOT, encoding: 'utf8' }).status;
    expect(cli('8.4')).toBe(0);
    expect(cli('8.5')).toBe(1);
  });
  test('the cap check discovery.sh runs reads the ledger, so an undrained request counts at its reservation', () => {
    const path = join(tmp, 'undrained.sqlite');
    const a = BudgetRun.openLease({ runId: 'panel.trial-1', leaseUsd: 6.56, ledgerPath: path, maxOutputTokens: PIN });
    a.settle(a.reserve(0.5, 'a settled request'), { usd: 0.25 });
    a.reserve(3, 'a request still in flight when the proxy was stopped');
    a.close();
    closeLedgers();
    expect(capInputsFromLedger(path, 'panel')).toEqual({ settled: 0.25, unknown: 3 });
    expect(capInputsFromLedger(join(tmp, 'never-written.sqlite'), 'panel')).toEqual({ settled: 0, unknown: 0 });
    const cli = (cap: string) => spawnSync('bun', ['scripts/gsta-135/lease.ts', 'cap-check', '--budget-ledger', path, '--run-id', 'panel', '--lease', '6.56', '--cap', cap], { cwd: ROOT, encoding: 'utf8' });
    const over = cli('9.8');
    expect(over.status).toBe(1);
    expect(JSON.parse(over.stdout)).toEqual({ fits: false, settled: 0.25, unknown: 3 });
    const fits = cli('9.81');
    expect(fits.status).toBe(0);
    expect(JSON.parse(fits.stdout)).toEqual({ fits: true, settled: 0.25, unknown: 3 });
    // The row sums alone (the old input) would have admitted the lease: the open reservation is in no row.
    expect(spawnSync('bun', ['scripts/gsta-135/lease.ts', 'cap-check', '--settled', '0.25', '--unknown', '0', '--lease', '6.56', '--cap', '9.8'], { cwd: ROOT }).status).toBe(0);
  });
  test('Wilson intervals at n=5 are report.ts\'s', () => {
    const iv = (k: number, n: number) => { const w = wilson(k, n); return [w.lo, w.hi].map(x => Number(x.toFixed(3))); };
    expect(iv(0, 5)).toEqual([0, 0.434]);
    expect(iv(3, 5)).toEqual([0.231, 0.882]);
    expect(iv(5, 5)).toEqual([0.566, 1]);
  });
  test('placeholder ceilings have one source', () => {
    expect(PLACEHOLDER_CEILINGS).toEqual({ task1: 0.4, task2: 0.4, task3: 0.15 });
    const cli = spawnSync('bun', ['scripts/gsta-135/lease.ts', 'placeholder-ceilings'], { cwd: ROOT, encoding: 'utf8' });
    expect(JSON.parse(cli.stdout)).toEqual({ task1: 0.4, task2: 0.4, task3: 0.15, per_harness: null, source: 'placeholder (internal-task; ceilings.ts has not run)', derived_at: null });
  });
});

const spend = (forwarded: number, budget_refusals = 0, refusals: Record<string, number> = {}, extra: Partial<Spend> = {}): Spend =>
  ({ forwarded, spent: 0, unknown: 0, charged_reservations: 0, charged_reservation_usd: 0, provider_errors: 0, refused: Object.values(refusals).reduce((n, v) => n + v, 0), budget_refusals, concurrent_refusals: 0, refusals, ...extra });

describe('order and terminations', () => {
  test('the interleaved order is deterministic: trial_index outer, then task, harness, arm', () => {
    const a = panelOrder(5), b = panelOrder(5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toHaveLength(60);
    expect(a.map(r => r.order)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(new Set(a.map(r => r.trial_id)).size).toBe(60);
    expect(a.slice(0, 4).map(r => r.trial_id)).toEqual(['gsta135-openclaw-t1-baseline-1', 'gsta135-openclaw-t1-candidate-1', 'gsta135-hermes-t1-baseline-1', 'gsta135-hermes-t1-candidate-1']);
    expect(a[4]).toMatchObject({ harness: 'openclaw', task: 2, arm: 'baseline', trial_index: 1, time_budget_s: 600 });
    expect(a[11]).toMatchObject({ harness: 'hermes', task: 3, arm: 'candidate', trial_index: 1, time_budget_s: 120 });
    expect(a[12]).toMatchObject({ harness: 'openclaw', task: 1, arm: 'baseline', trial_index: 2 });
    expect(a[59]).toMatchObject({ trial_id: 'gsta135-hermes-t3-candidate-5', order: 60 });
    expect(JSON.parse(spawnSync('bun', ['scripts/gsta-135/lease.ts', 'order', '--trials', '5'], { cwd: ROOT, encoding: 'utf8' }).stdout)).toEqual(a);
    expect(() => panelOrder(0)).toThrow();
  });
  test('classifyTermination implements the panel vocabulary', () => {
    const lease402 = { '402 run x is over its $6.56 budget': 1 };
    expect(classifyTermination('completed', spend(3), 'runtime: ok (bun 1.4.2)')).toBe('completed');
    expect(classifyTermination('timeout', spend(2, 1, lease402), null)).toBe('ceiling:lease');
    expect(classifyTermination('harness_error', spend(0, 1, lease402), null)).toBe('infra:reservation_refused');
    expect(classifyTermination('completed', spend(0, 0, { "400 requested 128001 output tokens, above this cell's cap of 128000": 1 }), null)).toBe('infra:cap_refused');
    expect(classifyTermination('model_error', spend(0), null)).toBe('infra:no_model_request(model_error)');
    expect(classifyTermination('completed', spend(3), 'x gstack-wrap[t] runtime: degraded (bun not on PATH)')).toBe('infra:runtime');
    expect(classifyTermination('completed', spend(1, 0, { "400 requested 128001 output tokens, above this cell's cap of 128000": 1 }), null)).toBe('completed');
    // A reservation the proxy charged in full for an upstream failure, then a 402: the provider consumed the lease.
    expect(classifyTermination('completed', spend(2, 1, lease402, { charged_reservations: 1, charged_reservation_usd: 5.56 }), null)).toBe('infra:upstream');
    expect(classifyTermination('completed', spend(2, 0, {}, { charged_reservations: 1, charged_reservation_usd: 5.56 }), null)).toBe('completed');
    // A 402 that overlapped an in-flight request: the lease assumes serial requests, so this is not the cost bar.
    expect(classifyTermination('completed', spend(2, 1, lease402, { concurrent_refusals: 1 }), null)).toBe('infra:reservation_refused');
    expect(classifyTermination('completed', spend(2, 1, lease402, { concurrent_refusals: 1, charged_reservations: 1 }), null)).toBe('infra:upstream');
    expect(classifyTermination('completed', spend(2, 1, lease402, { concurrent_refusals: 1 }), 'runtime: degraded (bun not on PATH)')).toBe('infra:runtime');
    // Provider-error 5xx answers the proxy settled at $0 (an Anthropic 529 overloaded_error) in a trial that did not complete: the provider failed it.
    expect(classifyTermination('harness_error', spend(2, 0, {}, { provider_errors: 2 }), null)).toBe('infra:upstream');
    expect(classifyTermination('model_error', spend(3, 0, {}, { provider_errors: 1 }), null)).toBe('infra:upstream');
    expect(classifyTermination('completed', spend(3, 0, {}, { provider_errors: 1 }), null)).toBe('completed');
    expect(classifyTermination('harness_error', spend(2, 0, {}, { provider_errors: 2 }), 'runtime: degraded (bun not on PATH)')).toBe('infra:runtime');
    // A $0 provider error consumed no lease, so a lease refusal after one is still the trial's own cost.
    expect(classifyTermination('timeout', spend(2, 1, lease402, { provider_errors: 1 }), null)).toBe('ceiling:lease');
    const log = join(tmp, 'wrap.log');
    writeFileSync(log, '2026-10-28T00:00:00Z gstack-wrap[t] runtime: degraded (bun 1.0.0 is below the minimum)\n');
    const cli = spawnSync('bun', ['scripts/gsta-135/lease.ts', 'classify', '--termination', 'completed', '--spend', JSON.stringify(spend(2)), '--wrapper-log', log], { cwd: ROOT, encoding: 'utf8' });
    expect(cli.stdout.trim()).toBe('infra:runtime');
  });
  test('spendFromUsage counts [529, 529] provider-error lines settled at $0, and the trial that did not complete is infra:upstream', () => {
    const key = 'trial-token:p';
    const line = (at: string) => ({ at, key, outcome: 'forwarded', status: 529, reason: `HTTP 529 overloaded_error: ${PROVIDER_ERROR_NOT_BILLED}`, reserved_usd: 5.5, actual_usd: 0, charged_reservation: false });
    const s = spendFromUsage([line('2026-10-28T00:00:00.000Z'), line('2026-10-28T00:00:05.000Z')], key, null);
    expect(s).toMatchObject({ forwarded: 2, spent: 0, charged_reservations: 0, provider_errors: 2, budget_refusals: 0 });
    expect(classifyTermination('harness_error', s, null)).toBe('infra:upstream');
    expect(classifyTermination('completed', s, null)).toBe('completed');
    // A $0 5xx without the proxy's provider-error reason, or a 4xx at $0, is not a provider error.
    const other = spendFromUsage([{ ...line('2026-10-28T00:00:00.000Z'), reason: 'something else' }, { ...line('2026-10-28T00:00:01.000Z'), status: 400, reason: undefined }], key, null);
    expect(other.provider_errors).toBe(0);
    expect(classifyTermination('harness_error', other, null)).toBe('harness_error');
  });
  test('spendFromUsage splits charged reservations out of the settled spend and sees a refusal inside another request\'s reservation', () => {
    const key = 'trial-token:t';
    const lines = [
      { at: '2026-10-28T00:00:00.000Z', key, outcome: 'forwarded', status: 200, reserved_usd: 5, actual_usd: 0.3, charged_reservation: false },
      { at: '2026-10-28T00:00:10.000Z', key, outcome: 'forwarded', status: 529, reserved_usd: 5.5, actual_usd: 5.5, charged_reservation: true },
      { at: '2026-10-28T00:00:20.000Z', key, outcome: 'refused', status: 402, reason: 'run x is over its budget' },
      { at: '2026-10-28T00:00:21.000Z', key, outcome: 'refused', status: 402, reason: 'unpriced request' },
      { at: '2026-10-28T00:00:22.000Z', key, outcome: 'failed', reserved_usd: 2, actual_usd: 2, reason: 'upstream timeout' },
      { at: '2026-10-28T00:00:23.000Z', key: 'trial-token:other', outcome: 'forwarded', status: 200, reserved_usd: 1, actual_usd: 1 },
    ];
    const s = spendFromUsage(lines, key, null);
    expect(s).toEqual({ forwarded: 2, spent: 0.3, unknown: 2, charged_reservations: 1, charged_reservation_usd: 5.5, provider_errors: 0, refused: 2, budget_refusals: 1, concurrent_refusals: 0, refusals: { '402 run x is over its budget': 1, '402 unpriced request': 1 } });
    const entry = (created_at: string, settled_at: string | null) => ({ id: 'e', run_id: 'r.t', description: 'd', reserved_usd: 5, actual_usd: null, status: 'reserved' as const, input_tokens: null, output_tokens: null, created_at, settled_at });
    expect(spendFromUsage(lines, key, [entry('2026-10-28T00:00:19.000Z', '2026-10-28T00:00:25.000Z')]).concurrent_refusals).toBe(1);
    expect(spendFromUsage(lines, key, [entry('2026-10-28T00:00:19.000Z', null)]).concurrent_refusals).toBe(1);
    expect(spendFromUsage(lines, key, [entry('2026-10-28T00:00:19.000Z', '2026-10-28T00:00:19.500Z')]).concurrent_refusals).toBe(0);
    expect(spendFromUsage(lines, key, [entry('2026-10-28T00:00:20.500Z', null)]).concurrent_refusals).toBe(0);
    const usage = join(tmp, 'spend.ndjson');
    writeFileSync(usage, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    const cli = spawnSync('bun', ['scripts/gsta-135/lease.ts', 'spend', '--usage', usage, '--key', key], { cwd: ROOT, encoding: 'utf8' });
    expect(JSON.parse(cli.stdout)).toEqual(s);
    expect(JSON.parse(spawnSync('bun', ['scripts/gsta-135/lease.ts', 'spend', '--usage', join(tmp, 'absent.ndjson'), '--key', key], { cwd: ROOT, encoding: 'utf8' }).stdout)).toEqual(spend(0));
    writeFileSync(usage, '{"at":"x","key":"' + key + '","outcome":"forwarded"\n');
    expect(spawnSync('bun', ['scripts/gsta-135/lease.ts', 'spend', '--usage', usage, '--key', key], { cwd: ROOT }).status).toBe(64);
  });
});

describe('ledger contracts', () => {
  test('the lease id <run>.<trial> is accepted and a slash is refused', () => {
    const path = join(tmp, 'ids.sqlite');
    const run = BudgetRun.openLease({ runId: 'gsta-135-panel-2026-10.gsta135-openclaw-t1-baseline-1', leaseUsd: 1, ledgerPath: path, maxOutputTokens: PIN });
    expect(run.runId).toBe('gsta-135-panel-2026-10.gsta135-openclaw-t1-baseline-1');
    expect(() => BudgetRun.openLease({ runId: 'gsta-135-panel-2026-10/gsta135-openclaw-t1-baseline-1', leaseUsd: 1, ledgerPath: join(tmp, 'ids2.sqlite') })).toThrow(/must be 1-128 characters/);
    run.close();
  });
  test('a lease left open by a killed trial is closed by the next --new-run and reported by the ledger summary', () => {
    const path = join(tmp, 'killed.sqlite');
    const a = BudgetRun.openLease({ runId: 'panel.trial-1', leaseUsd: 6.56, ledgerPath: path, maxOutputTokens: PIN });
    a.settle(a.reserve(0.5, 'a request'), { usd: 0.25 });
    expect(() => BudgetRun.openLease({ runId: 'panel.trial-2', leaseUsd: 6.56, ledgerPath: path, maxOutputTokens: PIN })).toThrow();
    const b = BudgetRun.openLease({ runId: 'panel.trial-2', leaseUsd: 6.56, ledgerPath: path, maxOutputTokens: PIN, newRun: true });
    const runs = readLedger(path).runs;
    expect(runs.find(r => r.run_id === 'panel.trial-1')!.finished_at).not.toBeNull();
    expect(runs.find(r => r.run_id === 'panel.trial-2')!.finished_at).toBeNull();
    const s = ledgerSummary(path, 'panel');
    expect(s).toMatchObject({ leases: 2, open_leases: 1, committed_usd: 0.25, requests: 1 });
    expect(s.runs.map(r => r.trial_id)).toEqual(['trial-1', 'trial-2']);
    b.close();
    const cli = spawnSync('bun', ['scripts/gsta-135/lease.ts', 'ledger-summary', '--budget-ledger', path, '--run-id', 'panel'], { cwd: ROOT, encoding: 'utf8' });
    expect(JSON.parse(cli.stdout)).toMatchObject({ leases: 2, open_leases: 0, committed_usd: 0.25 });
  });
});

/** Start the real proxy CLI on 127.0.0.1 in Lane B's port range against a fake Anthropic upstream. */
async function startProxy(o: { ledger: string; leaseUsd: number; runId: string; upstream: number; usageLog: string; control: string }) {
  let stderr = '';
  for (let port = 8820; port <= 8829; port++) {
    const proc = Bun.spawn([process.execPath, 'runner/proxy/metering-proxy.ts', '--listen', '127.0.0.1:' + port, '--budget-ledger', o.ledger, '--lease-usd', String(o.leaseUsd), '--run-id', o.runId, '--new-run',
      '--max-output-tokens', String(PIN), '--allow-models', 'anthropic:' + PANEL_MODEL, '--upstream', 'anthropic=http://127.0.0.1:' + o.upstream, '--usage-log', o.usageLog, '--control-token', o.control],
      { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY: 'placeholder-anthropic' }, stdout: 'pipe', stderr: 'pipe' });
    for (let i = 0; i < 100; i++) {
      if (proc.exitCode !== null) break;
      try { await fetch('http://127.0.0.1:' + port + '/__proxy/status'); return { proc, port }; } catch { await Bun.sleep(50); }
    }
    proc.kill('SIGKILL'); await proc.exited;
    stderr = await new Response(proc.stderr).text();
    if (!/EADDRINUSE|address already in use|in use/i.test(stderr)) throw new Error('proxy did not start on ' + port + ': ' + stderr);
  }
  throw new Error('no free port in 8820-8829: ' + stderr);
}
/** The spend discovery.sh derives from the usage lines of one trial key (lease.ts spend). */
const spendOf = (usageLog: string, key: string, ledger?: string, leaseId?: string): Spend => spendFromUsage(readUsage(usageLog), key, ledger ? readLedger(ledger).entries.filter(e => e.run_id === leaseId) : null);
const control = 'control-' + process.pid;
const bind = (port: number, slot: string, token: string) => fetch('http://127.0.0.1:' + port + '/__proxy/bind', { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': control }, body: JSON.stringify({ slot, key: 'trial-token:' + slot, token }) });
const call = (port: number, slot: string, token: string, body: unknown) => fetch('http://127.0.0.1:' + port + '/' + slot + '/anthropic/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': token }, body: JSON.stringify(body) });

describe('max-size admission through the real proxy', () => {
  test('a request at the input bound is admitted under 1.00 + R_max; the next one after $1.00 settled is ceiling:lease; above the pin is infra:cap_refused; a lease below R_max is infra:reservation_refused', async () => {
    const seen: number[] = [];
    const upstream = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async req => { seen.push((await req.text()).length); return Response.json({ id: 'msg', usage: { input_tokens: 300_000, output_tokens: 10 } }); } });
    const ledger = join(tmp, 'smoke.sqlite'), usageLog = join(tmp, 'smoke-usage.ndjson');
    const r = rMax({ model: PANEL_MODEL, maxTokens: PIN });
    const lease = leaseUsd(1, r.r_max_usd);
    const bound = { ...boundRequestBody({ model: PANEL_MODEL, maxTokens: PIN }), stream: false };
    const token = 'trial-token:t1.abc';
    try {
      let p = await startProxy({ ledger, leaseUsd: lease, runId: 'panel.t1', upstream: upstream.port!, usageLog, control });
      expect((await bind(p.port, 't1', token)).status).toBe(200);
      expect((await call(p.port, 't1', token, bound)).status).toBe(200);
      let spend = spendOf(usageLog, 'trial-token:t1');
      expect(spend).toMatchObject({ forwarded: 1, refused: 0, budget_refusals: 0, charged_reservations: 0 });
      const line = readUsage(usageLog).find(l => l.outcome === 'forwarded')!;
      expect(line.reserved_usd).toBeCloseTo(r.r_max_usd + 5e-6, 5);
      expect(line.actual_usd).toBeCloseTo((300_000 * 4 + 10 * 20) / 1e6, 6);
      expect(spend.spent).toBeCloseTo(line.actual_usd!, 6);
      expect(classifyTermination('completed', spend, null)).toBe('completed');
      // Settled is now $1.2002, above the $1.00 bar: the same request no longer fits and the trial ends as ceiling:lease.
      expect((await call(p.port, 't1', token, bound)).status).toBe(402);
      spend = spendOf(usageLog, 'trial-token:t1', ledger, 'panel.t1');
      expect(spend).toMatchObject({ forwarded: 1, budget_refusals: 1, concurrent_refusals: 0 });
      expect(classifyTermination('completed', spend, null)).toBe('ceiling:lease');
      // A stated max_tokens above the pin is a 400 before any reservation.
      const over = await call(p.port, 't1', token, { ...bound, max_tokens: PIN + 1 });
      expect(over.status).toBe(400);
      const capOnly = spendOf(usageLog, 'trial-token:t1');
      expect(Object.keys(capOnly.refusals).some(k => k.startsWith('400 requested 128001 output tokens, above this cell'))).toBe(true);
      expect(classifyTermination('completed', { ...capOnly, forwarded: 0, budget_refusals: 0, refusals: Object.fromEntries(Object.entries(capOnly.refusals).filter(([k]) => k.startsWith('400'))) }, null)).toBe('infra:cap_refused');
      p.proc.kill('SIGTERM'); await p.proc.exited;
      // SIGTERM leaves the lease open; discovery.sh closes it with the ledger's own CLI after each row is written.
      const closed = ledgerClose(ledger, 'panel.t1');
      expect(closed.status).toBe(0);
      expect(JSON.parse(closed.stdout)).toMatchObject({ run_id: 'panel.t1', requests: 1 });
      expect(ledgerClose(ledger, 'panel.nope').status).toBe(1);
      // A lease smaller than R_max refuses the first request: infra:reservation_refused, never a verdict.
      p = await startProxy({ ledger, leaseUsd: Number((r.r_max_usd / 2).toFixed(6)), runId: 'panel.t2', upstream: upstream.port!, usageLog, control });
      const token2 = 'trial-token:t2.def';
      await bind(p.port, 't2', token2);
      expect((await call(p.port, 't2', token2, bound)).status).toBe(402);
      const spend2 = spendOf(usageLog, 'trial-token:t2');
      expect(spend2).toMatchObject({ forwarded: 0, budget_refusals: 1 });
      expect(classifyTermination('harness_error', spend2, null)).toBe('infra:reservation_refused');
      p.proc.kill('SIGTERM'); await p.proc.exited;
      ledgerClose(ledger, 'panel.t2');
      expect(seen).toEqual([JSON.stringify(bound).length]);
      closeLedgers();
      expect(ledgerSummary(ledger, 'panel')).toMatchObject({ leases: 2, open_leases: 0, requests: 1 });
    } finally { upstream.stop(true); }
  }, 60_000);
  test('Anthropic\'s own 529 overloaded_error settles at $0, and a trial that did not complete after two of them is infra:upstream', async () => {
    const upstream = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async req => {
      await req.text();
      return new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), { status: 529, headers: { 'content-type': 'application/json' } });
    } });
    const ledger = join(tmp, 'overloaded.sqlite'), usageLog = join(tmp, 'overloaded-usage.ndjson');
    const lease = leaseUsd(1, rMax({ model: PANEL_MODEL, maxTokens: PIN }).r_max_usd);
    const bound = { ...boundRequestBody({ model: PANEL_MODEL, maxTokens: PIN }), stream: false };
    try {
      const p = await startProxy({ ledger, leaseUsd: lease, runId: 'ov.t1', upstream: upstream.port!, usageLog, control });
      await bind(p.port, 'o1', 'trial-token:o1.z');
      expect((await call(p.port, 'o1', 'trial-token:o1.z', bound)).status).toBe(529);
      expect((await call(p.port, 'o1', 'trial-token:o1.z', bound)).status).toBe(529);
      p.proc.kill('SIGTERM'); await p.proc.exited;
      ledgerClose(ledger, 'ov.t1');
      const s = spendOf(usageLog, 'trial-token:o1', ledger, 'ov.t1');
      expect(s).toMatchObject({ forwarded: 2, spent: 0, charged_reservations: 0, charged_reservation_usd: 0, provider_errors: 2, budget_refusals: 0 });
      expect(classifyTermination('harness_error', s, null)).toBe('infra:upstream');
      expect(classifyTermination('completed', s, null)).toBe('completed');
      closeLedgers();
      expect(capInputsFromLedger(ledger, 'ov').settled).toBe(0);
    } finally { upstream.stop(true); }
  }, 60_000);
  test('a gateway\'s 529 page (not Anthropic\'s error envelope) keeps the full reservation and the 402 after it is infra:upstream; a 402 inside another request\'s reservation is infra:reservation_refused', async () => {
    let mode: 'fail' | 'slow' = 'fail';
    const upstream = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async req => {
      await req.text();
      // Anthropic's own 529 envelope settles at $0 (the test above); a gateway's 529 page keeps the reservation and drains the lease.
      if (mode === 'fail') return new Response('<html><body>529 Site is overloaded</body></html>', { status: 529, headers: { 'content-type': 'text/html' } });
      await Bun.sleep(1500);
      return Response.json({ id: 'msg', usage: { input_tokens: 1000, output_tokens: 10 } });
    } });
    const ledger = join(tmp, 'upstream.sqlite'), usageLog = join(tmp, 'upstream-usage.ndjson');
    const r = rMax({ model: PANEL_MODEL, maxTokens: PIN });
    const lease = leaseUsd(1, r.r_max_usd);
    const bound = { ...boundRequestBody({ model: PANEL_MODEL, maxTokens: PIN }), stream: false };
    try {
      let p = await startProxy({ ledger, leaseUsd: lease, runId: 'up.t1', upstream: upstream.port!, usageLog, control });
      await bind(p.port, 'u1', 'trial-token:u1.x');
      expect((await call(p.port, 'u1', 'trial-token:u1.x', bound)).status).toBe(529);
      expect((await call(p.port, 'u1', 'trial-token:u1.x', bound)).status).toBe(402);
      p.proc.kill('SIGTERM'); await p.proc.exited;
      ledgerClose(ledger, 'up.t1');
      const s1 = spendOf(usageLog, 'trial-token:u1', ledger, 'up.t1');
      expect(s1).toMatchObject({ forwarded: 1, spent: 0, charged_reservations: 1, provider_errors: 0, budget_refusals: 1, concurrent_refusals: 0 });
      expect(s1.charged_reservation_usd).toBeCloseTo(r.r_max_usd + 5e-6, 5);
      expect(classifyTermination('completed', s1, null)).toBe('infra:upstream');
      // The ledger committed the charged reservation, so the cap check sees it even though usd_spent is 0.
      closeLedgers();
      expect(capInputsFromLedger(ledger, 'up').settled).toBeCloseTo(s1.charged_reservation_usd, 6);
      // Two requests near R_max at once: the second is refused while the first is in flight, with settled at zero.
      mode = 'slow';
      p = await startProxy({ ledger, leaseUsd: lease, runId: 'up.t2', upstream: upstream.port!, usageLog, control });
      await bind(p.port, 'u2', 'trial-token:u2.y');
      const first = call(p.port, 'u2', 'trial-token:u2.y', bound);
      await Bun.sleep(300);
      const second = await call(p.port, 'u2', 'trial-token:u2.y', bound);
      expect(second.status).toBe(402);
      expect((await first).status).toBe(200);
      p.proc.kill('SIGTERM'); await p.proc.exited;
      ledgerClose(ledger, 'up.t2');
      closeLedgers();
      const s2 = spendOf(usageLog, 'trial-token:u2', ledger, 'up.t2');
      expect(s2).toMatchObject({ forwarded: 1, budget_refusals: 1, concurrent_refusals: 1, charged_reservations: 0 });
      expect(s2.spent).toBeCloseTo((1000 * 4 + 10 * 20) / 1e6, 6);
      expect(classifyTermination('completed', s2, null)).toBe('infra:reservation_refused');
      expect(classifyTermination('completed', spendOf(usageLog, 'trial-token:u2'), null)).toBe('ceiling:lease');
    } finally { upstream.stop(true); }
  }, 60_000);
});

describe('ceilings.ts', () => {
  const sh = join(ROOT, 'scripts/gsta-135/ceilings.ts');
  const empty = join(tmp, 'empty'); mkdirSync(empty, { recursive: true });
  const ceil = (runDir: string, outDir: string) => spawnSync('bun', [sh, '--run-dir', runDir, '--gstack-dir', join(empty, 'gstack'), '--preflight-dir', join(empty, 'preflight'), '--out', join(outDir, 'ceilings.md'), '--json', join(outDir, 'ceilings.json')], { cwd: ROOT, encoding: 'utf8' });
  test('without a discovery run it writes the placeholders, names the limits, and the JSON carries the keys discovery.sh copies', () => {
    const out = join(tmp, 'ceil-empty'); mkdirSync(out);
    const r = ceil(join(empty, 'run'), out);
    expect({ status: r.status, stderr: r.stderr.slice(-500) }).toMatchObject({ status: 0 });
    const json = JSON.parse(readFileSync(join(out, 'ceilings.json'), 'utf8'));
    expect(json).toMatchObject({ task1: PLACEHOLDER_CEILINGS.task1, task2: PLACEHOLDER_CEILINGS.task2, task3: PLACEHOLDER_CEILINGS.task3, source: 'placeholder (internal-task)' });
    for (const k of ['task1', 'task2', 'task3', 'per_harness', 'source', 'derived_at', 'lease_usd', 'r_max_usd', 'panel_cap_usd', 'problems']) expect(json).toHaveProperty(k);
    expect(typeof json.derived_at).toBe('string');
    for (const t of [1, 2, 3]) for (const h of ['openclaw', 'hermes']) expect(json.per_harness['task' + t][h]).toMatchObject({ base_usd: PLACEHOLDER_CEILINGS['task' + t as 'task1'], none_usd: null, skill_read_usd: 0, helper_run_usd: 0, ceiling_usd: PLACEHOLDER_CEILINGS['task' + t as 'task1'], source: 'placeholder (internal-task)' });
    expect(json.problems.some((p: string) => p.startsWith('discovery run not found at'))).toBe(true);
    expect(json.problems.some((p: string) => p.startsWith('gstack checkout not found at'))).toBe(true);
    expect(json.wilson_n5.k3).toEqual(wilson(3, 5));
    expect(json.lease_usd).toBe(leaseUsd(1, rMax({ model: PANEL_MODEL, maxTokens: PIN }).r_max_usd));
    const md = readFileSync(join(out, 'ceilings.md'), 'utf8');
    expect(md).toContain('Manifest ceilings: task1 $0.4000, task2 $0.4000, task3 $0.1500 (internal-task\'s placeholders were $0.4000, $0.4000, $0.1500).');
    expect(md).toContain('serial requests only (k = 1)');
    expect(md).toContain('No preflight receipt with requests.ndjson under');
  }, 60_000);
  test('a two-trial synthetic run pins the extraTurn arithmetic', () => {
    const run = join(tmp, 'ceil-run'), out = join(tmp, 'ceil-out'); mkdirSync(run); mkdirSync(out);
    const t1 = 'gsta135-openclaw-t1-gstack', t3 = 'gsta135-openclaw-t3-gstack';
    writeFileSync(join(run, 'cells.jsonl'), [
      { trial_id: t1, harness: 'openclaw', task: 1, arm: 'gstack', termination: 'completed', usd_spent: 0.11, requests_forwarded: 2 },
      { trial_id: t3, harness: 'openclaw', task: 3, arm: 'gstack', termination: 'completed', usd_spent: 0.02, requests_forwarded: 1 },
    ].map(r => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(join(run, 'proxy-usage.ndjson'), [
      { at: '2026-10-28T00:00:01Z', key: 'trial-token:' + t1, outcome: 'forwarded', input_tokens: 10_000, output_tokens: 100, cached_tokens: 0, actual_usd: 0.05, reserved_usd: 3 },
      { at: '2026-10-28T00:00:02Z', key: 'trial-token:' + t1, outcome: 'forwarded', input_tokens: 12_000, output_tokens: 200, cached_tokens: 0, actual_usd: 0.06, reserved_usd: 3.1 },
      { at: '2026-10-28T00:00:03Z', key: 'trial-token:' + t3, outcome: 'forwarded', input_tokens: 5_000, output_tokens: 50, cached_tokens: 0, actual_usd: 0.02, reserved_usd: 2 },
    ].map(r => JSON.stringify(r)).join('\n') + '\n');
    const r = ceil(run, out);
    expect({ status: r.status, stderr: r.stderr.slice(-500) }).toMatchObject({ status: 0 });
    const json = JSON.parse(readFileSync(join(out, 'ceilings.json'), 'utf8'));
    const rates = CHAT_PRICE_OVERRIDES['anthropic:' + PANEL_MODEL];
    const cw = rates.cache_write ?? rates.input, cr = rates.cache_read ?? rates.input;
    const deltaSkill = 2000, deltaHelper = json.delta_helper_tokens, outMed = 100, lastInput = 12_000;
    const extraTurn = (grown: number, context: number) => (grown * cw + context * cr + outMed * rates.output) / 1e6;
    const skill = extraTurn(deltaSkill, lastInput), helper = extraTurn(deltaHelper, lastInput + deltaSkill);
    expect(json).toMatchObject({ delta_skill_tokens: deltaSkill, median_output_tokens: outMed, source: run.startsWith(ROOT) ? run.slice(ROOT.length + 1) : run });
    expect(deltaHelper).toBe(Math.ceil(json.helper_output_bytes / 3));
    expect(json.per_harness.task1.openclaw.source).toBe('discovery ' + t1);
    expect(json.per_harness.task1.openclaw.base_usd).toBeCloseTo(0.11, 9);
    expect(json.per_harness.task1.openclaw.skill_read_usd).toBeCloseTo(skill, 9);
    expect(json.per_harness.task1.openclaw.helper_run_usd).toBeCloseTo(helper, 9);
    expect(json.per_harness.task1.openclaw.ceiling_usd).toBeCloseTo(0.11 + skill + helper, 9);
    expect(json.per_harness.task1.hermes).toMatchObject({ ceiling_usd: PLACEHOLDER_CEILINGS.task1, source: 'placeholder (internal-task)' });
    expect(json.task1).toBeCloseTo(Math.max(0.11 + skill + helper, PLACEHOLDER_CEILINGS.task1), 9);
    expect(json.per_harness.task3.openclaw).toMatchObject({ skill_read_usd: 0, helper_run_usd: 0, source: 'discovery ' + t3 });
    expect(json.per_harness.task3.openclaw.ceiling_usd).toBeCloseTo(0.02, 9);
    expect(json.task3).toBeCloseTo(Math.max(0.02, PLACEHOLDER_CEILINGS.task3), 9);
    expect(json.task2).toBe(PLACEHOLDER_CEILINGS.task2);
    expect(json.problems.some((p: string) => p.startsWith('discovery run not found'))).toBe(false);
  }, 60_000);
});

describe('panel driver', () => {
  const sh = join(ROOT, 'scripts/gsta-135/discovery.sh');
  const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC|OPENAI)_API_KEY$|^HE_PROXY_/.test(k))) as Record<string, string>;
  const repo = join(tmp, 'gstack');
  mkdirSync(repo);
  const g = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't');
  writeFileSync(join(repo, 'VERSION'), '1\n'); g('add', '.'); g('commit', '-qm', 'one');
  const c1 = g('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'VERSION'), '2\n'); g('add', '.'); g('commit', '-qm', 'two');
  const c2 = g('rev-parse', 'HEAD');
  const ceilings = join(tmp, 'ceilings.json');
  writeFileSync(ceilings, JSON.stringify({ task1: 0.41, task2: 0.21, task3: 0.11, per_harness: {}, source: 'test', derived_at: '2026-10-28T00:00:00Z' }));
  const noRuntime = join(tmp, 'runtime-none.json');
  writeFileSync(noRuntime, '{}');
  const tag = (h: 'openclaw' | 'hermes', sha: string, mode = 'chat') => 'harness-eval/' + h + ':gstack-' + sha.slice(0, 8) + (h === 'hermes' && mode === 'chat' ? '-chat' : '');
  // A docker stub for keyless driver runs: image inspect answers from the environment (STUB_MAP/<sha8> holds the full SHA the
  // label reports, STUB_COMMIT overrides it, STUB_HERMES_MODE the mode, STUB_RETAG_AFTER n makes the .Id move after n reads
  // counted in STUB_COUNTER); run exits 0 without a container.
  const stubBin = join(tmp, 'bin'); mkdirSync(stubBin);
  writeFileSync(join(stubBin, 'docker'), [
    '#!/usr/bin/env bash',
    'if [ "$1" = image ] && [ "$2" = inspect ]; then',
    '  tag=$3 fmt=$5',
    '  case "$fmt" in',
    '    *.Id*) n=0; [ ! -e "$STUB_COUNTER" ] || n=$(cat "$STUB_COUNTER"); n=$((n + 1)); echo "$n" > "$STUB_COUNTER"',
    '      if [ -n "${STUB_RETAG_AFTER:-}" ] && [ "$n" -gt "$STUB_RETAG_AFTER" ]; then echo "sha256:retagged"; else echo "sha256:stub-${tag##*:}"; fi ;;',
    '    *gstack.commit*) if [ -n "${STUB_COMMIT:-}" ]; then echo "$STUB_COMMIT"; else cat "$STUB_MAP/$(sed -E \'s/.*gstack-([0-9a-f]{8}).*/\\1/\' <<< "$tag")"; fi ;;',
    '    *hermes_mode*) echo "${STUB_HERMES_MODE:-chat}" ;;',
    '  esac',
    '  exit 0',
    'fi',
    '[ "$1" != run ] || exit 0',
    'echo "stub docker: unexpected $*" >&2; exit 1',
  ].join('\n') + '\n');
  chmodSync(join(stubBin, 'docker'), 0o755);
  const stubMap = join(tmp, 'stub-map'); mkdirSync(stubMap);
  for (const c of [c1, c2]) writeFileSync(join(stubMap, c.slice(0, 8)), c);
  let counters = 0;
  const stubEnv = (extra: Record<string, string> = {}) => ({ ...baseEnv, PATH: stubBin + ':' + baseEnv.PATH, STUB_MAP: stubMap, STUB_COUNTER: join(tmp, 'stub-counter-' + ++counters), ...extra });
  const run = (id: string, arms: string, extra: string[] = [], env: Record<string, string> = baseEnv, dry = true) =>
    spawnSync('bash', [sh, '--arms', arms, '--gstack-dir', repo, '--run-id', id, '--ceilings', ceilings, ...(extra.includes('--runtime-preflight') ? [] : ['--runtime-preflight', noRuntime]), ...(dry ? ['--dry-run'] : []), ...extra], { cwd: ROOT, env, encoding: 'utf8' });
  const outDir = (id: string, dry = true) => join(ROOT, 'results/gsta-135/runs', id + (dry ? '-dry-run' : ''));
  test('refuses a candidate that does not contain the baseline, before the key', () => {
    const id = 'test-panel-mb-' + process.pid;
    try {
      const r = run(id, 'baseline:' + c2 + ',candidate:' + c1);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('does not contain baseline');
      expect(r.stderr).not.toContain('ANTHROPIC_API_KEY');
      expect(existsSync(outDir(id))).toBe(false);
      const bad = run(id, 'baseline:abcdef0,candidate:1234567');
      expect(bad.status).toBe(2);
      expect(bad.stderr).toContain('does not resolve');
    } finally { rmSync(outDir(id), { recursive: true, force: true }); }
  });
  test('refuses the discovery-only options and a runtime preflight value outside pass|fail|not_run with exit 64', () => {
    const id = 'test-panel-opt-' + process.pid;
    try {
      for (const flag of [['--lease-usd', '20'], ['--pin', 'bd8907d6'], ['--qm']]) {
        const r = run(id, 'baseline:' + c1 + ',candidate:' + c2, flag);
        expect({ flag, status: r.status }).toEqual({ flag, status: 64 });
        expect(r.stderr).toContain('discovery-only');
      }
      const bad = join(tmp, 'runtime-bad.json');
      writeFileSync(bad, JSON.stringify({ [tag('openclaw', c1)]: 'FAIL' }));
      const r = run(id, 'baseline:' + c1 + ',candidate:' + c2, ['--runtime-preflight', bad]);
      expect(r.status).toBe(64);
      expect(r.stderr).toContain('must map each image tag to pass, fail or not_run');
      expect(r.stderr).toContain('"FAIL"');
      expect(existsSync(outDir(id))).toBe(false);
    } finally { rmSync(outDir(id), { recursive: true, force: true }); }
  });
  test('the dry run writes manifest.json and manifest.sha256 before any row, then 60 not_run:dry_run rows in the fixed order', () => {
    const id = 'test-panel-dry-' + process.pid;
    try {
      const r = run(id, 'baseline:' + c1 + ',candidate:' + c2, ['--hermes-mode', 'chat', '--trials', '5', '--max-tokens', '128000', '--per-trial-usd', '1.00', '--panel-cap-usd', '15']);
      expect({ status: r.status, stderr: r.stderr.slice(-800) }).toMatchObject({ status: 0 });
      expect(r.stderr.match(/is not built; a paid run refuses here/g)).toHaveLength(4);
      const dir = outDir(id);
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      expect(manifest.arms.baseline.images.openclaw.digest).toBe('missing');
      expect(readFileSync(join(dir, 'manifest.sha256'), 'utf8').trim()).toBe(sha256(readFileSync(join(dir, 'manifest.json'))));
      const r2 = rMax({ model: PANEL_MODEL, maxTokens: PIN });
      expect(manifest).toMatchObject({ run_id: id, dry_run: true, hermes_mode: 'chat', max_tokens: PIN, per_trial_usd: 1, r_max_usd: r2.r_max_usd, lease_usd: leaseUsd(1, r2.r_max_usd), panel_cap_usd: 15, trials_per_cell: 5,
        arms: { baseline: { gstack_sha: c1 }, candidate: { gstack_sha: c2 } }, ceilings: { task1: 0.41, task2: 0.21, task3: 0.11 } });
      expect(manifest.arms.baseline.images.hermes.tag).toBe(tag('hermes', c1));
      expect(manifest.arms.candidate.images.openclaw.tag).toBe(tag('openclaw', c2));
      expect(manifest.order).toEqual(panelOrder(5));
      expect(typeof manifest.stop_rule).toBe('string');
      expect(manifest.lease_assumption).toContain('serial requests (k = 1)');
      expect(manifest.dispatch).toContain('by image id');
      expect(manifest.terminations.evaluator_infrastructure['infra:reservation_refused']).toBeString();
      expect(manifest.terminations.evaluator_infrastructure['infra:upstream']).toBeString();
      expect(manifest.terminations.evaluator_infrastructure['not_run:infra_stop']).toBeString();
      expect(manifest.terminations.harness_or_gstack_runtime['infra:runtime']).toBeString();
      const cells = rows(join(dir, 'cells.jsonl'));
      expect(cells).toHaveLength(60);
      expect(cells.map(x => x.trial_id)).toEqual(panelOrder(5).map(o => o.trial_id));
      expect(new Set(cells.map(x => x.termination))).toEqual(new Set(['not_run:dry_run']));
      expect(cells[0]).toMatchObject({ trial_index: 1, order: 1, lease_usd: manifest.lease_usd, max_tokens: PIN, grade: null, usd_spent: 0, usd_reserved_unknown: 0, usd_charged_reservation: 0, image_id: null, evidence: null, arm: 'baseline', image: manifest.arms.baseline.images.openclaw.tag });
      expect(cells[59]).toMatchObject({ trial_index: 5, order: 60, harness: 'hermes', arm: 'candidate', image: manifest.arms.candidate.images.hermes.tag });
      for (const row of cells) for (const k of ['trial_id', 'harness', 'task', 'arm', 'image', 'image_digest', 'image_id', 'tree', 'tree_dirty', 'model', 'time_budget_s', 'workspace_seen', 'started_at', 'termination', 'exit_code', 'wall_ms', 'requests_forwarded', 'requests_refused', 'budget_refusals', 'refusals', 'requests_undrained', 'usd_spent', 'usd_reserved_unknown', 'usd_charged_reservation', 'evidence', 'note', 'trial_index', 'order', 'lease_usd', 'grade', 'max_tokens']) expect(row).toHaveProperty(k);
      expect(r.stdout).toContain('manifest ' + join('results/gsta-135/runs', id + '-dry-run', 'manifest.json'));
      expect(r.stdout.indexOf('manifest ')).toBeLessThan(r.stdout.indexOf('not_run:dry_run'));
      expect(existsSync(join(dir, 'report.md'))).toBe(true);
      const again = run(id, 'baseline:' + c1 + ',candidate:' + c1);
      expect(again.status).toBe(0);
      expect(again.stderr).toContain('same commit');
    } finally { rmSync(outDir(id), { recursive: true, force: true }); }
  }, 120_000);
  test('a failed runtime preflight writes infra:runtime rows for that image only, and --approval lands in the manifest', () => {
    const id = 'test-panel-rt-' + process.pid;
    const rt = join(tmp, 'runtime-fail.json');
    const failing = tag('hermes', c1);
    writeFileSync(rt, JSON.stringify({ [failing]: 'fail', [tag('openclaw', c1)]: 'pass' }));
    try {
      const r = run(id, 'baseline:' + c1 + ',candidate:' + c2, ['--runtime-preflight', rt, '--approval', 'approvals.mode=manual', '--trials', '2']);
      expect({ status: r.status, stderr: r.stderr.slice(-800) }).toMatchObject({ status: 0 });
      const manifest = JSON.parse(readFileSync(join(outDir(id), 'manifest.json'), 'utf8'));
      expect(manifest.runtime_preflight).toEqual({ [failing]: 'fail', [tag('openclaw', c1)]: 'pass', [tag('hermes', c2)]: 'not_run', [tag('openclaw', c2)]: 'not_run' });
      expect(manifest.approval).toMatchObject({ setting: 'approvals.mode', value: 'manual', settings: { 'approvals.mode': 'manual' } });
      expect(manifest.approval.source).toContain('--approval');
      const cells = rows(join(outDir(id), 'cells.jsonl'));
      expect(cells).toHaveLength(24);
      const onFailing = cells.filter(c => c.image === failing);
      expect(onFailing).toHaveLength(6);
      for (const c of onFailing) { expect(c.termination).toBe('infra:runtime'); expect(c.note).toContain('runtime preflight failed for ' + failing); expect(c.note).toContain('not dispatched, not replaced'); }
      expect(new Set(cells.filter(c => c.image !== failing).map(c => c.termination))).toEqual(new Set(['not_run:dry_run']));
      expect(readFileSync(join(outDir(id), 'report.md'), 'utf8')).toContain('infra:runtime');
    } finally { rmSync(outDir(id), { recursive: true, force: true }); }
  }, 120_000);
  test('an image whose labels disagree with the arm is refused with exit 2; matching labels pass and the manifest records the image id', () => {
    const id = 'test-panel-lbl-' + process.pid;
    try {
      const wrongCommit = run(id, 'baseline:' + c1 + ',candidate:' + c1, [], stubEnv({ STUB_COMMIT: c2 }));
      expect(wrongCommit.status).toBe(2);
      expect(wrongCommit.stderr).toContain('carries org.harness-eval.gstack.commit=' + c2 + ', not the baseline SHA ' + c1);
      expect(existsSync(outDir(id))).toBe(false);
      const wrongMode = run(id, 'baseline:' + c1 + ',candidate:' + c2, ['--hermes-mode', 'chat'], stubEnv({ STUB_HERMES_MODE: 'oneshot' }));
      expect(wrongMode.status).toBe(2);
      expect(wrongMode.stderr).toContain(tag('hermes', c1) + ' carries org.harness-eval.gstack.hermes_mode=oneshot, not --hermes-mode chat');
      expect(existsSync(outDir(id))).toBe(false);
      const ok = run(id, 'baseline:' + c1 + ',candidate:' + c2, ['--hermes-mode', 'chat'], stubEnv());
      expect({ status: ok.status, stderr: ok.stderr.slice(-800) }).toMatchObject({ status: 0 });
      const manifest = JSON.parse(readFileSync(join(outDir(id), 'manifest.json'), 'utf8'));
      expect(manifest.arms.candidate.images.hermes).toEqual({ tag: tag('hermes', c2), digest: 'sha256:stub-gstack-' + c2.slice(0, 8) + '-chat' });
      expect(ok.stderr).not.toContain('is not built');
    } finally { rmSync(outDir(id), { recursive: true, force: true }); }
  }, 120_000);
  test('the panel loop with a stubbed docker: a busy port rotates after three attempts, the lease opens once, the row is written and the lease closed; a proxy that never listens writes infra_error and stops', async () => {
    const id = 'test-panel-loop-' + process.pid, trial = 'gsta135-openclaw-t1-baseline-1', next = 'gsta135-openclaw-t1-candidate-1';
    const busy = Bun.listen({ hostname: '127.0.0.1', port: 8830, socket: { data() {} } });
    try {
      const env = stubEnv({ ANTHROPIC_API_KEY: 'placeholder-anthropic', HE_PROXY_GATEWAY: '127.0.0.1', HE_PROXY_PORT: '8830' });
      const r = run(id, 'baseline:' + c1 + ',candidate:' + c1, ['--trials', '1', '--only', trial, '--hermes-mode', 'chat', '--approval', 'approvals.mode=manual'], env, false);
      expect({ status: r.status, stderr: r.stderr.slice(-1500) }).toMatchObject({ status: 0 });
      expect(r.stderr.match(/did not come up on 127\.0\.0\.1:8830 /g)).toHaveLength(3);
      expect(r.stderr).toContain('rotating to port 8831');
      expect(r.stderr).not.toContain('127.0.0.1:8831 as');
      expect(r.stdout).toContain(trial + ' start');
      expect(r.stdout).toContain('proxy 127.0.0.1:8831');
      const dir = outDir(id, false);
      const cells = rows(join(dir, 'cells.jsonl'));
      expect(cells).toHaveLength(12);
      const mine = cells.find(c => c.trial_id === trial)!;
      expect(mine).toMatchObject({ termination: 'infra:no_model_request(completed)', exit_code: 0, requests_forwarded: 0, requests_undrained: 0, usd_spent: 0, usd_charged_reservation: 0, image: tag('openclaw', c1), image_id: 'sha256:stub-gstack-' + c1.slice(0, 8), image_digest: 'sha256:stub-gstack-' + c1.slice(0, 8) });
      expect(['pass', 'fail']).toContain(mine.grade);
      expect(mine.grade).toBe(JSON.parse(readFileSync(join(dir, 'trials', trial, 'result.json'), 'utf8')).grade);
      expect(mine.note).toContain('gstack-register.log carries no marker: line');
      expect(new Set(cells.filter(c => c.trial_id !== trial).map(c => c.termination))).toEqual(new Set(['not_run:not_selected']));
      closeLedgers();
      const ledger = join(dir, 'ledger.sqlite');
      expect(readLedger(ledger).runs.map(x => x.run_id)).toEqual([id + '.' + trial]);
      expect(ledgerSummary(ledger, id)).toMatchObject({ leases: 1, open_leases: 0, requests: 0, committed_usd: 0 });
      expect(existsSync(join(dir, 'report.md'))).toBe(true);
      expect(readFileSync(join(dir, 'manifest.sha256'), 'utf8').trim()).toBe(sha256(readFileSync(join(dir, 'manifest.json'))));
    } finally { busy.stop(true); rmSync(outDir(id, false), { recursive: true, force: true }); }
    const id2 = id + '-never';
    try {
      const env = stubEnv({ ANTHROPIC_API_KEY: 'placeholder-anthropic', HE_PROXY_GATEWAY: '192.0.2.1', HE_PROXY_PORT: '8832' });
      const r = run(id2, 'baseline:' + c1 + ',candidate:' + c1, ['--trials', '1', '--only', trial + ',' + next, '--hermes-mode', 'chat', '--approval', 'approvals.mode=manual'], env, false);
      expect({ status: r.status, stderr: r.stderr.slice(-1500) }).toMatchObject({ status: 0 });
      expect(r.stderr.match(/did not come up on 192\.0\.2\.1:/g)).toHaveLength(9);
      expect(r.stderr.match(/rotating to port/g)).toHaveLength(3);
      expect(r.stdout).not.toContain(trial + ' start');
      const dir = outDir(id2, false);
      const cells = rows(join(dir, 'cells.jsonl'));
      expect(cells.find(c => c.trial_id === trial)).toMatchObject({ termination: 'infra_error', requests_forwarded: 0, usd_spent: 0 });
      expect(cells.find(c => c.trial_id === trial)!.note).toContain('the metering proxy did not start for ' + trial + ' after nine attempts');
      expect(cells.find(c => c.trial_id === next)).toMatchObject({ termination: 'not_run:infra_stop' });
      expect(new Set(cells.filter(c => c.trial_id !== trial && c.trial_id !== next).map(c => c.termination))).toEqual(new Set(['not_run:not_selected']));
      closeLedgers();
      expect(ledgerSummary(join(dir, 'ledger.sqlite'), id2)).toMatchObject({ open_leases: 0, requests: 0 });
      expect(readFileSync(join(dir, 'report.md'), 'utf8')).toContain('did not start');
      expect(existsSync(join(dir, 'trials', trial))).toBe(false);
    } finally { rmSync(outDir(id2, false), { recursive: true, force: true }); }
  }, 180_000);
  test('an image tag that moved after the manifest is not dispatched: infra_error, not_run:infra_stop for the rest, exit 2', () => {
    const id = 'test-panel-retag-' + process.pid, trial = 'gsta135-openclaw-t1-baseline-1', next = 'gsta135-openclaw-t1-candidate-1';
    try {
      const env = stubEnv({ ANTHROPIC_API_KEY: 'placeholder-anthropic', HE_PROXY_GATEWAY: '127.0.0.1', HE_PROXY_PORT: '8834', STUB_RETAG_AFTER: '4' });
      const r = run(id, 'baseline:' + c1 + ',candidate:' + c1, ['--trials', '1', '--only', trial + ',' + next, '--hermes-mode', 'chat', '--approval', 'approvals.mode=manual'], env, false);
      expect({ status: r.status, stderr: r.stderr.slice(-1500) }).toMatchObject({ status: 2 });
      expect(r.stderr).toContain('now resolves to sha256:retagged, not the manifest\'s sha256:stub-gstack-' + c1.slice(0, 8));
      expect(r.stdout).not.toContain(trial + ' start');
      const dir = outDir(id, false);
      const cells = rows(join(dir, 'cells.jsonl'));
      expect(cells).toHaveLength(12);
      expect(cells.find(c => c.trial_id === trial)).toMatchObject({ termination: 'infra_error', image_digest: 'sha256:stub-gstack-' + c1.slice(0, 8), image_id: null });
      expect(cells.find(c => c.trial_id === trial)!.note).toContain('not the manifest');
      expect(cells.find(c => c.trial_id === next)).toMatchObject({ termination: 'not_run:infra_stop' });
      expect(existsSync(join(dir, 'ledger.sqlite'))).toBe(false);
      expect(existsSync(join(dir, 'report.md'))).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).arms.baseline.images.openclaw.digest).toBe('sha256:stub-gstack-' + c1.slice(0, 8));
    } finally { rmSync(outDir(id, false), { recursive: true, force: true }); }
  }, 120_000);

  const GSTACK = join(homedir(), '.capy/work/he/gsta135/gstack');
  const PIN_SHA = 'bd8907d6';
  const dockerOk = (image: string) => spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0;
  const haveDocker = existsSync(join(GSTACK, '.git')) && spawnSync('git', ['-C', GSTACK, 'cat-file', '-e', PIN_SHA + '^{commit}'], { stdio: 'ignore' }).status === 0
    && dockerOk('harness-eval/openclaw:gstack-' + PIN_SHA) && dockerOk('harness-eval/hermes:gstack-' + PIN_SHA + '-chat');
  test.skipIf(!haveDocker)('one real trial through the panel loop against fake-anthropic.ts: the row carries the forwarded requests, the priced spend, the grade and a closed lease', async () => {
    const id = 'test-panel-docker-' + process.pid, trial = 'gsta135-openclaw-t1-baseline-1';
    const fakeLog = join(tmp, 'fake-requests.ndjson');
    const fake = Bun.spawn([process.execPath, 'scripts/gsta-135/fake-anthropic.ts', '--host', '127.0.0.1', '--port', '8837', '--log', fakeLog], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdout: 'pipe', stderr: 'pipe' });
    for (let i = 0; i < 100 && fake.exitCode === null; i++) { try { await fetch('http://127.0.0.1:8837/v1/models'); break; } catch { await Bun.sleep(50); } }
    const rt = join(tmp, 'runtime-docker.json');
    writeFileSync(rt, JSON.stringify({ ['harness-eval/openclaw:gstack-' + PIN_SHA]: 'pass' }));
    try {
      expect(fake.exitCode).toBeNull();
      const env = { ...baseEnv, ANTHROPIC_API_KEY: 'placeholder-anthropic', HE_PROXY_PORT: '8836', HE_PROXY_UPSTREAM: 'http://127.0.0.1:8837' };
      const r = spawnSync('bash', [sh, '--arms', 'baseline:' + PIN_SHA + ',candidate:' + PIN_SHA, '--gstack-dir', GSTACK, '--run-id', id, '--ceilings', ceilings, '--runtime-preflight', rt, '--trials', '1', '--only', trial, '--hermes-mode', 'chat', '--approval', 'approvals.mode=manual'], { cwd: ROOT, env, encoding: 'utf8' });
      expect({ status: r.status, stderr: r.stderr.slice(-2000) }).toMatchObject({ status: 0 });
      const dir = outDir(id, false);
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      expect(readFileSync(join(dir, 'manifest.sha256'), 'utf8').trim()).toBe(sha256(readFileSync(join(dir, 'manifest.json'))));
      const cells = rows(join(dir, 'cells.jsonl'));
      expect(cells).toHaveLength(12);
      const mine = cells.find(c => c.trial_id === trial)!;
      const result = JSON.parse(readFileSync(join(dir, 'trials', trial, 'result.json'), 'utf8'));
      expect(mine).toMatchObject({ termination: 'completed', exit_code: 0, requests_undrained: 0, budget_refusals: 0, usd_charged_reservation: 0, image: manifest.arms.baseline.images.openclaw.tag, image_id: manifest.arms.baseline.images.openclaw.digest });
      expect(mine.image_id).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.image).toBe(mine.image_id);
      expect(mine.requests_forwarded).toBeGreaterThanOrEqual(1);
      const lines = readUsage(join(dir, 'proxy-usage.ndjson')).filter(l => l.key === 'trial-token:' + trial && l.outcome === 'forwarded');
      expect(lines).toHaveLength(mine.requests_forwarded);
      expect(mine.usd_spent).toBeCloseTo(lines.reduce((n, l) => n + (l.actual_usd ?? 0), 0), 6);
      expect(mine.usd_spent).toBeGreaterThan(0);
      expect(['pass', 'fail']).toContain(mine.grade);
      expect(mine.grade).toBe(result.grade);
      expect(mine.note ?? '').not.toContain('no marker: line');
      expect(readFileSync(fakeLog, 'utf8').split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(mine.requests_forwarded);
      closeLedgers();
      expect(ledgerSummary(join(dir, 'ledger.sqlite'), id)).toMatchObject({ leases: 1, open_leases: 0, requests: mine.requests_forwarded });
      expect(ledgerSummary(join(dir, 'ledger.sqlite'), id).committed_usd).toBeCloseTo(mine.usd_spent, 6);
      expect(existsSync(join(dir, 'report.md'))).toBe(true);
    } finally { fake.kill('SIGTERM'); await fake.exited; rmSync(outDir(id, false), { recursive: true, force: true }); }
  }, 600_000);
});
