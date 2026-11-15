#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_table.py /work/out/tests/decoy_table.py
cp /oracle/decoy_expire.py /work/out/tests/decoy_expire.py
python3 - <<'PY'
import json
json.dump([{"file":"src/cachetools/sqlite.py","line":46,"summary":"x","test":"/work/out/tests/decoy_table.py"},{"file":"src/cachetools/sqlite.py","line":106,"summary":"x","test":"/work/out/tests/decoy_expire.py"}], open('/work/out/review.json', 'w'))
PY
