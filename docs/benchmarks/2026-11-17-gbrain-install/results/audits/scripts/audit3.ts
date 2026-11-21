// Audit 3: recount the release-pin columns from the raw watcher records and the end-of-turn probe files, and compare with verdict.ts.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { excludedReason } from '<controller-work>/run-wt/scripts/gbrain-install/verdict.ts';
const RUN = '<controller-work>/run';
const WT = '<controller-work>/run-wt';
const shard = new Map(readFileSync(join(RUN, 'readers/cell-shard.txt'), 'utf8').trim().split('\n').map(l => l.split(/\s+/) as [string, string]));
const recs = readFileSync(join(RUN, 'merged/trials.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const v = spawnSync('bun', ['scripts/gbrain-install/verdict.ts', join(RUN, 'merged'), '--json'], { cwd: WT, encoding: 'utf8', env: { PATH: '/usr/local/bin:/usr/bin:/bin:' + process.env.HOME + '/.bun/bin', HOME: process.env.HOME! } });
if (v.status !== 0) throw new Error('verdict.ts failed: ' + v.stderr);
const verdict = JSON.parse(v.stdout);

type P = { at: string; binary: string | null; version: string | null; src: string };
const trials: any[] = [];
for (const r of recs) {
  const reason = excludedReason(r);
  const rn = r.trial_id.split('/').at(-1);
  const dir = join(RUN, 'lite', shard.get(r.cell)!, 'results/trials', r.cell, 'gbrain-install', rn);
  const raw = existsSync(join(dir, 'logs/install-watch.ndjson')) ? readFileSync(join(dir, 'logs/install-watch.ndjson'), 'utf8') : null;
  const watch: P[] = []; let badLines = 0;
  for (const l of (raw ?? '').split('\n')) { if (!l.trim()) continue; try { const p = JSON.parse(l); watch.push({ at: p.at, binary: p.binary, version: p.version, src: 'watch' }); } catch { badLines++; } }
  const tdir = join(dir, 'logs/turns');
  const probes: P[] = [];
  let probeBad = 0;
  for (const f of existsSync(tdir) ? readdirSync(tdir).filter(f => /^turn-\d{4}\.probe\.json$/.test(f)).sort() : []) {
    try { const p = JSON.parse(readFileSync(join(tdir, f), 'utf8')); probes.push({ at: p.at, binary: p.binary, version: p.version, src: f.slice(0, 9) }); } catch { probeBad++; }
  }
  const all = [...watch, ...probes].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const withV = all.filter(p => p.version);
  const pin = r.install.tag.replace(/^v/, '');
  const first = withV[0]?.version ?? null, last = withV.at(-1)?.version ?? null;
  const binaryNoVersion = all.some(p => p.binary) && !withV.length;
  const binaryNullVersionRecords = all.filter(p => p.binary && !p.version).length;
  const pv = r.install.classification?.probe_versions ?? { first: null, last: null };
  trials.push({
    trial_id: r.trial_id, cell: r.cell, arm: r.install.arm, counted: reason === null, excluded_reason: reason, pin,
    watch_records: watch.length, watch_unparseable_lines: badLines, watcher_file: raw !== null, probe_files: probes.length, probe_unparseable: probeBad,
    recount: { first, last, distinct_versions: [...new Set(withV.map(p => p.version))], first_off_pin: !!first && first !== pin, last_off_pin: !!last && last !== pin, no_version_seen: !first },
    verdict_inputs: { first: pv.first, last: pv.last },
    binary_seen_without_version: binaryNoVersion, binary_null_version_records: binaryNullVersionRecords,
    matches: pv.first === first && pv.last === last,
    first_record_with_version_src: withV[0]?.src ?? null,
  });
}
const cells = verdict.map((c: any) => {
  const ts = trials.filter(t => t.cell === c.cell && t.arm === c.arm && t.counted);
  const rc = { first_version_off_pin: ts.filter(t => t.recount.first_off_pin).length, last_version_off_pin: ts.filter(t => t.recount.last_off_pin).length, no_version_seen: ts.filter(t => t.recount.no_version_seen).length };
  return { cell: c.cell, arm: c.arm, n: c.n, verdict_pin: c.pin, recount_pin: rc, same: JSON.stringify(rc) === JSON.stringify(c.pin),
    no_version_trials: ts.filter(t => t.recount.no_version_seen).map(t => t.trial_id), off_pin_trials: ts.filter(t => t.recount.first_off_pin || t.recount.last_off_pin).map(t => ({ trial_id: t.trial_id, versions: t.recount.distinct_versions })) };
});
const sum = (k: string, f: string) => cells.reduce((a: number, c: any) => a + c[k][f], 0);
const counted = trials.filter(t => t.counted);
const out = {
  audit: 3, run: 'gbrain-install-2026-11', method: 'For every counted run (verdict.ts excludedReason null), all parseable lines of logs/install-watch.ndjson and every logs/turns/turn-NNNN.probe.json, sorted by parsed time; first and last non-null version; compared with install.classification.probe_versions and with verdict.ts --json pin columns.',
  counted_runs: counted.length,
  totals: { verdict: { first_version_off_pin: sum('verdict_pin', 'first_version_off_pin'), last_version_off_pin: sum('verdict_pin', 'last_version_off_pin'), no_version_seen: sum('verdict_pin', 'no_version_seen') },
            recount: { first_version_off_pin: sum('recount_pin', 'first_version_off_pin'), last_version_off_pin: sum('recount_pin', 'last_version_off_pin'), no_version_seen: sum('recount_pin', 'no_version_seen') } },
  per_trial_mismatches: counted.filter(t => !t.matches),
  cells_differing: cells.filter((c: any) => !c.same).length,
  edge_checks: {
    runs_missing_watcher_file: counted.filter(t => !t.watcher_file).map(t => t.trial_id),
    runs_with_unparseable_watch_lines: counted.filter(t => t.watch_unparseable_lines).map(t => ({ trial_id: t.trial_id, lines: t.watch_unparseable_lines })),
    runs_with_unparseable_probe_files: counted.filter(t => t.probe_unparseable).map(t => t.trial_id),
    runs_binary_seen_but_no_version: counted.filter(t => t.binary_seen_without_version).map(t => t.trial_id),
    runs_with_binary_but_null_version_records: counted.filter(t => t.binary_null_version_records).map(t => ({ trial_id: t.trial_id, records: t.binary_null_version_records })),
    runs_with_more_than_one_version: counted.filter(t => t.recount.distinct_versions.length > 1).map(t => ({ trial_id: t.trial_id, versions: t.recount.distinct_versions })),
    runs_first_version_from_turn_probe_not_watcher: counted.filter(t => t.first_record_with_version_src && t.first_record_with_version_src !== 'watch').map(t => ({ trial_id: t.trial_id, src: t.first_record_with_version_src })),
  },
  cells,
  excluded: trials.filter(t => !t.counted).map(t => ({ trial_id: t.trial_id, reason: t.excluded_reason, recount: t.recount })),
  trials,
};
writeFileSync('<controller-work>/audits/audit3.json', JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ counted: out.counted_runs, totals: out.totals, mismatches: out.per_trial_mismatches.length, cells_differing: out.cells_differing, edge: Object.fromEntries(Object.entries(out.edge_checks).map(([k, v]) => [k, (v as any[]).length])) }, null, 1));
