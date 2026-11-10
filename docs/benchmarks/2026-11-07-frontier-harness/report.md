# Frontier harness rerun (frontier-harness-2026-11): report

- **We learned that most third-party harnesses passed within 15 points of the model's own harness. You should choose among those on cost and speed, measured on your own tasks.** On GPT-6.1 Sol, Hermes, OpenClaw and Pi each passed within 15 points of Codex (preregistered non-inferiority, Holm-adjusted). On Opus 5.5, Hermes and Pi did the same against Claude Code, but both intervals sit wholly below zero, and Claude Code on Opus is near the ceiling (90.4% of the 52 tasks at stage 0). Pi had the shortest median trial on both models (196 s against Claude Code's 252 s, 221 s against Codex's 279 s). Its cost per solved task was 0.97x Claude Code's [0.75x, 1.17x] and 0.67x Codex's [0.51x, 0.85x].
- **We learned that OpenClaw on Opus was behind Claude Code: -12.5 points [-22.1, -3.8], Holm p 0.037, at 1.40x the cost per solved task [1.19x, 1.68x]. You should not pick OpenClaw for Opus terminal work.** The call is fragile: it is inconclusive under amendment 4's outage classification alone and when refusals are removed, and Claude Code's near-ceiling score on Opus applies. On Sol, OpenClaw cleared the 15-point margin but cost 1.80x Codex's per solved task [1.51x, 2.18x].
- **We learned that plumbing outside the model moved scores more than some harness gaps. You should check that your grader ran, audit what the agent received, and read refusals per harness.** A GitHub outage left 353 trials graded 0 with no test run, reclassifying 35 of them flipped 3 of 6 verdicts, and counting the paid-twice outage runs in cost would have made every cell but Codex (which finished before the outage) look dearer. Hermes's built-in web tools (in one case through a sub-agent) returned the answer key in 4 trials. Harbor's Pi adapter crashes before any request when a task's instruction starts with "- ". The same provider safety refusal shows up as a refusal, an exit code or an ordinary fail depending on the harness.

**The lesson this run is after:** when you run a frontier model through a third-party harness instead of its own, how much pass rate do you give up, and what does it cost?

**Answer: on 52 Terminal-Bench 2.1 tasks, 5 of 6 third-party pairs were no more than 15 points worse than the model's own harness; OpenClaw on Opus was behind.** Opus comparisons carry the ceiling caveat below.

- **Pass rate, Opus 5.5** (task mean [95% range], passes / scored trials, 52 tasks unless noted): Claude Code 88.5% [79.8%, 96.2%] (91 / 103); Hermes 81.7% [72.1%, 91.3%] (85 / 104); OpenClaw 76.0% [64.4%, 86.5%] (79 / 104); Pi 81.4% [71.6%, 90.2%] (83 / 102, 51 tasks).
- **Pass rate, GPT-6.1 Sol:** Codex 83.7% [74.0%, 92.3%] (87 / 104); Hermes 85.6% [76.9%, 93.3%] (88 / 103); OpenClaw 76.0% [64.4%, 86.5%] (79 / 104); Pi 80.4% [70.6%, 90.2%] (82 / 102, 51 tasks).
- **Cost per solved task** (list price through our metering proxy; a cell's recorded spend over its scored passes, counting each trial's record and leaving out the 351 outage runs a rerun replaced, whose passes are not counted either; excluded trials that were not replaced stay in, as in the matrix runs): Opus: Claude Code $0.63 [$0.41, $0.89], Hermes $0.88 [$0.54, $1.38], OpenClaw $0.88 [$0.57, $1.29], Pi $0.62 [$0.35, $0.95]. Sol: Codex $0.34 [$0.25, $0.46], Hermes $0.43 [$0.31, $0.60], OpenClaw $0.61 [$0.40, $0.95], Pi $0.23 [$0.17, $0.31].
- **Cost per solved task with all spend** (descriptive; the replaced outage runs' spend added, [results/sensitivity-cost-with-replaced-runs](results/sensitivity-cost-with-replaced-runs/analysis.md)): Opus: Claude Code $0.79 [$0.52, $1.12], Hermes $1.18 [$0.74, $1.84], OpenClaw $1.25 [$0.78, $1.87], Pi $0.93 [$0.50, $1.47]. Sol: Codex $0.34 [$0.25, $0.46], Hermes $0.63 [$0.44, $0.89], OpenClaw $0.99 [$0.62, $1.57], Pi $0.36 [$0.27, $0.49].
- **Why the headline leaves the replaced runs out:** the preregistration's "cell's recorded USD" did not foresee replaced runs, and both readings were chosen after seeing the data. The outage hit every cell except Codex, which finished before it, so the all-spend figure charges every other cell for an infrastructure event, not a harness property.
- **Median time per trial** (4 trials at a time per VM, so "contended"): Opus: Claude Code 252 s, Hermes 427 s, OpenClaw 288 s, Pi 196 s. Sol: Codex 279 s, Hermes 439 s, OpenClaw 326 s, Pi 221 s.
- **Calls** (Holm family of 3 per model; "within 15" means the one-sided 15-point non-inferiority test passed): Opus: Hermes within 15, OpenClaw **behind**, Pi within 15. Sol: Hermes, OpenClaw and Pi within 15. MDD at 80% power: 7.5 to 13.3 points. Every Opus comparison carries the ceiling caveat: Claude Code on Opus passed 90.4% of the 52 tasks at stage 0.
- **These calls depend on how the outage trials are classified.** Under amendment 4's classification alone, 3 of 6 change: OpenClaw on Opus is inconclusive instead of behind, OpenClaw on Sol is behind instead of within 15, and Pi on Sol is inconclusive instead of within 15. See [The GitHub outage](#the-github-outage-amendments-4-and-6).
- **Verdict (Why null?, for the one behind pair):** OpenClaw on Opus, CUT-CANDIDATE for Opus terminal work: use Claude Code instead.
- **Caveats:**
  - Dev tasks at these pins, public since 2025: memorization is possible; the paired design mostly cancels it within a model.
  - Claude Code on Opus is near the ceiling (90.4% of the 52 tasks at stage 0), which compresses every Opus gap.
  - 353 of the 896 trials (kept sample included) hit a GitHub outage at grade time; 351 were rerun once and 2 reruns were stopped by their lease. The outage rule was widened after the first reruns' results existed (amendment 6).
  - Within 15 is not "equal": Hermes on Opus (-6.7 [-13.5, -1.0]), Pi on Opus (-5.9 [-11.8, -1.0]) and OpenClaw on Sol (-7.7 [-14.4, -1.9]) have intervals wholly below zero.
  - Refusals count as fails, as preregistered; removing every provider refusal turns OpenClaw on Opus from behind to inconclusive.
  - Extension rows (GPT-6 Astra and Claude Fable 5.1) are one attempt, descriptive only.
- **Status:** results PR [#337](https://github.com/garrytan/harness-evals/pull/337); claim check: one reviewer on that PR (R51). Words: [glossary](../../glossary.md).

## What ran

- **Tasks:** 52 Terminal-Bench 2.1 tasks (60 planned, 8 set aside as the kept sample, which ran but is reported separately; see [PREREGISTRATION.md](PREREGISTRATION.md)), in one shared order, 2 attempts per task per cell.
- **Core cells, 8:** each model in its own harness and in three third-party harnesses.
  - Opus 5.5: Claude Code 2.1.312 (home), Hermes v2026.9.24, OpenClaw 2026.10.6, Pi 1.5.0.
  - GPT-6.1 Sol: Codex 0.165.0 (home), Hermes, OpenClaw, Pi.
  - All run through Harbor 0.24.0, effort high on every agent-loop request (checked per request), retries off, hosted web search off.
- **Kept sample:** 8 tasks the leaderboard already solves, per cell, descriptive.
- **Extension (descriptive, one attempt):** GPT-6 Astra in Codex and OpenClaw, Claude Fable 5.1 in Claude Code and OpenClaw (amendment 3).
- **Every cell is a plain harness.** No gstack and no gbrain in any arm: each VM's preflight refused a Capy drive or a gstack install, and the audit found 0 reads of a gstack file in every cell.
- **Where:** one Ubicloud standard-16 VM per shard, one shard per core cell plus its kept cell, 4 trials at a time.
- **Amendments:** 6, each a dated commit on the results branch. Amendments 1, 3 and 5 came before the trials they affected. Amendment 2 was made after seeing stage 0's results, amendment 4 after the main stage's (it reclassifies trials that had already run), and amendment 6 after amendment 4's reruns (see below). [AMENDMENTS.md](AMENDMENTS.md).
- **Preregistered limits:** the bonus QM cell was dropped before any trial (QM's agent loop can't work on the task container's files). Codex 0.165.0 caps Sol's context window at 872,000 tokens. Claude Code's adapter pins its small-fast housekeeping model to the cell model, a declared deviation from the crew's shipped-default rule.

## Results

### Harness by model

| Harness | Opus 5.5 | GPT-6.1 Sol |
|---|---|---|
| Claude Code | 88.5% [79.8%, 96.2%], $0.63 per solve ($0.79 with all spend), 252 s, **home** | not run |
| Hermes | 81.7% [72.1%, 91.3%], $0.88 per solve ($1.18), 427 s, **within 15** | 85.6% [76.9%, 93.3%], $0.43 per solve ($0.63), 439 s, **within 15** |
| OpenClaw | 76.0% [64.4%, 86.5%], $0.88 per solve ($1.25), 288 s, **behind** | 76.0% [64.4%, 86.5%], $0.61 per solve ($0.99), 326 s, **within 15** |
| Pi | 81.4% [71.6%, 90.2%], $0.62 per solve ($0.93), 196 s, **within 15** | 80.4% [70.6%, 90.2%], $0.23 per solve ($0.36), 221 s, **within 15** |
| Codex | not run | 83.7% [74.0%, 92.3%], $0.34 per solve ($0.34), 279 s, **home** |

Rows are in the preregistered order, not a ranking. Each Opus comparison carries the ceiling caveat: Claude Code on Opus passed 90.4% of the 52 tasks at stage 0.

### Pairs: third-party harness minus home harness

| Model | Harness | Difference, points [95% range] | 90% lower bound | Tasks paired | Holm p (two-sided) | Holm p (within 15) | Cost per solve, ratio to home [95% range] (with all spend) | Call | Call under amendment 4 only |
|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | Hermes | -6.7 [-13.5, -1.0] | -12.5 | 52 | 0.125 | 0.024 | 1.41x [1.07x, 1.82x] (1.49x [1.12x, 1.97x]) | within 15 | within 15 |
| Opus 5.5 | OpenClaw | -12.5 [-22.1, -3.8] | -20.2 | 52 | 0.037 | 0.294 | 1.40x [1.19x, 1.68x] (1.57x [1.26x, 1.98x]) | **behind** | inconclusive |
| Opus 5.5 | Pi | -5.9 [-11.8, -1.0] | -10.8 | 51 | 0.125 | 0.004 | 0.97x [0.75x, 1.17x] (1.15x [0.83x, 1.46x]) | within 15 | within 15 |
| GPT-6.1 Sol | Hermes | +1.9 [-4.8, +8.7] | -2.9 | 52 | 1.000 | <0.001 | 1.28x [1.05x, 1.54x] (1.87x [1.51x, 2.29x]) | within 15 | within 15 |
| GPT-6.1 Sol | OpenClaw | -7.7 [-14.4, -1.9] | -13.5 | 52 | 0.100 | 0.015 | 1.80x [1.51x, 2.18x] (2.92x [2.36x, 3.55x]) | within 15 | **behind** |
| GPT-6.1 Sol | Pi | -2.9 [-11.8, +5.9] | -10.8 | 51 | 1.000 | 0.009 | 0.67x [0.51x, 0.85x] (1.06x [0.77x, 1.39x]) | within 15 | inconclusive |

- **Pi's pairs have 51 tasks:** pytorch-model-recovery has no scored Pi attempt on either model (see [Pi crashes on one instruction](#pi-crashes-on-one-instruction)).
- **The 90% lower bound** is what the 15-point non-inferiority test compares with -15.
- **Opus rows carry the ceiling caveat:** Claude Code on Opus passed 90.4% of the 52 tasks at stage 0.

### How much each call depends on the analysis choices

Every line below reruns the same analysis on a changed copy of the results. Only the headline sets a call; the rest are descriptive.

| Line | Opus: Hermes | Opus: OpenClaw | Opus: Pi | Sol: Hermes | Sol: OpenClaw | Sol: Pi |
|---|---|---|---|---|---|---|
| **Headline** (amendments 4 and 6) | -6.7 [-13.5, -1.0], within 15 | -12.5 [-22.1, -3.8], behind | -5.9 [-11.8, -1.0], within 15 | +1.9 [-4.8, +8.7], within 15 | -7.7 [-14.4, -1.9], within 15 | -2.9 [-11.8, +5.9], within 15 |
| Amendment 4 only (the 35 scored as the fails they were recorded as) | -3.8 [-11.5, +3.8], within 15 | -10.6 [-20.2, -1.9], inconclusive | -6.9 [-13.7, 0.0], within 15 | +1.0 [-5.8, +7.7], within 15 | -14.4 [-21.2, -7.7], behind | -8.8 [-19.6, +1.0], inconclusive |
| Without the 3 drifted tasks (amendment 1) | -7.1 [-14.3, -1.0], within 15 | -13.3 [-23.5, -5.1], behind | -6.3 [-12.5, -1.0], within 15 | +3.1 [-3.1, +10.2], within 15 | -7.1 [-14.3, -1.0], within 15 | -3.1 [-12.5, +6.3], within 15 |
| Without Harbor-labelled refusals (added in amendment 2, after stage 0) | -7.1 [-14.3, -1.0], within 15 | -11.5 [-20.8, -3.1], inconclusive | -6.3 [-12.5, -1.0], within 15 | +2.0 [-3.9, +8.8], within 15 | -7.8 [-14.7, -2.0], within 15 | -5.0 [-13.0, +3.0], within 15 |
| Without every provider refusal, any harness (added in this report) | -6.1 [-13.3, 0.0], within 15 | -11.5 [-20.8, -3.1], inconclusive | -4.2 [-9.4, 0.0], within 15 | +2.0 [-3.9, +8.8], within 15 | -7.8 [-14.7, -2.0], within 15 | -5.0 [-13.0, +3.0], within 15 |
| First runs inside the outage window removed (amendment 4) | -4.3 [-12.0, +1.1], within 15 | -21.7 [-34.8, -10.9], behind | -4.5 [-10.2, 0.0], within 15 | +5.4 [-2.2, +14.1], within 15 | -5.1 [-11.2, 0.0], within 15 | +2.1 [-7.3, +12.5], within 15 |
| Pi's crashed attempts scored as fails (added in this report) | -6.7 [-13.5, -1.0], within 15 | -12.5 [-22.1, -3.8], behind | -7.7 [-14.4, -1.9], within 15 | +1.9 [-4.8, +8.7], within 15 | -7.7 [-14.4, -1.9], within 15 | -4.8 [-14.4, +4.8], within 15 |

Pass rate per cell under the lines the amendments asked for (task mean [95% range]; the rest are in each line's analysis.md):

| Cell | Headline | Amendment 4 only | Without the 3 drifted tasks (amendment 1) | Without Harbor-labelled refusals (added in amendment 2, after stage 0) | Outage-window first runs removed (amendment 4) |
|---|---|---|---|---|---|
| Opus 5.5, Claude Code | 88.5% [79.8%, 96.2%] | 85.6% [76.9%, 93.3%] | 89.8% [80.6%, 96.9%] | 93.9% [86.7%, 99.0%] | 88.5% [79.8%, 96.2%] |
| Opus 5.5, Hermes | 81.7% [72.1%, 91.3%] | 81.7% [72.1%, 91.3%] | 82.7% [72.4%, 91.8%] | 81.7% [72.1%, 91.3%] | 82.0% [72.0%, 92.0%] |
| Opus 5.5, OpenClaw | 76.0% [64.4%, 86.5%] | 75.0% [64.4%, 85.6%] | 76.5% [65.3%, 86.7%] | 77.5% [66.7%, 87.3%] | 73.0% [60.0%, 85.0%] |
| Opus 5.5, Pi | 81.4% [71.6%, 90.2%] | 77.5% [67.6%, 86.3%] | 82.3% [72.9%, 91.7%] | 81.4% [71.6%, 90.2%] | 81.1% [70.0%, 91.1%] |
| GPT-6.1 Sol, Codex | 83.7% [74.0%, 92.3%] | 83.7% [74.0%, 92.3%] | 82.7% [72.4%, 91.8%] | 85.3% [75.5%, 94.1%] | 83.7% [74.0%, 92.3%] |
| GPT-6.1 Sol, Hermes | 85.6% [76.9%, 93.3%] | 84.6% [76.0%, 92.3%] | 85.7% [76.5%, 93.9%] | 87.3% [78.4%, 95.1%] | 85.9% [76.1%, 94.6%] |
| GPT-6.1 Sol, OpenClaw | 76.0% [64.4%, 86.5%] | 69.2% [57.7%, 79.8%] | 75.5% [64.3%, 86.7%] | 77.5% [66.7%, 87.3%] | 76.5% [64.3%, 87.8%] |
| GPT-6.1 Sol, Pi | 80.4% [70.6%, 90.2%] | 74.5% [63.7%, 84.3%] | 79.2% [67.7%, 88.5%] | 80.4% [70.6%, 90.2%] | 83.3% [72.9%, 92.7%] |

- **The outage call is the one that matters.** Under amendment 4's classification, 35 ungraded trials count as agent fails (9 of them OpenClaw on Sol, 6 Pi on Sol), and three calls change: OpenClaw on Opus inconclusive instead of behind; OpenClaw on Sol behind instead of within 15; Pi on Sol inconclusive instead of within 15.
- **OpenClaw on Opus is behind only under the headline's two choices.** With refusals removed (either way of finding them) it is -11.5 [-20.8, -3.1], and under amendment 4 alone -10.6 [-20.2, -1.9]: still below zero, but no longer significant after Holm.
- **Opus rows carry the ceiling caveat** (Claude Code on Opus passed 90.4% of the 52 tasks at stage 0).

## The GitHub outage (amendments 4 and 6)

- **What happened:** 318 of the 756 main-stage trials hit a GitHub outage between 08:45Z and 12:07Z on 2026-11-08 ([GitHub's incident](https://www.githubstatus.com/incidents/pyynvrm1vskw) resolved at 12:32Z). Each task's verifier downloads uv from github.com before it runs the tests. When that failed, no test ran and the trial was graded 0.
- **Amendment 4:** a fixed log signature listed those 318 trials, the list was committed, and each was rerun once under the same trial id, scored exactly as a first run. Two more trials hit the download failure, retried, ran their tests and passed; they stay scored.
  - By cell: opus-cc 30, opus-hermes 40 (kept 4), opus-openclaw 36 (kept 6), opus-pi 40 (kept 6), sol-hermes 48 (kept 7), sol-openclaw 48 (kept 5), sol-pi 46 (kept 2), sol-codex 0.
- **Amendment 4's signature was incomplete.** In 35 more trials, uv downloaded and then uv's own download of a Python build from github.com failed (mostly 504), so again no test ran.
- **Amendment 6 was written after amendment 4's rerun results existed.** The widening was chosen because the in-window failure gap pointed at it: graded first runs that ended inside the window failed 30% of the time (53 of 177 completed trials) against 12% for every other completed record (78 of 652, amendment-4 reruns included, the figure amendment 6 quotes; 13%, 49 of 365, counting first runs only) ([results/outage-window.json](results/outage-window.json)).
  - The widened signature has two parts that must both hold: the verifier output has no pytest summary line, and it shows a failed download from github.com. It cannot see outcomes: every listed trial has reward 0 because no test ran.
  - Applied to every scored trial, it found amendment 4's 318 again plus 35 more, all main-stage first runs that ended between 08:54Z and 11:46Z. By cell: opus-cc 3, opus-hermes kept 3, opus-openclaw 2 (kept 1), opus-pi 6 (kept 1), sol-hermes 1, sol-openclaw 9, sol-pi 6 (kept 3).
  - Each of the 35 was rerun once. No rerun of either amendment hit the signature again, and no extension trial hit it.
- **In-window and out-of-window line (descriptive):** graded first runs that ended inside the window pass 81.2% (125 / 154); every other scored trial passes 81.7% (601 / 736; lookups count as fails in both). The gap is gone once the 35 are reclassified. Per cell (in-window first runs passed / scored, then every other scored trial): opus-cc 7/7, 84/96; opus-hermes 16/21, 69/83; opus-openclaw 22/26, 57/78; opus-pi 18/23, 65/79; sol-codex 0/0, 87/104; sol-hermes 29/32, 59/71; sol-openclaw 13/17, 66/87; sol-pi 13/18, 69/84 (kept cells in the receipt).
- **Agents may also have hit GitHub mid-task in that window** (a pip or git clone from github.com). The verifier logs can't separate that. 2 in-window agent logs show a GitHub error (both Pi on Opus, against 2 outside the window; results/outage-window.json), and the outside-window line above gives no call that differs from the headline.
- **The lesson for anyone grading agents:** a reward of 0 is not a fail unless the tests ran. Check for the test runner's summary line before you score.

## What we learned about each harness

### Provider refusals look different in every harness

- **Opus's safeguards refused the three biology tasks in every harness,** not only Claude Code: protein-assembly, dna-assembly and dna-insert, plus a few others, mostly cyber-flavoured (feal-linear-cryptanalysis, password-recovery). Sol refused model-extraction-relu-logits in Codex, Hermes and OpenClaw.
- **Each harness reports the refusal differently** (Harbor's label per refused trial, kept sample included, in results/merged/trials.jsonl):
  - Claude Code and Codex: always an AgentSafetyRefusalError (Opus 6, Sol 2).
  - Hermes on Opus: it prints "safety filter refused this request" and exits non-zero, so Harbor records NonZeroAgentExitCodeError (8). Hermes on Sol: AgentSafetyRefusalError on both model-extraction-relu-logits attempts, and one ordinary fail.
  - OpenClaw: it logs "The provider refused this request (category: bio)". On Opus Harbor records NonZeroAgentExitCodeError 6 times and AgentSafetyRefusalError 3 times (feal-linear-cryptanalysis twice, one kept task); on Sol AgentSafetyRefusalError twice.
  - Pi: it logs the provider's stop reason ("rawStopReason":"refusal") and ends normally, so the trial is an ordinary fail (9).
- **Trials with a provider refusal, found the same way in every harness** (scripts/frontier-harbor/refusals.ts; every one of them failed): Opus: Claude Code 6, Hermes 7 (+1 kept), OpenClaw 8 (+1 kept), Pi 8 (+1 kept). Sol: Codex 2, Hermes 3, OpenClaw 2, Pi 0.
- **Pi on Sol passed model-extraction-relu-logits on both attempts.** Every other Sol harness was refused on that task both times.
- **Why it matters:** amendment 2's refusal line drops only trials Harbor labels AgentSafetyRefusalError, so it removes all of Claude Code's and Codex's refusals, Hermes's 2 on Sol, OpenClaw's 2 on Sol and 2 of its 8 core refusals on Opus, and keeps Hermes's on Opus and all of Pi's. That flatters the home harnesses. The any-harness line above fixes that, and the calls are the same as amendment 2's line.

### Hermes searches the web, and sometimes finds the answer key

- **Hermes ships web tools that are on by default:** web_search, web_extract and a browser. Claude Code's and Codex's hosted search were off in this run, and OpenClaw and Pi declared no web tool.
- **Hermes on Sol called a web or browser tool in 25 of 112 trials, and handed work to a sub-agent (delegate_task) in 26, 17 of them with no direct web call; Hermes on Opus called web_search in 2 and never delegated** ([results/hermes-web-tools.json](results/hermes-web-tools.json)).
- **The contamination audit flagged 23 trials. A reader blind to the harness confirmed 4 as answer-key receipts,** all Hermes: on Sol, protein-assembly (attempt 1) and gpt2-codegolf (attempt 2), and the kept task mteb-leaderboard; on Opus, the kept task extract-elf. In three of them, a web_search or web_extract result returned the task's reference solution or hidden tests, with the benchmark's canary string. In the fourth (gpt2-codegolf), the hidden tests came back in the result of a Hermes sub-task (delegate_task), whose own steps the capture does not show.
- **As preregistered, all 4 count as fails** (all 4 had passed). The other 19 flags were a canary inside a task's own data file (llm-inference-batching-scheduler, all harnesses) or task input that overlaps the hidden tests (sanitize-git-repo).
- **The egress blocklist didn't stop it.** It blocks the benchmark's own hosts; these copies came back through Hermes's web tools.
- **The lesson:** if you benchmark Hermes, decide about its web tools on purpose. Turned on, they are a path to the answer key on public benchmarks.

### Pi crashes on one instruction

- **On pytorch-model-recovery, all 4 Pi attempts (both models) sent no model request.** Harbor's Pi adapter passes the task instruction as a bare command-line argument. This task's instruction starts with "- ", so Pi parses it as an option and exits with "Error: Unknown option: -".
- **The preregistered rule classes this as infra** (no_model_response), so the task drops from Pi's pairs. Scoring the 4 attempts as fails instead moves Pi on Opus to -7.7 and Pi on Sol to -4.8; both stay within 15.
- **The fix is one "--" in the adapter's command line,** before the instruction.

### Cost and speed

- **The outage runs a rerun replaced are left out of cost.** A rerun is paid again, and Codex's trials all finished before the outage, so the all-spend figures in brackets below are higher for every other cell for reasons that have nothing to do with the harness.
- **Pi had the shortest median trial on both models.** Its cost per solved task was 0.67x Codex's [0.51x, 0.85x] and 0.97x Claude Code's [0.75x, 1.17x] (all spend: 1.06x and 1.15x).
- **Hermes had the longest median trial:** about 430 s on both models, 1.6 to 1.7x the home harness, at 1.41x its cost per solve on Opus and 1.28x on Sol (all spend: 1.49x and 1.87x).
- **OpenClaw on Sol cost 1.80x Codex per solved task** [1.51x, 2.18x] (all spend: 2.92x [2.36x, 3.55x]).

## Extension: GPT-6 Astra and Claude Fable 5.1 (descriptive)

- **What ran:** one attempt on all 52 tasks per cell: GPT-6 Astra in Codex (home) and OpenClaw; Claude Fable 5.1 in Claude Code (home) and OpenClaw. Estimates and intervals only, no test (preregistered).
- **GPT-6 Astra:** Codex 86.5% [76.9%, 94.2%], $1.78 per solved task, 304 s; OpenClaw 75.0% [63.5%, 86.5%], $3.83 per solved task, 402 s. OpenClaw minus Codex: -11.5 points [-23.1, +0.0], at 2.15x the cost per solved task [1.64x, 2.83x].
- **Claude Fable 5.1:** Claude Code 71.2% [57.7%, 82.7%], $2.86 per solved task, 416 s; OpenClaw 65.4% [51.9%, 78.8%], $2.32 per solved task, 389 s. OpenClaw minus Claude Code: -5.8 points [-17.3, +5.8], at 0.81x the cost per solved task [0.53x, 1.23x].
- **Read with care:** with one attempt per cell, each cell's interval is 17 to 27 points wide and each pair's about 23, and the MDD is about 17 to 18 points. The OpenClaw gap on Astra points the same way as on Sol and Opus.
- **Fable in Claude Code passed 71.2% on one attempt** (descriptive; the preregistration makes no comparison across models). Of its 52 trials, 5 hit the task's time limit, 2 were refused and 1 ended in an API error.
- **Refusals (same detector as the core):** Astra: Codex 1 (that trial's tests still passed, but a harness error counts as a fail), OpenClaw 1. Fable: Claude Code 2, OpenClaw 4.
- **Sensitivity lines (amendment 3):** without the 3 drifted tasks, OpenClaw minus Codex on Astra is -10.2 [-22.4, +2.0] and OpenClaw minus Claude Code on Fable -6.1 [-18.4, +6.1]; without Harbor-labelled refusals (4 trials), -11.8 [-23.5, 0.0] and -6.0 [-18.0, +6.0]. Per-cell rates are in results/extension/sensitivity-without-drifted-tasks and sensitivity-without-refusals.
- **Each pair's two cells ran one after the other** as separate Harbor jobs, not alternating task by task (see Deviations).
- **Audit:** 4 extension trials flagged, all on llm-inference-batching-scheduler, all canary-only. The blind reader marked them unclear because the file shows no excerpt. The canary sits in the header of the task's own /app/scripts/cost_model.py, as in the core, so none is an answer-key receipt. 0 gstack reads. The outage signature found 0 extension trials ([results/extension/verifier-unavailable-a6.json](results/extension/verifier-unavailable-a6.json)).
- **In the public copy:** the extension result files under results/extension/ are published. Public history can't show that amendment 3 came before this data, because both arrived in one merge (#337). The private branch history shows the order.

## Noise, drift and the kept sample

- **Rerun flip** (two attempts of one harness disagree on a task): Opus 9.3% [4.0%, 15.4%], Sol 9.5% [5.1%, 14.3%].
- **Harness flip** (one attempt each of two harnesses disagree): Opus 13.9% [8.3%, 19.9%], Sol 14.4% [8.8%, 20.7%]. The harness adds about 5 points of disagreement over rerun noise (4.6 on Opus, 5.0 on Sol).
- **Drift** (home cell attempt 2, run during the main stage, minus attempt 1): Claude Code -3.9 [-9.8, +0.0], Codex -1.9 [-7.7, +3.8]. Both within the preregistered 10-point threshold.
- **Kept sample (8 tasks, descriptive):** Claude Code, Pi and Codex 87.5% [62.5%, 100%] (7 / 8); Hermes and OpenClaw 75.0% [37.5%, 100%] (6 / 8) on both models. Hermes's figures include its two answer-key receipts scored as fails.
- **Reliability per cell** (pass^2, pass@2) is in [analysis.md](results/analysis/analysis.md).

## Contamination audit and clean arms

- **Audit:** every core trial's captured request bodies (the same source for every harness: 892 proxy captures, 4 raw logs) were scanned for the benchmark canary, answer-key fingerprints and requests for a copy of the benchmark. 23 flagged; a reader blind to the harness confirmed 4 (above). The audit file is [results/audit.json](results/audit.json); the blind reader's working file quotes answer text and is not committed.
- **Clean arms:** 0 reads of any gstack file in every cell.
- **Egress limit:** the blocklist matches TLS SNI and HTTP Host. A request to a raw IP, or with no SNI, is not matched; the audit is the backstop.

## Why null?

The only pair that is behind is OpenClaw on Opus.

1. **Exposure:** OpenClaw ran every task, and its requests reached the model with effort high (checked per request).
2. **Fit:** OpenClaw is a general personal agent, not a coding specialist; terminal tasks are in its range but not its focus.
3. **Power and saturation:** the gap (-12.5 points) is about the size this run could detect (MDD 12.7 points at 80% power). 22 of the 52 tasks passed every scored attempt in every core cell and 1 never passed, so only 29 tasks can separate harnesses at all. Claude Code on Opus is near the ceiling, which shrinks gaps rather than creating them.
4. **Model:** frontier only. On Sol, OpenClaw cleared the margin (-7.7) but cost 1.80x Codex per solved task.
5. **How firm the call is:** the gap survives the drifted-task and outside-window lines. It loses significance under amendment 4's outage classification alone (-10.6 [-20.2, -1.9], inconclusive) and when refusals are removed (-11.5 [-20.8, -3.1], inconclusive); OpenClaw on Opus tied with Pi on Opus for the most refused trials (8 each, against Claude Code's 6). Every one of these lines still puts the gap below zero. Don't pick OpenClaw for Opus terminal work, on this evidence and with the caveats above.

Why null? verdict: CUT-CANDIDATE (OpenClaw on Opus)

## Deviations

- **2026-11-07, amendment 1:** three tasks with a broken reference solution stay in, with a drifted-task line.
- **2026-11-08, amendment 2 (made after seeing stage 0's results):** the Opus cells ran although the Opus headroom gate tripped; refusals stay scored fails, with a refusal line; the Opus ceiling caveat.
- **2026-11-08, amendment 3:** the extension pairs. The 90%-of-first-26 stop was removed. Each pair's home and OpenClaw cells ran as separate Harbor jobs, one after the other, not alternating task by task as the preregistration said; each pair still ran all 52 tasks.
- **2026-11-08, amendment 4 (made after the main stage had run):** the GitHub outage exclusion and one rerun of 318 trials. It counts 676 main-stage trials; the main stage recorded 756 (results/main), so that count was wrong.
- **2026-11-08, amendment 5:** the Fable pair's spending limit rose after its probe priced Fable at 2.4 times the prior, so all 52 tasks could run.
- **2026-11-08, amendment 6:** amendment 4's signature widened after its reruns' results existed; 35 more trials rerun once.
- **Lease stops:** 2 amendment-4 reruns were refused by their shard's lease and are excluded as cap stops: opus-cc query-optimize attempt 2 and sol-hermes video-processing attempt 2.
- **Controller restart:** the main-stage runners of opus-hermes and opus-openclaw were detached from an expiring controller at 12:35Z and reattached with run-shard.sh --attach; both shards finished all 106 trials at the same commit (72f967e).
- **Fable controller restart:** the controller process for the Fable shard hit its 6-hour limit at about 20:14Z while the VM kept running; it was reattached with run-shard.sh --attach. The VM's runner never stopped and loaded one commit throughout (d80807d).
- **Rerun lease check:** `plan.ts check-shard --rerun` keyed earlier spend by trial id, so a trial's amendment-4 rerun replaced its first run's spend in the sum instead of adding to it, and the amendment-6 lease check undercounted what each shard had already spent. With the true sum, sol-openclaw's amendment-6 lease would have taken its planned budget past the preregistered figure. Its actual spend stayed inside that budget, and the run stayed inside its paid cap. Fixed in this pull request, with a test.
- **QM, Codex's window and Claude Code's small-fast model:** see Preregistered limits under What ran.
- **Argon** was skipped: no paid-tier Gemini key.

## Reproduce and inspect

- **Merged results:** [results/merged/trials.jsonl](results/merged/trials.jsonl) and [manifest.json](results/merged/manifest.json), from scripts/frontier-harbor/merge-stages.ts over stage 0, the main stage and both rerun stages with [results/verifier-unavailable-a6.json](results/verifier-unavailable-a6.json).
- **In the public copy:** the per-trial result files under results/merged/ and results/extension/ are published. For results/extension/, public history can't show the amendment came first, because both arrived in one merge (#337); the private branch history shows the order.
- **Per stage and shard:** results/{stage0,main,rerun,rerun-a6}/<shard>/trials.jsonl.
- **Analyses:** [results/analysis](results/analysis/analysis.md) (headline) and results/analysis-kept, plus one results/sensitivity-<line> folder (and its -kept twin) per line in the sensitivity table, each from scripts/frontier-harbor/analyze.ts with [analysis-spec.json](analysis-spec.json) (or analysis-spec-kept.json) and the confirmed answer-key list [results/lookup-fails.json](results/lookup-fails.json). Each subset folder's subset.json names the rule (scripts/frontier-harbor/subset.ts).
- **Outage lists:** [results/verifier-unavailable.json](results/verifier-unavailable.json) (amendment 4), [results/verifier-unavailable-a6.json](results/verifier-unavailable-a6.json) and [results/verifier-unavailable-a6-rerun.json](results/verifier-unavailable-a6-rerun.json) (amendment 6), from scripts/frontier-harbor/to-trials.ts scan-verifier.
- **Refusals:** [results/refusals.json](results/refusals.json) from scripts/frontier-harbor/refusals.ts.
- **Cost with all spend:** [results/sensitivity-cost-with-replaced-runs](results/sensitivity-cost-with-replaced-runs/analysis.md), analyze.ts --cost-with-replaced on the merged results, which adds each replaced outage run's spend (frontier.replaced_usd from merge-stages.ts).
- **Outage window and Hermes web tools:** [results/outage-window.json](results/outage-window.json) and [results/hermes-web-tools.json](results/hermes-web-tools.json), from [receipts.py](receipts.py) over the stage directories' trial logs, with the trial ids behind the in-window, agent-log and web-tool counts (the other buckets are the rest of the merge).
- **Audit:** [results/audit.json](results/audit.json) from scripts/frontier-harbor/audit.ts.
- **Extension:** [results/extension/](results/extension/analysis/analysis.md): merged with merge-stages.ts --prereg-sha (amendment 5), analysed with [analysis-spec-extension.json](analysis-spec-extension.json), with its own audit.json and refusals.json.

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.
