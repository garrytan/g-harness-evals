# Amendments: particle-1 against frontier models (particle-swap-2026-11)

The preregistration is [PREREGISTRATION.md](PREREGISTRATION.md). It is not edited after its merge. Each amendment below is dated and committed before any cell it affects.

## Amendment 1 (2026-11-09): standalone Pi's partners on codegen: DeepSeek Harness and DeepSeek-V4.1-Flash-1017

**Approved by** Garry on 2026-11-09 ("do it" on the amendment plan's gate, A1 to H1). The plan's Cursor CLI cell, and its cost exception (E1), were dropped on 2026-11-13, before any cell ran (see "Cursor CLI dropped" below). **Committed** with the preregistration, in the same pull request, before any cell runs. The plan is in the Captain's private drive.

### 1. Cells added (run id `particle-swap-a1-2026-11`, [prereg-harbor-a1.json](prereg-harbor-a1.json))

| Harness | Opus 5.5 | GPT-6.1 Sol | particle-1 | DeepSeek-V4.1-Flash-1017 | Attempts × tasks |
|---|---|---|---|---|---|
| Hermes, OpenClaw, Pi | main run | main run | main run | new | 3 × 52 |
| DeepSeek Harness (dsh) | new | new | new | new (its home harness) | 3 × 52 |

- **Same 52 tasks and same shared order** as the main run, at the commit of this amendment. The amendment's cells run in the same window as the main run's cells.
- **DeepSeek-V4.1-Flash-1017:** OpenRouter id `deepseek/deepseek-v4.1-flash-1017`. The proxy pins every request to DeepSeek's own endpoint with fallbacks off and injects `provider.max_price`. A response served by any other host marks the trial infra (`served_elsewhere`). Effort is high, with a 128,000-token output cap. Reasoning content is passed back on tool-call turns in every harness, checked keyless per adapter.
- **Brain cells of the amendment plan don't run.** Both brain use cases read "can't tell (no headroom)" in the preregistration, so the plan's Pi, DeepSeek Harness and DeepSeek brain cells never start. QM on DeepSeek would have been "can't run": QM's pinned worktree routes only Particle's custom provider.
- **Web tools** are off as in the preregistration. DeepSeek Harness offers 22 tools on every route and none is a web tool; its web plugins and DeepSeek-hosted plugins are disabled and checked with `--dump-config`.

### Cursor CLI dropped (2026-11-13)

The amendment plan also had one Cursor CLI cell: Opus 5.5 on the same 52 tasks, 3 attempts, on its own shard. It was dropped on 2026-11-13, before this amendment merged and before any counted trial.

- **Why:** Cursor's calls go to Cursor's servers, not through our metering proxy, so no lease can see or cap their spend. The plan ran it under a cost exception (E1), capped only by a limit on the Cursor account. Garry chose to skip the cell rather than run it uncapped ("do it" on that recommendation, 2026-11-13 Pacific, relayed by the Captain on 2026-11-14 UTC).
- **What changes:** the `opus-cursor` cell and its $1 lease are gone from [prereg-harbor-a1.json](prereg-harbor-a1.json) and [analysis-spec-a1.json](analysis-spec-a1.json). No Cursor number is reported. It was never in a particle-1 or DeepSeek call, so no call changes.
- **What stays:** the Cursor harness and runner code stays in the repository, unused by this run. Cursor can come back in a later round once each run can hold its own capped key.

### 2. How they enter the calls

- **The primary particle-1 calls don't change.** codegen/opus and codegen/sol pool Hermes, OpenClaw and Pi, as preregistered.
- **Secondary pool (stated, not primary):** the same two calls with DeepSeek Harness added, computed on the union of both run ids' records. In analysis-spec-a1.json these pooled calls carry the primary calls' ids (codegen/opus, codegen/sol); they are this secondary pool and never replace the main run's primary calls.
- **DeepSeek vs particle-1 (gate answer G1), its own Holm family:**
  - per use case, d = DeepSeek minus particle-1 per (harness, task), pooled over Hermes, OpenClaw and Pi, weighted and task-clustered like the primary rule. DeepSeek Harness is DeepSeek's home harness, so it is left out of the pool and reported beside it;
  - superiority in both directions, Holm over the 6 calls (3 use cases × 2 directions), and a two one-sided tests reading within 10 points, Holm over 3. The brain calls are declared and not made, so each counts as p = 1;
  - labels: "DeepSeek better", "particle-1 better", "within 10 points" (", no measurable difference" when the 95% interval includes 0), "<x> better, by less than 10", or "can't tell" with the MDD;
  - DeepSeek is labelled a low-cost model, not frontier. Opus and Sol minus DeepSeek gaps are reported beside it, descriptive only;
  - code: the `low_cost_swap` block of scripts/model-swap.ts, in [analysis-spec-a1.json](analysis-spec-a1.json).
- **One cost basis for that ratio:** each trial's tokens times the peak list rates of runner/pricing/prices-2026-11-08.json (DeepSeek $0.30 input, $0.006 cache read, $1.20 output per million; particle-1 $0.25, $0.03, $1.00), for both models. Metered cost is an upper bound for both, because DeepSeek's and Particle's off-peak discounts are invisible to the proxy.

### 3. Declared differences

- **The tasks were picked with DeepSeek's own data.** The 52 tasks are the TB2.1 tasks whose pooled pass rate on the Harness Leaderboard's DeepSeek-V4.1-Flash high runs is below 0.95. So every DeepSeek cell runs on tasks picked by DeepSeek's own difficulty: it drops the tasks DeepSeek nearly always solves, which pulls DeepSeek's pass rate down against a random TB2.1 sample. Every DeepSeek number carries this note.
- **DeepSeek Harness** (@deepseek-ai/dsh 0.2.2-rc.1, a developer preview):
  - installed at agent setup by `npm ci` from the pinned lockfile, not at image build as the plan said; the same pinned bytes every trial;
  - runs with `--permission-mode danger-full-access --approval-policy never`: under workspace-write, Landlock blocked a bash write outside the working directory, and the other harnesses run unsandboxed inside the task container (Codex's sandbox bypass, Claude Code's bypassPermissions, Hermes's --yolo);
  - its session-title call stays at its shipped default, which uses the cell model (harness housekeeping, declared);
  - the preflight records that no instruction file is auto-loaded.

### 4. Shards and leases

| Shard (one cell, one VM) | Trials | Lease | Smoke cost per trial, USD |
|---|---|---|---|
| deepseek-hermes | 156 | $40 | 0.21 (smoke 4) |
| deepseek-openclaw | 156 | $50 | 0.12 (smoke 4) |
| deepseek-pi | 156 | $40 | 0.05 (smokes 4, 5) |
| deepseek-dsh | 156 | $55 | 0.14 (smoke 4) |
| opus-dsh | 156 | $150 | 0.87, one trial on filter-js-from-html (smoke 4) |
| sol-dsh | 156 | $100 | 0.45, one trial on filter-js-from-html (smoke 4) |
| particle-dsh | 156 | $100 | 0.72, one trial on filter-js-from-html (smoke 5) |

- **How the leases were set:** about twice the expected cost of 156 trials. #337's cells cost 1 to 5 times their mean on filter-js-from-html, so a lease priced from one trial on that task already has room. A shard that reaches its lease stops, and its remaining trials are recorded as cap_stop. A top-up needs a dated amendment before it runs.
- **Cap:** the leases sum to $535, plus a $44 reserve, within the amendment's $580 cap, separate from the preregistration's codegen cap.
- **Cost priors** come from the uncounted smokes 4 and 5 ([evidence/particle-smokes.md](evidence/particle-smokes.md)) and #337's cost per trial.

### 5. Unchanged

Everything else in the preregistration: tasks, pins, grading, infra classes and reruns, the effort rule, the web-tools check, clean arms and disclosures. No disclosure line is added: DeepSeek gets none (R55).
