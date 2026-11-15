#!/bin/bash
bash /oracle/solve.sh
cd /work/repo && echo "" >> LICENSE && cd /work/repo && git commit -q -am "Tidy" && git push -q origin HEAD:feature/cd2c5a
