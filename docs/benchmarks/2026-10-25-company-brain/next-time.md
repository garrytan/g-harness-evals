# Next time: 2026-10-25-company-brain

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Run every shard from a worktree pinned at the preregistration commit and refuse to resume from any other commit, because after a machine restart the OpenClaw shard resumed from a checkout that had moved on, so its last 65 trials ran under later runner code.
- Save each preflight's console output to a file in the run directory, because one machine's preflight output was never written to a file.
- Copy every shard's harness logs back with its results, because the Hermes shard's adapter logs were not transferred, so the cause of one harness error rests on its exit code alone.

### Ideas to improve the eval

- Count the out-of-scope rows a brain returns, not its refusals, as the sign that scoping works, because member grants filtered results before any harness could ask, so the prediction that scoped cells would show refusals was wrong.
- Add tasks that make a targeted out-of-scope read and a brain write, because no harness tried either, so gbrain's refusal path and the scope of member writes went untested in counted trials.
