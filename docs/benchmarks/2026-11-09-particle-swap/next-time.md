# Next time: 2026-11-09-particle-swap

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Set each shard's time limit and controller disk from the slowest cell's smoke, because particle-1 on Hermes averaged 19.5 minutes a trial and hit the 13-hour controller limit at 127 of 156 trials, and a full controller disk stopped another cell at 104 of 156.
- Write the infra rerun rule to cover agent setup timeouts as well as network errors, because seven trials that stopped on a setup timeout fell outside the rule and stay excluded.

### Ideas to improve the eval

- Budget a contamination audit and a blind read for every run on a public benchmark, because web tools were off but the shell could still reach copies of Terminal-Bench on github.com and huggingface.co, and 38 trials looked up the answers.
- Pick tasks with pass data that does not come from a model under test, because the 52 tasks were chosen with DeepSeek's own pass data, which pulls its pass rate down.
- Build brain task sets that pass the headroom gate before pairing a low-cost model against frontier ones, because every brain task family failed the gate twice, once after being regenerated, so both brain use cases read "can't tell".
