# Failure mining: layer-2 analysis

Analysis 1.0.0. Rates are per-trial percentages with 95% intervals. Main analysis: verified and unverified labels; sensitivity: verified only.

Tables: candidate labels (particle.jsonl); gated: the candidate passed R78 on gold.

## Label status

| Population | Failed trials | Verified | Unverified | Failed | Missing | Mechanical |
|---|---|---|---|---|---|---|
| default | 784 | 763 | 21 | 0 | 0 | 0 |
| variant | 1090 | 968 | 13 | 4 | 0 | 105 |
| uncounted | 171 | 123 | 1 | 0 | 47 | 0 |

## Regrade

regrade.jsonl at grader commit 25bfe8369b: 134 rows. 105 failed trials in scope regrade to pass and are labelled graded_before_fix (mechanical); 0 rows to pass are out of scope or were not failures; 2 rows to fail and 27 other rows change nothing.

| Population | Run | Overridden |
|---|---|---|
| variant | 2026-11-02-v04-cal-r1 | 22 |
| variant | 2026-11-02-v04-cal-r2 | 37 |
| variant | 2026-11-02-v04-cal-r3 | 30 |
| variant | 2026-11-02-v04-cal-r4 | 9 |
| variant | 2026-11-02-v04-transfer | 7 |

## A. Prevalence

Ranking (default, main; tasks, then harness x model pairs, then trials): unscoped_brain_search, harness_posted_narration, wrong_place, brain_miss, did_not_persist, tool_format_misuse, did_not_look, harness_dropped_reply, found_ignored, cross_scope_read, over_refused, acted_before_approval, gave_up, harness_injected_out_of_scope, leak, unrequested_addition. Repository fixes (group task_or_grader): graded_before_fix, prompt_rule_conflict, grader_defect, unreachable_in_arm.

### default, main

3162 trials (784 failed) in 300 cells and 52 task clusters.

| Class | Trials | Tasks | Harness x model | Rate | 95% interval |
|---|---|---|---|---|---|
| harness_dropped_reply | 3 | 3 | 1 | 0.1 | [0.0, 0.4] |
| did_not_persist | 13 | 6 | 2 | 1.0 | [0.2, 2.1] |
| did_not_look | 48 | 5 | 3 | 1.7 | [0.2, 3.5] |
| brain_miss | 12 | 6 | 3 | 0.3 | [0.1, 0.7] |
| gave_up | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| wrong_place | 348 | 12 | 8 | 12.7 | [4.7, 21.7] |
| found_ignored | 2 | 2 | 2 | 0.0 | [0.0, 0.1] |
| unscoped_brain_search | 127 | 15 | 6 | 2.0 | [1.1, 3.0] |
| cross_scope_read | 21 | 1 | 3 | 0.3 | [0.0, 1.0] |
| harness_injected_out_of_scope | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| acted_before_approval | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| over_refused | 1 | 1 | 1 | 0.1 | [0.0, 0.2] |
| tool_format_misuse | 15 | 6 | 1 | 0.9 | [0.3, 1.7] |
| unrequested_addition | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| leak | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| harness_posted_narration | 57 | 13 | 4 | 2.1 | [0.6, 4.3] |
| unreachable_in_arm | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| prompt_rule_conflict | 107 | 6 | 3 | 4.0 | [1.2, 7.4] |
| graded_before_fix | 25 | 7 | 4 | 0.8 | [0.2, 1.4] |
| grader_defect | 5 | 3 | 4 | 0.2 | [0.0, 0.4] |
| other | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| unlabelled | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |

### default, verified only

3162 trials (784 failed) in 300 cells and 52 task clusters.

| Class | Trials | Tasks | Harness x model | Rate | 95% interval |
|---|---|---|---|---|---|
| harness_dropped_reply | 2 | 2 | 1 | 0.1 | [0.0, 0.2] |
| did_not_persist | 13 | 6 | 2 | 1.0 | [0.2, 2.1] |
| did_not_look | 48 | 5 | 3 | 1.7 | [0.2, 3.5] |
| brain_miss | 12 | 6 | 3 | 0.3 | [0.1, 0.7] |
| gave_up | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| wrong_place | 348 | 12 | 8 | 12.7 | [4.7, 21.7] |
| found_ignored | 2 | 2 | 2 | 0.0 | [0.0, 0.1] |
| unscoped_brain_search | 108 | 15 | 6 | 1.7 | [1.0, 2.5] |
| cross_scope_read | 20 | 1 | 3 | 0.3 | [0.0, 1.0] |
| harness_injected_out_of_scope | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| acted_before_approval | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| over_refused | 1 | 1 | 1 | 0.1 | [0.0, 0.2] |
| tool_format_misuse | 15 | 6 | 1 | 0.9 | [0.3, 1.7] |
| unrequested_addition | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| leak | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| harness_posted_narration | 57 | 13 | 4 | 2.1 | [0.6, 4.3] |
| unreachable_in_arm | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| prompt_rule_conflict | 107 | 6 | 3 | 4.0 | [1.2, 7.4] |
| graded_before_fix | 25 | 7 | 4 | 0.8 | [0.2, 1.4] |
| grader_defect | 5 | 3 | 4 | 0.2 | [0.0, 0.4] |
| other | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| unlabelled | 21 | 11 | 6 | 0.4 | [0.2, 0.6] |

### default, main, regraded trials as passes

3162 trials (784 failed) in 300 cells and 52 task clusters.

| Class | Trials | Tasks | Harness x model | Rate | 95% interval |
|---|---|---|---|---|---|
| harness_dropped_reply | 3 | 3 | 1 | 0.1 | [0.0, 0.4] |
| did_not_persist | 13 | 6 | 2 | 1.0 | [0.2, 2.1] |
| did_not_look | 48 | 5 | 3 | 1.7 | [0.2, 3.5] |
| brain_miss | 12 | 6 | 3 | 0.3 | [0.1, 0.7] |
| gave_up | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| wrong_place | 348 | 12 | 8 | 12.7 | [4.7, 21.7] |
| found_ignored | 2 | 2 | 2 | 0.0 | [0.0, 0.1] |
| unscoped_brain_search | 127 | 15 | 6 | 2.0 | [1.1, 3.0] |
| cross_scope_read | 21 | 1 | 3 | 0.3 | [0.0, 1.0] |
| harness_injected_out_of_scope | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| acted_before_approval | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| over_refused | 1 | 1 | 1 | 0.1 | [0.0, 0.2] |
| tool_format_misuse | 15 | 6 | 1 | 0.9 | [0.3, 1.7] |
| unrequested_addition | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| leak | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| harness_posted_narration | 57 | 13 | 4 | 2.1 | [0.6, 4.3] |
| unreachable_in_arm | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| prompt_rule_conflict | 107 | 6 | 3 | 4.0 | [1.2, 7.4] |
| graded_before_fix | 25 | 7 | 4 | 0.8 | [0.2, 1.4] |
| grader_defect | 5 | 3 | 4 | 0.2 | [0.0, 0.4] |
| other | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| unlabelled | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |

### default, main, by harness

| Class | claude-code | codex | hermes | openclaw | qm |
|---|---|---|---|---|---|
| harness_dropped_reply | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.9 [0.0, 2.3] |
| did_not_persist | 5.3 [1.0, 11.1] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.1 [0.0, 0.3] | 0.0 [0.0, 0.0] |
| did_not_look | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 3.8 [0.5, 8.1] | 3.9 [0.4, 8.3] |
| brain_miss | 1.2 [0.2, 2.6] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.2 [0.0, 0.6] | 0.6 [0.0, 1.7] |
| gave_up | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| wrong_place | 11.1 [4.3, 19.3] | 15.0 [5.0, 27.5] | 13.3 [4.3, 24.2] | 9.9 [3.2, 17.8] | 15.9 [7.1, 25.7] |
| found_ignored | 0.1 [0.0, 0.2] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.1 [0.0, 0.3] |
| unscoped_brain_search | 3.0 [1.3, 5.1] | 1.5 [0.0, 3.5] | 1.9 [1.1, 2.9] | 2.0 [1.0, 3.1] | 1.4 [0.0, 3.9] |
| cross_scope_read | 0.7 [0.0, 2.0] | 0.0 [0.0, 0.0] | 0.5 [0.0, 1.4] | 0.3 [0.0, 1.0] | 0.0 [0.0, 0.0] |
| harness_injected_out_of_scope | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| acted_before_approval | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| over_refused | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.3 [0.0, 0.8] | 0.0 [0.0, 0.0] |
| tool_format_misuse | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 5.8 [1.7, 10.9] |
| unrequested_addition | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| leak | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| harness_posted_narration | 6.0 [1.8, 11.5] | 0.0 [0.0, 0.0] | 2.2 [0.4, 4.6] | 1.1 [0.0, 2.5] | 1.3 [0.0, 4.1] |
| unreachable_in_arm | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| prompt_rule_conflict | 0.0 [0.0, 0.0] | 10.9 [3.3, 20.0] | 5.3 [1.7, 9.8] | 4.1 [1.3, 7.7] | 0.0 [0.0, 0.0] |
| graded_before_fix | 0.8 [0.1, 1.6] | 0.0 [0.0, 0.0] | 0.7 [0.1, 1.5] | 1.2 [0.2, 2.5] | 0.7 [0.0, 1.9] |
| grader_defect | 0.2 [0.0, 0.7] | 0.0 [0.0, 0.0] | 0.1 [0.0, 0.2] | 0.2 [0.0, 0.4] | 0.3 [0.0, 1.1] |
| other | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| unlabelled | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |

### default, main, by model

| Class | claude-opus-5-5 | gpt-6.1-sol |
|---|---|---|
| harness_dropped_reply | 0.3 [0.0, 0.6] | 0.0 [0.0, 0.0] |
| did_not_persist | 1.7 [0.3, 3.6] | 0.0 [0.0, 0.0] |
| did_not_look | 0.2 [0.0, 0.5] | 3.6 [0.5, 7.5] |
| brain_miss | 0.5 [0.1, 0.9] | 0.2 [0.0, 0.6] |
| gave_up | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| wrong_place | 13.4 [5.2, 22.6] | 11.7 [3.8, 20.9] |
| found_ignored | 0.1 [0.0, 0.1] | 0.0 [0.0, 0.0] |
| unscoped_brain_search | 2.9 [1.7, 4.3] | 0.7 [0.1, 1.5] |
| cross_scope_read | 0.6 [0.0, 1.8] | 0.0 [0.0, 0.0] |
| harness_injected_out_of_scope | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| acted_before_approval | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| over_refused | 0.0 [0.0, 0.0] | 0.2 [0.0, 0.5] |
| tool_format_misuse | 1.6 [0.4, 3.0] | 0.0 [0.0, 0.0] |
| unrequested_addition | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| leak | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| harness_posted_narration | 3.7 [1.1, 7.4] | 0.0 [0.0, 0.0] |
| unreachable_in_arm | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| prompt_rule_conflict | 0.0 [0.0, 0.0] | 9.3 [2.9, 17.1] |
| graded_before_fix | 1.3 [0.4, 2.4] | 0.0 [0.0, 0.0] |
| grader_defect | 0.3 [0.0, 0.6] | 0.0 [0.0, 0.0] |
| other | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |
| unlabelled | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] |

### variant, main

3605 trials (1090 failed) in 328 cells and 102 task clusters.

| Class | Trials | Tasks | Harness x model | Rate | 95% interval |
|---|---|---|---|---|---|
| harness_dropped_reply | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| did_not_persist | 209 | 52 | 3 | 11.5 | [8.2, 15.6] |
| did_not_look | 22 | 5 | 4 | 1.0 | [0.2, 1.9] |
| brain_miss | 19 | 6 | 4 | 0.3 | [0.1, 0.7] |
| gave_up | 1 | 1 | 1 | 0.0 | [0.0, 0.1] |
| wrong_place | 424 | 18 | 8 | 7.9 | [2.3, 14.7] |
| found_ignored | 6 | 5 | 2 | 0.3 | [0.1, 0.7] |
| unscoped_brain_search | 12 | 3 | 3 | 0.2 | [0.0, 0.5] |
| cross_scope_read | 40 | 3 | 4 | 0.5 | [0.0, 1.6] |
| harness_injected_out_of_scope | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| acted_before_approval | 1 | 1 | 1 | 0.1 | [0.0, 0.2] |
| over_refused | 1 | 1 | 1 | 0.0 | [0.0, 0.0] |
| tool_format_misuse | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| unrequested_addition | 36 | 6 | 2 | 0.5 | [0.1, 1.0] |
| leak | 1 | 1 | 1 | 0.1 | [0.0, 0.2] |
| harness_posted_narration | 59 | 10 | 4 | 0.9 | [0.2, 2.0] |
| unreachable_in_arm | 14 | 7 | 2 | 1.1 | [0.4, 2.1] |
| prompt_rule_conflict | 85 | 6 | 4 | 3.8 | [1.0, 7.3] |
| graded_before_fix | 144 | 31 | 4 | 7.0 | [4.3, 10.4] |
| grader_defect | 12 | 3 | 3 | 0.2 | [0.0, 0.5] |
| other | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| unlabelled | 4 | 3 | 2 | 0.2 | [0.0, 0.6] |

### variant, verified only

3605 trials (1090 failed) in 328 cells and 102 task clusters.

| Class | Trials | Tasks | Harness x model | Rate | 95% interval |
|---|---|---|---|---|---|
| harness_dropped_reply | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| did_not_persist | 207 | 52 | 3 | 11.5 | [8.2, 15.5] |
| did_not_look | 22 | 5 | 4 | 1.0 | [0.2, 1.9] |
| brain_miss | 18 | 6 | 4 | 0.3 | [0.1, 0.6] |
| gave_up | 1 | 1 | 1 | 0.0 | [0.0, 0.1] |
| wrong_place | 419 | 18 | 8 | 7.8 | [2.2, 14.4] |
| found_ignored | 6 | 5 | 2 | 0.3 | [0.1, 0.7] |
| unscoped_brain_search | 11 | 3 | 3 | 0.2 | [0.0, 0.4] |
| cross_scope_read | 39 | 3 | 4 | 0.5 | [0.0, 1.5] |
| harness_injected_out_of_scope | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| acted_before_approval | 1 | 1 | 1 | 0.1 | [0.0, 0.2] |
| over_refused | 1 | 1 | 1 | 0.0 | [0.0, 0.0] |
| tool_format_misuse | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| unrequested_addition | 36 | 6 | 2 | 0.5 | [0.1, 1.0] |
| leak | 1 | 1 | 1 | 0.1 | [0.0, 0.2] |
| harness_posted_narration | 59 | 10 | 4 | 0.9 | [0.2, 2.0] |
| unreachable_in_arm | 11 | 7 | 2 | 0.9 | [0.3, 1.7] |
| prompt_rule_conflict | 85 | 6 | 4 | 3.8 | [1.0, 7.3] |
| graded_before_fix | 144 | 31 | 4 | 7.0 | [4.3, 10.4] |
| grader_defect | 12 | 3 | 3 | 0.2 | [0.0, 0.5] |
| other | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| unlabelled | 17 | 14 | 6 | 0.7 | [0.3, 1.2] |

### variant, main, regraded trials as passes

3605 trials (985 failed) in 328 cells and 102 task clusters.

| Class | Trials | Tasks | Harness x model | Rate | 95% interval |
|---|---|---|---|---|---|
| harness_dropped_reply | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| did_not_persist | 209 | 52 | 3 | 11.5 | [8.2, 15.6] |
| did_not_look | 22 | 5 | 4 | 1.0 | [0.2, 1.9] |
| brain_miss | 19 | 6 | 4 | 0.3 | [0.1, 0.7] |
| gave_up | 1 | 1 | 1 | 0.0 | [0.0, 0.1] |
| wrong_place | 424 | 18 | 8 | 7.9 | [2.3, 14.7] |
| found_ignored | 6 | 5 | 2 | 0.3 | [0.1, 0.7] |
| unscoped_brain_search | 12 | 3 | 3 | 0.2 | [0.0, 0.5] |
| cross_scope_read | 40 | 3 | 4 | 0.5 | [0.0, 1.6] |
| harness_injected_out_of_scope | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| acted_before_approval | 1 | 1 | 1 | 0.1 | [0.0, 0.2] |
| over_refused | 1 | 1 | 1 | 0.0 | [0.0, 0.0] |
| tool_format_misuse | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| unrequested_addition | 36 | 6 | 2 | 0.5 | [0.1, 1.0] |
| leak | 1 | 1 | 1 | 0.1 | [0.0, 0.2] |
| harness_posted_narration | 59 | 10 | 4 | 0.9 | [0.2, 2.0] |
| unreachable_in_arm | 14 | 7 | 2 | 1.1 | [0.4, 2.1] |
| prompt_rule_conflict | 85 | 6 | 4 | 3.8 | [1.0, 7.3] |
| graded_before_fix | 39 | 9 | 4 | 0.5 | [0.1, 1.1] |
| grader_defect | 12 | 3 | 3 | 0.2 | [0.0, 0.5] |
| other | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| unlabelled | 4 | 3 | 2 | 0.2 | [0.0, 0.6] |

### uncounted, main

296 trials (171 failed) in 200 cells and 60 task clusters.

| Class | Trials | Tasks | Harness x model | Rate | 95% interval |
|---|---|---|---|---|---|
| harness_dropped_reply | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| did_not_persist | 110 | 40 | 3 | 50.1 | [39.4, 61.3] |
| did_not_look | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| brain_miss | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| gave_up | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| wrong_place | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| found_ignored | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| unscoped_brain_search | 2 | 1 | 2 | 0.3 | [0.0, 1.0] |
| cross_scope_read | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| harness_injected_out_of_scope | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| acted_before_approval | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| over_refused | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| tool_format_misuse | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| unrequested_addition | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| leak | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| harness_posted_narration | 7 | 7 | 1 | 3.2 | [1.0, 5.7] |
| unreachable_in_arm | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| prompt_rule_conflict | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| graded_before_fix | 1 | 1 | 1 | 0.2 | [0.0, 0.5] |
| grader_defect | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| other | 4 | 4 | 1 | 1.3 | [0.2, 2.7] |
| unlabelled | 47 | 13 | 4 | 11.5 | [4.8, 19.3] |

### uncounted, verified only

296 trials (171 failed) in 200 cells and 60 task clusters.

| Class | Trials | Tasks | Harness x model | Rate | 95% interval |
|---|---|---|---|---|---|
| harness_dropped_reply | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| did_not_persist | 109 | 40 | 3 | 49.6 | [38.9, 60.7] |
| did_not_look | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| brain_miss | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| gave_up | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| wrong_place | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| found_ignored | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| unscoped_brain_search | 2 | 1 | 2 | 0.3 | [0.0, 1.0] |
| cross_scope_read | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| harness_injected_out_of_scope | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| acted_before_approval | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| over_refused | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| tool_format_misuse | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| unrequested_addition | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| leak | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| harness_posted_narration | 7 | 7 | 1 | 3.2 | [1.0, 5.7] |
| unreachable_in_arm | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| prompt_rule_conflict | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| graded_before_fix | 1 | 1 | 1 | 0.2 | [0.0, 0.5] |
| grader_defect | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| other | 4 | 4 | 1 | 1.3 | [0.2, 2.7] |
| unlabelled | 48 | 14 | 4 | 12.0 | [5.3, 19.8] |

### uncounted, main, regraded trials as passes

296 trials (171 failed) in 200 cells and 60 task clusters.

| Class | Trials | Tasks | Harness x model | Rate | 95% interval |
|---|---|---|---|---|---|
| harness_dropped_reply | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| did_not_persist | 110 | 40 | 3 | 50.1 | [39.4, 61.3] |
| did_not_look | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| brain_miss | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| gave_up | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| wrong_place | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| found_ignored | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| unscoped_brain_search | 2 | 1 | 2 | 0.3 | [0.0, 1.0] |
| cross_scope_read | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| harness_injected_out_of_scope | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| acted_before_approval | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| over_refused | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| tool_format_misuse | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| unrequested_addition | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| leak | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| harness_posted_narration | 7 | 7 | 1 | 3.2 | [1.0, 5.7] |
| unreachable_in_arm | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| prompt_rule_conflict | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| graded_before_fix | 1 | 1 | 1 | 0.2 | [0.0, 0.5] |
| grader_defect | 0 | 0 | 0 | 0.0 | [0.0, 0.0] |
| other | 4 | 4 | 1 | 1.3 | [0.2, 2.7] |
| unlabelled | 47 | 13 | 4 | 11.5 | [4.8, 19.3] |

### Layer-1 primary label by layer-2 class, default, main

| Layer 1 | harness_dropped_reply | did_not_persist | did_not_look | brain_miss | wrong_place | found_ignored | unscoped_brain_search | cross_scope_read | over_refused | tool_format_misuse | harness_posted_narration | prompt_rule_conflict | graded_before_fix | grader_defect |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| action_not_taken | 0 | 0 | 0 | 0 | 0 | 0 | 11 | 0 | 1 | 0 | 0 | 107 | 0 | 0 |
| approval_misrecorded | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 0 | 0 | 0 |
| cross_scope_read | 0 | 0 | 0 | 0 | 0 | 0 | 114 | 21 | 0 | 0 | 0 | 0 | 0 | 0 |
| forbidden_content | 0 | 0 | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | 57 | 0 | 25 | 5 |
| no_reply | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| none | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| read_but_wrong | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| read_not_found | 0 | 11 | 0 | 2 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| refused | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| source_not_read | 0 | 2 | 48 | 10 | 337 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Layer-1 primary label by layer-2 class, variant, main

| Layer 1 | did_not_persist | did_not_look | brain_miss | gave_up | wrong_place | found_ignored | unscoped_brain_search | cross_scope_read | acted_before_approval | over_refused | unrequested_addition | leak | harness_posted_narration | unreachable_in_arm | prompt_rule_conflict | graded_before_fix | grader_defect | unlabelled |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| action_not_taken | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 85 | 0 | 0 | 0 |
| consent_violation | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 |
| cross_scope_read | 0 | 0 | 0 | 0 | 0 | 0 | 12 | 40 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| forbidden_content | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 58 | 0 | 0 | 94 | 12 | 1 |
| forbidden_event | 23 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 48 | 0 | 2 |
| read_but_wrong | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| read_not_found | 47 | 0 | 2 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| refused | 0 | 0 | 1 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| source_not_read | 136 | 22 | 16 | 1 | 420 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 14 | 0 | 0 | 0 | 1 |
| wrong_target | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 36 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## B. gbrain prevention

| Pair | Routes | Units | Trials (brain / none) |
|---|---|---|---|
| 2026-10-31-v03-opus-dev, hermes, claude-opus-5-5 | mcp | 20 | 160 / 60 |
| 2026-10-31-v03-opus-dev, openclaw, claude-opus-5-5 | mcp | 16 | 128 / 48 |
| 2026-11-01-installer-cc-codex, claude-code, claude-opus-5-5 | gbrain-installer, mcp | 17 | 204 / 102 |
| 2026-11-01-installer-cc-codex, codex, gpt-6.1-sol | gbrain-installer, mcp | 17 | 204 / 102 |
| 2026-11-03-qm-c4-told-live, qm, claude-opus-5-5 | mcp/pi, mcp/pi-memory-provider | 8 | 80 / 40 |
| 2026-11-03-qm-c4-told-live, qm, gpt-6.1-sol | mcp/pi, mcp/pi-memory-provider | 8 | 80 / 40 |
| 2026-11-06-harness-zero-h2h, claude-code, claude-opus-5-5 | mcp | 20 | 60 / 100 |

Tested family (Holm, m = 6): did_not_look, gave_up, wrong_place, found_ignored, leak, retrieval_any (did_not_look, brain_miss, gave_up, wrong_place, found_ignored, unscoped_brain_search, cross_scope_read).

### Pooled, main

| Class | Tested | Units | Brain | No brain | Difference | 95% interval | Units worse | p | Holm p | Reading |
|---|---|---|---|---|---|---|---|---|---|---|
| harness_dropped_reply | no | 106 | 0.1 | 0.0 | 0.1 | [0.0, 0.3] | 1 | n/a | n/a | no measurable difference |
| did_not_persist | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| did_not_look | yes | 106 | 1.0 | 2.6 | -1.6 | [-3.4, -0.3] | 0 | 0.1264 | 0.5055 | interval excludes zero but not significant after Holm |
| brain_miss | no | 106 | 2.3 | 0.0 | 2.3 | [0.7, 4.3] | 6 | n/a | n/a | brain-only class: brain-arm rate, descriptive, never tested |
| gave_up | yes | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | 1.0000 | 1.0000 | no measurable difference |
| wrong_place | yes | 106 | 9.1 | 11.3 | -2.1 | [-4.4, 0.2] | 2 | 0.0788 | 0.3940 | no measurable difference |
| found_ignored | yes | 106 | 0.2 | 0.0 | 0.2 | [0.0, 0.4] | 2 | 0.5067 | 1.0000 | no measurable difference |
| unscoped_brain_search | no | 106 | 11.6 | 0.0 | 11.6 | [8.4, 15.1] | 37 | n/a | n/a | brain-only class: brain-arm rate, descriptive, never tested |
| cross_scope_read | no | 106 | 0.5 | 1.4 | -0.9 | [-2.5, 0.1] | 1 | n/a | n/a | no measurable difference |
| harness_injected_out_of_scope | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| acted_before_approval | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| over_refused | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| tool_format_misuse | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| unrequested_addition | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| leak | yes | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | 1.0000 | 1.0000 | no measurable difference |
| harness_posted_narration | no | 106 | 0.7 | 2.5 | -1.8 | [-4.7, 0.6] | 5 | n/a | n/a | no measurable difference |
| unreachable_in_arm | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| prompt_rule_conflict | no | 106 | 0.8 | 2.5 | -1.7 | [-3.9, 0.0] | 0 | n/a | n/a | no measurable difference |
| graded_before_fix | no | 106 | 0.5 | 1.0 | -0.5 | [-1.8, 0.8] | 2 | n/a | n/a | no measurable difference |
| grader_defect | no | 106 | 0.3 | 0.0 | 0.3 | [0.0, 0.9] | 1 | n/a | n/a | no measurable difference |
| other | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| unlabelled | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| retrieval_any | yes | 106 | 24.8 | 15.3 | 9.5 | [5.4, 13.5] | 39 | 0.0002 | 0.0012 | gbrain made this worse |

### Pooled, verified only

| Class | Tested | Units | Brain | No brain | Difference | 95% interval | Units worse | p | Holm p | Reading |
|---|---|---|---|---|---|---|---|---|---|---|
| harness_dropped_reply | no | 106 | 0.1 | 0.0 | 0.1 | [0.0, 0.3] | 1 | n/a | n/a | no measurable difference |
| did_not_persist | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| did_not_look | yes | 106 | 1.0 | 2.6 | -1.6 | [-3.4, -0.3] | 0 | 0.1264 | 0.5055 | interval excludes zero but not significant after Holm |
| brain_miss | no | 106 | 2.3 | 0.0 | 2.3 | [0.7, 4.3] | 6 | n/a | n/a | brain-only class: brain-arm rate, descriptive, never tested |
| gave_up | yes | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | 1.0000 | 1.0000 | no measurable difference |
| wrong_place | yes | 106 | 9.1 | 11.3 | -2.1 | [-4.4, 0.2] | 2 | 0.0788 | 0.3940 | no measurable difference |
| found_ignored | yes | 106 | 0.2 | 0.0 | 0.2 | [0.0, 0.4] | 2 | 0.5067 | 1.0000 | no measurable difference |
| unscoped_brain_search | no | 106 | 9.7 | 0.0 | 9.7 | [7.0, 12.8] | 35 | n/a | n/a | brain-only class: brain-arm rate, descriptive, never tested |
| cross_scope_read | no | 106 | 0.5 | 1.4 | -0.9 | [-2.5, 0.1] | 1 | n/a | n/a | no measurable difference |
| harness_injected_out_of_scope | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| acted_before_approval | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| over_refused | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| tool_format_misuse | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| unrequested_addition | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| leak | yes | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | 1.0000 | 1.0000 | no measurable difference |
| harness_posted_narration | no | 106 | 0.7 | 2.5 | -1.8 | [-4.7, 0.6] | 5 | n/a | n/a | no measurable difference |
| unreachable_in_arm | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| prompt_rule_conflict | no | 106 | 0.8 | 2.5 | -1.7 | [-3.9, 0.0] | 0 | n/a | n/a | no measurable difference |
| graded_before_fix | no | 106 | 0.5 | 1.0 | -0.5 | [-1.8, 0.8] | 2 | n/a | n/a | no measurable difference |
| grader_defect | no | 106 | 0.3 | 0.0 | 0.3 | [0.0, 0.9] | 1 | n/a | n/a | no measurable difference |
| other | no | 106 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 | n/a | n/a | no measurable difference |
| unlabelled | no | 106 | 1.9 | 0.0 | 1.9 | [1.0, 2.9] | 15 | n/a | n/a | higher in the brain arm (descriptive) |
| retrieval_any | yes | 106 | 22.9 | 15.3 | 7.6 | [3.8, 11.3] | 37 | 0.0005 | 0.0030 | gbrain made this worse |

### Brain-only classes: brain-arm rates (descriptive, never tested)

| Class | Brain trials | With class | Rate | No-brain trials with class |
|---|---|---|---|---|
| brain_miss | 916 | 12 | 1.3 | 0 |
| unscoped_brain_search | 916 | 120 | 13.1 | 0 |

### Pair 2026-10-31-v03-opus-dev, hermes, claude-opus-5-5 (descriptive)

| Class | Units | Brain | No brain | Difference | 95% interval | Units worse |
|---|---|---|---|---|---|---|
| harness_dropped_reply | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_persist | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_look | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| brain_miss | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| gave_up | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| wrong_place | 20 | 15.0 | 11.7 | 3.3 | [0.0, 10.0] | 1 |
| found_ignored | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unscoped_brain_search | 20 | 18.1 | 0.0 | 18.1 | [11.3, 25.0] | 13 |
| cross_scope_read | 20 | 1.9 | 1.7 | 0.2 | [0.0, 0.6] | 1 |
| harness_injected_out_of_scope | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| acted_before_approval | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| over_refused | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| tool_format_misuse | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unrequested_addition | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| leak | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_posted_narration | 20 | 1.3 | 3.3 | -2.1 | [-10.0, 2.5] | 2 |
| unreachable_in_arm | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| prompt_rule_conflict | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| graded_before_fix | 20 | 0.0 | 1.7 | -1.7 | [-5.0, 0.0] | 0 |
| grader_defect | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| other | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unlabelled | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| retrieval_any | 20 | 35.0 | 13.3 | 21.7 | [14.0, 29.8] | 14 |

### Pair 2026-10-31-v03-opus-dev, openclaw, claude-opus-5-5 (descriptive)

| Class | Units | Brain | No brain | Difference | 95% interval | Units worse |
|---|---|---|---|---|---|---|
| harness_dropped_reply | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_persist | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_look | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| brain_miss | 16 | 2.3 | 0.0 | 2.3 | [0.0, 7.0] | 1 |
| gave_up | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| wrong_place | 16 | 16.4 | 16.7 | -0.3 | [-7.0, 6.3] | 1 |
| found_ignored | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unscoped_brain_search | 16 | 17.2 | 0.0 | 17.2 | [8.6, 25.8] | 9 |
| cross_scope_read | 16 | 0.0 | 4.2 | -4.2 | [-12.5, 0.0] | 0 |
| harness_injected_out_of_scope | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| acted_before_approval | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| over_refused | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| tool_format_misuse | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unrequested_addition | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| leak | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_posted_narration | 16 | 0.0 | 2.1 | -2.1 | [-6.3, 0.0] | 0 |
| unreachable_in_arm | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| prompt_rule_conflict | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| graded_before_fix | 16 | 0.0 | 2.1 | -2.1 | [-6.3, 0.0] | 0 |
| grader_defect | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| other | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unlabelled | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| retrieval_any | 16 | 35.9 | 20.8 | 15.1 | [6.5, 23.7] | 9 |

### Pair 2026-11-01-installer-cc-codex, claude-code, claude-opus-5-5 (descriptive)

| Class | Units | Brain | No brain | Difference | 95% interval | Units worse |
|---|---|---|---|---|---|---|
| harness_dropped_reply | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_persist | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_look | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| brain_miss | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| gave_up | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| wrong_place | 17 | 0.0 | 2.0 | -2.0 | [-4.9, 0.0] | 0 |
| found_ignored | 17 | 0.5 | 0.0 | 0.5 | [0.0, 1.5] | 1 |
| unscoped_brain_search | 17 | 20.1 | 0.0 | 20.1 | [9.8, 30.4] | 9 |
| cross_scope_read | 17 | 1.0 | 2.9 | -2.0 | [-5.9, 0.0] | 0 |
| harness_injected_out_of_scope | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| acted_before_approval | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| over_refused | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| tool_format_misuse | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unrequested_addition | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| leak | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_posted_narration | 17 | 0.5 | 4.9 | -4.4 | [-14.7, 1.5] | 1 |
| unreachable_in_arm | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| prompt_rule_conflict | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| graded_before_fix | 17 | 1.0 | 0.0 | 1.0 | [0.0, 2.9] | 1 |
| grader_defect | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| other | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unlabelled | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| retrieval_any | 17 | 21.6 | 4.9 | 16.7 | [7.4, 26.5] | 8 |

### Pair 2026-11-01-installer-cc-codex, codex, gpt-6.1-sol (descriptive)

| Class | Units | Brain | No brain | Difference | 95% interval | Units worse |
|---|---|---|---|---|---|---|
| harness_dropped_reply | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_persist | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_look | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| brain_miss | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| gave_up | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| wrong_place | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| found_ignored | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unscoped_brain_search | 17 | 7.8 | 0.0 | 7.8 | [0.0, 16.7] | 3 |
| cross_scope_read | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_injected_out_of_scope | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| acted_before_approval | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| over_refused | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| tool_format_misuse | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unrequested_addition | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| leak | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_posted_narration | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unreachable_in_arm | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| prompt_rule_conflict | 17 | 4.9 | 15.7 | -10.8 | [-23.0, 0.0] | 0 |
| graded_before_fix | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| grader_defect | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| other | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unlabelled | 17 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| retrieval_any | 17 | 7.8 | 0.0 | 7.8 | [0.0, 16.7] | 3 |

### Pair 2026-11-03-qm-c4-told-live, qm, claude-opus-5-5 (descriptive)

| Class | Units | Brain | No brain | Difference | 95% interval | Units worse |
|---|---|---|---|---|---|---|
| harness_dropped_reply | 8 | 1.3 | 0.0 | 1.3 | [0.0, 3.8] | 1 |
| did_not_persist | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_look | 8 | 0.0 | 5.0 | -5.0 | [-15.0, 0.0] | 0 |
| brain_miss | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| gave_up | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| wrong_place | 8 | 25.0 | 32.5 | -7.5 | [-20.0, 0.0] | 0 |
| found_ignored | 8 | 1.3 | 0.0 | 1.3 | [0.0, 3.8] | 1 |
| unscoped_brain_search | 8 | 8.8 | 0.0 | 8.8 | [0.0, 21.3] | 2 |
| cross_scope_read | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_injected_out_of_scope | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| acted_before_approval | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| over_refused | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| tool_format_misuse | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unrequested_addition | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| leak | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_posted_narration | 8 | 1.3 | 0.0 | 1.3 | [0.0, 3.8] | 1 |
| unreachable_in_arm | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| prompt_rule_conflict | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| graded_before_fix | 8 | 5.0 | 0.0 | 5.0 | [0.0, 15.0] | 1 |
| grader_defect | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| other | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unlabelled | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| retrieval_any | 8 | 35.0 | 37.5 | -2.5 | [-21.3, 16.3] | 2 |

### Pair 2026-11-03-qm-c4-told-live, qm, gpt-6.1-sol (descriptive)

| Class | Units | Brain | No brain | Difference | 95% interval | Units worse |
|---|---|---|---|---|---|---|
| harness_dropped_reply | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_persist | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_look | 8 | 13.8 | 30.0 | -16.3 | [-31.3, -3.8] | 0 |
| brain_miss | 8 | 5.0 | 0.0 | 5.0 | [0.0, 15.0] | 1 |
| gave_up | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| wrong_place | 8 | 5.0 | 7.5 | -2.5 | [-7.5, 0.0] | 0 |
| found_ignored | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unscoped_brain_search | 8 | 6.3 | 0.0 | 6.3 | [0.0, 18.8] | 1 |
| cross_scope_read | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_injected_out_of_scope | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| acted_before_approval | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| over_refused | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| tool_format_misuse | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unrequested_addition | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| leak | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_posted_narration | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unreachable_in_arm | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| prompt_rule_conflict | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| graded_before_fix | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| grader_defect | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| other | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unlabelled | 8 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| retrieval_any | 8 | 30.0 | 37.5 | -7.5 | [-26.3, 12.5] | 1 |

### Pair 2026-11-06-harness-zero-h2h, claude-code, claude-opus-5-5 (descriptive)

| Class | Units | Brain | No brain | Difference | 95% interval | Units worse |
|---|---|---|---|---|---|---|
| harness_dropped_reply | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_persist | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_look | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| brain_miss | 20 | 8.3 | 0.0 | 8.3 | [1.7, 16.7] | 4 |
| gave_up | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| wrong_place | 20 | 8.3 | 17.0 | -8.7 | [-15.0, -3.0] | 0 |
| found_ignored | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unscoped_brain_search | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| cross_scope_read | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_injected_out_of_scope | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| acted_before_approval | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| over_refused | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| tool_format_misuse | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unrequested_addition | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| leak | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_posted_narration | 20 | 1.7 | 4.0 | -2.3 | [-12.0, 5.0] | 1 |
| unreachable_in_arm | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| prompt_rule_conflict | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| graded_before_fix | 20 | 0.0 | 2.0 | -2.0 | [-5.0, 0.0] | 0 |
| grader_defect | 20 | 1.7 | 0.0 | 1.7 | [0.0, 5.0] | 1 |
| other | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unlabelled | 20 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| retrieval_any | 20 | 16.7 | 17.0 | -0.3 | [-6.7, 5.7] | 2 |

### Install route gbrain-installer (descriptive)

| Class | Units | Brain | No brain | Difference | 95% interval | Units worse |
|---|---|---|---|---|---|---|
| harness_dropped_reply | 34 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_persist | 34 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_look | 34 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| brain_miss | 34 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| gave_up | 34 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| wrong_place | 34 | 0.0 | 1.0 | -1.0 | [-2.5, 0.0] | 0 |
| found_ignored | 34 | 0.5 | 0.0 | 0.5 | [0.0, 1.5] | 1 |
| unscoped_brain_search | 34 | 14.7 | 0.0 | 14.7 | [7.4, 22.1] | 10 |
| cross_scope_read | 34 | 0.5 | 1.5 | -1.0 | [-2.9, 0.0] | 0 |
| harness_injected_out_of_scope | 34 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| acted_before_approval | 34 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| over_refused | 34 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| tool_format_misuse | 34 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unrequested_addition | 34 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| leak | 34 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_posted_narration | 34 | 0.5 | 2.5 | -2.0 | [-7.4, 1.5] | 1 |
| unreachable_in_arm | 34 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| prompt_rule_conflict | 34 | 1.0 | 7.8 | -6.9 | [-14.7, 0.0] | 0 |
| graded_before_fix | 34 | 0.5 | 0.0 | 0.5 | [0.0, 1.5] | 1 |
| grader_defect | 34 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| other | 34 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unlabelled | 34 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| retrieval_any | 34 | 15.7 | 2.5 | 13.2 | [6.4, 20.6] | 10 |

### Install route mcp (descriptive)

| Class | Units | Brain | No brain | Difference | 95% interval | Units worse |
|---|---|---|---|---|---|---|
| harness_dropped_reply | 90 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_persist | 90 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_look | 90 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| brain_miss | 90 | 2.3 | 0.0 | 2.3 | [0.4, 4.5] | 5 |
| gave_up | 90 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| wrong_place | 90 | 8.1 | 9.7 | -1.6 | [-4.0, 0.9] | 2 |
| found_ignored | 90 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unscoped_brain_search | 90 | 12.1 | 0.0 | 12.1 | [8.5, 15.8] | 33 |
| cross_scope_read | 90 | 0.6 | 1.7 | -1.1 | [-3.0, 0.1] | 1 |
| harness_injected_out_of_scope | 90 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| acted_before_approval | 90 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| over_refused | 90 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| tool_format_misuse | 90 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unrequested_addition | 90 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| leak | 90 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_posted_narration | 90 | 0.6 | 2.9 | -2.3 | [-5.7, 0.4] | 3 |
| unreachable_in_arm | 90 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| prompt_rule_conflict | 90 | 1.5 | 3.0 | -1.5 | [-3.3, 0.0] | 0 |
| graded_before_fix | 90 | 0.2 | 1.2 | -1.0 | [-2.4, 0.1] | 1 |
| grader_defect | 90 | 0.4 | 0.0 | 0.4 | [0.0, 1.1] | 1 |
| other | 90 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unlabelled | 90 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| retrieval_any | 90 | 23.1 | 11.4 | 11.7 | [7.8, 15.7] | 35 |

### Install route mcp/pi (descriptive)

| Class | Units | Brain | No brain | Difference | 95% interval | Units worse |
|---|---|---|---|---|---|---|
| harness_dropped_reply | 16 | 1.3 | 0.0 | 1.3 | [0.0, 3.8] | 1 |
| did_not_persist | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_look | 16 | 0.0 | 17.5 | -17.5 | [-36.3, -2.5] | 0 |
| brain_miss | 16 | 5.0 | 0.0 | 5.0 | [0.0, 15.0] | 1 |
| gave_up | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| wrong_place | 16 | 6.3 | 20.0 | -13.7 | [-30.0, -2.5] | 0 |
| found_ignored | 16 | 1.3 | 0.0 | 1.3 | [0.0, 3.8] | 1 |
| unscoped_brain_search | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| cross_scope_read | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_injected_out_of_scope | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| acted_before_approval | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| over_refused | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| tool_format_misuse | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unrequested_addition | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| leak | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_posted_narration | 16 | 1.3 | 0.0 | 1.3 | [0.0, 3.8] | 1 |
| unreachable_in_arm | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| prompt_rule_conflict | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| graded_before_fix | 16 | 5.0 | 0.0 | 5.0 | [0.0, 15.0] | 1 |
| grader_defect | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| other | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unlabelled | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| retrieval_any | 16 | 12.5 | 37.5 | -25.0 | [-45.0, -7.5] | 0 |

### Install route mcp/pi-memory-provider (descriptive)

| Class | Units | Brain | No brain | Difference | 95% interval | Units worse |
|---|---|---|---|---|---|---|
| harness_dropped_reply | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_persist | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| did_not_look | 16 | 13.8 | 17.5 | -3.8 | [-10.0, 0.0] | 0 |
| brain_miss | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| gave_up | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| wrong_place | 16 | 23.8 | 20.0 | 3.8 | [0.0, 10.0] | 2 |
| found_ignored | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unscoped_brain_search | 16 | 15.0 | 0.0 | 15.0 | [0.0, 33.8] | 3 |
| cross_scope_read | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_injected_out_of_scope | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| acted_before_approval | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| over_refused | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| tool_format_misuse | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unrequested_addition | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| leak | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| harness_posted_narration | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unreachable_in_arm | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| prompt_rule_conflict | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| graded_before_fix | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| grader_defect | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| other | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| unlabelled | 16 | 0.0 | 0.0 | 0.0 | [0.0, 0.0] | 0 |
| retrieval_any | 16 | 52.5 | 37.5 | 15.0 | [0.0, 33.8] | 3 |

### Minimum detectable difference

| Scope | Units | Trials (brain / none) | MDD at 2% | MDD at 5% | MDD at 10% | Holm first step (m=6) at 2% | Holm first step (m=6) at 5% | Holm first step (m=6) at 10% |
|---|---|---|---|---|---|---|---|---|
| 2026-10-31-v03-opus-dev, hermes, claude-opus-5-5 | 20 | 160 / 60 | 6.1 | 9.5 | 13.1 | 7.6 | 11.8 | 16.2 |
| 2026-10-31-v03-opus-dev, openclaw, claude-opus-5-5 | 16 | 128 / 48 | 6.9 | 10.7 | 14.7 | 8.5 | 13.3 | 18.2 |
| 2026-11-01-installer-cc-codex, claude-code, claude-opus-5-5 | 17 | 204 / 102 | 4.9 | 7.6 | 10.5 | 6.1 | 9.5 | 13.0 |
| 2026-11-01-installer-cc-codex, codex, gpt-6.1-sol | 17 | 204 / 102 | 4.9 | 7.6 | 10.5 | 6.1 | 9.5 | 13.0 |
| 2026-11-03-qm-c4-told-live, qm, claude-opus-5-5 | 8 | 80 / 40 | 8.1 | 12.6 | 17.4 | 10.1 | 15.7 | 21.6 |
| 2026-11-03-qm-c4-told-live, qm, gpt-6.1-sol | 8 | 80 / 40 | 8.1 | 12.6 | 17.4 | 10.1 | 15.7 | 21.6 |
| 2026-11-06-harness-zero-h2h, claude-code, claude-opus-5-5 | 20 | 60 / 100 | 6.6 | 10.2 | 14.1 | 8.2 | 12.7 | 17.5 |
| pooled | 106 | 916 / 492 | 2.4 | 3.7 | 5.1 | 2.9 | 4.6 | 6.3 |

## C. Brain called or not (descriptive)

| Group | Trials | Failed |
|---|---|---|
| called | 781 | 209 |
| not_called | 167 | 45 |
| unknown | 0 | 0 |

## D. gstack (descriptive)

Verdict: not exposed in this corpus. Multi-user default trials with gstack: 0.

- gstack: 4 failed SDK sessions; root causes {"other":4}; gstack_role {"not_loaded":2,"loaded_not_followed":2}
- none: 4 failed SDK sessions; root causes {"other":4}; gstack_role {"absent":4}
- placebo: 4 failed SDK sessions; root causes {"other":4}; gstack_role {"absent":4}

## E. Labeller check (R78)

Candidate: passes; layer 2: gated.
Gold n 179. Candidate kappa 0.9357 over all 179 gold trials (178 labelled, coverage 0.9944; an unlabelled gold trial counts as a disagreement). Gold labellers kappa 0.8813 over the 200-trial gold sample (200 and 200 labelled; a missing label is a disagreement).

| Class | Gold | Labelled | Catch rate | Others | Others labelled | False-assignment rate |
|---|---|---|---|---|---|---|
| acted_before_approval | 0 | 0 | n/a | 179 | 178 | 0.0000 |
| brain_miss | 2 | 2 | 1.0000 | 177 | 176 | 0.0000 |
| cross_scope_read | 9 | 9 | 1.0000 | 170 | 169 | 0.0000 |
| did_not_look | 11 | 11 | 1.0000 | 168 | 167 | 0.0000 |
| did_not_persist | 29 | 28 | 0.9655 | 150 | 150 | 0.0000 |
| found_ignored | 3 | 3 | 1.0000 | 176 | 175 | 0.0000 |
| gave_up | 0 | 0 | n/a | 179 | 178 | 0.0000 |
| graded_before_fix | 12 | 12 | 0.6667 | 167 | 166 | 0.0000 |
| grader_defect | 1 | 1 | 1.0000 | 178 | 177 | 0.0000 |
| harness_dropped_reply | 0 | 0 | n/a | 179 | 178 | 0.0000 |
| harness_injected_out_of_scope | 5 | 5 | 0.0000 | 174 | 173 | 0.0000 |
| harness_posted_narration | 9 | 9 | 1.0000 | 170 | 169 | 0.0235 |
| leak | 0 | 0 | n/a | 179 | 178 | 0.0000 |
| other | 0 | 0 | n/a | 179 | 178 | 0.0000 |
| over_refused | 0 | 0 | n/a | 179 | 178 | 0.0000 |
| prompt_rule_conflict | 25 | 25 | 1.0000 | 154 | 153 | 0.0000 |
| tool_format_misuse | 6 | 6 | 1.0000 | 173 | 172 | 0.0000 |
| unlabelled | 0 | 0 | n/a | 179 | 178 | 0.0056 |
| unreachable_in_arm | 0 | 0 | n/a | 179 | 178 | 0.0000 |
| unrequested_addition | 6 | 6 | 1.0000 | 173 | 172 | 0.0000 |
| unscoped_brain_search | 18 | 18 | 1.0000 | 161 | 160 | 0.0311 |
| wrong_place | 43 | 43 | 1.0000 | 136 | 135 | 0.0000 |

Test-retest subsets (seed 2024): particle:particle-1 100, anthropic:claude-opus-5-5 40 (listed in analysis.json; analyze.ts --retest-ids prints them).
Test-retest particle-1: n 98, agreement 0.9184, kappa 0.9049.
Test-retest claude-opus-5-5: n 40, agreement 1.0000, kappa 1.0000.

## Verdicts

- gbrain: see B (labeller gated)
- gstack: not exposed in this corpus
