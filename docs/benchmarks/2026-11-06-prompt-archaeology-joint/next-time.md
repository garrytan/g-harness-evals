# Next time: 2026-11-06-prompt-archaeology-joint

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Plan the main run for the precision the probe can actually give, because the probe's minimum detectable difference came out at 29.1 points at the Holm alpha against the planned 15 to 18, so a small or moderate loss could have hidden.
- Test the OpenClaw and Codex cuts on tasks their full arms can pass, for example with a memory-backed arm, because both full arms passed 0 of 12, so the one attempt to raise the ceiling hit the floor and those cuts are still untested on hard tasks.
- Give the probe's OpenClaw and Codex shards enough lease for their validity cells, because all 3 validity trials in each were cut short by the shard's cap stop.

### Ideas to improve the eval

- Add a cell that removes each Claude Code layer on its own beside the joint cut, because no cell removed tool-descriptions alone, so the joint loss can't be pinned on one layer.
