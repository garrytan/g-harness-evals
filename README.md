# harness-evals

**We test whether AI agent harnesses (OpenClaw, Hermes Agent, QM) do real multi-person work better with a knowledge brain (gbrain) beside them, and whether the harnesses differ from each other at all.** Same model, same tasks, same fake company; only the harness changes. Every number here has a saved receipt you can regrade yourself.

**Found so far**

- **The three harnesses can't be told apart on getting the work right.** Swapping the model (Sonnet for Haiku) moved results more than swapping the harness did.
- **QM's Pi engine is the cheapest and fastest**, at about a third of OpenClaw's time and tokens per trial, with a pass rate that can't be told apart from the others.
- **gbrain does nothing unless the harness is told to use it.** Told to read a whole-company brain, harnesses read other people's channels; scoping the brain to the asker stops that.
- **No run yet shows gbrain lifting pass rate on its primary endpoint (the one comparison the run was designed to settle) by an amount the run could detect.** Most gbrain rows are dev, so they hint but don't prove.

**Next:** a fresh held-out task set, so the gbrain effects can be confirmed on tasks nobody tuned against ([TODOS.md](TODOS.md)).
- **The dev pilot read no-go** ([report](docs/benchmarks/2026-10-29-v03-pilot/report.md)): on its 20 public tasks on Haiku, four of six families were informative and the rule needs five. It found and fixed a defect in one family.
- **The held-out set was sealed early.** It was sealed (custody commit `custody commit (private)`) before that verdict was settled.
- **That deviation is approved on one condition** ([deviation-approval.md](docs/benchmarks/2026-10-29-v03-pilot/deviation-approval.md)): the `told` cells of the installer dev run ([preregistration](docs/benchmarks/2026-10-29-v03-installer-dev/PREREGISTRATION.md)) must show five of six families informative.
- **A second dev pilot** puts Claude Code and Codex beside OpenClaw and Hermes Agent on the same tasks, each on its own model ([preregistration](docs/benchmarks/2026-10-30-host-harness-pilot/PREREGISTRATION.md)).

Version: harness-evals v0.0.54. Everything above [Changelog](#changelog) describes the repository now; the changelog at the bottom records how this page changed. The one-page account of the first counted cell is [docs/report-v0.1.md](docs/report-v0.1.md).

## Start here

- [Words we use](#words-we-use), the terms that make the rest readable
- [The harnesses under test](#the-harnesses-under-test) and [the fake company and the tasks](#the-fake-company-and-the-tasks)
- [Current results](#current-results), one line per run, with the full text one click away
- [How the harnesses compare](#how-the-harnesses-compare) and [how gbrain compares](#how-gbrain-compares)
- [Known limits](#known-limits), [Corrections](#corrections), [Where to read next](#where-to-read-next)
- [Try a small experiment](#try-a-small-experiment): the free checks run in a few minutes
- Fine print (interval maths, Holm, receipts, costs): [docs/methods.md](docs/methods.md)

## Words we use

- **Harness:** everything around the model. Tools, prompts, memory, channels, scheduling, permissions. It turns a chat model into an agent. We hold the model fixed and change only this.
- **Trial:** one task, run once, by one harness on one model. A trial **passes** when every required check holds and nothing forbidden happened.
- **Dev tasks and held-out tasks:** dev tasks are public and used to find defects. Held-out tasks were hashed before any counted run, so the record shows which task text each run used; their bodies sat in the repository, so this is custody by digest only ([Known limits](#known-limits)).
- **Confirmatory, dev, pilot:** the first counted opening of a held-out set is **confirmatory**. Any later opening of the same set is **dev**: someone had already seen that set's results, so it hints but does not prove. A **pilot** exists to find defects, not to compare anything.
- **"Can't tell apart" ("not distinguished" in the reports):** the run's preregistered test did not establish a difference at that sample size, so the run cannot say which is better. It is not a tie, and a cell where everyone passes or everyone fails tells you nothing.
- **CI:** in a table, the confidence interval, the range the true number probably sits in. In "keyless checks in CI", the GitHub Actions tests.
- **Cross-scope read:** the bot read a channel or file the asking person cannot see, directly or through gbrain. We count it as a failure.
- **Proxy:** every model call goes through our metering proxy, which counts tokens and dollars at list price. The harness never sees the real API key.

## The harnesses under test

**Three harnesses, two Claude models, one brain on the side.** Exact pins below; every harness ran the same tasks, graders, preamble and model through the same proxy.

| Item | Value |
|---|---|
| OpenClaw | [openclaw/openclaw](https://github.com/openclaw/openclaw) 2026.10.6, installed from npm ([harnesses/openclaw/pin.json](harnesses/openclaw/pin.json)) |
| Hermes Agent | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) v2026.9.24, commit `f97608f` ([harnesses/hermes/pin.json](harnesses/hermes/pin.json)) |
| QM | [yc-software/qm](https://github.com/yc-software/qm) v0.1.15, commit `7417aa2a`, run through its Pi engine in every cell and through its Claude Agent SDK engine in the inner-harness run and the two probe runs ([harnesses/qm/pin.json](harnesses/qm/pin.json)) |
| Claude Code | [anthropics/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code) 2.1.312 from npm, built and tested keyless, no counted run yet ([harnesses/claude-code/pin.json](harnesses/claude-code/pin.json)) |
| Codex | [openai/codex](https://github.com/openai/codex) 0.165.0 from npm, built and tested keyless, no counted run yet. It speaks only OpenAI's Responses API, so it is compared only with OpenClaw and Hermes on the same OpenAI model ([harnesses/codex/pin.json](harnesses/codex/pin.json)) |
| Not run | [name withheld] and [name withheld] are in the plan but expose no headless API; nothing on this page measures them |
| Models | `claude-sonnet-5-5` and `claude-haiku-5-5`, one fixed model per run, every call through the metering proxy under a ledger lease; the harness containers see only the proxy and a per-trial dummy token |
| gbrain, the sidecar in the brain runs | [garrytan/gbrain](https://github.com/garrytan/gbrain), pinned today at `32366ac2` (0.60.498.0, master at the merge of gbrain#7898, which contains gbrain#7489 and gbrain#7744), for runs `v03-installer-dev-2026-10` and `host-harness-pilot-2026-10`; each counted run names the commit it built, from `f241216c` (0.60.413.0) in the gbrain arm to `81692dc6` (0.60.472.0, gbrain#7744's head before it merged) in `gbrain-memory-fix-2026-10b` and the v0.3 dev pilot ([gbrain/pin.json](gbrain/pin.json), fields `commit` and `previous`). gbrain is a knowledge brain served to the harness as a second MCP server, not a harness under test |

- Every harness runs headlessly in `serve` mode. The runner plays each member's messages through a Slack mock on a simulation clock, and the harness answers through one world-MCP server ([docs/adapters.md](docs/adapters.md)).
- One bot token, no per-member access, the same preamble for every harness ([docs/methodology.md](docs/methodology.md), the trial contract). Full text: [docs/methods.md](docs/methods.md#how-every-harness-runs).

## The fake company and the tasks

**A simulated company, real-shaped work, graded from what actually happened.**

- The world is Pemberline, a made-up company built from gbrain-evals' `messy-company-v1` dataset: 18 members, 13 channels, 148 files, 42 mails, calendars and private notes, served per trial by one process that logs every read and write ([world/](world/README.md), [world/seed/MANIFEST.json](world/seed/MANIFEST.json)).
- A task is one or more members talking to the bot in channels and DMs. The grader reads the world's state and event log afterwards, never the bot's own story ([docs/tasks.md](docs/tasks.md)).
- Task set v0.1: 10 public dev tasks and 20 held-out tasks sealed before the counted runs ([tasks/multiuser/README.md](tasks/multiuser/README.md)). Task set v0.2 adds continuity, synthesis, corrections and approval-relay families: 15 dev and 15 held-out tasks at the last counted run ([tasks/multiuser/v0.2/README.md](tasks/multiuser/v0.2/README.md)). Task set v0.3 is generated from a seed: 20 public dev tasks across six families, with a held-out set to be sealed ([tasks/multiuser/v0.3/README.md](tasks/multiuser/v0.3/README.md)).
- Beside pass we count three bad things: consent violations (a finance figure or outside mail that should not have gone out), leaks (a DM fact in someone else's conversation) and cross-scope reads. Full text: [docs/methods.md](docs/methods.md#the-world-and-the-tasks-in-full).

## Current results

**One line per run, grouped by question.** Numbers in the tables are copied from each run's report; the full text of every run, with its receipts link, is in the details block under each table. OC is OpenClaw, He is Hermes. Status: pilot, confirmatory or dev, as defined above.

### v0.1 harness runs

**So what:** the three harnesses can't be told apart on the v0.1 tasks, and swapping the model moved results more than swapping the harness. The pilot was there to find defects; the Haiku run is dev.

| Run | Date | Question | Result | Spend | Status | Report |
|---|---|---|---|---|---|---|
| `m2-pilot-2026-10` | 2026-10-22 to 23 | Find defects before the held-out run | OC 52% · He 52% · QM 32% | $16.69 of $150 | pilot | [report](docs/benchmarks/2026-10-23-m2-pilot/report.md) |
| `m3-heldout-2026-10` | 2026-10-23 | Do harnesses differ, model fixed? | OC 77 · He 73 · QM 71 of 80; can't tell apart | $35.67 of $200 | confirmatory | [report](docs/benchmarks/2026-10-24-m3-heldout/report.md) |
| `m3-sensitivity-haiku-2026-10` | 2026-10-23 | Does a weaker model change it? | OC 64 · He 63 · QM 56 of 80; can't tell apart | $1.84 of $50 | dev | [report](docs/benchmarks/2026-10-24-m3-sensitivity-haiku/report.md) |

<details>
<summary>Details for the v0.1 harness runs</summary>

- `m2-pilot-2026-10`, 3 x 50 (10 dev tasks, Sonnet), dev split (pilot). Pass as recorded: OpenClaw 26 of 50, 52% [26%, 78%]; Hermes 26 of 50, 52% [26%, 76%]; QM 16 of 50, 32% [8%, 58%]. Two exam defects fixed in 0.0.4 and one runner defect fixed in #13 before any QM trial; a pilot, not a comparison. Spend $16.69 of a $150 lease. [results](docs/benchmarks/2026-10-23-m2-pilot/results/)
- `m3-heldout-2026-10`, 3 x 100 (20 held-out tasks, Sonnet), v0.1 held-out, opening 1 (first): confirmatory (custody by digest only). Primary 16 tasks: OpenClaw 77 of 80, Hermes 73 of 80, QM 71 of 80. Pairwise: Hermes minus OpenClaw -5 [-15, +3], QM minus OpenClaw -8 [-21, +3], QM minus Hermes -3 [-6, +0], every Holm p 1.000: can't tell apart, 13 of 16 tasks at ceiling for all three. Median per trial 27 s and $0.06 (QM), 49 s and $0.12 (Hermes), 70 s and $0.16 (OpenClaw). Spend $35.67 of $200. [results](docs/benchmarks/2026-10-24-m3-heldout/results/)
- `m3-sensitivity-haiku-2026-10`, 3 x 100 (same tasks, Haiku), v0.1 held-out, opening 2: dev. Primary: OpenClaw 64 of 80, Hermes 63 of 80, QM 56 of 80; largest pair QM minus OpenClaw -10 [-24, +4], Holm p 0.508: can't tell apart. Sonnet minus Haiku within harness +16 [+6, +29], +13 [+3, +24], +19 [+5, +34] (descriptive): the model moved the result more than the harness. Spend $1.84 of $50. [results](docs/benchmarks/2026-10-24-m3-sensitivity-haiku/results/)

</details>

### gbrain on the v0.1 held-out set

**So what:** gbrain only matters when the harness is told to use it. Told to read a whole-company brain, harnesses read channels the asker cannot see; scoping the brain to the asker stops that. Every row here is dev: hints, not proof.

| Run | Date | Question | Result | Spend | Status | Report |
|---|---|---|---|---|---|---|
| `gbrain-arm-2026-10` | 2026-10-24 to 25 | Does installing gbrain change anything? | gbrain minus none -6 to +8 points; can't tell apart | $80.87 of $350 | dev | [report](docs/benchmarks/2026-10-24-gbrain-arm/report.md) |
| `company-brain-2026-10` | 2026-10-24 to 25 | One company token against the requester's own grant | company-told -45 · -60 · -44; scoped +20 · +5 · -2 | $6.26 of $25 | dev | [report](docs/benchmarks/2026-10-25-company-brain/report.md) |
| `gbrain-ladder-2026-10` | 2026-10-24 to 25 | Which way of installing gbrain changes behaviour? | semantic-told vs told -51 · -48 through cross-scope reads | $10.73 of $40 | dev | [report](docs/benchmarks/2026-10-25-gbrain-ladder/report.md) |
| `gbrain-verbs-2026-10` | 2026-10-25 | Does the verbs surface hold at twice the repetitions? | pass +8.1 · +9.4; can't tell apart | $6.38 of $12 | dev | [report](docs/benchmarks/2026-10-25-gbrain-verbs/report.md) |
| `gbrain-installer-2026-10` | 2026-10-25 | Does the installer file match the hand-written clause? | use -87.3 · -91.3; pass: can't tell apart | $3.36 of $8 | dev | [report](docs/benchmarks/2026-10-25-gbrain-installer/report.md) |
| `gbrain-installer-hook-2026-10` | 2026-10-26 | The revised installer with its per-turn hook | use +6.3 · +10.0 (at ceiling); pass -3.8 · +8.8 | $3.43 of $8 | dev | [report](docs/benchmarks/2026-10-25-gbrain-installer-hook/report.md) |
| `gbrain-scoped-2026-10` | 2026-10-26 | Per-request scoping of the company brain | cross-scope reads -77.5 · -71.3; pass +61.3 · +65.0 | $3.47 of $6 | dev | [report](docs/benchmarks/2026-10-25-gbrain-scoped/report.md) |

<details>
<summary>Details for the gbrain runs on the v0.1 set</summary>

- `gbrain-arm-2026-10`, 15 x 100 (held-out, Haiku and Sonnet, with and without gbrain, plus a told arm on Haiku), v0.1 held-out, opening 3: dev; trials overlapped with `company-brain-2026-10` and `gbrain-ladder-2026-10`. gbrain minus none, 16 tasks: untold cells +3 [-6, +13], +1 [-9, +13], +3 [-4, +9] on Haiku and +8 [+0, +19], -3 [-9, +3], -6 [-14, +0] on Sonnet, where the harness called gbrain in 1, 0, 0 and 1, 0, 0 of 100 trials; told on Haiku +1 [-19, +24], +4 [-16, +25], +3 [-10, +15]. Every Holm p 0.75 or more: can't tell apart. Spend $80.87 of $350. [results](docs/benchmarks/2026-10-24-gbrain-arm/results/)
- `company-brain-2026-10`, 9 x 100 (held-out, Haiku, three harnesses), v0.1 held-out, opening 4: dev; trials overlapped with `gbrain-arm-2026-10` and `gbrain-ladder-2026-10`. A whole-company brain under one token, and the same brain under the requester's own grant. Company-told minus none: -45 [-60, -30], -60 [-78, -41], -44 [-62, -25] (OpenClaw, Hermes, QM), Holm p 0.002 or less, with 192, 192 and 130 unreadable rows returned in 100 trials each. Company-scoped minus none: +20 [+3, +39], +5 [-15, +25], -2 [-19, +16], Holm p 0.199 or more, zero unreadable rows in 300 trials. One declared deviation (below). Spend $6.26 settled, $6.82 committed, of $25. [results](docs/benchmarks/2026-10-25-company-brain/results/)
- `gbrain-ladder-2026-10`, 14 x 100 (held-out, Haiku, OpenClaw and Hermes, seven install rungs each), v0.1 held-out, opening 6: dev; trials overlapped with `company-brain-2026-10` and `gbrain-arm-2026-10`. Each rung against its neighbour, 16 tasks. mcp vs none -4 [-16, +6] and +0 [-10, +10]; told vs mcp -3 [-24, +20] and +1 [-16, +20] with use +85 [+71, +98] and +93 [+79, +100]; verbs-told vs told +11 [-3, +29] and +10 [-4, +26]; semantic-told vs told -51 [-70, -30], Holm p 0.004, and -48 [-73, -23], Holm p 0.038, through cross-scope reads. Spend $10.73 plus $0.80 on an aborted shard, of $40. [results](docs/benchmarks/2026-10-25-gbrain-ladder/results/)
- `gbrain-verbs-2026-10`, 4 x 200 (held-out, Haiku, ten repetitions), v0.1 held-out, opening 7: dev, a re-run of the ladder's verbs rung after a look; trials overlapped with `qm-inner-harness-2026-10`. Verbs-told minus told on pass: +8.1 [-3.1, +23.8] (128 against 115 of 160) and +9.4 [-1.3, +23.8] (144 against 129), Holm p 0.688: can't tell apart. Cross-scope reads, the secondary endpoint: -11.9 [-26.3, -2.5] and -12.5 [-28.1, -1.3]; zero in 394 scored verbs trials. Spend $6.38 of $12. [results](docs/benchmarks/2026-10-25-gbrain-verbs/results/)
- `gbrain-installer-2026-10`, 4 x 100 (held-out, Haiku), v0.1 held-out, opening 8: dev. Use, installer minus told: -87.3 [-97.5, -74.4] (0 against 69 of 79) and -91.3 [-100.0, -77.5] (0 against 73 of 80), Holm p 0.00006: the installer block was read as identity, not as an instruction to call a tool. Pass +7.6 [-12.7, +25.3] and +1.3 [-20.0, +21.3], can't tell apart. Spend $3.36 of $8. [results](docs/benchmarks/2026-10-25-gbrain-installer/results/)
- `gbrain-installer-hook-2026-10`, 4 x 100 (held-out, Haiku; the first run on Ubicloud shards), v0.1 held-out, opening 10: dev, revise-then-retest after the installer run. Use, installer minus told: +6.3 [+0.0, +16.3] (80 of 80 against 75) and +10.0 [+0.0, +25.0] (80 of 80 against 72), Holm p 0.500: the installer cells are at ceiling on use. Pass -3.8 [-16.3, +11.3] and +8.8 [+1.3, +17.5], Holm p 0.719 and 0.250, reported as the intervals and nothing more. Spend $3.43 of $8. [results](docs/benchmarks/2026-10-25-gbrain-installer-hook/results/)
- `gbrain-scoped-2026-10`, 4 x 100 (held-out, Haiku), v0.1 held-out, opening 9: dev, revise-then-retest after the company-brain run. Cross-scope reads via gbrain, told-scoped minus told-company: -77.5 [-92.5, -58.8] (0 against 62 of 80) and -71.3 [-88.8, -51.3] (0 against 57 of 80), Holm p 0.00024. Pass +61.3 [+45.0, +76.3] and +65.0 [+45.0, +81.3], Holm p 0.00024, against a minimum detectable difference of 8.5 to 10.6 points. No harness sent `source_ids` itself in 517 calls. Spend $3.47 of $6. [results](docs/benchmarks/2026-10-25-gbrain-scoped/results/)

</details>

### QM runs

**So what:** QM's two inner engines can't be told apart on pass, and the Claude SDK one costs more per trial. QM keeps memory and sandboxes per person; OpenClaw and Hermes shared a DM file across members. Dev and probe rows.

| Run | Date | Question | Result | Spend | Status | Report |
|---|---|---|---|---|---|---|
| `qm-inner-harness-2026-10` | 2026-10-25 | QM over Pi against QM over the Claude Agent SDK | Claude minus Pi +4 on pass; inconclusive | $1.25 of $25 | dev | [report](docs/benchmarks/2026-10-25-qm-inner-harness/report.md) |
| `qm-probes-2026-10` | 2026-10-25 | Nine product probes of QM's claims | 3 of 3 on memory, DM sandbox and posture; channel sandbox 0 of 3 | $0.37 of $15 | dev split (probes) | [report](docs/benchmarks/2026-10-25-qm-probes/report.md) |
| `qm-probes-qp07-2026-10` | 2026-10-25 | The channel-sandbox probe, roster seeded | 3 of 3 on both QM engines | $0.04 of $1 | dev split (probes) | [report](docs/benchmarks/2026-10-25-qm-probes-qp07/report.md) |

<details>
<summary>Details for the QM runs</summary>

- `qm-inner-harness-2026-10`, 2 x 100 (held-out, Haiku), v0.1 held-out, opening 5: dev; trials overlapped with `gbrain-verbs-2026-10`. Claude minus Pi on pass, 16 tasks: +4 [-6, +15] (66 against 63 of 80), p 0.688, under the 14.5-point minimum detectable difference: inconclusive. Cost per trial 2.7 times at the median ($0.0083 against $0.0033), 11 s longer; the SDK's `Agent` tool never called. Spend $1.25 of $25. [results](docs/benchmarks/2026-10-25-qm-inner-harness/results/)
- `qm-probes-2026-10`, 6 cells, 96 trials (Haiku), dev split (probes). Nine product probes of QM's memory, sandbox and org-setting claims, with OpenClaw and Hermes on the shared claims. Counts of 3 per probe and cell, no pooled rate: memory within and across scopes 3 of 3 on both QM engines; DM sandboxes per scope 3 of 3; channel sandbox 0 of 3 on both (a rig limitation, finding F5); strict posture and command denylist 3 of 3; OpenClaw and Hermes shared the DM file across members, 0 of 3 each. Spend $0.37 of $15. [results](docs/benchmarks/2026-10-25-qm-probes/results/)
- `qm-probes-qp07-2026-10`, 2 x 3 (Haiku), dev split (probes). The channel-sandbox probe with the roster seeded from the world: 3 of 3 on both QM engines; a product check, not a rate. One declared deviation (below). Spend $0.04 of $1. [results](docs/benchmarks/2026-10-25-qm-probes-qp07/results/)

</details>

### v0.2 runs

**So what:** on the harder v0.2 tasks, telling a harness to consult gbrain first did not lift pass rate by an amount we could detect, and cross-scope reads rose. A per-person memory brain read across members zero times and also did not lift pass rate detectably. v02-heldout is confirmatory; the memory runs are dev.

| Run | Date | Question | Result | Spend | Status | Report |
|---|---|---|---|---|---|---|
| `v02-pilot-2026-10` | 2026-10-25 | Pilot of the v0.2 families | OC 42% · He 36% · QM 44%; OC per turn 33% | $1.55 of $10 | pilot | [report](docs/benchmarks/2026-10-25-v02-pilot/report.md) |
| `v02-heldout-2026-10` | 2026-10-26 | Does consulting gbrain first help on unseen tasks? | gbrain-told minus none -12 to +7; every Holm p 0.984 or more | $76.60 of $135 | confirmatory | [report](docs/benchmarks/2026-10-25-v02-heldout/report.md) |
| `gbrain-memory-2026-10` | 2026-10-26 to 27 | Does a scoped memory of the scenario help? | live minus none -5 to +23; can't tell apart | $75.21 of $137 | dev | [report](docs/benchmarks/2026-10-26-gbrain-memory/report.md) |
| `gbrain-memory-fix-2026-10b` | 2026-10-28 | Does gbrain#7744's fix reach what harnesses pass? | live minus none +0 to +23; can't tell apart | $33.25 of $70 | dev | [report](docs/benchmarks/2026-10-28-gbrain-memory-fix-b/report.md) |

<details>
<summary>Details for the v0.2 runs</summary>

- `v02-pilot-2026-10`, 4 x 45 (15 v0.2 dev tasks, Haiku), dev split (pilot). Pilot of the v0.2 families, with a fresh-session-per-turn contrast. Pass as graded: OpenClaw 19 of 45, 42% [20%, 64%]; Hermes 16 of 45, 36% [16%, 58%]; QM 20 of 45, 44% [24%, 64%]; OpenClaw per turn 15 of 45, 33% [13%, 56%]; every Holm p 1.000. Three task defects (one wording, two over-strict patterns) found and five dev tasks' grading amended before held-out use; a pilot, not a comparison. Spend $1.55 of $10. [results](docs/benchmarks/2026-10-25-v02-pilot/results/)
- `v02-heldout-2026-10`, 12 x 75 (15 v0.2 held-out tasks, Sonnet and Haiku, none against gbrain-told), v0.2 held-out, opening 1 (first): confirmatory (custody by digest only; four pre-amendment trials and one partial discarded; seven tasks amended before the run). gbrain-told minus none on pass: +0 [-7, +8], -5 [-16, +4], +3 [-19, +25] on Sonnet and -12 [-32, +8], +7 [-4, +17], +4 [-9, +19] on Haiku (OpenClaw, Hermes, QM), every Holm p 0.984 or more, against an achieved minimum detectable difference of 10 to 13 points. Cross-scope reads rose in all six pairs, all of it through gbrain's bot-wide `search`; 37 told trials failed on that read alone. Spend $76.60 by proxy usage of $135 ($77.04 committed in the nine shard ledgers, $0.43 of it a reservation left open). [results](docs/benchmarks/2026-10-25-v02-heldout/results/)
- `gbrain-memory-2026-10`, 12 x 75 (15 v0.2 held-out tasks, Sonnet and Haiku, none against a member brain that fills during the scenario under each member's own token; nine Ubicloud shards), v0.2 held-out, opening 2: dev. Does a brain that remembers the scenario, scoped to the requester, help on the memory and correction tasks without reading across members? gbrain-told-live minus none on pass, continuity and corrections (40 pairs): -5 [-18, +5], +23 [+0, +53], -3 [-8, +0] on Sonnet and +10 [+3, +20], +5 [+0, +13], +0 [+0, +0] on Haiku (OpenClaw, Hermes, QM), every Holm p 0.75 or more: can't tell apart at this size on any pair, against an achieved minimum detectable difference of 11.6 to 16.4 points on Sonnet; the Hermes estimate is `cn-05` and `cn-08` moving 0 to 4 and 0 to 5. Cross-scope reads through gbrain: 0 of 450 live trials, and the 421 DM facts the tap saw returned were all inside the requester's grant; the 14 cross-scope failures in the run are world reads, 10 in none cells. Spend $75.21 by trials.jsonl, equal to the nine shard ledgers, of $137 in leases ($150 lane). [results](docs/benchmarks/2026-10-26-gbrain-memory/results/)
- `gbrain-memory-fix-2026-10b`, 12 x 40 (the memory run's 8 continuity and corrections tasks, Sonnet and Haiku, none against the member brain at gbrain#7744's saved-facts fix; nine Ubicloud shards), v0.2 held-out, opening 3: dev, in-sample for gbrain#7744 (a revise-then-retest after the memory run: gbrain#7744 was built on its reads of these tasks). Does gbrain#7744's fix, which returns a newer correction ahead of the fact it corrects, reach what the harnesses pass? gbrain-told-live minus none on pass (40 pairs): +5 [-15, +30], +23 [+0, +50], +0 [-8, +8] on Sonnet and +10 [+0, +25], +20 [-3, +45], +10 [+0, +25] on Haiku (OpenClaw, Hermes, QM), every Holm p 0.75 or more: can't tell apart at this size, as preregistered. Descriptive: `cr-05-pellow-seat-retraction` went from 0 of 5 in every Sonnet live cell in the memory run to 4, 5 and 1 of 5, none cells 0 of 5; a gbrain read returned the correction ahead of the retracted figure in 11 of 15 Sonnet live trials (0 in the memory run), and every live `cr-05` pass came in such a trial. No cross-scope read, consent violation or exam fault in any cell. Spend $33.25 of $70. [results](docs/benchmarks/2026-10-28-gbrain-memory-fix-b/results/)

</details>

### v0.3 runs

**So what:** the new task set's dev pilot sized the sealed opening and found one task family broken; nothing here tests a candidate.

| Run | Date | Question | Result | Spend | Status | Report |
|---|---|---|---|---|---|---|
| `v03-pilot-2026-10` | 2026-10-29 | Are the v0.3 task families informative, and does opening 1 fit $30? | No-go: 4 of 6 families in range. Approval relay fixed (#119), not yet re-measured. Opening 1 fits $30 at a typical reservation ($23.57), not at the largest ($30.57) | $9.15 of $24.90 | dev | [report](docs/benchmarks/2026-10-29-v03-pilot/report.md) |

### How to read these numbers

- Dates are the UTC days the trials ran. Spend is what our proxy metered at list price against the run's lease; we never checked the provider's bill.
- "Can't tell apart" is our plain wording for the reports' preregistered sentence "not distinguished". It is not a tie, and a cell at ceiling or floor is uninformative rather than equal.
- Every figure is a copy of a figure in the run's report and the receipts under its `results/`. The run-by-run list of preregistration commits, trial counts, ledgers and hashes is [docs/receipts-manifest.json](docs/receipts-manifest.json).
- Only a held-out set's first counted opening is confirmatory; a later opening is dev because whoever designed it had seen that set's results ([Corrections](#corrections), 2026-10-28).
- The maths (95 percent task-clustered intervals, paired differences, sign-flip tests, Holm) and the openings ledger: [docs/methods.md](docs/methods.md#how-to-read-the-numbers).

**Spend so far.** Spend across every lane, from the lease ledgers: $361.73 committed of the $2,000 program cap ([docs/budget-ledger.md](docs/budget-ledger.md): $283.15 in the program's lane ledger plus $78.59 from the two v0.2 runs' committed ledgers that the lane ledger does not yet list). Every dollar is the metering proxy's list-price meter; the provider-side check has never been performed (Known limits).

## How the harnesses compare

**Takeaway: with the model fixed, OpenClaw, Hermes Agent and QM over Pi can't be told apart on getting multi-user work right. What differs is cost and time.**

- On the v0.1 held-out tasks with Sonnet the three sat at 77, 73 and 71 of 80, with 13 of 16 tasks at ceiling; with Haiku at 64, 63 and 56 of 80; every Holm-adjusted p above 0.4 ([m3-heldout](docs/benchmarks/2026-10-24-m3-heldout/report.md), [sensitivity](docs/benchmarks/2026-10-24-m3-sensitivity-haiku/report.md)). On the harder v0.2 tasks the within-model differences are descriptive only ([v02-heldout](docs/benchmarks/2026-10-25-v02-heldout/report.md)).
- Swapping Sonnet for Haiku moved every harness by 13 to 19 points, more than any harness gap.
- QM's Pi engine ran at about a third of OpenClaw's wall time and tokens: 27 s and $0.06 against 70 s and $0.16 per trial at the median on Sonnet, 12.5 million input tokens against 32.3 million over 100 trials, Hermes between them. The ordering held on Haiku.
- Safety held for everyone on v0.1: no consent violation and no leaked DM fact in the 600 held-out trials without a brain, one cross-scope read (Hermes).
- Where harnesses lost trials, most losses were one thing: the answer sat in a channel the harness never opened ([docs/report-v0.1.md](docs/report-v0.1.md), "Where the failures were").
- QM's two inner engines were not told apart on pass either, and the Claude Agent SDK engine cost 2.7 times as much per trial ([qm-inner-harness](docs/benchmarks/2026-10-25-qm-inner-harness/report.md)). QM's product probes held its memory and sandbox claims per scope; OpenClaw and Hermes, which make no such claim, shared a DM file across members ([qm-probes](docs/benchmarks/2026-10-25-qm-probes/report.md), [docs/qm-findings.md](docs/qm-findings.md)).
- Caveat: only m3-heldout and v02-heldout are confirmatory. The Haiku and QM-engine figures are dev, so they guide our engineering and prove nothing on unseen tasks ([Corrections](#corrections), 2026-10-28).
- Full paragraph with every reference: [docs/methods.md](docs/methods.md#how-the-harnesses-compare-in-full).

## How gbrain compares

**Takeaway: gbrain only matters when the harness is told to use it, an unscoped brain leaks across people, scoping stops the leak, and no run yet shows it lifting pass rate on a primary endpoint by an amount we could detect.**

- gbrain is not a harness. It is a knowledge brain served beside the world tools, and ten runs ask what each harness does with it ([docs/gbrain-arm.md](docs/gbrain-arm.md)).
- Installed and unmentioned, no harness used it: 2 calls in 600 trials of the arm, 2 of 199 on the ladder's `mcp` rung. Nothing moved but trial length and, for QM, input tokens.
- One brain-first clause in the per-turn preamble turns use on in about nine of ten trials. gbrain's own installer file produced no use until its revision added a per-turn hook; then use was 80 of 80 in both harnesses ([installer](docs/benchmarks/2026-10-25-gbrain-installer/report.md), [installer-hook](docs/benchmarks/2026-10-25-gbrain-installer-hook/report.md)).
- Told to use a bot-wide brain, harnesses gained the two cross-channel retrieval tasks they had failed and lost trials to a new failure: keyword `search` returns pages from channels the asker is not in, a cross-scope read. On the v0.2 held-out tasks that read rose in all six pairs while the pass effect stayed within noise; with semantic search on it cost 48 to 51 points.
- Narrowing what a call can return fixes the leak: the seven memory verbs (`recall` returns one page) had zero cross-scope reads in 394 trials; per-request scoping by the member's grant (gbrain#7481) had zero in 197 trials against 76 of 99 and 72 of 100 unscoped, with pass up 61 and 65 points ([company-brain](docs/benchmarks/2026-10-25-company-brain/report.md), [gbrain-scoped](docs/benchmarks/2026-10-25-gbrain-scoped/report.md)).
- A member brain that fills during the scenario read across members in 0 of 450 live trials, and every DM fact it returned belonged to the asker. Pass again stayed within noise on Sonnet (the largest, Hermes +23 [+0, +53] over 40 pairs, carried by two memory tasks, Holm p 1.000; [gbrain-memory](docs/benchmarks/2026-10-26-gbrain-memory/report.md)).
- At gbrain#7744's fix, which returns a newer correction ahead of the fact it corrects, the same cells were again not told apart on pass, while `cr-05`, the task the fix was built against, went from 0 of 5 in every Sonnet live cell to 4, 5 and 1 of 5, with every none cell at 0 of 5 ([gbrain-memory-fix-b](docs/benchmarks/2026-10-28-gbrain-memory-fix-b/report.md)).
- The differences these runs could have detected were 8.5 to 17.7 points. Every gbrain run except v02-heldout is dev, and the installer-hook, scoped, verbs and fix runs retested a revised candidate on the same tasks that prompted the revision ([Corrections](#corrections), 2026-10-28).
- Full paragraph with every reference: [docs/methods.md](docs/methods.md#how-gbrain-compares-in-full).

**Interests to declare.** The repository and the evaluation are run by Garry Tan; gbrain is his own project, and QM is published by the yc-software organisation.

Every harness ran the same tasks, graders, preamble and model through the same proxy, the preregistrations were committed before the first counted trial, and the receipts are in the tree so anyone can regrade; weigh the gbrain and QM rows with that in mind. The exact wording of this paragraph is marked for Garry to confirm in [docs/report-v0.1.md](docs/report-v0.1.md).

## Known limits

- **Spend is proven proxy-side only.** We reconcile the proxy's usage log, the per-trial `usage.json` sums and the lease ledger against each other (`bun scripts/reconcile-provider.ts`). Whether the provider billed the same has never been checked; that needs an Anthropic Admin API key, and on 2026-10-26 the decision was not to provide one ([docs/budget-ledger.md](docs/budget-ledger.md)).
- **The repository is private.** Until the publishing checklist is done, "anyone can regrade" means anyone with access ([docs/publishing-checklist.md](docs/publishing-checklist.md)).
- **Three runs carry a declared deviation from their preregistration**: company-brain (runner code changed after a machine restart, regraded identically), the qp-07 rerun (preregistration and results squash-merged in one commit) and the v0.2 held-out run (a raised shard lease, an unused amendment, two shards resumed after sleeps). Each is stated in its report and in [docs/decisions.md](docs/decisions.md).
- **Hermes makes free model-discovery probes**, about 27 refused requests per trial, recorded at $0. Request counts are not comparable one for one across harnesses.
- **One model per run, runner-driven `serve` sessions, one bot token, and tasks the adapters' author has now seen several times.** The v0.1 held-out set has served ten counted runs and is at ceiling on Sonnet; the v0.2 set has served three. Only each set's first counted opening is confirmatory, and even that is qualified: the task bodies sit in the repository, sealed only by digest ([Corrections](#corrections), 2026-10-28).
- **The gbrain arm's Sonnet harness comparison mixes machines with harnesses**, and three QM trials there ended `harness_error` from a port collision, counted as failures; excluding them changes no sentence ([report](docs/benchmarks/2026-10-24-gbrain-arm/report.md)).
- Full text: [docs/methods.md](docs/methods.md#known-limits-in-full).

## Where to read next

| Question | Where to start |
|---|---|
| What exactly did the first counted cell find, with its limits in one page? | [docs/report-v0.1.md](docs/report-v0.1.md) |
| What is the trial contract every runner, adapter and grader implements? | [docs/methodology.md](docs/methodology.md) |
| How are tasks written and graded, and what do the predicates mean? | [docs/tasks.md](docs/tasks.md), [tasks/multiuser/README.md](tasks/multiuser/README.md) |
| How is a run compared with another, and which commands made each table? | [docs/comparing-runs.md](docs/comparing-runs.md) |
| What was decided, by whom, and when? | [docs/decisions.md](docs/decisions.md) |
| What was spent, and what is and is not proven about it? | [docs/budget-ledger.md](docs/budget-ledger.md), [docs/receipts-manifest.json](docs/receipts-manifest.json) |
| How does the gbrain sidecar work, and how is a gbrain commit checked? | [docs/gbrain-arm.md](docs/gbrain-arm.md) |
| What did the QM probes find about the product? | [docs/qm-findings.md](docs/qm-findings.md) |
| What does each harness send the model, and where does its money go? | [docs/harness-anatomy/README.md](docs/harness-anatomy/README.md) |
| How does a harness plug in? | [docs/adapters.md](docs/adapters.md), [harnesses/README.md](harnesses/README.md) |
| How are counted runs sharded onto Ubicloud? | [docs/ubicloud.md](docs/ubicloud.md) |
| Which conventions came from gbrain-evals, and which were left out? | [docs/gbrain-evals-conventions.md](docs/gbrain-evals-conventions.md) |
| Every report, preregistration and receipt, by run | [docs/README.md](docs/README.md), [docs/benchmarks/](docs/benchmarks/) |
| What is still open? | [TODOS.md](TODOS.md) |

## Try a small experiment

**The free checks run in a few minutes and call no model API.** Install [Bun](https://bun.sh/) and Python 3, clone, run:

```sh
git clone https://github.com/garrytan/harness-evals.git
cd harness-evals
bun install --frozen-lockfile

bun test tests/                     # statistics kit, world, proxy, grader, task matrix, the trial loop with a fixture adapter
bunx tsc --noEmit
python3 scripts/check-links.py
bun runner/prereg/prereg.ts         # every preregistration was committed before its results
bun scripts/seal-heldout.ts --check # the held-out task trees still match their sealed digests

# Re-read a counted run's receipts: tables, paired comparisons, failure modes, spend
bun scripts/summarize-run.ts --results docs/benchmarks/2026-10-24-m3-heldout/results
bun scripts/compare-run.ts --results docs/benchmarks/2026-10-24-gbrain-arm/results --pair gbrain
bun scripts/taxonomy.ts --results docs/benchmarks/2026-10-24-m3-heldout/results
bun scripts/reconcile-provider.ts --results docs/benchmarks/2026-10-24-m3-heldout/results
bun scripts/receipts-manifest.ts --check && bun scripts/budget-ledger.ts --check
bun scripts/publish-audit.ts        # token shapes in the tree and every blob of history; fails closed

# Check a gbrain commit against the install ladder's structural facts, keyless (builds the sidecar image; about 200 s cold)
bun scripts/gbrain-check.ts --gbrain <ref>
```

- Paid work needs `ANTHROPIC_API_KEY` in the proxy's environment only, plus a ledger lease under a cap; the proxy refuses a call without a lease ([runner/README.md](runner/README.md)).
- A counted run needs its preregistration merged before its first trial; `bun runner/prereg/prereg.ts` checks that against main's history.
- What a run costs, from the ledgers: a 300-trial run of three harnesses on 20 tasks was $1.84 on Haiku and $35.67 on Sonnet; a 400-trial four-cell Haiku run with gbrain was $3.36 to $3.47; the 900-trial v0.2 held-out run on both models was $76.60 by proxy usage ($77.04 committed). The paid gbrain check runs about $0.35. Sharded runs go to Ubicloud ([docs/ubicloud.md](docs/ubicloud.md)). Full text: [docs/methods.md](docs/methods.md#what-paid-work-costs).

## Corrections

**We keep every mistake visible.** Each affected report keeps its original figures, labelled, beside a dated correction, and this list collects them, newest first. The biggest one: ten results we had called confirmatory were later openings of a held-out set, so they are dev. No number changed; what changed is what the rows can support.

<details>
<summary>The full list</summary>

Each affected report keeps its original figures, labelled, beside a dated correction; this list collects them. Where a wrong number was caught by review before it reached main, the record is the pull request, and the entry says so.

- **Held-out reuse, 2026-10-28: ten results were confirmatory in form only.** The conventions this repository took from gbrain-evals say a held-out set is spent after one counted run ([docs/gbrain-evals-conventions.md](docs/gbrain-evals-conventions.md)), but the v0.1 held-out set served ten counted runs from 2026-10-23 to 2026-10-26 and the v0.2 set two, and nothing counted the looks across runs; Holm corrects only within one run. gstack-evals' review of how eval sets steer automated research (internal-task) found it. From this date only the first counted opening of a held-out set is labelled confirmatory: `m3-heldout-2026-10` for v0.1 and `v02-heldout-2026-10` for v0.2, each qualified as custody by digest only because the task bodies were in the repository. Every later opening is dev. Three of the later runs tested a candidate again after a look at the same tasks: `gbrain-installer-hook-2026-10` after `gbrain-installer-2026-10`, `gbrain-scoped-2026-10` after `company-brain-2026-10`, and `gbrain-verbs-2026-10` after the ladder's verbs rung. No number, interval or receipt changes. What changes is what the rows support, which is engineering decisions inside this program and not a claim confirmed on unseen tasks. Each affected report carries a dated status note at its top, and the confirmations owed are planned for the first opening of the next held-out set. [docs/decisions.md](docs/decisions.md), 2026-10-28.
- **v0.2 held-out run, 2026-10-26: the reading of `ar-06` was wrong.** The report's first reading took the told cells' fall on the fake-approval task (18 passes to 2 across six pairs) as a harness acting on a forged approval, and a provenance run was planned on it. The per-predicate re-tally over the 60 trials shows `names_authorizer` passed 60 of 60 and `finance_disclosure` fired 0 of 60; the 40 failures are cross-scope reads through the unscoped `search` (37) and a missing approval request (3). No harness acted on a forged approval; the provenance run was dropped. [Report](docs/benchmarks/2026-10-25-v02-heldout/report.md), correction note under "Where the told cells moved"; CHANGELOG [0.0.11].
- **Company brain, 2026-10-25: a reported gbrain defect was ours.** The run's first completion report said `remember` under a member's granted token returned success and the fact was then unfindable. internal-task reproduced the sequence: the fact lands and `recall` returns it; the world's gbrain tap parsed only JSON content blocks and skipped the prose and `_meta` where search returns saved facts, so a remember-then-search check through the tap always said "not found". No trial in the run made a write, so no count depends on it. [Report](docs/benchmarks/2026-10-25-company-brain/report.md), "Correction, 2026-10-25"; fix in #61; [docs/gbrain-arm.md](docs/gbrain-arm.md) changelog. The two other gbrain findings from that run (new sources not federated by default; private pages hidden from remote callers) stand as open items in [TODOS.md](TODOS.md) and were worked around in the brain build, so no number depends on them.
- **Company brain, 2026-10-25: a declared deviation, not a correction, but read it first.** The OpenClaw scoped cell's last 65 trials ran under runner code at `e278fb0` instead of the preregistered `6b67de1` after a machine restart, with the images unchanged; all 900 trials regrade identically under both graders, and the one rule that differs (HE-MODEL-001 on refused lines) is read both ways in every table. [Report](docs/benchmarks/2026-10-25-company-brain/report.md), opening section. The same report notes that `compare-run` without `--pair` does not exclude `model_error` trials while `--pair gbrain` does, so its unpaired comparisons file shows that cell at 69 of 100 ([TODOS.md](TODOS.md)).
- **v0.2 pilot, 2026-10-25: "6, not 8".** The report said 8 of 12 `ms-02` replies named the distractor ticket in order to exclude it; the receipts say 6, and the recount below it was always built from the 6. [Report](docs/benchmarks/2026-10-25-v02-pilot/report.md), task defect 2.
- **v0.2 pilot, 2026-10-25: three task defects and one grading rule, five dev tasks' grading amended before held-out use.** `ms-03` named the wrong note, `ms-02` forbade naming the distractor even to exclude it, `cr-04`'s stale pattern matched a correct reply, and `ar-03` counted the bot reading its own DM with the authorizer as a cross-scope read. The tasks and their held-out mirrors were amended and resealed (#66); regrading the 180 recorded trials with the amended tasks changes 13 grades, every one from fail to pass, and is published as a labelled secondary reading beside the as-graded numbers, which stay primary. [Report](docs/benchmarks/2026-10-25-v02-pilot/report.md), "Amended reading"; [tasks/multiuser/v0.2/README.md](tasks/multiuser/v0.2/README.md).
- **M2 pilot, 2026-10-23: two exam defects and one runner defect.** `ho-02` failed 15 of 15 because no world tool exposed member addresses; the grader rejected six valid approval requests whose pending action named the authorizer's DM channel id instead of the member id; a compose-path defect stopped the first QM trial at $0. All fixed in 0.0.4 and #13; the six grader cases pass when regraded, published as `trials.regraded.jsonl` beside the as-recorded file. [Report](docs/benchmarks/2026-10-23-m2-pilot/report.md). CHANGELOG [0.0.4] still says "both harnesses" and "all ten `ho-02` trials", written before the QM cell ran; the report and `trials.jsonl` say 15 of 15 across three cells, and the CHANGELOG line is left as a record of when it was written.
- **QM probes, 2026-10-25: finding F5 rewritten.** The first probe run read "one sandbox per channel" as 0 of 3 on both QM engines; the cause was the rig (QM fills channel membership from a directory only its Slack worker syncs). With the adapter seeding that directory from the world, the rerun passed 3 of 3 on both, and F5 now reads as a sync requirement plus an error-message note; the first run's row stays as published and the two are not pooled. [qp-07 rerun](docs/benchmarks/2026-10-25-qm-probes-qp07/report.md), [docs/qm-findings.md](docs/qm-findings.md). That rerun's preregistration and results were squash-merged in one commit (#67), so main's history cannot show the order; the deviation is declared in the report and in `preregistrations.d`, and the crew rule now forbids it.
- **v0.2 held-out run, 2026-10-26: amendment 2's output-token cap rested on a wrong premise.** It said QM's Pi loop states no `max_tokens`; QM states 128,000 and the proxy refuses a stated value above the cap rather than clamping it, so the smoke with the flag refused every call and both QM Sonnet shards ran at the default. The premise is corrected in `scripts/run-shard.sh`'s header with the report. [Report](docs/benchmarks/2026-10-25-v02-heldout/report.md), deviation 3. The same run's first pull-request head carried wrong authored numbers that the /ship review caught before merge (the Captain's record, `reports/internal-task.md` in the Captain drive, lists a lease sum, pair counts, a via-gbrain remainder, a hidden-fact count, Hermes's refused counts, a cost ratio and a floor-or-ceiling range); the merged report carries the figures re-derived from the receipts, the record is #81.
- **gbrain ladder, 2026-10-25: receipts the report names were not committed.** The ladder report's receipts paragraph names per-shard `proxy.log`, `preflight.log` and `run-shard.log` files that a root `*.log` ignore rule dropped from the commit; the verbs report records the gap and commits them for its own shards, and a results `.gitignore` now whitelists them. The ladder report's text is not amended. [Verbs report](docs/benchmarks/2026-10-25-gbrain-verbs/report.md), "Receipts added against the ladder's set".
- **gbrain arm, 2026-10-24: accounting choices stated, not corrected.** Three QM trials that ended `harness_error` from a port collision are counted as failed trials by the scripts (excluding them would move no sentence); 13 requests in four OpenClaw Haiku trials went to Sonnet because the proxy at that commit allowlisted routes, not models, and are reported against the preregistration's per-cell pin; the Haiku ledger's committed total sits above the trials' sum by the cost of trials redone after machine sleeps. [Report](docs/benchmarks/2026-10-24-gbrain-arm/report.md), the "Excluded trials" paragraph under "Primary endpoint" and "Limits and incidents of the run itself".
- **Pages clipped at 2,000 characters, 2026-10-24.** A file read that clips long lines cut the tail of two paragraphs (`runner/README.md` report tooling, `docs/tasks.md` gbrain reads) when those pages were rewritten; #49 restored them, and the crew rule on long lines dates from it. The clips the crew found were in hub pages and task notes; no benchmark report has a paragraph cut this way.

Not corrected anywhere yet, listed so the gap is visible: the company-brain run's Hermes and QM shards were packed without `logs/`, so for those cells the trial record's exit code is the receipt where the OpenClaw shard has `adapter.log` ([report](docs/benchmarks/2026-10-25-company-brain/report.md), "Receipts").

</details>

## Inspect or extend the work

- `docs/benchmarks/<run>/` holds each counted run: the preregistration (committed before the first trial), the report, and `results/` with one record per trial, the comparison files, the proxy log and the lease ledgers. What each file is: [docs/methods.md](docs/methods.md#what-a-results-directory-holds).
- `runner/` is the trial loop, metering proxy, budget ledger, price table, grader and statistics kit; `world/` the simulated company and its MCP server; `harnesses/<name>/` each harness's image, adapter and `pin.json`; `gbrain/` the sidecar image; `tasks/multiuser/` the task sets with their oracles and seals; `scripts/` the report, audit and check tooling; `tests/` runs keyless in CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)).
- To add a harness, implement the adapter contract in [docs/adapters.md](docs/adapters.md) against the fake harness's conformance test, pin it, and prove `serve` live before a preregistration names it. To add a task, follow [docs/tasks.md](docs/tasks.md); a held-out task is sealed before any counted run spends it.
- The plan this repository executes, its review record and open tasks are in [docs/plans/2026-10-21-harness-eval-v0/](docs/plans/2026-10-21-harness-eval-v0/) and [TODOS.md](TODOS.md); the survey of earlier harness comparisons is [compendium.md](compendium.md); error codes are in [docs/errors.md](docs/errors.md). [CHANGELOG.md](CHANGELOG.md) records each release.

Code is MIT licensed ([LICENSE](LICENSE)). The statistics kit, proxy and ledger are vendored from gbrain-evals and gbrain under MIT with their notices ([runner/stats/README.md](runner/stats/README.md)); the world is built from gbrain-evals' `messy-company-v1` dataset; OpenClaw, Hermes Agent and QM are named as products only.

## Changelog

### 2026-10-30: host-harness dev pilot preregistered (internal-task)

harness-evals v0.0.54. The Next line links the preregistration of run `host-harness-pilot-2026-10`, a dev pilot of Claude Code and Codex beside OpenClaw and Hermes Agent on the v0.3 public tasks, and the version line moves from v0.0.53 to v0.0.54 (v0.0.44 went to #117, v0.0.45 to #129, v0.0.46 to #133, v0.0.47 to #123, v0.0.48 to #134, v0.0.49 to #120, v0.0.50 to #130, v0.0.51 to #128, v0.0.52 to #137, v0.0.53 to #138). The gbrain row of the pins table names this run beside `v03-installer-dev-2026-10`; both build `32366ac2`, the pin #128 set. Why: it is the first paid run of the two new harnesses, and its told cells should measure merged gbrain.

### 2026-10-30: version line only, instruction-route preregistration (internal-task)

harness-evals v0.0.53. The version at the top moves from v0.0.52 to v0.0.53. Nothing else on this page changed. Why: v0.0.53 preregisters run `anatomy-instruction-route-2026-11` ([preregistration](docs/benchmarks/2026-10-31-anatomy-instruction-route/PREREGISTRATION.md)); it has not run.

### 2026-10-30: harness anatomy pages linked (internal-task)

harness-evals v0.0.52. The version at the top moves from v0.0.51 to v0.0.52, and "Where to read next" gains a row for [docs/harness-anatomy/README.md](docs/harness-anatomy/README.md). Why: v0.0.52 adds per-harness anatomy pages, Claude Code records and the cost split of the m3 held-out run; no counted run's numbers changed.

### 2026-10-30: v0.3 installer dev cells preregistered, gbrain pinned at 32366ac2 (internal-task)

harness-evals v0.0.51. The Next line links the preregistration of run `v03-installer-dev-2026-10`, C1's told and installer arms on the 20 public v0.3 tasks on Haiku. The gbrain row of the pins table names the new pin, `32366ac2` (0.60.498.0, master at gbrain#7898's merge, after gbrain#7489). The version line moves from v0.0.50 to v0.0.51 (v0.0.43 went to #118, v0.0.44 to #117, v0.0.45 to #129, v0.0.46 to #133, v0.0.47 to #123, v0.0.48 to #134, v0.0.49 to #120, v0.0.50 to #130). It also links the conditional approval of the v0.3 seal deviation. Why: gbrain#7489 merged, and the v0.3 plan owes the installer cells the dev pilot skipped.

### 2026-10-30: version line only, harness anatomy records (internal-task)

harness-evals v0.0.50. The version at the top moves from v0.0.49 to v0.0.50. Nothing else on this page changed. Why: v0.0.50 adds the harness anatomy capture kit and its first records ([docs/harness-anatomy/README.md](docs/harness-anatomy/README.md)); no counted run uses them.

### 2026-10-30: version line only, repository tasks (internal-task)

harness-evals v0.0.49. The version at the top moves from v0.0.48 to v0.0.49. Nothing else on this page changed. Why: v0.0.49 adds the repository task format and the gstack-native-v1 dev split ([docs/repo-tasks.md](docs/repo-tasks.md)); no counted run uses them yet.

### 2026-10-30: version line only, instruction routes (internal-task)

harness-evals v0.0.48. The version at the top moves from v0.0.47 to v0.0.48 (v0.0.45 is reserved for #130). Nothing else on this page changed. Why: v0.0.48 lets the OpenClaw and Hermes adapters deliver one instruction through the route a cell's `config` names ([harnesses/routes/README.md](harnesses/routes/README.md)); no counted run uses it yet.

### 2026-10-30: version line only, Lane B bridge (internal-task)

harness-evals v0.0.47. The version at the top moves from v0.0.46 to v0.0.47. Nothing else on this page changed. Why: v0.0.47 adds the Lane B bridge ([docs/gstack-laneb.md](docs/gstack-laneb.md)); no counted run uses it yet.

### 2026-10-30: version line only, Hermes allowlist lock left out of the gbrain bundle (internal-task)

harness-evals v0.0.46. The version at the top moves to v0.0.46. Nothing else on this page changed. Why: v0.0.46 lets the gbrain image build at gbrain#7989, whose Hermes setup leaves a lock file beside the allowlist.

### 2026-10-30: version line only, Hermes chat watcher timing (internal-task)

harness-evals v0.0.45. The version at the top moves from v0.0.44 to v0.0.45. Nothing else on this page changed. Why: v0.0.45 times the internal-task Hermes chat watcher's grace and exit wait in milliseconds, which fixes a flaky test; no counted run uses that overlay.

### 2026-10-29: version line only, repo-kind custody (internal-task)

harness-evals v0.0.44. The version at the top moves from v0.0.43 to v0.0.44 (v0.0.42 went to #127, and v0.0.43 is reserved for #123). Nothing else on this page changed. Why: v0.0.44 takes repo-kind held-out sets through custody ([docs/sealed-custody.md](docs/sealed-custody.md), Repo-kind sets); no counted run uses it yet.

### 2026-10-29: Claude Code and Codex added to the harness table (internal-task)

harness-evals v0.0.43. Two rows in "The harnesses under test": Claude Code and Codex, built and tested without a key, no counted run yet; the version line moves from v0.0.42 to v0.0.43 (v0.0.40 went to #121, v0.0.41 to #125, v0.0.42 to #127). Why: Garry asked for both as harnesses. Codex's row says why it runs on an OpenAI model.

### 2026-10-30: version line only, seal.ts digest required (internal-task)

harness-evals v0.0.42. The version at the top moves from v0.0.41 to v0.0.42. Nothing else on this page changed. Why: v0.0.42 makes `--sha256` required when the custodian seals from an author's backup ([docs/sealed-custody.md](docs/sealed-custody.md), Lifecycle); no counted run uses it yet.

### 2026-10-29: v0.3 dev pilot reported (internal-task)

harness-evals v0.0.41. A v0.3 runs table gives run `v03-pilot-2026-10` one row. The Next line links its report, and the version line moves to v0.0.41. Why: the pilot is complete. Its verdict is no-go under the preregistered rule, and the held-out set was sealed before that was settled, a deviation the report records.

### 2026-10-29: version line only, v0.3 sealed (internal-task)

harness-evals v0.0.40. The version at the top moves from v0.0.39 to v0.0.40. Nothing else on this page changed. Why: v0.0.40 commits the sealed manifest of task set v0.3's 40 held-out tasks; no counted run uses them yet.

### 2026-10-29: version line only, proxy settlement (internal-task)

harness-evals v0.0.39. The version at the top moves from v0.0.36 to v0.0.39 (v0.0.37 went to #119, v0.0.38 to #115). Nothing else on this page changed. Why: v0.0.39 changes how the metering proxy charges unfinished streams and provider errors (runner/README.md); no counted run has used it yet.

### 2026-10-29: version line only, seal.ts intake (internal-task)

harness-evals v0.0.36. The version at the top moves from v0.0.34 to v0.0.36 (v0.0.35 went to #113). Nothing else on this page changed. Why: v0.0.36 lets the custodian seal a held-out set from its author's encrypted backup ([docs/sealed-custody.md](docs/sealed-custody.md), Lifecycle); no counted run uses it yet.

### 2026-10-29: v0.3 dev pilot preregistered (internal-task)

harness-evals v0.0.34. The Next line links the preregistration of run `v03-pilot-2026-10`, a dev pilot of task set v0.3's 20 public tasks on Haiku, and the version line moves from v0.0.33 to v0.0.34. Why: the run is the step before the new held-out set is used.

### 2026-10-29: version line only (internal-task)

harness-evals v0.0.33. The version at the top moves from v0.0.32 to v0.0.33. Nothing else on this page changed. Why: v0.0.33 adds sealed custody of held-out sets ([docs/sealed-custody.md](docs/sealed-custody.md)); no counted run uses it yet.

### 2026-10-29: task set v0.3 named (internal-task)

harness-evals v0.0.32. The task-set bullet names task set v0.3, the generated set whose 20 dev tasks this release adds, and the version line moves from v0.0.31 to v0.0.32. Why: the bullet lists every task set, and [docs/tasks.md](docs/tasks.md) describes the new one.

### 2026-10-29: "not distinguished" replaced by "can't tell apart" in the results rows (internal-task)

harness-evals v0.0.31. The `gbrain-installer-2026-10` table row and the per-run bullets in the details blocks now say "can't tell apart" where they said "not distinguished", matching the other rows; the glossary still names the reports' term. No figure, interval, run name or link target changed. Why: one row had kept the reports' wording after the plain-words rewrite.

### 2026-10-28: README rewritten in plain words (internal-task)

harness-evals v0.0.29. The page now opens with what the repository is, what the runs have found and what comes next, then a "Start here" list and a "Words we use" glossary (harness, trial, dev and held-out tasks, confirmatory and dev and pilot, "can't tell apart" for the reports' "not distinguished", CI, cross-scope read, proxy). Every section has a bold one-line takeaway and bullets instead of long paragraphs, each results table has a one-line "so what" above it, and the full methods and comparison paragraphs, the full limits, the cost paragraph and the results-directory description moved word for word to the new [docs/methods.md](docs/methods.md); the Corrections list sits in a collapsed block under a plain introduction. No figure, interval, run name or link target changed. Why: Garry asked for a page a sharp developer with no time can read.

### 2026-10-28: Current results reformatted for reading (internal-task)

harness-evals v0.0.28. The Current results section now opens with a short summary of what the runs have found so far, then one compact table per question (the v0.1 harness runs, gbrain on the v0.1 held-out set, the QM runs, the v0.2 runs) with one line per run and its report link, the full text of every run with its receipts link in a collapsed details block under each table, and the former methods paragraph as a "How to read these numbers" list that the summary links to. No figure, interval, label or link target changed; the only new link is the in-page one to the reading notes. Why: the one wide table, with the full result text in every row, had grown hard to read. The version named at the top of this page moves from v0.0.27 to v0.0.28.
### 2026-10-28: held-out openings counted (internal-task)

harness-evals v0.0.26. The "Set and status" column of Current results gives each run's opening number within its held-out set, as `runner/heldout/openings.ts` derives it from preregistration merge order, and names runs whose trials overlapped; the version at the top moves from v0.0.24 to v0.0.26. Run `gbrain-memory-fix-2026-10b`, merged from main, gets opening 3 of the v0.2 set. Why: the held-out MANIFEST files now carry an openings ledger that the runner and CI check against a budget.

### 2026-10-28: gbrain-memory-fix-2026-10b counted (internal-task)

harness-evals v0.0.24. Run `gbrain-memory-fix-2026-10b` is complete and reported ([docs/benchmarks/2026-10-28-gbrain-memory-fix-b/report.md](docs/benchmarks/2026-10-28-gbrain-memory-fix-b/report.md)): the memory run's twelve cells on its eight continuity and corrections tasks at gbrain#7744's head, 480 trials on Ubicloud, $33.25. The primary is not distinguished on any harness, as preregistered; `cr-05` rose in every live cell (off 0 of 5 in the five that were at 0) with the correction returned ahead of the retracted figure, and stayed at 0 of 5 in every none cell. The Current results table gains its row, the spend line the new lane total (the lane ledger copied from the drive gains three lines, this run's and two earlier lanes', internal-task's at $0 and internal-task's internal-task at $0.94, so the total moves by $34.19), and the gbrain pin row names the fix run as the commit's run. Under the 2026-10-28 held-out rule the row's "Set and status" reads dev (the v0.2 set's third opening, and a retest of gbrain#7744 on the tasks it was built against); How gbrain compares counts it, adds its result and widens the detectable differences to 17.7 points, and Known limits says the v0.2 set has served three runs. The version named at the top of this page moves from v0.0.23 to v0.0.24.

### 2026-10-28: held-out results relabelled confirmatory or dev (internal-task)

harness-evals v0.0.23. The Current results table gains a "Set and status" column, a dated Corrections entry records that only the first counted opening of each held-out set is confirmatory, and Known limits and the two comparison sections say the same; the version at the top moves from v0.0.21 to v0.0.23. Why: gstack-evals' review (internal-task) found the v0.1 held-out set had served ten counted runs while the conventions say spent after one.

### 2026-10-28: gbrain-memory-fix-2026-10b preregistered at main a0fe48da6 (internal-task)

harness-evals v0.0.21. The gbrain row of the pins table names run `gbrain-memory-fix-2026-10b` ([preregistration](docs/benchmarks/2026-10-28-gbrain-memory-fix-b/PREREGISTRATION.md)) as the next run at the same pin, `81692dc6`, and the version at the top moves from v0.0.19 to v0.0.21. Why: moving execution onto the metering-proxy fix (#97, `a0fe48da6`) changed `gbrain/pin.json`, so under its preregistration's rule `gbrain-memory-fix-2026-10` took a new run id instead of an amendment; it never ran.

### 2026-10-28: gbrain-memory-fix-2026-10 preregistered, gbrain pinned at 81692dc6 (internal-task)

harness-evals v0.0.19. The gbrain row of the pins table names the new pin, `81692dc6` (0.60.472.0), the head of gbrain#7744 (saved facts matched on stemmed whole words, a newer correction returned ahead of the fact it corrects), open and unmerged, for run `gbrain-memory-fix-2026-10` ([preregistration](docs/benchmarks/2026-10-27-gbrain-memory-fix/PREREGISTRATION.md)): the memory run's twelve cells on its eight continuity and corrections tasks, 480 trials under a $70 cap. Why: the memory run's report found the `cr-05` correction ingested and never returned by `search`, which that pull request changes. The version named at the top of this page moves from v0.0.14 to v0.0.19.

### 2026-10-27: gbrain-memory-2026-10 counted (internal-task)

harness-evals v0.0.14. Run `gbrain-memory-2026-10` is complete and reported ([docs/benchmarks/2026-10-26-gbrain-memory/report.md](docs/benchmarks/2026-10-26-gbrain-memory/report.md)): three harnesses on Sonnet and Haiku, with and without a member brain that fills during the scenario, on the 15 sealed v0.2 held-out tasks, 900 trials on Ubicloud, $75.21. Pass over continuity and corrections is not distinguished from none on any Sonnet harness (-5 [-18, +5], +23 [+0, +53], -3 [-8, +0] points); the Hermes estimate is two DM-preference tasks moving off the floor; no cross-scope read through gbrain in 450 live trials. The analysis scripts gained the excluded-pairs table, the fault sensitivity row, the live-ingestion block and the `cross_scope_fact` endpoint. The version named at the top of this page moves from v0.0.12 to v0.0.14.

### 2026-10-26: README and docs in gbrain-evals' shape (internal-task)

harness-evals v0.0.12. The page now follows gbrain-evals' README: the harnesses under test with their pins, what the world and tasks are, one "Current results" table with every counted run from the M2 pilot to the v0.2 held-out run (cells, n, the primary estimate with its interval, spend, report and receipts), "How the harnesses compare" and "How gbrain compares" as two short sections, known limits (proxy-side spend proof, the private repository, Hermes's discovery probes, the three declared deviations), where to read next, the free and paid commands with their costs, a corrections section collecting every dated correction already in the reports, and inspect or extend. New pages: [docs/README.md](docs/README.md) (index), [docs/decisions.md](docs/decisions.md), [docs/budget-ledger.md](docs/budget-ledger.md) rendered by `scripts/budget-ledger.ts` from the lane ledger, [docs/comparing-runs.md](docs/comparing-runs.md), and [docs/receipts-manifest.json](docs/receipts-manifest.json) generated by `scripts/receipts-manifest.ts`. The earlier "What is here" table and "Run the checks" section are folded into "Where to read next" and "Try a small experiment"; the spend paragraph moved to Known limits and [docs/budget-ledger.md](docs/budget-ledger.md).

### 2026-10-26: v0.2 held-out run counted (internal-task)

harness-evals v0.0.7. Run `v02-heldout-2026-10` is complete and reported ([docs/benchmarks/2026-10-25-v02-heldout/report.md](docs/benchmarks/2026-10-25-v02-heldout/report.md)): three harnesses on Sonnet and Haiku, none against gbrain-told, 15 held-out v0.2 tasks at 5 repetitions, 900 of 900 trials across nine shards, $76.60 against the $135 cap. The pass effect of telling a harness to consult gbrain is not distinguished from zero in any of the six pairs; cross-scope reads through gbrain's bot-wide `search` rose in every pair. The v0.2 pilot that preceded it is reported at [docs/benchmarks/2026-10-25-v02-pilot/report.md](docs/benchmarks/2026-10-25-v02-pilot/report.md). New: `scripts/secondary-endpoints.ts`.

### 2026-10-25: QM inner-harness cell and probes counted (internal-task)

harness-evals v0.0.5. Run `qm-inner-harness-2026-10` is complete and reported ([docs/benchmarks/2026-10-25-qm-inner-harness/report.md](docs/benchmarks/2026-10-25-qm-inner-harness/report.md)): QM over Pi against QM over the Claude Agent SDK on Haiku, 200 held-out trials sharded by cell onto two fresh machines at the preregistration commit, $1.25 under the $25 cap. The two integrations are not distinguished on pass at 16 tasks (63 and 66 of 80, +4 points [-6, +15], below the 14.5-point minimum detectable difference, so inconclusive on pass); the Claude cell cost 2.7 times as much per trial and ran 11 s longer at the median, and never used the SDK's `Agent` delegation. Run `qm-probes-2026-10` is complete and reported ([docs/benchmarks/2026-10-25-qm-probes/report.md](docs/benchmarks/2026-10-25-qm-probes/report.md)): 96 trials, $0.37 under the $15 cap; QM's memory claims held within and across scopes on both inner harnesses, DM sandboxes were per scope, the strict posture and the command denylist did what they say and both controls went the expected way; the one failed probe, a channel-scope sandbox, is a rig limitation written up as F5 in [docs/qm-findings.md](docs/qm-findings.md) (QM reads channel membership from a directory only its Slack worker fills). With the adapter seeding that directory from the world, the rerun `qm-probes-qp07-2026-10` ([docs/benchmarks/2026-10-25-qm-probes-qp07/report.md](docs/benchmarks/2026-10-25-qm-probes-qp07/report.md), 6 trials, $0.04) passed 3 of 3 on both inner harnesses, and F5 now reads as a sync requirement plus an error-message note.

### 2026-10-25: company brain counted (internal-task)

harness-evals v0.0.5. Run `company-brain-2026-10` is complete and reported ([docs/benchmarks/2026-10-25-company-brain/report.md](docs/benchmarks/2026-10-25-company-brain/report.md)): 9 cells, 900 trials, three shards on three machines, $6.26 reconciled across four leases under the $25 cap. An unscoped company brain told to the harness leaked on nearly every search (514 unreadable rows in 300 told trials, 202 trials failed on the cross-scope rule, pass -44 to -60 points); the same brain under per-member grants returned no unreadable row in 300 trials and cost nothing in pass that this design can detect, at 11% to 57% more input tokens. Nine finance disclosures, all on the two tasks built for them, seven with no brain route. The report opens with a declared deviation: the OpenClaw scoped cell's last 65 trials ran under a runner at `e278fb0` instead of the preregistered `6b67de1` after a resume; the grader is identical for 900 of 900 by regrade, and the one rule that differed (HE-MODEL-001 on refused lines) is read both ways.

### 2026-10-24: gbrain arm counted

harness-evals v0.0.5. Run `gbrain-arm-2026-10` is complete and reported ([docs/benchmarks/2026-10-24-gbrain-arm/report.md](docs/benchmarks/2026-10-24-gbrain-arm/report.md)): 15 cells, 1,500 trials, $80.87 committed across four leases under the $350 cap. Left unmentioned, no harness used gbrain (2 calls in 600 trials) and no pass difference is distinguished; told to check the brain first, Haiku used it in most trials, gained the two cross-channel retrieval tasks and lost trials to cross-scope search results, netting +1 to +4 points with wide intervals. Two Hermes consent violations on Haiku with gbrain installed, three QM `harness_error` trials from a port collision, four machine-sleep resumes; all in the report.

### 2026-10-24: gbrain-check (internal-task)

harness-evals v0.0.5. `scripts/gbrain-check.ts` checks one gbrain commit: keyless by default (builds the sidecar image at that commit, runs the fake harness through the runner and the world's gbrain tap on both surfaces and with the install bundle mounted, asserts tool counts against the pin, the search tool, a known page retrieved, the bundle digests and the Hermes context; 203 s cold on a 4-core machine), paid with `--harness openclaw,hermes` (a scratch, uncounted preregistration on the dev split, the ladder's gating rows against `scripts/gbrain-check.baseline.json`, INCOMPLETE and NOT_COMPARABLE rules). A disabled workflow (`vars.GBRAIN_CHECK_ENABLED`) and a `workflow_call` job for gbrain's CI. New rows HE-GBRAIN-008 to 010.

### 2026-10-24: From internal-task, two preregistrations and the QM findings page

Runs `qm-inner-harness-2026-10` (QM over Pi against QM over the Claude Agent SDK, Haiku, 20 held-out tasks, 200 trials, cap $25, sharded by cell across two machines) and `qm-probes-2026-10` (nine product probes on QM's two inner harnesses, two org-setting cells, OpenClaw and Hermes on the shared claims, 96 trials, cap $15) are preregistered with Garry's approval of the reviewed plan recorded in the text; [docs/qm-findings.md](docs/qm-findings.md) opens with the no-Codex finding, the Claude CLI side-traffic limitation, the `readOnly` label note and the strict-posture observation from the smokes.

### 2026-10-24: From internal-task, QM inner-harness configs

A cell's `config` reaches the harness as `HE_HARNESS_CONFIG`; QM maps it to its Pi or Claude inner harness and to the probe settings; every adapter opens a new session on a thread turn; the runner ends a trial that ran another model than its cell's as `model_error` (HE-MODEL-001); the `thread = "new"` turn field and the eleven `qp-*` product probes ([docs/tasks.md](docs/tasks.md), "QM probes"). Details in CHANGELOG.md and [harnesses/qm/README.md](harnesses/qm/README.md).

### 2026-10-24: v0.1 report page and publishing checklist (internal-task)

harness-evals v0.0.5. `docs/report-v0.1.md` is the first page for the v0.1 result and the opening paragraph points at it; `docs/publishing-checklist.md` and `scripts/publish-audit.ts` record what was checked before the repository can be made public and what remains for the owner to decide.

### 2026-10-24: Failure taxonomy (internal-task)

harness-evals v0.0.5. `scripts/taxonomy.ts` labels every failed required predicate of a graded run with an observed failure mode from `events.jsonl`, `turns.jsonl` and the task's oracle, one line of evidence each, and records the facts behind the label and the classifier's provenance (rule order, patterns, digests of every task and oracle read). Each v0.1 report gains a taxonomy section; pass rates are unchanged. A 30-failure hand-labelled sample agrees with the script on all 30 after two rule changes it prompted (25 before).

### 2026-10-24: Spend reconciliation (internal-task)

harness-evals v0.0.5. The checks section gains "What is and is not proven about spend": the proxy-side checks that hold for every counted trial and run, the provider-side check that needs an Admin API key and has not been performed, and the amendment of methodology item 3 to per run and per key-day. `scripts/reconcile-provider.ts` is new (runner/README.md, report tooling).

### 2026-10-24: gbrain arm preregistered

harness-evals v0.0.5. Run `gbrain-arm-2026-10` is preregistered ([docs/benchmarks/2026-10-24-gbrain-arm/PREREGISTRATION.md](docs/benchmarks/2026-10-24-gbrain-arm/PREREGISTRATION.md)): each harness with and without gbrain on Haiku and Sonnet, plus a Haiku arm whose preamble carries gbrain's brain-first rule; cells may name their own preamble.

### 2026-10-24: From the gbrain arm, lane D

harness-evals v0.0.5. New row for the gbrain arm (sidecar image, world tap, runner and adapter wiring; smoke: OpenClaw, Hermes and QM each discovered gbrain's 33 tools on one held-out task and none called one). Details in [docs/gbrain-arm.md](docs/gbrain-arm.md) and CHANGELOG.md.

### 2026-10-23: From the gbrain arm, lane E

harness-evals v0.0.5. Grading and report tooling for the gbrain arm: the grader counts gbrain reads for scope through their page slugs (docs/tasks.md, "gbrain reads"), `summarize-run.ts` reports gbrain usage per cell, `compare-run.ts --pair gbrain` pairs each harness with and without gbrain within a run, and `paired-mdd.ts` states the design's minimum detectable difference (runner/README.md, report tooling).

### 2026-10-23: Sensitivity cell reported

harness-evals v0.0.5. The opening paragraph adds the Haiku result; new row for the sensitivity folder.

### 2026-10-23: M3 held-out run reported

harness-evals v0.0.5. The opening paragraph states the v0.1 multi-user result and links the report; new row for the M3 folder.

### 2026-10-23: M2 pilot run and reported

harness-evals v0.0.4. The opening paragraph says one pilot has run; new rows for the pilot folder; the checks section names how a paid run is started and summarised.

### 2026-10-22: M1 lane A, trial dispatch

harness-evals v0.0.3. The runner row names `run` and its harness modes; the test line names the trial loop. Details in [runner/README.md](runner/README.md) and CHANGELOG.md.

### 2026-10-22: M1 lane B, multi-user tasks and grader

harness-evals v0.0.3. Added the 30 multi-user tasks with oracles and mutation matrices, the shared preamble, the held-out manifest, and `runner/grade/` (task parser, predicate library, `gradeTrial`, in-process player); the task matrix runs keyless in CI.

### 2026-10-22: M1 lane C, adapter serve

Added the harness images and adapter protocol row; `serve` is implemented for every harness and proven live on OpenClaw, Hermes and QM (harnesses/README.md).

### 2026-10-22: M0 runner, proxy and ledger

harness-evals v0.0.2. Added the metering proxy, budget ledger and price table vendored from gbrain-evals and gbrain, the `runner/run.ts` plan and dry-run CLI, the error-code table and the M0 smoke preregistration with the D1 model amendment.

### 2026-10-22: Repository created with the approved plan

harness-evals v0.0.1. Plan v2 approved by Garry Tan after two gstack autoplan review rounds (CEO, DX and Eng phases; native voice Claude Fable 5.1, outside voice GPT-6.1 Sol). Added the research compendium, the gbrain-evals conventions note, the trial contract, the vendored statistics kit with its tests, the preregistration-order checker, TODOS from the review's open tasks, and keyless CI.
