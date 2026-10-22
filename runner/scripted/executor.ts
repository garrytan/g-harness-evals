// The scripted executor: an oracle or mutation (a Script, runner/contracts.ts) played through the same turn
// loop a harness goes through, with no container. It answers the file queue like an adapter: it reads each
// TurnRequest, makes the turn's world-MCP calls over HTTP as the bot, and writes the TurnResponse with the
// script's reply. The runner then posts that reply as the bot, fences, snapshots and grades exactly as it
// would for a harness, so the oracle and mutation matrix prove the graders on the real pipeline.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Script, ScriptedTurn, TurnRequest, TurnResponse } from '../contracts.ts';
import { RunnerError } from '../errors.ts';
import { type Harness, type TrialDirs, responseFile, writeAtomic } from '../trial/harness.ts';
import { substitute } from '../grade/play.ts';

export function loadScript(path: string): Script {
  if (!existsSync(path)) throw new RunnerError('HE-SCRIPT-001', `script not found: ${path}; fix: every task ships oracle.json and mutations/<predicate-id>.json (docs/tasks.md)`);
  let s: Script;
  try { s = JSON.parse(readFileSync(path, 'utf8')) as Script; } catch (e) { throw new RunnerError('HE-SCRIPT-001', `${path} is not JSON: ${(e as Error).message}`); }
  if (typeof s.id !== 'string' || !Array.isArray(s.turns)) throw new RunnerError('HE-SCRIPT-001', `${path} needs id, task and turns (Script in runner/contracts.ts)`);
  for (const t of s.turns) {
    if (!Number.isInteger(t.turn) || !Array.isArray(t.calls)) throw new RunnerError('HE-SCRIPT-001', `${path}: every turn needs an integer turn and a calls array`);
    if (t.exit !== undefined && ![2, 3, 124].includes(t.exit)) throw new RunnerError('HE-SCRIPT-001', `${path}: turn ${t.turn} exit must be 2, 3 or 124`);
  }
  return s;
}

export interface ScriptedCallResult { tool: string; args: Record<string, unknown>; isError: boolean; result: unknown }

/** Make one scripted turn's world-MCP calls as the connected actor and return what the world answered. */
export async function executeScriptTurn(client: Client, turn: ScriptedTurn): Promise<ScriptedCallResult[]> {
  const out: ScriptedCallResult[] = [];
  for (const call of turn.calls) {
    const res = await client.callTool({ name: call.tool, arguments: call.args });
    const text = (res.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text;
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* keep the text */ }
    out.push({ tool: call.tool, args: call.args, isError: res.isError === true, result: parsed });
  }
  return out;
}

export interface ScriptedHarnessOptions {
  script: Script;
  dirs: TrialDirs;
  mcpUrl: string;
  botToken: string;
}

/** The in-process harness for a scripted trial. Ready at once; answers each request the turn loop notifies it of. */
export function startScriptedHarness(opts: ScriptedHarnessOptions): Harness {
  let client: Client | null = null;
  let closed = false;
  const log = join(opts.dirs.logs, 'scripted.log');
  const connect = async () => {
    if (client) return client;
    const c = new Client({ name: 'scripted-executor', version: '0' });
    await c.connect(new StreamableHTTPClientTransport(new URL(opts.mcpUrl), { requestInit: { headers: { authorization: `Bearer ${opts.botToken}` } } }));
    client = c;
    return c;
  };
  const answer = async (req: TurnRequest) => {
    const started_at = new Date().toISOString();
    const turn = opts.script.turns.find((t) => t.turn === req.turn);
    let response: TurnResponse;
    if (!turn) response = { turn: req.turn, exit: 0, reply_text: null, started_at, ended_at: new Date().toISOString(), detail: 'script has no entry for this turn' };
    else {
      try {
        const resolved = substitute(turn, { request_ts: req.ts, channel: req.channel.id });
        const results = resolved.calls.length ? await executeScriptTurn(await connect(), resolved) : [];
        appendFileSync(log, JSON.stringify({ turn: req.turn, results }) + '\n');
        response = resolved.exit
          ? { turn: req.turn, exit: resolved.exit, reply_text: null, started_at, ended_at: new Date().toISOString(), detail: 'scripted exit' }
          : { turn: req.turn, exit: 0, reply_text: resolved.reply, started_at, ended_at: new Date().toISOString() };
      } catch (e) {
        appendFileSync(log, JSON.stringify({ turn: req.turn, error: (e as Error).message }) + '\n');
        response = { turn: req.turn, exit: 2, reply_text: null, started_at, ended_at: new Date().toISOString(), detail: `scripted executor: ${(e as Error).message}` };
      }
    }
    writeAtomic(join(opts.dirs.turns, responseFile(req.turn)), JSON.stringify(response, null, 1) + '\n');
  };
  writeFileSync(join(opts.dirs.logs, 'ready'), new Date().toISOString() + '\n');
  return {
    kind: 'scripted',
    async waitReady() { /* ready was written above */ },
    async exited() { return closed ? 0 : null; },
    notify(req) { void answer(req); },
    async stop() { closed = true; await client?.close().catch(() => undefined); client = null; },
    async kill() { closed = true; await client?.close().catch(() => undefined); client = null; },
  };
}
