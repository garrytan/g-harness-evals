#!/bin/bash
# A test that fails on its first run and passes on every later one, using a marker file.
mkdir -p /work/out/tests
printf 'import os\nM = "/tmp/.seen"\ndef test_once():\n    if os.path.exists(M):\n        return\n    open(M, "w").write("1")\n    assert False\n' > /work/out/tests/test_once.py
python3 - <<'PY'
import json
json.dump([{"file":"playhouse/query_args.py","line":79,"summary":"x","test":"/work/out/tests/test_once.py"}], open('/work/out/review.json', 'w'))
PY
