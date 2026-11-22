# OpenClaw on gbrain v0.60.760.0: rerun of the OpenClaw rows

Regression check of gbrain's OpenClaw install fix. Run `gbrain-install-openclaw-760-2026-11` plus its top-up run `gbrain-install-openclaw-760-topup-2026-11`, gbrain v0.60.760.0 (1597b77ac8b7), run 2026-11-22. It reruns the OpenClaw rows of [gbrain-install-2026-11](../README.md) (v0.60.734.0) with the same task, OpenClaw pin, arms and scorer, plus one GPT-6.2 Sol cell per arm. 60 counted runs: 10 per cell. particle-1 wasn't rerun.

## Takeaways

- **We learned that gbrain 760 fixed the OpenClaw recall gap for Opus 5.5 and GPT-6.1 Sol.** On the same four cells, runs that finished went from 28 of 40 to 39 of 40. 37 of those 40 runs installed gbrain's OpenClaw turn rule with `gbrain setup openclaw`, which tells a new session to ask gbrain first. In 734, 10 of the 12 misses on these cells had saved the fact to gbrain, and in 11 of the 12 the fresh session never called gbrain at recall. You should keep `gbrain setup openclaw` in the same step as the MCP registration in gbrain's install docs.
- **What still fails: GPT-6.2 Sol with no instructions (2/10).** In 7 of 10 runs it installed gbrain and made a brain, then chose not to connect it to OpenClaw. It said it couldn't confirm the brain would stay private in what it took to be a shared or group chat, or that it couldn't reach OpenClaw's gateway. With the README paste block, GPT-6.2 Sol finishes 9/10.
- **gbrain's privacy rules caused two of the other three misses.** Opus 5.5 bare r5 saved the fact as a private fact, and the recall connection didn't return private facts. GPT-6.2 Sol paste r9 refused to save because its chat was marked as a group.

## Before and after

Finish line = the recall reply holds the nonce, and gbrain served it in a fresh session. The column shown is a+b+c, the headline scoring of the 734 run. For OpenClaw, a+c and a+b+c give the same numbers (rule b only touches Claude Code). The pinned scorer as first written gives 0 for every OpenClaw cell, in 734 and in 760, because it doesn't see gbrain calls inside OpenClaw's `tool_call` wrapper (scorer fix a). Each cell is k of n with a Wilson 95% interval.

| Cell | Arm | v0.60.734.0 (before) | v0.60.760.0 (after) | Misses, before → after |
|---|---|---|---|---|
| OpenClaw, Opus 5.5 | bare | 6/10 (31% to 83%) | 9/10 (60% to 98%) | 4 → 1 |
| OpenClaw, Opus 5.5 | paste | 10/10 (72% to 100%) | 10/10 (72% to 100%) | 0 → 0 |
| OpenClaw, GPT-6.1 Sol | bare | 6/10 (31% to 83%) | 10/10 (72% to 100%) | 4 → 0 |
| OpenClaw, GPT-6.1 Sol | paste | 6/10 (31% to 83%) | 10/10 (72% to 100%) | 4 → 0 |
| OpenClaw, GPT-6.2 Sol | bare | not run | 2/10 (6% to 51%) | 8 |
| OpenClaw, GPT-6.2 Sol | paste | not run | 9/10 (60% to 98%) | 1 |
| **Same four cells** | | **28/40** | **39/40** | **12 → 1** |

- Each cell has n=10, so a single cell can only show a large change. No single cell moved by more than 40 points. The plan's smallest detectable change at n=10 (about 55 points) was worked out only for a drop from a 60% rate, so it says nothing about these rises. The four cells together moved from 28/40 to 39/40.
- The paste prompt is byte-identical to 734's, but it sends the agent to gbrain's INSTALL_FOR_AGENTS.md on master, which changed between the two runs. So the paste arm measures today's docs, not a frozen page.
- GPT-6.1 Sol's 10 runs per cell include 4 bare and 3 paste runs from the top-up run. See "Deviations and caveats".

## Where the remaining runs failed

| Cell | Failed | What happened |
|---|---|---|
| Opus 5.5 bare | 1 | r5 installed, wired and saved the fact to gbrain as a private fact. In the fresh session, gbrain's search didn't return it, and the agent said the connection only shows facts not marked private. It answered from its earlier chat instead, which doesn't count. |
| GPT-6.2 Sol bare | 8 | 7 runs (r1, r2, r4, r6, r7, r8, r9) installed gbrain and made a brain, then left it disconnected from OpenClaw. r1, r2, r4 and r9 said they couldn't confirm the brain would stay private in a shared or group chat. r6, r7 and r8 said OpenClaw's gateway was unreachable, and r8 also gave the privacy reason. r5 wired and saved, then answered the recall question without a gbrain call, and its hinted gbrain search found nothing. |
| GPT-6.2 Sol paste | 1 | r9 refused to save the fact to gbrain because "this chat is marked as a group", and didn't check gbrain at recall for the same reason. |

## Which gbrain each run installed

- **Every run got v0.60.760.0** (all 67 trials, including the 7 not counted). gbrain's version probe never saw another version. No run fetched gbrain's `releases/latest` URL (GPT-6.2 Sol paste r8 fetched Bun's). `latest` still served v0.60.753.0 when the run started.
- Routes, counted runs: `bun install -g` from GitHub by tag in 47, `git clone` and `bun link` in 13. That's the runner's install classification.
- **`gbrain setup openclaw`.** It installs gbrain's turn rule into OpenClaw (state/openclaw/gbrain/gbrain-turn-rule). Counted runs that have it: Opus 5.5 bare 10 of 10, paste 10 of 10; GPT-6.1 Sol bare 8 of 10, paste 9 of 10; GPT-6.2 Sol bare 0 of 10, paste 9 of 10.

## Deviations and caveats

- **No new deviation for OpenClaw.** The image carries the Hermes rerun's declared deviation (the `hermes` link at /usr/local/bin, 2026-11-21), which touches only the Hermes image. The OpenClaw adapter and pin are unchanged.
- **Seven GPT-6.1 Sol runs were lost to our lease sizing and rerun.** Our metering proxy reserves a request's worst-case cost before forwarding it. In the GPT-6.1 Sol shards those reservations would have passed the shard budgets ($13 bare, $18 paste), so the proxy refused requests in bare r7 to r10 and paste r7, r9 and r10. Those runs ended as `model_error`, which the scorer doesn't count. They spent $5.81, and their records stay in [trials.jsonl](trials.jsonl) unchanged. The runner never reruns a recorded trial under the same run id, so a dated top-up spec ([run.json](../../openclaw-760-topup/run.json)), committed before its trials, ran 4 bare and 3 paste replacements with new seeds and everything else unchanged. All 7 finished. Results: [topup/](topup/).
- **Harness-script check.** No trial hit the bash 5.2.21 `trap` error. All turns of the 60 counted runs exited 0, and no adapter, stderr or docker log mentions a trap error. Four turns exited 2, two each in GPT-6.1 Sol paste r9 and r10, after the proxy's budget refusals above, in runs already not counted.
- **Three things changed between the two runs, not one:** the gbrain build (734 to 760, which includes 757's Hermes fix and 760's OpenClaw step and `gbrain search` change), master's INSTALL_FOR_AGENTS.md, and the Hermes link above, which OpenClaw doesn't use.
- **Shard launches.** The canary's first launch was killed by a 2-minute timeout on our own controller before any trial ran. Its VM was destroyed with no trial and no spend. Two later launch waves (5 shards, then 3) failed before any trial because the controller's disk filled while shards copied the repository at once. Each shard then ran by itself from the same commit. No trial ran twice, and no cell was split.
- **Trial state.** Package caches (node_modules, Bun and npm caches, the bun binary) were trimmed from finished trials' state on the VMs and locally, with #494's prune scripts, so the run fit on disk. State isn't published, and the brain and OpenClaw's own files were kept for the rescore's scan.

## Cost

- Paid model calls: $72.25 for 67 trials (cap $101). Opus 5.5 $24.24, GPT-6.1 Sol $31.27 (including $5.81 on the 7 runs lost to lease sizing), GPT-6.2 Sol $16.74.
- VMs: about $3.93 at Ubicloud list price for the seven shards, plus about $0.30 for the image check, the killed canary launch and the failed launches.

## Files

- [run.json](../../openclaw-760/run.json) and [topup run.json](../../openclaw-760-topup/run.json): the cells, arms, gbrain pin and cap.
- [trials.jsonl](trials.jsonl) and [topup/trials.jsonl](topup/trials.jsonl): merged records, unchanged. [verdict.md](verdict.md) and [verdict.json](verdict.json) (with copies under topup/): the pinned scorer's verdict, which reads 0 for OpenClaw as explained above.
- [rescore/](rescore/) and [topup/rescore/](topup/rescore/): rescored.jsonl and rescore.json from the 734 run's rescore.ts (scorer fixes a, b and c, unchanged), and the inputs it scanned from trial state.
- `<shard>.*`: each shard's manifest, preflight provenance, run summary and shard record. [shards.json](shards.json): which VM ran which cell, from which commit. Spend ledgers and proxy logs stay private under the repository's public-safety rule.
- `trials/`: per-trial transcripts, turn records, logs and egress. Harness state and workspaces aren't included. Copies of a gbrain maintainer's personal commit email, which runs read from gbrain's commit history, are replaced with `<redacted-email>`: 12 copies in 5 files, listed in [redactions.tsv](redactions.tsv). The top-up runs had none. A scan for provider key patterns matched only random text inside OpenClaw's encrypted reasoning blobs.

<details><summary>Run receipts</summary>

- Run commits on branch gbrain-install-openclaw-760: 5ab4fdcf76ac (the run spec) for the six shards, and 184670fd5a90 (the top-up spec) for the top-up shard. One standard-16 Ubicloud VM per shard, trials one at a time.
- gbrain: tag v0.60.760.0, commit 1597b77ac8b7fe82d671cc9c874a916b33152d57, a pre-release, the newest release on gbrain's master at launch. The paste block is tasks/gbrain-install/arms/paste-0.60.760.0.md, sha256 1af1d596..., byte-identical to paste-0.60.734.0.md.
- Before: the published gbrain-install-2026-11 OpenClaw rows under that run's rescore (a+b+c).
- Canary first: o-paste (Opus paste) ran all 10 trials and copied its results back before the other five shards started.
- Image check: scripts/gbrain-install/real-image-check.sh passed on one VM for OpenClaw at v0.60.760.0 before the canary (keyless, against a fake model).

</details>
