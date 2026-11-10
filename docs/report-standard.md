# Report standard

How every new report in docs/benchmarks/ is written. It makes a report readable in 30 seconds and checkable in 5 minutes. Reports in run folders dated before this standard merged keep their text; the [reports index](reports-index.md) gives their status.

## How we test, in brief

Every report rests on these rules. They moved here from the README on 2026-11-08.

- **Frontier models only.** Opus 5.5 and GPT-6.1 Sol carry every result. Older Sonnet and Haiku runs are kept, labelled appendix, and carry no verdict.
- **Preregistered.** Each run's question, tasks, comparisons and stop rules are committed before its first trial, and nothing they cover changes afterwards. In the public copy, that order is our own record; its commit dates can't prove it.
- **Metered.** Every model call goes through our metering proxy, which counts tokens and dollars at list price. The harness never sees a real API key. Cost per solved task comes from this meter.
- **A no-gstack arm in every head-to-head.** Any test of gstack runs the same model, harness and tasks with gstack not installed, and an audit checks that this arm never read a gstack file. gbrain tests keep a no-brain arm the same way.
- **Graded on what happened.** Tasks run inside a simulated company with channels, files and mail. The grader reads the world's state and event log afterwards, never the agent's account of what it did.
- **A claim check before results publish.** A reviewer traces every number and takeaway in a report to its receipt before the report merges. The [reports index](reports-index.md) shows which reports have one.
- **A cross-family judge.** Where a run scores answers with a model, the judge comes from a different model family than the model under test, and it must agree with labelled examples before its scores count. This applies to runs preregistered from November 8, 2026.
- **Recheckable without a key.** Each recent report ends with a "Reproduce and inspect" section that rebuilds its tables from the receipts in the repository ([CONTRIBUTING.md](../CONTRIBUTING.md#re-read-a-runs-receipts)). A tool for rerunning one cell with your own key is described in [replicate.md](replicate.md), but no published result ships the trial bundle it needs yet.
- Known limits and the statistics: [methods.md](methods.md#known-limits-in-full).

## The top of the report

Every report opens with takeaways, then a TL;DR block, before any other heading. Copy [report-template.md](report-template.md).

1. **Two or three takeaway bullets, first of all (R79).** Each one reads "We learned X. You should do X.", in plain words, for someone building agents.
   - What works comes first, including where gstack, gbrain or our harness work helped and why it matters.
   - What didn't work comes right after, stated plainly, never buried. Where the data supports it, a null becomes a usable lesson with its number.
   - No number rounded in our favour and no caveat dropped: a takeaway that needs a caveat carries it.
2. **The lesson this run is after,** in one line: the public question the experiment set out to answer. Work that yields neither a shareable lesson nor better software is cut first.
3. **The answer in one bold line.** The question and what we found, in plain words. Say "can't tell apart" when the test found nothing; never soften a null.
4. **The numbers, one bullet each, with ranges.** Pass rate [95% range] per cell, cost per solved task [95% range], median time per trial.
5. **The call or verdict.** A call from the [glossary](glossary.md) for each preregistered comparison, and for a part under test one verdict word (KEEP, FIX-METHOD or CUT-CANDIDATE) with its plain meaning.
6. **Caveats, one line each.** Incomplete cells, dev not held-out, saturation, pins, deviations. Never buried below the fold.
7. **Status line.** Merged or draft, the results PR, and whether a claim-check reader ran and on which PR.

## Words and numbers

- **Metric names.** Use these and no others: pass rate, cost per solved task, cost per trial (say mean or median), run spend (say what is in it), median time per trial. Definitions are in the [glossary](glossary.md).
- **Pass rate is the task mean** with the task-clustered bootstrap 95% range. State the denominator (tasks and tries) beside it. If a headline uses a subset of tasks, the table says so and gives the full-cell figure too.
- **Cost is list price through our metering proxy.** Say what is in and out: excluded trials, timed-out charges, housekeeping calls, smokes, VMs.
- **Cost stays internal unless it is the lesson.** Cost per solved task between setups belongs in the body when it is part of what we learned. Run spend (what the run cost us: paid trials, VMs, our own model use) never goes in report.md, because preregistered reports are hash-pinned and the public export can't drop a section from them. It goes in its own file beside the report, `docs/benchmarks/<run>/spend-internal.md`, outside results/ and outside the preregistration's globs; the public export leaves that path out.
- **Intervals are explained once in plain words** and named exactly (task-clustered bootstrap, Wilson, Newcombe). Name the Holm family and its size.
- **Headroom comes with every result.** Include the Headroom section `summarize-run.ts` prints (or `bun scripts/headroom.ts --results <dir>`): how many tasks can tell the arms apart, and the per-task table. A call the analysis refused reads "can't tell: no room to improve", with its counts.
- **Calls come from the preregistered family only.** Rows are never ranked by point estimate when their ranges overlap.
- **Define every term the glossary doesn't cover** on first use.
- **Docs style:** lead with the answer, short sentences, bullets over paragraphs, no paragraph over three lines, no em dashes, no marketing words.

## Feeding the scoreboard

A report whose run compares harnesses on one task set adds an entry under docs/scoreboard/entries/ (see [scoreboard.md](scoreboard.md) and scripts/scoreboard/schema.ts). The entry names the results file and the path to each number and holds no numbers itself. Write the run's analysis file with:

- per cell: passes, scored trials, the task-mean pass rate and its 95% range, cost per solved task and its 95% range, cost per trial, median wall time;
- per comparison: the two cells, delta, 95% range, Holm-adjusted p, tested, and a verdict field using the glossary's call words;
- per run: the task count, the ceiling and floor task lists, how many tasks can tell the arms apart, and the MDD per comparison.

A run on a task set that already has a main entry adds a `"role": "other"` entry instead. It shows under that table as "Same tasks, other runs", and the README leaves it out.

Every new run folder also gets a row in docs/scoreboard/reports.json. Until it has one, the [reports index](reports-index.md) lists it as not yet indexed.

Run `bun scripts/scoreboard/build.ts` and commit the regenerated pages, and the README block if the README has scoreboard markers, in the same PR.

## The end of the report

- **Why null?** before the deviations, when the result is null or negative for a part (CREW.md rule).
- **Deviations** and **Corrections**, dated.
- **Internal mechanics at the end:** issue codes, lanes, ledgers, gates and leases go in a closing section of the report (an Agent notes section), not in the takeaways or results. Run spend goes in spend-internal.md (see Words and numbers).
- **Disclosures last**, word for word from the disclosures list, for every subject the report tests, compares or features (R55).
