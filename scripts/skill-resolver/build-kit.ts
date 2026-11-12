#!/usr/bin/env bun
// Builds the skill-resolver kit the agent-phase arms read at /opt/skill-resolver (internal-task). Keyless, no network.
//
//   bun scripts/skill-resolver/build-kit.ts --catalog <build-catalog.ts --out dir> --out <kit dir>
//       [--gbrain <binary>] [--usage-order <file>] [--harness <h>]... [--no-index]
//
// --gbrain names the resolver binary to ship as bin/gbrain: the pinned release is gbrain v0.60.633.0, built for linux-x64 with
// the package's build script (docs/benchmarks/2026-11-08-skill-resolver/PREREGISTRATION.md records the binary's sha256).
// Without it the kit ships the stand-in, scripts/skill-resolver/gbrain-stub.ts compiled with bun build --compile, the keyless
// test double. The hook wrapper (scripts/skill-resolver/hook-wrapper.ts) is compiled to bin/he-skill-hook the same way, so it runs
// in every harness image.
//
// Kit layout:
//   kit.json                         what the kit holds: the eval's catalog hash, file hashes, per-harness index receipts
//   bin/gbrain, bin/he-skill-hook
//   catalog/skills/                  the catalog (native and resolver-on arms)
//   names-only/skills/               the same catalog, each description set to the skill's name (names-only arm)
//   openclaw-plugin/                 the he-skill-resolver plugin template (scripts/skill-resolver/openclaw-plugin)
//   index/<harness>/gbrain-home/     GBRAIN_HOME holding .gbrain/skill-index/he-skills/ (index.bin and receipt.json), built by
//                                    bin/gbrain inside harness-eval/<harness>:dev with the catalog mounted at INDEX_DIR: where
//                                    the adapter installs it for OpenClaw and Claude Code, so every path in the index is the
//                                    trial's own, and the kit's read-only copy (KIT_CATALOG_DIR) for Codex and Hermes, whose
//                                    sessions write into their skills root; for those two kit.json also records the hashes of
//                                    an in-root build (in_root_build), which is not shipped; the release writes
//                                    it owner-only (0700 directories, 0600 files), so the kit opens it to 0755/0644 for
//                                    the harness user that reads it in the image
//   usage-order.txt                  OpenClaw usage-ordered arm only: the ordered top list, one skill name per line (an input)
//
// The index must hold every catalog skill except those whose frontmatter sets disable-model-invocation: true, which the
// release leaves out (skipped reason not_model_invocable; kit.json lists them per harness) and the stand-in indexes.
//
// The index is built once per kit (once per image), never by a trial; trials copy gbrain-home into their state dir so the
// resolver can keep session dedupe state, and every result is checked against the receipt kept here.
//
// The release checks an index's freshness on the turn path by stat: every directory's mtime and every SKILL.md's size and mtime
// under the --dir root must equal what the build saw, or the result says index_stale (an INFRA turn). An adapter copies the
// catalog into the harness's skills root, which gives every entry a new mtime, so the kit sets every entry of catalog/skills,
// the root included, to one fixed time (CATALOG_MTIME_S, recorded in kit.json as catalog_mtime_s) before the index is built,
// and each adapter sets every installed entry to that time after its copy.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { normalizeReceipt, receiptPathIn } from './result-fields.ts';

export const CATALOG_NAME = 'he-skills';
export const HARNESSES = ['openclaw', 'claude-code', 'codex', 'hermes'] as const;
export type KitHarness = (typeof HARNESSES)[number];
/** The one mtime every catalog entry gets (2026-11-08T00:00:00Z), so a copy set to it matches the index's stat fingerprint. */
export const CATALOG_MTIME_S = Date.UTC(2026, 10, 8) / 1000;
/** Where each adapter installs the catalog in the container (the skills root each harness reads). */
export const INSTALL_DIR: Record<KitHarness, string> = {
  openclaw: '/workspace/skills',
  'claude-code': '/harness-state/claude/skills',
  codex: '/harness-state/codex/skills',
  hermes: '/harness-state/hermes/skills',
};
/** The kit's own catalog copy in the image, which no harness writes to. */
export const KIT_CATALOG_DIR = '/opt/skill-resolver/catalog/skills';
/**
 * The --dir each harness's index is built over. Codex and Hermes write their own entries into their skills root during a session
 * (Codex .system/ at its first exec, Hermes .hub, .bundled_manifest, .usage.json and others), which changes the root's mtime and
 * makes every later turn read as index_stale, so their index is built over the kit's read-only copy instead.
 */
export const INDEX_DIR: Record<KitHarness, string> = { ...INSTALL_DIR, codex: KIT_CATALOG_DIR, hermes: KIT_CATALOG_DIR };
const HERE = import.meta.dir;
const ROOT = resolve(HERE, '../..');
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function treeDigest(dir: string): string {
  const lines: string[] = [];
  const walk = (rel: string) => {
    for (const n of readdirSync(join(dir, rel)).sort()) {
      const r = rel ? rel + '/' + n : n;
      if (statSync(join(dir, r)).isDirectory()) walk(r); else lines.push(sha(readFileSync(join(dir, r))) + '  ' + r);
    }
  };
  walk('');
  return sha(lines.join('\n') + '\n');
}

/** Sets every entry under root, root included, to the time t (seconds). */
export function setTreeMtime(root: string, t: number) {
  for (const n of readdirSync(root)) { const p = join(root, n); if (statSync(p).isDirectory()) setTreeMtime(p, t); else utimesSync(p, t, t); }
  utimesSync(root, t, t);
}

function run(cmd: string[], what: string): string {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' } });
  if (r.status !== 0) throw new Error(what + ' failed (exit ' + r.status + '): ' + (r.stderr || r.stdout).trim().slice(0, 600));
  return r.stdout;
}

export function buildKit(opts: { catalog: string; out: string; gbrain?: string; usageOrder?: string; harnesses: KitHarness[]; index: boolean }): Record<string, unknown> {
  const out = resolve(opts.out);
  if (existsSync(out)) rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'bin'), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(opts.catalog, 'manifest.json'), 'utf8')) as { catalog_hash: string; skill_count: number };
  cpSync(join(opts.catalog, 'skills'), join(out, 'catalog', 'skills'), { recursive: true });
  copyFileSync(join(opts.catalog, 'manifest.json'), join(out, 'catalog', 'manifest.json'));
  run(['bun', join(HERE, 'step0', 'openclaw-hermes', 'names-only.ts'), '--catalog', join(out, 'catalog'), '--out', join(out, 'names-only')], 'names-only.ts');
  if (opts.gbrain) copyFileSync(opts.gbrain, join(out, 'bin', 'gbrain'));
  else run(['bun', 'build', '--compile', '--target=bun-linux-x64', join(HERE, 'gbrain-stub.ts'), '--outfile', join(out, 'bin', 'gbrain')], 'compiling gbrain-stub.ts');
  run(['bun', 'build', '--compile', '--target=bun-linux-x64', join(HERE, 'hook-wrapper.ts'), '--outfile', join(out, 'bin', 'he-skill-hook')], 'compiling hook-wrapper.ts');
  for (const b of ['gbrain', 'he-skill-hook']) chmodSync(join(out, 'bin', b), 0o755);
  cpSync(join(HERE, 'openclaw-plugin'), join(out, 'openclaw-plugin'), { recursive: true });
  if (opts.usageOrder) {
    const names = readFileSync(opts.usageOrder, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
    const known = new Set(readdirSync(join(out, 'catalog', 'skills')));
    const unknown = names.filter((n) => !known.has(n));
    if (unknown.length) throw new Error('usage-order list names skills the catalog does not hold: ' + unknown.slice(0, 10).join(', '));
    if (new Set(names).size !== names.length) throw new Error('usage-order list repeats a name');
    writeFileSync(join(out, 'usage-order.txt'), names.join('\n') + '\n');
  }
  const gbrainVersion = run([join(out, 'bin', 'gbrain'), '--version'], 'gbrain --version').trim();
  const index: Record<string, unknown> = {};
  setTreeMtime(join(out, 'catalog', 'skills'), CATALOG_MTIME_S);
  if (opts.index) {
    const uid = process.getuid!() + ':' + process.getgid!();
    const build = (h: KitHarness, home: string, dir: string) => {
      mkdirSync(home, { recursive: true });
      run(['docker', 'run', '--rm', '--network', 'none', '--user', uid, '--entrypoint', '/kit/bin/gbrain', '-e', 'GBRAIN_HOME=/kit-home', '-e', 'GBRAIN_SKILLS_NO_AUTOREBUILD=1',
        '-v', join(out, 'bin') + ':/kit/bin:ro', '-v', home + ':/kit-home', '-v', join(out, 'catalog', 'skills') + ':' + dir + ':ro',
        'harness-eval/' + h + ':dev', 'skills', 'index', 'build', '--catalog', CATALOG_NAME, '--dir', dir, '--harness', h, '--json'], 'gbrain skills index build for ' + h + ' over ' + dir);
    };
    for (const h of opts.harnesses) {
      const home = join(out, 'index', h, 'gbrain-home');
      build(h, home, INDEX_DIR[h]);
      let inRoot: Record<string, unknown> | undefined;
      if (INDEX_DIR[h] !== INSTALL_DIR[h]) {
        const scratch = join(out, 'index', h, 'in-root-home');
        build(h, scratch, INSTALL_DIR[h]);
        const r = normalizeReceipt(JSON.parse(readFileSync(receiptPathIn(scratch, CATALOG_NAME), 'utf8')));
        inRoot = { dir: INSTALL_DIR[h], gbrain_catalog_hash: r.catalog_hash, index_hash: r.index_hash };
        rmSync(scratch, { recursive: true, force: true });
      }
      const readable = (p: string): void => { const dir = statSync(p).isDirectory(); chmodSync(p, dir ? 0o755 : 0o644); if (dir) for (const n of readdirSync(p)) readable(join(p, n)); };
      readable(home);
      const receiptPath = receiptPathIn(home, CATALOG_NAME);
      const receipt = normalizeReceipt(JSON.parse(readFileSync(receiptPath, 'utf8')));
      const notInvocable = (receipt.skipped as Array<{ reason?: string; id?: string }>).filter((s) => s.reason === 'not_model_invocable').map((s) => String(s.id));
      if (receipt.skill_count! + notInvocable.length !== manifest.skill_count || receipt.skipped.length !== notInvocable.length) throw new Error(h + ': the index holds ' + receipt.skill_count + ' skills, the catalog ' + manifest.skill_count + ' (skipped: ' + JSON.stringify(receipt.skipped).slice(0, 300) + ')');
      index[h] = { not_model_invocable: notInvocable, install_dir: INSTALL_DIR[h], index_dir: INDEX_DIR[h], ...(inRoot ? { in_root_build: inRoot } : {}), catalog: CATALOG_NAME, gbrain_catalog_hash: receipt.catalog_hash, index_hash: receipt.index_hash, gbrain_version: receipt.gbrain_version,
        gbrain_commit: receipt.gbrain_commit, skill_count: receipt.skill_count, receipt: relative(out, receiptPath), receipt_sha256: sha(readFileSync(receiptPath)) };
    }
  }
  const kit = {
    schema_version: 1, catalog: CATALOG_NAME, catalog_hash: manifest.catalog_hash, skill_count: manifest.skill_count, gbrain_version: gbrainVersion, catalog_mtime_s: CATALOG_MTIME_S,
    gbrain: opts.gbrain ? { source: resolve(opts.gbrain), stand_in: false } : { source: relative(ROOT, join(HERE, 'gbrain-stub.ts')), stand_in: true },
    files: {
      'bin/gbrain': sha(readFileSync(join(out, 'bin', 'gbrain'))), 'bin/he-skill-hook': sha(readFileSync(join(out, 'bin', 'he-skill-hook'))),
      'catalog/skills': treeDigest(join(out, 'catalog', 'skills')), 'names-only/skills': treeDigest(join(out, 'names-only', 'skills')),
      'openclaw-plugin': treeDigest(join(out, 'openclaw-plugin')), ...(opts.usageOrder ? { 'usage-order.txt': sha(readFileSync(join(out, 'usage-order.txt'))) } : {}),
    },
    sources: { 'gbrain-stub.ts': sha(readFileSync(join(HERE, 'gbrain-stub.ts'))), 'hook-wrapper.ts': sha(readFileSync(join(HERE, 'hook-wrapper.ts'))) },
    index,
  };
  writeFileSync(join(out, 'kit.json'), JSON.stringify(kit, null, 1) + '\n');
  return kit;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (n: string) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
  const all = (n: string) => argv.flatMap((a, i) => (a === '--' + n && argv[i + 1] ? [argv[i + 1]!] : []));
  const catalog = arg('catalog'), out = arg('out');
  if (!catalog || !out) { console.error('usage: build-kit.ts --catalog <dir> --out <kit dir> [--gbrain <binary>] [--usage-order <file>] [--harness <h>]... [--no-index]'); process.exit(2); }
  const harnesses = (all('harness').length ? all('harness') : [...HARNESSES]) as KitHarness[];
  const bad = harnesses.filter((h) => !(HARNESSES as readonly string[]).includes(h));
  if (bad.length) { console.error('unknown harness ' + bad.join(', ')); process.exit(2); }
  try {
    const kit = buildKit({ catalog, out, gbrain: arg('gbrain'), usageOrder: arg('usage-order'), harnesses, index: !argv.includes('--no-index') }) as { catalog_hash: string; gbrain_version: string; index: Record<string, { gbrain_catalog_hash: string; index_hash: string }> };
    console.log('KIT ' + resolve(out) + ' catalog_hash=' + kit.catalog_hash + ' gbrain=' + JSON.stringify(kit.gbrain_version));
    for (const [h, i] of Object.entries(kit.index)) console.log('INDEX ' + h + ' gbrain_catalog_hash=' + i.gbrain_catalog_hash + ' index_hash=' + i.index_hash);
  } catch (e) { console.error('build-kit: ' + (e as Error).message); process.exit(1); }
}
