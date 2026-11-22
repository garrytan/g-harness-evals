# Post-run audits 1-3, gbrain-install-2026-11

**Takeaways.** Every recall the pinned scorer counted (94, including the excluded INFRA run) was served by a saved fact (gbrain's `remember` store), never by a page from the conversation archive, so Audit 1 moves nothing. Audit 1 didn't check the 59 recalls that rules a, b and c add to the headline a+b+c column (45 OpenClaw, 14 Claude Code), so this result covers the pinned scorer's recalls only. No recall was credited through a `head N` or `tail N` pipe, so Audit 2 withdraws nothing. The release-pin recount from the raw watcher and probe records matches the verdict exactly. One input claim was wrong: 5 recalled Claude Code trials have no brain database in their copied state, so where their brain holds the nonce is read from the save transcript, not the brain.

## Audit 1: recall from the conversation archive

Method: the recall turn of each recalled trial was re-parsed with the pinned `transcript.ts`, and each credited gbrain call output was classified by the result item that holds the nonce (a `facts` item or a `results` page slug). Each trial's `state/.gbrain/brain.pglite` was copied to scratch and opened with pglite 0.4.3 (the version gbrain v0.60.734.0 ships). Every table was searched for the nonce, and pages were split into `conversations/` (archive) and other slugs.

| Cell | Recalled | Recalled from archive | Nonce only in archive pages | Served by a saved fact | Brain not in the copy |
|---|---:|---:|---:|---:|---:|
| claude-code-opus-bare | 7 | 0 | 0 | 7 | 1 |
| claude-code-opus-paste | 12 | 0 | 0 | 12 | 4 |
| codex-sol-bare | 20 | 0 | 0 | 20 | 0 |
| codex-sol-paste | 20 | 0 | 0 | 20 | 0 |
| hermes-opus-bare | 0 | 0 | 0 | 0 | 0 |
| hermes-opus-paste | 7 | 0 | 0 | 7 | 0 |
| hermes-particle-bare | 9 | 0 | 0 | 9 | 0 |
| hermes-particle-paste | 9 | 0 | 0 | 9 | 0 |
| hermes-sol-bare | 4 | 0 | 0 | 4 | 0 |
| hermes-sol-paste | 5 | 0 | 0 | 5 | 0 |
| openclaw-opus-bare | 0 | 0 | 0 | 0 | 0 |
| openclaw-opus-paste | 0 | 0 | 0 | 0 | 0 |
| openclaw-particle-bare | 0 | 0 | 0 | 0 | 0 |
| openclaw-particle-paste | 0 | 0 | 0 | 0 | 0 |
| openclaw-sol-bare | 0 | 0 | 0 | 0 | 0 |
| openclaw-sol-paste | 0 | 0 | 0 | 0 | 0 |
| **Total (counted)** | **93** | **0** | **0** | **93** | **5** |

Totals: 94 recalled trials, 93 counted. Recalled from archive: 0. Nonce only in archive pages: 0.
Where the brain holds the nonce (counted): saved fact only, no page, 87; an explicit page as well as a saved fact, 1; brain not in the copy, 5.

Exceptions:

- Reported apart: hermes-particle-bare r5 (infra_error). Its recall was served by a saved fact and its brain holds the nonce as a saved fact only, no page.
- Brain not in the copy (5): claude-code-opus-paste r8, claude-code-opus-paste r13, claude-code-opus-bare r18, claude-code-opus-paste r18, claude-code-opus-paste r19. Their `state/.gbrain` holds only an owner file, notices and persistence, with no `brain.pglite`, and the older `results.partial-*` copies hold no state for them at all. The brain existed during the run: the probe saw it and the runner's own check marked it as holding the nonce. Their recall was served by a saved fact, and their save turn's `remember` reply says `write_through: skipped entity_page_missing, written: false`, so no page was written. This contradicts the brief, which said only s01 r19 lost its state. s01 r19 did not recall, so it is not in this audit.
- hermes-particle-bare r1: the agent saved with the gbrain CLI (`remember`), which also wrote the markdown page `memory/unattributed`, and the fact points to that page. The recall was still served by the fact.
- hermes-particle-bare r2: two facts hold the nonce: fact 2 (mcp:forget, world, expired); fact 3 (mcp:remember, world). The recall was served by the live fact.
- hermes-particle-bare r6: two facts hold the nonce: fact 2 (mcp:remember, private); fact 3 (mcp:remember, world). The recall was served by the live fact.
- hermes-particle-bare r2: the brain has 2 `conversations/` archive pages, and none of them holds the nonce.
- In 12 Hermes trials the credited output is text or cut JSON, so the item was read from the text ("excerpt from fact N" and similar markers). All of them are facts.

## Audit 2: `head` or `tail` with a bare number

Method: every recall and hinted turn of all 200 trials was re-parsed from the raw turn files. Every shell gbrain call whose last pipe stage is `head` or `tail` with a bare numeric operand was listed, and every credited recall event was split by kind.

Result: **0 recalls credited through a bare-number pipe, 0 credits withdrawn.** All 95 credited recall events across the 94 recalled trials are gbrain MCP tool calls. 0 are shell calls, so no file named N needed checking. The recall turns hold 3 shell gbrain calls and the hinted turns 9. 7 of those pipe into head or tail, all with a flag (`-15`, `-40`, `-60`) rather than a bare number, and none was credited. Per cell: 0 in every cell.

## Audit 3: the release-pin counts

Method: for each of the 198 counted runs, every line of `logs/install-watch.ndjson` and every `logs/turns/turn-NNNN.probe.json` was read and sorted by parsed time. The first and last non-null gbrain version were compared with `classification.probe_versions` and with the `pin` columns of `verdict.ts --json`.

| Cell | Arm | n | First not pin (verdict / recount) | Last not pin (verdict / recount) | No version seen (verdict / recount) |
|---|---|---:|---|---|---|
| claude-code-opus-bare | bare | 20 | 0 / 0 | 0 / 0 | 0 / 0 |
| claude-code-opus-paste | paste | 20 | 0 / 0 | 0 / 0 | 0 / 0 |
| codex-sol-bare | bare | 20 | 0 / 0 | 0 / 0 | 0 / 0 |
| codex-sol-paste | paste | 20 | 0 / 0 | 0 / 0 | 0 / 0 |
| hermes-opus-bare | bare | 10 | 0 / 0 | 0 / 0 | 8 / 8 |
| hermes-opus-paste | paste | 10 | 0 / 0 | 0 / 0 | 3 / 3 |
| hermes-particle-bare | bare | 9 | 0 / 0 | 0 / 0 | 0 / 0 |
| hermes-particle-paste | paste | 9 | 0 / 0 | 0 / 0 | 0 / 0 |
| hermes-sol-bare | bare | 10 | 0 / 0 | 0 / 0 | 6 / 6 |
| hermes-sol-paste | paste | 10 | 0 / 0 | 0 / 0 | 5 / 5 |
| openclaw-opus-bare | bare | 10 | 0 / 0 | 0 / 0 | 0 / 0 |
| openclaw-opus-paste | paste | 10 | 0 / 0 | 0 / 0 | 0 / 0 |
| openclaw-particle-bare | bare | 10 | 0 / 0 | 0 / 0 | 0 / 0 |
| openclaw-particle-paste | paste | 10 | 0 / 0 | 0 / 0 | 0 / 0 |
| openclaw-sol-bare | bare | 10 | 0 / 0 | 0 / 0 | 0 / 0 |
| openclaw-sol-paste | paste | 10 | 0 / 0 | 0 / 0 | 0 / 0 |
| **Total** | | **198** | **0 / 0** | **0 / 0** | **22 / 22** |

Result: no difference. 0 runs differ from `probe_versions` and 0 cells differ from the verdict. Every version any record saw was the pin, 0.60.734.0.

Edge cases checked (the known limits of the version columns):

- Watcher file missing: 0. Unparseable watcher lines: 0. Unparseable probe files: 0. (Some watcher files end without a final newline, and both the runner and this recount read that last line.)
- A gbrain binary seen but with a null version (the probe's 5-second `--version` timeout and its cache by path, mtime and size): 0 records.
- More than one version in a run (an off-pin first install that the watcher's 1-second sampling could miss): 0.
- A first version that came from an end-of-turn probe rather than the watcher: 0.
- The 22 no-version runs are all Hermes (Opus 5.5 and GPT-6.1 Sol) and all died at the binary step. No record saw a gbrain binary on PATH or in `~/.bun/bin`, `~/.local/bin` or `~/.npm-global/bin`, and no gbrain call printed gbrain output: 3 calls exited 0 with output, and those printed only Bun's `1.4.4`, "gbrain not installed" or a status line. So "no version seen" there means gbrain never ran, not a probe miss. One of these runs, hermes-opus-bare r1, has the descriptive transcript `version` field set to Bun's `1.4.4`, the case Amendment 1's note 4 describes. That field feeds no count.
- Excluded runs, listed apart: hermes-particle-bare r5 (infra_error, saw 0.60.734.0), hermes-particle-paste r10 (model_error, saw 0.60.734.0).

## Notes

- Read-only: trial data was only read. Brains were copied to scratch before pglite opened them, and the `.gbrain-ipc-secret` file and `secret/` paths were left out of every copy and extraction. No network, no model or harness runs and no spend. One slip: early on I ran a read-only `git log -3` in run-wt, against the brief's no-git rule.
- Scripts, in scripts/: recall-events.ts, save-events.ts, run-brains.sh with brain-dump.ts (it needs pglite 0.4.3, the version gbrain v0.60.734.0 ships), audit1.py, audit2.ts, audit3.ts, audit3-noversion.ts and make-md.py. Each takes the run/ folder of the raw archive raw-2026-11-17-gbrain-install--run and an output folder as arguments; scripts/README.md gives the order. Scratch was deleted after the run, so audit1.py needs recall-events.ts, save-events.ts and run-brains.sh run again before it can be rerun.
