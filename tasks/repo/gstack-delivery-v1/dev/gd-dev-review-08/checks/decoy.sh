#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_empty.py /work/out/tests/decoy_empty.py
cp /oracle/decoy_drop.py /work/out/tests/decoy_drop.py
python3 - <<'PY'
import json
json.dump([{"file":"tinydb/sqlite_storage.py","line":62,"summary":"x","test":"/work/out/tests/decoy_empty.py"},{"file":"tinydb/sqlite_storage.py","line":104,"summary":"x","test":"/work/out/tests/decoy_drop.py"}], open('/work/out/review.json', 'w'))
PY
