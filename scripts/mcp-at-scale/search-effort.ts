// Search effort per trial, from the harness's own transcript: how many times the model searched or described tools,
// and how many model turns it took, before its first call to the right catalog tool (internal-task plan, review item F19).
//
// Sources, by what the trial's agent/ directory holds, first match wins:
//   openclaw.session.jsonl   OpenClaw's session events (scripts/mcp-at-scale/agents.py exports them from OpenClaw's
//                            SQLite store, since Harbor's own copy finds no file from 2026.10 on);
//   qm-session.json          QM's session transcript (agents_qm.py saves GET /v1/admin/sessions/<id> before core goes):
//                            one model turn per assistant message (body.wire.message.id), each ToolCall item as the call
//                            the model made (body.wire.name and argumentsJson when QM recorded them, else the item's tool
//                            and its recorded arguments); server ids are turned back into server names through
//                            harness_settings.json mcp_cell.server_ids;
//   trajectory.json          Harbor's ATIF trajectory: Claude Code, Codex, Hermes and Pi.
// A trial with neither has source null and found false: the parser saw no transcript, which is not a search miss.
// Each agent step is one model turn. Each tool call in it is classified by the harness's search mechanism:
//   search    ToolSearch (Claude Code); tool_search (Hermes, OpenClaw, Pi deferred, QM); a codemode script (Pi) or a Codex
//             exec script that calls searchTools(, describeTool( or reads ALL_TOOLS;
//   describe  tool_describe (Hermes, OpenClaw);
//   right     the target tool called by name (direct exposure, or loaded by a search), through an indirect route
//             (Hermes tool_call calls[].name, OpenClaw tool_call or dispatch_action id, QM mcp_call server and tool), or as tools.<name>( inside a
//             codemode or Codex exec script;
//   wrong     any other catalog tool reached the same ways (an mcp-qualified name or id);
//   other     everything else (shell, file tools, OpenClaw's shell exec, which takes a command and never a script).
// A script that both searches and calls the target counts as one search and as the right call.
//
// CLI: bun scripts/mcp-at-scale/search-effort.ts <trial dir>... [--server ash-tracker --tool create_issue]
// prints one JSON line per trial. The default target is listing-map.ts's SEARCH_TARGET.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Target { server: string; tool: string }
export interface Call { name: string; args: unknown }
export type Kind = 'search' | 'describe' | 'right' | 'wrong' | 'other';
export interface Effort {
  source: 'trajectory' | 'openclaw-session' | 'qm-session' | null;
  turns: number;
  found: boolean;
  first_right_turn: number | null;
  turns_before_right: number | null;
  search_calls: number;
  search_calls_before_right: number;
  describe_calls_before_right: number;
  wrong_calls_before_right: number;
  other_calls_before_right: number;
  mechanisms: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const isTarget = (name: string, t: Target) => { const n = norm(name); return n.endsWith('_' + norm(t.tool)) && n.includes(norm(t.server)); };
const isCatalog = (name: string) => /^mcp(__|_|:)/.test(name) || /__/.test(name);

/** One model turn per agent step, with its tool calls, from Harbor's ATIF trajectory. */
export function turnsFromTrajectory(traj: { steps?: Array<Record<string, any>> }): Call[][] {
  return (traj.steps ?? []).filter((s) => s.source === 'agent').map((s) => (s.tool_calls ?? []).map((c: any) => ({ name: String(c.function_name), args: c.arguments ?? {} })));
}

/** One model turn per assistant message, with its toolCall blocks, from OpenClaw's session events. */
export function turnsFromOpenClawSession(text: string): Call[][] {
  const turns: Call[][] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    const m = e?.type === 'message' ? e.message : null;
    if (!m || m.role !== 'assistant') continue;
    const blocks = Array.isArray(m.content) ? m.content : [];
    turns.push(blocks.filter((b: any) => b?.type === 'toolCall').map((b: any) => ({ name: String(b.name), args: b.arguments ?? {} })));
  }
  return turns;
}

/** One model turn per assistant message, with the calls the model made, from QM's session transcript; serverNames maps a
 *  QM server id back to the catalog server's name. */
export function turnsFromQmSession(session: { items?: Array<Record<string, any>> }, serverNames: Record<string, string> = {}): Call[][] {
  const turns = new Map<string, Call[]>();
  for (const it of session.items ?? []) {
    const msg = it.body?.wire?.message?.id;
    if (!msg || (it.kind !== 'ToolCall' && it.kind !== 'AgentMessage')) continue;
    const calls = turns.get(msg) ?? [];
    turns.set(msg, calls);
    if (it.kind !== 'ToolCall') continue;
    const { wire, ...recorded } = it.body ?? {};
    let args: any = recorded.args ?? recorded;
    if (typeof wire?.argumentsJson === 'string') { try { args = JSON.parse(wire.argumentsJson); } catch { /* keep the recorded arguments */ } }
    const name = String(wire?.name ?? it.tool);
    if (name === 'mcp_call' && args && typeof args.server === 'string') args = { ...args, server: serverNames[args.server] ?? args.server };
    calls.push({ name, args });
  }
  return [...turns.values()];
}

/** The script a codemode or Codex exec call runs, or null for any other call (OpenClaw's exec takes a shell command). */
function script(c: Call): string | null {
  const a = c.args as any;
  if (typeof a === 'string') return c.name === 'exec' ? a : null;
  if (c.name === 'codemode' && typeof a?.code === 'string') return a.code;
  if (c.name === 'exec' && typeof a?.input === 'string' && a.command === undefined) return a.input;
  return null;
}

/** Every kind one tool call counts as (a script can be both a search and the right call). */
export function classify(c: Call, t: Target): Kind[] {
  const a = (c.args ?? {}) as any;
  if (c.name === 'ToolSearch' || c.name === 'tool_search') return ['search'];
  if (c.name === 'tool_describe') return ['describe'];
  if (c.name === 'mcp_call') return [isTarget(String(a.server ?? '') + '__' + String(a.tool ?? ''), t) ? 'right' : 'wrong'];
  if (c.name === 'tool_call' || c.name === 'dispatch_action') {
    const names: string[] = Array.isArray(a.calls) ? a.calls.map((x: any) => String(x?.name ?? '')) : [String(a.id ?? a.name ?? '')];
    return [names.some((n) => isTarget(n, t)) ? 'right' : 'wrong'];
  }
  const code = script(c);
  if (code !== null) {
    const kinds: Kind[] = [];
    if (/\bsearchTools\s*\(|\bdescribeTool\s*\(|\bALL_TOOLS\b/.test(code)) kinds.push('search');
    const called = [...code.matchAll(/\btools\.([A-Za-z0-9_$]+)\s*\(/g)].map((m) => m[1]!);
    if (called.some((n) => isTarget(n, t))) kinds.push('right');
    else if (called.length) kinds.push('wrong');
    return kinds.length ? kinds : ['other'];
  }
  if (isTarget(c.name, t)) return ['right'];
  return [isCatalog(c.name) ? 'wrong' : 'other'];
}

const MECHANISM: Record<string, string> = { ToolSearch: 'ToolSearch', tool_search: 'tool_search', tool_describe: 'tool_describe', tool_call: 'tool_call', dispatch_action: 'dispatch_action', mcp_call: 'mcp_call', codemode: 'codemode', exec: 'exec' };

export function effort(turns: Call[][], t: Target, source: Effort['source']): Effort {
  const e: Effort = { source, turns: turns.length, found: false, first_right_turn: null, turns_before_right: null, search_calls: 0, search_calls_before_right: 0, describe_calls_before_right: 0, wrong_calls_before_right: 0, other_calls_before_right: 0, mechanisms: [] };
  for (let i = 0; i < turns.length; i++) {
    for (const c of turns[i]!) {
      const kinds = classify(c, t);
      if (kinds.includes('search')) e.search_calls++;
      if (e.found) continue;
      const m = MECHANISM[c.name] ?? (kinds.includes('right') ? 'direct' : null);
      if (m && (kinds.includes('search') || kinds.includes('describe') || kinds.includes('right')) && !e.mechanisms.includes(m)) e.mechanisms.push(m);
      if (kinds.includes('search')) e.search_calls_before_right++;
      if (kinds.includes('describe')) e.describe_calls_before_right++;
      if (kinds.includes('right')) { e.found = true; e.first_right_turn = i + 1; e.turns_before_right = i; continue; }
      if (kinds.includes('wrong')) e.wrong_calls_before_right++;
      if (kinds.includes('other')) e.other_calls_before_right++;
    }
  }
  return e;
}

/** Search effort for one Harbor trial directory (jobs/<job>/<trial>). */
export function trialEffort(trialDir: string, t: Target): Effort {
  const agent = join(trialDir, 'agent');
  const oc = join(agent, 'openclaw.session.jsonl');
  if (existsSync(oc)) return effort(turnsFromOpenClawSession(readFileSync(oc, 'utf8')), t, 'openclaw-session');
  const qm = join(agent, 'qm-session.json');
  if (existsSync(qm)) {
    const settings = join(agent, 'harness_settings.json');
    const ids: Record<string, string> = existsSync(settings) ? JSON.parse(readFileSync(settings, 'utf8')).mcp_cell?.server_ids ?? {} : {};
    return effort(turnsFromQmSession(JSON.parse(readFileSync(qm, 'utf8')), Object.fromEntries(Object.entries(ids).map(([name, id]) => [id, name]))), t, 'qm-session');
  }
  const traj = join(agent, 'trajectory.json');
  if (existsSync(traj)) return effort(turnsFromTrajectory(JSON.parse(readFileSync(traj, 'utf8'))), t, 'trajectory');
  return effort([], t, null);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(n); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const { SEARCH_TARGET } = await import('./listing-map.ts');
  const target = { server: flag('--server') ?? SEARCH_TARGET.server, tool: flag('--tool') ?? SEARCH_TARGET.tool };
  if (!argv.length) { console.error('usage: search-effort.ts <trial dir>... [--server s --tool t]'); process.exit(2); }
  for (const d of argv) console.log(JSON.stringify({ trial: d, ...trialEffort(d, target) }));
}
