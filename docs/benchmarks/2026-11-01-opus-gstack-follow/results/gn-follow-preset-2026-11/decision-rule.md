# gn-follow-preset-2026-11: follow-rate check with Claude Code's system prompt, decision rule (written before the first trial)

Written 2026-11-01 (America/Los_Angeles) by HARN-14, before any trial of this run. Uncounted (no preregistration PR, per HARN-1); this file is the decision rule of record. Plan: autoplan run harn14-opus-native-20261101160021, revision ca371d38956e, step 2, as amended by HARN-1 on 2026-11-01: before the D1 decision, run a second follow-rate check with the claude_code system-prompt preset; this run decides.

## Why a second run
gn-follow-2026-11 runs Lane B's pinned agent (gstack-evals 443d582c), which sets no system_prompt. The Claude Agent SDK 0.2.174 then passes `--system-prompt ""`, so the model gets the SDK's two-line stub, not Claude Code's guidance block (about 5.8k characters on Opus 5.5; GEVA-109, org drive research/sdk-system-prompt-note.md). That run is the stub baseline: "SDK default system prompt (two-line stub), not Claude Code's; follow rate may be understated". This run differs from it in one line.

## What runs
- Run id `gn-follow-preset-2026-11`, plan file `screening/gn-follow-preset-2026-11.json` on scratch branch `harn14/follow-preset-2026-11`: the stub run's commit fec132d37 plus the plan file, the agent patch file and the pin change. Never merged.
- The one change: Lane B's agent `quick/laneb/runner/agent/laneb_agent.py` gets `system_prompt={"type": "preset", "preset": "claude_code"},` in its ClaudeAgentOptions (patch: `screening/gn-follow-preset-2026-11.agent.patch`). sha256 before c4f7664b1221ecedb075eb61bf2d3965dca66f44a567d0cc0f277bd8eca64235, after 54fb546251fd4591f669d2330fbcaeefbded00ff0d6ed1138878da5a4bcae8a6; pin.json's checkout_only entry carries the new sha so vm-run.sh's check passes. With a preset and no append, SDK 0.2.174 passes no --system-prompt flag, so Claude Code 2.1.312 uses its own prompt. gstack-evals' per-arm claude-code-preset setting is not on its main (5a5192f), so this is a local patch, declared here.
- Lane B root uploaded to the VM: ~/.capy/work/gstack-laneb-preset (the fetched root with only that file changed), via fanout options `--laneb-root`.
- Everything else is the stub run's: Opus 5.5 (claude-opus-5-5) only, Claude Code 2.1.312, arms none / placebo (ff6b909d...) / gstack (61e201ec, rebuild tar b9399468...), all on one Ubicloud standard-16 VM, the same 8 public dev tasks of gstack-native-v1 (2 each of fix, review, qa, ship), 2 tries per arm: 48 trials, 16 per arm. Harbor allowlist network.
- Money: one ledger lease `gn-follow-preset-2026-11:opus-follow-preset` of $21.80 (plan.ts lease: 48 x $0.25 x 1.4 + $5 Opus session cap), under HARN-1's $25 limit. A cap stop is not retried. Lane math: $21.80 stub + $21.80 preset + about $1,148 sealed-build leases = about $1,191.60, under the $1,200 lane cap.

## Launch condition ($0 dry run)
No paid trial starts until a keyless dry run through the same path (Harbor, Claude Code 2.1.312, the patched agent, the Lane B proxy and our metering proxy, to a fake upstream that records the `system` field) shows Claude Code's guidance block in the captured request on claude-opus-5-5 (about 5.8k characters), against the two-line stub with the unpatched agent. Evidence goes in evidence/dry-run/ in this run dir.

## The measure and the rule
Identical to gn-follow-2026-11 DECISION-RULE.md revision 2:
- `laneb.skill_probe.followed` per session, computed with scripts/gstack-laneb/skill-probe.ts at PR 1's shipped head: `bun scripts/gstack-laneb/skill-probe.ts summary --results <merged results dir> --expect 16 --model claude-opus-5-5`.
- Wilson 95% on followed / sessions, per arm. Sessions treated as independent; per-skill counts reported beside it.
- gstack arm: upper bound below 0.60 is **STOP**; lower bound above 0.40 is **PROCEED**; otherwise **ASK** HARN-1. Any followed session on none or placebo is **PROBE_FAULT**. With 16 sessions: 0 to 5 followed is STOP, 6 to 10 ASK, 11 to 16 PROCEED.
- Completeness: any missing arm, session without a probe reading, or arm with other than 16 sessions makes it **INCOMPLETE**; the report gives the band the gstack interval alone would give, and asks HARN-1.
- Population: a STOP reads "on gstack-native-v1 dev tasks, which Opus 5.5 nearly saturates on the none arm", with per-skill counts. Not a finding about held-out tasks.

## Which run decides
This run (preset) decides D1. The report gives both runs' per-arm follow rates with Wilson intervals, says this one decides, and gives each run's ledger spend.

## Dry run result (2026-11-01 ~18:44 UTC, $0, still before the first trial)
Two keyless smoke runs (scripts/gstack-laneb/smoke.sh, toy-fix-calc fixture, none and placebo arms on claude-opus-5-5, Harbor network public on the Capy machine) from a throwaway worktree at fec132d37, with the fake upstream patched to record the `system` field (evidence/dry-run/recorder.diff; that patch and its pin entry exist only in the dry-run copy, never in the paid run's root).
- Unpatched agent (stub): every one of 20 requests (10 messages, 10 count_tokens) carried a 137-character system: the billing header plus "You are a Claude agent, built on Anthropic's Claude Agent SDK." Smoke ok, 2 of 2 pass.
- Patched agent (preset): every one of 20 requests carried a 6,340-character system, Claude Code's guidance block included, with the line "When the user types `/<skill-name>`, invoke it via Skill." Smoke ok, 2 of 2 pass, skill body loaded.
- The 6,340 includes the 137-character stub lines and the environment section, so it is a little above GEVA-109's 5.8k guidance-only figure. Launch condition met.
Files: evidence/dry-run/{stub,preset}-system.jsonl, {stub,preset}-system-prompt.txt, {stub,preset}-smoke.out, dry-pin.json, recorder.diff.

- Paid run commit: e1016ca4d5da60dad32ee591731741b66f3295fc on harn14/follow-preset-2026-11 (pushed). Lane B root ~/.capy/work/gstack-laneb-preset, agent sha256 54fb546251fd4591f669d2330fbcaeefbded00ff0d6ed1138878da5a4bcae8a6.
