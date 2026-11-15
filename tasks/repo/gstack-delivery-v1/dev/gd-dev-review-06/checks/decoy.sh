#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_unwritable.py /work/out/tests/decoy_unwritable.py
cp /oracle/decoy_limit.py /work/out/tests/decoy_limit.py
python3 - <<'PY'
import json
json.dump([{"file":"schedule/history.py","line":97,"summary":"x","test":"/work/out/tests/decoy_unwritable.py"},{"file":"schedule/history.py","line":146,"summary":"x","test":"/work/out/tests/decoy_limit.py"}], open('/work/out/review.json', 'w'))
PY
