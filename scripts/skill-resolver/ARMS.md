# Skill-resolver arms on the four push harnesses (internal-task)

**What this is:** the agent-phase arms of the skill-resolver eval (internal-task; its approved plan is kept outside this repository) on OpenClaw, Claude Code, Codex and Hermes. QM's arms are built elsewhere.

Each arm is an opt-in cell config. Any other config leaves every file each adapter writes and every command line it runs byte-identical (the existing route and adapter tests prove it).

## Configs

| Config | Catalog installed | Harness setting | Per-turn hook |
|---|---|---|---|
| `skills-native` | the catalog | none | runs the resolver with `--shadow` every member turn, logs the result, injects nothing |
| `skills-resolver` | the catalog | none | runs the resolver every member turn and pushes the block |
| `skills-names-only` | the names-only catalog (each description set to the name) | the listing limits Step 0 found, raised | none |
| `skills-no-catalog` | nothing | bundled skills off where config allows | none |
| `skills-usage-ordered` | OpenClaw only: the top of an ordered list | none | none |

**Per harness:**

- **OpenClaw 2026.10.6:** catalog in `/workspace/skills`. Hook: plugin `he-skill-resolver` (template in `scripts/skill-resolver/openclaw-plugin/`), `before_prompt_build` runs the wrapper and returns the block as `appendContext`; installed like H10's route plugin (`plugins install --link`, `enable`, `hooks.allowConversationAccess true`, `plugins inspect --runtime` must say loaded). names-only: `skills.limits` `maxCandidatesPerRoot`, `maxSkillsLoadedPerSource`, `maxSkillsInPrompt` 1000 and `maxSkillsPromptChars` 1000000. no-catalog: `skills.allowBundled` set to one name no skill has (an empty list counts as unset). usage-ordered: the first `top_n` names of the kit's `usage-order.txt` (default 150, OpenClaw's `maxSkillsInPrompt` default) are installed and nothing else, because OpenClaw 2026.10.6 has no setting that orders the prompt listing (`prepareSkillsForPrompt` sorts by name unless `preserveOrder`, which only the sandbox execution-workspace path sets), and `disable-model-invocation` also hides a skill from `skills_read`.
- **Claude Code 2.1.312:** catalog in `$CLAUDE_CONFIG_DIR/skills`. Hook: one more `UserPromptSubmit` group in `settings.json` with `_he: "skill-resolver-v1"` on its entry, beside (never inside) gbrain's turn-rule entry, so the installer check that counts `_gbrain: "turn-rule-v1"` entries still finds one. names-only: `SLASH_COMMAND_TOOL_CHAR_BUDGET=100000`. no-catalog: `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`.
- **Codex 0.165.0:** catalog in `$CODEX_HOME/skills`. Hook: one more `UserPromptSubmit` group in `hooks.json`, trusted by its own `[hooks.state]` table (`trust-hash.cjs`). Its command does not carry `GBRAIN_HOOK_LANE=turn-rule`, so the installer check still finds exactly one turn-rule group. names-only: `[skills] max_context_tokens = 10000` (the cap) appended to `$CODEX_HOME/config.toml`. no-catalog: `[skills.bundled] enabled = false` there.
- **Hermes v2026.9.24 (one-shot):** catalog in `$HERMES_HOME/skills`. Hook: a marked `hooks.pre_llm_call` block running the wrapper, plus its `shell-hooks-allowlist.json` entry; `hermes hooks doctor` must report it healthy. names-only: catalog transform only (Hermes has no listing limit key). no-catalog: the marker file `$HERMES_HOME/.no-bundled-skills`.

Every arm runs on the serve entry only; the run entry refuses a skills config (HE-ADAPTER-007, exit 2), as H10 refuses its hook routes there.

## The kit

The arms read one directory, `/opt/skill-resolver` in the container (`HE_SKILL_KIT_DIR` overrides it for process-level tests), built by `bun scripts/skill-resolver/build-kit.ts --catalog <catalog> --out <kit>`. It holds `kit.json`, `bin/gbrain` (the resolver; today the stand-in `scripts/skill-resolver/gbrain-stub.ts`, compiled), `bin/he-skill-hook` (the wrapper, `scripts/skill-resolver/hook-wrapper.ts`, compiled), `catalog/skills`, `names-only/skills`, `openclaw-plugin/`, `index/<harness>/gbrain-home` (the index and its build receipt, built once per kit inside the harness image with the catalog where the adapter installs it for OpenClaw and Claude Code, and at the kit's own read-only copy `/opt/skill-resolver/catalog/skills` for Codex and Hermes, whose sessions write into their skills root and would make an in-root index stale) and, for OpenClaw's usage-ordered arm, `usage-order.txt`.

**Swapping in the real gbrain** is `build-kit.ts --gbrain <binary>`: the command lines, the input JSON and the checks stay the same.

## Hook wrapper

`bin/he-skill-hook <hook.json>`, one program for all four hooks. The adapter writes:

- `$HE_SESSION_STATE_DIR/he-skills/hook.json`: `{harness, arm, mode: "shadow"|"push", gbrain, gbrain_home, catalog, expect_catalog, receipt, status_dir, turn_file, top_k: 5, timeout_ms: 10000}`. `gbrain_home` is a copy of the kit's `index/<harness>/gbrain-home` under `he-skills/`, so the resolver can keep session state; `receipt` stays the kit's read-only receipt; `expect_catalog` is the receipt's `catalog_hash`; `status_dir` is `$HE_LOG_DIR/skill-resolver`.
- `$HE_SESSION_STATE_DIR/he-skills/turn.json`, before every member turn: `{turn, name, session_key, window_key, session_turn, message, previous_user_message?}`, where `name` is the turn file's base name (`turn-0001`), `session_key` the adapter's own session key, `message` the member's own message (the turn request's `text`) and `previous_user_message` the same session's previous member message.

**Resolver input is the member text.** The resolver ranks the member's own message, not the full prompt the harness receives. The prompt adds the runner's preamble (tasks/multiuser/_shared/preamble.md), which is eval scaffolding and the same on every turn; in real use a hook sees only the user's own message.

Each call runs `gbrain skills resolve --catalog he-skills --stdin --json --session <session_key> --harness <h> --top-k 5 [--shadow] --fail-open --expect-catalog <hash>` under `env -i` with `PATH`, `HOME`, `GBRAIN_HOME` and `GBRAIN_SKILLS_NO_AUTOREBUILD=1`. It always exits 0, and prints nothing on any failure (a usage error's exit 2, any nonzero exit, a timeout, output that is not the schema_version 1 object). A second call in the same turn reuses that turn's result.

**Resolver contract (spec section 9, gateless):** no score gate; `no_skill` is true only with `no_skill_reason` `ack` or `no_match`. Each session spends at most 2,000 block tokens, paced: `k` is 5, then 3 once half is spent, then 1 at 80%, and after half only a name, trigger or routing match spends budget. Then the block is empty and `budget_exhausted` is true. A session never repeats a skill, except one the message names and a strong top-1 match 10 or more turns after it was last suggested. Every result carries `k`, `block_reason` (match, ack, no_match, deduped, below_pace, budget_exhausted, error) and `budget_phase` (under_half, half_to_80, over_80, exhausted). Shadow keeps its own session state and advances it as if the block were delivered, so shadow and on mode give the same block sequence. The stand-in has no trigger or routing fields, so a name match stands in for all three.

**Per-turn status:** one line per call in `$HE_LOG_DIR/skill-resolver/status.ndjson`: `code` (OK, NO_SKILL, BUDGET_EXHAUSTED, EMPTY, an error code from the resolver such as INDEX_MISSING or CATALOG_MISMATCH, EXIT_<n>, WRAPPER_TIMEOUT, BAD_JSON, BAD_SCHEMA, SPAWN_FAILED, NO_TURN), `timing_ms`, `index_stale`, `index_hash`, `gbrain_version`, `catalog_hash`, `block_sha256`, `block_bytes`, `block_tokens`, `suggestions`, `deduped`, `no_skill` and `no_skill_reason`, `budget_exhausted`, `session_block_tokens`, `k`, `block_reason`, `budget_phase`, `injected`, `repeat`, `argv`, and `infra` with `infra_reasons`. The full result goes to `results.ndjson`.

**INFRA:** a turn is INFRA when the result says `index_stale`, when its `index_hash` or `gbrain_version` differ from the build receipt, on CATALOG_MISMATCH, or when the receipt cannot be read. An empty block because the budget is spent (BUDGET_EXHAUSTED) is a result, not INFRA. The analysis is intention-to-treat.

**Per-shard preflight:** `bun scripts/skill-resolver/preflight.ts --kit <kit> [--harness <h>]...` runs one resolve per harness through the wrapper inside the harness image and refuses (exit 1) unless the status line is OK, not INFRA, and its command line carries `--fail-open` and `--expect-catalog`. It then runs the shadow replay check for each harness.

**Shadow replay check:** `bun scripts/skill-resolver/shadow-replay-check.ts (--kit <kit> | --gbrain <binary>) [--harness <h>]` builds an index of a fixed fixture catalog with the pinned binary, replays one fixed 40-turn transcript in on mode and in shadow mode, interleaved in one session, and requires byte-identical block sequences. It prints `SHADOW_REPLAY_OK` or `SHADOW_REPLAY_FAIL` and exits 1. A failure is INFRA for the shard. QM's wrapper calls the same script. With `--until-exhausted` it replays a long transcript until the budget runs out and requires at most 2,000 delivered block tokens and an empty block with `budget_exhausted` on every turn after; it prints `BUDGET_REPLAY_OK` or `BUDGET_REPLAY_FAIL`.

**Field names:** the wrapper, the replay check, preflight and the capture checks read every result through one table, `RESULT_FIELDS` in `scripts/skill-resolver/result-fields.ts`, from the pinned build's field names (and any enum values it spells differently) to ours. When the pin lands, matching its names is an edit to that table. `results.ndjson` keeps the raw result and the mapped one as `fields`.

## Records

`$HE_LOG_DIR/skill-arm.json` (the arm, the kit's hashes, each file written with its sha256, the settings applied, the hook check) and `ready.skill_arm` `{arm, catalog_hash, gbrain_catalog_hash, index_hash, skills_installed, hook}`.

**Refusals (HE-ADAPTER-007, exit 2 before ready):** a skills config on the run entry, `skills-usage-ordered` off OpenClaw, a kit that is missing or incomplete, a skills root that already holds skills (on OpenClaw, whose root is the task's /workspace/skills, only an entry named like a skill the arm installs; a task's own skills, such as set T's t37 `skills/release-notes`, are kept and listed in `install.kept`), a hook that does not load (OpenClaw) or is not healthy (Hermes), and a Hermes config that already has `hooks:`.

## Checks

- `bun test tests/skill-resolver-arms.test.ts`: the stand-in, the wrapper and the extractor, keyless; and the capture checks, skipped without docker and the kit images.
- `bun scripts/skill-resolver/arm-captures.ts`: one keyless capture per harness and arm against the fake endpoints, as Step 0 ran them, then the checks: resolver-on carries the block's exact bytes in the captured request, native carries none and logs the shadow result, fail-open carries none and logs the code, budget (the stand-in's budget switch) carries none and logs BUDGET_EXHAUSTED without INFRA (with a real gbrain build, or `--budget-replay`, the budget cell is the `--until-exhausted` replay instead), names-only and no-catalog list what Step 0 counted.
- `bun scripts/skill-resolver/got-skill.ts`: which catalog skills a trial opened, from its captured requests and tool trace. Only a read counts: the harness's skill tool, its file-read tool, or its shell tool running a reader such as `cat` or `sed -n` on the SKILL.md; a write, an edit, an echo or a search that names the path does not.
