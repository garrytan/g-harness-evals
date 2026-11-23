# Rules files at scale: does each agent still follow its rules file as the file grows?

**We learned that when a rules file gets long, rules mostly go missing because the harness cuts the file, not because the model ignores it.** On Opus 5.5 and GPT-6.2 Sol, a planted rule that reached the model whole was followed 97.8% of the time (6,203 of 6,345 rule checks). A rule that never reached the model, because the harness cut it or it sat in a folder file that wasn't loaded, was followed 3.2% of the time (15 of 474). **You should keep must-follow rules inside the part of the file your harness actually sends**, or raise its limit, or deliver them through a hook.

**We also learned that a low-cost model is different: particle-1 loses rules it was given in full.** On Pi and Hermes it got every rule whole at every size, yet followed 17 to 23 points fewer at 8 KB than in a short file, and 50 to 65 points fewer from 28 KB up. **On a model like that, keep the rules file short**, because no size we tried was safe.

Run `rules-at-scale-2026-11`, preregistered in [PREREGISTRATION.md](PREREGISTRATION.md) with seven dated amendments. 1,656 counted trials, 36 real bug-fix tasks per cell, six setups on Opus 5.5 or particle-1 and one on GPT-6.2 Sol. A script grades every rule from the finished repository and the model requests; no model grades anything. Analysis: [results/analysis/analysis.md](results/analysis/analysis.md).

## What works

- **Claude Code, Hermes and Pi on Opus send the whole file, and Opus follows it at every size up to 160 KB.**
  - Rules followed in the 160 KB file against the short file: Claude Code 94.7% against 99.1%, Hermes 98.1% against 98.2%, Pi 97.2% against 98.2%.
  - None of the three passed the preregistered 160 KB step, so none has a measured drop.
  - One caveat for Claude Code: its 160 KB step was close (-4.4 points [-9.7, -0.5], p 0.094), and its 80 KB step (-6.7 [-11.8, -2.8]) was never tested because the fixed sequence stops at the first step that fails. So a small loss on Claude Code isn't ruled out.
- **On Codex and OpenClaw, a hook or a raised limit brings the lost rules back.** These are the two harnesses that cut long files.
  - Codex keeps only the first 32 KB of AGENTS.md. From 80 KB up it follows about 50 points fewer rules (-50.6 [-57.6, -43.4] at 160 KB).
  - Against Codex's 160 KB file, the hook adds 50.9 points [43.4, 58.1], raising `project_doc_max_bytes` to 262144 adds 50.2 [42.9, 57.2], and moving rules into folder files adds 47.9 [40.8, 54.6]. Up to 28 KB, Codex followed every rule (100%).
  - OpenClaw drops the middle of the file from 28 KB up and follows about 33 points fewer rules (-32.6 [-35.1, -29.6] at 160 KB).
  - Against OpenClaw's 160 KB file, the hook adds 35.1 points [30.2, 41.2] and raising `bootstrapMaxChars` adds 34.2 [29.1, 40.3]. At 8 KB nothing is lost (99.1%).
- **No setup showed a measured drop in task success as the file grew.** Every rung's solve-rate range includes no change from the short file, but a small loss isn't ruled out: the widest was Pi on Opus at 28 KB, -8.3 points [-19.4, 0.0]. The size costs money instead:
  - On Claude Code, a trial with the 160 KB file cost $0.43 more than with the short file ($0.608 against $0.173).
  - On Hermes it cost $0.44 more, on Pi $0.43 more.
  - Codex and OpenClaw cost less extra ($0.05 and $0.06), because they never send most of the file.

## What didn't work

- **Rules moved into folder files (`split`) aren't loaded at the start, and on Opus that loses rules.**
  - Against the 160 KB file, split cost Claude Code 16.2 points [-24.1, -5.1] and Pi 32.4 points [-38.0, -26.9], each on 18 tasks because both stopped at the half-way look. Hermes lost 2.8 [-5.7, -0.3] without passing its test.
  - Split helped only where the big file was being cut: on Codex (+47.9), and a little on OpenClaw (+3.8 [0.7, 7.2]).
- **particle-1 has no safe size.**
  - Rules followed against the short file: on Pi 83.2% at 8 KB and 38.7%, 35.6% and 40.7% at 28, 80 and 160 KB (short 100.0% on the same 18 tasks); on Hermes 73.3%, 46.5%, 41.1% and 31.1% (short 96.3% on the same 18 tasks).
  - Every rule arrived whole in every one of those trials.
  - These steps stopped at the half-way look, so their size may be overstated (see below). No hook arm ran on particle-1, so we don't know whether a hook would help there.
- **The hook adds little on Claude Code and Hermes on Opus.** Opus already follows 97% to 98% of rules there, so a hook has little room to help. Claude Code +2.1 [-2.3, 7.6], Hermes +1.9 [0.5, 3.9]; neither passed its test after Holm's correction. Pi had no hook arm.

## Where a rule sits in the file

- Pooled over the five frontier setups, at the 160 KB rung, a rule in the middle of the file was followed 37.6 points less often than a rule at the top ([-40.8, -34.5], n 178), and a rule at the end 11.8 points less often ([-15.5, -8.2]).
- That comes from the two harnesses that cut. OpenClaw loses the middle, and Codex keeps only the top. On Claude Code, Hermes and Pi, position made no clear difference.
- particle-1 shows the same pattern with nothing cut: at 160 KB on Pi, a rule in the middle was followed 77.8 points less often than one at the top [-91.7, -58.3] and a rule at the end 83.3 points less often [-97.2, -63.9]. On Hermes the gaps were 63.9 and 66.7 points.
- Pooled over the frontier setups, the drop from the short file is 0.0 points at 8 KB [-0.9, 1.0], 5.0 at 28 KB [-6.6, -3.3], 17.5 at 80 KB [-19.8, -15.3] and 17.7 at the top rung [-19.9, -15.5]. These pooled readings decide nothing.

## What this changes

- **Settled:** gstack's block goes inside each harness's kept region (Codex: the first 32 KB; OpenClaw: the head or the tail, with the whole file under its 20,000-character limit), and gbrain keeps its per-turn hook on Codex and OpenClaw. No gstack or gbrain part is cut.
- **gstack:**
  - On Codex, keep gstack's block inside the first 32 KB of AGENTS.md.
  - On OpenClaw, put it at the head or the tail, never the middle, and keep the whole file under 20,000 characters, OpenClaw's default per-file limit (`bootstrapMaxChars`). Our 8 KB file came through whole and the 28 KB file was cut.
  - On Claude Code, Hermes and Pi, block length isn't the limit up to 160 KB on Opus, but every extra kilobyte costs tokens on every turn.
  - Don't move must-follow steps into folder files.
- **gbrain:** on Codex and OpenClaw, the per-turn hook is what reliably carries a rule once the file is long. Elsewhere on Opus the rules file is enough.
- **People writing rules files:**
  - Put must-follow rules first.
  - On Codex, keep the file under 32 KB or set `project_doc_max_bytes`. On OpenClaw, keep it under 20,000 characters or raise `bootstrapMaxChars` and `bootstrapTotalMaxChars`.
  - On a low-cost model, keep the file short.

## What didn't run

- **QM:** its rules cells need the QM runner, which is still waiting to merge (#497). QM will come later as a follow-up row on this run.

## How to read the numbers

- **Rules followed:** the share of applicable rule checks met, per trial, averaged over the 36 tasks. A rule whose trigger never happened in a trial is not applicable.
- **Ranges** are 95% task-clustered bootstrap ranges. Differences are paired by task. **n** is the number of tasks, or of task pairs.
- **Smallest detectable difference:** 10.3 points per setup and rung, stated in advance.
- **Ladder steps** are tested in a fixed order from the largest file down, and the sequence stops at the first step that fails. Repairs are tested against the 160 KB file with Holm's correction.
- **"Stopped early, possibly overstated":** after half the tasks, the run took its one preregistered look. A comparison that had already crossed its stop bound kept that decision, and its cells skipped the second half. Those numbers rest on 18 tasks, and a result that stops early tends to read larger than it is. This applies to OpenClaw's 28 and 80 KB steps, its hook and lifted-cut repairs, Claude Code's and Pi's split repairs, and every particle-1 step.

## Next time

### What we'd change if we ran this again

- Give the edit-watcher check in the task preflight a longer wait, or one retry, before it stops a shard, because its timing miss stopped two of the eight second-half launches before any trial ran (Amendments 4 and 6).
- Keep the fan-out controller awake for the whole run and check its free disk before each relaunch, because a sleeping controller wasted three VMs (Amendment 2) and a full disk failed one relaunch (Amendment 3).
- Record a trial that never started as an infra row from the first collection, because one Codex trial needed a rule added after the data (Amendment 7).

### Ideas to improve the eval

- Test particle-1 below 8 KB, because it already lost 17 to 23 points at 8 KB, so this run found no safe size for it.
- Rerun Claude Code's 160 KB and 80 KB steps with more tasks, because the 160 KB step was close (p 0.094) and the 80 KB step was never tested.
- Run a split arm whose top-level file tells the agent to read the folder files, because split lost rules on Opus when those files weren't loaded at the start.

## How the run went

<details>
<summary>How the run went, and every deviation</summary>

- **Commits:** every trial of the six Opus and particle-1 setups ran from commit `ce51e3b9` (Amendment 1). Codex ran from `9bf329c6` (Amendment 5). Each shard records its commit in `results/shards/<shard>/shard.json`.
- **Controller restart (2026-11-22):** the machine running the fan-out went to sleep at about 04:14 UTC, about 30 minutes after the canary shard launched, and its controller processes died with it.
  - The canary's VM kept running. Its controller was reattached with `run-shard.sh --attach`, loading the same commit `ce51e3b9`, and it finished all 144 trials.
  - Three VMs that had started but never received a key or a lease were destroyed unused, about $9.80 of VM time wasted. Two shards had not launched yet.
  - Amendment 2 relaunched those five shards from `ce51e3b9` into a new folder.
- **Amendment 3:** pi-opus-h1's relaunch failed while copying the repository to its VM, because the controller's disk was full. No trial ran, and it launched a third time.
- **Amendments 4 and 6:** pi-opus-h2 and codex-sol-h2 each stopped at the task preflight, on a timing miss in the edit watcher check (rf-28 and rf-26). No trial ran and no money was spent, and each launched once more.
- **Amendment 5:** Codex moved to GPT-6.2 Sol and Codex 0.171.0 before any Codex trial, under Garry's frontier-model rule. It had its own delivery map and its own 27-trial pilot ($4.78). Codex had no pairs at the half-way look, so it ran all 36 tasks with no look of its own.
- **Amendment 7 (after the data):** one Codex trial (hook, rf-34) never started, because the egress sidecar check failed on its VM while Harbor was building the environment. The collector now records such a trial as an infra row with every rule unscorable, which is the preregistered infra rule, with no retry. Every other shard's rows are byte-identical to the earlier collection.
- **Totals:** 1,656 rows, 1 infra (that trial), 0 contaminated, 0 timeouts. Every shard's clean-arm preflight found no Capy drive and no gstack or gbrain install.
- **Per shard:** commit, exit, rows, metered trials and VM minutes are in [results/shards.json](results/shards.json).

</details>

<details>
<summary>Files</summary>

- [results/trials.jsonl](results/trials.jsonl): one row per counted trial (rules, delivery, solved, dollars, infra). [results/trials-first.jsonl](results/trials-first.jsonl) is the first half that the look used.
- [results/look/interim.json](results/look/interim.json): the half-way look and the cells it stopped.
- [results/analysis/](results/analysis/analysis.md): the final analysis. `bun run verify --run 2026-11-19-rules-at-scale` rebuilds it and the look from the rows.
- [results/shards/](results/shards/): each shard's commit, preflights and rows, plus the two launches that stopped at the preflight.

</details>

## Disclosures

gstack is Garry Tan's own project. gbrain is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.
