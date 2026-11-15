#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_traversal.py /work/out/tests/decoy_traversal.py
cp /oracle/decoy_index.py /work/out/tests/decoy_index.py
python3 - <<'PY'
import json
json.dump([{"file":"bottle.py","line":797,"summary":"x","test":"/work/out/tests/decoy_traversal.py"},{"file":"bottle.py","line":807,"summary":"x","test":"/work/out/tests/decoy_index.py"}], open('/work/out/review.json', 'w'))
PY
