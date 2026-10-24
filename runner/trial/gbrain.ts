// The gbrain sidecar of one trial (docs/gbrain-arm.md): one container from harness-eval/gbrain:dev on its own
// docker network, its MCP port published on the host loopback only, a fresh brain for the trial's split, a
// bearer token minted into <trial dir>/gbrain/token. The harness never reaches it: the world's /gbrain tap does,
// with that token, and the harness gets the tap's URL and the world bot token. Everything docker-specific for
// the sidecar lives here, like runner/trial/docker.ts for the harness.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RunnerError } from '../errors.ts';

export const DEFAULT_GBRAIN_IMAGE = 'harness-eval/gbrain:dev';
export const GBRAIN_PORT = 3131;

function sh(args: string[], timeoutMs?: number) {
  return spawnSync(args[0]!, args.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
}

const uidGid = () => `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;

export interface GbrainSidecarOptions {
  trialId: string;
  trialSlug: string;
  split: 'dev' | 'heldout';
  /** <trial dir>/gbrain: the token, the sidecar's logs; excluded from committed results. */
  outDir: string;
  image?: string;
  readyTimeoutMs?: number;
  log?: (line: string) => void;
}

export interface GbrainSidecar {
  /** How the world reaches the sidecar: http://127.0.0.1:<published port>. */
  url: string;
  token: string;
  tokenPath: string;
  image: string;
  /** Milliseconds from docker run to a healthy /health and a token on disk. */
  ready_ms: number;
  /** SIGTERM, wait, collect docker logs into outDir, remove the container and its network. Idempotent. */
  stop(graceMs?: number): Promise<void>;
}

/** The image exists locally. */
export function gbrainImagePresent(image = DEFAULT_GBRAIN_IMAGE): boolean {
  return sh(['docker', 'image', 'inspect', image]).status === 0;
}

export async function waitHealthy(url: string, timeoutMs: number, exited: () => string | null): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch { /* not listening yet */ }
    const gone = exited();
    if (gone) throw new Error(gone);
    await Bun.sleep(200);
  }
  throw new Error(`no healthy /health at ${url} after ${Math.round(timeoutMs / 1000)} s`);
}

export async function startGbrainSidecar(o: GbrainSidecarOptions): Promise<GbrainSidecar> {
  const image = o.image ?? DEFAULT_GBRAIN_IMAGE;
  const log = o.log ?? (() => undefined);
  const name = `he-gbrain-${o.trialSlug}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const network = `${name}-net`;
  const out = resolve(o.outDir);
  mkdirSync(out, { recursive: true });
  const tokenPath = join(out, 'token');
  if (!gbrainImagePresent(image)) throw new RunnerError('HE-GBRAIN-002', `gbrain sidecar image ${image} is not present; fix: docker build -f gbrain/Dockerfile -t ${image} . (gbrain/README.md)`);
  sh(['docker', 'rm', '-f', name]);
  sh(['docker', 'network', 'rm', network]);
  const net = sh(['docker', 'network', 'create', '--driver', 'bridge', network]);
  if (net.status !== 0) throw new RunnerError('HE-GBRAIN-002', `docker network create ${network} failed: ${(net.stderr || net.stdout).trim().slice(0, 300)}`);
  const started = Date.now();
  const run = sh(['docker', 'run', '-d', '--name', name, '--user', uidGid(), '--network', network,
    '-p', `127.0.0.1:0:${GBRAIN_PORT}`, '-v', `${out}:/he-gbrain`,
    '-e', `HE_GBRAIN_SPLIT=${o.split}`, '-e', 'HE_GBRAIN_OUT=/he-gbrain', '-e', `HE_TRIAL_ID=${o.trialId}`,
    image]);
  if (run.status !== 0) {
    sh(['docker', 'network', 'rm', network]);
    throw new RunnerError('HE-GBRAIN-002', `docker run failed for ${image}: ${(run.stderr || run.stdout).trim().slice(0, 400)}; fix: build the image (gbrain/README.md) and check the docker daemon`);
  }
  const exited = (): string | null => {
    const r = sh(['docker', 'inspect', '-f', '{{.State.Status}} {{.State.ExitCode}}', name]);
    if (r.status !== 0) return `container ${name} vanished`;
    const [status, code] = r.stdout.trim().split(' ');
    return status === 'running' || status === 'created' ? null : `the sidecar exited ${code} before it was ready`;
  };
  let stopped: Promise<void> | null = null;
  const stop = (graceMs = 10_000) => {
    stopped ??= (async () => {
      sh(['docker', 'stop', '-t', String(Math.ceil(graceMs / 1000)), name], graceMs + 30_000);
      const logs = sh(['docker', 'logs', name]);
      writeFileSync(join(out, 'docker.log'), `${logs.stdout}\n${logs.stderr}`);
      sh(['docker', 'rm', '-f', name]);
      sh(['docker', 'network', 'rm', network]);
    })();
    return stopped;
  };
  try {
    const port = sh(['docker', 'port', name, `${GBRAIN_PORT}/tcp`]).stdout.trim().split('\n')[0]?.split(':').pop();
    if (!port) throw new Error('docker port reported no published port');
    const url = `http://127.0.0.1:${port}`;
    const timeout = o.readyTimeoutMs ?? 60_000;
    await waitHealthy(url, timeout, exited);
    const deadline = started + timeout;
    while (!existsSync(tokenPath) || !readFileSync(tokenPath, 'utf8').trim()) {
      if (Date.now() > deadline) throw new Error(`no token at ${tokenPath} after ${Math.round(timeout / 1000)} s`);
      const gone = exited();
      if (gone) throw new Error(gone);
      await Bun.sleep(100);
    }
    const token = readFileSync(tokenPath, 'utf8').trim();
    const ready_ms = Date.now() - started;
    log(`gbrain sidecar ${name} (${o.split}, ${image}) healthy at ${url} after ${ready_ms} ms; token in ${tokenPath}`);
    return { url, token, tokenPath, image, ready_ms, stop };
  } catch (e) {
    await stop(5_000);
    const tail = existsSync(join(out, 'docker.log')) ? readFileSync(join(out, 'docker.log'), 'utf8').trim().split('\n').slice(-3).join(' | ') : '';
    throw new RunnerError('HE-GBRAIN-002', `the gbrain sidecar did not become ready: ${(e as Error).message}${tail ? ` (${tail})` : ''}; fix: read ${join(out, 'sidecar.log')} and ${join(out, 'docker.log')}, rebuild the image (gbrain/README.md)`);
  }
}

/** Preflight: the image exists and a container from it serves /health. Starts and stops one sidecar. */
export async function probeGbrainImage(image: string, scratchDir: string): Promise<{ ready_ms: number; version: string | null }> {
  const sidecar = await startGbrainSidecar({ trialId: 'preflight', trialSlug: `preflight-${process.pid}`, split: 'dev', outDir: scratchDir, image });
  try {
    const health = await fetch(`${sidecar.url}/health`).then((r) => r.json() as Promise<{ version?: string }>).catch(() => ({} as { version?: string }));
    return { ready_ms: sidecar.ready_ms, version: health.version ?? null };
  } finally {
    await sidecar.stop(5_000);
  }
}
