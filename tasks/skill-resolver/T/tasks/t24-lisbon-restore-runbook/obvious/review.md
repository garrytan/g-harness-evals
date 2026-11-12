# docs/restore.md: sentences that will trip up second-language readers

1. **"You'll need access to the ops vault before you start, so check that your account is in the ops-restore group; if it isn't, ask in #ops-access."**
   Problem: long, two contractions, a semicolon joining two ideas.
   Fix: "You need access to the ops vault. Check that your account is in the ops-restore group. If it is not, ask in #ops-access."

2. **Step 1** is one 30-word sentence with a nested clause.
   Fix: "Run `pgb list --cluster <name>`. Pick the newest snapshot taken before the incident started."

3. **Step 2** mixes two actions and puts the condition at the end; "should" sounds optional.
   Fix: "If traffic is still coming in, put the app in maintenance mode. Then check that nothing is writing to the database."

4. **Step 3** hides the wait time in a "since" clause.
   Fix: "Run `pgb restore --snapshot <id> --target restore-tmp`. Wait until it finishes. Large clusters can take 40 minutes or more."

5. **Steps 2, 4 and 5** use "make sure", "verify" and "confirm" for similar things, which reads like three different tasks.
   Fix: use "check" everywhere for checking, and "ask" for getting the account manager's approval.

6. **Step 5** uses "e.g.", which many readers do not know.
   Fix: "for example".

7. **Step 6**: "if everything looks good" is vague and comes after the command.
   Fix: "If the row counts match and the account manager agreed, switch the app's DATABASE_URL to the restored cluster."

8. **The note** uses "It's been known" (idiom plus contraction) and hides an instruction.
   Fix: "Restores can fail without an error when the target disk is full. Before step 3, check that the disk has at least twice the snapshot size free."
