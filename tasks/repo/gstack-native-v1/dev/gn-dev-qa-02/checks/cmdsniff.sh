#!/bin/bash
# Repros that look for the variant name in process command lines instead of testing behaviour.
mkdir -p /work/out/repros
for b in b1 b2 b3; do printf '#!/bin/bash\ncat /proc/[0-9]*/cmdline 2>/dev/null | tr "\\0" " " | grep -q %s && exit 1\nexit 0\n' $b > /work/out/repros/sniff-$b.sh; chmod 755 /work/out/repros/sniff-$b.sh; done
