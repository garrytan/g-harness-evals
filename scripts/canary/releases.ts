#!/usr/bin/env bun
// Release identity for the regression canary: what gstack and gbrain call stable right now, and which stable moves lie
// between two commits. Every arm is pinned by commit sha, never by a moving ref.
//
//   bun scripts/canary/releases.ts current                                  {gstack:{sha,version}, gbrain:{sha,version}}
//   bun scripts/canary/releases.ts moves --product gstack|gbrain --from <sha> --to <sha>   [{tag, version, sha}], oldest first
//   bun scripts/canary/releases.ts describe --product gstack|gbrain --sha <sha>             {sha, version} of a pinned commit
//   either with [--fixture <recorded.json>] (or CANARY_RELEASES_FIXTURE) to answer from recorded refs instead of the network
//
// gstack: the head of garrytan/gstack's `stable` branch, with the VERSION file at that commit; its moves are the `v*` tags whose
// commit is in <from>..<to> along stable. gbrain: the peeled commit of garrytan/gbrain's `stable` tag, with the version of the
// `stable-v*` tag on the same commit (else the VERSION file there); its moves are the `stable-v*` tags in <from>..<to>.
// The git layer is git ls-remote plus a treeless fetch into a cache for rev-list; the http layer reads raw files.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Product = 'gstack' | 'gbrain';
export interface Release { sha: string; version: string; version_source: string }
export interface Move { tag: string; version: string; sha: string }

/** The git and http layer, injected so tests answer from recorded refs. */
export interface Layer {
  lsRemote(url: string): string;
  readFile(repo: string, sha: string, path: string): string | null;
  /** Commits in from..to, oldest first. */
  revList(url: string, from: string, to: string): string[];
}

export const PRODUCTS: Record<Product, { repo: string; url: string; tag: RegExp }> = {
  gstack: { repo: 'garrytan/gstack', url: 'https://github.com/garrytan/gstack.git', tag: /^refs\/tags\/v(\d[\w.-]*)$/ },
  gbrain: { repo: 'garrytan/gbrain', url: 'https://github.com/garrytan/gbrain.git', tag: /^refs\/tags\/stable-v(\d[\w.-]*)$/ },
};
const SHA = /^[0-9a-f]{40}$/;

/** ref -> sha from ls-remote output; peel(ref) prefers the ^{} line an annotated tag carries. */
export function parseRefs(text: string): { refs: Map<string, string>; peel: (ref: string) => string | undefined } {
  const refs = new Map<string, string>();
  for (const line of text.split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (sha && ref && SHA.test(sha)) refs.set(ref, sha);
  }
  return { refs, peel: (ref) => refs.get(ref + '^{}') ?? refs.get(ref) };
}

const versionKey = (v: string) => v.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? p.padStart(8, '0') : p)).join('.');

export function current(layer: Layer, product: Product): Release {
  const { repo, url } = PRODUCTS[product];
  const { refs, peel } = parseRefs(layer.lsRemote(url));
  const sha = product === 'gstack' ? refs.get('refs/heads/stable') : peel('refs/tags/stable');
  if (!sha) throw new Error(`${repo}: no ${product === 'gstack' ? 'stable branch' : 'stable tag'} in ls-remote`);
  return describe(layer, product, sha);
}

/** The version of a pinned commit: gstack's VERSION file there; gbrain's stable-v* tag on it, else its VERSION file. */
export function describe(layer: Layer, product: Product, sha: string): Release {
  const { repo, url, tag } = PRODUCTS[product];
  if (!SHA.test(sha)) throw new Error('describe needs a full commit sha');
  if (product === 'gbrain') {
    const { refs, peel } = parseRefs(layer.lsRemote(url));
    const tagged = [...refs.keys()].filter((r) => !r.endsWith('^{}') && tag.test(r) && peel(r) === sha).map((r) => r.match(tag)![1]);
    tagged.sort((a, b) => versionKey(a).localeCompare(versionKey(b)));
    if (tagged.length) return { sha, version: tagged.at(-1)!, version_source: 'tag stable-v' + tagged.at(-1) };
  }
  const file = layer.readFile(repo, sha, 'VERSION')?.trim();
  if (!file) throw new Error(repo + ': no VERSION file at ' + sha);
  return { sha, version: file, version_source: 'VERSION file' };
}

export function moves(layer: Layer, product: Product, from: string, to: string): Move[] {
  const { url, tag } = PRODUCTS[product];
  if (!SHA.test(from) || !SHA.test(to)) throw new Error('moves needs two full commit shas');
  const order = new Map(layer.revList(url, from, to).map((sha, i) => [sha, i]));
  const { refs, peel } = parseRefs(layer.lsRemote(url));
  return [...refs.keys()]
    .filter((r) => !r.endsWith('^{}') && tag.test(r) && order.has(peel(r)!))
    .map((r) => ({ tag: r.replace('refs/tags/', ''), version: r.match(tag)![1], sha: peel(r)! }))
    .sort((a, b) => order.get(a.sha)! - order.get(b.sha)! || versionKey(a.version).localeCompare(versionKey(b.version)));
}

const git = (args: string[], cwd?: string) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/** The network layer: git ls-remote, raw.githubusercontent.com, and a treeless fetch into ~/.cache/harness-evals-canary. */
export const networkLayer: Layer = {
  lsRemote: (url) => git(['ls-remote', url]),
  readFile(repo, sha, path) {
    const r = Bun.spawnSync(['curl', '-fsSL', '--max-time', '30', `https://raw.githubusercontent.com/${repo}/${sha}/${path}`], { stdout: 'pipe', stderr: 'pipe' });
    return r.exitCode === 0 ? r.stdout.toString() : null;
  },
  revList(url, from, to) {
    const cache = join(process.env.CANARY_GIT_CACHE || join(homedir(), '.cache', 'harness-evals-canary'), url.replace(/[^A-Za-z0-9]+/g, '_') + '.git');
    if (!existsSync(cache)) { mkdirSync(cache, { recursive: true }); git(['init', '--quiet', '--bare', cache]); }
    git(['fetch', '--quiet', '--filter=tree:0', '--no-tags', url, from, to], cache);
    return git(['rev-list', '--reverse', `${from}..${to}`], cache).split('\n').filter(Boolean);
  },
};

/** Answers from a recorded file: {ls_remote: {url: text}, files: {"repo@sha:path": text}, rev_list: {"url from..to": [sha]}}. */
export function fixtureLayer(path: string): Layer {
  const f = JSON.parse(readFileSync(path, 'utf8')) as { ls_remote: Record<string, string>; files?: Record<string, string>; rev_list?: Record<string, string[]> };
  return {
    lsRemote: (url) => f.ls_remote[url] ?? (() => { throw new Error(`fixture has no ls-remote for ${url}`); })(),
    readFile: (repo, sha, p) => f.files?.[`${repo}@${sha}:${p}`] ?? null,
    revList: (url, from, to) => f.rev_list?.[`${url} ${from}..${to}`] ?? (() => { throw new Error(`fixture has no rev-list for ${url} ${from}..${to}`); })(),
  };
}

if (import.meta.main) {
  const [cmd, ...argv] = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const fixture = flag('--fixture') ?? process.env.CANARY_RELEASES_FIXTURE;
  const layer = fixture ? fixtureLayer(fixture) : networkLayer;
  try {
    if (cmd === 'current') {
      const out = { gstack: current(layer, 'gstack'), gbrain: current(layer, 'gbrain') };
      console.log(JSON.stringify(out));
    } else if (cmd === 'describe') {
      const product = flag('--product') as Product;
      if (!(product in PRODUCTS) || !flag('--sha')) throw new Error('describe needs --product gstack|gbrain --sha <sha>');
      console.log(JSON.stringify(describe(layer, product, flag('--sha')!)));
    } else if (cmd === 'moves') {
      const product = flag('--product') as Product;
      if (!(product in PRODUCTS) || !flag('--from') || !flag('--to')) throw new Error('moves needs --product gstack|gbrain --from <sha> --to <sha>');
      console.log(JSON.stringify(moves(layer, product, flag('--from')!, flag('--to')!)));
    } else {
      console.error('usage: releases.ts current | moves --product gstack|gbrain --from <sha> --to <sha> | describe --product gstack|gbrain --sha <sha> [--fixture <file>]');
      process.exit(2);
    }
  } catch (error) {
    console.error('releases: ' + (error as Error).message);
    process.exit(1);
  }
}
