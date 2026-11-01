# Hand check: agreement and classifier accuracy

Two labellers labelled the same 764 items blind: Opus 5.5 (anthropic/claude-opus-5-5) and GPT-6.1 Sol (openai/gpt-6.1-sol). Each followed [LABEL-RULES.md](LABEL-RULES.md) and never saw the classifier's labels or the other's file. Both label files are in [labels.jsonl](labels.jsonl), one line per item per labeller.

## The sample

- **Items:** 729 calls and 35 trials. By stratum: 618 positives (every classifier positive, inclusion probability 1), 46 near misses and 100 random draws. Seed 18, from scripts/tool-discipline/sample.ts.
- **Near misses** are any failed call, any result text with "not found" or "unknown", any `skills_*` tool name, and any gstack helper call.
- **Sources:** 632 items from the world and gbrain event logs, 132 from internal-task.

## Results

"Definite" counts the items where both labellers gave true or false. Classifier counts compare the classifier with the labellers' shared answer, on items where they agreed and the classifier itself was not "unknown".

| Kind | Definite | Labeller unknown | Kappa | Classifier unknown | TP | FP | FN | TN |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| invented tool | 729 | 0 | 1.000 | 16 | 5 | 0 | 0 | 708 |
| bad arguments | 729 | 0 | 1.000 | 16 | 61 | 0 | 0 | 652 |
| wrong name | 726 | 3 | 0.994 | 15 | 487 | 0 | 0 | 222 |
| denied | 729 | 0 | 1.000 | 16 | 32 | 0 | 0 | 681 |
| broken helper | 725 | 4 | n/a (no positives) | 0 | 0 | 0 | 0 | 725 |
| skipped start (trials) | 21 | 14 | 1.000 | 1 | 19 | 0 | 0 | 1 |

## What the numbers do and don't show

- **Classifier unknowns:** the 16 are the discovery run's OpenClaw calls, whose excerpts have no result line.
- **Labeller unknowns on skipped start:** GPT-6.1 Sol marked 14 trials unknown because a clipped shell call might hide a start. Opus judged all of them.
- **The one broken helper call** (the piped start, panel-run-3610 openclaw t2 candidate 4) is clipped in the excerpt. Both labellers rightly could not see it. The classifier settles it from the extractor's `exit_belongs: false` in that run's cells.jsonl, so it is outside this table.
- **The hand check changed the classifier.** Its first version counted OpenClaw's refused reads ("Skill instructions cannot be partially served") as chances to start. Opus flagged the 4 trials, and the rule now excludes refused reads. The table above is for the fixed version.
- **Not independent on the logs.** Event-log rows carry the world's own error codes, which both the classifier and the labellers read. High agreement there checks the written rules, not the data. Recall for kinds the logs cannot see (invented tools, malformed world arguments, helper calls) is not measured, and the README leaves those rates out.

## The two splits and the rule questions the labellers raised

- `files.list` on `members/bettina.kroll` returned ok with 0 files; the real folder is `members/bettina-kroll`. Opus called it a wrong name, Sol did not. The classifier counts only refused calls, so it says no.
- Reading a missing `package.json` inside a shell pipeline that succeeded (discovery, openclaw t2): Sol said wrong name, Opus did not. The classifier marks it unknown.
- **gbrain denials naming invented sources.** Many `scope_denied` `gbrain.remember` calls name sources that do not exist, such as `assistant-dm-pree`, and `permission_denied` searches name sources such as `hollis-mbeki`. The rules count them as denials because gbrain's error is a scope refusal. gbrain could instead say "no such source", which would tell the model what went wrong. That goes to internal-task.
