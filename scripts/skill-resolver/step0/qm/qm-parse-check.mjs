import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const { parseSeedSkill } = await import('/app/src/skills/seed.ts');
const dirs = process.argv.slice(2);
const out = [];
for (const d of dirs) for (const e of readdirSync(d).sort()) {
  const p = join(d, e, 'SKILL.md');
  if (!existsSync(p)) continue;
  try { const m = parseSeedSkill(readFileSync(p, 'utf8')); out.push({ dir: d, entry: e, name: m.name, desc_chars: m.description.length, desc: m.description }); }
  catch (err) { out.push({ dir: d, entry: e, error: String(err.message) }); }
}
console.log(JSON.stringify(out));
