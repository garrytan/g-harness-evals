# gbrain's value and access rules in a team chat bot: results

**We learned that gbrain with per-member access rules makes a team chat bot remember people's details, and it leaked about as often as a bot with no brain.** On tasks where a member's detail had dropped out of the chat history before they asked for it, five frontier setups went from 17.3% to 94.0% right with gbrain's rules, +76.7 points [+73.3, +80.0], and not one of the 60 tasks got worse. Over 600 paired trials on the two leak sets, the rules arm leaked in 3 of 600 trials (0.5%) against 2 of 600 (0.3%) with no brain at all, +0.2 points [-0.5, +0.9], inside the preregistered 3-point margin. **If several people share one bot, give each person their own gbrain token and source.**

**We also learned that the same brain with no access rules leaks badly.** One shared bot token with rules switched off ("open") leaked in 67.5% of trials against 0.5% with rules, +67.0 points [+62.9, +71.5], on every harness we ran. **Don't share one gbrain token across the people in a chat.**

**Claude Code needs gbrain less for recall: its own built-in memory already got 86.7% of the expired details right with no brain.** Codex, Hermes, OpenClaw and dsh got none of them without gbrain.

- **Settled:** gbrain's live ingestion is reported as worth turning on for team chat bots that must recall members' own details; gbrain's documented per-member shape becomes our recommended default for any multi-user install, and gbrain's maintainers are asked to make it the default when a brain has two or more members; and "gbrain with rules adds no measurable leaks over no brain" holds at v0.60.764.0.

Run `gbrain-access-leaks-2026-11`, preregistered in [PREREGISTRATION.md](PREREGISTRATION.md) (Amendment 1 and three dated notes). 48 cells, 2,880 counted trials, 2,879 scored (one exam fault). Six setups (a harness with a model) each ran three arms on the same tasks and the same commit, on gbrain v0.60.764.0:

- **none:** no gbrain at all.
- **open:** gbrain mounted with live ingestion, one bot token for every person, no access rules.
- **rules:** the same brain with gbrain's documented per-member shape: each person's token reads only their own private source and the channels they're in.

Every difference below is in percentage points, the second arm minus the first, with its 95% range in brackets (bootstrap over task clusters, paired by task and repetition). "Pooled" means the five frontier setups together: Claude Code × Opus 5.5, Codex × GPT-6.2 Sol, Hermes × GPT-6.2 Sol, OpenClaw × Opus 5.5 and dsh × GPT-6.2 Sol. Hermes × particle-1, the low-cost model, is reported on its own and never pooled.

## What works

- **gbrain's rules arm recalls expired details (primary, value).** personal-v2x: 60 tasks where the member's detail is gone from the readable chat when they ask, 1 repetition, so only memory can carry it.

  | Setup | No brain | Rules | Rules minus none |
  |---|---:|---:|---|
  | Claude Code × Opus 5.5 | 52/60 | 58/60 | +10.0 [0.0, +20.0] |
  | Codex × GPT-6.2 Sol | 0/60 | 54/60 | +90.0 [+81.7, +96.7] |
  | Hermes × GPT-6.2 Sol | 0/60 | 55/60 | +91.7 [+83.3, +98.3] |
  | OpenClaw × Opus 5.5 | 0/60 | 56/60 | +93.3 [+86.7, +98.3] |
  | dsh × GPT-6.2 Sol | 0/60 | 59/60 | +98.3 [+95.0, +100.0] |
  | **Pooled (300 pairs)** | **17.3%** | **94.0%** | **+76.7 [+73.3, +80.0]** |
  | Hermes × particle-1 (not pooled) | 36/59 | 52/59 | +27.1 [+11.9, +42.4] |

  - Tasks that got worse with rules, pooled: 0 of 60. Claude Code had 2 tasks worse and particle-1 had 4.
  - The preregistered outcome: the pooled interval is above 0, so **gbrain's live ingestion is reported as worth turning on for team chat bots that must recall members' own details.**
- **The rules arm doesn't leak more than no brain (co-primary, safety).** Leak rate on company-v2-l5 (60 tasks) and personal-v2 L5 (30 tasks, 2 repetitions), pooled: no brain 2 of 600 trials (0.3%), rules 3 of 600 (0.5%), rules minus none +0.2 [-0.5, +0.9]. The upper limit is below the 3-point margin, and every setup's upper limit is below its 10-point margin (the widest is Claude Code, 0.0 [-3.4, +3.3]). Harness-memory leaks are left out of this test as preregistered; counting them changes nothing (0.0 [-0.8, +0.8]).
  - The preregistered outcome: **"gbrain with rules adds no measurable leaks over no brain" at v0.60.764.0.**
  - The rules arm's 3 frontier leaks are all reply leaks on the asking turn (Claude Code 2, OpenClaw 1), and none traces back to anything gbrain returned across scope: the leak tags find no cross-scope gbrain return in any of the 1,079 scored rules-arm trials on any set, all six setups included.
- **Rules also help on the sets where the detail is still in the chat.** On company-v2-l5 and personal-v2 L5 together, rules minus none is +5.5 [+2.3, +9.2] pooled (82.7% to 88.2%). The preregistration names this "an extra index over searchable history"; it can't make a cut candidate either way.
- **Rules cost less per solved task.** Pooled over every set, the five frontier setups spent $693.79 on 811 passes with rules ($0.86 a pass) and $545.21 on 548 passes with no brain ($0.99 a pass). Per trial, rules cost more (for example Codex $0.36 against $0.23 median on the twins), but more trials pass.
- **Every gbrain trial used gbrain.** All 1,800 open and rules trials called gbrain at least once, from 9.0 calls a trial (Hermes × Sol, open) to 28.8 (dsh, rules). The none arm never could.

## What didn't work

- **gbrain with no access rules leaks (primary, safety).** Leak rate, open minus rules, company-v2-l5 and personal-v2 L5 together:

  | Setup | Rules | Open | Open minus rules |
  |---|---:|---:|---|
  | Claude Code × Opus 5.5 | 2/120 | 106/120 | +86.7 [+80.0, +93.2] |
  | Codex × GPT-6.2 Sol | 0/120 | 33/120 | +27.5 [+19.2, +36.8] |
  | Hermes × GPT-6.2 Sol | 0/120 | 103/120 | +85.8 [+79.2, +92.1] |
  | OpenClaw × Opus 5.5 | 1/120 | 116/120 | +95.8 [+92.1, +99.1] |
  | dsh × GPT-6.2 Sol | 0/120 | 47/120 | +39.2 [+29.9, +49.1] |
  | **Pooled (600 pairs)** | **0.5%** | **67.5%** | **+67.0 [+62.9, +71.5]** |
  | Hermes × particle-1 (not pooled) | 2/120 | 120/120 | +98.3 [+95.8, +100.0] |

  - By set: company-v2-l5 0 against 243 of 300 (+81.0 [+76.7, +85.0]); personal-v2 L5 3 against 162 of 300 (+53.0 [+49.0, +57.0]). Counting only each predicate's own turn gives the same pooled numbers.
  - Almost all open-arm leaks are gbrain returning another person's facts to the asker (exposure), mostly through `search`, and through hot memory and `recall` on some harnesses; at most 3 open-arm trials per cell repeated such a value in a reply. Codex and dsh had the fewest cross-scope returns (for example 103 search returns across scope in Codex's company cell against 459 in Claude Code's); we didn't check why.
  - The preregistered outcome: rules leaks clearly less than open, so **the documented per-member shape becomes our recommended default for any multi-user install, and gbrain's maintainers are asked to make it the default when a brain has two or more members.**
- **The open arm passes fewer tasks.** A trial passes only if it answered right and leaked nothing, so pooled open-arm pass rates were 26.7% on company-v2-l5 and 73.0% on personal-v2 L5, against 80.0% and 96.3% with rules.
- **Claude Code's built-in memory is one memory for everyone.** In all 60 no-brain twin trials, Claude Code wrote its own memory files (`projects/-workspace/memory/MEMORY.md` and one file per fact), which is why it recalled 52 of 60 details with no brain. That memory has no per-person access: every member's details sit in the same files. Claude Code with no brain leaked in 4 of its 180 trials (2 on the twins), and the leak tags couldn't place where those values came from, because this run snapshots harness memory only for Hermes and OpenClaw. We didn't test whether a harder leak set would draw out more.
- **particle-1 gains less.** Hermes × particle-1 went from 61.0% to 88.1% on the twins with rules, and its no-brain arm already recalled 36 of 59, so the gain is smaller than on the frontier setups.

## Checks before publishing the leak counts

- **16,737 of 16,930 unmapped records were placed; 193 name no source (preregistered check).** The leak tags left 16,930 returned gbrain records with no known scope, all in the open and rules arms. [map-unmapped.ts](analysis/map-unmapped.ts) placed each one by the gbrain source it came from, checked against that source's readers in the trial's own brain manifest:
  - **Rules arm:** 10,389 of 10,509 records are in scope for the asker. They are gbrain's `memory/unattributed` page (where it keeps facts saved without an entity) in search and recall results, and hot-memory facts that a `remember` call returned for the fact it had just saved. The other 120 are reads of `memory/unattributed` by name (`get_page`, `list_pages`, `entity`) whose replies name no source.
  - **Open arm:** of 6,421 records, 4,851 are in scope, 1,387 are possibly out of scope (a reply whose sources include one the asker can't read, so it may be exposure), 110 are out of scope and 73 name no source. Counting the possible and out-of-scope ones as leaks could only add to the open arm: it would add at most 26 trials (Codex 5, dsh 21), so the open-minus-rules result can only grow.
- **A content check found nothing out of scope in the rules arm.** gbrain stamps every fact it returns with the conversation it came from. [content-check.ts](analysis/content-check.ts) read every turn's harness transcript and checked each stamp against the asker. In the rules arm, 0 of 37,217 stamps came from a conversation the asker isn't in; in the open arm, 1,494 of 26,451 did. OpenClaw's transcripts don't hold tool results, so this check covers Claude Code, Codex, Hermes and dsh only; OpenClaw's 11 rules-arm records with no source are not checked by content.
- **The filler line didn't change anything.** 23 tasks carry a filler line saying the member wrote to the wrong window. Without them, pooled pass rates move by at most 2.2 points (open on personal-v2 L5, 73.0% to 70.8%); twins with rules 94.0% to 93.8%.
- **No pass came from advising against the answer.** Of 1,417 passing replies with a reply answer check, the answer appears in the asking turn's reply in 1,373, and none of those has every mention after a negation word in the same sentence. The other 44 matched in a post the turn's reply text doesn't hold and weren't checked.

## Deviations from the plan

All are in the dated notes in [PREREGISTRATION.md](PREREGISTRATION.md) or below. None changed a task, a pin, a grader or a counted trial.

- **Two lease-short cells rerun.** The metering proxy refused calls that would have passed a shard's lease: 21 of 60 trials in cc-opus-rules-personal and 4 of 60 in oc-opus-rules-company. Both whole cells reran from their first trial at the run commit on new VMs, with leases sized from their observed cost ($69 and $106). The 95 first-run trials that completed are reported here, not counted. Note dated 2026-11-25.
- **Two shards rerun after an operator error.** A controller cancel on 2026-11-23 at 02:30 UTC stopped hermes-particle-1 and hermes-particle-2 after 92 completed trials. Both reran from the start; the 92 trials are not counted. Note dated 2026-11-23.
- **codex-sol-2's smoke lease raised from $4 to $8** after its first smoke failed on Codex's parallel call reservations ($1.34 spent, no counted trial). Note dated 2026-11-25.
- **The merge check compares brain layouts without build times.** scripts/merge-shards.ts compared each shard's leak preflight byte for byte; every shard builds its own brain, so build time and fresh token values differ. From ba27cf83fb it compares the layout without them. No trial or count changed.
- **Run operations.** Six shards failed at their first sync when the controller disk filled on 2026-11-23 and were relaunched from scratch; the controller machine slept twice and its fan-outs were reattached; local copies were deleted for disk after each shard was archived. One exam fault (hermes-particle-rules-twin) is excluded from that cell.
- **What the analysis reads.** The leak tags and endpoints are rebuilt from the committed trial evidence (events, turns, world snapshots and harness memory, gzipped). The content check reads the harness transcripts, which are only in the private raw archive ([reproduce.md](reproduce.md)).

## Receipts

- Merged trials and per-shard records: [results/](results/). Analyses: [results/analysis/](results/analysis/): [endpoints.json](results/analysis/endpoints.json) (every contrast above), [comparisons.gbrain.md](results/analysis/comparisons.gbrain.md) (per-cell pairs and the leak tags), [summary.md](results/analysis/summary.md), [headroom.md](results/analysis/headroom.md), [map-unmapped.json](results/analysis/map-unmapped.json), [content-check.json](results/analysis/content-check.json), [negation-flags.json](results/analysis/negation-flags.json).
- Commands, from the repository root, with `R=docs/benchmarks/2026-11-09-gbrain-access-leaks/results`:
  - `bun scripts/compare-run.ts --results $R --pair gbrain --leak-tags` and `bun scripts/summarize-run.ts --results $R --leak-tags`
  - `bun docs/benchmarks/2026-11-09-gbrain-access-leaks/analysis/endpoints.ts --results $R`
  - `bun docs/benchmarks/2026-11-09-gbrain-access-leaks/analysis/map-unmapped.ts --results $R`
- Run commit 5a419643 (Amendment 1); every shard, both reruns included, ran from it. gbrain v0.60.764.0 (b6d0a1db).

## Disclosures

gbrain is Garry Tan's open-source project. OpenAI, Anthropic and Particle models are tested through their public APIs.
