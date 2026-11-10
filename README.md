# harness-evals

**Which AI agent harness should you use with a frontier model?** A harness is the program wrapped around a model: its system prompt, its tools and its memory. Claude Code and Codex are harnesses. We keep the model (Claude Opus 5.5 or GPT-6.1 Sol) and the tasks the same, swap only the harness, and measure how often it solves each task, what each solved task costs, and how long it takes.

**Every harness in the rankings is a plain install, with no gstack and no gbrain added.** gstack (a pack of workflow skills for coding agents) and gbrain (a shared memory agents can search) are Garry Tan's own projects, and we test them separately, [below](#gstack-and-gbrain).

## What we found

- **Harnesses differed more on cost than on how often they solved tasks. Compare them on cost per solved task, on your own work.** We compared each harness with the model's own harness (Claude Code for Opus, Codex for Sol). On 52 coding tasks, five of the six passed within 15 points of it (though for three of them the whole 95% range of the gap sits below zero), and OpenClaw on Opus fell behind Claude Code (a fragile call: it becomes inconclusive under one outage rule alone, amendment 4, or with refusals removed). On 20 multi-user tasks, no pair we tested differed in pass rate (QM's pairs weren't tested, and a gap smaller than 7.7 to 14.2 points could hide). Cost varied more: on those multi-user tasks, OpenClaw on Opus cost about twice as much per solved task as the other Opus harnesses (no statistical test), mostly from context it re-sends on every request ([finding](findings/harness-cost/README.md), [coding report](docs/benchmarks/2026-11-07-frontier-harness/report.md)).
- **Agents followed a rule far more often when they saw it on every turn. Put a must-follow rule in the system prompt or a per-turn hook, and name any skill you rely on.** A "check gbrain first" rule placed there was followed in 30 of 30 turns on several harnesses (26 of 30 through Claude Code's hook). A skill nobody mentioned could sit unread: Claude Code opened one 0 times in 30 turns ([finding](findings/rule-placement/README.md)).
- **What didn't work: gstack's skills didn't change what Opus 5.5 did.** Told to run gstack's /investigate, /qa, /review or /ship, Opus read the skill text every time and followed none of its steps (0 of 46 sessions), at about twice the cost per try. The tasks were easy for Opus, so this shows the steps weren't followed, not whether following them would help ([finding](findings/2026-11-02-opus-gstack-steps-not-followed.md)).

## Harness rankings

Two sets of tasks, each ranked on its own. **Don't compare numbers between the two sets:** different tasks give different pass rates, and cost is counted slightly differently in each (see the notes under each set).

How to read the tables:

- **Rank** compares harnesses on the same model by cost per solved task. Harnesses whose cost ranges overlap share a rank.
- **[low, high]** is a 95% range: given how many tasks we ran, the true number is very likely inside it.
- **"Within 15 points", "behind" and "can't tell apart"** come from pass-rate tests we fixed before the run, not from subtracting the numbers shown. See [Words we use](#words-we-use).
- **A try** is one attempt at one task. "Median time per trial" is the typical time for one try.
- The name in brackets after each heading is the run's id, which names its folder of results.

### Coding: 52 public Terminal-Bench 2.1 tasks (frontier-harness-2026-11)

Each harness was compared only with the model's own harness: Claude Code on Opus 5.5, Codex on GPT-6.1 Sol. Each row is 102 to 104 tries (52 tasks, 51 for Pi, two tries each). **One harness fell behind on pass rate: OpenClaw on Opus, against Claude Code.** The other five passed within 15 points of the model's own harness, though for Hermes and Pi on Opus, and OpenClaw on Sol, the whole 95% range of the gap sits below zero. Rank is by cost per solved task, whatever the pass rate.

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

*OpenClaw's cost range clears Pi's. Hermes Agent's starts just above Pi's top as published ($0.3114 against $0.3068). It starts below Pi's top under the 2026-11-09 correction ($0.29, or $0.2813 with both corrections) and at the 15 s cut's upper bound ($0.3052), but not at that cut's lower bound alone ($0.3108), so whether Hermes's and Pi's ranges overlap depends on the correction. Hermes's and OpenClaw's ranges overlap Codex's either way, so all four rows share rank 1.

Notes on these numbers:

- These tasks are public, and we could see them while building, so these are early ("dev") results, not a confirmation on hidden tasks. They hold for the harness versions we pinned. The cost differences are measured, with no statistical test.
- Claude Code and Codex each belong to their own model maker and can't run the same model, so we never compare them with each other.
- Every cell is a plain harness: no gstack, no gbrain. Settings: every harness ran at effort high, set through its own setting.
- **Corrected 2026-11-09:** cost per solved task no longer counts reservation charges. When a model's streamed reply ends without reporting its usage, our metering proxy (the relay that records every model call and its price) charges the request's full reserved amount, which isn't what the harness used. On Sol: Codex $0.31 [$0.23, $0.40], Hermes Agent $0.38 [$0.29, $0.51], OpenClaw $0.50 [$0.37, $0.68], Pi unchanged. Every Sol row still shares rank 1, and Hermes Agent's range now overlaps Pi's. Opus is unchanged ([correction](docs/corrections/2026-11-09/README.md)).
- **Corrected 2026-11-10:** on Sol, our egress sidecar (the container that outgoing requests pass through) cut off Hermes Agent's slow, non-streamed calls at 15 s, and the run still paid for them. Without those charges, its cost per solved task is $0.4247 [$0.3052, $0.5854], or $0.3741 [$0.2813, $0.4964] with the 2026-11-09 correction too. Only 7 of the 39 cut requests were sent again and 32 were not, so these figures show the largest possible correction: the true effect lies between removing $0.10 and removing $0.68 of charges. No other row was cut, and no result or rank changes either way ([correction](docs/corrections/2026-11-10/README.md)).
- OpenClaw on Opus's "behind" result is fragile. It turns into "can't tell" if we drop every try the model provider refused, or if we classify the GitHub-outage tries under amendment 4's outage rule alone (see the outage note below).
- Under amendment 4's outage rule alone, 3 of the 6 results change: OpenClaw on Opus becomes "can't tell", OpenClaw on Sol becomes "behind", and Pi on Sol becomes "can't tell".
- A GitHub outage hit 353 tries while they were being graded (counting the 8 extra tasks the run reports separately). 351 were rerun and replaced. The run's spending limit stopped the other 2 reruns, so those 2 tries are left out, though the spend of both tries stays in cost. Cost per solved task leaves out the spend of the replaced tries, and their passes aren't counted either.
- Claude Code on Opus scores near the top possible, so there is little room above it.
- 4 Hermes tries (2 in these rows) are scored as fails, because Hermes's web tools reached the answer key.
- Pi's comparisons use 51 tasks: on pytorch-model-recovery, Pi exited before sending any request, so the preregistered rules (fixed before the run) leave that task out of its comparisons. Scored as Pi fails instead, Pi passes 79.8% [69.2%, 89.4%] on Opus and 78.8% [68.3%, 88.5%] on Sol, and both stay within 15 points of the home harness, on Opus only just (Holm-adjusted p 0.043, a p-value corrected for running several tests) ([correction](docs/corrections/2026-11-10/README.md)).
- Tries ran 4 at a time on each machine, so each try shared its machine with three others, which affects the times.
- A planned run that adds particle-1, a low-cost model, next to these frontier models will extend these rankings.
- Full tables and receipts: [scoreboard](docs/scoreboard.md) and [frontier report](docs/benchmarks/2026-11-07-frontier-harness/report.md).

### Multi-user: 20 public tasks from task set v0.3 (matrix-mu-2026-11)

In these tasks the agent is the chat bot of a simulated company, answering several people in turn. We couldn't tell pass rates apart in any pair we tested (QM's pairs weren't tested, and a gap smaller than 7.7 to 14.2 points could hide here), so compare these harnesses on cost and speed. Harnesses whose cost ranges overlap share a rank.

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

Notes on these numbers:

- These tasks are public, and we could see them while building, so these are early ("dev") results, not a confirmation on hidden tasks. They hold for the harness versions we pinned. The cost differences are measured, with no statistical test.
- Claude Code and Codex each belong to their own model maker and can't run the same model, so we never compare them with each other.
- Every cell is a plain harness: no gstack, no gbrain. Cost per solved task is everything a row spent at list price, as logged by our metering proxy (a relay that records every model call and its price), divided by its passes. That spend includes tries left out of scoring.
- On Sol, OpenClaw's cost per solved task is $0.22. Its 95% range is worked out from each try's own recorded cost, which misses one charge for a timed-out request logged after its try ended. That is the "interval basis $0.20" in its row.
- QM ran on Docker's default network instead of our internal one, so its network wasn't held fixed, and its comparisons weren't tested. QM uses Haiku for small housekeeping calls (its shipped default, included in its cost).
- Both OpenClaw rows are incomplete: the spending limit cut off tries on the last task (2 of 4 on Opus, all 4 on Sol). On Sol that task drops out of OpenClaw's comparisons.
- **Each harness ran with its shipped settings, and they differ:** Claude Code and OpenClaw on Opus use adaptive thinking (the model chooses how much to think) at effort medium, QM adaptive thinking at effort low, and Hermes Agent no thinking. Every Sol row uses reasoning effort medium. So these rows mix harness design with effort level.
- **Corrected 2026-11-09:** two problems on our side held back harnesses that did nothing wrong. Our runner posted each harness's closing message into the chat channel and graded it as a reply, and the v0.3 excuse check (which looks for replies that make excuses) matched ordinary sentences and failed some correct replies. Corrected Opus passes: QM 60/80 (75.0%), Claude Code 64/80 (80.0%), Hermes Agent 66/80 (82.5%), OpenClaw 67/78 (86.3%, the average of per-task pass rates; the raw share is 85.9%). Cost per solved task: $0.18, $0.21, $0.23 and $0.40. OpenClaw on Sol without reservation charges is $0.17 [$0.12, $0.26] ($0.171, against Codex's $0.165, so Codex keeps the lowest cost estimate on Sol by under a cent). No result or rank changes ([correction](docs/corrections/2026-11-09/README.md)).
- **Time per try includes our rig** (the setup that starts and stops each harness). Median time spent in turns, with the harness working: QM 24.0 s, Claude Code 39.0 s, Hermes Agent 63.4 s, OpenClaw 91.5 s on Opus; Codex 28.9 s and OpenClaw 75.7 s on Sol.
- Full tables and receipts: [scoreboard](docs/scoreboard.md) and [matrix report](docs/benchmarks/2026-11-04-matrix-mu/report.md).

## What we learned about each harness

These notes draw on several runs, each linked. Numbers from different runs come from different tasks, so read each one against its own run.

### Claude Code (Opus 5.5)

- **Cheap and fast.** $0.22 per solved task and 40.1 s per try on the multi-user tasks. In a separate run that broke down where the money goes, it cost $0.165 less per try than OpenClaw on Opus [-$0.206, -$0.128] at the same pass rate ([finding](findings/harness-cost/README.md)).
- **A rule in the system prompt or the startup file reached every turn.** A "check gbrain first" rule was followed in 30 of 30 turns from either, 26 of 30 from a per-turn hook, and 18 of 30 with no rule (no statistical test: 10 public tasks, one try each, Claude Code run from the command line) ([finding](findings/rule-placement/README.md)).
- **It doesn't open skills on its own.** A skill nobody mentioned was opened 0 times in 30 turns. Adding "Use the brain-first skill." to the prompt got the rule followed in 30 of 30 turns, against 18 with the unmentioned skill (followed without ever opening it) and 17 with no rule (no statistical test) ([finding](findings/rule-placement/README.md)).
- **Its memory text and tool advice, together, matter on hard tasks.** On easy tasks, removing the memory-and-skills text from its built-in prompt cut cost per try 19% ($0.033 [-$0.046, -$0.022]) with no measurable change in pass rate. On harder tasks, removing it together with the advice in its tool descriptions took pass rate from 60.4% to 0.0% (-60.4 points [-79.2, -39.6]). The two were removed together, so we can't say which one caused the loss ([finding](findings/prompt-cuts/README.md)).
- **With gbrain, pass rate recovered once access rules were on.** With per-person access rules it passed 50 of 51 (gbrain set up by its installer) and 49 of 51 (gbrain described in the prompt) against 46 with no gbrain. With one shared token for the whole bot, it passed 27 and 31. The gains over no gbrain have no statistical test, every 95% range reaches zero, and gbrain's version also changed between the runs ([finding](findings/shared-brain-access/README.md)).

### Codex (GPT-6.1 Sol)

- **Lowest cost estimate on Sol, and the fastest.** $0.17 per solved task and 30.1 s per try, though its cost range overlaps the other Sol harnesses'. In the separate cost breakdown run it was $0.023 cheaper per try than Hermes [-$0.030, -$0.016] and, barely, $0.107 cheaper than OpenClaw [-$0.270, -$0.002] ([finding](findings/harness-cost/README.md)).
- **It follows a rule wherever it sits.** 30 of 30 turns from a per-turn hook, the system prompt or the startup file, against 6 of 30 with no rule ([finding](findings/rule-placement/README.md)).
- **A skill nobody mentioned still worked.** 30 of 30 turns ([finding](findings/rule-placement/README.md)).
- **Its identity text is a small saving on easy tasks.** Removing it (639 bytes per request) cut cost per try 3% ($0.004 [-$0.007, -$0.001]) with pass rate unchanged. It is untested on hard tasks ([finding](findings/prompt-cuts/README.md)).
- **With gbrain and access rules, no reads it shouldn't make.** In 0 of 51 tries did gbrain return a record the person asking may not read. The pass-rate gain over no gbrain (+12 points [+0, +24] with the installer) has no statistical test ([finding](findings/shared-brain-access/README.md)).

### OpenClaw (Opus 5.5 and GPT-6.1 Sol)

- **About twice the cost on Opus.** $0.44 per solved task against $0.19 to $0.24 for the other Opus harnesses, and the slowest at 99.4 s per try (no statistical test) ([finding](findings/harness-cost/README.md)).
- **The money goes to cache writes.** About 81% of its extra cost over Claude Code on Opus is cache writes: it re-sends a much bigger system prompt and bigger tool results. On Sol, most of its gap to Codex is output (282,492 output tokens against 32,226), and $0.036 per try of it is one timed-out request that our proxy charged at the most it could have cost ([finding](findings/harness-cost/README.md)).
- **On Sol, it follows per-turn rules, and a skill nobody mentioned worked.** 30 of 30 turns from a per-turn hook or the startup file (it has no system-prompt setting), and 29 of 30 from an unmentioned skill. A rule given only once was followed in 4 of 10 later turns (no statistical test; the test could only detect a 39-point gap) ([finding](findings/rule-placement/README.md)).
- **Its minimal prompt is a lead, not proof.** On Opus it cut $0.023 per try with pass rate +7.5 points on easy tasks. The retest on harder tasks hit the floor (nothing passed), so it is untested there ([finding](findings/prompt-cuts/README.md)).

### Hermes Agent (Opus 5.5 and GPT-6.1 Sol)

- **Cost on both models.** $0.24 per solved task on Opus (64.6 s per try) and $0.19 on Sol (81.5 s) ([finding](findings/harness-cost/README.md)).
- **It sends more per request on Sol.** 423 kB more tool descriptions per try and 16.7 requests per try against Codex's 11.6, which is why it costs $0.023 more per try than Codex ([finding](findings/harness-cost/README.md)).
- **On Sol, it obeys the hook and the system prompt, not skills.** 30 of 30 turns from either. A skill nobody mentioned did nothing (4 of 30, the same as no rule; it was opened 0 times). A rule given only once was followed in 2 of 10 later turns (no statistical test; the test could only detect a 39-point gap) ([finding](findings/rule-placement/README.md)).
- **Most of its prompt stayed, for safety.** For 5 of the 7 parts of its built-in prompt we tried removing, our safety rule said to keep the part. All 5 rest on one task where Opus read outside what the person asking may see, in every harness ([finding](findings/prompt-cuts/README.md)).

### QM (Pi loop, Opus 5.5)

- **Lowest cost estimate per solved task on Opus.** $0.19 [$0.13, $0.28], tied fastest at 40.1 s, of which 16.1 s is our rig starting its stack; 24.0 s in turns ([finding](findings/harness-cost/README.md)).
- **Cheaper per try than Claude Code.** Claude Code cost $0.041 more per try [+$0.020, +$0.061] ([finding](findings/harness-cost/README.md)).
- **Caveat:** QM ran on Docker's default network, not our internal one. Its multi-user comparisons are untested, and its cost comparison with Claude Code did not hold the network fixed ([finding](findings/harness-cost/README.md)).

## gstack and gbrain

- **gstack: Opus 5.5 read gstack's skills but didn't follow them.** Told to run gstack's /investigate, /qa, /review or /ship, Opus loaded the skill text every time and ran none of its steps: 0 of 46 gstack sessions across three small checks run outside our formal runs, on dev tasks, at about twice the cost per try of no gstack. The tasks were easy for Opus (every setup passed 14 of 16 dev tasks, and the hard check was void because the setup without gstack passed all 8 of its tasks, leaving no room to improve), so this shows the steps weren't followed, not whether following them helps. The cost ratio is a single estimate, with no range ([finding](findings/2026-11-02-opus-gstack-steps-not-followed.md)).
- **gbrain needs per-person access rules.** With one shared token for the whole bot, gbrain returned records the person asking wasn't allowed to see in 33, 20, 17 and 9 of 51 tries. With per-person access rules, 0 of 51 in all four setups ([finding](findings/shared-brain-access/README.md)).
- **Put the "check gbrain first" rule where the agent sees it every turn.** On GPT-6.1 Sol, a per-turn hook reached 30 of 30 turns on Codex, Hermes and OpenClaw, and so did the system prompt on Codex and Hermes and the startup file on OpenClaw. Following it cost 10% to 55% more per turn (no statistical test) with no pass-rate gain. With no access rules on gbrain, more searches also meant more reads the person asking wasn't allowed to see (12 tries) ([finding](findings/rule-placement/README.md)).

## Run it yourself

These steps call no model and need no API key. You need [Bun](https://bun.sh/) and git.

1. Clone the public copy: `git clone https://github.com/garrytan/g-harness-evals.git && cd g-harness-evals`
2. Install: `bun install --frozen-lockfile`
3. Rebuild the scoreboard from the committed results and check it matches: `bun scripts/scoreboard/build.ts --check` (prints "scoreboard: up to date").
4. Recompute the multi-user run's tables from its saved tries: `bun scripts/summarize-run.ts --results docs/benchmarks/2026-11-04-matrix-mu/results` (a few seconds; it prints pass rate, cost and time per harness, and per task). It rewrites the run's committed summary.json, so `git status` should show no change afterwards.
5. Run the full set of keyless checks: the commands in [CONTRIBUTING.md](CONTRIBUTING.md#run-the-keyless-checks) (the test suite takes about 25 minutes on a 4-core machine).

To check one finding from its saved data, or rerun one setup with your own key under a hard spending cap, see [docs/replicate.md](docs/replicate.md).

## Words we use

- **Frontier model:** one of the newest, most capable models. Here that means Claude Opus 5.5 and GPT-6.1 Sol.
- **Harness:** the program around the model (system prompt, tools, memory). Claude Code, Codex, OpenClaw, Hermes Agent, Pi and QM are harnesses. "QM (Pi loop)" is QM running with Pi as its inner engine.
- **Terminal-Bench 2.1:** a public benchmark of coding tasks done at a command line.
- **The model's own harness:** the harness made by the model's maker: Claude Code for Opus 5.5, Codex for GPT-6.1 Sol.
- **Cell:** one setup we score, meaning one harness on one model. Each table row is a cell.
- **Try:** one attempt at one task. A **run** is a whole experiment, with all its tries.
- **Pass rate:** the share of tasks solved: each task's share of passing tries, averaged over tasks.
- **Cost per solved task:** what a cell spent at list price, divided by its passes.
- **Within 15 points:** a test planned before the run showed the harness passes at most 15 percentage points less often than the one it is compared with. It does not mean equal.
- **Behind:** a test planned before the run found it passes less often.
- **Can't tell apart:** the test found no difference. It does not mean equal: the run could miss a gap smaller than the size it states.
- **Dev tasks:** tasks we could see while building, so a result on them is a lead. **Held-out** tasks stay hidden until a counted run, so a result on them is a confirmation.
- **Amendment:** a dated change to a run's plan, written down in the run's folder.
- **Per-turn hook:** a harness setting that adds text each time a person sends the agent a message.
- **Cache writes:** what the model provider charges to store prompt text so later requests can reuse it more cheaply.
- **Startup file:** the instructions file a harness reads when a session starts, for example `AGENTS.md` in OpenClaw or `SOUL.md` in Hermes.

The full list is in [docs/glossary.md](docs/glossary.md).

<a id="corrections"></a>How we test and write reports: [docs/report-standard.md](docs/report-standard.md). Every run: [docs/reports-index.md](docs/reports-index.md). Every correction: [docs/corrections.md](docs/corrections.md).

## Disclosures

The repository and the evaluation are run by Garry Tan. gbrain-evals, which supplies the simulated company the multi-user tasks take place in, is his project too. Every harness ran the same tasks, grading scripts, opening instructions and model through the same metering proxy, and every try's records are in the repository so anyone can regrade them. Still weigh the gstack, gbrain and QM rows with the lines below in mind.

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.
