# harness-evals

**Which AI agent harness should you use with a frontier model?** We hold the model (Opus 5.5 or GPT-6.1 Sol) and the tasks fixed, swap only the harness (system prompt, tools, memory), and measure pass rate, cost per solved task and time.

## Harness rankings

Two task sets, each ranked on its own. **Never compare numbers across task sets:** different tasks give different pass rates. Within each model, rows are ranked by cost per solved task, and rows whose cost ranges overlap share a rank. Brackets are 95% ranges.

### 52 public Terminal-Bench 2.1 coding tasks (frontier-harness-2026-11)

Each harness was compared only with its model's home harness: Claude Code on Opus 5.5, Codex on GPT-6.1 Sol. Each cell scored 102 to 104 trials (52 tasks, 51 for Pi, two tries each). **One pair was behind on pass rate: OpenClaw on Opus, against Claude Code.** The other five passed within 15 points, though the difference intervals against the home harness for Hermes and Pi on Opus, and OpenClaw on Sol, sit wholly below zero. The ranking is by cost per solved task, whatever the pass rate.

**Opus 5.5**

| Rank | Harness | Pass rate [95% range] | Cost per solved task [95% range] | Median time per trial |
|---|---|---|---|---|
| 1 | Pi | 81.4% [71.6%, 90.2%] | $0.62 [$0.35, $0.95] | 196.4 s |
| 1 | Claude Code | 88.5% [79.8%, 96.2%] | $0.63 [$0.41, $0.89] | 252.0 s |
| 1† | OpenClaw | 76.0% [64.4%, 86.5%] | $0.88 [$0.57, $1.29] | 287.8 s |
| 1 | Hermes Agent | 81.7% [72.1%, 91.3%] | $0.88 [$0.54, $1.38] | 427.0 s |

†Behind Claude Code on pass rate, the run's one preregistered "behind" call. It shares rank 1 on cost only.

**GPT-6.1 Sol**

| Rank | Harness | Pass rate [95% range] | Cost per solved task [95% range] | Median time per trial |
|---|---|---|---|---|
| 1 | Pi | 80.4% [70.6%, 90.2%] | $0.23 [$0.17, $0.31] | 220.5 s |
| 1 | Codex | 83.7% [74.0%, 92.3%] | $0.34 [$0.25, $0.46] | 279.2 s |
| 1* | Hermes Agent | 85.6% [76.9%, 93.3%] | $0.43 [$0.31, $0.60] | 438.5 s |
| 1* | OpenClaw | 76.0% [64.4%, 86.5%] | $0.61 [$0.40, $0.95] | 325.6 s |

*Hermes Agent's and OpenClaw's cost ranges clear Pi's (Hermes's starts just above Pi's top; both round to $0.31), but they overlap Codex's, so they share Codex's rank.

- These are dev results on public tasks at the pinned versions, not held-out confirmation. The cost differences are descriptive, with no test.
- Claude Code and Codex are each model's own harness. They can't run the same model, so they are never compared with each other.
- Every cell is a plain harness: no gstack, no gbrain.
- OpenClaw on Opus's behind call depends on two choices: with every provider refusal removed, or under amendment 4's outage classification alone, it is inconclusive.
- Under amendment 4's outage classification alone, 3 of 6 calls change: OpenClaw on Opus becomes inconclusive, OpenClaw on Sol becomes behind, and Pi on Sol becomes inconclusive.
- A GitHub outage hit 353 runs at grade time (kept sample included). 351 were rerun and replaced; the lease stopped the other 2 reruns, so those 2 trials are excluded, though both runs' spend stays in cost. Cost per solved task leaves out the replaced runs' spend, and their passes aren't counted either.
- Claude Code on Opus is near the ceiling, so there is little room above it.
- 4 Hermes trials (2 in these cells) are scored as fails because Hermes's web tools reached the answer key.
- Pi's pairs have 51 tasks: one task crashes Pi's adapter.
- Trials ran 4 at a time per VM, so time per trial is contended.
- A planned matrix that adds particle-1 next to these frontier models will extend these rankings.
- Full tables and receipts: [scoreboard](docs/scoreboard.md) and [frontier report](docs/benchmarks/2026-11-07-frontier-harness/report.md).

### 20 public v0.3 multi-user dev tasks (matrix-mu-2026-11)

Pass rates couldn't be told apart in any tested pair on these 20 public multi-user tasks (QM's pairs were not tested; a gap under 7.7 to 14.2 points could hide), so the ranking is cost and speed. Rows whose cost ranges overlap share a rank.

**Opus 5.5**

| Rank | Harness | Pass rate [95% range] | Cost per solved task [95% range] | Median time per trial |
|---|---|---|---|---|
| 1 | QM (Pi loop) | 72.5% [53.8%, 88.8%] | $0.19 [$0.13, $0.28] | 40.1 s |
| 1 | Claude Code | 76.3% [57.5%, 92.5%] | $0.22 [$0.16, $0.30] | 40.1 s |
| 1 | Hermes Agent | 78.8% [60.0%, 95.0%] | $0.24 [$0.18, $0.36] | 64.6 s |
| 1* | OpenClaw | 76.3% [58.8%, 91.3%] | $0.44 [$0.33, $0.63] | 99.4 s |

*OpenClaw's range overlaps only Hermes Agent's ($0.33 against $0.36), so it shares Hermes's rank. It clears Claude Code's and QM's ranges, and it has the highest cost point estimate on Opus (descriptive, no test).

**GPT-6.1 Sol**

| Rank | Harness | Pass rate [95% range] | Cost per solved task [95% range] | Median time per trial |
|---|---|---|---|---|
| 1 | Codex | 71.3% [51.2%, 90.0%] | $0.17 [$0.12, $0.26] | 30.1 s |
| 1 | Hermes Agent | 75.0% [56.3%, 91.3%] | $0.19 [$0.14, $0.28] | 81.5 s |
| 1 | OpenClaw | 73.7% [53.9%, 90.8%] | $0.22 (interval basis $0.20 [$0.13, $0.30]) | 83.6 s |

- These are dev results on public tasks at the pinned versions, not held-out confirmation. The cost differences are descriptive, with no test.
- Claude Code and Codex are each model's own harness. They can't run the same model, so they are never compared with each other.
- Every cell is a plain harness: no gstack, no gbrain. Cost per solved task is the cell's whole spend at list price through our metering proxy, divided by its scored passes; spend includes excluded trials.
- On Sol, OpenClaw's headline cost is $0.22. Its interval uses each trial record's own cost, which leaves out one timed-out charge logged after its trial closed.
- QM ran on the default Docker bridge, so its network was not held fixed and its comparisons are untested. QM uses Haiku for housekeeping (its shipped default, metered in its cost).
- Both OpenClaw cells are incomplete: the last task's reps ended in a cap stop (two reps on Opus, all four on Sol). On Sol that task drops from its comparisons.
- Full tables and receipts: [scoreboard](docs/scoreboard.md) and [matrix report](docs/benchmarks/2026-11-04-matrix-mu/report.md).

## Claude Code (Opus 5.5)

- **Cheap and fast.** $0.22 per solved task and 40.1 s per trial, and $0.165 less per trial than OpenClaw on Opus [-$0.206, -$0.128] at the same pass rate in a separate cost breakdown run ([finding](findings/harness-cost/README.md)).
- **A rule in the system prompt or startup file reached every turn.** A "check gbrain first" rule was followed in 30 of 30 turns from either, 26 of 30 from a per-turn hook, against 18 of 30 with no rule (descriptive: 10 public tasks, one repetition, command line) ([finding](findings/rule-placement/README.md)).
- **It doesn't open skills on its own.** An unmentioned skill was opened 0 times in 30 turns. Adding "Use the brain-first skill." to the prompt got 30 of 30, against 18 for the unmentioned skill and 17 for no rule (descriptive) ([finding](findings/rule-placement/README.md)).
- **Its memory text and tool advice, together, matter on hard tasks.** On easy tasks, dropping its memory-and-skills text cut cost per trial 19% ($0.033 [-$0.046, -$0.022]) with no measurable pass change. On harder tasks, dropping it together with its tool-description advice took pass rate from 60.4% to 0.0% (-60.4 points [-79.2, -39.6]); the two were cut together, so the loss can't be pinned on one ([finding](findings/prompt-cuts/README.md)).
- **With gbrain, pass rate recovered once access rules were on.** With per-member access rules it passed 50 of 51 (installer) and 49 of 51 (told) against 46 with no brain; with one bot-wide token, 27 and 31. The gains over no brain are descriptive, every interval reaches zero, and gbrain's version also changed between the runs ([finding](findings/shared-brain-access/README.md)).

## Codex (GPT-6.1 Sol)

- **Lowest point estimate and fastest on Sol (sharing rank 1).** $0.17 per solved task and 30.1 s per trial. In the separate cost breakdown run it was $0.023 cheaper per trial than Hermes [-$0.030, -$0.016] and, barely, $0.107 cheaper than OpenClaw [-$0.270, -$0.002] ([finding](findings/harness-cost/README.md)).
- **It follows a rule wherever it sits.** 30 of 30 turns from a per-turn hook, the system prompt or the startup file, against 6 of 30 with no rule ([finding](findings/rule-placement/README.md)).
- **An unmentioned skill worked.** 30 of 30 turns ([finding](findings/rule-placement/README.md)).
- **Its identity text is a small cut on easy tasks.** Removing it (639 bytes per request) cut cost per trial 3% ($0.004 [-$0.007, -$0.001]) with pass unchanged; it is untested on hard tasks ([finding](findings/prompt-cuts/README.md)).
- **With gbrain and access rules, no out-of-scope reads.** 0 of 51 trials returned a record the asker may not read; the pass gain over no brain (+12 points [+0, +24] with the installer) is descriptive ([finding](findings/shared-brain-access/README.md)).

## OpenClaw (Opus 5.5 and GPT-6.1 Sol)

- **About twice the cost on Opus.** $0.44 per solved task against $0.19 to $0.24 for the other Opus harnesses, and the slowest at 99.4 s per trial (descriptive, no test) ([finding](findings/harness-cost/README.md)).
- **The money goes to cache writes.** About 81% of its extra cost over Claude Code on Opus is cache writes: it re-sends a much bigger system prompt and bigger tool results. On Sol, most of its gap to Codex is output (282,492 output tokens against 32,226), and $0.036 per trial of it is one timed-out stream charged at its full reservation ([finding](findings/harness-cost/README.md)).
- **On Sol, it follows per-turn rules, and an unmentioned skill worked.** 30 of 30 turns from a per-turn hook or the startup file (it has no system-prompt setting), and 29 of 30 from an unmentioned skill. A rule given once was followed in 4 of 10 repeat turns (descriptive; the test could only detect a 39-point gap) ([finding](findings/rule-placement/README.md)).
- **Its minimal prompt is a lead, not proof.** On Opus it cut $0.023 per trial with pass +7.5 points on easy tasks; the retest on harder tasks hit the floor, so it is untested there ([finding](findings/prompt-cuts/README.md)).

## Hermes Agent (Opus 5.5 and GPT-6.1 Sol)

- **Shares rank 1 on cost on both models.** $0.24 per solved task on Opus (64.6 s) and $0.19 on Sol (81.5 s) ([finding](findings/harness-cost/README.md)).
- **It sends more per request on Sol.** 423 kB more tool schemas per trial and 16.7 requests per trial against Codex's 11.6, which is why it costs $0.023 more per trial than Codex ([finding](findings/harness-cost/README.md)).
- **On Sol, it obeys the hook and the system prompt, not skills.** 30 of 30 turns from either; an unmentioned skill did nothing (4 of 30, the same as no rule, opened 0 times). A rule given once was followed in 2 of 10 repeat turns (descriptive; the test could only detect a 39-point gap) ([finding](findings/rule-placement/README.md)).
- **Prompt cuts mostly hit a safety keep.** 5 of its 7 cut arms were kept under the safety rule, all resting on one task where Opus read outside the asker's scope in every harness ([finding](findings/prompt-cuts/README.md)).

## QM (Pi loop, Opus 5.5)

- **Lowest point estimate for cost per solved task on Opus, sharing rank 1.** $0.19 [$0.13, $0.28], tied fastest at 40.1 s ([finding](findings/harness-cost/README.md)).
- **Cheaper per trial than Claude Code.** Claude Code cost $0.041 more per trial [+$0.020, +$0.061] ([finding](findings/harness-cost/README.md)).
- **Caveat:** QM ran on the default Docker bridge, not the internal network. Its matrix comparisons are untested, and its cost-run contrast with Claude Code did not hold the network fixed ([finding](findings/harness-cost/README.md)).

## gstack and gbrain

- **gstack: Opus 5.5 read gstack's skills but didn't follow them.** Told to run gstack's /investigate, /qa, /review or /ship, Opus loaded the skill text every time and ran none of its steps: 0 of 46 gstack sessions across three uncounted checks, at about twice the cost per trial of no gstack (dev). The tasks were easy for Opus (every arm passed 14 of 16 dev tasks; the hard check was void), so this shows the steps weren't followed, not whether following them helps. The cost ratio is a point estimate, with no interval ([finding](findings/2026-11-02-opus-gstack-steps-not-followed.md)).
- **gbrain needs per-person access rules.** With one bot-wide token, gbrain reads returned records the asker wasn't allowed to see in 33, 20, 17 and 9 of 51 trials; with per-member access rules, 0 of 51 in all four cells ([finding](findings/shared-brain-access/README.md)).
- **Put the "check gbrain first" rule where the agent sees it every turn.** On GPT-6.1 Sol, a per-turn hook reached 30 of 30 turns on Codex, Hermes and OpenClaw, and so did the system prompt on Codex and Hermes and the startup file on OpenClaw. Following it cost 10% to 55% more per turn (descriptive) with no pass-rate gain, and with no access rules on the brain, more searches also meant more reads the asker wasn't allowed to see (12 trials) ([finding](findings/rule-placement/README.md)).

Run the keyless checks yourself: `git clone https://github.com/garrytan/g-harness-evals.git`, then the commands in [CONTRIBUTING.md](CONTRIBUTING.md#run-the-keyless-checks).

<a id="corrections"></a>How we test and write reports: [docs/report-standard.md](docs/report-standard.md). Every run: [docs/reports-index.md](docs/reports-index.md). Every correction: [docs/corrections.md](docs/corrections.md).

## Disclosures

The repository and the evaluation are run by Garry Tan. gbrain-evals, which supplies the task world, is his project too. Every harness ran the same tasks, graders, preamble and model through the same proxy, and the receipts are in the tree so anyone can regrade. Still weigh the gstack, gbrain and QM rows with the lines below in mind.

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.
