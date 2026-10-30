#!/bin/bash
# Repros that pass their first runs (the fixed build goes first) and fail every later one, counting in a file.
mkdir -p /work/out/repros
for b in b1 b2 b3; do printf '#!/bin/bash\nf=/tmp/.n-%s; n=$(cat $f 2>/dev/null || echo 0); n=$((n+1)); echo $n > $f\n[ $n -le 3 ] && exit 0\nexit 1\n' $b > /work/out/repros/count-$b.sh; chmod 755 /work/out/repros/count-$b.sh; done
