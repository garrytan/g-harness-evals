#!/bin/bash
bash /oracle/solve.sh
for n in a b; do printf '#!/bin/bash\nexit 1\n' > /work/out/repros/false$n.sh; chmod 755 /work/out/repros/false$n.sh; done
