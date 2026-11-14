# Does a skill resolver help agents open the right skill? (skill-resolver-2026-11): report

- **We learned that a short "skills that may help" block, added to each turn by gbrain's skill resolver, makes agents open a fitting skill more often. You should turn it on when an agent has hundreds of skills installed.** Pooled over 8 harness and model setups, the agent opened an acceptable skill on 51.5% of requests with the resolver and 39.0% without it: **+12.5 points [+9.8, +15.3], 1,639 paired requests**. Four of the five harnesses each gained +12 to +23 points. OpenClaw's number is an undercount from a counting bug, so it can't be read as a gain or a loss. On one user's real messages (set R, OpenClaw on Opus only), the resolver showed **no measurable gain on the preregistered set, +1.9 [-4.7, +8.5]**, and +11.8 [+6.9, +16.7] over every skill-needing row.
- **We learned that the resolver never stays quiet, and that on Codex it sometimes leads the agent to the wrong skill. You should not ship it as is: gbrain needs a way to suggest nothing.** On requests that need no skill at all it still showed a block **every time: 483 of 483, 100.0% [99.2%, 100.0%]**, against a preregistered bar of at most 25%. On Codex, **10.7% [7.4%, 14.9%]** of turns with a block (31 of 289) led to a read of a suggested skill that wasn't acceptable, over the 10% bar. Set R misses both bars too: a block on 26 of 26 no-skill requests, and 10.0% off-target reads.
- **We learned that more skill opens turn into only a small gain in finished tasks, and that listing skill names alone doesn't help. You should expect a few points of task success, not a jump, and you should not replace the resolver with a names-only list.** On 48 graded tasks, success went from 8.9% to 13.8%, **+4.9 points [+1.6, +8.9] on 384 pairs**. A names-only skill list scored below each harness's own listing in all 4 setups where we can count it.

**The lesson this run is after:** if you give an agent hundreds of skills, should you add a per-turn skill resolver, or is your harness's own skill listing (or a plain names-only list) enough?

**Answer: the resolver helps agents find skills (preregistered claim met), but it suggests skills even when none is needed, and the task gain is small.**

**How to read the numbers.** A "95% range" (in brackets) means the true value is very likely inside it. When a range for a difference includes zero, the run did not show a difference. "Paired" means the same request ran with and without the resolver, and we compare the two. A "setup" (also called a cell) is one harness on one model. All numbers on this page come from public, synthetic requests (set P) and public graded tasks (set T). One user's real messages (set R) are reported separately and only as a description, in the [set R section](#set-r-one-users-real-messages).

- **Opened an acceptable skill ("Got the skill"), pooled, resolver on minus native:** +12.5 points [+9.8, +15.3], 1,639 pairs, 105 pairs worse with the resolver, 310 better. Smallest difference the run could reliably detect: 4.0 points. ([analysis-7-counted-in](results/analysis-7-counted-in/analysis.md))
- **The same, as the preregistered command ran it (7 trials left out, see Deviations):** +12.5 [+9.8, +15.3], 1,637 pairs. ([analysis](results/analysis/analysis.md))
- **Held-out half of the requests only:** +10.5 [+6.6, +14.4], 808 pairs. The point estimate clears +10, but the low end of the range doesn't.
- **Per harness:** Hermes +23.0 [+18.7, +27.6], Codex +20.2 [+13.5, +27.1], Claude Code +15.3 [+10.3, +20.5], QM +12.2 [+8.0, +16.5]. OpenClaw -12.5 [-18.9, -6.2] is an **undercount that can't be read as a loss** (What didn't work, item 1).
- **Without any OpenClaw trial:** +17.7 [+14.7, +20.7], 1,359 pairs.
- **Graded tasks (set T), success, resolver on minus native:** +4.9 [+1.6, +8.9], 384 pairs on 48 tasks. **No skill catalog at all, minus native:** -8.1 [-13.3, -3.9].
- **False suggestions:** (a) fails, 100.0% [99.2%, 100.0%] (483/483) against a 25% bar. (b) passes pooled at 4.3% [3.5%, 5.2%] (99/2,315) but fails on Codex at 10.7% [7.4%, 14.9%] (31/289), against a 10% bar.
- **Calls (preregistered):** primary claim (at least +10 points and significant, cross-family labels, judge check passed) **met**. Per harness: every row Holm-significant (Holm over 5 harnesses), with OpenClaw's sign not readable. Resolver against names-only: "could not tell apart" under the preregistered equivalence test, though 3 of 4 ranges sit wholly above +10 points (What didn't work, item 5). Set T success: "equivalent within 10 points" at p 0.007, and the run can't certify the 2-point margin gbrain's owners asked for. Set R (descriptive, never gates): no measurable difference on its primary set, +1.9 [-4.7, +8.5]; +11.8 [+6.9, +16.7] on every skill-needing row.
- **Verdicts:** resolver push block **KEEP** on Claude Code, Codex, Hermes and QM. Resolver's no-skill behaviour **FIX-METHOD**: gbrain adds a way to return an empty block. OpenClaw measurement **FIX-METHOD**: fix `got-skill.ts` and recount. QM pull tool **CUT-CANDIDATE**. Names-only listing as a resolver substitute **CUT-CANDIDATE**. Budget pacing **FIX-METHOD** for the eval: untested here. Set R changes none of these: it is OpenClaw only, where the measurement stays FIX-METHOD, and its no-skill and off-target misses back the no-skill FIX-METHOD. Details under [Why null?](#why-null).
- **Caveats:** set P requests are synthetic, written from skill bodies, which may favour rankers that read bodies. OpenClaw's Got the skill numbers are undercounts. Phase B sessions stop at 6 model requests, so budget pacing never ran. Set T has one try per task and low success in every arm. The judge check comes from the uncounted pilot's 110 gold pairs. Set R is one user, OpenClaw on Opus only, and its rates are lower bounds from the same undercount.
- **Status:** results PR #449, whose pre-merge review includes a cross-family claim check of these numbers (record on the PR), grader audit not applicable (this run folder is dated 2026-11-08, before the 2026-11-12 gate in [grader-audit.md](../../grader-audit.md), and Phase B trials keep no event log). Words: [glossary](../../glossary.md).

## What ran

- **Five harnesses, two frontier models, 8 setups:** OpenClaw 2026.10.6, Hermes v2026.9.24 and QM main@90e4ced7 on both Claude Opus 5.5 and GPT-6.1 Sol; Claude Code 2.1.312 on Opus 5.5 only; Codex 0.165.0 on GPT-6.1 Sol only.
- **The catalog:** 351 public skills installed in every arm except no-catalog (catalog hash `b6d67f1f...`). The resolver is gbrain v0.60.633.0's `gbrain skills resolve`. It ranks the catalog against each turn and pushes up to 5 skill names (a "block") into the agent's context, within a 2,000-token session budget.
- **Arms (what changes between runs of the same request):**
  - **native:** the harness's own skill loading. The resolver runs in "shadow" mode and only logs what it would have shown.
  - **resolver-on:** the resolver's block is pushed into each turn. On QM this is an emulated push.
  - **names-only:** a plain list of skill names, with the harness's listing limits raised.
  - **QM pull:** a tool QM's model can call to ask the resolver.
  - **no-catalog (set T only):** no skills installed. This is also the clean arm with no gstack.
- **Set P (Phase B):** 289 labelled synthetic requests (228 or 229 skill-needing per setup before the reachability cut, 60 or 61 needing no skill), one trial per request per arm, each stopped at 6 model requests. 6,936 trials. Acceptable skills come from judges that never saw what an agent read. Each Claude setup is scored with GPT-6 Astra's labels and each GPT setup with Opus 5.5's labels (cross-family). Files: [results/sets/](results/sets/).
- **Set T (task phase):** 48 graded tasks under [tasks/skill-resolver/T/](../../../tasks/skill-resolver/T/README.md), one try each, native, resolver-on and no-catalog in all 8 setups. 1,152 trials. Success and "Used it" are declarative file checks, not a judge.
- **In all:** 8,088 trials in 48 cells on 25 Ubicloud shards (one VM per shard), every one at commit `a0431909`, the merge commit of the 2026-11-12 amendment. Trial records: [results/merged/trials.jsonl](results/merged/trials.jsonl).

## What works

### The resolver makes agents open a fitting skill more often

| Analysis | Pairs | Worse with resolver | Native | Resolver-on | Difference (points) | 95% range | McNemar p | File |
|---|---|---|---|---|---|---|---|---|
| **Pooled, set P, 7 counted in (headline)** | 1,639 | 105 | 39.0% | 51.5% | **+12.5** | [+9.8, +15.3] | 1.4e-24 | [analysis-7-counted-in](results/analysis-7-counted-in/analysis.md) |
| Pooled, set P, 7 left out (preregistered command as run) | 1,637 | 105 | 38.9% | 51.4% | +12.5 | [+9.8, +15.3] | 1.4e-24 | [analysis](results/analysis/analysis.md) |
| Held-out half only, 7 counted in | 808 | 52 | 40.0% | 50.5% | +10.5 | [+6.6, +14.4] | 5.1e-10 | [analysis-7-counted-in](results/analysis-7-counted-in/analysis.md) |
| Held-out half only, 7 left out | 807 | 52 | 39.9% | 50.4% | +10.5 | [+6.6, +14.4] | 5.1e-10 | [analysis](results/analysis/analysis.md) |
| Opus-plus-Sol panel labels instead of cross-family, 7 counted in | 1,630 | 104 | 39.3% | 52.0% | +12.7 | [+9.9, +15.5] | 4.7e-25 | [analysis-7-counted-in](results/analysis-7-counted-in/analysis.md) |
| Without any OpenClaw Phase B trial, 7 counted in | 1,359 | 29 | 39.0% | 56.7% | +17.7 | [+14.7, +20.7] | 6.9e-50 | [sensitivity-without-openclaw-phase-b-7-counted-in](results/sensitivity-without-openclaw-phase-b-7-counted-in/analysis.md) |
| Without any OpenClaw Phase B trial, 7 left out | 1,357 | 29 | 38.9% | 56.6% | +17.7 | [+14.8, +20.7] | 6.9e-50 | [sensitivity-without-openclaw-phase-b](results/sensitivity-without-openclaw-phase-b/analysis.md) |

- The pooled rows cluster pairs by request: 222 clusters, with identical request texts sharing one cluster. The clustered sign-flip p is below 0.001 in every row, the smallest value 10,000 draws can show.
- **The preregistered bar is met:** at least +10 points, significant on both tests, every primary trial scored with the other family's labels, and the judge check passed.
- **The held-out half is weaker.** It clears +10 on its point estimate, but its range reaches down to +6.6, so on its own it doesn't clear the bar. It is a preregistered sensitivity line, not a second test.
- **Smallest difference the pooled test could reliably detect** (80% power): 4.0 points. Held-out half: 5.6 points.

**The label check (judge check).** Before any judged number counts, each label source was scored against 110 "gold" (request, skill) pairs that GPT-6 Astra and Opus 5.5 graded the same way, 51 bad and 59 good ([judge-check.json](results/judge-check/judge-check.json), from the uncounted pilot):

- **GPT-6 Astra (scores the Claude setups):** kappa 0.743, catches 82.4% of bad outputs (42 of 51), fails 8.5% of good ones (5 of 59). The analysis files print the catch rate as 82.3%, because they round the stored value 0.8235 again.
- **Opus 5.5 (scores the GPT setups):** kappa 0.784, catches 100.0% of bad outputs (51 of 51), fails 20.3% of good ones (12 of 59). Opus fails one good output in five, which lowers both arms' scores in the GPT setups.
- Both clear the 0.6 kappa bar. The graders are the same two models as two of the label sources, with a different prompt.

### Per harness and per setup

Pooled over each harness's models. Holm-corrected over the 5 harnesses on the sign-flip p, every row below 0.001 ([analysis-7-counted-in](results/analysis-7-counted-in/analysis.md)).

| Harness | Pairs | Worse with resolver | Native | Resolver-on | Difference (points) | 95% range | Smallest detectable |
|---|---|---|---|---|---|---|---|
| Hermes | 452 | 3 | 28.3% | 51.3% | +23.0 | [+18.7, +27.6] | 6.4 |
| Codex | 228 | 7 | 61.0% | 81.1% | +20.2 | [+13.5, +27.1] | 9.7 |
| Claude Code | 229 | 3 | 38.9% | 54.1% | +15.3 | [+10.3, +20.5] | 7.3 |
| QM | 450 | 16 | 38.7% | 50.9% | +12.2 | [+8.0, +16.5] | 6.1 |
| OpenClaw (**undercount, can't be read as a loss**) | 280 | 76 | 38.9% | 26.4% | -12.5 | [-18.9, -6.2] | 9.1 |

Got the skill per setup, rate [95% range] (opened / requests in the denominator). Descriptive, not tested.

| Setup | Native | Resolver-on | Names-only | QM pull |
|---|---|---|---|---|
| Claude Code, Opus | 38.9% [32.5, 45.5] (89/229) | 54.1% [47.5, 60.7] (124/229) | 32.3% [26.3, 38.8] (74/229) | |
| Codex, Sol | 61.0% [54.3, 67.3] (139/228) | 81.1% [75.4, 86.0] (185/228) | 56.6% [49.9, 63.1] (129/228) | |
| Hermes, Opus | 19.8% [14.8, 25.6] (45/227) | 43.6% [37.1, 50.3] (99/227) | 14.1% [9.8, 19.3] (32/227) | |
| Hermes, Sol | 36.9% [30.6, 43.6] (83/225) | 59.1% [52.4, 65.6] (133/225) | 28.9% [23.1, 35.3] (65/225) | |
| OpenClaw, Opus (undercount) | 34.0% [26.4, 42.3] (50/147) | 49.0% [40.7, 57.3] (72/147) | 31.8% [25.8, 38.4] (71/223) | |
| OpenClaw, Sol (undercount) | 44.4% [35.8, 53.2] (59/133) | 1.5% [0.2, 5.3] (2/133) | 48.6% [41.8, 55.5] (106/218) | |
| QM, Opus | 12.8% [8.8, 17.9] (29/226) | 22.6% [17.3, 28.6] (51/226) | | 11.9% [8.0, 16.9] (27/226) |
| QM, Sol | 64.7% [58.1, 71.0] (145/224) | 79.5% [73.6, 84.6] (178/224) | | 69.2% [62.7, 75.2] (155/224) |

- **The denominator** is skill-needing requests with at least one acceptable skill the harness actually loaded ([reachable.json](reachable.json)). OpenClaw loads only part of the catalog, so for 82 (Opus) and 95 (Sol) of 289 requests it has no acceptable skill at all. Its setups score on 147 and 133 requests. That cut is a cost of OpenClaw's own loading: the resolver can't suggest a skill OpenClaw never loaded.

### The resolver helps even when the request shares no words with the skill

**Exploratory, not preregistered.** The preregistered command leaves the "set P by overlap bin" table empty, because it doesn't pass the request file. We ran it once with `--requests` added ([exploratory-setp-overlap-bins](results/exploratory-setp-overlap-bins/analysis.md); 7 trials left out, and its primary rows match [analysis](results/analysis/analysis.md) exactly). Resolver-on minus native, by word overlap between the request and the target skill's name and description:

- **none:** +8.3 [+4.4, +12.0], 541 pairs
- **low:** +13.1 [+8.7, +17.5], 726 pairs
- **mid:** +18.4 [+11.5, +25.4], 337 pairs
- **high:** +9.1 [+0.0, +22.6], 33 pairs, no measurable difference

### Skills matter for finished tasks, and the resolver adds a little

Set T: 48 tasks, 384 pairs, 48 task clusters ([analysis-7-counted-in](results/analysis-7-counted-in/analysis.md); the set T rows are the same in [analysis](results/analysis/analysis.md)).

| Comparison | Native | Other arm | Difference (points) | 95% range | Worse in other arm | Sign-flip p | McNemar p | Smallest detectable |
|---|---|---|---|---|---|---|---|---|
| Success, resolver-on minus native | 8.9% | 13.8% | +4.9 | [+1.6, +8.9] | 8 | 0.013 | 0.002 | 5.2 |
| Success, no-catalog minus native | 8.9% | 0.8% | -8.1 | [-13.3, -3.9] | 32 | <0.001 | <0.001 | 6.7 |
| Used it, resolver-on minus native | 9.1% | 13.8% | +4.7 | [+1.3, +8.3] | 8 | 0.014 | 0.003 | 5.0 |
| Used it, no-catalog minus native | 9.1% | 0.8% | -8.3 | [-13.5, -4.2] | 33 | <0.001 | <0.001 | 6.7 |

- **Taking the catalog away costs more than the resolver adds.** So the skills themselves matter more than how they're surfaced.
- **Success per setup, out of 48** (native / resolver-on / no-catalog): Claude Code Opus 8 / 9 / 0, Codex Sol 6 / 10 / 1, Hermes Opus 2 / 6 / 1, Hermes Sol 4 / 4 / 0, OpenClaw Opus 3 / 7 / 0, OpenClaw Sol 4 / 7 / 0, QM Opus 1 / 3 / 0, QM Sol 6 / 7 / 1. Rates with ranges are in the analysis file under "Task phase".
- **Success is low in every arm.** The best setup, Codex Sol with the resolver, finishes 20.8% [10.5%, 35.0%] (10/48).
- **Where the task gain comes from:** low overlap between task and skill words, +9.4 [+3.1, +16.9] on 160 pairs; tasks flagged before the run as guessable without the skill, +18.8 [+4.2, +35.4] on 48 pairs. No measurable gain with no overlap (+3.8 [-1.9, +11.5], 104 pairs) or mid overlap (+0.0 [-2.7, +2.7], 112 pairs). High overlap has 8 pairs and no range.
- **The guessable-task check:** the no-catalog arm passed 1 of 48 guessable-task trials, 2.1% [0.1%, 11.1%], so those tasks were not passable without skills.
- **Held to 42 tasks** (dropping the 6 tasks that ran on a second VM, Deviation 11): success +5.0 [+1.6, +9.0] on 378 pairs, Used it +4.8 [+1.3, +8.5], TOST p 0.009 ([sensitivity-sett-42-tasks](results/sensitivity-sett-42-tasks/analysis.md)). That is within 0.2 points of the 48-task numbers. All 18 rerun trials completed, and all 18 failed Success.

### What the resolver costs in context

- **Tokens added at turn 1** (median, with the maximum): Claude Code 213 (267), Hermes 214 (268), QM 216 (270), OpenClaw 277 (328), Codex 294 (345). No session hit the 2,000-token budget ([analysis-7-counted-in](results/analysis-7-counted-in/analysis.md), "Context footprint").

## What didn't work

1. **OpenClaw's Got the skill numbers are undercounts, so its -12.5 can't be read as a loss for the resolver.**
   - OpenClaw often opens a skill with `tool_call {"id": "skills_read", "args": {"name": ...}}`. `scripts/skill-resolver/got-skill.ts` (line 127 at `a0431909`) unwraps a deferred call only when it carries `name` or `tool`, so these opens are never counted.
   - In set T, where full traces survive, OpenClaw Sol with the resolver opened skills this way in 34 of 48 trials, and got-skill counted none of those trials' opens. OpenClaw Sol native: 8 of 48. OpenClaw Opus with the resolver: 2. In both, got-skill missed an open, and in one of them it counted no open at all ([openclaw-tool-call-opens.json](results/checks/openclaw-tool-call-opens.json)).
   - Phase B traces were scrubbed by design, so the Phase B OpenClaw setups can't be recounted. Their got-skill files fit the miss: OpenClaw Sol with the resolver counts a catalog open in 31 of 289 trials, against 85 of 289 for native (`got-skill.json` under [results/merged/trials/](results/merged/trials/)).
   - **The 1.5% (2/133) for OpenClaw Sol with the resolver is a measurement failure, not a finding about OpenClaw.** The OpenClaw names-only row inherits the same miss. Set T Success and Used it don't use got-skill, so they're unaffected.
2. **False suggestion (a) fails by a wide margin.** On no-skill requests the resolver showed a block 100.0% [99.2%, 100.0%] of the time (483/483), against a bar of at most 25%. The native arms' shadow log did the same (483/483). It was 100% on every harness: OpenClaw 121/121, Hermes 121/121, QM 120/120, Codex 61/61, Claude Code 60/60. The pinned release has no no-skill gate, so the preregistration expected this, and it is reported as measured.
3. **False suggestion (b) passes pooled but fails on Codex.** Reads of a suggested skill outside the acceptable set, per turn with a block, against a 10% bar:
   - Pooled: 4.3% [3.5%, 5.2%] (99/2,315) with the resolver on, and 2.6% [2.0%, 3.3%] (59/2,308) for the shadow log.
   - **Codex: 10.7% [7.4%, 14.9%] (31/289), over the bar**, against 6.2% [3.7%, 9.7%] (18/289) for its shadow.
   - The others, resolver on: QM (push and pull together) 6.5% [4.7%, 8.9%] (38/581), Hermes 2.9% [1.7%, 4.7%] (17/578), OpenClaw 1.7% [0.8%, 3.2%] (10/578), Claude Code 1.0% [0.2%, 3.0%] (3/289). OpenClaw's rate carries the same undercount as item 1.
4. **The budget pacing was never tested.** Every no-skill request fell in the `under_half` budget phase, because the 6-request cap ended each Phase B session before pacing could start. The footprint at turns 10 and 50 isn't measured by these trials for the same reason. The preregistration also planned one paid 50-turn Opus session per harness, and this run's receipts hold no record of those sessions, so that measurement is missing too.
5. **The names-only rows say "could not tell apart", but the ranges show a difference.** The preregistered test is an equivalence test (TOST) within 10 points, and it reports "could not tell apart" whenever it can't show equivalence. Every row has TOST p of 0.935 or more. Read the ranges instead: resolver-on minus names-only is Claude Code +21.8 [+16.6, +27.5] (229 pairs), Codex +24.6 [+17.6, +31.6] (228), Hermes +29.9 [+24.6, +35.3] (452). All three sit wholly above +10. OpenClaw's -15.4 [-22.5, -8.3] (280) carries the undercount.
6. **Names-only scores below native in all 4 setups we can count** (Claude Code, Codex, Hermes Opus, Hermes Sol). Raising the harness's listing limits and showing only names lost skill opens.
7. **The set T success test can't certify the 2-point margin gbrain's owners asked for.** At the preregistered 10-point margin the TOST gives p 0.007, "equivalent within the margin", while the difference itself is +4.9 [+1.6, +8.9]. A 2-point margin needs about 7,000 pairs, and we have 384.
8. **QM's pull tool barely got used.** Only 6 of 578 pull trials left a call record (the resolver status log under [results/merged/trials/](results/merged/trials/), `pb-qm-*-qm-pull`). Pull scores sit near native: 11.9% vs 12.8% on Opus, 69.2% vs 64.7% on Sol. The push block is what moves QM.
9. **compare-run can't run on this run.** `scripts/compare-run.ts` exits 1, because Phase B trials are keyed by set P request ids, which have no `task.toml` ([compare-run.stderr.txt](results/compare-run.stderr.txt)). It wrote no output. The preregistration uses `analyze.ts` for every comparison, so no preregistered number is missing. `summarize-run.ts` ran and only warns that all 8,088 trials fall under family "unknown" ([summary.md](results/merged/summary.md)).
10. **INFRA, HARNESS and timeout counts** (all kept and scored as observed, intention to treat; [analysis-7-counted-in](results/analysis-7-counted-in/analysis.md), "INFRA"):
    - completed 4,980; stopped at the 6-request cap 3,067.
    - **timeout 29**, all in OpenClaw Sol Phase B setups: names-only 13, resolver-on 10, native 6.
    - **infra_error 8**, all QM "no sandbox container was created", at $0 each: QM Sol native 3, QM Opus resolver-on 2, QM Opus native 1, QM Sol resolver-on 1, QM Sol pull 1.
    - **harness_error 3**, all Hermes Opus on request p-s-112 (native, resolver-on and names-only).
    - model_error 1 (QM Opus native). Resolver status code BAD_JSON on 6 turns.
    - **Hermes harness errors, checked against an adapter log race.** The run commit predates a fix for a race in the Hermes adapter (see #440). The adapter could grep its stderr for a provider 402 or 429 before the background `tee` had flushed it, so a provider refusal could be scored as a harness error (exit 2) instead of a model error (exit 3). The metering proxy's counts don't depend on the adapter's stderr, so we checked them for the 3 trials above:
        - Each trial had 12 calls refused by the proxy and 1 or 2 model calls that returned 200, with none failed, per `usage.refused` and `usage.upstream` in [results/merged/trials.jsonl](results/merged/trials.jsonl).
        - No model call returned a 402 or 429, so the provider refused none of them. 12 is also the refused count of every completed Hermes Opus trial (661 of 661), so these are the routine refusals, not a budget or rate refusal. All 3 stay harness errors.
        - Operator checks of shard logs that aren't committed: the 12 refusals were the proxy's 403s on model-discovery routes, and Hermes's own per-turn stderr wasn't kept for these 3 trials. None of the 40 Hermes turn stderr logs that were kept matches the adapter's model-error pattern.
        - Every termination is kept intention to treat, so these labels change no score. The same request also gave QM's only model error (exit 3; 2 model calls that returned 200 and none failed, per the same fields).
    - No trial was missing its got-skill output, and no set T trial left no workspace.

## Why null?

Each part that didn't help, or couldn't be measured, gets one pass through four questions: did the model use it, do the tasks fit, were there enough samples and room to improve, and does the model already do it unaided.

**Resolver on OpenClaw (negative row).**
- Used it? Yes. In set T, OpenClaw Sol with the resolver opened skills in 34 of 48 trials through `tool_call skills_read`.
- Tasks fit? Yes, the same requests work on four other harnesses.
- Samples? 280 pairs, smallest detectable 9.1 points, enough.
- Already unaided? Not the cause: native opens are undercounted the same way, just less often.
- **Cause:** our counter, not OpenClaw or the resolver.
- **Verdict: FIX-METHOD.** Take the tool name from `x.name ?? x.tool ?? x.id` in `got-skill.ts`'s unwrap, strip a leading `<namespace>:core:` prefix, add a test with both id forms, and recount set T's OpenClaw cells under a dated amendment or a new run id. This run's Phase B OpenClaw setups can't be rescued.

**Resolver on no-skill requests (false suggestion a).**
- Used it? Yes, a block appeared on 483 of 483 no-skill requests.
- Tasks fit? Yes, 60 or 61 no-skill requests per setup.
- Samples? Enough: the range is [99.2%, 100.0%].
- **Cause:** the pinned release ranks and returns its top matches with no threshold.
- **Verdict: FIX-METHOD.** gbrain adds a way to suggest nothing (a `min_match` threshold or a no-skill gate), and the false-suggestion rates are rerun. No `min_match` sweep was preregistered, so none ran here.

**QM pull tool.**
- Used it? No. 6 of 578 pull trials left a call record.
- Tasks fit? Yes, the push block on the same requests gained +12.2 points.
- Samples? Enough trials, but almost no calls, so the run measured "the model doesn't call it", not "pull doesn't help".
- Already unaided? Not the reason: QM Opus native opens 12.8%.
- **Verdict: CUT-CANDIDATE.** Switch off the pull route for QM and use the push block. It is worth testing again only if QM's model is told about the tool in a way it acts on.

**Names-only listing as a substitute for the resolver.**
- Used it? Yes, the list was in context.
- Result: below native in all 4 countable setups, and 21.8 to 29.9 points below the resolver.
- **Verdict: CUT-CANDIDATE** as a replacement for the resolver. Names alone don't tell the model when a skill fits.

**Budget pacing (the number of suggestions drops as the 2,000-token budget is spent).**
- Used it? Never reached: every session ended in `under_half`.
- **Verdict: FIX-METHOD** for the eval. It needs sessions longer than 6 model requests, or the paid 50-turn sessions the preregistration planned. This run says nothing about pacing.

**Resolver push block on Claude Code, Codex, Hermes and QM: KEEP.** It isn't a null: +12.2 to +23.0 points per harness. The no-skill fix above still applies.

## Set R: one user's real messages

Set R is 300 of one user's real messages, run on OpenClaw with Opus 5.5 only. Every set R number is descriptive: it is one user's check, not a sample of users, and it never gates a verdict. Only aggregates appear here, never a message, a request id, a hash of a request or a file from the set.

- **What ran:** 3 arms (native, resolver-on and a usage-ordered top list), 300 trials each, 900 of 900, on one $219 lease. It ran from `a0431909` on one private machine, under a private dated amendment (sha256 `58e3967a...`).
- **Restarts:** set R ran as four runner processes, which is three restarts, and every process loaded `a0431909`. Every restart is in the private run log.
  - Process 1 stopped making progress while its machine sat idle and unwatched after the 503 bursts. Its operation then hit its 6-hour time limit.
  - Process 2 was stopped by hand at a trial boundary when its supervisor stalled.
  - Process 3 stopped at its planned trial-boundary time limit.
  - Process 4 ran to the end.

**The primary set shows no measurable gain.** Native's reachable set has 106 rows in 101 clusters. On it, resolver-on minus native is **+1.9 points [-4.7, +8.5]**: 7 better, 5 worse, McNemar p 0.77. Smallest difference the run could reliably detect: 9.4 points.

- **Got the skill on the primary set:** native 10.4% [5.3%, 17.8%] (11/106), resolver-on 12.3% [6.7%, 20.1%] (13/106), usage-ordered 7.5% [3.3%, 14.3%] (8/106).
- **Usage-ordered minus native:** -2.8 [-7.3, +1.0], smallest detectable 5.9 points. No measurable difference.
- **Resolver-on minus usage-ordered:** +4.7 [-1.9, +11.5], smallest detectable 9.6 points. TOST at a 10-point margin gives p 0.062, so "could not tell apart".
- **Why the primary is small and wide:** 168 of the 274 skill-needing rows fall outside native's reachable set.

**Over every skill-needing row, the resolver gains +11.8 points.** These are the preregistered sensitivity lines.

- **(a) Every skill-needing row:** resolver-on minus native **+11.8 [+6.9, +16.7]**, 272 pairs in 247 clusters, 39 better and 7 worse. Usage-ordered minus native +5.1 [+1.2, +9.2]. Resolver-on minus usage-ordered +6.6 [+2.3, +11.1], TOST p 0.07.
- **Got the skill on those rows:** native 13.2%, resolver-on 24.9%, usage-ordered 18.2%.
- **(b) Usage-ordered's listed set:** resolver-on minus usage-ordered +3.6 [-1.6, +8.8], 194 pairs. No measurable difference.

**False suggestions miss both bars, as on set P.**

- **(a) No-skill requests:** a non-empty block appeared on 26 of 26 rows, 100% [86.8%, 100%], both for the pushed block (resolver-on) and for native's shadow block. The bar is at most 25%, so not met.
- **(b) Off-target reads of a suggested skill:** resolver-on 10.0% [6.9%, 14.0%] (30/299), just over 1 in 10, so not met. Native's shadow block: 1.7% (5/298).

**Caveats for set R:**

1. **Every rate is a lower bound.** Set R is all OpenClaw, so the `got-skill.ts` undercount (What didn't work, item 1) applies to every arm: it never counts a `tool_call` skills_read. It needs the same method fix as the public OpenClaw rows.
2. **3 trials are excluded as contaminated** under the preregistered clean-arm rule: native 2, resolver-on 1, usage-ordered 0. Each was a relative `SKILL.md` read that the rule resolves outside the catalog copy.
    - The image's only gstack-named paths are inside its catalog copies, so these are probably catalog reads the rule couldn't place. None of the 3 is in the primary's 106 rows.
    - **Method follow-up:** the clean-arm rule should resolve relative paths.
3. **Terminations:** INFRA 0; 497 completed, 402 stopped at the request cap, 1 harness_error.
4. **Anthropic 503 bursts on 2026-11-13** hit 28 upstream calls in 8 trials (native 3, resolver-on 3, usage-ordered 2). All 8 stay request_cap as recorded, and none happened after the run resumed at 14:36Z on 2026-11-13.
5. **The receipts are private, so they are cited by sha256:** analysis.json `bb775742...dc34`, setr-arms.json `899ce8df...0517`, trials.jsonl `7fc616f0...92ab`.
    - Some per-arm rows come from a private script that imports `analyze.ts`'s own functions, because `analyze.ts` writes per-cell rows only for set P harnesses. Its resolver-on minus native row matches `analyze.ts` exactly.

## Deviations

From the run log (operator notes), in time order:

1. 2026-11-12 17:08Z: the he-sol-pair launch failed on a full local disk before any VM was made. Four clean, merged local worktrees were removed, and it relaunched.
2. 20:10Z: every controller moved from replicating straight to the Capy drive to a local replica, because the drive stopped syncing (`tree_too_large`). A packer copied one archive per shard to the drive.
3. The packer uses unique temporary names, because a file-system rename quirk made `mv` refuse "same file".
4. The packer leaves QM's database dumps out of the drive archives. The dumps stayed in the local results and on the VMs.
5. st-oc-sol's first smoke failed: 2 of 3 trials model_error, refused by the metering proxy's budget check on the $3.00 automatic smoke lease ($0.23 spent). It relaunched with a $6 smoke lease. Smoke only.
6. st-oc-sol's local `vm-shard.out` misses the relaunch's first 4,481 bytes. The VM-side file was complete.
7. Every reattach resets the controller's deadline to attach time plus `--timeout-hours`, so a reattached shard's real stop is its VM time limit minus 30 minutes.
8. Contaminated trials are reported in their cells. The clean-arm rule applies to every arm, treatment arms included.
9. st-cx-sol's first smoke failed the same way as item 5 (3 of 3 model_error, $0.26 spent). It relaunched with a $6 smoke lease, into the same results folder.
10. 2026-11-13 02:11Z to 02:13Z: the operator changed. Every controller was stopped and reattached under the new operator, all still at `a0431909`. st-oc-sol's timeout check fired at 04:25:06Z, not its 04:22:35Z deadline, because a pull ran first. Its VM was destroyed at 04:27Z.
11. st-oc-sol stopped at its VM time limit with 42 of 48 tasks in each of its 3 set T cells, the same 6 tasks missing in all three. The 18 missing trials ran together on one fresh VM from `a0431909`, under the shard's existing lease, from a copy of the results folder. The 48-task result is the primary, and the 42-task result is a sensitivity line.

From the analysis:

12. **7 Phase B trials flagged contaminated are counted back in.** The counter flagged 7 trials (Codex Sol names-only 3, QM Sol resolver-on 2, OpenClaw Sol names-only 1, QM Sol pull 1). Each followed a catalog gstack skill's own instruction to read `~/.claude/skills/gstack/<skill>/sections/preamble.md`. No image has a readable file at that path, and the read failed with "Permission denied", EACCES, or an error hidden by `2>/dev/null`. The counter's missing-file pattern (`no such file|ENOENT|does not exist|file not found`) doesn't recognise those, so it counted the failed opens as reads ([rule-c-controls.txt](results/checks/rule-c-controls.txt)). Rule c counts reads, and a failed open isn't one, so the headline counts them back in. This applies the rule as written, but it is our reading of it, so the preregistered command's 1,637-pair output is reported beside it, and the two round the same. **Caveat:** the Phase B tool results for these 7 were scrubbed, so the reading rests on the image definitions, the mounts and identical reads in set T, not on the 7 results themselves ([sett-gstack-path-evidence.json](results/checks/sett-gstack-path-evidence.json)). The trial records still say contaminated, and no record was edited.
13. **The headline and every sensitivity line run through a driver**, [analyze-sensitivity.ts](results/tools/analyze-sensitivity.ts), that calls `analyze.ts`'s own exported functions unchanged, after at most two named changes to the trial list. The id lists are in [results/tools/](results/tools/).
14. **The exploratory overlap-bin table** adds `--requests` to the preregistered command (What works).
15. **compare-run did not run** (What didn't work, item 9).
16. **The paid 50-turn footprint sessions have no record** in this run (What didn't work, item 4).
17. **Set R ran under a private dated amendment** (sha256 `58e3967a...`), from `a0431909` on one private machine. It ran as four runner processes, which is three restarts, and every process loaded `a0431909` (Set R section).

## Checks

- **Clean arms (set P):** the 7 counter flags above are the only ones in Phase B. Under rule c, none read a gstack file from outside the catalog.
- **Clean arms (set T):** set T records carry no clean-arm field, so the unchanged rule c counter was run over every set T trial's kept tool calls: 1,152 trials, with tool calls recovered for every trial ([sett-clean-arm-audit.txt](results/checks/sett-clean-arm-audit.txt), [sett-clean-arm-audit.json](results/checks/sett-clean-arm-audit.json)).
  - **Native and no-catalog arms: 0 real reads of a gstack file outside the catalog in all 16 cells.** The counter gives 6 hits in native cells (2 each in Codex Sol, OpenClaw Sol and QM Sol) and 0 in no-catalog cells.
  - The resolver-on arm has 3 more hits (Codex Sol 1, QM Sol 2). All 9 are the same failed preamble reads as in Deviation 12.
  - Across all 1,152 trials, 45 tool calls name a gstack install path, all under `~/.claude/skills/gstack`. None names `~/.local/share/gstack` or a Capy drive ([sett-gstack-path-evidence.txt](results/checks/sett-gstack-path-evidence.txt)).
  - So the no-catalog arm is a clean no-gstack arm and can carry the verdicts above.
- **Trial records:** the `trials.jsonl` of each of the 25 results folders used in the merge matches its packed copy by sha256. The rerun folder's archive was repacked after the rerun finished and matches too. Nothing changed them during the merge or the analysis. The merged `trials.jsonl` sha256 is `56a06cfba626345ee43be19017bb9ad6743ebbefd0f3cd2fcddb3efe53f889b0`.
- **Rebuild:** every analysis file in `results/` rebuilds from the committed files with the commands below. The preregistered command's output rebuilt byte-identical to the file the analysis first wrote.

## Reproduce and inspect

From the repository root, with no API key:

```
R=docs/benchmarks/2026-11-08-skill-resolver
bun scripts/skill-resolver/analyze.ts --results $R/results/merged \
  --labels P=$R/results/sets/labels.jsonl --cross-family P=$R/results/sets/labels-astra.jsonl \
  --duplicate-groups $R/prereg.json --judge-check $R/results/judge-check/judge-check.json \
  --reachable $R/reachable.json --set-t tasks/skill-resolver/T/tasks --out $R/results/analysis
```

- The headline runs `bun $R/results/tools/analyze-sensitivity.ts` with the same arguments plus `--uncontaminate $R/results/tools/contaminated-7-trials.txt`. The other sensitivity folders use `--drop-trials` with the id lists in [results/tools/](results/tools/). `bun run verify --run 2026-11-08-skill-resolver` runs all of them.
- **What is committed:** the trial records ([merged/trials.jsonl](results/merged/trials.jsonl)), the merge manifest, each shard's manifest, run summary, preflight, kit and VM records, and the per-trial files `analyze.ts` reads (`got-skill.json` and the resolver status log). Set P's requests and all its labels, both halves, are in [results/sets/](results/sets/), matching the sha256 values in [SETS.md](SETS.md).
- **Not committed:** full agent traces, set T workspaces, proxy logs and ledgers. Phase B traces were scrubbed on each VM by design, before results left it. The set T clean-arm and OpenClaw checks read set T traces that stay outside the repository, so their scripts in [results/tools/](results/tools/) can't be rerun from the repository alone.
- **Pins:** commit `a0431909`; gbrain v0.60.633.0 (`5ad4345f`); catalog hash `b6d67f1f...`; seed 20261108, 10,000 draws.

<details>
<summary>Agent notes</summary>

- Run id `skill-resolver-2026-11`. The preregistration, [PREREGISTRATION.md](PREREGISTRATION.md) with the 2026-11-11 and 2026-11-12 amendments, merged before the first counted trial. This is the separate results PR.
- The got-skill fix and the false-suggestion numbers go to gbrain's owners, for the resolver defaults and the resolver release.
- Run spend is in spend-internal.md beside this file.
- Shards: 25 public shards on Ubicloud standard-16 VMs in eu-central-h1, plus the rerun VM for st-oc-sol and the VMs of the two failed smokes.
</details>

## Disclosures

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI. OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.
