# Next time: 2026-10-30-host-harness-pilot

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Set OpenClaw's memory search to keyword only in its OpenAI config before the run, because its memory indexer asked for an embedding model the proxy refused, and 11 of 100 gpt-6-luna trials ended model_error.
- Run the told cells on a per-member scoped brain, because every told cross-scope failure came from a gbrain search or query row served under the bot-wide grant, so told minus none mixes the scoping problem with gbrain's effect.
- Put a timeout on the harness image build and install from lockfiles, because one OpenClaw build stalled 43 minutes in npm install and had to be killed by hand, and without lockfiles the nine builds may have resolved different dependency versions.

### Ideas to improve the eval

- Use more than 20 tasks for harness-pair comparisons, because with 20 task clusters and Holm over six, a difference needs task-level deltas pointing one way in at least eight tasks with none the other way, and no pair was distinguished.
- Write the analysis that applies the preregistered exclusions before the run, because the default comparison tool keeps model_error trials, so the six comparisons had to come from a new script after the run.
