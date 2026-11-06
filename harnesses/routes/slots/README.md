# Skill-route slots: the internal-task-a hand-off (internal-task-b)

**A slot lets gstack-evals (internal-task) put its own skill in front of the H10 rule test.** gstack-evals hands over a skill bundle. H10 runs it as two arms on Claude Code and scores it with the same instruction-followed rule as every other route. The route contract is in [../README.md](../README.md), "Skill-route slots".

- **Status:** no bundle has landed. This directory holds only this page until one does.
- **Deadline:** the bundle must land here before the H10 prereg pull request opens. Otherwise block G drops, declared, and is never added by amendment.

## Arms

- **`sdk-preset+route-slot-told@<slot_id>`:** the bundle's skill is installed, and the cell's preamble carries the bundle's `told_sentence`.
- **`sdk-preset+route-slot-skill@<slot_id>`:** the bundle's skill is installed, and nothing tells the model about it.
- **Where they run:** Claude Code with the Agent SDK preset driver, on Opus 5.5 (block G, wave 2).
- **Control:** both arms pair with block B's `sdk-preset+route-tool` cell, by task and turn, from the same commit and images. That cell is also the no-gstack arm (R44).

## Harnesses

- **This run:** Claude Code only.
- **Later runs:** Codex on gpt-6.1-sol, OpenClaw and Hermes accept the same bundle. Their cells need their own lease, at internal-task's choice.

## What gstack-evals supplies

One directory, `harnesses/routes/slots/<slot_id>/`, committed here:

| File | What it holds | Limits |
|---|---|---|
| `skill/<skill_name>/SKILL.md` | front matter `name` and `description`, then a body that carries the H10 rule bytes verbatim (`../instruction.md`, sha256 `4a81cb9b35d6ad6f205723618f15e6c3dc66586cbb41f0ebc72141b74669230f`) | `name` follows Claude Code's skill-name rule (lowercase letters, digits, hyphens, at most 64 characters); `description` at most 57 characters, Hermes's display limit |
| `skill/<skill_name>/...` | any reference files the skill reads | no symlink, no executable bit |
| `slot.json` | `slot_id`, `owner` (`internal-task`), `skill_name`, `description` (the same text as the front matter), `told_sentence`, `bundle_sha256`, `source` (the gstack-evals commit), `notes` | `slot_id` is the directory name, `[a-z0-9][a-z0-9-]{0,62}`; `told_sentence` at most 60 bytes |

- **Nothing else in the directory.** The whole bundle is at most 256 KiB.
- **`bundle_sha256`:** the sha256 of the sorted `sha256sum` listing of every file except `slot.json`. The recipe is in [../README.md](../README.md), "Skill-route slots".
- **Check it before you hand it over:** `bun scripts/routes/slot-check.ts harnesses/routes/slots/<slot_id>` exits 0 or prints the HE-ADAPTER-007 reason.

## Interface

1. **Into the image.** This directory is outside every image's build context. So the prereg pull request byte-copies the bundle to `harnesses/claude-code/routes/slots/<slot_id>/`. `tests/route-schema.test.ts` checks the copy against `bundle_sha256`.
2. **Preflight.** On the host, `scripts/routes/slot-check.ts` runs the full shape check.
3. **At trial start.** The adapter reads `HE_HARNESS_CONFIG` and copies the bundle from `/opt/harness/routes/slots/<slot_id>/` to the harness's skill directory:
   - Claude Code: `$CLAUDE_CONFIG_DIR/skills/`.
   - Later runs: OpenClaw `/workspace/skills/`, Hermes `$HERMES_HOME/skills/`, Codex `$CODEX_HOME/skills/`.

   It then re-checks `bundle_sha256` with `sha256sum`, which every image already has. Any failure is HE-ADAPTER-007, exit 2 before ready.
4. **Scoring.** The same instruction-followed rule as every route. A bundle that teaches a different rule needs its own checker and its own run.

## What comes back to internal-task

- Per-cell rows for discovery, load, compliance and benefit.
- The bundle's golden capture: where its bytes land in the request.
- The trial receipts.

## Changelog

### 2026-11-01: page created (internal-task)

The internal-task hand-off for H10's skill-route slot: arms, harnesses, files and limits, interface, deadline and what comes back. Why: block G runs a gstack-evals skill bundle only if it lands before the H10 prereg opens.
