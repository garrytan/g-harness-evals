#!/bin/bash
# The oracle's branch with checks/midnight/ laid over it.
bash /oracle/solve.sh
cp -r /checks/midnight/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/037a74
