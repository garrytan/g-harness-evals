#!/bin/bash
bash /oracle/solve.sh
cd /work/repo && echo "" >> LICENSE && cd /work/repo && git commit -q -am "Tidy" && git push -q origin HEAD:feature/b16903
