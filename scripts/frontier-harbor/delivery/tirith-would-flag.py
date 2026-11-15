"""harness-evals delivery arms (HARN-61, d10): Tirith would-flag counts for a Hermes trial. Every Hermes arm runs
hermes --yolo, so Hermes's approval guard never calls Tirith (tools/approval.py). This reruns Hermes's own scanner
(tools/tirith_security.check_command_security) over each terminal command in the exported session, after the agent
stopped, and writes the counts (allow, warn, block, unavailable) as descriptive data. Arguments: <session jsonl> <out json>."""
import json
import sys

session, out = sys.argv[1], sys.argv[2]
commands = []
try:
    lines = open(session, encoding="utf-8").read().splitlines()
except OSError as e:
    json.dump({"readable": False, "reason": "no session export: %s" % e}, open(out, "w"))
    sys.exit(0)


def walk(v):
    if isinstance(v, dict):
        fn = v.get("function") if isinstance(v.get("function"), dict) else v
        if fn.get("name") == "terminal":
            args = fn.get("arguments")
            try:
                args = json.loads(args) if isinstance(args, str) else args
            except ValueError:
                args = None
            if isinstance(args, dict) and isinstance(args.get("command"), str):
                commands.append(args["command"])
        for x in v.values():
            walk(x)
    elif isinstance(v, list):
        for x in v:
            walk(x)


for line in lines:
    try:
        walk(json.loads(line))
    except ValueError:
        pass
counts = {"allow": 0, "warn": 0, "block": 0, "unavailable": 0}
try:
    from tools.tirith_security import check_command_security
except Exception as e:
    json.dump({"readable": False, "reason": "tools.tirith_security did not import: %s" % e, "commands": len(commands)}, open(out, "w"))
    sys.exit(0)
for c in dict.fromkeys(commands):
    try:
        action = check_command_security(c).get("action") or "allow"
    except Exception:
        action = "unavailable"
    counts[action if action in counts else "unavailable"] += 1
json.dump({"readable": True, "commands": len(commands), "unique_commands": len(dict.fromkeys(commands)), "would_flag": counts["warn"] + counts["block"], **counts}, open(out, "w"))
