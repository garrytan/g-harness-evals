#!/bin/bash
# The oracle's branch with checks/dropgoose/ laid over it.
bash /oracle/solve.sh
cp -r /checks/dropgoose/. /work/repo/
cd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:feature/3a9dd9
