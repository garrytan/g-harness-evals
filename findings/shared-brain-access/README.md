# A shared brain needs per-person access rules

- **We learned that with one bot-wide token, a shared brain hands agents records the asker isn't allowed to see. You should scope every brain read to the person asking.**
- **We learned that with gbrain's per-member access rules on, that exposure went to zero and gbrain stopped costing Claude Code its pass rate. You should turn access rules on before one brain serves several people.**

## Evidence

- **The test.** Claude Code on Opus 5.5 and Codex on GPT-6.1 Sol, each with gbrain set up by its installer, with gbrain described in the prompt instead ("told"), and with no brain. 17 public tasks, 3 repetitions, 51 trials per cell.
- **Without access rules,** gbrain reads returned records the asker may not read in 33, 20, 17 and 9 of 51 trials across the four gbrain cells.
- **With per-member access rules on,** that was **0 of 51 in all four gbrain cells.** Each trial's gbrain token was bound to the member asking.
- **Pass rate recovered.** Claude Code passed 46 of 51 with no brain, 49 told and 50 with the installer. Without access rules it was 46, 31 and 27.

**Main caveat:** every row is dev, on 17 public tasks. Against no brain, the gbrain cells passed as often or more, but those gains are descriptive and every interval reaches zero.

## More

- [Addendum: per-cell gains, cost and what changed between the runs](addendum-details.md)
- [Report with access rules](../../docs/benchmarks/2026-11-01-installer-cc-codex/report-acl.md) and [first report, without them](../../docs/benchmarks/2026-11-01-installer-cc-codex/report.md)

## Disclosures

gbrain is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
