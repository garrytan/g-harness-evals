#!/usr/bin/env bun
// Builds the public skill catalog for the skill-resolver eval (internal-task, docs/benchmarks/2026-11-08-skill-resolver/PREREGISTRATION.md).
//
//   bun scripts/skill-resolver/build-catalog.ts --out <dir> --pack gstack=<checkout> --pack openclaw=<package dir>
//       --pack hermes=<checkout> --pack qm=<checkout> [--check]
//
// Each pack's source is pinned in scripts/skill-resolver/packs.json (repository or npm package, commit or version, the
// roots its skills live under). The builder refuses a checkout at another commit or a package at another version. It
// copies every skill directory (symbolic links, files over 1 MiB, nested skills and, for a git-pinned pack, files the
// checkout does not track, such as build output, are left out and listed; a skill at a
// pack root, such as gstack's router, keeps only its SKILL.md), drops the paths a pack's exclude list names, renames skills whose name
// collides across packs to <pack>-<name> (frontmatter name rewritten), records each skill's licence (frontmatter
// license:, a LICENSE file in the skill directory, else the pack's licence) and writes manifest.json with a sha256 per
// file and the catalog hash. The catalog hash is the sha256 of one line per skill, sorted by name:
// <name> TAB <sha256 of its SKILL.md> TAB <sha256 of its sorted file list with hashes>. --check rebuilds into a temporary
// directory and exits 1 when the result differs from <out>.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

type Pack = { name: string; source: string; pin: { commit?: string; version?: string }; roots: string[]; licence: string; exclude?: string[] };
type SkillFile = { path: string; sha256: string; bytes: number };
export type CatalogSkill = {
  name: string; pack: string; original_name: string; renamed: boolean; source_path: string; description: string;
  licence: string; licence_file: string | null; skill_md_sha256: string; dir_sha256: string; files: SkillFile[]; skipped: { path: string; reason: string }[];
};
export type Manifest = { schema_version: 1; catalog_hash: string; skill_count: number; packs: (Pack & { resolved: string })[]; skills: CatalogSkill[]; excluded: { pack: string; path: string; reason: string }[] };

const MAX_FILE_BYTES = 1024 * 1024;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

export function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  try {
    const doc = (Bun as unknown as { YAML: { parse(s: string): unknown } }).YAML.parse(m[1]!) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(doc ?? {})) if (typeof v === 'string') out[k] = v.trim();
    return out;
  } catch {
    const out: Record<string, string> = {};
    for (const line of m[1]!.split('\n')) { const kv = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line); if (kv) out[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, '').trim(); }
    return out;
  }
}

export function renameFrontmatter(text: string, name: string): string {
  return text.replace(/^(---\r?\n[\s\S]*?^)name:[^\n]*$/m, `$1name: ${name}`);
}

function listSkillDirs(root: string, exclude: string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === 'SKILL.md' && !exclude.some((x) => relative(root, dir) === x || relative(root, dir).startsWith(`${x}/`))) found.push(dir);
    }
  };
  walk(root, 0);
  return found.sort();
}

function copyDir(src: string, dest: string, skipped: { path: string; reason: string }[], base = src, onlySkillMd = false, tracked: ((abs: string) => boolean) | null = null): SkillFile[] {
  const files: SkillFile[] = [];
  if (onlySkillMd) {
    const buf = readFileSync(join(src, 'SKILL.md'));
    mkdirSync(dest, { recursive: true });
    copyFileSync(join(src, 'SKILL.md'), join(dest, 'SKILL.md'));
    skipped.push({ path: '.', reason: 'pack root: only SKILL.md is copied' });
    return [{ path: 'SKILL.md', sha256: sha(buf), bytes: buf.length }];
  }
  for (const e of readdirSync(src, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const p = join(src, e.name);
    const rel = relative(base, p);
    if (e.name === 'node_modules' || e.name === '.git') { skipped.push({ path: rel, reason: 'vendored directory' }); continue; }
    if (lstatSync(p).isSymbolicLink()) { skipped.push({ path: rel, reason: 'symbolic link' }); continue; }
    if (e.isDirectory()) {
      if (existsSync(join(p, 'SKILL.md')) && p !== base) { skipped.push({ path: rel, reason: 'nested skill (listed on its own)' }); continue; }
      files.push(...copyDir(p, join(dest, e.name), skipped, base, false, tracked));
      continue;
    }
    if (tracked && !tracked(p)) { skipped.push({ path: rel, reason: 'not tracked in the pinned checkout' }); continue; }
    const buf = readFileSync(p);
    if (buf.length > MAX_FILE_BYTES) { skipped.push({ path: rel, reason: `over ${MAX_FILE_BYTES} bytes` }); continue; }
    mkdirSync(dest, { recursive: true });
    copyFileSync(p, join(dest, e.name));
    files.push({ path: rel, sha256: sha(buf), bytes: buf.length });
  }
  return files;
}

function resolvePin(pack: Pack, dir: string): string {
  if (pack.pin.commit) {
    const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (head !== pack.pin.commit) throw new Error(`pack ${pack.name}: ${dir} is at ${head}, packs.json pins ${pack.pin.commit}`);
    return head;
  }
  const version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version as string;
  if (version !== pack.pin.version) throw new Error(`pack ${pack.name}: ${dir} is version ${version}, packs.json pins ${pack.pin.version}`);
  return version;
}

export function build(packs: Pack[], dirs: Record<string, string>, out: string): Manifest {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'skills'), { recursive: true });
  const raw: { pack: Pack; dir: string; fm: Record<string, string>; text: string }[] = [];
  const excluded: Manifest['excluded'] = [];
  const resolved: Manifest['packs'] = [];
  for (const pack of packs) {
    const root = dirs[pack.name];
    if (!root) throw new Error(`no --pack ${pack.name}=<dir> given`);
    resolved.push({ ...pack, resolved: resolvePin(pack, root) });
    for (const r of pack.roots) {
      for (const dir of listSkillDirs(join(root, r), pack.exclude ?? [])) {
        const text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
        const fm = parseFrontmatter(text);
        const where = relative(root, dir);
        if (!fm.name || !fm.description) { excluded.push({ pack: pack.name, path: where, reason: 'frontmatter has no name or description' }); continue; }
        raw.push({ pack, dir, fm, text });
      }
    }
  }
  const trackedBy = new Map<string, (abs: string) => boolean>();
  for (const pack of packs) {
    if (!pack.pin.commit) continue;
    const root = dirs[pack.name]!;
    const set = new Set(execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\0').filter(Boolean));
    trackedBy.set(pack.name, (abs) => set.has(relative(root, abs)));
  }
  const owners = new Map<string, Set<string>>();
  for (const s of raw) owners.set(s.fm.name!, (owners.get(s.fm.name!) ?? new Set()).add(s.pack.name));
  const seen = new Set<string>();
  const skills: CatalogSkill[] = [];
  for (const s of raw) {
    const original = s.fm.name!;
    const renamed = owners.get(original)!.size > 1;
    let name = renamed ? `${s.pack.name}-${original}` : original;
    if (seen.has(name)) { excluded.push({ pack: s.pack.name, path: relative(dirs[s.pack.name]!, s.dir), reason: `duplicate name ${name} within the pack` }); continue; }
    seen.add(name);
    const dest = join(out, 'skills', name);
    const skipped: { path: string; reason: string }[] = [];
    const files = copyDir(s.dir, dest, skipped, s.dir, s.pack.roots.some((r) => join(dirs[s.pack.name]!, r) === s.dir), trackedBy.get(s.pack.name) ?? null);
    let skillMd = readFileSync(join(dest, 'SKILL.md'), 'utf8');
    if (renamed) { skillMd = renameFrontmatter(skillMd, name); writeFileSync(join(dest, 'SKILL.md'), skillMd); }
    const mdSha = sha(skillMd);
    const fileList = files.map((f) => f.path === 'SKILL.md' ? { ...f, sha256: mdSha, bytes: Buffer.byteLength(skillMd) } : f);
    const licenceFile = fileList.find((f) => /^licen[cs]e(\.(txt|md))?$/i.test(f.path))?.path ?? null;
    skills.push({
      name, pack: s.pack.name, original_name: original, renamed, source_path: relative(dirs[s.pack.name]!, s.dir),
      description: s.fm.description!, licence: s.fm.license ?? (licenceFile ? 'see licence file' : s.pack.licence), licence_file: licenceFile,
      skill_md_sha256: mdSha, dir_sha256: sha(fileList.map((f) => `${f.path}\t${f.sha256}`).join('\n')), files: fileList, skipped,
    });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const catalog_hash = sha(skills.map((s) => `${s.name}\t${s.skill_md_sha256}\t${s.dir_sha256}`).join('\n'));
  const manifest: Manifest = { schema_version: 1, catalog_hash, skill_count: skills.length, packs: resolved, skills, excluded };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  return manifest;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const val = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const out = val('--out');
  if (!out) { console.error('usage: build-catalog.ts --out <dir> --pack <name>=<dir>... [--check]'); process.exit(2); }
  const dirs: Record<string, string> = {};
  args.forEach((a, i) => { if (a === '--pack') { const [k, v] = args[i + 1]!.split('='); dirs[k!] = v!; } });
  const packs = JSON.parse(readFileSync(join(dirname(import.meta.path), 'packs.json'), 'utf8')).packs as Pack[];
  try {
    if (args.includes('--check')) {
      const tmp = mkdtempSync(join(tmpdir(), 'catalog-check-'));
      const fresh = build(packs, dirs, tmp);
      const kept = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as Manifest;
      rmSync(tmp, { recursive: true, force: true });
      if (fresh.catalog_hash !== kept.catalog_hash) { console.error(`CATALOG_MISMATCH rebuilt ${fresh.catalog_hash}, kept ${kept.catalog_hash}`); process.exit(1); }
      console.log(`CATALOG_OK ${kept.catalog_hash} skills=${kept.skill_count}`);
    } else {
      const m = build(packs, dirs, out);
      const byPack = Object.entries(Object.groupBy(m.skills, (s) => s.pack)).map(([k, v]) => `${k}=${v!.length}`).join(' ');
      console.log(`CATALOG ${m.catalog_hash} skills=${m.skill_count} ${byPack} renamed=${m.skills.filter((s) => s.renamed).length} excluded=${m.excluded.length}`);
    }
  } catch (e) { console.error(`HE-SKILLS-001 ${(e as Error).message}`); process.exit(2); }
}
