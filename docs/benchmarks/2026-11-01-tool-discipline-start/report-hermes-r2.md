# tool-discipline-start-hermes-r2-2026-11: report

**Hermes: pass. With gstack v1.92.57.0's new start fence and Tirith pinned, the candidate ran gstack's start command in 8 of 16 trials, against 0 of 16 in #214. No arm differed in task success.**

- **Starts:** candidate **8 of 16** on tasks 1 and 2 (0.28 to 0.72), over the bar of 5. Baseline 0 of 16. Candidate minus baseline **+0.50 [0.21, 0.72]** ([verdict.md](results-hermes-r2/verdict.md)).
- **All 8 starts are on task 1.** On task 1 the candidate opened `gstack-review` and ran `gstack-skill-start` with exit 0 in 8 of 8 trials. On task 2 no arm opened a skill (0 of 24), as in #214. The secondary task-2 bar (2 of 8) is not met.
- **Guards held.** Control: the candidate opened a skill on task 3 in 0 of 8 (at most 1 allowed). Task success: **16 of 16 in every arm**, so both success guards are met at **+0.00 [-0.19, 0.19]**.
- **What changed from #214:** only the candidate's gstack (b9fda18c to `e2d9c798`, v1.92.57.0) and the pinned Tirith 0.4.2. Tirith allows the new fence and blocks the old one. In #214, Hermes blocked every candidate start.
- **Clean arms:** the none arm is **clean**: 0 gstack reads, 0 gstack skills listed, 0 Capy drive paths, 0 unaudited trials. **No trial in any arm downloaded Tirith** ([clean-arm-audit.md](results-hermes-r2/clean-arm-audit.md)).
- **Cost:** candidate median **$0.0875** per trial against none $0.0502 and baseline $0.0528 (descriptive; the intervals overlap). Spend **$5.757495** of the $19 cap.

This is a dev run on three public tasks. Nothing here is a held-out claim.

## What ran

- Run `tool-discipline-start-hermes-r2-2026-11`, preregistered in #223 and merged as `e77ca6a30ba076e3a3316238eb39947629918bac` before the first trial ([PREREGISTRATION-hermes-r2.md](PREREGISTRATION-hermes-r2.md)). No amendments.
- **Arms:**
  - **none:** no gstack installed.
  - **baseline:** gstack `482ffd1440ab13d105bfd3e571be3d7a0a7bb99a` (v1.92.14.0), as #214.
  - **candidate:** gstack `e2d9c798b2a69cd7870513f1d280d757a4e527de` (v1.92.57.0, gstack#3825's merge) with the start hook on.
- 3 arms × Hermes chat × 3 tasks × 8 trials = **72 trials**, model `claude-opus-5-5`, max_tokens 128000. OpenClaw was not dispatched: its 72 rows are `not_run:not_selected`, with no lease.
- **One Capy machine, sequential**, from a worktree pinned at `e77ca6a3`, never moved. Every image was built from it ([images.txt](results-hermes-r2/images.txt)). Every row records that tree with `tree_dirty` false ([cells.jsonl](results-hermes-r2/cells.jsonl)).
- **Tirith form: the declared image patch.** The run commit does not contain #221, so the patch (sha256 `ef588a84...`) was applied to a copy of `harnesses/` and `harness-eval/hermes:dev` was built from that copy. Inside it: `tirith 0.4.2`, TIRITH_BIN set to `/opt/tirith/bin/tirith`, TIRITH_OFFLINE set ([run.log](results-hermes-r2/run.log)).
- **Installed HEAD in every trial**, from each trial's `gstack-register.log` (the pin, start_hook and approval lines are in [register-checks.jsonl](results-hermes-r2/register-checks.jsonl), with each log's sha256):
  - none: 24 of 24 say `gstack: none`.
  - baseline: 24 of 24 say `HEAD 482ffd14... equals`, hook `off`.
  - candidate: 24 of 24 say `HEAD e2d9c798... equals`, hook `on active`.
  - All 72 log `GSTACK_CAPY=unset` (the `gstack_capy` field of register-checks.jsonl) and the approval config `approvals.mode=manual approvals.timeout=1`, as #214.
- **Timeline:** merged 09:46:41Z. Trial 1 started at 10:18:55Z. The last trial started at 10:59:17Z and ran 28 s; discovery.sh finished at 10:59:45Z ([run.log](results-hermes-r2/run.log)).
- All 72 trials ended `completed` with complete transcripts. None was absent or retried, and no lease or cap stop was hit.

## Gates before trial 1

All passed ([run.log](results-hermes-r2/run.log)):

- **Runtime preflight**, Hermes chat, 59 checks at each pin ([preflight-482ffd14.hermes-chat.log](results-hermes-r2/preflight-482ffd14.hermes-chat.log), [preflight-e2d9c798.hermes-chat.log](results-hermes-r2/preflight-e2d9c798.hermes-chat.log)).
  - At `e2d9c798` with the hook: `first_turn_note=yes`, the note on the first agent-turn request.
  - At `482ffd14`: `requests_with_note=0 of 2`.
- **Clean-arm preflight:** pass for the none, baseline and candidate images, Tirith 0.4.2 offline as the trial uid included ([clean-arms.jsonl](results-hermes-r2/clean-arms.jsonl)).
- **Tirith fence:** candidate **allow**, baseline **block**, as preregistered ([tirith-fence.jsonl](results-hermes-r2/tirith-fence.jsonl)).

## Primary and guards (panel-score-r2.ts)

From `bun scripts/tool-discipline/panel-score-r2.ts .../cells.jsonl --manifest .../manifest.json`, run in the pinned worktree ([verdict.md](results-hermes-r2/verdict.md), [verdict.json](results-hermes-r2/verdict.json)).

| Candidate starts, t1+t2 (bar 5 of 16) | Baseline starts | Candidate minus baseline | Control opens, candidate t3 (max 1) | Success guards | Verdict |
|---|---|---|---|---|---|
| 8 of 16 (0.28 to 0.72) | 0 of 16 | +0.50 [0.21, 0.72] | 0 of 8 | met, met | **pass** |

- **Per task:**
  - candidate: opened 8 of 8 on task 1 and 0 of 8 on task 2; started 8 of 8 and 0 of 8.
  - baseline: opened 8 of 8 on task 1 and 0 of 8 on task 2; started 0.
  - none: opened 0.
- **Every start exited 0** with its exit attributed to the command. No attempt had an unattributable exit.
- **How the agent ran it:** in 6 of 8 trials it ran the fence as gstack renders it (`[ -x ".../gstack-skill-start" ]||echo ...`). In 2 of 8 it ran the bare call. In 3 of 8 it also ran `gstack-skill-end` (evidence/).
- **Starts among trials that opened the matching skill:** candidate 8 of 8, baseline 0 of 8.

## R44: no gstack against gstack

| Arm | Task success t1+t2 | Median cost per trial [95% interval] | Median wall time | Spend |
|---|---|---|---|---|
| none | 16 of 16 | $0.0502 [0.0199, 0.0600] | 32 s | $1.224710 |
| baseline | 16 of 16 | $0.0528 [0.0073, 0.2407] | 33 s | $2.530573 |
| candidate | 16 of 16 | $0.0875 [0.0071, 0.0939] | 42 s | $2.002213 |

- **Success:** none minus baseline and none minus candidate are both **+0.00 [-0.19, 0.19]**.
- **Smallest drop this panel can show:** 4 of 16 from 16 of 16. A smaller drop, or any gain, cannot show.
- **Where the numbers come from:** success, costs and intervals from verdict.md. Wall times are medians of `wall_ms` over the 24 trials per arm. Spend is the sum of `usd_spent` per arm in cells.jsonl.
- **Beside #214 (descriptive):** the candidate's median cost was $0.0915 [0.0077, 0.2492] there and $0.0875 [0.0071, 0.0939] here; the intervals overlap. Hermes spend by arm was none $2.71, baseline $2.72, candidate $2.83 in #214, against $1.22, $2.53 and $2.00 here. The cause of the drop in none's spend was not examined.

## Clean-arm audit

From `bun scripts/tool-discipline/clean-arm-audit.ts` ([clean-arm-audit.md](results-hermes-r2/clean-arm-audit.md), [.json](results-hermes-r2/clean-arm-audit.json)):

| Arm | Trials with a gstack skill read | Reads in tool calls | Reads in transcripts | Prompt lists a gstack skill | Capy drive paths | Unaudited | Tirith downloads | None arm |
|---|---|---|---|---|---|---|---|---|
| none | 0 of 24 | 0 | 0 | 0 | 0 | 0 | 0 | **clean** |
| baseline | 8 of 24 | 8 | 8 | 24 | 0 | 0 | 0 | n/a |
| candidate | 8 of 24 | 9 | 20 | 24 | 0 | 0 | 0 | n/a |

- The none arm is clean, so its success guard and R44 lines stand as printed.
- Every agent.log was present (0 unknown). No trial in any arm wrote `tirith installed to`, so every Hermes trial used the pinned scanner.
- The gstack arms' counts are descriptive. Transcripts count more reads than tool calls for the candidate because they also count the start and end commands, which name `/opt/gstack/`.

## Why null?

Two nulls: task success in every contrast, and starts on Hermes task 2.

### 1. Task success: gstack against none, and candidate against baseline

- **Exposure: yes on task 1, listing only on task 2.**
  - Both gstack arms listed gstack skills in the system prompt of all 24 trials (clean-arm-audit.json `prompt_lists_gstack`).
  - On task 1 both opened `gstack-review` in 8 of 8, and the candidate started it 8 of 8.
  - On task 2 no gstack trial opened a skill, so the listing was the only exposure.
- **Fit: partly.** These are short one-turn review and investigate tasks that Opus 5.5 already solves.
- **Power and saturation: saturated.** 16 of 16 in all three arms. The panel can catch a drop of 4 of 16 or more and cannot show a gain.
- **Model: frontier.** `claude-opus-5-5` in every arm.
- **So these tasks cannot tell whether gstack helps task success on Hermes.** The null says neither that gstack is useless nor that it helps.

### 2. Hermes task 2: no skill opened, so no start

- **Exposure: listing only.** The candidate's system prompt listed gstack skills in 8 of 8 task-2 trials (clean-arm-audit.json `prompt_lists_gstack`), but no trial in any arm opened a skill. In the runtime preflight the hook's note was on the first agent-turn request; trial requests were not captured.
- **Fit: in question.** Hermes has now opened 0 skills on task 2 across every arm of #214 and this run. The task may not read to Hermes as one that calls for a skill.
- **Power: weak alone, strong pooled.** The candidate's 0 of 8 (0.00 to 0.32) cannot by itself rule out a rate at the bar of 2 of 8. But no arm opened a skill on task 2: 0 of 24 here (0.00 to 0.14), and 0 of 48 across #214 and this run (0.00 to 0.07).
- **Model: frontier.**

Verdict: FIX-METHOD. gstack#3825's fence works on Hermes (8 of 8 task-1 trials started, against 0 of 8 in #214) and stays, but the primary passed on task 1 alone; to measure gstack's effect on Hermes we need tasks below the success ceiling and a second task that Hermes routes to a skill.

## Deviations

- **The first build attempt died with its machine before any gate or trial ran.**
  - At 09:49Z the image builds started on an earlier Capy machine, which then stopped responding and was replaced.
  - The run moved to one fresh 8-CPU Capy machine. Every image was rebuilt there from the same worktree pinned at `e77ca6a3`, and every gate and every trial ran on that machine.
  - Nothing was spent before the move. The run log records it.
- **Not sharded on Ubicloud,** as the preregistration declared.
- No other deviation from the preregistration.

## Limits

- **The candidate moved by 43 first-parent gstack commits** (v1.92.14.0 to v1.92.57.0), not one change. The pass is about gstack main at v1.92.57.0 with the hook, against v1.92.14.0 without it and against no gstack.
- **Three public tasks, 8 trials per cell, one-turn tasks.** The pass rests on task 1 alone.
- **Same chat-mode approval config as #214** (manual, 1 s). That is neither Hermes's counted one-shot entry nor its stock interactive settings.
- **Tirith 0.4.2 was pinned through a declared image patch** (#221's hunks), not a merged image change.
- **The candidate arm can see that it is the candidate** (`GSTACK_HARNESS_START_HOOK=1` in its shell), and the none arm's shell shows gstack-named state, as the preregistration says.
- **Hermes's session-title call** (harness housekeeping, shipped default) never carries the note. It is metered and not scored.

## Spend

- **$5.757495** committed over 443 proxy requests and 72 leases, all reconciled, **0 open** ([ledger.sqlite](results-hermes-r2/ledger.sqlite), [proxy-usage.ndjson](results-hermes-r2/proxy-usage.ndjson)).
- Under the $19 cap and the $10.74 estimate.

## Receipts

All under [results-hermes-r2/](results-hermes-r2/):

- **Run record:** manifest.json and manifest.sha256 (written before trial 1), cells.jsonl, ledger.sqlite, proxy-usage.ndjson, proxy.log, tree-status.txt.
- **Logs:** run.log (the Tirith form, the patch sha256 and the gates), images.txt, report.md (discovery.sh's per-trial report).
- **Verdict:** verdict.md and verdict.json (panel-score-r2.ts).
- **Gates:** runtime-preflight.json, the Hermes preflight log for each pin, clean-arms.jsonl, tirith-fence.jsonl.
- **Audit:** clean-arm-audit.md and clean-arm-audit.json.
- **Per trial:** evidence/ (one file per trial), trials/<id>/logs/adapter.log, and register-checks.jsonl (the installed-HEAD, start_hook, approval and GSTACK_CAPY lines of each gstack-register.log). As in #214, raw harness logs (agent.log, stdout, stderr, gstack-setup) and state.db are not committed; the audit's per-trial results are in clean-arm-audit.json.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.
