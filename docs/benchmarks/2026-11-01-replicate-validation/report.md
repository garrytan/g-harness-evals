# replicate-validation-2026-11: the rerun path held its cap and gave WITHIN BAND on H1's OpenClaw cell

**Tooling validation, not a finding.** The cell runs Sonnet 5.5, which R54 rules out as a model under test. The verdict below is about `scripts/replicate.ts` only. It says nothing about OpenClaw, gstack or gbrain.

**The answer:**

- **The cap held.** Step 2 (cap $0.60) ended INCOMPLETE with exit 3 after the metering proxy refused a reservation that would have passed the cap. Committed spend: $0.1417312.
- **The one-rep rerun landed inside the band.** Step 3 passed 15 of 20 (75.0%, 95% CI 55.0% to 90.0%) against a band of 12 to 17. Rerun minus published: -2.0%, task-paired 95% interval -9.0% to 3.0%.
- **It cost what the estimate said.** Step 3 committed $3.5170811 against an expected $3.47 and a high of $3.92.
- **Two gaps showed up.** A hung `docker build` has no timeout, and no rerun bundle is built when `--out` is outside the checkout.

## What ran

- **Preregistration:** [PREREGISTRATION.md](PREREGISTRATION.md), merged in #283.
- **Rerun commit:** `1d8c64dd86288cfe7590b16995e5c3d656878094`, the #283 merge. Both paid steps loaded it (`replicate-state.json` "commit").
- **Bundle:** H1's bundle of `m3-heldout-2026-10`, sha256 `01a6ef9f4395ed7672a7ea093dd3739646503eb3b70f2a6a7aa56ccd5d3f9c24`, built at the rerun commit. `verify --rebuild` returned ok (`results/bundle.txt`).
- **Cell:** `openclaw-sonnet-mu-heldout`: OpenClaw, `anthropic:claude-sonnet-5-5`, the 20 v0.1 held-out tasks, 1 repetition.
- **Machine:** a Capy cloud machine, a clean clone, every step started with `env -i` and only `PATH`, `HOME` and `ANTHROPIC_API_KEY`, as a background job with `--yes` (HARN-41's record; no results file holds the command line). No Ubicloud VMs.

| Step | Run id | Exit | Label | Cap | Committed | Wall |
|---|---|---|---|---|---|---|
| 1a `--reanalyze` | none | 0 | MATCH | $0 | $0 | 3 s |
| 1b `--estimate-only` | none | 0 | estimate printed | $0 | $0 | 1 s |
| 2, attempt 1 | `...-20261105t185532-5c9e` | no exit line | killed in the image build | $0.60 | $0, no lease opened | 18:55:32Z to 20:56:01Z |
| 2, attempt 2 | `...-20261105t210130-0ed9` | 3 | INCOMPLETE (cap stop) | $0.60 | $0.1417312 | 1 m 13 s |
| 3 | `...-20261105t210306-78f4` | 0 | WITHIN BAND | $5.00 | $3.5170811 | 30 m 34 s |

Run ids start `replicate-openclaw-sonnet-mu-heldout`. Times are from `results/timing.txt`; spend is from each step's `ledger.sqlite`.

## Step 1: the free checks

Excerpt of the tool's lines (`results/step1/`; the hermes estimate line and both `exit=0` lines are left out):

```
REANALYZE: MATCH: summarize-run, compare-run at this checkout (1d8c64dd8628) print expected-output.txt byte for byte (bundle 01a6ef9f4395, run m3-heldout-2026-10)
ESTIMATE: openclaw-sonnet-mu-heldout at 1 rep(s): 20 trials, expected $3.47, high $3.92 (95th percentile of 10,000 task-resampled totals), largest single reservation $0.77, about 30 minutes; smallest --max-usd $4.69 (approximate: repriced from token counts at this commit and rounded up)
ESTIMATE: qm-pi-sonnet-mu-heldout: HE-REPL-011 cell qm-pi-sonnet-mu-heldout runs QM, which needs its pinned qm-sandbox image and its sandbox teardown; this tool builds and cleans neither yet. fix: choose a cell of another harness
```

- The QM line is a known limit of the tool. It is not the step's cell, and the estimate step exited 0.
- Every paid step repeated the equivalence check: `EQUIVALENCE: regrade 100/100 published trials, 0 changed`, and `"ok": true` in each report.

## Step 2: the cap-stop test

Excerpt of the tool's lines (the end of `results/step2/step2b.out`; the run-count line and the `BUNDLE:` line are left out):

```
trial replicate-openclaw-sonnet-mu-heldout-20261105t210130-0ed9/openclaw-sonnet-mu-heldout/ho-03-pellucid-prep-call/r1: termination=model_error grade=n/a consent_violation=false wall_ms=56632 usd=0.1417 cap_stop
HE-BUDGET-001 the rerun reached its --max-usd cap; the trial that hit it is left out. A cap stop is the end of this rerun: start a new one with a larger --max-usd if you want.
INCOMPLETE (cap stop): 0 of 20 trials kept, 0 passed; nothing is extrapolated and no band is compared. Spend $0.14 of the $0.60 cap. A cap stop is the end of this rerun; start a new one with a larger --max-usd if you want.
exit=3
```

- **What stopped it was a refused reservation.** The proxy forwarded 4 requests and refused 2 (`run-results/proxy.log`). The first refusal in `run-results/proxy-usage.ndjson`: "reserving $0.5222 would take this run to $0.6639, over its $0.60 budget", status 402.
- **Committed spend never crossed the cap.** It stopped at $0.1417312, with $0 overshoot in the ledger.
- The one trial ended `model_error` with `cap_stop`. Both its turns logged "exit 2, no reply (harness error)" after the refusals.

## Step 3: the one-rep rerun

Excerpt of the tool's lines (the end of `results/step3/step3.out`; the `BUNDLE:` line is left out):

```
RERUN: 15 of 20 passed (75.0%, 95% CI 55.0% to 90.0%); published 77 of 100 (77.0%)
DIFFERENCE: rerun minus published -2.0%, task-paired 95% interval -9.0% to 3.0%
BAND: 12 to 17 passes of 20 (95% posterior-predictive, attained 97.5%; coverage 98.3%, docs/replicate/band-coverage-m3-heldout-openclaw.json)
WITHIN BAND
exit=0
```

- 20 of 20 trials recorded and kept. None errored, none hit the cap.
- 16 ended `completed` and 4 ended `approval_stop`; all 4 approval stops graded pass.
- The 5 fails: `sd-03-coastal-week-ahead`, `sd-04-strategic-brief`, `sd-05-kwame-dm-digest`, `sd-06-pod-end-of-day`, `si-06-quillfeather-door`.
- The proxy forwarded 180 requests and refused 0.

## Money

- **Total paid: $3.6588123** (step 2 $0.1417312 + step 3 $3.5170811), from 4 + 180 ledger entries.
- The prereg's lane cap is $25. The two paid steps were capped at $5.60 together.
- No Ubicloud VMs, and no paid smoke or preflight.
- The lane line is in `docs/ledger/lane-spend.jsonl` (HARN-41, 2026-11-05).

## Leases

- **Both `replicate-report.json` files show `lease_open: true`.** They were written at run end, before the leases were closed.
- **Both leases were then closed on the Captain's instruction**, at their committed amounts, with `runner/ledger/budget-ledger.ts close` at the rerun commit. Verify reported `reconciled` on both: 4 entries settling $0.1417312 and 180 entries settling $3.5170811 (`results/lease-close.txt`).

The ledger `runs` lines, verbatim from `results/lease-close.txt`:

```
run_id|budget_usd|started_at|finished_at|committed_usd|overshoot_usd
replicate-openclaw-sonnet-mu-heldout-20261105t210130-0ed9|0.6|2026-11-05T21:01:45.796Z|2026-11-05T21:38:46.384Z|0.1417312|0.0
replicate-openclaw-sonnet-mu-heldout-20261105t210306-78f4|5.0|2026-11-05T21:03:08.896Z|2026-11-05T21:38:46.456Z|3.5170811|0.0
```

## Stop rules

| Rule | What happened | Fired? |
|---|---|---|
| Equivalence refuses, or the regrade changes a published grade | ok, 100/100 regraded, 0 changed | No |
| Step 2 spends over its cap, or does not end INCOMPLETE with exit 3 | INCOMPLETE, exit 3, $0.1417312 of $0.60 | No; step 3 went ahead |
| `--reanalyze` mismatch (exit 4), or a refusal (exit 2, HE-REPL, HE-BUNDLE) | MATCH. The QM line's HE-REPL-011 is on another cell, and the step exited 0. Attempt 1 raised no code: it was killed with no exit line | No |
| HE-REPL-007 (estimate over the step's cap) | smallest cap $4.69, under the $5.00 cap | No |
| Step 3 OUTSIDE BAND | WITHIN BAND | No |
| Step 3 INCOMPLETE | complete, 20 of 20 kept | No |
| Step 3 NO BAND | band 12 to 17 printed | No |
| A machine restart | the machine booted once, after attempt 1 was killed (see Deviations). No lease was open, so no `--resume` applied | Recorded |

## Deviations

- **Step 2 attempt 1 hung, and HARN-1 approved one rerun.** Attempt 1 hung in the OpenClaw image build for 2 hours. The 7,200 s operation timeout killed it at 20:56:01Z, before any lease, at $0. HARN-1's decision, verbatim from `results/timing.txt`:
  > "Captain HARN-1, 2026-11-05: step 2 may rerun once with a fresh --out (new run id), at the same commit, bundle and $0.60 cap. The killed attempt was an infrastructure hang before any lease, not a cap stop, so the no-retry rule doesn't apply. Record it as a deviation."
- **Why it hung:** `buildImage` in `scripts/replicate.ts` runs `docker build` through `spawnSync` with no timeout. A keyless build that reused the hung build's cache failed with `exec /bin/sh: exec format error` (`results/step2-attempt1/diag-build.log`). After a builder prune the same build passed, 20:57:19Z to 20:58:23Z (`diag-build2.log`). So a corrupt cached base layer is the likely cause.
- **The validation machine restarted once.** It booted at 20:56:10Z, 9 s after attempt 1 was reported timed out, and attempt 1's process did not survive (`results/timing.txt`). Both diagnostic builds and both paid steps ran after the boot, at the rerun commit. No restart happened during either paid step.
- **An earlier validation machine died during the initial clone.** It was replaced before any step ran (HARN-41's record; no results file covers it).
- **No rerun-bundle digest exists**, though the prereg's results list names one. Both paid steps printed `BUNDLE: not built: --out ... is outside the checkout`, and each `rerun-bundle-digest.txt` holds that error.
- **Step 1's output is split into two files**, `step1-reanalyze.out` and `step1-estimate.out`.
- **Both reports show `lease_open: true`** (see Leases).
- **Every paid step warned `HE-PROXY-001 OPENAI_API_KEY is not set in this shell`.** This is expected under `env -i`: the cell calls only Anthropic.

## What #283's review flagged, and what this run shows

- **The equivalence check lets adapter and runner drift through.** For the harness it compares only `pin.json`'s fields and the Dockerfile's `ARG` lines; it prints the size of other drift. Here it printed `harnesses/openclaw: 14 files changed, 784 insertions(+), 14 deletions(-)` and `runner: 39 files changed, 6758 insertions(+), 520 deletions(-)` since `m3-heldout`, and still returned ok. WITHIN BAND at one rep does not show that drift is harmless: the band spans 12 to 17 of 20.
- **Step 2 tested a refused reservation, not committed spend crossing the cap.** The proxy refused before spending, so the path where settled spend overshoots a lease was not exercised. The ledger records $0 overshoot.
- **`env -i` puts the key in argv until exec.** Every step started that way, so the key sat in the argument list of a short-lived `env` process until it exec'd the tool. docs/replicate.md's own recipe (`read -rs`, then `export`) avoids that. No committed file carries a key-shaped token.

## Follow-ups (not done here)

- **A `docker build` timeout in `scripts/replicate.ts`**, so a hung build raises HE-REPL-012 instead of hanging until the operation is killed.
- **The rerun bundle when `--out` is outside the checkout.** Today the tool runs the paid steps and only then skips the bundle. It should build the bundle anyway, or refuse before any spend; docs/replicate.md does not mention the limit.

## Receipts

`results/` holds:

- `bundle.txt`, `timing.txt`, `lease-close.txt`.
- `step1/`: the two step 1 outputs.
- `step2-attempt1/`: `step2.out`, `replicate-state.json` and the two diagnostic build logs.
- `step2/` and `step3/`: the step's `.out`, `replicate-report.json`, `runner.log`, `ledger.sqlite`, `prereg.json`, `replicate-state.json`, `rerun-bundle-digest.txt` and `build-openclaw.log`. Their `run-results/` keeps the run-level files: `trials.jsonl`, `manifest.json`, `run-summary.json`, `proxy-usage.ndjson`, `proxy.log` and `run.log`.
- **The grades are in `results/step3/run-results/trials.jsonl`** (20 lines). Step 2's one trial is in `results/step2/run-results/trials.jsonl`.
- **The per-trial `trials/*/` directories are not committed.** They hold large OpenClaw state sqlite files and the mock world's per-trial Slack bot tokens. They stay on the validation machine and in HARN-41's work directory.

## Why null?

Not applicable. The result is neither null nor negative for any skill, gstack, gbrain or harness layer, and the run validates tooling only.

Verdict (tooling only): KEEP `scripts/replicate.ts`'s rerun path: on one Sonnet 5.5 cell it held a $0.60 cap by refusing a reservation and gave WITHIN BAND (15 of 20, band 12 to 17) for $3.5170811 of a $5 cap; it says nothing about OpenClaw, gstack or gbrain, and the build timeout and the `--out` bundle gap stay open.

## Disclosures

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI. OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
