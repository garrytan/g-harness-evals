# H10: where must an instruction live to be obeyed? (h10-instruction-placement-2026-11): report

**Answer: put the rule where the model sees it on every turn.** On GPT-6.1 Sol, gbrain's 289-byte "check gbrain first" rule got Codex, Hermes and OpenClaw to call gbrain before answering in **30 of 30 member turns** through the per-turn hook, the system prompt and the startup file (system prompt on Codex and Hermes; OpenClaw has no such setting). With no rule, they did it in 4 to 6 of 30. On Claude Code (Opus 5.5) the system prompt, the startup file and a told skill also reached 30 of 30, but Opus already checked gbrain in 17 to 18 of 30 turns with no rule, so every Claude Code contrast is descriptive. Every number is dev: 10 public tasks, one repetition, at these pins.

- **An untold skill works on two harnesses and does nothing on two others.** It worked on Codex (30 of 30) and OpenClaw (29 of 30). On Hermes it did nothing (4 of 30, the same as no rule), and on Claude Code it did nothing either (18 of 30 against 17). On Hermes and Claude Code the model saw the skill's name in every request and opened the skill **0 times in 30 turns** per cell.
- **Naming the skill in the prompt reached every turn on Claude Code.** With "Use the brain-first skill.", Claude Code (SDK preset) checked gbrain in 30 of 30 turns, against 18 for the untold skill and 17 for no rule. Descriptive, because that control has no headroom.
- **A one-time copy fades on repeat turns.** On repeat turns inside a session, a copy given once was followed in 2 of 10 turns on Hermes and 4 of 10 on OpenClaw, against 10 of 10 for the per-turn hook. Pooled over four harnesses that is **-38.9 points [-50.0, -27.8]** (sign-flip p 0.0078, Holm 0.0078). It is descriptive by the preregistered rule: this contrast could only detect a 39-point gap, and the claim margin is 20 points.
- **The one-time copy trailed one copy in the system prompt** (route-once minus route-system) by **-17.5 points [-26.1, -10.6]** (p 0.0039, Holm 0.0078), pooled over Claude Code, Hermes and Codex. Only the Hermes pair put the one-time copy in the user turn; on Claude Code and Codex both copies sat in the system block. Also descriptive (minimum detectable difference 25 points).
- **The placebo did nothing.** 289 bytes of unrelated text in the same slot: Codex 5 of 30 and Hermes 4 of 30, against 6 and 4 with no rule. So the words carry the effect, not the slot.
- **Following the rule costs more per turn.** Every route that raised compliance cost 10% to 55% more per member turn than its harness's no-rule control (descriptive), and pass rate did not move with it.
- **Why null? verdicts:** the untold skill on Hermes and Claude Code is **CUT-CANDIDATE**; the one-time copy and Claude Code's stub-against-preset system prompt are **FIX-METHOD** ([Why null?](#why-null)).
- **Spend: $60.57 of the $250 cap** at the launch commit (counted $55.91, smokes $4.65), plus $5.50 for the first launch and the smoke measurement, and Ubicloud VMs at $4.28 list price. 300 of 300 trials completed, 0 cap stops, 0 trials excluded, and the clean-arm audit found 0 hits.

## What ran

- **Run** `h10-instruction-placement-2026-11`, launched 2026-11-07 (UTC) from `fc5547d2b433`, the commit on this branch that adds Amendment 1 to [PREREGISTRATION.md](PREREGISTRATION.md). The preregistration merged as `45eb516257b1` (#315).
- **Harnesses and models:** Claude Code 2.1.312 on Opus 5.5 (`anthropic:claude-opus-5-5`), driven two ways: the cli (`claude -p`) and the Agent SDK 0.3.312. Codex 0.165.0, Hermes Agent v2026.9.24 (serve) and OpenClaw 2026.10.6 on GPT-6.1 Sol (`openai:gpt-6.1-sol`). One model per harness, so a harness difference is a harness-and-model difference.
- **gbrain:** the starter surface (33 tools) from the pinned image at gbrain `2c469d1b` (0.60.547.0), one bot-visible brain, no per-member access rules.
- **Tasks:** 10 public v0.3 dev tasks, 30 member turns, 10 of them repeat turns inside a session (9 tasks). One repetition per cell.
- **Cells:** 30 cells, 300 trials, five Ubicloud shards (`cc-cli`, `cc-sdk`, `cx`, `he`, `oc`), whole cells, trials sequential within a shard. `cx` ran first as the canary. The other four started after it had 4 scored trials copied off its VM.
- **Followed** means the agent made a gbrain call before its first reply of the turn (`scripts/instruction-followed.ts` turnOutcomes).
- **Routes** (where the rule goes): `route-tool` is the no-rule control (gbrain registered, nothing said). `route-hook` adds the rule every turn through a hook, `route-once` adds it once per session, `route-system` puts it in the system prompt, `route-startup` in the harness's startup file. `route-skill` installs it as a skill and says nothing, `route-told` installs the skill and adds "Use the brain-first skill." to the task preamble. `route-placebo` is the hook with 289 bytes of unrelated text.
- **Not run at frontier, as preregistered:** told on OpenClaw and Hermes, placebo on OpenClaw and Claude Code, system on OpenClaw (OpenClaw has no such setting).

## Per-cell results

Followed is member turns with a gbrain call before the first reply, with a task-clustered bootstrap 95% interval (10,000 draws, seed 7). A cell at 30 of 30 has the interval [100, 100] by construction, so its interval says nothing about uncertainty. Discovery and load come from the metering proxy's copy counts: for rule routes, discovery means the rule reached the request; for skill routes, discovery means the skill's name was listed, and load means the skill's body reached a request. Cost is the proxy's USD per member turn. Pass is descriptive.

| Harness, driver, model | Route | Followed [95% CI] | Repeat turns | Discovery | Load | Pass | $ per member turn |
|---|---|---|---|---|---|---|---|
| Claude Code, cli, Opus 5.5 | tool (control) | 18 / 30, 60.0% [40.6, 76.7] | 6 / 10 | n/a | n/a | 6 / 10 | 0.0762 |
| | hook | 26 / 30, 86.7% [73.3, 100] | 10 / 10 | 30 / 30 | 30 / 30 | 7 / 10 | 0.0886 |
| | once | 23 / 30, 76.7% [61.3, 89.7] | 8 / 10 | 30 / 30 | 30 / 30 | 5 / 10 | 0.0838 |
| | system | 30 / 30, 100% | 10 / 10 | 30 / 30 | 30 / 30 | 7 / 10 | 0.1121 |
| | startup | 30 / 30, 100% | 10 / 10 | 30 / 30 | 30 / 30 | 6 / 10 | 0.1070 |
| Claude Code, SDK preset, Opus 5.5 | tool (control) | 17 / 30, 56.7% [36.7, 76.7] | 6 / 10 | n/a | n/a | 6 / 10 | 0.0757 |
| | told | 30 / 30, 100% | 10 / 10 | 30 / 30 | 30 / 30 | 5 / 10 | 0.1129 |
| | skill | 18 / 30, 60.0% [38.5, 79.3] | 6 / 10 | 30 / 30 | **0 / 30** | 6 / 10 | 0.0712 |
| Claude Code, SDK default (stub), Opus 5.5 | told | 30 / 30, 100% | 10 / 10 | 30 / 30 | 30 / 30 | 8 / 10 | 0.1134 |
| | skill | 17 / 30, 56.7% [35.3, 77.4] | 7 / 10 | 30 / 30 | **0 / 30** | 6 / 10 | 0.0751 |
| Codex, GPT-6.1 Sol | tool (control) | 6 / 30, 20.0% [3.7, 38.5] | 2 / 10 | n/a | n/a | 7 / 10 | 0.0403 |
| | hook | 30 / 30, 100% | 10 / 10 | 30 / 30 | 30 / 30 | 7 / 10 | 0.0519 |
| | once | 30 / 30, 100% | 10 / 10 | 30 / 30 | 30 / 30 | 7 / 10 | 0.0532 |
| | system | 30 / 30, 100% | 10 / 10 | 30 / 30 | 30 / 30 | 7 / 10 | 0.0533 |
| | startup | 30 / 30, 100% | 10 / 10 | 30 / 30 | 30 / 30 | 7 / 10 | 0.0551 |
| | told | 30 / 30, 100% | 10 / 10 | 30 / 30 | 30 / 30 | 10 / 10 | 0.0626 |
| | skill | 30 / 30, 100% | 10 / 10 | 30 / 30 | 30 / 30 | 9 / 10 | 0.0597 |
| | placebo | 5 / 30, 16.7% [3.4, 32.3] | 1 / 10 | 30 / 30 | 30 / 30 | 7 / 10 | 0.0386 |
| Hermes, GPT-6.1 Sol | tool (control) | 4 / 30, 13.3% [3.3, 24.1] | 0 / 10 | n/a | n/a | 7 / 10 | 0.0447 |
| | hook | 30 / 30, 100% | 10 / 10 | 30 / 30 | 30 / 30 | 6 / 10 | 0.0545 |
| | once | 22 / 30, 73.3% [60.0, 86.2] | **2 / 10** | 30 / 30 | 30 / 30 | 7 / 10 | 0.0521 |
| | system | 30 / 30, 100% | 10 / 10 | 30 / 30 | 30 / 30 | 7 / 10 | 0.0539 |
| | startup | 30 / 30, 100% | 10 / 10 | 30 / 30 | 30 / 30 | 7 / 10 | 0.0537 |
| | skill | 4 / 30, 13.3% [3.3, 24.1] | 0 / 10 | 30 / 30 | **0 / 30** | 7 / 10 | 0.0451 |
| | placebo | 4 / 30, 13.3% [3.3, 24.1] | 0 / 10 | 30 / 30 | 30 / 30 | 7 / 10 | 0.0429 |
| OpenClaw, GPT-6.1 Sol | tool (control) | 6 / 30, 20.0% [3.4, 39.3] | 2 / 10 | n/a | n/a | 7 / 10 | 0.0299 |
| | hook | 30 / 30, 100% | 10 / 10 | 30 / 30 | 30 / 30 | 6 / 10 | 0.0385 |
| | once | 24 / 30, 80.0% [64.3, 93.6] | **4 / 10** | 30 / 30 | 30 / 30 | 7 / 10 | 0.0358 |
| | startup | 30 / 30, 100% | 10 / 10 | 30 / 30 | 30 / 30 | 7 / 10 | 0.0416 |
| | skill | 29 / 30, 96.7% [90.3, 100] | 10 / 10 | 30 / 30 | 30 / 30 | 7 / 10 | 0.0404 |

- Sources: counts, discovery, load and pass from [instruction-followed-h10.md](results/instruction-followed-h10.md); intervals and cost per turn from [report-extras.json](results/report-extras.json), which checks its counts against the scorer's (all 30 match).
- Every trial ended `completed`. No trial was excluded, so every cell scored 10 trials and 30 turns.
- Hermes ran with the Tirith scanner on. Its 210 recorded turns show **0 approval cards and 0 Tirith blocks**, so no gbrain call was blocked.
- The scorer's cross-checks (session keys and the adapters' own per-turn route status) found 0 mismatches in every cell.

**Where the rule landed** (copies per request by location, from the proxy's `route_copies`, in [instruction-followed-h10.md](results/instruction-followed-h10.md)):

- **Claude Code** carries the hook, once and system routes in the system block (1.00 to 1.32 copies per request), and the startup file as user text (0.72) plus history (0.28).
- **Codex** carries hook, once and system in the system block (1.00 to 1.28), startup as user text plus history, and the skill and told routes as a tool result (0.86 and 0.87 per request), the body arriving when the model reads the skill.
- **Hermes** carries hook, once and placebo as user text with history, and system and startup in the system block (1.00). Its skill route put only the listing in the request (1.00 per request) and **never the body** (0.00 copies per trial).
- **OpenClaw** carries hook and once as user text with history, startup in the system block (0.99), and the skill body as a tool result (0.88).
- **Claude Code's untold skill** (both SDK systems) also put only the listing in the request, never the body.

## Family A (descriptive by the preregistered rule)

**Both family A contrasts are descriptive.** The preregistration fixed a 20-point claim margin, and the minimum detectable difference (MDD) was 39 points for repetition and 25 for placement ([mdd.md](mdd.md)). So the table prints the estimate, interval, sign-flip p and Holm p, and claims nothing either way. The scorer labels both "inferential" because each meets its task-cluster floor; the claim-margin rule overrides that label.

| Contrast (route-once minus ...) | Turns | Pairs pooled | Tasks | Difference, points [95% CI] | Sign-flip p | Holm p |
|---|---|---|---:|---|---:|---:|
| Repetition: minus route-hook | repeat turns | Claude Code cli (Opus), Codex, Hermes, OpenClaw (Sol) | 9 | **-38.9 [-50.0, -27.8]** | 0.0078 | 0.0078 |
| Placement: minus route-system | all member turns | Claude Code cli (Opus), Hermes, Codex (Sol) | 10 | **-17.5 [-26.1, -10.6]** | 0.0039 | 0.0078 |

Each pair's own estimate:

| Contrast | Pair | Difference, points [95% CI] | p |
|---|---|---|---:|
| Repetition | Claude Code cli, Opus 5.5 (the only Opus read) | -20.0 [-50.0, +0.0] | 0.5000 |
| Repetition | Codex, Sol | +0.0 [+0.0, +0.0] (both 10 of 10) | 1.0000 |
| Repetition | Hermes, Sol | -80.0 [-100.0, -50.0] | 0.0156 |
| Repetition | OpenClaw, Sol | -60.0 [-90.0, -22.2] | 0.0625 |
| Placement | Claude Code cli, Opus 5.5 (the only Opus read) | -23.3 [-38.7, -10.3] | 0.0313 |
| Placement | Hermes, Sol | -26.7 [-40.0, -13.8] | 0.0156 |
| Placement | Codex, Sol | +0.0 [+0.0, +0.0] (both 30 of 30) | 1.0000 |

No pair dropped: no shard cap-stopped, so every harness stayed in family A.

## Family B (each route against its own control)

Each route minus its own control in the same harness, model and driver, paired on task and turn, exact sign-flip test over 10 tasks, Holm within each family.

**Claude Code has no headroom, so all eight Claude Code contrasts are descriptive.** Its no-rule controls followed 60.0% (cli) and 56.7% (SDK preset) of turns, above the preregistered 25% headroom guard. The stub-effect family's told control (sdk-preset told) sat at 100%.

| Family | Route | Control | Route | Difference, points [95% CI] | p | Holm p | Reading |
|---|---|---:|---:|---|---:|---:|---|
| Claude Code, cli, Opus 5.5 | hook | 60.0% | 86.7% | +26.7 [+12.1, +44.8] | 0.0313 | 0.0625 | descriptive: no headroom |
| | once | 60.0% | 76.7% | +16.7 [+3.6, +31.0] | 0.1250 | 0.1250 | descriptive: no headroom |
| | system | 60.0% | 100% | +40.0 [+23.3, +59.4] | 0.0078 | 0.0313 | descriptive: no headroom |
| | startup | 60.0% | 100% | +40.0 [+23.3, +59.4] | 0.0078 | 0.0313 | descriptive: no headroom |
| Claude Code, SDK preset, Opus 5.5 | told | 56.7% | 100% | +43.3 [+23.3, +63.3] | 0.0156 | 0.0313 | descriptive: no headroom |
| | skill | 56.7% | 60.0% | +3.3 [+0.0, +9.7] | 1.0000 | 1.0000 | descriptive: no headroom |
| Claude Code, stub effect (SDK default minus SDK preset), Opus 5.5 | told | 100% | 100% | +0.0 [+0.0, +0.0] | 1.0000 | 1.0000 | descriptive: no headroom |
| | skill | 60.0% | 56.7% | -3.3 [-12.9, +7.4] | 1.0000 | 1.0000 | descriptive: no headroom |
| Codex, GPT-6.1 Sol | hook, once, system, startup, told, skill (each) | 20.0% | 100% | +80.0 [+61.5, +96.3] | 0.0020 | 0.0137 | inferential |
| | placebo | 20.0% | 16.7% | -3.3 [-10.7, +0.0] | 1.0000 | 1.0000 | inferential |
| Hermes, GPT-6.1 Sol | hook, system, startup (each) | 13.3% | 100% | +86.7 [+75.9, +96.7] | 0.0020 | 0.0117 | inferential |
| | once | 13.3% | 73.3% | +60.0 [+50.0, +68.8] | 0.0020 | 0.0117 | inferential |
| | skill | 13.3% | 13.3% | +0.0 [+0.0, +0.0] | 1.0000 | 1.0000 | inferential |
| | placebo | 13.3% | 13.3% | +0.0 [+0.0, +0.0] | 1.0000 | 1.0000 | inferential |
| OpenClaw, GPT-6.1 Sol | hook, startup (each) | 20.0% | 100% | +80.0 [+60.7, +96.6] | 0.0039 | 0.0156 | inferential |
| | once | 20.0% | 80.0% | +60.0 [+34.5, +80.6] | 0.0098 | 0.0156 | inferential |
| | skill | 20.0% | 96.7% | +76.7 [+58.6, +92.3] | 0.0039 | 0.0156 | inferential |

- **Read these as harness-and-model results.** Codex, Hermes and OpenClaw ran Sol; Claude Code ran Opus. No line here says anything about Opus on Codex or Sol on Claude Code.
- **The cli and SDK rows never compare to each other** (Limits).
- Family B's MDD was 39 to 59 points ([mdd.md](mdd.md)). Every Sol rule route's estimate was above it; the three Sol nulls sit at or near 0: Hermes skill and placebo at exactly 0, with 86.7 points of room above the control, and Codex placebo at -3.3 [-10.7, +0.0].

## Pass and cost (descriptive)

- **Pass did not move with compliance.** Pass ran from 5 to 8 of 10 per cell on Claude Code and 6 to 10 of 10 on Sol. 78 of the 95 failures were on three retraction tasks (`cr-02`, `cr-03`, `cr-04`), on every harness.
- **12 trials failed only because gbrain search returned a page from a channel the asker was not in** (`no_cross_scope_reads`): 10 on Claude Code (`cn-03` and `sc-02`, in rule and told cells), 1 on Hermes and 1 on OpenClaw, all on hook cells. This brain had no per-member access rules. Another 4 Claude Code trials failed `no_leak` on `sc-02` (control and skill cells).
- **Rule routes cost more per member turn than their control:** Claude Code cli 1.10x (once) to 1.47x (system), SDK told 1.49x; Codex 1.29x (hook) to 1.55x (told); Hermes 1.17x (once) to 1.22x (hook); OpenClaw 1.20x (once) to 1.39x (startup) ([report-extras.json](results/report-extras.json), `per_cell`). The cells that did nothing cost about what the control cost (Hermes skill 1.01x, placebos 0.96x).

## gbrain, per harness

What reached the model, which route worked, and what it cost. The per-turn cost against no gbrain at all is the amendment's sy-01 smoke table ([PREREGISTRATION.md](PREREGISTRATION.md), Amendment 1, section 10): one smoke per cell on `sy-01-quarrendon-ticket-numbers`, against matrix-mu-2026-11's no-gbrain arm of the same harness and model. Its headline column is the route-tool control. The counted run's per-turn cost is beside it.

| Harness, model | Amendment: route-tool control / no gbrain (sy-01, n = 1) | Counted: route-tool control $ per member turn | Counted: control against matrix-mu no gbrain, same 10 tasks (descriptive, another run) |
|---|---:|---:|---:|
| Claude Code cli, Opus 5.5 | **1.70x** | 0.0762 | 1.47x |
| Claude Code SDK, Opus 5.5 | **2.05x** | 0.0757 | 1.47x |
| Codex, GPT-6.1 Sol | **1.26x** | 0.0403 | 1.24x |
| Hermes, GPT-6.1 Sol | **1.20x** | 0.0447 | 1.11x |
| OpenClaw, GPT-6.1 Sol | **1.03x** | 0.0299 | 0.94x |

- The last column divides this run's control by matrix-mu-2026-11's no-gbrain cell on the same 10 tasks (4 repetitions, at `de7f7cd`). For OpenClaw it leaves out one matrix-mu trial that carries a $1.4323 timed-out reservation charge; with that trial in, it reads 0.69x ([report-extras.json](results/report-extras.json)).
- **Claude Code (Opus 5.5).** What reached it: hook, once and system routes in the system block; startup as user text; the untold skill only as a listing. What worked: system and startup 30 of 30, told 30 of 30, hook 26 of 30. What did not: the untold skill (0 loads in 60 turns over both SDK systems). Opus calls gbrain on its own in 17 to 18 of 30 turns, so a rule adds 17 to 43 points here (descriptive). All 10 cross-scope failures in this run's Claude Code cells came through gbrain search.
- **Codex (GPT-6.1 Sol).** Every route worked, untold skill included: 30 of 30 against 6. Codex opened the skill file itself and the body reached the model as a tool result. The rule cost 1.29x to 1.55x the control per turn.
- **Hermes (GPT-6.1 Sol).** What worked: hook, system prompt setting and startup, 30 of 30 against 4. The one-time copy reached 22 of 30 but only 2 of 10 repeat turns. The untold skill reached the model as a listing in all 30 turns and was never opened. No gbrain call met an approval card or a Tirith block.
- **OpenClaw (GPT-6.1 Sol).** What worked: hook and startup (30 of 30), and the untold skill (29 of 30, body loaded as a tool result). The one-time copy reached 4 of 10 repeat turns. It was the cheapest of the four per member turn.
- **Best route, on these tasks:** the startup file reached 30 of 30 on all four harnesses, and the per-turn hook did on the three Sol harnesses (26 of 30 on Claude Code). The system prompt reached 30 of 30 wherever it was run (OpenClaw has none). On Claude Code the untold skill needs the told line; on Hermes the told line was not run.

## Exclusions after a cap stop

The preregistered filter ran once over every shard ([results/cap-stop-filter.out](results/cap-stop-filter.out)). No shard had a `cap_stop`, so nothing was excluded.

| Shard | First cap_stop index | Records | Excluded | Kept |
|---|---|---:|---:|---:|
| `cc-cli` | none | 50 | 0 | 50 |
| `cc-sdk` | none | 50 | 0 | 50 |
| `cx` | none | 80 | 0 | 80 |
| `he` | none | 70 | 0 | 70 |
| `oc` | none | 50 | 0 | 50 |

The scorer read a copy of the merged results whose `trials.jsonl` held only the filtered records. It is byte-identical to the merged `trials.jsonl`, which was never edited.

## Clean arms

- **Preflight:** `scripts/matrix/clean-arm-preflight.sh` passed on every shard VM before any key: host, mounts and all six images clean (`results/<shard>.clean-arm-preflight.log`). It also passed on the one-VM pre-smoke at `fc5547d`.
- **Post-run audit:** `grep -rlE 'gstack|\.capy/|capy/drive'` over each shard's full `results/trials/` tree (harness state, workspaces and raw logs included) and `trials.jsonl` matched **0 of 31,758 files**. Reads of a gstack skill file: **0 in every arm**. No cell is contaminated ([results/clean-arm-audit.json](results/clean-arm-audit.json)).

## Deviations

Every entry in the run log, in order, plus what the write-up changed.

1. **The first launch at `45eb516` failed its smoke-cost gate.** The `cx` canary's first smoke (route-tool, a no-rule cell) cost $0.1287 for one member turn against its $0.0643 ceiling. The coordinator interrupted the shard at 16:01:09Z, and the second smoke (route-hook, $0.1253 against $0.1240) finished during the interrupt. The VM was destroyed at 16:01:35Z. No counted trial ran and the $27.75 counted lease never opened.
2. **One reservation stayed open in that canary's smoke ledger: $1.6117** (entry `a6d05b14-e4fe-47de-89f9-d68d939eaf6d`, the route-told smoke's call in flight at the interrupt). The proxy logged no usage for it and no ledger command can settle it, so it stays committed at its reservation. That ledger overstates its spend by up to $1.6117. It is counted in every total below.
3. **Order deviation: a smoke-only measurement ran before the canary had a scored trial.** To re-cost, the other four shards' smokes ran on their own at `45eb516` (uncounted scratch preregistrations, `--no-smoke`, each under its shard's smoke lease and its own ledger). No counted preregistration, destination or lease was used. Receipts: [smoke-measurement/](smoke-measurement/).
4. **One measurement smoke cap-stopped:** `claude-code-opus-gbrain-sdk-preset-route-skill-mu-v03-dev` ended `model_error` with `cap_stop` after one refused call. It was recorded, not retried.
5. **Amendment 1 re-costed the leases and the gate, and raised the cap to $250** (booking $1,200), before any counted trial. It was committed on this branch as `fc5547d` and every shard launched from that commit, not from `45eb516`. Under the two-PRs-per-experiment rule, its own pull request (#324) closed unmerged and it merges here. Between `45eb516` and `fc5547d`, the pinned paths changed in two files only, `scripts/v04/cal-report.ts` and `scripts/v04/round-results.ts`, which H10 does not run.
6. **Relaunch at `fc5547d`:** a new pinned worktree; the one-VM pre-smoke reran there and passed; `cx` launched alone; every smoke-cost gate passed (largest smoke per turn: `cc-cli` $0.3004 against $0.6990, `cc-sdk` $0.3086 against $0.6998, `cx` $0.1626 against $0.4105, `he` $0.1009 against $0.3069, `oc` $0.1666 against $0.4480). One `cc-sdk` smoke (sdk-default told) graded fail and completed, which the gate allows.
7. **No machine restarts, no relaunch, and every VM down** (`list --mine` empty at lane end).
8. **The controller's cap-stop filter and audit outputs stayed on the controller machine.** The results writer reran the filter's exact command on copies of each shard's `manifest.json` and `trials.jsonl` (its five `trials.filtered.jsonl` files are byte-identical to the controller's) and reran the audit over the same trees.
9. **The scorer prints counts but no per-cell interval,** though the Endpoints section names one. [report-extras.ts](report-extras.ts) computes it with the preregistered estimator (task-clustered bootstrap, 10,000 draws, seed 7) on the scorer's own turn rule, without changing the scorer.
10. **No `summarize-run` or `compare-run` output.** The preregistration names only `scripts/instruction-followed-h10.ts` for scoring.

## Why null?

Three results here are null or negative for a part of the stack: the untold skill, the one-time copy, and Claude Code's preset system prompt. The placebo's null is the design working (the content control), so it gets no verdict.

### The untold skill on Hermes and Claude Code

Hermes skill 4 of 30 against a control of 4 (+0.0, Holm p 1.000). Claude Code SDK preset skill 18 against 17 (+3.3 [+0.0, +9.7]) and SDK default skill 17 of 30. The same route worked on Codex (+80.0) and OpenClaw (+76.7).

1. **Exposure: the name reached the model, the body never did.** The proxy saw the skill listing in every counted request of all three cells (1.00 per request) and the rule's bytes in none (load 0 of 30 in each cell). The adapter wrote the skill (`logs/instruction-route.json`: `brain-first`, "Check GBrain first, before answering any turn."). The model saw a one-line description and chose not to open it.
2. **Fit: yes.** Every turn is a member asking something the brain holds. On the same tasks, Hermes moved 86.7 points with the rule in a hook, the system prompt or the startup file.
3. **Power and saturation: not saturated on Hermes.** The Hermes control sat at 13.3%, with 86.7 points of room and an MDD of 48. A hook-sized effect would have shown; the estimate is exactly 0. On Claude Code the control sat at 56.7% to 60.0% (over the 25% guard), but the load count, 0 of 60, settles it without a test: the body never reached the model.
4. **Model: frontier only** (Opus 5.5 and GPT-6.1 Sol).

**Verdict: CUT-CANDIDATE: gbrain's brain-first rule shipped as an untold skill on Hermes and Claude Code; ship it through a per-turn hook, the system prompt or the startup file, or name the skill in the prompt.**

### The one-time copy (route-once)

Descriptive, as preregistered. Against the per-turn hook on repeat turns: -38.9 [-50.0, -27.8], with Hermes -80.0 and OpenClaw -60.0. Against one copy in the system prompt: -17.5 [-26.1, -10.6].

1. **Exposure: yes.** The copy reached the first request of every turn (discovery 30 of 30 in each cell). On Hermes and OpenClaw it sat in the first user turn and then in history (0.74 to 0.80 copies per request as user text and 0.20 to 0.26 in history); on Claude Code and Codex it sat in the system block of every request.
2. **Fit: yes.** 9 of the 10 tasks have a repeat turn inside a session, which is what this contrast needs.
3. **Power and saturation: underpowered by design, and one pair saturated.** n = 9 task clusters for repetition and 10 for placement; MDD 39 and 25 points against a 20-point claim margin. Codex's pairs sat at 100% on both sides. Against its own control, the one-time copy still gained +60.0 on Hermes and OpenClaw (inferential).
4. **Model: frontier only.**

**Verdict: FIX-METHOD: rerun repetition and placement on enough tasks with repeat turns to bring the minimum detectable difference under the 20-point claim margin.**

### Claude Code's preset system prompt (the stub effect)

SDK default (the stub) minus SDK preset: told +0.0 (both 30 of 30), skill -3.3 [-12.9, +7.4].

1. **Exposure: yes.** In the keyless capture before the run, the preset's guidance blocks (2 and 3) matched the cli's byte for byte, its header differed only in the entrypoint, and the default got the stub ([GOLDENS.md](GOLDENS.md), section 3).
2. **Fit: partial.** The preset's skill guidance should matter for the untold skill, but the skill loaded 0 times under either prompt, so the endpoint never reached the place the guidance acts.
3. **Power and saturation: saturated.** Told sat at 30 of 30 under both prompts, and Opus's no-rule control at 56.7%, over the 25% headroom guard. MDD 39 to 40 points.
4. **Model: frontier only** (Opus 5.5).

The null rests on saturation, so under our rule it gets one ceiling-raise before any cut.

**Verdict: FIX-METHOD: raise the ceiling by testing the stub against the preset on held-out tasks where Opus's no-rule control calls gbrain in under 25% of turns, scoring whether the skill body loads.**

## Limits

- **One repetition, 10 public dev tasks.** Family A clears its 20-point claim margin on neither contrast, so it is descriptive. Family B detects only large effects (MDD 39 to 59 points).
- **Between-harness differences are harness-and-model differences.** Claude Code ran Opus 5.5; the other three ran GPT-6.1 Sol.
- **The Claude Code cli and SDK cells differ in more than the driver.** The SDK cells load `settingSources: ["user"]` only, while the cli also loads the workspace `CLAUDE.md` and `.claude` settings; the Bash background timeout text differs; and the entrypoint header differs (`cc_entrypoint=sdk-cli` against `sdk-ts`). So a cli against SDK difference is a driver-and-setup difference and is never read as an instruction-placement effect.
- **Placebo and told coverage is partial at frontier** (told on Claude Code SDK and Codex; placebo on Codex and Hermes).
- **Hermes ran with Tirith on**, unlike every earlier Hermes receipt.
- **The brain had no per-member access rules,** so a rule that drives more gbrain search also drives more cross-scope reads (12 trials here).
- **Spend includes the open $1.6117 reservation** from the first launch, which may overstate that ledger by up to that amount.

## Money

From the lease ledgers, to the cent ([report-extras.json](results/report-extras.json), `spend` and `vms`).

| Item | Amount |
|---|---:|
| Counted ledgers, five shards at `fc5547d` (`cc-cli` $14.0314, `cc-sdk` $13.4499, `cx` $12.4424, `he` $10.4046, `oc` $5.5864) | $55.91 |
| Smoke ledgers at `fc5547d` (`cc-cli` $1.1603, `cc-sdk` $1.1850, `cx` $1.0124, `he` $0.6600, `oc` $0.6363) | $4.65 |
| **Launch at `fc5547d`, against the $250 cap** ($55.9148 + $4.6540; rows rounded separately) | **$60.57** |
| First launch and smoke-only measurement at `45eb516` (settled $3.8863 plus the open $1.6117) | $5.50 |
| **Paid model calls, all launches** | **$66.07** |
| Ubicloud VMs at list price: `fc5547d` shards $3.3937 and pre-smoke $0.0670; `45eb516` pre-smoke $0.0670, `cx` canary $0.1089, four smoke-only VMs $0.6453 | $4.28 |

- The trial records' own USD sums to $55.9148, the same as the counted ledgers.
- Every counted ledger entry is reconciled; the only open entry is the $1.6117 above.
- Leases were $226.78 counted and $23.19 smoke. No shard came near its lease (largest: `cc-cli` $14.03 of $50.78).

All-in: about $957 against a $1,200 booking and the $2,000 all-in ceiling per eval (2026-11-07, before this report's review):

- Earlier runs of this question: at most $517 (an upper bound) and about $157.
- Agent model use for this run: about $213 (the run's agent credit reading on 2026-11-07, at about $1 per 1,000 credits; not a file in this repository).
- Paid model calls: $5.50 for the first launch and the cost-measurement runs (the open $1.61 reservation included) and $60.57 for the counted launch.
- Ubicloud VMs at list price: $4.28.

Projected final, including this report's single review: about $975 (the same credit reading plus the review's estimate).

## Reproduce and inspect

```sh
bun scripts/instruction-followed-h10.ts --results docs/benchmarks/2026-11-07-h10-instruction-placement/results --prereg docs/benchmarks/2026-11-07-h10-instruction-placement/prereg.json --out /tmp/h10
bun docs/benchmarks/2026-11-07-h10-instruction-placement/report-extras.ts --check
```

<details><summary>What is in results/ and what stayed out</summary>

- Per shard: the counted and smoke ledgers, proxy usage logs, run and proxy logs, `preflight.log`, `clean-arm-preflight.log` (the run-shard and clean-arm lines of the shard's run log), `preflight-provenance.json`, `run-summary.json`, `shard.json`, `shard-vm.json` and the shard manifest. The first launch's canary VM is `cx.first-launch.shard-vm.json`, and the four smoke-only VMs are `<shard>.smoke-only.shard-vm.json`.
- Merged: `trials.jsonl`, `manifest.json`, `shards.json`, and per trial `events.jsonl`, `turns.jsonl`, each turn's request and response, `snapshot.json.gz`, `usage.json`, `reconcile.json`, `grade.json`, and from the harness logs only the adapter's route record (`logs/instruction-route.json`) and per-turn route and security status (`logs/turns/*.route.json`, `*.security.json`), which the scorer reads.
- Analysis: `instruction-followed-h10.{json,md,out}`, `report-extras.{json,out}`, `cap-stop-filter.out` and `clean-arm-audit.json`.
- **Stayed out, as in matrix-mu-2026-11:** each trial's `trial.json` (it holds the per-trial gbrain sidecar bearer token in its harness config), `gbrain/` (sidecar logs), the preflight's `preflight-gbrain-starter/` directories, harness `state/`, `workspace/` and the rest of `logs/`, and the run and fan-out logs (they name each VM's public address). The full results tree (979 MB) is on the run machine under `~/.capy/work/h10-run/merged-fc5547d/`; our team's shared drive holds a partial replica of each shard's run files. Every gbrain token in those files was minted for one trial on a VM that has been destroyed.
- **One redaction:** in the five `clean-arm-preflight.log` copies, the replica path in each `replicate` WARNING line names our team's shared drive as `<captain-drive>/handoffs/<this-lane>/run/`. Nothing else in those lines or files changed.
- A token scan over every committed file (gzip snapshots decoded, ledgers read raw and row by row) found no provider key, bearer value, Authorization header or key-shaped string.

</details>

## Disclosures

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI. OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

gbrain is Garry Tan's own project.

gstack is Garry Tan's own project.
