# Next time: 2026-11-09-fable-5-2-coding

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Run Fable 5.2 on a Claude Code version that knows the model, because Claude Code 2.1.312 logged `unrecognized_model` in all 104 Fable 5.2 attempts, assumed a 200K-token window and compacted 3 attempts early.
- Give the egress proxy a read timeout longer than 15 seconds, because it cut 24 slow Fable 5.2 calls that Claude Code then resent, and the cut calls were still billed.
- Build the analysis script to follow every amendment rule before any data arrives, because it scored two Fable 5.1 attempts that the time stop cut off as fails, and it missed three amendment 1 lines that a script written after the data had to compute.
- Commit every arm's Claude Code transcripts and logs with the results, because the safety-filter stops were first reported before their transcripts were in the tree, and the later rerun on Claude Code 2.1.322 could not compare peak context or compaction for Fable 5.1 and Opus 5.5.

### Ideas to improve the eval

- Compare a new model with Opus 5.5 on a harder test-scored task set, because Opus solved 89.4% of these tasks, so Fable 5.2 had at most about 11 points to gain against a smallest detectable gap of about 10 points, and a win was close to impossible to show.
- Use a larger task set to compare Fable 5.2 with Fable 5.1, because the run could reliably catch only about 16 points and the observed gap was +4.9.
