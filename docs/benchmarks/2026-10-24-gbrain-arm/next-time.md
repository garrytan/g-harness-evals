# Next time: 2026-10-24-gbrain-arm

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Wait until the previous trial's containers have released their ports before starting QM, because three QM trials with gbrain ended as harness errors when QM's core could not bind a port the previous trial's stack still held.
- Enforce each cell's model at the proxy, not only the allowed routes, because 13 requests in four OpenClaw Haiku trials went to Sonnet while the preregistration said every cell was pinned to one model.
- Run on held-out tasks no earlier run had opened, because this run reused a set another run had already opened, so its results count only as development evidence.

### Ideas to improve the eval

- Keep the request each harness sends to the model, because the receipts hold no request bodies, so whether the model even saw gbrain's tools in the untold cells is inferred from later captures rather than measured.
- Ask the untold question again on a frontier model with a near-zero-use threshold frozen before the run, because this run used only Haiku and Sonnet, so its near-zero use cannot by itself justify dropping the bare install route.
