# Next time: 2026-11-04-matrix-mu

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Run the matrix on harder tasks, after a cheap headroom check shows every cell clearly below the top, because 14 of the 20 v0.3 dev tasks scored the same in all seven cells and each primary pair differed on only 1 to 4 tasks.
- Launch one canary VM first and stagger the image builds, because all seven VMs fetched the same GitHub file within three minutes and two failed their build on rate limits.
- Size OpenClaw's leases from its measured cost per trial, because both OpenClaw cells spent more per trial than the lease formula assumed and ran out of lease on the last task.

### Ideas to improve the eval

- Grade only the messages a harness chooses to post, because the runner also posted each harness's closing text into the channel and graded it, which failed 10 Opus trials that were otherwise correct.
- State each harness's thinking setting beside its row, because the published table mixed three thinking settings without saying so.
