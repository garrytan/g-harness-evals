# Start hook: does a per-turn note make agents run gstack's start command? OpenClaw and Hermes, Opus 5.5, three arms

Status: written 2026-11-01 (America/Los_Angeles), before any trial of this run. Run id `tool-discipline-start-2026-11`. The directory is dated 2026-11-01, the planned run date.

**In one line: gstack's skills tell the agent to run a start command first, and agents almost never do (1 in 29 chances). gstack built an opt-in hook that puts a one-line reminder on every turn. This run tests whether the reminder gets the command run, what it costs, and whether answers get worse, against gstack without the hook and against no gstack at all.**

- 3 arms × 2 harnesses × 3 tasks × 8 trials = **144 trials**. Model `claude-opus-5-5`. **Hard cap $28.00.** Planning ceiling $21.15; expected spend about $14.
- **The candidate is #3786's head before merge.** gstack `b9fda18c6ac232de2b5a99ac3e6893955c55d7c0` is the last commit of [garrytan/gstack#3786](https://github.com/garrytan/gstack/pull/3786) (GST-718). It merged to gstack main as `b15492a148e2744d24b0ca4da5ba290fb109c340` (v1.92.23.0). **That release has the same hook code but not the same tree.** Every file #3786 changes in code (`lib/harness-start-hook.ts`, `lib/harness-register.ts`, `bin/gstack-harness`, `bin/gstack-config`, `bin/gstack-harness-ledger.sh`, `test/harness-start-hook.test.ts`) is byte-identical, and #3786's lines in `setup` are identical. But `b15492a1` also carries 8 later main commits (v1.92.15.0 to v1.92.22.0, 119 files, including `setup`). The run pins `b9fda18c` so that baseline and candidate differ by #3786 alone. Results name `b9fda18c` as "#3786 head, pre-merge". Its hook code ships unchanged in v1.92.23.0.
- **Dev only.** The three tasks are public (HARN-5 wrote them for GSTA-135). Nothing here touches a held-out set, and no result is a held-out claim.
- The verdict is computed by [scripts/tool-discipline/panel-score.ts](../../../scripts/tool-discipline/panel-score.ts), sha256 `260be68e277b63635ab1a7bbefef40844630fccb0b1585567277657c739bd85a`, with the helpers it imports from [scripts/gsta-135/report.ts](../../../scripts/gsta-135/report.ts) (`cells`, `eligible`, `wilson`), sha256 `eed0d5cfab85af48605c354e9a7b88664c23a01bdfdd43cd5b8ef451bbf0693b`. It is tested keylessly by [tests/tool-discipline-panel-score.test.ts](../../../tests/tool-discipline-panel-score.test.ts) (one test per verdict, plus the refusals).
- verdict.md is computed in the worktree pinned at this preregistration's merge commit: `bun scripts/tool-discipline/panel-score.ts results/gsta-135/runs/tool-discipline-start-2026-11/cells.jsonl --manifest results/gsta-135/runs/tool-discipline-start-2026-11/manifest.json` (discovery.sh's run directory). The scorer refuses to run without the manifest's planned order, so a trial that never wrote a line still counts as absent. It also refuses a manifest that does not match the manifest.sha256 written before trial 1 or that is a dry run's, a manifest that is not this run's panel (arms none, `482ffd14` and `b9fda18c` with start_hook off, off and on, `start_hook.arm` candidate; model `claude-opus-5-5`, Hermes chat mode, max_tokens 128000, $1.00 per trial, cap $28, a clean tree, and 8 planned trials in each of the 18 harness, task and arm cells) or that names an upstream other than `default` (a fake or overridden upstream is never a counted run), a plan missing any (task, arm) cell of the three-arm panel, and a cells.jsonl with a repeated trial or a trial the plan does not list.
- No trial starts until this preregistration is merged to main (CREW.md: preregistration and results never share a pull request).

## Why this run

- **gstack's skills begin with a start command** (`gstack-skill-start` in each skill's Preamble). It sets up the session: unattended mode, questions, consent, upgrade checks.
- **Agents read the skill and skip that command.** In GSTA-135's three Opus 5.5 runs (132 trials), the agent read a gstack skill and then skipped the start command in 28 of 29 chances (OpenClaw 20 of 21, Hermes 8 of 8). The one start was piped through `head -40`, so its exit code was lost ([docs/tool-discipline/README.md](../../tool-discipline/README.md)).
- **Where text enters matters more than what it says.** HARN-15's route run measured a per-turn hook followed in 97 to 100% of turns and a listed skill in 1 to 3% ([its report](../2026-10-31-anatomy-instruction-route/report.md)). The same run saw OpenClaw's gbrain hook cut pass by 32 points, so a hook is not free.
- **The decision this run informs:** whether gstack should ship the start hook on by default for OpenClaw and Hermes (GSTA-36). The no-gstack arm says whether gstack, started or not, helps the answers at all on these tasks (R44).

## Approval

- HARN-18's tool-discipline plan, autoplan run `harn18-20261030172137`. Garry answered "Do it" at gate 1 (rec_hash `439605d3a7e0`, decisions d1, d2, d4, d5, d6, d7) and "Do it" at gate 2, recorded at gate rev 4 with the d1b override (rec_hash `6293404a8eb1`; the no-gstack arm runs the same overlay harness as the gstack arms). The Captain set the $28 cap.
- Decision 5 (the paid gate) opened on the free report (Captain drive, `handoffs/HARN-18/free-report.md`): skipped starts dominate, the outcome is task success and cost, and the decision is GSTA-36's default for the hook. The Captain confirmed the narrower question: "does a hook make the start happen, at what cost, with no success drop".
- The Captain (HARN-1, 2026-11-01) sent the candidate: "Run the panel against that exact SHA. Install it from the commit itself, and refuse to start if the installed tree's HEAD is not b9fda18c. This is Garry's own repo, so the pre-merge build is allowed here. Your harness-evals prereg must still be merged before any trial, and it must name this SHA and label the build as pre-release. Keep the no-gstack arm as approved, and stay inside the $28 cap."
- The round-2 review items (coverage-aware verdict, first-parent baseline, opportunity states, Hermes task-2 bar, starts versus outcome) are fixed here; this PR carries them through full review voices.

## Question

On GSTA-135's three panel tasks, with `claude-opus-5-5` at max_tokens 128000, on OpenClaw 2026.10.6 (run entry) and Hermes Agent v2026.9.24 in chat mode under the GSTA-135 overlay, at 8 trials per cell:

1. When gstack's start hook is on, in how many trials on tasks 1 and 2 does the agent run the matching skill's start command with an observed exit code of 0?
2. Is that more than gstack without the hook?
3. Does the hook cost task success, against gstack without the hook and against no gstack?
4. Descriptively: what do the hook and gstack cost per trial, and how often does the agent open a gstack skill on the control task?

## Design

| | none | baseline | candidate |
|---|---|---|---|
| gstack | not installed | `482ffd1440ab13d105bfd3e571be3d7a0a7bb99a` (v1.92.14.0, gstack main) | `b9fda18c6ac232de2b5a99ac3e6893955c55d7c0` (#3786 head, pre-merge; hook code as in v1.92.23.0) |
| start hook | n/a | not present | **on** (`GSTACK_HARNESS_START_HOOK=1` at setup) |
| OpenClaw image | `harness-eval/openclaw:gstack-none` | `harness-eval/openclaw:gstack-482ffd14` | `harness-eval/openclaw:gstack-b9fda18c-hook` |
| Hermes image (chat) | `harness-eval/hermes:gstack-none-chat` | `harness-eval/hermes:gstack-482ffd14-chat` | `harness-eval/hermes:gstack-b9fda18c-hook-chat` |

- **Baseline is the candidate's first parent.** #3786 is 9 commits, no merges, on top of `482ffd14`, a gstack main commit. So baseline and candidate differ only by #3786. Baseline is not "main today": main has moved past `482ffd14` and discovery.sh refuses a candidate that does not contain the baseline. Both SHAs are on GitHub (checked with `git ls-remote` and `git merge-base --is-ancestor` before the manifest is written).
- **The hook is the only difference between baseline and candidate apart from #3786's code.** The candidate image is built with `GSTACK_START_HOOK=on`, label `org.harness-eval.gstack.start_hook=on`; the baseline and none images carry `off`. discovery.sh refuses a panel whose labels say otherwise.
- **The no-gstack arm runs the same harness** (gate 2, A2): the overlay image built with `GSTACK_COMMIT=none`, the same wrapper, the same chat-mode turn block and the same Hermes approval config, with no gstack checkout and no registration. Its trials get the plain task prompt.
- **Tasks** (GSTA-135 panel): 1, review the uncommitted change (matching skill `gstack-review`); 2, the test suite fails (`gstack-investigate` or `gstack-qa`); 3, write a poem (control: no gstack skill fits).
- **Order:** discovery.sh panel mode, `--arms none,baseline:<sha>,candidate:<sha>`, in lease.ts's fixed interleaved order (trial index, task, harness, arm). One metering proxy and one ledger lease per trial. The manifest, with its sha256, is written once before trial 1 and never rewritten; it is this run's machine-readable preregistration record.
- **Runtime preflight, written on the run machine before trial 1.** The images are built on the run machine from the pinned worktree, so their runtime preflight cannot be committed here; it replaces the committed file round-2 plan step 6 asked for. Before trial 1, `bash scripts/gsta-135/preflight.sh --pin 482ffd14 --only openclaw,hermes --hermes-mode chat --max-tokens 128000` and `bash scripts/gsta-135/preflight.sh --pin b9fda18c --only openclaw,hermes --hermes-mode chat --max-tokens 128000 --start-hook` write `results/gsta-135/preflight/runtime-preflight.json`. Each run truncates the previous run's logs under that directory, so after each command `cp -r results/gsta-135/preflight results/gsta-135/preflight-<pin>` keeps its logs (`runtime-preflight.json` merges across runs). discovery.sh copies it into manifest.json (`runtime_preflight`), which is sealed before trial 1. The none images have no runtime preflight and are recorded `not_run`, which still dispatches. An image marked `fail` runs no trials: they are `infra:runtime`, absent, so its cells read incomplete.
- **The run command,** from the same worktree: `bash scripts/gsta-135/discovery.sh --arms none,baseline:482ffd1440ab13d105bfd3e571be3d7a0a7bb99a,candidate:b9fda18c6ac232de2b5a99ac3e6893955c55d7c0 --start-hook candidate --gstack-dir <a gstack clone> --run-id tool-discipline-start-2026-11 --trials 8 --hermes-mode chat --max-tokens 128000 --per-trial-usd 1.00 --panel-cap-usd 28 --ceilings docs/benchmarks/2026-11-01-tool-discipline-start/inputs/ceilings.json --runtime-preflight results/gsta-135/preflight/runtime-preflight.json`. It is the dry run's command without `--dry-run`, with this run id and the committed ceilings file. `--start-hook candidate` is part of the design: without it discovery.sh would look for candidate images with no hook.
- **Where it runs:** one fresh Capy machine, sequentially, from a worktree pinned at this preregistration's merge commit on main, with every image built from that worktree. The GSTA-135 panels ran the same way. scripts/ubicloud runs runner shards, not discovery.sh, and the run is not sharded (about 1.5 hours sequential), so this is a declared deviation from CREW.md "Shards run on Ubicloud".

## Fixed now: how the hook is installed and checked

- **From the commit itself.** The overlay Dockerfile fetches gstack by SHA and fails the build unless `git rev-parse HEAD` equals that SHA. At trial start the wrapper checks again: if the installed tree's HEAD is not the image's `GSTACK_IMAGE_COMMIT`, the trial stops with exit 2 before any model request (a harness error, an absence in every numerator).
- **Hook on, checked per trial.** In the candidate image the wrapper exports `GSTACK_HARNESS_START_HOOK=1` before gstack's own `./setup --host <harness>`, so gstack-harness writes and enables the plugin itself. In baseline it exports `0` (482ffd14 has no hook). After setup the wrapper requires `gstack-harness status` to show the hook active and logs `start_hook: on active` in each trial's `gstack-register.log`.
- **Exit 4 is infrastructure.** If setup exits 4 (skills registered, hook not active) or status does not show the hook active, the trial stops with exit 2 before any model request. It is an absence, never a score.
- **Configs are seeded first in every arm.** The overlay copies the harness's own config (OpenClaw `openclaw.json`, Hermes `config.yaml`) before gstack's setup runs, in all three arms, so the hook's activation edits the harness config rather than creating a bare one. Without the seed, the activation creates a bare config with no harness settings on both harnesses: Hermes a default config.yaml with no model, provider or terminal settings, OpenClaw only `plugins` and `meta`. With the seed, the final configs keep every template setting plus the hook entries (Hermes `plugins.enabled: [gstack-start]` beside the approvals block; OpenClaw `plugins.entries.gstack-start` with `hooks.allowConversationAccess` and `enabled`). Hermes user plugins need no shell-hooks allowlist.
- **OpenClaw's run entry.** The exec turn (`openclaw agent exec --state-dir $OPENCLAW_STATE_DIR/exec`) loads the plugin registered under `$OPENCLAW_STATE_DIR`, and its first request carries the note. `harness-eval/openclaw:dev` sets `OPENCLAW_CONFIG_PATH` to `$OPENCLAW_STATE_DIR/openclaw.json`, the profile's own file, and gstack at `b9fda18c` turns the hook off whenever that variable is set (setup exits 0 with `start hook: off`). So in the candidate image the wrapper checks that the variable names the profile's own file and runs setup without it. That is a declared overlay step, reported to GSTA-36.
- **Keyless smoke before this PR** (fake Anthropic upstream, no key): on `b9fda18c` with the hook on, the note is in the first agent-turn request the harness sends (OpenClaw: the exec turn's only request; Hermes chat: request 2, after Hermes's session-title call, which the hook does not reach); with the hook off on the same SHA, no request carries it, and the requests are otherwise equal. The none arm's first agent-turn request equals the baseline's once gstack's skill entries are removed (OpenClaw 6, Hermes 64), and Hermes none runs in chat mode. A checkout moved off the pinned SHA, or an image naming another commit, stops with exit 2 and no model request. Preflight: OpenClaw 43 checks and Hermes chat 59 pass for the candidate (GSTA-135's 37 and 53 plus 3 hook and 3 pin checks). Evidence: Captain drive `handoffs/HARN-18/smoke/`.

## Endpoints

Eligibility is GSTA-135's (scripts/gsta-135/report.ts `eligible`): a trial counts only when it ran, its termination is not `infra:*` or `not_run:*`, its transcript is complete and it did not stop for length. Every other planned trial is **absent**. Absent trials stay in every denominator.

### Primary, per harness

- **Candidate starts on tasks 1 and 2 pooled (n = 16):** trials where the matching skill's start command ran with its own exit code observed as 0 (evidence.ts, GSTA-135's rule: a pipe or `; echo` that hides the exit makes it "ambiguous", not a start).
- **Bar: at least 5 of 16.** Wilson 95% lower bound 0.14 at 5 of 16. Power, assuming the baseline stays near 0: 0.55 at a true 30% start rate, 0.83 at 40%, 0.995 at 60%.
- **Worst case:** an absent candidate trial is a non-start.
- Also printed: candidate minus baseline starts with a Newcombe 95% interval, and per-task counts for every arm.

### Guards, per harness, each on its worst case

- **Control:** the candidate opens a gstack skill on task 3 in at most 1 of 8. Every planned task-3 trial that is not an eligible trial with no open counts as an open.
- **Task success, against baseline and against none:** candidate success on tasks 1 and 2 (absent = failure) is not below the other arm's (absent = success). Below, with the Newcombe 95% interval for the difference entirely under 0: **fail**. Below otherwise: **inconclusive** (a drop not shown either way).

### Verdict, per harness (panel-score.ts, in this order)

1. **incomplete:** any cell (harness, task, arm) has more than 2 of its 8 trials absent.
2. **fail:** candidate starts under 5 of 16, or the control guard is broken, or a success guard fails.
3. **inconclusive:** baseline starts reach 5 of 16 too (best case: absent = start), or a success guard is inconclusive.
4. **pass:** otherwise.

### Secondary, descriptive

- **Hermes task 2:** candidate starts, bar at least 2 of 8, printed. Every earlier arm opened 0 of 5 skills on Hermes task 2, so the pooled primary could pass on task 1 alone; a Hermes claim names the tasks that moved.
- **R44:** task success, none against baseline and none against candidate, each difference with its Newcombe 95% interval, and median cost per trial for each arm with its 95% order-statistic interval (none under 6 trials), over the trials that sent at least one model request. Cost per trial is `usd_spent` plus `usd_charged_reservation`; trials with an unresolved reservation (`usd_reserved_unknown` above 0) are counted beside the median, printed beside the hook result.
- **Starts are compliance, not value.** A start says the agent followed the instruction. Any claim that gstack or the hook helps comes only from task success and cost. At 16 trials per arm the smallest success drop the guard can call a fail is 4 of 16 (0.25) from 16 of 16, and the panel prints it; anything smaller is "not shown either way". GSTA-135's tasks 1 and 2 were 5 of 5 in every gstack cell, so success is near its ceiling and a gain cannot show.
- Starts among trials that opened the skill, attempts with an unattributable exit, invented tools (`skills_read` on OpenClaw), and cost per trial by arm. Per arm, the tool-discipline classifier's rates over this run's evidence (scripts/tool-discipline/classify.ts labels): invented tools, bad arguments, wrong names and broken helper calls, each with its Wilson interval. A kind the evidence cannot see is left out, not reported as zero. Today normalize.ts reads only the three GSTA-135 runs and rates.ts pools arms, so the results PR adds this run and an arm-keeping grouping, without changing a label rule; these rates never enter the verdict. GSTA-135's 3-of-5 bars are reprinted by scripts/gsta-135/report.ts for continuity, as a separate table.
- A start receipt from gstack's own state, if the trial's `GSTACK_STATE_ROOT` keeps one under `GSTACK_EPHEMERAL=1`; otherwise "no receipt".

## Cost and stop rule

- **Lease per trial $6.5613:** the $1.00 per-trial bar plus R_max $5.5613 at max_tokens 128000 (GSTA-135's lease).
- **Planning ceiling $21.15:** the two gstack arms, 8 trials × 2 arms × $1.1734 (the sum of GSTA-135's per-cell ceilings, discovery run, copied into run 3610's manifest) = $18.77; the none arm, 8 × $0.2969 (that run's no-gstack costs) = $2.37. $21.15 plus one lease is $27.71, under the cap. The hook adds about 50 tokens per request, which these ceilings do not include.
- **Stop rule:** discovery.sh's cap check before every lease (settled + open reservations + one lease must fit in $28.00, else the remaining trials are `not_run:panel_cap` and the run stops). No trial is replaced or retried to change a verdict.
- **Dry run** (three arms, these SHAs, keyless): 144 rows, lease $6.561305 per trial, cap $28, Hermes chat, max_tokens 128000, start_hook none=off, baseline=off, candidate=on (Captain drive `handoffs/HARN-18/smoke/dry-run/`). The paid run passes the same ceilings file, committed here as [inputs/ceilings.json](inputs/ceilings.json) (GSTA-135's preflight ceilings, from HARN-5).

## Limits

- **Pre-merge candidate.** This run measures `b9fda18c` only. v1.92.23.0 (`b15492a1`) has the same hook code on a newer main, so a result carries to it only as far as the 8 intervening main commits leave skill starts alone.
- **Three public tasks, 8 trials per cell.** A pass says the hook moves starts on these tasks on these harnesses; it is not a general rate.
- **One-turn tasks.** Each trial has one user turn, so the hook's note lands once per request. Long sessions pay more (HARN-15's gbrain hook added 63k to 138k input tokens per multi-turn trial).
- **Hermes runs in chat mode under the overlay,** not Hermes's counted one-shot entry. Its session-title call (harness housekeeping, shipped default) never carries the note; it is metered and not scored.
- **The candidate arm can see that it is the candidate.** The agent's shell shows `GSTACK_HARNESS_START_HOOK=1` (0 in the other arms), and inside Hermes's terminal `gstack-harness status` reports the hook as `written` because `hermes` is not on that shell's PATH. The wrapper's own check, outside the agent, says active.
- **The none arm's shell also shows gstack-named state.** The overlay image sets `GSTACK_DIR=/opt/gstack` (absent) and `GSTACK_IMAGE_COMMIT=none`, and the wrapper exports `GSTACK_HARNESS_START_HOOK=0`, `GSTACK_SESSION_KIND`, `GSTACK_EPHEMERAL` and `GSTACK_STATE_ROOT` in every arm. No gstack checkout, skill or registration is present.
- **Task success is near ceiling,** so the guards can catch a drop but cannot show a gain.

## Receipts

Copied whole into `results/` of this directory by the results PR: manifest.json and manifest.sha256, cells.jsonl, ledger.sqlite, proxy-usage.ndjson, proxy.log, evidence/, the panel log, runtime-preflight.json and the preflight logs, report.md (scripts/gsta-135/report.ts) and verdict.md (the panel-score.ts command above). Each trial's gstack-register.log shows the HEAD check and the start_hook line.

## Amendments

None.
