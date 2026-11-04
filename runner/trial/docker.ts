// The container path, in one module so everything else runs without Docker. Two topologies from
// docs/adapters.md: in-container (one image, `docker run -d ... serve`) and sidecar (harnesses/<name>/compose.yaml
// with the task service switched to `serve` by an override file the runner writes; prepare.sh and capture.sh
// are invoked the way harnesses/run-trial.sh invokes them). Nothing here is exercised by the keyless tests.
//
// Every docker call is an asynchronous subprocess, so a slow container start or stop in one trial never blocks
// the event loop that serves the other trials' worlds; a gbrain-docs trial mounts its install bundle view read-only.
//
// A cell with network "internal" runs on one docker network per run, created with --internal (no route off the
// machine, no DNS) and with inter-container traffic off, so the harness and the gbrain sidecar reach the host's servers on
// the network's gateway and nothing else, not even each other. host.docker.internal maps to that gateway, so adapters keep
// the URLs they have; the metering proxy and the world bind the gateway (never 0.0.0.0). A compose stack is not moved
// onto it: run.ts refuses the cell (HE-NET-001).

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RunnerError } from '../errors.ts';
import { type Harness, type TrialDirs, pollReady } from './harness.ts';
import { isHostAddress } from './world.ts';

export function dockerAvailable(): boolean {
  const r = spawnSync('docker', ['info'], { stdio: 'ignore' });
  return r.status === 0;
}

async function sh(args: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const proc = Bun.spawn(args, { cwd: opts.cwd, env: opts.env ? { ...process.env, ...opts.env } : process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => proc.kill('SIGKILL'), opts.timeoutMs ?? 120_000);
  try {
    const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { status, stdout, stderr };
  } finally { clearTimeout(timer); }
}

export interface DockerHarnessOptions {
  harness: string;
  image: string;
  trialSlug: string;
  dirs: TrialDirs;
  /** The serve environment table (docs/adapters.md), container paths already substituted. */
  env: Record<string, string>;
  /** The run's internal network; unset, the default bridge with host.docker.internal at host-gateway. */
  network?: InternalNetwork;
  repoRoot?: string;
  /** Extra read-only bind mounts, host path to container path (the install bundle view at /he-gbrain-install). */
  readOnlyMounts?: Record<string, string>;
  /** Capture mode: the container's DNS server (docker run --dns). The compose topology ignores it. */
  dns?: string;
}

const uidGid = () => `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;

/** The run's internal network and the gateway address the host owns on it. */
export interface InternalNetwork { name: string; gateway: string }

export const internalNetworkName = (runId: string) => `he-net-${runId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/** Create the run's internal network, or reuse one of that name left by an interrupted invocation if it is internal with
 *  inter-container traffic off; read its gateway the way containerHostAddress() reads the bridge's. */
export async function ensureInternalNetwork(name: string): Promise<InternalNetwork> {
  const inspect = () => sh(['docker', 'network', 'inspect', name, '--format', '{{.Internal}} {{index .Options "com.docker.network.bridge.enable_icc"}} {{(index .IPAM.Config 0).Gateway}}']);
  let found = await inspect();
  if (found.status !== 0) {
    const made = await sh(['docker', 'network', 'create', '--driver', 'bridge', '--internal', '-o', 'com.docker.network.bridge.enable_icc=false', name]);
    if (made.status !== 0) throw new RunnerError('HE-NET-001', `docker network create --internal ${name} failed: ${(made.stderr || made.stdout).trim().slice(0, 300)}; fix: check the docker daemon`);
    found = await inspect();
  }
  const [internal, icc, gateway = ''] = found.stdout.trim().split(' ');
  if (found.status !== 0 || internal !== 'true' || icc !== 'false') throw new RunnerError('HE-NET-001', `docker network ${name} exists but is not internal with inter-container traffic off (${found.stdout.trim() || found.stderr.trim().slice(0, 200)}); fix: docker network rm ${name}, then rerun`);
  if (!isHostAddress(gateway)) throw new RunnerError('HE-NET-001', `the gateway of docker network ${name} could not be read (got ${JSON.stringify(gateway)}); the metering proxy and the world listen on it and never on every interface; fix: docker network rm ${name}, then rerun`);
  return { name, gateway };
}

/** Remove the run's internal network; false when docker refused (a container still attached). */
export async function removeInternalNetwork(name: string): Promise<boolean> {
  return (await sh(['docker', 'network', 'rm', name])).status === 0;
}

/** The `docker run` argument list of the in-container topology. */
export function dockerRunArgs(opts: DockerHarnessOptions, name: string): string[] {
  const args = ['docker', 'run', '-d', '--name', name, '--user', uidGid(), '--network', opts.network?.name ?? 'bridge', '--add-host', `host.docker.internal:${opts.network?.gateway ?? 'host-gateway'}`,
    '-v', `${resolve(opts.dirs.workspace)}:/workspace`, '-v', `${resolve(opts.dirs.state)}:/harness-state`, '-v', `${resolve(opts.dirs.logs)}:/he-logs`, '-v', `${resolve(opts.dirs.turns)}:/he-turns`];
  if (opts.dns) args.push('--dns', opts.dns);
  for (const [host, inside] of Object.entries(opts.readOnlyMounts ?? {})) args.push('-v', `${resolve(host)}:${inside}:ro`);
  for (const [k, v] of Object.entries(opts.env)) args.push('-e', `${k}=${v}`);
  args.push(opts.image, 'serve');
  return args;
}

/** In-container topology: one detached container whose entrypoint argument is `serve`. */
export async function startDockerHarness(opts: DockerHarnessOptions): Promise<Harness> {
  const name = `he-${opts.trialSlug}`;
  await sh(['docker', 'rm', '-f', name]);
  const run = await sh(dockerRunArgs(opts, name));
  if (run.status !== 0) throw new RunnerError('HE-RUN-006', `docker run failed for ${opts.image}: ${(run.stderr || run.stdout).trim().slice(0, 400)}; fix: build the image (harnesses/${opts.harness}/README.md) and check the docker daemon`);
  const exited = async (): Promise<number | null> => {
    const r = await sh(['docker', 'inspect', '-f', '{{.State.Status}} {{.State.ExitCode}}', name]);
    if (r.status !== 0) return 1;
    const [status, code] = r.stdout.trim().split(' ');
    return status === 'running' || status === 'created' ? null : Number(code);
  };
  const collect = async () => {
    const logs = await sh(['docker', 'logs', name]);
    writeFileSync(join(opts.dirs.logs, 'docker.log'), `${logs.stdout}\n${logs.stderr}`);
    await sh(['docker', 'rm', '-f', name]);
  };
  let stopped: Promise<void> | null = null;
  return {
    kind: 'docker',
    waitReady: (timeoutMs) => pollReady(opts.dirs.logs, timeoutMs, exited),
    exited,
    stop(graceMs) {
      stopped ??= (async () => {
        await sh(['docker', 'stop', '-t', String(Math.ceil(graceMs / 1000)), name], { timeoutMs: graceMs + 30_000 });
        await collect();
      })();
      return stopped;
    },
    async kill() { await sh(['docker', 'kill', name]); },
  };
}

export interface ComposeHarnessOptions extends DockerHarnessOptions {
  composeFile: string;
  /** HE_MODEL_* and the rest of the stack's environment (what harnesses/run-trial.sh exports). */
  stackEnv: Record<string, string>;
  timeBudgetS: number;
  /** internal-task (QM pi-memory-provider): variables for the core service only, such as MEMORY_PROVIDER_CONFIG and its client pair.
   *  They reach compose through its process environment and the override names them, so no value is written to a file and
   *  the task container never sees them. Absent, the override is what it was before. */
  coreEnv?: Record<string, string>;
  /** The provider of the cell model (anthropic:claude-opus-5-5 is anthropic). When compose.<provider>.yaml sits beside the
   *  compose file, it is merged over it before the runner's override (QM: compose.openai.yaml). */
  modelProvider?: string;
}

/** The override file of the sidecar topology: the task service serves turns with the serve environment and the turns
 *  directory; with coreEnv, the core service also gets each of those variables, by name only. */
export function composeOverride(env: Record<string, string>, turnsDir: string, coreEnv?: Record<string, string>): string {
  const yamlEnv = Object.entries(env).map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`).join('\n');
  const core = coreEnv && Object.keys(coreEnv).length ? `  core:\n    environment:\n${Object.keys(coreEnv).map((k) => `      ${k}: \${${k}}`).join('\n')}\n` : '';
  return `# Written by the runner for one multi-user trial: the task service serves turns instead of running once.\nservices:\n  task:\n    command: ["serve"]\n    environment:\n${yamlEnv}\n    volumes:\n      - ${resolve(turnsDir)}:/he-turns\n${core}`;
}

/** Sidecar topology: the compose stack is the trial. The task service's command becomes `serve`, the turns
 *  directory and the serve environment are added through an override file; prepare.sh runs first and
 *  capture.sh runs after the task service stops and before teardown, as in harnesses/run-trial.sh. */
export async function startComposeHarness(opts: ComposeHarnessOptions): Promise<Harness> {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const project = `he-${opts.trialSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const env: Record<string, string> = {
    ...opts.stackEnv,
    HE_WORKSPACE: resolve(opts.dirs.workspace), HE_STATE: resolve(opts.dirs.state), HE_LOGS: resolve(opts.dirs.logs),
    HE_UID: String(process.getuid?.() ?? 1000), HE_GID: String(process.getgid?.() ?? 1000), QM_IMAGE: opts.image,
    HE_ENTRY: 'serve', HE_TURNS: resolve(opts.dirs.turns), ...opts.env,
    // capture.sh reads the project name to reach the stack's services (QM's pg_dump) with the same name compose used.
    COMPOSE_PROJECT_NAME: project,
    ...opts.coreEnv,
  };
  const prepare = join(repoRoot, 'harnesses', opts.harness, 'prepare.sh');
  if (existsSync(prepare)) {
    const r = await sh(['bash', prepare, resolve(opts.dirs.root)], { env });
    if (r.status !== 0) throw new RunnerError('HE-RUN-006', `${prepare} failed: ${r.stderr.trim().slice(0, 400)}`);
    for (const line of r.stdout.split('\n')) { const eq = line.indexOf('='); if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1); }
  }
  const override = join(opts.dirs.root, 'compose.serve.yaml');
  writeFileSync(override, composeOverride(opts.env, opts.dirs.turns, opts.coreEnv));
  const providerFile = opts.modelProvider ? opts.composeFile.replace(/\.yaml$/, `.${opts.modelProvider}.yaml`) : undefined;
  const compose = ['docker', 'compose', '-f', opts.composeFile, ...(providerFile && existsSync(providerFile) ? ['-f', providerFile] : []), '-f', override, '-p', project];
  const up = await sh([...compose, 'up', '-d', '--no-color'], { env, timeoutMs: (opts.timeBudgetS + 180) * 1000 });
  writeFileSync(join(opts.dirs.logs, 'compose.log'), `${up.stdout}\n${up.stderr}`);
  if (up.status !== 0) {
    await sh([...compose, 'down', '-v', '--remove-orphans'], { env });
    throw new RunnerError('HE-RUN-006', `docker compose up failed for ${opts.composeFile}: ${up.stderr.trim().slice(0, 400)}; see ${join(opts.dirs.logs, 'compose.log')}`);
  }
  const exited = async (): Promise<number | null> => {
    const r = await sh([...compose, 'ps', '-a', '--format', 'json', 'task'], { env });
    const line = r.stdout.trim().split('\n').find((l) => l.startsWith('{'));
    if (!line) return 1;
    const ps = JSON.parse(line) as { State?: string; ExitCode?: number };
    return ps.State === 'running' ? null : Number(ps.ExitCode ?? 1);
  };
  const teardown = async () => {
    const core = await sh([...compose, 'logs', '--no-color', 'core'], { env });
    writeFileSync(join(opts.dirs.logs, 'core.log'), `${core.stdout}\n${core.stderr}`);
    const task = await sh([...compose, 'logs', '--no-color', 'task'], { env });
    writeFileSync(join(opts.dirs.logs, 'docker.log'), `${task.stdout}\n${task.stderr}`);
    const capture = join(repoRoot, 'harnesses', opts.harness, 'capture.sh');
    if (existsSync(capture)) {
      const r = await sh(['bash', capture, resolve(opts.dirs.root)], { env, timeoutMs: 300_000 });
      writeFileSync(join(opts.dirs.logs, 'capture.log'), `${r.stdout}\n${r.stderr}`);
    }
    await sh([...compose, 'down', '-v', '--remove-orphans'], { env, timeoutMs: 300_000 });
  };
  let stopped: Promise<void> | null = null;
  return {
    kind: 'compose',
    waitReady: (timeoutMs) => pollReady(opts.dirs.logs, timeoutMs, exited),
    exited,
    stop(graceMs) {
      stopped ??= (async () => {
        await sh([...compose, 'stop', '-t', String(Math.ceil(graceMs / 1000)), 'task'], { env, timeoutMs: graceMs + 30_000 });
        await teardown();
      })();
      return stopped;
    },
    async kill() { await sh([...compose, 'kill', 'task'], { env }); },
  };
}
