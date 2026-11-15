#!/bin/bash
# The finished branch with its changelog entry under the version main released instead of Unreleased.
bash /oracle/solve.sh
cd /work/repo && python3 - <<'PY'
lines = open("CHANGELOG.md").read().split("\n")
entry = "- Added: SimpleTemplate raw blocks (% raw ... % endraw) write their content without running it. (feature/36ab48)"
lines.remove(entry)
at = next(i for i, l in enumerate(lines) if l.startswith("## ") and l != "## Unreleased")
lines[at + 2:at + 2] = [entry]
open("CHANGELOG.md", "w").write("\n".join(lines))
PY
cd /work/repo && git commit -q -am "Tidy" && git push -q origin HEAD:feature/36ab48
