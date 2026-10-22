// The container path, in one module so everything else runs without Docker. Two topologies from
// docs/adapters.md: in-container (one image, `docker run -d ... serve`) and sidecar (harnesses/<name>/compose.yaml
// with the task service switched to `serve` by an override file the runner writes; prepare.sh and capture.sh
// are invoked the way harnesses/run-trial.sh invokes them). Nothing here is exercised by the keyless tests.

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RunnerError } from '../errors.ts';
import { type Harness, type TrialDirs, pollReady } from './harness.ts';

export function dockerAvailable(): boolean {
  const r = spawnSync('docker', ['info'], { stdio: 'ignore' });
  return r.status === 0;
}

function sh(args: string[], opts: { cwd?: string; env?: Record<string, string>; input?: string; timeoutMs?: number } = {}) {
  return spawnSync(args[0]!, args.slice(1), { cwd: opts.cwd, env: opts.env ? { ...process.env, ...opts.env } : process.env, input: opts.input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: opts.timeoutMs });
}

export interface DockerHarnessOptions {
  harness: string;
  image: string;
  trialSlug: string;
  dirs: TrialDirs;
  /** The serve environment table (docs/adapters.md), container paths already substituted. */
  env: Record<string, string>;
  network?: string;
  repoRoot?: string;
}

const uidGid = () => `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;

/** In-container topology: one detached container whose entrypoint argument is `serve`. */
export function startDockerHarness(opts: DockerHarnessOptions): Harness {
  const name = `he-${opts.trialSlug}`;
  sh(['docker', 'rm', '-f', name]);
  const args = ['docker', 'run', '-d', '--name', name, '--user', uidGid(), '--network', opts.network ?? 'bridge', '--add-host', 'host.docker.internal:host-gateway',
    '-v', `${resolve(opts.dirs.workspace)}:/workspace`, '-v', `${resolve(opts.dirs.state)}:/harness-state`, '-v', `${resolve(opts.dirs.logs)}:/he-logs`, '-v', `${resolve(opts.dirs.turns)}:/he-turns`];
  for (const [k, v] of Object.entries(opts.env)) args.push('-e', `${k}=${v}`);
  args.push(opts.image, 'serve');
  const run = sh(args);
  if (run.status !== 0) throw new RunnerError('HE-RUN-006', `docker run failed for ${opts.image}: ${(run.stderr || run.stdout).trim().slice(0, 400)}; fix: build the image (harnesses/${opts.harness}/README.md) and check the docker daemon`);
  const exited = async (): Promise<number | null> => {
    const r = sh(['docker', 'inspect', '-f', '{{.State.Status}} {{.State.ExitCode}}', name]);
    if (r.status !== 0) return 1;
    const [status, code] = r.stdout.trim().split(' ');
    return status === 'running' || status === 'created' ? null : Number(code);
  };
  const collect = () => {
    const logs = sh(['docker', 'logs', name]);
    writeFileSync(join(opts.dirs.logs, 'docker.log'), `${logs.stdout}\n${logs.stderr}`);
    sh(['docker', 'rm', '-f', name]);
  };
  let stopped: Promise<void> | null = null;
  return {
    kind: 'docker',
    waitReady: (timeoutMs) => pollReady(opts.dirs.logs, timeoutMs, exited),
    exited,
    stop(graceMs) {
      stopped ??= (async () => {
        sh(['docker', 'stop', '-t', String(Math.ceil(graceMs / 1000)), name], { timeoutMs: graceMs + 30_000 });
        collect();
      })();
      return stopped;
    },
    async kill() { sh(['docker', 'kill', name]); },
  };
}

export interface ComposeHarnessOptions extends DockerHarnessOptions {
  composeFile: string;
  /** HE_MODEL_* and the rest of the stack's environment (what harnesses/run-trial.sh exports). */
  stackEnv: Record<string, string>;
  timeBudgetS: number;
}

/** Sidecar topology: the compose stack is the trial. The task service's command becomes `serve`, the turns
 *  directory and the serve environment are added through an override file; prepare.sh runs first and
 *  capture.sh runs after the task service stops and before teardown, as in harnesses/run-trial.sh. */
export function startComposeHarness(opts: ComposeHarnessOptions): Harness {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const project = `he-${opts.trialSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const env: Record<string, string> = {
    ...opts.stackEnv,
    HE_WORKSPACE: resolve(opts.dirs.workspace), HE_STATE: resolve(opts.dirs.state), HE_LOGS: resolve(opts.dirs.logs),
    HE_UID: String(process.getuid?.() ?? 1000), HE_GID: String(process.getgid?.() ?? 1000), QM_IMAGE: opts.image,
  };
  const prepare = join(repoRoot, 'harnesses', opts.harness, 'prepare.sh');
  if (existsSync(prepare)) {
    const r = sh(['bash', prepare, resolve(opts.dirs.root)], { env });
    if (r.status !== 0) throw new RunnerError('HE-RUN-006', `${prepare} failed: ${r.stderr.trim().slice(0, 400)}`);
    for (const line of r.stdout.split('\n')) { const eq = line.indexOf('='); if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1); }
  }
  const override = join(opts.dirs.root, 'compose.serve.yaml');
  const yamlEnv = Object.entries(opts.env).map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`).join('\n');
  writeFileSync(override, `# Written by the runner for one multi-user trial: the task service serves turns instead of running once.\nservices:\n  task:\n    command: ["serve"]\n    environment:\n${yamlEnv}\n    volumes:\n      - ${resolve(opts.dirs.turns)}:/he-turns\n`);
  const compose = ['docker', 'compose', '-f', opts.composeFile, '-f', override, '-p', project];
  const up = sh([...compose, 'up', '-d', '--no-color'], { env, timeoutMs: (opts.timeBudgetS + 180) * 1000 });
  writeFileSync(join(opts.dirs.logs, 'compose.log'), `${up.stdout}\n${up.stderr}`);
  if (up.status !== 0) {
    sh([...compose, 'down', '-v', '--remove-orphans'], { env });
    throw new RunnerError('HE-RUN-006', `docker compose up failed for ${opts.composeFile}: ${up.stderr.trim().slice(0, 400)}; see ${join(opts.dirs.logs, 'compose.log')}`);
  }
  const exited = async (): Promise<number | null> => {
    const r = sh([...compose, 'ps', '-a', '--format', 'json', 'task'], { env });
    const line = r.stdout.trim().split('\n').find((l) => l.startsWith('{'));
    if (!line) return 1;
    const ps = JSON.parse(line) as { State?: string; ExitCode?: number };
    return ps.State === 'running' ? null : Number(ps.ExitCode ?? 1);
  };
  const teardown = () => {
    const core = sh([...compose, 'logs', '--no-color', 'core'], { env });
    writeFileSync(join(opts.dirs.logs, 'core.log'), `${core.stdout}\n${core.stderr}`);
    const task = sh([...compose, 'logs', '--no-color', 'task'], { env });
    writeFileSync(join(opts.dirs.logs, 'docker.log'), `${task.stdout}\n${task.stderr}`);
    const capture = join(repoRoot, 'harnesses', opts.harness, 'capture.sh');
    if (existsSync(capture)) {
      const r = sh(['bash', capture, resolve(opts.dirs.root)], { env });
      writeFileSync(join(opts.dirs.logs, 'capture.log'), `${r.stdout}\n${r.stderr}`);
    }
    sh([...compose, 'down', '-v', '--remove-orphans'], { env });
  };
  let stopped: Promise<void> | null = null;
  return {
    kind: 'compose',
    waitReady: (timeoutMs) => pollReady(opts.dirs.logs, timeoutMs, exited),
    exited,
    stop(graceMs) {
      stopped ??= (async () => {
        sh([...compose, 'stop', '-t', String(Math.ceil(graceMs / 1000)), 'task'], { env, timeoutMs: graceMs + 30_000 });
        teardown();
      })();
      return stopped;
    },
    async kill() { sh([...compose, 'kill', 'task'], { env }); },
  };
}
