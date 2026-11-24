# Rule placement, re-run on gbrain v0.60.766.0 (h10-rule-placement-rerun-2026-11): report

**Takeaways**

- **We learned that the original answer holds on gbrain's newest release: put gbrain's rule where the model sees it every turn.** On GPT-6.2 Sol, a per-turn hook got Codex, Hermes and OpenClaw to call gbrain before answering in **30 of 30 member turns** each, every one with a search or query, against 0 to 4 of 30 with gbrain and no rule. The system prompt did the same on Codex and Hermes (30 of 30), and the startup file reached 30, 30 and 29 of 30. On Claude Code (Opus 5.5) the system prompt and the startup file reached 29 of 30 and a told skill 30 of 30, against 14 of 30 with no rule (descriptive, because that control has no headroom). Those 14 no-rule turns recalled from or wrote to gbrain's memory (9 and 5 on the cli driver) and none searched or queried; with the rule in the system prompt, the startup file or a told skill, 21 or 22 of 30 turns searched or queried, and with the hook 10 of 30. **You should keep gbrain's installer writing the rule into a per-turn hook, the system prompt or the startup file on every harness.**
- **We learned that an untold skill still works on two harnesses and not on two others.** Codex followed it in 30 of 30 turns and OpenClaw in 27 of 30. Hermes followed it in 4 of 30 (no rule: 0 of 30; +13.3 points [+0.0, +32.3], Holm p 1.0), and Claude Code in 12 and 14 of 30 (no rule: 14 of 30). Naming the skill in the prompt ("Use the brain-first skill.") reached 30 of 30 on Claude Code. **On Hermes and Claude Code, don't rely on a skill alone: name it in the prompt or use one of the routes above.**
- **What didn't work:** a copy of the rule given once per session fades on repeat turns (Hermes 0 of 10, OpenClaw 3 of 10, against 10 of 10 for the hook). The placebo (same slot, unrelated text) did nothing (Codex 7 of 30, Hermes 0 of 30). The per-turn routes and the told skill cost 22% to 69% more per member turn than the no-rule control on Claude Code and 26% to 48% more on the Sol harnesses. Pass was not a tested measure (10 trials per cell) and showed no consistent rise with it.
- **Settled:** gbrain's installer keeps writing the brain-first rule to a per-turn hook, the system prompt or the startup file on every harness; the untold skill on Hermes and Claude Code stays a cut candidate; the original run's rule-placement findings stand, now measured on gbrain v0.60.766.0 and GPT-6.2 Sol.

Run id `h10-rule-placement-rerun-2026-11`, preregistered in [PREREGISTRATION.md](PREREGISTRATION.md) before any counted trial, with dated changes in [AMENDMENTS.md](AMENDMENTS.md). gbrain v0.60.766.0 (`ae4bef02`), the newest release on gbrain's main branch at launch. No model judge: every number comes from the evaluator's own records and the deterministic grader. Every number is dev: 10 public tasks, one repetition, at these pins. How to rerun the analysis: [reproduce.md](reproduce.md).

## What ran

- **Run** `h10-rule-placement-rerun-2026-11`, launched 2026-11-24 (UTC) from `249cb8ec` on this branch, which carries both dated amendments. The preregistration merged as #532.
- **gbrain:** v0.60.766.0 (`ae4bef02`) on the starter surface (34 tools), one bot-visible brain, no per-member access rules. The plan named v0.60.754.0; the 2026-11-23 amendment moved it to the newest release before any trial, naming gbrain#9972, #9903 and #9981 as the changes that could move load or pass.
- **Harnesses and models:** Claude Code 2.1.312 on Opus 5.5, driven by the cli and by the Agent SDK (preset system prompt and unset). Codex 0.165.0, Hermes v2026.9.24 (serve), OpenClaw 2026.10.6 and QM on GPT-6.2 Sol. One model per harness, so a harness difference is a harness-and-model difference.
- **Rule bytes:** the rule gbrain renders for each harness: 289 bytes on Claude Code and Codex, 569 on OpenClaw and 491 on Hermes (gbrain#8068's per-harness text). Re-rendered at `ae4bef02`, all three are byte-identical to the plan's build.
- **Tasks:** the original's 10 public v0.3.1 dev tasks, 30 member turns, 10 of them repeat turns inside a session (9 tasks). One repetition per cell.
- **Cells:** 36 cells and 360 trials in six Ubicloud shards, one standard-16 VM at a time, whole cells, trials sequential within a shard. `cx` ran first as the canary; each later shard started after the one before had finished and copied its results off its VM.
- **Pilot:** 36 one-trial cells, one per counted cell, on gbrain `ae4bef02`, before any counted trial. Every arm passed its pilot checks but one that could not be read: QM's gbrain-tools arm listed gbrain's tools and made no call, so the plan's check that a call reaches the sidecar is unshown. QM's 0 of 28 below therefore can't tell a model that chose not to call gbrain from a tool path that doesn't work. No arm was left out ([pilot/README.md](pilot/README.md)).

## Per-cell results

Followed is member turns with a gbrain call before the first reply, with a task-clustered bootstrap 95% interval (10,000 draws, seed 7). A cell at 0 or 30 of 30 has no interval worth printing. "Original run" is the same cell in [2026-11-07-h10-instruction-placement](../2026-11-07-h10-instruction-placement/report.md), on gbrain 0.60.547.0 and GPT-6.1 Sol: descriptive, because the build and the Sol model both changed. Skill body loaded is turns where the skill's body reached a request. Cost is per member turn from the trial records; "x its control" is against the same harness, model and driver with gbrain and no rule; the two sdk-default rows have no control of their own and are against the sdk-preset control, so they also carry the change of system prompt. A gbrain call is any gbrain tool call, memory writes (remember, forget) included, as the plan defines it.

| Harness, model, driver | Route | Followed (95% interval) | Original run | Repeat turns | Skill body loaded | Pass | Cost per member turn | x its control |
|---|---|---|---|---|---|---|---|---|
| Claude Code, Opus 5.5, cli | gbrain, no rule | 14 / 30 [28.6, 65.4] | 18 / 30 | 6 / 10 |  | 8 / 10 | $0.0748 |  |
| Claude Code, Opus 5.5, cli | hook | 22 / 30 [56.2, 88.9] | 26 / 30 | 8 / 10 |  | 7 / 10 | $0.0910 | 1.22x |
| Claude Code, Opus 5.5, cli | once | 17 / 30 [37.5, 75.0] | 23 / 30 | 5 / 10 |  | 7 / 10 | $0.0730 | 0.98x |
| Claude Code, Opus 5.5, cli | system | 29 / 30 [88.9, 100.0] | 30 / 30 | 9 / 10 |  | 7 / 10 | $0.1264 | 1.69x |
| Claude Code, Opus 5.5, cli | startup | 29 / 30 [89.7, 100.0] | 30 / 30 | 9 / 10 |  | 6 / 10 | $0.1155 | 1.54x |
| Claude Code, Opus 5.5, cli | no gbrain | 0 / 30 | not run | 0 / 10 |  | 7 / 10 | $0.0582 |  |
| Claude Code, Opus 5.5, sdk-default | told | 30 / 30 | 30 / 30 | 10 / 10 | 30 / 30 | 7 / 10 | $0.1224 | 1.54x |
| Claude Code, Opus 5.5, sdk-default | skill | 14 / 30 [27.3, 67.9] | 17 / 30 | 6 / 10 | 0 / 30 | 8 / 10 | $0.0720 | 0.91x |
| Claude Code, Opus 5.5, sdk-preset | gbrain, no rule | 14 / 30 [28.6, 64.5] | 17 / 30 | 5 / 10 |  | 7 / 10 | $0.0796 |  |
| Claude Code, Opus 5.5, sdk-preset | told | 30 / 30 | 30 / 30 | 10 / 10 | 30 / 30 | 6 / 10 | $0.1308 | 1.64x |
| Claude Code, Opus 5.5, sdk-preset | skill | 12 / 30 [17.2, 64.3] | 18 / 30 | 6 / 10 | 0 / 30 | 7 / 10 | $0.0688 | 0.86x |
| Codex, GPT-6.2 Sol, cli | gbrain, no rule | 4 / 30 [3.3, 24.1] | 6 / 30 | 0 / 10 |  | 7 / 10 | $0.0300 |  |
| Codex, GPT-6.2 Sol, cli | hook | 30 / 30 | 30 / 30 | 10 / 10 |  | 5 / 10 | $0.0381 | 1.27x |
| Codex, GPT-6.2 Sol, cli | once | 30 / 30 | 30 / 30 | 10 / 10 |  | 4 / 10 | $0.0398 | 1.33x |
| Codex, GPT-6.2 Sol, cli | system | 30 / 30 | 30 / 30 | 10 / 10 |  | 9 / 10 | $0.0392 | 1.31x |
| Codex, GPT-6.2 Sol, cli | startup | 30 / 30 | 30 / 30 | 10 / 10 |  | 6 / 10 | $0.0389 | 1.30x |
| Codex, GPT-6.2 Sol, cli | told | 30 / 30 | 30 / 30 | 10 / 10 | 30 / 30 | 5 / 10 | $0.0419 | 1.40x |
| Codex, GPT-6.2 Sol, cli | skill | 30 / 30 | 30 / 30 | 10 / 10 | 30 / 30 | 8 / 10 | $0.0403 | 1.34x |
| Codex, GPT-6.2 Sol, cli | placebo | 7 / 30 [10.0, 37.9] | 5 / 30 | 1 / 10 |  | 8 / 10 | $0.0310 | 1.03x |
| Codex, GPT-6.2 Sol, cli | no gbrain | 0 / 30 | not run | 0 / 10 |  | 7 / 10 | $0.0217 |  |
| Hermes, GPT-6.2 Sol, cli | gbrain, no rule | 0 / 30 | 4 / 30 | 0 / 10 |  | 7 / 10 | $0.0712 |  |
| Hermes, GPT-6.2 Sol, cli | hook | 30 / 30 | 30 / 30 | 10 / 10 |  | 5 / 10 | $0.1052 | 1.48x |
| Hermes, GPT-6.2 Sol, cli | once | 20 / 30 [55.2, 78.1] | 22 / 30 | 0 / 10 |  | 7 / 10 | $0.0964 | 1.35x |
| Hermes, GPT-6.2 Sol, cli | system | 30 / 30 | 30 / 30 | 10 / 10 |  | 7 / 10 | $0.0997 | 1.40x |
| Hermes, GPT-6.2 Sol, cli | startup | 30 / 30 | 30 / 30 | 10 / 10 |  | 6 / 10 | $0.1045 | 1.47x |
| Hermes, GPT-6.2 Sol, cli | skill | 4 / 30 [0.0, 32.3] | 4 / 30 | 2 / 10 | 4 / 30 | 7 / 10 | $0.0763 | 1.07x |
| Hermes, GPT-6.2 Sol, cli | placebo | 0 / 30 | 4 / 30 | 0 / 10 |  | 7 / 10 | $0.0667 | 0.94x |
| Hermes, GPT-6.2 Sol, cli | no gbrain | 0 / 30 | not run | 0 / 10 |  | 8 / 10 | $0.0712 |  |
| OpenClaw, GPT-6.2 Sol, cli | gbrain, no rule | 4 / 30 [3.3, 24.1] | 6 / 30 | 0 / 10 |  | 7 / 10 | $0.0424 |  |
| OpenClaw, GPT-6.2 Sol, cli | hook | 30 / 30 | 30 / 30 | 10 / 10 |  | 6 / 10 | $0.0608 | 1.44x |
| OpenClaw, GPT-6.2 Sol, cli | once | 23 / 30 [62.1, 90.0] | 24 / 30 | 3 / 10 |  | 6 / 10 | $0.0641 | 1.51x |
| OpenClaw, GPT-6.2 Sol, cli | startup | 29 / 30 [90.3, 100.0] | 30 / 30 | 10 / 10 |  | 7 / 10 | $0.0534 | 1.26x |
| OpenClaw, GPT-6.2 Sol, cli | skill | 27 / 30 [67.9, 100.0] | 29 / 30 | 9 / 10 | 2 / 30 | 7 / 10 | $0.0561 | 1.33x |
| OpenClaw, GPT-6.2 Sol, cli | no gbrain | 0 / 30 | not run | 0 / 10 |  | 7 / 10 | $0.0451 |  |
| QM, GPT-6.2 Sol, cli | no gbrain | 0 / 30 | not run | 0 / 10 |  | 7 / 10 | $0.0257 |  |
| QM, GPT-6.2 Sol, cli | gbrain, no rule | 0 / 28 (1 cap stop excluded) | not run | 0 / 9 |  | 6 / 9 | $0.0284 |  |

Source: [results/instruction-followed-h10.md](results/instruction-followed-h10.md) and [results/report-extras.json](results/report-extras.json).

- **Where the rule landed** (proxy copy counts, [results/instruction-followed-h10.md](results/instruction-followed-h10.md)): Claude Code and Codex carry hook, once and system in the system block and the startup file as user text plus history. Hermes carries hook, once and placebo as user text and system and startup in the system block. OpenClaw carries hook and once as user text and startup in the system block. Every route cell's adapter record reads `status: ok` with its harness's rule sha256, and no cross-check mismatched.
- **The no-gbrain cells** made no gbrain call (0 of 30 on every harness), as they should.

## Family A (descriptive by the preregistered rule)

The plan reports both contrasts descriptively: their minimum detectable differences (39 and 25 points) are above the 20-point claim margin. The scorer's own table labels them "inferential"; this report follows the plan.

| Contrast | Pairs pooled | Difference, points [95% CI] | p | Holm p |
|---|---|---|---|---|
| Repetition (once minus hook, repeat turns) | Claude Code cli, Codex, Hermes, OpenClaw | -48.6 [-54.2, -41.7] | 0.0039 | 0.0039 |
| Placement (once minus system) | Claude Code cli, Hermes, Codex | -24.2 [-30.6, -18.6] | 0.0020 | 0.0039 |

Per pair, repetition was -100.0 on Hermes, -70.0 on OpenClaw, -30.0 on Claude Code and 0.0 on Codex; placement was -40.0 on Claude Code, -33.3 on Hermes and 0.0 on Codex. On Codex the once-copy sits in the system block and holds, as in the original.

## Family B (each route against its own control)

| Harness, model, driver | Routes | Control | Route | Difference, points [95% CI] | Holm p | Reading |
|---|---|---|---|---|---|---|
| Codex, GPT-6.2 Sol, cli | hook, once, system, startup, told, skill (each) | 13.3% | 100% | +86.7 [+75.9, +96.7] | 0.0137 | inferential |
| | placebo | 13.3% | 23.3% | +10.0 [+0.0, +25.0] | 0.5000 | inferential |
| Hermes, GPT-6.2 Sol, cli | hook, system, startup (each) | 0.0% | 100% | +100.0 [+100.0, +100.0] | 0.0117 | inferential |
| | once | 0.0% | 66.7% | +66.7 [+55.2, +78.1] | 0.0117 | inferential |
| | skill | 0.0% | 13.3% | +13.3 [+0.0, +32.3] | 1.0000 | inferential |
| | placebo | 0.0% | 0.0% | +0.0 [+0.0, +0.0] | 1.0000 | inferential |
| OpenClaw, GPT-6.2 Sol, cli | hook | 13.3% | 100% | +86.7 [+75.9, +96.7] | 0.0078 | inferential |
| | once | 13.3% | 76.7% | +63.3 [+44.4, +80.6] | 0.0078 | inferential |
| | startup | 13.3% | 96.7% | +83.3 [+69.2, +96.6] | 0.0078 | inferential |
| | skill | 13.3% | 90.0% | +76.7 [+55.2, +93.3] | 0.0078 | inferential |
| Claude Code, Opus 5.5, cli | hook | 46.7% | 73.3% | +26.7 [+11.5, +41.9] | 0.0625 | descriptive: no headroom |
| | once | 46.7% | 56.7% | +10.0 [-6.3, +25.9] | 0.5000 | descriptive: no headroom |
| | system | 46.7% | 96.7% | +50.0 [+33.3, +66.7] | 0.0156 | descriptive: no headroom |
| | startup | 46.7% | 96.7% | +50.0 [+29.0, +70.0] | 0.0234 | descriptive: no headroom |
| Claude Code, Opus 5.5, sdk-preset | told | 46.7% | 100% | +53.3 [+35.5, +71.4] | 0.0078 | descriptive: no headroom |
| | skill | 46.7% | 40.0% | -6.7 [-21.9, +7.7] | 0.7500 | descriptive: no headroom |
| Claude Code, Opus 5.5, stub effect (sdk-default minus sdk-preset) | told | 100% | 100% | +0.0 [+0.0, +0.0] | 1.0000 | descriptive: no headroom |
| | skill | 40.0% | 46.7% | +6.7 [-7.1, +23.3] | 1.0000 | descriptive: no headroom |

The headroom guard is 25%: Claude Code's no-rule controls follow 14 of 30 turns (47%) and the sdk-preset skill cell the stub effect compares against 12 of 30 (40%), so every Claude Code contrast is descriptive, as in the original. None of the no-rule turns searched gbrain: they recalled from or wrote to its memory.

## What changed from the original run (descriptive)

- **Nothing that changes a reading.** Every route that reached 30 of 30 in the original reached 29 or 30 of 30 here, and every route that did nothing still does nothing.
- **Seven rows left the original's interval.** Claude Code cli's one-time copy went from 23 to 17 of 30 (original interval 61.3% to 89.7%), and its system prompt and startup file from 30 to 29 (an interval of [100, 100] by construction). Hermes's no-rule control and its placebo went from 4 to 0 of 30 (3.3% to 24.1%), OpenClaw's untold skill from 29 to 27 of 30 (90.3% to 100%), and OpenClaw's startup file from 30 to 29. The plan names gbrain#8068's per-harness rule text as the likely cause of such a move, with the model change beside it. The rule text is unlikely for the Hermes control and placebo, where it doesn't reach the model, and for OpenClaw's skill, which it opened in only 2 of 30 turns. Claude Code's model, Opus 5.5, did not change, so its three rows point at the gbrain build (its rule text or its tool descriptions) rather than the model; on the Sol harnesses this run can't separate the build from the move to GPT-6.2 Sol.
- **The no-rule controls drifted down.** Hermes went from 4 to 0 of 30, Codex and OpenClaw from 6 to 4, Claude Code cli from 18 to 14 and the SDK preset from 17 to 14. Model and build both changed, so this has no single cause; gbrain's starter tool descriptions (the only carrier in these cells) and GPT-6.2 Sol are both candidates.
- **OpenClaw followed the untold skill without opening it.** The skill's body reached a request in 2 of 30 turns, against 30 of 30 in the original, yet the agent checked gbrain first in 27 of 30. The listing alone carried it here. Hermes opened the skill in 4 of 30 turns (0 in the original); Claude Code still never opened it.
- **The three gbrain changes the amendment named.** Counted from the raw trial files in the private archive (the committed receipts don't carry gbrain's reply text, so verify does not rebuild these): gbrain#9972's saved-facts block reached the agent in 30 trials, all on Claude Code and Codex and mostly on the correction tasks (the `cr-` tasks), after the agent had saved a fact with remember. Those 30 trials passed 18; the other trials of the same cells and tasks passed 24 of 36 (descriptive, and confounded: a trial that saved a fact is a different trial). gbrain#9903's outdated-pages note appeared in no trial. gbrain#9981's get_page suggestion appeared in 4 trial files. None of the three can change whether a call happened before the reply it answers, but what a call returns could change whether the agent calls gbrain on a later turn in the same session, and this run did not isolate that.

## Pass and cost (descriptive)

- **Pass did not follow compliance.** Pass ranged from 4 to 9 of 10 per cell, with no route lifting a harness above its no-rule control in a way these 10 trials can show. The no-gbrain cells passed 7 or 8 of 10, like the gbrain cells.
- **Checking gbrain first came with out-of-scope reads, more than before.** In 35 of 360 trials a gbrain search or query returned a page from a channel the person asking is not in (the `no_cross_scope_reads` check), all in cells with a rule route and none in the no-rule controls, the placebos, the untold skills or the no-gbrain cells. The original run had 12 of 300, in the same 18 rule cells. gbrain had no per-member access rules in either run. This run can't say why the count rose: a change in gbrain's search between 0.60.547.0 and 0.60.766.0 and the move to GPT-6.2 Sol are both candidates, and Claude Code, whose model did not change, rose too (10 to 16 failing trials).
- **Following costs more.** The per-turn routes and the told skill (hook, system prompt, startup file, told) cost 1.22x to 1.69x their control per member turn on Claude Code, 1.27x to 1.40x on Codex, 1.40x to 1.48x on Hermes and 1.26x to 1.44x on OpenClaw. The one-time copy cost 0.98x (Claude Code) to 1.51x (OpenClaw). The untold skill cost 1.33x and 1.34x where it was followed (OpenClaw, Codex) and 0.86x to 1.07x where it mostly wasn't (Claude Code, Hermes).

## QM (descriptive only)

QM has no carrier for an arbitrary rule, so it ran two rows: no gbrain, and gbrain's tools with no rule. With gbrain's tools listed, it called gbrain **0 times** in 9 scored trials (0 of 28 member turns). Its last trial stopped at its lease and is excluded (below). QM's pilot showed gbrain's tools listed through the tap (initialize and tools/list), and the counted cell shows the same; with no call, the plan's "calls reach the sidecar" check has nothing to read.

## Exclusions after a cap stop

The preregistered filter ran once over every shard ([results/cap-stop-filter.out](results/cap-stop-filter.out)). Five shards had no cap stop. In `qm`, the 20th and last trial (`qm-pi-sol-gbrain-route-tool`, `sc-01-central-random-two-asks`) stopped: the proxy refused a request because its worst-case reservation on top of the reservations already open would have passed the shard's lease, while the shard's settled spend was about a third of that lease. QM sends several requests at once and each reserves the full 128,000-token output cap, so a small lease fills with reservations long before it fills with spend. The filter excludes that trial and nothing else; a cap stop is final and was not retried.

## Clean arms

- **Before each shard:** the clean-arm preflight passed on every shard's VM (no Capy drive, no user-level gstack, no gstack path in any harness image; [results/](results/) `<shard>.clean-arm-preflight.log`).
- **After the run:** `grep -rlE 'gstack|\.capy/|capy/drive'` over each shard's full `results/trials/` tree (harness state, workspaces and raw logs included) and `trials.jsonl` matched **0 files** of 30,709, and no trial read a gstack skill file ([results/clean-arm-audit.json](results/clean-arm-audit.json)).

## Grader audit (added after the results)

- **What it did:** the repo's grader audit had a model from the other family reread every failed trial (116 in 36 arms, at most 10 per arm, so all of them): GPT-6 Astra for Claude trials, Claude Opus 5.5 for GPT-6.2 Sol trials. It flagged 8 of 116.
- **All 8 were the scope check failing on what `gbrain.search` returned.** In each, a search listed a page from a channel the asker is not in, and the bot did not open or use it. The check (`no_cross_scope_reads`) counts any read that returned such a page, opened or not, so it recorded what it is defined to record. That is a fact about gbrain's search, not a grader mistake.
  - The results author recorded those 8 as real failures, with that reason, in [grader-audit-overrides.jsonl](grader-audit-overrides.jsonl). This is an agent's reread of each trial's evidence, not a person's.
  - These failures lower the descriptive pass figures only. The main measure counts the gbrain call before the first reply and does not read this check.
- **With the overrides the audit passes.** Without them it would fail in one arm, Codex told skill (3 of its 5 failed trials flagged). Every call and both verdicts are in [grader-audit.md](grader-audit.md).

## Startup rules file size

Keyless, one capture per harness and route against a fake model endpoint (`scripts/anatomy/capture.ts --scenario plain --gbrain --network internal`), on one Ubicloud VM, with the harness images built from this branch and the gbrain sidecar at `ae4bef02` (v0.60.766.0), split by `scripts/anatomy/dissect.ts` and counted by `scripts/anatomy/count-tokens.ts`: Anthropic's free count_tokens endpoint through the metering proxy for Claude Code (24 calls, $0), `o200k_base` counted locally for the GPT-6.2 Sol harnesses. The first agent request of each capture is measured. Receipts: [startup-sizes/](startup-sizes/).

| Harness | System prompt, no rule (route-tool) | With the startup file (route-startup) | With the system route (route-system) | Where the startup-file rule lands | Rule |
|---|---|---|---|---|---|
| Claude Code, Opus 5.5, cli | 6,368 bytes, 2,130 tokens | 6,368 bytes, 2,130 tokens; user text +621 bytes, +206 tokens | 6,691 bytes, 2,229 tokens | `CLAUDE.md` as user text, not the system prompt | 289 bytes |
| Codex, GPT-6.2 Sol | 19,443 bytes, 4,047 tokens | 19,443 bytes, 4,047 tokens; user text +346 bytes, +88 tokens | 19,732 bytes, 4,111 tokens | `AGENTS.md` as user text, not the system prompt | 289 bytes, 58 tokens |
| Hermes, GPT-6.2 Sol | 17,275 bytes, 3,769 tokens | 17,768 bytes, 3,896 tokens | 17,768 bytes, 3,896 tokens | `SOUL.md`, the system prompt's opening section (1,277 bytes and 269 tokens without the rule, 1,770 and 396 with it) | 491 bytes, 99 tokens |
| OpenClaw, GPT-6.2 Sol | 30,816 bytes, 6,782 tokens | 31,342 bytes, 6,907 tokens | no such setting | Project Context's `/workspace/AGENTS.md` section (68 bytes and 21 tokens without the rule, 594 and 145 with it) | 569 bytes, 118 tokens |

- **The rule is small next to what each harness already loads.** Where it lands in the system prompt it adds 64 to 127 tokens, 2% to 5% of it, against tool definitions of 2,201 (OpenClaw) to 10,664 (Claude Code) tokens in the same request.
- **Claude Code and Codex put the startup file in the user turn,** so its rule rides with the first message and then in history, which matches the proxy's copy counts in the counted run. Hermes and OpenClaw put it in the system prompt.
- Token counts on the Sol harnesses are of the text and JSON as sent; OpenAI renders tools and message framing in its own format, so its `input_tokens` differ. The Claude Code rule's own token count is not separated from its wrapper: the system route adds 99 tokens (323 bytes) and the startup file 206 tokens (621 bytes) with its file header.
- The captures ran after the counted run (deviation 8), with the same gbrain build but harness images rebuilt on the capture VM from `a3b0824f` (this branch after the counted run, with uncommitted changes in the working tree), so their image ids differ from the counted run's. Between the run commit `249cb8ec` and `a3b0824f`, `harnesses/` differs only in `qm/compose.yaml`, and QM was not captured.

## Deviations

1. **The build moved before any trial.** The plan named gbrain v0.60.754.0; the 2026-11-23 amendment froze v0.60.766.0 (`ae4bef02`), the newest release at launch, and named gbrain#9972, #9903 and #9981 and how each could move load and pass ([AMENDMENTS.md](AMENDMENTS.md)). The rule bytes and the starter tool definitions hash the same at both builds.
2. **The runner change was named after the pilot, not before it.** The plan required the launch amendment to name the runner pull request (#584, `be31b04e`) before the first pilot trial. It was an ancestor of the pilot's commit, but the amendment that names it (2026-11-24) was committed after the pilot. The counted leases moved to what the pilot's costs project in the same amendment.
3. **The pilot skipped two launch options.** It ran without the `--pre-smoke` clean-arm preflight and without an explicit `--max-output-tokens`; the default is the same 128,000. A grep of its outputs found no gstack or Capy drive path. Every counted shard ran both.
4. **The first pilot launch failed on the controller's disk** (no space left) before any trial, on one VM. It was relaunched unchanged.
5. **The first counted OpenClaw launch stalled.** An `npm install` building the Codex image inside the clean-arm preflight hung for 45 minutes. It was killed, the preflight failed, no smoke or trial ran, and the VM was destroyed. The shard was relaunched from the same commit and ran clean. Its VM record is `results/oc.first-launch.shard-vm.json`.
6. **One QM trial cap-stopped** and is excluded (above).
7. **No separate one-VM pre-smoke at the launch commit.** Each counted shard ran its own clean-arm preflight and smoke on its own VM through the fan-out's SSH path, and the pilot ran every cell once before that.
8. **The startup rules file size measure ran after the run, not before it** (below): keyless, with harness images rebuilt from `a3b0824f` (this branch after the run, with uncommitted changes in the working tree) and gbrain `ae4bef02`. It enters no test.
9. **Scorer display:** `results/instruction-followed-h10.md` prints "undefined" for cost per followed turn where no turn was followed; read it as not applicable. It labels family A "inferential"; the plan reads it descriptively.

## Why null?

### The untold skill on Hermes and Claude Code

1. **Did the model use it?** No. Hermes listed the skill in every request and opened it in 4 of 30 turns; Claude Code listed it and opened it in 0 of 30 turns on both SDK systems. The listing reached the request every time.
2. **Do the tasks fit?** Yes. Every turn is a member asking something the brain holds, and on the same tasks Hermes moved 100 points with the rule in a hook, the system prompt or the startup file.
3. **Enough samples and headroom?** Hermes: the control has headroom (0 of 30) and the skill reached 4 of 30; family B detects only hook-sized effects (48 points), so a small effect could hide. Claude Code: no headroom (14 of 30 with no rule, all memory recalls and writes, no search).
4. **Does the model already do it unaided?** Claude Code calls gbrain's memory tools unaided (14 of 30 with no rule) but never searched before replying; Hermes does neither.

**Verdict: CUT-CANDIDATE, unchanged from the original: gbrain's brain-first rule shipped as an untold skill on Hermes and Claude Code. Ship it through a per-turn hook, the system prompt or the startup file, or name the skill in the prompt.**

### The one-time copy (route-once)

1. **Did the model use it?** On first turns, yes. On repeat turns inside a session it faded on Hermes (0 of 10) and OpenClaw (3 of 10), where the copy sits in an earlier user turn; it held on Codex (10 of 10), where it sits in the system block.
2. **Do the tasks fit?** Yes, and 9 tasks have a repeat turn.
3. **Enough samples and headroom?** The repetition contrast can only detect a 39-point gap, above the 20-point margin, so it stays descriptive by the plan.
4. **Unaided?** No: Hermes and OpenClaw controls were 0 and 4 of 30.

**Verdict: FIX-METHOD, unchanged: a copy given once is not a route an installer should write; the measure needs more repeat turns to become a test.**

### Claude Code's preset system prompt (the stub effect)

The told skill reached 30 of 30 under both systems and the untold skill 12 and 14 of 30, so the stub-against-preset difference is 0.0 and +6.7 points. Claude Code calls gbrain in 14 of 30 turns with no rule (memory calls, no search), so there is no headroom on the any-call endpoint to see a system-prompt effect on these tasks.

**Verdict: FIX-METHOD, unchanged: it needs tasks where Claude Code doesn't already check gbrain unprompted.**

## Next time

### What we'd change if we ran this again

- Measure the startup rules file size on one VM before the counted run, because it ran after the run here (deviation 8), too late to inform the plan.
- Size QM's lease from its worst-case open reservations, not its expected spend, because its last trial stopped with about a third of its lease settled.
- Commit the launch amendment, naming every runner pull request, before the first pilot trial, because the one naming #584 came after the pilot (deviation 2).
- Run the pilot with the `--pre-smoke` clean-arm preflight, as the counted shards did, because the pilot skipped it (deviation 3).
- Put a time limit on the harness image builds inside the clean-arm preflight, because an `npm install` hung for 45 minutes on the first OpenClaw launch (deviation 5).

### Ideas to improve the eval

- Add tasks with more repeat turns, because with 9 such tasks the repetition contrast can only detect a 39-point gap and stays descriptive.
- Score a gbrain search before the first reply beside any gbrain call, because Claude Code's 14 of 30 no-rule turns were memory recalls and writes with no search, and the any-call endpoint leaves it no headroom.
- Run one cell per harness on the original gbrain build with GPT-6.2 Sol, because seven rows left the original's interval and this run can't tell the model change from the build change.

## Limits

- 10 public dev tasks, one repetition: no held-out tasks, and a cell's interval rests on 10 task clusters.
- One model per harness, so a harness difference is also a model difference.
- The comparison with the original run is descriptive: the gbrain build and the Sol model both changed.
- Family B detects only large effects (48 points on Claude Code cli, OpenClaw and Hermes; 58 to 59 on Codex), so a null on a skill route is read with that beside it.

## Reproduce and inspect

- Merge: `bun scripts/merge-shards.ts --out <dir> --shard cx=<cx results> --shard he=<he results> --shard oc=<oc results> --shard cc-cli=<cc-cli results> --shard cc-sdk=<cc-sdk results> --shard qm=<qm results>`.
- Analysis, from the repository root: `bun scripts/instruction-followed-h10.ts --results docs/benchmarks/2026-11-20-h10-rule-placement-rerun/results --prereg docs/benchmarks/2026-11-20-h10-rule-placement-rerun/prereg.json --out docs/benchmarks/2026-11-20-h10-rule-placement-rerun/results`, then `bun docs/benchmarks/2026-11-20-h10-rule-placement-rerun/report-extras.ts` ([reproduce.md](reproduce.md)).
- Receipts in [results/](results/): the merged `trials.jsonl` and `trials/` (evaluator records, grades, usage and the adapter's route records), each shard's manifest, run log, proxy log and usage, ledger, smoke trials and ledger, VM record and clean-arm log; `instruction-followed-h10.{json,md,out}`, `report-extras.{json,out}` (the run's spend goes to `spend.json`, which the public copy leaves out), `cap-stop-filter.out` and `clean-arm-audit.json`. The pilot's trials, ledgers and VM records are in [pilot/](pilot/).

## Disclosures

gbrain is Garry Tan's own project.

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.
