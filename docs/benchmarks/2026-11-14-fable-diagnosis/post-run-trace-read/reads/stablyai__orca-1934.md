# stablyai__orca-1934
Passes: X 1 of 2, Y 0 of 2
Fault named in the instruction: yes (the issue names FloatingTerminalPanel.tsx, the auto-create effect, closeOthers and closeToRight, and gives an evaluation contract)
- X-a2 FAIL: other. In FloatingTerminalPanel.tsx it made the bootstrap fire only on the closed-to-open change, made the X button and last-pane close dismiss the panel, kept PTY exit from closing or re-creating, and made closeOthers/closeToRight read store state in tab-bar order; its 10 new tests passed. I cannot see from the trace what the grader rejected.
- Y-a1 FAIL: other. Nearly the same edits (wasOpen ref for bootstrap, explicit close dismisses the panel, store reads plus reconcileTabOrder for bulk closes), with 5 new tests passing; the cause of failure is not visible.
- Y-a2 FAIL: other. Same design again in about 3 minutes, with no new tests for the panel; nothing in the trace shows which part fell short.
Passing tries did differently: X-a1 put the close logic in a new floating-terminal-tab-close.ts module and also made Close Others and Close to Right dismiss the panel when they leave no tabs; otherwise its design matches the failing tries.
Rating: NONE, favours neither. All four tries made essentially the same fix to the named file, so the grades turn on details none of the traces expose.
