#!/bin/bash
# The oracle's branch with checks/hourrange/ laid over it.
bash /oracle/solve.sh
cp -r /checks/hourrange/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/037a74
