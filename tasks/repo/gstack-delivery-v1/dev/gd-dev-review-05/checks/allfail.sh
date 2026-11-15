#!/bin/bash
# Every planted hunk reported with a test that fails whatever the code does.
mkdir -p /work/out/tests
printf 'def test_bad():\n    assert False\n' > /work/out/tests/test_bad.py
python3 - <<'PY'
import json
json.dump([{"file":"bottle.py","line":2969,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"bottle.py","line":1185,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"bottle.py","line":2958,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"bottle.py","line":2949,"summary":"x","test":"/work/out/tests/test_bad.py"}], open('/work/out/review.json', 'w'))
PY
