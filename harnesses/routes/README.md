# Instruction routes (internal-task-a, internal-task-b)

**One instruction text, five ways in.** The OpenClaw and Hermes adapters read the cell's `config` (`HE_HARNESS_CONFIG`) and deliver the same bytes through the route it names. Unset, empty or `default` changes nothing: every file the adapter writes and every CLI command it runs stay byte-identical to the adapter before this change (`tests/instruction-route.test.ts`).

- **Supported:** OpenClaw 4 of 5 routes, Hermes 5 of 5.
- **Not supported:** `route-system` on OpenClaw. OpenClaw 2026.10.6 has no config key that adds text to the system prompt, so the adapter refuses that cell (exit 2, HE-ADAPTER-007) and the preregistration drops it.
- **H10 (internal-task) is the contract for four harnesses.** OpenClaw, Hermes, Claude Code and Codex, with a one-time hook, a placebo, a driver prefix for Claude Code and skill-route slots. It is written below under "Routes on four harnesses". The adapters build it in later H10 pull requests; until then each adapter refuses a route it does not run yet.

## The instruction

`instruction.md` in this directory, 289 bytes, no trailing newline, sha256 `4a81cb9b35d6ad6f205723618f15e6c3dc66586cbb41f0ebc72141b74669230f`.

- **Source:** gbrain's own per-turn brain-first rule, the text its per-turn hook injects (the OpenClaw `gbrain-turn-rule` plugin's `prependContext`, the Hermes `pre_llm_call` hook's `{"context": ...}`). Repository `garrytan/gbrain`, commit `32366ac26a2b8874b67702249f9274b06e8756c1` (the merge of gbrain#7898, 2026-10-29, the commit the staged preregistrations pin), file `src/core/setup/brain-first.ts`, `renderBrainFirstTurnRule` (lines 87 to 92), rendered for MCP access on the starter surface with server `gbrain` (the server name both adapters register). Rendering that function at 32366ac2 gives these 289 bytes exactly.
- **Not 5fd43d5a:** gbrain#7989 (merged as `5fd43d5a`, v0.60.505.0) rewrites the rule to name the tools; this file keeps the 32366ac2 text until the preregistrations move.
- **Byte-for-byte check in this repository:** the same function and output are unchanged since `10949a15110fcd42eb0fed447d7f22e57c7206d5` (gbrain#7489's per-turn-hook head, the pin of run `gbrain-installer-hook-2026-10`), and the rule as gbrain wrote it at that image build is committed in the installer views of that run: `installer.turn_hook.rule` of [openclaw-installer manifest.json](../../docs/benchmarks/2026-10-25-gbrain-installer-hook/results/oc-inst.gbrain-install/openclaw-installer/heldout/manifest.json) and of the Hermes view, and `RULE` in that view's `state/gbrain/gbrain-turn-rule/index.js`. The test compares all three with `instruction.md`.
- **One file in the images:** each image's build context is its own harness directory, so `harnesses/openclaw/routes/instruction.md` and `harnesses/hermes/routes/instruction.md` are byte copies, copied to `/opt/harness/routes/instruction.md` by each Dockerfile. The test requires all three to carry the sha256 above, and each adapter refuses an instruction file with any other sha256 (HE-ADAPTER-007), so a stale image cannot run a route.

## The placebo

`placebo.md` in this directory: 289 bytes (the instruction's length), no trailing newline, sha256 `b66810fe132a2a9988100dcd01a9c8a03665265ff01555f17cd9b1955047dd34`.

- **What it says:** what kind of conversation this is (a team workspace, several people, DMs and channels, local times). It names no tool, no GBrain and no way to answer.
- **Where it goes:** only `route-placebo`, through the per-turn hook, on every member turn. So a placebo cell gets the same number of bytes in the same place as a `route-hook` cell, without the rule.
- **Copies:** the adapter pull requests add byte copies under `harnesses/<name>/routes/placebo.md` (each image's build context is its own harness directory). `tests/route-schema.test.ts` pins the length and the sha256.

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

## Routes on four harnesses (H10, internal-task)

**Status: a contract, not yet built.** Today only the internal-task-a routes above run, on OpenClaw and Hermes. Claude Code and Codex read `HE_HARNESS_CONFIG` only for `default` and internal-task-b's `official-minimal`, which is not a route and stays outside this grammar.

- **Who builds what:** H10 PR 2 does OpenClaw and Hermes, PR 3 the Claude Code CLI and Codex, PR 4 the Claude Code Agent SDK drivers.
- **No silent runs:** until then, an adapter refuses any route it does not run (exit 2, HE-ADAPTER-007).
- **Grammar:** a cell's config is `[<driver>+]<route>[@<slot_id>]`, parsed by `parseRouteConfig` in [runner/contracts.ts](../../runner/contracts.ts). The grammar and the per-turn status are in [docs/adapters.md](../../docs/adapters.md), "Route config".

Every rule route delivers the same 289 bytes of `instruction.md` (sha256 `4a81cb9b...` above).

| Route (`config`) | OpenClaw | Hermes | Claude Code | Codex |
|---|---|---|---|---|
| `route-tool` (control) | nothing written | same | same | same |
| `route-hook` (per-turn hook) | `before_prompt_build` plugin, `prependContext` | `pre_llm_call` shell hook | `UserPromptSubmit` hook, `additionalContext` | `UserPromptSubmit` hook in `hooks.json`, with its trust table |
| `route-once` (one-time hook) | the same hook, emitting only on a session's first member turn | same | same | same |
| `route-system` | **not supported** (HE-ADAPTER-007) | `agent.system_prompt` | `--append-system-prompt`, passed on every turn, `--resume` included | `developer_instructions` only if Codex 0.165.0 accepts it under `--strict-config`, else refused |
| `route-startup` | `/workspace/AGENTS.md` | `SOUL.md` | `$CLAUDE_CONFIG_DIR/CLAUDE.md` | `$CODEX_HOME/AGENTS.md` |
| `route-skill` (untold skill) | `brain-first` skill | same | `$CLAUDE_CONFIG_DIR/skills/brain-first/` | `$CODEX_HOME/skills/brain-first/` |
| `route-told` (told skill) | the same skill, plus one fixed sentence in the cell's preamble file ("Use the brain-first skill."), sha pinned; the runner's per-cell preamble carries it, not the adapter | same | same | same |
| `route-placebo` | per-turn hook carrying `placebo.md` | same | same | same |
| `route-slot-told@<id>`, `route-slot-skill@<id>` | slot bundle as the skill (later runs only) | same | slot bundle in `$CLAUDE_CONFIG_DIR/skills/` | slot bundle in `$CODEX_HOME/skills/` (later runs only) |

**Drivers (Claude Code only).**

- `cli` is `claude -p` and the default when the config names no driver.
- `sdk-preset` runs the same CLI through the Agent SDK with the `claude_code` system prompt preset.
- `sdk-default` runs it through the Agent SDK with no system prompt set.
- Examples: `sdk-preset+route-told`, `sdk-default+route-skill`, `sdk-preset+route-slot-told@<slot_id>`.
- `parseRouteConfig` refuses a driver prefix on any other harness.

### The one-time hook and the placebo

- **`route-once`** uses the `route-hook` hook script. It emits only on the first member turn of each session. That makes it the matched-dose arm: one copy per session, as the system and startup routes give one copy per request.
- **`route-placebo`** uses the same hook with `placebo.md` instead of the rule, on every member turn. That makes it the length-matched control for `route-hook`.

### The emit rule

The adapter decides, the hook only prints. Before it hands a turn to the harness, the adapter:

1. computes the turn's session key and its `session_turn`, the 1-based count of turns it has handed to that session;
2. writes `emit=1` or `emit=0` to the turn state file (docs/adapters.md, "Emit flag");
3. runs the harness turn. One stateless hook script per harness reads the flag and prints the rule bytes, the placebo bytes or nothing.

| Route | Emits |
|---|---|
| `route-hook` | every member turn (`emit=1`) |
| `route-once` | `emit=1` when `session_turn` is 1, else `emit=0` |
| `route-placebo` | every member turn, the placebo bytes |
| every other route | no hook; `emitted` is null in the per-turn status |

The adapter records `session_key`, `session_turn` and `emitted` per turn (`RouteTurnStatus`). That is an exposure receipt only. The scorer takes sessions from the task's own turn order (below), so the repeat-turn subset is the same in every arm.

### Sessions

**A session is keyed on channel, member and thread.**

- **The key:** `session_key` is `<channel id>` for a top-level message and `<channel id>:<thread_ts>` in a thread. The runner writes it on every `TurnWindow`, beside `thread_ts` (H10 PR 5).
- **Member:** a DM channel holds one member and the bot, so in a DM the channel id fixes the member. In a shared channel every member's turns share the channel's session, as the adapters' sessions do today.
- **Thread:** a task turn with `thread = "new"` gets a `thread_ts` from `runner/trial/turns.ts`, so it opens a new session in the same conversation. All four of cn-03's turns open sessions.
- **The adapters' own keys map one to one:** `dm:<member>` or `channel:<id>`, plus `:t<thread_ts>` in a thread ([docs/adapters.md](../../docs/adapters.md), "Per harness").

### History carry gates repetition

The one-time hook's single copy has to stay in the session's history, or "1 copy against N" means nothing.

- **Shown:** OpenClaw and Hermes ("Later requests" above: a hook copy stays in each user message in the history).
- **Not yet shown:** Claude Code's `additionalContext` on `--resume`, and Codex's hook context on resume.
- **The gate:** a harness enters the repetition pairs only if its cr-01 golden capture shows the once copy carried on the repeat turn. One that fails drops from the pairs before any spend, declared.

### Golden captures

Keyless, against a fake upstream, for every harness and route, on three session patterns plus a tool-call follow-up:

- **cn-02:** a real DM resume (dm:pree, dm:ilse, dm:pree).
- **cr-01:** three turns in one channel.
- **cn-03:** the fresh-thread case, four session firsts.

They assert:

- where the bytes land, and `emitted` per turn;
- copies per request by location (system, user text, tool result);
- copies carried in history. The one-time hook gives 1 copy on every later request in the session. The per-turn hook gives N copies on turn N. On cn-03 both hooks emit on every turn.

A route whose golden capture does not match is refused before any trial.

### Skill-route slots

A slot is a skill bundle another team supplies for the `route-slot-told` and `route-slot-skill` arms. The first is gstack-evals' (internal-task). Its hand-off is in [slots/README.md](slots/README.md).

- **Bundle files:** `harnesses/routes/slots/<slot_id>/` holds `slot.json` and `skill/<skill_name>/SKILL.md`, plus any reference files under `skill/<skill_name>/`. Nothing else.
- **`slot.json` fields** (all strings):
  - `slot_id`: the directory name, `[a-z0-9][a-z0-9-]{0,62}`.
  - `owner` and `skill_name`: the name follows Claude Code's skill-name rule.
  - `description`: at most 57 characters, the same text as the SKILL.md front matter.
  - `told_sentence`: at most 60 bytes.
  - `bundle_sha256`, `source` (the supplying commit) and `notes`.
- **`bundle_sha256`:** the sha256 of the `sha256sum` listing of every file except the top-level `slot.json`. The listing is sorted by path bytes, one `<hex>  <path>` line per file. In a container:
  `cd <bundle> && find . -type f ! -path ./slot.json | sed 's|^\./||' | LC_ALL=C sort | xargs -d '\n' sha256sum | sha256sum`
- **Into the image:** `harnesses/routes/slots/` is outside every image's build context. So the prereg pull request byte-copies a landed bundle into `harnesses/claude-code/routes/slots/<slot_id>/`. `tests/route-schema.test.ts` checks every copy against its source's `bundle_sha256`, and the provenance manifest then covers it.
- **Host-side check:** `bun scripts/routes/slot-check.ts <bundle dir>` checks:
  - the digest;
  - no symlink, no `..` path, no executable bit;
  - the description and `told_sentence` limits;
  - a 256 KiB size cap;
  - that `SKILL.md`'s front matter parses as YAML, holds only `name` and `description`, and matches `slot.json`, and that its body (after the front matter) carries `instruction.md`'s bytes verbatim.

  It exits 0, or exits 1 with an HE-ADAPTER-007 line. It runs on the host, in preflight, never in a container: the Hermes image has neither bun nor node. Inside the image the adapter re-checks only `bundle_sha256`, with `sha256sum`.

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

### 2026-11-01: the H10 route contract on four harnesses, the placebo and slots (internal-task)

Added "The placebo" (`placebo.md`, 289 bytes, sha pinned) and "Routes on four harnesses". The second covers the route table for OpenClaw, Hermes, Claude Code and Codex, the Claude Code drivers, the one-time and placebo routes, the emit rule, the session key, the history-carry gate, the golden captures and the skill-route slot contract. Why: H10 (internal-task) moves the route test to frontier models on four harnesses, and its adapter, runner and prereg pull requests build against this page. No adapter changes in this one.

### 2026-10-30: page created (internal-task)

harness-evals v0.0.46. The instruction, its source and sha256, the five routes per harness, the refusals and the surface table. Why: run `anatomy-instruction-route-2026-11` delivers one instruction through each route a harness supports and its preregistration cites this page.
