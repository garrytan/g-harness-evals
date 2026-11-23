# Hermes: what the skill resolver ranks (keyless)

**Takeaways**

- **On Hermes, gbrain ranks the whole user turn, and our runner puts a 3.4 KB task preamble in that turn.** The member's ask is about 80 characters of it. With the preamble in place, the named skill ranked 23rd to 42nd and never reached the top-5 block, at 351 or 1,500 skills.
- **With only the member's message in the user turn, the named skill ranks 1st on both turns, at 351 and 1,500 skills.** Moving the preamble's fixed text into Hermes's system prompt also works (1st or 2nd), because Hermes never passes the system prompt to the hook.
- **At 1,500 skills the lane runs close to its 50 ms deadline:** 35 to 45 ms when it delivered. One message-only try at 1,500 missed the deadline on both turns (51.2 and 51.3 ms) and delivered nothing. One rerun passed.

**Why.** Hermes runs `pre_llm_call` hooks with `user_message=original_user_message` (agent/turn_context.py, `_collect_pre_llm_call_context`, Hermes v2026.9.24). gbrain's hook lane ranks that text (src/core/skills/resolver/hook-lane.ts:233 at v0.60.742.0). The runner composes each turn from tasks/multiuser/_shared/preamble.md, and the adapter sends the result as the user turn (`hermes chat --query-file instruction.md`). So every rule in the preamble is ranked along with the ask.

**Variants** (gbrain v0.60.742.0, fake model, no key):

- **Full preamble:** the shipped runner, preamble.md in the user turn. These are the earlier `checks3h` runs.
- **Message only:** `--preamble scripts/skills-at-scale/preamble.message-only.md`, so the user turn is the message alone.
- **Preamble in the system prompt:** `--config skills-gbrain-setup-system-preamble --preamble scripts/skills-at-scale/preamble.turn.md`. The preamble's fixed text goes into config.yaml `agent.system_prompt`, and the user turn keeps the per-turn header (member, place, time) and the message.

The trigger pair is api-zone-email (turn 1, "Please use the pekmute tool to sort out the api zone email work for me today.") and backup-prompt-build (turn 2, "Please use the pekpekhap tool to sort out the backup prompt build work for me today.").

## End to end: the block on the same turn

| Skills | Variant | Turn 1 block names api-zone-email? | Turn 1 top 3 | Turn 2 new block names backup-prompt-build? | Turn 2 top 3 | Lanes |
|---|---|---|---|---|---|---|
| 351 | full preamble | no | email-inbox-triage, meeting-action-items, google-workspace | no | box | delivered, delivered |
| 351 | message only | yes, 1st | api-zone-email, zone-csv-pricing, file-zone | yes, 1st | backup-prompt-build, backup-pr-prompt-markdown, docs-index-backup | delivered, delivered |
| 351 | system prompt | yes, 1st | api-zone-email, apple-reminders, xurl | yes, 1st | backup-prompt-build, teams-meeting-pipeline, imessage | delivered, delivered |
| 1,500 | full preamble | no | email-inbox-triage, google-workspace, meeting-action-items | no (empty: all deduped) | none | delivered, empty |
| 1,500 | message only, try 1 | no block | none | no block | none | timeout 51.2 ms, timeout 51.3 ms |
| 1,500 | message only, rerun | yes, 1st | api-zone-email, zone-api-backup, notion | yes, 1st | backup-prompt-build, backup-pr-prompt-markdown, apple-reminders | delivered, delivered |
| 1,500 | system prompt | yes, 2nd | apple-reminders, api-zone-email, xurl | yes, 1st | backup-prompt-build, teams-meeting-pipeline, imessage | delivered, delivered |

Turn 2's top 3 is its new block after the session dedupe. The dedupe drops skills already shown in the session, which is why the system-prompt turn 2 puts backup-prompt-build 1st: it ranked 2nd behind apple-reminders, which turn 1 had already shown.

## Offline: the target's rank

`gbrain skills resolve --catalog hermes-user --harness hermes --json --explain-target <target>`, run on a copy of the trial's state, with each turn's exact prompt as the text. Offline there is no session, so no dedupe. The hook shows the top 5.

| Skills | Variant | Ranked chars | Turn 1 rank | Turn 1 top 3 | Turn 2 rank | Turn 2 top 3 |
|---|---|---|---|---|---|---|
| 351 | full preamble | 3,479 | 23 | email-inbox-triage, meeting-action-items, google-workspace | 32 | email-inbox-triage, meeting-action-items, google-workspace |
| 351 | header and message | 325 | 1 | api-zone-email, apple-reminders, xurl | 2 | apple-reminders, backup-prompt-build, xurl |
| 351 | message only | 78 | 1 | api-zone-email, zone-csv-pricing, file-zone | 1 | backup-prompt-build, backup-pr-prompt-markdown, docs-index-backup |
| 1,500 | full preamble | 3,479 | 28 | email-inbox-triage, google-workspace, meeting-action-items | 42 | email-inbox-triage, meeting-action-items, google-workspace |
| 1,500 | header and message | 325 | 2 | apple-reminders, api-zone-email, xurl | 2 | apple-reminders, backup-prompt-build, xurl |
| 1,500 | message only | 78 | 1 | api-zone-email, zone-api-backup, notion | 1 | backup-prompt-build, backup-pr-prompt-markdown, apple-reminders |

The per-turn header's own words (the member's name, the channel, the time) pull apple-reminders and xurl into the top 3. Every row is in `hermes-ranked-text.json`.

## What this changes

- A Hermes skills cell that keeps the shipped runner measures the preamble as much as the catalog. To measure the resolver, a cell needs the message alone in the user turn, or the preamble's fixed text in the system prompt. Either one changes what the model sees compared with every other harness, so it has to be declared as a difference.
- The other harnesses face the same question wherever their hook ranks the user turn. Only Hermes was rerun here.
