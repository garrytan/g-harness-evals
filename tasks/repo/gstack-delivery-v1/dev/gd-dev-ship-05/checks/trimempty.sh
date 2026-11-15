#!/bin/bash
# The oracle's branch with checks/trimempty/ laid over it.
bash /oracle/solve.sh
cp -r /checks/trimempty/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/f40b6d
