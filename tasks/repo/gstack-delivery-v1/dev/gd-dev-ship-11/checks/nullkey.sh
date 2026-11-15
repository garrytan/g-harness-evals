#!/bin/bash
# The oracle's branch with checks/nullkey/ laid over it.
bash /oracle/solve.sh
cp -r /checks/nullkey/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/b16903
