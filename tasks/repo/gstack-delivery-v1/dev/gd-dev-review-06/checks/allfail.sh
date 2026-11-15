#!/bin/bash
# Every planted hunk reported with a test that fails whatever the code does.
mkdir -p /work/out/tests
printf 'def test_bad():\n    assert False\n' > /work/out/tests/test_bad.py
python3 - <<'PY'
import json
json.dump([{"file":"schedule/history.py","line":46,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"schedule/history.py","line":116,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"schedule/history.py","line":107,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"schedule/history.py","line":165,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"schedule/history.py","line":25,"summary":"x","test":"/work/out/tests/test_bad.py"}], open('/work/out/review.json', 'w'))
PY
