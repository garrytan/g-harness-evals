# Preregistration: does /ship's review panel, or more plain passes, beat gstack's /review, and does /review help other models? (stage 2)

**Status:** frozen for stage 2 when this file merges to main. Stage 1's preregistration is [../PREREGISTRATION.md](../PREREGISTRATION.md).

**Takeaways:**
- **We test three things stage 1 could not.** Whether /ship's review panel catches more real bugs than /review, whether running a plain review prompt up to 8 times matches /review for less money, and whether /review helps GPT-6.1 Sol in Claude Code and particle-1 in OpenClaw the way it helped Opus 5.5.
- **We also re-judge stage 1's false alarms with a better method.** Stage 1's judges saw 61 lines per finding and could not tell real bugs from noise (their check failed, kappa 0.012). Now the judges read the whole repository at the PR head, and a 20-finding dry run already disagreed with stage 1's judges on 19 of 20. The rule for how that changes stage 1's verdict is fixed below, before any counted re-judging.
- **A null here can't rule out effects smaller than about 18 points** on the 54 outside bugs, so a tie is never read as "no difference".

## The question

On the same 54 real blocking bugs from outside repos (plus the 20 home-field units and 15 no-bug decoys, reported apart), with no gstack installed in the plain arms:
1. Does /ship's review step (the plan gstack-review-plan prints, run once) flag more of them than /review?
2. Does plain Opus 5.5, merged over 1, 2, 4 and 8 passes, match /review's recall at the same or lower spend?
3. Does /review beat a plain prompt on GPT-6.1 Sol in Claude Code, and on particle-1 in OpenClaw?
4. With judges that can read the code, are /review's extra blocking findings in stage 1 mostly real, or mostly noise?

"Blocking" follows R12: the bug would fail a test, break production, or lose data or secrets.

## What each result changes (R97)

Approved by Garry on 2026-11-15 ("do it"), word for word:

| Outcome | What we do |
| --- | --- |
| **Re-judge:** /review's extra blockers mostly real (false-blocker gap within +0.5) | Stage 1's verdict becomes a full KEEP, and /review stays as it is. |
| **Re-judge:** mostly noise (gap over +0.5) | Stage 1 becomes FIX-METHOD by the prereg's rule. gstack's maintainers get a precision brief naming the readers that produce the noise, and /review stays until that's fixed, because nothing cheaper has been shown to be better. |
| **plain-8 against /review at the same spend:** plain-8 matches or beats /review | The factory's default review for outside code becomes repeated plain passes, and gstack's maintainers hear that /review's structure adds nothing beyond spend. |
| **plain-8 against /review at the same spend:** /review clearly ahead | /review stays, with evidence that its structure matters. |
| **ship-panel:** beats /review | The panel stays on every PR as now. |
| **ship-panel:** ties /review | /ship's panel is replaced by /review, which cuts review cost on every PR. |
| **ship-panel:** loses to plain-8 | Cut candidate, and Garry hears it in plain words. |
| **C2 Sol:** gain | /review's KEEP holds on GPT-family models too. |
| **C2 Sol:** no gain | /review's value is Claude-only, and gstack's maintainers get Sol's specifics. |
| **C3 particle-1 in OpenClaw:** gain | gstack keeps its single-agent OpenClaw /review. |
| **C3 particle-1 in OpenClaw:** no gain | gstack's maintainers hear that this /review adds nothing on OpenClaw, and particle-1 lanes don't rely on it. |
| **Every verdict** | The blinding check's AUC is reported beside it, because blinding can't hide how many findings each arm writes (stage 1's AUC was 0.935). |

## Amendments

Stage 1's three dated amendments, as recorded before each affected step. Amendment 3 sets this stage's adjudication method and the stage 1 re-judge rule.

### Amendment 1, 2026-11-15 (before any paid trial)

Decided by the runner before the first paid session of stage 1. Paid spend at the time of the decision: $0. No VM had been created. This amendment was recorded with stage 1 and is carried here (R77).

1. **One counted unit is dropped, and nothing replaces it.** The unit is spiceai/spiceai#13884@34a4b9da43f9 (S2-openai, rank 42). GitHub no longer serves the PR: GraphQL returns NOT_FOUND and the web page is a 404. Only refs/pull/13884/head is still there. GH Archive payloads from 2026 carry no title or body. So the unit can't get the PR title and first-version description that the prereg shows every arm. We drop it rather than write in a placeholder description, which would break that rule. The counted set becomes 54 non-gstack units (S1 12, S2 39, S3 3), plus 20 H and 15 decoys. The MDD is recomputed on the counted units, as the prereg already says.
2. **Two depth.ts fixes, in a scratch copy outside the pinned tree.**
   - gstack-diff-scope exits 2 (SCOPE_ERROR=unmatched) on Project-N-E-K-O/N.E.K.O#2157's pkgbuild/PKGBUILD. /review runs that helper with `|| true`, so the copy accepts that exit the same way.
   - The copy deletes each throwaway unit repo after use, because the first run filled the disk.
   Neither fix changes any prompt, grader or arm. Both only affect the expected-reader counts the exposure gate uses.
3. **microsoft/openvmm#3858 is rebuilt from a normal full clone.** That is what the prereg calls for. A bare clone had given it a false canary failure.

### Amendment 2: skill-opened detection, 2026-11-15 (after the smokes, before the C1 grid)

**What happened.** C1's 3-session exposure smoke came out 0/3 under the pinned exposure.ts, because it never detected the skill being opened. Under the stage 1 prereg's literal rule (its line 73), that stops C1 with FIX-METHOD. In all three C1 sessions, every expected reader was dispatched and returned, and the army and the adversarial reader both ran.

**Why the detector missed it.** The rig never logs the /review slash-command expansion, so neither the transcript nor init.json contains the skill body. The pinned detector only accepts three signals: a Skill tool call, a Read of SKILL.md, or a user message that carries the body. In all six C1 and C2 sessions, the main agent's first Bash call was the review skill's own preamble, `gstack-skill-start --skill "review" --model "claude"`, and its result contained `SKILL_START_PROTO: 1`. In gstack 1d3c63c5, `--skill "review"` appears only in review/SKILL.md, apart from two tests. We spot-checked the bifrost C1 transcript: it has the command once and the PROTO line once.

**The rule change.** A main-agent Bash call counts as the skill being opened when two things hold: its command matches `gstack-skill-start --skill review`, and its non-error result has a line starting `SKILL_START_PROTO: `. The patched file is exposure.ts sha256 bdaa5211… (the pin's copy is 35137c6c…), with the diff at stage1/exposure-reread/exposure-amendment.diff on the runner. The existing exposure tests pass on it (45 tests; the amendment said 60, which stage 1's deviation 15 corrected). A no-gstack arm can't satisfy the rule, because it can't print the PROTO handshake. The other three signals and the ≥90% gate threshold don't change.

**What changes in the counts.** Re-reading the same six transcripts, with no paid rerun, gives:
- C1: gate 3/3 and strict 3/3, up from 0/3 at the pin.
- C2: gate 3/3 and strict 3/3, up from 1/3 at the pin.
- C3: unchanged at gate 3/3 and strict 0/3.

The new rule applies to every review-arm PR-pass in the stage 1 exposure gate. The stage 1 README reports both the pinned and the amended smoke outcomes.

**Why this is allowed, and what it can't affect.** This is an instrument fix decided before the affected cell (the C1 grid) started, as crew rules allow. It can't move recall, false alarms or either co-primary. The pinned detector's gap goes to gstack-evals and the gstack maintainers as a per-harness specific: the rig should log the slash-command expansion.

**Also noted.** The C3 smoke ran without the PR description, because harness-review.ts has no --pr-context option. C3 has no grid in stage 1.



### Amendment 3: the stage 1 re-judge and the stage 2 adjudication method, 2026-11-15 (after stage 1's results, before any counted re-judge)

**Why.** Stage 1's adjudication check failed: the blind judges agreed with the fix-aware labels at kappa 0.012 on 48 items (the bar is 0.6 on at least 60). The judges saw only a 61-line evidence sheet per finding, and about 93% of their not-defect rulings said the sheet could not settle the finding. So stage 1's false blockers on bug PRs were descriptive only, and its verdict carries the label "KEEP (recall only; false blockers on bug PRs unmeasured)". Garry approved stage 2, this method included, on 2026-11-15 ("do it").

**The new adjudication method.** It replaces stage 1's judging of unmatched blocking findings for every stage 2 arm and for the stage 1 re-judge.
- **Blind judges.** GPT-6 Astra is primary and Claude Opus 5.5 reads every finding a second time. Each read is a fresh read-only tool session over the unit repo at the PR head, the same tree the reviewers saw, with no later history and no fix. It also gets the PR's title and first description, its full diff against the base (cut at 60,000 characters, with a per-file diff tool for the rest), the finding and the unit's known informational cases. Tools: list a directory, read a file, grep and the per-file PR diff. No execution, no network, and a budget of 12 tool calls. After the budget only the ruling call stays, and a read with no ruling within 3 more turns is asked once more in a fresh session. A session with no accepted ruling after the budget plus 9 turns in all also ends with no ruling, and a read that is asked again reports both sessions' tokens, turns and tool calls.
- **Rulings.** defect, not-defect or can't-tell (plus known-informational, only on a unit that lists a known informational case, as in stage 1). The primary judge's ruling counts. Can't-tell is counted apart and never as a false blocker. Every guard is also reported with can't-tell counted as a false blocker, beside the counted reading. A read that ends with no ruling (a refusal or a safety-filter stop included) is reported as its own outcome and treated like can't-tell in both readings. Refusals and filter stops are results; no model is swapped (R95).
- **Labellers.** Astra and Opus label every unmatched blocking finding, each on its own, with the judges' access plus the known bugs in our words, the fix commits and their diffs, the repo at a later commit of the main branch, the later commits that touch a path, and a budget of 16 tool calls. Labels are defect, not-defect, known-informational or can't-tell. An item both label the same (not can't-tell) becomes a label.
- **Pass bar (R78).** The primary judge's rulings against the agreed labels, with a can't-tell ruling counted as a disagreement: Cohen's kappa of at least 0.6 on at least 60 agreed items. The labellers' own agreement, the second judge against the labels and the two judges against each other are reported beside it.
- **Tooling and briefs.** harness-evals scripts/review-bugs/tool-judge.ts and rejudge.ts, and the briefs docs/benchmarks/2026-11-review-real-bugs/stage2/judging/tool-judge-brief.md and tool-labeller-brief.md, all pinned by sha256 in the stage 2 preregistration. Request settings: OpenAI Responses with reasoning effort medium; Anthropic Messages with no temperature or thinking field; at most 16,000 output tokens a turn. A read that failed for a machine or network reason is read again: rejudge.ts refuses to write adjudication rows while any finding lacks a usable read from the primary judge, and the R78 check fails while any agreed item lacks one.

**The re-judge rule, frozen here before any counted re-judging.**
1. All 204 unmatched blocking findings of stage 1, both arms, decoys and H units included, go through the new method: both judges and both labellers. No trial is rerun, and matching, recall and the co-primaries don't change.
2. The primary judge's rulings become the adjudication rows of both arms (rejudge.ts adjudication), once with can't-tell counted as not a false blocker (the counted reading) and once as a false blocker. Both are scored by the stage 1 pipeline unchanged: ingest --replace, derive with the H units dropped, then score-mc.ts with stage 1's flags and --kappa set by the check below.
3. **If the check passes,** both guards apply and stage 1's verdict is recomputed by the prereg's verdict rule from the counted reading. That can move it from KEEP to FIX-METHOD (recall rose while a guard went over its +0.5 limit). If the two readings give different verdicts, both are reported and the counted reading decides.
4. **If the check fails,** stage 1's label stays "KEEP (recall only; false blockers on bug PRs unmeasured)", and the re-judged guards are descriptive.
5. Old and new figures are reported side by side: stage 1's blind rulings, the re-judged rulings in both readings, and the verdict under each.

**Already seen before this was frozen (disclosed, not counted).** A 20-item dry run on 2026-11-15 (seed 2665; item harn95-s2-dryrun, $34.93 including 2 smoke reads, against a $60 cap) read 20 of these 204 findings with both judges and both labellers, to size the method. Astra ruled 17 defect, 2 can't-tell and 1 not-defect, where stage 1's blind Astra had ruled all 20 not-defect. The labellers' can't-tell rate was 15% (Astra 10%, Opus 20%; Opus's one read on flagos-ai/FlagGems#5915 ended in a safety-filter stop, the same PR as stage 1's L019 stop). They agreed on 15 labels (14 defect, 1 not-defect), and Astra agreed with all 15. The dry-run rulings are never used for counted numbers; the 20 findings are read again in fresh sessions in the counted re-judge. The dry run's first smoke read used tool budgets of 20 and 30, and its second smoke read and the 20-item run used 12 and 16, and a grep that matched nothing returned an error line from the machine's git wrapper instead of "no match"; tool-judge.ts was fixed for that before freeze. Three of the 20 labeller items (10126-F3, 11855-F2 and 11855-F7, on decoy units) ran on an older prompt that listed the decoy's stand-in case as a known bug with an empty fix; rejudge.ts now leaves a decoy with no known bug and no fix, as the labeller brief says, and those three dry-run reads were not rerun.

**A risk stated in advance.** If most unmatched blocking findings turn out to be real defects (17 of 20 in the dry run), the labels will be lopsided, and kappa can stay under 0.6 even with high raw agreement, because a few disagreements on the rare class weigh heavily. The rule above stays as written: the check is kappa at least 0.6 on at least 60 agreed items, and raw agreement is reported beside it.

## What's different from stage 1 and the approved plan

- **plain-2fam is dropped.** It controlled for the Sol outside voice inside /review, and that voice never runs in the rig (no bubblewrap in the trial image), so there is nothing to control for.
- **C4 (DeepSeek V4 Pro in Hermes) stays dropped.** Our metering proxy can't meter it.
- **Stage 1's C1 plain and review arms are reused, not rerun.** plain-8 adds 6 plain passes per unit to stage 1's 2, and every stage 2 comparison against /review on Opus uses stage 1's review arm.
- **Adjudication changes** (Amendment 3): tool-using blind judges, a can't-tell ruling, and tool-using fix-aware labellers.
- **Cross-family judges (R78).** Astra is the primary judge for the Claude runs (C1) and for particle-1 (C3), with Opus as the second read. For GPT-6.1 Sol (C2), Opus is primary and Astra second, because a judge must come from another family than the system under test.
- **C3 now sees the PR description.** harness-review.ts gained --pr-context, which tells the same PR block the Claude Code cells see (gstack-evals #344's template, sha256 f52ecea7...).
- **The ship-panel exposure gate reads /ship's own preamble.** exposure.ts gained --skill ship: a main-agent Bash call to gstack-skill-start --skill ship whose result has a SKILL_START_PROTO line counts as the skill open, the same rule Amendment 2 set for /review.

## Can /ship's review step run with no remote, push or PR?

Yes, with no change to gstack. We ran the pinned gstack-review-plan on all 89 counted units, each built the way the rig builds it (the head's ancestry, a local base branch and origin/<base> at the merge base, no remote). Every unit printed a plan and exited 0. /ship's Step 9 reads only that plan and git diffs against origin/<base>; Step 10 checks for a PR and skips when there is no GitHub remote ("PR: skip"); Step 11 runs the voices the plan lists. The rig already ran this arm once on a toy PR (rig/README.md): it dispatched exactly the planned readers and made no commit, push, version bump or PR.

**The printed plans** (gstack 1d3c63c5, claude host, 89 units):

| Depth | Units | Readers the plan dispatches |
| --- | --- | --- |
| light | 45 (31 outside, 2 home-field, 12 decoys) | adversarial-native and one batched specialist (2 readers) |
| full | 44 (23 outside, 18 home-field, 3 decoys) | adversarial-native, batched and red-team (15 units); the same plus the targeted reader (29 units) |

- That is 2.8 readers per unit on average, against 6.6 for /review's Review Army on the same units.
- On all 44 full-depth units the plan also lists the outside voice. It can't run in the rig (no bubblewrap), as in stage 1, so it is never an expected reader.
- **How the rig drives it:** gstack-evals review-units with the ship-panel told line (rig/told-ship-panel.txt, sha256 6d172ca6...), in its own launch with no reader map, at stage 1's common flags plus --pr-context. Its readers are read from transcripts by exposure.ts.

## Pins

| What | Pin |
| --- | --- |
| gstack under test | 1d3c63c53d17faf0456c564bc5950f18b370d0ef (stable, v1.99.3.0), every cell |
| gstack-evals (rig and noloss scorer) | 064c7f18857e6d1850cfb1f69e87e60812b85933 |
| Counted suite (89 units) | sha256 827929af7ce3818e6f5cd6c5fbfb1dec82976161160d59fd61d6d9e2d0319ed1 (private until results) |
| Counted units list | sha256 14380e1da43bca0b96180dd4bd962b05f5204f0e163a4ebf0683c809711a805f (private) |
| PR text for every unit (89 pr.md files) | manifest sha256 bd3e1a8ae2e9dc6457ab798e9aef20b1a7ae653816c61ed1d57f66780657d6f4 (private) |
| Severity map | stage 1's extended map, sha256 a048c9ab2847af2bb3db8ff2b98a41880538b7e379d3fba2aad6d15c96ea0d09 (rig/severity-map.json plus 3 plain labels, stage 1 deviation 10) |
| Reader map | rig/reader-map-gstack-1d3c63c53d17.json, sha256 98f4aa9071bd9a4ccd992e5d9558852040507a8314f83eaf2096aac54f3ef8af |
| /review expected readers (C1, C2) | stage 1's expected-claude.json, sha256 6c54802baeca7992ace617af61b0a04d0770d085c11d5f8222dfbd110416161c (private) |
| ship-panel printed plans | depth.ts --ship-panel output, sha256 0c2a436bd3f67fd2e50b37f00e6720b963c6467a9922ac11c9c899558edf8f5b (private; gate list summarised below) |
| Stage 1 re-judge inputs | adjudication key sha256 0a6ef7663908a559d1265d937efb8b243fba4fdee66964cfdd6146f685edf38a (batch b01d4904...), items key sha256 ec37dc797f205b21d2fecbd54cc7582faa1f6d846b742621a948a7db922f1b70, stage 1 score sha256 e4892fc82d0529dd068d722a41d6403b185208cb396e6f6b470f98a2eaa061a8 (all private) |
| Models | claude-opus-5-5 (Anthropic), openai/gpt-6.1-sol (OpenRouter, in Claude Code), particle-1 (OpenClaw overlay at 1d3c63c5); judges gpt-6-astra and claude-opus-5-5 |

Code and briefs in this repository, by sha256 at this commit:

| File | sha256 |
| --- | --- |
| scripts/review-bugs/tool-judge.ts | 1da25d30c51436d33160f18291b817673e050bfaf6958120b5dcf7df1147f20a |
| scripts/review-bugs/rejudge.ts | 5f730165cbb6f081f5c3f0123f699cf5f4311cfc67b1d6aec38773ad8d029fa8 |
| scripts/review-bugs/exposure.ts | ccf67973d40abfc040a192281d7a7863bdb8c5c55a24bd61c49858d4f5eee231 |
| scripts/review-bugs/depth.ts | 20704255421884667ac4b777d96abba79afe4a9df9906681b8170a4aa478db60 |
| scripts/review-bugs/harness-review.ts | bc0344d5a5e254fbc636e496dbd062f947f41d43c51b3ea35f11c83dafd92cc4 |
| scripts/review-bugs/told.ts | e2b5835adc1ff6d495b5ceeaf1fb063fdb83b7b64ba9be8f1afc63caf33b794e |
| docs/benchmarks/2026-11-review-real-bugs/stage2/judging/tool-judge-brief.md | d1edc8d90ae599142e38bc254cdff26c4839b0091a075252b130ed9b3c813c60 |
| docs/benchmarks/2026-11-review-real-bugs/stage2/judging/tool-labeller-brief.md | 37c1b316416b4f4f2474612f35015ef6f6196a36293cd22ae76ec17e07f43f27 |
| docs/benchmarks/2026-11-review-real-bugs/rig/told-ship-panel.txt | 6d172ca6f4069dc36b4fe454af6dbebb6899f42f78e1c6630d412ec29e1a3e32 |
| docs/benchmarks/2026-11-review-real-bugs/rig/told-review.txt | c6334bf77190ad4db057100d5e3e0b1ee27b454215739474e89a5e0cc7c93482 |

## Arms and cells

All arms run on the same 89 units at 2 passes, unless the row says otherwise.

| Cell | Arm | Passes | New sessions | Told line |
| --- | --- | --- | --- | --- |
| C1 Opus 5.5 in Claude Code | plain (stage 1) | 2 | 0 | none |
| C1 | review (stage 1) | 2 | 0 | rig/told-review.txt |
| C1 | **ship-panel** | 2 | 178 | rig/told-ship-panel.txt |
| C1 | **plain-8** | 6 more, 8 in all | 534 | none |
| C2 GPT-6.1 Sol in Claude Code (OpenRouter) | plain, review | 2 each | 356 | as C1 |
| C3 particle-1 in OpenClaw | plain, review | 2 each | 356 | told.ts, with --pr-context |

- **plain-8** is scored as a curve: passes 1, 2, 4 and 8, each point merged into one pass (a bug counts as found if any merged pass found it), against /review's 2 passes.
- **Clean arms (R44).** Every plain arm runs with no gstack installed and no Capy drive mounted, and its file reads are audited as in stage 1.
- **Runs.** Each cell runs as one shard on one Ubicloud VM, never split across machines, with a 2-unit canary that must score and copy its results off the VM before the rest starts.

## Adjudication and judge checks

- **Matching** (which findings hit a known bug) is unchanged from stage 1: noloss judge-run and judge-join at the pinned rig. Stage 1's matching check passed (kappa 1.00 on 111 items) for Astra as primary. C2's primary matcher is Opus, so C2 gets its own 60-item matching label check before its numbers count.
- **Unmatched blocking findings** are judged by the method in Amendment 3, for every stage 2 arm and for the stage 1 re-judge. The R78 check runs per primary judge on at least 60 agreed labels (kappa at least 0.6, can't-tell counted as a disagreement). If it fails, that cell's false blockers on bug PRs are descriptive and only the decoys guard its verdict, as in stage 1.
- **Blinding check.** For each comparison, Astra guesses the arm on 20 packets (seed 2665); more than 70% correct is a blinding failure. Its AUC is reported beside every verdict, because blinding can't hide how many findings each arm writes (stage 1's AUC was 0.935).

**What the 20-item dry run showed** (seed 2665, not counted; Amendment 3):

| Read | Rulings (defect / not-defect / can't-tell / none) | Cost per read | Input tokens per read (cached share) | Output tokens per read | Tool calls per read |
| --- | --- | --- | --- | --- | --- |
| Judge, Astra | 17 / 1 / 2 / 0 | $0.58 | 95,900 (59%) | 584 | 9.0 |
| Judge, Opus | 15 / 2 / 3 / 0 | $0.23 | 156,900 (78%) | 1,744 | 5.7 |
| Labeller, Astra | 17 / 1 / 2 / 0 | $0.55 | 133,800 (75%) | 614 | 9.6 |
| Labeller, Opus | 15 / 1 / 3 / 1 safety-filter stop | $0.33 | 233,600 (78%) | 1,905 | 7.2 |

- The labellers answered can't-tell (or ended without a ruling) on 15% of their reads, under the 40% that would have stopped stage 2. They agreed on 15 labels (14 defect, 1 not-defect), and the primary judge matched all 15. That is too few items for the check, which needs 60.
- Stage 1's blind Astra had ruled all 20 of these findings not-defect.
- A full read of one finding (two judges and two labellers) cost $1.69.

## Exposure gate

- **Signals and the gate** are stage 1's: the skill opened, and every expected reader dispatched and returned, in at least 90% of an arm's PR-passes, with exposure.ts at this commit (Amendment 2's skill-open rule; --skill ship for the ship-panel arm).
- **Expected readers:** /review on C1 and C2 uses stage 1's expected-claude.json. C2 runs Sol through Claude Code, so it is the claude host. C3 is single-agent /review on OpenClaw, so its gate is the skill open alone, as in stage 1.
- **ship-panel:** the expected readers come from each unit's printed plan (depth.ts --ship-panel, ship_panel_gate): every checklist a dispatched reader carries, because exposure.ts counts a launch that names two or more checklists as covering each, plus adversarial-native where the adversarial line carries none. The outside voice and readers beyond the plan don't count as misses. Across the 89 units the gate lists 5 to 8 readers (mean 5.6): adversarial-native, red-team, security, state-machines and testing on every unit, the targeted reader on 29, design on 11, api-contract on 7 and data-migration on 2. Because the light plan's batched reader carries the red-team checklist too, red-team is expected on every unit.
- An unreadable transcript is a gap, never counted as exposed or not.

## Numbers and verdicts

- **Co-primary**, per comparison, on the 54 outside bugs (52 PR clusters): the blocking recall difference and the any-severity recall difference, with a 95% PR-clustered interval and a sign-flip test (10,000 seeded Monte Carlo draws, seed 2665), Holm-adjusted together within each comparison. Scored by scripts/review-bugs/score-mc.ts as in stage 1. H and the decoys are reported apart.
- **Guards**, as in stage 1: false alarms per decoy PR and false blockers per bug PR, paired, limit +0.5 per PR, with can't-tell counted as not a false blocker and the other reading beside it.
- **How each row of the outcome map is read:**
  - **Re-judge:** "mostly real" when the re-judged false-blocker gap (review minus plain, counted reading) has its 95% upper bound within +0.5; "mostly noise" when it is over. The verdict rule is Amendment 3's.
  - **ship-panel against /review:** "beats" when the blocking recall interval (ship-panel minus /review) is above zero and the guards hold; "ties" when the interval includes zero; "loses to plain-8" when the ship-panel minus plain-8 interval is below zero.
  - **plain-8 against /review:** plain-8 costs about half of /review's 2 passes per PR (stage 1: $0.54 a plain session, $4.49 a review session), so "the same spend" is read at plain-8, the dearest plain point. "/review clearly ahead" when /review minus plain-8 is above zero; "plain-8 matches or beats" when that interval includes or is below zero. The whole curve (1, 2, 4, 8) is reported with cost per PR.
  - **C2 and C3:** "gain" when review minus plain is above zero with the guards holding (a KEEP by stage 1's rule); "no gain" otherwise, with the interval and the MDD beside it.
- **A tie is never a "no difference" claim.** Every interval is reported with the MDD below.

## Sizing

- noloss power (scripts/review-bugs/power.ts, 2 passes, 2,000 simulations, seed 1, alpha 0.025 one-tailed, power 0.8), on the counted suite's PR clusters:

| Bugs scored | PR clusters | Lower arm's rate | MDD (points) |
| --- | --- | --- | --- |
| 54 outside bugs (the verdicts) | 52 | 25.9% (stage 1 plain) | 17 |
| 54 outside bugs | 52 | 30% | 18 |
| 54 outside bugs | 52 | 44.4% (stage 1 /review, for ship-panel against it) | 18 |
| all 89 units, H pooled (86 bugs; decoys have none) | 71 | 25.9% | 13 |
| all 89 units, H pooled | 71 | 44.4% | 14 |

- So on the 89 units' counted outside bugs, a comparison can only show a difference of about 17 or 18 points or more. The H-pooled rows are for reading only; H never enters a verdict.

## Stop rules

- **Smokes first.** Each new cell (ship-panel, C2 review, C3 review with the PR text) runs a 3-session exposure smoke, and its grid starts only after 3 of 3 pass. A cell that fails stops with FIX-METHOD.
- **10-unit cost check.** A cell whose projected cost from its first 10 units runs more than 30% over its line below pauses for the coordinating agent.
- **No reruns to change a verdict.** No paid session is rerun for that.
- **Refusals are results.** A model that refuses a review, a judging or a label read is never swapped (R95). Safety-filter stops are reported as their own outcome.
- **The $7,400 cap** covers all of stage 2's paid spend, the dry run included.

## Spend

The approved budget was about $5,150 expected with a $7,400 cap. The lines below are re-priced from stage 1's measured costs and the dry run's $1.69 per fully read finding (about $0.81 for the two judges and $0.88 for the two labellers).

| Line | Basis | Expected |
| --- | --- | --- |
| C1 ship-panel, 178 sessions | stage 1's /review, $4.49 a session (the toy smoke was $2.33) | $800 |
| C1 plain-8, 534 sessions | stage 1's plain, $0.54 a session | $290 |
| C2 Sol plain and review, 356 sessions | stage 1's Sol smoke, $4.64 a review session; plain at about $0.50 | $915 |
| C3 particle-1 plain and review, 356 sessions | stage 1's C3 smoke, $0.23 a session | $85 |
| Exposure smokes (ship-panel, C2, C3) | 9 sessions | $30 |
| Matching (noloss judge-run) for the new arms, and C2's matching label check | stage 1's $19.11 for 2 arm-equivalents; 8 more arm-equivalents | $105 |
| Adjudication, both judges and both labellers, about 702 new unmatched blocking findings | stage 1's rate per session (/review 0.89 on 534 review-style sessions, plain 0.25 on 890 plain ones), $1.69 a finding | $1,190 |
| Stage 1 re-judge, 204 findings | $1.69 a finding | $345 |
| Blinding checks, 4 comparisons | stage 1's $0.21 each | $5 |
| Judge dry run (spent) | item harn95-s2-dryrun | $35 |
| Ubicloud VMs | stage 1's VM was $9.53 for 19 hours | $40 |
| **Total paid, expected** | | **about $3,840** |

- If every ship-panel and C2 review session cost R2's $6.52 (stage 1 measured $4.49) and there were 30% more findings to judge, paid spend would be about $4,900. Both are under the **$7,400 cap**.
- Our own model use (building, the /ship passes, reports) is on Capy's meter, not in these lines.

## Results PR

One results PR at the end holds stage 1's and stage 2's results together, so this experiment makes three PRs in all: stage 1's preregistration (merged), this stage 2 preregistration, and the results. Why three:
- Stage 2 needs its own freeze. Its arms and its adjudication method were approved only after stage 1's results, and the re-judge rule has to be on main before any counted re-judging.
- A preregistration and its results never share a PR, or the order check on main breaks.
- Stage 1's results were never published on their own, so folding them into the one results PR keeps the count at the smallest it can be (R77), with each run's commits kept by a merge commit.

## Outside terms

As in stage 1: only repos under OSI licences, units referenced by URL and commit, bug descriptions in our own words, no third-party review text copied, and no contributor names published.
