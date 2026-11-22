# Hermes on gbrain v0.60.757.0: rerun of the Hermes rows

Regression check of gbrain's Hermes install fix. Run `gbrain-install-hermes-757-2026-11`, gbrain v0.60.757.0 (915e3b30b285), 60 runs, all counted, run 2026-11-21. It reruns the Hermes rows of [gbrain-install-2026-11](../README.md) (v0.60.734.0) with the same task, Hermes pin, arms and scorer, plus one GPT-6.2 Sol cell per arm. particle-1 wasn't rerun (18/18 before).

## Takeaways

- **We learned that gbrain 757 fixed most of the Hermes install failures.** Runs that never got a gbrain binary fell from 22 of 40 to 8 of 40 on the same four cells. GPT-6.1 Sol went from 4/10 to 10/10 bare and from 5/10 to 10/10 with the README paste block. Most runs that got gbrain installed the release binary by its tag, which Hermes's command scanner lets through. You should keep the release-binary route first in gbrain's install docs.
- **What still fails: Opus 5.5 with no instructions (3/10).** Six of its runs still tried `bun install -g` or `git clone` first, which Hermes's scanner (Tirith) and its single-query approval rule block, and never got a binary. With the README block, Opus finishes 8/10.
- **GPT-6.2 Sol, new in this run, finishes 10/10 with the README block and 6/10 bare.** Two bare runs installed and wired gbrain but answered the recall question from Hermes's own memory instead of gbrain, and a third wired it but didn't recall the fact.

## Before and after

Finish line = the recall reply holds the nonce, and gbrain served it in a fresh session (the a+b+c column; for Hermes all three scoring columns are the same). Each cell is k of n with a Wilson 95% interval.

| Cell | Arm | v0.60.734.0 (before) | v0.60.757.0 (after) | Runs with no gbrain binary, before → after |
|---|---|---|---|---|
| Hermes, Opus 5.5 | bare | 0/10 (0% to 28%) | 3/10 (11% to 60%) | 8 → 6 |
| Hermes, Opus 5.5 | paste | 7/10 (40% to 89%) | 8/10 (49% to 94%) | 3 → 2 |
| Hermes, GPT-6.1 Sol | bare | 4/10 (17% to 69%) | 10/10 (72% to 100%) | 6 → 0 |
| Hermes, GPT-6.1 Sol | paste | 5/10 (24% to 76%) | 10/10 (72% to 100%) | 5 → 0 |
| Hermes, GPT-6.2 Sol | bare | not run | 6/10 (31% to 83%) | 0 |
| Hermes, GPT-6.2 Sol | paste | not run | 10/10 (72% to 100%) | 0 |
| **Same four cells** | | **16/40** | **31/40** | **22 → 8** |

- Each cell has n=10, so a single cell can only show a large change. The two GPT-6.1 Sol cells rose by 60 and 50 points. The plan's smallest detectable change at n=10 (about 55 points) was worked out only for a drop from a 60% rate, so it doesn't apply to these rises, and no paired test was run. The intervals in the table are the per-cell evidence.
- The paste prompt is byte-identical to 734's, but it sends the agent to gbrain's INSTALL_FOR_AGENTS.md on master, which changed between the two runs. So the paste arm measures today's docs, not a frozen page.

## Where the remaining runs failed

| Cell | Failed | Step it stopped at | What happened |
|---|---|---|---|
| Opus 5.5 bare | 7 | binary (6), wired (1) | 6 runs: `bun install -g`, `git clone` and `curl ... \| bash` were blocked, no binary. r4 installed gbrain and ran `gbrain setup hermes --dry-run` but never the real command. |
| Opus 5.5 paste | 2 | binary (2) | Same blocks as above. |
| GPT-6.2 Sol bare | 4 | wired (1), recalled (3) | r2 installed and initialised gbrain but never registered it with Hermes. r7, r8, r10 registered gbrain, then r8 and r10 answered from Hermes's own memory and r7 didn't recall. |

The per-arm step tables are [results/failure-bare.md](failure-bare.md) and [results/failure-paste.md](failure-paste.md).

## Blocks, Tirith and protected config

Blocked tool calls are commands Hermes refused to run: tool results whose error starts with Hermes's `BLOCKED` refusal, `execute_code` refusals included. Output that only quotes a refusal (for example a log file the agent read) isn't counted. "Tirith" is Hermes's command scanner. "Single-query" is Hermes refusing a command or an `execute_code` run that needs approval because no user is present (`hermes -q`). "Protected config" is Hermes refusing to let the agent edit its own config.yaml.

| Cell | Arm | Blocked tool calls, before → after | Runs with a Tirith block, before → after | Runs with a single-query denial, before → after | Person-needed "blocked step" events, before → after |
|---|---|---|---|---|---|
| Opus 5.5 | bare | 39 → 38 | 10 → 9 | 10 → 10 | 1 → 0 |
| Opus 5.5 | paste | 69 → 41 | 10 → 8 | 10 → 10 | 1 → 1 |
| GPT-6.1 Sol | bare | 41 → 17 | 10 → 4 | 10 → 8 | 0 → 1 |
| GPT-6.1 Sol | paste | 48 → 19 | 10 → 2 | 10 → 10 | 1 → 0 |
| GPT-6.2 Sol | bare | not run → 35 | not run → 8 | not run → 10 | not run → 1 |
| GPT-6.2 Sol | paste | not run → 18 | not run → 3 | not run → 10 | not run → 0 |

- **58 of the 60 runs still hit at least one block**, almost always a single-query denial. The blocks stopped deciding the result once agents took the release-binary route.
- **No run hit Hermes's protected-config refusal.** No tool result was that refusal. Some runs read pages or files that quote its wording, and none of them was refused. In the 734 run, Opus bare r9 and r10 were both refused when they tried to edit config.yaml.

## Which gbrain each run installed

- **Every run that installed gbrain got v0.60.757.0** (52 of 60; the other 8 never got a binary). gbrain's version probe never saw another version, including v0.60.753.0.
- **The docs' `releases/latest` route.** `latest` still served v0.60.753.0 during the whole run (it was published 2026-11-20 and was still `latest` when the run ended). No run fetched gbrain's `releases/latest` URL. Ten runs fetched another tool's `releases/latest`: Bun's installer zip in nine (Opus bare r1, r4, r5, r7, r9, r10; Opus paste r4, r7, r9) and the GitHub CLI in GPT-6.2 Sol bare r5.
- Routes, among runs that installed: the release binary by tag in 40 runs, `git clone` and `bun link` in 6, and `bun install -g` from GitHub in 6. That's the runner's install classification, plus the release-binary label for runs where the classification recorded no attempt and the agent downloaded a release asset.

## Deviations and caveats

- **Declared deviation (2026-11-21): the Hermes image now puts the `hermes` command on PATH.** Hermes's terminal tool runs login shells, and Debian's /etc/profile resets PATH in a login shell, which drops /opt/harness/venv/bin. We checked this inside the image: `bash -l -c 'command -v hermes'` finds nothing, as root and as uid 1000. The image now links /usr/local/bin/hermes, where Hermes's own install.sh puts it (harnesses/hermes/Dockerfile). 757's fix registers gbrain through `hermes mcp add`, so without the link this run could have measured our image instead of gbrain.
- **What that gap means for the published 734 Hermes rows.** It could only have touched runs that got past the binary step, because the gap is about calling `hermes`, which comes after installing gbrain. Of the 24 failed Opus and GPT-6.1 Sol runs, 22 stopped at the binary step and 2 at wiring: Opus bare r9 and r10. Both looked for `hermes` (`which hermes`, `command -v hermes`), found nothing, then tried to edit config.yaml by hand and were refused. With `hermes` on PATH they might have registered gbrain, so **Opus 5.5 bare at 0/10 could have been as high as 2/10**. We can't tell from the records whether they would have. 24 of the 58 Hermes runs in that run called /opt/harness/venv/bin/hermes by its full path, so their times may include that detour.
- **Three things changed between the two runs, not one:** the gbrain build, master's INSTALL_FOR_AGENTS.md, and the PATH link above. The drop in binary-step failures (22 → 8) can't come from the PATH link, because it happens before `hermes` is ever called. On the same four cells, wiring failures were 2 before and 1 after (GPT-6.2 Sol bare r2, a cell with no before, also stopped at wiring).
- **Harness-script check.** A bash 5.2.21 `trap` bug in harnesses/hermes/adapter.sh can turn a clean stop into exit 2 (about 4 in 1,500). None of these 60 runs hit it: all 235 turns exited 0, every run ended `completed`, and no adapter, stderr or docker log mentions a trap error.
- **Shard launches.** The controller's local disk filled up while several shards copied the repository at once. Three shards (Opus bare, GPT-6.1 Sol bare, GPT-6.2 Sol bare) failed before any trial on the first launch, and two of them failed again on the retry. Each was then launched by itself from the same commit. The canary also failed twice before creating a VM: once because the VM lifetime was set below the shard timeout, and once on the same full disk. No trial ran twice, and no cell was split.

## Cost

- Paid model calls: $48.13 for 60 runs (cap $101). Opus 5.5 $15.98, GPT-6.1 Sol $15.19, GPT-6.2 Sol $16.96.
- VMs: about $2.97 at Ubicloud list price for the six shards, plus about $0.13 for five launches that failed before any trial.

## Files

- [run.json](../../hermes-757/run.json): the run's cells, arms, gbrain pin and cap.
- [results/trials.jsonl](trials.jsonl): merged records, unchanged. [results/verdict.md](verdict.md) and [results/verdict.json](verdict.json): the scorer's verdict. [results/failure-bare.md](failure-bare.md) and [results/failure-paste.md](failure-paste.md) (with CSVs): per-step failure tables.
- `<shard>.*`: each shard's manifest (o-paste's wasn't kept), preflight provenance, run summary and shard record. [results/shards.json](shards.json): which VM ran which cell, from which commit. Spend ledgers and proxy logs stay private under the repository's public-safety rule.
- `trials/`: per-trial transcripts, turn records, logs and egress. Harness state and workspaces aren't included. 6 copies of a gbrain maintainer's personal commit email, which GPT-6.2 Sol runs read from gbrain's commit history, are replaced with `<redacted-email>` and listed in [results/redactions.tsv](redactions.tsv). A scan for credential-shaped values and provider key patterns found none.

<details><summary>Run receipts</summary>

- Run commit: 006a19b84470 on branch gbrain-install-hermes-757 (the run spec c3e24f4f4c plus the Hermes image deviation). Every shard ran from that commit, one standard-16 Ubicloud VM per cell, trials one at a time.
- gbrain: tag v0.60.757.0, commit 915e3b30b285ac175d8808b7e9ba0f6e82ff21c3, a pre-release. The paste block is tasks/gbrain-install/arms/paste-0.60.757.0.md, sha256 1af1d596..., byte-identical to paste-0.60.734.0.md.
- Before: the published gbrain-install-2026-11 Hermes rows, rescored with the same verdict.ts. Block counts before come from that run's transcripts.
- Canary first: o-paste (Opus paste) finished its first trial and copied its results back before the other five shards started.

</details>
