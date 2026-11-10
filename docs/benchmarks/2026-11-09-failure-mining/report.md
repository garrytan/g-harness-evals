# Why frontier agents fail in trials we already ran (failure-mining-2026-11): report

**We learned that a brain the bot can search without a per-person scope makes failures more common, and that a scoped brain did not (descriptive).** In the gbrain arms, failures where the bot pulled another member's records out of gbrain showed up in 11.6% of brain-arm trials, weighted per paired unit (120 of 916 brain-arm trials, 13.1%, unweighted; a class that needs a brain, so it cannot occur without one; descriptive). You should bind every gbrain read in a shared bot to the person asking, in gbrain or its installer, not in the model's prompt.

**We learned that the most common failure in every harness is answering from the wrong conversation.** 348 of 784 failed trials in the default arms (44%) read the channel the question came in and missed the one that held the fact. In 208 of them (exploratory) the bot had already seen the correction in another channel, but each session was keyed on one conversation. You should test cross-conversation memory as a harness feature before blaming the model.

**gstack was not exposed in this corpus.** No multi-user trial ran it, so this run can neither keep nor cut it.

- **What ran:** no new agent trials. particle-1 labelled each of the 1,998 failed frontier multi-user trials that have transcripts with one root cause from a frozen 20-class codebook, plus the first wrong step. Opus 5.5 and GPT-6 Astra built the gold set it was checked against.
- **The labeller passed its gate (R78):** kappa 0.936 against 179 gold trials where Opus and Astra agreed (coverage 178 of 179). Test-retest: particle-1 kappa 0.905 (n 98), Opus 1.000 (n 40).
- **gbrain, preregistered test:** 1 of 6 Holm-adjusted tests is significant, and it says gbrain made retrieval failures more common: `retrieval_any` +9.5 points [+5.4, +13.5], Holm p 0.0012, 39 of 106 paired units worse. The measure leans slightly toward "worse" for gbrain by construction (limit below).
- **Where the harm comes from:** `unscoped_brain_search`, +11.6 points [+8.4, +15.1]. Brain configurations that bind reads to the asker had it in 0 to 0.5% of trials; unscoped ones in 15 to 47.5% (descriptive, below).
- **Verdicts (R48):** gbrain **CUT-CANDIDATE** under the preregistered rule: shut off unscoped gbrain reads in multi-member bots. gstack **FIX-METHOD** (preregistered): test QM's gstack edition against plain QM on the tasks where the top-ranked gstack-claimed classes occur, and keep coding trajectories in the investigate gate's next run so its failures can be labelled.
- **Broken or weak:** particle-1 never assigned `harness_injected_out_of_scope` (0 of 5 gold cases), so QM memory-provider failures likely sit under `unscoped_brain_search`. All 12 Claude Code SDK coding failures got class `other`: the codebook does not fit coding work. 12 of 2,010 labels failed, all in variant arms; the regrade overrides 8 and 4 count as unlabelled.

## What ran

- **Corpus (frozen in the preregistration, #356, `847f77a78a`):** 2,088 failed multi-user trials on Opus 5.5 and GPT-6.1 Sol across every counted run on main. 1,998 have transcripts and got a packet; 47 uncounted trials have no trial files; 43 are excluded rows. Plus 12 failed Claude Code SDK sessions from the gstack follow-up runs (`gn-follow-2026-11`, `gn-follow-preset-2026-11`), descriptive only.
- **Populations:** `default` (each run's shipped or plain arms) is ranked and tested: 3,162 trials, 784 failed, 300 cells, 52 task clusters. `variant` (ablations) and `uncounted` (probes) get the same tables in [results/analysis.md](results/analysis.md) and are never pooled.
- **Labels:** particle-1 for the whole corpus and the SDK sessions; Opus 5.5 and GPT-6 Astra on the 200-trial gold sample; retests with fresh caches. Every label is in [results/labels/](results/labels/).
- **Mechanical regrade:** 105 v0.4 variant trials that pass under grader `25bfe8369b` are labelled `graded_before_fix` without a model.
- **Analysis:** `bun scripts/failure-mining/analyze.ts` at the preregistration commit, output in [results/analysis.md](results/analysis.md). Rerunning it from the committed labels gives the same file byte for byte (checked).

## Label status

| Population | Failed trials | Verified | Unverified | Failed | Missing (no trial files) | Mechanical (regrade) |
|---|---|---|---|---|---|---|
| default | 784 | 763 | 21 | 0 | 0 | 0 |
| variant | 1,090 | 968 | 13 | 4 | 0 | 105 |
| uncounted | 171 | 123 | 1 | 0 | 47 | 0 |

## The labeller check (R78)

- **Gold:** Opus 5.5 and GPT-6 Astra labelled the same 200-trial gold sample. They agreed on 179 (kappa 0.881), so the gold set is 179 items, above the 40 needed, and no extra draw ran.
- **particle-1 against gold:** agreement 0.944, **kappa 0.936** over all 179 gold trials, 178 labelled (coverage 0.994; the unlabelled one counts as a disagreement). The gate (kappa at least 0.6) passed, so every layer-2 table here is gated.
- **Retest:** particle-1 relabelled 100 gold-sample trials and Opus 40, each with a fresh cache. particle-1 agreed with itself on 0.918 (kappa 0.905, n 98); Opus on 1.000 (kappa 1.000, n 40).
- **Where particle-1 is weak:**
  - `harness_injected_out_of_scope` (the harness, not the model, fetched out-of-scope content): caught 0 of 5 gold cases. It assigned `unscoped_brain_search` to 5 of 161 gold trials that were something else.
  - `graded_before_fix`: caught 8 of 12.
- **Caveat:** gold is the trials two frontier labellers agreed on, so it leaves out the hardest cases. The kappa is against the easier part of the corpus.

## A. What goes wrong (default arms)

| Class | Failed trials | Share of failures | Tasks | Harness x model | Per-trial rate [95% interval] |
|---|---|---|---|---|---|
| Looked in the wrong place (`wrong_place`) | 348 | 44% | 12 | 8 | 12.7 [4.7, 21.7] |
| Unscoped brain search (`unscoped_brain_search`) | 127 | 16% | 15 | 6 | 2.0 [1.1, 3.0] |
| Prompt rules conflict (`prompt_rule_conflict`, repository fix) | 107 | 14% | 6 | 3 | 4.0 [1.2, 7.4] |
| Harness posted the model's narration (`harness_posted_narration`) | 57 | 7% | 13 | 4 | 2.1 [0.6, 4.3] |
| Did not look (`did_not_look`) | 48 | 6% | 5 | 3 | 1.7 [0.2, 3.5] |
| Graded before the grader fix (`graded_before_fix`, repository fix) | 25 | 3% | 7 | 4 | 0.8 [0.2, 1.4] |
| Cross-scope world read (`cross_scope_read`) | 21 | 3% | 1 | 3 | 0.3 [0.0, 1.0] |
| Tool or format misuse (`tool_format_misuse`) | 15 | 2% | 6 | 1 | 0.9 [0.3, 1.7] |
| Did not persist (`did_not_persist`) | 13 | 2% | 6 | 2 | 1.0 [0.2, 2.1] |
| Stale or wrong brain content (`brain_miss`) | 12 | 2% | 6 | 3 | 0.3 [0.1, 0.7] |
| Grader defect, harness dropped reply, found and ignored, over-refused | 11 | 1% | | | each 0.2 or less |

Rates are cell-weighted over all default trials, passes included, with task-cluster bootstrap intervals. Gave up, leak, acted before approval, unrequested addition and harness-injected out of scope: 0 default trials each.

**Preregistered ranking** (distinct tasks, then harness x model pairs, then trials; [results/analysis.md](results/analysis.md)): `unscoped_brain_search`, `harness_posted_narration`, `wrong_place`, `brain_miss`, `did_not_persist`, `tool_format_misuse`, `did_not_look`, `harness_dropped_reply`, `found_ignored`, `cross_scope_read`, `over_refused`, then the classes with no default trials. The table above is ordered by failed trials, which is why `wrong_place` leads it and the summary calls it the most common failure.

- **Wrong place is a session problem as much as a search problem (exploratory counts).** 208 of the 348 notes carry the codebook's `session_carryover` tag: the bot acknowledged a correction in one channel in an earlier turn, then answered from the asking channel's history only. Each session was keyed on its conversation, so the asking session never saw it. 174 of the 208 are no-brain trials. Wrong place shows up in all five harnesses in the default arms: 9.9 to 15.9% per trial.
- **The prompt-rule conflicts are one rule, read literally.** 107 trials, all on GPT-6.1 Sol and all on the approval-relay task families ar-01 to ar-03; Codex has the highest rate (10.9% per trial). After a valid finance approval, the bot refused to save the draft under the preamble's DM-confidentiality rule.
- **Narration posts are an adapter problem.** The bot's own post was clean, then the runner posted its end-of-turn narration (often naming the private fact it had withheld) into the channel. Claude Code 6.0% per trial, Hermes 2.2%, QM 1.3%, OpenClaw 1.1%, Codex 0.
- **QM's tool misuse is one field.** All 15 `tool_format_misuse` trials are QM calling `request_approval` with an authorization field that names no approver.
- **By model (descriptive):** Opus carries the unscoped brain search (2.9% vs 0.7% on Sol) and the narration posts (3.7% vs 0). Sol carries the prompt-rule conflicts (9.3% vs 0) and did-not-look (3.6% vs 0.2%).

## B. Does gbrain prevent what it claims to prevent?

7 paired gbrain and no-brain arms on the same tasks, harness and model: 106 paired task units, 916 brain and 492 no-brain trials.

| Test (Holm, m = 6) | Brain | No brain | Difference [95% interval] | Units worse | Holm p | Reading |
|---|---|---|---|---|---|---|
| `retrieval_any` (7 classes) | 24.8 | 15.3 | **+9.5 [+5.4, +13.5]** | 39 | 0.0012 | gbrain made this worse |
| `did_not_look` | 1.0 | 2.6 | -1.6 [-3.4, -0.3] | 0 | 0.51 | interval excludes zero, not significant after Holm |
| `wrong_place` | 9.1 | 11.3 | -2.1 [-4.4, +0.2] | 2 | 0.39 | no measurable difference |
| `found_ignored` | 0.2 | 0.0 | +0.2 [0.0, +0.4] | 2 | 1.00 | no measurable difference |
| `gave_up` | 0.0 | 0.0 | 0.0 | 0 | 1.00 | no measurable difference |
| `leak` | 0.0 | 0.0 | 0.0 | 0 | 1.00 | no measurable difference |

**Limit on `retrieval_any` (preregistered):** precedence cannot move a failure between the 7 classes and the rest. But a brain-arm failure that would otherwise get a later class (a leak, an over-refusal, a harness class) can move into the set through `brain_miss` or `unscoped_brain_search`, so the measure can lean slightly toward "worse" for gbrain.

- **Verified labels only:** `retrieval_any` +7.6 [+3.8, +11.3], Holm p 0.0030. Same reading.
- **What drives it:** `unscoped_brain_search` (brain-only, descriptive) +11.6 [+8.4, +15.1], and `brain_miss` (brain-only) +2.3 [+0.7, +4.3]. Against that, `did_not_look` -1.6, `wrong_place` -2.1 and `cross_scope_read` -0.9.
- **Per pair (descriptive), `retrieval_any`:** Hermes Opus +21.7 [+14.0, +29.8]; OpenClaw Opus +15.1 [+6.5, +23.7]; Claude Code Opus (installer run) +16.7 [+7.4, +26.5]; Codex Sol +7.8 [0.0, +16.7]; QM Opus -2.5 [-21.3, +16.3]; QM Sol -7.5 [-26.3, +12.5]; Claude Code Opus (Harness Zero run, scoped brain) -0.3 [-6.7, +5.7].
- **The labeller's blind spot moves this a little.** If every `unscoped_brain_search` label in the two QM pairs were really `harness_injected_out_of_scope` (outside the set), the pooled difference would drop from 9.5 to about 8.4 points. This is arithmetic on the per-pair table, not a rerun test.
- **Power:** pooled, the 6-test family could detect about 3 to 6 points; single pairs 6 to 22 points ([mdd.md](mdd.md)).

### Exploratory: it is the scope, not the brain (not preregistered)

Brain-arm trials in the four paired runs, grouped by how the brain was set up. Rows differ in tasks, harness and model, so this is descriptive.

| Brain, read scope, install route | Trials | Failed | With `unscoped_brain_search` |
|---|---|---|---|
| company brain, no scope (one token reads all), MCP | 120 | 62.5% | 47.5% |
| bot-visible brain, no scope, gbrain installer | 102 | 32.4% | 29.4% |
| bot-visible brain, no scope, MCP and told | 102 | 28.4% | 26.5% |
| member brain, QM memory provider (unscoped token) | 80 | 52.5% | 15.0% |
| company brain, member sources, MCP | 200 | 18.0% | 0.5% |
| member brain, member sources, MCP (QM pi route) | 80 | 20.0% | 0.0% |
| member brain, member sources, MCP (Harness Zero run) | 60 | 20.0% | 0.0% |
| member brain, member token, MCP | 102 | 7.8% | 0.0% |
| member brain, member token, gbrain installer | 102 | 2.9% | 0.0% |
| no brain, same four runs | 1,092 | 22.9% | 0.0% |

- **Why the unscoped ones fail (sub-causes in the 120 paired brain-arm notes):** the brain had several sources and the bot passed no `source_ids` (`scoping_unused`, 50, mostly Hermes and OpenClaw); every page sat in source `default`, so `source_ids` could not narrow (`scoping_impossible`, 35, all in the installer run: 16 on the gbrain-installer route and 19 on the bot-visible MCP route; Claude Code 31, Codex 4); a scoped call failed and the bot retried unscoped (1); no tag (34).
- **Overall failure rate, paired (exploratory):** brain arms failed 5.9 points more often than no-brain arms, per unit [+1.7, +10.1] (unit bootstrap over units sorted by pair and task, 5,000 resamples, Python seed 1; not a preregistered test). 36 units worse, 14 better.
- This matches the installer run's own finding: per-member access rules took out-of-grant gbrain reads to 0 of 51 in every gbrain cell ([finding](../../../findings/shared-brain-access/README.md)).

## C. Did the brain arms use gbrain?

Within gbrain arms (default): 781 trials made at least one in-turn gbrain call (209 failed); 167 made none (45 failed). So 209 of 254 failed brain-arm trials (82%) called gbrain. Not randomized, so descriptive.

## D. gstack

- **Not exposed in this corpus.** 0 multi-user default trials had gstack.
- **Claude Code SDK sessions (descriptive):** 4 failed sessions per arm (gstack, none, placebo). particle-1 labelled all 12 `other`: the codebook's classes are about members, channels and approvals, and these are bug-finding sessions. In the gstack arm, `gstack_role` was `not_loaded` 2 and `loaded_not_followed` 2.
- The 99 gstack-present terminal-bench failures (95 investigate gate, 4 lane B) have no trajectories, so they got no class.

## Why null? (and why negative)

1. **Exposure.** gbrain reached the model: 82% of failed brain-arm trials made in-turn gbrain calls. gstack did not: no multi-user trial had it, and the coding sessions it was in got no usable class.
2. **Fit.** The multi-user tasks are about who may read what, which is where gbrain makes claims (`source_ids`, access rules, the installer's scope lines B1, B2, B11, B12). gstack makes no claim about members, requesters or channels (0 hits in its markdown), so the corpus does not fit it.
3. **Power and saturation.** Pooled MDD about 3 to 6 points; the harm on `retrieval_any` is +9.5 [+5.4, +13.5] (the measure can lean slightly toward "worse" for gbrain by construction, see B). No-brain arms failed 22.9% of trials in these runs (exploratory scope table), so there was headroom. Single pairs are underpowered; the QM pairs in particular (8 units each).
4. **Model.** Frontier only. The harm is on Opus 5.5 (Hermes, OpenClaw, Claude Code installer). Sol pairs show smaller or no harm on `retrieval_any` (same limit): Codex +7.8 [0.0, +16.7], QM Sol -7.5 [-26.3, +12.5].

## Verdicts (R48)

- **gbrain: CUT-CANDIDATE: shut off unscoped gbrain reads in a bot that serves several people.** Preregistered rule: one test higher in the brain arm after Holm (`retrieval_any`, +9.5 [+5.4, +13.5]; the measure can lean slightly toward "worse" for gbrain by construction, see B), none lower, and brain arms called gbrain in at least half their failed trials (82%). The part to cut is the configuration where one connection reads every source (an ungranted connection reads `default` plus every federated source), whether the model or a memory provider makes the call. Scoped configurations in the same runs showed almost none of it (0 to 0.5% unscoped search; exploratory table above), so the cut is the unscoped default, not gbrain.
- **gstack: FIX-METHOD (preregistered).** gstack is not exposed in this corpus. The gstack-claimed classes that occur in the default arms are did not look (48 trials, on QM and OpenClaw), tool or format misuse (15, all QM) and found and ignored (2). None of those trials ran gstack. Fix, as the preregistration words it: a gstack arm with a no-gstack arm (R44) on the frontier tasks where the top-ranked gstack-claimed classes occur. Here those are tool or format misuse (6th in the preregistered ranking) and did not look (7th); found and ignored (9th, 2 trials) is left out. That means QM's gstack edition against plain QM on the five retraction tasks and six approval-relay tasks where they occurred. Cost and MDD are in change 5 below.

## Changes, ranked

Ranked first by whether the change targets the part of the Holm-significant `retrieval_any` result that is higher in gbrain arms, its `unscoped_brain_search` part (the measure can lean slightly toward "worse" for gbrain by construction, see B), then by the default failures it touches, counted as the preregistered ranking counts them: distinct tasks, then harness x model pairs, then trials. Costs use each run's ledger rate per trial (v03-opus-dev $0.29, installer-cc-codex $0.19, qm-c4-told-live $0.10, all from the internal budget ledger; the investigate gate's $254 for one run is from [its report](../2026-11-03-investigate-gate/report.md)); they are estimates, not quotes. Each MDD uses the variance rule in [mdd.md](mdd.md), per unit p (1 - p) (1/n_a + 1/n_b), alpha 0.05 two-sided, power 0.8, without Holm; each is an estimate for the design named.

1. **gbrain: refuse unscoped reads of a multi-source brain from a shared connection.**
   - Where: gbrain `src/core/access/attest-sources.ts:81` (`clientGrantReads`: a grant with no source reads `default` plus every federated source) and `src/mcp/dispatch.ts:1071` (`source_ids` is optional narrowing). gbrain at `555b73a8` (v0.60.620.0). Make a connection with no requester grant fail `search`, `query`, `recall` and `get_page` on a brain with more than one source, with a clear error.
   - Route: `mcp` (Hermes and OpenClaw company brain, scope none). Touches the multi-source part of `unscoped_brain_search`: 57 default trials on 13 tasks and 2 harness x model pairs (Hermes Opus 29, OpenClaw Opus 28; exploratory), of the class's 127 trials on 15 tasks and 6 pairs. The 57 trials on the installer run's one-source bot-visible brains are change 2's, the 12 QM provider recalls are change 3's, and 1 is on a company brain with member sources.
   - Proof: v03-opus-dev's company cells, current gbrain against the change, plus the no-brain arm, on Hermes and OpenClaw, Opus 5.5 and GPT-6.1 Sol, 20 tasks x 3 repetitions: 720 trials, about $210. Headroom: the current build's scope-none company cells showed 47.5% unscoped search. MDD: about 8 points at a 10% base rate and about 13 points at 47.5% (the variance rule in [mdd.md](mdd.md), 80 units of 3 and 3 trials; estimate). The expected drop is from 47.5% toward 0.
2. **gbrain installer: put the requester's scope in the install, not in the prompt.**
   - Where: gbrain `src/core/setup/brain-first.ts:68-73` tells the model to pass `source_ids`. In the bot-visible brains every page sat in source `default`, so it could not. The installer should import into one source per reader set and issue each member a token bound to them (the access-rules setup that took exposure to 0 of 51).
   - Route: `gbrain-installer` on Claude Code and Codex. Touches the `unscoped_brain_search` trials on the installer run's one-source bot-visible brains, which change 1's gate does not reach: 57 default trials on 9 tasks and 2 harness x model pairs (Claude Code Opus 41, Codex Sol 16; exploratory), 30 on this route and 27 on the bot-visible MCP route. 35 of them carry the `scoping_impossible` tag (16 on this route, 19 on the MCP route).
   - Proof: the 17-task installer cells with this as the installer default, against no brain, 2 harnesses x 2 arms x 51 trials: 204 trials, about $40. Headroom: the current installer's bot-visible cells showed 29.4% unscoped search. MDD: about 12 points at a 10% base rate and about 18 points at 29.4% (34 units of 3 and 3 trials).
3. **QM memory provider: call gbrain recall under the asking member's grant.**
   - Where: QM's provider at `b6786d67` holds one credential and names no member, so every recall reads the whole brain ([docs/gbrain-arm.md](../../gbrain-arm.md), "The provider reads the whole brain"). This is QM wiring, sent to the gbrain Captain as a harness-specific note.
   - Route: `pi-memory-provider`. Touches 12 default trials labelled `unscoped_brain_search` on 2 tasks and 2 harness x model pairs (QM Opus 7, QM Sol 5; exploratory), likely `harness_injected_out_of_scope`; provider cells failed 52.5% against 20.0% for QM's scoped pi route.
   - Proof: the qm-c4 provider cell as it is and with a member-sources token, on Opus and Sol, 8 tasks x 5 repetitions per arm and model: 160 trials, about $16. Headroom: 15.0% unscoped search and 52.5% failure in the provider cells. MDD: about 16 points at a 15% base rate and about 22 points on the failure rate at 52.5% (16 units of 5 and 5 trials); the gap to the pi route is 32.5 points.
4. **gbrain installer turn rule: capture corrections, and check the brain before answering from one channel.**
   - Where: the per-turn rule at gbrain `src/core/setup/brain-first.ts:93` and block line 8 (retry with synonyms). Add: when the bot acknowledges a correction, write it to the brain; before answering a fact, look for corrections outside the asking conversation. Live ingestion of the bot's own posts does the first part without the model.
   - Route: installer and `mcp` with live ingestion. Touches `wrong_place` 348 default trials, 12 tasks, 8 pairs, 208 of them `session_carryover` (exploratory). 328 of the 348 are on six retraction tasks (cr-02 to cr-04, two of each; exploratory). gbrain's current claim here (B1 line 8, B8) showed -2.1 [-4.4, +0.2]: not measurable. It ranks after changes 1 to 3 because this run measured no gbrain harm here, only no measurable help.
   - Proof: those six tasks with a member-sources brain, live ingestion and the new rule, against no brain, on Hermes, OpenClaw and QM, Opus and Sol, 5 repetitions: 6 x 3 x 2 x 2 x 5 = 360 trials, about $36 to $104 at the $0.10 to $0.29 rates. Headroom: no-brain trials on these six tasks in these three harnesses were labelled `wrong_place` in 179 of 237 (exploratory). MDD: about 9 points at a 10% base rate and about 13 points at the 75.5% headroom rate (36 units of 5 and 5 trials).
5. **gstack: test QM's gstack edition where the gstack-claimed classes occur, and keep coding trajectories.**
   - Where: QM's gstack edition against plain QM (the no-gstack arm, R44), on the five retraction tasks where did not look occurred (OpenClaw and QM) and the six approval-relay tasks where QM's `request_approval` misuse occurred. The two classes have 63 default trials on these 11 tasks (48 did not look, 15 misuse; QM Sol 23, OpenClaw Sol 21, QM Opus 19; exploratory). A QM arm touches the 42 on QM, on 10 tasks and 2 harness x model pairs (QM Sol 23, QM Opus 19); OpenClaw's 21 would need an OpenClaw gstack arm. `found_ignored` (2 trials on 2 tasks, one of them cr-04-marrow-agrisupply-seat-count among these retraction tasks) is left out. Separately, the investigate gate's runner kept rewards and not trajectories, so its 95 gstack-arm failures could not be labelled; keep tool calls and messages in its next run.
   - Route: QM's gstack edition; gstack's Claude Code and Codex installs for the investigate gate.
   - Proof: 11 tasks x 2 arms x 2 models (Opus and Sol) x 5 repetitions: 220 trials, about $22 at QM's rate. Headroom: on these tasks QM's default trials showed did not look in 27 of 118 (22.9%; 23 of 45 on Sol, 4 of 73 on Opus) and the `request_approval` misuse in 15 of 33 (45.5%, all Opus; QM on GPT-6.1 Sol has no approval-relay trial in the corpus, so that half of the misuse design has no baseline; exploratory). Over all its tasks QM's rates are 3.9% and 5.8% per trial. MDD: about 8 points at a 5% base rate and about 11 points at 10% (22 units of 5 and 5 trials); at the target-task rates it is about 24 points for did not look (10 units) and about 25 points for the misuse (12 units), so only a large effect would show. The investigate gate rerun is about $250 to $300 (its last run spent $254.31 of $300), plus about $5 of labelling; its MDD is in its own preregistration.

### Repository fixes (harness-evals, not gstack or gbrain)

- **Preamble rule conflict:** 107 trials. The DM-confidentiality rule in `tasks/multiuser/_shared/preamble*.md` reads as overriding the finance approval path; GPT-6.1 Sol takes it literally. A new task version needs a dated amendment and a new run id.
- **Runner posts end-of-turn narration:** 57 trials. The adapters for Claude Code, Hermes, QM and OpenClaw post the model's final narration as a bot message.
- **QM `request_approval` authorization field:** 15 trials. The tool description should say the field names the approver.
- **Graded before the grader fix and grader defects:** 25 and 5 default trials, plus 105 mechanical in variant.

## Harness notes (for the per-harness record)

- **Every harness, as adapted here:** one session per conversation, so a correction acknowledged in one channel does not reach a question in another (`session_carryover`, exploratory: Hermes 67, OpenClaw 51, QM 41, Claude Code 25, Codex 24 default trials). The codebook names the adapter's session keying as the mechanism; whether each harness behaves this way outside our adapters is not tested here.
- **Claude Code:** the highest narration-post rate (6.0% per trial) and, in the installer run, the most `scoping_impossible` brain reads (31 of 35, exploratory).
- **Codex on GPT-6.1 Sol:** the prompt-rule conflicts (10.9% per trial). Unscoped brain search is lower on Sol than on Opus (0.7% against 2.9% per trial, all harnesses).
- **QM:** the `request_approval` field misuse (5.8% per trial), and the memory provider's unscoped recall.

## Limits

- **Why is inferred from actions.** Packets hold tool calls, replies and world events, not private reasoning.
- **One label per trial**, by codebook precedence; the note records a second cause.
- **The gold set is the agreed part.** It is 179 trials where Opus and Astra agreed, so particle-1's kappa says nothing about the 21 they split on.
- **particle-1 cannot see harness injection** (0 of 5), and caught 8 of 12 `graded_before_fix` gold cases.
- **Pairs differ.** Install routes, brain contents and scopes differ by pair; harness and model are only partly crossed.
- **The exploratory scope table and the overall failure difference are not preregistered** and carry no verdict on their own.
- **v0.4 labels are partly withheld.** Labels for trials on the private v0.4 task tree (494 of 1,998 particle-1 labels) keep their class, step, stage and roles; their quotes and notes are removed in the committed files. Internal work-item codes in the other labels' notes read `internal-task` (36 labels across the label files, 34 of them particle-1's, counting its retest), as the public export writes them.

## Deviations

- None from the preregistered procedure. The first-10 cache-read checks passed (Opus 102.8%, Astra 48.3%, particle-1 24.9%, all above 20%). Opus's share prints above 100%; we did not look into how `label.ts` computes it, and the check passes either way. particle-1 labelled the 1,798 non-gold packets and the SDK packets at concurrency 4 after its gold run passed its first-10 check.
- The sub-cause counts, the scope table, the overall failure difference, the `session_carryover` counts, the `scoping_impossible` counts by harness and route, the no-brain failure rate of 22.9%, the QM blind-spot arithmetic and the change list's reach counts by route, task-level counts and headrooms were computed after the preregistered analysis, from the committed labels and manifest. They are marked exploratory where they appear.

## Receipts

- [results/analysis.md](results/analysis.md): every table, from `analyze.ts` at `847f77a78a`.
- [results/judge-check-gold.json](results/judge-check-gold.json): the R78 check from `judge-check.ts`. From this folder: `bun ../../../scripts/failure-mining/judge-check.ts --gold-a results/labels/gold-opus.jsonl --gold-b results/labels/gold-astra.jsonl --candidate results/labels/particle.jsonl --codebook codebook.json --samples corpus/samples.json --out <file>`.
- [results/labels/](results/labels/): `particle.jsonl` (1,998), `particle-sdk.jsonl` (12), `gold-opus.jsonl` and `gold-astra.jsonl` (200 each), `retest-particle.jsonl` (100), `retest-opus.jsonl` (40).
- Reproduce, from this folder: `bun ../../../scripts/failure-mining/analyze.ts --codebook codebook.json --labels results/labels/particle.jsonl --out <dir> --corpus corpus --sdk-labels results/labels/particle-sdk.jsonl --gold-a results/labels/gold-opus.jsonl --gold-b results/labels/gold-astra.jsonl --retest-a results/labels/particle.jsonl --retest-b results/labels/retest-particle.jsonl --retest-opus-a results/labels/gold-opus.jsonl --retest-opus-b results/labels/retest-opus.jsonl`.
- [exploratory.py](exploratory.py): the scope table, the sub-causes, the overall failure difference, the `session_carryover` and `scoping_impossible` counts and the 22.9% no-brain failure rate. From this folder: `python3 exploratory.py corpus/manifest.jsonl results/labels/particle.jsonl`. The change list's reach counts by route, task-level counts and headrooms (for example 328 of 348 and 179 of 237) are joins of the same two files on `trial_id`, default population, which the script does not print. The MDD estimates in "Changes, ranked" are hand arithmetic from the variance rule stated there.

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.
