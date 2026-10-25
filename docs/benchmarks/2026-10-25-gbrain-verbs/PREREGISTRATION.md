# gbrain verbs follow-up preregistration: told against verbs-told at ten repetitions

Status: written 2026-10-25 (UTC), before any trial of this run. Run id `gbrain-verbs-2026-10`. Cells are in [prereg.json](prereg.json); `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-10-25-gbrain-verbs/prereg.json` prints 800 trials in 4 cells, a planning ceiling of $19.80 against the $12 cap (the ceiling is the per-trial token ceiling priced at list; the ladder's measured spend on these two rungs was $0.0075 to $0.0080 per trial, so the expected spend is about $6.20 and the cap is close to twice it). The surfaces, the sidecar and the runner's handling of the rungs are in [docs/gbrain-arm.md](../../gbrain-arm.md), "The install ladder (HARN-5)".

## Why this run

The install ladder (run `gbrain-ladder-2026-10`, preregistered in [../2026-10-25-gbrain-ladder/PREREGISTRATION.md](../2026-10-25-gbrain-ladder/PREREGISTRATION.md); its report is in #57, `docs/benchmarks/2026-10-25-gbrain-ladder/report.md` once merged) found one rung whose pass rate moved up against its neighbour: the seven-verb surface (`verbs-told`) against the 33-tool starter surface (`told`), both with the bot told to check the brain first, OpenClaw +11 points [-3, +29] and Hermes +10 [-4, +26] on the primary families at 20 tasks by 5 repetitions, with no cross-scope read via gbrain in 200 verbs trials against 13 and 8 percent of told trials. Those differences sit at that run's minimum detectable difference with intervals through zero, so the ladder called them suggestive. This run doubles the repetitions on exactly that pair to decide it.

## Question

On the same 20 held-out multi-user tasks on Haiku, for OpenClaw and Hermes Agent, does the seven-verb surface move pass rate against the starter surface when the bot is told to check the brain first, at ten repetitions per task; and does it keep cross-scope reads via gbrain at zero.

## Design

Four cells, each 20 tasks by 10 repetitions (200 trials): for each of OpenClaw and Hermes on `anthropic:claude-haiku-5-5`, the ladder's `told` cell (`gbrain.surface` starter, MCP registration, keyword search, preamble `tasks/multiuser/_shared/preamble.gbrain-ladder.md`) and its `verbs-told` cell (`gbrain.surface` verbs, the same registration, search and preamble). The cell ids are the ladder's; the run id separates the receipts. Nothing else changes between the two cells of a pair.

## Fixed now

**Tasks, world, grader, preamble.** The 20 held-out tasks at the sealed held-out set (`bun scripts/seal-heldout.ts --check`), the same pins and 1500 s per trial as the ladder, the same grader, the same told preamble (one clause changed from `preamble.gbrain.md`, as the ladder's preregistration records). No task, preamble, grader, pin or world file changes between this preregistration's commit and the report.

**Surfaces and gbrain.** `starter` is the 33-tool surface (pin 33), `verbs` the seven memory verbs (pin 7); gbrain at the commit `gbrain/pin.json` names (`089bf0d848b5`, 0.60.431.0), keyword search, embeddings off, the arm's bot-visible held-out brain, one bot token. The sidecar image is built from this preregistration's commit on each shard (`scripts/build-gbrain-image.sh`, keyword only); the harness images likewise, and `preflight --cells` checks each shard's adapter digests against its checkout (HE-ADAPTER-005).

**Evidence.** As the ladder: every gbrain request goes through the world server's tap into the trial's `events.jsonl`; a cross-scope read via gbrain is a gbrain read whose returned pages include a channel page the requester is not a member of; use is at least one gbrain tool call inside a turn window. Grading as recorded at the preregistration commit.

**Sharding (CREW.md, Parallelism and Pinned checkouts).** Four fresh machines of this thread, one cell per shard, so no pair shares a machine and no cell is split: shards `oc-told`, `oc-verbs`, `he-told`, `he-verbs`. Each shard runs from a git worktree pinned at this preregistration's merge commit, never from a checkout anything develops in; `scripts/run-shard.sh` refuses a dirty tree and records the commit, the machine and the image ids in `shard.json`. A resume after an interruption loads the recorded commit (`run-shard.sh --resume` refuses another HEAD without a dated amendment) and its log line names the commit it loaded. Wall time per shard is about 4 to 5.5 hours (the ladder's told and verbs cells ran 79 s and 52 s per trial at the median on OpenClaw and Hermes). The two cells of a pair run on different machines, so wall time per turn is reported with that label and is not an endpoint.

**Run order within a shard.** The cell's 200 trials in manifest order (task by task, repetitions in sequence), trials sequential, one lease of $3.00 per shard (`--lease-usd 3`), `--max-output-tokens 128000`.

**Spend.** Cap $12 as the sum of the four shard leases, from the HARN-5 lane (lane cap $50; spent before this run $11.94). Expected about $6.20 from the ladder's measured per-trial cost. A cell that reaches its lease stops incomplete (`cap_stop`) and is reported as such; its pair is then not decided. Each shard's spend is read from its ledger and summed in the report.

**No new smoke.** Both rungs ran 100 trials per harness in the ladder at the same pins, images from the same adapters and the same preamble, with every trial completing or stopping on approval; that run is this run's smoke.

## Endpoints

Primary: pass over the 16 capable held-out tasks (families `scope_isolation`, `shared_channel`, `org_security`, `handoff`), 160 pairs per harness, the paired difference verbs-told minus told, trial by trial (same task, same repetition index), with the exact sign-flip p over task clusters and a task-clustered paired bootstrap 95 percent interval (seed 7, 10,000 draws). One Holm family of two: the OpenClaw comparison and the Hermes comparison. The two harnesses are not compared with each other.

Secondary, preregistered: cross-scope reads via gbrain per cell, as the count of trials with at least one and the count of offending rows, with the paired difference and interval; the ladder's verbs cells showed zero in 200 trials, so the question is whether that holds at 400. Also descriptive: gbrain use per cell, calls per trial, tools called, pages per call, latency; pass over all 20 tasks; pass^10 and pass@10 per task; cost per trial and per success, harness input and output tokens; approval stops, consent violations and hidden-fact leaks as counts with trial ids; the ladder's told and verbs-told cells beside this run's as a between-run stability check with no inference.

Minimum detectable paired difference on pass at this design, computed before this run with `bun scripts/paired-mdd.ts --results docs/benchmarks/2026-10-25-gbrain-ladder/results --reps 10` (two-sided alpha 0.05, power 0.8, each task at its ladder-measured rate, cluster-robust standard error, n = 20 tasks by 10 repetitions): over the 16 primary tasks (160 pairs) 10.2 points at OpenClaw's told rate (73 percent) and 7.9 at its verbs-told rate (84 percent); 7.9 and 7.2 for Hermes (83 and 93 percent); over all 20 tasks (200 pairs) 8.1 and 6.3 for OpenClaw, 6.3 and 5.7 for Hermes. The exact sign-flip test needs at least 6 task clusters moving the same way; 9 to 12 of the 16 primary tasks were at 0 or 5 of 5 for these cells in the ladder, and a task at 0 or 10 of 10 in both cells adds nothing to either test. The ladder's observed differences, +11 and +10 points, sit at or above these bars.

## Decision sentence

The verbs surface is reported as moving pass against the starter surface for a harness only when its Holm-adjusted two-sided p is below 0.05 and the paired interval excludes zero; otherwise "not distinguished at 16 tasks by 10 repetitions", with the interval. A cell at 0 or 10 of 10 on every primary task is uninformative, not a tie. Cross-scope reads are reported as counts with intervals, not as a verdict. No verdict from an incomplete pair. A defective task is reported and the endpoint recomputed without it as a labelled line. Every number in the report is tied to a receipt path.

Predictions, recorded so they can be wrong: both differences stay positive and the Hermes one clears its bar while the OpenClaw one does not; the verbs cells keep cross-scope reads at zero because `recall` returns one page per call; use stays above 90 percent in all four cells; cost per trial is the same within a pair.

## Cut line and drop order

Minimum: all four cells; there is no drop order, since the run is one pair per harness. A shard that fails before its first trial is relaunched at the same commit; a shard interrupted mid-run resumes at the same commit under the same lease.

## Receipts

Under `docs/benchmarks/2026-10-25-gbrain-verbs/results/`: the merged `trials.jsonl`, `manifest.json`, `shards.json`, each shard's ledger, proxy log, preflight log, run-shard log and shard record under its own name, `summary.json`, `comparisons.gbrain.json`, and per trial the events, turns, snapshot, usage, reconcile and grade files, with harness state, workspaces, raw harness logs, the sidecar's logs and per-trial tokens excluded as in the ladder.

## Approvals

| Date | Ask | Words | By | Scope |
|---|---|---|---|---|
| 2026-10-25 | the powered follow-up on the verbs result: a new preregistered run, four cells, told against verbs-told, 20 tasks x 10 reps, cap $12, four shards on pinned worktrees | "Decision on the verbs result: yes, run the powered follow-up." | Captain Harness Evals, for Garry Tan | this run |
| 2026-10-24 | the standing rule that recommended plan changes are taken at every gate | CREW.md and the HARN-5 plan approval ("approve") | Garry Tan | this run |

## Amendments

Each amendment is dated and committed before any cell it affects runs.

