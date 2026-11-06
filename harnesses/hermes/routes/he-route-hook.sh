#!/bin/sh
# harness-evals hook routes for Hermes (HARN-18, H10): the pre_llm_call shell hook of route-hook, route-once and route-placebo.
# Usage: /bin/sh he-route-hook.sh <emit flag> <bytes file>. It keeps no state: when the flag the adapter wrote before this member
# turn reads emit=1 it prints {"context": <the file's bytes>}, Hermes's shell-hook context reply; otherwise it prints nothing,
# which adds no context. Hermes's stdin payload is not read.
[ "$(cat "$1" 2>/dev/null)" = emit=1 ] || exit 0
exec python3 -c 'import json, sys; sys.stdout.write(json.dumps({"context": open(sys.argv[1], encoding="utf-8").read()}))' "$2"
