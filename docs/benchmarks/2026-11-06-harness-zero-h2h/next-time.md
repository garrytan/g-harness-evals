# Next time: 2026-11-06-harness-zero-h2h

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Remove the conflict between the approval-relay tasks and preamble rule 2 before the run, because GPT-6.1 Sol harnesses refused those tasks citing the rule, and lean's 0 of 15 approval-relay passes on Sol came from that conflict rather than a missing skill.
- Run the gbrain cells at 5 repetitions on the task families that need memory across sessions, with lean's notes off in one arm, because at 3 repetitions the half-widths were 11 to 15 points and gains under about 10 points were invisible.
- Let a fact the model saves in a shared channel be recalled by the other members of that channel, because in these gbrain cells a saved fact stayed private to the member whose turn saved it, and a 60-trial rerun with that fixed moved each gbrain reading by 1.7 points.

### Ideas to improve the eval

- Grade only the messages a harness chooses to post, because the runner also graded each harness's closing text, which failed 3 to 7 otherwise correct trials per field harness on Opus and none for lean.
- Read the grader's evidence before naming a failure mode, because the extra recipient on lean's approval-relay drafts was the task's own approver, which is a different finding from copying an outsider.
