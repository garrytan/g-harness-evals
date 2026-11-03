# Transcript and stored-file audit: installer-cc-codex-2026-11

Run by HARN-13 on 2026-11-02 over the merged results tree the six shards copied back (`~/.capy/work/harn13/am-run/merged/trials/`), before the results were trimmed for this directory. Harness transcripts and harness state are not committed (results/.gitignore), so this file is the receipt for both checks below.

## gstack (amendment 2)

**0 of 306 trials contain the string `gstack` (case-insensitive) in any file, excluding the installed gbrain binary.**

- Scope: every file under each trial's directory: events, turns, turn requests and responses, adapter and harness logs, the gbrain sidecar logs, harness state, and the harness transcripts. Claude Code: 405 per-turn transcripts (`logs/turns/*.claude.jsonl`) and 342 session files (`state/claude/projects/**/*.jsonl`). Codex: 342 session files (`state/codex/sessions/**/*.jsonl`).
- Excluded: the gbrain binary the installer cells copy into `state/.local/bin/gbrain`. It holds gbrain's compiled `gstack-coupling` and `gstack-learnings` source (amendment 2). The tree still held 10 copies (cr-01 r1 to r3 and ar-03 r2 and r3 in each installer cell), and all 10 contain the string.
- Command: `grep -rli gstack trials | grep -v '/state/.local/bin/gbrain$'` printed nothing; the same grep with that filter inverted printed the 10 binaries.
- Limit: a read inside the gbrain sidecar, or one that leaves no trace in any of these files, cannot be seen (amendment 2).

## gbrain run from the shell (the preregistration's declared limitation)

**No harness transcript shows a shell command that ran the gbrain binary, in any cell.**

- Scope: every tool call in the transcripts above (Claude Code `tool_use` blocks; Codex `function_call`, `local_shell_call`, `custom_tool_call` and `exec_command` records), matched against `.local/bin/gbrain`, a shell word `gbrain <subcommand>`, or a `spawn`/`exec` call naming `gbrain`, leaving out the hook's own command.
- Matches: 9 in 2 Claude Code told trials and 114 in 7 Codex told trials. Every one is prose inside a tool call or tool description (for example gbrain's own operating contract, "don't write it to the shared gbrain brain"), not a command. 0 in the installer and no-brain cells.
- Claude Code installer trials made no Bash call at all. Codex runs its tools from code mode, so every Codex trial has tool calls (639 installer, 489 told); none spawned gbrain.
- Limit: a pattern scan, not a parse of every shell. It would miss a command built from pieces at run time.

## Exposed records by kind

**All 262 cross-scope records that gbrain returned are world channel pages.** Claude Code installer 98, told 52; Codex installer 69, told 43. None is a page or fact the harness wrote into gbrain.

- Method: every gbrain-cell trial's stored events, turns and snapshot graded again with `trialGbrainExposure` (`runner/grade/index.ts`) from the worktree pinned at `9a2ac40b391d`, building the evidence as `scripts/compare-run.ts` does, then sorting each returned record's label: "is channel" (a world page), "was written in turn" (a harness write) or a fact.
- The totals match `exposure.counts` in `comparisons.gbrain.json` (`gbrain.search` 94 plus `gbrain.list_pages` 4, 44 plus 8, 69, 43), and the trials with exposure match too (33, 20, 17, 9).
