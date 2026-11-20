// Keyless checks of the skills-at-scale pin files (internal-task): packs-ladder.json pins every added pack to a full commit
// under an allowed licence and matches the config hash the committed catalog was built from, fetch-packs.ts refuses to
// run without --dest, and power-design.json is the design file power.ts reads.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LadderConfig } from '../scripts/skills-at-scale/build-ladder.ts';
import { DESIGN_FILE } from '../scripts/skills-at-scale/power.ts';

const repo = join(import.meta.dir, '..');
const ladder = JSON.parse(readFileSync(join(repo, 'scripts/skills-at-scale/packs-ladder.json'), 'utf8')) as LadderConfig;

describe('skills-at-scale pin files', () => {
  test('packs-ladder.json pins every added pack to a full commit, once, under an allowed licence', () => {
    expect(ladder.added.length).toBeGreaterThan(0);
    expect(new Set(ladder.added.map((p) => p.name)).size).toBe(ladder.added.length);
    for (const p of ladder.added) {
      expect(p.pin.commit ?? '').toMatch(/^[0-9a-f]{40}$/);
      if (p.licence !== 'per-skill') expect(ladder.allowed_licences).toContain(p.licence);
    }
    expect(existsSync(join(repo, ladder.core.packs_file))).toBe(true);
  });

  test('packs-ladder.json is the config the committed catalog hashes were built from', () => {
    const hashes = JSON.parse(readFileSync(join(repo, 'tasks/skills-at-scale/catalog/hashes.json'), 'utf8'));
    expect(createHash('sha256').update(JSON.stringify(ladder)).digest('hex')).toBe(hashes.config_sha256);
    expect(hashes.rungs[String(ladder.core.skill_count)].catalog_hash).toBe(ladder.core.catalog_hash);
  });

  test('fetch-packs.ts refuses to run without --dest', () => {
    const r = spawnSync(process.execPath, ['scripts/skills-at-scale/fetch-packs.ts'], { cwd: repo, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir() }, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage: fetch-packs.ts --dest');
  });

  test('power.ts reads scripts/skills-at-scale/power-design.json', () => {
    expect(DESIGN_FILE).toBe(join(repo, 'scripts/skills-at-scale/power-design.json'));
    const design = JSON.parse(readFileSync(DESIGN_FILE, 'utf8'));
    expect(Object.keys(design.harnesses).length).toBeGreaterThan(0);
  });
});
