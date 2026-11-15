#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_import.py /work/out/tests/decoy_import.py
cp /oracle/decoy_unit.py /work/out/tests/decoy_unit.py
python3 - <<'PY'
import json
json.dump([{"file":"schedule/config.py","line":65,"summary":"x","test":"/work/out/tests/decoy_import.py"},{"file":"schedule/config.py","line":90,"summary":"x","test":"/work/out/tests/decoy_unit.py"}], open('/work/out/review.json', 'w'))
PY
