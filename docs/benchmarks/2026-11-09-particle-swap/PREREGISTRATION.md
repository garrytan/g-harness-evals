# Particle-1 against frontier models, per harness and per use case: preregistration

Status: written 2026-11-09 (America/Los_Angeles), before any counted trial. Two run ids:

- `particle-swap-2026-11`: the codegen cells on Terminal-Bench 2.1, through Harbor. Cells, shards and leases are in [prereg-harbor.json](prereg-harbor.json), and the analysis input is [analysis-spec.json](analysis-spec.json).
- `particle-swap-completeness-2026-11`: the completeness cells on the saturated 20-task company set. These cells are in [prereg.json](prereg.json).

**In one line:** put particle-1 into the same harnesses as Opus 5.5 and GPT-6.1 Sol, change nothing but the model, and preregister one call per use case and frontier model: is frontier detectably better, is particle-1 within 10 points, or can't we tell?

**What this is not:** a ranking of models in general, a tuning of particle-1, or a gstack or gbrain test. Every cell runs without gstack and without gbrain (R44 is out of scope; no stack is compared).

## Approval

- **Garry, 2026-11-09:** "do it" on the plan's gate, taking every recommendation (A1 to H1).
- **Garry, 2026-11-09:** "do it" on the amendment plan's gate (A1 to H1). That plan adds standalone Pi, DeepSeek Harness, Cursor CLI and DeepSeek-V4.1-Flash-1017. It enters as Amendment 1 in [AMENDMENTS.md](AMENDMENTS.md), committed with this preregistration and before any of its cells (its decision 1), so it is not part of this file. Its Cursor CLI cell was dropped on 2026-11-13, and its brain cells, standalone Pi's among them, don't run (both below).
- **Captain, 2026-11-09:**
  - **Web tools:** model-callable web search is off in every codegen harness, plus a pre-trial check (below).
  - **Cost:** option (a), every remaining cell at 3 attempts, ceiling unchanged.
  - **Cursor:** its E1 cost exception, withdrawn on 2026-11-13 with the Cursor cell (below).
- **Garry, 2026-11-13 (Pacific; the Captain relayed it on 2026-11-14 UTC):** "do it" on dropping the amendment's Cursor CLI cell before any trial ran. Cursor's calls don't pass through our metering proxy, and the run doesn't spend where it can't cap. Cursor can come back in a later round once each run can hold its own capped key.
- **Plans:** in the Captain's private drive: the main plan and the amendment plan.

## Question

Inside one harness, on the same tasks, is a frontier model detectably better than particle-1, or is particle-1 within 10 points?

- **Estimand:** per (harness, task), d = frontier pass minus particle-1 pass, each side's task mean over its scored attempts.
- **Margin: 10 points of pass rate.** Garry's question is "use particle-1 for most everything", so a loss of 10 points or more is material.
- **Use cases:** codegen, personal brain and company brain. Each has its own task set and its own calls. Nothing is compared across task sets.

## What runs, per use case

| Use case | Task set | Status at this commit | Calls |
|---|---|---|---|
| Codegen | Terminal-Bench 2.1, the 52 tasks of #337 | **Runs:** 9 cells below, 3 attempts each | codegen/opus, codegen/sol |
| Company brain | company-v2 (60 generated tasks, expiry off) | **Can't tell (no headroom).** The full run never starts. | Declared, p = 1 in Holm |
| Personal brain | personal-v2 (60 generated tasks, expiry off) | **Can't tell (no headroom).** The full run never starts. | Declared, p = 1 in Holm |
| Company brain, saturated | v0.3 dev, 20 tasks | **Completeness cells** only, labelled cross-run and saturated | None |

### Why the brain use cases don't run (plan decision 7, R61)

- **The gate, per family:** both frontier cells pass between 15% and 90%, and at least half of the family's tasks vary between the two cells. One attempt each of OpenClaw on Opus and Hermes on Sol, uncounted. A family that fails moves one level and is regenerated once. A family that fails again is dropped. With fewer than half the families passing, the use case reads "can't tell (no headroom)".
- **First check** (v1 sets at L3 and L4, run ids `particle-headroom-check-2026-11` and `-11b`): every family failed, so both sets were regenerated once, as v2.
- **Second check** (v2 sets, run id `particle-headroom-check-2026-11-v2`, at commit 499c30dd08). Pass counts are OpenClaw/Opus, then Hermes/Sol:

| Set | Family | Level | OpenClaw / Opus | Hermes / Sol | Tasks varying | Gate |
|---|---|---|---|---|---|---|
| company-v2 | approval relay (ar) | L4 | 15/15 | 9/15 | 6/15 | fail |
| company-v2 | corrections (cr) | L4 | 0/15 | 0/15 | 0/15 | fail |
| company-v2 | memory scope (ms) | L4 | 13/15 | 15/15 | 2/15 | fail |
| company-v2 | session synthesis (ss) | L4 | 13/15 | 14/15 | 1/15 | fail |
| personal-v2 | recall (er) | L4, L5 | 27/30 | 30/30 | 3/30 | fail |
| personal-v2 | own corrections (pc) | L4, L5 | 18/30 | 29/30 | 13/30 | fail |

- **A deviation in the check:** the Hermes personal shard's lease ($20) was set too low, so 11 pc trials (pc-20 to pc-30) stopped at the cap as `model_error` with cap_stop. They ran once more, at the same commit and cell, as their own uncounted run id `particle-headroom-check-2026-11-v2c`. The 29/30 above includes them.
- **corrections at L4:** every task places the settled value in the team's `-random` channel and the ask in its `-team` channel. Both models answered with the last value in the ask's channel. check-set.ts's oracle passes on all 15 (the asker can read the value, and so can everyone in the channel where the answer lands). So this is a placement pattern of the generator at L4, not a grader bug. It is filed as a follow-up for the generator's owner, and no task is changed here.

## Codegen tasks

- **Benchmark:** Terminal-Bench 2.1 at commit `d49e28f1e4ddd13d289e85a5f312a66750951932`, through Harbor 0.24.0. The pins are as in #337: [scripts/frontier-harbor/pin.json](../../../scripts/frontier-harbor/pin.json).
- **The 52:** the same 52 tasks as #337 (pooled pass rate below 0.95 on the Harness Leaderboard's DeepSeek-V4.1-Flash high runs). No kept sample runs.
- **Shared order:** sha256("harn57-particle-swap-2026-11-09\0<task id>"). Every cell runs all 52, so the order only sets the job order.
- **Headroom:** in #337, the six third-party frontier cells on these tasks passed between 76% and 86% of their scored trials (two attempts; #337's results/analysis/analysis.json). That is inside 15% to 90%, though near the top, so no codegen headroom stage runs.

## Codegen cells

| Harness | Opus 5.5 | GPT-6.1 Sol | particle-1 | Attempts × tasks |
|---|---|---|---|---|
| Hermes | opus-hermes | sol-hermes | particle-hermes | 3 × 52 |
| OpenClaw | opus-openclaw | sol-openclaw | particle-openclaw | 3 × 52 |
| Pi | opus-pi | sol-pi | particle-pi | 3 × 52 |

- **Same harness config, only the model changes (decision 3):** each harness keeps the settings in [frontier_settings.py](../../../scripts/frontier-harbor/frontier_settings.py), written to each trial's `harness_settings.json`.
- **particle-1** runs through each harness's Particle route (OpenAI Chat Completions on the proxy's `/particle` route). Effort is high where the harness passes one, with a 128,000-token output cap.
- **Limits and effort:** each model's real context window and 128,000 max output tokens. Effort is high through each harness's native setting. The effort rule of #337 applies unchanged: recorded, never rewritten. A trial whose agent-loop requests did not all send effort high is `infra_error` with class `effort_mismatch`, excluded pairwise and counted.
- **Housekeeping calls** stay at each harness's shipped default. They are metered, labelled "harness housekeeping, shipped default", and never scored.
- **Hermes's auxiliary calls, declared, not changed.** They use provider auto, which is the cell model. In #337's runs (frontier-harness-2026-11 proxy logs, all four segments of each cell: stage0, main, rerun1, rerun1-a6):
  - **Session title:** Opus rejected it twice per trial (318 non-streamed /v1/messages calls from 159 trial keys, HTTP 400), and Sol once per trial (168 non-streamed /v1/responses calls with effort none, HTTP 400). DeepSeek-V4.1-Flash-1017 rejects it too (effort none, the uncounted smoke). The title only names the session, so no trial outcome depends on it.
  - **Other non-streamed calls on Sol (most likely image reading):** 65 of 269 non-streamed Chat Completions calls got HTTP 400 (one more was refused with 402) (a separate sizing of #337's logs places the answered ones on image and video tasks). Opus made no such call. The 15-second cuts of these calls are gone with the egress fix (next item). We report each Hermes cell's auxiliary calls and their status counts beside its results.
- **Egress sidecar read timeout:** the task container's egress sidecar (gost 3.2.7) cut any connection whose reply had not started within 15 seconds, and the cut call was still paid. Both its services now wait up to 900 seconds. The install check's egress probe must get a reply the gateway holds back for 30 seconds, and blocklisted hosts are still refused. #337's runs had the cut; a separate sizing counted 39 cut calls, all Hermes on Sol, 1.78% of that cell's spend.
- **Fresh comparators (decision 4):** the frontier cells run fresh, at this commit, in the same window as the particle-1 cells. #337's trials are a descriptive cross-check only and never enter a call.
- **Home rows:** Claude Code on Opus and Codex on Sol are #337's cells. They are listed for completeness, and neither can run particle-1.

## Web tools off (Captain, 2026-11-09)

A separate check found that Hermes's default keyless web search returned a TB2.1 task's solve.sh and test file verbatim. So model-callable web search and web fetch are off in every codegen harness, and the browser tools too, because they fetch any URL:

- **Hermes v2026.9.24:** `web.keyless_fallback: false` and `agent.disabled_toolsets: [web, browser]`.
- **OpenClaw 2026.10.6:** `tools.deny` adds `group:web` and `browser` to Harbor's own denies, and `tools.web.search.enabled` and `tools.web.fetch.enabled` are false.
- **Pi 1.5.0:** ships no web tool.
- **Sources:** each harness's documentation at its pin. They are listed in [scripts/frontier-harbor/README.md](../../../scripts/frontier-harbor/README.md#web-tools-off).

**The check:** after each shard's smoke and before any counted trial, [web-tools-check.ts](../../../scripts/frontier-harbor/web-tools-check.ts) reads the tools each harness offered the model in the smoke's captured requests.

- **Fails the shard (exit 4, HE-FRONTIER-011):** a web search or web fetch tool, or a cell with no captured tool list.
- **Writes:** the tool names per cell, to `smoke/results/web-tools.json`, which is kept with the receipts.

**Against #337:** #337's Hermes cells ran with keyless web search on. Any Hermes comparison with #337 is labelled "settings differ". The fresh Hermes cells here are the web-off cells.

## Run order

1. **Install check:** the keyless install check passes at this commit through `fanout.sh --workload frontier-harbor --install-check`. It covers every agent class on every model it runs here, oracle, nop, egress and the key canary.
2. **Baseline gate ($0 model spend):** `install-check.sh --baselines all` runs oracle (must pass) and nop (must fail) on every pinned task, behind the egress blocklist.
   - **Known failures:** `mcmc-sampling-stan`, `build-cython-ext` and `protein-assembly` fail their own oracle (#337 amendment 1). They are kept and scored as they are, as in #337.
   - **Any other baseline failure** stops the run for a dated amendment.
3. **Canary shard:** `particle-pi` starts first. The other eight start once it has finished its first 4 trials cleanly, so every cell runs in the same window.
4. **Infra reruns:** a trial matching the `verifier_unavailable` signature (#337 amendments 4 and 6: no pytest summary plus a failed github.com download, `to-trials.ts scan-verifier`) is excluded and rerun once, in stage `rerun1`. A rerun that hits it again stays excluded. The signature is outcome-blind.
   - **Setup network failures** are rerun the same way, once: a trial with no model request whose agent setup failed with Harbor's `NetworkConnectionError` (for example a GitHub 429 while installing Hermes, as in two uncounted smokes; the Hermes install script's fetch now retries (curl --retry 6), and the whole install is tried up to three times before it fails). The class is `no_model_response` and the trial never reached the model, so this is outcome-blind too.
5. **Completeness cells:** `particle-swap-completeness-2026-11` runs at this commit on one Ubicloud shard per cell, under the runner's multi-user path.

## Sharding and leases

- **Placement:** one Ubicloud standard-16 VM per shard, through `scripts/ubicloud/fanout.sh --workload frontier-harbor`, with UBI_OWNER set to this run's owner tag. One cell per shard. No cell is split across machines.
- **Concurrency:** 4 trials at a time per VM, retries off. Wall time is labelled "contended".
- **TTL:** UBI_TTL_HOURS is at least 14.
- **Mirror:** results leave each VM every 20 minutes. The frontier-harbor mirror carries `trials.journal.jsonl` and no request capture, and `to-trials.ts recover` rebuilds finished trials from the mirror alone (tested by killing a shard mid-run, tests/frontier-harbor-mirror.test.ts).
- **Leases:** priced from #337's cost per trial for each frontier cell, with a margin of 2% to 27% by cell over the cost of #337's counted trials, and for particle-1 from the cost smokes (Evidence, below): each harness's smoke cost per trial, scaled by #337's ratio of its all-task cost to its cost on the smoke tasks, times 156, with about 2x margin, because a shard that reaches its lease stops. Each lease is at least concurrency times its cell's largest per-call reservation (plan.ts headroom floor).

| Shard | Trials | Lease | Headroom floor |
|---|---|---|---|
| opus-hermes | 156 | $115 | $31.58 |
| opus-openclaw | 156 | $125 | $31.58 |
| opus-pi | 156 | $85 | $31.58 |
| sol-hermes | 156 | $60 | $16.32 |
| sol-openclaw | 156 | $85 | $16.32 |
| sol-pi | 156 | $36 | $16.32 |
| particle-hermes | 156 | $50 | $1.92 |
| particle-openclaw | 156 | $130 | $1.92 |
| particle-pi | 156 | $70 | $1.92 |

- **Cap:** the leases sum to $756, plus a $60 reserve, within the $816 codegen cap. A shard that stops at its lease records its remaining trials as cap_stop. A top-up needs a dated amendment before it runs.
- **Completeness cap:** $40 (prereg.json `spend_cap_usd`).

## Claims

**The rule (decision 2), as [scripts/model-swap.ts](../../../scripts/model-swap.ts) implements it:**

- **Primary calls:** one per use case and frontier model: codegen/opus, codegen/sol, personal-brain/opus, personal-brain/sol, company-brain/opus and company-brain/sol.
  - **Items:** (harness, task) pairs pooled over Hermes, OpenClaw and Pi, weighted so each harness counts the same.
  - **Bootstrap:** clustered by task, 10,000 draws, seed 7.
  - **Brain calls:** the four are declared and not made, so each counts as p = 1 and Holm stays over all 6.
- **Two tests per call, Holm over the 6 for each:**
  - **non-inferiority:** particle-1 is "within 10 points" when the one-sided bound of particle-1 minus frontier is above -10 (nonInferiorityP);
  - **superiority:** "frontier better" when frontier minus particle-1 is above 0 (superiorityP, exact cluster sign-flip).
- **Labels:**
  - both tests pass: "frontier better, by less than 10";
  - non-inferiority alone: "within 10 points", plus ", no measurable difference" when the 95% interval of d includes 0;
  - superiority alone: "frontier better";
  - neither: "can't tell", with the MDD.
- **Secondary calls:** the same tests per harness, Holm within use case and frontier model.
- **Every call also reports:**
  - the counts of tasks where particle-1 did worse and better;
  - the informative-task share;
  - cost per solved task per arm, and the particle-1 to frontier ratio with its interval;
  - pass^3 per cell.
- **Not tested:** a call with fewer than 10 clusters.

**Power (from #337's per-task variance, before freeze):**

- **Pooled:** pairing Opus against Sol within each harness on #337's 52 tasks, at 2 attempts, gives a task-clustered standard error of about 5.1 points for the pooled harness-weighted difference (the per-task differences are correlated across the three harnesses).
  - So a pooled "frontier better" call needs a true gap of about 14 to 18 points (80% power, alpha 0.05 to the first Holm step).
  - A pooled "within 10 points" call is reachable only when the true gap is about zero or favors particle-1.
- **Per harness:** the standard error is about 5.8 to 6.2 points, so the MDD is about 16 to 20 points.
- **Attempts:** 3 attempts here narrow these a little.

**Builder verdict wording, written before any trial (YC invests in Particle):**

- **"within 10 points, no measurable difference":** "In <harness or pooled>, particle-1 solved about as many of these tasks as <frontier>: the gap is <d> points (95% interval <lo> to <hi>), and a loss of 10 points or more is ruled out. It costs <ratio> times as much per solved task."
- **"within 10 points":** "particle-1 is behind <frontier> by <d> points (95% interval <lo> to <hi>), but a loss of 10 points or more is ruled out. It costs <ratio> times as much per solved task."
- **"frontier better, by less than 10":** "<frontier> solves more: <d> points ahead (95% interval <lo> to <hi>), and the gap is under 10 points. particle-1 costs <ratio> times as much per solved task."
- **"frontier better":** "<frontier> solves more: <d> points ahead (95% interval <lo> to <hi>). Keep <frontier> for this use case."
- **"can't tell":** "This run can't tell: the gap is <d> points (95% interval <lo> to <hi>), and it could only have detected a gap of about <MDD> points."
- **"can't tell (no headroom)":** "Frontier models score at or near the top on these tasks, so this run can't say whether particle-1 is as good here."
- **Favouring particle-1:** any headline that favours particle-1 also gives the gap to the frontier model with its interval (disclosures list). Grading here is deterministic, so no judge sensitivity applies.

**Completeness cells:** pass rate and cost per solved task per cell, with intervals, on the saturated set, labelled cross-run (beside matrix-mu-2026-11's cells) and saturated. No call.

**Runner change since matrix-mu:** since 2026-11-09 the runner does not post a harness's returned reply on a turn where the bot already posted in that turn's channel. The reply stays in the record, marked `reply_withheld`, and is not graded. matrix-mu's trials ran before this change, so each cross-run line also reads "runner differs".

## Scoring, exclusions and infra classes

The codegen classes are #337's, unchanged:

- **Pass:** the TB2.1 verifier's reward is 1. A task's own agent time limit is a scored fail (`timeout`).
- **Counts as a fail:** `harness_error`.
- **Excluded pairwise and counted per cell:** `unfinished`, `setup_failed`, `no_model_response`, `effort_mismatch`, `rate_limited` (a 429 that stopped the harness; a trial that recovered is scored as it ended, and its 429s are counted) and `verifier_unavailable` (run order step 4).
- **Lease stop:** `model_error` with cap_stop, excluded, counted and reported in deviations.
- **Pairing:** an excluded attempt drops from both sides of its pair. A task with no attempt scored on both sides drops from that harness's pairs and is listed.

## Contamination, keys and fairness

- **Web tools off and checked:** see above. The proxy also refuses any request that declares a hosted search tool (HE-PROXY-006).
- **Egress blocklist:** as in #337. The benchmark's own sources and the direct provider hosts are refused by TLS SNI and HTTP Host. TB2.1 tasks keep general internet access, a declared deviation.
- **Keys:** each task container sees only the proxy URL and a per-trial dummy token, and only the metering proxy holds provider keys. The install check's canary key appears in no file of the run.
- **Audit (audit.ts)** over each trial's captured request bodies. A trial with a confirmed answer-key receipt is scored a fail.
- **Clean arms:** vm-run.sh's preflight refuses a VM with a Capy drive or a gstack install. The audit counts gstack file reads per cell.
- **Particle-1 is a hosted id that can change.** Each request's echoed model id is recorded and compared across the run window, and claims are dated.
- **Particle's off-peak pricing** is billed at 50%, which the proxy can't see. So particle-1's metered cost is an upper bound, and its cost ratio says so.
- **Known gap, brain sets:** the multi-user Hermes pin still offers web search and the browser tools. No brain cell here depends on it: the completeness cells keep matrix-mu's config for comparability, on synthetic worlds with no internet. Any future brain run must turn them off first.

## Why null?

Every "can't tell" call, and the two brain use cases, get one cycle: exposure, fit, power and saturation, model. Each ends with KEEP, FIX-METHOD (naming the fix) or CUT-CANDIDATE. For a model swap, the verdict reads as model advice: "use particle-1 here", "keep frontier here" or FIX-METHOD. The brain use cases already had their one R61 ceiling-raise.

## Evidence before freeze

- **Install check:** `scripts/frontier-harbor/install-check.json`, from uncounted smoke 7 at aefa37e81b, after the web-off change, the fixes the smokes found and the merge of main ([evidence/particle-smokes.md](evidence/particle-smokes.md)). Four later merges of main changed the agent setup, the harness pins and the shard scripts, and the install check was not run again after them. Run order step 1 runs it at this commit before any counted trial.
- **Particle-1 cost smokes** (uncounted, 3 trials per harness): see the evidence file `evidence/particle-smokes.md`.
- **Headroom checks:** the run ids above. Their receipts stay in the private drive, uncounted.

## Receipts

- **Codegen:** under `results/`: merged `trials.jsonl` and `manifest.json`; per shard its ledger, proxy usage, `run-summary.json`, `preflight-clean-arm.json`, `shard-vm.json` and `web-tools.json`; and `analysis.json`, `analysis.md` and `audit.json`.
- **Completeness:** under `results/completeness/`.
- **Separate PRs.** This preregistration and Amendment 1 merge to main before the first counted trial. The results come in the results PR (R77).

## Amendments

Each amendment is dated and committed before any cell it affects, in [AMENDMENTS.md](AMENDMENTS.md). Amendment 1 is committed with this preregistration, in the same pull request, and adds DeepSeek Harness and DeepSeek-V4.1-Flash-1017 on codegen. Its Cursor CLI cell was dropped on 2026-11-13, before any trial, because Cursor's calls don't pass through our metering proxy. The amendment plan's brain cells, standalone Pi's among them, don't run, because both brain use cases read "can't tell (no headroom)".

## Disclosures

This run features particle-1, OpenAI's GPT-6.1 Sol, Hermes, OpenClaw and QM. The report and any finding file end with these lines, word for word from the disclosures list (R55). No X post carries the long lines.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.
