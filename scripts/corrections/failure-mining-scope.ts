// Rebuilds every number in docs/corrections/2026-11-11/ (the failure-mining scope correction) from committed receipts,
// keyless. It loads the failure-mining corpus and labels the way scripts/failure-mining/analyze.ts does, reads each paired
// trial's committed grade.json, and reruns analyze.ts's own paired tests (same seeds and draws) on three readings: as
// published, with the brain-search failures that only the read-scope check failed counted as passes, and without the two QM
// pairs. It also checks the particle-1 note on one trial against the world's read rules. It writes only --out.
//
//   bun scripts/corrections/failure-mining-scope.ts --out <file>
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { analysisClasses, difference, gbrainPairs, GRADED_BEFORE_FIX, loadRegrade, OTHER, PAIR_RUNS, pooledTests, RETRIEVAL_ANY, taskTrees, trialsOf, UNLABELLED,
  type ManifestRow, type Trial, type Unit } from '../failure-mining/analyze.ts';
import { readLabels } from '../failure-mining/check-labels.ts';
import { canReadEvent, canReadFile, canReadMail, mapGbrainSlug } from '../../runner/grade/predicates.ts';

const ROOT = join(import.meta.dir, '..', '..');
const RUN = join(ROOT, 'docs/benchmarks/2026-11-09-failure-mining');
const SCOPE_CHECK = 'no_cross_scope_reads';
const UNSCOPED = 'unscoped_brain_search';
const NOTE_TRIAL = 'v03-opus-dev-2026-10/hermes-opus-gbrain-told-company-mu-v03-dev/sy-03-marrow-fieldworks-ticket-numbers/r3';
const NOTE_IDS = ['#4419', 'ZD-44918', 'MFW-218', '#PD-8841', '#PD-88412', '#4418'];

const jsonl = <T>(p: string): T[] => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
const round = (x: number | null) => (x === null ? null : Math.round(x * 1e6) / 1e6);
const r4 = (c: [number, number] | null) => (c ? [round(c[0]), round(c[1])] : null);

const classes = analysisClasses(JSON.parse(readFileSync(join(RUN, 'codebook.json'), 'utf8')));
const classIds = [...classes.map((c) => c.id), ...(classes.some((c) => c.id === GRADED_BEFORE_FIX) ? [] : [GRADED_BEFORE_FIX]), OTHER, UNLABELLED];
const manifest = jsonl<ManifestRow>(join(RUN, 'corpus/manifest.jsonl'));
const byId = new Map(manifest.map((m) => [m.trial_id, m]));
const regrade = loadRegrade(join(RUN, 'corpus/regrade.jsonl'), manifest);
const trees = taskTrees(JSON.parse(readFileSync(join(RUN, 'corpus/runs.json'), 'utf8')));
const labels = readLabels(join(RUN, 'results/labels/particle.jsonl'));
const trials = trialsOf(manifest, trees, labels.lines, new Map(), new Map(regrade.map((r) => [r.trial_id, r])));

const trialDir = (id: string) => join(ROOT, byId.get(id)!.results_dir, 'trials', id.split('/').slice(1).join('/'));
type Predicate = { id: string; kind: string; passed: boolean };
const grade = (id: string): { predicates: Predicate[]; consent_violation?: boolean; approval_stop?: boolean } => JSON.parse(readFileSync(join(trialDir(id), 'grade.json'), 'utf8'));

// Which paired failures failed a try only because of the read-scope check. Secondary checks are recorded but never decide
// a grade (runner/grade/index.ts), so a try whose other failed checks are all secondary would have passed without it.
const isQm = (t: { harness: string }) => t.harness === 'qm';
const pairsAll = gbrainPairs(trials);
const pairedFails = pairsAll.flatMap((p) => p.units.flatMap((u) => [...u.brain, ...u.none])).filter((t) => t.failed);
const failedChecks = new Map(pairedFails.map((t) => {
  const g = grade(t.trial_id);
  if (g.consent_violation || g.approval_stop) throw new Error(t.trial_id + ': grade has a consent or approval stop');
  return [t.trial_id, g.predicates.filter((x) => !x.passed)];
}));
const onlyScope = (t: Trial) => { const f = failedChecks.get(t.trial_id)!; return f.length === 1 && f[0]!.id === SCOPE_CHECK && f[0]!.kind === 'required'; };
const passWithoutScope = (t: Trial) => { const f = failedChecks.get(t.trial_id)!.filter((x) => x.kind !== 'secondary'); return f.length === 1 && f[0]!.id === SCOPE_CHECK; };
const tally = (ts: Trial[], key: (t: Trial) => string) => {
  const out: Record<string, number> = {};
  for (const t of ts) out[key(t)] = (out[key(t)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)));
};
const census = (ts: Trial[]) => {
  const unscoped = ts.filter((t) => t.gbrain_present && t.root_cause === UNSCOPED);
  const relabel = ts.filter(passWithoutScope);
  return {
    unscoped_brain_search: { failures: unscoped.length, failed_only_the_scope_check: unscoped.filter(onlyScope).length, would_pass_without_the_scope_check: unscoped.filter(passWithoutScope).length,
      failed_checks: tally(unscoped, (t) => failedChecks.get(t.trial_id)!.map((x) => (x.kind === 'required' ? '' : x.kind + ' ') + x.id).sort().join(' + ')) },
    would_pass_without_the_scope_check: { trials: relabel.length, by_arm_and_class: tally(relabel, (t) => (t.gbrain_present ? 'brain' : 'no brain') + ', ' + t.root_cause) },
    failed_only_the_scope_check: { trials: ts.filter(onlyScope).length, by_arm_and_class: tally(ts.filter(onlyScope), (t) => (t.gbrain_present ? 'brain' : 'no brain') + ', ' + t.root_cause) },
  };
};

// One reading: the paired family of tests, the retrieval_any row, and the overall failure rate per unit.
const asPass = (ids: Set<string>) => trials.map((t) => (ids.has(t.trial_id) ? { ...t, failed: false, status: null, root_cause: null } : t));
const reading = (ts: Trial[], keep: (p: { harness: string }) => boolean) => {
  const pairs = gbrainPairs(ts).filter(keep);
  const units: Unit[] = pairs.flatMap((p) => p.units);
  const row = (r: { delta: number | null; ci95: [number, number] | null; units: number; worse: number; better: number; mean_brain: number | null; mean_none: number | null }) =>
    ({ brain: round(r.mean_brain), no_brain: round(r.mean_none), delta: round(r.delta), ci95: r4(r.ci95), units: r.units, worse: r.worse, better: r.better });
  const tests = (mode: 'main' | 'verified_only') => pooledTests(units, classes, classIds, mode).map((r) => ({ class: r.class, tested: r.tested, ...row(r), p: round(r.p), p_holm: round(r.p_holm) }));
  const main = tests('main');
  const { diffs: _, ...overall } = difference(units, 'any_failure', 'main', classIds);
  return {
    pairs: pairs.map((p) => p.pair), units: units.length,
    trials_brain: units.reduce((s, u) => s + u.brain.length, 0), trials_none: units.reduce((s, u) => s + u.none.length, 0),
    retrieval_any: main.find((r) => r.class === RETRIEVAL_ANY)!,
    retrieval_any_verified_only: tests('verified_only').find((r) => r.class === RETRIEVAL_ANY)!,
    unscoped_brain_search: main.find((r) => r.class === UNSCOPED)!,
    overall_failure: row(overall),
    tested_family: main.filter((r) => r.tested),
  };
};
const all = () => true, noQm = (p: { harness: string }) => !isQm(p);
const relabelled = new Set(pairedFails.filter(passWithoutScope).map((t) => t.trial_id));
const relabelledStrict = new Set(pairedFails.filter(onlyScope).map((t) => t.trial_id));

// The exploratory scope table (exploratory.py, section 1): brain-arm trials in the four paired runs by brain, scope and route.
const scopeTable = (keep: (m: ManifestRow) => boolean) => {
  const rows = new Map<string, { brain: string; scope: string; route: string; harnesses: Set<string>; trials: number; failed: number; unscoped: number }>();
  for (const m of manifest) {
    if (!(PAIR_RUNS as readonly string[]).includes(m.run) || m.population !== 'default' || m.kind !== 'multiuser' || !m.gbrain.present || !keep(m)) continue;
    const g = m.gbrain as ManifestRow['gbrain'] & { brain?: string; scope?: string };
    const key = [g.brain, g.scope, g.install + (g.route ? '/' + g.route : '')].join('|');
    const r = rows.get(key) ?? rows.set(key, { brain: String(g.brain), scope: String(g.scope), route: g.install + (g.route ? '/' + g.route : ''), harnesses: new Set(), trials: 0, failed: 0, unscoped: 0 }).get(key)!;
    r.trials++; r.harnesses.add(m.harness);
    if (m.grade !== 'pass') { r.failed++; if (labels.lines.get(m.trial_id)?.root_cause === UNSCOPED) r.unscoped++; }
  }
  return [...rows.values()].map((r) => ({ ...r, harnesses: [...r.harnesses].sort(), failed_share: round(r.failed / r.trials), unscoped_share: round(r.unscoped / r.trials) }))
    .sort((a, b) => b.unscoped_share! - a.unscoped_share! || (a.route < b.route ? -1 : 1));
};
const tableNoQm = scopeTable((m) => m.harness !== 'qm');
const unscopedRows = tableNoQm.filter((r) => r.scope === 'none');

// The particle-1 note on sy-03 r3: which ticket ids in the posted reply sit on pages the asker could read.
const world = JSON.parse(readFileSync(join(ROOT, 'world/seed/world.json'), 'utf8'));
const dir = trialDir(NOTE_TRIAL);
const snapshot = JSON.parse(gunzipSync(readFileSync(join(dir, 'snapshot.json.gz'))).toString('utf8'));
const turn = jsonl<{ turn: number; actor: string; reply_text: string; started_seq: number; ended_seq: number }>(join(dir, 'turns.jsonl')).find((t) => t.turn === 2)!;
const asker = world.members.find((m: { id: string }) => m.id === turn.actor);
const idPattern = (id: string) => { const core = id.replace(/^#/, ''); return new RegExp((/^\d/.test(core) ? '(?<![0-9A-Za-z-])' : '(?<![0-9A-Za-z])') + core.replace('-', '\\-') + '(?![0-9])'); };
for (const id of NOTE_IDS) if (!turn.reply_text.includes(id)) throw new Error(NOTE_TRIAL + ': reply does not name ' + id);
const reads = jsonl<{ seq: number; tool: string; kind: string; outcome: string; effect?: { pages?: string[] } }>(join(dir, 'events.jsonl'))
  .filter((e) => e.tool.startsWith('gbrain.') && e.kind === 'read' && e.seq >= turn.started_seq && e.seq <= turn.ended_seq && Array.isArray(e.effect?.pages) && e.effect!.pages!.length);
const pages = reads.flatMap((e) => e.effect!.pages!.map((slug) => {
  const m = mapGbrainSlug(world, slug);
  const ch = m.channel ? snapshot.channels.find((c: { id: string }) => c.id === m.channel) : undefined;
  const [kind, readable, text] = ch ? ['channel', ch.members.includes(asker.id), JSON.stringify(world.messages.filter((x: { channel: string }) => x.channel === m.channel))]
    : m.file ? ['file', canReadFile(asker, m.file), JSON.stringify(m.file)] : m.mail ? ['email', canReadMail(asker, m.mail), JSON.stringify(m.mail)]
    : m.event ? ['meeting', canReadEvent(asker, m.event), JSON.stringify(m.event)] : ['unmapped', null, ''];
  return { seq: e.seq, tool: e.tool, slug, kind, asker_can_read: readable as boolean | null, ticket_ids: NOTE_IDS.filter((id) => idPattern(id).test(text as string)) };
}));
const records = [...world.files.map((f: any) => ['file', f.slug, canReadFile(asker, f), f]), ...world.mail.map((m: any) => ['email', m.slug, canReadMail(asker, m), m]),
  ...world.calendar.map((e: any) => ['meeting', e.slug, canReadEvent(asker, e), e])] as Array<[string, string, boolean, unknown]>;
const ids = NOTE_IDS.map((id) => ({ id,
  returned_pages_asker_can_read: pages.filter((p) => p.asker_can_read && p.ticket_ids.includes(id)).map((p) => p.slug),
  returned_pages_asker_cannot_read: pages.filter((p) => p.asker_can_read === false && p.ticket_ids.includes(id)).map((p) => p.slug),
  other_world_records_asker_can_read: records.filter(([, slug, ok, r]) => ok && idPattern(id).test(JSON.stringify(r)) && !pages.some((p) => p.slug.endsWith('/' + slug))).length }));

const out = {
  about: 'docs/corrections/2026-11-11/README.md. Rates are shares (0.095 is 9.5 points); intervals and p values come from analyze.ts with its seeds and draws.',
  scope_check: { all_pairs: census(pairedFails), without_qm: census(pairedFails.filter((t) => !isQm(t))) },
  as_published: { all_pairs: reading(trials, all), without_qm: reading(trials, noQm) },
  answer_only: {
    counted_as_passes: relabelled.size,
    all_pairs: reading(asPass(relabelled), all), without_qm: reading(asPass(relabelled), noQm),
    no_other_failed_check_at_all: { counted_as_passes: relabelledStrict.size, all_pairs: reading(asPass(relabelledStrict), all), without_qm: reading(asPass(relabelledStrict), noQm) },
  },
  scope_table_without_qm: { rows: tableNoQm, unscoped_range: [Math.min(...unscopedRows.map((r) => r.unscoped_share!)), Math.max(...unscopedRows.map((r) => r.unscoped_share!))] },
  label_note: { trial: NOTE_TRIAL, asker: asker.id, failed_checks: grade(NOTE_TRIAL).predicates.filter((x) => !x.passed).map((x) => x.id), returned_pages: pages, narrated_ids: ids },
};
const arg = (k: string) => { const i = process.argv.indexOf(k); if (i < 0 || !process.argv[i + 1]) { console.error('failure-mining-scope: ' + k + ' is required'); process.exit(2); } return process.argv[i + 1]!; };
writeFileSync(arg('--out'), JSON.stringify(out, null, 1) + '\n');
