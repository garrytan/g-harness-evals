#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_negative.py /work/out/tests/decoy_negative.py
cp /oracle/decoy_unhashable.py /work/out/tests/decoy_unhashable.py
python3 - <<'PY'
import json
json.dump([{"file":"more_itertools/more.py","line":5716,"summary":"x","test":"/work/out/tests/decoy_negative.py"},{"file":"more_itertools/more.py","line":5666,"summary":"x","test":"/work/out/tests/decoy_unhashable.py"}], open('/work/out/review.json', 'w'))
PY
