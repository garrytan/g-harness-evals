# Next time: 2026-10-24-m3-heldout

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Keep held-out task bodies out of the repository until their counted run, because these tasks sat in the repository sealed only by digest, so custody was not independent.
- Make the held-out tasks harder before counting, with more retrieval and judgement items like `si-06`, because 13 of 16 primary tasks were 5 of 5 for all three harnesses and pass rate could not separate them.
- Have a provider admin API key in place before the run, because spend could only be checked against our own proxy's records and the provider-side check was never done.

### Ideas to improve the eval

- Score finding the figure and relaying the request separately in tasks like `os-04`, because a harness that searched badly and one that refused to relay got the same mark.
- Count every opening of a held-out set across runs and treat only the first as confirmatory, because this set went on to serve ten counted runs while the Holm correction applied only within one run.
