# Next time: 2026-11-01-waterfall-frontier

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Size the smoke lease for every call a harness can have in flight at once, because OpenClaw on GPT-6.1 Sol ran two calls together, overran its smoke lease and needed a smoke relaunch.
- Run QM on the same internal network as the other cells, because it ran on the default Docker bridge, so the network was not held fixed in the QM contrast.
- Make each VM shut itself down when its shard ends or stalls, instead of waiting for the controlling machine, because after the two controller losses VMs sat idle for about 5 to 6 hours.

### Ideas to improve the eval

- Rework the avoidable-pattern check so it follows what Claude Code keeps stable across requests, because it matched 0 of 426 of Claude Code's cache-writing requests, so three of its six patterns were not measured for Claude Code.
- Test each proposed savings lever in its own matched follow-up, because this run tests no lever, and the high end of the Opus estimate for unused tool schemas is a ceiling above what those cells billed in total, not a saving.
