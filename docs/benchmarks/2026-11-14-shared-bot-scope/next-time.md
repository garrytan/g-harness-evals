# Next time: 2026-11-14-shared-bot-scope

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Give each Codex shard's spending lease more headroom than 1.3 times its expected spend, because Codex runs several calls at once, the proxy holds money back for each one, and 14 Codex trials on the cells' last tasks were refused as a result.
- Give the Claude Code group enough trials to resolve the 11-point answer margin on its own, because its smallest detectable difference was 11.3 points, so its per-group rows can't rule out an 11-point cost.
- Have a person reread the trials the grader audit flagged, because the audit's guide asks for that, and this run's audit passes only with 23 overrides that rest on agent rereads, not a person's.

### Ideas to improve the eval

- Test the exposure check against the pinned gbrain build's output before the counted run, because gbrain's new quote marks around returned facts left 81 reads unmapped, and the fix came only after the first analysis.
- Have the event log record the page each gbrain save creates, because 2 reads of a member's own page stayed unmapped, and the labelled arm's 0 of 100 rests on a reading of them that is not yet confirmed.
