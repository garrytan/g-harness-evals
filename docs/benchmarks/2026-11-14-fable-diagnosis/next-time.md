# Next time: 2026-11-14-fable-diagnosis

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Close package registries, module proxies and CDNs to later versions of each task's own code, because they were open, and 4 Fable 5.2 tries and 1 Opus 5.5 try downloaded a later release and then read the files the fix changes.
- Keep egress logs per trial, because without them the transcripts were the only source for counting fetches of the fixed code.
- Keep the machine that runs the shard controllers awake until every shard has finished, because it slept for about five hours mid-run and finished VMs sat idle until they were re-attached, adding about a quarter to the VM time of 10 shards.

### Ideas to improve the eval

- Label whether an issue needs a diagnosis by whether its text names the fault, not only whether it names a changed file, because blind readers clearly disagreed with the file-name label on 3 of the 22 issues they read and partly on 7 more.
- Size the run for the split it tests, because it could detect only a 16-point interaction while the overall lead was 6.5 points.
- Show the blind readers which hidden test each failed try missed, because 17 failed tries had no cause the readers could pin down when they saw only pass or fail.
