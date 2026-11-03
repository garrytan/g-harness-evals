// One metering proxy per run (runner/proxy/metering-proxy.ts in lease mode), started by the runner with a
// control token so a container can never move charges. Per trial the runner binds a slot (the path segment
// the container's base URL carries) to the trial key trial-token:<id>, which the receipts meter under, together
// with a random per-trial token the harness must present as its API key, and finalizes the key afterwards.
// The proxy forwards nothing for an unbound slot or a wrong token. It listens on the loopback, or on the docker
// bridge gateway when containers must reach it, never on every interface (2026-10-28, after shard VMs with a
// public address ran it on 0.0.0.0). The proxy is the only process that sees a provider key; this module passes
// the runner's environment through and never reads, prints or writes the key itself.
//
// The install ladder: the gbrain sidecar's query embeddings go through its own slot (<slot>.gbrain, its own token) under the same trial key;
// summarizeUsage keeps /v1/embeddings lines out of the harness figures (requests, tokens, refused, failed) while usd stays
// the trial's total, and embeddingUsage reports them on their own (gbrain.embedding_usage in the trial record), so
// reconcile.json's invariant holds: harness requests plus embedding requests equal the meter's.
//
// Each trial slot is bound with its cell's models (the cell model and its utility_models, runner/run.ts cellModels) and
// the gbrain slot with its embedding model, so the proxy refuses another model on that slot although another cell of the run put
// it on the run-wide --allow-models, which stays the outer bound.
//
// A run of cells with network "internal" binds the proxy on the gateway of the run's internal docker network
// instead of the bridge gateway; containers still reach it as host.docker.internal, which the runner maps to that gateway.
//
// A run with an ablation cell starts the proxy with --ablation-log <run dir>/ablation.ndjson (outside every agent
// mount), and each trial slot of such a cell is bound with its map, map sha256 and layers. summarizeAblation reads the
// trial key's receipts into TrialRecord.ablation.

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Meter, UsageLine } from '../proxy/metering-proxy.ts';
import { HOUSEKEEPING_FAMILY, type AblationReceipt, type AblationSpec, type Wire } from '../proxy/ablate.ts';
import type { TrialAblation, TrialEmbeddingUsage, TrialUsage } from '../contracts.ts';
import { RunnerError } from '../errors.ts';
import { CONTAINER_HOST, listenHost } from './world.ts';
import { type CaptureConfig, captureProxyEnv } from './capture.ts';

export interface RunProxyOptions {
  runId: string;
  runDir: string;
  ledgerPath: string;
  leaseUsd: number;
  allowModels: string[];
  maxOutputTokens?: number | null;
  /** Bind the docker bridge gateway so containers reach it through host.docker.internal; otherwise the loopback. */
  reachableFromContainers: boolean;
  /** With reachableFromContainers, bind this gateway (the run's internal network) instead of the bridge gateway. */
  gatewayAddress?: string;
  /** Environment for the proxy process. Defaults to this process's environment, which is where the provider keys live. */
  env?: Record<string, string | undefined>;
  /** Close a lease left open in the ledger by an earlier run id (the proxy's --new-run). */
  newRun?: boolean;
  /** Capture mode: forward to these fake upstreams (the proxy's --upstream) and give the proxy dummy provider keys
   *  instead of `env`'s, keeping only PATH and HOME from it (runner/trial/capture.ts). */
  capture?: CaptureConfig;
  startTimeoutMs?: number;
  /** Start the proxy with --ablation-log <runDir>/ablation.ndjson so trial slots can be bound with a layer map. */
  ablationLog?: boolean;
}

/** The per-trial key: what the proxy meters a trial under and what the receipts record as `meter_id`. Deterministic
 *  from the trial id, never a credential. The prefix is not a provider key shape, so no secret scanner reads it as a
 *  key (runs before 2026-10-26 used `sk-trial-<id>` under `key`). Until 2026-10-28 the harness also sent this key as
 *  its API key; it now sends trialToken(), which the proxy checks against the slot's binding. */
export const TRIAL_TOKEN_PREFIX = 'trial-token:';
export const trialKey = (trialId: string) => `${TRIAL_TOKEN_PREFIX}${trialId}`;
/** The per-trial secret the harness presents as its API key: the trial key plus 128 random bits in hex (no provider key
 *  shape, so the publish audit's allowlist still holds if a harness log echoes it). Fresh per trial; it lands only in the
 *  harness's environment (and the compose override under the trial directory, which the results .gitignore excludes) and is
 *  dead once the slot is unbound. */
export const trialToken = (trialId: string) => `${trialKey(trialId)}.${randomBytes(16).toString('hex')}`;
/** The proxy process environment: `opts.env` (default this process's), or in capture mode one built from scratch with
 *  only PATH, HOME and the dummy provider keys. */
export function proxyProcessEnv(opts: Pick<RunProxyOptions, 'env' | 'capture'>, parent: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  return opts.capture ? captureProxyEnv(opts.env ?? parent) : (opts.env ?? parent);
}

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
    readonly host: string,
    private readonly controlToken: string,
    readonly usageLog: string,
    readonly ledgerPath: string,
    private readonly reachableFromContainers: boolean,
    readonly ablationLog: string | null = null,
  ) {}

  /** The ablation log's size when each key was last bound, so a key's receipts are this attempt's only. */
  private readonly ablationFrom = new Map<string, number>();

  static async start(opts: RunProxyOptions): Promise<RunProxy> {
    mkdirSync(opts.runDir, { recursive: true });
    const port = await freePort();
    const host = listenHost(opts.reachableFromContainers, opts.gatewayAddress);
    const controlToken = randomBytes(16).toString('base64url');
    const usageLog = join(opts.runDir, 'proxy-usage.ndjson');
    const logFd = openSync(join(opts.runDir, 'proxy.log'), 'a');
    const args = [process.execPath, join('runner', 'proxy', 'metering-proxy.ts'), '--listen', `${host}:${port}`,
      '--budget-ledger', opts.ledgerPath, '--lease-usd', String(opts.leaseUsd), '--run-id', opts.runId,
      '--usage-log', usageLog, '--control-token', controlToken];
    if (opts.allowModels.length) args.push('--allow-models', opts.allowModels.join(','));
    if (opts.maxOutputTokens) args.push('--max-output-tokens', String(opts.maxOutputTokens));
    if (opts.newRun) args.push('--new-run');
    const ablationLog = opts.ablationLog ? join(opts.runDir, 'ablation.ndjson') : null;
    if (ablationLog) args.push('--ablation-log', ablationLog);
    for (const [provider, url] of Object.entries(opts.capture?.upstream ?? {})) args.push('--upstream', `${provider}=${url}`);
    const proc = Bun.spawn(args, { stdin: 'ignore', stdout: logFd, stderr: logFd, env: proxyProcessEnv(opts) as Record<string, string> });
    const deadline = Date.now() + (opts.startTimeoutMs ?? 20_000);
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) break;
      try {
        const res = await fetch(`http://${host}:${port}/__proxy/status`);
        if (res.ok) return new RunProxy(proc, port, host, controlToken, usageLog, opts.ledgerPath, opts.reachableFromContainers, ablationLog);
      } catch { /* not listening yet */ }
      await Bun.sleep(50);
    }
    proc.kill('SIGKILL');
    await proc.exited;
    const tail = existsSync(join(opts.runDir, 'proxy.log')) ? readFileSync(join(opts.runDir, 'proxy.log'), 'utf8').trim().split('\n').slice(-3).join(' | ') : '';
    throw new RunnerError('HE-PROXY-003', `the metering proxy did not start on ${host}:${port} (ledger ${opts.ledgerPath}, lease $${opts.leaseUsd}): ${tail}; fix: read ${join(opts.runDir, 'proxy.log')}; a lease left open by another run id needs --new-lease`);
  }

  /** The base URL a client gets: <origin>/<slot>/<provider>; the client appends its usual path. forContainer picks the
   *  host.docker.internal route (the default when the proxy binds the bridge gateway); a sidecar is always a container, a
   *  process-mode harness never is and gets the bind address, which this host owns. */
  baseUrlFor(slot: string, provider: string, forContainer: boolean = this.reachableFromContainers): string {
    if (forContainer && !this.reachableFromContainers) throw new RunnerError('HE-PROXY-003', `the metering proxy listens on the loopback only; a container cannot reach it for slot ${slot}`);
    const host = forContainer ? CONTAINER_HOST : this.host;
    return `http://${host}:${this.port}/${slot}/${provider}`;
  }

  private async control(path: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`http://${this.host}:${this.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': this.controlToken }, body: JSON.stringify(body) });
    } catch (e) { throw new RunnerError('HE-PROXY-003', `metering proxy ${path} unreachable: ${(e as Error).message}`); }
    if (!res.ok) throw new RunnerError('HE-PROXY-003', `metering proxy ${path} answered HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 400)}`);
    return res.json();
  }

  /** Charge the slot to `key`; with `token`, the proxy forwards only requests that present it; with `models` (provider:model
   *  ids), only requests for those models, inside the run-wide --allow-models; with `ablation`, the proxy
   *  checks the map's sha256 (a mismatch fails the bind) and cuts the layers out of the slot's requests. */
  bind(slot: string, key: string, token?: string, models?: string[], ablation?: AblationSpec) {
    if (ablation && this.ablationLog) this.ablationFrom.set(key, existsSync(this.ablationLog) ? statSync(this.ablationLog).size : 0);
    return this.control('/__proxy/bind', { slot, key, ...(token ? { token } : {}), ...(models ? { models } : {}), ...(ablation ? { ablation } : {}) });
  }
  unbind(slot: string) { return this.control('/__proxy/unbind', { slot }); }
  finalize(key: string, timeoutMs = 30_000): Promise<Meter> { return this.control('/__proxy/finalize', { key, timeout_ms: timeoutMs }) as Promise<Meter>; }

  /** Every layer-filter receipt the proxy wrote for a key since its last bind, in order. Only the log from that
   *  bind's offset is read, and a last line still being written (no newline yet) is left out. */
  ablationLines(key: string): AblationReceipt[] {
    if (!this.ablationLog || !existsSync(this.ablationLog)) return [];
    const fd = openSync(this.ablationLog, 'r');
    try {
      const from = this.ablationFrom.get(key) ?? 0;
      const buf = Buffer.alloc(Math.max(0, fstatSync(fd).size - from));
      readSync(fd, buf, 0, buf.length, from);
      const text = buf.toString('utf8');
      return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map((l) => JSON.parse(l) as AblationReceipt).filter((l) => l.key === key);
    } finally { closeSync(fd); }
  }

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

/** A usage line of the sidecar's query embeddings. */
export const isEmbeddingLine = (l: UsageLine) => l.route === '/v1/embeddings';

export function summarizeUsage(key: string, meter: Meter, lines: UsageLine[]): { usage: TrialUsage; cap_stop: boolean } {
  // The harness figures leave the embedding lines out; usd stays the meter's total for the key.
  const harness = lines.filter((l) => !isEmbeddingLine(l));
  const forwarded = harness.filter((l) => l.outcome === 'forwarded');
  const embeddingCharged = lines.filter((l) => isEmbeddingLine(l) && (l.outcome === 'forwarded' || l.outcome === 'failed')).length;
  const usage: TrialUsage = {
    meter_id: key,
    requests: meter.requests - embeddingCharged,
    refused: harness.filter((l) => l.outcome === 'refused').length,
    failed: harness.filter((l) => l.outcome === 'failed').length,
    usd: meter.usd,
    input_tokens: forwarded.reduce((a, l) => a + (l.input_tokens ?? 0), 0),
    output_tokens: forwarded.reduce((a, l) => a + (l.output_tokens ?? 0), 0),
    cached_tokens: forwarded.reduce((a, l) => a + (l.cached_tokens ?? 0), 0),
    ...(forwarded.some((l) => l.cache_write_tokens !== undefined) ? { cache_write_tokens: forwarded.reduce((a, l) => a + (l.cache_write_tokens ?? 0), 0) } : {}),
    unpriced: meter.unpriced,
    by_model: meter.byModel,
    upstream: meter.upstream ?? null,
  };
  return { usage, cap_stop: lines.some(isCapRefusal) };
}

/** TrialRecord.ablation from a trial's receipts. A trial is unstable when a span id removed in one agent request is removed
 *  again in the next with another sha256 from a block (unit) with the same sha256. */
export function summarizeAblation(spec: AblationSpec, wire: Wire, lines: AblationReceipt[]): TrialAblation {
  const agent = lines.filter((l) => l.kind === 'agent-turn');
  const housekeeping = lines.filter((l) => l.family === HOUSEKEEPING_FAMILY).length;
  let unstable = false;
  for (let i = 1; i < agent.length && !unstable; i++) {
    const before = new Map(agent[i - 1]!.removed.map((r) => [`${r.span}@${r.unit_sha256}`, r.sha256]));
    unstable = agent[i]!.removed.some((r) => { const was = before.get(`${r.span}@${r.unit_sha256}`); return was !== undefined && was !== r.sha256; });
  }
  const invalid = !lines.length ? 'no ablation receipts: the proxy filtered no request of this trial' : !agent.length ? `${lines.length} receipt(s) and no agent request (unknown families: ${lines.filter((l) => l.unknown_family).length})` : null;
  return {
    layers: spec.layers, map: spec.map, map_sha256: spec.map_sha256, wire,
    agent_requests: agent.length,
    matched_requests: agent.filter((l) => !l.did_not_take && !l.partial).length,
    removed_bytes: lines.reduce((a, l) => a + l.removed_bytes, 0),
    did_not_take: agent.filter((l) => l.did_not_take).length,
    partial: agent.filter((l) => l.partial).length,
    unknown_families: lines.filter((l) => l.unknown_family).length,
    ...(housekeeping ? { housekeeping_requests: housekeeping } : {}),
    unstable_filter: unstable,
    ...(invalid ? { invalid_reason: invalid } : {}),
  };
}

/** The sidecar's /v1/embeddings lines for the trial key, on their own. */
export function embeddingUsage(model: string, lines: UsageLine[]): TrialEmbeddingUsage {
  const mine = lines.filter(isEmbeddingLine);
  const forwarded = mine.filter((l) => l.outcome === 'forwarded');
  return {
    model,
    requests: forwarded.length,
    input_tokens: forwarded.reduce((a, l) => a + (l.input_tokens ?? 0), 0),
    usd: mine.reduce((a, l) => a + (l.actual_usd ?? 0), 0),
    refused: mine.filter((l) => l.outcome === 'refused').length,
    failed: mine.filter((l) => l.outcome === 'failed').length,
  };
}

/** reconcile.json: the proxy's meter against the sum of the usage lines it wrote for the key. Provider-side
 *  reconciliation (HE-PROXY-002, the >1% rule of methodology item 3) is not built; the file says so. */
export function reconcile(key: string, meter: Meter, lines: UsageLine[]) {
  const charged = lines.filter((l) => l.outcome === 'forwarded' || l.outcome === 'failed');
  const linesUsd = charged.reduce((a, l) => a + (l.actual_usd ?? 0), 0);
  const diff = Math.abs(linesUsd - meter.usd);
  return {
    meter_id: key,
    meter: { requests: meter.requests, usd: meter.usd, unpriced: meter.unpriced, undrained: meter.undrained ?? 0 },
    usage_lines: { requests: charged.length, usd: linesUsd, refused: lines.length - charged.length },
    proxy_consistent: charged.length === meter.requests && diff < 1e-9 && !meter.undrained,
    provider_reconciliation: 'not performed: per-trial reconciliation against provider usage is the HE-PROXY-002 TODO (TODOS.md); until it lands this file only proves the proxy agrees with its own usage log',
  };
}
