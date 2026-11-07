# H10 minimum detectable differences (scripts/paired-mdd.ts --h10)

Written before any counted trial, at the preregistration commit's parent tree. Keyless: simulation on the session structure of the 10 preregistered tasks. Family A uses the stated assumed rates below; family B uses the dev run's control rates (0 of 160 Hermes, 1 of 160 OpenClaw, run anatomy-instruction-route-2026-11). Each block is the command, then its output verbatim.

## Family B alpha 0.0125: Holm first step for a family of 4 contrasts (Claude Code cli, OpenClaw)

```
bun scripts/paired-mdd.ts --h10 --task-set v0.3 --tasks cn-01-tamsin-cold-chain-site,cn-02-tansleigh-packaging-deadline,cn-03-marrow-agrisupply-site,cn-04-quarrendon-site,sc-01-central-random-two-asks,sc-02-north-team-two-asks,cr-01-marrow-agrisupply-site-retraction,cr-02-quarrendon-seat-count-retraction,cr-03-brackenwater-renewal-date-retraction,cr-04-marrow-agrisupply-seat-count --reps 1 --repetition-pairs 4 --placement-pairs 3 --family-b 0,0.00625 --family-b-alpha 0.0125
```

Minimum detectable difference for H10 (internal-task), simulated on the session structure of 10 tasks (v0.3 dev) at 1 repetition(s): 1000 simulations per effect, seed 7, power 0.8; per task the mean over pairs of each pair's mean difference, exact two-sided sign-flip test over tasks; turns independent given the arm (an assumption).

| Task | Member turns | Repeat turns |
|---|---|---|
| cn-01-tamsin-cold-chain-site | 2 | 1 |
| cn-02-tansleigh-packaging-deadline | 3 | 1 |
| cn-03-marrow-agrisupply-site | 4 | 0 |
| cn-04-quarrendon-site | 3 | 1 |
| sc-01-central-random-two-asks | 2 | 1 |
| sc-02-north-team-two-asks | 3 | 1 |
| cr-01-marrow-agrisupply-site-retraction | 3 | 2 |
| cr-02-quarrendon-seat-count-retraction | 3 | 1 |
| cr-03-brackenwater-renewal-date-retraction | 4 | 1 |
| cr-04-marrow-agrisupply-seat-count | 3 | 1 |
| all | 30 | 10 over 9 tasks |

| Contrast | Assumption | Task clusters | Turns per pair | Pairs | Alpha | Smallest possible p | Minimum detectable difference | Power at 10, 20, 30 points |
|---|---|---|---|---|---|---|---|---|
| A: repetition (route-once minus route-hook, repeat turns) | route-hook follows 95% of repeat turns; route-once lower by the effect | 9 | 10 | 4 | 0.025 | 0.0039 | 39 points | 0.03, 0.22, 0.56 |
| A: placement (route-once minus route-system, all member turns) | route-system follows 90% of turns; route-once lower by the effect | 10 | 30 | 3 | 0.025 | 0.0020 | 25 points | 0.19, 0.68, - |
| B: a route against its control (all member turns) | the control follows 0% of turns; the route higher by the effect | 10 | 30 | 1 | 0.0125 | 0.0020 | 48 points | 0.00, 0.04, 0.25 |
| B: a route against its control (all member turns) | the control follows 1% of turns; the route higher by the effect | 10 | 30 | 1 | 0.0125 | 0.0020 | 48 points | 0.00, 0.04, 0.25 |

## Family B alpha 0.025: Holm first step for a family of 2 contrasts (Claude Code SDK preset; the stub-effect family)

```
bun scripts/paired-mdd.ts --h10 --task-set v0.3 --tasks cn-01-tamsin-cold-chain-site,cn-02-tansleigh-packaging-deadline,cn-03-marrow-agrisupply-site,cn-04-quarrendon-site,sc-01-central-random-two-asks,sc-02-north-team-two-asks,cr-01-marrow-agrisupply-site-retraction,cr-02-quarrendon-seat-count-retraction,cr-03-brackenwater-renewal-date-retraction,cr-04-marrow-agrisupply-seat-count --reps 1 --repetition-pairs 4 --placement-pairs 3 --family-b 0,0.00625 --family-b-alpha 0.025
```

Minimum detectable difference for H10 (internal-task), simulated on the session structure of 10 tasks (v0.3 dev) at 1 repetition(s): 1000 simulations per effect, seed 7, power 0.8; per task the mean over pairs of each pair's mean difference, exact two-sided sign-flip test over tasks; turns independent given the arm (an assumption).

| Task | Member turns | Repeat turns |
|---|---|---|
| cn-01-tamsin-cold-chain-site | 2 | 1 |
| cn-02-tansleigh-packaging-deadline | 3 | 1 |
| cn-03-marrow-agrisupply-site | 4 | 0 |
| cn-04-quarrendon-site | 3 | 1 |
| sc-01-central-random-two-asks | 2 | 1 |
| sc-02-north-team-two-asks | 3 | 1 |
| cr-01-marrow-agrisupply-site-retraction | 3 | 2 |
| cr-02-quarrendon-seat-count-retraction | 3 | 1 |
| cr-03-brackenwater-renewal-date-retraction | 4 | 1 |
| cr-04-marrow-agrisupply-seat-count | 3 | 1 |
| all | 30 | 10 over 9 tasks |

| Contrast | Assumption | Task clusters | Turns per pair | Pairs | Alpha | Smallest possible p | Minimum detectable difference | Power at 10, 20, 30 points |
|---|---|---|---|---|---|---|---|---|
| A: repetition (route-once minus route-hook, repeat turns) | route-hook follows 95% of repeat turns; route-once lower by the effect | 9 | 10 | 4 | 0.025 | 0.0039 | 39 points | 0.03, 0.22, 0.56 |
| A: placement (route-once minus route-system, all member turns) | route-system follows 90% of turns; route-once lower by the effect | 10 | 30 | 3 | 0.025 | 0.0020 | 25 points | 0.19, 0.68, - |
| B: a route against its control (all member turns) | the control follows 0% of turns; the route higher by the effect | 10 | 30 | 1 | 0.025 | 0.0020 | 39 points | 0.00, 0.14, 0.50 |
| B: a route against its control (all member turns) | the control follows 1% of turns; the route higher by the effect | 10 | 30 | 1 | 0.025 | 0.0020 | 40 points | 0.00, 0.14, 0.49 |

## Family B alpha 0.0071: Holm first step for a family of 7 contrasts (Codex)

```
bun scripts/paired-mdd.ts --h10 --task-set v0.3 --tasks cn-01-tamsin-cold-chain-site,cn-02-tansleigh-packaging-deadline,cn-03-marrow-agrisupply-site,cn-04-quarrendon-site,sc-01-central-random-two-asks,sc-02-north-team-two-asks,cr-01-marrow-agrisupply-site-retraction,cr-02-quarrendon-seat-count-retraction,cr-03-brackenwater-renewal-date-retraction,cr-04-marrow-agrisupply-seat-count --reps 1 --repetition-pairs 4 --placement-pairs 3 --family-b 0,0.00625 --family-b-alpha 0.0071
```

Minimum detectable difference for H10 (internal-task), simulated on the session structure of 10 tasks (v0.3 dev) at 1 repetition(s): 1000 simulations per effect, seed 7, power 0.8; per task the mean over pairs of each pair's mean difference, exact two-sided sign-flip test over tasks; turns independent given the arm (an assumption).

| Task | Member turns | Repeat turns |
|---|---|---|
| cn-01-tamsin-cold-chain-site | 2 | 1 |
| cn-02-tansleigh-packaging-deadline | 3 | 1 |
| cn-03-marrow-agrisupply-site | 4 | 0 |
| cn-04-quarrendon-site | 3 | 1 |
| sc-01-central-random-two-asks | 2 | 1 |
| sc-02-north-team-two-asks | 3 | 1 |
| cr-01-marrow-agrisupply-site-retraction | 3 | 2 |
| cr-02-quarrendon-seat-count-retraction | 3 | 1 |
| cr-03-brackenwater-renewal-date-retraction | 4 | 1 |
| cr-04-marrow-agrisupply-seat-count | 3 | 1 |
| all | 30 | 10 over 9 tasks |

| Contrast | Assumption | Task clusters | Turns per pair | Pairs | Alpha | Smallest possible p | Minimum detectable difference | Power at 10, 20, 30 points |
|---|---|---|---|---|---|---|---|---|
| A: repetition (route-once minus route-hook, repeat turns) | route-hook follows 95% of repeat turns; route-once lower by the effect | 9 | 10 | 4 | 0.025 | 0.0039 | 39 points | 0.03, 0.22, 0.56 |
| A: placement (route-once minus route-system, all member turns) | route-system follows 90% of turns; route-once lower by the effect | 10 | 30 | 3 | 0.025 | 0.0020 | 25 points | 0.19, 0.68, - |
| B: a route against its control (all member turns) | the control follows 0% of turns; the route higher by the effect | 10 | 30 | 1 | 0.0071 | 0.0020 | 58 points | 0.00, 0.01, 0.07 |
| B: a route against its control (all member turns) | the control follows 1% of turns; the route higher by the effect | 10 | 30 | 1 | 0.0071 | 0.0020 | 59 points | 0.00, 0.01, 0.08 |

## Family B alpha 0.0083: Holm first step for a family of 6 contrasts (Hermes)

```
bun scripts/paired-mdd.ts --h10 --task-set v0.3 --tasks cn-01-tamsin-cold-chain-site,cn-02-tansleigh-packaging-deadline,cn-03-marrow-agrisupply-site,cn-04-quarrendon-site,sc-01-central-random-two-asks,sc-02-north-team-two-asks,cr-01-marrow-agrisupply-site-retraction,cr-02-quarrendon-seat-count-retraction,cr-03-brackenwater-renewal-date-retraction,cr-04-marrow-agrisupply-seat-count --reps 1 --repetition-pairs 4 --placement-pairs 3 --family-b 0,0.00625 --family-b-alpha 0.0083
```

Minimum detectable difference for H10 (internal-task), simulated on the session structure of 10 tasks (v0.3 dev) at 1 repetition(s): 1000 simulations per effect, seed 7, power 0.8; per task the mean over pairs of each pair's mean difference, exact two-sided sign-flip test over tasks; turns independent given the arm (an assumption).

| Task | Member turns | Repeat turns |
|---|---|---|
| cn-01-tamsin-cold-chain-site | 2 | 1 |
| cn-02-tansleigh-packaging-deadline | 3 | 1 |
| cn-03-marrow-agrisupply-site | 4 | 0 |
| cn-04-quarrendon-site | 3 | 1 |
| sc-01-central-random-two-asks | 2 | 1 |
| sc-02-north-team-two-asks | 3 | 1 |
| cr-01-marrow-agrisupply-site-retraction | 3 | 2 |
| cr-02-quarrendon-seat-count-retraction | 3 | 1 |
| cr-03-brackenwater-renewal-date-retraction | 4 | 1 |
| cr-04-marrow-agrisupply-seat-count | 3 | 1 |
| all | 30 | 10 over 9 tasks |

| Contrast | Assumption | Task clusters | Turns per pair | Pairs | Alpha | Smallest possible p | Minimum detectable difference | Power at 10, 20, 30 points |
|---|---|---|---|---|---|---|---|---|
| A: repetition (route-once minus route-hook, repeat turns) | route-hook follows 95% of repeat turns; route-once lower by the effect | 9 | 10 | 4 | 0.025 | 0.0039 | 39 points | 0.03, 0.22, 0.56 |
| A: placement (route-once minus route-system, all member turns) | route-system follows 90% of turns; route-once lower by the effect | 10 | 30 | 3 | 0.025 | 0.0020 | 25 points | 0.19, 0.68, - |
| B: a route against its control (all member turns) | the control follows 0% of turns; the route higher by the effect | 10 | 30 | 1 | 0.0083 | 0.0020 | 48 points | 0.00, 0.04, 0.25 |
| B: a route against its control (all member turns) | the control follows 1% of turns; the route higher by the effect | 10 | 30 | 1 | 0.0083 | 0.0020 | 48 points | 0.00, 0.04, 0.25 |
