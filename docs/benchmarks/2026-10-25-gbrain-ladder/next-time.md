# Next time: 2026-10-25-gbrain-ladder

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Run a one-trial smoke at the exact preregistration commit before the shards launch, because a change merged between the smoke and that commit made 36 of the first 44 embedded-rung trials fail the model check, which forced an amendment and a discarded partial cell.
- Make the shard script build every image that preflight checks, because every shard's first launch failed preflight on an image it had not built.
- Let a resumed shard rerun preflight without the original one-time spending limit, because that limit was already closed, so two cells were resumed without rerunning preflight.
- Check the committed files against the report's receipts list before calling the receipts committed, because a repository-wide ignore rule for log files dropped the shard logs this report names.

### Ideas to improve the eval

- Run the semantic search rung under per-member scope, because this run used one bot token and cannot say whether the semantic cross-scope reads would survive per-member tokens.
