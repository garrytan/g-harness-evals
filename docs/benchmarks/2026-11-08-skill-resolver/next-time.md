# Next time: 2026-11-08-skill-resolver

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Make the skill-open counter unwrap every form of deferred call, with a test for each, before the counted run, because OpenClaw opened skills through a deferred `skills_read` call that `got-skill.ts` never unwrapped, and the scrubbed Phase B traces leave no way to recount those setups.
- Let Phase B sessions run past 6 model requests, or run the 50-turn sessions the plan named, because every session ended before the resolver's budget pacing could start, so pacing and the context footprint at turns 10 and 50 went unmeasured.
- Treat "Permission denied" and EACCES as a failed open in the clean-arm counter, because it counted 7 failed reads of a gstack file that no image could read as real reads, and those trials had to be counted back in by our reading of the rule.

### Ideas to improve the eval

- Rerun the no-skill false-suggestion checks on a resolver release that can return an empty block, because the pinned release showed a block on 483 of 483 requests that needed no skill.
- Size the graded task set for the margin it has to settle, because certifying the 2-point margin gbrain's owners asked for needs about 7,000 pairs and set T had 384.
