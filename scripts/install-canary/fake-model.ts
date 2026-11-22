// internal-task: the scripted model the install canary drives each harness with. It sends gbrain's documented install lines to the
// harness's own shell tool one call at a time, byte for byte, so the harness's guard (Hermes's single-query deny and Tirith,
// OpenClaw's exec defaults) decides each line as it would for a real agent. Then it saves the trial's nonce with gbrain's
// remember tool and, in the fresh recall conversation, calls recall and repeats the tool's answer, so the install trial's own
// "recalled" outcome is the verdict. No request reaches a model provider.
import { SHELL_TOOLS, shellTool } from '../frontier-harbor/fake-upstream.ts';
import { type Call, answer, promptKind, strings, toolDecls } from '../gbrain-install/real-image-check.ts';
import type { RouteLine } from './routes.ts';

export type LineStatus = 'pass' | 'fail' | 'refused' | 'timeout' | 'unknown';
export interface LineResult { index: number; command: string; status: LineStatus; exit_code: number | null; guard: string | null; output: string }
export interface McpCall { verb: 'remember' | 'recall'; tool: string | null; via: 'direct' | 'codex-exec' | 'tool_call' | 'none'; output: string | null; is_error: boolean | null }
export interface FakeState {
  lines: RouteLine[]; next: number; stopped: string | null; pending: { kind: 'line'; index: number } | { kind: 'mcp'; verb: 'remember' | 'recall' } | { kind: 'search' } | null;
  results: LineResult[]; remember: McpCall | null; recall: McpCall | null; searched: Record<string, boolean>; nonce: string | null;
  requests: number; toolNames: Record<string, string[]>; toolCallSchema: unknown; found: Record<string, string>;
}
export const newFakeState = (lines: RouteLine[]): FakeState => ({ lines, next: 0, stopped: null, pending: null, results: [], remember: null, recall: null, searched: {}, nonce: null, requests: 0, toolNames: {}, toolCallSchema: null, found: {} });

const OUTPUT_CAP = 4000;
/** Lines a guard prints when it refuses a command: Hermes's single-query deny (dangerous-command patterns and Tirith's "Security
 *  scan"), an approval card nobody can answer, and the generic "blocked"/"denied" wording other harnesses use. */
export const REFUSAL = /BLOCKED|Security scan|flagged as dangerous|Asking the user for approval|requires approval|not approved|denied by|was denied|command blocked|blocked by/i;
const EXIT = [/"exit_code"\s*:\s*(-?\d+)/, /"exitCode"\s*:\s*(-?\d+)/, /Exit code[:\s]+(-?\d+)/i, /exited with code[:\s]+(-?\d+)/i, /exit status[:\s]+(-?\d+)/i];
const TIMEOUT = /timed out|timeout exceeded|Process running with session ID|Command still running \(session/i;

/** How far into a tool result a guard's message can sit. Guards print first; a command's own output (gbrain doctor's JSON says
 *  "blocked by" deep inside) never counts as a refusal. */
const GUARD_HEAD = 1500;
/** A shell tool result read as a line's outcome. A guard message at the head with no zero exit (Hermes reports its block as
 *  exit_code -1 with "status": "blocked") is a refusal. is_error alone (Claude Code's failed Bash) is a fail when no exit code shows. */
export function classifyLine(output: string, isError: boolean): { status: LineStatus; exit_code: number | null; guard: string | null } {
  const head = output.slice(0, GUARD_HEAD);
  const refusal = head.match(REFUSAL) ?? head.match(/"status"\s*:\s*"blocked"/);
  let exit: number | null = null;
  for (const re of EXIT) { const m = output.match(re); if (m) { exit = Number(m[1]); break; } }
  if (refusal && exit !== 0) return { status: 'refused', exit_code: exit, guard: guardLine(output, refusal.index!) };
  if (exit === null && TIMEOUT.test(output)) return { status: 'timeout', exit_code: null, guard: null };
  if (exit !== null) return { status: exit === 0 ? 'pass' : 'fail', exit_code: exit, guard: null };
  return { status: isError ? 'fail' : 'unknown', exit_code: null, guard: null };
}
/** The guard's own words: a JSON tool result's "error" field (Hermes), else the line the refusal starts on. */
const guardLine = (s: string, at: number) => {
  try { const j = JSON.parse(s); if (typeof j?.error === 'string' && j.error) return j.error.slice(0, 600); } catch { /* not JSON */ }
  return s.slice(Math.max(0, s.lastIndexOf('\n', at) + 1), Math.min(s.length, at + 400)).trim();
};

/** The text and error flag of the newest tool result in a request (Messages tool_result, Chat role tool, Responses *_output). */
export function lastToolResult(body: Record<string, any>): { text: string; is_error: boolean } | null {
  if (Array.isArray(body.messages)) {
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const m = body.messages[i];
      if (m?.role === 'tool') return { text: strings(m.content).join('\n'), is_error: false };
      if (!Array.isArray(m?.content)) continue;
      const r = [...m.content].reverse().find((b: any) => b?.type === 'tool_result');
      if (r) return { text: strings(r.content).join('\n'), is_error: r.is_error === true };
      if (m.role === 'assistant') return null;
    }
  }
  if (Array.isArray(body.input)) {
    for (let i = body.input.length - 1; i >= 0; i--) {
      const it = body.input[i];
      if (typeof it?.type === 'string' && it.type.endsWith('_call_output')) return { text: strings(it.output).join('\n'), is_error: false };
      if (it?.role === 'assistant') return null;
    }
  }
  return null;
}

/** Codex's code-mode shell for one line: the line is the exec_command's cmd, unchanged; a call still running at yield_time_ms
 *  is polled with write_stdin until it exits, at most 8 more times (18 minutes in all). */
export const codexLineSource = (command: string) => [
  'let r = await tools.exec_command({ cmd: ' + JSON.stringify(command) + ', yield_time_ms: 120000 });',
  'let out = typeof r === "string" ? r : JSON.stringify(r);',
  'for (let i = 0; i < 8; i++) {',
  '  const m = out.match(/session ID (\\d+)/i);',
  '  if (!m || /exited with code/i.test(out)) break;',
  '  r = await tools.write_stdin({ session_id: Number(m[1]), chars: "", yield_time_ms: 120000 });',
  '  out += "\\n" + (typeof r === "string" ? r : JSON.stringify(r));',
  '}',
  'text(out);',
].join('\n') + '\n';

/** The command sent for route line i: the line itself, after the route's earlier export lines, the way one shell session that
 *  ran them would have them. Each tool call is a fresh shell in Codex, Hermes and OpenClaw, so without this a doc that says
 *  "export PATH=..." on one line and "bun install" on the next fails on a split no agent would make. */
export function lineCommand(lines: RouteLine[], i: number): string {
  const exports = lines.slice(0, i).map((l) => l.command.trim()).filter((c) => /^export [A-Za-z_][A-Za-z0-9_]*=/.test(c) && !/[;&|]/.test(c.replace(/"[^"]*"/g, '')));
  return exports.length ? exports.join(' && ') + ' && ' + lines[i]!.command : lines[i]!.command;
}

/** Shell tool arguments for one line, with the harness's own timeout in the arguments, never in the command. */
export function lineArgs(tool: string, command: string, schema: any): Record<string, unknown> {
  const args = { ...SHELL_TOOLS[tool]!(command) };
  const props = schema?.properties ?? {};
  if (tool === 'Bash') return { ...args, description: 'Run an install step from INSTALL_FOR_AGENTS.md', timeout: 600000 };
  if ('timeout' in props) args.timeout = 600;
  if ('timeoutSeconds' in props) args.timeoutSeconds = 600;
  if ('yieldMs' in props) args.yieldMs = 600000;
  return args;
}

interface Decl { name: string; type: string | null; namespace?: string; schema: any }
/** Declared tools with their argument schemas (Messages input_schema, Responses parameters, Chat function.parameters). */
export function decls(body: Record<string, any>): Decl[] {
  const schemas = new Map<string, any>();
  const walk = (list: unknown) => { for (const t of Array.isArray(list) ? list as any[] : []) { if (t?.type === 'namespace') { walk(t.tools); continue; } const n = t?.name ?? t?.function?.name; if (typeof n === 'string') schemas.set(n, t.input_schema ?? t.parameters ?? t.function?.parameters ?? null); } };
  walk(body.tools);
  for (const i of Array.isArray(body.input) ? body.input : []) if (i?.type === 'additional_tools') walk(i.tools);
  return toolDecls(body).map((d) => ({ ...d, schema: schemas.get(d.name) ?? null }));
}

export const PROVENANCE = 'the user told me in this chat';
/** gbrain's remember or recall arguments when the tool's schema isn't in view (deferred behind a search tool): fact with its
 *  provenance (required since v0.60.7xx), or query. */
export const defaultArgs = (verb: 'remember' | 'recall', text: string): Record<string, unknown> => verb === 'remember' ? { fact: text, provenance: PROVENANCE } : { query: text };
/** Arguments for gbrain's remember or recall from the tool's schema: fact (or items[{fact}]) for remember, query for recall, else
 *  the first required string property; every other required string property gets the provenance line. */
export function mcpArgs(verb: 'remember' | 'recall', schema: any, text: string): Record<string, unknown> {
  const props = schema?.properties ?? {};
  const required: string[] = schema?.required ?? [];
  if (!Object.keys(props).length) return defaultArgs(verb, text);
  let args: Record<string, unknown>;
  if (verb === 'remember' && 'fact' in props) args = { fact: text };
  else if (verb === 'remember' && 'items' in props) return { items: [{ fact: text, provenance: PROVENANCE }], ...('provenance' in props ? { provenance: PROVENANCE } : {}) };
  else if (verb === 'recall' && 'query' in props) args = { query: text };
  else args = { [required.find((k) => props[k]?.type === 'string') ?? (verb === 'remember' ? 'fact' : 'query')]: text };
  if (verb === 'remember' && 'provenance' in props) args.provenance = PROVENANCE;
  for (const k of required) if (!(k in args) && props[k]?.type === 'string') args[k] = PROVENANCE;
  return args;
}

/** The id a harness's tool search returned for gbrain's verb: any token naming gbrain that ends in the verb. */
export function foundId(text: string, verb: string): string | null {
  for (const m of text.matchAll(/[A-Za-z0-9_:.\/-]*gbrain[A-Za-z0-9_:.\/-]*/gi)) if (new RegExp('(^|[_.:/-])' + verb + '$', 'i').test(m[0])) return m[0];
  return null;
}

const isGbrain = (d: { name: string; namespace?: string }) => /gbrain/i.test(d.name) || /gbrain/i.test(d.namespace ?? '');
const verbRe = (verb: string) => new RegExp('(^|[_.])' + verb + '$');

/** The call for gbrain's remember or recall: a declared gbrain tool, OpenClaw's generic tool_call naming it, Codex's code-mode
 *  exec calling it from its tools object, or (Claude Code, tools deferred) a ToolSearch that loads it first. */
export function mcpCall(verb: 'remember' | 'recall', body: Record<string, any>, state: FakeState, text: string, conv: string): { call: Call | null; via: McpCall['via'] | 'search'; tool: string | null } {
  const ds = decls(body);
  const direct = ds.find((d) => isGbrain(d) && d.type !== 'custom' && verbRe(verb).test(d.name));
  if (direct) return { call: { tool: { name: direct.name, custom: false, ...(direct.namespace ? { namespace: direct.namespace } : {}) }, command: '', args: mcpArgs(verb, direct.schema, text) }, via: 'direct', tool: direct.name };
  const tc = ds.find((d) => d.name === 'tool_call' && d.type !== 'custom');
  if (tc) {
    state.toolCallSchema ??= tc.schema;
    const search = ds.find((d) => d.name === 'tool_search' && d.type !== 'custom');
    if (search && !state.found[verb] && !state.searched[conv + ':' + verb]) {
      state.searched[conv + ':' + verb] = true;
      const sp = search.schema?.properties ?? {};
      const key = 'query' in sp ? 'query' : (search.schema?.required ?? []).find((k: string) => sp[k]?.type === 'string') ?? 'query';
      return { call: { tool: { name: 'tool_search', custom: false }, command: '', args: { [key]: 'gbrain ' + verb } }, via: 'search', tool: null };
    }
    const id = state.found[verb] ?? 'mcp:gbrain:gbrain__' + verb;
    const props = tc.schema?.properties ?? {};
    const inner = defaultArgs(verb, text);
    const args = 'calls' in props ? { calls: [{ name: id, arguments: inner }] } : 'arguments' in props ? { id, arguments: inner } : 'args' in props ? { id, args: inner } : 'input' in props ? { id, input: inner } : { id, ...inner };
    return { call: { tool: { name: 'tool_call', custom: false }, command: '', args }, via: 'tool_call', tool: id };
  }
  const exec = ds.find((d) => d.type === 'custom' && d.name === 'exec');
  if (exec) {
    const arg = JSON.stringify(defaultArgs(verb, text));
    const source = [
      'let names = []; try { names = Object.keys(tools); } catch {}',
      'const name = names.find((n) => /gbrain/i.test(n) && /' + verb + '$/i.test(n));',
      'if (name) { const r = await tools[name](' + arg + '); text("CALLED " + name + "\\n" + (typeof r === "string" ? r : JSON.stringify(r))); } else text("NO_GBRAIN_TOOL " + names.join(","));',
    ].join('\n') + '\n';
    return { call: { tool: { name: 'exec', custom: true, ...(exec.namespace ? { namespace: exec.namespace } : {}) }, command: '', source }, via: 'codex-exec', tool: null };
  }
  if (ds.some((d) => d.name === 'ToolSearch') && !state.searched[conv]) {
    state.searched[conv] = true;
    return { call: { tool: { name: 'ToolSearch', custom: false }, command: '', args: { query: 'select:mcp__gbrain__' + verb, max_results: 5 } }, via: 'search', tool: null };
  }
  return { call: null, via: 'none', tool: null };
}

/** The newest user message's nonce: the save prompt is "Remember that my sister's new cat is called {nonce}." */
export function nonceOf(body: Record<string, any>): string | null {
  const s = strings(body.messages ?? body.input ?? []).join('\n');
  const all = [...s.matchAll(/cat is called ([^\s."'\\]+)/g)];
  return all.length ? all[all.length - 1]![1]! : null;
}

/** A gbrain tool result that is an error: gbrain's own error envelope, a harness's unknown-tool or bad-arguments reply. */
export const MCP_ERROR = /NO_GBRAIN_TOOL|"isError"\s*:\s*true|"error"\s*:\s*"|"status"\s*:\s*"error"|unknown tool|tool not found|invalid_params/i;

/** One request, answered: the next route line, the remember or recall call, or a text reply. */
export function respond(path: string, body: Record<string, any>, state: FakeState, n: number): Response {
  state.requests++;
  const kind = promptKind(body);
  state.toolNames[kind] = [...new Set([...(state.toolNames[kind] ?? []), ...toolDecls(body).map((d) => d.name)])].slice(0, 200);
  const last = lastToolResult(body);
  const pending = state.pending;
  state.pending = null;
  if (pending?.kind === 'line' && !last) state.results.push({ index: pending.index, command: state.lines[pending.index]!.command, status: 'unknown', exit_code: null, guard: null, output: '(no tool result came back for this line before the conversation moved on)' });
  if (pending && last) {
    const output = last.text.slice(0, OUTPUT_CAP);
    if (pending.kind === 'line') {
      const c = classifyLine(last.text, last.is_error);
      state.results.push({ index: pending.index, command: state.lines[pending.index]!.command, ...c, output });
      if (c.status === 'fail' || c.status === 'refused') state.stopped = c.status + ' at line ' + (pending.index + 1);
    } else if (pending.kind === 'mcp') {
      const rec = pending.verb === 'remember' ? state.remember : state.recall;
      if (rec) { rec.output = output; rec.is_error = last.is_error || MCP_ERROR.test(last.text.slice(0, GUARD_HEAD)); }
    } else if (pending.kind === 'search') {
      for (const v of ['remember', 'recall']) { const id = foundId(last.text, v); if (id) state.found[v] ??= id; }
    }
  }
  if (kind === 'install') {
    const tool = shellTool(body);
    if (tool && !state.stopped && state.next < state.lines.length) {
      const index = state.next++;
      const command = lineCommand(state.lines, index);
      state.pending = { kind: 'line', index };
      const schema = decls(body).find((d) => d.name === tool.name)?.schema;
      return answer(path, body, n, tool.custom ? { tool, command, source: codexLineSource(command) } : { tool, command, args: lineArgs(tool.name, command, schema) }, '');
    }
    return answer(path, body, n, null, state.stopped ? 'The install stopped: ' + state.stopped + '.' : 'gbrain is installed.');
  }
  if (kind === 'save' || kind === 'recall') {
    const verb = kind === 'save' ? 'remember' : 'recall';
    if (kind === 'save') state.nonce ??= nonceOf(body);
    const done = verb === 'remember' ? state.remember?.output != null : state.recall?.output != null;
    if (!done && !(pending?.kind === 'mcp' && pending.verb === verb)) {
      const text = verb === 'remember' ? "My sister's new cat is called " + (state.nonce ?? 'unknown') + '.' : "sister's new cat name";
      const { call, via, tool } = mcpCall(verb, body, state, text, kind);
      if (call && via === 'search') { state.pending = { kind: 'search' }; return answer(path, body, n, call, ''); }
      if (call) {
        state[verb] = { verb, tool, via: via as McpCall['via'], output: null, is_error: null };
        state.pending = { kind: 'mcp', verb };
        return answer(path, body, n, call, '');
      }
      state[verb] ??= { verb, tool: null, via: 'none', output: null, is_error: null };
    }
    if (verb === 'remember') return answer(path, body, n, null, 'Saved.');
    return answer(path, body, n, null, 'From gbrain: ' + (state.recall?.output ?? 'no gbrain tool was offered').slice(0, 2000));
  }
  return answer(path, body, n, null, kind === 'hinted' ? 'I checked gbrain.' : 'Done.');
}

/** The scripted model as an HTTP server on 127.0.0.1, one per harness so cases never share state. */
export function startCanaryFake(state: () => FakeState) {
  let n = 0;
  return Bun.serve({ port: 0, hostname: '127.0.0.1', idleTimeout: 0, fetch: async (req) => {
    const path = new URL(req.url).pathname;
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) as Record<string, any> : {};
    return respond(path, body, state(), ++n);
  } });
}
