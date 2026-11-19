# Next time: 2026-11-10-gstack-delivery

The [results report](results/README.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Check every step marker against the graded outcome before freezing the step probe, because the probe could not see the push gstack's /ship makes through its own helper script, so 48 graded-pass skill-arm ship trials read "no push" and the run could make no ship call.
- Set each shard's time limit from the slowest harness and model, because two Hermes shards hit the 15-hour shard timeout with 52 and 62 of 64 trials finished.
- Size each skill arm's lease from that arm's own cost, because sol-codex-skill stopped at its lease on 30 trials, and lease stops fall on the costliest trials, so the skill pairs that remain may not be a random subset.

### Ideas to improve the eval

- Test the hook card on particle-1 in its own preregistered comparison, because it is the only model where a card route's interval cleared 0 (+13.5 points [+5.2, +22.9] on review pass rate), and that reading is secondary and not pooled.
- Make the step probe count only the tool calls a Hermes program actually runs, because it also counts calls inside functions the program defines but never calls (66 such functions in 1,463 programs, counted as an upper bound).
