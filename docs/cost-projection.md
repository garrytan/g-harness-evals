# Pricing a plan from its pilot, and checking a launch

**What this answers:** how much will this eval really cost, and should this shard launch now?

Two commands do it:

- `scripts/plan-cost.ts` prices a plan from what its pilot actually spent.
- `scripts/launch-preflight.ts` runs right before a counted launch. It refuses the launch if the plan would pass its spend stop, if a cell has no pilot price, or if a model provider won't answer.

**Why they exist.** In November 2026 a counted run guessed its per-trial costs from an older run. For several models the measured cost came in at about twice the guess or more, so the run reached its stop early and the stop had to be raised mid-run. Separately, one provider's credit ran out mid-shard, and a batch of trials became $0 infrastructure failures, because nothing asked the provider first.

## plan-cost: what the plan will cost

```sh
bun scripts/plan-cost.ts docs/benchmarks/<run>/ \
  --pilot <pilot results dir> [--pilot <dir> ...] \
  [--results <counted results dir> ...] \
  [--ledger <ledger.sqlite> ...] \
  [--stop <usd>] [--own-usd <n>] [--out <receipt.json>]
```

For each cell (one model in one harness), it works out:

- **Cost per unit.** Every dollar the cell's pilot spent, divided by the pilot trials that got a score.
  - Money spent on trials that failed for infrastructure reasons, or were rerun, stays in the cost. A counted run pays for those too.
  - Those failed trials don't count as units, so the cost per scored unit goes up, which matches what the counted run will pay.
  - `usage.usd` already includes reservations the proxy charged in full. They are counted once and shown on their own.
- **Units left.** The plan's counted units (tasks times attempts) minus the scored trials already in `--results`. A held-out cell of a sealed set is counted without opening the set: its units are the set's public `task_count` times its tries, or for a cell that names task families, the generator's public count for those families (today only the owner-identity families have one, so any other family is refused).
- **Projected cost.** Cost per unit times units left.
- **A 95% upper bound** from resampling the pilot trials, printed beside the average. Pilots are small and a few trials can cost far more than the rest, so read the two together.

It then adds:

- **Spent so far:** the settled spend in every `--ledger` (pass all of them, pilot and counted), the VM bills in the `shard-vm.json` files next to the results, and your own model use if you pass `--own-usd`. A script can't read Capy's meter, so own use is left out unless you pass it.
- **VM still to come:** units left, times the pilot's median trial wall time, divided by the plan's concurrency, at the standard-16 list price of about $0.50 an hour. This is an estimate and doesn't include VM setup time.

**The stop** comes from the plan's `## Cost projection` section (`- Spend stop: $<n>`). A frozen plan that has no such line takes `--stop <usd>`, and the output says the stop came from the command line.

**UNPRICED.** A cell with fewer than 5 scored pilot trials gets no number at all. We never fall back to the plan's guess. The total then leaves that cell out and says it is only a lower bound.

**Exit codes:**

| Exit | Meaning |
|---|---|
| 0 | the projected total is under the stop |
| 3 | over the stop (HE-BUDGET-005) |
| 4 | at least one cell with units left is unpriced (HE-BUDGET-006) |
| 2 | bad input |

When more than one applies, 2 wins over 4, and 4 wins over 3. Every refusal ends with a `NEXT:` line saying what to do.

**The receipt** (`--out`) names each input by repo-relative path or by file name with its sha256. It never holds an absolute path or a key, so you can commit it in the plan folder.

### Example

```
PLAN: example-run-2026-12 cells=4 stop=$2700.00 (stop from the command line)
CELL: grok-hermes model=xai:grok-4.7 pilot=8/9 scored usd_per_unit=$1.81 upper95=$2.40 unscored=11% ... remaining=148 projected=$267.88 lease=$190.00 OVER_LEASE
...
TOTAL: $2931.40; upper95 $3410.10; stop $2700.00
VERDICT: OVER HE-BUDGET-005 the projected total $2931.40 passes the stop $2700.00 by $231.40
```

(The numbers here are illustrative.)

## launch-preflight: should this shard launch?

```sh
bun scripts/launch-preflight.ts docs/benchmarks/<run>/ \
  --manifest ~/.capy/work/<run>/fanout.json --shard s07 \
  --dest <the shard's results root> \
  --ledger <every pilot and counted ledger> --pilot <pilot results dir> \
  [--results <counted results dirs>] [--also <provider:model>] [--gemini-cli-route openrouter-fallback]
```

Use `--cells a,b --lease-usd <n>` instead of `--manifest` when there is no manifest. Run it on the machine that holds the launch's provider keys. It does three things.

1. **Price.** It runs plan-cost over the whole plan. If a cell in this shard is UNPRICED, or the projected total passes the stop, it refuses.
2. **Check the providers.** It sends one tiny request to each provider and model the shard will call: the cells' models, their utility models, and any `--also`. Each request asks for the smallest output the provider accepts. A free "list models" call would answer fine on an account with no credit left, so it isn't enough.
   - Every request goes through the budget ledger's paid-request guard, on its own lease in `<dest>/preflight-ledger.sqlite`. The lease is sized from the guard's own reservation for each request. xAI reserves 500,000 reasoning tokens per call, for example, so the lease holds about $3 per xAI probe, but the actual spend is a fraction of a cent.
   - For OpenRouter it also reads the key's remaining limit (a free call) and refuses if that is below the shard's lease.
   - On Gemini CLI's `openrouter-fallback` route, a `google:` model is checked through OpenRouter as `google/<model>`, because that is where the shard's calls go. The route comes from the manifest (`--gemini-cli-route` after `--` in `options`, or in the shard's `args`), or from `--gemini-cli-route` without a manifest; with a manifest, a flag that disagrees with it is bad input.
   - Only a 2xx answer with a real completion passes. Other answers get these codes:

| Code | Answer | What to do |
|---|---|---|
| HE-PROVIDER-001 | key missing, 401, or 403 | check the key is the project's key for that provider and can use that model |
| HE-PROVIDER-002 | 402, or a 400, 401 or 403 that mentions credit, balance, quota, billing, payment, an exhausted allowance or a spending or monthly limit, or a 429 that mentions credit, billing, payment, a spending or monthly limit or `insufficient_quota` (a bare quota or resource-exhausted 429, or one that only says "check your plan and billing details", is a rate limit, HE-PROVIDER-004); or an OpenRouter limit below the lease | a person tops up at the billing page printed in the line, then reruns the preflight |
| HE-PROVIDER-003 | 404, any other 4xx, or a 2xx that isn't a completion | check the model id; a model this key can't call fails every trial |
| HE-PROVIDER-004 | a rate limit, twice (one retry after its Retry-After, capped at 30 seconds) | rerun in a few minutes |
| HE-PROVIDER-005 | a 5xx or no answer, twice | rerun in a few minutes |

3. **Write the receipt** to `<dest>/launch-preflight.json`. It holds the verdict, the commit it vouches for, the projection, each probe's status and error type, the probe spend and any override. With `--manifest`, that commit is the manifest's when the plan folder and every `--plan-file` match it in the repository that holds them, so a run pinned at an older commit is checked from a newer checkout. A new file in the plan folder counts as a difference, and so does an ignored `prereg*.json` or `PREREGISTRATION.md`, since the plan is read from those; other ignored files, such as a pilot's results, don't. When they differ, or the manifest's commit isn't in that repository, it vouches for no commit (`COMMIT: none`), which `fanout.sh` refuses; without `--manifest` it is the commit this checkout is at. A manifest shard whose cells differ from the plan's shard of the same name is refused (HE-RUN-002), since Harbor runs the plan's cells under that name. The receipt also keeps this checkout's commit as `tool_commit`, and whether it had no uncommitted or untracked change as `tool_clean`. `fanout.sh` launches a shard only when its receipt also names the run id of the manifest's prereg and the shard's cells, `lease_usd` and Gemini CLI route exactly as the manifest gives them.

The output and the receipt only ever carry a provider's status code, error type and error code. They never include its message or body, because some providers echo part of the key back.

**Exit codes:** 0 pass (or overridden), 3 refused, 2 bad input. Bad input can't be overridden.

### Override

Only the coordinating agent decides to launch past a refusal. Add both flags:

```sh
--override "<why this launch goes ahead>" --override-by <thread code>
```

The run then prints `OVERRIDE:` lines, writes the override into the receipt, and appends one line to `<dest>/launch-overrides.jsonl` with who, which user and host, when, and every refusal it overrode. Both files sit in the shard's results directory, so they travel with the results.

## The plan check before freeze

A counted plan above $500 paid that freezes on or after 2026-11-23 needs this section in its `PREREGISTRATION.md` before it freezes. A plan freezes on the UTC date its commit reaches main; earlier plans are exempt.

```markdown
## Cost projection

- Spend stop: $<n>
- Pilot-priced projection: $<the TOTAL plan-cost printed>
- Projection receipt: plan-cost-receipt.json
```

`bun runner/prereg/prereg.ts` (CI's prereg job) refuses the plan when:

- a field is missing;
- the projection passes the stop;
- the receipt isn't committed in the plan folder;
- the receipt leaves a cell unpriced;
- the receipt's total or stop differs from the plan's by more than a cent.

So the pilot runs first, uncounted and under its tenth-of-budget cap (the plan's `## Pilot` table), and the plan freezes with the price the pilot measured. Plans registered before 2026-11-19 are exempt through the existing grandfather list.

## When credit runs out mid-shard

A shard stops once one provider has refused 3 of its trials in a row for want of credit (`runner/cost/provider-stop.ts`):

- **What counts.** A trial counts against a provider when that provider answered it with a 402 at any point, or when its last answer in the trial was one the HE-PROVIDER-002 rule above reads as a credit refusal (a 429 counts only when it names credit, billing, payment, a spending or monthly limit or `insufficient_quota`, since Google words every rate limit as an exhausted quota; Google's "check your plan and billing details" on a 429 is a rate limit too). A 401 or 403 without that rule's credit wording is missing access, not credit, and doesn't count. A trial that called the provider and got anything else resets the count. The proxy's own refusals (the lease, the allowlist) never count.
- **Why 3.** One or two stray refusals don't stop a shard. A provider that is really out of credit costs about three more $0 trials before the shard stops, and a refused trial usually fails at its first call. A frontier-harbor shard can lose a few more: it judges a trial only after 5 quiet minutes and checks once a minute, so trials that start in that time are refused too.
- **What happens.** The runner (`runner/trial/run.ts`) stops after that trial, writes `provider-stop.json` in the run directory and exits 8 (HE-PROVIDER-006). When that was the last trial the run selected (all of them, or its `--cells`), nothing is left to stop: it exits 0 and still writes the file, and `run-summary.json` counts the run complete only when every trial in the manifest is recorded. A frontier-harbor shard runs the same check every 60 seconds over the proxy's usage log, counting only lines logged since the shard started and only trials that have logged nothing for 5 minutes (a harness still retrying is not judged yet), stops Harbor, writes the records so far and `provider-stop.json`, and exits 8. Either way the Ubicloud lane copies the results back and destroys the VM.
- **Recovery.** A person tops up or fixes access, the launch check passes again, then the shard resumes (`--resume`).

## What this doesn't do yet

- `scripts/ubicloud/fanout.sh` doesn't run the preflight for you. It refuses to launch a counted shard without a receipt from it, though: see [ubicloud.md](ubicloud.md).
- Own model use on Capy's meter is only counted when you pass `--own-usd`.
- Re-projecting between shards means running the same command again with the new `--results` and `--ledger` files. It doesn't happen automatically.
- Only runner `prereg.json` plans and `frontier-harbor/1` plan files are read.
