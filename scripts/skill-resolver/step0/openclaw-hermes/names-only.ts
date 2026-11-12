#!/usr/bin/env bun
// internal-task Step 0: names-only catalog copy. Copies <catalog>/skills to <out>/skills and replaces each SKILL.md's frontmatter
// description with the skill's frontmatter name (the body and every other file are unchanged). Exits 1 if any rewritten
// frontmatter does not parse back to description === name.
//
//   bun scripts/skill-resolver/step0/openclaw-hermes/names-only.ts --catalog <catalog dir> --out <dir>

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const catalog = arg('catalog');
const out = arg('out');
if (!catalog || !out) { console.error('usage: names-only.ts --catalog <dir> --out <dir>'); process.exit(64); }
const yaml = (s: string) => (Bun as unknown as { YAML: { parse(s: string): unknown } }).YAML.parse(s) as Record<string, unknown>;

if (existsSync(out)) rmSync(out, { recursive: true });
cpSync(join(catalog, 'skills'), join(out, 'skills'), { recursive: true });
let changed = 0;
const bad: string[] = [];
for (const dir of readdirSync(join(out, 'skills')).sort()) {
  const p = join(out, 'skills', dir, 'SKILL.md');
  const text = readFileSync(p, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) { bad.push(`${dir}: no frontmatter`); continue; }
  const lines = m[1]!.split(/\r?\n/);
  const name = String(yaml(m[1]!).name ?? dir).trim();
  const kept: string[] = [];
  let inserted = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^description\s*:/.test(lines[i]!)) {
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]!) || lines[i + 1]!.trim() === '')) i++;
      kept.push(`description: ${JSON.stringify(name)}`);
      inserted = true;
      continue;
    }
    kept.push(lines[i]!);
  }
  if (!inserted) kept.push(`description: ${JSON.stringify(name)}`);
  const fm = kept.join('\n');
  const next = text.slice(0, m.index) + '---\n' + fm + '\n---' + text.slice(m.index + m[0].length);
  try {
    const doc = yaml(fm);
    if (doc.description !== name || String(doc.name ?? dir).trim() !== name) bad.push(`${dir}: reparse gives description=${String(doc.description)}`);
  } catch (e) { bad.push(`${dir}: ${(e as Error).message}`); }
  writeFileSync(p, next);
  changed++;
}
console.log(`NAMES_ONLY skills=${changed} bad=${bad.length} out=${out}`);
for (const b of bad) console.error(`  ${b}`);
process.exit(bad.length ? 1 : 0);
