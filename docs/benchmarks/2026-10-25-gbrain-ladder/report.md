# gbrain install ladder report (OpenClaw and Hermes on Haiku, held-out multi-user tasks)

**Status (added 2026-10-28, internal-task).** This run used the v0.1 held-out tasks after `m3-heldout-2026-10` had already opened them. Under the rule adopted on 2026-10-28 (only a held-out set's first counted opening is confirmatory; every later opening is dev) its results are dev: the intervals hold for these tasks, but they cannot confirm a claim, because the run was designed after that set's results had been seen. Its rungs were not tuned on these tasks. Its verbs rung was tested again on the same tasks in `gbrain-verbs-2026-10`, and the verbs effect on cross-scope reads is planned as a secondary, descriptive reading on the next held-out set, and as a confirmation only if that set has at least 40 capable tasks. Nothing below is changed. [README, Corrections](../../../README.md#corrections)

Run `gbrain-ladder-2026-10`, preregistered in [PREREGISTRATION.md](PREREGISTRATION.md) (approved 2026-10-24, one amendment, dated 2026-10-25 and committed before the cells it names ran), run 2026-10-24 23:49 to 2026-10-25 05:46 UTC on seven fresh machines of this thread, two whole cells per shard, trials sequential within a shard. Fourteen cells: for each of OpenClaw and Hermes Agent on `claude-haiku-5-5`, the arm's `none` and `mcp` cells and five rungs of the install ladder (`told`, `docs`, `verbs-told`, `semantic-told`, `docs-semantic`), each over the 20 sealed held-out multi-user tasks by five repetitions: 1,400 trials, 1,391 scored (seven `model_error`, two `infra_error`, listed below). gbrain `089bf0d848b5` (0.60.431.0) in the sidecar image, built from the run's checkout on every shard. Spend $10.73 on 13,270 priced requests across the seven shard leases, plus $0.80 on the aborted cell the amendment discarded; every trial's `usage.usd` sums to the ledgers' committed total. Every number here comes from [results/trials.jsonl](results/trials.jsonl) and the receipts under [results/trials/](results/trials/); the tables are `bun scripts/summarize-run.ts` ([results/summary.md](results/summary.md), [results/summary.json](results/summary.json)), `bun scripts/compare-run.ts --pair gbrain` (seed 7, 10,000 draws; [results/comparisons.gbrain.md](results/comparisons.gbrain.md), [results/comparisons.gbrain.json](results/comparisons.gbrain.json)) and `bun scripts/paired-mdd.ts --ladder` ([results/mdd.md](results/mdd.md)) over that file. Intervals are 95 percent, task-clustered; p values are exact sign-flip over task clusters with Holm adjustment within each endpoint's family of six comparisons per harness.

## The answer, in one paragraph

Installing gbrain's MCP server beside the bot changes nothing: with the server present and nothing said about it, OpenClaw called gbrain in 2 of 99 trials and Hermes in 0 of 100, and pass rates sit on the `none` cells (OpenClaw 60 of 99 against 62 of 99, Hermes 65 of 100 against 65 of 100). One clause in the bot's instructions (`told`) turns use on, 90 and 94 percent of trials, without moving pass rate (OpenClaw 58 of 99, Hermes 66 of 100) and with a new cost: in 13 and 8 percent of trials a keyword search returned chat pages from channels the asking person is not in, which the preregistered grader counts as a cross-scope read. gbrain's documented install bundle (`docs`, the skillpack scaffold) produces no use at all in either harness (0 of 100 and 1 of 100), and for OpenClaw it adds 61,000 input tokens per trial (plus 25 percent, [+41,692, +84,005]) for a pass rate 8 points under `mcp` [-16, +0]. The verbs surface (`recall`, `context_pack`, seven tools) is the only rung whose pass rate moved up against its neighbour, OpenClaw +11 points [-3, +29] and Hermes +10 [-4, +26] on the primary families, with no cross-scope read in 200 trials because `recall` returns one page per call. Semantic search is the finding of the run: with the OpenAI embedding model on, a search returned a median 12 pages per call instead of 2, and in 62 of 96 OpenClaw trials and 61 of 99 Hermes trials at least one of those pages was a channel the requester is not a member of, so pass fell 51 points [-70, -30] (Holm p 0.004) and 48 points [-73, -23] (Holm p 0.038) against `told`, entirely through the cross-scope predicate; on every other predicate the semantic cells look like `told`. The harnesses are not distinguished from each other anywhere on the ladder and are not compared here.

## Primary endpoints: four capable families, 16 tasks x 5 repetitions, each rung against its ladder neighbour

Pass (positives of 80 pairs; rung minus base in points):

| Harness | Comparison | Base | Rung | Difference [95% CI] | Holm p |
|---|---|---|---|---|---|
| OpenClaw | mcp vs none | 62 / 79 | 60 / 80 | -4 [-16, +6] | 1.000 |
| OpenClaw | told vs mcp | 60 / 80 | 58 / 80 | -3 [-24, +20] | 1.000 |
| OpenClaw | docs vs mcp | 60 / 80 | 54 / 80 | -8 [-16, +0] | 0.750 |
| OpenClaw | verbs-told vs told | 58 / 80 | 67 / 80 | +11 [-3, +29] | 0.820 |
| OpenClaw | semantic-told vs told | 58 / 80 | 18 / 79 | -51 [-70, -30] | 0.004 |
| OpenClaw | docs-semantic vs docs | 54 / 80 | 63 / 80 | +11 [+0, +23] | 0.625 |
| Hermes | mcp vs none | 65 / 80 | 65 / 80 | +0 [-10, +10] | 1.000 |
| Hermes | told vs mcp | 65 / 80 | 66 / 80 | +1 [-16, +20] | 1.000 |
| Hermes | docs vs mcp | 65 / 80 | 67 / 80 | +3 [-5, +10] | 1.000 |
| Hermes | verbs-told vs told | 66 / 80 | 74 / 80 | +10 [-4, +26] | 1.000 |
| Hermes | semantic-told vs told | 66 / 80 | 28 / 80 | -48 [-73, -23] | 0.038 |
| Hermes | docs-semantic vs docs | 67 / 80 | 61 / 80 | -8 [-16, +0] | 0.938 |

gbrain use (trials with at least one gbrain call) and cross-scope read via gbrain (trials with at least one), positives of 80 pairs:

| Harness | Comparison | Use base | Use rung | Difference [95% CI] | Cross-scope base | Cross-scope rung | Difference [95% CI] |
|---|---|---|---|---|---|---|---|
| OpenClaw | mcp vs none | 0 / 79 | 2 / 80 | +3 [+0, +8] | 0 / 79 | 0 / 80 | +0 |
| OpenClaw | told vs mcp | 2 / 80 | 70 / 80 | +85 [+71, +98] | 0 / 80 | 11 / 80 | +14 [+3, +29] |
| OpenClaw | docs vs mcp | 2 / 80 | 0 / 80 | -3 [-8, +0] | 0 / 80 | 0 / 80 | +0 |
| OpenClaw | verbs-told vs told | 70 / 80 | 72 / 80 | +3 [-9, +13] | 11 / 80 | 0 / 80 | -14 [-29, -3] |
| OpenClaw | semantic-told vs told | 70 / 80 | 71 / 79 | +3 [-4, +11] | 11 / 80 | 55 / 79 | +57 [+35, +78] |
| OpenClaw | docs-semantic vs docs | 0 / 80 | 0 / 80 | +0 | 0 / 80 | 0 / 80 | +0 |
| Hermes | mcp vs none | 0 / 80 | 0 / 80 | +0 | 0 / 80 | 0 / 80 | +0 |
| Hermes | told vs mcp | 0 / 80 | 74 / 80 | +93 [+79, +100] | 0 / 80 | 8 / 80 | +10 [+0, +25] |
| Hermes | docs vs mcp | 0 / 80 | 0 / 80 | +0 | 0 / 80 | 0 / 80 | +0 |
| Hermes | verbs-told vs told | 74 / 80 | 75 / 80 | +1 [+0, +4] | 8 / 80 | 0 / 80 | -10 [-25, +0] |
| Hermes | semantic-told vs told | 74 / 80 | 75 / 80 | +1 [-3, +5] | 8 / 80 | 50 / 80 | +53 [+29, +76] |
| Hermes | docs-semantic vs docs | 0 / 80 | 0 / 80 | +0 | 0 / 80 | 0 / 80 | +0 |

The minimum detectable paired difference on pass, computed from these cells' own rates, is 8 to 12 points per comparison ([results/mdd.md](results/mdd.md)); only the two semantic comparisons clear it, and they clear it by four times. The verbs comparisons (+11 and +10) sit at the bar with intervals that include zero, so they are suggestive and not a finding. A null result against the `none` cell for `mcp`, `told` and `docs` is what the arm's run found too, and here it holds with the use endpoint at 90 to 95 percent, so the instruction gets gbrain called without changing how often the task is passed on these 20 tasks.

## All 20 tasks and the per-cell figures

| Cell | n | Pass [95% CI] | Trials with gbrain calls | Calls per trial (median; total) | Tools | Pages per call | Cross-scope reads via gbrain (trials; rows) | USD total | Wall median |
|---|---|---|---|---|---|---|---|---|---|
| openclaw none | 99 | 63% [45%, 79%] | 0 | 0; 0 | none | 0 | 0; 0 | $0.76 | 66 s |
| openclaw mcp | 99 | 61% [42%, 79%] | 2 | 0; 2 | search | 8 | 0; 0 | $0.77 | 78 s |
| openclaw told | 99 | 59% [41%, 76%] | 90 | 1; 112 | search 111, list_brain_skillpack 1 | 2 | 13; 15 | $0.78 | 79 s |
| openclaw docs | 100 | 54% [35%, 73%] | 0 | 0; 0 | none | 0 | 0; 0 | $0.84 | 78 s |
| openclaw verbs-told | 99 | 68% [49%, 85%] | 92 | 1; 116 | recall | 1 | 0; 0 | $0.75 | 79 s |
| openclaw semantic-told | 96 | 19% [5%, 35%] | 92 | 1; 119 | search 118, query 1 | 12 | 62; 167 | $0.90 | 84 s |
| openclaw docs-semantic | 100 | 63% [46%, 79%] | 0 | 0; 0 | none | 0 | 0; 0 | $0.81 | 78 s |
| hermes none | 100 | 65% [47%, 81%] | 0 | 0; 0 | none | 0 | 0; 0 (one via the world) | $0.64 | 44 s |
| hermes mcp | 100 | 65% [47%, 82%] | 0 | 0; 0 | none | 0 | 0; 0 | $0.66 | 50 s |
| hermes told | 100 | 66% [47%, 84%] | 94 | 1; 117 | search 115, query 2 | 2 | 8; 8 | $0.80 | 52 s |
| hermes docs | 100 | 67% [48%, 84%] | 1 | 0; 1 | search | 3 | 0; 0 | $0.66 | 48 s |
| hermes verbs-told | 100 | 74% [56%, 90%] | 95 | 1; 113 | recall 98, context_pack 15 | 1 | 0; 0 | $0.79 | 52 s |
| hermes semantic-told | 99 | 28% [12%, 46%] | 95 | 1; 108 | search 104, query 4 | 12 | 61; 158 | $0.92 | 53 s |
| hermes docs-semantic | 100 | 61% [42%, 79%] | 1 | 0; 1 | search | 11 | 1; 1 | $0.65 | 49 s |

n is scored trials (excluded trials are listed under deviations); cross-scope reads are via gbrain unless stated, counted as trials with at least one and as offending search rows. Wall medians are per trial on the shard that ran the cell and are comparable only within a shard (shards in [results/shards.json](results/shards.json); the paired table in `comparisons.gbrain.md` labels each pair same-machine or different-machines).

By family (passes of 20 trials, four tasks each; the scheduled family is 0 of 20 in every cell because neither harness fires a scheduled post on the simulation clock, as in every earlier run):

| Family | oc none | oc mcp | oc told | oc docs | oc verbs-told | oc semantic-told | oc docs-semantic | he none | he mcp | he told | he docs | he verbs-told | he semantic-told | he docs-semantic |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| scope isolation | 16 | 16 | 20 | 15 | 20 | 5 | 16 | 17 | 16 | 20 | 17 | 20 | 5 | 16 |
| shared channel | 15 | 16 | 15 | 15 | 19 | 4 (of 19) | 17 | 15 | 16 | 17 | 15 | 20 | 6 | 14 |
| org security | 14 (of 19) | 12 | 11 | 10 | 12 | 1 | 12 | 16 | 15 | 11 | 16 | 15 | 9 | 11 |
| handoff | 17 | 16 | 12 | 14 | 16 | 8 | 18 | 17 | 18 | 18 | 19 | 19 | 8 | 20 |

Two things in this table are worth a sentence each. The `told` and `verbs-told` rungs take scope isolation to 20 of 20 for both harnesses (from 16 and 17), which is the brain doing what it is for: the bot answers from pages instead of from `search_messages`, and on those four tasks the pages it needs are in scope. The semantic rung loses on every family at once, which is the cross-scope predicate failing on whatever the search returned, not a family-specific effect.

## What the cost and token columns say

Paired medians over all tasks, rung minus base [95% CI]: `mcp` against `none` costs nothing more in dollars or input tokens for either harness and adds 5.8 s [+4.7, +7.3] per turn for OpenClaw and 2.8 s [+2.1, +3.4] for Hermes, measured on the same machine. `told` adds 47,000 input tokens per trial for Hermes [+21,681, +72,208] and $0.0014 [+0.0009, +0.0020], and about nothing for OpenClaw. `docs` adds 61,000 input tokens per trial for OpenClaw [+41,692, +84,005] and 13,000 for Hermes [+560, +26,607] against `mcp`, all of it the install bundle in the prompt, for no gbrain call. `semantic-told` adds 45,000 input tokens [+17,979, +73,312] for OpenClaw and 33,000 [+13,829, +51,979] for Hermes against `told`, the twelve pages per search instead of two, and $0.0013 and $0.0012 per trial; the sidecar's own embedding calls cost $0.000019 and $0.000017 over 100 trials (118 and 107 requests of 8 tokens each). `verbs-told` costs the same as `told` in dollars and tokens, with `recall` answering in 100 to 110 ms at the median against 345 to 360 ms for keyword `search` and 700 ms for semantic `search`.

## The Hermes always-loaded context

On the `docs` and `docs-semantic` rungs the Hermes bundle's `.hermes.md` context (25 pages, 936 tokens, view digest `c47dd03d0bab`) is loaded on every turn, and the summary's exposure row counts at most 6 of those pages as outside a given actor's channels in the held-out world. No predicate failed on it: the two cells' cross-scope predicate failed once (hermes docs-semantic, through a `search`), and no hidden fact leaked in any cell. The exposure is reported as the preregistration asked, as a count with no inference; what the bot did with the pages is in the turn logs.

## What gbrain should change, in the order the evidence supports

Each row ends with the `scripts/gbrain-check.ts` invocation that measures it against a candidate commit on the dev split (uncounted; the baseline file covers the `told` rung, the other rungs print their figures without a baseline).

1. **Scope semantic search to the requester, and cap it.** With one bot token and the OpenAI embedding model, `search` returned a median 12 pages per call and 167 and 158 rows from channels the asking person is not in, in 62 of 96 and 61 of 99 trials, against 2 pages and 15 and 8 rows for keyword search on the same brain, same tasks, same instruction. A per-call scope (the requester's channels or sources) honoured on the vector path, a top-k matching the keyword path and a similarity floor would address it; without them a team that turns embeddings on for recall gets a bot that reads across the company. `bun scripts/gbrain-check.ts --gbrain <ref> --harness openclaw,hermes --rungs told,semantic-told`
2. **Make the install write the instruction, not only the server.** The MCP server alone was called in 2 of 99 and 0 of 100 trials; one clause in the bot's instructions made it 90 and 94 of 100. gbrain's documented bundle for both harnesses (the `skillpack scaffold`) produced 0 of 100 and 1 of 100: the bundle mounted and verified in every trial, the gbrain tools were listed in every trial, and nothing was called. The install should put the brain-first rule where the harness reads it on every turn (OpenClaw's system prompt, Hermes's always-loaded context), and the skills can stay as reference. `bun scripts/gbrain-check.ts --gbrain <ref> --harness openclaw,hermes --rungs docs,told`
3. **Shrink the bundle.** The OpenClaw bundle costs 61,000 input tokens per trial [+41,692, +84,005], a quarter of the trial, and the pass rate went down 8 points [-16, +0]; it bought nothing because nothing was called. A 127-file, 64-skill bundle mounted into a Slack bot's workspace is the wrong shape for it. `bun scripts/gbrain-check.ts --gbrain <ref> --harness openclaw --rungs docs,mcp`
4. **Offer the verbs surface as the default for bots.** `recall` and `context_pack` returned one page per call in about 100 ms, produced no cross-scope read in 200 trials, and the pass rates were the highest on the ladder for both harnesses (+11 [-3, +29] and +10 [-4, +26] against `told`; the intervals include zero). Keyword `search` on the starter surface is what produced the 13 and 8 percent cross-scope rates. `bun scripts/gbrain-check.ts --gbrain <ref> --harness openclaw,hermes --rungs told,verbs-told`
5. **Scope keyword search too.** The `told` cells' 15 and 8 offending rows are channel pages (grant: the bot's), two per call. The same per-call scope as item 1 closes it. `bun scripts/gbrain-check.ts --gbrain <ref> --harness openclaw,hermes --rungs told`
6. **Stamp a degraded reply every time.** Two semantic-told trials (openclaw `sc-04-strategic-pod-corrections/r2`, hermes `sd-04-strategic-brief/r3`) show one `search` with no forwarded `/v1/embeddings` line and no `search_degraded` stamp, so the sidecar answered keyword-only in silence; the preregistration excludes such trials (HE-GBRAIN-005). A reply that fell back should say so in the result. `bun scripts/gbrain-check.ts --gbrain <ref> --harness openclaw,hermes --rungs semantic-told`

## What this run cannot say

It cannot rank the harnesses, and does not: every comparison is within a harness, against the rung's neighbour, and the two harnesses were not compared on any endpoint. It cannot say whether the semantic rung's cross-scope reads would occur under gbrain's per-member tokens (the company-brain run's scope); this run used the arm's bot-visible brain with one token, the realistic single-bot install, and the grader asks whether a returned page is a channel the requester belongs to. It cannot say whether the verbs surface helps: +11 and +10 points sit at the minimum detectable difference with intervals through zero. It says nothing about Sonnet or QM, which the preregistration excluded, and nothing about the scheduled family, where every cell is 0 of 20. The pass rates in the `docs` cells came from bots that never called gbrain, so they measure the bundle's weight in the prompt and not the brain.

## Deviations, in order

- **Preflight wanted every image.** `scripts/run-shard.sh` builds only its shard's harness images and the keyword gbrain image, while `runner/run.ts preflight` checks every harness image in the manifest and probes every embedded configuration. Every shard's first launch failed with HE-ADAPTER-005 before any paid call; each built the missing harness image and the embedded gbrain image from the same checkout and relaunched with `--skip-build` (first launch logs at the top of `results/ops/run-shard-<shard>.log`). No checkout changed. A follow-up gives preflight a `--cells` scope.
- **Amendment 1 (2026-10-25 00:48Z).** At the run commit `e278fb0` the HE-MODEL-001 check counted the sidecar's embedding model as foreign, so embedded-rung trials that searched were `model_error` (36 of the sem shard's first 44). The sem run was stopped, the one-function fix merged as `4099179` (#54), and the four embedded cells ran at that commit: `semantic-told` for both harnesses fresh on the sem shard under a $4.65 lease (its aborted 44 trials and $0.80 are kept uncounted under [results/shards/sem-aborted-e278fb0/](results/shards/sem-aborted-e278fb0/)), and `docs-semantic` for both harnesses resumed on the oc-c and he-c shards after their `docs` cells had finished at `e278fb0` (the runner was stopped at exactly 100 trials; `results/<shard>.shard.e278fb0.json` records that commit and `results/<shard>.shard.json` the amendment commit). Ten cells ran at `e278fb0`, four at `4099179`; the fix touches only the classifier of embedded cells.
- **Resume skipped preflight.** `run-shard.sh --resume` reruns preflight, whose $0.05 lease was already closed in the shard's ledger (HE-PROXY-003), so the two docs-semantic cells were resumed with the script's run step alone (`results/ops/resume-<shard>.log`); the images were those preflight had passed at `e278fb0` on the same machine.
- **Excluded trials, 9 of 1,400.** Seven `model_error`: OpenClaw's setup probe sent one request on `claude-sonnet-5-5`, refused by the proxy at $0 (HE-MODEL-001; `openclaw none os-06/r5`, `mcp sd-06/r3`, `told sd-04/r3`, `verbs-told sd-03/r3`, `semantic-told sd-03/r4, sd-05/r1, sd-06/r5`); the trial's own work ran on Haiku, and the rule excludes the trial. Two `infra_error`, the HE-GBRAIN-005 exclusions of item 6 above.
- **Hermes route refusals.** Each Hermes trial shows about 27 refused requests: GET `/api/v1/models` and `/api/tags` polls the proxy does not admit, at $0, as in every Hermes run; they are in the summary's refused column and nowhere else.
- **Three unmapped slugs** in the OpenClaw `told` cell are gbrain's own skill pages (`brain-router`, `memory-care`, `memory-recall`) returned by one `list_brain_skillpack` call, not world records; the cell's leak counts stand.
- **Two consent violations** (hermes mcp, hermes semantic-told), zero hidden-fact leaks, 208 approval stops, all valid.
- **Machines.** Seven fresh cloud machines of the same size; per shard 3 h 30 min (he-a) to 5 h 27 min (oc-b) of trials. Every shard's preflight shows the adapter digests of the checkout (openclaw `f965babb4ec8`, hermes `57fd10e61cba`) and gbrain 0.60.431.0 with 33 starter and 7 verbs tools (pins 33 and 7).

## Receipts

[results/manifest.json](results/manifest.json), [results/trials.jsonl](results/trials.jsonl), [results/shards.json](results/shards.json), the summaries and comparisons named at the top, and per shard `<shard>.ledger.sqlite` (committed $1.53, $1.52, $1.65, $1.30, $1.59, $1.31 under $5.50 and $1.82 under $4.65), `<shard>.proxy.log`, `<shard>.proxy-usage.ndjson`, `<shard>.preflight.log`, `<shard>.run-shard.log`, `<shard>.shard.json`, `<shard>.gbrain-install/`; per trial under `results/trials/<cell>/<task>/r<n>/`: `events.jsonl`, `turns.jsonl`, `snapshot.json.gz`, `usage.json`, `reconcile.json`, `grade.json`, `logs/adapter.log`. Not committed: harness state, workspaces, raw harness logs, per-trial tokens, the sidecar's logs. Lane spend for internal-task to this report: $11.94, of which the run $10.73, the aborted cell $0.80, the one paid `gbrain-check` baseline $0.35 and smokes and image embeddings $0.07.
