# MCP tools at scale: does each agent still pick the right tool as you connect more and more MCP servers?

Status: frozen 2026-11-22, before any counted trial. Run id `mcp-at-scale-2026-11`. The counted run spec is [run-spec.json](run-spec.json), the gbrain margin is in [margins.json](margins.json), and every pinned file with its sha256 is in [pins.sha256](pins.sha256). The runner is `scripts/mcp-at-scale/run.ts`, the grader `scripts/mcp-at-scale/grade.py`, and the analysis `scripts/mcp-at-scale/analysis/`.

**In one line:** we connect each agent to the same fake but realistic MCP servers, rebuilt from real public servers' tool lists, at about 30, 75, 150 and 300 tools. We ask it the same small requests at every size, and read which tool it called from the fake servers' own logs.

- **8 setups:** Claude Code × Opus 5.5, Codex × GPT-6.2 Sol, and Hermes, OpenClaw and Pi each with Opus 5.5 and with particle-1. QM's two setups follow by a dated amendment (see [QM](#qm)).
- **Mechanism arms on Opus 5.5:** Claude Code with tool search off; Pi with `deferred` and with `direct` exposure.
- **gbrain arms at the 150 rung:** gbrain v0.60.763.0's full, starter and verbs surfaces on 5 frontier setups, plus the surface `gbrain setup` registers on Claude Code and Codex.
- **77 cells, 21,392 trials, projected model spend $2,465.47, run cap $3,429.66.** No model judge: every score comes from the fake servers' logs and end state.

## Eval loop

- Size: counted run
- Paid budget: $3,430
- Model judge: none

## What the result changes

Four decisions, stated in advance (R97). Each way a result can land changes something specific.

- **gbrain's default surface (gbrain's maintainers decide; this is their evidence).** A surface passes when it is non-inferior to full on each half of set G within a margin of **10 points** pooled over the 5 frontier setups (one-sided 2.5%), and costs the 160 non-gbrain requests no more than 10 points against the no-gbrain arm.
  - **Verbs passes:** `gbrain setup` keeps or moves to verbs, and gbrain is asked to have bare `gbrain serve` advertise verbs too.
  - **Starter passes:** starter stays the setup default as shipped. The report gives how often the model widened it.
  - **Only full passes:** setup pins full.
  - **No surface passes:** the current default stays, and the report gives gbrain's measured cost to other tools.
  - **Starter loses on OpenClaw or Codex while Claude Code and Hermes are fine** (per-harness rows; gbrain's maintainers' rule): the fix is harness-specific, making widening reachable on those harnesses, not a surface change. In the pilots, OpenClaw and Codex rarely reached a full-only tool through `request_tools`, so starter acts as a hard cap there; the report says so per harness.
  - **Verbs' full-only half has an upper 95% limit below 70%** (pooled or on one harness): `request_tools` gets a FIX-METHOD verdict, and gbrain is told that a tool resolver is worth building, with the failing traces.
- **Which harness to recommend to someone who uses many MCP tools, and above what count.** A harness slips at the smallest rung whose right-tool rate is at least 5 points below its own 30 rung with the 95% range below 0, tested 300 first, then 150, then 75.
  - **Holds through 300:** named only when the lower 95% limit of (300 minus 30) is above minus 7 points.
  - **Neither:** "not shown".
  - Each Opus harness is compared with the mean of the Opus harnesses at the same rung. Codex is reported beside them, labelled as a different model.
- **gstack's prune advice (gstack's maintainers decide).**
  - **A harness slips at rung C with a point estimate of at least 10 points:** gstack advises that harness's users to stay below C tools.
  - **Nothing slips, but cost per request at 300 is at least twice the 30 cost on a harness:** the advice is about cost on that harness only.
  - **Neither:** gstack says pruning isn't needed for accuracy on these harnesses.
- **Search against "send everything", on Opus.**
  - **Send everything beats the harness's own search by at least 5 points at a rung, range above 0:** the report says search costs accuracy above that count on that harness, and the public write-up carries it to the harness's maintainers.
  - **Search is non-inferior and cheaper:** the report says so.
- **A null on any of these** gets one "Why null?" pass (R48): did the model search at all, were the requests too easy, were there enough pairs, does the model already find tools unaided. A null at the ceiling gets one honest attempt to raise the ceiling before any cut verdict (R61).

## Pilot

Three pilot waves ran on pilot-only items, none of them in the counted sets. Waves 1 and 2 were invalidated as gate evidence by grading bugs found afterwards; the fixes landed before wave 3, and **wave 3 is the only gate evidence**.

- **Wave 1,** 2026-11-19 (runs `harn108-pilot-w1` to `w1d`): 1,175 trials, $117.68 paid.
- **Wave 2,** 2026-11-20 (`harn108-pilot-w2`, commit `a50f3339`): 463 trials, $54.95 paid.
- **Wave 3,** 2026-11-22 (`harn108-pilot-w3`, commit `bef8be6b`, the merged grading fixes): 230 trials on all 12 non-QM arms, 0 INFRA, $25.75 paid. Codex ran on GPT-6.2 Sol: all 311 captured model requests name `gpt-6.2-sol`. Every trial records the harness version it observed (Claude Code 2.1.328, Codex 0.170.0).

Each arm's pilot cap is a tenth of its budget in [arms.json](../../../scripts/mcp-at-scale/analysis/arms.json) (R111), checked by `scripts/mcp-at-scale/analysis/pilot-gates.ts`.

| Arm | Arm budget | Pilot cap | Wave 3 paid | Waves 1 to 3 paid |
|---|---:|---:|---:|---:|
| native, Claude Code | $131.58 | $13.15 | $0.98 | $11.21 |
| native, Codex | $58.90 | $5.89 | $0.56 | $5.72 |
| native, Hermes | $145.08 | $14.50 | $1.49 | $12.21 |
| native, OpenClaw | $255.67 | $25.56 | $2.27 | $20.36 |
| native, Pi | $64.43 | $6.44 | $0.55 | $6.29 |
| mechanism, Claude Code tool search off | $333.03 | $33.30 | $3.05 | $18.82 |
| mechanism, Pi deferred | $70.75 | $7.07 | $0.54 | $4.34 |
| mechanism, Pi direct | $539.72 | $53.97 | $3.41 | $26.86 |
| gbrain, full | $205.40 | $20.54 | $2.84 | $19.99 |
| gbrain, starter | $226.11 | $22.61 | $3.67 | $25.16 |
| gbrain, verbs | $323.77 | $32.37 | $4.72 | $33.83 |
| gbrain, registered | $118.70 | $11.87 | $1.68 | $13.59 |

- **Declared overrun:** every arm's wave 3 spend is inside its cap. Counting all three waves, three arms pass their tenth: gbrain starter by $2.55, verbs by $1.46 and registered by $1.72. The cause is two pilot rounds whose grading turned out wrong and had to be repeated, not a larger pilot design.
- **Part under test ran:** in wave 3, for every native and mechanism arm, the catalog host's log shows every server listed and catalog tools called at all 4 rungs. Search arms show their own search call in transcripts: Claude Code 10 of 10, Codex 10 of 10, Pi 24 of 24, Pi deferred 8 of 8, OpenClaw 10 of 24, Hermes 6 of 36 (pooled over both models; in wave 2, Hermes × Opus searched in 0 of 20, so a pooled pass is not evidence that Hermes × Opus searches). The two send-everything arms made no search call. For gbrain, every trial's relay log shows gbrain listed; full reached a full-only tool in 15 trials, verbs in 9 and registered in 3, each through `request_tools` on verbs and registered. Starter, tested as shipped, widened through `request_tools` in 5 of 30 trials and reached a full-only tool in 3; no trial called an unlisted tool directly.
- **Tasks can be supplied:** set R (320) and set G (120) have their planned counts and every item passed the fixed ambiguity audit or was widened. Set T runs at **32 tasks, not 40** (see [Requests](#requests)): the gate's set-size check fails for the 5 native arms only on "32 tasks, the plan has 40", which this file declares. Every rung loads in the catalog host. The gate output at the counted sets is kept with the pilot receipts.
- **Judge:** none; grading is deterministic, so R78's judge check has nothing to check.

## Interim look

One look at half the units (R113), with two-look O'Brien-Fleming bounds at each comparison's own frozen alpha. The design is frozen in `scripts/mcp-at-scale/analysis/interim-design.json`; the look is `interim.ts look`, which records itself before reading any trial and refuses a second call.

- Look at: 118 of 237 units
- Stop bounds: |z| of at least 2.797 at the look and 1.977 at the final analysis for every two-sided 5% comparison (slip per harness at 300, and the three mechanism contrasts); z of at least 2.797 at the look and 1.977 at the end for the one-sided 2.5% gbrain non-inferiority comparisons (verbs and starter, each half). Stop for futility when conditional power under the planned effect is below 10%.

A unit is a cluster: a target core tool (set R tool requests), a no-tool request, a set T task, or a target gbrain tool within its half. The look's units are the first half of each group in sha256(`harn-108-interim-v1`, cluster) order:

| Group | Look clusters / all | Look items / all |
|---|---:|---:|
| R, tool needed | 15 / 30 | 120 / 240 |
| R, no tool | 40 / 80 | 40 / 80 |
| T | 16 / 32 | 16 / 32 |
| G, starter half | 17 / 35 | 27 / 60 |
| G, full-only half | 30 / 60 | 30 / 60 |
| **Total** | **118 / 237** | **233 / 472** |

The run has two launches. Phase 1 runs every trial of a look unit (10,594 trials) on all 12 shards. The look runs once every shard's phase 1 is final and drained. Phase 2 (10,798 trials) runs every cell on fresh VMs whatever the look decides: the runner runs every cell of a shard, and the merge needs every planned trial of both phases. A comparison that stops at the look keeps the look's verdict, labelled "stopped early, estimate possibly overstated"; its phase 2 trials are reported as descriptive only and never change that verdict. Phase 2 spend on cells behind a stopped comparison is part of the $3,429.66 cap, not on top of it. No one reads pass rates before the look, and there is no other look.

## Approval

- **Garry, 2026-11-19:** "Do all recommendations", on this test's plan (the coordinating agent's copy of the plan, sha256 `b7bcc52a1a8b1f42932d9cb361c567792eb771c5b59bd2b56e6560ac77304051` at freeze). The arms, decisions, sample-size method, cost range and waves are copied from it. Where this file differs from the plan, [Deviations](#deviations-from-the-plan) says why.
- **Dated plan changes before any counted trial:**
  - 2026-11-19, Garry's rules R111 and R113 and batch routing, relayed by the coordinating agent: per-arm pilot gates, one interim look, batch APIs for the item audit.
  - 2026-11-19, from the pilot: starter tested as shipped, versions frozen, headroom recorded.
  - 2026-11-19, gbrain's maintainers, approved by the coordinating agent with its cost: set G runs twice per gbrain cell, and the margin is 10 points.
  - 2026-11-20, the coordinating agent, after grading bugs invalidated waves 1 and 2: a gate-sized wave 3 on all 12 non-QM arms at the merged fixes; the audit redone with the fixed tool on the same commit; any set T item the fixed audit marks "replace" is replaced from a 15-item reserve authored the same way, in an order committed before the audit ([set-t-reserve-order.json](set-t-reserve-order.json)), or left out and reported as left out when the reserve runs out.
  - 2026-11-21, Garry (R116): "We should be using frontier models and mainly focused on opus 5.5 or whatever model is like that at the current moment". The Codex cells move from GPT-6.1 Sol to GPT-6.2 Sol, through a `models` entry in `scripts/mcp-at-scale/versions.json`; `scripts/frontier-harbor/pin.json` is unchanged.
  - 2026-11-22, R100: gbrain moves from v0.60.747.0 to v0.60.763.0, the newest release on gbrain's master branch, before any counted gbrain cell.
  - 2026-11-22, the coordinating agent: set T runs at 32 tasks, with the smaller sample's detectable difference stated below.
- **Owner rules applied as written:** QM is a harness in every test (Garry), and it joins by amendment here; Sol runs only in Codex and Opus in Claude Code (R110).

## Arms

Same model, requests and catalog within every pair. All harnesses are the newest release on 2026-11-19 as a user installs it, with nothing from gstack or gbrain unless the arm adds gbrain.

| Arm | Setups | Rungs | Sets | What changes |
|---|---|---|---|---|
| **native** (the no-gstack, no-gbrain arm, R44) | Claude Code × Opus 5.5; Codex × GPT-6.2 Sol; Hermes, OpenClaw, Pi × Opus 5.5 and × particle-1 | 30, 75, 150, 300 (R); 30 and 300 (T) | R, T | the catalog connected through the harness's own MCP config |
| **tool search off** | Claude Code × Opus 5.5 | all 4 | R | `ENABLE_TOOL_SEARCH=false`: every tool's full schema on every request |
| **Pi deferred** | Pi × Opus 5.5 | all 4 | R | Pi MCP `exposure: deferred` (a tool_search tool) |
| **Pi direct** | Pi × Opus 5.5 | all 4 | R | Pi MCP `exposure: direct` (every schema sent) |
| **gbrain full / starter / verbs** | Claude Code × Opus, Codex × Sol, Hermes, OpenClaw and Pi × Opus | 150 | G (twice), 160 core R | native at 150 plus `gbrain serve` on that surface: full 173 tools; starter 36, which the model may widen through `request_tools`; verbs 8 tools with `request_tools` |
| **gbrain registered** | Claude Code × Opus, Codex × Sol | 150 | G (twice), 160 core R | what `gbrain setup <harness>` registers at v0.60.763.0: starter with verbs advertised. Hermes and OpenClaw need manual MCP setup and Pi's setup wires only the skill resolver, so they have no registered cell |

- **Pi's native arm** uses Pi's own MCP support (`mcp.json`, default `codemode` exposure), not the repository's world-MCP extension, because that is what a Pi user gets.
- **Clean arms:** trials run in containers on Ubicloud VMs with no Capy drive mounted; the images install neither gstack nor gbrain, except the gbrain arms' gbrain.
- **No side doors:** cells reach only the metering proxy and the catalog host. A built-in used against a catalog service (shell `gh`, `curl`, web fetch) gets no network, is recorded as its own outcome and counts as no right tool.

## Catalog

- **Source:** `tools/list` and `initialize` captured once from 30 permissively licensed open-source MCP servers pinned by commit, in a sandbox with no keys (`tasks/mcp-at-scale/catalog/`, licence notices in `LICENSES/` and THIRD_PARTY_NOTICES, modifications in `LICENSES/MODIFICATIONS.md`, leak scan and SHA256SUMS beside them).
- **Ladder, nested:** 6 core servers trimmed to 30 tools, then whole distractor servers added in a seeded order, with near-twins of core servers. The rungs hold **30, 74, 145 and 303 tools**; this file calls them 30, 75, 150 and 300.
- **Fake servers:** one catalog host (`scripts/mcp-at-scale/catalog-host.ts`) serves each server as its own MCP endpoint with its captured schemas, validates arguments, answers from scripted fixtures and logs every `initialize`, `tools/list` and `tools/call` with the trial id. Tool names are unique per rung (tested).
- **gbrain:** v0.60.763.0 (tag on `fe3dbef1`), the newest release on gbrain's master branch on 2026-11-22; an empty brain from `gbrain init --pglite --no-embedding` plus synthetic pages; a relay in front of `gbrain serve` logs every call. Its surfaces at this release: full 173, starter 36, verbs 8, registered 8 tools. Against v0.60.747.0, which the pilots and the item audit used, tool names, counts, server instructions and setup dry-runs are identical; two descriptions on the full surface changed (`query`'s `autocut` parameter is now off by default, and `whois` also matches phone numbers). No set G request mentions phone numbers or autocut. The listing map's gbrain rows were measured again at v0.60.763.0.

## Requests

- **Set R, 320 requests:** 240 that need a tool (8 per core tool, the required argument values in the text) and 80 that need none. Strata, fixed before the run: capability-only (no service named) and service-named, with near-twin bait spread across both.
- **Set T, 32 tasks (89 tool calls):** 2 to 4 chained tool calls across core servers, graded by the fake servers' end state. 13 tasks have 2 steps, 13 have 3 and 6 have 4.
- **Set G, 120 gbrain requests** on the synthetic brain: 60 starter's tools can answer and 60 that need a full-only tool, scored as two bars. Each runs twice per gbrain cell.
- **Authoring:** Gemini 4 Carbon, a third model family, as a Capy subagent; the set T reserve was authored the same way, with the same prompts and validator.
- **Ambiguity audit (decision G of the plan), redone 2026-11-22 with the fixed tool** (`scripts/mcp-at-scale/requests/audit.ts` at `bef8be6b`): GPT-6.2 Astra and Opus 5.5 each listed every catalog tool the request text allows, through the batch APIs with prompt caching. Gemini 4 Carbon adjudicated the 132 disagreements one request at a time. Acceptable sets widen where the text allows two tools. Set T is never widened: any extra tool ruled acceptable on a set T task marks it for replacement, because its end-state check cannot credit the other route.
  - **Set R:** 318 passed, 2 widened (r-139, r-142). On both, the added `aggregate` route requires the request's filter value inside its pipeline and matches connection, database and collection without regard to case, the same as the `find` route (2026-11-22, from review).
  - **Set G:** 120 passed.
  - **Set T:** 26 of the authored 40 passed; 14 were marked for replacement. Of the 15 reserve tasks, 6 passed and 9 were marked for replacement.
  - **Replacements, in the committed reserve order:** t-001 by tr-002, t-007 by tr-004, t-008 by tr-005, t-010 by tr-006, t-013 by tr-008, t-015 by tr-016.
  - **Left out, because the reserve ran out:** t-016, t-017, t-022, t-025, t-027, t-033, t-038 and t-039.
- **This audit checks items, not outputs,** so R78's judge check does not apply.
- **Custody:** set R is split by cluster into a public half (160 requests, committed with this file as [set-r-public.jsonl](set-r-public.jsonl)) and a sealed half held by digest ([set-r-sealed.json](set-r-sealed.json)); the sealed plaintext stays outside the repository until the results. Both widened requests are in the public half. Sets T and G are pinned here by sha256 and published with the results.

| Set | Requests | sha256 |
|---|---:|---|
| R | 320 | `0de439ea57b2ce449124234e9d8bb35b2f0f57ca8052ad1dae89d40724db61d1` |
| T | 32 | `317e632fc7d1bb7b598ca737b217939e6afd27607db32591bcb4cd9a076263b7` |
| G | 120 | `ea4e10ed38c24363bec94c5b3405d2beeecc18d4662627068f66bcbd4a783f5b` |

## Measures

Every outcome is paired and reported with a 95% interval and n.

1. **Right tool (primary):** the trial called an acceptable tool with the required arguments before the trial ended (the harness ended its turn, or the 900-second limit). Read from the catalog host's log.
2. **Wrong tool:** any catalog tool outside the acceptable set, on tool-needing requests.
3. **Tool when none was needed:** any catalog tool called on a no-tool request.
4. **Task success:** set T's end-state checks.
5. **Search effort:** model requests and search calls before the first right call, read by per-harness transcript parsers with fixtures from real traces at the frozen versions.
6. **Built-in substitution:** attempts to reach a catalog service through a built-in tool, reported apart.
7. **Cost:** input tokens, cache-read share and dollars per request from the metering proxy, with trial order and gaps logged; also the count of requests whose cache-read share fell below half after a tool was loaded.
8. **Place of the target in the listing,** per harness and rung, from the keyless listing map at the frozen versions (`scripts/mcp-at-scale/outputs/listing-map-frozen.{json,md}`); every outcome is also broken out by place, descriptively.
9. **gbrain:** per surface and half, right tool on set G; the share of starter trials that widened and that reached a full-only tool, per setup.
10. **INFRA:** trials with a missing server or a runner fault, counted and published, never scored.

Wall time per trial is descriptive only: each VM runs 3 cells at once.

## Sample sizes and what they can detect (stated in advance)

Smallest detectable difference = 2.80 × sqrt(d × deff / n) in points (80% power, two-sided 5%), from `scripts/mcp-at-scale/analysis/power.ts`. Wave 3 sat near the ceiling and gave no discordant pairs for the right-tool, no-tool, set T and mechanism comparisons, so the plan's assumed d = 0.2 stands for them. For gbrain the declared planning value is wave 2's d = 0.333 (20 of 60 pairs, 12 clusters, 95% range 0.20 to 0.47), measured under the old grading; wave 3, under the fixed grading, measured 0.40 (8 of 20 pairs, one cluster).

| Comparison | Pairs | d | deff 1.5 | deff 2.5 |
|---|---:|---:|---:|---:|
| Right tool, one setup, one rung against its 30 rung | 240 | 0.2 (assumed) | 9.9 | 12.8 |
| Right tool, a two-model harness at one rung | 480 | 0.2 (assumed) | 7.0 | 9.0 |
| Right tool, 8 setups pooled at one rung | 1,920 | 0.2 (assumed) | 3.5 | 4.5 |
| Tool when none needed, one setup at one rung | 80 | 0.2 (assumed) | 17.1 | 22.1 |
| Set T success, 8 setups pooled, 300 against 30 | 256 | 0.2 (assumed) | 9.6 | 12.4 |
| Set T success, with QM's 2 setups added by amendment | 320 | 0.2 (assumed) | 8.6 | 11.1 |
| Mechanism arm against its harness's search, one rung | 240 | 0.2 (assumed) | 9.9 | 12.8 |
| gbrain surface against full, one half, 5 setups × 60 × 2 reps | 600 | 0.333 (wave 2) | 8.1 | 10.4 |
| gbrain surface against full, both halves | 1,200 | 0.333 (wave 2) | 5.7 | 7.4 |
| gbrain surface against full, one half, one harness (descriptive) | 120 | 0.333 (wave 2) | 18.1 | 23.3 |
| gbrain against no gbrain on 160 core requests, 5 setups pooled | 800 | 0.333 (wave 2) | 7.0 | 9.0 |

- **Set T** loses power with 32 tasks: the plan's 7 points (40 tasks, 10 setups) becomes 9.6 points at deff 1.5 for the 8 setups in this run, and 8.6 once QM's two setups join.
- **gbrain margin:** 10 points, one-sided 2.5%. At 600 pairs per half and d = 0.333, power at zero true difference is 98.9% at deff 1 and 93.4% at deff 1.5; at wave 3's d = 0.40 it is 97.2% and 88.5%.
- **Final-look bound.** These figures use 1.96. The interim design's final bound is 1.977, which raises every smallest detectable difference in the table by 0.6% (multiplier 2.817, not 2.80) and lowers each gbrain power figure by at most 0.4 points (93.4% becomes 93.2%, 88.5% becomes 88.2%).
- If the counted run's discordance is higher than assumed, the realised power is lower; the report gives the realised d.
- Pairs cluster by target; the analysis uses the paired sign-flip test and a bootstrap clustered by target. Rungs are tested 300, then 150, then 75, so the 4 rungs need no multiplicity penalty; harnesses are separate decisions.

## Shards and leases

Ubicloud, one standard-8 VM per shard per phase, 12 shards, whole cells per shard and no cell split across machines. Each VM runs 3 cells at once, and trials run one at a time inside a cell. The repository is pinned at this preregistration's merge commit. Every trial in every cell meets the items in one shared order (sha256 of `mcp-at-scale-2026-11-shared-v1` and the rung and item), so a provider drift falls on every arm alike. Each phase of each shard has its own metering lease (`<run_id>:<shard>:p1` and `:p2`) inside the run cap.

| Shard | Cells | Phase 1 trials | Phase 2 trials | Phase 1 lease | Phase 2 lease | Expected hours (phase 1 / 2) | TTL hours (phase 1 / 2) |
|---|---|---:|---:|---:|---:|---:|---:|
| s01 | `hermes-opus-r75`, `hermes-opus-gb-verbs`, `hermes-opus-gb-starter`, `cc-opus-t30` | 564 | 588 | $67.21 | $70.31 | 14.88 / 14.88 | 25 / 25 |
| s02 | `pi-p1-r75`, `pi-direct-opus-r150`, `pi-deferred-opus-r75`, `pi-p1-r150`, `pi-deferred-opus-r150`, `pi-direct-opus-r75` | 960 | 960 | $144.92 | $144.86 | 5.96 / 5.96 | 11 / 11 |
| s03 | `hermes-opus-r30`, `codex-sol-r150`, `openclaw-opus-r300`, `openclaw-opus-r75`, `pi-deferred-opus-r300`, `pi-opus-r75` | 960 | 960 | $106.94 | $106.89 | 12.08 / 12.08 | 21 / 21 |
| s04 | `hermes-opus-gb-full`, `tool-search-off-opus-r150`, `tool-search-off-opus-r300`, `cc-opus-r300`, `openclaw-opus-r150`, `openclaw-p1-t300`, `pi-opus-t300` | 866 | 878 | $239.96 | $240.74 | 13.05 / 13.77 | 22 / 23 |
| s05 | `hermes-opus-r150`, `cc-opus-r150`, `cc-opus-r75`, `codex-sol-r30`, `codex-sol-r300` | 800 | 800 | $79.02 | $78.96 | 13.21 / 13.21 | 22 / 22 |
| s06 | `hermes-p1-r150`, `openclaw-opus-gb-full`, `openclaw-p1-r150`, `cc-opus-r30`, `tool-search-off-opus-r75`, `pi-p1-t30` | 850 | 862 | $93.26 | $95.53 | 13.33 / 13.69 | 22 / 23 |
| s07 | `hermes-p1-r30`, `cc-opus-gb-starter`, `cc-opus-gb-registered`, `tool-search-off-opus-r30`, `openclaw-opus-r30`, `hermes-opus-t300` | 884 | 908 | $116.83 | $121.51 | 13.57 / 13.76 | 23 / 23 |
| s08 | `hermes-p1-r300`, `cc-opus-gb-verbs`, `cc-opus-gb-full`, `codex-sol-r75`, `pi-deferred-opus-r30`, `pi-direct-opus-r30`, `hermes-opus-t30`, `pi-opus-t30` | 1,060 | 1,084 | $119.31 | $123.83 | 13.59 / 13.91 | 23 / 23 |
| s09 | `openclaw-p1-r300`, `codex-sol-gb-full`, `pi-opus-gb-starter`, `pi-opus-gb-full`, `cc-opus-t300`, `openclaw-opus-t300`, `pi-p1-t300` | 790 | 826 | $73.66 | $77.19 | 8.54 / 8.92 | 15 / 16 |
| s10 | `hermes-opus-r300`, `openclaw-p1-r30`, `openclaw-opus-gb-starter`, `pi-opus-gb-verbs`, `pi-p1-r300`, `hermes-p1-t30`, `hermes-p1-t300`, `openclaw-opus-t30` | 916 | 940 | $119.41 | $126.34 | 13.05 / 13.14 | 22 / 22 |
| s11 | `hermes-p1-r75`, `openclaw-p1-r75`, `codex-sol-gb-starter`, `pi-p1-r30`, `pi-opus-r150`, `codex-sol-t300` | 850 | 862 | $45.95 | $47.80 | 12.46 / 12.63 | 21 / 21 |
| s12 | `codex-sol-gb-registered`, `codex-sol-gb-verbs`, `openclaw-opus-gb-verbs`, `pi-opus-r300`, `pi-opus-r30`, `pi-direct-opus-r300`, `codex-sol-t30`, `openclaw-p1-t30` | 1,094 | 1,130 | $333.19 | $344.25 | 13.02 / 13.75 | 22 / 23 |
| **Total** | 77 | 10,594 | 10,798 | $1,539.66 | $1,578.21 | | |

- **Leases** are 125% of the projected cost plus $3 per shard, split between the phases by projected cost. The $3 is there because the metering proxy holds back about $2.84 for each Opus request before forwarding it (the 128,000-token output cap); a lease with less room can't start an Opus request.
- **TTL** is 1.5 times the expected hours plus 2, rounded up, well above each phase's expected wall time.
- **Claude Code and a slow gbrain start.** Claude Code connects its MCP servers at startup, and a gbrain that answers too late is missing for the whole trial (HE-MCP-001, INFRA). In the keyless listing map this happened to all four Claude Code gbrain cells at 3 cells at once on a 2-core machine, and to none of them one at a time. In wave 3, all 24 Claude Code gbrain trials connected gbrain, at 2 cells at once on standard-8. Shards s07 and s08 each run two Claude Code gbrain cells beside a third cell. **Rule, fixed now:** the spec is not edited mid-run (an edit voids every phase 1 final through the runner's identity check), so these cells run as frozen in both phases. If more than 5% of any Claude Code gbrain cell's phase 1 trials are HE-MCP-001, a rerun of the Claude Code gbrain cells at one cell at a time per VM goes under a new run id, by a dated amendment that states its cost; INFRA trials in this run are still not rerun, and the report gives the INFRA count per cell and surface.
- **Before the fan-out:** every pre-launch script runs once on one fresh VM through the same SSH path the fan-out uses (the pre-smoke), at this file's merge commit. Then s01 runs as the canary; the other shards launch only after the canary has a scored trial with trusted handshakes copied off its VM. At most 12 VMs at once (96 vCPUs), always within the project's 464 and the team's 208; usage is checked before each launch.
- **Results leave each VM every 10 minutes and at the end;** every VM is destroyed on exit and `ubi-runner.sh list --mine` is empty at the end; UBI_OWNER is the running thread's code. The VM-to-shard map is kept outside the controller machine.
- **The spec is not edited during the launch.** The margin file's sha256 is pinned here and checked again before phase 2. Phase 2 runs every cell, cells behind a comparison stopped at the look included (see [Interim look](#interim-look)). A shard's claim is released only when it has no VM and no open lease.
- **Phase 2** refuses to start unless that shard's phase 1 final is present, drained and cleaned up. A lease stop publishes that shard's cells as partial and is never retried to change a result. No lease or cap is raised mid-run.

## Analysis and exclusions (frozen)

- `scripts/mcp-at-scale/analysis/analyze.ts` computes every comparison above from the merged trials, paired by setup, item and repetition, with clustered intervals. `interim.ts look` runs the one look. The gbrain margin is read from [margins.json](margins.json).
- **Counted trials** are all trials except INFRA: HE-MCP-001 to 003 (a catalog server missing or unreachable), HE-MCP-040 to 044 (no trial directory, no outcomes, a budget refusal, an undrained meter, a provider failure) and HE-MCP-050 (an installed version that doesn't match versions.json). INFRA trials are listed with their code, never scored, and not rerun inside this run.
- **A trial whose meter shows no call to its cell's model is INFRA.**
- **The final analysis runs only on a merged index whose per-phase trial counts match this plan** (10,594 and 10,798), confirmed by the claim-check reader before any number is published.
- **Provider safety-filter stops** are their own outcome, reported apart from model failures (R38, R95).
- **Every outcome by place** (described, named only, server only, omitted, full schema) is descriptive.

## Fixed now

- **Harnesses** (`scripts/mcp-at-scale/versions.json`, frozen 2026-11-19, each checked inside the trial container): Claude Code 2.1.328 (native binary sha256 `a982d380…`), Codex 0.170.0, OpenClaw 2026.11.5, Pi 1.5.2, Hermes v2026.9.24 (its newest tag; its main branch is ahead). `scripts/frontier-harbor/pin.json` is unchanged.
- **gbrain** v0.60.763.0.
- **Models:** Opus 5.5, GPT-6.2 Sol and particle-1 through the metering proxy, at each harness's default effort.
- **GPT-6.2 Sol's context window as Codex uses it is 872,000 tokens** (measured: Codex 0.170.0's bundled model list gives `max_context_window` 872,000, and its rollouts in wave 3 report a usable `model_context_window` of 828,400). The 1,050,000 in versions.json's `models` entry is the provider's published metadata; no request in this run comes near either number, and the runner is not changed for it.
- **Catalog, request sets, runner, grader and analysis** at this preregistration's merge commit; the data files in pins.sha256 are also hash-pinned (see [Pinned files](#pinned-files)).

## Deviations from the plan

- **gbrain surfaces are 173 / 36 / 8 tools,** not the plan's 179 / 41 / 7; the plan's counts were from an earlier release.
- **Starter is tested as shipped.** The plan said starter could not reach full-only tools; the model can widen it through `request_tools`, so it is judged on both halves.
- **gbrain runs on 5 frontier setups,** not 6: the sixth is QM, which joins by amendment. The registered cell runs on 2 setups, not 5 (see [Arms](#arms)).
- **Set G runs twice per gbrain cell** and the margin is 10 points, not 7 (gbrain's maintainers' pick, after the pilot's discordance came in well above the planned 0.2).
- **Set T has 32 tasks, not 40:** the fixed audit's replacement rule and the exhausted reserve (see [Requests](#requests)).
- **Codex runs GPT-6.2 Sol,** not GPT-6.1 Sol (R116, 2026-11-21).
- **Three pilot waves, not one,** because grading bugs invalidated the first two as gate evidence. Three gbrain arms passed their pilot tenth over the three waves (see [Pilot](#pilot)). Wave 3 ran as a pilot (no phase split), and its three mechanism arms ran together in one serial shard; some Hermes, OpenClaw and Pi cells got extra set R pilot items to fill their gates.
- **No-tool power is assumed, not measured:** no pilot wave gave discordant no-tool pairs.
- **Rung sizes** are 30, 74, 145 and 303 tools.
- **Authoring by a Gemini 4 Carbon Capy subagent;** Carbon's adjudication runs one request at a time, not by batch (the paid-request guard has no Gemini batch route). In the first audit about $10.79 of Carbon requests were charged but lost when an interactive run was interrupted; in the redone audit 8 Carbon answers were empty (3 spent the whole output limit on thinking, 1 timed out) and were sent again through the same guard until each had a verdict.
- **No stop at 8 model requests.** The plan stopped each trial at 8 model requests; the runner ends a trial when the harness ends its turn or at 900 seconds, and model requests are counted as search effort.
- **3 cells at once per VM** (the plan's sharding note assumed one trial at a time per shard); wall time is descriptive only.
- **QM** comes by amendment (see [QM](#qm)).

## Money

- **Spent before this file:** $262.78 paid. Item audits $64.40 (the first audit $43.09, the redone audit $21.31) and pilots $198.38 (wave 1 $117.68, wave 2 $54.95, wave 3 $25.75).
- **Counted run:** projected model spend $2,465.47 (with $308.95 for repeating set G), leases $3,117.87, reserve $311.79, **cap $3,429.66**. The projection uses the wave 1 cost per trial for each cell, scaled to set T's 32 tasks; GPT-6.2 Sol has the same list price as GPT-6.1 Sol. Wave 3 spent 11% more than its own projection ($25.75 against $23.18). With the plan's VM and model-use estimates the whole test stays within the approved $4,420 to $5,370.

## Commands

From a worktree pinned at this preregistration's merge commit, with `UBI_OWNER`, `UBI_QUOTA_VCPUS=464` set on every call, and the private request sets copied beside [run-spec.json](run-spec.json) (`run.ts check` refuses any set whose sha256 differs):

1. Check: `bun scripts/mcp-at-scale/run.ts check --spec <dir>/run-spec.json` and `show`.
2. Claims: set `HE_MCP_LAUNCH_RECORDS` to an existing directory on durable storage that every controller shares. Every paid phase launch refuses without it and keeps one claim per lease there.
3. Phase 1, per shard, canary first: `scripts/mcp-at-scale/run-shard-vm.sh --spec <dir>/run-spec.json --name <shard> --dest <dest>/<shard> --phase 1 --size standard-8 --pull-seconds 600`.
4. Phase 1 index, once every shard's phase 1 is final: `bun scripts/mcp-at-scale/run.ts phase-1-index --spec <dir>/run-spec.json --out <look>/index --finals <dest>/<shard>/phase-1/final/<shard> ...` with all 12 shards.
5. The look: `bun scripts/mcp-at-scale/analysis/interim.ts look --trials <look>/index/trials.jsonl --sets <the three set files> --state <look>/interim-state.json --out <look> --margins docs/benchmarks/2026-11-mcp-at-scale/margins.json`.
6. Phase 2, per shard, whatever the look decided: the phase 1 command with `--phase 2 --interim-state <look>/interim-state.json`. The wrapper checks that shard's phase 1 final first, and after phase 2 it writes the shard's merged trials (`run.ts merge-phases`) to `<dest>/<shard>/trials.jsonl`.
7. Analyse: concatenate the 12 merged files into one index, then `bun scripts/mcp-at-scale/analysis/analyze.ts --trials <index> --sets <the three set files> --interim-state <look>/interim-state.json --margins docs/benchmarks/2026-11-mcp-at-scale/margins.json --out <dir>`.

## Pinned files

[pins.sha256](pins.sha256) hashes the data files this preregistration freezes: this folder's run-spec.json, margins.json, set R halves and set T reserve order, the arm budgets (`analysis/arms.json`), the interim design, the frozen listing map, and the catalog ladder with its SHA256SUMS. The request sets themselves are pinned by the sha256 in the [Requests](#requests) table and in run-spec.json. The code the run loads (the runner, grader, catalog host, gbrain relay, agent cells, analysis, versions.json and the metering proxy) is fixed by this preregistration's merge commit: every shard runs from a worktree pinned at that commit, and main is diffed against the pinned files before merge.

## Receipts

Under `docs/benchmarks/2026-11-mcp-at-scale/results/`: per shard and phase its trials, ledger summary, accounting, key scan and VM records; the merged trials; the interim look's record; the analysis outputs. Transcripts pass the key scan and the public-safety scan before the results pull request.

**Order.** This preregistration and the results never share a pull request. This file merges to main before the first counted trial.

## Amendments

Each amendment is a dated commit before any cell it affects. The first planned one adds QM's cells.

## QM

QM (yc-software/qm) runs through another team thread's shared QM support for the Harbor runner, which has not landed. Its native arm (× Opus 5.5 and × particle-1, all 4 rungs, sets R and T) and its gbrain cells will be added by a dated amendment with its own pilot under R111, at QM's newest main commit then. QM's rows are reported beside this run's, with the build they ran on.

## Not measured

- Gemini CLI: listing map only, no paid row (it runs only Gemini models).
- particle-1 on the mechanism and gbrain arms.
- Harness versions newer than the ones frozen here.

## Outside terms

The catalog's tool lists come from open-source servers under MIT, Apache-2.0 and similar licences; each licence and notice ships in `tasks/mcp-at-scale/catalog/LICENSES/`, with the changes made listed in `MODIFICATIONS.md`. No server's code runs; only its captured tool list is replayed.

## Disclosures

gbrain and gstack are Garry Tan's own projects. QM is a project of Y Combinator, which Garry Tan runs. The report ends with the matching lines from the disclosures list, word for word.
