#!/usr/bin/env bun
// The web-tools check of the frontier Harbor path (Captain ruling 2026-11-09, after internal-task): model-callable web search
// and web fetch are off in every codegen cell, and this proves it from what the model was offered. It runs after the
// smoke (install-check.sh, keyless, every harness against the fake upstream) and before any counted trial
// (scripts/ubicloud/vm-shard.sh, exit 4 on a failure):
//
//   bun scripts/frontier-harbor/web-tools-check.ts --smoke <install-check out dir> --prereg <prereg.json> --name <shard>
//       [--out <file>]   (default <smoke>/web-tools.json)
//
// For each cell of the shard it takes the smoke cell of the same harness and model (else the same harness and provider),
// reads that trial's captured request bodies (<smoke>/agents/run/jobs/<job>/<trial>/proxy-capture/proxy-requests.ndjson,
// the slot found through <smoke>/agents/run/binds.jsonl) and lists every tool the requests declared: the first model
// call's tools plus any a later call added (Anthropic tools[].name, Chat Completions tools[].function.name, Responses
// tools[].name with namespaces as <namespace>.<name>, and the tools of a Responses input item of type additional_tools,
// where Codex 0.165.0 declares its tools instead of in tools[]; a hosted tool by its type). A tool is a web tool when:
//   - its name or hosted type has a web word as a token (web, browse, browser, url, http, internet, exa, parallel,
//     keenable, tavily, perplexity, serper, serpapi, brave, jina, firecrawl, ddgs, duckduckgo, bing, google, searxng),
//     or joins into websearch, webfetch, searchweb, fetchurl, urlfetch, webextract, webscrape, webbrowse, or is x_search
//     (camelCase splits into tokens, so WebFetch is web + fetch, and mcp__exa__search is a keyless web MCP's tool);
//   - its description names a web tool (web_search, web_fetch, web_extract, search_web, fetch_url, x_search, WebSearch,
//     WebFetch), names a keyless or keyed web vendor (Exa, Tavily, Keenable, Firecrawl, SerpApi, Serper, parallel.ai,
//     Parallel search), or its first sentence says it searches the web, fetches a URL or web page, or drives a web browser.
// Words like "parallel" or "browse" elsewhere in a description do not count: Claude Code's Agent tool and QM's skills
// tool use them for other things.
//
// Writes the JSON (tool names only, never a body or a description) and prints one line per finding. A Cursor cell is a
// documented exception: its row says "web tools not disableable (documented), audit applies" and does not fail.
// Exit 0: no cell offers a web tool. 4: a cell offers one, or has no captured tool list (no smoke, no bind, no capture).
// 2: usage, or a shard that is not in the preregistration.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAPTURE_FILE } from '../../runner/proxy/capture.ts';
import { captureDir, readBinds } from './broker.ts';

export interface OfferedTool { name: string; description: string; type?: string }
export interface WebTool { name: string; reason: string }
export interface WebToolsRow {
  cell: string; harness: string; model: string; status: 'pass' | 'fail' | 'exempt' | 'no_capture';
  smoke_cell: string | null; smoke_trial: string | null; requests_read: number; tools: string[] | null; web_tools: WebTool[]; note?: string;
}
export interface WebToolsReport { schema: 'frontier-harbor-web-tools/1'; shard: string; smoke: string; pass: boolean; cells: WebToolsRow[] }

export const EXEMPT: Record<string, string> = {
  cursor: 'web tools not disableable (documented), audit applies: harnesses/cursor/README.md "Web tools" and pin.json web_tools (web fetch denied by permissions.deny WebFetch(*); no documented switch turns web search off); the F1 web-tool audit, scripts/cursor/web-tool-audit.ts, applies',
};

export class UsageError extends Error {}

const CODE = 'HE-FRONTIER-011';
const NAME_TOKENS = new Set(['web', 'browse', 'browser', 'browsing', 'url', 'urls', 'http', 'https', 'internet', 'exa', 'parallel', 'keenable', 'tavily', 'perplexity', 'serper', 'serpapi', 'brave', 'jina', 'firecrawl', 'ddgs', 'duckduckgo', 'bing', 'google', 'searxng']);
const NAME_JOINED = /websearch|webfetch|searchweb|fetchurl|urlfetch|webextract|webscrape|webbrowse/;
const DESC_TOOL = /\b(web_search|web_fetch|web_extract|search_web|fetch_url|x_search)\b|\b(WebSearch|WebFetch)\b/;
const DESC_VENDOR = /\b(exa|tavily|keenable|firecrawl|serpapi|serper)\b|parallel\.ai|\bparallel (web|search)\b/i;
const DESC_PURPOSE = /\b(search(es|ing)? (the )?(web|internet)|web search|fetch(es|ing)?\b.{0,40}?\b(urls?|web ?pages?|websites?)\b|web browser)\b/i;

const tokens = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** The tools one forwarded request body declares, in order. */
export function offeredTools(body: Record<string, unknown>): OfferedTool[] {
  const out: OfferedTool[] = [];
  const walk = (list: unknown, prefix: string) => {
    for (const t of (Array.isArray(list) ? list : []) as Array<Record<string, any>>) {
      if (!t || typeof t !== 'object') continue;
      if (t.type === 'namespace') { walk(t.tools, prefix + String(t.name ?? '') + '.'); continue; }
      const fn = (t.function ?? {}) as Record<string, unknown>;
      const type = typeof t.type === 'string' && !['function', 'custom'].includes(t.type) ? t.type : undefined;
      out.push({ name: prefix + String(t.name ?? fn.name ?? t.type ?? ''), description: String(t.description ?? fn.description ?? ''), ...(type ? { type } : {}) });
    }
  };
  walk(body.tools, '');
  for (const item of (Array.isArray(body.input) ? body.input : []) as Array<Record<string, unknown>>) if (item && item.type === 'additional_tools') walk(item.tools, '');
  return out;
}

/** Why a tool is a web search or web fetch tool, or null when it is not. */
export function webReason(t: OfferedTool): string | null {
  for (const [what, s] of [['name', t.name], ['hosted type', t.type ?? '']] as const) {
    const tk = tokens(s);
    const hit = tk.find((w) => NAME_TOKENS.has(w));
    if (hit) return what + ' has the web word "' + hit + '"';
    const m = NAME_JOINED.exec(tk.join(''));
    if (m) return what + ' contains "' + m[0] + '"';
    if (tk.some((w, i) => w === 'x' && tk[i + 1] === 'search')) return what + ' is x_search';
  }
  const tool = DESC_TOOL.exec(t.description);
  if (tool) return 'description names ' + tool[0];
  const vendor = DESC_VENDOR.exec(t.description);
  if (vendor) return 'description names the web vendor ' + vendor[0].toLowerCase();
  const first = t.description.split(/(?<=[.!?])\s|\n/)[0]!.slice(0, 300);
  if (DESC_PURPOSE.test(first)) return 'its first sentence describes web search, web fetch or a web browser';
  return null;
}

/** Every tool a capture file's requests declared (first seen first), and how many requests had a body. */
export function capturedTools(file: string): { requests: number; tools: OfferedTool[] } {
  const seen = new Map<string, OfferedTool>();
  let requests = 0;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (!raw.trim()) continue;
    const e = JSON.parse(raw) as { body?: unknown };
    const body = typeof e.body === 'string' ? (() => { try { return JSON.parse(e.body as string); } catch { return null; } })() : e.body;
    if (!body || typeof body !== 'object') continue;
    requests++;
    for (const t of offeredTools(body as Record<string, unknown>)) if (!seen.has(t.name)) seen.set(t.name, t);
  }
  return { requests, tools: [...seen.values()] };
}

/** The web-tools rows of one shard's cells, read from the smoke's captures. */
export function checkWebTools(o: { smoke: string; prereg: string; name: string }): WebToolsReport {
  const p = JSON.parse(readFileSync(o.prereg, 'utf8')) as { cells?: Array<{ id: string; harness: string; model: string }>; shards?: Array<{ name: string; cells: string[] }> };
  const shard = (p.shards ?? []).find((s) => s.name === o.name);
  if (!shard) throw new UsageError('shard ' + o.name + ' is not in ' + o.prereg);
  const run = join(o.smoke, 'agents', 'run');
  const binds = readBinds(join(run, 'binds.jsonl'));
  const provider = (m: string) => m.split(':')[0];
  const rows = (p.cells ?? []).filter((c) => shard.cells.includes(c.id)).map((c): WebToolsRow => {
    const row: WebToolsRow = { cell: c.id, harness: c.harness, model: c.model, status: 'no_capture', smoke_cell: null, smoke_trial: null, requests_read: 0, tools: null, web_tools: [] };
    if (EXEMPT[c.harness]) return { ...row, status: 'exempt', note: EXEMPT[c.harness] };
    const b = binds.find((x) => x.harness === c.harness && x.model === c.model) ?? binds.find((x) => x.harness === c.harness && provider(x.model) === provider(c.model));
    if (!b) return { ...row, note: binds.length ? 'the smoke bound no ' + c.harness + ' slot on ' + provider(c.model) : 'no smoke binds at ' + join(run, 'binds.jsonl') + ' (the smoke did not run, or --no-smoke)' };
    const found = { ...row, smoke_cell: b.cell, smoke_trial: b.trial };
    const file = join(run, 'jobs', captureDir(b.cell ?? '', b.attempt ?? 1, b.trial, b.job), CAPTURE_FILE);
    if (!existsSync(file)) return { ...found, note: 'the smoke trial has no capture file' };
    const cap = capturedTools(file);
    if (!cap.requests) return { ...found, note: 'the smoke trial captured no request body' };
    const web = cap.tools.flatMap((t) => { const reason = webReason(t); return reason ? [{ name: t.name, reason }] : []; });
    return { ...found, status: web.length ? 'fail' : 'pass', requests_read: cap.requests, tools: cap.tools.map((t) => t.name), web_tools: web };
  });
  return { schema: 'frontier-harbor-web-tools/1', shard: o.name, smoke: o.smoke, pass: rows.every((r) => r.status === 'pass' || r.status === 'exempt'), cells: rows };
}

/** The lines the check prints: one per finding, then the verdict. */
export function reportLines(r: WebToolsReport): string[] {
  const lines: string[] = [];
  for (const c of r.cells) {
    const who = 'cell ' + c.cell + ' (' + c.harness + ', ' + c.model + ')';
    for (const w of c.web_tools) lines.push(CODE + ' web-tools check: ' + who + ' offers the web tool ' + w.name + ' (' + w.reason + '); web search and web fetch are off in every codegen cell, so no counted trial runs');
    if (c.status === 'no_capture') lines.push(CODE + ' web-tools check: ' + who + ' has no captured tool list: ' + c.note + '; no counted trial runs');
    if (c.status === 'exempt') lines.push('web-tools check: ' + who + ': web tools not disableable (documented), audit applies');
  }
  const count = (...s: string[]) => r.cells.filter((c) => s.includes(c.status)).length;
  lines.push('WEB_TOOLS: ' + (r.pass ? 'ok' : 'fail') + ' shard=' + r.shard + ' cells=' + r.cells.length + ' pass=' + count('pass') + ' exempt=' + count('exempt') + ' fail=' + count('fail', 'no_capture'));
  return lines;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const smoke = flag('--smoke'), prereg = flag('--prereg'), name = flag('--name');
  if (!smoke || !prereg || !name) { console.error('usage: web-tools-check.ts --smoke <install-check out dir> --prereg <prereg.json> --name <shard> [--out <file>]'); process.exit(2); }
  let report: WebToolsReport;
  try { report = checkWebTools({ smoke, prereg, name }); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error('web-tools-check: ' + e.message);
    process.exit(2);
  }
  writeFileSync(flag('--out') ?? join(smoke, 'web-tools.json'), JSON.stringify(report, null, 2) + '\n');
  for (const l of reportLines(report)) console.log(l);
  process.exit(report.pass ? 0 : 4);
}
