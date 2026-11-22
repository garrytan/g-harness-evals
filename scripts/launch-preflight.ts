#!/usr/bin/env bun
// The check before a counted launch (docs/cost-projection.md): refuses a shard whose plan would pass its spend stop, a shard
// holding a cell with no pilot price, and a shard whose providers will not answer.
//
//   bun scripts/launch-preflight.ts <plan folder> (--manifest <fanout.json> [--shard <name>] | --cells a,b [--lease-usd <n>])
//     --dest <shard results root> --ledger <ledger.sqlite> [--ledger ...] --pilot <results dir> [--pilot ...]
//     [--results <counted results dir> ...] [--plan-file <prereg json> ...] [--map <pilot cell>=<plan cell> ...]
//     [--stop <usd>] [--own-usd <n>] [--also <provider:model> ...] [--override "<reason>" --override-by <thread code>]
//
// 1. The plan-cost projection over the whole plan (scripts/plan-cost.ts): refused when a shard cell is UNPRICED
//    (HE-BUDGET-006) or the projected total passes the stop (HE-BUDGET-005).
// 2. One tiny metered request per (provider, model) the shard calls, its cells' utility models and any --also, through the
//    ledger guard on <dest>/preflight-ledger.sqlite (runner/cost/provider-probe.ts), and OpenRouter's key limit against the
//    shard's lease: refused on HE-PROVIDER-001 to 005.
// 3. <dest>/launch-preflight.json holds the verdict, the projection, every probe answer (status and error type only), the
//    probe spend and any override. An override needs --override and --override-by, prints OVERRIDE lines and appends one
//    line to <dest>/launch-overrides.jsonl; both files travel with the shard's results.
// Exit 0 pass (or overridden), 3 refused, 2 bad input (never overridable).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { RunnerError } from '../runner/errors.ts';
import { money } from '../runner/cost/projection.ts';
import { probeTargets, runProbes, type ProbeOptions, type ProbeReport } from '../runner/cost/provider-probe.ts';
import { parseArgs, parseMap, planCost, positiveUsd } from './plan-cost.ts';

export interface PreflightOptions {
  folder: string;
  manifest: string | null;
  shard: string | null;
  cells: string[];
  leaseUsd: number | null;
  dest: string;
  ledgers: string[];
  pilot: string[];
  results: string[];
  planFiles: string[];
  map: Record<string, string>;
  stop: number | null;
  own: number | null;
  also: string[];
  override: { reason: string; by: string } | null;
  probe: Omit<ProbeOptions, 'ledgerPath' | 'leaseUsd'>;
}

export interface PreflightResult { exit: 0 | 3; lines: string[]; receipt: Record<string, unknown> }

/** The shard's cells and lease: from a fanout.sh manifest (one named shard, or every shard in it) or from --cells. */
function shardOf(o: PreflightOptions): { name: string; cells: string[]; lease_usd: number | null } {
  if (o.manifest) {
    if (!existsSync(o.manifest)) throw new RunnerError('HE-RUN-002', `manifest ${o.manifest} does not exist`);
    const m = JSON.parse(readFileSync(o.manifest, 'utf8')) as { shards?: Array<{ name: string; cells: string | string[]; lease_usd?: number }> };
    const shards = (m.shards ?? []).filter(s => !o.shard || s.name === o.shard);
    if (!shards.length) throw new RunnerError('HE-RUN-002', o.shard ? `manifest ${o.manifest} has no shard ${o.shard}` : `manifest ${o.manifest} has no shards`);
    const cells = shards.flatMap(s => (Array.isArray(s.cells) ? s.cells : s.cells.split(',')).map(c => c.trim()).filter(Boolean));
    const leases = shards.map(s => s.lease_usd);
    return { name: shards.map(s => s.name).join(','), cells, lease_usd: leases.every(l => typeof l === 'number') ? leases.reduce((a, b) => a! + b!, 0)! : o.leaseUsd };
  }
  if (!o.cells.length) throw new RunnerError('HE-RUN-002', 'name the shard: --manifest <fanout.json> [--shard <name>], or --cells a,b');
  return { name: 'cells', cells: o.cells, lease_usd: o.leaseUsd };
}

export async function preflight(o: PreflightOptions): Promise<PreflightResult> {
  if (!o.ledgers.length) throw new RunnerError('HE-BUDGET-004', 'pass every pilot and counted ledger with --ledger, so the spend so far is counted');
  if (Boolean(o.override?.reason) !== Boolean(o.override?.by)) throw new RunnerError('HE-RUN-002', 'an override needs both --override "<reason>" and --override-by <thread code>');
  const shard = shardOf(o);
  const cost = planCost({ folder: o.folder, pilot: o.pilot, results: o.results, ledgers: o.ledgers, planFiles: o.planFiles, map: o.map, stop: o.stop, own: o.own });
  const byId = new Map(cost.plan.cells.map(c => [c.id, c]));
  const missing = shard.cells.filter(c => !byId.has(c));
  if (missing.length) throw new RunnerError('HE-RUN-002', `shard cell(s) ${missing.join(', ')} are not in the plan ${cost.plan.run_id}`);
  const lines = [`PREFLIGHT: ${cost.plan.run_id} shard=${shard.name} cells=${shard.cells.join(',')} lease=${money(shard.lease_usd)}`, ...cost.lines.filter(l => !l.startsWith('VERDICT:') && !l.startsWith('NEXT:'))];
  const refusals: string[] = [];
  const p = cost.projection;
  const unpricedHere = shard.cells.filter(c => p.unpriced.includes(c));
  if (unpricedHere.length) refusals.push(`HE-BUDGET-006 ${unpricedHere.join(', ')} ${unpricedHere.length === 1 ? 'has' : 'have'} no pilot price (fewer than 5 scored pilot trials); next: pilot each under its pilot cap and pass the results with --pilot`);
  if (p.over_stop) refusals.push(`HE-BUDGET-005 projected total ${money(p.total_usd)}${p.lower_bound ? ' (a lower bound)' : ''} = spent ${money(p.spent_usd + p.vm_spent_usd + (p.own_usd ?? 0))} + remaining ${money(p.remaining_usd + p.vm_remaining_usd)}, which passes the stop ${money(p.stop_usd)}; next: shrink the plan or raise the stop by a dated amendment with the owner's approval`);
  else if (p.lower_bound) lines.push(`WARN: the total leaves out unpriced cells outside this shard (${p.unpriced.filter(c => !shard.cells.includes(c)).join(', ')}); each is refused at its own launch until priced`);
  const models = shard.cells.flatMap(c => [byId.get(c)!.model, ...byId.get(c)!.also]).concat(o.also);
  const targets = probeTargets(models);
  mkdirSync(o.dest, { recursive: true });
  const probes: ProbeReport = await runProbes(targets, { ...o.probe, ledgerPath: join(o.dest, 'preflight-ledger.sqlite'), leaseUsd: shard.lease_usd });
  for (const a of probes.answers) {
    lines.push(a.ok ? `PROBE: ok ${a.provider}:${a.model} status ${a.status}${a.attempts > 1 ? ' after one retry' : ''}` : `PROBE: refused ${a.reason}`);
    if (!a.ok) refusals.push(a.reason);
  }
  if (probes.key_limit) {
    lines.push(`PROBE: ${probes.key_limit.ok ? 'ok' : 'refused'} ${probes.key_limit.reason}`);
    if (!probes.key_limit.ok) refusals.push(probes.key_limit.reason);
  }
  lines.push(`PROBES: ${probes.answers.length} request target(s), spent ${money(probes.spent_usd)} under a ${money(probes.lease_usd)} lease, written to the ledger ${join(o.dest, 'preflight-ledger.sqlite')}`);
  for (const r of refusals) lines.push(`REFUSED: ${r}`);
  const overridden = refusals.length > 0 && o.override !== null;
  const at = new Date().toISOString();
  const override = overridden ? { reason: o.override!.reason, by: o.override!.by, user: userInfo().username, host: hostname(), at, refusals } : null;
  if (override) {
    appendFileSync(join(o.dest, 'launch-overrides.jsonl'), JSON.stringify({ run_id: cost.plan.run_id, shard: shard.name, ...override }) + '\n');
    lines.push(`OVERRIDE: by ${override.by} (${override.user}@${override.host}) at ${at}: ${override.reason}`);
    lines.push(`OVERRIDE: logged in ${join(o.dest, 'launch-overrides.jsonl')} and ${join(o.dest, 'launch-preflight.json')}`);
  } else if (refusals.length) {
    lines.push(`NEXT: fix each refusal and rerun; or, only with the coordinating agent's decision: the same command plus --override "<reason>" --override-by <thread code>`);
  }
  const verdict = refusals.length === 0 ? 'pass' : overridden ? 'overridden' : 'refused';
  lines.push(`VERDICT: ${verdict.toUpperCase()}`);
  const receipt = { schema: 'launch-preflight/1', at, run_id: cost.plan.run_id, shard, verdict, refusals, override, projection: cost.receipt, probes };
  writeFileSync(join(o.dest, 'launch-preflight.json'), JSON.stringify(receipt, null, 2) + '\n');
  lines.push(`RECEIPT: ${join(o.dest, 'launch-preflight.json')}`);
  return { exit: verdict === 'refused' ? 3 : 0, lines, receipt };
}

export const PREFLIGHT_USAGE = 'usage: bun scripts/launch-preflight.ts <plan folder> (--manifest <fanout.json> [--shard <name>] | --cells a,b [--lease-usd <n>]) --dest <shard results root> --ledger <ledger.sqlite> [--ledger ...] --pilot <results dir> [--pilot ...] [--results <dir> ...] [--plan-file <file> ...] [--map a=b ...] [--stop <usd>] [--own-usd <n>] [--also <provider:model> ...] [--override "<reason>" --override-by <thread code>]';

if (import.meta.main) {
  try {
    const a = parseArgs(process.argv.slice(2), ['--pilot', '--results', '--ledger', '--plan-file', '--map', '--also'], ['--manifest', '--shard', '--cells', '--lease-usd', '--dest', '--stop', '--own-usd', '--override', '--override-by']);
    if (a.positional.length !== 1 || !a.one['--dest']) throw new RunnerError('HE-RUN-002', PREFLIGHT_USAGE);
    const reason = a.one['--override']?.trim(), by = a.one['--override-by']?.trim();
    const r = await preflight({
      folder: a.positional[0]!, manifest: a.one['--manifest'] ?? null, shard: a.one['--shard'] ?? null, cells: (a.one['--cells'] ?? '').split(',').map(c => c.trim()).filter(Boolean),
      leaseUsd: positiveUsd(a.one['--lease-usd'], '--lease-usd'), dest: a.one['--dest'], ledgers: a.many['--ledger']!, pilot: a.many['--pilot']!, results: a.many['--results']!,
      planFiles: a.many['--plan-file']!, map: parseMap(a.many['--map']!), stop: positiveUsd(a.one['--stop'], '--stop'), own: positiveUsd(a.one['--own-usd'], '--own-usd'),
      also: a.many['--also']!, override: reason || by ? { reason: reason ?? '', by: by ?? '' } : null, probe: { env: process.env },
    });
    console.log(r.lines.join('\n'));
    process.exit(r.exit);
  } catch (e) {
    if (e instanceof RunnerError) { console.error(e.message); process.exit(2); }
    throw e;
  }
}
