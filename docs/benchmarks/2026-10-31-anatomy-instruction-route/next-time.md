# Next time: 2026-10-31-anatomy-instruction-route

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Interleave the cells within each shard instead of running each as one block with the control first, because route and time are confounded within a shard.
- Record skill reads in the adapter log, because whether the model read the skill in the route-skill cells was not measured, so those cells only show that the skill was listed.
- Keep the log of every golden-capture attempt, because the first failed attempt's log was overwritten, so its cause is inferred, not shown.

### Ideas to improve the eval

- Add scoped-brain copies of the routes that changed behaviour, because those routes went with more cross-scope read failures and lower pass, and this run did not test whether the pass difference remains with per-member scoping.
- Add a hook cell that sends one copy of the rule per request, because a hook request holds one copy per turn so far and no cell held the copies fixed, so the effect of the extra copies was not isolated.
