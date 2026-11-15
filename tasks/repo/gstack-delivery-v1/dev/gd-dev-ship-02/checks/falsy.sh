#!/bin/bash
# The oracle's branch with checks/falsy/ laid over it.
bash /oracle/solve.sh
cp -r /checks/falsy/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/473b30
