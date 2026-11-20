#!/usr/bin/env bun
// The prompts Gemini 4 Carbon, the request author, is given for sets R, T and G, and the auditors' prompts (internal-task plan,
// "Requests and tasks" and decision G). Templates live in prompts/*.md with {{name}} slots; this file fills them from the
// catalog snapshot. Nothing here calls a model: authoring is multi-turn and interactive (the batch-routing change keeps it
// so), and the operator runs it through the metering proxy, then turns the answers into set files that sets.ts checks.
//
//   bun scripts/mcp-at-scale/requests/prompts.ts --catalog tasks/mcp-at-scale/catalog --out <dir> [--gbrain-surfaces <json>]
//
// Writes <out>/author-prompts.jsonl, one line per prompt {key, set, target, system, prompt}, key = sha256 of model, system
// and prompt, and <out>/prompts-index.json with each template's sha256.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalog, rungServers, type Catalog } from '../catalog-load.ts';
import { syntheticPages } from '../gbrain.ts';
import { PLAN, SERVICE_WORDS, TWIN_WORDS, twinsOf, type Surfaces } from './sets.ts';

export const AUTHOR_MODEL = 'google:gemini-4-carbon';
export const PROMPTS_DIR = join(import.meta.dir, 'prompts');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const template = (name: string) => readFileSync(join(PROMPTS_DIR, name + '.md'), 'utf8');
/** Fills {{slot}}s; an unfilled slot is an error, so a prompt never ships with a hole in it. */
export function render(text: string, vars: Record<string, string | number>): string {
  const out = text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => { if (!(k in vars)) throw new Error('HE-MCP-021 prompt slot {{' + k + '}} has no value'); return String(vars[k]); });
  return out;
}

const required = (schema: Record<string, any>) => (Array.isArray(schema?.required) ? schema.required.join(', ') : 'none');
/** One line per tool of a rung: server/tool: description; required arguments. The auditors' cached prefix. */
export function catalogListing(cat: Catalog, rung = '300'): string {
  return rungServers(cat, rung).flatMap((s) => s.tools.map((t) => '- ' + s.server + '/' + t.name + ': ' + t.description.replace(/\s+/g, ' ').trim() + '; required: ' + required(t.inputSchema))).join('\n');
}

export interface AuthorPrompt { key: string; set: 'R' | 'T' | 'G'; target: string | null; system: string; prompt: string }

export interface GbrainTool { name: string; description?: string; inputSchema?: Record<string, any> }
/** Tools a set G request may target: never a surface's own discovery tool, which grade.py counts as discovery. */
export const GBRAIN_DISCOVERY = ['request_tools'];

export function authorPrompts(cat: Catalog, twins: Record<string, string[]>, surfaces?: Surfaces & { pages?: string[]; tools?: GbrainTool[] }): AuthorPrompt[] {
  const system = template('author-system');
  const out: AuthorPrompt[] = [];
  const add = (set: AuthorPrompt['set'], target: string | null, prompt: string) => out.push({ key: sha(JSON.stringify([AUTHOR_MODEL, system, prompt])), set, target, system, prompt });
  const top = rungServers(cat, '300');
  const tool = (server: string, name: string) => top.find((s) => s.server === server)?.tools.find((t) => t.name === name);
  const per = PLAN.R.per_core_tool, capability = Math.ceil(per / 3);
  for (const c of cat.ladder.core) {
    const tw = twins[c.server] ?? [];
    for (const name of c.tools) {
      const t = tool(c.server, name);
      if (!t) throw new Error('HE-MCP-021 core tool ' + c.server + '/' + name + ' is not on the 300 rung');
      const twinLines = tw.map((s) => '- ' + s + ': ' + (top.find((x) => x.server === s)?.tools.slice(0, 6).map((x) => x.name).join(', ') ?? '')).join('\n') || '- (none)';
      add('R', c.server + '/' + name, render(template('set-r-tool'), {
        count: per, tool: name, service: c.server, description: t.description.trim(), schema: JSON.stringify(t.inputSchema, null, 1),
        twins: twinLines, capability_only: capability, names_service: per - capability, bait: tw.length ? 2 : 0, bait_twin: tw.join(' or ') || 'none',
        banned_words: [...Object.values(SERVICE_WORDS).flat(), ...TWIN_WORDS].join(', '), service_words: (SERVICE_WORDS[c.server] ?? [c.server]).join(', '),
      }));
    }
  }
  const domains = cat.ladder.core.map((c) => c.server).join(', ');
  for (let k = 0; k < PLAN.R.none / 20; k++) add('R', null, render(template('set-r-none'), { count: 20, domains }));
  const coreList = cat.ladder.core.flatMap((c) => c.tools.map((n) => '- ' + c.server + '/' + n + ': ' + (tool(c.server, n)?.description.replace(/\s+/g, ' ').trim().slice(0, 240) ?? ''))).join('\n');
  for (let k = 0; k < PLAN.T.total / 10; k++) add('T', null, render(template('set-t'), { count: 10, core_tools: coreList, min_steps: PLAN.T.min_steps, max_steps: PLAN.T.max_steps }));
  if (surfaces) {
    const targetable = (t: string) => !GBRAIN_DISCOVERY.includes(t);
    const starter = surfaces.starter.filter(targetable);
    const fullOnly = surfaces.full.filter((t) => !surfaces.starter.includes(t) && targetable(t));
    const def = (t: string) => surfaces.tools?.find((x) => x.name === t);
    const pages = (surfaces.pages ?? ['(the synthetic page list is added when the brain fixture is frozen)']).map((p) => '- ' + p).join('\n');
    const each = (tools: string[], n: number, note: string) => tools.forEach((t, i) => {
      const count = Math.floor(n / tools.length) + (i < n % tools.length ? 1 : 0);
      if (count) add('G', 'gbrain/' + t, render(template('set-g'), { count, pages, tool: t, description: def(t)?.description?.replace(/\s+/g, ' ').trim() ?? '(from the frozen gbrain release\'s tools/list)', schema: JSON.stringify(def(t)?.inputSchema ?? {}, null, 1), surface_note: note }));
    });
    each(starter, PLAN.G.starter, 'listed on every gbrain surface');
    each(fullOnly, PLAN.G.full_only, 'listed only on the full surface');
  }
  return out;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const catalog = flag('--catalog'), out = flag('--out');
  if (!catalog || !out) { console.error('usage: prompts.ts --catalog <dir> --out <dir> [--gbrain-surfaces <json> [--gbrain-tools <full tools/list dump>]]'); process.exit(2); }
  const surfaces = flag('--gbrain-surfaces') ? JSON.parse(readFileSync(flag('--gbrain-surfaces')!, 'utf8')) : undefined;
  if (surfaces && flag('--gbrain-tools')) surfaces.tools = JSON.parse(readFileSync(flag('--gbrain-tools')!, 'utf8')).tools;
  if (surfaces && !surfaces.pages) surfaces.pages = Object.keys(syntheticPages()).sort();
  const prompts = authorPrompts(loadCatalog(catalog), twinsOf(join(catalog, 'ladder.json')), surfaces);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'author-prompts.jsonl'), prompts.map((p) => JSON.stringify(p)).join('\n') + '\n');
  const templates = Object.fromEntries(readdirSync(PROMPTS_DIR).sort().map((f) => [f, sha(readFileSync(join(PROMPTS_DIR, f), 'utf8'))]));
  writeFileSync(join(out, 'prompts-index.json'), JSON.stringify({ model: AUTHOR_MODEL, prompts: prompts.length, by_set: { R: prompts.filter((p) => p.set === 'R').length, T: prompts.filter((p) => p.set === 'T').length, G: prompts.filter((p) => p.set === 'G').length }, templates }, null, 1) + '\n');
  console.log('wrote ' + prompts.length + ' author prompts to ' + out);
}
