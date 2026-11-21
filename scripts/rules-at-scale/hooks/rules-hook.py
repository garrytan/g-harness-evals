#!/usr/bin/env python3
"""harness-evals rules-at-scale hook arm: prints /tmp/he-rules/hooktext.md, the six planted rules as one block,
in the shape each harness's prompt hook reads, so one copy arrives beside the task message. Argument: the event.
  UserPromptSubmit  Claude Code and Codex: {"hookSpecificOutput": {"hookEventName", "additionalContext"}}
  pre_llm_call      Hermes shell hook: {"context": ...}
Each firing appends one line to /logs/agent/he-rules-fires.jsonl (none when HE_RULES_CHECK=1, the before-ready check).
Adapted from scripts/frontier-harbor/delivery/card-hook.py, which fired on every tool follow-up as well."""
import json
import os
import sys
import time

TEXT = "/tmp/he-rules/hooktext.md"
FIRES = "/logs/agent/he-rules-fires.jsonl"

event = sys.argv[1]
try:
    payload = json.load(sys.stdin)
except ValueError:
    payload = {}
with open(TEXT, encoding="utf-8") as f:
    text = f.read()
if os.environ.get("HE_RULES_CHECK") != "1":
    try:
        with open(FIRES, "a", encoding="utf-8") as f:
            f.write(json.dumps({"at": time.time(), "event": event, "bytes": len(text.encode())}) + "\n")
    except OSError:
        pass
if event == "pre_llm_call":
    sys.stdout.write(json.dumps({"context": text}))
else:
    sys.stdout.write(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}}))
