# Can Gemini 4 Carbon and the other labs' best models match Claude Opus 5.5 as coding agents, in the same harnesses?

Status: preregistered when this file merges to main, before any trial of this run. Run id `frontier-shootout-2026-11`. Cells, shards and leases are in the forty plan files `prereg-harbor-s01.json` to `prereg-harbor-s40.json` beside this file, one cell each. The fresh-set tasks are in [swe-rebench-tasks.json](swe-rebench-tasks.json), and the index entry is [frontier-shootout-2026-11.json](../preregistrations.d/frontier-shootout-2026-11.json).

**In one line:** run Gemini 4 Carbon, Grok 4.7, Muse Wonder, Claude Fable 5.2 and GPT-6 Astra against fresh Claude Opus 5.5 cells in three agent harnesses we don't own (Hermes, OpenClaw and Pi), on the 52 Terminal-Bench 2.1 tasks of our last frontier run and, for five of them, on 107 fresh GitHub issues from July 2026; add six near-frontier models (GPT-6.1 Sol, Claude Sonnet 5.5, Gemini 4 Hydrogen, DeepSeek V4.1 Flash, Kimi K3.1 Pro, GLM 5.3) in Pi and one second harness; and report each lab's own harness as a labelled extra row.

**What this is not:** a gstack or gbrain test (no arm has either), a ranking of harnesses, or a test of any model's settings. Every model runs at its maker's high effort with the same tasks, the same grader and a 128,000-token output cap (65,536 for Gemini 4 Carbon and Gemini 4 Hydrogen, Google's standard output limit).

## Approval

- **Garry, 2026-11-15:** "Do it", to plan v2 (kept in the coordinating agent's drive): the lineup below at about $7,680, Claude Sonnet 5.5 added as a one-eval exception to R54 (+$130), and GPT-6 Astra on the fresh set left out. Total about $7,810, with a stop at a projected $8,500.
- **Garry, 2026-11-15, earlier gate:** "Fine and you have to add fable 5.2 then. We better be thoughtful that this will be a true frontier and near frontier model shootout".
- **The coordinating agent, 2026-11-16:** Gemini CLI runs on Google's own API, now that a Gemini key exists. Garry chose the OpenRouter route only because there was no key, and running Carbon in its own harness through our translation layer would be a confound. The translation stays as a named fallback (see Routes).

## Lineup and why

| Tier | Lab | Model | In or out | Why, in one line |
|---|---|---|---|---|
| Frontier | Anthropic | Claude Opus 5.5 | In (the comparator) | Anthropic's default coder and the model the question is about |
| Frontier | Anthropic | Claude Fable 5.2 | In | Anthropic's most capable model; Garry asked for it |
| Frontier | OpenAI | GPT-6 Astra | In, Terminal-Bench only | OpenAI's most capable coder; the fresh set was left out by Garry (would add about $1,080) |
| Frontier | Google | Gemini 4 Carbon | In | Google's strongest model and the reason for this eval |
| Frontier | xAI | Grok 4.7 | In | xAI's flagship for code; Grok Build runs on it |
| Frontier | Meta | Muse Wonder | In | Meta's most capable model, built for software engineering (preview) |
| Near-frontier | OpenAI | GPT-6.1 Sol | In | OpenAI's second line at a fifth of Astra's price, and a model under test in our other evals |
| Near-frontier | Anthropic | Claude Sonnet 5.5 | In (one-eval exception to R54) | Second on Terminal-Bench 4.1; a shootout without it would look odd |
| Near-frontier | Google | Gemini 4 Hydrogen | In | Google's coding workhorse tier |
| Near-frontier | DeepSeek | DeepSeek V4.1 Flash 1017 | In | DeepSeek's best coder by its own release note, and very cheap |
| Near-frontier | Moonshot | Kimi K3.1 Pro | In | The strongest open-weight claim, not yet on the independent board |
| Near-frontier | Z.ai | GLM 5.3 (Baidu fp8 host) | In | 41.2% on Terminal-Bench 4.1, above Grok 4.7, at a fraction of the price |
| Out | Google, Alibaba, Meta, Particle, OpenAI | Gemini 4 Argon, Qwen 3.8 Max, Muse Spark 1.3, particle-1, Gemini 3.8 Flash, GPT-6.1 Terra | Out | Each is behind or replaced by an In model of the same lab, or already measured this week (reasons in the plan) |

The tiers mean "each lab's flagship" and "its second line or an open-weight challenger", not measured strength.

## Harnesses, routes and pins

- **Third-party harnesses:** Hermes, OpenClaw and Pi at the versions particle-swap used, through Harbor 0.24.0, on Terminal-Bench 2.1 at d49e28f1. Frontier models run in all three. Near-frontier models run in Pi plus one second harness, chosen by the keyless reasoning-replay check on 2026-11-15 and fixed here: Sol and DeepSeek in Hermes; Kimi K3.1 Pro, GLM 5.3, Sonnet 5.5 and Hydrogen in OpenClaw (Hydrogen with a declared partial replay). This is a cost limit, said here and in the post.
- **Own-harness rows (descriptive, never in a call):** Claude Code (Opus 5.5), Codex (Astra), Gemini CLI 0.68.0 (Carbon), Grok Build 1.0.77 (Grok 4.7), Muse Code 1.4.20 (Muse Wonder). Fable 5.2 in Claude Code is cited from the cc322 run, not rerun.
- **Routes:** Opus, Fable and Sonnet on Anthropic's API; Astra and Sol on OpenAI's; Grok 4.7 on xAI's Responses API in every harness (each harness's own xAI route; xAI documents that its Chat Completions API returns no reasoning and drops it between turns), with Hermes sending no effort field for Grok 4.7, so it runs at xAI's documented default, high; Gemini CLI on Google's Gemini API directly. Every other model goes through OpenRouter pinned to one named endpoint with no fallbacks (Carbon and Hydrogen on Google AI Studio at the standard tier, never Vertex, flex or priority; Muse Wonder on Meta; DeepSeek on DeepSeek; Kimi on Moonshot; GLM 5.3 on Baidu's fp8 host, not Z.ai's own endpoint, for the reason under Outside terms). The proxy refuses any request off its pin or tier and marks an answer from another tier as served elsewhere. Every call goes through the metering proxy under a lease.
- **Which route each Carbon row uses** (from scripts/frontier-harbor/pin.json and frontier_settings.py, which allow no other):

| Carbon row | Route | Why |
|---|---|---|
| Gemini CLI (own harness) | Google Gemini API, direct | The harness's own route; the coordinating agent's ruling of 2026-11-16 |
| Hermes | OpenRouter, pinned to Google AI Studio, standard tier | Hermes has no Google provider behind the proxy; pin.json lists Carbon for Hermes only on OpenRouter |
| OpenClaw | OpenRouter, pinned to Google AI Studio, standard tier | Same: no Google provider for OpenClaw in frontier_settings.py |
| Pi | OpenRouter, pinned to Google AI Studio, standard tier, with Pi's Argon catalog row | Same; Pi has no catalog row of its own for Carbon |

- **Named fallback:** if Gemini CLI fails its smoke on the direct route, its cells run through the proxy's translation to OpenRouter instead, and the report says so beside every Gemini CLI number, with the smoke failure that triggered it. No other cell may use it.
- **Effort and caps:** effort high on every agent-loop request (Carbon: thinkingLevel HIGH), checked per request from the proxy log; 128,000 output tokens, except 65,536 for Gemini 4 Carbon and Gemini 4 Hydrogen (Google's standard output limit, as pin.json and the proxy set it); each model's real context window.
- **Harness housekeeping models** stay at each harness's shipped default, metered and labelled "harness housekeeping, shipped default", never scored.

## What runs

- **Terminal-Bench 2.1 cells (35):** the 52 tasks of frontier-harness-2026-11 (#337), from `scripts/frontier-harbor/pin.json` with its shared order seed `harn50-frontier-2026-11-07`, at the same harness pins (no `harness_versions` override, so Claude Code runs at 2.1.312 as in #337). Every cell runs all 52 tasks, 3 attempts each: 156 trials per cell.
  - Hermes, OpenClaw and Pi each run Opus 5.5, Fable 5.2, GPT-6 Astra, Gemini 4 Carbon (through OpenRouter), Grok 4.7 and Muse Wonder.
  - Pi also runs GPT-6.1 Sol, Sonnet 5.5, Gemini 4 Hydrogen, DeepSeek V4.1 Flash 1017, Kimi K3.1 Pro and GLM 5.3.
  - Hermes also runs Sol and DeepSeek.
  - OpenClaw also runs Kimi, GLM, Sonnet and Hydrogen.
  - Each model's own harness: Claude Code on Opus, Codex on Astra, Gemini CLI on Carbon (Google's API directly), Grok Build on Grok 4.7 and Muse Code on Muse Wonder.
- **Fresh-set cells (5):** the 107 SWE-rebench July 2026 tasks that fable-diagnosis-2026-11 counted (oracle scored 1 and the do-nothing agent scored 0 in [its oracle check](../2026-11-14-fable-diagnosis/oracle-check.json); the same 4 tasks are left out), from `scripts/frontier-harbor/pin-swe-rebench-07-2026.json` with that run's seed `fable52-diagnosis-2026-11-14`, so the order is the same. Pi only, 2 attempts each: Opus 5.5, Fable 5.2, Carbon, Grok 4.7 and Muse Wonder. 214 trials per cell.

**Totals:** 40 cells, 6,530 trials (5,460 Terminal-Bench 2.1, 1,070 fresh set), expected paid spend about $6,974, leases $14,040 and shard caps $14,845 (leases plus reserves).

## Sharding

- One cell per shard, so no cell is ever split across machines and every shard calls one provider family. OpenRouter shards can then be paced on that key's limit by launching fewer of them at once.
- Each shard runs on its own Ubicloud standard-16 VM through `scripts/ubicloud/fanout.sh --workload frontier-harbor`, 4 trials at a time (`concurrency: 4`, as in #337 and fable-diagnosis), with the keyless install check as its smoke.
- Each plan file is its own experiment in the index with its own cap (lease plus reserve), so a runaway shard stops at its own cap.
- The Terminal-Bench 2.1 shards and the fresh-set shards need separate fan-out configs, because a fan-out takes one preregistration and a run draws from one task source.

## Gemini 4 Carbon must finish before 2026-12-01

Carbon's list price doubles at 2026-12-01 00:00 UTC. Shards s01 to s05 hold every Carbon cell, go in the first wave, and must all launch by 2026-11-29 00:00 UTC. The longest of them, s05 (fresh set, about 17 hours expected, TTL 28 hours), then still ends before the price change.

## Shard table

Expected $ per trial comes from #337's measured costs as the run owner scaled them: Opus $0.72 in Hermes, $0.67 in OpenClaw, $0.50 in Pi and $0.56 in Claude Code; Fable 2.8 times Opus, Carbon 0.8 times, Grok 1.3 times, Muse 1.0 times and Sonnet 0.6 times, in the same harness (each own harness scaled from Claude Code's Opus); Astra $1.54 in Codex, $2.87 in OpenClaw and $2.00 elsewhere; Sol $0.37 in Hermes and $0.18 in Pi; Kimi $0.40, Hydrogen $0.25, GLM (Baidu fp8 host) $0.10 and DeepSeek $0.05. Fresh set: $2.00 per Opus try, $5.00 per Fable try, others scaled from Opus as above. Each lease is about twice the expected spend, rounded up to $5; each reserve is 5% of the lease, at least $5.

Expected hours are trials times the mean minutes per trial, divided by 4 concurrent trials, plus 0.5 hours of setup and smoke (1.5 hours on the fresh set, whose smoke took 73 minutes in fable-diagnosis). Mean minutes per trial, measured at 4 at a time:

- Measured in #337 and its extension: Opus 11.8 in Hermes, 10.1 in OpenClaw, 9.0 in Pi and 9.4 in Claude Code; Sol 9.4 in Hermes and 5.2 in Pi; Astra 6.6 in Codex and 8.3 in OpenClaw.
- Fable is taken as 1.3 times the harness's Opus mean (Fable 5.1 in Claude Code took 12.4 against Opus's 9.4).
- No repo run has timed Carbon, Grok, Muse, Sonnet, Hydrogen, DeepSeek, Kimi or GLM on these tasks, or Astra in Hermes or Pi. Those cells take the harness's Opus mean, and each own harness takes Claude Code's.
- Fresh set: 17.4 minutes per try (Opus 5.5 in fable-diagnosis), 20.1 for Fable.

UBI_TTL_HOURS is 1.5 times the expected hours plus 2, rounded up. Means hide long tails (#337's slowest trials ran over an hour), so the TTL margin is deliberate.

| Shard | Cell | Model | Harness | Tasks | Provider family | Trials | Expected $/trial | Expected $ | Lease $ | Cap $ | Expected hours | UBI_TTL_HOURS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| s01 | carbon-hermes | openrouter:google/gemini-4-carbon | hermes | TB2.1 | OpenRouter | 156 | 0.58 | 90 | 180 | 190 | 8.2 | 15 |
| s02 | carbon-openclaw | openrouter:google/gemini-4-carbon | openclaw | TB2.1 | OpenRouter | 156 | 0.54 | 84 | 170 | 180 | 7.1 | 13 |
| s03 | carbon-pi | openrouter:google/gemini-4-carbon | pi | TB2.1 | OpenRouter | 156 | 0.40 | 62 | 125 | 135 | 6.3 | 12 |
| s04 | carbon-gemini-cli | google:gemini-4-carbon | gemini-cli | TB2.1 | Google (direct) | 156 | 0.45 | 70 | 140 | 150 | 6.6 | 12 |
| s05 | swe-carbon-pi | openrouter:google/gemini-4-carbon | pi | SWE-rebench | OpenRouter | 214 | 1.60 | 342 | 685 | 720 | 17.0 | 28 |
| s06 | opus-claude-code | anthropic:claude-opus-5-5 | claude-code | TB2.1 | Anthropic | 156 | 0.56 | 87 | 175 | 185 | 6.6 | 12 |
| s07 | opus-hermes | anthropic:claude-opus-5-5 | hermes | TB2.1 | Anthropic | 156 | 0.72 | 112 | 225 | 240 | 8.2 | 15 |
| s08 | opus-openclaw | anthropic:claude-opus-5-5 | openclaw | TB2.1 | Anthropic | 156 | 0.67 | 105 | 210 | 225 | 7.1 | 13 |
| s09 | opus-pi | anthropic:claude-opus-5-5 | pi | TB2.1 | Anthropic | 156 | 0.50 | 78 | 160 | 170 | 6.3 | 12 |
| s10 | fable-hermes | anthropic:claude-fable-5-2 | hermes | TB2.1 | Anthropic | 156 | 2.02 | 314 | 630 | 665 | 10.5 | 18 |
| s11 | fable-openclaw | anthropic:claude-fable-5-2 | openclaw | TB2.1 | Anthropic | 156 | 1.88 | 293 | 590 | 620 | 9.0 | 16 |
| s12 | fable-pi | anthropic:claude-fable-5-2 | pi | TB2.1 | Anthropic | 156 | 1.40 | 218 | 440 | 465 | 8.1 | 15 |
| s13 | sonnet-openclaw | anthropic:claude-sonnet-5-5 | openclaw | TB2.1 | Anthropic | 156 | 0.40 | 63 | 130 | 140 | 7.1 | 13 |
| s14 | sonnet-pi | anthropic:claude-sonnet-5-5 | pi | TB2.1 | Anthropic | 156 | 0.30 | 47 | 95 | 100 | 6.3 | 12 |
| s15 | swe-opus-pi | anthropic:claude-opus-5-5 | pi | SWE-rebench | Anthropic | 214 | 2.00 | 428 | 860 | 905 | 17.0 | 28 |
| s16 | swe-fable-pi | anthropic:claude-fable-5-2 | pi | SWE-rebench | Anthropic | 214 | 5.00 | 1070 | 2140 | 2250 | 19.4 | 32 |
| s17 | astra-codex | openai:gpt-6-astra | codex | TB2.1 | OpenAI | 156 | 1.54 | 240 | 485 | 510 | 4.8 | 10 |
| s18 | astra-hermes | openai:gpt-6-astra | hermes | TB2.1 | OpenAI | 156 | 2.00 | 312 | 625 | 660 | 8.2 | 15 |
| s19 | astra-openclaw | openai:gpt-6-astra | openclaw | TB2.1 | OpenAI | 156 | 2.87 | 448 | 900 | 945 | 5.9 | 11 |
| s20 | astra-pi | openai:gpt-6-astra | pi | TB2.1 | OpenAI | 156 | 2.00 | 312 | 625 | 660 | 6.3 | 12 |
| s21 | sol-hermes | openai:gpt-6.1-sol | hermes | TB2.1 | OpenAI | 156 | 0.37 | 58 | 120 | 130 | 6.6 | 12 |
| s22 | sol-pi | openai:gpt-6.1-sol | pi | TB2.1 | OpenAI | 156 | 0.18 | 28 | 60 | 65 | 3.9 | 8 |
| s23 | grok-grok-build | xai:grok-4.7 | grok-build | TB2.1 | xAI | 156 | 0.73 | 114 | 230 | 245 | 6.6 | 12 |
| s24 | grok-hermes | xai:grok-4.7 | hermes | TB2.1 | xAI | 156 | 0.94 | 146 | 295 | 310 | 8.2 | 15 |
| s25 | grok-openclaw | xai:grok-4.7 | openclaw | TB2.1 | xAI | 156 | 0.87 | 136 | 275 | 290 | 7.1 | 13 |
| s26 | grok-pi | xai:grok-4.7 | pi | TB2.1 | xAI | 156 | 0.65 | 101 | 205 | 220 | 6.3 | 12 |
| s27 | swe-grok-pi | xai:grok-4.7 | pi | SWE-rebench | xAI | 214 | 2.60 | 556 | 1115 | 1175 | 17.0 | 28 |
| s28 | muse-muse-code | openrouter:meta/muse-wonder | muse-code | TB2.1 | OpenRouter | 156 | 0.56 | 87 | 175 | 185 | 6.6 | 12 |
| s29 | muse-hermes | openrouter:meta/muse-wonder | hermes | TB2.1 | OpenRouter | 156 | 0.72 | 112 | 225 | 240 | 8.2 | 15 |
| s30 | muse-openclaw | openrouter:meta/muse-wonder | openclaw | TB2.1 | OpenRouter | 156 | 0.67 | 105 | 210 | 225 | 7.1 | 13 |
| s31 | muse-pi | openrouter:meta/muse-wonder | pi | TB2.1 | OpenRouter | 156 | 0.50 | 78 | 160 | 170 | 6.3 | 12 |
| s32 | swe-muse-pi | openrouter:meta/muse-wonder | pi | SWE-rebench | OpenRouter | 214 | 2.00 | 428 | 860 | 905 | 17.0 | 28 |
| s33 | hydrogen-openclaw | openrouter:google/gemini-4-hydrogen | openclaw | TB2.1 | OpenRouter | 156 | 0.25 | 39 | 80 | 85 | 7.1 | 13 |
| s34 | hydrogen-pi | openrouter:google/gemini-4-hydrogen | pi | TB2.1 | OpenRouter | 156 | 0.25 | 39 | 80 | 85 | 6.3 | 12 |
| s35 | deepseek-hermes | openrouter:deepseek/deepseek-v4.1-flash-1017 | hermes | TB2.1 | OpenRouter | 156 | 0.05 | 8 | 20 | 25 | 8.2 | 15 |
| s36 | deepseek-pi | openrouter:deepseek/deepseek-v4.1-flash-1017 | pi | TB2.1 | OpenRouter | 156 | 0.05 | 8 | 20 | 25 | 6.3 | 12 |
| s37 | kimi-openclaw | openrouter:moonshotai/kimi-k3.1-pro | openclaw | TB2.1 | OpenRouter | 156 | 0.40 | 62 | 125 | 135 | 7.1 | 13 |
| s38 | kimi-pi | openrouter:moonshotai/kimi-k3.1-pro | pi | TB2.1 | OpenRouter | 156 | 0.40 | 62 | 125 | 135 | 6.3 | 12 |
| s39 | glm-openclaw | openrouter:z-ai/glm-5.3 | openclaw | TB2.1 | OpenRouter (Baidu fp8) | 156 | 0.10 | 16 | 35 | 40 | 7.1 | 13 |
| s40 | glm-pi | openrouter:z-ai/glm-5.3 | pi | TB2.1 | OpenRouter (Baidu fp8) | 156 | 0.10 | 16 | 35 | 40 | 6.3 | 12 |
| **Total** | 40 cells | | | | | **6,530** | | **6,974** | **14,040** | **14,845** | **332 VM-hours** | |

By provider family:

| Family | Shards | Trials | Expected $ | Lease $ |
|---|---|---|---|---|
| OpenRouter | 17 | 2768 | 1638 | 3310 |
| Google (direct) | 1 | 156 | 70 | 140 |
| Anthropic | 11 | 1832 | 2815 | 5655 |
| OpenAI | 6 | 936 | 1398 | 2815 |
| xAI | 5 | 838 | 1053 | 2120 |

## Machines and wall time

- 332 expected VM-hours in all. At most 13 standard-16 VMs at once (this crew's 208 vCPUs), at most 2 while another of this crew's fan-outs holds 144 vCPUs unless the coordinating agent allows more, and only while the project's usage plus 16 stays at or under 464 vCPUs, checked with `ubi-runner.sh usage` before each launch.
- At 13 at a time that is about 26 hours of wall time if every wave stays full, longer when OpenRouter shards are held back for pacing.
- **Clean arms (R44):** every cell runs with no gstack or gbrain installed and no Capy drive mounted; the preflight records that per shard, and the audit counts any gstack file read.
- Canary first (crew rule): one shard runs until it has finished at least one scored trial and copied its results off the VM before the rest launch.

## The calls (fixed before any trial)

- **Measure:** d = model minus Opus 5.5 pass rate per task (mean over attempts), paired by task, with a 95% task-clustered bootstrap interval (10,000 draws, seed 20261116). Pooled readings weight each harness equally and use only harnesses where both the model and Opus ran.
- **Primary family (Holm, separately for superiority and the 10-point non-inferiority test, runner/stats/paired.ts):** the five non-Opus frontier models pooled over their harnesses on Terminal-Bench (5 calls), and Fable, Carbon, Grok and Muse on the fresh set (4 calls). 9 calls.
- **Secondary family:** the six near-frontier models pooled over Pi and their second harness (6 calls).
- **Tertiary:** per-harness readings, Holm within each model.
- **Labels:** "better", "better, by less than 10", "within 10 points" ("no measurable difference" when the interval includes 0), "behind", or "can't tell" with the smallest detectable difference.
- **Cross-tier reading:** every frontier model also gets a descriptive Pi-and-Hermes reading, the only figure compared across tiers.
- **Scoring:** a pass is a passing hidden-test grade with no consent violation. A harness error, a safety-filter stop included, is a fail. A model error, infra error or exam fault is left out of its pair and counted per cell.
- **No model judge.** Hidden tests grade every trial, so R78's judge rules don't apply.

## Smallest detectable differences (80% power, two-sided 0.05)

Computed from #337's per-task variances with particle-swap's method, at 3 attempts on Terminal-Bench and 2 on the fresh set, across the Holm steps (first to last):

| Reading | Smallest detectable difference |
|---|---|
| Frontier model, Terminal-Bench pooled over 3 harnesses | 14.0 to 18.1 points |
| Frontier model, one harness | 15.6 to 21.3 points |
| Near-frontier model, pooled over 2 harnesses | 14.5 to 18.2 points |
| Near-frontier model, Pi alone | 16.5 to 20.5 points |
| Fresh set, Pi, 107 tasks | about 12 to 15 points (estimated; recomputed from the canary before the fresh-set shards launch, written as a dated amendment) |

In words: "better than Opus" needs a true lead of about 15 points, and "within 10 points" is reachable only when the true gap is near zero or favours the model. Most frontier calls will likely read "can't tell" or "behind", and the report never reads a null as "no effect".

## What each result changes (R97, decided before any trial)

For each model against Opus 5.5: frontier models read on Terminal-Bench pooled, with the fresh set as the second reading (where they disagree, the more cautious one decides); near-frontier models read on Terminal-Bench pooled over Pi and their second harness.

- **"Better":** the scoreboard marks the model as recommended in each harness whose own reading is "better", or "within 10 points" with a cost-per-solve ratio below 1; the coordinating agent asks Garry to make it a primary model under test in later gstack and gbrain evals (for Astra, beside or instead of Sol, with its cost); for Carbon or Hydrogen, the per-harness numbers go to the gstack and gbrain teams with a recommendation to revisit "minimal Gemini support" for those harnesses; the post leads with it.
- **"Within 10 points" and cheaper per solve (ratio interval below 1):** recommended on the scoreboard as the cheaper choice in those harnesses; for a near-frontier model other than Sol and DeepSeek, Garry hears it's a candidate cheap model under test, labelled "Terminal-Bench only, public tasks", with a fresh-set check before any switch.
- **"Within 10 points", not cheaper:** scoreboard rows only.
- **"Behind":** no recommendation; the post says Opus 5.5 stays ahead, by how much and where.
- **"Can't tell":** nothing changes; the report gives the smallest detectable difference.
- **Fable 5.2:** its results add to the cost record behind R38's Fable line (harness-evals#475 found +6.5 points at 2.49 times the cost per solve); this run doesn't change R38 on its own.
- **Sol:** stays a model under test whatever happens.
- **Safety stops:** if a model's stops pass 5% of its trials in any harness, the scoreboard and the post carry that rate beside its pass rate.
- **Own-harness rows** never move a decision; the post reports them as "in its own harness", labelled descriptive.

## A model a harness can't run

- **Replay gate, fixed now:** the keyless install check on 2026-11-16 showed three cells failing at the first replayed tool turn against a fake that refuses what the real APIs are documented to refuse: Carbon in Hermes ("Thought signature is not valid"), Carbon in OpenClaw (the same, after it sends reasoning_details back) and Muse Wonder in Hermes ("reasoning_content ... must be passed back"). Hydrogen in OpenClaw joins them in the gate because pin.json declares the same partial replay for it as for Carbon in OpenClaw, and the fake upstream refuses it the same way. These four shards (s01, s02, s29, s33) launch first. If each of a shard's first 3 trials ends on a provider 400 at the first replayed turn, the shard stops, the cell is reported as "can't run <model> in <harness>" with the provider's error, and nothing else of it runs. Otherwise it runs in full.
- A cell the paid smoke shows can't complete (reasoning replay, a refused request shape, an install failure) is reported as "can't run <model> in <harness>" with the reason, and that model's pooled call covers only the harnesses where both it and Opus ran, with its own smallest detectable difference (if Carbon runs only in Pi, its Terminal-Bench call takes the one-harness figure, 15.6 to 21.3 points). Keyless replay results, by harness: Pi replays every model exactly; Hermes replays only DeepSeek and Sol behind the proxy (it drops OpenRouter reasoning_details and Claude thinking); OpenClaw replays Kimi, GLM, DeepSeek, Claude and Sol exactly, and Muse Wonder, Carbon and Hydrogen in part.

## Safety-filter stops, rate limits and infra

- **Safety stops (R95)** are their own outcome, counted per trial from the provider's stop signal on each proxy usage line, with refusals.ts's transcript markers as a cross-check. They count as fails in the primary call, with a line without them beside every call. A model under test is never swapped or retried after a stop.
- **Infra:** a trial whose final failure follows repeated provider 429s, a preview model's outage, or an OpenRouter key-limit stop (HE-PROXY-014) is infra and reruns once; harness retry settings are the same for every model. Before each OpenRouter shard launches, the controller reads the key's remaining limit and launches only with headroom for the shard's lease.

## Cost per solved task

Per cell: every scored trial's metered list-price spend (the proxy's dated price row: uncached input, cache reads, cache writes and output including reasoning, with long-prompt tiers and Carbon's 2026-12-01 rate change) divided by its passes, with a task-clustered interval and the paired ratio against Opus in the same harness. Failed, refused and timed-out trials' spend stays in. xAI's cost_in_usd_ticks and OpenRouter's usage.cost are recorded beside each request, and the canary fails on more than 1% drift.

## Budget and stop rule

- **Expected:** about $6,974 in paid trials (the shard table), about 332 VM-hours, and our own model use, about $7,600 all-in against plan v2's $7,810; the canary replaces every estimate.
- **Leases:** each shard's lease is about twice its expected spend, $14,040 in all, with each plan's cap at the lease plus a 5% reserve ($14,845). Leases are runaway protection, not the stop, and are never raised except by a dated amendment.
- **Stop rule:** after each canary, the controller projects the whole eval from measured spend per trial; if the projection passes $8,500, no further shard launches until the coordinating agent says so. The coordinating agent hears before paid spend passes $7,000.

## Before any paid trial

These were found in review of the build (harness-evals#469) and are fixed in this PR, each with a test: Gemini CLI on Google's API directly, with the OpenRouter translation as a named fallback and `GEMINI_API_KEY` only on shards with a direct-route Gemini CLI cell; candidateCount other than 1 refused; Google Maps grounding and file search refused; Gemini thinking and Grok reasoning reserved on top of the output limit, on both Gemini routes; the local countTokens estimate logged as estimated, never as a model response; Carbon's 2026-12-01 rate in every price reader; Gemini cache writes through OpenRouter billed at input plus storage (prices-2026-11-17.json); the cost split accepting Gemini rows and choosing Sonnet 5.5's cache-read rate from what each line was charged; the translation copying default, enum and example values as they are; OpenRouter, xAI and Google key shapes in every secret scan; Gemini on OpenRouter pinned to Google AI Studio at the standard tier and GLM 5.3 to Baidu's fp8 host, with the proxy and the test upstream both refusing any other endpoint, tier or fallback; smoke cells for every new harness and provider; Grok 4.7 in Pi, Hermes and OpenClaw on xAI's Responses API; and the install check accepting a replay verdict only where pin.json declares it.

## Outside terms

Each provider's published terms were read on 2026-11-16 (a reading, not legal advice). None forbids publishing comparative results. Three set conditions this run meets by its routes:

- **Gemini:** the Gemini API terms (effective 2026-03-23) have no benchmarking clause. Google Cloud's Service Specific Terms, §7 (updated 2026-11-11), let a Cloud customer publish benchmarks but not permit a third party to, which is where we would stand on OpenRouter's Vertex route, so no cell uses Vertex. OpenRouter links Google Cloud's terms for its Google AI Studio route too. The Gemini API's paid tier takes only Cloud's billing sections, so we read the benchmarking clause as not applying there, and say here that this is a reading.
- **GLM 5.3:** Z.ai's own terms (updated 2026-04-14) bar naming Z.ai without written consent, so GLM 5.3 runs on Baidu's fp8 host under the model's MIT-style licence. Every GLM number carries "Baidu fp8 host", and the report says: "GLM's own endpoint wasn't used, and an fp8 host may understate it."
- **Muse Wonder and Muse Code:** Meta's Model API terms (updated 2026-10-09) allow benchmarking, but clause (xi) needs Meta's written approval to use results to promote or market a competing product. Muse results are never used to market gstack, gbrain or a harness of ours. Muse Wonder runs only on OpenRouter's Meta endpoint.

The rest set no limit on publishing results. DeepSeek (Open Platform terms §5.2 and §5.3), xAI (enterprise terms §12) and OpenAI (Services Agreement §10) bar using their names or logos in ways that suggest a relationship or in marketing, so every company and model is named factually, with no logos and nothing that suggests endorsement. Anthropic's, Moonshot's and OpenRouter's terms have no such limit; OpenRouter needs approval only for red-teaming, and no task here attacks a model. Full replication detail (harness versions, preambles, task list, settings, model IDs and dates) is published with the results. Muse Code is a proprietary binary kept out of the repository and its public copy.

## What would change this plan

Any change after this file merges is a dated amendment committed before the affected cell starts, or a new run id.
