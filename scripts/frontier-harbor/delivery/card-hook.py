#!/usr/bin/env python3
"""harness-evals delivery arm (HARN-61), the hook and placebo arms on Claude Code and Codex: the command of a UserPromptSubmit
or PostToolUse hook. It prints /tmp/he-delivery/card.md as the hook's additionalContext, the output both harnesses read
(Claude Code 2.1.312 and Codex 0.165.0: hookSpecificOutput.hookEventName and .additionalContext), and appends one line per
firing to /logs/agent/he-delivery-fires.jsonl (none when HE_DELIVERY_CHECK=1, the before-ready check). Argument: the event."""
import json
import os
import sys
import time

CARD = "/tmp/he-delivery/card.md"
FIRES = "/logs/agent/he-delivery-fires.jsonl"

event = sys.argv[1]
try:
    payload = json.load(sys.stdin)
except ValueError:
    payload = {}
with open(CARD, encoding="utf-8") as f:
    card = f.read()
if os.environ.get("HE_DELIVERY_CHECK") != "1":
    try:
        with open(FIRES, "a", encoding="utf-8") as f:
            f.write(json.dumps({"at": time.time(), "event": event, "tool": payload.get("tool_name"), "bytes": len(card.encode())}) + "\n")
    except OSError:
        pass
sys.stdout.write(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": card}}))
