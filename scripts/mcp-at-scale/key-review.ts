#!/usr/bin/env bun
/** Amendment 2 (2026-11-23): a reviewed exemption for key-shaped text that is not a key, in one phase final.
 *  bun scripts/mcp-at-scale/key-review.ts --dir <phase final dir>
 *  The runner's key scan (run.ts scanForKeys) names files with key-shaped text and files holding an exact secret value.
 *  An exact-value hit is always fatal here: this script refuses and changes nothing. A pattern hit is exempt only when
 *  every non-allowlisted match of that pattern in that file is one of two classes:
 *    sk-test-fixture: a whole token under 40 characters made of sk-test and then only lowercase letters and dashes (a
 *      readable test placeholder; a live provider key is random mixed-case text);
 *    x-placeholder: a whole token that is sk- and then only the letter x, alone or after Bearer (a documentation
 *      placeholder such as an example Authorization header; amendment 4);
 *    trial-name: Bearer followed by exactly the name of the trial directory the hit file sits in (jobs/<cell>/<trial>/...),
 *      a public label the agent put in a header it made up (amendment 5);
 *    base64-run: the match is made only of run characters (letters, digits, '+', '-', '_') and sits in a run of at least
 *      200 of them that starts at least 64 characters before the match ('/', '=' and every other character end a run).
 *      This is random encoded data, such as encrypted reasoning, that happens to contain a key prefix; a key after a short
 *      name such as NAME= or inside a URL path is never exempt.
 *  Every hit file must be a regular file reached through no symlink inside the final, and no recorded path may itself
 *  hold key-shaped text.
 *  When every hit is covered it keeps the scan byte for byte as key-scan.raw.json, writes key-scan-review.json (file
 *  paths and classes, never the matched text) and rewrites key-scan.json with no pattern hits and a pointer to both. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ALLOW, TOKEN_PATTERNS } from '../publish-audit.ts';

export const MIN_RUN = 200;
export const MIN_MARGIN = 64;
const RUN = /[A-Za-z0-9+_-]/;

export type HitClass = 'sk-test-fixture' | 'x-placeholder' | 'trial-name' | 'base64-run';

export function classify(text: string, start: number, end: number, trial?: string): HitClass | null {
  let a = start;
  let b = end;
  while (a > 0 && RUN.test(text[a - 1]!)) a -= 1;
  while (b < text.length && RUN.test(text[b]!)) b += 1;
  const match = text.slice(start, end);
  if (trial && /^Bearer\s+/.test(match) && match.replace(/^Bearer\s+/, '') === trial && (end === text.length || !RUN.test(text[end]!))) return 'trial-name';
  if (/^(Bearer\s+)?sk-x+$/i.test(match) && (start === 0 || !RUN.test(text[start - 1]!)) && (end === text.length || !RUN.test(text[end]!))) return 'x-placeholder';
  if (!/^[A-Za-z0-9+_-]+$/.test(match)) return null;
  if (a === start && b === end && /^sk-test[a-z-]*$/.test(match) && match.length < 40) return 'sk-test-fixture';
  if (b - a >= MIN_RUN && start - a >= MIN_MARGIN) return 'base64-run';
  return null;
}

export interface Review { pattern: string; file: string; classes: HitClass[]; matches: number }

const keyShaped = (s: string) => Object.values(TOKEN_PATTERNS).some((re) => new RegExp(re.source).test(s));

/** A hit file as the scan saw it: a regular file under dir with no symlink anywhere on the way. */
function regularInside(dir: string, file: string): string | null {
  const root = realpathSync(dir);
  const path = resolve(root, file);
  if (!path.startsWith(root + '/')) return null;
  for (let p = path; p !== root; p = resolve(p, '..')) {
    try { if (lstatSync(p).isSymbolicLink()) return null; } catch { return null; }
  }
  return lstatSync(path).isFile() ? path : null;
}

export function reviewScan(dir: string, scan: { patterns?: Record<string, string[]>; values?: Record<string, string[]>; unreadable?: number }): { reviews: Review[]; problems: string[] } {
  const problems: string[] = [];
  if (!scan.patterns || !scan.values) problems.push('key-scan.json lacks patterns or values');
  if (scan.unreadable !== 0) problems.push('the key scan could not read ' + scan.unreadable + ' file(s)');
  for (const [name, files] of Object.entries(scan.values ?? {})) problems.push('exact value of ' + name + ' in ' + (files as string[]).join(', ') + ': fatal, no review');
  const reviews: Review[] = [];
  for (const [name, files] of Object.entries((scan.patterns ?? {}) as Record<string, string[]>)) {
    const re = TOKEN_PATTERNS[name];
    if (!re) { problems.push('unknown pattern ' + name); continue; }
    for (const file of files) {
      if (keyShaped(file)) { problems.push(name + ': a hit path holds key-shaped text'); continue; }
      const path = regularInside(dir, file);
      if (!path) { problems.push(name + ': not a regular file inside the final: ' + file); continue; }
      const text = readFileSync(path, 'latin1');
      const g = new RegExp(re.source, 'g');
      const classes = new Set<HitClass>();
      let matches = 0;
      for (let m = g.exec(text); m; m = g.exec(text)) {
        if (ALLOW.some((a) => a.test(m![0]))) continue;
        matches += 1;
        const c = classify(text, m.index, m.index + m[0].length, /^jobs\/[^/]+\/([^/]+)\//.exec(file)?.[1]);
        if (!c) { problems.push(name + ': an unexempted match in ' + file); break; }
        classes.add(c);
      }
      if (!matches) problems.push(name + ': no match left in ' + file);
      reviews.push({ pattern: name, file, classes: [...classes].sort(), matches });
    }
  }
  return { reviews, problems };
}

if (import.meta.main) {
  const i = process.argv.indexOf('--dir');
  const dir = i > 0 ? resolve(process.argv[i + 1] ?? '') : '';
  if (!dir || !existsSync(join(dir, 'key-scan.json'))) { console.error('usage: key-review.ts --dir <phase final dir holding key-scan.json>'); process.exit(2); }
  if (existsSync(join(dir, 'key-scan.raw.json')) || existsSync(join(dir, 'key-scan-review.json'))) { console.error('already reviewed: ' + dir); process.exit(2); }
  const raw = readFileSync(join(dir, 'key-scan.json'));
  const scan = JSON.parse(raw.toString('utf8'));
  if (!Object.keys(scan.patterns ?? {}).length && !Object.keys(scan.values ?? {}).length && scan.unreadable === 0) { console.log('clean scan; nothing to review'); process.exit(0); }
  const { reviews, problems } = reviewScan(dir, scan);
  if (problems.length) { console.error('not exempt; key-scan.json is unchanged:\n' + problems.map((p) => '  ' + p).join('\n')); process.exit(1); }
  const raw_sha256 = createHash('sha256').update(raw).digest('hex');
  writeFileSync(join(dir, 'key-scan.raw.json'), raw, { flag: 'wx' });
  writeFileSync(join(dir, 'key-scan-review.json'), JSON.stringify({ amendment: 2, at: new Date().toISOString(), raw: 'key-scan.raw.json', raw_sha256, rule: { exact_values: 'fatal', min_run: MIN_RUN, min_margin: MIN_MARGIN, sk_test_max_len: 39 }, hits: reviews }, null, 1) + '\n', { flag: 'wx' });
  writeFileSync(join(dir, 'key-scan.json'), JSON.stringify({ ...scan, patterns: {}, reviewed: { amendment: 2, raw: 'key-scan.raw.json', raw_sha256, review: 'key-scan-review.json', exempted: reviews.length } }, null, 1) + '\n');
  console.log('exempted ' + reviews.length + ' pattern hit(s) in ' + dir + ' (' + reviews.map((r) => r.pattern + ':' + r.classes.join('+')).join(', ') + ')');
}
