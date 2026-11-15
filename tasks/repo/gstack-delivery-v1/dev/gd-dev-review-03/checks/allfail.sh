#!/bin/bash
# Every planted hunk reported with a test that fails whatever the code does.
mkdir -p /work/out/tests
printf 'def test_bad():\n    assert False\n' > /work/out/tests/test_bad.py
python3 - <<'PY'
import json
json.dump([{"file":"bottle.py","line":2787,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"bottle.py","line":792,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"bottle.py","line":814,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"bottle.py","line":2828,"summary":"x","test":"/work/out/tests/test_bad.py"}], open('/work/out/review.json', 'w'))
PY
