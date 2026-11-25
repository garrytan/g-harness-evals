# Particle-1 against frontier models, per harness (particle-swap-2026-11): report

**We learned that Opus 5.5 and GPT-6.1 Sol were detectably better than particle-1 on coding tasks in Hermes, OpenClaw and Pi, by 17.7 and 19.7 points, and the run did not show particle-1 within 10 points of either. You should keep coding work on a frontier model and use particle-1 where a lower pass rate is acceptable for about a third to two thirds of the metered cost per solved task (an upper bound for particle-1, whose off-peak discount the proxy can't see).**

- **Codegen, the preregistered calls:** Opus 5.5 beat particle-1 by **17.7 points [+7.7, +27.8]**, and GPT-6.1 Sol by **19.7 points [+9.4, +29.7]**, pooled over Hermes, OpenClaw and Pi. Both read "frontier better". Particle-1's task-mean pass rate was 61.1%, against 78.8% for Opus and 80.8% for Sol.
- **Hermes, OpenClaw and Pi agree.** In each of the three, each frontier model was detectably better than particle-1, by 14.7 to 25.0 points. In DeepSeek Harness (Amendment 1), Opus was better and Sol against particle-1 reads "can't tell".
- **Particle-1 is cheaper per solved task:** 0.35x Opus [0.27x, 0.49x] and 0.62x Sol [0.40x, 0.90x], on metered cost, which is an upper bound for particle-1 because its 50% off-peak billing is invisible to the proxy. It is also less steady. All three attempts on a task passed in 40% to 42% of tasks, against 69% to 78% for the frontier models, and two attempts disagreed on 24% to 27% of tasks, against 6% to 12%.
- **DeepSeek-V4.1-Flash-1017, a low-cost model, beat particle-1 by 8.8 points [+3.6, +14.2]** in the same three harnesses (Amendment 1), even after 33 of its trials that looked up a task's answers from a public copy of the benchmark were scored as fails. The 52 tasks were picked with DeepSeek's own pass data, which pulls its pass rate down (Amendment 1).
- **The brain use cases can't tell (no headroom).** Frontier models scored at or near the top on both brain task sets, so this run can't say whether particle-1 is as good there (preregistration, "Why the brain use cases don't run").

## What ran

- **Codegen (`particle-swap-2026-11`):** 52 Terminal-Bench 2.1 tasks, 3 attempts each, in 9 cells: Opus 5.5, GPT-6.1 Sol and particle-1, each in Hermes, OpenClaw and Pi. Same harness settings in every cell, only the model changes. 1,404 trials, one Ubicloud VM per cell, at commit 1c42b90e (Amendment 2), except particle-hermes, whose last 29 trials ran on a second VM at 6e5f6680 (Amendment 4).
- **Amendment 1 (`particle-swap-a1-2026-11`):** DeepSeek-V4.1-Flash-1017 in the same three harnesses, and all four models in DeepSeek Harness (`dsh`). 7 cells, 1,092 trials. Its calls use the union of both run ids' records.
- **Completeness (`particle-swap-completeness-2026-11`):** particle-1 in OpenClaw and Hermes on the saturated 20-task v0.3 company set, 4 repetitions each. No call is drawn from it. The two QM cells can't run at QM's pinned commit (Amendment 3).
- **Web tools were off** in every harness, checked from each shard's captured requests before its first counted trial. No cell had gstack or gbrain installed.

## Results

### Codegen pass rate by harness and model

Task-mean pass rate with its 95% interval, then cost per solved task. Wall time is contended (4 trials at a time per VM).

| Harness | Opus 5.5 | GPT-6.1 Sol | particle-1 |
|---|---|---|---|
| Hermes | 79.5% [69.9%, 88.5%], $0.79 | 84.0% [74.4%, 92.3%], $0.39 | 59.0% [48.1%, 69.9%], $0.35 |
| OpenClaw | 76.3% [65.4%, 86.5%], $0.84 | 77.6% [66.7%, 87.2%], $0.48 | 61.5% [50.6%, 71.8%], $0.31 |
| Pi | 80.8% [71.2%, 89.7%], $0.54 | 80.8% [71.2%, 89.7%], $0.22 | 62.8% [52.6%, 72.4%], $0.12 |

### The preregistered calls

d is frontier pass minus particle-1 pass per task, paired inside one harness, pooled with each harness weighted equally and clustered by task. Holm runs over the six primary calls; the four brain calls count as p = 1.

| Call | particle-1 / frontier | d [95% CI] | Within 10 points, p (Holm) | Frontier better, p (Holm) | Label |
|---|---|---|---|---|---|
| codegen/opus | 61.1% / 78.8% | +17.7 [+7.7, +27.8] | 0.93 (1.00) | 0.0011 (0.0055) | **frontier better** |
| codegen/sol | 61.1% / 80.8% | +19.7 [+9.4, +29.7] | 0.97 (1.00) | 0.0001 (0.0006) | **frontier better** |
| personal brain, company brain | not run | | | | **can't tell (no headroom)** |

- **One harness at a time** (secondary): Opus minus particle-1 is +20.5 in Hermes, +14.7 in OpenClaw and +17.9 in Pi; Sol minus particle-1 is +25.0, +16.0 and +17.9. All six read "frontier better" after Holm.
- **Per task:** particle-1 did worse than Opus on 64 of 156 (harness, task) pairs and better on 17; worse than Sol on 65 and better on 20.

### Adding DeepSeek Harness (Amendment 1, secondary pool)

- **The same two calls with DeepSeek Harness pooled in:** Opus minus particle-1 is +17.3 [+7.1, +27.4], and Sol minus particle-1 is +14.4 [+4.5, +24.4]. Both still read "frontier better". These never replace the primary calls.
- **Inside DeepSeek Harness alone:** Opus 81.4%, particle-1 65.4%, DeepSeek 67.3%, Sol 64.1%. Sol vs particle-1 there is -1.3 [-12.2, +10.9], "can't tell" (smallest detectable difference 16.8 points). Sol hit 29 harness errors in DeepSeek Harness, counted as fails, against 0 to 4 in the other harnesses. Read it as a poor fit between Sol and that harness, not as particle-1 catching up.

### DeepSeek-V4.1-Flash-1017 against particle-1 (Amendment 1)

| Comparison | Harnesses | Task means | Difference [95% CI] | Label |
|---|---|---|---|---|
| DeepSeek minus particle-1 (the call) | Hermes, OpenClaw, Pi | 69.9% / 61.1% | +8.8 [+3.6, +14.2] | **DeepSeek better** (Holm p 0.0024) |
| DeepSeek minus particle-1 (beside it) | DeepSeek Harness | 67.3% / 65.4% | +1.9 [-4.5, +9.0] | descriptive |
| Opus minus DeepSeek (beside it) | Hermes, OpenClaw, Pi | 78.8% / 69.9% | +9.0 [+0.2, +17.8] | descriptive |
| Sol minus DeepSeek (beside it) | Hermes, OpenClaw, Pi | 80.8% / 69.9% | +10.9 [+2.1, +19.9] | descriptive |

- **Cost on one price basis** (token counts times list prices) could not be computed: 21 DeepSeek trials and 2 particle-1 trials lack token counts, because some requests were charged their full reservation when the stream returned no usage, and 1 more DeepSeek trial has no usage record. Metered cost per solved task in the cell table: DeepSeek $0.08 to $0.16, particle-1 $0.12 to $0.35.

### Completeness cells (saturated company set, cross-run)

| Cell | Passes | Pass rate [95% CI] | Paid |
|---|---|---|---|
| particle-1 in OpenClaw | 55 / 80 | 69% [49%, 88%] | $3.22 |
| particle-1 in Hermes | 45 / 80 | 56% [36%, 75%] | $1.93 |
| QM on Sol, QM on particle-1 | not run | can't run at the pinned QM (Amendment 3) | $0 |

- 1 of the 24 approval-relay trials passed (one OpenClaw try), and both cells missed most correction tasks. These cells are labelled cross-run and saturated, and no call uses them.

## What we learned about the models and harnesses

### DeepSeek and particle-1 looked up the benchmark's answers

- **The contamination audit flagged 90 of 2,496 codegen trials**, and a blind reader, who saw no harness or model names, confirmed 38 of them as lookups. A confirmed lookup is scored as a fail.
- **DeepSeek-V4.1-Flash-1017: 33 lookups**, 16 in DeepSeek Harness, 11 in Pi and 6 in OpenClaw. 31 of those trials had passed. Most fetched the task's own solution and tests with `curl` or `git clone` from a public copy of Terminal-Bench (GitHub, Hugging Face, or mirrors), and several ran the official tests before answering.
- **particle-1: 5 lookups**, 3 in DeepSeek Harness and 2 in the codegen cells (one cloned the benchmark repo and passed, one searched and timed out).
- **Checked 2026-11-25 against the audit's own signals: the blind reader holds.** This is a check with no model in it on 90 flags, not R126's 100-output judge check. We scored the reader's verdicts against two signals audit.ts records with no model in them: answer-key lines received, or a benchmark source requested. They agree on 86 of the 90 flags. All 4 differences go one way (signal yes, reader no) and are sanitize-git-repo trials whose only signal is answer-key lines received: none asked for a benchmark source or held the canary. We read them as task input that overlaps the hidden tests, as the frontier-harness report does for this task, so the reader's "no" stands, but the script does not check that. One of the 4 (DeepSeek-V4.1-Flash-1017 in DeepSeek Harness, a3) passed; if the reader were wrong there, it would count as a fail. The 38 lookups stand, and so do the 17.7 and 19.7 point gaps the front page quotes. The reader was Claude Opus 5.5, which is also a model under test in this run. Script: [scripts/corrections/check-lookup-readers.ts](../../../scripts/corrections/check-lookup-readers.ts).
- **Opus 5.5 and GPT-6.1 Sol: none.**
- **Why web tools didn't stop it:** the harnesses' web search tools were off, but tasks need github.com and huggingface.co to install software, so the shell can still reach a copy of the benchmark. A host-name blocklist can't close one path of a shared host (scripts/frontier-harbor/README.md, "Egress").
- **The other 52 flags were false alarms:** 48 were the benchmark's marker string arriving in the task's own files, and 4 were a repo's own source lines that also appear in its hidden tests.

### Particle-1 is slower and less steady

- Median wall time per trial in Hermes was 937 s for particle-1, against 396 s for Opus and 470 s for Sol. In Pi it was 342 s, against 189 s and 237 s.
- Particle-1 hit the task time limit on 22 to 37 trials per codegen cell, against 1 to 12 for the frontier cells.
- pass^3 (all three attempts pass) was 40% to 42% for particle-1, 71% for Opus (70.6% to 71.2%) and 69% to 78% for Sol.

## Why null?

Not applicable. No part of gstack or gbrain is under test here (every cell runs without either), and the codegen calls are not null.

## Deviations

- **Amendment 2 (pre-data):** every shard's smoke failed at the preregistration commit, because the install check's reasons list did not skip the keyless Cursor cell. One condition was fixed, and every cell started at 1c42b90e. 140 of the 2,496 trials ran later, from the Amendment 4, 5 and 6 commits (29, 52 and 58) and the verifier-rerun inputs commit 05edba9d (1). The first canary was lost to it ($0 model spend).
- **Amendment 3 (pre-data):** the two QM completeness cells can't run at QM's pin, because QM refuses an MCP server on a private network address.
- **Amendment 4:** particle-hermes hit the controller's 13-hour limit with 127 of 156 trials finished. Those 127 were rebuilt from the shard's per-trial journal, and the other 29 ran on a second VM.
- **Amendment 5:** the Amendment 1 controller's disk filled during a results copy and stopped deepseek-hermes at 104 of 156. The 52 trials that never started ran on a second VM.
- **Amendment 6:** sol-dsh spent its $100 lease with 58 trials unrun (Sol cost about $1.01 a trial in DeepSeek Harness). Its lease rose to $190, paid for by opus-dsh and particle-dsh giving back lease they never used, inside the same $580 cap, and the 58 trials ran once more.
- **Infra reruns:** one verifier-unavailable trial (deepseek-hermes) was rerun once, as preregistered, and passed. Seven no-model-response trials (deepseek-hermes 5, sol-hermes 2) stopped on an agent setup timeout, not a network error, so the preregistered rerun rule does not cover them: they stay excluded and are counted per cell. Two more trials are excluded as infra errors and counted per cell: sol-openclaw/financial-document-processor/a2 (effort mismatch; it had passed) and deepseek-openclaw/model-extraction-relu-logits/a1 (setup failed).
- **Lease stops:** 7 codegen trials stopped at their lease (opus-hermes 1, sol-hermes 4, particle-openclaw 1, sol-pi 1). They are excluded and counted.
- **Failed launches and restarts:** the first launch of 15 shards at once filled the controller's disk before any VM was made. sol-openclaw and three DeepSeek shards failed their keyless smoke and were relaunched in new folders before any counted trial. One controller restart killed a launcher; the shard was rejoined with `run-shard.sh --attach` and finished.

## Reproduce and inspect

- **Merged records:** [results/merged/run1-codegen](results/merged/run1-codegen/) and [results/merged/run2-amendment1](results/merged/run2-amendment1/), from scripts/frontier-harbor/merge-stages.ts, each with every shard's ledger, proxy usage, run summary, clean-arm preflight, VM record and web-tools check under shards/. Two gaps: particle-hermes's first VM has no run summary (it was stopped at the time limit), and deepseek-pi's web-tools check is recorded only in its log, which the repository does not commit.
- **Analyses:** [results/codegen/analysis](results/codegen/analysis/analysis.md) (the primary calls) and [results/a1/analysis](results/a1/analysis/analysis.md) (Amendment 1, over [results/union](results/union/), both run ids' records), from scripts/frontier-harbor/analyze.ts with the confirmed lookup lists.
- **Audits:** results/codegen/audit.json and results/a1/audit.json from scripts/frontier-harbor/audit.ts, and the blind reader's verdicts in each lookup-fails.json.
- **Completeness:** [results/completeness](results/completeness/), from scripts/merge-shards.ts and scripts/summarize-run.ts.
- **Amendment inputs:** results/recovered, results/partial, results/main and results/rerun.
- **Rebuild:** `bun run verify --run 2026-11-09-particle-swap` rebuilds all 2,992 published analysis numbers from the committed records, with no API keys.

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.
