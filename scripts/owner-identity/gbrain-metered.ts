// HARN-116 (owner identity, row P: gbrain alone, no harness): run one gbrain CLI command in a gbrain home of its own, with
// gbrain's model calls metered under a ledger lease and no key anywhere near gbrain.
//
//   bun scripts/owner-identity/gbrain-metered.ts --lease <run id> --cap-usd <n> --home <dir> --out <dir> --model <anthropic:model>
//     [--model ...] [--expect-extraction <anthropic:model>] [--ledger <file>] [--image <tag>] [--mount <host dir>:<container dir>]...
//     [--label <name>] -- <gbrain args>
//
// The command runs in a container from the gbrain sidecar image (default harness-eval/gbrain:dev, so the same gbrain build the
// trials serve) as `bun /opt/gbrain/src/cli.ts <gbrain args>`, with GBRAIN_HOME the --home directory (mounted at /brain-home;
// `gbrain init --pglite --non-interactive --no-embedding` runs first when it holds no brain yet). Its environment is built from
// nothing: GBRAIN_HOME, HOME, NO_COLOR, GBRAIN_SKIP_STARTUP_HOOKS, GBRAIN_MODEL_DISCOVERY=off, ANTHROPIC_BASE_URL (a slot on a
// metering proxy this script starts on the docker bridge gateway) and ANTHROPIC_API_KEY set to that slot's random per-run token,
// the route the trial sidecar uses (gbrain.llm "proxy"). The proxy is the only process with the provider key; it opens
// (or reopens, with the same cap) the lease in the ledger (default <out>/ledger.sqlite), forwards only the --model ids and tags
// every line caller "gbrain". Each --mount is read-only.
//
// Before the command the facts extraction model gbrain resolves in that home is recorded (gbrain/extraction-model.ts); with
// --expect-extraction a different model stops the script before the command runs (HE-GBRAIN-017). Afterwards
// <out>/<label>.json holds the command, its exit code, that receipt, the meter and gbrain's own usage (gbrainLlmUsage), and
// the script exits with gbrain's exit code. Row P's import and extraction are two runs on the same --home and --lease, for
// example `-- import /imports --no-embed --json` then `-- extract-conversation-facts ...`; pinning Opus 5.5 is
// `-- config set facts.extraction_model anthropic:claude-opus-5-5`, which makes no model call.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RunnerError } from '../../runner/errors.ts';
import { canonicalLookup } from '../../runner/pricing/model-pricing.ts';
import type { GbrainLlmReceipt } from '../../runner/contracts.ts';
import { DEFAULT_GBRAIN_IMAGE, extractionModelProblem } from '../../runner/trial/gbrain.ts';
import { GBRAIN_CALLER, RunProxy, gbrainLlmUsage, trialKey, trialToken } from '../../runner/trial/proxy.ts';

export interface MeteredOptions {
  lease: string;
  capUsd: number;
  home: string;
  out: string;
  models: string[];
  args: string[];
  expectExtraction?: string;
  ledger?: string;
  image?: string;
  mounts?: string[];
  label?: string;
}

const usage = 'usage: bun scripts/owner-identity/gbrain-metered.ts --lease <run id> --cap-usd <n> --home <dir> --out <dir> --model <anthropic:model> [--model ...] [--expect-extraction <anthropic:model>] [--ledger <file>] [--image <tag>] [--mount <host>:<container>]... [--label <name>] -- <gbrain args>';

/** The command line, checked; refuses (HE-GBRAIN-001) before anything starts. */
export function parseMeteredArgs(argv: string[]): MeteredOptions {
  const dash = argv.indexOf('--');
  if (dash < 0 || dash === argv.length - 1) throw new RunnerError('HE-GBRAIN-001', `gbrain-metered needs the gbrain command after --; ${usage}`);
  const own = argv.slice(0, dash);
  const all = (name: string) => own.flatMap((a, i) => (a === name && own[i + 1] !== undefined ? [own[i + 1]!] : []));
  const one = (name: string) => all(name).at(-1);
  const known = new Set(['--lease', '--cap-usd', '--home', '--out', '--model', '--expect-extraction', '--ledger', '--image', '--mount', '--label']);
  for (let i = 0; i < own.length; i += 2) if (!known.has(own[i]!)) throw new RunnerError('HE-GBRAIN-001', `gbrain-metered: unknown option ${own[i]}; ${usage}`);
  const o: MeteredOptions = { lease: one('--lease') ?? '', capUsd: Number(one('--cap-usd')), home: one('--home') ?? '', out: one('--out') ?? '', models: all('--model'), args: argv.slice(dash + 1),
    ...(one('--expect-extraction') ? { expectExtraction: one('--expect-extraction') } : {}), ...(one('--ledger') ? { ledger: one('--ledger') } : {}), ...(one('--image') ? { image: one('--image') } : {}),
    ...(all('--mount').length ? { mounts: all('--mount') } : {}), ...(one('--label') ? { label: one('--label') } : {}) };
  if (!o.lease || !o.home || !o.out || !(o.capUsd > 0)) throw new RunnerError('HE-GBRAIN-001', `gbrain-metered needs --lease, a positive --cap-usd, --home and --out; ${usage}`);
  if (!o.models.length) throw new RunnerError('HE-GBRAIN-001', `gbrain-metered needs at least one --model, the models gbrain may call through the proxy (the extraction model first); ${usage}`);
  for (const m of [...o.models, ...(o.expectExtraction ? [o.expectExtraction] : [])]) {
    if (!/^anthropic:[A-Za-z0-9._-]+$/.test(m)) throw new RunnerError('HE-GBRAIN-001', `gbrain-metered routes Anthropic models only (it sets ANTHROPIC_BASE_URL); got ${m}`);
    if (!canonicalLookup(m)) throw new RunnerError('HE-PIN-002', `gbrain-metered: ${m} has no price in the dated price table runner/pricing/prices-<date>.json`);
  }
  if (o.expectExtraction && !o.models.includes(o.expectExtraction)) throw new RunnerError('HE-GBRAIN-001', `gbrain-metered: --expect-extraction ${o.expectExtraction} is not among the --model ids, so the proxy would refuse every extraction call`);
  for (const m of o.mounts ?? []) if (!/^[^:]+:\/[^:]*$/.test(m)) throw new RunnerError('HE-GBRAIN-001', `gbrain-metered: --mount takes <host dir>:<absolute container dir>; got ${m}`);
  if (o.label !== undefined && !/^[A-Za-z0-9._-]{1,64}$/.test(o.label)) throw new RunnerError('HE-GBRAIN-001', `gbrain-metered: --label must be 1-64 characters of [A-Za-z0-9._-]; got ${o.label}`);
  return o;
}

/** The docker run argv for one gbrain command: the environment is built from nothing and holds the route and the token only. */
export function meteredDockerArgs(o: Pick<MeteredOptions, 'home' | 'image' | 'mounts'>, route: { baseUrl: string; token: string }, command: string[], uidGid: string): string[] {
  return ['run', '--rm', '--user', uidGid, '--add-host', 'host.docker.internal:host-gateway', '--entrypoint', 'bun',
    '-v', `${resolve(o.home)}:/brain-home`, ...(o.mounts ?? []).flatMap((m) => ['-v', `${resolve(m.slice(0, m.indexOf(':')))}:${m.slice(m.indexOf(':') + 1)}:ro`]),
    '-e', 'GBRAIN_HOME=/brain-home', '-e', 'HOME=/brain-home', '-e', 'NO_COLOR=1', '-e', 'GBRAIN_SKIP_STARTUP_HOOKS=1', '-e', 'GBRAIN_MODEL_DISCOVERY=off',
    '-e', `ANTHROPIC_BASE_URL=${route.baseUrl}`, '-e', `ANTHROPIC_API_KEY=${route.token}`,
    o.image ?? DEFAULT_GBRAIN_IMAGE, ...command];
}

/** Runs one metered gbrain command; `proxyEnv` is the proxy's environment (the provider key), `upstream` a fake provider for tests. */
export async function runMetered(o: MeteredOptions, proxyEnv: Record<string, string | undefined> = process.env, upstream?: Record<string, string>): Promise<{ exit: number; record: Record<string, unknown> }> {
  mkdirSync(o.home, { recursive: true });
  mkdirSync(o.out, { recursive: true });
  const label = o.label ?? `cli-${Date.now()}`;
  const uidGid = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
  const proxy = await RunProxy.start({ runId: o.lease, runDir: join(o.out, `${label}.proxy`), ledgerPath: o.ledger ?? join(o.out, 'ledger.sqlite'), leaseUsd: o.capUsd, allowModels: o.models, reachableFromContainers: true, env: proxyEnv, ...(upstream ? { upstream } : {}) });
  const key = trialKey(`${o.lease}/${label}`), token = trialToken(`${o.lease}/${label}`), slot = `metered-${label}`;
  // Asynchronous, so this process keeps answering while gbrain runs (a test's fake upstream lives in it).
  const docker = async (command: string[]) => {
    const proc = Bun.spawn(['docker', ...meteredDockerArgs(o, { baseUrl: proxy.baseUrlFor(slot, 'anthropic', true), token }, command, uidGid)], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { status, stdout, stderr };
  };
  try {
    await proxy.bind(slot, key, token, o.models, undefined, false, {}, false, GBRAIN_CALLER);
    if (!existsSync(join(o.home, '.gbrain'))) {
      const init = await docker(['/opt/gbrain/src/cli.ts', 'init', '--pglite', '--non-interactive', '--no-embedding']);
      if (init.status !== 0) throw new RunnerError('HE-GBRAIN-002', `gbrain init in ${o.home} failed (exit ${init.status}): ${(init.stderr || init.stdout).trim().split('\n').slice(-3).join(' | ')}`);
    }
    const resolved = await docker(['/opt/sidecar/gbrain/extraction-model.ts']);
    const extraction = (() => { try { return JSON.parse(resolved.stdout.trim().split('\n').at(-1) ?? '') as GbrainLlmReceipt['extraction']; } catch { return null; } })();
    if (!extraction) throw new RunnerError('HE-GBRAIN-002', `gbrain's facts extraction model did not resolve in ${o.home} (exit ${resolved.status}): ${resolved.stderr.trim().split('\n').slice(-3).join(' | ')}`);
    const receipt: GbrainLlmReceipt = { schema_version: 1, extraction, pinned: null, route: { env: 'ANTHROPIC_BASE_URL', url: proxy.baseUrlFor(slot, 'anthropic', true) } };
    const problem = o.expectExtraction ? extractionModelProblem(receipt, o.expectExtraction) : null;
    if (problem) throw new RunnerError('HE-GBRAIN-017', `${problem}; the command was not run; fix: pin it first with -- config set facts.extraction_model ${o.expectExtraction}, or build the image at the gbrain commit the preregistration names`);
    const run = await docker(['/opt/gbrain/src/cli.ts', ...o.args]);
    writeFileSync(join(o.out, `${label}.stdout`), run.stdout);
    writeFileSync(join(o.out, `${label}.stderr`), run.stderr);
    const meter = await proxy.finalize(key);
    const lines = proxy.usageLines(key);
    const record = { schema_version: 1, lease: o.lease, label, image: o.image ?? DEFAULT_GBRAIN_IMAGE, home: resolve(o.home), command: ['gbrain', ...o.args], exit: run.status, models: o.models, receipt,
      meter: { requests: meter.requests, usd: meter.usd, unpriced: meter.unpriced, by_model: meter.byModel }, usage: gbrainLlmUsage(lines) };
    writeFileSync(join(o.out, `${label}.json`), JSON.stringify(record, null, 1) + '\n');
    return { exit: run.status, record };
  } finally {
    await proxy.unbind(slot).catch(() => undefined);
    await proxy.stop();
  }
}

if (import.meta.main) {
  try {
    const o = parseMeteredArgs(process.argv.slice(2));
    const { exit, record } = await runMetered(o);
    const u = record.usage as ReturnType<typeof gbrainLlmUsage>;
    console.log(`gbrain-metered: ${(record.command as string[]).join(' ')} exited ${exit}; facts extraction ${(record.receipt as GbrainLlmReceipt).extraction.model}; ${u.requests} model call(s), $${u.usd.toFixed(4)}, ${u.refused} refused, under lease ${o.lease}; ${join(o.out, `${record.label}.json`)}`);
    process.exit(exit);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(e instanceof RunnerError ? e.exit : 2);
  }
}
