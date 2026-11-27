# gbrain time to first wow: setup's history import and first-session suggestion, per harness (gbrain-first-wow-2026-12)

- **We learned that gbrain's history import gets a new user a correct, cited answer from their own past sessions in their first session, in both Claude Code and Codex. You should turn the import on by default in both.** Claude Opus 5.5 in Claude Code: 81 of 100 trials with the full setup against 21 of 100 with today's defaults (+60 points, 95% range +48 to +72; the preregistered half-way look stopped it there with the candidate ahead). GPT-6.2 Sol in Codex: 100 of 100 against 78 of 100 (+22, +14 to +30; 22 wins, 0 losses). Both clear the preregistered rule for turning a harness's defaults on (rule 1).
- **We learned that the first-session suggestion added nothing measurable on top of the import. You should credit the import, not the suggestion, and treat the suggestion as a cut candidate as an answer aid in Claude Code.** Full minus import alone: +3 points in Claude Code (-8 to +14; 17 wins, 14 losses) and 0 in Codex (both 100 of 100, so Codex could not show a gain).
- **We learned that QM with gbrain as its memory answered faster in every model, but did not clear the plan's 20-point bar for starting a QM install path.** Opus 5.5 +14 (+4 to +24), GPT-6.2 Sol +4 (+1 to +8, against a 96% ceiling), particle-1 +7 (-4 to +18). Question sessions were 12 to 13 seconds shorter with gbrain in all three.

**Tested:** gbrain `c341d40de3e5` (package 0.60.774.0; PR 0 gbrain#10248, PR 1 gbrain#10249, PR 2 gbrain#10346, with gbrain#10370 and gbrain#10375), one dependency tree (`deps_sha256 041772cb2594`) in every gbrain image; Claude Code with Claude Opus 5.5, Codex CLI with GPT-6.2 Sol, and QM through Pi with Opus 5.5, GPT-6.2 Sol and particle-1. Run 2026-11-26 from commit `6384ca3e`, 1,600 of 1,600 planned trials, none excluded. **Status:** a recommendation for Claude Code and Codex; inconclusive for QM.

- **Settled:** gbrain's history import turns on by default in Claude Code and in Codex (rule 1 in both); the first-session suggestion is credited with no gain, and is a cut candidate as an answer aid in Claude Code and untested in Codex; no QM install path that imports history is started on this evidence.

## The concrete case

A person who has used Claude Code and Codex for a few weeks installs gbrain and opens a new session in one of their projects. They ask (the run's question template; the names below are invented for this example, and each trial's names come from its seed):

> 1. What did we decide to name the feature flag for the billing-retry work in harbor-api?
> 2. Which port does the harbor-api staging gateway listen on now?
> 3. Which provider did I pick for email delivery in harbor-api?
>
> Answer each one as a numbered list in the same order, and for each say exactly where you found it, so I can check it myself.

The answers exist only in the text of earlier sessions, never in a project file, and question 3's answer sits in the other harness's sessions (a Claude Code user's Codex history, or the reverse). The messy persona also changed the port once and has a decoy of each kind of fact in another project. To pass, the agent has to find the right session text, through gbrain or by reading the files, and say where it found it.

## The experiment

- **World:** one synthetic home folder per trial, built from its seed (`scripts/gbrain-first-wow/fixtures.ts`), with Claude Code and Codex session files in the folders and line formats those harnesses write. Two personas alternate by seed: history-rich (2 projects, 22 sessions) and messy (5 projects, 40 sessions, decoys and one changed port). A third, no-history, has no sessions and is scored apart.
- **Arms in Claude Code and Codex:** `defaults` (today's gbrain setup, nothing imported, suggestion off), `pr1` (setup's explicit 30-day import, suggestion off), `full` (the scripted person accepts setup's import offer, suggestion on), and `plain` (no gbrain, same home folder). Claude Code's gbrain arms register `serve --surface starter --advertise verbs` and Codex's `serve --surface full` in every arm. **In QM:** `qm-native` (gbrain as QM's memory, filled by the same import) and `plain` (QM as shipped, same files), for each of the three models.
- **Metric:** the finish line, per trial: all three answers name the planted value, no decoy first, and cite a file or gbrain page that the session read and that holds the value (`scripts/gbrain-first-wow/score.ts`). Graded mechanically from transcripts and the end-state brain export; no model judge.
- **Sample:** 100 pairs per arm per harness on seeds 0 to 99 (the same seed gives the same home in every arm), 10 no-history trials per arm on seeds 9000 to 9009, and 15 paired coding tasks per harness on seeds 200 to 214.
- **Stated differences (fixed at freeze):** 26 points for Claude Code, 20 for Codex and each QM model. **Half-way look:** one look at 50 pairs, O'Brien-Fleming bounds (stop at McNemar p at or below 0.003).

## Results

Primary analysis, as preregistered: [results/analysis/final.md](results/analysis/final.md) (`bun scripts/gbrain-first-wow/analyze.ts <shard results dirs> --json final.json --md final.md`). The half-way looks: [interim.md](results/analysis/interim.md) and, for QM with particle-1, [interim-particle.md](results/analysis/interim-particle.md).

### Decisions, per harness

| Harness and model | Primary contrast | Pairs | Rate | Difference | 95% range | Wins / losses | Decision (rule) |
|---|---|---:|---|---:|---|---|---|
| Claude Code, Opus 5.5 | full minus defaults | 100 | 21% to 81% | +60 | +48 to +72 | 66 / 6 | defaults turn on (1); the half-way look stopped it at 50 pairs (22% to 82%, +60, +42 to +76, 33 / 3, p 2.3e-7) |
| Codex, GPT-6.2 Sol | full minus defaults | 100 | 78% to 100% | +22 | +14 to +30 | 22 / 0 | defaults turn on (1), McNemar p 4.8e-7 |
| QM, Opus 5.5 | qm-native minus plain | 100 | 70% to 84% | +14 | +4 to +24 | 22 / 8 | can't decide, so nothing starts (5), p 0.016, below the 20-point bar |
| QM, GPT-6.2 Sol | qm-native minus plain | 100 | 96% to 100% | +4 | +1 to +8 | 4 / 0 | no difference, Why null (2), p 0.125 |
| QM, particle-1 | qm-native minus plain | 100 | 66% to 73% | +7 | -4 to +18 | 20 / 13 | no difference (2), p 0.296; reported beside the other QM models, never carrying the QM call alone |

Claude Code's rows after its half-way look are description only, as the plan says: their p values are not a test.

### Which part gets the credit

| Harness | Contrast | Rate | Difference | 95% range | Wins / losses | Question time (s) | Commands |
|---|---|---|---:|---|---|---|---|
| Claude Code | import alone minus defaults | 21% to 78% | +57 | +46 to +67 | 59 / 2 | -20.4 (-24.3 to -16.7) | -4.9 (-5.5 to -4.2) |
| Claude Code | full minus import alone (the suggestion) | 78% to 81% | +3 | -8 to +14 | 17 / 14 | -1.1 (-2.1 to -0.0) | -0.7 (-1.2 to -0.3) |
| Claude Code | full minus plain | 15% to 81% | +66 | +56 to +75 | 67 / 1 | -21.3 (-23.2 to -19.4) | -1.0 (-1.5 to -0.6) |
| Codex | import alone minus defaults | 78% to 100% | +22 | +14 to +30 | 22 / 0 | -20.3 (-22.0 to -18.5) | -5.6 (-6.2 to -5.0) |
| Codex | full minus import alone (the suggestion) | 100% to 100% | 0 | 0 to 0 | 0 / 0 | +2.9 (+1.8 to +4.0) | +0.9 (+0.5 to +1.4) |
| Codex | full minus plain | 88% to 100% | +12 | +6 to +19 | 12 / 0 | +1.9 (+0.5 to +3.2) | +2.2 (+1.8 to +2.7) |

The plain agent did not match gbrain in either harness (rule 4): in Codex the full candidate's lead over plain is +12 with a range that excludes zero, and in Claude Code it is +66.

**End-to-end time, setup included,** moves the other way for some contrasts, because the import takes time and the plain arm has no setup: Codex full minus plain is +27.3 s (+25.9 to +28.6), Claude Code full minus plain +2.7 s (+0.8 to +4.6), and full minus import alone +7.0 s in Claude Code and +12.0 s in Codex (the full arm reaches its import through setup's two-step offer). Against defaults, end-to-end time still falls: -7.7 s in Claude Code and -2.9 s in Codex.

### Per arm

Finish line over 100 question trials; questions passed over 300; metered cost per trial at list price over all 110 of the arm's trials (question and no-history).

| Arm | Finish line | Strict (gbrain page cited) | Questions passed | History-rich / messy (of 50 each) | Question time, mean (s) | Commands, mean | Cost per trial |
|---|---:|---:|---:|---|---:|---:|---:|
| Claude Code defaults | 21 | 0 | 107 | 11 / 10 | 43.5 | 14.5 | $0.193 |
| Claude Code import alone | 78 | 78 | 276 | 47 / 31 | 23.2 | 9.6 | $0.143 |
| Claude Code full | 81 | 81 | 280 | 48 / 33 | 22.1 | 8.9 | $0.136 |
| Claude Code plain | 15 | 15 | 121 | 9 / 6 | 43.4 | 9.9 | $0.214 |
| Codex defaults | 78 | 0 | 246 | 39 / 39 | 42.7 | 13.5 | $0.180 |
| Codex import alone | 100 | 100 | 300 | 50 / 50 | 22.4 | 7.9 | $0.159 |
| Codex full | 100 | 100 | 300 | 50 / 50 | 25.3 | 8.9 | $0.165 |
| Codex plain | 88 | 88 | 286 | 43 / 45 | 23.4 | 6.6 | $0.066 |
| QM Opus 5.5 with gbrain | 84 | 84 | 284 | 47 / 37 | 11.0 | 2.8 | $0.098 |
| QM Opus 5.5 plain | 70 | 70 | 249 | 34 / 36 | 22.8 | 6.5 | $0.095 |
| QM GPT-6.2 Sol with gbrain | 100 | 100 | 300 | 50 / 50 | 9.8 | 3.1 | $0.048 |
| QM GPT-6.2 Sol plain | 96 | 96 | 296 | 48 / 48 | 23.3 | 12.1 | $0.056 |
| QM particle-1 with gbrain | 73 | 58 | 243 | 38 / 35 | 14.3 | 11.2 | $0.015 |
| QM particle-1 plain | 66 | 66 | 241 | 36 / 30 | 26.9 | 17.5 | $0.016 |

The strict reading counts a pass only when the answer cites a gbrain page, and is a secondary measure, never the verdict (decision A); for arms without gbrain it equals the finish line. Source: [why-null.json](results/analysis/why-null.json) (`python3 scripts/gbrain-first-wow/why-null.py results/merged/trials.jsonl --out why-null.json`) and `usage.usd` in each trial record.

### No-history homes and the coding check

- **No made-up flags or ports.** On the 10 no-history trials of every arm, no answer stated a flag or port of the planted shape. Every answer in a trial said nothing was found in 10 of 10 trials for every arm except Codex full (9), QM Sol with gbrain (9) and QM Sol plain (8). The import arms showed gbrain's "nothing to import" fallback in 10 of 10; today's defaults import nothing and showed it in 0 of 10. No gbrain arm reaches the plan's blocker line (a made-up value in more than 2 of 10).
- **No coding regression.** With the suggestion on, Claude Code and Codex each passed 15 of 15 paired coding tasks, the same as with today's defaults ([final.json](results/analysis/final.json), `coding`).

## Why null? Three cycles

The plan gives a null result one "Why null?" cycle (R48): did the agent use the part, do the tasks fit it, were there enough samples and headroom, and does the frontier model already do it unaided. Where the null comes from a ceiling, the cycle first makes one honest attempt to raise it (R61). Numbers are from [why-null.json](results/analysis/why-null.json) and [final.json](results/analysis/final.json).

### 1. The first-session suggestion in Claude Code: CUT-CANDIDATE, as an aid to the agent's answers

- **Did the agent get it?** Yes. It was delivered and visible in all 100 full sessions.
- **Do the tasks fit it?** The run can't say. The suggestion lists the three most recent imported conversations, and its labels are generic (`codex codex 2026-10-31`). The scorer records only the pages an answer cited, so what the run measured is citation overlap. In 29 of 100 trials the session cited a suggested page for a planted answer. A suggested page that held an answer but went uncited counts as a miss, so this is not a test of whether the list pointed at the answers. In those 29 trials full finished 27 of 29 against 24 of 29 for the import alone on the same fixtures, and in the other 71 it was 54 against 54; the groups are picked by the full arm's own citations, so the split shows no cause.
- **Enough samples and headroom?** Yes for a gain of the plan's size. The import alone left 22 points of room (78 of 100), 31 pairs disagreed, and the 95% range (-8 to +14) excludes the stated 26-point difference. A gain of up to about 14 points is not ruled out.
- **Does the model do it unaided?** Yes, the job the suggestion does for the agent is already done. With the import alone, Opus called gbrain in every trial (6.3 calls on average) and 99% of its passes cited a gbrain page. Its misses come from decoys in other projects (11 questions in each arm) and unnamed values (10 and 7), which the suggestion does not address.
- **Verdict: CUT-CANDIDATE.** In plain words: the start-of-session list of recent pages did not make Claude Code's answers better; the import did all of it. It was 1.1 seconds faster per question session (-2.1 to -0.0), which is small. **The caveat:** this eval measures only the agent's answers. It does not measure whether a person reads the list, or whether a list that named pages for the current project would help. The 27-against-24 split can't speak to the second, because those 29 trials were picked by the full arm's own citations.

### 2. The first-session suggestion in Codex: FIX-METHOD, because the import alone is at the ceiling

- **Did the agent get it?** In 98 of 100 full sessions. The two that missed it recorded `no_ipc` after a retry, and both still finished.
- **Do the tasks fit it?** As in Claude Code: the session cited a suggested page for an answer in 26 of 98 (citation overlap only, as above).
- **Enough samples and headroom?** No headroom: the import alone finished 100 of 100, so the suggestion has nothing to add on this measure, and no pair disagrees.
- **Does the model do it unaided?** Yes. Sol with the import alone answered everything.
- **Raising the ceiling (R61): not possible within this run.** Every finish-line cut in the data is saturated: both personas, all three kinds of fact and the cross-harness question are 100% in both arms. A harder test needs new fixtures (more sessions, values buried deeper, more decoys), and fixtures can't change between a run's plan and its report, so that is a new run with new paid trials, which needs the coordinating agent's go. It is proposed below.
- **Verdict: FIX-METHOD.** The measures that are not saturated lean against the suggestion in Codex: +2.9 s per question session (+1.8 to +4.0) and +0.9 commands (+0.5 to +1.4).

### 3. QM with GPT-6.2 Sol, gbrain as its memory: FIX-METHOD, because plain QM is at 96%

- **Did the agent use gbrain?** Yes: a gbrain call in all 100 trials (2.5 on average), and every pass cited a gbrain page.
- **Do the tasks fit?** Not for Sol: the answers sit in plain files in the home folder, and Sol finds them by itself, at 12.1 commands a trial against 3.1 with gbrain.
- **Enough samples and headroom?** 4 points of headroom, so the largest possible gain (+4) is below the stated 20, whatever the sample. All 4 discordant pairs favoured gbrain.
- **Does the model do it unaided?** Yes, at 96 of 100.
- **Raising the ceiling (R61): not possible within this run,** for the same reason as cycle 2.
- **Verdict: FIX-METHOD.** On this run's evidence no QM install path is started, as the plan says. What gbrain does show here is speed: question sessions 13.4 seconds shorter (-14.4 to -12.5) and 9 fewer commands (-9.6 to -8.5). Beside it, Opus 5.5 in QM gained +14 (+4 to +24), a real gain that is below the bar (rule 5), and particle-1 gained +7 (-4 to +18).

**The follow-up these two FIX-METHOD verdicts need:** a run on harder fixtures for Codex's import-alone and full arms and QM with Sol, about 400 trials and about $50 at this run's per-trial cost, with question time named as a decision measure in advance. It is not run yet.

## What to use and what to avoid

- **Claude Code with Opus 5.5:** use gbrain with the history import. Today's defaults without it answer the history questions in 21 of 100 trials, and no gbrain in 15. Expect weaker results when a person keeps several similar projects (31 to 33 of 50 on the messy persona). Don't count on the first-session list of recent pages to help the agent.
- **Codex with GPT-6.2 Sol:** use gbrain with the history import (100 of 100). Without gbrain, Sol still answers 88 of 100 from the raw session files, so gbrain's gain over no gbrain is smaller here (+12 points), and the first run takes about 27 seconds longer end to end, almost all of it setup's import. The suggestion couldn't be tested here, and it cost about 3 seconds per session.
- **QM:** gbrain as QM's memory answered faster in every model and more often with Opus 5.5 (+14) and particle-1 (+7, not shown). This run does not support building a QM install path that imports history, and QM has none today. particle-1 often answers without citing its source (58 of 100 trials on the strict reading against 73 on the plan's).
- **Everywhere:** no harness made up a value on a home with no history, and the suggestion broke no coding task.

## Limits

- **Synthetic histories with the answer in plain session text.** Real histories are longer and messier, and real facts can be paraphrased or spread across sessions. At this difficulty Sol already hits the ceiling.
- **The agent's answers only.** What a person does with gbrain's setup offer or the first-session list is not measured; the person here is scripted to accept.
- **Not measured:** permission prompts (the adapters bypass them), hosted gbrain.io, macOS, Cursor, Hermes, OpenClaw, the install itself, and semantic search (every gbrain arm is keyless, keyword search only).
- **Two registrations.** Claude Code's and Codex's gbrain arms register different tool sets (decision G), so a Claude Code number and a Codex number are not a comparison of the same gbrain surface.
- **particle-1 ran later.** Its shard was held while Particle's account had no credit and ran from 14:22 to 18:13 UTC on the same commit and images (deviations.md).

## Next time

### What we'd change if we ran this again

- Size the stated difference for each part from a pilot in which the part is on and off on the same fixtures, because the suggestion's 26-point bar came from the import's pilot effect and was never a size the suggestion could plausibly reach.
- Name question time as a decision measure for any harness whose pilot already finishes nearly every trial, because at the ceiling time was the only measure left that moved (Codex and QM with Sol).

### Ideas to improve the eval

- Build harder fixtures (more sessions, values older and further from the project files, more decoys across projects), because Sol in Codex and in QM answered from the raw files at 88% to 96% with no gbrain.
- Score whether the first-session list names a page for the person's current project, because a list redesigned to do that could then be measured directly instead of through citation overlap.

## Reproduce

Commands, pins and the raw-data archive are in [reproduce.md](reproduce.md). From the repository root, the frozen analysis over the seven shard folders of the raw archive is `bun scripts/gbrain-first-wow/analyze.ts <s1-qm/results> ... <s6-codex/results> --json final.json --md final.md`, and the Why-null breakdown reads only the committed `results/merged/trials.jsonl`. The run took about 10 hours from the first shard's start (08:27 UTC) to the last shard's end (18:13 UTC) on seven standard-4 Ubicloud VMs, one trial at a time per VM, with the particle-1 shard held for part of it.
