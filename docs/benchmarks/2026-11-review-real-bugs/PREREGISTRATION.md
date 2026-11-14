# Preregistration: does gstack's review catch real bugs better than a plain prompt? (stage 1)

**Status:** frozen for stage 1 when this file merges to main.

**Takeaways:**
- **We test gstack's /review against a plain review prompt on bugs gstack never saw.** The bugs come from other people's public repos: human reviewers caught some, other review tools caught some, and some slipped through and were fixed later.
- **Stage 1 is one cell: Opus 5.5 in Claude Code, plain against /review without its outside voice, on 55 non-gstack PRs.** Stage 2 (the /ship panel, the two controls and the other models) waits for Garry's go after he has seen stage 1's results, even if every gate passes.
- **A null result at this size can't rule out effects smaller than 17 points.** So stage 1 can't produce a CUT-CANDIDATE for an effect below 17 points.

## The question

On real blocking bugs that no gstack review found first, does gstack's /review flag more of them than a plain review prompt does, on the same model and harness with no gstack installed, without raising false alarms past a preset limit?

"Blocking" follows R12: the bug would fail a test, break production, or lose data or secrets.

## What each result changes (R97)

| Stage 1 verdict for /review | What we do |
| --- | --- |
| KEEP | /review stays the factory's review step on evidence that doesn't rely on its home field. Stage 2 is put to Garry so we can test the /ship panel and the same-cost baseline. |
| LOSS | gstack's maintainers gets a regression report with the per-bug losses. R2's KEEP is withdrawn for non-gstack code, and Garry hears it in plain words. |
| CUT-CANDIDATE (only for effects of 17 points or more) | Garry hears the cut candidate in plain words (R48), after one "Why null?" cycle. |
| INCONCLUSIVE | R2's KEEP is relabelled "home field only". Nothing in the factory changes. Stage 2 is put to Garry with the interval we got, since more PRs or more models are the only way to narrow it. |
| FIX-METHOD | No verdict. The exposure or method specifics go to gstack's maintainers and gstack-evals, and the cell is not repeated until they're fixed. |

## What's different from the approved plan

Each change below follows a rule the plan already had, or a later ruling.

- **Stage 2 never starts by itself.** Garry, 2026-11-14: stage 1's results and gate outcomes go to the coordinating agent, and stage 2 starts only on Garry's word. This is an extra stop condition on top of the plan's stage 2 gates.
- **The PR count is 55, not 110 to 150.** The plan picks the count that reaches a 17-point MDD by noloss power at the pilot's plain rate (floor 20%). On the frozen suite that's 48 to 57 PRs (see Sizing). The bug set itself has 101 non-gstack units in 99 PR clusters, with 1.03 blocking bugs per PR, not the planned 1.25.
- **The source mix falls back to S1 and S2.** S3 (escaped bugs) came to 6 of 101 units (6%), below the plan's 25% yield gate, so the plan's fallback applies. The mix is S1 22, S2 73, S3 6.
- **C1 is judged by Astra alone in stage 1.** The plan added Opus as a second C1 judge because C1's gstack arms included a Sol outside voice, and that voice doesn't run here. The descriptive Gemini 4 Carbon read moves to stage 2.
- **C4 (DeepSeek V4 Pro in Hermes) is dropped.** Our metering proxy has no route that can meter it: main's proxy has no DeepSeek or OpenRouter provider, and OpenRouter serves V4 Pro only as an older snapshot on third-party endpoints. The plan drops any cell whose route can't be metered.
- **C2 (GPT-6.1 Sol) runs in Claude Code on OpenRouter, not in Codex.** The rig can't run a Codex host, and the plan named this fallback. For reader counts, C2 is the claude host.
- **C3 (particle-1 in OpenClaw) tests gstack's single-agent /review.** At the pin, gstack renders /review with no reader army and no adversarial reader on OpenClaw and Hermes (hosts/define-host.ts:23-35). OpenClaw's `agent exec` also can't start subagents ("published reply runtime missing for main"), and it fails the same way with no gstack installed. So C3's exposure gate is "skill opened".
- **The gstack arm is "/review without its outside voice".** gstack's outside voice needs bubblewrap, which the rig's trial image doesn't have (`CODEX_MODE: sandbox_unavailable`). R2 seems to have run under the same condition: its gstack-full cost file has 66 voice rows totalling 80,556 tokens, and the row we sampled was $0 with 0 requests. Adding bubblewrap is a separate containment change for gstack-evals.
- **Reviewers see the PR's title and first-version description.** gstack-evals #344 added this as `review-units --pr-context`. Runs without PR text keep their exact old prompt and session keys, and runs with it pin `TOLD_PR_SHA256` f52ecea76a934596833e535d314b14ce696d4e6ed40926eea532542cdf876a79 and each pr.md's sha256 in the session key. The rig smokes and the pilot ran at 91d76421, the commit just before #344, so none of them showed the PR description.

## Pins

| What | Pin |
| --- | --- |
| gstack under test | `1d3c63c53d17faf0456c564bc5950f18b370d0ef` (stable, v1.99.3.0), for every cell |
| gstack-evals (rig and noloss scorer) | `064c7f18857e6d1850cfb1f69e87e60812b85933` (main, with #344's `--pr-context`) |
| Suite file | sha256 `97b9da91b2b5ffb7d5cc7af14d93896a009cf31a3f846ba3d691a96513a9d84b` (private until results; published with them) |
| C1 model | `claude-opus-5-5` on Anthropic, in Claude Code through the rig |
| Rig inputs | the files under `rig/`, pinned by sha256 in rig/README.md; the told lines are `told-review.txt` (R2's line, word for word) and the plain `none` arm with no prefix |
| Judging briefs | `judging/judge-brief.md` f2f9c98302bb03acc49bede4157bfb0d3e083392ecf4b4b715eb3ca4f8022a26, `judging/labeller-brief.md` f05c796286723f4035850c18f944d9bd7059573461e1c10eccefb110d6fe8d12, `judging/adjudication-brief.md` 3331c7e8380ca7a9bc47b278a1f626e2893d480a3444cb7833ac1fede1716116 |

## Bug set (the suite)

- **Strata.** 101 non-gstack units from 42 repos: S1 human-review catches 22, S2 review-tool catches 73 (by the tool's model family: mixed 47, OpenAI 25, Google 1), S3 escaped bugs 6. Plus H, 20 home-field units (18 stacks-r1 units, drawn with seed 2665 from 26 clusters, and the 2 harness-evals #206 units), and N, 15 no-bug decoy PRs.
- **Screening.** An Astra call and an Opus call each judged every candidate against R12, and a bug was kept only when both said blocking. Opus is also under test, so this bias is stated. A second read checked each kept description against its fix commit. 533 units (602 bugs) were screened from 1,038 raw candidates, and 114 units were kept, cut to 101 by the cap of 4 per repo.
- **Repro.** S3 bugs count only with a failing regression test at the introducing PR's own head (the plan also allowed a scripted repro, but none were built; 25 confirmed, 6 kept after screening). S1 and S2 bugs were not repro-run, so their repro-confirmed field is empty and the repro sensitivity line covers S3 only.
- **Units.** Each unit repo holds only the head's ancestry, fetched by sha. It has no remotes, tags, reflog or later objects, and a keyless canary per unit checks that. The PR description is its first revision, with any mention of the later fix removed.
- **The counted set.** The first 55 units of a seeded, stratified draw from the 101 (seed 2665, units ordered within each stratum by sha256("2665:<unit id>"), strata in proportion to the suite: S1 12, S2 40, S3 3), plus all of H and N. The 15 pilot units come first in that order.

## Arms (stage 1)

- **plain:** the rig's `none` arm, with no gstack installed (R44) and no told prefix. It follows the clean-arm rules: no Capy drive, no gstack install, and an audit of every file read.
- **review:** gstack's /review at the pin, told with R2's line, default install for the claude host, as shipped, minus the outside voice (see above).
- **Passes:** 2 per arm per unit. Both arms of a unit and pass are scheduled in the same round, in a fixed arm order; the rig does not randomise the order.
- **Common flags:** as in rig/README.md (`--system-prompt claude-code-preset`, `--max-turns 200`, `--cap-stops`, `--timeout 10800`, `--background-wait 3600`, `--allowance 40`, our severity map, and `--reader-map` for the review arm), plus `--pr-context`.

The /ship panel, plain-2fam and plain-8 are stage 2 arms. When they run, plain-8 is scored as a curve at 1, 2, 4 and 8 merged passes, and each point is scored as one merged pass.

## Exposure gate

- Four signals per PR-pass, read from Claude Code's own session log by `scripts/review-bugs/exposure.ts`: the skill file opened, the reader army dispatched, the adversarial reader dispatched, and each reader's report returned before the session ended. An unreadable transcript is a gap, never counted as exposed or not exposed.
- **Expected readers per unit** come from `scripts/review-bugs/depth.ts`, which applies gstack's own depth rule at the pin to each unit's diff before the run. A reader gstack adds beyond that set (api-contract, seen in both Sol smokes) counts as extra, never as a miss.
- **The gate:** the review arm counts only if, in at least 90% of its PR-passes, the skill file was opened and every expected reader was dispatched and returned.
- **Smokes before the grid:** a 3-session paid exposure smoke per cell must pass 3 of 3, or that cell stops with FIX-METHOD. Stage 1 runs the smoke for C1, C2 and C3.

## Grading

- gstack-evals noloss judge-packet, judge-run (with its evidence sheet), derive and score, at the pinned rig, with no scorer changes.
- **Judge:** Astra for C1, which is outside the Claude family.
- **Blinding:** findings normalised to path, line and one paragraph before judging. Arm, reader names and gstack's labels are stripped, severity goes through the frozen map, and packet order is seeded. A blinding check asks a judge to guess the arm on 20 packets, and more than 70% correct is reported as a blinding failure.
- **Severity map:** `rig/severity-map.json` (sha256 4034fd51a417d669f651e966f1b0e9971c6c84706f6f0f840d8e1e781ca3b58b). It leaves 0 labels unmapped on R2's findings. For the gstack arm, High, P0 and P1 map to CRITICAL, following gstack's own blocking rule at the pin. This differs from R2, where a High label stopped the run.
- **Judge check (R78):** Astra and Opus label separately with the fix commit and the bug's evidence in view, and the items they agree on become labels. The blind judge needs kappa of at least 0.6 on at least 60 matching items and on at least 60 adjudication items. The rewritten adjudication brief was dry-run on R2's 22 second-read items before freeze. That run's record isn't part of this PR, so its agreement figure isn't quoted; the counted check above decides.
- If the adjudication check fails, false blockers on bug PRs are descriptive only, false alarms are read from the decoys only, and a recall gain gets the label "KEEP (recall only; false blockers on bug PRs unmeasured)".

## Numbers and verdict

- **Co-primary**, on the non-gstack stratum: the blocking recall difference (review minus plain) and the any-severity recall difference, per bug, as the share of passes that found it. Each comes with a 95% PR-clustered interval and a sign-flip test over PRs, with p-values from a seeded Monte Carlo draw of 10,000 sign assignments (seed 2665). A severity-blind read (derive --impact) is reported beside them.
- **Holm:** the two co-primaries are Holm-adjusted together. A KEEP whose Holm-adjusted p-value is above 0.05 is reported as INCONCLUSIVE, with the unadjusted KEEP shown next to it.
- **Guards:** false alarms per decoy PR, and false blockers per bug PR (review minus plain), paired, with 95% intervals and a preset limit of +0.5 per PR. When the judge check passes, both guards must hold. When recall rose, a guard that can't be read makes the verdict INCONCLUSIVE.
- **Verdict:**
  - **KEEP** when both co-primary intervals are above zero, or blocking is above zero and any-severity isn't below zero, and both guards hold.
  - **LOSS** when either co-primary interval is below zero.
  - **CUT-CANDIDATE** when the gate passed and the blocking interval's upper bound is below the MDD, after one "Why null?" cycle and one attempt to raise the ceiling if plain is near it (R48, R61). **At 55 PRs the MDD is 17 points by noloss power at the pilot's 30% plain rate, so a null here cannot support a CUT-CANDIDATE for any effect below 17 points.** The plan's conservative planning scale puts the MDD at this size near 31 points, and we report that figure beside the verdict.
  - **FIX-METHOD** when the exposure gate failed, or recall rose while false alarms went over the limit.
  - **INCONCLUSIVE** otherwise.
- **Reported beside the verdict:** exposure per arm, per-stratum recall (S1, S2 by tool family, S3, H, with H always kept apart from the headline), defects found beyond the suite, cost per PR and per bug found, the repo-clustered interval and the newest-half subset.

## Sizing

- **Pilot (not counted):** plain, Opus 5.5, 2 passes on 15 units drawn as above. It ran without the PR description and with a judge not yet checked against labels, so it's a sizing estimate only. Plain caught 30.0% of blocking bugs (9 of 30 unit-passes; 95% interval 10.0% to 53.3%, bootstrap over bugs) and 53.3% at any severity (33.3% to 73.3%). By stratum: S1 4 of 6, S2 5 of 22, S3 0 of 2. It ran at `--allowance 10 --parallel 1`, because the rig reserves a 4-session round's worst case at R2's $40 allowance. Counted runs use R2's $40.
- **Method:** `gstack-evals noloss power` at 2 passes, 2,000 simulations, seed 1, alpha 0.025 one-tailed, at the pilot's plain rate floored at 20%, on the frozen suite's cluster sizes.
- The MDD was computed on the first 55 PR clusters in suite order, not on the counted draw; the results report the MDD recomputed on the counted 55 units.

| Plain rate | Smallest N reaching MDD 17 | MDD at all 99 clusters | Plan's planning scale at the same N |
| --- | --- | --- | --- |
| 20% (floor) | 48 | 12 | 26.5 at 48; reaches 17 at about 116 |
| 25% | 51 | 12 | 28.8 at 51; reaches 17 at about 146 |
| **30% (observed)** | **55** | **13** | about 30.8 at 55 (extrapolated); about 180 for 17 |
| 35% | 56 | 13 | no plan figure |
| 40% | 57 | 13 | no plan figure |

- **Both figures are stated on purpose.** noloss gives each bug one difficulty that both arms share, so pairing cancels most of the variance. The plan's planning scale came from R2's power run and is about 40% more conservative. If the planning scale is the right one, stage 1 at 55 PRs can detect only about 31 points, and the verdict mapping above already reflects that.

## Stop rules

- Each cell's grid starts only after its 3-session exposure smoke passes 3 of 3.
- A cell whose projected cost from its first 10 units runs more than 30% over its line pauses for the coordinating agent.
- No paid trial is rerun to change a verdict.
- A model that refuses a review is a result and is never swapped (R95). A provider's safety-filter stops are reported as their own outcome.
- **After stage 1, everything stops.** The results and every gate outcome go to the coordinating agent, and stage 2 starts only on Garry's word, even if its gates passed (Garry, 2026-11-14).

## Sharding and spend

- **C1** runs as one shard on one Ubicloud standard-16 VM, with the rig at `--parallel 4` (its default). The cell isn't split across machines. Wall time is reported only as a description, not as a metric. A canary block of 2 units runs first, and the rest starts only after the canary has scored and copied its results off the VM. UBI_TTL_HOURS is set above the expected wall time plus margin, and the VM is destroyed on every exit.
- **C2 and C3 smokes** run 3 sessions each, under their own ledger items.
- **Spend lines** (paid, through the metering proxy, one ledger lease per shard), on 90 units (55 non-gstack, 20 H, 15 decoys) at 2 passes:
  - C1 plain: about $90 (pilot: $0.44 a session).
  - C1 review: up to about $1,200 (R2's $6.52 a session; our smoke was $2.56).
  - Judging, label pass, judge checks and blinding check: about $400.
  - Exposure smokes for C1, C2 and C3: about $40.
  - Expected about $1,750. **Stage 1 cap: $2,500**, inside the plan's $14,000 total cap.
- **Spent before freeze:** suite screening $61.99, rig smokes and adjudication dry run $9.87, harness smokes $0.29, Sol smoke rerun $2.84, pilot $14.42 ($13.29 plain sessions, $1.13 judging), and about $5 of VMs.

## Outside terms

Only repos under OSI licences are used. Units are referenced by URL and commit, bug descriptions are in our own words, no third-party review text is copied, and contributor names are not published.
