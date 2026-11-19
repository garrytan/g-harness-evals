# Next time: 2026-10-31-harness-zero-select

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Write and test the analysis code for every preregistered endpoint before the preregistration is frozen, because only the pass-rate comparisons had code when the preregistration merged, so the cost, caching and broken-task rules needed an amendment before the analysis could run.
- Add a GPT-6.1 Sol cell that drops only caching, paired with `zero-full`, and have the proxy record whether each request carried `prompt_cache_key`, because the Sol caching result compared `zero-full` with `zero-min`, which differ in all eleven switches, and no receipt shows the key reached a request.

### Ideas to improve the eval

- Test `tool-search` again on a large tool catalog, because the cut rests on a 15-tool world and both follow-up candidates drop it, so the follow-up run can't retest it.
- Test the prompt layers on harder tasks, after a cheap check that the no-layers arm sits clearly below the top, because scope isolation passed 20 of 20 with and without the layers, so the scope layer had nothing to fix.
- Ablate `output-cap` only on tasks whose tool results pass 8,000 bytes, and count how often the cap fires per trial first, because on these tasks its marker showed up in 1 session file across the seven cells that had it on.
