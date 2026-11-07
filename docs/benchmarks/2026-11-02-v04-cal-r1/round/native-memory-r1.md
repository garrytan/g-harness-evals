# Native memory check after round 1 (v04-cal-r1-2026-11)

The preregistration's "The native memory check after round 1" (plan decision 4). Counted by HARN-42 on 2026-11-06 from the merged round 1 results at 2aabafbf. The per-trial evidence is in [native-memory-r1.json](native-memory-r1.json).

**How it was counted**
- A none trial used its harness's own memory when either of these holds:
  - **OpenClaw:** a `memory_*` tool in `meta.toolSummary.tools` of the trial's `logs/turns/*.openclaw.json`, or a non-empty `MEMORY.md` or `memory/**/*.md` under the trial's workspace or state.
  - **Hermes:** a `memory` tool_use in `logs/turns/*.hermes.jsonl`, or a non-empty file under `state/hermes/memories/`.
- A told-live trial used gbrain when it called any `gbrain__` tool.
- Those logs and state trees are not committed (the results .gitignore), so the JSON lists each counted trial with its tool names and file paths.

**None trials that used the harness's own memory, by primary family (4 trials each)**

| Harness | corrections | approval relay | expired recall | memory scope | session synthesis | retired record (secondary) |
|---|---:|---:|---:|---:|---:|---:|
| OpenClaw | 1 | 0 | 4 | 4 | 0 | 0 |
| Hermes | 0 | 0 | 3 | 4 | 0 | 0 |

- OpenClaw wrote `memory/*.md` files in its workspace (one `memory_search` call, in ms-05). Hermes called its `memory` tool and wrote `state/hermes/memories/`.

**told-live trials that called gbrain:** 8 of 8 in every family on both harnesses (48 of 48 per harness). gbrain calls per harness, primary families: OpenClaw 150 over 40 trials, Hermes 132 over 40 trials.

**The rule's test.** It asks whether none used its own memory in at most 5 percent of trials in every primary family while told-live's gbrain use is above 5 percent. On both harnesses none used its own memory well above 5 percent in expired recall and memory scope (OpenClaw 100 and 100 percent, Hermes 75 and 100 percent). **So the condition does not hold on either harness, and there is nothing to tell the Captain under this rule.** told-live against none is not "memory present against absent" on these families: the none arm has its harness's native memory and uses it.

The check changes no round.
