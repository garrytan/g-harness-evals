# Fable 5.2 vs Fable 5.1 and Opus 5.5 in Claude Code: report (fable-5-2-coding-2026-11)

- **We learned that Fable 5.2 solved fewer coding tasks than Opus 5.5 and cost about 3 times as much per solved task. You should keep Opus 5.5 as your default coding model in Claude Code.** Fable 5.2 solved 78.8% of the 52 tasks and Opus 5.5 solved 89.4%. Fable 5.2's pass rate was 10.6 points lower (95% range: 3.8 to 18.3 points lower). It did worse than Opus on 8 tasks and better on none. Each solved task cost $2.04 with Fable 5.2 and $0.61 with Opus, 3.34 times as much (95% range: 2.63 to 4.22 times).
- **We learned that this test had little room to show any model beating Opus 5.5, because Opus already solves almost 9 in 10 of these tasks. You should test a new model against Opus on harder tasks before believing it is better.** Fable 5.2 could have gained at most about 11 points over Opus here, and the smallest gap this run could reliably catch was about 10 points. So a win over Opus was close to impossible to show on this set. A loss could show, and it did.
- **We learned that Fable 5.2 is probably a little better than Fable 5.1, but this run could not prove it. You should not expect a clear gain from moving Fable 5.1 work to Fable 5.2, and for coding Opus 5.5 beat both.** Fable 5.2 minus Fable 5.1 was +4.9 points (95% range: 6.9 points lower to 16.7 points higher). It did better on 10 tasks and worse on 7. Cost per solved task was a little lower but not measurably so (0.81 times, 95% range 0.64 to 1.02). Fable 5.2 was steadier: its two attempts at a task disagreed on 3.8% of tasks, against 18.0% for Fable 5.1. These Fable 5.1 numbers leave out the 2 attempts that the time stop cut off and the analysis script scored as fails, as amendment 1 requires (it already excluded a third; see Deviations).

**How to read the numbers.** A pass rate is the share of tasks solved, averaged over each model's two attempts per task. A "95% range" means the true value is very likely inside it; when the range for a difference includes zero, the run did not show a difference. "Smallest gap the run could reliably catch" is the gap it would detect 80% of the time (statisticians call this the minimum detectable difference). Cost is list price, measured on every API call.

## The question and the answer

**Question:** is Claude's newest model, Fable 5.2, a better coding agent in Claude Code than Fable 5.1 and Opus 5.5, and what does each cost per solved task?

**Answer:** no. On 52 Terminal-Bench 2.1 coding tasks, Fable 5.2 was measurably worse than Opus 5.5 and cost about 3 times as much per solved task. Against Fable 5.1 it looked a little better at about the same cost, but not by a margin this run can prove.

## Full results (the preregistered design, all 12 shards)

Each model ran each of the 52 tasks twice, in Claude Code 2.1.312, with the same settings.

| Model | Pass rate [95% range] | Tasks solved / attempts scored | Cost per solved task [95% range] | Median minutes per attempt | Attempts that disagreed | Solved on both attempts |
|---|---|---|---|---|---|---|
| Fable 5.2 | 78.8% [67.3%, 88.5%] | 82 / 104 | $2.04 [$1.30, $2.98] | 6.4 | 3.8% | 76.9% |
| Fable 5.1 | 73.5% [62.7%, 83.3%] | 74 / 101 | $2.22 [$1.52, $3.11] | 6.1 | 18.0% | 64.0% |
| Opus 5.5 | 89.4% [80.8%, 96.2%] | 91 / 102 | $0.61 [$0.41, $0.86] | 4.9 | 6.0% | 86.0% |

Rows are in the preregistered order, not a ranking. Times are medians of 381, 368 and 292 seconds, with 4 attempts running at a time on each machine. Fable 5.1 has a scored attempt on 51 tasks: both of its winning-avg-corewars attempts were cut off by the time stop, so comparisons with Fable 5.1 use 51 tasks.

| Comparison | Difference in pass rate, points [95% range] | Tasks worse / same / better | Cost per solved task, ratio [95% range] | What the run shows | Smallest gap it could catch |
|---|---|---|---|---|---|
| Fable 5.2 vs Opus 5.5 | -10.6 [-18.3, -3.8] | 8 / 44 / 0 | 3.34x [2.63x, 4.22x] | Fable 5.2 lower, and costs more | 10.4 |
| Fable 5.2 vs Fable 5.1 | +4.9 [-6.9, +16.7] | 7 / 34 / 10 | 0.81x [0.64x, 1.02x] | no measurable difference | 16.3 |
| Fable 5.1 vs Opus 5.5 (descriptive) | -15.7 [-25.5, -6.9] | 13 / 36 / 2 | 3.85x [3.22x, 4.65x] | Fable 5.1 lower, and costs more | 13.9 |

- **Tasks where Fable 5.2 did worse than Opus 5.5:** configure-git-webserver, feal-differential-cryptanalysis, feal-linear-cryptanalysis, filter-js-from-html, overfull-hbox, pytorch-model-cli, query-optimize, video-processing. Better: none.
- **Tasks where Fable 5.2 did worse than Fable 5.1:** dna-insert, feal-differential-cryptanalysis, feal-linear-cryptanalysis, overfull-hbox, pytorch-model-cli, query-optimize, video-processing. Better: chess-best-move, compile-compcert, extract-moves-from-video, install-windows-3.11, mteb-retrieve, raman-fitting, sanitize-git-repo, torch-tensor-parallelism, train-fasttext, write-compressor.
- **Within 10 points of Opus?** No. Amendment 1's descriptive test asks whether the one-sided 95% lower bound of Fable 5.2 minus Opus 5.5 is above -10 points. It is -17.3.
- Full output: [results/analysis-full-nostop/analysis.md](results/analysis-full-nostop/analysis.md). Its input, results/analysis-full-nostop/trials-full-nostop.jsonl, is results/merged/trials-full.jsonl without the 2 Fable 5.1 records the time stop cut off. The Fable 5.2 and Opus 5.5 rows and their comparison are identical to [results/analysis-full/analysis.md](results/analysis-full/analysis.md), which is the same data as the analysis script scored it, with those 2 attempts counted as fails.

## First results next to the full design

The first launch lost 5 of its 12 shards to a cloud capacity shortage, and a time stop ended it at 22:45 UTC. The first report was written from what had finished. Amendment 3 then ran the 5 missing shards, unchanged, so the full design is now complete. Both are shown, as amendment 3 promised.

| | First results (22:45 UTC) | Full design |
|---|---|---|
| Opus 5.5 coverage | 24 tasks, 1 attempt each | 52 tasks, 2 attempts each |
| Pass rate: Fable 5.2 / Fable 5.1 / Opus 5.5 | 77.9% / 67.3% / 79.2% | 78.8% / 73.5% / 89.4% |
| Fable 5.2 vs Opus 5.5 | -6.3 points [-16.7, 0.0], 2 worse / 0 better: not shown | -10.6 points [-18.3, -3.8], 8 worse / 0 better: lower |
| Cost per solved task, Fable 5.2 vs Opus 5.5 | 2.92x [2.20x, 4.01x] | 3.34x [2.63x, 4.22x] |
| Fable 5.2 vs Fable 5.1 | +10.6 points [-1.9, +23.1]: not shown | +4.9 points [-6.9, +16.7]: not shown |
| Cost per solved task, Fable 5.2 vs Fable 5.1 | 0.70x [0.48x, 1.03x] | 0.81x [0.64x, 1.02x] |
| Cost per solved task: Fable 5.2 / Fable 5.1 / Opus 5.5 | $1.82 / $2.60 / $0.54 | $2.04 / $2.22 / $0.61 |

- **What changed:** Opus's first 24 tasks came out low. On the same 26 tasks (the second half of the list) with both attempts, Opus solved 84.6%, and 89.4% across all 52. Two days earlier, a separate run had Opus 5.5 at 88.5% on these 52 tasks in Claude Code. With the full design, the gap to Opus is large enough to measure.
- **What didn't change:** Fable 5.2 never did better than Opus on any task, and cost about 3 times as much per solved task in both. Against Fable 5.1, neither version shows a difference. The first results' "about 30% cheaper than Fable 5.1" did not hold up: the full design puts it at 0.81x, with a range that includes no difference.
- **The first results' Fable 5.1 numbers include the 2 stopped attempts**, scored as fails, as they were first written. The full design column leaves them out.
- First results in full: [results/analysis/analysis.md](results/analysis/analysis.md), with the 26 tasks all three models ran at the same time in [results/analysis-matched/analysis.md](results/analysis-matched/analysis.md).

## Checks on the headline (sensitivity lines, all descriptive)

| Check | Fable 5.2 vs Opus 5.5, points | Cost ratio vs Opus | Fable 5.2 vs Fable 5.1, points | Cost ratio vs Fable 5.1 |
|---|---|---|---|---|
| Headline (preregistered) | -10.6 [-18.3, -3.8] | 3.34x [2.63x, 4.22x] | +4.9 [-6.9, +16.7] | 0.81x [0.64x, 1.02x] |
| As the analysis script scored it (includes the 2 stopped attempts) | -10.6 [-18.3, -3.8] | 3.34x [2.63x, 4.22x] | +7.7 [-3.8, +19.2] | 0.89x [0.67x, 1.19x] |
| Only tasks where every model has both attempts scored, as the script scored them (49 tasks) | -11.2 [-19.4, -4.1] | 3.26x [2.60x, 4.12x] | +4.1 [-7.1, +15.3] | 0.83x [0.65x, 1.04x] |
| Attempts the refusal counter marks removed (the bio filter; the 3 Fable 5.2 cyber-filter stops on FEAL stay in because the counter misses them ([transcripts](results/safeguard-stops/README.md)), see the no-FEAL line) | -11.2 [-19.4, -4.1] | 3.35x [2.64x, 4.21x] | +9.2 [-3.1, +21.4] | 0.89x [0.66x, 1.18x] |
| Without the two FEAL cryptanalysis tasks (50 tasks) | -8.0 [-15.0, -2.0] | 3.26x [2.55x, 4.10x] | +11.0 [+0.0, +22.0] | 0.86x [0.65x, 1.14x] |
| API calls cut by the egress proxy at 15 seconds and resent, removed from cost | -10.6 [-18.3, -3.8] | 3.29x [2.59x, 4.14x] | +7.7 [-3.8, +19.2] | 0.88x [0.66x, 1.16x] |
| Also removing the full-reservation charges on 3 streams that stalled for 900 seconds | -10.6 [-18.3, -3.8] | 3.06x [2.49x, 3.80x] | +7.7 [-3.8, +19.2] | 0.86x [0.69x, 1.05x] |

- The lines below the headline are built from the data as the script scored it, so their Fable 5.1 columns include the 2 stopped attempts.
- Fable 5.2 stays measurably below Opus in every check. No check shows Fable 5.2 measurably above Fable 5.1. The no-FEAL line touches zero at its low end, and dropping those tasks was chosen after seeing the data.
- Files: [both attempts](results/analysis-full-both/analysis.md), [no refusals](results/analysis-full-norefusal/analysis.md), [no FEAL](results/analysis-full-nofeal/analysis.md), [no 15-second cuts](results/analysis-full-nocut15/analysis.md), [no cuts or stalled-stream charges](results/analysis-full-nocut/analysis.md). The amendment 1 lines that the analysis script does not compute (the within-10-points test, rate limits and refusal counts) are in [results/analysis-full/amendment-1-lines.json](results/analysis-full/amendment-1-lines.json). Their rules were fixed before any data, but that script was written after it.
- The cut and stall lines can't be rebuilt from this repo alone: [find-resent-calls.py](results/analysis-full-nocut/find-resent-calls.py) and [classify-cut-and-stall.py](results/analysis-full-nocut15/classify-cut-and-stall.py) read each shard's proxy-usage.ndjson, which is not committed for this run, and some of these scripts use paths on the machine that ran them. find-resent-calls.py writes cut_by_key.json, committed here as [resent-calls.json](results/analysis-full-nocut/resent-calls.json). The adjusted trial files and both call lists are committed.

## Harder tasks (preregistered, descriptive)

The 14 tasks that GPT-6.1 Sol and GPT-6 Astra found hardest: Fable 5.2 57.1%, Fable 5.1 57.1%, Opus 5.5 82.1%. Fable 5.2 minus Opus 5.5: -25.0 points [-46.4, -7.1]. Fable 5.2 minus Fable 5.1: +0.0 [-25.0, +25.0]. Only 14 tasks, so read it as a direction, not a size ([results/analysis-full-hard/analysis.md](results/analysis-full-hard/analysis.md)).

## Four things in Claude Code and the test setup that affected Fable 5.2

1. **Provider safety filters stopped some attempts.**
   - Fable 5.2's cyber filter stopped both feal-differential-cryptanalysis attempts. It also stopped one feal-linear-cryptanalysis attempt; that attempt then ended without an answer and scored a fail. Opus solved both tasks on both attempts. The Claude Code transcripts that show all three stops, and why the refusal counter does not list them, are in [results/safeguard-stops/](results/safeguard-stops/README.md).
   - The bio filter stopped the DNA and protein tasks in every attempt, except one Fable 5.1 dna-insert attempt, which ran and passed.
   - The refusal counter (scripts/frontier-harbor/refusals.ts) lists 6 Fable 5.2, 5 Fable 5.1 and 6 Opus attempts; refusals count as fails, as preregistered.
   - The filters explain 2 of the 8 tasks Fable 5.2 lost to Opus. The other 6 are ordinary fails and timeouts.
2. **Claude Code 2.1.312 did not recognise Fable 5.2.** It logged `unrecognized_model` in all 104 Fable 5.2 attempts and assumed a 200K-token context window, where Fable 5.1 and Opus got their 1M window. So Claude Code compacted (summarised) the conversation at about 167K tokens in 3 Fable 5.2 attempts: winning-avg-corewars, install-windows-3.11 and make-mips-interpreter. All 3 attempts passed. No other model compacted, and no attempt hit a context-limit error. The API requests still carried max_tokens 128,000 (amendment 2).
3. **The test's egress proxy cut slow API calls at 15 seconds.**
   - The egress sidecar, gost 3.2.7, leaves its read timeout unset. So it drops any connection whose reply has not started within 15 seconds (found by another run's review).
   - Claude Code then resends the request. The first call is still paid.
   - Found in the proxy records: 24 Fable 5.2 calls ($2.81), none for Fable 5.1 or Opus in the records that survived (one interrupted Fable 5.1 shard lost its proxy log's last flush, $9.85 of calls; see Deviations). Each resend finished 15.5 to 16.0 seconds after the cut call. Claude Code logged 24 Fable 5.2 retries, 3 Fable 5.1 retries and none for Opus.
   - Removing those calls moves Fable 5.2's cost ratio to Opus from 3.34x to 3.29x (table above). The effect of the 15-second wait and the resend on pass rate and time is not measured.
4. **Three streams stalled and were billed at their full reservation.**
   - 2 Fable 5.2 calls and 1 Fable 5.1 call stalled until the metering proxy's 900-second upstream deadline, after 3 to 5 output tokens each.
   - The proxy then charged each its full worst-case reservation: $11.41 for Fable 5.2 and $7.94 for Fable 5.1.
   - This is a separate cost-counting defect from the 15-second cut, the same one #367 corrects in another run. Removing these charges as well moves the ratio to 3.06x.
   - Both kinds were found by matching a paid call to a resend with the same prompt size, which is a heuristic. The scripts are in [results/analysis-full-nocut15/](results/analysis-full-nocut15/) and [results/analysis-full-nocut/](results/analysis-full-nocut/).

None of the four changes the direction of the Opus comparison. The second, third and fourth make the test slightly less fair to Fable 5.2, so its true gap to Opus may be a little smaller than measured.

## Why null? (Fable 5.2 vs Fable 5.1)

The Opus comparison is not null: it found a measured loss. The Fable 5.1 comparison is null, so it gets the one review the rules ask for.

1. **Exposure:** every arm's agent-loop requests carried effort high on its own model (checked per request).
2. **Fit:** these are real terminal coding tasks, the kind the question is about.
3. **Power:** this is where the null comes from. The run can reliably catch about 16 points, and the observed gap is +4.9. Proving a gap that size would take about 11 times as many tasks.
4. **Model:** all three are frontier models; no ceiling issue against Fable 5.1 (both below 80%).

**Verdict:** keep Opus 5.5 as the coding default (measured). Fable 5.2 vs Fable 5.1 is FIX-METHOD: it needs a larger task set to settle, and a Claude Code version that knows Fable 5.2, behind an egress proxy with a longer read timeout.

## What ran

- **Tasks:** the 52 pinned Terminal-Bench 2.1 tasks of the frontier Harbor path, scored by each task's own tests. No model judge.
- **Models:** Claude Fable 5.2, Claude Fable 5.1 and Claude Opus 5.5, each in Claude Code 2.1.312. Effort high on every agent-loop request (checked per request), 128K max output, hosted web tools refused, and an egress blocklist.
- **Where:** Ubicloud standard-16 VMs, one per model x attempt x task half (12 shards of 26 attempts), 4 attempts at a time.
- **When:**

| Shard group | Fable 5.2 | Fable 5.1 | Opus 5.5 |
|---|---|---|---|
| Attempt 1, tasks 1 to 26 | 20:31 to 22:30 UTC (canary) | 21:14 to 22:45 (time stop) | 23:01 to 00:44 (amendment 3) |
| Attempt 1, tasks 27 to 52 | 21:14 to 22:15 | 23:01 to 00:08 (amendment 3) | 23:01 to 00:00 (amendment 3) |
| Attempt 2, tasks 1 to 26 | 23:01 to 01:04 (amendment 3) | 21:20 to 22:45 (time stop) | 23:01 to 00:13 (amendment 3) |
| Attempt 2, tasks 27 to 52 | 21:14 to 22:16 | 21:14 to 22:24 | 21:25 to 22:24 |

Times are the first attempt's start and the last attempt's end, UTC, 2026-11-09 to 11-10.

## Deviations

- **5 of 12 shards ran late.** In the first launch their VMs waited 10 minutes for capacity in eu-central-h1 and were destroyed at 21:19 UTC; fanout.sh re-queued only quota refusals. Amendment 3 (commit [97c1bc5ae6](https://github.com/garrytan/harness-evals/commit/97c1bc5ae6eb96b4ca52fb4f5e9f20a70b0ca1bb), pushed 22:53:58 UTC) ran exactly those 5, with no time stop, from 23:01 to 01:04 UTC. That commit differs from amendment 1's in documents and in scripts/ubicloud/fanout.sh only, which now re-queues a VM that waited for capacity. So different models' shards of the same half ran up to 2 hours apart, and time of day could affect API speed.
- **Late start:** the canary's install check took 24 minutes, and the other 11 shards launched at 21:07:26 UTC without their own install check. Amendment 2's commit is 21:08:01 UTC, 35 seconds after that launch and before any of those shards started a trial (first trial 21:14:09). Its heading says "21:10 UTC"; the commit time is the record.
- **Time stop at 22:45 UTC** (first launch only) interrupted the two Fable 5.1 first-launch shards and cut off 3 attempts. One (winning-avg-corewars, attempt 2) ended as an infrastructure error, and the analysis script already excludes it. The other two (winning-avg-corewars attempt 1 and caffe-cifar-10 attempt 2) ended as harness errors, and the script scored them as fails. Amendment 1 says an attempt unfinished at the time stop is not scored, so the headline leaves both out (results/analysis-full-nostop). Both were tasks where Fable 5.2 beat Fable 5.1 as scored, so counting them would move Fable 5.2 minus Fable 5.1 from +4.9 to +7.7 points. The Opus comparison doesn't change.
- **Lease stops:** 2 Opus attempts (extract-moves-from-video and path-tracing-reverse, attempt 2) had a request refused by the shard's spending limit and are excluded. The shard had spent only $10.23 of its $60 limit; the refusals came from worst-case reservations of calls running at the same time.
- **Fable 5.1's cost is slightly understated:** an interrupted first-launch shard's ledger shows $56.30 against $46.45 in its trial records, and cost per solve uses the trial records. The gap makes Fable 5.1 look cheaper, not Fable 5.2.
- **Mid-run pulls** needed a controller loop that made Claude Code's session folders readable on each VM (amendment 2). Every shard's final pull succeeded, and every VM was destroyed.
- **Rate limits:** no attempt was rate limited, and no request got a 429 from the provider in any arm.
- **The analysis script misses three amendment 1 lines** (the within-10-points test, the both-attempts check and the rate-limit counts), found in review of the preregistration's pull request. They are computed here by a script written after the data, under rules fixed before it.
- **Claude Code did not recognise Fable 5.2, the egress proxy cut slow calls at 15 seconds, and 3 stalled streams were billed at their full reservation**, as described above.
- Public tasks since 2025: a model may have seen them in training. The paired design (every model on the same tasks) cancels most of that within a task.

**Status:** results pull request. The preregistration, amendments 1 and 2 and the price table land first in their own pull request. Claim check: one reader (R51). Words: [glossary](../../glossary.md).
