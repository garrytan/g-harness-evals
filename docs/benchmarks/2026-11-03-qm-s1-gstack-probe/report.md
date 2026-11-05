# S1 probe: does QM open gstack skills through gstack's paste-in router, on Opus 5.5 and GPT-6.1 Sol?

Status: **results** of `qm-s1-gstack-probe-2026-11` (HARN-38, GST-358, 2026-11-04), preregistered in [PREREGISTRATION.md](PREREGISTRATION.md) and frozen on main at `f5491d7d` (#258). Part of QM M1; the C4 memory results are in [the M1 report](../2026-11-03-qm-c4-told-live/report.md).

**The answer: Sol opens the matching gstack skill through the router; Opus mostly doesn't; neither model reaches a skill's first step.** Under the prereg's rule, opens on either model send the counts to GSTA-36 and CAPY-1 for the QM edition decision. The router does not stop here.

- **Matched opens, router arm:** Opus 5.5 2/15 [0, 40]; GPT-6.1 Sol 11/15 [33, 100]. No-gstack arm: 0/15 on both, and 0 contaminated turns.
- **Starts:** Sol tried the skill's own gstack command in 10/15 [33, 93]; Opus in 0/15. The skill's first-step command: 0 of 9 eligible turns on both models.
- **Complete reads:** every open read the skill through `execute` in pieces, never through QM's read tool. Opus completed 1 read, Sol 5.
- **Task progress, router minus no-gstack (R44, descriptive):** Opus +17 points [0, 50]; Sol -25 [-75, 0].
- **Router cost per turn:** Opus +$0.019 [$0.006, $0.033], Sol +$0.026 [$0.016, $0.036].
- **Spend:** $2.73 of the $20 cap, plus $0.54 of VM.
- **Verdict** (Why null?): FIX-METHOD on both models. Name of the fix: a QM-native gstack edition.

**Terms**

- **Router:** the output of `gstack-harness register generic --print` at gstack `21277291c`, 12,186 characters, placed in QM's org instructions (the org SOUL). It sits at the top of every turn's system prompt.
- **Open:** a read of a staged `/root/workspace/gstack/*/SKILL.md`, through QM's read tool or an `execute` with `cat`, `sed` or `head`. **Matched open:** the skill the request was written for.
- **Start, preamble:** after a matched open, an `execute` that runs the skill's own gstack command (for example `gstack-skill-start --skill "investigate"`). Those commands don't exist in QM's sandbox, so the attempt is the marker.
- **Start, first step:** the skill's own first command, for example `git log --oneline -20 --` for `investigate`.
- **Progress:** the same per-request marker in both arms, for example a `git diff` for the review request. Request 3 (`careful`) has none, so progress is over 12 turns.
- **Intervals:** task-clustered bootstrap 95 percent intervals over the 5 requests, 10,000 draws, seed 7.

## 1. Results

**2 arms × 2 models, 5 invented requests × 3 repetitions, 60 DM turns, each on a fresh QM stack.** Source: [results/analysis/s1-analysis.md](results/analysis/s1-analysis.md) and [.json](results/analysis/s1-analysis.json), computed from [results/turns.jsonl](results/turns.jsonl).

| Cell | Turns | Matched open | Start (preamble) | Start (first step) | Complete read (inline / cut / pieces) | Progress | Router in first prompt | Audit hits |
|---|---:|---|---|---|---|---|---:|---:|
| Opus 5.5, router | 15 | 2/15 [0, 40] | 0/15 | 0/9 | 0 / 0 / 1 | 9/12 [25, 100] | 15 | 3 |
| Opus 5.5, no-gstack | 15 | 0/15 | 0/15 | 0/9 | 0 / 0 / 0 | 7/12 [17, 100] | 0 | 0 |
| GPT-6.1 Sol, router | 15 | 11/15 [33, 100] | 10/15 [33, 93] | 0/9 | 0 / 0 / 5 | 6/12 [0, 100] | 15 | 47 |
| GPT-6.1 Sol, no-gstack | 15 | 0/15 | 0/15 | 0/9 | 0 / 0 / 0 | 9/12 [25, 100] | 0 | 0 |

- **Any open equals matched open** in every cell: no model opened a skill other than the request's.
- **Audit hits in the router arms are expected:** they are the tool calls that name `gstack` or `SKILL.md`. In the no-gstack arms they would be contamination, and there are none.
- **Progress counts the excluded-by-driver turn** (section 4): with the driver's exclusion, Sol no-gstack is 8/11.

### Which skills opened (from `turns.jsonl` `counts.open_matched` and `start_preamble`)

| Request (invented) | Skill | Fits QM's 16,384-char inline cap | Opus 5.5 opens | Sol opens | Sol preamble starts |
|---|---|---|---:|---:|---:|
| 1. Find why the login test broke | `investigate` | no | 0/3 | 3/3 | 3/3 |
| 2. Review the diff before merge | `review` | no | 0/3 | 3/3 | 3/3 |
| 3. Be careful on the prod box | `careful` | yes | 2/3 | 3/3 | 2/3 |
| 4. Write release notes | `document-release` | no | 0/3 | 2/3 | 2/3 |
| 5. Save what we learned | `learn` | yes | 0/3 | 0/3 | 0/3 |

- **Opus opened only `careful`,** the shortest skill (4,727 characters).
- **No read was cut** at QM's inline cap (`cut_reads` 0 in every turn), because every open went through `execute`, not QM's read tool.

## 2. R44: router minus no-gstack, paired on request and repetition (descriptive, no test)

With 5 clusters the smallest exact two-sided p is 0.0625, so no test is run. Prereg exclusions (section 4). Source: [results/analysis/s1-analysis.md](results/analysis/s1-analysis.md).

| Model | Metric | No-gstack mean | Router mean | Difference | Interval | Pairs |
|---|---|---:|---:|---:|---|---:|
| Opus 5.5 | progress | 58% | 75% | +17 points | [0, 50] | 12 |
| Opus 5.5 | input tokens per turn | 40,556 | 61,798 | +21,242 | [11,480, 36,211] | 15 |
| Opus 5.5 | output tokens per turn | 801 | 1,024 | +223 | [-46, 569] | 15 |
| Opus 5.5 | USD per turn | 0.0360 | 0.0554 | +0.0194 | [0.0060, 0.0328] | 15 |
| Opus 5.5 | wall s per turn | 12.9 | 15.5 | +2.5 | [-1.2, 7.1] | 15 |
| GPT-6.1 Sol | progress | 75% | 50% | -25 points | [-75, 0] | 12 |
| GPT-6.1 Sol | input tokens per turn | 45,390 | 82,104 | +36,715 | [20,388, 54,351] | 15 |
| GPT-6.1 Sol | output tokens per turn | 607 | 699 | +92 | [-94, 278] | 15 |
| GPT-6.1 Sol | USD per turn | 0.0323 | 0.0585 | +0.0261 | [0.0161, 0.0359] | 15 |
| GPT-6.1 Sol | wall s per turn | 18.3 | 21.0 | +2.7 | [-1.4, 6.7] | 15 |

- **The router's own size:** the first request's system prompt is 22,077 characters with it and 10,083 without (`first_prompt.system_chars`). Most of the added input is cached: +19,866 of +21,242 tokens on Opus, +27,763 of +36,715 on Sol (`s1-analysis.md`).
- **With the driver's exclusion,** Sol's progress difference is -27 points [-75, 0] over 11 pairs; the cost and token rows move by under $0.001 and 1,200 tokens.

## 3. Clean arms

**The no-gstack arms could reach no gstack file, and read none.**

- **Host:** no `~/.capy/drive`, no `~/.local/share/gstack`, no `~/.claude/skills` on the VM, enforced ([results/preflight.json](results/preflight.json) `host`, `host_enforced`).
- **Images:** the core image holds 31 of QM's own skill files and 0 gstack files; the no-gstack sandbox 0; the router sandbox exactly the 63 staged `SKILL.md` files (`image_checks`).
- **Org SOUL:** QM's 192-character default in no-gstack (`is_router` false), the 12,186-character router in the router arm (`soul`). The fixture tree sha256 `befe5296...` is the same in both arm images.
- **Audit:** 0 tool calls naming `gstack` or `SKILL.md` in either no-gstack cell (section 1).

## 4. Trial accounting

**60 turns recorded, 0 missing, 0 cap stops, 0 fixture faults** ([results/summary.json](results/summary.json)).

- **One turn ended `turn_error`: `s1-r1-k1-sol-no-gstack`.** QM answered `pending_approval`: it asked for command approval before running `npm test` in the fixture repository (`turns.jsonl` `error`). It was not rerun.
- **The driver and the prereg disagree about it.** The driver counts it as not ok and leaves it out (`summary.json` `not_ok`), so its Sol no-gstack cell has 14 turns. The prereg excludes only `model_error` and `infra_error` turns, and this is neither, nor one of the five named fixture faults. **This report follows the prereg and counts it;** the driver's numbers are given beside it. Opens and starts are 0 in that cell either way.

## 5. Why null?

The probe is not null on opens for Sol. It is null on starts for Opus and on first steps for both models, so the prereg's cycle runs.

1. **Exposure: yes.** The router was in the first request's system prompt in 15 of 15 router turns on each model, and in 0 no-gstack turns (`first_prompt.router`). The skill files were staged and readable: Sol read them in 11 turns.
2. **Fit: the requests match the skills by design, and one doesn't land.** No model opened `learn` for request 5. Opus opened only `careful`. The skills' own gstack commands don't exist in QM's sandbox, so a start can only be an attempt.
3. **Power and saturation:** n = 15 per arm and model, 5 request clusters, no test possible. No saturation: no-gstack progress is 58% (Opus) and 75% (Sol), below the top.
4. **Model:** Opus 5.5 and GPT-6.1 Sol behave differently. Sol follows the router into the skill and tries its preamble, then makes less task progress than without gstack (-25 points [-75, 0]). Opus mostly ignores the router and makes slightly more progress (+17 [0, 50]).

**Verdict (gstack's paste-in router on QM, resting on Opus 5.5 and GPT-6.1 Sol): FIX-METHOD.** The fix: the QM-native gstack edition (`hosts/qm.ts`) the prereg names as the next step, with skill files QM can read whole and gstack's own commands present in the sandbox. The router alone gets Sol to open and start skills, Opus mostly to ignore them, and neither to a first step.

## 6. Deviations

- **The lease ledger was opened before the driver.** The driver needs an existing ledger, so the VM created it with `BudgetRun.openLease({ runId: "qm-s1-gstack-probe-2026-11", leaseUsd: 20, runner: "metering-proxy", maxOutputTokens: 128000 })` ([results/controller-run.sh](results/controller-run.sh), line 71; the VM side is [results/vm-loop.sh](results/vm-loop.sh)), the same lease the driver's proxy then resumed. No `--new-run` ([results/RUNLOG.md](results/RUNLOG.md), [results/controller.log](results/controller.log): "lease qm-s1-gstack-probe-2026-11 opened at $20").
- **The run went in 5 driver invocations with `--only`,** 3 quads (one request) each, in `turnPlan` order, with a TTL fit check before each. The first ended "driver exit 1 after 545s", as `--only` reports an incomplete run; the last ended exit 0 with the run complete ([results/vm-loop.log](results/vm-loop.log)).
- **The `turn_error` turn is counted against the driver's choice** (section 4).
- **Scripts written after the run:** `analysis/s1-analysis.ts` (intervals, both exclusion rules) and `analysis/s1-spend.py`.
- **No restarts.** The VM loop logged "loaded commit f5491d7d02f34dad833abeab54d02141a0ee5a64 clean=yes" ([results/vm-loop.log](results/vm-loop.log)). The VM used a scratch clone at that commit and asserted HEAD and a clean tree ([results/RUNLOG.md](results/RUNLOG.md)).

## 7. Spend

**$2.7329 of the $20 cap, 327 requests, 0 overshoot** ([results/meter-summary.txt](results/meter-summary.txt); per turn in [results/analysis/s1-spend.json](results/analysis/s1-spend.json)). The prereg expected $11.03.

| Model | Spend | Requests |
|---|---:|---:|
| Opus 5.5 (`claude-opus-5-5`) | $1.3690 | 104 |
| GPT-6.1 Sol (`gpt-6.1-sol`) | $1.3594 | 162 |
| Harness housekeeping, shipped default: `claude-haiku-5-5` (Opus turns) | $0.0015 | 30 |
| Harness housekeeping, shipped default: `gpt-5.6-luna` (Sol turns) | $0.0031 | 31 |

- **Per cell:** Opus router $0.8309, Opus no-gstack $0.5395, Sol router $0.8773, Sol no-gstack $0.4852.
- **Housekeeping** is metered, never an arm, never scored. Sol's sent 2 requests on `s1-r1-k1-sol-no-gstack` and 1 on every other turn.
- **VMs at list price:** gate 6's pre-launch VM 23 minutes and the run VM 41 minutes, 64 minutes, $0.5363 (`s1-spend.json` `vms`, from [results/vms.jsonl](results/vms.jsonl)). Both destroyed.

## 8. Pins and receipts

- **Run commit** `f5491d7d02f34dad833abeab54d02141a0ee5a64`; **QM** `b6786d67`; **gstack** `21277291c` (1.91.345.0), 63 staged files, router sha256 `a6a55a8b...` ([results/preflight.json](results/preflight.json)).
- **VMs:** `ubirun-harn38-1793820503-b4d527fb-t3` (gate 6) and `ubirun-harn38-1793821974-99cb850c-t3` (run), standard-16, `UBI_OWNER=HARN-38`, `UBI_TTL_HOURS=3`.
- **Gate 6 pre-launch check** at `f5491d7d`: the keyless dry run of all 60 turns plus the injected fault passed every check ([results/gate6-prelaunch-f5491d7d.json](results/gate6-prelaunch-f5491d7d.json)).
- **Files:** [results/turns.jsonl](results/turns.jsonl) and `results/turns/` (stored session, usage and counts per turn), [results/summary.json](results/summary.json), the ledger, proxy log and usage, the preflights, [results/driver.log](results/driver.log), [results/vm-loop.log](results/vm-loop.log), [results/controller.log](results/controller.log), [results/RUNLOG.md](results/RUNLOG.md).

**Reproduce the analysis**, keyless, from the repository root:

```
R=docs/benchmarks/2026-11-03-qm-s1-gstack-probe/results
env -i HOME="$HOME" PATH="$PATH" TERM=xterm bun $R/analysis/s1-analysis.ts
python3 $R/analysis/s1-spend.py $R
```

## Disclosures

gstack is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
