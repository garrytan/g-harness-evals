#!/usr/bin/env bun
// The size distribution of public AGENTS.md and CLAUDE.md files, and how many sit past each harness's cut. Costs no money:
// it reads the crawl cache that corpus/crawl.ts writes.
//
//   bun scripts/rules-at-scale/sizes/build-sizes.ts --cache <crawl dir>
//
// Writes scripts/rules-at-scale/sizes/sizes.json (one row per file: name, repo, path, commit, bytes, characters) and SIZES.md.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bodyKey, BANDS, bandQuery, queryFor, type Hit } from '../corpus/crawl.ts';
import { isRulesFile } from '../corpus/build-corpus.ts';
import { DIR } from '../lib.ts';

export const CUTS: Array<{ id: string; label: string; unit: 'bytes' | 'chars'; at: number; who: string }> = [
  { id: 'openclaw', label: 'OpenClaw cuts each file past 20,000 characters (bootstrapMaxChars)', unit: 'chars', at: 20000, who: 'OpenClaw' },
  { id: 'codex', label: 'Codex keeps only the first 32,768 bytes (project_doc_max_bytes)', unit: 'bytes', at: 32768, who: 'Codex' },
  { id: 'claude', label: 'Claude Code warns past 40,000 characters (and still sends the whole file)', unit: 'chars', at: 40000, who: 'Claude Code' },
  { id: 'hermes', label: 'Hermes cuts past about 48,000 characters on a 200K-token window', unit: 'chars', at: 48000, who: 'Hermes' },
];

/** Wilson 95% interval for k of n, as percentages with one decimal. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.959964, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, Math.round((c - h) * 1000) / 10), Math.min(100, Math.round((c + h) * 1000) / 10)];
}
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]!; };
const fmt = (n: number) => n.toLocaleString('en-US');

export interface Row { name: string; repo: string; path: string; commit: string; bytes: number; chars: number }

export function report(rows: Row[], counts: Record<string, number | null>, crawled: string, loose: { hits: number; dropped: number }): { json: string; md: string } {
  const L: string[] = [];
  const names = ['AGENTS.md', 'CLAUDE.md'];
  const by = (n: string) => rows.filter((r) => r.name === n);
  const both = rows.filter((r) => names.includes(r.name));
  const past = (rs: Row[], c: (typeof CUTS)[number]) => rs.filter((r) => (c.unit === 'bytes' ? r.bytes : r.chars) > c.at).length;
  const band = (name: string, lo: number) => BANDS.filter(([a]) => a >= lo).reduce((n, [a, b]) => n + (counts[bandQuery(name, a, b)] ?? NaN), 0);
  L.push('# How big are public AGENTS.md and CLAUDE.md files?', '');
  const codexAll = past(by('AGENTS.md'), CUTS[1]!), nA = by('AGENTS.md').length;
  const oc = past(both, CUTS[0]!);
  L.push('**Most public rules files are small, but a few percent already sit past a harness\'s cut.** In a sample of ' + fmt(both.length) + ' files, ' + oc + ' (' + wilson(oc, both.length).join(' to ') + '%) are longer than the 20,000 characters OpenClaw keeps whole, and ' + codexAll + ' of ' + nA + ' AGENTS.md files (' + wilson(codexAll, nA).join(' to ') + '%) are longer than the 32,768 bytes Codex reads.', '');
  L.push('**GitHub\'s index counts tell the same story:** about ' + fmt(band('AGENTS.md', 32769)) + ' of ' + fmt(counts[queryFor('AGENTS.md')] ?? NaN) + ' indexed AGENTS.md files are over 32,768 bytes.', '');
  L.push('Collected ' + crawled + ' with no paid calls. Method and limits are at the end.', '');
  L.push('## The sample: files past each cut', '');
  L.push('Sizes are exact, from each file at the commit GitHub code search returned. Ranges are 95% Wilson intervals.', '');
  L.push('| cut | AGENTS.md (n=' + by('AGENTS.md').length + ') | CLAUDE.md (n=' + by('CLAUDE.md').length + ') | both (n=' + both.length + ') |', '|---|---|---|---|');
  for (const c of CUTS) {
    const cell = (rs: Row[]) => { const k = past(rs, c); return k + ' (' + (rs.length ? Math.round(k / rs.length * 1000) / 10 : 0) + '%, ' + wilson(k, rs.length).join(' to ') + '%)'; };
    L.push('| ' + c.label + ' | ' + cell(by('AGENTS.md')) + ' | ' + cell(by('CLAUDE.md')) + ' | ' + cell(both) + ' |');
  }
  L.push('', 'The cut applies to the file its harness reads: Codex, OpenClaw and Hermes read AGENTS.md, Claude Code reads CLAUDE.md. The other column shows how common such sizes are anyway.', '');
  L.push('## Typical sizes in the sample', '');
  L.push('| file | n | median bytes | 75th percentile | 90th percentile | 99th percentile | largest |', '|---|---|---|---|---|---|---|');
  for (const n of names) { const xs = by(n).map((r) => r.bytes); if (xs.length) L.push('| ' + n + ' | ' + xs.length + ' | ' + [0.5, 0.75, 0.9, 0.99].map((q) => fmt(quantile(xs, q))).join(' | ') + ' | ' + fmt(Math.max(...xs)) + ' |'); }
  L.push('', '## GitHub\'s index counts per size band', '');
  L.push('These are the total_count values GitHub code search reports for each size band (in bytes). They cover every indexed file, not just the sample, but GitHub rounds and estimates them.', '');
  L.push('| bytes | AGENTS.md | CLAUDE.md |', '|---|---|---|');
  for (const [a, b] of BANDS) L.push('| ' + fmt(a) + (b === null ? ' and up' : ' to ' + fmt(b)) + ' | ' + fmt(counts[bandQuery('AGENTS.md', a, b)] ?? NaN) + ' | ' + fmt(counts[bandQuery('CLAUDE.md', a, b)] ?? NaN) + ' |');
  L.push('| all (unfiltered query) | ' + fmt(counts[queryFor('AGENTS.md')] ?? NaN) + ' | ' + fmt(counts[queryFor('CLAUDE.md')] ?? NaN) + ' |', '');
  for (const n of names) {
    const total = BANDS.reduce((s, [a, b]) => s + (counts[bandQuery(n, a, b)] ?? 0), 0);
    const parts = [[20001, 'over 20,000'], [32769, 'over 32,768'], [40001, 'over 40,000'], [48001, 'over 48,000']] as const;
    L.push('- ' + n + ': ' + parts.map(([lo, label]) => { const k = band(n, lo); return label + ' bytes: ' + fmt(k) + ' (' + (Math.round(k / total * 1000) / 10) + '% of the ' + fmt(total) + ' in the bands)'; }).join('; ') + '.');
  }
  L.push('', '## Method and limits', '');
  L.push('- **Sample:** the first pages of GitHub code search for `filename:AGENTS.md` and `filename:CLAUDE.md` (100 a page, 6 pages each), kept only when the file name matches exactly, each file fetched from raw.githubusercontent.com at the commit code search names. Code search ranks by its own relevance, so this is not a random sample; it leans toward repositories GitHub ranks highly.');
  L.push('- **Index counts:** one code search per size band, reading total_count. GitHub estimates these totals, indexes only default branches and files under 384 KB, and counts every path, so a repository can appear more than once. The band counts do not sum exactly to the unfiltered total.');
  L.push('- **Near names:** `filename:` search also matches names such as agents.mdx. The sample drops them (' + loose.dropped + ' of ' + loose.hits + ' AGENTS.md and CLAUDE.md hits); the index counts cannot, so they run a little high.');
  L.push('- **Characters versus bytes:** OpenClaw, Hermes and Claude Code count characters; Codex counts bytes. The sample uses each file\'s real character count; the index bands are bytes only, so they slightly overstate character-based cuts for files with non-ASCII text.');
  L.push('- **Hermes:** its cut scales with the model\'s context window (about 48,000 characters at 200K tokens, 240,000 at 1M); 48,000 is the 200K case.');
  L.push('- Rebuild: `bun scripts/rules-at-scale/corpus/crawl.ts --cache <dir>` then `bun scripts/rules-at-scale/sizes/build-sizes.ts --cache <dir>`. Every row is in [sizes.json](sizes.json).');
  const json = JSON.stringify({ crawled, cuts: CUTS, loose, index_counts: counts, rows }, null, 1) + '\n';
  return { json, md: L.join('\n') + '\n' };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--cache');
  if (i < 0) { console.error('usage: bun scripts/rules-at-scale/sizes/build-sizes.ts --cache <crawl dir>'); process.exit(2); }
  const cache = argv[i + 1]!;
  const hits = JSON.parse(readFileSync(join(cache, 'search.json'), 'utf8')) as Hit[];
  const rows: Row[] = [];
  const pair = hits.filter((h) => h.name === 'AGENTS.md' || h.name === 'CLAUDE.md');
  const loose = { hits: pair.length, dropped: pair.filter((h) => !isRulesFile(h)).length };
  for (const h of hits) {
    if (!isRulesFile(h)) continue;
    const f = join(cache, 'bodies', bodyKey(h) + '.txt');
    if (!existsSync(f)) continue;
    const buf = readFileSync(f);
    rows.push({ name: h.name, repo: h.repo, path: h.path, commit: h.commit, bytes: buf.length, chars: [...buf.toString('utf8')].length });
  }
  const counts = JSON.parse(readFileSync(join(cache, 'counts.json'), 'utf8')) as Record<string, number | null>;
  const crawled = (JSON.parse(readFileSync(join(DIR, 'corpus', 'sources.json'), 'utf8')) as { crawled: string }).crawled;
  const r = report(rows, counts, crawled, loose);
  writeFileSync(join(DIR, 'sizes', 'sizes.json'), r.json);
  writeFileSync(join(DIR, 'sizes', 'SIZES.md'), r.md);
  console.log('sizes: ' + rows.length + ' files');
}
