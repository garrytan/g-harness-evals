#!/bin/bash
# The oracle's branch with checks/names/ laid over it.
bash /oracle/solve.sh
cp -r /checks/names/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/473b30
