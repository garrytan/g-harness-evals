# gbrain time to first wow: does importing a new user's history get them a correct, cited answer?

- **We learned that importing a new user's past Claude Code and Codex sessions into gbrain is what gets them a correct, cited answer from their own history in their first session. You should turn the history import on by default in Claude Code and in Codex.** With Claude Opus 5.5 in Claude Code, the full setup answered all three history questions correctly, with a source the person can check, in 81 of 100 trials, against 21 of 100 for today's gbrain setup (paired difference +60 points, 95% range +48 to +72). With GPT-6.2 Sol in Codex it was 100 of 100 against 78 of 100 (+22, +14 to +30). The import alone did nearly all of it: 78 of 100 in Claude Code and 100 of 100 in Codex.
- **We learned that the first-session suggestion (gbrain's list of recent pages at the start of the first session) did not make answers measurably better in either harness. You should not count on it to help the agent answer.** On top of the import it added +3 points in Claude Code (95% range -8 to +14) and 0 in Codex, where the import alone already scored 100 of 100. In 29 of 100 Claude Code trials the session cited one of its pages for an answer; the run did not check whether the list named answer pages that went uncited. In Claude Code it is a cut candidate as an answer aid; in Codex the run could not test it (see [Why null?](report.md#why-null-three-cycles)).
- **We learned that Sol in Codex finds most answers in raw session files on its own, and Opus in Claude Code mostly doesn't.** With no gbrain at all, Codex answered 88 of 100 and Claude Code 15 of 100. gbrain still beat the plain agent in both (+12 points in Codex, +6 to +19; +66 in Claude Code, +56 to +75).

**What didn't work, or wasn't shown.** QM with gbrain as its memory gained +14 points with Opus 5.5 (+4 to +24), below the 20-point difference the plan set in advance, so no QM install path is started on this evidence. With GPT-6.2 Sol in QM it was +4 (+1 to +8) at a 96% ceiling, and with particle-1 +7 (-4 to +18). The run could not raise the ceiling without new paid trials, which are not run yet.

**Nothing went wrong in the safety checks.** No arm stated a made-up flag name or port on the 10 no-history trials (the grader has no fixed shape to check a made-up provider against), every import arm showed gbrain's "nothing to import" fallback in 10 of 10, and the suggestion broke none of the 15 coding tasks in either harness.

**How to read the numbers.** Each trial builds a synthetic home folder with 22 or 40 past coding sessions, then asks one fresh session three questions whose answers sit only in that history (a feature-flag name, a staging port, a chosen provider). A trial reaches the finish line when all three answers name the right value, no decoy first, and cite a file or gbrain page that the session actually read and that holds the value. A "95% range" is a bootstrap over the 100 paired fixtures. All numbers are from 1,600 of 1,600 planned trials, none excluded, run on gbrain `c341d40d` (0.60.774.0) on 2026-11-26.

## gbrain specifics, per harness

What each harness did with gbrain in this run, for gbrain's maintainers. Each line names its source in [results/analysis/](results/analysis/).

**Claude Code, Claude Opus 5.5** (gbrain registered as `serve --surface starter --advertise verbs`):

- **Today's defaults (gbrain installed, nothing imported): 21 of 100.** Opus called gbrain about 6.9 times a trial, found an empty brain and mostly stopped there: of the 193 questions it missed, 115 never named the value ([why-null.json](results/analysis/why-null.json)).
- **Without gbrain: 15 of 100.** Opus found and cited 40% of answers from the raw session files, and 16% of those whose answer sits in Codex's history.
- **With the import: 78 of 100 (import alone) and 81 of 100 (full setup).** Opus called gbrain in every trial, and 99% of passes cited a gbrain page.
- **The remaining misses are in the messy five-project persona:** 31 and 33 of its 50 trials finished, against 47 and 48 of 50 for the two-project persona. The main causes are a decoy from another project named first (11 questions in each arm) and the value not named (10 and 7).
- **The first-session suggestion reached all 100 full sessions, and in 29 the session cited one of its pages for a planted answer.** Its page labels are generic (for example `codex codex 2026-10-31` for `conversations/codex/...`). In those 29 trials full finished 27 against 24 for the import alone on the same fixtures, and in the other 71 it was 54 against 54. The groups are picked by the full arm's own citations, so this split shows no cause, and a suggested page that held an answer but went uncited counts as a miss: 29 is citation overlap, not a test of whether the list pointed at the answers.

**Codex, GPT-6.2 Sol** (gbrain registered as `serve --surface full`, Codex's shipped default since gbrain#10248):

- **Today's defaults: 78 of 100.** With an empty brain, Sol fell back to reading the session files.
- **With the import: 100 of 100 in both the import-alone and full arms,** 22 wins and no losses against defaults, and about 17 to 20 seconds faster per question session.
- **The suggestion was delivered in 98 of 100 full sessions.** The two that missed it (seeds 61 and 85) record `last_session.outcome: "no_ipc"` after a retry in `gbrain onboarding status --json`; both still finished.
- **The full arm was slower than the import alone:** +2.9 s per question session (+1.8 to +4.0) and about one more command (+0.9, +0.5 to +1.4).

**QM through Pi, gbrain as its memory** (`pi-memory-provider`, reading with `query`; the brain filled before the session by gbrain's import, run by the runner on the brain host, because QM has no gbrain installer):

- **Opus 5.5: 84 of 100 against 70 for plain QM;** GPT-6.2 Sol: 100 against 96; particle-1: 73 against 66.
- **With gbrain, question sessions were 12 to 13 seconds shorter in all three models** and used 4 to 9 fewer commands.
- **particle-1 often answered without citing the page it read:** 54 of its 57 missed questions named the right value first but had no auditable reference, and only 58 of 100 trials reached the finish line when every answer must cite a gbrain page.

**Everywhere:** no made-up flag names or ports on no-history homes, the fallback shown in 10 of 10 trials of every import arm, and no coding regression (15 of 15 with defaults and with the full setup, in both harnesses).

Read the [report](report.md) for the full tables and the three "Why null?" cycles, the [plan](PREREGISTRATION.md) for the design, and [deviations.md](deviations.md) for what changed during the run. Receipts are under [results/](results/), and [reproduce.md](reproduce.md) links the raw data.
