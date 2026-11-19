# Next time: 2026-11-review-real-bugs

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it. It also covers [stage 2](stage2/report.md).

## Next time

### What we'd change if we ran this again

- Test the exposure check on real /review session logs before the preregistration freezes, because the pinned rule never saw the skill open and read 0 of 178 passes as exposed, so it had to be widened by amendment.
- Make the trial image able to run /review's second-model reader, because the image had no bubblewrap, so that reader never ran in any of the 178 review passes and /review was tested without it.
- Let stage 1's judges read the repository from the start, because the blind judges' rulings disagreed with fix-aware labels (kappa 0.012) and false blockers stayed unmeasured until stage 2 re-judged them.

### Ideas to improve the eval

- Size each run from a pilot of the plain prompt on bugs from the same sources, because the plain prompt's catch rate depends on where the bugs came from: one plain pass flagged 25.9% of outside bugs as blocking but 10.9% of home-field bugs.
- Fix the severity guidance /review gives a GPT host before rerunning GPT-6.1 Sol, because Sol marked 82% of its /review findings CRITICAL, so "blocking" stopped meaning blocking.
- Rerun particle-1 in OpenClaw with a /review that does not start readers OpenClaw can't run, and a parser that knows OpenClaw's retry rows, because no reader report came back in any pass and 50 transcripts were flagged as tampered after rate-limit retries.
