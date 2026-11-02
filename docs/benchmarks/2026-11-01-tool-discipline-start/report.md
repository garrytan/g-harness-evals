# tool-discipline-start-2026-11: report

**OpenClaw: pass. Hermes: fail. On both harnesses, no arm differed in task success.**

- **OpenClaw:** with the start hook on, the agent ran the skill's start command in **16 of 16** trials on tasks 1 and 2. gstack without the hook did so in 1 of 16. Candidate minus baseline is **+0.94 [0.64, 0.99]**. The control guard and both success guards held ([verdict.md](results/verdict.md)).
- **Hermes:** the candidate started **0 of 16**, under the bar of 5. That is not because the hook went unseen. In all 8 candidate task-1 trials the agent opened the skill and **issued** `gstack-skill-start`. Hermes then blocked the command ([Why null?](#why-null)).
- **Two causes for the Hermes fail, both named:**
  - **gstack's start preamble.** Hermes's Tirith security scan flags it as a HIGH "nested executable body". On stock interactive Hermes, that may put an approval card in front of every gstack skill start.
  - **Our preregistered chat-mode approval config** (`approvals.mode: manual`, `timeout: 1`) turned that card into a deny after 1 second.
- **R44, no gstack against gstack:** task success was **16 of 16 in every arm** on both harnesses. Every difference is **+0.00 [-0.19, 0.19]**. **These tasks showed no success difference for gstack, with or without the hook:** every arm sat at the ceiling, so a drop under 4 of 16, or any gain, cannot show.
- **Cost:** on OpenClaw, gstack cost **about 3 times as much** per trial without the hook and **about 5 times as much** with it, against no gstack (ratios of medians, descriptive), with no measurable success difference on these tasks. The hook against gstack without it: median $0.2504 against $0.1464 (1.7 times), spend $5.24 against $2.46. On Hermes the three arms cost about the same.
- **Spend:** $16.90 of the $28 cap, 144 of 144 trials completed.

This is a dev run on three public tasks. Nothing here is a held-out claim.

## What ran

- Run `tool-discipline-start-2026-11`, preregistered in #205 and merged as `ccad864b53a18c6483d7ca9f73cc2f87b5f77f1b` before the first trial ([PREREGISTRATION.md](PREREGISTRATION.md)). No amendments.
- **The candidate is pre-release:** gstack `b9fda18c6ac232de2b5a99ac3e6893955c55d7c0`, the head of [garrytan/gstack#3786](https://github.com/garrytan/gstack/pull/3786) before merge.
  - It merged as `b15492a1` (v1.92.23.0) with the same hook code but a different tree.
  - `lib/harness-start-hook.ts`, `lib/harness-register.ts`, `bin/gstack-harness`, `bin/gstack-config`, `bin/gstack-harness-ledger.sh` and `test/harness-start-hook.test.ts` are byte-identical.
  - 120 other files differ: 8 main commits, v1.92.15.0 to v1.92.22.0. The start preamble's generator, `scripts/resolvers/runtime-root.ts`, is unchanged.
- **Baseline:** gstack `482ffd1440ab13d105bfd3e571be3d7a0a7bb99a` (v1.92.14.0), #3786's base: the candidate is 9 commits on top of it, with no merges. **None:** no gstack installed.
- 3 arms × 2 harnesses × 3 tasks × 8 trials = 144 trials, model `claude-opus-5-5`, max_tokens 128000.
  - OpenClaw 2026.10.6, run entry.
  - Hermes Agent v2026.9.24 in chat mode under the GSTA-135 overlay.
- **One Capy machine, sequential.** The run came from a worktree pinned at `ccad864b5`, never moved, with every image built from it ([images.txt](results/images.txt)). Every trial row records that tree with `tree_dirty` false ([cells.jsonl](results/cells.jsonl)).
- **Installed HEAD in every trial,** from each trial's `gstack-register.log` (the lines and each log's sha256 are in [register-checks.jsonl](results/register-checks.jsonl)):
  - none: 48 of 48 say `gstack: none`.
  - baseline: 48 of 48 say `HEAD 482ffd14... equals`.
  - candidate: 48 of 48 say `HEAD b9fda18c... equals`.
- **Hook state in every trial:** `start_hook: on active` in all 48 candidate trials, and `off` in all 96 others.
- **Preflights passed at both pins** before trial 1: OpenClaw 43 checks and Hermes chat 59 checks ([results/](results/): `preflight-482ffd14.*.log`, `preflight-b9fda18c.*.log`, [runtime-preflight.json](results/runtime-preflight.json)).
  - With the hook on, the note was on the first agent-turn request: `first_turn_note=yes`.
  - With the hook off, no request carried it: `requests_with_note=0`.
- **Timeline:** trial 1 started at 19:09:38Z, 11 minutes after the merge commit (18:58:28Z, its commit time). The last trial ended at 20:40:39Z ([run.log](results/run.log)).
- All 144 trials ended `completed` with complete transcripts. None was absent, none was retried, and no lease or cap stop was hit.

## Primary and guards (panel-score.ts)

From `bun scripts/tool-discipline/panel-score.ts results/gsta-135/runs/tool-discipline-start-2026-11/cells.jsonl --manifest .../manifest.json`, run in the pinned worktree. Output: [results/verdict.md](results/verdict.md), with [verdict.json](results/verdict.json) alongside.

| Harness | Candidate starts, t1+t2 (bar 5 of 16) | Baseline starts | Candidate minus baseline | Control opens, candidate t3 (max 1) | Success guards | Verdict |
|---|---|---|---|---|---|---|
| OpenClaw | 16 of 16 (0.81 to 1.00) | 1 of 16 | +0.94 [0.64, 0.99] | 0 of 8 | met, met | **pass** |
| Hermes | 0 of 16 (0.00 to 0.19) | 0 of 16 | +0.00 [-0.19, 0.19] | 0 of 8 | met, met | **fail** |

- **OpenClaw per task:** the candidate started 8 of 8 on task 1 and 8 of 8 on task 2. The one baseline start is `gsta135-openclaw-t2-baseline-8`.
- **Hermes per task:** the candidate opened the matching skill in 8 of 8 task-1 trials and 0 of 8 task-2 trials. The secondary Hermes task-2 bar (2 of 8) is not met.
- **Exit codes:** every OpenClaw candidate start exited 0. Every Hermes candidate attempt is recorded as `started_attempted=1`, `started_exit=-1` (blocked, never ran), so none counts as a start or as "exit not attributable".

## R44: no gstack against gstack

| Harness | Arm | Task success t1+t2 | Median cost per trial [95% interval] | Median wall time |
|---|---|---|---|---|
| OpenClaw | none | 16 of 16 | $0.0472 [0.0099, 0.0522] | 29 s |
| OpenClaw | baseline | 16 of 16 | $0.1464 [0.0100, 0.1741] | 37 s |
| OpenClaw | candidate | 16 of 16 | $0.2504 [0.0104, 0.3212] | 71 s |
| Hermes | none | 16 of 16 | $0.0989 [0.0703, 0.1723] | 31 s |
| Hermes | baseline | 16 of 16 | $0.0783 [0.0317, 0.1047] | 36 s |
| Hermes | candidate | 16 of 16 | $0.0915 [0.0077, 0.2492] | 39 s |

- **Success:** none minus baseline and none minus candidate are +0.00 [-0.19, 0.19] on both harnesses ([verdict.md](results/verdict.md)).
- **Smallest drop this panel can show:** 4 of 16 (0.25) from 16 of 16. Anything smaller is not shown either way.
- **Where the numbers come from:** costs and intervals from verdict.md; wall times are medians of `wall_ms` in cells.jsonl over all 24 trials per arm.
- **Spend per arm** (sum of `usd_spent`):
  - OpenClaw: none $0.94, baseline $2.46, candidate $5.24.
  - Hermes: none $2.71, baseline $2.72, candidate $2.83.
- **On OpenClaw, gstack costs 3 to 5 times as much per trial as no gstack,** with no measurable success difference on these tasks. The ratios of medians are 3.1 without the hook and 5.3 with it. They are descriptive: none's cost interval overlaps baseline's.
- **The hook against gstack without it, on OpenClaw:** median $0.2504 against $0.1464 (1.7 times), spend $5.24 against $2.46 (2.1 times). Descriptive; the intervals overlap.

## What this means for Hermes users

- **The trigger is gstack's start preamble.** The start command opens with a grouped fallback block: `[ -d "${GSTACK_ROOT:-/-}/bin" ]&&...||{ GSTACK_ROOT="/opt/gstack"; ...exit 1;}`. gstack generates it in `scripts/resolvers/runtime-root.ts`.
- Hermes's Tirith scan cannot resolve that block, so it raises a HIGH finding. Hermes's own regex detector does not flag the command ([hermes-approval/detector.json](results/hermes-approval/detector.json)).
- **On stock interactive Hermes, every gstack skill start may stop at an approval card.**
  - The default approval mode is `smart`, so Hermes's guardian model may approve the command on its own.
  - If it does not, the user sees a card offering "Allow once", "Allow for this session" or "Deny", and has 5 minutes (the default `timeout: 300`) to answer.
- **The approval prompt cannot save it past one session.** For a finding that comes only from Tirith, the card hides "Always" and a saved choice is capped at the session (Hermes `tools/approval.py:1216`).
  - Two other routes exist and were not tested here: a hand-written `command_allowlist` entry for the Tirith rule's key, and `security.tirith_enabled: false`, which turns the scan off for every command.
- **Hermes's counted one-shot entry would not stop.** `--oneshot` sets `HERMES_YOLO_MODE=1` (`hermes_cli/oneshot.py:278`).

## Why null?

Two nulls: the Hermes start fail, and task success with gstack against none.

### 1. Hermes: the hook did not produce a start

- **Exposure: yes. The note reached the model, and the agent acted on it.**
  - Preflight at `b9fda18c`: `first_turn_note=yes` on Hermes's first agent-turn request ([preflight-b9fda18c.hermes-chat.log](results/preflight-b9fda18c.hermes-chat.log)).
  - All 24 Hermes candidate trials logged `start_hook: on active`.
  - In `gsta135-hermes-t1-candidate-1` to `-8`, the agent opened `gstack-review` (state.db message id 2) and issued the start command (message id 5).
  - Hermes returned `status: blocked`, `exit_code: -1`, "No answer within 1 second", "the command did not run" (message id 6).
  - [hermes-approval/blocks.jsonl](results/hermes-approval/blocks.jsonl) holds the rows, the state.db sha256s and the approval-card lines for all eight.
  - The eight state.db files are harness state, so they are not committed. Copies are in the Captain drive at `handoffs/HARN-18/hermes-approval/`.
  - The card in every one shows a security scan finding: "[HIGH] Nested executable body could not be resolved".
  - No baseline or none Hermes trial drew a card or ran the helper (0 of 48). Baseline opened gstack-review 6 times and never issued the helper.
- **Fit: yes.** Tasks 1 and 2 are the GSTA-135 tasks where a gstack skill applies. Task 3 is the control.
  - On task 2 no Hermes arm opened a skill (0 of 24), as in every earlier arm. So the Hermes primary rested on task 1, as the preregistration warned.
- **Power and saturation: not the cause.** The bar was 5 of 16, and the candidate tried in 8 of 8 task-1 trials.
  - With the commands allowed to run, the task-1 count alone would have cleared the bar.
  - That is an inference: it assumes they would have exited 0, as all 16 OpenClaw starts did.
- **Model: frontier.** `claude-opus-5-5` in every arm.
- **Method limitation, in all arms (not a deviation):** our image does not pin the Tirith scanner.
  - Hermes downloaded the latest Tirith release from GitHub at run time in all 72 Hermes trials. Each trial's agent.log says "tirith installed to /harness-state/hermes/bin/tirith (SHA-256 only)".
  - Counts: [hermes-approval/tirith-download.json](results/hermes-approval/tirith-download.json).

### 2. Task success: gstack against none

- **Exposure: partly.**
  - On OpenClaw the gstack arms opened the matching skill on tasks 1 and 2 (baseline 6 and 7 of 8, candidate 8 and 8), and the candidate started it 16 of 16 times.
  - On Hermes they opened it only on task 1 (baseline 6 of 8, candidate 8 of 8). On task 2, no Hermes gstack trial opened a skill (0 of 16), so the skill listing was the only exposure there.
- **Fit: partly.** These are short one-turn review and investigate tasks. The preregistration notes that GSTA-135's tasks 1 and 2 were 5 of 5 in every gstack cell.
- **Power and saturation: saturated.** Success was 16 of 16 in all six harness-arm cells. This panel can catch a drop of 4 of 16 or more and cannot show a gain at all.
- **Model: frontier.** Opus 5.5 solves these tasks without gstack.
- **So these tasks cannot tell whether gstack helps.** The null says neither that gstack is useless nor that it helps. On OpenClaw, gstack added cost on these tasks with no success difference that this panel could show.

Verdict: FIX-METHOD. On Hermes the candidate issued gstack-skill-start in 8 of 8 task-1 trials, but Hermes's Tirith scan flagged gstack's start preamble as a HIGH "nested executable body" and our preregistered chat-mode approval config (manual, 1 s) auto-denied it; Hermes's approval prompt cannot save a Tirith-only finding past one session, so gstack must emit a start command Tirith resolves (one plain call to gstack-skill-start, no grouped fallback), our Hermes image must pin Tirith instead of downloading latest per trial, and the Hermes cells rerun under a new run id; gstack's effect on task success needs tasks below the ceiling. OpenClaw's start hook passed on starts (compliance) and stays; its value is not shown on these tasks.

## Deviations

- **None** from the preregistration.
- **The Hermes approval config was preregistered,** so it is not a deviation. `harnesses/hermes/gstack/adapter.sh:71-73` appends `approvals.mode: manual`, `timeout: 1` in every arm.
  - The preregistration says all arms share "the same Hermes approval config". All 72 Hermes trials' gstack-register.log record it ([register-checks.jsonl](results/register-checks.jsonl), field `approval`), and preflight checks it.
  - It is named above as one of the Hermes fail's two causes.
- **Not sharded on Ubicloud,** as the preregistration declared: one Capy machine, sequential, about 1.5 hours, a declared deviation from CREW.md "Shards run on Ubicloud".
- **Merge lane:** the trial-start notice went to the merge lane late. The prereg merge hold was off for 30 s, and nothing merged in that window.
  - #204 (docs only: VERSION, package.json, docs/sealed-*) merged to main at 20:11:22Z, during the run, per HARN-7's merges.log in the Captain drive.
  - The run loaded only the pinned worktree, so it did not see that merge.

## Limits

- **Pre-merge candidate.** The result carries to v1.92.23.0 (`b15492a1`) only as far as its 8 later main commits leave skill starts alone.
- **Three public tasks, 8 trials per cell, one-turn tasks.** A pass says the hook moves starts on these tasks on OpenClaw. It is not a general rate.
- **Hermes ran in chat mode under the overlay,** with a 1 s manual approval config. That is neither Hermes's counted one-shot entry nor its stock interactive settings.
- **Tirith was downloaded per trial, unpinned,** in every Hermes trial.
- **The candidate arm can see that it is the candidate** (`GSTACK_HARNESS_START_HOOK=1` in its shell), as the preregistration says.
- **The none arm's shell also shows gstack-named state** (`GSTACK_DIR`, `GSTACK_IMAGE_COMMIT=none`, `GSTACK_HARNESS_START_HOOK=0`), with no gstack checkout, skill or registration present.
- **One-turn tasks.** The hook's note lands once per request here; long sessions pay more.
- **Hermes's session-title call** (harness housekeeping, shipped default) never carries the note. It is metered and not scored.
- **Secondary, descriptive:**
  - Starts among trials that opened the matching skill: OpenClaw baseline 1 of 13, candidate 16 of 16; Hermes baseline 0 of 6, candidate 0 of 8.
  - Invented `skills_read` calls on OpenClaw: none 0, baseline 1 (gsta135-openclaw-t1-baseline-8, rejected as "Tool skills_read not found"), candidate 0 (evidence/).
  - Trials with an unresolved reservation: 0.
  - GSTA-135's 3-of-5 bars are reprinted in discovery.sh's [results/report.md](results/report.md).
- **Not computed in this PR:** the per-arm classifier rates (invented tools, bad arguments, wrong names, broken helper calls) and the gstack-state start receipt. The preregistration lists both as secondary and descriptive. Neither enters the verdict.

## Spend

- **$16.900854** committed over 758 proxy requests and 144 leases, all reconciled, 0 open ([ledger.sqlite](results/ledger.sqlite), [proxy-usage.ndjson](results/proxy-usage.ndjson)). By harness: $8.64 on OpenClaw, $8.26 on Hermes.
- The 758 requests include 144 zero-cost HTTP 400 responses, 2 per Hermes trial.
- Under the $28 cap and below the $21.15 planning ceiling. The costliest trial was $0.48 (`gsta135-openclaw-t1-candidate-1`), against a $6.56 lease.

## Receipts

All under [results/](results/):

- **Run record:** manifest.json and manifest.sha256 (`3b3d2b11...`, written before trial 1), cells.jsonl, ledger.sqlite, proxy-usage.ndjson, proxy.log, tree-status.txt.
- **Logs:** run.log (run.sh and discovery.sh), timings.txt, images.txt, and report.md (discovery.sh's per-trial report).
- **Verdict:** verdict.md and verdict.json (panel-score.ts).
- **Preflight:** runtime-preflight.json, plus the OpenClaw and Hermes preflight logs for each pin.
- **Per trial:** evidence/ (one file per trial), trials/<id>/logs/adapter.log, and register-checks.jsonl (each trial's HEAD check and start_hook lines).
- **Hermes finding:** hermes-approval/ (blocks.jsonl, detector.json, tirith-download.json).

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI. OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
