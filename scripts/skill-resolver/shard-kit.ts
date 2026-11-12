#!/usr/bin/env bun
// Stages the skill-resolver kit on a shard machine and builds the images its skill-arm cells run in (internal-task,
// scripts/skill-resolver/ARMS.md). Keyless, no network. scripts/run-shard.sh runs it for a shard with any skill-arm cell.
//
//   bun scripts/skill-resolver/shard-kit.ts --prereg <prereg.json> --cells a,b --skill-root <dir> --out <dir> [--skip-build]
//
// The skill root holds what the repository does not: kit/ (build-kit.ts --gbrain output, the frozen kit whose receipts the
// preregistration records; receipts carry their build time, so the kit is shipped, never rebuilt), gbrain-linux-x64-musl
// (the same release built for musl, for QM's Alpine core image) and inputs/ (what the cells read under .skill-resolver/:
// setp.jsonl and catalog/). Every file the preregistration's inputs pin is checked first: the request set's sha256, the
// catalog's catalog_hash (staged and in kit.json, and recomputed from the skill files of inputs/catalog/ and kit/catalog/, the
// copy the images install), both resolver binaries' sha256 and the kit's gbrain_version. inputs/ is then copied to
// .skill-resolver/ in the checkout (git ignores it).
//
// Images, each from the harness image the shard built (harness-eval/<h>:dev, harness-eval/qm-sandbox:dev):
//   harness-eval/<h>:skills-kit   OpenClaw, Claude Code, Codex, Hermes: the kit at /opt/skill-resolver
//   QM, per config (runner/trial/set-t.ts QM_ARM_IMAGES): the Dockerfile.arms targets core-catalog (native, push), core-pull and
//   sandbox-pull (pull), core-none (none), with the pinned release as /usr/local/bin/gbrain and the index built in the image.
// --skip-build (a shard whose smoke already built them) builds only the images that are missing, such as the other arms of a
// QM shard whose smoke ran its first cell only, then checks that they all exist.
//
// Then the per-shard preflight the preregistration requires: preflight.ts in each push harness's image (one resolve through the
// wrapper, then the shadow replay), and harnesses/qm/shadow-replay.sh on each QM image that carries the resolver, whose index
// receipt must also name the pinned gbrain_version. Writes <out>/skill-kit.json (the checks, image ids, preflight records) and
// prints SKILL_KIT lines. Exit 0 when everything passes, 1 when a check or preflight fails, 2 on usage.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { QM_ARM_IMAGES, QM_PULL_SANDBOX_IMAGE } from '../../runner/trial/set-t.ts';
import { HARNESSES } from './build-kit.ts';

const ROOT = resolve(dirname(import.meta.path), '..', '..');
const ARMS = join(ROOT, 'scripts', 'skill-resolver', 'step0', 'qm', 'arms');
const QM_TARGETS: Record<string, [string, string][]> = {
  'pi-skills-native': [['core-catalog', QM_ARM_IMAGES['pi-skills-native']!]],
  'pi-skills-push': [['core-catalog', QM_ARM_IMAGES['pi-skills-push']!]],
  'pi-skills-pull': [['core-pull', QM_ARM_IMAGES['pi-skills-pull']!], ['sandbox-pull', QM_PULL_SANDBOX_IMAGE]],
  'pi-skills-none': [['core-none', QM_ARM_IMAGES['pi-skills-none']!]],
};
const RECEIPT = '/opt/skill-resolver/gbrain-home/.gbrain/skill-index/he-skills/receipt.json';
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', TMPDIR: process.env.TMPDIR ?? tmpdir() };
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const run = (cmd: string[], extra: Record<string, string> = {}, input?: string) => {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd: ROOT, encoding: 'utf8', env: { ...env, ...extra }, input, timeout: 3_600_000 });
  return { status: r.status, out: ((r.stdout ?? '') + (r.stderr ?? '')).trim() };
};
const imageId = (tag: string) => { const r = run(['docker', 'image', 'inspect', '-f', '{{.Id}}', tag]); return r.status === 0 ? r.out : null; };

type Cell = { id: string; harness: string; skill_arm?: string; config?: string };
type Pinned = { sha256?: string; catalog_hash?: string };
type Inputs = Record<string, unknown> & { resolver: { tag: string; binary_sha256: Record<string, string> } };

export function shardSkillNeeds(cells: Cell[]): { push: string[]; qmConfigs: string[] } {
  const skill = cells.filter((c) => c.skill_arm);
  const push = [...new Set(skill.filter((c) => c.harness !== 'qm').map((c) => c.harness))].sort();
  const unknown = push.filter((h) => !(HARNESSES as readonly string[]).includes(h));
  if (unknown.length) throw new Error('no skill kit for harness ' + unknown.join(', '));
  const qmConfigs = [...new Set(skill.filter((c) => c.harness === 'qm').map((c) => c.config ?? ''))].sort();
  const bad = qmConfigs.filter((c) => !QM_TARGETS[c]);
  if (bad.length) throw new Error('QM skill-arm config ' + bad.join(', ') + ' has no arm image');
  return { push, qmConfigs };
}

/** The catalog hash of the skill files under <catalog>/skills, as scripts/skill-resolver/build-catalog.ts computes it: per skill
 *  (by name) its SKILL.md sha256 and the sha256 of its path<TAB>sha256 lines in the copy's walk order. */
export function catalogHashOf(catalog: string): string {
  const byName = (a: string, b: string) => a.localeCompare(b, 'en');
  const hex = (s: string) => createHash('sha256').update(s).digest('hex');
  const walk = (dir: string, base: string): string[] => readdirSync(dir, { withFileTypes: true }).sort((a, b) => byName(a.name, b.name))
    .flatMap((e) => e.isDirectory() ? walk(join(dir, e.name), base) : [relative(base, join(dir, e.name)) + '\t' + sha(join(dir, e.name))]);
  const skills = join(catalog, 'skills');
  return hex(readdirSync(skills).sort(byName).map((name) => name + '\t' + sha(join(skills, name, 'SKILL.md')) + '\t' + hex(walk(join(skills, name), join(skills, name)).join('\n'))).join('\n'));
}

/** The arm images a shard still has to build: all of them, or under --skip-build only those that are missing. */
export function armImagesToBuild(needs: { push: string[]; qmConfigs: string[] }, skipBuild: boolean, exists: (tag: string) => boolean): { push: string[]; qmConfigs: string[] } {
  if (!skipBuild) return needs;
  return { push: needs.push.filter((h) => !exists('harness-eval/' + h + ':skills-kit')), qmConfigs: needs.qmConfigs.filter((c) => QM_TARGETS[c]!.some(([, t]) => !exists(t))) };
}

/** Every pinned input the skill root must match; returns the problems. */
export function checkSkillRoot(root: string, inputs: Inputs): string[] {
  const problems: string[] = [];
  const kitJson = join(root, 'kit', 'kit.json');
  if (!existsSync(kitJson)) return [kitJson + ' is missing'];
  const kit = JSON.parse(readFileSync(kitJson, 'utf8')) as { catalog_hash?: string; gbrain_version?: string; gbrain?: { stand_in?: boolean } };
  const bins: [string, string][] = [[join(root, 'kit', 'bin', 'gbrain'), 'linux-x64'], [join(root, 'gbrain-linux-x64-musl'), 'linux-x64-musl']];
  for (const [p, k] of bins) {
    const want = inputs.resolver.binary_sha256[k];
    if (!existsSync(p)) problems.push(p + ' is missing');
    else if (sha(p) !== want) problems.push(p + ' has sha256 ' + sha(p).slice(0, 12) + ', the pinned ' + k + ' build is ' + String(want).slice(0, 12));
  }
  if (kit.gbrain?.stand_in !== false) problems.push('kit.json records the stand-in resolver, not the pinned release');
  if (String(kit.gbrain_version).replace(/^gbrain /, '') !== inputs.resolver.tag.replace(/^v/, '')) problems.push('kit.json gbrain_version ' + kit.gbrain_version + ' is not the pinned ' + inputs.resolver.tag);
  for (const [key, value] of Object.entries(inputs)) {
    if (!key.startsWith('.skill-resolver/')) continue;
    const want = value as Pinned;
    const p = join(root, 'inputs', key.slice('.skill-resolver/'.length));
    if (!existsSync(p)) { problems.push(p + ' is missing'); continue; }
    if (want.sha256 && sha(p) !== want.sha256) problems.push(p + ' has sha256 ' + sha(p).slice(0, 12) + ', the preregistration pins ' + want.sha256.slice(0, 12));
    if (want.catalog_hash) {
      const got = (JSON.parse(readFileSync(p, 'utf8')) as { catalog_hash?: string }).catalog_hash;
      if (got !== want.catalog_hash) problems.push(p + ' has catalog_hash ' + String(got).slice(0, 12) + ', the preregistration pins ' + want.catalog_hash.slice(0, 12));
      if (kit.catalog_hash !== want.catalog_hash) problems.push('kit.json catalog_hash ' + String(kit.catalog_hash).slice(0, 12) + ' is not the pinned ' + want.catalog_hash.slice(0, 12));
      for (const dir of [dirname(p), join(root, 'kit', 'catalog')]) {
        if (!existsSync(join(dir, 'skills'))) { problems.push(join(dir, 'skills') + ' is missing'); continue; }
        const files = catalogHashOf(dir);
        if (files !== want.catalog_hash) problems.push(join(dir, 'skills') + ' hashes to catalog ' + files.slice(0, 12) + ', the preregistration pins ' + want.catalog_hash.slice(0, 12));
      }
    }
  }
  return problems;
}

function buildImages(root: string, push: string[], qmConfigs: string[]): string[] {
  const problems: string[] = [];
  const kit = join(root, 'kit');
  for (const h of push) {
    const r = run(['docker', 'build', '-q', '-f', '-', '--build-arg', 'BASE=harness-eval/' + h + ':dev', '-t', 'harness-eval/' + h + ':skills-kit', kit], {}, 'ARG BASE\nFROM ${BASE}\nCOPY . /opt/skill-resolver/\n');
    if (r.status !== 0) problems.push('docker build harness-eval/' + h + ':skills-kit failed: ' + r.out.slice(-400));
  }
  const targets = [...new Map(qmConfigs.flatMap((c) => QM_TARGETS[c]!)).entries()];
  if (!targets.length) return problems;
  const ctx = mkdtempSync(join(tmpdir(), 'qm-arms-'));
  try {
    cpSync(join(kit, 'catalog', 'skills'), join(ctx, 'skills'), { recursive: true });
    cpSync(join(ARMS, '..', 'pull', 'tool'), join(ctx, 'tools', 'resolve-skills'), { recursive: true });
    cpSync(join(ROOT, 'scripts', 'skill-resolver', 'result-fields.ts'), join(ctx, 'result-fields.ts'));
    mkdirSync(join(ctx, 'harness'));
    for (const f of ['adapter.sh', 'skill-resolver.mjs']) cpSync(join(ROOT, 'harnesses', 'qm', f), join(ctx, 'harness', f));
    cpSync(join(kit, 'bin', 'gbrain'), join(ctx, 'gbrain'));
    cpSync(join(root, 'gbrain-linux-x64-musl'), join(ctx, 'gbrain-musl'));
    for (const [target, tag] of targets) {
      const r = run(['docker', 'build', '-q', '-f', join(ARMS, 'Dockerfile.arms'), '--target', target, '-t', tag, ctx]);
      if (r.status !== 0) problems.push('docker build ' + tag + ' (' + target + ') failed: ' + r.out.slice(-400));
    }
  } finally { rmSync(ctx, { recursive: true, force: true }); }
  return problems;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (n: string) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
  const [prereg, cellList, skillRoot, out] = [arg('prereg'), arg('cells'), arg('skill-root'), arg('out')];
  if (!prereg || !cellList || !out) { console.error('usage: shard-kit.ts --prereg <prereg.json> --cells a,b --skill-root <dir> --out <dir> [--skip-build]'); process.exit(2); }
  const p = JSON.parse(readFileSync(prereg, 'utf8')) as { cells: Cell[]; inputs?: Inputs };
  const want = new Set(cellList.split(','));
  let needs: { push: string[]; qmConfigs: string[] };
  try { needs = shardSkillNeeds(p.cells.filter((c) => want.has(c.id))); } catch (e) { console.error('SKILL_KIT refused: ' + (e as Error).message); process.exit(2); }
  if (!needs.push.length && !needs.qmConfigs.length) { console.log('SKILL_KIT: no skill-arm cell in this shard'); process.exit(0); }
  if (!skillRoot) { console.error('SKILL_KIT refused: the shard has skill-arm cells; pass --skill-root <dir> (kit/, gbrain-linux-x64-musl, inputs/)'); process.exit(2); }
  if (!p.inputs?.resolver) { console.error('SKILL_KIT refused: ' + prereg + ' has no inputs.resolver to check the kit against'); process.exit(2); }
  const root = resolve(skillRoot);
  const record: Record<string, unknown> = { skill_root: root, harnesses: needs.push, qm_configs: needs.qmConfigs };
  const finish = (problems: string[]) => {
    writeFileSync(join(out, 'skill-kit.json'), JSON.stringify({ ...record, ok: problems.length === 0, problems }, null, 1) + '\n');
    for (const pr of problems) console.log('SKILL_KIT FAIL ' + pr);
    console.log('SKILL_KIT: ' + (problems.length ? 'failed' : 'ok') + ' (' + join(out, 'skill-kit.json') + ')');
    process.exit(problems.length ? 1 : 0);
  };
  mkdirSync(out, { recursive: true });
  const checked = checkSkillRoot(root, p.inputs);
  if (checked.length) finish(checked);
  console.log('SKILL_KIT inputs match the preregistration: gbrain ' + p.inputs.resolver.tag + ' (both builds), catalog, request set');
  rmSync(join(ROOT, '.skill-resolver'), { recursive: true, force: true });
  cpSync(join(root, 'inputs'), join(ROOT, '.skill-resolver'), { recursive: true });
  const todo = armImagesToBuild(needs, argv.includes('--skip-build'), (t) => imageId(t) !== null);
  if (todo.push.length || todo.qmConfigs.length) { const built = buildImages(root, todo.push, todo.qmConfigs); if (built.length) finish(built); }
  const tags = [...needs.push.map((h) => 'harness-eval/' + h + ':skills-kit'), ...new Set(needs.qmConfigs.flatMap((c) => QM_TARGETS[c]!.map(([, t]) => t)))];
  const images = Object.fromEntries(tags.map((t) => [t, imageId(t)]));
  record.images = images;
  const missing = tags.filter((t) => !images[t]);
  if (missing.length) finish(missing.map((t) => 'image ' + t + ' is missing'));
  for (const t of tags) console.log('SKILL_KIT image ' + t + ' ' + images[t]!.slice(0, 19));
  const problems: string[] = [];
  if (needs.push.length) {
    const r = run(['bun', 'scripts/skill-resolver/preflight.ts', '--kit', join(root, 'kit'), ...needs.push.flatMap((h) => ['--harness', h]), '--image-tag', 'skills-kit', '--out', join(out, 'preflight-skill.json')]);
    for (const l of r.out.split('\n').filter((l) => /^(PREFLIGHT|SHADOW_REPLAY)/.test(l))) console.log('SKILL_KIT ' + l);
    if (r.status !== 0) problems.push('preflight.ts exited ' + r.status + ' (' + join(out, 'preflight-skill.json') + ')');
  }
  const qm: Record<string, unknown> = {};
  for (const tag of new Set(needs.qmConfigs.filter((c) => c !== 'pi-skills-none').map((c) => QM_ARM_IMAGES[c]!))) {
    const receipt = run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'cat', tag, RECEIPT]);
    const parsed = receipt.status === 0 ? JSON.parse(receipt.out) as { gbrain_version?: string; index?: { index_hash?: string } } : null;
    const replay = run(['bash', 'harnesses/qm/shadow-replay.sh'], { QM_IMAGE: tag });
    const line = replay.out.split('\n').find((l) => /^SHADOW_REPLAY_(OK|FAIL)/.test(l)) ?? 'no SHADOW_REPLAY line';
    qm[tag] = { gbrain_version: parsed?.gbrain_version ?? null, index_hash: parsed?.index?.index_hash ?? null, shadow_replay: line, exit: replay.status };
    console.log('SKILL_KIT qm ' + tag + ' gbrain ' + (parsed?.gbrain_version ?? '-') + ' index ' + String(parsed?.index?.index_hash ?? '-').slice(0, 12) + ' ' + line);
    if (parsed?.gbrain_version !== p.inputs.resolver.tag.replace(/^v/, '')) problems.push(tag + ' index receipt names gbrain ' + (parsed?.gbrain_version ?? 'nothing') + ', not the pinned ' + p.inputs.resolver.tag);
    if (replay.status !== 0) problems.push(tag + ': ' + line + ' (INFRA for the shard)');
  }
  record.qm = qm;
  finish(problems);
}
