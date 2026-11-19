# Next time: 2026-10-24-m3-sensitivity-haiku

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Preregister the second-model cells before the first opening's results are seen, because this Haiku run was preregistered after the Sonnet run's results had merged, so its results can only count as dev.
- Include a frontier-model cell, because the frontier sensitivity cell in the plan was not run and Sonnet and Haiku results are not frontier evidence.
- Allow the same harness utility calls as the run it is compared with, because this run allowed and counted OpenClaw's and QM's own Haiku utility calls while the Sonnet run allowed only the cell's model, so request counts do not line up one for one.

### Ideas to improve the eval

- Add more and harder tasks (retrieval across several channels like `sc-06` and `si-06`, and approval-relay cases) before asking for a pairwise verdict, because 16 tasks at 5 repetitions cannot separate differences under about 20 points and the observed harness gaps were at most 10.
