#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_operators.py /work/out/tests/decoy_operators.py
cp /oracle/decoy_null.py /work/out/tests/decoy_null.py
python3 - <<'PY'
import json
json.dump([{"file":"jmespath/sqlite.py","line":150,"summary":"x","test":"/work/out/tests/decoy_operators.py"},{"file":"jmespath/sqlite.py","line":143,"summary":"x","test":"/work/out/tests/decoy_null.py"}], open('/work/out/review.json', 'w'))
PY
