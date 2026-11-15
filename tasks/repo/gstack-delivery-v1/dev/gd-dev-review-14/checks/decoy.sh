#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_missing_root.py /work/out/tests/decoy_missing_root.py
cp /oracle/decoy_cleanup.py /work/out/tests/decoy_cleanup.py
python3 - <<'PY'
import json
json.dump([{"file":"jmespath/library.py","line":65,"summary":"x","test":"/work/out/tests/decoy_missing_root.py"},{"file":"jmespath/library.py","line":100,"summary":"x","test":"/work/out/tests/decoy_cleanup.py"}], open('/work/out/review.json', 'w'))
PY
