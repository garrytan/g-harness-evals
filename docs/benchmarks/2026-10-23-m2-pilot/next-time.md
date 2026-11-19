# Next time: 2026-10-23-m2-pilot

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Check before the run that some world tool exposes every fact a task's checks depend on, because `ho-02` failed 15 of 15 when no tool exposed member email addresses and every harness guessed one.
- Test the approval grader against every valid way to name the authorizer, because it rejected six valid approval requests whose pending action named the authorizer's DM channel id instead of the member id.

### Ideas to improve the eval

- Check each task's expected answer against the preamble's rules before the task is used, because `sc-01` expected an answer that the preamble's finance rule forbids, and QM refused it in 5 of 5 trials on exactly that reading.
- Give the world a simulated clock that a harness's scheduler can fire on before scheduled tasks count, because the digest check failed in 30 of 30 scheduled trials and every harness posted the digest at once instead.
- Hand-label a sample of failures before trusting automatic failure labels, because 5 of 30 hand labels disagreed with the first rules until two rule changes, one of which stopped a reply saying it could not find the answer from counting as a refusal.
