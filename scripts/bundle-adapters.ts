// Per-run layouts for scripts/bundle.ts (docs/trial-bundle.md, "Runs with their own layout"). Most runs keep their trial
// records at results/trials.jsonl beside prereg.json, and bundle.ts reads them with no entry here. The runs below were
// written before that layout settled: each names its preregistration files, the folders whose files go in and the file or
// files that hold the run's canonical trial records, with the reason. Nothing here moves or rewrites a run's files; the
// bundle keeps every path as committed, relative to the run folder.

export interface RunAdapter {
  /** Preregistration files under the run folder, copied verbatim. Their cells are the bundle's cells, in this order. */
  prereg: string[];
  /** Folders or files under the run folder that go in, minus harness-owned and spend files. */
  roots: string[];
  /** The canonical trial records the published numbers are computed from, relative to the run folder. */
  trials: string[];
  /** Why those records are the canonical ones (bundle.json layout.why). */
  why: string;
  /** Run-relative globs left out beyond the shared spend rule, with the reason. */
  leaveOut?: { globs: string[]; reason: string };
}

/** Run-relative globs no adapter bundle holds: the export's spend rule (ledgers, proxy usage and proxy logs, lease logs,
 *  VM cost records (shard-vm*.json) and fan-out records, spend reconciliations, spend.json and the run's internal spend
 *  note), plus any file named for spend, the metering summary, shard run summaries (run-summary.json carries a spend block)
 *  judge shard records (their lease_usd) and charged-reservation tallies. VM lifecycle logs (vms.jsonl, vm-steps.jsonl) hold no
 *  cost and stay, and so do lease caps (a shard record's or run summary's lease_usd, a preregistration's caps), which the
 *  public copy also keeps. Per-trial usage inside trials.jsonl stays, because the records are copied byte for byte. */
export const SPEND_GLOBS = ['**/*spend*', '**/*ledger*.sqlite{,.gz,.zst,.xz,.bz2}', '**/*ledger-summary*', '**/*proxy-usage*.ndjson{,.gz,.zst,.xz,.bz2}', '**/*proxy*.log{,.gz,.zst,.xz,.bz2}', '**/leases.jsonl{,.gz,.zst,.xz,.bz2}', '**/*lease*.log{,.gz,.zst,.xz,.bz2}', '**/infra-lease.json{,.gz,.zst,.xz,.bz2}', '**/*shard-vm*.json{,.gz,.zst,.xz,.bz2}', '**/fanout*.json{,.gz,.zst,.xz,.bz2}', '**/meter-summary*', '**/run-summary.json{,.gz,.zst,.xz,.bz2}', '**/*judge-shard.json{,.gz,.zst,.xz,.bz2}', '**/charged-reservations*.json{,.gz,.zst,.xz,.bz2}'];

const harbor = (names: string[]) => names.map((n) => `prereg-harbor${n}.json`);

export const ADAPTERS: Record<string, RunAdapter> = {
  '2026-11-03-qm-s1-gstack-probe': {
    prereg: ['design.json'],
    roots: ['results'],
    trials: ['results/turns.jsonl'],
    why: 'QM records one line per DM turn, and each turn is one trial: results/turns.jsonl holds all 60, and the report and results/analysis/s1-analysis.ts compute every number from it. design.json is the frozen design with the run id and cells; the run has no prereg.json.',
  },
  '2026-11-06-qm-s1-edition': {
    prereg: ['design.json'],
    roots: ['main', 'forced', 'headroom', 'calibration', 'pilot'],
    trials: ['main/turns.jsonl'],
    why: 'main/turns.jsonl holds the 1,728 counted edition trials that the report and edition-analysis.ts score (with main/grades.jsonl beside it); forced/, headroom/, calibration/ and pilot/ are the other stages, each with its own turns.jsonl. The task bank and the analysis outputs are not trial records and stay out. design.json lists the arms and models, not cells, so this bundle\'s cells list is empty.',
    leaveOut: { globs: ['calibration/summary.json', 'pilot/shards/pilot/summary.json'], reason: 'single-shard stage summaries whose usd fields are that stage\'s spend total (the public export leaves them out for the same reason)' },
  },
  '2026-11-07-frontier-harness': {
    prereg: ['prereg-harbor.json', 'prereg-harbor-extension.json'],
    roots: ['results', 'analysis-spec.json', 'analysis-spec-kept.json', 'analysis-spec-extension.json'],
    trials: ['results/merged/trials.jsonl'],
    why: 'results/merged/trials.jsonl is the merge of stage 0, the main stage and both rerun stages that the report and docs/receipts-manifest.json read (896 trials). The per-stage lists and the extension\'s own merge (results/extension/merged/trials.jsonl) are in the bundle too, but they are inputs to or additions beside it, not the run\'s record.',
  },
  '2026-11-08-skill-resolver': {
    prereg: ['prereg.json'],
    roots: ['results'],
    trials: ['results/merged/trials.jsonl'],
    why: 'results/merged/trials.jsonl is the one merged list of all 8,088 trials from the 25 shards, the file the report and docs/receipts-manifest.json cite.',
  },
  '2026-11-09-fable-5-2-coding': {
    prereg: harbor(['-r1h1', '-r1h2', '-r2h1', '-r2h2']),
    roots: ['results'],
    trials: ['results/merged/trials-full.jsonl'],
    why: 'results/merged/trials-full.jsonl is the preregistered full design, all 12 cells and 312 trials, and the report\'s headline inputs (results/analysis-full*/) are cut from it. results/merged/trials.jsonl is the first-written 7-cell list (182 trials) from before the completion shards ran, so it is kept but is not the record.',
  },
  '2026-11-09-particle-swap': {
    prereg: [...harbor(['', '-a1']), 'prereg.json'],
    roots: ['results', 'analysis-spec.json', 'analysis-spec-a1.json'],
    trials: ['results/union/trials.jsonl'],
    why: 'results/union/trials.jsonl is results/merged/run1-codegen/trials.jsonl followed by results/merged/run2-amendment1/trials.jsonl, byte for byte (2,496 trials, both run ids), and it is the input of the Amendment 1 analysis. The primary analysis reads its run-1 part. The completeness check (prereg.json, run id particle-swap-completeness-2026-11) keeps its own list under results/completeness/.',
  },
  '2026-11-10-gstack-skill-ablation': {
    prereg: harbor(['', '-arms']),
    roots: ['results', 'ablation-spec.json'],
    trials: ['results/merged/base/trials.jsonl', 'results/merged/arms/trials.jsonl'],
    why: 'The run\'s record is the merge in results/merged/, split by cell into two lists that share no trial: base/ (none and full, 820 trials) and arms/ (minus-verify and diet, 656 trials). The frozen analysis (ablation.ts analyze) reads both, so neither alone is the record.',
  },
  '2026-11-12-fable-5-2-coding-cc322': {
    prereg: harbor(['-r1h1', '-r1h2', '-r2h1', '-r2h2', '-smoke']),
    roots: ['results'],
    trials: ['results/merged/trials.jsonl'],
    why: 'results/merged/trials.jsonl is the one merged trial list of the four plan files\' shards, the input of every results/analysis-full*/ table and the file docs/receipts-manifest.json reads.',
  },
  '2026-11-14-fable-diagnosis': {
    prereg: harbor(['-s01', '-s02', '-s03', '-s04', '-s05', '-s06', '-s07', '-s08', '-s09', '-s10', '-s11']),
    roots: ['results', 'labels.json'],
    trials: ['results/merged/trials.jsonl'],
    why: 'results/merged/trials.jsonl is the merge of the 11 shards that the preregistered primary analysis reads (feature-split.ts --trials results/merged/trials.jsonl --labels labels.json).',
  },
};

/** Runs with no adapter on purpose: build refuses them with the reason, rather than guess a trial format. */
export const NOT_BUNDLED: Record<string, string> = {
  '2026-11-09-regression-canary': 'the canary keeps one trial list per baseline (results/trials/baseline-*.jsonl: two suites, three dates, one stopped incomplete), each compared with a different release, and no one list is the run\'s record',
  '2026-11-review-real-bugs': 'the repository holds only scored tables, judge checks and exposure summaries for this run; its per-review trial records are in the private raw archives its reproduce.md lists',
};
