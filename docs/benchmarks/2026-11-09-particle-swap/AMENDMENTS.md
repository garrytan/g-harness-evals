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

## Amendment 2 (2026-11-15): the shard smoke stops failing on the keyless Cursor cell

**Pre-data.** Committed before any counted trial of either run id. No cell, task, pin, grader, lease or analysis changes.

- **What broke:** each shard's smoke is the keyless install check at the shard's commit. The check runs every agent class, including the Cursor cell, which stops at agent setup by design (HE-CURSOR-002, no key). The agents verdict exempts Cursor's `effort_flag: unchecked`, but the reasons list did not (commit d656d3f627, 2026-11-11). A reason makes the whole check fail, so at b63ab6b7 every shard's smoke fails and no counted trial can start.
- **Seen on:** the canary particle-pi shard on 2026-11-14. Its smoke passed agents, oracle, nop, egress, the key canary and the gstack check, and failed only on `agents: cell cursor-opus has effort flag unchecked`. The VM was destroyed at 00:04Z with no paid call ($0 model spend).
- **Change:** one condition in `scripts/frontier-harbor/install-check.sh`. The reasons list now skips the Cursor harness's effort flag, the same way the agents verdict already does.
- **Which cells:** every cell of both run ids runs at this amendment's commit in place of b63ab6b7. The harness pins and settings (`scripts/frontier-harbor/pin.json`, `frontier_settings.py`, `agents.py`, `harnesses/{hermes,openclaw,pi,dsh}`) are byte-identical to b63ab6b7.

## Amendment 3 (2026-11-15): the two QM completeness cells can't run at QM's pinned commit

**Pre-data.** Neither QM cell ran a scored trial, and no model was called ($0).

- **What happened:** `qm-pi-sol-none-mu-v03-dev` and `qm-pi-particle-none-mu-v03-dev` each failed their one-trial smoke with HE-ADAPTER-002. QM core refused to register the task world's MCP server: "host.docker.internal resolves to a private network address" (HTTP 400 from `PUT /v1/admin/mcp-servers/world`).
- **Why:** QM at the pin (`harnesses/qm/pin.json`, main@90e4ced7, moved there by the internal-task pilot) sends every MCP request through `publicFetch` (`src/mcp/mcp-client.ts`), which refuses any private-network address and has no setting to allow one. The multi-user slice's world server always runs on the host's Docker bridge, so no multi-user QM cell can run at this pin. matrix-mu-2026-11's QM cells ran at the earlier pin, b6786d67.
- **Change:** the two QM cells are reported as "can't run at the pinned QM", with this reason, in place of a pass rate. Nothing else changes. openclaw-particle and hermes-particle run as preregistered. Moving the QM pin, or patching QM, would change the harness under test, so it is left to a later run.

## Amendment 4 (2026-11-15): particle-hermes finishes its last 29 trials on a second VM

**Mid-run, before the affected trials.** 127 of the cell's 156 trials had finished. The other 29 had no result yet: 7 were cut off mid-trial and 22 had not started. No cell, task, pin, grader, planned lease or analysis changes.

- **What happened:** the particle-hermes shard hit the controller's 13-hour limit (`--timeout-hours 13`) at 15:00Z on 2026-11-15 and was stopped (exit 143). Its smoke took 74 minutes and its trials averaged about 22 minutes each at 4 at a time, slower than every other codegen cell. The VM was destroyed and its results pulled back first.
- **Kept:** the 127 finished trials, rebuilt from the shard's per-trial journal with `to-trials.ts recover` (records labelled `frontier.recovered`, 75 passes). They are committed here at `results/recovered/particle-hermes/trials.jsonl`, with `recovery.json`. Their Harbor directories and request captures came back in the teardown pull, so the contamination audit can still read them.
- **Rerun:** the shard runs again from this amendment's commit with `--done results/recovered/particle-hermes/trials.jsonl`, so only the 29 missing trials run, each under its original trial id and attempt. The 7 cut-off trials start from scratch; their partial spend ($0.87) is in the first VM's ledger and counts toward the run's spend.
- **Lease:** $22. The first VM spent $27.43 of the planned $50, so the two VMs together stay within the planned lease. The controller limit is 8 hours.
- **Merge:** the cell's 156 records are the 127 recovered records plus the 29 from the second VM. If a trial is still missing after the second VM, it is reported as missing, not rerun again.
- **Correction (2026-11-15, after the run, from the records):** the controller ran 4 trials at a time, so at most 4 of the 29 were cut off mid-trial, not 7. The first VM's ledger shows spend on 3 unfinished trials ($0.20), so at least 25 had not started. The $0.87 is the ledger total minus the 127 records' own spend, not the cut-off trials' spend; the run's spend total is unchanged. The 127 finished trials averaged 19.5 minutes of wall time; the 22 minutes above includes the cut-off trials. The second VM's records do not state its controller limit; the VM ran for 4.9 hours.
## Amendment 5 (2026-11-15): Amendment 1's deepseek-hermes finishes its last 52 trials on a second VM

**Mid-run, before the affected trials.** Run `particle-swap-a1-2026-11`. 104 of the cell's 156 trials have records, and the other 52 never started. No cell, task, pin, grader, planned lease or analysis changes.

- **What happened:** the controller machine's disk filled at 15:41Z on 2026-11-15, during a mid-run copy of this shard's results. The controller stopped and its teardown signalled the VM, which stopped Harbor and wrote its records (exit 143). That was after 8 h 50 m, inside the 13-hour limit. The teardown pull brought everything back, and the VM was destroyed.
- **Kept:** the 104 records the VM wrote at the stop (70 passes, 19 agent timeouts, 5 no-model-response, 1 verifier-unavailable, 2 harness errors). None was cut off mid-trial. They are committed here at `results/partial/deepseek-hermes-a1/trials.jsonl` with their full Harbor directories kept locally. The verifier-unavailable trial goes through the preregistered rerun like every other cell's.
- **Rerun:** the shard runs again from this amendment's commit with `--done results/partial/deepseek-hermes-a1/trials.jsonl`, so only the 52 trials that never started run, each under its original trial id and attempt.
- **Lease:** $28. The first VM spent $11.29 of the planned $40, so the two VMs together stay within the planned lease.
- **Merge:** the cell's 156 records are the first VM's 104 plus the second VM's 52. If a trial is still missing after the second VM, it is reported as missing and not rerun again.
- **Correction (2026-11-15, after the run, from the records):** no committed record shows the disk filling at 15:41Z. The shard's run summary records `finished_at` 15:46:44Z. The VM record's `cleanup_reason` still reads "results not pulled; VM kept", but its `cleanup` field is done and all 104 records and the ledger are committed.

## Amendment 6 (2026-11-15): a lease top-up for Amendment 1's sol-dsh, which stopped at its lease with 58 trials unrun

**Mid-run, before the affected trials.** Run `particle-swap-a1-2026-11`. The preregistration says a shard that reaches its lease records its remaining trials as cap_stop, and that a top-up needs a dated amendment before it runs. This is that amendment.

- **What happened:** sol-dsh (GPT-6.1 Sol on DeepSeek Harness) spent $98.92 of its $100 lease and stopped. Its last 58 trials were refused at the lease: 6 of attempt 2 and all 52 of attempt 3. They were recorded as `model_error` with cap_stop (infra class `lease_refused`), $1.96 of setup spend between them. Sol on DeepSeek Harness cost about $1.01 a trial. The lease allowed about $0.64 a trial, twice the cost the amendment expected. One trial (filter-js-from-html, attempt 2) was charged $10.48 at a full reservation because its request carried no usage. analyze.ts keeps that kind of charge out of cost per solve, but it still counted against the lease.
- **Leases in `prereg-harbor-a1.json`:** sol-dsh rises from $100 to $190. To stay inside the run's $580 cap, two finished shards give back lease they never used: opus-dsh goes from $150 to $88 (it spent $87.68), and particle-dsh from $100 to $24 (it spent $23.13). The leases now sum to $487, plus the $44 reserve, which is $531. `cap_usd` stays $580.
- **Rerun:** only the 58 refused trials run, once, on a fresh VM from this commit. They keep their trial ids, cell, task and attempt, in stage `rerun1` (`vm-run.sh --rerun results/rerun/sol-dsh-a1.json`, with `--done results/main/sol-dsh-a1/trials.jsonl`, the first VM's records, committed here unedited). The lease is $90, inside $190 less the $98.92 already spent. Expected spend is about $59.
- **Merge:** `merge-stages.ts` replaces each of the 58 lease-refused records with its rerun record. A trial whose rerun is refused or missing stays excluded as a lease stop, and there is no second rerun. The first VM's directory carries the earlier preregistration hash, `16d22fa2fa82599a587d70938549582ca9a74aa0e1fa04b6abc8560cf83507b4`, which the merge accepts with `--prereg-sha`.
- **Unchanged:** cells, tasks, attempts, scoring, the analysis spec, and every other shard's lease. Other shards' handful of lease-refused trials (opus-hermes 1, sol-hermes 4, particle-openclaw 1, sol-pi 1 on codegen) stay excluded as lease stops and are reported in deviations.
