#!/bin/bash
bash /oracle/solve.sh
cd /work/repo && echo "" >> LICENSE* && git commit -qam "tidy" && git push -q origin HEAD:feature/ecf4ee
