#!/usr/bin/env bun
// Build one PGLite brain for the gbrain arm: the slice of the Pemberline corpus the bot can already read
// in the world, for one split, imported into a fresh keyless gbrain home. Runs at image build time
// (gbrain/Dockerfile) and by hand:
//
//   bun gbrain/build-brain.ts --split heldout --corpus <gbrain-evals>/eval/data/messy-company-v1/corpus \
//       --world world/seed/world.json --out /brains/heldout --staging /tmp/staging-heldout \
//       --gbrain "bun /opt/gbrain/src/cli.ts" --commit <gbrain commit>
//
// The page list comes from world.json, never from a directory listing: the source_slugs of every
// non-DM channel loaded for the split (record.split is the split or "both") plus the slug of every
// file with visibility "public" loaded for the split. Each page is copied into the staging directory
// at <split>/<corpus slug>.md, so the gbrain page slug is <split>/<corpus slug>, the name
// docs/gbrain-arm.md and lane E's grader use. A listed page missing from the corpus fails the build.
// gbrain runs with an environment that holds no API key: init prints its search-mode notice and picks
// keyword-only search because nothing else is available; import runs with --no-embed.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Split, World } from '../world/types.ts';

export interface BrainPage {
  /** gbrain page slug: <split>/<corpus slug>. */
  page_slug: string;
  /** Corpus slug without the split prefix, as world.json carries it. */
  slug: string;
  /** Path under the corpus checkout, <split>/<slug>.md. */
  source_path: string;
  sha256: string;
  bytes: number;
  kind: 'channel' | 'file';
  /** The world record the page came from: a channel id or a file id. */
  world_id: string;
  world_name: string;
  visibility: 'channel' | 'public';
}

export interface BrainManifest {
  schema_version: 1;
  gbrain_commit: string;
  gbrain_version: string | null;
  corpus: { repo: string; commit: string; path: string };
  split: 'dev' | 'heldout';
  world_id: string;
  built_at: string;
  embeddings: 'off';
  pages: BrainPage[];
  counts: { channel_pages: number; public_files: number; total: number };
  import: Record<string, unknown>;
}

export type ListedPage = Omit<BrainPage, 'sha256' | 'bytes' | 'source_path'>;

const loaded = (record: { split: Split }, split: 'dev' | 'heldout') => record.split === split || record.split === 'both';

/** The bot-visible slice for a split, in world.json order: channel pages first, then public files. */
export function pageList(world: World, split: 'dev' | 'heldout'): ListedPage[] {
  const pages: ListedPage[] = [];
  for (const c of world.channels) {
    if (c.kind === 'dm' || !loaded(c, split)) continue;
    for (const slug of c.source_slugs) pages.push({ page_slug: `${split}/${slug}`, slug, kind: 'channel', world_id: c.id, world_name: c.name, visibility: 'channel' });
  }
  for (const f of world.files) {
    if (f.visibility !== 'public' || !loaded(f, split)) continue;
    pages.push({ page_slug: `${split}/${f.slug}`, slug: f.slug, kind: 'file', world_id: f.id, world_name: f.title, visibility: 'public' });
  }
  return pages;
}

/** Find a page in the corpus: under its own split first, then the other split for a "both" record. */
function locate(corpus: string, split: 'dev' | 'heldout', slug: string): string | null {
  for (const s of [split, split === 'dev' ? 'heldout' : 'dev']) {
    const p = join(corpus, s, `${slug}.md`);
    if (existsSync(p)) return p;
  }
  return null;
}

/** An environment for gbrain with no provider key in it. */
export function keylessEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    GBRAIN_HOME: home,
    GBRAIN_SKIP_STARTUP_HOOKS: '1',
    NO_COLOR: '1',
    CI: '1',
  };
  for (const k of ['LANG', 'LC_ALL', 'TMPDIR', 'BUN_INSTALL']) if (process.env[k]) env[k] = process.env[k]!;
  return env;
}

function run(cmd: string[], env: Record<string, string>, label: string): { stdout: string; stderr: string } {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`${label} exited ${r.status}\n${r.stderr.split('\n').slice(-20).join('\n')}`);
  }
  return { stdout: r.stdout, stderr: r.stderr };
}

export interface BuildOptions {
  split: 'dev' | 'heldout';
  corpus: string;
  worldPath: string;
  out: string;
  staging: string;
  /** The gbrain command, split on spaces (for example "bun /opt/gbrain/src/cli.ts"). */
  gbrain: string[];
  commit: string;
  corpusCommit: string;
  corpusRepo: string;
  log?: (line: string) => void;
}

export function buildBrain(o: BuildOptions): BrainManifest {
  const log = o.log ?? ((l) => console.error(l));
  const world = JSON.parse(readFileSync(o.worldPath, 'utf8')) as World;
  const listed = pageList(world, o.split);
  if (!listed.length) throw new Error(`no bot-visible pages for split ${o.split} in ${o.worldPath}`);

  rmSync(o.staging, { recursive: true, force: true });
  mkdirSync(o.staging, { recursive: true });
  const missing: string[] = [];
  const pages: BrainPage[] = [];
  for (const p of listed) {
    const src = locate(o.corpus, o.split, p.slug);
    if (!src) { missing.push(p.slug); continue; }
    const body = readFileSync(src);
    const dest = join(o.staging, o.split, `${p.slug}.md`);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    pages.push({ ...p, source_path: `${o.split}/${p.slug}.md`, sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length });
  }
  if (missing.length) throw new Error(`${missing.length} listed page(s) missing from ${o.corpus}: ${missing.join(', ')}`);
  log(`${o.split}: staged ${pages.length} pages (${pages.filter((p) => p.kind === 'channel').length} channel pages, ${pages.filter((p) => p.kind === 'file').length} public files) under ${o.staging}`);

  rmSync(o.out, { recursive: true, force: true });
  mkdirSync(o.out, { recursive: true });
  const env = keylessEnv(resolve(o.out));
  const init = run([...o.gbrain, 'init', '--pglite', '--non-interactive', '--no-embedding'], env, 'gbrain init');
  log(`gbrain init: ${(init.stdout + init.stderr).split('\n').filter((l) => /search|embedding|engine/i.test(l)).slice(0, 3).join(' | ')}`);
  const imp = run([...o.gbrain, 'import', resolve(o.staging), '--no-embed', '--allow-noncanonical-root', '--json'], env, 'gbrain import');
  const summaryLine = imp.stdout.split('\n').reverse().find((l) => l.trim().startsWith('{'));
  if (!summaryLine) throw new Error(`gbrain import printed no JSON summary\n${imp.stderr.slice(-800)}`);
  const summary = JSON.parse(summaryLine) as Record<string, unknown>;
  if (summary.status !== 'success' || Number(summary.imported) !== pages.length || Number(summary.errors) !== 0) {
    throw new Error(`gbrain import did not import exactly ${pages.length} pages: ${summaryLine}`);
  }
  log(`gbrain import: ${summary.imported} pages in ${summary.duration_s} s`);

  const version = run([...o.gbrain, '--version'], env, 'gbrain --version').stdout.trim().match(/\d+\.\d+\.\d+(\.\d+)?/)?.[0] ?? null;
  const manifest: BrainManifest = {
    schema_version: 1,
    gbrain_commit: o.commit,
    gbrain_version: version,
    corpus: { repo: o.corpusRepo, commit: o.corpusCommit, path: 'eval/data/messy-company-v1/corpus' },
    split: o.split,
    world_id: world.world_id,
    built_at: new Date().toISOString(),
    embeddings: 'off',
    pages,
    counts: { channel_pages: pages.filter((p) => p.kind === 'channel').length, public_files: pages.filter((p) => p.kind === 'file').length, total: pages.length },
    import: summary,
  };
  writeFileSync(join(o.out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  return manifest;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

if (import.meta.main) {
  const split = arg('split');
  if (split !== 'dev' && split !== 'heldout') { console.error('usage: bun gbrain/build-brain.ts --split dev|heldout --corpus <dir> --world <world.json> --out <brain home> [--staging <dir>] [--gbrain "<cmd>"] [--commit <sha>] [--corpus-commit <sha>]'); process.exit(2); }
  const pin = JSON.parse(readFileSync(join(import.meta.dir, 'pin.json'), 'utf8')) as { gbrain: { commit: string }; corpus: { repo: string; commit: string } };
  try {
    const m = buildBrain({
      split,
      corpus: resolve(arg('corpus', join(process.env.HOME ?? '.', '.capy', 'work', 'harness-eval', 'gbrain-evals', 'eval', 'data', 'messy-company-v1', 'corpus'))!),
      worldPath: resolve(arg('world', join(import.meta.dir, '..', 'world', 'seed', 'world.json'))!),
      out: resolve(arg('out', join('/brains', split))!),
      staging: resolve(arg('staging', join('/tmp', `gbrain-staging-${split}`))!),
      gbrain: (arg('gbrain', 'gbrain')!).split(' ').filter(Boolean),
      commit: arg('commit', pin.gbrain.commit)!,
      corpusCommit: arg('corpus-commit', pin.corpus.commit)!,
      corpusRepo: pin.corpus.repo,
    });
    console.log(JSON.stringify({ split: m.split, pages: m.counts, gbrain_version: m.gbrain_version, out: arg('out', join('/brains', split)) }));
  } catch (e) {
    console.error(`build-brain failed: ${(e as Error).message}`);
    process.exit(1);
  }
}
