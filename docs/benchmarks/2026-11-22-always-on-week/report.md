# A simulated week for always-on agents: memory across conversations (always-on-week-2026-11)

- **We learned that gbrain with live ingestion carried facts across conversations about twice as often as a plain folder of memory files, for Claude Opus 5.5 in Claude Code. You should use gbrain with live ingestion as the memory for always-on Opus 5.5 setups in Claude Code.** Over a simulated week, gbrain passed 94 of 120 cross-conversation memory checks (memory score 78%, 95% range 69% to 88%). The files setup passed 47 of 120 (39%, 24% to 56%). Paired by task and repetition, gbrain minus files was +39 points (95% range +19 to +58), with gbrain ahead in 30 of 40 pairs, behind in 4 and level in 6.
- **We learned that without memory, Opus 5.5 passed none of these checks, so the checks really need memory. You should not expect an always-on agent to recall last week's facts from its own session history.** The no-memory setup passed 0 of 120. Each memory check is asked in a different conversation from the one that heard the fact, after the harness restarts, and a pass counts only if the fact was no longer readable in the world.
- **We learned that QM's built-in memory, as shipped, almost never carried a fact into a DM: 3 of 120 (2%, 0% to 8%). You should read that as a result of QM's default sharing posture, not as QM's memory failing to run.** QM captured memory in all 40 trials and injected it after the restart in 38. But its default posture, Isolated, keeps a channel's notebook out of a member's DM. Of the 117 checks QM missed, 35 had the fact captured only in a channel's notebook, 13 only in another person's notebook, and 69 had no captured fact that matched the answer.

**How to read the numbers.** The memory score is the share of a trial's 3 memory checks that passed with the fact no longer readable in the world, averaged over 40 trials (10 tasks x 4 repetitions). A "95% range" comes from a bootstrap that resamples tasks, then repetitions within them; when the range for a difference includes zero, the run did not show a difference. Costs are list prices, measured on every model call through our metering proxy. All four setups run Claude Opus 5.5 (`anthropic:claude-opus-5-5`).

## The question and the answer

**Question:** an always-on agent lives in a team's chat for days. Things it hears on Monday matter on Thursday, in a different conversation, after the agent has restarted and the original message is gone. Which memory setup carries those facts across: none, a folder of Markdown files the agent keeps, gbrain with live ingestion, or QM's own memory capture?

**Answer:** gbrain with live ingestion, clearly ahead of plain files, which is clearly ahead of no memory. QM as shipped is no better than no memory here, because its default posture keeps channel memory out of DMs, and every memory question in this run was asked in a DM.

## Results

Primary analysis, as preregistered: [results/analysis/analysis.md](results/analysis/analysis.md) (`python3 scripts/week-analysis.py --results <merged> --reps 10000 --seed 20261123`).

| Setup | Memory score | 95% range | Memory passes | Passes with the fact still readable (not counted) | Trials passing every required check | Paid cost per trial, median (IQR) |
|---|---:|---|---:|---:|---:|---|
| No memory (Claude Code) | 0% | 0% to 0% | 0 of 120 | 0 | 0 of 40 | $1.39 ($1.26 to $1.52) |
| Files (Claude Code, a `memory/` folder) | 39% | 24% to 56% | 47 of 120 | 5 | 6 of 40 | $1.75 ($1.56 to $1.93) |
| gbrain v0.60.763.0 (Claude Code, live ingestion) | 78% | 69% to 88% | 94 of 120 | 1 | 11 of 40 | $1.97 ($1.79 to $2.10) |
| QM main 77024e79 through Pi (QM as shipped: a DM can't read other scopes by design) | 2% | 0% to 8% | 3 of 120 | 1 | 0 of 40 | $1.12 ($1.05 to $1.22) |

Paired comparisons (40 pairs each, none dropped):

| Comparison | Mean difference | 95% range | Pairs up / down / same |
|---|---:|---|---|
| Files minus no memory | +39 points | +24 to +56 | 31 / 0 / 9 |
| gbrain minus no memory | +78 points | +69 to +88 | 40 / 0 / 0 |
| gbrain minus files | +39 points | +19 to +58 | 30 / 4 / 6 |
| QM minus no memory (QM as shipped: a DM can't read other scopes by design) | +2 points | +0 to +8 | 3 / 0 / 37 |

The smallest difference this run could detect was stated in advance as about 35 points (80% power, 10 task clusters). gbrain's lead over no memory is well past it; its lead over files is above it at the point estimate, and the lower end of its range (+19) is not.

Memory checks passed, per task, out of 12 (3 checks x 4 repetitions):

| Task | No memory | Files | gbrain | QM |
|---|---:|---:|---:|---:|
| wk-01 quarrendon-call-moves | 0 | 4 | 11 | 0 |
| wk-02 tansley-cutover-week | 0 | 0 | 10 | 0 |
| wk-03 tamsin-handover | 0 | 9 | 12 | 0 |
| wk-04 marrow-qbr-week | 0 | 10 | 8 | 3 |
| wk-05 carrowmere-maintenance-week | 0 | 4 | 9 | 0 |
| wk-06 tansleigh-swap-week | 0 | 2 | 11 | 0 |
| wk-07 q4-kickoff-week | 0 | 3 | 9 | 0 |
| wk-08 thornbury-mill-week | 0 | 4 | 8 | 0 |
| wk-09 agrisupply-rollout-week | 0 | 5 | 9 | 0 |
| wk-10 brackenwater-cutover-week | 0 | 6 | 7 | 0 |

Files scored higher than gbrain only on wk-04 (10 against 8), and in one repetition of wk-10.

## The decision rule, as preregistered

From [PREREGISTRATION.md](PREREGISTRATION.md), with Amendment 2 (written before gbrain's numbers were analysed):

- **The branch that applies:** "gbrain beats no memory by more than the detectable difference, and beats plain files". gbrain minus no memory is +78 points (+69 to +88), far past 35, and gbrain minus files is +39 points (+19 to +58), a range that excludes zero.
- **What that changes:** always-on setups we run or recommend that run Opus 5.5 in Claude Code use gbrain with live ingestion as their memory. Amendment 2 limits this to Opus 5.5 in Claude Code: GPT-6.2 Sol in Codex, and other models and harnesses, were not measured. gbrain's maintainers get the per-task wins and losses below.
- **QM against no memory:** QM's owners get, for each miss, whether the fact was captured and in which scope, and the misses where the asker could read the fact's notebook. There are none of those under the Isolated posture, because a DM reads only its asker's own notebook.
- **Settled:** always-on Opus 5.5 setups in Claude Code use gbrain with live ingestion as their memory, not a plain memory folder; no gstack or gbrain part is cut.
- **No "Why null?" pass applies:** both memory setups that this run measures for us (files and gbrain) beat no memory.

## Did each memory part run? (Amendment 2, R111)

The files, gbrain and QM shards ran without a one-trial smoke test, so Amendment 2 asks each to show, on its counted trials, that its memory was written and read on the counted build. The check is [scripts/week-part-ran.py](../../../scripts/week-part-ran.py); its output is [results/analysis/part-ran.json](results/analysis/part-ran.json).

| Setup | Build check (commit and pinned build) | Trials with a write | Trials with a read after the restart | Tasks with both | Verdict |
|---|---:|---:|---:|---:|---|
| No memory | 40 of 40 | n/a | n/a | n/a | build ok |
| Files | 40 of 40 | 40 | 40 | 10 of 10 | ran |
| gbrain | 40 of 40 | 40 | 40 | 10 of 10 | ran |
| QM | 40 of 40 | 40 | 38 | 10 of 10 | ran |

- Files: a write is a tool call that wrote under `workspace/memory/` with the file saved at the end; a read is a read of a memory file after the restart that returned its content.
- gbrain: a write is a live-ingestion insert of a world message; a read is a gbrain search, recall or page read after the restart that returned a result.
- QM: a write is a live fact in QM's memory table (from its database dump); a read is QM's "What you remember" block, holding at least one fact, in a message after the restart.
- QM's two trials without a read: in wk-05 r3, QM's core never became healthy after the restart (it timed out after 120 s), so the trial's later turns never ran, and its build check rests on the version before the restart alone (see [deviations.md](deviations.md)); in wk-07 r2, no memory block appeared after the restart.

## Where the passes came from

For every counted memory pass, the analysis names the first tool result that carried the fact, in the asker's own session, from the restart up to the graded answer (the ask turn's reply or its first matching post in that conversation).

| Setup | Memory store | A channel read | Another tool | Session context only |
|---|---:|---:|---:|---:|
| Files | 47 (memory file, read with Read or a shell command) | 0 | 0 | 0 |
| gbrain | 94 (gbrain read) | 0 | 0 | 0 |
| QM | 3 (not traced by tool) | 0 | 0 | 0 |

- **Every traced pass came from the memory store.** In all 47 files passes and all 94 gbrain passes, the first tool result carrying the fact in the asker's session was a memory file or a gbrain read.
- **Corrected after review.** An earlier draft of this table showed 17 gbrain and 6 files passes from channel reads and 4 files passes from other shell commands. That trace matched transcripts to the wrong turns; [deviations.md](deviations.md) has the details. No pass, score or interval changed.
- **No turn-file reads.** No trial in any setup read the runner's turn files or harness logs, so no pass was removed for that.

## What gbrain missed (for gbrain's maintainers)

Full list: [results/analysis/gbrain-misses.json](results/analysis/gbrain-misses.json) (`scripts/week-gbrain-misses.py`). In all 26 misses, the message that carried the fact was ingested and inserted.

- **20 misses: a gbrain read in the trial returned the fact, and the answer did not carry it.** Most come from four checks: wk-10 `mem_rate` (4 of 4 repetitions), wk-04 `mem_trailer` (3), wk-08 `mem_locker` (3) and wk-09 `mem_bridge` (3).
- **5 misses: ingested, but no gbrain read returned it.** These are wk-05 `mem_oncall` (3 of 4) and wk-07 `mem_projector` (2 of 4).
- **1 pass with the fact still readable** (wk-04 `mem_trailer`, r2), which does not count.
- **Scoping.** gbrain made 509 reads over the 40 trials (search 496, page 8, recall 5) with no errors. Every source a read returned was inside the sources that read was scoped to, and the leak preflight under this setting found nothing out of grant before the shard ran. The per-page leak audit in `summarize-run.ts` does not map the slug `memory/unattributed` (489 returned pages, the live-ingested memory pages), so its page-level leak count covers only the other 2,991 pages.

## QM's misses, by where the fact was captured

Full list: [results/analysis/qm-misses.json](results/analysis/qm-misses.json) (`scripts/week-qm-misses.py`, read from each trial's database dump at the end of the trial).

| Where the fact was at the end of the trial | Misses |
|---|---:|
| No live fact matched the check's answer | 69 |
| Captured only in a channel's notebook | 35 |
| Captured only in another person's notebook | 13 |
| Captured in the asker's own DM notebook | 0 |

- 114 of these 117 checks were asked in a DM; the other 3 are wk-05 r3's, whose later turns never ran.
- The agent called QM's `memory` tool in 3 of 40 trials.
- "No live fact matched" means no stored fact matched the check's answer pattern. QM may have stored a paraphrase the pattern misses, so 69 is an upper bound on facts never captured.
- QM's 3 passes were all wk-04's resume check.

## Other outcomes

- **Relay leaks:** 0 of 28 relay trials leaked in every setup (0 leaking posts).
- **Provider safety-filter stops:** 0 in every setup, read from the `safety_stop` field on all 15,609 metering-proxy usage lines.
- **Trials cut short:** 1 of 160. QM's wk-05 r3 ran 12 of its 20 turns, because QM's core did not come back after the restart. The runner still recorded it as completed, so none of the 160 was excluded; it stays counted and its later checks fail, as the plan says for a harness error. It is one of QM's 28 relay trials. The other 159 ran every planned turn, and every turn exited 0.
- **Trials passing every required check** ([results/analysis/summarize-run.md](results/analysis/summarize-run.md)): no memory 0 of 40, files 6 of 40 (15%, 0% to 33%), gbrain 11 of 40 (28%, 10% to 48%), QM 0 of 40.
- **Cost per trial against no memory** ([results/analysis/compare-run.md](results/analysis/compare-run.md)): files 1.20 times (1.05 to 1.32), gbrain 1.34 times (1.18 to 1.47), QM 0.78 times (0.70 to 0.86).

## Limits

- One model (Opus 5.5), one week of simulated time, ten public dev tasks, and a small team in one simulated company.
- Every memory question was asked in a DM. QM's score measures its default Isolated posture; an Open-posture QM was not counted here.
- QM's core runs on the VM's host network, so QM was not cut off from the internet the way the Claude Code setups were. Every fact the checks need is inside the simulated world.
- The gbrain setup ran from a later commit than the other three (Amendment 1 changed only the leak preflight that runs before trials). Tasks, preamble, grader and build were the same.
- Some decisions in the analysis were made after results were seen; [deviations.md](deviations.md) lists each one.

## Next time

### What we'd change if we ran this again

- Give every memory setup its own one-trial smoke test on the counted build, because three setups ran without one and their memory part was shown to run only afterwards.
- Stage one shard at a time on the controller and check its free disk before each launch, because three shards syncing at once filled the disk and cost two relaunches.
- Tear down a VM as soon as its shard stops in preflight, because the first gbrain VM sat idle for over five hours.

### Ideas to improve the eval

- Ask some memory questions in the channel where the fact was said, as well as in DMs, because every question here was a DM and QM's default posture keeps channel memory out of DMs by design.
- Run the same tasks with GPT-6.2 Sol in Codex CLI, because the recommendation covers only Opus 5.5 in Claude Code.
- Report a pass split by whether the fact came from the memory store, decided before the run, because that split here was worked out after the results.

## Reproduce

- Raw data (private): release `raw-always-on-week-2026-11`, manifest sha256 `e645e1026eaf4ae9ea1041a72b6c5b6ff45ed8f62527d623975063cdc89d4a1a` ([format](../../raw-archive.md)).
- Committed receipts: [results/merged/trials.jsonl](results/merged/trials.jsonl), shard records under [results/shards/](results/shards/), and the analysis outputs under [results/analysis/](results/analysis/).
- The headline numbers rebuild from the merged results directory with `scripts/week-analysis.py`, `scripts/week-part-ran.py`, `scripts/week-gbrain-misses.py` and `scripts/week-qm-misses.py`; the last three need the raw trial folders.
