#!/usr/bin/env bun
// The check before a counted launch (docs/cost-projection.md): refuses a shard whose plan would pass its spend stop, a shard
// holding a cell with no pilot price, and a shard whose providers will not answer.
//
//   bun scripts/launch-preflight.ts <plan folder> (--manifest <fanout.json> [--shard <name>] | --cells a,b [--lease-usd <n>])
//     --dest <shard results root> --ledger <ledger.sqlite> [--ledger ...] --pilot <results dir> [--pilot ...]
//     [--results <counted results dir> ...] [--plan-file <prereg json> ...] [--map <pilot cell>=<plan cell> ...]
//     [--stop <usd>] [--own-usd <n>] [--also <provider:model> ...] [--gemini-cli-route native|openrouter-fallback] [--override "<reason>" --override-by <thread code>]
//
// 1. The plan-cost projection over the whole plan (scripts/plan-cost.ts): refused when a shard cell is UNPRICED
//    (HE-BUDGET-006) or the projected total passes the stop (HE-BUDGET-005).
// 2. One tiny metered request per (provider, model) the shard calls, its cells' utility models and any --also, through the
//    ledger guard on <dest>/preflight-ledger.sqlite (runner/cost/provider-probe.ts), and OpenRouter's key limit against the
//    shard's lease: refused on HE-PROVIDER-001 to 005. On Gemini CLI's openrouter-fallback route (the manifest's options after
//    "--" or the shard's args, or --gemini-cli-route) a google:<model> is checked as openrouter:google/<model>, the route the
//    shard's calls take, so the OpenRouter key and credit are what is checked.
// 3. <dest>/launch-preflight.json holds the verdict, the commit it vouches for (scripts/ubicloud/fanout.sh launches a counted
//    shard only on a pass or override at the manifest's commit from the last hour): with --manifest, the manifest's commit when
//    the plan folder and every --plan-file match it in the repository that holds them, so a run pinned before this script
//    changed is checked from a newer checkout (an untracked file there counts as a difference, and so does an ignored prereg*.json,
//    PREREGISTRATION.md or --plan-file, the files the plan is read from; other ignored files, such as results, do not), and none when they differ; without --manifest, this checkout's HEAD. It also holds that HEAD (tool_commit), whether this
//    checkout had no uncommitted or untracked change (tool_clean), the projection, every probe answer (status and error type only), the
//    probe spend and any override. An override needs --override and --override-by, prints OVERRIDE lines and appends one
//    line to <dest>/launch-overrides.jsonl; both files travel with the shard's results.
// Exit 0 pass (or overridden), 3 refused, 2 bad input (never overridable).
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join, relative, resolve } from 'node:path';
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
  /** Gemini CLI's route to google: models (vm-run.sh --gemini-cli-route); with --manifest, the one its options or the shard's
   *  args decide, and a differing flag is bad input. */
  geminiRoute?: 'native' | 'openrouter-fallback';
  probe: Omit<ProbeOptions, 'ledgerPath' | 'leaseUsd'>;
}

export interface PreflightResult { exit: 0 | 3; lines: string[]; receipt: Record<string, unknown> }

/** The shard's cells and lease: from a fanout.sh manifest (one named shard, or every shard in it) or from --cells. */
function shardOf(o: PreflightOptions): { name: string; cells: string[]; lease_usd: number | null; gemini_cli_route: string; members: Array<{ name: string; cells: string[] }> } {
  if (o.manifest) {
    if (!existsSync(o.manifest)) throw new RunnerError('HE-RUN-002', `manifest ${o.manifest} does not exist`);
    const m = JSON.parse(readFileSync(o.manifest, 'utf8')) as { options?: string[]; shards?: Array<{ name: string; cells: string | string[]; lease_usd?: number; args?: string[] }> };
    const shards = (m.shards ?? []).filter(s => !o.shard || s.name === o.shard);
    if (!shards.length) throw new RunnerError('HE-RUN-002', o.shard ? `manifest ${o.manifest} has no shard ${o.shard}` : `manifest ${o.manifest} has no shards`);
    const members = shards.map(s => ({ name: s.name, cells: (Array.isArray(s.cells) ? s.cells : s.cells.split(',')).map(c => c.trim()).filter(Boolean) }));
    const cells = members.flatMap(s => s.cells);
    const leases = shards.map(s => s.lease_usd);
    const opts = m.options ?? [];
    const routes = new Set(shards.map(s => {
      const extra = [...(opts.includes('--') ? opts.slice(opts.indexOf('--') + 1) : []), ...(s.args ?? [])];
      const i = extra.lastIndexOf('--gemini-cli-route');
      return i >= 0 ? extra[i + 1] ?? '' : 'native';
    }));
    if (o.geminiRoute && !(routes.size === 1 && routes.has(o.geminiRoute))) throw new RunnerError('HE-RUN-002', `--gemini-cli-route ${o.geminiRoute} disagrees with the manifest, whose shards run ${[...routes].join(', ')} (native unless options after "--" or a shard's args name a route); drop the flag or fix the manifest`);
    if (routes.size > 1) throw new RunnerError('HE-RUN-002', `the shards checked together name different --gemini-cli-route values (${[...routes].join(', ')}); check each with --shard`);
    return { name: shards.map(s => s.name).join(','), cells, lease_usd: leases.every(l => typeof l === 'number') ? leases.reduce((a, b) => a! + b!, 0)! : o.leaseUsd, gemini_cli_route: [...routes][0]!, members };
  }
  if (!o.cells.length) throw new RunnerError('HE-RUN-002', 'name the shard: --manifest <fanout.json> [--shard <name>], or --cells a,b');
  return { name: 'cells', cells: o.cells, lease_usd: o.leaseUsd, gemini_cli_route: o.geminiRoute ?? 'native', members: [] };
}

/** The commit the receipt vouches for: with --manifest, the manifest's when every plan file read here matches it and none
 *  otherwise, so fanout.sh refuses the receipt; without one, this checkout's HEAD. */
function receiptCommit(o: PreflightOptions, tool: string | null): { commit: string | null; line: string | null } {
  const target = o.manifest ? (JSON.parse(readFileSync(o.manifest, 'utf8')) as { commit?: unknown }).commit : undefined;
  if (typeof target !== 'string' || !target) return { commit: tool, line: null };
  const git = (cwd: string, ...a: string[]) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
  const root = git(o.folder, 'rev-parse', '--show-toplevel').stdout?.trim();
  const full = root ? git(root, 'rev-parse', '--verify', '--quiet', target + '^{commit}').stdout?.trim() : '';
  const own = `COMMIT: none, so fanout.sh refuses this receipt for the manifest's commit ${target.slice(0, 12)} (this script ran at ${tool?.slice(0, 12) ?? 'unknown'}): `;
  if (!root || !full) return { commit: null, line: own + `that commit is not in the repository holding ${o.folder}` };
  const paths = [o.folder, ...o.planFiles].map(p => relative(root, resolve(p)));
  if (paths.some(p => p.startsWith('..'))) return { commit: null, line: own + 'a --plan-file is outside the repository holding the plan folder' };
  const changed = git(root, 'diff', '--quiet', full, '--', ...paths).status !== 0 || git(root, 'ls-files', '--others', '--exclude-standard', '--', ...paths).stdout?.trim()
    || git(root, 'ls-files', '--others', '--', join(paths[0]!, 'prereg*.json'), join(paths[0]!, 'PREREGISTRATION.md'), ...paths.slice(1)).stdout?.trim();
  if (changed) return { commit: null, line: own + 'the plan folder or a --plan-file differs from that commit' };
  return { commit: full, line: `COMMIT: ${full} (the manifest's; the plan files read here match it; this script ran at ${tool?.slice(0, 12) ?? 'unknown'})` };
}

export async function preflight(o: PreflightOptions): Promise<PreflightResult> {
  if (!o.ledgers.length) throw new RunnerError('HE-BUDGET-004', 'pass every pilot and counted ledger with --ledger, so the spend so far is counted');
  if (Boolean(o.override?.reason) !== Boolean(o.override?.by)) throw new RunnerError('HE-RUN-002', 'an override needs both --override "<reason>" and --override-by <thread code>');
  const shard = shardOf(o);
  if (shard.gemini_cli_route !== 'native' && shard.gemini_cli_route !== 'openrouter-fallback') throw new RunnerError('HE-RUN-002', `--gemini-cli-route is native or openrouter-fallback, not ${JSON.stringify(shard.gemini_cli_route)}`);
  const cost = planCost({ folder: o.folder, pilot: o.pilot, results: o.results, ledgers: o.ledgers, planFiles: o.planFiles, map: o.map, stop: o.stop, own: o.own });
  const byId = new Map(cost.plan.cells.map(c => [c.id, c]));
  const missing = shard.cells.filter(c => !byId.has(c));
  for (const m of shard.members) {
    const planned = cost.plan.shards.find(s => s.name === m.name);
    if (planned && [...planned.cells].sort().join(',') !== [...m.cells].sort().join(',')) throw new RunnerError('HE-RUN-002', `manifest shard ${m.name} lists cells ${m.cells.join(',')}, but the plan's shard ${m.name} runs ${planned.cells.join(',')}, and Harbor runs the plan's; fix the manifest`);
  }
  if (missing.length) throw new RunnerError('HE-RUN-002', `shard cell(s) ${missing.join(', ')} are not in the plan ${cost.plan.run_id}`);
  const lines = [`PREFLIGHT: ${cost.plan.run_id} shard=${shard.name} cells=${shard.cells.join(',')} lease=${money(shard.lease_usd)}`, ...cost.lines.filter(l => !l.startsWith('VERDICT:') && !l.startsWith('NEXT:'))];
  const refusals: string[] = [];
  const p = cost.projection;
  const unpricedHere = shard.cells.filter(c => p.unpriced.includes(c));
  if (unpricedHere.length) refusals.push(`HE-BUDGET-006 ${unpricedHere.join(', ')} ${unpricedHere.length === 1 ? 'has' : 'have'} no pilot price (fewer than 5 scored pilot trials); next: pilot each under its pilot cap and pass the results with --pilot`);
  if (p.over_stop) refusals.push(`HE-BUDGET-005 projected total ${money(p.total_usd)}${p.lower_bound ? ' (a lower bound)' : ''} = spent ${money(p.spent_usd + p.vm_spent_usd + (p.own_usd ?? 0))} + remaining ${money(p.remaining_usd + p.vm_remaining_usd)}, which passes the stop ${money(p.stop_usd)}; next: shrink the plan or raise the stop by a dated amendment with the owner's approval`);
  else if (p.lower_bound) lines.push(`WARN: the total leaves out unpriced cells outside this shard (${p.unpriced.filter(c => !shard.cells.includes(c)).join(', ')}); each is refused at its own launch until priced`);
  const via = shard.gemini_cli_route === 'openrouter-fallback';
  const models = shard.cells.flatMap(c => [byId.get(c)!.model, ...byId.get(c)!.also]).concat(o.also)
    .map(m => (via && m.startsWith('google:') ? 'openrouter:google/' + m.slice('google:'.length) : m));
  if (via) lines.push('ROUTE: --gemini-cli-route openrouter-fallback, so each google: model is checked through OpenRouter as google/<model>, the way the shard calls it');
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
  const tool = spawnSync('git', ['-C', import.meta.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || null;
  const status = spawnSync('git', ['-C', import.meta.dir, 'status', '--porcelain'], { encoding: 'utf8' });
  const toolClean = status.status === 0 ? status.stdout.trim() === '' : null;
  const { commit, line } = receiptCommit(o, tool);
  if (line) lines.push(line);
  const verdict = refusals.length === 0 ? 'pass' : overridden ? 'overridden' : 'refused';
  lines.push(`VERDICT: ${verdict.toUpperCase()}`);
  const receipt = { schema: 'launch-preflight/1', at, commit, tool_commit: tool, tool_clean: toolClean, run_id: cost.plan.run_id, shard: { name: shard.name, cells: shard.cells, lease_usd: shard.lease_usd, gemini_cli_route: shard.gemini_cli_route }, verdict, refusals, override, projection: cost.receipt, probes };
  writeFileSync(join(o.dest, 'launch-preflight.json'), JSON.stringify(receipt, null, 2) + '\n');
  lines.push(`RECEIPT: ${join(o.dest, 'launch-preflight.json')}`);
  return { exit: verdict === 'refused' ? 3 : 0, lines, receipt };
}

export const PREFLIGHT_USAGE = 'usage: bun scripts/launch-preflight.ts <plan folder> (--manifest <fanout.json> [--shard <name>] | --cells a,b [--lease-usd <n>]) --dest <shard results root> --ledger <ledger.sqlite> [--ledger ...] --pilot <results dir> [--pilot ...] [--results <dir> ...] [--plan-file <file> ...] [--map a=b ...] [--stop <usd>] [--own-usd <n>] [--also <provider:model> ...] [--gemini-cli-route native|openrouter-fallback] [--override "<reason>" --override-by <thread code>]';

if (import.meta.main) {
  try {
    const a = parseArgs(process.argv.slice(2), ['--pilot', '--results', '--ledger', '--plan-file', '--map', '--also'], ['--manifest', '--shard', '--cells', '--lease-usd', '--dest', '--stop', '--own-usd', '--override', '--override-by', '--gemini-cli-route']);
    if (a.positional.length !== 1 || !a.one['--dest']) throw new RunnerError('HE-RUN-002', PREFLIGHT_USAGE);
    const reason = a.one['--override']?.trim(), by = a.one['--override-by']?.trim();
    const r = await preflight({
      folder: a.positional[0]!, manifest: a.one['--manifest'] ?? null, shard: a.one['--shard'] ?? null, cells: (a.one['--cells'] ?? '').split(',').map(c => c.trim()).filter(Boolean),
      leaseUsd: positiveUsd(a.one['--lease-usd'], '--lease-usd'), dest: a.one['--dest'], ledgers: a.many['--ledger']!, pilot: a.many['--pilot']!, results: a.many['--results']!,
      planFiles: a.many['--plan-file']!, map: parseMap(a.many['--map']!), stop: positiveUsd(a.one['--stop'], '--stop'), own: positiveUsd(a.one['--own-usd'], '--own-usd'),
      also: a.many['--also']!, geminiRoute: a.one['--gemini-cli-route'] as PreflightOptions['geminiRoute'], override: reason || by ? { reason: reason ?? '', by: by ?? '' } : null, probe: { env: process.env },
    });
    console.log(r.lines.join('\n'));
    process.exit(r.exit);
  } catch (e) {
    if (e instanceof RunnerError) { console.error(e.message); process.exit(2); }
    throw e;
  }
}
