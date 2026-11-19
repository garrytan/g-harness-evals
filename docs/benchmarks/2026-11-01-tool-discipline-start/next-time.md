# Next time: 2026-11-01-tool-discipline-start

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it. It also covers the Hermes rerun, [report-hermes-r2.md](report-hermes-r2.md).

## Next time

### What we'd change if we ran this again

- Check in the smoke that a skill's start command gets through each harness's own approval layer, not only that the hook's note reached the model, because Hermes's Tirith security scan flagged gstack's start preamble and blocked every candidate start before the model's choice mattered.
- Pin the Tirith scanner in the Hermes image, because Hermes downloaded the latest Tirith release at run time in all 72 Hermes trials.
- Run Hermes under an approval setup a real user would have, its one-shot entry or its stock interactive settings, because the preregistered manual approval with a 1-second timeout turned every approval card into a deny and matches neither.

### Ideas to improve the eval

- Use tasks that Opus 5.5 can fail, plus a second task that Hermes routes to a skill, because task success was 16 of 16 in every arm and no Hermes arm opened a skill on task 2 in 48 trials across both runs.
- Score tool discipline from each harness's own transcript, because the committed world and gbrain logs can't see invented tools, malformed world calls or helper commands, and the per-arm classifier rates were not computed.
