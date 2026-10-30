# Instruction routes (internal-task)

**One instruction text, five ways in.** The OpenClaw and Hermes adapters read the cell's `config` (`HE_HARNESS_CONFIG`) and deliver the same bytes through the route it names. Unset, empty or `default` changes nothing: every file the adapter writes and every CLI command it runs stay byte-identical to the adapter before this change (`tests/instruction-route.test.ts`).

- **Supported:** OpenClaw 4 of 5 routes, Hermes 5 of 5.
- **Not supported:** `route-system` on OpenClaw. OpenClaw 2026.10.6 has no config key that adds text to the system prompt, so the adapter refuses that cell (exit 2, HE-ADAPTER-007) and the preregistration drops it.

## The instruction

`instruction.md` in this directory, 289 bytes, no trailing newline, sha256 `4a81cb9b35d6ad6f205723618f15e6c3dc66586cbb41f0ebc72141b74669230f`.

- **Source:** gbrain's own per-turn brain-first rule, the text its per-turn hook injects (the OpenClaw `gbrain-turn-rule` plugin's `prependContext`, the Hermes `pre_llm_call` hook's `{"context": ...}`). Repository `garrytan/gbrain`, commit `32366ac26a2b8874b67702249f9274b06e8756c1` (the merge of gbrain#7898, 2026-10-29, the commit the staged preregistrations pin), file `src/core/setup/brain-first.ts`, `renderBrainFirstTurnRule` (lines 87 to 92), rendered for MCP access on the starter surface with server `gbrain` (the server name both adapters register). Rendering that function at 32366ac2 gives these 289 bytes exactly.
- **Not 5fd43d5a:** gbrain#7989 (merged as `5fd43d5a`, v0.60.505.0) rewrites the rule to name the tools; this file keeps the 32366ac2 text until the preregistrations move.
- **Byte-for-byte check in this repository:** the same function and output are unchanged since `10949a15110fcd42eb0fed447d7f22e57c7206d5` (gbrain#7489's per-turn-hook head, the pin of run `gbrain-installer-hook-2026-10`), and the rule as gbrain wrote it at that image build is committed in the installer views of that run: `installer.turn_hook.rule` of [openclaw-installer manifest.json](../../docs/benchmarks/2026-10-25-gbrain-installer-hook/results/oc-inst.gbrain-install/openclaw-installer/heldout/manifest.json) and of the Hermes view, and `RULE` in that view's `state/gbrain/gbrain-turn-rule/index.js`. The test compares all three with `instruction.md`.
- **One file in the images:** each image's build context is its own harness directory, so `harnesses/openclaw/routes/instruction.md` and `harnesses/hermes/routes/instruction.md` are byte copies, copied to `/opt/harness/routes/instruction.md` by each Dockerfile. The test requires all three to carry the sha256 above, and each adapter refuses an instruction file with any other sha256 (HE-ADAPTER-007), so a stale image cannot run a route.

## The routes

| Config | OpenClaw 2026.10.6 | Hermes v2026.9.24 |
|---|---|---|
| `default` (or unset, empty) | nothing changes | nothing changes |
| `route-tool` (a, control) | nothing written; the gbrain MCP tool descriptions are the only carrier | same |
| `route-system` (b) | **not supported**: no setting (below) | `agent.system_prompt` in `$HERMES_HOME/config.yaml`, Hermes's own manual system prompt; a JSON-quoted scalar inserted under an existing `agent:` key, else appended as a new `agent:` block |
| `route-startup` (c) | `/workspace/AGENTS.md`, the instruction bytes alone (the workspace bootstrap file) | `$HERMES_HOME/SOUL.md`: Hermes's seeded default plus `\n\n`, the instruction and `\n`, only while the file still has the seed's sha256 (`pin.json` `soul_md.sha256`, recorded as `replaced_seed`) |
| `route-hook` (d) | plugin `he-instruction-route` (`routes/he-instruction-route/` in the image) copied to `$OPENCLAW_STATE_DIR/he-instruction-route`; `before_prompt_build` returns the instruction as `prependContext`; installed with `plugins install --link`, `plugins enable`, `hooks.allowConversationAccess true`; `plugins inspect --runtime --json` must say loaded, enabled, `before_prompt_build`; serve entry only | marked `hooks.pre_llm_call` block, command `/bin/echo '{"context":"<instruction>"}'`, plus `shell-hooks-allowlist.json` approving that command; `hermes hooks doctor` must report it healthy |
| `route-skill` (e) | `/workspace/skills/brain-first/SKILL.md` | `$HERMES_HOME/skills/brain-first/SKILL.md` |

**What a route-skill cell actually carries:** the 46-character paraphrase in the skills list, plus the instruction's 289 bytes only if the model chooses to read the skill. It does not carry the instruction text itself in the request; read its results as "the skill is listed", not as "the instruction was delivered".

**Skill file, both harnesses:** frontmatter `name: brain-first` and the fixed description `Check GBrain first, before answering any turn.` (46 characters, under the 57 Hermes shows, `agent/skill_utils.py` `SKILL_PROMPT_DESC_LIMIT` 60 minus the ellipsis), then a blank line, the instruction and `\n`.

**Why SOUL.md for Hermes startup, not `.hermes.md`:** `SOUL.md` is the file gbrain's own installer writes for Hermes, so this route carries the instruction where gbrain ships it, in the system prompt's identity slot. `.hermes.md` is the gbrain-docs rung's destination and is read first-match-wins beside `AGENTS.md` and `CLAUDE.md` from the cwd.

**Why OpenClaw has no route-system:** the config schema the pinned CLI prints (`openclaw config schema`) has no agent-level prompt text key. `agents.defaults.*` and `agents.entries.*` carry only `heartbeat.prompt` (heartbeat turns) and skill-prompt size limits; `systemPromptOverride` is a retired input Doctor refuses (`docs/gateway/doctor/config-migrations.md` in the package); the `systemPrompt` keys under `channels.*` apply to gateway channel conversations, which the serve entry (`openclaw agent --local`) does not use. `docs/concepts/system-prompt.md` lists the config knobs the prompt builder reads (owner display, TTS hints, model aliases, memory citation mode, delegation mode); none adds text.

**Records:** `$HE_LOG_DIR/instruction-route.json` (route, instruction path, sha256 and bytes, the setting, every file written with its sha256 and bytes, Hermes's added bytes and their sha256, hook status) and `ready.instruction_route` `{route, instruction_sha256, files, hook}` (`hook` is `loaded` or `healthy` on route-hook). The hook receipts are `instruction-route.openclaw.json` (plugins inspect) and `instruction-route.hermes.log` (hooks doctor). A default cell writes none of these.

**Refusals (HE-ADAPTER-007, exit 2 before ready):** an unknown config, OpenClaw `route-system`, OpenClaw `route-hook`, `route-startup` and `route-skill` on the run entry (the plugin would not load there, and the other two would write into the task workspace; no Hermes route writes into the workspace, so Hermes refuses none), a plugin template that is incomplete or lacks its placeholder, a Hermes `route-system` whose python3 cannot parse the config back, an instruction file with another sha256, a destination that already exists (including the gbrain-installer files, so a route and `HE_GBRAIN_INSTALL=gbrain-installer` do not combine on the same file), a Hermes `SOUL.md` that is missing or not the seed, a Hermes config that already has `hooks:`, an existing Hermes allowlist, and a hook the harness does not report loaded or healthy.

## Surface table: where the bytes land in the request

Keyless smoke, 2026-10-30: both images built from this checkout, one serve turn per route through `harnesses/serve-smoke.ts --turns 1 --config <route>` against `scripts/gsta-135/fake-anthropic.ts` on the docker bridge gateway, dummy token `trial-token:dummy-<harness>`, model `claude-haiku-5-5`, no key anywhere. Positions are in the first `/v1/messages` request of the turn (one request per turn here: the fake answers "ok" with no tool call). Offsets are UTF-8 bytes into that block's text; they move with the date, the prompt and the tool list, so the section is what the preregistration should cite.

| Route | OpenClaw: where, offset | Hermes: where, offset |
|---|---|---|
| default | nowhere | nowhere |
| route-tool | nowhere | nowhere |
| route-system | not supported | **system prompt**, block `system[1]`, the last bytes of the prompt, after `<!-- End Hermes runtime environment -->` and `\n\n`: byte 6232 of 6521 (+291 bytes over default) |
| route-startup | **system prompt**, `system[0]`, section `# Project Context` / `## /workspace/AGENTS.md` (replaces the `[MISSING] Expected at: /workspace/AGENTS.md` marker): byte 25158 of 25617 (+246) | **system prompt**, `system[0]`, the identity slot, right after Hermes's SOUL.md text and `\n\n`: byte 669 of 6515 (+291) |
| route-hook | **user message**, `messages[0]` (the turn), prepended after OpenClaw's `[<date> UTC] ` stamp and followed by `\n\n` and the prompt: byte 27 of 1295 (+291) | **user message**, `messages[0]`, appended after the prompt and `\n\n`: byte 979 of 1268 (+291) |
| route-skill | **system prompt** skills list only: `system[0]`, `## Skills` / `<available_skills>`, entry `<name>brain-first</name>` with the description and `<location>/workspace/skills/brain-first/SKILL.md</location>` (name at byte 17088 of 25563, +192). The body reaches the model only if it reads the skill. | **system prompt** skills list only: `system[1]`, `## Skills`, line `- brain-first: Check GBrain first, before answering any turn.` (byte 992 of 6311, +81). Same caveat. |

On the first request of a session each route places the instruction once or not at all. The carrying block is longer than the default cell's by exactly the bytes shown (the instruction, its separator, and for OpenClaw startup minus the 43-byte missing-file marker it replaces).

**Later requests: the hook routes accumulate copies.** The docker block runs two member turns in the same DM, and turn 1 makes one shell tool call, so the harness sends a follow-up request with the tool result. Copies of the instruction per request:

| Config | Turn 1, first request | Turn 1, tool-call follow-up | Turn 2 |
|---|---|---|---|
| default, route-tool, route-skill | 0 | 0 | 0 |
| route-system (Hermes), route-startup (both) | 1 (system) | 1 (system) | 1 (system) |
| route-hook (both) | 1 (user message) | 1 (the same user message, kept in history) | **2** (turn 1's user message in history, plus turn 2's) |

- The system routes stay at one copy. The hook routes add one copy per member turn, because each turn's user message keeps its prepended (OpenClaw) or appended (Hermes) copy in the history.
- So a hook cell's request on turn N carries N copies. The tool-call follow-up adds none.
- The route-skill counts are for a model that never reads the skill; a model that reads it adds the 289 bytes once, as a tool result.

`tests/instruction-route.test.ts` (the docker block, skipped without the images) asserts each first-request placement and these counts on every run.

## Reproduce

```bash
docker build -t harness-eval/openclaw:dev harnesses/openclaw
docker build -t harness-eval/hermes:dev harnesses/hermes
bun scripts/gsta-135/fake-anthropic.ts --host 172.17.0.1 --port 8798 --log results/routes/fake.ndjson &
bun harnesses/serve-smoke.ts --harness hermes --trial-id routes-hermes-route-hook --config route-hook --turns 1 \
  --base-url http://host.docker.internal:8798/anthropic --api-key trial-token:dummy --model claude-haiku-5-5 --budget 60
env -i PATH=$PATH HOME=$HOME bun test tests/instruction-route.test.ts
```

## Changelog

### 2026-10-30: page created (internal-task)

harness-evals v0.0.46. The instruction, its source and sha256, the five routes per harness, the refusals and the surface table. Why: run `anatomy-instruction-route-2026-11` delivers one instruction through each route a harness supports and its preregistration cites this page.
