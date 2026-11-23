# A shared brain needs reader labels and per-person keys, or gbrain's refusal

- **We learned that one unbound connection hands agents other people's records, and that gbrain's two fixes stop it.** On gbrain v0.60.761.0, a team bot or coding agent on gbrain's open default returned a page the asker may not read in 40% to 73% of tries per harness and model. With gbrain's refusal on, or with each page's readers labelled and a key per person, that was 0. **You should turn on the refusal, and write reader labels before you hand out per-person keys, before one brain serves several people.**
- **We learned that the fixes didn't cost answers.** The refusal raised answers 11.8 points for team bots (+5.3 to +18.9). Labels and keys were within a point of open for the bots and 5.9 points above it for Claude Code and Codex (+0.0 to +13.7). They did cost against the refusal: the bots answered 11.0 points fewer right with labels and keys than with the refusal (-18.0 to -4.8).
- **What didn't work:** per-person keys on a brain without labels exposed about as much as the open default (59.4% against 60.4%).

## Evidence (gbrain v0.60.761.0, `shared-brain-access-2026-11`)

- **The test.** OpenClaw and Hermes on Claude Opus 5.5 and GPT-6.2 Sol (20 tasks, 3 repetitions, 60 trials per cell) with gbrain open, refused, labelled with per-person keys, and no gbrain. Claude Code on Opus 5.5 and Codex on GPT-6.2 Sol (17 tasks, 51 trials per cell) with gbrain's installer, with gbrain described in the prompt ("told"), each with per-person keys unlabelled and labelled, and with no gbrain.
- **The refusal:** 0 of 228 team-bot trials exposed, against 53.5% open (-53.5 points, -63.6 to -43.4).
- **Labels and keys:** 0 of 228 team-bot trials exposed, and 0 of 102 Claude Code and Codex trials in each of the installer and told routes.
- **Keys without labels:** 59.4% exposed against 60.4% open (-1.0 points, -8.8 to +6.1).
- **Installer against told:** 60.8% against 49.0% exposed (+11.8 points, -3.9 to +28.4), so the earlier "installer exposes more" result isn't shown on this build.

**Main caveat:** every row is dev, on public tasks. The four Hermes GPT-6.2 Sol cells are partial (12 to 15 of 60 trials not run when their leases ran out).

## Earlier results, with the builds they ran on

- gbrain v0.60.522.0 (`installer-cc-codex-2026-11`): with one bot-wide token, gbrain returned records the asker may not read in 33, 20, 17 and 9 of 51 trials (Claude Code installer, Claude Code told, Codex installer, Codex told).
- gbrain v0.60.554.0 (the same run, access rules on): 0 of 51 in all four gbrain cells, and Claude Code passed 50 (installer) and 49 (told) against 46 with no brain.
- gbrain v0.60.717.0 (`shared-bot-scope-2026-11`): the refusal 0 of 240 against 52.9% open; labelled with keys 0 of 100.

## More

- [Report on v0.60.761.0](../../docs/benchmarks/2026-11-21-shared-brain-access/report.md)
- [Addendum: per-cell gains, cost and what changed between the earlier runs](addendum-details.md)
- [Report with access rules](../../docs/benchmarks/2026-11-01-installer-cc-codex/report-acl.md) and [first report, without them](../../docs/benchmarks/2026-11-01-installer-cc-codex/report.md)

## Disclosures

gbrain is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.
