# Where to put a rule: details

Addendum to [Where to put a rule so an agent follows it](README.md). Every figure is from the full report, which has the per-cell table and intervals.

## More results

- **The placebo did nothing.** 289 bytes of unrelated text in the same slot: Codex 5 of 30 and Hermes 4 of 30, against 6 and 4 with no rule. So the words carry the effect, not the slot.
- **Following the rule costs more per turn.** Every route that raised compliance cost 10% to 55% more per member turn than its harness's no-rule control (descriptive), and pass rate did not move with it.
- **A one-time copy also trailed one copy in the system prompt,** by -17.5 points [-26.1, -10.6] (p 0.0039, Holm 0.0078), pooled over Claude Code, Hermes and Codex. Only the Hermes pair put the one-time copy in the user turn; on Claude Code and Codex both copies sat in the system block. Descriptive (minimum detectable difference 25 points).
- **Claude Code (command line, Opus 5.5):** the system prompt and the startup file reached 30 of 30, the per-turn hook 26 of 30 and the one-time copy 23 of 30, against 18 of 30 with no rule.
- **The one-time-copy gap of -38.9 points** has sign-flip p 0.0078 (Holm 0.0078). It is descriptive by the preregistered rule: the contrast could only detect a 39-point gap, and the claim margin is 20 points.

## Verdicts

- The unmentioned skill on Hermes and Claude Code: **CUT-CANDIDATE**.
- The one-time copy, and Claude Code's stub-against-preset system prompt: **FIX-METHOD**.
- Verdict words are defined in the glossary.

## What ran

- Claude Code 2.1.312 on Opus 5.5, driven two ways (the command line and the Agent SDK 0.3.312). Codex 0.165.0, Hermes Agent v2026.9.24 and OpenClaw 2026.10.6 on GPT-6.1 Sol.
- gbrain's starter surface (33 tools) at gbrain `2c469d1b` (0.60.547.0), one bot-visible brain, no per-member access rules. So a rule that drives more gbrain search also drives more cross-scope reads (12 trials here).
- 10 public v0.3 dev tasks, 30 member turns (10 of them repeat turns inside a session), one repetition per cell. 30 cells, 300 trials.
- 300 of 300 trials completed, 0 cap stops, 0 trials excluded, and the clean-arm audit found 0 hits.
- Not run at frontier, as preregistered: the named skill on OpenClaw and Hermes, the placebo on OpenClaw and Claude Code, and the system prompt on OpenClaw (it has no such setting).

## Recheck it without a key

Needs [Bun](https://bun.sh/), runs in seconds and calls no model. It rebuilds the report's tables from the committed receipts:

```sh
bun install --frozen-lockfile
bun scripts/instruction-followed-h10.ts --results docs/benchmarks/2026-11-07-h10-instruction-placement/results \
  --prereg docs/benchmarks/2026-11-07-h10-instruction-placement/prereg.json --out /tmp/h10
diff /tmp/h10/instruction-followed-h10.md docs/benchmarks/2026-11-07-h10-instruction-placement/results/instruction-followed-h10.md && echo match
```

## Disclosures

gbrain is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.
