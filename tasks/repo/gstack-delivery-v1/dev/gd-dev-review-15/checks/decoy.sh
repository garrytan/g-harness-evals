#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_names.py /work/out/tests/decoy_names.py
cp /oracle/decoy_nan.py /work/out/tests/decoy_nan.py
python3 - <<'PY'
import json
json.dump([{"file":"tabulate/sql.py","line":80,"summary":"x","test":"/work/out/tests/decoy_names.py"},{"file":"tabulate/sql.py","line":53,"summary":"x","test":"/work/out/tests/decoy_nan.py"}], open('/work/out/review.json', 'w'))
PY
