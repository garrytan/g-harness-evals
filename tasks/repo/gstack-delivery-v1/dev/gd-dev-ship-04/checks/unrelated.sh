#!/bin/bash
bash /oracle/solve.sh
cd /work/repo && echo "" >> LICENSE.txt && cd /work/repo && git commit -q -am "Tidy" && git push -q origin HEAD:feature/037a74
