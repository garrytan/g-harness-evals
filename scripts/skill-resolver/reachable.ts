#!/usr/bin/env bun
// Builds the per-harness reachable skill sets for the skill-resolver eval (internal-task) from the Step 0 probe summaries.
// A catalog skill is reachable in a harness and arm when the harness loaded it and did not hide it: every catalog name
// minus the summary's `ineligible` list (missing requirements, conditions, connector filters, discovery cuts, and skills
// a harness loads but never shows the model). The resolver arms share the native set, because the index holds only what
// the harness installed. Output: {catalog_hash, harnesses: {<harness>: {<arm>: [names]}}, excluded: {...: [{name, reason}]}}.
//
//   bun scripts/skill-resolver/reachable.ts --catalog <dir> --out <reachable.json> <summary.json>...

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ARM: Record<string, string> = { native: 'native', 'names-only': 'names-only' };

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const catalog = v('--catalog'); const out = v('--out');
  const files = a.filter((x, i) => !x.startsWith('--') && a[i - 1] !== '--catalog' && a[i - 1] !== '--out');
  if (!catalog || !out || !files.length) { console.error('usage: reachable.ts --catalog <dir> --out <file> <summary.json>...'); process.exit(2); }
  const m = JSON.parse(readFileSync(join(catalog, 'manifest.json'), 'utf8')) as { catalog_hash: string; skills: { name: string }[] };
  const all = m.skills.map((s) => s.name).sort();
  const harnesses: Record<string, Record<string, string[]>> = {};
  const excluded: Record<string, { name: string; reason: string }[]> = {};
  for (const f of files) {
    const s = JSON.parse(readFileSync(f, 'utf8')) as { harness: string; config: string; ineligible?: { name: string; reason: string }[] };
    const arm = ARM[s.config];
    if (!arm) continue;
    const bad = (s.ineligible ?? []).filter((x) => all.includes(x.name));
    const set = all.filter((n) => !bad.some((x) => x.name === n));
    const prev = harnesses[s.harness]?.[arm];
    if (prev && prev.join() !== set.join()) { console.error('HE-SKILLS-020 providers disagree for ' + s.harness + ' ' + arm); process.exit(1); }
    (harnesses[s.harness] ??= {})[arm] = set;
    excluded[s.harness + ':' + arm] = bad.sort((x, y) => x.name.localeCompare(y.name));
  }
  writeFileSync(out, JSON.stringify({ catalog_hash: m.catalog_hash, harnesses, excluded }, null, 1) + '\n');
  console.log('REACHABLE ' + Object.entries(harnesses).map(([h, arms]) => Object.entries(arms).map(([k, l]) => h + ':' + k + '=' + l.length).join(' ')).join(' '));
}
