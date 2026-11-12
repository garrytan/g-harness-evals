# Restoring a customer database from backup

You'll need access to the ops vault before you start, so check that your account is in the ops-restore group; if it isn't, ask in #ops-access.

## Steps

1. Find the snapshot you want to restore, which will usually be the most recent one taken before the incident started, by running `pgb list --cluster <name>`.
2. Make sure nobody is writing to the database; you should put the app in maintenance mode first if traffic is still coming in.
3. Run `pgb restore --snapshot <id> --target restore-tmp` and wait, since large clusters can take 40 minutes or more to finish restoring.
4. Verify the row counts match the numbers in the snapshot manifest.
5. Confirm with the customer's account manager before switching traffic, e.g. by posting in the account channel.
6. Switch the app's DATABASE_URL to the restored cluster if everything looks good.

Note: It's been known for restores to fail silently when the target disk is full, so ensure there is at least 2x the snapshot size free.
