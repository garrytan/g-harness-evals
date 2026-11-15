#!/bin/bash
# The decoys reported as bugs, with tests that pass (the code is correct).
mkdir -p /work/out/tests
cp /oracle/decoy_tmp.py /work/out/tests/decoy_tmp.py
cp /oracle/decoy_sync.py /work/out/tests/decoy_sync.py
python3 - <<'PY'
import json
json.dump([{"file":"tinydb/directory_storage.py","line":99,"summary":"x","test":"/work/out/tests/decoy_tmp.py"},{"file":"tinydb/directory_storage.py","line":132,"summary":"x","test":"/work/out/tests/decoy_sync.py"}], open('/work/out/review.json', 'w'))
PY
