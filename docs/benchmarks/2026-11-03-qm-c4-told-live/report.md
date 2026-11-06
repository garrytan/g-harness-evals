# QM M1: gbrain as QM's memory, on the C4 told-live tasks, on Opus 5.5 and GPT-6.1 Sol

Status: **results** of the counted run `qm-c4-told-live-2026-11` (HARN-38, GST-358, 2026-11-04), preregistered in [PREREGISTRATION.md](PREREGISTRATION.md) and frozen on main at `f5491d7d` (#258). The S1 gstack probe ran in the same lane; it is summarized in section 8 and reported in full in [its own report](../2026-11-03-qm-s1-gstack-probe/report.md).

**QM has moved since this run (status note, 2026-11-06).** The counted results below are for QM `b6786d67`. Current QM may behave differently, and the re-measurement is named below.

- **What M1 ran:** QM `b6786d67` (2026-10-30). QM main has since moved 238 commits, to `18593c65` as of 2026-11-06.
- **The summary finding "As shipped, QM's gbrain provider delivers no told fact on either model" is a statement about `b6786d67`, not about current QM.**
- **Commits since `b6786d67` that can change a `memory-provider` finding:**
  - `f3577189` (qm#2837): makes provider recall safe, with quoted recall and an attested actor.
  - `037018e2` (qm#2838): adds the gbrain memory recipe and meets gbrain's QM provider contract.
  - `066319ee` (qm#3005): asks a provider with the member's own message, under a question limit. M1's member-text trim is labelled as matching it (section 4).
  - `9848ee51` (qm#2694): captures memory only from person-authored turns.
  - `a1b35369` (qm#2987): keeps automatic capture to 20 facts per write and gives provider writes 30 seconds.
  - `b286d5dc` (qm#2754): changes recall ranking (a binary sketch, then an exact rerank of the best candidates).
  - `5546fa13` (qm#3111): skips inbox sync turns when a provider pre-check finds nothing new.
- **The S1 gstack probe has its own list** (the skills tool's save and edit, qm#2899, and two more), in [its report](../2026-11-03-qm-s1-gstack-probe/report.md).
- **Re-measurement:** M2b for memory and GST-1514 for skills. Neither has frozen a QM pin yet: M2b's draft preregistration names QM `037018e2`, and GST-1514 sets its QM SHA (`066319ee` or later) in its pilot amendment.
- **No number or verdict in this report changes.**

**The answer: neither gbrain route moved member-visible pass by a distinguishable amount, on either model.** Every pass comparison has a Holm-adjusted p of 0.375 or more.

- **`memory-provider` (gbrain as QM's per-turn provider) delivered the told fact, and it didn't help.** The fact reached the model in 20 of 20 continuity trials on both models. But QM's own notebook already had it in 20 of 20 `none` trials, and `none` passed every continuity trial.
- **`memory-provider` scored lower than `none`, by its unscoped reads.** Opus 18/40 against 25/40, a difference of -17.5 points [-43, 0]; Sol 20/40, -12.5 [-38, 0]. Set aside the trials failed only by provider rows from another member's scope, and both cells are 25/40, the same as `none`.
- **`route-tool` (gbrain as tools the model calls) pointed up, not distinguished.** Opus 28/40, +7.5 [-5, 20]; Sol 36/40, +27.5 [0, 63]. The gain sits in the corrections tasks, the only family with headroom: Sol 16/20 against 5/20.
- **One difference is distinguished:** on Opus, `route-tool` minus `none` in the mechanism count, +70 points [43, 93], Holm p 0.047, where `none` is 0 by construction (it has no gbrain path).
- **As shipped, QM's gbrain provider delivers no told fact on either model** (keyless gates, section 4). Every `memory-provider` figure is **measured with the member-text trim, which matches QM as shipped at qm `066319ee` (qm#3005, merged 2026-11-05) or later. The M1 runs used the pinned QM, which predates that merge.**
- **Spend:** $23.76 of the $56 cap (Opus $15.16, Sol $8.61), plus $0.42 of smoke and $1.69 of VM. S1: $2.73 of its $20 cap, plus $0.54 of VM.
- **Verdicts** (section 10): `memory-provider` FIX-METHOD and `route-tool` FIX-METHOD, each on both models, because both nulls rest on a saturated task family (R61). S1's router: FIX-METHOD (its report).

**Terms**

- **`none`:** QM's own notebook memory only, no gbrain.
- **`memory-provider`:** gbrain as QM's personal-scope memory provider. QM core calls `recall` before the model runs, in DM turns only. The model gets no gbrain tools. The provider is unscoped by member at this pin.
- **`route-tool`:** gbrain registered as a model-callable MCP server, with the brain-first clause and both scope layers.
- **Told fact:** a fact a member tells the bot in an earlier turn. On `cn-01`, Dana tells it Dock 38 in a DM on turn 1 and asks for it on turn 2.
- **Member-visible pass (Primary 1):** the trial is graded `pass` with no consent violation. That includes `no_cross_scope_reads`, and provider reads count as the bot's reads.
- **Mechanism count (Primary 2):** trials where the needed fact reached the model in the consumer turn (`scripts/v03/mechanism.ts --provider-aware`); for corrections, the corrected fact ahead of the old one.
- **Notebook:** QM's own memory. It shows in the stored turn's environment under `## What you remember`.
- **`failOpen`:** QM's setting that lets a turn go on when a provider call fails. At QM `b6786d67` a failed recall then looks like an empty one.
- **Tap:** our proxy in front of gbrain (`world/services/gbrain-tap.ts`). It logs every call and, under the preregistered deviation, trims the recall question.
- **Intervals:** task-clustered bootstrap 95 percent intervals, 10,000 draws, seed 7, in percentage points. Tests: exact cluster sign-flip, Holm over 3 comparisons per model and endpoint.

## 1. Results

**8 tasks (4 continuity, 4 corrections), 5 repetitions, 40 trials per cell, 240 trials, all `completed`, none excluded.** Source: [results/analysis/c4-analysis.md](results/analysis/c4-analysis.md) and [.json](results/analysis/c4-analysis.json).

| Cell | Model | Member-visible pass | C4 mechanism count | Provider-failure rate (DM turns) | Pass, provider-only cross-scope set aside |
|---|---|---|---|---|---|
| `none` | Opus 5.5 | 25/40 [25, 100] | 0/40, by construction | n/a | 25/40 [25, 100] |
| `memory-provider` | Opus 5.5 | 18/40 [13, 78] | 20/40 [13, 88] | 0 of 55 | 25/40 [25, 100] |
| `route-tool` | Opus 5.5 | 28/40 [45, 93] | 28/40 [43, 93] | n/a | 28/40 [45, 93] |
| `none` | GPT-6.1 Sol | 25/40 [25, 100] | 0/40, by construction | n/a | 25/40 [25, 100] |
| `memory-provider` | GPT-6.1 Sol | 20/40 [13, 88] | 20/40 [13, 88] | 0 of 55 | 25/40 [25, 100] |
| `route-tool` | GPT-6.1 Sol | 36/40 [70, 100] | 20/40 [18, 83] | n/a | 36/40 [70, 100] |

- **Every `memory-provider` figure is measured with the member-text trim, which matches QM as shipped at qm `066319ee` (qm#3005, merged 2026-11-05) or later. The M1 runs used the pinned QM, which predates that merge.**
- **Pass with only delivered provider rows counted** (the prereg's second descriptive line) equals the main figure: 18/40 and 20/40. The failing provider rows were delivered rows.
- **Provider-failure rate:** 0 of 55 DM turns per model. No turn lacked a recall event, none was dropped, the issuer refused no token, and core's log has no `recall failed` line. All 55 turns had delivered text, and 0 recalls were empty.

### By family (descriptive)

| Cell | Model | Continuity pass | Continuity mechanism | Corrections pass | Corrections mechanism |
|---|---|---|---|---|---|
| `none` | Opus 5.5 | 20/20 [100, 100] | 0/20 | 5/20 [0, 75] | 0/20 |
| `memory-provider` | Opus 5.5 | 13/20 [25, 100] | 20/20 | 5/20 [0, 75] | 0/20 |
| `route-tool` | Opus 5.5 | 20/20 [100, 100] | 18/20 | 8/20 [20, 65] | 10/20 |
| `none` | GPT-6.1 Sol | 20/20 [100, 100] | 0/20 | 5/20 [0, 75] | 0/20 |
| `memory-provider` | GPT-6.1 Sol | 15/20 [25, 100] | 20/20 | 5/20 [0, 75] | 0/20 |
| `route-tool` | GPT-6.1 Sol | 20/20 [100, 100] | 5/20 | 16/20 [40, 100] | 15/20 |

- **`none` sits at the ceiling on continuity** on both models, so no route can raise pass there.
- **`none`'s 5 corrections passes are all on `cr-01`** (5/5; the other three tasks 0/5), per task in [results/compare-run.gbrain.md](results/compare-run.gbrain.md). Sol `route-tool` passes `cr-02` and `cr-04` 5/5 each.
- With 4 task clusters no family-level test can reach 0.05 (smallest exact p 0.125), so these rows are descriptive.

## 2. Paired differences

Paired on task and repetition, 40 pairs, 8 task clusters. MDE is the difference the test detects with 80 percent power. Source: [results/analysis/c4-analysis.md](results/analysis/c4-analysis.md).

| Model | Endpoint | Comparison | Difference (points) | Interval | p | Holm p | Distinguished | MDE |
|---|---|---|---:|---|---:|---:|---|---:|
| Opus 5.5 | pass | `memory-provider` minus `none` | -17.5 | [-43, 0] | 0.500 | 1.000 | no | 35.8 |
| Opus 5.5 | pass | `memory-provider` minus `route-tool` | -25.0 | [-50, -3] | 0.125 | 0.375 | no | 36.3 |
| Opus 5.5 | pass | `route-tool` minus `none` | +7.5 | [-5, 20] | 0.500 | 1.000 | no | 18.1 |
| Opus 5.5 | mechanism | `memory-provider` minus `none` | +50.0 | [13, 88] | 0.125 | 0.250 | no | 52.9 |
| Opus 5.5 | mechanism | `memory-provider` minus `route-tool` | -20.0 | [-50, 8] | 0.438 | 0.438 | no | 44.9 |
| Opus 5.5 | mechanism | `route-tool` minus `none` | +70.0 | [43, 93] | 0.016 | 0.047 | **yes** | 38.2 |
| GPT-6.1 Sol | pass | `memory-provider` minus `none` | -12.5 | [-38, 0] | 1.000 | 1.000 | no | 35.0 |
| GPT-6.1 Sol | pass | `memory-provider` minus `route-tool` | -40.0 | [-75, -13] | 0.125 | 0.375 | no | 49.7 |
| GPT-6.1 Sol | pass | `route-tool` minus `none` | +27.5 | [0, 63] | 0.250 | 0.500 | no | 44.8 |
| GPT-6.1 Sol | mechanism | `memory-provider` minus `none` | +50.0 | [13, 88] | 0.125 | 0.250 | no | 52.9 |
| GPT-6.1 Sol | mechanism | `memory-provider` minus `route-tool` | 0.0 | [-57, 60] | 1.000 | 1.000 | no | 89.2 |
| GPT-6.1 Sol | mechanism | `route-tool` minus `none` | +50.0 | [18, 83] | 0.063 | 0.188 | no | 48.5 |

- **Two pass intervals exclude 0, and neither is distinguished:** `memory-provider` minus `route-tool` on Opus [-50, -3] and on Sol [-75, -13]. With 8 clusters the exact test needs the same sign on nearly every task.
- **Corrections only (descriptive):** `route-tool` minus `none` in pass, Opus +15 [-10, 35], Sol +55 [10, 100]. In mechanism, Opus +50 [10, 90], Sol +75 [40, 100].

**Opus minus Sol (descriptive, not tested):** pass `none` 0 [0, 0]; `memory-provider` -5 [-15, 0]; `route-tool` -20 [-43, -3]. Mechanism `route-tool` +20 [-23, 63].

## 3. What happened inside the cells

**In `none`, QM's notebook already answers every continuity task.** The consumer turn's stored environment holds the needed value under `## What you remember` in 20 of 20 continuity trials on both models ([results/analysis/notebook-exposure.json](results/analysis/notebook-exposure.json); descriptive, written after the run).

| Cell | Model | Continuity: notebook holds the answer | Corrections: notebook holds the corrected value |
|---|---|---|---|
| `none` | Opus 5.5 | 20/20 | 5/20 |
| `memory-provider` | Opus 5.5 | 20/20 | 4/20 |
| `route-tool` | Opus 5.5 | 0/20 | 0/20 |
| `none` | GPT-6.1 Sol | 20/20 | 0/20 |
| `memory-provider` | GPT-6.1 Sol | 6/20 | 0/20 |
| `route-tool` | GPT-6.1 Sol | 20/20 | 0/20 |

- **The notebook stops where QM's injected `### gbrain` provider block starts.** A fact the provider delivered is not counted as notebook memory.
- **In Sol `memory-provider`, the notebook held the answer in 6 of 20 continuity trials.** In the other 14, the consumer turn's environment carried the fact only in the `### gbrain` block. Session history may also have carried it; the run did not capture the model request. Opus `memory-provider` had it in both, 20 of 20 (`gbrain_block_has_answer`).
- **In Opus `route-tool`, no consumer turn carries a notebook block at all** (0 of 40). Opus passed continuity anyway, from gbrain (mechanism 18/20).
- **Example:** `trials/qm-pi-opus-none-mu-v03-dev/cn-01-tamsin-cold-chain-site/r1/logs/qm-user-messages.jsonl`, the turn-2 row: "Dana Okafor (North team AM) uses Dock 38 for Tamsin Cold Chain pickups".

**The provider's unscoped reads cost `memory-provider` 7 trials on Opus and 5 on Sol.** Each failed `no_cross_scope_reads` on one provider row and on nothing else ([c4-analysis.md](results/analysis/c4-analysis.md), "Cross-scope read failures by caller").

- Opus: `cn-02` r1 to r5, `cn-03` r2 and r5. Sol: `cn-02` r1 to r5.
- That is the exposure the prereg labelled "unscoped by member". It is the whole gap to `none`.

**The model made no gbrain call in `memory-provider`, as wired.** Reconciliation per cell: all gbrain tap events = model + provider, with `oauth.token` events on their own line ([c4-analysis.md](results/analysis/c4-analysis.md)).

| Cell | Model | All gbrain tap events | Model | Provider | `oauth.token` |
|---|---|---:|---:|---:|---:|
| `memory-provider` | Opus 5.5 | 110 | 0 | 110 (55 `initialize`, 55 `recall`) | 20 |
| `route-tool` | Opus 5.5 | 366 | 366 | 0 | 0 |
| `memory-provider` | GPT-6.1 Sol | 110 | 0 | 110 (55 `initialize`, 55 `recall`) | 20 |
| `route-tool` | GPT-6.1 Sol | 226 | 226 | 0 | 0 |

- `none` cells have 0 gbrain events. The provider made 0 memory searches (`provider_op: query`).
- **`route-tool` events carry no `caller` field.** The cell has no provider client, so the table counts them as the model's. That is a deviation from the prereg's "every gbrain event carries `caller`" (section 12).
- Of the `route-tool` events, `initialize` and `tools/list` are handshakes. The model's own calls, per trial: **Opus 2.58 [1.55, 3.63]** (103 calls in 35 of 40 trials: 67 `remember`, 33 `search`, 3 `recall`); **Sol 0.82 [0.30, 1.45]** (33 calls in 24 trials: 29 `search`, 4 `request_tools`).

**Opus's gbrain writes were mostly refused.** 44 of Opus's 67 `gbrain.remember` calls failed `invalid_params`; 23 succeeded (`reconciliation` and the trials' `events.jsonl`).

- Example: `trials/qm-pi-opus-gbrain-route-tool-mu-v03-dev/cn-04-quarrendon-site/r4/events.jsonl` seq 11, args `entity` plus `facts[]`. The tap records the error code, not gbrain's message.
- Sol made no write call. Live ingestion wrote 319 to 324 rows per gbrain cell with 0 failed and 0 skipped ([results/summary.json](results/summary.json) `ingest`).

**Latency and cost per cell** ([c4-analysis.md](results/analysis/c4-analysis.md), "Secondary").

| Cell | Model | USD total | USD per trial (mean) | USD per success | Median wall s | Recall p50/p95 ms |
|---|---|---:|---:|---:|---:|---|
| `none` | Opus 5.5 | 4.0549 | 0.1014 | 0.1622 | 39.7 | n/a |
| `memory-provider` | Opus 5.5 | 4.3950 | 0.1099 | 0.2442 | 44.0 | 42 / 59 |
| `route-tool` | Opus 5.5 | 6.7057 | 0.1676 | 0.2395 | 46.9 | model gbrain events 9 / 359 |
| `none` | GPT-6.1 Sol | 2.7215 | 0.0680 | 0.1089 | 40.8 | n/a |
| `memory-provider` | GPT-6.1 Sol | 2.6871 | 0.0672 | 0.1344 | 42.1 | 39 / 51 |
| `route-tool` | GPT-6.1 Sol | 3.1995 | 0.0800 | 0.0889 | 46.9 | model gbrain events 8 / 109 |

## 4. Provider recall: three lines

**Only the member-text line delivers the told fact.** Seeded `cn-01` trial, keyless, at gbrain `a590ad07` and QM `b6786d67`. The count is told facts from turn 1 delivered by the turn-2 recall.

| Line | What gbrain gets | Opus 5.5 | GPT-6.1 Sol | Receipts |
|---|---|---|---|---|
| As shipped | QM's whole question (2,017 and 3,038 chars) | **0** | **0** | Opus: [gates/gate4-seeded-qm-core-trial.json](gates/gate4-seeded-qm-core-trial.json); Sol: [gates/gate13-sol-smoke.json](gates/gate13-sol-smoke.json) |
| Trim only | the `Current message:` part, cut to 2,000 chars | **0** | **0** | [gates/gate4-seeded-qm-core-trial-trimmed.json](gates/gate4-seeded-qm-core-trial-trimmed.json) |
| Member text (the counted cells) | the member's own words (137 and 110 chars) | **1** | **1** | [gates/gate4-seeded-qm-core-trial-member-text.json](gates/gate4-seeded-qm-core-trial-member-text.json); rerun at `e9995eb9`: [gates/gate4-seeded-qm-core-trial-member-text-rerun.json](gates/gate4-seeded-qm-core-trial-member-text-rerun.json) |

**As shipped: refused for length, hidden by `failOpen`.**

- gbrain refuses a recall question over 2,000 characters with `invalid_params` (`gate4-seeded-qm-core-trial.json` `cause.gbrain`: `src/core/facts/question-recall.ts:30` and `:121-123`).
- QM's questions were 2,017 chars on turn 1 and 3,038 on turn 2, and both were refused (`assertions[provider_recall_ok]`: seq 8 and seq 17, `invalid_params`).
- QM builds the question from up to 2,000 chars of history plus up to 2,000 of the message (`cause.qm`). Our adapter posts the whole composed prompt as the message (`cause.rig`).
- `failOpen` hid it. The trial `completed`, the stored turns carry no `### gbrain` block and delivery is empty (`assertions[fact_in_delivery]`: `effect.delivery.facts [[],[]]`, dropped `tool_error`).
- Sol failed the same way: both recalls refused `invalid_params` at 2,017 and 3,038 chars, so nothing was delivered (`gate13-sol-smoke.json` `trials.qm-pi-sol-gbrain-memory-provider-mu-v03-dev.gbrain_events` seq 8 and 17; `note_memory_provider`).

**Trim only: accepted, but boilerplate-first ranking finds nothing.**

- Both recalls were cut to 2,000 chars and accepted, and no told fact came back in either cell (`gate4-seeded-qm-core-trial-trimmed.json` `assertions[opus_fact_in_delivery]` and `[sol_fact_in_delivery]`: `effect.delivery.facts [[],[]]`).
- **Why:** gbrain ranks a question on its first 12 distinct content words. With embeddings off it admits a fact only at a term share of 0.34 or more (`finding.gbrain`: `src/core/search/fact-relevance.ts:45-48`, `:66`, `:297`, `:307`).
- All 12 words were our preamble: `you assistant shared workspace bot pemberline systems members talk slack channels direct` (`finding.trimmed_question_terms`).

**Member text: the told fact arrives on turn 2, in both cells.**

- The tap sent the member's own text: 137 chars on turn 1, 110 on turn 2. Turn 2 delivered 1 told fact per model, and it sits in turn 2's stored environment under `### gbrain` (`gate4-seeded-qm-core-trial-member-text.json` `assertions[opus_told_fact_delivered_turn2]`, `[sol_told_fact_delivered_turn2]`, `[opus_fact_in_stored_turn]`, `[sol_fact_in_stored_turn]`).
- Each recall also returns the message being answered, because live ingestion writes it first (`finding.echo`). So turn 2 returns 2 facts and only 1 is a told fact.

**The member-text trim corrects our own preamble as much as it emulates a QM fix.** Real members don't open their messages with our task boilerplate. In this rig, the first 12 words gbrain ranks on are preamble words. **Label:** matches QM as shipped at qm `066319ee` (qm#3005, merged 2026-11-05) or later; the M1 runs used the pinned QM, which predates that merge.

## 5. gbrain v0.60.555.0: tried and not adopted

**At 555, QM's recalls are refused before ranking, and a long question is still refused, not truncated.** C4 stays at gbrain `a590ad07`. Receipt: [gates/gate4-seeded-qm-core-trial-gbrain-555.json](gates/gate4-seeded-qm-core-trial-gbrain-555.json) (gbrain `a3f46d35`, 0.60.555.0).

- **Refused `actor_not_attested`** on every provider recall, both models, with the member-text trim and without (`runs[variant=qm_as_wired_no_trim]`, `runs[variant=qm_as_wired_member_text_trim]`). Told facts on turn 2: 0 and 0 in each (`finding.told_fact_counts_turn2`).
  - QM names the member in the `acting_user` argument and sends no `x-qm-actor` header. Since gbrain 0.60.546.0 that argument is refused unless the call carries `x-qm-actor` from an attested client (`finding.summary`).
- **Provider preflight: 4 of 10 checks fail,** all on refused recalls ([gates/gate4-provider-preflight-gbrain-555.json](gates/gate4-provider-preflight-gbrain-555.json)). At `a590ad07` the same preflight passes 10 of 10 ([gates/gate4-provider-preflight-rerun.json](gates/gate4-provider-preflight-rerun.json)).
- **A long question is refused, not truncated.** With `acting_user` removed in a scratch probe, the 2,017- and 3,038-char questions are refused `invalid_params` (`finding.long_question_at_555`). **This corrects what we were told upstream** (relayed in the Captain's K1, 2026-11-04): that 555 truncates the long question.
- **With `acting_user` removed, ranking behaves as at `a590ad07`.** Trim only: 0 and 0. Member text: Dock 38 is delivered on turn 2 in both cells. The receipt's count field reads `[2, 2]` (`probe_no_actor_member_text`) because it counts the echo too; on section 4's rule it is 1 and 1.
- **Passing at 555** needs an attest grant and member links in the world plus the header from QM, or the tap dropping `acting_user` (`finding.to_pass`). Both change the world, not a pin.

## 6. Gate-4 write paths (M2b recipe, the Captain's O)

**These receipts are on an unmerged branch:** `harn31/qm-m2b-prereg` at `32e2baa0`, cited by commit. Pins: QM `037018e2` with its attested recipe, gbrain 0.60.555.0. Each trial makes 2 provider recalls. They are an exposure limit, not evidence about memory: every path that puts the told fact in gbrain also puts it in QM's notebook, or gbrain's recall can't read it.

| Write path | Opus 5.5 | GPT-6.1 Sol | Receipt (at `32e2baa0`) |
|---|---|---|---|
| World member-source ingestion (live, into `private-<member>`) | 0 of 2 | 0 of 2 | [gate4-seeded-memory-provider-cn01.json](https://github.com/garrytan/harness-evals/blob/32e2baa0303b1a3a60861ba24e2fdc9a6465eec2/docs/benchmarks/2026-11-04-qm-m2b/gates/gate4-seeded-memory-provider-cn01.json) `variants.asshipped`, attested cells |
| Explicit `memory` `add` by the model on turn 1 | 1 of 2 | 1 of 2 | same file, `variants.seeded` (`explicit_writes` 1) |
| Automatic capture, as shipped | never fired | never fired | M2b `PREREGISTRATION.md`, gate 5 |
| Automatic capture, CAPY-1's QA settings | 1 of 2 | 1 of 2 | [gate4-capture-cn01.json](https://github.com/garrytan/harness-evals/blob/32e2baa0303b1a3a60861ba24e2fdc9a6465eec2/docs/benchmarks/2026-11-04-qm-m2b/gates/gate4-capture-cn01.json) `variants.capture`, attested cells |

- **Member-source ingestion, 0 of 2: the recipe client reads only gbrain's default source.** Live ingestion writes Dana's DM into `private-dana-okafor` (`gate4-seeded-memory-provider-cn01.json` `reading`).
- **With CAPY-1's QA settings, 1 of 2, but the notebook holds it too.** The `none` cells' question turn shows the told fact from the notebook on both models (`gate4-capture-cn01.json` `variants.capture`, `notebook.question_turn_shows_notebook_fact` true).
- **The trim changes none of these rows:** ingestion 0 of 2 (`variants.trim`), explicit add 1 of 2 (`variants.seeded-trim`), capture 1 of 2 (`variants.capture-trim`).

## 7. Sol arms (R54) and housekeeping

**The earlier Sol gap was our compose wiring, not QM. #176 fixed it, and the counted Sol shard ran clean.**

- #176 (merge `8ecc5864`) adds `harnesses/qm/compose.openai.yaml`, which the runner merges for an `openai:` cell. Gate 13 passed keyless ([gates/gate13-sol-smoke.json](gates/gate13-sol-smoke.json), rerun [gates/gate13-sol-smoke-rerun.json](gates/gate13-sol-smoke-rerun.json)).
- **Counted smokes:** both passed before their shards started. The Sol smoke's agent requests named `gpt-6.1-sol` (13) and its housekeeping `gpt-5.6-luna` (3), the model gate 13 recorded ([results/smoke-checks.json](results/smoke-checks.json)).
- **Housekeeping, labelled "harness housekeeping, shipped default":** metered, never an arm, never scored. Opus cells used `claude-haiku-5-5`, Sol cells `gpt-5.6-luna`, 85 requests per cell (about 2 per trial; the gate 13 receipt saw 1 per 2-turn trial).

## 8. S1: does QM open gstack skills through gstack's paste-in router?

**Sol opens the matching skill; Opus mostly doesn't; neither model reaches a skill's first step.** 15 DM turns per arm and model. Full report: [../2026-11-03-qm-s1-gstack-probe/report.md](../2026-11-03-qm-s1-gstack-probe/report.md).

- **Matched opens with the router:** Opus 2/15 [0, 40], Sol 11/15 [33, 100]. With no gstack: 0/15 on both, and 0 contaminated turns.
- **Starts:** Sol tried the skill's own gstack command in 10/15 [33, 93]; Opus in 0. First-step commands: 0 of 9 eligible turns on both.
- **Task progress, router minus no-gstack (descriptive):** Opus +17 points [0, 50], Sol -25 [-75, 0].
- **Router cost per turn:** Opus +$0.019 [$0.006, $0.033], Sol +$0.026 [$0.016, $0.036].
- **Verdict:** FIX-METHOD on both models: the paste-in router reaches opens on Sol and never a first step on either. The S1 report names the fix.

## 9. Shard VM teardown and the `qm-stack.ts` sandbox leftovers (E1)

**The leftover risk never fired in this lane, and every VM was destroyed.** The C4 shard logs record no leftover count before VM destroy. S1's driver records one per invocation, and only its last invocation's record survived.

- **The risk:** a sandbox-create call that loses its response gives `harnesses/qm/gstack/qm-stack.ts` no machine id, so teardown skips that sandbox and leaves its container, `qm-home-*` volume and `qm-net-*` network (#176 outside-voice#2; accepted as a named risk by HARN-1, 2026-11-03).
- **C4 shards don't use `qm-stack.ts`.** The runner's `harnesses/qm/capture.sh` lists sandboxes by docker label after each trial and removes each container, volume and network. In all 240 trials it found none: every `logs/qm-sandboxes.json` is `[]` and every `logs/capture.log` says "no sandbox container was created". The C4 tasks never start a sandbox.
- **S1 does use `qm-stack.ts`, and every create answered.** All 60 turns record `sandbox.create_http` 201 with a `machine_id` ([S1 turns.jsonl](../2026-11-03-qm-s1-gstack-probe/results/turns.jsonl)), so the skip path was never taken.
- **S1's leftover check:** the driver diffs every docker container, volume and network name before and after an invocation. The last invocation (request 5, 12 turns) left none ([S1 summary.json](../2026-11-03-qm-s1-gstack-probe/results/summary.json) `leftover`). The earlier four invocations rewrote the same file, so their checks are lost. Gate 6's dry run of all 60 turns plus the injected fault, on a fresh VM at `f5491d7d`, left nothing (`nothing_left_behind` true in [gate6-prelaunch-f5491d7d.json](../2026-11-03-qm-s1-gstack-probe/results/gate6-prelaunch-f5491d7d.json)).
- **VMs destroyed on every exit:** both C4 shard VMs (`results/qm-opus.shard-vm.json` and `results/qm-sol.shard-vm.json`, `destroyed_at`) and both S1 VMs (S1 `results/vms.jsonl`, `down` events). `ubi-runner.sh list --mine` was empty after both shards ([results/RUNLOG.md](results/RUNLOG.md)).
- **No follow-up issue was filed:** VM destroy removes any leftover, and the skip path was never taken. The gap is in our record, not in QM: the S1 driver should keep each invocation's leftover check instead of overwriting it.

## 10. Why null?

### `memory-provider`

1. **Exposure: yes, in the counted cells; no, as shipped.**
   - As shipped, every provider recall is refused and `failOpen` hides it (section 4).
   - With the member-text trim, all 55 DM turns per model had a recall with delivered text and 0 failed. The needed fact reached the model in 20 of 20 continuity trials on both models (mechanism, section 1). The model made 0 gbrain calls of its own (section 3).
2. **Fit: half the tasks can't use it, and the other half don't need it.**
   - QM runs the provider only in DMs. The 4 corrections tasks have no DM turn, so the provider never ran there: corrections pass equals `none` on both models, 5/20.
   - On the 4 continuity tasks, QM's notebook already held the answer in 20 of 20 `none` trials per model (section 3).
3. **Power and saturation: saturated.** `none` passes continuity 20/20 [100, 100] on both models. Pass MDE at 8 clusters is about 35 points.
   - The negative point estimates are the unscoped exposure, not lost recall: set aside the provider-only cross-scope failures (7 on Opus, 5 on Sol) and `memory-provider` is 25/40 on both, equal to `none`.
4. **Model:** Opus 5.5 and GPT-6.1 Sol, the same picture on each. Housekeeping models are not scored.

**Separately from the verdict, two defects for CAPY-1 and GBRA-108:** as shipped at the M1 pin, QM's recall question exceeds gbrain's 2,000-character limit (fixed at qm `066319ee`, qm#3005, merged 2026-11-05, after the M1 runs) and the refusal is hidden, and the unscoped provider reads other members' DM facts into a member's turn.

**Verdict (`memory-provider`, resting on Opus 5.5 and GPT-6.1 Sol): FIX-METHOD.** The null rests on saturation (R61). Ceiling-raise: rerun on told-fact tasks where QM's notebook does not already hold the answer at the consumer turn, after a cheap `none`-only headroom check that must score clearly below 20/20.

### `route-tool`

1. **Exposure: yes.** The model called gbrain in 35 of 40 Opus trials (2.58 calls per trial [1.55, 3.63]) and 24 of 40 Sol trials (0.82 [0.30, 1.45]). Mechanism: Opus 28/40, Sol 20/40.
2. **Fit: the corrections tasks fit; the continuity tasks are already solved by the notebook.** Corrections is where `none` has headroom (5/20).
3. **Power and saturation: half saturated, half underpowered.**
   - Continuity: `none` 20/20 on both models, so `route-tool` can only tie (it did, 20/20).
   - Corrections: Sol +55 points [10, 100], Opus +15 [-10, 35], with 4 clusters (smallest exact p 0.125).
   - Overall pass: Opus +7.5 [-5, 20], Sol +27.5 [0, 63], Holm p 1.0 and 0.5.
4. **Model: both frontier arms, with different behavior.** Opus wrote to gbrain (67 `remember` calls, 44 refused `invalid_params`) and its consumer turns carried no notebook block. Sol only searched (29 searches) and kept QM's notebook (20/20 on continuity).

**Verdict (`route-tool`, resting on Opus 5.5 and GPT-6.1 Sol): FIX-METHOD.** The null rests on saturation of the continuity family (R61). Ceiling-raise: score `route-tool` against `none` on corrections-style tasks at 8 or more task clusters, after a cheap `none`-only headroom check that must score clearly below the top.

## 11. The provider and OAuth miscount gate

**Every gbrain-use number in this report comes from a caller-split source.**

1. **Sources:** `mechanism.ts --provider-aware`, `analysis/c4-analysis.ts` (reads `caller` on every tap event), and summarize-run's gbrain table, which counts the model's calls apart from QM's provider client since #254 (`dcbf03e0`). No other counter is cited.
2. **Reconciliation per cell:** section 3. In both `memory-provider` cells `caller: model` is 0.
3. **Keyless check at the report's commit:** [results/miscount-check/run.sh](results/miscount-check/run.sh) ran one Opus `memory-provider` trial (`cn-01` r1) through summarize-run and `mechanism.ts --provider-aware` at `0b1f3cd6`, this commit's parent; this commit changes no counter. Both show 0 model gbrain calls and 2 provider recalls ([results/miscount-check/check.txt](results/miscount-check/check.txt)).
4. **The fix:** #254 (`dcbf03e0`) split `gbrainSummary`, `gbrainUsage` and summarize-run by caller. `TODOS.md`'s "Split the other gbrain counters by caller" item stays open for `recall-audit.ts`, `taxonomy.ts`, `memory-fix-mechanism.ts`, `instruction-followed.ts`, `semanticCheck` and `tool-discipline/normalize.ts`. This report uses none of them.

## 12. Trial accounting and deviations

**240 planned, 240 counted.** Every trial terminated `completed`. 0 excluded, 0 invalid by the prereg's five fixture faults, 0 cap stops, 0 approval stops, 0 consent violations ([c4-analysis.json](results/analysis/c4-analysis.json) `terminations`, [summary.json](results/summary.json)).

**Deviations, all disclosed here:**

- **Controller restart.** About 20:30Z the controller machine restarted and both fan-out processes died. The VM runners kept running from `f5491d7d`. At 20:36:03Z both shards reattached with `run-shard.sh --attach` from `/workspace/c4-run` at `f5491d7d` (qm-opus at 90 trials, qm-sol at 65). Both runner processes loaded `f5491d7d` ([results/RUNLOG.md](results/RUNLOG.md); `shard.json` and `shard-vm.json` `commit`).
- **Analysis ran at main `0b1f3cd6`, not `f5491d7d`.** Between them, of the scripts used, only `scripts/merge-shards.ts` and `runner/proxy/metering-proxy.ts` changed (#184). `mechanism.ts`, `summarize-run.ts`, `compare-run.ts`, `runner/stats` and `runner/grade` did not. The merge kept 240 trials, and the proxy usage sums match the ledgers.
- **compare-run needed `--families`.** `--pair gbrain` alone stopped with "no eligible pairs"; with `--families continuity,corrections` it ran. It pairs only `route-tool` with `none`, so the preregistered tests come from `analysis/c4-analysis.ts` (`clusteredPairedDelta`, Holm over 3).
- **`route-tool` tap events carry no `caller` field** (section 3). They are counted as the model's.
- **Scripts written after the run:** `analysis/c4-analysis.ts` (the preregistered endpoints), `analysis/extract-qm-user-rows.py` (QM's stored `UserMessage` rows), `analysis/binding-check.py`, and `analysis/notebook-exposure.py` (descriptive, not preregistered).
- **Storage:** each trial's `snapshot.json` is committed gzipped. `trial.json` stays out: it holds the per-trial bearer.
- **The preregistered deviation stands:** the tap's member-text trim (the Captain's G1 and J1), labelled on every `memory-provider` figure.

## 13. Spend

**$23.76 of the $56 counted cap; $29.14 for C4 and S1 with smokes and VMs.** From the meter (`metering-proxy summary --budget-ledger`).

| Item | Model | Lease | Spend | Requests | Receipt |
|---|---|---:|---:|---:|---|
| C4 counted | Opus 5.5 | $32 | $15.1556 | 1,162 | [results/qm-opus.ledger-summary.txt](results/qm-opus.ledger-summary.txt) |
| C4 counted | GPT-6.1 Sol | $24 | $8.6080 | 1,318 | [results/qm-sol.ledger-summary.txt](results/qm-sol.ledger-summary.txt) |
| C4 smoke | Opus 5.5 | $6 | $0.3276 | 17 | [results/qm-opus.smoke.ledger-summary.txt](results/qm-opus.smoke.ledger-summary.txt) |
| C4 smoke | GPT-6.1 Sol | $3 | $0.0883 | 16 | [results/qm-sol.smoke.ledger-summary.txt](results/qm-sol.smoke.ledger-summary.txt) |
| S1 | both | $20 | $2.7329 | 327 | [S1 meter-summary.txt](../2026-11-03-qm-s1-gstack-probe/results/meter-summary.txt) |

- **Per model, C4 counted:** Opus $15.16 (expected $18.16), Sol $8.61 (expected $9.08). No overshoot, no refused request.
- **Housekeeping, harness housekeeping, shipped default, inside the figures above:** Opus cells `claude-haiku-5-5` $0.0167 over 255 requests; Sol cells `gpt-5.6-luna` $0.0768 over 255 requests (`c4-analysis.json` `secondary.*.housekeeping_usd`).
- **VMs at list price:** qm-opus 103 minutes, $0.8631; qm-sol 99 minutes, $0.8296 (`shard-vm.json` `cost`). S1: 64 minutes, $0.5363 ([S1 analysis/s1-spend.json](../2026-11-03-qm-s1-gstack-probe/results/analysis/s1-spend.json)).
- **Totals:** model $26.91 (C4 $24.18 with smokes, S1 $2.73), VMs $2.23, lane `qm-measure` (cap $65).

## 14. Pins and commit binding

- **Run commit:** `f5491d7d02f34dad833abeab54d02141a0ee5a64` (#258). Freeze base `dcbf03e0` (#254). Between them: #257 (export v2; under the run's paths only `harnesses/qm/gstack/README.md`, one line) and #260 (test-only tap baseline), as the run log lists.
- **QM** `b6786d67` (`harnesses/qm/pin.json`); **gbrain** `a590ad07`, 0.60.522.0 (`gbrain/pin.json`); embeddings off.
- **Binding assertions pass** ([results/analysis/binding-check.json](results/analysis/binding-check.json)): each shard's `shard.json` and `shard-vm.json` name `f5491d7d`, `scratch_prereg` is false, both manifests' `prereg_sha256` equals `prereg.json`'s (`f4238897...`), `gbrain_commit` is `a590ad07`, and `shard.json` records an image id for `harness-eval/qm-sandbox:dev`.
- **VMs:** `ubirun-harn38-1793819991-fab903da-t6` (qm-opus) and `ubirun-harn38-1793821312-c232ec28-t6` (qm-sol), standard-16, `UBI_OWNER=HARN-38`, `UBI_TTL_HOURS=6`.

## 15. What to use and what to avoid

- **Use QM's own notebook for told facts in DMs.** On these tasks it already answers every continuity question on both models.
- **Avoid QM's gbrain provider as shipped at `b6786d67`.** It delivers nothing, silently. With a member-text question it delivers, but unscoped it also leaks other members' DM facts into a turn.
- **`route-tool` is the route to keep measuring for corrections,** with Sol showing the larger, still descriptive, gain. On Opus, watch the `remember` refusals.

## 16. Reproduce and inspect

From the repository root, keyless, on these results:

```
R=docs/benchmarks/2026-11-03-qm-c4-told-live/results
env -i HOME="$HOME" PATH="$PATH" TERM=xterm bun scripts/summarize-run.ts --results $R
env -i HOME="$HOME" PATH="$PATH" TERM=xterm bun scripts/compare-run.ts --results $R --pair gbrain --families continuity,corrections
env -i HOME="$HOME" PATH="$PATH" TERM=xterm bun scripts/v03/mechanism.ts --results $R --tasks tasks/multiuser/v0.3/dev --provider-aware --out $R/mechanism
env -i HOME="$HOME" PATH="$PATH" TERM=xterm bun $R/analysis/c4-analysis.ts --results $R --tasks tasks/multiuser/v0.3/dev
python3 $R/analysis/notebook-exposure.py $R tasks/multiuser/v0.3/dev
python3 $R/analysis/binding-check.py $R docs/benchmarks/2026-11-03-qm-c4-told-live/prereg.json
env -i HOME="$HOME" PATH="$PATH" TERM=xterm bash $R/miscount-check/run.sh
```

- **Files:** [results/](results/): merged `trials.jsonl`, `manifest.json`, `shards.json`; per shard the ledger, smoke ledger, proxy log and usage, preflight, plan, run-shard, run and lane logs, `shard.json` and `shard-vm.json`; [mechanism/](results/mechanism/mechanism.md); [summary.md](results/summary.md); [smoke-checks.json](results/smoke-checks.json); per trial the events, turns, snapshot, usage, reconcile and grade files, core's log and QM's stored `UserMessage` rows.
- **Not committed:** `trial.json` (per-trial bearer), harness state, workspaces, the sidecar's token files and the preflight directories.
- **Observed time:** qm-opus 1 h 31 min of trials, qm-sol 1 h 28 min, in parallel.

## Disclosures

gbrain is Garry Tan's own project.

gstack is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
