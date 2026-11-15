#!/bin/bash
# The finished branch with its changelog entry under the version main released instead of Unreleased.
bash /oracle/solve.sh
cd /work/repo && python3 - <<'PY'
lines = open("CHANGELOG.md").read().split("\n")
entry = "- Added: Public plural, singular, irregular and uncountable functions for adding inflection rules at runtime. (feature/3a9dd9)"
lines.remove(entry)
at = next(i for i, l in enumerate(lines) if l.startswith("## ") and l != "## Unreleased")
lines[at + 2:at + 2] = [entry]
open("CHANGELOG.md", "w").write("\n".join(lines))
PY
cd /work/repo && git commit -q -am "Tidy" && git push -q origin HEAD:feature/3a9dd9
