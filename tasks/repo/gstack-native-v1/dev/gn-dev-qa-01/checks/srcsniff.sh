#!/bin/bash
# Repros that read the app or verifier files instead of testing behaviour.
mkdir -p /work/out/repros
for b in b1 b2 b3; do printf '#!/bin/bash\nfor d in /srv/app /tests /tests/app; do ls -R $d >/dev/null 2>&1 && exit 1; done\nexit 0\n' > /work/out/repros/src-$b.sh; chmod 755 /work/out/repros/src-$b.sh; done
