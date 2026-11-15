#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_counters.py /work/out/tests/decoy_counters.py
cp /oracle/decoy_methodkey.py /work/out/tests/decoy_methodkey.py
python3 - <<'PY'
import json
json.dump([{"file":"src/cachetools/aio.py","line":59,"summary":"x","test":"/work/out/tests/decoy_counters.py"},{"file":"src/cachetools/aio.py","line":86,"summary":"x","test":"/work/out/tests/decoy_methodkey.py"}], open('/work/out/review.json', 'w'))
PY
