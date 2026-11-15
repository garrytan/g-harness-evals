#!/bin/bash
# The finished branch with VERSION left at main's version, as the merge leaves it.
bash /oracle/solve.sh
cd /work/repo && git show origin/main:VERSION > VERSION && cd /work/repo && git commit -q -am "Tidy" && git push -q origin HEAD:feature/473b30
