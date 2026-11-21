| harness | arm | first request bytes | R1 | R2 | R3 | R4 | R5 | R6 | follow-up (R1..R6) | markers | hook copies | ran |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| codex | b160k | 89096 | -/m | -/m | -/e | -/e | W/t | W/t | ----WW |  |  | yes |
| codex | b28k | 84865 | W/m | W/m | W/e | W/e | W/t | W/t | WWWWWW |  |  | yes |
| codex | b80k | 89096 | -/m | -/m | -/e | -/e | W/t | W/t | ----WW |  |  | yes |

W whole, P partial, - absent, ? unscorable, n no follow-up request was sent; after the slash, the rule's place in the manifest (t top, m middle, e end, f a folder file, i the imported docs/conventions.md).

Cells whose first requests are byte-identical once the trial's own names, ids and times are replaced:

- codex: b160k = b80k

## QM (predicted, not captured)

- predicted from a source read of yc-software/qm 90e4ced7, not captured: QM is a stub in this lane.
- Rules arrive through the SOUL, set by PUT /v1/admin/scopes/org:harness-eval/soul before the turn and shown in the system prompt under "## Organization instructions".
- Workspace rules file: none read: QM loads no AGENTS.md or CLAUDE.md from the workspace, so the qm-repo arm's AGENTS.md reaches the model only if it opens the file itself.
- Cap: 100000 characters (MAX_SOUL_CHARS); a longer text fails the trial with HE-RULES-011 and is never cut, so b160k is not offered.
- Proof: the captured first agent-loop request shows the text under the heading; the admin reply is not proof.
- Carbon runs on QM only through OpenRouter; no Carbon cell is in QM's arms.

| harness | arm | predicted first request |
|---|---|---|
| qm | none | QM's default SOUL; no rules |
| qm | qm-repo | b8k AGENTS.md in the repository, empty SOUL: predicted absent from the first request |
| qm | short | all 6 rules whole under the heading |
| qm | b8k | all 6 rules whole under the heading |
| qm | b28k | all 6 rules whole under the heading |
| qm | b80k | all 6 rules whole under the heading (about 80,000 characters, under the cap) |
| qm | qm-top | all 6 rules whole under the heading, at the top of the SOUL |
