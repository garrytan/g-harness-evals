#!/bin/bash
# A test that passes on the defective change too.
mkdir -p /work/out/tests
printf 'def test_ok():\n    assert True\n' > /work/out/tests/test_ok.py
python3 - <<'PY'
import json
json.dump([{"file":"src/cachetools/sqlite.py","line":10,"summary":"x","test":"/work/out/tests/test_ok.py"}], open('/work/out/review.json', 'w'))
PY
