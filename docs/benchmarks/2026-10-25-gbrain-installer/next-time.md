# Next time: 2026-10-25-gbrain-installer

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Measure a released gbrain build rather than an open pull request's head, because the installer this run tested was revised right after it, so the number describes an installer that no longer exists.
- Teach the comparison script every new rung before the run starts, because it did not recognise the installer rung and refused on its first pass until a one-line fix.
- Capture the model requests in counted trials, because the run proves the installer's block reached the harness in every trial but cannot say why the model ignored it.

### Ideas to improve the eval

- Back every claim that an installer writes the brain-first instruction with a measured use rate, because the block was injected in every trial yet the bot called gbrain in 0 of 80 primary-task trials on each harness.
