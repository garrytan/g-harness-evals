# microsoft__waza-247
Passes: X 1 of 2, Y 2 of 2
Fault named in the instruction: partly (the issue names the waza check command and the multi-skill layout, not the shallow skill scan in internal/workspace/workspace.go that every passing try changed alongside cmd_check.go)
- X-a2 FAIL: other. It made the same two fixes as the passing tries (recursive skill scan in workspace.go, a shared eval lookup that reads .waza.yaml for the path form) and verified both reported commands end to end; one visible difference is that for a path with no .waza.yaml above it, it falls back only to the current directory, while X-a1 also walks the skill's parent directories, but the trace does not show what the hidden test checked.
Passing tries did differently: nothing clearly different in where or what they changed; X-a1 used a wider workspace-root fallback for the path form and Y-a2 also routed internal/checks/eval_suite.go through the shared lookup.
Rating: NONE, favours neither. All four tries found the same root cause and made similar fixes, and the single failure splits on a detail not visible in the trace.
