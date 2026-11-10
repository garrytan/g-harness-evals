#!/usr/bin/env bun
// GST-1514 Amendment 3, part 2: grade one QM edition shard's trials with the plan judges, on that shard's own lease.
//
//   bun harnesses/qm/gstack/judge-shard.ts --results <shard results dir> --run-id <driver run id> --lease-usd <n>
//       --keys <keys.json> --tasks <tasks.json> [--judges primary,secondary] [--turns <turns.jsonl>] [--out-prefix <p>]
//       [--upstream <provider>=<url> ...]
//
// It runs after the driver (s1e-probe.ts) has exited. It starts the metering proxy on <results>/ledger.sqlite with the
// driver's run id, the shard's lease and 128,000 output tokens, which reopens the driver's open lease (BudgetRun.openLease;
// the driver's proxy stop leaves it open) and appends to the same proxy-usage.ndjson. The proxy allows only the chosen
// judges' models. Each judge gets its own slot, usage key judge-<role>:<run id> and token, and runs the frozen
// edition-grade.ts once under env -i with only PATH, HOME, the proxy URL and the token:
//   primary    plan-judge-opus.ts  -> <results>/<prefix>grades.jsonl,           judgements in <prefix>judge-primary.ndjson
//   secondary  plan-judge-sol.ts   -> <results>/<prefix>grades-secondary.jsonl, judgements in <prefix>judge-secondary.ndjson
// <prefix>judge-shard.json records each judge's id, exit code, calls and spend from the usage log.
//
// Refused before any call: a ledger without an open lease of that run id at that amount, an output file that already
// exists, an unknown judge. The primary runs first; if it fails, the secondary does not run (a plan still ungraded stops
// grading for the shard until a named repair). Exit 0 when every judge graded every turn, 5 when the primary failed, 6
// when only the secondary failed, 2 for a refusal. --upstream (capture mode, fake upstreams, dummy keys) is for keyless tests.
import { Database } from 'bun:sqlite';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RunProxy, summarizeUsage } from '../../../runner/trial/proxy.ts';
import { modelId, roleId, ROLES, type Role } from './plan-judge.ts';

const ROOT = resolve(import.meta.dir, '..', '..', '..');
const JUDGES: Record<'primary' | 'secondary', { module: string; out: string; log: string; urlVar: string; keyVar: string }> = {
  primary: { module: 'harnesses/qm/gstack/plan-judge-opus.ts', out: 'grades.jsonl', log: 'judge-primary.ndjson', urlVar: 'ANTHROPIC_BASE_URL', keyVar: 'ANTHROPIC_API_KEY' },
  secondary: { module: 'harnesses/qm/gstack/plan-judge-sol.ts', out: 'grades-secondary.jsonl', log: 'judge-secondary.ndjson', urlVar: 'OPENAI_BASE_URL', keyVar: 'OPENAI_API_KEY' },
};
export const MAX_OUTPUT_TOKENS = 128_000;

export function openLeaseProblem(ledger: string, runId: string, leaseUsd: number): string | null {
  if (!existsSync(ledger)) return ledger + ' does not exist; the judges only reopen the driver lease';
  const db = new Database(ledger, { readonly: true });
  try {
    const run = db.query('SELECT budget_usd, finished_at FROM runs WHERE run_id = ?').get(runId) as { budget_usd: number; finished_at: string | null } | null;
    if (!run) return ledger + ' holds no lease ' + runId;
    if (run.finished_at) return 'lease ' + runId + ' was closed at ' + run.finished_at;
    if (Math.abs(run.budget_usd - leaseUsd) > 1e-9) return 'lease ' + runId + ' is $' + run.budget_usd + ', not $' + leaseUsd;
    return null;
  } finally { db.close(); }
}

export async function main(argv: string[]): Promise<number> {
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const fail = (m: string) => { console.error('judge-shard: refused: ' + m); return 2; };
  const results = flag('--results') && resolve(flag('--results')!), runId = flag('--run-id'), leaseUsd = Number(flag('--lease-usd'));
  const keys = flag('--keys') && resolve(flag('--keys')!), tasks = flag('--tasks') && resolve(flag('--tasks')!);
  if (!results || !runId || !keys || !tasks || !(leaseUsd > 0)) return fail('usage: --results <dir> --run-id <id> --lease-usd <n> --keys <keys.json> --tasks <tasks.json> [--judges primary,secondary] [--turns <file>] [--out-prefix <p>]');
  const judges = (flag('--judges') ?? 'primary,secondary').split(',') as Array<'primary' | 'secondary'>;
  if (!judges.length || judges.some((j) => !(j in JUDGES)) || new Set(judges).size !== judges.length) return fail('--judges takes primary, secondary or both');
  if (judges[0] !== 'primary' && judges.includes('primary')) return fail('the primary runs first');
  const prefix = flag('--out-prefix') ?? '';
  if (!/^[A-Za-z0-9._-]*$/.test(prefix)) return fail('--out-prefix takes letters, digits, dot, dash and underscore');
  const turns = resolve(flag('--turns') ?? join(results, 'turns.jsonl'));
  for (const f of [turns, keys, tasks]) if (!existsSync(f)) return fail(f + ' does not exist');
  for (const j of judges) for (const f of [JUDGES[j].out, JUDGES[j].log]) if (existsSync(join(results, prefix + f))) return fail(join(results, prefix + f) + ' already exists');
  if (existsSync(join(results, prefix + 'judge-shard.json'))) return fail(join(results, prefix + 'judge-shard.json') + ' already exists');
  const ledger = join(results, 'ledger.sqlite');
  const leaseBad = openLeaseProblem(ledger, runId, leaseUsd);
  if (leaseBad) return fail(leaseBad);
  const upstream = Object.fromEntries(argv.flatMap((a, i) => (argv[i - 1] === '--upstream' ? [a.split('=', 2) as [string, string]] : [])));

  process.chdir(ROOT);
  const roles = judges.map((j) => ROLES[j as Role]);
  const proxy = await RunProxy.start({ runId, runDir: results, ledgerPath: ledger, leaseUsd, allowModels: roles.map(modelId), maxOutputTokens: MAX_OUTPUT_TOKENS, reachableFromContainers: false, ...(Object.keys(upstream).length ? { capture: { upstream, dns: null } } : {}) });
  const record: Record<string, unknown> = { run_id: runId, lease_usd: leaseUsd, turns, judges: {} as Record<string, unknown>, started_at: new Date().toISOString() };
  let code = 0;
  try {
    for (const j of judges) {
      const spec = ROLES[j as Role], cfg = JUDGES[j];
      const slot = 'judge-' + j, key = 'judge-' + j + ':' + runId, token = key + '.' + randomBytes(16).toString('hex');
      await proxy.bind(slot, key, token, [modelId(spec)]);
      const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', [cfg.urlVar]: proxy.baseUrlFor(slot, spec.provider, false), [cfg.keyVar]: token, PLAN_JUDGE_LOG: join(results, prefix + cfg.log) };
      const p = Bun.spawn([process.execPath, 'harnesses/qm/gstack/edition-grade.ts', '--turns', turns, '--keys', keys, '--tasks', tasks, '--judge', cfg.module, '--out', join(results, prefix + cfg.out)], { cwd: ROOT, env, stdout: 'inherit', stderr: 'inherit' });
      const exit = await p.exited;
      const lines = proxy.usageLines(key);
      const meter = await proxy.finalize(key).catch(() => null);
      await proxy.unbind(slot);
      const usd = lines.reduce((s, l) => s + (l.actual_usd ?? (l.charged_reservation ? l.reserved_usd ?? 0 : 0)), 0);
      (record.judges as Record<string, unknown>)[j] = { judge: roleId(spec), model: modelId(spec), module: cfg.module, out: prefix + cfg.out, exit, calls: lines.length, usd, usage: meter ? summarizeUsage(key, meter, lines).usage : null };
      console.log('judge-shard: ' + j + ' (' + roleId(spec) + ') exited ' + exit + ' after ' + lines.length + ' metered calls, $' + usd.toFixed(6));
      if (exit !== 0) { code = j === 'primary' ? 5 : 6; if (j === 'primary') break; }
    }
  } finally {
    await proxy.stop();
    record.ended_at = new Date().toISOString();
    record.exit = code;
    writeFileSync(join(results, prefix + 'judge-shard.json'), JSON.stringify(record, null, 2) + '\n');
  }
  return code;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
