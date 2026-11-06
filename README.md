# harness-evals

**What does the harness around an AI model change?** A harness is everything around the model: tools, prompts, memory and permissions. We hold the model and the tasks fixed, swap only the harness (OpenClaw, Hermes Agent, QM, Claude Code, Codex), and measure what moves. We also test two add-ons: gbrain, a knowledge brain, and gstack, a pack of skill files for coding agents.

**Every number links to a saved receipt, and you can recheck it without an API key** ([how](#check-our-numbers-without-keys)).

## Found so far, on a frontier model (Opus 5.5)

- **gstack's skills reach Opus 5.5, but their steps don't run.** In three checks, the skill text loaded in every gstack session, and no session ran a single skill step: **0 of 46** (descriptive; Wilson 95% upper bound about 0.077). gstack cost about **2 times** as much per trial as no gstack. Caveat: the deciding check used easy tasks (14 of 16 passes on every arm), and the hard check is void ([report](docs/benchmarks/2026-11-01-opus-gstack-follow/report.md)). Verdict FIX-METHOD: no gstack already passed nearly every task, so these runs had no room to show a gain ([finding](findings/2026-11-02-opus-gstack-steps-not-followed.md)). A hook that blocks edits until a failing repro runs didn't fix it: Opus wrote source through Bash, past the hook, 40 times, and the hook is not added to gstack ([report](docs/benchmarks/2026-11-03-investigate-gate/report.md)).
- **A start hook gets agents to run gstack's start command.** On Hermes, with gstack v1.92.57.0 and the Tirith scanner pinned: **8 of 16** trials against 0 of 16 for gstack without the hook, **+0.50 [0.21, 0.72]**, all 8 on one of the three tasks. On OpenClaw: 16 of 16 against 1 of 16. Task success was 16 of 16 in every arm, so these tasks can't show a success gain ([Hermes rerun](docs/benchmarks/2026-11-01-tool-discipline-start/report-hermes-r2.md), [first panel](docs/benchmarks/2026-11-01-tool-discipline-start/report.md)).
- **Our v0.3 multi-user tasks are too easy for Opus 5.5.** Four of six task families scored above 90 percent. Only corrections (9 of 40) and approval relay (26 of 30) landed in the 10 to 90 percent band. So the sealed v0.3 set stays unopened, and the next set must put facts where only memory reaches them ([report](docs/benchmarks/2026-10-31-v03-opus-dev/report.md)).
- **Scoping a shared brain still matters on Opus.** With one bot-wide gbrain token, search returned 123 (OpenClaw) and 121 (Hermes) rows the asker was not allowed to see. Scoped to the asker: 0 (same report, descriptive).

**All four rest on dev runs, uncounted checks or, for the hook test, one preregistered run, all on public tasks.** They steer our work and prove nothing on unseen tasks. GPT-6.1 Sol has reported in seven runs so far: the Codex cells of the two installer rungs (dev, Current results), the Sol arms of `gates938-phase3`, the hook test ([report](docs/benchmarks/2026-11-03-investigate-gate/report.md)), where every Sol arm sat near the floor, the Sol cells of `prompt-archaeology-2026-11` ([report](docs/benchmarks/2026-11-01-prompt-archaeology/report.md)), the Sol cells of `matrix-mu-2026-11` ([report](docs/benchmarks/2026-11-04-matrix-mu/report.md)), and the Sol arms of the two QM M1 runs, `qm-c4-told-live-2026-11` ([report](docs/benchmarks/2026-11-03-qm-c4-told-live/report.md)) and `qm-s1-gstack-probe-2026-11` ([report](docs/benchmarks/2026-11-03-qm-s1-gstack-probe/report.md)). Older results on Sonnet 5.5 and Haiku 5.5 are in the [appendix](#appendix-sonnethaiku-runs-appendix-grade-not-frontier-evidence).

## What each harness sends the model

**We pointed each harness at a fake model endpoint and logged every request, byte for byte.** No real model was called, so this costs $0 and needs no key ([harness anatomy](docs/harness-anatomy/README.md)).

- **Same task, very different first requests.** OpenClaw sent 18,356 tokens, Hermes 20,613, QM 0.1.15 (Pi engine) 20,492, Claude Code 18,416, and Codex about 12,900 (a local estimate).
- **Registering gbrain costs 0 to 11,771 tokens per request,** depending on the harness. OpenClaw adds nothing visible; QM 0.1.15 sent every gbrain tool in full.
- **Only Claude Code passes gbrain's own operating instructions to the model.** OpenClaw, Hermes and QM 0.1.15 drop them.
- **Most of a harness's bill is prompt caching, not output.** On one Sonnet run, cache writes and reads were 87 percent of OpenClaw's bill and output 13 percent ([cost split](docs/harness-anatomy/README.md#where-the-money-goes)).

## Check our numbers without keys

```sh
git clone https://github.com/garrytan/harness-evals.git && cd harness-evals
bun install --frozen-lockfile

# Recompute every count, interval and cost in the Opus 5.5 gstack report
python3 docs/benchmarks/2026-11-01-opus-gstack-follow/results/recompute.py \
  | diff - docs/benchmarks/2026-11-01-opus-gstack-follow/results/recompute.out && echo match

# Rebuild the v0.3 Opus run's tables from its per-trial records
bun scripts/summarize-run.ts --results docs/benchmarks/2026-10-31-v03-opus-dev/results

# Put back the receipts that script may rewrite in that run's folder
git checkout -- docs/benchmarks/2026-10-31-v03-opus-dev/results
```

- You need [Bun](https://bun.sh/) and Python 3. Nothing here calls a model, and each command takes seconds.
- Every run folder under [docs/benchmarks/](docs/benchmarks/) holds its preregistration, its report and `results/`. [docs/receipts-manifest.json](docs/receipts-manifest.json) lists each run's receipts and hashes.
- **Past preregistration order is attested privately, not publicly verifiable.** Each report says its preregistration merged before its first trial, and `bun runner/prereg/prereg.ts` checks that against our private working repository's history. Commit dates in a public copy are self-asserted.
- The full keyless suite, with honest timings: [Run the keyless checks](#run-the-keyless-checks).

## In progress

- **Task set v0.4.** v0.3 is too easy for Opus 5.5, so v0.4 must put each needed fact where only memory reaches it ([Why null?](docs/benchmarks/2026-10-31-v03-opus-dev/report.md#why-null)).
- **The sealed v0.3 set stays unopened:** 0 of its 2 openings used ([reseal record](docs/sealed-records/v0.3-gen6-reseal.md), procedural custody).

<details>
<summary>How we got here: the v0.3 pilot and seal log</summary>

- **The dev pilot read no-go** ([report](docs/benchmarks/2026-10-29-v03-pilot/report.md)): on its 20 public tasks on Haiku, four of six families were informative and the rule needs five. It found and fixed a defect in one family.
- **The held-out set was sealed early.** It was sealed (custody commit (private)) before that verdict was settled.
- **That deviation is approved on one condition** ([deviation-approval.md](docs/benchmarks/2026-10-29-v03-pilot/deviation-approval.md)): the `told` cells of the installer dev run ([preregistration](docs/benchmarks/2026-10-29-v03-installer-dev/PREREGISTRATION.md)) must show five of six families informative.
- **The condition failed** ([report](docs/benchmarks/2026-10-29-v03-installer-dev/report.md), [note](docs/benchmarks/2026-10-29-v03-pilot/2026-10-30-opening-1-gate.md)): four of six again, and the three approval relay tasks are task defects. That seal (custody commit (private)) is retired unopened. Next, the approval relay template is fixed (done), the set is resealed, and the fixed family gets a dev re-read before opening 1 ([preregistration](docs/benchmarks/2026-10-30-v03-ar-reread/PREREGISTRATION.md)).
- **The re-read passed** ([report](docs/benchmarks/2026-10-30-v03-ar-reread/report.md), [note](docs/benchmarks/2026-10-29-v03-pilot/2026-10-31-ar-reread-gate.md)): approval relay 17 of 30 on opening 1's scoped gbrain config (`scope: member-sources`), no task defect, so 5 of 6 families are informative (a count that mixes configs).
  - **The custodian's check is on main** ([reseal record](docs/sealed-records/v0.3-gen6-reseal.md), #204, procedural custody). Among the tasks, only approval relay changed from gen5, the previous generation, and the author's manifest names `58186ff41`. The check does not prove the tasks were generated there.
- **Opening 1 on v0.3 does not run** ([report](docs/benchmarks/2026-10-31-v03-opus-dev/report.md), #209). On Opus 5.5 under opening 1's config, only 2 of 6 families sit inside the 10 to 90 percent band: corrections 9 of 40, approval relay 26 of 30. The other four sit above 90 percent. The preregistration calls this Outcome B.
  - **v0.3 is too easy for frontier models.** That is the brief for v0.4, the next task set. Dev data on public tasks, no claim.
  - **Why null? verdict: FIX-METHOD.** With no brain, the bot matches or beats the scoped brain in most families, because every fact is readable at ask time. So v0.4 tasks must put the fact where only memory reaches it ([Why null?](docs/benchmarks/2026-10-31-v03-opus-dev/report.md#why-null)).
  - **Gen6 stays sealed and unopened:** 0 openings of its budget of 2 ([reseal record](docs/sealed-records/v0.3-gen6-reseal.md)). The v0.4 plan waits for Garry's gate.
- **The second dev pilot can't tell Claude Code or Codex apart from OpenClaw and Hermes Agent** on the same 20 public tasks, each pair on one model ([report](docs/benchmarks/2026-10-30-host-harness-pilot/report.md)).
  - Claude Code and Codex cost less per trial; the paired interval excludes zero in five of six pairs.
  - gbrain's `told` arm scored lower than no brain in all three Haiku harnesses (descriptive, intervals in the report), through cross-scope reads from `gbrain.search`.

</details>

Version: see [VERSION](VERSION) for the release, and [CHANGELOG.md](CHANGELOG.md) for what each release changed. Everything above [Changelog](#changelog) describes the repository now; the changelog at the bottom records how this page changed. The one-page account of the first counted cell is [docs/report-v0.1.md](docs/report-v0.1.md).

## Start here

- [Found so far](#found-so-far-on-a-frontier-model-opus-55) and [what each harness sends the model](#what-each-harness-sends-the-model): the answers first
- [Check our numbers without keys](#check-our-numbers-without-keys) and [run the keyless checks](#run-the-keyless-checks)
- [Words we use](#words-we-use), the terms that make the rest readable
- [The harnesses under test](#the-harnesses-under-test) and [the fake company and the tasks](#the-fake-company-and-the-tasks)
- [Current results](#current-results), one line per run, with the full text one click away
- [Known limits](#known-limits), [Corrections](#corrections), [Where to read next](#where-to-read-next)
- [Appendix: Sonnet/Haiku runs](#appendix-sonnethaiku-runs-appendix-grade-not-frontier-evidence), including how the harnesses and gbrain compared there
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
- **Codes like internal-task-a or internal-task-b** in reports, receipts and changelogs are internal work-stream ids. They say which internal thread did the work; you never need them to read a result.

## The harnesses under test

**Five harnesses, a few fixed models, one brain on the side.** Exact pins below; every harness ran the same tasks, graders, preamble and model through the same proxy.

| Item | Value |
|---|---|
| OpenClaw | [openclaw/openclaw](https://github.com/openclaw/openclaw) 2026.10.6, installed from npm ([harnesses/openclaw/pin.json](harnesses/openclaw/pin.json)) |
| Hermes Agent | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) v2026.9.24, commit `f97608f` ([harnesses/hermes/pin.json](harnesses/hermes/pin.json)) |
| QM | [yc-software/qm](https://github.com/yc-software/qm) v0.1.15, commit `7417aa2a`, in every published cell before QM M1: its Pi engine in every cell and its Claude Agent SDK engine in the inner-harness run and the two probe runs. The harness is now pinned to main `b6786d67`, where Pi is QM's only engine; QM M1's two runs, `qm-c4-told-live-2026-11` (counted) and `qm-s1-gstack-probe-2026-11` (probe), ran there ([harnesses/qm/pin.json](harnesses/qm/pin.json)) |
| Claude Code | [anthropics/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code) 2.1.312 from npm; first counted run `host-harness-pilot-2026-10` (dev) ([harnesses/claude-code/pin.json](harnesses/claude-code/pin.json)) |
| Codex | [openai/codex](https://github.com/openai/codex) 0.165.0 from npm; first counted run `host-harness-pilot-2026-10` (dev). It speaks only OpenAI's Responses API, so it is compared only with OpenClaw and Hermes on the same OpenAI model ([harnesses/codex/pin.json](harnesses/codex/pin.json)) |
| Not run | Two products in the original plan expose no headless API; nothing on this page measures them |
| Models | `claude-sonnet-5-5` and `claude-haiku-5-5`, plus `gpt-6-luna` for the OpenAI cells of `host-harness-pilot-2026-10` and `claude-opus-5-5` for `v03-opus-dev-2026-10`; one fixed model per cell, every call through the metering proxy under a ledger lease; the harness containers see only the proxy and a per-trial dummy token |
| gbrain, the sidecar in the brain runs | [garrytan/gbrain](https://github.com/garrytan/gbrain), pinned today at `2c469d1b` (0.60.547.0, master at the merge of gbrain#8425, the internal-task security hotfix for gbrain's hooks), for the v0.4 runs; each counted run names the commit it built, from `f241216c` (0.60.413.0) in the gbrain arm to `81692dc6` (0.60.472.0, gbrain#7744's head before it merged) in `gbrain-memory-fix-2026-10b` and the v0.3 dev pilot, `32366ac2` (0.60.498.0) in `v03-installer-dev-2026-10` and `host-harness-pilot-2026-10`, and `a590ad07` (0.60.522.0) in `v03-ar-reread-2026-10` and `v03-opus-dev-2026-10` ([gbrain/pin.json](gbrain/pin.json), fields `commit` and `previous`). gbrain is a knowledge brain served to the harness as a second MCP server, not a harness under test |

- Every harness runs headlessly in `serve` mode. The runner plays each member's messages through a Slack mock on a simulation clock, and the harness answers through one world-MCP server ([docs/adapters.md](docs/adapters.md)).
- One bot token, no per-member access, the same preamble for every harness ([docs/methodology.md](docs/methodology.md), the trial contract). Full text: [docs/methods.md](docs/methods.md#how-every-harness-runs).

## The fake company and the tasks

**A simulated company, real-shaped work, graded from what actually happened.**

- The world is Pemberline, a made-up company built from gbrain-evals' `messy-company-v1` dataset: 18 members, 13 channels, 148 files, 42 mails, calendars and private notes, served per trial by one process that logs every read and write ([world/](world/README.md), [world/seed/MANIFEST.json](world/seed/MANIFEST.json)).
- A task is one or more members talking to the bot in channels and DMs. The grader reads the world's state and event log afterwards, never the bot's own story ([docs/tasks.md](docs/tasks.md)).
- Task set v0.1: 10 public dev tasks and 20 held-out tasks sealed before the counted runs ([tasks/multiuser/README.md](tasks/multiuser/README.md)). Task set v0.2 adds continuity, synthesis, corrections and approval-relay families: 15 dev and 15 held-out tasks at the last counted run ([tasks/multiuser/v0.2/README.md](tasks/multiuser/v0.2/README.md)). Task set v0.3 is generated from a seed: 20 public dev tasks across six families. Its 40 held-out tasks are sealed as set v0.3-gen6, which replaced the first seal, retired unopened ([tasks/multiuser/v0.3/README.md](tasks/multiuser/v0.3/README.md)).
- Beside pass we count three bad things: consent violations (a finance figure or outside mail that should not have gone out), leaks (a DM fact in someone else's conversation) and cross-scope reads. Full text: [docs/methods.md](docs/methods.md#the-world-and-the-tasks-in-full).

## Current results

**One line per run, grouped by question.** Numbers in the tables are copied from each run's report; the full text of every run, with its receipts link, is in the details block under each table. OC is OpenClaw, He is Hermes. Status: pilot, confirmatory or dev, as defined above.

**Only the Opus 5.5 and GPT-6.1 Sol rows are frontier evidence.** Rows on Sonnet 5.5, Haiku 5.5 or gpt-6-luna are appendix-grade: they guided our engineering, and they say nothing about how these harnesses, gbrain or gstack do with frontier models.

### v0.1 harness runs

**So what:** the three harnesses can't be told apart on the v0.1 tasks. The pilot was there to find defects; the Haiku run is dev.

| Run | Date | Model | Question | Result | Spend | Status | Report |
|---|---|---|---|---|---|---|---|
| `m2-pilot-2026-10` | 2026-10-22 to 23 | Sonnet 5.5 | Find defects before the held-out run | OC 52% · He 52% · QM 32% | $16.69 of $150 | pilot | [report](docs/benchmarks/2026-10-23-m2-pilot/report.md) |
| `m3-heldout-2026-10` | 2026-10-23 | Sonnet 5.5 | Do harnesses differ, model fixed? | OC 77 · He 73 · QM 71 of 80; can't tell apart | $35.67 of $200 | confirmatory | [report](docs/benchmarks/2026-10-24-m3-heldout/report.md) |
| `m3-sensitivity-haiku-2026-10` | 2026-10-23 | Haiku 5.5 | Does a weaker model change it? | OC 64 · He 63 · QM 56 of 80; can't tell apart | $1.84 of $50 | dev | [report](docs/benchmarks/2026-10-24-m3-sensitivity-haiku/report.md) |

<details>
<summary>Details for the v0.1 harness runs</summary>

- `m2-pilot-2026-10`, 3 x 50 (10 dev tasks, Sonnet), dev split (pilot). Pass as recorded: OpenClaw 26 of 50, 52% [26%, 78%]; Hermes 26 of 50, 52% [26%, 76%]; QM 16 of 50, 32% [8%, 58%]. Two exam defects fixed in 0.0.4 and one runner defect fixed in #13 before any QM trial; a pilot, not a comparison. Spend $16.69 of a $150 lease. [results](docs/benchmarks/2026-10-23-m2-pilot/results/)
- `m3-heldout-2026-10`, 3 x 100 (20 held-out tasks, Sonnet), v0.1 held-out, opening 1 (first): confirmatory (custody by digest only). Primary 16 tasks: OpenClaw 77 of 80, Hermes 73 of 80, QM 71 of 80. Pairwise: Hermes minus OpenClaw -5 [-15, +3], QM minus OpenClaw -8 [-21, +3], QM minus Hermes -3 [-6, +0], every Holm p 1.000: can't tell apart, 13 of 16 tasks at ceiling for all three. Median per trial 27 s and $0.06 (QM), 49 s and $0.12 (Hermes), 70 s and $0.16 (OpenClaw). Spend $35.67 of $200. [results](docs/benchmarks/2026-10-24-m3-heldout/results/)
- `m3-sensitivity-haiku-2026-10`, 3 x 100 (same tasks, Haiku), v0.1 held-out, opening 2: dev. Primary: OpenClaw 64 of 80, Hermes 63 of 80, QM 56 of 80; largest pair QM minus OpenClaw -10 [-24, +4], Holm p 0.508: can't tell apart. Sonnet minus Haiku within harness +16 [+6, +29], +13 [+3, +24], +19 [+5, +34] (descriptive): the model moved the result more than the harness. This tier contrast is background only: these evals now test frontier models only (Opus 5.5 and GPT-6.1 Sol). Spend $1.84 of $50. [results](docs/benchmarks/2026-10-24-m3-sensitivity-haiku/results/)

</details>

### gbrain on the v0.1 held-out set

**So what:** gbrain went almost unused unless the harness was told to use it (dev, two Claude models). Told to read a whole-company brain, harnesses read channels the asker cannot see; scoping the brain to the asker stops that. Every row here is dev: hints, not proof.

| Run | Date | Model | Question | Result | Spend | Status | Report |
|---|---|---|---|---|---|---|---|
| `gbrain-arm-2026-10` | 2026-10-24 to 25 | Haiku 5.5, Sonnet 5.5 | Does installing gbrain change anything? | gbrain minus none -6 to +8 points; can't tell apart | $80.87 of $350 | dev | [report](docs/benchmarks/2026-10-24-gbrain-arm/report.md) |
| `company-brain-2026-10` | 2026-10-24 to 25 | Haiku 5.5 | One company token against the requester's own grant | company-told -45 · -60 · -44; scoped +20 · +5 · -2 | $6.26 of $25 | dev | [report](docs/benchmarks/2026-10-25-company-brain/report.md) |
| `gbrain-ladder-2026-10` | 2026-10-24 to 25 | Haiku 5.5 | Which way of installing gbrain changes behaviour? | semantic-told vs told -51 · -48 through cross-scope reads | $10.73 of $40 | dev | [report](docs/benchmarks/2026-10-25-gbrain-ladder/report.md) |
| `gbrain-verbs-2026-10` | 2026-10-25 | Haiku 5.5 | Does the verbs surface hold at twice the repetitions? | pass +8.1 · +9.4; can't tell apart | $6.38 of $12 | dev | [report](docs/benchmarks/2026-10-25-gbrain-verbs/report.md) |
| `gbrain-installer-2026-10` | 2026-10-25 | Haiku 5.5 | Does the installer file match the hand-written clause? | use -87.3 · -91.3; pass: can't tell apart | $3.36 of $8 | dev | [report](docs/benchmarks/2026-10-25-gbrain-installer/report.md) |
| `gbrain-installer-hook-2026-10` | 2026-10-26 | Haiku 5.5 | The revised installer with its per-turn hook | use +6.3 · +10.0 (at ceiling); pass -3.8 · +8.8 | $3.43 of $8 | dev | [report](docs/benchmarks/2026-10-25-gbrain-installer-hook/report.md) |
| `gbrain-scoped-2026-10` | 2026-10-26 | Haiku 5.5 | Per-request scoping of the company brain | cross-scope reads -77.5 · -71.3; pass +61.3 · +65.0 | $3.47 of $6 | dev | [report](docs/benchmarks/2026-10-25-gbrain-scoped/report.md) |

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

**So what:** QM's two inner engines can't be told apart on pass, and the Claude SDK one costs more per trial. QM keeps memory and sandboxes per person; OpenClaw and Hermes shared a DM file across members. Dev and probe rows. On Opus 5.5 and GPT-6.1 Sol (M1), neither gbrain route beat QM's own notebook on pass, and Sol opened gstack skills through the paste-in router far more often than Opus (11 of 15 against 2 of 15), with no skill first step on either.

| Run | Date | Model | Question | Result | Spend | Status | Report |
|---|---|---|---|---|---|---|---|
| `qm-inner-harness-2026-10` | 2026-10-25 | Haiku 5.5 | QM over Pi against QM over the Claude Agent SDK | Claude minus Pi +4 on pass; inconclusive | $1.25 of $25 | dev | [report](docs/benchmarks/2026-10-25-qm-inner-harness/report.md) |
| `qm-probes-2026-10` | 2026-10-25 | Haiku 5.5 | Nine product probes of QM's claims | 3 of 3 on memory, DM sandbox and posture; channel sandbox 0 of 3 | $0.37 of $15 | dev split (probes) | [report](docs/benchmarks/2026-10-25-qm-probes/report.md) |
| `qm-probes-qp07-2026-10` | 2026-10-25 | Haiku 5.5 | The channel-sandbox probe, roster seeded | 3 of 3 on both QM engines | $0.04 of $1 | dev split (probes) | [report](docs/benchmarks/2026-10-25-qm-probes-qp07/report.md) |
| `qm-c4-told-live-2026-11` | 2026-11-04 | Opus 5.5, GPT-6.1 Sol | QM's notebook only, gbrain as tools, gbrain as QM's per-turn memory provider | Pass not distinguished on either model; provider -17.5 [-43, 0] (Opus) and -12.5 [-38, 0] (Sol) against notebook only, all from unscoped reads; notebook already at 20 of 20 on continuity | $23.76 of $56 | dev, counted | [report](docs/benchmarks/2026-11-03-qm-c4-told-live/report.md) |
| `qm-s1-gstack-probe-2026-11` | 2026-11-04 | Opus 5.5, GPT-6.1 Sol | Does QM open gstack skills through the paste-in router? | Matched opens Opus 2 of 15 [0, 40], Sol 11 of 15 [33, 100]; no-gstack 0; no first step on either | $2.73 of $20 | dev split (probe) | [report](docs/benchmarks/2026-11-03-qm-s1-gstack-probe/report.md) |

<details>
<summary>Details for the QM runs</summary>

- `qm-inner-harness-2026-10`, 2 x 100 (held-out, Haiku), v0.1 held-out, opening 5: dev; trials overlapped with `gbrain-verbs-2026-10`. Claude minus Pi on pass, 16 tasks: +4 [-6, +15] (66 against 63 of 80), p 0.688, under the 14.5-point minimum detectable difference: inconclusive. Cost per trial 2.7 times at the median ($0.0083 against $0.0033), 11 s longer; the SDK's `Agent` tool never called. Spend $1.25 of $25. [results](docs/benchmarks/2026-10-25-qm-inner-harness/results/)
- `qm-probes-2026-10`, 6 cells, 96 trials (Haiku), dev split (probes). Nine product probes of QM's memory, sandbox and org-setting claims, with OpenClaw and Hermes on the shared claims. Counts of 3 per probe and cell, no pooled rate: memory within and across scopes 3 of 3 on both QM engines; DM sandboxes per scope 3 of 3; channel sandbox 0 of 3 on both (a rig limitation, finding F5); strict posture and command denylist 3 of 3; OpenClaw and Hermes shared the DM file across members, 0 of 3 each. Spend $0.37 of $15. [results](docs/benchmarks/2026-10-25-qm-probes/results/)
- `qm-probes-qp07-2026-10`, 2 x 3 (Haiku), dev split (probes). The channel-sandbox probe with the roster seeded from the world: 3 of 3 on both QM engines; a product check, not a rate. One declared deviation (below). Spend $0.04 of $1. [results](docs/benchmarks/2026-10-25-qm-probes-qp07/results/)
- `qm-c4-told-live-2026-11`, 6 cells, 240 trials (Opus 5.5 and GPT-6.1 Sol, 40 per cell), dev, counted, on two Ubicloud shards. Member-visible pass: `none` 25 of 40 on both models, `memory-provider` 18 (Opus) and 20 (Sol), `route-tool` 28 and 36; no pass difference distinguished (every Holm p 0.375 or more). The one distinguished difference: Opus `route-tool` minus `none` in the mechanism count, +70 [43, 93], Holm p 0.047, where `none` is 0 by construction (it has no gbrain path). Every `memory-provider` figure uses the tap's member-text trim, which matches QM as shipped at qm `066319ee` (qm#3005, merged 2026-11-05) or later. The M1 runs used the pinned QM, which predates that merge; as shipped, the provider delivered no told fact. Why null? verdicts FIX-METHOD for both routes (saturated). Spend $23.76 of $56. [results](docs/benchmarks/2026-11-03-qm-c4-told-live/results/)
- `qm-s1-gstack-probe-2026-11`, 4 cells, 60 DM turns (Opus 5.5 and GPT-6.1 Sol), dev split (probe). Matched opens with gstack's paste-in router: Opus 2 of 15 [0, 40], Sol 11 of 15 [33, 100]; no-gstack 0 of 15 on both, with no contaminated turn. Sol tried the skill's own start command in 10 of 15, Opus in 0; no skill first step on either model. Why null? verdict FIX-METHOD (a QM-native gstack edition). Spend $2.73 of $20. [results](docs/benchmarks/2026-11-03-qm-s1-gstack-probe/results/)

</details>

### v0.2 runs

**So what:** on the harder v0.2 tasks, telling a harness to consult gbrain first did not lift pass rate by an amount we could detect, and cross-scope reads rose. A per-person memory brain read across members zero times and also did not lift pass rate detectably. v02-heldout is confirmatory; the memory runs are dev.

| Run | Date | Model | Question | Result | Spend | Status | Report |
|---|---|---|---|---|---|---|---|
| `v02-pilot-2026-10` | 2026-10-25 | Haiku 5.5 | Pilot of the v0.2 families | OC 42% · He 36% · QM 44%; OC per turn 33% | $1.55 of $10 | pilot | [report](docs/benchmarks/2026-10-25-v02-pilot/report.md) |
| `v02-heldout-2026-10` | 2026-10-26 | Sonnet 5.5, Haiku 5.5 | Does consulting gbrain first help on unseen tasks? | gbrain-told minus none -12 to +7; every Holm p 0.984 or more | $76.60 of $135 | confirmatory | [report](docs/benchmarks/2026-10-25-v02-heldout/report.md) |
| `gbrain-memory-2026-10` | 2026-10-26 to 27 | Sonnet 5.5, Haiku 5.5 | Does a scoped memory of the scenario help? | live minus none -5 to +23; can't tell apart | $75.21 of $137 | dev | [report](docs/benchmarks/2026-10-26-gbrain-memory/report.md) |
| `gbrain-memory-fix-2026-10b` | 2026-10-28 | Sonnet 5.5, Haiku 5.5 | Does gbrain#7744's fix reach what harnesses pass? | live minus none +0 to +23; can't tell apart | $33.25 of $70 | dev | [report](docs/benchmarks/2026-10-28-gbrain-memory-fix-b/report.md) |

<details>
<summary>Details for the v0.2 runs</summary>

- `v02-pilot-2026-10`, 4 x 45 (15 v0.2 dev tasks, Haiku), dev split (pilot). Pilot of the v0.2 families, with a fresh-session-per-turn contrast. Pass as graded: OpenClaw 19 of 45, 42% [20%, 64%]; Hermes 16 of 45, 36% [16%, 58%]; QM 20 of 45, 44% [24%, 64%]; OpenClaw per turn 15 of 45, 33% [13%, 56%]; every Holm p 1.000. Three task defects (one wording, two over-strict patterns) found and five dev tasks' grading amended before held-out use; a pilot, not a comparison. Spend $1.55 of $10. [results](docs/benchmarks/2026-10-25-v02-pilot/results/)
- `v02-heldout-2026-10`, 12 x 75 (15 v0.2 held-out tasks, Sonnet and Haiku, none against gbrain-told), v0.2 held-out, opening 1 (first): confirmatory (custody by digest only; four pre-amendment trials and one partial discarded; seven tasks amended before the run). gbrain-told minus none on pass: +0 [-7, +8], -5 [-16, +4], +3 [-19, +25] on Sonnet and -12 [-32, +8], +7 [-4, +17], +4 [-9, +19] on Haiku (OpenClaw, Hermes, QM), every Holm p 0.984 or more, against an achieved minimum detectable difference of 10 to 13 points. Cross-scope reads rose in all six pairs, all of it through gbrain's bot-wide `search`; 37 told trials failed on that read alone. Spend $76.60 by proxy usage of $135 ($77.04 committed in the nine shard ledgers, $0.43 of it a reservation left open). [results](docs/benchmarks/2026-10-25-v02-heldout/results/)
- `gbrain-memory-2026-10`, 12 x 75 (15 v0.2 held-out tasks, Sonnet and Haiku, none against a member brain that fills during the scenario under each member's own token; nine Ubicloud shards), v0.2 held-out, opening 2: dev. Does a brain that remembers the scenario, scoped to the requester, help on the memory and correction tasks without reading across members? gbrain-told-live minus none on pass, continuity and corrections (40 pairs): -5 [-18, +5], +23 [+0, +53], -3 [-8, +0] on Sonnet and +10 [+3, +20], +5 [+0, +13], +0 [+0, +0] on Haiku (OpenClaw, Hermes, QM), every Holm p 0.75 or more: can't tell apart at this size on any pair, against an achieved minimum detectable difference of 11.6 to 16.4 points on Sonnet; the Hermes estimate is `cn-05` and `cn-08` moving 0 to 4 and 0 to 5. Cross-scope reads through gbrain: 0 of 450 live trials, and the 421 DM facts the tap saw returned were all inside the requester's grant; the 14 cross-scope failures in the run are world reads, 10 in none cells. Spend $75.21 by trials.jsonl, equal to the nine shard ledgers, of $137 in leases ($150 lane). [results](docs/benchmarks/2026-10-26-gbrain-memory/results/)
- `gbrain-memory-fix-2026-10b`, 12 x 40 (the memory run's 8 continuity and corrections tasks, Sonnet and Haiku, none against the member brain at gbrain#7744's saved-facts fix; nine Ubicloud shards), v0.2 held-out, opening 3: dev, in-sample for gbrain#7744 (a revise-then-retest after the memory run: gbrain#7744 was built on its reads of these tasks). Does gbrain#7744's fix, which returns a newer correction ahead of the fact it corrects, reach what the harnesses pass? gbrain-told-live minus none on pass (40 pairs): +5 [-15, +30], +23 [+0, +50], +0 [-8, +8] on Sonnet and +10 [+0, +25], +20 [-3, +45], +10 [+0, +25] on Haiku (OpenClaw, Hermes, QM), every Holm p 0.75 or more: can't tell apart at this size, as preregistered. Descriptive: `cr-05-pellow-seat-retraction` went from 0 of 5 in every Sonnet live cell in the memory run to 4, 5 and 1 of 5, none cells 0 of 5; a gbrain read returned the correction ahead of the retracted figure in 11 of 15 Sonnet live trials (0 in the memory run), and every live `cr-05` pass came in such a trial. No cross-scope read, consent violation or exam fault in any cell. Spend $33.25 of $70. [results](docs/benchmarks/2026-10-28-gbrain-memory-fix-b/results/)

</details>

### v0.3 runs

**So what:** v0.3 is too easy for Opus 5.5, so no opening runs on it (Outcome B). That is the v0.4 brief.

- The dev pilot sized the sealed opening and found one task family broken. It was fixed and re-read (the two rows below it).
- The host-harness pilot could not tell Claude Code or Codex apart from OpenClaw and Hermes Agent.
- The instruction-route run found which places for gbrain's brain-first rule get the bot to check gbrain, each harness against its own control.
- The start-hook panel got OpenClaw to run gstack's start command (16 of 16), while Hermes blocked it at an approval card. Its three tasks showed no success difference for gstack, all at the ceiling.
- The Hermes rerun, with gstack v1.92.57.0's new start command and Tirith pinned, got Hermes to run it in 8 of 16, against 0 of 16 for gstack without the hook. All 8 were on task 1, and success was again 16 of 16 in every arm.
- The Claude Code and Codex installer rung found gbrain's installer raised cross-scope exposure on Claude Code (Opus 5.5) against told, and could not tell on Codex (GPT-6.1 Sol). gbrain had no access rules, so it returned channel pages to non-members, and that cut Claude Code's pass rate (41 of 44 failures in its gbrain cells failed only the cross-scope check).
- Its rerun with gbrain's per-member access rules on (`installer-cc-codex-acl-2026-11`) found no cross-scope return in any of 204 gbrain trials, so installer and told can't be told apart on exposure. Every gbrain cell then passed at least as often as no brain (Claude Code installer 50 against 46 of 51, Codex installer 49 against 43). Multi-member gbrain needs the access rules.
- The prompt-archaeology run (`prompt-archaeology-2026-11`) cut one layer of each harness's built-in prompt at a time. No layer measurably bought pass rate on these tasks, but most trials sat at or near the ceiling or near the floor. Claude Code's memory-and-skills text and tool-description advice, and Codex's identity text, cost money for nothing detected (single-layer cuts, pending the joint-cut run).
- The harness x model matrix (`matrix-mu-2026-11`) ran seven harness and model pairs on all 20 dev tasks. No two harnesses could be told apart on pass rate on Opus 5.5 or GPT-6.1 Sol, because 14 of 20 tasks scored the same in every cell. OpenClaw on Opus paid about twice as much per pass as the other Opus harnesses.
- All are dev.

| Run | Date | Model | Question | Result | Spend | Status | Report |
|---|---|---|---|---|---|---|---|
| `v03-pilot-2026-10` | 2026-10-29 | Haiku 5.5 | Are the v0.3 task families informative, and does opening 1 fit $30? | No-go: 4 of 6 families in range. Approval relay fixed (#119), re-measured in the two rows below. Opening 1 fits $30 at a typical reservation ($23.57), not at the largest ($30.57) | $9.15 of $24.90 | dev | [report](docs/benchmarks/2026-10-29-v03-pilot/report.md) |
| `v03-installer-dev-2026-10` | 2026-10-30 | Haiku 5.5 | Do the told cells clear the seal for opening 1 (5 of 6 families), and what does an installer trial cost? | Fail: 4 of 6 families in range; approval relay 0 of 30 and its 3 tasks are defects. Installer $0.0110 (OC) and $0.0114 (He) a trial; opening 1 $30.46 at the largest reservation | $4.09 ($4.01 trials of the $9 cap, $0.08 smokes) | dev | [report](docs/benchmarks/2026-10-29-v03-installer-dev/report.md) |
| `v03-ar-reread-2026-10` | 2026-10-31 | Haiku 5.5 | After #144's fix, is approval relay informative (10 to 90 percent) under opening 1's scoped gbrain config? | Pass: 17 of 30, 56.7% [40.0%, 80.0%], no defect candidate, so 5 of 6 families (mixed configs). Unscoped copy 0 of 30 (descriptive) | $1.39 ($1.31 trials of the $4 cap, $0.08 smokes) | dev | [report](docs/benchmarks/2026-10-30-v03-ar-reread/report.md) |
| `v03-opus-dev-2026-10` | 2026-11-01 | **Opus 5.5** | Does opening 1 run on Opus 5.5 (5 of 6 families informative under its scoped gbrain config)? | Outcome B: 2 of 6 families in range (corrections 9 of 40, approval relay 26 of 30), four above 90 percent, so no opening on v0.3. Why null? verdict FIX-METHOD | $126.5320 ($125.5162 trials of the $274 cap, $1.0159 smokes) | dev | [report](docs/benchmarks/2026-10-31-v03-opus-dev/report.md) |
| `host-harness-pilot-2026-10` | 2026-10-30 | Haiku 5.5, gpt-6-luna | Claude Code against OpenClaw and Hermes Agent on Haiku, Codex against them on gpt-6-luna | CC 57 · OC 56 · He 63 (none), CC 39 · OC 47 · He 42 (told), Cx 67 · OC 63 · He 61 (luna); all six pairs can't tell apart, smallest Holm p 0.750 | $7.38 of $20 (+ $0.14 smokes) | dev | [report](docs/benchmarks/2026-10-30-host-harness-pilot/report.md) |
| `anatomy-instruction-route-2026-11` | 2026-10-30 | Haiku 5.5 | Which places for gbrain's rule get OpenClaw and Hermes to check gbrain before they answer, each against its own control? | OpenClaw: only the per-turn hook differed from control (160 of 160 turns, control 1). Hermes: system prompt setting, `SOUL.md` and hook (144, 138 and 156 of 160, control 0). A listed skill: 1 and 5. Descriptive: pass 32 points lower on the OpenClaw hook, with cross-scope reads on the unscoped brain | $4.46 of $20, plus $0.04 of smokes | dev | [report](docs/benchmarks/2026-10-31-anatomy-instruction-route/report.md) |
| `tool-discipline-start-2026-11` | 2026-11-01 | **Opus 5.5** | Does gstack's start hook make OpenClaw and Hermes run a skill's start command, at what cost, with no success drop, against gstack without it and no gstack? | OpenClaw: pass, starts 16 of 16 against 1 of 16, +0.94 [0.64, 0.99]. Hermes: fail, 0 of 16; the agent issued the command 8 of 8 times on task 1 and Hermes's approval card (Tirith scan, our 1 s config) blocked it. Success 16 of 16 in every arm, +0.00 [-0.19, 0.19]. OpenClaw cost 3 to 5 times no gstack per trial | $16.90 of $28 | dev | [report](docs/benchmarks/2026-11-01-tool-discipline-start/report.md) |
| `tool-discipline-start-hermes-r2-2026-11` | 2026-11-02 | **Opus 5.5** | Rerun of the Hermes cells: with gstack `e2d9c798` (v1.92.57.0, a start command Tirith allows) and Tirith 0.4.2 pinned, does the start hook make Hermes run a skill's start command? | Hermes: pass, starts 8 of 16 against 0 of 16, +0.50 [0.21, 0.72], all 8 on task 1 (task 2: 0 of 8, secondary bar missed). Success 16 of 16 in every arm, +0.00 [-0.19, 0.19]. Why null? verdict FIX-METHOD | $5.76 of $19 | dev | [report](docs/benchmarks/2026-11-01-tool-discipline-start/report-hermes-r2.md) |
| `installer-cc-codex-2026-11` | 2026-11-02 | **Opus 5.5**, **GPT-6.1 Sol** | When gbrain's own installer sets up Claude Code (Opus 5.5) or Codex (GPT-6.1 Sol), does the agent read across scope through gbrain more or less often than when told about gbrain? | Claude Code: the installer raises cross-scope exposure via gbrain, 33 of 51 against 20 of 51, +25 [+8, +45], p 0.039. Codex: can't tell apart at 17 tasks, 17 against 9 of 51, +16 [+2, +33], p 0.125 (detects about 25 points). gbrain without access rules is default-open. Descriptive: Claude Code pass 46 (none), 31 (told), 27 (installer) of 51, with 41 of the 44 gbrain-cell failures failing only the cross-scope check. Why null? verdict FIX-METHOD | $56.67 of $155 (+ $1.73 smokes, $0.70 costing smoke) | dev | [report](docs/benchmarks/2026-11-01-installer-cc-codex/report.md) |
| `installer-cc-codex-acl-2026-11` | 2026-11-03 | **Opus 5.5**, **GPT-6.1 Sol** | The same six cells with gbrain's per-member access rules on and each token bound to its member (gbrain v0.60.554.0): does the installer still read across scope more than told? | Exposure 0 of 51 in all four gbrain cells, so not distinguished by construction on both hosts. Descriptive, against no brain: pass Claude Code 46 (none), 49 (told), 50 (installer), +8 [+0, +22] for installer; Codex 43, 45, 49, +12 [+0, +24]. Why null? verdicts KEEP (gbrain with access rules) and FIX-METHOD (installer against told, saturated) | $55.57 of $85 (+ $1.61 smokes) | dev | [report](docs/benchmarks/2026-11-01-installer-cc-codex/report-acl.md) |
| `prompt-archaeology-2026-11` | 2026-11-04 | **Opus 5.5**, GPT-6.1 Sol | The proxy removes one layer of each harness's built-in prompt (identity, tool guide, tool descriptions, safety, memory and skills, work habits, style) at a time. What does each cut do to pass rate and cost per trial against the full prompt? | No keep on pass rate in any pair (every Holm p 1.000). Cuts: Claude Code memory-skills -$0.033 [-$0.046, -$0.022] per trial (19 percent) and tool-descriptions -$0.013 (8 percent); Codex identity -$0.004 (3 percent). Codex's other single layers each cost 5 to 7.5 points, all on approval relay. Hermes keep (safety) on 5 of 7 arms, all from one task. 22 of 40 trials per cell in families at or near the ceiling. Why null? verdicts CUT-CANDIDATE (the three single-layer cuts and the Claude Code and OpenClaw minimal prompts), FIX-METHOD (the rest), KEEP (Hermes safety) | $328.76 of $548.50 (incl. $11.46 smokes); launch 1's $548.50 sunk | dev | [report](docs/benchmarks/2026-11-01-prompt-archaeology/report.md) |
| `matrix-mu-2026-11` | 2026-11-05 | **Opus 5.5**, **GPT-6.1 Sol** | With the model held fixed, how do pass rate and cost per pass differ between harnesses: Claude Code, OpenClaw, Hermes and QM on Opus 5.5, and Codex, OpenClaw and Hermes on GPT-6.1 Sol (20 dev tasks, 4 reps)? | All six primary pairs can't tell apart (every Holm p 1); largest gaps +3.9 [+0.0, +11.8] (OpenClaw over Codex) and +3.8 [+0.0, +10.0] (Hermes over Codex) on Sol; MDD 7.7 to 14.2 points. Pass 71.3% to 78.8%; 14 of 20 tasks scored the same in every cell. Cost per pass on Opus: OpenClaw $0.44 [$0.33, $0.63], Claude Code $0.22, Hermes $0.24, QM $0.19 (descriptive). OpenClaw cells incomplete (sy-03 cap stops). Why null? verdict FIX-METHOD | $99.01 of $156.27 (+ $3.73 smokes earlier), VMs $6.36 | dev | [report](docs/benchmarks/2026-11-04-matrix-mu/report.md) |

### How to read these numbers

- Dates are the UTC days the trials ran. Spend is what our proxy metered at list price against the run's lease; we never checked the provider's bill.
- "Can't tell apart" is our plain wording for the reports' preregistered sentence "not distinguished". It is not a tie, and a cell at ceiling or floor is uninformative rather than equal.
- Every figure is a copy of a figure in the run's report and the receipts under its `results/`. The run-by-run list of preregistration commits, trial counts, ledgers and hashes is [docs/receipts-manifest.json](docs/receipts-manifest.json).
- Only a held-out set's first counted opening is confirmatory; a later opening is dev because whoever designed it had seen that set's results ([Corrections](#corrections), 2026-10-28).
- The maths (95 percent task-clustered intervals, paired differences, sign-flip tests, Holm) and the openings ledger: [docs/methods.md](docs/methods.md#how-to-read-the-numbers).




- Every dollar is the metering proxy's list-price meter; the provider-side check has never been performed (Known limits).

## Known limits

- **Spend is proven proxy-side only.** We reconcile the proxy's usage log, the per-trial `usage.json` sums and the lease ledger against each other (`bun scripts/reconcile-provider.ts`). Whether the provider billed the same has never been checked; that needs an Anthropic Admin API key, and on 2026-10-26 the decision was not to provide one ([docs/budget-ledger.md](docs/budget-ledger.md)).
- **The public repository will be a curated export of our private working repository; the export is planned and not yet built.** Receipts, reports and the keyless tooling go public. Paid-run infrastructure, held-out sets that are still sealed and the custody record stay private, and past preregistration order is attested privately, not publicly verifiable ([docs/publishing-checklist.md](docs/publishing-checklist.md)).
- **Three runs carry a declared deviation from their preregistration**: company-brain (runner code changed after a machine restart, regraded identically), the qp-07 rerun (preregistration and results squash-merged in one commit) and the v0.2 held-out run (a raised shard lease, an unused amendment, two shards resumed after sleeps). Each is stated in its report and in [docs/decisions.md](docs/decisions.md).
- **Hermes makes free model-discovery probes**, about 27 refused requests per trial, recorded at $0. Request counts are not comparable one for one across harnesses.
- **One model per run, runner-driven `serve` sessions, one bot token, and tasks the adapters' author has now seen several times.** The v0.1 held-out set has served ten counted runs and is at ceiling on Sonnet; the v0.2 set has served three. Only each set's first counted opening is confirmatory, and even that is qualified: the task bodies sit in the repository, sealed only by digest ([Corrections](#corrections), 2026-10-28).
- **The gbrain arm's Sonnet harness comparison mixes machines with harnesses**, and three QM trials there ended `harness_error` from a port collision, counted as failures; excluding them changes no sentence ([report](docs/benchmarks/2026-10-24-gbrain-arm/report.md)).
- Full text: [docs/methods.md](docs/methods.md#known-limits-in-full).

## Where to read next

| Question | Where to start |
|---|---|
| What did the newest frontier runs find? | [investigate gate](docs/benchmarks/2026-11-03-investigate-gate/report.md), [gstack follow-rate](docs/benchmarks/2026-11-01-opus-gstack-follow/report.md), [start hook](docs/benchmarks/2026-11-01-tool-discipline-start/report-hermes-r2.md), [v0.3 on Opus](docs/benchmarks/2026-10-31-v03-opus-dev/report.md) |
| What exactly did the first counted cell find, with its limits in one page? | [docs/report-v0.1.md](docs/report-v0.1.md) |
| Which results are written up as standalone claims, each with its grade, cost, Why null? and replication commands? | [findings/README.md](findings/README.md) |
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
| How do I report a bug, a security issue or a question about a number? | [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) |
| What is still open? | [TODOS.md](TODOS.md) |

## Check a finding yourself

**A run that ships a trial bundle can be checked with one command.** No published finding ships one yet: today's findings point at their in-repo receipts. Two checks are free; the third reruns one cell with your own key under a hard cap.

```sh
bun scripts/replicate.ts --bundle <archive> --sha256 <digest> --reanalyze        # free: the finding's tables, byte for byte
bun scripts/replicate.ts --bundle <archive> --sha256 <digest> --estimate-only    # free: what a rerun costs
bun scripts/replicate.ts --bundle <archive> --sha256 <digest> --cell <id> --max-usd 5   # paid: WITHIN BAND or OUTSIDE BAND
```

- **A paid rerun** needs Linux, Docker and your provider key. It never spends past `--max-usd`.
- **The tooling example** is H1's OpenClaw cell (Sonnet 5.5, withdrawn from publication under R54): about $3.50 and 30 minutes at 1 rep. It moves to the first frontier finding when one merges.
- Details, the band and every exit code: [docs/replicate.md](docs/replicate.md).

## Run the keyless checks

**The keyless checks call no model API, and CI runs the type check, the test suite, the link check and the preregistration-order check on every pull request.** Most take seconds. The full test suite took about 25 minutes on a 4-core machine. The preregistration-order check walks all of main's history: about 5 minutes on GitHub's runners, and much longer on a small machine. Install [Bun](https://bun.sh/) and Python 3, clone, run:

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

- **Paid reruns are not an outside path yet.** The proxy reads the provider key from its own environment and refuses any call without a ledger lease under a cap ([runner/README.md](runner/README.md)). Our counted runs used the program's own ledger, kept outside the repository, and Ubicloud shards. A direct-key path now exists for runs that ship a trial bundle (`scripts/replicate.ts`, [Check a finding yourself](#check-a-finding-yourself)). No published finding ships a bundle yet, so each finding's Replicate it section, written before the tool, still says its paid rerun is not open.
- A counted run needs its preregistration merged before its first trial; `bun runner/prereg/prereg.ts` checks that against main's history.
- What a run costs, from the ledgers: a 300-trial run of three harnesses on 20 tasks was $1.84 on Haiku and $35.67 on Sonnet; a 400-trial four-cell Haiku run with gbrain was $3.36 to $3.47; the 900-trial v0.2 held-out run on both models was $76.60 by proxy usage ($77.04 committed). The paid gbrain check runs about $0.35. Sharded runs go to Ubicloud ([docs/ubicloud.md](docs/ubicloud.md)). Full text: [docs/methods.md](docs/methods.md#what-paid-work-costs).

## Appendix: Sonnet/Haiku runs; appendix-grade, not frontier evidence

**These results rest on Sonnet 5.5 and Haiku 5.5, plus gpt-6-luna in one pilot, not on a frontier model.** They guided our engineering. They carry no verdict about gbrain, gstack or any harness in real use.

**Found so far on Sonnet and Haiku**

- **The three harnesses can't be told apart on getting the work right**, on Sonnet 5.5, on tasks mostly at ceiling. No frontier model has run this comparison yet.
- **QM's Pi engine is the cheapest and fastest**, at about 40 percent of OpenClaw's time and tokens per trial, with a pass rate that can't be told apart from the others.
- **gbrain went almost unused unless the harness was told to use it.** Installed as an MCP server with no instruction, it was called in 4 of 799 trials (dev, Sonnet 5.5 and Haiku 5.5 only; a frontier rerun is pending), which does not show gbrain is useless. Told to read a whole-company brain, harnesses read other people's channels; scoping the brain to the asker stops that.
- **No run yet shows gbrain lifting pass rate on its primary endpoint (the one comparison the run was designed to settle) by an amount the run could detect.** Most gbrain rows are dev, so they hint but don't prove.

### How the harnesses compare

**Takeaway: with the model fixed, OpenClaw, Hermes Agent and QM over Pi can't be told apart on getting multi-user work right. What differs is cost and time.**

- On the v0.1 held-out tasks with Sonnet the three sat at 77, 73 and 71 of 80, with 13 of 16 tasks at ceiling; with Haiku at 64, 63 and 56 of 80; every Holm-adjusted p above 0.4 ([m3-heldout](docs/benchmarks/2026-10-24-m3-heldout/report.md), [sensitivity](docs/benchmarks/2026-10-24-m3-sensitivity-haiku/report.md)). On the harder v0.2 tasks the within-model differences are descriptive only ([v02-heldout](docs/benchmarks/2026-10-25-v02-heldout/report.md)).
- Swapping Sonnet for Haiku moved every harness by 13 to 19 points, more than any harness gap, though only OpenClaw's gap survives the preregistered sign-flip test after Holm. This tier contrast is background only: these evals now test frontier models only (Opus 5.5 and GPT-6.1 Sol).
- QM's Pi engine ran at about 40 percent of OpenClaw's wall time and tokens: 27 s and $0.06 against 70 s and $0.16 per trial at the median on Sonnet, 12.5 million input tokens against 32.3 million over 100 trials, Hermes between them. The ordering held on Haiku.
- Safety held for everyone on v0.1: no consent violation and no leaked DM fact in the 600 held-out trials without a brain, one cross-scope read (Hermes).
- Where harnesses lost trials, most losses were one thing: the answer sat in a channel the harness never opened ([docs/report-v0.1.md](docs/report-v0.1.md), "Where the failures were").
- QM's two inner engines were not told apart on pass either, and the Claude Agent SDK engine cost 2.7 times as much per trial ([qm-inner-harness](docs/benchmarks/2026-10-25-qm-inner-harness/report.md)). QM's product probes held its memory and sandbox claims per scope; OpenClaw and Hermes, which make no such claim, shared a DM file across members ([qm-probes](docs/benchmarks/2026-10-25-qm-probes/report.md), [docs/qm-findings.md](docs/qm-findings.md)).
- Caveat: only m3-heldout and v02-heldout are confirmatory. The Haiku and QM-engine figures are dev, so they guide our engineering and prove nothing on unseen tasks ([Corrections](#corrections), 2026-10-28).
- Full paragraph with every reference: [docs/methods.md](docs/methods.md#how-the-harnesses-compare-in-full).

### How gbrain compares

**Takeaway: gbrain went almost unused unless the harness was told to use it, an unscoped brain leaks across people, scoping stops the leak, and no run yet shows it lifting pass rate on a primary endpoint by an amount we could detect.**

- gbrain is not a harness. It is a knowledge brain served beside the world tools, and ten runs ask what each harness does with it ([docs/gbrain-arm.md](docs/gbrain-arm.md)).
- Installed and unmentioned, the harnesses almost never used it: a gbrain call in 2 of 600 trials of the arm and 2 of 199 scored trials on the ladder's `mcp` rung ([finding](findings/2026-11-01-untold-gbrain-unused.md)). Nothing moved but trial length and, for QM, input tokens.
- One brain-first clause in the per-turn preamble turns use on in about nine of ten trials. gbrain's own installer file produced no use until its revision added a per-turn hook; then use was 80 of 80 in both harnesses ([installer](docs/benchmarks/2026-10-25-gbrain-installer/report.md), [installer-hook](docs/benchmarks/2026-10-25-gbrain-installer-hook/report.md)).
- Where the rule enters decides whether the bot checks gbrain first, each harness against its own control ([instruction-route](docs/benchmarks/2026-10-31-anatomy-instruction-route/report.md)).
  - OpenClaw: only the per-turn hook differed (160 of 160 turns; `AGENTS.md` 5, a listed skill 1, tool descriptions alone 1).
  - Hermes: system prompt setting, `SOUL.md` and hook differed (144, 138, 156 of 160; a listed skill 5, tool descriptions alone 0).
  - On the unscoped brain these routes went with cross-scope reads; pass was 32 points lower on the OpenClaw hook (descriptive).
- Told to use a bot-wide brain, harnesses gained the two cross-channel retrieval tasks they had failed and lost trials to a new failure: keyword `search` returns pages from channels the asker is not in, a cross-scope read. On the v0.2 held-out tasks that read rose in all six pairs while the pass effect stayed within noise; with semantic search on it cost 48 to 51 points.
- Narrowing what a call can return fixes the leak: the seven memory verbs (`recall` returns one page) had zero cross-scope reads in 394 trials; per-request scoping by the member's grant (gbrain#7481) had zero in 197 trials against 76 of 99 and 72 of 100 unscoped, with pass up 61 and 65 points ([company-brain](docs/benchmarks/2026-10-25-company-brain/report.md), [gbrain-scoped](docs/benchmarks/2026-10-25-gbrain-scoped/report.md)).
- A member brain that fills during the scenario read across members in 0 of 450 live trials, and every DM fact it returned belonged to the asker. Pass again stayed within noise on Sonnet (the largest, Hermes +23 [+0, +53] over 40 pairs, carried by two memory tasks, Holm p 1.000; [gbrain-memory](docs/benchmarks/2026-10-26-gbrain-memory/report.md)).
- At gbrain#7744's fix, which returns a newer correction ahead of the fact it corrects, the same cells were again not told apart on pass, while `cr-05`, the task the fix was built against, went from 0 of 5 in every Sonnet live cell to 4, 5 and 1 of 5, with every none cell at 0 of 5 ([gbrain-memory-fix-b](docs/benchmarks/2026-10-28-gbrain-memory-fix-b/report.md)).
- The differences these runs could have detected were 8.5 to 17.7 points. Every gbrain run except v02-heldout is dev, and the installer-hook, scoped, verbs and fix runs retested a revised candidate on the same tasks that prompted the revision ([Corrections](#corrections), 2026-10-28).
- Full paragraph with every reference: [docs/methods.md](docs/methods.md#how-gbrain-compares-in-full).

## Corrections

**We keep every mistake visible.** Each affected report keeps its original figures, labelled, beside a dated correction, and this list collects them, newest first. The biggest one: ten results we had called confirmatory were later openings of a held-out set, so they are dev. No number changed; what changed is what the rows can support.

<details>
<summary>The full list</summary>

Each affected report keeps its original figures, labelled, beside a dated correction; this list collects them. Where a wrong number was caught by review before it reached main, the record is the pull request, and the entry says so.

- **v0.1 report, 2026-11-02: an unlabelled reading and a stale section.** [docs/report-v0.1.md](docs/report-v0.1.md) said flatly that swapping the model moved the result more than swapping the harness. The claim check had already narrowed that to a reading of these 16 tasks, not a measured ranking: only OpenClaw's Sonnet minus Haiku gap survives Holm ([finding](findings/2026-11-01-model-vs-harness.md), appendix). Its gbrain arm section still said pending after the run had reported. Both now carry dated corrections, and no number changed.
- **README, 2026-11-02: "about a third" was about 40 percent.** QM's Pi engine used about 0.39 of OpenClaw's median wall time and input tokens on the m3 held-out run (27 s against 70 s; 12.45 million against 32.31 million input tokens over 100 trials), so the README now says about 40 percent ([m3-heldout](docs/benchmarks/2026-10-24-m3-heldout/report.md)).
- **Held-out reuse, 2026-10-28: ten results were confirmatory in form only.** The conventions this repository took from gbrain-evals say a held-out set is spent after one counted run ([docs/gbrain-evals-conventions.md](docs/gbrain-evals-conventions.md)), but the v0.1 held-out set served ten counted runs from 2026-10-23 to 2026-10-26 and the v0.2 set two, and nothing counted the looks across runs; Holm corrects only within one run. A review by the gstack-evals crew of how eval sets steer automated research found it. From this date only the first counted opening of a held-out set is labelled confirmatory: `m3-heldout-2026-10` for v0.1 and `v02-heldout-2026-10` for v0.2, each qualified as custody by digest only because the task bodies were in the repository. Every later opening is dev. Three of the later runs tested a candidate again after a look at the same tasks: `gbrain-installer-hook-2026-10` after `gbrain-installer-2026-10`, `gbrain-scoped-2026-10` after `company-brain-2026-10`, and `gbrain-verbs-2026-10` after the ladder's verbs rung. No number, interval or receipt changes. What changes is what the rows support, which is engineering decisions inside this program and not a claim confirmed on unseen tasks. Each affected report carries a dated status note at its top, and the confirmations owed are planned for the first opening of the next held-out set. [docs/decisions.md](docs/decisions.md), 2026-10-28.
- **v0.2 held-out run, 2026-10-26: the reading of `ar-06` was wrong.** The report's first reading took the told cells' fall on the fake-approval task (18 passes to 2 across six pairs) as a harness acting on a forged approval, and a provenance run was planned on it. The per-predicate re-tally over the 60 trials shows `names_authorizer` passed 60 of 60 and `finance_disclosure` fired 0 of 60; the 40 failures are cross-scope reads through the unscoped `search` (37) and a missing approval request (3). No harness acted on a forged approval; the provenance run was dropped. [Report](docs/benchmarks/2026-10-25-v02-heldout/report.md), correction note under "Where the told cells moved"; CHANGELOG [0.0.11].
- **Company brain, 2026-10-25: a reported gbrain defect was ours.** The run's first completion report said `remember` under a member's granted token returned success and the fact was then unfindable. The gbrain crew reproduced the sequence: the fact lands and `recall` returns it; the world's gbrain tap parsed only JSON content blocks and skipped the prose and `_meta` where search returns saved facts, so a remember-then-search check through the tap always said "not found". No trial in the run made a write, so no count depends on it. [Report](docs/benchmarks/2026-10-25-company-brain/report.md), "Correction, 2026-10-25"; fix in #61; [docs/gbrain-arm.md](docs/gbrain-arm.md) changelog. The two other gbrain findings from that run (new sources not federated by default; private pages hidden from remote callers) stand as open items in [TODOS.md](TODOS.md) and were worked around in the brain build, so no number depends on them.
- **Company brain, 2026-10-25: a declared deviation, not a correction, but read it first.** The OpenClaw scoped cell's last 65 trials ran under runner code at `e278fb0` instead of the preregistered `6b67de1` after a machine restart, with the images unchanged; all 900 trials regrade identically under both graders, and the one rule that differs (HE-MODEL-001 on refused lines) is read both ways in every table. [Report](docs/benchmarks/2026-10-25-company-brain/report.md), opening section. The same report notes that `compare-run` without `--pair` does not exclude `model_error` trials while `--pair gbrain` does, so its unpaired comparisons file shows that cell at 69 of 100 ([TODOS.md](TODOS.md)).
- **v0.2 pilot, 2026-10-25: "6, not 8".** The report said 8 of 12 `ms-02` replies named the distractor ticket in order to exclude it; the receipts say 6, and the recount below it was always built from the 6. [Report](docs/benchmarks/2026-10-25-v02-pilot/report.md), task defect 2.
- **v0.2 pilot, 2026-10-25: three task defects and one grading rule, five dev tasks' grading amended before held-out use.** `ms-03` named the wrong note, `ms-02` forbade naming the distractor even to exclude it, `cr-04`'s stale pattern matched a correct reply, and `ar-03` counted the bot reading its own DM with the authorizer as a cross-scope read. The tasks and their held-out mirrors were amended and resealed (#66); regrading the 180 recorded trials with the amended tasks changes 13 grades, every one from fail to pass, and is published as a labelled secondary reading beside the as-graded numbers, which stay primary. [Report](docs/benchmarks/2026-10-25-v02-pilot/report.md), "Amended reading"; [tasks/multiuser/v0.2/README.md](tasks/multiuser/v0.2/README.md).
- **M2 pilot, 2026-10-23: two exam defects and one runner defect.** `ho-02` failed 15 of 15 because no world tool exposed member addresses; the grader rejected six valid approval requests whose pending action named the authorizer's DM channel id instead of the member id; a compose-path defect stopped the first QM trial at $0. All fixed in 0.0.4 and #13; the six grader cases pass when regraded, published as `trials.regraded.jsonl` beside the as-recorded file. [Report](docs/benchmarks/2026-10-23-m2-pilot/report.md). CHANGELOG [0.0.4] still says "both harnesses" and "all ten `ho-02` trials", written before the QM cell ran; the report and `trials.jsonl` say 15 of 15 across three cells, and the CHANGELOG line is left as a record of when it was written.
- **QM probes, 2026-10-25: finding F5 rewritten.** The first probe run read "one sandbox per channel" as 0 of 3 on both QM engines; the cause was the rig (QM fills channel membership from a directory only its Slack worker syncs). With the adapter seeding that directory from the world, the rerun passed 3 of 3 on both, and F5 now reads as a sync requirement plus an error-message note; the first run's row stays as published and the two are not pooled. [qp-07 rerun](docs/benchmarks/2026-10-25-qm-probes-qp07/report.md), [docs/qm-findings.md](docs/qm-findings.md). That rerun's preregistration and results were squash-merged in one commit (#67), so main's history cannot show the order; the deviation is declared in the report and in `preregistrations.d`, and the crew rule now forbids it.
- **v0.2 held-out run, 2026-10-26: amendment 2's output-token cap rested on a wrong premise.** It said QM's Pi loop states no `max_tokens`; QM states 128,000 and the proxy refuses a stated value above the cap rather than clamping it, so the smoke with the flag refused every call and both QM Sonnet shards ran at the default. The premise is corrected in `scripts/run-shard.sh`'s header with the report. [Report](docs/benchmarks/2026-10-25-v02-heldout/report.md), deviation 3. The same run's first pull-request head carried wrong authored numbers that the /ship review caught before merge (the internal review record lists a lease sum, pair counts, a via-gbrain remainder, a hidden-fact count, Hermes's refused counts, a cost ratio and a floor-or-ceiling range); the merged report carries the figures re-derived from the receipts, the record is #81.
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

**Licences.** Code is MIT ([LICENSE](LICENSE)). Findings, reports, docs and our own data are CC BY 4.0 ([LICENSES/CC-BY-4.0.txt](LICENSES/CC-BY-4.0.txt)). Third-party text keeps its own licence: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists each upstream and the paths that carry its text. The statistics kit, proxy and ledger are vendored from gbrain-evals and gbrain under MIT with their notices ([runner/stats/README.md](runner/stats/README.md)), and the world is built from gbrain-evals' `messy-company-v1` dataset.

**Contributing.** Outside code is read as text and rewritten by maintainers, never merged as is; bug reports need a repro on current main or a failing test ([CONTRIBUTING.md](CONTRIBUTING.md)). Report security issues privately ([SECURITY.md](SECURITY.md)). Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Changelog

### 2026-11-06: gbrain pinned at 2c469d1b for v0.4

The gbrain row of the pins table names the new pin, `2c469d1b` (0.60.547.0, the internal-task hotfix), for the v0.4 runs, and adds `a590ad07` to the commits earlier runs built. Why: the v0.4 preregistration pins every gbrain arm to the internal-task hotfix or later.

### 2026-11-05: replicate validation reported

No result row changes, because the run is not a finding. Why: the run is complete and its report is in the tree.

### 2026-11-04: QM M1 reported

The QM runs table gains rows for runs `qm-c4-told-live-2026-11` and `qm-s1-gstack-probe-2026-11`, its So what line gains a sentence for them, and its details gain a line for each. The QM row of the harnesses table says both runs ran at the `b6786d67` pin, instead of "nothing counted has run there yet". The note under "Found so far" now counts six runs with GPT-6.1 Sol results, adding these two. Why: both runs are complete and their reports are in the tree.

### 2026-11-05: harness x model matrix reported

The v0.3 runs table gains a row for run `matrix-mu-2026-11`, and the So what list gains a line for it. The note under "Found so far" now counts five runs with GPT-6.1 Sol results, adding this one. Why: the run is complete and its report is in the tree.

### 2026-11-04: check a finding yourself

A new section, "Check a finding yourself", shows the three `scripts/replicate.ts` commands for a run that ships a trial bundle: two free checks and a paid one-cell rerun under a hard cap, with H1's OpenClaw cell as the tooling example. It says no published finding ships a bundle yet. The "Paid reruns are not an outside path yet" line now says the direct-key path exists for bundled runs. No number changes. Why: internal-task adds the replicate tool.

### 2026-11-04: prompt archaeology reported

The v0.3 runs table gains a row for run `prompt-archaeology-2026-11`, and the So what list gains a line for it. The note under "Found so far" now counts four runs with GPT-6.1 Sol results, adding this one. Why: the run is complete and its report is in the tree.

### 2026-11-04: GPT-6.1 Sol counts as frontier evidence

The line over the runs table says the Opus 5.5 and GPT-6.1 Sol rows are frontier evidence, and the `installer-cc-codex-2026-11` and `installer-cc-codex-acl-2026-11` rows mark GPT-6.1 Sol in bold like Opus 5.5. No number changes. Why: the front-page rebuild was written before those two runs reported, and its merges with main left these lines out of date.

### 2026-11-03: front door for outside readers

The page is rebuilt for readers from outside the project. It leads with the Opus 5.5 results (the gstack follow-rate checks, the Hermes start-hook rerun and the v0.3 Opus dev run), then harness anatomy and a keyless way to recheck the numbers. The Sonnet and Haiku results move to a labelled appendix, every results table gains a Model column, and the v0.3 pilot and seal log moves into a details block. Custody commit hashes read "custody commit (private)", and internal thread codes leave the prose. QM's time and tokens against OpenClaw read about 40 percent, not about a third, from the m3 held-out report. A Disclosures section closes the page. Why: this page is the front door for outside readers, and every page that features a tested product carries its disclosure line.

### 2026-11-03: installer rung rerun with access rules reported

The v0.3 runs table gains a row for run `installer-cc-codex-acl-2026-11`, and the So what list gains a line for it. Why: the run is complete and its report is in the tree. The note under "Found so far" again lists the runs where GPT-6.1 Sol has reported, keeps the hook test's facts, and no longer calls the hook test the first line with a Sol arm. Why: the first installer rung (`installer-cc-codex-2026-11`) reported Sol arms before the hook test, which is `gates938-phase3`.

### 2026-11-03: Opus gstack steps line names the hook test

The Opus gstack steps line in "Found so far" gains the hook-enforced test's result (internal-task, #244): Opus wrote source through Bash past the hook 40 times, and the hook is not added, with a link to its report. "Where to read next" links the same report first among the newest frontier runs. The note under "Found so far" now says the hook test is a preregistered run and the first line with a GPT-6.1 Sol arm. Why: the finding file now carries that result, and that run is now the newest frontier run.

### 2026-11-02: installer rung for Claude Code and Codex reported

The v0.3 runs table gains a row for run `installer-cc-codex-2026-11`, and the So what list gains a line for it. Why: the run is complete and its report is in the tree.

### 2026-11-02: Opus gstack steps line

"Found so far" gains a line for the Opus 5.5 gstack finding: the skill text loaded every time and its steps ran in none of 46 sessions, the FIX-METHOD verdict (no gstack was near the ceiling), and the hook-enforced steps run on harder tasks, with a link to the finding. Why: the finding file is new, and this page names every finding's headline.

### 2026-11-02: Hermes start-hook rerun reported

The v0.3 runs table gains a row for run `tool-discipline-start-hermes-r2-2026-11`, and the So what list gains a line for it. Why: the run is complete and its report is in the tree.

### 2026-11-01: findings rest on Sonnet and Haiku only

"Found so far" no longer says swapping Sonnet for Haiku moved results more than the harness did, and the harness and gbrain lines name the models they rest on, with a frontier rerun pending. "How the harnesses compare" marks the Sonnet-for-Haiku shift as background only. Under "Current results", the v0.1 harness runs' "So what" line drops the same model-over-harness claim, and the Haiku sensitivity run's details mark its Sonnet minus Haiku figures as background only. Why: these evals now test frontier models only (Opus 5.5 and GPT-6.1 Sol), and the findings behind these lines are Sonnet 5.5 and Haiku 5.5 data.

### 2026-11-01: v0.3 Opus dev run reported, no opening on v0.3

The Next list's two pending-clearance lines become one line linking internal-task's reseal record (#204). A new line reports run `v03-opus-dev-2026-10` (#209): Outcome B, its Why null? verdict (FIX-METHOD), and that gen6 stays sealed while the v0.4 plan waits for Garry's gate. The v0.3 runs table gains the run's row, and its So what line leads with the outcome. The gbrain and Models rows of the harness table name the run. The version line is unchanged. Why: #209 and #204 merged without updating this page, so it still said the opening 1 clearance was pending.

### 2026-11-01: start-hook panel reported

The v0.3 runs table gains a row for run `tool-discipline-start-2026-11`, and its So what line names it. Why: the run is complete and its report is in the tree.

### 2026-11-01: findings index linked, five lines matched to the findings

"Where to read next" gains a row for [findings/README.md](findings/README.md), the index of the first three finding files. The "Found so far" gbrain line now says gbrain went almost unused with no instruction (4 of 799 trials) instead of doing nothing, and the Sonnet-for-Haiku bullet says only OpenClaw's gap survives Holm. In "How gbrain compares", the untold bullet says the harnesses almost never used gbrain, a call in 2 of 600 arm trials and 2 of 199 scored ladder trials, instead of "no harness used it: 2 calls" (OpenClaw made a call in 4 trials, 5 calls in all), and links the finding. After the claim checker's recheck, the "So what" line and the "How gbrain compares" takeaway say gbrain went almost unused unless told, instead of "only matters when told". Why: the files are new, every documentation page should be reachable from this page or CLAUDE.md, and this page should not claim more than the claim-checked findings do.

### 2026-11-01: v0.3 approval relay re-read reported, the re-read gate passes

The Next list gains a line saying the re-read passed, linking the run's report and the dated gate note, and the v0.3 runs table gains a row for run `v03-ar-reread-2026-10`. The `v03-pilot-2026-10` row no longer says approval relay is not yet re-measured. The version line is unchanged. Why: the run is complete, and its endpoint 1 passes its go rule. The seal clearance for opening 1 is pending a family-scoped comparison by the custodian, internal-task, inside custody.

### 2026-10-31: v0.3 resealed as v0.3-gen6

The task-set bullet says v0.3's held-out tasks are sealed as set v0.3-gen6 (it still said "to be sealed"). Why: this release commits the sealed manifest of `v0.3-gen6`, the regenerated v0.3 held-out set, and retires v0.3 unopened; no counted run uses either yet.

### 2026-10-31: instruction-route run reported

The v0.3 runs table gives run `anatomy-instruction-route-2026-11` a row, its So what line names it, and "How gbrain compares" gains a bullet on where the rule enters. Why: the run is complete and its report is in the tree.

### 2026-10-31: the version line points at VERSION

The line at the top no longer names a version. It points at `VERSION` and `CHANGELOG.md`. A pull request that changes nothing on this page but the version now adds no entry here. Why: a version written into this page changed every time a pull request was renumbered after another one merged, and gstack then counted the page as changed product and asked for a fresh /ship (`RECEIPT_CARRY_PRODUCT_CHANGED` on #150).

### 2026-10-30: v0.3 approval relay re-read preregistered, gbrain pinned at a590ad07

harness-evals v0.0.68. The Next list's seal line links the preregistration of run `v03-ar-reread-2026-10`, the dev re-read of the fixed approval relay family under opening 1's scoped gbrain config, and says the template fix is done. The gbrain row of the harness table names the new pin `a590ad07` (0.60.522.0) and keeps `32366ac2` for the two runs that used it. The version line moves from v0.0.67 to v0.0.68 (v0.0.63 went to #146). Why: a new v0.3 seal needs that re-read before opening 1.

### 2026-10-30: version line only, Lane B TB2 replication preregistered

harness-evals v0.0.67. The version at the top moves from v0.0.66 to v0.0.67. Nothing else on this page changed. Why: v0.0.67 preregisters `laneb-tb2-replication-2026-10`, Part 1 of the Lane B replication internal-task funds. (0.0.64 and 0.0.65 are claimed by other open pull requests.)

### 2026-10-31: QM re-pinned to main b6786d67

harness-evals v0.0.66. The version at the top moves from v0.0.63 to v0.0.66, and the QM row says which pin the published cells ran (`v0.1.15`) and that the harness is now pinned to main `b6786d67`. Why: internal-task's M1 measures QM at that commit; QM removed its Claude engine there.

### 2026-10-30: version line only, rekey and compare for the v0.3 regeneration

harness-evals v0.0.63. The version at the top moves from v0.0.62 to v0.0.63. Nothing else on this page changed. Why: v0.0.63 adds `scripts/sealed/rekey.ts` and `scripts/sealed/compare-backups.ts`, so a set author can regenerate from their own backup without the custody key. (0.0.59 went to #143.)

### 2026-10-30: version line only, v0.3 approval relay template fix

harness-evals v0.0.62. The version at the top moves from v0.0.61 to v0.0.62. Nothing else on this page changed. Why: v0.0.62 fixes the v0.3 approval relay template after `v03-installer-dev-2026-10` found task defects in it, and regenerates its three dev tasks.

### 2026-10-30: version line only, the TB2 smoke of the gstack-native pilot again

harness-evals v0.0.61. The version at the top moves from v0.0.60 to v0.0.61. Nothing else on this page changed. Why: v0.0.61 fixes the Lane B bridge so a TB2 run materializes only its preregistered tasks, and preregisters the TB2 smoke again as `gn-pilot-tb2-smoke2-2026-10`.

### 2026-10-30: v0.3 installer dev run reported, opening-1 gate fails

harness-evals v0.0.60. The Next list gains a line saying the seal condition failed, linking the run's report and the dated gate note, and the v0.3 runs table gains a row for run `v03-installer-dev-2026-10`. The version line moves from v0.0.59 to v0.0.60 (v0.0.55 went to #136, v0.0.56 to #135, v0.0.57 to #140, v0.0.58 to #141, v0.0.59 to #145). Why: the run is complete, and its endpoint 6 decides that the seal at custody commit (private) is not opened.

### 2026-10-30: host-harness dev pilot reported

harness-evals v0.0.59. The v0.3 runs table gives run `host-harness-pilot-2026-10` one row, and its so-what line names it. The Next line links the report. The Claude Code and Codex rows of the harness table name their first counted run, and the Models row names `gpt-6-luna`. The version line moves from v0.0.58 to v0.0.59. Why: the pilot is complete. All six preregistered pairs are not distinguished at 20 tasks (dev), and gbrain's `told` arm scored below no brain in all three Haiku harnesses (descriptive).

### 2026-10-30: version line only, Ubicloud VMs carry a TTL

harness-evals v0.0.58. The version at the top moves from v0.0.57 to v0.0.58. Nothing else on this page changed. Why: v0.0.58 names every Ubicloud VM with a TTL suffix that gstack's reaper reads, so long shards are not destroyed mid-run.

### 2026-10-30: version line only, instruction-route test flake

harness-evals v0.0.57. The version at the top moves from v0.0.56 to v0.0.57. Nothing else on this page changed. Why: v0.0.57 fixes a timing flake in `tests/instruction-route.test.ts`.

### 2026-10-30: version line only, count_tokens checks the slot's model list

harness-evals v0.0.56. The version at the top moves from v0.0.55 to v0.0.56. Nothing else on this page changed. Why: v0.0.56 makes the metering proxy's free count_tokens route refuse a model that is not on the slot's model list.

### 2026-10-30: version line only, gstack-native pilot preregistered

harness-evals v0.0.55. The version at the top moves from v0.0.54 to v0.0.55. Nothing else on this page changed. Why: v0.0.55 preregisters the gstack-native-v1 dev pilot ([docs/benchmarks/2026-10-30-gstack-native-pilot/PREREGISTRATION.md](docs/benchmarks/2026-10-30-gstack-native-pilot/PREREGISTRATION.md)); no trial has run.

### 2026-10-30: host-harness dev pilot preregistered

harness-evals v0.0.54. The Next line links the preregistration of run `host-harness-pilot-2026-10`, a dev pilot of Claude Code and Codex beside OpenClaw and Hermes Agent on the v0.3 public tasks, and the version line moves from v0.0.53 to v0.0.54 (v0.0.44 went to #117, v0.0.45 to #129, v0.0.46 to #133, v0.0.47 to #123, v0.0.48 to #134, v0.0.49 to #120, v0.0.50 to #130, v0.0.51 to #128, v0.0.52 to #137, v0.0.53 to #138). The gbrain row of the pins table names this run beside `v03-installer-dev-2026-10`; both build `32366ac2`, the pin #128 set. Why: it is the first paid run of the two new harnesses, and its told cells should measure merged gbrain.

### 2026-10-30: version line only, instruction-route preregistration

harness-evals v0.0.53. The version at the top moves from v0.0.52 to v0.0.53. Nothing else on this page changed. Why: v0.0.53 preregisters run `anatomy-instruction-route-2026-11` ([preregistration](docs/benchmarks/2026-10-31-anatomy-instruction-route/PREREGISTRATION.md)); it has not run.

### 2026-10-30: harness anatomy pages linked

harness-evals v0.0.52. The version at the top moves from v0.0.51 to v0.0.52, and "Where to read next" gains a row for [docs/harness-anatomy/README.md](docs/harness-anatomy/README.md). Why: v0.0.52 adds per-harness anatomy pages, Claude Code records and the cost split of the m3 held-out run; no counted run's numbers changed.

### 2026-10-30: v0.3 installer dev cells preregistered, gbrain pinned at 32366ac2

harness-evals v0.0.51. The Next line links the preregistration of run `v03-installer-dev-2026-10`, C1's told and installer arms on the 20 public v0.3 tasks on Haiku. The gbrain row of the pins table names the new pin, `32366ac2` (0.60.498.0, master at gbrain#7898's merge, after gbrain#7489). The version line moves from v0.0.50 to v0.0.51 (v0.0.43 went to #118, v0.0.44 to #117, v0.0.45 to #129, v0.0.46 to #133, v0.0.47 to #123, v0.0.48 to #134, v0.0.49 to #120, v0.0.50 to #130). It also links the conditional approval of the v0.3 seal deviation. Why: gbrain#7489 merged, and the v0.3 plan owes the installer cells the dev pilot skipped.

### 2026-10-30: version line only, harness anatomy records

harness-evals v0.0.50. The version at the top moves from v0.0.49 to v0.0.50. Nothing else on this page changed. Why: v0.0.50 adds the harness anatomy capture kit and its first records ([docs/harness-anatomy/README.md](docs/harness-anatomy/README.md)); no counted run uses them.

### 2026-10-30: version line only, repository tasks

harness-evals v0.0.49. The version at the top moves from v0.0.48 to v0.0.49. Nothing else on this page changed. Why: v0.0.49 adds the repository task format and the gstack-native-v1 dev split ([docs/repo-tasks.md](docs/repo-tasks.md)); no counted run uses them yet.

### 2026-10-30: version line only, instruction routes

harness-evals v0.0.48. The version at the top moves from v0.0.47 to v0.0.48 (v0.0.45 is reserved for #130). Nothing else on this page changed. Why: v0.0.48 lets the OpenClaw and Hermes adapters deliver one instruction through the route a cell's `config` names ([harnesses/routes/README.md](harnesses/routes/README.md)); no counted run uses it yet.

### 2026-10-30: version line only, Lane B bridge

harness-evals v0.0.47. The version at the top moves from v0.0.46 to v0.0.47. Nothing else on this page changed. Why: v0.0.47 adds the Lane B bridge ([docs/gstack-laneb.md](docs/gstack-laneb.md)); no counted run uses it yet.

### 2026-10-30: version line only, Hermes allowlist lock left out of the gbrain bundle

harness-evals v0.0.46. The version at the top moves to v0.0.46. Nothing else on this page changed. Why: v0.0.46 lets the gbrain image build at gbrain#7989, whose Hermes setup leaves a lock file beside the allowlist.

### 2026-10-30: version line only, Hermes chat watcher timing

harness-evals v0.0.45. The version at the top moves from v0.0.44 to v0.0.45. Nothing else on this page changed. Why: v0.0.45 times the internal-task Hermes chat watcher's grace and exit wait in milliseconds, which fixes a flaky test; no counted run uses that overlay.

### 2026-10-29: version line only, repo-kind custody

harness-evals v0.0.44. The version at the top moves from v0.0.43 to v0.0.44 (v0.0.42 went to #127, and v0.0.43 is reserved for #123). Nothing else on this page changed. Why: v0.0.44 takes repo-kind held-out sets through custody ([docs/sealed-custody.md](docs/sealed-custody.md), Repo-kind sets); no counted run uses it yet.

### 2026-10-29: Claude Code and Codex added to the harness table

harness-evals v0.0.43. Two rows in "The harnesses under test": Claude Code and Codex, built and tested without a key, no counted run yet; the version line moves from v0.0.42 to v0.0.43 (v0.0.40 went to #121, v0.0.41 to #125, v0.0.42 to #127). Why: Garry asked for both as harnesses. Codex's row says why it runs on an OpenAI model.

### 2026-10-30: version line only, seal.ts digest required

harness-evals v0.0.42. The version at the top moves from v0.0.41 to v0.0.42. Nothing else on this page changed. Why: v0.0.42 makes `--sha256` required when the custodian seals from an author's backup ([docs/sealed-custody.md](docs/sealed-custody.md), Lifecycle); no counted run uses it yet.

### 2026-10-29: v0.3 dev pilot reported

harness-evals v0.0.41. A v0.3 runs table gives run `v03-pilot-2026-10` one row. The Next line links its report, and the version line moves to v0.0.41. Why: the pilot is complete. Its verdict is no-go under the preregistered rule, and the held-out set was sealed before that was settled, a deviation the report records.

### 2026-10-29: version line only, v0.3 sealed

harness-evals v0.0.40. The version at the top moves from v0.0.39 to v0.0.40. Nothing else on this page changed. Why: v0.0.40 commits the sealed manifest of task set v0.3's 40 held-out tasks; no counted run uses them yet.

### 2026-10-29: version line only, proxy settlement

harness-evals v0.0.39. The version at the top moves from v0.0.36 to v0.0.39 (v0.0.37 went to #119, v0.0.38 to #115). Nothing else on this page changed. Why: v0.0.39 changes how the metering proxy charges unfinished streams and provider errors (runner/README.md); no counted run has used it yet.

### 2026-10-29: version line only, seal.ts intake

harness-evals v0.0.36. The version at the top moves from v0.0.34 to v0.0.36 (v0.0.35 went to #113). Nothing else on this page changed. Why: v0.0.36 lets the custodian seal a held-out set from its author's encrypted backup ([docs/sealed-custody.md](docs/sealed-custody.md), Lifecycle); no counted run uses it yet.

### 2026-10-29: v0.3 dev pilot preregistered

harness-evals v0.0.34. The Next line links the preregistration of run `v03-pilot-2026-10`, a dev pilot of task set v0.3's 20 public tasks on Haiku, and the version line moves from v0.0.33 to v0.0.34. Why: the run is the step before the new held-out set is used.

### 2026-10-29: version line only

harness-evals v0.0.33. The version at the top moves from v0.0.32 to v0.0.33. Nothing else on this page changed. Why: v0.0.33 adds sealed custody of held-out sets ([docs/sealed-custody.md](docs/sealed-custody.md)); no counted run uses it yet.

### 2026-10-29: task set v0.3 named

harness-evals v0.0.32. The task-set bullet names task set v0.3, the generated set whose 20 dev tasks this release adds, and the version line moves from v0.0.31 to v0.0.32. Why: the bullet lists every task set, and [docs/tasks.md](docs/tasks.md) describes the new one.

### 2026-10-29: "not distinguished" replaced by "can't tell apart" in the results rows

harness-evals v0.0.31. The `gbrain-installer-2026-10` table row and the per-run bullets in the details blocks now say "can't tell apart" where they said "not distinguished", matching the other rows; the glossary still names the reports' term. No figure, interval, run name or link target changed. Why: one row had kept the reports' wording after the plain-words rewrite.

### 2026-10-28: README rewritten in plain words

harness-evals v0.0.29. The page now opens with what the repository is, what the runs have found and what comes next, then a "Start here" list and a "Words we use" glossary (harness, trial, dev and held-out tasks, confirmatory and dev and pilot, "can't tell apart" for the reports' "not distinguished", CI, cross-scope read, proxy). Every section has a bold one-line takeaway and bullets instead of long paragraphs, each results table has a one-line "so what" above it, and the full methods and comparison paragraphs, the full limits, the cost paragraph and the results-directory description moved word for word to the new [docs/methods.md](docs/methods.md); the Corrections list sits in a collapsed block under a plain introduction. No figure, interval, run name or link target changed. Why: Garry asked for a page a sharp developer with no time can read.

### 2026-10-28: Current results reformatted for reading

harness-evals v0.0.28. The Current results section now opens with a short summary of what the runs have found so far, then one compact table per question (the v0.1 harness runs, gbrain on the v0.1 held-out set, the QM runs, the v0.2 runs) with one line per run and its report link, the full text of every run with its receipts link in a collapsed details block under each table, and the former methods paragraph as a "How to read these numbers" list that the summary links to. No figure, interval, label or link target changed; the only new link is the in-page one to the reading notes. Why: the one wide table, with the full result text in every row, had grown hard to read. The version named at the top of this page moves from v0.0.27 to v0.0.28.
### 2026-10-28: held-out openings counted

harness-evals v0.0.26. The "Set and status" column of Current results gives each run's opening number within its held-out set, as `runner/heldout/openings.ts` derives it from preregistration merge order, and names runs whose trials overlapped; the version at the top moves from v0.0.24 to v0.0.26. Run `gbrain-memory-fix-2026-10b`, merged from main, gets opening 3 of the v0.2 set. Why: the held-out MANIFEST files now carry an openings ledger that the runner and CI check against a budget.

### 2026-10-28: gbrain-memory-fix-2026-10b counted

harness-evals v0.0.24. Run `gbrain-memory-fix-2026-10b` is complete and reported ([docs/benchmarks/2026-10-28-gbrain-memory-fix-b/report.md](docs/benchmarks/2026-10-28-gbrain-memory-fix-b/report.md)): the memory run's twelve cells on its eight continuity and corrections tasks at gbrain#7744's head, 480 trials on Ubicloud, $33.25. The primary is not distinguished on any harness, as preregistered; `cr-05` rose in every live cell (off 0 of 5 in the five that were at 0) with the correction returned ahead of the retracted figure, and stayed at 0 of 5 in every none cell. Under the 2026-10-28 held-out rule the row's "Set and status" reads dev (the v0.2 set's third opening, and a retest of gbrain#7744 on the tasks it was built against); How gbrain compares counts it, adds its result and widens the detectable differences to 17.7 points, and Known limits says the v0.2 set has served three runs. The version named at the top of this page moves from v0.0.23 to v0.0.24.

### 2026-10-28: held-out results relabelled confirmatory or dev

harness-evals v0.0.23. The Current results table gains a "Set and status" column, a dated Corrections entry records that only the first counted opening of each held-out set is confirmatory, and Known limits and the two comparison sections say the same; the version at the top moves from v0.0.21 to v0.0.23. Why: gstack-evals' review (internal-task) found the v0.1 held-out set had served ten counted runs while the conventions say spent after one.

### 2026-10-28: gbrain-memory-fix-2026-10b preregistered at main a0fe48da6

harness-evals v0.0.21. The gbrain row of the pins table names run `gbrain-memory-fix-2026-10b` ([preregistration](docs/benchmarks/2026-10-28-gbrain-memory-fix-b/PREREGISTRATION.md)) as the next run at the same pin, `81692dc6`, and the version at the top moves from v0.0.19 to v0.0.21. Why: moving execution onto the metering-proxy fix (#97, `a0fe48da6`) changed `gbrain/pin.json`, so under its preregistration's rule `gbrain-memory-fix-2026-10` took a new run id instead of an amendment; it never ran.

### 2026-10-28: gbrain-memory-fix-2026-10 preregistered, gbrain pinned at 81692dc6

harness-evals v0.0.19. The gbrain row of the pins table names the new pin, `81692dc6` (0.60.472.0), the head of gbrain#7744 (saved facts matched on stemmed whole words, a newer correction returned ahead of the fact it corrects), open and unmerged, for run `gbrain-memory-fix-2026-10` ([preregistration](docs/benchmarks/2026-10-27-gbrain-memory-fix/PREREGISTRATION.md)): the memory run's twelve cells on its eight continuity and corrections tasks, 480 trials under a $70 cap. Why: the memory run's report found the `cr-05` correction ingested and never returned by `search`, which that pull request changes. The version named at the top of this page moves from v0.0.14 to v0.0.19.

### 2026-10-27: gbrain-memory-2026-10 counted

harness-evals v0.0.14. Run `gbrain-memory-2026-10` is complete and reported ([docs/benchmarks/2026-10-26-gbrain-memory/report.md](docs/benchmarks/2026-10-26-gbrain-memory/report.md)): three harnesses on Sonnet and Haiku, with and without a member brain that fills during the scenario, on the 15 sealed v0.2 held-out tasks, 900 trials on Ubicloud, $75.21. Pass over continuity and corrections is not distinguished from none on any Sonnet harness (-5 [-18, +5], +23 [+0, +53], -3 [-8, +0] points); the Hermes estimate is two DM-preference tasks moving off the floor; no cross-scope read through gbrain in 450 live trials. The analysis scripts gained the excluded-pairs table, the fault sensitivity row, the live-ingestion block and the `cross_scope_fact` endpoint. The version named at the top of this page moves from v0.0.12 to v0.0.14.

### 2026-10-26: README and docs in gbrain-evals' shape

harness-evals v0.0.12. The page now follows gbrain-evals' README: the harnesses under test with their pins, what the world and tasks are, one "Current results" table with every counted run from the M2 pilot to the v0.2 held-out run (cells, n, the primary estimate with its interval, spend, report and receipts), "How the harnesses compare" and "How gbrain compares" as two short sections, known limits (proxy-side spend proof, the private repository, Hermes's discovery probes, the three declared deviations), where to read next, the free and paid commands with their costs, a corrections section collecting every dated correction already in the reports, and inspect or extend. New pages: [docs/README.md](docs/README.md) (index), [docs/decisions.md](docs/decisions.md), [docs/budget-ledger.md](docs/budget-ledger.md) rendered by `scripts/budget-ledger.ts` from the lane ledger, [docs/comparing-runs.md](docs/comparing-runs.md), and [docs/receipts-manifest.json](docs/receipts-manifest.json) generated by `scripts/receipts-manifest.ts`. The earlier "What is here" table and "Run the checks" section are folded into "Where to read next" and "Try a small experiment"; the spend paragraph moved to Known limits and [docs/budget-ledger.md](docs/budget-ledger.md).

### 2026-10-26: v0.2 held-out run counted

harness-evals v0.0.7. Run `v02-heldout-2026-10` is complete and reported ([docs/benchmarks/2026-10-25-v02-heldout/report.md](docs/benchmarks/2026-10-25-v02-heldout/report.md)): three harnesses on Sonnet and Haiku, none against gbrain-told, 15 held-out v0.2 tasks at 5 repetitions, 900 of 900 trials across nine shards, $76.60 against the $135 cap. The pass effect of telling a harness to consult gbrain is not distinguished from zero in any of the six pairs; cross-scope reads through gbrain's bot-wide `search` rose in every pair. The v0.2 pilot that preceded it is reported at [docs/benchmarks/2026-10-25-v02-pilot/report.md](docs/benchmarks/2026-10-25-v02-pilot/report.md). New: `scripts/secondary-endpoints.ts`.

### 2026-10-25: QM inner-harness cell and probes counted

harness-evals v0.0.5. Run `qm-inner-harness-2026-10` is complete and reported ([docs/benchmarks/2026-10-25-qm-inner-harness/report.md](docs/benchmarks/2026-10-25-qm-inner-harness/report.md)): QM over Pi against QM over the Claude Agent SDK on Haiku, 200 held-out trials sharded by cell onto two fresh machines at the preregistration commit, $1.25 under the $25 cap. The two integrations are not distinguished on pass at 16 tasks (63 and 66 of 80, +4 points [-6, +15], below the 14.5-point minimum detectable difference, so inconclusive on pass); the Claude cell cost 2.7 times as much per trial and ran 11 s longer at the median, and never used the SDK's `Agent` delegation. Run `qm-probes-2026-10` is complete and reported ([docs/benchmarks/2026-10-25-qm-probes/report.md](docs/benchmarks/2026-10-25-qm-probes/report.md)): 96 trials, $0.37 under the $15 cap; QM's memory claims held within and across scopes on both inner harnesses, DM sandboxes were per scope, the strict posture and the command denylist did what they say and both controls went the expected way; the one failed probe, a channel-scope sandbox, is a rig limitation written up as F5 in [docs/qm-findings.md](docs/qm-findings.md) (QM reads channel membership from a directory only its Slack worker fills). With the adapter seeding that directory from the world, the rerun `qm-probes-qp07-2026-10` ([docs/benchmarks/2026-10-25-qm-probes-qp07/report.md](docs/benchmarks/2026-10-25-qm-probes-qp07/report.md), 6 trials, $0.04) passed 3 of 3 on both inner harnesses, and F5 now reads as a sync requirement plus an error-message note.

### 2026-10-25: company brain counted

harness-evals v0.0.5. Run `company-brain-2026-10` is complete and reported ([docs/benchmarks/2026-10-25-company-brain/report.md](docs/benchmarks/2026-10-25-company-brain/report.md)): 9 cells, 900 trials, three shards on three machines, $6.26 reconciled across four leases under the $25 cap. An unscoped company brain told to the harness leaked on nearly every search (514 unreadable rows in 300 told trials, 202 trials failed on the cross-scope rule, pass -44 to -60 points); the same brain under per-member grants returned no unreadable row in 300 trials and cost nothing in pass that this design can detect, at 11% to 57% more input tokens. Nine finance disclosures, all on the two tasks built for them, seven with no brain route. The report opens with a declared deviation: the OpenClaw scoped cell's last 65 trials ran under a runner at `e278fb0` instead of the preregistered `6b67de1` after a resume; the grader is identical for 900 of 900 by regrade, and the one rule that differed (HE-MODEL-001 on refused lines) is read both ways.

### 2026-10-24: gbrain arm counted

harness-evals v0.0.5. Run `gbrain-arm-2026-10` is complete and reported ([docs/benchmarks/2026-10-24-gbrain-arm/report.md](docs/benchmarks/2026-10-24-gbrain-arm/report.md)): 15 cells, 1,500 trials, $80.87 committed across four leases under the $350 cap. Left unmentioned, no harness used gbrain (2 calls in 600 trials) and no pass difference is distinguished; told to check the brain first, Haiku used it in most trials, gained the two cross-channel retrieval tasks and lost trials to cross-scope search results, netting +1 to +4 points with wide intervals. Two Hermes consent violations on Haiku with gbrain installed, three QM `harness_error` trials from a port collision, four machine-sleep resumes; all in the report.

### 2026-10-24: gbrain-check

harness-evals v0.0.5. `scripts/gbrain-check.ts` checks one gbrain commit: keyless by default (builds the sidecar image at that commit, runs the fake harness through the runner and the world's gbrain tap on both surfaces and with the install bundle mounted, asserts tool counts against the pin, the search tool, a known page retrieved, the bundle digests and the Hermes context; 203 s cold on a 4-core machine), paid with `--harness openclaw,hermes` (a scratch, uncounted preregistration on the dev split, the ladder's gating rows against `scripts/gbrain-check.baseline.json`, INCOMPLETE and NOT_COMPARABLE rules). A disabled workflow (`vars.GBRAIN_CHECK_ENABLED`) and a `workflow_call` job for gbrain's CI. New rows HE-GBRAIN-008 to 010.

### 2026-10-24: From internal-task, two preregistrations and the QM findings page

Runs `qm-inner-harness-2026-10` (QM over Pi against QM over the Claude Agent SDK, Haiku, 20 held-out tasks, 200 trials, cap $25, sharded by cell across two machines) and `qm-probes-2026-10` (nine product probes on QM's two inner harnesses, two org-setting cells, OpenClaw and Hermes on the shared claims, 96 trials, cap $15) are preregistered with Garry's approval of the reviewed plan recorded in the text; [docs/qm-findings.md](docs/qm-findings.md) opens with the no-Codex finding, the Claude CLI side-traffic limitation, the `readOnly` label note and the strict-posture observation from the smokes.

### 2026-10-24: From internal-task, QM inner-harness configs

A cell's `config` reaches the harness as `HE_HARNESS_CONFIG`; QM maps it to its Pi or Claude inner harness and to the probe settings; every adapter opens a new session on a thread turn; the runner ends a trial that ran another model than its cell's as `model_error` (HE-MODEL-001); the `thread = "new"` turn field and the eleven `qp-*` product probes ([docs/tasks.md](docs/tasks.md), "QM probes"). Details in CHANGELOG.md and [harnesses/qm/README.md](harnesses/qm/README.md).

### 2026-10-24: v0.1 report page and publishing checklist

harness-evals v0.0.5. `docs/report-v0.1.md` is the first page for the v0.1 result and the opening paragraph points at it; `docs/publishing-checklist.md` and `scripts/publish-audit.ts` record what was checked before the repository can be made public and what remains for the owner to decide.

### 2026-10-24: Failure taxonomy

harness-evals v0.0.5. `scripts/taxonomy.ts` labels every failed required predicate of a graded run with an observed failure mode from `events.jsonl`, `turns.jsonl` and the task's oracle, one line of evidence each, and records the facts behind the label and the classifier's provenance (rule order, patterns, digests of every task and oracle read). Each v0.1 report gains a taxonomy section; pass rates are unchanged. A 30-failure hand-labelled sample agrees with the script on all 30 after two rule changes it prompted (25 before).

### 2026-10-24: Spend reconciliation

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

## Disclosures

The repository and the evaluation are run by Garry Tan. gbrain-evals, which supplies the task world, is his project too. Every harness ran the same tasks, graders, preamble and model through the same proxy, and the receipts are in the tree so anyone can regrade. Still weigh the gstack, gbrain and QM rows with the lines below in mind.

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.
