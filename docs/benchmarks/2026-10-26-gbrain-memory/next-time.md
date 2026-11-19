# Next time: 2026-10-26-gbrain-memory

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Record the brain_hot_memory facts in the world's tap before the run, because that block carried the DM preferences Hermes used and the grader never scored those facts for scope.
- Have the controlling machine wait on its running jobs rather than on a plain timer, because it slept for 28 minutes during the launch and killed the launch scripts, and the shards survived only because they ran detached on their VMs.
- Recount every number written in the prose from the receipts before publishing, because a later rerun found that this report's opening says there was no hidden-fact leak where its own secondary-endpoints file counts six.

### Ideas to improve the eval

- Add a predicate for what a harness does with another member's facts already in its context, because the brain put one member's DM facts into a shared channel session and nothing measured whether they reached the next member's answer.
- Build the primary endpoint from tasks with headroom, because 6 or 7 of the 8 primary tasks sat at floor or ceiling, so two tasks moving one way could not clear the sign-flip bar.
