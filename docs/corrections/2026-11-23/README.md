# Correction of 2026-11-23: with stronger tests, Fable 5.2's lead over Opus 5.5 is a little larger and each extra solve costs about $26, not $31

**We learned that the tests behind the Fable 5.2 vs Opus 5.5 result let some wrong fixes pass, and more of those were Opus 5.5's.** We wrote stronger tests for all 107 real GitHub issues, rebuilt every try's final code from its recorded session, and graded it again with no new model runs. Fable 5.2 now solves 67.8% of tries against Opus 5.5's 59.8%: a lead of **+7.9 points [+1.9, +14.0]**, up from +6.5 [+0.9, +12.6].

**You should read the price of an extra solve with Fable 5.2 as about $26 (95% range $14 to $99), not $31 ($16 to $151).** The cost ratio barely moves (2.42x against 2.49x). The report's other answer stands: Fable 5.2's lead is no bigger on issues that don't say where the bug is (interaction -3.4 points [-15.5, +8.4], still disproved).

This correction is about the fable-diagnosis report (pull request #475). Every number here is rebuilt keylessly from committed receipts by `bash scripts/corrections/reproduce-2026-11-23.sh <scratch dir> --check`, which compares its output with [sensitivity.json](sensitivity.json). Nothing under docs/benchmarks/ was edited: the report, its labels and every trial record are byte-identical.

## What changed, in one list

1. **The headline numbers (corrected).** Graded on the task's own tests plus the stronger tests, Fable 5.2 minus Opus 5.5 is +7.9 points [+1.9, +14.0], and each extra solve costs $25.81 [$13.92, $98.82].
2. **Why they moved.** 11 tries that passed the original tests fail the stronger ones: 7 of Opus 5.5's 135 recorded passes and 4 of Fable 5.2's 149. All 11 are among the 133 and 147 passes whose replay reproduced; the other 4 recorded passes, 2 per model, keep their pass whatever the replay shows (section 4).
3. **A read-corrected line (sensitivity, new).** Counting also the failing tries that two readers from different model families both called a correct fix failed only by a test flaw, the lead is +9.3 points [+3.7, +15.0] at $21.94 [$12.89, $56.72] per extra solve. The two readers agree only moderately, so this line is not the corrected number.
4. **The diagnosis answer (unchanged).** The interaction stays below zero in every reading, so the preregistered prediction stays disproved.

## 1. The corrected numbers

| Reading | Tasks | Fable 5.2 | Opus 5.5 | Difference [95%] | Cost ratio [95%] | Extra cost per extra solve [95%] | Interaction [95%] |
|---|---|---|---|---|---|---|---|
| As published | 107 | 69.6% | 63.1% | +6.5 [+0.9, +12.6] | 2.49x [2.20x, 2.80x] | $31.34 [$15.92, $150.61] | -0.8 [-12.1, +10.7] |
| **Stronger tests (corrected)** | **107** | **67.8%** | **59.8%** | **+7.9 [+1.9, +14.0]** | **2.42x [2.12x, 2.76x]** | **$25.81 [$13.92, $98.82]** | **-3.4 [-15.5, +8.4]** |
| Stronger tests plus both reads (sensitivity) | 107 | 81.3% | 72.0% | +9.3 [+3.7, +15.0] | 2.43x [2.16x, 2.72x] | $21.94 [$12.89, $56.72] | -2.2 [-14.0, +9.4] |
| Stronger tests, without the 4 tasks whose replay missed | 103 | 67.0% | 58.7% | +8.3 [+1.9, +14.6] | 2.41x [2.09x, 2.73x] | $24.61 [$13.21, $89.09] | -3.1 [-15.8, +8.9] |
| Stronger tests plus both reads, without those 4 tasks | 103 | 80.6% | 71.4% | +9.2 [+3.4, +15.5] | 2.43x [2.15x, 2.72x] | $22.02 [$12.49, $61.24] | -1.0 [-13.2, +11.5] |

- **How to read it.** A pass rate is the share of tries that passed, averaged over each model's two tries per issue. Every difference is paired by task with the report's own code (`feature-split.ts`, seed 20261114, 10,000 draws), and cost is the run's recorded spend, so only the grades changed.
- **Cost per solve.** With the stronger tests, a solved try cost $4.76 with Fable 5.2 and $1.96 with Opus 5.5 (published: $4.63 and $1.86). Fewer solves make each one dearer for both models; Opus 5.5 lost more, so the gap per extra solve narrows.
- **Per group, stronger tests.** On the 49 issues that name no file the fix changes: +6.1 points [-2.0, +13.3], $34.87 per extra solve (no range: some draws have no extra solve). On the 58 that name one: +9.5 [+0.9, +19.0], $20.86 [$9.53, $112.08]. Fable 5.2 was lower on 7 tasks, the same on 81 and higher on 19 (published: 6, 85, 16).
- **Smallest detectable difference.** On all 107 tasks it is 8.8 points with the stronger tests (published: 8.1). The +7.9 is below it, but its 95% range still excludes zero.

## 2. Which passes the stronger tests reject

The 11 recorded passes whose replay reproduced and that fail the stronger tests:

| Task | Model, try | What the stronger tests catch |
|---|---|---|
| rest-sh/restish#337 | Fable 5.2 a1, a2; Opus 5.5 a1, a2 | every patch crashes (nil pointer) on a 204 response that carries stray gzip bytes |
| gotd/td#1759 | Opus 5.5 a1, a2 | a negative sticker index is not an error, though the issue says invalid indexes must not select a sticker |
| mvanhorn/cli-printing-press#1920 | Opus 5.5 a1, a2 | `stale` misses a date-time field from the spec whose name isn't on the hard-coded list, the breakage the issue describes |
| astral-sh/ruff#25414 | Opus 5.5 a1 | `# x = [  # noqa: ERA001` still reports its noqa as unused, the same contradiction the issue names |
| cloudflare/vinext#1574 | Fable 5.2 a1 | no default Cache-Control when getServerSideProps sets other headers |
| nesquena/hermes-webui#3069 | Fable 5.2 a2 | a project's own cron sessions don't show in that project's view, which the issue asks for |

Both blind readers (section 3) called 2 of these 11 correct fixes that a stronger test wrongly rejects: vinext#1574 Fable 5.2 a1 and td#1759 Opus 5.5 a1. The corrected reading counts them as fails; the read-corrected line counts them as solved. The per-task test reads and every failing log are in the raw archive (below).

## 3. The read-corrected line, and why it is not the correction

The stronger tests only add checks, so they can catch a wrong fix that passed but cannot rescue a correct fix that a test wrongly rejects. To size that second kind, two readers read every try that failed either set of tests, without being told which model wrote it: Claude Opus 5.5 and GPT-6.2 Astra. Each saw the issue, the gold fix, the test reads, the try's diff and its failing test output, and called it a correct fix failed only by a test flaw, wrong or incomplete, or unclear. A try counts as solved in this line only when both readers called it a correct fix.

- **Agreement.** The readers agreed on 121 of 155 tries (Cohen's kappa 0.57). Opus 5.5 called 84 of them correct fixes and Astra 59; both did on 55 (29 of Fable 5.2's tries and 26 of Opus 5.5's).
- **Why it is a sensitivity line.** A kappa of 0.57 is below the 0.6 we require before a model judge's numbers count. Adding those 55 tries raises both models by 12 to 14 points and widens the lead to +9.3; it does not change the direction.
- **What the reads found.** 51 of the 55 fail the task's own tests but pass the stronger tests, which check only what the issue asks. Of the other 4, 2 pass the task's own tests and fail only the stronger tests (the two named in section 2), and 2 fail both.

## 4. How the re-grade was done

- **Stronger tests, 107 sets.** For each issue a reader that saw the issue, the gold fix and the task's own tests, but no model output, read the tests for flaws and wrote 3 to 9 new tests in the repository's own framework, 533 in all. Every set passes the gold fix in two separate runs and fails the unfixed code. Of the 107 task test suites, 31 have a major flaw on that read and 75 a minor one; 71 are narrow (a wrong fix can pass) and 57 overspecified (a correct fix can fail). 22 sets come from an earlier 25-task check; 85 are new.
- **Rebuilt code, 428 tries.** The run kept transcripts but not final diffs, so each try's Claude Code session was replayed in its pinned task image (file edits applied, commands that change files re-run) and its final diff saved. 424 of 428 rebuilt diffs re-grade to the recorded result on the task's own tests. The 4 that don't (any-llm#1121 Opus 5.5 a1, oxc#22623 Fable 5.2 a2, vize#774 Opus 5.5 a2, coral#1186 Fable 5.2 a2) all passed in the run; they keep their recorded pass in every reading, and two lines above leave their tasks out. Graded strictly on their replayed code, all 4 would fail, 2 per model; the two lines without their tasks bound that case.
- **Grades.** A try passes the corrected reading when its rebuilt diff passes the task's own tests and the stronger tests. Grading used the task's own verifier settings and the run's egress blocklist.

## Limits

- **One family wrote the stronger tests.** Claude Opus 5.5 wrote all 107 sets, checked only against the gold fix and the unfixed code; a test could still be wrong for some valid fix. The read-corrected line is the check on that, and it widens the lead.
- **Replays are not the original containers.** 424 of 428 re-grades match, but a replay could differ in files no test reads.
- **One model under test is also a reader and a test writer.** Opus 5.5 wrote the tests and is one of the two readers; the readers were not told which model wrote a try, and Astra's agreement is required for every flip.
- **Not preregistered.** The grading rules and the thresholds for calling the numbers moved were written down before any replay result was read, but this is a re-grade, not a new run.

## Data archive

- **Raw re-grade data (private):** [fable-diagnosis-regrade-2026-11-23.manifest.json](https://github.com/garrytan/harness-evals/releases/download/raw-fable-diagnosis-regrade-2026-11-23/fable-diagnosis-regrade-2026-11-23.manifest.json), sha256 `658c3a0bf42c3c7874fbea51991fa5b19bc32a578dd30a52a510edb9afc62e6f`, 5,127 files: the rebuilt diffs and test logs of all 428 tries, the 107 stronger test sets with their reads, both blind reads of every failing try, and the replay and grading kit. Listed in [docs/archive/index.json](../../archive/index.json) under `other`.
- **Per-try grades (public):** [regrade.jsonl](regrade.jsonl), one line per try: its recorded grade, its rebuilt diff's grade on the task's own tests, its grade on the stronger tests, and the two reads.
