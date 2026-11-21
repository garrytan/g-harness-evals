#!/usr/bin/env bun
// Crawls public rules files (AGENTS.md, CLAUDE.md, GEMINI.md, .github/copilot-instructions.md) for two uses: the filler corpus
// of the rules-at-scale eval and the size distribution report. Costs no money. GitHub calls go through `gh api`: code search
// pages of 100 (10 calls a minute), one GraphQL query per 50 repositories for licence, language and fork status, and file
// bodies from raw.githubusercontent.com at the commit code search names, which costs no API call.
//
//   bun scripts/rules-at-scale/corpus/crawl.ts --cache <dir> [--pages 5] [--names AGENTS.md,CLAUDE.md,GEMINI.md,copilot-instructions.md]
//
// Writes into <dir> (scratch, never committed): search.json (every code search hit with its commit), counts.json (index-wide
// counts per size band from code search total_count), repos.json (licence, language, fork, stars, archived per repository),
// and bodies/<key>.txt for each fetched file. Re-running reuses what the cache holds.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export interface Hit { name: string; repo: string; path: string; commit: string; blob: string; fork: boolean }
export interface RepoMeta { repo: string; license: string | null; language: string | null; fork: boolean; archived: boolean; stars: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const bodyKey = (h: Pick<Hit, 'repo' | 'path' | 'commit'>) => createHash('sha256').update(h.repo + ':' + h.path + ':' + h.commit).digest('hex').slice(0, 24);

function gh(args: string[]): unknown {
  const p = Bun.spawnSync(['gh', 'api', ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error('gh api ' + args.slice(0, 3).join(' ') + ' failed: ' + p.stderr.toString().slice(0, 300));
  return JSON.parse(p.stdout.toString());
}

/** The code search query for one file name; copilot-instructions.md is only counted under .github/. */
export function queryFor(name: string): string {
  return name === 'copilot-instructions.md' ? 'filename:copilot-instructions.md path:.github' : 'filename:' + name;
}

let lastSearch = 0;
async function search(q: string, page: number, perPage: number): Promise<{ total_count: number; incomplete_results: boolean; items: Array<{ name: string; path: string; sha: string; url: string; repository: { full_name: string; fork: boolean } }> }> {
  const wait = lastSearch + 6500 - Date.now();
  if (wait > 0) await sleep(wait);
  lastSearch = Date.now();
  return gh(['-X', 'GET', 'search/code', '-f', 'q=' + q, '-f', 'per_page=' + perPage, '-f', 'page=' + page]) as never;
}

/** Size bands in bytes for the index-wide counts; the edges sit on the cuts the report names. */
export const BANDS: Array<[number, number | null]> = [[0, 1023], [1024, 2047], [2048, 4095], [4096, 8191], [8192, 16383], [16384, 20000], [20001, 32768], [32769, 40000], [40001, 48000], [48001, 65535], [65536, 131071], [131072, null]];
export const bandQuery = (name: string, lo: number, hi: number | null) => queryFor(name) + ' size:' + (hi === null ? '>=' + lo : lo + '..' + hi);

async function main() {
  const argv = process.argv.slice(2);
  const opt = (n: string, d?: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1]! : d; };
  const cache = opt('--cache');
  if (!cache) { console.error('usage: bun scripts/rules-at-scale/corpus/crawl.ts --cache <dir> [--pages 5] [--names ...]'); process.exit(2); }
  const pages = Number(opt('--pages', '5'));
  const names = opt('--names', 'AGENTS.md,CLAUDE.md,GEMINI.md,copilot-instructions.md')!.split(',');
  mkdirSync(join(cache, 'bodies'), { recursive: true });

  const searchFile = join(cache, 'search.json');
  const hits: Hit[] = existsSync(searchFile) ? JSON.parse(readFileSync(searchFile, 'utf8')) : [];
  const done = new Set(hits.map((h) => h.name + ':' + h.repo + ':' + h.path));
  const pagesFile = join(cache, 'pages.json');
  const pagesDone: string[] = existsSync(pagesFile) ? JSON.parse(readFileSync(pagesFile, 'utf8')) : [];
  for (const name of names) {
    const n = name === 'copilot-instructions.md' || name === 'GEMINI.md' ? Math.min(pages, 2) : pages;
    for (let page = 1; page <= n; page++) {
      const tag = name + '#' + page;
      if (pagesDone.includes(tag)) continue;
      const res = await search(queryFor(name), page, 100);
      for (const it of res.items) {
        const commit = /[?&]ref=([0-9a-f]{40})/.exec(it.url)?.[1];
        if (!commit) continue;
        const key = name + ':' + it.repository.full_name + ':' + it.path;
        if (done.has(key)) continue;
        done.add(key);
        hits.push({ name, repo: it.repository.full_name, path: it.path, commit, blob: it.sha, fork: it.repository.fork });
      }
      pagesDone.push(tag);
      writeFileSync(searchFile, JSON.stringify(hits, null, 1));
      writeFileSync(pagesFile, JSON.stringify(pagesDone));
      console.error('search ' + tag + ': ' + res.items.length + ' items, ' + hits.length + ' total');
      if (res.items.length < 100) break;
    }
  }

  const countsFile = join(cache, 'counts.json');
  const counts: Record<string, number | null> = existsSync(countsFile) ? JSON.parse(readFileSync(countsFile, 'utf8')) : {};
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const qs = [queryFor(name), ...BANDS.map(([lo, hi]) => bandQuery(name, lo, hi))];
    for (const q of qs) {
      if (q in counts) continue;
      const res = await search(q, 1, 1);
      counts[q] = res.incomplete_results ? null : res.total_count;
      writeFileSync(countsFile, JSON.stringify(counts, null, 1));
      console.error('count ' + q + ' = ' + counts[q]);
    }
  }

  const reposFile = join(cache, 'repos.json');
  const repos: Record<string, RepoMeta> = existsSync(reposFile) ? JSON.parse(readFileSync(reposFile, 'utf8')) : {};
  const want = [...new Set(hits.map((h) => h.repo))].filter((r) => !(r in repos));
  for (let i = 0; i < want.length; i += 50) {
    const batch = want.slice(i, i + 50);
    const fields = batch.map((full, j) => {
      const [owner, name] = full.split('/');
      return 'r' + j + ': repository(owner: ' + JSON.stringify(owner) + ', name: ' + JSON.stringify(name) + ') { nameWithOwner isFork isArchived stargazerCount licenseInfo { spdxId } primaryLanguage { name } }';
    });
    const p = Bun.spawnSync(['gh', 'api', 'graphql', '-f', 'query=query { ' + fields.join(' ') + ' }'], { stdout: 'pipe', stderr: 'pipe' });
    const out = JSON.parse(p.stdout.toString() || '{}') as { data?: Record<string, { isFork: boolean; isArchived: boolean; stargazerCount: number; licenseInfo: { spdxId: string } | null; primaryLanguage: { name: string } | null } | null> };
    batch.forEach((full, j) => {
      const r = out.data?.['r' + j];
      repos[full] = r ? { repo: full, license: r.licenseInfo?.spdxId ?? null, language: r.primaryLanguage?.name ?? null, fork: r.isFork, archived: r.isArchived, stars: r.stargazerCount } : { repo: full, license: null, language: null, fork: false, archived: false, stars: 0 };
    });
    writeFileSync(reposFile, JSON.stringify(repos, null, 1));
    console.error('graphql ' + (i + batch.length) + '/' + want.length);
  }

  let fetched = 0, failed = 0;
  const queue = hits.filter((h) => !existsSync(join(cache, 'bodies', bodyKey(h) + '.txt')) && !existsSync(join(cache, 'bodies', bodyKey(h) + '.missing')));
  const worker = async () => {
    for (let h = queue.shift(); h; h = queue.shift()) {
      const url = 'https://raw.githubusercontent.com/' + h.repo + '/' + h.commit + '/' + h.path.split('/').map(encodeURIComponent).join('/');
      try {
        const res = await fetch(url);
        if (!res.ok) { writeFileSync(join(cache, 'bodies', bodyKey(h) + '.missing'), String(res.status)); failed++; continue; }
        writeFileSync(join(cache, 'bodies', bodyKey(h) + '.txt'), new Uint8Array(await res.arrayBuffer()));
        fetched++;
      } catch (e) { failed++; console.error('fetch ' + url + ': ' + (e as Error).message); }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.error('bodies: ' + fetched + ' fetched, ' + failed + ' failed');
}

if (import.meta.main) await main();
