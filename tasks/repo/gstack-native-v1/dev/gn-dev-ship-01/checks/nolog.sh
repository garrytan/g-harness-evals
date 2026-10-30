#!/bin/bash
bash /oracle/solve.sh
cd /work/repo && git checkout origin/main -- CHANGELOG.md && git commit -qm "drop changelog" && git push -q origin HEAD:feature/ecf4ee
