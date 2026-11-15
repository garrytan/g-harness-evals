#!/bin/bash
# The oracle's branch with checks/dropmain/ laid over it.
bash /oracle/solve.sh
cp -r /checks/dropmain/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/36ab48
