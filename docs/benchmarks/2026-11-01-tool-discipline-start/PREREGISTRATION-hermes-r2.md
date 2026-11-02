# Start hook on Hermes, rerun: does gstack's start command run once Tirith can read it? Hermes chat, Opus 5.5, three arms

Status: written 2026-11-01 (America/Los_Angeles), before any trial of this run. Run id `tool-discipline-start-hermes-r2-2026-11`. It is a new run id, not an amendment of `tool-discipline-start-2026-11`: that run is reported (#214) and stays as it is. This file sits next to that run's [preregistration](PREREGISTRATION.md), the way gstack-native-pilot files its later runs in one directory. Its results go under `results-hermes-r2/`, its report is `report-hermes-r2.md`, and its entry in [preregistrations.d/tool-discipline-start.json](../preregistrations.d/tool-discipline-start.json) makes runner/prereg/prereg.ts check that this file was committed before any of them.

**In one line: in #214, Hermes blocked gstack's start command because its Tirith scanner could not read the command's preamble. gstack#3825 (v1.92.57.0) makes the preamble a plain fence that Tirith allows. This rerun repeats #214's Hermes cells with only the candidate's gstack moved to that release, and Tirith pinned.**

- 3 arms × 1 harness (Hermes chat) × 3 tasks × 8 trials = **72 trials**. Model `claude-opus-5-5`.
- **Cap $19.00. Expected spend about $10.74.** The cap sits above the expected spend only because the cap check holds back one full lease ($6.56) before every trial ("Cost and stop rule").
- **The only arm that changes is the candidate:** gstack `e2d9c798b2a69cd7870513f1d280d757a4e527de` (v1.92.57.0, gstack main) instead of `b9fda18c`. The none and baseline arms are #214's.
- **Dev only.** The three tasks are public (GSTA-135). Nothing here touches a held-out set.
- The verdict is computed by [scripts/tool-discipline/panel-score-r2.ts](../../../scripts/tool-discipline/panel-score-r2.ts), sha256 `85a79c525e5c2185de1518257041def1c49442f59684da67e21173c70d7de5c8`. It imports `score` and `markdown` from [panel-score.ts](../../../scripts/tool-discipline/panel-score.ts) unchanged (sha256 `260be68e277b63635ab1a7bbefef40844630fccb0b1585567277657c739bd85a`, the file #205 preregistered), which imports from [scripts/gsta-135/report.ts](../../../scripts/gsta-135/report.ts) (sha256 `eed0d5cfab85af48605c354e9a7b88664c23a01bdfdd43cd5b8ef451bbf0693b`). It adds no threshold; it only accepts this run's manifest instead of #214's. Tested keylessly in [tests/tool-discipline-r2.test.ts](../../../tests/tool-discipline-r2.test.ts).
- No trial starts until this preregistration is merged to main (CREW.md: preregistration and results never share a pull request).

## Why this run

- **#214's Hermes verdict was fail, with a named cause.** The candidate opened gstack-review and issued `gstack-skill-start` in 8 of 8 task-1 trials. Hermes's Tirith scan flagged the start preamble as a HIGH "nested executable body", and the preregistered approval config (manual, timeout 1) turned the card into a deny ([report](report.md#why-null)).
- **Its Why-null verdict was FIX-METHOD:** gstack must emit a start command Tirith resolves, the Hermes image must pin Tirith instead of downloading the latest per trial, and the Hermes cells rerun under a new run id. This run does those three things and nothing else.
- **gstack#3825 is the gstack half.** Merged as `e2d9c798b2a6` (v1.92.57.0, GST-882): "plain skill-start fence that Tirith can resolve, so Hermes can start gstack skills".
- **#221 is the image half.** It pins Tirith 0.4.2 in harnesses/hermes/Dockerfile and pin.json ("Tirith 0.4.2, pinned as in #221", below).

## Approval

- The Captain approved this rerun under R40 as the fix of #214's diagnosed FIX-METHOD, with a lane cap of $12.
- The $12 cap could not finish the run: the cap check keeps one $6.56 lease free before every trial, so a $12 cap stops the run once $5.44 has settled. Replaying #214's own 72 Hermes trial costs in panel order, it stops before `gsta135-hermes-t1-candidate-6` after 47 trials, and the cells read incomplete. The Captain then approved a **$19 cap** (2026-11-01), with #214's budgets and max_tokens unchanged.

## Scope: what stays as in #214

- **Hermes chat cells only.** OpenClaw passed in #214 and does not rerun.
- **Same tasks** (GSTA-135 panel: 1, review the uncommitted change, matching skill `gstack-review`; 2, the test suite fails, `gstack-investigate` or `gstack-qa`; 3, write a poem, the control).
- **Same three arms, same model, same trials:** none, baseline, candidate; `claude-opus-5-5`; 8 trials per cell.
- **Same approval config:** `approvals.mode: manual`, `timeout: 1`, appended in every arm by [harnesses/hermes/gstack/adapter.sh:71-73](../../../harnesses/hermes/gstack/adapter.sh). discovery.sh reads the line and records it in the manifest; each trial's gstack-register.log carries the `approval:` line.
- **Same budgets:** max_tokens 128000, $1.00 per trial, R_max $5.561305, lease $6.561305 per trial, the 600 s and 120 s time budgets, and #214's ceilings file ([inputs/ceilings.json](inputs/ceilings.json)).
- **Same harness and overlay:** Hermes Agent v2026.9.24 under the GSTA-135 overlay. Nothing a Hermes trial loads has changed on main since #214's tree `ccad864b5`: `git diff --stat ccad864b5 origin/main -- harnesses/hermes harnesses/_gstack harnesses/run-trial.sh harnesses/openclaw scripts/gsta-135 runner/proxy runner/ledger runner/trial scripts/tool-discipline/panel-score.ts` is empty at `a97a4957d`.

## What changes

| | none | baseline | candidate |
|---|---|---|---|
| gstack | not installed (as #214) | `482ffd1440ab13d105bfd3e571be3d7a0a7bb99a` (v1.92.14.0, as #214) | **`e2d9c798b2a69cd7870513f1d280d757a4e527de` (v1.92.57.0)**, was `b9fda18c` |
| start hook | n/a | not present | on (`GSTACK_HARNESS_START_HOOK=1` at setup, as #214) |
| Hermes image (chat) | `harness-eval/hermes:gstack-none-chat` | `harness-eval/hermes:gstack-482ffd14-chat` | `harness-eval/hermes:gstack-e2d9c798-hook-chat` |

- **How the candidate was chosen.** The brief asked for a pinned gstack main commit at or after v1.92.57.0 that contains `e2d9c798b2a6`. On 2026-11-02 at 05:10Z, gstack `origin/main` is `e2d9c798b2a69cd7870513f1d280d757a4e527de` itself, VERSION `1.92.57.0`, the merge of gstack#3825. `git merge-base --is-ancestor e2d9c798b2a6 origin/main` passes, so the pin is that commit. A later main head is not used: the pin is fixed here.
- **It contains the baseline and the hook.** `git merge-base --is-ancestor 482ffd14 e2d9c798` passes (discovery.sh refuses a candidate that does not contain the baseline), and so does `git merge-base --is-ancestor b15492a1 e2d9c798` (#3786's merge, the start hook).
- **The candidate is no longer the baseline plus one change.** In #214 the candidate was the baseline plus #3786 alone. Here it is v1.92.14.0 to v1.92.57.0: #3786's hook, #3825's fence and every main commit between. So a difference against baseline is "gstack main with the hook and the new fence" against "gstack 1.92.14.0 with neither". The arms are kept as #214's so the only change from #214 is the candidate's gstack version.
- **The baseline still carries the old preamble.** gstack `482ffd14` renders the grouped fallback block (`[ -d "${GSTACK_ROOT:-/-}/bin" ]&&...||{ GSTACK_ROOT="/opt/gstack"; ...;}`), and the pinned Tirith blocks it ("Keyless checks before this PR"). Baseline never issued the start command in #214 (0 of 16), so this is expected to matter little there, but a baseline start would be blocked as in #214.
- **Tirith is pinned in every arm.** The change sits in the base image `harness-eval/hermes:dev`, which all three overlay images build from.
- **The cap is $19** and **only Hermes is dispatched** (`--only` with the 72 Hermes trial ids, below).

## Tirith 0.4.2, pinned as in #221

- **The pin:** Tirith 0.4.2 from https://github.com/sheeki03/tirith/releases/tag/v0.4.2, the archive checked against a per-architecture sha256 (x86_64 `efa6bf414a83dba385d4f13137e8677f850ced9102fe74ebb14c72f31df0dc77`, aarch64 `c550b1bfb0c8c872ab3421cd6ef756f260f7cf4981a18cedd49f141fa2d77569`), unpacked to `/opt/tirith/bin`, with `TIRITH_BIN=/opt/tirith/bin/tirith` and `TIRITH_OFFLINE=1` in the image environment. Hermes treats an explicit TIRITH_BIN as authoritative and never downloads a scanner; TIRITH_OFFLINE=1 stops Tirith's own threat-DB download.
- **Which form applies.** #221 is open, not merged, at head `9f9410b95cf029b76ebd26bf77c36ad43acdd10b` when this is written.
  - **If the run commit (this preregistration's merge commit) does not contain #221**, the pin goes in as a **declared runtime image patch**: [inputs/hermes-r2/tirith-0.4.2-from-221.patch](inputs/hermes-r2/tirith-0.4.2-from-221.patch), sha256 `ef588a8422e876c44165525e01c5655b6e633fbba4c94800a7342565ef041d7f`, which is exactly #221's hunks of harnesses/hermes/Dockerfile and harnesses/hermes/pin.json (`git diff c6e64b9de 9f9410b95 -- harnesses/hermes/Dockerfile harnesses/hermes/pin.json`, where `c6e64b9de` is #221's merge base with main). On the run machine it is applied to a copy of `harnesses/` outside the pinned worktree, `harness-eval/hermes:dev` is built from that copy, and the overlay images are built from the pinned worktree on top of it. The worktree stays clean, so `tree_dirty` stays false.
  - **If the run commit contains #221**, the images build from the worktree as is, and no patch is applied. #221 also changes the counted Hermes adapter for instruction routes; that is then a declared difference from #214, listed in the report.
  - **In the patch form,** pin.json's `tirith.receipt` field names `hermes-security.json`, which #221's adapter changes write and the patch does not carry. This run's Tirith receipts are instead the clean-arm preflight's Tirith check on all three images and the audit's per-trial download count ("Clean arms").
  - Which form applied is decided by `grep -q '^ARG TIRITH_VERSION=0.4.2' harnesses/hermes/Dockerfile` in the pinned worktree. **The run log will confirm it**: the form, the patch's sha256 when used, and `tirith --version`, TIRITH_BIN and TIRITH_OFFLINE (presence only) inside `harness-eval/hermes:dev`.

## Decision rule

The endpoints, guards and verdict below are copied word for word from #214's [preregistration](PREREGISTRATION.md#endpoints), and panel-score-r2.ts computes them with panel-score.ts's own code. No threshold is new. "Per harness" now means Hermes alone.

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
- R44 (task success and cost, none against baseline and against candidate), starts among trials that opened the skill, and attempts with an unattributable exit, as panel-score.ts prints them. Descriptive only, as in #214.
- Descriptive, beside #214: the candidate's starts here against #214's 0 of 16, and its cost per trial against #214's Hermes candidate ($0.0915 median).

## Clean arms

CREW.md "Clean no-gstack and no-brain arms" asks that no run agent can reach a gstack it was not given. How each part is met and checked:

- **Per-trial containers, no Capy drive.** Every trial runs in its own `docker run --rm` container ([harnesses/run-trial.sh](../../../harnesses/run-trial.sh)) that binds only three directories under the trial's own output directory (`/workspace`, `/harness-state`, `/he-logs`). No Capy drive, ~/.local/share/gstack or ~/.claude/skills of the run machine is mounted. In the gstack images, gstack exists only at `/opt/gstack`; the per-trial registration writes into the trial's own `/harness-state`.
- **Per-arm preflight, before trial 1:** [scripts/tool-discipline/clean-arm-preflight.sh](../../../scripts/tool-discipline/clean-arm-preflight.sh) (sha256 `6d1f738676ddd07243cc90a41356c5be4408c3067d87bcaf0c6d6eeadf5a05fa`), once per arm image, appending to `results/gsta-135/preflight/clean-arms.jsonl`. It reads run-trial.sh's bind list, then runs the image with its own environment, no network and no key, and checks:
  - **none arm:** no `/opt/gstack`; no SKILL.md anywhere in the image, symlinks followed, whose path, link target or content mentions gstack; no user-level gstack install and no `.capy` directory; `GSTACK_CAPY` unset (printed only as set or unset); label `org.harness-eval.gstack.commit=none`.
  - **baseline and candidate:** `/opt/gstack` at the arm's SHA (HEAD and label); no gstack SKILL.md outside `/opt/gstack`, symlinks followed; no user-level install or `.capy` directory; `GSTACK_CAPY` unset.
  - **all three arms, Tirith:** run as the trial's uid (the uid run-trial.sh passes, not root), `$TIRITH_BIN --version` must print `tirith 0.4.2` and TIRITH_OFFLINE must be set (presence only), so no arm can fall back to downloading a scanner.
  - **Any failure stops the run before trial 1.** In every arm the wrapper also unsets GSTACK_CAPY per trial and logs `GSTACK_CAPY=unset` on the `marker:` line of each trial's gstack-register.log (existing, as #214).
- **Per-arm audit, after the last trial:** [scripts/tool-discipline/clean-arm-audit.ts](../../../scripts/tool-discipline/clean-arm-audit.ts) (sha256 `cd7b690368c02665e8fe285abfdf246d00cb484402aff768655ebc503e8bde96`) over the run directory. Per dispatched Hermes trial it counts reads of a gstack SKILL.md or skill file in three places:
  - **tool calls:** evidence.ts's events on the trial's cells.jsonl row (a gstack skill opened by `skill_view` or `read_file`, or a call naming a gstack skill file);
  - **transcripts:** every assistant tool call in the trial's Hermes state.db (`skill_view`/`skills_read` of a gstack skill, or arguments naming a gstack SKILL.md, a skills/gstack directory, `/opt/gstack/` or the Capy drive's gstack skill);
  - **requests:** the system prompts Hermes sent, from state.db's `system_prompts` and `sessions.system_prompt`; a gstack skill listed there is counted as exposure.
  - **Tirith downloads:** the lines `tirith installed to` in each trial's `state/hermes/logs/agent.log` and its rotated copies (`agent.log.1` and so on), the line Hermes writes when it downloads a scanner instead of using TIRITH_BIN (the line #214's tirith-download.json counted). Any download, in any arm, is reported as an unpinned trial beside the verdict; a trial with no agent.log reads unknown, and the audit then exits 1.
  - It also counts any `.capy/drive` path. The audit reads a copy of state.db with its -wal and -shm files. A none arm with a trial whose state.db is missing, empty, unreadable or holds no messages, or holds a tool call it cannot decode, and no contamination, reads **unaudited**, never clean; a none arm with no dispatched trial reads **absent**. **The none arm is reported as contaminated** if any of its trials read a gstack skill file, had one listed in its system prompt, or named a Capy drive path. The gstack arms' counts are printed as descriptive. The audit does not change the verdict; a contaminated none arm is reported beside it, and its success guard and R44 lines are marked as such.
- **Prefer existing scripts:** the audit's tool-call source is evidence.ts's output, unchanged. The two new scripts and panel-score-r2.ts are the only code in this pull request; it changes no runner, harness, task or grader file.

## Keyless checks before this PR

Images built on a Capy cloud machine at `a97a4957d` (origin/main) with the Tirith patch applied as described. The clean-arm preflight and the fence check below were re-run on those images with the scripts at `ec7e7ef1b` (this pull request's head after the review fixes; neither script changed after it). No key in any process (`env -i PATH HOME`), every model request to the repository's fake endpoint:

- **Images built:** `harness-eval/hermes:dev` (patched), `gstack-none-chat`, `gstack-482ffd14-chat`, `gstack-e2d9c798-hook-chat`. Inside dev: `tirith 0.4.2` at /opt/tirith/bin, TIRITH_BIN and TIRITH_OFFLINE set.
- **Clean-arm preflight:** pass for all three images, Tirith included (`tirith 0.4.2`, TIRITH_OFFLINE set, as uid 1001). As a negative, the baseline image checked as the none arm fails (74 gstack SKILL.md files, /opt/gstack present, label not none).
- **The fence, under the pinned Tirith** ([scripts/tool-discipline/tirith-fence-check.sh](../../../scripts/tool-discipline/tirith-fence-check.sh), sha256 `98180d347a5ff0fc940abaacb3d57a2404ca37ab59dbd4a83110637099bfd165`): the gstack-review start fence gstack renders for Hermes, checked with `tirith check --format json --non-interactive --shell posix`:
  - baseline `482ffd14`: **block** (patterns "dynamic shell wrapper body" and "nested shell execution coverage gap"), fence sha256 `3e2e8b06f1a3...`;
  - candidate `e2d9c798`: **allow**, no findings, fence sha256 `62244783ca98...`: `[ -x "/opt/gstack/bin/gstack-skill-start" ]||echo "gstack: no install found ..." >&2` then `"/opt/gstack/bin/gstack-skill-start" --skill "review" --model "claude" --brain-health`.
- **Runtime preflight** (scripts/gsta-135/preflight.sh, Hermes chat): `--pin e2d9c798 --start-hook` ok, 59 checks, `start_hook: on active`, `first_turn_note=yes`; `--pin 482ffd14` ok, 59 checks, start_hook off.
- These are not the run's receipts. The run repeats every check on its own machine from the pinned worktree, below.

## Where it runs

- **One Capy cloud machine, in Docker containers, sequentially**, as #214. **Not sharded:** #214's 72 Hermes trials took 31 to 39 s median each, so the run is about 45 minutes plus about 20 minutes of builds and preflights, well under 4 hours. That is a declared deviation from CREW.md "Shards run on Ubicloud", as in #214.
- **From a worktree pinned at this preregistration's merge commit on main**, never moved, with every image built from it (the Tirith base image from the patched copy, when the patch applies). The manifest records the tree, and every row records `tree_dirty` false.
- **Steps, in order, each logged to run.log:**
  1. `git worktree add <dir> <merge commit>`; a gstack clone holding both SHAs (`--gstack-dir`), checked with `git merge-base --is-ancestor`.
  2. The Tirith form (above), and `harness-eval/hermes:dev` built from the patched copy or the worktree.
  3. Overlay images, per the headers of harnesses/hermes/gstack/Dockerfile and harnesses/openclaw/gstack/Dockerfile: the three Hermes chat images in the table, plus `harness-eval/openclaw:dev`, `openclaw:gstack-none`, `openclaw:gstack-482ffd14` and `openclaw:gstack-e2d9c798-hook`. discovery.sh refuses a panel with any image missing, so the OpenClaw images are built though no OpenClaw trial is dispatched.
  4. Runtime preflight, Hermes only: `bash scripts/gsta-135/preflight.sh --pin 482ffd14 --only hermes --hermes-mode chat --max-tokens 128000` and `... --pin e2d9c798 ... --start-hook`, each followed by `cp -r results/gsta-135/preflight results/gsta-135/preflight-<pin>`, as #214.
  5. Clean-arm preflight for the three Hermes images, and the Tirith fence check for baseline and candidate. **No trial starts if a clean-arm check fails or the candidate's fence is not allowed.** Baseline's block is recorded, not a stop.
  6. The run: `bash scripts/gsta-135/discovery.sh --arms none,baseline:482ffd1440ab13d105bfd3e571be3d7a0a7bb99a,candidate:e2d9c798b2a69cd7870513f1d280d757a4e527de --start-hook candidate --gstack-dir <gstack clone> --run-id tool-discipline-start-hermes-r2-2026-11 --trials 8 --hermes-mode chat --max-tokens 128000 --per-trial-usd 1.00 --panel-cap-usd 19 --ceilings docs/benchmarks/2026-11-01-tool-discipline-start/inputs/ceilings.json --runtime-preflight results/gsta-135/preflight/runtime-preflight.json --only <the 72 Hermes trial ids>`.
     - The id list is `bun scripts/gsta-135/lease.ts order --trials 8 --arms none,baseline,candidate | jq -r '[.[] | select(.harness == "hermes") | .trial_id] | join(",")'`. discovery.sh still plans all 144 rows and writes the 72 OpenClaw rows as `not_run:not_selected` without a lease; panel-score-r2.ts drops them and refuses any OpenClaw row that ran.
  7. After the last trial: `bun scripts/tool-discipline/panel-score-r2.ts results/gsta-135/runs/tool-discipline-start-hermes-r2-2026-11/cells.jsonl --manifest results/gsta-135/runs/tool-discipline-start-hermes-r2-2026-11/manifest.json` (verdict.md and verdict.json) and `bun scripts/tool-discipline/clean-arm-audit.ts results/gsta-135/runs/tool-discipline-start-hermes-r2-2026-11` (clean-arm-audit.md and .json).

## Cost and stop rule

- **One ledger, one lease per trial, under the cap.** discovery.sh opens one metering proxy and one lease per trial (`<run id>.<trial id>`) in one ledger for the run, and checks the cap before every lease.
- **Lease per trial $6.561305:** the $1.00 per-trial bar plus R_max $5.561305 at max_tokens 128000 (`bun scripts/gsta-135/lease.ts r-max --model claude-opus-5-5 --max-tokens 128000 --per-trial-usd 1.00`), as #214.
- **Expected spend, from #214's Hermes cells** (ledger.sqlite and cells.jsonl agree: 72 leases, $8.262188):
  - #214 Hermes by arm: none $2.71, baseline $2.72, candidate $2.83.
  - #214's Hermes candidate was blocked at the start command, so its cost leaves out the work after a start. The estimate adds what a start cost on OpenClaw in #214, per trial over baseline: task 1 $0.3935 − $0.1579 = +$0.236; task 2 $0.2513 − $0.1398 = +$0.112.
  - Hermes candidate, estimated: task 1 ($0.2303 + $0.236) × 8 = $3.73; task 2 ($0.0783 + $0.112) × 8 = $1.52; task 3 $0.06 as in #214. Total $5.31, which is $2.48 above #214's $2.83.
  - **Expected total: $8.26 + $2.48 = $10.74.** With a 15% margin: $12.35.
- **Why the cap is $19, above the expected spend.** Before each lease, settled spend + open reservations + one full lease must fit the cap, else the remaining trials are `not_run:panel_cap` and the run stops. A run expected to settle $12.35 at most therefore needs a cap of at least $12.35 + $6.56 = $18.91, so **$19**. At $19 the run stops only after more than $12.44 has settled; the expected $10.74 leaves $1.70 of room. Replayed through this check, #214's own Hermes costs never stop at $19 (they stop after 47 of 72 trials at $12). The cap bounds what can be spent; it is not the estimate.
- **Stop rule:** discovery.sh's cap check before every lease, as #214. A 402 after a forwarded request ends that trial as `ceiling:lease`. No trial is replaced or retried to change a verdict.
- The spend is recorded in the Captain's drive ledger notes and the report.

## Limits

- **The candidate moved by 43 first-parent commits on gstack main (v1.92.14.0 to v1.92.57.0), not one change.** A pass or fail is about gstack main at v1.92.57.0 with the hook, against v1.92.14.0 without it and against no gstack. It does not isolate #3825 from the other commits.
- **The baseline still carries the old preamble**, which the pinned Tirith blocks. Baseline starts (0 of 16 in #214) cannot run here either.
- **Same chat-mode approval config as #214** (manual, 1 s): any command Tirith or Hermes's own detector flags is denied after 1 s, in every arm. That is neither Hermes's counted one-shot entry nor its stock interactive settings.
- **Three public tasks, 8 trials per cell, one-turn tasks.** Task success was 16 of 16 in every Hermes arm in #214, so the success guards can catch a drop but cannot show a gain.
- **The candidate arm can see that it is the candidate** (`GSTACK_HARNESS_START_HOOK=1` in its shell), and the none arm's shell shows gstack-named state, as #214 says.
- **Hermes's session-title call** (harness housekeeping, shipped default) never carries the note. It is metered and not scored.

## Receipts

Copied whole into `results-hermes-r2/` of this directory by the results PR: manifest.json and manifest.sha256, cells.jsonl, ledger.sqlite, proxy-usage.ndjson, proxy.log, evidence/, trials/<id>/logs/, each trial's `state/hermes/logs/agent.log` (the Tirith download check), run.log (with the Tirith form and the patch sha256), images.txt, runtime-preflight.json and the Hermes preflight logs per pin, clean-arms.jsonl, tirith-fence.jsonl, clean-arm-audit.md and .json, report.md (scripts/gsta-135/report.ts), verdict.md and verdict.json (panel-score-r2.ts). The report is `report-hermes-r2.md`, and it ends with the R55 disclosure lines for gstack and Hermes.

## Amendments

None.
