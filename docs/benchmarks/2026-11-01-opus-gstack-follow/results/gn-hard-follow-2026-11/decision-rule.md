# gn-hard-follow-2026-11: decision rule (frozen before the first paid trial)

Uncounted hard-task follow-rate check, HARN-14. Design by HARN-1, approved by Garry (B1, 2026-11-01). Written 2026-11-02 (UTC) after the $0 checks below and before any paid trial. This file is the rule of record. The draft it replaces is ~/.capy/work/hard-select/DECISION-RULE.draft.md.

## Run ids and plan files
- One run, two plan files under one prefix, because plan.ts allows one `repetitions` value per run:
  - `gn-hard-follow-2026-11-gstack`: screening/gn-hard-follow-2026-11-gstack.json, cell claude-opus-5-5.gstack, repetitions 2, shard opus-hard-gstack.
  - `gn-hard-follow-2026-11-none`: screening/gn-hard-follow-2026-11-none.json, cell claude-opus-5-5.none, repetitions 1, shard opus-hard-none.
- Commit: bee55a72fe8c66c024f8cc38dc60760c8a917eb1 on the scratch branch harn14/hard-follow-2026-11 (pushed, never merged). It is PR #218's head 6d095a2fd plus the two plan files, the agent patch file, the pin.json change, and the run-shard.sh line in deviation D1.
- **VMs:** two Ubicloud standard-16 VMs in parallel, one per plan file, through scripts/ubicloud/fanout.sh with UBI_OWNER=HARN-14, `--timeout-hours 20` and `--storage 320`. Each shard runs its trials one at a time.

## Tasks
- The 8 primary SWE-bench Verified instances from handoffs/HARN-14/hard-select/candidates.json:
  - sphinx-doc__sphinx-10435, django__django-15732, django__django-15554, pylint-dev__pylint-6386;
  - sympy__sympy-15599, pytest-dev__pytest-5787, sympy__sympy-13031, sphinx-doc__sphinx-7985.
- Every task maps to the skill investigate (pin.json swebv.skill).
- Source: laude-institute/harbor-datasets at 86723674f04e4209ac479d0fb75d9d9f44b4377e (swebench-verified@1.0), read by the swebv bridge (PR #218). It is uploaded as harbor-datasets/ under the laneb root.
- Reserves pylint-dev__pylint-7080 and pydata__xarray-6599 are **not used**. Every primary passed both the oracle and the no-op check.

## Model, arms and agent
- Opus 5.5 (claude-opus-5-5) only. gstack (told /investigate) runs 2 tries per task, 16 sessions. none (no gstack installed, plain prompt) runs 1 try per task, 8 sessions. No placebo.
- Claude Code 2.1.312, Claude Agent SDK 0.2.174, Harbor f3a5a923.
- Arm tars: none 8bab4833 (pinned). gstack b9399468 is the pack-equivalent rebuild of 737411ef that pin.json lists as a deviation on 2026-10-29.
- **Agent:** Lane B's pinned quick/laneb/runner/agent/laneb_agent.py (gstack-evals 443d582c) with one declared patch of three hunks.
  - The file: screening/gn-hard-follow-2026-11.agent.patch, sha256 d4a3de1ac2cfe222b5e41f254c8093dda9e179e11b38e5ea2345518ca17f62a4.
  - **File sha256:**
    - before: c4f7664b1221ecedb075eb61bf2d3965dca66f44a567d0cc0f277bd8eca64235
    - after the preset hunk alone: 54fb546251fd4591f669d2330fbcaeefbded00ff0d6ed1138878da5a4bcae8a6
    - after preset plus base-diff: 57cb86d81dfe9d92a87c0a5f7acb7d0f875a7fff2d77d9cfcc88793ece0183c7
    - **final** (all three hunks): a0d99d668c46677b16b26c4e672942d6e53d580093392b8a0f598379bf0cc304. pin.json's checkout_only entry carries this sha.
  1. **Preset hunk** (`system_prompt={"type": "preset", "preset": "claude_code"}`). Why: without it, SDK 0.2.174 sends the two-line stub instead of Claude Code's guidance block. This is the same line as gn-follow-preset-2026-11.
  2. **Base-diff hunk** (from handoffs/HARN-14/ship/218/agent-patch). It records `git rev-parse HEAD` in /testbed at setup and diffs against it. Why: the pinned agent diffs against the current HEAD, so an agent that commits exports an empty model.patch and the grade is wrong. PR #218 lists this as prerequisite 3.
  3. **Task-id parse hunk** (`task_id = environment.session_id.rsplit("__", 2)[0]` replaces `split("__")[0]`). Why: Harbor f3a5a923's session_id is `<task>__<7 chars>__env`, and every SWE-bench id contains `__`. With the old parse the dry run's gstack session failed before its first model call ("task django has no skill in the skill map, but this arm is invoked"). Approved as fix A by the parent agent on 2026-11-02, before any paid trial. Native and tb2 ids contain no `__`, so they parse as before (CHECKS.md, check 6).
- Laneb root ~/.capy/work/gstack-laneb-hard: a copy of the fetched root (~/.capy/work/gstack-laneb). laneb_agent.py is the only changed file, and harbor-datasets/ has been added.

## Deviations, declared before the first trial
- **D1 (mechanics):** scripts/ubicloud/run-shard.sh uploads harbor-datasets/ when the laneb root has it. Without this line the VM never receives the dataset (PR #218 open note, "Ubicloud shards don't get the dataset"). Tasks, arms and grading are unchanged.
- **D2:** the agent's third hunk (above).
- The uncounted status means none of PR #218's counted-run prerequisites 1 and 2 are met. Each shard holds a single cell, so there is no cross-shard merge on image digests. A missing model.patch is graded fail, not infra_error, and the report lists any such trial.

## Money
- Every paid call goes through our metering proxy under a ledger lease: `gn-hard-follow-2026-11-gstack:opus-hard-gstack` $41.29 and `gn-hard-follow-2026-11-none:opus-hard-none` $18.67, total $59.96 against the $60 cap. A cap stop is not retried.
- plan.ts leases (projected x 1.4 + $5 session cap) use projected_usd_per_trial 1.62 for gstack and 1.22 for none. Each plan's spend_cap_usd equals its lease.
- **Projection: about $36.**
  - Basis: Opus 4.6's mini-SWE-agent cost on the 8 primaries is $12.15, and Opus 5.5 is priced at 0.8 times Opus 4.6 (runner/ledger/budget-ledger.ts). That gives $9.72 per pass of 8: $9.72 for none and $19.44 for gstack.
  - Plus about $7 for gstack's larger prompt: it adds about 26k tokens to the cached prefix of every request (gn-follow-preset-2026-11: first-request median 48.7k on gstack against 22.8k on none).
  - Three primaries reached mini-SWE-agent's $3 limit, so real costs there can be higher. Lane B caps each session at $5.
- Under $60, so the run goes ahead.

## $0 checks before any paid trial (evidence/CHECKS.md)
1. `git fsck --full` on the harbor-datasets clone exited 0 (clean). It covers tree and commit objects (PR #218 fix-check#1).
2. Oracle through Harbor: 10 of 10 reward 1.0.
3. No-op agent: 10 of 10 reward 0.0.
4. Final 8 = the 8 primaries.
5. Keyless fake-upstream dry run (django__django-15732, none and gstack, allowlist, on a Ubicloud check VM):
   - **System prompt:** the captured system prompt was 6,338 characters on every request and included Claude Code's guidance block ("When the user types `/<skill-name>`, invoke it via Skill.").
   - **Base-diff:** a scripted agent edited a file and ran `git commit`. It exported a 349-byte model.patch with the base-diff hunk and 0 bytes without it.
   - **Final agent:** both trials completed, the gstack session called the Skill tool with investigate, and the body loaded.
6. The local parse check passed for all 8 ids plus one native and one tb2 id.

## Measure
- `laneb.skill_probe.followed` per session, from scripts/gstack-laneb/skill-probe.ts at PR #210's head 409d6946.
- The run's commit (6d095a2fd base) has no probe in to-trials.ts, so every trial directory's agent/sdk-messages.jsonl is re-probed with that file's `probeTrialDir(dir, "investigate")` after the run, and its `wilson()` gives the interval.
- Interval: Wilson 95% on followed / gstack sessions that completed with a probe reading.

## Rule (applied in this order)
1. **PROBE_FAULT** if any none session reads followed.
2. **VOID** if none passes 4 or more of its 8 trials (50% or more): the tasks were not hard for Opus 5.5, and the check says nothing.
3. **INCOMPLETE** if fewer than 12 gstack sessions completed with a probe reading. Ask HARN-1.
4. **Otherwise, on the gstack interval:**
   - upper bound below 0.60: **STOP** (gstack's skill steps on Opus become a CUT-CANDIDATE);
   - lower bound above 0.40: **PROCEED**;
   - otherwise **ASK** HARN-1.
   - Cutoffs by n: 16 (STOP 0-5, PROCEED 11+), 15 (0-5, 10+), 14 (0-4, 10+), 13 (0-4, 9+), 12 (0-3, 9+).

## HEAD moved
- For every trial, report by arm whether the agent moved HEAD.
- Method: a tool call in agent/sdk-messages.jsonl that ran `git commit`, `git reset`, `git rebase`, `git merge`, `git cherry-pick`, `git am` or a `git checkout`/`git switch` of another commit, with a result not marked as an error.
- Also report each trial's model.patch size.
- If any gstack trial moved HEAD and its model.patch is empty, every grade-based statement is provisional, the VOID rule included.

## Descriptive only (no claim)
Pass counts per arm, cost per trial, per-step /investigate counts on gstack (preamble, any skill step, Skill tool, debug report, root-cause text), and what the gstack sessions actually did.

## Report
RESULT.md, with a "Why null?" cycle (exposure, fit, power, model) when the result is null or negative. It ends with one verdict line: KEEP, FIX-METHOD or CUT-CANDIDATE, naming the part.
