# Next time: 2026-10-25-gbrain-installer-hook

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Add a cell with the new instruction block and no hook, because the block's text, the hook and the gbrain commit all changed between the two installer runs, so this pair of runs cannot say which part turned use on.
- Capture the model requests in counted trials, because the receipts show the hook loaded at startup but cannot show it fired in the process that served each turn.
- Run both cells of a pair on the same machine when wall time matters, because each pair ran on different VMs, so wall time per turn is confounded with the machine.

### Ideas to improve the eval

- Test the installer against told as a noninferiority question on a fresh held-out set, because this run retested a revised installer on tasks already seen, and its installer cells hit 80 of 80, a ceiling that cannot show a tie.
