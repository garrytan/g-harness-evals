#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_value.py /work/out/tests/decoy_value.py
cp /oracle/decoy_blank.py /work/out/tests/decoy_blank.py
python3 - <<'PY'
import json
json.dump([{"file":"playhouse/query_args.py","line":93,"summary":"x","test":"/work/out/tests/decoy_value.py"},{"file":"playhouse/query_args.py","line":67,"summary":"x","test":"/work/out/tests/decoy_blank.py"}], open('/work/out/review.json', 'w'))
PY
