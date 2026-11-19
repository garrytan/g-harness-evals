# Next time: 2026-11-01-replicate-validation

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Confirm the machine's setup and Docker are ready before any paid step, and give the image build a timeout, because the first cap-stop attempt hung for 2 hours in the OpenClaw image build with no error code.
- Point --out at a directory inside the checkout, because with it outside, the tool skipped the rerun bundle the preregistration lists.
- Validate on a cell whose model is under test, because the Sonnet 5.5 cell made this run tooling validation only, with nothing to say about OpenClaw.

### Ideas to improve the eval

- Add a cap test where settled spend overshoots a lease, because step 2 exercised only a refused reservation, so the overshoot path went untested.
- Make the equivalence check compare adapter and runner code, because it returned ok with 784 inserted lines in the OpenClaw harness and 6,758 in the runner since the original run, and one repetition inside a wide band cannot show that drift is harmless.
