# M0 smoke preregistration

Status: draft, written 2026-10-22 before any trial. Run id `m0-smoke-2026-10`. Cells are in [prereg.json](prereg.json); `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-10-22-m0-smoke/prereg.json` prints the matrix and cost ceiling.

## Question

Can each harness adapter (OpenClaw, Hermes Agent, QM through Pi) run one headless trial of the hello task through the metering proxy on the fixed model, with every model call attributed to its trial by a per-trial key and reconciled within 1% of provider-reported usage?

## Fixed now

- Model: `anthropic:claude-sonnet-5-5` for every cell. **Amendment to plan D1 (2026-10-22, Garry):** the controlled arm runs on Anthropic and OpenAI keys rather than Kimi K3. The fixed model is the newest Sonnet, per the model rule in CLAUDE.md. Consequence recorded here and in TODOS: the coding-calibration gate against FrontierHarness' Hermes-on-K3 number (plan M3, acceptance "within the FrontierHarness 50% +/- CI") no longer applies as written; the calibration cell must either re-derive a Sonnet reference on the 21 tasks or compare against another published same-model-same-harness number before it can gate anything.
- Harness pins: whatever `harnesses/<name>/pin.json` records at the commit that runs the cell; a changed pin is a new run.
- Spend cap: $5 across the run, enforced by the metering proxy's lease; a cap stop is recorded incomplete.
- Wall clock: 600 s per trial.
- Grader: `tasks/hello/grader/check.sh` (file `hello.txt` with the single word `hello`), world state only.

## Endpoints

Per cell: termination, grade, proxy requests, tokens in/out/cached, USD, reconciliation delta against provider usage, wall time. This smoke gates nothing numeric; it passes when every minimum cell completes with grade pass, termination completed, and reconciliation within 1%, and when `/workspace` and the task image are unchanged apart from the task's own output (adapter conformance).

## Cut line and drop order (TODO task T1)

v0.1 minimum for this run: `openclaw-sonnet-hello`, `hermes-sonnet-hello`. Drop order if the cap or the week is exhausted: `qm-pi-sonnet-hello` first. The same two fields (`minimum_v01`, `drop_order`) are required in every later preregistration, and the plan-level cut line for v0.1 is: multi-user held-out cell on the fixed model + coding calibration + product probe report; drop in this order: inner-harness cell, sensitivity cell, continuity to pilot size, work slice.

## Amendments

None yet. Each amendment is dated and committed before any cell it affects runs.
