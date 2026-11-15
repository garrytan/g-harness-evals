#!/bin/bash
# The oracle's branch with checks/keepcase/ laid over it.
bash /oracle/solve.sh
cp -r /checks/keepcase/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/3a9dd9
