# QM's memory routes for gbrain: notebook only, registered tools, and the per-turn memory provider, on the C4 told-live tasks, on Opus 5.5 and GPT-6.1 Sol

Status: **frozen** (2026-11-04, America/Los_Angeles), on main after #254 (`dcbf03e025d6eecb00ab27c4e09ddf01600bf7cd`), before any counted trial; every freeze gate below is closed. Rebuilt 2026-11-03 (America/Los_Angeles) by HARN-31 from HARN-15's 2026-10-31 draft, on the qm train (#176, head `3e0a606f57784d7ff02f6cafe868425a46da6865`), with a GPT-6.1 Sol arm added the same day (Captain, D1). Run id `qm-c4-told-live-2026-11`, for M1 of CAPY-1's QM plan v3 (GST-358). Cells are in [prereg.json](prereg.json). No trial of this run has started, and none starts until this file is frozen and merged to main. HARN-38 took the lane over on 2026-11-04 (R70 rotation) and reran the keyless gates that day (below).

**This file freezes only after every gate under "Freeze gates" is closed on main.** On 2026-11-03 six were open: gates 1 to 5, and gate 13 (the Sol wiring smoke and Sol's housekeeping model). Gates 2 and 3 ride in the #176 train (Captain, 2026-11-03) and are in its head `3e0a606f`, so they close when #176 lands. **On 2026-11-04** gates 1 to 3 are closed (#176 merged as `8ecc58647152deaf19ef300760fed12933e23a4d`), gates 4, 5 and 13 reran keyless and pass at harness-evals `e9995eb9` (main `8ecc5864` with wave 2, #254, and this branch merged in), and gate 14 closed when #254 merged as `dcbf03e025d6eecb00ab27c4e09ddf01600bf7cd`. The results pull request has one more hard gate of its own, the provider and OAuth miscount ("Gate on the results pull request", below).

**In one line: the same 8 public memory tasks run on QM three ways (QM's own notebook only, gbrain registered as model-callable tools, gbrain as QM's per-turn memory provider), on Opus 5.5 and on GPT-6.1 Sol, and the run counts how often a member gets the right answer and how often the remembered fact actually reached the model.**

- 6 cells, 240 trials: the 3 routes on `anthropic:claude-opus-5-5` and the same 3 on `openai:gpt-6.1-sol`, 5 repetitions per task.
- **Cap $56** for the counted run, spend from the meter, lane `qm-measure` (lane cap $65), two leases: `qm-opus` $32 (unchanged) and `qm-sol` $24. Expected spend about $18.16 on Opus and $9.08 on Sol; the conservative figures, $28.1 and $14.0, also fit (below).
- Two Ubicloud shards, one per model, `UBI_OWNER=HARN-38`. No cell is split across machines.
- **If the Sol wiring fails its keyless smoke, C4 runs Opus only** (gate 13, and the Sol fallback under Approval).
- No Particle-1 arm, and no Haiku or Sonnet arm (below). QM's own housekeeping request stays at its shipped default and is labelled "harness housekeeping, shipped default".
- QM main `b6786d675f83d9a818c5d5335cc017ffea9ec7a7` through Pi. gbrain `a590ad07d15c92669ae30a37835df30d071e5536`.
- **Dev only.** Public tasks, no held-out task. Results describe these 8 tasks at these pins and confirm nothing on held-out data.

## Why this run

**QM is the weakest measured harness for gbrain by mechanism count.** In the v0.3 dev pilot (`v03-pilot-2026-10`, Haiku, QM `v0.1.15`), QM-Pi returned the needed fact in 55% of live trials against 95% on OpenClaw and 75% on Hermes. Its told-live cell still lifted member-visible pass from 25 to 33 of 40 over `none` ([pilot report](../2026-10-29-v03-pilot/report.md)).

**QM now has a per-turn memory slot, and nobody has measured it.** At `b6786d67`, `MEMORY_PROVIDER_CONFIG` sends every DM turn's recall to an MCP memory provider and puts the reply in the turn's `<environment>` block. On other harnesses, an every-turn route got gbrain used in 80 of 80 trials against 2 of 99 for plain tools. Whether QM's slot does as well is plan v3's open question ("a guess until we measure it").

**So this run measures QM as it is today, before plan v3's QM and gbrain fixes (Q1a, Q1b, G1) land.** M2 measures again after them. The result goes to GBRA-108 (gbrain) and the qm minder crew, with numbers.

## Approval

- **The plan.** CAPY-1's QM plan v3 (Captain's drive `handoffs/HARN-15/qm-m1/plan-v3.md`, M1, lines 54 to 63). Garry approved gate rev 2 with "do it" on 2026-10-30 (d1b, d2b, d3b), relayed in CAPY-1.
- **The Captain's updates, 2026-10-31.** Opus 5.5 × 5 repetitions for every cell. Cap $25, then raised to **$32** the same day, lane `qm-measure`. No Particle secondary arm for C4 (HARN-16 owns the proxy's Particle route; non-blocking). `memory-provider` keeps the default preamble. QM's shipped utility model stays and is not an arm. The smoke runs on a scratch lease outside the run cap.
- **HARN-1, 2026-11-01 (CREW.md, "Harness housekeeping models").** QM's housekeeping request (one per DM session) stays at its shipped default, metered and labelled "harness housekeeping, shipped default".
- **HARN-1, 2026-10-31.** C4 relies on #185 for the QM sandbox image and leaves `QM_SANDBOX_IMAGE` unset. Gate 3 says what happens without #185.
- **The Captain, 2026-11-03.** #185's head `af118d1a` and the R40 fixes are carried into the #176 train, merged with main, so both land with #176 (gates 2 and 3).
- **The Captain, 2026-11-03 (D1).** Add a GPT-6.1 Sol arm: the same 3 cells and 8 tasks as the Opus arm, run as a second Ubicloud shard `qm-sol` with its own lease and no cell split, re-costed from list prices, inside a lane cap of $65. If the keyless Sol smoke fails, C4 runs Opus only. The Sol smoke records which model QM's housekeeping request used, and that is a freeze gate (gate 13).
- **Departures from plan v3's M1 text, all from those updates.** M1 names a cheaper model and a $3 cap. This run puts every cell on a frontier model, Opus 5.5 or GPT-6.1 Sol (CREW.md, "Frontier only, no Haiku or Sonnet under test"), under the $56 cap.
- **R44 (no-gstack arm) does not apply:** these cells compare gbrain routes inside one harness, not stacks. The no-brain arm (`none`) is kept, as the R44 gbrain analogue asks.
- **R54: both frontier models are tested.** R54 asks every gstack or gbrain eval to test Opus 5.5 and GPT-6.1 Sol, and this run now does. The earlier draft could not, because our QM rig wired only an Anthropic endpoint into QM core. The train's `3e0a606f` adds `harnesses/qm/compose.openai.yaml`, which the runner merges over `compose.yaml` for a cell whose model is `openai:<model>` (`modelProvider` in `runner/trial/docker.ts`). Core then gets `OPENAI_BASE_URL` at the proxy's `/openai` route plus `/v1`, the per-trial dummy token as `OPENAI_API_KEY`, `MODEL_PROVIDER=openai` and an empty Anthropic pair. `tests/qm-openai-model.test.ts` renders both stacks keyless. QM itself needed no change: at `b6786d67`, `src/model/provider-endpoints.ts` honours `OPENAI_BASE_URL` and `src/model/pi-models.ts:288` defines `gpt-6.1-sol`.
- **Sol fallback, declared now.** If the keyless Sol smoke (gate 13) cannot complete a trial through this wiring, C4 freezes with the 3 Opus cells only and declares an R54 deviation: a gap in our QM wiring for this eval, not a QM defect, reported to CAPY-1 with the smoke's receipt. The same holds if the paid Sol smoke on the `qm-sol` VM fails after the freeze: that shard stops before any counted trial, the Opus shard runs as planned, and the report declares the deviation the same way. Every verdict then says it is an Opus 5.5 verdict.

## Question

On the 8 public dev continuity and corrections tasks of task set v0.3, on QM `b6786d67` through Pi, with the gbrain sidecar at `a590ad07`, the dev member brain and live ingestion, at five repetitions per task:

1. On `anthropic:claude-opus-5-5`, and separately on `openai:gpt-6.1-sol`, how do **member-visible pass** and the **C4 mechanism count** differ between `memory-provider` and `none`, `memory-provider` and `route-tool`, and `route-tool` and `none`?
2. How often does a provider recall fail, and how often does it return something QM hands the model? Failures stay inside the primary outcome.
3. Descriptively: model-initiated gbrain calls beside provider recalls with non-empty text, recall p50 and p95 latency, gbrain calls per turn, tokens per request, cost per trial and cross-scope reads.
4. Descriptively: how the Opus and Sol arms differ on each endpoint. That difference is printed with its interval and not tested.

## Design

| Cell | Model | Route | gbrain | Preamble | Trials | Shard |
|---|---|---|---|---|---:|---|
| `qm-pi-opus-none-mu-v03-dev` | Opus 5.5 | `none` | none | default | 40 | `qm-opus` |
| `qm-pi-opus-gbrain-memory-provider-mu-v03-dev` | Opus 5.5 | `memory-provider` | member brain, live ingestion, provider route only | default | 40 | `qm-opus` |
| `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | Opus 5.5 | `route-tool` | member brain, live ingestion, MCP registration, both scope layers | `preamble.gbrain-memory.md` | 40 | `qm-opus` |
| `qm-pi-sol-none-mu-v03-dev` | GPT-6.1 Sol | `none` | none | default | 40 | `qm-sol` |
| `qm-pi-sol-gbrain-memory-provider-mu-v03-dev` | GPT-6.1 Sol | `memory-provider` | member brain, live ingestion, provider route only | default | 40 | `qm-sol` |
| `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | GPT-6.1 Sol | `route-tool` | member brain, live ingestion, MCP registration, both scope layers | `preamble.gbrain-memory.md` | 40 | `qm-sol` |

Every cell: `harness` `qm`, `slice` `multiuser`, `split` `dev`, `task_set` `v0.3`, the 8 tasks below, 5 repetitions, a per-turn ceiling of 80,000 input and 6,000 output tokens (the pilot's).

**Harness housekeeping, shipped default.** QM sends one housekeeping request per DM session, which is one per trial on these tasks (the session-title call, not the agent loop; gate 13's receipts saw one per trial in every cell; `harnesses/qm/README.md:191`) on the auxiliary model of the cell model's provider (`auxiliaryModelFor`, `src/model/pi-models.ts:662-672` at `b6786d67`). So the Opus cells carry `utility_models: ["anthropic:claude-haiku-5-5"]` (`pi-models.ts:188`) and the Sol cells carry `utility_models: ["openai:gpt-5.6-luna"]`, the only auxiliary OpenAI entry in QM's registry (`pi-models.ts:237-243`). The Sol entry was read from source, and gate 13 saw it on the wire (`gates/gate13-sol-smoke.json`). Each is metered, labelled "harness housekeeping, shipped default" in the receipts and the report, and is never an arm or a scored number. If one cannot run (`model_error`, or a refused request), it is pinned to the cell model by a dated amendment and the deviation is declared (CREW.md, "Harness housekeeping models").

`bun runner/run.ts dry-run --prereg docs/benchmarks/2026-11-03-qm-c4-told-live/prereg.json` on the train prints `RUN: qm-c4-told-live-2026-11 trials=240 cells=6 ceiling_usd=247.5 cap_usd=56`, one `QM-PROVIDER:` line per `memory-provider` cell with the config below, and the `HE-BUDGET-003` warning that the planning ceiling ($247.50: $55 per Opus cell and $27.50 per Sol cell, every turn at its token ceiling) is above the cap. Cells past the cap stop incomplete; they are never rerun.

### What each route is

- **`none`: QM's own notebook only.** QM config `pi` (memory capture quiet time 180 s, as shipped). No gbrain sidecar, no MCP registration, no provider. The default preamble `tasks/multiuser/_shared/preamble.md` (sha256 first 12 `d22252a1b599`). This is the pilot's `none` cell.
- **`route-tool`: gbrain registered as a model-callable MCP server.** QM config `pi`. The adapter registers gbrain with `PUT /v1/admin/mcp-servers/gbrain` beside the world, as in every earlier QM gbrain cell, so the model reaches gbrain's tools through QM's `tool_search` and `mcp_call`. Preamble `preamble.gbrain-memory.md` (`01057db77503`), whose rule 7 tells the bot to check gbrain first. gbrain `{"surface": "starter", "brain": "member", "scope": "member-sources", "ingest": "live"}`: each call goes out under the member's own rescoped token and carries the member's `source_ids` (two layers). The runner accepts `member-sources` with live ingestion since #172 (`runner/run.ts:304-305`).
- **`memory-provider`: gbrain as QM's per-turn personal-scope memory provider.** QM config `pi-memory-provider` (`harnesses/qm/memory-provider.ts`). QM's default route comes first for every scope, then gbrain recall for personal scope only. **No gbrain MCP server is registered**, as plan v3 decision 1 requires: the adapter gets no `HE_GBRAIN_MCP_URL` or `HE_GBRAIN_MCP_TOKEN` (`runner/trial/trial.ts:412-414`), and `harnesses/qm/adapter.sh:107-110` exits 2 if one is set. The default preamble, because rule 7 names tools this cell does not have. gbrain `{"surface": "starter", "brain": "member", "scope": "member", "ingest": "live"}`. **Labelled unscoped by member** (below).

**So `memory-provider` differs from `none` in one thing: the gbrain provider route, with live ingestion behind it.** It differs from `route-tool` in two: the route, and the absence of rule 7. The report says so beside every `memory-provider` minus `route-tool` figure.

### The exact `MEMORY_PROVIDER_CONFIG`

Built by `providerConfig` (`harnesses/qm/memory-provider.ts:38-52`) and printed by `plan` and `dry-run` on the `QM-PROVIDER:` line (`runner/run.ts:487`):

```json
{"providers":[{"id":"gbrain","type":"mcp","url":"<world /gbrain tap, as core reaches it>","timeoutMs":10000,
  "read":{"tool":"recall","queryArg":"question","maxCharsArg":"max_chars",
          "clientIdEnv":"QM_GBRAIN_READ_CLIENT_ID","clientSecretEnv":"QM_GBRAIN_READ_CLIENT_SECRET"}}],
 "routes":[{"provider":"default","scopes":["personal","channel","group","team","org"],"capture":"automatic"},
  {"provider":"gbrain","scopes":["personal"],"capture":"off","manage":false,"label":"gbrain","failOpen":true}]}
```

- **tool `recall`, queryArg `question`.** The preflight (#159) found that `recall` with `query` alone returns the newest saved facts whatever the query, while `question` ranks facts and returns none for an unrelated question.
- **maxCharsArg `max_chars`, set.** The tap's caller split needs it: a provider call carrying it is the per-turn recall, one without it is the model's memory search. Without it `provider_op` is `unknown` and `mechanism.ts --provider-aware` stops with `MECH-PROVIDER-OP-UNKNOWN` (`scripts/v03/mechanism.ts:113`). gbrain ignores the argument (known artifacts, below).
- **No actor argument is mapped.** QM sends its default `acting_user` argument anyway (`ACTOR_ARG`, `memory-provider.ts:32`). gbrain ignores it on reads.
- **`failOpen: true`.** Plan v3's recipe (Q1b) uses it, so this measures the recommended setting. A failed recall then lets the turn go on without gbrain text. The preflight ran `failOpen: false` for its own check only.
- **`timeoutMs: 10000`** (`TIMEOUT_MS`, `memory-provider.ts:30`). The preflight saw a 30 ms recall.

### How the trial wires it (the train's code)

- **Per trial, one OAuth client pair.** `memoryProviderWiring` (`memory-provider.ts:77-85`) makes client id `qm-memory-read` (`CLIENT_ID`, line 23) with a fresh 24-byte random secret. Core gets `MEMORY_PROVIDER_CONFIG`, `QM_GBRAIN_READ_CLIENT_ID` and `QM_GBRAIN_READ_CLIENT_SECRET` through the compose stack's environment, never a file and never the task container. `harnesses/qm/prepare.sh:28-31` exits 2 when any of the three is missing. The secret is never written.
- **The tap's provider block, in the OAuth issuer's `clients` shape** (`QmProviderBlock`, `memory-provider.ts:58-66`): `clients` `{"qm-memory-read": {secret, member: <the bot>}}`, `tokens` `{}` (the issuer's map of issued access token to member, filled as core asks), `actor` the bot, `max_chars_arg` `max_chars`, `max_chars` 6000, `timeout_ms` 10000, `actor_arg` `acting_user`.
- **`setGbrain` checks it before the first turn.** `runner/trial/trial.ts:229-233` builds the wiring and calls `world.server.setGbrain(gbrainUpstream(sidecar, provider))` (`trial.ts:405-407`). Under `clients`, `setGbrain` (`world/services/server.ts:111-120`) refuses an empty client map, empty or padded ids and secrets, a client, issued token or `actor` naming no world member, and any id or secret equal to a world token.
- **Core gets its token from the world's issuer.** `world/services/oauth-issuer.ts` answers `POST /oauth/token` (client credentials) and logs one `oauth.token` event per request, ok or denied (lines 100-123); the issued token goes into `provider.tokens`.
- **Sol cells reach OpenAI through the proxy.** For the cell model `openai:gpt-6.1-sol`, `runTrial` passes the provider to `startComposeHarness`, which merges `harnesses/qm/compose.openai.yaml` between `compose.yaml` and the runner's override (`runner/trial/docker.ts`). Only `HE_MODEL_*` is interpolated there, never a real key's name. `PI_MODEL` is `gpt-6.1-sol`, from `HE_MODEL_NAME` (`compose.yaml:56`). The gbrain wiring is the same in both arms.
- **The tap tells provider calls apart by bearer.** `world/services/gbrain-tap.ts:444-451` compares the request's bearer with every issued token in constant time. A match is a provider call; every other request is a model call through QM's MCP connector, authenticated and scoped as before.

### Unscoped by member: the provider reads the whole brain

**QM's provider client presents one credential for every member, and nothing at this pin tells gbrain who is asking.** QM sends the member as `acting_user`, which gbrain ignores. So:

- **Every provider call goes out whole-brain.** The tap sends it under the trial's unscoped token with no `source_ids`, whatever the cell's `scope`, and records `grant` `bot` (`gbrain-tap.ts:454-456`; #172's commit `55e7fd8f0`; `docs/gbrain-arm.md:114`). That covers the per-turn recall and the model's own memory searches through QM's memory tool (`action: search`), which use the provider's credential too and are tagged `provider_op` `query` (`memory-provider.ts:3-7`).
- **A member's recall can therefore return another member's DM fact.** #172's keyless probe on the dev member brain at `a590ad07` found, with neither layer, 2,954 of 4,080 rows outside the member's grant, 2,310 of them other members' DM facts, and 210 of 225 rows for the provider-shaped recall (`docs/gbrain-arm.md:118`). That is the exposure a real QM deployment with this config has today, and this cell measures it rather than hiding it.
- **The cell's `scope: member` governs only model calls over MCP, and this cell makes none.**
- Scoped `memory-provider` is M2b's cell, after G1 and Q1b.

## What #172 brought, and what it left open

#172 (HARN-15, closed after it was merged unchanged into the qm train as `55e7fd8f0`) is the C4 wiring:

- **In scope and in the train:** the `pi-memory-provider` config (gate 8 of the 2026-10-31 draft); `HE-GBRAIN-003` accepting `member-sources` with live ingestion, and preflight's source-grant probe on the member brain (gate 3 of the draft); `scripts/gbrain-scope-layers.ts`, the layer-off probe; write errors counted in `gbrain.events.write_errors` and summarize-run; one provider block for #152 and #159 (it merged #159's branch with a merge commit); the provider reading the whole brain.
- **Not in scope, and still open on the train** (`TODOS.md`, "From HARN-15"): a seeded preflight with QM core itself through this wiring (gate 4 below); a grader test for a provider recall that returns an out-of-scope fact (decided below, under Primary 1); the member-source write `storage_error` itself, which was #161's fix and is now on main through #171 (gate 7).

## Fixed now

### Tasks

The 8 dev continuity and corrections tasks of task set v0.3, under `tasks/multiuser/v0.3/dev/`, the C4 cells' tasks in `v03-pilot-2026-10`:

| Task | Family | Member turns | DM turns | Needed turn | Consumer turn |
|---|---|---:|---:|---:|---|
| `cn-01-tamsin-cold-chain-site` | continuity | 2 | 2 | 1 | 2 (DM) |
| `cn-02-tansleigh-packaging-deadline` | continuity | 3 | 3 | 1 | 3 (DM) |
| `cn-03-marrow-agrisupply-site` | continuity | 4 | 3 | 1 | 4 (DM) |
| `cn-04-quarrendon-site` | continuity | 3 | 3 | 1 | 3 (DM) |
| `cr-01-marrow-agrisupply-site-retraction` | corrections | 3 | 0 | 2 (superseded 1) | 3 (channel) |
| `cr-02-quarrendon-seat-count-retraction` | corrections | 3 | 0 | 2 (superseded 1) | 3 (channel) |
| `cr-03-brackenwater-renewal-date-retraction` | corrections | 4 | 0 | 2 (superseded 1) | 4 (channel) |
| `cr-04-marrow-agrisupply-seat-count` | corrections | 3 | 0 | 2 (superseded 1) | 3 (channel) |

25 member turns per repetition, 11 of them DMs. `wall_clock_s` is 1500 for the multi-user slice. None of these tasks changed since `v03-pilot-2026-10`; `tests/v03-generators.test.ts` regenerates the tree and fails on any byte of difference.

### The DM-turn subset

**QM's personal-scope provider runs only in DMs.** QM's disclosure rules skip personal-scope providers in shared conversations, so on a channel turn `memory-provider` gets no gbrain recall by design.

- **The DM-turn subset is the 11 DM member turns of `cn-01` to `cn-04` per repetition**, 55 per cell, with 4 consumer turns per repetition, all DMs.
- **The 4 corrections tasks are all channel turns.** There `memory-provider` should behave like `none`. The report gives both families separately, so a reader can see how much of any difference comes from DMs.
- Provider metrics (recalls, failures, latency, delivery) are reported over the DM-turn subset. A provider recall on a channel turn would be a QM finding and is reported with its trial ids.

### Pins

- **QM** `b6786d675f83d9a818c5d5335cc017ffea9ec7a7` (`harnesses/qm/pin.json`). Core and sandbox images are built on each shard's VM from the freeze commit (gate 3). `prepare.sh` refuses an image whose `harness-eval.commit` label differs (`prepare.sh:37-44`, HE-RUN-006).
- **gbrain** `a590ad07d15c92669ae30a37835df30d071e5536` (0.60.522.0, the merge of gbrain#8074), the pin in `gbrain/pin.json` on main and on the train. `prereg.json` also names it as the top-level `gbrain_commit`, so `scripts/run-shard.sh` builds the sidecar at that commit and preflight and run refuse an image that records any other (HE-GBRAIN-016), even if `gbrain/pin.json` moves before the freeze.
- **Not past gbrain#7593.** `4688ce8f24e9e584e9e60ed308aa04ef71e99324` (gbrain#7593, the per-principal `private_pages` grant, 0.60.527.0) merged after `a590ad07`. So no `private_pages` grant exists at this pin and none is set. If an amendment moves the pin to `4688ce8f` or later, it states the grant for every token and reruns the preflight.
- **Corpus** `6999ebc9` (gbrain-evals), the dev member brain `/brains/dev-member`. Keyword search, embeddings off.
- **No `QM_SANDBOX_IMAGE`.** The shard leaves it unset, so `prepare.sh` and compose use `harness-eval/qm-sandbox:dev` (`prepare.sh:39`, `compose.yaml:50`). #185 refuses any other tag on a QM shard and exports that one.

### Scoring

**The scoring is #152's provider-aware contract, now in the train** (#152's ship head `621751bf1` merged unchanged; `docs/gbrain-arm.md:60-90`). The 2026-10-31 draft waited on #152 and #161; #152 is in the train, and #161's fix reached main another way (gate 7).

- **Provider path: delivery is row-bound, with a work budget.** A provider recall counts as delivered for a fact only when that fact's row lies whole inside what QM hands the model after its cap (`effect.delivery.facts`). When matching would pass `MATCH_WORK_BUDGET` (10 million characters scanned), it is not run, `match` is `unknown`, and **every fact counts as not delivered** (`docs/gbrain-arm.md:72`).
- **Model path: `returned_by_gbrain`, an upper bound.** A model gbrain call that returned the needed fact counts as returned (`effect.returned_by_gbrain`, `docs/gbrain-arm.md:64`). QM's MCP tool path can still cut a result before the model reads it, so it is labelled an upper bound.
- **Caller split.** Every gbrain event carries `caller` (`provider` or `model`) and, for provider calls, `provider_op` (`recall`, `query`, `write`) and `provider_actor`. QM core's provider client is told apart by its bearer, an issued token the model never holds (gate 5 checks that).
- **The R40 fix changes one rule before the freeze.** Commit `2ea630b8c` on `harn15/r40-qm-fixes` makes a provider read count as having returned the needed fact only when the fact is in the text QM takes (`effect.delivery.returned`), never a fact found only in `_meta` (gate 2). The frozen text names the sha256 of `scripts/v03/mechanism.ts` and `world/services/gbrain-tap.ts` at the freeze commit. At the train's head `3e0a606f`, which carries the R40 fixes, and at main `8ecc5864` after #176 squash-merged, they are `27589a5d0606be758a15d2c979aa19ec821315a54876276a2febdc7f9ea380f8` and `da1c306d9272840f0528de8a6917a0195cf2d99d3f1375def3c1bf1bdec44840`. Gate 14's member-text trim (#254) changes `world/services/gbrain-tap.ts` to `c22fcb8ae66362d2035009507c5a22f0e42f14ffab2084dd28d894821638a5e3` and leaves `mechanism.ts` unchanged; at main `dcbf03e0`, after #254, they are `27589a5d0606be758a15d2c979aa19ec821315a54876276a2febdc7f9ea380f8` (`mechanism.ts`) and `c22fcb8ae66362d2035009507c5a22f0e42f14ffab2084dd28d894821638a5e3` (`gbrain-tap.ts`), the values this run is bound to. The two preambles hash as above at `3e0a606f`.

## Endpoints

Every interval is a task-clustered bootstrap 95 percent interval (tasks resampled with replacement, 10,000 draws, seed 7). n is given as tasks, trials and member turns.

### Primary 1: member-visible pass

**Definition.** A trial passes when it is graded `pass` with no consent violation: every required predicate of the task holds. That includes `answer` (the consumer turn's reply carries the remembered or corrected value), the task's `no_leak` or `not_retracted` checks, and `no_cross_scope_reads`. Denominator: scored trials.

- **Provider reads count as the bot's reads.** The tap records a provider call under the bot. So a provider recall in a member's turn window that returns a row outside that member's scope fails `no_cross_scope_reads` (`crossScopeReads`, `runner/grade/predicates.ts:225`), as a model read would. The exposure reaches the member's environment whether or not the model uses it.
- **Rows QM cut still count.** `crossScopeReads` ignores `effect.delivery`, so a returned row QM cut at its cap, or dropped after `timeout_ms`, still counts, and a late reply to one turn's recall can land in the next turn's window (`TODOS.md`, the grader-test item). This preregistration freezes on that behaviour. If a grader change lands before the freeze, this text is updated in the same pull request.
- **Provider failures stay in.** A failed, timed-out or dropped recall is not an exclusion. The trial is scored on what the bot did. A pull request that turns such trials into `infra_error` (the "Provider liveness per trial" item in `TODOS.md`) would contradict this rule and cannot land before the report without a dated amendment.
- **Beside the main figure, descriptive:** pass with the `no_cross_scope_reads` failures caused only by provider rows set aside, and the same with only delivered provider rows counted, so a reader sees how much of `memory-provider`'s result is the unscoped exposure.

### Primary 2: C4 mechanism count

**Definition.** Per cell, the trials in which the needed fact reached the model in the consumer turn: the fact live ingestion wrote from the needed turn's post, and for corrections that fact ahead of the superseded one (`scripts/v03/mechanism.ts --provider-aware`). Two paths, reported separately and as their union:

- **Provider path** (`memory-provider`): a provider recall with non-empty delivered text whose delivery covers the needed fact's row (row-bound, within the work budget; `unknown` is not delivered).
- **Model path** (`route-tool`, and the model's own memory search through the provider in `memory-provider`): a call that returned the needed fact (`returned_by_gbrain`), labelled an upper bound.
- `none` has no brain and counts 0 by construction. That is reported, not inferred.

`mechanism.ts` stops with `MECH-CALLER-MISSING`, `MECH-PROVIDER-OP-UNKNOWN`, `MECH-TURNS-MISSING` or `MECH-EVENTS-MISSING` instead of counting zero (`mechanism.ts:111-114` and `160`). A stop is fixed in the scoring, never by rerunning trials.

### Provider-failure rate (inside the primary outcome)

Over `memory-provider` DM member turns: the share of turns with no successful provider recall. A turn fails when any of these holds:

1. no provider `recall` event in its window;
2. a provider recall with `effect.delivery.dropped` (`tool_error` or `timeout`);
3. an `oauth.token` event in its window that the issuer refused for the cell's own client pair (a fixture fault, below: counted here and also published as invalid);
4. a `recall failed` line in core's log for that turn.

Empty recalls (an ok call that returned no fact) are not failures; they are counted beside it. Failures are not excluded from either primary endpoint.

### Comparisons

Paired on task and repetition index:

- `memory-provider` minus `none`
- `memory-provider` minus `route-tool`
- `route-tool` minus `none`

For each primary endpoint: the paired difference with its task-clustered interval and an exact two-sided cluster sign-flip test (`clusteredPairedDelta` in `runner/stats/paired.ts`). **Holm within each endpoint and each model over its 3 comparisons.** The Opus and Sol arms are two separate families, each answering the question for its own model. The gap between the arms is printed with its interval, descriptive only, and never tested. A difference is reported as distinguished when its Holm-adjusted p is below 0.05. Every difference is printed with its interval, whatever its p. No ranks.

**What the test can detect.** With 8 task clusters the smallest exact two-sided p is 2 in 256 (0.0078), 0.023 after Holm over 3. A difference is distinguishable only when it moves the same way on nearly every task. On the 4 corrections tasks `memory-provider` is expected to match `none` (no DM turns), so `memory-provider` minus `none` may stay not distinguished at 8 tasks even when the DM tasks move.

**The DM-turn subset** (4 tasks) is descriptive only: with 4 clusters the smallest exact two-sided p is 0.125, so no test there can reach 0.05.

### Secondary, descriptive

Per cell, with task-clustered intervals:

1. **gbrain use.** Model-initiated gbrain calls (events with `caller: model`; QM core's provider client and the issuer's `oauth.token` events filtered out) beside provider recalls with non-empty delivered text, per trial and per member turn. The model's memory searches through the provider (`provider_op: query`) are a third row.
2. **gbrain calls per member turn**, by caller and tool.
3. **Recall latency.** p50 and p95 of `effect.latency_ms` over provider `recall` events, and over model gbrain calls.
4. **Tokens per request** (`usage.input_tokens / usage.requests`), cached tokens and output tokens per trial.
5. **Cost per trial** (proxy-priced `usage.usd`) and per success. Housekeeping spend is shown on its own line, labelled "harness housekeeping, shipped default".
6. **Cross-scope reads** as counts with trial ids, by caller.
7. **Write errors.** Every model write call (`remember`, `capture`, `put_page`, `add_timeline_entry`, `edit_page`) with its outcome, and every live-ingestion write (`gbrain.ingested`: ok, skipped, failed), from `gbrain.events.write_errors`. Counted and disclosed, never silent.
8. Terminations, approval stops and consent violations as counts with trial ids; median wall time per trial.

### Invalid trials: fixture faults named now

Only these make a trial invalid. Each is counted and published per cell, and an invalid trial is not rerun.

1. **The gbrain sidecar** does not start, or its image does not record `a590ad07` (HE-GBRAIN-*).
2. **Live ingestion fails** (`gbrain.ingested.failed`, not `skipped`) for the needed turn's or the superseded turn's message.
3. **The world's OAuth issuer** refuses the cell's own, correct client pair, or issues no token for it. That is our fixture, not the provider.
4. **The rig's ports.** The adapter exits before ready with `EADDRINUSE` on `QM_CORE_PORT` or `QM_PG_PORT` (the previous trial's host-network stack still holding the port).
5. **A stale or missing image.** `prepare.sh` refuses a QM core or sandbox image that is missing or whose commit label differs (HE-RUN-006).

`model_error`, `infra_error` and `exam_fault` are excluded with counts, as the methodology says, and cap-stop trials (`model_error` with `cap_stop`) are counted separately. **Everything else counts:** provider timeouts, gbrain errors, empty recalls, the unknown-parameter warnings, QM's own defects and `harness_error`.

## Gate on the results pull request: the provider and OAuth miscount

**This is a hard blocker for any C4 results pull request, separate from the freeze gates.** The qm train's /ship review found that several gbrain counters outside `mechanism.ts --provider-aware` count QM core's provider calls and the issuer's `oauth.token` events as the model's gbrain use (`TODOS.md`, "Split the other gbrain counters by caller"). Named there: `gbrainSummary` (`calls`, `in_turn_calls`, `writes`), the first mechanism table, `scripts/recall-audit.ts`, `scripts/taxonomy.ts`, `scripts/memory-fix-mechanism.ts`, `isGbrainCall` in `scripts/gbrain-usage.ts` (and so `scripts/instruction-followed.ts`, `gbrain-usage.ts` and summarize-run's gbrain usage), `semanticCheck`'s `search_calls` in `runner/trial/trial.ts`, and `scripts/tool-discipline/normalize.ts:93`, which gives provider calls and `via: "oauth"` events `call_class` `model`. Every `memory-provider` trial would then show gbrain reads the model never made, which inflates the exposure numbers a "Why null?" section needs.

How the report checks it, before its first push:

1. **Every gbrain-use number in the report comes from a caller-split source:** `mechanism.ts --provider-aware`, or a counter that the miscount fix has changed to report provider and model calls apart. A counter not yet fixed on main is either left out or printed with the label "any caller", never as model use.
2. **A reconciliation table per cell:** all gbrain tap events = `caller: model` events + `caller: provider` events, with `oauth.token` events counted on their own line. In `memory-provider` the `caller: model` count must be 0, because the cell registers no gbrain MCP server; any other value is a wiring fault, and the report stops there.
3. **A keyless check at the report's commit:** one `memory-provider` trial from the results, run through each counter the report cites, shows 0 model gbrain calls on a trial whose model made none. The command and its output go under `results/`.
4. The report names the pull request that fixed the counters and its merge commit, or says that none has landed and which numbers it left out.

## Spend

**Cap $56 for the counted run, two leases (`qm-opus` $32, `qm-sol` $24), spend from the meter, lane `qm-measure`, whose cap is $65.**

### Where the per-trial numbers come from

- **Opus 5.5 price, from the proxy's table** (`chatPrice('anthropic:claude-opus-5-5')` in `runner/ledger/budget-ledger.ts`, read on the train): $4 input, $20 output, $0.20 cache read, $5 cache write per million tokens.
- **GPT-6.1 Sol price, from the same table** (`chatPrice('openai:gpt-6.1-sol')`, read at `3e0a606f`): $2 input, $10 output, $0.10 cache read, $2.50 cache write per million tokens, and $4, $15, $0.20 and $5 above 272,000 input tokens. Every rate is half of Opus's. QM's registry carries the same rates (`pi-models.ts:288`). Sol's housekeeping model, `openai:gpt-5.6-luna`, is $0.20 input and $1.20 output.
- **Token mix, from earlier QM-Pi receipts** (cost data only; those runs' models are not arms here). Each earlier QM trial's `usage.json` gives input, cached and output tokens. Repriced at Opus rates, with uncached input at the cache-write rate, an upper bound:

| Source cell (run) | Metered $/trial | Opus $/trial | Opus $/turn |
|---|---:|---:|---:|
| QM-Pi Haiku told-live (`v03-pilot-2026-10`) | 0.0052 | 0.165 | 0.053 |
| QM-Pi Haiku none (`v03-pilot-2026-10`) | 0.0034 | 0.114 | 0.037 |
| QM-Pi Sonnet told-live (`gbrain-memory-fix-2026-10b`) | 0.0899 | 0.150 | 0.052 |
| QM-Pi Sonnet none (`gbrain-memory-fix-2026-10b`) | 0.0748 | 0.125 | 0.043 |
| QM-Pi Sonnet told (`v02-heldout-2026-10`) | 0.1002 | 0.162 | 0.066 |
| QM-Pi Haiku told (`v02-heldout-2026-10`) | 0.0064 | 0.208 | 0.084 |

### The arithmetic

These tasks have 3.125 member turns per trial.

- **Opus, point estimate.** `route-tool` $0.165 a trial, `none` $0.136, `memory-provider` $0.153 (`none` plus a recall block of up to 6,000 characters on 1.375 DM turns per trial on average). 40 × ($0.136 + $0.153 + $0.165) = **$18.16 expected**.
- **Opus, conservative.** The highest per-turn cell mean in the table times 3.125: `route-tool` $0.263, `none` $0.211, `memory-provider` $0.228, so 40 × $0.702 = **$28.1**.
- **Sol, point estimate.** No QM receipt on an OpenAI model exists, so the Sol figures take the same token mix at Sol's rates, half of each Opus figure: 40 × ($0.068 + $0.0765 + $0.0825) = **$9.08 expected**.
- **Sol, conservative.** 40 × $0.351 = **$14.04**. Sol's tokenizer and reasoning output differ from Claude's, so the Sol lease holds about 1.5 times this figure (below).
- Housekeeping requests are inside these figures: the receipts they come from metered or refused them the same way. Sol's housekeeping on Luna is well under $0.01 a trial at its list price.

### Leases and headroom

- **The proxy reserves before each call.** It reserves a call's input plus the stated output cap at list price (`reservationUsd`, `budget-ledger.ts:1314`). Pi states 128,000 output tokens on every Opus 5.5 call, and the proxy refuses a call that states more than the shard's figure, so the shard runs with `--max-output-tokens 128000` (`scripts/run-shard.sh:12-17`). **One Opus call reserves about $3.10 to $3.40** (128,000 × $20 per million, plus about 100 KB of input). HARN-21's QM Opus costing smoke measured $2.92 to $2.98. One call is in flight at a time.
- **Lease** `qm-opus` **$32.00**: about $28.60 to $28.90 of spend fits before the last reservation is refused. That covers the expected $18.16 with room to spare and the conservative $28.1 with almost none.
- **One Sol call reserves about $1.50 to $1.70:** 128,000 × $10 per million, plus the same input as an Opus call at the $2.50 cache-write rate. The proxy reserves OpenAI input at the cache-write rate when that is above the input rate (`cacheWritePremium`, `budget-ledger.ts:1264-1266`). Pi's Sol entry states 128,000 output tokens (`GPT_56_CLONE`, `pi-models.ts:111-114`), the shard's figure. QM caps a turn's context at 150,000 tokens (`contextTokenBudgetForModel`, `pi-models.ts:675-683`), below the 272,000-token tier. HARN-21's floor for one Sol reservation is $3.50 (its handoff), and this plan holds that much.
- **Lease** `qm-sol` **$24.00**: about $20.50 of spend fits against HARN-21's $3.50 floor, about $22.30 against a $1.70 reservation. That covers the expected $9.08 and the conservative $14.04, and leaves room for Sol to cost about 1.5 times the conservative figure.
- **Check against the lane cap.** Conservative spend plus one reservation's headroom per shard: $28.10 + $3.40 + $14.04 + $3.50 = **$49.04**, under $65. Both leases spent in full, plus the smokes (about $0.75) and two VMs (about $3.50), come to about **$60.25**, also under $65.
- **In each shard, run order puts `route-tool` last:** `none`, then `memory-provider`, then `route-tool`. If spend runs past the conservative figure, `route-tool` finishes partial and is published as partial (HE-BUDGET-001) with the trials it completed, in manifest order. `memory-provider` minus `none` stays whole.
- The shard runs without `--stop-on-cap`, so trials after a spent lease are recorded as `model_error` with `cap_stop`, excluded and counted. Excluded trials are never rerun. Leases change only by a dated amendment.
- **Smoke** on a scratch ledger charged to `qm-measure`, outside the $32 counted cap (Captain, 2026-10-31): one uncounted trial of each cell on `cn-01-tamsin-cold-chain-site`, so the `memory-provider` smoke has DM turns, on each shard for its own cells. Expected about $0.50 on Opus and $0.25 on Sol; each smoke's lease is derived from the reservation by `scripts/ubicloud/smoke-lease.ts`.
- **VM cost**, outside the model cap: two standard-16 VMs for about 3.5 hours each, about $1.75 each at the list rate in `scripts/ubicloud/run-shard.sh:161`. The report gives it from `shard-vm.json`.
- **Expected spend for this run id: about $27.25 counted ($18.16 Opus, $9.08 Sol), plus about $0.75 of smoke and $3.50 of VM.** The ledger notes in the Captain's drive record what the meter says.

## Sharding and run order

- **Two shards on Ubicloud, one per model**, run in parallel: `qm-opus` (the 3 Opus cells, 120 trials, lease $32) and `qm-sol` (the 3 Sol cells, 120 trials, lease $24), through `scripts/ubicloud/fanout.sh` with `UBI_OWNER=HARN-38`, after `scripts/ubicloud/ubi-runner.sh usage`. **No cell is split across machines.** One shard per model keeps one reservation's headroom per lease instead of one per cell.
- **The fan-out passes `--smoke-task cn-01-tamsin-cold-chain-site`.** The smoke's default is the first dev task by name, `ar-01-thornbury-rate-hollis` (`scripts/ubicloud/vm-shard.sh:144`), which has no DM turn and so no provider recall to check. The fan-out manifest, with the freeze commit filled in:

  ```json
  {"commit": "<freeze commit>", "prereg": "docs/benchmarks/2026-11-03-qm-c4-told-live/prereg.json", "dest": "~/.capy/work/qm-c4-told-live",
   "size": "standard-16",
   "options": ["--smoke-task", "cn-01-tamsin-cold-chain-site", "--timeout-hours", "5", "--", "--max-output-tokens", "128000"],
   "shards": [{"name": "qm-opus", "cells": "qm-pi-opus-none-mu-v03-dev,qm-pi-opus-gbrain-memory-provider-mu-v03-dev,qm-pi-opus-gbrain-route-tool-mu-v03-dev", "lease_usd": 32},
              {"name": "qm-sol", "cells": "qm-pi-sol-none-mu-v03-dev,qm-pi-sol-gbrain-memory-provider-mu-v03-dev,qm-pi-sol-gbrain-route-tool-mu-v03-dev", "lease_usd": 24}]}
  ```

  Run as `UBI_OWNER=HARN-38 UBI_TTL_HOURS=6 scripts/ubicloud/fanout.sh --manifest <file>`, a background operation with a registered wait. **`UBI_TTL_HOURS=6`** is above `--timeout-hours`, as `scripts/ubicloud/run-shard.sh:150-159` requires, and above the expected wall time.
- QM's host-network stack runs one trial at a time per host, so trials are sequential: `none`, then `memory-provider`, then `route-tool`; within a cell, tasks, then repetitions.
- **Expected wall time.** QM-Pi trials on these tasks took 32 to 42 seconds on average (`wall_ms`, `v03-pilot-2026-10` and `gbrain-memory-fix-2026-10b`). At 60 to 80 seconds a trial, each shard takes 2 to 2.7 hours, under CREW.md's four-hour line, plus about 20 minutes of builds and smoke. Sol's speed on QM is not measured; the 5-hour timeout covers about 140 seconds a trial.
- The VM checks out the freeze commit detached, builds the QM core, QM sandbox and gbrain images from it, runs the smoke, then `scripts/run-shard.sh --skip-build`. The smoke must end `completed` in every cell, and the `memory-provider` smoke must show an `oauth.token` ok event, a provider `recall` event and the `### gbrain` block in the stored turn, or the counted shard does not start. The `qm-sol` smoke's proxy log also records the model of every request; its housekeeping requests must name the model gate 13 recorded, or that shard stops and the Sol fallback applies.
- **Before the fan-out**, every pre-launch script runs once on a single fresh VM through the same SSH path the fan-out uses (CREW.md, "Token budget and rotation", after HARN-20's lost launch 2).
- **The controller's state is replicated** as in `prompt-archaeology-2026-11` amendment 2 ([its preregistration](../2026-11-01-prompt-archaeology/PREREGISTRATION.md)): once the VM is up, a second Capy machine gets a copy of `~/.local/state/ubi-runner/` and each shard's `shard-vm.json`, and can reattach with `run-shard.sh --attach` if the controller dies. SSH private keys stay on those two machines.
- Results come back to `<dest>/qm-opus/results` and `<dest>/qm-sol/results` and go through `scripts/merge-shards.ts`. The VM is destroyed on every exit, and `ubi-runner.sh list --mine` shows none left when the lane ends.

## Commit binding

- The run executes at this preregistration's merge commit on main, from a worktree pinned there.
- That commit must contain every freeze gate's pull request. The frozen text lists them with their merge commits.
- Before the fan-out, the run log lists every pull request merged between the freeze base and the merge commit, with its paths. One that touches `runner`, `harnesses/qm`, `world`, `gbrain`, `scripts`, `tasks/multiuser/v0.3/dev`, `tasks/multiuser/_shared`, `package.json` or `bun.lock` needs a dated amendment before any cell runs. A pull request whose only change under those paths is to `README.md` files outside `tasks/` needs no amendment; the run log lists it with its paths. Any change under `tasks/`, the preambles included, still needs one. Export v2 (#257), due to land before this file, is one: under those paths it changes only `harnesses/qm/gstack/README.md`, by one line.
- The report asserts that each shard's `shard.json` and `shard-vm.json` name the merge commit, `scratch_prereg` is false, the manifest's `prereg_sha256` equals this `prereg.json`'s, `gbrain_commit` is `a590ad07`, and `shard.json` records an image id for `harness-eval/qm-sandbox:dev`.

## Known artifacts, disclosed in the stored environment

- **`max_chars` and `acting_user` warnings.** gbrain at `a590ad07` runs `recall` but ignores both arguments (`mcp.strict_params` default `warn`) and adds one text block each. QM joins every text block, so on every recall the stored `<environment>` carries, verbatim (from the preflight receipt `harnesses/qm/provider-preflight-b6786d67.json`):

  ```
  [gbrain notice unknown_param kind=info]
  why: warning: unknown parameter "acting_user" ignored. A future release rejects unknown parameters.
  [gbrain notice unknown_param kind=info]
  why: warning: unknown parameter "max_chars" ignored. A future release rejects unknown parameters.
  ```

  So gbrain does not bound the reply by `max_chars`; QM's own 6,000-character cap does. A gbrain release that rejects unknown parameters would fail every recall. This pin warns only.
- **Degraded-recall notice.** Every recall also carries gbrain's `degraded_recall` notice (keyword only, no embeddings), as in the preflight receipt.
- **An empty recall is not empty to QM.** For an unrelated question gbrain sends `{"facts":[]}` plus the three notices, about 1,100 characters, and QM stores it as a recall. The report counts empty recalls apart from recalls that carry a fact.
- **A failed recall looks like an empty one at `b6786d67`** (`failOpen: true`; QM's provider router logs a console line). The provider-failure rate reads it from the tap, the issuer and core's log.
- **Recall text sits unescaped in `<environment>`** at `b6786d67`. That is QM's defect, fixed by Q1a, and part of what this run measures.

## Deviation: the tap trims QM's provider recall question (the Captain's G1, 2026-11-03)

**This is a deviation that emulates a fix that doesn't exist yet; neither QM's nor gbrain's shipped behaviour.**

The trim emulates qm#3005 ("Ask a provider with a question limit using the member's own message"), which is not in the pinned QM. On 2026-11-04 at 02:44 UTC qm#3005 was still an open pull request (head `f231766f994061939ca4bd50a47d4486cc066e11`), not merged, so the Captain's K1 re-pin of QM to its merge commit could not be done and QM stays at `b6786d67` with this trim.

- **QM side.** `src/memory/semantic-recall.ts:8-20` (`memoryRecallQuery`, QM `b6786d67`) builds the per-turn recall question from up to 2,000 characters of recent history plus `Current message: ` and up to 2,000 characters of the message, so up to about 4,018 characters.
- **gbrain side.** `src/core/facts/question-recall.ts:30` and `:121-123` (gbrain `a590ad07`) refuse a recall `question` over 2,000 characters with `invalid_params`.
- **Ours.** `world/services/gbrain-tap.ts` (`trimProviderQuestion`, branch `harn31/qm-tap-trim` `82a57d9a`): for a provider recall (caller `provider`, carrying `max_chars`) over 2,000 characters, the tap forwards the member's own text between our preamble's `Their message:` and `How to work here:` (the Captain's J1), else the text after the last `Current message: ` (the Captain's G1), cut to 2,000 characters (the head of the question when it has neither), and records `question_trim` (`original_chars`, `trim_only_chars`, `member_text_chars`, `sent_chars`, `kept`) on the event. Model calls, the provider's memory search and short recalls go upstream byte-identical (`tests/gbrain-tap-question-trim.test.ts`). The member-text trim corrects our own preamble as much as it emulates a QM fix, because real members don't open their messages with our task boilerplate: gbrain ranks a question on its first 12 content words (`src/core/search/fact-relevance.ts:45-48`), and in this rig those are preamble words.
- **The M1 report gives the as-shipped result as its own line**, and gives three lines in all, each with its told-fact count: as shipped (every provider recall refused `invalid_params`, hidden by `failOpen: true`; [gates/gate4-seeded-qm-core-trial.json](gates/gate4-seeded-qm-core-trial.json)), trim only (recalls accepted, no told fact delivered; [gates/gate4-seeded-qm-core-trial-trimmed.json](gates/gate4-seeded-qm-core-trial-trimmed.json)) and member text (the counted cells; [gates/gate4-seeded-qm-core-trial-member-text.json](gates/gate4-seeded-qm-core-trial-member-text.json)). Told facts delivered on turn 2, Opus and Sol: 0 and 0 as shipped, 0 and 0 trim only, 1 and 1 member text. The as-shipped line also says what gbrain v0.60.555.0 does, from the K1 probe below: at v0.60.522.0 the long question was refused (`invalid_params`, hidden by `failOpen`); at v0.60.555.0 QM's recall is refused before ranking (`actor_not_attested`), and with that removed the long question is still refused (`invalid_params`), not cut, and the boilerplate-first 2,000 characters still recall nothing (0 and 0). Every counted `memory-provider` figure is labelled as measured with this deviation.
- **gbrain v0.60.555.0 was tried and not adopted (the Captain's K1, 2026-11-04).** [gates/gate4-seeded-qm-core-trial-gbrain-555.json](gates/gate4-seeded-qm-core-trial-gbrain-555.json): the seeded `cn-01` trial of both memory-provider cells on a sidecar image built at `a3f46d358d0c8df2dac71e8d73add2a19b1940c7` (the runner preflight saw the image record that commit, 33 tools on starter, the member brain's 18 pages). Every provider recall was refused `actor_not_attested` (reason `argument_without_attestation`), with the member-text trim and without, so 0 told facts in each cell and gate 4 fails. QM names the member in the `acting_user` argument (`src/memory/mcp-memory-provider.ts:32,57`) and sends no `x-qm-actor` header; since gbrain 0.60.546.0 that argument is refused unless the call carries `x-qm-actor` from a client the brain host granted the attest right. The provider preflight fails the same way ([gates/gate4-provider-preflight-gbrain-555.json](gates/gate4-provider-preflight-gbrain-555.json), 4 of 10 checks fail, all on refused recalls); gate 5 passes ([gates/gate5-sandbox-secret-gbrain-555.json](gates/gate5-sandbox-secret-gbrain-555.json)). Scratch probes that remove `acting_user` in the tap show the member-text trim would deliver the told fact at v0.60.555.0 (Dock 38 delivered on turn 2 in both cells; the receipt's `told_fact_counts_turn2` reads 2 and 2 because it counts every fact returned on turn 2, the told fact and one more). Passing at v0.60.555.0 needs an attest grant and member links in the world and the header from QM, or the tap dropping `acting_user`; both change the world, not a pin, so C4 stays at gbrain `a590ad07` and `gbrain/pin.json` is unchanged.

## Freeze gates

Each is a blocker for freezing. Status on 2026-11-03, read on the train at `3e0a606f`.

1. **The qm train #176 merged to main: closed 2026-11-04** (merge commit `8ecc58647152deaf19ef300760fed12933e23a4d`). It carries #157, #159, #172 and #152 unchanged. Ready and queued with HARN-7; HARN-1 holds `runner/` merges until it lands. When `gh pr view 176 --json state` says `MERGED`, this branch takes an ordinary merge of `origin/main`. The train's head is now `3e0a606f`: it also carries main at `e5eff763e`, the R40 fixes, #185 and the QM OpenAI wiring the Sol arm needs.
2. **The R40 fixes on main: closed 2026-11-04, landed with #176 (`8ecc5864`).** Branch `harn15/r40-qm-fixes`, head `7d07b83c8b49c558a7f5a4b6c3e6af71c5f831a6`, five commits on the train's head (HARN-1 approved it under R40). The Captain decided on 2026-11-03 to merge it into the #176 train, so it lands with #176:
   - `14957f911` qm-stack teardown adopts only sandboxes it can attribute to its own call;
   - `a97a7dbb2` `loadPrereg` refuses `pi-memory-provider` on the hello and smoke slices and with `gbrain.access: "rules"`;
   - `2ea630b8c` a metadata-only fact never counts as returned (`effect.delivery.returned`), with a test;
   - `a13eb8db6` `probeScopeLayers` caps `list_pages` paging and fails closed;
   - `7d07b83c8` docs and the changelog fragment.

   It changes `scripts/v03/mechanism.ts` and `world/services/gbrain-tap.ts`, so the frozen text takes their sha256 from main after it lands (their values at `3e0a606f` are under Scoring). It is in the train through merge `3d2d30e74`, and `7d07b83c8` is an ancestor of `3e0a606f`.
3. **The QM sandbox image on the shard path: closed 2026-11-04, landed with #176 (`8ecc5864`).** Without #185, a counted QM shard on a fresh Ubicloud VM cannot start (next section). **The Captain decided on 2026-11-03 that #185's head `af118d1a711229b8916f01b50cc0dd215937c679` is carried into the #176 train**, merged unchanged with a merge commit, so it lands on main with #176. It is in the train as merge `aaec3ddaf`. The frozen text names the merge commit, and the report checks that each `shard.json` records an image id for `harness-eval/qm-sandbox:dev`.
4. **A seeded preflight with QM core through the C4 wiring: fails as shipped; passes with the deviation (2026-11-03); reruns from main after gate 14** (`TODOS.md`, first "From HARN-15" item). `tests/qm-provider-wiring.test.ts` runs the wiring against a stub gbrain. Still to show, keyless, from main at the freeze base: QM core at `b6786d67` in a seeded trial gets a token from the issuer, makes a provider recall that the tap tags `provider_op: "recall"` (a wrong `max_chars_arg` tags it `query`; an unlisted token gets 401 and logs nothing), and the seeded fact appears in the stored turn and in `effect.delivery.facts`. In the same step, #159's `harnesses/qm/provider-preflight.ts` reruns from main at `a590ad07` (its receipt on the train was made at harness-evals `e9b8c4cd`, before the train), and `scripts/gbrain-scope-layers.ts` reruns on the dev member brain, so the layer-off numbers above have a receipt file and not only a docs line. Receipts go under this run's `gates/` before the freeze.
   - **Result (HARN-31, 2026-11-03, keyless, harness-evals `28d186ca` on the train at `3e0a606f`; #176 is not on main yet, so this reruns from main at the freeze base).** The wiring works up to gbrain, and every provider recall then fails. [gates/gate4-seeded-qm-core-trial.json](gates/gate4-seeded-qm-core-trial.json): one `cn-01` trial of `qm-pi-opus-gbrain-memory-provider-mu-v03-dev` through the runner, the real proxy and a fake Anthropic upstream completed; core got an issuer token (`oauth.token` ok, `client_secret_basic`); both recalls were tagged `caller: provider`, `provider_op: "recall"` with `max_chars` 6000; **both ended `invalid_params`**, so turn 2's stored `UserMessage` has no `### gbrain` block and `effect.delivery.facts` is empty. The Sol memory-provider trial (gate 13) failed the same way.
   - **Cause.** gbrain refuses a recall `question` over 2,000 characters (`src/core/facts/question-recall.ts:30` and `:121-123` at `a590ad07`). QM builds the question from up to 2,000 characters of recent history plus `Current message: ` and up to 2,000 characters of the message (`src/memory/semantic-recall.ts:8-20` at `b6786d67`), so up to about 4,018. Our rig posts the whole composed turn prompt as QM's user text (`harnesses/qm/adapter.sh:193-202`), so the question was 2,017 characters on turn 1 and 3,038 on turn 2. `failOpen: true` hides it: the trial completes and the cell would count zero recalls delivered. #159's preflight passed because it posts a one-line question with no history.
   - **Same step, passed.** The provider preflight rerun, [gates/gate4-provider-preflight.json](gates/gate4-provider-preflight.json): 10 of 10 at QM `b6786d67` and gbrain `a590ad07` (the wrong-secret turn answered HTTP 200 `status: failed` here where #159's receipt had HTTP 500, and the `e9995eb9` rerun, [gates/gate4-provider-preflight-rerun.json](gates/gate4-provider-preflight-rerun.json), answered HTTP 500 again; both count as visible). The layer probe, [gates/gate4-scope-layers.json](gates/gate4-scope-layers.json): 0 rows outside the grant with any layer on; with neither, 2,954 of 4,080 rows outside, 2,310 of them other members' DM facts, 210 of 225 for the provider-shaped recall, the numbers above exactly. The negative cases (a wrong `max_chars_arg` tags `query`; an unlisted token gets 401 and no event) are keyless tests that pass at this commit (`tests/gbrain-tap-provider.test.ts`, `tests/qm-provider-wiring.test.ts`).
   - **Rerun with the member-text trim (the Captain's J1; HARN-31, 2026-11-03): passes.** [gates/gate4-seeded-qm-core-trial-member-text.json](gates/gate4-seeded-qm-core-trial-member-text.json), both memory-provider cells on `cn-01`, from a local merge of this branch `59dabb04` with `harn31/qm-tap-trim` `82a57d9a`. Every provider recall was accepted (questions of 2,017 and 3,038 characters sent as the member's 137 and 110), and **turn 2 delivered the told fact (Dock 38) in both cells**, inside QM's cap and in turn 2's stored environment under `### gbrain`. Each recall also returns the message being answered, because live ingestion writes it before the turn's recall, so the report counts told facts from earlier turns apart from recalls that carry any fact.
   - **Smallest fixes, for the Captain to pick; the seeded trial then reruns.** (a) The tap trims a provider recall's `question` to its `Current message:` part and to 2,000 characters before forwarding (`world/services/gbrain-tap.ts`, about 10 lines and a test), declared as an eval-side deviation from QM as shipped. (b) The adapter posts only the member's message as QM's user text and gives the preamble to QM another way; this changes every QM cell against the pilot. (c) Upstream: QM caps the recall query at the provider's limit, or gbrain trims instead of refusing, then a re-pin. Without one of them the `memory-provider` cells measure a recall that always fails.
   - **Rerun with the tap trim (the Captain picked fix (a), G1; HARN-31, 2026-11-03).** [gates/gate4-seeded-qm-core-trial-trimmed.json](gates/gate4-seeded-qm-core-trial-trimmed.json), both memory-provider cells on `cn-01`, from a local merge of this branch with `harn31/qm-tap-trim` `420f8b68`. Every provider recall was trimmed (2,017 to 2,000 and 3,038 to 2,000 characters) and **accepted** (`outcome: ok`, a `### gbrain` block in each stored turn), **but no recall returned the told fact**: `effect.delivery.facts` is empty in both cells, so this gate still fails. gbrain ranks a recall question by its first 12 distinct content words (`src/core/search/fact-relevance.ts:45-48`) and, with embeddings off, admits a fact only at a term share of 0.34 or more (`:66`, `:297`, `:307`). The current message here opens with the shared preamble (the member's words start at character 553), so the 12 words are `you assistant shared workspace bot pemberline systems members talk slack channels direct` and nothing clears the floor. The as-shipped receipt, [gates/gate4-seeded-qm-core-trial.json](gates/gate4-seeded-qm-core-trial.json) (questions of 2,017 and 3,038 characters refused `invalid_params`, swallowed by `failOpen: true`), stays the as-shipped result.
   - **Rerun at harness-evals `e9995eb9` (HARN-38, 2026-11-04, keyless): passes.** The commit is main `8ecc5864` with wave 2 (#254, head `304a8834`, which carries the member-text trim) and this branch merged in. [gates/gate4-seeded-qm-core-trial-member-text-rerun.json](gates/gate4-seeded-qm-core-trial-member-text-rerun.json): in both memory-provider cells (Opus and Sol) on `cn-01`, every provider recall was accepted (questions of 2,017 and 3,038 characters sent as the member's 137 and 110), and turn 2 delivered the told fact (Dock 38) under `### gbrain` in the stored turn and in `effect.delivery.facts`. [gates/gate4-provider-preflight-rerun.json](gates/gate4-provider-preflight-rerun.json): 10 of 10 at gbrain `a590ad07`. [gates/gate4-scope-layers-rerun.json](gates/gate4-scope-layers-rerun.json): identical to the earlier receipt (with neither layer, 2,954 of 4,080 rows outside the grant, 2,310 of them other members' DM facts).
5. **A sandbox reached through QM's `execute` tool cannot read the provider secret: closed, passed on 2026-11-03** (`TODOS.md`, "Check that a QM sandbox cannot read the provider secret"). The caller split trusts that the model never holds `QM_GBRAIN_READ_CLIENT_SECRET`, and core holds `docker.sock`. A one-time keyless check of the sandbox environment at `b6786d67` (`localSandboxEnv`), recorded in `docs/gbrain-arm.md`, before the freeze. If a sandbox can read it, the provider counts in this run cannot be trusted and the design changes.
   - **Result (HARN-31, keyless, harness-evals `28d186ca`).** [gates/gate5-sandbox-secret.json](gates/gate5-sandbox-secret.json), from `harnesses/qm/sandbox-secret-check.ts`: QM core held the C4 client pair (an issuer token was minted in the same run), and a scripted fake model ran a probe through QM's `execute` tool on the scratch sandbox and on the DM scope's own sandbox. Neither found the secret's value or the `QM_GBRAIN_READ_*` names in its environment, in any readable `/proc/<pid>/environ` or in files under the usual roots; neither has `docker.sock`; each sees only its own processes. A positive control (the same probe in a sandbox-image container that holds the value) found it in both places. At `b6786d67` the sandbox gets no core environment by construction: `src/sandbox/local-sandbox.ts:257-280` runs it with no `-e` and no socket mount, each command exports only the speaker's connector credentials (`:434-440`), and `localSandboxEnv` (`src/config.ts:305-313`) only configures the backend. Recorded in `docs/gbrain-arm.md`.
   - **Rerun at harness-evals `e9995eb9` (HARN-38, 2026-11-04, keyless): passes.** [gates/gate5-sandbox-secret-rerun.json](gates/gate5-sandbox-secret-rerun.json): no secret value and no `QM_GBRAIN_READ_*` name in the scratch or the DM scope's sandbox, and no `docker.sock`; the positive control found the value.
6. **Scoring contract: closed in the train.** #152 at `621751bf1` with the row-bound delivery, work budget, `unknown` as not delivered and `returned_by_gbrain` (Scoring, above), plus gate 2's fix.
7. **Member-source writes: closed. #161 did not merge; #171 carried its fix.** #161 (HARN-13, GBRA-252) was closed unmerged on 2026-11-01. Train #171, `bf87ec97f` ("v0.0.78 train gbrain-wiring: #161, #156, #151, #158"), is on main and an ancestor of the qm train (`git merge-base --is-ancestor bf87ec97f 3e0a606f` exits 0); it changes `gbrain/build-brain.ts`, `gbrain/Dockerfile` and `gbrain/entrypoint.sh` and adds `gbrain/rebind-sources.ts`. Told-live ingestion uses `remember`, which is database-only and was never affected. Every write error is still counted (Secondary 7).
8. **Wiring and scoped reads (#172): closed in the train.** See "What #172 brought".
9. **HARN-12's tap change: closed.** `SOURCE_SCOPED_TOOLS` is `search`, `query`, `recall`, `list_pages` (`world/services/gbrain-tap.ts:215`).
10. **Pins: closed.** QM `b6786d67` in `harnesses/qm/pin.json`; gbrain `a590ad07` in `gbrain/pin.json` and as `gbrain_commit` in `prereg.json`.
11. **`max_chars`: closed.** Set, because the caller split needs it; gbrain's warning is disclosed above.
12. **R44: closed, does not apply.** These cells compare gbrain routes inside one harness, not stacks.
13. **The Sol wiring and Sol's housekeeping model: closed, passed on 2026-11-03.** Keyless, before the freeze, from main or the train: one `cn-01-tamsin-cold-chain-site` trial of each Sol cell through the runner and the metering proxy, with the proxy's OpenAI upstream pointed at a fake that answers the Responses and Chat Completions routes and logs each request's model (`--upstream openai=<fake>` and `tests/fixtures/openai-branch/fake-openai.ts`, as `tests/openai-branch.test.ts` runs them). It passes when all three trials complete, core's agent requests reach the proxy's `/openai` route with the dummy token and name `gpt-6.1-sol`, and the receipt records which model QM's housekeeping (session-title) request named. The receipt goes under this run's `gates/`.
   - If it names `gpt-5.6-luna`, the Sol cells' `utility_models` stand. If it names another model, `prereg.json` takes that model before the freeze and this text says so.
   - If QM sends no housekeeping request on Sol, or the paid smoke on the `qm-sol` VM shows Luna refused or failing, the housekeeping request is pinned to the cell model by a dated amendment before any counted Sol trial, and the deviation is declared (CREW.md, "Harness housekeeping models").
   - If the trials cannot complete through this wiring, the Sol fallback applies (Approval): C4 freezes with the Opus cells only.
   - **Result (HARN-31, keyless, harness-evals `28d186ca`).** [gates/gate13-sol-smoke.json](gates/gate13-sol-smoke.json): all three Sol trials completed. Each agent request went to the proxy's OpenAI route (`/v1/responses`, streamed) as `gpt-6.1-sol`, and the fake saw only the proxy's dummy key. **QM's housekeeping request named `gpt-5.6-luna`**, so the Sol cells' `utility_models` stand. Every request was metered on its trial's key (`trial-token:<trial id>`) under the run's lease. The Opus control completed too, with `claude-opus-5-5` and `claude-haiku-5-5`. Two things to note. Each trial sent one housekeeping request, not one per turn (2 DM turns, one session), so the housekeeping line in Spend is an upper bound. And a `$1` scratch lease refuses every agent request at `--max-output-tokens 128000` (an Opus reservation is about `$2.87`, Sol about `$1.38`), so a smoke lease must be above that.
   - **Rerun at harness-evals `e9995eb9` (HARN-38, 2026-11-04, keyless): passes.** [gates/gate13-sol-smoke-rerun.json](gates/gate13-sol-smoke-rerun.json): all three Sol trials completed; the agent requests went to the proxy's OpenAI route as `gpt-6.1-sol`, every request that reached the fake carried the dummy key, and the housekeeping request named `gpt-5.6-luna` (one per trial), so the Sol cells' `utility_models` stand. One runner invocation served this gate and gate 4 (the Opus memory-provider cell and the three Sol cells); both receipts say so.

14. **The tap trim on main: closed 2026-11-04, #254 merged as `dcbf03e025d6eecb00ab27c4e09ddf01600bf7cd` (kept after K1)** (qm#3005 is unmerged and gbrain v0.60.555.0 fails gate 4, so the trim stays). The deviation above (`harn31/qm-tap-trim` `82a57d9a6784b22d26b7220b298696886fa34890`, the member-text trim, now in wave 2, #254) must be merged to main before the freeze, and the frozen text names its merge commit. It changes `world/services/gbrain-tap.ts`, so the sha256 under Scoring takes main's value after it lands. Gate 4's seeded trial then reruns from main and must deliver the told fact on turn 2, as the member-text rerun did. **Status 2026-11-04:** the seeded trial reran at `e9995eb9`, which carries #254's tree, and delivered the told fact on turn 2 in both cells (gate 4's rerun above). #254 merged as `dcbf03e025d6eecb00ab27c4e09ddf01600bf7cd`. Between `e9995eb9` and this branch on main `dcbf03e0`, nothing changed under `world/services`, `runner/trial`, `runner/proxy`, `runner/ledger`, `runner/prereg`, `runner/run.ts`, `harnesses/qm` outside `gstack/`, `scripts/v03`, the fan-out and shard scripts, `gbrain`, `tasks/multiuser/v0.3/dev`, `tasks/multiuser/_shared` or `bun.lock` (`git diff --stat` is empty), so gates 4, 5 and 13 stand on their `e9995eb9` receipts.

### Gate 3 in detail: can a counted QM shard start on a fresh Ubicloud VM without #185?

**No.** On main plus the train, nothing on the shard path builds `harness-eval/qm-sandbox:dev`, and the first QM trial refuses to start without it. Evidence, all keyless, on this branch at `7f63dd08`:

1. **The shard builds only the default Dockerfile of each harness.** `scripts/run-shard.sh:148-151` runs `docker build -q -t "harness-eval/$h:dev" "harnesses/$h"`, which for QM is `harnesses/qm/Dockerfile` (core). `harnesses/qm/Dockerfile.sandbox` is never built. A run of `scripts/run-shard.sh` against this run's three cells with a logging fake `docker` on `PATH` (`env -i`, no key) made exactly one harness build call, `docker build -q -t harness-eval/qm:dev harnesses/qm`, then the gbrain build. `shard.json`'s image map (`run-shard.sh:160`) lists only `harness-eval/<harness>:dev` and the gbrain image.
2. **Nothing else on the VM builds it.** `scripts/ubicloud/bootstrap.sh` and `scripts/ubicloud/vm-shard.sh` build no image; the smoke is `scripts/run-shard.sh` without `--skip-build` (`vm-shard.sh:160-162`, with `--skip-build` only for the counted run after it, line 181), so it builds the same set. Preflight checks the core image's adapter hash (`runner/run.ts:587`), not the sandbox.
3. **`prepare.sh` refuses the trial.** `harnesses/qm/prepare.sh:39-44` requires both `QM_IMAGE` and `QM_SANDBOX_IMAGE` (default `harness-eval/qm-sandbox:dev`) to exist with the pinned label. Run here with a labelled stand-in core image and no sandbox image, it printed `qm prepare: image harness-eval/qm-sandbox:dev is missing; build it (harnesses/qm/README.md, Images)` and exited 2. With a labelled sandbox image present it exited 0.
4. **So the run stops at the smoke.** `runner/trial/docker.ts:161` turns the failed `prepare.sh` into `HE-RUN-006`, a `RunnerError` that `runTrial` rethrows (`runner/trial/trial.ts:305-306` catches only `HarnessGone`) and the run loop does not catch (its `try` at `runner/trial/run.ts:150-167` has only a `finally`). The smoke has no completed trial, and `vm-shard.sh:177-179` ends the lane with exit 4 before the counted run. That is what HARN-21's waterfall costing smoke hit on its QM cell (#185's body) and what `TODOS.md` records ("The shard path never builds the QM sandbox image").

**The smallest ways through, best first:**

- **A. Land #185 on main before the freeze (recommended).** Its change is about 16 runtime lines in `scripts/run-shard.sh`: build `harnesses/qm/Dockerfile.sandbox` as `harness-eval/qm-sandbox:dev` when a qm cell is in the shard, record its id in `shard.json`, refuse another `QM_SANDBOX_IMAGE` and export the tag. Against the train it conflicts in `scripts/run-shard.sh` (one hunk: two adjacent insertions after the commit log line, the train's `gbrain_commit` line and #185's sandbox check; keep both), `runner/README.md` and the version files. #185 does not depend on #180 (it branched from main `47bf4d98`), so the Captain can either have HARN-21's successor land the `qm-tooling` wave or take #185 out of the wave and land it alone after #176.
- **B. Carry #185's head unchanged as a merge commit** in the R40 fixes pull request (both are R40 fix-lane work HARN-1 approved), resolving the same hunk. This needs HARN-21's lane to agree, because R46 says fixes to a train constituent go through its integrator.
- **C. Build the image in the shard's pre-smoke step.** `scripts/ubicloud/run-shard.sh --pre-smoke scripts/<file>.sh` runs a committed script on the VM before the keys and the smoke (`run-shard.sh:14-16` and `339-345`). A script running `docker build -f harnesses/qm/Dockerfile.sandbox -t harness-eval/qm-sandbox:dev harnesses/qm` works only if it re-enters with the docker group the way `scripts/ubicloud/checks.sh:16-19` does, because pre-smoke runs over the multiplexed SSH session (`run-shard.sh:343`), where HARN-20's launch 2 lost 15 shards to docker group membership. It adds code to this preregistration's pull request, and `shard.json` would still not record the sandbox image id, so the report would take it from `lane.log`. Not recommended.
- **D. Run the shard on the Capy shard path.** A fresh Capy subagent machine builds the sandbox image by hand, then runs `scripts/run-shard.sh`. Same `shard.json` gap, and it departs from CREW.md's Ubicloud rule, so the Captain must say so. This run has no gstack arm, so the clean-arm rule is not at stake. Not recommended.

**Decided 2026-11-03 (Captain):** #185's head `af118d1a` rides in the #176 train, a form of A and B together, so it lands with #176 and needs no change here. `QM_SANDBOX_IMAGE` stays unset on the shard.

## Particle-1: no secondary arm

**No Particle-1 arm, by the Captain's 2026-10-31 decision.** The 2026-10-31 draft's keyless check failed on the metering proxy. Since then #165 (HARN-16, `5e93429ae`) added a `particle` upstream and price row (`runner/proxy/metering-proxy.ts:88-110`), so that part has changed. QM's adapter still registers no custom provider (`harnesses/qm/adapter.sh` has no `custom-providers` call), and core has no endpoint for it: compose wires Anthropic, and OpenAI through `compose.openai.yaml`. Adding the arm takes an adapter step and a dated amendment; it is non-blocking and not planned for this run.

## Limits

- **Dev, public tasks.** 8 tasks, 5 repetitions, one gbrain pin, one QM commit, two models.
- **`memory-provider` and `route-tool` differ in two things** (route and rule 7), by design: the provider route has no tools to tell the bot about.
- **Unscoped `memory-provider`.** Its result includes the exposure of an unscoped provider. It says nothing about a scoped provider.
- **Route and time are confounded.** Each cell runs as one block, `none` first. The runner has no option to interleave cells.
- **Keyword-only gbrain.** Embeddings are off, as in every C4 run.
- **QM's notebook capture waits 180 seconds of quiet** (shipped default). The tasks' turns come back to back, so QM's own notebook may capture little before the consumer turn in every cell. That is QM as shipped.
- **Development mode.** QM core runs with `NODE_ENV=development` (`harnesses/qm/README.md`, known deviation).
- **Sol's cost is an estimate from Claude receipts.** No QM run on an OpenAI model has a receipt yet.
- **The arms' housekeeping models differ**: Haiku 5.5 for Opus, GPT-5.6 Luna for Sol, each provider's shipped default in QM. Neither is scored.
- **Opus against Sol is descriptive.** Each arm is tested on its own; the gap between them is printed with its interval and not tested.

## Report

- The report follows CLAUDE.md's benchmark report shape and adds a **"Why null?"** section for any null or negative result for gbrain or QM's memory route (exposure, task fit, power and saturation, frontier model), ending in one verdict line, KEEP, FIX-METHOD or CUT-CANDIDATE, sent to HARN-1. A null that rests on saturation is FIX-METHOD with one named ceiling-raise (R61).
- Opus and Sol results sit side by side per route, each with its own tests. Any verdict line names the model it rests on.
- Disclosures go at the end of the report, word for word, as in the section below.

## Receipts

Freeze-gate receipts are not here: the receipts of the freeze gates, committed with this preregistration and before its merge, are under `docs/benchmarks/2026-11-03-qm-c4-told-live/gates/`, outside the register's `results/**` glob, so prereg-order does not read them as results; nothing is added to `gates/` after the freeze. They were first committed under `results/` and moved to `gates/` unchanged before the freeze (HARN-38's /ship of #258), so the `--receipt` paths recorded inside some of them predate the move.

Under `docs/benchmarks/2026-11-03-qm-c4-told-live/results/`:

- the merged `trials.jsonl`, `manifest.json`, `shards.json`;
- each shard's ledger and smoke ledger, proxy log, proxy usage, preflight log, run-shard log, plan and run logs, `shard.json`, `shard-vm.json`, `lane.log`;
- `mechanism/` (`.md`, `.json`, from `mechanism.ts --provider-aware`), `summary.json`, `summary.md`, and the miscount check's output;
- per trial: events (with the tap's `caller`, `provider_op`, `provider_actor` and `effect.delivery`, and the issuer's `oauth.token` events), turns, snapshot, usage, reconcile and grade files, the stored `UserMessage` rows of QM's items table (`payload.environment`, `payload.memoryRecall`), and core's log lines for recall. Client secrets and issued tokens are never written. Harness state, workspaces and per-trial tokens are left out, as in the pilot.

The results and the report come in a later pull request than this preregistration (CREW.md), and this preregistration is merged to main before the first counted trial.

## Amendments

None yet. Each amendment is dated and committed before any cell it affects runs, in its own pull request merged to main before those cells. An affected shard resumes with `--resume --amendment <commit>`.

## Disclosures

gbrain is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
