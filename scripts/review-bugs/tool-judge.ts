#!/usr/bin/env bun
/**
 * Tool-using judge and labeller for the review-real-bugs eval, stage 2 (docs/benchmarks/2026-11-review-real-bugs/stage2/
 * PREREGISTRATION.md, "Adjudication"). One read is one model on one unmatched blocking finding: a fresh session that gets
 * the role's brief, the pull request's title and first description, its diff against the base, the finding and the unit's
 * known informational cases, and read-only tools over the unit repository at the pull request's head. It ends with one
 * submit_ruling call.
 *
 *   judge     list_dir, read_file, grep and pr_diff, all at the head tree: no later history, no fix, no execution, no
 *             network. Rulings: defect, not-defect, cant-tell, and known-informational only where the unit lists a case.
 *   labeller  the same, plus the known bugs (our words) and their fix diffs in the prompt, read_file and list_dir at a
 *             later commit of the main branch (at: "later"), log over later commits touching a path, and show_commit for
 *             one of those commits or a fix commit.
 *
 * Every tool reads git objects from the unit's clone by sha (git show, git ls-tree, git grep on a tree), so nothing past
 * the head reaches a judge. Paths with ".." or a leading "/" and option-like arguments are refused. Each result is cut at
 * TOOL_RESULT_CHARS. The tool budget is fixed per role (TOOL_BUDGET); once it is spent, only submit_ruling stays offered,
 * and a session that has not submitted within 3 more turns is unanswered. An invalid submit_ruling gets the reason back
 * as its tool result, and a session with no accepted submit_ruling after the tool budget plus MAX_EXTRA_TURNS turns is
 * unanswered too. An unanswered or failed session is asked once more in a fresh session, and the read reports both
 * attempts' tokens, turns and tool calls; a refusal (a cyber_policy
 * error, an Anthropic "refusal" stop or an empty HTTP 200 answer with no output tokens) is a result and is never retried
 * or sent to another model (R95).
 *
 * Request settings: OpenAI Responses with store false, encrypted reasoning carried between turns, reasoning effort medium,
 * a prompt_cache_key per read and strict function tools; Anthropic Messages with no temperature or thinking field,
 * tool_choice auto and cache breakpoints on the prompt and the newest tool results. At most 16,000 output tokens a turn.
 *
 *   bun scripts/review-bugs/tool-judge.ts run --items <items.jsonl> --roles judge,labeller --judge openai:gpt-6-astra
 *       --judge anthropic:claude-opus-5-5 --brief judge=<file> --brief labeller=<file> --out <dir> --run-id <id>
 *       --lease-usd <n> --ledger <file> [--concurrency 4] [--dry-run]
 *   bun scripts/review-bugs/tool-judge.ts prompt --items <items.jsonl> --item <id> --role judge|labeller --brief <role>=<file>
 *
 * run sends every read through runner/proxy/metering-proxy.ts in lease mode, one bound slot and meter key per read
 * (tool-judge:<run id>:<role>:<judge slug>:<item>), and writes <out>/rulings.jsonl (one row per read), <out>/sessions/
 * (each read's tool calls, final entry and usage), <out>/usage.ndjson (the proxy's log) and <out>/run.json. --dry-run
 * builds every first request, prints the worst case of one turn and sends nothing.
 * run exits 3 when it stopped early or any read failed (a read that throws is written as failed), so read those again
 * with a new --out and pass every rulings.jsonl to rejudge.ts.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { priceRequest, reservationUsd } from '../../runner/ledger/budget-ledger.ts';

export const ROLES = ['judge', 'labeller'] as const;
export type Role = (typeof ROLES)[number];
export const RULINGS = ['defect', 'not-defect', 'cant-tell', 'known-informational'] as const;
export type ToolRuling = (typeof RULINGS)[number];
export const TESTS = ['defect', 'known', 'contradicted', 'unreachable', 'not-blocking', 'vague', 'cant-tell'] as const;
export const BREAKS = ['test', 'production', 'data-or-secrets'] as const;
export const TOOL_BUDGET: Readonly<Record<Role, number>> = { judge: 12, labeller: 16 };
export const EXTRA_TURNS = 3;
export const MAX_EXTRA_TURNS = EXTRA_TURNS + 6;
export const TOOL_RESULT_CHARS = 12_000;
export const DIFF_CHARS = 60_000;
export const FIX_CHARS = 40_000;
export const READ_LINES = 250;
export const GREP_LINES = 200;
export const LOG_COMMITS = 40;
export const MAX_OUTPUT_TOKENS = 16_000;
export const REASONING_EFFORT = 'medium';
export const ROUTE = { anthropic: '/v1/messages', openai: '/v1/responses' } as const;
const HOSTS = { anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com' } as const;
type Provider = keyof typeof ROUTE;

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

export interface Judge { id: string; provider: Provider; model: string; slug: string }
export function parseJudge(id: string): Judge {
  const [provider, model] = id.split(':') as [string, string | undefined];
  if (!model || !(provider in ROUTE)) throw new Error('--judge takes anthropic:<model> or openai:<model>, not ' + JSON.stringify(id));
  return { id, provider: provider as Provider, model, slug: provider + '-' + model.replace(/[^A-Za-z0-9]+/g, '-') };
}

/** One finding to rule. later is present only in a labeller's items. */
export interface JudgeItem {
  item: string;
  unit: string;
  git_dir: string;
  head: string;
  merge_base: string;
  pr_text: string;
  finding: { path: string | null; line: number | null; text: string };
  known_informational: unknown[];
  later?: { tip: string | null; fixes: string[]; bugs: string[] };
}

export function readItems(file: string): JudgeItem[] {
  const items = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as JudgeItem);
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.item)) throw new Error('item ' + it.item + ' appears twice in ' + file);
    seen.add(it.item);
    for (const k of ['unit', 'git_dir', 'head', 'merge_base', 'pr_text'] as const) if (typeof it[k] !== 'string' || !it[k]) throw new Error('item ' + it.item + ' has no ' + k);
  }
  return items;
}

// ---- the repository, read-only ------------------------------------------------------------------------------------

let home: string | null = null;
/** A scratch HOME for git, so no user or machine config (or a git wrapper's log) reaches a read. */
const scratchHome = () => (home ??= mkdtempSync(join(tmpdir(), 'tool-judge-home-')));

const cut = (s: string, n = TOOL_RESULT_CHARS) => (s.length > n ? s.slice(0, n) + '\n[cut at ' + n + ' of ' + s.length + ' characters]' : s);

export class RepoView {
  constructor(readonly item: JudgeItem, readonly role: Role) {}

  private git(args: string[], maxBuffer = 64 * 1024 * 1024): { ok: boolean; status: number | null; out: string; err: string } {
    const r = spawnSync('git', ['--git-dir', this.item.git_dir, ...args], { encoding: 'utf8', maxBuffer, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: scratchHome(), GIT_CONFIG_NOSYSTEM: '1' } });
    return { ok: r.status === 0, status: r.status, out: r.stdout ?? '', err: (r.stderr ?? '').trim() };
  }

  /** The commit a read is at: the head, or for a labeller asking for "later", the later tip. */
  private at(at: unknown): string | { error: string } {
    if (at === undefined || at === null || at === 'head') return this.item.head;
    if (at === 'later' && this.role === 'labeller') return this.item.later?.tip ?? { error: 'this unit has no later commit' };
    return { error: 'at must be "head"' + (this.role === 'labeller' ? ' or "later"' : '') };
  }

  static cleanPath(p: unknown, allowEmpty = false): string | { error: string } {
    const s = typeof p === 'string' ? p.trim().replace(/^\.\/+/, '').replace(/\/+$/, '') : '';
    if (!s && allowEmpty) return '';
    if (!s) return { error: 'a path is required' };
    if (s.startsWith('/') || s.startsWith('-') || s.split('/').includes('..') || /[\x00-\x1f:]/.test(s)) return { error: 'paths are relative to the repository root, with no "..", leading "/" or ":"' };
    return s;
  }

  listDir(path: unknown, at?: unknown): string {
    const p = RepoView.cleanPath(path, true), c = this.at(at);
    if (typeof p !== 'string') return p.error;
    if (typeof c !== 'string') return c.error;
    const r = this.git(['ls-tree', c + ':' + p]);
    if (!r.ok) return 'no directory ' + JSON.stringify(p || '.');
    return cut(r.out.split('\n').filter(Boolean).map((l) => { const [meta, name] = l.split('\t'); return name + (meta!.split(' ')[1] === 'tree' ? '/' : ''); }).join('\n'));
  }

  readFile(path: unknown, start: unknown, end: unknown, at?: unknown): string {
    const p = RepoView.cleanPath(path), c = this.at(at);
    if (typeof p !== 'string') return p.error;
    if (typeof c !== 'string') return c.error;
    const r = this.git(['show', c + ':' + p]);
    if (!r.ok) return 'no file ' + JSON.stringify(p) + ' at ' + (at === 'later' ? 'the later commit' : 'the head');
    if (r.out.includes('\u0000')) return p + ' is a binary file';
    const lines = r.out.split('\n');
    if (lines.at(-1) === '') lines.pop();
    const from = Math.max(1, Number.isInteger(start) ? (start as number) : 1);
    const to = Math.min(lines.length, Number.isInteger(end) ? (end as number) : from + READ_LINES - 1, from + READ_LINES - 1);
    if (from > lines.length) return p + ' has ' + lines.length + ' lines';
    return cut(lines.slice(from - 1, to).map((l, i) => String(from + i).padStart(6) + '  ' + l).join('\n') + '\n[' + p + ' lines ' + from + '-' + to + ' of ' + lines.length + ']');
  }

  grep(pattern: unknown, path: unknown): string {
    if (typeof pattern !== 'string' || !pattern) return 'a pattern is required';
    const p = RepoView.cleanPath(path, true);
    if (typeof p !== 'string') return p.error;
    const r = this.git(['grep', '-n', '-I', '-E', '--max-count', '50', '-e', pattern, this.item.head, '--', p || '.']);
    if (r.status === 1 && !r.out) return 'no match';
    if (!r.ok) return 'grep failed: the pattern is not a valid extended regular expression, or the path is not in the repository';
    const lines = r.out.split('\n').filter(Boolean).map((l) => l.startsWith(this.item.head + ':') ? l.slice(this.item.head.length + 1) : l);
    return cut(lines.slice(0, GREP_LINES).join('\n') + (lines.length > GREP_LINES ? '\n[' + lines.length + ' matching lines, first ' + GREP_LINES + ' shown]' : ''));
  }

  prDiff(path: unknown): string {
    const p = RepoView.cleanPath(path);
    if (typeof p !== 'string') return p.error;
    const r = this.git(['diff', this.item.merge_base, this.item.head, '--', p]);
    return r.ok ? (r.out ? cut(r.out) : 'the pull request does not change ' + p) : 'diff failed';
  }

  /** Commits on the later tip since the merge base, plus the fix commits; a labeller can show only these. */
  private laterCommits(): Set<string> {
    const l = this.item.later;
    const out = new Set<string>(l?.fixes ?? []);
    if (l?.tip) for (const c of this.git(['rev-list', this.item.merge_base + '..' + l.tip]).out.split('\n').filter(Boolean)) out.add(c);
    return out;
  }

  log(path: unknown): string {
    if (this.role !== 'labeller') return 'no such tool';
    const p = RepoView.cleanPath(path);
    if (typeof p !== 'string') return p.error;
    const tip = this.item.later?.tip;
    const rows = tip ? this.git(['log', '--format=%H %ad %s', '--date=short', '-n', String(LOG_COMMITS), this.item.merge_base + '..' + tip, '--', p]).out.split('\n').filter(Boolean) : [];
    const fixes = (this.item.later?.fixes ?? []).filter((f) => !rows.some((r) => r.startsWith(f))).map((f) => this.git(['log', '-1', '--format=%H %ad %s (fix commit)', '--date=short', f, '--', p]).out.trim()).filter(Boolean);
    return rows.length || fixes.length ? cut([...fixes, ...rows].join('\n')) : 'no later commit touches ' + p;
  }

  showCommit(commit: unknown, path: unknown): string {
    if (this.role !== 'labeller') return 'no such tool';
    if (typeof commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(commit)) return 'commit must be a hex sha';
    const full = this.git(['rev-parse', '--verify', '--quiet', commit + '^{commit}']).out.trim();
    if (!full || !this.laterCommits().has(full)) return 'show_commit takes a fix commit or a later commit that log listed';
    const p = RepoView.cleanPath(path, true);
    if (typeof p !== 'string') return p.error;
    return cut(this.git(['show', '--format=%H %ad %s', '--date=short', full, ...(p ? ['--', p] : [])]).out);
  }
}

// ---- prompts and tools ----------------------------------------------------------------------------------------------

export function prDiffText(view: RepoView): string {
  const it = view.item;
  const r = spawnSync('git', ['--git-dir', it.git_dir, 'diff', it.merge_base, it.head], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const diff = r.stdout ?? '';
  if (diff.length <= DIFF_CHARS) return diff;
  const stat = spawnSync('git', ['--git-dir', it.git_dir, 'diff', '--stat=200', it.merge_base, it.head], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout ?? '';
  return '[The diff is ' + diff.length + ' characters, cut at ' + DIFF_CHARS + '. pr_diff gives any file\'s part in full. Files changed:]\n' + stat + '\n' + diff.slice(0, DIFF_CHARS) + '\n[cut]';
}

export function fixText(view: RepoView): string {
  const l = view.item.later;
  if (!l?.fixes.length) return 'This pull request has no known bug and no fix (a decoy).';
  const parts = l.fixes.map((f) => spawnSync('git', ['--git-dir', view.item.git_dir, 'diff', view.item.head, f], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout ?? '');
  const body = parts.map((d, i) => '### Fix commit ' + l.fixes[i] + ', diff against the head\n\n' + d).join('\n');
  return cut(body, FIX_CHARS);
}

export function promptFor(view: RepoView, brief: string): string {
  const it = view.item;
  const parts = [brief.trimEnd(), '', '# The pull request', '', it.pr_text.trimEnd(), '', '# The finding', '',
    'Path: ' + (it.finding.path ?? '(none named)') + (it.finding.line !== null ? ', line ' + it.finding.line : ''), '', it.finding.text.trimEnd(), '',
    '# Known informational cases', '', it.known_informational.length ? JSON.stringify(it.known_informational, null, 2) : 'None. Never rule known-informational on this unit.', ''];
  if (view.role === 'labeller') {
    parts.push('# The known bugs (our words)', '', ...(it.later?.bugs.length ? it.later.bugs.map((b, i) => (i + 1) + '. ' + b) : ['None: this is a decoy pull request.']), '');
    parts.push('# The fixes', '', fixText(view), '');
  }
  parts.push('# The pull request diff (merge base ' + it.merge_base.slice(0, 12) + ' to head ' + it.head.slice(0, 12) + ')', '', '\x60\x60\x60diff', prDiffText(view), '\x60\x60\x60', '',
    'Read what you need with the tools (at most ' + TOOL_BUDGET[view.role] + ' calls; call several in one turn when you can), then call submit_ruling exactly once.');
  return parts.join('\n');
}

interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
const obj = (props: Record<string, unknown>) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
const str = (d: string) => ({ type: 'string', description: d });
const nullable = (t: string, d: string) => ({ type: [t, 'null'], description: d });
const atParam = { type: 'string', enum: ['head', 'later'], description: 'head, or later for the later commit of the main branch' };

export const SUBMIT: ToolSpec = { name: 'submit_ruling', description: 'Submit your one ruling on the finding. Call it exactly once, last.', parameters: obj({
  ruling: { type: 'string', enum: [...RULINGS] }, test: { type: 'string', enum: [...TESTS] },
  lines: { type: 'array', items: { type: 'string' }, description: 'path:line or path:from-to' },
  trigger: nullable('string', 'for a defect, the concrete input or state; otherwise null'),
  breaks: { anyOf: [{ type: 'string', enum: [...BREAKS] }, { type: 'null' }], description: 'for a defect: test, production or data-or-secrets; otherwise null' },
  reason: str('one or two plain sentences') }) };

export function toolSpecs(role: Role): ToolSpec[] {
  const base: ToolSpec[] = [
    { name: 'list_dir', description: 'List a directory of the repository ("" for the root). Directories end in /.', parameters: obj(role === 'labeller' ? { path: str('directory path'), at: atParam } : { path: str('directory path') }) },
    { name: 'read_file', description: 'Read up to ' + READ_LINES + ' numbered lines of a file. Null start_line and end_line read from the top.', parameters: obj({ path: str('file path'), start_line: nullable('integer', 'first line, from 1'), end_line: nullable('integer', 'last line'), ...(role === 'labeller' ? { at: atParam } : {}) }) },
    { name: 'grep', description: 'Search the repository at the head with an extended regular expression (git grep -E). Path limits it to a file or directory ("" for all).', parameters: obj({ pattern: str('extended regular expression'), path: str('file or directory, or ""') }) },
    { name: 'pr_diff', description: "This pull request's diff for one file.", parameters: obj({ path: str('file path') }) },
  ];
  if (role === 'labeller') base.push(
    { name: 'log', description: 'Later commits of the main branch (and the fix commits) that touch a path, newest first.', parameters: obj({ path: str('file or directory path') }) },
    { name: 'show_commit', description: 'Show a fix commit or a later commit log listed, optionally limited to one path.', parameters: obj({ commit: str('commit sha'), path: str('path, or "" for the whole commit') }) });
  return [...base, SUBMIT];
}

export function runTool(view: RepoView, name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'list_dir': return view.listDir(args.path, args.at);
    case 'read_file': return view.readFile(args.path, args.start_line, args.end_line, args.at);
    case 'grep': return view.grep(args.pattern, args.path);
    case 'pr_diff': return view.prDiff(args.path);
    case 'log': return view.log(args.path);
    case 'show_commit': return view.showCommit(args.commit, args.path);
    default: return 'no such tool';
  }
}

export interface Ruled { ruling: ToolRuling; test: string; lines: string[]; trigger: string | null; breaks: string | null; reason: string }
export function validateRuling(args: Record<string, unknown>, item: JudgeItem): Ruled | string {
  const r = args.ruling as ToolRuling;
  if (!RULINGS.includes(r)) return 'ruling must be one of ' + RULINGS.join(', ');
  if (r === 'known-informational' && !item.known_informational.length) return 'this unit lists no known informational case, so known-informational is not available';
  if (!TESTS.includes(args.test as never)) return 'test must be one of ' + TESTS.join(', ');
  if (typeof args.reason !== 'string' || !args.reason.trim()) return 'reason is required';
  const lines = Array.isArray(args.lines) ? args.lines.filter((l): l is string => typeof l === 'string') : [];
  if (r === 'defect' && (typeof args.trigger !== 'string' || !args.trigger.trim() || !BREAKS.includes(args.breaks as never))) return 'a defect needs a trigger and breaks';
  return { ruling: r, test: String(args.test), lines, trigger: typeof args.trigger === 'string' ? args.trigger : null, breaks: typeof args.breaks === 'string' ? args.breaks : null, reason: String(args.reason) };
}

// ---- sessions -------------------------------------------------------------------------------------------------------

export type Transport = (j: Judge, body: Record<string, unknown>) => Promise<{ status: number; text: string }>;
export interface Usage { input: number; cached: number; cache_write: number; output: number }
export interface SessionResult {
  item: string; role: Role; judge: string; outcome: 'ruled' | 'unanswered' | 'refused' | 'filtered' | 'failed';
  ruled: Ruled | null; tool_calls: number; turns: number; usage: Usage; calls: Array<{ name: string; args: unknown }>; note: string;
}
interface Call { id: string; name: string; args: Record<string, unknown> }
interface Turn { calls: Call[]; filtered: boolean; refused: boolean; incomplete: boolean; usage: Usage; assistant: unknown }

function parseArgs(s: unknown): Record<string, unknown> {
  if (s && typeof s === 'object') return s as Record<string, unknown>;
  try { const v = JSON.parse(String(s)); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

export function parseTurn(provider: Provider, body: any): Turn {
  if (provider === 'anthropic') {
    const content: any[] = Array.isArray(body?.content) ? body.content : [];
    const u = body?.usage ?? {};
    const usage = { input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), cached: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0, output: u.output_tokens ?? 0 };
    return { calls: content.filter((b) => b?.type === 'tool_use').map((b) => ({ id: String(b.id), name: String(b.name), args: parseArgs(b.input) })),
      filtered: body?.stop_reason === 'refusal' || (!content.length && !usage.output), refused: false, incomplete: body?.stop_reason === 'max_tokens', usage, assistant: content };
  }
  const output: any[] = Array.isArray(body?.output) ? body.output : [];
  const u = body?.usage ?? {};
  const refusal = output.some((o) => o?.type === 'message' && Array.isArray(o.content) && o.content.some((c: any) => c?.type === 'refusal'));
  return { calls: output.filter((o) => o?.type === 'function_call').map((o) => ({ id: String(o.call_id), name: String(o.name), args: parseArgs(o.arguments) })),
    filtered: (!output.length && !(u.output_tokens ?? 0)) || body?.incomplete_details?.reason === 'content_filter', refused: refusal, incomplete: body?.status === 'incomplete',
    usage: { input: u.input_tokens ?? 0, cached: u.input_tokens_details?.cached_tokens ?? 0, cache_write: 0, output: u.output_tokens ?? 0 }, assistant: output };
}

export function requestBody(j: Judge, prompt: string, history: unknown[], tools: ToolSpec[], cacheKey: string): Record<string, unknown> {
  if (j.provider === 'anthropic') {
    const msgs = [{ role: 'user', content: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }] }, ...(history as any[]).map((m) => structuredClone(m))];
    const last = msgs.at(-1) as any;
    if (msgs.length > 1 && last.role === 'user' && Array.isArray(last.content) && last.content.length) last.content.at(-1).cache_control = { type: 'ephemeral' };
    return { model: j.model, max_tokens: MAX_OUTPUT_TOKENS, messages: msgs, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters, ...(t.name === SUBMIT.name ? { strict: true } : {}) })), tool_choice: { type: 'auto' } };
  }
  return { model: j.model, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }, ...history], tools: tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: true })),
    tool_choice: 'auto', store: false, include: ['reasoning.encrypted_content'], reasoning: { effort: REASONING_EFFORT }, max_output_tokens: MAX_OUTPUT_TOKENS, prompt_cache_key: cacheKey };
}

/** One read: a fresh session that ends in a ruling, a refusal, a filter stop, or neither. */
export async function runSession(view: RepoView, j: Judge, prompt: string, send: Transport): Promise<SessionResult> {
  const role = view.role, budget = TOOL_BUDGET[role];
  const res: SessionResult = { item: view.item.item, role, judge: j.id, outcome: 'unanswered', ruled: null, tool_calls: 0, turns: 0, usage: { input: 0, cached: 0, cache_write: 0, output: 0 }, calls: [], note: '' };
  const history: unknown[] = [];
  const cacheKey = 'tj-' + sha256(prompt).slice(0, 24);
  let nudges = 0, afterBudget = 0;
  for (;;) {
    if (res.turns >= budget + MAX_EXTRA_TURNS) { res.note = 'no accepted submit_ruling within ' + (budget + MAX_EXTRA_TURNS) + ' turns'; return res; }
    if (res.tool_calls >= budget && afterBudget++ >= EXTRA_TURNS) { res.note = 'no submit_ruling within ' + EXTRA_TURNS + ' turns after the tool budget'; return res; }
    const tools = res.tool_calls >= budget ? [SUBMIT] : toolSpecs(role);
    const r = await send(j, requestBody(j, prompt, history, tools, cacheKey));
    res.turns++;
    if (r.status !== 200) {
      if (/cyber_policy/.test(r.text)) { res.outcome = 'refused'; res.note = 'cyber_policy: ' + r.text.slice(0, 200); return res; }
      res.outcome = 'failed'; res.note = 'HTTP ' + r.status + ': ' + r.text.slice(0, 300); return res;
    }
    let t: Turn;
    try { t = parseTurn(j.provider, JSON.parse(r.text)); } catch { res.outcome = 'failed'; res.note = 'the provider response is not JSON'; return res; }
    for (const k of Object.keys(res.usage) as Array<keyof Usage>) res.usage[k] += t.usage[k];
    if (t.refused) { res.outcome = 'refused'; res.note = 'refusal content'; return res; }
    if (t.filtered) { res.outcome = 'filtered'; res.note = 'empty answer with no output tokens, or a refusal stop'; return res; }
    if (j.provider === 'anthropic') history.push({ role: 'assistant', content: t.assistant });
    else history.push(...(t.assistant as unknown[]));
    if (!t.calls.length) {
      if (nudges++ >= 2) { res.note = 'answered without submit_ruling three times'; return res; }
      const text = 'Call submit_ruling now with your ruling.';
      history.push(j.provider === 'anthropic' ? { role: 'user', content: [{ type: 'text', text }] } : { role: 'user', content: [{ type: 'input_text', text }] });
      continue;
    }
    const outputs: Array<{ id: string; text: string }> = [];
    for (const c of t.calls) {
      res.calls.push({ name: c.name, args: c.args });
      if (c.name === SUBMIT.name) {
        const v = validateRuling(c.args, view.item);
        if (typeof v !== 'string') { res.outcome = 'ruled'; res.ruled = v; return res; }
        outputs.push({ id: c.id, text: 'Not accepted: ' + v + '. Call submit_ruling again.' });
      } else if (res.tool_calls >= budget) outputs.push({ id: c.id, text: 'The tool budget is spent. Call submit_ruling now.' });
      else { res.tool_calls++; outputs.push({ id: c.id, text: runTool(view, c.name, c.args) }); }
    }
    if (j.provider === 'anthropic') history.push({ role: 'user', content: outputs.map((o) => ({ type: 'tool_result', tool_use_id: o.id, content: o.text })) });
    else history.push(...outputs.map((o) => ({ type: 'function_call_output', call_id: o.id, output: o.text })));
    if (t.incomplete) res.note = 'a turn hit the output cap';
  }
}

/** A read, asked once more in a fresh session when it ended unanswered or failed. */
export async function readOnce(view: RepoView, j: Judge, prompt: string, send: Transport): Promise<SessionResult & { attempts: number }> {
  const first = await runSession(view, j, prompt, send);
  if (first.outcome !== 'unanswered' && first.outcome !== 'failed') return { ...first, attempts: 1 };
  const second = await runSession(view, j, prompt, send);
  const usage = Object.fromEntries(Object.keys(second.usage).map((k) => [k, first.usage[k as keyof Usage] + second.usage[k as keyof Usage]])) as unknown as Usage;
  return { ...second, usage, turns: first.turns + second.turns, tool_calls: first.tool_calls + second.tool_calls, calls: [...first.calls, ...second.calls], attempts: 2,
    note: 'retried after: ' + first.note + (second.note ? '; ' + second.note : '') };
}

// ---- the metered run ------------------------------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, '..', '..');

interface Proxy { base: string; token: string; child: ChildProcess }
async function startProxy(o: { dir: string; ledger: string; leaseUsd: number; runId: string; judges: Judge[] }): Promise<Proxy> {
  const token = randomBytes(24).toString('hex');
  const errFd = openSync(join(o.dir, 'proxy.stderr.log'), 'a');
  const child = spawn('bun', [join(REPO_ROOT, 'runner/proxy/metering-proxy.ts'), '--listen', '127.0.0.1:0', '--budget-ledger', o.ledger, '--lease-usd', String(o.leaseUsd), '--run-id', o.runId,
    '--allow-models', o.judges.map((j) => j.id).join(','), '--max-output-tokens', String(MAX_OUTPUT_TOKENS), '--control-token', token, '--usage-log', join(o.dir, 'usage.ndjson')],
  { cwd: REPO_ROOT, env: process.env, stdio: ['ignore', 'ignore', 'pipe'] });
  const port = await new Promise<number>((done, fail) => {
    let buf = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); fail(new Error('the metering proxy did not start within 20 s; see ' + join(o.dir, 'proxy.stderr.log'))); }, 20_000);
    child.stderr!.on('data', (d: Buffer) => { writeSync(errFd, d); buf += d.toString('utf8'); const m = buf.match(/ on 127\.0\.0\.1:(\d+);/); if (m) { clearTimeout(timer); done(Number(m[1])); } });
    child.on('exit', () => { clearTimeout(timer); fail(new Error('the metering proxy exited; see ' + join(o.dir, 'proxy.stderr.log'))); });
  });
  return { base: 'http://127.0.0.1:' + port, token, child };
}

function proxyTransport(p: Proxy, slot: string): Transport {
  return async (j, body) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (j.provider === 'anthropic') { headers['x-api-key'] = 'unauthenticated'; headers['anthropic-version'] = '2023-06-01'; } else headers.authorization = 'Bearer unauthenticated';
    let res = { status: 0, text: '' };
    for (const wait of [0, 10_000, 30_000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const r = await fetch(p.base + '/' + slot + '/' + j.provider + ROUTE[j.provider], { method: 'POST', headers, body: JSON.stringify(body), timeout: false } as RequestInit);
      res = { status: r.status, text: await r.text() };
      if (res.status !== 429 && res.status < 500) break;
    }
    return res;
  };
}

export function parseFlags(argv: string[]) {
  const f = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') { f.set(a, ['true']); continue; }
    const v = argv[++i];
    if (!a.startsWith('--') || v === undefined) throw new Error('bad argument ' + JSON.stringify(a));
    f.set(a, [...(f.get(a) ?? []), v]);
  }
  const one = (k: string) => f.get(k)?.[0] ?? (() => { throw new Error('tool-judge needs ' + k); })();
  const briefs = new Map((f.get('--brief') ?? []).map((b) => [b.slice(0, b.indexOf('=')), b.slice(b.indexOf('=') + 1)] as const));
  return { f, one, briefs };
}

/** The brief text a role reads: the labeller's brief is followed by the judge's, which it refers to. */
export function briefFor(role: Role, briefs: Map<string, string>): string {
  const read = (r: string) => { const p = briefs.get(r); if (!p) throw new Error('--brief ' + r + '=<file> is required'); return readFileSync(p, 'utf8'); };
  return role === 'judge' ? read('judge') : read('labeller') + read('judge');
}

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  const { f, one, briefs } = parseFlags(argv.slice(1));
  const items = readItems(one('--items'));
  if (cmd === 'prompt') {
    const role = one('--role') as Role;
    const it = items.find((x) => x.item === one('--item'));
    if (!it) throw new Error('no item ' + one('--item'));
    process.stdout.write(promptFor(new RepoView(it, role), briefFor(role, briefs)) + '\n');
    return 0;
  }
  if (cmd !== 'run') throw new Error('usage: tool-judge.ts run|prompt ... (see the file head)');
  const roles = one('--roles').split(',') as Role[];
  for (const r of roles) if (!ROLES.includes(r)) throw new Error('--roles takes judge and labeller');
  if (roles.includes('labeller') && items.some((i) => !i.later)) throw new Error('labeller items need later (rejudge.ts items --labeller)');
  const judges = (f.get('--judge') ?? []).map(parseJudge);
  if (!judges.length) throw new Error('tool-judge needs at least one --judge');
  const reads = roles.flatMap((role) => judges.flatMap((j) => items.map((it) => ({ role, j, it, prompt: promptFor(new RepoView(it, role), briefFor(role, briefs)) }))));
  if (f.has('--dry-run')) {
    let worst = 0;
    for (const r of reads) worst = Math.max(worst, reservationUsd(priceRequest(HOSTS[r.j.provider] + ROUTE[r.j.provider], requestBody(r.j, r.prompt, [], toolSpecs(r.role), 'dry'))!));
    const chars = reads.map((r) => r.prompt.length);
    console.log(reads.length + ' reads, prompts ' + Math.min(...chars) + ' to ' + Math.max(...chars) + ' chars; worst first turn $' + worst.toFixed(2) + '; lease $' + Number(one('--lease-usd')).toFixed(2) + '. Nothing was sent.');
    return 0;
  }
  const out = resolve(one('--out'));
  if (existsSync(out)) throw new Error('--out ' + out + ' exists; give each run a new directory');
  mkdirSync(join(out, 'sessions'), { recursive: true });
  const runId = one('--run-id');
  const proxy = await startProxy({ dir: out, ledger: resolve(one('--ledger')), leaseUsd: Number(one('--lease-usd')), runId, judges });
  const ctl = (path: string, body: unknown) => fetch(proxy.base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-proxy-control': proxy.token }, body: JSON.stringify(body) });
  const rows: Record<string, unknown>[] = [];
  let stopped: string | null = null;
  try {
    const queues = new Map<string, typeof reads>();
    for (const r of reads) queues.set(r.j.id, [...(queues.get(r.j.id) ?? []), r]);
    let n = 0;
    await Promise.all([...queues.values()].flatMap((q) => Array.from({ length: Math.min(Number(f.get('--concurrency')?.[0] ?? 4), q.length) }, async () => {
      while (q.length && !stopped) {
        const r = q.shift()!;
        const slot = 's' + (++n);
        const key = 'tool-judge:' + runId + ':' + r.role + ':' + r.j.slug + ':' + r.it.item;
        const b = await ctl('/__proxy/bind', { slot, key, models: [r.j.id] });
        if (!b.ok) { stopped = 'the proxy refused the bind for ' + key; break; }
        try {
          const s = await readOnce(new RepoView(r.it, r.role), r.j, r.prompt, proxyTransport(proxy, slot));
          if (s.outcome === 'failed' && /HTTP 4(02|03)/.test(s.note)) stopped = 'stopped on ' + key + ': ' + s.note;
          const meter = await (await ctl('/__proxy/finalize', { key, timeout_ms: 60_000 })).json() as { usd?: number; requests?: number };
          const row = { item: r.it.item, role: r.role, judge: r.j.id, outcome: s.outcome, attempts: s.attempts, ruling: s.ruled?.ruling ?? null, test: s.ruled?.test ?? null,
            tool_calls: s.tool_calls, turns: s.turns, usage: s.usage, usd: meter.usd ?? null, requests: meter.requests ?? null, key, prompt_sha256: sha256(r.prompt), note: s.note };
          rows.push(row);
          writeFileSync(join(out, 'sessions', r.role + '.' + r.j.slug + '.' + r.it.item.replace(/[^A-Za-z0-9._-]/g, '_') + '.json'), JSON.stringify({ ...row, ruled: s.ruled, calls: s.calls }, null, 2) + '\n');
          console.error('tool-judge: ' + r.role + ' ' + r.j.id + ' ' + r.it.item + ': ' + s.outcome + (s.ruled ? ' ' + s.ruled.ruling : '') + ', ' + s.tool_calls + ' tools, $' + Number(meter.usd ?? 0).toFixed(3));
        } catch (e) {
          stopped = 'stopped on ' + key + ': ' + (e as Error).message;
          rows.push({ item: r.it.item, role: r.role, judge: r.j.id, outcome: 'failed', attempts: null, ruling: null, test: null, tool_calls: 0, turns: 0, usage: { input: 0, cached: 0, cache_write: 0, output: 0 },
            usd: null, requests: null, key, prompt_sha256: sha256(r.prompt), note: 'tool-judge error: ' + (e as Error).message });
        } finally { await ctl('/__proxy/unbind', { slot }).catch(() => undefined); }
      }
    })));
  } finally {
    await new Promise<void>((done) => { proxy.child.once('exit', () => done()); proxy.child.kill('SIGTERM'); setTimeout(done, 5_000); });
  }
  writeFileSync(join(out, 'rulings.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const usd = rows.reduce((s, r) => s + Number(r.usd ?? 0), 0);
  writeFileSync(join(out, 'run.json'), JSON.stringify({ version: 1, run_id: runId, roles, judges: judges.map((j) => j.id), items: items.length, reads: rows.length, usd, stopped,
    tool_budget: TOOL_BUDGET, items_sha256: sha256(readFileSync(one('--items'))), briefs: Object.fromEntries([...briefs].map(([k, p]) => [k, sha256(readFileSync(p))])) }, null, 2) + '\n');
  console.log(rows.length + ' reads, $' + usd.toFixed(2) + (stopped ? '; stopped: ' + stopped : ''));
  return stopped || rows.some((r) => r.outcome === 'failed') ? 3 : 0;
}

if (import.meta.main) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { process.stderr.write('tool-judge: ' + (e as Error).message + '\n'); process.exit(2); });
