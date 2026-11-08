# Harness cost: details

Addendum to [With the model fixed, harnesses differ on cost more than on pass rate](README.md). Figures are from the [matrix report](../../docs/benchmarks/2026-11-04-matrix-mu/report.md) and the cost breakdown report.

## The matrix run

- **The biggest pass-rate gaps are on Sol:** OpenClaw +3.9 points over Codex [+0.0, +11.8], and Hermes +3.8 over Codex [+0.0, +10.0]. Holm p = 1 for every primary comparison.
- **11 tasks passed on every rep in every cell, and 3 tasks never passed in any cell.** Each primary pair differed on 1 to 4 tasks.
- **Two cells are incomplete, both OpenClaw, both on the last task.** On Opus, two reps of that task ended in a cap stop; on Sol, all 4 reps did, so that task drops from three comparisons. A cap stop ends a cell as incomplete and is never retried.
- **Claude Code and Codex are never compared with each other.** They can't run the same model.
- **QM ran on the default Docker bridge,** not the internal network, so every QM comparison is labelled "network not held fixed".
- **Every cell is a plain harness** with no add-ons installed.
- **Verdict: FIX-METHOD.** The null rests on saturation, so the tasks need a higher ceiling before this matrix runs again.

## The cost breakdown run

Each contrast is B minus A per trial on one model, over the same 20 public tasks at 2 repetitions. Negative means B is cheaper.

- **Opus, Claude Code minus Hermes:** -$0.010 [-$0.030, +$0.010]. Not distinguished at 20 tasks.
- **Opus, Claude Code minus QM:** +$0.041 [+$0.020, +$0.061]. Claude Code costs more than QM. QM's network differs (default bridge).
- **Sol, Codex minus OpenClaw:** -$0.107 [-$0.270, -$0.002]. Codex is cheaper, barely. Most of the gap is OpenClaw's output (282,492 output tokens against 32,226), and $0.036 per trial of it comes from one timed-out stream charged at its full reservation.
- **Sol, Codex minus Hermes:** -$0.023 [-$0.030, -$0.016]. Codex is cheaper. The gap is cache writes and reads: Hermes sends 423 kB more tool schemas per trial and 16.7 requests per trial against 11.6.
- **No pass-rate interval excludes zero,** so no cost gap is flagged as confounded by work done.
- All 280 trials ran, every one completed, with no cap stop and no model, infra or exam error.

## Disclosures

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.
