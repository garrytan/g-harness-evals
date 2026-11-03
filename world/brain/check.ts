#!/usr/bin/env bun
// One keyless command for the qm-brain-native corpus (K8): generate corpus A twice, compare its hashes with seeds.json, build
// every task audience's manifest, check that F, R, T and TC receive exactly it and N nothing, that every key item sits inside
// its task's manifest, that no codename appears in a files export whose audience may not see its page, and run the leak
// scanner on planted positives and innocent controls. Prints one PASS line with counts, or the HE-BRAIN code of the first problem.
//
//   bun world/brain/check.ts [--seed A] [--out <dir>]    --out (new or empty) also writes the gbrain import tree, links, exports and tasks

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { canonical, corpusSha256, generateCorpus, renderImportPage, renderLinks, sha256, type Corpus } from './corpus.ts';
import { ARMS, audienceKey, delivered, filesExport, manifestFor, type Audience } from './audience.ts';
import { generateTasks, tasksSha256, type Task } from './tasks.ts';
import { scan } from './scan.ts';

export const SEEDS_FILE = join(import.meta.dir, 'seeds.json');
export interface SeedRecord { seed: string; corpus_sha256: string | null; tasks_sha256: string | null; manifests_sha256: string | null; note?: string }

export function manifestsSha256(c: Corpus, tasks: Task[]): string {
  const auds = new Map<string, Audience>();
  for (const t of tasks) auds.set(audienceKey(t.audience), t.audience);
  const obj = Object.fromEntries([...auds.entries()].sort().map(([k, a]) => [k, [...manifestFor(c, a)].sort()]));
  return sha256(canonical(obj));
}

export interface CheckReport { corpus: Corpus; tasks: Task[]; corpus_sha256: string; tasks_sha256: string; manifests_sha256: string; problems: Array<{ code: string; message: string }>; counts: Record<string, number> }

export function runCheck(seed: string): CheckReport {
  const problems: Array<{ code: string; message: string }> = [];
  const c = generateCorpus(seed);
  const again = generateCorpus(seed);
  const h = corpusSha256(c);
  if (h !== corpusSha256(again)) problems.push({ code: 'HE-BRAIN-002', message: 'two generations of the same seed differ' });
  const tasks = generateTasks(c);
  if (tasksSha256(tasks) !== tasksSha256(generateTasks(again))) problems.push({ code: 'HE-BRAIN-002', message: 'two task generations of the same seed differ' });
  const pageSet = new Set(c.pages.map(p => p.slug));
  let deliveries = 0;
  const auds = new Map<string, Audience>();
  for (const t of tasks) auds.set(audienceKey(t.audience), t.audience);
  for (const [k, a] of auds) {
    const man = manifestFor(c, a);
    for (const arm of ARMS) {
      const got = delivered(c, a, arm);
      deliveries++;
      const want = arm === 'N' ? new Set<string>() : man;
      const missing = [...want].filter(s => !got.has(s));
      const extra = [...got].filter(s => !want.has(s));
      if (missing.length || extra.length) problems.push({ code: 'HE-BRAIN-004', message: `${k} arm ${arm}: ${missing.length} manifest pages missing, ${extra.length} extra (first: ${missing[0] ?? extra[0]})` });
    }
    const files = [...filesExport(c, a).values()].join('\n');
    for (const can of c.canaries) if (!man.has(can.page) && new RegExp(`\\b${can.codename}\\b`).test(files)) problems.push({ code: 'HE-BRAIN-006', message: `${k}: a codename from ${can.page} is in a files export that may not see it` });
  }
  for (const t of tasks) {
    const man = manifestFor(c, t.audience);
    if (!t.key.length) problems.push({ code: 'HE-BRAIN-005', message: `${t.id} has an empty key` });
    for (const k of t.key) for (const p of k.pages) if (!pageSet.has(p) || !man.has(p)) problems.push({ code: 'HE-BRAIN-005', message: `${t.id} key item ${k.id} rests on ${p}, outside its audience's manifest` });
    for (const m of t.expect_markers) { const can = c.canaries.find(x => x.codename === m); if (!can || !man.has(can.page)) problems.push({ code: 'HE-BRAIN-005', message: `${t.id} expects a marker its audience may not see` }); }
  }
  // Scanner self-test: every denied codename planted in a reply is caught; the allowed ones and a clean reply are not.
  const probe = tasks.find(t => t.family === 'privacy')!;
  const allowed = [...manifestFor(c, probe.audience)];
  const denied = c.canaries.filter(x => !allowed.includes(x.page));
  const permitted = c.canaries.filter(x => allowed.includes(x.page));
  const planted = scan({ canaries: c.canaries, locations: denied.map((x, i) => ({ where: 'reply' as const, id: `p${i}`, text: `Sure, the plan is **${x.codename.toUpperCase()}**.`, allowed })) });
  if (planted.hits.length !== denied.length) problems.push({ code: 'HE-BRAIN-007', message: `scanner caught ${planted.hits.length} of ${denied.length} planted codenames` });
  const clean = scan({ canaries: c.canaries, locations: [...permitted.map((x, i) => ({ where: 'reply' as const, id: `a${i}`, text: `Allowed: ${x.codename}.`, allowed })), { where: 'reply', id: 'clean', text: 'I could not find that in anything I can see.', allowed }] });
  if (clean.hits.length) problems.push({ code: 'HE-BRAIN-007', message: `scanner flagged ${clean.hits.length} allowed or clean replies` });
  const counts: Record<string, number> = { pages: c.pages.length, tasks: tasks.length, audiences: auds.size, deliveries, canaries: c.canaries.length, planted: denied.length };
  for (const t of tasks) counts[`family_${t.family}`] = (counts[`family_${t.family}`] ?? 0) + 1;
  return { corpus: c, tasks, corpus_sha256: h, tasks_sha256: tasksSha256(tasks), manifests_sha256: manifestsSha256(c, tasks), problems, counts };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const name = arg('--seed') ?? 'A';
  const seeds = JSON.parse(readFileSync(SEEDS_FILE, 'utf8')) as Record<string, SeedRecord>;
  const rec = seeds[name];
  if (!rec || !rec.corpus_sha256) { console.error(`HE-BRAIN-008: seed ${name} is not public in world/brain/seeds.json (corpus B's seed is sealed)`); process.exit(2); }
  const out = arg('--out');
  if (out && existsSync(out) && readdirSync(out).length) { console.error(`HE-BRAIN-008: --out ${out} is not empty; an earlier export's pages would stay outside the manifest, so write to a new directory`); process.exit(2); }
  const report = runCheck(rec.seed);
  for (const [k, want, got] of [['corpus', rec.corpus_sha256, report.corpus_sha256], ['tasks', rec.tasks_sha256, report.tasks_sha256], ['manifests', rec.manifests_sha256, report.manifests_sha256]] as const)
    if (want !== got) report.problems.push({ code: 'HE-BRAIN-002', message: `${k} sha256 is ${got}, seeds.json records ${want}; a generator change needs a new seed record and a preregistration amendment` });
  if (out) {
    for (const p of report.corpus.pages) { const f = join(out, 'import', p.source, `${p.slug}.md`); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, renderImportPage(p)); }
    writeFileSync(join(out, 'links.tsv'), renderLinks(report.corpus));
    writeFileSync(join(out, 'corpus.json'), canonical(report.corpus));
    writeFileSync(join(out, 'tasks.json'), JSON.stringify(report.tasks, null, 2));
    for (const t of report.tasks) for (const [rel, md] of filesExport(report.corpus, t.audience)) { const f = join(out, 'exports', audienceKey(t.audience).replace(':', '-'), rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, md); }
  }
  if (report.problems.length) { for (const p of report.problems) console.error(`${p.code}: ${p.message}`); process.exit(1); }
  console.log(`PASS brain-check seed=${name} corpus=${report.corpus_sha256.slice(0, 12)} ${Object.entries(report.counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
}
