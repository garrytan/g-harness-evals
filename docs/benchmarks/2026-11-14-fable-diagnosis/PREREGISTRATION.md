# Does Fable 5.2 beat Opus 5.5 when the bug report doesn't say where the bug is?

Status: preregistered 2026-11-14 (UTC), before any trial of this run. Run id `fable-diagnosis-2026-11`. Cells, shards and leases are in the eleven plan files `prereg-harbor-s01.json` to `prereg-harbor-s11.json` beside this file, and each shard's tasks are in [shards.json](shards.json). The task labels are in [labels.json](labels.json), and the oracle check that decides which tasks run is in [oracle-check.json](oracle-check.json).

**In one line:** run Claude Fable 5.2 and Claude Opus 5.5 in plain Claude Code (no gstack in either arm) on 107 fresh, real GitHub issues from July 2026 (every task of the source our rig can score), two tries each, and test one prediction made from reading the traces of the last run: Fable 5.2's lead over Opus 5.5 is larger on issues whose text never names a file the fix changes than on issues that point at one.

**What this is not:** a harness comparison, a gstack or gbrain test, or a general ranking of the two models. The result is about these tasks in Claude Code 2.1.322.

## Approval

- **Garry, 2026-11-14, relayed by the agent that tracks his rules:** "ok so fable 5.2 as 2.8x more expensive for a set of tasks. is ther ea set of tasks that fable 5.2 are significantly better at such that it is worth it?", with an X user's four-step prompt that asks for exactly this test (a prediction about fresh tasks, one task feature, fresh tasks with and without it, the disproving result written down first, the harness, grading and attempt count fixed, solve rate and cost per solve per group).
- **The coordinating agent for this repository, 2026-11-14:** the prediction test runs without a separate plan gate, because Garry asked for it outright; about $2,000 all-in, and the coordinating agent hears before anything passes $5,000.

## Where the prediction comes from

The last run ([fable-5-2-coding-cc322-2026-11](../2026-11-12-fable-5-2-coding-cc322/report.md)) put both models through 52 Terminal-Bench 2.1 tasks, two tries each. Fable 5.2 solved 82.7% and Opus 5.5 84.6%, a difference of -1.9 points [-9.6, +5.8], at 2.80x the cost per solve. We then read every try on the 14 tasks where either model failed, with the model names hidden (the reads and the unblinded table are summarised in [the reading notes](trace-read.md)). What the reads found:

- **Fable 5.2 does more on each task.** It spent a median 1.56x as long waiting on the model per task (more than Opus on 34 of 43 tasks with a session log; both figures come from session logs that were not committed with that run, so they can't be rechecked from the repository), dug deeper, and kept working after it had a passing answer.
- **That won both tasks where the obvious approach fails and the agent has to work out why.** On extract-moves-from-video, Opus ran a generic OCR tool that was too slow for the one-CPU container and never wrote an answer, while Fable read the fixed character grid directly (Fable 2 of 2, Opus 0 of 2). On install-windows-3.11, Fable found that the stock emulator's video driver drew no text and patched it, in both tries (Fable 2 of 2, Opus 1 of 2).
- **It lost where the task was literal or the clock was tight.** pytorch-model-cli (Fable changed the input scaling beyond what was asked, 0 of 2 against 2 of 2), make-mips-interpreter (24 extra minutes of unrequested work, then the time limit), overfull-hbox and make-doom-for-mips.
- **Half the failed tries (17 of 34) were the API safety filter**, which says nothing about either model's skill. No try passed 190K tokens of context, so the traces give no reason to test long sessions.

The feature we take from this is **having to find where the fault is**. On a real repository issue, the plain mechanical version of that is whether the issue text names any of the files the real fix changed.

## The prediction, and what would disprove it (fixed before any trial)

Definitions: a task's difference is Fable 5.2's pass share minus Opus 5.5's pass share on that task (each over its two tries). A group's difference is the mean over its tasks, paired by task, with a task bootstrap 95% interval (10,000 draws). The **interaction** is the "needs diagnosis" group's difference minus the "pointed" group's difference, with a stratified task bootstrap 95% interval. Seeds, as `feature-split.ts` uses them: the group intervals use seed 20261114 (`export const OPTS = { seed: 20261114, draws: 10000 };`) and the interaction uses 20261114 + 1 (`const rnd = seededRandom(options.seed + 1);`).

**Prediction (H1):** the interaction is positive. Fable 5.2's lead over Opus 5.5 is larger on tasks whose instruction names none of the changed files than on tasks whose instruction names at least one.

Readings, applied by `scripts/frontier-harbor/feature-split.ts` exactly as written here:

- **Disproved** if the interaction's point estimate is zero or below, **or** if the "needs diagnosis" group's difference has a 95% interval entirely below zero (Fable 5.2 measurably worse on exactly the tasks the prediction picks).
- **Supported** if neither of those holds and the interaction's 95% interval is entirely above zero.
- **Not shown** otherwise: the direction is right but this sample cannot tell it from noise. The report states the smallest interaction this sample could detect.

**Per group (H2, co-primary):** the paired difference with its 95% interval in each group, read as "Fable 5.2 higher", "Fable 5.2 lower" or "no measurable difference" by whether the interval excludes zero.

**Is the premium worth it (H3, descriptive):** per group, each model's cost per solve, the paired cost-per-solve ratio (Fable over Opus) with its interval, and the **extra cost per extra solve**: what Fable 5.2 spent beyond Opus 5.5, divided by how many more tries it solved. The report's recommendation rule, fixed now:

- Opus 5.5 stays the default for a kind of task unless Fable 5.2 is measurably higher in pass rate there.
- Where Fable 5.2 is measurably higher, the report gives the extra cost per extra solve and calls the premium "worth considering" for that kind of task; whether it pays is the reader's call against what a solved issue is worth to them.
- A difference that is not measurable is reported as "no measurable difference on these tasks", never as a win for either model.

## What each result changes (decided before any trial)

Our own agent setup already carries a provisional rule taken from the trace read: when Opus 5.5 fails a task because its first approach was a dead end and the task needs a diagnosis, hand it to Fable 5.2 once, with a short brief and a time limit. This run decides whether that rule stays.

- **Supported:** the rule becomes standing, and the gstack maintainers plan an escalation step (Opus first, Fable 5.2 once on a diagnosis-type failure), with stop conditions for Fable 5.2 and safety-filter stops counted on their own. The report gives the extra cost per extra solve, so a team can see what the escalation costs per issue it rescues.
- **Not shown:** the rule is withdrawn, because we don't keep a rule we couldn't support; Opus 5.5 stays the default everywhere, and the report says how large a difference this run could have missed. The gstack maintainers still add the Fable 5.2 stop conditions and the separate safety-filter counts, which the trace read supports on its own.
- **Disproved:** the same as "not shown", and the report says plainly that the one pattern the traces suggested did not hold on fresh tasks.
- **Either way:** if Fable 5.2 is measurably higher in pass rate across all 107 counted tasks, the report says so and gives its cost per solve, whatever the split shows.

## Tasks

- **Source:** the Harbor dataset `ibragim-badertdinov/swe-rebench-07-2026@2026-07`: 111 hard tasks from the July 2026 SWE-rebench leaderboard snapshot (Nebius), each a real GitHub issue with its repository at the issue's base commit, scored by the repository's own tests that the real fix made pass (FAIL_TO_PASS) and kept passing (PASS_TO_PASS). 21 Go, 21 Java, 20 Python, 25 Rust, 24 TypeScript. The dataset declares CC BY 4.0; each repository keeps its own licence. None of these tasks was in any earlier run of ours.
- **Why these:** they are other projects' real problems, they are newer than the Terminal-Bench set, and they leave room above Opus 5.5 (the last run's Opus ceiling was the main limit on showing a Fable win).
- **Pinned:** the dataset source, every task's digest and every base image's registry digest are in `scripts/frontier-harbor/pin-swe-rebench-07-2026.json`. Each task runs as published except for these pinned changes in that file, checked before an image builds: the base image pinned by digest, two build steps pinned by sha256 (the history scrub on every task, and the Python install on 44), and the verifier env settings. The history scrub removes every trace of git history past the task's base commit (the published images all keep a `.git/ORIG_HEAD` that names a later upstream commit). The Python step installs CPython 3.13.5 (uv 0.7.13) into the 44 images that have no Python, because their test parser otherwise asks uv to download Python from github.com, which the blocklist below stops. The verifier env settings are `UV_PYTHON_DOWNLOADS=never` on every verifier, so a test that still tries to download fails loudly, and `UV_PYTHON_INSTALL_DIR=/opt/uv-python` on the 44 prefetch tasks, so their verifier finds that install.
- **Which tasks count:** before any model trial, Harbor's reference-solution agent (oracle) and its do-nothing agent (nop) ran on every task through this exact rig on one VM ([oracle-check.json](oracle-check.json)). A task counts only if the oracle scored 1 and the do-nothing agent scored 0. Result: 107 of 111 count. Every do-nothing agent scored 0, and 4 oracles failed for reasons in the dataset, not in either model or our rig, so those 4 tasks are left out of every arm (the causes are written up in [README.md](README.md); oracle-check.json records only the rewards): langchain4j__langchain4j-5315 and langchain4j__langchain4j-5367 (Maven cannot find the project's own unreleased 1.16.0-SNAPSHOT modules), openrewrite__rewrite-7784 (Gradle cannot find the project's own unreleased 8.93.11 artifacts) and apache__pulsar-25953 (the build is killed at the task's own 4 GB memory limit). The same check found no history past the base commit in any built image; on one task (Gentleman-Programming__gentle-ai-595) the check for the fix's text could not run because the fix adds no distinctive line, and every structural count on its image is 0. An earlier pass of the same check, before the Python step, failed 44 tasks on the Python download; both passes are in the folder ([oracle-check-first-run.json](oracle-check-first-run.json)).
- **The label** (`scripts/frontier-harbor/diagnosis-label.ts`, output in [labels.json](labels.json)): the changed files are the files the reference patch changes, less tests and docs (the paths the script's case-insensitive `TEST` and `DOC` patterns match). A changed file is **named** when the task instruction contains its path, its file name, or its file stem as a whole word (a stem counts only with 4 or more characters and not one of 24 generic names such as `utils` or `index`). The path and the file name count wherever they appear in the instruction text; only the stem has to match as a whole word. On these 111 tasks the two patterns drop no file outside a test or doc path, and no reference patch has a quoted path that the parser would skip. A task **needs diagnosis** when the instruction names none of its changed files, and is **pointed** when it names at least one. The rule reads only the instruction and the reference patch. On all 111 tasks it gives 50 "needs diagnosis" and 61 "pointed"; on the 107 that count, **49 and 58**. `--check` recomputes every label from the downloaded dataset and exits 1 on any difference; it needs the dataset, so it runs by hand before this file is frozen and again in the results pull request, not in CI.
- **Known imbalance:** on the 107 counted tasks, Rust is 16 of the 49 "needs diagnosis" tasks and 9 of the 58 "pointed" ones; Python and Go lean the other way (6 and 7 against 14 and 14); Java is 9 against 8 and TypeScript 11 against 13. The report gives the per-language split as a descriptive line. Both groups have a median of 2 changed files. The label may also track feature requests against bug reports, because a feature request often names the new file in its interface section; the report says so beside the result.
- **Shared order and shards:** the 107 counted tasks sorted by sha256("fable52-diagnosis-2026-11-14\0<task id>"), then split in that order into 11 shards: the first 8 have 10 tasks and the last 3 have 9 ([shards.json](shards.json), pinned by sha256 in each plan file).

## Arms

| Arm | Model id | Harness | gstack | Tries per task |
|---|---|---|---|---|
| Fable 5.2 | `anthropic:claude-fable-5-2` | Claude Code 2.1.322 | none | 2 |
| Opus 5.5 | `anthropic:claude-opus-5-5` | Claude Code 2.1.322 | none | 2 |

- **Settings are those of the last run, unchanged:** Claude Code 2.1.322 at its pinned binary sha256 (`bfb3703a...`), each model's real 1M context window and 128,000 max output tokens, effort high (adaptive thinking and `output_config.effort: high`), hosted web search and web fetch off, retries off, the small-fast housekeeping model pinned to the cell model (a declared deviation, as in every run), every model call through the metering proxy with a per-trial dummy token. Neither arm has gstack, so both arms are the plain Claude Code setup (the no-gstack arm every comparison here includes).
- **Same harness, same grading, same tries:** each task's own Harbor agent and verifier time limits (3,000 seconds each), its own tests, two tries per model.
- **Egress:** the task containers keep the internet access the tasks declare (package registries are needed to build and test), behind the same egress blocklist sidecar as the last run, with hosts added for this source because every fix here is a public merged pull request. The repository's base list of 14 hosts stays (task and leaderboard sites, the model providers' own APIs and, since the last run, Cursor's three hosts; the oracle check above ran before those three were added), and this source adds 11: `github.com`, `*.github.com`, `*.githubusercontent.com` and `codeload.github.com` (the merged pull request, its diff and the later history), `huggingface.co`, `*.huggingface.co`, `hf.co` and `*.hf.co` (the source datasets, which hold each gold patch), `swe-rebench.com` and `*.swe-rebench.com` (the leaderboard, with its tasks and other models' trajectories), and `ofhuhcpkvzjlejydnvyd.supabase.co` (the Harbor hub's file store, which serves each task archive with its reference patch). The list and a reason for each host are in the pin file's `egress` block. A trial that cannot start its sidecar fails instead of running unblocked.
- **Prices:** `runner/pricing/prices-2026-11-09.json`, the same dated table as the last run.
- **Clean arms:** the trials run on Ubicloud VMs with no Capy drive mounted and no gstack install; each shard's preflight records that gstack is absent, and the contamination audit counts any gstack file read (none is expected).

## Contamination guard

- The blocklist above stops the obvious routes to the answer: the merged pull request, the source datasets and the Harbor hub's copy of each task.
- The task images hold no git history past the base commit (checked on every built image, see above).
- **What stays open:** package registries, because the tasks need them to build and test. An agent could in principle install a later release of the project's own package that already holds the fix. The audit below says how such a trial is counted.
- **Audit (descriptive):** `scripts/frontier-harbor/audit.ts` over every captured request. A trial counts as registry-release contaminated if its egress or proxy log, or its transcript, shows it fetched the task repository's own package, release or tag published after the task's base commit, from a package registry or GitHub releases. The report gives that count per arm. It is a sensitivity line: flagged trials stay in the primary analysis, which does not change, and the report adds one line without them. The results PR implements the counting.
- The tasks are from July 2026. Neither model's training cutoff is published here, so the report says that some issues may predate a cutoff, and that this would affect both arms.

## Sharding, timing and the canary

- **Shards:** 11, one Ubicloud standard-16 VM each, with both models' cells for the same tasks on the same VM, so each image is pulled once and both arms see the same machine. No cell is split across machines. Each shard is a clean checkout at this preregistration's merge commit, with its tasks fetched from the Harbor hub by content hash and checked against the pin before any image builds. Each shard runs 40 trials (36 on the last three), 428 in all. At concurrency 4 we expect about 3 to 5 hours per shard; every VM gets a 10-hour lifetime and is destroyed when its shard ends. The oracle check pulled all 111 images on one VM within Docker Hub's anonymous pull limit, so 10 images per VM is well inside it.
- **Canary first:** one shard runs alone until it has finished at least one scored trial of each model and copied its results off the VM; the other shards launch only then.
- Trials run four at a time per VM (concurrency 4), as in the last run; wall times are reported as contended.

## Budget and stop rule

- **Expected:** about $1,500 in paid trials (428 trials; about $5 per Fable 5.2 try and $2 per Opus 5.5 try, our guess scaled up from the last run because these repositories are larger; the canary measures it), plus VMs and our own model use, about $1,900 to $2,500 all-in. That may pass the $2,000 guideline because the task source caps the sample at 107 scorable tasks and a smaller run could not test the prediction at all.
- **Caps:** each shard has its own metering lease of $330, and a shard that reaches its lease stops, so the 11 leases stop model spending at 11 × $330 = $3,630. Each plan's cap is $345, with $15 held back that no shard spends. A lease is runaway protection, sized at more than twice a shard's expected spend (about $140), and is never raised during the run except by a dated amendment.
- **Stop rule, fixed now:** if the canary shard's spend per finished try projects the whole run past $3,630 in paid trials (the lease total), no further shard launches until the coordinating agent says so.

## Power: what this run can and cannot detect

The smallest difference detectable with 80% power at a two-sided 0.05 level, for a per-task difference with standard deviation between 0.35 and 0.45 (the last run's was 0.29 on easier tasks). Each bound is 2.8016 (1.96 + 0.8416) times that standard deviation over the square root of the task count (for the interaction, times the square root of 1/49 + 1/58), rounded up:

| Comparison | Tasks | Smallest detectable difference |
|---|---|---|
| Fable minus Opus, needs diagnosis | 49 | 15 to 19 points |
| Fable minus Opus, pointed | 58 | 13 to 17 points |
| Fable minus Opus, all tasks | 107 | 10 to 13 points |
| Interaction (the prediction) | 49 and 58 | 20 to 25 points |

So a "not shown" reading is likely unless the effect is large. The report gives the smallest detectable difference computed from the data beside every comparison, and a null is never read as "no effect". Two tries per task is fixed by the question, and 107 is every task the source has that our rig can score.

## Analysis

- **Primary:** `bun scripts/frontier-harbor/feature-split.ts --trials results/merged/trials.jsonl --labels labels.json --out results/analysis`. Scoring is the repository's trialValue rule: a pass is a passing grade with no consent violation; a harness error (a safety-filter stop included) is a fail; a model error, infra error or exam fault is left out of its pair and counted per arm.
- **Sensitivity lines (descriptive):** without the trials `refusals.ts` lists, which for Claude Code are the trials stopped with `AgentSafetyRefusalError`. In the last run that caught 12 of the 17 safety-filter stops of these two models (the other 5 are in that run's `results/safeguard-stops/`), so the report also counts the other filter stops it can identify, by hand from the traces, without changing any reading; without trials the contamination audit flags; per language.
- **Also reported:** time-limit hits per arm, median and 90th-percentile minutes per try, peak context per try (how many tries passed 200K tokens, since the last run had none), tries per arm that the safety filter stopped.
- **After the numbers:** a blind trace read of the tasks where the two models differ, read the same way as the last one, to say whether the label caught what actually separated them. It is descriptive and changes no reading above.

## Considered and left out: particle-1

- **The question (Garry, 2026-11-14):** "is it time to use particle-1 for implementation and opus 5.5/fable5.2 only for plan mode and troubleshooting and difficult problems?" The plan was to add particle-1 as the whole agent, and particle-1 implementing from an Opus 5.5 plan, on these same tasks, if plain Claude Code could drive it with no other harness change.
- **Why it is not in this run:** Claude Code talks only to Anthropic's Messages API (`POST /v1/messages`). Particle serves particle-1 only over OpenAI-style Chat Completions and a Responses WebSocket (docs.particle.ai and its llms.txt index, read 2026-11-14), and our metering proxy forwards each provider's own API without translating between them (`runner/proxy/metering-proxy.ts`: Particle allows only `POST /v1/chat/completions`). Running particle-1 inside Claude Code would need a translation layer or a third-party gateway between them, which is a harness change, so the comparison would no longer hold the harness fixed.
- **What exists instead:** in gstack-evals' routing run, particle-1 as the whole agent (in a harness that speaks Chat Completions) fixed 62 of 95 paired issues against 64 for plain Opus 5.5, with sessions costing about 7% of Opus's. That is cited, not rerun, and it is not on these tasks.

## What would change this plan

Any change to tasks, labels, rules, settings, pins or the analysis script after this file's commit is a dated amendment committed before the trials it affects, or a new run id. A trial is never rerun except as an infra rerun the repository's existing rules allow (for example `verifier_unavailable`), and every rerun is listed.
