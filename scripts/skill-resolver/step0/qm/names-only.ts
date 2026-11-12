#!/usr/bin/env bun
// internal-task Step 0: copy a built catalog and replace each SKILL.md frontmatter description with the skill's name.
//   bun scripts/skill-resolver/step0/qm/names-only.ts --catalog <catalog dir> --out <dir>
// Only the description key changes; every other byte of every file is copied as is. The copy's manifest.json lists
// each skill's new SKILL.md sha256 and the catalog it came from.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { parseFrontmatter } from '../../build-catalog.ts';

export function namesOnly(text: string, name: string): string {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
  if (!m) throw new Error('no frontmatter');
  const lines = m[2]!.split('\n');
  const out: string[] = [];
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (!/^description:/.test(lines[i]!)) { out.push(lines[i]!); continue; }
    while (i + 1 < lines.length && (lines[i + 1]!.trim() === '' || /^[ \t]/.test(lines[i + 1]!))) i++;
    out.push('description: ' + name);
    replaced = true;
  }
  if (!replaced) throw new Error('no top-level description key');
  return m[1]! + out.join('\n') + text.slice(m[1]!.length + m[2]!.length);
}

if (import.meta.main) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const catalog = resolve(arg('--catalog') ?? ''), out = resolve(arg('--out') ?? '');
  if (!existsSync(join(catalog, 'manifest.json')) || !arg('--out')) { console.error('usage: names-only.ts --catalog <built catalog> --out <dir>'); process.exit(2); }
  const source = JSON.parse(readFileSync(join(catalog, 'manifest.json'), 'utf8')) as { catalog_hash: string; skills: { name: string }[] };
  rmSync(out, { recursive: true, force: true });
  cpSync(join(catalog, 'skills'), join(out, 'skills'), { recursive: true });
  const skills: { name: string; skill_md_sha256: string }[] = [];
  for (const name of readdirSync(join(out, 'skills')).sort()) {
    const path = join(out, 'skills', name, 'SKILL.md');
    const next = namesOnly(readFileSync(path, 'utf8'), name);
    const fm = parseFrontmatter(next);
    if (fm.name !== name || fm.description !== name) throw new Error(name + ': rewrite check failed (name ' + fm.name + ', description ' + fm.description + ')');
    writeFileSync(path, next);
    skills.push({ name, skill_md_sha256: createHash('sha256').update(next).digest('hex') });
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ schema_version: 1, transform: 'names-only: description := name', source_catalog_hash: source.catalog_hash, skill_count: skills.length, skills }, null, 1) + '\n');
  console.log('NAMES_ONLY skills=' + skills.length + ' from ' + source.catalog_hash);
}
