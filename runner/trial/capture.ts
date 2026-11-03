// Capture-only mode (harness anatomy). A normal multi-user trial (real world, task, preamble, gbrain sidecar and
// slot binding) runs against a fake model server instead of Anthropic or OpenAI, so every request a harness sends to its
// model can be recorded without a key and without spending. The metering proxy forwards to the fake through its
// --upstream flag, and its process gets dummy provider keys built from scratch, never the values in this process's
// environment. Only a run id starting with "anatomy-capture-" may use it: capture runs are never counted runs.
//
// --capture-dns points the harness container's resolver at a logging sink so a direct call past the proxy leaves a
// receipt. It applies to the in-container topology only; compose harnesses (QM) and process-mode harnesses ignore it.

import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { RunnerError } from '../errors.ts';

export const CAPTURE_RUN_PREFIX = 'anatomy-capture-';
export const CAPTURE_PROVIDERS = ['anthropic', 'openai'] as const;
export type CaptureProvider = (typeof CAPTURE_PROVIDERS)[number];

/** The only provider key values a capture proxy ever sees. Neither is a real key shape. */
export const CAPTURE_DUMMY_KEYS = { ANTHROPIC_API_KEY: 'sk-ant-capture-dummy', OPENAI_API_KEY: 'sk-capture-dummy' } as const;

export interface CaptureConfig {
  /** Base URL of the fake model server per provider, handed to the proxy as --upstream provider=url. */
  upstream: Partial<Record<CaptureProvider, string>>;
  /** Resolver for the harness container (docker run --dns), or null. */
  dns: string | null;
}

/** What run-summary.json records under "capture": the same fields as the CAPTURE: line. */
export interface CaptureSummary {
  upstream: Record<CaptureProvider, string | null>;
  dns: string | null;
  keys: 'dummy';
}

const fail = (message: string, fix: string): never => { throw new RunnerError('HE-RUN-002', `${message}; fix: ${fix}`); };

/** The run subcommand's capture flags. Null when neither flag is given. `providers` are the providers the selected cells
 *  call (models, utility models, embeddings); each needs an upstream so no capture request reaches a real provider. */
export function parseCaptureOptions(o: { runId: string; upstream: string[]; dns?: string; providers?: string[] }): CaptureConfig | null {
  if (!o.upstream.length && o.dns === undefined) return null;
  if (!o.runId.startsWith(CAPTURE_RUN_PREFIX)) fail(`--capture-upstream and --capture-dns are for capture runs only, and run ${o.runId} does not start with "${CAPTURE_RUN_PREFIX}"; capture runs are never counted runs`, `plan a scratch run whose run_id starts with "${CAPTURE_RUN_PREFIX}", or drop the capture flags`);
  const upstream: Partial<Record<CaptureProvider, string>> = {};
  for (const kv of o.upstream) {
    const eq = kv.indexOf('=');
    const [prov, url] = eq > 0 ? [kv.slice(0, eq), kv.slice(eq + 1)] : [kv, ''];
    if (!(CAPTURE_PROVIDERS as readonly string[]).includes(prov)) fail(`--capture-upstream wants anthropic=<url> or openai=<url> (got ${kv})`, 'name the provider anthropic or openai');
    if (!/^https?:\/\/[^/\s]+/.test(url) || !URL.canParse(url)) fail(`--capture-upstream ${prov} needs an http or https URL (got ${url || 'nothing'})`, `pass ${prov}=http://<host>:<port> of the fake model server`);
    if (upstream[prov as CaptureProvider]) fail(`--capture-upstream names ${prov} twice`, `pass one ${prov}=<url>`);
    upstream[prov as CaptureProvider] = url.replace(/\/$/, '');
  }
  if (!Object.keys(upstream).length) fail('--capture-dns needs at least one --capture-upstream', 'pass --capture-upstream anthropic=<url> or openai=<url> for the fake model server');
  const missing = [...new Set(o.providers ?? [])].filter((p) => !upstream[p as CaptureProvider]);
  if (missing.length) fail(`the selected cells call ${missing.join(', ')}, which has no --capture-upstream; a capture run sends no request to a real provider`, `add --capture-upstream ${missing[0]}=<url>, or narrow --cells`);
  if (o.dns !== undefined && isIP(o.dns) === 0) fail(`--capture-dns wants an IP address (got ${o.dns || 'nothing'})`, 'pass the IP of the DNS logging sink');
  return { upstream, dns: o.dns ?? null };
}

/** The proxy process environment in capture mode, built from scratch: PATH and HOME from `parent`, dummy provider keys. */
export function captureProxyEnv(parent: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ['PATH', 'HOME'] as const) if (parent[k] !== undefined) env[k] = parent[k]!;
  return { ...env, ...CAPTURE_DUMMY_KEYS };
}

export function captureSummary(c: CaptureConfig): CaptureSummary {
  return { upstream: { anthropic: c.upstream.anthropic ?? null, openai: c.upstream.openai ?? null }, dns: c.dns, keys: 'dummy' };
}

export function captureLine(c: CaptureConfig): string {
  const s = captureSummary(c);
  return `CAPTURE: upstream anthropic=${s.upstream.anthropic ?? 'none'} openai=${s.upstream.openai ?? 'none'} dns=${s.dns ?? 'none'} keys=dummy`;
}

/** The CAPTURE: line naming the harnesses --capture-dns does not reach, or null when it reaches all of them (or is unset). */
export function captureDnsGapLine(c: CaptureConfig, harnesses: string[], mode: 'docker' | 'process' | 'scripted', repoRoot = '.'): string | null {
  if (!c.dns || mode === 'scripted') return null;
  const unique = [...new Set(harnesses)];
  if (mode === 'process') return unique.length ? `CAPTURE: dns ${c.dns} is not applied to process-mode harnesses (${unique.join(', ')}); egress is not observed for them` : null;
  const compose = unique.filter((h) => existsSync(join(repoRoot, 'harnesses', h, 'compose.yaml')));
  return compose.length ? `CAPTURE: dns ${c.dns} is not applied to compose harnesses (${compose.join(', ')}); egress is not observed for compose harnesses` : null;
}
