#!/usr/bin/env bun
// Builds the filler corpus of the rules-at-scale eval from the crawl cache (crawl.ts).
//
//   bun scripts/rules-at-scale/corpus/build-corpus.ts select --cache <dir> [--target-bytes 240000]
//       picks sources (each stored unchanged as the text field of files/<id>.json; see jsonText; MIT, BSD-2-Clause, BSD-3-Clause or Apache-2.0; not a fork, not archived; Python projects first, then by
//       stars; one file per repository; no email address or key-shaped text anywhere in the file), fetches each licence (and
//       an Apache NOTICE file when there is one) from raw.githubusercontent.com at the pinned commit, and writes corpus/files/,
//       corpus/LICENSES/ and corpus/sources.json. Network, no GitHub API calls.
//   bun scripts/rules-at-scale/corpus/build-corpus.ts build [--check]
//       offline: filters every source (filter.ts), draws the sections in one seeded order, and writes corpus/filler.json,
//       corpus/drop-list.json and corpus/DROPS.md (the drop list with counts per rung). --check rebuilds in memory and exits 1
//       when a committed file differs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bodyKey, type Hit, type RepoMeta } from './crawl.ts';
import { filterFile, REASONS, type Reason } from './filter.ts';
import { buildRung, bytesOf, charsOf, DIR, loadRules, sha256, type Filler, type FillerSection, type Source } from '../lib.ts';

const CORPUS = join(DIR, 'corpus');
export const ALLOWED = ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0'];
const NAME_RANK: Record<string, number> = { 'AGENTS.md': 0, 'CLAUDE.md': 1, 'GEMINI.md': 2, 'copilot-instructions.md': 3 };
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ALLOWED_EMAILS = new Set(['noreply@anthropic.com']);
const KEY = /\b(?:sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

/** JSON with every asterisk, slash, apostrophe and backtick written as a \u escape: the same data once parsed, but the raw text
 *  never holds a quoted Markdown glob or a path or quoted name of one of this repository's pages, which tests/docs-only.test.ts
 *  reads as a script that reads that page. Third-party rules files hold such text often. Storing the files as JSON also keeps
 *  the link checker off their relative links. */
export const jsonText = (v: unknown) => JSON.stringify(v, null, 1).replace(/[*/'\x60]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '\n';
/** The text of one stored source file. */
export const sourceText = (file: string) => (JSON.parse(readFileSync(file, 'utf8')) as { text: string }).text;

/** Code search matches file names loosely (agents.mdx for AGENTS.md); keep only exact rules-file names. */
export const isRulesFile = (h: Pick<Hit, 'name' | 'path'>) => h.name === 'copilot-instructions.md' ? /(?:^|\/)\.github\/copilot-instructions\.md$/.test(h.path) : h.path.split('/').pop() === h.name;

/** Leak scan of one file: email addresses (other than a generic no-reply trailer) and key-shaped strings. */
export function leaks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(EMAIL)) if (!ALLOWED_EMAILS.has(m[0].toLowerCase())) out.push('email');
  if (KEY.test(text)) out.push('key');
  return [...new Set(out)];
}

async function select(cache: string, targetBytes: number) {
  const hits = JSON.parse(readFileSync(join(cache, 'search.json'), 'utf8')) as Hit[];
  const repos = JSON.parse(readFileSync(join(cache, 'repos.json'), 'utf8')) as Record<string, RepoMeta>;
  const doc = loadRules();
  const reserved = Object.values(doc.headings);
  const cands = hits.filter((h) => {
    const r = repos[h.repo];
    return r && isRulesFile(h) && !h.fork && !r.fork && !r.archived && r.license && ALLOWED.includes(r.license) && existsSync(join(cache, 'bodies', bodyKey(h) + '.txt'));
  }).map((h) => ({ h, r: repos[h.repo]!, text: readFileSync(join(cache, 'bodies', bodyKey(h) + '.txt'), 'utf8') }))
    .filter((c) => bytesOf(c.text) >= 1500 && bytesOf(c.text) <= 80000 && !c.text.includes('\u0000') && leaks(c.text).length === 0)
    .sort((a, b) => (Number(b.r.language === 'Python') - Number(a.r.language === 'Python')) || (b.r.stars - a.r.stars) || (NAME_RANK[a.h.name]! - NAME_RANK[b.h.name]!) || a.h.path.split('/').length - b.h.path.split('/').length || a.h.repo.localeCompare(b.h.repo));
  const seen = new Set<string>();
  const picked: typeof cands = [];
  let kept = 0;
  for (const c of cands) {
    if (seen.has(c.h.repo)) continue;
    const f = filterFile(c.text, reserved);
    const k = f.sections.filter((s) => s.kept).reduce((n, s) => n + bytesOf(s.heading + '\n\n' + s.body + '\n') + 1, 0);
    if (k < 600) continue;
    seen.add(c.h.repo);
    picked.push(c);
    kept += Math.min(k, 30000);
    if (kept >= targetBytes) break;
  }
  mkdirSync(join(CORPUS, 'files'), { recursive: true });
  mkdirSync(join(CORPUS, 'LICENSES'), { recursive: true });
  const sources: Source[] = [];
  let n = 0;
  for (const c of picked) {
    const lic = await fetchFirst(c.h.repo, c.h.commit, ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENSE.rst', 'COPYING', 'LICENSE-MIT', 'License.txt', 'license', 'LICENCE']);
    if (!lic) { console.error('select: skipping ' + c.h.repo + ': no licence file at ' + c.h.commit); continue; }
    if (leaks(lic.text).includes('key')) { console.error('select: skipping ' + c.h.repo + ': key-shaped text in its licence'); continue; }
    const notice = c.r.license === 'Apache-2.0' ? await fetchFirst(c.h.repo, c.h.commit, ['NOTICE', 'NOTICE.txt', 'NOTICE.md']) : null;
    n++;
    const id = 's' + String(n).padStart(2, '0') + '-' + c.h.repo.replace('/', '--').replace(/[^A-Za-z0-9._-]/g, '_').toLowerCase();
    const file = 'files/' + id + '.json';
    writeFileSync(join(CORPUS, file), jsonText({ source: id, repo: c.h.repo, path: c.h.path, commit: c.h.commit, text: c.text }));
    const copyright = lic.text.split('\n').map((l) => l.trim()).filter((l) => /^(?:\(c\)\s*)?copyright\s*(?:\(c\)|\u00a9|\d{4})/i.test(l) && !/\[yyyy\]|\{yyyy\}|\[name of copyright owner\]/i.test(l));
    const licFile = 'LICENSES/' + id + '.txt';
    writeFileSync(join(CORPUS, licFile), 'Source: https://github.com/' + c.h.repo + '/blob/' + c.h.commit + '/' + c.h.path + '\nLicence file: ' + lic.name + ' at ' + c.h.commit + ' (' + c.r.license + ')\n\n' + lic.text + (notice ? '\n\n----- ' + notice.name + ' -----\n\n' + notice.text : ''));
    sources.push({ id, repo: c.h.repo, path: c.h.path, commit: c.h.commit, license: c.r.license!, file, sha256: sha256(c.text), bytes: bytesOf(c.text), copyright: copyright.length ? copyright.join(' / ') : 'no copyright line in the licence file; the ' + c.h.repo + ' authors', license_file: licFile, language: c.r.language });
  }
  writeFileSync(join(CORPUS, 'sources.json'), JSON.stringify({ crawled: new Date().toISOString().slice(0, 10), how: 'GitHub code search (filename:AGENTS.md, CLAUDE.md, GEMINI.md, .github/copilot-instructions.md), then the selection rule in build-corpus.ts select', sources }, null, 2) + '\n');
  console.log('select: ' + sources.length + ' sources');
}

async function fetchFirst(repo: string, commit: string, names: string[]): Promise<{ name: string; text: string } | null> {
  for (const name of names) {
    const res = await fetch('https://raw.githubusercontent.com/' + repo + '/' + commit + '/' + name);
    if (res.ok) return { name, text: await res.text() };
  }
  return null;
}

export interface DropRow { source: string; slot: number | null; line: number; lines: number; unit: string; reasons: Reason[]; text: string }
export interface Built { filler: Filler & { slots: number[] }; drops: DropRow[]; md: string; dropsJson: string; fillerJson: string; notices: string }

/** NOTICES.md: one row per source with its licence, copyright line and licence file. */
export function notices(sources: Source[]): string {
  const L = ['# Notices for the filler corpus', '', '**Every file in files/ is a rules file from a public repository, kept unchanged at the commit named here. Each keeps its own licence.**', '', '- Our own code is MIT and our docs are CC BY 4.0. Neither covers these files.', '- The eval plants filtered sections of these files beside its own six rules ([DROPS.md](DROPS.md) lists what the filter removed). The full licence text of each repository, with any Apache NOTICE file, is in LICENSES/.', '', '| id | repository | file | commit | licence | copyright | licence text |', '|---|---|---|---|---|---|---|'];
  for (const s of sources) L.push('| ' + s.id + ' | ' + s.repo + ' | ' + s.path + ' | ' + s.commit.slice(0, 12) + ' | ' + s.license + ' | ' + s.copyright.replace(/\|/g, '/') + ' | [' + s.license_file + '](' + s.license_file + ') |');
  return L.join('\n') + '\n';
}

/** The offline build: filter, seeded order, drop counts per rung. */
export function build(sources: Source[] = (JSON.parse(readFileSync(join(CORPUS, 'sources.json'), 'utf8')) as { sources: Source[] }).sources): Built {
  const doc = loadRules();
  const reserved = Object.values(doc.headings);
  const all: Array<{ source: string; index: number; heading: string; body: string; kept: boolean; key: string }> = [];
  const drops: Array<DropRow & { section: number | null }> = [];
  for (const s of sources) {
    const text = sourceText(join(CORPUS, s.file));
    if (sha256(text) !== s.sha256) throw new Error(s.file + ' does not match its sha256 in sources.json');
    const f = filterFile(text, reserved);
    if (f.preamble) drops.push({ source: s.id, slot: null, section: null, ...f.preamble });
    f.sections.forEach((sec, i) => all.push({ source: s.id, index: i, heading: sec.heading, body: sec.body, kept: sec.kept, key: sha256(doc.filler_seed + ':' + s.id + ':' + sec.first_line) }));
    for (const d of f.drops) drops.push({ source: s.id, slot: null, ...d });
  }
  all.sort((a, b) => a.key.localeCompare(b.key));
  const slotOf = new Map(all.map((s, i) => [s.source + '#' + s.index, i]));
  for (const d of drops) if (d.section !== null) d.slot = slotOf.get(d.source + '#' + d.section) ?? null;
  const sections: FillerSection[] = [];
  const slots: number[] = [];
  all.forEach((s, slot) => {
    if (!s.kept) return;
    sections.push({ id: 'f' + String(sections.length + 1).padStart(4, '0'), source: s.source, heading: s.heading, text: s.heading + '\n\n' + s.body + '\n' });
    slots.push(slot);
  });
  const filler = { version: 1, seed: doc.filler_seed, slots, sections };
  const rungs: Array<[string, number]> = [];
  for (const [rung, size] of Object.entries(doc.sizes)) {
    const b = buildRung(doc, filler, 0, size);
    rungs.push([rung + ' (' + size + ' bytes)', b.pieces.length ? slots[b.pieces.at(-1)!.section]! : -1]);
  }
  const qm = buildRung(doc, filler, 0, doc.qm_top_max_chars, charsOf, true);
  rungs.push(['qm-top (' + doc.qm_top_max_chars + ' characters)', qm.pieces.length ? slots[qm.pieces.at(-1)!.section]! : -1]);
  const rows: DropRow[] = drops.map(({ section: _s, ...d }) => d);
  const used = (upTo: number) => rows.filter((d) => d.slot !== null && d.slot <= upTo);
  const L: string[] = [];
  L.push('# Filler drop list', '');
  L.push('**The filler is real rules files from public repositories. Every unit that touches a planted rule\'s topic is dropped before any text is planted.**', '');
  L.push('- A unit is a section under a matching heading, a code block, a list item with its indented lines, a table row or a paragraph. One matching line drops the whole unit.');
  L.push('- R1 to R6 are the planted rules\' topics: changes files and file naming (R1); precheck, lint, format, check scripts and finishing steps (R2); tests (R3); commits, sign-off, git and push (R4); notes and looking things up before an edit (R5); diffs (R6). "network" is installs and the network. "blocks_one_turn" is a line that tells the agent to ask, confirm with or wait for a person, which a one-turn run with no one to answer cannot do. "missing_tool" is a line that needs a tool, tracker, service or project command the task image does not have (an issue tracker, an MCP server, docker compose, make targets).');
  L.push('- The other reasons drop text that is unsafe to plant: an at sign (Claude Code and Gemini CLI expand @path text), a link, an email address, a key-shaped string, a mention of a rules file by name, an HTML comment (Claude Code strips them from CLAUDE.md), a line that is mostly not English (under 80% of its letters A to Z, or at least 6 words with 2 or more Spanish, Portuguese, French, German or Italian function words and no English ones), or a heading that repeats a planted section\'s heading.');
  L.push('- Text before a file\'s first heading is dropped too, because it has no heading to sit under. It is listed as "preamble".');
  L.push('- A rung counts the drops from every section it reaches in the seeded order, including the section it cuts. The full list, with each unit\'s text, is in [drop-list.json](drop-list.json). Rebuild with `bun scripts/rules-at-scale/corpus/build-corpus.ts build`.', '');
  L.push('## Counts per rung', '');
  L.push('A unit dropped for several reasons counts once under each reason, so a row can sum to more than its "units dropped" column.', '');
  L.push('| rung | sections reached | units dropped | lines dropped | ' + REASONS.join(' | ') + ' |');
  L.push('|---|---|---|---|' + REASONS.map(() => '---').join('|') + '|');
  for (const [label, upTo] of rungs) {
    const ds = used(upTo);
    L.push('| ' + label + ' | ' + (upTo + 1) + ' | ' + ds.length + ' | ' + ds.reduce((n, d) => n + d.lines, 0) + ' | ' + REASONS.map((r) => ds.filter((d) => d.reasons.includes(r)).length).join(' | ') + ' |');
  }
  L.push('| whole corpus | ' + all.length + ' | ' + rows.length + ' | ' + rows.reduce((n, d) => n + d.lines, 0) + ' | ' + REASONS.map((r) => rows.filter((d) => d.reasons.includes(r)).length).join(' | ') + ' |', '');
  const pre = rows.filter((d) => d.unit === 'preamble');
  L.push('The whole-corpus row includes ' + pre.length + ' preambles (' + pre.reduce((n, d) => n + d.lines, 0) + ' lines), which no rung counts.', '');
  L.push('## Kept and dropped per source', '');
  L.push('| source | licence | file bytes | kept bytes | units dropped |', '|---|---|---|---|---|');
  for (const s of sources) {
    const kept = sections.filter((x) => x.source === s.id).reduce((n, x) => n + bytesOf(x.text), 0);
    L.push('| ' + s.id + ' | ' + s.license + ' | ' + s.bytes + ' | ' + kept + ' | ' + rows.filter((d) => d.source === s.id).length + ' |');
  }
  L.push('', 'Kept filler in total: ' + sections.length + ' sections, ' + sections.reduce((n, x) => n + bytesOf(x.text), 0) + ' bytes.');
  return { filler, drops: rows, md: L.join('\n') + '\n', dropsJson: jsonText(rows), fillerJson: jsonText(filler), notices: notices(sources) };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const opt = (n: string, d?: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1]! : d; };
  if (argv[0] === 'select') {
    const cache = opt('--cache');
    if (!cache) { console.error('usage: build-corpus.ts select --cache <dir> [--target-bytes N]'); process.exit(2); }
    await select(cache, Number(opt('--target-bytes', '240000')));
  } else if (argv[0] === 'build') {
    const b = build();
    const files: Array<[string, string]> = [['filler.json', b.fillerJson], ['drop-list.json', b.dropsJson], ['DROPS.md', b.md], ['NOTICES.md', b.notices]];
    if (argv.includes('--check')) {
      const bad = files.filter(([f, t]) => !existsSync(join(CORPUS, f)) || readFileSync(join(CORPUS, f), 'utf8') !== t).map(([f]) => f);
      if (bad.length) { console.error('build-corpus: out of date: ' + bad.join(', ')); process.exit(1); }
      console.log('build-corpus: up to date');
    } else {
      for (const [f, t] of files) writeFileSync(join(CORPUS, f), t);
      console.log('build-corpus: ' + b.filler.sections.length + ' sections, ' + b.drops.length + ' drops');
    }
  } else { console.error('usage: build-corpus.ts select|build ...'); process.exit(2); }
}
