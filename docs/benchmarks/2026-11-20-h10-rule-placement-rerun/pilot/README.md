# Pilot: h10-rule-placement-rerun-pilot-2026-11

The uncounted pilot the plan requires before any counted trial ("Pilot"): one trial per cell on `sy-01-quarrendon-ticket-numbers`, 36 trials, six one-arm shards on Ubicloud standard-16 VMs, one VM at a time, from commit `13910b21` (the 2026-11-23 launch amendment, gbrain v0.60.766.0). It publishes no number. It ran 2026-11-24 00:22 to 02:02 UTC.

**Every arm passes, with one check unshown.** Each arm's own outputs show the part under test ran and the tasks can be supplied, except that QM's gbrain-tools arm listed gbrain's tools and made no call, so the check that a call reaches the sidecar is unshown there (last bullet):

- All 36 trials ended `completed`, the longest in 92 s against the 1,500 s wall clock. Every world seeded, every sidecar started, and every turn returned a reply.
- Every agent request carried the cell's model: `claude-opus-5-5` on Claude Code, `gpt-6.2-sol` elsewhere. QM also sent its housekeeping model, `gpt-5.6-luna`, as the plan allows. The only other proxy lines are Hermes's refused model-list probes (`/api/v1/models`, `/api/tags`), which carry no model.
- Every route cell's `logs/instruction-route.json` reads `status: ok` with its harness's rule sha256: Claude Code and Codex `4a81cb9b` (289 bytes), OpenClaw `9506febd` (569), Hermes `10421cbc` (491). The Codex placebo carries `b66810fe`. The Hermes placebo record names the rule file under `instruction`, and its hook emits `routes/placebo.md`, which the image carries at `bf745289` and the adapter checks.
- The first request of each route cell carries one copy at the place harnesses/routes/README.md gives for that harness: system for every system route; system for Hermes and OpenClaw startup; the first user message for Claude Code and Codex startup; the hook message (counted as system on Claude Code and Codex, user on Hermes and OpenClaw) for hook, once and placebo; and the skill listing for skill and told routes. Every route-tool cell has 0 copies.
- The no-gbrain cells have no `instruction-route.json` and no `instruction_route` in `ready`, and they made no gbrain call.
- The sidecar served gbrain 0.60.766.0 with 34 starter tools.
- QM's gbrain-tools cell initialized gbrain and listed its tools through the world's tap. It made no gbrain call in its one turn, so no call through the tap is shown yet.

**Spend:** inside the pilot cap and each arm's pilot lease; the figures are in the run's internal spend note. Fan-out wall time 1h40m.

**Two of the plan's fan-out options were left off the pilot:**
- The shards ran without `--pre-smoke scripts/matrix/clean-arm-preflight.sh`. Instead, a grep of every pilot trial record for `gstack` and `.capy/drive` found nothing (0 files). The counted shards carry the pre-smoke.
- The shards ran without `-- --max-output-tokens 128000`. The repository's `scripts/run-shard.sh` defaults to 128000, so the pilot used the planned value anyway. The counted shards pass it explicitly.

The first launch, at 00:18 UTC, ended before any trial: the controller's disk filled while cloning the repository for the first shard. One VM was created and destroyed, and the fan-out was relaunched from scratch at 00:22.

## Per trial

| Arm | Cell | Ended | Wall s | Models seen | Rule sha256 | Copies on first request | gbrain calls | USD |
|---|---|---|---:|---|---|---|---:|---:|
| Claude Code cli, Opus 5.5 | `claude-code-opus-gbrain-route-startup` | completed | 36 | claude-opus-5-5 | 4a81cb9b | user 1 | 1 | 0.284 |
| Claude Code cli, Opus 5.5 | `claude-code-opus-none` | completed | 25 | claude-opus-5-5 | - | - | 0 | 0.148 |
| Claude Code cli, Opus 5.5 | `claude-code-opus-gbrain-route-tool` | completed | 33 | claude-opus-5-5 | 4a81cb9b | none | 0 | 0.165 |
| Claude Code cli, Opus 5.5 | `claude-code-opus-gbrain-route-hook` | completed | 36 | claude-opus-5-5 | 4a81cb9b | system 1 | 1 | 0.220 |
| Claude Code cli, Opus 5.5 | `claude-code-opus-gbrain-route-system` | completed | 38 | claude-opus-5-5 | 4a81cb9b | system 1 | 2 | 0.289 |
| Claude Code cli, Opus 5.5 | `claude-code-opus-gbrain-route-once` | completed | 37 | claude-opus-5-5 | 4a81cb9b | system 1 | 1 | 0.188 |
| Claude Code Agent SDK, Opus 5.5 | `claude-code-opus-gbrain-sdk-default-route-told` | completed | 35 | claude-opus-5-5 | 4a81cb9b | listing 1 | 3 | 0.339 |
| Claude Code Agent SDK, Opus 5.5 | `claude-code-opus-gbrain-sdk-default-route-skill` | completed | 31 | claude-opus-5-5 | 4a81cb9b | listing 1 | 0 | 0.167 |
| Claude Code Agent SDK, Opus 5.5 | `claude-code-opus-gbrain-sdk-preset-route-skill` | completed | 36 | claude-opus-5-5 | 4a81cb9b | listing 1 | 0 | 0.183 |
| Claude Code Agent SDK, Opus 5.5 | `claude-code-opus-gbrain-sdk-preset-route-tool` | completed | 31 | claude-opus-5-5 | 4a81cb9b | none | 0 | 0.160 |
| Claude Code Agent SDK, Opus 5.5 | `claude-code-opus-gbrain-sdk-preset-route-told` | completed | 44 | claude-opus-5-5 | 4a81cb9b | listing 1 | 3 | 0.296 |
| Codex, GPT-6.2 Sol | `codex-sol-gbrain-route-system` | completed | 25 | gpt-6.2-sol | 4a81cb9b | system 1 | 1 | 0.063 |
| Codex, GPT-6.2 Sol | `codex-sol-gbrain-route-told` | completed | 24 | gpt-6.2-sol | 4a81cb9b | listing 1 | 1 | 0.065 |
| Codex, GPT-6.2 Sol | `codex-sol-gbrain-route-placebo` | completed | 20 | gpt-6.2-sol | b66810fe | system 1 | 0 | 0.055 |
| Codex, GPT-6.2 Sol | `codex-sol-gbrain-route-hook` | completed | 26 | gpt-6.2-sol | 4a81cb9b | system 1 | 1 | 0.075 |
| Codex, GPT-6.2 Sol | `codex-sol-gbrain-route-once` | completed | 24 | gpt-6.2-sol | 4a81cb9b | system 1 | 1 | 0.063 |
| Codex, GPT-6.2 Sol | `codex-sol-gbrain-route-startup` | completed | 22 | gpt-6.2-sol | 4a81cb9b | user 1 | 1 | 0.062 |
| Codex, GPT-6.2 Sol | `codex-sol-none` | completed | 19 | gpt-6.2-sol | - | - | 0 | 0.058 |
| Codex, GPT-6.2 Sol | `codex-sol-gbrain-route-tool` | completed | 26 | gpt-6.2-sol | 4a81cb9b | none | 0 | 0.067 |
| Codex, GPT-6.2 Sol | `codex-sol-gbrain-route-skill` | completed | 24 | gpt-6.2-sol | 4a81cb9b | listing 1 | 1 | 0.069 |
| Hermes, GPT-6.2 Sol | `hermes-sol-gbrain-route-hook` | completed | 45 | gpt-6.2-sol | 10421cbc | user 1 | 1 | 0.165 |
| Hermes, GPT-6.2 Sol | `hermes-sol-gbrain-route-skill` | completed | 42 | gpt-6.2-sol | 10421cbc | listing 1 | 0 | 0.158 |
| Hermes, GPT-6.2 Sol | `hermes-sol-gbrain-route-placebo` | completed | 45 | gpt-6.2-sol | 10421cbc | user 1 | 0 | 0.156 |
| Hermes, GPT-6.2 Sol | `hermes-sol-gbrain-route-tool` | completed | 50 | gpt-6.2-sol | 10421cbc | none | 0 | 0.159 |
| Hermes, GPT-6.2 Sol | `hermes-sol-gbrain-route-startup` | completed | 41 | gpt-6.2-sol | 10421cbc | system 1 | 1 | 0.145 |
| Hermes, GPT-6.2 Sol | `hermes-sol-gbrain-route-system` | completed | 47 | gpt-6.2-sol | 10421cbc | system 1 | 1 | 0.183 |
| Hermes, GPT-6.2 Sol | `hermes-sol-gbrain-route-once` | completed | 43 | gpt-6.2-sol | 10421cbc | user 1 | 1 | 0.165 |
| Hermes, GPT-6.2 Sol | `hermes-sol-none` | completed | 35 | gpt-6.2-sol | - | - | 0 | 0.152 |
| OpenClaw, GPT-6.2 Sol | `openclaw-sol-gbrain-route-hook` | completed | 92 | gpt-6.2-sol | 9506febd | user 1 | 2 | 0.128 |
| OpenClaw, GPT-6.2 Sol | `openclaw-sol-gbrain-route-tool` | completed | 62 | gpt-6.2-sol | 9506febd | none | 0 | 0.164 |
| OpenClaw, GPT-6.2 Sol | `openclaw-sol-gbrain-route-once` | completed | 88 | gpt-6.2-sol | 9506febd | user 1 | 2 | 0.116 |
| OpenClaw, GPT-6.2 Sol | `openclaw-sol-none` | completed | 44 | gpt-6.2-sol | - | - | 0 | 0.095 |
| OpenClaw, GPT-6.2 Sol | `openclaw-sol-gbrain-route-skill` | completed | 61 | gpt-6.2-sol | 9506febd | listing 1 | 2 | 0.107 |
| OpenClaw, GPT-6.2 Sol | `openclaw-sol-gbrain-route-startup` | completed | 73 | gpt-6.2-sol | 9506febd | system 1 | 2 | 0.164 |
| QM, GPT-6.2 Sol | `qm-pi-sol-none` | completed | 54 | gpt-5.6-luna, gpt-6.2-sol | - | - | 0 | 0.058 |
| QM, GPT-6.2 Sol | `qm-pi-sol-gbrain-route-tool` | completed | 56 | gpt-5.6-luna, gpt-6.2-sol | - | - | 0 | 0.062 |

