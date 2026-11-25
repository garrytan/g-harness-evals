# Review real bugs, stage 2: results (review-real-bugs-2026-11-stage2)

- **We learned that eight plain reviews at the same cost find as many bugs as gstack's /review, so we see no sign that /review's structure adds recall beyond what its spend buys. You should treat repeated plain passes as a good default review for outside code, but only with a dedupe or confirm step, because on their own they are noisy.** Eight plain Claude Opus 5.5 review passes, at about the same cost per PR as one /review pass ($3.75 against $4.13), found exactly as many outside bugs: 44.4% at blocking severity for both, a difference of 0.0 points (95% range -11.3 to +10.7). But the eight passes together put 1.00 false alarm on each clean PR, against /review's 0.07. The dedupe step is our recommendation, not a rule we preregistered.
- **We learned that /ship's review panel finds fewer bugs than /review, not more. You should replace the panel with /review.** The panel found 37.0% of blocking bugs against /review's 44.4% (-7.4 points, -15.1 to 0.0) and 62.0% against 72.2% at any severity (-10.2, -20.4 to -0.9), at 75% of /review's cost. Our preregistered map reads the blocking result as a tie and says to replace the panel.
- **We learned that /review's gain on Claude doesn't carry over to GPT-6.1 Sol or to particle-1 in OpenClaw. You should keep /review's "keep" verdict to Claude models for now.** On Sol, /review raised blocking recall by 43.1 points only because Sol labels 82% of its findings CRITICAL under /review; it found no more bugs at any severity (-2.9, -9.6 to +3.0). On OpenClaw, /review's reader subagents never ran, and the result is flat (+1.3, -9.5 to +11.5).

**Caveats you need before using these numbers:**

- **C2's judge check failed.** Claude Opus 5.5, the judge for the Sol runs, scored kappa 0.523 against fix-aware labels, under the 0.6 bar. So C2's false-blocker numbers are descriptive only. C2's "no gain" doesn't depend on them, because it comes from any-severity recall.
- **Plain-8 is noisy.** It writes 1.00 false alarm per clean (decoy) PR against /review's 0.07, and 0.27 false blockers per bug PR against 0.06. Read with plain-8 as the variant, its excess on decoys is +0.93 (0.00 to +2.60), over the +0.5 limit the preregistration sets for any variant.
- **Stage 1's re-judge passed narrowly.** Its judge check passed at kappa 0.611 against a 0.6 bar, and the code-reading judge called 15 of 28 findings on clean decoy PRs real defects. The re-judge shows no sign that /review's extra blockers are noise, but it doesn't prove they're precise. Details are in [the stage 1 report](../report.md#stage-1-re-judge). **Corrected 2026-11-25:** the re-judge fails a third-model check (kappa 0.37 against Gemini 4 Neon), so it no longer backs the false-blocker numbers ([correction](../../../corrections/2026-11-25/README.md)).
- **A tie is not "no difference".** The smallest difference this run can reliably detect is 18 points. Every interval below allows real effects smaller than that.
- **Missing sessions were scored both ways.** The preregistration doesn't say what to do with them, so every comparison was scored with them dropped and with them counted as misses. All four readings give the same verdicts.

**How to read the numbers.** Recall is the share of review passes that found each known bug, averaged over 54 bugs from outside repos in 52 PRs. "Blocking" counts only findings rated CRITICAL after our severity map. A "95% range" is a 95% interval clustered by PR; a difference whose range includes zero is not a measured difference. Cost is list price, measured on every call through our metering proxy.

## Verdicts

Each row compares a variant against a reference on the same 54 bugs, variant minus reference, with the counted reading (a judge's "can't tell" counts as a real defect) and missing PRs dropped. Dropping them leaves 51 bugs in the C2 row and 40 in the C3 row. The preregistered outcome map reads each row. The blinding AUC sits beside each verdict, as the map requires.

| Comparison | Blocking recall | Any-severity recall | Map reading | Scorer's label | Verdict after "Why null?" | Blinding AUC |
| --- | --- | --- | --- | --- | --- | --- |
| ship-panel vs /review (C1) | 37.0% vs 44.4%: **-7.4 [-15.1, 0.0]** | 62.0% vs 72.2%: **-10.2 [-20.4, -0.9]** | **ties /review** | LOSS | replace the panel | 0.665 |
| ship-panel vs plain-8 (C1) | 37.0% vs 44.4%: -7.4 [-16.0, +0.9] | 62.0% vs 72.2%: -10.2 [-20.5, 0.0] | doesn't lose to plain-8 | CUT-CANDIDATE | no cut is triggered | 0.885 |
| /review vs plain-8, same spend (C1) | 44.4% vs 44.4%: **0.0 [-11.3, +10.7]** | 72.2% vs 72.2%: 0.0 [-9.3, +9.3] | **plain-8 matches or beats** | CUT-CANDIDATE | see below | 0.915 |
| Sol /review vs Sol plain (C2) | 61.8% vs 18.6%: +43.1 [+29.0, +57.0], 51 bugs | 61.8% vs 64.7%: **-2.9 [-9.6, +3.0]** | **no gain** | FIX-METHOD | **FIX-METHOD** | 0.565 |
| particle-1 /review vs plain in OpenClaw (C3) | 26.3% vs 25.0%: +1.3 [-9.5, +11.5], 40 bugs | 50.0% vs 55.0%: -5.0 [-14.6, +4.4] | **no gain** | CUT-CANDIDATE | **FIX-METHOD** | 0.725 |

- **The ship-panel row sits exactly on the line.** The blocking range's upper end is 0.0000 to four decimals, and the map reads a range that includes zero as a tie. The any-severity range lies wholly below zero, and the map has no "loses to /review" row. Either way the action is the same, because the panel never beats /review. The unrounded bounds: ship vs /review blocking [-0.1509, 0], any [-0.2037, -0.0094]; ship vs plain-8 blocking [-0.1604, +0.0091], any [-0.2054, 0]; /review vs plain-8 blocking [-0.1132, +0.1071].
- **The /review vs plain-8 row doesn't make /review a cut candidate.** /review clearly beats one plain pass (+18.5 [+9.1, +28.2], stage 1), and it is far more precise than plain-8. What it shows is that its recall edge can be bought with plain passes at the same price.
- **Plain-8 against the decoy guard.** The guard limits the variant, which is /review in that row, so plain-8's noise doesn't fail it. Read the other way round, plain-8's decoy excess is +0.93 [0.00, +2.60], over the limit.
- The scored outputs are in [results/score/](results/score/), one folder per reading; the counted reading is defect-excl.

## What the results change

The outcome map was fixed before the run (see the [preregistration](PREREGISTRATION.md#what-each-result-changes-r97)):

1. **Plain-8 matches or beats /review.** Our default review for outside code becomes repeated plain passes. We add a dedupe or confirm step before that default ships, because of the noise above. gstack's maintainers hear that /review's structure adds nothing beyond spend on recall.
2. **The ship-panel ties /review.** /ship's review panel is replaced by /review. The preregistration expected this to cut review cost, but the panel cost less: $3.10 per review against /review's $4.13, so the switch raises review cost by about a third.
3. **The ship-panel doesn't lose to plain-8,** so that row's cut candidate doesn't trigger.
4. **C2 Sol: no gain.** /review's value is Claude-only for now, and gstack's maintainers get Sol's specifics (below).
5. **C3 particle-1 in OpenClaw: no gain.** gstack's maintainers hear that this /review adds nothing on OpenClaw as it runs today, and particle-1 lanes don't rely on it.
6. **Stage 1's re-judge: mostly real.** Stage 1's verdict becomes a full KEEP, and /review stays as it is against a single plain pass. **Corrected 2026-11-25:** the re-judge fails a third-model check, so stage 1's verdict is KEEP on recall only and /review still stays as it is ([correction](../../../corrections/2026-11-25/README.md)).

Items 1 and 6 don't conflict. /review clearly beats one plain pass. It doesn't beat eight plain passes that cost about the same.

## Why null? (the two "no gain" rows)

Our rule for a null result is one "Why null?" cycle: did the model use the part, do the tasks fit, were there enough samples and headroom, and does the model already do it unaided? Then a verdict: KEEP, FIX-METHOD or CUT-CANDIDATE.

**C2, GPT-6.1 Sol in Claude Code: FIX-METHOD.** Sol did use /review: the skill opened and the gate's readers ran in 169 of 175 readable passes (96.6%), though 11 of those 169 ran no specialist reader, and 3 other passes never opened the skill. The tasks fit: they are the same 54 bugs on which /review beat one plain Opus pass by 18.5 points, and 51 of them could be scored for Sol with gaps dropped. There was headroom, since Sol's plain review found 64.7% at any severity. The problem is /review's severity labels on Sol: it marked 456 of its 557 findings CRITICAL (82%), against 121 of 393 for Sol's plain review. That inflates "blocking" recall (+43.1) and puts 0.32 false alarms on each clean PR against plain's 0.04 (+0.29 [+0.07, +0.57], over the +0.5 limit at the top of the range), which is the preregistration's FIX-METHOD rule. At any severity, /review found no more bugs than plain Sol (-2.9 [-9.6, +3.0]); that range's top is far under the 18-point detectable difference. So the fix to try is the severity guidance /review gives a GPT host. If a fixed /review still shows no any-severity gain on Sol, it becomes a cut candidate on GPT hosts. One weakness: the decoy guard rests on Opus's adjudication, the judge that failed its check on bug-PR items (deviation 24).

**C3, particle-1 in OpenClaw: FIX-METHOD, not the scorer's CUT-CANDIDATE.** The model opened the skill in 150 of 151 readable passes, so the exposure gate passed. But this run didn't test /review as designed. Under /review, particle-1 tried to start reader subagents, and OpenClaw refused at least one start in 130 of 151 readable passes. No reader report came back in any pass. On top of that, 55 of 356 sessions are gaps: particle-1's rate limits added retry rows to 50 of them (below), and 5 /review outputs couldn't be parsed. So only 40 of the 54 bugs could be scored with gaps dropped. Headroom was large: plain found 25.0% of blocking bugs and 55.0% at any severity. Counting gaps as misses gives 0.0 [-8.3, +7.7] on all 54 bugs. We don't call this a cut candidate, because the measured thing was /review with its readers failing to start on a harness that can't run them, under heavy rate limiting. It isn't evidence that /review works on OpenClaw either. The fixes are a /review for OpenClaw that doesn't try to start readers OpenClaw can't run, and a rerun when particle-1's capacity holds. Until then, the map's action stands: particle-1 lanes don't rely on /review.

## The four readings

The verdicts are the same in every reading. Only the C2 and C3 numbers move, because only those arms have missing sessions in the scored bugs. C1's one missing session (garrytan/gstack#3567 in the ship-panel arm) is on a home-field unit, which is never in the headline.

| Comparison | Counted, gaps dropped | Can't-tell as false, gaps dropped | Counted, gaps as misses | Can't-tell as false, gaps as misses |
| --- | --- | --- | --- | --- |
| ship vs /review, blocking / any | -7.4 [-15.1, 0.0] / -10.2 [-20.4, -0.9] | same | same | same |
| ship vs plain-8 | -7.4 [-16.0, +0.9] / -10.2 [-20.5, 0.0] | same | same | same |
| /review vs plain-8 | 0.0 [-11.3, +10.7] / 0.0 [-9.3, +9.3] | same | same | same |
| C2, blocking / any | +43.1 [+29.0, +57.0] / -2.9 [-9.6, +3.0] (51 bugs) | same | +38.9 [+25.0, +52.8] / -4.6 [-11.8, +1.9] (54 bugs) | same |
| C2 decoy false alarms (review minus plain) | +0.29 [+0.07, +0.57] (14 PRs) | +0.57 [+0.25, +0.93] | +0.27 [+0.07, +0.53] (15 PRs) | +0.53 [+0.23, +0.90] |
| C3, blocking / any | +1.3 [-9.5, +11.5] / -5.0 [-14.6, +4.4] (40 bugs) | same | 0.0 [-8.3, +7.7] / -5.6 [-13.9, +2.8] (54 bugs) | same |
| Verdict pattern | as in Verdicts | same | same | same |

"Can't-tell as false" counts a judge's can't-tell as a false blocker; it moves only the false-alarm guards. "Gaps as misses" counts a missing session as a pass that found nothing. Folders: defect-excl, not-defect-excl, defect-miss and not-defect-miss under [results/score/](results/score/).

## The plain curve and cost per bug found (C1, Opus 5.5)

Cost is per review of one PR: one session for plain-1 and /review, two sessions for plain-2, and so on. It is averaged over the 54 outside-bug units, from [results/costs.json](results/costs.json). "Per find" is cost per review divided by recall.

| Arm | Cost per review | Blocking recall (/review minus this arm) | Any-severity recall | Decoy false alarms per PR | $ per blocking find | $ per any find |
| --- | --- | --- | --- | --- | --- | --- |
| plain-1 | $0.49 | 25.9% (+18.5 [+9.1, +28.2]) | 56.5% | 0.13 | $1.90 | $0.87 |
| plain-2 | $0.98 | 36.1% (+8.3 [-1.8, +17.9]) | 64.8% | 0.23 | $2.72 | $1.52 |
| plain-4 | $1.88 | 39.8% (+4.6 [-5.8, +14.8]) | 67.6% | 0.50 | $4.71 | $2.77 |
| plain-8 | $3.75 | 44.4% (0.0 [-11.3, +10.7]) | 72.2% | 1.00 | $8.44 | $5.19 |
| /review | $4.13 | 44.4% | 72.2% | 0.07 | $9.29 | $5.71 |
| ship-panel | $3.10 | 37.0% | 62.0% | 0.07 | $8.37 | $5.00 |

- Each extra blocking bug /review finds over one plain pass costs about $19.63 ($3.64 more per review for +18.5 points).
- Two plain passes come within the range of /review at a quarter of its cost. That range still allows /review to be up to 17.9 points better, just under the 18-point detectable difference, so this is not a "no difference" claim.
- Other cells: Sol plain $1.15 per review, Sol /review $4.68, particle-1 plain $0.26, particle-1 /review $0.30.

## Gates and checks

**Exposure gate** (the skill opened and every expected reader started and returned, in at least 90% of readable PR-passes). Per-pass rows are in [results/exposure-summary.json](results/exposure-summary.json).

| Cell | Gate | Gate if gaps counted as failures | Strict (every reader returned) | Gaps |
| --- | --- | --- | --- | --- |
| C1 ship-panel (5 to 8 readers per unit) | **170/177 = 96.0%, pass** | 95.5% | 176/177 | 1 truncated |
| C2 Sol /review | **169/175 = 96.6%, pass** | 94.9% | 158/175 = 90.3% | 3 truncated |
| C3 OpenClaw /review (skill open only) | **150/151, pass** | 84.3% | 0/151 | 27 (24 flagged as tampered, 2 truncated, 1 undecodable) |

C3 would fail the gate if gaps counted as failures. The preregistration says an unreadable transcript is a gap, never counted as exposed or not.

**Judge checks (each judge against at least 60 fix-aware labels, kappa at least 0.6).** Files: [results/judge-check-c1.json](results/judge-check-c1.json), [c2](results/judge-check-c2.json), [c3](results/judge-check-c3.json).

| Cell | Primary judge | Kappa | Items | Result | Second judge | Labellers with each other |
| --- | --- | --- | --- | --- | --- | --- |
| C1 (Opus reviews) | GPT-6 Astra | 0.717 | 216 | pass | | |
| C2 (Sol reviews) | Claude Opus 5.5 | 0.523 | 274 | **fail** | Astra 0.821 | 0.190 |
| C3 (particle-1 reviews) | GPT-6 Astra | 0.706 | 80 | pass | | |

C2's two labellers agreed with each other at only 0.190, so the labels themselves were weak. Astra scored 0.821 as the second judge on the same items, but the preregistration keeps a judge from another model family than the one under test, so Opus stays primary for a GPT run and C2's false blockers on bug PRs are descriptive.

**Added 2026-11-25: the matching checks, and a third-model check (R126).** C2's matching judge (Claude Opus 5.5) was checked as the preregistration promised, but the result was never published here: kappa 0.982 between Opus's matching and 112 agreed labels from 120 items, a pass (the Astra and Opus labellers agreed with each other at 0.965; $16.93; file grading/labels-c2/label-score.json in the raw grading archive). C1 and C3 are matched by GPT-6 Astra, the judge stage 1's matching check passed at 1.00. Gemini 4 Neon, labelling stage 1's and C2's matching items blind, agrees with both matchers at kappa 0.98, so every recall number here stands. It does not agree with the adjudication judges: C1's Astra scores 0.29, C2's Opus 0.26 and C3's Astra 0.46 against Neon, all under 0.6, so plain-8's 0.27 false blockers per bug PR against /review's 0.06, and C3's false blockers, are descriptive too. No verdict above changes, because none is a KEEP. Details: [the correction](../../../corrections/2026-11-25/README.md).

**Blinding check.** GPT-6 Astra guessed the arm from 20 packets per comparison, and more than 70% correct fails. ship vs /review 11/20 (AUC 0.665), ship vs plain-8 12/20 (0.885), /review vs plain-8 13/20 (0.915), C2 11/20 (0.565), C3 10/20 (0.725). None failed. The high AUCs come from finding counts, which blinding can't hide (7.2 against 2.7 findings per packet in /review vs plain-8). File: [results/blinding.json](results/blinding.json).

**Clean no-gstack arms.** All three plain arms are clean. Audit summaries are in [results/clean-arm-audit/](results/clean-arm-audit/).

- **C1 plain-8:** 0 Skill calls in 534 sessions. The 22 calls outside the unit's path are throwaway sandboxes built from gstack's own repo source on the gstack units 3526, 3524 and 3431.
- **C2 plain Sol:** 22 sessions used project skills that the unit repos ship themselves. The two "review" Skill calls returned "Unknown skill: review". One search of ~/.gstack and ~/.claude/skills on gbrain#7901 returned nothing.
- **C3 plain:** the read audit flagged 29 sessions. All are reads of the unit's own repo files under /workspace (gstack, harness-evals#206, gbrain#7901), with 0 skill opens and 0 helper runs, and the wrapper log says "gstack: none" on all 178 sessions.

**Pipeline check.** Stage 1 rescored through this pipeline gives exactly stage 1's re-judge numbers: /review vs plain-1 +18.5 [+9.1, +28.2], guards -0.07 and +0.04 ([results/score/defect-excl/sanity.txt](results/score/defect-excl/sanity.txt)).

## For gstack's maintainers: per-harness specifics

All at gstack 1d3c63c5 (v1.99.3.0).

**Claude Code + Opus 5.5 (C1)**

- /ship's panel started its readers in 96% of passes. Of the 7 gate misses, 6 were passes with no design reader, and 1 skipped the adversarial, data-migration, red-team, security, state-machines, targeted and testing readers. Its recall is below /review's on the same bugs, so more readers are not buying recall.
- /review's recall edge over one plain pass is matched by more plain passes at the same spend: 1, 2, 4 and 8 plain passes give 25.9%, 36.1%, 39.8% and 44.4% blocking recall, and 8 passes equal /review. Its case is precision: 0.07 decoy false alarms against plain-8's 1.00.

**Claude Code + GPT-6.1 Sol (C2)**

- 3 passes never opened the skill, and 11 passes that passed the gate ran no specialist reader (strict 90.3%).
- Severity inflation: under /review, Sol labels 82% of findings CRITICAL (456 of 557), so "blocking" stops meaning blocking. The thing to look at is the severity guidance /review gives a GPT host.
- kubernetes-sigs/kueue#11855: Sol stopped to ask for acknowledgement of kueue's AGENTS.md disclaimer, and the plain sessions returned nothing there too. This is a repo-instruction effect, not a refusal.
- 8 sessions were lost when the OpenAI stream ended with no usage record (6 /review and 2 plain). This is a known upstream problem where the Responses stream ends with no final event after a connection reset (QuantumNous/new-api#7059, earendil-works/pi#5526).
- gbrain#7878 /review pass 1 stopped at the $40 per-session allowance guard after $7.97 was recorded. It is treated as a gap.

**OpenClaw + particle-1 (C3)**

- particle-1 opened the /review skill in 150 of 151 readable passes. It tried to start reader subagents, and OpenClaw refused at least one start in 130 passes. 81 passes started no reader at all, and no reader report came back in any pass (strict 0/151).
- **Transcripts flagged as "tampered" are a harness artifact.** particle-1's API returned 429 "the serving fleet is at capacity; Retry-After: 1 seconds". OpenClaw's same-model retry then appended user rows ("Continue the current task from the existing transcript..." 229 times, "[Queued user message from a previous active turn...]" 38 times), and our exposure parser flags any user row after the first assistant row as tampering. 40 of the 50 flagged sessions still ended with a final answer; 10 ended on the 429.
  - Upstream: openclaw/openclaw PR 139397 (rate-limit recovery, in OpenClaw 2026.9.5), with follow-ups 183206 (open), 177050, 165593 and 160803, and issues 155018 and 151962.
  - Our parser should recognise these continuation rows. The 50 transcripts were not re-parsed for grading, because a re-read that could change a verdict wasn't in the plan.
- 5 /review outputs couldn't be parsed. They are gaps.

## Spend

Paid spend by ledger item is kept in the private repository (spend-internal.md in the parent folder). The cost that matters for the result, cost per review, is in the plain-curve table above.

<details>
<summary>Deviations (24)</summary>

From the runs:

1. The VMs cloned harness-evals units from stage 1's git bundle, because a direct clone failed.
2. depth-ship-panel.json is sha256 e918ce86, not the pinned 0c2a436b. Its content matches the preregistration's summary, and the C1 ship gate was read from it.
3. Trial image digests differ per VM (C1 3dcd3465, C2 1bf717cf), built from the same recipe 23a3fc298a72.
4. The C3 driver path was fixed (c3-run.ts sha256 55d09042) before the C3 grid.
5. Plain-8's passes 3 to 8 ran as p1 to p6 in a new run.
6. C2 went over its line (+32.3% projected), and its owner approved $1,450. It finished at $1,254.10 including unreported calls.
7. C2 ran 8 parallel sessions instead of 4.
8. Lease reservation stops: C1 plain-8 and C2 each hit the rig's per-round reservation cap with 120 and 20 cells unstarted, and resumed at 2 parallel sessions with nothing rerun.
9. The fan-out control script was edited mid-run (its quota variable).
10. The controllers hit a 6-hour background limit and were re-attached.
11. The pinned VM runner has no quota preflight, and the VMs were already up.
12. C2's final pull was incremental and checked by sha256.

From grading:

13. The severity map gained two labels ("non-blocking (scalability)" and "question", both INFORMATIONAL) in [results/severity-map-stage2.json](results/severity-map-stage2.json) (sha256 bc1daa4d). The plain arms' arm.json was copied with only the severity map changed.
14. The preregistration doesn't say how to treat missing sessions, so both treatments are reported. The pinned scorer gives NO VERDICT on an arm marked stopped.
15. The plain-k arms were built with the grader's own merge script (the window rule) instead of merge-arms.ts, so sessions that were already judged are reused. Plain-1 reproduces stage 1's plain arm exactly.
16. The ingest used digest-only ids for four arms (W8, N6, P4, P8).
17. Each matching run had its own ledger item, and the approval source text had "$" stripped.
18. The ledger allows one open lease at a time, so adjudication ran cell by cell. Three attempts failed before spending and one was cancelled. The proxy left leases open, and they were closed by hand.
19. The blinding check's first attempt ran out at a $1.30 lease and hit a guess-label validation error. It was rerun at a $6.50 lease.
20. Matching-only items used a copy of the label builder.
21. The tool judge ran at concurrency 8 for C1 and C2.
22. The preregistration names 4 blinding comparisons. We ran 5, adding ship vs /review, with a ship-panel blinding instruction written at grading.
23. The C3 transcripts flagged as tampered were not re-parsed.
24. C2's decoy guard uses Opus's adjudication, the judge that failed its check on bug-PR items. The pinned scorer demotes only bug-PR false blockers. C2's "no gain" holds without the guard, because any-severity recall doesn't rise.

</details>

<details>
<summary>Mechanics</summary>

- Arms (blinded ids): C1 ship-panel K4, plain passes 3 to 8 W8, stage 1 /review T5, stage 1 plain M2. C2 Sol /review R3, plain N6. C3 /review V2, plain J9. Plain-k arms P1, P2, P4 and P8 are built from M2 plus W8; P8 is one pass made of all 8 plain sessions.
- C1's /review and plain passes 1 and 2 are stage 1 sessions. The ship-panel and plain passes 3 to 8 ran in stage 2 on the same model and image recipe.
- Findings: K4 1,001 (180 CRITICAL), W8 1,465 (274), R3 557 (456), N6 393 (121), V2 521 (87), J9 616 (78).
- Unmatched blockers adjudicated: C1 277, C2 452, C3 99. Primary rulings: C1 Astra 210 defect, 30 not-defect, 37 can't-tell. C2 Opus 297, 118, 37 (Astra 412, 18, 22). C3 Astra 72, 18, 9.
- Scoring: scripts/review-bugs/score-mc.ts with --mdd 18, seed 2665, 10,000 draws, --exposure var=pass and --kappa per cell. The 20 home-field units are always dropped. With gaps dropped, every unit where either arm has a missing session is dropped too ([results/score/defect-excl/gap-units.json](results/score/defect-excl/gap-units.json)).
- Gap units: K4 1 (gstack#3567, home field), R3 6, N6 2, V2 20, J9 17. C2 dropped 3 bug PRs and kueue#11855 (a decoy). C3 dropped 14 bug PRs and 6 decoys.
- Every counted step ran from a worktree pinned at 2509bc8d, the Amendment 4 commit on this branch.

</details>
