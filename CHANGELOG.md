# Changelog

What each harness-evals release changed. Versions follow `VERSION` and `package.json`.

## [0.0.1] - 2026-10-22

### Repository created with the approved plan

- Plan v2 for the harness comparison approved after two gstack autoplan review rounds (12 reviewer passes, 172 findings, 30 open tasks). Plan, review record, findings, decisions, timing and every reviewer file under `docs/plans/2026-10-21-harness-eval-v0/`.
- Research compendium of published harness comparisons and agent benchmarks (`compendium.md`).
- Conventions taken from gbrain-evals and the reasons (`docs/gbrain-evals-conventions.md`).
- Trial contract (`docs/methodology.md`).
- Statistics kit vendored from gbrain-evals v0.10.128 (`6999ebc9`) with its unit tests; the preregistration-order checker and an empty experiment registry.
- Keyless CI: typecheck, tests, link check, preregistration order.
