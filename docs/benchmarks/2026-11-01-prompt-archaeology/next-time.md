# Next time: 2026-11-01-prompt-archaeology

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Give the VMs a way back in that doesn't depend on one controlling machine, and copy results off each VM while it runs, because the first launch's controller died, its 15 VMs accepted only that machine's SSH key, and they were destroyed with no trial recovered.
- Run every pre-launch script once on a single fresh VM through the same SSH path the fan-out uses, because the second launch stopped every shard at the keyless pre-smoke when the script did not re-enter the docker group in a reused SSH session.
- Map Claude Code's style span by its anchor text rather than its fixed bytes, because that text differed on 4 tasks, so 10.9 percent of the no-style cell's requests were only partly cut and the cell got no verdict.

### Ideas to improve the eval

- Test prompt cuts on tasks the agent can fail, after a cheap check that the tasks leave room to move, because 30 of every 40 trials here sat in families at or near the ceiling or floor, and a cut that looked free on these tasks dropped Claude Code from 60.4% to 0.0% on harder tasks.
- Test the cut layers together as well as one at a time, because layers that cover for each other can each look unneeded when removed alone.
