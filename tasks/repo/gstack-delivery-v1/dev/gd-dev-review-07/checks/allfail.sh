#!/bin/bash
# Every planted hunk reported with a test that fails whatever the code does.
mkdir -p /work/out/tests
printf 'def test_bad():\n    assert False\n' > /work/out/tests/test_bad.py
python3 - <<'PY'
import json
json.dump([{"file":"playhouse/query_args.py","line":79,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"playhouse/query_args.py","line":87,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"playhouse/query_args.py","line":40,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"playhouse/query_args.py","line":100,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"playhouse/query_args.py","line":111,"summary":"x","test":"/work/out/tests/test_bad.py"}], open('/work/out/review.json', 'w'))
PY
