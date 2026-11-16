# Post-run blind trace read: the 22 tasks where Fable 5.2 and Opus 5.5 differ

Run: fable-diagnosis-2026-11 (plain Claude Code 2.1.322, 107 SWE-rebench July 2026 issues, 2 tries per model). This is the descriptive "After the numbers" read the preregistration names. It changes no reading in the analysis.

## Takeaways

- **We learned that finding the fault did not separate the models.** Not one of the 42 failed tries on these 22 tasks went to the wrong file or the wrong function. Every try, passing or failing, found the place the upstream fix changed. So the "needs diagnosis" label (the instruction names none of the changed files) did not catch what decided these tasks. Fable 5.2 was ahead on 7 of the 9 diagnosis tasks here and on 9 of the 13 pointed tasks, nearly the same share.
- **We learned that what decided them was the shape of the fix once the place was found.** 22 of the 42 failed tries (6 Fable, 16 Opus) were "right place but incomplete or wrong fix", and 3 more (1 Fable, 2 Opus) were over-reach. The repeatable differences were about which behaviour to keep: leave an existing window rule alone instead of redesigning it (nanobot), cover dev mode as well as production (vinext-1574), make the reported operation work instead of forbidding it (turso), apply the new rule to the encoded-slash case too (floci, the one STRONG case that favours Opus). Fable 5.2 more often got that call right: 11 of the 14 STRONG or WEAK ratings favour it. You should read Fable's lead on fresh tasks as better judgement about the intended behaviour of a fix, not as better fault-finding.
- **What this can't tell you:** 17 of the 42 failed tries (7 Fable, 10 Opus) have no cause the readers could pin down (some show a difference from the passing fix, but not which test it broke), and 8 of the 22 tasks rated NONE, where both models made near-identical fixes and the grades split on details no try could see. The pack holds no verifier output, only pass or fail, so the readers could not see which hidden test failed. One STRONG Fable win (Rapid-MLX-426) came from downloading the package's later release and copying the upstream fix, which is answer lookup, not diagnosis.

## Every task, unblinded

Label from labels.json: "diagnosis" means the instruction names none of the files the upstream fix changed, "pointed" means it names at least one. Categories and ratings are the blind readers'. F = Fable 5.2, O = Opus 5.5.

| Task | Label | Fable passes of 2 | Opus passes of 2 | What stopped the failed tries | Blind rating, favours |
|---|---|---|---|---|---|
| HKUDS__nanobot-4129 | pointed | 2 | 0 | O x2: right place, redesigned the kept window into a suffix, changing cap and anchor behaviour | STRONG, F: minimal fix that kept the window rule |
| PerryTS__perry-3982 | pointed | 1 | 2 | F x1: other, no visible cause (did not keep read-through member uses strict) | WEAK, O |
| agno-agi__agno-8148 | pointed | 2 | 0 | O x2: right place, passed a member context but not the explicit keyword arguments | WEAK, F |
| apache__hugegraph-3037 | pointed | 2 | 1 | O x1: other, ported upstream plus extra changes beyond it | WEAK, F: line-for-line upstream port both tries |
| apache__pulsar-25865 | pointed | 1 | 0 | O x2 and F x1: other; all three also changed a second exception type and the two O tries never compiled | WEAK, F |
| better-auth__better-auth-10070 | pointed | 1 | 2 | F x1: right place, joined any active transaction without checking which adapter opened it | NONE |
| cloudflare__vinext-1574 | diagnosis | 2 | 0 | O x2: right place, fixed production only and left the dev server without the default | STRONG, F: covered dev and production |
| cloudflare__vinext-1837 | diagnosis | 2 | 1 | O x1: right place, went straight to a static page and never ran a server test | WEAK, F |
| facebook__lexical-8676 | diagnosis | 1 | 0 | F x1, O x2: right place, also changed the empty first item behaviour | NONE |
| fallow-rs__fallow-821 | pointed | 1 | 0 | F x1, O x2: over-reach, turned the plugin on from a config file alone | WEAK, F |
| floci-io__floci-1325 | diagnosis | 0 | 2 | F x2: right place, kept the old error for the encoded-slash traversal key | STRONG, O: applied the rule to every dot-dot form |
| harbor-framework__harbor-1764 | diagnosis | 1 | 0 | O x2 and F x1: other, near-identical OAuth flow, cause not visible | NONE |
| ivov__lisette-627 | diagnosis | 2 | 1 | O x1: other, same fix with an extra arity check | NONE |
| ludo-technologies__pyscn-548 | diagnosis | 1 | 2 | F x1: right place, overlap threshold too loose, merged nested clones | NONE |
| microsoft__apm-1553 | pointed | 1 | 0 | O x2, F x1: right place, fixed only the download auth and not the re-fetch on install | WEAK, F |
| microsoft__waza-247 | pointed | 1 | 2 | F x1: other, same two fixes, narrower fallback for one path form | NONE |
| mui__base-ui-4849 | diagnosis | 2 | 1 | O x1: right place, fixed the focus manager but not the stale open event in the root context | WEAK, F |
| mvanhorn__cli-printing-press-2002 | pointed | 1 | 2 | F x1: other, moved the call site and edited client templates, then hit the time limit | WEAK, O |
| nearai__ironclaw-3735 | pointed | 1 | 0 | O x2 and F x1: other, near-identical facades, cause not visible | NONE |
| raullenchai__Rapid-MLX-426 | diagnosis | 2 | 0 | O x2: right place, own streaming design | STRONG, F: copied the upstream fix from a later PyPI release |
| stablyai__orca-1934 | pointed | 1 | 0 | O x2 and F x1: other, same fix to the named file, cause not visible | NONE |
| tursodatabase__turso-7117 | pointed | 2 | 0 | O x2: right place, forbade ALTER on the column instead of making it work | STRONG, F: made the reporter's repro succeed |

Totals: Fable 30 of 44 tries passed, Opus 16 of 44. Fable passed more tries on 16 tasks, Opus on 6. On the 9 diagnosis tasks Fable passed 13 of 18 tries and Opus 7 of 18 (Fable ahead on 7 tasks, Opus on 2). On the 13 pointed tasks Fable passed 17 of 26 and Opus 9 of 26 (Fable ahead on 9, Opus on 4).

## Failed tries by cause

| Cause | Fable (14 failed) | Opus (28 failed) |
|---|---|---|
| Wrong diagnosis or wrong place | 0 | 0 |
| Right place but incomplete or wrong fix | 6 | 16 |
| Over-reach beyond the issue | 1 | 2 |
| Ran out of time | 0 | 0 |
| Tool or environment trouble | 0 | 0 |
| Other (no visible cause in the trace) | 7 | 10 |

Ratings: 5 STRONG (4 favour Fable, 1 Opus), 9 WEAK (7 favour Fable, 2 Opus), 8 NONE.

Time limits: 4 tries ended on the harness timeout, and the verifier still graded what they left. Three were Fable (perry a2 and Rapid-MLX a1 passed, cli-printing-press a1 failed and is counted above as "other" because the reader judged its edits, not the clock, as the visible problem) and one was Opus (cli-printing-press a2, passed).

## Where the label and the readers disagree

The readers judged, blind, whether the issue text names the place the passing fixes changed. They clearly disagreed with the label on three tasks, called two more pointed tasks only partly named, and judged five diagnosis tasks partly named. microsoft__apm-1553 and tursodatabase__turso-7117 are labelled pointed because a changed file path appears somewhere in the instruction (src/apm_cli/install/context.py and core/translate/alter.rs), but the readers judged that the issue text does not point at the fault. harbor-framework__harbor-1764 is labelled diagnosis, but the readers judged the fault named, because the issue names the agent, its variables and the flow to copy, just not the file path. fallow-rs__fallow-821 and microsoft__waza-247 are pointed by the label and "partly" for the readers. A file-path rule is a rough proxy for "has to find the fault", and on these tasks that step was never the hard part anyway.

## Method

- **Export:** [post-run-trace-read/export-blind.py](post-run-trace-read/export-blind.py), adapted from the last read's trace-read/export-blind.py to the Harbor ATIF trajectories in the pack. Per try: verifier grade and reward, harness ending, wall time and tool-call count, the instruction, the trace (assistant text, reasoning cut to 800 characters, tool calls and tool results cut to 900 characters as head and tail, subagent steps marked), and the final message. Model names, model ids, per-step metrics (tokens and cost), final_metrics and context-window fields were dropped, and any string matching a model name or id was replaced with [MODEL]. A grep for fable, opus, claude model ids and fable52 or opus55 over the 88 exported files found no hits before any reader started. The two remaining cost_usd strings are source code inside the harbor-framework repository, not trial data.
- **Labels:** X and Y per task with `random.Random(f"20261114:{task}")` shuffling ["X", "Y"], first to Fable. The key was kept outside the repository, and no reader opened it.
- **Readers:** three Opus 5.5 readers at medium reasoning, on disjoint sets of 8, 7 and 7 tasks, each allowed only the four try files under its tasks' folders. Reads are in [post-run-trace-read/reads/](post-run-trace-read/reads/).
- **Difference from the last read:** the pack has no verifier output, so readers knew only pass or fail, not which hidden test failed. That is why 17 failed tries are "other". Readers are Opus 5.5, one of the two models under test, reading blind; the last read had the same setup.
- **Cost of the read:** the three readers used $4.27 of model time ($1.32, $1.45, $1.50).
