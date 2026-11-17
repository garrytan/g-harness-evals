#!/usr/bin/env bun
// GST-2715: the keyless real-image check for the gbrain install trial. It runs each install-mode harness image built from
// this tree through the runner's own install trial (docker mode, network "install", the metering proxy and the open-egress
// proxy) against a scripted fake model upstream in this process, so no request reaches a model provider and nothing is
// spent. The fake answers the install turn with shell tool calls that install gbrain for real (bun, then bun install -g from
// GitHub through the egress proxy, then the harness's MCP setup as gbrain's INSTALL_FOR_AGENTS.md gives it) and print
// "HECHECK key=value" lines, which come back to the fake in the next request's tool result. Per case it checks:
//   a. the harness reached the fake through the metering proxy: a forwarded usage line for the cell model, token presented;
//   b. bun, gbrain and the setup command exited 0, the harness's own "mcp list" names gbrain in a new conversation, and on
//      Codex and Hermes (which start their MCP servers with the session) a gbrain serve process runs;
//   c. the agent's shell, in both conversations, could read the proxy token file yet has no provider key variable and no
//      variable holding the token (names and counts only, never a value);
//   d. the brain path gbrain's own config names equals the brain_path the install probe and the install watcher recorded.
// One more case, WebFetch on Claude Code, installs nothing: the fake loads WebFetch with ToolSearch, then calls it once on
// gbrain's INSTALL_FOR_AGENTS.md. It
// checks a and that the page came back (its host admitted by the egress proxy, the page in a model request, a tool result that
// is not an error), and reports from the egress log whether Claude Code's own domain check (its preflight) was blocked.
// The report is <out>/real-image-check.json. Exit 0 when every case passes, 1 when any fails, 2 on a usage error; the same
// for --codex-semantic.
//
//   bun scripts/gbrain-install/real-image-check.ts --out <dir> --tag <gbrain release tag> [--harness claude-code,hermes] [--commit <the commit it names>]
//
// scripts/gbrain-install/real-image-check.sh builds the four images from this tree first; see scripts/gbrain-install/README.md.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TrialRecord } from '../../runner/contracts.ts';
import { buildManifest, loadPrereg } from '../../runner/run.ts';
import { gbrainLsRemote, tagCommit } from '../../runner/trial/install.ts';
import { trialKey } from '../../runner/trial/proxy.ts';
import { executeRun } from '../../runner/trial/run.ts';
import { SHELL_TOOLS, reply, shellTool, sse } from '../frontier-harbor/fake-upstream.ts';

/** webfetch: the WebFetch case, which installs nothing: the fake model calls Claude Code's WebFetch on WEBFETCH_URL once, and the
 *  case reports whether the page came back and whether Claude Code's own domain check (its preflight) got through the egress. */
export interface CheckCase { harness: string; model: string; webfetch?: true }
export const CASES: CheckCase[] = [
  { harness: 'claude-code', model: 'anthropic:claude-opus-5-5' },
  { harness: 'codex', model: 'openai:gpt-6.1-sol' },
  { harness: 'openclaw', model: 'anthropic:claude-opus-5-5' },
  { harness: 'hermes', model: 'anthropic:claude-opus-5-5' },
  { harness: 'hermes', model: 'openai:gpt-6.1-sol' },
  { harness: 'hermes', model: 'particle:particle-1' },
  { harness: 'claude-code', model: 'anthropic:claude-opus-5-5', webfetch: true },
];
export const WEBFETCH_URL = 'https://raw.githubusercontent.com/garrytan/gbrain/master/INSTALL_FOR_AGENTS.md';
/** The page's first heading: a model request that carries it got the fetched page (WebFetch hands the page to a model). */
export const WEBFETCH_MARK = 'GBrain Installation Guide for AI Agents';
/** Hosts Claude Code's WebFetch asks whether a domain may be fetched before it fetches. */
export const PREFLIGHT_HOSTS = ['api.anthropic.com', 'claude.ai'];
/** The only provider key values the check's proxy holds. None is a real key shape. */
export const DUMMY_KEYS = { ANTHROPIC_API_KEY: 'sk-ant-capture-dummy', OPENAI_API_KEY: 'sk-capture-dummy', PARTICLE_API_KEY: 'particle-capture-dummy' };
/** Provider key variables the agent's shell must not have. HE_MODEL_API_KEY is reported too but not failed on its own: the
 *  token count decides whether it holds the token. */
export const PROVIDER_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'PARTICLE_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
const TOKEN_FILE = '/he-secret/token';
const PATH_PREFIX = 'export PATH="$HOME/.bun/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$PATH:/opt/harness/venv/bin"; ';
const WAIT_S = 780;
const MAX_ATTEMPTS = 2;
const MAX_WAITS = 150;

/** A shell command that prints "HECHECK key=value". The command text never holds "HECHECK key=", so only its output does. */
export const say = (key: string, value: string) => "printf 'HECHECK %s=%s\\n' " + key + ' ' + value;

/** The harness's MCP setup after gbrain is installed, from gbrain's INSTALL_FOR_AGENTS.md at stable. */
export const SETUP: Record<string, string> = {
  'claude-code': 'gbrain setup claude-code',
  codex: 'gbrain setup codex',
  openclaw: 'gbrain init --pglite --no-embedding && openclaw mcp add gbrain --command "$(command -v gbrain)" --arg serve --arg --surface --arg starter --arg --advertise --arg verbs --env "GBRAIN_HOME=$HOME"',
  hermes: "gbrain init --pglite --no-embedding && printf 'Y\\n' | hermes mcp add gbrain --env \"GBRAIN_HOME=$HOME\" --connect-timeout 60 --command \"$(command -v gbrain)\" --args serve --surface starter --advertise verbs",
};
const MCP_LIST: Record<string, string> = { 'claude-code': 'claude mcp list', codex: 'codex mcp list', openclaw: 'openclaw mcp list', hermes: 'hermes mcp list' };
/** Harnesses that start their MCP servers with the session: the recall conversation's model request must offer gbrain's tools. */
const SESSION_MCP = new Set(['codex', 'hermes']);

/** The background install script: bun (npm when the image has it, else the release zip through Python), gbrain at the
 *  commit, the setup, then the brain path gbrain's config names. It writes its own HECHECK lines to ~/.he-check/result,
 *  spelling the prefix through a variable so the command that writes the script never holds a marker. It runs no
 *  interpreter through -e, -c or a heredoc, which Hermes's single-query guard blocks, and names the install verb through
 *  a variable, since Tirith, offline, warns on any package install it can read and Hermes blocks a warning. PATH ends with
 *  /opt/harness/venv/bin, where the Hermes image keeps the hermes binary, because the shell Hermes's terminal tool spawns
 *  does not have it. */
export function installScript(harness: string, commit: string): string {
  return [
    'set -u',
    'export PATH="$HOME/.bun/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$PATH:/opt/harness/venv/bin"',
    'd="$HOME/.he-check"; log="$d/install.log"; m=HE; m="$m"CHECK; r="$d/result"; i=install',
    'echo "$m install.started=1" > "$r"',
    'if ! command -v bun >/dev/null 2>&1; then',
    '  if command -v npm >/dev/null 2>&1; then npm "$i" -g --prefix "$HOME/.npm-global" bun >>"$log" 2>&1',
    "  else cat > \"$d/bun.py\" <<'PY'",
    'import io, os, urllib.request, zipfile',
    "d = os.path.expanduser('~/.bun/bin'); os.makedirs(d, exist_ok=True)",
    "z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen('https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64.zip', timeout=300).read()))",
    "open(os.path.join(d, 'bun'), 'wb').write(z.read('bun-linux-x64/bun')); os.chmod(os.path.join(d, 'bun'), 0o755)",
    'PY',
    '  python3 "$d/bun.py" >>"$log" 2>&1',
    '  fi',
    'fi',
    'command -v bun >/dev/null 2>&1; echo "$m install.bun_exit=$?" >> "$r"',
    'bun "$i" -g "github:garrytan/gbrain#' + commit + '" >>"$log" 2>&1; echo "$m install.install_exit=$?" >> "$r"',
    '{ ' + SETUP[harness] + '; } >>"$log" 2>&1 </dev/null; echo "$m install.setup_exit=$?" >> "$r"',
    'b=$(sed -n \'s/.*"database_path"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' "$HOME/.gbrain/config.json" 2>/dev/null | head -n 1)',
    '[ -n "$b" ] || { [ -e "$HOME/.gbrain/brain.pglite" ] && b="$HOME/.gbrain/brain.pglite" || b=none; }',
    'echo "$m brain_path=$b" >> "$r"; echo "$m gbrain_bin=$(command -v gbrain || echo none)" >> "$r"',
    'echo "$m install_done=1" >> "$r"',
  ].join('\n');
}

/** Names of key variables in the shell's environment, whether the token file was readable, and how many variables hold the
 *  token. awk reads the token from the file itself, so it never reaches a command line, and prints counts only. */
export function envCommand(tag: string, tokenFile = TOKEN_FILE): string {
  return 'found=""; for n in HE_MODEL_API_KEY ' + PROVIDER_VARS.join(' ') + '; do printenv "$n" >/dev/null && found="$found,$n"; done; [ -n "$found" ] || found=,none; '
    + say(tag + '.env_names', '"$(printf %s "$found" | cut -c2-)"') + '; '
    + "awk -v f='" + tokenFile + "' 'BEGIN { t = \"\"; if ((getline t < f) <= 0) t = \"\"; n = 0; if (t != \"\") for (k in ENVIRON) if (index(ENVIRON[k], t)) n++; "
    + 'printf "HECHECK %s=%d\\nHECHECK %s=%d\\n", "' + tag + '.token_read", (t != ""), "' + tag + ".token_hits\", n }'; "
    + say('step.' + tag + '-env', '1');
}

/** One scripted command. \`once\`: sent at most once and done once sent (it prints nothing the fake reads back). \`background\`:
 *  Hermes's terminal tool runs it with background=true, since it refuses a foreground command that backgrounds with &. */
export interface Step { name: string; command: string; once?: true; background?: true; source?: string }
export function installPlan(harness: string, commit: string): Step[] {
  const run = harness === 'hermes' || harness === 'openclaw' ? 'bash "$HOME/.he-check/install.sh"'
    : 'if command -v setsid >/dev/null 2>&1; then setsid nohup bash "$HOME/.he-check/install.sh" >/dev/null 2>&1 </dev/null & else nohup bash "$HOME/.he-check/install.sh" >/dev/null 2>&1 </dev/null & fi; echo started';
  return [
    { name: 'install-env', command: envCommand('install') },
    { name: 'install-write', command: 'mkdir -p "$HOME/.he-check" && cat > "$HOME/.he-check/install.sh" <<\'HEEOF\'\n' + installScript(harness, commit) + '\nHEEOF\n' + say('step.install-write', '1') },
    { name: 'install-run', command: run, once: true, ...(harness === 'hermes' ? { background: true as const } : {}) },
    { name: 'wait', command: 'sleep 8; cat "$HOME/.he-check/result"' },
  ];
}
export function recallPlan(harness: string): Step[] {
  return [
    { name: 'recall-env', command: envCommand('recall') },
    { name: 'recall-mcp', command: PATH_PREFIX + 'n=$(timeout 90 ' + MCP_LIST[harness] + ' 2>&1 | grep -c gbrain); ' + say('mcp_listed', '"$n"') + '; '
      + 'p=$(pgrep -fc \'[g]brain.*[s]erve\'); ' + say('gbrain_procs', '"$p"') + '; ' + say('step.recall-mcp', '1') },
    ...(harness === 'codex' ? [{ name: 'recall-tools', command: '', source: CODEX_TOOLS_SOURCE }] : []),
  ];
}

/** Codex's code mode offers MCP tools only at runtime, in exec's `tools` object, never in the request's declared tools: this
 *  exec prints how many mcp__gbrain__ keys that object has. The marker prefix is spelled through a variable, so the source,
 *  which later requests carry as the call's input, holds no marker. */
export const CODEX_TOOLS_SOURCE = [
  'const m = "HE" + "CHECK";',
  'let names = []; try { names = Object.keys(tools); } catch {}',
  'text(m + " gbrain_tools=" + names.filter((n) => n.startsWith("mcp__gbrain__")).length);',
  'text(m + " step.recall-tools=1");',
].join('\n') + '\n';

export type PromptKind = 'install' | 'save' | 'recall' | 'hinted' | 'other';
const CUES: Array<[PromptKind, string]> = [['hinted', 'Check your gbrain memory'], ['save', 'Remember that my sister'], ['recall', "What's my sister"], ['install', "I don't have a preference"], ['install', 'install gbrain']];

export function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** Which task prompt the conversation is answering: the newest user message that carries one of the task's texts. */
export function promptKind(body: Record<string, any>): PromptKind {
  const msgs: any[] = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role !== 'user') continue;
    const text = strings(msgs[i].content).join('\n');
    for (const [kind, cue] of CUES) if (text.includes(cue)) return kind;
  }
  return typeof body.input === 'string' ? CUES.find(([, cue]) => body.input.includes(cue))?.[0] ?? 'other' : 'other';
}

const MARK = /HECHECK ([A-Za-z0-9_.-]+)=([^\s"'\\]*)/g;
/** Every HECHECK key=value the request carries (tool results; JSON-escaped output ends a value at the backslash). */
export function markers(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of strings(body)) for (const m of s.matchAll(MARK)) out[m[1]!] = m[2]!;
  return out;
}

export interface WebFetchState { searched: boolean; id: string | null; result: string | null; is_error: boolean | null; page_requests: number }
export interface CaseState { attempts: Record<string, number>; waits: number; waitUntil: number | null; requests: number; seen: Record<string, string>; gbrainTools: number; webfetch: WebFetchState }
export const newState = (): CaseState => ({ attempts: {}, waits: 0, waitUntil: null, requests: 0, seen: {}, gbrainTools: 0, webfetch: { searched: false, id: null, result: null, is_error: null, page_requests: 0 } });

/** The next command for this conversation, or null for a text reply: the first step of the prompt's plan whose done marker
 *  the request does not carry yet, each tried at most twice (a `once` step once), and, once the install script was started,
 *  the wait repeated until the install is done or 780 s pass. */
export function nextCommand(kind: PromptKind, body: Record<string, any>, state: CaseState, harness: string, commit: string, now = Date.now()): Step | null {
  const seen = markers(body);
  const plan = kind === 'install' ? installPlan(harness, commit) : kind === 'recall' ? recallPlan(harness) : [];
  for (const step of plan) {
    if (step.name === 'wait') {
      if (!state.attempts['install-run'] || seen.install_done !== undefined || state.waits >= MAX_WAITS) continue;
      state.waitUntil ??= now + WAIT_S * 1000;
      if (now > state.waitUntil) continue;
      state.waits++;
      return step;
    }
    if (seen['step.' + step.name] !== undefined) continue;
    const n = (state.attempts[step.name] ?? 0) + 1;
    if (n > (step.once ? 1 : MAX_ATTEMPTS)) continue;
    state.attempts[step.name] = n;
    return step;
  }
  return null;
}

/** Codex's code-mode shell: JavaScript whose nested exec_command runs the command and waits up to 120 s for it. */
export const codexSource = (command: string) => 'const r = await tools.exec_command({ cmd: ' + JSON.stringify(command) + ', yield_time_ms: 120000 });\ntext(r);\n';
const toolArgs = (name: string, command: string, background = false) => ({ ...SHELL_TOOLS[name]!(command), ...(name === 'exec_command' ? { yield_time_ms: 120000 } : {}), ...(background && name === 'terminal' ? { background: true } : {}) });

/** One model reply on the Messages, Responses or Chat Completions route: a call of the declared shell tool running the
 *  command, or the text. Other routes get fake-upstream.ts's reply. */
export interface Call { tool: { name: string; custom: boolean; namespace?: string }; command: string; args?: Record<string, unknown>; source?: string; background?: boolean }
export function answer(path: string, body: Record<string, any>, n: number, call: Call | null, text: string): Response {
  const model = body.model ?? 'fake';
  const stream = body.stream === true;
  const now = Math.floor(Date.now() / 1000);
  if (path.endsWith('/v1/messages')) {
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const id = 'msg_he_' + n;
    const block: Record<string, unknown> = call ? { type: 'tool_use', id: 'toolu_he_' + n, name: call.tool.name, input: call.args ?? toolArgs(call.tool.name, call.command, call.background) } : { type: 'text', text };
    const stop = call ? 'tool_use' : 'end_turn';
    if (!stream) return Response.json({ id, type: 'message', role: 'assistant', model, content: [block], stop_reason: stop, stop_sequence: null, usage });
    return sse([
      ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: call ? { ...block, input: {} } : { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: call ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } }],
      ['message_stop', { type: 'message_stop' }],
    ]);
  }
  if (path.endsWith('/v1/responses')) {
    const id = 'resp_he_' + n;
    const item: Record<string, any> = !call ? { type: 'message', id: 'msg_he_' + n, status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }
      : call.tool.custom ? { type: 'custom_tool_call', id: 'ctc_he_' + n, call_id: 'call_he_' + n, ...(call.tool.namespace ? { namespace: call.tool.namespace } : {}), name: call.tool.name, input: call.source ?? codexSource(call.command), status: 'completed' }
      : { type: 'function_call', id: 'fc_he_' + n, call_id: 'call_he_' + n, ...(call.tool.namespace ? { namespace: call.tool.namespace } : {}), name: call.tool.name, arguments: JSON.stringify(call.args ?? toolArgs(call.tool.name, call.command, call.background)), status: 'completed' };
    const response = { id, object: 'response', created_at: now, status: 'completed', model, output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
    if (!stream) return Response.json(response);
    const pending = { ...response, status: 'in_progress', output: [], usage: null };
    const middle: Array<[string, Record<string, unknown>]> = !call ? [
      ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } }],
      ['response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }],
      ['response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: text }],
      ['response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text }],
      ['response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] }],
    ] : call.tool.custom ? [
      ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', input: '' } }],
      ['response.custom_tool_call_input.delta', { item_id: item.id, output_index: 0, delta: item.input }],
      ['response.custom_tool_call_input.done', { item_id: item.id, output_index: 0, input: item.input }],
    ] : [
      ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', arguments: '' } }],
      ['response.function_call_arguments.delta', { item_id: item.id, output_index: 0, delta: item.arguments }],
      ['response.function_call_arguments.done', { item_id: item.id, output_index: 0, arguments: item.arguments }],
    ];
    const all: Array<[string, Record<string, unknown>]> = [['response.created', { response: pending }], ['response.in_progress', { response: pending }], ...middle, ['response.output_item.done', { output_index: 0, item }], ['response.completed', { response }]];
    return sse(all.map(([e, d], i) => [e, { type: e, sequence_number: i, ...d }]));
  }
  if (path.endsWith('/v1/chat/completions')) {
    const id = 'chatcmpl_he_' + n;
    const echoed = path.startsWith('/particle/') ? 'particle-ai/' + model : model;
    const tc = call ? { id: 'call_he_' + n, type: 'function', function: { name: call.tool.name, arguments: JSON.stringify(toolArgs(call.tool.name, call.command, call.background)) } } : null;
    const finish = tc ? 'tool_calls' : 'stop';
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (!stream) return Response.json({ id, object: 'chat.completion', created: now, model: echoed, choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content: tc ? null : text, ...(tc ? { tool_calls: [tc] } : {}) } }], usage });
    const chunk = (delta: unknown, f: string | null) => ({ id, object: 'chat.completion.chunk', created: now, model: echoed, choices: [{ index: 0, delta, finish_reason: f }] });
    return sse([[null, chunk(tc ? { role: 'assistant', content: null, tool_calls: [{ index: 0, ...tc }] } : { role: 'assistant', content: text }, null)], [null, chunk({}, finish)], [null, { id, object: 'chat.completion.chunk', model: echoed, choices: [], usage }], [null, '[DONE]']]);
  }
  return reply(path, body, n);
}

const TEXT: Record<PromptKind, string> = { install: 'gbrain is installed.', save: 'Saved.', recall: 'I checked the gbrain setup.', hinted: 'I checked gbrain.', other: 'Done.' };

/** gbrain tools a request offers: declared tools named for gbrain, the distinct mcp__gbrain__ names in the tool declarations, or
 *  the count Codex's recall-tools exec printed from Object.keys(tools), whichever is most. */
export function gbrainToolCount(body: Record<string, any>): number {
  const declared = toolDecls(body).filter((d) => /gbrain/i.test(d.name) || /gbrain/i.test(d.namespace ?? '')).length;
  const named = new Set(strings(body.tools ?? []).flatMap((t) => t.match(/\bmcp__gbrain__\w+/g) ?? []));
  return Math.max(declared, named.size, Number(markers(body).gbrain_tools ?? 0) || 0);
}

/** The fake upstream: one scripted conversation plan per case, every HECHECK marker the requests carried kept in state.seen. */
/** The WebFetch case's side of a request: the WebFetch tool result once it comes back, and whether the request carries the page. */
export function noteWebFetch(body: Record<string, any>, w: WebFetchState): void {
  if (strings(body).some((s) => s.includes(WEBFETCH_MARK))) w.page_requests++;
  if (!w.id) return;
  for (const m of Array.isArray(body.messages) ? body.messages : []) {
    for (const b of Array.isArray(m?.content) ? m.content : []) {
      if (b?.type !== 'tool_result' || b.tool_use_id !== w.id) continue;
      w.result = typeof b.content === 'string' ? b.content : (Array.isArray(b.content) ? b.content : []).map((x: any) => (typeof x?.text === 'string' ? x.text : '')).join('\n');
      w.is_error = b.is_error === true;
    }
  }
}

/** The WebFetch case's calls in the install conversation: WebFetch once when the request declares it, else, once, Claude Code's
 *  ToolSearch selecting it, since Claude Code 2.1.312 defers WebFetch and declares it only after a ToolSearch loads it. */
export function webFetchCall(kind: PromptKind, body: Record<string, any>, w: WebFetchState): Call | null {
  if (kind !== 'install' || w.id) return null;
  const names = toolDecls(body).map((d) => d.name);
  if (names.includes('WebFetch')) return { tool: { name: 'WebFetch', custom: false }, command: '', args: { url: WEBFETCH_URL, prompt: 'What are the install steps for Claude Code?' } };
  if (names.includes('ToolSearch') && !w.searched) return { tool: { name: 'ToolSearch', custom: false }, command: '', args: { query: 'select:WebFetch', max_results: 1 } };
  return null;
}

export function startFake(active: () => { harness: string; commit: string; state: CaseState; webfetch?: boolean } | null) {
  let n = 0;
  return Bun.serve({ port: 0, hostname: '127.0.0.1', idleTimeout: 0, fetch: async (req) => {
    const path = new URL(req.url).pathname;
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) as Record<string, any> : {};
    const a = active();
    n++;
    const kind = promptKind(body);
    if (a) {
      a.state.requests++;
      Object.assign(a.state.seen, markers(body));
      if (kind === 'recall') a.state.gbrainTools = Math.max(a.state.gbrainTools, gbrainToolCount(body));
    }
    if (a?.webfetch) {
      noteWebFetch(body, a.state.webfetch);
      const call = webFetchCall(kind, body, a.state.webfetch);
      if (call?.tool.name === 'WebFetch') a.state.webfetch.id = 'toolu_he_' + n;
      if (call?.tool.name === 'ToolSearch') a.state.webfetch.searched = true;
      return answer(path, body, n, call, TEXT[kind]);
    }
    const tool = shellTool(body);
    const step = a && tool ? nextCommand(kind, body, a.state, a.harness, a.commit) : null;
    return answer(path, body, n, step && tool ? { tool, command: step.command, ...(step.background ? { background: true } : {}), ...(step.source ? { source: step.source } : {}) } : null, TEXT[kind]);
  } });
}

export interface Check { ok: boolean; detail: string }
export interface Evidence { record: TrialRecord | null; usage: Array<Record<string, any>>; seen: Record<string, string>; requests: number; gbrainTools?: number; probes: Array<{ brain_path?: string | null }>; watch: Array<{ brain_path?: string | null }> }

export function evaluate(c: CheckCase, e: Evidence): { a: Check; b: Check; c: Check; d: Check } {
  const s = e.seen;
  const key = e.record ? trialKey(e.record.trial_id) : null;
  const forwarded = e.usage.filter((l) => l.key === key && l.outcome === 'forwarded' && l.provider + ':' + l.model === c.model);
  const presented = forwarded.filter((l) => l.token_presented === true);
  const a = { ok: !!key && presented.length > 0 && e.requests > 0, detail: forwarded.length + ' forwarded ' + c.model + ' line(s), ' + presented.length + ' with the token presented; the fake saw ' + e.requests + ' request(s)' };

  const exits = ['bun_exit', 'install_exit', 'setup_exit'].map((k) => k + '=' + (s['install.' + k] ?? 'missing'));
  const toolsNeeded = SESSION_MCP.has(c.harness);
  const tools = e.gbrainTools ?? 0;
  const bOk = exits.every((x) => x.endsWith('=0')) && Number(s.mcp_listed ?? 0) >= 1 && (!toolsNeeded || tools >= 1);
  const b = { ok: bOk, detail: exits.join(' ') + ' mcp_listed=' + (s.mcp_listed ?? 'missing') + ' gbrain_tools_offered=' + tools + (toolsNeeded ? ' (needed)' : ' (reported)') + ' gbrain_procs=' + (s.gbrain_procs ?? 'missing') + ' gbrain_bin=' + (s.gbrain_bin ?? 'missing') };

  const env = ['install', 'recall'].map((t) => {
    const names = (s[t + '.env_names'] ?? 'missing').split(',').filter((x) => x && x !== 'none');
    const bad = names.filter((x) => PROVIDER_VARS.includes(x));
    return { t, ok: s[t + '.token_read'] === '1' && s[t + '.token_hits'] === '0' && bad.length === 0 && s[t + '.env_names'] !== undefined,
      detail: t + ': env_names=' + (s[t + '.env_names'] ?? 'missing') + ' token_read=' + (s[t + '.token_read'] ?? 'missing') + ' token_hits=' + (s[t + '.token_hits'] ?? 'missing') };
  });
  const cc = { ok: env.every((x) => x.ok), detail: env.map((x) => x.detail).join('; ') };

  const oracle = s.brain_path && s.brain_path !== 'none' ? s.brain_path : null;
  const probePaths = [...new Set(e.probes.map((p) => p.brain_path).filter((p): p is string => !!p))];
  const watchPaths = [...new Set(e.watch.map((p) => p.brain_path).filter((p): p is string => !!p))];
  const d = { ok: !!oracle && probePaths.length > 0 && watchPaths.length > 0 && [...probePaths, ...watchPaths].every((p) => p === oracle),
    detail: 'gbrain=' + (s.brain_path ?? 'missing') + ' probe=' + (probePaths.join(',') || 'none') + ' watcher=' + (watchPaths.join(',') || 'none') };
  return { a, b, c: cc, d };
}

/** The WebFetch case from the egress log and the fake's notes: whether the preflight to Claude Code's domain check got through
 *  (reported, never failed on: the blocklist refuses api.anthropic.com on purpose), and whether the fetch worked: the page host
 *  admitted, the page in a model request, and a tool result that is not an error. */
export function evaluateWebFetch(w: WebFetchState, egress: Array<{ host: string; port: number; decision: string; reason?: string }>): { preflight: { blocked: boolean; detail: string }; fetch: Check } {
  const show = (ls: typeof egress) => ls.map((l) => l.host + ':' + l.port + ' ' + l.decision + (l.reason ? ' (' + l.reason + ')' : '')).join(', ');
  const pre = egress.filter((l) => PREFLIGHT_HOSTS.includes(l.host));
  const page = egress.filter((l) => l.host === new URL(WEBFETCH_URL).hostname);
  const preflight = { blocked: pre.some((l) => l.decision === 'blocked'), detail: pre.length ? show(pre) : 'no connection to ' + PREFLIGHT_HOSTS.join(' or ') };
  const ok = page.some((l) => l.decision === 'allowed') && w.page_requests > 0 && w.is_error === false;
  const result = w.result === null ? 'missing' : (w.is_error ? 'error' : 'ok') + ' ' + JSON.stringify(w.result.slice(0, 300));
  return { preflight, fetch: { ok, detail: 'WebFetch ' + (w.id ? 'called' : 'never called (not offered' + (w.searched ? ' after a ToolSearch for it)' : ', and no ToolSearch to load it)')) + '; tool result ' + result + '; ' + new URL(WEBFETCH_URL).hostname + ' ' + (show(page) || 'never contacted') + '; ' + w.page_requests + ' model request(s) carried the page' } };
}

// ---- Codex semantic search after gbrain setup codex (GBRA-108, gbrain#9396) ---------------------------------------------
// One keyless case per gbrain version, outside the install trial: the Codex image installs gbrain at the commit, a brain is
// made with OpenAI embeddings pointed at this process (OPENAI_BASE_URL, a dummy OPENAI_API_KEY), "gbrain setup codex" wires
// Codex, one page goes in, and a headless "codex exec" against this process's fake model calls gbrain's query tool over MCP.
// It passes when (a) the query's embedding request reached the fake with the dummy key while Codex ran, so the MCP child had
// OPENAI_API_KEY and OPENAI_BASE_URL, (b) that request arrived at all, and (c) the query tool's result says vector_enabled true
// with no embed_unavailable stage. Names and counts only: the dummy key is compared, never printed.

export const SEMANTIC_VERSIONS: Record<string, string> = { 'v0.60.723.0': '894ba65d8f3294bd88e32390145fa23a53037331', 'v0.60.717.0': '5dc712b93742ac9ebb82983917659ce8ef493e7c' };
export const SEMANTIC_KEY = 'sk-he-semantic-dummy';
export const SEMANTIC_PAGE = 'The zebra project codename is Bluefin Harbor. It ships in March.';
export const SEMANTIC_QUESTION = 'What is the codename of the zebra project?';
export const FORWARDED_NAMES = ['OPENAI_API_KEY', 'OPENAI_BASE_URL'];

/** A deterministic unit vector for a text, so the page and a query about it land close together. */
export function fakeVector(text: string, dims: number): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619) >>> 0;
    v[h % dims]! += 1;
  }
  if (Math.max(...v) === 0) v[0] = 1;
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

export function embeddingsReply(body: Record<string, any>): Response {
  const inputs: string[] = Array.isArray(body.input) ? body.input.map(String) : [String(body.input ?? '')];
  const dims = Number.isInteger(body.dimensions) && body.dimensions > 0 ? body.dimensions : /large/.test(String(body.model)) ? 3072 : 1536;
  const data = inputs.map((t, index) => {
    const v = fakeVector(t, dims);
    const embedding = body.encoding_format === 'base64' ? Buffer.from(new Float32Array(v).buffer).toString('base64') : v;
    return { object: 'embedding', index, embedding };
  });
  const tokens = inputs.reduce((s, t) => s + Math.max(1, Math.ceil(t.length / 4)), 0);
  return Response.json({ object: 'list', data, model: body.model ?? 'text-embedding-3-small', usage: { prompt_tokens: tokens, total_tokens: tokens } });
}

interface ToolDecl { name: string; type: string | null; namespace?: string }
export function toolDecls(body: Record<string, any>): ToolDecl[] {
  const out: ToolDecl[] = [];
  const walk = (list: unknown, namespace?: string) => {
    for (const t of Array.isArray(list) ? list as any[] : []) {
      if (t?.type === 'namespace') { walk(t.tools, t.name); continue; }
      const name = t?.name ?? t?.function?.name;
      if (typeof name === 'string') out.push({ name, type: t?.type ?? null, ...(namespace ? { namespace } : {}) });
    }
  };
  walk(body.tools);
  for (const i of Array.isArray(body.input) ? body.input : []) if (i?.type === 'additional_tools') walk(i.tools);
  return out;
}

/** The call that runs gbrain's query (else search) tool: a direct MCP function tool when Codex declares one, else Codex's
 *  code-mode exec calling it from JavaScript. Null when neither is declared. */
export function gbrainQueryCall(body: Record<string, any>): Call | null {
  const decls = toolDecls(body);
  const isGbrain = (d: ToolDecl) => /gbrain/i.test(d.name) || /gbrain/i.test(d.namespace ?? '');
  for (const verb of ['query', 'search', 'recall']) {
    const d = decls.find((x) => isGbrain(x) && x.type !== 'custom' && new RegExp('(^|[_.])' + verb + '$').test(x.name));
    if (d) return { tool: { name: d.name, custom: false, ...(d.namespace ? { namespace: d.namespace } : {}) }, command: '', args: { query: SEMANTIC_QUESTION } };
  }
  const exec = decls.find((x) => x.type === 'custom' && x.name === 'exec');
  if (!exec) return null;
  // Codex's code mode exposes MCP tools inside exec's `tools` object under a name this does not assume: it lists the names,
  // calls the gbrain query (else search) tool it finds, and prints the result.
  const source = [
    'const q = ' + JSON.stringify(SEMANTIC_QUESTION) + ';',
    'let names = []; try { names = Object.keys(tools); } catch {}',
    'for (const n of ["mcp__gbrain__query", "gbrain__query", "gbrain_query", "mcp__gbrain__search", "gbrain__search"]) { try { if (typeof tools[n] === "function" && !names.includes(n)) names.push(n); } catch {} }',
    'text("TOOLS " + names.join(","));',
    'const name = [/query$/i, /search$/i, /recall$/i].map((v) => names.find((n) => /gbrain/i.test(n) && v.test(n))).find(Boolean);',
    'if (name) { text("CALLED " + name); const r = await tools[name]({ query: q }); text(typeof r === "string" ? r : JSON.stringify(r)); } else text("NO_GBRAIN_TOOL");',
  ].join('\n') + '\n';
  return { tool: { name: 'exec', custom: true, ...(exec.namespace ? { namespace: exec.namespace } : {}) }, command: '', source };
}

export interface SemanticState { phase: string; embeddings: Array<{ phase: string; key_matches: boolean; inputs: number; model: string | null; query: boolean }>; models: number; tools: string[]; called: string | null; outputs: string[] }
export const newSemanticState = (): SemanticState => ({ phase: 'setup', embeddings: [], models: 0, tools: [], called: null, outputs: [] });

const toolOutputs = (body: Record<string, any>): string[] => (Array.isArray(body.input) ? body.input : [])
  .filter((i: any) => typeof i?.type === 'string' && i.type.endsWith('_call_output')).map((i: any) => strings(i.output).join('\n'));

export function startSemanticFake(hostname: string, state: () => SemanticState) {
  let n = 0;
  return Bun.serve({ port: 0, hostname, idleTimeout: 0, fetch: async (req) => {
    const url = new URL(req.url);
    const s = state();
    if (url.pathname === '/__he/phase') { s.phase = url.searchParams.get('p') ?? s.phase; return new Response('ok'); }
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) as Record<string, any> : {};
    if (url.pathname.endsWith('/embeddings')) {
      s.embeddings.push({ phase: s.phase, key_matches: req.headers.get('authorization') === 'Bearer ' + SEMANTIC_KEY, inputs: Array.isArray(body.input) ? body.input.length : 1, model: body.model ?? null,
        query: strings(body.input).some((t) => t.includes(SEMANTIC_QUESTION)) });
      return embeddingsReply(body);
    }
    n++;
    if (url.pathname.endsWith('/responses')) {
      s.models++;
      if (!s.tools.length) s.tools = toolDecls(body).map((d) => (d.namespace ? d.namespace + '/' : '') + d.name + (d.type === 'custom' ? ' (custom)' : ''));
      const outs = toolOutputs(body);
      if (outs.length) { s.outputs = outs; return answer(url.pathname, body, n, null, 'Done.'); }
      const call = gbrainQueryCall(body);
      if (call) s.called = (call.tool.namespace ? call.tool.namespace + '/' : '') + call.tool.name;
      return answer(url.pathname, body, n, call, 'No gbrain tool was offered.');
    }
    return reply(url.pathname, body, n);
  } });
}

/** The container script: gbrain at the commit, a brain with OpenAI embeddings on the fake, setup codex, one page, then a
 *  headless codex exec on the fake model. Prints SEMCHECK key=value lines (names, exit codes and counts only). */
export function semanticScript(commit: string, fake: string): string {
  const mark = (k: string, v: string) => "printf 'SEMCHECK %s=%s\\n' " + k + ' ' + v;
  return [
    'set -u',
    'export HOME=/tmp/he-home CODEX_HOME=/tmp/he-home/.codex; mkdir -p "$CODEX_HOME"; cd "$HOME"',
    'export PATH="$HOME/.bun/bin:$HOME/.npm-global/bin:$PATH"',
    'log="$HOME/semantic.log"',
    'npm install -g --prefix "$HOME/.npm-global" bun >>"$log" 2>&1; ' + mark('bun_exit', '$?'),
    'bun install -g "github:garrytan/gbrain#' + commit + '" >>"$log" 2>&1; ' + mark('install_exit', '$?'),
    mark('gbrain_version', '"$(gbrain --version 2>/dev/null | head -n1 | tr -cd 0-9.)"'),
    'export OPENAI_API_KEY=' + SEMANTIC_KEY + ' OPENAI_BASE_URL=' + fake + '/v1',
    'gbrain init --pglite --embedding-model openai:text-embedding-3-small </dev/null >>"$log" 2>&1; ' + mark('init_exit', '$?'),
    'gbrain setup codex </dev/null > "$HOME/setup.out" 2>&1; ' + mark('setup_exit', '$?'),
    'cat "$HOME/setup.out" >> "$log"',
    mark('setup_mentions_embedding', '"$(grep -ciE \'embedding|keyword|semantic\' "$HOME/setup.out")"'),
    mark('config_env_vars', '"$(grep -c \'^env_vars\' "$CODEX_HOME/config.toml")"'),
    'for n in ' + FORWARDED_NAMES.join(' ') + '; do ' + mark('config_names_$n', '"$(grep \'^env_vars\' "$CODEX_HOME/config.toml" | grep -c "\\"$n\\"")"') + '; done',
    mark('embedding_model', '"$(bun -e \'try { console.log(JSON.parse(require("fs").readFileSync(process.env.HOME + "/.gbrain/config.json", "utf8")).embedding_model ?? "none") } catch { console.log("none") }\')"'),
    "printf '%s\\n' '" + SEMANTIC_PAGE + "' | gbrain put notes/zebra-project >>\"$log\" 2>&1; " + mark('put_exit', '$?'),
    'gbrain embed --stale >>"$log" 2>&1; ' + mark('embed_exit', '$?'),
    'curl -fsS "' + fake + '/__he/phase?p=codex" >/dev/null',
    'printf \'model = "gpt-6.1-sol"\\nmodel_provider = "hefake"\\napproval_policy = "never"\\nsandbox_mode = "danger-full-access"\\ncheck_for_update_on_startup = false\\n\\n\' > "$CODEX_HOME/config.new"',
    'cat "$CODEX_HOME/config.toml" >> "$CODEX_HOME/config.new"',
    'printf \'\\n[model_providers.hefake]\\nname = "hefake"\\nbase_url = "' + fake + '/v1"\\nenv_key = "HE_FAKE_KEY"\\nwire_api = "responses"\\nsupports_websockets = false\\n\' >> "$CODEX_HOME/config.new"',
    'mv "$CODEX_HOME/config.new" "$CODEX_HOME/config.toml"',
    'HE_FAKE_KEY=dummy timeout 600 codex exec --json --skip-git-repo-check -C "$HOME" ' + JSON.stringify(SEMANTIC_QUESTION) + ' > "$HOME/exec.jsonl" 2>"$HOME/exec.err"; ' + mark('exec_exit', '$?'),
    'curl -fsS "' + fake + '/__he/phase?p=after" >/dev/null',
    mark('exec_events', '"$(wc -l < "$HOME/exec.jsonl")"'),
    'tail -c 4000 "$HOME/exec.err" >> "$log"; tail -c 6000 "$HOME/exec.jsonl" >> "$log"',
    'mkdir -p /he-out && cp "$log" "$HOME/exec.jsonl" "$HOME/setup.out" "$CODEX_HOME/config.toml" /he-out/ 2>/dev/null; chmod -R a+r /he-out',
  ].join('\n');
}

export function evaluateSemantic(s: SemanticState, marks: Record<string, string>): { a: Check; b: Check; c: Check } {
  const during = s.embeddings.filter((e) => e.phase === 'codex');
  const keyed = during.filter((e) => e.key_matches);
  const queries = during.filter((e) => e.query);
  const out = s.outputs.join('\n');
  const vector = /vector_enabled\\*"?\s*:\s*true/.test(out);
  const unavailable = /embed_unavailable|embed_timeout|vector_arm_failed/.test(out);
  const degraded = /search_degraded\\*"?\s*:\s*\\*"([\w-]+)/.exec(out)?.[1] ?? null;
  const called = /CALLED (\S+)/.exec(out)?.[1] ?? s.called;
  const recalled = /recall$/i.test(called ?? '') && !degraded;
  const names = FORWARDED_NAMES.filter((n) => marks['config_names_' + n] === '1');
  return {
    a: { ok: keyed.length > 0, detail: keyed.length + ' embedding request(s) from the gbrain MCP child during codex exec carried the dummy OPENAI_API_KEY and reached OPENAI_BASE_URL; config.toml env_vars names ' + (names.join(',') || 'none') },
    b: { ok: queries.length > 0, detail: queries.length + ' embedding request(s) for the question during codex exec, of ' + during.length + ' then (' + s.embeddings.filter((e) => e.phase === 'setup').length + ' during init, put and embed)' },
    c: { ok: (vector || recalled) && !unavailable, detail: 'query tool ' + (called ?? 'not called') + '; result vector_enabled=' + (/vector_enabled\\*"?\s*:\s*(true|false)/.exec(out)?.[1] ?? 'absent') + ' search_degraded=' + (degraded ?? 'absent') + (unavailable ? ', degraded embed stage present' : '') },
  };
}

async function semanticCase(version: string, outDir: string, image: string): Promise<Record<string, unknown>> {
  const commit = SEMANTIC_VERSIONS[version]!;
  const gw = Bun.spawnSync(['docker', 'network', 'inspect', 'bridge', '-f', '{{(index .IPAM.Config 0).Gateway}}']).stdout.toString().trim() || '172.17.0.1';
  let state = newSemanticState();
  const fake = startSemanticFake(gw, () => state);
  const dir = join(outDir, 'codex-semantic-' + version);
  mkdirSync(dir, { recursive: true });
  try {
    const url = 'http://host.docker.internal:' + fake.port;
    const proc = Bun.spawn(['docker', 'run', '--rm', '--add-host', 'host.docker.internal:' + gw, '-v', dir + ':/he-out', '--entrypoint', 'bash', image, '-c', semanticScript(commit, url)],
      { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' }, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    writeFileSync(join(dir, 'docker.out'), stdout + '\n--- stderr ---\n' + stderr);
    const marks: Record<string, string> = {};
    for (const m of stdout.matchAll(/SEMCHECK ([A-Za-z0-9_.-]+)=(\S*)/g)) marks[m[1]!] = m[2]!;
    const checks = evaluateSemantic(state, marks);
    const ok = Object.values(checks).every((x) => x.ok);
    return { version, commit, ok, checks, marks, forwarded_names: FORWARDED_NAMES, model_requests: state.models, tools_offered: state.tools, embeddings: state.embeddings, result_excerpt: state.outputs.join('\n').slice(0, 1500), dir };
  } finally { fake.stop(true); state = newSemanticState(); }
}

const readJsonLines = (path: string): Array<Record<string, any>> => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];

async function main(argv: string[]): Promise<number> {
  const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const out = flag('--out');
  if (!out) { console.error('usage: bun scripts/gbrain-install/real-image-check.ts --out <dir> --tag <gbrain release tag> [--harness claude-code,codex,openclaw,hermes] [--commit <the commit it names>]'); return 2; }
  const semantic = flag('--codex-semantic')?.split(',');
  if (semantic) {
    const unknown = semantic.filter((v) => !SEMANTIC_VERSIONS[v]);
    if (unknown.length) { console.error('--codex-semantic takes ' + Object.keys(SEMANTIC_VERSIONS).join(',') + ' (got ' + unknown.join(',') + ')'); return 2; }
    const outDir = resolve(out);
    mkdirSync(outDir, { recursive: true });
    const results = [];
    for (const v of semantic) {
      console.log('== codex semantic ' + v);
      const r = await semanticCase(v, outDir, 'harness-eval/codex:dev');
      console.log('== codex semantic ' + v + ': ' + (r.ok ? 'pass' : 'FAIL') + ' ' + JSON.stringify(r.checks));
      results.push(r);
    }
    writeFileSync(join(outDir, 'codex-semantic.json'), JSON.stringify({ schema: 'gbrain-codex-semantic-check/1', at: new Date().toISOString(), cases: results }, null, 1) + '\n');
    return results.every((r) => r.ok) ? 0 : 1;
  }
  const only = flag('--harness')?.split(',');
  const cases = CASES.filter((c) => !only || only.includes(c.harness));
  if (!cases.length) { console.error('--harness names no install-mode harness (claude-code, codex, openclaw, hermes)'); return 2; }
  const repoRoot = resolve(import.meta.dir, '..', '..');
  process.chdir(repoRoot);
  const tag = flag('--tag');
  if (!tag || !/^v\d+(\.\d+){2,3}$/.test(tag)) { console.error('--tag must name the gbrain release the run pins, such as v0.60.733.0'); return 2; }
  let commit = flag('--commit');
  if (!commit) {
    const r = gbrainLsRemote(tag);
    commit = r.status === 0 ? tagCommit(r.stdout, tag) ?? undefined : undefined;
    if (!commit) { console.error('git ls-remote found no gbrain tag ' + tag + '; pass --commit <40-hex commit>'); return 2; }
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) { console.error('--commit must be a full 40-character commit'); return 2; }
  const outDir = resolve(out);
  mkdirSync(outDir, { recursive: true });
  let active: { harness: string; commit: string; state: CaseState } | null = null;
  const fake = startFake(() => active);
  const base = 'http://127.0.0.1:' + fake.port;
  const results: Array<Record<string, unknown>> = [];
  try {
    for (const [i, c] of cases.entries()) {
      const provider = c.model.slice(0, c.model.indexOf(':'));
      const runId = 'real-image-check-' + (i + 1) + '-' + c.harness + '-' + provider + (c.webfetch ? '-webfetch' : '');
      const dir = join(outDir, runId);
      const runDir = join(dir, 'run');
      mkdirSync(runDir, { recursive: true });
      const preregPath = join(dir, 'prereg.json');
      writeFileSync(preregPath, JSON.stringify({ schema_version: 1, run_id: runId, question: 'keyless real-image check of the gbrain install trial (GST-2715)', tasks: {}, spend_cap_usd: 100,
        wall_clock_s: { 'gbrain-install': 900 }, drop_order: [], minimum_v01: [],
        cells: [{ id: 'check', harness: c.harness, model: c.model, slice: 'gbrain-install', split: 'dev', repetitions: 1, ceiling: { input_tokens: 10000000, output_tokens: 1000000 }, network: 'install', install: { arm: 'bare', tag, commit, seed: 'real-image-check' } }] }, null, 1));
      const { prereg, sha256 } = loadPrereg(preregPath);
      const manifestPath = join(runDir, 'manifest.json');
      writeFileSync(manifestPath, JSON.stringify(buildManifest(prereg, sha256), null, 1));
      active = { harness: c.harness, commit, state: newState(), ...(c.webfetch ? { webfetch: true } : {}) };
      const label = c.harness + ' ' + c.model + (c.webfetch ? ' webfetch' : '');
      console.log('== ' + label + ' (' + runDir + ')');
      let thrown: string | null = null;
      await executeRun(JSON.parse(readFileSync(manifestPath, 'utf8')), manifestPath, {
        harnessMode: 'docker', repoRoot, leaseUsd: 100, newLease: true, maxOutputTokens: 128000,
        proxyEnv: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', ...DUMMY_KEYS },
        proxyUpstream: { anthropic: base, openai: base, particle: base + '/particle' },
        installKeyEnv: { ...DUMMY_KEYS }, log: (l) => console.log('[' + label + '] ' + l),
      }).catch((e: Error) => { thrown = e.message; });
      const record = (readJsonLines(join(runDir, 'trials.jsonl'))[0] as TrialRecord | undefined) ?? null;
      const trialDir = record?.paths?.dir ?? null;
      const turnsDir = trialDir ? join(trialDir, 'logs', 'turns') : null;
      const probes = turnsDir && existsSync(turnsDir) ? readdirSync(turnsDir).filter((f) => f.endsWith('.probe.json')).sort().flatMap((f) => { try { return [JSON.parse(readFileSync(join(turnsDir, f), 'utf8'))]; } catch { return []; } }) : [];
      const watch = trialDir ? readJsonLines(join(trialDir, 'logs', 'install-watch.ndjson')) : [];
      const state = active.state;
      active = null;
      const egress = readJsonLines(join(runDir, 'install-egress.ndjson'));
      const install = evaluate(c, { record, usage: readJsonLines(join(runDir, 'proxy-usage.ndjson')), seen: state.seen, requests: state.requests, gbrainTools: state.gbrainTools, probes, watch });
      const web = c.webfetch ? evaluateWebFetch(state.webfetch, egress as Array<{ host: string; port: number; decision: string; reason?: string }>) : null;
      const checks: Record<string, Check> = web ? { a: install.a, fetch: web.fetch } : install;
      const installLog = trialDir ? join(trialDir, 'state', '.he-check', 'install.log') : null;
      const ok = !thrown && Object.values(checks).every((x) => x.ok);
      results.push({ harness: c.harness, model: c.model, ...(c.webfetch ? { case: 'webfetch', preflight: web!.preflight } : {}), ok, checks, run_dir: runDir, error: thrown ?? record?.error ?? null, termination: record?.termination ?? null, outcome: record?.install?.outcome ?? null,
        markers: state.seen, fake_requests: state.requests, egress: { allowed: egress.filter((l) => l.decision === 'allowed').length, blocked: egress.filter((l) => l.decision === 'blocked').length, failed: egress.filter((l) => l.decision === 'failed').length },
        cold_download: readJsonLines(join(runDir, 'install-download.jsonl'))[0] ?? null, install_log: installLog && existsSync(installLog) ? installLog : null });
      console.log('== ' + label + ': ' + (ok ? 'pass' : 'FAIL') + ' ' + Object.entries(checks).map(([k, v]) => k + '=' + (v.ok ? 'ok' : 'fail')).join(' ') + (web ? ' preflight=' + (web.preflight.blocked ? 'blocked' : 'not blocked') : ''));
    }
  } finally {
    fake.stop(true);
  }
  const ok = results.length === cases.length && results.every((r) => r.ok);
  const reportPath = join(outDir, 'real-image-check.json');
  writeFileSync(reportPath, JSON.stringify({ schema: 'gbrain-install-real-image-check/1', at: new Date().toISOString(), gbrain_tag: tag, gbrain_commit: commit, ok, cases: results }, null, 1) + '\n');
  console.log('real-image check: ' + (ok ? 'pass' : 'FAIL') + ' (' + results.filter((r) => r.ok).length + '/' + cases.length + ' cases); ' + reportPath);
  return ok ? 0 : 1;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
