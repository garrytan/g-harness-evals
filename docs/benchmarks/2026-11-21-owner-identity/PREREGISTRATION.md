# Owner identity: can a harness plus gbrain tell which speaker is the brain's owner?

This preregisters the counted run of the owner-identity category (GST-3217, plan HARN-116 v3). It is frozen before the first counted trial. Results come in a later pull request.

- **The question:** when a harness imports someone's chats, mail, meetings and agent sessions, or sits in a group chat, how often does a fact that is someone else's get filed as the owner's (false-owner), and how often do the owner's own facts land on the owner (owner recall)? Two primary numbers, never combined.
- **Harnesses and models:** Claude Code on Claude Opus 5.5; Codex CLI on GPT-6.2 Sol; OpenClaw and Hermes on both, plus particle-1 as the low-cost model; QM on both (its memory-provider route to gbrain; cross-harness cells, labelled).
- **Arms:** N, a plain notes store with no gbrain; G, gbrain as shipped with an owner card in the harness's instructions; B, gbrain with no owner card; P, gbrain's own importer with no harness; C, gbrain's session capture on sessions the harness launches itself.
- **Tasks:** a sealed bank of 48 synthetic tasks (owner-identity-b1): 38 imports, 4 live group chats, 6 session-capture tasks. 3 tries per cell and task. No real people.
- **gbrain:** v0.60.782.0, `11f618fedee18596d6a99495303a2386cd75a8ee`, the release pinned by this amendment (Amendment 1, 2026-11-28; the plan froze at v0.60.778.0, `783bcde6`).
- **No model judge.** Every score is where a planted word landed in the store, read by a script.
- **Two stages and one look** at half the tasks, with stop bounds fixed here.

## Eval loop

- Size: counted run
- Paid budget: $1167
- Model judge: none

## What the result changes

Each line names who acts and what they do, for each way the result can come out.

- **A hard case at 10% false-owner or more** (pooled over a model's G cells, or in P, with the interval's lower bound above 5%): gbrain's maintainers (GBRA-108) get it as a named defect with the synthetic fixtures that reproduce it, ranked by rate. No hard case over the line: they get the per-case table and no defect.
- **Any arm above 1% false-owner, pooled:** flagged against GBRA-665's own 1% bar, with the cases that cause it. At or under 1% in every arm: reported as meeting the bar.
- **B worse than G by more than its detectable difference:** GBRA-108 gets "gbrain's owner identity does not reach the agent": gbrain setup should write the owner card into each harness's instructions or serve it through a tool. No difference: the card is reported as not needed for this.
- **Family C banks a worker's brief as the owner's facts:** GBRA-108 gets a session-speaker defect with the exact launch shape (env set or detected). None banked: session capture is reported as telling the two apart, per harness.
- **Which harness to use for chat imports**, within each model only: a harness is recommended only if its G-arm false-owner on imports beats every other harness of that model (Holm within the model) and its owner recall is within 10 points of the best. Otherwise the page says no harness is distinguishably better and lists the pairs.
- **Harness or gbrain owns speaker identity** (P with Opus extraction against the Opus G cells on imports, non-inferiority margin 8 points): P no worse on both primaries: "import through gbrain's importers; harnesses call them". G clearly better: gbrain should hand attribution to the agent (owner card plus raw turns). Neither: both stay, and the per-source table says which wins where.
- **Does gbrain help here** (G against N per harness): G worse on false-owner goes to GBRA-108 as worse than plain notes, with one "Why null?" pass (R48). G better: kept. A null: the R48 cycle and a KEEP, FIX-METHOD or CUT-CANDIDATE verdict.
- **Ceiling:** every N and G cell at or under 2% false-owner and at or over 95% owner recall means one honest attempt to raise the ceiling with harder tasks (R61) before any verdict.

The after-fix wave on bank 2 (owner-identity-b2), when GBRA-665's fix ships, gets its own dated amendment with its own decision lines. Nothing here runs on bank 2.

## Approval

- **Garry, 2026-11-19:** "do it", on plan v3 (HARN-116, its second autoplan run, dksbyg), about $2,890 for the program with a runaway cap of $3,200.
- **Dated plan changes before freeze:** 2026-11-20, Sol cells move to GPT-6.2 Sol and gbrain to its newest release (R54, R100); 2026-11-20, owner surfaces follow gbrain's owner-entity rule (GBRA-665); 2026-11-21, QM re-pinned to its main `7689355c` with exact private-network origins (HARN-1's decision A on the pilot report); 2026-11-21, QM serve turns go to core as a member's message (`origin: human` with the message's ts), as QM's Slack surface sends them, instead of core's default `direct`; 2026-11-27, gbrain moves to its newest release, v0.60.778.0 (`783bcde6`), and QM to main's pin `77024e79` (from #529), before freeze (R100); 2026-11-27, three runner fixes from the build's review, before any counted trial: the merge refuses a third shard of a half a cell already has, the matrix and compare scripts read both shards of a cell run in two halves, and an adapter that runs again after a mid-trial restart does not add the owner card a second time; 2026-11-27, the task counts per family corrected to what the generator's 42-task profile makes (38 imports and 4 live tasks, not 30 and 12; the dev bank holds 17 tasks, not 12), so row P is 228 task tries at about $44 and stage 1 runs 19 imports and 2 live tasks; the 42 units, the 3,564 cell trials and every comparison stay as they were. 2026-11-27, the starter surface pin moves from 33 to 35 tools, the count gbrain v0.60.778.0's image lists (the pilot top-up's preflight refused the old pin before any trial). 2026-11-27, a pricing top-up of the pilot (Pilot) and the Cost projection section; the shard leases and the infra reserve are resized from the new pilot prices by the plan's own lease rule. 2026-11-27, from the /ship review, before any counted trial: the two capture cells get a shard each (their networks cannot share a runner), every launch after stage 1 is gated against the $1,650 cap, shards run `--stop-on-cap` and `merge-shards.ts --partial` accepts a multi-cell shard's unstarted suffix, the merge checks the two halves' task lists, and `analyze.ts` keeps family C out of every pooled figure and reports unknown-format tasks as their own stratum, left out of P against G, as this plan already said. The plan's History section holds each one.
- **HARN-1, 2026-11-21, on the pilot report:** HARN-123 is the bank's custodian and runs the counted cells; Sol's refusal to run a script asked for in Slack counts as a result (R95); Codex family C is scored on owner and orchestrator sessions only; family C is reported per harness, never pooled, with session counts; every counted lease is sized for the harness's peak parallel calls times the per-call reservation, plus expected spend.

## Arms

Every arm gets the same synthetic world, the same tasks and the same preamble (`tasks/multiuser/_shared/preamble.owner-identity.md`, which carries no sender fields). The mechanics are in [docs/owner-identity.md](../../owner-identity.md).

- **N, no gbrain (R44 analogue):** a notes store through world-MCP (`notes_list`, `notes_read`, `notes_write`), one file per person, seeded with the same people pages the gbrain arms import. Owner card in the harness's instructions.
- **G, gbrain as shipped:** gbrain at the pin above, starter surface, installed by gbrain's own installer view for Claude Code, Codex, OpenClaw and Hermes, and through its memory-provider MCP route for QM. Owner registered (`access.owner_member` and an owner people page with every handle). gbrain's own extraction on, at its shipped default model, metered through the proxy and labelled "gbrain internal model, shipped default". Owner card in the harness's instructions.
- **B, gbrain only:** as G with no owner card. The pilot showed no installer wrote one either (`owner_card.ok` on every B trial).
- **P, gbrain alone:** no harness. Each import task goes through gbrain's importers and `extract-conversation-facts` with the owner registered, once on the shipped default model and once with extraction pinned to Opus 5.5 (`scripts/owner-identity/row-p.ts`). A file in a format gbrain has no importer for goes through generic capture and extraction; the tasks that hold one are reported as their own stratum and left out of P against G.
- **C, session capture:** Claude Code and Codex in the G setup on the 6 capture tasks: 2 owner sessions, 1 orchestrator session that runs a launcher, and 4 headless workers of the same harness launched as its children (2 with `GBRAIN_SESSION_AGENT` set, 2 left to gbrain's detection).
- **Extraction model:** the shipped default resolves to `anthropic:claude-haiku-5-5` on our proxy route (`resolveFactsExtractionModel`), and every G, B and P cell names it. A trial whose recorded extractor differs is refused.
- **No gstack anywhere.** gstack is not under test. Every shard runs `--clean-arm-preflight` on a Ubicloud VM with no Capy drive.

### The owner card, and the sender on live turns

| Harness | Where the card goes (N, G) | Sender on a live turn |
|---|---|---|
| Claude Code | `$CLAUDE_CONFIG_DIR/CLAUDE.md` | none in the prompt; visible only by reading channel or DM history through world-MCP |
| Codex | `$CODEX_HOME/AGENTS.md` | the same |
| OpenClaw | `/workspace/AGENTS.md` | the same |
| Hermes | `$HERMES_HOME/memories/USER.md` | the same |
| QM | the org SOUL, QM's system-prompt setting | `actor.externalId`, the sender's Slack user id and display name on every turn (QM's own channel path; recorded as `sender_signal`) |

The adapters use the sender's member id only to key the harness session (one session per DM or channel). The trial record's `owner_card` says whether the card's lines were in the first agent-loop request.

## Task bank and custody

- **Sealed bank owner-identity-b1:** 48 tasks from the public generator (`world/owner-identity/generate.ts`) with a secret 256-bit seed, sealed with its own world by HARN-123 on 2026-11-21 at `cdc591d00ef1623cded3fdf2aadeefb638ab2c4e`. Procedural custody. Commitments in `tasks/multiuser/owner-identity-b1/heldout/MANIFEST.json` (bundle `44e88549d5d0499158c8cb25febd6bc17f2a6441a32bc7079ab5b178bb8a4634`, tree `513b15e038af0b274f1be0b6bd1048f1c1c85c253138bb35c9852e0bf9b07e91`). Nobody but the custodian has seen it, and the seed and plaintext were deleted.
- **Bank 2, owner-identity-b2,** is sealed the same way (bundle `d09f27d4901d`..., manifest in this pull request) and stays sealed for the after-fix wave, so GBRA-665's fix is never graded on fixtures it was built from.
- **Openings:** each bank's ledger allows 1 confirmatory opening at alpha 0.05. This run is bank 1's one confirmatory opening (`heldout.label: confirmatory`). The opened bank is published in the results pull request as gbrain fixtures and counts only as development evidence for the fix afterwards.
- **What the bank holds:** every hard case in at least 6 of the 42 import and live tasks; every recorder-label line carries a clear cue (HARN-1's decision, so both counts, clear only and all, are the same number and both are reported); imports in 5 sources of 6 formats each (agent sessions and ChatGPT exports, 1:1 chats, group chats, meetings, iMessage, email), plus one format per source gbrain does not parse, as its own stratum.
- **The candidate** (`heldout.candidate_sha256`) is the sha256 of `candidate.json` in this folder: the gbrain commit, the extraction model, the preamble's sha256, the owner-card route and each harness pin's sha256.

## Measures

The grader is `runner/grade/owner-identity.ts` at this commit; [docs/owner-identity.md](../../owner-identity.md) defines every surface.

- **False-owner (primary):** planted facts whose claimant is not the owner that sit on an owner surface on a line that does not name the claimant, over all such facts.
- **Owner recall (primary):** facts the owner stated first-hand that sit on an owner surface, over all of them.
- **Secondary:** owner precision; owner facts on another person's page; facts on the wrong non-owner page; kept but marked speaker unknown; token anywhere in the store; `attributed_to` agreement in G, B and P; the answer check on the last reply; recorder-label hits on clear cues and on all.
- **Owner surfaces:** gbrain fact rows and compiled-truth or timeline lines of the owner's page, the owner's member page, `memory/owner` and any person page whose frontmatter email names an owner email; in N, the owner's notes file. Raw conversation, meeting and session pages are never owner surfaces.
- **Owner recall near 100%:** above 95% the task-clustered bootstrap can give a narrow or zero-width interval when few tasks miss, and there is no Wilson interval on that side (false-owner below 5% gets one). So each recall above 95% is shown with its misses out of facts and, beside the bootstrap interval, the Wilson interval on the miss rate at the effective n that `comparisons.owner-identity.json` records for that rate, turned back into recall. A rate of 100% is written "no miss in n facts" with that interval. Claims use the paired tests, never these per-cell intervals.
- **A plain-words source on the owner's page:** a fact someone else claimed that sits on an owner surface is not false-owner when its line names the claimant. An agent or a press source has no person page, so for those claimants the line also counts as naming them when it holds one of these whole words, in any case: agent, brief, task prompt, AI, assistant, model or bot for an agent; press, report, reporter, article, alert or news for the press (the dated change of 2026-11-19). The word can be anywhere on the line, even used for something else, so this rule can only lower false-owner on agent and press facts. The results give, per cell, how many agent and press facts sat on an owner surface and how many of those were excused this way (each verdict's correctly-reported flag), which is the most the rule can move the number.
- **Fact sources:** every fact row's `facts.source` (hook, sweep, model write, import) is recorded. The harness recommendation counts all sources, with a sensitivity line that drops hook and sweep rows, which only Claude Code and Codex produce.

## Cells

Cells are `<harness>-<model>-<arm>`: harness `cc` Claude Code, `codex`, `oc` OpenClaw, `he` Hermes, `qm` QM; model `opus`, `sol`, `part` (particle-1). Every cell is `split: heldout`, `task_set: owner-identity-b1`, 3 repetitions, planning ceilings of 60,000 input and 6,000 output tokens a turn. The N, G and B cells run families I and L (42 tasks, 126 trials each); the two `-gc` cells run family C (6 tasks, 18 trials each). particle-1 runs N and G only. Codex and particle-1 cells use `network: internal`. prereg.json is the exact list: 30 cells, 3,564 trials, plus row P (38 import tasks, 3 tries, 2 extraction models, 228 task tries).

## Sample sizes and what they can detect (stated in advance)

Detectable differences are at 80% power and two-sided alpha 0.05, recomputed from the pilot.

- **Owner recall** carries most of the variance. In the pilot, paired task differences in recall (G minus N, 24 task pairs, one try) had a standard deviation of 0.33, and almost all of it is the binomial noise of about 2 owner facts per task and try. Three tries cut that part by 3; a between-task variance of 0.01 is assumed on top. This assumes the bank has the dev bank's mix, since both come from the same generator.
  - G against N, or B against G, within one harness (42 tasks, Holm over a model's harnesses): **11 points**.
  - Pooled within a model: **6 points**.
  - P against the pooled Opus G cells on imports (38 tasks, one-sided non-inferiority): margin **8 points**.
- **False-owner** sits near zero (pilot 1 in 394 planted non-owner facts). Each cell sees about 4.25 non-owner facts per task and try, about 535 per cell. With a design effect of 2 assumed for clustered hits, a harness-level G against N difference is detectable from about **3.5 points** above a 0.25% baseline, a pooled one from about **1.2 points**, and harness against harness on imports (about 485 facts a cell, Holm over a model's pairs) from about **4 points** (worked out for 380 facts and kept, so it errs large).
- **The config** (`heldout.owner_identity.sdd`) records one number per comparison kind, the recall figure for kinds that compare both primaries (g_vs_n and b_vs_g 0.11 per harness and 0.06 pooled, p_vs_g 0.08) and the false-owner figure for harness_vs_harness (0.04), which compares false-owner only.
- **Chance the P line is informative:** high, and mostly one way. In the reproduction check gbrain alone filed 6 of 22 owner facts on the owner and put 5 to 7 of 45 non-owner facts there, against about 85 to 90% recall and about 0% false-owner with a harness in front. So "G clearly better" is the likely outcome, and P passing non-inferiority would be a surprise.
- **Rates under 5%** get a Wilson interval on the design-effect effective n; the design effect falls back to the mean planted facts per task when it cannot be estimated (no events), which is the conservative end. The analysis file records the effective n per cell.

## Analysis and exclusions (frozen)

- **One script:** `scripts/owner-identity/analyze.ts` with the config in prereg.json. Inside custody, `scripts/sealed/export.ts` runs it and decides the claims below from `comparisons.owner-identity.json`.
- **Pairing:** each fact is paired by task; its value on a side is its mean over that side's scored trials. Intervals are task-clustered bootstraps, p from the kit's sign-flip test.
- **Holm:** per-harness comparisons within a model; harness pairs within a model. The claims form two Holm families at the set's alpha of 0.05: primary (the pooled G against N, B against G and P against G claims) and secondary (the per-harness ones).
- **Counted trials:** every trial except `model_error`, `infra_error` (including `gbrain_extraction_dropped`) and `exam_fault`, and trials with no verdicts. Excluded trials are listed per cell with the reason. A provider's safety stop is its own outcome, reported per cell (R95).
- **A model's refusal is a result.** Sol declining to run the capture launcher in family C (seen in the pilot) leaves the trial counted: its owner and orchestrator sessions are scored and the 4 workers count as not run. Codex family C is scored on owner and orchestrator sessions only for that reason; a worker that never started leaves the denominator.
- **Family C** is reported per harness and model, never pooled, with the session counts beside each number. The capture cells grade as G (they carry the owner card), so `analyze.ts` leaves them out of every pooled G figure, the hard cases, the arm rates, the comparisons and the stage-1 look.
- **Hard cases** pooled over a model's G cells and in P, with the 10% and 5% lines from the decisions above.
- **Imports in formats gbrain cannot parse** are their own stratum (`unknown_format`) beside every cell's, row P's and arm's rates, and those tasks are left out of P against G. The other claims are on all tasks.

### Preregistered claims

| Id | Family | Claim | Rule |
|---|---|---|---|
| OI-1 | primary | Pooled over the Opus 5.5 harnesses, gbrain with the owner card (G) files fewer non-owner facts as the owner than the notes store (N) (`g_vs_n/false_owner/anthropic:claude-opus-5-5/pooled`) | superiority, decrease |
| OI-2 | primary | Pooled over the Opus 5.5 harnesses, G files more of the owner's own facts on the owner than N (`g_vs_n/owner_recall/anthropic:claude-opus-5-5/pooled`) | superiority, increase |
| OI-3 | primary | Pooled over the Opus 5.5 harnesses, gbrain without the owner card (B) files more non-owner facts as the owner than G (`b_vs_g/false_owner/anthropic:claude-opus-5-5/pooled`) | superiority, increase |
| OI-4 | primary | Pooled over the Opus 5.5 harnesses, B files fewer of the owner's own facts on the owner than G (`b_vs_g/owner_recall/anthropic:claude-opus-5-5/pooled`) | superiority, decrease |
| OI-5 | primary | Pooled over the GPT-6.2 Sol harnesses, gbrain with the owner card (G) files fewer non-owner facts as the owner than the notes store (N) (`g_vs_n/false_owner/openai:gpt-6.2-sol/pooled`) | superiority, decrease |
| OI-6 | primary | Pooled over the GPT-6.2 Sol harnesses, G files more of the owner's own facts on the owner than N (`g_vs_n/owner_recall/openai:gpt-6.2-sol/pooled`) | superiority, increase |
| OI-7 | primary | Pooled over the GPT-6.2 Sol harnesses, gbrain without the owner card (B) files more non-owner facts as the owner than G (`b_vs_g/false_owner/openai:gpt-6.2-sol/pooled`) | superiority, increase |
| OI-8 | primary | Pooled over the GPT-6.2 Sol harnesses, B files fewer of the owner's own facts on the owner than G (`b_vs_g/owner_recall/openai:gpt-6.2-sol/pooled`) | superiority, decrease |
| OI-9 | primary | On imports, gbrain alone with Opus extraction (P) is no worse than the Opus G cells on false-owner, within 8 points (`p_vs_g/false_owner/anthropic:claude-opus-5-5/pooled/I`) | non-inferiority, margin 8 points |
| OI-10 | primary | On imports, P is no worse than the Opus G cells on owner recall, within 8 points (`p_vs_g/owner_recall/anthropic:claude-opus-5-5/pooled/I`) | non-inferiority, margin 8 points |
| OI-11 | secondary | On Claude Code with Opus 5.5, G files fewer non-owner facts as the owner than N (`g_vs_n/false_owner/anthropic:claude-opus-5-5/claude-code`) | superiority, decrease |
| OI-12 | secondary | On Claude Code with Opus 5.5, G files more of the owner's own facts on the owner than N (`g_vs_n/owner_recall/anthropic:claude-opus-5-5/claude-code`) | superiority, increase |
| OI-13 | secondary | On Codex with GPT-6.2 Sol, G files fewer non-owner facts as the owner than N (`g_vs_n/false_owner/openai:gpt-6.2-sol/codex`) | superiority, decrease |
| OI-14 | secondary | On Codex with GPT-6.2 Sol, G files more of the owner's own facts on the owner than N (`g_vs_n/owner_recall/openai:gpt-6.2-sol/codex`) | superiority, increase |
| OI-15 | secondary | On OpenClaw with Opus 5.5, G files fewer non-owner facts as the owner than N (`g_vs_n/false_owner/anthropic:claude-opus-5-5/openclaw`) | superiority, decrease |
| OI-16 | secondary | On OpenClaw with Opus 5.5, G files more of the owner's own facts on the owner than N (`g_vs_n/owner_recall/anthropic:claude-opus-5-5/openclaw`) | superiority, increase |
| OI-17 | secondary | On OpenClaw with GPT-6.2 Sol, G files fewer non-owner facts as the owner than N (`g_vs_n/false_owner/openai:gpt-6.2-sol/openclaw`) | superiority, decrease |
| OI-18 | secondary | On OpenClaw with GPT-6.2 Sol, G files more of the owner's own facts on the owner than N (`g_vs_n/owner_recall/openai:gpt-6.2-sol/openclaw`) | superiority, increase |
| OI-19 | secondary | On Hermes with Opus 5.5, G files fewer non-owner facts as the owner than N (`g_vs_n/false_owner/anthropic:claude-opus-5-5/hermes`) | superiority, decrease |
| OI-20 | secondary | On Hermes with Opus 5.5, G files more of the owner's own facts on the owner than N (`g_vs_n/owner_recall/anthropic:claude-opus-5-5/hermes`) | superiority, increase |
| OI-21 | secondary | On Hermes with GPT-6.2 Sol, G files fewer non-owner facts as the owner than N (`g_vs_n/false_owner/openai:gpt-6.2-sol/hermes`) | superiority, decrease |
| OI-22 | secondary | On Hermes with GPT-6.2 Sol, G files more of the owner's own facts on the owner than N (`g_vs_n/owner_recall/openai:gpt-6.2-sol/hermes`) | superiority, increase |
| OI-23 | secondary | On QM with Opus 5.5, G files fewer non-owner facts as the owner than N (`g_vs_n/false_owner/anthropic:claude-opus-5-5/qm`) | superiority, decrease |
| OI-24 | secondary | On QM with Opus 5.5, G files more of the owner's own facts on the owner than N (`g_vs_n/owner_recall/anthropic:claude-opus-5-5/qm`) | superiority, increase |
| OI-25 | secondary | On QM with GPT-6.2 Sol, G files fewer non-owner facts as the owner than N (`g_vs_n/false_owner/openai:gpt-6.2-sol/qm`) | superiority, decrease |
| OI-26 | secondary | On QM with GPT-6.2 Sol, G files more of the owner's own facts on the owner than N (`g_vs_n/owner_recall/openai:gpt-6.2-sol/qm`) | superiority, increase |
| OI-27 | secondary | On OpenClaw with particle-1, G files fewer non-owner facts as the owner than N (`g_vs_n/false_owner/particle:particle-1/openclaw`) | superiority, decrease |
| OI-28 | secondary | On OpenClaw with particle-1, G files more of the owner's own facts on the owner than N (`g_vs_n/owner_recall/particle:particle-1/openclaw`) | superiority, increase |
| OI-29 | secondary | On Hermes with particle-1, G files fewer non-owner facts as the owner than N (`g_vs_n/false_owner/particle:particle-1/hermes`) | superiority, decrease |
| OI-30 | secondary | On Hermes with particle-1, G files more of the owner's own facts on the owner than N (`g_vs_n/owner_recall/particle:particle-1/hermes`) | superiority, increase |

Every other number is descriptive, labelled as such, and makes no claim.

## Pilot

The R111 pilot ran on 2026-11-21 on the 17-task dev bank (4 tasks, 1 try per cell; 2 capture tasks for C), uncounted, at `b38ff88461` with gbrain `9b91f99a` (C rerun at `fcbe4c3e21`; QM re-piloted at `cdc591d00e` after its re-pin, and its live task rechecked at `54f922ff76` with the shipped Haiku housekeeping model allowed; after QM serve turns moved to `origin: human`, all 6 QM cells were re-piloted at `58256e5b6f` with gbrain `92f5d722`: 24 of 24 trials completed, all 90 turns went as `origin: human` (48 in channels, 42 in DMs) and QM answered every one `ok`).

| Arm | Arm budget | Pilot cap |
|---|---:|---:|
| N | $295 | $29.50 |
| G | $395 | $39.50 |
| B | $385 | $38.50 |
| C | $40 | $4.00 |
| P | $44 | $3.50 |

- **Part under test ran:** in every N cell the agent wrote the notes store; in every G and B cell gbrain took writes and the drain found fact rows with 0 dropped extraction jobs, and the recorded extraction model was Haiku 5.5 wherever extraction ran (on QM Opus the model wrote facts itself and gbrain made no extraction call in the pilot, while QM Sol's G and B cells show the extraction route working under QM); the owner card was in the first agent-loop request on every N and G trial and absent on every B trial (`owner_card.ok` on all trials); family C banked the owner and orchestrator sessions with the expected speaker decisions on both harnesses (Claude Code 7 of 7 sessions; Codex 3 of 3, its 4 workers not started because Sol declined to run the launcher, which counts as a result); row P imported and extracted on gbrain v0.60.755.0 (2 dev tasks, every step exit 0). Pilot spend: N $9.31, G $13.81, B $11.96, C $2.11, P $0.27.
- **Tasks can be supplied:** every cell planned, started and graded its 4 tasks (120 trials, 0 exam faults); the token-anywhere rate was reported per cell in the pilot record; the 48-task bank sealed and its custodian's plan step reads it (`runner/run.ts plan --sealed-root`).
- **Grader audit:** 40 verdicts per arm checked by hand against the gold list (reviewer GPT-6.2 Sol): N 39 of 40, G 40 of 40, B 40 of 40, C 32 of 32; on the QM re-pilot, N 40 of 40, G 40 of 40, B 40 of 40. The one N disagreement (a press outlet named in plain words) was fixed in the grader before freeze (`00681440f6`).
- **No model judge,** so R111's judge part and R78 do not apply.
- **Pricing top-up (2026-11-27):** so plan-cost could price every cell from at least 5 scored trials, a top-up ran uncounted on the dev bank at `2b873f9257` with gbrain `783bcde6` (run `owner-identity-pilot2-2026-11`): the Claude Code and Codex N, G and B cells on 6 tasks (oi-01, 02, 03 and 06 imports, oi-12 and 13 live), the OpenClaw, Hermes, QM and particle-1 cells on 2 (oi-02-import, oi-13-live), and the capture cells on oi-16 and oi-17 three times each. 92 trials, all completed and graded, with `owner_card.ok` on every one; $37.33 paid. Its first launch stopped at preflight before any trial, on the starter surface pin below.

## Interim look

- Look at: 21 of 42 units
- Stop bounds: stop for no headroom when every N and G cell is at or under 2% false-owner and at or over 95% owner recall (then R61, harder tasks, before any verdict); stop and fix when exam faults pass 10% of any cell's trials (that cell is fixed under a dated amendment and rerun from the start of stage 1 under a new run id). No stop for an early win or loss: the per-harness and per-case tables are the deliverable. No other look.

The units are the 42 import and live tasks. Stage 1 runs half of every family: within each family, the bank's task ids sorted, the 1st, 3rd, 5th and so on (`runner/run.ts run --task-half 1`), so 19 imports, 2 live tasks and 3 capture tasks, the same tasks in every cell. Hard cases split about evenly but not exactly; the results pull request lists the per-case counts of each half. Stage 2 runs the rest (`--task-half 2`) from the same commit after the look. The custodian runs the analysis on stage 1 inside custody and reports only the two stop flags, the cells that set them and the trial counts; no rate leaves custody before the opening is published.

## Cells, shards and leases

**Sharding.** Ubicloud through `scripts/ubicloud/fanout.sh`, one standard-16 VM per shard, one shard per harness and model (its N, G and B cells) plus one for each capture cell, so no cell is split across machines within a stage. The two capture cells cannot share a shard: cc-opus-gc runs on the default bridge and codex-sol-gc on the internal network, and one runner invocation refuses that mix (HE-NET-001). Each stage is its own fan-out from this preregistration's merge commit with its own dest, and stage 2's shards are named after stage 1's with `-h2` added (cc-opus-h2 and so on), since the final merge takes both stages' shards by the names their `shard.json` records; stage 1 and stage 2 of a cell run from the same commit, and each VM builds its images from it (image ids recorded in `shard.json`, compared across stages in the results). Trials run one at a time inside a shard, each shard under its own metering lease inside the run cap. HARN-123 runs the fan-outs, with its own thread code as `UBI_OWNER`. Options: `--no-smoke` (the sealed lane's one-trial smoke rewrites cells to public dev cells, which these sealed cells cannot be), so the canary shard stands in for it. Shard args: `--task-half <1|2>` and `--clean-arm-preflight`. `run-shard.sh` runs the runner with `--stop-on-cap`, so a shard whose lease is spent records the refused trial and stops, and a resume must repeat the shard's own `--task-half`.

**Leases.** Each shard's lease per stage is 1.3 times its expected stage spend plus its peak parallel model calls times the per-call reservation (the proxy reserves input plus 128,000 output tokens before forwarding: about $2.83 a call on Opus 5.5, $1.40 on GPT-6.2 Sol, $0.30 on particle-1, $0.70 on Haiku 5.5). Peak parallel calls: Claude Code 3, Codex 2, OpenClaw 2, Hermes 2, QM 3, plus 2 Haiku extraction calls in gbrain cells; each capture shard 5 calls of its model (the pilot's capture cell lost a trial when 5 concurrent Opus calls met a smaller lease). Expected spend per trial is the pilot's per-cell mean, from the pilot and its top-up as plan-cost prices them (the receipt below). The lease total counts both stages and comes to more than the $1,650 cap, so leases alone do not hold the run to it. Every launch after stage 1 (stage 2, row P, an infra rerun) is gated: its leases, plus the settled spend of every ledger of the run so far, plus every lease still open, must come to $1,650 or less. Stage 2's fan-out manifest carries that remainder as `stage_cap_usd` (`fanout.sh` refuses leases above it before any VM call); if stage 2's leases do not fit, every one of them is cut by the same factor, and a shard that stops on its cut lease merges with `--partial`. Stage 1's manifest carries $843, its own leases. An infra rerun launches into its stage's dest, so that stage's cap counts it.

| Shard | Cells | Trials (both stages) | Expected (both stages) | Reservation | Lease per stage |
|---|---|---:|---:|---:|---:|
| cc-opus (canary) | cc-opus-n, cc-opus-g, cc-opus-b | 378 | $158 | $9.89 | $113 |
| codex-sol | codex-sol-n, codex-sol-g, codex-sol-b | 378 | $59 | $4.20 | $43 |
| oc-opus | oc-opus-n, oc-opus-g, oc-opus-b | 378 | $237 | $7.06 | $161 |
| oc-sol | oc-sol-n, oc-sol-g, oc-sol-b | 378 | $127 | $4.20 | $87 |
| he-opus | he-opus-n, he-opus-g, he-opus-b | 378 | $176 | $7.06 | $121 |
| he-sol | he-sol-n, he-sol-g, he-sol-b | 378 | $261 | $4.20 | $174 |
| qm-opus | qm-opus-n, qm-opus-g, qm-opus-b | 378 | $74 | $9.89 | $58 |
| qm-sol | qm-sol-n, qm-sol-g, qm-sol-b | 378 | $47 | $5.60 | $36 |
| oc-part | oc-part-n, oc-part-g | 252 | $11 | $2.00 | $9 |
| he-part | he-part-n, he-part-g | 252 | $15 | $2.00 | $12 |
| gc-cc | cc-opus-gc | 18 | $5 | $15.55 | $19 |
| gc-codex | codex-sol-gc | 18 | $2 | $8.40 | $10 |
| row P | 38 import tasks, 3 tries, shipped and Opus extraction | 228 task tries | $44 | n/a | $60 (once) |
| **Total** | 30 cells | 3,564 | $1,217 | | $1,746 |

- **Run cap:** $1,650 paid across both stages, row P and infra reruns; the program's runaway cap stays $3,200 all in.
- **Reserve for infra reruns:** about 6% of expected cell spend ($70). An `infra_error` trial is rerun once, in a new shard at the same commit; a second infra failure is reported excluded.
- **Launch order, each stage:** cc-opus first as the canary; the rest only after it has finished at least one scored trial and copied its results off the VM.
- **Concurrency** changes only calendar time, since trials are sequential inside a shard. HARN-123 is approved for 32 vCPU (two VMs at once); a stage of 12 shards takes about 55 hours that way. More VMs at once, inside the crew's 208 vCPU and the project's 464, need HARN-1's agreement and change nothing else.
- **Time per shard:** about 189 trials a stage at 2 to 5 minutes each (pilot wall times), so 7 to 15 hours; `UBI_TTL_HOURS=24`.
- **Results leave each VM during the run,** the VM-to-shard map is kept beside them, every VM is destroyed on exit, and `ubi-runner.sh list --mine` is empty at the end.
- **gbrain build:** every VM builds the sidecar at the preregistration's `gbrain_commit`. If gbrain's main branch has a newer release when stage 1 launches, a dated amendment moves the pin before the first counted trial (R100); once counted trials start, the build is frozen for both stages.

## Cost projection

- Spend stop: $1,650 (the run cap: both stages, row P and infra reruns)
- Pilot-priced projection: $1,316.08
- Projection receipt: plan-cost-receipt.json

- **What the total holds:** $1,173 for the 3,564 cell trials at each cell's pilot mean, $57 of VM time still to come, and $85.60 already spent that the receipt counts (the pilot ledgers given to plan-cost, $79.92, and the pilot VMs, $5.67). Row P is not a cell, so plan-cost leaves it out: the cells, row P's $44 and the $70 reserve come to $1,287 paid.
- **Leases against the stop:** the $1,650 stop is unchanged. The leases add up to $1,746, more than the stop, and that is fine only because `stage_cap_usd` makes every launch after stage 1 (stage 2, row P, an infra rerun) fit under $1,650 with everything already spent and every lease still open. Stage 1's own leases are $843, so stage 1 alone cannot reach the stop.
- **The upper end:** at each cell's 95% upper price the cells come to $1,636, which with row P passes the stop. Each shard's lease stops it (`--stop-on-cap` ends the shard at its first refused call), the launch gate above keeps stage 2 inside what stage 1 left, and a stage whose shards stop on their leases still merges (`merge-shards.ts --partial` takes each shard's unstarted trials, across all its cells, as one suffix of its order), so a dear run ends short rather than over. Each cell's unstarted count is reported.
- **Pilot prices:** every cell is priced from at least 5 scored pilot trials (he-sol-b from 5 of 6; its sixth, in the first pilot, was a `model_error`). The dearest cells are he-sol-b ($1.05 a trial), oc-opus-b ($0.68) and he-sol-g ($0.62).


## Known deviations

- **Harness housekeeping models:** Claude Code's adapter pins `ANTHROPIC_SMALL_FAST_MODEL` to the cell model (the crew's standing exception). QM's housekeeping stays at its shipped defaults: Sonnet 5.5 and Haiku 5.5 beside Opus cells, GPT-5.6 Luna beside Sol cells, each listed in the cell's `utility_models`. Metered, labelled "harness housekeeping", never scored.
- **gbrain's extraction model** is gbrain's shipped default (Haiku 5.5), metered under the trial's lease; it is part of the system under test, not a judge.
- **QM's own provider writes** (QM cells only) are scored apart from the model's writes using the tap's bearer split.

## What this does not test

Garry's real data or Wintermute; speaker identification from audio; Pi, Cursor, dsh or Harness Zero; a model-judged answer score; GBRA-665's fix (the after-fix wave, on bank 2, by amendment).

## Amendment 1 (2026-11-28): gbrain v0.60.782.0

Committed before any counted trial. gbrain released four versions after this plan froze at v0.60.778.0, so under R100 the run moves to the newest release on gbrain's main branch at this commit: v0.60.782.0, `11f618fedee18596d6a99495303a2386cd75a8ee` (the gbrain line above, `gbrain_commit` in prereg.json and candidate.json). The starter surface the runner states stays at 35 tools: the runner's preflight counts 35 at both `783bcde6` and `11f618fe`. Nothing else in the plan changes.

What the releases since `783bcde6` changed (gbrain's own release notes, `783bcde6..11f618fe`):

- **v0.60.779.0:** Claude Code's default setup (`--surface starter --advertise verbs`) now lists `correct` beside the memory verbs and `request_tools` (GST-4058). This is the only change to the tools gbrain registers. It applies to the `--advertise verbs` listing; these cells serve the whole starter surface, which already lists `correct` at `783bcde6`. Also a shadow-mode fix.
- **v0.60.780.0:** `gbrain setup --serves several` and `gbrain access serves several` label people on the brain and source the harness reads, and the OpenClaw owner-sender guard says it is in force only once the gateway runs it (GST-4043, GST-4004). Also: backlinks answer the same for unreadable and missing pages; atom extraction fixes (GST-3743, GST-4020); Gmail backfill, CJK search and page-history fixes (GST-4026, GST-4037); shadow-mode, upgrade and shared-skill fixes.
- **v0.60.781.0:** a speaker-owner marker on an imported transcript is trusted only while the page's live text is still the importer's own, so maintenance or a tag change can't make a remote writer's text read as imported (GST-4056, `src/core/identity/speaker-owner.ts`, migration v343). OpenClaw owner turns are classed from the verified sender when the host sends no memory audience and an owner sender is configured (GST-4059). Also: Gmail and Google contacts import fixes, including non-Latin contact names, and two shared-skill fixes.
- **v0.60.782.0:** two shadow-mode write-comparison fixes.

**Does any of it touch owner identity, the owner card, session start or tool registration?** Yes, three of the four:
- **Owner identity:** GST-4056 changes when gbrain trusts a transcript's speaker-owner marker. Row P and the import tasks go through gbrain's transcripts importer, so this code runs.
- **Owner identity:** GST-4059 changes how OpenClaw owner turns are classed. It applies only when an owner sender is configured, and this plan's adapters configure none.
- **Owner identity:** GST-4043 changes where `access serves several` labels people. The sidecar runs that command.
- **Tool registration:** GST-4058 changes the `--advertise verbs` listing, which these cells do not use.
- **The owner card and session start:** nothing in these releases changes the owner card route (the adapters write it) or session start.

**Keyless check at the new pin:** `bun scripts/gbrain-check.ts --gbrain 11f618fe` passed 36 of 36 assertions on image `sha256:049f52d1d4ea`, the same as at `783bcde6`. Its own probe lists 36 starter tools at both builds, verbs 7. The scoped check covers 15 members, with 0 rows outside a grant. The OpenClaw and Hermes installer views were built.

**Uncounted code-path check (2026-11-28, HARN-1's decision B):** on the dev bank only, never bank 1 or bank 2, the same scratch run went once at `11f618fe` and once at `783bcde6`. It covered row P over the 11 dev import tasks, 1 try each, plus one cc-opus-g trial and one oc-opus-g trial on oi-02-import and oi-13-live. Paid: $2.23 at `11f618fe` and $2.26 at `783bcde6`. The code paths matched; scores were not compared:
- **Speaker-owner marker:** row P's two Claude Code session imports (oi-09) went through `gbrain transcripts ingest` with the same `ingested_via`, `trust_tier` and `source_kind`. Neither build put a `speaker_owner` marker on them, so GST-4056's trust check has nothing to decide on these pages.
- **People labels:** the same 17 people pages at both builds. No G cell runs `access serves several`.
- **Starter tools:** Claude Code saw the same 35 gbrain tools at both builds, `correct` included. The runner's preflight stated 35 at both.
- **OpenClaw owner sender:** no owner-sender configuration and no owner-sender path at either build. OpenClaw saw the same gbrain tools at both builds.
- **The rest:** `owner_card.ok` on all 8 trials, gbrain drains with 0 dropped jobs, and Haiku 5.5 as the extraction model.
