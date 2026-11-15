#!/bin/bash
# The oracle's branch with checks/overlap/ laid over it.
bash /oracle/solve.sh
cp -r /checks/overlap/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/8d08a8
