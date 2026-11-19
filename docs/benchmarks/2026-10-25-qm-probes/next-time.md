# Next time: 2026-10-25-qm-probes

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- List every input the product reads on each probe's path and check in the smoke that the rig supplies each one, because `qp-07` passed 0 of 3 on both QM cells only because the rig never filled the channel directory QM reads membership from.

### Ideas to improve the eval

- Have the summary script read the per-trial memory snapshots and sandbox manifests, because telling a failed probe from one that was not exercised had to be worked out by hand.
- Add memory probes at QM's shipped 180 s capture quiet time and across a process restart, because these probes used 5 s and a new session only, so they do not show what a user on the defaults sees.
