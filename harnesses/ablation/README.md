# Prompt-archaeology layer maps (internal-task)

**A layer map says, byte by byte, which part of a harness's built-in prompt belongs to which layer.** The metering proxy uses it to cut one layer out of every request, so a cell can test what that layer buys. One map per harness, wire and model, generated from keyless recaptures and coded by two agents of different model families.

- Plan: decisions 1, 3, 4 and 9 of the internal-task plan (the approved copy is in the project's private drive, handoffs/internal-task/autoplan/plan.md).
- Captures: [docs/harness-anatomy](../../docs/harness-anatomy/README.md), records `*-opus` and `*-sol`.
- Code: [scripts/ablation/maps.ts](../../scripts/ablation/maps.ts) (units and anchors), [scripts/ablation/gen-anchors.ts](../../scripts/ablation/gen-anchors.ts) (candidates), [scripts/ablation/settle.ts](../../scripts/ablation/settle.ts) (agreement, settling, maps).
- Check: [tests/ablation-maps.test.ts](../../tests/ablation-maps.test.ts).

## The seven removable layers

Each removable span gets exactly one of these.

- **identity**: who the bot is. Persona, name, "you are ...", SOUL text.
- **tool-guide**: prose in the system prompt on how and when to use tools. Parallel calls, which tool to prefer, tool-call style, how to delegate to subagents.
- **tool-descriptions**: advisory prose inside a tool's description field. What the tool does, when to use it, tips and examples.
- **safety**: care, security, permission and skill-safety rules. Confirming risky actions, refusing harmful work, treating outside content as data, approvals.
- **memory-skills**: memory sections, the skill index and skill-workshop text, wherever they are carried. This includes the skills list in Claude Code's system-role message.
- **work-habits**: how to get the job done. Planning, finishing the job, execution bias, promised work, mid-turn steering, context management.
- **style**: how the answer reads. Tone, formatting, final-answer shape.

## Never removed

These stay in every cell, including the minimal one. A removal tests advice, not plumbing.

- **protocol-and-discovery**: what the model needs to find and call a tool.
  - Tool names, parameter schemas and required fields.
  - Deferred-tool listings and indexes: OpenClaw's deferred tool section, the world-tool index in Hermes's `tool_search` description, Claude Code's deferred tool names and ToolSearch instructions.
  - Codex's `exec` contract (how to call nested tools, their declarations) and any freeform tool grammar.
  - Call protocol: the format a call or its input must take.
- **runtime-environment**: facts about this run. Date and time, working directory, token budget line, platform, host, the model name line.
- **The eval's preamble and every user-role task message.**
- **Tool results and anything else generated per turn.**

Maps only ever name the first two classes. The last two are never addressable, so no span can touch them.

## What a map can address

A span is found by its location and an anchor (the literal text it starts with).

- A system block, by index (Anthropic Messages).
- The Responses `instructions` field.
- A harness-injected message, by role, ordinal and anchor. The ordinal counts messages of that role (`any` for a message the harness repeats every turn). A Codex `additional_tools` item is not a message and is not counted.
- A sub-span of a tool description, by tool name and anchor.
- A Codex `additional_tools` entry, by namespace and tool name (its description, cut into sub-spans).
- A tool definition (name and parameter schema, without the description). Always protocol-and-discovery.

Never addressable:

- User turns, including the eval preamble and the member's message.
- Tool results, `function_call_output` and `custom_tool_call_output` items.
- A user-role message that holds a tool result, even if it also carries text.

A span runs from its anchor to the next span's anchor. The first span of a unit starts at byte 0. A section that mixes layers is split at paragraph level (`paragraphs` in the map).

## Rules for coders

- Code each candidate on its own text. Pick the one label that fits most of its bytes.
- Use a never-removed class only for text that matches the list above. Advice about tools is not protocol, even if it names a tool.
- Inside a tool description, use tool-descriptions or protocol-and-discovery. The one exception is a skill or memory index carried in a description, which is memory-skills.
- Outside tool descriptions, never use tool-descriptions.
- Write a one-line reason.

## Settling a disagreement

The two coders work alone and never see each other's codes. Where they differ, this rule decides, in order:

1. **Never-removed wins over a removable layer.** Plumbing removed by mistake breaks the harness, and the cell then tests plumbing instead of advice. Advice kept by mistake only makes a cell milder.
2. **Two never-removed classes:** protocol-and-discovery.
3. **Inside a tool description:** memory-skills, then tool-descriptions, win over any other layer.
4. **Outside a tool description:** a tool-descriptions code is dropped and the other code stands.
5. **Two other removable layers:** the more specific one wins, in this order: safety, memory-skills, tool-guide, work-habits, identity, style.

A code that is not one of the nine labels counts as missing, and the other coder's code stands. `agreement.json` lists every disagreement with both codes and the step that settled it.

Tool definitions and the world MCP tools' descriptions are fixed as protocol-and-discovery by rule, and are not coded. The world tools belong to the eval.

## Files

- `<harness>.<wire>.layers.json`: the settled map, valid against [layers.schema.json](layers.schema.json).
- `manifest.json`: each map's sha256. The proxy checks it at bind time and refuses a mismatch.
- `coding/items.json`: what each coder saw: every distinct candidate text and where it occurs. An item Claude Code sent carries `text_sha256`, the sha256 of its text, instead of the text, because Claude Code's prompt is not ours to publish. The item id is the first 16 hex characters of the same digest.
- `coding/opus.json`, `coding/sol.json`: the two coders' raw codes, with model ids.
- `agreement.json`: percent agreement and Cohen's kappa, per harness, per map and overall, and every disagreement with how it was settled. A disagreement on a Claude Code item carries the item's `text_sha256` instead of its text. Every number comes from the item ids, their contexts and the two coder files, so these public files re-derive it (`tests/ablation-public-form.test.ts`).

## Re-running for a new pin

A coding item is keyed by the sha256 of its text, so text that did not change keeps its codes. Only new text needs coding.

1. Recapture keyless on the cell's model and wire (`scripts/anatomy/capture.ts`) on a clean tree, and publish (`scripts/anatomy/publish.sh`).
2. Point the row in `COMBOS` (`scripts/ablation/gen-anchors.ts`) at the new record.
3. Run `bun scripts/ablation/gen-anchors.ts --items <file>`, with the file outside the repository: it holds raw harness text. It prints any anchor that does not resolve in every captured request.
4. Run `bun scripts/ablation/settle.ts --missing <file>` to list the items with no codes yet. This file holds raw text too, so it must also be outside the repository.
5. Give two coders of different model families this README and only those items. Append their codes to `coding/opus.json` and `coding/sol.json`, with their model ids.
6. Run `bun scripts/ablation/settle.ts`. It writes the maps, the hashes-only `coding/items.json` and `agreement.json`, and `manifest.json`. It writes the hashes-only form whatever inputs are present. To keep the raw items and agreement for the coders, add `--with-private-text --out <dir>`; the script refuses a directory inside the repository.
7. Run `bun test tests/ablation-maps.test.ts tests/ablation-public-form.test.ts`.
8. A changed map has a new sha256. A preregistration names the sha256 it runs, so a changed map means a new run or a dated amendment.

## Limits

- **Parameter descriptions stay.** The description strings inside a parameter schema are kept with the schema as protocol. Only a tool's top-level description is cut.
- **Agent turns only.** The plain and tools scenarios produced only agent requests on every harness. Compaction, subagent, utility and side calls were not captured, so the maps name one family each. An unknown family passes through untouched and is counted.
- **Persisted memory stays.** Hermes renders a trial's MEMORY.md and USER.md (header lines of 46 `═`, entries split by `§`) between its skill index and "Conversation started:", inside the skill index span's range. No capture carried it, since every capture starts with empty memory. The filter treats it as a never-removed insert: when a whole removable span with a fixed length and a text sha256 is followed, before the map's next span, by extra text that starts on a new line, it removes only the span's own mapped bytes (checked against the sha256), keeps the rest byte for byte and names it in the receipt's `inserts` (bytes and sha256, never the text). A changed span, or extra text where the map's next span was not found, is still refused. Paragraph-split spans take no insert. No map changed for this.
- **Housekeeping calls pass through.** A request for one of the cell's `utility_models` (a harness's own housekeeping model at its shipped default, internal-task, 2026-11-01) is never filtered: its receipt names the `housekeeping` family, and it is counted in `housekeeping_requests`, not as an agent, did-not-take, partial or unknown-family request, so it never counts toward the 5 percent bound. OpenClaw sent none in any capture or counted trial.
- **Text inside a user turn stays.** OpenClaw puts a timestamp at the start of the member's message. It is part of the user turn, so no map touches it.
