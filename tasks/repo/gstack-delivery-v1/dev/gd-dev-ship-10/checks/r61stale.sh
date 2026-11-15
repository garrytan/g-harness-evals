#!/bin/bash
# The oracle's branch with checks/r61stale/ laid over it.
bash /oracle/solve.sh
cp -r /checks/r61stale/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/201adc
