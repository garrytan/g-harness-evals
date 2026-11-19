# Next time: 2026-10-25-qm-inner-harness

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Run both cells on the same machine when wall time is compared, because the two cells ran on different machines of the same size, so their wall times compare only loosely.
- Run this comparison on a held-out set no earlier run had opened, because it was the fourth run on these tasks by the adapters' author, so its results count only as dev.

### Ideas to improve the eval

- Use more task clusters that are off ceiling, because with 16 clusters and ten at ceiling in both cells a difference the size observed (+4 points) could not be detected against the preregistered 14.5-point minimum.
