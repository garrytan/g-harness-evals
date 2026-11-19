# Next time: 2026-11-07-frontier-harness

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Score a trial only after checking that its tests ran, with a signature that covers every download the verifier makes, because a GitHub outage left 353 trials graded 0 with no test run, the first signature missed 35 of them, and reclassifying those 35 flipped 3 of 6 verdicts.
- Decide on purpose whether Hermes's built-in web tools are on, because they are on by default and returned the answer key in 4 trials.
- Put `--` before the task instruction in Harbor's Pi adapter, because Pi exits before any model request when an instruction starts with `- `, which cost it one task on both models.

### Ideas to improve the eval

- Choose tasks on which the model's own harness is not near the ceiling, because Claude Code on Opus passed 90.4% at stage 0 and only 29 of the 52 tasks could separate harnesses, which compressed every Opus gap.
- Test the lease bookkeeping across stages before a run plans reruns, because the rerun lease check replaced a trial's first-run spend instead of adding to it and undercounted what each shard had already spent.
