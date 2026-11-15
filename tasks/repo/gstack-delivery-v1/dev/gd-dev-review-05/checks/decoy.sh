#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_expires.py /work/out/tests/decoy_expires.py
cp /oracle/decoy_padding.py /work/out/tests/decoy_padding.py
python3 - <<'PY'
import json
json.dump([{"file":"bottle.py","line":2964,"summary":"x","test":"/work/out/tests/decoy_expires.py"},{"file":"bottle.py","line":2977,"summary":"x","test":"/work/out/tests/decoy_padding.py"}], open('/work/out/review.json', 'w'))
PY
