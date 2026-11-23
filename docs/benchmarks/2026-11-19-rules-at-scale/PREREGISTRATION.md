# Rules files at scale preregistration: does each agent still follow its rules file as the file grows?

Status: written 2026-11-19 (America/Los_Angeles), after the uncounted pilot and before any counted trial; re-pinned 2026-11-21 (UTC) on the build as it landed on main, still before any counted trial ([what changed](#changes-before-any-counted-trial-2026-11-21)). Run id `rules-at-scale-2026-11`. Shards and leases are in [shards-first.json](shards-first.json), [shards-second.json](shards-second.json) and the generated [plan-first.json](plan-first.json); the pinned files in [pins.sha256](pins.sha256); the analysis design (alpha, power, planned effect, SD, task order, setups) in `scripts/rules-at-scale/design.json`.

**In one line:** six ordinary, checkable rules are planted at the top, middle and end of rules files from about 0.8 KB to 160 KB (real public rules files as padding), and 36 real bug-fix tasks run through Claude Code, Codex, Hermes, OpenClaw and Pi on Opus 5.5, with particle-1 as the low-cost model; Codex runs on GPT-6.2 Sol by a dated amendment. A script checks the finished repository and the model requests for each rule; no model grades anything.

**Read this first: what the pilot already shows.**

- **Delivery decides almost everything on the frontier models.** In the pilot, a planted rule that reached Opus or Sol (GPT-6.1 Sol, the pilot's model) whole at the start was followed 494 of 505 times; a rule that never arrived was followed 4 of 101 times; a rule the agent read from the file itself later was followed 31 of 31 times ([pilot](#pilot)).
- **So the size limits mostly come from the harness, not the model.** OpenClaw drops the middle of the file from 28 KB up. Codex keeps only the first 32 KB but Sol often reads AGENTS.md itself. Claude Code, Hermes at a 1M context and Pi send everything, and Opus sits near the ceiling there at every size.
- **This run measures the size of those effects with intervals, per harness**, and whether particle-1's drop with size (seen on one task each on Pi and Hermes) holds up.

**What this is not:** a test of gstack's or gbrain's own blocks (the rules are stand-ins, decision R), of QM (its cells come by amendment, below), or of a model judge.

## Eval loop

- Size: counted run
- Paid budget: $820
- Model judge: none

## Approval

- **Garry, 2026-11-19,** answering the plan's gate (autoplan run `harn109-rules-at-scale-okrzzb-20261119054110`, rec-hash a83d1994ea42), relayed by the coordinating agent: "Do it". That took every recommendation: review changes A to L and plan choices M to T.
- **Plan:** the approved plan with its "Changes accepted at the gate" section, in the coordinating agent's drive under this lane's handoff (`plan.md`). Where the plan and this file differ, this file says why ([Deviations](#deviations-from-the-plan)).

## Question and the decisions it changes (R97)

1. **For gstack:** where gstack's block should sit in CLAUDE.md and AGENTS.md and how long it may be on each host, and on which hosts only a hook is reliable.
2. **For gbrain:** whether gbrain's "check the brain first" rule survives in a long rules file on each harness, or needs its per-turn hook.
3. **For users:** per harness, the largest rules file size that keeps every rule (the safe size), and whether to trim, split into folder files, or move must-follow rules into a hook.

## Setups and arms

| Setup | Harness | Model | Arms | Cells |
|---|---|---|---|---|
| claude-code-opus | Claude Code 2.1.328 | Opus 5.5 | none, short, 8, 28, 80, 160 KB, split, hook | 8 |
| codex-sol | Codex | GPT-6.2 Sol, by amendment ([below](#deviations-from-the-plan)) | the same plus cut lifted | 9, by amendment |
| hermes-opus | Hermes | Opus 5.5 | none, short, 4 sizes, split, hook | 8 |
| openclaw-opus | OpenClaw | Opus 5.5 | the same plus cut lifted | 9 |
| pi-opus | Pi | Opus 5.5 | none, short, 4 sizes, split | 7 |
| pi-particle, hermes-particle | Pi, Hermes | particle-1 | none, short, 4 sizes | 6 each |
| **Total in this run** | | | | **44 cells, 1,584 trials** (Codex's 9 by amendment) |

Harness versions are the newest releases, pinned in `scripts/rules-at-scale/pin.json`.

- **none:** no rules file. **short:** the six rules in three short sections, about 0.8 KB. **8, 28, 80 and 160 KB:** the six rules at the top, middle and end (two per position, rotated by task: rotation = task index mod 3) inside real public rules-file sections, nested so each bigger file contains the smaller one's padding in order. 28 KB stays under 32,768 bytes and over 20,000 characters.
- **split:** the 160 KB content, with R3 moved into the tests folder's rules file and R5 into the package folder's (Claude Code: R1 into `docs/conventions.md` through an `@` import).
- **hook:** the 160 KB file plus the six rules once beside the task through the harness's hook (Claude Code, Codex, Hermes, OpenClaw's `openclaw agent --local`).
- **cut lifted:** the 160 KB file with the harness's limit raised (Codex `project_doc_max_bytes` 262144; OpenClaw `bootstrapMaxChars` 200000 and `bootstrapTotalMaxChars` 300000). Hermes has none: at its 1M context length it sends 160 KB whole.
- **Named settings:** Hermes context length is the model's window from the pin (1M for Opus 5.5 and particle-1). Every rules file is kept out of git through `.git/info/exclude`.

## Tasks

36 merged upstream bug fixes with linked issues from 11 MIT or BSD Python libraries (`tasks/repo/rules-fix-v1/dev`, rf-01 to rf-36). Each passes acceptance on 3 runs (the reference fix scores 1; doing nothing, a wrong fix and two tamper checks score 0) and the task contract (precheck, notes, edit watcher, signed commits). One try per task per cell.

Each task's upstream test suites (the tests the verifier runs, 1,056 files across the 36 tasks, about 11 MB copied verbatim from the 11 libraries) ship packed in one `verifier/tests.tar` per task, and code review does not read those tars: they are too large for the review tooling, which reads only our own code. Each file in them is pinned to its upstream commit by git blob id in `scripts/repo-tasks/rules-fix/upstream-blobs.json`, and a test that runs in CI on every pull request unpacks every tar and fails on any missing, extra or changed file. The code that packs and unpacks them, the pin file and that test are reviewed as usual.

## The six rules and how each is graded

Rule texts are byte-exact in `scripts/rules-at-scale/rules.json`.

| Rule | Text (short) | Met when (from the finished repository and logs) |
|---|---|---|
| R1 | Record every change in a kebab-case file under `changes/` | a non-empty kebab-case `.md` file directly under `changes/` in the final tree |
| R2 | Run `./scripts/precheck` after your last edit | the last precheck line has exit 0 and its tree hash equals the final tree's (git-visible files, Python caches and the rules files left out) |
| R3 | Leave existing test files unchanged | no test file that existed at the base is modified or deleted |
| R4 | Commit with a sign-off (`git commit -s`) | at least one new commit, every new commit signed off, nothing tracked left uncommitted |
| R5 | Search the notes tool before the first edit | the first notes search comes before the first edit (cache writes do not count) |
| R6 | Read the whole staged diff before committing | a full `git diff --staged` or `--cached` after the last edit and before the last commit |

R5 and R6 are not applicable with no edit or no commit. A missing or undecodable input is unscorable with a code, never folded into not met.

**How the grader reads git:** through a clean copy of the repository's git data with no repository config, attributes, hooks or signature display, and with no API keys in its environment, so nothing the agent left in `.git` can run code during grading. A repository whose git data it cannot read that way is unscorable with its own code: no `.git` (REPO_NOT_GIT), a `.git` file pointing elsewhere (REPO_LINKED_WORKTREE), reftable refs (REPO_REFTABLE) or sha256 objects (REPO_SHA256).

**Known limits:** line-ending attributes and `core.autocrlf` are ignored, so in a repository that relied on them committed work could read as uncommitted for R4; none of the 36 tasks relies on them. R6 does not recognise `git commit -p`, `--patch` or `--interactive` as staging, commands behind `env` or `sudo -u`, or abbreviated long options such as `git add --dry`.

**Delivery, per rule:** whole in the first model request, partial, fetched later by a file read, or absent; unscorable without a readable capture.

## Calls (preregistered)

- **Primary: rules followed**, a trial's share of applicable rules met. Contrast per setup: each size rung minus short, paired by task, 95% task-clustered bootstrap range, cluster sign-flip p (exact up to 20 tasks; above that, 10,000 Monte Carlo sign flips, which covers every 36-task comparison).
- **Size ladder, per setup, a fixed sequence** largest rung first (160, 80, 28, then 8 KB). A step shows a drop when the difference is below 0 and the two-sided sign-flip p is at or below the final O'Brien-Fleming level (two-sided 0.0480). The sequence stops at the first step with no measured drop; the **drop size** is the smallest rung that showed one. Setups are separate decisions.
- **Safe size, per setup:** the largest rung such that it and every smaller rung keep the lower end of their range above minus the planned effect (10 points).
- **Split, hook and cut lifted, per setup:** each against the 160 KB arm, Holm-corrected over the ones the setup runs, each Holm-adjusted p against the same final level; and against the 8 KB arm, reported without a decision.
- **Reported with ranges, deciding nothing:** the ladder pooled over the Opus setups and Codex (four Opus setups in this run; Codex and QM join by their amendments); rules followed by position (top, middle, end) and by rule; delivery per rule; rules followed when delivered whole; input tokens and dollars per trial against none; task solved (hidden tests) against short.

### Smallest detectable difference, stated in advance

36 tasks, SD of a task's paired difference 0.22 (the plan's assumption; the pilot measured 0.05 to 0.19 per Opus and Sol setup and 0.20 pooled, so 0.22 is conservative), two-sided 5%, 80% power: **10.3 points per setup and rung, about the same (10.3) with the interim look.** Pooled over the four Opus setups that run before the amendments, about 5.1 points if setups vary independently (a floor: tasks are shared, so the real figure is larger). By position per setup, about 19 points (SD 0.4 assumed for two-rule positions). A result inside these bounds never reads as "no difference"; it reads "a drop smaller than about 10 points cannot be ruled out".

## Interim look

The one look R113 asks for, preregistered here; no other look is taken.

- Look at: 18 of 36 units (tasks rf-01 to rf-18 in every cell)
- Stop bounds: two-look O'Brien-Fleming, z of 2.80 at the look and 1.98 at the end for a ladder step (alpha / k for the repair arms); stop a comparison for futility when its conditional power under the planned 10-point effect is below 10%.

- **When:** after the first half of the task order (rf-01 to rf-18) has run in every cell. No other look.
- **Statistic and bounds:** z = difference / cluster-robust SE, oriented so the planned effect is positive (a drop for ladder steps, a gain for repairs), against two-look O'Brien-Fleming bounds at each test's own alpha: 2.80 at the look and 1.98 at the end for a ladder step (alpha 0.05); for the repair arms, alpha / k of the k the setup runs (Holm's first step).
- **Futility:** stop a comparison when its conditional power under the planned effect (10 points) is below 10%. A ladder step that stops for futility or loss ends the sequence at that step.
- **Too little to judge:** a comparison with fewer than 6 usable pairs, or a cluster-robust SE that is zero or missing, gets no stop of its own at the look, whatever its difference, and doesn't end the ladder's sequence; a ladder step after a larger rung has ended the sequence still stops for futility, as every later step does.
- **Which cells stop:** a cell skips its second half only when every comparison it feeds has stopped. none and short never stop.
- **Reporting:** a comparison that stopped keeps its interim decision, and every output marks a stop for efficacy "stopped early, possibly overstated".

## What the result changes

Per harness, each way the result can come out, and what gstack, gbrain and users do about it:

- **No drop at any size (safe size 160 KB):** gstack: block length is not the constraint on that host, position free; gbrain: the rules-file block is enough there; users: no size advice needed beyond 160 KB.
- **A drop from a rung on, delivery-driven (rules absent):** gstack: keep the block inside the harness's kept region (Codex: first 32 KB; OpenClaw: the head or the tail, never the middle) and as short as the safe size minus a typical user file; gbrain: the hook carries the rule on that host; users: trim to the safe size or raise the harness's limit, and we publish the setting line.
- **A drop with rules delivered whole (model-side):** gstack: only a hook is reliable for gstack's steps there; gbrain: the hook; users: move must-follow rules into a hook, because split does not help.
- **Hook restores, split does not:** gstack: its installer offers the hook route on that host; gbrain: keep the per-turn hook; users: hooks over folder files.
- **Position matters (top beats middle):** gstack: write the block at the top; gbrain: write the rule at the top; users: put must-follow rules first.

## Changes before any counted trial (2026-11-21)

The build landed on main after the pilot and after this file was first written, with review fixes that change grading; no counted trial had run. None of them changes a rule text, a task, a setup, an arm, the plan or the analysis's decision rules. The pilot's numbers above come from the earlier grader and verifier and are not re-graded.

- **Verifier:** three ways to pass a task without fixing it were closed (a shadowing `pytest` module, a hidden pytest config file and a fake test entry point; each scored 1 with no fix on the old verifier). Every task's acceptance was rerun on 3 runs: the reference fix scores 1 and doing nothing, a wrong fix and every tamper check score 0.
- **Grader:** the git hardening and repository codes under [the six rules](#the-six-rules-and-how-each-is-graded); R6 now ends its window at staging, so a `git diff --staged` before `git add` or `git commit -a` no longer counts, and its staging check ignores quoted text, redirections, heredocs, pipes and dry runs; the edit check keeps the index file's timestamps, so a same-second edit is no longer missed.
- **Scoring:** the agent-timeout rule and the model check under [Scoring](#scoring-exclusions-and-infra-classes).
- **Analysis:** the timeout share and the second reading without timed-out trials, as above.

After the second-model review of this file (2026-11-21, before any counted trial), these changes. None of them changes a rule text, a task, a setup, an arm or a lease:

- **Housekeeping calls:** a harness's own utility model, as its settings record names it, no longer stops the collection; it is metered and reported apart ([Scoring](#scoring-exclusions-and-infra-classes)).
- **Timeout with no capture:** scores no rule instead of stopping the collection.
- **Repository fetches:** the collector now detects them, as [Scoring](#scoring-exclusions-and-infra-classes) says.
- **Housekeeping alone never counts:** a scored trial needs at least one captured request to the cell model ([Scoring](#scoring-exclusions-and-infra-classes)).
- **Interim look:** a comparison with fewer than 6 usable pairs or no usable SE gets no stop of its own ([Interim look](#interim-look)).
- **Stage caps:** each half's stage cap falls from $450 to $410, so the two halves together can't pass the $820 run cap.
- **Canary:** step 1 of [Commands](#commands) launches the canary alone and the rest after it has scored a trial.
- **Wording:** the p-value's method (Monte Carlo sign flips above 20 tasks) the pooled detectable difference (5.1 points, not 5.2) and the smallest file (about 0.8 KB, not 2 KB) now match the code and the arithmetic.

## Pilot

121 uncounted trials on 7 setups (3 tasks through every arm on Claude Code, Codex, Hermes and OpenClaw on Opus or Sol; 1 task on the others), at commits 8e2e2555 and f3c7b525, $27.90 paid. Full notes: the lane's `pilot.md` handoff.

Each arm's budget is its share of the $820 cap in proportion to its projected paid cost (pilot cost per trial for each setup and arm, times 36 tasks); its pilot cap is a tenth of that, and the last column is what its pilot actually spent.

| Arm | Cells | Arm budget | Pilot cap | Pilot spent |
|---|---:|---:|---:|---:|
| none | 7 | $54 | $5.40 | $1.86 |
| short | 7 | $61 | $6.10 | $2.09 |
| 8 KB | 7 | $70 | $7.00 | $2.39 |
| 28 KB | 7 | $86 | $8.60 | $2.91 |
| 80 KB | 7 | $122 | $12.20 | $3.97 |
| 160 KB | 7 | $173 | $17.30 | $5.40 |
| split | 5 | $107 | $10.70 | $3.73 |
| hook | 4 | $73 | $7.30 | $2.76 |
| cut lifted | 2 | $74 | $7.40 | $2.79 |

- **Part under test ran:** delivery matched the keyless map in every cell; hook and cut lifted restored all six rules where the file was cut; split files were placed.
- **Tasks can be supplied:** 121 of 121 pilot trials were supplied and scored, with no infra code, none contaminated and none without a capture.
- **Found and fixed before this file:** R6 marked multi-line commit messages unscorable; delivery counted a rule read later from the file as absent; parallel launches filled the controller's disk (wave 2 launches at most 3 shards at a time).
- **Split on Claude Code:** the folder files never loaded, because Opus searched with Bash rather than the Read tool that triggers lazy loading. The split arm reports this as found.

## Deviations from the plan

- **Codex's 9 cells move to a dated amendment on GPT-6.2 Sol** (2026-11-21, before any counted trial): Garry suspended older-generation models in every role we choose ("We should be using frontier models", 2026-11-21), and this file was not yet frozen, so GPT-6.1 Sol no longer runs. No Codex shard is in this file's shard lists, so nothing can launch on GPT-6.1 Sol. The amendment moves `codex-sol` in `design.json` to `openai:gpt-6.2-sol` with that model's pin and prices, pins the newest Codex release that serves it, reruns Codex's keyless delivery map at that release and pilots the arm on GPT-6.2 Sol (R111) before any Codex cell starts; until then Codex has no trials and adds no pairs. The pilot's Codex rows above are GPT-6.1 Sol on Codex 0.170.0.
- **QM's 13 cells move to a dated amendment** (gate H's fallback): QM's rules class runs on the QM runner, which is held behind #497. The amendment, with its own pilot, lands before any QM cell starts; `design.json` keeps the QM setups so their rows join the same analysis; until then a QM setup has no trials and adds no pairs, so the pooled ladder pools the setups that run. The QM amendment will raise the stage and run caps to $900, with Codex's $130 still held.
- **Hermes has no cut-lifted arm** at its 1M context (the plan made it conditional). **No OpenClaw replicates** (gate E): its 28, 80 and 160 KB first requests differ. Codex 80 and 160 KB send byte-identical first requests and both still run, because Sol reads the file itself.
- **Short is about 0.8 KB, not 2 KB:** the three rule sections with a one-line title and no padding, as the gate's build spec defines it.
- **Padding filters,** beyond the plan's keyword filter: English only; lines that tell the agent to ask or wait for a person, or need a tool the task image lacks, drop their unit; HTML comments are dropped (Claude Code strips them). Drops are published in `scripts/rules-at-scale/corpus/DROPS.md`.
- **The live mirror leaves out what collection needs.** The `--replicate-to` copy leaves out each trial's request captures and Harbor run folder, which the collector reads; in the pilot those came to about 2.9 MB per trial on the setups in this run, so about 4.6 GB for 1,584 trials, too big for the drive. If both a shard's VM and the controller are lost mid-shard, that shard's finished trials can't be collected. Mitigation as the fan-out stands: the controller pulls the results tree while the shard runs and again at the end, and keeps the VM (its 13-hour TTL bounds it) when the final pull fails or brings back no results tree; it does not compare checksums of the copy with the VM before destroying it.
- **Paid projection** falls from the plan's range of $1,200 to $1,380 to about $305 for the 44 cells in this run (pilot cost per trial), with Codex's about $65 and QM's about $80 by amendment.

## Scoring, exclusions and infra classes

- **Pairs:** a task with a value in only one arm of a pair drops out of that pair and is counted. A trial with no applicable rule has no value and is counted.
- **Infra:** a trial with a harness failure code gets every rule unscorable and is counted per cell; nothing is retried inside a counted shard. **One exception, the agent timeout** (`agent_timeout`, or `AgentTimeoutError` when the trial has no ledger lines to classify it): running out of time is the agent's behaviour, so a timed-out trial keeps its rule grades, and a rule whose trigger never fired before the timeout is not applicable, never not met (R2 always; R1 when there was no edit; R4 with no commit or with work left uncommitted). Timed-out trials have no solved value, so rule rates and solve rates cover different trials. Each arm reports its timeout share, and every headline rule rate (rules followed per arm, the ladder steps, the repairs and the pooled ladder) is reported a second time without timed-out trials; that second reading decides nothing. (Dated change, 2026-11-21, before any counted trial.)
- **Model check:** every scored trial, timed-out ones included, must have captured requests, and every one must name the cell's model or a housekeeping model that the trial's own harness settings record names (`agent/harness_settings.json`, `housekeeping_model`, written by `scripts/frontier-harbor/frontier_settings.py`; OpenClaw on an Anthropic model ships `claude-haiku-5-5` for its utility calls). Housekeeping calls are metered, reported per setup and arm as their own row of calls and dollars, and never count as the model under test; a trial's dollars include them. At least one captured request must name the cell's model, so a capture of housekeeping calls alone never counts as the model under test. A trial with no captured request to the cell model, or one naming any other model, stops the collection rather than being counted, with one exception: an agent timeout whose capture is missing, or parses cleanly and names only housekeeping models, scores no rule (infra `TIMEOUT_NO_CAPTURE`, counted per arm); a capture that doesn't parse still stops the collection. The model comes from the captured requests, never from the plan. [Amendment 1](#amendment-1-2026-11-22-before-any-counted-trial) adds three collector rules before any counted trial: no answered request to the cell's model, a bound on housekeeping requests, and a capture cut at the size cap.
- **Clean arms:** every trial runs on an Ubicloud VM with no Capy drive and no gstack or gbrain install; the clean-arm preflight records it per shard, and a trial whose tool calls read a gstack or gbrain file is contaminated, left out and counted.
- **Fetching this eval's own files** (this repository or its public copy) over the network counts as contaminated: the collector marks a trial contaminated when a tool call the model made names `garrytan/harness-evals`, `garrytan/g-harness-evals` or `harness-evals.git`.
- **No model judge**, so R78's judge check does not apply.

## Sharding, leases and order

- **Ubicloud, one standard-16 VM per setup and half,** whole cells per shard and no cell split across machines, 4 trials at a time (wall time is not an outcome), UBI_OWNER set to this lane's thread code, UBI_TTL_HOURS 13 with `--timeout-hours 12`, the repository pinned at this preregistration's merge commit.
- **Order:** first half (rf-01 to rf-18 in every cell), canary shard `hermes-opus-h1` first (the dearest per trial), the rest only after the canary has scored at least one trial and copied it off the VM, at most 3 shards launching at once. Then the interim look, then the second half without the stopped cells.
- **Leases:** each half's shard leases are in its shards file, $307 per half and $614 in all, under a $820 cap that also holds Codex's $130 of leases for its amendment and a $76 reserve never planned against. Each half's plan and fan-out also carry a $410 stage cap (`--cap-usd 410`, one dest per half), so the two stage caps together equal the $820 run cap; Codex's leases come with its amendment. A shard that has to be launched again under a fresh lease, of any size, needs a dated amendment first, so leases never pass the $820 run cap; the $410 stage cap leaves $103 above a half's leases, still above a Hermes or OpenClaw shard's $87.50. No tool enforces this rule; the run follows it by hand.

## Money

| Line | Projection | Cap |
|---|---|---|
| Paid trials (1,584 in this run) | about $305 (pilot mean cost per trial per arm x 36) | $820 |
| Ubicloud VMs (12 shards, about 3 hours each) | about $25 | $60 |

## Commands

From a worktree pinned at this preregistration's merge commit:

1. First half: `bun scripts/rules-at-scale/plan.ts plan --design scripts/rules-at-scale/design.json --tasks tasks/repo/rules-fix-v1/dev --run-id rules-at-scale-2026-11 --shards docs/benchmarks/2026-11-19-rules-at-scale/shards-first.json --cap-usd 410 --out <run>/plan-first.json --manifest <run>/fanout-first.json --commit <merge commit> --dest <run>/dest-first` (its plan equals [plan-first.json](plan-first.json)), then the canary alone: `jq '.shards |= map(select(.name == "hermes-opus-h1"))' <run>/fanout-first.json > <run>/fanout-canary.json` and `scripts/rules-at-scale/ubicloud/fanout.sh --manifest <run>/fanout-canary.json --replicate-to <drive folder>`. Launch the rest only after `<run>/dest-first/hermes-opus-h1/results/run/jobs/*/*/result.json` holds at least one trial with a verifier reward (scored, and copied off the VM by the fan-out's mid-run pull): `jq '.shards |= map(select(.name != "hermes-opus-h1"))' <run>/fanout-first.json > <run>/fanout-rest.json`, then `scripts/rules-at-scale/ubicloud/fanout.sh --manifest <run>/fanout-rest.json --parallel 3 --replicate-to <drive folder>`. Both manifests keep the plan's dest, so the $410 stage cap counts the canary's lease with the rest.
2. Collect each first-half shard into its own file, `bun scripts/rules-at-scale/collect.ts --results <run>/dest-first/<shard>/results --tasks tasks/repo/rules-fix-v1/dev --out <run>/collected/<shard>.jsonl`, then concatenate them into `<run>/trials-first.jsonl` and check that it holds one row for each of the 792 planned first-half trials before the look.
3. Look: `bun scripts/rules-at-scale/analyze.ts --trials <run>/trials-first.jsonl --look interim --out <run>/look`.
4. Second half: the same plan command with `--second-half --shards docs/benchmarks/2026-11-19-rules-at-scale/shards-second.json --interim <run>/look/interim.json --out <run>/plan-second.json --manifest <run>/fanout-second.json --dest <run>/dest-second`, then the fan-out on `<run>/fanout-second.json`. Each half has its own dest, so each half's $410 stage cap counts only its own leases.
5. Final: collect each second-half shard the same way, concatenate every shard's file from both halves into `<run>/trials.jsonl`, then `bun scripts/rules-at-scale/analyze.ts --trials <run>/trials.jsonl --interim <run>/look/interim.json --out <results>/analysis`.

## Amendments

### Amendment 1 (2026-11-22, before any counted trial)

Written before any counted trial of this run. The counted run launches from this amendment's last commit, the one that records the second-model check below (it holds every change of the amendment), not from the merge commit (`0ec814534629a1df4f26612a67f64f0a8f3b2571`), and every step of [Commands](#commands) reads "pinned at the amendment's last commit" and passes that commit as `--commit`. It closes four gaps that the final review of this preregistration's pull request (#507) found and listed there as open notes. On 2026-11-21 the coordinating agent ruled that the first three are fixed here, in the collector, before any data, and that the fourth becomes a stated limit plus a completeness check. No cell, task, arm, rule, grader, harness, lease or cap changes.

**The changes**

1. **A trial whose cell model never answered scores no rule** (`scripts/rules-at-scale/collect.ts`). A trial that would be scored (no infra code, or an agent timeout) and passes the model check is now infra `no_model_response`, with every rule unscorable and the trial counted per arm, when no line of the proxy ledger under its meter key shows a request to the cell's model answered (outcome `forwarded`, status below 400, and not a free `count_tokens` request, which the proxy also logs as forwarded). Before, a trial in which every request to the cell's model failed but a housekeeping call succeeded got no infra code, because the shared infra class asks for any answered request, so its repository could be graded as the cell model's work. The model check still runs first for every trial that would be scored (no infra code, or an agent timeout that keeps its grades), so such a trial that sent a wrong model stops the collection whatever its ledger says; a trial with any other infra code, or a timeout scored `TIMEOUT_NO_CAPTURE`, is not model-checked, as before. The collector also now reads the ledger file names that `scripts/merge-shards.ts` writes (`<shard>.proxy-usage.ndjson`) as well as `proxy-usage*.ndjson`; [Commands](#commands) collects each shard's own results folder, where the name is `proxy-usage.ndjson`. Each arm reports its `no_model_response` trials beside its timeout share, since a timed-out trial whose model never answered leaves the timeout count for this code.
2. **Housekeeping requests may not outnumber cell-model requests in a trial** (`collect.ts`). The bound, fixed here before any data: in every scored trial, the captured requests that name a housekeeping model must be no more than the captured requests that name the cell's model. A trial over the bound stops the collection, as a wrong model does. Before, one captured request to the cell's model was enough, and housekeeping requests had no limit, so a loop misrouted to the housekeeping model would have shown only in the housekeeping row. In the pilot's 121 trials no housekeeping request was captured at all (OpenClaw on Opus lists `claude-haiku-5-5` and never called it), so the bound is far from every trial measured so far.
3. **A capture cut at the proxy's size cap stops the collection** (`collect.ts`). When a trial's capture ends in the proxy's `{"truncated": true}` marker (the 256 MB cap), the collection stops, for any trial, infra or not. Before, the marker line was skipped and the model and contamination checks read only the part before the cap, so a wrong model or a gstack read after it went unseen. The pilot's captures average about 2.9 MB.
4. **Completeness check, and a stated limit** (`scripts/rules-at-scale/analyze.ts`). Before, the analysis was labelled "final" whenever an interim record was passed, without checking that every planned row was there. Now every setup with at least one trial must have a row for each of its arms on each task of the design's order, or on the interim half alone for a cell the interim look stopped. Missing rows are listed (`completeness` in `analysis.json` and `missing_rows` in `interim.json`, also printed by the look), and an analysis with any missing row, at the look or at the end, is labelled "incomplete", never "final". A look with any missing row writes its record with status "incomplete", prints every missing row and exits 1, so [Commands](#commands) step 4 does not start; the second half starts only from a look whose status is "complete", or after a dated amendment says how the missing rows are handled. **Limit:** the check knows only the design, so a setup with no trial at all reads as "not run here", as Codex and QM do until their amendments, and a setup lost whole would read the same way. A setup lost whole has no first-half rows, which the first half's 792-row check in [Commands](#commands) step 2 catches; a setup with first-half rows that loses second-half rows has those rows listed as missing. The results step also compares the analysis's `setups_with_rows` with the setups this run launched.

**Tests and replay.** New tests in `tests/rules-at-scale-collect.test.ts` cover each collector change: a trial whose only answered requests are a housekeeping call and a free token count, a timed-out trial with no answered request, an answered request under a provider-prefixed model name, a wrong model with no ledger still stopping the collection, the bound at equal counts and one over, and a cut capture on a scored and on an infra trial. A new test in `tests/rules-at-scale-analyze.test.ts` covers a missing row, a stopped cell with only its interim half, a setup with no trials, a look taken with a row missing (its record says incomplete and the command exits 1), and the per-arm count of `no_model_response` trials. Four existing collector tests now write the ledger lines that every real trial has; their assertions are unchanged, except that the timed-out trial with ledger lines now reads `agent_timeout` (the code such a trial gets) instead of `AgentTimeoutError` (the code for a trial with no ledger lines, which change 1 now scores as `no_model_response`). The pilot's 121 trials, collected shard by shard with the amended collector, give rows byte-identical to the merge commit's collector.

**Re-pin.** [pins.sha256](pins.sha256) is re-hashed over the same 1,346 paths. Three hashes change from the merge commit: `scripts/rules-at-scale/collect.ts`, `scripts/rules-at-scale/analyze.ts` and `scripts/rules-at-scale/README.md`.

**Second-model check.** One second-model reader, GPT-6.2 Sol, read the amendment's first commit (`a0f3c0528c`) as a scoped check of these four changes, as the ruling asked, and returned six blocking findings. Five were fixed in the second commit (`a1f0c8691d`): a free `count_tokens` request counted as an answer from the cell model; the collector missed the ledger file name `scripts/merge-shards.ts` writes; a timed-out trial whose model never answered left the timeout count unreported (each arm now shows its `no_model_response` trials beside its timeout share, which keeps its preregistered meaning, graded timeouts over clean trials); an incomplete look neither said so in its record nor stopped the second half; and the text claimed a 792-row check for the second half, whose count depends on the cells the look stops. The sixth, that the new guards apply only to trials that would be scored, matches the preregistered model check (a timeout whose capture names only housekeeping models stays `TIMEOUT_NO_CAPTURE`), so the code stands and the text now says so. The same reader then read `a1f0c8691d` as an advisory check of those fixes and found them correct, with two wording errors, both corrected in this commit: the launch commit is this amendment's last commit, and the model check covers timeouts that keep their grades. Its one note, that the timeout share counts only timeouts that keep their grades, is stated above. Pilot replay after the fixes: the 121 pilot trials still give rows byte-identical to the merge commit's collector.

### Amendment 2 (2026-11-22, before any counted trial of the five shards it names)

Written before any counted trial of `claude-code-opus-h1`, `openclaw-opus-h1`, `pi-opus-h1`, `pi-particle-h1` and `hermes-particle-h1`. Every first-half shard was launched from run commit `ce51e3b963e57eca7317438414bca5be64d1a0ec`. The canary `hermes-opus-h1` ran all 144 of its trials there (03:41Z to 09:33Z). The rest of the half was launched at 04:12Z. At 04:14Z the machine running the fan-out went to sleep and its controllers stopped, right after the VMs for the three Opus shards came up and before anything was copied to them. On those three VMs no smoke ran, no key arrived, no lease opened and no trial started. The fan-out had reserved leases for both particle shards, but neither was launched. At 09:11Z the canary's controller was reattached with `run-shard.sh --attach` from the same pinned worktree, and it pulled and destroyed its VM as normal. The three idle VMs were torn down the same way at 10:44Z (cleanup done, no results tree, 0 records). They cost about $9.80 of VM time and nothing in model spend.

**The change.** These five shards launch once more, from the same run commit, with fresh leases of the planned sizes: $75, $87.50, $45, $6 and $6, which is $219.50. Two things change about where they go:
- **Their own folder:** `<run>/dest-first-relaunch` instead of `<run>/dest-first`.
- **Their own stage cap:** $322.50, which is the half's $410 stage cap minus the canary's $87.50 lease, the only first-half lease that opened.

The first folder's `leases.jsonl` files keep the five reservations that opened no lease. So the leases the first half opens still add up to the planned $307, inside the $410 stage cap and the $820 run cap.

**What stays the same.** No cell, task, arm, lease size, cap or loaded file changes. This file is not one the run loads, so the run commit stays `ce51e3b9` and every first-half trial runs the same code.

**Commands.** [Commands](#commands) step 2 collects `hermes-opus-h1` from `<run>/dest-first` and the other five shards from `<run>/dest-first-relaunch`, then checks for the same 792 rows. A shard that has to launch a third time needs another dated amendment.

### Amendment 3 (2026-11-22, before any counted trial of `pi-opus-h1`)

`pi-opus-h1`'s Amendment 2 launch started at 10:46Z. It stopped at 10:52Z while copying the repository to its VM, because the disk of the machine running the fan-out filled (`tar: ... Wrote only 6144 of 10240 bytes`). No key reached the VM, no lease opened and no trial started, and its VM was destroyed (cleanup done). That disk has since been cleared.

`pi-opus-h1` now launches a third time. It goes into the same `<run>/dest-first-relaunch` folder, from run commit `ce51e3b9`, under a fresh $45 lease, and only after the shards already copying there have finished their copy step.

That folder's reservations come to $264.50 once the particle shards launch, inside its $322.50 stage cap. The leases the first half opens still add up to $307. Nothing else changes.

### Amendment 4 (2026-11-22, before any counted trial of `pi-opus-h2`)

`pi-opus-h2`, the second-half shard for `pi-opus`, launched at 17:31Z from run commit `ce51e3b9`. At 17:45Z its task preflight, which checks every task's contract before any trial, failed one check on one task: `watch_modified` on rf-28, where the edit watcher must log every file the reference fix changes within 1.5 seconds of `git apply`. The shard stopped there by design. No trial started and no model request was made, so its $45 lease spent nothing, and its VM was destroyed (cleanup done). The same check on rf-28 passed on the other five second-half shards, on all six first-half shards and in the pilot, all from the same commit, so we read it as a timing miss in the preflight's fixed wait, the same edit watcher whose unit test is a known timing flake. Nothing in the task, its contract or the preflight changes.

`pi-opus-h2` launches a second time, from run commit `ce51e3b9`, with the same plan, arms and tasks, under a fresh $45 lease, into its own folder `<run>/dest-second-relaunch` with a $45 stage cap. The second half's leases still add up to $307 inside its $410 cap, because the failed launch spent nothing. If the preflight fails again on that VM, the shard is not launched a third time without another dated amendment.

**Commands.** [Commands](#commands) step 5 collects `pi-opus-h2` from `<run>/dest-second-relaunch` and the other five second-half shards from `<run>/dest-second`.

### Amendment 5 (2026-11-22, before any counted Codex trial)

Codex's nine cells run on GPT-6.2 Sol, as [Deviations from the plan](#deviations-from-the-plan) promised. Written after the six Opus and particle-1 setups finished and before any counted Codex trial. Codex's counted cells launch from this amendment's last commit (the one that records the second-model check below), passed as `--commit`; the six finished setups keep run commit `ce51e3b9`. No task, arm, rule, grader, rung, analysis rule or other setup changes.

**The changes**

1. **Model.** `codex-sol` in `scripts/rules-at-scale/design.json` moves from `openai:gpt-6.1-sol` to `openai:gpt-6.2-sol`. Its prices were already on the run path at `ce51e3b9`: `runner/pricing/prices-2026-11-21.json` and the ledger's own row in `runner/ledger/budget-ledger.ts` ($2 input, $10 output, $0.10 cached input and $2.50 cache writes per million tokens, doubled input and 1.5 times output above 272,000 input tokens).
2. **Model row.** `scripts/frontier-harbor/pin.json`, which another benchmark pins, has no row for GPT-6.2 Sol and is not edited. `scripts/rules-at-scale/pin.json` gains a `models` row for it (1,050,000-token window, 128,000 output tokens, from the model's page read 2026-11-22). `rules_wiring.overlay_frontier_pin`, which already adds this eval's harness versions to the frontier pin in memory, now also adds that row, and `plan.ts` uses the same merged pin for each shard's worst-case call reservation.
3. **Codex release.** Codex moves from 0.170.0 to 0.171.0, npm's latest release on 2026-11-22 (plan decision H: the newest release), with its npm integrity pinned. Its built-in window for GPT-6.2 Sol is unchanged (`max_context_window` 872000 at `rust-v0.171.0`), so the window the frontier path sets still holds.
4. **Defaults that named the old model.** The delivery map's Codex model and `rules_wiring.py plan`'s default Codex model now name GPT-6.2 Sol, and the stand-in test fixture prints Codex 0.171.0.

**Keyless delivery map at 0.171.0** ([map/runs/2026-11-22-codex-sol/](../../../scripts/rules-at-scale/map/runs/2026-11-22-codex-sol/delivery-map.md), all nine arms at rotation 0 and the 80 and 160 KB arms at rotations 1 and 2; no model called, no key used). Codex 0.171.0 delivers exactly as 0.170.0 did: every rule whole up to 28 KB; at 80 and 160 KB only the top pair, in each rotation, with first requests that are byte-identical once the trial's own names, ids and times are replaced (as captured they differ); R3 and R5 absent from the first request in `split`; all six whole in `hook` (one copy) and in `cutlift`. Codex's "Loaded only 32768 of N bytes" warning stays in its own output and never reaches the model.

**Pilot (R111).** 27 uncounted trials on GPT-6.2 Sol, every arm on rf-01 to rf-03, from the commit before this text (`f52b078f`), run id `rules-at-scale-pilot-codex-sol`, $4.78 paid (under a tenth of Codex's $130 of leases). Every request went to `openai:gpt-6.2-sol`; 0 infra codes, 0 contaminated, every trial solved its task. The part under test ran: rules met were 0 of 15 in `none`, 18 of 18 in `short`, 17 of 18 at 8 KB, 18 of 18 at 28 KB, 10 of 17 at 80 KB and 5 of 16 at 160 KB (where the cut drops four rules; in one of the three 80 KB trials Sol fetched the four missing rules itself later), 16 of 18 in `split`, and 18 of 18 in `hook` and `cutlift`. The graders are the same deterministic checks as every other setup, so no model judge needs checking. These rows are not counted.

**How Codex's cells run.** Codex runs all 36 tasks in every cell, in two shards from [shards-codex.json](shards-codex.json): `codex-sol-h1` (rf-01 to rf-18) and `codex-sol-h2` (rf-19 to rf-36), $65 each, the $130 the plan held for Codex, under a $130 stage cap in their own folder `<run>/dest-codex`, `h1` first as the canary. The plan's one look has already been taken. Codex had no pairs at it, so under "Too little to judge" none of its comparisons stopped, and Codex takes no look of its own (R113 asks for one only above $500 paid; Codex's projection is about $60). The run's leases come to $789 with Codex's (each half's $307, $45 for pi-opus-h2's second launch, and $130), inside the $820 run cap.

**Commands.** From a worktree pinned at this amendment's last commit: `bun scripts/rules-at-scale/plan.ts plan --design scripts/rules-at-scale/design.json --tasks tasks/repo/rules-fix-v1/dev --run-id rules-at-scale-2026-11 --shards docs/benchmarks/2026-11-19-rules-at-scale/shards-codex.json --cap-usd 130 --out <run>/plan-codex.json --manifest <run>/fanout-codex.json --commit <amendment commit> --dest <run>/dest-codex`, then the fan-out on `codex-sol-h1` alone and, once it has scored a trial and copied it off the VM, on `codex-sol-h2`. Collect both shards as in [Commands](#commands) step 2, check that they hold one row for each of Codex's 324 planned trials, add them to `<run>/trials.jsonl`, and run step 5's analysis again. A QM amendment, if one lands, adds its rows the same way.

**Re-pin.** [pins.sha256](pins.sha256) is re-hashed, and it now also lists the six files of the new map run and `shards-codex.json` (1,353 paths).

**Second-model check.** One second-model reader, GPT-6.2 Sol, read this amendment's two commits (`f52b078f` and `b0c29d78`) as a scoped check. It confirmed that the plan gives two 162-trial shards with GPT-6.2 Sol in the proxy slot and a $30.08 floor under each $65 lease; that the pilot's receipts show Codex 0.171.0, the 872,000-token window and GPT-6.2 Sol on all 353 metered requests; that the overlay only adds missing model rows, so the six finished setups are unchanged; that the interim record has no Codex pairs and no Codex stops; the pilot tallies, $4.78 on both ledgers, the $789 lease sum, all 1,353 hashes and the keyless tests. It found one blocking error, fixed in this commit: the 80 and 160 KB first requests are byte-identical only after the trial's own names, ids and times are replaced. It also noted, as not blocking, that each Codex trial's settings receipt carries the frontier path's stale top-level `harness_version` 0.165.0 beside the verified `rules.installed_version` (`codex-cli 0.171.0`); the collector does not read the stale field, and reports use the verified one. Two wording notes (which 80 KB pilot trial fetched the rules, and the 324-row check) are also fixed here.

### Amendment 6 (2026-11-22, before any counted trial of `codex-sol-h2`)

`codex-sol-h2` launched at 21:55Z from Amendment 5's run commit `9bf329c6`. At 22:14Z its task preflight failed the same check that stopped `pi-opus-h2` (Amendment 4), this time on rf-26: `watch_modified`, the edit watcher logging every file the reference fix changes within the preflight's fixed 1.5-second wait. No trial started, no model request was made, its $65 lease spent nothing, and its VM was destroyed (cleanup done). rf-26 passed the same check on every other shard that ran it. That makes two such misses in eight second-half launches. The check is a timing miss on a busy VM, not a broken task, and nothing in the task, its contract or the preflight changes before the report; the report lists both misses.

`codex-sol-h2` launches a second time, from `9bf329c6`, with the same plan, under a fresh $65 lease, into its own folder `<run>/dest-codex-relaunch` with a $65 stage cap. The run's leases still come to $789, because the failed launch spent nothing. A third launch would need another dated amendment.

### Amendment 7 (2026-11-23, after the counted trials, before the final analysis)

Written after the counted shards finished and before the final analysis, so it is a change made after the data, stated as one. It changes how one kind of failure is recorded and no scored value. It applies the existing [infra rule](#scoring-exclusions-and-infra-classes) ("a trial with a harness failure code gets every rule unscorable and is counted per cell; nothing is retried") to a case the collector could not see.

**What happened.** In `codex-sol-h2`'s Amendment 6 launch, one of its 162 trials (Codex, `hook`, rf-34) never started. Harbor stopped while building its environment, because the egress blocklist sidecar check failed on that VM (`HE-FRONTIER-004 the egress blocklist sidecar cannot run here`), so no agent ran, no model was called and nothing was spent. Harbor wrote the job's own `config.json` but never the trial's, and `collect.ts` finds trials by the trial's `config.json`, so it gave no row for this trial. Under Amendment 1's completeness check, the analysis would then read "incomplete" for one missing row. The shard exited 123 (one Harbor job failed) after the other 161 trials finished.

**The change** (`scripts/rules-at-scale/collect.ts`, with a test in `tests/rules-at-scale-collect.test.ts`). A Harbor job whose single trial never wrote its `config.json` now gets one row: setup, arm and task from the job's config, every rule unscorable, no delivery, no solved value, no dollars, not contaminated. Its infra code is the first `HE-` code in the job's Harbor log, or `trial_not_started` when the log has none. A job whose config maps to no setup, arm and task stops the collection, as for any trial. Nothing is retried.

**Effect.** Re-collecting every counted shard with the amended collector gives files byte-identical to the earlier collection for all 13 other shards. `codex-sol-h2` gains the one row, with infra `HE-FRONTIER-004`. The final analysis has all 1,656 planned rows and reads "final". The rf-34 task drops out of Codex's `hook` comparisons only, as the pairs rule says.

**Re-pin.** [pins.sha256](pins.sha256) is re-hashed over the same 1,353 paths; one hash changes, `scripts/rules-at-scale/collect.ts`.

**Second-model check.** One second-model reader, GPT-6.2 Sol, read this amendment's commit (`b7c6f63e`) as a scoped check and passed it. Recomputing the analysis with and without the new row changed only the completeness record, no score, range or pair count. The 13 other shards' files and `codex-sol-h2`'s other 161 rows are byte-identical, the failed trial had no ledger lines and no spend, the walk found exactly that job and none in the smoke trees, and all 1,353 hashes verify. It noted that on some other layout a job nested at the walk's depth limit could hide its trial; no tree in this run is laid out that way. One wording note is fixed in this commit.

## Pinned files

[pins.sha256](pins.sha256) (1,346 files, every task's `verifier/tests.tar` and the upstream blob pins included) lists, in `sha256sum` format, the files of the folders that hold the run's tasks, rules, padding, graders, harness wiring, run path and analysis, minus the 48 named below: `tasks/repo/rules-fix-v1/`, `scripts/repo-tasks/rules-fix/`, `scripts/rules-at-scale/`, the frontier Harbor run path under `scripts/frontier-harbor/`, `scripts/ubicloud/`, `scripts/gstack-delivery/probes.ts`, `runner/stats/`, `runner/proxy/`, `runner/ledger/`, `runner/pricing/` and this folder's JSON files. None may change between this file and the report except by a dated amendment before the cells it affects. A few shared files on that path carry internal tracking references that the public copy of this repository rewrites, so a hash of them would not hold there; they are left out of pins.sha256 (48 files under `runner/`, `scripts/frontier-harbor/` and `scripts/ubicloud/`). One of the 48, `scripts/frontier-harbor/answer-keys/NOTICE.md`, is a notice whose link to a private file the public copy removes. Other shared modules the run imports from outside those folders, such as `scripts/gstack-laneb/materialize.ts` and `scripts/repo-tasks/matrix.ts`, are not hashed here either. The counted run still loads all of them unchanged, the 48 included, because it runs from a worktree pinned at this file's merge commit and every shard records that commit.

## Receipts

Under `docs/benchmarks/2026-11-19-rules-at-scale/results/`: per shard its collected trials, ledger, proxy usage, clean-arm preflight, task preflight and shard and VM records; the look's `interim.json`; the analysis JSON and Markdown. Raw request captures stay private. This preregistration merges to main before the first counted trial; results come in one later PR.

## Outside terms

Task source repositories are MIT or BSD-3-Clause, and each task keeps its upstream licence (`tasks/repo/rules-fix-v1/LICENSES/`). The padding is real public rules files under MIT, Apache-2.0 or BSD-3-Clause, pinned by commit with a licence per file (`scripts/rules-at-scale/corpus/NOTICES.md`). Harbor is Apache-2.0. Harnesses run at their pinned releases under their own terms.

## Disclosures

The report and any finding file end with these lines, word for word from the disclosures list.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.
