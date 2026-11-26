// The gbrain first-wow eval's QM trial (docs/benchmarks/2026-11-24-gbrain-first-wow/PREREGISTRATION.md, QM), started from
// runner/trial/first-wow.ts for a qm cell. QM is a compose stack (harnesses/qm/compose.yaml) with core on the host network, so it
// runs on the default bridge, not the internal network. A person DMs QM once with questionPrompt, as origin human; the adapter
// serves with HE_QM_WORLD=off (no world MCP server, no directory push) and makes the DM scope a default sandbox before the turn.
//
//   plain      QM's pi config. The fixture's HOME (.claude, .codex, src/) is baked into the sandbox image at /root/workspace
//              (harnesses/qm/Dockerfile.sett), so the session files sit in the scope's sandbox workspace. No gbrain anywhere.
//   qm-native  QM's pi-memory-provider config. A brain host (brainHostImage: gbrain and bun at the cell's commit) holds the
//              fixture's HOME at /home/dev and runs brainHostSteps by hand: a keyless brain, PR 1's import over 30 days, QM's
//              token, the person made the brain's owner and the token bound to them, and gbrain access check. Then gbrain serve
//              --http, and the in-process world runs only as the /gbrain tap and its OAuth issuer, the provider wiring the C4
//              cells use (harnesses/qm/memory-provider.ts); QM's per-turn recall and its memory tool reach gbrain only that way.
//              The sandbox holds the same files as plain's (frozen 2026-11-25: both arms get the same HOME and files). After the
//              session the brain is exported (readBrainExport).
//
// QM's stored turns (Postgres items) are read after each turn into logs/turns/turn-NNNN.qm-items.json, which the QM parser
// reads (parseQmTurn). The trial token and the gbrain token are scrubbed from every file and the canary scan must come back clean.

import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { Termination, TrialRecord, TrialUsage, TurnRequest } from '../contracts.ts';
import { RunnerError } from '../errors.ts';
import { cellModels, type Cell } from '../run.ts';
import { HarnessGone, type Harness, awaitResponse, makeTrialDirs, writeAtomic, writeRequest } from './harness.ts';
import { RESTART_PORT_WAIT_MS, startComposeHarness, waitPortFree } from './docker.ts';
import { reconcile, summarizeUsage, trialKey, trialSlug, trialToken } from './proxy.ts';
import { type TrialContext, classify, foreignModels, gbrainUpstream, trialTermination } from './trial.ts';
import { InstallLeak, canaryScan, scrubToken } from './install.ts';
import { TrialWorld } from './world.ts';
import { callGbrainReply, waitHealthy } from './gbrain.ts';
import { memoryProviderWiring } from '../../harnesses/qm/memory-provider.ts';
import { FIRST_WOW_SLICE, PERSON_REPLY, QM_ACTOR_ID, QM_CONFIG, QUESTION_BUDGET_S, SETUP_TIMEOUT_S, accessCheckOk, brainHostImage, brainHostSteps, imageFor, seedOfTask, type FirstWowCellConfig } from './first-wow-cell.ts';
import { needsPerson, scoreFirstWow, type FirstWowTurn, type TrialFirstWow } from './first-wow.ts';
import { type NEvent, parseQmTurn } from '../../scripts/gbrain-install/transcript.ts';
import { HOME_DIR, buildFixture, personaFor, questionPrompt, writeFixture } from '../../scripts/gbrain-first-wow/fixtures.ts';
import { type Arm, type BrainPage, readBrainExport } from '../../scripts/gbrain-first-wow/score.ts';

/** Where a QM plain trial's HOME sits for the agent, and how the agent may name it (HOME is /root in the sandbox). */
export const QM_FILE_ROOTS = ['/root/workspace', '~/workspace'] as const;
const CONVERSATION = 'first-wow';
const SANDBOX_BASE = 'harness-eval/qm-sandbox:dev';
/** QM core listens on the host network at compose.yaml's default port, so each trial waits for the last trial's core to let go. */
const QM_CORE_HOST_PORT = 58080;
const GBRAIN_TOKEN_RE = /gbrain_[0-9a-f]{16,}/g;
const redact = (s: string) => s.replace(GBRAIN_TOKEN_RE, 'gbrain_<redacted>');

async function sh(args: string[], timeoutMs = 120_000): Promise<{ status: number | null; stdout: string; stderr: string; ms: number }> {
  const t0 = Date.now();
  const proc = Bun.spawn(args, { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
  try {
    const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { status, stdout, stderr, ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

/** Both arms' sandbox image: SANDBOX_BASE with the fixture's HOME at /root/workspace (harnesses/qm/Dockerfile.sett). The tag
 *  names the base image id and the files, so a seed's image is reused. */
export function seededSandboxImage(homeDir: string, repoRoot: string): string {
  const baseId = spawnSync('docker', ['image', 'inspect', '-f', '{{.Id}}', SANDBOX_BASE], { encoding: 'utf8' });
  if (baseId.status !== 0) throw new RunnerError('HE-RUN-006', `the QM sandbox image ${SANDBOX_BASE} is missing; fix: docker build -f harnesses/qm/Dockerfile.sandbox -t ${SANDBOX_BASE} harnesses/qm`);
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const files = walk(homeDir).map((p) => p.slice(homeDir.length + 1) + '\0' + createHash('sha256').update(readFileSync(p)).digest('hex')).sort();
  const tag = 'harness-eval/qm-sandbox:fw-' + createHash('sha256').update(baseId.stdout.trim() + '\n' + files.join('\n')).digest('hex').slice(0, 12);
  if (spawnSync('docker', ['image', 'inspect', tag], { stdio: 'ignore' }).status === 0) return tag;
  const b = spawnSync('docker', ['build', '-q', '-f', join(repoRoot, 'harnesses', 'qm', 'Dockerfile.sett'), '--build-arg', 'BASE=' + SANDBOX_BASE, '-t', tag, homeDir], { encoding: 'utf8' });
  if (b.status !== 0) throw new RunnerError('HE-RUN-006', `building the first-wow QM sandbox image ${tag} failed: ${(b.stderr || b.stdout).trim().slice(-400)}`);
  return tag;
}

export interface BrainHostRecord {
  image: string; image_record: unknown; url: string | null;
  steps: Array<{ id: string; argv: string[]; exit: number | null; ms: number }>;
  preview: Record<string, unknown> | null; import: Record<string, unknown> | null;
  access_check: { ok: boolean; verdict: string | null; reads_now: string[] } | null;
  /** A direct query under QM's token for the planted flag value: the slugs it returned and whether an imported page held it. */
  token_reads_import: { slugs: string[]; holds_value: boolean } | null;
}

const json = (s: string): Record<string, unknown> | null => { try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null; } catch { return null; } };

export async function runFirstWowQmTrial(ctx: Omit<TrialContext, 'grade'> & { keyEnv?: Record<string, string | undefined> }): Promise<TrialRecord> {
  const { cell, trial, opts, log } = ctx;
  const fw = (cell as Cell & { first_wow: FirstWowCellConfig }).first_wow;
  const repoRoot = resolve(opts.repoRoot ?? '.');
  if (opts.harnessMode !== 'docker') throw new RunnerError('HE-NET-001', `cell ${cell.id}: a first-wow QM trial runs in docker mode`);
  const seed = seedOfTask(trial.task);
  if (seed === null) throw new RunnerError('HE-PREREG-007', `trial ${trial.id}: task ${trial.task} is not a seed-NNNN task`);
  const started = Date.now();
  const started_at = new Date(started).toISOString();
  if (existsSync(ctx.trialDir)) for (const e of readdirSync(ctx.trialDir)) rmSync(join(ctx.trialDir, e), { recursive: true, force: true });
  const dirs = makeTrialDirs(ctx.trialDir);
  // QM's question 3 sits in Codex history: QM trials use the claude-code home (PREREGISTRATION.md, Fixtures).
  const fixture = buildFixture(seed, personaFor(seed), 'claude-code', started);
  const homeDir = join(dirs.root, 'home');
  writeFixture(fixture, homeDir, join(dirs.root, 'fixture.json'));
  const manifest = fixture.manifest;
  const native = fw.arm === 'qm-native';
  const config = QM_CONFIG[fw.arm]!;
  const readTool = fw.provider_read ?? 'recall';
  const image = imageFor(cell as Cell & { first_wow: FirstWowCellConfig });
  const key = trialKey(trial.id);
  const token = trialToken(trial.id);
  const slot = trialSlug(trial.id);
  const provider = cell.model.slice(0, cell.model.indexOf(':'));
  const modelName = cell.model.slice(cell.model.indexOf(':') + 1);
  const proxy = ctx.proxy;
  const gbrainDir = join(dirs.root, 'gbrain');
  mkdirSync(gbrainDir, { recursive: true, mode: 0o700 });
  const brainName = `he-fwbrain-${slot}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const project = `he-${slot.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  let gbrainToken = '';
  let record: TrialRecord | null = null;
  let thrown: unknown = null;
  try {
    const paths: Record<string, string> = { dir: dirs.root, logs: dirs.logs, fixture: join(dirs.root, 'fixture.json'), first_wow: join(dirs.root, 'first-wow.json') };
    if (proxy) { paths.usage = join(dirs.root, 'usage.json'); paths.reconcile = join(dirs.root, 'reconcile.json'); }
    if (native) paths.events = join(dirs.root, 'events.jsonl');
    log(`first-wow QM trial ${trial.id}: arm ${fw.arm} (config ${config}${native ? `, provider read ${readTool}` : ''}), seed ${seed} (${manifest.persona})`);

    let harness: Harness | null = null;
    let world: TrialWorld | null = null;
    let readyFailure: HarnessGone | null = null;
    let error: string | undefined;
    let setupError = false;
    let infra: string | null = null;
    let usage: TrialUsage | null = null;
    let capStop = false;
    let modelMismatch = false;
    let ended = false;
    let brain: BrainPage[] = [];
    let exportOk: boolean | null = null;
    let sandboxImage = SANDBOX_BASE;
    const brainHost: BrainHostRecord | null = native ? { image: brainHostImage(fw.gbrain_commit!), image_record: null, url: null, steps: [], preview: null, import: null, access_check: null, token_reads_import: null } : null;
    const turns: FirstWowTurn[] = [];
    const events: NEvent[] = [];
    const note = (msg: string) => { log(msg); error = error ? `${error}; ${msg}` : msg; };
    const execBrain = (argv: string[], timeoutS = SETUP_TIMEOUT_S) => sh(['docker', 'exec', '-w', HOME_DIR, brainName, 'env', '-i', `HOME=${HOME_DIR}`, 'PATH=/usr/local/bin:/usr/bin:/bin', 'NO_COLOR=1', 'GBRAIN_SKIP_STARTUP_HOOKS=1', 'timeout', String(timeoutS), ...argv], (timeoutS + 30) * 1000);
    const storeItems = async (n: number) => {
      const q = "select coalesce(json_agg(row_to_json(i) order by i.session_id, i.seq), '[]') from items i";
      const r = await sh(['docker', 'exec', `${project}-pg-1`, 'psql', '-U', 'postgres', '-d', 'qm', '-At', '-c', q]);
      writeFileSync(join(dirs.logs, 'turns', `turn-${String(n).padStart(4, '0')}.qm-items.json`), r.status === 0 ? r.stdout.trim() : '[]');
      if (r.status !== 0) log(`turn ${n}: reading QM's stored items failed: ${r.stderr.trim().slice(0, 300)}`);
    };

    const ask = async (role: FirstWowTurn['role'], text: string): Promise<FirstWowTurn | null> => {
      if (ended || !harness) return null;
      const n = turns.length + 1;
      const req: TurnRequest = { turn: n, trial_id: trial.id, prompt: text, actor: { member: 'user', slack_user_id: QM_ACTOR_ID, name: 'User', role: 'user', team: null },
        channel: { id: 'D0FIRSTWOW', name: CONVERSATION, type: 'dm' }, text, ts: (Date.now() / 1000).toFixed(6), thread_ts: null, sim_now: new Date().toISOString(), time_budget_s: QUESTION_BUDGET_S };
      const turnStart = new Date().toISOString();
      writeRequest(dirs.turns, req);
      let exit = 0;
      let reply: string | null = null;
      try {
        const res = await awaitResponse(dirs.turns, n, (QUESTION_BUDGET_S + opts.turnGraceS) * 1000, harness);
        if (!res) { log(`turn ${n}: HE-ADAPTER-003 no response after ${QUESTION_BUDGET_S + opts.turnGraceS} s; killing the harness, exit 124`); await harness.kill(); exit = 124; ended = true; }
        else { exit = [0, 2, 3, 124].includes(Number(res.exit)) ? Number(res.exit) : 2; reply = res.reply_text ?? null; }
      } catch (e) {
        if (!(e instanceof HarnessGone)) throw e;
        exit = e.exit === 3 ? 3 : 2; ended = true; log(`turn ${n}: ${e.message}`);
      }
      const ended_at = new Date().toISOString();
      await storeItems(n);
      const ev = parseQmTurn(dirs.logs, n, CONVERSATION);
      events.push(...ev);
      const t: FirstWowTurn = { turn: n, role, reply_text: reply, exit, started_at: turnStart, ended_at, events: ev.length };
      turns.push(t);
      log(`turn ${n} (${role}): exit ${exit}, ${ev.length} transcript events`);
      return t;
    };

    try {
      if (proxy) await proxy.bind(slot, key, token, cellModels(cell));
      const coreEnv: Record<string, string> = {};
      const origins: string[] = [];
      if (/\/particle\/?$/.test(proxy ? proxy.baseUrlFor(slot, provider, true) : '')) origins.push(new URL(proxy!.baseUrlFor(slot, provider, true)).origin);
      try {
        // Before the brain host writes its brain into the HOME, so both arms' sandboxes hold the fixture's files and nothing else.
        sandboxImage = seededSandboxImage(homeDir, repoRoot);
        log(`${fw.arm}: sandbox image ${sandboxImage} holds the fixture's HOME at /root/workspace`);
        if (native) {
          const bh = brainHost!;
          const net = `${brainName}-net`;
          await sh(['docker', 'rm', '-f', brainName]);
          await sh(['docker', 'network', 'rm', net]);
          const mk = await sh(['docker', 'network', 'create', '--driver', 'bridge', net]);
          if (mk.status !== 0) throw new RunnerError('HE-GBRAIN-002', `docker network create ${net} failed: ${mk.stderr.trim().slice(0, 300)}`);
          const run = await sh(['docker', 'run', '-d', '--name', brainName, '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, '--network', net, '-p', '127.0.0.1:0:3131',
            '--entrypoint', 'sleep', '-v', `${resolve(homeDir)}:${HOME_DIR}`, '-v', `${resolve(gbrainDir)}:/he-gbrain`, bh.image, 'infinity']);
          if (run.status !== 0) throw new RunnerError('HE-GBRAIN-002', `the brain host ${bh.image} did not start: ${run.stderr.trim().slice(0, 300)}; fix: bash harnesses/_first-wow/build.sh ${fw.gbrain_commit} ${fw.gbrain_version} claude-code`);
          const probe = await execBrain(['sh', '-c', 'cat /opt/first-wow/image.json'], 30);
          bh.image_record = probe.stdout.trim();
          const rec = json(probe.stdout.trim());
          if (rec?.gbrain_commit !== fw.gbrain_commit || rec?.gbrain_version !== fw.gbrain_version)
            throw new RunnerError('HE-FIRSTWOW-001', `brain host ${bh.image} records gbrain ${probe.stdout.trim().slice(0, 200)}, not the cell's ${fw.gbrain_commit} (${fw.gbrain_version}); fix: bash harnesses/_first-wow/build.sh ${fw.gbrain_commit} ${fw.gbrain_version} claude-code`);
          const tokenName = `qm-${slot}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
          for (const step of brainHostSteps(tokenName)) {
            const r = await execBrain(step.argv);
            if (step.id === 'token') {
              gbrainToken = (r.stdout.match(GBRAIN_TOKEN_RE) ?? [])[0] ?? '';
              if (gbrainToken) { writeFileSync(join(gbrainDir, 'token'), gbrainToken, { mode: 0o600 }); chmodSync(join(gbrainDir, 'token'), 0o600); }
            }
            writeFileSync(join(gbrainDir, `${step.id}.out`), redact(r.stdout) + (r.stderr ? '\n--- stderr\n' + redact(r.stderr) : ''));
            bh.steps.push({ id: step.id, argv: step.argv, exit: r.status, ms: r.ms });
            log(`brain host ${step.id}: exit ${r.status} in ${r.ms} ms`);
            if (step.id === 'preview') bh.preview = json(r.stdout);
            if (step.id === 'run') bh.import = json(r.stdout);
            if (step.id === 'access_check') bh.access_check = accessCheckOk(r.stdout, Number(bh.import?.sessions_imported ?? 0) > 0);
            // The no-history fixture has nothing to import: preview and run report it and exit non-zero; that is the fallback, not a failure.
            const nothing = manifest.persona === 'no-history' && (step.id === 'preview' || step.id === 'run');
            if ((r.status !== 0 && !nothing) || (step.id === 'token' && !gbrainToken)) { setupError = true; note(`HE-FIRSTWOW-003 trial ${trial.id}: brain host step ${step.id} exited ${r.status}; see gbrain/${step.id}.out`); break; }
          }
          if (!setupError && !bh.access_check?.ok) { setupError = true; note(`HE-FIRSTWOW-005 trial ${trial.id}: gbrain access check does not show QM's token as the owner reading the imported archive (${JSON.stringify(bh.access_check)}); the trial stops as a setup error`); }
          if (!setupError) {
            await sh(['docker', 'exec', '-d', '-w', HOME_DIR, brainName, 'env', '-i', `HOME=${HOME_DIR}`, 'PATH=/usr/local/bin:/usr/bin:/bin', 'NO_COLOR=1', 'GBRAIN_SKIP_STARTUP_HOOKS=1', 'GBRAIN_HTTP_RATE_LIMIT_IP=1000000', 'GBRAIN_HTTP_RATE_LIMIT_TOKEN=1000000', 'GBRAIN_OAUTH_TOKEN_RATE_LIMIT_MAX=1000000',
              'sh', '-c', 'addr=$(hostname -i | tr " " "\\n" | grep -m1 -E "^[0-9]+(\\.[0-9]+){3}$") && exec gbrain serve --http --port 3131 --bind "$addr" --suppress-bootstrap-token >> /he-gbrain/serve.log 2>&1']);
            const port = (await sh(['docker', 'port', brainName, '3131/tcp'])).stdout.trim().split('\n')[0]?.split(':').pop();
            if (!port) throw new RunnerError('HE-GBRAIN-002', 'docker port reported no published port for the brain host');
            bh.url = `http://127.0.0.1:${port}`;
            await waitHealthy(bh.url, 60_000, async () => null);
            const flag = manifest.questions.find((q) => q.kind === 'flag')?.answer;
            if (flag) {
              const r = await callGbrainReply(bh.url, gbrainToken, 'query', { query: flag }).catch((e: Error) => ({ payload: { error: e.message }, meta: null }));
              const rows = Array.isArray(r.payload) ? r.payload as Array<{ slug?: string; chunk_text?: string }> : [];
              bh.token_reads_import = { slugs: rows.map((x) => String(x.slug ?? '')), holds_value: rows.some((x) => String(x.slug ?? '').startsWith('conversations/') && String(x.chunk_text ?? '').includes(flag)) };
            }
            world = new TrialWorld({ trialId: trial.id, split: 'dev', actors: [], outDir: dirs.root, reachableFromContainers: true });
            const wiring = memoryProviderWiring({ mcpUrl: `${world.harnessUrl}/gbrain`, actor: world.botMember.id, readTool });
            world.server.setGbrain(gbrainUpstream({ url: bh.url, token: gbrainToken, tokens: null, grants: null, ingest: null }, wiring.provider));
            Object.assign(coreEnv, wiring.coreEnv);
            origins.push(new URL(world.harnessUrl).origin);
            log(`QM memory provider: MEMORY_PROVIDER_CONFIG ${JSON.stringify(wiring.config)}; the world runs as the /gbrain tap and OAuth issuer only (no world MCP server is registered)`);
          }
        }
        if (!setupError) {
          if (origins.length) coreEnv.PRIVATE_NETWORK_ALLOWED_ORIGINS = [...new Set(origins)].join(',');
          const env: Record<string, string> = {
            HE_MODEL_BASE_URL: proxy ? proxy.baseUrlFor(slot, provider, true) : 'http://127.0.0.1:1/none', HE_MODEL_API_KEY: token, HE_MODEL_NAME: modelName,
            HE_TIME_BUDGET_S: String(QUESTION_BUDGET_S), HE_LOG_DIR: '/he-logs', HE_SESSION_STATE_DIR: '/harness-state', HE_HARNESS_CONFIG: config,
            HE_TASK_SLICE: FIRST_WOW_SLICE, HE_TRIAL_ID: trial.id, HE_TURNS_DIR: '/he-turns', HE_QM_WORLD: 'off', HE_QM_DEFAULT_SANDBOX_SCOPE: `personal:${QM_ACTOR_ID}`, ...(opts.harnessEnv ?? {}),
          };
          if (!(await waitPortFree(QM_CORE_HOST_PORT, RESTART_PORT_WAIT_MS))) log(`QM core's host port ${QM_CORE_HOST_PORT} is still busy after ${RESTART_PORT_WAIT_MS / 1000} s; starting anyway`);
          harness = await startComposeHarness({ harness: 'qm', image, trialSlug: slot, dirs, env, composeFile: join(repoRoot, 'harnesses', 'qm', 'compose.yaml'), timeBudgetS: QUESTION_BUDGET_S, repoRoot,
            stackEnv: { HE_MODEL_BASE_URL: env.HE_MODEL_BASE_URL!, HE_MODEL_API_KEY: token, HE_MODEL_NAME: modelName, HE_TIME_BUDGET_S: env.HE_TIME_BUDGET_S!, HE_TASK_SLICE: FIRST_WOW_SLICE, HE_TRIAL_ID: trial.id, HE_HARNESS_CONFIG: config, QM_SANDBOX_IMAGE: sandboxImage },
            coreEnv, modelProvider: provider });
          await harness.waitReady(opts.readyTimeoutS * 1000);
          log('harness ready (compose, HE_QM_WORLD=off, default sandbox made)');
        }
      } catch (e) {
        if (!(e instanceof HarnessGone)) throw e;
        readyFailure = e;
        note(`HE-ADAPTER-002 ${e.message}`);
      }
      if (!readyFailure && !setupError && harness) {
        const q = await ask('question', questionPrompt(manifest));
        if (q?.reply_text && q.exit === 0 && needsPerson(q.reply_text)) await ask('person', PERSON_REPLY);
      }
      if (harness) await harness.stop(opts.stopGraceS * 1000);
      if (native && brainHost?.url && !setupError && !readyFailure && turns.length > 0 && turns.every((t) => t.exit === 0)) {
        // PGLite takes one process: stop serve, then export into a fresh directory.
        await sh(['docker', 'exec', brainName, 'pkill', '-TERM', '-f', 'gbrain serve']);
        for (let i = 0; i < 30 && (await sh(['docker', 'exec', brainName, 'pgrep', '-f', 'gbrain serve'])).status === 0; i++) await Bun.sleep(500);
        const r = await execBrain(['gbrain', 'export', '--dir', '/he-gbrain/brain-export']);
        writeFileSync(join(gbrainDir, 'export.out'), redact(r.stdout + r.stderr));
        try { brain = readBrainExport(join(gbrainDir, 'brain-export')); exportOk = true; }
        catch (e) { exportOk = false; infra = `HE-FIRSTWOW-004 trial ${trial.id}: ${(e as Error).message}; the trial is infra_error`; note(infra); }
      }
      if (proxy) {
        const meter = await proxy.finalize(key);
        const lines = proxy.usageLines(key);
        const summary = summarizeUsage(key, meter, lines);
        usage = summary.usage;
        capStop = summary.cap_stop;
        const foreign = foreignModels(cell.model, usage.by_model, lines, 'off', cell.utility_models ?? []);
        if (foreign.length) { modelMismatch = true; note(`HE-MODEL-001 trial ${trial.id} ran model(s) ${foreign.join(', ')} beside the cell's ${cell.model}; the trial is model_error`); }
        writeAtomic(paths.usage!, JSON.stringify(usage, null, 1) + '\n');
        writeAtomic(paths.reconcile!, JSON.stringify(reconcile(key, meter, lines), null, 1) + '\n');
      }
    } finally {
      if (harness) await harness.stop(opts.stopGraceS * 1000).catch(() => undefined);
      if (native) {
        const logs = await sh(['docker', 'logs', brainName]);
        writeFileSync(join(gbrainDir, 'docker.log'), redact(logs.stdout + logs.stderr));
        await sh(['docker', 'rm', '-f', brainName]);
        await sh(['docker', 'network', 'rm', `${brainName}-net`]);
      }
      world?.stop();
      if (proxy) await proxy.unbind(slot).catch(() => undefined);
    }

    const setupOutput = brainHost ? [brainHost.preview, brainHost.import].map((x) => JSON.stringify(x)).join('\n') : '';
    const readFile = (rel: string) => { try { return readFileSync(join(dirs.workspace, rel), 'utf8'); } catch { return null; } };
    const score = turns.length ? scoreFirstWow({ manifest, arm: fw.arm as Arm, replies: turns.map((t) => t.reply_text), events, brain, readFile, setupOutput, fileRoots: QM_FILE_ROOTS }) : null;
    const exits = turns.map((t) => t.exit);
    const fromExits: Termination = readyFailure ? classify([], readyFailure, null, false) : setupError ? 'harness_error' : classify(exits, null, null, false);
    const decided = trialTermination({ cellModel: cell.model, fromExits, since: started_at, lines: proxy ? proxy.usageLines(key) : [], capStop, modelMismatch, infra: !!infra });
    if (decided.note) note(decided.note);
    const imported = Number(brainHost?.import?.sessions_imported);
    const firstWow: TrialFirstWow & { qm: unknown } = {
      arm: fw.arm, seed, persona: manifest.persona, gbrain_commit: fw.gbrain_commit ?? null, image, image_record: brainHost?.image_record ?? null,
      setup: (brainHost?.steps ?? []).map((s) => ({ argv: s.argv, exit: s.exit ?? -1, ms: s.ms, history: s.id === 'run' ? brainHost!.import : s.id === 'preview' ? brainHost!.preview : null })),
      setup_ms: (brainHost?.steps ?? []).reduce((a, s) => a + s.ms, 0), registration: null,
      sessions_imported: native ? (Number.isFinite(imported) ? imported : 0) : null,
      brain_pages: native && exportOk ? brain.length : null, export_ok: exportOk,
      question_ms: turns.length ? Date.parse(turns[turns.length - 1]!.ended_at) - Date.parse(turns[0]!.started_at) : null,
      person_needed: turns.filter((t) => t.role === 'person').length, turns, score,
      qm: { config, provider_read: native ? readTool : null, sandbox_image: sandboxImage, brain_host: brainHost },
    };
    writeAtomic(paths.first_wow!, JSON.stringify(firstWow, null, 1) + '\n');
    if (world) writeAtomic(paths.events!, world.events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    const s = score as { finish_any?: boolean; correct_abstention?: boolean } | null;
    log(`first-wow QM trial ${trial.id}: ${decided.termination}, ${manifest.persona === 'no-history' ? `abstained ${s?.correct_abstention}` : `finish ${s?.finish_any}`}, sessions imported ${firstWow.sessions_imported}, access check ${brainHost?.access_check?.ok ?? 'n/a'}, brain pages ${firstWow.brain_pages}`);
    const endedAt = Date.now();
    record = {
      trial_id: trial.id, cell: cell.id, task: trial.task, harness: cell.harness, harness_mode: 'docker', model: cell.model, script: null,
      termination: decided.termination, grade: 'n/a', consent_violation: false, approval_stop: false, effects: [], predicates: [], cap_stop: capStop,
      turns: { planned: 2, run: turns.length, exits }, usage, wall_ms: endedAt - started, started_at, ended_at: new Date(endedAt).toISOString(), paths,
      ...(error ? { error } : {}), first_wow: firstWow,
    };
  } catch (e) {
    thrown = e;
    throw e;
  } finally {
    if (gbrainToken) scrubToken(dirs.root, gbrainToken);
    rmSync(join(gbrainDir, 'token'), { force: true });
    const scrubbed = scrubToken(dirs.root, token);
    const canary = canaryScan(dirs.root, token, ctx.keyEnv ?? process.env);
    const found = canary.token_files.length > 0 || canary.key_names.length > 0;
    log(`first-wow QM trial ${trial.id}: token scrubbed from ${scrubbed.length} file(s); canary ${found ? 'FOUND' : 'clean'}`);
    if (found) throw new InstallLeak(record, `HE-INSTALL-005 after first-wow QM trial ${trial.id}${thrown ? ' (which threw)' : ''}: ${canary.token_files.length ? `the trial token is still in ${canary.token_files.join(', ')}` : ''}${canary.key_names.length ? ` provider key value(s) of ${canary.key_names.join(', ')} found` : ''}; the run stops`);
  }
  return record!;
}
