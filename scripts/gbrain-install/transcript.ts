// Provenance: parseClaude, parseCodex, contentText and mcpToolName are ported from gbrain-evals eval/runner/cat41/transcript.ts
// (commit 4f27313a, sha256 92a286dd5459ab66bf8d4e0fed1a72773c431948bcdfe845559d0e98923247d7), norm from eval/runner/cat41/scenarios.ts
// (same commit, sha256 36fba23ab39dad9c7bd40452b82c6f1185574f7ee005ad6f61038f01242aba4b) and gbrainArgvFromShell from
// eval/runner/cat41/classify.ts (same commit, sha256 42232d5a5f490c391ea7600b59d56f0e83d9d1d886bea66ac670d9035cfba068), all MIT, same owner.
// Changes: one flat NEvent shape with string input and output and the turn's session and number; the gbrain CLI is matched only in
// command position, so "bun install -g github:garrytan/gbrain" or "cd gbrain" is not a gbrain call; the OpenClaw and Hermes parsers are new.
//
// Normalizes one install-mode turn transcript into an event list (scripts/gbrain-install/README.md):
//   claude-code  logs/turns/turn-NNNN.claude.jsonl   claude -p --output-format stream-json --verbose
//   codex        logs/turns/turn-NNNN.codex.jsonl    codex exec --json (codex-cli 0.165.0)
//   openclaw     logs/turns/turn-NNNN.openclaw.json  openclaw agent --local --json envelope (final text), with
//                turn-NNNN.openclaw-session.jsonl    the session events the adapter exports (tool calls and results); needs a live check
//   hermes       logs/turns/turn-NNNN.hermes.jsonl   hermes chat --format stream-json, with
//                turn-NNNN.hermes-session.jsonl      the state.db message rows the adapter exports (whole tool outputs); needs a live check
// Unknown lines are ignored, so a harness upgrade that adds event types does not break scoring; one that renames the ones read here
// shows up as turns with no tool events.
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

export type EventKind = 'mcp' | 'shell' | 'web' | 'text' | 'other';

/** One normalized event. name is the harness's tool name ("<server>__<tool>" for MCP, "assistant" for text); input is the shell
 *  command for shell events, the URL or query for web events and the JSON arguments otherwise; output is the tool result or the text. */
export interface NEvent { kind: EventKind; name: string; input: string; output: string; is_error: boolean; exit_code: number | null; session: string; turn: number }

const EXT: Record<string, string> = { 'claude-code': 'claude.jsonl', claude: 'claude.jsonl', codex: 'codex.jsonl', openclaw: 'openclaw.json', hermes: 'hermes.jsonl' };

const SHELL_TOOLS = new Set(['bash', 'terminal', 'exec', 'shell', 'local_shell', 'run_shell_command', 'execute_command', 'command_execution']);
const WEB_TOOLS = new Set(['webfetch', 'websearch', 'web_search', 'web_fetch', 'web_extract', 'fetch']);

function lines(raw: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const l of raw.split('\n')) {
    const t = l.trim();
    if (!t.startsWith('{')) continue;
    try { out.push(JSON.parse(t)); } catch { /* partial line */ }
  }
  return out;
}

function contentText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(x => (x && typeof x === 'object' && typeof (x as { text?: unknown }).text === 'string') ? (x as { text: string }).text : '').join('\n');
  if (c && typeof c === 'object') return JSON.stringify(c);
  return '';
}

const str = (v: unknown): string => typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v);

/** "mcp__gbrain__recall" (Claude Code, Hermes), "mcp_gbrain_recall" (Hermes) or "gbrain__recall" (OpenClaw) -> server and tool. */
export function mcpToolName(name: string): { server: string; tool: string } | null {
  const m = name.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/) ?? name.match(/^mcp_([A-Za-z0-9-]+)_(.+)$/) ?? name.match(/^([A-Za-z0-9-]+)__(.+)$/);
  return m ? { server: m[1], tool: m[2] } : null;
}

/** One event for a tool call, its kind read from the tool name; input is the call's arguments. */
function toolEvent(name: string, args: unknown, session: string, turn: number): NEvent {
  const base = { output: '', is_error: false, exit_code: null, session, turn };
  const mcp = mcpToolName(name);
  if (mcp) return { ...base, kind: 'mcp', name: `${mcp.server}__${mcp.tool}`, input: str(args) };
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  if (SHELL_TOOLS.has(name.toLowerCase())) return { ...base, kind: 'shell', name, input: typeof args === 'string' ? args : str(a.command ?? a.cmd ?? '') };
  if (WEB_TOOLS.has(name.toLowerCase())) return { ...base, kind: 'web', name, input: str(a.url ?? a.urls ?? a.query ?? args) };
  return { ...base, kind: 'other', name, input: str(args) };
}

const textEvent = (text: string, session: string, turn: number): NEvent => ({ kind: 'text', name: 'assistant', input: '', output: text, is_error: false, exit_code: null, session, turn });

export function parseClaude(raw: string, session: string, turn: number): NEvent[] {
  const out: NEvent[] = [];
  const pending = new Map<string, NEvent>();
  for (const ev of lines(raw)) {
    const content = ((ev.message as { content?: unknown[] } | undefined)?.content ?? []) as Array<Record<string, unknown>>;
    if (ev.type === 'assistant') {
      for (const b of content) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push(textEvent(b.text, session, turn));
        else if (b.type === 'tool_use') {
          const e = toolEvent(String(b.name), b.input, session, turn);
          out.push(e);
          pending.set(String(b.id), e);
        }
      }
    } else if (ev.type === 'user') {
      for (const b of content) {
        if (b.type !== 'tool_result') continue;
        const e = pending.get(String(b.tool_use_id));
        if (!e) continue;
        e.output = contentText(b.content);
        e.is_error = b.is_error === true;
        if (e.kind === 'shell') { const m = e.output.match(/exit code (\d+)/i); e.exit_code = e.is_error ? (m ? Number(m[1]) : 1) : 0; }
      }
    }
  }
  return out;
}

export function parseCodex(raw: string, session: string, turn: number): NEvent[] {
  const out: NEvent[] = [];
  for (const ev of lines(raw)) {
    if (ev.type !== 'item.completed') continue;
    const it = (ev.item ?? {}) as Record<string, unknown>;
    if (it.type === 'agent_message' && typeof it.text === 'string') out.push(textEvent(it.text, session, turn));
    else if (it.type === 'command_execution') {
      const exit = typeof it.exit_code === 'number' ? it.exit_code : null;
      out.push({ kind: 'shell', name: 'command_execution', input: String(it.command ?? ''), output: String(it.aggregated_output ?? ''), exit_code: exit, is_error: it.status === 'failed' || (exit !== null && exit !== 0), session, turn });
    } else if (it.type === 'mcp_tool_call') {
      const result = it.result as { content?: unknown; is_error?: boolean; isError?: boolean } | null | undefined;
      const err = it.error ? contentText((it.error as { message?: unknown }).message ?? it.error) : '';
      out.push({ kind: 'mcp', name: `${String(it.server ?? '')}__${String(it.tool ?? '')}`, input: str(it.arguments), output: result ? contentText(result.content) : err, is_error: it.status === 'failed' || !!it.error || result?.is_error === true || result?.isError === true, exit_code: null, session, turn });
    } else if (it.type === 'web_search') {
      out.push({ kind: 'web', name: 'web_search', input: str(it.query), output: '', is_error: false, exit_code: null, session, turn });
    } else if (typeof it.type === 'string' && it.type !== 'reasoning') {
      out.push({ kind: 'other', name: it.type, input: JSON.stringify(it), output: '', is_error: it.status === 'failed', exit_code: null, session, turn });
    }
  }
  return out;
}

/** The OpenClaw turn: the session events the adapter exported (turn-NNNN.openclaw-session.jsonl, one line per transcript_events row
 *  with the event JSON in "event") give the tool calls and results, and the --json envelope gives the final text. An event of type
 *  "message" carries the message: an assistant message has toolCall blocks {id, name, arguments} and text blocks, a toolResult message
 *  has toolCallId, toolName, content, isError and, for exec, details.exitCode (OpenClaw drops details past 8 KiB, so the exit code can
 *  be missing). Without the session file, tool events come from the envelope's meta.toolSummary: names only, no input or output.
 *  Needs a live check. */
export function parseOpenclaw(envelope: string | null, sessionLog: string | null, session: string, turn: number): NEvent[] {
  let env: Record<string, unknown> = {};
  try { env = envelope ? JSON.parse(envelope) : {}; } catch { /* a cut envelope still leaves the session events */ }
  const r = (env.result ?? env) as Record<string, unknown>;
  const meta = (r.meta ?? env.meta ?? {}) as Record<string, unknown>;
  const payloads = Array.isArray(r.payloads) ? (r.payloads as Array<{ text?: unknown }>).map(p => typeof p?.text === 'string' ? p.text : '').filter(Boolean).join('\n') : '';
  const finalText = typeof meta.finalAssistantVisibleText === 'string' ? meta.finalAssistantVisibleText : typeof r.final === 'string' ? r.final : payloads;
  const out: NEvent[] = [];
  if (sessionLog !== null) {
    const open: Array<{ id: string | null; e: NEvent }> = [];
    for (const line of lines(sessionLog)) {
      const ev = line.event as { type?: unknown; message?: Record<string, unknown> } | null;
      const m = ev?.type === 'message' ? ev.message : null;
      if (!m || typeof m !== 'object') continue;
      if (m.role === 'assistant') {
        for (const b of (Array.isArray(m.content) ? m.content : []) as Array<Record<string, unknown>>) {
          if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim() && b.text.trim() !== finalText.trim()) out.push(textEvent(b.text, session, turn));
          if (b?.type !== 'toolCall') continue;
          const e = toolEvent(String(b.name ?? ''), b.arguments, session, turn);
          out.push(e);
          open.push({ id: typeof b.id === 'string' ? b.id : null, e });
        }
      } else if (m.role === 'toolResult') {
        const name = String(m.toolName ?? '');
        const i = typeof m.toolCallId === 'string' ? open.findIndex(o => o.id === m.toolCallId) : open.findIndex(o => o.e.name === mcpName(name));
        const e = i >= 0 ? open.splice(i, 1)[0].e : toolEvent(name, '', session, turn);
        if (i < 0) out.push(e);
        const details = (m.details ?? {}) as { exitCode?: unknown };
        e.output = contentText(m.content);
        e.exit_code = typeof details.exitCode === 'number' ? details.exitCode : null;
        e.is_error = m.isError === true || (e.exit_code !== null && e.exit_code !== 0);
      }
    }
  } else {
    const summary = (meta.toolSummary ?? {}) as { tools?: unknown };
    out.push(...(Array.isArray(summary.tools) ? summary.tools : []).filter((t): t is string => typeof t === 'string').map(t => toolEvent(t, '', session, turn)));
  }
  if (finalText.trim()) out.push(textEvent(finalText, session, turn));
  return out;
}

const mcpName = (name: string) => { const m = mcpToolName(name); return m ? `${m.server}__${m.tool}` : name; };

/** The Hermes turn (hermes_cli/stream_json.py at the adapter's pin): {type: "text", text}, {type: "tool_use", name, tool_call_id, input},
 *  {type: "tool_result", name, tool_call_id, output, duration_ms, is_error} with output cut at 5,000 characters, and a closing
 *  {type: "result", text, exit_code, error}. A result is paired with its call by tool_call_id, else with the oldest open call of the
 *  same name; one with no call becomes an event of its own. A terminal result's output is the tool's JSON {output, exit_code, error}.
 *  sessionLog is the adapter's export of the turn's state.db message rows (turn-NNNN.hermes-session.jsonl): a role "tool" row holds
 *  the whole result as content (or, past Hermes's spillover threshold, a <persisted-output> block with the saved file in
 *  spillover.content), so a result with a matching tool_call_id there replaces the stream's cut output. Needs a live check. */
export function parseHermes(raw: string, session: string, turn: number, sessionLog: string | null = null): NEvent[] {
  const full = new Map<string, string>();
  for (const row of lines(sessionLog ?? '')) {
    if (row.role !== 'tool' || typeof row.tool_call_id !== 'string') continue;
    const spill = row.spillover as { content?: unknown } | undefined;
    full.set(row.tool_call_id, typeof spill?.content === 'string' ? spill.content : str(row.content));
  }
  const out: NEvent[] = [];
  const open: Array<{ id: string | null; e: NEvent }> = [];
  let sawText = false;
  for (const ev of lines(raw)) {
    const id = typeof ev.tool_call_id === 'string' ? ev.tool_call_id : null;
    const name = String(ev.name ?? '');
    if (ev.type === 'text' && typeof ev.text === 'string' && ev.text.trim()) { out.push(textEvent(ev.text, session, turn)); sawText = true; }
    else if (ev.type === 'result' && !sawText && typeof ev.text === 'string' && ev.text.trim()) out.push(textEvent(ev.text, session, turn));
    else if (ev.type === 'tool_use') {
      const e = toolEvent(name, ev.input, session, turn);
      out.push(e);
      open.push({ id, e });
    } else if (ev.type === 'tool_result') {
      const i = id !== null ? open.findIndex(o => o.id === id) : open.findIndex(o => o.e.name === mcpName(name));
      const e = i >= 0 ? open.splice(i, 1)[0].e : toolEvent(name, '', session, turn);
      if (i < 0) out.push(e);
      const rawOut = (id !== null ? full.get(id) : undefined) ?? str(ev.output);
      let inner: Record<string, unknown> | null = null;
      try { const p = JSON.parse(rawOut); if (p && typeof p === 'object' && !Array.isArray(p)) inner = p; } catch { /* plain text, or JSON cut at 5,000 characters */ }
      e.output = inner && typeof inner.output === 'string' ? [inner.output, inner.error ? str(inner.error) : ''].filter(Boolean).join('\n') : rawOut;
      const exit = inner && typeof inner.exit_code === 'number' ? inner.exit_code : null;
      if (e.kind === 'shell') e.exit_code = exit ?? (ev.is_error === true ? 1 : 0);
      e.is_error = ev.is_error === true || (exit !== null && exit !== 0) || !!(inner && inner.error);
    }
  }
  return out;
}

/** One row of QM's Postgres items table (main@77024e79), as the first-wow runner dumps it after each turn with row_to_json. */
export interface QmItem { session_id: string; seq: number; kind: string; turn_id: string | null; author: string | null; tool: string | null; call_id: string | null; text: string | null; is_error: boolean | null; variant: string | null; body: Record<string, unknown> | null }

/** A memory provider's section of a stored UserMessage's environment: "### <scope label> · <route label>" and an untrusted-data block. */
const QM_PROVIDER_SECTION = /^### [^\n]*· ([A-Za-z0-9_-]+)\n```untrusted-data\n([\s\S]*?)\n```/gm;

/** The QM turn (logs/turns/turn-NNNN.qm-items.json, every items row after turn NNNN). Turn n is the n-th group of rows sharing a
 *  turn_id that holds a UserMessage with an author (a person's message; side sessions such as titles have none). Events, in seq order:
 *  - each memory provider section of that UserMessage's environment: QM's per-turn recall, the text QM handed the model. A section
 *    labelled gbrain becomes an mcp event gbrain__provider_recall, so the scorer counts it as a gbrain read;
 *  - each ToolCall with its ToolResult (paired by call_id): execute is a shell event (body.command), web_search and web_fetch web
 *    events, memory an mcp event gbrain__memory_<action> when gbrain is one of the turn's recall providers (QM's memory tool reads
 *    every provider on the scope, so its output is gbrain's rows merged with QM's own notebook: an upper bound on what gbrain served),
 *    every other tool an other event with the call's body (wire metadata dropped) as input;
 *  - each AgentMessage as text. Reasoning rows are skipped. */
export function parseQm(raw: string, session: string, turn: number): NEvent[] {
  let rows: QmItem[] = [];
  try { const v = JSON.parse(raw); if (Array.isArray(v)) rows = v as QmItem[]; } catch { return []; }
  const groups: QmItem[][] = [];
  const byTurn = new Map<string, QmItem[]>();
  for (const r of [...rows].sort((a, b) => a.session_id === b.session_id ? a.seq - b.seq : a.session_id < b.session_id ? -1 : 1)) {
    if (!r.turn_id) continue;
    let g = byTurn.get(r.turn_id);
    if (!g) { g = []; byTurn.set(r.turn_id, g); groups.push(g); }
    g.push(r);
  }
  const mine = groups.filter((g) => g.some((r) => r.kind === 'UserMessage' && r.author))[turn - 1];
  if (!mine) return [];
  const user = mine.find((r) => r.kind === 'UserMessage' && r.author)!;
  const outcomes = (user.body?.memoryRecallOutcomes ?? []) as Array<{ provider?: string }>;
  const gbrainProvider = Array.isArray(outcomes) && outcomes.some((o) => o?.provider === 'gbrain');
  const out: NEvent[] = [];
  const env = typeof user.body?.environment === 'string' ? user.body.environment : '';
  for (const m of env.matchAll(QM_PROVIDER_SECTION)) {
    if (m[1] === 'gbrain') out.push({ kind: 'mcp', name: 'gbrain__provider_recall', input: '', output: m[2]!, is_error: false, exit_code: null, session, turn });
  }
  const results = new Map(mine.filter((r) => r.kind === 'ToolResult' && r.call_id).map((r) => [r.call_id!, r]));
  for (const r of mine) {
    if (r.kind === 'AgentMessage' && r.text?.trim()) { out.push(textEvent(r.text, session, turn)); continue; }
    if (r.kind !== 'ToolCall') continue;
    const { wire: _wire, ...args } = (r.body ?? {}) as Record<string, unknown>;
    const res = r.call_id ? results.get(r.call_id) : undefined;
    const output = res?.text ?? '';
    const isError = res?.is_error === true;
    const tool = String(r.tool ?? '');
    const base = { output, is_error: isError, session, turn };
    if (tool === 'execute') {
      const exit = /\[exit (\d+)\]\s*$/.exec(output);
      out.push({ ...base, kind: 'shell', name: 'execute', input: str(args.command ?? ''), exit_code: exit ? Number(exit[1]) : isError ? 1 : null });
    } else if (tool === 'web_search' || tool === 'web_fetch') {
      out.push({ ...base, kind: 'web', name: tool, input: str(args.url ?? args.query ?? args), exit_code: null });
    } else if (tool === 'memory' && gbrainProvider) {
      out.push({ ...base, kind: 'mcp', name: `gbrain__memory_${String(args.action ?? 'call')}`, input: str(args), exit_code: null });
    } else {
      out.push({ ...base, kind: 'other', name: tool, input: str(args), exit_code: null });
    }
  }
  return out;
}

/** The events of one QM turn: <logsDir>/turns/turn-NNNN.qm-items.json (or its .gz), [] when the turn has no file. QM is not a
 *  parseTurn harness: its record is a database dump the first-wow runner writes, not a transcript the adapter streams. */
export function parseQmTurn(logsDir: string, turn: number, session: string): NEvent[] {
  const raw = readTurnFile(join(logsDir, 'turns', `turn-${String(turn).padStart(4, '0')}.qm-items.json`));
  return raw === null ? [] : parseQm(raw, session, turn);
}

const readTurnFile = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : existsSync(path + '.gz') ? gunzipSync(readFileSync(path + '.gz')).toString('utf8') : null;

/** The events of one turn: reads <logsDir>/turns/turn-NNNN.<ext> (or its .gz), for OpenClaw also turn-NNNN.openclaw-session.jsonl and
 *  for Hermes also turn-NNNN.hermes-session.jsonl; [] when the turn has no file. */
export function parseTurn(harness: string, logsDir: string, turn: number, session: string): NEvent[] {
  const ext = EXT[harness];
  if (!ext) throw new Error(`parseTurn: unknown harness ${harness}`);
  const stem = join(logsDir, 'turns', `turn-${String(turn).padStart(4, '0')}`);
  const raw = readTurnFile(`${stem}.${ext}`);
  if (ext === 'openclaw.json') {
    const sessionLog = readTurnFile(stem + '.openclaw-session.jsonl');
    return raw === null && sessionLog === null ? [] : parseOpenclaw(raw, sessionLog, session, turn);
  }
  if (raw === null) return [];
  if (ext === 'claude.jsonl') return parseClaude(raw, session, turn);
  if (ext === 'codex.jsonl') return parseCodex(raw, session, turn);
  return parseHermes(raw, session, turn, readTurnFile(stem + '.hermes-session.jsonl'));
}

/** A shell command wrapped as "/bin/bash -lc '...'" (Codex) -> the inner command. */
export function unwrapShell(cmd: string): string {
  const m = cmd.trim().match(/^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/);
  return m ? m[2] : cmd;
}

/** The argv of every gbrain CLI run in a shell command: gbrain (any path, or through bunx, npx, env, sudo, timeout) in command
 *  position, at the start or after ; & | ( $( a backquote or a newline. Redirections and their targets are dropped. */
export function gbrainArgvFromShell(cmd: string): string[][] {
  const out: string[][] = [];
  const re = /(?:^|[;&|(\n\x60]|\$\()\s*(?:(?:sudo|exec|command|time|nohup|bunx|npx|env|timeout\s+\S+|[A-Za-z_][A-Za-z0-9_]*=\S*)\s+)*["']?(?:[^\s;&|()"']*\/)?gbrain["']?(?=$|[\s;&|)])([^;&|\n)]*)/g;
  for (const m of unwrapShell(cmd).matchAll(re)) {
    const argv: string[] = [];
    let skip = false;
    for (const t of m[1].match(/"[^"]*"|'[^']*'|\S+/g) ?? []) {
      if (skip) { skip = false; continue; }
      if (/^(\d|&)?[<>]{1,2}&?$/.test(t)) { skip = true; continue; }
      if (/^(\d|&)?[<>]/.test(t)) continue;
      argv.push(t.replace(/^["']|["']$/g, ''));
    }
    out.push(argv);
  }
  return out;
}

/** An MCP tool of a server named gbrain, or a shell command that runs the gbrain CLI. */
export function isGbrainCall(e: NEvent): boolean {
  if (e.kind === 'mcp') return /^gbrain(?:[-_][A-Za-z0-9-]*)?__/i.test(e.name);
  if (e.kind === 'shell') return gbrainArgvFromShell(e.input).length > 0;
  return false;
}

/** A call whose output gbrain alone produced, the only kind that counts a recall as served by gbrain: a gbrain MCP tool, or a shell
 *  command that is one gbrain CLI invocation, optionally after "cd <dir> &&" and optionally piped into head or tail with no file
 *  operand. The gbrain word must be the command word (after VAR=value and the wrappers gbrainArgvFromShell takes), so a command
 *  handed to another shell (sh -c "...", eval "...") never counts. Outside quotes it may hold redirections (2>&1, > file) but no
 *  other ;, &, &&, ||, |, newline or parenthesis, and nowhere outside single quotes a command substitution ($( or a backquote).
 *  "gbrain --version; cat notes.txt" runs gbrain, but its output is the file's, so it does not count. */
export function isGbrainServed(e: NEvent): boolean {
  if (e.kind !== 'shell') return isGbrainCall(e);
  const cmd = unwrapShell(e.input).trim();
  const parts: string[] = [];
  const ops: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    if (quote === "'") { if (c === "'") quote = null; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '`' || (c === '$' && cmd[i + 1] === '(')) return false;
    if (quote === '"') { if (c === '"') quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (';\n()'.includes(c)) return false;
    const op = cmd.startsWith('&&', i) ? '&&' : cmd.startsWith('||', i) ? '||' : c === '|' ? '|' : c === '&' && cmd[i - 1] !== '>' && cmd[i - 1] !== '<' && cmd[i + 1] !== '>' ? '&' : null;
    if (!op) continue;
    if (op !== '&&' && op !== '|') return false;
    parts.push(cmd.slice(start, i).trim());
    ops.push(op);
    start = i + op.length;
    i += op.length - 1;
  }
  parts.push(cmd.slice(start).trim());
  const shape = ops.join(' ');
  if (!['', '&&', '|', '&& |'].includes(shape)) return false;
  if (ops[0] === '&&' && !/^cd(?:\s+(?:"[^"]*"|'[^']*'|[^\s"']+))?$/.test(parts.shift()!)) return false;
  if (ops.at(-1) === '|' && !/^(?:head|tail)(?:\s+(?:-[A-Za-z]*\d*|\+?\d+))*$/.test(parts.pop()!)) return false;
  const words = parts[0]!.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  let w = 0;
  while (w < words.length && /^(?:sudo|exec|command|time|nohup|bunx|npx|env|timeout|[A-Za-z_][A-Za-z0-9_]*=\S*)$/.test(words[w]!)) w += words[w] === 'timeout' ? 2 : 1;
  return /^["']?(?:[^\s;&|()"']*\/)?gbrain["']?$/.test(words[w] ?? '');
}

/** Straight quotes and apostrophes, so the text rules match curly-quoted model output. */
export function norm(s: string): string {
  return s.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"');
}

const tokens = (s: string) => norm(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** The word appears in the text as whole tokens: case-insensitive, punctuation and quotes ignored, never inside a longer word. */
export function hasToken(text: string, word: string): boolean {
  const want = tokens(word);
  if (!want.length) return false;
  const have = tokens(text);
  for (let i = 0; i + want.length <= have.length; i++) if (want.every((w, j) => have[i + j] === w)) return true;
  return false;
}

const GITHUB_RE = /\b(github\.com|githubusercontent\.com|github)\b/i;
const LIMIT_RE = /(rate[- ]limit(?:ed)?\s+(?:exceeded|reached)|\brate[- ]limited\b|exceeded (?:a |the |your )?(?:secondary |API )?rate[- ]limit|\bHTTP\/[\d.]+\s+(403|429)\b|\bHTTP (error )?(403|429)\b|\b(403|429)\s*(Forbidden|Too Many Requests)\b|returned error:\s*(403|429)\b|\bstatus(?: code)?[:= ]+(403|429)\b|\s-\s(403|429)\b|\berror:?\s+(403|429)\b)/i;

/** A tool output that shows GitHub answering 403 or 429 or a rate limit (the call or its output names GitHub). */
export function githubRateLimited(events: NEvent[]): boolean {
  return events.some(e => e.kind !== 'text' && LIMIT_RE.test(e.output) && (GITHUB_RE.test(e.output) || GITHUB_RE.test(e.input)));
}
