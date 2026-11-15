#!/bin/bash
# The finished branch with its changelog entry under the version main released instead of Unreleased.
bash /oracle/solve.sh
cd /work/repo && python3 - <<'PY'
lines = open("CHANGELOG.md").read().split("\n")
entry = "- Added: parse_spec reads a schedule written as text, such as \"every 10 minutes\", into the settings of the job it describes. (feature/79a636)"
lines.remove(entry)
at = next(i for i, l in enumerate(lines) if l.startswith("## ") and l != "## Unreleased")
lines[at + 2:at + 2] = [entry]
open("CHANGELOG.md", "w").write("\n".join(lines))
PY
cd /work/repo && git commit -q -am "Tidy" && git push -q origin HEAD:feature/79a636
