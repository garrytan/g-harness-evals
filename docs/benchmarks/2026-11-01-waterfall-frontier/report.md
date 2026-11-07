# Frontier token waterfall (waterfall-frontier-2026-11): report

**Answer (dev): on Opus 5.5 and GPT-6.1 Sol, Claude Code and Codex cost less per trial than OpenClaw in both models, and Codex cost less than Hermes on Sol. On Opus, Claude Code and Hermes could not be told apart, and QM cost less than Claude Code.** So the #145 pattern (measured on Haiku and gpt-6-luna) holds in three of the five dev contrasts. Every number here is dev: 20 public v0.3 tasks, 2 repetitions, these pins.

## TL;DR

- **All 280 trials ran (dev).** 7 cells x 40 trials, every one `completed`, no cap stop, no model, infra or exam error. Spend $53.42 of the $150 cap.
- **Contrast 1, Opus, Claude Code minus OpenClaw (dev): -$0.165 per trial [-$0.206, -$0.128].** Claude Code is cheaper, at the same pass rate (80% each). About 81% of the gap is cache writes: OpenClaw re-sends a much bigger system prompt and bigger tool results.
- **Contrast 2, Opus, Claude Code minus Hermes (dev): -$0.010 [-$0.030, +$0.010].** Not distinguished at 20 tasks. The #145 gap does not show up on Opus ([Why null?](#why-null)).
- **Contrast 3, Opus, Claude Code minus QM (dev): +$0.041 [+$0.020, +$0.061].** Claude Code costs more than QM, the opposite direction. QM's network differs (default bridge).
- **Contrast 4, Sol, Codex minus OpenClaw (dev): -$0.107 [-$0.270, -$0.002].** Codex is cheaper, barely. Most of the gap is OpenClaw's output (282,492 output tokens against 32,226), and $0.036 of it is one timed-out stream charged at its full $1.45 reservation.
- **Contrast 5, Sol, Codex minus Hermes (dev): -$0.023 [-$0.030, -$0.016].** Codex is cheaper. The gap is cache writes and reads: Hermes sends 423 kB more tool schemas per trial and 16.7 requests per trial against 11.6.
- **No pass-rate interval excludes zero (dev),** so no cost gap is flagged as confounded by work done. Contrasts 4 and 5 have upper ends at exactly 0.0 points.
- **Savings lever proposed for a follow-up (dev, a hypothesis): Opus, schemas of tools never called** ($3.11 to $62.11 summed over the four Opus cells). **Sol: cache writes never read** ($0.35, at list prices only).
- **Method finding (exploratory, dev): the avoidable-looking test cannot follow Claude Code's history.** 0 of 426 cache-writing Claude Code requests is matched by a later request, so its patterns 1, 2 and 4 are not measured ([Open notes](#open-notes)).
- **Why null? verdict: KEEP** for contrast 2's method (dev). The prereg scores no gstack or gbrain part, so there is no gstack or gbrain verdict line.
- **Deviations:** two controller losses (one before any trial, one mid-run), one refused relaunch try at $0, one oc-sol smoke relaunch. No trial was lost or rerun ([Deviations](#deviations)).
- **R71 all-in at PR open: $341.79 of the $655 booking** ([Spend](#spend)).

## Contrasts (dev)

Each contrast is B minus A on one model, paired by task and repetition (40 pairs, 20 task clusters), from [contrasts.json](results/contrasts.json). Intervals are task-clustered bootstrap 95% intervals (seed 7, 10,000 draws). A negative dollar figure means B is cheaper. No ranks and no p-values.

| # | Model | B minus A | Dollars per trial [95% CI] | Reading | Dollars per pass [95% CI] | Pass rate, points [95% CI] |
|---:|---|---|---|---|---|---|
| 1 | Opus 5.5 | Claude Code minus OpenClaw | **-$0.1653 [-$0.2062, -$0.1282]** | below zero: B cheaper | -$0.2066 [-$0.3065, -$0.1435] | 0.0 [-10.0, +10.0] |
| 2 | Opus 5.5 | Claude Code minus Hermes | **-$0.0102 [-$0.0301, +$0.0099]** | contains zero: not distinguished | -$0.0127 [-$0.0490, +$0.0180] | 0.0 [-10.0, +10.0] |
| 3 | Opus 5.5 | Claude Code minus QM | **+$0.0414 [+$0.0196, +$0.0609]** | above zero: B costs more | +$0.0338 [-$0.0221, +$0.0731] | +7.5 [-5.0, +22.5] |
| 4 | GPT-6.1 Sol | Codex minus OpenClaw | **-$0.1073 [-$0.2702, -$0.0021]** | below zero: B cheaper | -$0.1223 [-$0.3245, +$0.0254] | -7.5 [-15.0, 0.0] |
| 5 | GPT-6.1 Sol | Codex minus Hermes | **-$0.0231 [-$0.0297, -$0.0160]** | below zero: B cheaper | -$0.0197 [-$0.0329, +$0.0073] | -5.0 [-12.5, 0.0] |

- **Every cell is complete (dev):** 40 rows each, 0 with `cap_stop` (the preregistered `jq` count, also in [report-extras.json](results/report-extras.json) `cap_stop`). So no contrast is inconclusive under the incomplete-cell rule.
- **Quality rule (dev):** `confounded_by_work_done` is false for all five. Contrasts 4 and 5 touch zero at their upper end, so Codex may pass a little less often than OpenClaw and Hermes on Sol; this run cannot say.
- **Contrast 3 scope (dev):** QM runs on the default Docker bridge, the other cells on the internal network, so the network is not held fixed in contrast 3.

### Where each gap sits (dev)

The per-trial difference, B minus A, in each billing class and each content section, from [report-extras.json](results/report-extras.json) `contrasts`. Every contrast pairs all 40 trials, so this is the paired mean difference. `contrasts.ts` at the analysis commit does not print this breakdown, so `report-extras.ts` computes it from [waterfall.json](results/waterfall.json). Section bytes are summed over every request of a trial (each request re-sends its history). Opus tokens are estimates from [calibration.json](calibration.json); Sol sections are bytes only, uncalibrated. `other` is JSON framing and settings, bytes only.

| # | Cache write | Cache read | Output | Other classes | Section differences per trial, largest first |
|---:|---:|---:|---:|---:|---|
| 1 | -$0.1341 | -$0.0265 | -$0.0047 | $0.0000 | system -331 kB (about -117k tokens), tool results -324 kB (-119k to -324k tokens), tools +131 kB (+46k tokens), other +127 kB |
| 2 | -$0.0018 | -$0.0090 | +$0.0007 | $0.0000 | other +130 kB, tools -109 kB (-38k tokens), tool results -73 kB, system -67 kB (-24k tokens) |
| 3 | +$0.0825 (5 min) and -$0.0882 (1 hour) | +$0.0250 | +$0.0224 | -$0.0004 | tools +201 kB (+70k tokens), other +130 kB, tool results +19 kB, user text +18 kB |
| 4 | -$0.0075 | -$0.0011 | -$0.0626 | -$0.0362 (one charged reservation) | tools +89 kB, tool results -79 kB, system -47 kB, other +23 kB |
| 5 | -$0.0120 | -$0.0092 | -$0.0019 | $0.0000 | tools -423 kB, tool results -42 kB, system +35 kB, other +22 kB |

- **Contrast 1 (dev):** OpenClaw on Opus spends 62.8% of its dollars on cache writes. Its system section is 410 kB per trial against Claude Code's 78 kB.
- **Contrast 3 (dev):** QM writes its cache for 1 hour (priced at $8 per million on Opus, against $5 for 5 minutes), Claude Code for 5 minutes. The cache-write dollars nearly cancel. Claude Code's extra cost is cache reads and output: 11.9 requests per trial against 9.9 (7.7 without QM's Haiku housekeeping calls), and 101,745 output tokens against 59,117.
- **Contrast 4 (dev):** the "other classes" figure is `unknown`: one OpenClaw request (`openclaw-sol-none-mu-v03-dev/cn-02-tansleigh-packaging-deadline/r2`) whose stream timed out before its final usage, so the proxy kept its $1.4466 reservation.
- **On Sol (dev),** the proxy meters every uncached prompt token as a cache write ($2.50 per million), because OpenAI caches prompts on its own. That is why "cache write" carries 46% to 81% of each Sol cell's dollars.

## Per cell (dev)

From [summary.json](results/summary.json) (summarize-run) and [report-extras.json](results/report-extras.json). Pass rate is passes over 40 with a task-clustered interval. A pass is grade `pass` with no consent violation. Each cell ran alone on its own standard-16 Ubicloud VM (the shard named in the table, `results/<shard>.shard-vm.json`), so wall-time differences are confounded with the machine.

| Cell (shard) | Passes | Pass rate [95% CI] | Spend | Per trial | Per pass [95% CI] | Requests per trial | Wall per trial, median [95% CI] | Wall per turn, median [95% CI] |
|---|---:|---|---:|---:|---|---:|---|---|
| Claude Code, Opus 5.5 (`cc-opus`) | 32 | 80.0% [62.5%, 95.0%] | $7.1871 | $0.1797 | $0.2246 [$0.1731, $0.3029] | 11.9 | 34.1 s [29.1, 37.8] | 11.4 s [10.2, 11.8] |
| OpenClaw, Opus 5.5 (`oc-opus`) | 32 | 80.0% [65.0%, 92.5%] | $13.7998 | $0.3450 | $0.4312 [$0.3265, $0.5943] | 14.0 | 90.3 s [81.7, 98.6] | 28.1 s [26.6, 30.5] |
| Hermes, Opus 5.5 (`he-opus`) | 32 | 80.0% [62.5%, 95.0%] | $7.5945 | $0.1899 | $0.2373 [$0.1784, $0.3248] | 11.5 | 63.5 s [49.6, 68.2] | 19.1 s [17.6, 21.4] |
| QM (Pi), Opus 5.5 (`qm-opus`) | 29 | 72.5% [52.5%, 90.0%] | $5.5331 | $0.1383 | $0.1908 [$0.1323, $0.2912] | 9.9 (7.7 without Haiku housekeeping) | 36.7 s [32.8, 42.0] | 6.9 s [5.9, 7.7] |
| Codex, GPT-6.1 Sol (`cx-sol`) | 28 | 70.0% [50.0%, 90.0%] | $4.6963 | $0.1174 | $0.1677 [$0.1156, $0.2691] | 11.6 | 22.9 s [20.3, 26.7] | 7.3 s [6.5, 9.0] |
| OpenClaw, GPT-6.1 Sol (`oc-sol`) | 31 | 77.5% [60.0%, 92.5%] | $8.9901 | $0.2248 | $0.2900 [$0.1453, $0.5008] | 12.2 | 76.6 s [69.5, 88.1] | 24.3 s [20.7, 26.6] |
| Hermes, GPT-6.1 Sol (`he-sol`) | 30 | 75.0% [57.5%, 92.5%] | $5.6218 | $0.1405 | $0.1874 [$0.1365, $0.2714] | 16.7 | 66.3 s [56.7, 71.4] | 22.6 s [21.9, 23.8] |
| **Total** | **214 / 280** | | **$53.4227** | | | | | |

- **Terminations (dev):** 280 of 280 `completed`. 0 `model_error`, 0 `infra_error`, 0 `exam_fault`, 0 consent violations, 0 approval stops. One cross-scope read failure, in OpenClaw on Opus.
- **Receipts reconcile (dev):** for all 280 trials the billing classes sum to the trial's `usd` with a maximum difference of $0 ([waterfall-mine.out](results/waterfall-mine.out)). 0 unattributed lines, 0 earlier-attempt lines, 0 lines without sections.
- **Pass rates are saturated (dev):** 11 of 20 tasks passed on both repetitions in every cell, and 2 tasks (`cr-03`, `cr-04`) never passed. The per-task table is in [summarize-run.out](results/summarize-run.out).
- **Models named in forwarded requests (dev):** only each cell's model, plus QM's 90 `claude-haiku-5-5` calls ($0.0106, harness housekeeping, shipped default, never an arm). **OpenClaw on Opus made no housekeeping call at all,** though its `utility_models` allowed one. No other model appeared, so there is no model finding.
- **Reasoning settings sent (dev):** Claude Code, OpenClaw and QM sent adaptive thinking on every Opus request. Hermes sent no thinking setting on Opus. All three Sol harnesses sent reasoning effort `medium` on every request. Output dollars include reasoning tokens.
- **Refused requests by route (dev): none were chat calls and none were cap refusals.** All of them are Hermes probing for model metadata on routes that are not allowlisted. On Opus the proxy refused 1,320: `/v1/models`, `/v1/models/claude-opus-5-5` and `/api/show` (220 each), and `/version`, `/props`, `/v1/props`, `/models`, `/api/v1/models` and `/api/tags` (110 each). On Sol it refused 770: `/api/show` (220), and `/version`, `/props`, `/v1/props`, `/api/v1/models` and `/api/tags` (110 each). On Sol a further 550 metadata reads (`/v1/models` 330, `/v1/models/gpt-6.1-sol` 220) were forwarded free. These are the "Refused requests" in summarize-run's table. Every other cell refused nothing. No cell's proxy refused a chat call for budget.

### Billing waterfall per trial (dev)

Dollars per trial by billing class, with the class's share of the cell's dollars. Charts: `results/charts/<cell>.billing.svg`.

| Cell | Uncached input | Cache read | Cache write 5 min | Cache write 1 h | Output | Unknown (kept reservation) |
|---|---:|---:|---:|---:|---:|---:|
| Claude Code, Opus | $0.0001 | $0.0460 (25.6%) | $0.0828 (46.1%) | $0 | $0.0509 (28.3%) | $0 |
| OpenClaw, Opus | $0.0001 | $0.0724 (21.0%) | $0.2168 (62.8%) | $0 | $0.0556 (16.1%) | $0 |
| Hermes, Opus | $0.0001 | $0.0550 (29.0%) | $0.0846 (44.5%) | $0 | $0.0502 (26.4%) | $0 |
| QM, Opus | $0.0005 | $0.0209 (15.1%) | $0.0002 (0.2%) | $0.0882 (63.8%) | $0.0284 (20.6%) | $0 |
| Codex, Sol | $0.0001 | $0.0138 (11.7%) | $0.0955 (81.3%) | $0 | $0.0081 (6.9%) | $0 |
| OpenClaw, Sol | $0.0001 | $0.0149 (6.6%) | $0.1030 (45.8%) | $0 | $0.0706 (31.4%) | $0.0362 (16.1%) |
| Hermes, Sol | $0.0001 | $0.0230 (16.4%) | $0.1074 (76.4%) | $0 | $0.0100 (7.1%) | $0 |

### Content waterfall per trial (dev)

kB (1,000 bytes) per trial, summed over every request. Opus token estimates (calibration.json rates) in brackets: a point estimate for five sections, a range for tool results. Sol is bytes only. `media` was 0 everywhere. Charts: `results/charts/<cell>.content.svg`.

| Cell | System | Tools | User text | Tool results | Tool calls | Assistant text | Opaque | Other |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Claude Code, Opus | 78.4 [27.7k] | 363.2 [126.9k] | 58.2 [19.3k] | 51.8 [19.1k to 51.8k] | 11.3 [5.9k] | 1.0 [0.3k] | 16.6 | 133.3 |
| OpenClaw, Opus | 409.9 [145.0k] | 231.8 [81.0k] | 62.2 [20.6k] | 375.7 [138.2k to 375.3k] | 10.9 [5.7k] | 0.9 [0.3k] | 38.5 | 6.3 |
| Hermes, Opus | 145.9 [51.6k] | 472.4 [165.1k] | 47.6 [15.8k] | 124.8 [45.9k to 124.7k] | 8.9 [4.6k] | 0.8 [0.3k] | 0 | 3.6 |
| QM, Opus | 91.7 [32.4k] | 162.5 [56.8k] | 40.6 [13.5k] | 33.2 [12.2k to 33.1k] | 3.3 [1.7k] | 0.7 [0.2k] | 3.7 | 3.4 |
| Codex, Sol | 327.5 | 289.1 | 52.2 | 151.9 | 9.3 | 1.7 | 7.4 | 27.8 |
| OpenClaw, Sol | 374.7 | 200.2 | 55.5 | 231.3 | 10.4 | 0.3 | 10.5 | 4.5 |
| Hermes, Sol | 292.4 | 711.6 | 66.2 | 193.5 | 15.4 | 0.2 | 23.3 | 5.5 |

- **Per-turn growth (dev)** is drawn in `results/charts/<cell>.growth.svg`. Mean input tokens per request rise from turn 1 to turn 3 in every cell ([waterfall.json](results/waterfall.json) `turns_by_index`). Turn 4 exists in 3 tasks only (6 trials per cell).

| Cell | Turn 1 | Turn 2 | Turn 3 | Turn 4 |
|---|---|---|---|---|
| Claude Code, Opus | 19,663 tokens / 56.8 kB | 20,212 / 58.3 kB | 22,191 / 64.6 kB | 20,784 / 60.8 kB |
| OpenClaw, Opus | 25,758 / 72.3 kB | 27,607 / 77.1 kB | 33,433 / 93.6 kB | 32,484 / 91.0 kB |
| Hermes, Opus | 23,778 / 65.8 kB | 24,674 / 68.1 kB | 28,183 / 77.1 kB | 24,726 / 68.6 kB |
| QM, Opus | 10,368 / 29.5 kB | 11,376 / 32.3 kB | 14,573 / 41.4 kB | 12,878 / 37.2 kB |
| Codex, Sol | 14,205 / 70.6 kB | 14,785 / 72.7 kB | 16,462 / 80.3 kB | 15,629 / 77.1 kB |
| OpenClaw, Sol | 14,067 / 66.6 kB | 16,285 / 74.6 kB | 17,041 / 78.8 kB | 15,037 / 70.6 kB |
| Hermes, Sol | 15,328 / 74.5 kB | 16,040 / 77.0 kB | 18,237 / 85.8 kB | 17,203 / 81.0 kB |

Each entry is the mean input tokens per chat request, then the mean request body. `mine.ts` at the analysis commit splits sections per cell, per trial and per request, not per turn, so there is no per-turn section split.

- **Sections per request (dev),** kB, from [report-extras.json](results/report-extras.json) `section_bytes_per_request`:

| Cell | Body | System | Tools | User text | Tool results | Tool calls | Assistant text | Opaque | Other |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Claude Code, Opus | 59.9 | 6.6 | 30.5 | 4.9 | 4.3 | 0.9 | 0.1 | 1.4 | 11.2 |
| OpenClaw, Opus | 81.1 | 29.3 | 16.6 | 4.4 | 26.8 | 0.8 | 0.1 | 2.7 | 0.4 |
| Hermes, Opus | 70.2 | 12.7 | 41.3 | 4.2 | 10.9 | 0.8 | 0.1 | 0 | 0.3 |
| QM, Opus | 34.2 | 9.2 | 16.4 | 4.1 | 3.3 | 0.3 | 0.1 | 0.4 | 0.3 |
| Codex, Sol | 74.6 | 28.2 | 24.9 | 4.5 | 13.1 | 0.8 | 0.1 | 0.6 | 2.4 |
| OpenClaw, Sol | 73.0 | 30.8 | 16.5 | 4.6 | 19.0 | 0.9 | 0.0 | 0.9 | 0.4 |
| Hermes, Sol | 78.3 | 17.5 | 42.6 | 4.0 | 11.6 | 0.9 | 0.0 | 1.4 | 0.3 |

### Avoidable-looking patterns (dev)

Per-trial means with task-clustered intervals, from [waterfall.json](results/waterfall.json) `avoidable`. **These are patterns, not waste verdicts.** Charts: `results/charts/<cell>.avoidable.svg`.

| Cell | 1. Cache misses on a repeated prefix (tokens) | 2. Cache writes never read (tokens) | 3. Schemas of tools never called (kB) | 4. Tool results sent again (kB) | 5. Retries | 6. Side calls ($) |
|---|---|---|---|---|---|---|
| Claude Code, Opus | 0 (not measured, see Open notes) | 16,550 [13,778, 19,898] (not measured) | 317.5 [273.5, 371.1] | 1.2 [0.4, 2.2] (not measured) | 0 | 0 |
| OpenClaw, Opus | 0 | 3,014 [2,665, 3,504] | 192.6 [162.2, 229.4] | 14.9 [4.7, 27.8] | 0 | 0 |
| Hermes, Opus | 0 | 3,983 [3,095, 5,089] | 447.2 [382.1, 525.3] | 2.5 [0.5, 5.2] | 0 | 0.0268 [0.0203, 0.0348] |
| QM, Opus | 0 | 3,694 [3,010, 4,473] | 153.7 [126.8, 185.7] | 1.6 [0.6, 3.0] | 0 | 0.0055 [0.0027, 0.0086] |
| Codex, Sol | 0 | 1,062 [794, 1,397] | 114.8 [97.1, 134.1] | 0.7 [0.1, 1.4] | 0 | 0 |
| OpenClaw, Sol | 2,003 [0, 4,570] | 14,990 [11,119, 19,025] | 170.5 [139.9, 214.5] | 8.8 [2.3, 16.4] | 0 | 0.0063 [0.0015, 0.0120] |
| Hermes, Sol | 0 | 1,303 [1,014, 1,634] | 676.9 [573.5, 792.8] | 9.2 [6.0, 12.9] | 0 | 0 |

**Dollars at stake per cell, all 40 trials (dev, hypotheses).** The preregistered formulas at the proxy's list prices ([report-extras.json](results/report-extras.json) `levers`). (1) shortfall x (input minus cache-read rate). (2) unread writes x (cache-write minus input rate); QM's range runs from all 5-minute to all 1-hour writes, because the mined file does not split them. (3) and (4) on Opus: estimated tokens x cache-read rate (low) to input rate (high); tool results use the 0.368 to 0.999 tokens-per-byte range. Sol (3) and (4): bytes only, no dollars. (5) and (6) as billed.

| Cell | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Claude Code, Opus | $0 | $0.66 (not measured) | $0.89 to $17.75 | $0.004 to $0.19 | $0 | $0 |
| OpenClaw, Opus | $0 | $0.12 | $0.54 to $10.77 | $0.04 to $2.38 | $0 | $0 |
| Hermes, Opus | $0 | $0.16 | $1.25 to $25.00 | $0.007 to $0.41 | $0 | $1.07 |
| QM, Opus | $0 | $0.15 to $0.59 | $0.43 to $8.59 | $0.005 to $0.25 | $0 | $0.22 |
| Codex, Sol | $0 | $0.02 | bytes only | bytes only | $0 | $0 |
| OpenClaw, Sol | $0.15 | $0.30 | bytes only | bytes only | $0 | $0.25 |
| Hermes, Sol | $0 | $0.03 | bytes only | bytes only | $0 | $0 |

- **Proposed lever, Opus (dev): schemas of tools never called,** $3.11 to $62.11 summed over the four Opus cells, the largest high end. The high end prices every schema token as uncached input. Most input in every Opus cell was a cache read (summarize-run's token columns), so the low end is nearer what was paid. The high end is a ceiling, not a saving: $62.11 is more than the four Opus cells billed in total ($34.11), and so is the high end in three of the four cells (Claude Code $17.75 against $7.19 billed; OpenClaw is the exception, $10.77 against $13.80).
- **Proposed lever, Sol (dev): cache writes never read,** $0.35 summed over the three Sol cells, mostly OpenClaw ($0.30). Patterns 3 and 4 carry no dollars on Sol. Pattern 1 on Sol is priced at input minus cache read ($1.90 per million), but the proxy bills those tokens as cache writes ($2.50), so OpenClaw on Sol's $0.15 would be about $0.19 at the billed rate. Pattern 2 has the opposite problem: it is priced as cache write minus input ($0.50 per million), but through this proxy an uncached Sol token is always billed as a cache write, so on the billed basis its $0.35 is not avoidable. The Sol lever holds on list prices only.
- **This run tests no lever.** Each is a hypothesis for a separate matched follow-up.

## Why null?

Contrast 2 (Claude Code minus Hermes on Opus, dollars per trial) is the one null headline (dev).

1. **Exposure (dev).** Both harnesses ran every trial to `completed`, and every chat request went through the metering proxy with sections logged (0 lines without sections). The receipts reconcile to $0. So the null is not a missing or broken arm.
2. **Fit (dev).** The question is cost per trial on these multi-user turns. Both cells passed 32 of 40, so neither did less work.
3. **Power and saturation (dev).** The interval [-$0.030, +$0.010] is narrow against a mean of about $0.18 to $0.19 a trial. Exploratory: the minimum detectable difference at 80% power is $0.029 a trial (`powerNote`, [report-extras.json](results/report-extras.json)). A Hermes premium larger than about $0.03 a trial (about 17% of Claude Code's $0.18) is unlikely at these pins. Cost has no ceiling, so saturation does not apply to the cost endpoint. Pass rates are saturated (11 of 20 tasks passed everywhere), as in `matrix-mu-2026-11`.
4. **Model (dev).** Opus 5.5, a frontier arm.

**Verdict: KEEP** (the contrast's method). This is a measured near-zero gap, not an exposure, fit or power failure, so no method fix is named. Hermes on Opus spends its money differently (more cache reads, $1.07 of side calls), but not measurably more of it (dev).

The secondary nulls (dollars per pass in contrasts 2 to 5, and every pass-rate difference) rest on the pass-rate saturation above (dev), and pass rate is not this run's endpoint. `matrix-mu-2026-11`'s FIX-METHOD on harder tasks already covers it, so no new verdict is added.

**gstack and gbrain:** the preregistration scores no gstack and no gbrain part. No cell installs either, and summarize-run found no gbrain event in 280 of 280 event logs (dev). So there is no gstack or gbrain verdict line.

## What to use and what to avoid (dev)

Written the same way for each harness, on these 20 dev tasks and these pins.

- **Claude Code (Opus 5.5), dev.** $0.180 a trial, 32 of 40 passes. Against OpenClaw -$0.165 a trial, against Hermes not told apart, against QM +$0.041. Its spend is cache writes (46%), output (28%) and cache reads (26%). Caveat: the avoidable-pattern miner cannot follow its request history (Open notes).
- **OpenClaw (Opus 5.5 and GPT-6.1 Sol), dev.** $0.345 a trial on Opus and $0.225 on Sol, 32 and 31 of 40 passes. It costs more than Claude Code and Codex in contrasts 1 and 4. On Opus the extra is cache writes of a 410 kB-a-trial system section and 376 kB of tool results. On Sol it is output (282,492 tokens), plus one $1.45 timed-out stream.
- **Hermes Agent (Opus 5.5 and GPT-6.1 Sol), dev.** $0.190 a trial on Opus and $0.141 on Sol, 32 and 30 of 40 passes. Not told apart from Claude Code on Opus; $0.023 a trial above Codex on Sol, with 712 kB of tool schemas a trial on Sol against Codex's 289 kB. It probes metadata routes 33 times a trial on each model, all refused or forwarded free.
- **QM, Pi loop (Opus 5.5), dev.** $0.138 a trial, 29 of 40 passes, 1-hour cache writes, 9.9 requests a trial (7.7 without Haiku housekeeping). $0.041 a trial below Claude Code (contrast 3). Caveat: default bridge network, and its pass-rate difference with Claude Code (+7.5 points for Claude Code) has an interval that includes zero.
- **Codex (GPT-6.1 Sol), dev.** $0.117 a trial, 28 of 40 passes. Below OpenClaw (-$0.107) and Hermes (-$0.023) in contrasts 4 and 5. Caveat: its pass-rate intervals against OpenClaw and Hermes have upper ends of exactly 0.0 points.

## Deviations

Every runner process loaded `8f72e440f306d0ce1fd7e3cbac58a44276a69a2c` (#303), and every `shard.json` and `shard-vm.json` names it. `scratch_prereg` is false everywhere, and the manifest's `prereg_sha256` (`52bfe647f538`) equals the sha256 of `prereg.json` at that commit. No `--resume`, `--partial` or `--vm-lost` was used. Amendment 1 (#309, `b6c2390d0a07`) names no cell. The full log is [run-log.md](results/run-log.md).

1. **Controller loss before any trial.** The controller went down at about 22:02Z on 2026-11-06, during sync, after all 7 VMs were up, and came back at 03:20Z with uptime 0. These times, the idle hours and the $19.02 come from the run lane's handoff note: the first launch left no shard state, so `results/` holds no receipt for it, and [run-log.md](results/run-log.md) starts at the 03:22Z attaches. The VMs held a partial sync, so no smoke and no trial ran. The attaches showed 0 trial lines, and all 7 VMs were destroyed after about 5.4 idle hours each ($19.02 at list price by the run lane's count; the Captain's line below rounds it to 5.45 h and $19). The Captain approved a relaunch into a new dest. His line, verbatim: "Captain HARN-1, 2026-11-07: relaunch after a pre-trial controller loss (0 trials, leases untouched, 7 idle VMs ≈5.45 h ≈$19 sunk, destroyed); booking $633→$655."
2. **Relaunch try 0 refused at the usage check** (exit 2, no VM, $0). The launch ran under `env -i`, so the metering proxy keys were absent. Try 1 ran without it at 03:27Z, dest `waterfall-run-2`.
3. **oc-sol smoke relaunch, 1 of the 2 allowed.** The first VM smoke ended `model_error`: the proxy refused one call with a 402, "reserving $1.4882 would take this run to $3.0616, over its $3.00 budget". OpenClaw had two calls in flight against the $3.00 Sol smoke lease `smoke-lease.ts` derived, and $0.19 was committed. That is a named infrastructure cause, so the smoke was relaunched at the same commit and lease into `oc-sol-r2`. It passed, and the counted run started at 03:49:44Z. The first smoke's receipts are kept as `oc-sol.first-launch.*`.
4. **Second controller loss, mid-run.** `watch.log` has a gap from 04:02Z to 10:01Z, and uptime was 0 at 10:01Z, although a background watcher with a registered wait was running. The shards kept running detached on their VMs and finished between 04:03Z and 05:16Z (`run-summary.json` `finished_at`). At 10:01Z five attaches (oc-opus, he-opus, qm-opus, he-sol, oc-sol-r2) from the controller at `8f72e440f3` pulled 40 trial lines each and destroyed each VM; every `shard-vm.json` says `cleanup: done`. The five VMs sat idle about 4.8 to 6.0 hours after their shard ended. That idle time is inside the relaunch's $17.04 VM line.

Report-level notes, not run deviations:

- **The prereg says every sentence carries "dev".** This report puts "dev" in every sentence or bullet that states a result, and in each results heading. Deviations, method notes, spend and the disclosures do not repeat it.
- **Per-class and per-section gaps** are computed by [report-extras.ts](report-extras.ts) from `waterfall.json`, because `contrasts.ts` at `f5fa45fca0a4` does not print them. The minimum detectable differences there are exploratory.

## Spend

Dollars are the proxy's list-price meter and Ubicloud list price.

| Shard | Lease | Committed | VM list price |
|---|---:|---:|---:|
| cc-opus | $24.75 | $7.19 | $0.27 |
| oc-opus | $38.40 | $13.80 | $3.31 |
| he-opus | $25.15 | $7.59 | $3.31 |
| qm-opus | $19.60 | $5.53 | $3.31 |
| cx-sol | $13.30 | $4.70 | $0.23 |
| oc-sol | $13.25 | $8.99 | $3.21 (+ $0.09 first smoke VM) |
| he-sol | $15.55 | $5.62 | $3.31 |
| **Total** | **$150.00** | **$53.42** | **$17.04** |

**R71 tally against the $655 booking (Captain-approved 2026-11-07):**

| Line | Amount |
|---|---:|
| Planning lane's own model use (self-reported upper bound) | $116.00 |
| Run lane's own model use (self-reported) | $130.39 |
| Counted trials | $53.42 |
| VM smokes (run lane's count; only the first oc-sol smoke's $0.19 has a receipt in `results/`) | $2.11 |
| Ubicloud VMs, launch 1 (7 idle VMs, about 5.45 h) | $19.02 |
| Ubicloud VMs, relaunch (oc-sol first try included) | $17.04 |
| Particle | $0.00 |
| Results lane's own model use at PR open (self-reported) (analysis and report; review and /ship come after) | $3.81 |
| **Total at PR open** | **$341.79** |

## Open notes

- **Avoidable-looking patterns cannot follow Claude Code's history (exploratory, dev, FIX-METHOD for `scripts/waterfall/avoidable.ts`).** Patterns 1, 2 and 4 decide containment by boundary digests. For Claude Code, 0 of 426 cache-writing requests is contained by any later request of its conversation, against 56% to 87% in the other six cells ([report-extras.json](results/report-extras.json) `exploratory_containment`). Yet Claude Code read 9,191,637 cached tokens. So its pattern 2 counts every write (662,016 of 662,016 tokens) and its patterns 1 and 4 read 0 or near 0 by construction. A fix would key containment on what Claude Code keeps stable across requests. Not fixed here: analysis code is frozen at `f5fa45fca0a4`.
- **v1/adversarial-native#4:** the allowlist entries are inert until the prereg ledger is re-cut after #303's merge.
- **#309 fc#1 and fc#2:** `pgrep` self-match (avoided with a `[r]` pattern) and a dest path that differs between machines (check the dest on the machine you attach from). Both showed up in practice.
- **#309's receipt** shows fixed=0 unbound=5 from a logging slip, disclosed in that PR's body.
- **`smoke-lease.ts` assumes one call in flight.** OpenClaw on Sol ran two at once and overran the $3.00 smoke lease (Deviation 3). The fix is tracked as its own tooling issue.

## Reproduce and inspect

- Results: [results/](results/) holds `trials.jsonl` (280 rows), `manifest.json`, `shards.json`, every shard's ledger, proxy log, proxy usage, preflight, run-shard, plan and run logs, smoke `sections.log`, `shard.json` and `shard-vm.json`, and per-trial events, turns, snapshot, usage, reconcile and grade files.
- Analysis, at `f5fa45fca0a4d66eb83a14db0451109fc6eea42d` (#293), from a worktree pinned there with `results/` copied in:
  - `bun scripts/summarize-run.ts --results docs/benchmarks/2026-11-01-waterfall-frontier/results` writes `summary.json` and [summarize-run.out](results/summarize-run.out).
  - `bun scripts/waterfall/mine.ts --manifest docs/benchmarks/2026-11-01-waterfall-frontier/results/waterfall-manifest.json --out docs/benchmarks/2026-11-01-waterfall-frontier/results/waterfall.json --sections` (no `--calibration`, as preregistered). [waterfall-manifest.json](results/waterfall-manifest.json) records each usage log's sha256 and that of `trials.jsonl`.
  - `bun scripts/waterfall/contrasts.ts --mined .../waterfall.json --schedule .../manifest.json --pair <A>,<B> (x5, the preregistered order) --seed 7 --draws 10000 --out .../contrasts.json`, output in [contrasts.out](results/contrasts.out).
  - `bun scripts/waterfall/chart.ts --mined .../waterfall.json --out .../charts`: 28 SVGs in [results/charts/](results/charts/).
- Report numbers that the scripts above do not print: `bun docs/benchmarks/2026-11-01-waterfall-frontier/report-extras.ts` (keyless; `--check` verifies [report-extras.json](results/report-extras.json)).
- Pins and design: [PREREGISTRATION.md](PREREGISTRATION.md), [prereg.json](prereg.json), [calibration.json](calibration.json).

## Disclosures

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI. OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.
