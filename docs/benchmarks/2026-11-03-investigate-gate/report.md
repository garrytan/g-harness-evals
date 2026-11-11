# /investigate reproduce-first gate (internal-task): Phase 3 results

**The outcome is NOT ADDED. The prereg's FIX clause fires: on Opus 5.5 the gate's arm followed reproduce-first in 2 of 28 sessions (7.1%), below the 75% bar. But the repair and H-only rerun FIX allows don't fit under the $300 cap. The pooled KEEP bars fail too, which also leads to NOT ADDED. internal-task confirmed there is no rerun (R57, 2026-11-03, via the Captain), and the prereg's NOT ADDED clause says "No follow-up run."**

- **Primary, pooled H-S pass rate:** +1.28 points, 95% CI [-3.80, +6.35]. KEEP needs at least +10 with the lower bound above 0.
- **Opus H-S:** +7.14 [0.0, +16.67], but about -0.3 if the 11 lost Opus trials had counted. **Sol H-S:** -3.22 [-9.66, 0.0].
  - **The +7.14 isn't robust.** The VM logs recorded rewards for 11 lost Opus trials: S 4/5, H 1/3, N 2/3. Counted, Opus H-S would be about -0.3. They're excluded under the prereg's INFRA rule, so +7.14 stands as reported, but it doesn't support any gain.
- **The gate didn't bind Opus.** Opus wrote source through Bash 40 times, past the gate. The gate bound a hypothesis in 13 of 28 Opus sessions, against 33 of 33 on Sol.
- **Sol sat near the floor.** Sol's no-gstack arm passed 1 of 22 (4.5%), and every Sol arm sat near zero. That makes a gain hard to detect on Sol, not impossible.
- **N stayed clean.** 0 of 41 no-gstack sessions read any gstack file.
- **Spend:** $254.31 of the $300 cap.

**Terms**

- **Arms:** N has no gstack installed and a plain prompt. S is gstack `04f80459` with `/investigate` and no gate. H is S plus the reproduce-first gate at gstack `f5a7cce`. All three run Claude Code 2.1.312.
- **Pass:** the task's hidden tests pass, per trial.
- **Follow:** from the prereg's scorer `scripts/investigate-gate/score.ts` at `f5a7cce`, identical in every arm.
  - A session follows when a qualifying failing Bash run on unchanged tracked non-test source comes before its first source change (measured as a worktree delta, not by tool name).
  - That run must pair with a later passing run of the same command, or of one naming the repro's test target, after the last source change.
  - A session with no source change is not a follow.
- **Unit:** a (model, task) pair. CIs come from 10,000 bootstrap resamples of units within each model, seed 938, on the trial-weighted pass-rate difference.

Sources for the numbers below:

- every count, rate and interval: a file under [results/](results/);
- spend: internal-task's spend ledger, summarised in [results/spend.json](results/spend.json);
- internal-task comment ids: [results/amendments.json](results/amendments.json).

## 1. Verdict under the prereg's decision rule

| KEEP clause | Value | Holds? |
|---|---|---|
| Pooled H-S at least +10 points | +1.28 | no |
| Pooled H-S 95% lower bound above 0 | -3.80 | no |
| No model at H-S of -10 or worse | Opus +7.14, Sol -3.22 | yes |
| H-N point estimate at least 0 | pooled +5.88 (Sol alone -1.52) | yes, read as pooled |
| H cost per solved task at most 2x S's | $3.01 against $3.19 | yes |
| H follow at least 75% on each model | Opus 7.1%, Sol 87.9% | no |
| `--no-repro` in at most 20% of H sessions | 4 of 61 (6.6%) | yes |

- **The H-N clause:** the prereg doesn't say whether it is pooled or per model. Read per model, Sol fails it. KEEP fails either way.
- **FIX fires** because H follow is below 75% on Opus. The prereg labels FIX "mechanism only" and allows one repair and an H-only rerun only if they fit under the $300 cap.
- **The prereg doesn't say whether FIX applies when other KEEP clauses also fail**, as the pooled +10 bar and its lower bound do here. results.json's decision note records this. Either reading ends at NOT ADDED.
- **The rerun doesn't fit.**
  - $254.31 is booked, so $45.69 is left on the ledger. The real headroom is smaller, because the cap also covers planning and the ledger books only measurement.
  - The 61 counted H trials cost $42.19 in model spend alone ($20.58 Opus, $21.61 Sol), which leaves $3.50 for the VMs and the repair.
  - So the result is **NOT ADDED**.
- **No INSUFFICIENT clause holds:**
  - Pooled Gate P passed after the second screen.
  - The second-screen route set Phase 3 at 11 tasks, and the cap rule cut no further. In practice Opus carries 10 units, because sympy-16597 has no counted trial.
  - N contamination is 0%.
- **What KEEP would have needed.** Hold Sol and Opus S at their observed counts. Pooled H-S then reaches +10 only if Opus H passes 19 of 28, an Opus H-S of +28.57 points. Treating the pool as an approximate trial-weighted mix of the two models, that is about +25.6 points ([mdd.json](results/gates938-phase3/mdd.json)). The exact solve, with each arm at its own trial count, is about +26.1 points; 25.6 comes from mdd.json's trial-weight approximation. The observed Opus H-S is +7.14.

## 2. Results

**Contrasts** (points, 95% CI; [results.json](results/gates938-phase3/results.json))

| | H-S | H-N | S-N |
|---|---|---|---|
| Pooled | +1.28 [-3.80, +6.35] | +5.88 [-3.68, +15.08] | |
| Opus 5.5 | +7.14 [0.0, +16.67] | +14.85 [-0.25, +30.64] | +7.71 [-4.27, +20.51] |
| GPT-6.1 Sol | -3.22 [-9.66, 0.0] | -1.52 [-13.64, +9.09] | +1.70 [-13.64, +18.75] |

- **The 0.0 bounds are structural.** Opus H matches or beats S in all 10 units, so no resample can go below zero. The whole +7.14 comes from two teleport units that differ by one trial each. Sol's 0.0 upper bound comes from one unit, openlibrary, where S passed 2 and H 1.
- **Lost trials:** the 11 lost Opus trials with logged rewards (S 4/5, H 1/3, N 2/3) would move Opus H-S to about -0.3 if counted. They're INFRA under the prereg and stay out of every number here.

**Arms** (counted trials). Dollar figures are trial-row spend, including the one INFRA row (Sol S3, so Sol S is $22.4091 over 33 rows). They exclude the 13 reaped trials and the $24 booked for them.

| Model | Arm | Pass | Follow | $ per trial | $ per solved |
|---|---|---|---|---|---|
| Opus 5.5 | S | 11/28 (39.3%) | 4/28 (14.3%) | 0.6788 | 1.7279 |
| Opus 5.5 | H | 13/28 (46.4%) | 2/28 (7.1%) | 0.7351 | 1.5833 |
| Opus 5.5 | N | 6/19 (31.6%) | 0/19 (0.0%) | 0.5431 | 1.7197 |
| GPT-6.1 Sol | S | 2/32 (6.2%) | 25/32 (78.1%) | 0.6791 | 11.2045 |
| GPT-6.1 Sol | H | 1/33 (3.0%) | 29/33 (87.9%) | 0.6547 | 21.6061 |
| GPT-6.1 Sol | N | 1/22 (4.5%) | 18/22 (81.8%) | 0.5382 | 11.8403 |

- Pooled cost per solved task: H $3.01, S $3.19, N $3.17.
- **Unscorable sessions:** 0 in every arm. Every counted trial had a non-empty recorder file.

**H gate counts** (from the gate state each H session wrote)

| | Opus 5.5 | GPT-6.1 Sol |
|---|---|---|
| Sessions with gate state | 28 of 28 | 33 of 33 |
| `--no-repro` escapes | 4 (14.3%) | 0 |
| Denials | 25 (0.89 per session) | 42 (1.27 per session) |
| Hypothesis bound | 13 | 33 |
| repro_valid | 10 (35.7%) | 30 (90.9%) |
| Report bypasses | 0 | 0 |
| Bash-edit bypasses | 40 | 0 |

**N contamination** ([audit.json](https://github.com/garrytan/harness-evals/blob/07312a7ed46faa2fd9d20ba40057a865d6c20ee3/scripts/gates-938/phase3-results/audit.json))

- Opus: 0 of 19 N sessions contaminated. Sol: 0 of 22. Pooled 0 of 41, against the 10% INSUFFICIENT line.
- Sol N listed the recorder directory by name in 3 sessions, with no file read. The audit counts listings of `/opt/igate` or `/opt/rec` without recording which; Phase 3 mounts only `/opt/rec`. Under amendments 2 and 3, a listing is counted and is not a touch.
- Each N trial's container preflight found no gstack name, link, skills entry, PATH binary or root gstack directory (all zeros in the 41 counted N rows of `trials.jsonl`).
- The audit marks S and H sessions as touching gstack because gstack is installed there. That column only matters for N.

## 3. Why null?

- **Exposure: the gate reached both models but didn't bind Opus.**
  - Every H session wrote gate state (61 of 61), and the gate denied edits 25 times on Opus.
  - Opus still wrote source through Bash 40 times. The gate counts each of those as a bypass, and each one makes the session a non-follow.
  - Opus bound a hypothesis in 13 of 28 sessions, and repro_valid was 10 of 28.
  - Sol bound in 33 of 33 and was repro_valid in 30. But Sol's no-gate arms already followed often (S 78.1%, N 81.8%), so the gate changed little in what Sol did.
- **Fit:** the tasks are test-reproducible bugs from SWE-bench Pro and Verified. They were screened so N passed at most 50% on each model's pilot trials, which is the population the gate targets.
- **Power and saturation:**
  - **Opus had headroom.** Opus N passed 31.6%, clearly below the top.
  - **Sol sat near the floor.** Sol N passed 4.5%, S 6.2% and H 3.0%. That leaves little room to show a gain, but some: Sol's S-N interval reaches +18.75. So a gain is hard to detect on Sol, not impossible, and Sol's half of the pool adds mostly noise.
  - **Minimum detectable difference** (80% power, two-sided 5%, 2.80 bootstrap SDs): pooled 7.35 points, Opus 12.48, Sol 8.51 ([mdd.json](results/gates938-phase3/mdd.json)). The pooled MDD is below the +10 KEEP bar, but Opus carries about 0.46 of the pooled trial weight, so an effect on Opus alone moves the pooled figure by less than half its size. Holding Sol at its observed result, an Opus-only effect below about +26 points can't reach the pooled bar. So the pooled design partly hides a one-model effect, and the null is partly a power limit. Opus alone (MDD 12.48) could not resolve a +10 effect either.
  - **Lost trials:** counting the 11 lost Opus trials' logged rewards would take Opus H-S from +7.14 to about -0.3. They're excluded under the INFRA rule, and the one positive point estimate isn't robust.
- **Model:** every arm ran a frontier model (Opus 5.5 and GPT-6.1 Sol). No Haiku, Sonnet or small model is under test.

`Verdict: FIX-METHOD (gate Bash-mediated source writes as edits; pick tasks where Sol N is well above the floor)`

## 4. Closing the loop on #224 and internal-task

Opus had headroom here (N 31.6%), but the gate didn't make it follow the steps. Sol's low baseline left little room to show a gain. So the skill-steps CUT-CANDIDATE from [2026-11-01-opus-gstack-follow](../2026-11-01-opus-gstack-follow/report.md) does not go to Garry.

- **Who decided:** the Captain, 2026-11-03, for the internal-task lane. No prereg rule makes this call.
- **Limit:** Opus edited through Bash past the gate, so this run did not cleanly test enforcing skill steps with a hook. A gate that also covers Bash-mediated writes is the open test.

## 5. The five fail-closed audit cases

All five live in `tests/gates-938-audit.test.ts` on `harn14/gates-938` (`570cd01d3`).

1. **Empty or unreadable trace:** covered. In `case 1`, a missing, empty or unparseable transcript, recorder or H gate state makes the session unauditable, and an unauditable session counts as contaminated.
2. **An arm with zero trials:** covered. In `case 2`, zero sessions or zero auditable sessions in an arm is an error.
3. **A bare `gstack` router call:** covered. In `case 3`, a Skill call named `gstack`, a `gstack ...` Bash call and a `gstack-*` binary each count as a touch, and `sigstack` does not.
4. **A symlinked SKILL.md:** covered by the container preflight and the init skill check, not by a path match.
   - In `case 4`, `preflight.sh` resolves a symlinked SKILL.md and a symlinked skill directory and reports them as links.
   - The same case checks that an N init event listing a non-built-in skill is contaminated. That catches any linked skill Claude Code loads, whatever its name.
   - The session audit itself matches the path the agent used, so a read through a link with an innocent name would not match on its own. For N, the preflight closes that gap: every counted N trial recorded 0 links and 0 skills entries.
5. **Undecodable tool arguments:** covered. In `case 5`, a cut-off argument or recorder line makes the session unaudited (so contaminated), and its raw text is still pattern-matched for gstack names.

## 6. Trial accounting

- **Planned:** 176 trials, 22 shards (one per task-model pair) of 8 sequential trials, in the order S1 H1 N1 S2 H2 N2 S3 H3.
- **Counted: 162.** `trials.jsonl` has 163 rows from 22 shard directories. One row is uncounted.
- **INFRA: 14, all uncounted and none rerun.**
  - p3-sol-06 S3 (row in `trials.jsonl`): two requests were refused because reserving $3.23 would have taken the shard past its $12 lease at $8.89 committed.
  - 13 trials with no row ([infra-reaped.json](results/gates938-phase3/infra-reaped.json)): in p3-opus-02 (Opus, vuls-e6c0da6), S1, H1, N1 and S2 finished but were never copied back, and H2 was in flight. In p3-opus-05 (Opus, sympy-16597), S1 through S3 (7 trials) finished but were never copied back, and H3 was in flight.
- **Never started, then run under internal-task's ruling (not reruns):**
  - p3-opus-02 N2, S3 and H3 ran in shard p3-opus-02r (amendment 6).
  - p3-sol-06 H3 ran in p3-sol-06r (amendment 7).
  - All four kept their trial ids. No id appears twice in `trials.jsonl`, and the analysis script stops on a duplicate.
- **Check:** 162 counted + 14 INFRA = 176.
- **Cells left short:**
  - Opus sympy-16597 has no counted trial.
  - Opus vuls-e6c0da6 has only N2, S3 and H3, all from p3-opus-02r.
  - Sol vuls-e6c0da6 has S×2 and H×3.
  - That leaves Opus with 9 full tasks plus one thin unit, and Sol with 10 full tasks plus one short unit.
- **Reaper note:** the Phase 3 launcher left `UBI_TTL_HOURS` at its 3-hour default. At 2026-11-03T04:00:36Z, internal-task's gbrain operator reaper destroyed two wave A VMs about 70 minutes past that TTL, with their trial files, ledgers and proxy logs. Wave B and both extra shards ran with `UBI_TTL_HOURS` set to 12, 6 and 3 hours.

## 7. Deviations and amendments

internal-task-a comment ids are given in brackets. The plan file is pilot-plan.md in the Captain drive (handoffs/internal-task-b/gates-938/), and the prereg is frozen at sha256 `9fbafda9...5b1485`.

- **Pilot plan** [icm_01M6DVVJ8D7W81MJ0EEMBH7YMW], posted before the first paid pilot trial.
- **Amendment 1** [icm_01M6DYM4KXXS39YYMT354CXSD8]:
  - The first launch at `715d8396` is void: 64 INFRA trials and 0 model requests, because Harbor's sidecar base image was not prepulled.
  - Fixes are in `907a3c1a` and `156b115e1`. The run moved to id `gates938-pilot-b` at `b18af25dc`.
- **Amendment 2** [icm_01M6E7DZDFBKN2EKQYWRFKVEMC]:
  - Claude Code's `count_tokens` calls were refused, giving four INFRA pairs, which were never rerun.
  - From then on, count_tokens is forwarded free on Anthropic and answered with a local 404 on OpenRouter.
  - The 12 Sol slots that never started ran once each. Runner `9d0f93d0b`.
- **Amendment 3** [icm_01M6EDF6T1G714DDFCVTZ8DDHZ]:
  - The recorder became a single compiled file at `/opt/rec` in every arm, so N could no longer see gate text. Runner `be5fb0cac`.
  - Sol ansible-c616 hit a lease-reservation refusal and is INFRA. Leases went to $12.
- **Screen 1 Gate P not met** [icm_01M6ERPB554GH98HAEWSCAH1Y6]: Opus 11 eligible, Sol 9, with 12 needed ([phases-0-2.json](results/phases-0-2.json)).
- **Screen 1 INFRA pairs, never rerun, uncounted and ineligible:**
  - Opus ansible-c616 (count_tokens).
  - Sol django-15957, webclients-281a and nodebb-8168 (count_tokens).
  - Sol ansible-c616 (lease reservation).
- **Amendment 4** [icm_01M6ESGJG26X83QZSG9FJ172EQ]: a second screen of 32 under the same selection rule.
  - Addendum [icm_01M6EZ8T6RHV3MDDPAZ95TV5Q1]: checks, the final 32 and the plans. Five Pro primaries that failed the Alpine build were replaced by reserves 1 to 5. Image digests were resolved through mirror.gcr.io after a Docker Hub 429, and they matched all 32 screen 1 digests.
  - Part 2 [icm_01M6F7J11QDRGCZECEXP63ZK8H]: Phase 2 ran alongside screen 2, with wider shards.
  - Screen 2 wave 1 result [icm_01M6F7STCKE27QKP8NYKQD417P].
  - A Capy machine restart aborted the first screen 2 wave 1 attempt during VM setup, with no trial and no model call. Its VM time is an estimate.
- **Pooled Gate P met** [icm_01M6FAD199TPZM63MRAVAN4PR2]: Opus 18 eligible, Sol 23.
  - Phase 3 ran 11 tasks per model, not the prereg's 12, because the prereg drops to 11 after a second screen.
- **Amendment 5** [icm_01M6FAJ1SRAW5G01KJZSED2AHF]: the Phase 3 plan.
  - 22 shards with $12 leases, run id `gates938-phase3`, runner `be5fb0cac`.
  - Gate files, arm tars and the recorder were re-confirmed by hash.
- **Amendment 6** [icm_01M6FSWMNVX2BXEYY9XJFR1AFK]: the two reaped shards. 13 trials are INFRA, and the 3 never-started trials ran as p3-opus-02r.
- **Amendment 7** [icm_01M6GBGWQQQKYA8KNXHHD69XJ9]: p3-sol-06 H3 ran as p3-sol-06r with an $8 lease.
- **Spend:**
  - $0.2464 of Sol calls made before the BYOK pricing fix counts against the cap.
  - The two reaped shards are booked at their lease ceilings.
  - The $280 cap rule is a check before Phase 3: if spent plus the projected Phase 3 cost passes $280, Phase 3 drops tasks. Under amendment 5 it kept 11 tasks per model. Phase 3's measured prices then ran above that projection, and the run ended at $254.31 against the $300 hard cap.

## 8. Spend

[spend.json](results/spend.json), from internal-task's spend ledger.

- **Total:** $254.31 of $300. That is $204.60 model (booked) and $49.71 Ubicloud.
- **Phases 0 to 2:** $74.83 model, $23.39 Ubicloud.
- **Phase 3:** $129.76 model, $26.32 Ubicloud. There were 24 standard-16 VMs, 3,167 VM-minutes in all.
  - The two reaped shards are booked at their $12 lease ceilings ($24 in all). Their VM run logs show $9.22 for the 11 trials that finished, plus two in-flight trials whose spend is unknown.
- **Reconciliation:** 3,471 of 3,471 OpenRouter (Sol) requests reconcile ([reconcile-sol.csv](https://github.com/garrytan/harness-evals/blob/07312a7ed46faa2fd9d20ba40057a865d6c20ee3/scripts/gates-938/phase3-results/reconcile-sol.csv)). Opus calls go to Anthropic directly, so there is no OpenRouter bill to reconcile them against.

## 9. Pins

[pins.json](results/pins.json)

- **Gate:** garrytan/gstack `f5a7cceadb5823473575514d44abd4d67250008e`.
- **gstack for S and H:** `04f80459cb5465611966aab20110de4590628b9c`.
- **Claude Code:** 2.1.312 in all 163 trial rows.
- **Harbor:** `f3a5a923f6d722472c9e797af836ae4425fb215f`.
- **harbor-datasets:** Verified `86723674f04e4209ac479d0fb75d9d9f44b4377e`, Pro `c8e8f3fac7097accaacf261d74c3d6f441de45b1`.
- **Runner:** `be5fb0cac6972589ba6304095dcc43272cc4aa58` on the scratch branch `harn14/gates-938`. The analysis landed at `570cd01d39fb3d29771ea8b9f50f9c070371bdfa`, and the receipts this report links (audit, reconciliation and the analysis scripts) are at the branch head `07312a7ed46faa2fd9d20ba40057a865d6c20ee3`. The branch is never merged.
- **The OpenRouter route** in `runner/proxy/metering-proxy.ts` exists only on that branch. It is **unmerged** and is cited by commit here.
- **Arm tars (sha256):** N `8bab4833...`, S `0fe0936c...`, H `fc01d1cd...`. Recorder `/opt/rec/recorder.js` `b5e98b44...`.

## Files

- [results/gates938-phase3/](results/gates938-phase3/README.md):
  - trials, results and table;
  - lost-trial records;
  - MDD and how to rerun the analysis;
  - links to the audit, the reconciliation and the analysis scripts, kept on `harn14/gates-938` at `07312a7ed`.
- **If the scratch branch goes away:** the linked files are kept in the Captain drive at handoffs/internal-task/gates-938/evidence/phase3/, with the sha256s listed in the results README, and can be republished on request.
- [results/phases-0-2.json](results/phases-0-2.json): Phase 0 smoke, Gate P counts for screen 1, screen 2 and pooled, and the Phase 2 prices.
- [results/spend.json](results/spend.json), [results/pins.json](results/pins.json) and [results/amendments.json](results/amendments.json).
- **Not committed:** transcripts, recorder and gate-state files, ledgers, proxy logs and task content. They are in the Captain drive at handoffs/internal-task/gates-938/evidence/.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
