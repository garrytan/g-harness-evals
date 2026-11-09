# Glossary

Plain meanings for the words our reports use. The scoreboard ([scoreboard.md](scoreboard.md)) and every report written to the [report standard](report-standard.md) use these words and no others for verdicts and calls.

## Verdicts on a part (R48)

A verdict says what to do with one part we tested: gstack, gbrain, a prompt layer, a hook, a harness feature.

| Word | Plain meaning | When a report may use it |
|---|---|---|
| **KEEP** | Keep it on. It helps, or it is needed for something that helps. | Tested on a frontier model (Opus 5.5, GPT-6.1 Sol, gpt-6-astra), the part reached the model, and the result favors it. |
| **FIX-METHOD** | We can't tell yet, and we know why. Fix the named problem with the test before deciding. | The test had a named gap: the part never reached the model, the tasks don't fit it, the arm without the part already scores near the top (saturation, R61), or the run was too small. The report names the one fix. |
| **CUT-CANDIDATE** | Tested fairly and it did not help. A candidate to switch off. | Exposure, fit and headroom were all checked and the result still shows no gain. |

A Sonnet-, Haiku- or luna-only result carries no verdict (R54).

## Calls on a comparison

| Word | Plain meaning |
|---|---|
| **Can't tell apart** | The preregistered test found no difference after adjusting for the number of comparisons. It does not mean equal: the run had less than an 80% chance to detect a gap smaller than its MDD. |
| **Behind** / **ahead** | The preregistered test found a difference, in that direction, after the adjustment. |
| **Within N points** / **at most N points ahead** | The preregistered non-inferiority test showed, after the adjustment, that a harness is no more than N points below the one it is compared with, N being the margin the preregistration set. Read from the other side, that one is at most N points ahead. It does not mean equal or better. |
| **Cheaper per trial** / **costs more per trial** | A preregistered cost contrast whose 95% range is wholly below or wholly above zero. |
| **Cost per trial: can't tell apart** | A preregistered cost contrast whose 95% range includes zero. |
| **Interval only, not tested** | The report gives a range for this pair, but the preregistration made no test of it. Read it as a description, not a finding. |
| **Not compared** | The run made no comparison for this pair. |
| **Descriptive, no test** | A number we report but did not test. Useful for size, not for "better or worse". |

## Numbers

| Term | Plain meaning |
|---|---|
| **Pass rate** | The share of tasks solved: each task's share of passing tries, then the mean over tasks (the task mean). |
| **95% range (CI)** | The task-clustered bootstrap interval: tasks are resampled with replacement 10,000 times, so a few lucky tasks can't narrow it. |
| **Cost per solved task** | Everything a cell spent at list price, metered by our proxy, divided by its passes. Older reports call it cost per pass, cost per success, dollars per pass or USD per success. |
| **Cost per trial** | The same spend divided by the trials recorded. Always say mean or median. |
| **Run spend** | What a run cost in model calls under its leases, at list price. A report says whether it includes smokes, VMs and the agents' own model use (R71 all-in). |
| **Median time per trial** | Wall-clock time from start to finish of one trial, median over the cell. Say whether trials ran one at a time. |
| **MDD** | Minimum detectable difference: the smallest gap this run had an 80% chance to detect (80% power). Some reports say MDE; it means the same. |
| **Holm** | A correction for running several comparisons at once, so that one lucky comparison doesn't read as a finding. |
| **Saturated** | Half or more of the tasks score the same in every cell, so the tasks, not the harness, decide most of the score. |

## Runs and tasks

| Term | Plain meaning |
|---|---|
| **Dev** | Tasks we could see while building. A dev result can be tuned to; it is a lead, not a confirmation. |
| **Held-out** / **sealed** | Tasks kept encrypted until a counted run opens them (procedural custody). A held-out result is the confirmation. |
| **Opening** | The one counted run allowed to unseal a held-out set. |
| **Preregistration** | The plan, merged before the first counted trial: tasks, arms, metrics, tests and stop rules. Changes after that are dated amendments. |
| **Arm** / **cell** | One setup we score: a harness, a model and any add-on. |
| **Told** / **live** / **scoped** | Names of gbrain setups. Each report defines them in its What ran section, and the meaning has changed between runs, so read that run's definition. Scoped always means the brain returns only what the asker may see. |
| **Rung** | One step of an install or setup ladder, each adding one thing. |
| **Ceiling** / **floor** | Tasks every cell passes, or no cell passes. They can't show a difference. |
| **Why null?** | The section a null or negative result must carry: exposure, fit, power and saturation, model, then one verdict. |

## Other verdict words in older reports

Older reports use these. New reports don't. Each older word keeps the definition its own preregistration gave it; the right column is the nearest plain reading.

| Older word | Nearest plain reading |
|---|---|
| not distinguished, not told apart, unclear, inconclusive | can't tell apart |
| distinguished, differed | behind or ahead |
| NOT ADDED, INSUFFICIENT (investigate gate preregistration clauses) | the part was not added; see that report's clause for why |
| KEEP / CUT / INCOMPLETE (QM S1 edition preregistration) | that preregistration's own verdict words; see its rules |
| FROZEN / CEILING / FLOOR (v0.4 calibration) | task status in calibration: kept, too easy, too hard |
| Outcome A / B (v0.3 Opus dev) | the report's preregistered branches; B meant no opening on v0.3 |
