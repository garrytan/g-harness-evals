# Shared brain access: details

Addendum to [A shared brain needs per-person access rules](README.md). Figures are from the [report with access rules](../../docs/benchmarks/2026-11-01-installer-cc-codex/report-acl.md).

- **Gains against no brain (descriptive, no test):** Claude Code installer +8 points [+0, +22], told +6 [-4, +20]. Codex installer +12 [+0, +24], told +4 [+0, +10].
- **Both no-brain cells reproduced the first run exactly:** 46 of 51 on Claude Code and 43 of 51 on Codex.
- **The installer still costs more per trial.** Against told it added $0.053 on Claude Code and $0.041 on Codex, from more gbrain calls and more input tokens.
- **Installer against told is "not distinguished" on both hosts, by construction:** with the rules on, no gbrain read in any of the 204 gbrain trials returned a record the asker may not read.
- **What changed between the runs:** gbrain `f650eac5` (v0.60.554.0) instead of `a590ad07`, and an access-ruled member brain. Each trial's gbrain token is bound to the member asking (`gbrain access member add`, then `gbrain auth rescope --member`). Before, one bot token served every asker with no rules.
- **What stayed:** the 17 public v0.3 dev tasks, 3 repetitions, both harness pins (Claude Code 2.1.312, Codex 0.165.0) and models, the prompts and the installer route.
- **Clean run:** 306 of 306 trials completed, with no cap stop, no model error and no refused proxy request.
- **Verdicts:** KEEP gbrain with member access rules on both hosts. For installer against told, FIX-METHOD: the comparison is saturated, and the report names the ceiling-raise.

## Disclosures

gbrain is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
