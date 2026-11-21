#!/usr/bin/env bun
// The MCP-at-scale request sets (internal-task plan, "Requests and tasks"): the item shapes, the preregistered strata and counts,
// and a validator that checks a set file against tasks/mcp-at-scale/catalog/ladder.json's core tools.
//
//   bun scripts/mcp-at-scale/requests/sets.ts validate --set R|T|G --file <set.jsonl> [--ladder <ladder.json>]
//       [--pilot] [--counted <counted set.jsonl>] [--gbrain-surfaces <surfaces.json>]
//
// Set R: 320 requests. 240 need a tool, 8 per core tool (30 core tools, so every core server is covered), with every
//   required argument value in the text; at least a third of them are capability-only (no service named: none of the
//   core servers' service words and none of the near-twin servers' names appear), the rest name the target's service;
//   near-twin bait (a request whose target server has a twin in the catalog, marked bait with the twin it baits) sits in
//   both strata, and neither stratum holds more than two thirds of it. 80 requests need no tool.
// Set T: 40 chained tasks. Each has 2 to 4 step fixtures in the catalog host's own format (catalog-host.ts FixtureRule:
//   id, server, tool, match, after, result), on core tools across at least two core servers; each step after the first
//   lists the step before it in "after", and one of its match values appears in the step before's result, so one call's
//   result names the next call's argument. end_state.fired names the rules whose firing the host log must show (the
//   last step at least); acceptable is the last step's tool with its match as required, so grade.py's right_tool means
//   "reached the last step's tool with the chained argument".
// Set G: 120 gbrain requests on synthetic brain pages: 60 answerable with starter tools (half_kind "starter"), 60 that need
//   a full-only tool (half_kind "full_only"). With --gbrain-surfaces {starter: [tool], full: [tool]} the halves are checked
//   against the frozen release's surfaces.
// Pilot (--pilot): 60 set R tool requests over all 30 core tools (2 each), 10 set T tasks, 20 set G requests (10 per
//   half); --counted names the counted set file, and a pilot id or text found there fails, since pilot items stay out
//   of the counted sets.
// Every item is also checked against requests/schema.json (Ajv, the validator the catalog host uses).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { normalizeLadder, type Ladder } from '../catalog-load.ts';
import type { FixtureRule } from '../catalog-host.ts';

export const LADDER_FILE = join(import.meta.dir, '..', '..', '..', 'tasks', 'mcp-at-scale', 'catalog', 'ladder.json');
export const SCHEMA_FILE = join(import.meta.dir, 'schema.json');

export const PLAN = {
  R: { total: 320, tool: 240, none: 80, per_core_tool: 8, capability_only_min_share: 1 / 3, bait_max_stratum_share: 2 / 3 },
  T: { total: 40, min_steps: 2, max_steps: 4, min_servers: 2 },
  G: { total: 120, starter: 60, full_only: 60 },
  pilot: { R: 60, R_per_core_tool: 2, T: 10, G: 20 },
} as const;

/** Words that name a core server's service in a request. A names_service request uses one; a capability_only request none. */
export const SERVICE_WORDS: Record<string, string[]> = {
  atlassian: ['confluence', 'atlassian'],
  github: ['github'],
  grafana: ['grafana'],
  mongodb: ['mongodb', 'mongo'],
  slack: ['slack'],
  terraform: ['terraform'],
};
/** Near-twin servers' names that would name a service; common English words (teams, linear, memory, time) are left out. */
export const TWIN_WORDS = ['postgres', 'postgresql', 'cloudwatch', 'gitlab', 'notion', 'sqlite', 'dynamodb', 'microsoft teams', 'mattermost', 'sentry'];

export type Stratum = 'capability_only' | 'names_service' | 'no_tool';
export interface Acceptable { server: string; tool: string; required?: Record<string, unknown> }
export interface RItem { id: string; set: 'R'; kind: 'tool' | 'none'; text: string; stratum: Stratum; target: { server: string; tool: string } | null;
  bait: boolean; bait_twin?: string | null; acceptable: Acceptable[]; fixtures?: FixtureRule[]; half?: 'public' | 'sealed' }
export interface TItem { id: string; set: 'T'; kind: 'tool'; text: string; fixtures: FixtureRule[]; end_state: { fired: string[] }; acceptable: Acceptable[]; half?: 'public' | 'sealed' }
export interface GItem { id: string; set: 'G'; kind: 'tool'; text: string; half_kind: 'starter' | 'full_only'; target: { server: string; tool: string };
  acceptable: Acceptable[]; fixtures?: FixtureRule[]; half?: 'public' | 'sealed' }
export type Item = RItem | TItem | GItem;
export const itemSha = (item: Item) => createHash('sha256').update(JSON.stringify(item)).digest('hex');
export type SetName = 'R' | 'T' | 'G';
export type Surfaces = { starter: string[]; full: string[]; verbs?: string[] };

export const readJsonl = <T>(path: string): T[] => readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
export const loadLadder = (path: string = LADDER_FILE): Ladder => normalizeLadder(JSON.parse(readFileSync(path, 'utf8')));
/** The twins of each core server, from the raw ladder's distractor order. */
export function twinsOf(path: string = LADDER_FILE): Record<string, string[]> {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { distractor_order?: Array<{ server: string; kind: string; twin_of?: string }> };
  const out: Record<string, string[]> = {};
  for (const d of raw.distractor_order ?? []) if (d.kind === 'twin' && d.twin_of) (out[d.twin_of] ??= []).push(d.server);
  return out;
}
export const coreTools = (l: Ladder) => l.core.flatMap((c) => c.tools.map((t) => c.server + '/' + t));
const catalogTools = (l: Ladder) => new Set(Object.values(l.rungs).flatMap((r) => r.servers.flatMap((s) => s.tools.map((t) => s.server + '/' + t))));

const escapeRe = (w: string) => w.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
export const hasWord = (text: string, w: string) => new RegExp('(^|[^a-z0-9])' + escapeRe(w) + '([^a-z0-9]|$)', 'i').test(text);
/** The literal values a request's text must carry for its required matchers ($re is skipped). */
export function requiredValues(required: Record<string, unknown> | undefined): string[] {
  const out: string[] = [];
  for (const m of Object.values(required ?? {})) {
    if (typeof m === 'string' || typeof m === 'number') out.push(String(m));
    else if (m && typeof m === 'object' && !Array.isArray(m)) {
      const o = m as Record<string, unknown>;
      if (typeof o.$ci === 'string') out.push(o.$ci);
      else if (typeof o.$contains === 'string') out.push(o.$contains);
    }
  }
  return out;
}

let schemaCheck: ((x: unknown) => { valid: boolean; errorMessage?: string }) | null = null;
export function schemaProblems(items: unknown[]): string[] {
  schemaCheck ??= new AjvJsonSchemaValidator().getValidator(JSON.parse(readFileSync(SCHEMA_FILE, 'utf8'))) as never;
  const out: string[] = [];
  items.forEach((it, i) => {
    const r = schemaCheck!(it);
    if (!r.valid) out.push('item ' + ((it as { id?: string })?.id ?? '#' + i) + ': schema: ' + r.errorMessage);
    else {
      const item = it as Item;
      if (item.set === 'T' && item.fixtures.some((rule) => rule.id === 'default')) out.push('item ' + item.id + ': fixture id default is reserved for the neutral host response');
    }
  });
  return out;
}

function common(items: Item[], set: SetName): string[] {
  const problems = schemaProblems(items);
  const ids = new Set<string>(), texts = new Set<string>();
  for (const it of items) {
    if (it.set !== set) problems.push(it.id + ': set is ' + it.set + ', expected ' + set);
    if (ids.has(it.id)) problems.push('duplicate id ' + it.id);
    const t = it.text.trim().toLowerCase();
    if (texts.has(t)) problems.push(it.id + ': the same text as an earlier item');
    ids.add(it.id); texts.add(t);
  }
  return problems;
}

export interface Report { set: SetName; ok: boolean; problems: string[]; counts: Record<string, number> }

export function validateR(items: RItem[], ladder: Ladder, o: { pilot?: boolean; twins?: Record<string, string[]> } = {}): Report {
  const problems = common(items, 'R');
  const core = coreTools(ladder), all = catalogTools(ladder), twins = o.twins ?? twinsOf();
  const tool = items.filter((i) => i.kind === 'tool'), none = items.filter((i) => i.kind === 'none');
  const perTarget = new Map<string, number>(core.map((c) => [c, 0]));
  const bait = { capability_only: 0, names_service: 0 };
  const serviceWords = Object.values(SERVICE_WORDS).flat();
  for (const it of tool) {
    const key = it.target ? it.target.server + '/' + it.target.tool : null;
    if (!key || !perTarget.has(key)) { problems.push(it.id + ': target ' + key + ' is not a core tool of the ladder'); continue; }
    perTarget.set(key, perTarget.get(key)! + 1);
    if (it.stratum === 'no_tool') problems.push(it.id + ': a tool request in the no_tool stratum');
    const own = it.acceptable.find((a) => a.server === it.target!.server && a.tool === it.target!.tool);
    if (!own) problems.push(it.id + ': its target is not in its acceptable set');
    for (const a of it.acceptable) if (!all.has(a.server + '/' + a.tool)) problems.push(it.id + ': acceptable tool ' + a.server + '/' + a.tool + ' is not in the catalog');
    for (const v of requiredValues(own?.required)) if (!it.text.toLowerCase().includes(v.toLowerCase())) problems.push(it.id + ': required value "' + v + '" is not in the text');
    if (it.stratum === 'capability_only') {
      const named = [...serviceWords, ...TWIN_WORDS].filter((w) => hasWord(it.text, w));
      if (named.length) problems.push(it.id + ': capability_only but names ' + named.join(', '));
    }
    if (it.stratum === 'names_service' && !(SERVICE_WORDS[it.target!.server] ?? [it.target!.server]).some((w) => hasWord(it.text, w))) problems.push(it.id + ': names_service but does not name ' + it.target!.server);
    if (it.bait) {
      if (!it.bait_twin || !(twins[it.target!.server] ?? []).includes(it.bait_twin)) problems.push(it.id + ': bait names twin ' + it.bait_twin + ', which is not a near-twin of ' + it.target!.server);
      if (it.stratum === 'capability_only' || it.stratum === 'names_service') bait[it.stratum]++;
    }
  }
  for (const it of none) {
    if (it.stratum !== 'no_tool' || it.target || it.acceptable.length || it.bait) problems.push(it.id + ': a no-tool request needs stratum no_tool, no target, no acceptable tool and no bait');
  }
  const capability = tool.filter((i) => i.stratum === 'capability_only').length;
  const want = o.pilot ? { total: PLAN.pilot.R, tool: PLAN.pilot.R, none: 0, per: PLAN.pilot.R_per_core_tool } : { total: PLAN.R.total, tool: PLAN.R.tool, none: PLAN.R.none, per: PLAN.R.per_core_tool };
  if (items.length !== want.total) problems.push(items.length + ' items, the plan has ' + want.total);
  if (tool.length !== want.tool) problems.push(tool.length + ' tool requests, the plan has ' + want.tool);
  if (none.length !== want.none) problems.push(none.length + ' no-tool requests, the plan has ' + want.none);
  for (const [k, n] of perTarget) if (n !== want.per) problems.push('core tool ' + k + ' has ' + n + ' requests, the plan has ' + want.per);
  if (!o.pilot) {
    if (capability < Math.ceil(tool.length * PLAN.R.capability_only_min_share)) problems.push(capability + ' capability_only requests, the plan needs at least a third (' + Math.ceil(tool.length / 3) + ')');
    const b = bait.capability_only + bait.names_service;
    if (!bait.capability_only || !bait.names_service) problems.push('near-twin bait must sit in both strata (capability_only ' + bait.capability_only + ', names_service ' + bait.names_service + ')');
    else if (Math.max(bait.capability_only, bait.names_service) > b * PLAN.R.bait_max_stratum_share) problems.push('near-twin bait is not spread across both strata: ' + JSON.stringify(bait));
  }
  return { set: 'R', ok: !problems.length, problems, counts: { total: items.length, tool: tool.length, none: none.length, capability_only: capability, names_service: tool.length - capability, bait_capability_only: bait.capability_only, bait_names_service: bait.names_service } };
}

export function validateT(items: TItem[], ladder: Ladder, o: { pilot?: boolean } = {}): Report {
  const problems = common(items, 'T');
  const core = new Set(coreTools(ladder));
  for (const it of items) {
    const steps = it.fixtures;
    if (steps.length < PLAN.T.min_steps || steps.length > PLAN.T.max_steps) problems.push(it.id + ': ' + steps.length + ' steps, the plan has 2 to 4');
    const servers = new Set<string>();
    steps.forEach((s, k) => {
      if (!s.server || !core.has(s.server + '/' + s.tool)) problems.push(it.id + ': step ' + s.id + ' calls ' + s.server + '/' + s.tool + ', not a core tool');
      else servers.add(s.server);
      if (k === 0) return;
      const prev = steps[k - 1]!;
      if (!(s.after ?? []).includes(prev.id)) problems.push(it.id + ': step ' + s.id + ' does not chain after ' + prev.id);
      const prevText = JSON.stringify(prev.result).toLowerCase();
      if (!requiredValues(s.match).some((v) => prevText.includes(v.toLowerCase()))) problems.push(it.id + ': no match value of step ' + s.id + ' appears in the result of ' + prev.id);
    });
    if (servers.size < PLAN.T.min_servers) problems.push(it.id + ': steps use ' + servers.size + ' core server(s), the plan chains across core servers');
    const ids = new Set(steps.map((s) => s.id));
    const last = steps[steps.length - 1];
    if (!it.end_state.fired.length || it.end_state.fired.some((f) => !ids.has(f))) problems.push(it.id + ': end_state.fired must name step ids');
    if (last && !it.end_state.fired.includes(last.id)) problems.push(it.id + ': end_state.fired must include the last step ' + last.id);
    const a = it.acceptable[0];
    if (it.acceptable.length !== 1 || !last || a!.server !== last.server || a!.tool !== last.tool || JSON.stringify(a!.required ?? {}) !== JSON.stringify(last.match ?? {})) problems.push(it.id + ': acceptable must be the last step\'s tool with its match as required');
    if (steps[0] && !requiredValues(steps[0].match).every((v) => it.text.toLowerCase().includes(v.toLowerCase()))) problems.push(it.id + ': the first step\'s match values must be in the text');
  }
  const want = o.pilot ? PLAN.pilot.T : PLAN.T.total;
  if (items.length !== want) problems.push(items.length + ' tasks, the plan has ' + want);
  return { set: 'T', ok: !problems.length, problems, counts: { total: items.length, steps: items.reduce((s, i) => s + i.fixtures.length, 0) } };
}

export function validateG(items: GItem[], o: { pilot?: boolean; surfaces?: Surfaces } = {}): Report {
  const problems = common(items, 'G');
  const starter = items.filter((i) => i.half_kind === 'starter'), full = items.filter((i) => i.half_kind === 'full_only');
  for (const it of items) {
    const own = it.acceptable.find((a) => a.server === it.target.server && a.tool === it.target.tool);
    if (!own) problems.push(it.id + ': its target is not in its acceptable set');
    for (const v of requiredValues(own?.required)) if (!it.text.toLowerCase().includes(v.toLowerCase())) problems.push(it.id + ': required value "' + v + '" is not in the text');
    if (it.target.tool === 'request_tools') problems.push(it.id + ': targets request_tools, which grade.py counts as discovery, never as the right tool');
    if (o.surfaces) {
      const inStarter = o.surfaces.starter.includes(it.target.tool), inFull = o.surfaces.full.includes(it.target.tool);
      if (it.half_kind === 'starter' && !inStarter) problems.push(it.id + ': starter half, but ' + it.target.tool + ' is not a starter tool');
      if (it.half_kind === 'full_only' && (inStarter || !inFull)) problems.push(it.id + ': full_only half, but ' + it.target.tool + ' is not a full-only tool');
    }
  }
  const half = o.pilot ? PLAN.pilot.G / 2 : PLAN.G.starter;
  if (items.length !== half * 2) problems.push(items.length + ' requests, the plan has ' + half * 2);
  if (starter.length !== half || full.length !== half) problems.push('halves ' + starter.length + ' starter and ' + full.length + ' full_only, the plan has ' + half + ' each');
  return { set: 'G', ok: !problems.length, problems, counts: { total: items.length, starter: starter.length, full_only: full.length } };
}

/** Pilot items stay out of the counted sets: no shared id or text. */
export function pilotOverlap(pilot: Item[], counted: Item[]): string[] {
  const ids = new Set(counted.map((i) => i.id)), texts = new Set(counted.map((i) => i.text.trim().toLowerCase()));
  return pilot.flatMap((p) => [...(ids.has(p.id) ? ['pilot item ' + p.id + ' is also in the counted set'] : []), ...(texts.has(p.text.trim().toLowerCase()) ? ['pilot item ' + p.id + ' has a counted item\'s text'] : [])]);
}

export function validateSet(set: SetName, items: Item[], o: { ladder?: Ladder; pilot?: boolean; surfaces?: Surfaces; counted?: Item[]; twins?: Record<string, string[]> } = {}): Report {
  const ladder = o.ladder ?? loadLadder();
  const r = set === 'R' ? validateR(items as RItem[], ladder, o) : set === 'T' ? validateT(items as TItem[], ladder, o) : validateG(items as GItem[], o);
  if (o.counted) r.problems.push(...pilotOverlap(items, o.counted));
  r.ok = !r.problems.length;
  return r;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const set = flag('--set') as SetName | undefined, file = flag('--file');
  if (argv[0] !== 'validate' || !set || !['R', 'T', 'G'].includes(set) || !file) {
    console.error('usage: sets.ts validate --set R|T|G --file <set.jsonl> [--ladder <ladder.json>] [--pilot] [--counted <set.jsonl>] [--gbrain-surfaces <json>]');
    process.exit(2);
  }
  const ladderPath = flag('--ladder');
  const r = validateSet(set, readJsonl<Item>(file), {
    ladder: loadLadder(ladderPath), twins: twinsOf(ladderPath), pilot: argv.includes('--pilot'),
    counted: flag('--counted') ? readJsonl<Item>(flag('--counted')!) : undefined,
    surfaces: flag('--gbrain-surfaces') ? JSON.parse(readFileSync(flag('--gbrain-surfaces')!, 'utf8')) : undefined,
  });
  for (const p of r.problems) console.log(p);
  console.log('set ' + set + ' ' + JSON.stringify(r.counts) + ' ' + (r.ok ? 'ok' : r.problems.length + ' problem(s)'));
  process.exit(r.ok ? 0 : 1);
}
