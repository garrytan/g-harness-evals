# Frontier coding-model shootout, November 2026

**We learned that Claude Opus 5.5 is still the model to beat in agent harnesses its maker doesn't own.** No other frontier model beat it on 52 Terminal-Bench 2.1 tasks or on 107 fresh GitHub issues. You should keep Opus 5.5 as your default coding model in Hermes, OpenClaw and Pi unless cost decides it.

**We learned that GPT-6.1 Sol came within 10 points of Opus 5.5 at half its cost per solve.** In Pi it cost 0.38 times as much per solved task, and in Hermes 0.59 times. If you pay per token, try Sol first.

**We learned that Gemini 4 Carbon and Claude Fable 5.2 trail Opus 5.5 on Terminal-Bench, by 31 and 7 points.** Carbon hit the time limit on 35 to 54% of its Terminal-Bench trials. On the fresh GitHub issues both were within 10 points of Opus, at about 3 times its cost per solve.

The plan is in [PREREGISTRATION.md](PREREGISTRATION.md), and all 27 dated changes to it are in [AMENDMENTS.md](AMENDMENTS.md). Every number below comes from [results/analysis/analysis.md](results/analysis/analysis.md), which the merged trial records in [results/shards/](results/shards/) produce. The raw transcripts behind them are listed in [reproduce.md](reproduce.md).

## What we ran

- **Models:** five frontier models (Claude Fable 5.2, GPT-6 Astra, Gemini 4 Carbon, Grok 4.7, Muse Wonder) and six near-frontier models (GPT-6.1 Sol, Claude Sonnet 5.5, Gemini 4 Hydrogen, DeepSeek V4.1 Flash 1017, Kimi K3.1 Pro, GLM 5.3), each against Claude Opus 5.5.
- **Harnesses:** Hermes, OpenClaw and Pi, three agent harnesses none of these labs owns. Each model and Opus ran in the same harness on the same tasks, so every comparison is paired.
- **Tasks:** the 52 Terminal-Bench 2.1 tasks of our last frontier run, 3 attempts each, and 107 SWE-rebench GitHub issues from July 2026 (the "fresh set"), 2 attempts each, in Pi.
- **Grading:** hidden tests grade every trial. No model judge. A safety-filter stop counts as a fail and is also reported on its own.
- **Effort:** every model ran at its maker's high effort.
- **Own harnesses:** Claude Code, Codex, Gemini CLI, Grok Build and Muse Code ran as labelled extra rows. They never move a decision.

## How to read the labels

- **d** is the model's pass rate minus Opus 5.5's on the same tasks, in points, with a 95% interval.
- **"Behind":** the model is clearly below Opus.
- **"Within 10 points, no measurable difference":** the model is clearly no more than 10 points below Opus, and we can't tell it from Opus.
- **"Can't tell":** neither of those holds. The gap could be real but smaller than this run can detect; the smallest detectable difference is in [the analysis](results/analysis/analysis.md).
- **Cost per solve ratio:** the model's dollars per solved task over Opus's, on the same tasks. Below 1 means cheaper than Opus.

## Frontier models against Opus 5.5

| Model | Tasks | Model / Opus | d [95% CI] | Label | Cost per solve vs Opus |
|---|---|---|---|---|---|
| Claude Fable 5.2 | Terminal-Bench | 72.7% / 79.3% | -6.6 [-11.1, -2.6] | behind | 3.23x [2.76, 3.88] |
| GPT-6 Astra | Terminal-Bench | 85.3% / 79.3% | +6.0 [-3.2, +15.4] | within 10 points, no measurable difference | 3.08x [2.30, 4.22] |
| Gemini 4 Carbon | Terminal-Bench | 48.3% / 79.3% | -31.0 [-42.5, -19.4] | behind | 2.64x [1.89, 3.88] |
| Grok 4.7 | Terminal-Bench | 67.3% / 79.2% | -11.9 [-22.8, -1.3] | can't tell | 3.61x [2.65, 4.99] |
| Muse Wonder | Terminal-Bench | 78.5% / 79.2% | -0.6 [-8.3, +7.3] | within 10 points, no measurable difference | 2.50x [1.90, 3.42] |
| Claude Fable 5.2 | fresh set | 69.2% / 64.5% | +4.7 [-0.9, +10.8] | within 10 points, no measurable difference | 2.80x [2.34, 3.30] |
| Gemini 4 Carbon | fresh set | 65.9% / 64.5% | +1.4 [-5.6, +8.4] | within 10 points, no measurable difference | 3.33x [2.73, 4.08] |
| Grok 4.7 | fresh set | 63.5% / 64.5% | -0.9 [-7.5, +5.6] | within 10 points, no measurable difference | 4.77x [3.92, 5.76] |
| Muse Wonder | fresh set | 65.4% / 64.5% | +0.9 [-6.1, +7.9] | within 10 points, no measurable difference | 2.10x [1.74, 2.52] |

- Terminal-Bench rows pool Hermes, OpenClaw and Pi with equal weight. Fresh-set rows are Pi only. Astra didn't run on the fresh set.
- Opus's Terminal-Bench rate differs a little between rows because a trial left out of one side is left out of its pair.
- Nine calls, corrected together for multiple tests (Holm).

## Near-frontier models against Opus 5.5 (Terminal-Bench)

| Model | Harnesses | Model / Opus | d [95% CI] | Label | Cost per solve vs Opus |
|---|---|---|---|---|---|
| GPT-6.1 Sol | Pi, Hermes | 84.6% / 81.1% | +3.5 [-6.7, +14.1] | within 10 points, no measurable difference | 0.50x [0.36, 0.70] |
| DeepSeek V4.1 Flash 1017 | Pi, Hermes | 74.2% / 81.1% | -6.9 [-16.4, +2.6] | can't tell | 0.17x [0.12, 0.24] |
| Kimi K3.1 Pro | Pi, OpenClaw | 74.7% / 77.9% | -3.2 [-11.5, +5.5] | can't tell | 0.76x [0.53, 1.10] |
| GLM 5.3 (Novita fp8 host) | Pi, OpenClaw | 54.5% / 77.9% | -23.4 [-34.5, -12.0] | behind | 1.50x [1.10, 2.09] |
| Claude Sonnet 5.5 | Pi, OpenClaw | 76.3% / 77.9% | -1.6 [-10.6, +7.7] | can't tell | 0.36x [0.27, 0.48] |
| Gemini 4 Hydrogen | Pi, OpenClaw | 73.4% / 77.9% | -4.5 [-13.8, +4.2] | can't tell | 1.08x [0.76, 1.63] |

- Six calls, corrected together (Holm). Per-harness readings for every model are in [the analysis](results/analysis/analysis.md).
- GLM 5.3 ran on Novita's fp8 host after Baidu's endpoint left OpenRouter (see "GLM 5.3's first host" below).

## In its own harness (descriptive)

These rows are Terminal-Bench pass rates in each lab's own agent. They aren't paired with Opus in the same harness and never move a decision.

| Model in its own harness | Pass rate [95% CI] | Cost per solve | Median minutes |
|---|---|---|---|
| Claude Opus 5.5 in Claude Code | 85.3% [76.3%, 92.9%] | $0.62 | 4.1 |
| GPT-6 Astra in Codex | 85.9% [77.6%, 93.6%] | $1.66 | 4.7 |
| Muse Wonder in Muse Code | 85.3% [76.9%, 92.3%] | $1.95 | 6.5 |
| Grok 4.7 in Grok Build | 67.6% [57.2%, 77.8%] | $2.66 | 15.6 |
| Gemini 4 Carbon in Gemini CLI | 57.1% [46.2%, 67.9%] | $1.59 | 15.8 |

## What each result changes

We wrote these rules down before the first trial ([PREREGISTRATION.md](PREREGISTRATION.md), "What each result changes"). Where Terminal-Bench and the fresh set disagree, the more cautious reading decides.

- **No model was "better" than Opus 5.5,** so no model is recommended over it and none becomes a new primary model under test from this run.
- **GPT-6.1 Sol** is within 10 points and cheaper per solve, so the scoreboard recommends it as the cheaper choice in Pi and in Hermes. It stays a model under test.
- **GPT-6 Astra and Muse Wonder** are within 10 points but cost more per solve (3.08x and 2.50x), so they get scoreboard rows only.
- **Gemini 4 Carbon** is behind on Terminal-Bench, so that decides: Opus 5.5 stays ahead, by about 31 points pooled and by 23 to 35 points in each harness. The fresh set read within 10 points.
- **Claude Fable 5.2** is behind on Terminal-Bench by 6.6 points at 3.23x the cost per solve, and on the fresh set it read +4.7 points at 2.80x. Both add to the cost record behind our Fable guidance; this run doesn't change it on its own.
- **Grok 4.7** reads "can't tell" on Terminal-Bench, so nothing changes. Its smallest detectable difference there was 15.4 points.
- **GLM 5.3 on Novita's fp8 host** is behind by 23.4 points. No recommendation.
- **DeepSeek, Kimi and Hydrogen** read "can't tell". Nothing changes.
- **Claude Sonnet 5.5** reads "can't tell" pooled over Pi and OpenClaw, the reading that decides, so nothing changes for it as a model. In Pi alone it is within 10 points, +0.6 [-9.6, +10.9], at 0.33x the cost per solve [0.22, 0.48], so the analysis lists it as the cheaper choice in Pi. Leave out the safety-filter stops and its Pi reading becomes "can't tell".
- **Safety stops passed 5% in some cells,** so the scoreboard carries the stop rate beside those pass rates (next section).

## Safety-filter stops and timeouts

A safety stop is the provider's filter ending a request: Anthropic's refusal stop, Google's prompt block or prohibited-content finish, or xAI's 403 refusal. Stops count as fails, including 4 Grok trials where xAI refused every request, and every call above also has a reading with stopped trials left out in [the analysis](results/analysis/analysis.md).

- **Over 5% of trials in every Opus, Fable, Carbon and Hydrogen cell:** Opus 6.4% to 9.6%, Fable 9.0% to 12.8%, Carbon 7.7% to 16.7%, Hydrogen 7.0% to 10.9%.
- **Low elsewhere:** Grok 1.3% to 2.6%, Sonnet 0.6% to 1.9%, and none for Astra, Sol, Muse, DeepSeek, Kimi or GLM.
- **Where:** 159 of the 212 stops fall on five Terminal-Bench tasks: protein-assembly, dna-assembly, dna-insert and the two FEAL cryptanalysis tasks. No fresh-set trial was stopped.
- **With stopped trials left out, several labels change.** Fable moves from "behind" to "can't tell", Grok and DeepSeek from "can't tell" to "behind", and Astra, Muse and Sol from "within 10 points" to "can't tell". Carbon stays "behind". We report the scored labels, as the plan says.

| Cell | Pass rate | Safety stops | Hit the time limit | Median minutes |
|---|---|---|---|---|
| Opus in Hermes / OpenClaw / Pi | 82.1% / 75.6% / 80.1% | 6.4% / 9.0% / 9.6% | 7.7% / 3.9% / 7.7% | 7.9 / 5.1 / 3.3 |
| Fable in Hermes / OpenClaw / Pi | 73.7% / 66.7% / 77.6% | 12.8% / 11.5% / 9.0% | 19.2% / 9.0% / 16.0% | 8.9 / 7.1 / 4.9 |
| Carbon in Hermes / OpenClaw / Pi | 46.8% / 41.0% / 57.1% | 8.3% / 16.7% / 10.9% | 49.4% / 53.8% / 35.3% | 20.4 / 17.3 / 16.0 |
| Carbon in Gemini CLI | 57.1% | 7.7% | 41.0% | 15.8 |
| Hydrogen in OpenClaw / Pi | 67.9% / 78.8% | 10.9% / 7.0% | 0.6% / 3.2% | 7.3 / 5.4 |
| Grok in Hermes / OpenClaw / Pi | 70.5% / 65.4% / 66.0% | 2.6% / 1.3% / 1.3% | 22.4% / 16.7% / 22.4% | 17.7 / 15.9 / 13.5 |
| GLM (Novita fp8 host) in OpenClaw / Pi | 54.5% / 54.5% | none | 25.6% / 30.1% | 16.2 / 14.9 |

- **Carbon's timeouts, plainly:** Carbon hit the time limit on 35% to 54% of its Terminal-Bench trials, against 4% to 8% for Opus. Its median trial took 16 to 20 minutes, against 3 to 8 for Opus. A timed-out trial still counts if its tests pass (11 to 22 per Carbon cell did). On the fresh set Carbon timed out on 24% of trials.

## Costs

Cost per solve is the money spent on a cell's trials divided by the trials it solved, priced at each provider's list price.

- **Gemini 4 Carbon, both ways.** When a Google stream ends with no usage report (a prompt block or a dropped stream), our meter charges the request's whole reservation. The cost-per-solve figures above leave those charges out and price tokens only. With them in, Carbon costs more:

| Carbon cell | Tokens only | Metered, with reservation charges | From 2026-12-01 (Google's rate doubles) |
|---|---|---|---|
| Hermes | $1.72 | $2.31 | $3.44 |
| OpenClaw | $2.27 | $3.53 | $4.55 |
| Pi | $1.59 | $1.90 | $3.18 |
| Gemini CLI | $1.59 | $2.55 | $3.18 |
| Pi, fresh set | $5.01 | $5.02 | $10.02 |

- **Carbon from 2026-12-01:** Google's listed Carbon rate doubles on that date, so every Carbon cost per solve doubles, and so do its ratios over Opus (for example 2.64x becomes about 5.3x on Terminal-Bench).
- **Spend with no trial record counts.** Three Carbon stages lost their records when a VM stopped mid-run and were rebuilt from the run's journal. The money their usage logs show for trials with no record still counts in the cell's cost, as amendment 7 section 3 says: $0.17 in Hermes, $3.08 in OpenClaw and $7.18 in Pi on the fresh set, spread over each cell's trials by their recorded spend.
- **GLM 5.3 (Novita fp8 host), both ways.** Novita billed through OpenRouter below the list price we meter at:

| GLM 5.3 (Novita fp8 host) cell | List-price metered, per solve | OpenRouter-reported bill, per solve |
|---|---|---|
| OpenClaw | $1.42 | $0.63 |
| Pi | $0.83 | $0.37 |

- At the OpenRouter-reported bill GLM would cost less per solve than Opus, but it is 23.4 points behind, so the label and the decision don't change.
- DeepSeek's OpenRouter-reported bill was also lower ($0.08 against $0.14 per solve in Hermes, $0.04 against $0.07 in Pi). Muse and Kimi were within a few cents of list price.

## Run notes

- **GLM 5.3's first host: provider endpoint unavailable (host delisted 2026-11-24 23:26Z).** Our first GLM cells pinned Baidu's fp8 endpoint on OpenRouter. Every request there got a 429: 1,560 of 1,560 in OpenClaw (all 156 trials ended as infra errors) and 624 of 624 in Pi (155 graded fail and 1 graded pass with no model answer at all). Nothing was spent. OpenRouter then delisted the host, and both cells ran again on Novita's fp8 host (amendment 25). The Baidu attempts aren't scored; their raw data is kept.
- **Grok 4.7: provider credit stop (amendment 23).** Our xAI account ran out of credit twice:
  - On 2026-11-22 it cut the last 7 fresh-set trials. Credit came back and all 7 ran again; the reruns are the records scored.
  - On 2026-11-21 it cut 8 Terminal-Bench trials that were never rerun (4 in OpenClaw, 4 in Pi). They're left out as "provider credit stop". Scored as recorded instead, Grok in OpenClaw reads 63.5% (against 65.4%), in Pi 64.7% (against 66.0%), and the pooled call reads -12.9 [-23.7, -2.2] (against -11.9 [-22.8, -1.3]). It is "can't tell" both ways.
- **Trials whose model never answered** (no 2xx answer at all) are left out as no_model_response (amendment 22), and so are trials a cell's spending cap refused, as the plan's scoring rule says. Most of both ran once more first (amendment 21). Each cell's count is in the "Left out" column of [the analysis](results/analysis/analysis.md).
- **Hermes's recovery from a thinking-only truncation is scored** (amendment 6). It touched only Carbon in Hermes: 3 trials, 46.8% scored this way against 47.7% under the original rule.
- **Harness errors count as fails, even when the tests passed.**[^1]

[^1]: 11 trials ended on a harness error although their hidden tests passed: one each in Opus in Hermes, Opus in OpenClaw, Fable in Hermes, Sonnet in OpenClaw, Astra in Codex, Astra in OpenClaw, Grok in OpenClaw, Muse in Pi (fresh set) and DeepSeek in Hermes, and two in Fable in OpenClaw. All count as fails. The Fable in Hermes one (make-mips-interpreter, attempt 2) came from the shared Hermes rerun of amendment 24, where Hermes exited with a non-zero code.

## Next time

### What we'd change if we ran this again

- Set each model's time limit from its own measured pace, or report a reading without the limit beside the scored one, because Carbon hit the limit on 35% to 54% of Terminal-Bench trials so its "behind" mixes speed with skill.
- Run a canary of at least 10 trials before trusting per-trial cost, because a 3-trial canary under-predicted Carbon's cost by 2 to 3 times and every lease raise then took an amendment and a second results directory.
- Check each provider's credit and spending limit and probe the exact pinned route before launch, because xAI's credit stops cut 15 trials and Baidu's GLM endpoint refused every request before OpenRouter delisted it.
- Have the meter record a token-priced figure next to every reservation charge, because reservation charges were up to 49% of a Carbon shard's metered spend and had to be backed out afterwards.
- Have the runner write its results files when a time-limit stop ends a shard, because each such stop needed the records recovered by hand.
- Size rerun time limits from the rerun trials themselves, because trials a lease stopped are the long ones: GLM reruns ran at about 7 an hour and $1.14 each, against $0.48 in the first pass.
- Include QM (yc-software/qm) as a harness from the start, because this lineup left it out.

### Ideas to improve the eval

- Use harder tasks, because Opus 5.5 passed 85.3% of Terminal-Bench in Claude Code and every frontier model on the fresh set landed within a few points of Opus, which leaves little room to tell models apart.
- Report the five tasks that draw most safety stops as their own group, because 159 of 212 stops fall on them and leaving stops out changes six labels.

## What we got wrong first, before the counted run

**We expected three model and harness pairings to break, and on the real APIs they didn't.** Before any counted trial, we test every pairing against a keyless stand-in for the provider APIs. That stand-in refused three ways of sending a model's earlier reasoning back, so we expected Gemini 4 Carbon in Hermes, Carbon in OpenClaw and Muse Wonder in Hermes to fail. We then ran each one for 3 trials on the real APIs, through OpenRouter, and none of them failed that way:

- **Carbon in Hermes v2026.9.24:** Hermes sent Carbon's reasoning back on none of 27 replayed turns, and Google refused none of them: every request that wasn't rate-limited got a 200.
- **Carbon in OpenClaw:** OpenClaw rewrote the tool-call ids (`call_N` became `callN`), and Google answered all 146 requests with 200. All 3 trials passed.
- **Muse Wonder in Hermes v2026.9.24:** Hermes dropped every reasoning field, and Meta answered with 200. All 3 trials passed.

**The stand-in was stricter than the real APIs.** It now refuses only what a provider documents or what we saw a real API refuse (amendment 4). Those trials aren't counted.

### Three things that did hold up

1. **Hermes behind a gateway silently drops a model's reasoning between turns** (Hermes v2026.9.24). Through a custom OpenAI-compatible provider, Hermes keeps `reasoning_details` only when the host is openrouter.ai or nousresearch.com. Point it at any other gateway and every replayed turn goes out without the reasoning. Google and Meta accept that, so you get no error. We haven't measured whether it costs quality. Hermes v0.23.1's built-in openrouter provider sends the reasoning back.
2. **Hermes's built-in openrouter provider sends no reasoning effort through a gateway** (Hermes v0.23.1). Set effort high and point the provider's base URL anywhere but openrouter.ai, and the request goes out with no effort field, so the model runs at its default. The only other hosts that get effort are a few Hermes knows by name (Nous Portal, Vercel AI Gateway, Ollama Cloud, LM Studio) or one a provider plugin claims. Hermes reads `extra_body` only for custom providers, so that doesn't help either. This one comes from Hermes's source and from the requests the pinned Hermes binary sent in our keyless check, not from a paid trial: what Hermes sends doesn't depend on which API answers. We reported it to Hermes as [NousResearch/hermes-agent#156806](https://github.com/NousResearch/hermes-agent/issues/156806); [#55276](https://github.com/NousResearch/hermes-agent/issues/55276) is the related report for custom and Z.ai providers. We add effort with a small Hermes plugin, pinned by hash (amendment 1).
3. **OpenRouter's shared Google AI Studio capacity returned 429s on Carbon under moderate load** (2026-11-16). In Hermes, with 4 trials running at once, 16 of 42 Carbon requests got a 429, peaking at about 22 requests and 300,000 input tokens a minute, and all 3 trials ended on them. OpenClaw on the same endpoint and concurrency got none in 146 requests. Our own Gemini key took 8 workers at about 650,000 input tokens a minute with no 429s. OpenRouter kept no error body, so whose limit it was is our inference. Carbon and Hydrogen now call Google's API directly on our own quota (amendment 2).

<details>
<summary>Disclosures</summary>

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI. OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

</details>
