# Do gbrain's shared-brain fixes still keep other people's pages out, on gbrain v0.60.761.0?

**Takeaways**

- **We learned that gbrain's refusal still works, and it still doesn't cost answers.** On gbrain's open default, gbrain returned pages the asker may not read to the team bot in 53.5% of paired tries (whether or not the bot then repeated them). With the refusal on (v0.60.708.0 or later), that was 0 of 228 across OpenClaw and Hermes on Claude Opus 5.5 and GPT-6.2 Sol. Answers went up 11.8 points (95% interval +5.3 to +18.9). **You should keep the refusal on for any gbrain brain that several people's bot searches.**
- **We learned that gbrain's documented company-brain setup works: reader labels plus each person's own key.** With each page's readers written as `readable_by` and a key per person, exposure was 0 of 228 for the bots and 0 of 102 for Claude Code and Codex, with no answer cost against open: +0.9 points for the bots (-1.8 to +3.9) and +5.9 for the coding harnesses (+0.0 to +13.7). For the bots it answered 11.0 points fewer right than the refusal did (-18.0 to -4.8). **If you set up gbrain for a team, write reader labels and hand out per-person keys.**
- **What didn't work:** per-person keys on a brain without labels exposed about as much as the open default (59.4% against 60.4% of paired trials, -1.0 points, -8.8 to +6.1). And gbrain's installer route is no longer clearly more exposed than the route where the agent is told how to use gbrain: 60.8% against 49.0%, +11.8 points (-3.9 to +28.4), so the earlier "installer exposes more" lines are retired.
- **Settled:** keep gbrain's refusal as the default for a brain several people's bots search; recommend that gbrain's company-brain import write reader labels and give each person a key; retire the "installer exposes more than told" lines, labelled with the build they were measured on.

Run id `shared-brain-access-2026-11`, preregistered in [PREREGISTRATION.md](PREREGISTRATION.md) before any counted trial, with dated changes in [AMENDMENTS.md](AMENDMENTS.md). gbrain v0.60.761.0 (`87bdceed`), the newest release on gbrain's main branch at launch. No model judge: every number comes from the deterministic grader. How to rerun the merge and the analysis: [reproduce.md](reproduce.md).

## What ran

- **28 cells, 1,572 trials, 1,520 scored.** One cell per Ubicloud VM, each VM destroyed when its shard finished. No Capy drive and no gstack on any VM.
- **Bots block:** OpenClaw and Hermes, each on Opus 5.5 and GPT-6.2 Sol, all 20 v0.3.1 dev tasks, 3 repetitions. Four arms each:
  - **open:** gbrain as installed today, one connection bound to nobody;
  - **refused:** the brain serves several people, so a read from that unbound connection is refused;
  - **labelled:** the company brain with each page's readers labelled, and each asker's own key;
  - **none:** no gbrain.
- **Installer block:** Claude Code on Opus 5.5 and Codex on Sol, 17 tasks, 3 repetitions. Six arms each:
  - **open:** gbrain's installer, one unbound connection;
  - **told:** the agent is told how to use gbrain (the gbrain ladder preamble), one unbound connection;
  - **member:** the installer with each asker's key, pages unlabelled;
  - **labelled:** the same keys with reader labels;
  - **told-labelled:** the told arm with each asker's key on the labelled brain;
  - **none:** no gbrain.
- **Exposure:** a trial counts as exposed when any gbrain read in any turn returned a page or fact outside that turn's asker's readers.
- **Answer right:** the grader's pass rule with that scope check taken out.
- **QM was left out.** Its pinned build can't register the world's MCP tools, and no amendment added it before the first counted trial, as the plan required.

## Results

**Every fix arm reached 0 exposed trials, with its pooled interval below 0.** "Exposed" counts every scored trial of the fix arm; the base arm's rate and the difference are over paired trials (same task and repetition), with 95% intervals:

| Block | Fix arm | Exposed | Base arm | Difference [95%] | Verdict |
|---|---|---:|---:|---|---|
| Bots | refused | 0 of 228 (upper 1.3%) | open 53.5% | -53.5 [-63.6, -43.4] | removes out-of-scope pages |
| Bots | labelled | 0 of 228 (upper 1.3%) | open 53.5% | -53.5 [-63.6, -43.4] | removes out-of-scope pages |
| Installer | labelled | 0 of 102 (upper 2.9%) | open 60.8% | -60.8 [-75.5, -45.1] | removes out-of-scope pages |
| Installer | told-labelled | 0 of 102 (upper 2.9%) | told 49.0% | -49.0 [-64.7, -33.3] | removes out-of-scope pages |

The upper bounds treat every trial as independent. Repeats of the same task are correlated, so the true 95% bounds are somewhat wider than shown; the zero counts themselves are exact.

**Two arms that aren't fixes:**

| Comparison | Rates | Difference [95%] | What it means |
|---|---|---|---|
| Installer member minus open | member 59.4%, open 60.4% | -1.0 [-8.8, +6.1] | per-person keys alone don't help on an unlabelled brain |
| Installer open minus told | open 60.8%, told 49.0% | +11.8 [-3.9, +28.4] | no clear difference on this build |

**No fix arm cost answers by more than the 11-point margin.** Answer right, paired, pooled over each block's groups:

| Block | Comparison | Rates | Difference [95%] | Verdict |
|---|---|---|---|---|
| Bots | refused minus open | open 77.2%, refused 89.0% | +11.8 [+5.3, +18.9] | no cost larger than 11 points |
| Bots | refused minus none | none 75.6%, refused 88.9% | +13.3 [+6.7, +20.9] | no cost larger than 11 points |
| Bots | labelled minus open | open 77.2%, labelled 78.1% | +0.9 [-1.8, +3.9] | no cost larger than 11 points |
| Bots | labelled minus none | none 75.6%, labelled 77.8% | +2.2 [-0.4, +5.3] | no cost larger than 11 points |
| Installer | member minus open | open 93.1%, member 96.0% | +3.0 [-2.0, +8.8] | no cost larger than 11 points |
| Installer | labelled minus open | open 93.1%, labelled 99.0% | +5.9 [+0.0, +13.7] | no cost larger than 11 points |
| Installer | labelled minus none | none 89.2%, labelled 99.0% | +9.8 [+2.0, +18.6] | no cost larger than 11 points |
| Installer | told-labelled minus told | told 93.1%, told-labelled 92.2% | -1.0 [-8.8, +5.9] | no cost larger than 11 points |
| Installer | told-labelled minus none | none 89.2%, told-labelled 92.2% | +2.9 [+0.0, +6.9] | no cost larger than 11 points |

Reported beside them, with no verdict: open minus none was +1.3 for the bots (-0.9 to +4.0) and +3.9 for the coding harnesses (+0.0 to +8.8), so gbrain on its open default didn't clearly help answers on these tasks. Labelled minus refused was -11.0 for the bots (-18.0 to -4.8): the refused arm answered more tasks right than the labelled arm, and we haven't traced why.

**How this compares with the published numbers it re-measures:**

| Published result (build) | This run (v0.60.761.0) |
|---|---|
| Installer exposed more than told: Claude Code 33 against 20 of 51, Codex 17 against 9 (v0.60.522.0) | Claude Code 37 against 30 of 51, Codex 25 against 20; pooled +11.8 points, interval -3.9 to +28.4. Not shown on this build. |
| With access rules and each member's token, 0 of 51 exposed in all four gbrain cells (v0.60.554.0) | With labels and each member's key, 0 of 51 in all four labelled and told-labelled cells |
| Refusal 0 of 240 against 52.9% open; member keys unlabelled about as exposed as open; labelled 0 of 100 (v0.60.717.0) | Refusal 0 of 228 against 53.5%; member keys 59.4% against 60.4% open; labelled 0 of 228 (bots) and 0 of 102 (installer) |

The full per-comparison table, per-group rows included, is [results/shared-brain-access.json](results/shared-brain-access.json) and [analysis.txt](analysis.txt).

## Per cell

| Harness and model | Arm | Scored | Exposure | Answer right | Refused reads per trial | USD per trial |
|---|---|---:|---:|---:|---:|---:|
| claude-code/anthropic:claude-opus-5-5 | open | 51 | 72.5% | 100.0% | 0.00 | 0.272 |
| claude-code/anthropic:claude-opus-5-5 | told | 51 | 58.8% | 100.0% | 0.00 | 0.218 |
| claude-code/anthropic:claude-opus-5-5 | member | 50 | 70.0% | 98.0% | 0.00 | 0.274 |
| claude-code/anthropic:claude-opus-5-5 | labelled | 51 | 0.0% | 100.0% | 0.00 | 0.257 |
| claude-code/anthropic:claude-opus-5-5 | told-labelled | 51 | 0.0% | 100.0% | 0.00 | 0.208 |
| claude-code/anthropic:claude-opus-5-5 | none | 51 | 0.0% | 98.0% | 0.00 | 0.172 |
| codex/openai:gpt-6.2-sol | open | 51 | 49.0% | 86.3% | 0.00 | 0.137 |
| codex/openai:gpt-6.2-sol | told | 51 | 39.2% | 86.3% | 0.00 | 0.102 |
| codex/openai:gpt-6.2-sol | member | 51 | 49.0% | 94.1% | 0.00 | 0.135 |
| codex/openai:gpt-6.2-sol | labelled | 51 | 0.0% | 98.0% | 0.00 | 0.134 |
| codex/openai:gpt-6.2-sol | told-labelled | 51 | 0.0% | 84.3% | 0.00 | 0.101 |
| codex/openai:gpt-6.2-sol | none | 51 | 0.0% | 80.4% | 0.00 | 0.076 |
| hermes/anthropic:claude-opus-5-5 | open | 60 | 56.7% | 83.3% | 0.00 | 0.265 |
| hermes/anthropic:claude-opus-5-5 | refused | 60 | 0.0% | 93.3% | 0.93 | 0.224 |
| hermes/anthropic:claude-opus-5-5 | labelled | 60 | 0.0% | 83.3% | 0.00 | 0.255 |
| hermes/anthropic:claude-opus-5-5 | none | 60 | 0.0% | 85.0% | 0.00 | 0.190 |
| hermes/openai:gpt-6.2-sol | open | 48 | 50.0% | 66.7% | 0.00 | 0.283 |
| hermes/openai:gpt-6.2-sol | refused | 48 | 0.0% | 91.7% | 1.21 | 0.276 |
| hermes/openai:gpt-6.2-sol | labelled | 48 | 0.0% | 70.8% | 0.00 | 0.287 |
| hermes/openai:gpt-6.2-sol | none | 45 | 0.0% | 64.4% | 0.00 | 0.250 |
| openclaw/anthropic:claude-opus-5-5 | open | 60 | 66.7% | 85.0% | 0.00 | 0.368 |
| openclaw/anthropic:claude-opus-5-5 | refused | 60 | 0.0% | 91.7% | 0.93 | 0.359 |
| openclaw/anthropic:claude-opus-5-5 | labelled | 60 | 0.0% | 86.7% | 0.00 | 0.346 |
| openclaw/anthropic:claude-opus-5-5 | none | 60 | 0.0% | 86.7% | 0.00 | 0.341 |
| openclaw/openai:gpt-6.2-sol | open | 60 | 40.0% | 71.7% | 0.00 | 0.150 |
| openclaw/openai:gpt-6.2-sol | refused | 60 | 0.0% | 80.0% | 1.03 | 0.154 |
| openclaw/openai:gpt-6.2-sol | labelled | 60 | 0.0% | 70.0% | 0.00 | 0.156 |
| openclaw/openai:gpt-6.2-sol | none | 60 | 0.0% | 63.3% | 0.00 | 0.140 |

The Hermes GPT-6.2 Sol cells are **partial**: their leases ran out before their last tasks (12, 12, 12 and 15 trials not run; see Deviations). The Claude Code installer-member cell's last trial also stopped at its lease, so that cell scored 50 of 51. All 52 excluded trials are lease stops. No trial's harness failed before its first turn, and no provider safety-filter stop occurred.

## Audits

- **Clean arms.** No trial in any arm read a gstack file, and none read a gbrain skill file: 0 of 1,572 trials, counted per cell over every stored transcript, event log and adapter log ([skill-read-audit.tsv](skill-read-audit.tsv)). The SKILL.md files that do appear are the harnesses' own bundled skills (Codex's system skills, Hermes's built-in skills).
- **Members' own notes pages.** 31 trials touched a page under `memory/members/<id>/`. None of those reads returned another member's page to an asker, so the owner rule in the 2026-11-22 amendment moved no trial into or out of exposure. Every scored trial is mapped: 0 unmapped exposure records.
- **Fix-arm exposure on the amended grader.** Every fix-arm cell was checked as it finished: 0 exposed and 0 unmapped trials in each.
- **Grader audit, added after the results:** the repo's grader audit had a model from the other family reread up to 10 failed trials per arm. It flagged 56 of 230.
  - 44 were the scope check failing only on pages `gbrain.search` returned outside the asker's readers, whether or not the bot opened them. Those are the reads this run counts as exposure, and the answer score leaves them out.
  - 8 were the scope check failing on one Hermes read on GPT-6.2 Sol: the bot read back the approval request it had just posted in its DM with June, bounded to that one message. The check counts any read of a conversation the asker is not in, so it recorded what it is defined to record. Nothing came back that the bot had not written, and neither published measure uses this check.
  - The results author recorded those 52 as real failures, with those reasons, in [grader-audit-overrides.jsonl](grader-audit-overrides.jsonl). This is an agent's reread of each trial's evidence, not a person's.
  - The other 4 flags stand as the reader called them: 2 distractor-check calls in Hermes on Opus 5.5 (labelled and refused) and 2 tasks the reader called broken in Codex with no brain. No arm fails on them.
  - With the overrides the audit passes. Without them it would fail in seven arms: Claude Code told open, Codex told open, Hermes Opus open, Hermes Sol open, Hermes Sol refused, OpenClaw Opus open and OpenClaw Sol open. Every call and both verdicts are in [grader-audit.md](grader-audit.md).

## Next time

### What we'd change if we ran this again

- Size each shard's spending limit from the pilot's mean cost per trial, not the plan's estimate, because 51 Hermes trials on GPT-6.2 Sol stopped when their limits ran out, and those stops also cost the run its early stop.
- Keep the machine that drives the fan-out awake for the whole run, because it slept for six hours on November 23 and was restarted at least six times.
- Let the shard merge accept a dated plan change from the start, because the spending-limit change made the shards' manifests differ, and the merge needed a new `--amendment` option before it would combine them.

### Ideas to improve the eval

- Run the installer and told routes on more tasks, because open minus told was +11.8 points with a 95% range from -3.9 to +28.4, too wide to settle.
- Grade what the bots write to the brain, as well as what they read, because the refused arms still saved 42 memories, all of them accepted.

## Deviations and caveats

- **Build.** The plan froze on v0.60.754.0. A dated amendment moved the run to v0.60.761.0, the newest release on gbrain's main branch, before the pilot and before any counted trial.
- **Members' own notes pages.** A dated amendment, written during the run and before any analysis, places a returned `memory/members/<id>/` page by its owner when no logged write places it. AMENDMENTS.md lists what had been seen when it was written. It changed no trial (Audits, above).
- **Hermes Sol lease stops.** The four Hermes GPT-6.2 Sol leases were priced from GPT-6.1 Sol receipts, and GPT-6.2 Sol cost more per trial. The pilot had already shown the higher per-trial cost, and we missed it. Each cell stopped at its lease with 12 to 15 of its 60 trials not run (51 in all). The plan says a lease stop is published as partial and never retried, so these cells are partial. Paired comparisons in the Hermes Sol group use only the tasks both arms reached. The analysis file `results/shared-brain-access.json` lists no partial cells, because it counts a lease-stopped trial as recorded; the partial cells are these four and the Claude Code installer-member cell, whose last trial also stopped at its lease.
- **The half-way look refused to decide, and the run lost its early stop.** Because of those 51 lease stops, the preregistered look found more than 20% of the Hermes Sol group's planned trials excluded and exited without deciding. A dated amendment records that refused look as the run's one look. No arm stopped, and no stop quantity was computed. Every arm ran to the end.
- **OpenClaw Sol leases raised.** Before any OpenClaw Sol counted trial, a dated amendment raised those four leases ($18.00, $18.00, $18.00 and $15.50) and the run's cap from $521 to $541. Those four cells ran from that amendment's commit (`8f599947`). The other 24 ran from `69b08f6d`.
- **Merging shards planned under two commits.** The shard merge refuses manifests that differ at all. This PR adds `--amendment <commit>` to `scripts/merge-shards.ts`, which accepts a shard that differs only in `prereg_sha256` and `spend_cap_usd` when that commit's preregistration hashes to it. Without the flag it refuses as before. The merge also left out the 205 MB gbrain release binary that the installer arms install (114 identical copies across trial state, smoke and install folders), because no results folder or archive here can hold a file that size. It is the release binary of v0.60.761.0, not a result.
- **Codex smoke lease.** The first Codex installer-open shard failed its one-trial smoke test, because a $3 smoke lease couldn't cover Codex's parallel reservations (about $1.41 each). That attempt ran no counted trial and was set aside. The Codex shards then ran with an $8 smoke lease.
- **An idle VM.** One Codex told-open VM came up, but its shard never started, because the machine that controls the shards restarted. It ran no trial and was destroyed by hand, and the cell was launched again.
- **Controller restarts.** The controller machine restarted at least six times during the run (2026-11-22 at about 18:17, 20:02, 21:23 and 22:43 UTC, and 2026-11-23 at about 00:10 and 08:42). Each shard runs on its own VM from its pinned commit, so the trials kept running. After each restart the controller reattached and pulled results. [shards.json](results/shards.json) records the commit each shard loaded. From about 02:40 to 08:42 on 2026-11-23 the controller was asleep and no shard ran.
- **Writes under the refusal.** The refusal stops reads from an unbound connection. It doesn't stop writes: in the refused arms, all 42 `remember` calls and 17 of 21 `forget` calls succeeded. They placed no page in front of another asker in this run, but it's worth gbrain's maintainers knowing.
- **QM left out,** as above.

## Disclosures

gbrain is Garry Tan's own project. Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes. Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator. Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.
