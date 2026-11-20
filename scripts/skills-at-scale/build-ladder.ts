#!/usr/bin/env bun
// Builds the skills-at-scale catalog ladder (internal-task, plan decisions B and F): four nested catalogs of 100, 351, 700
// and 1,500 skills, and the records the preregistration pins.
//
//   bun scripts/skills-at-scale/fetch-packs.ts --dest <src>
//   bun scripts/skills-at-scale/build-ladder.ts --src <src> --out <snapshot> [--record <dir>] [--check] [--gitleaks] [--leak-set <setR.jsonl>]
//   bun scripts/skills-at-scale/build-ladder.ts --materialize <rung> --out <snapshot> --dest <dir>
//
// <src> holds one checkout per pack, named as in scripts/skill-resolver/packs.json and packs-ladder.json. The 351-skill
// rung is the skill-resolver catalog, built by scripts/skill-resolver/build-catalog.ts and refused unless its hash is
// the one packs-ladder.json pins. Each added pack is built on its own by the same builder, then screened: a skill drops
// when its licence is not on the allowed list, its body is under min_body_chars, its SKILL.md letters are mostly
// non-Latin, its name is not a plain folder name, it is a per-language copy, or it is over its pack's cap. Vendor packs
// fill the 700 rung, stratified by pack with a seeded pick; the remaining vendor skills and the community packs fill the
// 1,500 rung the same way. An added skill whose name another selected skill also uses is renamed <pack>-<name>, as the
// skill-resolver catalog did. Executables in added skill folders are left out (safety.ts), and every renamed or trimmed
// added skill gets a MODIFICATIONS.md. The 100 rung is the target skills: drawn from the 351 rung, stratified by pack and
// spread over 100 equal bins of the 1,500 names in code-point order; 20 pins are drawn from them with their own seed.
// --record writes hashes.json, targets.json and near-duplicates.json to the committed record folder; manifest.json and
// safety-scan.json are too big to commit, so they go to <snapshot>/records and hashes.json pins their sha256. --check
// rebuilds and exits 1 when any committed record differs, which covers the two uncommitted ones through hashes.json.

import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { build, parseFrontmatter, renameFrontmatter, type CatalogSkill, type Manifest } from '../skill-resolver/build-catalog.ts';
import { catalogHashOf } from '../skill-resolver/shard-kit.ts';
import { executableReason, fetchAndRunLines, FETCH_AND_RUN, leakScan, walkFiles, type LeakScan, type LineHit } from './safety.ts';

type Pack = Parameters<typeof build>[0][number];
export type AddedPack = Pack & {
  tier: 'vendor' | 'community'; notices: string[]; cap?: number; language_suffixes?: string[]; max_non_latin_share?: number;
  exclude_skills?: Record<string, string>; licence_overrides?: Record<string, { licence: string; reason: string }>; note?: string;
};
export type LadderConfig = {
  schema_version: 1;
  core: { packs_file: string; catalog_hash: string; skill_count: number; notices: Record<string, string[]> };
  rungs: number[]; seeds: { selection: string; targets: string; pins: string }; pins: number;
  filters: { min_body_chars: number; max_non_latin_share: number; name_pattern: string };
  allowed_licences: string[]; near_duplicate_threshold: number; added: AddedPack[];
};
type Candidate = { pack: AddedPack; skill: CatalogSkill; dir: string; licence: string; licence_source: string };
export type Excluded = { pack: string; path: string; name: string; reason: string };
export type LadderSkill = {
  name: string; pack: string; tier: 'core' | 'vendor' | 'community'; rung: number; original_name: string; renamed: boolean; source_path: string;
  licence: string; licence_source: string; skill_md_sha256: string; dir_sha256: string; files: number; quarantined: string[]; modifications: boolean;
};

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export const UNCOMMITTED = ['manifest.json', 'safety-scan.json'];
export const seeded = (seed: string, key: string) => sha(seed + '\n' + key);
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byLocale = (a: string, b: string) => a.localeCompare(b, 'en');
const json = (v: unknown) => JSON.stringify(v, null, 1) + '\n';

export function classifyLicence(text: string | null | undefined): string | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  if (/polyform/i.test(t)) return 'PolyForm';
  if (/non-?commercial|\bNC\b/i.test(t)) return 'non-commercial';
  if (/\b[AL]?GPL|general public licen[cs]e/i.test(t)) return 'GPL';
  if (/share-?alike|\bBY-SA\b/i.test(t)) return 'CC-BY-SA';
  if (/apache/i.test(t)) return 'Apache-2.0';
  if (/\bMIT\b|permission is hereby granted, free of charge/i.test(t)) return 'MIT';
  if (/\bBSD\b|\bBSD-|clause/i.test(t)) return /2[- ]clause|BSD-2/i.test(t) ? 'BSD-2-Clause' : /3[- ]clause|BSD-3/i.test(t) ? 'BSD-3-Clause' : 'BSD';
  if (/creativecommons\.org\/licenses\/by\/4\.0|\bCC[- ]?BY[- ]4\.0/i.test(t)) return 'CC-BY-4.0';
  if (/proprietary|governed by|all rights reserved/i.test(t)) return 'proprietary';
  return null;
}

export function skillLicence(pack: AddedPack, skill: CatalogSkill, dir: string): { licence: string; source: string } {
  const override = pack.licence_overrides?.[skill.original_name];
  if (override) return { licence: override.licence, source: 'override: ' + override.reason };
  if (skill.licence_file) {
    const fromFile = classifyLicence(readFileSync(join(dir, skill.licence_file), 'utf8'));
    if (fromFile) return { licence: fromFile, source: skill.licence_file };
  }
  const field = parseFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8')).license;
  const fromField = classifyLicence(field);
  if (fromField) return { licence: fromField, source: 'license: field' };
  if (field && !/^(see\s+)?licen[cs]e(\.(txt|md))?$|complete terms/i.test(field)) return { licence: 'unknown', source: 'license: field' };
  if (pack.licence !== 'per-skill') return { licence: pack.licence, source: 'repository' };
  return { licence: 'unknown', source: 'none' };
}

export const bodyChars = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---[^\n]*\n?/, '').trim().length;
export function nonLatinShare(text: string): number {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters ? 1 - (text.match(/\p{Script=Latin}/gu)?.length ?? 0) / letters : 0;
}

export function largestRemainder(sizes: Record<string, number>, n: number): Record<string, number> {
  const keys = Object.keys(sizes).sort(byCodePoint);
  const total = keys.reduce((s, k) => s + sizes[k]!, 0);
  const exact = keys.map((k) => ({ k, x: (n * sizes[k]!) / total }));
  const out: Record<string, number> = Object.fromEntries(exact.map(({ k, x }) => [k, Math.floor(x)]));
  let left = n - Object.values(out).reduce((s, v) => s + v, 0);
  for (const { k } of [...exact].sort((a, b) => (b.x - Math.floor(b.x)) - (a.x - Math.floor(a.x)) || byCodePoint(a.k, b.k))) {
    if (left <= 0) break;
    if (out[k]! < sizes[k]!) { out[k]!++; left--; }
  }
  return out;
}

export function stratifiedPick<T extends { pack: string; name: string }>(items: T[], n: number, seed: string, label: string): T[] {
  if (n >= items.length) return [...items];
  const groups = Object.groupBy(items, (i) => i.pack) as Record<string, T[]>;
  const quotas = largestRemainder(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])), n);
  return Object.keys(groups).sort(byCodePoint).flatMap((k) =>
    [...groups[k]!].sort((a, b) => byCodePoint(seeded(seed, label + '/' + k + '/' + a.name), seeded(seed, label + '/' + k + '/' + b.name))).slice(0, quotas[k]));
}

export function screenPack(cfg: LadderConfig, pack: AddedPack, manifest: Manifest, dir: string): { kept: Candidate[]; excluded: Excluded[] } {
  const excluded: Excluded[] = manifest.excluded.map((e) => ({ pack: pack.name, path: e.path, name: '', reason: e.reason }));
  const drop = (s: CatalogSkill, reason: string) => excluded.push({ pack: pack.name, path: s.source_path, name: s.original_name, reason });
  let kept: Candidate[] = [];
  const namePattern = new RegExp(cfg.filters.name_pattern);
  for (const skill of manifest.skills) {
    const skillDir = join(dir, 'skills', skill.name);
    const text = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
    const why = pack.exclude_skills?.[skill.original_name];
    if (why) { drop(skill, why); continue; }
    const { licence, source } = skillLicence(pack, skill, skillDir);
    if (!cfg.allowed_licences.includes(licence)) { drop(skill, 'licence ' + licence + ' (' + source + ') is not on the allowed list'); continue; }
    if (bodyChars(text) < cfg.filters.min_body_chars) { drop(skill, 'stub: body under ' + cfg.filters.min_body_chars + ' characters'); continue; }
    const share = nonLatinShare(text);
    const maxShare = pack.max_non_latin_share ?? cfg.filters.max_non_latin_share;
    if (share > maxShare) { drop(skill, 'SKILL.md letters ' + (share * 100).toFixed(1) + '% non-Latin, over ' + maxShare * 100 + '%'); continue; }
    if (!namePattern.test(skill.original_name)) { drop(skill, 'name is not a plain folder name'); continue; }
    kept.push({ pack, skill, dir: skillDir, licence, licence_source: source });
  }
  const key = (c: Candidate, label: string) => seeded(cfg.seeds.selection, label + '/' + pack.name + '/' + c.skill.original_name);
  if (pack.language_suffixes?.length) {
    const suffix = new RegExp('-(' + pack.language_suffixes.join('|') + ')$');
    const families = Object.groupBy(kept, (c) => c.skill.original_name.replace(suffix, '')) as Record<string, Candidate[]>;
    kept = [];
    for (const [family, members] of Object.entries(families).sort(([a], [b]) => byCodePoint(a, b))) {
      const [keep, ...rest] = [...members].sort((a, b) => byCodePoint(key(a, 'language'), key(b, 'language')));
      kept.push(keep!);
      for (const r of rest) drop(r.skill, 'language variant of ' + family + ' (kept ' + keep!.skill.original_name + ')');
    }
  }
  if (pack.cap !== undefined && kept.length > pack.cap) {
    const order = [...kept].sort((a, b) => byCodePoint(key(a, 'cap'), key(b, 'cap')));
    for (const r of order.slice(pack.cap)) drop(r.skill, 'over the pack cap of ' + pack.cap);
    kept = order.slice(0, pack.cap);
  }
  kept.sort((a, b) => byCodePoint(a.skill.original_name, b.skill.original_name));
  return { kept, excluded };
}

export function selectAdded(cfg: LadderConfig, pool: Candidate[]): { inner: Candidate[]; outer: Candidate[] } {
  const [, core, mid, top] = cfg.rungs as [number, number, number, number];
  const tag = (cs: Candidate[]) => cs.map((c) => ({ pack: c.pack.name, name: c.skill.original_name, c }));
  const vendor = tag(pool.filter((c) => c.pack.tier === 'vendor'));
  const community = tag(pool.filter((c) => c.pack.tier === 'community'));
  const seed = cfg.seeds.selection;
  const inner = stratifiedPick(vendor, mid - core, seed, 'rung-' + mid);
  if (inner.length < mid - core) inner.push(...stratifiedPick(community, mid - core - inner.length, seed, 'rung-' + mid + '-community'));
  const taken = new Set(inner.map((x) => x.c));
  const restVendor = vendor.filter((x) => !taken.has(x.c));
  const restCommunity = community.filter((x) => !taken.has(x.c));
  const need = top - mid;
  const outer = restVendor.length >= need ? stratifiedPick(restVendor, need, seed, 'rung-' + top)
    : [...restVendor, ...stratifiedPick(restCommunity, need - restVendor.length, seed, 'rung-' + top + '-community')];
  if (inner.length + outer.length < top - core) throw new Error('only ' + (inner.length + outer.length) + ' added skills pass the filters; the ladder needs ' + (top - core));
  return { inner: inner.map((x) => x.c), outer: outer.map((x) => x.c) };
}

export function assignNames(core: CatalogSkill[], added: Candidate[]): Map<Candidate, string> {
  const coreNames = new Set(core.flatMap((s) => [s.name.toLowerCase(), s.original_name.toLowerCase()]));
  const owners = new Map<string, Set<string>>();
  for (const c of added) { const k = c.skill.original_name.toLowerCase(); owners.set(k, (owners.get(k) ?? new Set()).add(c.pack.name)); }
  const out = new Map<Candidate, string>();
  const seen = new Set(core.map((s) => s.name.toLowerCase()));
  for (const c of added) {
    const k = c.skill.original_name.toLowerCase();
    const name = coreNames.has(k) || owners.get(k)!.size > 1 ? c.pack.name + '-' + c.skill.original_name : c.skill.original_name;
    if (seen.has(name.toLowerCase())) throw new Error('name ' + name + ' is still taken after the pack prefix');
    seen.add(name.toLowerCase());
    out.set(c, name);
  }
  return out;
}

export function dirListing(dir: string): { files: { path: string; sha256: string }[]; dir_sha256: string } {
  const files = [...walkFiles(dir)].map((f) => ({ path: relative(dir, f), sha256: sha(readFileSync(f)) }));
  return { files, dir_sha256: sha(files.map((f) => f.path + '\t' + f.sha256).join('\n')) };
}

export const catalogHash = (skills: { name: string; skill_md_sha256: string; dir_sha256: string }[]) =>
  sha([...skills].sort((a, b) => byLocale(a.name, b.name)).map((s) => s.name + '\t' + s.skill_md_sha256 + '\t' + s.dir_sha256).join('\n'));

export function pickTargets(core: { name: string; pack: string }[], allNames: string[], n: number, seed: string): { name: string; pack: string; bin: number; in_bin: boolean }[] {
  const sorted = [...allNames].sort(byCodePoint);
  const pos = new Map(sorted.map((s, i) => [s, i]));
  const binOf = (name: string) => Math.floor((pos.get(name)! * n) / sorted.length);
  const left = largestRemainder(Object.fromEntries(Object.entries(Object.groupBy(core, (c) => c.pack)).map(([k, v]) => [k, v!.length])), n);
  const bins = new Map<number, { name: string; pack: string }[]>();
  for (let b = 0; b < n; b++) bins.set(b, []);
  for (const c of core) bins.get(binOf(c.name))!.push(c);
  const order = [...bins.keys()].sort((a, b) => bins.get(a)!.length - bins.get(b)!.length || byCodePoint(seeded(seed, 'bin/' + a), seeded(seed, 'bin/' + b)));
  const chosen = new Map<string, { name: string; pack: string; bin: number; in_bin: boolean }>();
  const rank = (c: { name: string }) => seeded(seed, 'skill/' + c.name);
  const empty: number[] = [];
  for (const b of order) {
    const pick = bins.get(b)!.filter((c) => left[c.pack]! > 0).sort((x, y) => byCodePoint(rank(x), rank(y)))[0];
    if (!pick) { empty.push(b); continue; }
    left[pick.pack]!--;
    chosen.set(pick.name, { ...pick, bin: b, in_bin: true });
  }
  for (const b of empty.sort((x, y) => x - y)) {
    const centre = ((b + 0.5) * sorted.length) / n;
    const pick = core.filter((c) => !chosen.has(c.name) && left[c.pack]! > 0)
      .sort((x, y) => Math.abs(pos.get(x.name)! - centre) - Math.abs(pos.get(y.name)! - centre) || byCodePoint(rank(x), rank(y)))[0];
    if (!pick) throw new Error('no target left for bin ' + b);
    left[pick.pack]!--;
    chosen.set(pick.name, { ...pick, bin: b, in_bin: false });
  }
  return [...chosen.values()].sort((a, b) => byCodePoint(a.name, b.name));
}

const STOP = new Set('a an and are as at be by can for from has have how in into is it its of on or that the this to use used uses using when which with you your skill skills'.split(' '));
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));

export function nearDuplicates(items: { name: string; description: string }[], threshold: number): { a: string; b: string; cosine: number }[] {
  const docs = items.map((i) => tokens(i.name.replace(/[-_.]/g, ' ') + ' ' + i.description));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const vecs = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    const w = [...tf].map(([t, f]) => [t, f * (Math.log((1 + docs.length) / (1 + df.get(t)!)) + 1)] as const);
    const norm = Math.hypot(...w.map(([, x]) => x)) || 1;
    return new Map(w.map(([t, x]) => [t, x / norm]));
  });
  const postings = new Map<string, number[]>();
  vecs.forEach((v, i) => { for (const t of v.keys()) (postings.get(t) ?? postings.set(t, []).get(t)!).push(i); });
  const pairs: { a: string; b: string; cosine: number }[] = [];
  vecs.forEach((v, i) => {
    const acc = new Map<number, number>();
    for (const [t, x] of v) for (const j of postings.get(t)!) if (j > i) acc.set(j, (acc.get(j) ?? 0) + x * vecs[j]!.get(t)!);
    for (const [j, c] of acc) if (c >= threshold) {
      const [a, b] = [items[i]!.name, items[j]!.name].sort(byCodePoint) as [string, string];
      pairs.push({ a, b, cosine: Math.round(c * 1e4) / 1e4 });
    }
  });
  return pairs.sort((x, y) => y.cosine - x.cosine || byCodePoint(x.a, y.a) || byCodePoint(x.b, y.b));
}

export function materialize(out: string, rung: number, dest: string): string {
  const names = readFileSync(join(out, 'rungs', rung + '.txt'), 'utf8').split('\n').filter(Boolean);
  rmSync(dest, { recursive: true, force: true });
  for (const name of names) for (const f of walkFiles(join(out, 'skills', name))) {
    const target = join(dest, 'skills', name, relative(join(out, 'skills', name), f));
    mkdirSync(dirname(target), { recursive: true });
    linkSync(f, target);
  }
  return catalogHashOf(dest);
}

export type BuildResult = { records: Record<string, string>; rungHashes: Record<string, string> };

export function buildLadder(cfg: LadderConfig, corePacks: Pack[], dirs: Record<string, string>, out: string, opts: { gitleaks?: { cache: string; work: string }; setR?: string } = {}): BuildResult {
  const [targetCount, coreCount, , topCount] = cfg.rungs as [number, number, number, number];
  const work = mkdtempSync(join(tmpdir(), 'skills-ladder-'));
  try {
    rmSync(out, { recursive: true, force: true });
    mkdirSync(join(out, 'skills'), { recursive: true });
    const core = build(corePacks, dirs, join(work, 'core'));
    if (core.catalog_hash !== cfg.core.catalog_hash || core.skill_count !== coreCount) throw new Error('core catalog is ' + core.catalog_hash + ' with ' + core.skill_count + ' skills; packs-ladder.json pins ' + cfg.core.catalog_hash + ' with ' + coreCount);
    const excluded: Excluded[] = [];
    const pool: Candidate[] = [];
    for (const pack of cfg.added) {
      const packOut = join(work, 'packs', pack.name);
      const r = screenPack(cfg, pack, build([pack], dirs, packOut), packOut);
      pool.push(...r.kept);
      excluded.push(...r.excluded);
    }
    const { inner, outer } = selectAdded(cfg, pool);
    const names = assignNames(core.skills, [...inner, ...outer]);
    const skills: LadderSkill[] = [];
    const scan: { skill: string; pack: string; files: { path: string; hits: LineHit[] }[] }[] = [];
    const quarantined: { skill: string; pack: string; path: string; reason: string; sha256: string }[] = [];
    const modifications: string[] = [];
    for (const s of core.skills) {
      const dest = join(out, 'skills', s.name);
      cpSync(join(work, 'core', 'skills', s.name), dest, { recursive: true });
      const listing = dirListing(dest);
      if (listing.dir_sha256 !== s.dir_sha256) throw new Error('core skill ' + s.name + ' changed while copying');
      skills.push({ name: s.name, pack: s.pack, tier: 'core', rung: coreCount, original_name: s.original_name, renamed: s.renamed, source_path: s.source_path, licence: s.licence, licence_source: s.licence_file ?? 'build-catalog.ts', skill_md_sha256: s.skill_md_sha256, dir_sha256: s.dir_sha256, files: listing.files.length, quarantined: [], modifications: false });
      if (s.renamed) modifications.push('- ' + s.pack + ' ' + s.source_path + '/SKILL.md: frontmatter name changed from ' + s.original_name + ' to ' + s.name + ' (skill-resolver catalog, MIT)');
    }
    for (const [c, rung] of [...inner.map((c) => [c, cfg.rungs[2]!] as const), ...outer.map((c) => [c, topCount] as const)]) {
      const name = names.get(c)!;
      const dest = join(out, 'skills', name);
      cpSync(c.dir, dest, { recursive: true });
      const changes: string[] = [];
      if (name !== c.skill.original_name) {
        writeFileSync(join(dest, 'SKILL.md'), renameFrontmatter(readFileSync(join(dest, 'SKILL.md'), 'utf8'), name));
        changes.push('SKILL.md: frontmatter name changed from ' + c.skill.original_name + ' to ' + name + ', because another skill in the catalog has the same name.');
      }
      const gone: string[] = [];
      const files: { path: string; hits: LineHit[] }[] = [];
      for (const f of [...walkFiles(dest)]) {
        const rel = relative(dest, f);
        const buf = readFileSync(f);
        const reason = executableReason(rel, buf, statSync(f).mode);
        if (reason) { unlinkSync(f); gone.push(rel); quarantined.push({ skill: name, pack: c.pack.name, path: rel, reason, sha256: sha(buf) }); continue; }
        const hits = fetchAndRunLines(buf.toString('utf8'));
        if (hits.length) files.push({ path: rel, hits });
      }
      for (const d of [...readdirSync(dest, { recursive: true, withFileTypes: true })].filter((e) => e.isDirectory()).map((e) => join(e.parentPath, e.name)).sort().reverse()) if (!readdirSync(d).length) rmSync(d, { recursive: true });
      if (gone.length) changes.push('Removed ' + gone.length + ' executable file' + (gone.length > 1 ? 's' : '') + ' (scripts or binaries), which this catalog does not ship: ' + gone.join(', ') + '.');
      if (changes.length) {
        writeFileSync(join(dest, 'MODIFICATIONS.md'), '# Modifications\n\nThis folder is a modified copy of ' + c.skill.source_path + ' in ' + c.pack.source + ' at commit ' + c.pack.pin.commit + ', licensed ' + c.licence + '. The harness-evals skills-at-scale catalog builder changed it on purpose for an evaluation:\n\n' + changes.map((x) => '- ' + x).join('\n') + '\n\nEverything else is unchanged from the source.\n');
        modifications.push(...changes.map((x) => '- ' + c.pack.name + ' ' + c.skill.source_path + ' (now ' + name + '): ' + x));
      }
      if (files.length) scan.push({ skill: name, pack: c.pack.name, files });
      const listing = dirListing(dest);
      const mdSha = listing.files.find((f) => f.path === 'SKILL.md')!.sha256;
      skills.push({ name, pack: c.pack.name, tier: c.pack.tier, rung, original_name: c.skill.original_name, renamed: name !== c.skill.original_name, source_path: c.skill.source_path, licence: c.licence, licence_source: c.licence_source, skill_md_sha256: mdSha, dir_sha256: listing.dir_sha256, files: listing.files.length, quarantined: gone, modifications: changes.length > 0 });
    }
    skills.sort((a, b) => byCodePoint(a.name, b.name));
    const allNames = skills.map((s) => s.name);
    const targets = pickTargets(skills.filter((s) => s.tier === 'core'), allNames, targetCount, cfg.seeds.targets);
    const targetSet = new Set(targets.map((t) => t.name));
    const pins = [...targets].sort((a, b) => byCodePoint(seeded(cfg.seeds.pins, a.name), seeded(cfg.seeds.pins, b.name))).slice(0, cfg.pins).map((t) => t.name).sort(byCodePoint);
    const member = (s: LadderSkill, r: number) => (r === targetCount ? targetSet.has(s.name) : s.rung <= r);
    mkdirSync(join(out, 'rungs'), { recursive: true });
    const rungHashes: Record<string, string> = {};
    const rungs: Record<string, { skills: number; catalog_hash: string }> = {};
    const order: Record<string, { codepoint: string[]; locale: string[] }> = {};
    for (const r of cfg.rungs) {
      const inRung = skills.filter((s) => member(s, r));
      const hash = catalogHash(inRung);
      writeFileSync(join(out, 'rungs', r + '.txt'), inRung.map((s) => s.name).sort(byLocale).join('\n') + '\n');
      const check = materialize(out, r, join(work, 'rung-' + r));
      if (check !== hash) throw new Error('rung ' + r + ': shard-kit catalogHashOf gives ' + check + ', the manifest gives ' + hash);
      rmSync(join(work, 'rung-' + r), { recursive: true, force: true });
      rungHashes[r] = hash;
      rungs[r] = { skills: inRung.length, catalog_hash: hash };
      order[r] = { codepoint: inRung.map((s) => s.name).sort(byCodePoint), locale: inRung.map((s) => s.name).sort(byLocale) };
    }
    if (rungHashes[coreCount] !== cfg.core.catalog_hash) throw new Error('rung ' + coreCount + ' hash ' + rungHashes[coreCount] + ' is not the skill-resolver catalog');
    const positions = targets.map((t) => ({
      name: t.name, pack: t.pack, bin: t.bin, in_bin: t.in_bin, pin: pins.includes(t.name),
      position: Object.fromEntries(cfg.rungs.map((r) => [r, order[r]!.codepoint.indexOf(t.name) + 1])),
      position_locale: Object.fromEntries(cfg.rungs.map((r) => [r, order[r]!.locale.indexOf(t.name) + 1])),
    }));
    const quarters = Object.fromEntries(cfg.rungs.map((r) => {
      const size = order[r]!.codepoint.length;
      const q = [0, 0, 0, 0];
      for (const p of positions) q[Math.min(3, Math.floor(((p.position[r]! - 1) * 4) / size))]!++;
      return [r, q];
    }));

    const notices: { pack: string; file: string; sha256: string }[] = [];
    const shipNotice = (pack: string, dir: string, file: string) => {
      const src = join(dir, file);
      if (!existsSync(src)) throw new Error('pack ' + pack + ': notice file ' + file + ' is missing');
      mkdirSync(join(out, 'licences', pack), { recursive: true });
      copyFileSync(src, join(out, 'licences', pack, file));
      notices.push({ pack, file, sha256: sha(readFileSync(src)) });
    };
    for (const p of corePacks) for (const f of cfg.core.notices[p.name] ?? []) shipNotice(p.name, dirs[p.name]!, f);
    for (const p of cfg.added) for (const f of p.notices) shipNotice(p.name, dirs[p.name]!, f);
    const perSkill = skills.filter((s) => s.tier !== 'core' && s.licence_source !== 'repository');
    writeFileSync(join(out, 'LICENCES.md'), '# Licences\n\nEach pack\'s licence notices are under licences/<pack>/. Skills whose licence comes from their own folder or frontmatter rather than the repository:\n\n' + perSkill.map((s) => '- ' + s.name + ' (' + s.pack + '): ' + s.licence + ', from ' + s.licence_source).join('\n') + '\n');
    writeFileSync(join(out, 'MODIFICATIONS.md'), '# Modifications\n\nFiles changed from their pinned sources when this catalog was built. Each modified added skill also carries a MODIFICATIONS.md in its own folder.\n\n' + modifications.sort(byCodePoint).join('\n') + '\n');

    const leaks: LeakScan = leakScan(join(out, 'skills'), opts);
    const added = skills.filter((s) => s.tier !== 'core');
    const hitCounts: Record<string, number> = {};
    for (const s of scan) for (const k of new Set(s.files.flatMap((f) => f.hits.flatMap((h) => h.patterns)))) hitCounts[k] = (hitCounts[k] ?? 0) + 1;
    const markdownHits = scan.map((s) => ({ ...s, files: s.files.filter((f) => /\.(md|mdx|markdown)$/i.test(f.path)) })).filter((s) => s.files.length);
    const otherHits = scan.map((s) => ({ ...s, files: s.files.filter((f) => !/\.(md|mdx|markdown)$/i.test(f.path)) })).filter((s) => s.files.length);
    const packSummary = Object.fromEntries([...corePacks.map((p) => p.name), ...cfg.added.map((p) => p.name)].map((p) => [p, Object.fromEntries(cfg.rungs.map((r) => [r, skills.filter((s) => s.pack === p && member(s, r)).length]))]));
    const nd = nearDuplicates(skills.map((s) => ({ name: s.name, description: s.tier === 'core' ? core.skills.find((c) => c.name === s.name)!.description : [...inner, ...outer].find((c) => names.get(c) === s.name)!.skill.description })), cfg.near_duplicate_threshold);
    const bySkill = new Map(skills.map((s) => [s.name, s]));
    const rungOf = (n: string) => (targetSet.has(n) ? targetCount : bySkill.get(n)!.rung);

    const records: Record<string, string> = {
      'manifest.json': json({
        schema_version: 1,
        packs: [...corePacks.map((p) => ({ name: p.name, tier: 'core', source: p.source, pin: p.pin, licence: p.licence })), ...cfg.added.map((p) => ({ name: p.name, tier: p.tier, source: p.source, pin: p.pin, licence: p.licence }))],
        notices,
        skills: skills.map((s) => ({ ...s, rungs: cfg.rungs.filter((r) => member(s, r)) })),
        excluded: excluded.sort((a, b) => byCodePoint(a.pack, b.pack) || byCodePoint(a.path, b.path)),
      }),
      'targets.json': json({
        schema_version: 1, seed: cfg.seeds.targets, pins_seed: cfg.seeds.pins, bins: targetCount, order: 'position is 1-based in code-point name order (what a byte-wise sort of folder names gives); position_locale is in the en locale order the catalog hash uses',
        quotas: largestRemainder(Object.fromEntries(Object.entries(Object.groupBy(skills.filter((s) => s.tier === 'core'), (s) => s.pack)).map(([k, v]) => [k, v!.length])), targetCount),
        targets_outside_their_bin: positions.filter((p) => !p.in_bin).length,
        quarters_by_rung: quarters, pins, targets: positions,
      }),
      'near-duplicates.json': json({
        schema_version: 1, method: 'TF-IDF cosine over the name (split on - _ .) plus the description, lower-cased, words of 2+ characters, a short stop list; idf = ln((1+N)/(1+df))+1; vectors L2-normalised',
        threshold: cfg.near_duplicate_threshold,
        counts: Object.fromEntries([0.5, 0.6, 0.7, 0.8, 0.9].filter((t) => t >= cfg.near_duplicate_threshold).map((t) => [t, nd.filter((p) => p.cosine >= t).length])),
        pairs_with_a_target: nd.filter((p) => targetSet.has(p.a) || targetSet.has(p.b)).length,
        pairs: nd.map((p) => ({ ...p, a_pack: bySkill.get(p.a)!.pack, b_pack: bySkill.get(p.b)!.pack, a_rung: rungOf(p.a), b_rung: rungOf(p.b) })),
      }),
      'safety-scan.json': json({
        schema_version: 1,
        scope: 'every added skill folder (the 351-skill rung is the frozen skill-resolver catalog and is not changed)',
        executable_rule: 'a non-Markdown file with a script or binary extension (safety.ts EXECUTABLE_EXTENSIONS), binary executable magic, a shebang line or an executable bit; such files are left out of the snapshot',
        patterns: Object.fromEntries(Object.entries(FETCH_AND_RUN).map(([k, v]) => [k, v.source])),
        summary: {
          added_skills: added.length, quarantined_files: quarantined.length, skills_with_quarantined_files: new Set(quarantined.map((q) => q.skill)).size,
          skills_with_markdown_hits: markdownHits.length, skills_with_hits_in_other_files: otherHits.length, skills_by_pattern: hitCounts,
          token_shape_hits: leaks.token_shapes.hits.length, gitleaks: leaks.gitleaks.run ? ('findings' in leaks.gitleaks ? leaks.gitleaks.findings.length : 'error') : 'not run', set_r: leaks.set_r.run ? leaks.set_r.hits.length : 'not run',
        },
        quarantined,
        markdown_hits: markdownHits.map((s) => ({ skill: s.skill, pack: s.pack, files: s.files.map((f) => ({ path: f.path, lines: f.hits.map((h) => h.line + ':' + h.patterns.join(',')) })) })),
        other_file_hits: otherHits.map((s) => ({ skill: s.skill, pack: s.pack, files: s.files.map((f) => ({ path: f.path, lines: f.hits.map((h) => h.line + ':' + h.patterns.join(',')) })) })),
        leak_scan: leaks,
      }),
    };
    records['hashes.json'] = json({ schema_version: 1, config_sha256: sha(JSON.stringify(cfg)), rungs, skills_by_pack: packSummary, uncommitted_sha256: Object.fromEntries(UNCOMMITTED.map((f) => [f, sha(records[f]!)])) });
    return { records, rungHashes };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const val = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const repo = resolve(import.meta.dir, '..', '..');
  const out = val('--out');
  try {
    if (val('--materialize')) {
      const dest = val('--dest');
      if (!out || !dest) throw new Error('usage: build-ladder.ts --materialize <rung> --out <snapshot> --dest <dir>');
      console.log('RUNG ' + val('--materialize') + ' ' + materialize(out, Number(val('--materialize')), dest) + ' ' + dest);
      process.exit(0);
    }
    const srcDir = val('--src');
    if (!out || !srcDir) throw new Error('usage: build-ladder.ts --src <dir> --out <snapshot> [--record <dir>] [--check] [--gitleaks] [--leak-set <file>]');
    const cfg = JSON.parse(readFileSync(join(import.meta.dir, 'packs-ladder.json'), 'utf8')) as LadderConfig;
    const corePacks = JSON.parse(readFileSync(join(repo, cfg.core.packs_file), 'utf8')).packs as Pack[];
    const dirs = Object.fromEntries([...corePacks, ...cfg.added].map((p) => [p.name, join(srcDir, p.name)]));
    const record = val('--record') ?? join(repo, 'tasks', 'skills-at-scale', 'catalog');
    const cache = join(process.env.HOME ?? tmpdir(), '.cache', 'harness-evals', 'public-safety', 'tools');
    const { records, rungHashes } = buildLadder(cfg, corePacks, dirs, out, {
      gitleaks: args.includes('--gitleaks') ? { cache, work: mkdtempSync(join(tmpdir(), 'ladder-gitleaks-')) } : undefined,
      setR: val('--leak-set'),
    });
    console.log('LADDER ' + Object.entries(rungHashes).map(([r, h]) => r + '=' + h).join(' '));
    const generated = join(out, 'records');
    mkdirSync(generated, { recursive: true });
    for (const f of UNCOMMITTED) writeFileSync(join(generated, f), records[f]!);
    console.log('GENERATED ' + UNCOMMITTED.join(' ') + ' in ' + generated);
    const committed = Object.entries(records).filter(([f]) => !UNCOMMITTED.includes(f));
    if (args.includes('--check')) {
      const differ = committed.filter(([f, body]) => !existsSync(join(record, f)) || readFileSync(join(record, f), 'utf8') !== body).map(([f]) => f);
      if (differ.length) { console.error('LADDER_MISMATCH ' + differ.join(' ')); process.exit(1); }
      console.log('LADDER_OK ' + record);
    } else {
      mkdirSync(record, { recursive: true });
      for (const [f, body] of committed) writeFileSync(join(record, f), body);
      console.log('RECORDED ' + committed.map(([f]) => f).join(' ') + ' in ' + record);
    }
  } catch (e) { console.error('HE-SKILLS-SCALE-001 ' + (e as Error).message); process.exit(2); }
}
