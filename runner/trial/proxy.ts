// One metering proxy per run (runner/proxy/metering-proxy.ts in lease mode), started by the runner with a
// control token so a container can never move charges. Per trial the runner binds a slot (the path segment
// the container's base URL carries) to the trial key sk-trial-<id> and finalizes the key afterwards. The
// proxy is the only process that sees a provider key; this module passes the runner's environment through
// and never reads, prints or writes the key itself.

import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Meter, UsageLine } from '../proxy/metering-proxy.ts';
import type { TrialUsage } from '../contracts.ts';
import { RunnerError } from '../errors.ts';
import { CONTAINER_HOST } from './world.ts';

export interface RunProxyOptions {
  runId: string;
  runDir: string;
  ledgerPath: string;
  leaseUsd: number;
  allowModels: string[];
  maxOutputTokens?: number | null;
  /** Bind every interface so containers reach it through host.docker.internal. */
  reachableFromContainers: boolean;
  /** Environment for the proxy process. Defaults to this process's environment, which is where the provider keys live. */
  env?: Record<string, string | undefined>;
  /** Close a lease left open in the ledger by an earlier run id (the proxy's --new-run). */
  newRun?: boolean;
  startTimeoutMs?: number;
}

export const trialKey = (trialId: string) => `sk-trial-${trialId}`;
/** A trial id as a path segment and a container name: letters, digits, dot, underscore, dash. */
export const trialSlug = (trialId: string) => trialId.replace(/[^A-Za-z0-9._-]+/g, '-');

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port!;
  probe.stop(true);
  return port;
}

export class RunProxy {
  private constructor(
    private readonly proc: ReturnType<typeof Bun.spawn>,
    readonly port: number,
    private readonly controlToken: string,
    readonly usageLog: string,
    readonly ledgerPath: string,
    private readonly reachableFromContainers: boolean,
  ) {}

  static async start(opts: RunProxyOptions): Promise<RunProxy> {
    mkdirSync(opts.runDir, { recursive: true });
    const port = await freePort();
    const host = opts.reachableFromContainers ? '0.0.0.0' : '127.0.0.1';
    const controlToken = randomBytes(16).toString('base64url');
    const usageLog = join(opts.runDir, 'proxy-usage.ndjson');
    const logFd = openSync(join(opts.runDir, 'proxy.log'), 'a');
    const args = [process.execPath, join('runner', 'proxy', 'metering-proxy.ts'), '--listen', `${host}:${port}`,
      '--budget-ledger', opts.ledgerPath, '--lease-usd', String(opts.leaseUsd), '--run-id', opts.runId,
      '--usage-log', usageLog, '--control-token', controlToken];
    if (opts.allowModels.length) args.push('--allow-models', opts.allowModels.join(','));
    if (opts.maxOutputTokens) args.push('--max-output-tokens', String(opts.maxOutputTokens));
    if (opts.newRun) args.push('--new-run');
    const proc = Bun.spawn(args, { stdin: 'ignore', stdout: logFd, stderr: logFd, env: (opts.env ?? process.env) as Record<string, string> });
    const deadline = Date.now() + (opts.startTimeoutMs ?? 20_000);
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) break;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/__proxy/status`);
        if (res.ok) return new RunProxy(proc, port, controlToken, usageLog, opts.ledgerPath, opts.reachableFromContainers);
      } catch { /* not listening yet */ }
      await Bun.sleep(50);
    }
    proc.kill('SIGKILL');
    await proc.exited;
    const tail = existsSync(join(opts.runDir, 'proxy.log')) ? readFileSync(join(opts.runDir, 'proxy.log'), 'utf8').trim().split('\n').slice(-3).join(' | ') : '';
    throw new RunnerError('HE-PROXY-003', `the metering proxy did not start on ${host}:${port} (ledger ${opts.ledgerPath}, lease $${opts.leaseUsd}): ${tail}; fix: read ${join(opts.runDir, 'proxy.log')}; a lease left open by another run id needs --new-lease`);
  }

  /** The base URL a harness gets: <origin>/<slot>/<provider>; the harness appends its usual path. */
  baseUrlFor(slot: string, provider: string): string {
    const host = this.reachableFromContainers ? CONTAINER_HOST : '127.0.0.1';
    return `http://${host}:${this.port}/${slot}/${provider}`;
  }

  private async control(path: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`http://127.0.0.1:${this.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': this.controlToken }, body: JSON.stringify(body) });
    } catch (e) { throw new RunnerError('HE-PROXY-003', `metering proxy ${path} unreachable: ${(e as Error).message}`); }
    if (!res.ok) throw new RunnerError('HE-PROXY-003', `metering proxy ${path} answered HTTP ${res.status}`);
    return res.json();
  }

  bind(slot: string, key: string) { return this.control('/__proxy/bind', { slot, key }); }
  unbind(slot: string) { return this.control('/__proxy/unbind', { slot }); }
  finalize(key: string, timeoutMs = 30_000): Promise<Meter> { return this.control('/__proxy/finalize', { key, timeout_ms: timeoutMs }) as Promise<Meter>; }

  /** Every usage line the proxy wrote for a key, in order. */
  usageLines(key: string): UsageLine[] {
    if (!existsSync(this.usageLog)) return [];
    return readFileSync(this.usageLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as UsageLine).filter((l) => l.key === key);
  }

  async stop(): Promise<void> {
    if (this.proc.exitCode !== null) return;
    this.proc.kill('SIGTERM');
    const dead = await Promise.race([this.proc.exited.then(() => true), Bun.sleep(5_000).then(() => false)]);
    if (!dead) { this.proc.kill('SIGKILL'); await this.proc.exited; }
  }
}

/** A refusal the ledger issued because the lease or the program cap would be crossed (not an unpriced model or a bad route). */
export const isCapRefusal = (l: UsageLine) => l.outcome === 'refused' && /over its \$[0-9.]+ (budget|cap)|left of the \$[0-9.]+ program cap/.test(l.reason ?? '');

export function summarizeUsage(key: string, meter: Meter, lines: UsageLine[]): { usage: TrialUsage; cap_stop: boolean } {
  const forwarded = lines.filter((l) => l.outcome === 'forwarded');
  const usage: TrialUsage = {
    key,
    requests: meter.requests,
    refused: lines.filter((l) => l.outcome === 'refused').length,
    failed: lines.filter((l) => l.outcome === 'failed').length,
    usd: meter.usd,
    input_tokens: forwarded.reduce((a, l) => a + (l.input_tokens ?? 0), 0),
    output_tokens: forwarded.reduce((a, l) => a + (l.output_tokens ?? 0), 0),
    cached_tokens: forwarded.reduce((a, l) => a + (l.cached_tokens ?? 0), 0),
    unpriced: meter.unpriced,
    by_model: meter.byModel,
    upstream: meter.upstream ?? null,
  };
  return { usage, cap_stop: lines.some(isCapRefusal) };
}

/** reconcile.json: the proxy's meter against the sum of the usage lines it wrote for the key. Provider-side
 *  reconciliation (HE-PROXY-002, the >1% rule of methodology item 3) is not built; the file says so. */
export function reconcile(key: string, meter: Meter, lines: UsageLine[]) {
  const charged = lines.filter((l) => l.outcome === 'forwarded' || l.outcome === 'failed');
  const linesUsd = charged.reduce((a, l) => a + (l.actual_usd ?? 0), 0);
  const diff = Math.abs(linesUsd - meter.usd);
  return {
    key,
    meter: { requests: meter.requests, usd: meter.usd, unpriced: meter.unpriced, undrained: meter.undrained ?? 0 },
    usage_lines: { requests: charged.length, usd: linesUsd, refused: lines.length - charged.length },
    proxy_consistent: charged.length === meter.requests && diff < 1e-9 && !meter.undrained,
    provider_reconciliation: 'not performed: per-trial reconciliation against provider usage is the HE-PROXY-002 TODO (TODOS.md); until it lands this file only proves the proxy agrees with its own usage log',
  };
}
