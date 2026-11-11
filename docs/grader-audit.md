# Grader audit: read a sample of failed trials before results publish

**What it does.** Before a run's results publish, `scripts/grader-audit.ts` picks up to 10 failed trials from every arm at random and has a model from another family read each one. For each trial it answers one question: did the bot really get it wrong, did the grader make a mistake, or is the task itself broken? If too many answers in one arm are "grader mistake" or "task broken", the audit fails and the results PR isn't ready.

**Why.** Pass rates are only as good as the grader behind them. An outside audit on 2026-11-09 found three published rows that were off because a check failed correct answers or a task contradicted the bot's own rules. Each was visible in about ten minutes of reading failed trials. This makes that reading a step nobody can skip.

## Run it

```
bun scripts/grader-audit.ts --run docs/benchmarks/<run> --lease-usd 30
```

- It writes `grader-audit.md` (for people) and `grader-audit.json` (for the check) beside the run's `report.md`. Commit both in the results PR.
- Reader calls go through the metering proxy under the lease you pass. It makes about one call per sampled trial. The first two runs it read cost $4.10 (7 arms, 72 calls) and $10.04 (15 arms, 151 calls). Answers are cached, and a rerun on the same trials keeps every answer the committed `grader-audit.json` already has, so no trial can be asked again for a different answer while that file is kept. Deleting it, or running with another cache, asks the reader again, and only the git history shows that.
- `bun scripts/grader-audit.ts --check --run docs/benchmarks/<run>` needs no key. It redraws the sample, confirms the files match it and the trials, and fails if the audit failed. `bun test tests/` runs the same check on every committed audit.

## How it decides

- **Which trials.** A failed trial is one the report counts as failed: scored (not a model, infrastructure or exam error) and not a clean pass. Failed trials with no event log or no failed check, such as a harness crash, are counted in the table but not read. Up to 10 of the rest are drawn per arm, ordered by a hash of the run folder's name and the trial id, so anyone gets the same draw. You can raise the count with `--per-arm`, never lower it.
- **Who reads.** Trials run on a Claude model are read by GPT-6 Astra. Trials run on a GPT model are read by Claude Opus 5.5. Any other family is read by GPT-6 Astra. The reader never grades its own family.
- **What it sees.** The prompt the bot was given on turn 1 (its standing rules and the first request), every request and reply, every world event (with the messages the test runner posted for the bot marked), and each failed check with the grader's evidence and the task file's definition. It must quote the trial to back its answer; an answer whose quote isn't in the trial is sent back once.
- **When an arm fails.** At least 3 sampled trials flagged as grader mistakes or broken tasks, and more than 20% of the arm's sample. Any sampled trial that got no valid answer also fails the arm. You can lower the 20% with `--max-share`, never raise it.
- **Flagged more than once.** A task and check flagged in two or more trials anywhere in the run is listed at the top for a person to read. A broken check usually fails every arm that meets it.

## What a failing audit means

- Read the trials under "Trials to reread". If the reader is right, don't publish the affected rows until the check or task is fixed and the run regraded (with a dated correction).
- If the reader is wrong, add a line to `<run>/grader-audit-overrides.jsonl` and run the audit again (it costs nothing, since every answer is kept):

```
{"trial_id": "<run>/<cell>/<task>/r1", "verdict": "real_failure", "reason": "It never posted the digest.", "by": "<who reread it>"}
```

  Your verdict counts. The audit shows it beside the reader's.

## What it can't do

- **It is a tripwire, not a measurement.** Its answers point a person at trials worth rereading. They are never a published number, and the reader has not been checked against labelled answers.
- **Ten trials per arm only see big problems.** If a check is wrong in half of an arm's failures, the audit catches it about 95% of the time. At a third, about 70%. At a fifth, about 32%. A rare grader bug will usually slip through.
- **It will raise some false alarms.** A reader that wrongly flags 1 real failure in 10 trips a given arm about 7% of the time, so a run with 20 arms sees a false trip most of the time. A person's reread clears it.
- **Private and held-out tasks are refused.** The audit quotes trial text into a public file. A run on held-out tasks, or one whose trials or tasks the public copy leaves out, stops with an error, and you commit a `grader-audit.na.json` with a plain `"reason"` instead.
- **Only multi-user runs.** Runs without per-trial event logs (Harbor coding runs, for example) can't be read. They need a `grader-audit.na.json` too.
- **It reads the trials as recorded** unless you pass `--regraded`, which reads the grades in `results/trials.regraded.jsonl` instead, the way the report does.
- **It sees one trial, not the whole workspace.** It can't look up who belongs to which channel or which files exist. In its first two runs it called at least 6 trials "task broken" or "grader mistake" because the bot said it couldn't find something, when the file or channel the bot needed was there and visible to the person asking. Check claims like "the bot couldn't see it" before you act on them.
- **It holds the bot to what the test runner posted for it.** When a harness ends a turn with a summary for whoever launched it, the runner posts that summary into the channel, and the reader judges it as the bot's own message. In the first two runs it called 2 such summaries that repeated a private DM real failures. Whether that text should count is a grading-rule question: if the report corrects for it, audit with `--regraded`.
- **Readers can disagree on a judgement call.** Where two of the bot's rules pull against each other, the reader picks a side. In those runs Claude Opus 5.5 sided with the grader on 25 of the 26 GPT-6.1 Sol approval-relay failures it read, though an earlier hand reading of the same tasks found the rules conflict. A passing audit doesn't clear a task a person already flagged.

## Which runs need one

Every run folder dated 2026-11-12 or later, once it has `results/trials.jsonl` and a `report.md`, needs a passing `grader-audit.json` or a `grader-audit.na.json` with a reason. `tests/grader-audit.test.ts` fails otherwise. Older runs are not audited after the fact. One run published after this page was written but before the gate reached main, so it is not audited: `2026-11-10-harness-zero-h2h-recall-rerun`.

## Later

- Turn every confirmed grader mistake into a test fixture, so the same hole can't reopen.
- Check the reader against the failure-mining study's labelled trials once those labels exist.
