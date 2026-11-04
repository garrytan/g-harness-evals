# S1 probe: does QM open gstack skills through gstack's paste-in router, on Opus 5.5 and GPT-6.1 Sol?

Status: **frozen** (2026-11-04, America/Los_Angeles), on main after #254 (`dcbf03e025d6eecb00ab27c4e09ddf01600bf7cd`), before any turn. Every freeze gate below is closed except gate 6, which is decided and whose one-VM pre-launch check runs at the merge commit before the first turn. Written 2026-11-03 (America/Los_Angeles) by HARN-31 on the qm train (#176, now at head `3e0a606f57784d7ff02f6cafe868425a46da6865`), before any trial. Updated the same day with the driver author's corrections (driver `harn31/s1-probe-driver` at `65f51056`) and a GPT-6.1 Sol arm (Captain, F1), then aligned with the driver on `harn31/qm-wave2` at `f9969445` (arms × models design, turn ids, Sol reservation). Run id `qm-s1-gstack-probe-2026-11`, the S1 probe of CAPY-1's QM plan v3 (GST-358). No paid trial runs on this document alone.

**This file freezes only after every gate under "Freeze gates" is closed on main.** On 2026-11-03 six are open: gates 1, 2, 3, 5, 6 and 9. The cap is settled at $20 (Captain, F1, 2026-11-03).

**Dated note, 2026-11-03 (Captain, C1):** if the probe driver (gate 3) is not ready by 2026-11-05, S1 arrives as a dated addendum to the M1 report instead of inside it. The M1 report to CAPY-1 does not wait for S1.

**In one line: put gstack's paste-in router in QM's org instructions and gstack's skill files in QM's sandbox, ask five ordinary requests that match gstack skills, and count how often QM opens the matching skill and starts it, beside the same requests with no gstack at all, on Opus 5.5 and on GPT-6.1 Sol.**

- **2 arms × 2 models:** `gstack-router` and `no-gstack` (R44), each on `anthropic:claude-opus-5-5` and on `openai:gpt-6.1-sol`. Same QM, requests, fixture repository and sandbox within a model; the only difference between arms is gstack.
- **5 requests × 3 repetitions per arm and model**, 60 DM turns, each a new DM thread on a fresh QM stack.
- **No Haiku, Sonnet or Particle arm.** QM's own housekeeping request stays at its shipped default for each provider, labelled "harness housekeeping, shipped default".
- **Cap $20**, one lease, lane `qm-measure` (Captain, F1, 2026-11-03). Expected spend about $11.03; conservative $16.65, plus one $2.98 reservation, $19.63.
- **If the Sol wiring fails its keyless smoke (gate 9), S1 runs Opus only** and declares it as a gap in our QM wiring.
- **Pins:** QM `b6786d675f83d9a818c5d5335cc017ffea9ec7a7`; gstack `21277291c850765052ea9f80f6be4ccf1f1eb191` (1.91.345.0), the commit the keyless staging receipt read. No gbrain.
- **Machine-readable design:** [design.json](design.json). It is not a runnable `prereg.json`: the runner cannot set QM's org instructions, stage a sandbox image per arm or count skill reads from QM's stored sessions, so the probe runs through its own driver, `harnesses/qm/gstack/s1-probe.ts`, on main since #254 merged as `dcbf03e0` (gate 3).
- **Dev, invented requests.** The five requests are invented and labelled so. Results describe QM at this pin with this router, nothing more.

## Why this run

- **Raw gstack does not import into QM.** QM's skill-pack import refuses gstack at its 32 MiB byte cap: gstack at `21277291c` is 4,413 files and 74.9 MiB ([smoke receipt](../../../harnesses/qm/gstack/receipts/smoke-b6786d67.json), [README](../../../harnesses/qm/gstack/README.md)).
- **So plan v3 decision 5 probes first with gstack's paste-in router** (`gstack-harness register generic --print`), and builds a QM edition only if members open skills. Garry's d3b approved that order. If the probe shows no opens, gstack-on-QM stops there.
- **The fixture already works keylessly.** `harnesses/qm/gstack/s1-stage.ts` put the router in QM's org SOUL, staged 63 `SKILL.md` files in the sandbox, and a scripted model read `careful/SKILL.md` back byte for byte ([staging receipt](../../../harnesses/qm/gstack/receipts/s1-staging-b6786d67.json)). Nobody has asked a real model yet.
- **The result goes to GSTA-36 (gstack) and CAPY-1 (QM)** as per-harness specifics: which skills opened, which were cut by QM's inline cap, and what the router costs per request.

## Approval

- **The plan.** CAPY-1's QM plan v3, M1, the S1 probe (Captain's drive `handoffs/HARN-15/qm-m1/plan-v3.md`, line 61; decision 5). Garry approved gate rev 2 with "do it" on 2026-10-30 (d3b).
- **The Captain, 2026-10-31.** S1 on Opus 5.5, lane `qm-measure` (CREW.md, "Frontier models first"; "Frontier only, no Haiku or Sonnet under test"), cap $5 at first.
- **The Captain, C1, 2026-11-03.** Cap $15, and the no-gstack arm stays. If the driver is not ready by 2026-11-05, S1 arrives as a dated addendum to the M1 report.
- **The Captain, F1, 2026-11-03.** Add a GPT-6.1 Sol arm: `gstack-router` and `no-gstack` on both Opus 5.5 and Sol, under one lease and a $20 cap. Re-costed from list prices on HARN-21's measured Opus reservation of $2.98, with $3.50 and $4 as sensitivity lines (Spend).
- **Departures from plan v3's S1 text.** The plan names a cheaper model, a $3 cap and no control arm. This design uses Opus 5.5 and GPT-6.1 Sol, a no-gstack arm and the Captain's $20 cap.
- **R44: a no-gstack arm, because the probe compares.** The opens count alone is not a head-to-head, but this design also compares task progress, tokens and cost per turn with and without gstack, so it carries the scored no-gstack arm R44 asks for: same model, same requests, same harness, no gstack installed, plain prompt.
- **R54: both frontier models are tested.** R54 asks every gstack or gbrain eval to test Opus 5.5 and GPT-6.1 Sol, and this run now does. Sol reaches QM core through `harnesses/qm/compose.openai.yaml` (the qm train, `3e0a606f`): core gets `OPENAI_BASE_URL` at the metering proxy's `/openai` route plus `/v1`, the per-trial dummy token as `OPENAI_API_KEY`, `MODEL_PROVIDER=openai` and an empty Anthropic pair; `PI_MODEL` is `gpt-6.1-sol`. QM itself needs no change: at `b6786d67`, `src/model/provider-endpoints.ts` honours `OPENAI_BASE_URL` and `src/model/pi-models.ts:288` defines `gpt-6.1-sol`.
- **Sol fallback, declared now.** If the keyless Sol smoke (gate 9) cannot complete a turn through this wiring, S1 freezes with the Opus turns only and declares an R54 deviation: a gap in our QM wiring for this eval, not a QM defect, reported to CAPY-1 with the smoke's receipt. The same holds if the Sol turns fail on the VM after the freeze: the Opus turns stand, and every verdict says it is an Opus 5.5 verdict.
- **Run path (Captain, F1; updated for the driver on `harn31/qm-wave2`).** A Sol turn loads `compose.openai.yaml` over `compose.yaml` on every path: the S1 driver starts core that way for an `openai:` model, and the shard path (`scripts/run-shard.sh` and `harnesses/run-trial.sh`) merges `compose.<provider>.yaml` the same way (`run-trial.sh`'s OpenAI fix, issue #252, on `harn31/qm-wave2`).

## Question

On QM `b6786d67` through Pi, on Opus 5.5 and, separately, on GPT-6.1 Sol, with gstack `21277291c`'s paste-in router in QM's org instructions and gstack's skill files staged in each member's sandbox:

1. **Opens.** Of 15 DM turns per model (5 requests × 3), in how many does QM open the matching gstack skill? In how many does it open any gstack skill, read it completely, and start it?
2. **Against no gstack (R44).** On the same 15 requests with no gstack anywhere, on the same model, how do task progress, tokens per turn, cost per turn and wall time per turn compare?
3. Descriptively: how the Opus and Sol counts differ. That difference is printed and not tested.

## Arms

| Arm | QM org SOUL | Sandbox image | gstack files reachable |
|---|---|---|---|
| `gstack-router` | the router, `PUT /v1/admin/scopes/org:<org>/soul` | `harness-eval/qm-sandbox:s1-gstack-21277291` (fixture repository included) | the 63 staged `SKILL.md` files under `/root/workspace/gstack/` |
| `no-gstack` | QM's default (192 characters), no router, no gstack text | `harness-eval/qm-sandbox:s1-no-gstack` (same fixture repository) | none |

- **The router** is the output of `gstack-harness register generic --print` from gstack `21277291c` with every path pointed at the staged copies: 12,186 characters ([router receipt](../../../harnesses/qm/gstack/receipts/s1-router-21277291.md)). QM puts the org SOUL at the top of every turn's system prompt as `## Organization instructions`, about 3,000 tokens per request.
- **Both arms' sandbox images** are built from `harnesses/qm/gstack/Dockerfile.skills` on top of `harness-eval/qm-sandbox:dev`, with `STAGE_GSTACK=1` for `gstack-router` and `STAGE_GSTACK=0` for `no-gstack`, which leaves gstack out of every layer. The fixture repository is identical in both.
- **The no-gstack SOUL is QM's own default**, 192 characters, read back before any turn. It holds no router and no gstack text. The arm does not set it.
- **Both arms** create a default sandbox for the member before the turn (`POST /v1/admin/sandboxes/personal:<member>`), so a missing sandbox cannot pass as zero use.
- **Plain prompt in both arms:** the member's request alone, as a DM. Nothing else in the conversation names gstack or a skill.

## Design: arms × models

**Four cells, 15 turns each, 60 turns under one lease and a $20 cap.**

| Cell | Arm | Model | `utility_models` (harness housekeeping, shipped default) | Turns |
|---|---|---|---|---:|
| `opus/gstack-router` | `gstack-router` | `anthropic:claude-opus-5-5` | `anthropic:claude-haiku-5-5` | 15 |
| `opus/no-gstack` | `no-gstack` | `anthropic:claude-opus-5-5` | `anthropic:claude-haiku-5-5` | 15 |
| `sol/gstack-router` | `gstack-router` | `openai:gpt-6.1-sol` | `openai:gpt-5.6-luna` | 15 |
| `sol/no-gstack` | `no-gstack` | `openai:gpt-6.1-sol` | `openai:gpt-5.6-luna` | 15 |

- **Turn ids:** `s1-r<n>-k<n>-<opus|sol>-<arm>`. `r` is the request (1 to 5) and `k` the repetition (1 to 3), for example `s1-r3-k2-sol-no-gstack`. The dry run's injected fault turn, `s1-r3-fault-opus-gstack-router`, is outside the 60.
- **Run order:** request by request and repetition by repetition. Within each, Opus `gstack-router`, Opus `no-gstack`, Sol `gstack-router`, Sol `no-gstack` (`turnPlan` in `s1-probe.ts`). A cap stop leaves whole pairs on both models.
- **Per turn:** the proxy slot allows the cell model and its `utility_models` entry only.

## Requests (invented)

Each request is a new DM thread from one member, on a fresh QM stack (Postgres, core and sandbox started for the turn and torn down after), so no turn sees another turn's memory.

| # | Member request (invented) | Matching skill | Skill characters | Fits QM's inline cap |
|---|---|---|---:|---|
| 1 | "Something in my branch broke the login test since yesterday. Can you find out why before I touch anything?" | `investigate` | 29,581 | no |
| 2 | "Before I merge, can you review the diff on my feature branch for anything risky?" | `review` | 58,767 | no |
| 3 | "I'm about to run a cleanup script on the prod database box. Be extra careful with anything destructive while we work." | `careful` | 4,727 | yes |
| 4 | "Write up release notes for what changed since the last tag." | `document-release` | 16,942 | no |
| 5 | "Save what we learned today about the flaky retry test so you remember it next time." | `learn` | 8,351 | yes |

- **QM's inline cap.** QM inlines at most 16,384 characters of one tool result (`src/sessions/tool-output.ts:10-11` at `b6786d67`) and parks the rest behind an `[output cut: ...]` marker. So three of the five skills cannot be read in one call.
- **The fixture repository** (`/root/workspace/repo` in both arms) has a few commits, a tag, a feature branch with a diff and a failing login test, so requests 1, 2 and 4 have something to work on. `harnesses/qm/gstack/s1-fixture.ts` writes it from fixed objects, so it is the same on every machine: head `9db8fa505db65ccd14f1f18a3ed6cd18da405d00` on branch `feature/session-timeout`, 7 files, tree sha256 `befe52967dcebff9f953ef9254e8ad13ac3232f9a2d9a22ebb7c6253f4c90db1` (the sha256 of sorted `sha256sum` lines over the checked-out files, `FIXTURE_TREE_COMMAND`). The preflight checks both values in both arm images.

## Counting, from each turn's stored session

Read after the turn from `GET /v1/admin/sessions/:id?scope=personal:<member>&limit=50000` (every entry of the turn) and, for the first model request's system prompt, `GET /v1/admin/sessions/:id/llm?scope=personal:<member>&turnSeq=0`, as [the README](../../../harnesses/qm/gstack/README.md) describes:

- **Open:** a `tool_result` entry with `action: read` whose `path` is a staged `/root/workspace/gstack/*/SKILL.md`, or an `execute` call that reads such a path with `cat`, `sed` or `head` and exits 0.
- **Matched open:** the opened skill is the request's skill in the table above.
- **Complete read, inline:** the entry has no `output` field and `bytes` equals the staged file's characters.
- **Complete read, cut:** the entry has `output.shownChars < output.chars`. It is complete when every line of the staged file was delivered: the cut read's shown head and tail plus later reads of the path, of the parked `tool-output/` copy or `execute` pieces (blank lines aside; `completeRead` in `s1-count.ts`).
- **Start, preamble:** after a matched open, an `execute` call that runs the skill's own gstack command: `gstack-skill-start --skill "<skill>"` for `investigate`, `review`, `document-release` and `learn`; the `gstack-paths` line with `"skill":"careful"` for `careful`; `gstack-learnings-search` or `gstack-learnings-log` also count for `learn`. Those commands do not exist in QM's sandbox and fail. The attempt is the marker: the skill says to carry on in degraded mode. The attempt counts even when QM refuses the call's arguments, because the stored call keeps them (`payload.wire.argumentsJson`).
- **Start, first step:** after a matched open, the skill's own first-step command: `git log --oneline -20 --` for `investigate`; `git remote get-url origin`, `gh pr view --json baseRefName` or `git symbolic-ref refs/remotes/origin/HEAD` for `review` and `document-release`. `careful` and `learn` have none.

### Task progress, the same marker in both arms (for the R44 comparison)

| # | Progress marker |
|---|---|
| 1 | an `execute` that runs the fixture's login test or `git log` in `/root/workspace/repo` |
| 2 | an `execute` that runs `git diff` in the fixture repository |
| 3 | none (the request asks for care, not an action) |
| 4 | an `execute` that runs `git log`, `git describe` or `git tag` in the fixture repository |
| 5 | a memory write through QM's memory tool in the turn |

## Endpoints

- **Primary, descriptive (the go or stop rule):** per model, `gstack-router` turns with a matched open, out of 15, with a task-clustered bootstrap 95 percent interval over the 5 requests (10,000 draws, seed 7). The driver writes counts only; the report computes every interval from `turns.jsonl`. Beside it, any open, complete reads (inline and cut apart) and starts (preamble and first step apart), each over 15.
- **The rule, from plan v3 decision 5, applied per model:** **zero opens in 15 turns on both models stops gstack-on-QM through the router** (verdict CUT-CANDIDATE for that route, with the "Why null?" cycle below). Zero on one model only is reported as that model's result, and the verdict names the model. One or more matched opens on either model sends the counts, by model, to GSTA-36 and CAPY-1 for the QM edition decision. Under the Sol fallback the rule reads on Opus alone. A turn's fixture fault never counts as zero use.
- **R44 comparison, descriptive:** per model and request, `gstack-router` minus `no-gstack` in progress-marker turns, tokens per turn (input, cached, output), cost per turn and wall time per turn, paired on request and repetition, with the same intervals. **No test is run:** with 5 clusters the smallest exact two-sided sign-flip p is 2 in 32 (0.0625), so none can reach 0.05. The report prints each difference with its interval and n.
- **In `no-gstack`, opens and starts are 0 by construction.** Any read of a gstack path there is contamination (below), not a result.
- **Secondary:** the router's share of input tokens per request; how many `gstack-router` reads QM cut at 16,384 characters, and whether the model went on to read the rest.

## Clean arms and contamination (CREW.md, "Clean no-gstack and no-brain arms")

- **Where it runs:** Ubicloud only, so no Capy drive is mounted anywhere the run can reach. The VM's bootstrap (`scripts/ubicloud/bootstrap.sh`) installs no gstack.
- **Preflight, per arm, recorded in the receipts before the first turn:**
  - on the VM: no `~/.capy/drive`, no `~/.local/share/gstack`, no `~/.claude/skills`;
  - in the core image and each arm's sandbox image, listed as root with each file's sha256: every `SKILL.md` and every path with `gstack` in its name. **The check is zero gstack files**, where a gstack file is a path with `gstack` as a word in it or a file whose sha256 matches a staged file (`checkImageListing` in `s1-probe.ts`). It is not "no `SKILL.md`", because the core image ships 31 of QM's own skill files, and a plain `*gstack*` name match also catches Perl's `sigstack.ph`. Core and `no-gstack` must have zero. `gstack-router` must have exactly the 63 staged files under `/root/workspace/gstack/`, with their sha256, and nothing else (QM's sandbox ships Claude Code 2.1.210, so `~/.claude/skills` is checked in every image);
  - the fixture's head and tree sha256 in both arm images;
  - `GET` of the org SOUL on one keyless stack per arm: QM's own 192-character default, with no router and no gstack word, in `no-gstack`; the router's 12,186 characters in `gstack-router`.
  A failed preflight stops the run before any paid call.
- **Audit, per arm:** every tool call in every stored session whose path or command names `gstack` or `SKILL.md` is counted. A `no-gstack` turn with one is contaminated: it is reported as contaminated with its trial id, and the arm's comparison figures are given with and without it.

## Invalid turns: fixture faults named now

A turn whose session shows any of these is a fixture fault, not evidence of zero use. It is counted and published, and rerun at most once after a named repair, under the same cap; the rerun is listed beside the fault.

1. a read answered `[no such file` or `[not in the computer's workspace` for a staged path;
2. `this scope has no default sandbox`. The driver's keyless dry run injects this fault once (`--inject-fault`): it unsets the member's default sandbox and then retires it before the DM, and the turn must be named and left out of the counts;
3. in `gstack-router`, the router missing from the first model request's system prompt;
4. the stack does not start, or an image is missing or carries the wrong commit label (HE-RUN-006);
5. the preflight above fails.

`model_error` and `infra_error` turns are excluded with counts. Cap-stop turns are counted separately and never rerun.

## Harness housekeeping, shipped default

QM sends one housekeeping request per turn (the session-title call; `harnesses/qm/README.md:191`) on the auxiliary model of the cell model's provider (`auxiliaryModelFor`, `src/model/pi-models.ts:662-672` at `b6786d67`): `anthropic:claude-haiku-5-5` on Opus turns and, read from source, `openai:gpt-5.6-luna` on Sol turns (the only auxiliary OpenAI entry, `pi-models.ts:237-243`). The proxy allows and meters each, labelled "harness housekeeping, shipped default". Neither is an arm or a scored number. Gate 9 records which model Sol's housekeeping request actually names. If one cannot run, it is pinned to its cell model by a dated amendment and the deviation is declared (CREW.md, "Harness housekeeping models").

## Spend

**Cap $20, lane `qm-measure`, one lease for both models (Captain, F1, 2026-11-03).** The Captain raised it from $15 to take the Sol arm.

- **Prices, from the proxy's table** (`chatPrice` in `runner/ledger/budget-ledger.ts`, read at `3e0a606f`). Opus 5.5: $4 input, $20 output, $0.20 cache read, $5 cache write per million tokens. GPT-6.1 Sol: $2, $10, $0.10 and $2.50, every rate half of Opus's.
- **Per-turn estimate.** QM-Pi runs six to seven agent steps of about 15,000 input tokens on a sandbox turn (`harnesses/qm/README.md:187`). With the router (about 3,000 more tokens per step), a skill read and its first steps, a `gstack-router` turn is about 8 steps; a `no-gstack` turn about 6. With the prefix cached inside a turn: **Opus about $0.30 a `gstack-router` turn and $0.19 a `no-gstack` turn; Sol half that, $0.15 and $0.095.** The conservative figure is 1.5 times. No QM receipt on an OpenAI model exists, so Sol reuses Opus's token mix.
- **Totals.** Opus: expected 15 × $0.30 + 15 × $0.19 = $7.35, conservative $11.10. Sol: expected $3.68, conservative $5.55. **Both: $11.03 expected, $16.65 conservative.**
- **The proxy reserves one call's worst case before it forwards.** Pi states 128,000 output tokens on every call (`scripts/run-shard.sh:12-17`). One lease means one reservation in flight, and Opus's is the largest: 128,000 × $20 per million plus its input. **This plan costs it at HARN-21's measured QM Opus reservation, $2.98** (its range was $2.92 to $2.98; taken from HARN-21's handoff, not from a receipt in this repository). A Sol call reserves about $1.49: $1.28 of output (128,000 tokens at $10 per million) plus about $0.21 of input (the Opus reservation's input share, about $0.42 or 105,000 tokens, at Sol's $2 per million). Opus's $2.98 stays the largest reservation, so the fit below holds.
- **Fit.** $16.65 conservative + $2.98 reservation = **$19.63**, under the $20 cap. The lease holds about $17.02 of spend before the last reservation is refused.
- **Sensitivity.** At a $3.50 reservation the same sum is $20.15; at HARN-21's $4 floor it is $20.65. **If a reservation runs higher than $2.98, the last calls stop at the cap and are recorded as `cap_stop` turns, counted and excluded, never rerun.**
- **Run order keeps pairs whole:** request by request and repetition by repetition, the Opus pair (`gstack-router`, then `no-gstack`) and then the Sol pair (Design). If spend runs past the conservative figure, the run stops with matched pairs, and the unfinished pairs are published as incomplete (HE-BUDGET-001), never rerun.
- **Outside the cap:** keyless dry runs and the keyless Sol smoke ($0); Ubicloud VM time, about $0.75 for each 1.5 hours of standard-16 at the list rate in `scripts/ubicloud/run-shard.sh:161`, about $1.50 for both models.
- **Expected spend for this run id: about $11.03 of model spend, plus about $1.50 of VM.** The ledger notes in the Captain's drive record what the meter says.
- Cap stops record the run incomplete. Nothing is rerun to change a count.

## Freeze gates

Status on 2026-11-03, read on the train at `3e0a606f`.

1. **The qm train #176 merged to main: closed 2026-11-04** (merge commit `8ecc58647152deaf19ef300760fed12933e23a4d`). It carries `harnesses/qm/gstack/` (the smoke, `s1-stage.ts`, `qm-stack.ts`, `Dockerfile.skills` and their receipts).
2. **The R40 fixes on main: closed 2026-11-04, landed with #176 (`8ecc5864`).** Branch `harn15/r40-qm-fixes`, head `7d07b83c8b49c558a7f5a4b6c3e6af71c5f831a6`, is merged into the #176 train (Captain, 2026-11-03; an ancestor of `3e0a606f`), so it lands with #176. Commit `14957f911` (qm-stack teardown adopts only sandboxes it can attribute to its own call) must land before any S1 run (HARN-15's handoff).
3. **The probe driver: closed 2026-11-04, #254 merged as `dcbf03e025d6eecb00ab27c4e09ddf01600bf7cd`** (with a second review round that fixed the driver's resume, evidence and counting rules; gates 5 and 9 reran from main after it). Due 2026-11-05; if it is not ready then, S1 becomes a dated addendum to the M1 report (dated note above). Branch `harn31/qm-wave2`, head `f996944538e48493ba68d0095101fe8d6c35ebb1` (the qm train at `3e0a606f` with `harn31/s1-probe-driver` at `6aa2f9dc` and `harn31/qm-tap-trim` at `82a57d9a` merged in, plus the caller-split gbrain counts): `s1-probe.ts` (images, clean-arm preflight, a fresh stack per turn under one lease), `s1-count.ts` (the counters above), `s1-fixture.ts`, `STAGE_GSTACK` in `Dockerfile.skills`, `qm-stack.ts` taking the proxy's trial token, and `tests/qm-s1-probe.test.ts`. It:
   - builds `harness-eval/qm:dev`, `harness-eval/qm-sandbox:dev` and both arm images from the freeze commit and records their ids (so this run does not depend on #185);
   - stages the fixture repository in both arm images and checks its head and tree sha256;
   - runs each turn on a fresh stack through the metering proxy under one ledger lease, with a per-turn slot and token, allowing the cell model and QM's housekeeping model;
   - runs both models: each turn's slot allows the cell model and its provider's housekeeping model (`MODELS` in `s1-probe.ts`), and a Sol turn starts core with `compose.openai.yaml`; `harnesses/run-trial.sh` merges it too (issue #252);
   - sets the org SOUL in `gstack-router` and leaves QM's default in `no-gstack`, creates and selects the member's default sandbox, sends the request as a new DM, and writes the stored session, usage, reconciliation and counts per turn;
   - runs the clean-arm preflight and audit, and stops before any paid call if the preflight fails;
   - passes a keyless dry run of every turn with the fake model behind the real proxy, plus one injected fault, and tears down only what it created. **On Sol the dry run's router check rests on the recorded first request only:** the Responses fake has no prompt match, so a Sol dry-run turn opens its skill whatever the prompt holds, and only the router in the recorded first request's system prompt shows it reached the model.
   It went through its own pull request and /ship as #254, merged as `dcbf03e025d6eecb00ab27c4e09ddf01600bf7cd`; that commit's driver (round 2) is the one gates 5 and 9 reran on. It is plan v3's approved S1 work, so it needs no new plan.
4. **The cap: closed.** $20 for both models with the no-gstack arm (Captain, F1, 2026-11-03; $15 under C1 before).
5. **Keyless staging rerun from main: closed 2026-11-04.** `s1-stage.ts` (or the driver's dry run) reruns at the freeze commit with the fixture repository present: a complete read of `careful/SKILL.md` in `gstack-router`, and no gstack file reachable in `no-gstack`. Receipts go under this run's `gates/`.
   - **Rerun at harness-evals `e9995eb9` (HARN-38, 2026-11-04, keyless): passes.** The commit is main `8ecc5864` with #254 and this branch merged in. [gates/s1-staging-b6786d67-rerun.json](gates/s1-staging-b6786d67-rerun.json): through the driver's dry run, `careful/SKILL.md` was read inline and complete in `gstack-router` on Opus and on Sol; the core and `no-gstack` images hold no gstack path, and `no-gstack` had 0 opens and 0 audit hits; the fixture tree sha256 is unchanged and every dry-run check passed, the injected fault included.
   - **Rerun from main (HARN-38, 2026-11-04, keyless, harness-evals `f8efe9dc` = main `dcbf03e0` plus this branch): passes.** #254's second review round changed `s1-probe.ts` and `s1-count.ts`, so it reran. [gates/s1-staging-b6786d67-main.json](gates/s1-staging-b6786d67-main.json): `careful/SKILL.md` read inline and complete in `gstack-router` on Opus and on Sol (one open each, not cut); gstack paths per image: core 0, `no-gstack` 0, `gstack-router` 66 (63 `SKILL.md`); `no-gstack` 0 opens and 0 audit hits; the fixture tree sha256 unchanged; all 9 dry-run checks true, the injected fault classified `no-default-sandbox`. The run's own `complete` flag is false because `--only` ran the 4 request-3 (careful) turns at repetition 1; the gate rests on the checks, as the receipt says.
6. **The Ubicloud path for a driver run: decided; the one-VM pre-launch check runs at this file's merge commit before the first turn.** `scripts/ubicloud/fanout.sh` knows the `harness` and `gstack-laneb` workloads only. The probe runs on one VM through `scripts/ubicloud/ubi-runner.sh` (`up`, `ssh`, `pull`, `down`) with `UBI_OWNER=HARN-38` and `UBI_TTL_HOURS=3`, from a worktree pinned at the freeze commit, re-entering the docker group as `scripts/ubicloud/checks.sh:16-19` does, after the pre-launch steps run once on a fresh VM through the same SSH path. Results are pulled off the VM after every turn, so a lost controller loses at most one turn. `ubi-runner.sh list --mine` shows no VM left when the lane ends.
7. **gstack pin: closed.** `21277291c`, the commit of the staging and router receipts. Moving it means rerunning gate 5 at the new commit.
8. **QM pin: closed.** `b6786d67` in `harnesses/qm/pin.json`.
9. **The Sol wiring and Sol's housekeeping model: closed, passed on 2026-11-04.** Keyless, before the freeze: one `gstack-router` and one `no-gstack` Sol turn through the shard path, with the metering proxy's OpenAI upstream pointed at a fake that logs each request's model (`--upstream openai=<fake>`, `tests/fixtures/openai-branch/fake-openai.ts`). It passes when both turns complete, core's agent requests reach the proxy's `/openai` route with the dummy token and name `gpt-6.1-sol`, and the receipt records which model the housekeeping request named. If that is not `gpt-5.6-luna`, the design takes the recorded model before the freeze. If the turns cannot complete, the Sol fallback applies (Approval). Receipt under this run's `gates/`.
   - **Result (HARN-38, keyless, harness-evals `e9995eb9`).** [gates/gate9-sol-smoke.json](gates/gate9-sol-smoke.json): both Sol turns completed; core's agent requests reached the proxy's OpenAI route as `gpt-6.1-sol` with the dummy key only, and the housekeeping request named `gpt-5.6-luna`, so the design stands. **How it ran differs from the text above:** it came from the S1 driver's dry run (the same invocation as gate 5's rerun), not the runner shard path, and the driver's OpenAI fake is `tests/fixtures/fake-responses.ts` (hard-wired at `harnesses/qm/gstack/s1-probe.ts:388`), not `tests/fixtures/openai-branch/fake-openai.ts`. The driver starts core with `compose.openai.yaml` as the runner does, and the counted S1 turns run through this driver, so the check covers the path the run uses.
   - **Rerun from main (HARN-38, 2026-11-04, keyless, harness-evals `f8efe9dc`): passes.** [gates/gate9-sol-smoke-main.json](gates/gate9-sol-smoke-main.json): both Sol turns ended ok; all 4 agent requests went through the proxy's OpenAI route (`/v1/responses`) as `gpt-6.1-sol`; every request that reached the Responses fake carried the dummy key; the housekeeping model is `gpt-5.6-luna`, one request per turn. In both gate 9 receipts each ledger row's per-turn meter key (`trial-token:<turn id>`, a lease label, not a credential) is stored as `metered_on`, as in the C4 receipts; it was written as `key` first, which the pregate secrets scan reads as a credential, and only the field name changed.

## Why null? (for the report)

If the probe shows zero opens, or opens without starts, the report runs one "Why null?" cycle before /ship: exposure (the router in the first request's system prompt, from the captured request), fit (are these five requests ones the skills are meant for), power and saturation (n = 15 per arm and model), and model (Opus 5.5 and GPT-6.1 Sol, each named). It ends with one verdict line, KEEP, FIX-METHOD (name the fix) or CUT-CANDIDATE (name the part), sent to HARN-1.

## Limits

- **Five invented requests, three repetitions, one member, two models, one QM commit, one gstack commit.** The counts describe this router on this QM, not gstack on QM in general.
- **The router is the paste-in route, not a QM edition.** A QM-native edition (`hosts/qm.ts`) is the next step only if this probe shows opens.
- **The rig's sandbox is QM's local backend** (`/root/workspace`). E2B sandboxes use `/home/user/workspace`, so a production router must point there.
- **The skills' gstack commands do not exist in QM's sandbox.** A start is counted when the model tries the skill's command, which then fails.
- **Sol's cost is an estimate from Claude-based figures,** and Sol's housekeeping model differs from Opus's, as each provider's shipped default.

## Receipts

Freeze-gate receipts are not here: the receipts of the freeze gates, committed with this preregistration and before its merge, are under `docs/benchmarks/2026-11-03-qm-s1-gstack-probe/gates/`, outside the register's `results/**` glob, so prereg-order does not read them as results; nothing is added to `gates/` after the freeze. They were first committed under `results/` and moved to `gates/` unchanged before the freeze (HARN-38's /ship of #258), so the `--receipt` paths recorded inside some of them predate the move. That includes the keyless dry runs (gate 5) and gate 9's keyless Sol smoke.

Under `docs/benchmarks/2026-11-03-qm-s1-gstack-probe/results/`: the driver's per-turn records (stored session, usage, counts, wall time), the ledger and proxy log, the preflight and audit per arm, the image ids and the fixture tree sha256, and the VM record. Results and the report come in a later pull request than this preregistration.

## Amendments

None yet. Each amendment is dated and committed before any turn it affects runs.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
