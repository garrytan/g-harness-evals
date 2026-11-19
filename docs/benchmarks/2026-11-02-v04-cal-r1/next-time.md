# Next time: 2026-11-02-v04-cal-r1

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it. It also covers [calibration round 2](../2026-11-02-v04-cal-r2/PREREGISTRATION.md), [round 3](../2026-11-02-v04-cal-r3/PREREGISTRATION.md), [round 4](../2026-11-02-v04-cal-r4/PREREGISTRATION.md) and [the transfer check](../2026-11-02-v04-transfer/PREREGISTRATION.md), which ran under this run's rules.

## Next time

### What we'd change if we ran this again

- Read failing trials against the grader before the first level move, because a grader read after all four rounds found two defects behind most of the recorded verdicts, and 105 of 516 trials moved from fail to pass on regrade.
- Size smoke leases above one full-size Opus reservation, because one reservation at the output-token limit nearly used up the planned smoke lease, and two smokes failed on it.
- Measure the proxy's last reservation on the target model before setting leases, because it ran higher than the preregistration assumed and made round 2's lease stops come sooner, in a round that lost 27 trials to those stops.

### Ideas to improve the eval

- Score the stated answer field instead of excusing mentions in free text, because checks that excused an old value only in the same clause failed correct replies in the corrections and retired-record tasks.
- Add a level harder than L4, because memory scope and session synthesis reached the ceiling at L4, the hardest level the set had.
