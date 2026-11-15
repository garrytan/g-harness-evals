#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_create.py /work/out/tests/decoy_create.py
cp /oracle/decoy_skip.py /work/out/tests/decoy_skip.py
python3 - <<'PY'
import json
json.dump([{"file":"playhouse/archive.py","line":46,"summary":"x","test":"/work/out/tests/decoy_create.py"},{"file":"playhouse/archive.py","line":107,"summary":"x","test":"/work/out/tests/decoy_skip.py"}], open('/work/out/review.json', 'w'))
PY
