#!/usr/bin/env bun
// The keyless listing map of the skills-at-scale category (internal-task-a, internal-task-b; plan decisions E and F, the "Harnesses" table):
// for each harness and catalog size, the first model request each harness sends with the catalog installed in its own skills
// folder (the skills-catalog arm, nothing from gbrain), and for every catalog skill where it sits:
//   with_description  listed with its name and at least 40 characters of its own description (all of it when shorter)
//   name_only         listed, with less of its description than that
//   loaded_not_shown  not in the listing, but the harness reports it loaded (OpenClaw: openclaw skills list modelVisible;
//                     Claude Code: the stream-json init record's skills; Gemini CLI: the activate_skill enum)
//   not_loaded        not in the listing, and the harness's own list does not have it either
//   not_shown         not in the listing, on a harness with no list of what it loaded (Codex, Hermes, Pi)
// plus the listing's size in characters and in tokens (o200k_base, an estimate for every provider). OpenClaw runs three times:
// skills-catalog (its load limits raised to fit the root), skills-catalog-printed-fix (only the maxCandidatesPerRoot raise that
// gbrain setup prints) and skills-catalog-default-limits. Gemini CLI has
// no adapter: scripts/skills-at-scale/gemini-listing.ts. Keyless: fake model endpoints, dummy keys, no spend.
//
//   bun scripts/skills-at-scale/listing-map.ts --ladder <dir with <size>/skills> --out <dir> [--sizes 100,351,700,1500]
//       [--harness claude-code,codex,hermes,openclaw,pi,gemini-cli] [--build] [--analyze-only]
//
// --build builds each rung's kit and images (scripts/skills-at-scale/build-kit.ts) first. --analyze-only rereads the captures
// under <out>/captures. Writes <out>/map.json and <out>/map.md. The ladder is any directory of rungs, so the map reruns
// unchanged on the real catalog ladder.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { buildImages, buildKit, catalogSha, readCatalog } from './build-kit.ts';
import { geminiListing } from './gemini-listing.ts';
import { runSession, trialDir } from './session.ts';

export const MAP_HARNESSES = ['claude-code', 'codex', 'hermes', 'openclaw', 'pi', 'gemini-cli'] as const;
export type MapHarness = (typeof MAP_HARNESSES)[number];
export const PLACES = ['with_description', 'name_only', 'loaded_not_shown', 'not_loaded', 'not_shown'] as const;
export type Place = (typeof PLACES)[number];
export const DESC_CHARS = 40;
export const MAP_PROMPT = 'Write the hiring report for this week.';

export type Entry = { name: string; shown: string; location: string | null; catalog: boolean };
export type Listing = { entries: Entry[]; region: string };

const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
};
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The XML listing OpenClaw, Pi and Gemini CLI send: the last <available_skills> that opens a list of <skill> entries. */
function xmlListing(all: string[], catalogDir: (loc: string) => boolean): Listing {
  for (const s of all) {
    const starts = [...s.matchAll(/<available_skills>\s*(?=<skill>)/g)].map((m) => m.index!);
    if (!starts.length) continue;
    const i = starts.at(-1)!, j = s.indexOf('</available_skills>', i);
    const region = s.slice(i, j < 0 ? undefined : j + '</available_skills>'.length);
    const entries = [...region.matchAll(/<skill>([\s\S]*?)<\/skill>/g)].map((m) => {
      const name = unxml(/<name>([\s\S]*?)<\/name>/.exec(m[1]!)?.[1]?.trim() ?? '');
      const location = /<location>([\s\S]*?)<\/location>/.exec(m[1]!)?.[1]?.trim() ?? null;
      return { name, shown: unxml(/<description>([\s\S]*?)<\/description>/.exec(m[1]!)?.[1] ?? ''), location, catalog: location ? catalogDir(location) : false };
    });
    return { entries, region };
  }
  return { entries: [], region: '' };
}

export const CATALOG_ROOT: Record<MapHarness, string> = { 'claude-code': '/harness-state/claude/skills/', codex: '/harness-state/codex/skills', hermes: '', openclaw: '/workspace/skills/', pi: '/harness-state/pi/skills/', 'gemini-cli': '/home/gem/.gemini/skills/' };

/** Every skill the harness's first agent request lists, with the text shown beside its name. */
export function parseListing(h: MapHarness, body: unknown): Listing {
  const all = strings(body);
  if (h === 'openclaw' || h === 'pi' || h === 'gemini-cli') return xmlListing(all, (l) => l.startsWith(CATALOG_ROOT[h]));
  if (h === 'claude-code') {
    const HEAD = 'The following skills are available for use with the Skill tool:';
    const s = all.find((x) => x.includes(HEAD));
    if (!s) return { entries: [], region: '' };
    const lines = s.slice(s.indexOf(HEAD) + HEAD.length).split('\n');
    const entries: Entry[] = [];
    let started = false, chars = HEAD.length;
    for (const line of lines) {
      if (line.startsWith('- ')) {
        started = true;
        const k = line.indexOf(': ');
        entries.push({ name: (k < 0 ? line.slice(2) : line.slice(2, k)).split(' (')[0]!.trim(), shown: k < 0 ? '' : line.slice(k + 2), location: null, catalog: true });
      } else if (started && line.trim() && !line.startsWith('</')) entries.at(-1)!.shown += '\n' + line;
      else if (started) break;
      chars += line.length + 1;
    }
    return { entries, region: s.slice(s.indexOf(HEAD), s.indexOf(HEAD) + chars) };
  }
  if (h === 'codex') {
    const s = all.find((x) => x.includes('<skills_instructions>'));
    if (!s) return { entries: [], region: '' };
    const region = s.slice(s.indexOf('<skills_instructions>'), s.indexOf('</skills_instructions>') + '</skills_instructions>'.length);
    const roots = new Map([...region.matchAll(/^- \x60(r\d+)\x60 = \x60([^\x60]+)\x60/gm)].map((m) => [m[1]!, m[2]!]));
    const entries = [...region.matchAll(/^- ([^:\n(]+?)(?::\s?(.*?))?\s*\(file: (r\d+)\/([^)]*)\)\s*$/gm)].map((m) => {
      const root = roots.get(m[3]!) ?? '';
      return { name: m[1]!.trim(), shown: m[2] ?? '', location: root + '/' + m[4], catalog: root === CATALOG_ROOT.codex };
    });
    return { entries, region };
  }
  const s = all.find((x) => x.includes('<available_skills>'));
  if (!s) return { entries: [], region: '' };
  const region = s.slice(s.indexOf('<available_skills>'), s.indexOf('</available_skills>') + '</available_skills>'.length);
  const entries: Entry[] = [];
  let category = '';
  for (const line of region.split('\n')) {
    const c = /^ {0,3}(\S[^:]*):(?:\s.*)?$/.exec(line);
    if (c && !line.startsWith('    ')) { category = c[1]!.trim(); continue; }
    const m = /^\s+- ([^:\s]+)(?::\s?(.*))?$/.exec(line);
    if (m) entries.push({ name: m[1]!, shown: (m[2] ?? '').replace(/\.\.\.$/, ''), location: null, catalog: m[1] === category });
  }
  return { entries, region };
}

/** How many leading characters of the skill's own description the shown text carries (whitespace normalised). */
export function descriptionShown(shown: string, description: string): number {
  const a = norm(unxml(shown)), b = norm(description);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export function place(e: Entry | undefined, description: string, loaded: Set<string> | null, name: string): Place {
  if (e) return descriptionShown(e.shown, description) >= Math.min(DESC_CHARS, norm(description).length) ? 'with_description' : 'name_only';
  if (!loaded) return 'not_shown';
  return loaded.has(name) ? 'loaded_not_shown' : 'not_loaded';
}

export type CellMap = { harness: MapHarness; config: string; size: number; counts: Record<Place, number>; listing_chars: number; listing_tokens_est: number; catalog_listed: number; harness_listed: number;
  harness_skills_listed: string[]; loaded_source: string | null; limits?: unknown; enum_size?: number | null; enum_chars?: number | null; targets: Record<Place, number>; skills: Record<string, Place>; note?: string };

export function mapCell(o: { harness: MapHarness; config: string; size: number; body: unknown; catalog: { name: string; description: string; target?: boolean }[]; loaded: Set<string> | null; loadedSource: string | null; activateEnum?: string[] | null; enumChars?: number | null }): CellMap {
  const l = parseListing(o.harness, o.body);
  const names = new Set(o.catalog.map((s) => s.name));
  const byName = new Map(l.entries.filter((e) => e.catalog && names.has(e.name)).map((e) => [e.name, e]));
  const counts = Object.fromEntries(PLACES.map((p) => [p, 0])) as Record<Place, number>;
  const targets = Object.fromEntries(PLACES.map((p) => [p, 0])) as Record<Place, number>;
  const skills: Record<string, Place> = {};
  for (const s of o.catalog) {
    const p = place(byName.get(s.name), s.description, o.loaded, s.name);
    skills[s.name] = p; counts[p]++;
    if (s.target) targets[p]++;
  }
  const harnessListed = l.entries.filter((e) => !(e.catalog && names.has(e.name))).map((e) => e.name);
  return { harness: o.harness, config: o.config, size: o.size, counts, listing_chars: l.region.length, listing_tokens_est: l.region ? countTokens(l.region, { disallowedSpecial: new Set() }) : 0,
    catalog_listed: byName.size, harness_listed: harnessListed.length, harness_skills_listed: harnessListed, loaded_source: o.loadedSource, targets, skills,
    ...(o.harness === 'gemini-cli' ? { enum_size: o.activateEnum?.length ?? null, enum_chars: o.enumChars ?? null } : {}) };
}

/** What the harness itself reports loaded, where it says. */
export function loadedFromTrial(h: MapHarness, trial: string | null): { loaded: Set<string> | null; source: string | null } {
  if (!trial) return { loaded: null, source: null };
  if (h === 'openclaw') {
    const f = join(trial, 'logs', 'sas-host-skills.json');
    if (!existsSync(f)) return { loaded: null, source: null };
    const d = JSON.parse(readFileSync(f, 'utf8')) as { skills: { name: string; modelVisible?: boolean }[] };
    return { loaded: new Set(d.skills.filter((s) => s.modelVisible).map((s) => s.name)), source: 'openclaw skills list --json --agent main (modelVisible)' };
  }
  if (h === 'claude-code') {
    const dir = join(trial, 'logs', 'turns');
    const f = existsSync(dir) ? readdirSync(dir).find((x) => x.endsWith('.claude.jsonl')) : undefined;
    if (!f) return { loaded: null, source: null };
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as { type?: string; subtype?: string; skills?: (string | { name: string })[] };
      if (r.type === 'system' && r.subtype === 'init' && Array.isArray(r.skills)) return { loaded: new Set(r.skills.map((s) => (typeof s === 'string' ? s : s.name))), source: 'stream-json init record skills (' + f + ')' };
    }
  }
  return { loaded: null, source: null };
}

/** The first request that lists skills (a title or housekeeping call may come first). */
export function firstListingBody(h: MapHarness, bodies: unknown[]): unknown {
  return bodies.find((b) => parseListing(h, b).entries.length) ?? bodies[0];
}

export function renderMap(cells: CellMap[]): string {
  const rows = ['| Harness | Config | Skills | With description | Name only | Loaded, not shown | Not loaded | Not shown | Listing chars | Listing tokens (est.) | Harness skills listed |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const c of [...cells].sort((a, b) => a.harness.localeCompare(b.harness) || a.config.localeCompare(b.config) || a.size - b.size))
    rows.push('| ' + [c.harness, c.config, c.size, c.counts.with_description, c.counts.name_only, c.counts.loaded_not_shown, c.counts.not_loaded, c.counts.not_shown, c.listing_chars.toLocaleString('en-US'), c.listing_tokens_est.toLocaleString('en-US'), c.harness_listed].join(' | ') + ' |');
  return rows.join('\n');
}

const CONFIGS: Record<Exclude<MapHarness, 'gemini-cli'>, string[]> = { 'claude-code': ['skills-catalog'], codex: ['skills-catalog'], hermes: ['skills-catalog'], openclaw: ['skills-catalog', 'skills-catalog-printed-fix', 'skills-catalog-default-limits'], pi: ['skills-catalog'] };

async function main() {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const ladder = v('--ladder'), outArg = v('--out');
  if (!ladder || !outArg) { console.error('usage: listing-map.ts --ladder <dir> --out <dir> [--sizes ...] [--harness ...] [--build] [--analyze-only]'); process.exit(2); }
  const out = resolve(outArg);
  const sizes = (v('--sizes') ?? readdirSync(resolve(ladder)).filter((d) => /^\d+$/.test(d)).join(',')).split(',').map(Number).sort((x, y) => x - y);
  const harnesses = (v('--harness') ?? MAP_HARNESSES.join(',')).split(',') as MapHarness[];
  const docker = harnesses.filter((h) => h !== 'gemini-cli') as Exclude<MapHarness, 'gemini-cli'>[];
  const mapFile = join(out, 'map.json');
  const prior = existsSync(mapFile) ? (JSON.parse(readFileSync(mapFile, 'utf8')) as { ladder?: string; catalogs?: Record<string, string>; cells: CellMap[] }) : null;
  const catalogs: Record<string, string> = { ...prior?.catalogs };
  for (const size of sizes) {
    const sha = catalogSha(join(resolve(ladder), String(size)));
    if (prior && (prior.ladder !== resolve(ladder) || (catalogs[size] ?? sha) !== sha)) { console.error('listing-map: ' + mapFile + ' and its captures come from another ladder or catalog (rung ' + size + '); use a new --out'); process.exit(2); }
    catalogs[size] = sha;
  }
  const cells: CellMap[] = prior?.cells ?? [];
  const keep = (c: CellMap) => { const i = cells.findIndex((x) => x.harness === c.harness && x.config === c.config && x.size === c.size); if (i >= 0) cells.splice(i, 1); cells.push(c); };
  for (const size of sizes) {
    const rung = join(resolve(ladder), String(size));
    const catalog = readCatalog(rung);
    if (a.includes('--build') && docker.length) {
      buildKit({ catalog: rung, out: join(out, 'kits', String(size)) });
      buildImages(join(out, 'kits', String(size)), docker, String(size));
    }
    for (const h of docker) for (const config of CONFIGS[h]) {
      const dir = join(out, 'captures', h + '-' + config + '-' + size);
      if (!a.includes('--analyze-only')) {
        const s = await runSession({ harness: h, config, image: 'harness-eval/' + h + ':sas-' + size, turns: [MAP_PROMPT], dir });
        console.log('CAPTURE ' + h + ' ' + config + ' ' + size + ' termination=' + s.termination + ' requests=' + s.requests.length);
      }
      const bodies = existsSync(join(dir, 'fake.ndjson')) ? readFileSync(join(dir, 'fake.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.method === 'POST' && r.body).map((r) => r.body) : [];
      const trial = trialDir(join(dir, 'run'));
      const { loaded, source } = loadedFromTrial(h, trial);
      const c = mapCell({ harness: h, config, size, body: firstListingBody(h, bodies), catalog, loaded, loadedSource: source });
      const armFile = trial ? join(trial, 'logs', 'sas-arm.json') : '';
      if (h === 'openclaw' && armFile && existsSync(armFile)) c.limits = JSON.parse(readFileSync(armFile, 'utf8')).limits ?? null;
      if (!bodies.length) c.note = 'no captured request';
      keep(c);
      console.log('MAP ' + h + ' ' + config + ' ' + size + ' ' + JSON.stringify(c.counts) + ' chars=' + c.listing_chars + ' tokens=' + c.listing_tokens_est);
    }
    if (harnesses.includes('gemini-cli')) {
      const dir = join(out, 'captures', 'gemini-cli-' + size);
      if (!a.includes('--analyze-only')) await geminiListing({ catalog: rung, out: dir, prompt: MAP_PROMPT });
      const reqs = existsSync(join(dir, 'requests.json')) ? (JSON.parse(readFileSync(join(dir, 'requests.json'), 'utf8')) as { body: Record<string, any> }[]) : [];
      const body = firstListingBody('gemini-cli', reqs.map((r) => r.body));
      const decl = ((body as Record<string, any> | undefined)?.tools ?? []).flatMap((t: any) => t?.functionDeclarations ?? []).find((f: any) => f?.name === 'activate_skill');
      const props = decl?.parameters?.properties ?? decl?.parametersJsonSchema?.properties ?? {};
      const en: string[] | null = Array.isArray(props.name?.enum) ? props.name.enum : null;
      const c = mapCell({ harness: 'gemini-cli', config: 'catalog', size, body, catalog, loaded: en ? new Set(en) : null, loadedSource: en ? 'activate_skill name enum' : null, activateEnum: en, enumChars: decl ? JSON.stringify(decl).length : null });
      if (!reqs.length) c.note = 'no captured request';
      keep(c);
      console.log('MAP gemini-cli catalog ' + size + ' ' + JSON.stringify(c.counts) + ' chars=' + c.listing_chars + ' enum=' + c.enum_size);
    }
    mkdirSync(out, { recursive: true });
    writeFileSync(mapFile, JSON.stringify({ schema_version: 1, ladder: resolve(ladder), catalogs, desc_chars: DESC_CHARS, prompt: MAP_PROMPT, cells }, null, 1) + '\n');
  }
  writeFileSync(join(out, 'map.md'), '# Skill listing map (keyless)\n\nWhere each harness puts every catalog skill in its first model request, with the catalog in its own skills folder and nothing from gbrain. "With description" means the name plus at least ' + DESC_CHARS + ' characters of the skill\'s own description. Tokens are o200k_base counts of the listing text, an estimate for every provider.\n\n' + renderMap(cells) + '\n');
  console.log(renderMap(cells));
}

if (import.meta.main) await main();
