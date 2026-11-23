#!/usr/bin/env bun
// QM's place in the keyless skill listing map (internal-task-a, internal-task-b). QM has a native arm only. For each rung of a catalog
// ladder: the rung staged as a QM catalog (manifest.json with catalog_hash), its names-only copy
// (scripts/skill-resolver/step0/qm/names-only.ts, each description set to the skill's name), the two probe images from
// scripts/skill-resolver/step0/qm/Dockerfile.qm-catalog on the pinned, unchanged harness-eval/qm:dev, and one keyless cell
// each through scripts/skill-resolver/step0/qm/qm-listing.ts (fake Responses upstream, capture dummy keys, no spend; on the
// Anthropic route that script also PUTs the catalog to QM's deployment-layer API, which answers 413 payload_too_large from
// 351 synthetic skills, about 2.4 MB, and breaks the turn that follows, so the map uses the OpenAI route). Then
// every catalog skill gets its place in QM's "## Skills" block, as listing-map.ts places them: listed with at least 40
// characters of its description, by name only, or installed (QM's admin skills list) but not shown, or not installed.
// The names-only cell answers whether names alone fit QM's 12,000-character budget (src/skills/materialize.ts:127).
// --route says how QM gets the catalog. deployment-layer (the default) is the probe images as built: env
// DEPLOYMENT_LAYER=/opt/catalog-layer. plugin-dirs changes only the environment of those same images (one ENV layer, no file
// added): DEPLOYMENT_LAYER empty, so QM skips the layer, and PLUGIN_SKILLS_DIRS=/app/plugins/onboarding/skills,
// /opt/catalog-layer/skills, QM's own default plugin folder kept and the catalog read as a plugin skills folder (src/config.ts:651,
// csvPaths :292-300, defaultPluginSkillDirs :332). The map counts installed skills from QM's admin list whoever created them.
//
//   bun scripts/skills-at-scale/qm-listing-map.ts --ladder <dir with <size>/skills> --out <dir> [--sizes 100,351,700,1500]
//       [--route deployment-layer|plugin-dirs]
//
// Writes <out>/<size>/ (the qm-listing.ts cells), <out>/qm-map.json and <out>/qm-map.md.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PLACES, place, type Place } from './listing-map.ts';
import { parseBlock } from '../skill-resolver/step0/qm/qm-listing.ts';

const REPO = resolve(import.meta.dir, '..', '..');
const ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
const run = (cmd: string[], what: string) => {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { encoding: 'utf8', env: ENV, cwd: REPO, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(what + ' failed (exit ' + r.status + '): ' + ((r.stderr ?? '') + (r.stdout ?? '')).slice(-800));
  return r.stdout;
};

type Skill = { name: string; description: string; target?: boolean };
export const QM_ROUTES = { 'deployment-layer': null, 'plugin-dirs': 'ENV DEPLOYMENT_LAYER= PLUGIN_SKILLS_DIRS=/app/plugins/onboarding/skills,/opt/catalog-layer/skills' } as const;
export type QmRoute = keyof typeof QM_ROUTES;
export type QmCell = { harness: 'qm'; config: 'native' | 'names-only'; size: number; counts: Record<Place, number>; targets: Record<Place, number>;
  listing_chars: number; catalog_listed: number; qm_skills_listed: number; left_out: number; shortened: number; preamble: string; error: string | null };

export function qmCell(size: number, config: QmCell['config'], catalog: Skill[], block: string, installed: Set<string>, summary: { notes?: { left_out?: number; shortened?: number; error?: string | null } }): QmCell {
  const { preamble, entries } = parseBlock(block);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const counts = Object.fromEntries(PLACES.map((p) => [p, 0])) as Record<Place, number>;
  const targets = { ...counts };
  for (const s of catalog) {
    const e = byName.get(s.name);
    const p = place(e ? { name: s.name, shown: e.desc ?? '', location: null, catalog: true } : undefined, config === 'names-only' ? s.name : s.description, installed, s.name);
    counts[p]++;
    if (s.target) targets[p]++;
  }
  const names = new Set(catalog.map((s) => s.name));
  return { harness: 'qm', config, size, counts, targets, listing_chars: block.length, catalog_listed: entries.filter((e) => names.has(e.name)).length,
    qm_skills_listed: entries.filter((e) => !names.has(e.name)).length, left_out: summary.notes?.left_out ?? 0, shortened: summary.notes?.shortened ?? 0, preamble, error: summary.notes?.error ?? null };
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const ladder = resolve(v('--ladder') ?? ''), out = resolve(v('--out') ?? '');
  if (!v('--ladder') || !v('--out')) { console.error('usage: qm-listing-map.ts --ladder <dir> --out <dir> [--sizes 100,351,700,1500]'); process.exit(2); }
  const sizes = (v('--sizes') ?? '100,351,700,1500').split(',').map(Number);
  const route = (v('--route') ?? 'deployment-layer') as QmRoute;
  if (!(route in QM_ROUTES)) { console.error('--route is deployment-layer or plugin-dirs'); process.exit(2); }
  const cells: QmCell[] = [];
  for (const size of sizes) {
    const rung = join(ladder, String(size));
    const m = JSON.parse(readFileSync(join(rung, 'manifest.json'), 'utf8')) as { catalog_sha256: string; skills: Skill[] };
    const stage = join(out, String(size), 'catalog'), names = join(out, String(size), 'catalog-names-only');
    rmSync(stage, { recursive: true, force: true });
    cpSync(join(rung, 'skills'), join(stage, 'skills'), { recursive: true });
    writeFileSync(join(stage, 'manifest.json'), JSON.stringify({ catalog_hash: m.catalog_sha256, skills: m.skills.map((s) => ({ name: s.name, pack: 'synthetic', description: s.description })) }, null, 1) + '\n');
    run(['bun', 'scripts/skill-resolver/step0/qm/names-only.ts', '--catalog', stage, '--out', names], 'names-only copy');
    const df = 'scripts/skill-resolver/step0/qm/Dockerfile.qm-catalog';
    run(['docker', 'build', '-q', '-f', df, '--target', 'native', '-t', 'harness-eval/qm:harn52-native', stage], 'docker build native');
    run(['docker', 'build', '-q', '-f', df, '--target', 'native', '-t', 'harness-eval/qm:harn52-names-only', names], 'docker build names-only');
    const envLayer = QM_ROUTES[route];
    if (envLayer) for (const t of ['harness-eval/qm:harn52-native', 'harness-eval/qm:harn52-names-only']) {
      run(['docker', 'tag', t, t + '-src'], 'docker tag ' + t);
      const r = spawnSync('docker', ['build', '-q', '-t', t, '-'], { encoding: 'utf8', env: ENV, input: 'FROM ' + t + '-src\n' + envLayer + '\n' });
      if (r.status !== 0) throw new Error('docker build ' + route + ' ' + t + ' failed: ' + (r.stderr ?? '').slice(-800));
    }
    const cellsDir = join(out, String(size), 'cells');
    console.log(run(['bun', 'scripts/skill-resolver/step0/qm/qm-listing.ts', '--catalog', stage, '--configs', 'native,names-only', '--providers', 'openai', '--out', cellsDir], 'qm-listing.ts ' + size).trim());
    for (const config of ['native', 'names-only'] as const) {
      const dir = join(cellsDir, 'qm-openai-' + config);
      const block = existsSync(join(dir, 'skills-block.txt')) ? readFileSync(join(dir, 'skills-block.txt'), 'utf8') : '';
      let installed = new Set<string>();
      try { installed = new Set(((JSON.parse(readFileSync(join(dir, 'admin-skills.json'), 'utf8')) as { skills?: { name: string; status: string }[] }).skills ?? []).filter((s) => s.status === 'published').map((s) => s.name)); } catch { /* none installed */ }
      const c = { ...qmCell(size, config, m.skills, block, installed, JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))), route };
      const cap = JSON.parse(readFileSync(join(dir, 'capture.json'), 'utf8')) as { requests?: { agent?: number }; turn?: { http?: number } };
      if (!c.error && !cap.requests?.agent) c.error = 'no agent request captured (turn http ' + (cap.turn?.http ?? null) + ')';
      if (c.error) { console.error('QM ' + config + ' ' + size + ' failed: ' + c.error); process.exit(1); }
      cells.push(c);
      console.log('QM ' + config + ' ' + size + ' ' + JSON.stringify(c.counts) + ' targets=' + JSON.stringify(c.targets) + ' chars=' + c.listing_chars + ' left_out=' + c.left_out);
    }
  }
  writeFileSync(join(out, 'qm-map.json'), JSON.stringify({ schema_version: 1, harness: 'qm', pin: 'main@90e4ced7', budget_chars: 12_000, route, route_env: QM_ROUTES[route], cells }, null, 1) + '\n');
  const fmt = (n: number) => n.toLocaleString('en-US');
  writeFileSync(join(out, 'qm-map.md'), '# QM in the skill listing map (keyless)\n\nQM (main@90e4ced7, Pi inside) lists skills in a "## Skills" block of the system prompt, capped at 12,000 characters. The names-only cell is the same catalog with each description replaced by the skill\'s name, so it shows whether names alone fit. Route: ' + (route === 'plugin-dirs' ? 'PLUGIN_SKILLS_DIRS (the probe images with only their environment changed: ' + QM_ROUTES[route] + ')' : 'DEPLOYMENT_LAYER=/opt/catalog-layer, a filesystem layer QM reads at boot') + '.\n\n| Config | Skills | With description | Name only | Installed, not shown | Not installed | Targets listed | Block chars | Left out |\n|---|---|---|---|---|---|---|---|---|\n' +
    cells.map((c) => '| ' + c.config + ' | ' + c.size + ' | ' + c.counts.with_description + ' | ' + c.counts.name_only + ' | ' + c.counts.loaded_not_shown + ' | ' + c.counts.not_loaded + ' | ' + (c.targets.with_description + c.targets.name_only) + ' of ' + PLACES.reduce((s, p) => s + c.targets[p], 0) + ' | ' + fmt(c.listing_chars) + ' | ' + c.left_out + ' |').join('\n') + '\n');
}
