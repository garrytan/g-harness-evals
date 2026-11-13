# Amendments: gstack skill ablation (gstack-skill-ablation-2026-11)

The preregistration is [PREREGISTRATION.md](PREREGISTRATION.md). It is not edited after its merge (cf65aaf6, #354), so its hash in the preregistration ledger keeps matching. Each amendment below is a dated commit on the results branch `harn62/results`, cut from cf65aaf6, pushed before any cell it affects. Amendments reach main with the results pull request (R77).

## Amendment 1 (2026-11-11): the Claude Code gstack arm crashed Harbor's end-of-trial scrub; a one-line runner fix, and how launch 1's records count

**Approved by** the Captain (internal-task) on 2026-11-11 (pending at commit time; recorded in the results PR). **Committed** before any stage 0 trial except the 10 below. Every stage 0 shard launches from this commit.

### 1. What happened

- **Launch 1:** the canary shard `opus-full` (stage 0, 42 trials) launched from cf65aaf6 on one Ubicloud standard-16 VM. The keyless install check passed, then Harbor started 10 trials and ended both jobs in 5 minutes with exit 1.
- **Cause:** gstack's setup links the router's files (`skills/gstack/*`) to its checkout by absolute path (`/root/.local/share/gstack/...`). Harbor copies `~/.claude/skills` into the trial's session dir, which is bind-mounted on the VM host. At the end of a trial, Harbor's scrub of the jobs dir calls `stat` on each of those links, gets `EACCES` on the host's `/root`, raises `PermissionError` and cancels the job's other trials.
- **Known, but fixed for the wrong arms only:** #361 added a post-run step that deletes every link under `/logs/agent/sessions/skills` from inside the container (`drop_skill_links_command`). It ran only for gstack release arms, not for this run's skill ablation arms.
- **Why the install check missed it:** its agents step accepted a `vm-run.sh` exit of 1 (`gstack-check.json`: `vm_run_exit: 1`, `pass: true`). Reported to the merge lane's owner; not changed here.
- **Records (kept unedited in [results/stage0-launch1/opus-full/](results/stage0-launch1/opus-full/)):**
  - 6 `harness_error` with `CancelledError` and no verifier reward (filter-js-from-html, chess-best-move, train-fasttext; attempts 1 and 2).
  - 2 `infra_error` `unfinished` (schemelike-metacircular-eval, attempts 1 and 2).
  - 2 `harness_error` with `AgentSafetyRefusalError` and reward 0 (protein-assembly, attempts 1 and 2): the model refused, and the verifier graded the trial.
- **Spend:** $0.71 on the proxy, all under the shard's lease. VM: about 6 hours at list price, because the controller machine slept from 13:25Z to 19:01Z and the VM waited for it; destroyed at 19:05Z.

### 2. The fix

- `frontier_settings.drops_skill_links`: a Claude Code run ends with the link drop for a release arm, or for an ablation arm whose built manifest has a layout (one that installed skills). The none arm installs nothing, so it is unchanged. Codex and Hermes keep their skills outside `/logs`, so they are unchanged.
- `agents.py` calls it in place of the release-only test. Tested in `tests/canary-gstack.test.ts`.
- The dropped count is recorded per trial as `install_checks.skill_links_dropped`, as for release arms. Opens are read from the captured request bodies, which the drop does not touch.
- No task, preamble, grader, pin, lock or arm file changes. `scripts/frontier-harbor/pin.json` and every file in this folder are byte-identical to cf65aaf6, apart from this file and `results/`.

### 3. How launch 1's records count (mechanical)

- **Excluded as a runner fault:** every launch 1 record with no verifier reward, the 8 trials listed in [results/stage0-launch1-runner-fault.json](results/stage0-launch1-runner-fault.json). They are counted and reported, never scored.
- **Kept as recorded:** the 2 protein-assembly refusals. The verifier ran, and a refusal is the model's outcome, scored as the preregistration scores `harness_error`.
- **Rerun once:** the 8 run again with their ids unchanged under `rerun1` (`vm-run.sh --rerun`), after the shard's main stage, because a rerun needs every planned trial of the shard recorded first. `merge-stages.ts --exclude` with that list takes the rerun record. A rerun that faults again is not rerun.
- **Stage 0 readings before the rerun:** the stage 0 amendment's open rates and headroom use the stage 0 records that have a verifier reward. For Opus full that is 34 of 42 trials (4 tasks have no stage 0 full trial until the rerun). The stage 0 amendment states the denominators.
- **The rest of stage 0:** `opus-full` relaunches with launch 1's `trials.jsonl` as `--done`, so its other 32 stage 0 trials run once and its lease counts the $0.71. Then `opus-none`, `sol-none` and `sol-full`.

### 4. Launch logistics

- **TTL:** `run-shard.sh` refuses a VM TTL that is not longer than `--timeout-hours` (default 12). Every shard keeps the preregistered 12-hour TTL and runs with `--timeout-hours 11`. A first attempt with both at 12 was refused before any VM was created.
- **Fan-out destination:** launch 1 went to its own destination, so its lease reservation does not count against the relaunch's stage cap. Every stage 0 shard from this commit goes to one new destination with `stage_cap_usd` 521, the sum of the four planned leases.

## Amendment 2 (2026-11-12): stage 0 readings, a fix to the open detector made after stage 0, and the minus and diet arms

**Approved by** the Captain (internal-task) on 2026-11-12, with two conditions written into sections 2 and 3. **Committed** after every stage 0 trial and before any main-stage trial. Every main-stage cell, the none and full cells of [prereg-harbor.json](prereg-harbor.json) and the new cells of [prereg-harbor-arms.json](prereg-harbor-arms.json), launches from this commit.

### 1. Stage 0 as it ran

- **Records (kept unedited under [results/stage0/](results/stage0/), one folder per shard, beside launch 1's in [results/stage0-launch1/](results/stage0-launch1/)):** opus-full 32 from this relaunch plus launch 1's 10, opus-none 42, sol-none 40, sol-full 40. All ran from 01978f7e (amendment 1).
- **Scored readings input:** [results/stage0/readings-input.jsonl](results/stage0/readings-input.jsonl) holds those lines byte for byte, less the runner faults: launch 1's 8 (amendment 1) and 1 more, below. That leaves 155: opus-full 34 of 42 (4 tasks have no stage 0 full trial until rerun1), opus-none 41, sol-none 40, sol-full 40.
- **One more runner fault:** the controller machine's disk filled, every results pull from the VMs failed, and at 2026-11-12T00:51:58Z the lane stopped the opus-none shard (SIGTERM) while train-fasttext attempt 2 was 59 minutes in. That record is `harness_error` with no verifier reward. It is listed in [results/stage0-run3-runner-fault.json](results/stage0-run3-runner-fault.json), counted and reported, never scored, and not rerun: with it scored as a fail or left out, Opus's headroom reading is the same (64.3%, 9 informative tasks), because attempt 1 of that task timed out.
- **Record repair on the VM (no record edited):** vm-run.sh's own conversion then failed on files the task container owned (EACCES). On the live VM the two leftover containers were removed, the job folder's owner was set back to the run user, and the same `to-trials.ts convert` command ran again from the same checkout. It wrote the 42 records. The VM was then pulled and destroyed.
- **Spend:** $64.63 on the proxy (launch 1 $0.71, opus-full $17.16, opus-none $22.55, sol-none $10.72, sol-full $13.49), every dollar under its shard's lease. VMs about $11 at list price.
- **Headroom ([results/stage0/headroom.md](results/stage0/headroom.md)):** both frontier models pass. Opus 5.5 (Claude Code) none 64.3% [45.2%, 83.3%], 9 informative tasks. GPT-6.1 Sol (Codex) none 67.5% [50.0%, 82.5%], 10. No capture was truncated.

### 2. The open detector missed every Sol open; fixed after stage 0

- **Plainly: this fix was made after stage 0's data was seen.** The selection rule, the threshold and the records are unchanged; the instrument that counts opens changed.
- **What the records say:** zero opens of any skill in all 74 scored full-arm trials, which would give no minus arm and a 53-skill diet that includes verify.
- **What the transcripts say:** Opus made no Skill call and read no skill file in any session (checked in the session logs as well as the captures), so its zero is real. Sol read `/root/.agents/skills/gstack-verify/SKILL.md` in 17 of its 40 full-arm trials, and the file's body came back each time.
- **Cause:** Codex 0.165.0 runs shell commands through its code-mode `exec` tool. The model writes a script that calls `exec_command` and prints each result as one JSON line it shapes itself, such as `{"i":0,"status":"fulfilled","value":{"output":"---\nname: verify ..."}}` or `{"i":0,"result":{"value":{...}}}`. The body's newlines are escaped inside that JSON, so `gstack-exposure.ts` never saw the frontmatter it checks for and counted no open.
- **Fix:** `returnedText` in `scripts/frontier-harbor/gstack-exposure.ts` also reads every `output` string inside a tool result's JSON lines. A new test in `tests/frontier-harbor-exposure.test.ts` builds both result shapes from stage 0 plus a failed read: it fails before the fix and passes after. The same fix goes to main as its own bug-fix pull request, because other runs use this file.
- **Re-measured, not re-recorded:** `ablation.ts opens` runs the fixed detector over each full-arm record's unchanged capture and lock and writes [results/stage0/opens.json](results/stage0/opens.json): per trial, the recorded opens beside the re-measured ones. Sol: verify in 17 of 40. Opus: none in 32 (launch 1's 2 schemelike trials have no capture and are listed under no_capture; they are runner faults). Nothing else changed. `ablation.ts select --opens` uses that file in place of the records' opens; the trials.jsonl files stay as recorded.
- **Main-stage records** are written by the fixed converter, so their opens need no re-measure.

### 3. Arm selection (mechanical, from the re-measured opens)

- **Minus arms ([results/stage0/selection.md](results/stage0/selection.md)):** one skill is eligible, verify: excludable, fit yes, open rate 42.5% on Sol (17 of 40), 0% on Opus. The threshold is 40%, so verify clears it by one trial. No other skill was opened by either model, so there is one minus arm, `minus-verify` (`full,-skill:verify`, spec_sha256 `a9fd211d...`), not three.
- **Diet:** the 52 excludable skills no stage 0 full trial opened, 24,893 listing bytes on Claude Code plus Codex, spec_sha256 `c6dbd187...`. gstack rendered it on both hosts with no put-back.
- **Sensitivity line (required by the Captain's approval):** the selection the recorded zeros give, no minus arm and a 53-skill diet that includes verify (spec_sha256 `ab021fbd...`), is kept as [results/stage0/selection-recorded-zeros.md](results/stage0/selection-recorded-zeros.md). The results report states it as a labelled sensitivity line, so a reader can see what the fix changed.
- **Locks:** `gstack-arm.ts locks` renders the two arms at the gstack pin on each host in the same builder as `singles` and writes `locks/<host>/minus-verify.lock.json` and `locks/<host>/diet.lock.json` for claude and codex. Both minus-verify locks are byte-identical to the lock skills.json recorded for verify's single removal at freeze (lock_sha256 matches).

### 4. The new cells and shards

- **[prereg-harbor-arms.json](prereg-harbor-arms.json)**, same run id, holds `opus-minus-verify`, `opus-diet`, `sol-minus-verify` and `sol-diet`: the model, harness, subset and settings of each model's full cell, 8 attempts per subset task, stage `main`. 656 trials.
- **Leases:** $157 for each Opus cell and $66 for each Sol cell, at the per-trial rate of the preregistered full-cell leases. $446 in all, inside the $899 the preregistration leaves for these shards under the $1,600 cap. Each is above its floor.
- **Main-stage leases of none and full:** what each preregistered shard lease has left after stage 0: opus-none $147.45, opus-full $178.13, sol-none $61.28, sol-full $69.51.

### 5. Launch logistics

- **Canary first:** `opus-diet` launches alone. The other 7 shards launch after it has finished at least one scored trial and copied it off its VM.
- **Two controllers:** stage 0 filled the controller's 65 GB disk with four shards, and main-stage shards bring back about four times as much. So the shards are split over two controller machines, each one with its own destination, leases and VM map: opus-diet, opus-none, opus-full and sol-none on the first; opus-minus-verify, sol-minus-verify, sol-diet and sol-full on the second. No cell is split across VMs, and every VM still runs from this commit.
- **Rerun1:** launch 1's 8 runner-fault trials run after the opus-full main stage, as amendment 1 says.
- **What Opus's zero means for the readings:** Opus opened no gstack skill in stage 0, so its minus-verify and diet comparisons measure what removing skills from the listing does, not what using them does. The report takes that into the Why null? cycle.

## Amendment 3 (2026-11-12): sol-diet's lease, its rerun, and two launch notes

**Approved by** the Captain (internal-task) on 2026-11-12. **Committed** while the main stage was running from c75d2307, before any rerun it names. The running cells are untouched.

### 1. sol-diet's lease is raised and its refused trials rerun

- **What happened:** GPT-6.1 Sol in the diet arm costs about $0.71 a trial in the main stage, roughly twice its full arm (about $0.35) and its minus-verify arm (about $0.32). At 10:07Z the cell had spent $41.86 on 59 of its 160 trials. The $66 lease ends at about trial 93, and the proxy then refuses every later call, so those trials are recorded as `lease_refused`.
- **The doubled cost is a result,** not a deviation. The report states it as a finding of the diet arm and looks for its cause.
- **Lease:** sol-diet's planned lease in [prereg-harbor-arms.json](prereg-harbor-arms.json) goes from $66 to $135: the projected $113 plus about 20%. The four arm shards then lease $515, inside the $899 left for them under the $1,600 cap.
- **Rerun (mechanical):** after the shard ends, every sol-diet main-stage trial recorded as `lease_refused`, and any trial the lease cut mid-call, runs once more under its own trial id as stage `rerun1` (`vm-run.sh --rerun`, with the shard's main-stage records as `--done`), from this commit, with the lease left under $135. The list is written to `results/main-sol-diet-lease-refused.json` in amendment 1's `{rule, trial_ids}` form, and `merge-stages.ts --exclude` with that list takes the rerun record. A rerun that is refused or faults again is not rerun again.

### 2. Launch notes (no trial affected)

- **Stage 0 records as --done:** the first main-stage launch of opus-none, opus-full, sol-none and sol-full did not pass each shard's stage 0 records as `--done`, and vm-run refused it after the smoke (HE-FRONTIER-005) with no trial run and no model spend. They were relaunched to new destinations with those records (launch 1's as well for opus-full), with each lease at its planned amount less the recorded stage 0 USD: opus-none $147.44, opus-full $178.13, sol-none $61.28, sol-full $69.51.
- **Attestation on the second controller:** its first launch of the three arm shards was refused at attestation (HE-FRONTIER-006), because its fresh clone held no local `harn62/results` branch, so the amendment commit did not show as on origin. Fixed by tracking the branch; the pinned worktree did not move. No trial ran.
- **VM cost of the refused launches:** about $3.64 at list price.

### 3. Deviation: count_tokens is not on the proxy allowlist

- Claude Code sends `POST /v1/messages/count_tokens` on some long-context turns. The metering proxy does not allowlist that route and answers 403; Claude Code carries on without the count. In opus-diet that was 8 calls by 09:00Z, on make-mips-interpreter, schemelike-metacircular-eval and install-windows-3.11.
- The route stays off the allowlist for this run, because changing it mid-run would treat the Claude arms differently. It hits every Claude Code arm the same way, and the report counts the 403s per arm.

## Amendment 4 (2026-11-12): lease-refused trials rerun, and sol-diet's lease

**Approved by** the Captain (internal-task) on 2026-11-12. **Committed** before any rerun1 trial. It replaces amendment 3's $135 for sol-diet and widens its rerun rule to every main-stage cell.

### 1. What happened in sol-diet

- The shard ended at 12:50Z with 160 records: 78 completed, 4 `harness_error` (the model refused model-extraction-relu-logits, attempts 2 to 5) and 78 `model_error` with infra_class `lease_refused`. 28 of the 78 had recorded spend before the refusal, so the lease cut them partway through; the rest were refused at their first call.
- The records are kept unedited in [results/main/sol-diet/trials.jsonl](results/main/sol-diet/trials.jsonl). Proxy spend $64.60 of the $66 lease.
- **Cause:** before it forwards a call, the metering proxy reserves the call's input tokens plus the 128k output cap at list price. The first refusal came at 08:14:35Z, 22 minutes in: a video-processing call needed a $31.67 reservation that the trials already open had left no room for. After that the large-context tasks (video-processing, sam-cell-seg, filter-js-from-html among them) kept being refused, until spend reached $64.60 and every reservation failed.
- **Correction to amendment 3:** its $0.71 a trial divided by trials finished, refused ones included, so it is withdrawn. The diet arm's cost per trial is measured on completed records in the analysis.

### 2. The rerun rule (mechanical)

- **Trigger:** a main-stage trial reruns if and only if the proxy recorded it as `lease_refused` (infra_class `lease_refused`), including one cut partway through. A trial's outcome never triggers a rerun: the 4 model refusals stay `harness_error`, scored as the preregistration scores them.
- **How:** each listed trial runs once more under its own trial id, as stage `rerun1` (`vm-run.sh --rerun <list> --done <the shard's main-stage trials.jsonl>`), from this commit. `merge-stages.ts --exclude <list> --rerun ...` takes the rerun record, as amendment 1 does. A rerun that is refused or faults again is not rerun again.
- **sol-diet:** its 78 trials are in [results/main-sol-diet-lease-refused.json](results/main-sol-diet-lease-refused.json). Its planned lease in [prereg-harbor-arms.json](prereg-harbor-arms.json) goes from $66 (amendment 3's $135 never ran) to $210, so its rerun1 lease is $145.40: about $65 for the trials at the completed-trial rate, plus room for four large reservations at once.
- **Any other cell with lease_refused trials:** its planned lease becomes its recorded spend, plus 1.2 times the refused count times the cell's mean recorded USD per completed main-stage trial, plus $130 of reservation headroom. Its list is written in the same form, and `plan.ts show` must report every lease inside the $1,600 cap before its rerun launches.
- **Reporting:** the results give the lease_refused count per cell, before and after the rerun.

### 3. The lesson for later preregistrations

- A lease sized from the mean cost per trial is too small when large-context tasks run in parallel, because the proxy holds a reservation for input plus the full output cap on every open call. Size each lease for the peak of open reservations, not the mean spend.

## Amendment 4 addendum (2026-11-12): four more cells rerun, and the leases fit the $1,600 cap

**Approved by** the Captain (internal-task) on 2026-11-12. **Committed** before any rerun1 trial of the cells it names. It applies amendment 4's rerun rule to the other cells with lease_refused records, and makes the run's planned leases fit its $1,600 cap. No other rule changes.

### 1. Which cells had lease_refused records

When the main stage ended, these cells had main-stage records the proxy marked `lease_refused`. Some were cut partway through (spend recorded before the refusal):

| Cell | lease_refused | cut partway | Rerun list |
|---|---|---|---|
| sol-diet | 78 | 28 | [main-sol-diet-lease-refused.json](results/main-sol-diet-lease-refused.json) (amendment 4) |
| sol-minus-verify | 11 | 8 | [main-sol-minus-verify-lease-refused.json](results/main-sol-minus-verify-lease-refused.json) |
| sol-none | 9 | 7 | [main-sol-none-lease-refused.json](results/main-sol-none-lease-refused.json) |
| sol-full | 6 | 6 | [main-sol-full-lease-refused.json](results/main-sol-full-lease-refused.json) |
| opus-none | 1 | 1 | [main-opus-none-lease-refused.json](results/main-opus-none-lease-refused.json) |
| opus-full, opus-diet, opus-minus-verify | 0 | 0 | none |

- **Cause:** amendment 4's reservation effect. A Sol call with about 1M input tokens on video-processing, sam-cell-seg or install-windows-3.11 asked for an $11 to $40 reservation that the open trials had left no room for, even in cells far below their lease.
- **Records:** the unedited main-stage trials.jsonl of each rerun cell is committed under results/main/<cell>/, because `--done` needs them inside the pinned tree. opus-full's is committed too, for amendment 1's rerun of the 8 trials in [stage0-launch1-runner-fault.json](results/stage0-launch1-runner-fault.json), which needs every planned trial of the shard recorded first.

### 2. Leases from amendment 4's formula

Planned lease = recorded spend (stage 0 and main) + 1.2 × refused count × the cell's mean recorded USD per completed main-stage trial + $130, rounded up to the cent.

| Cell | Recorded spend | Mean per completed trial | Refused | Planned lease |
|---|---|---|---|---|
| opus-none | $137.2044 | $0.7506 | 1 | $170 to $268.11 |
| sol-none | $54.7990 | $0.2311 | 9 | $72 to $187.30 |
| sol-full | $67.1374 | $0.2623 | 6 | $83 to $199.03 |
| sol-minus-verify | $48.0925 | $0.2412 | 11 | $66 to $181.28 |

### 3. Fitting the cap

With only section 2, the combined plan would be $850.44 of base leases + $180 reserve + $705.28 of arms leases = $1,735.72. That is $135.72 over the run's $1,600 cap, although each preregistration file passed plan.ts on its own. So:

- **The two finished arms cells drop to their recorded spend.** They have no lease_refused record and never run again. opus-minus-verify goes from $157 to $117.01 (recorded $117.0071), and opus-diet from $157 to $120.59 (recorded $120.5810).
- **The base reserve goes from $180 to $120.**
- **The arms cap_usd goes from $899 to $629.56**, which is $1,600 less the base leases and reserve.
- **Result:** $850.44 + $120 + $628.88 = **$1,599.32 planned, against $1,600**. `plan.ts show` reports "total lease $850.44 + reserve $120.00 within cap $1600.00" and "total lease $628.88 + reserve $0.00 within cap $629.56". `plan.ts check-shard --rerun` passes for every rerun shard, sol-diet's included.
- **Expected spend:** paid spend when the main stage ended was $736.19. The reruns should add about $76, mostly sol-diet's. The $130 in each lease is room for one large reservation, not spend we expect.

### 4. How they run

- Each listed trial runs once as stage `rerun1` from this commit, one VM per cell as before: opus-none, sol-none, sol-full and opus-full (amendment 1's 8 trials) under [prereg-harbor.json](prereg-harbor.json), and sol-minus-verify under [prereg-harbor-arms.json](prereg-harbor-arms.json).
- sol-diet's rerun1 launched from amendment 4's commit before this addendum. Its lease ($145.40) and planned lease ($210) don't change here.
- `merge-stages.ts --exclude <list> --rerun ...` takes each rerun record, as amendments 1 and 4 do. A rerun that is refused or faults again is not rerun again.
- **Reporting:** the results give each cell's lease_refused count before and after the reruns, and state this addendum.
