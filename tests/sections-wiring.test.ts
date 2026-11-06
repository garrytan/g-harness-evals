// internal-task wiring: the per-cell log_sections field (prereg validation, plan, the invocation check, the proxy argv and its
// status check), the smoke's check-sections step, and the readers of usage logs that must ignore the new fields
// (reconcile-provider, publish-audit, merge-shards, receipts-manifest, host-pilot-tables). Keyless: every proxy process
// gets PATH and HOME only.
import { afterAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildManifest, loadPrereg, renderPlan, RunnerError, type Cell, type Manifest, type Prereg } from '../runner/run.ts';
import { RunProxy, sectionsSmokeProblems } from '../runner/trial/proxy.ts';
import { executeRun } from '../runner/trial/run.ts';
import { requestSections } from '../runner/proxy/sections.ts';
import { summarizeProxy } from '../scripts/reconcile-provider.ts';
import { scanText, type Hit } from '../scripts/publish-audit.ts';
import { mergeShards } from '../scripts/merge-shards.ts';
import { buildRun } from '../scripts/receipts-manifest.ts';
import type { UsageLine } from '../runner/proxy/metering-proxy.ts';

const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'sections-wiring-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp };
let n = 0;
const dir = () => { const d = join(tmp, String(++n)); mkdirSync(d, { recursive: true }); return d; };

const cell = (id: string, extra: Partial<Cell> = {}): Cell => ({ id, harness: 'openclaw', model: 'anthropic:claude-opus-5-5', slice: 'hello', split: 'dev', repetitions: 1, ceiling: { input_tokens: 1000, output_tokens: 100 }, ...extra });
const prereg = (cells: Cell[]): Prereg => ({ schema_version: 1, run_id: 'sections-run', question: 'q', tasks: { hello: ['hello'] }, cells, wall_clock_s: { hello: 60 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] });
const write = (p: unknown) => { const f = join(dir(), 'prereg.json'); writeFileSync(f, JSON.stringify(p)); return f; };
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as RunnerError).code; } return 'no refusal'; };

/** A forwarded chat line as a proxy with --log-sections writes it. */
const sectionedLine = (key: string, extra: Record<string, unknown> = {}) => {
  const body = { model: 'claude-opus-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'USER-x' }] };
  return { at: '2026-10-31T10:00:00.000Z', key, provider: 'anthropic', route: '/v1/messages', model: 'claude-opus-5-5', outcome: 'forwarded', status: 200, reserved_usd: 0.5, actual_usd: 0.0123, input_tokens: 1000, output_tokens: 50, cached_tokens: 800, charged_reservation: false, streamed: true,
    cache_write_tokens: 100, cache_write_1h_tokens: 40, reasoning_tokens: 0, tools_called: ['<unlisted>'], sections: requestSections(body, Buffer.byteLength(JSON.stringify(body)), 'anthropic', '/v1/messages'), ...extra };
};
const NEW = ['cache_write_tokens', 'cache_write_1h_tokens', 'reasoning_tokens', 'tools_called', 'sections', 'sections_error'];
const strip = (l: Record<string, unknown>) => Object.fromEntries(Object.entries(l).filter(([k]) => !NEW.includes(k)));

describe('the log_sections cell field', () => {
  test('a boolean is accepted, recorded in the manifest cells and shown on the plan line; another type or a scripted cell is HE-PREREG-007', () => {
    const { prereg: p, sha256 } = loadPrereg(write(prereg([cell('a', { log_sections: true }), cell('b')])));
    const m = buildManifest(p, sha256, '2026-10-31T00:00:00Z');
    expect(m.cells.map((c) => c.log_sections)).toEqual([true, undefined]);
    const lines = renderPlan(m).split('\n').filter((l) => l.startsWith('CELL:'));
    expect(lines[0]).toContain(' log_sections ');
    expect(lines[1]).not.toContain('log_sections');
    expect(code(() => loadPrereg(write(prereg([cell('a', { log_sections: 'yes' as unknown as boolean })]))))).toBe('HE-PREREG-007');
    expect(code(() => loadPrereg(write(prereg([cell('s', { harness: 'scripted', harness_mode: 'scripted', model: 'none', script: 'oracle', log_sections: true })]))))).toBe('HE-PREREG-007');
    expect(code(() => loadPrereg(write(prereg([cell('a', { log_sections: false })]))))).toBe('no refusal');
  });

  test('an invocation whose model-calling cells disagree is refused before the proxy starts (HE-PROXY-005)', async () => {
    const d = dir();
    const cells = [cell('a', { slice: 'multiuser', log_sections: true }), cell('b', { slice: 'multiuser' }), cell('s', { harness: 'scripted', harness_mode: 'scripted', model: 'none', script: 'oracle', slice: 'multiuser' })];
    const manifest: Manifest = { schema_version: 1, run_id: 'sections-mixed', prereg_sha256: '0', created_at: '', cells, cost_ceiling_usd: 0, per_cell_ceiling_usd: {}, spend_cap_usd: 1, trial_hours_at_cap: 0,
      trials: cells.map((c) => ({ id: `sections-mixed/${c.id}/t/r1`, cell: c.id, task: 't', repetition: 1 })) };
    const err = await executeRun(manifest, join(d, 'manifest.json'), { harnessMode: 'process', grade: (() => { throw new Error('no grade'); }) as never, proxyEnv: ENV }).then(() => null, (e) => e as RunnerError);
    expect(err?.code).toBe('HE-PROXY-005');
    expect(err?.message).toContain('cells a set log_sections and cells b do not');
    expect(readdirSync(d)).not.toContain('proxy.log');
  });
});

describe('RunProxy and --log-sections', () => {
  const start = (d: string, logSections?: boolean) => RunProxy.start({ runId: `sections-proxy-${n}`, runDir: d, ledgerPath: join(d, 'ledger.sqlite'), leaseUsd: 1, allowModels: [], reachableFromContainers: false, env: ENV, newRun: true, ...(logSections === undefined ? {} : { logSections }) });
  test('the proxy argv carries --log-sections when the cells ask for it, and /__proxy/status says so; without it the status says false', async () => {
    for (const want of [true, false, undefined]) {
      const proxy = await start(dir(), want);
      try {
        const status = await (await fetch(`http://${proxy.host}:${proxy.port}/__proxy/status`)).json() as { log_sections: boolean };
        expect(status.log_sections).toBe(want === true);
      } finally { await proxy.stop(); }
    }
  }, 30_000);

  test('a proxy whose status does not report the requested log_sections is stopped and refused (HE-PROXY-003)', async () => {
    const stub = dir();
    mkdirSync(join(stub, 'runner', 'proxy'), { recursive: true });
    writeFileSync(join(stub, 'runner', 'proxy', 'metering-proxy.ts'), "const l = process.argv[process.argv.indexOf('--listen') + 1]!; const i = l.lastIndexOf(':');\nBun.serve({ hostname: l.slice(0, i), port: Number(l.slice(i + 1)), fetch: () => Response.json({ mode: 'lease' }) });\n");
    const before = process.cwd();
    process.chdir(stub);
    try {
      const err = await start(join(stub, 'run'), true).then(() => null, (e) => e as RunnerError);
      expect(err?.code).toBe('HE-PROXY-003');
      expect(err?.message).toContain('reports log_sections false, but the cells ask for true');
    } finally { process.chdir(before); }
  }, 30_000);
});

describe('the smoke check (check-sections)', () => {
  test('sectionsSmokeProblems: every forwarded chat line needs sections and the three counts; other routes and refusals do not count', () => {
    const ok = sectionedLine('trial-token:r/a/t/r1') as unknown as UsageLine;
    const embed = { ...strip(ok as never), route: '/v1/embeddings', provider: 'openai' } as unknown as UsageLine;
    const refused = { key: 'slot:x', provider: 'anthropic', route: '/v1/messages', outcome: 'refused' } as unknown as UsageLine;
    expect(sectionsSmokeProblems([ok, embed, refused])).toEqual([]);
    expect(sectionsSmokeProblems([embed, refused])).toEqual(['no forwarded chat line in the usage log']);
    const particle = { ...(ok as object), provider: 'particle', route: '/v1/chat/completions' } as unknown as UsageLine;
    expect(sectionsSmokeProblems([particle])).toEqual([]);
    expect(sectionsSmokeProblems([strip(particle as never) as unknown as UsageLine])[0]).toContain('(particle /v1/chat/completions, key trial-token:r/a/t/r1) lacks sections');
    const bare = strip(ok as never) as unknown as UsageLine;
    expect(sectionsSmokeProblems([ok, bare])[0]).toContain('chat line 2 of 2 (anthropic /v1/messages, key trial-token:r/a/t/r1) lacks sections, cache_write_tokens, cache_write_1h_tokens, reasoning_tokens');
    const errored = { ...strip(ok as never), cache_write_tokens: 0, cache_write_1h_tokens: 0, reasoning_tokens: 0, sections_error: 'request sections: x' } as unknown as UsageLine;
    expect(sectionsSmokeProblems([errored])).toEqual(['chat line 1 of 1 (anthropic /v1/messages, key trial-token:r/a/t/r1) lacks sections_error (request sections: x)']);
  });

  const check = (cells: Cell[], lines: unknown[] | null) => {
    const d = dir();
    writeFileSync(join(d, 'manifest.json'), JSON.stringify({ schema_version: 1, run_id: 'sections-smoke', cells, trials: [] }));
    if (lines) writeFileSync(join(d, 'proxy-usage.ndjson'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const p = Bun.spawnSync([process.execPath, 'runner/run.ts', 'check-sections', '--manifest', join(d, 'manifest.json')], { cwd: ROOT, env: ENV, stdout: 'pipe', stderr: 'pipe' });
    return { exit: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
  };
  test('bun runner/run.ts check-sections passes a run with no such cell, passes complete lines and fails the shard otherwise', () => {
    expect(check([cell('a')], null)).toEqual({ exit: 0, out: 'SECTIONS: not requested by any cell of sections-smoke\n' });
    const good = check([cell('a', { log_sections: true })], [sectionedLine('trial-token:sections-smoke/a/t/r1')]);
    expect(good).toEqual({ exit: 0, out: 'SECTIONS: ok run=sections-smoke cells=a chat_lines=1\n' });
    const bad = check([cell('a', { log_sections: true })], [strip(sectionedLine('trial-token:sections-smoke/a/t/r1'))]);
    expect(bad.exit).toBe(2);
    expect(bad.out).toStartWith('HE-PROXY-005 cells a set log_sections, but ');
    expect(bad.out).toContain('lacks sections, cache_write_tokens');
    const none = check([cell('a', { log_sections: true })], null);
    expect(none.exit).toBe(2);
    expect(none.out).toContain('no forwarded chat line');
  }, 30_000);

  test('check-sections reads only the lines of cells that set log_sections; an unsectioned cell in the same log passes', () => {
    const mixed = check([cell('on', { log_sections: true }), cell('off')], [sectionedLine('trial-token:sections-smoke/on/t/r1'), strip(sectionedLine('trial-token:sections-smoke/off/t/r1'))]);
    expect(mixed).toEqual({ exit: 0, out: 'SECTIONS: ok run=sections-smoke cells=on chat_lines=1\n' });
  }, 30_000);

  test('vm-shard.sh runs the check after the smoke and fails the shard before the counted run', () => {
    const sh = readFileSync(join(ROOT, 'scripts', 'ubicloud', 'vm-shard.sh'), 'utf8');
    const smoke = sh.indexOf('bun runner/run.ts check-sections --manifest "$shard/smoke/results/manifest.json"');
    expect(smoke).toBeGreaterThan(0);
    expect(sh.indexOf('[ "$sections_ok" -ne 0 ]')).toBeGreaterThan(smoke);
    expect(sh.indexOf('[ "$sections_ok" -ne 0 ]')).toBeLessThan(sh.lastIndexOf('phase run_start'));
  });
});

describe('usage-log readers ignore the new fields', () => {
  const runId = 'sections-run';
  const plain = [0, 1, 2].map((i) => strip(sectionedLine(`trial-token:${runId}/a/t/r${i + 1}`, { at: `2026-10-31T1${i}:00:00.000Z`, actual_usd: 0.01 * (i + 1) })));
  const rich = plain.map((l, i) => ({ ...l, ...Object.fromEntries(Object.entries(sectionedLine(String(l.key))).filter(([k]) => NEW.includes(k))), ...(i === 2 ? { sections: undefined, tools_called: undefined, sections_error: 'request sections: x' } : {}) }));
  const ndjson = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

  test('reconcile-provider: the proxy side totals are identical', () => {
    expect(summarizeProxy(rich as never, runId, 'America/Los_Angeles')).toEqual(summarizeProxy(plain as never, runId, 'America/Los_Angeles'));
    expect(summarizeProxy(rich as never, runId, 'UTC').total.requests).toBe(3);
  });

  test('publish-audit: a usage log with sections and digests carries no token pattern', () => {
    const hits: Hit[] = [], counts: Record<string, number> = {};
    scanText(ndjson(rich), 'proxy-usage.ndjson', hits, counts);
    expect(hits).toEqual([]);
    expect(counts).toEqual({});
  });

  test('merge-shards copies the usage log byte for byte and merges the same trials; receipts-manifest counts the same run', () => {
    const merged = (lines: unknown[]) => {
      const base = dir();
      const shard = join(base, 'shard-a');
      mkdirSync(shard);
      writeFileSync(join(shard, 'manifest.json'), JSON.stringify({ run_id: runId, trials: [{ id: `${runId}/a/t/r1`, cell: 'a' }] }));
      writeFileSync(join(shard, 'trials.jsonl'), JSON.stringify({ trial_id: `${runId}/a/t/r1`, cell: 'a', started_at: '2026-10-31T10:00:00Z', ended_at: '2026-10-31T10:05:00Z' }) + '\n');
      writeFileSync(join(shard, 'proxy-usage.ndjson'), ndjson(lines));
      const out = join(base, 'run', 'results');
      const shards = mergeShards(out, [{ name: 'shard-a', dir: shard }]);
      expect(readFileSync(join(out, 'shard-a.proxy-usage.ndjson'), 'utf8')).toBe(ndjson(lines));
      const row = buildRun(base, 'run');
      return { shards: { ...shards, shards: { 'shard-a': { ...shards.shards['shard-a']!, source: '' } } }, trials: readFileSync(join(out, 'trials.jsonl'), 'utf8'), row: { ...row, proxy_usage_logs: row.proxy_usage_logs.map((f) => f.path) } };
    };
    expect(merged(rich)).toEqual(merged(plain));
  });

  test('host-pilot-tables: the committed tables come out unchanged when every usage line carries the new fields', () => {
    const results = join(ROOT, 'docs', 'benchmarks', '2026-10-30-host-harness-pilot', 'results');
    const copy = dir();
    for (const entry of readdirSync(results)) {
      if (!entry.endsWith('.proxy-usage.ndjson')) { symlinkSync(join(results, entry), join(copy, entry)); continue; }
      const lines = readFileSync(join(results, entry), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      writeFileSync(join(copy, entry), ndjson(lines.map((l) => (l.outcome === 'forwarded' ? { ...l, ...Object.fromEntries(Object.entries(sectionedLine(l.key)).filter(([k]) => NEW.includes(k))) } : l))));
    }
    const out = dir();
    const p = Bun.spawnSync([process.execPath, join(ROOT, 'scripts/host-pilot-tables.ts'), '--results', copy, '--out', out], { cwd: ROOT, env: ENV, stdout: 'pipe', stderr: 'pipe' });
    expect(p.exitCode).toBe(0);
    expect(readFileSync(join(out, 'host-pilot-tables.md'), 'utf8')).toBe(readFileSync(join(results, 'host-pilot-tables.md'), 'utf8'));
    expect(readFileSync(join(out, 'host-pilot-tables.json'), 'utf8')).toBe(readFileSync(join(results, 'host-pilot-tables.json'), 'utf8'));
  }, 120_000);
});
