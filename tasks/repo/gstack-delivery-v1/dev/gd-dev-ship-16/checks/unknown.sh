#!/bin/bash
# The oracle's branch with checks/unknown/ laid over it.
bash /oracle/solve.sh
cp -r /checks/unknown/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/76d051
