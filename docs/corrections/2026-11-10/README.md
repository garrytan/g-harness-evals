# Corrections of 2026-11-10: a 15 s egress cut, Pi's lost task, and two runs we can't size

**We learned that our egress sidecar cut slow model replies at 15 s, and in the frontier-harness run it touched one cell.** Hermes Agent on GPT-6.1 Sol paid for 39 requests the sidecar had already closed. Taking all of those charges out lowers its cost per solved task by under 2%. Only 7 of the 39 were resent, so that is the upper bound of the effect, and no verdict or rank changes either way.

**You should read Pi's frontier rows with the sensitivity below beside them.** Pi never started on one of the 52 tasks, so the preregistered rules dropped that task from Pi's pairs. Scored as Pi fails instead, both Pi rows still pass within the 15-point margin, though on Opus only just (Holm-adjusted p 0.043 against 0.05).

All of this is about the frontier-harness results (pull request #337). Every number here is rebuilt keylessly from committed receipts by `bash scripts/corrections/reproduce-2026-11-10.sh <scratch dir> --check`, which compares its output with [sensitivity.json](sensitivity.json). Nothing under docs/benchmarks/ was edited: each report and trials.jsonl is byte-identical.

## What changed, in one list

1. **15 s egress cut (correction applies, as an upper bound).** Only Hermes Agent on Sol was cut. With every cut charge taken out, its cost per solved task goes from $0.4324 [$0.3114, $0.5954] to $0.4247 [$0.3052, $0.5854]. Only 7 of the 39 cut requests were resent, so the true effect is smaller. No verdict or rank changes either way.
2. **README footnote.** It said Hermes Agent's cost range on Sol clears Pi's, which was true of the published figures. Hermes's range overlaps Pi's under the 2026-11-09 correction ($0.29, or $0.2813 with both) and at the 15 s cut's upper bound ($0.3052). It does not overlap at the cut's lower bound alone: $0.4313 [$0.3108, $0.5940] against Pi's top of $0.3068. The footnote now says so, and no rank moves.
3. **Pi's pytorch-model-recovery task (disclosure and sensitivity).** All 7 of Pi's runs of it made 0 model requests. Scored as fails, Pi's pass rate moves from 81.4% to 79.8% on Opus and from 80.4% to 78.8% on Sol. Both still pass within 15 points.
4. **Two earlier Harbor runs can't be sized.** opus-gstack-follow and investigate-gate ran behind Harbor's own egress sidecar and kept no per-request logs.

## 1. The egress sidecar cut model replies at 15 s

- **Problem.** Each Harbor trial reaches our metering proxy through an egress sidecar (gost). gost's default read timeout is 15 s: if the reply has not started 15 s after the request, it closes the connection. The proxy doesn't see the client leave. It finishes the call, records it and pays for it, and the harness usually sends the same request again. A streamed reply starts within seconds, so in practice only non-streamed calls, and streamed calls whose first byte was slow, could be cut.
- **How we found the cuts.** A paid, answered request counts as cut when the ledger shows its upstream call took more than 15 s and either it was not streamed, or the same trial sent the same request (same model, route and prompt token total) 15 to 17 s after it. The scan reads all 34 proxy logs of the run and the ledger beside each, and matches every paid request to its ledger entry (0 unmatched).
- **Size.** Of the 20 cells (8 main, 8 kept sample, and the 4 GPT-6 Astra and Claude Fable 5.1 extension cells), only Hermes Agent on Sol had a cut. In the runs its published cost counts, it had 39 cut requests, 7 of them resent, in 11 of its 104 trials. They were paid $0.68, 1.78% of that cell's published spend. 14 more were in outage runs that reruns replaced, which the headline cost leaves out.
- **Which calls.** Every cut, counted or replaced, was a non-streamed chat call from Hermes Agent. Most were in tasks that work with images or video: video-processing alone had 26 of the 53. So they were most likely Hermes's image tool. That is an inference: request bodies are not committed.
- **Correction.** Take the cut requests' paid cost out of the spend the analysis reads, then rerun the run's own analyze.ts (same spec, seed 7, 10,000 draws).
- **This is an upper bound.** Only 7 of the 39 counted cut requests were resent; the other 32 were not. A resent request is a plain duplicate, so its charge clearly bought nothing. For the 32, a working sidecar would still have made each call once and paid for it, unless Hermes's later calls replaced that answer. Removing all $0.68 assumes each lost answer was replaced by work costing at least as much. So the true effect lies between removing $0.10 (the 7 resent requests) and removing $0.68 (all 39). The table shows the upper bound. No verdict or rank changes at either end.

| Number | Published | Cut charges removed |
|---|---|---|
| Hermes Agent on Sol, cost per solved task [95%] | $0.4324 [$0.3114, $0.5954] | $0.4247 [$0.3052, $0.5854] |
| Hermes Agent over Codex on Sol, paired cost ratio [95%] | 1.28x [1.05x, 1.54x] | 1.25x [1.04x, 1.51x] |
| Same ratio, replaced outage runs' spend included | 1.87x [1.51x, 2.29x] | 1.84x [1.49x, 2.25x] |
| Every other cell's cost and every other pair's ratio, kept sample and extension included | as published | unchanged |

- **Together with the 2026-11-09 correction** (reservation charges also left out), Hermes Agent on Sol is $0.3741 [$0.2813, $0.4964], against $0.38 [$0.29, $0.51] for that correction alone, and 1.22x [1.02x, 1.45x] Codex's cost. None of the cut requests was a reservation charge, so the two corrections don't overlap.
- **No verdict or rank changes.** Pass rates don't move, because only spend changes. Every Sol row still shares rank 1 under the README's rule.
- **Could a cut have changed a pass?** In principle, yes: Hermes lost that answer and 15 s. 8 of the 11 trials passed anyway, and video-processing/a2 was already excluded (a cap stop). raman-fitting/a2 failed with one cut, and make-doom-for-mips/a2 timed out with two (about 30 s of its 1,200 s). The trial directories are not committed, so we can't say whether the lost answers mattered. A post-hoc check that leaves those trials out changes no verdict:

| Variant (post hoc, cut charges removed) | Hermes Agent on Sol pass rate [95%], scored trials | Hermes minus Codex, points [95%] | Cost ratio vs Codex [95%] | Verdict |
|---|---|---|---|---|
| Published | 85.6% [76.9%, 93.3%], 103 | +1.9 [-4.8, +8.7] | 1.28x [1.05x, 1.54x] | within 15 points |
| Leave out the 2 cut trials that failed | 86.5% [77.9%, 94.2%], 101 | +2.9 [-2.9, +9.6] | 1.22x [1.01x, 1.46x] | within 15 points |
| Leave out all 11 cut trials | 84.7% [74.5%, 93.9%], 93 | +2.0 [-5.1, +9.2] | 1.17x [0.96x, 1.42x] | within 15 points |

The last row's cost ratio reaches below 1 because it also removes 8 passes and their spend. It is not a cost correction.

- **Fix going forward.** A sidecar setting that waits up to 900 s for a reply is written, but it is not on main yet. Until it lands, the frontier-harbor sidecar on main keeps gost's 15 s default.

## 2. The README's Sol footnote

The footnote under the GPT-6.1 Sol table said Hermes Agent's and OpenClaw's cost ranges clear Pi's, with Hermes's starting just above Pi's top. As published that was true: $0.3114 against $0.3068. Whether it still holds depends on the correction:

- under the 2026-11-09 reservation correction, Hermes's range starts at $0.29, below Pi's top;
- with both corrections, at $0.2813, below Pi's top;
- at the 15 s cut's upper bound (all 39 cut charges removed), at $0.3052, below Pi's top;
- at the 15 s cut's lower bound alone (only the 7 resent charges removed), Hermes Agent is $0.4313 [$0.3108, $0.5940], whose range starts above Pi's top, so the two ranges do not overlap. This one figure comes from rerunning analyze.ts with only those 7 charges removed; the reproducer does not rebuild it.

OpenClaw's range still clears Pi's. The footnote now says this, and no rank moves: Hermes Agent's and OpenClaw's ranges overlap Codex's either way, so all four rows share rank 1.

## 3. Pi never started on pytorch-model-recovery

- **Problem.** Harbor 0.24.0 passes the task instruction to Pi as the last command-line argument, with no `--` before it. This task's instruction starts with "- You are given a PyTorch state dictionary", so Pi 1.5.0 reads it as an option and exits with "Error: Unknown option: -" before it sends any request. All 7 of Pi's runs of the task ended this way: 2 counted attempts per model, plus 3 runs that outage reruns replaced. Every one made 0 model requests.
- **What the preregistration says.** A trial in which no request got an answer is class `no_model_response`, which is excluded and dropped pairwise. That is what the published rows do, so Pi's pairs have 51 tasks and every other harness has 52. It is a harness integration failure, not a model or network one, so we publish the other reading beside it: the same trials scored as Pi fails. This sensitivity was already among the run's committed results (results/sensitivity-pi-instruction-bug-as-fail/); the reproducer rebuilds it byte for byte.

| Number | Published (excluded, as preregistered) | Scored as Pi fails |
|---|---|---|
| Pi on Opus, pass rate [95%], scored trials on tasks | 81.4% [71.6%, 90.2%], 102 on 51 | 79.8% [69.2%, 89.4%], 104 on 52 |
| Pi minus Claude Code, points [95%] | -5.9 [-11.8, -1.0] | -7.7 [-14.4, -1.9] |
| Holm-adjusted non-inferiority p (15-point margin) | 0.0045 | 0.043 |
| Verdict | within 15 points | within 15 points |
| Pi over Claude Code, paired cost ratio [95%] | 0.97x [0.75x, 1.17x] | 0.99x [0.76x, 1.19x] |
| Pi on Sol, pass rate [95%], scored trials on tasks | 80.4% [70.6%, 90.2%], 102 on 51 | 78.8% [68.3%, 88.5%], 104 on 52 |
| Pi minus Codex, points [95%] | -2.9 [-11.8, +5.9] | -4.8 [-14.4, +4.8] |
| Holm-adjusted non-inferiority p (15-point margin) | 0.0092 | 0.031 |
| Verdict | within 15 points | within 15 points |
| Pi over Codex, paired cost ratio [95%] | 0.67x [0.51x, 0.85x] | 0.68x [0.51x, 0.87x] |

- **The closest call is Pi on Opus.** Its Holm-adjusted non-inferiority p rises from 0.0045 to 0.043, against a cutoff of 0.05. It stays within 15 points.
- **Knock-on effects.** Holm adjusts across each model's three pairs, so the other pairs' adjusted p values move too: Hermes Agent on Opus from 0.024 to 0.036, and OpenClaw on Sol from 0.015 to 0.031 (non-inferiority). No verdict changes. Pi's cost per solved task doesn't move, because these runs spent nothing and passed nothing. Every row still shares rank 1.
- **What we could not check.** Pi's own output for these runs is not committed. The exit cause rests on the trial records (0 requests, a non-zero agent exit), Harbor 0.24.0's command line, and the run report's quote of the error.
- **Fix going forward.** Putting `--` before the instruction gets Pi past option parsing. That change is written but not yet on main.

## 4. Two earlier Harbor runs can't be sized

opus-gstack-follow (2026-11-01) and investigate-gate (2026-11-03) ran on Harbor commit f3a5a923 behind Harbor's own gost egress sidecar. That sidecar's configuration sets no read timeout either, which is the setting that left ours at 15 s. Neither run kept per-request proxy logs or ledgers, so we can't tell whether any of their requests were cut, or what that would change. Their reports stand as published, with this caveat. We did not check which gost version that sidecar image runs.

## Reproduce

```
bash scripts/corrections/reproduce-2026-11-10.sh <scratch dir> --check
```

It runs scripts/corrections/harbor-cut.ts over the run's committed proxy logs and ledgers, scripts/frontier-harbor/subset.ts and analyze.ts on the corrected copies, and scripts/corrections/tables-2026-11-10.ts to collect [sensitivity.json](sensitivity.json). It needs the frontier-harness per-trial results (results/merged/ and results/extension/merged/). The public copy holds those back for one export, so there the reproducer cannot run.
