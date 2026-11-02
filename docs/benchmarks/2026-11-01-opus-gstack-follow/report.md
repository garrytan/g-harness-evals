# Opus 5.5 and gstack: three uncounted follow-rate checks

**On Opus 5.5, gstack's skill text reaches the model but its steps don't run: followed 0 of 46 gstack sessions across three checks.**

- **The skill loaded every time.** gstack's router and the invoked skill were listed in every gstack session, and the body-load gate passed at a rate of 1 in all three runs.
- **No session ran a single skill step, on any of the four skills** (`/investigate`, `/qa`, `/review`, `/ship`). A few sessions ran gstack's start or end helper around an ordinary fix. None read a skill's section files, used the Skill tool, or wrote the skill's report.
- **The deciding check said STOP, on easy tasks.** `gn-follow-preset-2026-11` (Claude Code's own system prompt) decided D1: **STOP**, 0 of 16. Its population is the gstack-native-v1 dev tasks, which Opus 5.5 nearly saturates (14 of 16 passes on every arm). `gn-follow-2026-11` (the SDK stub prompt) is its baseline. It also gave STOP under its own rule, but it does not decide D1.
- **The hard check is VOID, so its 0 of 14 is descriptive.** In `gn-hard-follow-2026-11` the no-gstack arm passed 8 of 8 SWE-bench Verified bugs. Older models failed these bugs in public runs, but that did not carry over to Opus 5.5. So the tasks were not hard, and under its frozen rule the check decides nothing.
- **Pooled 0 of 46 is descriptive only.** Its Wilson 95% upper bound is about 0.077. It is not a preregistered test, and the runs used different tasks and system prompts. By skill, `/investigate` is 0 of 22 (4 + 4 + 14).
- **gstack cost about 2 times as much per trial** as no gstack in every run: a mean of $0.28 against $0.13 to $0.14 on the dev tasks, and $0.46 against $0.22 on the hard tasks.

**What these runs are.** These are uncounted checks, run from scratch branches that were never merged (`fec132d37`, `e1016ca4d`, `bee55a72`). Per internal-task, no preregistration pull request was used. Instead, each run's decision rule was frozen in the Captain's drive before its first trial, and the plan approval and the hard check's rule sha are on internal-task.

Every number below is recomputed by [results/recompute.py](results/recompute.py) from the receipts under [results/](results/), with its output in [recompute.out](results/recompute.out).

Terms used below:

- **Followed:** `laneb.skill_probe.followed`, from `scripts/gstack-laneb/skill-probe.ts` at PR #210's head `409d6946`. A session counts as followed only when it ran the skill's preamble and at least one of the skill's own steps (its section files or tools), with no tampering.
- **Preamble ran:** the probe's `preamble_ok`. `gstack-skill-start` ran and its output shows gstack's protocol lines. The preamble opens every gstack skill and is not a skill step.
- **Wilson 95%:** an interval for a proportion that still works at 0 of n. Sessions are treated as independent. They come from 8 tasks per run, so a task-clustered interval would be wider.
- **Arms:** `none` has nothing installed in `~/.claude`. `gstack` is gstack `61e201ec`, invoked by Lane B's slash-command wrapper. `placebo` installs the same 64 skill names with neutral bodies ([docs/gstack-laneb.md](../../gstack-laneb.md)).

## gn-follow-2026-11: SDK stub prompt (baseline)

**Followed 0 of 16 on every arm. This run does not decide D1.**

- **Limit: the model saw the SDK's two-line stub, not Claude Code's system prompt.** Lane B's pinned agent sets no system prompt, so Claude Agent SDK 0.2.174 sends `--system-prompt ""`. The model gets a 137-character stub instead of Claude Code's guidance, which includes "When the user types `/<skill-name>`, invoke it via Skill." So this run may understate the follow rate. That is why the preset run below was added, and why the preset run decides.
- **Tasks:** the 8 public dev tasks of gstack-native-v1 (2 each of fix, review, qa and ship), 2 tries per arm, 48 trials.

| Arm | Sessions | Followed | Wilson 95% | Passes | Pass Wilson 95% | Spend, proxy records (USD) |
|---|---|---|---|---|---|---|
| none | 16 | 0 | [0, 0.194] | 14/16 | [0.640, 0.965] | 2.2827 |
| gstack | 16 | 0 | [0, 0.194] | 14/16 | [0.640, 0.965] | 4.5514 |
| placebo | 16 | 0 | [0, 0.194] | 14/16 | [0.640, 0.965] | 3.9524 |

- **Ledger:** $10.7865 of the $21.80 lease, 335 entries, all reconciled, no cap stop ([ledger-summary.json](results/gn-follow-2026-11/ledger-summary.json)).
- **Where it ran:** one Ubicloud standard-16 VM, `<vm name>`, eu-central-h1, 2026-11-01 17:27 to 19:33 UTC, 127 minutes, list price $1.0642, destroyed ([shard-vm.json](results/gn-follow-2026-11/shard-vm.json)).
- **Code:** commit `fec132d37` on `harn14/follow-2026-11`. Agent `laneb_agent.py` unpatched, sha256 `c4f7664b...` (gstack-evals `443d582c`). Claude Code 2.1.312, Harbor `f3a5a923`.
- **Decision rule:** [decision-rule.md](results/gn-follow-2026-11/decision-rule.md), sha256 `c04a4462...b4e6`. It was last changed at 2026-11-01T17:26:30Z, before the first trial at 17:33:48Z. No sha file was written then, so the sha was computed for this report from the unchanged file ([decision-rule.sha256](results/gn-follow-2026-11/decision-rule.sha256)).
- **Under that rule: STOP.** The gstack upper bound is 0.194, below 0.60. Complete, no PROBE_FAULT. A later amendment by internal-task made the preset run the one that decides.

## gn-follow-preset-2026-11: Claude Code's own prompt (decides D1)

**Followed 0 of 16 on every arm. Decision: STOP.**

- **One change from the stub run:** the agent passes `system_prompt={"type": "preset", "preset": "claude_code"}`, so Claude Code 2.1.312 uses its own system prompt.
- **It reached the model.** In the $0 dry run, every captured request carried a 6,340-character system prompt with Claude Code's guidance block, against 137 characters with the unpatched agent ([preset](results/gn-follow-preset-2026-11/dry-run/preset-system-prompt.txt), [stub](results/gn-follow-preset-2026-11/dry-run/stub-system-prompt.txt)).
- **The paid trials show it too.** The median first request grew by about 2,150 to 2,250 tokens on every arm: gstack 40,614 to 42,768, none 20,578 to 22,812, placebo 39,535 to 41,781 (`laneb.first_req_prompt_tokens`).
- **Same tasks, arms and tries as the stub run:** 48 trials.

| Arm | Sessions | Followed | Wilson 95% | Passes | Pass Wilson 95% | Spend, proxy records (USD) |
|---|---|---|---|---|---|---|
| none | 16 | 0 | [0, 0.194] | 14/16 | [0.640, 0.965] | 2.0242 |
| gstack | 16 | 0 | [0, 0.194] | 14/16 | [0.640, 0.965] | 4.5504 |
| placebo | 16 | 0 | [0, 0.194] | 14/16 | [0.640, 0.965] | 3.9699 |

- **Ledger:** $10.5444 of the $21.80 lease, 331 entries, all reconciled, no cap stop ([ledger-summary.json](results/gn-follow-preset-2026-11/ledger-summary.json)).
- **Where it ran:** one Ubicloud standard-16 VM, `<vm name>`, eu-central-h1, 2026-11-01 18:45 to 20:16 UTC, 92 minutes, list price $0.7709, destroyed ([shard-vm.json](results/gn-follow-preset-2026-11/shard-vm.json)).
- **Code:** commit `e1016ca4d` on `harn14/follow-preset-2026-11` (the stub commit plus the agent patch). Agent sha256 `54fb5462...`. Patch file [agent.patch](results/gn-follow-preset-2026-11/agent.patch), sha256 `0d8648b7...`.
- **Decision rule:** [decision-rule.md](results/gn-follow-preset-2026-11/decision-rule.md), sha256 `6da1ee33...a95de`. It was last changed at 2026-11-01T18:45:18Z, before the first trial at 18:51:59Z.
- **Under that rule: STOP.** The gstack upper bound is 0.194, below 0.60. Complete, no PROBE_FAULT.
- **Population,** in the rule's words: "on gstack-native-v1 dev tasks, which Opus 5.5 nearly saturates on the none arm". It is not a finding about held-out tasks.

## gn-hard-follow-2026-11: 8 SWE-bench Verified bugs (VOID)

**Decision: VOID. The no-gstack arm passed 8 of 8, over the rule's void line of 4.**

- **Why VOID:** the 8 instances were picked because Opus 4.5 and 4.6 failed all 8 on mini-SWE-agent in public runs. Opus 5.5 on Claude Code solved all 8 with no gstack. **Older models' public failures did not carry over to Opus 5.5**, so "is the skill followed when the task is hard?" is still untested.
- **Design:** Opus 5.5 only, Claude Code's preset prompt. gstack told `/investigate` with 2 tries per task (16 sessions), none with 1 try (8 sessions), no placebo.
- **Tasks:** sphinx-doc__sphinx-10435, django__django-15732, django__django-15554, pylint-dev__pylint-6386, sympy__sympy-15599, pytest-dev__pytest-5787, sympy__sympy-13031 and sphinx-doc__sphinx-7985. All 8 scored 1 with the oracle and 0 with a no-op agent before any paid trial ([CHECKS.md](results/gn-hard-follow-2026-11/CHECKS.md)). No task content is in this repository.

| Arm | Sessions | Completed | Followed | Wilson 95% (of completed) | Passes | Pass Wilson 95% | HEAD moved | Empty patch | Ledger USD | Mean / median USD per trial |
|---|---|---|---|---|---|---|---|---|---|---|
| gstack | 16 | 14 (2 agent timeouts) | 0 | 0/14 [0, 0.215] | 16/16 | [0.806, 1] | 0 of 16 | 0 | 7.3427 | 0.459 / 0.381 |
| none | 8 | 8 | 0 | 0/8 [0, 0.324] | 8/8 | [0.676, 1] | 0 of 8 | 0 | 1.7379 | 0.217 / 0.190 |

- **The two timeouts:** both gstack tries on django__django-15554 hit the 2,400 s agent limit. Both still exported a patch and passed.
- **HEAD moved** means a successful `git commit`, `reset`, `rebase`, `merge`, `cherry-pick` or `am`, or a checkout of another commit, in the transcript.
  - **No session in either arm moved HEAD**, and every `model.patch` was non-empty, so the grades are not provisional.
  - The `git stash` calls and two single-file checkouts in the transcripts don't move HEAD ([extras.jsonl](results/gn-hard-follow-2026-11/extras.jsonl)).
- **Ledgers:** gstack $7.3427 of its $41.29 lease (248 entries), none $1.7379 of $18.67 (98 entries), all reconciled, no cap stop. The projection was about $36.
- **Where it ran:** two Ubicloud standard-16 VMs in eu-central-h1, both destroyed.
  - gstack: `<vm name>`, 2026-11-02 02:20 to 05:10 UTC, 171 minutes, $1.4329.
  - none: `<vm name>`, 02:20 to 02:55 UTC, 36 minutes, $0.3017.
  - A $0 check VM (oracle, no-op and dry runs) ran 37 minutes, $0.31.
- **Code:** commit `bee55a72` on `harn14/hard-follow-2026-11`: PR #218's head `6d095a2fd` plus the plan files, the agent patch, the pin change and one `run-shard.sh` line. Agent sha256 `a0d99d66...`, three hunks (see Deviations).
- **Decision rule:** [decision-rule.md](results/gn-hard-follow-2026-11/decision-rule.md), sha256 `f3ad03b1...5223`, frozen at 2026-11-02T02:19:34Z and posted to internal-task, before the first trial at 02:26:04Z.
- **Under that rule, in order:**
  1. No PROBE_FAULT: 0 of 8 none sessions read as followed.
  2. **VOID:** none passed 8, which is 4 or more.
  - INCOMPLETE would not have applied either: 14 gstack sessions completed with a probe reading, at least the 12 required. The gstack interval alone would have read STOP. The rule voids it.

## Per-skill step counts (gstack arm)

**0 of 46 gstack sessions ran any skill step, on any skill.** The 46 are 22 `/investigate` sessions (4 + 4 + 14 completed) and 24 sessions of `/qa`, `/review` and `/ship`. The table counts all 16 hard sessions; the 2 timeouts ran no step either.

| Run | Skill | Sessions | Preamble ran | Any skill step | Skill tool | gstack-skill-end | Followed |
|---|---|---|---|---|---|---|---|
| gn-follow-2026-11 | investigate | 4 | 0 | 0 | 0 | 0 | 0 |
| gn-follow-2026-11 | qa | 4 | 0 | 0 | 0 | 0 | 0 |
| gn-follow-2026-11 | review | 4 | 0 | 0 | 0 | 0 | 0 |
| gn-follow-2026-11 | ship | 4 | 4 | 0 | 0 | 1 | 0 |
| gn-follow-preset-2026-11 | investigate | 4 | 1 | 0 | 0 | 1 | 0 |
| gn-follow-preset-2026-11 | qa | 4 | 0 | 0 | 0 | 0 | 0 |
| gn-follow-preset-2026-11 | review | 4 | 0 | 0 | 0 | 0 | 0 |
| gn-follow-preset-2026-11 | ship | 4 | 4 | 0 | 0 | 2 | 0 |
| gn-hard-follow-2026-11 | investigate | 16 | 2 | 0 | 0 | 3 | 0 |

- **Hard check, other `/investigate` markers:** a "DEBUG REPORT" block in 0 of 16. Reads of investigate's skill files: 0. "root cause" in the model's text: 4 of 16 (none arm: 0 of 8).
- **Hard check, preamble:** 3 sessions called `gstack-skill-start`, but the probe counts 2. In pylint-dev__pylint-6386 r2 the call was piped through `head -5`, which cut off the protocol lines ([gstack-calls.json](results/gn-hard-follow-2026-11/gstack-calls.json), read from the uncommitted transcripts).
- **No tampering** was flagged in any session.

## What the gstack sessions actually did

- **Review:** 3 or 4 Bash calls. They read the diff with git and wrote the review. No call named gstack.
- **QA and fix:** a Read, then Bash and Edit calls on the app or the module. One preset fix session wrapped its fix in `gstack-skill-start` and `gstack-skill-end`. No other call named gstack.
- **Ship:** all 8 ship sessions (4 per dev run) ran `gstack-skill-start` first. Then they did a plain fetch, merge, commit and push, and 3 of them ran `gstack-skill-end`. Nothing from the skill ran in between.
- **Hard bugs:** they went straight to the code. That meant grep and sed on the named module, a Read, an Edit, then the repo's tests.
  - They used 7 to 30 tool calls (median 14.5), against 7 to 19 (median 11.5) on none.
  - Three sessions ran `gstack-skill-start`, then `gstack-learnings-log` or `gstack-skill-end`, around an ordinary fix.
- **The skill made every request bigger.** The median first request was 37,276 tokens on gstack against 23,269 on none in the hard check, and about 20,000 tokens more than none on the dev tasks.

## Cost per trial

| Run | Arm | Trials | Mean USD | Median USD |
|---|---|---|---|---|
| gn-follow-2026-11 | none | 16 | 0.143 | 0.087 |
| gn-follow-2026-11 | gstack | 16 | 0.284 | 0.265 |
| gn-follow-2026-11 | placebo | 16 | 0.247 | 0.214 |
| gn-follow-preset-2026-11 | none | 16 | 0.127 | 0.090 |
| gn-follow-preset-2026-11 | gstack | 16 | 0.284 | 0.249 |
| gn-follow-preset-2026-11 | placebo | 16 | 0.248 | 0.229 |
| gn-hard-follow-2026-11 | gstack | 16 | 0.459 | 0.381 |
| gn-hard-follow-2026-11 | none | 8 | 0.217 | 0.190 |

- **gstack against none, mean per trial:** 1.99 times (stub), 2.25 times (preset), 2.11 times (hard; the two timeouts are part of it).
- **Total spend:** ledgers $30.4116 against leases of $103.56. Ubicloud list price $3.88 for five VMs.
- Per-trial figures are our metering proxy's `usage.usd` on each record. Each ledger is the authoritative total, and the record sums match it to the cent.

## Clean control arm

**The none arm is clean in all three runs: 0 gstack, drive or skill reads in 40 sessions.** This follows the crew rule "Clean no-gstack and no-brain arms" (2026-11-02).

**Where the none arms ran:** on Ubicloud VMs in Harbor containers, never on a Capy machine.

- No Capy drive goes to a VM. `run-shard.sh` uploads only the commit's checkout and the named Lane B parts: gstack-evals, the arm tars, terminal-bench-2, and harbor-datasets in the hard check.
- The none tar (`8bab4833`, pinned) holds two empty directories, `.claude/` and `.claude/skills/`. Every none init message listed only Claude Code's built-in skills (doctor, plugin-authoring).

**Preflight, checked live on the hard check's gstack VM.** That VM is built the same way as the none VM, which was already destroyed ([preflight.out](results/gn-hard-follow-2026-11/preflight.out), [preflight2.out](results/gn-hard-follow-2026-11/preflight2.out)).

- **VM:** no `.capy` directory for any user, 0 drive paths, no `~/.local/share/gstack` or `~/.claude/skills`, 0 `gstack-*` binaries on PATH.
- **Container:** a none-arm container built from django__django-15732's agent Dockerfile, with the none tar extracted into /root. It had 0 drive paths, 0 gstack paths under /root, /home and /opt, an empty `/root/.claude/skills`, and 0 `gstack-*` binaries on PATH.
- **The two dev runs have no live preflight.** Their evidence is the upload list, the none tar and the read audit below ([control-audit.md](results/gn-hard-follow-2026-11/control-audit.md)).

**Read audit, per arm.** A counted call is any tool call whose input names `gstack`, `.capy`, `.claude/skills` or one of the 64 gstack skill paths, or any Skill call ([audit.py](results/audit.py); output in each run's `control-audit.json`).

| Run | Arm | Sessions | Tool calls | Calls touching gstack, drive or skill | Sessions with one | SKILL.md reads | Skill tool | Init lists gstack |
|---|---|---|---|---|---|---|---|---|
| gn-follow-2026-11 | none | 16 | 89 | **0** | 0 | 0 | 0 | 0 |
| gn-follow-2026-11 | gstack | 16 | 111 | 5 (Bash) | 4 | 0 | 0 | 16 |
| gn-follow-2026-11 | placebo | 16 | 94 | 0 | 0 | 0 | 0 | 16 |
| gn-follow-preset-2026-11 | none | 16 | 92 | **0** | 0 | 0 | 0 | 0 |
| gn-follow-preset-2026-11 | gstack | 16 | 112 | 10 (Bash) | 5 | 0 | 0 | 16 |
| gn-follow-preset-2026-11 | placebo | 16 | 95 | 0 | 0 | 0 | 0 | 16 |
| gn-hard-follow-2026-11 | gstack | 16 | 257 | 6 (Bash) | 3 | 0 | 0 | 16 |
| gn-hard-follow-2026-11 | none | 8 | 98 | **0** | 0 | 0 | 0 | 0 |

- **Placebo is not a no-gstack control, by design.** Its tar (`ff6b909d`) installs the same 64 skill names with gstack's frontmatter and neutral bodies, so its init lists them. It read none of them.
- **gstack's touching calls** were `gstack-skill-start`, `gstack-skill-end` and `gstack-learnings-log` runs, plus an `ls` of gstack's bin directory. `control-audit.md` calls some of these "direct reads under ~/.claude/skills/gstack": they are calls to files in gstack's bin directory, and none read a SKILL.md or a skill's section file.

## Why null?

1. **Exposure: yes, it reached the model.**
   - The router and the invoked skill were listed in all 48 gstack sessions. The body-load gate passed at rate 1 in all three runs (each run's `gates.json`).
   - Claude Code's guidance block reached the model in the preset and hard runs: 6,340 and 6,338 characters in their dry runs.
   - The model acted on the top of the skill: the preamble ran in 4, 5 and 2 sessions (the hard run had 3 start calls; the probe counts 2). Then it skipped every step, on all four skills.
2. **Fit: the right kinds of task, but too easy.**
   - The dev tasks are the four skills' own types (fix for `/investigate`, review, qa, ship). But every arm passed 14 of 16, so the deciding STOP holds only for these near-saturated dev tasks.
   - SWE-bench Verified bug fixes are what `/investigate` is written for. Opus 5.5 still solved all 8 with no gstack, at $0.15 to $0.31 each, so that check is VOID and its 0 of 14 is descriptive.
   - Context only: on Terminal-Bench 2 (internal-task, #109), Opus wrote 0 DEBUG REPORT blocks in 111 told `/investigate` trials. Those tasks were mostly not debugging.
3. **Power and saturation: the follow measure has power; the pass rate has none.**
   - The deciding run's gstack upper bound (0.194) is well below the 0.60 STOP line. So is the stub run's (0.194). The hard run's (0.215) is descriptive, because that run is VOID.
   - Pooled, 0 of 46 has an upper bound of about 0.077, and 0 of 30 under Claude Code's preset about 0.114. Both are descriptive only, not preregistered tests, and 14 of the 30 come from the VOID run.
   - No pass-rate contrast is possible. Every arm is at or near the ceiling (14/16, 16/16, 8/8).
4. **Model: frontier only.** Opus 5.5 is the only model tested. GPT-6.1 Sol was not run in these checks. There is no Haiku or Sonnet arm.

CUT-CANDIDATE: gstack's skill step procedures (/investigate, /qa, /review, /ship) on Opus 5.5, as delivered by skill text alone. The body loads in every session, and 0 of 46 gstack sessions across three checks ran any step (0 of 30 with Claude Code's own system prompt; /investigate 0 of 22; under the preset, /qa, /review and /ship are each 0 of 4, so per-skill bounds are wide (about 0.49)). The deciding run (preset, STOP, 0 of 16) is on gstack-native-v1 dev tasks that Opus 5.5 nearly saturates. The hard-task check was VOID (no-gstack passed 8/8), so its 0 of 14 is descriptive. The fix to test is enforcing the steps with hooks, or dropping them.

## Deviations

- **The agent is Lane B's pinned `laneb_agent.py`** (gstack-evals `443d582c`, sha256 `c4f7664b...`), patched in two runs. The hard run's patch has three hunks ([agent.patch](results/gn-hard-follow-2026-11/agent.patch), sha256 `d4a3de1a...`):
  1. **Preset:** `system_prompt={"type": "preset", "preset": "claude_code"}`. File sha256 after it: `54fb5462...`. This hunk alone is the preset run's agent.
  2. **Base-diff:** record `git rev-parse HEAD` at setup and diff against it, so an agent that commits still exports its patch. After it: `57cb86d8...`. No paid trial needed it (0 HEAD moves).
  3. **Task-id parse:** `rsplit("__", 2)[0]` replaces `split("__")[0]`, because every SWE-bench id contains `__`. Final: `a0d99d66...`, the sha `pin.json` carries.
- **Run-shard upload line (hard run, its deviation D1):** `scripts/ubicloud/run-shard.sh` gained one line, `[ ! -d "$laneb_root/harbor-datasets" ] || laneb_parts+=(harbor-datasets)`. Without it the VM never gets the dataset. Tasks, arms and grading are unchanged.
- **Stub run tries:** the plan text said gstack 3, placebo 2, none 1. `plan.ts` takes one repetition count, so every arm ran 2 tries.
- **Hard run plan files:** two plan files under one prefix (gstack with 2 repetitions, none with 1), for the same reason.
- **Hard run probe:** the run's commit has no probe in `to-trials.ts`, so every trial was re-probed after the run with `skill-probe.ts` at `409d6946` ([reprobed-trials.jsonl](results/gn-hard-follow-2026-11/reprobed-trials.jsonl), [analyze.ts](results/gn-hard-follow-2026-11/analyze.ts)). The dev runs' stored bits equal a re-probe at that head.
- **Preflight on a live shard:** the control-arm preflight ran on the gstack shard's VM while it was running trials. Its two output files were written at 03:56:57 and 03:57:41 UTC ([preflight-stamps.txt](results/gn-hard-follow-2026-11/preflight-stamps.txt)). That overlaps the last seconds of django__django-15732 r2 (ended 03:57:05) and the start of django__django-15554 r2 (started 03:57:05). `preflight.sh` ran `find` over the VM and `preflight2.sh` built a container on the same Docker daemon, so both trials' wall times may be perturbed. 15554 r2 later timed out; try 1 of the same task also timed out, with no preflight running. Future preflights go on a separate VM or after the shard ends.
- **gstack arm:** the pack-equivalent rebuild (tar `b9399468...`), the dated deviation of 2026-10-29 in `pin.json`. Every gstack record carries `laneb.arm_deviation`.

## Reproduce and inspect

- `python3 docs/benchmarks/2026-11-01-opus-gstack-follow/results/recompute.py` prints every count, interval and cost on this page from the committed files ([recompute.out](results/recompute.out)).
- **Per run, under [results/](results/):** `trials.jsonl`, `run-summary.json`, `ledger-summary.json` (a read-only query of the shard's `ledger.sqlite`), `accounting.json`, `attestation.json`, `arms.json`, `gates.json`, `shard-vm.json`, `plan.json`, `decision-rule.md`, `decision-rule.sha256` and `control-audit.json`.
  - The dev runs add `skill-probe-summary.json`.
  - The hard run keeps each arm's files under `gstack/` and `none/`, and adds `reprobed-trials.jsonl`, `extras.jsonl`, `analysis.out`, the checks and the preflight.
- **`analyze.ts` fails open without the none shard.** If the none shard's records were missing it would skip PROBE_FAULT and VOID instead of reporting INCOMPLETE. Both shards are present here (none 8 of 8), so the VOID stands.
- **`analyze.ts` does not run from this repository.** It imports `probeTrialDir` and `wilson` by an absolute path from a internal-task worktree at PR #210's head `409d6946`, where `scripts/gstack-laneb/skill-probe.ts` lives; main has no such file yet. It also reads the transcripts. Its outputs, `reprobed-trials.jsonl`, `extras.jsonl` and `analysis.out`, are committed.
- **Not committed:** transcripts, `ledger.sqlite` files, proxy logs, Harbor job trees and all SWE-bench task content. The read audit and the re-probe read the transcripts, and their outputs are committed. The raw files stay in internal-task's run directories.
- No file was withheld by the redaction check.

## Disclosures

gstack is Garry Tan's own project.
