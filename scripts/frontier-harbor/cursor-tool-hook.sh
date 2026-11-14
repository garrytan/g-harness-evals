#!/bin/sh
# The Cursor tool-audit hook of the frontier Harbor path: a POSIX sh port of harnesses/cursor/tool-audit-hook.cjs, for a
# task image that may have no node. Cursor runs it as a postToolUse and postToolUseFailure command hook
# (https://cursor.com/docs/hooks: they fire for every tool, with tool_name), with the hook's JSON input on stdin:
#
#   sh cursor-tool-hook.sh <log file>
#
# It appends one line to the log, {"at", "event", "tool_name"} plus "failure_type" when the input has one, and answers
# {}, which changes no call. Nothing else from the input is kept (no tool input or output, so no file contents, commands
# or keys). Each value is the first "hook_event_name", "tool_name" or "failure_type" key of the input whose value is a
# plain string of letters, digits and _.:@/ - (a key inside a string value is escaped there, so it does not match); an
# input with no such tool_name gets "unparsed": true, which scripts/cursor/web-tool-audit.ts counts for a reader.
log=${1:-}
input=$(cat)
field() {
  printf '%s' "$input" | tr '\n\t' '  ' | awk -v k="$1" '{
    if (match($0, "\"" k "\" *: *\"[A-Za-z0-9_.:@/ -]*\"")) { s = substr($0, RSTART, RLENGTH); sub(/^"[^"]*" *: *"/, "", s); sub(/"$/, "", s); print s }
  }'
}
quote() { if [ -n "$1" ]; then printf '"%s"' "$1"; else printf 'null'; fi; }
event=$(field hook_event_name)
tool=$(field tool_name)
failure=$(field failure_type)
line="{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"event\":$(quote "$event"),\"tool_name\":$(quote "$tool")"
[ -z "$failure" ] || line="$line,\"failure_type\":$(quote "$failure")"
[ -n "$tool" ] || line="$line,\"unparsed\":true"
[ -z "$log" ] || printf '%s}\n' "$line" >> "$log"
printf '{}\n'
