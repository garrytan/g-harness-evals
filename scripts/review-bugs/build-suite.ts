#!/usr/bin/env bun
// Writes the real-bug review eval's suite (plan internal-task, "Bug set (the suite)" and "Freeze"; build step 1).
//
//   bun scripts/review-bugs/build-suite.ts --work <dir> --out <dir> --gstack-evals <checkout> [--harness-evals <checkout>]
//       [--id review-real-bugs-2026-11] [--h-units 18] [--seed 2665]
//
// Output, in gstack-evals' review no-loss format (lanes/review-noloss/suite.ts) so its noloss commands read it with
// --sealed-root <out>:
// - <out>/suites/<id>.json: the suite. sealed is true because the suite stays private until the results. Each unit is a
//   PR at one head against its base (the merge-base), with one blocker per known bug pointing at a catalog case. Units
//   carry four fields the format does not require and does not reject: rank (the order to take the first N non-gstack
//   units in), stratum (S1, S2, S3, N or H), repro_confirmed (true, false, or null when no test could be run) and
//   evidence (a pointer: the review comment's URL, or the fix PR's).
// - <out>/catalog/<case>.json: one case per blocker, in our own words (U13 schema), each with its fix commit, how it was
//   screened, the repro result and where it came from. No third-party comment text and no contributor name.
// - <out>/units-build.json: what build-unit.ts needs per unit: the base branch name and the fixes the unit must not hold.
//
// Strata and groups. S1 (a human reviewer's comment followed by a fix before merge), S2 split by the review tool's model
// family (S2-openai, S2-google, S2-anthropic, S2-mixed), S3 (escaped: a later fix PR points at this PR), N (decoys, each
// with one bait blocker so noloss's false-alarm gate counts it as a decoy), H-stacks-r1 and H-206 (home field). Only
// bugs the screen kept (both judges blocking, second read confirmed) become blockers. S3 bugs count only when their repro
// confirmed them, as the plan requires; S1 and S2 bugs are kept either way, with repro_confirmed recorded.
//
// Ranking. Non-gstack units are ranked so that any prefix keeps the plan's mix as closely as the yield allows (40% S1,
// 20% S2, 40% S3: each next unit comes from the stratum furthest below its share; an exhausted stratum's share passes to
// the others, which is the plan's S1 and S2 fallback when S3 is short), never more than 4 units from one repository
// (decoys included), repro-confirmed units first within a stratum, then a seeded order. H draws --h-units stacks-r1 units,
// one per PR, by seeded draw split between gstack and gbrain in proportion, plus the #206 units (home-206.json).

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { git, hunks, addedRanges, isCodePath } from './git.ts';
import { cloneDir, MAX_UNITS_PER_REPO, readJsonl, type Candidate } from './mine.ts';
import type { ScreenLine } from './screen.ts';

export const TARGET_MIX: Readonly<Record<string, number>> = { S1: 0.4, S2: 0.2, S3: 0.4 };
export const GROUPS: Readonly<Record<string, string>> = {
  'S1': 'A human reviewer\'s comment on the PR, followed before merge by a commit that changed the lines it named.',
  'S2-openai': 'The same, from a review tool on an OpenAI model (partly home field for GPT cells).',
  'S2-google': 'The same, from a review tool on a Google model.',
  'S2-anthropic': 'The same, from a review tool on an Anthropic model.',
  'S2-mixed': 'The same, from a review tool whose vendor routes between labs or names none.',
  'S3': 'Escaped: a later fix PR points at this PR as the one that introduced the bug; the unit is this PR at its own head against its own base.',
  'N': 'Decoy: a merged PR whose added lines no commit touched for 90 days; read for false alarms only. Its one blocker is a bait.',
  'H-stacks-r1': 'Home field: gstack-evals stacks-r1 units, bugs gstack-family reviews found first. Reported apart, never in the headline.',
  'H-206': 'Home field: harness-evals #206 CRITICALs, gstack plus a second model family. Reported apart, never in the headline.',
};

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const seeded = (seed: number, s: string) => sha256(seed + ':' + s);
const unitId = (repo: string, pr: number, head: string) => repo + '#' + pr + '@' + head.slice(0, 12);
const caseSlug = (repo: string, pr: number, n: number) => ('rrb-' + repo.replace(/[^A-Za-z0-9]+/g, '-') + '-' + pr + '-b' + n).toLowerCase();

export interface ReproLine { unit: string; bug: number; status: 'confirmed' | 'not-confirmed' | 'inconclusive' | 'no-test'; log_sha256: string | null; detail: string }

export interface RankItem { id: string; repo: string; stratum: 'S1' | 'S2' | 'S3'; repro: boolean }

/** Ranks units so each prefix keeps the target mix as well as the yield allows, with at most cap per repository. */
export function rankUnits(items: readonly RankItem[], seed: number, cap: number, repoCount: Map<string, number> = new Map()): RankItem[] {
  const pools = new Map<string, RankItem[]>();
  for (const it of items) pools.set(it.stratum, [...(pools.get(it.stratum) ?? []), it]);
  for (const list of pools.values()) list.sort((a, b) => Number(b.repro) - Number(a.repro) || (seeded(seed, a.id) < seeded(seed, b.id) ? -1 : 1));
  const out: RankItem[] = [];
  const taken = new Map<string, number>();
  const count = new Map(repoCount);
  for (;;) {
    const open = Object.keys(TARGET_MIX).filter((s) => (pools.get(s) ?? []).some((it) => (count.get(it.repo) ?? 0) < cap));
    if (!open.length) break;
    const share = open.reduce((a, s) => a + TARGET_MIX[s]!, 0);
    const n = out.length + 1;
    const s = open.sort((a, b) => ((taken.get(a) ?? 0) - n * TARGET_MIX[a]! / share) - ((taken.get(b) ?? 0) - n * TARGET_MIX[b]! / share))[0]!;
    const list = pools.get(s)!;
    const i = list.findIndex((it) => (count.get(it.repo) ?? 0) < cap);
    const [it] = list.splice(i, 1);
    out.push(it!);
    taken.set(s, (taken.get(s) ?? 0) + 1);
    count.set(it!.repo, (count.get(it!.repo) ?? 0) + 1);
  }
  return out;
}

/** Whether the line is one the unit's diff adds, sits in a file it changes, or is outside it. */
function location(dir: string, base: string, head: string, file: string, line: number): 'added' | 'context' | 'outside' {
  const d = git(dir, ['diff', '-U0', base + '...' + head, '--', file]);
  if (!d.out.trim()) return 'outside';
  return addedRanges(hunks(d.out)).some(([a, b]) => line >= a && line <= b) ? 'added' : 'context';
}

const commitDate = (dir: string, sha: string) => git(dir, ['log', '-1', '--format=%cs', sha]).out.trim() || '2026-11-13';

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const val = (k: string, d?: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1]! : d; };
  const work = resolve(val('--work')!), out = resolve(val('--out')!), gev = resolve(val('--gstack-evals')!);
  const hev = resolve(val('--harness-evals', join(import.meta.dir, '..', '..'))!);
  const id = val('--id', 'review-real-bugs-2026-11')!, seed = Number(val('--seed', '2665')), hUnits = Number(val('--h-units', '18'));
  const today = new Date().toISOString().slice(0, 10);
  mkdirSync(join(out, 'suites'), { recursive: true });
  mkdirSync(join(out, 'catalog'), { recursive: true });
  const repos = new Map(JSON.parse(readFileSync(join(work, 'repos.json'), 'utf8')).kept.map((r: any) => [r.repo, r.default_branch]));
  const cands = new Map(readJsonl<Candidate>(join(work, 'candidates.jsonl')).map((c) => [c.id, c]));
  const screen = readJsonl<ScreenLine>(join(work, 'screen', 'screen.jsonl'));
  const reproFile = join(work, 'repro', 'results.jsonl');
  const repro = new Map((existsSync(reproFile) ? readJsonl<ReproLine>(reproFile) : []).map((r) => [r.unit + ' ' + r.bug, r]));
  const units: any[] = [];
  const build: Record<string, { base_branch: string; forbidden: { commits: string[]; prs: number[] } }> = {};
  const excluded: Array<{ ref: string; reason: string }> = [];
  const kept = new Map<string, ScreenLine[]>();
  for (const l of screen) if (l.kept && l.final) kept.set(l.unit, [...(kept.get(l.unit) ?? []), l]);

  // Non-gstack strata.
  const bugUnits: Array<{ item: RankItem; unit: any; cases: any[]; fixes: string[]; fixPrs: number[] }> = [];
  for (const [uid, lines] of kept) {
    const c = cands.get(uid)!;
    const dir = cloneDir(work, c.repo);
    const blockers: any[] = [], cases: any[] = [], fixes: string[] = [], fixPrs: number[] = [];
    let anyRepro = false, allTried = true;
    for (const l of lines.sort((a, b) => a.bug - b.bug)) {
      const bug = c.bugs[l.bug]!;
      const rp = repro.get(uid + ' ' + l.bug) ?? null;
      if (c.stratum === 'S3' && rp?.status !== 'confirmed') { excluded.push({ ref: uid + ' bug ' + l.bug, reason: 'S3 bug without a confirming repro (' + (rp?.status ?? 'not run') + ')' }); continue; }
      if (rp?.status === 'confirmed') anyRepro = true;
      if (!rp || rp.status === 'no-test') allTried = false;
      const f0 = l.final!;
      if (blockers.some((b) => b.file === f0.file && Math.abs(b.line - f0.line) <= 3)) { excluded.push({ ref: uid + ' bug ' + l.bug, reason: 'same defect as an earlier blocker in this unit (same file, within 3 lines)' }); continue; }
      const n = blockers.length + 1;
      const caseId = caseSlug(c.repo, c.pr, n) + '-' + c.head!.slice(0, 7);
      const f = l.final!;
      const fixParent = bug.fix.kind === 'later-pr' ? git(dir, ['rev-parse', bug.fix.commit + '^']).out.trim() : c.head!;
      const tool = bug.source.tool ? bug.source.tool + ' (' + bug.source.tool_family + ' family)' : null;
      blockers.push({ id: 'B' + n, case: caseId, paths: [f.file], file: f.file, line: f.line, location: location(dir, c.base!, c.head!, f.file, f.line), counts: 'blocking' });
      cases.push({
        schema_version: 1, id: caseId, visibility: 'sealed', repo: c.repo, pr: c.pr, reviewed_head: c.head, merge_base: c.base,
        diff_range: { from: c.base, to: c.head, note: c.stratum === 'S3' ? 'The introducing PR at its own head against its own base.' : 'The PR at the commit before the fix.' },
        roles: [{ role: 'red-team' }],
        defect: { file: f.file, line: f.line, summary: f.description },
        severity: { deserved: 'CRITICAL', basis: 'Both screening judges (GPT-6 Astra, Claude Opus 5.5) rated it blocking under R12 (' + f.category + '): ' + f.why_blocking + ' A second read on GPT-6 Astra confirmed the fix commit removes the defect described.', in_history: [{ by: c.stratum === 'S1' ? 'a human reviewer on the PR' : c.stratum === 'S2' ? 'a review tool on the PR: ' + tool : 'a later fix PR (#' + bug.fix.pr + ')', rated: c.stratum === 'S3' ? 'fixed after merge, pointing at this PR' : 'asked for a change; the lines were changed before merge' }] },
        fix: { commit: bug.fix.commit, pr: bug.fix.pr },
        decoys: [{ kind: 'fix-commit', repo: c.repo, pr: bug.fix.pr, range: { from: fixParent, to: bug.fix.commit }, audit: null }],
        receipt: { source: bug.source.url, evidence: [
          'stratum ' + c.stratum + (tool ? ', ' + tool : '') + (c.link ? ', linked by ' + c.link.via : ''),
          'fix ' + bug.fix.commit.slice(0, 12) + ' (' + bug.fix.kind + ') changes the named lines; tests it touched: ' + (bug.fix.tests.length ? bug.fix.tests.slice(0, 5).join(', ') : 'none'),
          'repro: ' + (rp ? rp.status + (rp.log_sha256 ? ' (log sha256 ' + rp.log_sha256 + ')' : '') + ': ' + rp.detail : 'not run'),
        ] },
        answer_key_audit: { by: 'two-judge screen and second read (harness-evals scripts/review-bugs/screen.ts)', at: today, verdict: 'confirmed', notes: 'Kept because both judges said real, present at the head and blocking, and the second read found the fix removes it. The description shares no 8-word run with the source text.' },
        shelf_life: { first_appeared: commitDate(dir, bug.fix.commit), source: 'git: the fix commit\'s committer date', short: false },
        credit: 'Found on the public PR by ' + (c.stratum === 'S1' ? 'a human reviewer' : c.stratum === 'S2' ? 'a review tool' : 'the maintainers, in a later fix') + '; restated in our own words. Contributor names are not recorded.',
      });
      fixes.push(bug.fix.commit);
      fixPrs.push(...(bug.fix.pr !== c.pr ? [bug.fix.pr] : []));
    }
    if (!blockers.length) continue;
    const s2 = c.stratum === 'S2' ? 'S2-' + (c.bugs[lines[0]!.bug]!.source.tool_family ?? 'mixed') : c.stratum;
    const uidFull = unitId(c.repo, c.pr, c.head!);
    bugUnits.push({ item: { id: uidFull, repo: c.repo, stratum: c.stratum as RankItem['stratum'], repro: anyRepro }, unit: { id: uidFull, repo: c.repo, pr: c.pr, head: c.head, base: c.base, cluster: c.repo + '#' + c.pr, group: s2, stratum: s2.startsWith('S2') ? s2 : c.stratum, repro_confirmed: anyRepro ? true : allTried ? false : null, evidence: c.bugs[lines[0]!.bug]!.source.url, blockers }, cases, fixes, fixPrs });
  }
  const seen = new Set<string>();
  const dedup = bugUnits.filter((b) => !seen.has(b.item.id) && (seen.add(b.item.id), true));
  const ranked = rankUnits(dedup.map((b) => b.item), seed, MAX_UNITS_PER_REPO);
  const rankedIds = new Set(ranked.map((r) => r.id));
  for (const b of dedup) if (!rankedIds.has(b.item.id)) excluded.push({ ref: b.item.id, reason: 'over the 4-units-per-repository limit' });
  const byId = new Map(dedup.map((b) => [b.item.id, b]));
  const repoCount = new Map<string, number>();
  ranked.forEach((r, i) => {
    const b = byId.get(r.id)!;
    units.push({ ...b.unit, rank: i + 1 });
    for (const cs of b.cases) writeFileSync(join(out, 'catalog', cs.id + '.json'), JSON.stringify(cs, null, 2) + '\n');
    build[r.id] = { base_branch: String(repos.get(r.repo) ?? 'main'), forbidden: { commits: [...new Set(b.fixes)], prs: [...new Set(b.fixPrs)] } };
    repoCount.set(r.repo, (repoCount.get(r.repo) ?? 0) + 1);
  });

  // Decoys: 15 from repositories with room under the cap.
  const decoys = existsSync(join(work, 'decoys.jsonl')) ? readJsonl<Candidate>(join(work, 'decoys.jsonl')) : [];
  let nDecoys = 0;
  for (const d of decoys.sort((a, b) => (seeded(seed, a.id) < seeded(seed, b.id) ? -1 : 1))) {
    if (nDecoys >= 15) break;
    if ((repoCount.get(d.repo) ?? 0) >= MAX_UNITS_PER_REPO) continue;
    const dir = cloneDir(work, d.repo);
    const files = git(dir, ['diff', '--numstat', d.base! + '...' + d.head!]).out.split('\n').filter(Boolean).map((l) => l.split('\t')).filter((p) => p[2] && isCodePath(p[2]!)).sort((a, b) => Number(b[0]) - Number(a[0]));
    const file = files[0]?.[2];
    if (!file) continue;
    const first = addedRanges(hunks(git(dir, ['diff', '-U0', d.base! + '...' + d.head!, '--', file]).out))[0];
    if (!first) continue;
    const caseId = caseSlug(d.repo, d.pr, 1) + '-decoy';
    writeFileSync(join(out, 'catalog', caseId + '.json'), JSON.stringify({
      schema_version: 1, id: caseId, visibility: 'sealed', repo: d.repo, pr: d.pr, reviewed_head: d.head, merge_base: d.base,
      diff_range: { from: d.base, to: d.head, note: 'Decoy: the merged PR at its own head against its own base.' },
      roles: [{ role: 'red-team' }],
      defect: { file, line: first[0], summary: 'Decoy bait, not a defect: this PR has no known bug. The marker sits on the first line the PR adds to its largest changed code file only so the scorer treats the unit as a decoy; a must-fix finding here or anywhere in the PR is a false alarm unless adjudicated a real defect.' },
      severity: { deserved: 'INFORMATIONAL', basis: d.decoy_audit ?? 'no later change to its added lines within 90 days', in_history: [{ by: 'decoy selection (scripts/review-bugs/mine.ts decoys)', rated: 'no known defect' }] },
      fix: { commit: d.head, pr: d.pr },
      decoys: [{ kind: 'clean-pr', repo: d.repo, pr: d.pr, range: { from: d.base, to: d.head }, audit: { later_fix_checked: true, later_fix: null, verdict: 'clean', by: 'scripts/review-bugs/mine.ts decoys', at: today, method: d.decoy_audit ?? '' } }],
      receipt: { source: 'https://github.com/' + d.repo + '/pull/' + d.pr, evidence: [d.decoy_audit ?? ''] },
      answer_key_audit: { by: 'scripts/review-bugs/mine.ts decoys (mechanical)', at: today, verdict: 'confirmed', notes: 'A decoy has no defect to confirm; confirmed means the 90-day check passed.' },
      shelf_life: { first_appeared: d.merged_at.slice(0, 10), source: 'search API merged_at', short: false },
      credit: 'A merged public PR used as a decoy. Contributor names are not recorded.',
    }, null, 2) + '\n');
    const uid = unitId(d.repo, d.pr, d.head!);
    units.push({ id: uid, repo: d.repo, pr: d.pr, head: d.head, base: d.base, cluster: d.repo + '#' + d.pr, group: 'N', stratum: 'N', repro_confirmed: null, evidence: 'https://github.com/' + d.repo + '/pull/' + d.pr, rank: null, blockers: [{ id: 'B1', case: caseId, paths: [file], file, line: first[0], location: 'added', counts: 'over-blocking' }] });
    build[uid] = { base_branch: String(repos.get(d.repo) ?? 'main'), forbidden: { commits: [], prs: [] } };
    repoCount.set(d.repo, (repoCount.get(d.repo) ?? 0) + 1);
    nDecoys += 1;
  }

  // H: stacks-r1, one unit per PR with a blocking blocker, seeded draw split by repository in proportion.
  const sr = JSON.parse(readFileSync(join(gev, 'wiki/plans/2026-10-31-geva-76-stacks-round-1-prereg/stacks-r1.json'), 'utf8'));
  const perCluster = new Map<string, any>();
  for (const u of sr.units) if (u.blockers.some((b: any) => b.counts === 'blocking') && !perCluster.has(u.cluster)) perCluster.set(u.cluster, u);
  const byRepo = new Map<string, any[]>();
  for (const u of perCluster.values()) byRepo.set(u.repo, [...(byRepo.get(u.repo) ?? []), u]);
  const total = perCluster.size;
  const drawn: any[] = [];
  const shares = [...byRepo].map(([repo, list]) => ({ repo, list: list.sort((a, b) => (seeded(seed, a.id) < seeded(seed, b.id) ? -1 : 1)), n: Math.round(hUnits * list.length / total) }));
  for (const s of shares) drawn.push(...s.list.slice(0, s.n));
  for (const u of sr.units) if (!drawn.includes(u)) excluded.push({ ref: u.id, reason: perCluster.get(u.cluster) === u ? 'stacks-r1 unit not drawn for H (seed ' + seed + ', ' + hUnits + ' units)' : u.blockers.every((b: any) => b.counts !== 'blocking') ? 'stacks-r1 unit with no blocking blocker' : 'second head of a stacks-r1 PR already in the draw pool' });
  const catDirs = sr.catalogs.map((c: string) => join(gev, c));
  for (const u of drawn) {
    const blockers = u.blockers.filter((b: any) => b.counts === 'blocking');
    for (const b of blockers) {
      const src = catDirs.map((d: string) => join(d, b.case + '.json')).find((p: string) => existsSync(p));
      if (!src) throw new Error('no catalog case ' + b.case + ' in ' + sr.catalogs.join(', '));
      cpSync(src, join(out, 'catalog', b.case + '.json'));
    }
    units.push({ ...u, group: 'H-stacks-r1', stratum: 'H', repro_confirmed: null, evidence: 'gstack-evals stacks-r1 (wiki/plans/2026-10-31-geva-76-stacks-round-1-prereg/stacks-r1.json)', rank: null, blockers: blockers.map((b: any, i: number) => ({ ...b, id: 'B' + (i + 1) })) });
    build[u.id] = { base_branch: u.repo === 'garrytan/gbrain' ? 'master' : 'main', forbidden: { commits: [], prs: [] } };
  }

  // H: harness-evals #206.
  const h206 = JSON.parse(readFileSync(join(import.meta.dir, 'home-206.json'), 'utf8'));
  for (const hu of h206.units) {
    const mb = git(hev, ['merge-base', hu.head, 'origin/main']).out.trim();
    if (!mb) { excluded.push({ ref: h206.repo + '#' + h206.pr + '@' + hu.head.slice(0, 12), reason: 'head not in the harness-evals checkout' }); continue; }
    const uid = unitId(h206.repo, h206.pr, hu.head);
    const blockers = hu.bugs.map((b: any, i: number) => {
      const caseId = caseSlug(h206.repo, h206.pr, i + 1) + '-' + hu.head.slice(0, 7);
      writeFileSync(join(out, 'catalog', caseId + '.json'), JSON.stringify({
        schema_version: 1, id: caseId, visibility: 'sealed', repo: h206.repo, pr: h206.pr, reviewed_head: hu.head, merge_base: mb,
        diff_range: { from: mb, to: hu.head, note: 'harness-evals #206 at its ' + hu.label + '.' },
        roles: [{ role: 'red-team' }],
        defect: { file: b.file, line: b.line, summary: b.summary },
        severity: { deserved: 'CRITICAL', basis: 'Rated CRITICAL in #206\'s /ship review and fixed in ' + hu.fix.slice(0, 12) + ' before merge; the label is "gstack plus a second model family".', in_history: [{ by: b.by, rated: 'CRITICAL' }] },
        fix: { commit: hu.fix, pr: h206.pr },
        decoys: [{ kind: 'fix-commit', repo: h206.repo, pr: h206.pr, range: { from: hu.head, to: hu.fix }, audit: null }],
        receipt: { source: 'Captain drive handoffs/internal-task/ship/206/findings (' + b.finding + ')', evidence: [b.finding + ' at ' + b.file + ':' + b.line, 'fixed by ' + hu.fix.slice(0, 12)] },
        answer_key_audit: { by: 'build-suite (restated from the review record; fix commit checked to change the named code)', at: today, verdict: 'confirmed', notes: h206.note },
        shelf_life: { first_appeared: '2026-11-04', source: 'fix commit date', short: false },
        credit: 'Found by gstack\'s /ship review of harness-evals #206; restated in our own words.',
      }, null, 2) + '\n');
      return { id: 'B' + (i + 1), case: caseId, paths: [b.file], file: b.file, line: b.line, location: location(hev, mb, hu.head, b.file, b.line), counts: 'blocking' };
    });
    units.push({ id: uid, repo: h206.repo, pr: h206.pr, head: hu.head, base: mb, cluster: h206.repo + '#' + h206.pr, group: 'H-206', stratum: 'H', repro_confirmed: null, evidence: 'harness-evals #206 /ship review record', rank: null, blockers });
    build[uid] = { base_branch: 'main', forbidden: { commits: [hu.fix], prs: [] } };
  }

  const n = (g: string) => units.filter((u) => u.stratum === g || u.group === g).length;
  const suite = {
    schema_version: 1, id, title: 'Real-bug review suite: blocking bugs no gstack review found first, plus decoys and home-field units',
    kind: 'noloss', development_only: false,
    purpose: 'internal-task: does gstack\'s code review catch real bugs better than a plain review prompt? Non-gstack units (S1, S2, S3) are ranked so the first N keep the mix; N units are decoys for false alarms; H units are home field, reported apart.',
    sealed: true, catalogs: ['catalog'],
    sources: [], prereg_freezes: [],
    judging_rule: 'A blocker is FOUND when a finding rated CRITICAL after mapping names the same defect: a path the blocker lists and the same cause; the line may move. The same defect rated only INFORMATIONAL is DOWNGRADED, which is a miss. Otherwise it is MISSED.',
    shelf_life: { rule: 'Each model\'s knowledge cutoff is recorded in the preregistration; a sensitivity line reads the newest half. No case is dropped for shelf life.', released: null },
    groups: GROUPS, units, ineligible: [], excluded, frozen_bars: [],
  };
  const text = JSON.stringify(suite, null, 1) + '\n';
  writeFileSync(join(out, 'suites', id + '.json'), text);
  writeFileSync(join(out, 'units-build.json'), JSON.stringify(build, null, 1) + '\n');
  process.stdout.write(JSON.stringify({ suite: join(out, 'suites', id + '.json'), sha256: sha256(text), units: units.length, ranked: ranked.length, S1: n('S1'), S2: units.filter((u) => String(u.group).startsWith('S2')).length, S3: n('S3'), N: n('N'), H: n('H') }) + '\n');
}
