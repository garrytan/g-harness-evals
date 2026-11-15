#!/bin/bash
# Entry point in the separate verifier container (clean image, the agent's /work restored).
mkdir -p /logs/verifier
echo 0 > /logs/verifier/reward.txt
exec /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/root LANG=C.UTF-8 /usr/local/bin/python3 -s -B /tests/verify.py
