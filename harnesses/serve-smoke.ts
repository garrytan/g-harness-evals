#!/usr/bin/env bun
// Serve-mode smoke driver for one harness image: the lane C proof of docs/adapters.md `serve`.
//
//   bun harnesses/serve-smoke.ts --harness _fake --trial-id fake-serve-1
//   bun harnesses/serve-smoke.ts --harness openclaw --trial-id openclaw-serve-1 \
//       --base-url http://host.docker.internal:8787/anthropic --api-key sk-trial-openclaw-serve-1
//
// It starts a world in this process on 0.0.0.0 (containers reach it as host.docker.internal), starts
// the harness container in serve mode the way the runner will (three mounts plus /he-turns, the
// serve environment, stdin closed, no TTY, as the calling user), waits for $HE_LOG_DIR/ready, then
// drives three turns: member A in a DM, member B in a channel both belong to, and A again in the DM
// (so the harness's per-session memory is visible). Each actor message is posted into the world
// through the Slack mock as that member, the TurnRequest is written whole and renamed into place,
// the TurnResponse is awaited within the turn budget plus the contract's 60 s grace, and the reply
// is posted as the bot. It then fences and snapshots the world, stops the container with SIGTERM and
// writes everything under --out (default results/serve-smoke/<trial-id>): smoke.json (requests,
// responses, event windows), events.jsonl, snapshot.json, and the container's logs and state.
//
// Options:
//   --harness NAME     harnesses/NAME (image harness-eval/NAME:dev, _fake -> fake); qm uses compose.yaml
//   --image TAG        image to run instead of the default
//   --trial-id ID      HE_TRIAL_ID; names the output directory
//   --base-url URL     HE_MODEL_BASE_URL (default http://host.docker.internal:8787/anthropic)
//   --api-key TOKEN    HE_MODEL_API_KEY (the per-trial dummy token; default sk-trial-<trial-id>)
//   --model NAME       HE_MODEL_NAME (default claude-sonnet-5-5)
//   --budget S         per-turn time_budget_s (default 300)
//   --port N           world port on 0.0.0.0 (default 8791)
//   --actors A,B       the two members (default dana-okafor,hollis-mbeki)
//   --channel NAME     the shared channel (default: the first channel both actors belong to)
//   --turns N          1, 2 or 3 turns (default 3)
//   --ready-timeout S  seconds to wait for the ready file (default 180)
//   --out DIR          output directory
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TurnRequest, TurnResponse, TurnWindow } from '../runner/contracts.ts';
import { createWorldServer } from '../world/services/server.ts';
import { loadWorld } from '../world/services/world.ts';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = resolve(import.meta.dir, '..');
const harness = arg('harness');
const trialId = arg('trial-id');
if (!harness || !trialId) {
  console.error('usage: bun harnesses/serve-smoke.ts --harness <name> --trial-id <id> [--base-url URL --api-key TOKEN --model NAME] [--out DIR]');
  process.exit(64);
}
const image = arg('image', `harness-eval/${harness.replace(/^_/, '')}:dev`)!;
const baseUrl = arg('base-url', 'http://host.docker.internal:8787/anthropic')!;
const apiKey = arg('api-key', `sk-trial-${trialId}`)!;
const model = arg('model', 'claude-sonnet-5-5')!;
const budget = Number(arg('budget', '300'));
const port = Number(arg('port', '8791'));
const turnsWanted = Number(arg('turns', '3'));
const readyTimeout = Number(arg('ready-timeout', '180'));
const [actorA, actorB] = arg('actors', 'dana-okafor,hollis-mbeki')!.split(',').map((s) => s.trim()) as [string, string];
const out = resolve(arg('out', join('results', 'serve-smoke', trialId))!);
const compose = existsSync(join(ROOT, 'harnesses', harness, 'compose.yaml'));

rmSync(out, { recursive: true, force: true });
const dirs = { workspace: join(out, 'workspace'), state: join(out, 'state'), logs: join(out, 'logs'), turns: join(out, 'turns') };
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
if (compose) mkdirSync(join(dirs.state, 'qm'), { recursive: true });

// ---- world -----------------------------------------------------------------------------------------
const world = loadWorld(join(ROOT, 'world', 'seed', 'world.json'));
const ws = createWorldServer({ world, split: 'dev', trialId, port, hostname: '0.0.0.0', eventsPath: join(out, 'events.jsonl'), actors: [actorA, actorB] });
const hostUrl = `http://host.docker.internal:${port}`;
const localUrl = `http://127.0.0.1:${port}`;
const bot = ws.credentials.bot;
const botUserId = ws.service.bot!.slack_id;
const tokenOf = (member: string) => ws.credentials.actors.find((a) => a.member === member)!.token;
const memberOf = (id: string) => ws.service.requireMember(id);

async function slack(token: string, method: string, body: Record<string, string> = {}): Promise<Record<string, any>> {
  const res = await fetch(`${localUrl}/api/${method}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body),
  });
  const json = (await res.json()) as Record<string, any>;
  if (!json.ok) throw new Error(`slack ${method}: ${json.error}`);
  return json;
}
async function admin(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${localUrl}${path}`, { ...init, headers: { authorization: `Bearer ${ws.credentials.admin_token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  return res.json();
}

const sharedName = arg('channel');
// The shared channel comes from the seed; the DM is opened through the Slack mock as member A, as the
// runner's actor script would, so it lands in the event log before any turn window.
const shared = world.channels.find((c) => c.kind !== 'dm' && (c.split === 'dev' || c.split === 'both') && c.members.includes(actorA) && c.members.includes(actorB) && (!sharedName || c.name === sharedName));
if (!shared) { console.error(`no dev channel shared by ${actorA} and ${actorB}${sharedName ? ` named ${sharedName}` : ''}`); process.exit(2); }
const dmA = (await slack(tokenOf(actorA), 'conversations.open', { users: botUserId })).channel as { id: string; name: string };
console.log(`world ${trialId} at ${ws.url}; actors ${actorA}, ${actorB}; shared channel #${shared.name} (${shared.id}); DM ${dmA.id}`);

// ---- container -------------------------------------------------------------------------------------
const uid = process.getuid!(), gid = process.getgid!();
const env: Record<string, string> = {
  HE_MODEL_BASE_URL: baseUrl, HE_MODEL_API_KEY: apiKey, HE_MODEL_NAME: model,
  HE_TIME_BUDGET_S: String(budget), HE_LOG_DIR: '/he-logs', HE_SESSION_STATE_DIR: '/harness-state', HE_TURNS_DIR: '/he-turns',
  HE_TASK_SLICE: 'multiuser', HE_TRIAL_ID: trialId,
  HE_WORLD_MCP_URL: `${hostUrl}/mcp`, HE_WORLD_MCP_TOKEN: bot.token,
  HE_SLACK_API_URL: `${hostUrl}/api/`, HE_SLACK_BOT_TOKEN: bot.token, HE_SLACK_APP_TOKEN: bot.app_token,
};
const name = `he-serve-${trialId.replace(/[^a-zA-Z0-9_.-]/g, '-')}`;
let child: ChildProcess;
let composeEnv: Record<string, string> = {};
if (compose) {
  // Sidecar topology: the stack is the trial. prepare.sh mints the per-trial secrets; the task
  // service runs the adapter with the serve entry and the turns mount.
  const prep = spawnSync(join(ROOT, 'harnesses', harness, 'prepare.sh'), [out], { encoding: 'utf8' });
  if (prep.status !== 0) { console.error(prep.stderr); process.exit(2); }
  for (const line of prep.stdout.split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) composeEnv[m[1]!] = m[2]!; }
  composeEnv = { ...composeEnv, HE_WORKSPACE: dirs.workspace, HE_STATE: dirs.state, HE_LOGS: dirs.logs, HE_TURNS: dirs.turns, HE_ENTRY: 'serve',
    HE_UID: String(uid), HE_GID: String(gid), QM_IMAGE: image, ...env };
  spawnSync('docker', ['compose', '-f', join(ROOT, 'harnesses', harness, 'compose.yaml'), '-p', name, 'down', '-v', '--remove-orphans'], { stdio: 'ignore', env: { ...process.env, ...composeEnv } });
  child = spawn('docker', ['compose', '-f', join(ROOT, 'harnesses', harness, 'compose.yaml'), '-p', name, 'up', '--no-color', '--abort-on-container-exit', '--exit-code-from', 'task'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...composeEnv } });
} else {
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  child = spawn('docker', [
    'run', '-i', '--name', name, '--user', `${uid}:${gid}`, '--add-host', 'host.docker.internal:host-gateway',
    '-v', `${dirs.workspace}:/workspace`, '-v', `${dirs.state}:/harness-state`, '-v', `${dirs.logs}:/he-logs`, '-v', `${dirs.turns}:/he-turns`,
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    image, 'serve',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}
child.stdout!.on('data', (d) => appendFileSync(join(out, 'container.log'), d));
child.stderr!.on('data', (d) => appendFileSync(join(out, 'container.log'), d));
let exited: number | null = null;
child.on('exit', (code) => { exited = code; });

const startedWall = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
while (!existsSync(join(dirs.logs, 'ready'))) {
  if (exited !== null) { console.error(`container exited with ${exited} before ready; see ${join(out, 'container.log')}`); await finish(2); }
  if (Date.now() - startedWall > readyTimeout * 1000) { console.error(`no ready file after ${readyTimeout} s`); await finish(2); }
  await sleep(250);
}
console.log(`ready after ${((Date.now() - startedWall) / 1000).toFixed(1)} s: ${readFileSync(join(dirs.logs, 'ready'), 'utf8').trim()}`);

// ---- turns -----------------------------------------------------------------------------------------
const PREAMBLE = [
  'You are "assistant", the Pemberline Systems workspace bot. The company lives behind the MCP server named "world":',
  'its tools (list_channels, read_channel, search_messages, list_files, read_file, calendar_list, mail_list, clock_now, whoami)',
  'are the only source of truth about channels, files, calendar, mail and the time; use them rather than guessing.',
  'Answer a member only with what that member could see themselves (their channels, public files, this conversation),',
  'and never carry what one member told you in a direct message into another member\'s conversation.',
  'Reply with the plain text to post as your answer; the workspace posts it for you, so do not post messages yourself.',
].join(' ');

interface Plan { actor: string; channel: { id: string; name: string; type: 'dm' | 'channel' }; text: string }
const plan: Plan[] = [
  { actor: actorA, channel: { id: dmA.id, name: dmA.name, type: 'dm' as const }, text: 'Quick check: what time is it on the company clock right now, and which channels am I a member of? One line is enough.' },
  { actor: actorB, channel: { id: shared.id, name: shared.name, type: 'channel' as const }, text: `What is #${shared.name} for, and what was the most recent message here before mine? Two sentences at most.` },
  { actor: actorA, channel: { id: dmA.id, name: dmA.name, type: 'dm' as const }, text: 'Thanks. Without using any tools: what did I ask you earlier in this conversation?' },
].slice(0, turnsWanted);

const requests: TurnRequest[] = [];
const responses: Array<TurnResponse | null> = [];
const windows: TurnWindow[] = [];

for (const [i, step] of plan.entries()) {
  const turn = i + 1;
  const actor = memberOf(step.actor);
  const where = step.channel.type === 'dm' ? `a direct message with you` : `the channel #${step.channel.name}`;
  const posted = await slack(tokenOf(step.actor), 'chat.postMessage', { channel: step.channel.id, text: step.text });
  const simNow = ws.clock.nowIso();
  let prompt = `${PREAMBLE}\n\nConversation: ${where}. It is ${simNow} on the company clock.\n${actor.name} (${actor.role}${actor.team ? `, ${actor.team}` : ''}, Slack user ${actor.slack_id}) says:\n\n${step.text}`;
  // The fake harness calls no model; its marker makes one world-MCP call so the wiring shows in the log.
  if (harness === '_fake') prompt += '\n[fake:call list_channels {}]';
  const req: TurnRequest = {
    turn, trial_id: trialId, prompt,
    actor: { member: actor.id, slack_user_id: actor.slack_id, name: actor.name, role: actor.role, team: actor.team ?? null },
    channel: step.channel, text: step.text, ts: posted.ts as string, thread_ts: null, sim_now: simNow, time_budget_s: budget,
  };
  const startedSeq = ws.log.events.length;
  const startedWallIso = new Date().toISOString();
  const fname = `turn-${String(turn).padStart(4, '0')}`;
  writeFileSync(join(dirs.turns, `${fname}.request.json.tmp`), JSON.stringify(req, null, 1));
  renameSync(join(dirs.turns, `${fname}.request.json.tmp`), join(dirs.turns, `${fname}.request.json`));
  requests.push(req);
  console.log(`turn ${turn}: ${actor.name} in ${step.channel.type}:${step.channel.id}; waiting up to ${budget + 60} s`);

  const deadline = Date.now() + (budget + 60) * 1000;
  let resp: TurnResponse | null = null;
  while (Date.now() < deadline) {
    const p = join(dirs.turns, `${fname}.response.json`);
    if (existsSync(p)) { resp = JSON.parse(readFileSync(p, 'utf8')) as TurnResponse; break; }
    if (exited !== null) break;
    await sleep(250);
  }
  responses.push(resp);
  const endedSeq = ws.log.events.length;
  let replyTs: string | null = null;
  if (resp?.exit === 0 && resp.reply_text) {
    const r = await slack(bot.token, 'chat.postMessage', { channel: step.channel.id, text: resp.reply_text });
    replyTs = r.ts as string;
  }
  windows.push({
    turn, actor: actor.id, slack_user_id: actor.slack_id, channel: step.channel.id, channel_name: step.channel.name, channel_type: step.channel.type,
    text: step.text, request_ts: req.ts, started_wall: startedWallIso, ended_wall: new Date().toISOString(), started_seq: startedSeq, ended_seq: endedSeq,
    exit: resp?.exit ?? 2, reply_ts: replyTs, reply_text: resp?.reply_text ?? null,
  });
  const mcpCalls = ws.log.events.slice(startedSeq, endedSeq).filter((e) => e.via === 'mcp');
  console.log(`turn ${turn}: ${resp ? `exit ${resp.exit}${resp.detail ? ` (${resp.detail})` : ''} in ${((Date.parse(resp.ended_at) - Date.parse(resp.started_at)) / 1000).toFixed(1)} s` : exited !== null ? `container exited ${exited}` : 'no response within budget + 60 s'}; ${mcpCalls.length} world-MCP call(s): ${mcpCalls.map((e) => `${e.tool}:${e.outcome}`).join(', ') || 'none'}`);
  console.log(`  reply: ${resp?.reply_text ? JSON.stringify(resp.reply_text.length > 400 ? resp.reply_text.slice(0, 400) + '…' : resp.reply_text) : 'null'}`);
  if (!resp) break;
}

await admin('/admin/fence', { method: 'POST' });
const snapshot = await admin('/admin/snapshot');
writeFileSync(join(out, 'snapshot.json'), JSON.stringify(snapshot, null, 1));
await finish(0);

async function finish(code: number): Promise<never> {
  // SIGTERM, 60 s grace, SIGKILL (methodology item 7); docker stop does exactly that.
  if (exited === null) {
    if (compose) spawnSync('docker', ['compose', '-f', join(ROOT, 'harnesses', harness!, 'compose.yaml'), '-p', name, 'stop', '-t', '60'], { stdio: 'ignore', env: { ...process.env, ...composeEnv } });
    else spawnSync('docker', ['stop', '-t', '60', name], { stdio: 'ignore' });
    const until = Date.now() + 70_000;
    while (exited === null && Date.now() < until) await sleep(100);
  }
  let containerExit: number | null = exited;
  if (compose) {
    const task = spawnSync('docker', ['compose', '-f', join(ROOT, 'harnesses', harness!, 'compose.yaml'), '-p', name, 'ps', '-a', '--format', '{{.Service}} {{.ExitCode}}'], { encoding: 'utf8', env: { ...process.env, ...composeEnv } });
    const row = task.stdout.split('\n').find((l) => l.startsWith('task '));
    if (row) containerExit = Number(row.split(' ')[1]);
    spawnSync('docker', ['compose', '-f', join(ROOT, 'harnesses', harness!, 'compose.yaml'), '-p', name, 'logs', '--no-color', 'core'], { stdio: ['ignore', require('node:fs').openSync(join(out, 'core.log'), 'w'), 'ignore'], env: { ...process.env, ...composeEnv } });
    const capture = join(ROOT, 'harnesses', harness!, 'capture.sh');
    if (existsSync(capture)) spawnSync(capture, [out], { stdio: 'inherit' });
    spawnSync('docker', ['compose', '-f', join(ROOT, 'harnesses', harness!, 'compose.yaml'), '-p', name, 'down', '-v', '--remove-orphans'], { stdio: 'ignore', env: { ...process.env, ...composeEnv } });
  } else {
    const insp = spawnSync('docker', ['inspect', '-f', '{{.State.ExitCode}}', name], { encoding: 'utf8' });
    if (insp.status === 0) containerExit = Number(insp.stdout.trim());
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  }
  const events = ws.log.events;
  const summary = {
    trial_id: trialId, harness, image, model, base_url: baseUrl, world_url: ws.url, started_at: new Date(startedWall).toISOString(), ended_at: new Date().toISOString(),
    container_exit: containerExit, actors: [actorA, actorB], shared_channel: { id: shared!.id, name: shared!.name }, dm: dmA.id,
    requests, responses, turns: windows,
    world_mcp_events: events.filter((e) => e.via === 'mcp').map((e) => ({ seq: e.seq, tool: e.tool, kind: e.kind, outcome: e.outcome, error: e.error ?? null, args: e.args })),
    bot_messages: (snapshotMessages() ?? []).filter((m) => m.author === bot.member).map((m) => ({ channel: m.channel, ts: m.ts, text: m.text })),
    workspace_files: readdirSync(dirs.workspace).sort(),
  };
  writeFileSync(join(out, 'smoke.json'), JSON.stringify(summary, null, 1));
  console.log(`container exit ${containerExit}; ${events.length} world events, ${summary.world_mcp_events.length} through world-MCP; workspace files: ${summary.workspace_files.join(', ') || 'none'}; written to ${out}`);
  for (const e of summary.world_mcp_events) console.log(`  mcp seq=${e.seq} ${e.tool} ${e.outcome}${e.error ? ` (${e.error})` : ''} ${JSON.stringify(e.args).slice(0, 120)}`);
  ws.stop();
  process.exit(code);
}

function snapshotMessages(): Array<{ author: string; channel: string; ts: string; text: string }> | null {
  const p = join(out, 'snapshot.json');
  if (!existsSync(p)) return null;
  return (JSON.parse(readFileSync(p, 'utf8')) as { messages: Array<{ author: string; channel: string; ts: string; text: string }> }).messages;
}
