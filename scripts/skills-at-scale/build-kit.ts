#!/usr/bin/env bun
// The skills-at-scale kit and its images (internal-task-a, internal-task-b). The kit is one directory the arms read in the container at
// /opt/skills-at-scale (HE_SAS_DIR overrides it): bun/ (gbrain installed the way its README says, bun install -g
// github:garrytan/gbrain#<tag>, at the release --gbrain or SAS_GBRAIN_TAG names, else scripts/skills-at-scale/gbrain-pin.json's, with Bun from the pinned
// oven/bun image at /usr/local/bin/bun), bin/sas-arm (scripts/skills-at-scale/arm.ts, compiled), catalog/skills and
// catalog/manifest.json (one rung), pins.json, kit.json and system-preamble.md (the task preamble's fixed text, for the Hermes
// -system-preamble arms).
//
//   bun scripts/skills-at-scale/build-kit.ts --catalog <rung dir with skills/> --out <kit dir> [--pins <file>]
//       [--gbrain <tag>] [--image <harness>[,<harness>...] --tag <tag> [--from <image tag>]]
//
// The compiled release asset (pinnedGbrain, downloaded with gh into ~/.capy/work/skills-at-scale/gbrain/<tag>/ and checked
// against the pin's sha256) is only for ranking offline on the host. Without --pins the kit pins 20 skills: a seeded pick of the catalog's target skills (all
// skills when the manifest marks none), each with a line cut from its description (the plan's decision D policy).
// --image builds harness-eval/<h>:sas-base (harness-eval/<h>:dev, or :<from> into sas-base-<from>, plus Bun, gbrain and bin/) and
// harness-eval/<h>:sas-<tag> (sas-base plus the catalog and the json files).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { systemPreamble } from './arm.ts';

const HERE = import.meta.dir;
export const KIT_DIR = '/opt/skills-at-scale';
export const PIN = JSON.parse(readFileSync(join(HERE, 'gbrain-pin.json'), 'utf8')) as { repo: string; tag: string; version: string; commit: string; install: string; bun_image: string; asset: string; sha256: string; openclaw_min_version: string };
/** The gbrain release a kit installs: --gbrain <tag> (or SAS_GBRAIN_TAG), else gbrain-pin.json's tag, so a newer release drops in without an edit. */
export const gbrainRelease = (tag?: string) => { const t = tag || process.env.SAS_GBRAIN_TAG || PIN.tag; return { tag: t, version: t.replace(/^v/, ''), pinned: t === PIN.tag }; };
const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };

function run(cmd: string[], what: string, input?: string) {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { encoding: 'utf8', env: ENV, input, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(what + ' failed (exit ' + r.status + '): ' + ((r.stderr ?? '') + (r.stdout ?? '')).slice(-800));
  return r.stdout;
}

/** The pinned gbrain binary, downloaded once and checked against the pin. */
export function pinnedGbrain(): string {
  const dir = join(homedir(), '.capy/work/skills-at-scale/gbrain', PIN.tag);
  const file = join(dir, PIN.asset);
  if (!existsSync(file)) { mkdirSync(dir, { recursive: true }); run(['gh', 'release', 'download', PIN.tag, '-R', PIN.repo, '-p', PIN.asset, '-D', dir, '--clobber'], 'downloading ' + PIN.repo + ' ' + PIN.tag); }
  const got = sha256(readFileSync(file));
  if (got !== PIN.sha256) throw new Error(file + ' has sha256 ' + got + ', gbrain-pin.json says ' + PIN.sha256);
  return file;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export type Pin = { id: string; line: string };
/** The pins policy: the ladder's recorded pins when the catalog marks them, else n of the target skills by a seeded pick, each
 *  with a trigger-first line of at most 100 characters and no < or >. */
export function drawPins(skills: { name: string; description: string; target?: boolean; pin?: boolean }[], n = 20, seed = 20261119): Pin[] {
  const pool = skills.some((s) => s.pin) ? skills.filter((s) => s.pin) : skills.some((s) => s.target) ? skills.filter((s) => s.target) : skills;
  const r = rng(seed);
  const order = pool.map((s) => ({ s, k: r() })).sort((a, b) => a.k - b.k).slice(0, Math.min(n, pool.length)).map((x) => x.s);
  return order.sort((a, b) => (a.name < b.name ? -1 : 1)).map((s) => {
    const d = s.description.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
    return { id: s.name, line: d.length <= 100 ? d : d.slice(0, 99).replace(/\s+\S*$/, '') + '.' };
  });
}

/** The catalog's skills from manifest.json, or read from each SKILL.md's front matter when there is none (a real ladder rung). */
export function readCatalog(rung: string): { name: string; description: string; target?: boolean; pin?: boolean }[] {
  const m = join(rung, 'manifest.json');
  if (existsSync(m)) return (JSON.parse(readFileSync(m, 'utf8')) as { skills: { name: string; description: string; target?: boolean; pin?: boolean }[] }).skills;
  return readdirSync(join(rung, 'skills')).sort().flatMap((name) => {
    const f = join(rung, 'skills', name, 'SKILL.md');
    if (!existsSync(f)) return [];
    const fm = /^---\n([\s\S]*?)\n---/.exec(readFileSync(f, 'utf8'))?.[1] ?? '';
    const desc = /^description:\s*(.*)$/m.exec(fm)?.[1]?.trim() ?? '';
    return [{ name, description: desc.startsWith('"') ? (() => { try { return JSON.parse(desc) as string; } catch { return desc; } })() : desc }];
  });
}

/** Every file the kit copies, by path under skills/ and content, so a supporting file changes the digest as SKILL.md does. */
export function catalogSha(rung: string): string {
  const skills = join(rung, 'skills');
  const files = (rel: string): string[] => readdirSync(join(skills, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(rel, e.name)) : [join(rel, e.name)]));
  return sha256(files('').sort().map((f) => f + ' ' + sha256(readFileSync(join(skills, f)))).join('\n'));
}

export function buildKit(o: { catalog: string; out: string; pins?: string; gbrain?: string }): Record<string, unknown> {
  const out = resolve(o.out), holds = (p: string) => p === out || p.startsWith(out + '/');
  if (holds(resolve(o.catalog)) || holds(resolve(HERE, '..', '..'))) throw new Error('--out ' + out + ' holds the catalog or this checkout, and the build replaces it; pick a kit folder of its own');
  rmSync(o.out, { recursive: true, force: true });
  mkdirSync(join(o.out, 'bin'), { recursive: true });
  mkdirSync(join(o.out, 'catalog'), { recursive: true });
  run(['bun', 'build', '--compile', '--target=bun-linux-x64', join(HERE, 'arm.ts'), '--outfile', join(o.out, 'bin', 'sas-arm')], 'compiling arm.ts');
  cpSync(join(o.catalog, 'skills'), join(o.out, 'catalog', 'skills'), { recursive: true });
  const skills = readCatalog(o.catalog);
  if (existsSync(join(o.catalog, 'manifest.json'))) copyFileSync(join(o.catalog, 'manifest.json'), join(o.out, 'catalog', 'manifest.json'));
  const pins: Pin[] = o.pins ? JSON.parse(readFileSync(o.pins, 'utf8')) : drawPins(skills);
  writeFileSync(join(o.out, 'pins.json'), JSON.stringify(pins, null, 1) + '\n');
  writeFileSync(join(o.out, 'system-preamble.md'), systemPreamble(readFileSync(join(HERE, '../../tasks/multiuser/_shared/preamble.md'), 'utf8')));
  const g = gbrainRelease(o.gbrain);
  const kit = { schema_version: 1, gbrain_version: g.version, gbrain_tag: g.tag, gbrain_is_pin: g.pinned, gbrain_pin: PIN,
    catalog_source: resolve(o.catalog), catalog_sha256: catalogSha(o.catalog), skills: readdirSync(join(o.catalog, 'skills')).length, pins_sha256: sha256(readFileSync(join(o.out, 'pins.json'))),
    sas_arm_sha256: sha256(readFileSync(join(o.out, 'bin', 'sas-arm'))) };
  writeFileSync(join(o.out, 'kit.json'), JSON.stringify(kit, null, 1) + '\n');
  return kit;
}

/** harness-eval/<h>:sas-base (dev plus Bun, gbrain and bin/, rebuilt when bin/, the pin or the dev image changed) and harness-eval/<h>:sas-<tag> (base plus the catalog and the json files). */
export function buildImages(kit: string, harnesses: string[], tag: string, from = 'dev'): string[] {
  const g = JSON.parse(readFileSync(join(kit, 'kit.json'), 'utf8')) as { gbrain_tag: string; gbrain_version: string };
  const binSha = sha256(sha256(readFileSync(join(kit, 'bin', 'sas-arm'))) + JSON.stringify(PIN) + g.gbrain_tag);
  const images: string[] = [];
  for (const h of harnesses) {
    const base = 'harness-eval/' + h + ':sas-base' + (from === 'dev' ? '' : '-' + from);
    const dev = spawnSync('docker', ['image', 'inspect', '-f', '{{.Id}}', 'harness-eval/' + h + ':' + from], { encoding: 'utf8', env: ENV }).stdout.trim();
    const label = binSha + '-' + dev;
    const have = spawnSync('docker', ['image', 'inspect', '-f', '{{index .Config.Labels "harness-eval.sas-bin"}}', base], { encoding: 'utf8', env: ENV }).stdout.trim();
    if (have !== label) run(['docker', 'build', '-q', '-f', '-', '--label', 'harness-eval.sas-bin=' + label, '-t', base, join(kit, 'bin')], 'docker build ' + base,
      'FROM ' + PIN.bun_image + ' AS bun\nFROM harness-eval/' + h + ':' + from + '\nUSER root\nCOPY --from=bun /usr/local/bin/bun /usr/local/bin/bun\n' +
      'RUN BUN_INSTALL=' + KIT_DIR + '/bun bun install -g github:' + PIN.repo + '#' + g.gbrain_tag + ' && test "$(' + KIT_DIR + '/bun/bin/gbrain --version)" = "gbrain ' + g.gbrain_version + '" && chmod -R a+rX ' + KIT_DIR + '/bun\n' +
      'COPY . ' + KIT_DIR + '/bin/\n');
    const image = 'harness-eval/' + h + ':sas-' + tag;
    run(['docker', 'build', '-q', '-f', '-', '-t', image, kit], 'docker build ' + image,
      'FROM ' + base + '\nUSER root\nCOPY catalog ' + KIT_DIR + '/catalog/\nCOPY kit.json pins.json system-preamble.md ' + KIT_DIR + '/\nRUN chmod -R a+rX ' + KIT_DIR + '\n');
    images.push(image);
  }
  return images;
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const catalog = v('--catalog'), out = v('--out');
  if (!catalog || !out) { console.error('usage: build-kit.ts --catalog <rung dir> --out <kit dir> [--pins <file>] [--gbrain <tag>] [--image <h,...> --tag <tag> [--from <image tag>]]'); process.exit(2); }
  const kit = buildKit({ catalog: resolve(catalog), out: resolve(out), pins: v('--pins') ? resolve(v('--pins')!) : undefined, gbrain: v('--gbrain') });
  console.log('KIT ' + resolve(out) + ' ' + JSON.stringify(kit));
  if (v('--image')) for (const i of buildImages(resolve(out), v('--image')!.split(','), v('--tag') ?? String(kit.skills), v('--from') ?? 'dev')) console.log('IMAGE ' + i);
}
