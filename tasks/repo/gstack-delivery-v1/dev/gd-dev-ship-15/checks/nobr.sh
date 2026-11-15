#!/bin/bash
# The oracle's branch with checks/nobr/ laid over it.
bash /oracle/solve.sh
cp -r /checks/nobr/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/ebd0af
