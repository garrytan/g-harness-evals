// Keyless QM core stack and signed admin client for the gstack-on-QM scripts
// (smoke.ts, s1-stage.ts). The stack is harnesses/qm/compose.yaml with only the
// pg and core services up: no task container, no world. Core gets a dummy
// model key and the URL of the fake Anthropic endpoint, never a real key.
// Requests are signed the way harnesses/qm/qm-api.mjs signs them:
// x-signature = v0=HMAC-SHA256(secret, "v0:<ts>:<METHOD>\n<path>\n<body>").
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dir, '..', '..', '..');
export const COMPOSE_FILE = join(ROOT, 'harnesses', 'qm', 'compose.yaml');
/** config/core.env grants harness-admin org_admin through ADMIN_GRANTS; the adapter uses the same actor. */
export const ADMIN_ACTOR = 'harness-admin@harness-eval';
export const ORG_SCOPE = 'org:harness-eval';
/** fake-anthropic.ts refuses any key without this prefix, so a real key could never be accepted. */
export const DUMMY_KEY_PREFIX = 'sk-ant-capture-dummy';

export function signature(secret: string, method: string, path: string, body: string, ts: number): string {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${method}\n${path}\n${body}`).digest('hex');
}

export interface Call { method: string; path: string; request?: unknown; http: number; ms: number; body: unknown }
export type QmCall = (method: string, path: string, payload?: unknown, opts?: { admin?: boolean; timeoutMs?: number }) => Promise<Call>;

/** A signed client for one core. admin (default true) adds x-admin-actor. A transport failure is http 0 with the message as body. */
export function qmClient(url: string, secret: string, actor = ADMIN_ACTOR): QmCall {
  return async (method, path, payload, opts = {}) => {
    const body = method === 'GET' ? '' : JSON.stringify(payload ?? {});
    const ts = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = {
      'content-type': 'application/json', 'x-timestamp': String(ts), 'x-signature': signature(secret, method, path, body, ts),
      ...(opts.admin === false ? {} : { 'x-admin-actor': actor }),
    };
    const request = payload === undefined ? {} : { request: payload };
    const started = performance.now();
    try {
      const res = await fetch(url + path, { method, headers, body: method === 'GET' ? undefined : body, signal: AbortSignal.timeout(opts.timeoutMs ?? 300_000) });
      const text = await res.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* keep the text */ }
      return { method, path, ...request, http: res.status, ms: Math.round(performance.now() - started), body: parsed };
    } catch (e) {
      return { method, path, ...request, http: 0, ms: Math.round(performance.now() - started), body: String((e as Error)?.message ?? e) };
    }
  };
}

export interface StackOptions {
  out: string; project: string; modelBaseUrl: string; modelKey: string;
  modelName?: string; corePort?: number; pgPort?: number; coreImage?: string; sandboxImage?: string;
}
/** down() removes only the sandbox containers passed to own() (QM's machineId is the container name), never another stack's or a trial's. createSandbox owns the machineId the call returns; when the call returns none, down() removes, once core is stopped, only the sandboxes that appeared after the call started and whose name carries the sandbox id the call returned (attributeSandboxes), and leaves every other one in place with a line on stderr. */
export interface Stack { url: string; secret: string; project: string; coreImage: string; sandboxImage: string; own(machineId: string): void; createSandbox(create: () => Promise<Call>): Promise<Call>; down(): void }

const SANDBOX_NAME = /^qm-sbx-[A-Za-z0-9_.-]+$/;

/** Which new sandboxes belong to one createSandbox call that returned no machineId. QM names a local sandbox
 *  qm-sbx-<the sandbox's backing scope id, cut short>-<6 hex>, and the backing scope id is sandbox-<the id the call returned>
 *  (receipts/s1-staging-b6786d67.json: backingScopeId sandbox-949f45aa-0510-4782-b759-48777a63eafa, machineId
 *  qm-sbx-sandbox-949f45aa-0510-4782-b759-48777a63-1b711b). A container absent from the baseline is adopted only when the
 *  middle of its name is a prefix of at least 16 characters of this call's backing scope id; every other new container,
 *  and every one when the call returned no id, is skipped, so a concurrent run's sandbox is never removed. */
export function attributeSandboxes(names: Iterable<string>, baseline: Set<string>, body: unknown): { adopt: string[]; skipped: string[] } {
  const b = body && typeof body === 'object' ? body as { id?: unknown; backingScopeId?: unknown } : {};
  const backing = typeof b.backingScopeId === 'string' && b.backingScopeId ? b.backingScopeId : typeof b.id === 'string' && b.id ? 'sandbox-' + b.id : null;
  const adopt: string[] = [], skipped: string[] = [];
  for (const name of names) {
    if (baseline.has(name)) continue;
    const tag = /^qm-sbx-(.+)-[0-9a-f]{6}$/.exec(name)?.[1];
    (backing && tag && tag.length >= 16 && backing.startsWith(tag) && SANDBOX_NAME.test(name) ? adopt : skipped).push(name);
  }
  return { adopt, skipped };
}

/** Only PATH, HOME and Docker's own variables reach docker compose, plus the stack's values. */
function baseEnv(): Record<string, string> {
  const keep: Record<string, string> = {};
  for (const k of ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONFIG']) if (process.env[k]) keep[k] = process.env[k]!;
  return keep;
}

/** One stack per project name and per port on a host: a second run's opening compose down would otherwise remove a live run's stack. A lock left by a dead process is taken over. */
export function lockHost(keys: string[], dir = '/tmp'): () => void {
  const held: string[] = [];
  const release = () => { for (const p of held) { try { if (readFileSync(p, 'utf8') === String(process.pid)) rmSync(p, { force: true }); } catch { /* already gone */ } } };
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
  for (const key of keys) {
    const path = join(dir, 'qm-gstack-' + key + '.lock');
    for (let attempt = 0; ; attempt++) {
      try { writeFileSync(path, String(process.pid), { flag: 'wx' }); held.push(path); break; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') { release(); throw e; } }
      let owner = 0;
      try { owner = Number(readFileSync(path, 'utf8')); } catch { /* removed meanwhile */ }
      if (attempt > 0 || !owner || alive(owner)) { release(); throw new Error('another qm-gstack run (pid ' + owner + ') holds ' + key + '; run one stack per host or pass other ports'); }
      // Two runs can both find the same dead owner; only the one holding the takeover guard removes the lock, and only while
      // it still names that owner, so a lock another run has just taken is never removed. Both then race on the wx create.
      const guard = path + '.takeover';
      try { writeFileSync(guard, String(process.pid), { flag: 'wx' }); } catch { release(); throw new Error('another qm-gstack run is taking over ' + key + ' (' + guard + ')'); }
      try {
        let now = 0;
        try { now = Number(readFileSync(path, 'utf8')); } catch { /* removed meanwhile */ }
        if (now && now !== owner) { release(); throw new Error('another qm-gstack run (pid ' + now + ') holds ' + key + '; run one stack per host or pass other ports'); }
        rmSync(path, { force: true });
      } finally { rmSync(guard, { force: true }); }
    }
  }
  return release;
}

export async function upStack(o: StackOptions): Promise<Stack> {
  if (!o.modelKey.startsWith(DUMMY_KEY_PREFIX)) throw new Error('the stack takes only a dummy model key (' + DUMMY_KEY_PREFIX + '...)');
  const dirs = { state: join(o.out, 'state'), logs: join(o.out, 'logs'), turns: join(o.out, 'turns'), workspace: join(o.out, 'workspace') };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  const corePort = o.corePort ?? 58080;
  const pgPort = o.pgPort ?? 55432;
  const coreImage = o.coreImage ?? 'harness-eval/qm:dev';
  const sandboxImage = o.sandboxImage ?? 'harness-eval/qm-sandbox:dev';
  const prep = spawnSync(join(ROOT, 'harnesses', 'qm', 'prepare.sh'), [o.out], { encoding: 'utf8', env: { ...baseEnv(), HE_HARNESS_CONFIG: 'pi', QM_IMAGE: coreImage, QM_SANDBOX_IMAGE: sandboxImage } });
  if (prep.status !== 0) throw new Error('prepare.sh failed: ' + prep.stderr);
  const minted: Record<string, string> = {};
  for (const line of prep.stdout.split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) minted[m[1]!] = m[2]!; }
  const env = {
    ...baseEnv(), ...minted,
    HE_STATE: dirs.state, HE_LOGS: dirs.logs, HE_TURNS: dirs.turns, HE_WORKSPACE: dirs.workspace,
    HE_UID: String(process.getuid?.() ?? 1000), HE_GID: String(process.getgid?.() ?? 1000),
    HE_MODEL_API_KEY: o.modelKey, HE_MODEL_BASE_URL: o.modelBaseUrl, HE_MODEL_NAME: o.modelName ?? 'claude-haiku-5-5',
    QM_CORE_PORT: String(corePort), QM_PG_PORT: String(pgPort), QM_IMAGE: coreImage, QM_SANDBOX_IMAGE: sandboxImage,
  };
  const dc = (...args: string[]) => spawnSync('docker', ['compose', '-f', COMPOSE_FILE, '-p', o.project, ...args], { encoding: 'utf8', env, maxBuffer: 256 * 1024 * 1024 });
  const unlock = lockHost([o.project, 'port-' + corePort, 'port-' + pgPort]);
  const url = `http://127.0.0.1:${corePort}`;
  const owned = new Set<string>();
  const own = (machineId: string) => { if (!SANDBOX_NAME.test(machineId)) throw new Error('refusing to own a container not named qm-sbx-*: ' + machineId); owned.add(machineId); };
  const sandboxNames = () => new Set(spawnSync('docker', ['ps', '-a', '--filter', 'label=qm.sandbox=1', '--filter', 'ancestor=' + sandboxImage, '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean));
  const pending: Array<{ baseline: Set<string>; body: unknown }> = [];
  const adoptNew = () => {
    if (!pending.length) return;
    const names = sandboxNames();
    const skipped = new Set<string>();
    for (const p of pending.splice(0)) {
      const r = attributeSandboxes(names, p.baseline, p.body);
      for (const name of r.adopt) owned.add(name);
      for (const name of r.skipped) skipped.add(name);
    }
    for (const name of skipped) if (!owned.has(name)) console.error('qm-stack: left sandbox ' + name + ' in place: it appeared during a sandbox call that returned no machineId, and its name does not carry the sandbox id that call returned');
  };
  const removeSandboxes = () => {
    for (const name of owned) {
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
      spawnSync('docker', ['volume', 'rm', '-f', 'qm-home-' + name.replace(/^qm-sbx-/, '')], { stdio: 'ignore' });
      spawnSync('docker', ['network', 'rm', 'qm-net-' + name.replace(/^qm-sbx-/, '')], { stdio: 'ignore' });
    }
  };
  let stopping = false;
  const onSignal = (sig: NodeJS.Signals) => { down(); process.exit(sig === 'SIGINT' ? 130 : 143); };
  const down = () => {
    if (stopping) return;
    stopping = true;
    try { writeFileSync(join(o.out, 'core.log'), dc('logs', '--no-color', 'core').stdout ?? ''); } catch { /* teardown goes on without the log */ }
    finally {
      dc('down', '-v', '--remove-orphans');
      adoptNew();
      removeSandboxes();
      unlock();
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  dc('down', '-v', '--remove-orphans');
  const up = dc('up', '-d', '--no-color', 'pg', 'core');
  if (up.status !== 0) { down(); throw new Error('docker compose up failed: ' + up.stderr.slice(-2000)); }
  const deadline = Date.now() + 180_000;
  for (;;) {
    try { if ((await fetch(url + '/healthz', { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* not up yet */ }
    if (Date.now() > deadline) { down(); throw new Error('core did not answer /healthz within 180 s (see ' + join(o.out, 'core.log') + ')'); }
    await Bun.sleep(2000);
  }
  const whoami = await qmClient(url, minted.QM_SIGNING_SECRET!)('GET', '/v1/admin/whoami', undefined, { timeoutMs: 10_000 });
  if (whoami.http !== 200) { down(); throw new Error('the core on ' + url + ' refused this stack\'s signed whoami (http ' + whoami.http + '); another service may hold the port'); }
  return { url, secret: minted.QM_SIGNING_SECRET!, project: o.project, coreImage, sandboxImage, own,
    createSandbox: async (create: () => Promise<Call>) => {
      const baseline = sandboxNames();
      const res = await create();
      const machineId = (res.body as { machineId?: string } | null)?.machineId;
      if (machineId) own(machineId);
      else pending.push({ baseline, body: res.body });
      return res;
    },
    down };
}

export function imageInfo(image: string): { id: string | null; qm_commit: string | null } {
  const r = spawnSync('docker', ['image', 'inspect', '-f', '{{.Id}} {{index .Config.Labels "harness-eval.commit"}}', image], { encoding: 'utf8' });
  if (r.status !== 0) return { id: null, qm_commit: null };
  const [id, commit] = r.stdout.trim().split(' ');
  return { id: id || null, qm_commit: commit && commit !== '<no' ? commit : null };
}
