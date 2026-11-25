# Review real bugs: report (review-real-bugs-2026-11)

This test asks whether gstack's code review catches real bugs better than a plain review prompt, on bugs from other people's public repos that gstack never saw. Stage 1 ran /review against one plain prompt on Claude Opus 5.5. Stage 2 added /ship's review panel, plain prompts run up to 8 times, GPT-6.1 Sol and particle-1 in OpenClaw, and re-judged stage 1 with judges that can read the code. Stage 2's full results are in [stage2/report.md](stage2/report.md).

- **We learned that gstack's /review finds more real bugs than one plain review on code gstack never saw, and that its extra blocking findings are mostly real. You should keep /review as the review step for outside code on Claude.** On 54 outside bugs, Opus 5.5 with /review flagged 44.4% as blocking, against 25.9% with a plain prompt: +18.5 points (95% range +9.1 to +28.2). Judges that read the repository found its extra false blockers within the limit (+0.04 per PR, 0.00 to +0.09). **Corrected 2026-11-25:** that judge fails a third-model check, so "mostly real" and the +0.04 are descriptive and the verdict is KEEP on recall only ([correction](../../corrections/2026-11-25/README.md)).
- **We learned that eight plain passes at the same cost find as many bugs, so we see no sign the gain comes from /review's structure rather than its spend, but the plain passes are much noisier. You should use repeated plain passes only with a dedupe or confirm step.** Plain-8 matched /review's recall (0.0, -11.3 to +10.7) at $3.75 per review against $4.13, with 1.00 false alarm per clean PR against 0.07.
- **We learned that /ship's review panel finds fewer bugs than /review, and that /review's gain doesn't carry to GPT-6.1 Sol or particle-1 in OpenClaw. You should replace the panel with /review and keep /review's "keep" verdict to Claude for now.** The panel trailed /review by 7.4 points at blocking severity (-15.1 to 0.0) and 10.2 at any severity (-20.4 to -0.9). Sol found no more bugs at any severity with /review (-2.9, -9.6 to +3.0), and OpenClaw never ran /review's readers.

**Caveats you need before using these numbers:**

- **The stage 1 re-judge passed its judge check narrowly** (kappa 0.611 against a 0.6 bar, on lopsided labels), and the code-reading judge called 15 of 28 findings on clean decoy PRs real defects. It shows no sign that /review's extra blockers are noise, but it doesn't prove they're precise. **Corrected 2026-11-25:** that judge fails a third-model check (kappa 0.37 against Gemini 4 Neon, counting its can't-tell as a disagreement), so this check no longer backs the false-blocker numbers ([correction](../../corrections/2026-11-25/README.md)).
- **Stage 2's C2 (Sol) judge check failed** (kappa 0.523), so C2's false-blocker numbers are descriptive only.
- **Plain-8 writes 1.00 false alarm per clean PR**, against /review's 0.07. Our dedupe recommendation is a reading of that, not a preregistered rule.
- **A tie is not "no difference".** The smallest difference these runs can reliably detect is 18 points.

**How to read the numbers.** Recall is the share of review passes that found each known bug. "Blocking" counts only findings rated CRITICAL after our severity map. A "95% range" is a 95% interval clustered by PR; a difference whose range includes zero is not a measured difference. Cost is list price, measured on every call through our metering proxy. The suite (89 units, referenced by URL and commit) is published at [results/suite/](results/suite/), as the preregistration promised.

## Stage 1 verdict

**KEEP.** Under the preregistration's rule this needs both co-primary ranges above zero and every false-alarm guard within +0.5 per PR. Stage 1's first grading gave "KEEP (recall only; false blockers on bug PRs unmeasured)", because its adjudication judge check failed. Stage 2's Amendment 3 re-judged the same findings with judges that read the repository; that check passed, both guards now apply, and both hold. The Holm-adjusted p-values are below 0.05, so the KEEP is not downgraded to INCONCLUSIVE.

**Corrected 2026-11-25: KEEP (recall only; false blockers on bug PRs unmeasured).** Under R126, a code judge counts only once it agrees with Gemini 4 Neon's blind labels at kappa 0.6 or more. The re-judge's primary judge, GPT-6 Astra, agreed at 0.37 [0.15, 0.56] on 99 findings, so by the rule above its false blockers per bug PR (+0.04) are descriptive. Recall and the Holm-adjusted p-values don't change. Under the frozen counted reading a judge's can't-tell counts as a disagreement; dropping those rulings (0.61) or reading them as defect (0.62) would clear the bar. Details: [the correction](../../corrections/2026-11-25/README.md).

## Co-primary results (outside bugs, 54 bugs in 52 PR clusters, 2 passes per arm)

| Measure | /review | plain | Difference | 95% PR-clustered range | Sign-flip p (two-sided, 10,000 draws, seed 2665) | Holm-adjusted p |
| --- | --- | --- | --- | --- | --- | --- |
| Blocking recall | 44.4% | 25.9% | +18.5 points | +9.1 to +28.2 | 0.0012 (MC SE 0.0003) | 0.0024 |
| Any-severity recall | 72.2% | 56.5% | +15.7 points | +5.5 to +27.6 | 0.0098 (MC SE 0.0010) | 0.0098 |

- Scored by scripts/review-bugs/score-mc.ts with --seed 2665 --draws 10000 --mc-seed 2665 --mc-draws 10000 --mdd 18 --exposure T5=pass, after dropping the 20 home-field units. T5 is the blinded /review arm and M2 the blinded plain arm. Output: [results/stage1/score-mc.json](results/stage1/score-mc.json).
- **Severity-blind read** (GPT-6 Astra's impact ratings): blocking recall 72.2% against 56.5%, +15.7 points (+5.5 to +27.6), p 0.0098. Astra rated every finding that matched a known blocking bug as blocking, so here blocking recall equals any-severity recall.
- **Repo-clustered range** (29 repos, percentile bootstrap, seed 2665, 10,000 draws; our own script, no p-value): blocking +18.5 (+8.3 to +30.2), any-severity +15.7 (+6.3 to +26.9). **Newest half** (26 of 52 PR clusters, fix commits dated 2026-09-14 or later): blocking 44.2% against 28.8%, +15.4 (+3.8 to +28.8); any-severity +13.5 (+1.9 to +26.9). File: [results/stage1/secondary.json](results/stage1/secondary.json).
- **Detectable difference on the counted units:** 18 points at the pilot's 30% plain rate (52 PR clusters, 54 bugs, 2 passes, 2,000 simulations, seed 1). The preregistration's 17 points was for 55 units. The plan's conservative planning scale puts it near 31 points. This doesn't matter for a KEEP. It would for a cut candidate.

## Stage 1 re-judge

Stage 1's blind judges saw a 61-line evidence sheet and ruled most unmatched blocking findings "not a defect", but fix-aware labellers disagreed with those rulings (kappa 0.012 on 48 items, a failed check). Stage 2's Amendment 3 re-read all 204 unmatched blocking findings with judges that can read the repository at the PR head: GPT-6 Astra primary and Claude Opus 5.5 second, each a read-only tool session with a budget of 12 tool calls.

| Guard (/review minus plain, per PR, limit +0.5) | Stage 1 (61-line sheet) | Re-judge, counted (can't-tell is not a false blocker) | Re-judge, can't-tell as false blocker |
| --- | --- | --- | --- |
| False alarms per decoy PR (15 PRs) | 0.60 vs 0.33, +0.27 [+0.07, +0.50], within | 0.07 vs 0.13, **-0.07** [-0.17, 0.00], within | 0.23 vs 0.20, +0.03 [-0.10, +0.20], within |
| False blockers per bug PR (52 PRs) | 0.73 vs 0.15, +0.58 [+0.38, +0.78], over (descriptive only) | 0.06 vs 0.02, **+0.04** [0.00, +0.09], within | 0.14 vs 0.03, +0.12 [+0.04, +0.20], within |
| Verdict | KEEP (recall only; false blockers unmeasured) | **KEEP** | **KEEP** |

- Recall and the co-primaries don't change. The two readings agree, so the counted reading's KEEP stands (corrected 2026-11-25: KEEP on recall only, see above). Files: [results/rejudge/score-mc-counted.json](results/rejudge/score-mc-counted.json) and [results/rejudge/score-mc-cant-tell-as-false.json](results/rejudge/score-mc-cant-tell-as-false.json).
- **Rulings changed a lot.** On the same 204 findings, the stage 1 blind judge ruled 9 defect. Astra, reading the repository, ruled 162 defect, 20 not-defect and 22 can't-tell (Opus as second judge: 154 defect).
- **The judge check passed narrowly.** Astra against 153 agreed labels (132 defect, 21 not-defect), with can't-tell counted as a disagreement: kappa 0.6107, raw agreement 0.895. Opus as second judge: 0.786. The labellers agreed with each other at 0.469. The preregistration warned that lopsided labels could hold kappa down even with high raw agreement. File: [results/rejudge/judge-check.json](results/rejudge/judge-check.json).
- **Decoys.** Astra ruled 15 of 28 blocking findings on clean decoy PRs defect, 7 can't-tell and 6 not-defect. Either those PRs hold real bugs we didn't catalogue, or code-reading judges lean towards "defect". The preregistration counts them as ruled, so decoy false alarms dropped too.
- **Filter stops:** 5, all from the Opus labeller on flagos-ai/FlagGems#5915, the same PR that stopped it in stage 1. No model was swapped, and those items have no agreed label. No read failed and none ended in a provider error.
- **Pipeline check:** the re-judge scoring script fed stage 1's own adjudication gives a score file byte-identical to stage 1's ([results/rejudge/score-mc-stage1-reproduced.json](results/rejudge/score-mc-stage1-reproduced.json)).

## Per-stratum recall (share of passes that found each bug)

| Stratum | Bugs | Blocking: /review | Blocking: plain | Any severity: /review | Any severity: plain |
| --- | --- | --- | --- | --- | --- |
| S1 caught by human reviewers | 12 | 54.2% | 37.5% | 79.2% | 50.0% |
| S2 caught by review tools, all | 39 | 43.6% | 24.4% | 73.1% | 60.3% |
| S2 mixed-vendor tools | 26 | 40.4% | 21.2% | 73.1% | 63.5% |
| S2 OpenAI-model tools | 12 | 54.2% | 33.3% | 79.2% | 58.3% |
| S2 Google-model tools | 1 | 0.0% | 0.0% | 0.0% | 0.0% |
| S3 bugs that escaped review | 3 | 16.7% | 0.0% | 33.3% | 33.3% |
| **Headline (S1 + S2 + S3)** | **54** | **44.4%** | **25.9%** | **72.2%** | **56.5%** |
| H home field (kept apart, not in the headline) | 32 bugs in 20 units | 28.1% | 10.9% | 56.2% | 31.2% |

The strata are small (S3 has 3 bugs, S2-google has 1), so read those rows as counts, not rates. File: [results/stage1/strata.json](results/stage1/strata.json).

## Findings, exposure and checks

- **Volume.** /review wrote 1,397 findings (225 mapped CRITICAL) and plain wrote 489 (81 CRITICAL), across all 89 units and both passes. 204 blocking findings matched no known bug: 159 from /review and 45 from plain.
- **Exposure gate: passed.** 163 of 178 review PR-passes, or 91.6% (threshold 90%), under the amended skill-open rule (Amendment 2); strict rate 162 of 178 (91.0%). Under the pinned rule both are 0 of 178, because the pinned detector never sees the skill open. By stratum: outside bugs 100/108 (92.6%), home field 34/40 (85.0%), decoys 29/30 (96.7%). Rows: [results/stage1/exposure-amended.tsv](results/stage1/exposure-amended.tsv) and [results/stage1/exposure-pinned.tsv](results/stage1/exposure-pinned.tsv).
- **Matching judge check: passed.** 111 agreed labels from 120 items (60 judged match, 60 judged no-match, near misses first), kappa 1.00 between blind matching and the labels; the labellers agreed with each other at 0.965. A perfect kappa on that design shows agreement on the hard cases the sample chose, not over every pair. File: [results/stage1/judge-check.json](results/stage1/judge-check.json).
- **Matching judge, checked 2026-11-25 with a third model (R126): holds.** Gemini 4 Neon labelled the same 120 items blind, after 20 of 20 known-answer anchors right, and agreed with the blind matching at kappa 0.98 [0.95, 1.00] on the 114 it labelled. So the recall numbers stand ([correction](../../corrections/2026-11-25/README.md), section 1).
- **Blinding check: passed its rule, but weakly.** Astra guessed the arm on 20 packets and got 10 right (50%; more than 70% fails). But it guessed "gstack" on all 20, and its confidence still separated the arms: AUC 0.935. Finding count and style probably give the arm away. Files: [results/stage1/blinding-truth.json](results/stage1/blinding-truth.json) and [results/stage1/blinding-answers.json](results/stage1/blinding-answers.json).
- **Clean plain arm.** 0 reads of an installed gstack skill and 0 Skill tool calls in 178 plain transcripts. The only skills listed are Claude Code's built-ins and project skills that 19 unit repos ship themselves. 8 gstack home-field units (13 plain PR-passes) read SKILL.md files inside the unit repo, which is gstack's own source under review. 3 plain PR-passes touched ~/.claude/skills paths: two empty listings on garrytan/gstack#3524 and throwaway sandboxes built from the repo's own files. File: [results/stage1/clean-arm-audit.json](results/stage1/clean-arm-audit.json).
- **Safety-filter stops.** Opus returned an empty answer twice on the stage 1 label packet for flagos-ai/FlagGems#5915. Its 12 items count as unlabelled. No model was swapped. Astra raised no policy refusals.

**Smoke outcomes (3 sessions per cell; pinned rule against amended rule)**

| Cell | Pinned: gate / strict | Amended: gate / strict | Cost | Notes |
| --- | --- | --- | --- | --- |
| C1 Opus 5.5, /review in Claude Code | 0/3 / 0/3 | 3/3 / 3/3 | $12.35 | Every expected reader was started and returned. The skill open shows only as the gstack-skill-start preamble handshake. |
| C2 GPT-6.1 Sol (OpenRouter, Claude Code) | 1/3 / 1/3 | 3/3 / 3/3 | $13.92 | Under the pinned rule only mise matched. |
| C3 particle-1 in OpenClaw | 3/3 / 0/3 | 3/3 / 0/3 | $0.69 | All 3 sessions read the /review SKILL.md. It ran without the PR description. |

## For gstack's maintainers (gstack 1d3c63c5, v1.99.3.0, Claude Code)

1. **The red-team reader is skipped most often.** /review's depth rule named red-team for 128 PR-passes, but the agent started it in only 115 (89.8%). Red-team is missing in 13 of the 15 passes that failed the gate. In traycerai/traycer#1716 pass 2, only the adversarial reader ran.
2. **The skill open is invisible in the session log.** The rig doesn't log the /review slash-command expansion. The only trace is the preamble command and its SKILL_START_PROTO line, which is why the pinned exposure check missed all 178 opens.
3. **gstack-diff-scope exits 2** (SCOPE_ERROR=unmatched) on Project-N-E-K-O/N.E.K.O#2157's pkgbuild/PKGBUILD. /review runs it with "|| true".
4. **The second-model reader never ran.** Its rows are $0 with 0 requests in all 178 review passes, because the trial image has no bubblewrap. Separately, 7 review sessions made 10 OpenAI-route calls the metering proxy refused, because the trial proxy had no OpenAI key. The plain arm made none.
5. **Volume and cost.** /review averaged $4.49 and 486 s per session, against $0.54 and 112 s for plain, and raised 2.8 times as many CRITICAL findings.
6. **Home field:** on the 20 home-field units (12 from gstack, 6 from gbrain and 2 from harness-evals), /review's blocking recall was 28.1% against 10.9% for plain. Both arms did worse there than on outside bugs.

## Cost

| | plain | /review |
| --- | --- | --- |
| Per session (all 178) | $0.54 | $4.49 |
| Per PR, both passes, outside-bug units | $0.98 | $8.25 |
| Per PR, all 89 units | $1.08 | $8.98 |
| Per blocking bug found (28 against 48 finds over 108 bug-passes) | $1.90 | $9.29 |
| Per any-severity bug found (61 against 78 finds) | $0.87 | $5.71 |
| Each extra blocking find from /review | | $19.63 |
| Each extra any-severity find from /review | | $23.10 |

Paid spend by ledger item is kept in the private repository (spend-internal.md beside this report).

<details>
<summary>Deviations (24)</summary>

From the run:

1. spiceai/spiceai#13884 was dropped and not replaced, because GitHub no longer serves the PR, so 54 outside + 20 home-field + 15 decoy = 89 units (Amendment 1). The detectable difference was recomputed on the counted units.
2. Two depth.ts fixes were accepted: the gstack-diff-scope exit 2, and deleting throwaway repos after use (Amendment 1).
3. microsoft/openvmm#3858 was rebuilt from a full clone (Amendment 1).
4. The exposure check's skill-open rule was widened to accept the review preamble handshake (Amendment 2). Pinned and amended numbers are both reported.
5. The C3 smoke ran without the PR description. The C3 driver's final collect step failed in post-processing only.
6. The rig doesn't log the /review slash-command expansion (maintainers item 2).
7. The grid ran as 3 launches of one run id (canary, block 2, rest). The first block 2 launch was refused before any spend, and the VM script gained a spend cap flag.
8. The second-model reader never ran. The review arm's arm.json still lists gpt-6.1-sol as that voice, and the blinding step strips it.
9. There were replication gaps: the controller loop hit its 6-hour timeout twice, and the final pull is the copy of record.

From grading:

10. **Severity map extended.** The pinned map left 3 plain-arm labels unmapped ("non-blocking" twice, "process" once). Both were mapped to INFORMATIONAL in [results/stage1/severity-map-stage1.json](results/stage1/severity-map-stage1.json) (sha256 a048c9ab). The plain arm was blinded from a copy whose arm.json differs only in the severity map. Findings and cost are byte-identical.
11. **Publication scan.** The ingest's scan flagged one machine path in each arm. Digest-only ingest replaced the text of finding b8 in every M2 unit and b5 in every T5 unit with digests. Severity, path and line are kept, so scores don't change. For the severity-blind read, 180 impact ratings were re-bound to the digest-only lines after checking each digest.
12. **Draft tool fixes:** the label builder matched units that share a PR number by number alone (fixed to check the head), read openvmm from the bare clone (pointed at the full clone) and called decoys' empty fix diff unreadable (now says the bait has no fix diff). The label runner left its budget lease open; both runs were closed by hand.
13. **Ledger:** grading approvals were recorded in a fresh local record quoting the approval and the $1,577.58 grading line. The approvals tool refuses a detached checkout, so a branch name was passed. The judge runs leased without rig admission records (warning only). Labels and the blinding check ran through the harness-evals metering proxy with $400 and $40 leases.
14. **Opus safety-filter stop** on one label packet (above). No model was swapped.
15. **exposure.test.ts has 45 tests**, not 60 as first noted. Under gstack's bun shim 1 test fails because the shim prints a banner on stderr; with bun 1.4.4 all 45 pass on both the pinned and the patched copy.
16. **The detectable difference is 18 points on the counted 54 units**, not the preregistration's 17 at 55.
17. **The repo-clustered and newest-half readings** come from our own script (percentile cluster bootstrap), not score-mc, and have no p-values.
18. **Judge self-names:** judges' raw replies name themselves loosely (Astra's matching replies say "OpenAI GPT-5.5"). The proxy journal shows the metered model, gpt-6-astra.
19. **Clones were copied per repo** (41 transfers) because of a transfer size limit. A check found 0 of 101 fix commits missing.
20. **The adjudication label sample** drew 120 of the 204 unmatched findings at random (seed 2665). The matching sample was stratified 60 judged-match and 60 judged-no-match, near misses first.

From the re-judge (stage 2, Amendments 3 and 4):

21. **Lease cap.** The preregistration names a $345 line but no lease cap. The lease was set at $448.50 (the line plus the 30% stop margin). Spend ended at $322.19.
22. **The lease stayed open after the proxy stopped** and was closed by hand, so no later run could spend on it.
23. **The decoy guard reads low because the judges call most decoy blockers real** (15 of 28, above).
24. **Pinned checkout.** Every counted re-judge step ran from a detached worktree at 2509bc8d, and each script asserts that commit. score-mc.ts is unchanged from stage 1's pin.

</details>
