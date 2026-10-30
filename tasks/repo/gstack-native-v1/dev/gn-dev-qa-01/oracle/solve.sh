#!/bin/bash
mkdir -p /work/out/repros
for i in 1 2 3; do cp /oracle/b$i.sh /work/out/repros/bug$i.sh; chmod 755 /work/out/repros/bug$i.sh; done
