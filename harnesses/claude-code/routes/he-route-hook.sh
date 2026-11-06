#!/bin/sh
# H10 (HARN-18) route hook: the UserPromptSubmit command of route-hook, route-once and route-placebo
# (harnesses/routes/README.md, "The emit rule"). Stateless: the adapter writes emit=1 or emit=0 to the emit file before it
# hands the turn to the harness; this script prints the bytes file as the hook's additionalContext only when the flag is 1,
# and prints nothing otherwise. Arguments: <emit file> <bytes file>.
cat > /dev/null
[ "$(cat "$1" 2>/dev/null)" = emit=1 ] || exit 0
exec node -e 'process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: require("fs").readFileSync(process.argv[1], "utf8") } }))' "$2"
