import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  addUsage, appendRow, buildRow, bundleSpec, checkSpec, leaseRefusal, loadSpec, newUsage, readRows, rowArm, runnerInfra, scanForKeys,
  sharedOrder, showSpec, UsageReader, INTERIM_DESIGN, VERSIONS, leaseRunId, plannedTaskInputs, shardIdentity, type CellPlan, type LoadedSpec, type PlannedTrial,
} from '../scripts/mcp-at-scale/run.ts';
import { materialize } from '../scripts/mcp-at-scale/materialize.ts';
import { BudgetRun } from '../runner/ledger/budget-ledger.ts';
import { interimUnits } from '../scripts/mcp-at-scale/analysis/interim.ts';
import { clusterOf } from '../scripts/mcp-at-scale/requests/seal.ts';

const EXAMPLE = resolve(import.meta.dir, '../scripts/mcp-at-scale/specs/example.json');
const tmp = () => mkdtempSync(join(tmpdir(), 'mcp-run-'));

/** The example spec with a change, written next to a copy of its set file. */
function variant(change: (s: any) => void, setText?: string): LoadedSpec {
  const dir = tmp();
  const base = loadSpec(EXAMPLE);
  const spec = JSON.parse(JSON.stringify(base.spec));
  const text = setText ?? readFileSync(join(base.dir, base.spec.sets[0]!.file), 'utf8');
  writeFileSync(join(dir, 'example-r.jsonl'), text);
  change(spec);
  writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec));
  return loadSpec(join(dir, 'spec.json'));
}
const problemsOf = (l: LoadedSpec) => checkSpec(l).problems;
const REPO = resolve(import.meta.dir, '..');
const keyless = { PATH: dirname(process.execPath) + ':/usr/local/bin:/usr/bin:/bin', HOME: tmp(), TZ: 'UTC' };
const run = (...args: string[]) => Bun.spawnSync(args, { cwd: REPO, env: keyless, stdout: 'pipe', stderr: 'pipe' });
const runts = (...args: string[]) => run(process.execPath, 'scripts/mcp-at-scale/run.ts', ...args);

describe('separate phase launches', () => {
  const phased = (extra?: (s: any) => void) => variant((s) => {
    s.trial_headroom_usd = 1;
    s.shards[0].phases = [{ lease_usd: 2.5, expected_hours: 4 }, { lease_usd: 3.5, expected_hours: 2.5 }];
    extra?.(s);
  });
  test('phase leases add up to the shard lease, have distinct ids, and set their own TTLs', () => {
    const l = phased();
    const { plan, problems } = checkSpec(l);
    expect(problems).toEqual([]);
    const shown = showSpec(l, plan);
    expect(shown).toContain('phase 1: lease $2.50 (mcp-example:a:p1), expected 4h, TTL 8h');
    expect(shown).toContain('phase 2: lease $3.50 (mcp-example:a:p2), expected 2.5h, TTL 6h');
    expect(problemsOf(phased((s) => { s.shards[0].phases[1].lease_usd = 3.51; })).join(' ')).toContain('phase leases must add up');
  });
  test('phase 2 refuses without phase 1 final receipts before credentials, staging, or spend', () => {
    const l = phased();
    const dest = tmp();
    const r = run('bash', 'scripts/mcp-at-scale/run-shard-vm.sh', '--spec', l.path, '--name', 'a', '--dest', dest, '--phase', '2', '--fake-upstream');
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toContain('missing phase final receipt: cleanup.json');
    expect(existsSync(join(dest, 'phase-2'))).toBe(false);
    const direct = runts('shard', '--spec', l.path, '--name', 'a', '--out', join(dest, 'phase-2'), '--phase', '2', '--fake-upstream');
    expect(direct.exitCode).toBe(2);
    expect(direct.stderr.toString()).toContain('needs --prior-phase');
  });
  test('both phase finals merge without duplicate trial ids and retain separate ledgers and logs', () => {
    const l = phased((s) => { for (const c of s.cells) c.reps = 2; });
    const { plan } = checkSpec(l);
    const dest = tmp();
    const commit = run('git', 'rev-parse', 'HEAD').stdout.toString().trim();
    const opts = ['--spec', l.path, '--name', 'a', '--fake-upstream'];
    const phaseRows = (phase: 1 | 2) => [...plan.cells.values()].flatMap((c) => c.trials.filter((t) => t.phase === phase).map((t) => ({
      ...t, run_id: l.spec.run_id, shard: 'a', host_log: 'catalog-calls.jsonl',
    })));
    for (const phase of [1, 2] as const) {
      const dir = join(dest, 'phase-' + phase, 'final', 'a');
      mkdirSync(dir, { recursive: true });
      const lease = leaseRunId(l.spec, 'a', phase);
      const lease_usd = l.spec.shards[0]!.phases![phase - 1]!.lease_usd;
      const identity = shardIdentity(l, plan, 'a', commit, true, true, phase);
      const a = { lease, lease_usd, committed_usd: 0, drained: false, undrained: [], identity };
      writeFileSync(join(dir, 'run-identity.json'), JSON.stringify(identity));
      writeFileSync(join(dir, 'accounting.json'), JSON.stringify(a));
      writeFileSync(join(dir, 'ledger-summary.json'), JSON.stringify({ run_id: lease, lease_usd, committed_usd: 0 }));
      writeFileSync(join(dir, 'ledger.sqlite'), '');
      writeFileSync(join(dir, 'key-scan.json'), JSON.stringify({ patterns: {}, values: {}, unreadable: 0 }));
      writeFileSync(join(dir, 'catalog-calls.jsonl'), '');
      writeFileSync(join(dir, 'trials.jsonl'), phaseRows(phase).map((t) => JSON.stringify(t)).join('\n') + '\n');
      const complete = () => runts('phase-complete', ...opts, '--phase', String(phase), '--out', dir);
      expect(complete().stderr.toString()).toContain('not drained');
      writeFileSync(join(dir, 'accounting.json'), JSON.stringify({ ...a, drained: true }));
      expect(complete().exitCode).toBe(0);
    }
    const bundled = bundleSpec(l, tmp());
    expect(runts('phase-check', '--spec', bundled, '--name', 'a', '--phase', '1', '--out', join(dest, 'phase-1/final/a'), '--fake-upstream').exitCode).toBe(0);
    const phase2 = join(dest, 'phase-2/final/a/trials.jsonl');
    const original = readFileSync(phase2, 'utf8');
    writeFileSync(phase2, original + JSON.stringify(phaseRows(1)[0]) + '\n');
    const merge = () => runts('merge-phases', ...opts, '--out', dest);
    expect(merge().stderr.toString()).toContain('duplicate or unexpected trial row');
    expect(existsSync(join(dest, 'trials.jsonl'))).toBe(false);
    writeFileSync(phase2, original);
    const resume = runts('shard', ...opts, '--phase', '2', '--out', dirname(phase2), '--prior-phase', join(dest, 'phase-1/final/a'));
    expect(resume.exitCode).toBe(0);
    expect(readFileSync(phase2, 'utf8')).toBe(original);
    expect(merge().exitCode).toBe(0);
    const rows = readRows(join(dest, 'trials.jsonl'));
    expect(rows.length).toBe(12);
    expect(new Set(rows.map((t) => t.trial_id)).size).toBe(12);
    expect(rows.every((t) => t.host_log === 'phase-' + t.phase + '/final/a/catalog-calls.jsonl')).toBe(true);
    expect(merge().exitCode).toBe(2);
  });
});

describe('reviewed runner preflights and recovery', () => {
  test('paid shards refuse egress:false before startup', () => {
    const l = variant((s) => { s.egress = false; });
    const out = join(tmp(), 'results');
    const r = runts('shard', '--spec', l.path, '--name', 'a', '--out', out);
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toContain('a paid shard must run behind the egress blocklist');
    expect(existsSync(join(out, 'run-identity.json'))).toBe(false);
    const launch = run('bash', 'scripts/mcp-at-scale/run-shard-vm.sh', '--spec', l.path, '--name', 'a', '--dest', out, '--ttl-hours', '3');
    expect(launch.exitCode).toBe(2);
    expect(launch.stderr.toString()).toContain('a paid shard must run behind the egress blocklist');
  });
  test('a mixed-rung shard builds only the item/rung pairs it planned', async () => {
    const base = loadSpec(EXAMPLE);
    const pg = { id: 'pg-only', set: 'R', kind: 'tool', text: 'Run a query in Postgres.', stratum: 'names_service', bait: false, target: { server: 'postgres', tool: 'query' }, acceptable: [{ server: 'postgres', tool: 'query' }] };
    const text = readFileSync(join(base.dir, base.spec.sets[0]!.file), 'utf8') + JSON.stringify(pg) + '\n';
    const l = variant((s) => {
      s.sets[0].sha256 = new Bun.CryptoHasher('sha256').update(text).digest('hex');
      s.cells[0].items = ['ex-r-001'];
      s.cells[1].items = ['pg-only']; s.cells[1].rungs = [75];
    }, text);
    const { plan, problems } = checkSpec(l);
    expect(problems).toEqual([]);
    const out = tmp();
    const r = await materialize({ catalog: plan.catalogDir, ...plannedTaskInputs([...plan.cells.values()], plan.items), out });
    expect(r.tasks.map((t) => t.task).sort()).toEqual(['ex-r-001__r30', 'pg-only__r75']);
    expect(existsSync(join(out, 'tasks/pg-only__r30'))).toBe(false);
  });
  test('paid resume refuses a partial fake run with the same trial ids', () => {
    const l = loadSpec(EXAMPLE);
    const { plan } = checkSpec(l);
    const out = tmp();
    const commit = run('git', 'rev-parse', 'HEAD').stdout.toString().trim();
    const state = shardIdentity(l, plan, 'a', commit, true, true);
    const trials = join(out, 'trials.jsonl');
    const row = [...plan.cells.values()][0]!.trials[0]!;
    const saved = JSON.stringify(row) + '\n';
    writeFileSync(trials, saved);
    writeFileSync(join(out, 'run-identity.json'), JSON.stringify(state));
    const opts = ['--spec', l.path, '--name', 'a', '--out', out];
    const paid = runts('shard', ...opts);
    expect(paid.exitCode).toBe(2);
    expect(paid.stderr.toString()).toContain('shard resume identity mismatch: mode');
    for (const field of ['spec_sha256', 'commit', 'catalog_sha256'] as const) {
      writeFileSync(join(out, 'run-identity.json'), JSON.stringify({ ...state, [field]: 'different' }));
      const fake = runts('shard', ...opts, '--fake-upstream');
      expect(fake.exitCode).toBe(2);
      expect(fake.stderr.toString()).toContain('shard resume identity mismatch: ' + field);
    }
    expect(readFileSync(trials, 'utf8')).toBe(saved);
    expect(existsSync(join(out, 'ledger.sqlite'))).toBe(false);
  });
  test('resume finalizes a shard interrupted after its last trial row', () => {
    const l = loadSpec(EXAMPLE);
    const { plan } = checkSpec(l);
    const out = tmp();
    const commit = run('git', 'rev-parse', 'HEAD').stdout.toString().trim();
    const identity = shardIdentity(l, plan, 'a', commit, true, true);
    writeFileSync(join(out, 'run-identity.json'), JSON.stringify(identity));
    const rows = [...plan.cells.values()].flatMap((c) => c.trials).map((t) => ({ ...t, run_id: l.spec.run_id, shard: 'a' }));
    const trials = join(out, 'trials.jsonl');
    const saved = rows.map((t) => JSON.stringify(t)).join('\n') + '\n';
    writeFileSync(trials, saved);
    const pin = JSON.parse(readFileSync(join(REPO, 'scripts/frontier-harbor/pin.json'), 'utf8'));
    const maxOut = Math.max(...Object.values(pin.models as Record<string, { max_output_tokens: number }>).map((m) => m.max_output_tokens));
    const lease = leaseRunId(l.spec, 'a');
    BudgetRun.openLease({ runId: lease, leaseUsd: l.spec.shards[0]!.lease_usd, ledgerPath: join(out, 'ledger.sqlite'), maxOutputTokens: maxOut });
    const bin = tmp();
    writeFileSync(join(bin, 'docker'), '#!/bin/sh\n[ "$1 $2" = "network inspect" ] && echo 127.0.0.1\n', { mode: 0o755 });
    const listeners = Array.from({ length: 3 }, () => Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('fixture') }));
    const [proxy, broker, fake] = listeners.map((s) => String(s.port));
    for (const s of listeners) s.stop(true);
    const result = Bun.spawnSync([process.execPath, 'scripts/mcp-at-scale/run.ts', 'shard', '--spec', l.path, '--name', 'a', '--out', out,
      '--proxy-port', proxy!, '--broker-port', broker!, '--fake-port', fake!, '--venv', join(out, 'no-harbor'), '--fake-upstream'],
    { cwd: REPO, env: { ...keyless, PATH: bin + ':' + keyless.PATH }, stdout: 'pipe', stderr: 'pipe', timeout: 12000 });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(out, 'accounting.json'), 'utf8'))).toMatchObject({ drained: true, lease, identity });
    expect(JSON.parse(readFileSync(join(out, 'ledger-summary.json'), 'utf8'))).toMatchObject({ run_id: lease });
    expect(JSON.parse(readFileSync(join(out, 'key-scan.json'), 'utf8'))).toMatchObject({ patterns: {}, values: {} });
    expect(readFileSync(trials, 'utf8')).toBe(saved);
    expect(existsSync(join(out, 'work/native'))).toBe(false);
  }, 15000);
  test('failed final pull preserves the recoverable VM', () => {
    const root = tmp();
    const mcp = join(root, 'scripts/mcp-at-scale');
    const ubi = join(root, 'scripts/ubicloud');
    const bin = join(root, 'bin');
    for (const d of [mcp, ubi, bin]) mkdirSync(d, { recursive: true });
    writeFileSync(join(mcp, 'run-shard-vm.sh'), readFileSync(join(REPO, 'scripts/mcp-at-scale/run-shard-vm.sh')));
    writeFileSync(join(bin, 'bun'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(bin, 'git'), [
      '#!/bin/bash', 'case "$*" in', '  *"diff --quiet"*|*"checkout -q"*) exit 0;;',
      '  "clone "*) mkdir -p "${@: -1}";;', '  *"rev-parse"*) echo stub-head;;', '  *) exit 1;;', 'esac',
    ].join('\n'), { mode: 0o755 });
    writeFileSync(join(ubi, 'ubi-runner.sh'), [
      '#!/bin/bash', 'case "$1" in',
      '  run) printf "UBICLOUD: left=1 owner=test vm=%s kept=1\\n" "$3" > "$UBI_LEFT_FILE"; exit 1;;',
      '  down) touch "$HOME/destroyed";;', 'esac',
    ].join('\n'), { mode: 0o755 });
    const r = Bun.spawnSync(['bash', join(mcp, 'run-shard-vm.sh'), '--spec', EXAMPLE, '--name', 'a', '--dest', join(root, 'out'),
      '--ttl-hours', '3', '--pull-seconds', '1', '--fake-upstream'],
    { env: { ...keyless, HOME: root, PATH: bin + ':' + keyless.PATH, UBI_OWNER: 'test', UBICLOUD_API_KEY: 'fake-local-fixture' }, stdout: 'pipe', stderr: 'pipe' });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain('final pull failed; kept ubirun-test-');
    expect(r.stderr.toString()).toContain('mcp-out/a');
    expect(existsSync(join(root, 'destroyed'))).toBe(false);
  });
});

describe('spec checker', () => {
  test('the example spec passes and plans 3 trials per cell in one shard', () => {
    const { problems, plan } = checkSpec(loadSpec(EXAMPLE));
    expect(problems).toEqual([]);
    expect([...plan.cells.keys()]).toEqual(['cc-opus-r30', 'codex-sol-r30']);
    const cc = plan.cells.get('cc-opus-r30')!;
    expect(cc.trials.map((t) => t.trial_id)).toContain('mcp-example/cc-opus-r30/30/ex-r-001');
    expect(cc.trials.map((t) => t.order)).toEqual([0, 1, 2]);
    expect(cc.shard).toBe('a');
    expect(cc.arm).toBe('native');
  });

  test('cells share the order of the (rung, item) pairs they share', () => {
    const { plan } = checkSpec(loadSpec(EXAMPLE));
    const a = plan.cells.get('cc-opus-r30')!.trials.map((t) => t.rung + '/' + t.request);
    const b = plan.cells.get('codex-sol-r30')!.trials.map((t) => t.rung + '/' + t.request);
    expect(a).toEqual(b);
    const keys = ['30/x', '75/x', '30/y', '150/z'];
    const order = sharedOrder('seed', keys);
    expect(sharedOrder('seed', [...keys].reverse())).toEqual(order);
    expect(sharedOrder('seed', keys.filter((k) => k !== '75/x'))).toEqual(order.filter((k) => k !== '75/x'));
    expect(sharedOrder('another seed', keys)).not.toEqual(order);
  });

  test('repeated trials have distinct ids and share the item’s interim phase', () => {
    const l = variant((s) => { s.cells[0].reps = 2; s.cells[0].rep_sets = ['example-r']; });
    const { plan, problems } = checkSpec(l);
    expect(problems).toEqual([]);
    const trials = plan.cells.get('cc-opus-r30')!.trials;
    expect(trials).toHaveLength(6);
    for (const [, xs] of Map.groupBy(trials, (t) => t.request)) {
      const [a, b] = xs.toSorted((a, b) => a.rep - b.rep);
      expect([a!.rep, b!.rep, b!.trial_id, b!.phase]).toEqual([1, 2, a!.trial_id + '/rep2', a!.phase]);
    }
    expect(plan.cells.get('codex-sol-r30')!.trials.every((t) => t.rep === 1)).toBe(true);
  });

  test('phase 1 holds exactly the interim look units\' trials in every cell, first, in the shared order', () => {
    const l = variant((s) => { for (const c of s.cells) c.rungs = [30, 300]; });
    const { problems, plan } = checkSpec(l);
    expect(problems).toEqual([]);
    const units = interimUnits([...plan.items.values()], INTERIM_DESIGN.seed, INTERIM_DESIGN.fraction);
    expect(units.size).toBeGreaterThan(0);
    const shared = sharedOrder(String(l.spec.shared_order_seed), [...plan.cells.values()][0]!.trials.map((t) => t.rung + '/' + t.request));
    for (const c of plan.cells.values()) {
      const inLook = c.trials.filter((t) => units.has(clusterOf(plan.items.get(t.request)!).cluster));
      expect(c.trials.filter((t) => t.phase === 1).map((t) => t.trial_id).sort()).toEqual(inLook.map((t) => t.trial_id).sort());
      expect(inLook.length).toBeGreaterThan(0);
      expect(inLook.length).toBeLessThan(c.trials.length);
      expect(c.trials.map((t) => t.phase)).toEqual([...c.trials.map((t) => t.phase)].sort());
      expect(c.trials.map((t) => t.order)).toEqual(c.trials.map((_, i) => i));
      for (const p of [1, 2]) expect(c.trials.filter((t) => t.phase === p).map((t) => t.rung + '/' + t.request)).toEqual(shared.filter((k) => c.trials.find((t) => t.rung + '/' + t.request === k)!.phase === p));
    }
    expect(showSpec(l, plan)).toMatch(/phase 1 \d+, phase 2 \d+/);
  });

  test('a set whose bytes differ from the pinned sha256 is refused', () => {
    const exampleSet = resolve(import.meta.dir, '../scripts/mcp-at-scale/specs/example-r.jsonl');
    const l = variant(() => {}, readFileSync(exampleSet, 'utf8') + '\n');
    expect(problemsOf(l).join('\n')).toContain('the spec pins');
  });

  test('leases plus the reserve must fit the cap', () => {
    expect(problemsOf(variant((s) => { s.reserve_usd = 0.5; })).join('\n')).toContain('exceed cap_usd');
    expect(problemsOf(variant((s) => { s.cap_usd = 7; s.reserve_usd = 1; }))).toEqual([]);
  });

  test('a cell runs on exactly one shard, and every cell is on a shard', () => {
    expect(problemsOf(variant((s) => { s.cap_usd = 10; s.shards.push({ name: 'b', cells: ['cc-opus-r30'], lease_usd: 4 }); })).join('\n')).toContain('a cell runs on exactly one shard');
    expect(problemsOf(variant((s) => { s.shards[0].cells = ['cc-opus-r30']; })).join('\n')).toContain('cell codex-sol-r30 is on no shard');
    expect(problemsOf(variant((s) => { s.shards[0].cells.push('ghost'); })).join('\n')).toContain('names cell ghost');
  });

  test('items must exist in the cell sets and their tools must be on every rung', () => {
    expect(problemsOf(variant((s) => { s.cells[0].items = ['ex-r-001', 'nope']; })).join('\n')).toContain('item nope is not in its sets');
    const line = JSON.stringify({ id: 'ex-r-pg', set: 'R', kind: 'tool', text: 'Run the SQL query select 1 against Postgres.', stratum: 'names_service', target: { server: 'postgres', tool: 'query' }, bait: false, acceptable: [{ server: 'postgres', tool: 'query' }] }) + '\n';
    const l = variant(() => {}, line);
    const fixed = JSON.parse(readFileSync(l.path, 'utf8'));
    fixed.sets[0].sha256 = new Bun.CryptoHasher('sha256').update(line).digest('hex');
    fixed.cells[0].rungs = [30, 75];
    writeFileSync(l.path, JSON.stringify(fixed));
    const p = problemsOf(loadSpec(l.path)).join('\n');
    expect(p).toContain('acceptable tool postgres/query is not on rung 30');
    expect(p).not.toContain('is not on rung 75');
  });

  test('a reachable tool keeps an audited alternative valid on a narrower rung', () => {
    const src = loadSpec(EXAMPLE);
    const rows = readFileSync(join(src.dir, src.spec.sets[0]!.file), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    rows[0].acceptable.push({ server: 'postgres', tool: 'query' });
    const load = () => {
      const text = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
      return variant((s) => { s.sets[0].sha256 = new Bun.CryptoHasher('sha256').update(text).digest('hex'); }, text);
    };
    expect(problemsOf(load())).toEqual([]);
    rows[0].acceptable[1].tool = 'does_not_exist';
    expect(problemsOf(load()).join('\n')).toContain('acceptable tool postgres/does_not_exist is not in the catalog');
  });

  test('arms, variants, models, versions and rungs are checked', () => {
    expect(problemsOf(variant((s) => { s.cells[0].arm = 'mechanism'; })).join('\n')).toContain('needs a mechanism variant');
    expect(problemsOf(variant((s) => { s.cells[0].variant = 'claude-code-no-tool-search'; })).join('\n')).toContain('its arm is mechanism');
    expect(problemsOf(variant((s) => { s.cells[0].arm = 'gbrain'; })).join('\n')).toContain('names gbrain_cell');
    expect(problemsOf(variant((s) => { s.cells[0].variant = 'qm'; })).join('\n')).toContain('QM has no Harbor class');
    expect(problemsOf(variant((s) => { s.cells[1].model = 'anthropic/claude-opus-5-5'; })).join('\n')).toContain('codex cannot call anthropic models');
    expect(problemsOf(variant((s) => { s.cells[0].model = 'anthropic/claude-nonesuch'; })).join('\n')).toContain('not in pin.json models');
    expect(problemsOf(variant((s) => { s.harness_versions['claude-code'] = '0.0.1'; })).join('\n')).toContain('is neither pinned');
    expect(problemsOf(variant((s) => { s.harness_versions['claude-code'] = VERSIONS.harnesses['claude-code']!.version; s.harness_versions.codex = VERSIONS.harnesses.codex!.version; }))).toEqual([]);
    expect(problemsOf(variant((s) => { delete s.harness_versions.codex; })).join('\n')).toContain('no version for codex');
    expect(problemsOf(variant((s) => { s.cells[0].rungs = [31]; })).join('\n')).toContain('no rung 31');
    expect(problemsOf(variant((s) => { s.colour = 'blue'; })).join('\n')).toContain('unknown spec field colour');
    expect(problemsOf(variant((s) => { s.trial_headroom_usd = 6; })).join('\n')).toContain('no trial could start');
  });

  test('versions.json freezes pin.json harnesses with a source and a checkable digest, and gbrain at a tag and commit', () => {
    const pin = JSON.parse(readFileSync(resolve(import.meta.dir, '../scripts/frontier-harbor/pin.json'), 'utf8'));
    expect(VERSIONS).toEqual(JSON.parse(readFileSync(resolve(import.meta.dir, '../scripts/mcp-at-scale/versions.json'), 'utf8')));
    for (const [h, e] of Object.entries(VERSIONS.harnesses as Record<string, Record<string, any>>)) {
      expect(pin.harnesses[h]).toBeDefined();
      expect(e.source).toMatch(/^https:\/\//);
      if (e.same_as_pin) { expect(e.version).toBe(String(pin.harnesses[h].version)); continue; }
      expect(e.version).not.toBe(String(pin.harnesses[h].version));
      expect(e.npm_integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
    }
    expect(VERSIONS.harnesses['claude-code']!).toHaveProperty('native_binary_sha256', expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(VERSIONS.gbrain.tag).toMatch(/^v\d+\.\d+\.\d+\.\d+$/);
    expect(VERSIONS.gbrain.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  test('the frozen listing map records each harness and gbrain at the pinned releases', () => {
    const map = JSON.parse(readFileSync(resolve(import.meta.dir, '../scripts/mcp-at-scale/outputs/listing-map-frozen.json'), 'utf8'));
    const versions = Object.fromEntries(Object.entries(VERSIONS.harnesses).map(([name, entry]) => [name, entry.version]));
    expect(map.versions).toEqual({ ...versions, gbrain: VERSIONS.gbrain.tag });
    for (const variant of new Set<string>(map.rows.map((row: { variant: string }) => row.variant))) {
      expect(map.rows.filter((row: { variant: string }) => row.variant === variant).map((row: { rung: string }) => row.rung).sort()).toEqual(['150', '30', '300', '75']);
    }
    expect(map.rows).toHaveLength(32);
    expect(map.gbrain_rows).toHaveLength(20);
  });

  test('the VM entry point stops before installing anything without a staged spec', () => {
    const cwd = tmp();
    try {
      const script = resolve(import.meta.dir, '../scripts/mcp-at-scale/vm-shard.sh');
      const result = Bun.spawnSync(['bash', script, 'example'], { cwd, env: keyless, stdout: 'pipe', stderr: 'pipe' });
      expect(result.exitCode).toBe(2);
      expect(result.stderr.toString()).toContain("vm-shard: run from the staged checkout's root");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('a mechanism cell gets the arm analysis/stats.ts reads', () => {
    expect(rowArm({ id: 'x', variant: 'claude-code-no-tool-search', model: 'anthropic/claude-opus-5-5', arm: 'mechanism', rungs: [30], sets: [] })).toBe('tool-search-off');
    expect(rowArm({ id: 'x', variant: 'pi-codemode', model: 'anthropic/claude-opus-5-5', arm: 'gbrain', gbrain_cell: 'verbs', rungs: [150], sets: [] })).toBe('gbrain-verbs');
  });

  test('bundle copies the sets beside the spec and the bundle checks clean', () => {
    const out = tmp();
    const path = bundleSpec(loadSpec(EXAMPLE), out);
    const l = loadSpec(path);
    expect(l.spec.sets[0]!.file).toBe('sets/example-r-example-r.jsonl');
    expect(checkSpec(l).problems).toEqual([]);
  });
});

const cell: CellPlan = {
  cell: { id: 'cc', variant: 'claude-code', model: 'anthropic/claude-opus-5-5', arm: 'native', rungs: [30], sets: ['r'] },
  harness: 'claude-code', cls: 'McpClaudeCode', version: '2.1.312', arm: 'native', shard: 'a', trials: [],
};
const planned: PlannedTrial = { trial_id: 'run/cc/30/r-001', cell: 'cc', set: 'r', item_set: 'R', request: 'r-001', rung: 30, rep: 1, phase: 2, order: 4 };
const outcomes = { request: 'r-001', kind: 'tool', rung: '30', servers_expected: ['github'], servers_connected: ['github'], servers_missing: [], infra: null, calls: [], right_tool: true, first_right_call: 0, wrong_tools: [], tool_when_none: null, invalid_calls: 0, reward: 1 };
const line = (o: Record<string, unknown>) => ({ at: 't', key: 'k1', provider: 'anthropic', route: '/v1/messages', model: 'claude-opus-5-5', outcome: 'forwarded', ...o }) as any;
const base = { runId: 'run', shard: 'a', planned, cell, job: 'cc__a1__r30-r-001', meterKey: 'k1', result: { exception_info: null }, effort: null, hostLog: 'jobs/x/verifier/catalog-calls.jsonl', startedAt: '2026-11-19T10:00:00.000Z', endedAt: '2026-11-19T10:01:30.500Z', gapS: 12.25, trialDirFound: true };

describe('row writer', () => {
  test('a clean trial keeps the grader outcomes, the meter cost and the token sums', () => {
    const u = newUsage();
    addUsage(u, line({ input_tokens: 1000, output_tokens: 50, cached_tokens: 600, cache_write_tokens: 100, actual_usd: 0.01 }));
    addUsage(u, line({ input_tokens: 2000, output_tokens: 70, cached_tokens: 1400, actual_usd: 0.02 }));
    addUsage(u, line({ outcome: 'estimated', input_tokens: 99 }));
    const row = buildRow({ ...base, outcomes, usage: u, meter: { usd: 0.0301, requests: 2, unpriced: 0, byModel: { 'anthropic:claude-opus-5-5': { usd: 0.0301, requests: 2 } } } });
    expect(row.infra).toBeNull();
    expect(row.reward).toBe(1);
    expect(row.outcomes).toEqual(outcomes);
    expect(row.usage).toMatchObject({ usd: 0.0301, requests: 2, input_tokens: 3000, output_tokens: 120, cache_read_tokens: 2000, cache_write_tokens: 100, cache_read_share: 0.6667 });
    expect(row).toMatchObject({ trial_id: 'run/cc/30/r-001', set: 'R', spec_set: 'r', harness: 'claude-code', arm: 'native', rung: 30, order: 4, duration_s: 90.5, gap_s: 12.25, meter_key: 'k1' });
  });

  test('the grader INFRA stands and the trial is not scored', () => {
    const graded = { ...outcomes, reward: 0, infra: { code: 'HE-MCP-001', detail: 'github not connected' } };
    const row = buildRow({ ...base, outcomes: graded, usage: null, meter: null });
    expect(row.infra).toEqual({ code: 'HE-MCP-001', detail: 'github not connected', source: 'grader' });
    expect(row.reward).toBeNull();
    expect(row.usage).toBeNull();
  });

  test('a lease refusal becomes runner INFRA inside outcomes, so the analysis leaves the trial out', () => {
    const u = newUsage();
    addUsage(u, line({ outcome: 'refused', status: 402, reason: 'lease mcp:a has $0.01 left; the request reserves $1.28' }));
    expect(leaseRefusal(line({ outcome: 'refused', status: 402, reason: 'unpriced request refused: no price' }))).toBe(false);
    const row = buildRow({ ...base, outcomes: { ...outcomes, reward: 0, right_tool: false }, usage: u, meter: { usd: 0, requests: 1, unpriced: 0, byModel: {} } });
    expect(row.infra?.code).toBe('HE-MCP-042');
    expect(row.infra?.source).toBe('runner');
    expect(row.outcomes?.infra?.code).toBe('HE-MCP-042');
    expect(row.reward).toBeNull();
  });

  test('no verdict, no trial, an undrained meter and a provider failure are runner INFRA', () => {
    expect(runnerInfra({ result: null, outcomes: null, meter: null, usage: null, trialDirFound: false })?.code).toBe('HE-MCP-040');
    expect(runnerInfra({ result: { exception_info: { exception_type: 'RuntimeError', exception_message: 'HE-FRONTIER-003 bind failed' } }, outcomes: null, meter: null, usage: null, trialDirFound: true })?.detail).toContain('HE-FRONTIER-003');
    expect(runnerInfra({ result: {}, outcomes: null, meter: null, usage: null, trialDirFound: true })?.code).toBe('HE-MCP-041');
    expect(runnerInfra({ result: {}, outcomes, meter: { usd: 1, requests: 1, unpriced: 0, undrained: 1, byModel: {} }, usage: null, trialDirFound: true })?.code).toBe('HE-MCP-043');
    expect(runnerInfra({ result: {}, outcomes, meter: { usd: 1, requests: 1, unpriced: 0, byModel: {}, upstream: { statuses: { '529': 1 }, failed: 0, unparseable: 0 } }, usage: null, trialDirFound: true })?.code).toBe('HE-MCP-044');
    expect(runnerInfra({ result: { exception_info: { exception_type: 'AgentTimeoutError' } }, outcomes, meter: null, usage: null, trialDirFound: true })).toBeNull();
  });

  test('rows append once per trial and read back', () => {
    const path = join(tmp(), 'trials.jsonl');
    const row = buildRow({ ...base, outcomes, usage: null, meter: null });
    appendRow(path, row);
    expect(() => appendRow(path, row)).toThrow('HE-MCP-045');
    appendRow(path, { ...row, trial_id: 'run/cc/30/r-002' });
    expect(readRows(path).map((r) => r.trial_id)).toEqual(['run/cc/30/r-001', 'run/cc/30/r-002']);
  });

  test('the usage reader sums lines per key as the log grows, holding a half-written line', () => {
    const path = join(tmp(), 'usage.ndjson');
    const r = new UsageReader(path);
    expect(r.get('k1')).toBeNull();
    const a = JSON.stringify(line({ input_tokens: 10, actual_usd: 0.5 }));
    const b = JSON.stringify(line({ key: 'k2', input_tokens: 7 }));
    writeFileSync(path, a + '\n' + b.slice(0, 20));
    expect(r.get('k1')?.input_tokens).toBe(10);
    expect(r.get('k2')).toBeNull();
    writeFileSync(path, a + '\n' + b + '\n' + a + '\n');
    expect(r.get('k2')?.input_tokens).toBe(7);
    expect(r.get('k1')).toMatchObject({ requests: 2, input_tokens: 20, line_usd: 1 });
  });
});

describe('key scan', () => {
  test('names files with key-shaped text or an exact value, never the text itself', () => {
    const dir = tmp();
    const fake = 'sk-' + 'ant-' + 'a'.repeat(30);
    writeFileSync(join(dir, 'a.log'), 'header ' + fake + ' trailer');
    writeFileSync(join(dir, 'b.json'), '{"value": "the-canary-value-123"}');
    writeFileSync(join(dir, 'c.txt'), 'nothing here; Bearer sk-trial-placeholder-value-xx');
    const s = scanForKeys(dir, { FAKE_KEY: 'the-canary-value-123', SHORT: 'abc' });
    expect(s.files).toBe(3);
    expect(s.patterns.anthropic).toEqual(['a.log']);
    expect(Object.values(s.patterns).flat().every((f) => f === 'a.log')).toBe(true);
    expect(s.values).toEqual({ FAKE_KEY: ['b.json'] });
    expect(JSON.stringify(s)).not.toContain('aaaaaaaaaa');
  });
});
