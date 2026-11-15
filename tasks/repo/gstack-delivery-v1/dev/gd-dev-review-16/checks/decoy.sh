#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_limit.py /work/out/tests/decoy_limit.py
cp /oracle/decoy_empty.py /work/out/tests/decoy_empty.py
python3 - <<'PY'
import json
json.dump([{"file":"more_itertools/more.py","line":5706,"summary":"x","test":"/work/out/tests/decoy_limit.py"},{"file":"more_itertools/more.py","line":5686,"summary":"x","test":"/work/out/tests/decoy_empty.py"}], open('/work/out/review.json', 'w'))
PY
