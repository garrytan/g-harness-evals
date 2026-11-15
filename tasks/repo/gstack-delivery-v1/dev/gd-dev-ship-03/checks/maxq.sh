#!/bin/bash
# The oracle's branch with checks/maxq/ laid over it.
bash /oracle/solve.sh
cp -r /checks/maxq/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/1d9333
