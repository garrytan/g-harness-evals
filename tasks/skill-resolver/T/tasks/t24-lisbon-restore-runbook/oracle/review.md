# Review of docs/restore.md for non-native readers

Mode: check only, nothing rewritten in the file. Text is procedural except the final note (descriptive). Verb chosen for the check/verify/confirm/ensure concept: "make sure that". Rule numbers are from the Simplified Technical English rule catalog.

| # | Offending text | Rule | Problem | Compliant rewrite |
|---|---|---|---|---|
| 1 | "You'll need access to the ops vault..." | Rule 4.2 | Contractions ("You'll", "isn't"). | You need access to the ops vault before you start. |
| 2 | "...so check that your account is in the ops-restore group; if it isn't, ask in #ops-access." | Rule 8.1 | Semicolon joins two sentences. | Make sure that your account is in the ops-restore group. If your account is not in this group, ask in #ops-access. |
| 3 | Step 1, 32 words | Rule 5.1 | Over 20 words in a procedural sentence. | Run `pgb list --cluster <name>`. Then find the most recent snapshot from before the incident. |
| 4 | Step 2, "Make sure nobody is writing to the database; you should put the app in maintenance mode first if traffic is still coming in." | Rule 5.2 | Two instructions in one step. | Make sure that no process writes to the database. If traffic still comes in, put the app in maintenance mode. |
| 5 | Step 2, "you should put the app..." | Rule 3.2 | "should" is not an approved verb form. | Put the app in maintenance mode. |
| 6 | Step 2, "...if traffic is still coming in." | Rule 5.4 | Condition after the command. | If traffic still comes in, put the app in maintenance mode. |
| 7 | Step 3, "...and wait, since large clusters can take 40 minutes or more to finish restoring." | Rule 5.2 | Instruction and explanation in one sentence. | Run `pgb restore --snapshot <id> --target restore-tmp`. Wait for the restore to finish. A large cluster can take 40 minutes or more. |
| 8 | Step 4, "Verify the row counts match..." | Rule 9.4 | Synonym rotation: check, make sure, verify, confirm, ensure for one concept. | Make sure that the row counts are the same as the numbers in the snapshot manifest. |
| 9 | Step 5, "Confirm with the customer's account manager..." | Rule 1.11 | Same concept, different word again ("Confirm"). | Before you switch traffic, get approval from the account manager of the customer. Post in the account channel. |
| 10 | Step 5, "e.g." | Rule GR-6 | Latin abbreviation. | Write "for example", or name the action directly. |
| 11 | Step 6, "...if everything looks good." | Rule 5.4 | Condition after the command, and "looks good" is not a check the reader can do. | If the row counts are correct and the account manager approved, switch DATABASE_URL of the app to the restored cluster. |
| 12 | Note, "It's been known for restores to fail silently..." | Rule 3.4 | Present perfect ("has been") and a contraction. | A restore can fail without an error message when the target disk is full. |
| 13 | Note, "...so ensure there is at least 2x the snapshot size free." | Rule 5.5 | A note gives an instruction. | Move the instruction into the steps: "Make sure that the target disk has free space of two times the snapshot size." Keep the note as information only. |

Untouched on purpose: the commands `pgb list`, `pgb restore`, `DATABASE_URL`, `restore-tmp`, `#ops-access`.
