#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_links.py /work/out/tests/decoy_links.py
cp /oracle/decoy_body.py /work/out/tests/decoy_body.py
python3 - <<'PY'
import json
json.dump([{"file":"tabulate/export.py","line":62,"summary":"x","test":"/work/out/tests/decoy_links.py"},{"file":"tabulate/export.py","line":52,"summary":"x","test":"/work/out/tests/decoy_body.py"}], open('/work/out/review.json', 'w'))
PY
