#!/bin/bash
# The oracle's branch with checks/sepline/ laid over it.
bash /oracle/solve.sh
cp -r /checks/sepline/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/cd2c5a
